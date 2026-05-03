import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireOperator } from "../_shared/intake-auth.ts";
import type { IntakeClientRecord } from "../_shared/intake-types.ts";
import { PRICING_CEILING, PRICING_FLOOR } from "../_shared/intake-types.ts";
import { mergeRecordJson, recomputeDerivedFields } from "../_shared/intake-record-helpers.ts";
import { buildInitialPaymentPlan } from "../_shared/intake-payment-plan.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as {
    clientId?: string;
    operatorUserId?: string;
    quotedFee?: number;
    discount?: {
      label: string;
      amount: number;
      deadlineHours: number;
      stipulation: string;
    };
    payment?: { deposit: { amount: number; dueBy: string }; scheduleNote?: string };
    overrideReason?: string;
  };

  const auth = await requireOperator(req, body);
  if (!auth.ok) return new Response(auth.response.body, { status: auth.response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!body.clientId) return json({ error: "clientId required" }, 400);
  const quotedFee = Number(body.quotedFee);
  if (!Number.isFinite(quotedFee)) return json({ error: "quotedFee invalid" }, 400);
  if (quotedFee < PRICING_FLOOR || quotedFee > PRICING_CEILING) {
    return json({ error: `quotedFee must be between ${PRICING_FLOOR} and ${PRICING_CEILING}` }, 400);
  }

  const deposit = body.payment?.deposit;
  if (!deposit?.dueBy || !Number.isFinite(Number(deposit.amount))) {
    return json({ error: "payment.deposit with amount and dueBy (ISO date) required" }, 400);
  }

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
  const tier = rec.pricingRecommendation.tier;
  const outside = quotedFee < tier.low || quotedFee > tier.high;
  if (outside && !String(body.overrideReason || "").trim()) {
    return json({
      error: "overrideReason required when quotedFee is outside the recommended tier range",
      tier,
    }, 400);
  }

  let netTotal = quotedFee;
  if (body.discount) {
    const da = Number(body.discount.amount);
    if (!Number.isFinite(da) || da < 0) return json({ error: "discount.amount invalid" }, 400);
    if (da > quotedFee - PRICING_FLOOR) {
      return json({ error: `discount.amount must be ≤ quotedFee - ${PRICING_FLOOR}` }, 400);
    }
    netTotal = Math.round((quotedFee - da) * 100) / 100;
  }

  const depositAmt = Number(deposit.amount);
  if (depositAmt < 0 || depositAmt > netTotal) {
    return json({ error: "deposit amount invalid" }, 400);
  }

  const approvedAt = new Date().toISOString();
  const pricingApproved = {
    quotedFee,
    discount: body.discount,
    netTotal,
    overrideReason: body.overrideReason?.trim() || undefined,
    approvedBy: auth.userId,
    approvedAt,
  };

  const paymentPlan = buildInitialPaymentPlan({
    netTotal,
    depositAmount: depositAmt,
    depositDueBy: deposit.dueBy,
    scheduleNote: body.payment?.scheduleNote,
  });

  rec = recomputeDerivedFields(
    mergeRecordJson(rec, {
      pricingApproved,
      paymentPlan,
      status: "approved",
    }),
  );

  const { error: upErr } = await admin.from("intake_clients").update({
    record: rec as unknown as Record<string, unknown>,
    status: rec.status,
  }).eq("id", body.clientId);

  if (upErr) return json({ error: upErr.message }, 500);

  return json({ clientId: body.clientId, record: rec });
});
