import type { BureauSnapshot } from "./intake-types.ts";

export type Tier = { name: string; low: number; high: number };

export const TIERS: Array<{ min: number; max: number; tier: Tier }> = [
  { min: 0, max: 2, tier: { name: "Tier 1 — Light", low: 750, high: 1000 } },
  { min: 3, max: 5, tier: { name: "Tier 2 — Moderate", low: 1000, high: 1500 } },
  { min: 6, max: 9, tier: { name: "Tier 3 — Significant", low: 1500, high: 2000 } },
  { min: 10, max: Infinity, tier: { name: "Tier 4 — Heavy", low: 2000, high: 2500 } },
];

function isChargeOffStatus(status: string): boolean {
  const u = status.toUpperCase();
  return (u.includes("CHARGE") && u.includes("OFF")) || u.includes("CHARGEOFF");
}

function isCollectionStatus(status: string, creditor: string): boolean {
  const u = status.toUpperCase();
  const c = creditor.toUpperCase();
  return u.includes("COLLECTION") || u.includes("COLLECT") || c.includes("COLLECTION");
}

function accountKey(creditor: string, masked?: string): string {
  const c = creditor.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
  const tail = (masked || "").replace(/\D/g, "").slice(-4);
  return `${c}|${tail}`;
}

function hasLateIndicator(acct: {
  status?: string;
  paymentHistory?: string;
  pastDue?: string;
}): boolean {
  const st = (acct.status || "").toUpperCase();
  if (st.includes("LATE") || st.includes("DELINQ") || st.includes("PAST DUE")) return true;
  const pd = (acct.pastDue || "").replace(/[$,]/g, "");
  if (pd && parseFloat(pd) > 0) return true;
  const ph = acct.paymentHistory || "";
  const u = ph.toUpperCase();
  if (u.includes("UNKNOWN")) return false;
  if (/\b(30|60|90|120|150|180)\b/.test(ph)) return true;
  return false;
}

/**
 * Rubric counts deduped across bureaus (same trade line keyed by creditor + account tail)
 * so one CO reported on three bureaus counts once — matches operator worked examples.
 */
export function computeFileProfile(snapshots: {
  equifax: BureauSnapshot;
  experian: BureauSnapshot;
  transunion: BureauSnapshot;
}): {
  chargeOffs: number;
  collections: number;
  publicRecords: number;
  lateAccountsExcludingCO: number;
  hardInquiries: number;
} {
  const bureaus = [snapshots.equifax, snapshots.experian, snapshots.transunion];
  const coKeys = new Set<string>();
  const colKeys = new Set<string>();
  const lateKeys = new Set<string>();

  for (const snap of bureaus) {
    for (const acct of snap.derogatoryAccounts || []) {
      const st = acct.status || "";
      const cr = acct.creditor || "";
      const key = accountKey(cr, acct.accountNumberMasked);
      if (isChargeOffStatus(st)) {
        coKeys.add(key);
        continue;
      }
      if (isCollectionStatus(st, cr)) {
        colKeys.add(key);
        continue;
      }
      if (hasLateIndicator(acct)) lateKeys.add(key);
    }
  }

  for (const k of coKeys) lateKeys.delete(k);
  for (const k of colKeys) lateKeys.delete(k);

  let publicRecords = 0;
  const prKeys = new Set<string>();
  for (const snap of bureaus) {
    let i = 0;
    for (const pr of snap.publicRecords || []) {
      const sig = `${(pr.type || "").toUpperCase()}|${(pr.date || "").trim()}|${i++}`;
      prKeys.add(sig);
    }
  }
  publicRecords = prKeys.size;

  const inqKeys = new Set<string>();
  for (const snap of bureaus) {
    for (const iq of snap.inquiries || []) {
      const t = (iq.type || "").toLowerCase();
      if (t.includes("soft")) continue;
      const sig = `${(iq.name || "").toUpperCase()}|${(iq.date || "").trim()}`;
      inqKeys.add(sig);
    }
  }

  return {
    chargeOffs: coKeys.size,
    collections: colKeys.size,
    publicRecords,
    lateAccountsExcludingCO: lateKeys.size,
    hardInquiries: inqKeys.size,
  };
}

export function pricingScore(profile: {
  chargeOffs: number;
  collections: number;
  publicRecords: number;
  lateAccountsExcludingCO: number;
  hardInquiries: number;
}): number {
  const inqPart = Math.max(0, profile.hardInquiries - 3) * 0.25;
  return (
    profile.chargeOffs * 2 +
    profile.collections * 2 +
    profile.publicRecords * 3 +
    profile.lateAccountsExcludingCO * 1 +
    inqPart
  );
}

export function tierForScore(score: number): Tier {
  const s = Math.floor(score);
  for (const row of TIERS) {
    if (s >= row.min && s <= row.max) return row.tier;
  }
  return TIERS[TIERS.length - 1].tier;
}

export function computePricingRecommendation(profile: {
  chargeOffs: number;
  collections: number;
  publicRecords: number;
  lateAccountsExcludingCO: number;
  hardInquiries: number;
}): { score: number; tier: Tier } {
  const score = pricingScore(profile);
  return { score, tier: tierForScore(score) };
}
