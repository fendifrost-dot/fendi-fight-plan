import { useState, useRef } from "react";
import { Upload, FileText, Loader2, AlertCircle, Copy, Check, Sparkles, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AnalysisResult {
  scenario: string;
  scenario_title: string;
  summary: string;
  next_steps: string[];
  prompts: {
    title: string;
    purpose: string;
    template: string;
  }[];
  warnings: string[];
  statutes_to_cite: string[];
}

const AIAnalyzer = () => {
  const [responseText, setResponseText] = useState("");
  const [responseImage, setResponseImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [bureau, setBureau] = useState("");
  const [disputeDate, setDisputeDate] = useState("");
  const [responseDate, setResponseDate] = useState("");
  const [identityDocs, setIdentityDocs] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please upload an image under 10MB",
          variant: "destructive",
        });
        return;
      }

      setImageName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        setResponseImage(event.target?.result as string);
        setResponseText("");
      };
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setResponseImage(null);
    setImageName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleAnalyze = async () => {
    if (!responseText && !responseImage) {
      toast({
        title: "No input provided",
        description: "Please upload an image or paste the bureau response text",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-response`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          responseText: responseText || undefined,
          responseImage: responseImage || undefined,
          bureau: bureau || undefined,
          disputeDate: disputeDate || undefined,
          responseDate: responseDate || undefined,
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

  const copyToClipboard = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    toast({
      title: "Copied to clipboard",
      description: "Prompt template copied successfully",
    });
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const getScenarioColor = (scenario: string) => {
    switch (scenario) {
      case "SCENARIO_A":
        return "bg-success/10 border-success/30 text-success";
      case "SCENARIO_B":
        return "bg-warning/10 border-warning/30 text-warning";
      case "SCENARIO_C":
        return "bg-destructive/10 border-destructive/30 text-destructive";
      default:
        return "bg-muted border-border text-muted-foreground";
    }
  };

  return (
    <section id="ai-tool" className="py-20 px-4 bg-card/30">
      <div className="max-w-4xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-full mb-6">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">AI-Powered</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-serif font-bold text-foreground mb-4">
            Next-Step + Prompt Generator
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Upload the bureau's response. Get your next move and copy/paste prompts.
          </p>
        </div>

        {/* Input form */}
        <div className="card-elevated rounded-2xl border border-border/50 p-6 md:p-8 space-y-6">
          {/* Image upload or text input */}
          <div className="space-y-4">
            <Label className="text-foreground font-medium">Bureau Response (Image or Text)</Label>
            
            {/* Image upload */}
            <div 
              className={cn(
                "border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer",
                responseImage 
                  ? "border-primary/50 bg-primary/5" 
                  : "border-border hover:border-primary/30 hover:bg-muted/30"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              
              {responseImage ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-2 text-primary">
                    <FileText className="w-5 h-5" />
                    <span className="font-medium">{imageName}</span>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearImage();
                    }}
                  >
                    Remove Image
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Click to upload screenshot of bureau response
                  </p>
                  <p className="text-sm text-muted-foreground/70">
                    PNG, JPG up to 10MB
                  </p>
                </div>
              )}
            </div>

            {/* Divider */}
            {!responseImage && (
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-sm text-muted-foreground">OR</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}

            {/* Text input */}
            {!responseImage && (
              <Textarea
                placeholder="Paste the bureau's response text here..."
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                className="min-h-[150px] bg-muted/30 border-border/50 focus:border-primary/50 resize-none"
              />
            )}
          </div>

          {/* Additional fields */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Bureau</Label>
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

            <div className="space-y-2">
              <Label className="text-muted-foreground">Dispute Sent Date (Optional)</Label>
              <Input
                type="date"
                value={disputeDate}
                onChange={(e) => setDisputeDate(e.target.value)}
                className="bg-muted/30 border-border/50"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Response Received Date (Optional)</Label>
              <Input
                type="date"
                value={responseDate}
                onChange={(e) => setResponseDate(e.target.value)}
                className="bg-muted/30 border-border/50"
              />
            </div>
          </div>

          {/* Analyze button */}
          <Button
            onClick={handleAnalyze}
            disabled={isAnalyzing || (!responseText && !responseImage)}
            className="w-full py-6 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Analyzing Response...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Analyze & Generate Prompts
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

        {/* Results */}
        {result && (
          <div className="mt-8 space-y-6 animate-slide-up">
            {/* Scenario badge */}
            <div className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-full border font-medium",
              getScenarioColor(result.scenario)
            )}>
              <span className="text-sm uppercase tracking-wide">{result.scenario.replace("_", " ")}</span>
              <span className="text-sm">—</span>
              <span className="text-sm">{result.scenario_title}</span>
            </div>

            {/* Summary */}
            <div className="card-elevated rounded-xl border border-border/50 p-6">
              <h3 className="text-lg font-serif font-semibold text-foreground mb-3">Analysis</h3>
              <p className="text-muted-foreground leading-relaxed">{result.summary}</p>
            </div>

            {/* Warnings */}
            {result.warnings && result.warnings.length > 0 && (
              <div className="bg-warning/10 border border-warning/30 rounded-xl p-6">
                <h3 className="text-lg font-serif font-semibold text-warning mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  Warnings
                </h3>
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

            {/* Next steps */}
            <div className="card-elevated rounded-xl border border-border/50 p-6">
              <h3 className="text-lg font-serif font-semibold text-foreground mb-4">Next Steps</h3>
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

            {/* Statutes to cite */}
            {result.statutes_to_cite && result.statutes_to_cite.length > 0 && (
              <div className="card-elevated rounded-xl border border-border/50 p-6">
                <h3 className="text-lg font-serif font-semibold text-foreground mb-3">Statutes to Cite</h3>
                <div className="flex flex-wrap gap-2">
                  {result.statutes_to_cite.map((statute, i) => (
                    <span key={i} className="px-3 py-1 bg-muted/50 border border-border/50 rounded-full text-sm font-mono text-muted-foreground">
                      {statute}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Prompts */}
            {result.prompts && result.prompts.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-xl font-serif font-semibold text-foreground">Copy/Paste Prompts</h3>
                
                {result.prompts.map((prompt, i) => (
                  <div key={i} className="card-elevated rounded-xl border border-border/50 overflow-hidden">
                    <div className="p-4 border-b border-border/30 bg-muted/20">
                      <h4 className="font-semibold text-foreground">{prompt.title}</h4>
                      <p className="text-sm text-muted-foreground mt-1">{prompt.purpose}</p>
                    </div>
                    <div className="p-4 relative">
                      <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                        {prompt.template}
                      </pre>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(prompt.template, i)}
                        className="absolute top-4 right-4 gap-2"
                      >
                        {copiedIndex === i ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Reminder */}
            <div className="p-4 bg-primary/10 border border-primary/30 rounded-xl">
              <p className="text-primary font-medium text-center">
                "If you don't include account numbers and dates opened, bureaus exploit ambiguity."
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default AIAnalyzer;
