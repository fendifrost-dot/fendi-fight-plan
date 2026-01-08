import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Document map from Phase 1
interface DocumentSection {
  detected: boolean;
  start_page: number | null;
  end_page: number | null;
  page_count: number;
}

interface DocumentMap {
  is_multi_bureau: boolean;
  detected_bureaus: string[];
  report_type: string;
  total_pages: number;
  sections: {
    personal_info: DocumentSection;
    accounts: DocumentSection;
    inquiries: DocumentSection;
    payment_history: DocumentSection;
    public_records: DocumentSection;
    summary: DocumentSection;
  };
}

// Analysis progress state
export interface AnalysisProgress {
  phase: 'idle' | 'mapping' | 'analyzing' | 'complete' | 'error';
  currentSection: string | null;
  currentChunk: number;
  totalChunks: number;
  sectionsComplete: string[];
  sectionsFailed: string[];
  message: string;
  canSkipPaymentHistory: boolean;
}

// Result accumulator
interface ChunkedResult {
  inaccurate_names: any[];
  inaccurate_addresses: any[];
  inaccurate_employers: any[];
  extra_identifier_mismatches: any[];
  derogatory_accounts: any[];
  late_payment_summary: any[];
  collections: any[];
  charge_offs: any[];
  public_records: any[];
  inquiries: any[];
  is_multi_bureau_report?: boolean;
  detected_bureaus?: string[];
}

const CHUNK_SIZE = 3; // Max pages per chunk
const SECTIONS_ORDER = ['personal_info', 'accounts', 'inquiries', 'payment_history', 'public_records'];

