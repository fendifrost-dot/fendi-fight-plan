/**
 * Parser Regression Test Suite — Credit Compass
 *
 * Validates the deterministic parser rules against known fixtures.
 * Must pass before any parser changes are deployed.
 *
 * Coverage:
 * 1. Experian ACR (incl. RESURGENT/LVNV FUNDING detection)
 * 2. Equifax ACR (incl. Aidvantage *0110/*0120/*0130/*0140)
 * 3. Credit Karma / TransUnion multi-bureau
 * 4. Scanned PDF (low confidence, UNEXTRACTABLE)
 * 5. Multi-page tradeline continuation
 * 6. Summary counts validation gate
 * 7. Known bug regressions (Past Due $0, C/O context, word boundaries, closed accounts)
 */

import { describe, it, expect } from 'vitest';
import {
  wholeWordMatch,
  findNegativeKeywords,
  isCOChargeOff,
  isPastDueNegative,
  findNegativeGridCodes,
  isNegativeSectionHeader,
  classifyTradeline,
  validateExtraction,
  detectDuplicates,
  accountNumberPreserved,
  isContinuationChunk,
  postProcessReport,
  type ParsedReport,
  type Tradeline,
  type Collection,
} from '@/lib/parser-rules';

import {
  EXPERIAN_ACR,
  EXPERIAN_ACR_METADATA,
  EQUIFAX_ACR,
  EQUIFAX_ACR_METADATA,
  CREDIT_KARMA_REPORT,
  CREDIT_KARMA_METADATA,
  SCANNED_PDF_REPORT,
  SCANNED_PDF_METADATA,
  SUMMARY_COUNT_REPORT,
  SUMMARY_ONLY_METADATA,
  CONTINUATION_PAGE_1,
  CONTINUATION_PAGE_2,
  CONTINUATION_MERGED,
  PAST_DUE_ZERO_TRADELINE,
  PAST_DUE_ZERO_DECIMAL_TRADELINE,
  CO_IN_ADDRESS_TRADELINE,
  CO_IN_STATUS_TRADELINE,
  FALSE_POSITIVE_TEXT,
  TRUE_POSITIVE_TEXT,
  CLOSED_NEGATIVE_TRADELINE,
  CLOSED_POSITIVE_TRADELINE,
} from './fixtures/parserFixtures';

// ═══════════════════════════════════════════════════════════════════════════
// 1. WHOLE-WORD BOUNDARY MATCHING
// ═══════════════════════════════════════════════════════════════════════════

