import { useState, useEffect, useRef, useCallback } from "react";
import mammoth from "mammoth";
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
  File,
  X,
  Lock,
  ChevronRight,
  Shield,
  Loader2,
  Copy,
  Check,
  Pencil,
  Eye,
  FileCheck,
  HelpCircle
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

const DISPUTES_STORAGE_KEY = "dispute-engine-state-v2";

// Bureau data
const BUREAU_DATA = {
  experian: {
    legalName: "Experian Information Solutions, Inc.",
    address: "P.O. Box 4500",
    cityStateZip: "Allen, TX 75013",
  },
  equifax: {
    legalName: "Equifax Information Services LLC",
    address: "P.O. Box 740256",
    cityStateZip: "Atlanta, GA 30374",
  },
  transunion: {
    legalName: "TransUnion LLC",
    address: "P.O. Box 2000",
    cityStateZip: "Chester, PA 19016",
  },
} as const;

type BureauKey = keyof typeof BUREAU_DATA;

// Analysis result from AI
interface AnalysisResult {
  bureau: BureauKey;
  outcome: "verified" | "partial" | "deleted" | "no_response" | "frivolous" | "reinsertion";
  itemsVerified: string[];
  itemsDeleted: string[];
  legalImplications: string[];
  nextSteps: string[];
  rawSummary: string;
}

// Outcome confirmation answers
interface OutcomeConfirmation {
  receivedResponse: boolean | null;
  responseWithin30Days: boolean | null;
  allItemsAddressed: boolean | null;
  anyReinsertions: boolean | null;
  notes: string;
}

// Survey answers (from DisputeLetterBuilder)
interface DisputeSurvey {
  isFraudulent: boolean;
  isIdentityTheft: boolean;
  hasPoliceReport: boolean;
  hasFtcReport: boolean;
  wasDataBreach: boolean;
  wasReinserted: boolean;
  reinsertedDetails: string;
  hadCreditorRelationship: boolean;
  belongsToAnotherPerson: boolean;
  hasPersonalInfoErrors: boolean;
  hasPreviousDisputes: boolean;
  additionalFacts: string;
}

// Consumer info
interface ConsumerInfo {
  fullName: string;
  addressLine1: string;
  addressLine2: string;
  cityStateZip: string;
}

// Uploaded file reference
interface UploadedFile {
  id: string;
  name: string;
  type: "bureau_response" | "prior_letter" | "supporting_doc";
  size: number;
  extractedText?: string;
}

// Persisted state
interface PersistedState {
  // Section 1: Evidence
  bureauResponseFiles: UploadedFile[];
  bureauResponseText: string;
  priorLetterFiles: UploadedFile[];
  priorLetterText: string;
  supportingDocFiles: UploadedFile[];
  
  // Section 2: Analysis
  analysisResult: AnalysisResult | null;
  isAnalyzed: boolean;
  
  // Section 3: Outcome Confirmation
  outcomeConfirmation: OutcomeConfirmation;
  
  // Section 4: Legal Survey
  survey: DisputeSurvey;
  
  // Section 5 & 6: Generated Letter
  selectedBureau: BureauKey | null;
  generatedLetter: string;
  consumerInfo: ConsumerInfo;
  
  // Imported data
  importedAnalyzerData: any | null;
  
  lastUpdated: string;
}

const defaultOutcomeConfirmation: OutcomeConfirmation = {
  receivedResponse: null,
  responseWithin30Days: null,
  allItemsAddressed: null,
  anyReinsertions: null,
  notes: "",
};

const defaultSurvey: DisputeSurvey = {
  isFraudulent: false,
  isIdentityTheft: false,
  hasPoliceReport: false,
  hasFtcReport: false,
  wasDataBreach: false,
  wasReinserted: false,
  reinsertedDetails: "",
  hadCreditorRelationship: false,
  belongsToAnotherPerson: false,
  hasPersonalInfoErrors: false,
  hasPreviousDisputes: false,
  additionalFacts: "",
};

