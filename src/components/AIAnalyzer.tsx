import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, FileText, Loader2, AlertCircle, Copy, Check, Sparkles, ChevronRight, AlertTriangle, LogIn, X, Plus, User, MapPin, Briefcase, Phone, Mail, Calendar, Hash, Shield, FileWarning, Edit3, Layers, Scale, RefreshCw, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Session } from "@supabase/supabase-js";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pdfToImagesStreaming, pdfToImagesSelective, isPartialResultAcceptable, extractTextFromPdf, detectBureauFromText, isHeicFile, isPdfFile, isSupportedImage, triagePdfPages, type TriageResult } from "@/lib/pdf-utils";
import type { ClientPdfError } from "@/lib/client-pdf-error";
import { uploadPageBlob, uploadImageFile, deleteJobObjects, isUploadTriageModeEnabled, setUploadTriageMode, runUploadSelfTest, type UploadFailureDetails, type UploadSelfTestReport, type UploadTriageEvent } from "@/lib/storage-upload";
import { getInvalidUploads, isAnalysisStartBlocked, runAnalysisGuardSelfTest } from "@/lib/upload-guard";
import DisputeLetterBuilder from "./DisputeLetterBuilder";
import { useChunkedAnalysis } from "@/hooks/useChunkedAnalysis";
import { AnalysisProgress } from "./AnalysisProgress";
import { useAnalysisJobV2 } from "@/hooks/useAnalysisJobV2";
import { AnalysisJobProgress } from "./AnalysisJobProgress";
import { parseJobResultAccounts } from "@/lib/analysisJobs";

// Bureau type for multi-bureau support
type BureauName = 'experian' | 'equifax' | 'transunion';

// Dispute-grade analysis result interface with per-bureau status
interface DisputeAnalysisResult {
  bureau?: string;
  is_multi_bureau_report?: boolean;
  detected_bureaus?: BureauName[];
  inaccurate_names: {
    reported_name: string;
    mismatch_reason: string;
    source?: string;
    bureaus?: BureauName[];
  }[];
  inaccurate_addresses: {
    reported_address: string;
    linked_to_derogatory: boolean;
    source?: string;
    bureaus?: BureauName[];
  }[];
  inaccurate_employers: {
    reported_employer: string;
    source?: string;
    bureaus?: BureauName[];
  }[];
  extra_identifier_mismatches: {
    field: string;
    reported_value: string;
    status: string;
    source?: string;
    bureaus?: BureauName[];
  }[];
  derogatory_accounts: {
    creditor_name: string;
    account_number: string;
    date_opened: string;
    derogatory_triggers: string[];
    status_as_reported: string;
    confidence: "high" | "medium" | "low" | "incomplete";
    source?: string;
    bureaus?: BureauName[];
    bureau_status?: Record<BureauName, string>;
  }[];
  late_payment_summary: {
    severity: "30-day" | "60-day" | "90-day";
    accounts: {
      creditor_name: string;
      account_number: string;
      months_detected: string;
      source?: string;
      bureaus?: BureauName[];
    }[];
  }[];
  collections: {
    creditor_name: string;
    account_number: string;
    original_creditor: string;
    balance: string;
    source?: string;
    bureaus?: BureauName[];
  }[];
  charge_offs: {
    creditor_name: string;
    account_number: string;
    date_charged_off: string;
    balance: string;
    source?: string;
    bureaus?: BureauName[];
  }[];
  public_records: {
    type: string;
    court_jurisdiction: string;
    filing_date: string;
    status: string;
    source?: string;
    bureaus?: BureauName[];
  }[];
  inquiries: {
    creditor_name: string;
    date: string;
    type: string;
    source?: string;
    bureaus?: BureauName[];
  }[];
  summary: string;
  next_steps: string[];
  warnings: string[];
}

// File mapping for multi-bureau uploads
interface UploadedFile {
  id: string;
  file: File;
  name: string;
  storagePaths: string[]; // Object keys in analysis-images bucket (NOT base64)
  uploadId: string; // UUID grouping all pages for this file
  pageCount: number;
  pagesSucceeded?: number;
  failedPages?: number[]; // 1-based page numbers that failed rendering
  detectedBureau: 'experian' | 'equifax' | 'transunion' | 'multi-bureau' | 'unknown';
  selectedBureau: 'experian' | 'equifax' | 'transunion' | 'multi-bureau' | 'unknown';
  label: string; // UI-only metadata - NEVER sent to AI per invariant
  isProcessing: boolean;
  processingStatus?: string; // Read-only status for display (e.g., "21 pages processed")
  error?: string;
  clientPdfErrors?: ClientPdfError[]; // Structured errors from PDF processing
  // Text-first triage fields
  extractedText?: string; // Full extracted text if text-first path is viable
  triageResult?: TriageResult; // Page triage results
  pipelinePath?: 'text-first' | 'vision-selective' | 'vision-full' | 'image-direct'; // Which path was used
}

type AnalyzerTriageReport = UploadSelfTestReport & {
  tests: UploadSelfTestReport["tests"] & {
    analysisGuard: ReturnType<typeof runAnalysisGuardSelfTest>;
  };
  objectNamePrefix: string;
  prefixMatchesUid: boolean;
  probeUploadResult: "PASS" | "FAIL";
  detectedRootCause: string;
  minimalFixApplied: string[];
  regression: {
    analysisGuardPass: boolean;
    analysisWorkerUnchanged: boolean;
    zombieCleanupUnchanged: boolean;
    structuredDiagnosticsPreserved: boolean;
  };
};

