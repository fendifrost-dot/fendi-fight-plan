import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
      return new Response(JSON.stringify({ error: { code: "STORAGE_401", message: "Authentication required", stage: "START" } }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: { code: "STORAGE_401", message: "Invalid session", stage: "START" } }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sessionId, storagePaths, questionnaire, reportType } = await req.json();

    if (!storagePaths || !Array.isArray(storagePaths) || storagePaths.length === 0) {
      return new Response(JSON.stringify({ error: { code: "START_BAD_REQUEST", message: "No storage paths provided", stage: "START" } }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrefix = `${user.id}/`;
    for (const path of storagePaths) {
      if (!path.startsWith(userPrefix)) {
        return new Response(JSON.stringify({ error: { code: "START_PATH_VALIDATION_FAILED", message: `Invalid storage path: access denied for ${path}`, stage: "START", step: "path_validation" } }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const jobId = crypto.randomUUID();
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { error: insertError } = await adminClient.from("analysis_jobs").insert({
      id: jobId,
      user_id: user.id,
      session_id: sessionId || null,
      status: "QUEUED",
      step: "pending",
      progress: 0,
      input_data: {
        storagePaths,
        questionnaire: questionnaire || {},
        reportType: reportType || "unknown",
        totalPages: storagePaths.length,
      },
      checkpoints: {},
    });

    if (insertError) {
      console.error("Failed to create job:", insertError);
      return new Response(JSON.stringify({ error: { code: "START_BAD_REQUEST", message: "Failed to create analysis job", stage: "START", cause: insertError.message } }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Trigger the worker (fire and forget)
    const workerUrl = `${supabaseUrl}/functions/v1/analysis-worker`;
    fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ jobId }),
    }).catch((err) => console.error("Failed to trigger worker:", err));

    console.log(`Job ${jobId} created for user ${user.id} with ${storagePaths.length} pages (storage paths)`);

    return new Response(JSON.stringify({ jobId, status: "QUEUED" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analysis-start:", error);
    return new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "Failed to start analysis", stage: "START", cause: error instanceof Error ? error.message : String(error) } }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
