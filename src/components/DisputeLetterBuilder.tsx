import { useState } from "react";
import { FileText, Loader2, Copy, Check, AlertTriangle, Scale, ChevronRight, Shield, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

const DisputeLetterBuilder = ({ extractedData, accessToken }: DisputeLetterBuilderProps) => {
  const { toast } = useToast();
  
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
  const [generatedLetter, setGeneratedLetter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const updateSurvey = <K extends keyof DisputeSurvey>(key: K, value: DisputeSurvey[K]) => {
    setSurvey(prev => ({ ...prev, [key]: value }));
  };

  const handleGenerateLetter = async () => {
    setIsGenerating(true);
    setError(null);
    setGeneratedLetter(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout for letter generation

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-dispute-letter`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          survey,
          extractedData,
        }),
        signal: controller.signal,
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate dispute letter");
      }

      setGeneratedLetter(data.letter);
      toast({
        title: "Dispute letter generated",
        description: "Your dispute letter is ready. Review and copy it.",
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

  const copyLetter = async () => {
    if (!generatedLetter) return;
    await navigator.clipboard.writeText(generatedLetter);
    setCopied(true);
    toast({
      title: "Copied to clipboard",
      description: "Dispute letter copied successfully",
    });
    setTimeout(() => setCopied(false), 2000);
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
          Answer the following questions to generate a legally-grounded dispute letter 
          citing FCRA statutes and incorporating all {totalItems} identified items.
        </p>
      </div>

      {/* Survey Section */}
      <div className="card-elevated rounded-2xl border border-border/50 p-6 md:p-8">
        <h4 className="text-lg font-serif font-semibold text-foreground mb-6 flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          Required Survey
        </h4>
        
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

      {/* Generate Button */}
      <Button
        onClick={handleGenerateLetter}
        disabled={isGenerating}
        className="w-full py-6 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Generating Dispute Letter...
          </>
        ) : (
          <>
            <FileText className="w-5 h-5 mr-2" />
            Generate Dispute Letter
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

      {/* Generated Letter */}
      {generatedLetter && (
        <div className="card-elevated rounded-2xl border border-primary/30 p-6 md:p-8 animate-slide-up">
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-xl font-serif font-semibold text-foreground flex items-center gap-2">
              <Scale className="w-5 h-5 text-primary" />
              Your Dispute Letter
            </h4>
            <Button variant="outline" onClick={copyLetter}>
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? "Copied" : "Copy Letter"}
            </Button>
          </div>
          
          <div className="bg-muted/30 rounded-xl p-6 border border-border/50">
            <pre className="whitespace-pre-wrap font-sans text-foreground text-sm leading-relaxed">
              {generatedLetter}
            </pre>
          </div>

          <div className="mt-6 p-4 bg-warning/10 border border-warning/30 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div className="text-sm text-warning/90">
                <p className="font-semibold mb-1">Before sending:</p>
                <ul className="space-y-1 ml-4 list-disc">
                  <li>Review the letter for accuracy</li>
                  <li>Add your signature and date</li>
                  <li>Include copies of identity documents</li>
                  <li>Send via certified mail with return receipt</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DisputeLetterBuilder;
