import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Session } from '@supabase/supabase-js';
import { toast } from 'sonner';
import type {
  DisputeSession,
  DisputeAccount,
  UploadedDocument,
  AnalysisResult,
  OutcomeConfirmation,
  DisputeSurvey,
  ConsumerInfo,
  ProcessingProgress,
  BureauKey,
  DisputeMode,
  AnalysisStatus,
} from '@/types/disputes';
import {
  createDefaultSession,
  defaultProcessingProgress,
} from '@/types/disputes';

const LOCAL_STORAGE_KEY = 'dispute-engine-state-v5'; // Bumped version for new schema

interface UseDisputeSessionReturn {
  session: Session | null;
  state: DisputeSession;
  isLoading: boolean;
  isSaving: boolean;
  
  // State setters
  setState: React.Dispatch<React.SetStateAction<DisputeSession>>;
  
  // Document actions
  addDocument: (doc: UploadedDocument) => void;
  removeDocument: (id: string) => void;
  updateDocumentText: (id: string, text: string) => void;
  
  // Account actions
  updateAccount: (id: string, changes: Partial<DisputeAccount>) => void;
  selectAllAccounts: (selected: boolean) => void;
  
  // Analysis actions
  setAnalysisResult: (result: AnalysisResult, accounts: DisputeAccount[]) => void;
  setProcessingProgress: (progress: ProcessingProgress) => void;
  setAnalysisStatus: (status: AnalysisStatus) => void;
  
  // Survey/outcome actions
  updateOutcome: (outcome: Partial<OutcomeConfirmation>) => void;
  updateSurvey: (survey: Partial<DisputeSurvey>) => void;
  updateConsumerInfo: (info: Partial<ConsumerInfo>) => void;
  
  // Bureau/letter actions
  setSelectedBureaus: (bureaus: BureauKey[]) => void;
  setGeneratedLetters: (letters: Record<BureauKey, string>) => void;
  
  // Mode action
  setMode: (mode: DisputeMode) => void;
  
  // Manual claims text
  setManualClaimsText: (text: string) => void;
  
  // Persistence
  saveToDatabase: () => Promise<void>;
  loadFromDatabase: () => Promise<void>;
  resetSession: () => Promise<void>;
  
  // Import
  importAnalyzerData: (data: any) => void;
}

