/** Credit Compass intake — aligns with operator directive IntakeClientRecord */

export type IntakeStatus =
  | "intake"
  | "awaiting_approval"
  | "approved"
  | "doc_generated"
  | "engaged";

export type MatchResult = {
  matches: boolean;
  /** When false, per-bureau reported values relevant to the check */
  bureauValues?: Partial<Record<"equifax" | "experian" | "transunion", string>>;
  notes?: string;
};

export type DerogatoryAccountRow = {
  creditor: string;
  accountNumberMasked?: string;
  status: string;
  balance?: string;
  pastDue?: string;
  paymentHistory?: string;
  dateOpened?: string;
  rawSnippet?: string;
};

export type BureauSnapshot = {
  consumerLegalName?: string;
  alsoKnownAs: string[];
  currentAddresses: Array<{
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
  }>;
  formerAddresses: Array<{
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
  }>;
  employer?: string;
  dateOfBirthRaw?: string;
  ficoScore?: number;
  totalAccounts?: number;
  totalDebtDisplay?: string;
  utilizationDisplay?: string;
  derogatoryAccounts: DerogatoryAccountRow[];
  inquiries: Array<{ name?: string; date?: string; type?: string }>;
  publicRecords: Array<{ type?: string; disposition?: string; date?: string; text?: string }>;
};

export type CanonicalAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
};

export type IntakeCanonical = {
  legalName: string;
  legalNameFirst: string;
  legalNameMiddle?: string;
  legalNameLast: string;
  dob: string;
  currentAddress: CanonicalAddress;
  employer?: string;
  phone: string;
  email: string;
  referredBy?: string;
};

export type IntakeClientRecord = {
  clientId: string;
  createdAt: string;
  intakeOperatorId: string;
  status: IntakeStatus;
  canonical: IntakeCanonical;
  bureauReported: {
    equifax: BureauSnapshot;
    experian: BureauSnapshot;
    transunion: BureauSnapshot;
    pulledAt: {
      equifax: string;
      experian: string;
      transunion: string;
    };
  };
  identityReconciliation: {
    nameMatch: MatchResult;
    addressMatch: MatchResult;
    employerMatch: MatchResult;
    dobMatch: MatchResult;
  };
  fileProfile: {
    chargeOffs: number;
    collections: number;
    publicRecords: number;
    lateAccountsExcludingCO: number;
    hardInquiries: number;
  };
  pricingRecommendation: {
    score: number;
    tier: { name: string; low: number; high: number };
  };
  pricingApproved?: {
    quotedFee: number;
    discount?: {
      label: string;
      amount: number;
      deadlineHours: number;
      stipulation: string;
    };
    netTotal: number;
    overrideReason?: string;
    approvedBy: string;
    approvedAt: string;
  };
  paymentPlan?: {
    totalAgreed: number;
    deposit: { amount: number; dueBy: string; receivedAt?: string };
    installments: Array<{
      installmentNumber: number;
      amount: number;
      dueDate: string;
      receivedAt?: string;
      receivedAmount?: number;
    }>;
    paymentsReceived: Array<{
      date: string;
      amount: number;
      method: string;
      reference?: string;
    }>;
    remainingBalance: number;
    status: "current" | "late" | "paid_in_full" | "defaulted";
  };
  artifacts: {
    clientSummaryDocx?: string;
    clientSummaryPdf?: string;
    operatorPricingCardDocx?: string;
    operatorPricingCardPdf?: string;
  };
};

export const PRICING_FLOOR = 750;
export const PRICING_CEILING = 2500;

export const EMPTY_BUREAU: BureauSnapshot = {
  alsoKnownAs: [],
  currentAddresses: [],
  formerAddresses: [],
  derogatoryAccounts: [],
  inquiries: [],
  publicRecords: [],
};
