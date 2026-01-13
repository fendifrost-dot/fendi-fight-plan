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

    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch job status (RLS ensures user can only see their own jobs)
    const { data: job, error: fetchError } = await supabase
      .from("analysis_jobs")
      .select("id, status, step, progress, error_code, error_message, checkpoints, result_data, created_at, updated_at")
      .eq("id", jobId)
      .maybeSingle();

    if (fetchError) {
      console.error("Failed to fetch job:", fetchError);
      return new Response(JSON.stringify({ error: "Failed to fetch job status" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract partial results from checkpoints for UI
    const partialResults = {
      documentMap: job.checkpoints?.documentMap || null,
      accounts: job.checkpoints?.accounts || [],
      processedChunks: job.checkpoints?.processedChunks || 0,
      totalChunks: job.checkpoints?.totalChunks || 0,
      failedChunks: job.checkpoints?.failedChunks || [],
    };

    return new Response(JSON.stringify({
      jobId: job.id,
      status: job.status,
      step: job.step,
      progress: Math.round(job.progress),
      errorCode: job.error_code,
      errorMessage: job.error_message,
      partialResults,
      result: job.result_data,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analysis-status:", error);
    return new Response(JSON.stringify({ error: "Failed to get job status" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
