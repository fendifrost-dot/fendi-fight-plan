import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireOperator } from "../_shared/intake-auth.ts";
import type { IntakeClientRecord } from "../_shared/intake-types.ts";
import { computeFileProfile, computePricingRecommendation } from "../_shared/intake-score-pricing.ts";
import { mergeRecordJson, recomputeDerivedFields } from "../_shared/intake-record-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as {
    clientId?: string;
    operatorUserId?: string;
    /** Pure scoring: full IntakeClientRecord snapshot without DB */
    record?: IntakeClientRecord;
  };

  const auth = await requireOperator(req, body);
  if (!auth.ok) return new Response(auth.response.body, { status: auth.response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let rec: IntakeClientRecord | null = body.record ?? null;

  if (!rec && body.clientId) {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);
    const { data: row, error } = await admin.from("intake_clients")
      .select("intake_operator_id, record")
      .eq("id", body.clientId)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row || row.intake_operator_id !== auth.userId) return json({ error: "Not found" }, 404);
    rec = row.record as unknown as IntakeClientRecord;
  }

  if (!rec) return json({ error: "clientId or record required" }, 400);

  const fileProfile = computeFileProfile(rec.bureauReported);
  const pricingRecommendation = computePricingRecommendation(fileProfile);

  if (body.clientId && !body.record) {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);
    const updated = recomputeDerivedFields(mergeRecordJson(rec, {}));
    await admin.from("intake_clients").update({
      record: updated as unknown as Record<string, unknown>,
    }).eq("id", body.clientId);
    return json({ fileProfile, pricingRecommendation, record: updated });
  }

  return json({ fileProfile, pricingRecommendation, pure: true });
});
