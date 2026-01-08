import { Loader2, CheckCircle, AlertCircle, SkipForward, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { AnalysisProgress } from '@/hooks/useChunkedAnalysis';

interface AnalysisProgressProps {
  progress: AnalysisProgress;
  onSkipPaymentHistory?: () => void;
  onRetrySection?: (section: string) => void;
}

const SECTION_LABELS: Record<string, string> = {
  personal_info: 'Personal Information',
  accounts: 'Account Details',
  inquiries: 'Credit Inquiries',
  payment_history: 'Payment History',
  public_records: 'Public Records',
  summary: 'Summary',
};

export function AnalysisProgress({ progress, onSkipPaymentHistory, onRetrySection }: AnalysisProgressProps) {
  const { phase, currentSection, currentChunk, totalChunks, sectionsComplete, sectionsFailed, message, canSkipPaymentHistory } = progress;

  if (phase === 'idle') return null;

  const percentage = totalChunks > 0 ? Math.round((currentChunk / totalChunks) * 100) : 0;

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
      {/* Phase indicator */}
      <div className="flex items-center gap-3">
        {phase === 'complete' ? (
          <CheckCircle className="h-5 w-5 text-success" />
        ) : phase === 'error' ? (
          <AlertCircle className="h-5 w-5 text-destructive" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        )}
        <span className="font-medium">
          {phase === 'mapping' && 'Phase 1: Mapping Document Structure'}
          {phase === 'analyzing' && 'Phase 2: Extracting Data'}
          {phase === 'complete' && 'Analysis Complete'}
          {phase === 'error' && 'Analysis Error'}
        </span>
      </div>

      {/* Progress bar */}
      {phase === 'analyzing' && totalChunks > 0 && (
        <div className="space-y-2">
          <Progress value={percentage} className="h-2" />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{message}</span>
            <span>{percentage}%</span>
          </div>
        </div>
      )}

      {/* Current section with skip option */}
      {currentSection && (
        <div className="flex items-center justify-between">
          <span className="text-sm">
            Processing: <span className="font-medium">{SECTION_LABELS[currentSection] || currentSection}</span>
          </span>
          {canSkipPaymentHistory && onSkipPaymentHistory && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSkipPaymentHistory}
              className="text-xs"
            >
              <SkipForward className="h-3 w-3 mr-1" />
              Skip Payment Grid
            </Button>
          )}
        </div>
      )}

      {/* Sections status */}
      {(sectionsComplete.length > 0 || sectionsFailed.length > 0) && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          {sectionsComplete.map(section => (
            <div
              key={section}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-success/10 text-success"
            >
              <CheckCircle className="h-3 w-3" />
              {SECTION_LABELS[section] || section}
            </div>
          ))}
          {sectionsFailed.map(section => (
            <div
              key={section}
              className={cn(
                "flex items-center gap-1 text-xs px-2 py-1 rounded-full",
                "bg-destructive/10 text-destructive"
              )}
            >
              <AlertCircle className="h-3 w-3" />
              {SECTION_LABELS[section] || section}
              {onRetrySection && (
                <button
                  onClick={() => onRetrySection(section)}
                  className="ml-1 hover:text-destructive-foreground"
                  title={`Retry ${SECTION_LABELS[section] || section}`}
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error message */}
      {phase === 'error' && (
        <p className="text-sm text-destructive">{message}</p>
      )}
    </div>
  );
}
