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

/**
 * Convert a PDF file to an array of base64 image strings (one per page)
 * INVARIANT: Process ALL pages or throw an error. No silent truncation.
 */
export async function pdfToImages(file: File): Promise<{ images: string[]; pageCount: number }> {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  
  const pageCount = pdf.numPages;
  const images: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const scale = 2; // Higher scale for better OCR quality
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

    // Convert to JPEG for smaller file size
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
  
  // Check for multi-bureau report indicators first (PrivacyGuard, IdentityIQ, etc.)
  const multiBureauIndicators = [
    'privacyguard',
    'identityiq',
    'smartcredit',
    'myscoreiq',
    'credit monitoring',
    '3-bureau',
    'three bureau',
    '3 bureau'
  ];
  
  // Check for side-by-side column headers
  const hasExperian = lowerText.includes('experian');
  const hasEquifax = lowerText.includes('equifax');
  const hasTransunion = lowerText.includes('transunion') || lowerText.includes('trans union');
  
  // If multiple bureaus mentioned OR multi-bureau service detected, it's a combined report
  const bureauCount = [hasExperian, hasEquifax, hasTransunion].filter(Boolean).length;
  
  if (bureauCount >= 2) {
    return 'multi-bureau';
  }
  
  for (const indicator of multiBureauIndicators) {
    if (lowerText.includes(indicator)) {
      return 'multi-bureau';
    }
  }
  
  // Check for single bureau reports
  if (hasExperian && !hasEquifax && !hasTransunion) return 'experian';
  if (hasEquifax && !hasExperian && !hasTransunion) return 'equifax';
  if (hasTransunion && !hasExperian && !hasEquifax) return 'transunion';
  
  // Check for bureau-specific identifiers
  if (lowerText.includes('experian credit report') || lowerText.includes('www.experian.com')) return 'experian';
  if (lowerText.includes('equifax credit report') || lowerText.includes('www.equifax.com')) return 'equifax';
  if (lowerText.includes('transunion credit report') || lowerText.includes('www.transunion.com')) return 'transunion';
  
  return 'unknown';
}

/**
 * Extract text from first few pages of PDF for bureau detection
 * Multi-bureau reports often have cover pages, so we check first 3 pages
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const pdfjs = await getPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    
    // Extract text from first 3 pages (or fewer if doc is shorter)
    const pagesToCheck = Math.min(pdf.numPages, 3);
    const textParts: string[] = [];
    
    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      textParts.push(pageText);
    }
    
    return textParts.join(' ');
  } catch {
    return '';
  }
}

/**
 * Check if file is HEIC format
 */
export function isHeicFile(file: File): boolean {
  return file.type === 'image/heic' || 
         file.type === 'image/heif' || 
         file.name.toLowerCase().endsWith('.heic') ||
         file.name.toLowerCase().endsWith('.heif');
}

/**
 * Check if file is a PDF
 */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Check if file is a supported image
 */
export function isSupportedImage(file: File): boolean {
  const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
  return supportedTypes.includes(file.type);
}
