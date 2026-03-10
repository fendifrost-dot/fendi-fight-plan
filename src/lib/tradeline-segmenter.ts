/**
 * Tradeline Segmenter — Splits extracted credit report text into
 * individual tradeline blocks BEFORE sending to AI for parsing.
 * 
 * Pipeline: splitTradelines → filter headers → mergeOrphanBlocks → deterministic extraction
 */

// Expanded anchors that mark the start of a new tradeline block
const TRADELINE_BLOCK_ANCHORS = [
  'ACCOUNT NAME',
  'ACCOUNT NUMBER',
  'ACCOUNT #',
  'ACCOUNT INFORMATION',
  'ACCOUNT DETAILS',
  'ACCOUNT STATUS',
  'ACCOUNT',
  'ACCT NO',
  'ACCT #',
  'CREDITOR',
  'CREDITOR NAME',
  'COMPANY NAME',
  'ORIGINAL CREDITOR',
  'COLLECTION AGENCY',
  'LENDER',
  'LOAN NUMBER',
  'TRADELINE',
];

/**
 * Split raw credit report text into individual tradeline blocks.
 */
export function splitTradelines(text: string): string[] {
  if (!text || typeof text !== 'string' || text.trim().length === 0) return [];

  const anchorPattern = TRADELINE_BLOCK_ANCHORS
    .map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:${anchorPattern})\\s*[:\\-]?\\s*[\\s\\S]*?(?=\\n\\s*(?:${anchorPattern})\\s*[:\\-]?|$)`,
    'gi'
  );

  const matches = text.match(pattern);
  if (!matches || matches.length === 0) return [];

  const MIN_BLOCK_LENGTH = 50;
  const result = matches
    .map(m => m.trim())
    .filter(block => block.length >= MIN_BLOCK_LENGTH);

  console.log(`[segmenter] raw blocks: ${matches.length}, after min-length filter: ${result.length}`);
  return result;
}

/**
 * Check if a text block looks like a bureau header rather than a tradeline.
 */
export function isBureauHeader(text: string): boolean {
  if (!text || text.length < 10) return true;

  const hasParenCode = /\(\w{3,5}\)/.test(text);
  const hasAccountFields = /(?:ACCOUNT\s*#|ACCOUNT\s*NUMBER|BALANCE|STATUS|DATE OPENED|PAYMENT|PAST DUE|HIGH CREDIT|CREDIT LIMIT)/i.test(text);

  if (hasParenCode && !hasAccountFields && text.length < 120) return true;

  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length <= 2 && !hasAccountFields) return true;

  return false;
}

/**
 * Check if a block has minimum data to be a real tradeline.
 * Must contain at least one of: account number, balance, or payment status.
 */
export function looksLikeTradeline(block: string): boolean {
  return /account\s*number|account\s*#|acct\s*#|balance|status|credit\s*limit|past\s*due|payment/i.test(block);
}

/**
 * Merge orphan creditor headers with their following account data blocks.
 * Fixes cases where segmentation separates a creditor name from its fields.
 */
export function mergeOrphanTradelineBlocks(blocks: string[]): string[] {
  if (!blocks || blocks.length <= 1) return blocks;

  const merged: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    const hasAccountFields = /account\s*number|account\s*#|balance|status|opened|payment/i.test(block);
    const isCreditorHeader = /\b(bank|financial|credit|capital|chase|wells|discover|loan|card|synchrony|citi|barclays|amex|american\s*express)\b/i.test(block);

    // If this block is just a creditor name without fields, merge with next block
    if (!hasAccountFields && isCreditorHeader && i < blocks.length - 1) {
      merged.push(block + '\n' + blocks[i + 1]);
      i++; // skip next block since we merged it
    } else {
      merged.push(block);
    }
  }

  console.log(`[segmenter] after orphan merge: ${merged.length} (was ${blocks.length})`);
  return merged;
}

/**
 * Extract deterministic fields from a tradeline block before AI processing.
 * These fields are "locked" — AI should not override them.
 */
export function extractDeterministicFields(block: string): Record<string, string | null> {
  const fields: Record<string, string | null> = {
    account_number: null,
    balance: null,
    date_opened: null,
    status: null,
  };

  // Account number — various formats
  const acctMatch = block.match(/(?:account\s*(?:number|#|no)|acct\s*(?:#|no))[:\s]+([X*\d][\w*\-. ]{2,})/i);
  if (acctMatch) fields.account_number = acctMatch[1].trim();

  // Balance
  const balMatch = block.match(/balance[:\s]+\$?([\d,]+(?:\.\d{2})?)/i);
  if (balMatch) fields.balance = balMatch[1].trim();

  // Date opened
  const dateMatch = block.match(/(?:date\s*)?opened[:\s]+(\d{1,2}\/\d{2,4}(?:\/\d{2,4})?)/i);
  if (dateMatch) fields.date_opened = dateMatch[1].trim();

  // Status
  const statusMatch = block.match(/status[:\s]+([^\n]{3,50})/i);
  if (statusMatch) fields.status = statusMatch[1].trim();

  // Only return fields that were actually found
  const found: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) found[k] = v;
  }

  return found;
}

/**
 * Full pipeline: segment → filter → merge → validate.
 * Returns blocks ready for per-tradeline AI extraction.
 */
export function preparePerTradelineChunks(fullText: string): string[] {
  const blocks = splitTradelines(fullText);
  if (blocks.length === 0) return [fullText];

  // Filter bureau headers
  const realBlocks = blocks.filter(block => !isBureauHeader(block));
  console.log(`[segmenter] headers filtered: ${blocks.length - realBlocks.length}`);
  if (realBlocks.length === 0) return [fullText];

  // Merge orphan creditor headers with their account data
  const merged = mergeOrphanTradelineBlocks(realBlocks);

  // Final validation — only keep blocks that look like real tradelines
  const validated = merged.filter(block => looksLikeTradeline(block));
  console.log(`[segmenter] after tradeline validation: ${validated.length} (was ${merged.length})`);

  return validated.length > 0 ? validated : [fullText];
}

/**
 * Prepare text chunks with grouping (for fallback/batch mode).
 */
export function prepareTextChunks(fullText: string, maxChunkSize = 8000): string[] {
  const blocks = splitTradelines(fullText);

  if (blocks.length === 0) {
    const chunks: string[] = [];
    for (let i = 0; i < fullText.length; i += maxChunkSize) {
      chunks.push(fullText.slice(i, i + maxChunkSize));
    }
    return chunks.length > 0 ? chunks : [fullText];
  }

  const realBlocks = blocks.filter(block => !isBureauHeader(block));
  console.log(`[segmenter] headers filtered: ${blocks.length - realBlocks.length}`);
  if (realBlocks.length === 0) return [fullText];

  const merged = mergeOrphanTradelineBlocks(realBlocks);

  const chunks: string[] = [];
  let currentChunk = '';

  for (const block of merged) {
    if (currentChunk.length + block.length + 2 > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += '\n\n' + block;
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [fullText];
}
