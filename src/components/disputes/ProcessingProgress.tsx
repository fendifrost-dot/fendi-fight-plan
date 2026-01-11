import { Loader2, CheckCircle, AlertCircle, RefreshCw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ProcessingProgress as ProgressType } from "@/types/disputes";

interface ProcessingProgressProps {
  progress: ProgressType;
  onRetryChunk?: (chunkId: string) => void;
  onSkipChunk?: (chunkId: string) => void;
  onCancel?: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  idle: "Ready",
  ingesting: "Phase 1: Ingesting Documents",
  classifying: "Phase 2: Classifying Documents",
  analyzing: "Phase 3: Analyzing Content",
  normalizing: "Phase 4: Normalizing Data",
  complete: "Processing Complete",
  error: "Processing Error",
};

export function ProcessingProgress({
  progress,
  onRetryChunk,
  onSkipChunk,
  onCancel,
}: ProcessingProgressProps) {
  const { phase, currentStep, totalSteps, completedSteps, failedChunks, message } = progress;

  if (phase === "idle") return null;

  const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const isActive = !["idle", "complete", "error"].includes(phase);

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
      {/* Phase indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {phase === "complete" ? (
            <CheckCircle className="h-5 w-5 text-green-500" />
          ) : phase === "error" ? (
            <AlertCircle className="h-5 w-5 text-destructive" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          )}
          <span className="font-medium">{PHASE_LABELS[phase]}</span>
        </div>

        {isActive && onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {/* Progress bar */}
      {isActive && totalSteps > 0 && (
        <div className="space-y-2">
          <Progress value={percentage} className="h-2" />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{currentStep || message}</span>
            <span>{completedSteps} / {totalSteps} ({percentage}%)</span>
          </div>
        </div>
      )}

      {/* Message */}
      {message && !isActive && (
        <p className={`text-sm ${phase === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {message}
        </p>
      )}

      {/* Failed chunks with retry */}
      {failedChunks.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <p className="text-sm font-medium text-destructive flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {failedChunks.length} section(s) failed
          </p>
          <div className="flex flex-wrap gap-2">
            {failedChunks.map((chunk) => (
              <div
                key={chunk}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/30"
              >
                <span>{chunk}</span>
                {onRetryChunk && (
                  <button
                    onClick={() => onRetryChunk(chunk)}
                    className="ml-1 hover:text-destructive-foreground"
                    title={`Retry ${chunk}`}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}
                {onSkipChunk && (
                  <button
                    onClick={() => onSkipChunk(chunk)}
                    className="ml-1 hover:text-destructive-foreground"
                    title={`Skip ${chunk}`}
                  >
                    <SkipForward className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Success message */}
      {phase === "complete" && (
        <p className="text-sm text-green-500">
          {message || "All documents processed successfully."}
        </p>
      )}
    </div>
  );
}
