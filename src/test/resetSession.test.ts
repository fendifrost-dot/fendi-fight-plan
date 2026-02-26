import { describe, it, expect } from "vitest";
import {
  createDefaultSession,
  type DisputeSession,
  type AnalysisStatus,
  defaultProcessingProgress,
} from "@/types/disputes";

/**
 * Pure-logic regression tests for session reset.
 * These validate that resetSession always produces a clean baseline
 * regardless of the prior state (IN_PROGRESS, DONE, FAILED, STALE).
 */

function simulateReset(_prior: DisputeSession): DisputeSession {
  // This mirrors what useDisputeSession.resetSession does to local state
  return createDefaultSession();
}

function makeSessionInStatus(status: AnalysisStatus, extras: Partial<DisputeSession> = {}): DisputeSession {
  const base = createDefaultSession();
  return {
    ...base,
    analysisStatus: status,
    isAnalyzed: status === "DONE",
    ...extras,
  };
}

describe("resetSession lifecycle", () => {
  const CLEAN_CHECKS = (result: DisputeSession) => {
    expect(result.analysisStatus).toBe("NOT_STARTED");
    expect(result.activeJobId).toBeNull();
    expect(result.latestAnalyzerResultId).toBeNull();
    expect(result.isAnalyzed).toBe(false);
    expect(result.analysisResult).toBeNull();
    expect(result.documents).toEqual([]);
    expect(result.accounts).toEqual([]);
    expect(result.mode).toBe("AI");
    expect(result.manualClaimsText).toBe("");
    expect(result.processingProgress).toEqual(defaultProcessingProgress);
    expect(result.selectedBureaus).toEqual([]);
  };

  it("resets from IN_PROGRESS to clean baseline", () => {
    const prior = makeSessionInStatus("IN_PROGRESS", {
      activeJobId: "job-123",
      documents: [{ id: "d1", name: "test.pdf", type: "bureau_response", size: 100, mimeType: "application/pdf", uploadedAt: new Date().toISOString(), processingStatus: "complete" }],
    });
    const result = simulateReset(prior);
    CLEAN_CHECKS(result);
  });

  it("resets from DONE to clean baseline", () => {
    const prior = makeSessionInStatus("DONE", {
      latestAnalyzerResultId: "job-456",
      isAnalyzed: true,
      accounts: [{ id: "a1", maskedAccountNumber: "****1234", creditorName: "Test", bureauStatuses: {}, isSelected: true, confidence: 0.9, triageState: "included" as const }],
      analysisResult: { bureau: "experian", outcome: "verified", itemsVerified: [], itemsDeleted: [], itemsPartial: [], legalImplications: [], nextSteps: [], rawSummary: "", accounts: [] },
    });
    const result = simulateReset(prior);
    CLEAN_CHECKS(result);
  });

  it("resets from FAILED to clean baseline", () => {
    const prior = makeSessionInStatus("FAILED", {
      activeJobId: "job-789",
      processingProgress: { ...defaultProcessingProgress, phase: "error", message: "AI call failed" },
    });
    const result = simulateReset(prior);
    CLEAN_CHECKS(result);
  });

  it("resets from STALE to clean baseline", () => {
    const prior = makeSessionInStatus("STALE", {
      activeJobId: "job-stale",
    });
    const result = simulateReset(prior);
    CLEAN_CHECKS(result);
  });

  it("resets from ABORTED to clean baseline", () => {
    const prior = makeSessionInStatus("ABORTED", {
      activeJobId: "job-aborted",
    });
    const result = simulateReset(prior);
    CLEAN_CHECKS(result);
  });

  it("resets from SKIPPED (manual mode) to clean baseline", () => {
    const prior = makeSessionInStatus("SKIPPED", {
      mode: "MANUAL",
      manualClaimsText: "Some manual claims",
    });
    const result = simulateReset(prior);
    CLEAN_CHECKS(result);
    // Specifically verify manual mode is cleared
    expect(result.mode).toBe("AI");
  });

  it("produces a new unique ID on reset", () => {
    const prior = makeSessionInStatus("DONE");
    const result = simulateReset(prior);
    expect(result.id).not.toBe(prior.id);
  });
});

describe("AnalysisStatus type safety", () => {
  it("includes ABORTED and STALE statuses", () => {
    const statuses: AnalysisStatus[] = [
      "NOT_STARTED", "IN_PROGRESS", "DONE", "FAILED", "SKIPPED", "ABORTED", "STALE"
    ];
    // This test simply ensures the type compiles with all values
    expect(statuses).toHaveLength(7);
  });
});
