import { describe, it, expect } from "vitest";
import type { DisputeAccount } from "@/types/disputes";
import { isAccountIncluded } from "@/types/disputes";

// ─── Test fixtures ───

function makeAccount(overrides: Partial<DisputeAccount> = {}): DisputeAccount {
  return {
    id: "test-id-default",
    maskedAccountNumber: "XXXX-1234",
    creditorName: "Test Creditor",
    bureauStatuses: {},
    isSelected: true,
    confidence: 0.9,
    triageState: "included",
    ...overrides,
  };
}

function buildGeneratorPayload(accounts: DisputeAccount[]) {
  const selected = accounts.filter(a => a.isSelected);
  // Defense-in-depth: excluded items must not leak even if isSelected is wrong
  const safe = selected.filter(a => !a.triageState || a.triageState === "included");
  return {
    selectedAccounts: safe.map(a => ({
      creditorName: a.creditorName,
      maskedAccountNumber: a.maskedAccountNumber,
      disputeReason: a.disputeReason,
      customReason: a.customReason,
    })),
    derogatoryAccounts: safe.map(a => ({
      creditor_name: a.creditorName,
      account_number: a.maskedAccountNumber,
      date_opened: a.dateOpened || "Unknown",
      derogatory_triggers: [a.disputeReason || "Disputed item"],
    })),
  };
}

// ─── Tests ───

describe("Triage Layer — backward compatibility", () => {
  it("legacy account without triageState is treated as included", () => {
    const legacy = makeAccount({ triageState: undefined as any });
    expect(isAccountIncluded(legacy)).toBe(true);
  });

  it("legacy account with null triageState is treated as included", () => {
    const legacy = makeAccount({ triageState: null as any });
    expect(isAccountIncluded(legacy)).toBe(true);
  });

  it("account with triageState='included' is included", () => {
    expect(isAccountIncluded(makeAccount({ triageState: "included" }))).toBe(true);
  });

  it("old jobs produce identical payload shape", () => {
    const accounts = [
      makeAccount({ id: "test-1", creditorName: "Bank A", isSelected: true }),
      makeAccount({ id: "test-2", creditorName: "Bank B", isSelected: false }),
    ];
    const payload = buildGeneratorPayload(accounts);
    expect(payload.selectedAccounts).toHaveLength(1);
    expect(payload.selectedAccounts[0].creditorName).toBe("Bank A");
  });
});

describe("Triage Layer — exclusion filtering", () => {
  it("excluded items never appear in generator payload", () => {
    const accounts = [
      makeAccount({ id: "test-1", creditorName: "Included", triageState: "included", isSelected: true }),
      makeAccount({ id: "test-2", creditorName: "Excluded", triageState: "excluded", isSelected: false }),
    ];
    const payload = buildGeneratorPayload(accounts);
    expect(payload.selectedAccounts).toHaveLength(1);
    expect(payload.selectedAccounts[0].creditorName).toBe("Included");
    expect(payload.derogatoryAccounts.every(a => a.creditor_name !== "Excluded")).toBe(true);
  });

  it("excluded item with isSelected=true still filtered (defense in depth)", () => {
    const accounts = [
      makeAccount({ id: "test-1", creditorName: "Sneaky", triageState: "excluded", isSelected: true }),
    ];
    const payload = buildGeneratorPayload(accounts);
    expect(payload.selectedAccounts).toHaveLength(0);
  });

  it("pending items do not appear unless explicitly included", () => {
    const accounts = [
      makeAccount({ id: "test-1", creditorName: "Pending", triageState: "pending", isSelected: false, confidence: 0.5 }),
    ];
    const payload = buildGeneratorPayload(accounts);
    expect(payload.selectedAccounts).toHaveLength(0);
  });

  it("pending item promoted to included appears in payload", () => {
    const accounts = [
      makeAccount({ id: "test-1", creditorName: "Promoted", triageState: "included", isSelected: true, confidence: 0.5 }),
    ];
    const payload = buildGeneratorPayload(accounts);
    expect(payload.selectedAccounts).toHaveLength(1);
  });
});

describe("Triage Layer — edge cases", () => {
  it("all items excluded + no manual claims = warning condition", () => {
    const accounts = [
      makeAccount({ id: "test-1", triageState: "excluded", isSelected: false }),
      makeAccount({ id: "test-2", triageState: "excluded", isSelected: false }),
    ];
    const payload = buildGeneratorPayload(accounts);
    const hasManualClaims = false;
    const shouldWarn = accounts.length > 0 && payload.selectedAccounts.length === 0 && !hasManualClaims;
    expect(shouldWarn).toBe(true);
  });

  it("generator payload snapshot is stable (no triage fields leak)", () => {
    const account = makeAccount({
      id: "test-1",
      triageState: "included",
      excludeReason: "should not appear",
      reviewedAt: "2026-01-01T00:00:00Z",
    });
    const payload = buildGeneratorPayload([account]);
    const keys = Object.keys(payload.selectedAccounts[0]);
    expect(keys).toEqual(["creditorName", "maskedAccountNumber", "disputeReason", "customReason"]);
    expect(payload.selectedAccounts[0]).not.toHaveProperty("triageState");
    expect(payload.selectedAccounts[0]).not.toHaveProperty("excludeReason");
  });
});

describe("Triage E2E flow (unit-simulated)", () => {
  it("full flow: import → exclude → include pending → generate", () => {
    // 1. Simulate analyzer output with mixed confidence
    const analyzerAccounts: DisputeAccount[] = [
      makeAccount({ id: "test-1", creditorName: "High Conf", confidence: 0.95, triageState: "included", isSelected: true }),
      makeAccount({ id: "test-2", creditorName: "Medium Conf", confidence: 0.55, triageState: "pending", isSelected: false }),
      makeAccount({ id: "test-3", creditorName: "Good Standing", confidence: 0.9, triageState: "included", isSelected: true }),
    ];

    // 2. User excludes "Good Standing" (never late, not disputable)
    analyzerAccounts[2] = {
      ...analyzerAccounts[2],
      triageState: "excluded",
      isSelected: false,
      excludeReason: "Account is current, never late",
    };

    // 3. User promotes "Medium Conf" to included
    analyzerAccounts[1] = {
      ...analyzerAccounts[1],
      triageState: "included",
      isSelected: true,
    };

    // 4. Generate
    const payload = buildGeneratorPayload(analyzerAccounts);

    // 5. Verify
    expect(payload.selectedAccounts).toHaveLength(2);
    expect(payload.selectedAccounts.map(a => a.creditorName)).toEqual(["High Conf", "Medium Conf"]);
    expect(payload.selectedAccounts.find(a => a.creditorName === "Good Standing")).toBeUndefined();
    expect(payload.derogatoryAccounts).toHaveLength(2);
  });
});
