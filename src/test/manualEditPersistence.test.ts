/**
 * Manual Edit Persistence Regression Tests
 *
 * Proves:
 * 1. removeFromDerogatory moves item to clean_accounts with override metadata
 * 2. moveToManualReview moves item to manual_review_accounts with override metadata
 * 3. restoreToDerogatory moves item back to derogatory_accounts with override metadata
 * 4. inquiries remain intact after manual bucket edits
 * 5. identity mismatch arrays remain intact after manual bucket edits
 * 6. canonical result shape is unchanged after save/load cycle (hydrateCanonicalResult roundtrip)
 * 7. override audit trail metadata is preserved through hydration
 */

import { describe, it, expect } from 'vitest';
import { hydrateCanonicalResult, createEmptyCanonicalResult, type CanonicalAnalyzerResult } from '@/types/disputes';

// Simulate the canonical result a backend would produce
function buildTestResult(): CanonicalAnalyzerResult {
  return hydrateCanonicalResult({
    derogatory_accounts: [
      { creditor_name: 'TBOM/MILSTNE', account_number: '1234', confidence: 'high', derogatory_triggers: ['charged off'] },
      { creditor_name: 'CAPITAL ONE', account_number: '5678', confidence: 'medium', derogatory_triggers: ['collection'] },
    ],
    manual_review_accounts: [
      { creditor_name: 'SELFINC/LEAD', account_number: 'D0000', confidence: 'medium' },
    ],
    clean_accounts: [
      { creditor_name: 'CHASE', account_number: '9999', confidence: 'high' },
    ],
    collections: [{ creditor_name: 'MIDLAND', account_number: 'C001', balance: '$500' }],
    charge_offs: [{ creditor_name: 'CO_BANK', account_number: 'CO01' }],
    inquiries: [
      { creditor_name: 'EVOLVE/SPARR', date: 'Sep 9, 2024', type: 'hard' },
      { creditor_name: 'TBOM/MILESTO', date: 'Sep 13, 2023', type: 'hard' },
    ],
    public_records: [{ type: 'Bankruptcy', filing_date: '01/2020' }],
    inaccurate_names: [{ reported_name: 'JOHN DOW', mismatch_reason: 'Misspelling' }],
    inaccurate_addresses: [{ reported_address: '456 Old St', linked_to_derogatory: true }],
    inaccurate_employers: [{ reported_employer: 'Old Corp' }],
    extra_identifier_mismatches: [{ field: 'SSN', reported_value: '***1111' }],
    _contract_version: 'v2-canonical',
  });
}

// Simulate what moveToManualReview does in AIAnalyzer
function simulateMoveToManualReview(result: CanonicalAnalyzerResult, item: any): CanonicalAnalyzerResult {
  return {
    ...result,
    derogatory_accounts: result.derogatory_accounts.filter(a =>
      a.creditor_name !== item.creditor_name || a.account_number !== item.account_number
    ),
    manual_review_accounts: [...result.manual_review_accounts, {
      ...item,
      _manual_override: true,
      _manual_override_action: 'moved_to_manual_review',
      _manual_override_at: '2026-03-10T00:00:00.000Z',
    }],
  };
}

// Simulate what removeFromDerogatory does
function simulateRemoveFromDerogatory(result: CanonicalAnalyzerResult, item: any): CanonicalAnalyzerResult {
  return {
    ...result,
    derogatory_accounts: result.derogatory_accounts.filter(a =>
      a.creditor_name !== item.creditor_name || a.account_number !== item.account_number
    ),
    clean_accounts: [...result.clean_accounts, {
      ...item,
      _manual_override: true,
      _manual_override_action: 'removed_from_derogatory',
      _manual_override_at: '2026-03-10T00:00:00.000Z',
    }],
  };
}

// Simulate what restoreToDerogatory does
function simulateRestoreToDerogatory(result: CanonicalAnalyzerResult, item: any): CanonicalAnalyzerResult {
  return {
    ...result,
    manual_review_accounts: result.manual_review_accounts.filter(a =>
      a.creditor_name !== item.creditor_name || a.account_number !== item.account_number
    ),
    derogatory_accounts: [...result.derogatory_accounts, {
      ...item,
      _manual_override: true,
      _manual_override_action: 'restored_to_derogatory',
      _manual_override_at: '2026-03-10T00:00:00.000Z',
    }],
  };
}