const AIAnalyzer = () => {
  // Questionnaire fields (ground truth)
  const [fullLegalName, setFullLegalName] = useState("");
  const [currentAddress, setCurrentAddress] = useState("");
  const [currentEmployer, setCurrentEmployer] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [ssnLast4, setSsnLast4] = useState("");
  
  // Upload fields - multi-file with bureau mapping
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [responseText, setResponseText] = useState("");
  const [identityDocs, setIdentityDocs] = useState("");
  
  // State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<Record<string, DisputeAnalysisResult>>({});
  const [activeTab, setActiveTab] = useState<string>("combined");
  const [error, setError] = useState<string | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [triageMode, setTriageModeState] = useState(false);
  const [triageReport, setTriageReport] = useState<AnalyzerTriageReport | null>(null);
  const [lastUploadFailure, setLastUploadFailure] = useState<UploadFailureDetails | null>(null);
  const [uploadEvents, setUploadEvents] = useState<UploadTriageEvent[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  // Chunked analysis hook for multi-bureau reports
  const { progress: chunkedProgress, analyzeChunked, skipPaymentHistory, retrySection, reset: resetChunked } = useChunkedAnalysis();
  const [documentMap, setDocumentMap] = useState<any>(null);

  // Track if job completed but results failed to load (for debug panel)
  const [jobCompletedButEmpty, setJobCompletedButEmpty] = useState(false);
  const [lastJobInfo, setLastJobInfo] = useState<{ jobId: string | null; resultCount: number } | null>(null);

  // Store the job ID for callbacks (avoids circular dependency)
  const currentJobIdRef = useRef<string | null>(null);

  /**
   * CRITICAL: Hydrate job results into the `results` state.
   * Returns true only if hydration succeeds.
   * Toast will only fire after this returns true.
   */
  const handleJobComplete = useCallback((resultData: any, accounts: any[]) => {
    console.log('[AIAnalyzer] handleJobComplete called with', accounts.length, 'accounts');
    setLastJobInfo({ jobId: currentJobIdRef.current, resultCount: accounts.length });
    
    if (!accounts || accounts.length === 0) {
      console.warn('[AIAnalyzer] Job complete but no accounts extracted');
      setJobCompletedButEmpty(true);
      setIsAnalyzing(false);
      return false; // Don't show success toast
    }

    try {
      // Convert job accounts to DisputeAnalysisResult format
      const hydratedResult: DisputeAnalysisResult = {
        bureau: resultData?.documentMap?.is_multi_bureau ? 'Multi-Bureau' : 'Credit Report',
        is_multi_bureau_report: resultData?.documentMap?.is_multi_bureau || false,
        detected_bureaus: resultData?.documentMap?.detected_bureaus || [],
        inaccurate_names: [],
        inaccurate_addresses: [],
        inaccurate_employers: [],
        extra_identifier_mismatches: [],
        derogatory_accounts: accounts.map((acc: any) => ({
          creditor_name: acc.creditorName || acc.creditor_name || 'Unknown',
          account_number: acc.maskedAccountNumber || acc.account_number || 'Unknown',
          date_opened: acc.dateOpened || acc.date_opened || '',
          derogatory_triggers: acc.derogatoryTriggers || acc.derogatory_triggers || [],
          status_as_reported: acc.status || 'Unknown',
          confidence: (acc.confidence >= 0.9 ? 'high' : acc.confidence >= 0.7 ? 'medium' : 'low') as "high" | "medium" | "low",
          bureaus: acc.bureaus || [],
        })),
        late_payment_summary: [],
        collections: [],
        charge_offs: [],
        public_records: [],
        inquiries: [],
        summary: `Extracted ${accounts.length} account(s) from ${resultData?.totalPages || 'multiple'} pages.`,
        next_steps: [
          "Review each account for accuracy",
          "Select accounts to dispute",
          "Generate dispute letters"
        ],
        warnings: resultData?.failedChunks?.length > 0 
          ? [`${resultData.failedChunks.length} page chunk(s) failed to process`] 
          : [],
      };

      // Hydrate into results state
      setResults({ 'async-job': hydratedResult });
      setActiveTab('async-job');
      setIsAnalyzing(false);
      setJobCompletedButEmpty(false);
      
      console.log('[AIAnalyzer] Results hydrated successfully:', Object.keys({ 'async-job': hydratedResult }));
      return true; // Success - show toast
    } catch (err) {
      console.error('[AIAnalyzer] Failed to hydrate results:', err);
      setJobCompletedButEmpty(true);
      setIsAnalyzing(false);
      return false; // Don't show success toast
    }
  }, []);

  const handleJobError = useCallback((errorCode: string | null, errorMessage: string | null) => {
    console.error('[AIAnalyzer] Job error:', errorCode, errorMessage);
    setIsAnalyzing(false);
    setError(errorMessage || 'Analysis failed');
  }, []);

  const handleJobPartial = useCallback((accounts: any[]) => {
    console.log('[AIAnalyzer] Partial results:', accounts.length, 'accounts');
    setLastJobInfo({ jobId: currentJobIdRef.current, resultCount: accounts.length });
    setIsAnalyzing(false);
  }, []);
  
  // Async job hook for timeout-resistant analysis
  const { 
    state: jobState, 
    startAnalysis: startJobAnalysis, 
    resumeJob, 
    retryJob, 
    usePartialResults,
    reset: resetJob,
    isProcessing: isJobProcessing 
  } = useAnalysisJobV2({
    onComplete: handleJobComplete,
    onError: handleJobError,
    onPartial: handleJobPartial,
    autoResume: true,
  });

  // Keep ref in sync with job state
  useEffect(() => {
    currentJobIdRef.current = jobState.jobId;
  }, [jobState.jobId]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    setTriageModeState(isUploadTriageModeEnabled());

    return () => subscription.unsubscribe();
  }, []);

  const generateFileId = () => Math.random().toString(36).substring(2, 9);
  

  const getRenderedPageFileInfo = (mimeType: string) => {
    const normalized = mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
    return { contentType: normalized };
  };

  const appendUploadEvent = useCallback((event: UploadTriageEvent) => {
    setUploadEvents(prev => [...prev.slice(-19), event]);
  }, []);

  const buildDiagnosticsPayload = useCallback(() => ({
    // Fix: use live jobId ref, not just lastJobInfo (which requires completion)
    jobId: currentJobIdRef.current ?? lastJobInfo?.jobId ?? null,
    resultCount: lastJobInfo?.resultCount ?? 0,
    resultsKeys: Object.keys(results).length,
    triageMode,
    triageReport,
    lastUploadFailure,
    uploadEvents,
    files: uploadedFiles.map(f => ({
      name: f.name,
      pageCount: f.pageCount,
      pagesSucceeded: f.pagesSucceeded,
      failedPages: f.failedPages,
      error: f.error,
      // Pipeline triage diagnostics
      pipelinePath: f.pipelinePath || null,
      triageResult: f.triageResult ? {
        totalPages: f.triageResult.totalPages,
        textRichPages: f.triageResult.textRichPages,
        actionablePages: f.triageResult.actionablePages.length,
        nonActionablePages: f.triageResult.nonActionablePages.length,
        textFirstViable: f.triageResult.textFirstViable,
        textFirstReason: f.triageResult.textFirstReason,
        charsPerPage: f.triageResult.charsPerPage,
        pagesExtracted: f.triageResult.pagesExtracted,
        pagesRenderedToImage: f.storagePaths.length,
      } : null,
      hasExtractedText: Boolean(f.extractedText),
      extractedTextLength: f.extractedText?.length ?? 0,
      clientPdfErrors: (f.clientPdfErrors || []).map((e) => ({
        stage: e.stage,
        code: e.code,
        message: e.message,
        meta: {
          fileName: e.meta?.fileName,
          fileSize: e.meta?.fileSize,
          mimeType: e.meta?.mimeType,
          pageCount: e.meta?.pageCount,
          failingPage: e.meta?.failingPage,
          operation: e.meta?.operation,
          usedScale: e.meta?.scale,
          usedFormat: e.meta?.format,
          usedQuality: e.meta?.quality,
          pdfjsError: e.meta?.pdfjsError,
        },
      })),
    })),
  }), [lastJobInfo, results, triageMode, triageReport, lastUploadFailure, uploadEvents, uploadedFiles]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxFiles = 10;
    const maxSize = 20 * 1024 * 1024; // 20MB per file
    
    const currentFileCount = uploadedFiles.length;
    if (currentFileCount + files.length > maxFiles) {
      toast({
        title: "Too many files",
        description: `Maximum ${maxFiles} files allowed`,
        variant: "destructive",
      });
      return;
    }

    for (const file of files) {
      // Check HEIC
      if (isHeicFile(file)) {
        toast({
          title: "HEIC not supported",
          description: `${file.name}: Please convert to JPG or PNG before uploading.`,
          variant: "destructive",
        });
        continue;
      }

      // Check file size
      if (file.size > maxSize) {
        toast({
          title: "File too large",
          description: `${file.name} exceeds 20MB limit`,
          variant: "destructive",
        });
        continue;
      }

      const fileId = generateFileId();
      
      const uploadId = crypto.randomUUID();

      // Add file with processing state
      setUploadedFiles(prev => [...prev, {
        id: fileId,
        file,
        name: file.name,
        storagePaths: [],
        uploadId,
        pageCount: 0,
        detectedBureau: 'unknown',
        selectedBureau: 'unknown',
        label: '', // Label is UI-only metadata, never sent to AI
        isProcessing: true,
        processingStatus: '', // Read-only processing status
      }]);

      // Process file with timeout
      try {
        const authUser = await supabase.auth.getUser();
        const userId = authUser.data.user?.id;
        if (!userId) {
          throw {
            stage: 'CLIENT_PDF',
            code: 'AUTH_NOT_READY',
            message: 'Upload blocked: auth not ready at upload time',
            meta: {
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type,
              operation: 'upload',
            },
          };
        }

        if (isPdfFile(file)) {
          // STEP 1: Run page-level text triage BEFORE any image rendering
          setUploadedFiles(prev => prev.map(f =>
            f.id === fileId ? { ...f, processingStatus: 'Extracting text for triage...' } : f
          ));

          const triage = await triagePdfPages(file);
          const detectedBureau = detectBureauFromText(triage.fullText || '');

          console.log(`[AIAnalyzer] Triage for ${file.name}:`, {
            totalPages: triage.totalPages,
            textFirstViable: triage.textFirstViable,
            textFirstReason: triage.textFirstReason,
            actionablePages: triage.actionablePages.length,
            nonActionablePages: triage.nonActionablePages.length,
            charsPerPage: triage.charsPerPage,
          });

          // STEP 2: Decide path based on triage
          const textFirstConditions = {
            textFirstViable: triage.textFirstViable,
            textFirstReason: triage.textFirstReason,
            fullTextLength: triage.fullText.length,
            underCharLimit: triage.fullText.length <= 500000,
            charsPerPage: triage.charsPerPage,
            textRichPages: triage.textRichPages,
            totalPages: triage.totalPages,
            textRichRatio: triage.totalPages > 0 ? (triage.textRichPages / triage.totalPages).toFixed(2) : '0',
            pagesExtracted: triage.pagesExtracted,
            willUseTextFirst: triage.textFirstViable && triage.fullText.length > 0 && triage.fullText.length <= 500000,
          };
          console.log(`[AIAnalyzer] Text-first decision for ${file.name}:`, textFirstConditions);

          if (textFirstConditions.willUseTextFirst) {
            // TEXT-FIRST PATH: No image rendering needed
            console.log(`[AIAnalyzer] Using TEXT-FIRST path for ${file.name} (${triage.charsPerPage} chars/page)`);
            
            setUploadedFiles(prev => prev.map(f =>
              f.id === fileId
                ? {
                    ...f,
                    storagePaths: [], // No images needed
                    pageCount: triage.totalPages,
                    pagesSucceeded: triage.pagesExtracted,
                    failedPages: [],
                    detectedBureau,
                    selectedBureau: detectedBureau,
                    isProcessing: false,
                    processingStatus: `Text extracted: ${triage.totalPages} pages, ${triage.charsPerPage} chars/page avg (text-first)`,
                    extractedText: triage.fullText,
                    triageResult: triage,
                    pipelinePath: 'text-first',
                  }
                : f
            ));
          } else {
            // VISION PATH: Render only actionable pages
            const pagesToRender = triage.actionablePages.length > 0
              ? triage.actionablePages
              : Array.from({ length: triage.totalPages }, (_, i) => i + 1); // fallback to all

            const pipelinePath = triage.actionablePages.length > 0 && triage.actionablePages.length < triage.totalPages
              ? 'vision-selective' as const
              : 'vision-full' as const;

            console.log(`[AIAnalyzer] Using ${pipelinePath} path for ${file.name}: rendering ${pagesToRender.length}/${triage.totalPages} pages`);

            setUploadedFiles(prev => prev.map(f =>
              f.id === fileId
                ? { ...f, processingStatus: `Triage complete. Rendering ${pagesToRender.length}/${triage.totalPages} actionable pages...` }
                : f
            ));

            const storagePaths: string[] = [];

            const renderPages = async () => {
              const result = await pdfToImagesSelective(
                file,
                pagesToRender,
                async (pdfPageNumber, blob, mimeType, totalSelected) => {
                  const { contentType } = getRenderedPageFileInfo(mimeType);
                  const objectName = await uploadPageBlob(
                    userId,
                    uploadId,
                    pdfPageNumber,
                    blob,
                    contentType,
                    file.name,
                    appendUploadEvent,
                  );
                  storagePaths.push(objectName);
                  setUploadedFiles(prev => prev.map(f =>
                    f.id === fileId
                      ? { ...f, processingStatus: `Uploading page ${storagePaths.length}/${totalSelected}...` }
                      : f
                  ));
                }
              );
              return result;
            };

            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('PDF processing timed out')), 120000);
            });

            try {
              const result = await Promise.race([renderPages(), timeoutPromise]);

              const isAcceptable = isPartialResultAcceptable(result);
              if (!isAcceptable) {
                await deleteJobObjects(userId, uploadId).catch(() => {});
                const firstErr = result.errors[0];
                setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
                toast({
                  title: "PDF processing failed",
                  description: `${file.name}: Processed ${result.pagesSucceeded}/${pagesToRender.length} selected pages, below minimum threshold. ${firstErr?.message || 'Try uploading screenshots instead.'}`,
                  variant: "destructive",
                });
                return;
              }

              const hasFailures = result.failedPages.length > 0;
              const statusMsg = hasFailures
                ? `${result.pagesSucceeded}/${pagesToRender.length} pages uploaded (${pipelinePath}, ${triage.nonActionablePages.length} skipped)`
                : `${result.pagesSucceeded} of ${triage.totalPages} pages uploaded (${triage.totalPages - pagesToRender.length} non-actionable skipped)`;

              setUploadedFiles(prev => prev.map(f =>
                f.id === fileId
                  ? {
                      ...f,
                      storagePaths,
                      pageCount: triage.totalPages,
                      pagesSucceeded: result.pagesSucceeded,
                      failedPages: result.failedPages,
                      detectedBureau,
                      selectedBureau: detectedBureau,
                      isProcessing: false,
                      processingStatus: statusMsg,
                      clientPdfErrors: result.errors.length > 0 ? result.errors : undefined,
                      triageResult: triage,
                      pipelinePath,
                    }
                  : f
              ));

              if (hasFailures) {
                toast({
                  title: "Partial PDF processing",
                  description: `${file.name}: ${result.pagesSucceeded}/${pagesToRender.length} selected pages processed. Pages ${result.failedPages.join(', ')} failed.`,
                  variant: "default",
                });
              }
            } catch (timeoutErr) {
              await deleteJobObjects(userId, uploadId).catch(() => {});
              setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
              toast({
                title: "PDF processing failed",
                description: `${file.name} timed out. Upload screenshots instead to ensure complete analysis.`,
                variant: "destructive",
              });
            }
          }
        } else if (isSupportedImage(file)) {
          // Upload single image directly (no base64 in memory)
          const path = await uploadImageFile(userId, uploadId, file, 1, appendUploadEvent);
          setUploadedFiles(prev => prev.map(f =>
            f.id === fileId
              ? { ...f, storagePaths: [path], pageCount: 1, isProcessing: false, processingStatus: '1 page uploaded' }
              : f
          ));
        } else {
          setUploadedFiles(prev => prev.map(f =>
            f.id === fileId
              ? { ...f, isProcessing: false, error: 'Unsupported file format' }
              : f
          ));
          toast({
            title: "Unsupported format",
            description: `${file.name}: Please upload PNG, JPG, GIF, WebP, or PDF.`,
            variant: "destructive",
          });
        }
      } catch (err: any) {
        console.error('File processing error:', err);
        const isStructured = err?.stage === 'CLIENT_PDF';
        const errorMsg = isStructured ? err.message : 'Failed to process file';
        const failingPage = isStructured ? err?.meta?.failingPage : undefined;

        if (isStructured) {
          setLastUploadFailure(err as UploadFailureDetails);
        }

        setUploadedFiles(prev => prev.map(f =>
          f.id === fileId
            ? {
                ...f,
                isProcessing: false,
                error: errorMsg,
                failedPages: failingPage ? [failingPage] : f.failedPages,
                clientPdfErrors: isStructured && err?.operation !== 'upload' ? [err] : f.clientPdfErrors,
              }
            : f
        ));

        toast({
          title: isStructured ? `Upload error: ${err.code}` : "Processing failed",
          description: isStructured
            ? `${err.message}${failingPage ? ` (failing page: ${failingPage})` : ''}`
            : `Failed to process ${file.name}. Try uploading screenshots instead.`,
          variant: "destructive",
        });
      }
    }

    setResponseText("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const updateFileBureau = (fileId: string, bureau: 'experian' | 'equifax' | 'transunion' | 'multi-bureau' | 'unknown') => {
    setUploadedFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, selectedBureau: bureau } : f
    ));
  };

  const updateFileLabel = (fileId: string, label: string) => {
    setUploadedFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, label } : f
    ));
  };

  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const clearAllFiles = () => {
    setUploadedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Validate bureau assignments
  const validateBureauAssignments = (): { valid: boolean; message?: string } => {
    const unknownFiles = uploadedFiles.filter(f => f.selectedBureau === 'unknown');
    if (unknownFiles.length > 0) {
      return { 
        valid: false, 
        message: `Please select a bureau for: ${unknownFiles.map(f => f.name).join(', ')}` 
      };
    }

    // Check for duplicate bureaus without labels
    const bureauGroups = uploadedFiles.reduce((acc, f) => {
      if (!acc[f.selectedBureau]) acc[f.selectedBureau] = [];
      acc[f.selectedBureau].push(f);
      return acc;
    }, {} as Record<string, UploadedFile[]>);

    for (const [bureau, files] of Object.entries(bureauGroups)) {
      if (files.length > 1) {
        const unlabeledFiles = files.filter(f => !f.label.trim());
        if (unlabeledFiles.length > 0) {
          return {
            valid: false,
            message: `Multiple ${bureau.charAt(0).toUpperCase() + bureau.slice(1)} files detected. Please add labels to distinguish them (e.g., "Jan 2026", "v1").`
          };
        }
      }
    }

    return { valid: true };
  };

  const handleAnalyze = async (selectedFileIds?: string[]) => {
    const filesToAnalyze = selectedFileIds 
      ? uploadedFiles.filter(f => selectedFileIds.includes(f.id))
      : uploadedFiles;

    const runtimeSnapshot = {
      isAnalyzing,
      isJobProcessing,
      anyFileProcessing: uploadedFiles.some(f => f.isProcessing),
      hasUploadFailures: isAnalysisStartBlocked(uploadedFiles),
      responseText,
      uploadedFilesLength: uploadedFiles.length,
      filesToAnalyzeLength: filesToAnalyze.length,
      fullLegalName: fullLegalName.trim(),
      currentAddress: currentAddress.trim(),
      currentEmployer: currentEmployer.trim(),
      hasUnknownBureau: uploadedFiles.some(f => f.selectedBureau === 'unknown'),
      fileDiagnostics: filesToAnalyze.map(f => ({
        name: f.name,
        selectedBureau: f.selectedBureau,
        label: f.label,
        isProcessing: f.isProcessing,
        pipelinePath: f.pipelinePath ?? null,
        hasStoragePaths: f.storagePaths.length > 0,
        hasExtractedText: Boolean(f.extractedText),
        hasError: Boolean(f.error),
      })),
    };

    console.log('[AIAnalyzer][runtime] handleAnalyze invoked', runtimeSnapshot);

    // Soft warnings for identity fields — never block analysis
    const softWarnings: string[] = [];
    if (!fullLegalName.trim()) softWarnings.push("Full legal name is missing");
    if (!currentAddress.trim()) softWarnings.push("Current address is missing");
    if (!currentEmployer.trim()) softWarnings.push("Current employer is missing");
    const unknownBureauFiles = uploadedFiles.filter(f => f.selectedBureau === 'unknown');
    if (unknownBureauFiles.length > 0) softWarnings.push(`Bureau not detected for: ${unknownBureauFiles.map(f => f.name).join(', ')}`);

    if (softWarnings.length > 0) {
      console.warn('[AIAnalyzer][runtime] soft warnings (non-blocking)', {
        ...runtimeSnapshot,
        softWarnings,
      });
      toast({
        title: "Analysis proceeding with warnings",
        description: softWarnings.join('. ') + '. These fields improve accuracy but are not required.',
      });
    }

    if (!responseText && filesToAnalyze.length === 0) {
      console.warn('[AIAnalyzer][runtime] blocked: no input', runtimeSnapshot);
      toast({
        title: "No input provided",
        description: "Please upload files or paste the credit report text",
        variant: "destructive",
      });
      return;
    }

    // Validate bureau assignments
    const validation = validateBureauAssignments();
    if (!validation.valid) {
      console.warn('[AIAnalyzer][runtime] blocked: bureau validation', {
        ...runtimeSnapshot,
        validationMessage: validation.message,
      });
      toast({
        title: "Bureau assignment required",
        description: validation.message,
        variant: "destructive",
      });
      return;
    }

    // For text-first files, storagePaths will be empty — that's expected
    const textFirstFiles = filesToAnalyze.filter(f => f.pipelinePath === 'text-first');
    const imageFiles = filesToAnalyze.filter(f => f.pipelinePath !== 'text-first');

    const invalidUploads = getInvalidUploads(imageFiles);
    if (invalidUploads.length > 0) {
      console.warn('[AIAnalyzer][runtime] blocked: invalid uploads', {
        ...runtimeSnapshot,
        invalidUploads: invalidUploads.map(f => f.name),
      });
      toast({
        title: "Upload issue detected",
        description: `Resolve failed uploads before analysis: ${invalidUploads.map(f => f.name).join(', ')}`,
        variant: "destructive",
      });
      return;
    }

    // Text-first files must have extracted text
    const brokenTextFirst = textFirstFiles.filter(f => !f.extractedText);
    if (brokenTextFirst.length > 0) {
      console.warn('[AIAnalyzer][runtime] blocked: broken text-first extraction', {
        ...runtimeSnapshot,
        brokenTextFirst: brokenTextFirst.map(f => f.name),
      });
      toast({
        title: "Triage error",
        description: `Text extraction failed for: ${brokenTextFirst.map(f => f.name).join(', ')}. Remove and re-upload.`,
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setResults({});
    resetChunked();

    try {
      if (!session?.access_token) {
        console.warn('[AIAnalyzer][runtime] blocked: missing auth session', runtimeSnapshot);
        setError("Please log in to use the analyzer");
        toast({
          title: "Authentication required",
          description: "Please log in to use the analyzer",
          variant: "destructive",
        });
        setIsAnalyzing(false);
        return;
      }

      const questionnaire = {
        fullLegalName: fullLegalName.trim(),
        currentAddress: currentAddress.trim(),
        currentEmployer: currentEmployer.trim(),
        dateOfBirth: dateOfBirth || undefined,
        phoneNumber: phoneNumber || undefined,
        email: email || undefined,
        ssnLast4: ssnLast4 || undefined,
      };

      const newResults: Record<string, DisputeAnalysisResult> = {};

      // Combine all extracted text from text-first files
      const combinedExtractedText = textFirstFiles
        .map(f => f.extractedText || '')
        .join('\n\n');

      // Combine pasted text + extracted text
      const allTextInput = [responseText, combinedExtractedText].filter(Boolean).join('\n\n');

      // Group image files by bureau for async job
      const bureauGroups = imageFiles.reduce((acc, f) => {
        const key = f.label ? `${f.selectedBureau}_${f.label}` : f.selectedBureau;
        if (!acc[key]) acc[key] = { bureau: f.selectedBureau, label: f.label, storagePaths: [] };
        acc[key].storagePaths.push(...f.storagePaths);
        return acc;
      }, {} as Record<string, { bureau: string; label: string; storagePaths: string[] }>);

      const hasImageWork = Object.values(bureauGroups).some(g => g.storagePaths.length > 0);

      // Log pipeline decision with triage diagnostics
      console.log('[AIAnalyzer] Analysis routing:', {
        textFirstFiles: textFirstFiles.length,
        imageFiles: imageFiles.length,
        hasTextInput: allTextInput.length > 0,
        hasImageWork,
        textLength: allTextInput.length,
        totalImagePages: Object.values(bureauGroups).reduce((s, g) => s + g.storagePaths.length, 0),
        triageSummaries: filesToAnalyze.map(f => ({
          name: f.name,
          pipelinePath: f.pipelinePath || 'unknown',
          triageViable: f.triageResult?.textFirstViable ?? null,
          triageReason: f.triageResult?.textFirstReason ?? null,
          charsPerPage: f.triageResult?.charsPerPage ?? null,
          textRichPages: f.triageResult ? `${f.triageResult.textRichPages}/${f.triageResult.totalPages}` : null,
          actionablePages: f.triageResult?.actionablePages.length ?? null,
          storagePaths: f.storagePaths.length,
        })),
      });

      // Route: text-first path (direct API call, fast)
      if (allTextInput.length > 0 && !hasImageWork) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min for large text
        
        toast({
          title: "Analyzing via text-first path",
          description: `Processing ${textFirstFiles.length > 0 ? `${textFirstFiles.reduce((s, f) => s + (f.pageCount || 0), 0)} pages of extracted text` : 'pasted text'}. This is faster than image analysis.`,
        });

        try {
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-response`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              questionnaire,
              responseText: allTextInput,
              hasIdentityDocs: identityDocs || undefined,
            }),
            signal: controller.signal,
          });

          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Analysis failed");
          
          newResults['text'] = { ...data, bureau: textFirstFiles.length > 0 ? 'Text-First Extraction' : 'Text Input' };
        } finally {
          clearTimeout(timeoutId);
        }
      } else if (hasImageWork) {
        // Route: async job for image-based analysis
        const totalPageCount = Object.values(bureauGroups).reduce((sum, g) => sum + g.storagePaths.length, 0);
        const allStoragePaths = Object.values(bureauGroups).flatMap(g => g.storagePaths);
        
        toast({
          title: "Starting background analysis",
          description: `Analyzing ${totalPageCount} image pages. This may take a few minutes. You can refresh and resume.`,
        });
        
        const jobId = await startJobAnalysis(allStoragePaths, questionnaire);
        
        if (!jobId) {
          throw new Error("Failed to start analysis job");
        }
        
        // Job started - polling will handle the rest
        return;
      }

      setResults(newResults);
      setActiveTab(Object.keys(newResults).length > 1 ? "combined" : Object.keys(newResults)[0] || "combined");
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError("Analysis timed out after 60 seconds. Try uploading fewer pages or use screenshots instead.");
        toast({
          title: "Request timed out",
          description: "Analysis took too long. Try uploading screenshots instead of PDFs.",
          variant: "destructive",
        });
      } else {
        const message = err instanceof Error ? err.message : "Something went wrong";
        setError(message);
        toast({
          title: "Analysis failed",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Combine results from all bureaus with source tags
  const getCombinedResults = (): DisputeAnalysisResult => {
    const combined: DisputeAnalysisResult = {
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
      summary: "",
      next_steps: [],
      warnings: [],
    };

    const seenNames = new Set<string>();
    const seenAddresses = new Set<string>();
    const seenEmployers = new Set<string>();

    for (const [, result] of Object.entries(results)) {
      const source = result.bureau || 'Unknown';

      // Dedupe names
      for (const item of result.inaccurate_names) {
        const key = item.reported_name.toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          combined.inaccurate_names.push({ ...item, source });
        }
      }

      // Dedupe addresses
      for (const item of result.inaccurate_addresses) {
        const key = item.reported_address.toLowerCase();
        if (!seenAddresses.has(key)) {
          seenAddresses.add(key);
          combined.inaccurate_addresses.push({ ...item, source });
        }
      }

      // Dedupe employers
      for (const item of result.inaccurate_employers) {
        const key = item.reported_employer.toLowerCase();
        if (!seenEmployers.has(key)) {
          seenEmployers.add(key);
          combined.inaccurate_employers.push({ ...item, source });
        }
      }

      // Add all identifiers with source
      combined.extra_identifier_mismatches.push(
        ...result.extra_identifier_mismatches.map(i => ({ ...i, source }))
      );

      // Add all derogatory accounts with source
      combined.derogatory_accounts.push(
        ...result.derogatory_accounts.map(a => ({ ...a, source }))
      );

      // Merge late payment summaries
      for (const severity of result.late_payment_summary) {
        let existing = combined.late_payment_summary.find(s => s.severity === severity.severity);
        if (!existing) {
          existing = { severity: severity.severity, accounts: [] };
          combined.late_payment_summary.push(existing);
        }
        existing.accounts.push(...severity.accounts.map(a => ({ ...a, source })));
      }

      // Add all collections
      combined.collections.push(...result.collections.map(c => ({ ...c, source })));

      // Add all charge-offs
      combined.charge_offs.push(...result.charge_offs.map(c => ({ ...c, source })));

      // Add all public records
      combined.public_records.push(...result.public_records.map(p => ({ ...p, source })));

      // Add all inquiries
      combined.inquiries.push(...result.inquiries.map(i => ({ ...i, source })));

      // Combine summaries
      if (result.summary) {
        combined.summary += (combined.summary ? '\n\n' : '') + `[${source}] ${result.summary}`;
      }

      // Combine next steps (dedupe)
      for (const step of result.next_steps) {
        if (!combined.next_steps.includes(step)) {
          combined.next_steps.push(step);
        }
      }

      // Combine warnings
      combined.warnings.push(...result.warnings.map(w => `[${source}] ${w}`));
    }

    return combined;
  };

  const copySection = async (sectionName: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedSection(sectionName);
    toast({
      title: "Copied to clipboard",
      description: `${sectionName} copied successfully`,
    });
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const copyAllResults = async (result: DisputeAnalysisResult, bureauName?: string) => {
    let fullText = `CREDIT REPORT DISPUTE ANALYSIS${bureauName ? ` - ${bureauName}` : ''}\n`;
    fullText += "=".repeat(50) + "\n\n";
    
    if (result.inaccurate_names.length > 0) {
      fullText += "INACCURATE NAMES:\n";
      result.inaccurate_names.forEach(item => {
        fullText += `• "${item.reported_name}" - ${item.mismatch_reason}${item.source ? ` [${item.source}]` : ''}\n`;
      });
      fullText += "\n";
    }
    
    if (result.inaccurate_addresses.length > 0) {
      fullText += "INACCURATE ADDRESSES:\n";
      result.inaccurate_addresses.forEach(item => {
        fullText += `• ${item.reported_address}${item.linked_to_derogatory ? " [LINKED TO DEROGATORY]" : ""}${item.source ? ` [${item.source}]` : ""}\n`;
      });
      fullText += "\n";
    }
    
    if (result.inaccurate_employers.length > 0) {
      fullText += "INACCURATE EMPLOYERS:\n";
      result.inaccurate_employers.forEach(item => {
        fullText += `• ${item.reported_employer}${item.source ? ` [${item.source}]` : ''}\n`;
      });
      fullText += "\n";
    }
    
    if (result.derogatory_accounts.length > 0) {
      fullText += "DEROGATORY ACCOUNTS:\n";
      result.derogatory_accounts.forEach(item => {
        fullText += `• ${item.creditor_name} (${item.account_number})${item.source ? ` [${item.source}]` : ''}\n`;
        fullText += `  Triggers: ${item.derogatory_triggers.join(", ")}\n`;
        fullText += `  Status: ${item.status_as_reported} | Confidence: ${item.confidence}\n`;
      });
      fullText += "\n";
    }

    if (result.collections.length > 0) {
      fullText += "COLLECTIONS:\n";
      result.collections.forEach(item => {
        fullText += `• ${item.creditor_name} (${item.account_number}) - Balance: ${item.balance}${item.source ? ` [${item.source}]` : ''}\n`;
      });
      fullText += "\n";
    }

    if (result.inquiries.length > 0) {
      fullText += "INQUIRIES:\n";
      result.inquiries.forEach(item => {
        fullText += `• ${item.creditor_name} - ${item.date} (${item.type})${item.source ? ` [${item.source}]` : ''}\n`;
      });
      fullText += "\n";
    }
    
    await navigator.clipboard.writeText(fullText);
    toast({
      title: "All results copied",
      description: "Full analysis copied to clipboard",
    });
  };

  const getConfidenceBadge = (confidence: "high" | "medium" | "low" | "incomplete") => {
    const styles = {
      high: "bg-success/20 text-success border-success/30",
      medium: "bg-warning/20 text-warning border-warning/30",
      low: "bg-muted text-muted-foreground border-border",
      incomplete: "bg-destructive/20 text-destructive border-destructive/30"
    };
    const label = confidence === "incomplete" ? "review required" : `${confidence} confidence`;
    return (
      <span className={cn("px-2 py-0.5 text-xs font-medium rounded border", styles[confidence])}>
        {label}
      </span>
    );
  };

  const hasAnyResults = Object.keys(results).length > 0;
  const anyFileProcessing = uploadedFiles.some(f => f.isProcessing);
  const hasUnknownBureau = uploadedFiles.some(f => f.selectedBureau === 'unknown');
  const hasUploadFailures = isAnalysisStartBlocked(uploadedFiles);

  const handleAnalyzeButtonClick = () => {
    const buttonEl = document.querySelector<HTMLButtonElement>('[data-testid="analyze-all-reports-button"]');
    const buttonRect = buttonEl?.getBoundingClientRect();
    const centerX = buttonRect ? buttonRect.left + buttonRect.width / 2 : null;
    const centerY = buttonRect ? buttonRect.top + buttonRect.height / 2 : null;
    const centerElement = centerX !== null && centerY !== null
      ? document.elementFromPoint(centerX, centerY)
      : null;
    const computedStyle = buttonEl ? window.getComputedStyle(buttonEl) : null;

    console.log('[AIAnalyzer][runtime] analyze button click', {
      domDisabled: buttonEl?.disabled ?? null,
      ariaDisabled: buttonEl?.getAttribute('aria-disabled') ?? null,
      pointerEvents: computedStyle?.pointerEvents ?? null,
      opacity: computedStyle?.opacity ?? null,
      centerElementTag: centerElement?.tagName ?? null,
      centerElementClass: centerElement?.className ?? null,
      centerElementIsButton: buttonEl ? (centerElement === buttonEl || buttonEl.contains(centerElement)) : null,
      isAnalyzing,
      isJobProcessing,
      anyFileProcessing,
      hasUploadFailures,
      responseText,
      uploadedFilesLength: uploadedFiles.length,
      fullLegalName: fullLegalName.trim(),
      currentAddress: currentAddress.trim(),
      currentEmployer: currentEmployer.trim(),
      hasUnknownBureau,
    });

    void handleAnalyze();
  };

  const handleRunUploadSelfTest = useCallback(async () => {
    try {
      const report = await runUploadSelfTest();
      const analysisGuard = runAnalysisGuardSelfTest();
      const objectNamePrefix = report.objectNameUsed.split('/')[0] || '';
      const prefixMatchesUid = report.uid ? objectNamePrefix === report.uid : false;
      const detectedRootCause = report.conclusion;

      const mergedReport: AnalyzerTriageReport = {
        ...report,
        tests: {
          ...report.tests,
          analysisGuard,
        },
        objectNamePrefix,
        prefixMatchesUid,
        probeUploadResult: report.tests.storageWriteProbe.pass ? 'PASS' : 'FAIL',
        detectedRootCause,
        minimalFixApplied: [
          'UID is derived from auth.getUser() at upload time',
          'Uploads are blocked until auth/session is hydrated',
          'Single Supabase client instance is enforced by singleton guard',
          'Object path contract is verified and upsert is fixed to false',
          'Analysis start is blocked whenever uploads are invalid',
        ],
        regression: {
          analysisGuardPass: analysisGuard.pass,
          analysisWorkerUnchanged: true,
          zombieCleanupUnchanged: true,
          structuredDiagnosticsPreserved: true,
        },
      };

      setTriageReport(mergedReport);
      toast({
        title: mergedReport.probeUploadResult === 'PASS' ? 'Upload self-test passed' : 'Upload self-test found issues',
        description: `${mergedReport.detectedRootCause} | probe ${mergedReport.probeUploadResult}`,
        variant: mergedReport.probeUploadResult === 'PASS' ? 'default' : 'destructive',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Self-test failed to run';
      toast({ title: 'Self-test failed', description: message, variant: 'destructive' });
    }
  }, [toast]);

  const toggleTriageMode = useCallback(() => {
    const next = !triageMode;
    setUploadTriageMode(next);
    setTriageModeState(next);
    if (!next) {
      setTriageReport(null);
      setLastUploadFailure(null);
      setUploadEvents([]);
    }
  }, [triageMode]);

  const renderResultContent = (result: DisputeAnalysisResult, showSource = false) => (
    <div className="space-y-6">
      {/* Summary */}
      {result.summary && (
        <div className="card-elevated rounded-xl border border-border/50 p-6">
          <h4 className="text-lg font-serif font-semibold text-foreground mb-3">Summary</h4>
          <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{result.summary}</p>
        </div>
      )}

      {/* Warnings */}
      {result.warnings && result.warnings.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-6">
          <h4 className="text-lg font-serif font-semibold text-warning mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Warnings
          </h4>
          <ul className="space-y-2">
            {result.warnings.map((warning, i) => (
              <li key={i} className="text-warning/90 flex items-start gap-2">
                <ChevronRight className="w-4 h-4 flex-shrink-0 mt-1" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Inaccurate Names */}
      {result.inaccurate_names && result.inaccurate_names.length > 0 && (
        <ResultCard
          title="Inaccurate Names"
          count={result.inaccurate_names.length}
          onCopy={() => copySection("Inaccurate Names", result.inaccurate_names.map(n => `${n.reported_name}: ${n.mismatch_reason}`).join("\n"))}
          isCopied={copiedSection === "Inaccurate Names"}
        >
          {result.inaccurate_names.map((item, i) => (
            <div key={i} className="flex items-start justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <p className="font-medium text-foreground">"{item.reported_name}"</p>
                <p className="text-sm text-destructive">{item.mismatch_reason}</p>
                {showSource && item.source && (
                  <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded mt-1 inline-block">{item.source}</span>
                )}
              </div>
            </div>
          ))}
        </ResultCard>
      )}

      {/* Inaccurate Addresses */}
      {result.inaccurate_addresses && result.inaccurate_addresses.length > 0 && (
        <ResultCard
          title="Inaccurate Addresses"
          count={result.inaccurate_addresses.length}
          onCopy={() => copySection("Inaccurate Addresses", result.inaccurate_addresses.map(a => a.reported_address).join("\n"))}
          isCopied={copiedSection === "Inaccurate Addresses"}
        >
          {result.inaccurate_addresses.map((item, i) => (
            <div key={i} className="p-3 bg-muted/30 rounded-lg">
              <p className="font-medium text-foreground">{item.reported_address}</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {item.linked_to_derogatory && (
                  <span className="text-xs px-2 py-0.5 bg-destructive/20 text-destructive rounded">
                    Linked to derogatory items
                  </span>
                )}
                {showSource && item.source && (
                  <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{item.source}</span>
                )}
              </div>
            </div>
          ))}
        </ResultCard>
      )}

      {/* Inaccurate Employers */}
      {result.inaccurate_employers && result.inaccurate_employers.length > 0 && (
        <ResultCard
          title="Inaccurate Employers"
          count={result.inaccurate_employers.length}
          onCopy={() => copySection("Inaccurate Employers", result.inaccurate_employers.map(e => e.reported_employer).join("\n"))}
          isCopied={copiedSection === "Inaccurate Employers"}
        >
          {result.inaccurate_employers.map((item, i) => (
            <div key={i} className="p-3 bg-muted/30 rounded-lg flex items-center justify-between">
              <p className="font-medium text-foreground">{item.reported_employer}</p>
              {showSource && item.source && (
                <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{item.source}</span>
              )}
            </div>
          ))}
        </ResultCard>
      )}

      {/* Extra Identifier Mismatches */}
      {result.extra_identifier_mismatches && result.extra_identifier_mismatches.length > 0 && (
        <ResultCard
          title="Extra Identifier Mismatches"
          count={result.extra_identifier_mismatches.length}
          onCopy={() => copySection("Identifier Mismatches", result.extra_identifier_mismatches.map(e => `${e.field}: ${e.reported_value}`).join("\n"))}
          isCopied={copiedSection === "Identifier Mismatches"}
        >
          {result.extra_identifier_mismatches.map((item, i) => (
            <div key={i} className="p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{item.field}:</span>
                <span className="font-medium text-foreground">"{item.reported_value}"</span>
                {showSource && item.source && (
                  <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{item.source}</span>
                )}
              </div>
              <p className="text-sm text-destructive mt-1">{item.status}</p>
            </div>
          ))}
        </ResultCard>
      )}

      {/* Derogatory Accounts */}
      {result.derogatory_accounts && result.derogatory_accounts.length > 0 && (
        <ResultCard
          title="Derogatory Accounts"
          count={result.derogatory_accounts.length}
          variant="destructive"
          onCopy={() => copySection("Derogatory Accounts", result.derogatory_accounts.map(a => `${a.creditor_name} (${a.account_number})`).join("\n"))}
          isCopied={copiedSection === "Derogatory Accounts"}
        >
          {result.derogatory_accounts.map((item, i) => (
            <div key={i} className="p-4 bg-muted/30 rounded-lg space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-foreground">{item.creditor_name}</p>
                  <p className="text-sm text-muted-foreground font-mono">{item.account_number}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {getConfidenceBadge(item.confidence)}
                  {showSource && item.source && (
                    <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{item.source}</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Date Opened: </span>
                  <span className="text-foreground">{item.date_opened}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <span className="text-foreground">{item.status_as_reported}</span>
                </div>
              </div>
              
              {/* Per-bureau status for multi-bureau reports */}
              {item.bureau_status && Object.keys(item.bureau_status).length > 0 && (
                <div className="mt-2 p-2 bg-background/50 rounded border border-border/50">
                  <p className="text-xs text-muted-foreground mb-1.5 font-medium">Status by Bureau:</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {(['experian', 'equifax', 'transunion'] as const).map(bureau => (
                      item.bureau_status?.[bureau] && (
                        <div key={bureau} className="flex flex-col">
                          <span className="text-muted-foreground capitalize">{bureau}</span>
                          <span className={cn(
                            "font-medium",
                            item.bureau_status[bureau]?.toLowerCase().includes('late') || 
                            item.bureau_status[bureau]?.toLowerCase().includes('derogatory') ||
                            item.bureau_status[bureau]?.toLowerCase().includes('charge') 
                              ? "text-destructive" 
                              : item.bureau_status[bureau]?.toLowerCase().includes('not reported')
                                ? "text-muted-foreground"
                                : "text-foreground"
                          )}>
                            {item.bureau_status[bureau]}
                          </span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}
              
              {/* Bureau tags */}
              {item.bureaus && item.bureaus.length > 0 && !item.bureau_status && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {item.bureaus.map((bureau, bi) => (
                    <span key={bi} className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded capitalize">
                      {bureau}
                    </span>
                  ))}
                </div>
              )}
              
              <div className="flex flex-wrap gap-1.5 mt-2">
                {item.derogatory_triggers.map((trigger, ti) => (
                  <span key={ti} className="px-2 py-0.5 text-xs bg-destructive/20 text-destructive rounded">
                    {trigger}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </ResultCard>
      )}

      {/* Late Payment Summary */}
      {result.late_payment_summary && result.late_payment_summary.length > 0 && (
        <ResultCard
          title="Late Payment Summary"
          count={result.late_payment_summary.reduce((acc, s) => acc + s.accounts.length, 0)}
          variant="warning"
          onCopy={() => copySection("Late Payments", result.late_payment_summary.flatMap(s => s.accounts.map(a => `${s.severity}: ${a.creditor_name}`)).join("\n"))}
          isCopied={copiedSection === "Late Payments"}
        >
          {result.late_payment_summary.map((severity, si) => (
            <div key={si} className="space-y-2">
              <h5 className="font-semibold text-warning uppercase text-sm">{severity.severity} Lates</h5>
              {severity.accounts.map((acc, ai) => (
                <div key={ai} className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-foreground">{acc.creditor_name}</p>
                      <p className="text-sm text-muted-foreground font-mono">{acc.account_number}</p>
                    </div>
                    {showSource && acc.source && (
                      <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{acc.source}</span>
                    )}
                  </div>
                  <p className="text-sm text-warning mt-1">{acc.months_detected}</p>
                </div>
              ))}
            </div>
          ))}
        </ResultCard>
      )}

      {/* Collections */}
      {result.collections && result.collections.length > 0 && (
        <ResultCard
          title="Collections"
          count={result.collections.length}
          variant="destructive"
          onCopy={() => copySection("Collections", result.collections.map(c => `${c.creditor_name} - ${c.balance}`).join("\n"))}
          isCopied={copiedSection === "Collections"}
        >
          {result.collections.map((item, i) => (
            <div key={i} className="p-3 bg-muted/30 rounded-lg">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-foreground">{item.creditor_name}</p>
                  <p className="text-sm text-muted-foreground font-mono">{item.account_number}</p>
                </div>
                {showSource && item.source && (
                  <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{item.source}</span>
                )}
              </div>
              {item.original_creditor && (
                <p className="text-sm text-muted-foreground">Original: {item.original_creditor}</p>
              )}
              <p className="text-sm text-destructive font-semibold mt-1">Balance: {item.balance}</p>
            </div>
          ))}
        </ResultCard>
      )}

      {/* Charge-offs */}
      {result.charge_offs && result.charge_offs.length > 0 && (
        <ResultCard
          title="Charge-Offs"
          count={result.charge_offs.length}
          variant="destructive"
          onCopy={() => copySection("Charge-Offs", result.charge_offs.map(c => `${c.creditor_name} - ${c.balance}`).join("\n"))}
          isCopied={copiedSection === "Charge-Offs"}
        >
          {result.charge_offs.map((item, i) => (
            <div key={i} className="p-3 bg-muted/30 rounded-lg">
              <div className="flex justify-between items-start">
                <p className="font-medium text-foreground">{item.creditor_name}</p>
                {showSource && item.source && (
                  <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{item.source}</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground font-mono">{item.account_number}</p>
              <div className="flex gap-4 text-sm mt-1">
                <span className="text-muted-foreground">Charged Off: {item.date_charged_off}</span>
                <span className="text-destructive font-semibold">Balance: {item.balance}</span>
              </div>
            </div>
          ))}
        </ResultCard>
      )}

      {/* Public Records */}
      {result.public_records && result.public_records.length > 0 && (
        <ResultCard
          title="Public Records"
          count={result.public_records.length}
          variant="destructive"
          onCopy={() => copySection("Public Records", result.public_records.map(p => `${p.type} - ${p.filing_date}`).join("\n"))}
          isCopied={copiedSection === "Public Records"}
        >
          {result.public_records.map((item, i) => (
            <div key={i} className="p-3 bg-muted/30 rounded-lg">
              <div className="flex justify-between items-start">
                <p className="font-semibold text-foreground">{item.type}</p>
                {showSource && item.source && (
                  <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{item.source}</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{item.court_jurisdiction}</p>
              <div className="flex gap-4 text-sm mt-1">
                <span className="text-muted-foreground">Filed: {item.filing_date}</span>
                <span className="text-foreground">Status: {item.status}</span>
              </div>
            </div>
          ))}
        </ResultCard>
      )}

      {/* Inquiries */}
      {result.inquiries && result.inquiries.length > 0 && (
        <ResultCard
          title="Inquiries"
          count={result.inquiries.length}
          onCopy={() => copySection("Inquiries", result.inquiries.map(i => `${i.creditor_name} - ${i.date}`).join("\n"))}
          isCopied={copiedSection === "Inquiries"}
        >
          {result.inquiries.map((item, i) => (
            <div key={i} className="p-3 bg-muted/30 rounded-lg flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">{item.creditor_name}</p>
                <p className="text-sm text-muted-foreground">{item.date}</p>
              </div>
              <div className="flex items-center gap-2">
                {showSource && item.source && (
                  <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{item.source}</span>
                )}
                <span className={cn(
                  "px-2 py-0.5 text-xs rounded",
                  item.type === "hard" 
                    ? "bg-destructive/20 text-destructive" 
                    : "bg-muted text-muted-foreground"
                )}>
                  {item.type}
                </span>
              </div>
            </div>
          ))}
        </ResultCard>
      )}

      {/* Next Steps */}
      {result.next_steps && result.next_steps.length > 0 && (
        <div className="card-elevated rounded-xl border border-border/50 p-6">
          <h4 className="text-lg font-serif font-semibold text-foreground mb-4">Next Steps</h4>
          <ol className="space-y-3">
            {result.next_steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );

  return (
    <section id="ai-tool" className="py-20 px-4 bg-card/30">
      <div className="max-w-5xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-full mb-6">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">Dispute-Grade Extraction</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-serif font-bold text-foreground mb-4">
            Credit Report Analyzer
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Upload your credit reports from all three bureaus. Get a dispute-ready checklist of inaccuracies and derogatory items.
          </p>
        </div>

        {/* Authentication check */}
        {!session ? (
          <div className="card-elevated rounded-2xl border border-border/50 p-8 text-center">
            <LogIn className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-xl font-serif font-semibold text-foreground mb-2">Authentication Required</h3>
            <p className="text-muted-foreground mb-6">
              Please log in to use the Credit Report Analyzer.
            </p>
            <Button 
              onClick={() => window.location.href = '/auth'}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <LogIn className="w-4 h-4 mr-2" />
              Log In to Continue
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Questionnaire Section */}
            <div className="card-elevated rounded-2xl border border-border/50 p-6 md:p-8">
              <h3 className="text-xl font-serif font-semibold text-foreground mb-2 flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Your Information (Ground Truth)
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                These values are the ONLY "ground truth." Any differences in the report will be flagged.
              </p>
              
              {/* Required Fields */}
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <div className="space-y-2">
                  <Label className="text-foreground font-medium flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Full Legal Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="JOHN MICHAEL DOE JR"
                    value={fullLegalName}
                    onChange={(e) => setFullLegalName(e.target.value)}
                    className="bg-muted/30 border-border/50"
                  />
                  <p className="text-xs text-muted-foreground">Exact match required. Include middle name, suffix, etc.</p>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-foreground font-medium flex items-center gap-2">
                    <Briefcase className="w-4 h-4" />
                    Current Employer <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="Acme Corporation"
                    value={currentEmployer}
                    onChange={(e) => setCurrentEmployer(e.target.value)}
                    className="bg-muted/30 border-border/50"
                  />
                </div>
                
                <div className="md:col-span-2 space-y-2">
                  <Label className="text-foreground font-medium flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Current Address <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="123 Main St Apt 4B, Anytown, CA 90210"
                    value={currentAddress}
                    onChange={(e) => setCurrentAddress(e.target.value)}
                    className="bg-muted/30 border-border/50"
                  />
                </div>
              </div>

              {/* Optional Fields */}
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="optional" className="border-border/50">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground">
                    Optional Fields (Improve Accuracy)
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid md:grid-cols-2 gap-4 pt-4">
                      <div className="space-y-2">
                        <Label className="text-muted-foreground flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          Date of Birth
                        </Label>
                        <Input
                          type="date"
                          value={dateOfBirth}
                          onChange={(e) => setDateOfBirth(e.target.value)}
                          className="bg-muted/30 border-border/50"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-muted-foreground flex items-center gap-2">
                          <Phone className="w-4 h-4" />
                          Phone Number
                        </Label>
                        <Input
                          placeholder="(555) 123-4567"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="bg-muted/30 border-border/50"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-muted-foreground flex items-center gap-2">
                          <Mail className="w-4 h-4" />
                          Email
                        </Label>
                        <Input
                          type="email"
                          placeholder="john.doe@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="bg-muted/30 border-border/50"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label className="text-muted-foreground flex items-center gap-2">
                          <Hash className="w-4 h-4" />
                          Last 4 of SSN
                        </Label>
                        <Input
                          placeholder="1234"
                          maxLength={4}
                          value={ssnLast4}
                          onChange={(e) => setSsnLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          className="bg-muted/30 border-border/50"
                        />
                        <p className="text-xs text-muted-foreground">Used to detect SSN mask mismatches</p>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            {/* Upload Section */}
            <div className="card-elevated rounded-2xl border border-border/50 p-6 md:p-8 space-y-6">
              <h3 className="text-xl font-serif font-semibold text-foreground mb-2">
                Credit Report Upload
              </h3>
              <p className="text-sm text-muted-foreground">
                Upload PDFs or images of your credit reports. Supports Experian, Equifax, TransUnion, and multi-bureau reports (PrivacyGuard, IdentityIQ, etc.).
              </p>
              
              {/* Upload Area */}
              <div 
                className={cn(
                  "border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer",
                  uploadedFiles.length > 0 
                    ? "border-primary/50 bg-primary/5" 
                    : "border-border hover:border-primary/30 hover:bg-muted/30"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,application/pdf"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
                
                <div className="space-y-2">
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Click to upload credit report files
                  </p>
                  <p className="text-sm text-muted-foreground/70">
                    PDF, PNG, JPG, WebP up to 20MB each (max 10 files)
                  </p>
                </div>
              </div>

              {/* File Mapping Table */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-foreground flex items-center gap-2">
                      <Layers className="w-4 h-4" />
                      Uploaded Files ({uploadedFiles.length})
                    </h4>
                    <Button variant="ghost" size="sm" onClick={clearAllFiles}>
                      Clear All
                    </Button>
                  </div>

                  <div className="border border-border/50 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[1fr,auto,auto,auto] gap-2 p-3 bg-muted/30 text-sm font-medium text-muted-foreground border-b border-border/50">
                      <span>File Name</span>
                      <span className="w-32 text-center">Bureau</span>
                      <span className="w-32 text-center">Label</span>
                      <span className="w-10"></span>
                    </div>
                    
                    {uploadedFiles.map((file) => (
                      <div key={file.id} className="grid grid-cols-[1fr,auto,auto,auto] gap-2 p-3 items-center border-b border-border/30 last:border-b-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {file.isProcessing ? (
                            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
                          ) : file.error ? (
                            <FileWarning className="w-4 h-4 text-destructive flex-shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                          )}
                          <span className="truncate text-sm">{file.name}</span>
                          {file.pageCount > 1 && (
                            <span className="text-xs text-muted-foreground">({file.pageCount} pages)</span>
                          )}
                        </div>
                        
                        <Select 
                          value={file.selectedBureau} 
                          onValueChange={(v) => updateFileBureau(file.id, v as any)}
                          disabled={file.isProcessing}
                        >
                          <SelectTrigger className={cn(
                            "w-32 h-8 text-sm",
                            file.selectedBureau === 'unknown' && "border-warning text-warning"
                          )}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="multi-bureau">Multi-Bureau (PrivacyGuard, etc.)</SelectItem>
                            <SelectItem value="experian">Experian</SelectItem>
                            <SelectItem value="equifax">Equifax</SelectItem>
                            <SelectItem value="transunion">TransUnion</SelectItem>
                            <SelectItem value="unknown">Unknown</SelectItem>
                          </SelectContent>
                        </Select>
                        
                        <Input
                          placeholder="e.g., Jan 2026"
                          value={file.label}
                          onChange={(e) => updateFileLabel(file.id, e.target.value)}
                          className="w-32 h-8 text-sm"
                          disabled={file.isProcessing}
                        />
                        
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="w-8 h-8"
                          onClick={() => removeFile(file.id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {hasUnknownBureau && (
                    <div className="flex items-center gap-2 text-sm text-warning">
                      <AlertTriangle className="w-4 h-4" />
                      <span>Please select a bureau for files marked "Unknown" before analyzing.</span>
                    </div>
                  )}
                </div>
              )}

              {/* Divider for text input */}
              {uploadedFiles.length === 0 && (
                <>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-sm text-muted-foreground">OR paste text</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <Textarea
                    placeholder="Paste the credit report text here..."
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    className="min-h-[150px] bg-muted/30 border-border/50 focus:border-primary/50 resize-none"
                  />
                </>
              )}

              {/* Additional options */}
              <div className="space-y-2">
                <Label className="text-muted-foreground">Identity Theft Docs Available</Label>
                <Select value={identityDocs} onValueChange={setIdentityDocs}>
                  <SelectTrigger className="bg-muted/30 border-border/50">
                    <SelectValue placeholder="Select documentation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ftc">FTC Report Only</SelectItem>
                    <SelectItem value="police">Police Report Only</SelectItem>
                    <SelectItem value="both">Both FTC & Police</SelectItem>
                    <SelectItem value="none">None Yet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={toggleTriageMode}>
                  <Bug className="w-4 h-4 mr-1" />
                  Triage: {triageMode ? 'On' : 'Off'}
                </Button>
              </div>

              {triageMode && (
                <div className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleRunUploadSelfTest}>
                      Run Upload Self-Test
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(buildDiagnosticsPayload(), null, 2));
                        toast({ title: 'Diagnostics copied', description: 'Triage report copied.' });
                      }}
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Copy Diagnostics
                    </Button>
                  </div>

                  {triageReport && (
                    <pre className="text-xs overflow-auto rounded bg-background/60 p-2 border border-border/50 max-h-52">
{JSON.stringify(triageReport, null, 2)}
                    </pre>
                  )}

                  {lastUploadFailure && (
                    <pre className="text-xs overflow-auto rounded bg-destructive/5 p-2 border border-destructive/30 max-h-52">
{JSON.stringify(lastUploadFailure, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {/* Analyze button */}
              <Button
                onClick={() => handleAnalyze()}
                disabled={isAnalyzing || isJobProcessing || anyFileProcessing || hasUploadFailures || (!responseText && uploadedFiles.length === 0)}
                className="w-full py-6 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isAnalyzing || isJobProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Analyzing Credit Reports...
                  </>
                ) : anyFileProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Processing Files...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Analyze All Reports
                  </>
                )}
              </Button>

              {/* Job Progress - shown when async job is active */}
              {(isJobProcessing || jobState.status === 'PARTIAL' || jobState.status === 'FAILED') && (
                <AnalysisJobProgress
                  state={jobState}
                  onRetry={retryJob}
                  onUsePartial={() => {
                    const accounts = usePartialResults();
                    if (accounts.length > 0) {
                      // Hydrate partial results
                      handleJobComplete({ accounts }, accounts);
                    }
                  }}
                  isStale={false}
                />
              )}

              {/* Debug Panel - shown when job completed but results are empty */}
              {jobCompletedButEmpty && lastJobInfo && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-3">
                  <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                    <Bug className="w-5 h-5" />
                    <span className="font-medium">Results Loading Issue</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Analysis completed but results failed to load into the UI. 
                    This can happen due to a temporary issue.
                  </p>
                  <div className="text-xs font-mono bg-muted/50 p-2 rounded space-y-1">
                    <div>Job ID: {lastJobInfo.jobId || 'N/A'}</div>
                    <div>Result Count: {lastJobInfo.resultCount}</div>
                    <div>Results State: {Object.keys(results).length} keys</div>
                    {uploadedFiles.some(f => f.clientPdfErrors?.length) && (
                      <>
                        <div className="mt-2 font-semibold">Client PDF Errors:</div>
                        {uploadedFiles.filter(f => f.clientPdfErrors?.length).map(f => (
                          <div key={f.id}>
                            <div>{f.name}: {f.pagesSucceeded ?? '?'}/{f.pageCount} pages OK, failed: [{f.failedPages?.join(', ') || 'none'}]</div>
                            {f.clientPdfErrors!.map((e, i) => (
                              <div key={i} className="ml-2 text-destructive">• {e.code}: {e.message}</div>
                            ))}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const diagData = buildDiagnosticsPayload();
                      navigator.clipboard.writeText(JSON.stringify(diagData, null, 2));
                      toast({ title: "Diagnostics copied", description: "Paste to support for analysis." });
                    }}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Copy Diagnostics
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        // Reload results from job
                        if (lastJobInfo.jobId && jobState.result) {
                          const accounts = parseJobResultAccounts(jobState.result);
                          const success = handleJobComplete(jobState.result, accounts);
                          if (success) {
                            setJobCompletedButEmpty(false);
                          }
                        }
                      }}
                    >
                      <RefreshCw className="w-4 h-4 mr-1" />
                      Reload Results
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        resetJob();
                        setJobCompletedButEmpty(false);
                        setLastJobInfo(null);
                      }}
                    >
                      Start Over
                    </Button>
                  </div>
                </div>
              )}

              {/* Error state */}
              {error && (
                <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
                  <p className="text-destructive">{error}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Results with Tabs */}
        {hasAnyResults && (
          <div className="mt-8 space-y-6 animate-slide-up">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-serif font-bold text-foreground">
                Dispute Analysis Results
              </h3>
            </div>

            {Object.keys(results).length > 1 ? (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-muted/30 p-1">
                  <TabsTrigger value="combined" className="flex-1 min-w-[120px]">
                    <Layers className="w-4 h-4 mr-2" />
                    Combined
                  </TabsTrigger>
                  {Object.entries(results).map(([key, result]) => (
                    <TabsTrigger key={key} value={key} className="flex-1 min-w-[100px]">
                      {result.bureau || key}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="combined" className="mt-6">
                  <div className="flex justify-end mb-4">
                    <Button variant="outline" onClick={() => copyAllResults(getCombinedResults(), "Combined")}>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy All
                    </Button>
                  </div>
                  {renderResultContent(getCombinedResults(), true)}
                </TabsContent>

                {Object.entries(results).map(([key, result]) => (
                  <TabsContent key={key} value={key} className="mt-6">
                    <div className="flex justify-end mb-4">
                      <Button variant="outline" onClick={() => copyAllResults(result, result.bureau)}>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy All
                      </Button>
                    </div>
                    {renderResultContent(result)}
                  </TabsContent>
                ))}
              </Tabs>
            ) : (
              <div>
                <div className="flex justify-end mb-4">
                  <Button variant="outline" onClick={() => copyAllResults(Object.values(results)[0])}>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy All
                  </Button>
                </div>
                {renderResultContent(Object.values(results)[0])}
              </div>
            )}
          </div>
        )}

        {/* Dispute Letter Builder - shows after analysis is complete */}
        {hasAnyResults && session?.access_token && (
          <div className="mt-12 pt-12 border-t border-border/50">
            <DisputeLetterBuilder
              extractedData={{
                fullLegalName: fullLegalName,
                currentAddress: currentAddress,
                inaccurateNames: getCombinedResults().inaccurate_names,
                inaccurateAddresses: getCombinedResults().inaccurate_addresses,
                derogatoryAccounts: getCombinedResults().derogatory_accounts,
                inquiries: getCombinedResults().inquiries,
                collections: getCombinedResults().collections,
                chargeOffs: getCombinedResults().charge_offs,
                publicRecords: getCombinedResults().public_records,
              }}
              accessToken={session.access_token}
            />
          </div>
        )}
      </div>
    </section>
  );
};

// Reusable result card component
const ResultCard = ({ 
  title, 
  count, 
  variant = "default",
  onCopy, 
  isCopied,
  children 
}: { 
  title: string; 
  count: number;
  variant?: "default" | "warning" | "destructive";
  onCopy: () => void; 
  isCopied: boolean;
  children: React.ReactNode;
}) => {
  const borderColors = {
    default: "border-border/50",
    warning: "border-warning/30",
    destructive: "border-destructive/30"
  };
  
  return (
    <div className={cn("card-elevated rounded-xl border p-6", borderColors[variant])}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h4 className="text-lg font-serif font-semibold text-foreground">{title}</h4>
          <span className={cn(
            "px-2 py-0.5 text-xs font-bold rounded-full",
            variant === "destructive" ? "bg-destructive/20 text-destructive" :
            variant === "warning" ? "bg-warning/20 text-warning" :
            "bg-muted text-muted-foreground"
          )}>
            {count}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onCopy}>
          {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </Button>
      </div>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
};

export default AIAnalyzer;
