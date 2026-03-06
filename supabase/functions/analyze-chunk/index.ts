import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Deterministic chunk extraction prompt — adapted from the Two-Pass parser for
 * processing a subset of pages at a time via vision.
 */
const CHUNK_SYSTEM_PROMPT = `You are a credit report parsing engine processing a CHUNK of pages from a larger report. Extract ALL data visible on these pages using strict deterministic rules.

## CORE RULES
- Never guess, never infer, never merge accounts, never summarize.
- Only extract information explicitly present on these pages.
- Every tradeline must be listed individually.
- Every value must be extracted exactly as printed.
- Use whole-word boundary matching for all keyword detection.
- Treat each bureau's version of a tradeline as a separate entry.
- If a field cannot be read, output "UNEXTRACTABLE" — do NOT omit the account.
- Extract account numbers exactly as printed, preserving all masking characters (X, *, .).

## NEGATIVE INDICATOR DETECTION (whole-word boundary matching only)
Include an account as negative if ANY of these appear:
- Status keywords: late, late payment, 30 days late, 60 days late, 90 days late, 120 days late, 150 days late, potentially negative, past due, past-due, derogatory, charge off, charged off, charged-off, chargeoff, written off, write off, write-off, collection, collections, repossession, foreclosure, settled, settled for less, bankruptcy, included in bankruptcy, profit and loss write-off
- C/O — ONLY in status/remark fields, NOT in address lines (where it means "care of")
- Past Due Amount > $0 (ignore if $0)
- Payment grid codes: 2=30 late, 3=60 late, 4=90 late, 5=120+ late, X=derogatory, CO=charge off, D=derogatory
- Section headers: "Potentially Negative Items", "Negative Accounts", "Adverse Accounts", "Collection Accounts", "Derogatory"
- Date of First Delinquency field present with any value
- CLOSED accounts are still included if they match any negative indicator

## PAGE BREAK HANDLING
- If a block has payment data but no creditor name → it continues from a previous page (extract what you can, note "continuation from prior page")
- If a block starts with a field label but no creditor → continuation (extract and note)

## MULTI-BUREAU HANDLING
If pages show side-by-side columns for Experian/Equifax/TransUnion:
- Extract status PER BUREAU for each account
- Include "bureaus" array and "bureau_status" object

## OUTPUT FORMAT (JSON)
{
  "derogatory_accounts": [{
    "creditor_name": "...",
    "account_number": "XXXX... or N/A",
    "account_type": "Individual|Joint|Authorized User|N/A",
    "date_opened": "MM/YYYY or N/A",
    "date_closed": "MM/YYYY or null",
    "balance": "$X,XXX or N/A",
    "past_due_amount": "$X or null",
    "derogatory_triggers": ["30-day late", "charge-off"],
    "status_as_reported": "...",
    "payment_grid_codes": "codes if present or null",
    "remarks": "any remarks or null",
    "confidence": "high|medium|low|incomplete",
    "bureaus": ["experian", "equifax"],
    "bureau_status": { "experian": "Current", "equifax": "30-day late" },
    "date_first_delinquency": "if present or null",
    "section_header": "section name or null",
    "is_continuation": false
  }],
  "collections": [{
    "collection_agency": "...",
    "creditor_name": "...",
    "original_creditor": "... or N/A",
    "account_number": "... or N/A",
    "date_opened": "MM/YYYY or N/A",
    "date_reported": "or null",
    "balance": "$X,XXX",
    "status": "...",
    "bureaus": ["experian"]
  }],
  "charge_offs": [{
    "creditor_name": "...",
    "account_number": "...",
    "date_charged_off": "MM/YYYY",
    "balance": "$X,XXX",
    "bureaus": ["equifax"]
  }],
  "inquiries": [{
    "creditor_name": "...",
    "date": "MM/DD/YYYY",
    "type": "hard|soft|unknown",
    "bureaus": ["experian"]
  }],
  "public_records": [{
    "type": "Bankruptcy|Lien|Judgment|Child Support",
    "court_jurisdiction": "...",
    "filing_date": "MM/DD/YYYY",
    "status": "...",
    "amount": "$X,XXX or null",
    "bureaus": ["experian", "equifax", "transunion"]
  }],
  "inaccurate_names": [{ "reported_name": "...", "mismatch_reason": "...", "bureaus": ["experian"] }],
  "inaccurate_addresses": [{ "reported_address": "...", "linked_to_derogatory": false, "bureaus": ["equifax"] }],
  "inaccurate_employers": [{ "reported_employer": "...", "bureaus": ["transunion"] }],
  "extra_identifier_mismatches": [{ "field": "DOB", "reported_value": "...", "status": "Mismatch", "bureaus": ["experian"] }],
  "late_payment_summary": [{
    "severity": "30-day|60-day|90-day",
    "accounts": [{
      "creditor_name": "...",
      "account_number": "...",
      "months_detected": "Jan 2023, Feb 2023 OR 'Months unclear; detected from grid'",
      "bureaus": ["equifax"]
    }]
  }]
}`;

