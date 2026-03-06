import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Inline post-processing (Deno edge functions cannot import src/lib) ──

const _NEGATIVE_KEYWORDS = [
  'late','late payment','late payments','30 days late','60 days late','90 days late',
  '120 days late','150 days late','30-day late','60-day late','90-day late',
  '120-day late','150-day late','potentially negative','past due','past-due',
  'derogatory','charge off','charged off','charged-off','chargeoff','written off',
  'write off','write-off','collection','collections','repossession','foreclosure',
  'settled','settled for less','bankruptcy','included in bankruptcy','profit and loss write-off',
];
const _NEGATIVE_SECTIONS = ['potentially negative items','negative accounts','adverse accounts','collection accounts','derogatory'];
const _NEGATIVE_GRID = ['2','3','4','5','X','CO','D'];

function _wwm(text: string, kw: string): boolean {
  if (!text || !kw) return false;
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-zA-Z0-9])${esc}(?![a-zA-Z0-9])`, 'i').test(text);
}

function _isPastDueNeg(val?: string | null): boolean {
  if (!val) return false;
  const n = parseFloat(val.replace(/[$,]/g, ''));
  return !isNaN(n) && n > 0;
}

function _negGridCodes(codes?: string | null): string[] {
  if (!codes) return [];
  return codes.split(/[\s,;|]+/).filter((c: string) => _NEGATIVE_GRID.includes(c.toUpperCase()));
}

function _classifyTl(t: any): string[] {
  const triggers: string[] = [];
  const blockText = [t.status_as_reported, t.remarks, t.block_text].filter(Boolean).join(' ');
  for (const kw of _NEGATIVE_KEYWORDS) { if (_wwm(blockText, kw)) triggers.push(kw); }
  if (_isPastDueNeg(t.past_due_amount)) triggers.push(`past due > $0 (${t.past_due_amount})`);
  const gc = _negGridCodes(t.payment_grid_codes);
  if (gc.length) triggers.push(`grid codes: ${gc.join(', ')}`);
  if (t.section_header && _NEGATIVE_SECTIONS.includes(t.section_header.toLowerCase())) triggers.push(`section: ${t.section_header}`);
  if (t.date_first_delinquency) triggers.push(`date of first delinquency: ${t.date_first_delinquency}`);
  return triggers;
}

function _detectDups(tradelines: any[]): any[] {
  if (!tradelines || tradelines.length < 2) return [];
  const seen = new Map<string, number[]>();
  for (let i = 0; i < tradelines.length; i++) {
    const name = (tradelines[i].creditor_name || '').trim().toUpperCase();
    const acct = (tradelines[i].account_number || '').trim().toUpperCase();
    const bureau = (tradelines[i].bureaus?.[0] || 'unknown').toLowerCase();
    const key = `${bureau}|${name}|${acct}`;
    if (!seen.has(key)) seen.set(key, [i]); else seen.get(key)!.push(i);
  }
  const flags: any[] = [];
  for (const [key, indices] of seen) {
    if (indices.length > 1) {
      const [bureau, name, acct] = key.split('|');
      flags.push({ creditor_name: name, account_number: acct, bureau, indices, message: `POSSIBLE DUPLICATE — verify against source report. (${indices.length} entries)` });
    }
  }
  return flags;
}

function _validateCounts(report: any): { status: string; messages: string[] } {
  const meta = report.metadata || report.report_metadata;
  if (!meta || (meta.accounts_ever_late == null && meta.collections_count == null)) {
    return { status: 'SKIPPED', messages: ['No bureau summary counts found in report.'] };
  }
  const msgs: string[] = [];
  let worst = 'PASS';
  const negCount = (report.derogatory_accounts?.length ?? 0) + (report.charge_offs?.length ?? 0);
  const colCount = report.collections?.length ?? 0;
  if (meta.collections_count != null && colCount < meta.collections_count) { msgs.push(`EXTRACTION INCOMPLETE — COLLECTIONS MISMATCH (extracted ${colCount}, expected ${meta.collections_count})`); worst = 'ERROR'; }
  if (meta.accounts_ever_late != null && negCount < meta.accounts_ever_late) { msgs.push(`EXTRACTION INCOMPLETE — NEGATIVE TRADELINE MISMATCH (extracted ${negCount}, expected ${meta.accounts_ever_late})`); worst = 'ERROR'; }
  if (meta.collections_count != null && colCount > meta.collections_count + 2) { msgs.push(`POSSIBLE OVER-EXTRACTION — COLLECTIONS (extracted ${colCount}, expected ${meta.collections_count})`); if (worst !== 'ERROR') worst = 'WARNING'; }
  if (meta.accounts_ever_late != null && negCount > meta.accounts_ever_late + 2) { msgs.push(`POSSIBLE OVER-EXTRACTION — NEGATIVE TRADELINES (extracted ${negCount}, expected ${meta.accounts_ever_late})`); if (worst !== 'ERROR') worst = 'WARNING'; }
  if (msgs.length === 0) msgs.push('All counts reconciled within tolerance.');
  return { status: worst, messages: msgs };
}

function postProcessResult(report: any): any {
  if (report.derogatory_accounts) {
    for (const acct of report.derogatory_accounts) {
      acct.derogatory_triggers = _classifyTl(acct);
    }
  }
  const validation = _validateCounts(report);
  report.validation_status = `${validation.status}: ${validation.messages.join('; ')}`;
  const allTradelines = [...(report.derogatory_accounts || []), ...(report.charge_offs || [])];
  report.duplicate_flags = _detectDups(allTradelines);
  report.tradeline_inventory = {
    total_blocks_detected: allTradelines.length + (report.collections?.length ?? 0),
    negative_extracted: allTradelines.length,
    collections_extracted: report.collections?.length ?? 0,
    public_records_extracted: report.public_records?.length ?? 0,
    inquiries_extracted: report.inquiries?.length ?? 0,
  };
  return report;
}

 * Deterministic Credit Bureau Report Parser — Two-Pass + Validation
 * Adapted for JSON output while preserving the strict extraction rules.
 */
const SYSTEM_PROMPT = `You are a credit report parsing engine, not a summarizer. Your job is to extract structured data from any credit bureau report (Experian, TransUnion, Equifax, Credit Karma, tri-merge) using strict deterministic rules.

