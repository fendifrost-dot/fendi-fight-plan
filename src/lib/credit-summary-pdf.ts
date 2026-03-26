import jsPDF from "jspdf";
import type { CreditSummaryData } from "@/components/CreditSummary";

// ---------------------------------------------------------------------------
// Brand constants
// ---------------------------------------------------------------------------
const BRAND = "Prepared by Continuum Capital Group";
const GOLD: [number, number, number] = [200, 165, 60];
const DARK: [number, number, number] = [30, 35, 45];
const MID: [number, number, number] = [100, 105, 115];
const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [220, 60, 60];
const ORANGE: [number, number, number] = [220, 140, 40];
const GREEN: [number, number, number] = [60, 180, 90];
const PURPLE: [number, number, number] = [140, 80, 200];

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN_L = 18;
const MARGIN_R = 18;
const MARGIN_T = 28;
const MARGIN_B = 24;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function scoreColor(score: number | undefined): [number, number, number] {
  if (!score) return MID;
  if (score >= 720) return GREEN;
  if (score >= 660) return [200, 180, 40];
  if (score >= 580) return ORANGE;
  return RED;
}

function scoreLabel(score: number | undefined): string {
  if (!score) return "N/A";
  if (score >= 720) return "Good";
  if (score >= 660) return "Fair";
  if (score >= 580) return "Poor";
  return "Very Poor";
}

function parseDollar(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[$,]/g, ""));
  return isNaN(n) ? 0 : n;
}

