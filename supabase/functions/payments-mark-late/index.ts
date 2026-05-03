import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/intake-auth.ts";
import type { IntakeClientRecord } from "../_shared/intake-types.ts";
import { mergeRecordJson, recomputeDerivedFields } from "../_shared/intake-record-helpers.ts";

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T12:00:00Z").getTime();
  const db = new Date(b + "T12:00:00Z").getTime();
  return Math.floor((db - da) / (86400 * 1000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = req.headers.get("x-api-key");
  const expectedKey = Deno.env.get("FANFUEL_HUB_KEY");
  if (!expectedKey || apiKey !== expectedKey) {
    return json({ error: "Unauthorized" }, 401);
  }

  let graceDays = 5;
  try {
    const body = await req.json().catch(() => ({})) as { graceDays?: number };
    if (typeof body.graceDays === "number" && body.graceDays >= 0) graceDays = body.graceDays;
  } catch { /* default */ }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  const { data: rows, error } = await admin.from("intake_clients").select("id, record");
  if (error) return json({ error: error.message }, 500);

  const today = new Date().toISOString().slice(0, 10);
  let updated = 0;

  for (const row of rows || []) {
    const rec = row.record as unknown as IntakeClientRecord;
    const plan = rec.paymentPlan;
    if (!plan || plan.status === "paid_in_full" || plan.status === "defaulted") continue;
    if (plan.remainingBalance <= 0) continue;

    let isLate = false;
    if (!plan.deposit.receivedAt && daysBetween(plan.deposit.dueBy, today) > graceDays) {
      isLate = true;
    }
    for (const inst of plan.installments) {
      if (!inst.receivedAt && daysBetween(inst.dueDate, today) > graceDays) {
        isLate = true;
        break;
      }
    }

    if (isLate && plan.status !== "late") {
      const next = recomputeDerivedFields(
        mergeRecordJson(rec, { paymentPlan: { ...plan, status: "late" } }),
      );
      const { error: up } = await admin.from("intake_clients").update({
        record: next as unknown as Record<string, unknown>,
      }).eq("id", row.id);
      if (!up) updated++;
    }
  }

  return json({ processed: (rows || []).length, markedLate: updated, graceDays });
});
