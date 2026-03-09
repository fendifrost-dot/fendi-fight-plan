/**
 * Parser Schema — Client-side mirror of supabase/functions/_shared/parser-schema.ts
 * Validates AI extraction output structure and required fields.
 * 
 * CRITICAL: Missing account_number is a critical violation unless
 * the value is "N/A" or "UNEXTRACTABLE" (contract placeholders).
 */

const CONTRACT_PLACEHOLDERS = ['N/A', 'UNEXTRACTABLE'] as const;

function isContractPlaceholder(val: any): boolean {
  if (typeof val !== 'string') return false;
  return (CONTRACT_PLACEHOLDERS as readonly string[]).includes(val.trim().toUpperCase());
}

export interface SchemaViolation {
  entity: string;
  index: number;
  field: string;
  reason: string;
  critical: boolean;
}

export interface SchemaValidationResult {
  valid: boolean;
  violations: SchemaViolation[];
  validAccounts: any[];
  rejectedAccounts: any[];
}

function isNonEmptyString(val: any): boolean {
  return typeof val === 'string' && val.trim().length > 0;
}

function isStringOrNull(val: any): boolean {
  return val === null || val === undefined || typeof val === 'string';
}

function isArrayOrUndefined(val: any): boolean {
  return val === undefined || val === null || Array.isArray(val);
}

function validateDerogatoryAccount(account: any, index: number, entity = 'derogatory_accounts'): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  if (!isNonEmptyString(account.creditor_name)) {
    violations.push({ entity, index, field: 'creditor_name', reason: 'Missing or empty creditor_name', critical: true });
  }
  if (!isNonEmptyString(account.account_number)) {
    violations.push({ entity, index, field: 'account_number', reason: 'Missing or empty account_number. Must be actual value, "N/A", or "UNEXTRACTABLE".', critical: true });
  }
  if (!isArrayOrUndefined(account.bureaus)) {
    violations.push({ entity, index, field: 'bureaus', reason: 'Must be array', critical: false });
  }
  if (account.confidence && !['high', 'medium', 'low', 'incomplete'].includes(account.confidence)) {
    violations.push({ entity, index, field: 'confidence', reason: `Invalid confidence: ${account.confidence}`, critical: false });
  }
  return violations;
}

function validateCollection(collection: any, index: number): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  if (!isNonEmptyString(collection.collection_agency) && !isNonEmptyString(collection.creditor_name) && !isNonEmptyString(collection.original_creditor)) {
    violations.push({ entity: 'collections', index, field: 'collection_agency|creditor_name|original_creditor', reason: 'At least one name field must be present', critical: true });
  }
  return violations;
}

function validateInquiry(inquiry: any, index: number): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  if (!isNonEmptyString(inquiry.creditor_name)) {
    violations.push({ entity: 'inquiries', index, field: 'creditor_name', reason: 'Missing creditor_name', critical: false });
  }
  if (!isNonEmptyString(inquiry.date)) {
    violations.push({ entity: 'inquiries', index, field: 'date', reason: 'Missing date', critical: false });
  }
  return violations;
}

function validatePublicRecord(record: any, index: number): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  if (!isNonEmptyString(record.type)) {
    violations.push({ entity: 'public_records', index, field: 'type', reason: 'Missing type', critical: true });
  }
  return violations;
}

export function validateSchema(result: any): SchemaValidationResult {
  const violations: SchemaViolation[] = [];
  const validAccounts: any[] = [];
  const rejectedAccounts: any[] = [];

  if (!result || typeof result !== 'object') {
    return { valid: false, violations: [{ entity: 'root', index: -1, field: 'result', reason: 'Result is not an object', critical: true }], validAccounts: [], rejectedAccounts: [] };
  }

  // Validate derogatory_accounts
  if (result.derogatory_accounts && Array.isArray(result.derogatory_accounts)) {
    for (let i = 0; i < result.derogatory_accounts.length; i++) {
      const acct = result.derogatory_accounts[i];
      const acctViolations = validateDerogatoryAccount(acct, i);
      violations.push(...acctViolations);
      const hasCritical = acctViolations.some(v => v.critical);
      if (hasCritical) {
        rejectedAccounts.push({ ...acct, _rejection_reasons: acctViolations.map(v => v.reason) });
      } else {
        validAccounts.push(acct);
      }
    }
  }

  // Validate charge_offs with same rigor as derogatory_accounts
  if (result.charge_offs && Array.isArray(result.charge_offs)) {
    for (let i = 0; i < result.charge_offs.length; i++) {
      const acctViolations = validateDerogatoryAccount(result.charge_offs[i], i, 'charge_offs');
      violations.push(...acctViolations);
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

  // Validate public_records
  if (result.public_records && Array.isArray(result.public_records)) {
    for (let i = 0; i < result.public_records.length; i++) {
      violations.push(...validatePublicRecord(result.public_records[i], i));
    }
  }

  return { valid: violations.length === 0, violations, validAccounts, rejectedAccounts };
}

export function ensureRequiredArrays(result: any): any {
  return {
    ...result,
    derogatory_accounts: Array.isArray(result.derogatory_accounts) ? result.derogatory_accounts : [],
    manual_review_accounts: Array.isArray(result.manual_review_accounts) ? result.manual_review_accounts : [],
    clean_accounts: Array.isArray(result.clean_accounts) ? result.clean_accounts : [],
    all_tradelines: Array.isArray(result.all_tradelines) ? result.all_tradelines : [],
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
