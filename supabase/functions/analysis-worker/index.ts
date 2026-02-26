import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Build fingerprint — proves THIS code is deployed
console.log("ANALYSIS_WORKER_BUILD", { version: "chain_bugs_fixed_v2", abortControllerSelfChain: true, sendsStartChunk: true, deterministicChainLogs: true });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_IMAGES_PER_CHUNK = 3;
const AI_TIMEOUT_MS = 25000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const STORAGE_BUCKET = "analysis-images";
const CHUNK_RETRY_BACKOFF_MS = 3000;

// Self-chaining: max chunks per invocation to stay within edge function wall clock (~150s)
// Each chunk ~30-45s (download + AI), so 3 chunks ≈ 90-135s safely within limits
const MAX_CHUNKS_PER_INVOCATION = 3;

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
    chunkTimings?: ChunkTiming[];
  };
}

interface ChunkTiming {
  chunkIndex: number;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  status: "ok" | "failed" | "retried_ok" | "retried_failed";
  error?: string;
  retryElapsedMs?: number;
}

interface StructuredError {
  code: string;
  message: string;
  stage: string;
  step?: string;
  chunk?: number;
  page?: number;
  cause?: string;
  where?: string;
  elapsedMs?: number;
  lastHeartbeatAt?: string;
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
    return { code: "WORKER_DOWNLOAD_FAILED", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg), where: "edge_fn" };
  }
  if (lower.includes("base64") || lower.includes("call stack") || lower.includes("fromcharcode")) {
    return { code: "WORKER_BASE64_ENCODE_FAILED", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg), where: "edge_fn" };
  }
  if (lower.includes("abort") || lower.includes("timeout") || lower.includes("signal")) {
    return { code: "WORKER_AI_TIMEOUT", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg), where: "model_call" };
  }
  if (lower.includes("ai error") || lower.includes("json")) {
    return { code: "WORKER_AI_BAD_RESPONSE", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg), where: "model_call" };
  }
  return { code: "UNKNOWN", message: msg, stage: "WORKER", step, chunk, cause: safeCause(msg), where: "edge_fn" };
}

