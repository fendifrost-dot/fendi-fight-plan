/**
 * Single-source-of-truth module for analysis job lifecycle management.
 * 
 * ALL job logic (start, poll, resume, finalize) MUST live here.
 * Components should ONLY use hooks that wrap this module.
 */

import { supabase } from '@/integrations/supabase/client';

// ============= TYPES =============

export type JobStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'PARTIAL' | 'DONE' | 'FAILED';

export type TimeoutSource = 'client_wait' | 'edge_fn' | 'model_call' | 'db' | 'unknown';

export interface ChunkTiming {
  chunkIndex: number;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  status: 'ok' | 'failed' | 'retried_ok' | 'retried_failed';
  error?: string;
  retryElapsedMs?: number;
}

export interface JobCheckpoints {
  documentMap: any | null;
  accounts: any[];
  processedChunks: number;
  totalChunks: number;
  failedChunks: number[];
  chunkTimings?: ChunkTiming[];
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

export interface JobError {
  code: string;
  message: string;
  stage: string;
  step?: string | null;
  page?: number | null;
  chunk?: number | null;
  where?: TimeoutSource | null;
  elapsedMs?: number | null;
  meta?: any | null;
}

export interface JobState {
  jobId: string | null;
  status: JobStatus;
  step: string;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  error: JobError | null;
  checkpoints: JobCheckpoints;
  result: any | null;
  lastUpdated: number;
  // Heartbeat/timing fields for timeout triage
  lastHeartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  isHeartbeatStale: boolean;
  startedAt: string | null;
  createdAt: string | null;
  completedAt: string | null;
  totalPages: number;
  attemptCount: number;
  // Client-side timeout classification
  timeoutSource: TimeoutSource | null;
}

export const DEFAULT_JOB_STATE: JobState = {
  jobId: null,
  status: 'IDLE',
  step: '',
  progress: 0,
  errorCode: null,
  errorMessage: null,
  error: null,
  checkpoints: {
    documentMap: null,
    accounts: [],
    processedChunks: 0,
    totalChunks: 0,
    failedChunks: [],
    chunkTimings: [],
  },
  result: null,
  lastUpdated: 0,
  lastHeartbeatAt: null,
  heartbeatAgeMs: null,
  isHeartbeatStale: false,
  startedAt: null,
  createdAt: null,
  completedAt: null,
  totalPages: 0,
  attemptCount: 0,
  timeoutSource: null,
};

// ============= CONSTANTS =============

const POLL_INTERVAL_MS = 1500;
const WATCHDOG_THRESHOLD_MS = 10000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes max

// ============= TIMEOUT CLASSIFICATION =============

/**
 * Classify the source of a timeout based on available evidence.
 */
export function classifyTimeout(state: JobState, pollStartTime: number): TimeoutSource {
  // If the worker reported a specific 'where' in the error
  if (state.error?.where) {
    return state.error.where as TimeoutSource;
  }

  // If the job has a heartbeat that's stale, the edge function likely crashed/timed out
  if (state.isHeartbeatStale && state.lastHeartbeatAt) {
    return 'edge_fn';
  }

  // If the job never started (no startedAt), it may be a DB or queue issue
  if (!state.startedAt && state.status === 'QUEUED') {
    return 'edge_fn'; // worker never picked it up
  }

  // If the client poll expired but the job is still RUNNING with recent heartbeats
  if (isPollExpired(pollStartTime) && !state.isHeartbeatStale) {
    return 'client_wait';
  }

  // If error code indicates AI timeout
  if (state.errorCode === 'WORKER_AI_TIMEOUT') {
    return 'model_call';
  }

  return 'unknown';
}

// ============= CORE JOB FUNCTIONS =============

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
      const errData = await response.json().catch(() => ({ error: 'Failed to start job' }));
      const msg = typeof errData.error === 'string' ? errData.error : errData.error?.message || 'Failed to start analysis job';
      return { error: msg };
    }

    const data = await response.json();
    return { jobId: data.jobId, status: data.status as JobStatus };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Network error' };
  }
}

export async function fetchJobStatus(jobId: string): Promise<JobState | { fetchError: string }> {
  const { data: authData } = await supabase.auth.getSession();
  
  if (!authData.session?.access_token) {
    return { fetchError: 'Session expired' };
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
      const errData = await response.json().catch(() => ({ error: 'Failed to fetch status' }));
      const msg = typeof errData.error === 'string' ? errData.error : errData.error?.message || 'Failed to get job status';
      return { fetchError: msg };
    }

    const data = await response.json();

    return {
      jobId: data.jobId,
      status: data.status as JobStatus,
      step: data.step || '',
      progress: data.progress || 0,
      errorCode: data.error?.code || null,
      errorMessage: data.error?.message || null,
      error: data.error || null,
      checkpoints: data.partialResults || DEFAULT_JOB_STATE.checkpoints,
      result: data.result || null,
      lastUpdated: Date.now(),
      // Timing fields
      lastHeartbeatAt: data.lastHeartbeatAt || null,
      heartbeatAgeMs: data.heartbeatAgeMs || null,
      isHeartbeatStale: data.isHeartbeatStale || false,
      startedAt: data.startedAt || null,
      createdAt: data.createdAt || null,
      completedAt: data.completedAt || null,
      totalPages: data.totalPages || 0,
      attemptCount: data.attemptCount || 0,
      timeoutSource: data.error?.where || null,
    };
  } catch (e) {
    return { fetchError: e instanceof Error ? e.message : 'Network error' };
  }
}

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

export async function fetchActiveJob(): Promise<AnalysisJob | null> {
  const { data: authData } = await supabase.auth.getSession();
  
  if (!authData.session?.user?.id) {
    return null;
  }

  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('analysis_jobs')
      .select('*')
      .eq('user_id', authData.session.user.id)
      .in('status', ['QUEUED', 'RUNNING'])
      .gte('updated_at', oneHourAgo)
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

export function isJobStale(state: JobState): boolean {
  if (!['QUEUED', 'RUNNING'].includes(state.status)) {
    return false;
  }
  return Date.now() - state.lastUpdated > WATCHDOG_THRESHOLD_MS;
}

export function isPollExpired(pollStartTime: number): boolean {
  return Date.now() - pollStartTime > MAX_POLL_DURATION_MS;
}

export function getPollInterval(): number {
  return POLL_INTERVAL_MS;
}

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

export function parseJobResultAccounts(resultData: any): any[] {
  if (!resultData) return [];
  
  if (Array.isArray(resultData.accounts)) {
    return resultData.accounts;
  }
  
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
