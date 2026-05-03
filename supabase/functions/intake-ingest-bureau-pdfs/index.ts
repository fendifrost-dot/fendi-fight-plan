import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireOperator } from "../_shared/intake-auth.ts";
import type { IntakeClientRecord } from "../_shared/intake-types.ts";
import { extractPdfText } from "../_shared/intake-pdf-text.ts";
import { parseBureauReportText } from "../_shared/intake-bureau-parse.ts";
import { mergeRecordJson, recomputeDerivedFields } from "../_shared/intake-record-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected multipart form-data" }, 400);
  }

  const hubOp = String(form.get("operatorUserId") ?? "");
  const auth = await requireOperator(req, hubOp ? { operatorUserId: hubOp } : undefined);
  if (!auth.ok) return new Response(auth.response.body, { status: auth.response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const clientId = String(form.get("clientId") ?? "");
  if (!clientId) return json({ error: "clientId required" }, 400);

  const { data: row, error: fetchErr } = await admin.from("intake_clients")
    .select("id, intake_operator_id, record, bureau_raw_extracts")
    .eq("id", clientId)
    .maybeSingle();

  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!row || row.intake_operator_id !== auth.userId) {
    return json({ error: "Not found" }, 404);
  }

  const rec = row.record as unknown as IntakeClientRecord;
  const extracts: Record<string, string> = {
    ...(row.bureau_raw_extracts as Record<string, string> | null ?? {}),
  };

  const pulledAt = new Date().toISOString();
  const bureauReported = { ...rec.bureauReported };

  let uploaded = 0;
  for (const bureau of ["equifax", "experian", "transunion"] as const) {
    const file = form.get(bureau);
    if (!file || !(file instanceof File)) continue;
    uploaded++;
    const buf = new Uint8Array(await file.arrayBuffer());
    const text = await extractPdfText(buf);
    extracts[bureau] = text;
    bureauReported[bureau] = parseBureauReportText(text);
    bureauReported.pulledAt = { ...bureauReported.pulledAt, [bureau]: pulledAt };
  }

  if (uploaded === 0) {
    return json({ error: "Attach at least one bureau PDF (equifax, experian, transunion)" }, 400);
  }

  const next = recomputeDerivedFields(
    mergeRecordJson(rec, { bureauReported }),
  );

  const { error: upErr } = await admin.from("intake_clients").update({
    record: next as unknown as Record<string, unknown>,
    bureau_raw_extracts: extracts,
    status: next.status,
  }).eq("id", clientId);

  if (upErr) return json({ error: upErr.message }, 500);

  return json({ clientId, record: next, extractLengths: Object.fromEntries(Object.entries(extracts).map(([k, v]) => [k, v.length])) });
});
