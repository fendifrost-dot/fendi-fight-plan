/**
 * Parser Contract — Client-side mirror of supabase/functions/_shared/parser-contract.ts
 * 
 * This file re-exports the same deterministic rules used by edge functions.
 * The canonical source is the _shared version; this exists for client-side
 * imports, tests, and the existing parser-rules.ts consumers.
 * 
 * DO NOT add rules here that aren't in the _shared version.
 */

// ─── Negative Status Keywords ──────────────────────────────────────────────
export const NEGATIVE_STATUS_KEYWORDS: readonly string[] = [
  'late', 'late payment', 'late payments',
  '30 days late', '60 days late', '90 days late', '120 days late', '150 days late',
  '30-day late', '60-day late', '90-day late', '120-day late', '150-day late',
  'potentially negative', 'past due', 'past-due',
  'derogatory', 'charge off', 'charged off', 'charged-off', 'chargeoff',
  'written off', 'write off', 'write-off',
  'collection', 'collections', 'repossession', 'foreclosure',
  'settled', 'settled for less',
  'bankruptcy', 'included in bankruptcy', 'profit and loss write-off',
] as const;

export const NEGATIVE_SECTION_HEADERS: readonly string[] = [
  'potentially negative items', 'negative accounts', 'adverse accounts',
  'collection accounts', 'derogatory',
] as const;

export const NEGATIVE_GRID_CODES: readonly string[] = ['2', '3', '4', '5', 'X', 'CO', 'D'] as const;
export const OK_GRID_CODES: readonly string[] = ['OK', 'C', '0', '1', '', '-', '—', 'N/A'] as const;

export const PRIMARY_BLOCK_ANCHORS: readonly string[] = [
  'account info', 'account name', 'account number', 'account #',
  'acct no', 'acct #', 'creditor', 'creditor name', 'company name',
  'lender', 'loan number', 'original creditor', 'collection agency',
] as const;

export const SECONDARY_BLOCK_ANCHORS: readonly string[] = [
  'balance', 'status', 'date opened', 'account number', 'payment status', 'account status',
] as const;

export const VALIDATION_THRESHOLDS = {
  UNDER_EXTRACTION_TOLERANCE: 0,
  OVER_EXTRACTION_TOLERANCE: 2,
} as const;

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'incomplete'] as const;
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number];

export const VALID_BUREAUS = ['experian', 'equifax', 'transunion'] as const;
export type BureauName = typeof VALID_BUREAUS[number];

export const PARSER_ERROR_CODES = {
  EXTRACTION_INCOMPLETE: 'EXTRACTION_INCOMPLETE',
  SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
  MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  DUPLICATE_DETECTED: 'DUPLICATE_DETECTED',
  COUNT_MISMATCH: 'COUNT_MISMATCH',
  INVALID_DEROGATORY_LEAK: 'INVALID_DEROGATORY_LEAK',
} as const;

// ─── Positive Status Keywords (clean tradeline detection) ──────────────────
export const POSITIVE_STATUS_KEYWORDS: readonly string[] = [
  'paid or paying as agreed', 'pays as agreed', 'paid as agreed',
  'current', 'open', 'never late', 'account in good standing',
  'closed', 'account closed', 'paid', 'paid in full',
  'transferred', 'account transferred',
] as const;

/**
 * Determine if a tradeline is "clean" — i.e., should NOT be in derogatory_accounts.
 * A tradeline is clean if ALL of:
 * 1. Status is a recognized positive status
 * 2. Past due is $0 or null
 * 3. No negative payment grid codes
 * 4. No derogatory keywords anywhere
 * 5. No negative section header
 * 6. No date_first_delinquency
 */
export function isCleanTradeline(tradeline: any): boolean {
  // Must have a positive status
  const statusText = (tradeline.status_as_reported || tradeline.status || '').toLowerCase().trim();
  const hasPositiveStatus = POSITIVE_STATUS_KEYWORDS.some(kw => statusText.includes(kw));
  if (!hasPositiveStatus) return false;

  // Past due must be $0 or absent
  if (isPastDueNegative(tradeline.past_due_amount)) return false;

  // No negative grid codes
  const gc = findNegativeGridCodes(tradeline.payment_grid_codes);
  if (gc.length > 0) return false;

  // No derogatory keywords in any text field
  const searchTexts = [tradeline.block_text, tradeline.status_as_reported, tradeline.status, tradeline.remarks].filter(Boolean).join(' ');
  const negKw = findNegativeKeywords(searchTexts);
  if (negKw.length > 0) return false;

  // No negative section header
  if (isNegativeSectionHeader(tradeline.section_header)) return false;

  // No date of first delinquency
  if (tradeline.date_first_delinquency) return false;

  return true;
}

