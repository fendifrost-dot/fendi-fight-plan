import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { pdfToImages } from '@/lib/pdf-utils';
import type {
  DisputeAccount,
  AnalysisResult,
  ProcessingProgress,
  UploadedDocument,
  BureauKey,
} from '@/types/disputes';
import { defaultProcessingProgress } from '@/types/disputes';

const MAX_IMAGES_PER_CHUNK = 3;
const CONCURRENT_REQUESTS = 2;

async function safeReadJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    try {
      const text = await res.text();
      return { error: text || res.statusText || 'Request failed' };
    } catch {
      return { error: res.statusText || 'Request failed' };
    }
  }
}

function getErrorMessage(payload: any): string | null {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  return payload.error || payload.message || payload.details || null;
}


interface DocumentMap {
  is_multi_bureau: boolean;
  detected_bureaus: string[];
  report_type: string;
  total_pages: number;
  sections: {
    personal_info: { detected: boolean; start_page: number | null; end_page: number | null; page_count: number };
    accounts: { detected: boolean; start_page: number | null; end_page: number | null; page_count: number };
    inquiries: { detected: boolean; start_page: number | null; end_page: number | null; page_count: number };
    payment_history: { detected: boolean; start_page: number | null; end_page: number | null; page_count: number };
    public_records: { detected: boolean; start_page: number | null; end_page: number | null; page_count: number };
    summary: { detected: boolean; start_page: number | null; end_page: number | null; page_count: number };
  };
}

interface ChunkResult {
  derogatory_accounts?: any[];
  collections?: any[];
  charge_offs?: any[];
  inquiries?: any[];
  public_records?: any[];
  inaccurate_names?: any[];
  inaccurate_addresses?: any[];
}

interface UseDisputeAnalysisReturn {
  progress: ProcessingProgress;
  isProcessing: boolean;
  
  // Main analysis function
  analyzeDocuments: (
    documents: UploadedDocument[],
    bureauResponseText: string,
    priorLetterText: string,
    accessToken: string
  ) => Promise<{ result: AnalysisResult; accounts: DisputeAccount[] } | null>;
  
  // Retry specific chunk
  retryChunk: (chunkIndex: number) => Promise<void>;
  
  // Skip remaining chunks
  skipRemaining: () => void;
  
  // Reset
  reset: () => void;
}

