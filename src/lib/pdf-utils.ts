// Lazy-load pdfjs to avoid top-level await in bundle
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function getPdfJs() {
  if (!pdfjsLib) {
    // Dynamic import avoids top-level await build issue
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    pdfjsLib = pdfjs as unknown as typeof import('pdfjs-dist');
  }
  return pdfjsLib;
}

/**
 * Convert a PDF file to an array of base64 image strings (one per page)
 * Limited to maxPages (default 10) for performance
 */
export async function pdfToImages(file: File, maxPages = 10): Promise<{ images: string[]; pageCount: number }> {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  
  const pageCount = pdf.numPages;
  const pagesToRender = Math.min(pageCount, maxPages);
  const images: string[] = [];

  for (let i = 1; i <= pagesToRender; i++) {
    const page = await pdf.getPage(i);
    const scale = 2; // Higher scale for better OCR quality
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) {
      throw new Error('Could not create canvas context');
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
 * Detect bureau from text content
 */
export function detectBureauFromText(text: string): 'experian' | 'equifax' | 'transunion' | 'unknown' {
  const lowerText = text.toLowerCase();
  
  // Check for explicit bureau names
  if (lowerText.includes('experian')) return 'experian';
  if (lowerText.includes('equifax')) return 'equifax';
  if (lowerText.includes('transunion') || lowerText.includes('trans union')) return 'transunion';
  
  // Check for bureau-specific identifiers
  if (lowerText.includes('experian credit report') || lowerText.includes('www.experian.com')) return 'experian';
  if (lowerText.includes('equifax credit report') || lowerText.includes('www.equifax.com')) return 'equifax';
  if (lowerText.includes('transunion credit report') || lowerText.includes('www.transunion.com')) return 'transunion';
  
  return 'unknown';
}

/**
 * Extract text from first page of PDF for bureau detection
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const pdfjs = await getPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    
    // Get first page text for detection
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    
    return text;
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
