// Anchors for identifying tradeline block boundaries
// These patterns mark the start of a new tradeline or inquiry
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
  'INQUIRY',
  'INQUIRY DATE',
];

/**
 * Splits text into tradeline blocks based on anchor patterns
 * Also handles inquiry sections which may be formatted differently
 */
function splitTradelines(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Build regex from TRADELINE_BLOCK_ANCHORS
  const anchorsPattern = TRADELINE_BLOCK_ANCHORS.map((anchor) =>
    anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ).join('|');

  const blockRegex = new RegExp(`^(?:${anchorsPattern})(?:\\s|$)`, 'im');

  // Also split on explicit inquiry numbering patterns
  const inquiryRegex = /^\s*Inquiry\s+\d+/im;

  let blocks: string[] = [];
  let currentBlock = '';

  const lines = text.split('\n');

  for (const line of lines) {
    // Check if this line starts a new inquiry block
    if (inquiryRegex.test(line)) {
      if (currentBlock.trim().length > 0) {
        blocks.push(currentBlock.trim());
      }
      currentBlock = line;
    }
    // Check if this line starts a new tradeline block
    else if (blockRegex.test(line)) {
      if (currentBlock.trim().length > 0) {
        blocks.push(currentBlock.trim());
      }
      currentBlock = line;
    }
    // Otherwise, append to current block
    else {
      if (currentBlock.length > 0) {
        currentBlock += '\n' + line;
      } else {
        currentBlock = line;
      }
    }
  }

  // Don't forget the last block
  if (currentBlock.trim().length > 0) {
    blocks.push(currentBlock.trim());
  }

  return blocks;
}

/**
 * Determines if a block is a bureau header (metadata) rather than account data
 */