## SYSTEM RULES (NON-NEGOTIABLE)
- Never guess, never infer, never merge accounts, never summarize.
- Only extract information explicitly present in the report.
- Every tradeline must be listed individually.
- Every value must be extracted exactly as printed.
- Extract all values exactly as printed — do not normalize, reformat, or interpret.
- Never generate dispute language.
- Never assume missing values — output "N/A" if a field is not present.
- Use whole-word boundary matching for all keyword detection.
- Treat each bureau's version of a tradeline as a separate entry in multi-bureau reports.
- Never discard extraction work on validation failure — always output all data with error flags.
- Do not attempt to reconcile masked account numbers across bureaus.

## PERSONAL INFORMATION MATCHING (GROUND TRUTH COMPARISON)
The questionnaire values provided are the ONLY "ground truth." The credit report is UNTRUSTED.

### NAMES (STRICT EXACT MATCH)
- The questionnaire full legal name is the ONLY recognized accurate name.
- ANY name on the report that does not match character-for-character = INACCURATE.
- Flag as inaccurate even if "close": missing/different middle name, missing/added suffix (Sr/Jr/II/III), nicknames, hyphenation differences, extra spaces/punctuation.
- Extract EVERY name variant exactly as shown.

### ADDRESSES (STRICT MATCH)
- Questionnaire current address is the ONLY accurate address.
- ANY other address = INACCURATE (dispute-safe default).
- Extract each address exactly as it appears.
- Flag if "Linked to derogatory items" (appears near derogatory accounts).

