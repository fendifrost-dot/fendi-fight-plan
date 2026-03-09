/**
 * Parser Schema — Strict JSON schema enforcement for AI extraction output.
 * 
 * Validates that AI output contains all required fields with correct types.
 * Rejects malformed output before it enters the pipeline.
 * 
 * CRITICAL: Missing account_number is a CRITICAL violation unless the value
 * is an explicit contract-compliant placeholder: "N/A" or "UNEXTRACTABLE".
 */

// ─── Contract-Compliant Placeholders ───────────────────────────────────────
// These are the ONLY acceptable placeholder values for required fields.
// Any other empty/missing value is a critical violation.

const CONTRACT_PLACEHOLDERS = ['N/A', 'UNEXTRACTABLE'] as const;

function isContractPlaceholder(val: any): boolean {
  if (typeof val !== 'string') return false;
  return (CONTRACT_PLACEHOLDERS as readonly string[]).includes(val.trim().toUpperCase());
}

// ─── Required Fields Per Entity Type ───────────────────────────────────────

const DEROGATORY_ACCOUNT_REQUIRED = ['creditor_name', 'account_number'] as const;
const COLLECTION_REQUIRED = ['balance'] as const;
const INQUIRY_REQUIRED = ['creditor_name', 'date'] as const;
const PUBLIC_RECORD_REQUIRED = ['type'] as const;

// ─── Schema Violation ──────────────────────────────────────────────────────

export interface SchemaViolation {
  entity: string;
  index: number;
  field: string;
  reason: string;
  critical: boolean;
}

// ─── Schema Validation Result ──────────────────────────────────────────────

export interface SchemaValidationResult {
  valid: boolean;
  violations: SchemaViolation[];
  validAccounts: any[];
  rejectedAccounts: any[];
}

// ─── Field Validators ──────────────────────────────────────────────────────

function isNonEmptyString(val: any): boolean {
  return typeof val === 'string' && val.trim().length > 0;
}

function isNonEmptyStringOrPlaceholder(val: any): boolean {
  return isNonEmptyString(val);
}

function isStringOrNull(val: any): boolean {
  return val === null || val === undefined || typeof val === 'string';
}

function isArrayOrUndefined(val: any): boolean {
  return val === undefined || val === null || Array.isArray(val);
}

// ─── Entity Validators ─────────────────────────────────────────────────────

function validateDerogatoryAccount(account: any, index: number): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  // creditor_name: CRITICAL — must be non-empty
  if (!isNonEmptyString(account.creditor_name)) {
    violations.push({
      entity: 'derogatory_accounts', index, field: 'creditor_name',
      reason: 'Missing or empty required field "creditor_name"',
      critical: true,
    });
  }

  // account_number: CRITICAL unless contract placeholder (N/A, UNEXTRACTABLE)
  if (!isNonEmptyString(account.account_number)) {
    violations.push({
      entity: 'derogatory_accounts', index, field: 'account_number',
      reason: 'Missing or empty required field "account_number". Must be actual value, "N/A", or "UNEXTRACTABLE".',
      critical: true,
    });
  } else if (!isContractPlaceholder(account.account_number)) {
    // Has a value — that's fine, it's a real account number
  }
  // If it IS a contract placeholder, that's explicitly allowed — no violation

  // Type checks on optional fields
  if (!isStringOrNull(account.date_opened)) {
    violations.push({ entity: 'derogatory_accounts', index, field: 'date_opened', reason: 'Must be string or null', critical: false });
  }
  if (!isStringOrNull(account.balance)) {
    violations.push({ entity: 'derogatory_accounts', index, field: 'balance', reason: 'Must be string or null', critical: false });
  }
  if (!isStringOrNull(account.status_as_reported) && !isStringOrNull(account.status)) {
    violations.push({ entity: 'derogatory_accounts', index, field: 'status_as_reported', reason: 'Must be string or null', critical: false });
  }
  if (!isArrayOrUndefined(account.bureaus)) {
    violations.push({ entity: 'derogatory_accounts', index, field: 'bureaus', reason: 'Must be array or undefined', critical: false });
  }
  if (!isArrayOrUndefined(account.derogatory_triggers)) {
    violations.push({ entity: 'derogatory_accounts', index, field: 'derogatory_triggers', reason: 'Must be array or undefined', critical: false });
  }

  // Confidence must be one of the valid levels if present
  if (account.confidence && !['high', 'medium', 'low', 'incomplete'].includes(account.confidence)) {
    violations.push({ entity: 'derogatory_accounts', index, field: 'confidence', reason: `Invalid confidence level: ${account.confidence}`, critical: false });
  }

  return violations;
}

