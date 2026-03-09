/**
 * Parser Validator — Deterministic post-AI validation and enforcement.
 * 
 * This module runs AFTER AI extraction and BEFORE results are returned.
 * It enforces the parser contract rules. If validation fails critically,
 * it returns EXTRACTION_INCOMPLETE error with fatal=true.
 * 
 * Pipeline: AI → extraction → schema validation → rule enforcement → output
 * 
 * CRITICAL INVARIANTS:
 * - Count mismatch ALONE triggers EXTRACTION_INCOMPLETE (no schema condition required)
 * - Under-extraction sets fatal=true
 * - Never merge/deduplicate tradelines — flag only
 * - summary/next_steps are stripped from contract output
 * - Confidence is derived deterministically from triggers, never hardcoded
 */

import {
  PRIMARY_BLOCK_ANCHORS,
  SECONDARY_BLOCK_ANCHORS,
  VALIDATION_THRESHOLDS,
  PARSER_ERROR_CODES,
  classifyTradeline,
  detectDuplicates,
  isCleanTradeline,
} from './parser-contract.ts';

import {
  validateSchema,
  ensureRequiredArrays,
  type SchemaValidationResult,
} from './parser-schema.ts';

// ─── Validation Result ─────────────────────────────────────────────────────

export interface ValidationResult {
  status: 'PASS' | 'ERROR' | 'WARNING' | 'SKIPPED';
  code: string | null;
  messages: string[];
  /** If true, the extraction should be treated as a deterministic failure */
  fatal: boolean;
}

