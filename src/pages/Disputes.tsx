import { useState, useEffect, useRef } from "react";
import mammoth from "mammoth";
import AppNavigation from "@/components/AppNavigation";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Upload, 
  FileText, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Download,
  Plus,
  Calendar,
  Scale,
  ArrowRight,
  Import,
  File,
  X
} from "lucide-react";
import { toast } from "sonner";

const DISPUTES_STORAGE_KEY = "dispute-engine-state";

interface DisputeCase {
  id: string;
  bureau: "Experian" | "Equifax" | "TransUnion";
  accountName: string;
  disputeType: string;
  status: "pending" | "no_response" | "verified" | "partial" | "deleted" | "frivolous" | "reinsertion";
  sentDate: string;
  responseDate?: string;
  notes: string;
  priorLetterContent?: string;
  responseContent?: string;
}

interface PersistedState {
  cases: DisputeCase[];
  importedAnalyzerData: boolean;
  lastUpdated: string;
}

const statusConfig = {
  pending: { label: "Pending Response", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  no_response: { label: "No Response (30+ days)", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  verified: { label: "Verified", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  partial: { label: "Partial Deletion", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  deleted: { label: "Deleted", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  frivolous: { label: "Frivolous Claim", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  reinsertion: { label: "Reinsertion", color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

// Bureau Response Upload Dropzone (PDF/Images only for OCR)
interface BureauResponseUploadProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onClear: () => void;
}

const BureauResponseUpload = ({ onFileSelect, selectedFile, onClear }: BureauResponseUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  const validExtensions = '.pdf,.png,.jpg,.jpeg,.webp';

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const validateFile = (file: File): boolean => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size exceeds 10MB limit.");
      return false;
    }
    if (!validTypes.includes(file.type)) {
      toast.error("Bureau responses must be PDF or image files (PNG, JPG, WebP).");
      return false;
    }
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file)) {
      onFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && validateFile(file)) {
      onFileSelect(file);
    }
  };

  if (selectedFile) {
    return (
      <div className="border border-border rounded-lg p-4 flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-3">
          <File className="w-8 h-8 text-primary" />
          <div>
            <p className="font-medium text-sm">{selectedFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground hover:text-destructive">
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      aria-label="Upload bureau response file (PDF or images only)"
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
        isDragging 
          ? 'border-primary bg-primary/5' 
          : 'border-border hover:border-primary/50'
      }`}
    >
      <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
      <p className="text-sm text-muted-foreground mb-2">
        Drag and drop bureau response here, or click to browse
      </p>
      <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleClick(); }}>
        Choose File
      </Button>
      <p className="text-xs text-muted-foreground mt-2">
        PDF, PNG, JPG, WebP only (max 10MB)
      </p>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={validExtensions}
        onChange={handleFileChange}
      />
    </div>
  );
};

// Prior Dispute Letter Upload (DOCX/PDF/TXT for text extraction)
interface PriorLetterUploadProps {
  onTextExtracted: (text: string) => void;
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onClear: () => void;
  extractedText: string;
  onTextChange: (text: string) => void;
  isExtracting: boolean;
}

const PriorLetterUpload = ({ 
  onTextExtracted, 
  onFileSelect, 
  selectedFile, 
  onClear, 
  extractedText,
  onTextChange,
  isExtracting 
}: PriorLetterUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);

  const validExtensions = '.docx,.pdf,.txt';

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const extractTextFromFile = async (file: File) => {
    setExtractionError(null);
    
    try {
      if (file.name.endsWith('.txt')) {
        const text = await file.text();
        onTextExtracted(text);
        toast.success("Text extracted from file.");
      } else if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        if (result.value.trim()) {
          onTextExtracted(result.value);
          toast.success("Text extracted from DOCX file.");
        } else {
          setExtractionError("DOCX file appears to be empty or unreadable.");
          toast.error("Could not extract text from DOCX. Please paste the letter text manually.");
        }
      } else if (file.type === 'application/pdf') {
        // For PDF, we'll show a message to paste text manually
        setExtractionError("PDF text extraction not available for prior letters. Please paste the letter text below.");
        toast.info("Please paste your prior letter text in the textarea below.");
      }
    } catch (error) {
      console.error("Text extraction error:", error);
      setExtractionError("Failed to extract text. Please paste the letter content manually.");
      toast.error("Failed to extract text from file.");
    }
  };

  const validateFile = (file: File): boolean => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size exceeds 10MB limit.");
      return false;
    }
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf',
      'text/plain'
    ];
    const isValidType = validTypes.includes(file.type) || 
                       file.name.endsWith('.docx') || 
                       file.name.endsWith('.pdf') || 
                       file.name.endsWith('.txt');
    if (!isValidType) {
      toast.error("Prior letters must be DOCX, PDF, or TXT files.");
      return false;
    }
    return true;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file)) {
      onFileSelect(file);
      await extractTextFromFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && validateFile(file)) {
      onFileSelect(file);
      await extractTextFromFile(file);
    }
  };

  return (
    <div className="space-y-3">
      {selectedFile ? (
        <div className="border border-border rounded-lg p-4 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-primary" />
            <div>
              <p className="font-medium text-sm">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { onClear(); setExtractionError(null); }} className="text-muted-foreground hover:text-destructive">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          aria-label="Upload prior dispute letter (DOCX, PDF, or TXT)"
          onKeyDown={(e) => e.key === 'Enter' && handleClick()}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
            isDragging 
              ? 'border-primary bg-primary/5' 
              : 'border-border hover:border-primary/50'
          }`}
        >
          <FileText className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-2">
            Drag and drop your prior dispute letter, or click to browse
          </p>
          <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleClick(); }}>
            Choose File
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            DOCX, PDF, TXT (max 10MB)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={validExtensions}
            onChange={handleFileChange}
          />
        </div>
      )}

      {isExtracting && (
        <p className="text-sm text-muted-foreground animate-pulse">Extracting text...</p>
      )}

      {extractionError && (
        <p className="text-sm text-amber-500">{extractionError}</p>
      )}

      <div className="space-y-2">
        <Label className="text-sm">
          {selectedFile ? "Extracted / Pasted Letter Text" : "Or paste letter text directly"}
        </Label>
        <Textarea
          placeholder="Paste your prior dispute letter content here..."
          value={extractedText}
          onChange={(e) => onTextChange(e.target.value)}
          rows={5}
          className="text-sm"
        />
      </div>
    </div>
  );
};

