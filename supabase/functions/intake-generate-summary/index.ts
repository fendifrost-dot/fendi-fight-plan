import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, requireOperator } from "../_shared/intake-auth.ts";
import type { IntakeClientRecord } from "../_shared/intake-types.ts";
import { mergeRecordJson, recomputeDerivedFields } from "../_shared/intake-record-helpers.ts";
import {
  buildClientSummaryDocx,
  buildOperatorPricingCardDocx,
  buildSimpleOperatorCardPdf,
  buildSimpleSummaryPdf,
} from "../_shared/intake-doc-generate.ts";

const BUCKET = "intake-artifacts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as { clientId?: string; operatorUserId?: string };

  const auth = await requireOperator(req, body);
  if (!auth.ok) return new Response(auth.response.body, { status: auth.response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!body.clientId) return json({ error: "clientId required" }, 400);

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
  if (!rec.pricingApproved) {
    return json({ error: "pricingApproved required before document generation" }, 400);
  }

  const prefix = `${auth.userId}/${body.clientId}`;
  const summaryDocx = await buildClientSummaryDocx(rec);
  const summaryPdf = await buildSimpleSummaryPdf(rec);
  const cardDocx = await buildOperatorPricingCardDocx(rec);
  const cardPdf = await buildSimpleOperatorCardPdf(rec);

  const paths = {
    clientSummaryDocx: `${prefix}/${body.clientId}_Credit_Analysis_Summary.docx`,
    clientSummaryPdf: `${prefix}/${body.clientId}_Credit_Analysis_Summary.pdf`,
    operatorPricingCardDocx: `${prefix}/${body.clientId}_Operator_Pricing_Card_INTERNAL.docx`,
    operatorPricingCardPdf: `${prefix}/${body.clientId}_Operator_Pricing_Card_INTERNAL.pdf`,
  };

  const uploads: Array<{ path: string; data: Uint8Array; type: string }> = [
    { path: paths.clientSummaryDocx, data: summaryDocx, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { path: paths.clientSummaryPdf, data: summaryPdf, type: "application/pdf" },
    { path: paths.operatorPricingCardDocx, data: cardDocx, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { path: paths.operatorPricingCardPdf, data: cardPdf, type: "application/pdf" },
  ];

  for (const u of uploads) {
    const { error: up } = await admin.storage.from(BUCKET).upload(u.path, u.data, {
      contentType: u.type,
      upsert: true,
    });
    if (up) return json({ error: `Storage upload failed: ${up.message}` }, 500);
  }

  rec = recomputeDerivedFields(
    mergeRecordJson(rec, {
      status: "doc_generated",
      artifacts: paths,
    }),
  );

  const { error: upRow } = await admin.from("intake_clients").update({
    record: rec as unknown as Record<string, unknown>,
    status: rec.status,
  }).eq("id", body.clientId);

  if (upRow) return json({ error: upRow.message }, 500);

  return json({ clientId: body.clientId, artifacts: paths, record: rec });
});
