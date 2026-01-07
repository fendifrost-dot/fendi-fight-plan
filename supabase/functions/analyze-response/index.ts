import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a dispute-grade credit report extraction engine. Your job is to analyze credit reports and extract ALL disputable items with maximum inclusion.

CRITICAL: The questionnaire values provided are the ONLY "ground truth." The credit report is treated as UNTRUSTED.

## STRICT MATCHING RULES

### 1. NAMES (STRICT EXACT MATCH)
- The questionnaire full legal name is the ONLY recognized accurate name
- ANY name on the report that does not match character-for-character = INACCURATE
- Flag as inaccurate even if "close":
  - Missing/different middle name or initial
  - Missing/added suffix (Sr/Jr/II/III)
  - Nicknames/abbreviations (Mike vs Michael)
  - Hyphenation differences
  - Extra spaces/punctuation
- Extract EVERY name variant exactly as shown

### 2. ADDRESSES (STRICT MATCH)
- Questionnaire current address is the ONLY accurate address
- ANY other address = INACCURATE (dispute-safe default)
- Extract each address exactly as it appears
- Flag if "Linked to derogatory items" (appears near derogatory accounts)

### 3. EMPLOYERS (STRICT)
- Questionnaire employer is the ONLY accurate employer
- Any other employer = INACCURATE

### 4. EXTRA IDENTIFIERS
Compare these against questionnaire values if present:
- DOB mismatch → Inaccurate DOB
- Phone mismatch → Inaccurate Phone
- Email mismatch → Inaccurate Email
- SSN mask mismatch (last 4) → Inaccurate SSN Mask
If user didn't provide value, mark as "User did not provide comparison value"

## LATE PAYMENT DETECTION (CRITICAL)

You MUST parse payment history charts/grids, not just text.

Look for:
- Payment history chart/grid
- Month-by-month payment rows
- Delinquency grids with symbols/codes
- Legends explaining codes (1=30 days, 2=60 days, etc.)

Detect and categorize:
- 30-day late
- 60-day late  
- 90-day late

Support detection via:
- Direct text: "30 days late", "60 days late", "90 days late"
- Numeric codes: 30, 60, 90
- Tier codes: 1/2/3 when legend indicates meaning
- Symbols/colors when legend explains them

Output for each late:
- Creditor name
- Account number (masked if shown that way)
- Date opened
- Late severity (30/60/90)
- Month(s)/year(s) of late(s) if readable
- If months unclear: "Months unclear; late severity detected from payment history grid/legend"

## DEROGATORY ACCOUNT RULES

NO distinction between open/closed - if derogatory, INCLUDE IT.

Include account if ANY of these are present:
- Any 30/60/90 late history
- Collection status OR "sold/placed for collection"
- Charge-off / charged off
- Past due balance
- Repossession
- Foreclosure
- "Derogatory" label
- Adverse remarks indicating delinquency
- "Account in dispute" label (flag, don't exclude)
- Public record linkage (bankruptcy, lien, judgment, child support)

## PUBLIC RECORDS EXTRACTION

Extract and list:
- Bankruptcy (type, court, filing date, status)
- Liens (type, jurisdiction, filing date, status)
- Judgments (court, date, amount, status)
- Child support/arrears (if shown)

## INQUIRY EXTRACTION

List all inquiries with:
- Creditor name
- Date of inquiry
- Type (hard/soft) if identifiable

## INCLUSION BIAS RULE (Dispute-Safe)

When uncertain but evidence suggests derogatory, INCLUDE and label confidence:
- "high" = clear derogatory marker
- "medium" = likely derogatory, some ambiguity
- "low" = possible derogatory, review recommended

## OUTPUT FORMAT (JSON)

{
  "inaccurate_names": [
    { "reported_name": "EXACT as shown", "mismatch_reason": "Why it doesn't match" }
  ],
  "inaccurate_addresses": [
    { "reported_address": "EXACT as shown", "linked_to_derogatory": true/false }
  ],
  "inaccurate_employers": [
    { "reported_employer": "EXACT as shown" }
  ],
  "extra_identifier_mismatches": [
    { "field": "DOB/Phone/Email/SSN Mask", "reported_value": "value", "status": "Mismatch description or 'User did not provide comparison value'" }
  ],
  "derogatory_accounts": [
    {
      "creditor_name": "Name",
      "account_number": "As shown (masked ok)",
      "date_opened": "MM/YYYY or as shown",
      "derogatory_triggers": ["30-day late", "charge-off", etc.],
      "status_as_reported": "Open/Closed/etc.",
      "confidence": "high/medium/low"
    }
  ],
  "late_payment_summary": [
    {
      "severity": "30-day",
      "accounts": [
        { "creditor_name": "Name", "account_number": "XXX", "months_detected": "Jan 2023, Feb 2023 OR 'Months unclear; detected from grid'" }
      ]
    }
  ],
  "collections": [
    { "creditor_name": "Name", "account_number": "XXX", "original_creditor": "If shown", "balance": "$X,XXX" }
  ],
  "charge_offs": [
    { "creditor_name": "Name", "account_number": "XXX", "date_charged_off": "MM/YYYY", "balance": "$X,XXX" }
  ],
  "public_records": [
    { "type": "Bankruptcy/Lien/Judgment/etc.", "court_jurisdiction": "Court name", "filing_date": "MM/DD/YYYY", "status": "Status" }
  ],
  "inquiries": [
    { "creditor_name": "Name", "date": "MM/DD/YYYY", "type": "hard/soft/unknown" }
  ],
  "summary": "Brief 2-3 sentence analysis of findings",
  "next_steps": ["Step 1", "Step 2", "Step 3"],
  "warnings": ["Any critical warnings"]
}

PRIVACY: Never output full SSN. Mask as XXX-XX-#### format.`;

// Input validation constants
const MAX_IMAGE_SIZE = 15000000; // ~10MB base64 per image
const MAX_IMAGES = 10;
const MAX_TEXT_LENGTH = 100000; // 100k chars for full reports
const VALID_BUREAUS = ['experian', 'equifax', 'transunion'];

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
        return new Response(JSON.stringify({ error: "Text exceeds maximum length (100,000 characters)" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (bureau && !VALID_BUREAUS.includes(bureau.toLowerCase())) {
      return new Response(JSON.stringify({ error: "Invalid bureau. Must be Experian, Equifax, or TransUnion" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
Analyze the attached credit report using the strict matching rules. Extract ALL disputable items.
Compare EVERYTHING against the questionnaire ground truth above.
Any deviation from the exact questionnaire values = INACCURATE.
Include all derogatory items with maximum inclusion (dispute-safe approach).
Parse payment history grids/charts carefully for late payments.`;
    
    if (responseImages && responseImages.length > 0) {
      userContent.push({
        type: "text",
        text: contextMessage + `\n\nThe credit report is in the attached ${responseImages.length} image(s). Analyze ALL pages carefully.`
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

    // Use gemini-2.5-pro for complex multi-image analysis
    const model = responseImages && responseImages.length > 1 ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";

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
      // Return a structured fallback
      parsedResult = { 
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
        summary: "Analysis could not be fully structured. Please try again with clearer images.",
        next_steps: ["Re-upload clearer images of the credit report", "Try pasting the text directly if available"],
        warnings: ["The analysis encountered formatting issues. Results may be incomplete."]
      };
    }

    // Ensure all expected fields exist
    const result = {
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
      summary: parsedResult.summary || "",
      next_steps: parsedResult.next_steps || [],
      warnings: parsedResult.warnings || []
    };

    return new Response(JSON.stringify(result), {
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