export function useDisputeAnalysis(): UseDisputeAnalysisReturn {
  const [progress, setProgress] = useState<ProcessingProgress>(defaultProcessingProgress);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const abortRef = useRef(false);
  const imagesRef = useRef<string[]>([]);
  const accessTokenRef = useRef<string>('');

  const reset = useCallback(() => {
    abortRef.current = false;
    imagesRef.current = [];
    setProgress(defaultProcessingProgress);
    setIsProcessing(false);
  }, []);

  const skipRemaining = useCallback(() => {
    abortRef.current = true;
  }, []);

  const analyzeDocuments = useCallback(async (
    documents: UploadedDocument[],
    bureauResponseText: string,
    priorLetterText: string,
    accessToken: string
  ): Promise<{ result: AnalysisResult; accounts: DisputeAccount[] } | null> => {
    abortRef.current = false;
    accessTokenRef.current = accessToken;
    setIsProcessing(true);

    try {
      // Phase 1: Extract images from PDFs
      setProgress({
        ...defaultProcessingProgress,
        phase: 'ingesting',
        currentStep: 'Extracting pages from documents...',
        message: 'Preparing documents for analysis...',
      });

      const allImages: string[] = [];
      const bureauDocs = documents.filter(d => d.type === 'bureau_response');

      // If the UI rehydrated from localStorage after a refresh/hot reload, the File objects
      // will be missing (they are not serializable). Detect this early with a clear message.
      const hasBureauFiles = bureauDocs.some(d => !!d.file);

      for (const doc of bureauDocs) {
        if (doc.file && doc.file.type === 'application/pdf') {
          try {
            const { images } = await pdfToImages(doc.file);
            allImages.push(...images);
          } catch (e) {
            console.error(`Failed to extract images from ${doc.name}:`, e);
          }
        } else if (doc.file && doc.file.type.startsWith('image/')) {
          // Convert image file to data URL
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(doc.file!);
          });
          allImages.push(dataUrl);
        }
      }

      imagesRef.current = allImages;

      // If we have images, use the chunked vision pipeline
      if (allImages.length > 0) {
        return await analyzeWithChunkedVision(allImages, priorLetterText, accessToken);
      }

      // Fall back to text-based classification if no images
      if (bureauResponseText.trim()) {
        return await analyzeWithTextClassification(bureauResponseText, priorLetterText, accessToken);
      }

      // Clear guidance for the common "files present but File objects missing" scenario
      if (bureauDocs.length > 0 && !hasBureauFiles) {
        throw new Error(
          'Your Bureau Response upload needs to be re-added. For security reasons, your browser can’t restore the actual file after a refresh/hot reload. Remove the Bureau Response item(s) and upload again (or paste the response text).'
        );
      }

      // Check if only prior dispute docs were uploaded (common user error)
      const hasPriorDisputeOnly = documents.some(d => d.type === 'prior_dispute') && bureauDocs.length === 0;
      if (hasPriorDisputeOnly) {
        throw new Error('Please upload the Bureau Response (PDF/image of the credit bureau\'s reply letter) — not just your prior dispute letter.');
      }

      throw new Error('Please upload a Bureau Response document (PDF or image) or paste the response text to analyze.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed';
      setProgress(prev => ({
        ...prev,
        phase: 'error',
        message,
      }));
      toast.error(message);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const analyzeWithChunkedVision = async (
    images: string[],
    priorLetterText: string,
    accessToken: string
  ): Promise<{ result: AnalysisResult; accounts: DisputeAccount[] }> => {
    // Phase 2: Map document structure
    setProgress({
      phase: 'classifying',
      currentStep: 'Mapping document structure...',
      totalSteps: 2,
      completedSteps: 0,
      failedChunks: [],
      message: 'Identifying sections in your document...',
    });

    const mapResponse = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/map-document`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ images }),
      }
    );

    if (!mapResponse.ok) {
      const err = await safeReadJson(mapResponse);
      const msg = getErrorMessage(err);
      if (mapResponse.status === 429) throw new Error('Rate limit exceeded. Please wait a moment.');
      if (mapResponse.status === 402) throw new Error('Usage limit reached. Please add credits.');
      throw new Error(msg || 'Failed to map document');
    }

    const documentMap: DocumentMap = await mapResponse.json();
    console.log('Document map:', documentMap);

    // Phase 3: Analyze accounts section in chunks
    setProgress({
      phase: 'analyzing',
      currentStep: 'Analyzing accounts...',
      totalSteps: 0,
      completedSteps: 0,
      failedChunks: [],
      message: 'Extracting account information...',
    });

    // Focus on accounts section for disputes
    const accountsSection = documentMap.sections.accounts;
    const allAccounts: any[] = [];
    const failedChunks: number[] = [];

    if (accountsSection.detected && accountsSection.start_page && accountsSection.end_page) {
      const startIdx = accountsSection.start_page - 1;
      const endIdx = accountsSection.end_page;
      const sectionImages = images.slice(startIdx, endIdx);

      // Split into chunks
      const chunks: string[][] = [];
      for (let i = 0; i < sectionImages.length; i += MAX_IMAGES_PER_CHUNK) {
        chunks.push(sectionImages.slice(i, i + MAX_IMAGES_PER_CHUNK));
      }

      setProgress(prev => ({
        ...prev,
        totalSteps: chunks.length,
      }));

      // Process chunks with limited concurrency
      for (let i = 0; i < chunks.length; i += CONCURRENT_REQUESTS) {
        if (abortRef.current) break;

        const batch = chunks.slice(i, i + CONCURRENT_REQUESTS);
        const batchPromises = batch.map((chunk, batchIdx) => 
          processChunk('accounts', chunk, i + batchIdx, chunks.length, accessToken)
        );

        const results = await Promise.allSettled(batchPromises);

        results.forEach((result, batchIdx) => {
          const chunkIdx = i + batchIdx;
          if (result.status === 'fulfilled' && result.value) {
            const data = result.value;
            if (data.derogatory_accounts) allAccounts.push(...data.derogatory_accounts);
            if (data.collections) allAccounts.push(...data.collections.map((c: any) => ({ ...c, isCollection: true })));
            if (data.charge_offs) allAccounts.push(...data.charge_offs.map((c: any) => ({ ...c, isChargeOff: true })));
          } else {
            failedChunks.push(chunkIdx);
          }
          
          setProgress(prev => ({
            ...prev,
            completedSteps: prev.completedSteps + 1,
            failedChunks: failedChunks.map(String),
            message: `Processed ${prev.completedSteps + 1} of ${chunks.length} chunks...`,
          }));
        });

        // Small delay between batches to avoid rate limits
        if (i + CONCURRENT_REQUESTS < chunks.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } else {
      // No accounts section detected - process all pages
      const chunks: string[][] = [];
      for (let i = 0; i < images.length; i += MAX_IMAGES_PER_CHUNK) {
        chunks.push(images.slice(i, i + MAX_IMAGES_PER_CHUNK));
      }

      setProgress(prev => ({
        ...prev,
        totalSteps: chunks.length,
        message: 'Processing all pages...',
      }));

      for (let i = 0; i < chunks.length && !abortRef.current; i++) {
        try {
          const result = await processChunk('accounts', chunks[i], i, chunks.length, accessToken);
          if (result) {
            if (result.derogatory_accounts) allAccounts.push(...result.derogatory_accounts);
            if (result.collections) allAccounts.push(...result.collections);
            if (result.charge_offs) allAccounts.push(...result.charge_offs);
          }
        } catch (e) {
          failedChunks.push(i);
        }
        
        setProgress(prev => ({
          ...prev,
          completedSteps: i + 1,
          failedChunks: failedChunks.map(String),
        }));
      }
    }

    // Phase 4: Normalize and deduplicate accounts
    setProgress({
      phase: 'normalizing',
      currentStep: 'Normalizing results...',
      totalSteps: 1,
      completedSteps: 0,
      failedChunks: failedChunks.map(String),
      message: 'Consolidating account data...',
    });

    const accounts = normalizeAccounts(allAccounts, documentMap);
    const bureauMode = documentMap.is_multi_bureau ? 'multi-bureau' : 
      (documentMap.detected_bureaus[0] as BureauKey) || 'experian';

    const result: AnalysisResult = {
      bureau: bureauMode,
      outcome: 'verified',
      itemsVerified: [],
      itemsDeleted: [],
      itemsPartial: [],
      legalImplications: [],
      nextSteps: [
        'Review extracted accounts for accuracy',
        'Select items you wish to dispute',
        'Complete the legal strategy survey',
        'Generate your dispute letters',
      ],
      rawSummary: `Analyzed ${images.length} pages. Found ${accounts.length} accounts.`,
      accounts,
    };

    setProgress({
      phase: 'complete',
      currentStep: '',
      totalSteps: 1,
      completedSteps: 1,
      failedChunks: failedChunks.map(String),
      message: failedChunks.length > 0 
        ? `Analysis complete. ${failedChunks.length} chunk(s) had issues.`
        : `Found ${accounts.length} account(s). Review and select items to dispute.`,
    });

    return { result, accounts };
  };

  const analyzeWithTextClassification = async (
    bureauResponseText: string,
    priorLetterText: string,
    accessToken: string
  ): Promise<{ result: AnalysisResult; accounts: DisputeAccount[] }> => {
    setProgress({
      phase: 'classifying',
      currentStep: 'Analyzing text content...',
      totalSteps: 1,
      completedSteps: 0,
      failedChunks: [],
      message: 'Sending to AI for classification...',
    });

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/classify-documents`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          bureauResponseText,
          priorLetterText,
        }),
      }
    );

    const payload = await safeReadJson(response);

    if (!response.ok) {
      if (response.status === 429) throw new Error('Rate limit exceeded');
      if (response.status === 402) throw new Error('Usage limit reached');
      throw new Error(getErrorMessage(payload) || 'Classification failed');
    }

    const data = payload;

    const accounts: DisputeAccount[] = (data.accounts || []).map((acc: any) => ({
      id: acc.id || crypto.randomUUID(),
      maskedAccountNumber: acc.maskedAccountNumber || 'Unknown',
      creditorName: acc.creditorName || 'Unknown Creditor',
      dateOpened: acc.dateOpened,
      bureauStatuses: acc.bureauStatuses || {},
      isSelected: false,
      confidence: acc.confidence || 0.8,
    }));

    const result: AnalysisResult = {
      bureau: data.bureauMode || 'experian',
      outcome: data.outcome || 'verified',
      itemsVerified: data.itemsVerified || [],
      itemsDeleted: data.itemsDeleted || [],
      itemsPartial: data.itemsPartial || [],
      legalImplications: data.legalImplications || [],
      nextSteps: data.nextSteps || [],
      rawSummary: data.summary || 'Analysis complete.',
      accounts,
    };

    setProgress({
      phase: 'complete',
      currentStep: '',
      totalSteps: 1,
      completedSteps: 1,
      failedChunks: [],
      message: `Found ${accounts.length} account(s).`,
    });

    return { result, accounts };
  };

  const processChunk = async (
    section: string,
    images: string[],
    chunkIndex: number,
    totalChunks: number,
    accessToken: string
  ): Promise<ChunkResult | null> => {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-chunk`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          section,
          images,
          chunkIndex,
          totalChunks,
        }),
      }
    );

    const payload = await safeReadJson(response);

    if (!response.ok) {
      console.error(`Chunk ${chunkIndex + 1} failed:`, payload);
      throw new Error(getErrorMessage(payload) || 'Chunk analysis failed');
    }

    return payload as ChunkResult;
  };

  const retryChunk = useCallback(async (chunkIndex: number) => {
    if (!accessTokenRef.current || imagesRef.current.length === 0) {
      toast.error('Cannot retry - no active session');
      return;
    }

    const chunkIdxStr = String(chunkIndex);
    setProgress(prev => ({
      ...prev,
      failedChunks: prev.failedChunks.filter(i => i !== chunkIdxStr),
      message: `Retrying chunk ${chunkIndex + 1}...`,
    }));

    const chunkStart = chunkIndex * MAX_IMAGES_PER_CHUNK;
    const chunkImages = imagesRef.current.slice(chunkStart, chunkStart + MAX_IMAGES_PER_CHUNK);

    try {
      const result = await processChunk(
        'accounts',
        chunkImages,
        chunkIndex,
        Math.ceil(imagesRef.current.length / MAX_IMAGES_PER_CHUNK),
        accessTokenRef.current
      );
      
      if (result) {
        toast.success(`Chunk ${chunkIndex + 1} recovered`);
      }
    } catch (e) {
      setProgress(prev => ({
        ...prev,
        failedChunks: [...prev.failedChunks, chunkIdxStr],
      }));
      toast.error(`Chunk ${chunkIndex + 1} failed again`);
    }
  }, []);

  return {
    progress,
    isProcessing,
    analyzeDocuments,
    retryChunk,
    skipRemaining,
    reset,
  };
}

// Normalize and deduplicate accounts from chunks
function normalizeAccounts(rawAccounts: any[], documentMap: DocumentMap): DisputeAccount[] {
  const accountMap = new Map<string, DisputeAccount>();
  
  for (const acc of rawAccounts) {
    const key = `${acc.creditor_name || acc.creditorName}-${acc.account_number || acc.maskedAccountNumber}`.toLowerCase();
    
    const existing = accountMap.get(key);
    if (existing) {
      // Merge bureau statuses
      const newBureaus = acc.bureaus || acc.bureau_status ? Object.keys(acc.bureau_status || {}) : [];
      for (const bureau of newBureaus) {
        if (!existing.bureauStatuses[bureau as BureauKey]) {
          existing.bureauStatuses[bureau as BureauKey] = {
            status: acc.bureau_status?.[bureau] || acc.status_as_reported || 'Unknown',
            reported: true,
          };
        }
      }
      // Update confidence if higher
      if ((acc.confidence || 0.8) > (existing.confidence || 0)) {
        existing.confidence = acc.confidence;
      }
    } else {
      // Create new account entry
      const bureauStatuses: Record<string, { status: string; reported: boolean }> = {};
      
      // Handle various bureau status formats
      if (acc.bureau_status) {
        for (const [bureau, status] of Object.entries(acc.bureau_status)) {
          bureauStatuses[bureau] = { status: status as string, reported: true };
        }
      } else if (acc.bureaus && Array.isArray(acc.bureaus)) {
        for (const bureau of acc.bureaus) {
          bureauStatuses[bureau] = { 
            status: acc.status_as_reported || 'Reported', 
            reported: true 
          };
        }
      } else if (documentMap.is_multi_bureau) {
        // Multi-bureau report - assume all bureaus unless specified
        for (const bureau of documentMap.detected_bureaus) {
          bureauStatuses[bureau] = { status: 'Reported', reported: true };
        }
      }

      const confidence = acc.confidence === 'high' ? 0.95 : 
                    acc.confidence === 'medium' ? 0.75 :
                    acc.confidence === 'low' ? 0.5 :
                    typeof acc.confidence === 'number' ? acc.confidence : 0.8;

      accountMap.set(key, {
        id: crypto.randomUUID(),
        maskedAccountNumber: acc.account_number || acc.maskedAccountNumber || 'Unknown',
        creditorName: acc.creditor_name || acc.creditorName || 'Unknown Creditor',
        dateOpened: acc.date_opened || acc.dateOpened,
        bureauStatuses,
        isSelected: confidence >= 0.7,
        disputeReason: acc.isCollection ? 'Collection account' : 
                       acc.isChargeOff ? 'Charge-off' : undefined,
        confidence,
        triageState: confidence >= 0.7 ? "included" : "pending",
      });
    }
  }

  return Array.from(accountMap.values());
}
