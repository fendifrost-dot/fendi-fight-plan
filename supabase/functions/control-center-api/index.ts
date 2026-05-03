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
    const expectedKey = Deno.env.get("FANFUEL_HUB_KEY");
    if (!expectedKey) {
      console.error("FANFUEL_HUB_KEY not configured");
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

      // ── Playlist / FanFuel actions ──
      case "get_playlist_targets":
        return await getPlaylistTargets(supabase, params);
      case "update_pitch_status":
        return await updatePitchStatus(supabase, params);
      case "get_pitch_log":
        return await getPitchLog(supabase, params);

      // ── Email action ──
      case "send_pitch_email":
        return await sendPitchEmail(supabase, params);

      // ── Credit Compass intake / payments (Hub → Edge proxy) ──
      case "intake_create_canonical":
        return await proxyCompassJson("intake-create-canonical", {
          operatorUserId: params.operator_user_id,
          canonical: params.canonical,
        });
      case "intake_ingest_bureau_pdfs":
        return await proxyIntakeMultipart(params);
      case "intake_score_file":
        return await proxyCompassJson("intake-score-file", {
          operatorUserId: params.operator_user_id,
          clientId: params.client_id,
          record: params.record,
        });
      case "intake_approve_pricing":
        return await proxyCompassJson("intake-approve-pricing", {
          operatorUserId: params.operator_user_id,
          clientId: params.client_id,
          quotedFee: params.quoted_fee,
          discount: params.discount,
          payment: params.payment,
          overrideReason: params.override_reason,
        });
      case "intake_generate_summary":
        return await proxyCompassJson("intake-generate-summary", {
          operatorUserId: params.operator_user_id,
          clientId: params.client_id,
        });
      case "payments_record":
        return await proxyCompassJson("payments-record", {
          operatorUserId: params.operator_user_id,
          clientId: params.client_id,
          amount: params.amount,
          method: params.method,
          date: params.date,
          reference: params.reference,
        });
      case "payments_status":
        return await proxyCompassGet(
          "payments-status",
          params.client_id,
          params.operator_user_id,
        );
      case "payments_mark_late":
        return await proxyCompassJson("payments-mark-late", {
          graceDays: params.grace_days,
        });

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

async function proxyCompassJson(path: string, body: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const hubKey = Deno.env.get("FANFUEL_HUB_KEY");
  if (!supabaseUrl || !hubKey) {
    return json({ error: "Compass proxy misconfiguration" }, 500);
  }
  const resp = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": hubKey,
    },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    data = { error: await resp.text() };
  }
  return json(data, resp.status);
}

async function proxyCompassGet(
  path: string,
  clientId: string,
  operatorUserId: string,
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const hubKey = Deno.env.get("FANFUEL_HUB_KEY");
  if (!supabaseUrl || !hubKey) {
    return json({ error: "Compass proxy misconfiguration" }, 500);
  }
  if (!clientId || !operatorUserId) {
    return json({ error: "client_id and operator_user_id required" }, 400);
  }
  const q = new URLSearchParams({ clientId, operatorUserId });
  const resp = await fetch(`${supabaseUrl}/functions/v1/${path}?${q}`, {
    method: "GET",
    headers: { "x-api-key": hubKey },
  });
  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    data = { error: await resp.text() };
  }
  return json(data, resp.status);
}

async function proxyIntakeMultipart(params: any) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const hubKey = Deno.env.get("FANFUEL_HUB_KEY");
  if (!supabaseUrl || !hubKey) {
    return json({ error: "Compass proxy misconfiguration" }, 500);
  }
  const clientId = params.client_id;
  const operatorUserId = params.operator_user_id;
  if (!clientId || !operatorUserId) {
    return json({ error: "client_id and operator_user_id required" }, 400);
  }
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("operatorUserId", operatorUserId);
  for (const b of ["equifax", "experian", "transunion"] as const) {
    const b64 = params[`${b}_pdf_base64`];
    if (typeof b64 === "string" && b64.length > 0) {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      fd.set(b, new File([bin], `${b}.pdf`, { type: "application/pdf" }));
    }
  }
  const resp = await fetch(`${supabaseUrl}/functions/v1/intake-ingest-bureau-pdfs`, {
    method: "POST",
    headers: { "x-api-key": hubKey },
    body: fd,
  });
  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    data = { error: await resp.text() };
  }
  return json(data, resp.status);
}

