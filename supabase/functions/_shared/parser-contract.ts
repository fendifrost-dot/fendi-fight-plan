/**
 * Parser Contract — Single Source of Truth for ALL deterministic parsing rules.
 * 
 * This file is the CANONICAL definition. Any other file referencing these rules
 * MUST import from here. No duplicated constants allowed.
 * 
 * Used by: analyze-chunk, analyze-response, analysis-worker edge functions.
 * Mirrored to: src/lib/parser-contract.ts for client-side use and testing.
 */

// ─── Negative Status Keywords (whole-word boundary matching ONLY) ──────────
// These keywords trigger negative classification when found via whole-word
// boundary match in status, remarks, or block text fields.
// "late" must NOT match "later", "collateral", "translated", etc.

export const NEGATIVE_STATUS_KEYWORDS: readonly string[] = [
  'late',
  'late payment',
  'late payments',
  '30 days late',
  '60 days late',
  '90 days late',
  '120 days late',
  '150 days late',
  '30-day late',
  '60-day late',
  '90-day late',
  '120-day late',
  '150-day late',
  'potentially negative',
  // NOTE: 'past due' removed from keyword list — isPastDueNegative() handles value-aware past due detection.
  // Do NOT re-add 'past due' or 'past-due' here; it causes false positives from field labels.
  'derogatory',
  'charge off',
  'charged off',
  'charged-off',
  'chargeoff',
  'written off',
  'write off',
  'write-off',
  'collection',
  'collections',
  'repossession',
  'foreclosure',
  'settled',
  'settled for less',
  'bankruptcy',
  'included in bankruptcy',
  'profit and loss write-off',
] as const;

// ─── Negative Section Headers ──────────────────────────────────────────────
// If a tradeline appears under any of these section headers, it is negative
// regardless of other indicators.

export const NEGATIVE_SECTION_HEADERS: readonly string[] = [
  'potentially negative items',
  'negative accounts',
  'adverse accounts',
  'collection accounts',
  'derogatory',
] as const;

// ─── Payment Grid Codes ────────────────────────────────────────────────────
// Negative grid codes indicate late payments or derogatory status.
// OK grid codes are non-negative and should be ignored.

export const NEGATIVE_GRID_CODES: readonly string[] = [
  '2',   // 30 days late
  '3',   // 60 days late
  '4',   // 90 days late
  '5',   // 120+ days late
  'X',   // Unknown/derogatory
  'CO',  // Charge off
  'D',   // Derogatory
] as const;

export const OK_GRID_CODES: readonly string[] = [
  'OK', 'C', '0', '1', '', '-', '—', 'N/A',
] as const;

// ─── Block Detection Anchors ───────────────────────────────────────────────
// Used during Pass 1 (Tradeline Inventory) to detect account block boundaries.
// Primary anchors are field labels that START an account block.
// Secondary anchors are uppercase/bold entity names followed by data fields.

export const PRIMARY_BLOCK_ANCHORS: readonly string[] = [
  'account info',
  'account name',
  'account number',
  'account #',
  'acct no',
  'acct #',
  'creditor',
  'creditor name',
  'company name',
  'lender',
  'loan number',
  'original creditor',
  'collection agency',
] as const;

export const SECONDARY_BLOCK_ANCHORS: readonly string[] = [
  'balance',
  'status',
  'date opened',
  'account number',
  'payment status',
  'account status',
] as const;

// ─── Continuation Detection Signals ────────────────────────────────────────
// If a block has payment data but no creditor name, it's a continuation
// from a previous page.

export const CONTINUATION_SIGNALS: readonly string[] = [
  'payment history',
  'payment grid',
] as const;

// ─── Context-Sensitive Keywords ────────────────────────────────────────────
// C/O is negative ONLY in status/remark fields, NOT in address lines.

export const CONTEXT_SENSITIVE_KEYWORDS = {
  'C/O': {
    negative_in: ['status', 'remark', 'account_status'] as const,
    not_negative_in: ['address'] as const,
    heuristic: 'address_pattern' as const,
  },
} as const;

// ─── Validation Thresholds ─────────────────────────────────────────────────
// Used by the Validation Gate to reconcile extracted counts against
// bureau summary metrics.

