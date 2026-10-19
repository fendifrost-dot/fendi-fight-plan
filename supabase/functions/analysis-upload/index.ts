/**
 * Store a bureau report for an enrolled agent and, by default, queue analysis.
 *
 * Hub mode only (x-api-key + x-operator-user-id), same as analysis-start.
 * PDFs are read with pdf.js text extraction on the edge runtime. Page images
 * are stored as-is. Text is chunked into the analysis-images bucket under the
 * staff member's prefix, then analysis-start creates the job the app already polls.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor } from "../_shared/staff-cors.ts";
import { hubDenied, hubUser, resolveHubCaller } from "../_shared/hub-caller.ts";
import { extractPdfDocument } from "../_shared/intake-pdf-text.ts";
import { parseBureauReportText } from "../_shared/intake-bureau-parse.ts";
import { mergeRecordJson, recomputeDerivedFields } from "../_shared/intake-record-helpers.ts";
import type { IntakeClientRecord } from "../_shared/intake-types.ts";
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_TEXT_CHUNKS,
  chunkObjectPath,
  chunkReportText,
  decodeBase64Bytes,
  estimatePageCount,
  extensionForMime,
  pageObjectPath,
  parseBureauUploadArgs,
  sniffImage,
  sniffPdf,
  sourcePdfObjectPath,
  splitEncodedPayload,
  textFirstViable,
  validatePublicHttpsUrl,
  type ParsedBureauUpload,
} from "../_shared/bureauReportUpload.ts";

const BUCKET = "analysis-images";

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isFail(value: unknown): value is { ok: false; error: string } {
  return !!value && typeof value === "object" && "ok" in value && (value as { ok: boolean }).ok === false;
}

async function readBounded(resp: Response, maxBytes: number): Promise<Uint8Array | { error: string }> {
  const declared = Number(resp.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { error: "pdf is larger than 20 MB" };
  const reader = resp.body?.getReader();
  if (!reader) return { error: "pdf_url returned an empty body" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { error: "pdf is larger than 20 MB" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchPublicPdf(rawUrl: string): Promise<Uint8Array | { error: string }> {
  let current = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    const checked = validatePublicHttpsUrl(current);
    if (!checked.ok) return { error: checked.error };
    let resp: Response;
    try {
      resp = await fetch(checked.value, {
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: { accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1" },
      });
    } catch {
      return { error: "pdf_url could not be fetched" };
    }
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) return { error: "pdf_url redirect was missing a location" };
      current = new URL(location, checked.value).toString();
      continue;
    }
    if (!resp.ok) return { error: `pdf_url returned ${resp.status}` };
    const bytes = await readBounded(resp, MAX_PDF_BYTES);
    if ("error" in bytes && !(bytes instanceof Uint8Array)) return bytes;
    if (!(bytes instanceof Uint8Array)) return { error: "pdf_url returned an empty body" };
    if (!sniffPdf(bytes)) return { error: "pdf_url did not return a PDF" };
    return bytes;
  }
  return { error: "pdf_url redirected too many times" };
}

function decodePdf(encoded: string): Uint8Array | { error: string } {
  const split = splitEncodedPayload(encoded);
  if (isFail(split)) return { error: split.error };
  const bytes = decodeBase64Bytes(split.base64);
  if (isFail(bytes)) return { error: "pdf_base64 is not valid base64" };
  if (bytes.byteLength > MAX_PDF_BYTES) return { error: "pdf is larger than 20 MB" };
  if (!sniffPdf(bytes)) return { error: "pdf_base64 is not a PDF" };
  return bytes;
}

function decodeImage(encoded: string): { bytes: Uint8Array; mime: "image/jpeg" | "image/png" | "image/webp" } | { error: string } {
  const split = splitEncodedPayload(encoded);
  if (isFail(split)) return { error: split.error };
  const bytes = decodeBase64Bytes(split.base64);
  if (isFail(bytes)) return { error: "page image is not valid base64" };
  const mime = sniffImage(bytes);
  if (!mime) return { error: "page image must be jpeg, png, or webp" };
  return { bytes, mime };
}

async function uploadObject(
  admin: ReturnType<typeof createClient>,
  path: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<{ error: string } | null> {
  const payload = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const file = new Blob([payload], { type: contentType });
  const { error } = await admin.storage.from(BUCKET).upload(path, file, { contentType, upsert: false });
  if (error) return { error: error.message };
  return null;
}

async function saveIntakeExtract(
  admin: ReturnType<typeof createClient>,
  clientId: string,
  bureau: ParsedBureauUpload["bureau"],
  text: string,
): Promise<{ saved: boolean; warning?: string }> {
  const { data: row, error } = await admin
    .from("intake_clients")
    .select("id, record, bureau_raw_extracts, status")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { saved: false, warning: "intake client could not be read" };
  if (!row) return { saved: false, warning: "intake client was not found" };

  const extracts = {
    ...(row.bureau_raw_extracts && typeof row.bureau_raw_extracts === "object" ? row.bureau_raw_extracts : {}),
    [bureau]: text,
  };
  const pulledAt = new Date().toISOString();
  const record = (row.record && typeof row.record === "object" ? row.record : {}) as IntakeClientRecord;
  let nextRecord: IntakeClientRecord | Record<string, unknown> = record;
  try {
    const bureauReported = {
      ...(record.bureauReported ?? {}),
      [bureau]: parseBureauReportText(text),
      pulledAt: { ...(record.bureauReported?.pulledAt ?? {}), [bureau]: pulledAt },
    };
    nextRecord = recomputeDerivedFields(mergeRecordJson(record, { bureauReported } as Partial<IntakeClientRecord>));
  } catch (err) {
    console.error("intake snapshot skipped", err instanceof Error ? err.name : "error");
    nextRecord = record;
  }

  const { error: updateError } = await admin
    .from("intake_clients")
    .update({
      record: nextRecord as Record<string, unknown>,
      bureau_raw_extracts: extracts,
      status: typeof (nextRecord as IntakeClientRecord).status === "string" ? (nextRecord as IntakeClientRecord).status : row.status,
    })
    .eq("id", clientId);
  if (updateError) return { saved: false, warning: "intake extract was not saved" };
  return { saved: true };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  try {
    const hub = await resolveHubCaller(req);
    if (hub && hub.ok === false) return hubDenied(hub, cors);
    if (!hub) return json({ error: "Authentication required" }, 401, cors);
    const { user } = hubUser(hub).data;

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "expected a JSON object" }, 400, cors);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "expected JSON" }, 400, cors);
    }

    const parsed = parseBureauUploadArgs(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400, cors);
    const upload = parsed.value;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const hubKey = Deno.env.get("FANFUEL_HUB_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return json({ error: "service is not configured" }, 500, cors);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    if (upload.sessionId) {
      const { data: session, error } = await admin
        .from("dispute_sessions")
        .select("id, user_id")
        .eq("id", upload.sessionId)
        .maybeSingle();
      if (error) return json({ error: "assessment could not be read" }, 500, cors);
      if (!session) return json({ error: "assessment was not found" }, 404, cors);
      if (session.user_id !== user.id) return json({ error: "assessment belongs to another staff member" }, 403, cors);
    }

    if (upload.clientId) {
      const { data: client, error } = await admin.from("intake_clients").select("id").eq("id", upload.clientId).maybeSingle();
      if (error) return json({ error: "intake client could not be read" }, 500, cors);
      if (!client) return json({ error: "intake client was not found" }, 404, cors);
    }

    let pdfBytes: Uint8Array | null = null;
    if (upload.pdfBase64) {
      const decoded = decodePdf(upload.pdfBase64);
      if ("error" in decoded) return json({ error: decoded.error }, 400, cors);
      pdfBytes = decoded;
    } else if (upload.pdfUrl) {
      const fetched = await fetchPublicPdf(upload.pdfUrl);
      if ("error" in fetched) return json({ error: fetched.error }, 400, cors);
      pdfBytes = fetched;
    }

    let pdfDocument: { pageCount: number; text: string } | null = null;
    if (pdfBytes) {
      try {
        pdfDocument = await extractPdfDocument(pdfBytes);
      } catch (err) {
        console.error("pdf text extraction failed", err instanceof Error ? err.name : "error");
        return json({ error: "could not read the PDF" }, 422, cors);
      }
      if (pdfDocument.pageCount < 1 || pdfDocument.pageCount > MAX_PDF_PAGES) {
        return json({ error: `PDF must be 1 to ${MAX_PDF_PAGES} pages` }, 422, cors);
      }
    }

    const pdfViability = pdfDocument ? textFirstViable(pdfDocument.text, pdfDocument.pageCount) : null;
    const pastedViability = upload.reportText ? textFirstViable(upload.reportText, estimatePageCount(upload.reportText)) : null;

    let inputMode: "text" | "images";
    let analysisText = "";
    let pageCount = 0;
    if (pdfViability?.viable && pdfDocument) {
      inputMode = "text";
      analysisText = pdfDocument.text;
      pageCount = pdfDocument.pageCount;
    } else if (pastedViability?.viable && upload.reportText) {
      inputMode = "text";
      analysisText = upload.reportText;
      pageCount = estimatePageCount(upload.reportText);
    } else if (upload.pageImages && upload.pageImages.length > 0) {
      inputMode = "images";
      pageCount = upload.pageImages.length;
    } else if (pdfDocument) {
      return json({
        error: "This PDF has almost no extractable text, so it looks scanned. Send page_images (jpeg, png, or webp, 5 MB each) or report_text.",
      }, 422, cors);
    } else {
      return json({
        error: "report_text is too thin to analyze. Send the PDF or page images.",
      }, 422, cors);
    }

    const uploadId = crypto.randomUUID();
    const storagePaths: string[] = [];
    let sourcePdfPath: string | null = null;
    let sourcePdfStored = false;

    if (pdfBytes) {
      sourcePdfPath = sourcePdfObjectPath(user.id, uploadId);
      const saved = await uploadObject(admin, sourcePdfPath, pdfBytes, "application/pdf");
      sourcePdfStored = !saved;
      if (saved) {
        console.error("source pdf was not stored", saved.error.slice(0, 180));
        sourcePdfPath = null;
      }
    }

    if (inputMode === "text") {
      const chunks = chunkReportText(analysisText);
      if (chunks.length === 0) return json({ error: "report text was empty after cleanup" }, 422, cors);
      if (chunks.length > MAX_TEXT_CHUNKS) return json({ error: "report text is too long to analyze" }, 422, cors);
      for (let i = 0; i < chunks.length; i++) {
        const path = chunkObjectPath(user.id, uploadId, i + 1);
        const saved = await uploadObject(admin, path, chunks[i], "text/plain");
        if (saved) {
          if (storagePaths.length > 0) await admin.storage.from(BUCKET).remove(storagePaths);
          return json({ error: "could not store the report text" }, 500, cors);
        }
        storagePaths.push(path);
      }
    } else {
      const images = upload.pageImages ?? [];
      for (let i = 0; i < images.length; i++) {
        const decoded = decodeImage(images[i]);
        if ("error" in decoded) {
          if (storagePaths.length > 0) await admin.storage.from(BUCKET).remove(storagePaths);
          return json({ error: decoded.error }, 400, cors);
        }
        const path = pageObjectPath(user.id, uploadId, i + 1, extensionForMime(decoded.mime));
        const saved = await uploadObject(admin, path, decoded.bytes, decoded.mime);
        if (saved) {
          if (storagePaths.length > 0) await admin.storage.from(BUCKET).remove(storagePaths);
          return json({ error: "could not store a page image" }, 500, cors);
        }
        storagePaths.push(path);
      }
    }

    let intakeSaved = false;
    let warning: string | undefined;
    if (upload.clientId && analysisText) {
      const intake = await saveIntakeExtract(admin, upload.clientId, upload.bureau, analysisText);
      intakeSaved = intake.saved;
      warning = intake.warning;
    }

    const response = {
      bureau: upload.bureau,
      session_id: upload.sessionId ?? null,
      client_id: upload.clientId ?? null,
      input_mode: inputMode,
      page_count: pageCount,
      text_chars: analysisText.length,
      storage_paths: storagePaths,
      source_pdf_path: sourcePdfPath,
      source_pdf_stored: sourcePdfStored,
      upload_id: uploadId,
      filename: upload.filename ?? null,
      queued: false,
      job_id: null as string | null,
      status: null as string | null,
      intake_saved: intakeSaved,
      warning: warning ?? null,
    };

    if (!upload.queue) return json(response, 200, cors);
    if (!hubKey) return json({ ...response, warning: "hub key is not configured, so the job was not started" }, 200, cors);

    const startResp = await fetch(`${supabaseUrl}/functions/v1/analysis-start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": hubKey,
        "x-operator-user-id": user.id,
      },
      body: JSON.stringify({
        sessionId: upload.sessionId,
        storagePaths,
        questionnaire: upload.questionnaire ?? {},
        reportType: upload.reportType || upload.bureau,
        inputMode,
        totalPages: pageCount,
        bureau: upload.bureau,
        clientId: upload.clientId,
        sourcePdfPath,
        textChars: analysisText.length,
        source: "agent_upload",
      }),
    });
    let startBody: Record<string, unknown> | null = null;
    try {
      const parsedBody = await startResp.json();
      startBody = parsedBody && typeof parsedBody === "object" ? parsedBody as Record<string, unknown> : null;
    } catch {
      startBody = null;
    }
    if (!startResp.ok || typeof startBody?.jobId !== "string") {
      const message = startBody && typeof startBody.error === "string"
        ? startBody.error
        : startBody && startBody.error && typeof startBody.error === "object" && typeof (startBody.error as { message?: string }).message === "string"
          ? (startBody.error as { message: string }).message
          : "analysis job was not started";
      return json({ ...response, warning: message }, 200, cors);
    }

    return json({
      ...response,
      queued: true,
      job_id: startBody.jobId,
      status: typeof startBody.status === "string" ? startBody.status : "QUEUED",
    }, 200, cors);
  } catch (err) {
    console.error("analysis-upload failed", err instanceof Error ? err.name : "error");
    return json({ error: "could not store the bureau report" }, 500, cors);
  }
});
