/**
 * React hook for analysis job management.
 * 
 * Wraps the centralized analysisJobs module.
 * Components should use this hook, NOT call analysisJobs directly.
 * 
 * CRITICAL INVARIANT: Toast must ONLY fire AFTER the onComplete callback
 * has successfully hydrated results into the component's state.
 * 
 * CANONICAL CONTRACT: onComplete now receives the full CanonicalAnalyzerResult,
 * not just accounts. Partial recovery also uses canonical result when available.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { CanonicalAnalyzerResult } from '@/types/disputes';
import {
  startJob,
  fetchJobStatus,
  retryJob as retryJobApi,
  fetchActiveJob,
  isTerminalStatus,
  isPollExpired,
  isJobStale,
  getPollInterval,
  parseJobResult,
  parseCheckpointResult,
  classifyTimeout,
  JobState,
  JobStatus,
  DEFAULT_JOB_STATE,
} from '@/lib/analysisJobs';

export interface UseAnalysisJobOptions {
  /** Called with full canonical result when job completes. Return true to confirm hydration. */
  onComplete?: (canonicalResult: CanonicalAnalyzerResult) => boolean | void;
  onError?: (errorCode: string | null, errorMessage: string | null) => void;
  /** Called with partial canonical result when available */
  onPartial?: (canonicalResult: CanonicalAnalyzerResult) => void;
  autoResume?: boolean;
}

export interface UseAnalysisJobReturn {
  state: JobState;
  isProcessing: boolean;
  isStale: boolean;
  
  startAnalysis: (imageUrls: string[], questionnaire?: any, sessionId?: string | null) => Promise<string | null>;
  resumeJob: (jobId: string) => void;
  retryJob: () => Promise<void>;
  usePartialResults: () => CanonicalAnalyzerResult | null;
  reset: () => void;
}

