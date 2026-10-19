import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor } from "../_shared/staff-cors.ts";
import { hubDenied, hubUser, resolveHubCaller } from "../_shared/hub-caller.ts";

serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const hub = await resolveHubCaller(req);
    if (hub && hub.ok === false) return hubDenied(hub, corsHeaders);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader && !hub) {
      return new Response(JSON.stringify({ error: { code: "STORAGE_401", message: "Authentication required", stage: "START" } }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader ?? "" } },
    });

    const { data: { user }, error: authError } = hub ? hubUser(hub) : await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: { code: "STORAGE_401", message: "Invalid session", stage: "START" } }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { sessionId, storagePaths, questionnaire, reportType } = body;
    const inputMode = body.inputMode === "text" ? "text" : "images";
    const bureau = typeof body.bureau === "string" ? body.bureau : null;
    const clientId = typeof body.clientId === "string" ? body.clientId : null;
    const sourcePdfPath = typeof body.sourcePdfPath === "string" ? body.sourcePdfPath : null;
    const textChars = typeof body.textChars === "number" && Number.isFinite(body.textChars) ? body.textChars : null;
    const uploadSource = body.source === "agent_upload" ? "agent_upload" : null;
    const requestedPages = Number(body.totalPages);

    if (!storagePaths || !Array.isArray(storagePaths) || storagePaths.length === 0) {
      return new Response(JSON.stringify({ error: { code: "START_BAD_REQUEST", message: "No storage paths provided", stage: "START" } }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrefix = `${user.id}/`;
    const pathAllowed = (path: unknown) =>
      typeof path === "string" && path.startsWith(userPrefix) && !path.includes("..") && !path.includes("\\");
    for (const path of storagePaths) {
      if (!pathAllowed(path)) {
        return new Response(JSON.stringify({ error: { code: "START_PATH_VALIDATION_FAILED", message: `Invalid storage path: access denied for ${path}`, stage: "START", step: "path_validation" } }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (sourcePdfPath && !pathAllowed(sourcePdfPath)) {
      return new Response(JSON.stringify({ error: { code: "START_PATH_VALIDATION_FAILED", message: "Invalid source PDF path", stage: "START", step: "path_validation" } }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const totalPages = Number.isInteger(requestedPages) && requestedPages > 0 && requestedPages <= 500
      ? requestedPages
      : storagePaths.length;

    const jobId = crypto.randomUUID();
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const inputData = {
      storagePaths,
      questionnaire: questionnaire || {},
      reportType: reportType || bureau || "unknown",
      totalPages,
      inputMode,
      bureau,
      clientId,
      sourcePdfPath,
      textChars,
      _source: uploadSource,
      _contract_version: "v2-canonical",
      _started_at: new Date().toISOString(),
    };

    const { error: insertError } = await adminClient.from("analysis_jobs").insert({
      id: jobId,
      user_id: user.id,
      session_id: sessionId || null,
      status: "QUEUED",
      step: "pending",
      progress: 0,
      input_data: inputData,
      checkpoints: {},
    });

    if (insertError) {
      console.error("Failed to create job:", insertError);
      return new Response(JSON.stringify({ error: { code: "START_BAD_REQUEST", message: "Failed to create analysis job", stage: "START", cause: insertError.message } }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (sessionId) {
      const { data: sessionRow } = await adminClient
        .from("dispute_sessions")
        .select("id, selected_bureaus")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (sessionRow) {
        const selected = Array.isArray(sessionRow.selected_bureaus) ? sessionRow.selected_bureaus : [];
        const bureaus = bureau && !selected.includes(bureau) ? [...selected, bureau] : selected;
        const { error: sessionError } = await adminClient.from("dispute_sessions").update({
          analysis_status: "IN_PROGRESS",
          active_job_id: jobId,
          selected_bureaus: bureaus,
          updated_at: new Date().toISOString(),
        }).eq("id", sessionId).eq("user_id", user.id);
        if (sessionError) console.error("Failed to stamp session", sessionError.message);
      }
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

    console.log(`Job ${jobId} created for user ${user.id} with ${totalPages} pages mode=${inputMode} objects=${storagePaths.length}`);

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
