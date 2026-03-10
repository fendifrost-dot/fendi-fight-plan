/**
 * Result Normalizer — Regression Tests
 * Tests all 7 normalization rules and roundtrip integrity.
 */
import { describe, it, expect } from 'vitest';

// We test the logic by importing a client-side mirror.
// The actual edge function uses the _shared version with identical logic.
import {
  normalizeCreditorName,
  normalizeAccountNumber,
  normalizeBalance,
  normalizeDate,
  normalizeCanonicalResult,
} from '@/lib/result-normalizer';

// ── 1. Creditor Name Normalization ──

describe('normalizeCreditorName', () => {
  it('normalizes slashes and dashes to spaces', () => {
    expect(normalizeCreditorName('TBOM/MILSTNE')).toBe('TBOM MILSTNE');
    expect(normalizeCreditorName('TBOM-MILESTONE')).toBe('THE BANK OF MISSOURI');
    expect(normalizeCreditorName('TBOM_MILESTONE')).toBe('THE BANK OF MISSOURI');
  });

  it('uppercases and collapses whitespace', () => {
    expect(normalizeCreditorName('tbom  milestone')).toBe('THE BANK OF MISSOURI');
  });

  it('produces identical output for equivalent inputs', () => {
    expect(normalizeCreditorName('TBOM/MILSTNE')).toBe(normalizeCreditorName('TBOM MILSTNE'));
  });

  it('passes through null/undefined', () => {
    expect(normalizeCreditorName(null)).toBeNull();
    expect(normalizeCreditorName(undefined)).toBeUndefined();
  });
});

// ── 2. Account Number Normalization ──

describe('normalizeAccountNumber', () => {
  it('strips masking and keeps last 4', () => {
    expect(normalizeAccountNumber('****1234')).toBe('1234');
    expect(normalizeAccountNumber('XXX-1234')).toBe('1234');
  });

  it('keeps short numbers as-is', () => {
    expect(normalizeAccountNumber('1234')).toBe('1234');
  });

  it('preserves contract placeholders', () => {
    expect(normalizeAccountNumber('N/A')).toBe('N/A');
    expect(normalizeAccountNumber('UNEXTRACTABLE')).toBe('UNEXTRACTABLE');
  });
});

// ── 3. Balance Normalization ──

describe('normalizeBalance', () => {
  it('strips $ and commas', () => {
    expect(normalizeBalance('$1,234')).toBe('1234');
    expect(normalizeBalance('1234.00')).toBe('1234');
    expect(normalizeBalance('1 234')).toBe('1234');
  });

  it('handles numeric input', () => {
    expect(normalizeBalance(1234.5)).toBe('1235');
  });

  it('returns null for null/undefined', () => {
    expect(normalizeBalance(null)).toBeNull();
    expect(normalizeBalance(undefined)).toBeNull();
  });
});

// ── 4. Date Standardization ──

describe('normalizeDate', () => {
  it('converts MM/DD/YYYY', () => {
    expect(normalizeDate('09/09/2024')).toBe('2024-09-09');
  });

  it('converts Mon DD, YYYY', () => {
    expect(normalizeDate('Sep 9, 2024')).toBe('2024-09-09');
  });

  it('keeps YYYY-MM-DD as-is', () => {
    expect(normalizeDate('2024-09-09')).toBe('2024-09-09');
  });

  it('converts DD Mon YYYY', () => {
    expect(normalizeDate('9 Sep 2024')).toBe('2024-09-09');
  });

  it('passes through null', () => {
    expect(normalizeDate(null)).toBeNull();
  });
});

// ── 5. Duplicate Tradeline Merge ──

describe('normalizeCanonicalResult — duplicates', () => {
  it('merges exact duplicates within same bucket and bureau', () => {
    const result = normalizeCanonicalResult({
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'], confidence: 'low', derogatory_triggers: ['late'] },
        { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'], confidence: 'high', derogatory_triggers: ['collection'] },
      ],
      manual_review_accounts: [],
      clean_accounts: [],
    });

    expect(result.derogatory_accounts).toHaveLength(1);
    expect(result.derogatory_accounts[0].confidence).toBe('high');
    expect(result.derogatory_accounts[0].derogatory_triggers).toContain('late');
    expect(result.derogatory_accounts[0].derogatory_triggers).toContain('collection');
    expect(result.duplicate_flags.length).toBeGreaterThan(0);
  });

  it('does NOT merge cross-bureau tradelines', () => {
    const result = normalizeCanonicalResult({
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'] },
        { creditor_name: 'ACME', account_number: '1234', bureaus: ['equifax'] },
      ],
    });

    expect(result.derogatory_accounts).toHaveLength(2);
  });
});

