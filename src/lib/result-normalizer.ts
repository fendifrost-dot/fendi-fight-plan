/**
 * result-normalizer.ts
 * Client-side normalization utilities for credit report data.
 * Mirror of shared edge function logic.
 * Tests: src/test/resultNormalizer.test.ts, src/test/tradelineSegmentation.test.ts
 */

// ââ Types âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export interface CanonicalAccount {
  creditor_name?: string;
  account_number?: string;
  balance?: string | number;
  date_opened?: string;
  bureaus?: string[];
  source?: string;
  confidence?: string;
  derogatory_triggers?: string[];
  [key: string]: unknown;
}

export interface CanonicalInquiry {
  creditor_name?: string;
  date?: string;
  [key: string]: unknown;
}

export interface CanonicalPublicRecord {
  type?: string;
  date_filed?: string;
  [key: string]: unknown;
}

export interface CanonicalCollection {
  collection_agency?: string;
  balance?: string | number;
  [key: string]: unknown;
}

export interface CanonicalResult {
  derogatory_accounts?: CanonicalAccount[];
  manual_review_accounts?: CanonicalAccount[];
  clean_accounts?: CanonicalAccount[];
  charge_offs?: CanonicalAccount[];
  collections?: CanonicalCollection[];
  inquiries?: CanonicalInquiry[];
  public_records?: CanonicalPublicRecord[];
  inaccurate_names?: Record<string, unknown>[];
  inaccurate_addresses?: Record<string, unknown>[];
  inaccurate_employers?: Record<string, unknown>[];
  extra_identifier_mismatches?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface NormalizedResult extends CanonicalResult {
  duplicate_flags: string[];
}

// ââ Creditor alias map ââââââââââââââââââââââââââââââââââââââââââââââââââââ

const CREDITOR_ALIAS_MAP: Record<string, string> = {
  // Capital One
  'CAPITAL ONE BANK USA': 'CAPITAL ONE',
  'CAPITAL ONE BANK USA NA': 'CAPITAL ONE',
  'CAPITAL ONE BANK': 'CAPITAL ONE',
  'CAP ONE': 'CAPITAL ONE',
  // The Bank of Missouri
  'TBOM MILESTONE': 'THE BANK OF MISSOURI',
  'TBOM MIL': 'THE BANK OF MISSOURI',
  'THE BANK OF MISSOURI': 'THE BANK OF MISSOURI',
  // Chase
  'JPMORGAN CHASE BANK': 'CHASE',
  'CHASE BANK': 'CHASE',
  'CHASE BANK USA': 'CHASE',
  // Wells Fargo
  'WELLS FARGO BANK': 'WELLS FARGO',
  'WELLS FARGO BANK NA': 'WELLS FARGO',
  // Bank of America
  'BANK OF AMERICA NA': 'BANK OF AMERICA',
  'BANKAMERICA': 'BANK OF AMERICA',
  // Discover
  'DISCOVER BANK': 'DISCOVER',
  'DISCOVER FINANCIAL': 'DISCOVER',
  // Citibank
  'CITIBANK NA': 'CITIBANK',
  'CITIBANK USA': 'CITIBANK',
  'CITI CARDS': 'CITIBANK',
  // Synchrony
  'SYNCHRONY BANK': 'SYNCHRONY',
  'SYNCHRONY FINANCIAL': 'SYNCHRONY',
  // American Express
  'AMERICAN EXPRESS NATIONAL BANK': 'AMERICAN EXPRESS',
  'AMEX': 'AMERICAN EXPRESS',
};

// ââ Confidence normalization ââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const CONFIDENCE_MAP: Record<string, string> = {
  very_high: 'high',
  high: 'high',
  probable: 'medium',
  medium: 'medium',
  uncertain: 'low',
  low: 'low',
  very_low: 'very_low',
};

const CONFIDENCE_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
  very_low: 0,
};

// ââ Internal helpers ââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/** Strip parenthesized bureau codes like (7805), (D000), (0961) */
function stripBureauCode(name: string): string {
  return name.replace(/\s*\([A-Z0-9]{2,6}\)\s*/gi, '').trim();
}

