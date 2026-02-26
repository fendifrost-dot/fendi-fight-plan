/**
 * React hook for analysis job management.
 * 
 * Wraps the centralized analysisJobs module.
 * Components should use this hook, NOT call analysisJobs directly.
 * 
 * CRITICAL INVARIANT: Toast must ONLY fire AFTER the onComplete callback
 * has successfully hydrated results into the component's state.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  startJob,
  fetchJobStatus,
  retryJob as retryJobApi,
  fetchActiveJob,
  isTerminalStatus,
  isPollExpired,
  isJobStale,
  getPollInterval,
  parseJobResultAccounts,
  classifyTimeout,
  JobState,
  JobStatus,
  DEFAULT_JOB_STATE,
} from '@/lib/analysisJobs';

export interface UseAnalysisJobOptions {
  onComplete?: (result: any, accounts: any[]) => boolean | void;
  onError?: (errorCode: string | null, errorMessage: string | null) => void;
  onPartial?: (accounts: any[]) => void;
  autoResume?: boolean;
}

export interface UseAnalysisJobReturn {
  state: JobState;
  isProcessing: boolean;
  isStale: boolean;
  
  startAnalysis: (imageUrls: string[], questionnaire?: any, sessionId?: string | null) => Promise<string | null>;
  resumeJob: (jobId: string) => void;
  retryJob: () => Promise<void>;
  usePartialResults: () => any[];
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
        const accounts = updated.checkpoints?.accounts || [];
        if (accounts.length > 0) {
          toast.warning(`Worker stopped at chunk ${updated.checkpoints?.processedChunks}/${updated.checkpoints?.totalChunks}. ${accounts.length} account(s) recovered. You can retry or use partial results.`);
          onPartial?.(accounts);
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
        const accounts = parseJobResultAccounts(result.result);
        
        try {
          const hydrationSuccess = onComplete?.(result.result, accounts);
          
          if (hydrationSuccess === true) {
            toast.success(`Analysis complete. Found ${accounts.length} account(s).`);
          } else if (hydrationSuccess === undefined) {
            console.warn('[useAnalysisJobV2] onComplete callback should return true after hydrating results');
            toast.success(`Analysis complete. Found ${accounts.length} account(s).`);
          }
        } catch (err) {
          console.error('[useAnalysisJobV2] onComplete callback failed:', err);
          toast.error('Analysis complete but failed to load results. Use the reload button.');
        }
      } else if (result.status === 'PARTIAL') {
        const accounts = result.checkpoints?.accounts || [];
        toast.warning(`Analysis partially complete. Extracted ${accounts.length} account(s).`);
        onPartial?.(accounts);
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

  const usePartialResults = useCallback(() => {
    const accounts = state.checkpoints?.accounts || [];
    if (accounts.length > 0) {
      toast.success(`Using ${accounts.length} extracted account(s)`);
    }
    return accounts;
  }, [state.checkpoints?.accounts]);

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
