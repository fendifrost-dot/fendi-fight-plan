/**
 * Canonical Contract Regression Tests
 * 
 * Proves:
 * 1. sync and async paths produce the same canonical shape
 * 2. inquiries survive hydration
 * 3. identity mismatches survive hydration
 * 4. clean accounts never leak into derogatory_accounts
 * 5. manual_review_accounts are preserved
 * 6. cross-bureau rows remain separate
 * 7. no frontend confidence recalculation
 * 8. collections/charge_offs/public_records are not zeroed out
 * 9. partial recovery preserves all entity arrays
 * 10. contract version is present
 */

import { describe, it, expect } from 'vitest';
import { hydrateCanonicalResult, createEmptyCanonicalResult, type CanonicalAnalyzerResult } from '@/types/disputes';
import { parseJobResult, parseCheckpointResult, PARSER_CONTRACT_VERSION } from '@/lib/analysisJobs';

// Simulated sync (analyze-response) output
const SYNC_RESULT = {
  derogatory_accounts: [
    { creditor_name: 'TBOM/MILSTNE', account_number: '1234', confidence: 'high', derogatory_triggers: ['charged off as bad debt'], status_as_reported: 'Charged off' },
  ],
  manual_review_accounts: [
    { creditor_name: 'SELFINC/LEAD', account_number: 'D0000', confidence: 'medium', derogatory_triggers: ['historical grid code 2'] },
  ],
  clean_accounts: [
    { creditor_name: 'CHASE', account_number: '9999', confidence: 'high', status_as_reported: 'Paid as agreed' },
  ],
  all_tradelines: [
    { creditor_name: 'TBOM/MILSTNE', account_number: '1234' },
    { creditor_name: 'SELFINC/LEAD', account_number: 'D0000' },
    { creditor_name: 'CHASE', account_number: '9999' },
  ],
  collections: [{ creditor_name: 'MIDLAND', account_number: 'C001', balance: '$500' }],
  charge_offs: [{ creditor_name: 'CAPITAL ONE', account_number: 'CO01', balance: '$1200' }],
  inquiries: [
    { creditor_name: 'EVOLVE/SPARR', date: 'Sep 9, 2024', type: 'hard' },
    { creditor_name: 'TBOM/MILESTO', date: 'Sep 13, 2023', type: 'hard' },
  ],
  public_records: [{ type: 'Bankruptcy', filing_date: '01/2020', court_jurisdiction: 'US Bankruptcy Court', status: 'Discharged' }],
  inaccurate_names: [{ reported_name: 'JOHN DOW', mismatch_reason: 'Misspelling' }],
  inaccurate_addresses: [{ reported_address: '456 Old St', linked_to_derogatory: true }],
  inaccurate_employers: [{ reported_employer: 'Old Corp' }],
  extra_identifier_mismatches: [{ field: 'SSN', reported_value: '***1111', status: 'Mismatch' }],
  tradeline_inventory: { total: 3, derogatory_count: 1, manual_review_count: 1, clean_count: 1 },
  validation_status: 'PASS',
  validation_messages: ['Counts reconciled'],
  duplicate_flags: [],
  warnings: [],
  report_metadata: { bureau: 'TransUnion' },
  _contract_version: 'v2-canonical',
};

// Simulated async (worker result_data) output — same shape
const ASYNC_RESULT = { ...SYNC_RESULT };

describe('Canonical Contract Shape', () => {
  it('sync and async results hydrate to the same shape', () => {
    const syncHydrated = hydrateCanonicalResult(SYNC_RESULT);
    const asyncHydrated = parseJobResult(ASYNC_RESULT);

    const keys: (keyof CanonicalAnalyzerResult)[] = [
      'derogatory_accounts', 'manual_review_accounts', 'clean_accounts',
      'all_tradelines', 'collections', 'charge_offs', 'inquiries', 'public_records',
      'inaccurate_names', 'inaccurate_addresses', 'inaccurate_employers',
      'extra_identifier_mismatches', 'validation_status', 'validation_messages',
      'duplicate_flags', 'warnings',
    ];

    for (const key of keys) {
      expect(syncHydrated[key]).toEqual(asyncHydrated[key]);
    }
  });

  it('contract version is present in hydrated result', () => {
    const hydrated = hydrateCanonicalResult(SYNC_RESULT);
    expect(hydrated._contract_version).toBe('v2-canonical');
  });

  it('PARSER_CONTRACT_VERSION constant matches', () => {
    expect(PARSER_CONTRACT_VERSION).toBe('v2-canonical');
  });
});