// ── Existing Actions ──

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

  if (sessionResult.error) return json({ error: sessionResult.error.message }, 500);
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
  return json({ session_id: data.id, created_at: data.created_at, status: "created" });
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

  const [sessionResult, accountsResult] = await Promise.all([
    supabase.from("dispute_sessions").select("*").eq("id", sessionId).maybeSingle(),
    supabase
      .from("dispute_accounts")
      .select("*")
      .eq("session_id", sessionId)
      .eq("is_selected", true),
  ]);

  if (sessionResult.error) return json({ error: sessionResult.error.message }, 500);
  if (!sessionResult.data) return json({ error: "Session not found" }, 404);

  const session = sessionResult.data;
  const accounts = accountsResult.data || [];

  if (accounts.length === 0)
    return json({ error: "No selected accounts to dispute" }, 400);

  const bureaus = (session.selected_bureaus as string[]) || [];
  if (bureaus.length === 0) return json({ error: "No bureaus selected" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return json({ error: "AI service not configured" }, 500);

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
      errors.push(`${bureau}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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

// ── Playlist / FanFuel Actions ──

async function getPlaylistTargets(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const { track_name, status, limit = 50 } = params;

  let query = supabase
    .from("playlist_targets")
    .select("*")
    .order("overlap_score", { ascending: false })
    .limit(limit);

  if (track_name) query = query.eq("track_name", track_name);
  if (status) query = query.eq("pitch_status", status);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({ targets: data || [], count: (data || []).length });
}

async function updatePitchStatus(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const { playlist_id, status, notes } = params;
  if (!playlist_id || !status)
    return json({ error: "playlist_id and status required" }, 400);

  const validStatuses = ["not_pitched", "pitched", "replied", "placed", "declined", "do_not_pitch"];
  if (!validStatuses.includes(status))
    return json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }, 400);

  const update: any = { pitch_status: status, updated_at: new Date().toISOString() };
  if (notes) update.notes = notes;
  if (status === "pitched") update.pitched_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("playlist_targets")
    .update(update)
    .eq("playlist_id", playlist_id)
    .select("playlist_id, playlist_name, pitch_status")
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ updated: data });
}

async function getPitchLog(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const { track_name, limit = 100 } = params;

  let query = supabase
    .from("pitch_log")
    .select("*, playlist_targets(playlist_name, platform, follower_count)")
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (track_name) query = query.eq("track_name", track_name);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const all = data || [];
  const summary = {
    total_pitched: all.length,
    replied: all.filter((p: any) => p.reply_received).length,
    placed: all.filter((p: any) => p.placed).length,
    placement_rate: all.length > 0
      ? Math.round((all.filter((p: any) => p.placed).length / all.length) * 100) + "%"
      : "0%",
  };

  return json({ pitches: all, summary });
}

// ── Email Action ──

async function sendPitchEmail(
  supabase: ReturnType<typeof createClient>,
  params: any
) {
  const {
    playlist_id,
    curator_email,
    curator_name,
    playlist_name,
    track_name,
    subject,
    body,
  } = params;

  if (!curator_email || !subject || !body || !track_name || !playlist_id) {
    return json(
      { error: "curator_email, subject, body, track_name, and playlist_id are required" },
      400
    );
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FROM_EMAIL") || "pitches@fendifrost.com";

  if (!resendKey) {
    return json({ error: "RESEND_API_KEY not configured" }, 500);
  }

  const emailPayload = {
    from: `Fendi Frost <${fromEmail}>`,
    to: [curator_email],
    subject,
    text: body,
    html: body.replace(/\n/g, "<br>"),
  };

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emailPayload),
  });

  if (!resendResp.ok) {
    const errText = await resendResp.text();
    console.error("Resend error:", errText);
    return json({ error: `Email send failed: ${resendResp.status} - ${errText}` }, 500);
  }

  const resendData = await resendResp.json();

  const { error: logError } = await supabase.from("pitch_log").insert({
    playlist_id,
    track_name,
    curator_email,
    subject,
    email_body: body,
    sent_at: new Date().toISOString(),
    resend_message_id: resendData.id,
  });

  if (logError) {
    console.error("Failed to log pitch:", logError.message);
  }

  await supabase
    .from("playlist_targets")
    .update({ pitch_status: "pitched", pitched_at: new Date().toISOString() })
    .eq("playlist_id", playlist_id);

  return json({
    success: true,
    message_id: resendData.id,
    sent_to: curator_email,
    track: track_name,
    playlist: playlist_name || playlist_id,
  });
}
