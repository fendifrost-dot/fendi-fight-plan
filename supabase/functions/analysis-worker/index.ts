import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_IMAGES_PER_CHUNK = 3;
const AI_TIMEOUT_MS = 25000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const STORAGE_BUCKET = "analysis-images";

interface Job {
  id: string;
  user_id: string;
  status: string;
  step: string;
  progress: number;
  attempt_count: number;
  max_attempts: number;
  input_data: {
    storagePaths: string[];
    questionnaire: any;
    reportType: string;
    totalPages: number;
  };
  checkpoints: {
    documentMap?: any;
    accounts?: any[];
    processedChunks?: number;
    totalChunks?: number;
    failedChunks?: number[];
  };
}

// ---- Structured error helpers (mirrors src/lib/pipelineError.ts shape) ----
interface StructuredError {
  code: string;
  message: string;
  stage: string;
  step?: string;
  chunk?: number;
  page?: number;
  cause?: string;
}

function safeCause(cause: any): string {
  try {
    const str = typeof cause === "string" ? cause : JSON.stringify(cause);
    return str.replace(/eyJ[A-Za-z0-9_-]{10,}/g, "[REDACTED]").slice(0, 500);
  } catch {
    return "Unstringifiable error";
  }
}

function classifyWorkerError(err: Error, step?: string, chunk?: number): StructuredError {
  const msg = err.message || String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("failed to download")) {
    return { code: "WORKER_DOWNLOAD_FAILED", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg) };
  }
  if (lower.includes("base64") || lower.includes("call stack") || lower.includes("fromcharcode")) {
    return { code: "WORKER_BASE64_ENCODE_FAILED", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg) };
  }
  if (lower.includes("abort") || lower.includes("timeout")) {
    return { code: "WORKER_AI_TIMEOUT", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg) };
  }
  if (lower.includes("ai error") || lower.includes("json")) {
    return { code: "WORKER_AI_BAD_RESPONSE", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg) };
  }
  return { code: "UNKNOWN", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg) };
}

async function heartbeat(client: any, jobId: string) {
  const now = new Date().toISOString();
  const { error } = await client.from("analysis_jobs").update({
    last_heartbeat_at: now,
    updated_at: now,
  }).eq("id", jobId);
  if (error) console.error(`Heartbeat failed for ${jobId}:`, error);
}

async function updateJob(client: any, jobId: string, updates: Record<string, any>) {
  const { error } = await client.from("analysis_jobs").update({
    ...updates,
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);

  if (error) {
    console.error(`Failed to update job ${jobId}:`, error);
  }
}

async function failJob(client: any, jobId: string, se: StructuredError) {
  await updateJob(client, jobId, {
    status: "FAILED",
    error_code: se.code,
    error_message: se.message,
    error_stage: se.stage,
    error_meta: { step: se.step, chunk: se.chunk, page: se.page, cause: se.cause },
  });
}

async function downloadImageAsDataUrl(client: any, objectName: string): Promise<string> {
  const { data, error } = await client.storage
    .from(STORAGE_BUCKET)
    .download(objectName);

  if (error || !data) {
    throw new Error(`Failed to download ${objectName}: ${error?.message || 'no data'}`);
  }

  const buffer = new Uint8Array(await data.arrayBuffer());
  const CHUNK_SIZE = 32768;
  let base64 = '';
  for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
    const chunk = buffer.subarray(i, i + CHUNK_SIZE);
    base64 += String.fromCharCode(...chunk);
  }
  base64 = btoa(base64);

  return `data:image/jpeg;base64,${base64}`;
}

async function cleanupJobStorage(client: any, userId: string, jobId: string) {
  try {
    const prefix = `${userId}/${jobId}`;
    const { data: files, error: listError } = await client.storage
      .from(STORAGE_BUCKET)
      .list(prefix, { limit: 500 });

    if (listError || !files || files.length === 0) {
      console.log(`No storage files to clean up for ${prefix}`);
      return;
    }

    const paths = files.map((f: any) => `${prefix}/${f.name}`);
    const { error: removeError } = await client.storage
      .from(STORAGE_BUCKET)
      .remove(paths);

    if (removeError) {
      console.error(`Failed to clean up storage for ${prefix}:`, removeError);
    } else {
      console.log(`Cleaned up ${paths.length} storage objects for job ${jobId}`);
    }
  } catch (err) {
    console.error(`Storage cleanup error for job ${jobId}:`, err);
  }
}