export const VALIDATION_THRESHOLDS = {
  /** Under-extraction triggers ERROR if extracted < expected */
  UNDER_EXTRACTION_TOLERANCE: 0,
  /** Over-extraction triggers WARNING if extracted > expected + this value */
  OVER_EXTRACTION_TOLERANCE: 2,
} as const;

// ─── Confidence Levels ─────────────────────────────────────────────────────

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'incomplete'] as const;
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number];

// ─── Valid Bureaus ──────────────────────────────────────────────────────────

export const VALID_BUREAUS = ['experian', 'equifax', 'transunion'] as const;
export type BureauName = typeof VALID_BUREAUS[number];

// ─── Error Codes ───────────────────────────────────────────────────────────

export const PARSER_ERROR_CODES = {
  EXTRACTION_INCOMPLETE: 'EXTRACTION_INCOMPLETE',
  SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
  MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  DUPLICATE_DETECTED: 'DUPLICATE_DETECTED',
  COUNT_MISMATCH: 'COUNT_MISMATCH',
  INVALID_DEROGATORY_LEAK: 'INVALID_DEROGATORY_LEAK',
} as const;

// ─── Placeholder / Non-Trigger Values ──────────────────────────────────────
// These values must NEVER count as negative triggers when found as field values.
// They represent missing/unextracted data, not actual negative indicators.
export const PLACEHOLDER_VALUES: readonly string[] = [
  'n/a', 'N/A', 'na', 'NA',
  'unextractable', 'UNEXTRACTABLE',
  'not reported', 'Not Reported', 'NOT REPORTED',
  '', '-', '—', 'null', 'none', 'None', 'NONE',
] as const;

/**
 * Check if a value is a placeholder/non-trigger value.
 * These must never be treated as actual data for trigger purposes.
 */
export function isPlaceholderValue(val: any): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed === '') return true;
  return PLACEHOLDER_VALUES.some(p => trimmed.toLowerCase() === p.toLowerCase());
}

// ─── Positive Status Keywords (clean tradeline detection) ──────────────────
export const POSITIVE_STATUS_KEYWORDS: readonly string[] = [
  'paid or paying as agreed', 'pays as agreed', 'paid as agreed',
  'current', 'open', 'never late', 'account in good standing',
  'closed', 'account closed', 'paid', 'paid in full',
  'transferred', 'account transferred',
] as const;

/**
 * HARD VETO: Determine if a tradeline is "clean" and must NEVER be in derogatory_accounts.
 * This is an absolute veto — even if weak triggers exist, a structurally clean tradeline is excluded.
 * Checks structured fields only (NOT block_text which has AI noise).
 * 
 * A tradeline is clean if ALL of:
 * 1. Positive status keyword present
 * 2. Past due is $0 or null/placeholder
 * 3. No negative payment grid codes
 * 4. No ACTUAL date of first delinquency (placeholders don't count)
 * 5. No negative section header
 * 6. No derogatory keywords in structured fields (status/remarks only, NOT block_text)
 */
export function isCleanTradeline(tradeline: any): boolean {
  const statusText = (tradeline.status_as_reported || tradeline.status || '').toLowerCase().trim();
  const hasPositiveStatus = POSITIVE_STATUS_KEYWORDS.some(kw => statusText.includes(kw));
  if (!hasPositiveStatus) return false;
  if (isPastDueNegative(tradeline.past_due_amount)) return false;
  if (findNegativeGridCodes(tradeline.payment_grid_codes).length > 0) return false;
  // DOFD: only block if it's an actual date, not a placeholder
  if (hasActualDateOfFirstDelinquency(tradeline.date_first_delinquency)) return false;
  if (isNegativeSectionHeader(tradeline.section_header)) return false;
  // Check structured fields only — block_text excluded to prevent AI narrative noise
  const structuredText = [tradeline.status_as_reported, tradeline.status, tradeline.remarks].filter(Boolean).join(' ');
  if (findNegativeKeywords(structuredText).length > 0) return false;
  return true;
}

/**
 * Check if a date_first_delinquency value is an actual date (not a placeholder).
 * Returns true only if the value is a non-placeholder, non-empty string.
 */
export function hasActualDateOfFirstDelinquency(dofd: any): boolean {
  if (isPlaceholderValue(dofd)) return false;
  // Must be a string that looks like a date (contains digits)
  if (typeof dofd !== 'string') return false;
  return /\d/.test(dofd);
}

// ─── Matching Functions ────────────────────────────────────────────────────

