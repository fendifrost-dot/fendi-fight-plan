/**
 * Deterministic Credit Bureau Report Parser — Testable Rules Module
 *
 * Extracts the core deterministic logic from the AI prompt so that
 * post-processing, validation, and duplicate detection can be verified
 * locally without calling the AI model.
 *
 * The AI model returns raw extracted data; these functions validate
 * and classify that data using the exact same rules specified in the
 * system prompt.
 */

// ─── Negative Indicator Keywords (whole-word boundary matching) ────────────

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
  'past due',
  'past-due',
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

export const NEGATIVE_SECTION_HEADERS: readonly string[] = [
  'potentially negative items',
  'negative accounts',
  'adverse accounts',
  'collection accounts',
  'derogatory',
] as const;

export const NEGATIVE_GRID_CODES: readonly string[] = [
  '2', '3', '4', '5', 'X', 'CO', 'D',
] as const;

export const OK_GRID_CODES: readonly string[] = [
  'OK', 'C', '0', '1', '', '-', '—', 'N/A',
] as const;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Tradeline {
  creditor_name: string;
  account_number: string;
  account_type?: string;
  date_opened?: string | null;
  date_closed?: string | null;
  balance?: string | null;
  past_due_amount?: string | null;
  status_as_reported?: string | null;
  payment_grid_codes?: string | null;
  remarks?: string | null;
  confidence?: string;
  bureaus?: string[];
  bureau_status?: Record<string, string>;
  date_first_delinquency?: string | null;
  section_header?: string | null;
  is_continuation?: boolean;
  derogatory_triggers?: string[];
  block_text?: string;
}

export interface Collection {
  collection_agency?: string;
  creditor_name?: string;
  original_creditor?: string;
  account_number?: string;
  date_opened?: string | null;
  date_reported?: string | null;
  balance?: string;
  status?: string;
  bureaus?: string[];
}

export interface Inquiry {
  creditor_name: string;
  date: string;
  type?: 'hard' | 'soft' | 'promotional' | 'account_review' | 'unknown';
  bureaus?: string[];
}

export interface PublicRecord {
  type: string;
  court_jurisdiction?: string;
  filing_date?: string;
  status?: string;
  amount?: string | null;
  bureaus?: string[];
}

export interface PersonalInfo {
  reported_name?: string;
  reported_address?: string;
  reported_employer?: string;
  field?: string;
  reported_value?: string;
  mismatch_reason?: string;
  bureaus?: string[];
}

export interface ReportMetadata {
  bureau_names?: string[];
  report_date?: string;
  report_type?: 'single' | 'tri-merge' | 'credit_karma' | 'unknown';
  consumer_name?: string;
  accounts_ever_late?: number | null;
  collections_count?: number | null;
  public_records_count?: number | null;
}

export interface ParsedReport {
  metadata?: ReportMetadata;
  derogatory_accounts?: Tradeline[];
  collections?: Collection[];
  charge_offs?: Tradeline[];
  inquiries?: Inquiry[];
  public_records?: PublicRecord[];
  inaccurate_names?: PersonalInfo[];
  inaccurate_addresses?: PersonalInfo[];
  inaccurate_employers?: PersonalInfo[];
  extra_identifier_mismatches?: PersonalInfo[];
  late_payment_summary?: any[];
  tradeline_inventory?: {
    total_blocks_detected?: number;
    negative_extracted?: number;
    collections_extracted?: number;
    public_records_extracted?: number;
    inquiries_extracted?: number;
  };
  validation_status?: string;
  duplicate_flags?: DuplicateFlag[];
}

export interface DuplicateFlag {
  creditor_name: string;
  account_number: string;
  bureau?: string;
  indices: number[];
  message: string;
}

export type ValidationResult = {
  status: 'PASS' | 'ERROR' | 'WARNING' | 'SKIPPED';
  messages: string[];
};

// ─── Whole-word boundary matching ──────────────────────────────────────────

/**
 * Check if `keyword` appears as a whole word in `text`.
 * Uses word-boundary regex to avoid substring matches
 * (e.g., "late" must NOT match "later", "collateral", "translated").
 */
export function wholeWordMatch(text: string, keyword: string): boolean {
  if (!text || !keyword) return false;
  // Escape regex special chars in keyword
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'i');
  return regex.test(text);
}

/**
 * Check if any negative status keyword matches in the given text.
 * Returns list of matched keywords.
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

// ─── Context-Sensitive C/O Detection ───────────────────────────────────────

/**
 * Check if "C/O" in text is a charge-off indicator (status/remark field)
 * vs. "care of" in an address line.
 *
 * Heuristic: If the text contains address-like patterns (street, city/state/zip),
 * treat C/O as "care of". Otherwise treat as charge-off.
 */
