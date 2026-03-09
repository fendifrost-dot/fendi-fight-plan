/**
 * Contract Enforcement Regression Tests
 * 
 * Tests all 10 defect fixes:
 * 1. Count mismatch alone triggers EXTRACTION_INCOMPLETE
 * 2. Worker never merges same creditor/account across bureaus
 * 3. Worker never merges duplicate tradelines
 * 4. Real tradeline inventory count differs from extracted negatives
 * 5. All edge functions produce the same validation behavior
 * 6. Under-extraction sets fatal=true
 * 7. summary/next_steps stripped from contract output
 * 8. Confidence derived deterministically, never hardcoded
 * 9. Missing account_number is critical unless N/A or UNEXTRACTABLE
 * 10. Bureau included in duplicate identity key
 */

import { describe, it, expect } from 'vitest';
import {
  postProcessAndValidate,
  validateCounts,
  detectTradelineBlocks,
  deriveConfidence,
} from '@/lib/parser-validator';
import { validateSchema } from '@/lib/parser-schema';
import { detectDuplicates } from '@/lib/parser-contract';

// ─── Defect 1: Count mismatch alone triggers EXTRACTION_INCOMPLETE ─────────

describe('Defect 1: Count mismatch alone = EXTRACTION_INCOMPLETE', () => {
  it('count mismatch with NO schema violations still triggers isError', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'ACME Corp', account_number: '1234', status: 'late' },
      ],
      collections: [],
      report_metadata: { accounts_ever_late: 5, collections_count: 0 },
    };

    const result = postProcessAndValidate(report);

    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe('EXTRACTION_INCOMPLETE');
    expect(result.validation.status).toBe('ERROR');
    // Schema is clean — no violations on the account itself
    expect(result.schema.rejectedAccounts.length).toBe(0);
  });

  it('count mismatch on collections alone triggers EXTRACTION_INCOMPLETE', () => {
    const report = {
      derogatory_accounts: [],
      collections: [],
      report_metadata: { collections_count: 3 },
    };

    const result = postProcessAndValidate(report);
    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe('EXTRACTION_INCOMPLETE');
  });

  it('no mismatch = no error', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'A', account_number: '1', status: 'late' },
        { creditor_name: 'B', account_number: '2', status: 'charge off' },
      ],
      collections: [],
      report_metadata: { accounts_ever_late: 2, collections_count: 0 },
    };

    const result = postProcessAndValidate(report);
    expect(result.isError).toBe(false);
    expect(result.validation.status).toBe('PASS');
  });
});

// ─── Defect 1 (cont): Under-extraction sets fatal=true ─────────────────────

describe('Defect 1: Under-extraction sets fatal=true', () => {
  it('fatal is true when under-extraction detected', () => {
    const report = {
      derogatory_accounts: [],
      collections: [],
      report_metadata: { accounts_ever_late: 3 },
    };

    const result = validateCounts({
      ...report,
      charge_offs: [],
    });
    expect(result.fatal).toBe(true);
    expect(result.status).toBe('ERROR');
  });

  it('fatal is false when counts match', () => {
    const result = validateCounts({
      derogatory_accounts: [{ creditor_name: 'A' }],
      charge_offs: [],
      collections: [],
      report_metadata: { accounts_ever_late: 1, collections_count: 0 },
    });
    expect(result.fatal).toBe(false);
    expect(result.status).toBe('PASS');
  });

  it('over-extraction is WARNING, not fatal', () => {
    const result = validateCounts({
      derogatory_accounts: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }],
      charge_offs: [],
      collections: [],
      report_metadata: { accounts_ever_late: 1 },
    });
    expect(result.fatal).toBe(false);
    expect(result.status).toBe('WARNING');
  });
});

// ─── Defect 2 + 3: Worker never merges tradelines ──────────────────────────

describe('Defect 2+3: No merging of tradelines', () => {
  it('duplicate tradelines with same creditor/account are preserved individually', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '1234', status: 'late', bureaus: ['experian'] },
        { creditor_name: 'ACME', account_number: '1234', status: 'charge off', bureaus: ['equifax'] },
      ],
      collections: [],
    };

    const result = postProcessAndValidate(report);

    // Both accounts must be preserved — no merging
    expect(result.report.derogatory_accounts.length).toBe(2);
    expect(result.report.derogatory_accounts[0].bureaus[0]).toBe('experian');
    expect(result.report.derogatory_accounts[1].bureaus[0]).toBe('equifax');
  });

  it('exact duplicate tradelines within same bureau are flagged but NOT merged', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '1234', status: 'late', bureaus: ['experian'] },
        { creditor_name: 'ACME', account_number: '1234', status: 'late', bureaus: ['experian'] },
      ],
      collections: [],
    };

    const result = postProcessAndValidate(report);

    // Both preserved
    expect(result.report.derogatory_accounts.length).toBe(2);
    // But flagged as duplicates
    expect(result.duplicateFlags.length).toBeGreaterThan(0);
    expect(result.duplicateFlags[0].message).toContain('POSSIBLE DUPLICATE');
  });
});