export function useChunkedAnalysis() {
  const [progress, setProgress] = useState<AnalysisProgress>({
    phase: 'idle',
    currentSection: null,
    currentChunk: 0,
    totalChunks: 0,
    sectionsComplete: [],
    sectionsFailed: [],
    message: '',
    canSkipPaymentHistory: false,
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const skipPaymentHistoryRef = useRef(false);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    skipPaymentHistoryRef.current = false;
    setProgress({
      phase: 'idle',
      currentSection: null,
      currentChunk: 0,
      totalChunks: 0,
      sectionsComplete: [],
      sectionsFailed: [],
      message: '',
      canSkipPaymentHistory: false,
    });
  }, []);

  const skipPaymentHistory = useCallback(() => {
    skipPaymentHistoryRef.current = true;
  }, []);

  const analyzeChunked = useCallback(async (
    images: string[],
    questionnaire: {
      fullLegalName: string;
      currentAddress: string;
      currentEmployer: string;
      dateOfBirth?: string;
      phoneNumber?: string;
      email?: string;
      ssnLast4?: string;
    },
    accessToken: string
  ): Promise<{ result: ChunkedResult; documentMap: DocumentMap } | null> => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // PHASE 1: Map document structure
      setProgress(p => ({
        ...p,
        phase: 'mapping',
        message: 'Mapping document structure...',
      }));

      const mapResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/map-document`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ images }),
          signal,
        }
      );

      if (!mapResponse.ok) {
        const err = await mapResponse.json();
        throw new Error(err.error || 'Failed to map document');
      }

      const documentMap: DocumentMap = await mapResponse.json();
      console.log('Document map:', documentMap);

      // PHASE 2: Analyze sections in chunks
      const result: ChunkedResult = {
        inaccurate_names: [],
        inaccurate_addresses: [],
        inaccurate_employers: [],
        extra_identifier_mismatches: [],
        derogatory_accounts: [],
        late_payment_summary: [],
        collections: [],
        charge_offs: [],
        public_records: [],
        inquiries: [],
        is_multi_bureau_report: documentMap.is_multi_bureau,
        detected_bureaus: documentMap.detected_bureaus,
      };

      // Calculate total chunks across all sections
      let totalChunks = 0;
      const sectionChunks: { section: string; chunks: string[][] }[] = [];

      for (const sectionName of SECTIONS_ORDER) {
        const section = documentMap.sections[sectionName as keyof typeof documentMap.sections];
        if (!section?.detected || section.start_page === null || section.end_page === null) {
          continue;
        }

        // Get page images for this section (0-indexed)
        const startIdx = section.start_page - 1;
        const endIdx = section.end_page; // end_page is inclusive, slice is exclusive
        const sectionImages = images.slice(startIdx, endIdx);

        // Split into chunks
        const chunks: string[][] = [];
        for (let i = 0; i < sectionImages.length; i += CHUNK_SIZE) {
          chunks.push(sectionImages.slice(i, i + CHUNK_SIZE));
        }

        if (chunks.length > 0) {
          sectionChunks.push({ section: sectionName, chunks });
          totalChunks += chunks.length;
        }
      }

      setProgress(p => ({
        ...p,
        phase: 'analyzing',
        totalChunks,
        message: 'Starting section analysis...',
      }));

      let chunksProcessed = 0;
      const sectionsComplete: string[] = [];
      const sectionsFailed: string[] = [];

      // Process each section
      for (const { section: sectionName, chunks } of sectionChunks) {
        // Check if we should skip payment history
        if (sectionName === 'payment_history' && skipPaymentHistoryRef.current) {
          console.log('Skipping payment history per user request');
          chunksProcessed += chunks.length;
          sectionsComplete.push(sectionName);
          continue;
        }

        // Show skip option for payment_history
        const canSkip = sectionName === 'payment_history';

        setProgress(p => ({
          ...p,
          currentSection: sectionName,
          currentChunk: chunksProcessed,
          sectionsComplete: [...sectionsComplete],
          message: `Analyzing ${sectionName.replace('_', ' ')}...`,
          canSkipPaymentHistory: canSkip,
        }));

        let sectionFailed = false;

        // Process chunks for this section
        for (let i = 0; i < chunks.length; i++) {
          // Check abort
          if (signal.aborted) {
            throw new Error('Analysis cancelled');
          }

          // Check skip (payment history only)
          if (sectionName === 'payment_history' && skipPaymentHistoryRef.current) {
            console.log('Skipping remaining payment history chunks');
            chunksProcessed += (chunks.length - i);
            break;
          }

          setProgress(p => ({
            ...p,
            currentChunk: chunksProcessed + 1,
            message: `Analyzing ${sectionName.replace('_', ' ')} (${i + 1}/${chunks.length})...`,
          }));

          try {
            const chunkResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-chunk`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                  section: sectionName,
                  images: chunks[i],
                  questionnaire,
                  chunkIndex: i,
                  totalChunks: chunks.length,
                }),
                signal,
              }
            );

            if (!chunkResponse.ok) {
              const err = await chunkResponse.json();
              console.error(`Chunk failed: ${sectionName} ${i + 1}/${chunks.length}`, err);
              sectionFailed = true;
              chunksProcessed++;
              continue; // Continue with next chunk
            }

            const chunkResult = await chunkResponse.json();
            
            // Merge chunk results into accumulator
            mergeChunkResult(result, chunkResult);
            chunksProcessed++;
          } catch (err) {
            if ((err as Error).name === 'AbortError') {
              throw new Error('Analysis cancelled');
            }
            console.error(`Chunk error: ${sectionName} ${i + 1}/${chunks.length}`, err);
            sectionFailed = true;
            chunksProcessed++;
          }
        }

        if (sectionFailed) {
          sectionsFailed.push(sectionName);
        } else {
          sectionsComplete.push(sectionName);
        }
      }

      setProgress({
        phase: 'complete',
        currentSection: null,
        currentChunk: totalChunks,
        totalChunks,
        sectionsComplete,
        sectionsFailed,
        message: sectionsFailed.length > 0 
          ? `Analysis complete with ${sectionsFailed.length} section(s) having issues`
          : 'Analysis complete',
        canSkipPaymentHistory: false,
      });

      return { result, documentMap };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      setProgress(p => ({
        ...p,
        phase: 'error',
        message,
      }));
      return null;
    }
  }, []);

  const retrySection = useCallback(async (
    sectionName: string,
    images: string[],
    documentMap: DocumentMap,
    questionnaire: any,
    accessToken: string
  ): Promise<any | null> => {
    const section = documentMap.sections[sectionName as keyof typeof documentMap.sections];
    if (!section?.detected || section.start_page === null) {
      return null;
    }

    setProgress(p => ({
      ...p,
      phase: 'analyzing',
      currentSection: sectionName,
      message: `Retrying ${sectionName.replace('_', ' ')}...`,
      sectionsFailed: p.sectionsFailed.filter(s => s !== sectionName),
    }));

    const startIdx = section.start_page - 1;
    const endIdx = section.end_page!;
    const sectionImages = images.slice(startIdx, endIdx);

    const chunks: string[][] = [];
    for (let i = 0; i < sectionImages.length; i += CHUNK_SIZE) {
      chunks.push(sectionImages.slice(i, i + CHUNK_SIZE));
    }

    const sectionResult: any = {};

    for (let i = 0; i < chunks.length; i++) {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-chunk`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              section: sectionName,
              images: chunks[i],
              questionnaire,
              chunkIndex: i,
              totalChunks: chunks.length,
            }),
          }
        );

        if (response.ok) {
          const chunkResult = await response.json();
          mergeChunkResult(sectionResult, chunkResult);
        }
      } catch (err) {
        console.error(`Retry chunk error: ${sectionName} ${i + 1}`, err);
      }
    }

    setProgress(p => ({
      ...p,
      phase: 'complete',
      currentSection: null,
      sectionsComplete: [...p.sectionsComplete, sectionName],
      message: 'Retry complete',
    }));

    return sectionResult;
  }, []);

  return {
    progress,
    analyzeChunked,
    skipPaymentHistory,
    retrySection,
    reset,
  };
}

// Helper to merge chunk results into accumulator
function mergeChunkResult(target: any, chunk: any) {
  const arrayFields = [
    'inaccurate_names',
    'inaccurate_addresses', 
    'inaccurate_employers',
    'extra_identifier_mismatches',
    'derogatory_accounts',
    'collections',
    'charge_offs',
    'public_records',
    'inquiries',
  ];

  for (const field of arrayFields) {
    if (Array.isArray(chunk[field])) {
      if (!target[field]) target[field] = [];
      target[field].push(...chunk[field]);
    }
  }

  // Special handling for late_payment_summary (merge by severity)
  if (Array.isArray(chunk.late_payment_summary)) {
    if (!target.late_payment_summary) target.late_payment_summary = [];
    for (const severity of chunk.late_payment_summary) {
      let existing = target.late_payment_summary.find((s: any) => s.severity === severity.severity);
      if (!existing) {
        existing = { severity: severity.severity, accounts: [] };
        target.late_payment_summary.push(existing);
      }
      if (Array.isArray(severity.accounts)) {
        existing.accounts.push(...severity.accounts);
      }
    }
  }
}