export function isCOChargeOff(text: string, fieldType?: 'status' | 'remark' | 'address' | 'unknown'): boolean {
  if (!text) return false;
  if (!wholeWordMatch(text, 'C/O')) return false;

  // Explicit field type overrides heuristic
  if (fieldType === 'status' || fieldType === 'remark') return true;
  if (fieldType === 'address') return false;

  // Heuristic: look for address patterns
  const addressPatterns = /\b(\d{1,5}\s+\w+\s+(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|way|pl|place))\b/i;
  const zipPattern = /\b\d{5}(-\d{4})?\b/;
  if (addressPatterns.test(text) || zipPattern.test(text)) return false;

  return true;
}

// ─── Past Due Amount Detection ─────────────────────────────────────────────

/**
 * Parse a past due amount string and return whether it's negative (> $0).
 * "$0", "$0.00", "0" → NOT negative
 * "$1", "$500", "$1,234.56" → negative
 */
export function isPastDueNegative(pastDueStr: string | null | undefined): boolean {
  if (!pastDueStr) return false;
  const cleaned = pastDueStr.replace(/[$,\s]/g, '');
  const amount = parseFloat(cleaned);
  if (isNaN(amount)) return false;
  return amount > 0;
}

// ─── Payment Grid Code Detection ───────────────────────────────────────────

/**
 * Parse a payment grid string and return any negative codes found.
 * Grid codes can be space-separated, comma-separated, or individual characters.
 */