const MAX_IMAGES_PER_CHUNK = 3;

// ── Inline post-processing (Deno edge functions cannot import src/lib) ──

const NEGATIVE_KEYWORDS = [
  'late','late payment','late payments','30 days late','60 days late','90 days late',
  '120 days late','150 days late','30-day late','60-day late','90-day late',
  '120-day late','150-day late','potentially negative','past due','past-due',
  'derogatory','charge off','charged off','charged-off','chargeoff','written off',
  'write off','write-off','collection','collections','repossession','foreclosure',
  'settled','settled for less','bankruptcy','included in bankruptcy','profit and loss write-off',
];
const NEGATIVE_SECTIONS = ['potentially negative items','negative accounts','adverse accounts','collection accounts','derogatory'];
const NEGATIVE_GRID = ['2','3','4','5','X','CO','D'];

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
  return codes.split(/[\s,;|]+/).filter(c => NEGATIVE_GRID.includes(c.toUpperCase()));
}

function _classifyTradeline(t: any): string[] {
  const triggers: string[] = [];
  const blockText = [t.status_as_reported, t.remarks, t.block_text].filter(Boolean).join(' ');
  for (const kw of NEGATIVE_KEYWORDS) { if (_wwm(blockText, kw)) triggers.push(kw); }
  if (_isPastDueNeg(t.past_due_amount)) triggers.push(`past due > $0 (${t.past_due_amount})`);
  const gc = _negGridCodes(t.payment_grid_codes);
  if (gc.length) triggers.push(`grid codes: ${gc.join(', ')}`);
  if (t.section_header && NEGATIVE_SECTIONS.includes(t.section_header.toLowerCase())) triggers.push(`section: ${t.section_header}`);
  if (t.date_first_delinquency) triggers.push(`date of first delinquency: ${t.date_first_delinquency}`);
  return triggers;
}

function _detectDuplicates(tradelines: any[]): any[] {
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
  let worst: string = 'PASS';
  const negCount = (report.derogatory_accounts?.length ?? 0) + (report.charge_offs?.length ?? 0);
  const colCount = report.collections?.length ?? 0;
  if (meta.collections_count != null && colCount < meta.collections_count) { msgs.push(`EXTRACTION INCOMPLETE — COLLECTIONS MISMATCH (extracted ${colCount}, expected ${meta.collections_count})`); worst = 'ERROR'; }
  if (meta.accounts_ever_late != null && negCount < meta.accounts_ever_late) { msgs.push(`EXTRACTION INCOMPLETE — NEGATIVE TRADELINE MISMATCH (extracted ${negCount}, expected ${meta.accounts_ever_late})`); worst = 'ERROR'; }
  if (meta.collections_count != null && colCount > meta.collections_count + 2) { msgs.push(`POSSIBLE OVER-EXTRACTION — COLLECTIONS (extracted ${colCount}, expected ${meta.collections_count})`); if (worst !== 'ERROR') worst = 'WARNING'; }
  if (meta.accounts_ever_late != null && negCount > meta.accounts_ever_late + 2) { msgs.push(`POSSIBLE OVER-EXTRACTION — NEGATIVE TRADELINES (extracted ${negCount}, expected ${meta.accounts_ever_late})`); if (worst !== 'ERROR') worst = 'WARNING'; }
  if (msgs.length === 0) msgs.push('All counts reconciled within tolerance.');
  return { status: worst, messages: msgs };
}