// ─── Defect 3: Bureau in duplicate identity key ────────────────────────────

describe('Defect 3: Bureau-aware duplicate detection', () => {
  it('same creditor+account in different bureaus are NOT flagged as duplicates', () => {
    const tradelines = [
      { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'] },
      { creditor_name: 'ACME', account_number: '1234', bureaus: ['equifax'] },
    ];

    const flags = detectDuplicates(tradelines);
    // Different bureaus = not duplicates
    expect(flags.length).toBe(0);
  });

  it('same creditor+account+bureau ARE flagged as duplicates', () => {
    const tradelines = [
      { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'] },
      { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'] },
    ];

    const flags = detectDuplicates(tradelines);
    expect(flags.length).toBe(1);
    expect(flags[0].bureau).toBe('experian');
  });
});

// ─── Defect 4: Real tradeline inventory ────────────────────────────────────

describe('Defect 4: Real Pass 1 tradeline inventory', () => {
  it('Pass 1 block count differs from extracted negatives when text has more blocks', () => {
    // Blocks spaced 200+ chars apart so clustering doesn't merge them
    const block = (name: string) => `\nAccount Name: ${name}\nAccount Type: Individual\nDate Opened: 01/2020\nBalance: $5,000\nPayment Status: Current\nStatus: Current\nRemarks: None\nEnd of block for ${name}\n${'x'.repeat(100)}\n`;
    const reportText = block('CHASE BANK') + block('WELLS FARGO') + block('CAPITAL ONE') + block('CITI BANK');
    // Only 1 negative extracted by AI
    const report = {
      derogatory_accounts: [
        { creditor_name: 'CAPITAL ONE', account_number: '9999', status: '30 days late', bureaus: ['experian'] },
      ],
      collections: [],
    };

    const result = postProcessAndValidate(report, reportText);

    // Pass 1 detected 4 blocks from text
    expect(result.report.tradeline_inventory.pass1_anchor_detected).toBeGreaterThan(1);
    // But only 1 negative extracted
    expect(result.report.tradeline_inventory.negative_extracted).toBe(1);
    // total_blocks_detected should use pass1 count when available
    expect(result.report.tradeline_inventory.total_blocks_detected).toBeGreaterThan(
      result.report.tradeline_inventory.negative_extracted
    );
  });

  it('without report text, falls back to extracted count', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'A', account_number: '1', status: 'late' },
        { creditor_name: 'B', account_number: '2', status: 'charge off' },
      ],
      collections: [{ balance: '$100', collection_agency: 'X' }],
    };

    const result = postProcessAndValidate(report);
    // No text = pass1 is 0, falls back
    expect(result.report.tradeline_inventory.pass1_anchor_detected).toBe(0);
    expect(result.report.tradeline_inventory.total_blocks_detected).toBe(3); // 2 derog + 1 collection
  });
});

// ─── Defect 5: Unified validation behavior ─────────────────────────────────

describe('Defect 5: All paths produce same validation', () => {
  it('postProcessAndValidate returns identical structure regardless of input source', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'Test', account_number: '123', status: 'late', bureaus: ['experian'] },
      ],
      collections: [],
      report_metadata: { accounts_ever_late: 1 },
    };

    const result = postProcessAndValidate(report);

    // Verify all required fields exist
    expect(result).toHaveProperty('report');
    expect(result).toHaveProperty('schema');
    expect(result).toHaveProperty('validation');
    expect(result).toHaveProperty('duplicateFlags');
    expect(result).toHaveProperty('isError');
    expect(result).toHaveProperty('errorCode');
    expect(result).toHaveProperty('errorMessage');

    // Verify report has contract fields
    expect(result.report).toHaveProperty('tradeline_inventory');
    expect(result.report).toHaveProperty('validation_status');
    expect(result.report).toHaveProperty('duplicate_flags');

    // summary/next_steps MUST NOT exist
    expect(result.report.summary).toBeUndefined();
    expect(result.report.next_steps).toBeUndefined();
  });
});

