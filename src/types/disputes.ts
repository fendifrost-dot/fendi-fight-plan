// Dispute & Response Engine Types
// System B - Independent from System A

export type BureauKey = "experian" | "equifax" | "transunion";

// Engine mode: AI-assisted vs Manual
export type DisputeMode = "AI" | "MANUAL";

// Analysis status: tracks where AI processing is
export type AnalysisStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE" | "FAILED" | "SKIPPED" | "ABORTED" | "STALE";

export const BUREAU_DATA = {
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

// Document classification types
export type DocumentClassification = 
  | "bureau_response" 
  | "prior_dispute" 
  | "credit_report" 
  | "ftc_cfpb" 
  | "id_theft" 
  | "unknown";

// Uploaded file with metadata
export interface UploadedDocument {
  id: string;
  name: string;
  type: DocumentClassification;
  size: number;
  mimeType: string;
  file?: File;
  extractedText?: string;
  pageCount?: number;
  uploadedAt: string;
  processingStatus: "pending" | "extracting" | "classifying" | "complete" | "failed";
  errorMessage?: string;
  relativePath?: string;
  needsReupload?: boolean;
  storageUrl?: string;
}

// Classification bucket: where the account sits after deterministic analysis
export type AccountBucket = "derogatory" | "manual_review" | "clean";

// ─── Canonical Analyzer Result Contract ────────────────────────────────────
// ALL analysis paths (sync analyze-response, async analysis-worker, chunked
// useDisputeAnalysis) MUST converge to this shape. The backend/validator is
// the source of truth for buckets and confidence — the frontend must NOT
// recalculate or reinterpret these fields.

/** Parser confidence as emitted by the deterministic validator. */
export type ParserConfidence = "high" | "medium" | "low" | "incomplete";

export interface CanonicalAnalyzerResult {
  // ─── Bucketed tradeline arrays (deterministic, from validator) ─────
  derogatory_accounts: any[];
  manual_review_accounts: any[];
  clean_accounts: any[];

  /** Full tradeline inventory as extracted by AI before bucketing.
   *  NOTE: Currently populated from the validator's pre-bucketing snapshot.
   *  If the AI does not return a universal tradeline list, this equals the
   *  union of AI-flagged accounts before deterministic filtering. */
  all_tradelines: any[];

  // ─── Non-account entity arrays (first-class, never side-cargo) ────
  collections: any[];
  charge_offs: any[];
  inquiries: any[];
  public_records: any[];

  // ─── Identity mismatch entities ───────────────────────────────────
  inaccurate_names: any[];
  inaccurate_addresses: any[];
  inaccurate_employers: any[];
  extra_identifier_mismatches: any[];

  // ─── Validation / audit metadata ──────────────────────────────────
  tradeline_inventory: any;
  validation_status: string;
  validation_messages: string[];
  duplicate_flags: any[];
  warnings: string[];
  report_metadata: any;

  // ─── Display-only fields (not contract, downstream convenience) ───
  late_payment_summary?: any[];
  summary?: string;
  next_steps?: string[];
  bureau?: string;
  is_multi_bureau_report?: boolean;
  detected_bureaus?: string[];

  // ─── Contract versioning (for forensic traceability) ──────────────
  _contract_version?: string;
}

/** Default empty canonical result */
export function createEmptyCanonicalResult(): CanonicalAnalyzerResult {
  return {
    derogatory_accounts: [],
    manual_review_accounts: [],
    clean_accounts: [],
    all_tradelines: [],
    collections: [],
    charge_offs: [],
    inquiries: [],
    public_records: [],
    inaccurate_names: [],
    inaccurate_addresses: [],
    inaccurate_employers: [],
    extra_identifier_mismatches: [],
    tradeline_inventory: {},
    validation_status: 'NOT_RUN',
    validation_messages: [],
    duplicate_flags: [],
    warnings: [],
    report_metadata: {},
  };
}

/**
 * Hydrate a raw backend result (from analyze-response, analysis-worker, or
 * useDisputeAnalysis chunk aggregation) into the canonical shape.
 * This is the ONE place where raw -> canonical mapping happens.
 * Frontend MUST NOT rebuild or reinterpret beyond this function.
 */
export function hydrateCanonicalResult(raw: any): CanonicalAnalyzerResult {
  if (!raw || typeof raw !== 'object') return createEmptyCanonicalResult();

  return {
    derogatory_accounts: Array.isArray(raw.derogatory_accounts) ? raw.derogatory_accounts : [],
    manual_review_accounts: Array.isArray(raw.manual_review_accounts) ? raw.manual_review_accounts : [],
    clean_accounts: Array.isArray(raw.clean_accounts) ? raw.clean_accounts : [],
    all_tradelines: Array.isArray(raw.all_tradelines) ? raw.all_tradelines : [],
    collections: Array.isArray(raw.collections) ? raw.collections : [],
    charge_offs: Array.isArray(raw.charge_offs) ? raw.charge_offs : [],
    inquiries: Array.isArray(raw.inquiries)
      ? raw.inquiries
      : Array.isArray(raw._inquiries) ? raw._inquiries : [],
    public_records: Array.isArray(raw.public_records)
      ? raw.public_records
      : Array.isArray(raw._publicRecords) ? raw._publicRecords : [],
    inaccurate_names: Array.isArray(raw.inaccurate_names) ? raw.inaccurate_names : [],
    inaccurate_addresses: Array.isArray(raw.inaccurate_addresses) ? raw.inaccurate_addresses : [],
    inaccurate_employers: Array.isArray(raw.inaccurate_employers) ? raw.inaccurate_employers : [],
    extra_identifier_mismatches: Array.isArray(raw.extra_identifier_mismatches) ? raw.extra_identifier_mismatches : [],
    tradeline_inventory: raw.tradeline_inventory || {},
    validation_status: raw.validation_status || 'NOT_RUN',
    validation_messages: Array.isArray(raw.validation_messages) ? raw.validation_messages : [],
    duplicate_flags: Array.isArray(raw.duplicate_flags) ? raw.duplicate_flags : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    report_metadata: raw.report_metadata || {},
    late_payment_summary: Array.isArray(raw.late_payment_summary) ? raw.late_payment_summary : [],
    summary: raw.summary || raw._downstream_summary || undefined,
    next_steps: Array.isArray(raw.next_steps) ? raw.next_steps : (raw._downstream_next_steps || undefined),
    bureau: raw.bureau || undefined,
    is_multi_bureau_report: raw.is_multi_bureau_report || false,
    detected_bureaus: Array.isArray(raw.detected_bureaus) ? raw.detected_bureaus : [],
    _contract_version: raw._contract_version || 'v1',
  };
}

// ─── Legacy AnalysisResult (kept for backward compatibility with dispute flow) ──

// Analysis result per account
export interface DisputeAccount {
  id: string;
  maskedAccountNumber: string;
  creditorName: string;
  dateOpened?: string;
  bureauStatuses: {
    experian?: AccountStatus;
    equifax?: AccountStatus;
    transunion?: AccountStatus;
  };
  isSelected: boolean;
  disputeReason?: string;
  customReason?: string;
  sourceFile?: string;
  sourcePage?: number;
  /** Parser confidence string — DO NOT convert to number in UI */
  confidence: number | ParserConfidence;
  triageState: "included" | "excluded" | "pending";
  excludeReason?: string;
  reviewedAt?: string;
  /** Deterministic classification bucket */
  bucket?: AccountBucket;
  /** Exact deterministic triggers that caused derogatory classification */
  derogatoryTriggers?: string[];
}

/** Derive isSelected from triageState (backward-compatible) */
export function isAccountIncluded(account: DisputeAccount): boolean {
  if (!account.triageState || account.triageState === "included") return true;
  return false;
}

export interface AccountStatus {
  status: "current" | "closed" | "late" | "charge_off" | "collection" | "unknown" | string;
  balance?: string;
  remarks?: string;
  lastReported?: string;
  reported?: boolean;
}

// Bureau response analysis result — LEGACY wrapper used by dispute flow
// For new code, prefer CanonicalAnalyzerResult directly.
export interface AnalysisResult {
  bureau: BureauKey | "multi-bureau" | string;
  outcome: "verified" | "partial" | "deleted" | "no_response" | "frivolous" | "reinsertion";
  itemsVerified: string[];
  itemsDeleted: string[];
  itemsPartial: string[];
  legalImplications: string[];
  nextSteps: string[];
  rawSummary: string;
  accounts: DisputeAccount[];
  /** @deprecated Use CanonicalAnalyzerResult.inquiries instead */
  _inquiries?: any[];
  /** @deprecated Use CanonicalAnalyzerResult.public_records instead */
  _publicRecords?: any[];
  /** @deprecated Use CanonicalAnalyzerResult.collections instead */
  _collections?: any[];
}

// Outcome questionnaire
export interface OutcomeConfirmation {
  receivedResponse: boolean | null;
  responseWithin30Days: boolean | null;
  allItemsAddressed: boolean | null;
  anyReinsertions: boolean | null;
  notes: string;
}

// Legal strategy survey
export interface DisputeSurvey {
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

// Consumer contact info
export interface ConsumerInfo {
  fullName: string;
  addressLine1: string;
  addressLine2: string;
  cityStateZip: string;
}

// Processing progress
export interface ProcessingProgress {
  phase: "idle" | "ingesting" | "classifying" | "analyzing" | "normalizing" | "complete" | "error";
  currentStep: string;
  totalSteps: number;
  completedSteps: number;
  failedChunks: string[];
  message: string;
}

// Persisted dispute session
export interface DisputeSession {
  id: string;
  
  // === CORE ENGINE STATE (persisted to DB + localStorage) ===
  mode: DisputeMode;
  analysisStatus: AnalysisStatus;
  activeJobId: string | null;
  latestAnalyzerResultId: string | null;
  
  // === Section 1: Evidence ===
  documents: UploadedDocument[];
  bureauResponseText: string;
  priorLetterText: string;
  manualClaimsText: string;
  
  // === Section 2: Processing ===
  processingProgress: ProcessingProgress;
  
  // === Section 3: Analysis Results ===
  analysisResult: AnalysisResult | null;
  isAnalyzed: boolean;
  
  // === Section 4: Review ===
  accounts: DisputeAccount[];
  
  // === Section 5: Outcome Confirmation ===
  outcomeConfirmation: OutcomeConfirmation;
  
  // === Section 6: Legal Survey ===
  survey: DisputeSurvey;
  
  // === Section 7: Letter Generation ===
  selectedBureaus: BureauKey[];
  generatedLetters: Record<BureauKey, string>;
  consumerInfo: ConsumerInfo;
  
  // Imported data from System A
  importedAnalyzerData: any | null;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// Default values
export const defaultOutcomeConfirmation: OutcomeConfirmation = {
  receivedResponse: null,
  responseWithin30Days: null,
  allItemsAddressed: null,
  anyReinsertions: null,
  notes: "",
};

export const defaultSurvey: DisputeSurvey = {
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

export const defaultConsumerInfo: ConsumerInfo = {
  fullName: "",
  addressLine1: "",
  addressLine2: "",
  cityStateZip: "",
};

export const defaultProcessingProgress: ProcessingProgress = {
  phase: "idle",
  currentStep: "",
  totalSteps: 0,
  completedSteps: 0,
  failedChunks: [],
  message: "",
};

export function createDefaultSession(): DisputeSession {
  return {
    id: crypto.randomUUID(),
    mode: "AI",
    analysisStatus: "NOT_STARTED",
    activeJobId: null,
    latestAnalyzerResultId: null,
    documents: [],
    bureauResponseText: "",
    priorLetterText: "",
    manualClaimsText: "",
    processingProgress: defaultProcessingProgress,
    analysisResult: null,
    isAnalyzed: false,
    accounts: [],
    outcomeConfirmation: defaultOutcomeConfirmation,
    survey: defaultSurvey,
    selectedBureaus: [],
    generatedLetters: {} as Record<BureauKey, string>,
    consumerInfo: defaultConsumerInfo,
    importedAnalyzerData: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
