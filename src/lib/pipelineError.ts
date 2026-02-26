/**
 * Standard error schema for the entire analyzer pipeline.
 * Used by edge functions, client hooks, and UI components.
 */

export type ErrorStage = 'UPLOAD' | 'START' | 'WORKER' | 'STATUS' | 'UI';

export interface PipelineError {
  code: string;
  message: string;
  stage: ErrorStage;
  step?: string;
  http_status?: number;
  job_id?: string;
  session_id?: string;
  bureau?: 'EX' | 'TU' | 'EQ' | null;
  page?: number | null;
  chunk?: number | null;
  cause?: string;
}

// Known error codes
export const ErrorCodes = {
  // Storage / Upload
  STORAGE_401: 'STORAGE_401',
  STORAGE_403: 'STORAGE_403',
  STORAGE_UPLOAD_FAILED: 'STORAGE_UPLOAD_FAILED',

  // analysis-start
  START_BAD_REQUEST: 'START_BAD_REQUEST',
  START_PATH_VALIDATION_FAILED: 'START_PATH_VALIDATION_FAILED',

  // analysis-worker
  WORKER_DOWNLOAD_FAILED: 'WORKER_DOWNLOAD_FAILED',
  WORKER_BASE64_ENCODE_FAILED: 'WORKER_BASE64_ENCODE_FAILED',
  WORKER_AI_TIMEOUT: 'WORKER_AI_TIMEOUT',
  WORKER_AI_BAD_RESPONSE: 'WORKER_AI_BAD_RESPONSE',

  // Job lifecycle
  JOB_TIMEOUT: 'JOB_TIMEOUT',
  JOB_STALE: 'JOB_STALE',
  JOB_ABORTED: 'JOB_ABORTED',

  // Fallback
  UNKNOWN: 'UNKNOWN',
} as const;

/**
 * Build a PipelineError with safe cause serialization.
 */
export function buildPipelineError(
  code: string,
  message: string,
  stage: ErrorStage,
  extras?: Partial<Omit<PipelineError, 'code' | 'message' | 'stage'>>
): PipelineError {
  return {
    code,
    message,
    stage,
    ...extras,
    cause: extras?.cause ? safeCause(extras.cause) : undefined,
  };
}

/**
 * Safely stringify a cause, stripping secrets and limiting length.
 */
function safeCause(cause: any): string {
  try {
    const str = typeof cause === 'string' ? cause : JSON.stringify(cause);
    // Remove anything that looks like a JWT or key
    const sanitized = str.replace(/eyJ[A-Za-z0-9_-]{10,}/g, '[REDACTED]');
    return sanitized.slice(0, 500);
  } catch {
    return 'Unstringifiable error';
  }
}

/**
 * Classify an HTTP status from storage into a known code.
 */
export function storageErrorCode(httpStatus: number): string {
  if (httpStatus === 401) return ErrorCodes.STORAGE_401;
  if (httpStatus === 403) return ErrorCodes.STORAGE_403;
  return ErrorCodes.STORAGE_UPLOAD_FAILED;
}
