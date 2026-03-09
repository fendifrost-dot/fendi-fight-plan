/**
 * Parser Validator — Client-side mirror of supabase/functions/_shared/parser-validator.ts
 * Deterministic post-AI validation and enforcement.
 */

import {
  VALIDATION_THRESHOLDS,
  PARSER_ERROR_CODES,
  classifyTradeline,
  detectDuplicates,
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

export function validateCounts(report: any): ValidationResult {
  const meta = report.metadata || report.report_metadata;
  const messages: string[] = [];
  let worstStatus: 'PASS' | 'ERROR' | 'WARNING' | 'SKIPPED' = 'PASS';

  if (!meta || (meta.accounts_ever_late == null && meta.collections_count == null && meta.public_records_count == null)) {
    return { status: 'SKIPPED', code: null, messages: ['No bureau summary counts found in report.'], fatal: false };
  }

  const negCount = (report.derogatory_accounts?.length ?? 0) + (report.charge_offs?.length ?? 0);
  const colCount = report.collections?.length ?? 0;

  if (meta.collections_count != null && colCount < meta.collections_count - VALIDATION_THRESHOLDS.UNDER_EXTRACTION_TOLERANCE) {
    messages.push(`EXTRACTION INCOMPLETE — COLLECTIONS MISMATCH (extracted ${colCount}, expected ${meta.collections_count})`);
    worstStatus = 'ERROR';
  }
  if (meta.accounts_ever_late != null && negCount < meta.accounts_ever_late - VALIDATION_THRESHOLDS.UNDER_EXTRACTION_TOLERANCE) {
    messages.push(`EXTRACTION INCOMPLETE — NEGATIVE TRADELINE MISMATCH (extracted ${negCount}, expected ${meta.accounts_ever_late})`);
    worstStatus = 'ERROR';
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

  return { status: worstStatus, code: worstStatus === 'ERROR' ? PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE : null, messages, fatal: false };
}

export function postProcessAndValidate(rawResult: any): PostProcessResult {
  const report = ensureRequiredArrays(rawResult);
  const schema = validateSchema(report);

  if (report.derogatory_accounts && Array.isArray(report.derogatory_accounts)) {
    for (const acct of report.derogatory_accounts) {
      const classification = classifyTradeline(acct);
      acct.derogatory_triggers = classification.triggers;
      if (!classification.isNegative) {
        acct._no_triggers_detected = true;
        acct._classification_note = 'AI classified as negative but no deterministic triggers found';
      }
    }
  }

  if (report.charge_offs && Array.isArray(report.charge_offs)) {
    for (const acct of report.charge_offs) {
      acct.derogatory_triggers = classifyTradeline(acct).triggers;
    }
  }

  const validation = validateCounts(report);
  const allTradelines = [...(report.derogatory_accounts || []), ...(report.charge_offs || [])];
  const duplicateFlags = detectDuplicates(allTradelines);

  report.tradeline_inventory = {
    total_blocks_detected: allTradelines.length + (report.collections?.length ?? 0),
    negative_extracted: allTradelines.length,
    collections_extracted: report.collections?.length ?? 0,
    public_records_extracted: report.public_records?.length ?? 0,
    inquiries_extracted: report.inquiries?.length ?? 0,
  };

  report.validation_status = `${validation.status}: ${validation.messages.join('; ')}`;
  report.duplicate_flags = duplicateFlags;

  const criticalSchemaViolations = schema.violations.filter(
    v => v.entity === 'root' || (v.entity === 'derogatory_accounts' && v.field === 'creditor_name')
  );

  const isError = validation.status === 'ERROR' && criticalSchemaViolations.length > 0;
  const errorCode = isError ? PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE : null;
  const errorMessage = isError
    ? `${PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE}: ${validation.messages.join('; ')}`
    : null;

  return { report, schema, validation, duplicateFlags, isError, errorCode, errorMessage };
}

export function postProcessChunkResult(rawResult: any): any {
  return postProcessAndValidate(rawResult).report;
}
