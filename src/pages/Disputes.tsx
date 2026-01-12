import { useState, useEffect, useCallback } from "react";
import AppNavigation from "@/components/AppNavigation";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { 
  Upload, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Download,
  Scale,
  Import,
  Lock,
  ChevronRight,
  Shield,
  Loader2,
  Copy,
  Check,
  Pencil,
  Eye,
  FileCheck,
  HelpCircle,
  RotateCcw
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Session } from "@supabase/supabase-js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// New System B components
import { DocumentUploader } from "@/components/disputes/DocumentUploader";
import { AccountReviewTable } from "@/components/disputes/AccountReviewTable";
import { ProcessingProgress } from "@/components/disputes/ProcessingProgress";

// System B Types
import type {
  BureauKey,
  UploadedDocument,
  DisputeAccount,
  AnalysisResult,
  OutcomeConfirmation,
  DisputeSurvey,
  ConsumerInfo,
  ProcessingProgress as ProgressType,
  DisputeSession,
} from "@/types/disputes";

import {
  BUREAU_DATA,
  defaultOutcomeConfirmation,
  defaultSurvey,
  defaultConsumerInfo,
  defaultProcessingProgress,
  createDefaultSession,
} from "@/types/disputes";

const DISPUTES_STORAGE_KEY = "dispute-engine-state-v3";

// Survey questions configuration
const surveyQuestions = [
  {
    key: "isFraudulent" as const,
    question: "Do you assert that any of the disputed items are fraudulent?",
    tooltip: "Fraud claims trigger heightened investigation requirements under FCRA §611.",
  },
  {
    key: "isIdentityTheft" as const,
    question: "Do you consider yourself a victim of identity theft?",
    tooltip: "Identity theft triggers FCRA §605B blocking rights and additional protections.",
  },
  {
    key: "hasPoliceReport" as const,
    question: "Have you filed a police report related to any of these items?",
    tooltip: "Police reports are NOT legally required but strengthen claims.",
  },
  {
    key: "hasFtcReport" as const,
    question: "Have you filed an FTC Identity Theft Report?",
    tooltip: "An FTC report at identitytheft.gov provides legal documentation.",
  },
  {
    key: "wasDataBreach" as const,
    question: "Have you been exposed to a known data breach?",
    tooltip: "Data breaches trigger heightened duty of care.",
  },
  {
    key: "wasReinserted" as const,
    question: "Have any disputed items been previously removed and later reinserted?",
    tooltip: "Reinsertion requires certification and notice under FCRA §611(a)(5).",
    hasDetails: true,
    detailsKey: "reinsertedDetails" as const,
    detailsPlaceholder: "Provide dates, bureau, and items that were reinserted...",
  },
  {
    key: "hadCreditorRelationship" as const,
    question: "Have you ever had a contractual relationship with any listed creditors?",
    tooltip: "No relationship = accounts cannot lawfully be associated with you.",
  },
  {
    key: "belongsToAnotherPerson" as const,
    question: "Do any disputed items belong to another person with a similar name?",
    tooltip: "Mixed files are a common bureau error and a strong dispute argument.",
  },
  {
    key: "hasPersonalInfoErrors" as const,
    question: "Are there inaccuracies in your personal info (name, address, employer)?",
    tooltip: "Identifier errors undermine the accuracy of associated account data.",
  },
  {
    key: "hasPreviousDisputes" as const,
    question: "Have you previously disputed any of these items with the bureaus?",
    tooltip: "Prior disputes without proper investigation = FCRA violation.",
  },
];

// ============= SECTION COMPONENTS =============

interface SectionHeaderProps {
  number: number;
  title: string;
  icon: React.ReactNode;
  unlocked: boolean;
  completed?: boolean;
}