/** Strip a trailing single uppercase letter initial, e.g. "SPARROW FINANCIAL I" â "SPARROW FINANCIAL" */
function stripTrailingInitial(name: string): string {
  return name.replace(/\s+[A-Z]$/, '').trim();
}

/** Replace /, -, _ with space; uppercase; collapse whitespace */
function cleanSeparators(name: string): string {
  return name
    .replace(/[/\\_]/g, ' ')
    .replace(/-/g, ' ')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ââ 1. normalizeCreditorName ââââââââââââââââââââââââââââââââââââââââââââââ

export function normalizeCreditorName(name: null): null;
export function normalizeCreditorName(name: undefined): undefined;
export function normalizeCreditorName(name: string): string;
export function normalizeCreditorName(
  name: string | null | undefined
): string | null | undefined {
  if (name === null) return null;
  if (name === undefined) return undefined;

  // Step 1: strip bureau code
  let cleaned = stripBureauCode(name);

  // Step 2: clean separators, uppercase, collapse whitespace
  cleaned = cleanSeparators(cleaned);

  // Step 3: exact alias lookup
  if (CREDITOR_ALIAS_MAP[cleaned] !== undefined) {
    return CREDITOR_ALIAS_MAP[cleaned];
  }

  // Step 4: strip trailing initial, try alias again
  const withoutInitial = stripTrailingInitial(cleaned);
  if (withoutInitial !== cleaned) {
    if (CREDITOR_ALIAS_MAP[withoutInitial] !== undefined) {
      return CREDITOR_ALIAS_MAP[withoutInitial];
    }
    return withoutInitial;
  }

  return cleaned;
}

// ââ 2. normalizeAccountNumber âââââââââââââââââââââââââââââââââââââââââââââ

const ACCOUNT_PASSTHROUGH = new Set(['N/A', 'UNEXTRACTABLE', 'NONE', 'UNKNOWN', 'UNAVAILABLE']);

export function normalizeAccountNumber(
  num: string | null | undefined
): string | null {
  if (num === null || num === undefined) return null;
  const trimmed = num.trim();
  const upper = trimmed.toUpperCase();

  if (ACCOUNT_PASSTHROUGH.has(upper)) return upper;

  // Keep digits only
  const digits = trimmed.replace(/[^0-9]/g, '');

  if (digits.length >= 4) {
    return digits.slice(-4);
  }

  // Short alphanumeric (4â6 chars, e.g. "1234") â return as-is uppercased
  if (trimmed.length <= 6 && /^[A-Z0-9]+$/i.test(trimmed)) {
    return upper;
  }

  if (digits.length > 0) return digits;

  return upper;
}

// ââ 3. normalizeBalance âââââââââââââââââââââââââââââââââââââââââââââââââââ

export function normalizeBalance(
  val: string | number | null | undefined
): string | null {
  if (val === null || val === undefined) return null;

  if (typeof val === 'number') {
    return String(Math.round(val));
  }

  // Strip $, commas, spaces
  const stripped = String(val)
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim();

  if (stripped === '' || stripped === '-') return null;

  const num = parseFloat(stripped);
  if (isNaN(num)) return stripped;
  return String(Math.round(num));
}

// ââ 4. normalizeDate ââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

export function normalizeDate(
  date: string | null | undefined
): string | null {
  if (date === null || date === undefined) return null;
  const s = date.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Mon DD, YYYY  or  Mon DD YYYY  (e.g. "Sep 9, 2024" or "Jan 1, 2020")
  const monDdYyyy = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monDdYyyy) {
    const [, mon, d, y] = monDdYyyy;
    const m = MONTH_MAP[mon.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, '0')}`;
  }

  // DD Mon YYYY  (e.g. "9 Sep 2024")
  const ddMonYyyy = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (ddMonYyyy) {
    const [, d, mon, y] = ddMonYyyy;
    const m = MONTH_MAP[mon.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, '0')}`;
  }

  // MM/YYYY partial date â first of month
  const mmYyyy = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmYyyy) {
    const [, m, y] = mmYyyy;
    return `${y}-${m.padStart(2, '0')}-01`;
  }

  return s;
}

// ââ 5. normalizeCanonicalResult âââââââââââââââââââââââââââââââââââââââââââ

