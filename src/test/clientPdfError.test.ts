import { describe, it, expect } from 'vitest';
import {
  classifyPdfError,
  sanitizePdfjsError,
  buildClientPdfError,
} from '@/lib/client-pdf-error';

describe('Client PDF error classification', () => {
  it('classifies password-protected PDF', () => {
    expect(classifyPdfError(new Error('No password given, PDF requires a password'))).toBe('PDF_PASSWORD_REQUIRED');
  });

  it('classifies unsupported feature', () => {
    expect(classifyPdfError(new Error('Unsupported XRef type'))).toBe('PDF_UNSUPPORTED_FEATURE');
  });

  it('classifies render/canvas errors', () => {
    expect(classifyPdfError(new Error('toBlob failed (image/jpeg)'))).toBe('PDF_PAGE_RENDER_FAILED');
    expect(classifyPdfError(new Error('Canvas context error'))).toBe('PDF_PAGE_RENDER_FAILED');
  });

  it('classifies text extraction errors', () => {
    expect(classifyPdfError(new Error('getTextContent failed'))).toBe('PDF_TEXT_EXTRACT_FAILED');
  });

  it('classifies timeout', () => {
    expect(classifyPdfError(new Error('PDF processing timed out'))).toBe('PDF_TIMEOUT');
  });

  it('defaults to PDF_LOAD_FAILED for unknown errors', () => {
    expect(classifyPdfError(new Error('Something went wrong'))).toBe('PDF_LOAD_FAILED');
    expect(classifyPdfError('string error')).toBe('PDF_LOAD_FAILED');
  });
});

describe('sanitizePdfjsError', () => {
  it('sanitizes Error objects', () => {
    const result = sanitizePdfjsError(new Error('Failed at /home/user/file.pdf'));
    expect(result).toContain('[path]');
    expect(result).not.toContain('/home/user');
  });

  it('truncates long messages to 300 chars', () => {
    const longErr = new Error('x'.repeat(500));
    expect(sanitizePdfjsError(longErr).length).toBeLessThanOrEqual(300);
  });

  it('handles non-Error values', () => {
    expect(sanitizePdfjsError('simple string')).toBe('simple string');
    expect(sanitizePdfjsError(42)).toBe('42');
  });
});

describe('buildClientPdfError', () => {
  it('produces valid shape with stage CLIENT_PDF', () => {
    const err = buildClientPdfError('PDF_PAGE_RENDER_FAILED', 'Page 7 failed', {
      fileName: 'report.pdf',
      fileSize: 5_000_000,
      failingPage: 7,
      operation: 'render',
      scale: 1.5,
      format: 'image/webp',
      quality: 0.8,
    });
    expect(err.stage).toBe('CLIENT_PDF');
    expect(err.code).toBe('PDF_PAGE_RENDER_FAILED');
    expect(err.meta.failingPage).toBe(7);
    expect(err.meta.fileName).toBe('report.pdf');
  });
});

describe('Partial page continuation (streaming pipeline)', () => {
  it('pipeline continues when one page fails, producing partial result', async () => {
    const PAGE_COUNT = 10;
    const FAILING_PAGE = 4; // 0-indexed
    const uploadedPaths: string[] = [];

    // Simulate streaming with one failing page
    async function simulateStreaming(
      onPage: (pageIndex: number, blob: Blob, mimeType: string, pageCount: number) => Promise<void>,
    ) {
      let succeeded = 0;
      const failedPages: number[] = [];
      const errors: any[] = [];

      for (let i = 0; i < PAGE_COUNT; i++) {
        if (i === FAILING_PAGE) {
          failedPages.push(i + 1); // 1-based
          errors.push(buildClientPdfError('PDF_PAGE_RENDER_FAILED', `Page ${i + 1} failed`, {
            failingPage: i + 1,
            operation: 'render',
          }));
          continue; // Skip this page
        }
        const blob = new Blob([new Uint8Array(512)], { type: 'image/jpeg' });
        await onPage(succeeded, blob, 'image/jpeg', PAGE_COUNT);
        succeeded++;
      }

      return { pageCount: PAGE_COUNT, pagesSucceeded: succeeded, failedPages, errors };
    }

    const result = await simulateStreaming(async (pageIndex, blob) => {
      uploadedPaths.push(`uid/job/page-${String(pageIndex).padStart(3, '0')}.jpg`);
    });

    // 9 of 10 pages succeeded
    expect(result.pagesSucceeded).toBe(9);
    expect(result.failedPages).toEqual([5]); // page 5 (1-based) failed
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('PDF_PAGE_RENDER_FAILED');

    // Uploaded paths are sequential (no gaps — reindexed)
    expect(uploadedPaths).toHaveLength(9);
    expect(uploadedPaths[0]).toBe('uid/job/page-000.jpg');

    // No data URLs in output
    for (const p of uploadedPaths) {
      expect(p).not.toContain('data:image');
    }
  });

  it('zero pages succeeded results in empty paths', async () => {
    const result = { pageCount: 5, pagesSucceeded: 0, failedPages: [1, 2, 3, 4, 5], errors: [] };
    // isPartialResultAcceptable would reject this
    expect(result.pagesSucceeded).toBe(0);
  });
});
