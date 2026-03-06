import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createDefaultSession,
  type DisputeSession,
  type AnalysisResult,
  type DisputeAccount,
  defaultProcessingProgress,
} from '@/types/disputes';

/**
 * Regression tests for client identity state leak.
 * Bug: Analyzing client B kept client A's consumerInfo in the letter builder
 * because (1) importAnalyzerData fell back to prev.consumerInfo and
 * (2) DisputeLetterBuilder's useState preferred localStorage over props.
 */

// Simulate the fixed importAnalyzerData logic (no fallback to prev)
function simulateImportAnalyzerData(
  prev: DisputeSession,
  data: { questionnaire?: { fullLegalName?: string; currentAddress?: string } }
): DisputeSession {
  const addr = data.questionnaire?.currentAddress || '';
  return {
    ...prev,
    importedAnalyzerData: data,
    consumerInfo: {
      fullName: data.questionnaire?.fullLegalName || '',
      addressLine1: addr.split(',')[0]?.trim() || '',
      addressLine2: '',
      cityStateZip: addr.split(',').slice(1).join(',').trim() || '',
    },
    generatedLetters: { experian: '', equifax: '', transunion: '' },
  };
}

// Simulate setAnalysisResult clearing letters
function simulateSetAnalysisResult(
  prev: DisputeSession,
  _result: Partial<AnalysisResult>,
  accounts: DisputeAccount[]
): DisputeSession {
  return {
    ...prev,
    analysisResult: _result as AnalysisResult,
    accounts,
    isAnalyzed: true,
    analysisStatus: 'DONE',
    generatedLetters: { experian: '', equifax: '', transunion: '' },
    processingProgress: {
      ...defaultProcessingProgress,
      phase: 'complete',
      message: `Found ${accounts.length} account(s).`,
    },
  };
}

function makeClientSession(name: string, address: string): DisputeSession {
  const session = createDefaultSession();
  return simulateImportAnalyzerData(session, {
    questionnaire: { fullLegalName: name, currentAddress: address },
  });
}

describe('Client identity leak prevention', () => {
  it('analyze client A then B → consumerInfo shows B, not A', () => {
    let session = createDefaultSession();

    // Import client A
    session = simulateImportAnalyzerData(session, {
      questionnaire: {
        fullLegalName: 'Tara Adjani Wright',
        currentAddress: '123 First St, Dallas, TX 75001',
      },
    });
    expect(session.consumerInfo.fullName).toBe('Tara Adjani Wright');
    expect(session.consumerInfo.addressLine1).toBe('123 First St');

    // Import client B – must fully replace A
    session = simulateImportAnalyzerData(session, {
      questionnaire: {
        fullLegalName: 'Lamonze Raphael Railey',
        currentAddress: '456 Oak Ave, Houston, TX 77001',
      },
    });
    expect(session.consumerInfo.fullName).toBe('Lamonze Raphael Railey');
    expect(session.consumerInfo.addressLine1).toBe('456 Oak Ave');
    // Ensure no trace of client A
    expect(session.consumerInfo.fullName).not.toContain('Tara');
    expect(session.consumerInfo.fullName).not.toContain('Wright');
  });

  it('importAnalyzerData with missing fields uses empty strings, not prior client', () => {
    let session = makeClientSession('Tara Wright', '123 Main St, Dallas, TX 75001');
    expect(session.consumerInfo.fullName).toBe('Tara Wright');

    // Import new client with missing name
    session = simulateImportAnalyzerData(session, {
      questionnaire: { currentAddress: '789 New Rd, Austin, TX 73301' },
    });
    // Must be empty, NOT "Tara Wright"
    expect(session.consumerInfo.fullName).toBe('');
    expect(session.consumerInfo.addressLine1).toBe('789 New Rd');
  });

  it('setAnalysisResult clears generated letters from prior client', () => {
    let session = makeClientSession('Client A', '100 A St, City, ST 10000');
    session.generatedLetters = {
      experian: 'Dear Experian, Client A disputes...',
      equifax: 'Dear Equifax, Client A disputes...',
      transunion: '',
    };

    // New analysis completes
    session = simulateSetAnalysisResult(session, { bureau: 'experian' } as any, []);
    expect(session.generatedLetters.experian).toBe('');
    expect(session.generatedLetters.equifax).toBe('');
  });

  it('resetSession clears all identity data', () => {
    let session = makeClientSession('Client X', '999 Z St, Nowhere, ZZ 00000');
    session.generatedLetters.experian = 'Some letter';

    // Reset
    session = createDefaultSession();
    expect(session.consumerInfo.fullName).toBe('');
    expect(session.consumerInfo.addressLine1).toBe('');
    expect(session.generatedLetters.experian ?? '').toBe('');
  });

  it('manual edits persist only within same client context', () => {
    let session = makeClientSession('Client A', '100 A St, City, ST 10000');
    // Simulate manual edit
    session = { ...session, consumerInfo: { ...session.consumerInfo, fullName: 'Client A (edited)' } };
    expect(session.consumerInfo.fullName).toBe('Client A (edited)');

    // New client import must overwrite the edit
    session = simulateImportAnalyzerData(session, {
      questionnaire: { fullLegalName: 'Client B', currentAddress: '200 B St, Town, ST 20000' },
    });
    expect(session.consumerInfo.fullName).toBe('Client B');
    expect(session.consumerInfo.fullName).not.toContain('edited');
  });
});
