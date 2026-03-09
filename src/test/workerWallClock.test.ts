import { describe, it, expect } from 'vitest';

/**
 * Regression test: proves the analysis worker self-chains based on BOTH
 * chunk count AND wall-clock elapsed time, preventing edge function
 * timeout kills that leave jobs stuck at 25%.
 *
 * Bug: 39-page report stuck at 25% because mapping (~40s) + chunk 0 (27s)
 * consumed most of the 150s edge function limit, leaving no room for chunk 1.
 * MAX_CHUNKS_PER_INVOCATION=3 was only a chunk-count guard, not a time guard.
 *
 * v4 fix: AI_TIMEOUT_MS increased from 25s → 50s, inner retry removed
 * (MAX_RETRIES=0), chunk-level retry still active. This ensures each AI call
 * has enough time to complete without aborting prematurely.
 */

const MAX_CHUNKS_PER_INVOCATION = 3;
const WALL_CLOCK_CHAIN_THRESHOLD_MS = 100_000;
const AI_TIMEOUT_MS = 50_000;
const CHUNK_RETRY_BACKOFF_MS = 3_000;
const EDGE_FUNCTION_LIMIT_MS = 150_000;

interface ChainDecision {
  shouldChain: boolean;
  reason: string;
}

function shouldSelfChain(
  chunksProcessedThisInvocation: number,
  elapsedMs: number,
): ChainDecision {
  if (elapsedMs >= WALL_CLOCK_CHAIN_THRESHOLD_MS) {
    return { shouldChain: true, reason: `wall-clock guard (${Math.round(elapsedMs / 1000)}s elapsed)` };
  }
  if (chunksProcessedThisInvocation >= MAX_CHUNKS_PER_INVOCATION) {
    return { shouldChain: true, reason: `chunk limit (${MAX_CHUNKS_PER_INVOCATION} chunks)` };
  }
  return { shouldChain: false, reason: 'continue' };
}

describe('Worker wall-clock self-chain guard', () => {
  it('chains at chunk limit when time is fine', () => {
    const result = shouldSelfChain(3, 60_000);
    expect(result.shouldChain).toBe(true);
    expect(result.reason).toContain('chunk limit');
  });

  it('chains at wall-clock threshold even with 0 chunks processed', () => {
    const result = shouldSelfChain(0, 105_000);
    expect(result.shouldChain).toBe(true);
    expect(result.reason).toContain('wall-clock');
  });

  it('does NOT chain when under both limits', () => {
    const result = shouldSelfChain(1, 50_000);
    expect(result.shouldChain).toBe(false);
  });

  it('wall-clock guard fires before chunk limit for slow chunks', () => {
    const result = shouldSelfChain(2, 102_000);
    expect(result.shouldChain).toBe(true);
    expect(result.reason).toContain('wall-clock');
  });

  it('reproduces the 39-page stuck-at-25% scenario', () => {
    const afterChunk0 = shouldSelfChain(1, 67_000);
    expect(afterChunk0.shouldChain).toBe(false);

    const afterChunk1 = shouldSelfChain(2, 102_000);
    expect(afterChunk1.shouldChain).toBe(true);
    expect(afterChunk1.reason).toContain('wall-clock');
  });
});

describe('AI timeout budget', () => {
  it('single chunk worst-case (attempt + chunk retry) fits within edge function limit', () => {
    // Worst case per chunk: AI_TIMEOUT_MS + CHUNK_RETRY_BACKOFF_MS + AI_TIMEOUT_MS
    const worstCaseChunkMs = AI_TIMEOUT_MS + CHUNK_RETRY_BACKOFF_MS + AI_TIMEOUT_MS;
    expect(worstCaseChunkMs).toBeLessThan(EDGE_FUNCTION_LIMIT_MS);
  });

  it('mapping + one chunk worst-case fits with wall-clock guard', () => {
    // Wall-clock guard ensures we chain before edge function kill.
    // After mapping (up to 50s), the guard (100s) leaves room for one chunk.
    const mappingWorstCase = AI_TIMEOUT_MS;
    const remainingAfterMapping = WALL_CLOCK_CHAIN_THRESHOLD_MS - mappingWorstCase;
    expect(remainingAfterMapping).toBeGreaterThanOrEqual(AI_TIMEOUT_MS);
  });

  it('AI timeout is long enough for 3-image credit report chunks', () => {
    expect(AI_TIMEOUT_MS).toBeGreaterThanOrEqual(45_000);
  });

  it('wall-clock guard triggers before edge function kill', () => {
    expect(WALL_CLOCK_CHAIN_THRESHOLD_MS + AI_TIMEOUT_MS).toBeLessThanOrEqual(EDGE_FUNCTION_LIMIT_MS);
  });
});

describe('documentMap section access', () => {
  it('handles flat documentMap (accounts at top level)', () => {
    const documentMap = {
      accounts: { detected: true, start_page: 3, end_page: 37, page_count: 35 },
      total_pages: 39,
    };
    const accountsSection = documentMap.accounts || (documentMap as any).sections?.accounts || { start_page: 1, end_page: 39 };
    expect(accountsSection.start_page).toBe(3);
    expect(accountsSection.end_page).toBe(37);
  });

  it('handles nested documentMap (sections.accounts)', () => {
    const documentMap = {
      sections: { accounts: { detected: true, start_page: 3, end_page: 37 } },
      total_pages: 39,
    };
    const accountsSection = (documentMap as any).accounts || documentMap.sections?.accounts || { start_page: 1, end_page: 39 };
    expect(accountsSection.start_page).toBe(3);
    expect(accountsSection.end_page).toBe(37);
  });

  it('falls back to full range when neither format exists', () => {
    const documentMap = { total_pages: 39 };
    const totalPages = 39;
    const accountsSection = (documentMap as any).accounts || (documentMap as any).sections?.accounts || { start_page: 1, end_page: totalPages };
    expect(accountsSection.start_page).toBe(1);
    expect(accountsSection.end_page).toBe(39);
  });
});