describe('Manual Edit: removeFromDerogatory', () => {
  it('moves item to clean_accounts with override metadata', () => {
    const result = buildTestResult();
    const item = result.derogatory_accounts[0]; // TBOM/MILSTNE
    const edited = simulateRemoveFromDerogatory(result, item);

    expect(edited.derogatory_accounts).toHaveLength(1);
    expect(edited.derogatory_accounts[0].creditor_name).toBe('CAPITAL ONE');
    expect(edited.clean_accounts).toHaveLength(2); // CHASE + moved item
    const moved = edited.clean_accounts.find((a: any) => a.creditor_name === 'TBOM/MILSTNE');
    expect(moved).toBeDefined();
    expect(moved._manual_override).toBe(true);
    expect(moved._manual_override_action).toBe('removed_from_derogatory');
    expect(moved._manual_override_at).toBeTruthy();
  });

  it('survives hydration roundtrip (simulates DB persist + reload)', () => {
    const result = buildTestResult();
    const edited = simulateRemoveFromDerogatory(result, result.derogatory_accounts[0]);
    const rehydrated = hydrateCanonicalResult(edited);

    expect(rehydrated.derogatory_accounts).toHaveLength(1);
    expect(rehydrated.clean_accounts).toHaveLength(2);
    const moved = rehydrated.clean_accounts.find((a: any) => a.creditor_name === 'TBOM/MILSTNE');
    expect(moved._manual_override).toBe(true);
  });
});

describe('Manual Edit: moveToManualReview', () => {
  it('moves item to manual_review_accounts with override metadata', () => {
    const result = buildTestResult();
    const item = result.derogatory_accounts[1]; // CAPITAL ONE
    const edited = simulateMoveToManualReview(result, item);

    expect(edited.derogatory_accounts).toHaveLength(1);
    expect(edited.manual_review_accounts).toHaveLength(2); // SELFINC + CAPITAL ONE
    const moved = edited.manual_review_accounts.find((a: any) => a.creditor_name === 'CAPITAL ONE');
    expect(moved).toBeDefined();
    expect(moved._manual_override).toBe(true);
    expect(moved._manual_override_action).toBe('moved_to_manual_review');
  });

  it('survives hydration roundtrip', () => {
    const result = buildTestResult();
    const edited = simulateMoveToManualReview(result, result.derogatory_accounts[1]);
    const rehydrated = hydrateCanonicalResult(edited);

    expect(rehydrated.manual_review_accounts).toHaveLength(2);
    const moved = rehydrated.manual_review_accounts.find((a: any) => a.creditor_name === 'CAPITAL ONE');
    expect(moved._manual_override).toBe(true);
  });
});

describe('Manual Edit: restoreToDerogatory', () => {
  it('moves item from manual_review back to derogatory with override metadata', () => {
    const result = buildTestResult();
    const item = result.manual_review_accounts[0]; // SELFINC/LEAD
    const edited = simulateRestoreToDerogatory(result, item);

    expect(edited.manual_review_accounts).toHaveLength(0);
    expect(edited.derogatory_accounts).toHaveLength(3); // 2 original + restored
    const restored = edited.derogatory_accounts.find((a: any) => a.creditor_name === 'SELFINC/LEAD');
    expect(restored).toBeDefined();
    expect(restored._manual_override).toBe(true);
    expect(restored._manual_override_action).toBe('restored_to_derogatory');
  });

  it('survives hydration roundtrip', () => {
    const result = buildTestResult();
    const edited = simulateRestoreToDerogatory(result, result.manual_review_accounts[0]);
    const rehydrated = hydrateCanonicalResult(edited);

    expect(rehydrated.derogatory_accounts).toHaveLength(3);
    const restored = rehydrated.derogatory_accounts.find((a: any) => a.creditor_name === 'SELFINC/LEAD');
    expect(restored._manual_override).toBe(true);
  });
});

