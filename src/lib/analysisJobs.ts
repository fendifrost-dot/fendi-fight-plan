/**
 * Single-source-of-truth module for analysis job lifecycle management.
 * 
 * ALL job logic (start, poll, resume, finalize) MUST live here.
 * Components should ONLY use hooks that wrap this module.
 */

import { supabase } from '@/integrations/supabase/client';

// ============= TYPES =============

export type JobStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'PARTIAL' | 'DONE' | 'FAILED';

export interface JobCheckpoints {
  documentMap: any | null;
  accounts: any[];
  processedChunks: number;
  totalChunks: number;
  failedChunks: number[];
}

export interface AnalysisJob {
  id: string;
  userId: string;
  sessionId: string | null;
  status: JobStatus;
  step: string | null;
  progress: number;
  attemptCount: number;
  maxAttempts: number;
  lastHeartbeatAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  inputData: any | null;
  checkpoints: JobCheckpoints | null;
  resultData: any | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface JobState {
  jobId: string | null;
  status: JobStatus;
  step: string;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  checkpoints: JobCheckpoints;
  result: any | null;
  lastUpdated: number;
}

export const DEFAULT_JOB_STATE: JobState = {
  jobId: null,
  status: 'IDLE',
  step: '',
  progress: 0,
  errorCode: null,
  errorMessage: null,
  checkpoints: {
    documentMap: null,
    accounts: [],
    processedChunks: 0,
    totalChunks: 0,
    failedChunks: [],
  },
  result: null,
  lastUpdated: 0,
};

// ============= CONSTANTS =============

const POLL_INTERVAL_MS = 1500;
const WATCHDOG_THRESHOLD_MS = 10000; // Show "Still working..." after 10s of no updates
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes max

// ============= CORE JOB FUNCTIONS =============

/**
 * Start a new analysis job.
 * Returns the jobId immediately (<2s target).
 * Persists activeJobId to the session.
 */
export async function startJob(
  storagePaths: string[],
  questionnaire: any,
  sessionId: string | null
): Promise<{ jobId: string; status: JobStatus } | { error: string }> {
  const { data: authData } = await supabase.auth.getSession();
  
  if (!authData.session?.access_token) {
    return { error: 'Not authenticated' };
  }

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analysis-start`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authData.session.access_token}`,
        },
        body: JSON.stringify({
          storagePaths,
          questionnaire,
          sessionId,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to start job' }));
      return { error: error.error || 'Failed to start analysis job' };
    }

    const data = await response.json();
    return { jobId: data.jobId, status: data.status as JobStatus };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Network error' };
  }
}

/**
 * Fetch the current status of a job.
 * Returns the full job state for UI rendering.
 */
export async function fetchJobStatus(jobId: string): Promise<JobState | { error: string }> {
  const { data: authData } = await supabase.auth.getSession();
  
  if (!authData.session?.access_token) {
    return { error: 'Session expired' };
  }

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analysis-status?jobId=${jobId}`,
      {
        headers: {
          'Authorization': `Bearer ${authData.session.access_token}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch status' }));
      return { error: error.error || 'Failed to get job status' };
    }

    const data = await response.json();

    return {
      jobId: data.jobId,
      status: data.status as JobStatus,
      step: data.step || '',
      progress: data.progress || 0,
      errorCode: data.errorCode || null,
      errorMessage: data.errorMessage || null,
      checkpoints: data.partialResults || DEFAULT_JOB_STATE.checkpoints,
      result: data.result || null,
      lastUpdated: Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Network error' };
  }
}

/**
 * Retry a failed job by triggering the worker again.
 */
export async function retryJob(jobId: string): Promise<{ success: boolean } | { error: string }> {
  const { data: authData } = await supabase.auth.getSession();
  
  if (!authData.session?.access_token) {
    return { error: 'Not authenticated' };
  }

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analysis-worker`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authData.session.access_token}`,
        },
        body: JSON.stringify({ jobId }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to retry' }));
      return { error: error.error || 'Failed to retry job' };
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Network error' };
  }
}

/**
 * Fetch the most recent job for a user (for resume on refresh).
 */
