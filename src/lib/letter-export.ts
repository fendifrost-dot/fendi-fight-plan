import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ShadingType,
} from "docx";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";

// ---------------------------------------------------------------------------
// Shared: parse plain-text letter into structured paragraphs
// ---------------------------------------------------------------------------
function parseLetterToParagraphs(text: string): Paragraph[] {
  const lines = text.split("\n");
  const paragraphs: Paragraph[] = [];

  for (const line of lines) {
    // Empty line â vertical spacer
    if (line.trim() === "") {
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    // Bullet items
    const bulletMatch = line.match(/^(\s*[-â¢]\s+)(.*)/);
    if (bulletMatch) {
      paragraphs.push(
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: "â¢ ", font: "Times New Roman", size: 24 }),
            new TextRun({ text: bulletMatch[2], font: "Times New Roman", size: 24 }),
          ],
        })
      );
      continue;
    }

    // Numbered items
    const numberedMatch = line.match(/^(\s*\d+\.\s+)(.*)/);
    if (numberedMatch) {
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
      continue;
    }

    // Subject / RE: line â bold
    if (/^RE:/i.test(line)) {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 240, after: 240 },
          children: [
            new TextRun({ text: line, bold: true, font: "Times New Roman", size: 24 }),
          ],
        })
      );
      continue;
    }

    // Signature block
    if (line.trim() === "Sincerely," || line.trim() === "Sincerely") {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 480, after: 720 },
          children: [
            new TextRun({ text: "Sincerely,", font: "Times New Roman", size: 24 }),
          ],
        })
      );
      continue;
    }

    // Section headers â all-caps lines that are clearly headers (not account numbers / state abbrevs)
    const isHeader =
      line === line.toUpperCase() &&
      line.length > 6 &&
      /[A-Z]{4,}/.test(line) &&
      !/^\d/.test(line) &&        // not starting with a digit (account #s)
      !line.includes("#") &&      // not containing account numbers
      !/^[A-Z]{2}\s+\d/.test(line); // not "IL 60601" style

    paragraphs.push(
      new Paragraph({
        spacing: { after: isHeader ? 120 : 80 },
        children: [
          new TextRun({
            text: line,
            font: "Times New Roman",
            size: 24,
            bold: isHeader,
          }),
        ],
      })
    );
  }

  return paragraphs;
}

// ---------------------------------------------------------------------------
// Export as .docx Word document
// ---------------------------------------------------------------------------
export async function exportAsWord(letterText: string, bureauName: string): Promise<void> {
  const paragraphs = parseLetterToParagraphs(letterText);

  const doc = new Document({
    creator: "Credit Compass â Continuum Capital Group",
    title: `Dispute Letter â ${bureauName}`,
    description: `FCRA Dispute Letter addressed to ${bureauName}`,
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
  const filename = `Dispute_Letter_${bureauName.replace(/\s+/g, "_")}_${new Date()
    .toISOString()
    .slice(0, 10)}.docx`;
  saveAs(blob, filename);
}

// ---------------------------------------------------------------------------
// Export as real PDF download using jsPDF
// ---------------------------------------------------------------------------
export function exportAsPdf(letterText: string, bureauName: string): void {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter", // 8.5 x 11 inches
  });

  const marginLeft = 72;   // 1 inch
  const marginRight = 72;
  const marginTop = 72;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - marginLeft - marginRight;
  let y = marginTop;

  doc.setFont("Times-Roman");
  doc.setFontSize(12);

  const lines = letterText.split("\n");

  for (const rawLine of lines) {
    // Page break check â leave 72pt bottom margin
    if (y > pageHeight - marginRight) {
      doc.addPage();
      y = marginTop;
    }

    // Blank line â small vertical gap
    if (rawLine.trim() === "") {
      y += 8;
      continue;
    }

    // RE: subject line â bold
    if (/^RE:/i.test(rawLine)) {
      doc.setFont("Times-Bold");
      doc.setFontSize(12);
      const wrapped = doc.splitTextToSize(rawLine, usableWidth);
      doc.text(wrapped, marginLeft, y);
      y += wrapped.length * 16 + 8;
      doc.setFont("Times-Roman");
      continue;
    }

    // Sincerely â extra space before
    if (rawLine.trim() === "Sincerely," || rawLine.trim() === "Sincerely") {
      y += 32;
      doc.setFont("Times-Roman");
      doc.text("Sincerely,", marginLeft, y);
      y += 48; // space for physical signature
      continue;
    }

    // Section headers (all-caps meaningful headers)
    const isHeader =
      rawLine === rawLine.toUpperCase() &&
      rawLine.length > 6 &&
      /[A-Z]{4,}/.test(rawLine) &&
      !/^\d/.test(rawLine) &&
      !rawLine.includes("#") &&
      !/^[A-Z]{2}\s+\d/.test(rawLine);

    if (isHeader) {
      doc.setFont("Times-Bold");
    } else {
      doc.setFont("Times-Roman");
    }

    doc.setFontSize(12);

    // Bullet items â indent
    const bulletMatch = rawLine.match(/^(\s*[-â¢]\s+)(.*)/);
    const numberedMatch = rawLine.match(/^(\s*\d+\.\s+)(.*)/);
    const indent = bulletMatch || numberedMatch ? marginLeft + 18 : marginLeft;
    const lineWidth = bulletMatch || numberedMatch ? usableWidth - 18 : usableWidth;

    const wrapped = doc.splitTextToSize(rawLine.trimStart(), lineWidth);
    doc.text(wrapped, indent, y);
    y += wrapped.length * 16 + (isHeader ? 4 : 2);
  }

  const filename = `Dispute_Letter_${bureauName.replace(/\s+/g, "_")}_${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
  doc.save(filename);
}
