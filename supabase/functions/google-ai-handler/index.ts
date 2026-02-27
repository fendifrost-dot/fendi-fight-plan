import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Credit keywords for automatic routing ──────────────────────
const CREDIT_KEYWORDS = [
  "dispute", "credit report", "bureau", "fcra", "triage",
  "charge-off", "collection", "derogatory", "inaccurate",
  "experian", "equifax", "transunion", "late payment",
];

function classifyContext(prompt: string): "credit" | "marketing" {
  const lower = prompt.toLowerCase();
  return CREDIT_KEYWORDS.some((kw) => lower.includes(kw)) ? "credit" : "marketing";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse request ───────────────────────────────────────────
    const { prompt, context: explicitContext, modelId, extractedData, messages } = await req.json();

    if (!prompt && (!messages || messages.length === 0)) {
      return new Response(JSON.stringify({ error: "Prompt or messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const context = explicitContext || classifyContext(prompt || messages?.[messages.length - 1]?.content || "");
    const provider = context === "credit" ? "lovable" : "vertex";

    // ── Route to provider ───────────────────────────────────────
    if (provider === "lovable") {
      return await handleLovableAI(prompt, messages, modelId, extractedData, context);
    } else {
      return await handleVertexAI(prompt, messages, modelId, context);
    }
  } catch (error) {
    console.error("google-ai-handler error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Lovable AI Gateway (credit cases) ───────────────────────────
async function handleLovableAI(
  prompt: string | undefined,
  messages: any[] | undefined,
  modelId: string | undefined,
  extractedData: any,
  context: string
) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const model = modelId || "openai/gpt-5-mini";
  const systemPrompt = "You are a credit dispute analysis assistant. Provide accurate, FCRA-compliant guidance.";

  const aiMessages = [
    { role: "system", content: systemPrompt },
    ...(messages || []),
    ...(prompt ? [{ role: "user", content: prompt }] : []),
  ];

  // Pass extracted data as context if present
  if (extractedData) {
    aiMessages.splice(1, 0, {
      role: "system",
      content: `Extracted credit report data:\n${JSON.stringify(extractedData, null, 2)}`,
    });
  }

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages: aiMessages }),
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
    const errText = await response.text();
    console.error("Lovable AI error:", response.status, errText);
    return new Response(JSON.stringify({ error: "AI request failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  return new Response(
    JSON.stringify({ provider: "lovable", model, context, content }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── Vertex AI via Google Cloud (marketing) ──────────────────────
async function handleVertexAI(
  prompt: string | undefined,
  messages: any[] | undefined,
  modelId: string | undefined,
  context: string
) {
  const GOOGLE_CLOUD_KEY = Deno.env.get("GOOGLE_CLOUD_KEY");
  if (!GOOGLE_CLOUD_KEY) {
    return new Response(
      JSON.stringify({ error: "GOOGLE_CLOUD_KEY not configured. Add it in Lovable Cloud secrets." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const model = modelId || "gemini-2.5-pro";
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_CLOUD_KEY}`;

  const userContent = prompt || messages?.[messages.length - 1]?.content || "";
  const systemInstruction = "You are a marketing and engagement assistant for FanFuel. Help create social media content, email campaigns, and audience engagement strategies.";

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: userContent }] }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Vertex AI error:", response.status, errText);
    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Google AI rate limit exceeded" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Google AI request failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  return new Response(
    JSON.stringify({ provider: "vertex", model, context, content }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
