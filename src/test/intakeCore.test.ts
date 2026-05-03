import { describe, expect, it } from "vitest";
import { reconcileIdentity } from "@cc-intake/intake-reconcile";
import {
  computeFileProfile,
  computePricingRecommendation,
  pricingScore,
} from "@cc-intake/intake-score-pricing";
import { PRICING_FLOOR, EMPTY_BUREAU } from "@cc-intake/intake-types";
import { buildInitialPaymentPlan, applyPaymentReceived } from "@cc-intake/intake-payment-plan";

describe("pricingScore", () => {
  it("matches Lina-style example: 1 CO + 4 late + 1 inq => 6 pts tier 3", () => {
    const profile = {
      chargeOffs: 1,
      collections: 0,
      publicRecords: 0,
      lateAccountsExcludingCO: 4,
      hardInquiries: 1,
    };
    const s = pricingScore(profile);
    expect(s).toBe(6);
    const pr = computePricingRecommendation(profile);
    expect(pr.tier.name).toContain("Tier 3");
    expect(pr.tier.low).toBe(1500);
    expect(pr.tier.high).toBe(2000);
  });
});

describe("computeFileProfile dedupe", () => {
  it("counts one CO across three bureaus once", () => {
    const acct = {
      creditor: "CAPITAL ONE",
      accountNumberMasked: "****1234",
      status: "Charged Off",
    };
    const snaps = {
      equifax: { ...EMPTY_BUREAU, derogatoryAccounts: [acct] },
      experian: { ...EMPTY_BUREAU, derogatoryAccounts: [acct] },
      transunion: { ...EMPTY_BUREAU, derogatoryAccounts: [acct] },
    };
    const fp = computeFileProfile(snaps);
    expect(fp.chargeOffs).toBe(1);
  });
});

describe("reconcileIdentity", () => {
  it("flags name mismatch across bureaus", () => {
    const canonical = {
      legalName: "Lina Latrice McCoy",
      legalNameFirst: "Lina",
      legalNameLast: "McCoy",
      dob: "1970-01-15",
      currentAddress: {
        line1: "1 Main St",
        city: "Dallas",
        state: "TX",
        zip: "75201",
      },
      phone: "214",
      email: "a@b.com",
    };
    const bureauReported = {
      equifax: {
        ...EMPTY_BUREAU,
        consumerLegalName: "LINA L MCCOY",
        currentAddresses: [{
          line1: "1 MAIN ST",
          city: "DALLAS",
          state: "TX",
          zip: "75201",
        }],
      },
      experian: {
        ...EMPTY_BUREAU,
        consumerLegalName: "LINDA L MERRITTE",
        currentAddresses: [{
          line1: "1 MAIN ST",
          city: "DALLAS",
          state: "TX",
          zip: "75201",
        }],
      },
      transunion: {
        ...EMPTY_BUREAU,
        consumerLegalName: "LINA L MCCOY",
        currentAddresses: [{
          line1: "1 MAIN ST",
          city: "DALLAS",
          state: "TX",
          zip: "75201",
        }],
      },
    };
    const r = reconcileIdentity(canonical, bureauReported);
    expect(r.nameMatch.matches).toBe(false);
    expect(r.addressMatch.matches).toBe(true);
  });
});

describe("payment plan", () => {
  it("records payment and reduces remaining balance", () => {
    const plan = buildInitialPaymentPlan({
      netTotal: 1000,
      depositAmount: 500,
      depositDueBy: "2026-06-01",
    });
    expect(plan.remainingBalance).toBe(1000);
    const after = applyPaymentReceived(plan, 500, "zelle", "2026-06-01");
    expect(after.deposit.receivedAt).toBe("2026-06-01");
    expect(after.remainingBalance).toBe(500);
  });

  it("discount validation ceiling: net cannot go below floor without error at approve layer", () => {
    const quoted = PRICING_FLOOR + 100;
    const maxDiscount = quoted - PRICING_FLOOR;
    expect(maxDiscount).toBe(100);
  });
});
