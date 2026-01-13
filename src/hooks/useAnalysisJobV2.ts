/**
 * React hook for analysis job management.
 * 
 * Wraps the centralized analysisJobs module.
 * Components should use this hook, NOT call analysisJobs directly.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import {
  startJob,
  fetchJobStatus,
  retryJob as retryJobApi,
  fetchActiveJob,
  fetchJobById,
  isTerminalStatus,
  isPollExpired,
  isJobStale,
  getPollInterval,
  formatJobResult,
  parseJobResultAccounts,
  JobState,
  JobStatus,
  DEFAULT_JOB_STATE,
} from '@/lib/analysisJobs';

export interface UseAnalysisJobOptions {
  /** Callback when job completes successfully */
  onComplete?: (result: any, accounts: any[]) => void;
  /** Callback when job fails */
  onError?: (errorCode: string | null, errorMessage: string | null) => void;
  /** Callback when job has partial results */
  onPartial?: (accounts: any[]) => void;
  /** Auto-resume an in-progress job on mount */
  autoResume?: boolean;
}

export interface UseAnalysisJobReturn {
  state: JobState;
  isProcessing: boolean;
  isStale: boolean;
  formattedStatus: { accountCount: number; summary: string; hasPartialData: boolean };
  
  // Actions
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
  const completedRef = useRef(false); // Track if we've already called onComplete
  
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

  // Poll for job status
  const pollStatus = useCallback(async (jobId: string) => {
    const result = await fetchJobStatus(jobId);
    
    if ('error' in result) {
      console.error('Poll error:', result.error);
      // Don't stop polling on transient errors
      return;
    }

    setState(result);

    // Check for terminal states
    if (isTerminalStatus(result.status)) {
      stopPolling();
      
      if (result.status === 'DONE' && !completedRef.current) {
        completedRef.current = true;
        const accounts = parseJobResultAccounts(result.result);
        toast.success(`Analysis complete. Found ${accounts.length} account(s).`);
        onComplete?.(result.result, accounts);
      } else if (result.status === 'PARTIAL') {
        const accounts = result.checkpoints?.accounts || [];
        toast.warning(`Analysis partially complete. Extracted ${accounts.length} account(s).`);
        onPartial?.(accounts);
      } else if (result.status === 'FAILED') {
        toast.error(result.errorMessage || 'Analysis failed');
        onError?.(result.errorCode, result.errorMessage);
      }
    }

    // Check poll expiry
    if (isPollExpired(pollStartRef.current)) {
      stopPolling();
      toast.error('Analysis timed out. Refresh to check status.');
    }
  }, [stopPolling, onComplete, onError, onPartial]);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollStartRef.current = Date.now();
    isProcessingRef.current = true;
    completedRef.current = false;
    
    // Poll immediately
    pollStatus(jobId);
    
    // Then poll periodically
    pollIntervalRef.current = window.setInterval(() => {
      pollStatus(jobId);
    }, getPollInterval());
  }, [stopPolling, pollStatus]);

  // Start a new analysis
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

    // Start polling
    startPolling(result.jobId);
    
    return result.jobId;
  }, [reset, startPolling]);

  // Resume polling for an existing job
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

  // Retry a failed job
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

  // Use partial results
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
  const formattedStatus = formatJobResult(state);

  return {
    state,
    isProcessing,
    isStale,
    formattedStatus,
    startAnalysis,
    resumeJob,
    retryJob,
    usePartialResults,
    reset,
  };
}