export interface PostProcessResult {
  report: any;
  schema: SchemaValidationResult;
  validation: ValidationResult;
  duplicateFlags: any[];
  /** True whenever validation.status === 'ERROR' — count mismatch alone is sufficient */
  isError: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

// ─── Pass 1: Deterministic Block Detection ─────────────────────────────────

/**
 * Detect tradeline blocks from raw report text using structural anchors.
 * Returns count of detected blocks INDEPENDENTLY of AI extraction.
 * This is the real Pass 1 inventory — not derived from extracted negatives.
 */
export function detectTradelineBlocks(reportText: string | null | undefined): number {
  if (!reportText || typeof reportText !== 'string') return 0;
  const lower = reportText.toLowerCase();
  let blockCount = 0;

  // Primary anchors: each occurrence of a primary anchor likely starts a new block
  for (const anchor of PRIMARY_BLOCK_ANCHORS) {
    const anchorLower = anchor.toLowerCase();
    let searchFrom = 0;
    while (true) {
      const idx = lower.indexOf(anchorLower, searchFrom);
      if (idx === -1) break;
      // Verify it's at a line/field boundary (preceded by newline, start, or colon)
      const before = idx > 0 ? lower[idx - 1] : '\n';
      if (before === '\n' || before === ':' || before === '|' || before === '\t' || idx === 0) {
        blockCount++;
      }
      searchFrom = idx + anchorLower.length;
    }
  }

  // Deduplicate: multiple anchors in the same block inflate the count.
  // A block typically has 1 primary + N secondary anchors within ~500 chars.
  // Heuristic: count unique block starts by looking for primary anchors
  // that are at least 200 chars apart (a reasonable minimum block size).
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

  // Cluster positions within 200 chars as same block
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

/**
 * Derive confidence level deterministically from triggers.
 * NEVER hardcode confidence values.
 * 
 * Rules:
 * - 3+ triggers → 'high'
 * - 2 triggers → 'high'  
 * - 1 trigger with grid codes or section header → 'high'
 * - 1 trigger → 'medium'
 * - 0 triggers but AI included it → 'low'
 * - Any field is UNEXTRACTABLE → 'incomplete'
 */
export function deriveConfidence(tradeline: any, triggers: string[]): string {
  // Check for UNEXTRACTABLE fields
  const fields = [
    tradeline.creditor_name, tradeline.account_number,
    tradeline.status, tradeline.status_as_reported, tradeline.balance,
  ];
  if (fields.some(f => typeof f === 'string' && f.toUpperCase() === 'UNEXTRACTABLE')) {
    return 'incomplete';
  }

  if (triggers.length === 0) return 'low';
  if (triggers.length >= 2) return 'high';

  // 1 trigger — check if it's a strong signal
  const strongSignals = ['grid codes:', 'section:', 'C/O'];
  if (triggers.some(t => strongSignals.some(s => t.includes(s)))) return 'high';

  return 'medium';
}

// ─── Count Validation ──────────────────────────────────────────────────────

/**
 * Reconcile extracted counts against bureau summary metrics.
 * 
 * CRITICAL: Under-extraction sets fatal=true.
 * Count mismatch ALONE raises EXTRACTION_INCOMPLETE.
 */
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

  // Under-extraction checks — ERROR and FATAL
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

  // Over-extraction checks — WARNING, non-fatal
  if (meta.collections_count != null && colCount > meta.collections_count + VALIDATION_THRESHOLDS.OVER_EXTRACTION_TOLERANCE) {
    messages.push(`POSSIBLE OVER-EXTRACTION — COLLECTIONS (extracted ${colCount}, expected ${meta.collections_count})`);
    if (worstStatus !== 'ERROR') worstStatus = 'WARNING';
  }

  if (meta.accounts_ever_late != null && negCount > meta.accounts_ever_late + VALIDATION_THRESHOLDS.OVER_EXTRACTION_TOLERANCE) {
    messages.push(`POSSIBLE OVER-EXTRACTION — NEGATIVE TRADELINES (extracted ${negCount}, expected ${meta.accounts_ever_late})`);
    if (worstStatus !== 'ERROR') worstStatus = 'WARNING';
  }

  if (messages.length === 0) {
    messages.push('All counts reconciled within tolerance.');
  }

  return {
    status: worstStatus,
    code: worstStatus === 'ERROR' ? PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE : null,
    messages,
    fatal,
  };
}

// ─── Full Post-Processing Pipeline ─────────────────────────────────────────

/**
 * Run the complete deterministic post-processing pipeline on an AI extraction result.
 * 
 * Pipeline steps:
 * 1. Ensure all required arrays exist
 * 2. Validate schema (required fields, types)
 * 3. Re-classify every tradeline using deterministic rules
 * 4. Derive confidence deterministically (never hardcoded)
 * 5. Validate counts against bureau summary
 * 6. Detect duplicates (flag only, never merge)
 * 7. Build tradeline inventory (Pass 1 block count separate from extracted)
 * 8. Strip non-deterministic fields (summary, next_steps)
 * 9. Return processed result with validation status
 * 
 * CRITICAL INVARIANTS:
 * - isError = true whenever validation.status === 'ERROR' (no schema condition)
 * - Count mismatch alone triggers EXTRACTION_INCOMPLETE
 * - Never merge or collapse tradelines
 * - Preserve every extracted tradeline individually
 */
export function postProcessAndValidate(rawResult: any, reportText?: string): PostProcessResult {
  // Step 1: Ensure all arrays exist
  const report = ensureRequiredArrays(rawResult);

  // Step 2: Schema validation
  const schema = validateSchema(report);

  // Step 3 + 4: Re-classify and derive confidence deterministically
  if (report.derogatory_accounts && Array.isArray(report.derogatory_accounts)) {
    for (const acct of report.derogatory_accounts) {
      const classification = classifyTradeline(acct);
      acct.derogatory_triggers = classification.triggers;
      acct.confidence = deriveConfidence(acct, classification.triggers);
      if (!classification.isNegative) {
        acct._no_triggers_detected = true;
        acct._classification_note = 'AI classified as negative but no deterministic triggers found';
      }
    }
  }

  if (report.charge_offs && Array.isArray(report.charge_offs)) {
    for (const acct of report.charge_offs) {
      const classification = classifyTradeline(acct);
      acct.derogatory_triggers = classification.triggers;
      acct.confidence = deriveConfidence(acct, classification.triggers);
    }
  }

  // Step 5: Validate counts against bureau summary
  const validation = validateCounts(report);

  // Step 6: Duplicate detection — FLAG ONLY, never merge
  const allTradelines = [
    ...(report.derogatory_accounts || []),
    ...(report.charge_offs || []),
  ];
  const duplicateFlags = detectDuplicates(allTradelines);

  // Step 7: Build tradeline inventory
  // Pass 1 block count is independent of extracted negatives
  const pass1BlockCount = detectTradelineBlocks(reportText || report._raw_text || null);
  report.tradeline_inventory = {
    total_blocks_detected: pass1BlockCount > 0 ? pass1BlockCount : (allTradelines.length + (report.collections?.length ?? 0)),
    pass1_anchor_detected: pass1BlockCount,
    negative_extracted: allTradelines.length,
    collections_extracted: report.collections?.length ?? 0,
    public_records_extracted: report.public_records?.length ?? 0,
    inquiries_extracted: report.inquiries?.length ?? 0,
  };

  // Step 8: Strip non-deterministic fields from contract output
  delete report.summary;
  delete report.next_steps;

  // Step 9: Set validation status
  report.validation_status = `${validation.status}: ${validation.messages.join('; ')}`;
  report.duplicate_flags = duplicateFlags;

  // CRITICAL: isError = true whenever validation.status === 'ERROR'
  // Count mismatch ALONE is sufficient — no schema condition required
  const isError = validation.status === 'ERROR';
  const errorCode = isError ? PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE : null;
  const errorMessage = isError
    ? `${PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE}: ${validation.messages.join('; ')}`
    : null;

  return {
    report,
    schema,
    validation,
    duplicateFlags,
    isError,
    errorCode,
    errorMessage,
  };
}

/**
 * Post-processing for chunk results.
 * Same full pipeline — no lighter path allowed.
 */
export function postProcessChunkResult(rawResult: any): any {
  const result = postProcessAndValidate(rawResult);
  return result.report;
}