describe('Inquiry Survival', () => {
  it('inquiries survive sync hydration', () => {
    const hydrated = hydrateCanonicalResult(SYNC_RESULT);
    expect(hydrated.inquiries).toHaveLength(2);
    expect(hydrated.inquiries[0].creditor_name).toBe('EVOLVE/SPARR');
    expect(hydrated.inquiries[1].creditor_name).toBe('TBOM/MILESTO');
  });

  it('inquiries survive async hydration', () => {
    const hydrated = parseJobResult(ASYNC_RESULT);
    expect(hydrated.inquiries).toHaveLength(2);
  });

  it('inquiries survive from legacy _inquiries side-cargo', () => {
    const legacy = { _inquiries: [{ creditor_name: 'LEGACY', date: '2024-01-01', type: 'hard' }] };
    const hydrated = hydrateCanonicalResult(legacy);
    expect(hydrated.inquiries).toHaveLength(1);
    expect(hydrated.inquiries[0].creditor_name).toBe('LEGACY');
  });
});

describe('Identity Mismatch Survival', () => {
  it('all identity fields survive hydration', () => {
    const hydrated = hydrateCanonicalResult(SYNC_RESULT);
    expect(hydrated.inaccurate_names).toHaveLength(1);
    expect(hydrated.inaccurate_addresses).toHaveLength(1);
    expect(hydrated.inaccurate_employers).toHaveLength(1);
    expect(hydrated.extra_identifier_mismatches).toHaveLength(1);
  });
});

describe('Clean Account Exclusion', () => {
  it('clean accounts are NOT in derogatory_accounts', () => {
    const hydrated = hydrateCanonicalResult(SYNC_RESULT);
    const cleanNames = hydrated.clean_accounts.map(a => a.creditor_name);
    const derogNames = hydrated.derogatory_accounts.map(a => a.creditor_name);
    for (const name of cleanNames) {
      expect(derogNames).not.toContain(name);
    }
  });

  it('clean_accounts are preserved as separate bucket', () => {
    const hydrated = hydrateCanonicalResult(SYNC_RESULT);
    expect(hydrated.clean_accounts).toHaveLength(1);
    expect(hydrated.clean_accounts[0].creditor_name).toBe('CHASE');
  });
});

describe('Manual Review Preservation', () => {
  it('manual_review_accounts are preserved', () => {
    const hydrated = hydrateCanonicalResult(SYNC_RESULT);
    expect(hydrated.manual_review_accounts).toHaveLength(1);
    expect(hydrated.manual_review_accounts[0].creditor_name).toBe('SELFINC/LEAD');
  });
});

describe('Cross-Bureau Separation', () => {
  it('same account from different bureaus remains separate rows', () => {
    const multiBureau = {
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'] },
        { creditor_name: 'ACME', account_number: '1234', bureaus: ['equifax'] },
      ],
    };
    const hydrated = hydrateCanonicalResult(multiBureau);
    expect(hydrated.derogatory_accounts).toHaveLength(2);
  });
});

describe('No Frontend Confidence Recalculation', () => {
  it('confidence string is preserved as-is from backend', () => {
    const hydrated = hydrateCanonicalResult(SYNC_RESULT);
    expect(hydrated.derogatory_accounts[0].confidence).toBe('high');
    expect(hydrated.manual_review_accounts[0].confidence).toBe('medium');
    // Frontend MUST NOT convert to number
  });
});

describe('Entity Arrays Not Zeroed Out', () => {
  it('collections are preserved through async hydration', () => {
    const hydrated = parseJobResult(ASYNC_RESULT);
    expect(hydrated.collections).toHaveLength(1);
    expect(hydrated.collections[0].creditor_name).toBe('MIDLAND');
  });

  it('charge_offs are preserved through async hydration', () => {
    const hydrated = parseJobResult(ASYNC_RESULT);
    expect(hydrated.charge_offs).toHaveLength(1);
  });

  it('public_records are preserved through async hydration', () => {
    const hydrated = parseJobResult(ASYNC_RESULT);
    expect(hydrated.public_records).toHaveLength(1);
  });
});