describe('Whole-word boundary matching', () => {
  it('matches "late" as a whole word', () => {
    expect(wholeWordMatch('Account is late', 'late')).toBe(true);
    expect(wholeWordMatch('2 late payments', 'late')).toBe(true);
    expect(wholeWordMatch('LATE PAYMENT', 'late')).toBe(true);
  });

  it('does NOT match "late" as substring in other words', () => {
    expect(wholeWordMatch('collateral assignment', 'late')).toBe(false);
    expect(wholeWordMatch('translated documents', 'late')).toBe(false);
    expect(wholeWordMatch('related to later review', 'late')).toBe(false);
    expect(wholeWordMatch('chocolate cake', 'late')).toBe(false);
  });

  it('matches multi-word phrases', () => {
    expect(wholeWordMatch('Status: Charge Off', 'charge off')).toBe(true);
    expect(wholeWordMatch('settled for less than full', 'settled for less')).toBe(true);
    expect(wholeWordMatch('included in bankruptcy filing', 'included in bankruptcy')).toBe(true);
  });

  it('handles hyphenated keywords', () => {
    expect(wholeWordMatch('Status: Charged-Off', 'charged-off')).toBe(true);
    expect(wholeWordMatch('Account is past-due', 'past-due')).toBe(true);
    expect(wholeWordMatch('write-off reported', 'write-off')).toBe(true);
  });

  it('false positive text must NOT match "late"', () => {
    expect(wholeWordMatch(FALSE_POSITIVE_TEXT, 'late')).toBe(false);
  });

  it('true positive text MUST match "late"', () => {
    expect(wholeWordMatch(TRUE_POSITIVE_TEXT, 'late')).toBe(true);
  });

  it('handles empty/null inputs gracefully', () => {
    expect(wholeWordMatch('', 'late')).toBe(false);
    expect(wholeWordMatch('some text', '')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PAST DUE AMOUNT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Past Due Amount detection', () => {
  it('$0 is NOT negative', () => {
    expect(isPastDueNegative('$0')).toBe(false);
  });

  it('$0.00 is NOT negative', () => {
    expect(isPastDueNegative('$0.00')).toBe(false);
  });

  it('$1 IS negative', () => {
    expect(isPastDueNegative('$1')).toBe(true);
  });

  it('$500 IS negative', () => {
    expect(isPastDueNegative('$500')).toBe(true);
  });

  it('$1,234.56 IS negative', () => {
    expect(isPastDueNegative('$1,234.56')).toBe(true);
  });

  it('null/undefined are NOT negative', () => {
    expect(isPastDueNegative(null)).toBe(false);
    expect(isPastDueNegative(undefined)).toBe(false);
    expect(isPastDueNegative('')).toBe(false);
  });

  it('non-numeric strings are NOT negative', () => {
    expect(isPastDueNegative('N/A')).toBe(false);
    expect(isPastDueNegative('unknown')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. C/O CONTEXT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('C/O context detection', () => {
  it('C/O in status field IS charge-off', () => {
    expect(isCOChargeOff('C/O', 'status')).toBe(true);
    expect(isCOChargeOff('Account C/O', 'status')).toBe(true);
  });

  it('C/O in remark field IS charge-off', () => {
    expect(isCOChargeOff('C/O balance written off', 'remark')).toBe(true);
  });

  it('C/O in address field is NOT charge-off', () => {
    expect(isCOChargeOff('123 Main St C/O John Smith', 'address')).toBe(false);
  });

  it('C/O with address patterns detected heuristically', () => {
    expect(isCOChargeOff('456 Oak Ave C/O Jane Doe, Anytown 12345')).toBe(false);
  });

  it('C/O without address patterns IS charge-off (heuristic)', () => {
    expect(isCOChargeOff('Status: C/O reported')).toBe(true);
  });

  it('text without C/O is not a match', () => {
    expect(isCOChargeOff('Current account', 'status')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PAYMENT GRID CODE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Payment grid code detection', () => {
  it('detects negative grid codes', () => {
    expect(findNegativeGridCodes('1 1 2 1 1')).toEqual(['2']);
    expect(findNegativeGridCodes('1 1 1 CO 1')).toEqual(['CO']);
    expect(findNegativeGridCodes('1 3 4 1 1')).toEqual(['3', '4']);
  });

  it('returns empty for all-OK grids', () => {
    expect(findNegativeGridCodes('1 1 1 1 1')).toEqual([]);
    expect(findNegativeGridCodes('OK OK OK')).toEqual([]);
    expect(findNegativeGridCodes('C C C C')).toEqual([]);
  });

  it('handles null/undefined', () => {
    expect(findNegativeGridCodes(null)).toEqual([]);
    expect(findNegativeGridCodes(undefined)).toEqual([]);
    expect(findNegativeGridCodes('')).toEqual([]);
  });

  it('detects derogatory code X', () => {
    expect(findNegativeGridCodes('1 X 1 1')).toEqual(['X']);
  });

  it('detects code D', () => {
    expect(findNegativeGridCodes('1 D 1')).toEqual(['D']);
  });

  it('handles code 5 (120+ days late)', () => {
    expect(findNegativeGridCodes('1 1 5 1')).toEqual(['5']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. SECTION HEADER CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Negative section header detection', () => {
  it('recognizes all negative section headers', () => {
    expect(isNegativeSectionHeader('Potentially Negative Items')).toBe(true);
    expect(isNegativeSectionHeader('Negative Accounts')).toBe(true);
    expect(isNegativeSectionHeader('Adverse Accounts')).toBe(true);
    expect(isNegativeSectionHeader('Collection Accounts')).toBe(true);
    expect(isNegativeSectionHeader('Derogatory')).toBe(true);
  });

  it('does not flag positive section headers', () => {
    expect(isNegativeSectionHeader('Accounts In Good Standing')).toBe(false);
    expect(isNegativeSectionHeader('Satisfactory Accounts')).toBe(false);
    expect(isNegativeSectionHeader(null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. TRADELINE CLASSIFICATION (PASS 2 LOGIC)
// ═══════════════════════════════════════════════════════════════════════════

describe('Tradeline classification', () => {
  it('Past Due $0 tradeline is NOT negative', () => {
    const result = classifyTradeline(PAST_DUE_ZERO_TRADELINE);
    expect(result.isNegative).toBe(false);
    expect(result.triggers).toHaveLength(0);
  });

  it('Past Due $0.00 tradeline is NOT negative', () => {
    const result = classifyTradeline(PAST_DUE_ZERO_DECIMAL_TRADELINE);
    expect(result.isNegative).toBe(false);
    expect(result.triggers).toHaveLength(0);
  });

  it('C/O in address block is NOT negative', () => {
    const result = classifyTradeline(CO_IN_ADDRESS_TRADELINE);
    expect(result.isNegative).toBe(false);
  });

  it('C/O in status IS negative', () => {
    const result = classifyTradeline(CO_IN_STATUS_TRADELINE);
    expect(result.isNegative).toBe(true);
    expect(result.triggers.some(t => t.includes('C/O'))).toBe(true);
  });

  it('closed account with negative indicator IS negative', () => {
    const result = classifyTradeline(CLOSED_NEGATIVE_TRADELINE);
    expect(result.isNegative).toBe(true);
  });

  it('closed account WITHOUT negative indicator is NOT negative', () => {
    const result = classifyTradeline(CLOSED_POSITIVE_TRADELINE);
    expect(result.isNegative).toBe(false);
  });

  it('tradeline with date_first_delinquency IS negative', () => {
    const t: Tradeline = {
      creditor_name: 'TEST',
      account_number: 'XX1234',
      status_as_reported: 'Current',
      date_first_delinquency: '06/2022',
    };
    const result = classifyTradeline(t);
    expect(result.isNegative).toBe(true);
    expect(result.triggers.some(t => t.includes('date of first delinquency'))).toBe(true);
  });

  it('tradeline with past due > $0 IS negative', () => {
    const t: Tradeline = {
      creditor_name: 'TEST',
      account_number: 'XX5678',
      status_as_reported: 'Current',
      past_due_amount: '$156',
    };
    const result = classifyTradeline(t);
    expect(result.isNegative).toBe(true);
    expect(result.triggers.some(t => t.includes('past due > $0'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. CONTINUATION DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Continuation chunk detection', () => {
  it('page 1 (has creditor) is NOT a continuation', () => {
    expect(isContinuationChunk(CONTINUATION_PAGE_1)).toBe(false);
  });

  it('page 2 (no creditor, has payment data) IS a continuation', () => {
    expect(isContinuationChunk(CONTINUATION_PAGE_2)).toBe(true);
  });

  it('merged tradeline is NOT a continuation', () => {
    expect(isContinuationChunk(CONTINUATION_MERGED)).toBe(false);
  });

  it('merged tradeline preserves all original fields', () => {
    expect(CONTINUATION_MERGED.creditor_name).toBe('BANK OF AMERICA');
    expect(CONTINUATION_MERGED.account_number).toBe('4400XXXX1111');
    expect(CONTINUATION_MERGED.payment_grid_codes).toBe('1 1 1 2 3 2 1 1 1 1 1 1 2 1 1 1 1 1');
    expect(CONTINUATION_MERGED.balance).toBe('$6,300');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. VALIDATION GATE
// ═══════════════════════════════════════════════════════════════════════════

describe('Validation gate', () => {
  it('Experian ACR passes validation (4 neg, 2 collections)', () => {
    const result = validateExtraction(EXPERIAN_ACR, EXPERIAN_ACR_METADATA);
    expect(result.status).toBe('PASS');
  });

  it('Equifax ACR passes validation (5 neg, 1 collection, 1 public record)', () => {
    const result = validateExtraction(EQUIFAX_ACR, EQUIFAX_ACR_METADATA);
    expect(result.status).toBe('PASS');
  });

  it('Summary count report passes validation', () => {
    const result = validateExtraction(SUMMARY_COUNT_REPORT, SUMMARY_ONLY_METADATA);
    expect(result.status).toBe('PASS');
  });

  it('skips validation when no summary counts', () => {
    const result = validateExtraction(SCANNED_PDF_REPORT, SCANNED_PDF_METADATA);
    expect(result.status).toBe('SKIPPED');
  });

  it('ERROR on under-extraction (collections)', () => {
    const underExtracted: ParsedReport = {
      derogatory_accounts: [],
      collections: [], // expected 2
      charge_offs: [],
    };
    const result = validateExtraction(underExtracted, { collections_count: 2 });
    expect(result.status).toBe('ERROR');
    expect(result.messages.some(m => m.includes('COLLECTIONS MISMATCH'))).toBe(true);
  });

  it('ERROR on under-extraction (negative tradelines)', () => {
    const underExtracted: ParsedReport = {
      derogatory_accounts: [{ creditor_name: 'A', account_number: 'X' }],
      collections: [],
      charge_offs: [],
    };
    const result = validateExtraction(underExtracted, { accounts_ever_late: 5 });
    expect(result.status).toBe('ERROR');
    expect(result.messages.some(m => m.includes('NEGATIVE TRADELINE MISMATCH'))).toBe(true);
  });

  it('WARNING on over-extraction (collections)', () => {
    const overExtracted: ParsedReport = {
      derogatory_accounts: [],
      collections: [
        { account_number: '1' }, { account_number: '2' }, { account_number: '3' },
        { account_number: '4' }, { account_number: '5' }, { account_number: '6' },
      ] as Collection[],
      charge_offs: [],
    };
    const result = validateExtraction(overExtracted, { collections_count: 1 });
    expect(result.status).toBe('WARNING');
    expect(result.messages.some(m => m.includes('OVER-EXTRACTION'))).toBe(true);
  });

  it('ERROR takes precedence over WARNING', () => {
    const mixed: ParsedReport = {
      derogatory_accounts: [], // under-extracted
      collections: [
        { account_number: '1' }, { account_number: '2' }, { account_number: '3' },
        { account_number: '4' }, { account_number: '5' },
      ] as Collection[], // over-extracted
      charge_offs: [],
    };
    const result = validateExtraction(mixed, { accounts_ever_late: 3, collections_count: 1 });
    expect(result.status).toBe('ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. DUPLICATE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Duplicate detection', () => {
  it('flags duplicates with same creditor+account+bureau', () => {
    const tradelines: Tradeline[] = [
      { creditor_name: 'CHASE', account_number: 'XX1234', bureaus: ['experian'] },
      { creditor_name: 'CHASE', account_number: 'XX1234', bureaus: ['experian'] },
    ];
    const flags = detectDuplicates(tradelines);
    expect(flags).toHaveLength(1);
    expect(flags[0].message).toContain('POSSIBLE DUPLICATE');
    expect(flags[0].indices).toEqual([0, 1]);
  });

  it('does NOT flag same creditor on different bureaus', () => {
    const tradelines: Tradeline[] = [
      { creditor_name: 'CHASE', account_number: 'XX1234', bureaus: ['experian'] },
      { creditor_name: 'CHASE', account_number: 'XX1234', bureaus: ['equifax'] },
    ];
    const flags = detectDuplicates(tradelines);
    expect(flags).toHaveLength(0);
  });

  it('does NOT flag different account numbers', () => {
    const tradelines: Tradeline[] = [
      { creditor_name: 'CHASE', account_number: 'XX1234', bureaus: ['experian'] },
      { creditor_name: 'CHASE', account_number: 'XX5678', bureaus: ['experian'] },
    ];
    const flags = detectDuplicates(tradelines);
    expect(flags).toHaveLength(0);
  });

  it('handles empty input', () => {
    expect(detectDuplicates([])).toHaveLength(0);
    expect(detectDuplicates([{ creditor_name: 'A', account_number: 'B' }])).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. ACCOUNT NUMBER PRESERVATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Account number preservation', () => {
  it('preserves masked Experian account numbers', () => {
    expect(accountNumberPreserved('6124XXXX1234', '6124XXXX1234')).toBe(true);
    expect(accountNumberPreserved('5178XXXX5678', '5178XXXX5678')).toBe(true);
  });

  it('preserves Equifax Aidvantage masked numbers', () => {
    expect(accountNumberPreserved('XXXX0110', 'XXXX0110')).toBe(true);
    expect(accountNumberPreserved('XXXX0120', 'XXXX0120')).toBe(true);
    expect(accountNumberPreserved('XXXX0130', 'XXXX0130')).toBe(true);
    expect(accountNumberPreserved('XXXX0140', 'XXXX0140')).toBe(true);
  });

  it('detects altered account numbers', () => {
    expect(accountNumberPreserved('61241234', '6124XXXX1234')).toBe(false); // masking removed
    expect(accountNumberPreserved('XXXX0110  ', 'XXXX0110')).toBe(false); // double trailing space (not just trim)
  });

  it('handles N/A', () => {
    expect(accountNumberPreserved('N/A', 'N/A')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. KNOWN BUG REGRESSIONS — EXPERIAN
// ═══════════════════════════════════════════════════════════════════════════

describe('Experian ACR regression', () => {
  it('RESURGENT/LVNV FUNDING is detected as derogatory', () => {
    const resurgent = EXPERIAN_ACR.derogatory_accounts?.find(
      a => a.creditor_name === 'RESURGENT/LVNV FUNDING'
    );
    expect(resurgent).toBeDefined();
    expect(resurgent!.account_number).toBe('6124XXXX1234');
  });

  it('RESURGENT/LVNV FUNDING is also in collections', () => {
    const resurgentCol = EXPERIAN_ACR.collections?.find(
      c => c.collection_agency === 'RESURGENT/LVNV FUNDING'
    );
    expect(resurgentCol).toBeDefined();
    expect(resurgentCol!.original_creditor).toBe('CREDIT ONE BANK');
  });

  it('all 4 negative tradelines are present', () => {
    expect(EXPERIAN_ACR.derogatory_accounts).toHaveLength(4);
  });

  it('both collections are present', () => {
    expect(EXPERIAN_ACR.collections).toHaveLength(2);
  });

  it('account numbers are exactly as printed', () => {
    const acctNums = EXPERIAN_ACR.derogatory_accounts!.map(a => a.account_number);
    expect(acctNums).toContain('6124XXXX1234');
    expect(acctNums).toContain('5178XXXX5678');
    expect(acctNums).toContain('AFFIRM-XX9012');
    expect(acctNums).toContain('6019XXXX3456');
  });

  it('classifying each tradeline confirms negativity', () => {
    for (const acct of EXPERIAN_ACR.derogatory_accounts!) {
      const result = classifyTradeline(acct);
      expect(result.isNegative).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. KNOWN BUG REGRESSIONS — EQUIFAX
// ═══════════════════════════════════════════════════════════════════════════

describe('Equifax ACR regression', () => {
  it('all 4 Aidvantage accounts are detected', () => {
    const aidvantage = EQUIFAX_ACR.derogatory_accounts?.filter(
      a => a.creditor_name === 'AIDVANTAGE'
    );
    expect(aidvantage).toHaveLength(4);
  });

  it('Aidvantage account numbers are preserved exactly', () => {
    const aidvantageAccts = EQUIFAX_ACR.derogatory_accounts!
      .filter(a => a.creditor_name === 'AIDVANTAGE')
      .map(a => a.account_number);
    expect(aidvantageAccts).toContain('XXXX0110');
    expect(aidvantageAccts).toContain('XXXX0120');
    expect(aidvantageAccts).toContain('XXXX0130');
    expect(aidvantageAccts).toContain('XXXX0140');
  });

  it('Aidvantage accounts are not merged into one', () => {
    const aidvantage = EQUIFAX_ACR.derogatory_accounts?.filter(
      a => a.creditor_name === 'AIDVANTAGE'
    );
    // Each must have a unique account number
    const uniqueAccts = new Set(aidvantage!.map(a => a.account_number));
    expect(uniqueAccts.size).toBe(4);
  });

  it('DISCOVER settled-for-less is detected', () => {
    const discover = EQUIFAX_ACR.derogatory_accounts?.find(
      a => a.creditor_name === 'DISCOVER BANK'
    );
    expect(discover).toBeDefined();
    expect(discover!.status_as_reported).toContain('Settled');
  });

  it('bankruptcy public record is extracted', () => {
    expect(EQUIFAX_ACR.public_records).toHaveLength(1);
    expect(EQUIFAX_ACR.public_records![0].type).toBe('Bankruptcy');
  });

  it('all 5 negative tradelines present', () => {
    expect(EQUIFAX_ACR.derogatory_accounts).toHaveLength(5);
  });

  it('classifying each tradeline confirms negativity', () => {
    for (const acct of EQUIFAX_ACR.derogatory_accounts!) {
      const result = classifyTradeline(acct);
      expect(result.isNegative).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. CREDIT KARMA MULTI-BUREAU
// ═══════════════════════════════════════════════════════════════════════════

describe('Credit Karma multi-bureau regression', () => {
  it('same account on different bureaus is NOT merged', () => {
    const chaseAccounts = CREDIT_KARMA_REPORT.derogatory_accounts?.filter(
      a => a.creditor_name === 'CHASE BANK'
    );
    expect(chaseAccounts).toHaveLength(2);
    const bureaus = chaseAccounts!.map(a => a.bureaus![0]);
    expect(bureaus).toContain('equifax');
    expect(bureaus).toContain('transunion');
  });

  it('NAVY FEDERAL on both bureaus treated as separate entries', () => {
    const nfcu = CREDIT_KARMA_REPORT.derogatory_accounts?.filter(
      a => a.creditor_name === 'NAVY FEDERAL CU'
    );
    expect(nfcu).toHaveLength(2);
  });

  it('COMENITY BANK only on TransUnion', () => {
    const comenity = CREDIT_KARMA_REPORT.derogatory_accounts?.find(
      a => a.creditor_name === 'COMENITY BANK'
    );
    expect(comenity).toBeDefined();
    expect(comenity!.bureaus).toEqual(['transunion']);
  });

  it('total derogatory count = 5 (2 CHASE + 2 NFCU + 1 COMENITY)', () => {
    expect(CREDIT_KARMA_REPORT.derogatory_accounts).toHaveLength(5);
  });

  it('duplicate detection does NOT flag cross-bureau entries', () => {
    const flags = detectDuplicates(CREDIT_KARMA_REPORT.derogatory_accounts!);
    expect(flags).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. SCANNED PDF (LOW CONFIDENCE)
// ═══════════════════════════════════════════════════════════════════════════

describe('Scanned PDF handling', () => {
  it('UNEXTRACTABLE fields are preserved, not skipped', () => {
    const unextractable = SCANNED_PDF_REPORT.derogatory_accounts?.find(
      a => a.account_number === 'UNEXTRACTABLE'
    );
    expect(unextractable).toBeDefined();
    expect(unextractable!.creditor_name).toBe('WELLS FARGO');
    expect(unextractable!.confidence).toBe('low');
  });

  it('UNEXTRACTABLE creditor name is preserved', () => {
    const noCreditor = SCANNED_PDF_REPORT.derogatory_accounts?.find(
      a => a.creditor_name === 'UNEXTRACTABLE'
    );
    expect(noCreditor).toBeDefined();
    expect(noCreditor!.account_number).toBe('XXXX7777');
  });

  it('validation is SKIPPED when no summary counts', () => {
    const result = validateExtraction(SCANNED_PDF_REPORT, SCANNED_PDF_METADATA);
    expect(result.status).toBe('SKIPPED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. FULL POST-PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

describe('Full post-processing pipeline', () => {
  it('processes Experian ACR end-to-end', () => {
    const processed = postProcessReport(structuredClone(EXPERIAN_ACR));
    expect(processed.validation_status).toContain('PASS');
    expect(processed.duplicate_flags).toHaveLength(0);
    expect(processed.tradeline_inventory?.negative_extracted).toBe(4);
    expect(processed.tradeline_inventory?.collections_extracted).toBe(2);
  });

  it('processes Equifax ACR end-to-end', () => {
    const processed = postProcessReport(structuredClone(EQUIFAX_ACR));
    expect(processed.validation_status).toContain('PASS');
    expect(processed.tradeline_inventory?.negative_extracted).toBe(5);
    expect(processed.tradeline_inventory?.public_records_extracted).toBe(1);
  });

  it('processes Credit Karma end-to-end', () => {
    const processed = postProcessReport(structuredClone(CREDIT_KARMA_REPORT));
    expect(processed.tradeline_inventory?.negative_extracted).toBe(5);
    expect(processed.tradeline_inventory?.collections_extracted).toBe(1);
  });

  it('processes summary count report end-to-end', () => {
    const processed = postProcessReport(structuredClone(SUMMARY_COUNT_REPORT));
    expect(processed.validation_status).toContain('PASS');
    expect(processed.tradeline_inventory?.negative_extracted).toBe(2);
  });

  it('all derogatory triggers populated after post-processing', () => {
    const processed = postProcessReport(structuredClone(EXPERIAN_ACR));
    for (const acct of processed.derogatory_accounts!) {
      expect(acct.derogatory_triggers).toBeDefined();
      expect(acct.derogatory_triggers!.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. NEGATIVE KEYWORD DETECTION ON RAW TEXT
// ═══════════════════════════════════════════════════════════════════════════

describe('findNegativeKeywords', () => {
  it('detects multiple keywords', () => {
    const matches = findNegativeKeywords('Account has late payment and is past due with charge off status');
    expect(matches).toContain('late');
    expect(matches).toContain('late payment');
    // 'past due' removed from keywords — isPastDueNegative() handles value-aware detection
    expect(matches).toContain('30 days past due').or; // only context-specific past due variants match
    expect(matches).toContain('charge off');
  });

  it('detects "potentially negative"', () => {
    const matches = findNegativeKeywords('This is a potentially negative item');
    expect(matches).toContain('potentially negative');
  });

  it('returns empty for clean text', () => {
    const matches = findNegativeKeywords('Account is current and in good standing');
    expect(matches).toHaveLength(0);
  });

  it('detects "foreclosure"', () => {
    const matches = findNegativeKeywords('Property went into foreclosure');
    expect(matches).toContain('foreclosure');
  });

  it('detects "repossession"', () => {
    const matches = findNegativeKeywords('Vehicle repossession reported');
    expect(matches).toContain('repossession');
  });
});
