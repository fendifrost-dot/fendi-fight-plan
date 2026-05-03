/** Extract plain text from PDF bytes (Supabase Edge / Deno — pdfjs legacy build, no worker). */

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdfjs = await import("npm:pdfjs-dist@4.0.379/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "";

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: undefined,
  });
  const doc = await loadingTask.promise;
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
}