export async function fetchActiveJob(): Promise<AnalysisJob | null> {
  const { data: authData } = await supabase.auth.getSession();
  
  if (!authData.session?.user?.id) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('analysis_jobs')
      .select('*')
      .eq('user_id', authData.session.user.id)
      .in('status', ['QUEUED', 'RUNNING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapDbJobToJob(data);
  } catch {
    return null;
  }
}

/**
 * Fetch a specific job by ID.
 */
export async function fetchJobById(jobId: string): Promise<AnalysisJob | null> {
  const { data: authData } = await supabase.auth.getSession();
  
  if (!authData.session?.user?.id) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('analysis_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', authData.session.user.id)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapDbJobToJob(data);
  } catch {
    return null;
  }
}

/**
 * Check if a job needs the "Still working..." watchdog message.
 */
export function isJobStale(state: JobState): boolean {
  if (!['QUEUED', 'RUNNING'].includes(state.status)) {
    return false;
  }
  return Date.now() - state.lastUpdated > WATCHDOG_THRESHOLD_MS;
}

/**
 * Check if polling has exceeded max duration.
 */
export function isPollExpired(pollStartTime: number): boolean {
  return Date.now() - pollStartTime > MAX_POLL_DURATION_MS;
}

/**
 * Get the poll interval.
 */
export function getPollInterval(): number {
  return POLL_INTERVAL_MS;
}

/**
 * Check if a status is terminal (no more polling needed).
 */
export function isTerminalStatus(status: JobStatus): boolean {
  return ['DONE', 'FAILED', 'PARTIAL'].includes(status);
}

// ============= HELPERS =============

function mapDbJobToJob(data: any): AnalysisJob {
  return {
    id: data.id,
    userId: data.user_id,
    sessionId: data.session_id,
    status: data.status as JobStatus,
    step: data.step,
    progress: data.progress || 0,
    attemptCount: data.attempt_count || 0,
    maxAttempts: data.max_attempts || 3,
    lastHeartbeatAt: data.last_heartbeat_at,
    errorCode: data.error_code,
    errorMessage: data.error_message,
    inputData: data.input_data,
    checkpoints: data.checkpoints as JobCheckpoints | null,
    resultData: data.result_data,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    startedAt: data.started_at,
    completedAt: data.completed_at,
  };
}

/**
 * Parse job results into normalized account format.
 * This is called AFTER results are persisted, for UI rendering.
 */
export function parseJobResultAccounts(resultData: any): any[] {
  if (!resultData) return [];
  
  if (Array.isArray(resultData.accounts)) {
    return resultData.accounts;
  }
  
  // Handle legacy format
  const accounts: any[] = [];
  if (resultData.derogatory_accounts) {
    accounts.push(...resultData.derogatory_accounts);
  }
  if (resultData.collections) {
    accounts.push(...resultData.collections);
  }
  if (resultData.charge_offs) {
    accounts.push(...resultData.charge_offs);
  }
  
  return accounts;
}

/**
 * Format a job result for display.
 */
export function formatJobResult(job: AnalysisJob | JobState): {
  accountCount: number;
  summary: string;
  hasPartialData: boolean;
} {
  const result = 'resultData' in job ? job.resultData : job.result;
  const checkpoints = job.checkpoints;
  
  let accountCount = 0;
  let hasPartialData = false;
  
  if (result?.accounts) {
    accountCount = result.accounts.length;
  } else if (checkpoints?.accounts) {
    accountCount = checkpoints.accounts.length;
    hasPartialData = true;
  }
  
  const status = job.status;
  let summary = '';
  
  if (status === 'DONE') {
    summary = `Analysis complete. Found ${accountCount} account(s).`;
  } else if (status === 'PARTIAL') {
    summary = `Analysis partially complete. Extracted ${accountCount} account(s) from available chunks.`;
  } else if (status === 'FAILED') {
    const errorMsg = 'errorMessage' in job ? job.errorMessage : null;
    summary = errorMsg || 'Analysis failed. Try again or switch to Manual Mode.';
  } else if (status === 'RUNNING') {
    summary = `Analyzing... ${job.step || ''}`;
  } else if (status === 'QUEUED') {
    summary = 'Waiting to start analysis...';
  }
  
  return { accountCount, summary, hasPartialData };
}
