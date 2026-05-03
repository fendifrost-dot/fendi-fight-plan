import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireOperator } from "../_shared/intake-auth.ts";
import type { IntakeCanonical, IntakeClientRecord } from "../_shared/intake-types.ts";
import { parseCanonicalNameParts } from "../_shared/intake-normalize.ts";
import {
  emptyBureauReportedPulled,
  recomputeDerivedFields,
} from "../_shared/intake-record-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { canonical: IntakeCanonical; operatorUserId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const auth = await requireOperator(req, body);
  if (!auth.ok) return new Response(auth.response.body, { status: auth.response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const c = body.canonical;
  if (!c?.legalName?.trim() || !c.dob || !c.currentAddress?.line1 || !c.phone || !c.email) {
    return json({ error: "Missing required canonical fields" }, 400);
  }

  const parts = parseCanonicalNameParts(c.legalName);
  const canonical: IntakeCanonical = {
    ...c,
    legalNameFirst: c.legalNameFirst || parts.first,
    legalNameMiddle: c.legalNameMiddle ?? parts.middle,
    legalNameLast: c.legalNameLast || parts.last,
  };

  const serviceUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(serviceUrl, serviceKey);

  const createdAt = new Date().toISOString();
  const clientId = crypto.randomUUID();

  const base: IntakeClientRecord = {
    clientId,
    createdAt,
    intakeOperatorId: auth.userId,
    status: "intake",
    canonical,
    bureauReported: emptyBureauReportedPulled(),
    identityReconciliation: {
      nameMatch: { matches: true },
      addressMatch: { matches: true },
      employerMatch: { matches: true },
      dobMatch: { matches: true },
    },
    fileProfile: {
      chargeOffs: 0,
      collections: 0,
      publicRecords: 0,
      lateAccountsExcludingCO: 0,
      hardInquiries: 0,
    },
    pricingRecommendation: { score: 0, tier: { name: "Tier 1 — Light", low: 750, high: 1000 } },
    artifacts: {},
  };

  const record = recomputeDerivedFields(base);

  const { data, error } = await admin.from("intake_clients").insert({
    id: clientId,
    intake_operator_id: auth.userId,
    status: record.status,
    record: record as unknown as Record<string, unknown>,
  }).select("id").single();

  if (error) return json({ error: error.message }, 500);

  return json({ clientId: data.id, record });
});