function isBureauHeader(text: string): boolean {
  // Very short text is likely a header
  if (text.length < 10) {
    return true;
  }

  // Check for parenthetical codes like (ABC), (DEFGH)
  const hasParenCode = /\(\w{3,5}\)/.test(text);

  // Check for account-specific fields that indicate real account data
  const hasAccountFields = /(?:ACCOUNT\s*#|ACCOUNT\s*NUMBER|BALANCE|STATUS|MONTHLY\s*PAYMENT|OPENED|REPORTED)/i.test(text);

  // If it has a paren code but no account fields and is short, it's a header
  if (hasParenCode && !hasAccountFields && text.length < 120) {
    return true;
  }

  // If it's 2 or fewer lines with no account fields, likely a header
  const lineCount = text.split('\n').length;
  if (lineCount <= 2 && !hasAccountFields) {
    return true;
  }

  return false;
}

/**
 * Determines if a block looks like a tradeline (account information)
 */
function looksLikeTradeline(block: string): boolean {
  const tradelinePattern = /account\s*number|account\s*#|acct\s*#|balance|status|monthly\s*payment|opened|reported|creditor|lender/i;
  return tradelinePattern.test(block);
}

/**
 * Determines if a block looks like an inquiry record
 */
function looksLikeInquiry(block: string): boolean {
  const inquiryPattern = /inquiry\s*date|creditor\s*name.*creditor\s*phone|inquiry\s+\d+/i;
  return inquiryPattern.test(block);
}

/**
 * Merges orphan creditor headers with their following account data
 * Sometimes creditor information appears separated from account details
 */
function mergeOrphanTradelineBlocks(blocks: string[]): string[] {
  if (blocks.length === 0) {
    return [];
  }

  const merged: string[] = [];
  let i = 0;

  while (i < blocks.length) {
    const currentBlock = blocks[i];

    // Check if current block is a creditor header (starts with CREDITOR but has no account data)
    const isCreditorHeader =
      /^CREDITOR\s*NAME|^ORIGINAL\s*CREDITOR|^COLLECTION\s*AGENCY|^LENDER/i.test(currentBlock) &&
      !/account\s*number|balance|status/i.test(currentBlock) &&
      currentBlock.split('\n').length <= 3;

    // If it is, and there's a next block that looks like account data, merge them
    if (isCreditorHeader && i + 1 < blocks.length && looksLikeTradeline(blocks[i + 1])) {
      merged.push(`${currentBlock}\n${blocks[i + 1]}`);
      i += 2;
    } else {
      merged.push(currentBlock);
      i += 1;
    }
  }

  return merged;
}

/**
 * Extracts deterministic fields from a tradeline or inquiry block
 */
function extractDeterministicFields(block: string): Record<string, string | null> {
  const fields: Record<string, string | null> = {
    account_number: null,
    balance: null,
    date_opened: null,
    status: null,
    inquiry_date: null,
    creditor_name: null,
  };

  // Extract account number
  const accountNumMatch = block.match(/account\s*(?:number|#|no)[\s:]*([A-Za-z0-9\-*]+)/i);
  if (accountNumMatch) {
    fields.account_number = accountNumMatch[1].trim();
  }

  // Extract balance
  const balanceMatch = block.match(/balance[\s:]*\$?([\d,]+(?:\.\d{2})?)/i);
  if (balanceMatch) {
    fields.balance = balanceMatch[1].trim();
  }

  // Extract date opened
  const dateOpenedMatch = block.match(/(?:opened|date\s*opened|account\s*open)[\s:]*(\d{1,2}\/\d{1,2}\/\d{2,4}|\w+\s+\d{1,2},?\s+\d{4})/i);
  if (dateOpenedMatch) {
    fields.date_opened = dateOpenedMatch[1].trim();
  }

  // Extract status
  const statusMatch = block.match(/status[\s:]*([A-Za-z\s]+?)(?:\n|$)/i);
  if (statusMatch) {
    fields.status = statusMatch[1].trim();
  }

  // Extract inquiry date
  const inquiryDateMatch = block.match(/inquiry\s*date[\s:]*(\d{1,2}\/\d{1,2}\/\d{2,4}|\w+\s+\d{1,2},?\s+\d{4})/i);
  if (inquiryDateMatch) {
    fields.inquiry_date = inquiryDateMatch[1].trim();
  }

  // Extract creditor name (useful for both tradelines and inquiries)
  const creditorMatch = block.match(/(?:creditor|company|lender)\s*(?:name)?[\s:]*([A-Za-z\s&,]+?)(?:\n|$)/i);
  if (creditorMatch) {
    fields.creditor_name = creditorMatch[1].trim();
  }

  return fields;
}

/**
 * Prepares text chunks for further processing
 * Handles segmentation, filtering, and merging of tradeline and inquiry blocks
 */
function prepareTextChunks(fullText: string, maxChunkSize: number = 3000): string[] {
  // First pass: split into potential tradeline/inquiry blocks
  const blocks = splitTradelines(fullText);

  if (blocks.length === 0) {
    // Fallback: raw chunking if no blocks detected
    const chunks: string[] = [];
    for (let i = 0; i < fullText.length; i += maxChunkSize) {
      chunks.push(fullText.slice(i, i + maxChunkSize));
    }
    return chunks;
  }

  // Filter out bureau headers
  const nonHeaderBlocks = blocks.filter((block) => !isBureauHeader(block));

  // Merge orphan creditor headers with account data
  const mergedBlocks = mergeOrphanTradelineBlocks(nonHeaderBlocks);

  // Keep only blocks that look like tradelines OR inquiries
  const validBlocks = mergedBlocks.filter(
    (block) => looksLikeTradeline(block) || looksLikeInquiry(block)
  );

  if (validBlocks.length === 0) {
    // Fallback: raw chunking if no valid blocks found
    const chunks: string[] = [];
    for (let i = 0; i < fullText.length; i += maxChunkSize) {
      chunks.push(fullText.slice(i, i + maxChunkSize));
    }
    return chunks;
  }

  // Group blocks into chunks respecting maxChunkSize
  const chunks: string[] = [];
  let currentChunk = '';

  for (const block of validBlocks) {
    const blockSize = block.length;

    // If adding this block would exceed maxChunkSize, start a new chunk
    if (currentChunk.length > 0 && currentChunk.length + blockSize + 1 > maxChunkSize) {
      chunks.push(currentChunk);
      currentChunk = block;
    } else {
      if (currentChunk.length > 0) {
        currentChunk += '\n\n' + block;
      } else {
        currentChunk = block;
      }
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export {
  TRADELINE_BLOCK_ANCHORS,
  splitTradelines,
  isBureauHeader,
  looksLikeTradeline,
  looksLikeInquiry,
  mergeOrphanTradelineBlocks,
  extractDeterministicFields,
  prepareTextChunks,
};