async function heartbeat(client: any, jobId: string, extra?: Record<string, any>) {
  const now = new Date().toISOString();
  const updates: Record<string, any> = {
    last_heartbeat_at: now,
    updated_at: now,
  };
  if (extra) Object.assign(updates, extra);

  const { error } = await client.from("analysis_jobs").update(updates).eq("id", jobId);
  if (error) console.error(`Heartbeat failed for ${jobId}:`, error);
  else console.log(`[heartbeat] job=${jobId} at=${now}${extra?.step ? ` step=${extra.step}` : ""}`);
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
    error_meta: { step: se.step, chunk: se.chunk, page: se.page, cause: se.cause, where: se.where, elapsedMs: se.elapsedMs },
    completed_at: new Date().toISOString(),
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

async function processChunk(
  client: any,
  jobId: string,
  lovableApiKey: string,
  chunkPaths: string[],
  chunkIndex: number,
  totalChunks: number,
  accountsPrompt: string,
): Promise<{ accounts: any[]; timing: ChunkTiming }> {
  const startedAt = new Date();

  console.log(`[chunk] job=${jobId} chunk=${chunkIndex + 1}/${totalChunks} pages=${chunkPaths.length} started`);

  try {
    await heartbeat(client, jobId, { step: `chunk_${chunkIndex + 1}_download` });

    const chunkImages: string[] = [];
    for (const path of chunkPaths) {
      const dataUrl = await downloadImageAsDataUrl(client, path);
      chunkImages.push(dataUrl);
    }

    await heartbeat(client, jobId, { step: `chunk_${chunkIndex + 1}_ai_call` });

    const userContent: any[] = [
      { type: "text", text: `Analyze chunk ${chunkIndex + 1} of ${totalChunks}. ${accountsPrompt}` },
    ];
    for (const img of chunkImages) {
      userContent.push({ type: "image_url", image_url: { url: img } });
    }

    const result = await callAIWithRetry(lovableApiKey, [
      { role: "system", content: "Extract credit account data. Output valid JSON only." },
      { role: "user", content: userContent },
    ]);

    await heartbeat(client, jobId, { step: `chunk_${chunkIndex + 1}_complete` });

    const endedAt = new Date();
    const elapsedMs = endedAt.getTime() - startedAt.getTime();

    console.log(`[chunk] job=${jobId} chunk=${chunkIndex + 1}/${totalChunks} completed in ${elapsedMs}ms accounts=${result.accounts?.length || 0}`);

    return {
      accounts: result.accounts && Array.isArray(result.accounts) ? result.accounts : [],
      timing: {
        chunkIndex,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        elapsedMs,
        status: "ok",
      },
    };
  } catch (error) {
    const endedAt = new Date();
    const elapsedMs = endedAt.getTime() - startedAt.getTime();
    const errMsg = error instanceof Error ? error.message : String(error);

    console.error(`[chunk] job=${jobId} chunk=${chunkIndex + 1}/${totalChunks} FAILED in ${elapsedMs}ms: ${errMsg}`);

    throw {
      error,
      timing: {
        chunkIndex,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        elapsedMs,
        status: "failed" as const,
        error: errMsg.slice(0, 300),
      },
    };
  }
}

/**
 * Self-chain: re-invoke this worker for remaining chunks.
 * 
 * CRITICAL: Deno Deploy terminates the isolate when serve() returns the Response.
 * A fire-and-forget fetch + sleep(200ms) is NOT reliable — the TCP handshake
 * may not complete before the isolate is killed, causing the chain to silently fail.
 * 
 * Fix: Use AbortController with a 2s timeout. We AWAIT the fetch, which guarantees
 * the request is fully sent. The abort kills the response-wait (not the request),
 * so the next invocation starts processing while this one exits cleanly.
 */
async function selfChain(supabaseUrl: string, serviceKey: string, jobId: string, nextChunk: number, invocationId: string) {
  const workerUrl = `${supabaseUrl}/functions/v1/analysis-worker`;
  console.log("CHAIN_DISPATCH", { jobId, nextChunk, invocationId });

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 2000);

  try {
    await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ jobId, startChunk: nextChunk }),
      signal: controller.signal,
    });
    clearTimeout(abortTimer);
    console.log("CHAIN_DISPATCH_SUCCESS", { jobId, nextChunk, invocationId });
  } catch (err) {
    clearTimeout(abortTimer);
    if (err instanceof DOMException && err.name === "AbortError") {
      console.log("CHAIN_DISPATCH_ABORTED", { jobId, nextChunk, invocationId, note: "request sent, abort killed response-wait (expected)" });
    } else {
      console.error("CHAIN_DISPATCH_FAILED", { jobId, nextChunk, invocationId, err: String(err) });
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const invocationStartedAt = Date.now();
  const invocationId = crypto.randomUUID().slice(0, 8);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

  const client = createClient(supabaseUrl, supabaseServiceKey);
  let parsedJobId: string | null = null;

  try {
    const { jobId, startChunk } = await req.json();
    parsedJobId = jobId;

    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[worker] invocation start job=${jobId} invocationId=${invocationId}`);

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

    // Allow RUNNING status for self-chained continuations
    if (job.status === "DONE" || job.status === "FAILED" || job.status === "PARTIAL") {
      console.log(`[worker] job=${jobId} already terminal (${job.status}), skipping`);
      return new Response(JSON.stringify({ status: job.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isResume = job.status === "RUNNING";

    if (!isResume) {
      // Fresh start
      await updateJob(client, jobId, {
        status: "RUNNING",
        step: "mapping",
        started_at: new Date().toISOString(),
        attempt_count: (job.attempt_count || 0) + 1,
        error_code: null,
        error_message: null,
        error_stage: null,
        error_meta: null,
      });
    } else {
      // Self-chained continuation — just heartbeat
      await heartbeat(client, jobId, { step: "resuming" });
    }

    const inputData = job.input_data as Job["input_data"];
    const checkpoints = (job.checkpoints || {}) as Job["checkpoints"];
    const storagePaths = inputData.storagePaths;

    console.log(`[worker] job=${jobId} totalPages=${storagePaths.length} resume=${isResume} processedChunks=${checkpoints.processedChunks || 0}`);

    // Step 1: Document Mapping (skip if already done via checkpoints)
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
            se.elapsedMs = Date.now() - invocationStartedAt;
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

        console.log(`[worker] job=${jobId} document mapping complete`);
      } catch (error) {
        console.error(`[worker] job=${jobId} document mapping failed, using fallback:`, error);
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
    const resumeFromDb = checkpoints.processedChunks ?? 0;
    let processedChunks = Number.isFinite(startChunk) ? startChunk : resumeFromDb;
    const allAccounts: any[] = checkpoints.accounts || [];
    const failedChunks: number[] = checkpoints.failedChunks || [];
    const chunkTimings: ChunkTiming[] = checkpoints.chunkTimings || [];

    console.log("CHAIN_START", { jobId, startChunk: processedChunks, totalChunks, invocationId });

    if (processedChunks > 0) {
      console.log("CHAIN_RESUME", { jobId, resumedFrom: processedChunks, invocationId });
    }

    const accountsPrompt = `Extract ALL accounts from these credit report pages. Output JSON: { "accounts": [{ "creditor_name": "...", "account_number": "XXXX...", "date_opened": "MM/YYYY", "status": "...", "balance": "$X,XXX", "derogatory_triggers": [], "bureaus": [] }] }`;

    // Process up to MAX_CHUNKS_PER_INVOCATION chunks in this invocation
    let chunksProcessedThisInvocation = 0;

    for (let i = processedChunks; i < chunks.length; i++) {
      // Check if we should self-chain to avoid wall clock timeout
      if (chunksProcessedThisInvocation >= MAX_CHUNKS_PER_INVOCATION) {
        console.log(`[worker] job=${jobId} hit invocation limit (${MAX_CHUNKS_PER_INVOCATION} chunks), self-chaining for remaining ${totalChunks - i} chunks`);

        // Save checkpoint before chaining
        await updateJob(client, jobId, {
          step: `chaining_at_${i}_of_${totalChunks}`,
          progress: 20 + Math.round((i / totalChunks) * 70),
          checkpoints: { documentMap, accounts: allAccounts, processedChunks: i, totalChunks, failedChunks, chunkTimings },
        });

        // Fire off the next invocation
        await selfChain(supabaseUrl, supabaseServiceKey, jobId, i, invocationId);
        return new Response(null, { status: 202 });
      }

      const progressPct = 20 + Math.round((i / totalChunks) * 70);
      await updateJob(client, jobId, {
        step: `chunk_${i + 1}_of_${totalChunks}`,
        progress: progressPct,
        checkpoints: { documentMap, accounts: allAccounts, processedChunks: i, totalChunks, failedChunks, chunkTimings },
      });

      try {
        const result = await processChunk(client, jobId, lovableApiKey, chunks[i], i, totalChunks, accountsPrompt);
        allAccounts.push(...result.accounts);
        chunkTimings.push(result.timing);
        processedChunks = i + 1;
        chunksProcessedThisInvocation++;
      } catch (chunkErr: any) {
        const failedTiming: ChunkTiming = chunkErr.timing || {
          chunkIndex: i,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          elapsedMs: 0,
          status: "failed",
          error: String(chunkErr),
        };

        // Retry this chunk ONCE with backoff
        console.log(`[worker] job=${jobId} chunk=${i + 1} retrying after ${CHUNK_RETRY_BACKOFF_MS}ms backoff`);
        await new Promise(r => setTimeout(r, CHUNK_RETRY_BACKOFF_MS));
        await heartbeat(client, jobId, { step: `chunk_${i + 1}_retry` });

        try {
          const retryResult = await processChunk(client, jobId, lovableApiKey, chunks[i], i, totalChunks, accountsPrompt);
          allAccounts.push(...retryResult.accounts);

          const retryTiming: ChunkTiming = {
            ...retryResult.timing,
            status: "retried_ok",
            retryElapsedMs: retryResult.timing.elapsedMs,
          };
          chunkTimings.push(retryTiming);
          processedChunks = i + 1;
          chunksProcessedThisInvocation++;
          console.log(`[worker] job=${jobId} chunk=${i + 1} retry SUCCEEDED`);
        } catch (retryErr: any) {
          const retryFailedTiming: ChunkTiming = {
            ...failedTiming,
            status: "retried_failed",
            retryElapsedMs: retryErr.timing?.elapsedMs || 0,
          };
          chunkTimings.push(retryFailedTiming);

          const origError = chunkErr.error instanceof Error ? chunkErr.error : new Error(String(chunkErr));
          const se = classifyWorkerError(origError, `chunk_${i + 1}`, i);
          console.error(`[worker] job=${jobId} chunk=${i + 1} retry also FAILED [${se.code}]:`, se.message);
          failedChunks.push(i);
          processedChunks = i + 1;
          chunksProcessedThisInvocation++;
        }
      }

      // Save checkpoint after every chunk
      await updateJob(client, jobId, {
        checkpoints: { documentMap, accounts: allAccounts, processedChunks, totalChunks, failedChunks, chunkTimings },
      });

      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // All chunks done — finalize
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

    const totalElapsedMs = Date.now() - invocationStartedAt;

    const resultData = {
      accounts: normalizedAccounts,
      documentMap,
      totalPages: storagePaths.length,
      processedChunks,
      totalChunks,
      failedChunks,
      chunkTimings,
      workerElapsedMs: totalElapsedMs,
    };

    const errorFields: Record<string, any> = {};
    if (finalStatus === "FAILED") {
      errorFields.error_code = "WORKER_ALL_CHUNKS_FAILED";
      errorFields.error_message = `All ${totalChunks} chunk(s) failed during analysis`;
      errorFields.error_stage = "WORKER";
      errorFields.error_meta = { failedChunks, totalChunks, chunkTimings, workerElapsedMs: totalElapsedMs, where: "model_call" };
    } else if (finalStatus === "PARTIAL") {
      errorFields.error_code = "WORKER_PARTIAL_CHUNKS_FAILED";
      errorFields.error_message = `${failedChunks.length} of ${totalChunks} chunk(s) failed`;
      errorFields.error_stage = "WORKER";
      errorFields.error_meta = { failedChunks, totalChunks, chunkTimings, workerElapsedMs: totalElapsedMs, where: "model_call" };
    }

    await updateJob(client, jobId, {
      status: finalStatus,
      step: "complete",
      progress: 100,
      result_data: resultData,
      checkpoints: { documentMap, accounts: normalizedAccounts, processedChunks, totalChunks, failedChunks, chunkTimings },
      completed_at: new Date().toISOString(),
      ...errorFields,
    });

    await cleanupJobStorage(client, job.user_id, jobId);

    console.log(`[worker] job=${jobId} FINALIZED status=${finalStatus} accounts=${normalizedAccounts.length} elapsed=${totalElapsedMs}ms`);

    return new Response(JSON.stringify({ status: finalStatus, accountCount: normalizedAccounts.length, workerElapsedMs: totalElapsedMs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const elapsedMs = Date.now() - invocationStartedAt;
    console.error(`[worker] job=${parsedJobId} FATAL error after ${elapsedMs}ms:`, error);

    if (parsedJobId) {
      try {
        const se = classifyWorkerError(error instanceof Error ? error : new Error(String(error)), "top_level");
        se.code = se.code || "UNKNOWN";
        se.elapsedMs = elapsedMs;

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

    return new Response(JSON.stringify({ error: "Worker failed", elapsedMs }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
