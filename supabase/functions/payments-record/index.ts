import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireOperator } from "../_shared/intake-auth.ts";
import type { IntakeClientRecord } from "../_shared/intake-types.ts";
import { mergeRecordJson, recomputeDerivedFields } from "../_shared/intake-record-helpers.ts";
import { applyPaymentReceived } from "../_shared/intake-payment-plan.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as {
    clientId?: string;
    operatorUserId?: string;
    amount?: number;
    method?: string;
    date?: string;
    reference?: string;
  };

  const auth = await requireOperator(req, body);
  if (!auth.ok) return new Response(auth.response.body, { status: auth.response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!body.clientId) return json({ error: "clientId required" }, 400);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "amount invalid" }, 400);
  const method = String(body.method || "unspecified");
  const date = body.date || new Date().toISOString().slice(0, 10);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  const { data: row, error: fetchErr } = await admin.from("intake_clients")
    .select("id, intake_operator_id, record")
    .eq("id", body.clientId)
    .maybeSingle();

  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!row || row.intake_operator_id !== auth.userId) return json({ error: "Not found" }, 404);

  let rec = recomputeDerivedFields(row.record as unknown as IntakeClientRecord);
  if (!rec.paymentPlan) return json({ error: "No payment plan on file" }, 400);

  const nextPlan = applyPaymentReceived(rec.paymentPlan, amount, method, date, body.reference);
  rec = recomputeDerivedFields(
    mergeRecordJson(rec, {
      paymentPlan: nextPlan,
      status: rec.status === "doc_generated" || rec.status === "approved" ? "engaged" : rec.status,
    }),
  );

  const { error: upErr } = await admin.from("intake_clients").update({
    record: rec as unknown as Record<string, unknown>,
    status: rec.status,
  }).eq("id", body.clientId);

  if (upErr) return json({ error: upErr.message }, 500);

  return json({ clientId: body.clientId, paymentPlan: rec.paymentPlan, record: rec });
});
