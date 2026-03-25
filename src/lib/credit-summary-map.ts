import type { CanonicalAnalyzerResult } from "@/types/disputes";
import type { CreditSummaryData } from "@/components/CreditSummary";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickScore(meta: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!meta) return undefined;
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "number" && v > 0) return v;
  }
  return undefined;
}

function pickDate(meta: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!meta) return undefined;
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

function toAccount(item: Record<string, unknown>, source?: string) {
  return {
    creditor_name: String(item.creditor_name ?? item.creditor ?? item.name ?? "Unknown"),
    account_number: item.account_number != null ? String(item.account_number) : undefined,
    date_opened: item.date_opened != null ? String(item.date_opened) : undefined,
    balance: item.balance != null ? String(item.balance) : undefined,
    past_due: item.past_due != null ? String(item.past_due) : undefined,
    derogatory_triggers: Array.isArray(item.derogatory_triggers)
      ? (item.derogatory_triggers as string[])
      : undefined,
    status: item.status != null ? String(item.status) : undefined,
    source,
  };
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

export function buildCreditSummaryData(
  canonical: CanonicalAnalyzerResult | null | undefined,
  fullLegalName: string,
  currentAddress: string
): CreditSummaryData {
  if (!canonical) {
    return {
      fullLegalName,
      currentAddress,
      inaccurateNames: [],
      inaccurateAddresses: [],
      derogatoryAccounts: [],
      collections: [],
      chargeOffs: [],
      inquiries: [],
      publicRecords: [],
    };
  }

  const meta = canonical.report_metadata as Record<string, unknown> | undefined;

  // Try to extract per-bureau scores from report_metadata
  const scores = {
    experian: pickScore(meta, "experian_score", "experian_credit_score"),
    transunion: pickScore(meta, "transunion_score", "tu_score", "transunion_credit_score"),
    equifax: pickScore(meta, "equifax_score", "equifax_credit_score"),
  };

  const reportDates = {
    experian: pickDate(meta, "experian_report_date", "experian_date"),
    transunion: pickDate(meta, "transunion_report_date", "tu_report_date"),
    equifax: pickDate(meta, "equifax_report_date"),
  };

  const hasScores = Object.values(scores).some(Boolean);
  const hasReportDates = Object.values(reportDates).some(Boolean);

  return {
    fullLegalName,
    currentAddress,
    scores: hasScores ? scores : undefined,
    reportDates: hasReportDates ? reportDates : undefined,

    inaccurateNames: (canonical.inaccurate_names ?? []).map((n: Record<string, unknown>) => ({
      reported_name: String(n.reported_name ?? n.name ?? ""),
      mismatch_reason: String(n.mismatch_reason ?? n.reason ?? ""),
      source: n.source != null ? String(n.source) : undefined,
    })),

    inaccurateAddresses: (canonical.inaccurate_addresses ?? []).map((a: Record<string, unknown>) => ({
      reported_address: String(a.reported_address ?? a.address ?? ""),
      linked_to_derogatory: Boolean(a.linked_to_derogatory),
      source: a.source != null ? String(a.source) : undefined,
    })),

    derogatoryAccounts: (canonical.derogatory_accounts ?? []).map((a: Record<string, unknown>) =>
      toAccount(a, a.source != null ? String(a.source) : undefined)
    ),

    collections: (canonical.collections ?? []).map((a: Record<string, unknown>) =>
      toAccount(a, a.source != null ? String(a.source) : undefined)
    ),

    chargeOffs: (canonical.charge_offs ?? []).map((a: Record<string, unknown>) =>
      toAccount(a, a.source != null ? String(a.source) : undefined)
    ),

    inquiries: (canonical.inquiries ?? []).map((i: Record<string, unknown>) => ({
      creditor_name: String(i.creditor_name ?? i.creditor ?? i.name ?? "Unknown"),
      date: String(i.date ?? i.inquiry_date ?? ""),
      type: String(i.type ?? i.inquiry_type ?? "hard"),
      source: i.source != null ? String(i.source) : undefined,
    })),

    publicRecords: (canonical.public_records ?? []).map((p: Record<string, unknown>) => ({
      type: String(p.type ?? p.record_type ?? ""),
      filing_date: String(p.filing_date ?? p.date ?? ""),
      status: String(p.status ?? ""),
      source: p.source != null ? String(p.source) : undefined,
    })),
  };
}
