/**
 * Single-source-of-truth gating system for Dispute Engine generation.
 * ALL generation eligibility is computed from ONE validator function.
 * 
 * CRITICAL: No other booleans (canShowSurvey, isAnalyzed, analysisSkipped, etc.)
 * may gate UI. Only getGenerateBlockers determines eligibility.
 */

import type { DisputeSession, AnalysisStatus, DisputeMode } from "@/types/disputes";

export interface Blocker {
  key: string;
  message: string;
}

/**
 * Returns all blockers preventing letter generation.
 * If empty, generation is allowed.
 * 
 * This is THE ONLY function that determines generation eligibility.
 */
export function getGenerateBlockers(session: DisputeSession, isGenerating: boolean = false): Blocker[] {
  const blockers: Blocker[] = [];

  // 0. Currently generating
  if (isGenerating) {
    blockers.push({
      key: "generating",
      message: "Generation in progress. Please wait.",
    });
    return blockers; // Early return - no point checking other conditions
  }

  // 0b. Analysis job running - must wait or switch to manual
  if (session.activeJobId && session.analysisStatus === "IN_PROGRESS") {
    blockers.push({
      key: "analysis_running",
      message: "Analysis is running. Wait for completion or switch to Manual mode.",
    });
    // Don't early return - still check other requirements so user sees full list
  }

  // 1. Require at least 1 bureau selected
  if (session.selectedBureaus.length === 0) {
    blockers.push({
      key: "no_bureaus",
      message: "Select at least one bureau to generate a letter.",
    });
  }

  // 2. Require consumer full name
  const fullName = session.consumerInfo.fullName?.trim() || "";
  if (fullName.length === 0) {
    blockers.push({
      key: "no_name",
      message: "Enter your full legal name.",
    });
  }

  // 3. Require complete mailing address (street + city/state/zip)
  const addressLine1 = session.consumerInfo.addressLine1?.trim() || "";
  const cityStateZip = session.consumerInfo.cityStateZip?.trim() || "";
  
  if (addressLine1.length === 0) {
    blockers.push({
      key: "no_street",
      message: "Enter your street address.",
    });
  }
  
  if (cityStateZip.length === 0) {
    blockers.push({
      key: "no_city_state_zip",
      message: "Enter your city, state, and ZIP code.",
    });
  }

  // 4. Mode-specific requirements
  const hasSelectedAccounts = session.accounts.some(a => a.isSelected);
  const hasManualClaimsText = (session.manualClaimsText?.trim().length || 0) > 0;
  const hasValidDocs = session.documents.some(d => !d.needsReupload);
  const hasStaleDocsOnly = session.documents.length > 0 && session.documents.every(d => d.needsReupload);

  if (session.mode === "AI") {
    // AI Mode requirements
    // Skip this check if we already added the analysis_running blocker
    if (session.analysisStatus === "IN_PROGRESS" && !session.activeJobId) {
      blockers.push({
        key: "analysis_running",
        message: "Analysis is running. Wait for completion or switch to Manual mode.",
      });
    } else if (session.analysisStatus === "FAILED" || session.analysisStatus === "NOT_STARTED") {
      // Only block if there's no alternative input source
      if (!hasSelectedAccounts && !hasManualClaimsText && !hasValidDocs) {
        blockers.push({
          key: "analysis_incomplete",
          message: session.analysisStatus === "FAILED" 
            ? "Analysis failed. Switch to Manual mode or retry analysis."
            : "Run analysis first, or switch to Manual mode to proceed now.",
        });
      }
    }
    
    // AI mode requires at least one input source: accounts OR docs OR manual text
    if (!hasSelectedAccounts && !hasValidDocs && !hasManualClaimsText) {
      if (session.analysisStatus === "DONE") {
        blockers.push({
          key: "no_accounts_selected",
          message: "Select at least one account to dispute, or add manual dispute details.",
        });
      }
    }
  } else {
    // MANUAL mode requirements
    // Require selectedAccountIds OR manualClaimsText (docs optional)
    if (!hasSelectedAccounts && !hasManualClaimsText) {
      blockers.push({
        key: "no_manual_input",
        message: "Add dispute details: select accounts or enter manual claims text.",
      });
    }
  }

  // 5. Stale file handling
  // Only block if stale docs are the ONLY input source (no accounts, no manual text)
  if (hasStaleDocsOnly && !hasSelectedAccounts && !hasManualClaimsText) {
    blockers.push({
      key: "stale_files",
      message: "Some files need re-upload after page refresh. Re-upload them or add manual claims text.",
    });
  }

  return blockers;
}

/**
 * Simple boolean check if generation is allowed.
 * Uses getGenerateBlockers internally.
 */
export function canGenerate(session: DisputeSession, isGenerating: boolean = false): boolean {
  return getGenerateBlockers(session, isGenerating).length === 0;
}

/**
 * Get the first blocker message for display, or null if none.
 */
export function getFirstBlockerMessage(session: DisputeSession, isGenerating: boolean = false): string | null {
  const blockers = getGenerateBlockers(session, isGenerating);
  return blockers.length > 0 ? blockers[0].message : null;
}

/**
 * Check if user can analyze (separate from generate).
 * Analysis requires: documents OR bureauResponseText, not currently analyzing.
 */
export function canAnalyze(session: DisputeSession): { allowed: boolean; reason?: string } {
  if (session.analysisStatus === "IN_PROGRESS" || session.activeJobId) {
    return { allowed: false, reason: "Analysis already in progress." };
  }
  
  if (session.analysisStatus === "DONE") {
    return { allowed: false, reason: "Analysis complete. Reset to analyze again." };
  }
  
  const hasBureauResponse = session.documents.some(d => 
    d.type === 'bureau_response' && d.file instanceof File
  );
  const hasBureauText = session.bureauResponseText.trim().length > 0;
  
  if (!hasBureauResponse && !hasBureauText) {
    return { 
      allowed: false, 
      reason: "Upload a Bureau Response document or paste response text." 
    };
  }
  
  return { allowed: true };
}

/**
 * Debug info object for logging on generate attempts.
 */
export function getGenerateDebugInfo(session: DisputeSession, isGenerating: boolean = false) {
  const blockers = getGenerateBlockers(session, isGenerating);
  return {
    mode: session.mode,
    analysisStatus: session.analysisStatus,
    activeJobId: session.activeJobId,
    latestAnalyzerResultId: session.latestAnalyzerResultId,
    hasName: (session.consumerInfo.fullName?.trim().length || 0) > 0,
    hasStreet: (session.consumerInfo.addressLine1?.trim().length || 0) > 0,
    hasCityStateZip: (session.consumerInfo.cityStateZip?.trim().length || 0) > 0,
    bureauCount: session.selectedBureaus.length,
    selectedAccountCount: session.accounts.filter(a => a.isSelected).length,
    hasManualClaimsText: (session.manualClaimsText?.trim().length || 0) > 0,
    docsCount: session.documents.length,
    staleDocsCount: session.documents.filter(d => d.needsReupload).length,
    validDocsCount: session.documents.filter(d => !d.needsReupload).length,
    isGenerating,
    canGenerate: blockers.length === 0,
    blockerCount: blockers.length,
    blockers: blockers.map(b => b.key),
  };
}

/**
 * Check if session has any active job that should resume on mount.
 */
export function shouldResumeJob(session: DisputeSession): boolean {
  return Boolean(session.activeJobId && session.analysisStatus === "IN_PROGRESS");
}