### EMPLOYERS (STRICT)
- Questionnaire employer is the ONLY accurate employer.
- Any other employer = INACCURATE.

### EXTRA IDENTIFIERS
Compare against questionnaire values if present:
- DOB mismatch → Inaccurate DOB
- Phone mismatch → Inaccurate Phone
- Email mismatch → Inaccurate Email
- SSN mask mismatch (last 4) → Inaccurate SSN Mask
If user didn't provide value, mark as "User did not provide comparison value".

## PASS 0 — REPORT METADATA
Extract report-level information if present:
- Bureau Name(s), Report Date, Report Type (single bureau / tri-merge / Credit Karma)
- Consumer Name
- Accounts Ever Late (X), Collections Count (Y), Public Records Count (Z)
These values are used later for validation checks.

## MULTI-BUREAU REPORT HANDLING
Some reports contain ALL THREE bureaus side-by-side in columns.
Detection signals: Headers showing "Experian | Equifax | TransUnion" or "EXP | EQF | TU", three-column layouts, "PrivacyGuard", "IdentityIQ", "SmartCredit", "MyScoreIQ" branding.
When detected:
1. Parse bureau context at the COLUMN level, not document level.
2. Each account row may show status in 3 columns (one per bureau).
3. An account can be DIFFERENT per bureau.
4. Extract status/balance/derogatory flags PER BUREAU for each account.
5. Include "bureaus" array on each item showing which bureaus report it.

## PASS 1 — TRADELINE INVENTORY
Detect every account in the report before applying filters.

### Block Detection Anchors (case-insensitive)
Primary: "Account info", "Account name", "Account number", "Account #", "Acct No", "Acct #", "Creditor", "Creditor Name", "Company Name", "Lender", "Loan Number", "Original Creditor", "Collection Agency"
Secondary: An uppercase/bold entity name followed within 3 lines by: balance, status, date opened, account number, payment status, account status.
Columnar: If a header row contains multiple field labels in a single line, switch to row-based extraction.

### Page Break / Continuation Handling
- If a block contains "Payment History" or payment grid data but NO creditor name → attach to preceding tradeline.
- If a block starts with a field (e.g., "Balance:", "Status:") but has no creditor name → attach to preceding tradeline.

### Fields to Extract Per Tradeline
Bureau, Account Name/Creditor Name, Account Number (exactly as printed with all masking), Account Type/Responsibility (Individual, Joint, Authorized User), Date Opened, Date Closed, Balance/Amount, Past Due Amount, Status Text, Payment History (grid codes if present), Remarks/Comments, Full Block Text.

### Account Number Rules
Extract exactly as printed, preserving all masking characters. If not present, output "N/A". Never skip a tradeline solely because it lacks an account number.

### Tri-Merge Handling
Extract each bureau's version as a separate entry. Tag with bureau name. Do NOT merge, deduplicate, or consolidate across bureaus.

## NEGATIVE INDICATOR DEFINITIONS
A tradeline is negative if any of the following appear in its block text.
All matching must use whole-word boundary matching — never substring matching.
For example, "late" must NOT match "later", "collateral", "related", or "translated".

### Status Keywords (whole words/phrases)
late, late payment, late payments, 30 days late, 60 days late, 90 days late, 120 days late, 150 days late, 30-day late, 60-day late, 90-day late, 120-day late, 150-day late, potentially negative, past due, past-due, derogatory, charge off, charged off, charged-off, chargeoff, written off, write off, write-off, collection, collections, repossession, foreclosure, settled, settled for less, bankruptcy, included in bankruptcy, profit and loss write-off

### Context-Sensitive Keywords
C/O — match ONLY in status/remark/account status fields. Do NOT match in address lines (where it means "care of").

### Past Due Amount Rule
Flag as negative ONLY if dollar value is > $0. "Past Due Amount: $0" is NOT negative.

