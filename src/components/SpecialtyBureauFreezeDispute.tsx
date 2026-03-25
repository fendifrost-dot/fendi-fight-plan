import { useState } from "react";
import {
  Shield,
  Lock,
  FileText,
  Download,
  FileDown,
  Loader2,
  AlertTriangle,
  Phone,
  Globe,
  MapPin,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Scale,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { exportAsWord, exportAsPdf } from "@/lib/letter-export";

// ---------------------------------------------------------------------------
// Bureau definitions (mirrors the Supabase function)
// ---------------------------------------------------------------------------
const SPECIALTY_BUREAUS = {
  lexisnexis: {
    key: "lexisnexis",
    displayName: "LexisNexis",
    legalName: "LexisNexis Risk Solutions Consumer Center",
    address: "P.O. Box 105108",
    cityStateZip: "Atlanta, GA 30348",
    phone: "1-888-497-0011",
    website: "lexisnexis.com/privacy",
    reportName: "CLUE Report (insurance & landlord screening)",
    color: "blue",
    colorClass: "border-blue-500/40 bg-blue-500/5",
    badgeClass: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  },
  innovis: {
    key: "innovis",
    displayName: "Innovis",
    legalName: "Innovis Data Solutions, Inc.",
    address: "PO Box 530088",
    cityStateZip: "Atlanta, GA 30353-0088",
    phone: "1-800-540-2505",
    website: "innovis.com",
    reportName: "4th Credit Bureau â full tradeline data",
    color: "green",
    colorClass: "border-green-500/40 bg-green-500/5",
    badgeClass: "bg-green-500/10 text-green-600 border-green-500/20",
  },
  corelogic: {
    key: "corelogic",
    displayName: "CoreLogic",
    legalName: "CoreLogic Credco LLC",
    address: "P.O. Box 509124",
    cityStateZip: "San Diego, CA 92150",
    phone: "1-877-532-8778",
    website: "corelogic.com/consumer-privacy",
    reportName: "Mortgage tri-merge + rental screening",
    color: "orange",
    colorClass: "border-orange-500/40 bg-orange-500/5",
    badgeClass: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  },
  sagestream: {
    key: "sagestream",
    displayName: "SageStream",
    legalName: "SageStream, LLC c/o LexisNexis Risk Solutions Consumer Center",
    address: "P.O. Box 105108",
    cityStateZip: "Atlanta, Georgia 30348-5108",
    phone: "1-888-395-0277",
    website: "sagestreamllc.com",
    reportName: "Alternative credit data (fintech & subprime)",
    color: "purple",
    colorClass: "border-purple-500/40 bg-purple-500/5",
    badgeClass: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  },
} as const;

type BureauKey = keyof typeof SPECIALTY_BUREAUS;

interface DisputeItem {
  id: string;
  creditor_name: string;
  account_number: string;
  balance: string;
  issue: string;
}

interface GeneratedLetter {
  bureauKey: BureauKey;
  letter: string;
  bureauInfo: {
    legalName: string;
    address: string;
    cityStateZip: string;
    phone: string;
    website: string;
    freezeProcess: string;
  };
}

interface ConsumerInfo {
  fullName: string;
  addressLine1: string;
  addressLine2: string;
  cityStateZip: string;
}

interface SpecialtyBureauFreezeDisputeProps {
  accessToken: string;
  consumerName?: string;
  consumerAddress?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function SpecialtyBureauFreezeDispute({
  accessToken,
  consumerName = "",
  consumerAddress = "",
}: SpecialtyBureauFreezeDisputeProps) {
  const { toast } = useToast();

  const [consumerInfo, setConsumerInfo] = useState<ConsumerInfo>({
    fullName: consumerName,
    addressLine1: consumerAddress,
    addressLine2: "",
    cityStateZip: "",
  });
  const [selectedBureaus, setSelectedBureaus] = useState<BureauKey[]>([
    "lexisnexis", "innovis", "corelogic", "sagestream",
  ]);
  const [isIdentityTheft, setIsIdentityTheft] = useState(false);
  const [hasFtcReport, setHasFtcReport] = useState(false);
  const [ftcReportNumber, setFtcReportNumber] = useState("");
  const [additionalFacts, setAdditionalFacts] = useState("");
  const [disputeItems, setDisputeItems] = useState<DisputeItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedLetters, setGeneratedLetters] = useState<GeneratedLetter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedLetters, setExpandedLetters] = useState<Set<BureauKey>>(new Set());
  const [copiedKey, setCopiedKey] = useState<BureauKey | null>(null);
  const [exportingWord, setExportingWord] = useState<BureauKey | null>(null);
  const [exportingPdf, setExportingPdf] = useState<BureauKey | null>(null);

  const toggleBureau = (key: BureauKey) => {
    setSelectedBureaus((prev) =>
      prev.includes(key) ? prev.filter((b) => b !== key) : [...prev, key]
    );
  };

  const toggleExpanded = (key: BureauKey) => {
    setExpandedLetters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addDisputeItem = () => {
    setDisputeItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), creditor_name: "", account_number: "", balance: "", issue: "" },
    ]);
  };

  const updateDisputeItem = (id: string, field: keyof DisputeItem, value: string) => {
    setDisputeItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const removeDisputeItem = (id: string) => {
    setDisputeItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleGenerate = async () => {
    if (!consumerInfo.fullName.trim()) {
      setError("Full legal name is required.");
      return;
    }
    if (selectedBureaus.length === 0) {
      setError("Select at least one specialty bureau.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedLetters([]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 150000);

    try {
      const results = await Promise.all(
        selectedBureaus.map(async (bureauKey) => {
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-specialty-freeze-letter`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                bureauKey,
                consumerInfo,
                isIdentityTheft,
                hasFtcReport,
                ftcReportNumber: ftcReportNumber.trim() || null,
                disputedItems: disputeItems.filter((d) => d.creditor_name.trim()),
                additionalFacts: additionalFacts.trim() || null,
              }),
              signal: controller.signal,
            }
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `Failed for ${bureauKey}`);
          return { bureauKey, letter: data.letter, bureauInfo: data.bureauInfo };
        })
      );

      setGeneratedLetters(results);
      // Auto-expand all
      setExpandedLetters(new Set(results.map((r) => r.bureauKey)));
      toast({
        title: `${results.length} specialty freeze letter${results.length > 1 ? "s" : ""} generated`,
        description: "Letters are ready. Download as Word or PDF.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      clearTimeout(timeoutId);
      setIsGenerating(false);
    }
  };

  const copyLetter = async (bureauKey: BureauKey) => {
    const letter = generatedLetters.find((l) => l.bureauKey === bureauKey)?.letter;
    if (!letter) return;
    await navigator.clipboard.writeText(letter);
    setCopiedKey(bureauKey);
    setTimeout(() => setCopiedKey(null), 2000);
    toast({ title: "Copied!", description: `${SPECIALTY_BUREAUS[bureauKey].displayName} letter copied.` });
  };

  const handleDownloadWord = async (bureauKey: BureauKey) => {
    const item = generatedLetters.find((l) => l.bureauKey === bureauKey);
    if (!item) return;
    setExportingWord(bureauKey);
    try {
      await exportAsWord(item.letter, SPECIALTY_BUREAUS[bureauKey].legalName);
      toast({ title: "Word downloaded", description: `${SPECIALTY_BUREAUS[bureauKey].displayName} letter saved.` });
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    } finally {
      setExportingWord(null);
    }
  };

  const handleDownloadPdf = (bureauKey: BureauKey) => {
    const item = generatedLetters.find((l) => l.bureauKey === bureauKey);
    if (!item) return;
    setExportingPdf(bureauKey);
    try {
      exportAsPdf(item.letter, SPECIALTY_BUREAUS[bureauKey].legalName);
      toast({ title: "PDF downloaded", description: `${SPECIALTY_BUREAUS[bureauKey].displayName} letter saved.` });
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    } finally {
      setExportingPdf(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-full mb-4">
          <Lock className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-primary">Specialty Bureau Protection</span>
        </div>
        <h3 className="text-2xl md:text-3xl font-serif font-bold text-foreground mb-3">
          Security Freeze + Dispute Letters
        </h3>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Generate maximum-strength freeze requests and formal disputes for all four specialty
          consumer reporting agencies â LexisNexis, Innovis, CoreLogic, and SageStream.
          These bureaus are often overlooked but used by insurers, landlords, mortgage lenders, and fintech.
        </p>
      </div>

      {/* Bureau Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(Object.values(SPECIALTY_BUREAUS) as typeof SPECIALTY_BUREAUS[BureauKey][]).map((bureau) => {
          const isSelected = selectedBureaus.includes(bureau.key as BureauKey);
          return (
            <label
              key={bureau.key}
              className={cn(
                "flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all",
                isSelected ? bureau.colorClass : "border-border/50 bg-muted/20 hover:bg-muted/30"
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleBureau(bureau.key as BureauKey)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-foreground">{bureau.displayName}</p>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", bureau.badgeClass)}>
                    {bureau.reportName}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{bureau.legalName}</p>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {bureau.phone}
                  </span>
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3" /> {bureau.website}
                  </span>
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {/* Consumer Info */}
      <div className="rounded-2xl border border-border/50 p-6 space-y-4">
        <h4 className="font-serif font-semibold text-foreground flex items-center gap-2">
          <Scale className="w-5 h-5 text-primary" /> Your Information
        </h4>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Full Legal Name *</Label>
            <Input
              placeholder="Jane Marie Smith"
              value={consumerInfo.fullName}
              onChange={(e) => setConsumerInfo((p) => ({ ...p, fullName: e.target.value }))}
              className="bg-muted/30"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Street Address</Label>
              <Input
                placeholder="123 Main Street"
                value={consumerInfo.addressLine1}
                onChange={(e) => setConsumerInfo((p) => ({ ...p, addressLine1: e.target.value }))}
                className="bg-muted/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Apt / Suite (Optional)</Label>
              <Input
                placeholder="Apt 2B"
                value={consumerInfo.addressLine2}
                onChange={(e) => setConsumerInfo((p) => ({ ...p, addressLine2: e.target.value }))}
                className="bg-muted/30"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>City, State ZIP</Label>
            <Input
              placeholder="Chicago, IL 60827"
              value={consumerInfo.cityStateZip}
              onChange={(e) => setConsumerInfo((p) => ({ ...p, cityStateZip: e.target.value }))}
              className="bg-muted/30"
            />
          </div>
        </div>
      </div>

      {/* Identity Theft Options */}
      <div className="rounded-2xl border border-border/50 p-6 space-y-4">
        <h4 className="font-serif font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" /> Identity Theft Options
        </h4>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-foreground font-medium">I am a victim of identity theft</Label>
            <div className="flex items-center gap-2">
              <span className={cn("text-sm", !isIdentityTheft && "text-muted-foreground")}>No</span>
              <Switch checked={isIdentityTheft} onCheckedChange={setIsIdentityTheft} />
              <span className={cn("text-sm", isIdentityTheft && "text-primary font-medium")}>Yes</span>
            </div>
          </div>
          {isIdentityTheft && (
            <div className="flex items-center justify-between pl-4 border-l-2 border-primary/30">
              <Label className="text-foreground font-medium">I have filed an FTC Identity Theft Report</Label>
              <div className="flex items-center gap-2">
                <span className={cn("text-sm", !hasFtcReport && "text-muted-foreground")}>No</span>
                <Switch checked={hasFtcReport} onCheckedChange={setHasFtcReport} />
                <span className={cn("text-sm", hasFtcReport && "text-primary font-medium")}>Yes</span>
              </div>
            </div>
          )}
          {isIdentityTheft && hasFtcReport && (
            <div className="space-y-1.5 pl-4 border-l-2 border-primary/30">
              <Label>FTC Report Number (optional but recommended)</Label>
              <Input
                placeholder="e.g. 198454903"
                value={ftcReportNumber}
                onChange={(e) => setFtcReportNumber(e.target.value)}
                className="bg-muted/30"
              />
            </div>
          )}
        </div>
      </div>

      {/* Optional Disputed Items */}
      <div className="rounded-2xl border border-border/50 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-serif font-semibold text-foreground flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" /> Specific Items to Dispute (Optional)
          </h4>
          <Button variant="outline" size="sm" onClick={addDisputeItem}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Item
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Leave empty to generate a freeze + file disclosure request only.
          Add items if you want to dispute specific accounts or inquiries at these bureaus.
        </p>
        {disputeItems.length > 0 && (
          <div className="space-y-3">
            {disputeItems.map((item) => (
              <div key={item.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 p-3 bg-muted/20 rounded-lg">
                <Input
                  placeholder="Creditor name *"
                  value={item.creditor_name}
                  onChange={(e) => updateDisputeItem(item.id, "creditor_name", e.target.value)}
                  className="bg-background"
                />
                <Input
                  placeholder="Account #"
                  value={item.account_number}
                  onChange={(e) => updateDisputeItem(item.id, "account_number", e.target.value)}
                  className="bg-background"
                />
                <Input
                  placeholder="Balance"
                  value={item.balance}
                  onChange={(e) => updateDisputeItem(item.id, "balance", e.target.value)}
                  className="bg-background"
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Issue"
                    value={item.issue}
                    onChange={(e) => updateDisputeItem(item.id, "issue", e.target.value)}
                    className="bg-background flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeDisputeItem(item.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1.5 pt-2 border-t border-border/40">
          <Label>Additional Facts (Optional)</Label>
          <Textarea
            placeholder="Any additional context, recent inquiries, loan denials, or insurance issues you want included..."
            value={additionalFacts}
            onChange={(e) => setAdditionalFacts(e.target.value)}
            className="bg-muted/30 min-h-[80px]"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      {/* Generate Button */}
      <Button
        onClick={handleGenerate}
        disabled={isGenerating || selectedBureaus.length === 0 || !consumerInfo.fullName.trim()}
        className="w-full py-6 text-lg font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Generating {selectedBureaus.length} Freeze Letter{selectedBureaus.length > 1 ? "s" : ""}...
          </>
        ) : (
          <>
            <Lock className="w-5 h-5 mr-2" />
            Generate {selectedBureaus.length} Specialty Bureau Freeze Letter{selectedBureaus.length !== 1 ? "s" : ""}
          </>
        )}
      </Button>

      {/* Generated Letters */}
      {generatedLetters.map((item) => {
        const bureau = SPECIALTY_BUREAUS[item.bureauKey];
        const isExpanded = expandedLetters.has(item.bureauKey);
        return (
          <div
            key={item.bureauKey}
            className={cn("rounded-2xl border p-6 md:p-8", bureau.colorClass)}
          >
            {/* Letter header */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h4 className="text-xl font-serif font-semibold text-foreground flex items-center gap-2">
                <Lock className="w-5 h-5 text-primary" />
                {bureau.displayName} â Freeze + Dispute
              </h4>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleExpanded(item.bureauKey)}
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4 mr-1.5" /> : <ChevronDown className="w-4 h-4 mr-1.5" />}
                  {isExpanded ? "Collapse" : "View"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => copyLetter(item.bureauKey)}>
                  {copiedKey === item.bureauKey ? (
                    <Check className="w-4 h-4 mr-1.5" />
                  ) : (
                    <Copy className="w-4 h-4 mr-1.5" />
                  )}
                  Copy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadWord(item.bureauKey)}
                  disabled={exportingWord === item.bureauKey}
                  className="border-blue-500/50 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                >
                  {exportingWord === item.bureauKey ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-1.5" />
                  )}
                  Word
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadPdf(item.bureauKey)}
                  disabled={exportingPdf === item.bureauKey}
                  className="border-red-500/50 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  {exportingPdf === item.bureauKey ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4 mr-1.5" />
                  )}
                  PDF
                </Button>
              </div>
            </div>

            {/* Letter preview */}
            {isExpanded && (
              <div
                className="rounded-xl border shadow-inner mb-4"
                style={{ backgroundColor: "#ffffff", color: "#111111", borderColor: "#e5e7eb" }}
              >
                <pre
                  className="whitespace-pre-wrap font-serif text-sm leading-relaxed p-6 md:p-8"
                  style={{ color: "#111111" }}
                >
                  {item.letter}
                </pre>
              </div>
            )}

            {/* Send to address */}
            <div className="p-4 bg-white/50 dark:bg-black/20 border border-border/30 rounded-lg">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold mb-0.5">Send via Certified Mail Return Receipt to:</p>
                  <p className="text-foreground">{item.bureauInfo.legalName}</p>
                  <p className="text-muted-foreground">{item.bureauInfo.address}</p>
                  <p className="text-muted-foreground">{item.bureauInfo.cityStateZip}</p>
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {bureau.phone}
                    </span>
                    <span className="flex items-center gap-1">
                      <Globe className="w-3 h-3" /> {bureau.website}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
