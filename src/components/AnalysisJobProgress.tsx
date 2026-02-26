import { Loader2, CheckCircle, AlertCircle, AlertTriangle, RefreshCw, ArrowRight, Bug, Copy, Check, Clock } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { JobState, JobStatus, ChunkTiming } from '@/lib/analysisJobs';

interface AnalysisJobProgressProps {
  state: JobState;
  onRetry?: () => void;
  onUsePartial?: () => void;
  onSwitchToManual?: () => void;
  onCancel?: () => void;
  onStartFresh?: () => void;
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

const TIMEOUT_SOURCE_LABELS: Record<string, string> = {
  client_wait: 'Client polling expired (worker may still be running)',
  edge_fn: 'Backend function crashed or timed out',
  model_call: 'AI model call timed out',
  db: 'Database operation timed out',
  unknown: 'Unknown timeout source',
};

export function AnalysisJobProgress({
  state,
  onRetry,
  onUsePartial,
  onSwitchToManual,
  onCancel,
  onStartFresh,
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
    const chunkTimings = checkpoints.chunkTimings || [];
    const lastCompletedChunk = chunkTimings.length > 0
      ? chunkTimings[chunkTimings.length - 1]
      : null;

    const diagnostics = {
      jobId,
      status,
      step,
      progress,
      error: error || (errorMessage ? { code: state.errorCode || 'UNKNOWN', message: errorMessage, stage: 'UI' } : null),
      timeoutClassification: {
        source: state.timeoutSource || error?.where || null,
        label: state.timeoutSource ? TIMEOUT_SOURCE_LABELS[state.timeoutSource] : null,
        clientPollElapsedMs: error?.elapsedMs || null,
      },
      heartbeat: {
        lastHeartbeatAt: state.lastHeartbeatAt,
        heartbeatAgeMs: state.heartbeatAgeMs,
        isHeartbeatStale: state.isHeartbeatStale,
      },
      timing: {
        createdAt: state.createdAt,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        lastHeartbeatAt: state.lastHeartbeatAt,
      },
      chunks: {
        processedChunks: checkpoints.processedChunks,
        totalChunks: checkpoints.totalChunks,
        failedChunks: checkpoints.failedChunks,
        accountsExtracted: checkpoints.accounts?.length || 0,
        lastCompletedChunk: lastCompletedChunk ? {
          index: lastCompletedChunk.chunkIndex,
          status: lastCompletedChunk.status,
          elapsedMs: lastCompletedChunk.elapsedMs,
          endedAt: lastCompletedChunk.endedAt,
        } : null,
      },
      chunkTimings: chunkTimings.map(t => ({
        chunk: t.chunkIndex,
        status: t.status,
        elapsedMs: t.elapsedMs,
        retryElapsedMs: t.retryElapsedMs,
        error: t.error,
      })),
      meta: {
        totalPages: state.totalPages,
        attemptCount: state.attemptCount,
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

      {/* Timeout Classification */}
      {(state.timeoutSource || error?.where) && (
        <div className="text-sm bg-orange-500/10 text-orange-700 dark:text-orange-400 rounded p-3 space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <Clock className="h-4 w-4" />
            Timeout Source: {state.timeoutSource || error?.where}
          </div>
          <div className="text-xs">
            {TIMEOUT_SOURCE_LABELS[state.timeoutSource || error?.where || 'unknown']}
          </div>
          {state.lastHeartbeatAt && (
            <div className="text-xs text-muted-foreground">
              Last heartbeat: {new Date(state.lastHeartbeatAt).toLocaleTimeString()}
              {state.heartbeatAgeMs != null && ` (${Math.round(state.heartbeatAgeMs / 1000)}s ago)`}
            </div>
          )}
        </div>
      )}

      {/* Structured Error Display */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded p-3 space-y-1">
          <div className="font-mono text-xs flex flex-wrap gap-2">
            <span className="bg-destructive/20 px-1.5 py-0.5 rounded">{error.stage}</span>
            <span className="bg-destructive/20 px-1.5 py-0.5 rounded">{error.code}</span>
            {error.where && (
              <span className="bg-orange-500/20 text-orange-700 dark:text-orange-400 px-1.5 py-0.5 rounded">
                {error.where}
              </span>
            )}
          </div>
          <div>{error.message}</div>
          {error.step && <div className="text-xs text-muted-foreground">Step: {error.step}</div>}
          {error.chunk != null && <div className="text-xs text-muted-foreground">Chunk: {error.chunk}</div>}
          {error.page != null && <div className="text-xs text-muted-foreground">Page: {error.page}</div>}
          {error.elapsedMs != null && <div className="text-xs text-muted-foreground">Elapsed: {(error.elapsedMs / 1000).toFixed(1)}s</div>}
        </div>
      )}

      {/* Fallback: legacy errorMessage */}
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
        {status === 'FAILED' && error?.code === 'JOB_STALE' && onStartFresh && (
          <Button variant="default" size="sm" onClick={onStartFresh}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Start Fresh Analysis
          </Button>
        )}

        {status === 'FAILED' && error?.code !== 'JOB_STALE' && onRetry && (
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
          <div className="mt-2 p-2 bg-muted/50 rounded font-mono text-[10px] space-y-0.5">
            <div>Job ID: {jobId}</div>
            <div>Status: {status}</div>
            <div>Progress: {progress}%</div>
            <div>Step: {step || 'N/A'}</div>
            <div>Pages: {state.totalPages}</div>
            <div>Attempt: {state.attemptCount}</div>
            <div>Chunks: {checkpoints.processedChunks}/{checkpoints.totalChunks} ({checkpoints.failedChunks.length} failed)</div>
            <div>Accounts extracted: {checkpoints.accounts?.length || 0}</div>
            {state.lastHeartbeatAt && <div>Last heartbeat: {state.lastHeartbeatAt}</div>}
            {state.isHeartbeatStale && <div className="text-yellow-500">⚠ Heartbeat stale</div>}
            {state.timeoutSource && <div>Timeout source: {state.timeoutSource}</div>}
            {error && <div>Error: [{error.stage}] {error.code}: {error.message}</div>}
            {error?.where && <div>Where: {error.where}</div>}
            {error?.elapsedMs != null && <div>Elapsed: {(error.elapsedMs / 1000).toFixed(1)}s</div>}
          </div>
        </details>
      )}
    </div>
  );
}