export function useAnalysisJobV2(options: UseAnalysisJobOptions = {}): UseAnalysisJobReturn {
  const { onComplete, onError, onPartial, autoResume = true } = options;
  
  const [state, setState] = useState<JobState>(DEFAULT_JOB_STATE);
  const pollIntervalRef = useRef<number | null>(null);
  const pollStartRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const completedRef = useRef(false);
  
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    isProcessingRef.current = false;
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setState(DEFAULT_JOB_STATE);
    completedRef.current = false;
  }, [stopPolling]);

  // Auto-mark stale RUNNING jobs as FAILED so user can retry
  const markStaleJobFailed = useCallback(async (jobId: string, jobState: JobState) => {
    console.warn(`[useAnalysisJobV2] marking stale job ${jobId} as FAILED (heartbeat age: ${jobState.heartbeatAgeMs}ms)`);
    
    const { error } = await supabase
      .from('analysis_jobs')
      .update({
        status: 'FAILED',
        error_code: 'JOB_STALE',
        error_message: `Worker stopped responding. Last heartbeat ${Math.round((jobState.heartbeatAgeMs || 0) / 1000)}s ago at chunk ${jobState.checkpoints?.processedChunks || '?'}/${jobState.checkpoints?.totalChunks || '?'}`,
        error_stage: 'WORKER',
        error_meta: {
          where: 'edge_fn',
          lastHeartbeatAt: jobState.lastHeartbeatAt,
          heartbeatAgeMs: jobState.heartbeatAgeMs,
          processedChunks: jobState.checkpoints?.processedChunks,
          totalChunks: jobState.checkpoints?.totalChunks,
          step: jobState.step,
        },
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'RUNNING');
    
    if (error) {
      console.error('[useAnalysisJobV2] failed to mark job stale:', error);
    }
  }, []);

  // Poll for job status
  const pollStatus = useCallback(async (jobId: string) => {
    const result = await fetchJobStatus(jobId);
    
    if ('fetchError' in result) {
      console.error('Poll error:', result.fetchError);
      return;
    }

    setState(result);

    // AUTO-DETECT stale heartbeat: if RUNNING but heartbeat stale, mark FAILED
    if (result.status === 'RUNNING' && result.isHeartbeatStale && result.heartbeatAgeMs && result.heartbeatAgeMs > 60_000) {
      stopPolling();
      await markStaleJobFailed(jobId, result);
      
      // Re-fetch to get the updated FAILED status
      const updated = await fetchJobStatus(jobId);
      if (!('fetchError' in updated)) {
        setState(updated);
        // Try to recover partial results using canonical hydration
        const partialCanonical = parseCheckpointResult(updated.checkpoints);
        if (partialCanonical && (partialCanonical.derogatory_accounts.length > 0 || partialCanonical.collections.length > 0)) {
          toast.warning(`Worker stopped at chunk ${updated.checkpoints?.processedChunks}/${updated.checkpoints?.totalChunks}. ${partialCanonical.derogatory_accounts.length} account(s) recovered. You can retry or use partial results.`);
          onPartial?.(partialCanonical);
        } else {
          toast.error('Worker stopped responding. Click "Retry" to resume from the last checkpoint.');
        }
        onError?.('JOB_STALE', updated.errorMessage);
      }
      return;
    }

    if (isTerminalStatus(result.status)) {
      stopPolling();
      
      if (result.status === 'DONE' && !completedRef.current) {
        completedRef.current = true;
        // Use full canonical hydration — NOT account-only parsing
        const canonicalResult = parseJobResult(result.result);
        
        try {
          const hydrationSuccess = onComplete?.(canonicalResult);
          
          const totalEntities = canonicalResult.derogatory_accounts.length + 
            canonicalResult.collections.length + canonicalResult.charge_offs.length;
          
          if (hydrationSuccess === true) {
            toast.success(`Analysis complete. Found ${totalEntities} account(s), ${canonicalResult.inquiries.length} inquiry(s).`);
          } else if (hydrationSuccess === undefined) {
            console.warn('[useAnalysisJobV2] onComplete callback should return true after hydrating results');
            toast.success(`Analysis complete. Found ${totalEntities} account(s), ${canonicalResult.inquiries.length} inquiry(s).`);
          }
        } catch (err) {
          console.error('[useAnalysisJobV2] onComplete callback failed:', err);
          toast.error('Analysis complete but failed to load results. Use the reload button.');
        }
      } else if (result.status === 'PARTIAL') {
        const partialCanonical = result.result 
          ? parseJobResult(result.result) 
          : parseCheckpointResult(result.checkpoints);
        if (partialCanonical) {
          const totalEntities = partialCanonical.derogatory_accounts.length + 
            partialCanonical.collections.length + partialCanonical.charge_offs.length;
          toast.warning(`Analysis partially complete. Extracted ${totalEntities} account(s).`);
          onPartial?.(partialCanonical);
        }
      } else if (result.status === 'FAILED') {
        const timeoutSrc = classifyTimeout(result, pollStartRef.current);
        const enhancedMsg = result.errorCode?.includes('TIMEOUT') || result.errorCode === 'JOB_STALE'
          ? `${result.errorMessage} [source: ${timeoutSrc}]`
          : result.errorMessage;
        toast.error(enhancedMsg || 'Analysis failed');
        onError?.(result.errorCode, result.errorMessage);
      }
    }

    // Check poll expiry
    if (isPollExpired(pollStartRef.current)) {
      stopPolling();
      
      const timeoutSrc = classifyTimeout(result, pollStartRef.current);
      
      setState(prev => ({
        ...prev,
        timeoutSource: timeoutSrc,
        errorCode: 'ANALYSIS_TIMEOUT',
        errorMessage: `Analysis timed out [source: ${timeoutSrc}]`,
        error: {
          code: 'ANALYSIS_TIMEOUT',
          message: `Client polling expired after 10 minutes`,
          stage: 'CLIENT',
          where: timeoutSrc,
          elapsedMs: Date.now() - pollStartRef.current,
          step: prev.step,
          chunk: prev.checkpoints?.processedChunks || null,
        },
      }));
      
      toast.error(`Analysis timed out [${timeoutSrc}]. Use "Copy Diagnostics" for details.`);
    }
  }, [stopPolling, markStaleJobFailed, onComplete, onError, onPartial]);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollStartRef.current = Date.now();
    isProcessingRef.current = true;
    completedRef.current = false;
    
    pollStatus(jobId);
    
    pollIntervalRef.current = window.setInterval(() => {
      pollStatus(jobId);
    }, getPollInterval());
  }, [stopPolling, pollStatus]);

  const startAnalysis = useCallback(async (
    imageUrls: string[],
    questionnaire?: any,
    sessionId?: string | null
  ): Promise<string | null> => {
    reset();
    
    setState({
      ...DEFAULT_JOB_STATE,
      status: 'QUEUED',
      step: 'Starting analysis...',
      lastUpdated: Date.now(),
    });
    isProcessingRef.current = true;

    const result = await startJob(imageUrls, questionnaire, sessionId || null);
    
    if ('error' in result) {
      setState(prev => ({
        ...prev,
        status: 'FAILED',
        errorMessage: result.error,
      }));
      toast.error(result.error);
      isProcessingRef.current = false;
      return null;
    }

    setState(prev => ({
      ...prev,
      jobId: result.jobId,
      status: result.status,
    }));

    startPolling(result.jobId);
    
    return result.jobId;
  }, [reset, startPolling]);

  const resumeJob = useCallback((jobId: string) => {
    setState(prev => ({
      ...prev,
      jobId,
      status: 'RUNNING',
      step: 'Resuming...',
      lastUpdated: Date.now(),
    }));
    isProcessingRef.current = true;
    completedRef.current = false;
    startPolling(jobId);
  }, [startPolling]);

  const retryJob = useCallback(async () => {
    if (!state.jobId) {
      toast.error('No job to retry');
      return;
    }

    setState(prev => ({
      ...prev,
      status: 'QUEUED',
      step: 'Retrying...',
      errorCode: null,
      errorMessage: null,
      error: null,
      timeoutSource: null,
      lastUpdated: Date.now(),
    }));
    isProcessingRef.current = true;
    completedRef.current = false;

    const result = await retryJobApi(state.jobId);
    
    if ('error' in result) {
      toast.error(result.error);
      setState(prev => ({
        ...prev,
        status: 'FAILED',
        errorMessage: result.error,
      }));
      isProcessingRef.current = false;
      return;
    }

    startPolling(state.jobId);
  }, [state.jobId, startPolling]);

  const usePartialResults = useCallback((): CanonicalAnalyzerResult | null => {
    // Try result first, then checkpoints
    if (state.result) {
      const canonical = parseJobResult(state.result);
      toast.success(`Using ${canonical.derogatory_accounts.length} extracted account(s)`);
      return canonical;
    }
    const partial = parseCheckpointResult(state.checkpoints);
    if (partial && (partial.derogatory_accounts.length > 0 || partial.collections.length > 0)) {
      toast.success(`Using ${partial.derogatory_accounts.length} extracted account(s) from checkpoint`);
      return partial;
    }
    return null;
  }, [state.checkpoints, state.result]);

  // Auto-resume active job on mount
  useEffect(() => {
    if (!autoResume) return;

    const checkActiveJob = async () => {
      const activeJob = await fetchActiveJob();
      if (activeJob && !isTerminalStatus(activeJob.status as JobStatus)) {
        toast.info('Resuming in-progress analysis...');
        resumeJob(activeJob.id);
      }
    };

    checkActiveJob();
  }, [autoResume, resumeJob]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const isProcessing = ['QUEUED', 'RUNNING'].includes(state.status);
  const isStale = isJobStale(state);

  return {
    state,
    isProcessing,
    isStale,
    startAnalysis,
    resumeJob,
    retryJob,
    usePartialResults,
    reset,
  };
}
