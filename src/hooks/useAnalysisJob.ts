import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type JobStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'PARTIAL' | 'DONE' | 'FAILED';

export interface AnalysisJobState {
  jobId: string | null;
  status: JobStatus;
  step: string;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  partialResults: {
    documentMap: any | null;
    accounts: any[];
    processedChunks: number;
    totalChunks: number;
    failedChunks: number[];
  };
  result: any | null;
}

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes

const defaultState: AnalysisJobState = {
  jobId: null,
  status: 'IDLE',
  step: '',
  progress: 0,
  errorCode: null,
  errorMessage: null,
  partialResults: {
    documentMap: null,
    accounts: [],
    processedChunks: 0,
    totalChunks: 0,
    failedChunks: [],
  },
  result: null,
};

export function useAnalysisJob() {
  const [state, setState] = useState<AnalysisJobState>(defaultState);
  const pollIntervalRef = useRef<number | null>(null);
  const pollStartRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setState(defaultState);
  }, [stopPolling]);

  // Poll for job status
  const pollStatus = useCallback(async (jobId: string) => {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) {
        stopPolling();
        setState(prev => ({ ...prev, status: 'FAILED', errorMessage: 'Session expired' }));
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analysis-status?jobId=${jobId}`,
        {
          headers: {
            'Authorization': `Bearer ${session.session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get status');
      }

      const data = await response.json();

      setState(prev => ({
        ...prev,
        jobId: data.jobId,
        status: data.status as JobStatus,
        step: data.step || '',
        progress: data.progress || 0,
        errorCode: data.errorCode || null,
        errorMessage: data.errorMessage || null,
        partialResults: data.partialResults || prev.partialResults,
        result: data.result || null,
      }));

      // Stop polling on terminal states
      if (['DONE', 'FAILED', 'PARTIAL'].includes(data.status)) {
        stopPolling();
        
        if (data.status === 'DONE') {
          toast.success(`Analysis complete. Found ${data.result?.accounts?.length || 0} accounts.`);
        } else if (data.status === 'PARTIAL') {
          toast.warning('Analysis partially complete. Some chunks failed but results are available.');
        } else if (data.status === 'FAILED') {
          toast.error(data.errorMessage || 'Analysis failed');
        }
      }

      // Stop polling if exceeded max duration
      if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
        stopPolling();
        toast.error('Analysis timed out. Try refreshing to check status.');
      }
    } catch (error) {
      console.error('Poll error:', error);
      // Don't stop polling on transient errors, but log them
    }
  }, [stopPolling]);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollStartRef.current = Date.now();
    
    // Poll immediately
    pollStatus(jobId);
    
    // Then poll periodically
    pollIntervalRef.current = window.setInterval(() => {
      pollStatus(jobId);
    }, POLL_INTERVAL_MS);
  }, [stopPolling, pollStatus]);

  // Start analysis job
  const startAnalysis = useCallback(async (
    imageUrls: string[],
    questionnaire?: any,
    sessionId?: string
  ): Promise<string | null> => {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) {
        toast.error('Please log in to analyze documents');
        return null;
      }

      setState({ ...defaultState, status: 'QUEUED', step: 'Starting analysis...' });

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analysis-start`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.session.access_token}`,
          },
          body: JSON.stringify({
            imageUrls,
            questionnaire,
            sessionId,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start analysis');
      }

      const { jobId, status } = await response.json();

      setState(prev => ({
        ...prev,
        jobId,
        status: status as JobStatus,
      }));

      // Start polling
      startPolling(jobId);

      return jobId;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start analysis';
      setState(prev => ({
        ...prev,
        status: 'FAILED',
        errorMessage: message,
      }));
      toast.error(message);
      return null;
    }
  }, [startPolling]);

  // Resume polling for an existing job
  const resumeJob = useCallback(async (jobId: string) => {
    setState(prev => ({
      ...prev,
      jobId,
      status: 'RUNNING',
      step: 'Resuming...',
    }));
    startPolling(jobId);
  }, [startPolling]);

  // Retry a failed job
  const retryJob = useCallback(async () => {
    if (!state.jobId) return;

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) {
        toast.error('Please log in');
        return;
      }

      // Trigger worker again
      setState(prev => ({
        ...prev,
        status: 'QUEUED',
        step: 'Retrying...',
        errorCode: null,
        errorMessage: null,
      }));

      const workerUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analysis-worker`;
      await fetch(workerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({ jobId: state.jobId }),
      });

      startPolling(state.jobId);
    } catch (error) {
      toast.error('Failed to retry analysis');
    }
  }, [state.jobId, startPolling]);

  // Use partial results (for PARTIAL status)
  const usePartialResults = useCallback(() => {
    if (state.partialResults.accounts.length > 0) {
      toast.success(`Using ${state.partialResults.accounts.length} extracted accounts`);
      return state.partialResults.accounts;
    }
    return [];
  }, [state.partialResults.accounts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return {
    state,
    startAnalysis,
    resumeJob,
    retryJob,
    usePartialResults,
    reset,
    isProcessing: ['QUEUED', 'RUNNING'].includes(state.status),
  };
}
