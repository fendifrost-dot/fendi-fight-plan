import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { FileText, Loader2, Copy, Check, AlertTriangle, Scale, Shield, HelpCircle, User, MapPin, Building2, Pencil, Eye, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Storage key for persistence
const STORAGE_KEY = "dispute_letter_builder_state";

// HARDCODED BUREAU DATA (NON-NEGOTIABLE)
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

// Consumer info interface
interface ConsumerInfo {
  fullName: string;
  addressLine1: string;
  addressLine2: string;
  cityStateZip: string;
}

// Survey answers interface
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

// Extracted data interface (from analysis)
interface ExtractedData {
  fullLegalName: string;
  currentAddress: string;
  inaccurateNames: { reported_name: string; mismatch_reason: string; source?: string }[];
  inaccurateAddresses: { reported_address: string; linked_to_derogatory: boolean; source?: string }[];
  derogatoryAccounts: {
    creditor_name: string;
    account_number: string;
    date_opened: string;
    derogatory_triggers: string[];
    source?: string;
  }[];
  inquiries: { creditor_name: string; date: string; type: string; source?: string }[];
  collections: { creditor_name: string; account_number: string; original_creditor: string; balance: string; source?: string }[];
  chargeOffs: { creditor_name: string; account_number: string; date_charged_off: string; balance: string; source?: string }[];
  publicRecords: { type: string; court_jurisdiction: string; filing_date: string; status: string; source?: string }[];
}

// Persisted state interface
interface PersistedState {
  consumerInfo: ConsumerInfo;
  selectedBureaus: BureauKey[];
  survey: DisputeSurvey;
  generatedLetters: { bureau: BureauKey; letter: string }[];
  timestamp: number;
}

interface DisputeLetterBuilderProps {
  extractedData: ExtractedData;
  accessToken: string;
}

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
    tooltip: "Police reports are NOT legally required for disputes but strengthen claims.",
  },
  {
    key: "hasFtcReport" as const,
    question: "Have you filed an FTC Identity Theft Report?",
    tooltip: "An FTC report at identitytheft.gov provides legal documentation of identity theft.",
  },
  {
    key: "wasDataBreach" as const,
    question: "Have you been exposed to a known data breach?",
    tooltip: "Data breaches at financial institutions, employers, or government agencies trigger heightened duty of care.",
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
    question: "Are there inaccuracies in your personal info (name, address, employer) that caused these accounts to be reported?",
    tooltip: "Identifier errors undermine the accuracy of associated account data.",
  },
  {
    key: "hasPreviousDisputes" as const,
    question: "Have you previously disputed any of these items with the bureaus?",
    tooltip: "Prior disputes without proper investigation = FCRA violation.",
  },
];