async function callAIWithTimeout(apiKey: string, messages: any[], timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return JSON.parse(data.choices?.[0]?.message?.content || "{}");
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function callAIWithRetry(apiKey: string, messages: any[], retries = MAX_RETRIES): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callAIWithTimeout(apiKey, messages, AI_TIMEOUT_MS);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`AI call attempt ${attempt + 1} failed:`, lastError.message);

      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

  const client = createClient(supabaseUrl, supabaseServiceKey);
  let parsedJobId: string | null = null;

  try {
    const { jobId } = await req.json();
    parsedJobId = jobId;

    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job, error: fetchError } = await client
      .from("analysis_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (fetchError || !job) {
      console.error("Job not found:", jobId);
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (job.status === "DONE" || job.status === "RUNNING") {
      return new Response(JSON.stringify({ status: job.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await updateJob(client, jobId, {
      status: "RUNNING",
      step: "mapping",
      started_at: new Date().toISOString(),
      attempt_count: (job.attempt_count || 0) + 1,
      // Clear previous error state on retry
      error_code: null,
      error_message: null,
      error_stage: null,
      error_meta: null,
    });

    const inputData = job.input_data as Job["input_data"];
    const checkpoints = (job.checkpoints || {}) as Job["checkpoints"];
    const storagePaths = inputData.storagePaths;

    // Step 1: Document Mapping
    let documentMap = checkpoints.documentMap;
    if (!documentMap) {
      try {
        await updateJob(client, jobId, { step: "map_document", progress: 5 });

        const totalPages = storagePaths.length;
        const sampleIndices: number[] = [];
        for (let i = 0; i < Math.min(5, totalPages); i++) {
          sampleIndices.push(i);
        }
        if (totalPages > 7) {
          sampleIndices.push(totalPages - 2);
          sampleIndices.push(totalPages - 1);
        }

        const sampleImages: string[] = [];
        for (const idx of sampleIndices) {
          try {
            const dataUrl = await downloadImageAsDataUrl(client, storagePaths[idx]);
            sampleImages.push(dataUrl);
          } catch (dlErr) {
            const se = classifyWorkerError(dlErr instanceof Error ? dlErr : new Error(String(dlErr)), `download_page_${idx}`, undefined);
            se.page = idx;
            await failJob(client, jobId, se);
            await cleanupJobStorage(client, job.user_id, jobId);
            return new Response(JSON.stringify({ error: se }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        const mapPrompt = `Analyze these credit report sample pages and output a JSON document map with sections: personal_info, accounts, inquiries, payment_history, public_records, summary. For each: detected (boolean), start_page (1-indexed), end_page (1-indexed). Also output: is_multi_bureau, detected_bureaus, total_pages: ${storagePaths.length}, report_type.`;

        const userContent: any[] = [{ type: "text", text: mapPrompt }];
        for (const img of sampleImages) {
          userContent.push({ type: "image_url", image_url: { url: img } });
        }

        documentMap = await callAIWithRetry(lovableApiKey, [
          { role: "system", content: "You are a document structure analyzer. Output JSON only." },
          { role: "user", content: userContent },
        ]);

        documentMap.total_pages = storagePaths.length;

        await updateJob(client, jobId, {
          checkpoints: { ...checkpoints, documentMap },
          progress: 15,
        });
      } catch (error) {
        console.error("Document mapping failed:", error);
        // Non-fatal: fall back to analyzing all pages
        documentMap = {
          is_multi_bureau: false,
          detected_bureaus: [],
          total_pages: storagePaths.length,
          sections: {
            accounts: { detected: true, start_page: 1, end_page: storagePaths.length, page_count: storagePaths.length },
          },
        };
        await updateJob(client, jobId, {
          checkpoints: { ...checkpoints, documentMap },
        });
      }
    }

    // Step 2: Chunk and analyze accounts
    await updateJob(client, jobId, { step: "analyzing", progress: 20 });

    const accountsSection = documentMap.sections?.accounts || { start_page: 1, end_page: storagePaths.length };
    const startIdx = (accountsSection.start_page || 1) - 1;
    const endIdx = accountsSection.end_page || storagePaths.length;
    const sectionPaths = storagePaths.slice(startIdx, endIdx);

    const chunks: string[][] = [];
    for (let i = 0; i < sectionPaths.length; i += MAX_IMAGES_PER_CHUNK) {
      chunks.push(sectionPaths.slice(i, i + MAX_IMAGES_PER_CHUNK));
    }

    const totalChunks = chunks.length;
    let processedChunks = checkpoints.processedChunks || 0;
    const allAccounts: any[] = checkpoints.accounts || [];
    const failedChunks: number[] = checkpoints.failedChunks || [];

    const accountsPrompt = `Extract ALL accounts from these credit report pages. Output JSON: { "accounts": [{ "creditor_name": "...", "account_number": "XXXX...", "date_opened": "MM/YYYY", "status": "...", "balance": "$X,XXX", "derogatory_triggers": [], "bureaus": [] }] }`;

    for (let i = processedChunks; i < chunks.length; i++) {
      const progressPct = 20 + Math.round((i / totalChunks) * 70);
      await updateJob(client, jobId, {
        step: `chunk_${i + 1}_of_${totalChunks}`,
        progress: progressPct,
        checkpoints: { documentMap, accounts: allAccounts, processedChunks: i, totalChunks, failedChunks },
      });

      try {
        await heartbeat(client, jobId);

        const chunkImages: string[] = [];
        for (const path of chunks[i]) {
          const dataUrl = await downloadImageAsDataUrl(client, path);
          chunkImages.push(dataUrl);
        }

        await heartbeat(client, jobId);

        const userContent: any[] = [
          { type: "text", text: `Analyze chunk ${i + 1} of ${totalChunks}. ${accountsPrompt}` },
        ];
        for (const img of chunkImages) {
          userContent.push({ type: "image_url", image_url: { url: img } });
        }

        const result = await callAIWithRetry(lovableApiKey, [
          { role: "system", content: "Extract credit account data. Output valid JSON only." },
          { role: "user", content: userContent },
        ]);

        await heartbeat(client, jobId);

        if (result.accounts && Array.isArray(result.accounts)) {
          allAccounts.push(...result.accounts);
        }

        processedChunks = i + 1;
      } catch (error) {
        const se = classifyWorkerError(error instanceof Error ? error : new Error(String(error)), `chunk_${i + 1}`, i);
        console.error(`Chunk ${i + 1} failed [${se.code}]:`, se.message);
        failedChunks.push(i);
      }

      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Step 3: Normalize and deduplicate
    await updateJob(client, jobId, { step: "normalizing", progress: 92 });

    const seenAccounts = new Map<string, any>();
    for (const acc of allAccounts) {
      const key = `${acc.creditor_name || ""}_${acc.account_number || ""}`.toLowerCase();
      if (!seenAccounts.has(key)) {
        seenAccounts.set(key, {
          id: crypto.randomUUID(),
          creditorName: acc.creditor_name || "Unknown",
          maskedAccountNumber: acc.account_number || "Unknown",
          dateOpened: acc.date_opened,
          status: acc.status,
          balance: acc.balance,
          derogatoryTriggers: acc.derogatory_triggers || [],
          bureaus: acc.bureaus || [],
          confidence: 0.8,
        });
      }
    }

    const normalizedAccounts = Array.from(seenAccounts.values());

    const finalStatus = failedChunks.length > 0 && normalizedAccounts.length === 0 ? "FAILED" :
                         failedChunks.length > 0 ? "PARTIAL" : "DONE";

    const resultData = {
      accounts: normalizedAccounts,
      documentMap,
      totalPages: storagePaths.length,
      processedChunks,
      totalChunks,
      failedChunks,
    };

    const errorFields: Record<string, any> = {};
    if (finalStatus === "FAILED") {
      errorFields.error_code = "WORKER_ALL_CHUNKS_FAILED";
      errorFields.error_message = `All ${totalChunks} chunk(s) failed during analysis`;
      errorFields.error_stage = "WORKER";
      errorFields.error_meta = { failedChunks, totalChunks };
    } else if (finalStatus === "PARTIAL") {
      errorFields.error_code = "WORKER_PARTIAL_CHUNKS_FAILED";
      errorFields.error_message = `${failedChunks.length} of ${totalChunks} chunk(s) failed`;
      errorFields.error_stage = "WORKER";
      errorFields.error_meta = { failedChunks, totalChunks };
    }

    await updateJob(client, jobId, {
      status: finalStatus,
      step: "complete",
      progress: 100,
      result_data: resultData,
      checkpoints: { documentMap, accounts: normalizedAccounts, processedChunks, totalChunks, failedChunks },
      completed_at: new Date().toISOString(),
      ...errorFields,
    });

    await cleanupJobStorage(client, job.user_id, jobId);

    console.log(`Job ${jobId} completed with status ${finalStatus}. Found ${normalizedAccounts.length} accounts. Storage cleaned.`);

    return new Response(JSON.stringify({ status: finalStatus, accountCount: normalizedAccounts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Worker error:", error);

    if (parsedJobId) {
      try {
        const se = classifyWorkerError(error instanceof Error ? error : new Error(String(error)), "top_level");
        se.code = se.code || "UNKNOWN";

        const { data: failedJob } = await client
          .from("analysis_jobs")
          .select("user_id")
          .eq("id", parsedJobId)
          .maybeSingle();

        await failJob(client, parsedJobId, se);

        if (failedJob?.user_id) {
          await cleanupJobStorage(client, failedJob.user_id, parsedJobId);
        }
      } catch {}
    }

    return new Response(JSON.stringify({ error: "Worker failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
