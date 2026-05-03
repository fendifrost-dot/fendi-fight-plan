import type { CanonicalAddress } from "./intake-types.ts";

/** Uppercase, trim, collapse internal space, strip punctuation for name compare */
export function normalizeNameToken(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCanonicalNameParts(legalName: string): {
  first: string;
  middle?: string;
  last: string;
} {
  const parts = legalName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  const first = parts[0];
  const last = parts[parts.length - 1];
  const middle = parts.length > 2 ? parts.slice(1, -1).join(" ") : undefined;
  return { first, middle, last };
}

export function zip5(zip: string): string {
  const d = zip.replace(/\D/g, "");
  return d.slice(0, 5);
}

/** USPS-ish light: uppercase, strip punct, normalize spaces */
export function normalizeAddressLine(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatAddressForCompare(a: CanonicalAddress): string {
  const line1 = normalizeAddressLine(a.line1);
  const city = normalizeAddressLine(a.city);
  const st = a.state.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  const z = zip5(a.zip);
  return `${line1}|${city}|${st}|${z}`;
}

export function isoDobParts(iso: string): { y: string; m: string; d: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return { y: m[1], m: m[2], d: m[3] };
}