### Payment History Grid Codes
Flag as negative if any cell value is NOT one of: OK, C, 0, 1 (current), blank, dash, N/A.
Negative codes: 2=30 days late, 3=60 days late, 4=90 days late, 5=120+ days late, X=unknown/derogatory, CO=charge off, D=derogatory.

### Section Header Signal
If a tradeline appears under "Potentially Negative Items", "Negative Accounts", "Adverse Accounts", "Collection Accounts", or "Derogatory" → include it as negative regardless.

### Date of First Delinquency Rule
If a tradeline contains "Date of First Delinquency" or "Date of 1st Delinquency" with any value → negative indicator.

## PASS 2 — NEGATIVE ITEM FILTER
Include the tradeline as negative if ANY of: negative keyword (whole-word), negative grid code, negative section header, Date of First Delinquency present, Past Due Amount > $0.
CLOSED ACCOUNT RULE: Closed accounts must still be included if they match any negative indicator.

## COLLECTION EXTRACTION
Extract: Collection Agency, Original Creditor, Account Number (exactly as printed), Date Opened, Date Reported/Assigned, Balance/Amount, Status. Each collection listed individually. Never group by creditor.

## PUBLIC RECORDS EXTRACTION
Extract: Type (Bankruptcy, Judgment, Tax Lien, Civil Judgment), Filed Date, Court/Source, Status, Amount, Date Resolved, Bureau.

## INQUIRY EXTRACTION
Hard Inquiries: Extract fully (primary output).
Soft/Promotional/Account Review: Extract separately.
If report doesn't distinguish, extract all and note "Inquiry type not classified in report."
Fields: Creditor/Source, Date, Type (Hard/Soft/Promotional/Account Review), Bureau.

## VALIDATION GATE (MANDATORY)
After extraction, reconcile counts with bureau summary metrics from Pass 0.

Under-extraction:
- extracted collections < bureau Collections Count → ERROR: EXTRACTION INCOMPLETE — COLLECTIONS MISMATCH
- extracted negative tradelines < bureau Accounts Ever Late → ERROR: EXTRACTION INCOMPLETE — NEGATIVE TRADELINE MISMATCH

Over-extraction (±2 tolerance):
- extracted collections > Collections Count + 2 → WARNING: POSSIBLE OVER-EXTRACTION
- extracted negative tradelines > Accounts Ever Late + 2 → WARNING: POSSIBLE OVER-EXTRACTION

If NO bureau summary counts found → VALIDATION SKIPPED.
On ERROR: Still output all data, prepend error message.

## DUPLICATE DETECTION
If two+ tradelines share same Account Name AND Account Number AND same bureau → flag "POSSIBLE DUPLICATE". Do NOT merge or remove.

## CONFIDENCE LEVELS
- "high" = clear derogatory marker
- "medium" = likely derogatory, some ambiguity
- "low" = possible derogatory, review recommended
- "incomplete" = block identified but fields unextractable (DO NOT OMIT)

