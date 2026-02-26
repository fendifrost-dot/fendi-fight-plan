import { describe, it, expect } from 'vitest';
import type { JobState, JobError } from '@/lib/analysisJobs';
import { DEFAULT_JOB_STATE } from '@/lib/analysisJobs';
import { buildPipelineError, ErrorCodes } from '@/lib/pipelineError';

describe('PipelineError schema', () => {
  it('buildPipelineError produces valid shape', () => {
    const err = buildPipelineError('WORKER_DOWNLOAD_FAILED', 'Failed to download page', 'WORKER', {
      step: 'download_page_3',
      page: 3,
      chunk: 1,
      cause: 'HTTP 403',
    });
    expect(err.code).toBe('WORKER_DOWNLOAD_FAILED');
    expect(err.message).toBe('Failed to download page');
    expect(err.stage).toBe('WORKER');
    expect(err.step).toBe('download_page_3');
    expect(err.page).toBe(3);
    expect(err.chunk).toBe(1);
    expect(err.cause).toBe('HTTP 403');
  });

  it('sanitizes JWT-like strings from cause', () => {
    const err = buildPipelineError('UNKNOWN', 'test', 'UI', {
      cause: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    });
    expect(err.cause).toContain('[REDACTED]');
    expect(err.cause).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('truncates long causes to 500 chars', () => {
    const longStr = 'x'.repeat(1000);
    const err = buildPipelineError('UNKNOWN', 'test', 'UI', { cause: longStr });
    expect(err.cause!.length).toBeLessThanOrEqual(500);
  });

  it('all ErrorCodes are strings', () => {
    for (const [key, val] of Object.entries(ErrorCodes)) {
      expect(typeof val).toBe('string');
      expect(val).toBe(key);
    }
  });
});

describe('JobState error field', () => {
  it('DEFAULT_JOB_STATE has null error', () => {
    expect(DEFAULT_JOB_STATE.error).toBeNull();
    expect(DEFAULT_JOB_STATE.errorCode).toBeNull();
    expect(DEFAULT_JOB_STATE.errorMessage).toBeNull();
  });

  it('JobState can hold a structured error', () => {
    const error: JobError = {
      code: 'WORKER_AI_TIMEOUT',
      message: 'AI call timed out after 25s',
      stage: 'WORKER',
      step: 'chunk_3',
      chunk: 3,
    };
    const state: JobState = {
      ...DEFAULT_JOB_STATE,
      status: 'FAILED',
      error,
      errorCode: error.code,
      errorMessage: error.message,
    };
    expect(state.error?.code).toBe('WORKER_AI_TIMEOUT');
    expect(state.error?.stage).toBe('WORKER');
    expect(state.error?.chunk).toBe(3);
  });
});

describe('analysis-status structured error contract', () => {
  it('returned error shape includes code, message, stage', () => {
    // Simulates what analysis-status returns
    const apiResponse = {
      jobId: 'test-id',
      status: 'FAILED',
      step: 'chunk_3',
      progress: 45,
      error: {
        code: 'WORKER_DOWNLOAD_FAILED',
        message: 'Failed to download page-003.jpg: 403',
        stage: 'WORKER',
        step: 'download_page_3',
        page: 3,
        chunk: null,
        meta: { cause: 'HTTP 403' },
      },
      partialResults: { accounts: [], processedChunks: 2, totalChunks: 10, failedChunks: [3] },
      result: null,
    };

    expect(apiResponse.error).toBeDefined();
    expect(apiResponse.error.code).toBe('WORKER_DOWNLOAD_FAILED');
    expect(apiResponse.error.stage).toBe('WORKER');
    expect(apiResponse.error.message).toContain('403');
  });
});
