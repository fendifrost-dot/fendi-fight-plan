import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a credit dispute legal strategist with the tone of a prosecutor. You analyze credit bureau responses and provide the next steps in the dispute process.

CRITICAL RULES:
1. Be firm, direct, and legally grounded. No fluff.
2. Always cite relevant statutes: FCRA §602(a), §607(b), §611, §605B (identity theft).
3. Specificity is non-negotiable - always demand account numbers, dates, and exact details.

When analyzing a response, classify it into ONE of these scenarios:
- SCENARIO_A: Bureau deleted everything requested (SUCCESS - monitor for reinsertion)
- SCENARIO_B: Bureau deleted some items but verified others (MoV demand + second dispute needed)
- SCENARIO_C: Bureau verified everything, dismissed dispute, or gave identity excuse (Escalation required: CFPB → BBB → AG)

Your response MUST be in this exact JSON format:
{
  "scenario": "SCENARIO_A" | "SCENARIO_B" | "SCENARIO_C",
  "scenario_title": "Brief title of the outcome",
  "summary": "2-3 sentence analysis of what the bureau did",
  "next_steps": ["Step 1", "Step 2", "Step 3"],
  "prompts": [
    {
      "title": "Prompt title",
      "purpose": "What this prompt accomplishes",
      "template": "The actual prompt template with [PLACEHOLDERS]"
    }
  ],
  "warnings": ["Any critical warnings or reminders"],
  "statutes_to_cite": ["FCRA §611", "FCRA §605B"]
}

PROMPT TEMPLATES BY SCENARIO:

For SCENARIO_B (partial deletion):
- Method of Verification (MoV) Demand Letter
- Second Round Dispute Letter emphasizing verification failures

For SCENARIO_C (full verification/dismissal):
- CFPB Complaint: "What Happened" section
- CFPB Complaint: "Requested Remedy" section
- BBB Complaint (if CFPB fails)
- Attorney General Complaint (for patterns of noncompliance)

Always include placeholders like:
[YOUR_FULL_NAME], [YOUR_ADDRESS], [BUREAU_NAME], [ACCOUNT_CREDITOR], [ACCOUNT_NUMBER], [DATE_OPENED], [DISPUTE_DATE], [RESPONSE_DATE], [INQUIRY_COMPANY], [INQUIRY_DATE]

Remind users: "If you don't include account numbers and dates opened, bureaus exploit ambiguity."`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { responseText, responseImage, bureau, disputeDate, responseDate, hasIdentityDocs } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const userContent: any[] = [];
    
    let contextMessage = `Analyze this credit bureau response and provide next steps.\n\nBureau: ${bureau || "Not specified"}`;
    if (disputeDate) contextMessage += `\nDispute sent: ${disputeDate}`;
    if (responseDate) contextMessage += `\nResponse received: ${responseDate}`;
    if (hasIdentityDocs) contextMessage += `\nIdentity theft documentation available: ${hasIdentityDocs}`;
    
    if (responseImage) {
      userContent.push({
        type: "text",
        text: contextMessage + "\n\nThe bureau response is in the attached image. Analyze it carefully."
      });
      userContent.push({
        type: "image_url",
        image_url: { url: responseImage }
      });
    } else if (responseText) {
      userContent.push({
        type: "text",
        text: contextMessage + `\n\nBureau Response Text:\n"""\n${responseText}\n"""`
      });
    } else {
      throw new Error("No response text or image provided");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error("No content in AI response");
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(content);
    } catch {
      parsedResult = { 
        scenario: "SCENARIO_C", 
        scenario_title: "Analysis Complete",
        summary: content,
        next_steps: ["Review the analysis above and proceed accordingly"],
        prompts: [],
        warnings: [],
        statutes_to_cite: []
      };
    }

    return new Response(JSON.stringify(parsedResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analyze-response function:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error occurred" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
