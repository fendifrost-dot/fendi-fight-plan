/**
 * GenerateRequirementsPanel - Displays visible "Why disabled?" checklist
 * Uses the SAME validator (getGenerateBlockers) as the Generate button logic.
 * This is the UI rendering component, NOT the logic source.
 */

import { CheckCircle2, XCircle, AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DisputeSession } from "@/types/disputes";
import { getGenerateBlockers, type Blocker } from "@/lib/dispute-gating";

interface GenerateRequirementsPanelProps {
  session: DisputeSession;
  isGenerating: boolean;
  onSwitchToManual?: () => void;
}

export function GenerateRequirementsPanel({
  session,
  isGenerating,
  onSwitchToManual,
}: GenerateRequirementsPanelProps) {
  const blockers = getGenerateBlockers(session, isGenerating);
  const canGenerate = blockers.length === 0;

  // Build checklist items from session state
  const checklistItems: { label: string; ok: boolean; value: string }[] = [
    {
      label: "Mode",
      ok: true, // Mode itself is never a blocker
      value: session.mode === "AI" ? "AI-Assisted" : "Manual",
    },
    {
      label: "Analysis Status",
      ok: session.mode === "MANUAL" || session.analysisStatus === "DONE" || session.analysisStatus === "SKIPPED",
      value: session.analysisStatus === "DONE" ? "Complete" 
        : session.analysisStatus === "IN_PROGRESS" ? "Running..."
        : session.analysisStatus === "FAILED" ? "Failed"
        : session.analysisStatus === "SKIPPED" ? "Skipped"
        : "Not Started",
    },
    {
      label: "Full Name",
      ok: (session.consumerInfo.fullName?.trim().length || 0) > 0,
      value: (session.consumerInfo.fullName?.trim().length || 0) > 0 
        ? `${session.consumerInfo.fullName?.trim().length} chars` 
        : "Not entered",
    },
    {
      label: "Street Address",
      ok: (session.consumerInfo.addressLine1?.trim().length || 0) > 0,
      value: (session.consumerInfo.addressLine1?.trim().length || 0) > 0 ? "Entered" : "Not entered",
    },
    {
      label: "City/State/ZIP",
      ok: (session.consumerInfo.cityStateZip?.trim().length || 0) > 0,
      value: (session.consumerInfo.cityStateZip?.trim().length || 0) > 0 ? "Entered" : "Not entered",
    },
    {
      label: "Bureaus Selected",
      ok: session.selectedBureaus.length > 0,
      value: `${session.selectedBureaus.length} selected`,
    },
  ];

  // Input source status
  const hasSelectedAccounts = session.accounts.some(a => a.isSelected);
  const hasManualClaims = (session.manualClaimsText?.trim().length || 0) > 0;
  const hasValidDocs = session.documents.some(d => !d.needsReupload);

  if (session.mode === "AI") {
    checklistItems.push({
      label: "Accounts Selected",
      ok: hasSelectedAccounts || hasManualClaims || hasValidDocs,
      value: hasSelectedAccounts 
        ? `${session.accounts.filter(a => a.isSelected).length} selected`
        : hasManualClaims ? "Manual claims" : hasValidDocs ? "Docs available" : "None",
    });
  } else {
    // Manual mode
    checklistItems.push({
      label: "Dispute Input",
      ok: hasSelectedAccounts || hasManualClaims,
      value: hasSelectedAccounts 
        ? `${session.accounts.filter(a => a.isSelected).length} accounts`
        : hasManualClaims ? "Manual claims text" : "None provided",
    });
  }

  // Stale docs warning
  const staleDocsCount = session.documents.filter(d => d.needsReupload).length;
  if (staleDocsCount > 0) {
    checklistItems.push({
      label: "Stale Files",
      ok: hasSelectedAccounts || hasManualClaims, // Not a blocker if other input exists
      value: `${staleDocsCount} need re-upload`,
    });
  }

  checklistItems.push({
    label: "Generation",
    ok: !isGenerating,
    value: isGenerating ? "In progress..." : "Ready",
  });

  // Check if we should show the "Switch to Manual" button
  const showSwitchToManual = 
    session.mode === "AI" && 
    !canGenerate && 
    blockers.some(b => b.key === "analysis_incomplete" || b.key === "analysis_running");

  return (
    <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <AlertCircle className="w-4 h-4" />
        Generation Requirements
      </div>
      
      <div className="grid grid-cols-2 gap-2 text-xs">
        {checklistItems.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            {item.ok ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            <span className={item.ok ? "text-muted-foreground" : "text-foreground"}>
              {item.label}:
            </span>
            <span className={item.ok ? "text-green-400" : "text-red-400"}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
      
      {/* Show blockers */}
      {!canGenerate && blockers.length > 0 && (
        <div className="mt-2 space-y-2">
          {blockers.slice(0, 3).map((blocker, idx) => (
            <div 
              key={blocker.key}
              className={`text-sm rounded-md p-2 ${
                idx === 0 
                  ? "text-amber-400 bg-amber-500/10 border border-amber-500/30" 
                  : "text-muted-foreground bg-muted/20 border border-border"
              }`}
            >
              {idx === 0 ? "⚠️ " : "• "}{blocker.message}
            </div>
          ))}
          {blockers.length > 3 && (
            <div className="text-xs text-muted-foreground">
              +{blockers.length - 3} more issue(s)
            </div>
          )}
        </div>
      )}

      {/* Switch to Manual button */}
      {showSwitchToManual && onSwitchToManual && (
        <Button
          variant="outline"
          size="sm"
          onClick={onSwitchToManual}
          className="w-full mt-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
        >
          <ArrowRight className="w-4 h-4 mr-2" />
          Switch to Manual Mode (generate now)
        </Button>
      )}
      
      {canGenerate && (
        <div className="mt-2 text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-md p-2">
          ✓ All requirements met. Ready to generate.
        </div>
      )}
    </div>
  );
}
