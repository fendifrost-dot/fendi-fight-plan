import { Loader2, CheckCircle, AlertCircle, AlertTriangle, RefreshCw, ArrowRight, Bug, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { JobState, JobStatus } from '@/lib/analysisJobs';

interface AnalysisJobProgressProps {
  state: JobState;
  onRetry?: () => void;
  onUsePartial?: () => void;
  onSwitchToManual?: () => void;
  onCancel?: () => void;
  isStale?: boolean;
}

const STATUS_CONFIG: Record<JobStatus, { icon: React.ElementType; color: string; label: string }> = {
  IDLE: { icon: Loader2, color: 'text-muted-foreground', label: 'Ready' },
  QUEUED: { icon: Loader2, color: 'text-blue-500', label: 'Queued' },
  RUNNING: { icon: Loader2, color: 'text-blue-500', label: 'Processing' },
  PARTIAL: { icon: AlertTriangle, color: 'text-yellow-500', label: 'Partial Results' },
  DONE: { icon: CheckCircle, color: 'text-green-500', label: 'Complete' },
  FAILED: { icon: AlertCircle, color: 'text-destructive', label: 'Failed' },
};

export function AnalysisJobProgress({
  state,
  onRetry,
  onUsePartial,
  onSwitchToManual,
  onCancel,
  isStale = false,
}: AnalysisJobProgressProps) {
  const { status, step, progress, errorMessage, error, checkpoints, jobId } = state;
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const isProcessing = status === 'QUEUED' || status === 'RUNNING';
  const [copiedDiag, setCopiedDiag] = useState(false);

  if (status === 'IDLE') {
    return null;
  }

  const copyDiagnostics = () => {
    const diagnostics = {
      jobId,
      status,
      step,
      progress,
      error: error || (errorMessage ? { code: 'UNKNOWN', message: errorMessage, stage: 'UI' } : null),
      checkpoints: {
        processedChunks: checkpoints.processedChunks,
        totalChunks: checkpoints.totalChunks,
        failedChunks: checkpoints.failedChunks,
        accountsExtracted: checkpoints.accounts?.length || 0,
      },
      timestamp: new Date().toISOString(),
    };
    navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopiedDiag(true);
    setTimeout(() => setCopiedDiag(false), 2000);
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-5 w-5', config.color, isProcessing && 'animate-spin')} />
          <span className={cn('font-medium', config.color)}>{config.label}</span>
          {isStale && isProcessing && (
            <span className="text-xs text-yellow-500 ml-2">(Still working...)</span>
          )}
        </div>
        {isProcessing && onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{step || 'Processing...'}</span>
            <span>{progress}%</span>
          </div>
        </div>
      )}

      {/* Chunk Progress */}
      {isProcessing && checkpoints.totalChunks > 0 && (
        <div className="text-xs text-muted-foreground">
          Processed {checkpoints.processedChunks} of {checkpoints.totalChunks} chunks
          {checkpoints.failedChunks.length > 0 && (
            <span className="text-yellow-500 ml-2">
              ({checkpoints.failedChunks.length} failed)
            </span>
          )}
        </div>
      )}

      {/* Structured Error Display */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded p-3 space-y-1">
          <div className="font-mono text-xs flex flex-wrap gap-2">
            <span className="bg-destructive/20 px-1.5 py-0.5 rounded">{error.stage}</span>
            <span className="bg-destructive/20 px-1.5 py-0.5 rounded">{error.code}</span>
          </div>
          <div>{error.message}</div>
          {error.step && <div className="text-xs text-muted-foreground">Step: {error.step}</div>}
          {error.chunk != null && <div className="text-xs text-muted-foreground">Chunk: {error.chunk}</div>}
          {error.page != null && <div className="text-xs text-muted-foreground">Page: {error.page}</div>}
        </div>
      )}

      {/* Fallback: legacy errorMessage without structured error */}
      {!error && errorMessage && (
        <div className="text-sm text-destructive bg-destructive/10 rounded p-2">
          {errorMessage}
        </div>
      )}

      {/* Partial Results Info */}
      {status === 'PARTIAL' && checkpoints.accounts.length > 0 && (
        <div className="text-sm bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 rounded p-2">
          Found {checkpoints.accounts.length} account(s) despite some chunks failing.
          You can use these results or retry the failed chunks.
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {status === 'FAILED' && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Retry Analysis
          </Button>
        )}

        {status === 'PARTIAL' && onUsePartial && checkpoints.accounts.length > 0 && (
          <Button variant="default" size="sm" onClick={onUsePartial}>
            <ArrowRight className="h-4 w-4 mr-1" />
            Use {checkpoints.accounts.length} Account(s)
          </Button>
        )}

        {status === 'PARTIAL' && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Retry Failed Chunks
          </Button>
        )}

        {(status === 'FAILED' || status === 'PARTIAL') && onSwitchToManual && (
          <Button variant="ghost" size="sm" onClick={onSwitchToManual}>
            Continue in Manual Mode
          </Button>
        )}

        {/* Copy Diagnostics — always available when there's a jobId */}
        {jobId && (
          <Button variant="outline" size="sm" onClick={copyDiagnostics}>
            {copiedDiag ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copiedDiag ? 'Copied!' : 'Copy Diagnostics'}
          </Button>
        )}
      </div>

      {/* Resume Note */}
      {isProcessing && (
        <p className="text-xs text-muted-foreground">
          Analysis continues in the background. You can refresh the page and resume.
        </p>
      )}

      {/* Debug Info */}
      {jobId && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer flex items-center gap-1 hover:text-foreground">
            <Bug className="h-3 w-3" />
            Debug Info
          </summary>
          <div className="mt-2 p-2 bg-muted/50 rounded font-mono text-[10px]">
            <div>Job ID: {jobId}</div>
            <div>Status: {status}</div>
            <div>Progress: {progress}%</div>
            <div>Step: {step || 'N/A'}</div>
            <div>Accounts extracted: {checkpoints.accounts?.length || 0}</div>
            {error && <div>Error: [{error.stage}] {error.code}: {error.message}</div>}
          </div>
        </details>
      )}
    </div>
  );
}
