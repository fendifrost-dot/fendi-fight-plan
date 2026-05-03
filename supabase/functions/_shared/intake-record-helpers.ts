import type { IntakeClientRecord, IntakeStatus } from "./intake-types.ts";
import { EMPTY_BUREAU } from "./intake-types.ts";
import { reconcileIdentity } from "./intake-reconcile.ts";
import { computeFileProfile, computePricingRecommendation } from "./intake-score-pricing.ts";

export function emptyBureauReportedPulled(): IntakeClientRecord["bureauReported"] {
  const iso = new Date().toISOString();
  return {
    equifax: { ...EMPTY_BUREAU },
    experian: { ...EMPTY_BUREAU },
    transunion: { ...EMPTY_BUREAU },
    pulledAt: { equifax: iso, experian: iso, transunion: iso },
  };
}

export function mergeRecordJson(
  base: IntakeClientRecord,
  patch: Partial<IntakeClientRecord>,
): IntakeClientRecord {
  return { ...base, ...patch };
}

export function recomputeDerivedFields(rec: IntakeClientRecord): IntakeClientRecord {
  const identityReconciliation = reconcileIdentity(rec.canonical, rec.bureauReported);
  const fileProfile = computeFileProfile(rec.bureauReported);
  const pricingRecommendation = computePricingRecommendation(fileProfile);
  return {
    ...rec,
    identityReconciliation,
    fileProfile,
    pricingRecommendation,
  };
}

export function assertStatus(rec: IntakeClientRecord, allowed: IntakeStatus[]): void {
  if (!allowed.includes(rec.status)) {
    throw new Error(`Invalid status for this action: ${rec.status}`);
  }
}