export function useDisputeSession(): UseDisputeSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<DisputeSession>(createDefaultSession);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dbSessionIdRef = useRef<string | null>(null);

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session);
    });
    
    return () => subscription.unsubscribe();
  }, []);

  // Load state on mount
  useEffect(() => {
    const loadState = async () => {
      setIsLoading(true);
      
      let loadedState: DisputeSession | null = null;
      
      // Try localStorage first for immediate hydration
      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          loadedState = parsed;
          dbSessionIdRef.current = parsed.id || null;
        }
      } catch (e) {
        console.error('Failed to load from localStorage:', e);
      }

      // Then try database if authenticated
      if (session?.user?.id) {
        try {
          const { data, error } = await supabase
            .from('dispute_sessions')
            .select('*')
            .eq('user_id', session.user.id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (data && !error) {
            dbSessionIdRef.current = data.id;
            const dbState = mapDbToState(data);
            loadedState = dbState;
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dbState));
            
            // Load associated accounts
            const { data: accounts } = await supabase
              .from('dispute_accounts')
              .select('*')
              .eq('session_id', data.id);
            
            if (accounts && accounts.length > 0) {
              loadedState = {
                ...loadedState,
                accounts: accounts.map(mapDbAccountToState),
              };
            }
          }
        } catch (e) {
          console.error('Failed to load from database:', e);
        }
      }

      // CRITICAL: Auto-cleanup stale Bureau Response docs that lost their File object
      // This happens after page refresh since File objects can't be serialized
      if (loadedState) {
        const staleBureauDocs = loadedState.documents.filter(
          d => d.type === 'bureau_response' && !d.file && !d.storageUrl
        );
        
        if (staleBureauDocs.length > 0) {
          // Mark stale docs with needsReupload flag instead of deleting
          const updatedDocs = loadedState.documents.map(d => {
            if (d.type === 'bureau_response' && !d.file && !d.storageUrl) {
              return { ...d, needsReupload: true };
            }
            return d;
          });
          
          loadedState = {
            ...loadedState,
            documents: updatedDocs,
          };
          
          // CRITICAL: Also update localStorage to prevent stale docs from reappearing
          const cleanedForStorage = updatedDocs.map(({ file, ...rest }) => rest);
          const toSave = { 
            ...loadedState, 
            documents: cleanedForStorage,
            updatedAt: new Date().toISOString() 
          };
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(toSave));
          
          // Show user-friendly message after a short delay (after component mounts)
          setTimeout(() => {
            toast.info(
              'Some files could not be restored after the page reload. Re-upload them or use Manual Mode.',
              { duration: 6000 }
            );
          }, 500);
        }
        
        // Ensure new fields have defaults
        if (!loadedState.analysisStatus) {
          loadedState.analysisStatus = loadedState.isAnalyzed ? "DONE" : "NOT_STARTED";
        }
        if (!loadedState.manualClaimsText) {
          loadedState.manualClaimsText = "";
        }
        if (!loadedState.mode || (loadedState.mode !== "AI" && loadedState.mode !== "MANUAL")) {
          // Migrate old lowercase mode to new uppercase
          loadedState.mode = (loadedState.mode as any) === "manual" ? "MANUAL" : "AI";
        }
        
        setState(loadedState);
      } else {
        // No loaded state found, use default
        setState(createDefaultSession());
      }
      
      setIsLoading(false);
    };

    loadState();
  }, [session?.user?.id]);

  // Auto-save to localStorage on state change (excluding non-serializable File objects)
  useEffect(() => {
    const documentsForStorage = state.documents.map(({ file, ...rest }) => rest);
    const toSave = { 
      ...state, 
      documents: documentsForStorage,
      id: dbSessionIdRef.current, 
      updatedAt: new Date().toISOString() 
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(toSave));
    
    // Debounced save to database
    if (session?.user?.id && saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    if (session?.user?.id) {
      saveTimeoutRef.current = setTimeout(() => {
        saveToDatabase();
      }, 2000);
    }
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [state, session?.user?.id]);

  // Database operations
  const saveToDatabase = useCallback(async () => {
    if (!session?.user?.id) return;
    
    setIsSaving(true);
    
    try {
      const dbData = mapStateToDb(state, session.user.id);
      
      if (dbSessionIdRef.current) {
        // Update existing session
        const { error } = await supabase
          .from('dispute_sessions')
          .update(dbData)
          .eq('id', dbSessionIdRef.current);
        
        if (error) throw error;
      } else {
        // Create new session
        const { data, error } = await supabase
          .from('dispute_sessions')
          .insert(dbData)
          .select()
          .single();
        
        if (error) throw error;
        dbSessionIdRef.current = data.id;
      }

      // Save accounts
      if (state.accounts.length > 0 && dbSessionIdRef.current) {
        // Delete existing accounts for this session
        await supabase
          .from('dispute_accounts')
          .delete()
          .eq('session_id', dbSessionIdRef.current);
        
        // Insert updated accounts
        const accountsData = state.accounts.map(acc => 
          mapAccountToDb(acc, dbSessionIdRef.current!, session.user.id)
        );
        
        const { error: accError } = await supabase
          .from('dispute_accounts')
          .insert(accountsData);
        
        if (accError) console.error('Failed to save accounts:', accError);
      }
    } catch (e) {
      console.error('Failed to save to database:', e);
    } finally {
      setIsSaving(false);
    }
  }, [state, session?.user?.id]);

  const loadFromDatabase = useCallback(async () => {
    if (!session?.user?.id) return;
    
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase
        .from('dispute_sessions')
        .select('*')
        .eq('user_id', session.user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data && !error) {
        dbSessionIdRef.current = data.id;
        const dbState = mapDbToState(data);
        
        // Load accounts
        const { data: accounts } = await supabase
          .from('dispute_accounts')
          .select('*')
          .eq('session_id', data.id);
        
        if (accounts) {
          dbState.accounts = accounts.map(mapDbAccountToState);
        }
        
        setState(dbState);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dbState));
      }
    } catch (e) {
      console.error('Failed to load from database:', e);
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  const resetSession = useCallback(async () => {
    // Delete from database if exists
    if (dbSessionIdRef.current && session?.user?.id) {
      try {
        await supabase
          .from('dispute_sessions')
          .delete()
          .eq('id', dbSessionIdRef.current);
      } catch (e) {
        console.error('Failed to delete session:', e);
      }
    }
    
    // Reset local state
    dbSessionIdRef.current = null;
    const newState = createDefaultSession();
    setState(newState);
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    toast.success('Session cleared');
  }, [session?.user?.id]);

  // Document actions
  const addDocument = useCallback((doc: UploadedDocument) => {
    setState(prev => ({
      ...prev,
      documents: [...prev.documents, doc],
    }));
  }, []);

  const removeDocument = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      documents: prev.documents.filter(d => d.id !== id),
    }));
  }, []);

  const updateDocumentText = useCallback((id: string, text: string) => {
    setState(prev => ({
      ...prev,
      documents: prev.documents.map(d => 
        d.id === id ? { ...d, extractedText: text } : d
      ),
    }));
  }, []);

  // Account actions
  const updateAccount = useCallback((id: string, changes: Partial<DisputeAccount>) => {
    setState(prev => ({
      ...prev,
      accounts: prev.accounts.map(acc => 
        acc.id === id ? { ...acc, ...changes } : acc
      ),
    }));
  }, []);

  const selectAllAccounts = useCallback((selected: boolean) => {
    setState(prev => ({
      ...prev,
      accounts: prev.accounts.map(acc => ({ ...acc, isSelected: selected })),
    }));
  }, []);

  // Analysis actions
  const setAnalysisResult = useCallback((result: AnalysisResult, accounts: DisputeAccount[]) => {
    setState(prev => ({
      ...prev,
      analysisResult: result,
      accounts,
      isAnalyzed: true,
      analysisStatus: "DONE" as AnalysisStatus,
      selectedBureaus: result.bureau === 'multi-bureau' 
        ? ['experian', 'equifax', 'transunion'] as BureauKey[]
        : [result.bureau as BureauKey],
      processingProgress: {
        ...defaultProcessingProgress,
        phase: 'complete',
        message: `Found ${accounts.length} account(s). Review and select items to dispute.`,
      },
    }));
  }, []);

  const setProcessingProgress = useCallback((progress: ProcessingProgress) => {
    setState(prev => ({
      ...prev,
      processingProgress: progress,
    }));
  }, []);

  // Survey/outcome actions
  const updateOutcome = useCallback((outcome: Partial<OutcomeConfirmation>) => {
    setState(prev => ({
      ...prev,
      outcomeConfirmation: { ...prev.outcomeConfirmation, ...outcome },
    }));
  }, []);

  const updateSurvey = useCallback((survey: Partial<DisputeSurvey>) => {
    setState(prev => ({
      ...prev,
      survey: { ...prev.survey, ...survey },
    }));
  }, []);

  const updateConsumerInfo = useCallback((info: Partial<ConsumerInfo>) => {
    setState(prev => ({
      ...prev,
      consumerInfo: { ...prev.consumerInfo, ...info },
    }));
  }, []);

  // Bureau/letter actions
  const setSelectedBureaus = useCallback((bureaus: BureauKey[]) => {
    setState(prev => ({
      ...prev,
      selectedBureaus: bureaus,
    }));
  }, []);

  const setGeneratedLetters = useCallback((letters: Record<BureauKey, string>) => {
    setState(prev => ({
      ...prev,
      generatedLetters: letters,
    }));
  }, []);

  // Import analyzer data
  const importAnalyzerData = useCallback((data: any) => {
    setState(prev => ({
      ...prev,
      importedAnalyzerData: data,
      consumerInfo: {
        fullName: data.questionnaire?.fullLegalName || prev.consumerInfo.fullName,
        addressLine1: data.questionnaire?.currentAddress?.split(',')[0] || prev.consumerInfo.addressLine1,
        addressLine2: prev.consumerInfo.addressLine2,
        cityStateZip: data.questionnaire?.currentAddress?.split(',').slice(1).join(',').trim() || prev.consumerInfo.cityStateZip,
      },
    }));
  }, []);

  // Mode action
  const setMode = useCallback((mode: DisputeMode) => {
    setState(prev => ({
      ...prev,
      mode,
      // When switching to MANUAL, also set analysisStatus to SKIPPED
      analysisStatus: mode === "MANUAL" ? "SKIPPED" : prev.analysisStatus,
    }));
  }, []);

  // Analysis status action
  const setAnalysisStatus = useCallback((status: AnalysisStatus) => {
    setState(prev => ({
      ...prev,
      analysisStatus: status,
      // Keep isAnalyzed in sync for backward compat
      isAnalyzed: status === "DONE",
    }));
  }, []);

  // Manual claims text action
  const setManualClaimsText = useCallback((text: string) => {
    setState(prev => ({
      ...prev,
      manualClaimsText: text,
    }));
  }, []);

  return {
    session,
    state,
    isLoading,
    isSaving,
    setState,
    addDocument,
    removeDocument,
    updateDocumentText,
    updateAccount,
    selectAllAccounts,
    setAnalysisResult,
    setProcessingProgress,
    setAnalysisStatus,
    updateOutcome,
    updateSurvey,
    updateConsumerInfo,
    setSelectedBureaus,
    setGeneratedLetters,
    setMode,
    setManualClaimsText,
    saveToDatabase,
    loadFromDatabase,
    resetSession,
    importAnalyzerData,
  };
}

