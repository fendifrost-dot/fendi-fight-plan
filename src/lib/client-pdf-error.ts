/**
 * Structured client-side PDF error schema.
 * Used by pdf-utils.ts and surfaced in AIAnalyzer diagnostics.
 */

export type ClientPdfErrorCode =
  | 'PDF_LOAD_FAILED'
  | 'PDF_PASSWORD_REQUIRED'
  | 'PDF_PAGE_RENDER_FAILED'
  | 'PDF_TEXT_EXTRACT_FAILED'
  | 'PDF_UNSUPPORTED_FEATURE'
  | 'PDF_TIMEOUT';

export interface ClientPdfErrorMeta {
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  pageCount?: number | null;
  failingPage?: number; // 1-based
  operation?: 'load' | 'render' | 'text';
  scale?: number;
  format?: string;
  quality?: number;
  pdfjsError?: string; // sanitized name+message
}

export interface ClientPdfError {
  code: ClientPdfErrorCode;
  message: string;
  stage: 'CLIENT_PDF';
  meta: ClientPdfErrorMeta;
}

/** Classify a pdfjs error into a structured code. */
export function classifyPdfError(err: unknown): ClientPdfErrorCode {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes('password')) return 'PDF_PASSWORD_REQUIRED';
  if (msg.includes('unsupported') || msg.includes('not supported')) return 'PDF_UNSUPPORTED_FEATURE';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'PDF_TIMEOUT';
  if (msg.includes('render') || msg.includes('canvas') || msg.includes('toblob')) return 'PDF_PAGE_RENDER_FAILED';
  if (msg.includes('text') || msg.includes('gettext')) return 'PDF_TEXT_EXTRACT_FAILED';
  return 'PDF_LOAD_FAILED';
}

/** Sanitize pdfjs error for diagnostics (strip paths, limit length). */
export function sanitizePdfjsError(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 300);
  const msg = `${err.name}: ${err.message}`;
  return msg.replace(/\/[^\s]+/g, '[path]').slice(0, 300);
}

export function buildClientPdfError(
  code: ClientPdfErrorCode,
  message: string,
  meta: ClientPdfErrorMeta
): ClientPdfError {
  return { code, message, stage: 'CLIENT_PDF', meta };
}
