/** Extract plain text from PDF bytes (Supabase Edge / Deno — pdfjs legacy build, no worker). */

export interface PdfTextDocument {
  pageCount: number;
  pages: string[];
  /** Pages joined with a marker so the analysis worker can see page boundaries. */
  text: string;
}

async function openPdf(data: Uint8Array): Promise<{ numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy?: () => Promise<void> }> {
  const pdfjs = await import("npm:pdfjs-dist@4.0.379/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "";
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: undefined,
  });
  return loadingTask.promise;
}

interface PdfPage {
  getTextContent: () => Promise<{ items: unknown[] }>;
}

function pageText(items: unknown[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (typeof item === "object" && item && "str" in item) {
      parts.push(String((item as { str: string }).str));
    }
  }
  return parts.join(" ").replace(/[ \t]+/g, " ").trim();
}

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const doc = await openPdf(data);
  try {
    const parts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (typeof item === "object" && item && "str" in item) {
          parts.push(String((item as { str: string }).str));
        }
      }
      parts.push("\n");
    }
    return parts.join(" ");
  } finally {
    await doc.destroy?.();
  }
}

/** Per-page text for the agent upload path. Does not render page images. */
export async function extractPdfDocument(data: Uint8Array): Promise<PdfTextDocument> {
  const doc = await openPdf(data);
  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const textContent = await page.getTextContent();
      pages.push(pageText(textContent.items));
    }
    const text = pages.map((page, index) => `--- PAGE ${index + 1} ---\n${page}`).join("\n\n");
    return { pageCount: doc.numPages, pages, text };
  } finally {
    await doc.destroy?.();
  }
}
