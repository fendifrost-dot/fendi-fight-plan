/**
 * Single-source-of-truth module for analysis job lifecycle management.
 * 
 * ALL job logic (start, poll, resume, finalize) MUST live here.
 * Components should ONLY use hooks that wrap this module.
 */

import { supabase } from '@/integrations/supabase/client';
import { hydrateCanonicalResult, type CanonicalAnalyzerResult } from '@/types/disputes';

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
  collections?: any[];
  inquiries?: any[];
  publicRecords?: any[];
  chargeOffs?: any[];
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

/** Contract version for traceability */
export const PARSER_CONTRACT_VERSION = 'v2-canonical';

// ============= TIMEOUT CLASSIFICATION =============

export function classifyTimeout(state: JobState, pollStartTime: number): TimeoutSource {
  if (state.error?.where) {
    return state.error.where as TimeoutSource;
  }
  if (state.isHeartbeatStale && state.lastHeartbeatAt) {
    return 'edge_fn';
  }
  if (!state.startedAt && state.status === 'QUEUED') {
    return 'edge_fn';
  }
  if (isPollExpired(pollStartTime) && !state.isHeartbeatStale) {
    return 'client_wait';
  }
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

/**
 * @deprecated Use parseJobResult() for full canonical result hydration.
 * Kept only for backward compatibility in tests.
 */
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

/**
 * Parse a raw job result_data into the full canonical analyzer result.
 * This is the ONE canonical hydration path for async job results.
 * Frontend MUST NOT rebuild or reinterpret beyond this function.
 */
export function parseJobResult(resultData: any): CanonicalAnalyzerResult {
  return hydrateCanonicalResult(resultData);
}

/**
 * Extract canonical result from checkpoint data when full result is not yet available.
 * Used for partial recovery — preserves all entity arrays if present.
 */
export function parseCheckpointResult(checkpoints: JobCheckpoints | null): CanonicalAnalyzerResult | null {
  if (!checkpoints) return null;
  
  const hasData = (checkpoints.accounts?.length || 0) > 0 ||
    (checkpoints.collections?.length || 0) > 0 ||
    (checkpoints.inquiries?.length || 0) > 0 ||
    (checkpoints.publicRecords?.length || 0) > 0 ||
    (checkpoints.chargeOffs?.length || 0) > 0;
  
  if (!hasData) return null;
  
  return hydrateCanonicalResult({
    derogatory_accounts: checkpoints.accounts || [],
    collections: checkpoints.collections || [],
    charge_offs: checkpoints.chargeOffs || [],
    inquiries: checkpoints.inquiries || [],
    public_records: checkpoints.publicRecords || [],
  });
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
  
  if (result) {
    const canonical = parseJobResult(result);
    accountCount = canonical.derogatory_accounts.length + canonical.collections.length + canonical.charge_offs.length;
  } else if (checkpoints) {
    const partial = parseCheckpointResult(checkpoints);
    if (partial) {
      accountCount = partial.derogatory_accounts.length + partial.collections.length + partial.charge_offs.length;
      hasPartialData = true;
    }
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
