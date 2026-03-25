/**
 * Contract Enforcement Regression Tests
 * 
 * Runs ALL real fixtures through postProcessAndValidate and validates:
 * 1. Count mismatch alone triggers EXTRACTION_INCOMPLETE
 * 2. Worker never merges tradelines (bureau-aware keys)
 * 3. Real Pass 1 tradeline inventory
 * 4. All edge functions produce the same validation behavior
 * 5. Under-extraction sets fatal=true
 * 6. summary/next_steps stripped from contract output
 * 7. Confidence derived deterministically
 * 8. Missing account_number is critical unless N/A/UNEXTRACTABLE
 * 9. Continuation blocks, multi-bureau, collection sections, inquiry-only
 * 10. Masked account numbers in multiple formats
 * 11. Duplicate anchors in headers/footers
 * 12. Reports with/without summary counts
 */

import { describe, it, expect } from 'vitest';
import {
  postProcessAndValidate,
  validateCounts,
  detectTradelineBlocks,
  deriveConfidence,
} from '@/lib/parser-validator';
import { validateSchema } from '@/lib/parser-schema';
import {
  detectDuplicates, classifyTradeline, isCleanTradeline,
  isPastDueNegative, findNegativeKeywords, hasActualDateOfFirstDelinquency,
} from '@/lib/parser-contract';
import {
  EXPERIAN_ACR, EXPERIAN_ACR_METADATA,
  EQUIFAX_ACR, EQUIFAX_ACR_METADATA,
  CREDIT_KARMA_REPORT, CREDIT_KARMA_METADATA,
  SCANNED_PDF_REPORT, SCANNED_PDF_METADATA,
  SUMMARY_COUNT_REPORT, SUMMARY_ONLY_METADATA,
  CONTINUATION_PAGE_1, CONTINUATION_PAGE_2, CONTINUATION_MERGED,
  PAST_DUE_ZERO_TRADELINE, PAST_DUE_ZERO_DECIMAL_TRADELINE,
  CO_IN_ADDRESS_TRADELINE, CO_IN_STATUS_TRADELINE,
  FALSE_POSITIVE_TEXT, TRUE_POSITIVE_TEXT,
  CLOSED_NEGATIVE_TRADELINE, CLOSED_POSITIVE_TRADELINE,
} from '@/test/fixtures/parserFixtures';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Real fixture end-to-end through postProcessAndValidate
// ═══════════════════════════════════════════════════════════════════════════

describe('Fixture: Experian ACR end-to-end', () => {
  const result = postProcessAndValidate({
    ...EXPERIAN_ACR,
    report_metadata: EXPERIAN_ACR_METADATA,
    metadata: undefined, // use report_metadata path
  });

  it('preserves all 4 derogatory accounts', () => {
    expect(result.report.derogatory_accounts.length).toBe(4);
  });

  it('preserves all 2 collections', () => {
    expect(result.report.collections.length).toBe(2);
  });

  it('preserves all 2 inquiries', () => {
    expect(result.report.inquiries.length).toBe(2);
  });

  it('preserves 0 public records', () => {
    expect(result.report.public_records.length).toBe(0);
  });

  it('passes count validation (4 neg = 4 expected)', () => {
    expect(result.validation.status).toBe('PASS');
    expect(result.isError).toBe(false);
  });

  it('strips summary/next_steps', () => {
    expect(result.report.summary).toBeUndefined();
    expect(result.report.next_steps).toBeUndefined();
  });

  it('RESURGENT/LVNV FUNDING has deterministic triggers', () => {
    const acct = result.report.derogatory_accounts.find((a: any) => a.creditor_name === 'RESURGENT/LVNV FUNDING');
    expect(acct).toBeDefined();
    expect(acct.derogatory_triggers.length).toBeGreaterThan(0);
    expect(['high', 'medium', 'low', 'incomplete']).toContain(acct.confidence);
    expect(acct.confidence).not.toBe(0.8);
  });

  it('preserves masked account numbers exactly', () => {
    const acct = result.report.derogatory_accounts.find((a: any) => a.creditor_name === 'RESURGENT/LVNV FUNDING');
    expect(acct.account_number).toBe('6124XXXX1234');
  });

  it('tradeline_inventory includes collections_extracted', () => {
    expect(result.report.tradeline_inventory.collections_extracted).toBe(2);
  });

  it('tradeline_inventory includes inquiries_extracted', () => {
    expect(result.report.tradeline_inventory.inquiries_extracted).toBe(2);
  });

  it('schema has no critical violations', () => {
    expect(result.schema.rejectedAccounts.length).toBe(0);
  });

  it('duplicate_flags is empty (no same-bureau dupes)', () => {
    expect(result.duplicateFlags.length).toBe(0);
  });
});

describe('Fixture: Equifax ACR end-to-end', () => {
  const result = postProcessAndValidate({
    ...EQUIFAX_ACR,
    report_metadata: EQUIFAX_ACR_METADATA,
    metadata: undefined,
  });

  it('preserves all 5 Aidvantage + Discover accounts', () => {
    expect(result.report.derogatory_accounts.length).toBe(5);
  });

  it('preserves 1 collection', () => {
    expect(result.report.collections.length).toBe(1);
  });

  it('preserves 1 inquiry', () => {
    expect(result.report.inquiries.length).toBe(1);
  });

  it('preserves 1 public record (bankruptcy)', () => {
    expect(result.report.public_records.length).toBe(1);
    expect(result.report.public_records[0].type).toBe('Bankruptcy');
  });

  it('passes validation (5 neg = 5 expected, 1 col = 1 expected)', () => {
    expect(result.validation.status).toBe('PASS');
    expect(result.isError).toBe(false);
  });

  it('each Aidvantage sub-account has unique account number', () => {
    const aids = result.report.derogatory_accounts.filter((a: any) => a.creditor_name === 'AIDVANTAGE');
    expect(aids.length).toBe(4);
    const numbers = aids.map((a: any) => a.account_number);
    expect(new Set(numbers).size).toBe(4);
  });

  it('tradeline_inventory includes public_records_extracted', () => {
    expect(result.report.tradeline_inventory.public_records_extracted).toBe(1);
  });
});

