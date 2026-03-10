import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STORAGE_BUCKET = "analysis-images";
const ZOMBIE_LIMIT = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const client = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Find zombie jobs:
    // - status is QUEUED/RUNNING
    // - heartbeat is null or older than stale_after_seconds (default 900s = 15min)
    // - created_at older than 20 minutes (don't kill very fresh jobs)
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const { data: zombies, error: fetchError } = await client
      .from("analysis_jobs")
      .select("id, user_id, status, step, progress, last_heartbeat_at, created_at, stale_after_seconds")
      .in("status", ["QUEUED", "RUNNING", "IN_PROGRESS"])
      .lt("created_at", twentyMinAgo)
      .order("created_at", { ascending: true })
      .limit(ZOMBIE_LIMIT);

    if (fetchError) {
      console.error("Failed to query zombie jobs:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!zombies || zombies.length === 0) {
      return new Response(JSON.stringify({ cleaned: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter to actual zombies based on per-job stale_after_seconds
    const now = Date.now();
    const actualZombies = zombies.filter((job: any) => {
      const staleSeconds = job.stale_after_seconds || 900;
      const heartbeat = job.last_heartbeat_at ? new Date(job.last_heartbeat_at).getTime() : 0;
      const heartbeatAge = (now - heartbeat) / 1000;
      // No heartbeat at all, or heartbeat older than threshold
      return !job.last_heartbeat_at || heartbeatAge > staleSeconds;
    });

    let cleaned = 0;

    for (const job of actualZombies) {
      // Mark as FAILED with JOB_STALE
      const { error: updateError } = await client
        .from("analysis_jobs")
        .update({
          status: "FAILED",
          error_code: "JOB_STALE",
          error_stage: "WORKER",
          error_message: "No heartbeat; worker likely crashed or timed out",
          error_meta: {
            last_heartbeat_at: job.last_heartbeat_at,
            created_at: job.created_at,
            step: job.step,
            progress: job.progress,
            cleaned_by: "analysis-cleanup",
          },
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      if (updateError) {
        console.error(`Failed to mark job ${job.id} as stale:`, updateError);
        continue;
      }

      // Clean up storage (idempotent — no error if already empty)
      try {
        const prefix = `${job.user_id}/${job.id}`;
        const { data: files } = await client.storage
          .from(STORAGE_BUCKET)
          .list(prefix, { limit: 500 });

        if (files && files.length > 0) {
          const paths = files.map((f: any) => `${prefix}/${f.name}`);
          await client.storage.from(STORAGE_BUCKET).remove(paths);
          console.log(`Cleaned ${paths.length} storage objects for zombie job ${job.id}`);
        }
      } catch (storageErr) {
        console.error(`Storage cleanup error for job ${job.id}:`, storageErr);
        // Non-fatal — job is already marked FAILED
      }

      // Clear active_job_id on the session if it points to this zombie
      await client
        .from("dispute_sessions")
        .update({ active_job_id: null, updated_at: new Date().toISOString() })
        .eq("active_job_id", job.id);

      cleaned++;
      console.log(`Zombie job ${job.id} marked as FAILED/JOB_STALE (step: ${job.step}, progress: ${job.progress})`);
    }

    console.log(`Cleanup complete: ${cleaned} zombie job(s) processed out of ${zombies.length} candidates`);

    return new Response(JSON.stringify({ cleaned, candidates: zombies.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Cleanup function error:", error);
    return new Response(JSON.stringify({ error: "Cleanup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