function validateCollection(collection: any, index: number): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  for (const field of COLLECTION_REQUIRED) {
    if (!isNonEmptyString(collection[field])) {
      violations.push({
        entity: 'collections', index, field,
        reason: `Missing or empty required field "${field}"`,
        critical: false,
      });
    }
  }

  if (!isNonEmptyString(collection.collection_agency) && !isNonEmptyString(collection.creditor_name) && !isNonEmptyString(collection.original_creditor)) {
    violations.push({
      entity: 'collections', index,
      field: 'collection_agency|creditor_name|original_creditor',
      reason: 'At least one name field must be present',
      critical: true,
    });
  }

  return violations;
}

function validateInquiry(inquiry: any, index: number): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  for (const field of INQUIRY_REQUIRED) {
    if (!isNonEmptyString(inquiry[field])) {
      violations.push({
        entity: 'inquiries', index, field,
        reason: `Missing or empty required field "${field}"`,
        critical: false,
      });
    }
  }

  if (inquiry.type && !['hard', 'soft', 'promotional', 'account_review', 'unknown'].includes(inquiry.type)) {
    violations.push({ entity: 'inquiries', index, field: 'type', reason: `Invalid inquiry type: ${inquiry.type}`, critical: false });
  }

  return violations;
}

function validatePublicRecord(record: any, index: number): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  for (const field of PUBLIC_RECORD_REQUIRED) {
    if (!isNonEmptyString(record[field])) {
      violations.push({
        entity: 'public_records', index, field,
        reason: `Missing or empty required field "${field}"`,
        critical: true,
      });
    }
  }

  return violations;
}

// ─── Top-Level Schema Validation ───────────────────────────────────────────

export function validateSchema(result: any): SchemaValidationResult {
  const violations: SchemaViolation[] = [];
  const validAccounts: any[] = [];
  const rejectedAccounts: any[] = [];

  if (!result || typeof result !== 'object') {
    return {
      valid: false,
      violations: [{ entity: 'root', index: -1, field: 'result', reason: 'Result is not an object', critical: true }],
      validAccounts: [],
      rejectedAccounts: [],
    };
  }

  // Validate derogatory accounts
  const derogatoryAccounts = result.derogatory_accounts;
  if (derogatoryAccounts && Array.isArray(derogatoryAccounts)) {
    for (let i = 0; i < derogatoryAccounts.length; i++) {
      const acctViolations = validateDerogatoryAccount(derogatoryAccounts[i], i);
      if (acctViolations.length > 0) {
        violations.push(...acctViolations);
        const hasCriticalViolation = acctViolations.some(v => v.critical);
        if (hasCriticalViolation) {
          rejectedAccounts.push({ ...derogatoryAccounts[i], _rejection_reasons: acctViolations.map(v => v.reason) });
        } else {
          validAccounts.push(derogatoryAccounts[i]);
        }
      } else {
        validAccounts.push(derogatoryAccounts[i]);
      }
    }
  }

  // Validate collections
  if (result.collections && Array.isArray(result.collections)) {
    for (let i = 0; i < result.collections.length; i++) {
      violations.push(...validateCollection(result.collections[i], i));
    }
  }

  // Validate inquiries
  if (result.inquiries && Array.isArray(result.inquiries)) {
    for (let i = 0; i < result.inquiries.length; i++) {
      violations.push(...validateInquiry(result.inquiries[i], i));
    }
  }

  // Validate public records
  if (result.public_records && Array.isArray(result.public_records)) {
    for (let i = 0; i < result.public_records.length; i++) {
      violations.push(...validatePublicRecord(result.public_records[i], i));
    }
  }

  // Validate charge_offs
  if (result.charge_offs && Array.isArray(result.charge_offs)) {
    for (let i = 0; i < result.charge_offs.length; i++) {
      if (!isNonEmptyString(result.charge_offs[i]?.creditor_name)) {
        violations.push({ entity: 'charge_offs', index: i, field: 'creditor_name', reason: 'Missing creditor_name', critical: true });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    validAccounts,
    rejectedAccounts,
  };
}

/**
 * Ensure all expected top-level arrays exist with defaults.
 */
export function ensureRequiredArrays(result: any): any {
  return {
    ...result,
    derogatory_accounts: Array.isArray(result.derogatory_accounts) ? result.derogatory_accounts : [],
    collections: Array.isArray(result.collections) ? result.collections : [],
    charge_offs: Array.isArray(result.charge_offs) ? result.charge_offs : [],
    inquiries: Array.isArray(result.inquiries) ? result.inquiries : [],
    public_records: Array.isArray(result.public_records) ? result.public_records : [],
    inaccurate_names: Array.isArray(result.inaccurate_names) ? result.inaccurate_names : [],
    inaccurate_addresses: Array.isArray(result.inaccurate_addresses) ? result.inaccurate_addresses : [],
    inaccurate_employers: Array.isArray(result.inaccurate_employers) ? result.inaccurate_employers : [],
    extra_identifier_mismatches: Array.isArray(result.extra_identifier_mismatches) ? result.extra_identifier_mismatches : [],
    late_payment_summary: Array.isArray(result.late_payment_summary) ? result.late_payment_summary : [],
  };
}
