import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { documents, bureauResponseText, priorLetterText } = await req.json();

    if (!documents || documents.length === 0) {
      return new Response(JSON.stringify({ error: "No documents provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Combine all text for classification
    const allText = [
      bureauResponseText || "",
      priorLetterText || "",
      ...documents.map((d: any) => d.extractedText || "").filter(Boolean)
    ].join("\n\n---\n\n");

    // Truncate if too long
    const truncatedText = allText.slice(0, 50000);

    const classificationPrompt = `Analyze the following document content and extract structured dispute information.

DOCUMENT CONTENT:
${truncatedText}

OUTPUT REQUIREMENTS (JSON format):

1. Determine the bureau(s) mentioned: "experian", "equifax", "transunion", or "multi-bureau" if multiple
2. Classify the response outcome:
   - "verified" = Bureau verified the disputed items as accurate
   - "partial" = Some items deleted, some verified
   - "deleted" = All disputed items removed
   - "no_response" = Bureau did not respond or respond properly
   - "frivolous" = Bureau deemed dispute frivolous
   - "reinsertion" = Previously deleted items were re-added

3. Extract accounts mentioned with:
   - creditorName: Name of creditor
   - maskedAccountNumber: Account number (preserve any masking exactly)
   - dateOpened: If available
   - bureauStatuses: Per-bureau status (current, closed, late, charge_off, collection, unknown)

4. Identify legal implications based on content
5. Suggest next steps

Return ONLY valid JSON in this exact structure:
{
  "bureau": "experian|equifax|transunion|multi-bureau",
  "outcome": "verified|partial|deleted|no_response|frivolous|reinsertion",
  "itemsVerified": ["list of items verified"],
  "itemsDeleted": ["list of items deleted"],
  "itemsPartial": ["list of items with partial changes"],
  "legalImplications": ["list of legal points"],
  "nextSteps": ["list of recommended actions"],
  "rawSummary": "2-3 sentence summary",
  "accounts": [
    {
      "id": "unique-id",
      "creditorName": "...",
      "maskedAccountNumber": "...",
      "dateOpened": "...",
      "bureauStatuses": {
        "experian": {"status": "late", "balance": "$500"},
        "equifax": null,
        "transunion": {"status": "current"}
      },
      "confidence": 0.85
    }
  ]
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { 
            role: "system", 
            content: "You are a credit dispute analysis system. Extract structured data from bureau responses. Output ONLY valid JSON." 
          },
          { role: "user", content: classificationPrompt }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI gateway error:", response.status);
      return new Response(JSON.stringify({ error: "Analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({ error: "No analysis generated" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clean up JSON response
    content = content
      .replace(/^```json\n?/g, '')
      .replace(/\n?```$/g, '')
      .trim();

    let analysisResult;
    try {
      analysisResult = JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse AI response:", content);
      return new Response(JSON.stringify({ error: "Invalid analysis format" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure accounts have IDs
    if (analysisResult.accounts) {
      analysisResult.accounts = analysisResult.accounts.map((acc: any, idx: number) => ({
        ...acc,
        id: acc.id || `acc-${idx}-${Date.now()}`,
        isSelected: false,
        confidence: acc.confidence || 0.7,
      }));
    }

    return new Response(JSON.stringify(analysisResult), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Classify documents error:", error);
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