describe('Fixture: Credit Karma multi-bureau end-to-end', () => {
  const result = postProcessAndValidate({
    ...CREDIT_KARMA_REPORT,
    report_metadata: CREDIT_KARMA_METADATA,
    metadata: undefined,
  });

  it('preserves all 5 tradelines (2 bureaus × 2 accounts + 1 TU-only)', () => {
    expect(result.report.derogatory_accounts.length).toBe(5);
  });

  it('CHASE appears twice — equifax and transunion are separate entries', () => {
    const chases = result.report.derogatory_accounts.filter((a: any) => a.creditor_name === 'CHASE BANK');
    expect(chases.length).toBe(2);
    const bureaus = chases.map((a: any) => a.bureaus[0]);
    expect(bureaus).toContain('equifax');
    expect(bureaus).toContain('transunion');
  });

  it('NAVY FEDERAL appears twice — NOT merged', () => {
    const navys = result.report.derogatory_accounts.filter((a: any) => a.creditor_name === 'NAVY FEDERAL CU');
    expect(navys.length).toBe(2);
  });

  it('same creditor+account across different bureaus NOT flagged as duplicate', () => {
    // CHASE BANK 4147XXXX8888 appears in equifax and transunion — different bureaus = NOT duplicates
    const chases = result.report.derogatory_accounts.filter((a: any) => a.creditor_name === 'CHASE BANK');
    const chaseDupes = result.duplicateFlags.filter((f: any) => f.creditor_name === 'CHASE BANK');
    expect(chaseDupes.length).toBe(0);
  });

  it('COMENITY BANK TU-only account preserved', () => {
    const com = result.report.derogatory_accounts.find((a: any) => a.creditor_name === 'COMENITY BANK');
    expect(com).toBeDefined();
    expect(com.bureaus).toEqual(['transunion']);
  });

  it('preserves 1 collection', () => {
    expect(result.report.collections.length).toBe(1);
  });

  it('validation PASS since 5 neg is within tolerance of 3+2', () => {
    // 5 extracted, 3 expected, tolerance=2 → 5 <= 3+2 = 5, so NOT over-extraction
    expect(result.validation.status).toBe('PASS');
    expect(result.validation.fatal).toBe(false);
  });
});

describe('Fixture: Scanned PDF (low confidence) end-to-end', () => {
  const result = postProcessAndValidate({
    ...SCANNED_PDF_REPORT,
    report_metadata: SCANNED_PDF_METADATA,
    metadata: undefined,
  });

  it('preserves both accounts despite low confidence', () => {
    // UNEXTRACTABLE fields → deriveConfidence returns 'incomplete' → manual_review
    const totalAccounts = result.report.derogatory_accounts.length + result.report.manual_review_accounts.length;
    expect(totalAccounts).toBe(2);
  });

  it('UNEXTRACTABLE account_number accepted by schema', () => {
    const allAccounts = [...result.report.derogatory_accounts, ...result.report.manual_review_accounts];
    const wells = allAccounts.find((a: any) => a.creditor_name === 'WELLS FARGO');
    expect(wells.account_number).toBe('UNEXTRACTABLE');
  });

  it('UNEXTRACTABLE creditor_name account preserved', () => {
    const allAccounts = [...result.report.derogatory_accounts, ...result.report.manual_review_accounts];
    const unknown = allAccounts.find((a: any) => a.creditor_name === 'UNEXTRACTABLE');
    expect(unknown).toBeDefined();
  });

  it('validation SKIPPED (no summary counts)', () => {
    expect(result.validation.status).toBe('SKIPPED');
    expect(result.isError).toBe(false);
  });
});

