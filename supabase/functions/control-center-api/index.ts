import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: shared secret ──
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("CREDIT_COMPASS_API_KEY");

    if (!expectedKey) {
      console.error("CREDIT_COMPASS_API_KEY not configured");
      return json({ error: "Server misconfiguration" }, 500);
    }

    if (!apiKey || apiKey !== expectedKey) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── Route ──
    const { action, ...params } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    switch (action) {
      case "get_assessments":
        return await getAssessments(supabase);

      case "get_assessment_detail":
        return await getAssessmentDetail(supabase, params.session_id);

      case "create_assessment":
        return await createAssessment(supabase, params);

      case "get_report":
        return await getReport(supabase, params.session_id);

      case "generate_report":
        return await generateReport(supabase, params.session_id);

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("control-center-api error:", err);
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});

// ── Helpers ──

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Actions ──

async function getAssessments(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("dispute_sessions")
    .select(
      "id, user_id, created_at, updated_at, analysis_status, is_analyzed, mode, selected_bureaus, consumer_info"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return json({ error: error.message }, 500);

  const assessments = (data || []).map((s: any) => ({
    session_id: s.id,
    user_id: s.user_id,
    created_at: s.created_at,
    updated_at: s.updated_at,
    status: s.analysis_status,
    is_analyzed: s.is_analyzed,
    mode: s.mode,
    bureaus: s.selected_bureaus || [],
    client_name:
      s.consumer_info?.fullName || s.consumer_info?.full_name || "Unknown",
  }));

  return json({ assessments, count: assessments.length });
}

async function getAssessmentDetail(
  supabase: ReturnType<typeof createClient>,
  sessionId: string
) {
  if (!sessionId) return json({ error: "session_id required" }, 400);

  const [sessionResult, accountsResult] = await Promise.all([
    supabase
      .from("dispute_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle(),
    supabase
      .from("dispute_accounts")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
  ]);

  if (sessionResult.error)
    return json({ error: sessionResult.error.message }, 500);
  if (!sessionResult.data) return json({ error: "Session not found" }, 404);

  const session = sessionResult.data;

  return json({
    session_id: session.id,
    user_id: session.user_id,
    created_at: session.created_at,
    updated_at: session.updated_at,
    status: session.analysis_status,
    is_analyzed: session.is_analyzed,
    mode: session.mode,
    bureaus: session.selected_bureaus || [],
    consumer_info: session.consumer_info,
    analysis_result: session.analysis_result,
    outcome_confirmation: session.outcome_confirmation,
    survey: session.survey,
    documents: session.documents,
    accounts: (accountsResult.data || []).map((a: any) => ({
      id: a.id,
      creditor_name: a.creditor_name,
      masked_account_number: a.masked_account_number,
      date_opened: a.date_opened,
      triage_state: a.triage_state,
      dispute_reason: a.dispute_reason,
      confidence: a.confidence,
      bureau_statuses: a.bureau_statuses,
      is_selected: a.is_selected,
      source_file: a.source_file,
    })),
    account_count: accountsResult.data?.length || 0,
  });
}

async function createAssessment(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const { user_id, consumer_info, mode, selected_bureaus } = params;

  if (!user_id) return json({ error: "user_id required" }, 400);

  const { data, error } = await supabase
    .from("dispute_sessions")
    .insert({
      user_id,
      consumer_info: consumer_info || {
        fullName: "",
        addressLine1: "",
        addressLine2: "",
        cityStateZip: "",
      },
      mode: mode || "ai",
      selected_bureaus: selected_bureaus || [],
      analysis_status: "NOT_STARTED",
    })
    .select("id, created_at")
    .single();

  if (error) return json({ error: error.message }, 500);

  return json({
    session_id: data.id,
    created_at: data.created_at,
    status: "created",
  });
}

async function getReport(
  supabase: ReturnType<typeof createClient>,
  sessionId: string
) {
  if (!sessionId) return json({ error: "session_id required" }, 400);

  const { data, error } = await supabase
    .from("dispute_sessions")
    .select("id, generated_letters, selected_bureaus, consumer_info, survey")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Session not found" }, 404);

  const letters = data.generated_letters as Record<string, string> | null;
  const hasLetters =
    letters &&
    Object.values(letters).some((v: string) => v && v.trim().length > 0);

  return json({
    session_id: data.id,
    has_report: !!hasLetters,
    bureaus: data.selected_bureaus || [],
    consumer_info: data.consumer_info,
    letters: hasLetters ? letters : null,
  });
}

async function generateReport(
  supabase: ReturnType<typeof createClient>,
  sessionId: string
) {
  if (!sessionId) return json({ error: "session_id required" }, 400);

  // Fetch session + accounts
  const [sessionResult, accountsResult] = await Promise.all([
    supabase
      .from("dispute_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle(),
    supabase
      .from("dispute_accounts")
      .select("*")
      .eq("session_id", sessionId)
      .eq("is_selected", true),
  ]);

  if (sessionResult.error)
    return json({ error: sessionResult.error.message }, 500);
  if (!sessionResult.data) return json({ error: "Session not found" }, 404);

  const session = sessionResult.data;
  const accounts = accountsResult.data || [];

  if (accounts.length === 0) {
    return json({ error: "No selected accounts to dispute" }, 400);
  }

  const bureaus = (session.selected_bureaus as string[]) || [];
  if (bureaus.length === 0) {
    return json({ error: "No bureaus selected" }, 400);
  }

  // Call generate-dispute-letter for each bureau
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!LOVABLE_API_KEY) {
    return json({ error: "AI service not configured" }, 500);
  }

  const letters: Record<string, string> = {};
  const errors: string[] = [];

  for (const bureau of bureaus) {
    try {
      const resp = await fetch(
        `${supabaseUrl}/functions/v1/generate-dispute-letter`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({
            survey: session.survey || {},
            extractedData: {
              derogatory_accounts: accounts.map((a: any) => ({
                creditor_name: a.creditor_name,
                account_number: a.masked_account_number,
                date_opened: a.date_opened,
                dispute_reason: a.dispute_reason,
                bureau_statuses: a.bureau_statuses,
              })),
            },
            consumerInfo: session.consumer_info,
            bureau,
          }),
        }
      );

      if (resp.ok) {
        const result = await resp.json();
        letters[bureau] = result.letter || "";
      } else {
        const errText = await resp.text();
        errors.push(`${bureau}: ${resp.status} - ${errText}`);
      }
    } catch (e) {
      errors.push(
        `${bureau}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Save letters to session
  if (Object.keys(letters).length > 0) {
    await supabase
      .from("dispute_sessions")
      .update({ generated_letters: letters })
      .eq("id", sessionId);
  }

  return json({
    session_id: sessionId,
    letters_generated: Object.keys(letters).length,
    bureaus_completed: Object.keys(letters),
    errors: errors.length > 0 ? errors : undefined,
  });
}