const SectionHeader = ({ number, title, icon, unlocked, completed }: SectionHeaderProps) => (
  <div className="flex items-center gap-3 mb-4">
    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
      completed 
        ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
        : unlocked 
          ? 'bg-primary/20 text-primary border border-primary/30' 
          : 'bg-muted text-muted-foreground border border-border'
    }`}>
      {completed ? <CheckCircle2 className="w-5 h-5" /> : number}
    </div>
    <div className="flex items-center gap-2">
      <span className={unlocked ? 'text-foreground' : 'text-muted-foreground'}>{icon}</span>
      <h3 className={`text-lg font-serif font-semibold ${unlocked ? 'text-foreground' : 'text-muted-foreground'}`}>
        {title}
      </h3>
    </div>
    {!unlocked && <Lock className="w-4 h-4 text-muted-foreground ml-auto" />}
  </div>
);

// ============= MAIN COMPONENT =============

const Disputes = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<DisputeSession>(createDefaultSession);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentBureauLetter, setCurrentBureauLetter] = useState<BureauKey>("experian");

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  // Load persisted state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DISPUTES_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as DisputeSession;
        setState(parsed);
      }
    } catch (e) {
      console.error("Failed to load dispute engine state:", e);
    }
  }, []);

  // Auto-save state
  useEffect(() => {
    const toSave = { ...state, updatedAt: new Date().toISOString() };
    localStorage.setItem(DISPUTES_STORAGE_KEY, JSON.stringify(toSave));
  }, [state]);

  // Populate consumer info from imported data
  useEffect(() => {
    if (state.importedAnalyzerData && !state.consumerInfo.fullName) {
      const data = state.importedAnalyzerData;
      setState(prev => ({
        ...prev,
        consumerInfo: {
          fullName: data.questionnaire?.fullLegalName || data.fullLegalName || "",
          addressLine1: (data.questionnaire?.currentAddress || data.currentAddress)?.split(',')[0] || "",
          addressLine2: "",
          cityStateZip: (data.questionnaire?.currentAddress || data.currentAddress)?.split(',').slice(1).join(',').trim() || "",
        }
      }));
    }
  }, [state.importedAnalyzerData, state.consumerInfo.fullName]);

  // ============= STATE CHECKS =============
  const hasDocuments = state.documents.length > 0 || state.bureauResponseText.trim().length > 0;
  const isEvidenceLocked = state.isAnalyzed;
  const canAnalyze = hasDocuments && !state.isAnalyzed && state.processingProgress.phase === "idle";
  const isProcessing = !["idle", "complete", "error"].includes(state.processingProgress.phase);
  const canShowReview = state.isAnalyzed && state.accounts.length > 0;
  const hasSelectedAccounts = state.accounts.some(a => a.isSelected);
  const canConfirmOutcome = state.isAnalyzed;
  const isOutcomeConfirmed = state.outcomeConfirmation.receivedResponse !== null;
  const canShowSurvey = isOutcomeConfirmed;
  const canGenerate = canShowSurvey && state.selectedBureaus.length > 0 && state.consumerInfo.fullName.trim() && hasSelectedAccounts;
  const hasGeneratedLetter = Object.values(state.generatedLetters).some(l => l.length > 0);

  // ============= HANDLERS =============

  const handleImportFromAnalyzer = () => {
    try {
      const analyzerData = localStorage.getItem("ai-analyzer-state");
      if (!analyzerData) {
        toast.error("No analyzer data found. Run the Credit Report Analyzer first.");
        return;
      }
      const parsed = JSON.parse(analyzerData);
      if (parsed.analysisResults || parsed.questionnaire) {
        setState(prev => ({
          ...prev,
          importedAnalyzerData: parsed,
          consumerInfo: {
            fullName: parsed.questionnaire?.fullLegalName || prev.consumerInfo.fullName,
            addressLine1: parsed.questionnaire?.currentAddress?.split(',')[0] || prev.consumerInfo.addressLine1,
            addressLine2: prev.consumerInfo.addressLine2,
            cityStateZip: parsed.questionnaire?.currentAddress?.split(',').slice(1).join(',').trim() || prev.consumerInfo.cityStateZip,
          }
        }));
        toast.success("Imported analyzer data successfully!");
      } else {
        toast.error("No analysis results found.");
      }
    } catch (e) {
      toast.error("Failed to import analyzer data.");
    }
  };

  const handleAddDocument = (doc: UploadedDocument) => {
    setState(prev => ({
      ...prev,
      documents: [...prev.documents, doc],
    }));
  };

  const handleRemoveDocument = (id: string) => {
    setState(prev => ({
      ...prev,
      documents: prev.documents.filter(d => d.id !== id),
    }));
  };

  const handleExtractedText = (docId: string, text: string) => {
    // Check if it's a prior dispute doc
    const doc = state.documents.find(d => d.id === docId);
    if (doc?.type === "prior_dispute") {
      setState(prev => ({
        ...prev,
        priorLetterText: prev.priorLetterText + "\n\n" + text,
      }));
    }
  };

  const handleAnalyze = async () => {
    if (!session?.access_token) {
      toast.error("Please log in to analyze responses.");
      return;
    }

    // Update progress
    setState(prev => ({
      ...prev,
      processingProgress: {
        ...prev.processingProgress,
        phase: "classifying",
        currentStep: "Sending to AI for classification...",
        totalSteps: 1,
        completedSteps: 0,
        message: "Analyzing documents...",
      },
    }));

    try {
      // Gather all extracted text from bureau response documents
      const bureauResponseDocs = state.documents.filter(d => d.type === "bureau_response");
      const priorDisputeDocs = state.documents.filter(d => d.type === "prior_dispute");
      
      const bureauText = bureauResponseDocs
        .map(d => d.extractedText || "")
        .filter(t => t.length > 0)
        .join("\n\n---\n\n");
      
      const priorText = priorDisputeDocs
        .map(d => d.extractedText || "")
        .filter(t => t.length > 0)
        .join("\n\n---\n\n") || state.priorLetterText;

      // If no extracted text from files, use the manual text input
      const combinedBureauText = bureauText || state.bureauResponseText;

      if (!combinedBureauText.trim()) {
        toast.error("No text content to analyze. Please upload PDFs with text or paste content manually.");
        setState(prev => ({
          ...prev,
          processingProgress: { ...defaultProcessingProgress, phase: "error", message: "No text content to analyze." },
        }));
        return;
      }

      // Call the classify-documents edge function
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/classify-documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          bureauResponseText: combinedBureauText,
          priorLetterText: priorText,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      // Map the response to our types
      const accounts: DisputeAccount[] = (data.accounts || []).map((acc: any) => ({
        id: acc.id || crypto.randomUUID(),
        maskedAccountNumber: acc.maskedAccountNumber || "Unknown",
        creditorName: acc.creditorName || "Unknown Creditor",
        dateOpened: acc.dateOpened,
        bureauStatuses: acc.bureauStatuses || {},
        isSelected: false,
        disputeReason: undefined,
        customReason: undefined,
        sourceFile: bureauResponseDocs[0]?.name,
        confidence: acc.confidence || 0.8,
      }));

      const analysisResult: AnalysisResult = {
        bureau: data.bureauMode || "experian",
        outcome: data.outcome || "verified",
        itemsVerified: data.itemsVerified || [],
        itemsDeleted: data.itemsDeleted || [],
        itemsPartial: data.itemsPartial || [],
        legalImplications: data.legalImplications || [],
        nextSteps: data.nextSteps || [],
        rawSummary: data.summary || "Analysis complete.",
        accounts,
      };

      setState(prev => ({
        ...prev,
        analysisResult,
        accounts,
        isAnalyzed: true,
        selectedBureaus: data.bureauMode === "multi-bureau" 
          ? ["experian", "equifax", "transunion"] 
          : [data.bureauMode || "experian"],
        processingProgress: {
          phase: "complete",
          currentStep: "",
          totalSteps: 1,
          completedSteps: 1,
          failedChunks: [],
          message: `Found ${accounts.length} account(s). Review and select items to dispute.`,
        },
      }));

      toast.success("Response analyzed. Review findings below.");
    } catch (err) {
      console.error("Analysis error:", err);
      setState(prev => ({
        ...prev,
        processingProgress: {
          phase: "error",
          currentStep: "",
          totalSteps: 0,
          completedSteps: 0,
          failedChunks: [],
          message: err instanceof Error ? err.message : "Analysis failed. Please try again.",
        },
      }));
      toast.error(err instanceof Error ? err.message : "Analysis failed.");
    }
  };

  const handleAccountChange = (id: string, changes: Partial<DisputeAccount>) => {
    setState(prev => ({
      ...prev,
      accounts: prev.accounts.map(acc => 
        acc.id === id ? { ...acc, ...changes } : acc
      ),
    }));
  };

  const handleSelectAllAccounts = (selected: boolean) => {
    setState(prev => ({
      ...prev,
      accounts: prev.accounts.map(acc => ({ ...acc, isSelected: selected })),
    }));
  };

  const handleGenerateLetter = async () => {
    if (!session?.access_token || state.selectedBureaus.length === 0) {
      toast.error("Please log in and select at least one bureau.");
      return;
    }

    if (!state.consumerInfo.fullName.trim() || !state.consumerInfo.addressLine1.trim()) {
      toast.error("Please complete your contact information.");
      return;
    }

    const selectedAccounts = state.accounts.filter(a => a.isSelected);
    if (selectedAccounts.length === 0) {
      toast.error("Please select at least one account to dispute.");
      return;
    }

    setIsGenerating(true);

    try {
      const newLetters: Record<BureauKey, string> = { ...state.generatedLetters };

      // Generate a letter for each selected bureau
      for (const bureauKey of state.selectedBureaus) {
        const bureau = BUREAU_DATA[bureauKey];
        
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-dispute-letter`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            survey: state.survey,
            extractedData: state.importedAnalyzerData?.analysisResults || {
              inaccurateNames: [],
              inaccurateAddresses: [],
              derogatoryAccounts: selectedAccounts.map(acc => ({
                creditor_name: acc.creditorName,
                account_number: acc.maskedAccountNumber,
                date_opened: acc.dateOpened || "Unknown",
                derogatory_triggers: [acc.disputeReason || "Disputed item"],
              })),
              inquiries: [],
              collections: [],
              chargeOffs: [],
              publicRecords: [],
            },
            consumerInfo: state.consumerInfo,
            bureau: {
              key: bureauKey,
              legalName: bureau.legalName,
              address: bureau.address,
              cityStateZip: bureau.cityStateZip,
            },
            analysisContext: state.analysisResult,
            priorLetterText: state.priorLetterText,
            selectedAccounts: selectedAccounts.map(acc => ({
              creditorName: acc.creditorName,
              maskedAccountNumber: acc.maskedAccountNumber,
              disputeReason: acc.disputeReason,
              customReason: acc.customReason,
              bureauStatus: acc.bureauStatuses[bureauKey],
            })),
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || `Failed to generate letter for ${bureauKey}`);
        }

        newLetters[bureauKey] = data.letter;
      }

      setState(prev => ({ ...prev, generatedLetters: newLetters }));
      setCurrentBureauLetter(state.selectedBureaus[0]);
      toast.success(`Generated ${state.selectedBureaus.length} letter(s) successfully!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    const letter = state.generatedLetters[currentBureauLetter];
    if (letter) {
      await navigator.clipboard.writeText(letter);
      setCopied(true);
      toast.success("Letter copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReset = () => {
    if (confirm("Reset all data and start over?")) {
      localStorage.removeItem(DISPUTES_STORAGE_KEY);
      setState(createDefaultSession());
      toast.success("Engine reset.");
    }
  };

  const updateOutcome = <K extends keyof OutcomeConfirmation>(key: K, value: OutcomeConfirmation[K]) => {
    setState(prev => ({
      ...prev,
      outcomeConfirmation: { ...prev.outcomeConfirmation, [key]: value }
    }));
  };

  const updateSurvey = <K extends keyof DisputeSurvey>(key: K, value: DisputeSurvey[K]) => {
    setState(prev => ({
      ...prev,
      survey: { ...prev.survey, [key]: value }
    }));
  };

  const updateConsumerInfo = <K extends keyof ConsumerInfo>(key: K, value: string) => {
    setState(prev => ({
      ...prev,
      consumerInfo: { ...prev.consumerInfo, [key]: value }
    }));
  };

  const toggleBureauSelection = (bureau: BureauKey) => {
    setState(prev => ({
      ...prev,
      selectedBureaus: prev.selectedBureaus.includes(bureau)
        ? prev.selectedBureaus.filter(b => b !== bureau)
        : [...prev.selectedBureaus, bureau],
    }));
  };

  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background">
        <AppNavigation />

        {/* Hero */}
        <section className="py-10 px-4 border-b border-border">
          <div className="container mx-auto max-w-4xl text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Scale className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-gold-gradient mb-3">
              Dispute & Response Engine
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
              A state-driven legal case file. Complete each section to unlock the next.
            </p>

            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleImportFromAnalyzer}>
                <Import className="w-4 h-4 mr-2" />
                Import from Analyzer
              </Button>
              {state.importedAnalyzerData && (
                <Badge variant="outline" className="border-green-500/30 text-green-400">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Data Imported
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={handleReset} className="text-muted-foreground">
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset
              </Button>
            </div>
          </div>
        </section>

        {/* Main Content */}
        <section className="py-8 px-4">
          <div className="container mx-auto max-w-4xl space-y-6">

            {/* SECTION 1: Evidence Locker */}
            <Card className={isEvidenceLocked ? "border-green-500/30" : "border-border"}>
              <CardHeader>
                <SectionHeader 
                  number={1} 
                  title="Evidence Locker" 
                  icon={<Shield className="w-5 h-5" />}
                  unlocked={true}
                  completed={isEvidenceLocked}
                />
                <CardDescription>
                  {isEvidenceLocked 
                    ? "Evidence locked after analysis. Files are read-only." 
                    : "Upload all evidence before proceeding to analysis."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Bureau Response Upload */}
                <DocumentUploader
                  documents={state.documents}
                  onAddDocument={handleAddDocument}
                  onRemoveDocument={handleRemoveDocument}
                  onExtractedText={handleExtractedText}
                  disabled={isEvidenceLocked}
                  category="bureau_response"
                />

                {/* Manual text paste for bureau response */}
                {!isEvidenceLocked && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Or paste bureau response text</Label>
                    <Textarea
                      placeholder="Paste bureau response text..."
                      value={state.bureauResponseText}
                      onChange={(e) => setState(prev => ({ ...prev, bureauResponseText: e.target.value }))}
                      rows={3}
                      className="mt-1"
                    />
                  </div>
                )}

                {/* Prior Letter Upload */}
                <DocumentUploader
                  documents={state.documents}
                  onAddDocument={handleAddDocument}
                  onRemoveDocument={handleRemoveDocument}
                  onExtractedText={handleExtractedText}
                  disabled={isEvidenceLocked}
                  category="prior_dispute"
                />

                {/* Show extracted prior letter text */}
                {state.priorLetterText && (
                  <div className="p-3 rounded-lg bg-muted/30 border border-border">
                    <p className="text-xs text-muted-foreground mb-1">Extracted Prior Letter Text:</p>
                    <p className="text-sm line-clamp-3">{state.priorLetterText}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SECTION 2: Bureau Response Analysis */}
            <Card className={!hasDocuments ? "opacity-50" : state.isAnalyzed ? "border-green-500/30" : ""}>
              <CardHeader>
                <SectionHeader 
                  number={2} 
                  title="Bureau Response Analysis" 
                  icon={<Scale className="w-5 h-5" />}
                  unlocked={hasDocuments}
                  completed={state.isAnalyzed}
                />
                <CardDescription>
                  {state.isAnalyzed 
                    ? "Analysis complete. Review the outcome below." 
                    : "Analyze the bureau response to classify outcome and surface legal implications."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Processing Progress */}
                <ProcessingProgress 
                  progress={state.processingProgress}
                  onCancel={() => setState(prev => ({ 
                    ...prev, 
                    processingProgress: defaultProcessingProgress 
                  }))}
                />

                {/* Analyze Button */}
                {!state.isAnalyzed && state.processingProgress.phase === "idle" && (
                  <Button 
                    onClick={handleAnalyze} 
                    disabled={!canAnalyze || isProcessing}
                    className="w-full"
                  >
                    <ChevronRight className="w-4 h-4 mr-2" />
                    Analyze Response
                  </Button>
                )}

                {/* Analysis Results */}
                {state.analysisResult && (
                  <div className="space-y-4">
                    {/* Outcome Badge */}
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">Outcome:</span>
                      <Badge className={
                        state.analysisResult.outcome === "deleted" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                        state.analysisResult.outcome === "partial" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                        state.analysisResult.outcome === "verified" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                        "bg-orange-500/20 text-orange-400 border-orange-500/30"
                      }>
                        {state.analysisResult.outcome.charAt(0).toUpperCase() + state.analysisResult.outcome.slice(1)}
                      </Badge>
                      <Badge variant="outline">
                        {state.analysisResult.bureau === "multi-bureau" ? "Multi-Bureau" : state.analysisResult.bureau}
                      </Badge>
                    </div>

                    {/* Summary */}
                    <div className="p-4 rounded-lg bg-muted/30 border border-border">
                      <p className="text-sm">{state.analysisResult.rawSummary}</p>
                    </div>

                    {/* Legal Implications */}
                    {state.analysisResult.legalImplications.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          Legal Implications
                        </p>
                        <ul className="space-y-1">
                          {state.analysisResult.legalImplications.map((imp, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-primary">•</span>
                              {imp}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Next Steps */}
                    {state.analysisResult.nextSteps.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Recommended Next Steps</p>
                        <ul className="space-y-1">
                          {state.analysisResult.nextSteps.map((step, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-green-400">{i + 1}.</span>
                              {step}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SECTION 3: Account Review */}
            {canShowReview && (
              <Card className="border-border">
                <CardHeader>
                  <SectionHeader 
                    number={3} 
                    title="Account Review" 
                    icon={<FileCheck className="w-5 h-5" />}
                    unlocked={true}
                    completed={hasSelectedAccounts}
                  />
                  <CardDescription>
                    Select accounts to dispute. Review per-bureau status before selecting.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AccountReviewTable
                    accounts={state.accounts}
                    onAccountChange={handleAccountChange}
                    onSelectAll={handleSelectAllAccounts}
                    disabled={false}
                  />
                </CardContent>
              </Card>
            )}

            {/* SECTION 4: Outcome Confirmation */}
            <Card className={!canConfirmOutcome ? "opacity-50" : isOutcomeConfirmed ? "border-green-500/30" : ""}>
              <CardHeader>
                <SectionHeader 
                  number={4} 
                  title="Outcome Confirmation" 
                  icon={<CheckCircle2 className="w-5 h-5" />}
                  unlocked={canConfirmOutcome}
                  completed={isOutcomeConfirmed}
                />
                <CardDescription>Confirm the response behavior with quick yes/no questions.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <span className="text-sm">Did you receive a written response from the bureau?</span>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant={state.outcomeConfirmation.receivedResponse === true ? "default" : "outline"}
                        onClick={() => updateOutcome("receivedResponse", true)}
                        disabled={!canConfirmOutcome}
                      >
                        Yes
                      </Button>
                      <Button 
                        size="sm" 
                        variant={state.outcomeConfirmation.receivedResponse === false ? "default" : "outline"}
                        onClick={() => updateOutcome("receivedResponse", false)}
                        disabled={!canConfirmOutcome}
                      >
                        No
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <span className="text-sm">Was the response received within 30 days?</span>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant={state.outcomeConfirmation.responseWithin30Days === true ? "default" : "outline"}
                        onClick={() => updateOutcome("responseWithin30Days", true)}
                        disabled={!canConfirmOutcome}
                      >
                        Yes
                      </Button>
                      <Button 
                        size="sm" 
                        variant={state.outcomeConfirmation.responseWithin30Days === false ? "default" : "outline"}
                        onClick={() => updateOutcome("responseWithin30Days", false)}
                        disabled={!canConfirmOutcome}
                      >
                        No
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <span className="text-sm">Were all disputed items addressed?</span>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant={state.outcomeConfirmation.allItemsAddressed === true ? "default" : "outline"}
                        onClick={() => updateOutcome("allItemsAddressed", true)}
                        disabled={!canConfirmOutcome}
                      >
                        Yes
                      </Button>
                      <Button 
                        size="sm" 
                        variant={state.outcomeConfirmation.allItemsAddressed === false ? "default" : "outline"}
                        onClick={() => updateOutcome("allItemsAddressed", false)}
                        disabled={!canConfirmOutcome}
                      >
                        No
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <span className="text-sm">Were any previously deleted items reinserted?</span>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant={state.outcomeConfirmation.anyReinsertions === true ? "default" : "outline"}
                        onClick={() => updateOutcome("anyReinsertions", true)}
                        disabled={!canConfirmOutcome}
                      >
                        Yes
                      </Button>
                      <Button 
                        size="sm" 
                        variant={state.outcomeConfirmation.anyReinsertions === false ? "default" : "outline"}
                        onClick={() => updateOutcome("anyReinsertions", false)}
                        disabled={!canConfirmOutcome}
                      >
                        No
                      </Button>
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-sm">Additional Notes (Optional)</Label>
                  <Textarea
                    placeholder="Any observations about the response..."
                    value={state.outcomeConfirmation.notes}
                    onChange={(e) => updateOutcome("notes", e.target.value)}
                    rows={2}
                    disabled={!canConfirmOutcome}
                    className="mt-1"
                  />
                </div>
              </CardContent>
            </Card>

            {/* SECTION 5: Legal Strategy Survey */}
            <Card className={!canShowSurvey ? "opacity-50" : ""}>
              <CardHeader>
                <SectionHeader 
                  number={5} 
                  title="Legal Strategy Survey" 
                  icon={<Shield className="w-5 h-5" />}
                  unlocked={canShowSurvey}
                />
                <CardDescription>Answer these questions to strengthen your legal arguments.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {surveyQuestions.map((q) => (
                  <div key={q.key} className="flex items-start justify-between gap-4 p-3 rounded-lg bg-muted/30">
                    <div className="flex items-start gap-2 flex-1">
                      <span className="text-sm">{q.question}</span>
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="w-4 h-4 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="text-xs">{q.tooltip}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Switch
                      checked={state.survey[q.key] as boolean}
                      onCheckedChange={(checked) => updateSurvey(q.key, checked)}
                      disabled={!canShowSurvey}
                    />
                  </div>
                ))}

                {state.survey.wasReinserted && (
                  <Textarea
                    placeholder="Provide reinsertion details..."
                    value={state.survey.reinsertedDetails}
                    onChange={(e) => updateSurvey("reinsertedDetails", e.target.value)}
                    rows={2}
                    disabled={!canShowSurvey}
                  />
                )}

                <div>
                  <Label className="text-sm">Additional Facts</Label>
                  <Textarea
                    placeholder="Any other relevant facts to include in the letter..."
                    value={state.survey.additionalFacts}
                    onChange={(e) => updateSurvey("additionalFacts", e.target.value)}
                    rows={2}
                    disabled={!canShowSurvey}
                    className="mt-1"
                  />
                </div>
              </CardContent>
            </Card>

            {/* SECTION 6: Generate Next Legal Response */}
            <Card className={!canShowSurvey ? "opacity-50" : ""}>
              <CardHeader>
                <SectionHeader 
                  number={6} 
                  title="Generate Next Legal Response" 
                  icon={<FileText className="w-5 h-5" />}
                  unlocked={canShowSurvey}
                />
                <CardDescription>Your information and bureau will be auto-filled. Zero placeholders.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Consumer Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm">Full Legal Name *</Label>
                    <input
                      type="text"
                      value={state.consumerInfo.fullName}
                      onChange={(e) => updateConsumerInfo("fullName", e.target.value)}
                      placeholder="John Michael Smith"
                      disabled={!canShowSurvey}
                      className="w-full mt-1 px-3 py-2 bg-muted/30 border border-border rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Street Address *</Label>
                    <input
                      type="text"
                      value={state.consumerInfo.addressLine1}
                      onChange={(e) => updateConsumerInfo("addressLine1", e.target.value)}
                      placeholder="123 Main Street"
                      disabled={!canShowSurvey}
                      className="w-full mt-1 px-3 py-2 bg-muted/30 border border-border rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Apt / Suite</Label>
                    <input
                      type="text"
                      value={state.consumerInfo.addressLine2}
                      onChange={(e) => updateConsumerInfo("addressLine2", e.target.value)}
                      placeholder="Apt 4B"
                      disabled={!canShowSurvey}
                      className="w-full mt-1 px-3 py-2 bg-muted/30 border border-border rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">City, State ZIP *</Label>
                    <input
                      type="text"
                      value={state.consumerInfo.cityStateZip}
                      onChange={(e) => updateConsumerInfo("cityStateZip", e.target.value)}
                      placeholder="New York, NY 10001"
                      disabled={!canShowSurvey}
                      className="w-full mt-1 px-3 py-2 bg-muted/30 border border-border rounded-md text-sm"
                    />
                  </div>
                </div>

                {/* Bureau Selection - Multi-select */}
                <div>
                  <Label className="text-sm">Target Bureau(s)</Label>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {(Object.keys(BUREAU_DATA) as BureauKey[]).map((key) => (
                      <Button
                        key={key}
                        size="sm"
                        variant={state.selectedBureaus.includes(key) ? "default" : "outline"}
                        onClick={() => toggleBureauSelection(key)}
                        disabled={!canShowSurvey}
                      >
                        {state.selectedBureaus.includes(key) && <Check className="w-3 h-3 mr-1" />}
                        {key.charAt(0).toUpperCase() + key.slice(1)}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {state.selectedBureaus.length} bureau(s) selected
                  </p>
                </div>

                <Button 
                  onClick={handleGenerateLetter} 
                  disabled={!canGenerate || isGenerating}
                  className="w-full"
                  size="lg"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating Letter(s)...
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4 mr-2" />
                      Generate Dispute Letter(s)
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* SECTION 7: Generated Output */}
            {hasGeneratedLetter && (
              <Card className="border-primary/30">
                <CardHeader>
                  <SectionHeader 
                    number={7} 
                    title="Generated Output" 
                    icon={<FileCheck className="w-5 h-5" />}
                    unlocked={true}
                    completed={true}
                  />
                  <CardDescription>Your letters are ready. Review, edit if needed, and export.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Bureau tabs for letters */}
                  {state.selectedBureaus.length > 1 && (
                    <div className="flex gap-2 flex-wrap">
                      {state.selectedBureaus.map((bureau) => (
                        <Button
                          key={bureau}
                          size="sm"
                          variant={currentBureauLetter === bureau ? "default" : "outline"}
                          onClick={() => setCurrentBureauLetter(bureau)}
                        >
                          {bureau.charAt(0).toUpperCase() + bureau.slice(1)}
                          {state.generatedLetters[bureau] && (
                            <CheckCircle2 className="w-3 h-3 ml-1 text-green-400" />
                          )}
                        </Button>
                      ))}
                    </div>
                  )}

                  {/* Action Bar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setIsEditing(!isEditing)}>
                      {isEditing ? <Eye className="w-4 h-4 mr-1" /> : <Pencil className="w-4 h-4 mr-1" />}
                      {isEditing ? "Preview" : "Edit"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleCopy}>
                      {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button size="sm" variant="outline">
                      <Download className="w-4 h-4 mr-1" />
                      Export PDF
                    </Button>
                  </div>

                  {/* Letter Content */}
                  {isEditing ? (
                    <Textarea
                      value={state.generatedLetters[currentBureauLetter] || ""}
                      onChange={(e) => setState(prev => ({ 
                        ...prev, 
                        generatedLetters: { 
                          ...prev.generatedLetters, 
                          [currentBureauLetter]: e.target.value 
                        } 
                      }))}
                      rows={25}
                      className="font-mono text-sm"
                    />
                  ) : (
                    <div 
                      className="p-8 rounded-lg border border-border min-h-[400px]"
                      style={{ backgroundColor: '#ffffff', color: '#111111' }}
                    >
                      <pre className="whitespace-pre-wrap font-serif text-sm leading-relaxed">
                        {state.generatedLetters[currentBureauLetter] || "No letter generated for this bureau yet."}
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

          </div>
        </section>

        <Footer />
      </main>
    </TooltipProvider>
  );
};

export default Disputes;
