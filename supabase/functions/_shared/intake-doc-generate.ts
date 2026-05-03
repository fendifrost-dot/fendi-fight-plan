import type { IntakeClientRecord } from "./intake-types.ts";
import { BRAND } from "./intake-brand.ts";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function anyReconciliationMismatch(rec: IntakeClientRecord): boolean {
  const r = rec.identityReconciliation;
  return !(
    r.nameMatch.matches &&
    r.addressMatch.matches &&
    r.dobMatch.matches
  );
}

async function loadDocx() {
  return await import("npm:docx@9.6.0");
}

export async function buildClientSummaryDocx(
  rec: IntakeClientRecord,
): Promise<Uint8Array> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    HeadingLevel,
  } = await loadDocx();
  const c = rec.canonical;
  const addr = `${c.currentAddress.line1}${c.currentAddress.line2 ? ", " + c.currentAddress.line2 : ""}, ${c.currentAddress.city}, ${c.currentAddress.state} ${c.currentAddress.zip}`;

  const bureauRows = (["equifax", "experian", "transunion"] as const).map((b) => {
    const s = rec.bureauReported[b];
    return new TableRow({
      children: [
        new TableCell({ children: [new Paragraph(b.toUpperCase())] }),
        new TableCell({
          children: [new Paragraph(String(s.ficoScore ?? "—"))],
        }),
        new TableCell({
          children: [new Paragraph(String(s.totalAccounts ?? "—"))],
        }),
        new TableCell({
          children: [new Paragraph(s.totalDebtDisplay ?? "—")],
        }),
        new TableCell({
          children: [new Paragraph(s.utilizationDisplay ?? "—")],
        }),
      ],
    });
  });

  const derogRows: InstanceType<typeof TableRow>[] = [];
  for (const b of ["equifax", "experian", "transunion"] as const) {
    for (const acct of rec.bureauReported[b].derogatoryAccounts || []) {
      derogRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(b.toUpperCase())] }),
            new TableCell({ children: [new Paragraph(acct.creditor)] }),
            new TableCell({ children: [new Paragraph(acct.status)] }),
            new TableCell({
              children: [new Paragraph(acct.paymentHistory ?? acct.balance ?? "—")],
            }),
          ],
        }),
      );
    }
  }
  if (derogRows.length === 0) {
    derogRows.push(
      new TableRow({
        children: [
          new TableCell({ columnSpan: 4, children: [new Paragraph("No derogatory accounts parsed from PDFs.")] }),
        ],
      }),
    );
  }

  const idParas: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      children: [
        new TextRun({ text: "Name: ", bold: true }),
        new TextRun(rec.identityReconciliation.nameMatch.matches ? "Aligned" : "Variation noted"),
      ],
    }),
  ];
  for (const b of ["equifax", "experian", "transunion"] as const) {
    const v = rec.identityReconciliation.nameMatch.bureauValues?.[b];
    if (v) {
      idParas.push(new Paragraph({ text: `${b}: ${v}`, italics: true }));
    }
  }
  idParas.push(
    new Paragraph({
      children: [
        new TextRun({ text: "Current address: ", bold: true }),
        new TextRun(rec.identityReconciliation.addressMatch.matches ? "Aligned" : "Mismatch vs. canonical"),
      ],
    }),
  );
  for (const b of ["equifax", "experian", "transunion"] as const) {
    const v = rec.identityReconciliation.addressMatch.bureauValues?.[b];
    if (v) idParas.push(new Paragraph({ text: `${b}: ${v}`, italics: true }));
  }

  const engagementFee = rec.pricingApproved
    ? money(rec.pricingApproved.netTotal)
    : "(pending approval)";
  const tierText = `${rec.pricingRecommendation.tier.name} (${money(rec.pricingRecommendation.tier.low)} – ${money(rec.pricingRecommendation.tier.high)})`;

  const children: InstanceType<typeof Paragraph | typeof Table>[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "CC",
          bold: true,
          size: 96,
          color: BRAND.goldHex,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: BRAND.companyName, bold: true, size: 48 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: BRAND.tagline, italics: true })],
    }),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("Credit Analysis Summary")],
    }),
    new Paragraph(`Prepared For: ${c.legalName}`),
    new Paragraph(BRAND.preparedByLine),
    new Paragraph(`Date: ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}`),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Client Information (operator-verified canonical)")],
    }),
    new Paragraph(`Legal name: ${c.legalName}`),
    new Paragraph(`DOB: ${c.dob}`),
    new Paragraph(`Address: ${addr}`),
    new Paragraph(`Phone: ${c.phone}  |  Email: ${c.email}`),
    ...(c.employer ? [new Paragraph(`Employer: ${c.employer}`)] : []),
    ...(anyReconciliationMismatch(rec)
      ? [
        new Paragraph({
          children: [
            new TextRun({
              text:
                "Accuracy note: Bureau-reported identity differs from the operator-verified canonical record in one or more fields. Variations are summarized under Identity Variations Across Bureaus.",
              italics: true,
            }),
          ],
        }),
      ]
      : []),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Three-Bureau Snapshot")],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ["Bureau", "Score", "Accounts", "Total debt", "Utilization"].map(
            (h) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
              }),
          ),
        }),
        ...bureauRows,
      ],
    }),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("What's Helping the File")],
    }),
    new Paragraph(
      "Positive factors depend on parsed bureau data. Review tradelines with satisfactory payment history, low utilization where reported, and mature accounts.",
    ),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Negative Items Identified — Per Bureau")],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ["Bureau", "Creditor", "Status", "Payment / balance"].map(
            (h) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
              }),
          ),
        }),
        ...derogRows,
      ],
    }),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Bureau Discrepancies Identified")],
    }),
    new Paragraph(
      "Where the same account reports differently across bureaus (including payment history, balance, or status text), each bureau snapshot is preserved as reported.",
    ),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Identity Variations Across Bureaus")],
    }),
    ...idParas,
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Inquiries & Public Records")],
    }),
    ...(["equifax", "experian", "transunion"] as const).flatMap((b) => {
      const s = rec.bureauReported[b];
      const lines: InstanceType<typeof Paragraph>[] = [
        new Paragraph({ children: [new TextRun({ text: b.toUpperCase(), bold: true })] }),
      ];
      for (const iq of s.inquiries || []) {
        lines.push(new Paragraph(`Inquiry: ${iq.name ?? ""} ${iq.date ?? ""}`));
      }
      for (const pr of s.publicRecords || []) {
        lines.push(new Paragraph(`Public record: ${pr.text ?? pr.type ?? ""}`));
      }
      if (!s.inquiries?.length && !s.publicRecords?.length) {
        lines.push(new Paragraph("(none parsed)"));
      }
      return lines;
    }),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Our Documentation Process")],
    }),
    new Paragraph(
      "Continuum Capital Group maintains chain-of-custody documentation suitable for regulatory and legal escalation. Source bureau reports, operator-verified intake records, and generated workpapers are retained in the client file.",
    ),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("FCRA Compliance Statement")],
    }),
    new Paragraph(
      "Services are offered with awareness of the Fair Credit Reporting Act, 15 U.S.C. § 1681 et seq., including consumer rights to dispute inaccurate or incomplete information with consumer reporting agencies.",
    ),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Scope & Disclaimer")],
    }),
    new Paragraph(
      "This summary is informational and describes items observed in the materials reviewed. It is not legal advice and does not guarantee outcomes with credit bureaus, furnishers, or courts.",
    ),
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Engagement Terms")],
    }),
    new Paragraph(`File profile score (rubric): ${rec.pricingRecommendation.score.toFixed(2)}`),
    new Paragraph(`Recommended tier: ${tierText}`),
    new Paragraph(`Approved engagement fee: ${engagementFee}`),
    new Paragraph(
      "Acceptance is recorded electronically through the engagement-confirmation step that accompanies this document.",
    ),
    ...(rec.paymentPlan
      ? [
        new Paragraph(
          `Payment plan: Deposit ${money(rec.paymentPlan.deposit.amount)} due by ${rec.paymentPlan.deposit.dueBy}; remaining balance ${money(rec.paymentPlan.remainingBalance)}.`,
        ),
      ]
      : []),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export async function buildOperatorPricingCardDocx(
  rec: IntakeClientRecord,
): Promise<Uint8Array> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    HeadingLevel,
    Footer,
  } = await loadDocx();

  const fp = rec.fileProfile;
  const pr = rec.pricingRecommendation;
  const pa = rec.pricingApproved;

  const doc = new Document({
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "INTERNAL — DO NOT SEND TO CLIENT",
                    bold: true,
                    color: "CC0000",
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Operator Pricing Card (INTERNAL)")],
          }),
          new Paragraph(`Client: ${rec.canonical.legalName}`),
          new Paragraph(`Client ID: ${rec.clientId}`),
          new Paragraph({ text: "" }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Derogatory Profile (rubric inputs)")],
          }),
          new Table({
            width: { size: 80, type: WidthType.PERCENTAGE },
            rows: [
              ["Charge-offs", String(fp.chargeOffs)],
              ["Collections", String(fp.collections)],
              ["Public records", String(fp.publicRecords)],
              ["Late accounts (excl. CO)", String(fp.lateAccountsExcludingCO)],
              ["Hard inquiries", String(fp.hardInquiries)],
            ].map(
              ([k, v]) =>
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph(String(k))] }),
                    new TableCell({ children: [new Paragraph(String(v))] }),
                  ],
                }),
            ),
          }),
          new Paragraph({ text: "" }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Rubric Recommendation")],
          }),
          new Paragraph(`Score: ${pr.score.toFixed(2)}`),
          new Paragraph(`${pr.tier.name}: ${money(pr.tier.low)} – ${money(pr.tier.high)}`),
          new Paragraph({ text: "" }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Operator Decision")],
          }),
          pa
            ? new Paragraph(`Quoted fee: ${money(pa.quotedFee)}  |  Net total: ${money(pa.netTotal)}`)
            : new Paragraph("(Not approved)"),
          ...(pa?.overrideReason
            ? [new Paragraph(`Decision vs. rubric (override): ${pa.overrideReason}`)]
            : []),
          new Paragraph({ text: "" }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Operator Notes & Approval")],
          }),
          new Paragraph("Signature: ________________________________"),
          new Paragraph(`Date: ${pa ? new Date(pa.approvedAt).toLocaleDateString() : "________"}`),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export async function buildSimpleSummaryPdf(rec: IntakeClientRecord): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("npm:pdf-lib@1.17.1");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  let page = pdf.addPage([612, 792]);
  let y = 750;
  const gold = rgb(0.78, 0.65, 0.27);
  const dark = rgb(0.12, 0.14, 0.16);

  const draw = (text: string, size = 11, bold = false, color = dark) => {
    if (y < 60) {
      page = pdf.addPage([612, 792]);
      y = 750;
    }
    page.drawText(text.slice(0, 120), {
      x: margin,
      y,
      size,
      font: bold ? fontBold : font,
      color,
      maxWidth: 512,
    });
    y -= size + 6;
  };

  page.drawText(BRAND.companyName, {
    x: margin,
    y,
    size: 18,
    font: fontBold,
    color: gold,
  });
  y -= 28;
  draw(BRAND.tagline, 10, false, rgb(0.4, 0.42, 0.45));
  y -= 10;
  draw("Credit Analysis Summary", 14, true);
  draw(`Prepared For: ${rec.canonical.legalName}`);
  draw(`Date: ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}`);
  y -= 8;
  draw("Client Information", 12, true, gold);
  draw(`${rec.canonical.legalName} | DOB ${rec.canonical.dob}`);
  draw(
    `${rec.canonical.currentAddress.line1}, ${rec.canonical.currentAddress.city}, ${rec.canonical.currentAddress.state} ${rec.canonical.currentAddress.zip}`,
  );
  y -= 8;
  draw("Identity reconciliation", 12, true, gold);
  draw(`Name match: ${rec.identityReconciliation.nameMatch.matches ? "yes" : "variation"}`);
  draw(`Address match: ${rec.identityReconciliation.addressMatch.matches ? "yes" : "variation"}`);
  y -= 8;
  draw("Engagement", 12, true, gold);
  if (rec.pricingApproved) {
    draw(`Approved net total: ${money(rec.pricingApproved.netTotal)}`);
  } else {
    draw("Pricing not yet approved.");
  }
  y -= 8;
  draw("FCRA: 15 U.S.C. § 1681 et seq. — informational summary; not legal advice.", 9);

  return await pdf.save();
}

export async function buildSimpleOperatorCardPdf(rec: IntakeClientRecord): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("npm:pdf-lib@1.17.1");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 720;
  const red = rgb(0.8, 0, 0);
  page.drawText("INTERNAL — DO NOT SEND TO CLIENT", {
    x: 50,
    y,
    size: 12,
    font: fontBold,
    color: red,
  });
  y -= 36;
  page.drawText("Operator Pricing Card", { x: 50, y, size: 16, font: fontBold });
  y -= 28;
  page.drawText(`${rec.canonical.legalName} (${rec.clientId})`, { x: 50, y, size: 11, font });
  y -= 40;
  page.drawText(
    `Rubric score ${rec.pricingRecommendation.score.toFixed(2)} | Tier ${money(rec.pricingRecommendation.tier.low)}-${money(rec.pricingRecommendation.tier.high)}`,
    { x: 50, y, size: 11, font },
  );
  y -= 22;
  if (rec.pricingApproved) {
    page.drawText(`Quoted: ${money(rec.pricingApproved.quotedFee)} Net: ${money(rec.pricingApproved.netTotal)}`, {
      x: 50,
      y,
      size: 11,
      font,
    });
  }
  return await pdf.save();
}
