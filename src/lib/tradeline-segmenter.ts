/**
 * Tradeline Segmenter — Splits extracted credit report text into
 * individual tradeline blocks BEFORE sending to AI for parsing.
 * 
 * This ensures the AI processes one tradeline at a time, preventing
 * header strings from being extracted as separate accounts.
 */

// Expanded anchors that mark the start of a new tradeline block
// Covers Experian, Equifax, TransUnion, Credit Karma, and tri-merge formats
const TRADELINE_BLOCK_ANCHORS = [
  'ACCOUNT NAME',
  'ACCOUNT NUMBER',
  'ACCOUNT #',
  'ACCOUNT INFORMATION',
  'ACCOUNT DETAILS',
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
 * Each block contains one tradeline's worth of data.
 * 
 * Returns empty array if no tradeline anchors are found (falls back to full-text).
 */
export function splitTradelines(text: string): string[] {
  if (!text || typeof text !== 'string' || text.trim().length === 0) return [];

  // Build a regex pattern from anchors — escape special regex chars safely
  const anchorPattern = TRADELINE_BLOCK_ANCHORS
    .map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  // Match blocks that start with an anchor and extend to the next anchor or end
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:${anchorPattern})\\s*[:\\-]?\\s*[\\s\\S]*?(?=\\n\\s*(?:${anchorPattern})\\s*[:\\-]?|$)`,
    'gi'
  );

  const matches = text.match(pattern);
  if (!matches || matches.length === 0) return [];

  // Filter out blocks that are too short (likely headers, not real tradelines)
  const MIN_BLOCK_LENGTH = 50;
  return matches
    .map(m => m.trim())
    .filter(block => block.length >= MIN_BLOCK_LENGTH);
}

/**
 * Check if a text block looks like a bureau header rather than a tradeline.
 * Bureau headers contain bank codes like (7805) but lack account data fields.
 */
export function isBureauHeader(text: string): boolean {
  if (!text || text.length < 10) return true;

  // Has a parenthetical code but no account data fields
  const hasParenCode = /\(\w{3,5}\)/.test(text);
  const hasAccountFields = /(?:ACCOUNT\s*#|ACCOUNT\s*NUMBER|BALANCE|STATUS|DATE OPENED|PAYMENT|PAST DUE|HIGH CREDIT|CREDIT LIMIT)/i.test(text);

  // Extended length buffer to avoid false positives on multi-line entries
  if (hasParenCode && !hasAccountFields && text.length < 120) return true;

  // Pure header lines (just a name, possibly with a code)
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length <= 2 && !hasAccountFields) return true;

  return false;
}

/**
 * Prepare text for per-tradeline AI analysis by segmenting into individual blocks.
 * Each block ideally contains ONE tradeline for maximum accuracy.
 * Falls back to size-based chunking if no anchors found.
 */
export function prepareTextChunks(fullText: string, maxChunkSize = 8000): string[] {
  const blocks = splitTradelines(fullText);

  // If no blocks found, fall back to size-based chunking
  if (blocks.length === 0) {
    const chunks: string[] = [];
    for (let i = 0; i < fullText.length; i += maxChunkSize) {
      chunks.push(fullText.slice(i, i + maxChunkSize));
    }
    return chunks.length > 0 ? chunks : [fullText];
  }

  // Filter out bureau headers first
  const realBlocks = blocks.filter(block => !isBureauHeader(block));
  if (realBlocks.length === 0) return [fullText];

  // Group small blocks together up to maxChunkSize
  const chunks: string[] = [];
  let currentChunk = '';

  for (const block of realBlocks) {
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

/**
 * Prepare text for per-tradeline AI analysis — returns one block per tradeline.
 * This is the highest-accuracy mode: each tradeline is parsed independently.
 */
export function preparePerTradelineChunks(fullText: string): string[] {
  const blocks = splitTradelines(fullText);
  if (blocks.length === 0) return [fullText];

  // Filter headers and return individual blocks
  return blocks.filter(block => !isBureauHeader(block));
}