## OUTPUT FORMAT (JSON)
{
  "validation_status": "PASS|ERROR|WARNING|VALIDATION SKIPPED",
  "validation_messages": ["detail messages"],
  "report_metadata": {
    "bureau_names": [],
    "report_date": "if found",
    "report_type": "single bureau|tri-merge|Credit Karma",
    "consumer_name": "if found",
    "accounts_ever_late": null,
    "collections_count": null,
    "public_records_count": null
  },
  "is_multi_bureau_report": true/false,
  "detected_bureaus": ["experian", "equifax", "transunion"],
  "inaccurate_names": [
    { "reported_name": "EXACT as shown", "mismatch_reason": "Why it doesn't match", "bureaus": ["experian"] }
  ],
  "inaccurate_addresses": [
    { "reported_address": "EXACT as shown", "linked_to_derogatory": true/false, "bureaus": ["transunion"] }
  ],
  "inaccurate_employers": [
    { "reported_employer": "EXACT as shown", "bureaus": ["experian"] }
  ],
  "extra_identifier_mismatches": [
    { "field": "DOB|Phone|Email|SSN Mask", "reported_value": "value", "status": "Mismatch description or 'User did not provide comparison value'", "bureaus": ["equifax"] }
  ],
  "derogatory_accounts": [
    {
      "creditor_name": "Name or 'UNEXTRACTABLE'",
      "account_number": "As shown (masked ok) or 'N/A'",
      "account_type": "Individual|Joint|Authorized User|N/A",
      "date_opened": "MM/YYYY or 'N/A'",
      "date_closed": "MM/YYYY or null",
      "balance": "$X,XXX or 'N/A'",
      "past_due_amount": "$X or null",
      "derogatory_triggers": ["30-day late", "charge-off"],
      "status_as_reported": "Status text or 'Incomplete – review required'",
      "payment_grid_codes": "If present, e.g. '2,2,3,OK,OK'",
      "remarks": "Any remarks/comments or null",
      "confidence": "high|medium|low|incomplete",
      "bureaus": ["experian", "equifax"],
      "bureau_status": {
        "experian": "Current",
        "equifax": "30-day late"
      },
      "date_first_delinquency": "if present or null",
      "section_header": "e.g. 'Potentially Negative Items' or null",
      "duplicate_flag": "POSSIBLE DUPLICATE or null"
    }
  ],
  "late_payment_summary": [
    {
      "severity": "30-day|60-day|90-day",
      "accounts": [
        { "creditor_name": "Name", "account_number": "XXX", "months_detected": "Jan 2023, Feb 2023 OR 'Months unclear; detected from grid'", "bureaus": ["equifax"] }
      ]
    }
  ],
  "collections": [
    {
      "collection_agency": "Name",
      "creditor_name": "Name",
      "original_creditor": "If shown or 'N/A'",
      "account_number": "As printed or 'N/A'",
      "date_opened": "MM/YYYY or 'N/A'",
      "date_reported": "If shown or null",
      "balance": "$X,XXX",
      "status": "Status text",
      "bureaus": ["experian", "transunion"]
    }
  ],
  "charge_offs": [
    { "creditor_name": "Name", "account_number": "XXX", "date_charged_off": "MM/YYYY", "balance": "$X,XXX", "bureaus": ["equifax"] }
  ],
  "public_records": [
    { "type": "Bankruptcy|Lien|Judgment|etc.", "court_jurisdiction": "Court name", "filing_date": "MM/DD/YYYY", "status": "Status", "amount": "$X,XXX or null", "date_resolved": "if applicable", "bureaus": ["experian", "equifax", "transunion"] }
  ],
  "inquiries": [
    { "creditor_name": "Name", "date": "MM/DD/YYYY", "type": "hard|soft|promotional|account_review|unknown", "bureaus": ["experian"] }
  ],
  "tradeline_inventory": {
    "total_blocks_detected": 0,
    "negative_tradelines_extracted": 0,
    "collections_extracted": 0,
    "public_records_extracted": 0,
    "hard_inquiries_extracted": 0,
    "soft_inquiries_extracted": 0,
    "duplicate_flags": 0,
    "bureau_summary_reconciled": "YES|NO|SKIPPED"
  },
  "summary": "Brief 2-3 sentence analysis of findings",
  "next_steps": ["Step 1", "Step 2"],
  "warnings": ["Any warnings including incomplete blocks"]
}

PRIVACY: Never output full SSN. Mask as XXX-XX-#### format.`;

// Input validation constants
const MAX_IMAGE_SIZE = 15000000; // ~10MB base64 per image
const MAX_IMAGES = 50;
const MAX_TEXT_LENGTH = 500000;
const VALID_BUREAUS = ["experian", "equifax", "transunion"] as const;
const MULTI_BUREAU_SENTINEL = "multi-bureau";