/**
 * Check if `keyword` appears as a whole word in `text`.
 * Uses word-boundary regex to avoid substring matches.
 * "late" must NOT match "later", "collateral", "translated".
 */
export function wholeWordMatch(text: string, keyword: string): boolean {
  if (!text || !keyword) return false;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'i');
  return regex.test(text);
}

/**
 * Find all negative keywords in text using whole-word boundary matching.
 */
export function findNegativeKeywords(text: string): string[] {
  if (!text) return [];
  const matches: string[] = [];
  for (const kw of NEGATIVE_STATUS_KEYWORDS) {
    if (wholeWordMatch(text, kw)) {
      matches.push(kw);
    }
  }
  return matches;
}

/**
 * Check if "C/O" in text is a charge-off indicator vs "care of" in address.
 */
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

/**
 * Parse a past due amount string. > $0 = negative. $0 = NOT negative.
 */
export function isPastDueNegative(pastDueStr: string | null | undefined): boolean {
  if (!pastDueStr) return false;
  const cleaned = pastDueStr.replace(/[$,\s]/g, '');
  const amount = parseFloat(cleaned);
  if (isNaN(amount)) return false;
  return amount > 0;
}

/**
 * Parse payment grid string and return any negative codes found.
 */
export function findNegativeGridCodes(gridStr: string | null | undefined): string[] {
  if (!gridStr) return [];
  const codes = gridStr.split(/[\s,|;]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
  return codes.filter(c => (NEGATIVE_GRID_CODES as readonly string[]).includes(c));
}

/**
 * Check if a section header indicates a negative section.
 */
export function isNegativeSectionHeader(header: string | null | undefined): boolean {
  if (!header) return false;
  const lower = header.toLowerCase().trim();
  return NEGATIVE_SECTION_HEADERS.some(h => lower.includes(h));
}

/**
 * Classify a tradeline as negative or not, returning all triggers.
 * This is the core deterministic classifier — Pass 2 logic.
 */
export function classifyTradeline(tradeline: any): { isNegative: boolean; triggers: string[] } {
  const triggers: string[] = [];

  // 1. Status keyword matching — structured fields only (status, remarks)
  //    block_text is excluded because it contains field LABELS like "Past Due Amount:"
  //    that cause false positive keyword matches.
  const structuredSearchTexts = [
    tradeline.status_as_reported,
    tradeline.status,
    tradeline.remarks,
  ].filter(Boolean).join(' ');

  const keywordMatches = findNegativeKeywords(structuredSearchTexts);
  triggers.push(...keywordMatches);

  // 2. C/O in status/remark (not address)
  if (tradeline.status_as_reported && isCOChargeOff(tradeline.status_as_reported, 'status')) {
    triggers.push('C/O (status)');
  }
  if (tradeline.status && isCOChargeOff(tradeline.status, 'status')) {
    triggers.push('C/O (status)');
  }
  if (tradeline.remarks && isCOChargeOff(tradeline.remarks, 'remark')) {
    triggers.push('C/O (remark)');
  }

  // 3. Past Due Amount > $0
  if (isPastDueNegative(tradeline.past_due_amount)) {
    triggers.push(`past due > $0 (${tradeline.past_due_amount})`);
  }

  // 4. Payment grid codes
  const negGridCodes = findNegativeGridCodes(tradeline.payment_grid_codes);
  if (negGridCodes.length > 0) {
    triggers.push(`grid codes: ${negGridCodes.join(', ')}`);
  }

  // 5. Section header
  if (isNegativeSectionHeader(tradeline.section_header)) {
    triggers.push(`section: ${tradeline.section_header}`);
  }

  // 6. Date of First Delinquency — VALUE-AWARE
  // Only trigger if the value is an actual date, not null/N/A/UNEXTRACTABLE/blank
  if (hasActualDateOfFirstDelinquency(tradeline.date_first_delinquency)) {
    triggers.push(`date of first delinquency: ${tradeline.date_first_delinquency}`);
  }

  return {
    isNegative: triggers.length > 0,
    triggers,
  };
}

/**
 * Detect potential duplicates: same creditor + account number + bureau.
 */
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
      flags.push({
        creditor_name: name,
        account_number: acct,
        bureau,
        indices,
        message: `POSSIBLE DUPLICATE — verify against source report. (${indices.length} entries)`,
      });
    }
  }
  return flags;
}