function fmtDollar(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// ---------------------------------------------------------------------------
// PDF Builder
// ---------------------------------------------------------------------------

/**
 * Returns the Continuum Capital Group logo as an inline base64 data URL.
 * This avoids unreliable runtime fetching from /lovable-uploads/.
 */
function fetchLogoBase64(): Promise<string | null> {
  // Hardcoded Continuum Capital Group logo (200x50 PNG)
  const LOGO_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAAAyCAYAAAAZUZThAAAGvElEQVR42u2deagVVRzHP68slNzyZWTlREzSZmnm1JQjRhuBJu2Lo7SSYCBoUVAiSLSY2v5HWVBSk1K0mYoF0TbR2FDQCi1TNq6Vmr0SLczXH/O7NAx37p077973fPr7wGO2c37nnPfOd87vN3POPFAURVEURVEURVEURVEURVF6MW3NNBZ4Tmcj6W3Xb9M/gbJPC6SgKNYAZ6pYlP1KINXEUa2jB54T2K5vl8mrKD1Jn2YIo0zHTuep2KtsVSjK3sIBrRZH4DlBelvEvWo0llGUvUIg6Y5ru35bM+/0WXsqEqVXuVhZcbSqQrbrt6VdrkbLMkxrPHAncBYwANgKfAlcHEfh35LmMmAWMFp+B98BzwBPxFHYKWnWA0cBEXBCHIW7DdMaC4TAH3EUDjZMazswqEZ1jgV8sTMtjsIXitrOpEvnfQa4CfDiKJxaNF0qDcDoOAo/l3TnAO/K+a/jKBypsuiCi9Ud8UHZMgzTmgq8B5wBTAPagYnAxsrNwDCtWcArwBCSJ2vHAeuAx0QkWUzghmrlxVE4OI7CNqBf6vRZcRS2yc/aOlXOtd1iZubsK2UEUtbdycYdteKQrpZtmNZA4Alp0+w4ClfFUfhnHIWfxVF4fRyFOwzTGgLcK1lmx1H4TRyFG4BbgH+BGw3Tyj6O7gTmGKZ1cAt+/620ncdmYIphWu2GaR0DTAY2qRRKCqS7XKtao0hBkUxIuTvLc9KMT93t30+NBBuBb+XwwkyelwBDRNRsWmk7jyeBvlLmrcCBck7piovVE49eGyzzcNnuiqOwIyfNYbLdGUfhrsy1rbIdmjm/GPgZuCvjSjWDVtrO4x3gKxHHzRIjfaZSaFIMshfzq2z7irtVjS2y7WeYVt/MtfZMmgr/APcAw4AZTa5zPdu1Rs49JdJVeFwC9kMl9lLKCKQrj1rz4o0ycUjBurwPVEaOi3PSfAjsTLlklfjlSOB4OXyrSr4lwPfA1S34G9SyvU62g1PnDs1cayRdheeBbcB64DWVQRdHkJ58s120bHGrZsrddJFhWhcZptXfMK1TDdN61jCtQ+Io3AbMlSwPGaZ1oohjsfjiS+IoXFPF9m5gHk2e3FnA9suynWKY1mGGaY0EzgN2A6+WSFcpc2cche1xFA6X8pX9wMUijsIlwLniU78I/C4+93DpLMRRuBC4CthO8t7hRwmUZwE31jC/VHz3VpBn+1Gp10BgrYySlXc6n5ZIpzRIvWkipedG1ZlaYpdxr3SOlrJPjCD14oyycYiiqIulKCqQ0iOTTmBUVCA1YheNQRQViKLs0wKp95Sq0adYitJT9NmXGhN4zqkkUyfGkKy1mGm7/odybTFwvO36E+T4aP5/y/wbcJ/t+o/I+WXA+fz/1j3NfJKp8llby2zXd2rUbRTwMHA6yYzahbbrP52pxxZgge36D6byjSGZpXwKybqVWbbrfxB4jg3cbrv+FZLuCGA1MKlau7Srt3AE6cnguGjZgecMBFYAT5HMM7oOuESuHUzyAvGQwHOMVLaPJK45G5gTeE7/1Ci3K7XKcSVwmuzPzbFVq26DpG6LSV5aTgTGyvl0Pc4A7gg8Z0Aq3xvAIpL5WncDSwPPGVanyNx2KU0cQdKr+3pBgD4JeNt2/aVy/AVwm+xPBD4mmdI+BXggk7cyoa9IW+vZysuz2nb9ZXLcAUwXEQxIpeskmcC4J9OmV+R4deA5HnAl8EmBchtpl9KdQXpenNHC+GM48EPONZdkjchy2a8wTm4Aa4D7bdffUaCcPFv16hZVXKHAczrlx8nU4ydgXqoeR5NMZEzzvZyvRZl2KV0RSE+MJA2WuY5k+Ww19+YCuYN/Ia7RqLQrYrv+UNv1FxV0lfJs1aubKTeIzTIaemmXiGSy5GTgpsBzKqPlemBExtYIOf8XyZr7CgOBP8u0S+lCkN7Vjyg0QxwFy1wBPBB4zrWyf6zEId9I5+kIPCc9CpRZB3FFSVurgPmB51wj8cxBJAu80m3cA7wpaSZKG1ZKvstJpuGPA6ZKoL8dODnwHEvaOINk8qXS3SNIb5jubrt+B8k6kOnABuA54HXpwJNTAfdJ0tHLuJe1bI1LuU67MnXbnqlbSPJxiWpz0haQfJWlku9S4HaSdeP3A9fYrr/Jdv2dIoqlwC8yet6nXbq5FO74ZdempycmFo0/emodvKKUjkG666NuKg6lVwqkmkiaKZSsPRWH0usEUq3jNkMkzfgYtqL0aAxSpGPndW799wfKfimQBkYQ/Qc6yv4pkIJiqSoQFYWioCsBFUVRFEVRFEVRFEVRFEVRWsd/fowGZCfkaRsAAAAASUVORK5CYII=";
  return Promise.resolve(LOGO_BASE64);
}

class SummaryPDF {
  private doc: jsPDF;
  private y = MARGIN_T;
  private pageNum = 0;
  private dateStr: string;
  private consumerName: string;
  private logoBase64: string | null = null;

  constructor(consumerName: string, logoBase64: string | null = null) {
    this.doc = new jsPDF({ unit: "mm", format: "a4" });
    this.dateStr = formatDate();
    this.consumerName = consumerName;
    this.logoBase64 = logoBase64;
    this.pageNum = 1;
    this.drawHeader();
    this.drawFooter();
  }

  // --- Page management ---

  private ensureSpace(needed: number) {
    if (this.y + needed > PAGE_H - MARGIN_B) {
      this.newPage();
    }
  }

  private newPage() {
    this.doc.addPage();
    this.pageNum++;
    this.y = MARGIN_T;
    this.drawHeader();
    this.drawFooter();
  }

  private drawHeader() {
    let brandTextX = MARGIN_L;

    // If logo is available, embed it
    if (this.logoBase64) {
      try {
        const logoH = 8; // mm
        const logoW = 8; // mm (will be auto-scaled)
        this.doc.addImage(this.logoBase64, 'PNG', MARGIN_L, 3, logoW, logoH);
        brandTextX = MARGIN_L + logoW + 2;
      } catch {
        // Fallback to text-only if image fails
      }
    }

    // Gold accent line
    this.doc.setDrawColor(...GOLD);
    this.doc.setLineWidth(0.6);
    this.doc.line(MARGIN_L, 12, PAGE_W - MARGIN_R, 12);

    // Brand text left
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(7);
    this.doc.setTextColor(...GOLD);
    this.doc.text(BRAND, brandTextX, 10);

    // Date right
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(7);
    this.doc.setTextColor(...MID);
    this.doc.text(this.dateStr, PAGE_W - MARGIN_R, 10, { align: "right" });
  }

  private drawFooter() {
    const footerY = PAGE_H - 10;

    // Gold line
    this.doc.setDrawColor(...GOLD);
    this.doc.setLineWidth(0.4);
    this.doc.line(MARGIN_L, footerY - 3, PAGE_W - MARGIN_R, footerY - 3);

    // Brand + page
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(6.5);
    this.doc.setTextColor(...MID);
    this.doc.text("Continuum Capital Group â Confidential", MARGIN_L, footerY);
    this.doc.text(`Page ${this.pageNum}`, PAGE_W - MARGIN_R, footerY, {
      align: "right",
    });
  }

  // --- Drawing primitives ---

  private sectionTitle(title: string, color: [number, number, number] = GOLD) {
    this.ensureSpace(12);
    this.y += 4;
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(0.4);
    this.doc.line(MARGIN_L, this.y, MARGIN_L + CONTENT_W, this.y);
    this.y += 5;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(11);
    this.doc.setTextColor(...color);
    this.doc.text(title, MARGIN_L, this.y);
    this.y += 6;
  }

  private label(text: string, x: number) {
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(7);
    this.doc.setTextColor(...MID);
    this.doc.text(text, x, this.y);
  }

  private value(
    text: string,
    x: number,
    color: [number, number, number] = DARK,
    size = 9,
    style: "bold" | "normal" = "bold"
  ) {
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
    this.doc.text(text, x, this.y);
  }

  private tableRow(
    cols: { text: string; x: number; w: number; color?: [number, number, number]; align?: "left" | "right" }[],
    bold = false
  ) {
    this.ensureSpace(6);
    cols.forEach((col) => {
      this.doc.setFont("helvetica", bold ? "bold" : "normal");
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(...(col.color || DARK));
      this.doc.text(col.text, col.align === "right" ? col.x + col.w : col.x, this.y, {
        align: col.align || "left",
      });
    });
    this.y += 5;
  }

  // --- Sections ---

  buildTitle(data: CreditSummaryData) {
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(18);
    this.doc.setTextColor(...DARK);
    this.doc.text("Credit Summary Report", PAGE_W / 2, this.y, { align: "center" });
    this.y += 7;

    if (data.fullLegalName) {
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(12);
      this.doc.setTextColor(...DARK);
      this.doc.text(data.fullLegalName, PAGE_W / 2, this.y, { align: "center" });
      this.y += 5;
    }

    if (data.currentAddress) {
      this.doc.setFontSize(8);
      this.doc.setTextColor(...MID);
      this.doc.text(data.currentAddress, PAGE_W / 2, this.y, { align: "center" });
      this.y += 5;
    }
    this.y += 2;
  }

  buildScores(data: CreditSummaryData) {
    if (!data.scores) return;
    this.sectionTitle("Credit Scores");

    const bureaus = ["experian", "transunion", "equifax"] as const;
    const boxW = (CONTENT_W - 8) / 3;

    bureaus.forEach((b, i) => {
      const score = data.scores?.[b];
      const date = data.reportDates?.[b];
      const x = MARGIN_L + i * (boxW + 4);
      const bLabel = b.charAt(0).toUpperCase() + b.slice(1);

      // Box background
      this.doc.setFillColor(245, 245, 248);
      this.doc.roundedRect(x, this.y, boxW, 22, 2, 2, "F");

      // Bureau name
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(7);
      this.doc.setTextColor(...MID);
      this.doc.text(bLabel, x + boxW / 2, this.y + 5, { align: "center" });

      // Score
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(16);
      this.doc.setTextColor(...scoreColor(score));
      this.doc.text(score ? String(score) : "â", x + boxW / 2, this.y + 13, { align: "center" });

      // Label
      this.doc.setFontSize(6.5);
      this.doc.text(scoreLabel(score), x + boxW / 2, this.y + 17, { align: "center" });

      // Date
      if (date) {
        this.doc.setFont("helvetica", "normal");
        this.doc.setFontSize(6);
        this.doc.setTextColor(...MID);
        this.doc.text(date, x + boxW / 2, this.y + 21, { align: "center" });
      }
    });

    this.y += 28;
  }

  buildMetrics(data: CreditSummaryData) {
    this.sectionTitle("Key Metrics");

    const totalDerog = data.derogatoryAccounts.length + data.collections.length + data.chargeOffs.length;
    const totalBal = [...data.derogatoryAccounts, ...data.collections, ...data.chargeOffs].reduce(
      (s, a) => s + parseDollar(a.balance), 0
    );
    const totalPastDue = data.derogatoryAccounts.reduce((s, a) => s + parseDollar(a.past_due), 0);

    const metrics = [
      { label: "Derogatory Items", val: String(totalDerog), color: RED },
      { label: "Hard Inquiries", val: String(data.inquiries.length), color: ORANGE },
      { label: "Identity Errors", val: String(data.inaccurateNames.length + data.inaccurateAddresses.length), color: [200, 180, 40] as [number, number, number] },
      { label: "Public Records", val: String(data.publicRecords.length), color: PURPLE },
    ];

    const boxW = (CONTENT_W - 12) / 4;
    metrics.forEach((m, i) => {
      const x = MARGIN_L + i * (boxW + 4);
      this.doc.setFillColor(245, 245, 248);
      this.doc.roundedRect(x, this.y, boxW, 16, 2, 2, "F");

      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(14);
      this.doc.setTextColor(...m.color);
      this.doc.text(m.val, x + boxW / 2, this.y + 8, { align: "center" });

      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(6);
      this.doc.setTextColor(...MID);
      this.doc.text(m.label, x + boxW / 2, this.y + 13, { align: "center" });
    });

    this.y += 22;

    // Balance row
    if (totalBal > 0) {
      this.ensureSpace(14);
      const halfW = (CONTENT_W - 4) / 2;

      this.doc.setFillColor(250, 245, 245);
      this.doc.roundedRect(MARGIN_L, this.y, halfW, 12, 2, 2, "F");
      this.label("Total Disputed Balance", MARGIN_L + 3);
      this.y += 5;
      this.value(fmtDollar(totalBal), MARGIN_L + 3, RED, 11);
      this.y -= 5;

      const x2 = MARGIN_L + halfW + 4;
      this.doc.setFillColor(252, 248, 240);
      this.doc.roundedRect(x2, this.y, halfW, 12, 2, 2, "F");
      this.label("Total Past Due", x2 + 3);
      this.y += 5;
      this.value(fmtDollar(totalPastDue), x2 + 3, ORANGE, 11);

      this.y += 10;
    }
  }

  buildAccountTable(
    title: string,
    accounts: CreditSummaryData["derogatoryAccounts"],
    color: [number, number, number],
    showPastDue = false
  ) {
    if (accounts.length === 0) return;
    this.ensureSpace(16);

    // Sub-heading
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...color);
    this.doc.text(title, MARGIN_L, this.y);
    this.y += 5;

    // Header
    const cols = [
      { text: "Creditor", x: MARGIN_L, w: 55 },
      { text: "Account #", x: MARGIN_L + 56, w: 35 },
      { text: "Balance", x: MARGIN_L + 92, w: 28, align: "right" as const },
      ...(showPastDue
        ? [{ text: "Past Due", x: MARGIN_L + 121, w: 25, align: "right" as const }]
        : []),
      { text: "Bureau", x: MARGIN_L + (showPastDue ? 147 : 121), w: 27, align: "right" as const },
    ];

    // Header bg
    this.doc.setFillColor(240, 240, 243);
    this.doc.rect(MARGIN_L, this.y - 3.5, CONTENT_W, 5, "F");

    this.tableRow(
      cols.map((c) => ({ ...c, color: MID })),
      true
    );

    // Rows
    accounts.forEach((a) => {
      const row = [
        { text: a.creditor_name || "â", x: MARGIN_L, w: 55, color: DARK },
        { text: a.account_number || "â", x: MARGIN_L + 56, w: 35, color: MID },
        { text: a.balance || "â", x: MARGIN_L + 92, w: 28, align: "right" as const, color: RED },
        ...(showPastDue
          ? [{ text: a.past_due || "â", x: MARGIN_L + 121, w: 25, align: "right" as const, color: ORANGE }]
          : []),
        {
          text: a.source || "â",
          x: MARGIN_L + (showPastDue ? 147 : 121),
          w: 27,
          align: "right" as const,
          color: MID,
        },
      ];
      this.tableRow(row);
    });

    this.y += 3;
  }

  buildAccounts(data: CreditSummaryData) {
    this.sectionTitle("Account Breakdown");
    this.buildAccountTable(
      `Open Negative Accounts (${data.derogatoryAccounts.length})`,
      data.derogatoryAccounts,
      ORANGE,
      true
    );
    this.buildAccountTable(`Collections (${data.collections.length})`, data.collections, RED);
    this.buildAccountTable(`Charge-Offs (${data.chargeOffs.length})`, data.chargeOffs, RED);

    if (
      data.derogatoryAccounts.length === 0 &&
      data.collections.length === 0 &&
      data.chargeOffs.length === 0
    ) {
      this.ensureSpace(8);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8);
      this.doc.setTextColor(...GREEN);
      this.doc.text("No derogatory accounts found.", MARGIN_L, this.y);
      this.y += 6;
    }
  }

  buildIdentityErrors(data: CreditSummaryData) {
    if (data.inaccurateNames.length === 0 && data.inaccurateAddresses.length === 0) return;

    this.sectionTitle("Identity Errors", [200, 180, 40]);

    if (data.inaccurateNames.length > 0) {
      this.ensureSpace(8);
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(...ORANGE);
      this.doc.text(`Inaccurate Names (${data.inaccurateNames.length})`, MARGIN_L, this.y);
      this.y += 5;

      data.inaccurateNames.forEach((n) => {
        this.ensureSpace(6);
        this.doc.setFont("helvetica", "bold");
        this.doc.setFontSize(7.5);
        this.doc.setTextColor(...DARK);
        this.doc.text(`"${n.reported_name}"`, MARGIN_L + 3, this.y);

        this.doc.setFont("helvetica", "normal");
        this.doc.setTextColor(...MID);
        const reasonX = MARGIN_L + 3 + this.doc.getTextWidth(`"${n.reported_name}"  `);
        this.doc.text(`â ${n.mismatch_reason}`, Math.min(reasonX, MARGIN_L + 80), this.y);
        this.y += 5;
      });
      this.y += 2;
    }

    if (data.inaccurateAddresses.length > 0) {
      this.ensureSpace(8);
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(...ORANGE);
      this.doc.text(`Inaccurate Addresses (${data.inaccurateAddresses.length})`, MARGIN_L, this.y);
      this.y += 5;

      data.inaccurateAddresses.forEach((a) => {
        this.ensureSpace(6);
        this.doc.setFont("helvetica", "normal");
        this.doc.setFontSize(7.5);
        this.doc.setTextColor(...DARK);
        let line = a.reported_address;
        if (a.linked_to_derogatory) line += "  [linked to derogatory]";
        const lines = this.doc.splitTextToSize(line, CONTENT_W - 6);
        lines.forEach((l: string) => {
          this.ensureSpace(5);
          this.doc.text(l, MARGIN_L + 3, this.y);
          this.y += 4.5;
        });
      });
      this.y += 2;
    }
  }

  buildInquiries(data: CreditSummaryData) {
    if (data.inquiries.length === 0) return;

    this.sectionTitle("Hard Inquiries", ORANGE);

    // Header
    this.doc.setFillColor(240, 240, 243);
    this.doc.rect(MARGIN_L, this.y - 3.5, CONTENT_W, 5, "F");

    this.tableRow(
      [
        { text: "Creditor", x: MARGIN_L, w: 70, color: MID },
        { text: "Date", x: MARGIN_L + 72, w: 40, color: MID },
        { text: "Bureau", x: MARGIN_L + 113, w: 61, align: "right", color: MID },
      ],
      true
    );

    data.inquiries.forEach((inq) => {
      this.tableRow([
        { text: inq.creditor_name, x: MARGIN_L, w: 70, color: DARK },
        { text: inq.date, x: MARGIN_L + 72, w: 40, color: MID },
        { text: inq.source || "â", x: MARGIN_L + 113, w: 61, align: "right", color: MID },
      ]);
    });

    this.y += 2;
  }

  buildPublicRecords(data: CreditSummaryData) {
    if (data.publicRecords.length === 0) return;

    this.sectionTitle("Public Records", PURPLE);

    this.doc.setFillColor(240, 240, 243);
    this.doc.rect(MARGIN_L, this.y - 3.5, CONTENT_W, 5, "F");

    this.tableRow(
      [
        { text: "Type", x: MARGIN_L, w: 50, color: MID },
        { text: "Filing Date", x: MARGIN_L + 52, w: 40, color: MID },
        { text: "Status", x: MARGIN_L + 94, w: 40, color: MID },
        { text: "Bureau", x: MARGIN_L + 135, w: 39, align: "right", color: MID },
      ],
      true
    );

    data.publicRecords.forEach((pr) => {
      this.tableRow([
        { text: pr.type, x: MARGIN_L, w: 50, color: DARK },
        { text: pr.filing_date, x: MARGIN_L + 52, w: 40, color: MID },
        { text: pr.status, x: MARGIN_L + 94, w: 40, color: DARK },
        { text: pr.source || "â", x: MARGIN_L + 135, w: 39, align: "right", color: MID },
      ]);
    });
  }

  // --- Build & save ---

  generate(data: CreditSummaryData) {
    this.buildTitle(data);
    this.buildScores(data);
    this.buildMetrics(data);
    this.buildAccounts(data);
    this.buildIdentityErrors(data);
    this.buildInquiries(data);
    this.buildPublicRecords(data);

    // Update page numbers on all pages
    const total = this.doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      // Overwrite page number area
      this.doc.setFillColor(255, 255, 255);
      this.doc.rect(PAGE_W - MARGIN_R - 20, PAGE_H - 13, 20, 6, "F");
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(6.5);
      this.doc.setTextColor(...MID);
      this.doc.text(`Page ${i} of ${total}`, PAGE_W - MARGIN_R, PAGE_H - 10, {
        align: "right",
      });
    }

    this.doc.save(
      `Credit_Summary_${(data.fullLegalName || "Report").replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function exportCreditSummaryPdf(data: CreditSummaryData): Promise<void> {
  const logoBase64 = await fetchLogoBase64();
  const pdf = new SummaryPDF(data.fullLegalName || "Consumer", logoBase64);
  pdf.generate(data);
}