describe('Partial Recovery', () => {
  it('parseCheckpointResult preserves all entity arrays including identity', () => {
    const checkpoints = {
      documentMap: null,
      accounts: [{ creditor_name: 'PARTIAL', account_number: 'P001', confidence: 'high' }],
      collections: [{ creditor_name: 'COLL', account_number: 'C001' }],
      inquiries: [{ creditor_name: 'INQ', date: '2024-01-01', type: 'hard' }],
      publicRecords: [{ type: 'Judgment', filing_date: '2023-06' }],
      chargeOffs: [{ creditor_name: 'CO', account_number: 'CO1' }],
      inaccurateNames: [{ reported_name: 'JOHN DOW', mismatch_reason: 'Misspelling' }],
      inaccurateAddresses: [{ reported_address: '456 Old St', linked_to_derogatory: true }],
      inaccurateEmployers: [{ reported_employer: 'Old Corp' }],
      extraIdentifierMismatches: [{ field: 'SSN', reported_value: '***1111' }],
      processedChunks: 3,
      totalChunks: 5,
      failedChunks: [4],
    };

    const result = parseCheckpointResult(checkpoints);
    expect(result).not.toBeNull();
    expect(result!.derogatory_accounts).toHaveLength(1);
    expect(result!.collections).toHaveLength(1);
    expect(result!.inquiries).toHaveLength(1);
    expect(result!.public_records).toHaveLength(1);
    expect(result!.charge_offs).toHaveLength(1);
    expect(result!.inaccurate_names).toHaveLength(1);
    expect(result!.inaccurate_names[0].reported_name).toBe('JOHN DOW');
    expect(result!.inaccurate_addresses).toHaveLength(1);
    expect(result!.inaccurate_employers).toHaveLength(1);
    expect(result!.extra_identifier_mismatches).toHaveLength(1);
  });

  it('returns null for empty checkpoints', () => {
    const result = parseCheckpointResult({
      documentMap: null,
      accounts: [],
      processedChunks: 0,
      totalChunks: 5,
      failedChunks: [],
    });
    expect(result).toBeNull();
  });
});

describe('Empty Canonical Result', () => {
  it('createEmptyCanonicalResult has all required fields', () => {
    const empty = createEmptyCanonicalResult();
    expect(empty.derogatory_accounts).toEqual([]);
    expect(empty.manual_review_accounts).toEqual([]);
    expect(empty.clean_accounts).toEqual([]);
    expect(empty.all_tradelines).toEqual([]);
    expect(empty.collections).toEqual([]);
    expect(empty.charge_offs).toEqual([]);
    expect(empty.inquiries).toEqual([]);
    expect(empty.public_records).toEqual([]);
    expect(empty.inaccurate_names).toEqual([]);
    expect(empty.inaccurate_addresses).toEqual([]);
    expect(empty.inaccurate_employers).toEqual([]);
    expect(empty.extra_identifier_mismatches).toEqual([]);
    expect(empty.validation_messages).toEqual([]);
    expect(empty.duplicate_flags).toEqual([]);
    expect(empty.warnings).toEqual([]);
  });
});

describe('Hydration Robustness', () => {
  it('null input returns empty canonical result', () => {
    const hydrated = hydrateCanonicalResult(null);
    expect(hydrated.derogatory_accounts).toEqual([]);
    expect(hydrated.inquiries).toEqual([]);
  });

  it('undefined input returns empty canonical result', () => {
    const hydrated = hydrateCanonicalResult(undefined);
    expect(hydrated.derogatory_accounts).toEqual([]);
  });

  it('partial input preserves available fields', () => {
    const hydrated = hydrateCanonicalResult({
      inquiries: [{ creditor_name: 'TEST', date: '2024', type: 'hard' }],
    });
    expect(hydrated.inquiries).toHaveLength(1);
    expect(hydrated.derogatory_accounts).toEqual([]);
    expect(hydrated.collections).toEqual([]);
  });
});
