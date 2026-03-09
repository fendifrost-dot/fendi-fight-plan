import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Imports from shared contract (single source of truth) ──
import { CHUNK_SYSTEM_PROMPT } from "../_shared/credit-parser-prompt.ts";
import { postProcessChunkResult } from "../_shared/parser-validator.ts";
import { PARSER_ERROR_CODES } from "../_shared/parser-contract.ts";
import { validateSchema, ensureRequiredArrays } from "../_shared/parser-schema.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_IMAGES_PER_CHUNK = 3;

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
      userContent.push({
        type: "text",
        text: contextMessage + `\n\nExtract ALL data from the following credit report text using deterministic two-pass extraction.\n\n## CREDIT REPORT TEXT:\n"""\n${reportText}\n"""`
      });
    } else {
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
          { role: "system", content: CHUNK_SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error(`Chunk analysis error:`, response.status, errorText);
      return new Response(JSON.stringify({ error: `Failed to analyze chunk` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return new Response(JSON.stringify({ error: "No analysis result" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      console.error(`Failed to parse chunk result:`, content.substring(0, 200));
      result = {};
    }

    // ── Step 1: Schema validation ──
    const schemaResult = validateSchema(ensureRequiredArrays(result));
    if (schemaResult.rejectedAccounts.length > 0) {
      console.warn(`[analyze-chunk] ${schemaResult.rejectedAccounts.length} accounts rejected by schema validation`);
    }

    // ── Step 2: Deterministic post-processing (from shared validator) ──
    result = postProcessChunkResult(result);

    // ── Step 3: Check for EXTRACTION_INCOMPLETE ──
    if (result.validation_status && result.validation_status.startsWith('ERROR')) {
      console.error(`[analyze-chunk] ${PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE}: ${result.validation_status}`);
      // Still return data — never discard extraction work — but flag the error
      result._extraction_error = PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE;
    }

    // Add metadata
    result._section = section || "full";
    result._chunkIndex = chunkIndex || 0;
    result._totalChunks = totalChunks || 1;
    result._schema_violations = schemaResult.violations.length;
    result._schema_rejected = schemaResult.rejectedAccounts.length;

    console.log(`Chunk complete: ${(chunkIndex || 0) + 1}/${totalChunks || 1}, accounts=${result.derogatory_accounts?.length || 0}, validation=${result.validation_status || 'N/A'}, duplicates=${result.duplicate_flags?.length || 0}, schema_violations=${schemaResult.violations.length}`);

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