// ── 6. Bureau Inference ──

describe('normalizeCanonicalResult — bureau inference', () => {
  it('infers bureau from source field', () => {
    const result = normalizeCanonicalResult({
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '1234', source: 'Experian report' },
      ],
    });

    expect(result.derogatory_accounts[0].bureaus).toEqual(['experian']);
  });

  it('defaults to unknown when no bureau info', () => {
    const result = normalizeCanonicalResult({
      derogatory_accounts: [
        { creditor_name: 'ACME', account_number: '1234' },
      ],
    });

    expect(result.derogatory_accounts[0].bureaus).toEqual(['unknown']);
  });
});

// ── 7. Confidence Normalization ──

describe('normalizeCanonicalResult — confidence', () => {
  it('maps non-standard confidence values', () => {
    const result = normalizeCanonicalResult({
      derogatory_accounts: [
        { creditor_name: 'A', account_number: '1', confidence: 'very_high' },
        { creditor_name: 'B', account_number: '2', confidence: 'probable', bureaus: ['equifax'] },
        { creditor_name: 'C', account_number: '3', confidence: 'uncertain', bureaus: ['transunion'] },
      ],
    });

    expect(result.derogatory_accounts[0].confidence).toBe('high');
    expect(result.derogatory_accounts[1].confidence).toBe('medium');
    expect(result.derogatory_accounts[2].confidence).toBe('low');
  });
});

// ── 8. Non-account entity preservation ──

describe('normalizeCanonicalResult — entity preservation', () => {
  it('preserves inquiries, identity mismatches, and public records', () => {
    const result = normalizeCanonicalResult({
      derogatory_accounts: [{ creditor_name: 'ACME', account_number: '1234', bureaus: ['experian'] }],
      inquiries: [{ creditor_name: 'bank of america', date: '09/15/2024' }],
      public_records: [{ type: 'bankruptcy', date_filed: 'Jan 1, 2020' }],
      inaccurate_names: [{ reported: 'JOHN DOE', correct: 'JANE DOE' }],
      inaccurate_addresses: [{ reported: '123 Main' }],
      inaccurate_employers: [{ reported: 'ACME Inc' }],
      extra_identifier_mismatches: [{ field: 'SSN' }],
      collections: [{ collection_agency: 'col/agency', balance: '$500' }],
    });

    expect(result.inquiries).toHaveLength(1);
    expect(result.inquiries[0].creditor_name).toBe('BANK OF AMERICA');
    expect(result.inquiries[0].date).toBe('2024-09-15');
    expect(result.public_records).toHaveLength(1);
    expect(result.public_records[0].date_filed).toBe('2020-01-01');
    expect(result.inaccurate_names).toHaveLength(1);
    expect(result.inaccurate_addresses).toHaveLength(1);
    expect(result.inaccurate_employers).toHaveLength(1);
    expect(result.extra_identifier_mismatches).toHaveLength(1);
    expect(result.collections[0].collection_agency).toBe('COL AGENCY');
    expect(result.collections[0].balance).toBe('500');
  });
});

// ── 9. Full roundtrip ──

describe('normalizeCanonicalResult — roundtrip', () => {
  it('survives JSON serialize/deserialize', () => {
    const input = {
      derogatory_accounts: [
        { creditor_name: 'TBOM/MILESTONE', account_number: '****5678', balance: '$2,500', bureaus: ['experian'], confidence: 'very_high', date_opened: 'Mar 15, 2022' },
      ],
      manual_review_accounts: [],
      clean_accounts: [],
      inquiries: [{ creditor_name: 'Chase', date: '01/01/2024' }],
      collections: [],
      charge_offs: [],
      public_records: [],
      inaccurate_names: [],
      inaccurate_addresses: [],
      inaccurate_employers: [],
      extra_identifier_mismatches: [],
    };

    const normalized = normalizeCanonicalResult(input);
    const roundtripped = JSON.parse(JSON.stringify(normalized));

    expect(roundtripped.derogatory_accounts[0].creditor_name).toBe('TBOM MILESTONE');
    expect(roundtripped.derogatory_accounts[0].account_number).toBe('5678');
    expect(roundtripped.derogatory_accounts[0].balance).toBe('2500');
    expect(roundtripped.derogatory_accounts[0].confidence).toBe('high');
    expect(roundtripped.derogatory_accounts[0].date_opened).toBe('2022-03-15');
    expect(roundtripped.inquiries[0].date).toBe('2024-01-01');
  });
});
