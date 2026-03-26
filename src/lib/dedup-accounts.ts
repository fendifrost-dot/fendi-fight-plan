/**
 * dedup-accounts.ts
 * Cross-bureau account deduplication for PrivacyGuard 3-bureau reports.
 *
 * PrivacyGuard reports list the same account once per bureau (Experian,
 * TransUnion, Equifax). This module detects duplicates using a composite
 * key of (creditor_name, date_opened, account_type/balance) and merges
 * them into a single canonical record with a consolidated `bureaus` array.
 */

import type {
  CanonicalAccount,
  CanonicalResult,
  NormalizedResult,
} from "./result-normalizer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeStr(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDateKey(d: string | null | undefined): string {
  if (!d) return "";
  const s = String(d).trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // M/D/YYYY or MM/DD/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, day, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return s;
}

// ---------------------------------------------------------------------------
// Core dedup
// ---------------------------------------------------------------------------

interface DedupeEntry {
  account: CanonicalAccount;
  bureaus: Set<string>;
  fieldCount: number;
}

function fieldCount(a: CanonicalAccount): number {
  let count = 0;
  for (const v of Object.values(a)) {
    if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) {
      count++;
    }
  }
  return count;
}

function compositeKey(a: CanonicalAccount): string | null {
  const name = normalizeStr(a.creditor_name);
  const date = normalizeDateKey(a.date_opened);
  if (!name || !date) return null;

  // Use balance as a secondary differentiator
  const bal = a.balance != null ? String(a.balance).replace(/[$,]/g, "") : "";
  return `${name}|${date}|${bal}`;
}

function mergeAccount(
  primary: CanonicalAccount,
  secondary: CanonicalAccount,
): CanonicalAccount {
  const merged: CanonicalAccount = { ...primary };

  // Fill in any fields that are empty in primary but populated in secondary
  for (const [key, value] of Object.entries(secondary)) {
    const pv = (merged as Record<string, unknown>)[key];
    if (
      (pv === null || pv === undefined || pv === "") &&
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

/**
 * Deduplicate an array of CanonicalAccount records.
 *
 * Accounts that share the same creditor name, date opened, and balance
 * are merged into a single record. The `bureaus` field is consolidated.
 *
 * @returns Object with deduplicated accounts array and summary stats.
 */
export function deduplicateAccounts(accounts: CanonicalAccount[]): {
  accounts: CanonicalAccount[];
  duplicatesRemoved: number;
} {
  const map = new Map<string, DedupeEntry>();
  const noKey: CanonicalAccount[] = [];

  for (const acct of accounts) {
    const key = compositeKey(acct);
    if (!key) {
      noKey.push(acct);
      continue;
    }

    const existing = map.get(key);
    if (existing) {
      // Merge bureau lists
      const incomingBureaus = acct.bureaus ?? [];
      for (const b of incomingBureaus) {
        existing.bureaus.add(b);
      }

      // Keep the record with more populated fields as primary
      if (fieldCount(acct) > existing.fieldCount) {
        existing.account = mergeAccount(acct, existing.account);
        existing.fieldCount = fieldCount(acct);
      } else {
        existing.account = mergeAccount(existing.account, acct);
      }
    } else {
      map.set(key, {
        account: acct,
        bureaus: new Set(acct.bureaus ?? []),
        fieldCount: fieldCount(acct),
      });
    }
  }

  // Rebuild accounts with consolidated bureaus
  const deduped: CanonicalAccount[] = [];
  for (const entry of map.values()) {
    deduped.push({
      ...entry.account,
      bureaus: Array.from(entry.bureaus),
    });
  }

  // Append accounts that couldn't be keyed (missing creditor/date)
  deduped.push(...noKey);

  return {
    accounts: deduped,
    duplicatesRemoved: accounts.length - deduped.length,
  };
}

/**
 * Deduplicate all account arrays within a CanonicalResult / NormalizedResult.
 *
 * Processes: derogatory_accounts, manual_review_accounts, clean_accounts,
 * and charge_offs.
 */
export function deduplicateResult<T extends CanonicalResult>(result: T): T & { dedup_summary: { before: number; after: number; removed: number } } {
  const accountKeys: (keyof CanonicalResult)[] = [
    "derogatory_accounts",
    "manual_review_accounts",
    "clean_accounts",
    "charge_offs",
  ];

  let totalBefore = 0;
  let totalAfter = 0;
  const updated = { ...result } as T;

  for (const key of accountKeys) {
    const arr = result[key] as CanonicalAccount[] | undefined;
    if (!arr || arr.length === 0) continue;

    totalBefore += arr.length;
    const { accounts } = deduplicateAccounts(arr);
    totalAfter += accounts.length;
    (updated as Record<string, unknown>)[key] = accounts;
  }

  return {
    ...updated,
    dedup_summary: {
      before: totalBefore,
      after: totalAfter,
      removed: totalBefore - totalAfter,
    },
  };
}

