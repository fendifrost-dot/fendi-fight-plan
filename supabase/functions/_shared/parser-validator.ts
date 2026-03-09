/**
 * Parser Validator — Deterministic post-AI validation and enforcement.
 * 
 * This module runs AFTER AI extraction and BEFORE results are returned.
 * It enforces the parser contract rules. If validation fails critically,
 * it returns EXTRACTION_INCOMPLETE error.
 * 
 * Pipeline: AI → extraction → schema validation → rule enforcement → output
 */

import {
  NEGATIVE_STATUS_KEYWORDS,
  NEGATIVE_SECTION_HEADERS,
  NEGATIVE_GRID_CODES,
  VALIDATION_THRESHOLDS,
  PARSER_ERROR_CODES,
  wholeWordMatch,
  findNegativeKeywords,
  isCOChargeOff,
  isPastDueNegative,
  findNegativeGridCodes,
  isNegativeSectionHeader,
  classifyTradeline,
  detectDuplicates,
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
  /** If true, the extraction should be aborted */
  fatal: boolean;
}

export interface PostProcessResult {
  /** The processed report data */
  report: any;
  /** Schema validation result */
  schema: SchemaValidationResult;
  /** Count validation result */
  validation: ValidationResult;
  /** Duplicate flags */
  duplicateFlags: any[];
  /** Whether the result should be treated as an error */
  isError: boolean;
  /** Error code if isError is true */
  errorCode: string | null;
  /** Human-readable error message */
  errorMessage: string | null;
}

// ─── Count Validation ──────────────────────────────────────────────────────

/**
 * Reconcile extracted counts against bureau summary metrics.
 * Implements the mandatory validation gate from the parser spec.
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

  // Under-extraction checks (ERROR — potentially fatal)
  if (meta.collections_count != null && colCount < meta.collections_count - VALIDATION_THRESHOLDS.UNDER_EXTRACTION_TOLERANCE) {
    messages.push(`EXTRACTION INCOMPLETE — COLLECTIONS MISMATCH (extracted ${colCount}, expected ${meta.collections_count})`);
    worstStatus = 'ERROR';
  }

  if (meta.accounts_ever_late != null && negCount < meta.accounts_ever_late - VALIDATION_THRESHOLDS.UNDER_EXTRACTION_TOLERANCE) {
    messages.push(`EXTRACTION INCOMPLETE — NEGATIVE TRADELINE MISMATCH (extracted ${negCount}, expected ${meta.accounts_ever_late})`);
    worstStatus = 'ERROR';
  }

  // Over-extraction checks (WARNING — non-fatal)
  if (meta.collections_count != null && colCount > meta.collections_count + VALIDATION_THRESHOLDS.OVER_EXTRACTION_TOLERANCE) {
    const msg = `POSSIBLE OVER-EXTRACTION — COLLECTIONS (extracted ${colCount}, expected ${meta.collections_count})`;
    messages.push(msg);
    if (worstStatus !== 'ERROR') worstStatus = 'WARNING';
  }

  if (meta.accounts_ever_late != null && negCount > meta.accounts_ever_late + VALIDATION_THRESHOLDS.OVER_EXTRACTION_TOLERANCE) {
    const msg = `POSSIBLE OVER-EXTRACTION — NEGATIVE TRADELINES (extracted ${negCount}, expected ${meta.accounts_ever_late})`;
    messages.push(msg);
    if (worstStatus !== 'ERROR') worstStatus = 'WARNING';
  }

  if (messages.length === 0) {
    messages.push('All counts reconciled within tolerance.');
  }

  return {
    status: worstStatus,
    code: worstStatus === 'ERROR' ? PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE : null,
    messages,
    fatal: false, // Under-extraction is flagged but NOT fatal — we still return all data
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
 * 4. Validate counts against bureau summary
 * 5. Detect duplicates
 * 6. Build tradeline inventory
 * 7. Return processed result with validation status
 * 
 * CRITICAL: Never discard extraction work on validation failure.
 * Always output all data with error flags.
 */
export function postProcessAndValidate(rawResult: any): PostProcessResult {
  // Step 1: Ensure all arrays exist
  const report = ensureRequiredArrays(rawResult);

  // Step 2: Schema validation
  const schema = validateSchema(report);

  // Step 3: Re-classify every derogatory account using deterministic rules
  // This OVERRIDES whatever the AI said — our rules are the source of truth.
  if (report.derogatory_accounts && Array.isArray(report.derogatory_accounts)) {
    for (const acct of report.derogatory_accounts) {
      const classification = classifyTradeline(acct);
      acct.derogatory_triggers = classification.triggers;
      // If the AI included an account that has ZERO triggers, flag it
      if (!classification.isNegative) {
        acct._no_triggers_detected = true;
        acct._classification_note = 'AI classified as negative but no deterministic triggers found';
      }
    }
  }

  // Also re-classify charge_offs
  if (report.charge_offs && Array.isArray(report.charge_offs)) {
    for (const acct of report.charge_offs) {
      const classification = classifyTradeline(acct);
      acct.derogatory_triggers = classification.triggers;
    }
  }

  // Step 4: Validate counts against bureau summary
  const validation = validateCounts(report);

  // Step 5: Duplicate detection across all tradelines
  const allTradelines = [
    ...(report.derogatory_accounts || []),
    ...(report.charge_offs || []),
  ];
  const duplicateFlags = detectDuplicates(allTradelines);

  // Step 6: Build tradeline inventory
  report.tradeline_inventory = {
    total_blocks_detected: allTradelines.length + (report.collections?.length ?? 0),
    negative_extracted: allTradelines.length,
    collections_extracted: report.collections?.length ?? 0,
    public_records_extracted: report.public_records?.length ?? 0,
    inquiries_extracted: report.inquiries?.length ?? 0,
  };

  // Step 7: Set validation status on the report
  report.validation_status = `${validation.status}: ${validation.messages.join('; ')}`;
  report.duplicate_flags = duplicateFlags;

  // Determine if this is a fatal error
  // Schema violations on critical fields + extraction incomplete = ERROR
  const criticalSchemaViolations = schema.violations.filter(
    v => v.entity === 'root' || (v.entity === 'derogatory_accounts' && v.field === 'creditor_name')
  );

  const isError = validation.status === 'ERROR' && criticalSchemaViolations.length > 0;
  const errorCode = isError ? PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE : null;
  const errorMessage = isError
    ? `${PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE}: ${validation.messages.join('; ')}. Schema violations: ${criticalSchemaViolations.map(v => v.reason).join('; ')}`
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
 * Simplified post-processing for chunk results (analyze-chunk, analysis-worker).
 * Same pipeline but returns just the processed report with status fields.
 */
export function postProcessChunkResult(rawResult: any): any {
  const result = postProcessAndValidate(rawResult);
  return result.report;
}