describe('Non-account entities survive manual edits', () => {
  it('inquiries remain intact after removeFromDerogatory', () => {
    const result = buildTestResult();
    const edited = simulateRemoveFromDerogatory(result, result.derogatory_accounts[0]);
    expect(edited.inquiries).toHaveLength(2);
    expect(edited.inquiries[0].creditor_name).toBe('EVOLVE/SPARR');
  });

  it('inquiries remain intact after moveToManualReview', () => {
    const result = buildTestResult();
    const edited = simulateMoveToManualReview(result, result.derogatory_accounts[0]);
    expect(edited.inquiries).toHaveLength(2);
  });

  it('identity mismatch arrays remain intact after all manual edits', () => {
    let result = buildTestResult();
    result = simulateRemoveFromDerogatory(result, result.derogatory_accounts[0]);
    result = simulateMoveToManualReview(result, result.derogatory_accounts[0]);

    expect(result.inaccurate_names).toHaveLength(1);
    expect(result.inaccurate_names[0].reported_name).toBe('JOHN DOW');
    expect(result.inaccurate_addresses).toHaveLength(1);
    expect(result.inaccurate_employers).toHaveLength(1);
    expect(result.extra_identifier_mismatches).toHaveLength(1);
    expect(result.collections).toHaveLength(1);
    expect(result.charge_offs).toHaveLength(1);
    expect(result.public_records).toHaveLength(1);
  });

  it('inquiries survive hydration roundtrip after manual edits', () => {
    const result = buildTestResult();
    const edited = simulateRemoveFromDerogatory(result, result.derogatory_accounts[0]);
    const rehydrated = hydrateCanonicalResult(edited);
    expect(rehydrated.inquiries).toHaveLength(2);
    expect(rehydrated.inaccurate_names).toHaveLength(1);
    expect(rehydrated.inaccurate_addresses).toHaveLength(1);
    expect(rehydrated.inaccurate_employers).toHaveLength(1);
  });
});

describe('Canonical shape preserved after save/load cycle', () => {
  it('all required fields present after hydration of edited result', () => {
    const result = buildTestResult();
    const edited = simulateRemoveFromDerogatory(result, result.derogatory_accounts[0]);
    const rehydrated = hydrateCanonicalResult(edited);

    // Every canonical field must exist
    expect(Array.isArray(rehydrated.derogatory_accounts)).toBe(true);
    expect(Array.isArray(rehydrated.manual_review_accounts)).toBe(true);
    expect(Array.isArray(rehydrated.clean_accounts)).toBe(true);
    expect(Array.isArray(rehydrated.all_tradelines)).toBe(true);
    expect(Array.isArray(rehydrated.collections)).toBe(true);
    expect(Array.isArray(rehydrated.charge_offs)).toBe(true);
    expect(Array.isArray(rehydrated.inquiries)).toBe(true);
    expect(Array.isArray(rehydrated.public_records)).toBe(true);
    expect(Array.isArray(rehydrated.inaccurate_names)).toBe(true);
    expect(Array.isArray(rehydrated.inaccurate_addresses)).toBe(true);
    expect(Array.isArray(rehydrated.inaccurate_employers)).toBe(true);
    expect(Array.isArray(rehydrated.extra_identifier_mismatches)).toBe(true);
    expect(Array.isArray(rehydrated.validation_messages)).toBe(true);
    expect(Array.isArray(rehydrated.duplicate_flags)).toBe(true);
    expect(Array.isArray(rehydrated.warnings)).toBe(true);
    expect(rehydrated._contract_version).toBe('v2-canonical');
  });

  it('override metadata survives JSON serialization roundtrip', () => {
    const result = buildTestResult();
    const edited = simulateMoveToManualReview(result, result.derogatory_accounts[0]);
    // Simulate DB storage: JSON.stringify -> JSON.parse -> hydrateCanonicalResult
    const serialized = JSON.parse(JSON.stringify(edited));
    const rehydrated = hydrateCanonicalResult(serialized);

    const moved = rehydrated.manual_review_accounts.find((a: any) => a.creditor_name === 'TBOM/MILSTNE');
    expect(moved).toBeDefined();
    expect(moved._manual_override).toBe(true);
    expect(moved._manual_override_action).toBe('moved_to_manual_review');
    expect(typeof moved._manual_override_at).toBe('string');
  });
});
