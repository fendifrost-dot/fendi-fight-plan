// Lazy-load pdfjs to avoid issues during initial bundle
let pdfjsLib: typeof import('pdfjs-dist') | null = null;
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsLib) return pdfjsLib;
  
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
      pdfjsLib = pdfjs;
      return pdfjs;
    })();
  }
  
  return pdfjsPromise;
}

import {
  type ClientPdfError,
  type ClientPdfErrorMeta,
  classifyPdfError,
  sanitizePdfjsError,
  buildClientPdfError,
} from '@/lib/client-pdf-error';

/**
 * Callback signature for streaming page processing.
 * Called once per page with a JPEG Blob. The caller must consume or upload
 * the blob before the next page is yielded — no pages accumulate in memory.
 */
export interface PageCallback {
  (pageIndex: number, blob: Blob, mimeType: string, pageCount: number): Promise<void>;
}

/** Result from the best-effort streaming pipeline. */
export interface StreamingResult {
  pageCount: number;
  pagesSucceeded: number;
  failedPages: number[]; // 1-based page numbers
  errors: ClientPdfError[]; // per-page errors (if any)
}

/** Fallback render settings. */
const FALLBACK_SETTINGS = [
  { scale: 1.5, format: 'image/webp' as const, quality: 0.8 },
  { scale: 1.0, format: 'image/jpeg' as const, quality: 0.75 },
];

/**
 * Attempt to render a single page with fallback settings.
 * Returns the blob on success, or throws the last error.
 */
async function renderPageWithFallback(
  page: any,
  primaryScale: number,
  primaryQuality: number,
): Promise<{ blob: Blob; usedScale: number; usedFormat: string; usedQuality: number }> {
  const attempts = [
    { scale: primaryScale, format: 'image/jpeg' as const, quality: primaryQuality },
    ...FALLBACK_SETTINGS,
  ];

  let lastErr: unknown;
  for (const { scale, format, quality } of attempts) {
    try {
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create canvas context');

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error(`toBlob failed (${format})`)),
          format,
          quality
        );
      });

      // Release canvas memory
      canvas.width = 0;
      canvas.height = 0;

      return { blob, usedScale: scale, usedFormat: format, usedQuality: quality };
    } catch (err) {
      lastErr = err;
      // Continue to next fallback
    }
  }
  throw lastErr;
}

/**
 * Convert a PDF file to images ONE PAGE AT A TIME via callback.
 * 
 * BEST-EFFORT: If a page fails to render (even with fallback settings),
 * it is recorded and skipped. The pipeline continues with remaining pages.
 * 
 * INVARIANT: No base64 strings or data URLs are created.
 * INVARIANT: Only one page canvas exists at a time.
 * 
 * Memory profile: O(1) with respect to page count.
 */
export async function pdfToImagesStreaming(
  file: File,
  onPage: PageCallback,
  options: { scale?: number; quality?: number } = {}
): Promise<StreamingResult> {
  const pdfjs = await getPdfJs();

  let pdf: any;
  try {
    const arrayBuffer = await file.arrayBuffer();
    pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  } catch (err) {
    const code = classifyPdfError(err);
    throw buildClientPdfError(code, `Failed to load PDF: ${sanitizePdfjsError(err)}`, {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      operation: 'load',
      pdfjsError: sanitizePdfjsError(err),
    });
  }

  const pageCount = pdf.numPages;
  const scale = options.scale ?? 2;
  const quality = options.quality ?? 0.85;

  const failedPages: number[] = [];
  const errors: ClientPdfError[] = [];
  let pagesSucceeded = 0;

  for (let i = 1; i <= pageCount; i++) {
    try {
      const page = await pdf.getPage(i);

      const { blob } = await renderPageWithFallback(page, scale, quality);

      // Deliver to caller — they upload/consume before we continue
      await onPage(pagesSucceeded, blob, 'image/jpeg', pageCount);
      pagesSucceeded++;

      page.cleanup();
    } catch (err) {
      failedPages.push(i);
      errors.push(buildClientPdfError('PDF_PAGE_RENDER_FAILED', `Page ${i} failed: ${sanitizePdfjsError(err)}`, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        pageCount,
        failingPage: i,
        operation: 'render',
        scale,
        format: 'image/jpeg',
        quality,
        pdfjsError: sanitizePdfjsError(err),
      }));
    }
  }

  return { pageCount, pagesSucceeded, failedPages, errors };
}

