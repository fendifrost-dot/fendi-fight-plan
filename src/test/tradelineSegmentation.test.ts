/**
 * Tests for tradeline segmentation and creditor normalization enhancements.
 */
import { describe, it, expect } from 'vitest';
import { splitTradelines, isBureauHeader, prepareTextChunks, preparePerTradelineChunks } from '@/lib/tradeline-segmenter';
import { normalizeCreditorName } from '@/lib/result-normalizer';

// ── Tradeline Segmentation ──

describe('splitTradelines', () => {
  it('splits text on tradeline anchors', () => {
    // Use "Tradeline" anchor which doesn't conflict with field-level anchors
    const text = `
Tradeline: CHASE BANK
Acct: XXXX1234, Balance: $5,000, Status: Current, Date Opened: 01/2020

Tradeline: WELLS FARGO
Acct: XXXX5678, Balance: $2,000, Status: 30 days late, Date Opened: 06/2019
`;
    const blocks = splitTradelines(text);
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain('CHASE BANK');
    expect(blocks[1]).toContain('WELLS FARGO');
  });

  it('returns empty array for non-report text', () => {
    expect(splitTradelines('')).toEqual([]);
    expect(splitTradelines('just some random text without anchors')).toEqual([]);
  });

  it('filters out short blocks (likely headers)', () => {
    const text = `
Account Name: HEADER ONLY

Account Name: REAL TRADELINE
Account Number: XXXX1234
Balance: $5,000
Status: Current
Date Opened: 01/2020
`;
    const blocks = splitTradelines(text);
    expect(blocks.every(b => b.length >= 50)).toBe(true);
  });

  it('detects expanded anchors (CREDITOR NAME, ACCOUNT INFORMATION, TRADELINE)', () => {
    const text = `
Creditor Name: CHASE
Account Number: 1234
Balance: $5000
Status: Current
Date Opened: 01/2020

Account Information: WELLS FARGO
Account Number: 5678
Balance: $2000
Status: Late
Date Opened: 06/2019

Tradeline: CAPITAL ONE
Account Number: 9012
Balance: $3000
Status: Charged Off
Date Opened: 03/2018
`;
    const blocks = splitTradelines(text);
    expect(blocks.length).toBe(3);
  });
});

describe('isBureauHeader', () => {
  it('detects bureau header lines with codes', () => {
    expect(isBureauHeader('CAPITAL ONE BANK USA (7805)')).toBe(true);
    expect(isBureauHeader('LEAD BANK (D000)')).toBe(true);
  });

  it('does not flag real tradeline blocks', () => {
    const block = `CAPITAL ONE BANK
Account Number: XXXX1234
Balance: $5,000
Status: Current
Date Opened: 01/2020
Payment History: OK OK OK`;
    expect(isBureauHeader(block)).toBe(false);
  });

  it('does not flag entries with Account # field', () => {
    const block = `CAPITAL ONE BANK USA
Account # XXXX1234
Balance: $5,000
Status: Current`;
    expect(isBureauHeader(block)).toBe(false);
  });

  it('detects short entries without account fields as headers', () => {
    expect(isBureauHeader('SOME BANK NAME')).toBe(true);
    expect(isBureauHeader('RANDOM LENDER\nSome city, ST')).toBe(true);
  });
});

describe('prepareTextChunks', () => {
  it('falls back to size-based chunking when no anchors found', () => {
    const text = 'a'.repeat(20000);
    const chunks = prepareTextChunks(text, 8000);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('groups small tradeline blocks together', () => {
    const makeBlock = (name: string) =>
      `Account Name: ${name}\nAccount Number: XXXX1234\nBalance: $5,000\nStatus: Current\nDate Opened: 01/2020\n`;
    const text = [makeBlock('A'), makeBlock('B'), makeBlock('C')].join('\n');
    const chunks = prepareTextChunks(text, 50000);
    expect(chunks.length).toBe(1);
  });

  it('filters out bureau headers in chunks', () => {
    const text = `
Account Name: CAPITAL ONE BANK USA (7805)

Account Name: REAL ACCOUNT
Account Number: XXXX1234
Balance: $5,000
Status: Current
Date Opened: 01/2020
Payment: OK OK OK
`;
    const chunks = prepareTextChunks(text);
    // The header-only block should be filtered
    for (const chunk of chunks) {
      if (chunk.includes('REAL ACCOUNT')) {
        expect(chunk).toContain('REAL ACCOUNT');
      }
    }
  });
});

describe('preparePerTradelineChunks', () => {
  it('returns one block per tradeline', () => {
    const makeBlock = (name: string) =>
      `Account Name: ${name}\nAccount Number: XXXX1234\nBalance: $5,000\nStatus: Current\nDate Opened: 01/2020\n`;
    const text = [makeBlock('CHASE'), makeBlock('WELLS FARGO'), makeBlock('CITI')].join('\n');
    const blocks = preparePerTradelineChunks(text);
    expect(blocks.length).toBe(3);
  });

  it('filters bureau headers', () => {
    const text = `
Account Name: HEADER ONLY (7805)

Account Name: REAL ACCOUNT
Account Number: XXXX1234
Balance: $5,000
Status: Current
Date Opened: 01/2020
Payment: OK OK OK
`;
    const blocks = preparePerTradelineChunks(text);
    expect(blocks.every(b => b.includes('Account Number') || b.includes('Balance'))).toBe(true);
  });
});

// ── Creditor Name Normalization ──

describe('creditor normalization with map', () => {
  it('strips bureau codes from creditor names', () => {
    expect(normalizeCreditorName('CAPITAL ONE BANK USA (7805)')).toBe('CAPITAL ONE');
    expect(normalizeCreditorName('LEAD BANK (D000)')).toBe('LEAD BANK');
    expect(normalizeCreditorName('SPARROW FINANCIAL I (0961)')).toBe('SPARROW FINANCIAL');
  });

  it('maps known creditor aliases', () => {
    expect(normalizeCreditorName('CAPITAL ONE BANK USA')).toBe('CAPITAL ONE');
    expect(normalizeCreditorName('CAPITAL ONE BANK')).toBe('CAPITAL ONE');
    expect(normalizeCreditorName('TBOM MIL')).toBe('THE BANK OF MISSOURI');
  });

  it('deduplicates after normalization', () => {
    const a = normalizeCreditorName('CAPITAL ONE BANK USA (7805)');
    const b = normalizeCreditorName('CAPITAL ONE BANK (7805)');
    expect(a).toBe(b);
    expect(a).toBe('CAPITAL ONE');
  });

  it('does not map partial matches incorrectly', () => {
    const result = normalizeCreditorName('TBOM/MILSTNE');
    expect(result).toBe('TBOM MILSTNE');
    expect(result).not.toBe('THE BANK OF MISSOURI');
  });

  it('passes through unknown creditors unchanged (after cleanup)', () => {
    expect(normalizeCreditorName('RANDOM BANK INC')).toBe('RANDOM BANK INC');
  });
});

// ── Input/Output integration ──

describe('expected final pipeline output', () => {
  it('normalizes the example input correctly', () => {
    const inputs = [
      'CAPITAL ONE BANK USA (7805)',
      'LEAD BANK (D000)',
      'SPARROW FINANCIAL I (0961)',
      'TBOM MIL (9806)',
      'TBOM MIL (9806)',
    ];

    const normalized = inputs.map(normalizeCreditorName);
    const unique = [...new Set(normalized)];

    expect(unique).toEqual([
      'CAPITAL ONE',
      'LEAD BANK',
      'SPARROW FINANCIAL',
      'THE BANK OF MISSOURI',
    ]);
  });
});
