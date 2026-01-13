import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import type { DisputeSession, DisputeMode, BureauKey } from "@/types/disputes";

export interface GenerateRequirements {
  hasName: boolean;
  hasBureaus: boolean;
  hasSelectedAccounts: boolean;
  isAnalyzed: boolean;
  mode: DisputeMode;
  isGenerating: boolean;
  bureauCount: number;
  nameLength: number;
  selectedAccountCount: number;
}

interface GenerateRequirementsPanelProps {
  requirements: GenerateRequirements;
  canGenerate: boolean;
}

export function computeGenerateRequirements(
  state: DisputeSession,
  isGenerating: boolean
): GenerateRequirements {
  const hasName = (state.consumerInfo.fullName?.trim().length || 0) > 0;
  const hasBureaus = state.selectedBureaus.length > 0;
  const hasSelectedAccounts = state.accounts.some(a => a.isSelected);
  const isAnalyzed = state.isAnalyzed;
  const mode = state.mode;
  const bureauCount = state.selectedBureaus.length;
  const nameLength = state.consumerInfo.fullName?.trim().length || 0;
  const selectedAccountCount = state.accounts.filter(a => a.isSelected).length;

  return {
    hasName,
    hasBureaus,
    hasSelectedAccounts,
    isAnalyzed,
    mode,
    isGenerating,
    bureauCount,
    nameLength,
    selectedAccountCount,
  };
}

export function computeCanGenerate(req: GenerateRequirements): boolean {
  // Deterministic canGenerate logic per spec:
  // AI Mode: must have name, bureaus, analyzed, AND selected accounts
  // Manual Mode: only needs name and bureaus
  if (req.isGenerating) return false;
  if (!req.hasName) return false;
  if (!req.hasBureaus) return false;

  if (req.mode === "ai") {
    return req.isAnalyzed && req.hasSelectedAccounts;
  } else {
    // Manual mode: no analysis or accounts required
    return true;
  }
}

export function getFirstUnmetRequirement(req: GenerateRequirements): string | null {
  if (req.isGenerating) {
    return "Generation in progress...";
  }
  if (!req.hasName) {
    return "Enter your Full Legal Name in the form above.";
  }
  if (!req.hasBureaus) {
    return "Select at least one Target Bureau.";
  }
  if (req.mode === "ai") {
    if (!req.isAnalyzed) {
      return "Analysis is required in AI mode. Complete analysis or switch to Manual mode.";
    }
    if (!req.hasSelectedAccounts) {
      return "Select at least one account to dispute in the Account Review section.";
    }
  }
  return null;
}

export function GenerateRequirementsPanel({
  requirements: req,
  canGenerate,
}: GenerateRequirementsPanelProps) {
  const items: { label: string; ok: boolean; value: string }[] = [
    {
      label: "Mode",
      ok: true,
      value: req.mode === "ai" ? "AI Mode" : "Manual Mode",
    },
    {
      label: "Full Name",
      ok: req.hasName,
      value: req.nameLength > 0 ? `${req.nameLength} chars` : "Not entered",
    },
    {
      label: "Bureaus Selected",
      ok: req.hasBureaus,
      value: `${req.bureauCount} selected`,
    },
  ];

  // Only show AI-mode-specific requirements in AI mode
  if (req.mode === "ai") {
    items.push({
      label: "Analysis Complete",
      ok: req.isAnalyzed,
      value: req.isAnalyzed ? "Yes" : "No",
    });
    items.push({
      label: "Accounts Selected",
      ok: req.hasSelectedAccounts,
      value: `${req.selectedAccountCount} selected`,
    });
  }

  items.push({
    label: "Generating",
    ok: !req.isGenerating,
    value: req.isGenerating ? "In progress" : "Ready",
  });

  const firstUnmet = getFirstUnmetRequirement(req);

  return (
    <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <AlertCircle className="w-4 h-4" />
        Generation Requirements
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {items.map((item) => (
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
      {!canGenerate && firstUnmet && (
        <div className="mt-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
          ⚠️ {firstUnmet}
        </div>
      )}
    </div>
  );
}