// ─── Matching Functions ────────────────────────────────────────────────────

export function wholeWordMatch(text: string, keyword: string): boolean {
  if (!text || !keyword) return false;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'i').test(text);
}

export function findNegativeKeywords(text: string): string[] {
  if (!text) return [];
  const matches: string[] = [];
  for (const kw of NEGATIVE_STATUS_KEYWORDS) {
    if (wholeWordMatch(text, kw)) matches.push(kw);
  }
  return matches;
}

export function isCOChargeOff(text: string, fieldType?: 'status' | 'remark' | 'address' | 'unknown'): boolean {
  if (!text) return false;
  if (!wholeWordMatch(text, 'C/O')) return false;
  if (fieldType === 'status' || fieldType === 'remark') return true;
  if (fieldType === 'address') return false;
  const addressPatterns = /\b(\d{1,5}\s+\w+\s+(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|way|pl|place))\b/i;
  const zipPattern = /\b\d{5}(-\d{4})?\b/;
  if (addressPatterns.test(text) || zipPattern.test(text)) return false;
  return true;
}

export function isPastDueNegative(pastDueStr: string | null | undefined): boolean {
  if (!pastDueStr) return false;
  const cleaned = pastDueStr.replace(/[$,\s]/g, '');
  const amount = parseFloat(cleaned);
  return !isNaN(amount) && amount > 0;
}

export function findNegativeGridCodes(gridStr: string | null | undefined): string[] {
  if (!gridStr) return [];
  return gridStr.split(/[\s,|;]+/).map(c => c.trim().toUpperCase()).filter(Boolean)
    .filter(c => (NEGATIVE_GRID_CODES as readonly string[]).includes(c));
}

export function isNegativeSectionHeader(header: string | null | undefined): boolean {
  if (!header) return false;
  return NEGATIVE_SECTION_HEADERS.some(h => header.toLowerCase().trim().includes(h));
}

export function classifyTradeline(tradeline: any): { isNegative: boolean; triggers: string[] } {
  const triggers: string[] = [];
  const searchTexts = [tradeline.block_text, tradeline.status_as_reported, tradeline.status, tradeline.remarks].filter(Boolean).join(' ');
  triggers.push(...findNegativeKeywords(searchTexts));
  if (tradeline.status_as_reported && isCOChargeOff(tradeline.status_as_reported, 'status')) triggers.push('C/O (status)');
  if (tradeline.status && isCOChargeOff(tradeline.status, 'status')) triggers.push('C/O (status)');
  if (tradeline.remarks && isCOChargeOff(tradeline.remarks, 'remark')) triggers.push('C/O (remark)');
  if (isPastDueNegative(tradeline.past_due_amount)) triggers.push(`past due > $0 (${tradeline.past_due_amount})`);
  const gc = findNegativeGridCodes(tradeline.payment_grid_codes);
  if (gc.length) triggers.push(`grid codes: ${gc.join(', ')}`);
  if (isNegativeSectionHeader(tradeline.section_header)) triggers.push(`section: ${tradeline.section_header}`);
  if (tradeline.date_first_delinquency) triggers.push(`date of first delinquency: ${tradeline.date_first_delinquency}`);
  return { isNegative: triggers.length > 0, triggers };
}

export function detectDuplicates(tradelines: any[]): any[] {
  if (!tradelines || tradelines.length < 2) return [];
  const seen = new Map<string, number[]>();
  for (let i = 0; i < tradelines.length; i++) {
    const t = tradelines[i];
    const name = (t.creditor_name || t.creditorName || '').trim().toUpperCase();
    const acct = (t.account_number || t.maskedAccountNumber || '').trim().toUpperCase();
    const bureau = (t.bureaus?.[0] || 'unknown').toLowerCase();
    const key = `${bureau}|${name}|${acct}`;
    if (!seen.has(key)) seen.set(key, [i]); else seen.get(key)!.push(i);
  }
  const flags: any[] = [];
  for (const [key, indices] of seen) {
    if (indices.length > 1) {
      const [bureau, name, acct] = key.split('|');
      flags.push({ creditor_name: name, account_number: acct, bureau, indices, message: `POSSIBLE DUPLICATE — verify against source report. (${indices.length} entries)` });
    }
  }
  return flags;
}