const Disputes = () => {
  const [cases, setCases] = useState<DisputeCase[]>([]);
  const [activeTab, setActiveTab] = useState("timeline");
  const [showAddCase, setShowAddCase] = useState(false);
  const [importedAnalyzerData, setImportedAnalyzerData] = useState(false);
  
  // Bureau response upload state
  const [bureauResponseFile, setBureauResponseFile] = useState<File | null>(null);
  const [bureauResponseText, setBureauResponseText] = useState("");
  
  // Prior letter upload state
  const [priorLetterFile, setPriorLetterFile] = useState<File | null>(null);
  const [priorLetterText, setPriorLetterText] = useState("");
  const [isExtractingText, setIsExtractingText] = useState(false);

  // New case form state
  const [newCase, setNewCase] = useState<Partial<DisputeCase>>({
    bureau: "Experian",
    status: "pending",
    sentDate: new Date().toISOString().split("T")[0],
  });

  const handleBureauResponseFileSelect = (file: File) => {
    setBureauResponseFile(file);
    toast.success(`Bureau response "${file.name}" selected for analysis.`);
  };

  const handlePriorLetterFileSelect = (file: File) => {
    setPriorLetterFile(file);
    setIsExtractingText(true);
    // Extraction happens in the component, we just track the loading state
    setTimeout(() => setIsExtractingText(false), 100);
  };

  const handlePriorLetterTextExtracted = (text: string) => {
    setPriorLetterText(text);
    setIsExtractingText(false);
  };

  // Load persisted state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DISPUTES_STORAGE_KEY);
      if (saved) {
        const parsed: PersistedState = JSON.parse(saved);
        setCases(parsed.cases || []);
        setImportedAnalyzerData(parsed.importedAnalyzerData || false);
      }
    } catch (e) {
      console.error("Failed to load dispute engine state:", e);
    }
  }, []);

  // Auto-save state
  useEffect(() => {
    const state: PersistedState = {
      cases,
      importedAnalyzerData,
      lastUpdated: new Date().toISOString(),
    };
    localStorage.setItem(DISPUTES_STORAGE_KEY, JSON.stringify(state));
  }, [cases, importedAnalyzerData]);

  const handleImportFromAnalyzer = () => {
    try {
      const analyzerData = localStorage.getItem("ai-analyzer-state");
      if (!analyzerData) {
        toast.error("No analyzer data found. Run the Credit Report Analyzer first.");
        return;
      }
      
      const parsed = JSON.parse(analyzerData);
      if (parsed.analysisResults) {
        setImportedAnalyzerData(true);
        toast.success("Imported analyzer data successfully! You can now create disputes based on the findings.");
      } else {
        toast.error("No analysis results found in analyzer data.");
      }
    } catch (e) {
      toast.error("Failed to import analyzer data.");
    }
  };

  const handleAddCase = () => {
    if (!newCase.accountName || !newCase.disputeType) {
      toast.error("Please fill in all required fields.");
      return;
    }

    const caseToAdd: DisputeCase = {
      id: crypto.randomUUID(),
      bureau: newCase.bureau as DisputeCase["bureau"],
      accountName: newCase.accountName,
      disputeType: newCase.disputeType,
      status: newCase.status as DisputeCase["status"],
      sentDate: newCase.sentDate || new Date().toISOString().split("T")[0],
      notes: newCase.notes || "",
      priorLetterContent: newCase.priorLetterContent,
    };

    setCases((prev) => [...prev, caseToAdd]);
    setNewCase({
      bureau: "Experian",
      status: "pending",
      sentDate: new Date().toISOString().split("T")[0],
    });
    setShowAddCase(false);
    toast.success("Dispute case added to timeline.");
  };

  const updateCaseStatus = (caseId: string, status: DisputeCase["status"]) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? { ...c, status, responseDate: status !== "pending" ? new Date().toISOString().split("T")[0] : undefined }
          : c
      )
    );
    toast.success("Case status updated.");
  };

  const deleteCase = (caseId: string) => {
    setCases((prev) => prev.filter((c) => c.id !== caseId));
    toast.success("Case removed from timeline.");
  };

  return (
    <main className="min-h-screen bg-background">
      <AppNavigation />

      {/* Hero Section */}
      <section className="py-12 px-4 border-b border-border">
        <div className="container mx-auto max-w-6xl text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Scale className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-gold-gradient mb-4">
            Dispute & Response Engine
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Track your dispute lifecycle, analyze bureau responses, classify scenarios, 
            and generate next-step letters with legal precision.
          </p>

          {/* Import from Analyzer */}
          <div className="mt-8">
            <Button
              onClick={handleImportFromAnalyzer}
              variant="outline"
              className="border-primary/30 hover:border-primary/60"
            >
              <Import className="w-4 h-4 mr-2" />
              Import from Credit Report Analyzer
            </Button>
            {importedAnalyzerData && (
              <Badge variant="outline" className="ml-3 border-green-500/30 text-green-400">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Analyzer Data Imported
              </Badge>
            )}
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-8 px-4">
        <div className="container mx-auto max-w-6xl">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-8">
              <TabsTrigger value="timeline" className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Case Timeline
              </TabsTrigger>
              <TabsTrigger value="upload" className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Upload Response
              </TabsTrigger>
              <TabsTrigger value="generate" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Generate Letters
              </TabsTrigger>
            </TabsList>

            {/* Timeline Tab */}
            <TabsContent value="timeline" className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-serif font-semibold">Your Dispute Cases</h2>
                <Button onClick={() => setShowAddCase(true)} className="bg-primary text-primary-foreground">
                  <Plus className="w-4 h-4 mr-2" />
                  Add New Case
                </Button>
              </div>

              {/* Add Case Form */}
              {showAddCase && (
                <Card className="border-primary/30">
                  <CardHeader>
                    <CardTitle className="font-serif">Add New Dispute Case</CardTitle>
                    <CardDescription>Track a new dispute you've sent to a credit bureau.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Bureau</Label>
                        <Select
                          value={newCase.bureau}
                          onValueChange={(v) => setNewCase((prev) => ({ ...prev, bureau: v as DisputeCase["bureau"] }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Experian">Experian</SelectItem>
                            <SelectItem value="Equifax">Equifax</SelectItem>
                            <SelectItem value="TransUnion">TransUnion</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Account Name *</Label>
                        <Input
                          placeholder="e.g., Capital One Visa"
                          value={newCase.accountName || ""}
                          onChange={(e) => setNewCase((prev) => ({ ...prev, accountName: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Dispute Type *</Label>
                        <Input
                          placeholder="e.g., Not My Account, Wrong Balance"
                          value={newCase.disputeType || ""}
                          onChange={(e) => setNewCase((prev) => ({ ...prev, disputeType: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Date Sent</Label>
                        <Input
                          type="date"
                          value={newCase.sentDate || ""}
                          onChange={(e) => setNewCase((prev) => ({ ...prev, sentDate: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <Textarea
                        placeholder="Any additional notes about this dispute..."
                        value={newCase.notes || ""}
                        onChange={(e) => setNewCase((prev) => ({ ...prev, notes: e.target.value }))}
                        rows={3}
                      />
                    </div>
                    <div className="flex gap-3">
                      <Button onClick={handleAddCase} className="bg-primary text-primary-foreground">
                        Add Case
                      </Button>
                      <Button variant="outline" onClick={() => setShowAddCase(false)}>
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Cases List */}
              {cases.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-12 text-center">
                    <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">
                      No dispute cases yet. Add your first case to start tracking.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {cases.map((c) => (
                    <Card key={c.id} className="border-border hover:border-primary/30 transition-colors">
                      <CardContent className="py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Badge variant="outline">{c.bureau}</Badge>
                              <Badge className={statusConfig[c.status].color}>
                                {statusConfig[c.status].label}
                              </Badge>
                            </div>
                            <h3 className="font-semibold text-lg">{c.accountName}</h3>
                            <p className="text-sm text-muted-foreground">{c.disputeType}</p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                Sent: {c.sentDate}
                              </span>
                              {c.responseDate && (
                                <span className="flex items-center gap-1">
                                  <ArrowRight className="w-3 h-3" />
                                  Response: {c.responseDate}
                                </span>
                              )}
                            </div>
                            {c.notes && (
                              <p className="mt-2 text-sm text-muted-foreground italic">{c.notes}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            <Select
                              value={c.status}
                              onValueChange={(v) => updateCaseStatus(c.id, v as DisputeCase["status"])}
                            >
                              <SelectTrigger className="w-[160px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="no_response">No Response</SelectItem>
                                <SelectItem value="verified">Verified</SelectItem>
                                <SelectItem value="partial">Partial Deletion</SelectItem>
                                <SelectItem value="deleted">Deleted</SelectItem>
                                <SelectItem value="frivolous">Frivolous</SelectItem>
                                <SelectItem value="reinsertion">Reinsertion</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteCase(c.id)}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Remove
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Upload Response Tab */}
            <TabsContent value="upload" className="space-y-6">
              {/* Bureau Response Upload Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="font-serif flex items-center gap-2">
                    <Upload className="w-5 h-5 text-primary" />
                    Upload Bureau Response
                  </CardTitle>
                  <CardDescription>
                    Upload the response letter you received from a credit bureau for OCR extraction and scenario classification.
                    <span className="block mt-1 text-xs font-medium text-amber-500">
                      Accepts: PDF, PNG, JPG, WebP only
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <BureauResponseUpload 
                    onFileSelect={handleBureauResponseFileSelect}
                    selectedFile={bureauResponseFile}
                    onClear={() => setBureauResponseFile(null)}
                  />

                  <div className="space-y-2">
                    <Label>Or paste response text</Label>
                    <Textarea
                      placeholder="Paste the text content of the bureau's response here..."
                      value={bureauResponseText}
                      onChange={(e) => setBureauResponseText(e.target.value)}
                      rows={5}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Link to Existing Case (Optional)</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a case to link this response to" />
                      </SelectTrigger>
                      <SelectContent>
                        {cases.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.bureau} - {c.accountName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button 
                    className="bg-primary text-primary-foreground"
                    disabled={!bureauResponseFile && !bureauResponseText.trim()}
                  >
                    Analyze Response
                  </Button>
                </CardContent>
              </Card>

              {/* Prior Dispute Letter Upload Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="font-serif flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    Upload Prior Dispute Letter
                  </CardTitle>
                  <CardDescription>
                    Upload your previously sent dispute letter for reference when generating follow-up actions.
                    <span className="block mt-1 text-xs font-medium text-amber-500">
                      Accepts: DOCX, PDF, TXT
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PriorLetterUpload
                    onTextExtracted={handlePriorLetterTextExtracted}
                    onFileSelect={handlePriorLetterFileSelect}
                    selectedFile={priorLetterFile}
                    onClear={() => { setPriorLetterFile(null); setPriorLetterText(""); }}
                    extractedText={priorLetterText}
                    onTextChange={setPriorLetterText}
                    isExtracting={isExtractingText}
                  />
                </CardContent>
              </Card>

              {/* Scenario Classification Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="font-serif">Response Scenario Classification</CardTitle>
                  <CardDescription>
                    The engine will classify bureau responses into these categories:
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5" />
                      <div>
                        <p className="font-medium">Scenario A: Full Deletion</p>
                        <p className="text-sm text-muted-foreground">Item deleted from credit report</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <AlertTriangle className="w-5 h-5 text-blue-400 mt-0.5" />
                      <div>
                        <p className="font-medium">Scenario B: Partial Deletion</p>
                        <p className="text-sm text-muted-foreground">Requires MoV demand letter</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <XCircle className="w-5 h-5 text-red-400 mt-0.5" />
                      <div>
                        <p className="font-medium">Scenario C: Full Verification</p>
                        <p className="text-sm text-muted-foreground">Escalate to CFPB/BBB/AG</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <Clock className="w-5 h-5 text-orange-400 mt-0.5" />
                      <div>
                        <p className="font-medium">No Response (30+ days)</p>
                        <p className="text-sm text-muted-foreground">FCRA violation - escalate</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Generate Letters Tab */}
            <TabsContent value="generate" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="font-serif flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    Generate Next-Step Letters
                  </CardTitle>
                  <CardDescription>
                    Based on case status and scenario classification, generate the appropriate follow-up letters and complaints.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {cases.filter((c) => c.status !== "deleted" && c.status !== "pending").length === 0 ? (
                    <div className="text-center py-8">
                      <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">
                        No cases require follow-up letters yet. Update case statuses to generate appropriate next steps.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {cases
                        .filter((c) => c.status !== "deleted" && c.status !== "pending")
                        .map((c) => (
                          <div key={c.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline">{c.bureau}</Badge>
                                <Badge className={statusConfig[c.status].color}>
                                  {statusConfig[c.status].label}
                                </Badge>
                              </div>
                              <p className="font-medium">{c.accountName}</p>
                              <p className="text-sm text-muted-foreground">
                                {c.status === "no_response" && "→ Generate FCRA violation letter"}
                                {c.status === "verified" && "→ Generate CFPB complaint + MoV demand"}
                                {c.status === "partial" && "→ Generate follow-up MoV demand"}
                                {c.status === "frivolous" && "→ Generate appeal with documentation"}
                                {c.status === "reinsertion" && "→ Generate reinsertion violation letter"}
                              </p>
                            </div>
                            <Button variant="outline" className="border-primary/30 hover:border-primary/60">
                              <Download className="w-4 h-4 mr-2" />
                              Generate
                            </Button>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      <Footer />
    </main>
  );
};

export default Disputes;