/**
 * Determine if a partial result is acceptable.
 * Requires >= 70% pages OR at least 5 pages succeeded.
 */
export function isPartialResultAcceptable(result: StreamingResult): boolean {
  if (result.pagesSucceeded === 0) return false;
  if (result.pagesSucceeded >= 5) return true;
  return result.pagesSucceeded / result.pageCount >= 0.7;
}

/**
 * @deprecated Use pdfToImagesStreaming instead.
 * Kept only for non-upload paths (e.g. small previews).
 */
export async function pdfToImages(file: File): Promise<{ images: string[]; pageCount: number }> {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  
  const pageCount = pdf.numPages;
  const images: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const scale = 2;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) {
      throw new Error(`Could not create canvas context for page ${i}`);
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    images.push(dataUrl);
  }

  return { images, pageCount };
}

/**
 * Detect bureau from text content - supports multi-bureau reports like PrivacyGuard
 */
export function detectBureauFromText(text: string): 'experian' | 'equifax' | 'transunion' | 'multi-bureau' | 'unknown' {
  const lowerText = text.toLowerCase();
  
  const multiBureauIndicators = [
    'privacyguard', 'identityiq', 'smartcredit', 'myscoreiq',
    'credit monitoring', '3-bureau', 'three bureau', '3 bureau'
  ];
  
  const hasExperian = lowerText.includes('experian');
  const hasEquifax = lowerText.includes('equifax');
  const hasTransunion = lowerText.includes('transunion') || lowerText.includes('trans union');
  
  const bureauCount = [hasExperian, hasEquifax, hasTransunion].filter(Boolean).length;
  
  if (bureauCount >= 2) return 'multi-bureau';
  
  for (const indicator of multiBureauIndicators) {
    if (lowerText.includes(indicator)) return 'multi-bureau';
  }
  
  if (hasExperian && !hasEquifax && !hasTransunion) return 'experian';
  if (hasEquifax && !hasExperian && !hasTransunion) return 'equifax';
  if (hasTransunion && !hasExperian && !hasEquifax) return 'transunion';
  
  if (lowerText.includes('experian credit report') || lowerText.includes('www.experian.com')) return 'experian';
  if (lowerText.includes('equifax credit report') || lowerText.includes('www.equifax.com')) return 'equifax';
  if (lowerText.includes('transunion credit report') || lowerText.includes('www.transunion.com')) return 'transunion';
  
  return 'unknown';
}

/**
 * Extract text from first few pages of PDF for bureau detection.
 * Best-effort: returns empty string on failure.
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const pdfjs = await getPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    
    const pagesToCheck = Math.min(pdf.numPages, 3);
    const textParts: string[] = [];
    
    for (let i = 1; i <= pagesToCheck; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        textParts.push(pageText);
      } catch {
        // Skip pages that fail text extraction
      }
    }
    
    return textParts.join(' ');
  } catch {
    return '';
  }
}

/** Check if file is HEIC format */
export function isHeicFile(file: File): boolean {
  return file.type === 'image/heic' || 
         file.type === 'image/heif' || 
         file.name.toLowerCase().endsWith('.heic') ||
         file.name.toLowerCase().endsWith('.heif');
}

/** Check if file is a PDF */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/** Check if file is a supported image */
export function isSupportedImage(file: File): boolean {
  const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
  return supportedTypes.includes(file.type);
}
