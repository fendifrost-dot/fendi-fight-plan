import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Section-specific prompts for targeted extraction
const SECTION_PROMPTS: Record<string, string> = {
  personal_info: `Extract ONLY personal information from these credit report pages.

Compare against the provided questionnaire (GROUND TRUTH):
- Full name: Any variation = INACCURATE
- Address: Only questionnaire address is accurate, all others = INACCURATE
- Employer: Only questionnaire employer is accurate

OUTPUT JSON:
{
  "inaccurate_names": [{ "reported_name": "...", "mismatch_reason": "...", "bureaus": ["experian"] }],
  "inaccurate_addresses": [{ "reported_address": "...", "linked_to_derogatory": false, "bureaus": ["equifax"] }],
  "inaccurate_employers": [{ "reported_employer": "...", "bureaus": ["transunion"] }],
  "extra_identifier_mismatches": [{ "field": "DOB", "reported_value": "...", "status": "Mismatch", "bureaus": ["experian"] }]
}`,

  accounts: `Extract ALL account information from these credit report pages.

CRITICAL RULES:
1. Extract EVERY account block you can identify
2. Include account name, masked number, date opened
3. Mark as "UNEXTRACTABLE" if field cannot be read
4. Include ALL derogatory triggers: late payments, collections, charge-offs
5. For multi-bureau layouts, capture per-bureau status

OUTPUT JSON:
{
  "derogatory_accounts": [{
    "creditor_name": "...",
    "account_number": "XXXX...",
    "date_opened": "MM/YYYY or UNEXTRACTABLE",
    "derogatory_triggers": ["30-day late", "charge-off"],
    "status_as_reported": "...",
    "confidence": "high|medium|low|incomplete",
    "bureaus": ["experian", "equifax"],
    "bureau_status": { "experian": "Current", "equifax": "30-day late" }
  }],
  "collections": [{
    "creditor_name": "...",
    "account_number": "...",
    "original_creditor": "...",
    "balance": "$X,XXX",
    "bureaus": ["transunion"]
  }],
  "charge_offs": [{
    "creditor_name": "...",
    "account_number": "...",
    "date_charged_off": "MM/YYYY",
    "balance": "$X,XXX",
    "bureaus": ["experian"]
  }]
}`,

  inquiries: `Extract ALL credit inquiries from these pages.

OUTPUT JSON:
{
  "inquiries": [{
    "creditor_name": "...",
    "date": "MM/DD/YYYY",
    "type": "hard|soft|unknown",
    "bureaus": ["experian"]
  }]
}`,

  payment_history: `Extract late payment information from payment history grids/charts.

Look for:
- Payment history charts with month columns
- Delinquency codes (1=30 days, 2=60 days, 3=90 days)
- Symbols indicating late payments
- Legends explaining payment status codes

OUTPUT JSON:
{
  "late_payment_summary": [{
    "severity": "30-day|60-day|90-day",
    "accounts": [{
      "creditor_name": "...",
      "account_number": "...",
      "months_detected": "Jan 2023, Feb 2023 OR 'Months unclear; detected from grid'",
      "bureaus": ["equifax"]
    }]
  }]
}`,

  public_records: `Extract ALL public records from these pages.

OUTPUT JSON:
{
  "public_records": [{
    "type": "Bankruptcy|Lien|Judgment|Child Support",
    "court_jurisdiction": "...",
    "filing_date": "MM/DD/YYYY",
    "status": "...",
    "bureaus": ["experian", "equifax", "transunion"]
  }]
}`
};

const MAX_IMAGES_PER_CHUNK = 3; // Process max 3 pages per request

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

    const { section, images, questionnaire, chunkIndex, totalChunks } = await req.json();

    if (!section || !SECTION_PROMPTS[section]) {
      return new Response(JSON.stringify({ error: `Invalid section: ${section}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: "No images provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (images.length > MAX_IMAGES_PER_CHUNK) {
      return new Response(JSON.stringify({ error: `Max ${MAX_IMAGES_PER_CHUNK} images per chunk` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Analyzing chunk: section=${section}, chunk=${chunkIndex + 1}/${totalChunks}, images=${images.length}`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Service configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build user content
    const userContent: any[] = [];
    
    let contextMessage = `Analyzing ${section.replace('_', ' ')} section (chunk ${chunkIndex + 1} of ${totalChunks}).`;
    
    // Add questionnaire context for personal_info section
    if (section === 'personal_info' && questionnaire) {
      contextMessage += `\n\n## QUESTIONNAIRE DATA (GROUND TRUTH)
Full Legal Name: ${questionnaire.fullLegalName}
Current Address: ${questionnaire.currentAddress}
Current Employer: ${questionnaire.currentEmployer}`;
      if (questionnaire.dateOfBirth) contextMessage += `\nDate of Birth: ${questionnaire.dateOfBirth}`;
      if (questionnaire.phoneNumber) contextMessage += `\nPhone: ${questionnaire.phoneNumber}`;
      if (questionnaire.email) contextMessage += `\nEmail: ${questionnaire.email}`;
      if (questionnaire.ssnLast4) contextMessage += `\nSSN Last 4: ${questionnaire.ssnLast4}`;
    }

    userContent.push({
      type: "text",
      text: contextMessage + `\n\nExtract data from the ${images.length} attached page(s).`
    });
    
    for (const img of images) {
      userContent.push({
        type: "image_url",
        image_url: { url: img }
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: SECTION_PROMPTS[section] },
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
      console.error(`Chunk analysis error (${section}):`, response.status, errorText);
      return new Response(JSON.stringify({ error: `Failed to analyze ${section}` }), {
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
      console.error(`Failed to parse ${section} result:`, content.substring(0, 200));
      result = {};
    }

    // Add metadata
    result._section = section;
    result._chunkIndex = chunkIndex;
    result._totalChunks = totalChunks;

    console.log(`Chunk complete: ${section} ${chunkIndex + 1}/${totalChunks}`);

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