// Rate limiting
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitStore.get(userId);
  
  if (!userLimit || now > userLimit.resetTime) {
    rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required. Please log in to use this feature." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing Supabase configuration");
      return new Response(JSON.stringify({ error: "Service configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.log("Auth failed:", authError?.message || "No user found");
      return new Response(JSON.stringify({ error: "Invalid or expired session. Please log in again." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limiting
    if (!checkRateLimit(user.id)) {
      console.log(`Rate limit exceeded for user: ${user.id}`);
      return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment before trying again." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Authenticated request from user: ${user.id}`);

    const { questionnaire, responseText, responseImages, bureau, hasIdentityDocs } = await req.json();

    // Validate questionnaire
    if (!questionnaire || !questionnaire.fullLegalName || !questionnaire.currentAddress || !questionnaire.currentEmployer) {
      return new Response(JSON.stringify({ error: "Required questionnaire fields missing: full legal name, current address, and current employer are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate images
    if (responseImages) {
      if (!Array.isArray(responseImages)) {
        return new Response(JSON.stringify({ error: "Invalid images format" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (responseImages.length > MAX_IMAGES) {
        return new Response(JSON.stringify({ error: `Maximum ${MAX_IMAGES} images allowed` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      for (const img of responseImages) {
        if (typeof img !== 'string' || img.length > MAX_IMAGE_SIZE) {
          return new Response(JSON.stringify({ error: "Image size exceeds maximum allowed (10MB per image)" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!img.match(/^data:image\/(png|jpg|jpeg|gif|webp);base64,/)) {
          return new Response(JSON.stringify({ error: "Invalid image format. Please upload PNG, JPG, GIF, or WebP" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Validate text
    if (responseText) {
      if (typeof responseText !== 'string') {
        return new Response(JSON.stringify({ error: "Invalid text format" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (responseText.length > MAX_TEXT_LENGTH) {
        return new Response(JSON.stringify({ error: "Text exceeds maximum length (500,000 characters)" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (typeof bureau === "string" && bureau.trim()) {
      const normalizedBureau = bureau.trim().toLowerCase();
      if (normalizedBureau === "unknown") {
        return new Response(JSON.stringify({ error: "Invalid bureau. Bureau cannot be unknown." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (normalizedBureau !== MULTI_BUREAU_SENTINEL && !VALID_BUREAUS.includes(normalizedBureau as (typeof VALID_BUREAUS)[number])) {
        return new Response(
          JSON.stringify({ error: "Invalid bureau. Must be Experian, Equifax, TransUnion, or Multi-Bureau" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(JSON.stringify({ error: "Service configuration error. Please contact support." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build user content with questionnaire context
    const userContent: any[] = [];
    
    let contextMessage = `## QUESTIONNAIRE DATA (GROUND TRUTH - Use these as the ONLY accurate values)

**Full Legal Name:** ${questionnaire.fullLegalName}
**Current Address:** ${questionnaire.currentAddress}
**Current Employer:** ${questionnaire.currentEmployer}`;

    if (questionnaire.dateOfBirth) contextMessage += `\n**Date of Birth:** ${questionnaire.dateOfBirth}`;
    if (questionnaire.phoneNumber) contextMessage += `\n**Phone Number:** ${questionnaire.phoneNumber}`;
    if (questionnaire.email) contextMessage += `\n**Email:** ${questionnaire.email}`;
    if (questionnaire.ssnLast4) contextMessage += `\n**SSN Last 4:** ${questionnaire.ssnLast4}`;

    contextMessage += `\n\n## ADDITIONAL CONTEXT`;
    if (bureau) contextMessage += `\n**Bureau:** ${bureau}`;
    if (hasIdentityDocs) contextMessage += `\n**Identity Theft Documentation:** ${hasIdentityDocs}`;

    contextMessage += `\n\n## INSTRUCTIONS
Apply the Deterministic Two-Pass extraction method:
1. PASS 0: Extract report metadata (bureau names, summary counts).
2. PASS 1: Build complete tradeline inventory — detect every account block using structural anchors.
3. PASS 2: Filter for negative items using whole-word boundary matching of all negative indicators.
4. VALIDATION GATE: Reconcile extracted counts against bureau summary metrics.
5. DUPLICATE DETECTION: Flag potential duplicates without merging.

Compare ALL personal information against the questionnaire ground truth above.
Any deviation from the exact questionnaire values = INACCURATE.
Parse payment history grids/charts carefully for late payment codes.
Include all derogatory items with maximum inclusion (dispute-safe approach).`;
    
    if (responseImages && responseImages.length > 0) {
      userContent.push({
        type: "text",
        text: contextMessage + `\n\nThe credit report is in the attached ${responseImages.length} image(s). Analyze ALL pages carefully using the two-pass method.`
      });
      
      for (const img of responseImages) {
        userContent.push({
          type: "image_url",
          image_url: { url: img }
        });
      }
    } else if (responseText) {
      userContent.push({
        type: "text",
        text: contextMessage + `\n\n## CREDIT REPORT TEXT:\n"""\n${responseText}\n"""`
      });
    } else {
      return new Response(JSON.stringify({ error: "Please provide credit report images or text to analyze" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const model = "google/gemini-2.5-flash";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "An error occurred while analyzing the report. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("No content in AI response");
      return new Response(JSON.stringify({ error: "Unable to analyze the report. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response as JSON:", content.substring(0, 500));
      parsedResult = { 
        validation_status: "ERROR",
        validation_messages: ["Analysis could not be fully structured. Please try again with clearer images."],
        inaccurate_names: [],
        inaccurate_addresses: [],
        inaccurate_employers: [],
        extra_identifier_mismatches: [],
        derogatory_accounts: [],
        late_payment_summary: [],
        collections: [],
        charge_offs: [],
        public_records: [],
        inquiries: [],
        tradeline_inventory: { total_blocks_detected: 0, negative_tradelines_extracted: 0, collections_extracted: 0, public_records_extracted: 0, hard_inquiries_extracted: 0, soft_inquiries_extracted: 0, duplicate_flags: 0, bureau_summary_reconciled: "SKIPPED" },
        summary: "Analysis could not be fully structured. Please try again with clearer images.",
        next_steps: ["Re-upload clearer images of the credit report", "Try pasting the text directly if available"],
        warnings: ["The analysis encountered formatting issues. Results may be incomplete."]
      };
    }

    // Ensure all expected fields exist
    const result: any = {
      validation_status: parsedResult.validation_status || "SKIPPED",
      validation_messages: parsedResult.validation_messages || [],
      report_metadata: parsedResult.report_metadata || {},
      is_multi_bureau_report: parsedResult.is_multi_bureau_report || false,
      detected_bureaus: parsedResult.detected_bureaus || [],
      inaccurate_names: parsedResult.inaccurate_names || [],
      inaccurate_addresses: parsedResult.inaccurate_addresses || [],
      inaccurate_employers: parsedResult.inaccurate_employers || [],
      extra_identifier_mismatches: parsedResult.extra_identifier_mismatches || [],
      derogatory_accounts: parsedResult.derogatory_accounts || [],
      late_payment_summary: parsedResult.late_payment_summary || [],
      collections: parsedResult.collections || [],
      charge_offs: parsedResult.charge_offs || [],
      public_records: parsedResult.public_records || [],
      inquiries: parsedResult.inquiries || [],
      tradeline_inventory: parsedResult.tradeline_inventory || {},
      summary: parsedResult.summary || "",
      next_steps: parsedResult.next_steps || [],
      warnings: parsedResult.warnings || []
    };

    // ── Deterministic post-processing ──
    const postProcessed = postProcessResult(result);

    return new Response(JSON.stringify(postProcessed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analyze-response function:", error);
    return new Response(JSON.stringify({ 
      error: "An error occurred while processing your request. Please try again." 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