function inferBureaus(account: CanonicalAccount): string[] {
  if (account.bureaus && account.bureaus.length > 0) return account.bureaus;
  if (account.source) {
    const src = (account.source as string).toLowerCase();
    if (src.includes('experian')) return ['experian'];
    if (src.includes('equifax')) return ['equifax'];
    if (src.includes('transunion') || src.includes('trans union')) return ['transunion'];
  }
  return ['unknown'];
}

function normalizeConfidence(conf: string | undefined): string {
  if (!conf) return 'medium';
  return CONFIDENCE_MAP[conf] ?? conf;
}

function deduplicateAccounts(
  accounts: CanonicalAccount[],
  duplicateFlags: string[]
): CanonicalAccount[] {
  const seen = new Map<string, CanonicalAccount>();

  for (const acct of accounts) {
    const bureaus = inferBureaus(acct);
    const creditor = normalizeCreditorName(acct.creditor_name ?? '') ?? '';
    const accNum = normalizeAccountNumber(acct.account_number ?? '') ?? '';
    const bureauKey = [...bureaus].sort().join(',');
    const key = `${creditor}|${accNum}|${bureauKey}`;

    if (seen.has(key)) {
      const existing = seen.get(key)!;
      const existConf = normalizeConfidence(existing.confidence as string | undefined);
      const newConf = normalizeConfidence(acct.confidence as string | undefined);
      const existRank = CONFIDENCE_RANK[existConf] ?? 1;
      const newRank = CONFIDENCE_RANK[newConf] ?? 1;
      existing.confidence = newRank > existRank ? newConf : existConf;
      const existTriggers = (existing.derogatory_triggers as string[]) ?? [];
      const newTriggers = (acct.derogatory_triggers as string[]) ?? [];
      existing.derogatory_triggers = [...new Set([...existTriggers, ...newTriggers])];
      duplicateFlags.push(key);
    } else {
      const normalized: CanonicalAccount = {
        ...acct,
        creditor_name: creditor,
        account_number: normalizeAccountNumber(acct.account_number) ?? undefined,
        balance: normalizeBalance(acct.balance as string | number) ?? undefined,
        date_opened: normalizeDate(acct.date_opened as string) ?? undefined,
        bureaus,
        confidence: normalizeConfidence(acct.confidence as string | undefined),
      };
      seen.set(key, normalized);
    }
  }

  return Array.from(seen.values());
}

export function normalizeCanonicalResult(
  input: Partial<CanonicalResult>
): NormalizedResult {
  const duplicateFlags: string[] = [];

  const normAccounts = (list?: CanonicalAccount[]): CanonicalAccount[] =>
    list ? deduplicateAccounts(list, duplicateFlags) : [];

  const normCollection = (col: CanonicalCollection): CanonicalCollection => ({
    ...col,
    collection_agency: col.collection_agency
      ? cleanSeparators(col.collection_agency)
      : undefined,
    balance: normalizeBalance(col.balance as string | number) ?? undefined,
  });

  const normInquiry = (inq: CanonicalInquiry): CanonicalInquiry => ({
    ...inq,
    creditor_name: inq.creditor_name
      ? (normalizeCreditorName(inq.creditor_name) as string)
      : undefined,
    date: normalizeDate(inq.date as string) ?? undefined,
  });

  const normPublicRecord = (pr: CanonicalPublicRecord): CanonicalPublicRecord => ({
    ...pr,
    date_filed: normalizeDate(pr.date_filed as string) ?? undefined,
  });

  return {
    ...input,
    derogatory_accounts: normAccounts(input.derogatory_accounts),
    manual_review_accounts: normAccounts(input.manual_review_accounts),
    clean_accounts: normAccounts(input.clean_accounts),
    charge_offs: normAccounts(input.charge_offs),
    collections: (input.collections ?? []).map(normCollection),
    inquiries: (input.inquiries ?? []).map(normInquiry),
    public_records: (input.public_records ?? []).map(normPublicRecord),
    inaccurate_names: input.inaccurate_names ?? [],
    inaccurate_addresses: input.inaccurate_addresses ?? [],
    inaccurate_employers: input.inaccurate_employers ?? [],
    extra_identifier_mismatches: input.extra_identifier_mismatches ?? [],
    duplicate_flags: duplicateFlags,
  };
}