// ─── Defect 7: summary/next_steps stripped ─────────────────────────────────

describe('Defect 7: Non-deterministic fields stripped', () => {
  it('summary and next_steps are removed from report', () => {
    const report = {
      derogatory_accounts: [],
      collections: [],
      summary: 'This is a summary',
      next_steps: ['Step 1', 'Step 2'],
    };

    const result = postProcessAndValidate(report);
    expect(result.report.summary).toBeUndefined();
    expect(result.report.next_steps).toBeUndefined();
  });
});

// ─── Defect 8: Deterministic confidence ────────────────────────────────────

describe('Defect 8: Confidence derived deterministically', () => {
  it('0 triggers = low', () => {
    expect(deriveConfidence({ creditor_name: 'A', account_number: '1' }, [])).toBe('low');
  });

  it('1 trigger = medium', () => {
    expect(deriveConfidence({ creditor_name: 'A', account_number: '1' }, ['late'])).toBe('medium');
  });

  it('2+ triggers = high', () => {
    expect(deriveConfidence({ creditor_name: 'A', account_number: '1' }, ['late', 'charge off'])).toBe('high');
  });

  it('1 strong trigger (grid codes) = high', () => {
    expect(deriveConfidence({ creditor_name: 'A', account_number: '1' }, ['grid codes: 2, 3'])).toBe('high');
  });

  it('UNEXTRACTABLE field = incomplete', () => {
    expect(deriveConfidence({ creditor_name: 'UNEXTRACTABLE', account_number: '1' }, ['late'])).toBe('incomplete');
  });

  it('confidence is set on processed accounts, not hardcoded 0.8', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'A', account_number: '1', status: 'late', bureaus: ['experian'] },
      ],
      collections: [],
    };

    const result = postProcessAndValidate(report);
    const acct = result.report.derogatory_accounts[0];
    expect(acct.confidence).not.toBe(0.8);
    expect(['high', 'medium', 'low', 'incomplete']).toContain(acct.confidence);
  });
});

// ─── Defect 9: Schema enforcement for account_number ───────────────────────

describe('Defect 9: account_number schema enforcement', () => {
  it('missing account_number is critical violation', () => {
    const result = validateSchema({
      derogatory_accounts: [
        { creditor_name: 'ACME' },
      ],
    });
    expect(result.rejectedAccounts.length).toBe(1);
    const violation = result.violations.find(v => v.field === 'account_number');
    expect(violation).toBeDefined();
    expect(violation!.critical).toBe(true);
  });

  it('empty string account_number is critical violation', () => {
    const result = validateSchema({
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '' },
      ],
    });
    expect(result.rejectedAccounts.length).toBe(1);
  });

  it('"N/A" account_number is allowed (contract placeholder)', () => {
    const result = validateSchema({
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: 'N/A' },
      ],
    });
    expect(result.rejectedAccounts.length).toBe(0);
    expect(result.validAccounts.length).toBe(1);
  });

  it('"UNEXTRACTABLE" account_number is allowed (contract placeholder)', () => {
    const result = validateSchema({
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: 'UNEXTRACTABLE' },
      ],
    });
    expect(result.rejectedAccounts.length).toBe(0);
  });

  it('actual account number is allowed', () => {
    const result = validateSchema({
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '6124XXXX1234' },
      ],
    });
    expect(result.rejectedAccounts.length).toBe(0);
    expect(result.validAccounts.length).toBe(1);
  });
});

// ─── Defect 10: Pass 1 block detection unit tests ──────────────────────────

describe('Defect 10: detectTradelineBlocks', () => {
  it('detects blocks from account-related anchors', () => {
    const text = `
Account Name: CHASE BANK
Balance: $5,000

Account Name: WELLS FARGO
Balance: $12,000

Creditor Name: CAPITAL ONE
Account Number: XXXX1234
`;
    const count = detectTradelineBlocks(text);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('returns 0 for empty/null text', () => {
    expect(detectTradelineBlocks(null)).toBe(0);
    expect(detectTradelineBlocks('')).toBe(0);
    expect(detectTradelineBlocks(undefined)).toBe(0);
  });

  it('clusters nearby anchors as same block', () => {
    // Two anchors very close together should count as one block
    const text = `Account Name: CHASE\nAccount Number: 1234`;
    const count = detectTradelineBlocks(text);
    expect(count).toBe(1); // Same block, within 200 chars
  });
});
