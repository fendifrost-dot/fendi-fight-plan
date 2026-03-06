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
  classifyPdfError,
  sanitizePdfjsError,
  buildClientPdfError,
} from '@/lib/client-pdf-error';

/**
 * Callback signature for streaming page processing.
 * Called once per page with a rendered Blob and its true PDF page number (1-based).
 * The caller must consume or upload the blob before the next page is yielded.
 */
export interface PageCallback {
  (pdfPageNumber: number, blob: Blob, mimeType: string, pageCount: number): Promise<void>;
}

/** Result from the best-effort streaming pipeline. */
export interface StreamingResult {
  pageCount: number;
  pagesSucceeded: number;
  failedPages: number[]; // 1-based page numbers
  errors: ClientPdfError[]; // per-page errors (if any)
}

/** Primary + fallback render settings (best-effort). */
const PRIMARY_RENDER = { scale: 1.5, format: 'image/webp' as const, quality: 0.8 };
const FALLBACK_RENDER = { scale: 1.0, format: 'image/jpeg' as const, quality: 0.75 };

function sanitizePdfjsErrorWithStack(err: unknown): string {
  const base = sanitizePdfjsError(err);
  if (!(err instanceof Error) || !err.stack) return base;
  const sanitizedStack = err.stack
    .replace(/\/[^\s]+/g, '[path]')
    .split('\n')
    .slice(0, 6)
    .join(' | ')
    .slice(0, 700);
  return `${base} | stack: ${sanitizedStack}`;
}

/**
 * Attempt to render a single page with fallback settings.
 * Returns the blob on success, or throws the last error.
 */
async function renderPageWithFallback(
  page: any,
): Promise<{ blob: Blob; usedScale: number; usedFormat: string; usedQuality: number }> {
  const attempts = [PRIMARY_RENDER, FALLBACK_RENDER];

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
      pdfjsError: sanitizePdfjsErrorWithStack(err),
    });
  }

  const pageCount = pdf.numPages;

  const failedPages: number[] = [];
  const errors: ClientPdfError[] = [];
  let pagesSucceeded = 0;

  for (let i = 1; i <= pageCount; i++) {
    try {
      const page = await pdf.getPage(i);

      const { blob, usedFormat } = await renderPageWithFallback(page);

      // Deliver with true PDF page number (1-based)
      await onPage(i, blob, usedFormat, pageCount);
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
        scale: PRIMARY_RENDER.scale,
        format: PRIMARY_RENDER.format,
        quality: PRIMARY_RENDER.quality,
        pdfjsError: sanitizePdfjsErrorWithStack(err),
      }));
    }
  }

  return { pageCount, pagesSucceeded, failedPages, errors };
}

/**
 * Determine if a partial result is acceptable.
 * Rule: >=70% pages OR at least 5 pages for small PDFs (<=10 pages).
 */
