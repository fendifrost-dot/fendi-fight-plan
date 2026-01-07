import { useState, useRef, useEffect } from "react";
import { Upload, FileText, Loader2, AlertCircle, Copy, Check, Sparkles, ChevronRight, AlertTriangle, LogIn, X, Plus, Download, User, MapPin, Briefcase, Phone, Mail, Calendar, Hash, Shield } from "lucide-react";
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

// Dispute-grade analysis result interface
interface DisputeAnalysisResult {
  inaccurate_names: {
    reported_name: string;
    mismatch_reason: string;
  }[];
  inaccurate_addresses: {
    reported_address: string;
    linked_to_derogatory: boolean;
  }[];
  inaccurate_employers: {
    reported_employer: string;
  }[];
  extra_identifier_mismatches: {
    field: string;
    reported_value: string;
    status: string;
  }[];
  derogatory_accounts: {
    creditor_name: string;
    account_number: string;
    date_opened: string;
    derogatory_triggers: string[];
    status_as_reported: string;
    confidence: "high" | "medium" | "low";
  }[];
  late_payment_summary: {
    severity: "30-day" | "60-day" | "90-day";
    accounts: {
      creditor_name: string;
      account_number: string;
      months_detected: string;
    }[];
  }[];
  collections: {
    creditor_name: string;
    account_number: string;
    original_creditor: string;
    balance: string;
  }[];
  charge_offs: {
    creditor_name: string;
    account_number: string;
    date_charged_off: string;
    balance: string;
  }[];
  public_records: {
    type: string;
    court_jurisdiction: string;
    filing_date: string;
    status: string;
  }[];
  inquiries: {
    creditor_name: string;
    date: string;
    type: string;
  }[];
  summary: string;
  next_steps: string[];
  warnings: string[];
}

