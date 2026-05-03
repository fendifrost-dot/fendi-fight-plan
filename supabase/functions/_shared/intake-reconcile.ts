import type { BureauSnapshot, IntakeCanonical, MatchResult } from "./intake-types.ts";
import {
  formatAddressForCompare,
  isoDobParts,
  normalizeNameToken,
} from "./intake-normalize.ts";

function bureauNameStrings(snap: BureauSnapshot): string[] {
  const out: string[] = [];
  if (snap.consumerLegalName?.trim()) out.push(snap.consumerLegalName.trim());
  for (const aka of snap.alsoKnownAs || []) {
    if (aka?.trim()) out.push(aka.trim());
  }
  return out;
}

function firstLastMatch(canonical: IntakeCanonical, bureauFull: string): boolean {
  const f = normalizeNameToken(canonical.legalNameFirst);
  const l = normalizeNameToken(canonical.legalNameLast);
  const parts = bureauFull.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  const bf = normalizeNameToken(parts[0]);
  const bl = normalizeNameToken(parts[parts.length - 1]);
  return bf === f && bl === l;
}

export function reconcileIdentity(
  canonical: IntakeCanonical,
  bureauReported: {
    equifax: BureauSnapshot;
    experian: BureauSnapshot;
    transunion: BureauSnapshot;
  },
): {
  nameMatch: MatchResult;
  addressMatch: MatchResult;
  employerMatch: MatchResult;
  dobMatch: MatchResult;
} {
  const bureaus = ["equifax", "experian", "transunion"] as const;
  const bureauValuesName: Partial<Record<(typeof bureaus)[number], string>> = {};
  let anyNameMismatch = false;

  for (const b of bureaus) {
    const names = bureauNameStrings(bureauReported[b]);
    const primary = names[0] ?? "";
    bureauValuesName[b] = names.join(" | ") || "(not parsed)";
    const ok = names.some((n) => firstLastMatch(canonical, n));
    if (!ok && primary) anyNameMismatch = true;
    if (!primary) anyNameMismatch = true;
  }

  const canonicalAddr = formatAddressForCompare(canonical.currentAddress);
  const bureauValuesAddr: Partial<Record<(typeof bureaus)[number], string>> = {};
  let addrMismatch = false;
  for (const b of bureaus) {
    const currents = bureauReported[b].currentAddresses || [];
    const primary = currents[0];
    const shown = primary
      ? `${primary.line1}, ${primary.city}, ${primary.state} ${primary.zip}`
      : "(no current address parsed)";
    bureauValuesAddr[b] = shown;
    const match = currents.some((addr) =>
      formatAddressForCompare({
        line1: addr.line1,
        line2: addr.line2,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
      }) === canonicalAddr
    );
    if (!match) addrMismatch = true;
  }

  const canonEmp = (canonical.employer || "").trim().toLowerCase();
  const bureauValuesEmp: Partial<Record<(typeof bureaus)[number], string>> = {};
  let employerSoftOk = true;
  for (const b of bureaus) {
    const r = (bureauReported[b].employer || "").trim();
    bureauValuesEmp[b] = r || "(not reported)";
    if (canonEmp) {
      const rb = r.toLowerCase();
      if (r && !rb.includes(canonEmp) && !canonEmp.includes(rb)) {
        employerSoftOk = false;
      }
    }
  }

  const canonIso = canonical.dob;
  const canonParts = isoDobParts(canonIso);
  const bureauValuesDob: Partial<Record<(typeof bureaus)[number], string>> = {};
  let dobOk = true;
  let dobSoftNote: string | undefined;
  for (const b of bureaus) {
    const raw = (bureauReported[b].dateOfBirthRaw || "").trim();
    bureauValuesDob[b] = raw || "(not parsed)";
    if (!canonParts) {
      dobOk = false;
      continue;
    }
    const yOnly = /^(\d{4})$/.test(raw);
    const full = /^(\d{4})-(\d{2})-(\d{2})$/.test(raw) ||
      /^(\d{2})\/(\d{2})\/(\d{4})$/.test(raw);
    if (yOnly) {
      if (raw !== canonParts.y) dobOk = false;
      else dobSoftNote = "Year-only DOB match on at least one bureau";
    } else if (full) {
      let y = "";
      let m = "";
      let d = "";
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
      if (iso) {
        y = iso[1];
        m = iso[2];
        d = iso[3];
      } else if (us) {
        m = us[1];
        d = us[2];
        y = us[3];
      }
      if (`${y}-${m}-${d}` !== canonIso) dobOk = false;
    } else if (raw) {
      if (!raw.includes(canonParts.y)) dobOk = false;
      else dobSoftNote = "Partial DOB text match";
    } else {
      dobOk = false;
    }
  }

  return {
    nameMatch: {
      matches: !anyNameMismatch,
      bureauValues: bureauValuesName,
    },
    addressMatch: {
      matches: !addrMismatch,
      bureauValues: bureauValuesAddr,
    },
    employerMatch: {
      matches: employerSoftOk,
      bureauValues: bureauValuesEmp,
      notes: canonEmp ? undefined : "No canonical employer to compare",
    },
    dobMatch: {
      matches: dobOk,
      bureauValues: bureauValuesDob,
      notes: dobSoftNote,
    },
  };
}
