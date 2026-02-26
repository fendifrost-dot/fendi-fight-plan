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
      return new Response(JSON.stringify({ error: { code: "STORAGE_401", message: "Authentication required", stage: "STATUS" } }), {
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
      return new Response(JSON.stringify({ error: { code: "STORAGE_401", message: "Invalid session", stage: "STATUS" } }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) {
      return new Response(JSON.stringify({ error: { code: "START_BAD_REQUEST", message: "jobId is required", stage: "STATUS" } }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job, error: fetchError } = await supabase
      .from("analysis_jobs")
      .select("id, status, step, progress, error_code, error_message, error_stage, error_meta, checkpoints, result_data, created_at, updated_at")
      .eq("id", jobId)
      .maybeSingle();

    if (fetchError) {
      console.error("Failed to fetch job:", fetchError);
      return new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "Failed to fetch job status", stage: "STATUS", cause: fetchError.message } }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!job) {
      return new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "Job not found", stage: "STATUS", step: jobId } }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const partialResults = {
      documentMap: job.checkpoints?.documentMap || null,
      accounts: job.checkpoints?.accounts || [],
      processedChunks: job.checkpoints?.processedChunks || 0,
      totalChunks: job.checkpoints?.totalChunks || 0,
      failedChunks: job.checkpoints?.failedChunks || [],
    };

    // Build structured error (always present when FAILED/PARTIAL, null otherwise)
    let structuredError = null;
    if (job.error_code || job.error_message) {
      structuredError = {
        code: job.error_code || "UNKNOWN",
        message: job.error_message || "Unknown error",
        stage: job.error_stage || "WORKER",
        step: job.error_meta?.step || job.step || null,
        page: job.error_meta?.page || null,
        chunk: job.error_meta?.chunk || null,
        meta: job.error_meta || null,
      };
    }

    return new Response(JSON.stringify({
      jobId: job.id,
      status: job.status,
      step: job.step,
      progress: Math.round(job.progress),
      error: structuredError,
      partialResults,
      result: job.result_data,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analysis-status:", error);
    return new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "Failed to get job status", stage: "STATUS", cause: error instanceof Error ? error.message : String(error) } }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
