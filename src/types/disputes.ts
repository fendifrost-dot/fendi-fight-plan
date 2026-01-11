// Dispute & Response Engine Types
// System B - Independent from System A

export type BureauKey = "experian" | "equifax" | "transunion";

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
  extractedText?: string;
  pageCount?: number;
  uploadedAt: string;
  processingStatus: "pending" | "extracting" | "classifying" | "complete" | "failed";
  errorMessage?: string;
  relativePath?: string; // For folder/zip uploads
}

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
  confidence: number;
}

export interface AccountStatus {
  status: "current" | "closed" | "late" | "charge_off" | "collection" | "unknown";
  balance?: string;
  remarks?: string;
  lastReported?: string;
}

// Bureau response analysis result
export interface AnalysisResult {
  bureau: BureauKey | "multi-bureau";
  outcome: "verified" | "partial" | "deleted" | "no_response" | "frivolous" | "reinsertion";
  itemsVerified: string[];
  itemsDeleted: string[];
  itemsPartial: string[];
  legalImplications: string[];
  nextSteps: string[];
  rawSummary: string;
  accounts: DisputeAccount[];
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
  
  // Section 1: Evidence
  documents: UploadedDocument[];
  bureauResponseText: string;
  priorLetterText: string;
  
  // Section 2: Processing
  processingProgress: ProcessingProgress;
  
  // Section 3: Analysis Results
  analysisResult: AnalysisResult | null;
  isAnalyzed: boolean;
  
  // Section 4: Review
  accounts: DisputeAccount[];
  
  // Section 5: Outcome Confirmation
  outcomeConfirmation: OutcomeConfirmation;
  
  // Section 6: Legal Survey
  survey: DisputeSurvey;
  
  // Section 7: Letter Generation
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
    documents: [],
    bureauResponseText: "",
    priorLetterText: "",
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
