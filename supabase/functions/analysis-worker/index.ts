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

interface Job {
  id: string;
  status: string;
  step: string;
  progress: number;
  attempt_count: number;
  max_attempts: number;
  input_data: {
    imageUrls: string[];
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

async function updateJob(client: any, jobId: string, updates: Partial<Job & { error_code?: string; error_message?: string; started_at?: string; completed_at?: string; result_data?: any }>) {
  const { error } = await client.from("analysis_jobs").update({
    ...updates,
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
  
  if (error) {
    console.error(`Failed to update job ${jobId}:`, error);
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

  try {
    const { jobId } = await req.json();

    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch job
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

    // Check if job already completed or is being processed
    if (job.status === "DONE" || job.status === "RUNNING") {
      return new Response(JSON.stringify({ status: job.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as running
    await updateJob(client, jobId, {
      status: "RUNNING",
      step: "mapping",
      started_at: new Date().toISOString(),
      attempt_count: job.attempt_count + 1,
    });

    const inputData = job.input_data as Job["input_data"];
    const checkpoints = (job.checkpoints || {}) as Job["checkpoints"];
    const images = inputData.imageUrls;

    // Step 1: Document Mapping (if not already done)
    let documentMap = checkpoints.documentMap;
    if (!documentMap) {
      try {
        await updateJob(client, jobId, { step: "mapping", progress: 5 });

        // Sample pages for mapping
        const sampleImages: string[] = [];
        const totalPages = images.length;
        
        for (let i = 0; i < Math.min(5, totalPages); i++) {
          sampleImages.push(images[i]);
        }
        if (totalPages > 7) {
          sampleImages.push(images[totalPages - 2]);
          sampleImages.push(images[totalPages - 1]);
        }

        const mapPrompt = `Analyze these credit report sample pages and output a JSON document map with sections: personal_info, accounts, inquiries, payment_history, public_records, summary. For each: detected (boolean), start_page (1-indexed), end_page (1-indexed). Also output: is_multi_bureau, detected_bureaus, total_pages: ${totalPages}, report_type.`;

        const userContent: any[] = [{ type: "text", text: mapPrompt }];
        for (const img of sampleImages) {
          userContent.push({ type: "image_url", image_url: { url: img } });
        }

        documentMap = await callAIWithRetry(lovableApiKey, [
          { role: "system", content: "You are a document structure analyzer. Output JSON only." },
          { role: "user", content: userContent },
        ]);

        documentMap.total_pages = totalPages;

        // Save checkpoint
        await updateJob(client, jobId, {
          checkpoints: { ...checkpoints, documentMap },
          progress: 15,
        });
      } catch (error) {
        console.error("Document mapping failed:", error);
        // Continue with fallback map
        documentMap = {
          is_multi_bureau: false,
          detected_bureaus: [],
          total_pages: images.length,
          sections: {
            accounts: { detected: true, start_page: 1, end_page: images.length, page_count: images.length },
          },
        };
        await updateJob(client, jobId, {
          checkpoints: { ...checkpoints, documentMap },
        });
      }
    }

    // Step 2: Chunk and analyze accounts
    await updateJob(client, jobId, { step: "analyzing", progress: 20 });

    const accountsSection = documentMap.sections?.accounts || { start_page: 1, end_page: images.length };
    const startIdx = (accountsSection.start_page || 1) - 1;
    const endIdx = accountsSection.end_page || images.length;
    const sectionImages = images.slice(startIdx, endIdx);

    // Split into chunks
    const chunks: string[][] = [];
    for (let i = 0; i < sectionImages.length; i += MAX_IMAGES_PER_CHUNK) {
      chunks.push(sectionImages.slice(i, i + MAX_IMAGES_PER_CHUNK));
    }

    const totalChunks = chunks.length;
    let processedChunks = checkpoints.processedChunks || 0;
    const allAccounts: any[] = checkpoints.accounts || [];
    const failedChunks: number[] = checkpoints.failedChunks || [];

    // Process remaining chunks
    const accountsPrompt = `Extract ALL accounts from these credit report pages. Output JSON: { "accounts": [{ "creditor_name": "...", "account_number": "XXXX...", "date_opened": "MM/YYYY", "status": "...", "balance": "$X,XXX", "derogatory_triggers": [], "bureaus": [] }] }`;

    for (let i = processedChunks; i < chunks.length; i++) {
      const progressPct = 20 + Math.round((i / totalChunks) * 70);
      await updateJob(client, jobId, {
        step: `analyzing chunk ${i + 1}/${totalChunks}`,
        progress: progressPct,
        checkpoints: { documentMap, accounts: allAccounts, processedChunks: i, totalChunks, failedChunks },
      });

      try {
        const userContent: any[] = [
          { type: "text", text: `Analyze chunk ${i + 1} of ${totalChunks}. ${accountsPrompt}` },
        ];
        for (const img of chunks[i]) {
          userContent.push({ type: "image_url", image_url: { url: img } });
        }

        const result = await callAIWithRetry(lovableApiKey, [
          { role: "system", content: "Extract credit account data. Output valid JSON only." },
          { role: "user", content: userContent },
        ]);

        if (result.accounts && Array.isArray(result.accounts)) {
          allAccounts.push(...result.accounts);
        }

        processedChunks = i + 1;
      } catch (error) {
        console.error(`Chunk ${i + 1} failed:`, error);
        failedChunks.push(i);
      }

      // Small delay between chunks to avoid rate limits
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Step 3: Normalize and deduplicate accounts
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

    // Mark job complete
    const finalStatus = failedChunks.length > 0 && normalizedAccounts.length === 0 ? "FAILED" :
                         failedChunks.length > 0 ? "PARTIAL" : "DONE";

    const resultData = {
      accounts: normalizedAccounts,
      documentMap,
      totalPages: images.length,
      processedChunks,
      totalChunks,
      failedChunks,
    };

    await updateJob(client, jobId, {
      status: finalStatus,
      step: "complete",
      progress: 100,
      result_data: resultData,
      checkpoints: { documentMap, accounts: normalizedAccounts, processedChunks, totalChunks, failedChunks },
      completed_at: new Date().toISOString(),
      error_message: failedChunks.length > 0 ? `${failedChunks.length} chunk(s) failed` : undefined,
    });

    console.log(`Job ${jobId} completed with status ${finalStatus}. Found ${normalizedAccounts.length} accounts.`);

    return new Response(JSON.stringify({ status: finalStatus, accountCount: normalizedAccounts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Worker error:", error);

    // Try to mark job as failed
    try {
      const { jobId } = await req.json();
      if (jobId) {
        await updateJob(client, jobId, {
          status: "FAILED",
          error_code: "WORKER_ERROR",
          error_message: error instanceof Error ? error.message : "Unknown worker error",
        });
      }
    } catch {}

    return new Response(JSON.stringify({ error: "Worker failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