const AIAnalyzer = () => {
  // Questionnaire fields (ground truth)
  const [fullLegalName, setFullLegalName] = useState("");
  const [currentAddress, setCurrentAddress] = useState("");
  const [currentEmployer, setCurrentEmployer] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [ssnLast4, setSsnLast4] = useState("");
  
  // Upload fields
  const [responseText, setResponseText] = useState("");
  const [responseImages, setResponseImages] = useState<string[]>([]);
  const [imageNames, setImageNames] = useState<string[]>([]);
  const [bureau, setBureau] = useState("");
  const [identityDocs, setIdentityDocs] = useState("");
  
  // State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<DisputeAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxFiles = 10;
    const maxSize = 10 * 1024 * 1024; // 10MB per file
    
    if (responseImages.length + files.length > maxFiles) {
      toast({
        title: "Too many files",
        description: `Maximum ${maxFiles} images allowed`,
        variant: "destructive",
      });
      return;
    }

    files.forEach(file => {
      if (file.size > maxSize) {
        toast({
          title: "File too large",
          description: `${file.name} exceeds 10MB limit`,
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        setResponseImages(prev => [...prev, event.target?.result as string]);
        setImageNames(prev => [...prev, file.name]);
        setResponseText("");
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setResponseImages(prev => prev.filter((_, i) => i !== index));
    setImageNames(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllImages = () => {
    setResponseImages([]);
    setImageNames([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleAnalyze = async () => {
    // Validate required fields
    if (!fullLegalName.trim()) {
      toast({
        title: "Required field missing",
        description: "Please enter your full legal name",
        variant: "destructive",
      });
      return;
    }
    if (!currentAddress.trim()) {
      toast({
        title: "Required field missing",
        description: "Please enter your current address",
        variant: "destructive",
      });
      return;
    }
    if (!currentEmployer.trim()) {
      toast({
        title: "Required field missing",
        description: "Please enter your current employer",
        variant: "destructive",
      });
      return;
    }

    if (!responseText && responseImages.length === 0) {
      toast({
        title: "No input provided",
        description: "Please upload images or paste the credit report text",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      if (!session?.access_token) {
        setError("Please log in to use the analyzer");
        toast({
          title: "Authentication required",
          description: "Please log in to use the analyzer",
          variant: "destructive",
        });
        setIsAnalyzing(false);
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-response`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          // Questionnaire data (ground truth)
          questionnaire: {
            fullLegalName: fullLegalName.trim(),
            currentAddress: currentAddress.trim(),
            currentEmployer: currentEmployer.trim(),
            dateOfBirth: dateOfBirth || undefined,
            phoneNumber: phoneNumber || undefined,
            email: email || undefined,
            ssnLast4: ssnLast4 || undefined,
          },
          // Report data
          responseText: responseText || undefined,
          responseImages: responseImages.length > 0 ? responseImages : undefined,
          bureau: bureau || undefined,
          hasIdentityDocs: identityDocs || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast({
        title: "Analysis failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
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

  const copyAllResults = async () => {
    if (!result) return;
    
    let fullText = "CREDIT REPORT DISPUTE ANALYSIS\n";
    fullText += "=".repeat(50) + "\n\n";
    
    if (result.inaccurate_names.length > 0) {
      fullText += "INACCURATE NAMES:\n";
      result.inaccurate_names.forEach(item => {
        fullText += `• "${item.reported_name}" - ${item.mismatch_reason}\n`;
      });
      fullText += "\n";
    }
    
    if (result.inaccurate_addresses.length > 0) {
      fullText += "INACCURATE ADDRESSES:\n";
      result.inaccurate_addresses.forEach(item => {
        fullText += `• ${item.reported_address}${item.linked_to_derogatory ? " [LINKED TO DEROGATORY]" : ""}\n`;
      });
      fullText += "\n";
    }
    
    if (result.inaccurate_employers.length > 0) {
      fullText += "INACCURATE EMPLOYERS:\n";
      result.inaccurate_employers.forEach(item => {
        fullText += `• ${item.reported_employer}\n`;
      });
      fullText += "\n";
    }
    
    if (result.extra_identifier_mismatches.length > 0) {
      fullText += "EXTRA IDENTIFIER MISMATCHES:\n";
      result.extra_identifier_mismatches.forEach(item => {
        fullText += `• ${item.field}: "${item.reported_value}" - ${item.status}\n`;
      });
      fullText += "\n";
    }
    
    if (result.derogatory_accounts.length > 0) {
      fullText += "DEROGATORY ACCOUNTS:\n";
      result.derogatory_accounts.forEach(item => {
        fullText += `• ${item.creditor_name} (${item.account_number})\n`;
        fullText += `  Date Opened: ${item.date_opened}\n`;
        fullText += `  Triggers: ${item.derogatory_triggers.join(", ")}\n`;
        fullText += `  Status: ${item.status_as_reported} | Confidence: ${item.confidence}\n`;
      });
      fullText += "\n";
    }
    
    if (result.late_payment_summary.length > 0) {
      fullText += "LATE PAYMENT SUMMARY:\n";
      result.late_payment_summary.forEach(severity => {
        fullText += `\n${severity.severity.toUpperCase()} LATES:\n`;
        severity.accounts.forEach(acc => {
          fullText += `• ${acc.creditor_name} (${acc.account_number}) - ${acc.months_detected}\n`;
        });
      });
      fullText += "\n";
    }
    
    if (result.collections.length > 0) {
      fullText += "COLLECTIONS:\n";
      result.collections.forEach(item => {
        fullText += `• ${item.creditor_name} (${item.account_number}) - Balance: ${item.balance}\n`;
        if (item.original_creditor) fullText += `  Original Creditor: ${item.original_creditor}\n`;
      });
      fullText += "\n";
    }
    
    if (result.charge_offs.length > 0) {
      fullText += "CHARGE-OFFS:\n";
      result.charge_offs.forEach(item => {
        fullText += `• ${item.creditor_name} (${item.account_number}) - Date: ${item.date_charged_off}, Balance: ${item.balance}\n`;
      });
      fullText += "\n";
    }
    
    if (result.public_records.length > 0) {
      fullText += "PUBLIC RECORDS:\n";
      result.public_records.forEach(item => {
        fullText += `• ${item.type} - ${item.court_jurisdiction}\n`;
        fullText += `  Filed: ${item.filing_date} | Status: ${item.status}\n`;
      });
      fullText += "\n";
    }
    
    if (result.inquiries.length > 0) {
      fullText += "INQUIRIES:\n";
      result.inquiries.forEach(item => {
        fullText += `• ${item.creditor_name} - ${item.date} (${item.type})\n`;
      });
      fullText += "\n";
    }
    
    await navigator.clipboard.writeText(fullText);
    toast({
      title: "All results copied",
      description: "Full analysis copied to clipboard",
    });
  };

  const getConfidenceBadge = (confidence: "high" | "medium" | "low") => {
    const styles = {
      high: "bg-success/20 text-success border-success/30",
      medium: "bg-warning/20 text-warning border-warning/30",
      low: "bg-muted text-muted-foreground border-border"
    };
    return (
      <span className={cn("px-2 py-0.5 text-xs font-medium rounded border", styles[confidence])}>
        {confidence} confidence
      </span>
    );
  };

  const hasAnyResults = result && (
    result.inaccurate_names.length > 0 ||
    result.inaccurate_addresses.length > 0 ||
    result.inaccurate_employers.length > 0 ||
    result.extra_identifier_mismatches.length > 0 ||
    result.derogatory_accounts.length > 0 ||
    result.late_payment_summary.length > 0 ||
    result.collections.length > 0 ||
    result.charge_offs.length > 0 ||
    result.public_records.length > 0 ||
    result.inquiries.length > 0
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
            Upload your credit report. Get a dispute-ready checklist of inaccuracies and derogatory items.
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
                    className="bg-muted/30 border-border/50 uppercase"
                  />
                  <p className="text-xs text-muted-foreground">Exact match required. Include middle name, suffix, etc.</p>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-foreground font-medium flex items-center gap-2">
                    <Briefcase className="w-4 h-4" />
                    Current Employer <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="ACME CORPORATION"
                    value={currentEmployer}
                    onChange={(e) => setCurrentEmployer(e.target.value)}
                    className="bg-muted/30 border-border/50 uppercase"
                  />
                </div>
                
                <div className="md:col-span-2 space-y-2">
                  <Label className="text-foreground font-medium flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Current Address <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="123 MAIN ST APT 4B, ANYTOWN, CA 90210"
                    value={currentAddress}
                    onChange={(e) => setCurrentAddress(e.target.value)}
                    className="bg-muted/30 border-border/50 uppercase"
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
                Upload PDF pages, screenshots, or paste text. Multiple images supported (up to 10).
              </p>
              
              {/* Multi-image upload */}
              <div className="space-y-4">
                <div 
                  className={cn(
                    "border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer",
                    responseImages.length > 0 
                      ? "border-primary/50 bg-primary/5" 
                      : "border-border hover:border-primary/30 hover:bg-muted/30"
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  
                  {responseImages.length > 0 ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2 justify-center">
                        {imageNames.map((name, index) => (
                          <div 
                            key={index}
                            className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-full text-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <FileText className="w-4 h-4 text-primary" />
                            <span className="max-w-[150px] truncate">{name}</span>
                            <button 
                              onClick={() => removeImage(index)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-center gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Add More
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearAllImages();
                          }}
                        >
                          Clear All
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                      <p className="text-muted-foreground">
                        Click to upload credit report pages
                      </p>
                      <p className="text-sm text-muted-foreground/70">
                        PNG, JPG, PDF up to 10MB each (max 10 files)
                      </p>
                    </div>
                  )}
                </div>

                {/* Divider */}
                {responseImages.length === 0 && (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-sm text-muted-foreground">OR</span>
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
              </div>

              {/* Additional options */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Bureau (if known)</Label>
                  <Select value={bureau} onValueChange={setBureau}>
                    <SelectTrigger className="bg-muted/30 border-border/50">
                      <SelectValue placeholder="Select bureau" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="experian">Experian</SelectItem>
                      <SelectItem value="equifax">Equifax</SelectItem>
                      <SelectItem value="transunion">TransUnion</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

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
              </div>

              {/* Analyze button */}
              <Button
                onClick={handleAnalyze}
                disabled={isAnalyzing || (!responseText && responseImages.length === 0) || !fullLegalName || !currentAddress || !currentEmployer}
                className="w-full py-6 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Analyzing Credit Report...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generate Dispute Analysis
                  </>
                )}
              </Button>

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

        {/* Results */}
        {result && (
          <div className="mt-8 space-y-6 animate-slide-up">
            {/* Header with copy all button */}
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-serif font-bold text-foreground">
                Dispute Analysis Results
              </h3>
              {hasAnyResults && (
                <Button variant="outline" onClick={copyAllResults}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy All
                </Button>
              )}
            </div>

            {/* Summary */}
            {result.summary && (
              <div className="card-elevated rounded-xl border border-border/50 p-6">
                <h4 className="text-lg font-serif font-semibold text-foreground mb-3">Summary</h4>
                <p className="text-muted-foreground leading-relaxed">{result.summary}</p>
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
                onCopy={() => copySection("Inaccurate Addresses", result.inaccurate_addresses.map(a => `${a.reported_address}${a.linked_to_derogatory ? " [LINKED TO DEROGATORY]" : ""}`).join("\n"))}
                isCopied={copiedSection === "Inaccurate Addresses"}
              >
                {result.inaccurate_addresses.map((item, i) => (
                  <div key={i} className="flex items-start justify-between p-3 bg-muted/30 rounded-lg">
                    <div>
                      <p className="font-medium text-foreground">{item.reported_address}</p>
                      {item.linked_to_derogatory && (
                        <span className="text-xs px-2 py-0.5 bg-destructive/20 text-destructive rounded">
                          Linked to derogatory items
                        </span>
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
                  <div key={i} className="p-3 bg-muted/30 rounded-lg">
                    <p className="font-medium text-foreground">{item.reported_employer}</p>
                  </div>
                ))}
              </ResultCard>
            )}

            {/* Extra Identifier Mismatches */}
            {result.extra_identifier_mismatches && result.extra_identifier_mismatches.length > 0 && (
              <ResultCard
                title="Extra Identifier Mismatches"
                count={result.extra_identifier_mismatches.length}
                onCopy={() => copySection("Identifier Mismatches", result.extra_identifier_mismatches.map(e => `${e.field}: ${e.reported_value} - ${e.status}`).join("\n"))}
                isCopied={copiedSection === "Identifier Mismatches"}
              >
                {result.extra_identifier_mismatches.map((item, i) => (
                  <div key={i} className="p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{item.field}:</span>
                      <span className="font-medium text-foreground">"{item.reported_value}"</span>
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
                onCopy={() => copySection("Derogatory Accounts", result.derogatory_accounts.map(a => `${a.creditor_name} (${a.account_number}) - ${a.derogatory_triggers.join(", ")}`).join("\n"))}
                isCopied={copiedSection === "Derogatory Accounts"}
              >
                {result.derogatory_accounts.map((item, i) => (
                  <div key={i} className="p-4 bg-muted/30 rounded-lg space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{item.creditor_name}</p>
                        <p className="text-sm text-muted-foreground font-mono">{item.account_number}</p>
                      </div>
                      {getConfidenceBadge(item.confidence)}
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
                onCopy={() => copySection("Late Payments", result.late_payment_summary.flatMap(s => s.accounts.map(a => `${s.severity}: ${a.creditor_name} - ${a.months_detected}`)).join("\n"))}
                isCopied={copiedSection === "Late Payments"}
              >
                {result.late_payment_summary.map((severity, si) => (
                  <div key={si} className="space-y-2">
                    <h5 className="font-semibold text-warning uppercase text-sm">{severity.severity} Lates</h5>
                    {severity.accounts.map((acc, ai) => (
                      <div key={ai} className="p-3 bg-muted/30 rounded-lg">
                        <p className="font-medium text-foreground">{acc.creditor_name}</p>
                        <p className="text-sm text-muted-foreground font-mono">{acc.account_number}</p>
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
                onCopy={() => copySection("Collections", result.collections.map(c => `${c.creditor_name} (${c.account_number}) - ${c.balance}`).join("\n"))}
                isCopied={copiedSection === "Collections"}
              >
                {result.collections.map((item, i) => (
                  <div key={i} className="p-3 bg-muted/30 rounded-lg">
                    <p className="font-medium text-foreground">{item.creditor_name}</p>
                    <p className="text-sm text-muted-foreground font-mono">{item.account_number}</p>
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
                onCopy={() => copySection("Charge-Offs", result.charge_offs.map(c => `${c.creditor_name} - ${c.date_charged_off} - ${c.balance}`).join("\n"))}
                isCopied={copiedSection === "Charge-Offs"}
              >
                {result.charge_offs.map((item, i) => (
                  <div key={i} className="p-3 bg-muted/30 rounded-lg">
                    <p className="font-medium text-foreground">{item.creditor_name}</p>
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
                onCopy={() => copySection("Public Records", result.public_records.map(p => `${p.type} - ${p.court_jurisdiction} - ${p.filing_date}`).join("\n"))}
                isCopied={copiedSection === "Public Records"}
              >
                {result.public_records.map((item, i) => (
                  <div key={i} className="p-3 bg-muted/30 rounded-lg">
                    <p className="font-semibold text-foreground">{item.type}</p>
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
                onCopy={() => copySection("Inquiries", result.inquiries.map(i => `${i.creditor_name} - ${i.date} (${i.type})`).join("\n"))}
                isCopied={copiedSection === "Inquiries"}
              >
                {result.inquiries.map((item, i) => (
                  <div key={i} className="p-3 bg-muted/30 rounded-lg flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{item.creditor_name}</p>
                      <p className="text-sm text-muted-foreground">{item.date}</p>
                    </div>
                    <span className={cn(
                      "px-2 py-0.5 text-xs rounded",
                      item.type === "hard" 
                        ? "bg-destructive/20 text-destructive" 
                        : "bg-muted text-muted-foreground"
                    )}>
                      {item.type}
                    </span>
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