// Helper to load persisted state from localStorage
const loadPersistedState = (): PersistedState | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as PersistedState;
    // Check if data is less than 24 hours old
    if (Date.now() - parsed.timestamp > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

// Helper to save state to localStorage
const savePersistedState = (state: Omit<PersistedState, 'timestamp'>) => {
  try {
    const toSave: PersistedState = { ...state, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Silently fail if storage is full or unavailable
  }
};

const DisputeLetterBuilder = ({ extractedData, accessToken }: DisputeLetterBuilderProps) => {
  const { toast } = useToast();

  // Parse extracted address into components if available
  const parseAddress = (addr: string) => {
    // Try to parse "City, State ZIP" pattern from the end
    const parts = addr.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      return {
        line1: parts.slice(0, -1).join(', '),
        cityStateZip: parts[parts.length - 1],
      };
    }
    return { line1: addr, cityStateZip: '' };
  };

  const parsedAddr = parseAddress(extractedData.currentAddress || '');

  // Build the canonical consumer info from current extractedData props.
  // This is recomputed on every render so we always have the latest client data.
  const currentClientInfo = useMemo<ConsumerInfo>(() => ({
    fullName: extractedData.fullLegalName || '',
    addressLine1: parsedAddr.line1,
    addressLine2: '',
    cityStateZip: parsedAddr.cityStateZip,
  }), [extractedData.fullLegalName, parsedAddr.line1, parsedAddr.cityStateZip]);

  // Track which client's data we last hydrated (using a ref to avoid re-render loops)
  const lastHydratedRef = useRef<string>('');

  // Consumer info state - ALWAYS initialize from current extractedData, never localStorage
  const [consumerInfo, setConsumerInfo] = useState<ConsumerInfo>(() => {
    lastHydratedRef.current = `${extractedData.fullLegalName}|${extractedData.currentAddress}`;
    return currentClientInfo;
  });

  // CRITICAL: When extractedData changes (new client analyzed), reset consumer info.
  // Uses a ref comparison so it works even when both clients have empty identity fields
  // (the analysis results / accounts will differ, triggering a prop change upstream).
  useEffect(() => {
    const newKey = `${extractedData.fullLegalName}|${extractedData.currentAddress}`;
    if (newKey !== lastHydratedRef.current) {
      // New client detected - discard all prior state and hydrate fresh
      setConsumerInfo(currentClientInfo);
      lastHydratedRef.current = newKey;
      // Clear persisted state so old client data doesn't resurface on remount
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [extractedData.fullLegalName, extractedData.currentAddress, currentClientInfo]);

  // Bureau selection
  const [selectedBureaus, setSelectedBureaus] = useState<BureauKey[]>([]);

  const [survey, setSurvey] = useState<DisputeSurvey>({
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
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedLetters, setGeneratedLetters] = useState<{ bureau: BureauKey; letter: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Auto-save state to localStorage on every change
  useEffect(() => {
    savePersistedState({
      consumerInfo,
      selectedBureaus,
      survey,
      generatedLetters,
    });
  }, [consumerInfo, selectedBureaus, survey, generatedLetters]);

  // Clear persisted state
  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setConsumerInfo({
      fullName: extractedData.fullLegalName || '',
      addressLine1: parsedAddr.line1,
      addressLine2: '',
      cityStateZip: parsedAddr.cityStateZip,
    });
    setSelectedBureaus([]);
    setSurvey({
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
    });
    setGeneratedLetters([]);
    setError(null);
    setEditingIndex(null);
    toast({
      title: "Session cleared",
      description: "All inputs and generated letters have been reset.",
    });
  }, [extractedData.fullLegalName, parsedAddr.line1, parsedAddr.cityStateZip, toast]);

  const updateConsumerInfo = <K extends keyof ConsumerInfo>(key: K, value: string) => {
    setConsumerInfo(prev => ({ ...prev, [key]: value }));
  };

  const toggleBureau = (bureau: BureauKey) => {
    setSelectedBureaus(prev =>
      prev.includes(bureau)
        ? prev.filter(b => b !== bureau)
        : [...prev, bureau]
    );
  };

  const updateSurvey = <K extends keyof DisputeSurvey>(key: K, value: DisputeSurvey[K]) => {
    setSurvey(prev => ({ ...prev, [key]: value }));
  };

  // Validation: Check if all required fields are filled
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!consumerInfo.fullName.trim()) errors.push("Full legal name is required");
    if (!consumerInfo.addressLine1.trim()) errors.push("Street address is required");
    if (!consumerInfo.cityStateZip.trim()) errors.push("City, State, ZIP is required");
    if (selectedBureaus.length === 0) errors.push("Select at least one credit bureau");
    return errors;
  }, [consumerInfo, selectedBureaus]);

  const canGenerate = validationErrors.length === 0;

  const handleGenerateLetter = async () => {
    if (!canGenerate) {
      setError(`Cannot generate letter: ${validationErrors.join(', ')}`);
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedLetters([]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s for multiple letters

    try {
      // Generate letters for each selected bureau
      const letterPromises = selectedBureaus.map(async (bureauKey) => {
        const bureau = BUREAU_DATA[bureauKey];
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-dispute-letter`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            survey,
            extractedData,
            consumerInfo,
            bureau: {
              key: bureauKey,
              legalName: bureau.legalName,
              address: bureau.address,
              cityStateZip: bureau.cityStateZip,
            },
          }),
          signal: controller.signal,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || `Failed to generate letter for ${bureau.legalName}`);
        }

        return { bureau: bureauKey, letter: data.letter };
      });

      const results = await Promise.all(letterPromises);
      setGeneratedLetters(results);

      toast({
        title: `${results.length} dispute letter${results.length > 1 ? 's' : ''} generated`,
        description: "Your letters are ready. Review and copy them.",
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Letter generation timed out. Please try again.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
      toast({
        title: "Generation failed",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      clearTimeout(timeoutId);
      setIsGenerating(false);
    }
  };

  const copyLetter = async (index: number) => {
    const letter = generatedLetters[index]?.letter;
    if (!letter) return;
    await navigator.clipboard.writeText(letter);
    setCopiedIndex(index);
    toast({
      title: "Copied to clipboard",
      description: `${BUREAU_DATA[generatedLetters[index].bureau].legalName} letter copied`,
    });
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Count disputable items
  const totalItems =
    extractedData.inaccurateNames.length +
    extractedData.inaccurateAddresses.length +
    extractedData.derogatoryAccounts.length +
    extractedData.inquiries.length +
    extractedData.collections.length +
    extractedData.chargeOffs.length +
    extractedData.publicRecords.length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-full mb-6">
          <Scale className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-primary">Dispute-Grade Document</span>
        </div>
        <h3 className="text-2xl md:text-3xl font-serif font-bold text-foreground mb-3">
          Dispute Letter Builder
        </h3>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Generate print-ready dispute letters for {totalItems} identified items.
          All letters are automatically addressed with correct bureau information.
        </p>
      </div>

      {/* Step 1: Consumer Information */}
      <div className="card-elevated rounded-2xl border border-border/50 p-6 md:p-8">
        <h4 className="text-lg font-serif font-semibold text-foreground mb-6 flex items-center gap-2">
          <User className="w-5 h-5 text-primary" />
          Step 1: Your Information
        </h4>
        <p className="text-sm text-muted-foreground mb-6">
          This information will appear in the letterhead. Pre-populated from your credit report.
        </p>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Legal Name *</Label>
            <Input
              id="fullName"
              placeholder="John Michael Smith"
              value={consumerInfo.fullName}
              onChange={(e) => updateConsumerInfo('fullName', e.target.value)}
              className="bg-muted/30"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="addressLine1">Street Address *</Label>
            <Input
              id="addressLine1"
              placeholder="123 Main Street"
              value={consumerInfo.addressLine1}
              onChange={(e) => updateConsumerInfo('addressLine1', e.target.value)}
              className="bg-muted/30"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="addressLine2">Apartment / Suite (Optional)</Label>
            <Input
              id="addressLine2"
              placeholder="Apt 4B"
              value={consumerInfo.addressLine2}
              onChange={(e) => updateConsumerInfo('addressLine2', e.target.value)}
              className="bg-muted/30"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cityStateZip">City, State ZIP *</Label>
            <Input
              id="cityStateZip"
              placeholder="New York, NY 10001"
              value={consumerInfo.cityStateZip}
              onChange={(e) => updateConsumerInfo('cityStateZip', e.target.value)}
              className="bg-muted/30"
            />
          </div>
        </div>

        {/* Clear Session Button */}
        {(generatedLetters.length > 0 || selectedBureaus.length > 0) && (
          <div className="mt-6 pt-4 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSession}
              className="text-muted-foreground hover:text-destructive"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Clear Session & Start Over
            </Button>
          </div>
        )}
      </div>

      {/* Step 2: Bureau Selection */}
      <div className="card-elevated rounded-2xl border border-border/50 p-6 md:p-8">
        <h4 className="text-lg font-serif font-semibold text-foreground mb-6 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          Step 2: Select Credit Bureau(s) *
        </h4>
        <p className="text-sm text-muted-foreground mb-6">
          A separate letter will be generated for each bureau selected. Addresses are pre-configured.
        </p>

        <div className="grid gap-4">
          {(Object.keys(BUREAU_DATA) as BureauKey[]).map((key) => {
            const bureau = BUREAU_DATA[key];
            const isSelected = selectedBureaus.includes(key);
            return (
              <label
                key={key}
                className={cn(
                  "flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border/50 bg-muted/20 hover:bg-muted/40"
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleBureau(key)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="font-semibold text-foreground">{bureau.legalName}</p>
                  <p className="text-sm text-muted-foreground">{bureau.address}</p>
                  <p className="text-sm text-muted-foreground">{bureau.cityStateZip}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Step 3: Survey */}
      <div className="card-elevated rounded-2xl border border-border/50 p-6 md:p-8">
        <h4 className="text-lg font-serif font-semibold text-foreground mb-6 flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          Step 3: Dispute Survey
        </h4>
        <p className="text-sm text-muted-foreground mb-6">
          Your answers shape the legal arguments in your dispute letter.
        </p>

        <div className="space-y-6">
          <TooltipProvider>
            {surveyQuestions.map((q) => (
              <div key={q.key} className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-foreground font-medium cursor-pointer">
                      {q.question}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>{q.tooltip}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "text-sm font-medium",
                      !survey[q.key] ? "text-muted-foreground" : "text-muted-foreground/50"
                    )}>No</span>
                    <Switch
                      checked={survey[q.key] as boolean}
                      onCheckedChange={(checked) => updateSurvey(q.key, checked)}
                    />
                    <span className={cn(
                      "text-sm font-medium",
                      survey[q.key] ? "text-primary" : "text-muted-foreground/50"
                    )}>Yes</span>
                  </div>
                </div>

                {/* Conditional details field */}
                {q.hasDetails && survey[q.key] && (
                  <Textarea
                    placeholder={q.detailsPlaceholder}
                    value={survey[q.detailsKey!] as string}
                    onChange={(e) => updateSurvey(q.detailsKey!, e.target.value)}
                    className="bg-muted/30 border-border/50 min-h-[80px]"
                  />
                )}
              </div>
            ))}
          </TooltipProvider>

          {/* Additional facts */}
          <div className="space-y-2 pt-4 border-t border-border/50">
            <Label className="text-foreground font-medium">
              Additional Facts or Context (Optional)
            </Label>
            <Textarea
              placeholder="Add any additional facts, context, or assertions you want included in the dispute letter..."
              value={survey.additionalFacts}
              onChange={(e) => updateSurvey("additionalFacts", e.target.value)}
              className="bg-muted/30 border-border/50 min-h-[100px]"
            />
          </div>
        </div>
      </div>

      {/* Items Summary */}
      <div className="card-elevated rounded-xl border border-border/50 p-6">
        <h4 className="text-lg font-serif font-semibold text-foreground mb-4">
          Items to be Disputed
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-2xl font-bold text-foreground">{extractedData.inaccurateNames.length}</p>
            <p className="text-sm text-muted-foreground">Inaccurate Names</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-2xl font-bold text-foreground">{extractedData.inaccurateAddresses.length}</p>
            <p className="text-sm text-muted-foreground">Inaccurate Addresses</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-2xl font-bold text-destructive">{extractedData.derogatoryAccounts.length + extractedData.collections.length + extractedData.chargeOffs.length}</p>
            <p className="text-sm text-muted-foreground">Derogatory Accounts</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-2xl font-bold text-foreground">{extractedData.inquiries.length}</p>
            <p className="text-sm text-muted-foreground">Inquiries</p>
          </div>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-warning/10 border border-warning/30 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-warning">Missing required information:</p>
            <ul className="list-disc list-inside text-sm text-warning/80 mt-1">
              {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Generate Button */}
      <Button
        onClick={handleGenerateLetter}
        disabled={isGenerating || !canGenerate}
        className="w-full py-6 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Generating {selectedBureaus.length} Letter{selectedBureaus.length > 1 ? 's' : ''}...
          </>
        ) : (
          <>
            <FileText className="w-5 h-5 mr-2" />
            Generate {selectedBureaus.length > 0 ? selectedBureaus.length : ''} Dispute Letter{selectedBureaus.length !== 1 ? 's' : ''}
          </>
        )}
      </Button>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
          <p className="text-destructive">{error}</p>
        </div>
      )}

      {/* Generated Letters */}
      {generatedLetters.map((item, index) => {
        const isEditing = editingIndex === index;
        return (
        <div key={item.bureau} className="card-elevated rounded-2xl border border-primary/30 p-6 md:p-8 animate-slide-up">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <h4 className="text-xl font-serif font-semibold text-foreground flex items-center gap-2">
              <Scale className="w-5 h-5 text-primary" />
              {BUREAU_DATA[item.bureau].legalName}
            </h4>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setEditingIndex(isEditing ? null : index)}
              >
                {isEditing ? <Eye className="w-4 h-4 mr-2" /> : <Pencil className="w-4 h-4 mr-2" />}
                {isEditing ? "View" : "Edit"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => copyLetter(index)}>
                {copiedIndex === index ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copiedIndex === index ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          {/* PRINT-READY LETTER CONTAINER - Explicit styling to prevent theme inheritance */}
          <div 
            className="rounded-xl border shadow-inner print:shadow-none print:border-none print:p-0"
            style={{ 
              backgroundColor: '#ffffff', 
              color: '#111111',
              borderColor: '#e5e7eb'
            }}
          >
            {isEditing ? (
              <textarea
                value={item.letter}
                onChange={(e) => {
                  const newLetters = [...generatedLetters];
                  newLetters[index] = { ...item, letter: e.target.value };
                  setGeneratedLetters(newLetters);
                }}
                className="w-full min-h-[600px] p-6 md:p-8 font-serif text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 rounded-xl"
                style={{ 
                  backgroundColor: '#ffffff', 
                  color: '#111111',
                  border: 'none'
                }}
              />
            ) : (
              <pre 
                className="whitespace-pre-wrap font-serif text-sm leading-relaxed print:text-base p-6 md:p-8"
                style={{ color: '#111111' }}
              >
                {item.letter}
              </pre>
            )}
          </div>

          <div className="mt-6 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-start gap-2">
              <MapPin className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="text-sm text-foreground">
                <p className="font-semibold mb-1">Send via Certified Mail to:</p>
                <p>{BUREAU_DATA[item.bureau].legalName}</p>
                <p>{BUREAU_DATA[item.bureau].address}</p>
                <p>{BUREAU_DATA[item.bureau].cityStateZip}</p>
              </div>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
};

export default DisputeLetterBuilder;