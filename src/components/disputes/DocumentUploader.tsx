import { useState, useRef, useCallback } from "react";
import { Upload, FileText, FileArchive, FolderOpen, Loader2, X, File, Lock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import mammoth from "mammoth";
import type { UploadedDocument, DocumentClassification } from "@/types/disputes";

interface DocumentUploaderProps {
  documents: UploadedDocument[];
  onAddDocument: (doc: UploadedDocument) => void;
  onRemoveDocument: (id: string) => void;
  onExtractedText?: (docId: string, text: string) => void;
  disabled?: boolean;
  category: "bureau_response" | "prior_dispute";
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ZIP_SIZE = 50 * 1024 * 1024; // 50MB for ZIP

const ACCEPTED_TYPES: Record<string, string[]> = {
  bureau_response: [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
  prior_dispute: [".docx", ".pdf", ".txt"],
};

const MIME_TYPES: Record<string, string[]> = {
  bureau_response: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  prior_dispute: ["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

export function DocumentUploader({
  documents,
  onAddDocument,
  onRemoveDocument,
  onExtractedText,
  disabled = false,
  category,
}: DocumentUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");

  const categoryLabel = category === "bureau_response" ? "Bureau Response" : "Prior Dispute Letter";
  const acceptedExtensions = ACCEPTED_TYPES[category].join(",");
  const acceptedMimes = MIME_TYPES[category];

  const validateFile = (file: File, isZip = false): boolean => {
    const maxSize = isZip ? MAX_ZIP_SIZE : MAX_FILE_SIZE;
    
    if (file.size > maxSize) {
      toast.error(`${file.name} exceeds ${isZip ? "50MB" : "10MB"} limit`);
      return false;
    }

    if (!isZip) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!ACCEPTED_TYPES[category].includes(ext)) {
        toast.error(`${file.name} is not an accepted file type`);
        return false;
      }
    }

    return true;
  };

  const extractTextFromFile = async (file: File): Promise<string | undefined> => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    
    try {
      if (ext === "txt") {
        return await file.text();
      }
      
      if (ext === "docx") {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
      }
    } catch (err) {
      console.error("Text extraction failed:", err);
      toast.error(`Could not extract text from ${file.name}. Manual entry available.`);
    }
    
    return undefined;
  };

  const processFile = async (file: File, relativePath?: string): Promise<void> => {
    if (!validateFile(file)) return;

    const extractedText = await extractTextFromFile(file);
    
    const newDoc: UploadedDocument = {
      id: crypto.randomUUID(),
      name: file.name,
      type: category,
      size: file.size,
      mimeType: file.type,
      extractedText,
      uploadedAt: new Date().toISOString(),
      processingStatus: "complete",
      relativePath,
      file, // Include the actual File object for analysis
    };

    onAddDocument(newDoc);
    
    if (extractedText && onExtractedText) {
      onExtractedText(newDoc.id, extractedText);
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsProcessing(true);
    setProcessingMessage(`Processing ${files.length} file(s)...`);

    try {
      for (let i = 0; i < files.length; i++) {
        setProcessingMessage(`Processing ${i + 1} of ${files.length}: ${files[i].name}`);
        await processFile(files[i]);
      }
      toast.success(`${files.length} file(s) added`);
    } finally {
      setIsProcessing(false);
      setProcessingMessage("");
    }
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setProcessingMessage(`Processing folder with ${files.length} files...`);

    try {
      const validFiles: File[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = "." + file.name.split(".").pop()?.toLowerCase();
        
        // Filter to accepted types
        if (ACCEPTED_TYPES[category].includes(ext) || file.name.endsWith(".docx") || file.name.endsWith(".pdf")) {
          validFiles.push(file);
        }
      }

      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        // @ts-ignore - webkitRelativePath is non-standard but widely supported
        const relativePath = file.webkitRelativePath || file.name;
        setProcessingMessage(`Processing ${i + 1} of ${validFiles.length}: ${file.name}`);
        await processFile(file, relativePath);
      }

      toast.success(`${validFiles.length} files added from folder`);
    } finally {
      setIsProcessing(false);
      setProcessingMessage("");
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".zip")) {
      toast.error("Please upload a .zip file");
      return;
    }

    if (!validateFile(file, true)) return;

    setIsProcessing(true);
    setProcessingMessage("Processing ZIP file...");

    try {
      // Dynamic import JSZip
      const JSZipModule = await import("jszip");
      const JSZip = JSZipModule.default;
      const zip = await JSZip.loadAsync(file);
      
      const entries = Object.entries(zip.files) as [string, any][];
      const validEntries = entries.filter(([path, zipEntry]) => {
        if (zipEntry.dir) return false;
        const ext = "." + path.split(".").pop()?.toLowerCase();
        return [...ACCEPTED_TYPES.bureau_response, ...ACCEPTED_TYPES.prior_dispute, ".docx"].includes(ext);
      });

      let processed = 0;
      for (const [path, zipEntry] of validEntries) {
        setProcessingMessage(`Extracting ${processed + 1} of ${validEntries.length}: ${path.split("/").pop()}`);
        
        const blobData = await zipEntry.async("arraybuffer");
        const fileName = path.split("/").pop() || path;
        const ext = "." + fileName.split(".").pop()?.toLowerCase();
        
        // Determine mime type
        let mimeType = "application/octet-stream";
        if (ext === ".pdf") mimeType = "application/pdf";
        else if (ext === ".png") mimeType = "image/png";
        else if ([".jpg", ".jpeg"].includes(ext)) mimeType = "image/jpeg";
        else if (ext === ".webp") mimeType = "image/webp";
        else if (ext === ".docx") mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        else if (ext === ".txt") mimeType = "text/plain";

        // Create proper File object from arraybuffer using global File constructor
        const blob = new Blob([blobData], { type: mimeType });
        const FileConstructor = globalThis.File;
        const extractedFile = new FileConstructor([blob], fileName, { 
          type: mimeType,
          lastModified: Date.now()
        });
        await processFile(extractedFile, path);
        processed++;
      }

      toast.success(`${processed} files extracted from ZIP`);
    } catch (err) {
      console.error("ZIP processing error:", err);
      toast.error("Failed to process ZIP file");
    } finally {
      setIsProcessing(false);
      setProcessingMessage("");
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (disabled || isProcessing) return;
    
    const files = e.dataTransfer.files;
    await handleFileSelect(files);
  }, [disabled, isProcessing]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !isProcessing) setIsDragging(true);
  }, [disabled, isProcessing]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const filteredDocs = documents.filter(d => d.type === category);

  return (
    <div className="space-y-4">
      <Label className="text-sm font-medium">{categoryLabel}(s)</Label>
      
      {/* Main dropzone */}
      <div
        onClick={() => !disabled && !isProcessing && fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => e.key === "Enter" && !disabled && fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center transition-all
          ${disabled ? "opacity-50 cursor-not-allowed border-border/50" : "cursor-pointer hover:border-primary/50"}
          ${isDragging ? "border-primary bg-primary/5" : "border-border"}
          ${isProcessing ? "pointer-events-none" : ""}
        `}
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground">{processingMessage}</p>
          </>
        ) : (
          <>
            <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-2">
              Drop files here or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              {category === "bureau_response" ? "PDF, PNG, JPG, WebP" : "DOCX, PDF, TXT"} (max 10MB)
            </p>
          </>
        )}
        
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept={acceptedExtensions}
          multiple
          onChange={(e) => handleFileSelect(e.target.files)}
          disabled={disabled || isProcessing}
        />
      </div>

      {/* Advanced upload options */}
      {!disabled && (
        <div className="flex gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => zipInputRef.current?.click()}
            disabled={isProcessing}
          >
            <FileArchive className="w-4 h-4 mr-2" />
            Upload ZIP
          </Button>
          
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => folderInputRef.current?.click()}
            disabled={isProcessing}
          >
            <FolderOpen className="w-4 h-4 mr-2" />
            Select Folder
          </Button>
          
          <input
            ref={zipInputRef}
            type="file"
            className="hidden"
            accept=".zip"
            onChange={handleZipUpload}
            disabled={isProcessing}
          />
          
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            // @ts-ignore - webkitdirectory is non-standard
            webkitdirectory=""
            multiple
            onChange={handleFolderSelect}
            disabled={isProcessing}
          />
        </div>
      )}

      {/* File list */}
      {filteredDocs.length > 0 && (
        <div className="space-y-2">
          {filteredDocs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border"
            >
              <div className="flex items-center gap-3 min-w-0">
                {disabled ? (
                  <Lock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                ) : doc.processingStatus === "failed" ? (
                  <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                ) : (
                  <File className="w-4 h-4 text-primary flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {(doc.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    {doc.relativePath && (
                      <p className="text-xs text-muted-foreground truncate">
                        {doc.relativePath}
                      </p>
                    )}
                    {doc.extractedText && (
                      <Badge variant="outline" className="text-xs">
                        Text extracted
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              
              {!disabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveDocument(doc.id)}
                  className="text-muted-foreground hover:text-destructive flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
