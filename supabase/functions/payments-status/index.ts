import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireOperator } from "../_shared/intake-auth.ts";
import type { IntakeClientRecord } from "../_shared/intake-types.ts";
import { recomputeDerivedFields } from "../_shared/intake-record-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const hubOp = url.searchParams.get("operatorUserId");
  const auth = await requireOperator(req, hubOp ? { operatorUserId: hubOp } : undefined);
  if (!auth.ok) return new Response(auth.response.body, { status: auth.response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!clientId) return json({ error: "clientId query param required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: row, error } = await admin.from("intake_clients")
    .select("intake_operator_id, record")
    .eq("id", clientId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!row || row.intake_operator_id !== auth.userId) return json({ error: "Not found" }, 404);

  const rec = recomputeDerivedFields(row.record as unknown as IntakeClientRecord);
  const plan = rec.paymentPlan;
  if (!plan) return json({ clientId, paymentPlan: null });

  const today = new Date().toISOString().slice(0, 10);
  let nextDue: { type: "deposit" | "installment"; dueBy: string; amount: number } | null = null;
  if (!plan.deposit.receivedAt) {
    nextDue = { type: "deposit", dueBy: plan.deposit.dueBy, amount: plan.deposit.amount };
  } else {
    for (const inst of plan.installments) {
      if (!inst.receivedAt && inst.dueDate >= today) {
        nextDue = {
          type: "installment",
          dueBy: inst.dueDate,
          amount: inst.amount,
        };
        break;
      }
    }
    if (!nextDue) {
      for (const inst of plan.installments) {
        if (!inst.receivedAt) {
          nextDue = { type: "installment", dueBy: inst.dueDate, amount: inst.amount };
          break;
        }
      }
    }
  }

  return json({
    clientId,
    remainingBalance: plan.remainingBalance,
    status: plan.status,
    nextDue,
    paymentPlan: plan,
  });
});