export function isPartialResultAcceptable(result: StreamingResult): boolean {
  if (result.pageCount <= 0) return false;
  return (result.pagesSucceeded / result.pageCount >= 0.7) || (result.pagesSucceeded >= 5 && result.pageCount <= 10);
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

/**
 * Extract text from ALL pages of a PDF for text-first analysis pipeline.
 * Returns the full text and a quality score (chars per page).
 * Best-effort: pages that fail are skipped.
 */
export async function extractFullTextFromPdf(file: File): Promise<{ text: string; pageCount: number; charsPerPage: number; pagesExtracted: number }> {
  try {
    const pdfjs = await getPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    
    const pageCount = pdf.numPages;
    const textParts: string[] = [];
    let pagesExtracted = 0;
    
    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        textParts.push(`--- PAGE ${i} ---\n${pageText}`);
        pagesExtracted++;
      } catch {
        textParts.push(`--- PAGE ${i} ---\n[TEXT EXTRACTION FAILED]`);
      }
    }
    
    const text = textParts.join('\n\n');
    const charsPerPage = pagesExtracted > 0 ? Math.round(text.length / pagesExtracted) : 0;
    
    return { text, pageCount, charsPerPage, pagesExtracted };
  } catch {
    return { text: '', pageCount: 0, charsPerPage: 0, pagesExtracted: 0 };
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

// ============= PAGE TRIAGE =============

/** Keywords that indicate a page contains actionable tradeline/account data */
const ACTIONABLE_KEYWORDS = [
  'account number', 'acct #', 'acct no', 'account #',
  'balance', 'credit limit', 'high balance',
  'date opened', 'date reported', 'date of last activity',
  'creditor', 'original creditor', 'subscriber',
  'collection', 'charge off', 'charged off', 'charge-off',
  'derogatory', 'delinquent', 'past due', 'late payment',
  'status:', 'account status', 'payment status',
  'current balance', 'amount past due',
  'public record', 'bankruptcy', 'civil judgment', 'tax lien',
  'inquiry', 'inquiries',
  'personal information', 'social security', 'date of birth',
  'experian', 'equifax', 'transunion', 'trans union',
  'credit score', 'fico', 'vantage',
  'summary', 'account summary', 'negative accounts',
  'open accounts', 'closed accounts',
  'revolving', 'installment', 'mortgage', 'student loan', 'auto loan',
];

/** Minimum chars per page to consider text extraction viable */
const TEXT_RICH_THRESHOLD = 200;

/** Minimum average chars/page across the whole PDF to accept text-first path */
const TEXT_FIRST_THRESHOLD = 150;

export interface PageTriage {
  pageNumber: number;
  charCount: number;
  isTextRich: boolean;
  isActionable: boolean;
  reason: string;
}

export interface TriageResult {
  totalPages: number;
  textRichPages: number;
  actionablePages: number[];
  nonActionablePages: number[];
  textFirstViable: boolean;
  textFirstReason: string;
  fullText: string;
  charsPerPage: number;
  pagesExtracted: number;
  pageTriages: PageTriage[];
}

/**
 * Triage all pages in a PDF:
 * 1. Extract text per page
 * 2. Classify each page as actionable or not
 * 3. Determine if text-first path is viable
 */
export async function triagePdfPages(file: File): Promise<TriageResult> {
  const pdfjs = await getPdfJs();
  
  let pdf: any;
  try {
    const arrayBuffer = await file.arrayBuffer();
    pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  } catch {
    return {
      totalPages: 0,
      textRichPages: 0,
      actionablePages: [],
      nonActionablePages: [],
      textFirstViable: false,
      textFirstReason: 'PDF load failed',
      fullText: '',
      charsPerPage: 0,
      pagesExtracted: 0,
      pageTriages: [],
    };
  }

  const totalPages = pdf.numPages;
  const pageTriages: PageTriage[] = [];
  const textParts: string[] = [];
  let pagesExtracted = 0;
  let textRichPages = 0;
  const actionablePages: number[] = [];
  const nonActionablePages: number[] = [];

  for (let i = 1; i <= totalPages; i++) {
    let pageText = '';
    try {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      pageText = textContent.items.map((item: any) => item.str).join(' ');
      pagesExtracted++;
    } catch {
      pageText = '';
    }

    textParts.push(`--- PAGE ${i} ---\n${pageText || '[TEXT EXTRACTION FAILED]'}`);

    const charCount = pageText.length;
    const isTextRich = charCount >= TEXT_RICH_THRESHOLD;
    if (isTextRich) textRichPages++;

    const lowerText = pageText.toLowerCase();
    const matchedKeywords = ACTIONABLE_KEYWORDS.filter(kw => lowerText.includes(kw));
    const isActionable = matchedKeywords.length >= 2 || (!isTextRich && charCount < 50);
    // Pages with very little text are likely scanned images — mark actionable by default
    
    let reason: string;
    if (matchedKeywords.length >= 2) {
      reason = `actionable: matched [${matchedKeywords.slice(0, 3).join(', ')}]`;
    } else if (!isTextRich && charCount < 50) {
      reason = 'actionable: text-poor page (likely scanned image)';
    } else if (matchedKeywords.length === 1) {
      reason = `borderline: only matched [${matchedKeywords[0]}]`;
    } else {
      reason = 'non-actionable: no tradeline keywords found';
    }

    pageTriages.push({ pageNumber: i, charCount, isTextRich, isActionable, reason });

    if (isActionable) {
      actionablePages.push(i);
    } else {
      nonActionablePages.push(i);
    }
  }

  const fullText = textParts.join('\n\n');
  const charsPerPage = pagesExtracted > 0 ? Math.round(fullText.length / pagesExtracted) : 0;

  // Text-first is viable if the average chars/page is high enough
  let textFirstViable = false;
  let textFirstReason = '';

  if (pagesExtracted === 0) {
    textFirstReason = 'No text extracted from any page';
  } else if (charsPerPage < TEXT_FIRST_THRESHOLD) {
    textFirstReason = `Average ${charsPerPage} chars/page below threshold (${TEXT_FIRST_THRESHOLD})`;
  } else if (textRichPages / totalPages < 0.5) {
    textFirstReason = `Only ${textRichPages}/${totalPages} pages have sufficient text`;
  } else {
    textFirstViable = true;
    textFirstReason = `Text quality sufficient: ${charsPerPage} chars/page avg, ${textRichPages}/${totalPages} text-rich`;
  }

  return {
    totalPages,
    textRichPages,
    actionablePages,
    nonActionablePages,
    textFirstViable,
    textFirstReason,
    fullText,
    charsPerPage,
    pagesExtracted,
    pageTriages,
  };
}

/**
 * Render only specific pages from a PDF to images via streaming callback.
 * Same best-effort approach as pdfToImagesStreaming but only for selected pages.
 */
export async function pdfToImagesSelective(
  file: File,
  pageNumbers: number[],
  onPage: PageCallback,
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
      pdfjsError: sanitizePdfjsErrorWithStack(err),
    });
  }

  const pageCount = pdf.numPages;
  const failedPages: number[] = [];
  const errors: ClientPdfError[] = [];
  let pagesSucceeded = 0;

  for (const pageNum of pageNumbers) {
    if (pageNum < 1 || pageNum > pageCount) continue;
    try {
      const page = await pdf.getPage(pageNum);
      const { blob, usedFormat } = await renderPageWithFallback(page);
      await onPage(pageNum, blob, usedFormat, pageNumbers.length);
      pagesSucceeded++;
      page.cleanup();
    } catch (err) {
      failedPages.push(pageNum);
      errors.push(buildClientPdfError('PDF_PAGE_RENDER_FAILED', `Page ${pageNum} failed: ${sanitizePdfjsError(err)}`, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        pageCount,
        failingPage: pageNum,
        operation: 'render',
        scale: PRIMARY_RENDER.scale,
        format: PRIMARY_RENDER.format,
        quality: PRIMARY_RENDER.quality,
        pdfjsError: sanitizePdfjsErrorWithStack(err),
      }));
    }
  }

  return { pageCount, pagesSucceeded, failedPages, errors };
}