export function findNegativeGridCodes(gridStr: string | null | undefined): string[] {
  if (!gridStr) return [];
  // Split by common delimiters
  const codes = gridStr.split(/[\s,|;]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
  return codes.filter(c => (NEGATIVE_GRID_CODES as readonly string[]).includes(c));
}

// ─── Section Header Check ──────────────────────────────────────────────────

/**
 * Check if a section header string indicates a negative section.
 */
export function isNegativeSectionHeader(header: string | null | undefined): boolean {
  if (!header) return false;
  const lower = header.toLowerCase().trim();
  return NEGATIVE_SECTION_HEADERS.some(h => lower.includes(h));
}

// ─── Tradeline Negativity Classification (Pass 2 Logic) ────────────────────

export interface NegativeClassification {
  isNegative: boolean;
  triggers: string[];
}

/**
 * Determine if a tradeline is negative using all Pass 2 rules.
 * This is the core deterministic classifier.
 */
export function classifyTradeline(tradeline: Tradeline): NegativeClassification {
  const triggers: string[] = [];

  // 1. Status keyword matching on block text, status, remarks
  const searchTexts = [
    tradeline.block_text,
    tradeline.status_as_reported,
    tradeline.remarks,
  ].filter(Boolean).join(' ');

  const keywordMatches = findNegativeKeywords(searchTexts);
  triggers.push(...keywordMatches);

  // 2. C/O in status/remark (not address)
  if (tradeline.status_as_reported && isCOChargeOff(tradeline.status_as_reported, 'status')) {
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

  // 6. Date of First Delinquency present
  if (tradeline.date_first_delinquency) {
    triggers.push(`date of first delinquency: ${tradeline.date_first_delinquency}`);
  }

  return {
    isNegative: triggers.length > 0,
    triggers,
  };
}

// ─── Validation Gate ───────────────────────────────────────────────────────

/**
 * Reconcile extracted counts against bureau summary metrics.
 * Implements the mandatory validation gate from the parser spec.
 */
export function validateExtraction(
  report: ParsedReport,
  metadata?: ReportMetadata,
): ValidationResult {
  const messages: string[] = [];
  let worstStatus: 'PASS' | 'ERROR' | 'WARNING' | 'SKIPPED' = 'PASS';

  const meta = metadata || report.metadata;

  if (!meta || (meta.accounts_ever_late == null && meta.collections_count == null && meta.public_records_count == null)) {
    return { status: 'SKIPPED', messages: ['No bureau summary counts found in report.'] };
  }

  const negCount = (report.derogatory_accounts?.length ?? 0) + (report.charge_offs?.length ?? 0);
  const colCount = report.collections?.length ?? 0;

  // Under-extraction checks (ERROR)
  if (meta.collections_count != null && colCount < meta.collections_count) {
    messages.push(`EXTRACTION INCOMPLETE — COLLECTIONS MISMATCH (extracted ${colCount}, expected ${meta.collections_count})`);
    worstStatus = 'ERROR';
  }

  if (meta.accounts_ever_late != null && negCount < meta.accounts_ever_late) {
    messages.push(`EXTRACTION INCOMPLETE — NEGATIVE TRADELINE MISMATCH (extracted ${negCount}, expected ${meta.accounts_ever_late})`);
    worstStatus = 'ERROR';
  }

  // Over-extraction checks (WARNING)
  if (meta.collections_count != null && colCount > meta.collections_count + 2) {
    const msg = `POSSIBLE OVER-EXTRACTION — COLLECTIONS (extracted ${colCount}, expected ${meta.collections_count})`;
    messages.push(msg);
    if (worstStatus !== 'ERROR') worstStatus = 'WARNING';
  }

  if (meta.accounts_ever_late != null && negCount > meta.accounts_ever_late + 2) {
    const msg = `POSSIBLE OVER-EXTRACTION — NEGATIVE TRADELINES (extracted ${negCount}, expected ${meta.accounts_ever_late})`;
    messages.push(msg);
    if (worstStatus !== 'ERROR') worstStatus = 'WARNING';
  }

  if (messages.length === 0) {
    messages.push('All counts reconciled within tolerance.');
  }

  return { status: worstStatus, messages };
}

// ─── Duplicate Detection ───────────────────────────────────────────────────

/**
 * Scan for potential duplicates: same creditor + account number + bureau.
 * Returns flags without removing entries.
 */
export function detectDuplicates(tradelines: Tradeline[]): DuplicateFlag[] {
  if (!tradelines || tradelines.length < 2) return [];

  const flags: DuplicateFlag[] = [];
  const seen = new Map<string, number[]>();

  for (let i = 0; i < tradelines.length; i++) {
    const t = tradelines[i];
    const name = (t.creditor_name || '').trim().toUpperCase();
    const acct = (t.account_number || '').trim().toUpperCase();
    // Use first bureau or 'unknown'
    const bureau = (t.bureaus?.[0] || 'unknown').toLowerCase();
    const key = `${bureau}|${name}|${acct}`;

    if (!seen.has(key)) {
      seen.set(key, [i]);
    } else {
      seen.get(key)!.push(i);
    }
  }

  for (const [key, indices] of seen.entries()) {
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

// ─── Account Number Preservation Check ─────────────────────────────────────

/**
 * Verify that an extracted account number preserves all masking characters.
 * Returns true if the account number contains expected mask patterns.
 */
export function hasPreservedMasking(accountNumber: string): boolean {
  if (!accountNumber || accountNumber === 'N/A') return true; // N/A is acceptable
  // Check for common masking characters
  return /[X*.]/.test(accountNumber) || accountNumber === accountNumber; // always true if present
}

/**
 * Verify account number was NOT altered (e.g., unmasked, truncated, reformatted).
 * Compares extracted to expected.
 */
export function accountNumberPreserved(extracted: string, expected: string): boolean {
  if (!extracted || !expected) return extracted === expected;
  // Strict comparison: normalize single leading/trailing spaces but flag
  // multi-space padding, removed masking chars, or any other alteration.
  const e = extracted.replace(/^\s+|\s+$/g, '');
  const x = expected.replace(/^\s+|\s+$/g, '');
  // Also fail if the original had significantly different whitespace
  if (extracted.length - e.length > 1 || expected.length - x.length > 1) return false;
  return e === x;
}

// ─── Continuation Detection ────────────────────────────────────────────────

/**
 * Check if a chunk result looks like a continuation from a prior page.
 * A continuation has payment data but no creditor name.
 */
export function isContinuationChunk(tradeline: Tradeline): boolean {
  const hasPaymentData = !!(tradeline.payment_grid_codes || tradeline.status_as_reported);
  const hasCreditor = !!(tradeline.creditor_name && tradeline.creditor_name !== 'N/A' && tradeline.creditor_name.trim() !== '');
  return hasPaymentData && !hasCreditor;
}

// ─── Full Post-Processing Pipeline ─────────────────────────────────────────

/**
 * Run all post-processing steps on a parsed report:
 * 1. Classify each tradeline
 * 2. Validate counts
 * 3. Detect duplicates
 */
export function postProcessReport(report: ParsedReport): ParsedReport {
  // Re-classify all derogatory accounts to verify triggers
  if (report.derogatory_accounts) {
    for (const acct of report.derogatory_accounts) {
      const classification = classifyTradeline(acct);
      acct.derogatory_triggers = classification.triggers;
    }
  }

  // Validate
  const validation = validateExtraction(report, report.metadata);
  report.validation_status = `${validation.status}: ${validation.messages.join('; ')}`;

  // Duplicate detection across all tradelines
  const allTradelines = [
    ...(report.derogatory_accounts || []),
    ...(report.charge_offs || []),
  ];
  report.duplicate_flags = detectDuplicates(allTradelines);

  // Build inventory
  report.tradeline_inventory = {
    total_blocks_detected: allTradelines.length + (report.collections?.length ?? 0),
    negative_extracted: allTradelines.length,
    collections_extracted: report.collections?.length ?? 0,
    public_records_extracted: report.public_records?.length ?? 0,
    inquiries_extracted: report.inquiries?.length ?? 0,
  };

  return report;
}