// Helper functions to map between DB and state
function mapStateToDb(state: DisputeSession, userId: string) {
  return {
    user_id: userId,
    mode: state.mode,
    documents: JSON.stringify(state.documents),
    bureau_response_text: state.bureauResponseText,
    prior_letter_text: state.priorLetterText,
    is_analyzed: state.isAnalyzed,
    analysis_result: state.analysisResult ? JSON.stringify(state.analysisResult) : null,
    processing_progress: JSON.stringify(state.processingProgress),
    outcome_confirmation: JSON.stringify(state.outcomeConfirmation),
    survey: JSON.stringify(state.survey),
    consumer_info: JSON.stringify(state.consumerInfo),
    selected_bureaus: state.selectedBureaus,
    generated_letters: JSON.stringify(state.generatedLetters),
    imported_analyzer_data: state.importedAnalyzerData ? JSON.stringify(state.importedAnalyzerData) : null,
    // Note: analysisStatus and manualClaimsText would need DB columns
    // For now they're stored in consumer_info JSON or need migration
  };
}

function mapDbToState(data: any): DisputeSession {
  // Migrate old lowercase mode to new uppercase
  let mode: DisputeMode = "AI";
  if (data.mode === "manual" || data.mode === "MANUAL") {
    mode = "MANUAL";
  }
  
  // Derive analysisStatus from isAnalyzed for backward compat
  let analysisStatus: AnalysisStatus = "NOT_STARTED";
  if (data.is_analyzed) {
    analysisStatus = "DONE";
  } else if (mode === "MANUAL") {
    analysisStatus = "SKIPPED";
  }

  return {
    id: data.id,
    mode,
    analysisStatus,
    manualClaimsText: data.manual_claims_text || "",
    documents: parseJson(data.documents, []),
    bureauResponseText: data.bureau_response_text || '',
    priorLetterText: data.prior_letter_text || '',
    isAnalyzed: data.is_analyzed || false,
    analysisResult: parseJson(data.analysis_result, null),
    accounts: [], // Loaded separately
    processingProgress: parseJson(data.processing_progress, defaultProcessingProgress),
    outcomeConfirmation: parseJson(data.outcome_confirmation, {
      receivedResponse: null,
      responseWithin30Days: null,
      allItemsAddressed: null,
      anyReinsertions: null,
      notes: '',
    }),
    survey: parseJson(data.survey, {
      isFraudulent: false,
      isIdentityTheft: false,
      hasPoliceReport: false,
      hasFtcReport: false,
      wasDataBreach: false,
      wasReinserted: false,
      reinsertedDetails: '',
      hadCreditorRelationship: false,
      belongsToAnotherPerson: false,
      hasPersonalInfoErrors: false,
      hasPreviousDisputes: false,
      additionalFacts: '',
    }),
    consumerInfo: parseJson(data.consumer_info, { fullName: '', addressLine1: '', addressLine2: '', cityStateZip: '' }),
    selectedBureaus: data.selected_bureaus || [],
    generatedLetters: parseJson(data.generated_letters, { experian: '', equifax: '', transunion: '' }),
    importedAnalyzerData: parseJson(data.imported_analyzer_data, null),
    createdAt: data.created_at || new Date().toISOString(),
    updatedAt: data.updated_at || new Date().toISOString(),
  };
}

function mapAccountToDb(acc: DisputeAccount, sessionId: string, userId: string) {
  return {
    session_id: sessionId,
    user_id: userId,
    masked_account_number: acc.maskedAccountNumber,
    creditor_name: acc.creditorName,
    date_opened: acc.dateOpened,
    bureau_statuses: JSON.stringify(acc.bureauStatuses),
    is_selected: acc.isSelected,
    dispute_reason: acc.disputeReason,
    custom_reason: acc.customReason,
    source_file: acc.sourceFile,
    source_page: acc.sourcePage,
    confidence: acc.confidence,
  };
}

function mapDbAccountToState(data: any): DisputeAccount {
  return {
    id: data.id,
    maskedAccountNumber: data.masked_account_number,
    creditorName: data.creditor_name,
    dateOpened: data.date_opened,
    bureauStatuses: parseJson(data.bureau_statuses, {}),
    isSelected: data.is_selected || false,
    disputeReason: data.dispute_reason,
    customReason: data.custom_reason,
    sourceFile: data.source_file,
    sourcePage: data.source_page,
    confidence: data.confidence || 0.8,
  };
}

function parseJson<T>(value: any, defaultValue: T): T {
  if (!value) return defaultValue;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}