function postProcessChunkResult(report: any): any {
  // 1. Re-classify derogatory triggers
  if (report.derogatory_accounts) {
    for (const acct of report.derogatory_accounts) {
      acct.derogatory_triggers = _classifyTradeline(acct);
    }
  }
  // 2. Validate counts
  const validation = _validateCounts(report);
  report.validation_status = `${validation.status}: ${validation.messages.join('; ')}`;
  // 3. Duplicate detection
  const allTradelines = [...(report.derogatory_accounts || []), ...(report.charge_offs || [])];
  report.duplicate_flags = _detectDuplicates(allTradelines);
  // 4. Inventory
  report.tradeline_inventory = {
    total_blocks_detected: allTradelines.length + (report.collections?.length ?? 0),
    negative_extracted: allTradelines.length,
    collections_extracted: report.collections?.length ?? 0,
    public_records_extracted: report.public_records?.length ?? 0,
    inquiries_extracted: report.inquiries?.length ?? 0,
  };
  return report;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!supabaseUrl || !supabaseAnonKey) {
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
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { section, images, questionnaire, chunkIndex, totalChunks, reportText } = await req.json();

    // Validate: need either images or text
    const hasImages = images && Array.isArray(images) && images.length > 0;
    const hasText = reportText && typeof reportText === "string" && reportText.trim().length > 0;

    if (!hasImages && !hasText) {
      return new Response(JSON.stringify({ error: "No images or text provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (hasImages && images.length > MAX_IMAGES_PER_CHUNK) {
      return new Response(JSON.stringify({ error: `Max ${MAX_IMAGES_PER_CHUNK} images per chunk` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Analyzing chunk: section=${section || 'full'}, chunk=${(chunkIndex || 0) + 1}/${totalChunks || 1}, images=${hasImages ? images.length : 0}, text=${hasText ? 'yes' : 'no'}`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Service configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build user content
    const userContent: any[] = [];
    
    let contextMessage = `Analyzing chunk ${(chunkIndex || 0) + 1} of ${totalChunks || 1}.`;
    
    // Add questionnaire context for personal info comparison
    if (questionnaire) {
      contextMessage += `\n\n## QUESTIONNAIRE DATA (GROUND TRUTH)
Full Legal Name: ${questionnaire.fullLegalName}
Current Address: ${questionnaire.currentAddress}
Current Employer: ${questionnaire.currentEmployer}`;
      if (questionnaire.dateOfBirth) contextMessage += `\nDate of Birth: ${questionnaire.dateOfBirth}`;
      if (questionnaire.phoneNumber) contextMessage += `\nPhone: ${questionnaire.phoneNumber}`;
      if (questionnaire.email) contextMessage += `\nEmail: ${questionnaire.email}`;
      if (questionnaire.ssnLast4) contextMessage += `\nSSN Last 4: ${questionnaire.ssnLast4}`;
    }

    if (hasText) {
      // Text-based analysis
      userContent.push({
        type: "text",
        text: contextMessage + `\n\nExtract ALL data from the following credit report text using deterministic two-pass extraction.\n\n## CREDIT REPORT TEXT:\n"""\n${reportText}\n"""`
      });
    } else {
      // Vision-based analysis
      userContent.push({
        type: "text",
        text: contextMessage + `\n\nExtract ALL data from the ${images.length} attached page(s) using deterministic extraction. Parse payment history grids/charts carefully for late payment codes.`
      });
      
      for (const img of images) {
        userContent.push({
          type: "image_url",
          image_url: { url: img }
        });
      }
    }

    const model = hasText ? "google/gemini-2.5-flash" : "google/gemini-2.5-flash";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: CHUNK_SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error(`Chunk analysis error:`, response.status, errorText);
      return new Response(JSON.stringify({ error: `Failed to analyze chunk` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return new Response(JSON.stringify({ error: "No analysis result" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      console.error(`Failed to parse chunk result:`, content.substring(0, 200));
      result = {};
    }

    // ── Deterministic post-processing (mirrors parser-rules.ts) ──
    result = postProcessChunkResult(result);

    // Add metadata
    result._section = section || "full";
    result._chunkIndex = chunkIndex || 0;
    result._totalChunks = totalChunks || 1;

    console.log(`Chunk complete: ${(chunkIndex || 0) + 1}/${totalChunks || 1}, accounts=${result.derogatory_accounts?.length || 0}, validation=${result.validation_status || 'N/A'}, duplicates=${result.duplicate_flags?.length || 0}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analyze-chunk function:", error);
    return new Response(JSON.stringify({ error: "Chunk analysis failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
