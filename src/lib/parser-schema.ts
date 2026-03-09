/**
 * Parser Schema — Client-side mirror of supabase/functions/_shared/parser-schema.ts
 * Validates AI extraction output structure and required fields.
 */

export interface SchemaViolation {
  entity: string;
  index: number;
  field: string;
  reason: string;
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

export function validateSchema(result: any): SchemaValidationResult {
  const violations: SchemaViolation[] = [];
  const validAccounts: any[] = [];
  const rejectedAccounts: any[] = [];

  if (!result || typeof result !== 'object') {
    return { valid: false, violations: [{ entity: 'root', index: -1, field: 'result', reason: 'Result is not an object' }], validAccounts: [], rejectedAccounts: [] };
  }

  if (result.derogatory_accounts && Array.isArray(result.derogatory_accounts)) {
    for (let i = 0; i < result.derogatory_accounts.length; i++) {
      const acct = result.derogatory_accounts[i];
      const acctViolations: SchemaViolation[] = [];

      if (!isNonEmptyString(acct.creditor_name)) {
        acctViolations.push({ entity: 'derogatory_accounts', index: i, field: 'creditor_name', reason: 'Missing or empty creditor_name' });
      }
      if (!isNonEmptyString(acct.account_number)) {
        acctViolations.push({ entity: 'derogatory_accounts', index: i, field: 'account_number', reason: 'Missing or empty account_number' });
      }
      if (!isArrayOrUndefined(acct.bureaus)) {
        acctViolations.push({ entity: 'derogatory_accounts', index: i, field: 'bureaus', reason: 'Must be array' });
      }
      if (acct.confidence && !['high', 'medium', 'low', 'incomplete'].includes(acct.confidence)) {
        acctViolations.push({ entity: 'derogatory_accounts', index: i, field: 'confidence', reason: `Invalid confidence: ${acct.confidence}` });
      }

      violations.push(...acctViolations);
      const hasCritical = acctViolations.some(v => v.field === 'creditor_name');
      if (hasCritical) {
        rejectedAccounts.push({ ...acct, _rejection_reasons: acctViolations.map(v => v.reason) });
      } else {
        validAccounts.push(acct);
      }
    }
  }

  return { valid: violations.length === 0, violations, validAccounts, rejectedAccounts };
}

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
