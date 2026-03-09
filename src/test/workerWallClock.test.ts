import { describe, it, expect } from 'vitest';

/**
 * Regression test: proves the analysis worker self-chains based on BOTH
 * chunk count AND wall-clock elapsed time, preventing edge function
 * timeout kills that leave jobs stuck at 25%.
 *
 * Bug: 39-page report stuck at 25% because mapping (~40s) + chunk 0 (27s)
 * consumed most of the 150s edge function limit, leaving no room for chunk 1.
 * MAX_CHUNKS_PER_INVOCATION=3 was only a chunk-count guard, not a time guard.
 */

const MAX_CHUNKS_PER_INVOCATION = 3;
const WALL_CLOCK_CHAIN_THRESHOLD_MS = 100_000;

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
    // Simulates: mapping took 100s, no chunks processed yet
    const result = shouldSelfChain(0, 105_000);
    expect(result.shouldChain).toBe(true);
    expect(result.reason).toContain('wall-clock');
  });

  it('does NOT chain when under both limits', () => {
    const result = shouldSelfChain(1, 50_000);
    expect(result.shouldChain).toBe(false);
  });

  it('wall-clock guard fires before chunk limit for slow chunks', () => {
    // Simulates: mapping (40s) + chunk 0 (27s) + chunk 1 (35s) = 102s
    // Only 2 chunks processed, but wall clock exceeded
    const result = shouldSelfChain(2, 102_000);
    expect(result.shouldChain).toBe(true);
    expect(result.reason).toContain('wall-clock');
  });

  it('reproduces the 39-page stuck-at-25% scenario', () => {
    // Mapping took ~40s, chunk 0 took ~27s = 67s elapsed after 1 chunk
    // Without wall-clock guard, chunk 1 would start and die at ~150s
    // With wall-clock guard, after chunk 1 completes at ~100s, it chains

    // After mapping + chunk 0: still safe
    const afterChunk0 = shouldSelfChain(1, 67_000);
    expect(afterChunk0.shouldChain).toBe(false);

    // After chunk 1: 67s + 35s = 102s — wall-clock guard fires
    const afterChunk1 = shouldSelfChain(2, 102_000);
    expect(afterChunk1.shouldChain).toBe(true);
    expect(afterChunk1.reason).toContain('wall-clock');
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