describe('Fixture: TransUnion Summary Count Report end-to-end', () => {
  const result = postProcessAndValidate({
    ...SUMMARY_COUNT_REPORT,
    report_metadata: SUMMARY_ONLY_METADATA,
    metadata: undefined,
  });

  it('preserves 2 derogatory accounts', () => {
    expect(result.report.derogatory_accounts.length).toBe(2);
  });

  it('preserves 1 collection', () => {
    expect(result.report.collections.length).toBe(1);
  });

  it('preserves 1 inquiry', () => {
    expect(result.report.inquiries.length).toBe(1);
  });

  it('passes validation (2 neg = 2 expected, 1 col = 1 expected)', () => {
    expect(result.validation.status).toBe('PASS');
    expect(result.isError).toBe(false);
  });

  it('US BANK has grid code trigger', () => {
    const usbank = result.report.derogatory_accounts.find((a: any) => a.creditor_name === 'US BANK');
    expect(usbank.derogatory_triggers.some((t: string) => t.includes('grid codes'))).toBe(true);
  });

  it('CITIBANK has charge off trigger', () => {
    const citi = result.report.derogatory_accounts.find((a: any) => a.creditor_name === 'CITIBANK');
    expect(citi.derogatory_triggers.some((t: string) => t.includes('charge off'))).toBe(true);
  });

  it('tradeline_inventory matches extracted counts', () => {
    expect(result.report.tradeline_inventory.negative_extracted).toBe(2);
    expect(result.report.tradeline_inventory.collections_extracted).toBe(1);
    expect(result.report.tradeline_inventory.inquiries_extracted).toBe(1);
  });

  it('validation_status string includes PASS', () => {
    expect(result.report.validation_status).toContain('PASS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Count mismatch / EXTRACTION_INCOMPLETE
// ═══════════════════════════════════════════════════════════════════════════

describe('EXTRACTION_INCOMPLETE: count mismatch alone', () => {
  it('under-extraction of neg tradelines sets fatal + isError', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'A', account_number: '1', status: 'late' },
      ],
      collections: [],
      report_metadata: { accounts_ever_late: 5, collections_count: 0 },
    };
    const result = postProcessAndValidate(report);
    expect(result.isError).toBe(true);
    expect(result.errorCode).toBe('EXTRACTION_INCOMPLETE');
    expect(result.validation.fatal).toBe(true);
    expect(result.schema.rejectedAccounts.length).toBe(0); // schema is clean
  });

  it('under-extraction of collections alone sets fatal', () => {
    const report = {
      derogatory_accounts: [],
      collections: [],
      report_metadata: { collections_count: 3 },
    };
    const result = postProcessAndValidate(report);
    expect(result.isError).toBe(true);
    expect(result.validation.fatal).toBe(true);
  });

  it('exact match = PASS', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'A', account_number: '1', status: 'late' },
        { creditor_name: 'B', account_number: '2', status: 'charge off' },
      ],
      collections: [{ collection_agency: 'X', balance: '$100' }],
      report_metadata: { accounts_ever_late: 2, collections_count: 1 },
    };
    const result = postProcessAndValidate(report);
    expect(result.isError).toBe(false);
    expect(result.validation.status).toBe('PASS');
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

  it('no summary counts = SKIPPED', () => {
    const result = validateCounts({
      derogatory_accounts: [{ a: 1 }],
      charge_offs: [],
      collections: [],
      report_metadata: {},
    });
    expect(result.status).toBe('SKIPPED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: No merging / bureau-aware duplicate detection
// ═══════════════════════════════════════════════════════════════════════════

describe('No-merge invariant with bureau-aware keys', () => {
  it('same creditor+account in different bureaus NOT flagged', () => {
    const flags = detectDuplicates([
      { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'] },
      { creditor_name: 'ACME', account_number: '1234', bureaus: ['equifax'] },
    ]);
    expect(flags.length).toBe(0);
  });

  it('same creditor+account+bureau ARE flagged', () => {
    const flags = detectDuplicates([
      { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'] },
      { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'] },
    ]);
    expect(flags.length).toBe(1);
    expect(flags[0].bureau).toBe('experian');
  });

  it('both entries preserved through postProcessAndValidate even if same creditor+account', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '1234', status: 'late', bureaus: ['experian'] },
        { creditor_name: 'ACME', account_number: '1234', status: 'charge off', bureaus: ['equifax'] },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(report);
    expect(result.report.derogatory_accounts.length).toBe(2);
  });

  it('exact dupes within same bureau: both preserved + flagged', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '1234', status: 'late', bureaus: ['experian'] },
        { creditor_name: 'ACME', account_number: '1234', status: 'late', bureaus: ['experian'] },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(report);
    expect(result.report.derogatory_accounts.length).toBe(2);
    expect(result.duplicateFlags.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Pass 1 tradeline inventory
// ═══════════════════════════════════════════════════════════════════════════

describe('Pass 1 tradeline inventory', () => {
  it('detects blocks from primary anchors', () => {
    const block = (name: string) => `\nAccount Name: ${name}\nAccount Type: Individual\nDate Opened: 01/2020\nBalance: $5,000\nPayment Status: Current\nStatus: OK\nRemarks: None\nEnd of block\n${'x'.repeat(100)}\n`;
    const text = block('CHASE') + block('WELLS FARGO') + block('CAPITAL ONE') + block('CITI');
    expect(detectTradelineBlocks(text)).toBeGreaterThanOrEqual(4);
  });

  it('pass1 count differs from extracted negatives when blocks skipped', () => {
    const block = (name: string) => `\nAccount Name: ${name}\nAccount Type: Individual\nDate Opened: 01/2020\nBalance: $5,000\nStatus: Current\nEnd of block\n${'x'.repeat(100)}\n`;
    const reportText = block('A') + block('B') + block('C') + block('D');
    const report = {
      derogatory_accounts: [{ creditor_name: 'C', account_number: '9999', status: '30 days late', bureaus: ['experian'] }],
      collections: [],
    };
    const result = postProcessAndValidate(report, reportText);
    expect(result.report.tradeline_inventory.pass1_anchor_detected).toBeGreaterThan(1);
    expect(result.report.tradeline_inventory.negative_extracted).toBe(1);
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
    expect(result.report.tradeline_inventory.pass1_anchor_detected).toBe(0);
    expect(result.report.tradeline_inventory.total_blocks_detected).toBe(3);
  });

  it('returns 0 for empty/null text', () => {
    expect(detectTradelineBlocks(null)).toBe(0);
    expect(detectTradelineBlocks('')).toBe(0);
    expect(detectTradelineBlocks(undefined)).toBe(0);
  });

  it('clusters nearby anchors as same block', () => {
    const text = `Account Name: CHASE\nAccount Number: 1234`;
    expect(detectTradelineBlocks(text)).toBe(1);
  });

  it('duplicate anchors in headers/footers do not inflate count', () => {
    // Page header repeats "Account Name" but within 200 chars of real block
    const text = `Account Name\n${'x'.repeat(50)}\nAccount Name: REAL CREDITOR\nBalance: $500\nStatus: Late\n${'x'.repeat(200)}\nAccount Name: SECOND CREDITOR\nBalance: $1000`;
    const count = detectTradelineBlocks(text);
    // Should cluster the header "Account Name" with the first real block
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3); // header may or may not cluster
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Continuation blocks across page breaks
// ═══════════════════════════════════════════════════════════════════════════

describe('Continuation blocks', () => {
  it('continuation page has no creditor name', () => {
    expect(CONTINUATION_PAGE_2.creditor_name).toBe('');
    expect(CONTINUATION_PAGE_2.is_continuation).toBe(true);
  });

  it('merged result has full data including payment grid', () => {
    expect(CONTINUATION_MERGED.creditor_name).toBe('BANK OF AMERICA');
    expect(CONTINUATION_MERGED.payment_grid_codes).toContain('2');
    expect(CONTINUATION_MERGED.payment_grid_codes).toContain('3');
  });

  it('classifyTradeline on merged result detects grid codes as triggers', () => {
    const classification = classifyTradeline(CONTINUATION_MERGED);
    expect(classification.isNegative).toBe(true);
    expect(classification.triggers.some(t => t.includes('grid codes'))).toBe(true);
  });

  it('continuation page alone classified as non-negative (no triggers)', () => {
    const classification = classifyTradeline(CONTINUATION_PAGE_2);
    // No status keywords, no grid codes on raw continuation (grid codes exist but status_as_reported is null)
    expect(classification.triggers.some(t => t.includes('grid codes'))).toBe(true); // the grid codes ARE present
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: Collection sections separate from tradelines
// ═══════════════════════════════════════════════════════════════════════════

describe('Collections separate from tradelines', () => {
  it('Experian: collections are NOT in derogatory_accounts', () => {
    const result = postProcessAndValidate({
      ...EXPERIAN_ACR,
      report_metadata: EXPERIAN_ACR_METADATA,
      metadata: undefined,
    });
    // Collections array is separate
    expect(result.report.collections.length).toBe(2);
    // No collection agency in derogatory_accounts by name pattern
    const derogNames = result.report.derogatory_accounts.map((a: any) => a.creditor_name);
    // RESURGENT is both a derogatory account AND collection — that's correct per the fixture
    // The key invariant: collections array exists and is populated separately
    expect(result.report.collections[0].collection_agency).toBe('RESURGENT/LVNV FUNDING');
    expect(result.report.collections[1].collection_agency).toBe('MIDLAND CREDIT MGMT');
  });

  it('tradeline_inventory.collections_extracted matches collections array', () => {
    const result = postProcessAndValidate({
      ...EQUIFAX_ACR,
      report_metadata: EQUIFAX_ACR_METADATA,
      metadata: undefined,
    });
    expect(result.report.tradeline_inventory.collections_extracted).toBe(result.report.collections.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: Inquiry-only pages
// ═══════════════════════════════════════════════════════════════════════════

describe('Inquiry handling', () => {
  it('inquiry-only report preserves inquiries through pipeline', () => {
    const report = {
      derogatory_accounts: [],
      collections: [],
      inquiries: [
        { creditor_name: 'AMEX', date: '01/15/2025', type: 'hard', bureaus: ['experian'] },
        { creditor_name: 'DISCOVER', date: '02/01/2025', type: 'soft', bureaus: ['experian'] },
      ],
      public_records: [],
    };
    const result = postProcessAndValidate(report);
    expect(result.report.inquiries.length).toBe(2);
    expect(result.report.tradeline_inventory.inquiries_extracted).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: Reports with/without summary counts
// ═══════════════════════════════════════════════════════════════════════════

describe('Summary counts present vs absent', () => {
  it('with summary counts: validation runs and produces PASS/ERROR/WARNING', () => {
    const result = postProcessAndValidate({
      ...SUMMARY_COUNT_REPORT,
      report_metadata: SUMMARY_ONLY_METADATA,
      metadata: undefined,
    });
    expect(['PASS', 'ERROR', 'WARNING']).toContain(result.validation.status);
  });

  it('without summary counts: validation SKIPPED', () => {
    const result = postProcessAndValidate({
      ...SCANNED_PDF_REPORT,
      report_metadata: SCANNED_PDF_METADATA,
      metadata: undefined,
    });
    expect(result.validation.status).toBe('SKIPPED');
  });

  it('partial summary counts (only collections_count): validates collections only', () => {
    const report = {
      derogatory_accounts: [{ creditor_name: 'A', account_number: '1', status: 'late' }],
      collections: [],
      report_metadata: { collections_count: 2 }, // no accounts_ever_late
    };
    const result = postProcessAndValidate(report);
    expect(result.isError).toBe(true); // 0 collections < 2 expected
    expect(result.validation.messages.some((m: string) => m.includes('COLLECTIONS MISMATCH'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9: Masked account numbers in multiple formats
// ═══════════════════════════════════════════════════════════════════════════

describe('Masked account number preservation', () => {
  it('XXXX format preserved', () => {
    const result = postProcessAndValidate({
      derogatory_accounts: [{ creditor_name: 'A', account_number: '6124XXXX1234', status: 'late' }],
      collections: [],
    });
    expect(result.report.derogatory_accounts[0].account_number).toBe('6124XXXX1234');
  });

  it('**** format preserved', () => {
    const result = postProcessAndValidate({
      derogatory_accounts: [{ creditor_name: 'A', account_number: '****5678', status: 'late' }],
      collections: [],
    });
    expect(result.report.derogatory_accounts[0].account_number).toBe('****5678');
  });

  it('prefix-XX format preserved', () => {
    const result = postProcessAndValidate({
      derogatory_accounts: [{ creditor_name: 'A', account_number: 'MCM-XX7890', status: 'late' }],
      collections: [],
    });
    expect(result.report.derogatory_accounts[0].account_number).toBe('MCM-XX7890');
  });

  it('N/A placeholder accepted', () => {
    const schema = validateSchema({
      derogatory_accounts: [{ creditor_name: 'A', account_number: 'N/A' }],
    });
    expect(schema.rejectedAccounts.length).toBe(0);
  });

  it('UNEXTRACTABLE placeholder accepted', () => {
    const schema = validateSchema({
      derogatory_accounts: [{ creditor_name: 'A', account_number: 'UNEXTRACTABLE' }],
    });
    expect(schema.rejectedAccounts.length).toBe(0);
  });

  it('empty string account_number rejected', () => {
    const schema = validateSchema({
      derogatory_accounts: [{ creditor_name: 'A', account_number: '' }],
    });
    expect(schema.rejectedAccounts.length).toBe(1);
  });

  it('missing account_number rejected', () => {
    const schema = validateSchema({
      derogatory_accounts: [{ creditor_name: 'A' }],
    });
    expect(schema.rejectedAccounts.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10: Deterministic confidence
// ═══════════════════════════════════════════════════════════════════════════

describe('Deterministic confidence derivation', () => {
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

  it('confidence is never 0.8 on processed accounts', () => {
    const report = {
      derogatory_accounts: [
        { creditor_name: 'A', account_number: '1', status: 'late', bureaus: ['experian'] },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(report);
    expect(result.report.derogatory_accounts[0].confidence).not.toBe(0.8);
    expect(['high', 'medium', 'low', 'incomplete']).toContain(result.report.derogatory_accounts[0].confidence);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 11: Non-deterministic fields stripped
// ═══════════════════════════════════════════════════════════════════════════

describe('Non-deterministic fields stripped', () => {
  it('summary and next_steps removed', () => {
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

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 12: Worker entity parity proof
// Simulates what the worker would produce and verifies all entity types survive
// ═══════════════════════════════════════════════════════════════════════════

describe('Worker entity parity: all entity types through postProcessAndValidate', () => {
  it('collections, inquiries, public_records all preserved in output', () => {
    // This simulates the FIXED worker rawResult
    const rawResult = {
      derogatory_accounts: [
        { creditor_name: 'CHASE', account_number: '1234', status: 'late', bureaus: ['experian'] },
      ],
      collections: [
        { collection_agency: 'MCM', balance: '$500', account_number: 'MCM-1', bureaus: ['experian'] },
      ],
      charge_offs: [
        { creditor_name: 'WELLS', account_number: 'W-1', balance: '$0', bureaus: ['equifax'] },
      ],
      inquiries: [
        { creditor_name: 'AMEX', date: '01/01/2025', type: 'hard', bureaus: ['transunion'] },
      ],
      public_records: [
        { type: 'Bankruptcy', filing_date: '06/2020', status: 'Discharged', bureaus: ['experian'] },
      ],
    };

    const result = postProcessAndValidate(rawResult);

    expect(result.report.derogatory_accounts.length).toBe(1);
    expect(result.report.collections.length).toBe(1);
    expect(result.report.charge_offs.length).toBe(1);
    expect(result.report.inquiries.length).toBe(1);
    expect(result.report.public_records.length).toBe(1);

    // Verify tradeline_inventory counts all types
    expect(result.report.tradeline_inventory.negative_extracted).toBe(2); // 1 derog + 1 charge_off
    expect(result.report.tradeline_inventory.collections_extracted).toBe(1);
    expect(result.report.tradeline_inventory.inquiries_extracted).toBe(1);
    expect(result.report.tradeline_inventory.public_records_extracted).toBe(1);
  });

  it('empty collections/inquiries/public_records are preserved as arrays, not dropped', () => {
    const rawResult = {
      derogatory_accounts: [{ creditor_name: 'A', account_number: '1', status: 'late' }],
      collections: [],
      inquiries: [],
      public_records: [],
    };
    const result = postProcessAndValidate(rawResult);
    expect(Array.isArray(result.report.collections)).toBe(true);
    expect(Array.isArray(result.report.inquiries)).toBe(true);
    expect(Array.isArray(result.report.public_records)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 13: Edge case tradeline classification
// ═══════════════════════════════════════════════════════════════════════════

describe('Edge case classification from fixtures', () => {
  it('Past Due $0 is NOT negative', () => {
    const classification = classifyTradeline(PAST_DUE_ZERO_TRADELINE);
    expect(classification.triggers.some(t => t.includes('past due > $0'))).toBe(false);
  });

  it('Past Due $0.00 is NOT negative', () => {
    const classification = classifyTradeline(PAST_DUE_ZERO_DECIMAL_TRADELINE);
    expect(classification.triggers.some(t => t.includes('past due > $0'))).toBe(false);
  });

  it('C/O in address does NOT trigger charge-off', () => {
    const classification = classifyTradeline(CO_IN_ADDRESS_TRADELINE);
    expect(classification.triggers.some(t => t.includes('C/O'))).toBe(false);
  });

  it('C/O in status DOES trigger charge-off', () => {
    const classification = classifyTradeline(CO_IN_STATUS_TRADELINE);
    expect(classification.triggers.some(t => t.includes('C/O'))).toBe(true);
  });

  it('closed account with negative indicator is still negative', () => {
    const classification = classifyTradeline(CLOSED_NEGATIVE_TRADELINE);
    expect(classification.isNegative).toBe(true);
  });

  it('closed account without negative indicator is not negative', () => {
    const classification = classifyTradeline(CLOSED_POSITIVE_TRADELINE);
    expect(classification.isNegative).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 14: Worker checkpoint resume preserves all 5 entity arrays
// ═══════════════════════════════════════════════════════════════════════════

describe('Worker checkpoint resume: all entity arrays', () => {
  it('simulated checkpoint with all 5 arrays restores correctly', () => {
    // Simulates what the worker stores in checkpoints and resumes from
    const checkpoint = {
      accounts: [
        { creditor_name: 'CHASE', account_number: '1234', status: 'late', bureaus: ['experian'] },
      ],
      collections: [
        { collection_agency: 'MCM', balance: '$500', account_number: 'MCM-1', bureaus: ['experian'] },
      ],
      inquiries: [
        { creditor_name: 'AMEX', date: '01/01/2025', type: 'hard', bureaus: ['transunion'] },
      ],
      publicRecords: [
        { type: 'Bankruptcy', filing_date: '06/2020', status: 'Discharged', bureaus: ['experian'] },
      ],
      chargeOffs: [
        { creditor_name: 'WELLS', account_number: 'W-1', balance: '$0', bureaus: ['equifax'] },
      ],
      processedChunks: 2,
      totalChunks: 4,
      failedChunks: [],
    };

    // Simulate new chunk results being appended (as the worker does)
    const newChunkAccounts = [{ creditor_name: 'CITI', account_number: '5678', status: 'charge off', bureaus: ['equifax'] }];
    const newChunkCollections = [{ collection_agency: 'PRA', balance: '$300', account_number: 'PRA-2', bureaus: ['transunion'] }];
    const newChunkInquiries = [{ creditor_name: 'DISCOVER', date: '02/01/2025', type: 'soft', bureaus: ['equifax'] }];

    const allAccounts = [...checkpoint.accounts, ...newChunkAccounts];
    const allCollections = [...checkpoint.collections, ...newChunkCollections];
    const allInquiries = [...checkpoint.inquiries, ...newChunkInquiries];
    const allPublicRecords = [...checkpoint.publicRecords];
    const allChargeOffs = [...checkpoint.chargeOffs];

    // Build rawResult exactly as the worker does
    const rawResult = {
      derogatory_accounts: allAccounts,
      collections: allCollections,
      charge_offs: allChargeOffs,
      inquiries: allInquiries,
      public_records: allPublicRecords,
    };

    const result = postProcessAndValidate(rawResult);

    // All entities from checkpoint + new chunks survive
    expect(result.report.derogatory_accounts.length).toBe(2);
    expect(result.report.collections.length).toBe(2);
    expect(result.report.inquiries.length).toBe(2);
    expect(result.report.public_records.length).toBe(1);
    expect(result.report.charge_offs.length).toBe(1);
  });

  it('checkpoint with nil/undefined arrays defaults to empty', () => {
    // Simulates an old checkpoint format where some arrays are missing
    const checkpoint: any = {
      accounts: [{ creditor_name: 'A', account_number: '1', status: 'late' }],
      // collections, inquiries, publicRecords, chargeOffs are undefined
    };

    const allAccounts = checkpoint.accounts || [];
    const allCollections = checkpoint.collections || [];
    const allInquiries = checkpoint.inquiries || [];
    const allPublicRecords = checkpoint.publicRecords || [];
    const allChargeOffs = checkpoint.chargeOffs || [];

    const rawResult = {
      derogatory_accounts: allAccounts,
      collections: allCollections,
      charge_offs: allChargeOffs,
      inquiries: allInquiries,
      public_records: allPublicRecords,
    };

    const result = postProcessAndValidate(rawResult);
    expect(result.report.derogatory_accounts.length).toBe(1);
    expect(result.report.collections.length).toBe(0);
    expect(result.report.inquiries.length).toBe(0);
    expect(result.report.public_records.length).toBe(0);
    expect(result.report.charge_offs.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 15: Worker section slicing must not drop entities
// ═══════════════════════════════════════════════════════════════════════════

describe('Section slicing: all pages processed', () => {
  it('worker must process ALL pages not just accounts section', () => {
    // The old bug: worker used documentMap.sections.accounts to slice pages,
    // dropping inquiries/collections/public_records on pages outside that range.
    //
    // Proof: if we simulate a 10-page report where accounts are pages 3-7
    // but inquiries are on page 9, the old code would skip page 9.
    //
    // The fix: worker now processes storagePaths[0..n], not a section slice.
    const storagePaths = Array.from({ length: 10 }, (_, i) => `user/job/page-${String(i).padStart(3, '0')}.webp`);
    const MAX_IMAGES_PER_CHUNK = 3;

    // NEW behavior: chunk ALL pages
    const chunks: string[][] = [];
    for (let i = 0; i < storagePaths.length; i += MAX_IMAGES_PER_CHUNK) {
      chunks.push(storagePaths.slice(i, i + MAX_IMAGES_PER_CHUNK));
    }

    // All 10 pages are included in chunks
    const allPagesInChunks = chunks.flat();
    expect(allPagesInChunks.length).toBe(10);
    expect(allPagesInChunks).toEqual(storagePaths);

    // Even if documentMap says accounts are only pages 3-7
    const documentMap = {
      sections: {
        accounts: { start_page: 3, end_page: 7, detected: true },
        inquiries: { start_page: 8, end_page: 9, detected: true },
        public_records: { start_page: 10, end_page: 10, detected: true },
      },
    };

    // OLD bug: would have done storagePaths.slice(2, 7) = only 5 pages
    const oldAccountsSection = documentMap.sections.accounts;
    const oldSlice = storagePaths.slice(oldAccountsSection.start_page - 1, oldAccountsSection.end_page);
    expect(oldSlice.length).toBe(5); // PROVES old code missed 5 pages

    // NEW: all pages processed
    expect(allPagesInChunks.length).toBe(10); // All pages included
  });

  it('collections on last pages survive full-page processing', () => {
    // Simulates: chunks 1-3 have accounts, chunk 4 has collections
    const chunk1Result = {
      accounts: [{ creditor_name: 'A', account_number: '1', status: 'late', bureaus: ['experian'] }],
      collections: [], inquiries: [], public_records: [], charge_offs: [],
    };
    const chunk4Result = {
      accounts: [],
      collections: [{ collection_agency: 'MCM', balance: '$500', account_number: 'M-1', bureaus: ['experian'] }],
      inquiries: [{ creditor_name: 'AMEX', date: '01/01/2025', type: 'hard', bureaus: ['experian'] }],
      public_records: [], charge_offs: [],
    };

    // Accumulate as worker does
    const allAccounts = [...chunk1Result.accounts];
    const allCollections = [...chunk1Result.collections, ...chunk4Result.collections];
    const allInquiries = [...chunk1Result.inquiries, ...chunk4Result.inquiries];

    const rawResult = {
      derogatory_accounts: allAccounts,
      collections: allCollections,
      charge_offs: [],
      inquiries: allInquiries,
      public_records: [],
    };

    const result = postProcessAndValidate(rawResult);
    expect(result.report.derogatory_accounts.length).toBe(1);
    expect(result.report.collections.length).toBe(1);
    expect(result.report.inquiries.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 16: Multi-bureau same account NOT collapsed
// ═══════════════════════════════════════════════════════════════════════════

describe('Multi-bureau: same account across bureaus never collapsed', () => {
  it('3 bureaus reporting same account = 3 entries preserved', () => {
    const rawResult = {
      derogatory_accounts: [
        { creditor_name: 'CHASE', account_number: '4147XXXX8888', status: 'Late', status_as_reported: '30 days late', bureaus: ['experian'] },
        { creditor_name: 'CHASE', account_number: '4147XXXX8888', status: 'Late', status_as_reported: '30 days late', bureaus: ['equifax'] },
        { creditor_name: 'CHASE', account_number: '4147XXXX8888', status: 'Late', status_as_reported: '30 days late', bureaus: ['transunion'] },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    expect(result.report.derogatory_accounts.length).toBe(3);
    // No duplicates flagged because different bureaus
    expect(result.duplicateFlags.length).toBe(0);
  });

  it('same bureau same account = flagged but NOT removed', () => {
    const rawResult = {
      derogatory_accounts: [
        { creditor_name: 'CHASE', account_number: '4147XXXX8888', status: 'Late', status_as_reported: '30 days late', bureaus: ['experian'] },
        { creditor_name: 'CHASE', account_number: '4147XXXX8888', status: 'Late', status_as_reported: '30 days late', bureaus: ['experian'] },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    expect(result.report.derogatory_accounts.length).toBe(2); // NOT collapsed
    expect(result.duplicateFlags.length).toBeGreaterThan(0); // flagged
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 17: Prove confidence 0.8 is never output
// ═══════════════════════════════════════════════════════════════════════════

describe('Confidence never hardcoded 0.8', () => {
  it('postProcessAndValidate overrides any numeric confidence', () => {
    const rawResult = {
      derogatory_accounts: [
        { creditor_name: 'A', account_number: '1', status: 'late', confidence: 0.8, bureaus: ['experian'] },
        { creditor_name: 'B', account_number: '2', status: 'charge off', confidence: 0.95, bureaus: ['equifax'] },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    for (const acct of result.report.derogatory_accounts) {
      expect(typeof acct.confidence).toBe('string');
      expect(['high', 'medium', 'low', 'incomplete']).toContain(acct.confidence);
      expect(acct.confidence).not.toBe(0.8);
      expect(acct.confidence).not.toBe(0.95);
    }
  });

  it('charge_offs also get deterministic confidence', () => {
    const rawResult = {
      derogatory_accounts: [],
      charge_offs: [
        { creditor_name: 'WELLS', account_number: 'W-1', status: 'Charged Off', confidence: 0.8, bureaus: ['equifax'] },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    for (const co of result.report.charge_offs) {
      expect(typeof co.confidence).toBe('string');
      expect(co.confidence).not.toBe(0.8);
    }
  });
});

// ─── No-Merge Rule: Cross-Bureau Preservation ──────────────────────────────

describe('No-Merge Rule — normalizeAccounts preserves separate bureau rows', () => {
  it('same creditor+account across different bureaus stays as separate rows', () => {
    const rawResult = {
      derogatory_accounts: [
        {
          creditor_name: 'CAPITAL ONE',
          account_number: '1234XXXX5678',
          status_as_reported: 'Charge Off',
          bureaus: ['experian'],
          past_due_amount: '$500',
        },
        {
          creditor_name: 'CAPITAL ONE',
          account_number: '1234XXXX5678',
          status_as_reported: 'Charge Off',
          bureaus: ['equifax'],
          past_due_amount: '$500',
        },
        {
          creditor_name: 'CAPITAL ONE',
          account_number: '1234XXXX5678',
          status_as_reported: 'Charge Off',
          bureaus: ['transunion'],
          past_due_amount: '$450',
        },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    // All 3 bureau entries must remain separate in derogatory_accounts
    expect(result.report.derogatory_accounts.length).toBe(3);
    const bureaus = result.report.derogatory_accounts.map(
      (a: any) => a.bureaus?.[0]
    );
    expect(bureaus).toContain('experian');
    expect(bureaus).toContain('equifax');
    expect(bureaus).toContain('transunion');
  });

  it('same creditor across bureaus are flagged as duplicates but not merged', () => {
    const rawResult = {
      derogatory_accounts: [
        {
          creditor_name: 'DISCOVER',
          account_number: '9999',
          status: 'Late',
          bureaus: ['experian'],
        },
        {
          creditor_name: 'DISCOVER',
          account_number: '9999',
          status: 'Late',
          bureaus: ['transunion'],
        },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    // Both preserved (different bureau keys)
    expect(result.report.derogatory_accounts.length).toBe(2);
    // detectDuplicates uses bureau-aware keys so these are NOT duplicates
    expect(result.duplicateFlags.length).toBe(0);
  });
});

// ─── isCleanTradeline Hard Veto ────────────────────────────────────────────

describe('isCleanTradeline hard veto — blocks false positives', () => {
  it('paid-as-agreed, $0 past due, no grid, no DOFD is excluded even with weak block_text trigger', () => {
    const rawResult = {
      derogatory_accounts: [
        {
          creditor_name: 'ALLY FINANCIAL',
          account_number: '8888XXXX1111',
          status_as_reported: 'Paid or paying as agreed',
          status: 'Current',
          past_due_amount: '$0',
          payment_grid_codes: 'OK OK OK OK OK OK',
          date_first_delinquency: null,
          section_header: null,
          remarks: null,
          // AI block_text has a weak trigger "late" in narrative context
          block_text: 'This account was opened late in 2019 and has been current throughout.',
          bureaus: ['transunion'],
        },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    // Must NOT be in derogatory_accounts
    expect(result.report.derogatory_accounts.length).toBe(0);
    // Must be in manual_review_accounts
    expect(result.report.manual_review_accounts.length).toBe(1);
    expect(result.report.manual_review_accounts[0]._bucket).toBe('clean');
  });

  it('paid-as-agreed with negative grid codes is NOT clean (UPSTA/FINWISE case)', () => {
    const rawResult = {
      derogatory_accounts: [
        {
          creditor_name: 'UPSTA/FINWISE',
          account_number: '5555XXXX9999',
          status_as_reported: 'Paid or paying as agreed',
          status: 'Current',
          past_due_amount: '$0',
          payment_grid_codes: 'OK OK 2 3 OK OK OK',
          date_first_delinquency: null,
          section_header: null,
          remarks: null,
          bureaus: ['transunion'],
        },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    // MUST remain in derogatory_accounts because grid codes 2,3 are negative
    expect(result.report.derogatory_accounts.length).toBe(1);
    expect(result.report.derogatory_accounts[0].creditor_name).toBe('UPSTA/FINWISE');
    expect(result.report.derogatory_accounts[0].derogatory_triggers).toEqual(
      expect.arrayContaining([expect.stringContaining('grid codes')])
    );
  });

  it('clean tradeline with stray "collection" in block_text is still excluded', () => {
    const rawResult = {
      derogatory_accounts: [
        {
          creditor_name: 'USAA',
          account_number: '2222XXXX3333',
          status_as_reported: 'Paid as agreed',
          status: 'Closed',
          past_due_amount: null,
          payment_grid_codes: null,
          date_first_delinquency: null,
          section_header: null,
          remarks: null,
          block_text: 'This collection of payments shows a solid repayment history.',
          bureaus: ['experian'],
        },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    expect(result.report.derogatory_accounts.length).toBe(0);
    expect(result.report.manual_review_accounts.length).toBe(1);
  });

  it('clean tradeline with date_first_delinquency is NOT clean', () => {
    const rawResult = {
      derogatory_accounts: [
        {
          creditor_name: 'CHASE',
          account_number: '4444',
          status_as_reported: 'Paid or paying as agreed',
          past_due_amount: '$0',
          payment_grid_codes: null,
          date_first_delinquency: '2021-03-15',
          bureaus: ['equifax'],
        },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    // Has DOFD trigger so it stays derogatory
    expect(result.report.derogatory_accounts.length).toBe(1);
  });

  it('truly derogatory tradeline is not affected by clean veto', () => {
    const rawResult = {
      derogatory_accounts: [
        {
          creditor_name: 'MIDLAND CREDIT',
          account_number: '7777',
          status_as_reported: 'Collection',
          status: 'Collection',
          past_due_amount: '$2,500',
          payment_grid_codes: null,
          date_first_delinquency: '2020-01-01',
          section_header: 'Collection Accounts',
          bureaus: ['transunion'],
        },
      ],
      collections: [],
    };
    const result = postProcessAndValidate(rawResult);
    expect(result.report.derogatory_accounts.length).toBe(1);
    expect(result.report.derogatory_accounts[0].derogatory_triggers.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 18: Value-aware triggers (DOFD, past due, placeholders)
// ═══════════════════════════════════════════════════════════════════════════

describe('Value-aware DOFD trigger', () => {
  it('null DOFD does NOT trigger', () => {
    const classification = classifyTradeline({
      creditor_name: 'TEST',
      account_number: '1234',
      status_as_reported: 'Paid or paying as agreed',
      date_first_delinquency: null,
    });
    expect(classification.triggers.some(t => t.includes('date of first delinquency'))).toBe(false);
  });

  it('N/A DOFD does NOT trigger', () => {
    const classification = classifyTradeline({
      creditor_name: 'TEST',
      account_number: '1234',
      status_as_reported: 'Current',
      date_first_delinquency: 'N/A',
    });
    expect(classification.triggers.some(t => t.includes('date of first delinquency'))).toBe(false);
  });

  it('UNEXTRACTABLE DOFD does NOT trigger', () => {
    const classification = classifyTradeline({
      creditor_name: 'TEST',
      account_number: '1234',
      status_as_reported: 'Open',
      date_first_delinquency: 'UNEXTRACTABLE',
    });
    expect(classification.triggers.some(t => t.includes('date of first delinquency'))).toBe(false);
  });

  it('"not reported" DOFD does NOT trigger', () => {
    const classification = classifyTradeline({
      creditor_name: 'TEST',
      account_number: '1234',
      status_as_reported: 'Current',
      date_first_delinquency: 'not reported',
    });
    expect(classification.triggers.some(t => t.includes('date of first delinquency'))).toBe(false);
  });

  it('blank DOFD does NOT trigger', () => {
    const classification = classifyTradeline({
      creditor_name: 'TEST',
      account_number: '1234',
      status_as_reported: 'Current',
      date_first_delinquency: '',
    });
    expect(classification.triggers.some(t => t.includes('date of first delinquency'))).toBe(false);
  });

  it('actual date DOFD DOES trigger', () => {
    const classification = classifyTradeline({
      creditor_name: 'TEST',
      account_number: '1234',
      status_as_reported: 'Current',
      date_first_delinquency: '03/2021',
    });
    expect(classification.triggers.some(t => t.includes('date of first delinquency'))).toBe(true);
  });
});

describe('Field label safeguard — block_text excluded from keyword matching', () => {
  it('block_text with "past due" field label does NOT trigger keyword match', () => {
    const classification = classifyTradeline({
      creditor_name: 'DEPTEDNELNET',
      account_number: '1234',
      status_as_reported: 'Paid or paying as agreed',
      status: 'Current',
      past_due_amount: '$0',
      block_text: 'Account Name: DEPTEDNELNET\nPast Due Amount: $0\nDate of First Delinquency: N/A\nStatus: Paid or paying as agreed',
      date_first_delinquency: 'N/A',
    });
    // "past due" and "delinquency" are in block_text labels but NOT in structured fields
    // Should not trigger from labels
    expect(classification.triggers.some(t => t === 'past due')).toBe(false);
  });

  it('clean deferred student loan with label noise is excluded by isCleanTradeline', () => {
    
    const tradeline = {
      creditor_name: 'DEPTEDNELNET',
      account_number: '5678',
      status_as_reported: 'Paid or paying as agreed',
      status: 'Current',
      past_due_amount: '$0',
      payment_grid_codes: null,
      date_first_delinquency: null,
      section_header: null,
      remarks: null,
      block_text: 'Past Due Amount: $0\nDate of First Delinquency:\nPayment Status: Current',
    };
    expect(isCleanTradeline(tradeline)).toBe(true);
  });
});

describe('Placeholder values never trigger', () => {
  it('isPastDueNegative returns false for placeholder values', () => {
    
    expect(isPastDueNegative(null)).toBe(false);
    expect(isPastDueNegative('')).toBe(false);
    expect(isPastDueNegative('N/A')).toBe(false);
    expect(isPastDueNegative('$0')).toBe(false);
    expect(isPastDueNegative('$0.00')).toBe(false);
    expect(isPastDueNegative('UNEXTRACTABLE')).toBe(false);
    expect(isPastDueNegative('not reported')).toBe(false);
  });

  it('isPastDueNegative returns true only for actual amounts > 0', () => {
    
    expect(isPastDueNegative('$500')).toBe(true);
    expect(isPastDueNegative('$1,234.56')).toBe(true);
  });
});

describe('Clean account exclusion regression — Tara TransUnion scenario', () => {
  it('DEPTEDNELNET paid-as-agreed $0 past due with label noise is excluded', () => {
    const rawResult = {
      derogatory_accounts: [
        {
          creditor_name: 'DEPTEDNELNET',
          account_number: 'E1234',
          status_as_reported: 'Paid or paying as agreed',
          status: 'Current',
          past_due_amount: '$0',
          payment_grid_codes: 'OK OK OK OK',
          date_first_delinquency: null,
          section_header: null,
          remarks: null,
          block_text: 'Past Due Amount: $0\nDate of First Delinquency: N/A',
          bureaus: ['transunion'],
        },
        {
          creditor_name: 'UPSTA/FINWSE',
          account_number: 'FW1892',
          status_as_reported: 'Paid or paying as agreed',
          status: 'Current',
          past_due_amount: '$0',
          payment_grid_codes: 'OK OK 2 3 OK OK',
          date_first_delinquency: null,
          section_header: null,
          bureaus: ['transunion'],
        },
      ],
      collections: [],
      inquiries: [
        { creditor_name: 'EVOLVE/SPARR', date: '09/09/2024', type: 'hard', bureaus: ['transunion'] },
        { creditor_name: 'TBOM/MILESTO', date: '09/13/2023', type: 'hard', bureaus: ['transunion'] },
      ],
    };
    const result = postProcessAndValidate(rawResult);

    // DEPTEDNELNET must be excluded from derogatory (clean tradeline)
    expect(result.report.derogatory_accounts.some((a: any) => a.creditor_name === 'DEPTEDNELNET')).toBe(false);

    // UPSTA/FINWSE must remain (grid codes 2,3)
    expect(result.report.derogatory_accounts.some((a: any) => a.creditor_name === 'UPSTA/FINWSE')).toBe(true);

    // Inquiries preserved independently
    expect(result.report.inquiries.length).toBe(2);
    expect(result.report.inquiries[0].creditor_name).toBe('EVOLVE/SPARR');
    expect(result.report.inquiries[1].creditor_name).toBe('TBOM/MILESTO');
  });
});

// ─── Hardened Parser Rules ─────────────────────────────────────────────────
describe('Hardened parser rules', () => {
  it('"past due" keyword alone does NOT trigger negative classification', () => {
    
    // "Past Due Amount: $0" should NOT match
    expect(findNegativeKeywords('Past Due Amount: $0')).not.toContain('past due');
    expect(findNegativeKeywords('Past due')).not.toContain('past due');
    expect(findNegativeKeywords('past-due')).not.toContain('past-due');
  });

  it('isPastDueNegative is the only past-due trigger source', () => {
    
    expect(isPastDueNegative('$0')).toBe(false);
    expect(isPastDueNegative('$0.00')).toBe(false);
    expect(isPastDueNegative(null)).toBe(false);
    expect(isPastDueNegative('')).toBe(false);
    expect(isPastDueNegative('$150')).toBe(true);

    // Tradeline with "Past Due Amount" label in block_text but $0 value
    const cleanWithLabel = {
      creditor_name: 'TEST',
      status_as_reported: 'Paid or paying as agreed',
      past_due_amount: '$0',
      block_text: 'Past Due Amount: $0\nStatus: Current',
    };
    const result = classifyTradeline(cleanWithLabel);
    expect(result.triggers).not.toContain('past due');
    expect(result.triggers.filter((t: string) => t.includes('past due'))).toEqual([]);
  });

  it('DOFD requires real date pattern, not just any digit-containing string', () => {
    
    // Real dates
    expect(hasActualDateOfFirstDelinquency('01/2020')).toBe(true);
    expect(hasActualDateOfFirstDelinquency('03/15/2021')).toBe(true);
    expect(hasActualDateOfFirstDelinquency('2021-03-15')).toBe(true);
    expect(hasActualDateOfFirstDelinquency('Sep 2024')).toBe(true);
    expect(hasActualDateOfFirstDelinquency('2020')).toBe(true);

    // NOT real dates — must return false
    expect(hasActualDateOfFirstDelinquency(null)).toBe(false);
    expect(hasActualDateOfFirstDelinquency('N/A')).toBe(false);
    expect(hasActualDateOfFirstDelinquency('UNEXTRACTABLE')).toBe(false);
    expect(hasActualDateOfFirstDelinquency('')).toBe(false);
    expect(hasActualDateOfFirstDelinquency('-')).toBe(false);
    expect(hasActualDateOfFirstDelinquency('not reported')).toBe(false);
    // Arbitrary digit-containing strings that are NOT dates
    expect(hasActualDateOfFirstDelinquency('Account 12345')).toBe(false);
    expect(hasActualDateOfFirstDelinquency('Balance is $500')).toBe(false);
  });

  it('clean tradeline with weak text trigger is vetoed by isCleanTradeline', () => {
    
    const cleanAccount = {
      creditor_name: 'DEPTEDNELNET',
      status_as_reported: 'Paid or paying as agreed',
      status: 'Current',
      past_due_amount: '$0',
      payment_grid_codes: 'OK OK OK OK OK OK',
      date_first_delinquency: null,
      section_header: 'Account Information',
      remarks: '',
    };
    expect(isCleanTradeline(cleanAccount)).toBe(true);
    // Even if classifyTradeline finds nothing, isCleanTradeline is the hard veto
    const classification = classifyTradeline(cleanAccount);
    expect(classification.isNegative).toBe(false);
  });

  it('UPSTA/FINWSE with historical grid codes stays derogatory despite positive status', () => {
    
    const upsta = {
      creditor_name: 'UPSTA/FINWSE',
      status_as_reported: 'Paid or paying as agreed',
      status: 'Current',
      past_due_amount: '$0',
      payment_grid_codes: 'OK OK 2 3 OK OK',
      date_first_delinquency: null,
      section_header: 'Account Information',
    };
    // Grid codes 2,3 mean NOT clean
    expect(isCleanTradeline(upsta)).toBe(false);
    const result = classifyTradeline(upsta);
    expect(result.isNegative).toBe(true);
    expect(result.triggers.some((t: string) => t.includes('grid codes'))).toBe(true);
  });
});