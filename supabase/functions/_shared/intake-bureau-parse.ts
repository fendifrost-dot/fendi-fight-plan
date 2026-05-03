import type { BureauSnapshot } from "./intake-types.ts";
import { EMPTY_BUREAU } from "./intake-types.ts";

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function matchScore(line: string): number | undefined {
  const m = line.match(/\b([45-8]\d{2}|9\d{2})\b/);
  if (m) return parseInt(m[1], 10);
  return undefined;
}

function parseMoney(s: string): string | undefined {
  const m = s.match(/\$[\d,]+(?:\.\d{2})?/);
  return m ? m[0] : undefined;
}

/** Best-effort parse of bureau PDF text into BureauSnapshot (per-bureau divergence preserved). */
export function parseBureauReportText(rawText: string): BureauSnapshot {
  const snap: BureauSnapshot = {
    ...EMPTY_BUREAU,
    derogatoryAccounts: [],
    inquiries: [],
    publicRecords: [],
  };
  if (!rawText?.trim()) return snap;

  const L = lines(rawText);
  const upperBlock = rawText.toUpperCase();

  // Name heuristics
  const nameLine = L.find((l) =>
    /^(NAME|CONSUMER\s*NAME|REPORTED\s*NAME)\s*[:\-]/i.test(l)
  );
  if (nameLine) {
    snap.consumerLegalName = nameLine.replace(/^[^:]*:\s*/i, "").trim();
  } else {
    const m = rawText.match(/consumer\s*name\s*[:\s]+([^\n]+)/i);
    if (m) snap.consumerLegalName = m[1].trim();
  }

  const aka: string[] = [];
  for (const l of L) {
    if (/also\s*known\s*as|aka|former\s*name/i.test(l)) {
      const v = l.replace(/^[^:]*:\s*/i, "").trim();
      if (v) aka.push(v);
    }
  }
  snap.alsoKnownAs = aka;

  // DOB
  const dobM = rawText.match(
    /date\s*of\s*birth|d\.?\s*o\.?\s*b\.?\s*[:\s]+([^\n]+)/i,
  );
  if (dobM) snap.dateOfBirthRaw = dobM[1].trim().slice(0, 80);

  // Employer
  const empM = rawText.match(/employer\s*[:\s]+([^\n]+)/i);
  if (empM) snap.employer = empM[1].trim().slice(0, 120);

  // FICO
  for (const l of L) {
    if (/fico|vantage|score/i.test(l)) {
      const sc = matchScore(l);
      if (sc && sc >= 300 && sc <= 900) {
        snap.ficoScore = sc;
        break;
      }
    }
  }

  // Totals
  const debtM = rawText.match(/total\s*(?:revolving\s*)?debt|amount\s*owed\s*[:\s]+\$?[\d,]+/i);
  if (debtM) snap.totalDebtDisplay = parseMoney(debtM[0]);

  const utilM = rawText.match(/utili[sz]ation\s*[:\s]+[\d.]+\s*%/i);
  if (utilM) snap.utilizationDisplay = utilM[0].replace(/^[^:]*:\s*/i, "").trim();

  const acctM = rawText.match(/open\s*accounts|total\s*accounts\s*[:\s]+(\d+)/i);
  if (acctM) snap.totalAccounts = parseInt(acctM[1], 10);

  // Derogatory / adverse sections — line-oriented
  let inNeg = false;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (/adverse|negative|derogatory|potentially\s*negative/i.test(l)) {
      inNeg = true;
      continue;
    }
    if (inNeg && /^[A-Z0-9\s&.'-]{4,60}$/.test(l) && L[i + 1]?.includes("Account")) {
      const creditor = l;
      const rest = L.slice(i, i + 12).join(" | ");
      const statusM = rest.match(/status\s*[:\s]+([^|]+)/i);
      const balM = rest.match(/balance\s*[:\s]+(\$?[\d,]+)/i);
      const pastM = rest.match(/past\s*due\s*[:\s]+(\$?[\d,]+)/i);
      const phM = rest.match(/payment\s*history\s*[:\s]+([^\|]+)/i);
      snap.derogatoryAccounts.push({
        creditor,
        status: statusM ? statusM[1].trim() : "Reported adverse",
        balance: balM ? balM[1] : undefined,
        pastDue: pastM ? pastM[1] : undefined,
        paymentHistory: phM ? phM[1].trim() : undefined,
        rawSnippet: rest.slice(0, 400),
      });
      inNeg = false;
    }
  }

  // If no structured adverse block, infer from keywords per line
  if (snap.derogatoryAccounts.length === 0) {
    for (const l of L) {
      const u = l.toUpperCase();
      if (
        u.includes("CHARGE OFF") || u.includes("CHARGE-OFF") ||
        u.includes("COLLECTION") || u.includes("LATE PAYMENT") ||
        u.includes("SERIOUS DELINQUENCY")
      ) {
        snap.derogatoryAccounts.push({
          creditor: l.slice(0, 80),
          status: l,
        });
      }
    }
  }

  // Public records
  if (/bankruptcy|judgment|lien|public\s*record/i.test(upperBlock)) {
    for (const l of L) {
      if (/bankruptcy|judgment|lien|tax\s*lien|foreclosure/i.test(l)) {
        snap.publicRecords.push({ text: l });
      }
    }
  }

  // Inquiries
  if (/inquir/i.test(upperBlock)) {
    for (const l of L) {
      if (/inquir/i.test(l) && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(l)) {
        const dateM = l.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
        snap.inquiries.push({
          name: l.replace(dateM?.[0] || "", "").replace(/inquir/gi, "").trim().slice(0, 80),
          date: dateM?.[0],
          type: /hard/i.test(l) ? "hard" : "hard",
        });
      }
    }
  }

  // Address (current)
  const addrM = rawText.match(
    /current\s*address\s*[:\s]+([^\n]+(?:\n[^\n]+){0,2})/i,
  );
  if (addrM) {
    const blob = addrM[1].replace(/\s+/g, " ").trim();
    const zipM = blob.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/i);
    if (zipM) {
      const state = zipM[1];
      const zip = zipM[2];
      const before = blob.slice(0, zipM.index).trim();
      const commaParts = before.split(",").map((s) => s.trim());
      if (commaParts.length >= 2) {
        const city = commaParts[commaParts.length - 2];
        const line1 = commaParts.slice(0, -2).join(", ") || commaParts[0];
        snap.currentAddresses.push({
          line1: line1.slice(0, 120),
          city,
          state,
          zip,
        });
      }
    }
  }

  return snap;
}