const defaultConsumerInfo: ConsumerInfo = {
  fullName: "",
  addressLine1: "",
  addressLine2: "",
  cityStateZip: "",
};

const getDefaultState = (): PersistedState => ({
  bureauResponseFiles: [],
  bureauResponseText: "",
  priorLetterFiles: [],
  priorLetterText: "",
  supportingDocFiles: [],
  analysisResult: null,
  isAnalyzed: false,
  outcomeConfirmation: defaultOutcomeConfirmation,
  survey: defaultSurvey,
  selectedBureau: null,
  generatedLetter: "",
  consumerInfo: defaultConsumerInfo,
  importedAnalyzerData: null,
  lastUpdated: new Date().toISOString(),
});

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

// ============= UPLOAD COMPONENTS =============

interface FileDropzoneProps {
  onFileSelect: (file: File, extractedText?: string) => void;
  accept: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
  extractText?: boolean;
}

const FileDropzone = ({ onFileSelect, accept, label, description, icon, disabled, extractText }: FileDropzoneProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleClick = () => {
    if (!disabled) fileInputRef.current?.click();
  };

  const processFile = async (file: File) => {
    if (extractText && (file.name.endsWith('.docx') || file.name.endsWith('.txt'))) {
      setIsExtracting(true);
      try {
        let text = "";
        if (file.name.endsWith('.txt')) {
          text = await file.text();
        } else if (file.name.endsWith('.docx')) {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          text = result.value;
        }
        onFileSelect(file, text);
      } catch (err) {
        console.error("Text extraction error:", err);
        onFileSelect(file);
        toast.error("Could not extract text. Paste content manually.");
      } finally {
        setIsExtracting(false);
      }
    } else {
      onFileSelect(file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File size exceeds 10MB limit.");
        return;
      }
      await processFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File size exceeds 10MB limit.");
        return;
      }
      await processFile(file);
    }
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
      onDrop={handleDrop}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      onKeyDown={(e) => e.key === 'Enter' && !disabled && handleClick()}
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
        disabled 
          ? 'opacity-50 cursor-not-allowed border-border/50' 
          : isDragging 
            ? 'border-primary bg-primary/5 cursor-pointer' 
            : 'border-border hover:border-primary/50 cursor-pointer'
      }`}
    >
      {isExtracting ? (
        <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin mb-3" />
      ) : (
        <div className="w-8 h-8 mx-auto text-muted-foreground mb-3">{icon}</div>
      )}
      <p className="text-sm text-muted-foreground mb-2">{label}</p>
      <Button type="button" variant="outline" size="sm" disabled={disabled || isExtracting} onClick={(e) => { e.stopPropagation(); handleClick(); }}>
        {isExtracting ? "Extracting..." : "Choose File"}
      </Button>
      <p className="text-xs text-muted-foreground mt-2">{description}</p>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={handleFileChange}
        disabled={disabled}
      />
    </div>
  );
};

interface FileListProps {
  files: UploadedFile[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}

const FileList = ({ files, onRemove, disabled }: FileListProps) => {
  if (files.length === 0) return null;
  
  return (
    <div className="space-y-2 mt-3">
      {files.map((f) => (
        <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center gap-3">
            {disabled ? <Lock className="w-4 h-4 text-muted-foreground" /> : <File className="w-4 h-4 text-primary" />}
            <div>
              <p className="text-sm font-medium">{f.name}</p>
              <p className="text-xs text-muted-foreground">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          </div>
          {!disabled && (
            <Button variant="ghost" size="sm" onClick={() => onRemove(f.id)} className="text-muted-foreground hover:text-destructive">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
};

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
  const [state, setState] = useState<PersistedState>(getDefaultState);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);

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
        const parsed = JSON.parse(saved) as PersistedState;
        setState(parsed);
      }
    } catch (e) {
      console.error("Failed to load dispute engine state:", e);
    }
  }, []);

  // Auto-save state
  useEffect(() => {
    const toSave = { ...state, lastUpdated: new Date().toISOString() };
    localStorage.setItem(DISPUTES_STORAGE_KEY, JSON.stringify(toSave));
  }, [state]);

  // Populate consumer info from imported data
  useEffect(() => {
    if (state.importedAnalyzerData && !state.consumerInfo.fullName) {
      const data = state.importedAnalyzerData;
      setState(prev => ({
        ...prev,
        consumerInfo: {
          fullName: data.fullLegalName || "",
          addressLine1: data.currentAddress?.split(',')[0] || "",
          addressLine2: "",
          cityStateZip: data.currentAddress?.split(',').slice(1).join(',').trim() || "",
        }
      }));
    }
  }, [state.importedAnalyzerData, state.consumerInfo.fullName]);

  // ============= STATE CHECKS =============
  const hasEvidence = state.bureauResponseFiles.length > 0 || state.bureauResponseText.trim().length > 0;
  const isEvidenceLocked = state.isAnalyzed;
  const canAnalyze = hasEvidence && !state.isAnalyzed;
  const canConfirmOutcome = state.isAnalyzed;
  const isOutcomeConfirmed = state.outcomeConfirmation.receivedResponse !== null;
  const canShowSurvey = isOutcomeConfirmed;
  const canGenerate = canShowSurvey && state.selectedBureau && state.consumerInfo.fullName.trim();
  const hasGeneratedLetter = state.generatedLetter.length > 0;

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

  const addFile = (type: "bureau_response" | "prior_letter" | "supporting_doc", file: File, extractedText?: string) => {
    const newFile: UploadedFile = {
      id: crypto.randomUUID(),
      name: file.name,
      type,
      size: file.size,
      extractedText,
    };
    
    setState(prev => {
      if (type === "bureau_response") {
        return { ...prev, bureauResponseFiles: [...prev.bureauResponseFiles, newFile] };
      } else if (type === "prior_letter") {
        return { 
          ...prev, 
          priorLetterFiles: [...prev.priorLetterFiles, newFile],
          priorLetterText: extractedText || prev.priorLetterText,
        };
      } else {
        return { ...prev, supportingDocFiles: [...prev.supportingDocFiles, newFile] };
      }
    });
    toast.success(`${file.name} added.`);
  };

  const removeFile = (type: "bureau_response" | "prior_letter" | "supporting_doc", id: string) => {
    setState(prev => {
      if (type === "bureau_response") {
        return { ...prev, bureauResponseFiles: prev.bureauResponseFiles.filter(f => f.id !== id) };
      } else if (type === "prior_letter") {
        return { ...prev, priorLetterFiles: prev.priorLetterFiles.filter(f => f.id !== id) };
      } else {
        return { ...prev, supportingDocFiles: prev.supportingDocFiles.filter(f => f.id !== id) };
      }
    });
  };

  const handleAnalyze = async () => {
    if (!session?.access_token) {
      toast.error("Please log in to analyze responses.");
      return;
    }

    setIsAnalyzing(true);

    try {
      // For now, simulate analysis - this would call an edge function
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock analysis result
      const mockResult: AnalysisResult = {
        bureau: "experian",
        outcome: "verified",
        itemsVerified: ["Capital One Visa - Late payment verified"],
        itemsDeleted: [],
        legalImplications: [
          "Bureau claims verification but may not have obtained Method of Verification (MoV)",
          "FCRA §611(a)(6) requires bureaus to provide MoV upon request",
          "Failure to investigate properly is a willful violation under §616",
        ],
        nextSteps: [
          "Demand Method of Verification (MoV) from the bureau",
          "If MoV not provided within 15 days, file CFPB complaint",
          "Consider BBB complaint and State Attorney General escalation",
        ],
        rawSummary: "The bureau has verified the disputed item without providing adequate proof of investigation. This is a common tactic. Demand the Method of Verification to expose procedural failures.",
      };

      setState(prev => ({
        ...prev,
        analysisResult: mockResult,
        isAnalyzed: true,
        selectedBureau: mockResult.bureau,
      }));

      toast.success("Response analyzed. Review findings below.");
    } catch (err) {
      toast.error("Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateLetter = async () => {
    if (!session?.access_token || !state.selectedBureau) {
      toast.error("Please log in and select a bureau.");
      return;
    }

    if (!state.consumerInfo.fullName.trim() || !state.consumerInfo.addressLine1.trim()) {
      toast.error("Please complete your contact information.");
      return;
    }

    setIsGenerating(true);

    try {
      const bureau = BUREAU_DATA[state.selectedBureau];
      
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
            derogatoryAccounts: state.analysisResult?.itemsVerified.map(item => ({
              creditor_name: item.split(' - ')[0],
              account_number: "Unknown",
              date_opened: "Unknown",
              derogatory_triggers: [item.split(' - ')[1] || "Disputed item"],
            })) || [],
            inquiries: [],
            collections: [],
            chargeOffs: [],
            publicRecords: [],
          },
          consumerInfo: state.consumerInfo,
          bureau: {
            key: state.selectedBureau,
            legalName: bureau.legalName,
            address: bureau.address,
            cityStateZip: bureau.cityStateZip,
          },
          analysisContext: state.analysisResult,
          priorLetterText: state.priorLetterText,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate letter");
      }

      setState(prev => ({ ...prev, generatedLetter: data.letter }));
      toast.success("Letter generated successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(state.generatedLetter);
    setCopied(true);
    toast.success("Letter copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    if (confirm("Reset all data and start over?")) {
      localStorage.removeItem(DISPUTES_STORAGE_KEY);
      setState(getDefaultState());
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
                {/* Bureau Response */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">Bureau Response(s)</Label>
                  <FileDropzone
                    onFileSelect={(file) => addFile("bureau_response", file)}
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    label="Drop bureau response here or click to browse"
                    description="PDF, PNG, JPG, WebP (max 10MB)"
                    icon={<Upload className="w-8 h-8" />}
                    disabled={isEvidenceLocked}
                  />
                  <FileList 
                    files={state.bureauResponseFiles} 
                    onRemove={(id) => removeFile("bureau_response", id)} 
                    disabled={isEvidenceLocked}
                  />
                  {!isEvidenceLocked && (
                    <div className="mt-3">
                      <Label className="text-xs text-muted-foreground">Or paste response text</Label>
                      <Textarea
                        placeholder="Paste bureau response text..."
                        value={state.bureauResponseText}
                        onChange={(e) => setState(prev => ({ ...prev, bureauResponseText: e.target.value }))}
                        rows={3}
                        className="mt-1"
                      />
                    </div>
                  )}
                </div>

                {/* Prior Letter */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">Prior Dispute Letter(s)</Label>
                  <FileDropzone
                    onFileSelect={(file, text) => addFile("prior_letter", file, text)}
                    accept=".docx,.pdf,.txt"
                    label="Drop prior letter here or click to browse"
                    description="DOCX, PDF, TXT (max 10MB)"
                    icon={<FileText className="w-8 h-8" />}
                    disabled={isEvidenceLocked}
                    extractText
                  />
                  <FileList 
                    files={state.priorLetterFiles} 
                    onRemove={(id) => removeFile("prior_letter", id)} 
                    disabled={isEvidenceLocked}
                  />
                  {state.priorLetterText && (
                    <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border">
                      <p className="text-xs text-muted-foreground mb-1">Extracted Text:</p>
                      <p className="text-sm line-clamp-3">{state.priorLetterText}</p>
                    </div>
                  )}
                </div>

                {/* Supporting Docs */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">Supporting Documents</Label>
                  <FileDropzone
                    onFileSelect={(file) => addFile("supporting_doc", file)}
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt"
                    label="Drop supporting docs (ID, utility bill, FTC report)"
                    description="Any format (max 10MB)"
                    icon={<FileCheck className="w-8 h-8" />}
                    disabled={isEvidenceLocked}
                  />
                  <FileList 
                    files={state.supportingDocFiles} 
                    onRemove={(id) => removeFile("supporting_doc", id)} 
                    disabled={isEvidenceLocked}
                  />
                </div>
              </CardContent>
            </Card>

            {/* SECTION 2: Bureau Response Analysis */}
            <Card className={!hasEvidence ? "opacity-50" : state.isAnalyzed ? "border-green-500/30" : ""}>
              <CardHeader>
                <SectionHeader 
                  number={2} 
                  title="Bureau Response Analysis" 
                  icon={<Scale className="w-5 h-5" />}
                  unlocked={hasEvidence}
                  completed={state.isAnalyzed}
                />
                <CardDescription>
                  {state.isAnalyzed 
                    ? "Analysis complete. Review the outcome below." 
                    : "Analyze the bureau response to classify outcome and surface legal implications."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!state.isAnalyzed ? (
                  <Button 
                    onClick={handleAnalyze} 
                    disabled={!canAnalyze || isAnalyzing}
                    className="w-full"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing Response...
                      </>
                    ) : (
                      <>
                        <ChevronRight className="w-4 h-4 mr-2" />
                        Analyze Response
                      </>
                    )}
                  </Button>
                ) : state.analysisResult && (
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
                    </div>

                    {/* Summary */}
                    <div className="p-4 rounded-lg bg-muted/30 border border-border">
                      <p className="text-sm">{state.analysisResult.rawSummary}</p>
                    </div>

                    {/* Legal Implications */}
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

                    {/* Next Steps */}
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
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SECTION 3: Outcome Confirmation */}
            <Card className={!canConfirmOutcome ? "opacity-50" : isOutcomeConfirmed ? "border-green-500/30" : ""}>
              <CardHeader>
                <SectionHeader 
                  number={3} 
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

            {/* SECTION 4: Legal Strategy Survey */}
            <Card className={!canShowSurvey ? "opacity-50" : ""}>
              <CardHeader>
                <SectionHeader 
                  number={4} 
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

            {/* SECTION 5: Generate Next Legal Response */}
            <Card className={!canShowSurvey ? "opacity-50" : ""}>
              <CardHeader>
                <SectionHeader 
                  number={5} 
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

                {/* Bureau Selection */}
                <div>
                  <Label className="text-sm">Target Bureau</Label>
                  <div className="flex gap-2 mt-2">
                    {(Object.keys(BUREAU_DATA) as BureauKey[]).map((key) => (
                      <Button
                        key={key}
                        size="sm"
                        variant={state.selectedBureau === key ? "default" : "outline"}
                        onClick={() => setState(prev => ({ ...prev, selectedBureau: key }))}
                        disabled={!canShowSurvey}
                      >
                        {key.charAt(0).toUpperCase() + key.slice(1)}
                      </Button>
                    ))}
                  </div>
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
                      Generating Letter...
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4 mr-2" />
                      Generate Dispute Letter
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* SECTION 6: Generated Output */}
            {hasGeneratedLetter && (
              <Card className="border-primary/30">
                <CardHeader>
                  <SectionHeader 
                    number={6} 
                    title="Generated Output" 
                    icon={<FileCheck className="w-5 h-5" />}
                    unlocked={true}
                    completed={true}
                  />
                  <CardDescription>Your letter is ready. Review, edit if needed, and export.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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
                      value={state.generatedLetter}
                      onChange={(e) => setState(prev => ({ ...prev, generatedLetter: e.target.value }))}
                      rows={25}
                      className="font-mono text-sm"
                    />
                  ) : (
                    <div 
                      className="p-8 rounded-lg border border-border min-h-[400px]"
                      style={{ backgroundColor: '#ffffff', color: '#111111' }}
                    >
                      <pre className="whitespace-pre-wrap font-serif text-sm leading-relaxed">
                        {state.generatedLetter}
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
