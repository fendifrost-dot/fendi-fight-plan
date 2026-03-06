import { Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak, TabStopType, TabStopPosition } from "docx";
import { saveAs } from "file-saver";

/**
 * Parse a plain-text dispute letter into structured paragraphs
 * preserving spacing, bullet lists, and signature blocks.
 */
function parseLetterToParagraphs(text: string): Paragraph[] {
  const lines = text.split("\n");
  const paragraphs: Paragraph[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Empty line → spacing paragraph
    if (line.trim() === "") {
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    // Detect bullet/numbered items
    const bulletMatch = line.match(/^(\s*[-•]\s+)(.*)/);
    const numberedMatch = line.match(/^(\s*\d+\.\s+)(.*)/);

    if (bulletMatch) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: "• ", font: "Times New Roman", size: 24 }),
            new TextRun({ text: bulletMatch[2], font: "Times New Roman", size: 24 }),
          ],
        })
      );
    } else if (numberedMatch) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: numberedMatch[1], font: "Times New Roman", size: 24 }),
            new TextRun({ text: numberedMatch[2], font: "Times New Roman", size: 24 }),
          ],
        })
      );
    } else if (line.startsWith("RE:") || line.startsWith("Re:")) {
      // Subject line – bold
      paragraphs.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: line, bold: true, font: "Times New Roman", size: 24 }),
          ],
        })
      );
    } else if (line === "Sincerely," || line === "Sincerely") {
      // Signature block
      paragraphs.push(
        new Paragraph({
          spacing: { before: 400, after: 600 },
          children: [
            new TextRun({ text: "Sincerely,", font: "Times New Roman", size: 24 }),
          ],
        })
      );
    } else {
      // Regular paragraph
      const isBold = line === line.toUpperCase() && line.length > 3 && /[A-Z]/.test(line);
      paragraphs.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: line,
              font: "Times New Roman",
              size: 24,
              bold: isBold,
            }),
          ],
        })
      );
    }
  }

  return paragraphs;
}

/**
 * Export dispute letter as .docx Word document
 */
export async function exportAsWord(letterText: string, bureauName: string): Promise<void> {
  const paragraphs = parseLetterToParagraphs(letterText);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,    // 1 inch
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: paragraphs,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `Dispute_Letter_${bureauName}_${new Date().toISOString().slice(0, 10)}.docx`;
  saveAs(blob, filename);
}

/**
 * Export dispute letter as PDF using browser print
 */
export function exportAsPdf(letterText: string, bureauName: string): void {
  const lines = letterText.split("\n");

  const htmlLines = lines.map((line) => {
    if (line.trim() === "") return "<br/>";

    // Bullet items
    const bulletMatch = line.match(/^(\s*[-•]\s+)(.*)/);
    if (bulletMatch) {
      return `<p style="margin:0 0 4px 24px;">• ${escapeHtml(bulletMatch[2])}</p>`;
    }

    // Numbered items
    const numberedMatch = line.match(/^(\s*\d+\.\s+)(.*)/);
    if (numberedMatch) {
      return `<p style="margin:0 0 4px 24px;">${escapeHtml(line)}</p>`;
    }

    // Subject line
    if (line.startsWith("RE:") || line.startsWith("Re:")) {
      return `<p style="margin:0 0 8px 0;font-weight:bold;">${escapeHtml(line)}</p>`;
    }

    // Signature
    if (line === "Sincerely," || line === "Sincerely") {
      return `<p style="margin:24px 0 36px 0;">${escapeHtml(line)}</p>`;
    }

    return `<p style="margin:0 0 4px 0;">${escapeHtml(line)}</p>`;
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Dispute Letter - ${escapeHtml(bureauName)}</title>
      <style>
        @media print {
          @page { margin: 1in; }
          body { margin: 0; }
        }
        body {
          font-family: "Times New Roman", Times, serif;
          font-size: 12pt;
          line-height: 1.5;
          color: #000;
          max-width: 7.5in;
          margin: 0 auto;
          padding: 1in;
        }
      </style>
    </head>
    <body>
      ${htmlLines.join("\n")}
      <script>window.onload = function() { window.print(); }</script>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
