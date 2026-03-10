/**
 * Parser Validator — Client-side mirror of supabase/functions/_shared/parser-validator.ts
 * Deterministic post-AI validation and enforcement.
 * 
 * CRITICAL INVARIANTS (must match _shared version exactly):
 * - Count mismatch ALONE triggers EXTRACTION_INCOMPLETE (no schema condition)
 * - Under-extraction sets fatal=true
 * - Never merge/deduplicate — flag only
 * - summary/next_steps stripped from contract output
 * - Confidence derived deterministically from triggers
 * - Three-bucket output: derogatory_accounts, manual_review_accounts, clean_accounts
 */

import {
  PRIMARY_BLOCK_ANCHORS,
  VALIDATION_THRESHOLDS,
  PARSER_ERROR_CODES,
  classifyTradeline,
  detectDuplicates,
  isCleanTradeline,
} from './parser-contract';

import { validateSchema, ensureRequiredArrays, type SchemaValidationResult } from './parser-schema';

export interface ValidationResult {
  status: 'PASS' | 'ERROR' | 'WARNING' | 'SKIPPED';
  code: string | null;
  messages: string[];
  fatal: boolean;
}

export interface PostProcessResult {
  report: any;
  schema: SchemaValidationResult;
  validation: ValidationResult;
  duplicateFlags: any[];
  isError: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

// ─── Pass 1: Deterministic Block Detection ─────────────────────────────────

export function detectTradelineBlocks(reportText: string | null | undefined): number {
  if (!reportText || typeof reportText !== 'string') return 0;
  const lower = reportText.toLowerCase();

  const blockPositions: number[] = [];
  for (const anchor of PRIMARY_BLOCK_ANCHORS) {
    const anchorLower = anchor.toLowerCase();
    let searchFrom = 0;
    while (true) {
      const idx = lower.indexOf(anchorLower, searchFrom);
      if (idx === -1) break;
      const before = idx > 0 ? lower[idx - 1] : '\n';
      if (before === '\n' || before === ':' || before === '|' || before === '\t' || idx === 0) {
        blockPositions.push(idx);
      }
      searchFrom = idx + anchorLower.length;
    }
  }

  blockPositions.sort((a, b) => a - b);
  const MIN_BLOCK_GAP = 200;
  let clusteredCount = 0;
  let lastPos = -MIN_BLOCK_GAP - 1;
  for (const pos of blockPositions) {
    if (pos - lastPos >= MIN_BLOCK_GAP) {
      clusteredCount++;
      lastPos = pos;
    }
  }

  return clusteredCount;
}

// ─── Deterministic Confidence Derivation ───────────────────────────────────

export function deriveConfidence(tradeline: any, triggers: string[]): string {
  const fields = [
    tradeline.creditor_name, tradeline.account_number,
    tradeline.status, tradeline.status_as_reported, tradeline.balance,
  ];
  if (fields.some(f => typeof f === 'string' && f.toUpperCase() === 'UNEXTRACTABLE')) {
    return 'incomplete';
  }
  if (triggers.length === 0) return 'low';
  if (triggers.length >= 2) return 'high';
  const strongSignals = ['grid codes:', 'section:', 'C/O'];
  if (triggers.some(t => strongSignals.some(s => t.includes(s)))) return 'high';
  return 'medium';
}

// ─── Count Validation ──────────────────────────────────────────────────────

export function validateCounts(report: any): ValidationResult {
  const meta = report.metadata || report.report_metadata;
  const messages: string[] = [];
  let worstStatus: 'PASS' | 'ERROR' | 'WARNING' | 'SKIPPED' = 'PASS';
  let fatal = false;

  if (!meta || (meta.accounts_ever_late == null && meta.collections_count == null && meta.public_records_count == null)) {
    return { status: 'SKIPPED', code: null, messages: ['No bureau summary counts found in report.'], fatal: false };
  }

  const negCount = (report.derogatory_accounts?.length ?? 0) + (report.charge_offs?.length ?? 0);
  const colCount = report.collections?.length ?? 0;

  if (meta.collections_count != null && colCount < meta.collections_count - VALIDATION_THRESHOLDS.UNDER_EXTRACTION_TOLERANCE) {
    messages.push(`EXTRACTION INCOMPLETE — COLLECTIONS MISMATCH (extracted ${colCount}, expected ${meta.collections_count})`);
    worstStatus = 'ERROR';
    fatal = true;
  }

  if (meta.accounts_ever_late != null && negCount < meta.accounts_ever_late - VALIDATION_THRESHOLDS.UNDER_EXTRACTION_TOLERANCE) {
    messages.push(`EXTRACTION INCOMPLETE — NEGATIVE TRADELINE MISMATCH (extracted ${negCount}, expected ${meta.accounts_ever_late})`);
    worstStatus = 'ERROR';
    fatal = true;
  }

  if (meta.collections_count != null && colCount > meta.collections_count + VALIDATION_THRESHOLDS.OVER_EXTRACTION_TOLERANCE) {
    messages.push(`POSSIBLE OVER-EXTRACTION — COLLECTIONS (extracted ${colCount}, expected ${meta.collections_count})`);
    if (worstStatus !== 'ERROR') worstStatus = 'WARNING';
  }

  if (meta.accounts_ever_late != null && negCount > meta.accounts_ever_late + VALIDATION_THRESHOLDS.OVER_EXTRACTION_TOLERANCE) {
    messages.push(`POSSIBLE OVER-EXTRACTION — NEGATIVE TRADELINES (extracted ${negCount}, expected ${meta.accounts_ever_late})`);
    if (worstStatus !== 'ERROR') worstStatus = 'WARNING';
  }

  if (messages.length === 0) messages.push('All counts reconciled within tolerance.');

  return { status: worstStatus, code: worstStatus === 'ERROR' ? PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE : null, messages, fatal };
}

// ─── Full Post-Processing Pipeline ─────────────────────────────────────────

export function postProcessAndValidate(rawResult: any, reportText?: string): PostProcessResult {
  const report = ensureRequiredArrays(rawResult);
  const schema = validateSchema(report);

  // ─── Three-bucket separation ─────────────────────────────────────────
  const confirmedDerogatory: any[] = [];
  const manualReview: any[] = [];
  const cleanAccounts: any[] = [];

  if (report.derogatory_accounts && Array.isArray(report.derogatory_accounts)) {
    // Preserve original for inventory
    report.all_tradelines = [...report.derogatory_accounts];

    for (const acct of report.derogatory_accounts) {
      const classification = classifyTradeline(acct);
      acct.derogatory_triggers = classification.triggers;
      acct.confidence = deriveConfidence(acct, classification.triggers);

      // ── Confidence filtering: reject 'incomplete' accounts (missing critical fields) ──
      if (acct.confidence === 'incomplete') {
        acct._classification_note = 'Rejected: incomplete confidence (missing critical fields)';
        acct._bucket = 'manual_review';
        manualReview.push(acct);
      } else if (isCleanTradeline(acct)) {
        acct._classification_note = 'Clean tradeline excluded from derogatory_accounts';
        acct._bucket = 'clean';
        cleanAccounts.push(acct);
      } else if (!classification.isNegative) {
        acct._no_triggers_detected = true;
        acct._classification_note = 'AI classified as negative but no deterministic triggers found';
        acct._bucket = 'manual_review';
        manualReview.push(acct);
      } else {
        acct._bucket = 'derogatory';
        confirmedDerogatory.push(acct);
      }
    }

    report.derogatory_accounts = confirmedDerogatory;
    report.manual_review_accounts = manualReview;
    report.clean_accounts = cleanAccounts;
  }

  if (report.charge_offs && Array.isArray(report.charge_offs)) {
    for (const acct of report.charge_offs) {
      const classification = classifyTradeline(acct);
      acct.derogatory_triggers = classification.triggers;
      acct.confidence = deriveConfidence(acct, classification.triggers);
      acct._bucket = 'derogatory';
    }
  }

  const validation = validateCounts(report);

  // ─── Leak guard: no zero-trigger items in derogatory_accounts ────────
  const leakedItems = report.derogatory_accounts?.filter(
    (a: any) => !a.derogatory_triggers || a.derogatory_triggers.length === 0
  ) || [];
  if (leakedItems.length > 0) {
    validation.messages.push(
      `INVALID_DEROGATORY_LEAK: ${leakedItems.length} account(s) in derogatory_accounts with zero triggers`
    );
    if (validation.status === 'PASS') validation.status = 'WARNING';
    report.manual_review_accounts = [
      ...(report.manual_review_accounts || []),
      ...leakedItems,
    ];
    report.derogatory_accounts = report.derogatory_accounts.filter(
      (a: any) => a.derogatory_triggers && a.derogatory_triggers.length > 0
    );
  }

  const allTradelines = [...(report.derogatory_accounts || []), ...(report.charge_offs || [])];
  const duplicateFlags = detectDuplicates(allTradelines);

  const pass1BlockCount = detectTradelineBlocks(reportText || report._raw_text || null);
  report.tradeline_inventory = {
    total_blocks_detected: pass1BlockCount > 0 ? pass1BlockCount : (allTradelines.length + (report.collections?.length ?? 0)),
    pass1_anchor_detected: pass1BlockCount,
    negative_extracted: allTradelines.length,
    manual_review_count: (report.manual_review_accounts || []).length,
    clean_count: (report.clean_accounts || []).length,
    collections_extracted: report.collections?.length ?? 0,
    public_records_extracted: report.public_records?.length ?? 0,
    inquiries_extracted: report.inquiries?.length ?? 0,
  };

  delete report.summary;
  delete report.next_steps;

  report.validation_status = `${validation.status}: ${validation.messages.join('; ')}`;
  report.validation_messages = validation.messages;
  report.duplicate_flags = duplicateFlags;

  const isError = validation.status === 'ERROR';
  const errorCode = isError ? PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE : null;
  const errorMessage = isError
    ? `${PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE}: ${validation.messages.join('; ')}`
    : null;

  return { report, schema, validation, duplicateFlags, isError, errorCode, errorMessage };
}

export function postProcessChunkResult(rawResult: any): any {
  return postProcessAndValidate(rawResult).report;
}
