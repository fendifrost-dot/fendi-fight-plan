/**
 * Tradeline Segmenter — Splits extracted credit report text into
 * individual tradeline blocks BEFORE sending to AI for parsing.
 * 
 * This ensures the AI processes one tradeline at a time, preventing
 * header strings from being extracted as separate accounts.
 */

// Anchors that mark the start of a new tradeline block
const TRADELINE_BLOCK_ANCHORS = [
  'CREDITOR',
  'ACCOUNT NAME',
  'COMPANY NAME',
  'ACCOUNT NUMBER',
  'ACCOUNT #',
  'ACCT NO',
  'ACCT #',
  'ORIGINAL CREDITOR',
  'COLLECTION AGENCY',
  'LENDER',
  'LOAN NUMBER',
];

/**
 * Split raw credit report text into individual tradeline blocks.
 * Each block contains one tradeline's worth of data.
 * 
 * Returns empty array if no tradeline anchors are found (falls back to full-text).
 */
export function splitTradelines(text: string): string[] {
  if (!text || typeof text !== 'string' || text.trim().length === 0) return [];

  // Build a regex pattern from anchors
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

  const upper = text.toUpperCase();

  // Has a parenthetical code but no account data fields
  const hasParenCode = /\(\w{3,5}\)/.test(text);
  const hasAccountFields = /(?:BALANCE|STATUS|DATE OPENED|PAYMENT|PAST DUE|HIGH CREDIT|CREDIT LIMIT)/i.test(text);

  if (hasParenCode && !hasAccountFields && text.length < 100) return true;

  // Pure header lines (just a name, possibly with a code)
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length <= 2 && !hasAccountFields) return true;

  return false;
}

/**
 * Prepare text for chunked AI analysis by segmenting into tradeline blocks.
 * If segmentation yields blocks, returns them; otherwise returns the original text as a single chunk.
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

  // Group small blocks together up to maxChunkSize
  const chunks: string[] = [];
  let currentChunk = '';

  for (const block of blocks) {
    // Skip bureau headers
    if (isBureauHeader(block)) continue;

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
