import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Imports from shared contract (single source of truth) ──
import { FULL_SYSTEM_PROMPT } from "../_shared/credit-parser-prompt.ts";
import { postProcessAndValidate } from "../_shared/parser-validator.ts";
import { PARSER_ERROR_CODES } from "../_shared/parser-contract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_IMAGE_SIZE = 15000000;
const MAX_IMAGES = 50;
const MAX_TEXT_LENGTH = 500000;
const VALID_BUREAUS = ["experian", "equifax", "transunion"] as const;
const MULTI_BUREAU_SENTINEL = "multi-bureau";

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
  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  userLimit.count++;
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required. Please log in to use this feature." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing Supabase configuration");
      return new Response(JSON.stringify({ error: "Service configuration error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.log("Auth failed:", authError?.message || "No user found");
      return new Response(JSON.stringify({ error: "Invalid or expired session. Please log in again." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment before trying again." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Authenticated request from user: ${user.id}`);

    const { questionnaire, responseText, responseImages, bureau, hasIdentityDocs } = await req.json();

    if (!questionnaire || !questionnaire.fullLegalName || !questionnaire.currentAddress || !questionnaire.currentEmployer) {
      return new Response(JSON.stringify({ error: "Required questionnaire fields missing: full legal name, current address, and current employer are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (responseImages) {
      if (!Array.isArray(responseImages)) {
        return new Response(JSON.stringify({ error: "Invalid images format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (responseImages.length > MAX_IMAGES) {
        return new Response(JSON.stringify({ error: `Maximum ${MAX_IMAGES} images allowed` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      for (const img of responseImages) {
        if (typeof img !== 'string' || img.length > MAX_IMAGE_SIZE) {
          return new Response(JSON.stringify({ error: "Image size exceeds maximum allowed (10MB per image)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (!img.match(/^data:image\/(png|jpg|jpeg|gif|webp);base64,/)) {
          return new Response(JSON.stringify({ error: "Invalid image format. Please upload PNG, JPG, GIF, or WebP" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    if (responseText) {
      if (typeof responseText !== 'string') {
        return new Response(JSON.stringify({ error: "Invalid text format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (responseText.length > MAX_TEXT_LENGTH) {
        return new Response(JSON.stringify({ error: "Text exceeds maximum length (500,000 characters)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (typeof bureau === "string" && bureau.trim()) {
      const normalizedBureau = bureau.trim().toLowerCase();
      if (normalizedBureau === "unknown") {
        return new Response(JSON.stringify({ error: "Invalid bureau. Bureau cannot be unknown." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (normalizedBureau !== MULTI_BUREAU_SENTINEL && !VALID_BUREAUS.includes(normalizedBureau as (typeof VALID_BUREAUS)[number])) {
        return new Response(JSON.stringify({ error: "Invalid bureau. Must be Experian, Equifax, TransUnion, or Multi-Bureau" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Service configuration error. Please contact support." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        userContent.push({ type: "image_url", image_url: { url: img } });
      }
    } else if (responseText) {
      userContent.push({
        type: "text",
        text: contextMessage + `\n\n## CREDIT REPORT TEXT:\n"""\n${responseText}\n"""`
      });
    } else {
      return new Response(JSON.stringify({ error: "Please provide credit report images or text to analyze" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const model = "google/gemini-3-flash-preview";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: FULL_SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits to continue." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "An error occurred while analyzing the report. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("No content in AI response");
      return new Response(JSON.stringify({ error: "Unable to analyze the report. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        derogatory_accounts: [],
        collections: [],
        charge_offs: [],
        public_records: [],
        inquiries: [],
        warnings: ["The analysis encountered formatting issues. Results may be incomplete."]
      };
    }

    // ── Deterministic post-processing via shared validator ──
    // Pass responseText for Pass 1 block detection if available
    const postProcessed = postProcessAndValidate(parsedResult, responseText || undefined);

    // ── Enforcement: check for EXTRACTION_INCOMPLETE ──
    if (postProcessed.isError) {
      console.error(`[analyze-response] ${PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE}: ${postProcessed.errorMessage}`);
      postProcessed.report._extraction_error = PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE;
      postProcessed.report._extraction_error_message = postProcessed.errorMessage;
    }

    if (postProcessed.schema.violations.length > 0) {
      console.warn(`[analyze-response] Schema violations: ${postProcessed.schema.violations.length}`, 
        postProcessed.schema.violations.slice(0, 5).map(v => `${v.entity}[${v.index}].${v.field}: ${v.reason}`));
    }

    // Build output — summary/next_steps are NOT part of the contract.
    // They are passed through as downstream convenience fields only.
    const result: any = {
      validation_status: postProcessed.report.validation_status || "SKIPPED",
      validation_messages: postProcessed.validation.messages || [],
      report_metadata: parsedResult.report_metadata || {},
      is_multi_bureau_report: parsedResult.is_multi_bureau_report || false,
      detected_bureaus: parsedResult.detected_bureaus || [],
      inaccurate_names: postProcessed.report.inaccurate_names,
      inaccurate_addresses: postProcessed.report.inaccurate_addresses,
      inaccurate_employers: postProcessed.report.inaccurate_employers,
      extra_identifier_mismatches: postProcessed.report.extra_identifier_mismatches,
      derogatory_accounts: postProcessed.report.derogatory_accounts,
      late_payment_summary: postProcessed.report.late_payment_summary,
      collections: postProcessed.report.collections,
      charge_offs: postProcessed.report.charge_offs,
      public_records: postProcessed.report.public_records,
      inquiries: postProcessed.report.inquiries,
      tradeline_inventory: postProcessed.report.tradeline_inventory,
      duplicate_flags: postProcessed.duplicateFlags,
      // Non-contract downstream fields (stripped from contract by validator)
      _downstream_summary: parsedResult.summary || null,
      _downstream_next_steps: parsedResult.next_steps || null,
      warnings: parsedResult.warnings || [],
      _schema_violations: postProcessed.schema.violations.length,
      _schema_rejected: postProcessed.schema.rejectedAccounts.length,
      _extraction_error: postProcessed.report._extraction_error || null,
      _extraction_error_message: postProcessed.report._extraction_error_message || null,
      _validation_fatal: postProcessed.validation.fatal,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analyze-response function:", error);
    return new Response(JSON.stringify({ 
      error: "An error occurred while processing your request. Please try again." 
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
