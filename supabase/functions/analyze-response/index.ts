import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Imports from shared contract (single source of truth) ──
import { FULL_SYSTEM_PROMPT } from "../_shared/credit-parser-prompt.ts";
import { postProcessAndValidate } from "../_shared/parser-validator.ts";
import { PARSER_ERROR_CODES } from "../_shared/parser-contract.ts";
// ── Inline normalizer (bundler cannot resolve new _shared files) ──
// Canonical source: src/lib/result-normalizer.ts — keep in sync
const _KB = ['experian','equifax','transunion'];
const _CM: Record<string,string> = {very_high:'high',probable:'medium',uncertain:'low',high:'high',medium:'medium',low:'low',incomplete:'incomplete'};
const _MM: Record<string,string> = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
const _CMAP: Record<string,string> = {'CAPITAL ONE BANK USA':'CAPITAL ONE','CAPITAL ONE BANK':'CAPITAL ONE','CAP ONE BANK':'CAPITAL ONE','TBOM MIL':'THE BANK OF MISSOURI','SPARROW FINANCIAL I':'SPARROW FINANCIAL'};
function _nCred(n:any){if(!n||typeof n!=='string')return n;let c=n.replace(/\(\w{2,6}\)/g,'').toUpperCase().replace(/[\/\-_]+/g,' ').replace(/[^\w\s&'.]/g,' ').replace(/\s+/g,' ').trim();for(const k in _CMAP){if(c===k||(c.startsWith(k)&&(c.length===k.length||c[k.length]===' '))){c=_CMAP[k];break;}}return c;}
function _nAcct(a:any){if(!a||typeof a!=='string')return a;const t=a.trim();if(['N/A','UNEXTRACTABLE'].includes(t.toUpperCase()))return t.toUpperCase();const s=t.replace(/[\*Xx\-\s]/g,'');return s.length>=4?s.slice(-4):s.length>0?s:t;}
function _nBal(b:any):string|null{if(b===null||b===undefined)return null;if(typeof b==='number')return String(Math.round(b));if(typeof b!=='string')return null;const t=b.trim();if(!t||t==='$0'||t==='0')return'0';const c=t.replace(/[$,\s]/g,'');const p=parseFloat(c);return isNaN(p)?t:String(Math.round(p));}
function _nConf(c:any):string{if(!c||typeof c!=='string')return'medium';return _CM[c.toLowerCase()]||'medium';}
function _nDate(d:any):any{if(!d||typeof d!=='string')return d;const t=d.trim();if(!t)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(t))return t;const s=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(s)return`${s[3]}-${s[1].padStart(2,'0')}-${s[2].padStart(2,'0')}`;const x=t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);if(x){const m=_MM[x[1].toLowerCase().slice(0,3)];if(m)return`${x[3]}-${m}-${x[2].padStart(2,'0')}`;}const e=t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);if(e){const m=_MM[e[2].toLowerCase().slice(0,3)];if(m)return`${e[3]}-${m}-${e[1].padStart(2,'0')}`;}return t;}
function _nBureau(tl:any){if(Array.isArray(tl.bureaus)&&tl.bureaus.length>0){tl.bureaus=tl.bureaus.map((b:string)=>typeof b==='string'?b.toLowerCase():b);return tl;}if(typeof tl.source==='string'){const s=tl.source.toLowerCase();const m=_KB.find(b=>s.includes(b));if(m){tl.bureaus=[m];return tl;}}tl.bureaus=['unknown'];return tl;}
function _nTL(t:any){const n={...t};n.creditor_name=_nCred(t.creditor_name);n.account_number=_nAcct(t.account_number);n.confidence=_nConf(t.confidence);for(const f of['balance','high_balance','credit_limit','past_due_amount','monthly_payment']){if(n[f]!==undefined)n[f]=_nBal(n[f]);}for(const f of['date_opened','date_reported','date_of_last_activity','date_of_first_delinquency','date_closed']){if(n[f]!==undefined)n[f]=_nDate(n[f]);}_nBureau(n);return n;}
function _dk(t:any){return`${_nCred(t.creditor_name)||''}|${_nAcct(t.account_number)||''}|${Array.isArray(t.bureaus)&&t.bureaus.length>0?t.bureaus[0]:'unknown'}`;}
function _dedup(tls:any[]):{deduped:any[];flags:any[]}{if(!Array.isArray(tls)||tls.length===0)return{deduped:tls||[],flags:[]};const seen=new Map<string,{item:any;index:number}>();const flags:any[]=[];const deduped:any[]=[];for(let i=0;i<tls.length;i++){const t=tls[i];const key=_dk(t);const ex=seen.get(key);if(ex){const cr:Record<string,number>={high:3,medium:2,low:1,incomplete:0};if((cr[t.confidence]??1)>(cr[ex.item.confidence]??1))ex.item.confidence=t.confidence;if(Array.isArray(t.derogatory_triggers)){const s=new Set(ex.item.derogatory_triggers||[]);for(const trig of t.derogatory_triggers)s.add(trig);ex.item.derogatory_triggers=[...s];}const ef=flags.find((f:any)=>f.creditor_name===(_nCred(t.creditor_name)||'')&&f.account_number===(_nAcct(t.account_number)||'')&&f.bureau===(Array.isArray(t.bureaus)?t.bureaus[0]:'unknown'));if(ef)ef.indices.push(i);else flags.push({creditor_name:_nCred(t.creditor_name)||'',account_number:_nAcct(t.account_number)||'',bureau:Array.isArray(t.bureaus)?t.bureaus[0]:'unknown',indices:[ex.index,i]});console.log(`[normalizer] NORMALIZER_DUPLICATE_MERGED: ${key}`);}else{seen.set(key,{item:t,index:i});deduped.push(t);}}return{deduped,flags};}
function normalizeCanonicalResult(result:any):any{if(!result||typeof result!=='object')return result;const r={...result};let msk=0,bal=0;const arrs=['derogatory_accounts','manual_review_accounts','clean_accounts','all_tradelines','charge_offs'];for(const k of arrs){if(Array.isArray(r[k])){r[k]=r[k].map((t:any)=>{const b=t.account_number;const n=_nTL(t);if(b!==n.account_number)msk++;return n;});}}if(Array.isArray(r.collections)){r.collections=r.collections.map((c:any)=>{const n={...c};n.collection_agency=_nCred(c.collection_agency);n.creditor_name=_nCred(c.creditor_name);n.original_creditor=_nCred(c.original_creditor);n.account_number=_nAcct(c.account_number);if(n.balance!==undefined){const b=n.balance;n.balance=_nBal(n.balance);if(b!==n.balance)bal++;}n.confidence=_nConf(c.confidence);for(const f of['date_opened','date_reported']){if(n[f])n[f]=_nDate(n[f]);}_nBureau(n);return n;});}if(Array.isArray(r.inquiries)){r.inquiries=r.inquiries.map((q:any)=>({...q,creditor_name:_nCred(q.creditor_name),date:_nDate(q.date)}));}if(Array.isArray(r.public_records)){r.public_records=r.public_records.map((p:any)=>({...p,date_filed:_nDate(p.date_filed),date_resolved:_nDate(p.date_resolved)}));}const af:any[]=[];for(const k of arrs){if(Array.isArray(r[k])&&r[k].length>0){const{deduped,flags}=_dedup(r[k]);r[k]=deduped;af.push(...flags);}}if(af.length>0){const ex=Array.isArray(r.duplicate_flags)?r.duplicate_flags:[];r.duplicate_flags=[...ex,...af];}if(msk>0)console.log(`[normalizer] NORMALIZER_ACCOUNT_MASK_REMOVED: ${msk}`);if(bal>0)console.log(`[normalizer] NORMALIZER_BALANCE_NORMALIZED: ${bal}`);if(af.length>0)console.log(`[normalizer] NORMALIZER_DUPLICATE_MERGED: ${af.length} groups`);return r;}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_IMAGE_SIZE = 15000000;
const MAX_IMAGES = 50;
const MAX_TEXT_LENGTH = 500000;
const VALID_BUREAUS = ["experian", "equifax", "transunion"] as const;
const MULTI_BUREAU_SENTINEL = "multi-bureau";

/** Contract version — must match worker and frontend */
const CONTRACT_VERSION = 'v2-canonical';

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitStore.get(userId);
  if (!userLimit || now > userLimit.resetTime) {
    rateLimitStore.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  userLimit.count++;
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required. Please log in to use this feature." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing Supabase configuration");
      return new Response(JSON.stringify({ error: "Service configuration error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.log("Auth failed:", authError?.message || "No user found");
      return new Response(JSON.stringify({ error: "Invalid or expired session. Please log in again." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment before trying again." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Authenticated request from user: ${user.id}`);

    const { questionnaire, responseText, responseImages, bureau, hasIdentityDocs } = await req.json();

    if (!questionnaire || !questionnaire.fullLegalName || !questionnaire.currentAddress || !questionnaire.currentEmployer) {
      return new Response(JSON.stringify({ error: "Required questionnaire fields missing: full legal name, current address, and current employer are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (responseImages) {
      if (!Array.isArray(responseImages)) {
        return new Response(JSON.stringify({ error: "Invalid images format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (responseImages.length > MAX_IMAGES) {
        return new Response(JSON.stringify({ error: `Maximum ${MAX_IMAGES} images allowed` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      for (const img of responseImages) {
        if (typeof img !== 'string' || img.length > MAX_IMAGE_SIZE) {
          return new Response(JSON.stringify({ error: "Image size exceeds maximum allowed (10MB per image)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (!img.match(/^data:image\/(png|jpg|jpeg|gif|webp);base64,/)) {
          return new Response(JSON.stringify({ error: "Invalid image format. Please upload PNG, JPG, GIF, or WebP" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    if (responseText) {
      if (typeof responseText !== 'string') {
        return new Response(JSON.stringify({ error: "Invalid text format" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (responseText.length > MAX_TEXT_LENGTH) {
        return new Response(JSON.stringify({ error: "Text exceeds maximum length (500,000 characters)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (typeof bureau === "string" && bureau.trim()) {
      const normalizedBureau = bureau.trim().toLowerCase();
      if (normalizedBureau === "unknown") {
        return new Response(JSON.stringify({ error: "Invalid bureau. Bureau cannot be unknown." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (normalizedBureau !== MULTI_BUREAU_SENTINEL && !VALID_BUREAUS.includes(normalizedBureau as (typeof VALID_BUREAUS)[number])) {
        return new Response(JSON.stringify({ error: "Invalid bureau. Must be Experian, Equifax, TransUnion, or Multi-Bureau" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Service configuration error. Please contact support." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userContent: any[] = [];
    
    let contextMessage = `## QUESTIONNAIRE DATA (GROUND TRUTH - Use these as the ONLY accurate values)

**Full Legal Name:** ${questionnaire.fullLegalName}
**Current Address:** ${questionnaire.currentAddress}
**Current Employer:** ${questionnaire.currentEmployer}`;

    if (questionnaire.dateOfBirth) contextMessage += `\n**Date of Birth:** ${questionnaire.dateOfBirth}`;
    if (questionnaire.phoneNumber) contextMessage += `\n**Phone Number:** ${questionnaire.phoneNumber}`;
    if (questionnaire.email) contextMessage += `\n**Email:** ${questionnaire.email}`;
    if (questionnaire.ssnLast4) contextMessage += `\n**SSN Last 4:** ${questionnaire.ssnLast4}`;

    contextMessage += `\n\n## ADDITIONAL CONTEXT`;
    if (bureau) contextMessage += `\n**Bureau:** ${bureau}`;
    if (hasIdentityDocs) contextMessage += `\n**Identity Theft Documentation:** ${hasIdentityDocs}`;

    contextMessage += `\n\n## INSTRUCTIONS
Apply the Deterministic Two-Pass extraction method:
1. PASS 0: Extract report metadata (bureau names, summary counts).
2. PASS 1: Build complete tradeline inventory — detect every account block using structural anchors.
3. PASS 2: Filter for negative items using whole-word boundary matching of all negative indicators.
4. VALIDATION GATE: Reconcile extracted counts against bureau summary metrics.
5. DUPLICATE DETECTION: Flag potential duplicates without merging.

Compare ALL personal information against the questionnaire ground truth above.
Any deviation from the exact questionnaire values = INACCURATE.
Parse payment history grids/charts carefully for late payment codes.
Include all derogatory items with maximum inclusion (dispute-safe approach).`;
    
    if (responseImages && responseImages.length > 0) {
      userContent.push({
        type: "text",
        text: contextMessage + `\n\nThe credit report is in the attached ${responseImages.length} image(s). Analyze ALL pages carefully using the two-pass method.`
      });
      for (const img of responseImages) {
        userContent.push({ type: "image_url", image_url: { url: img } });
      }
    } else if (responseText) {
      userContent.push({
        type: "text",
        text: contextMessage + `\n\n## CREDIT REPORT TEXT:\n"""\n${responseText}\n"""`
      });
    } else {
      return new Response(JSON.stringify({ error: "Please provide credit report images or text to analyze" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const model = "google/gemini-3-flash-preview";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: FULL_SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits to continue." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "An error occurred while analyzing the report. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("No content in AI response");
      return new Response(JSON.stringify({ error: "Unable to analyze the report. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response as JSON:", content.substring(0, 500));
      parsedResult = { 
        validation_status: "ERROR",
        validation_messages: ["Analysis could not be fully structured. Please try again with clearer images."],
        derogatory_accounts: [],
        collections: [],
        charge_offs: [],
        public_records: [],
        inquiries: [],
        warnings: ["The analysis encountered formatting issues. Results may be incomplete."]
      };
    }

    // ── Normalization layer — runs BEFORE validation ──
    const normalizedResult = normalizeCanonicalResult(parsedResult);

    console.log("[normalizer] result normalized", {
      derogatory_accounts: normalizedResult.derogatory_accounts?.length,
      collections: normalizedResult.collections?.length,
      inquiries: normalizedResult.inquiries?.length,
    });

    // ── Deterministic post-processing via shared validator ──
    const postProcessed = postProcessAndValidate(normalizedResult, responseText || undefined);

    // ── Enforcement: check for EXTRACTION_INCOMPLETE ──
    if (postProcessed.isError) {
      console.error(`[analyze-response] ${PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE}: ${postProcessed.errorMessage}`);
      postProcessed.report._extraction_error = PARSER_ERROR_CODES.EXTRACTION_INCOMPLETE;
      postProcessed.report._extraction_error_message = postProcessed.errorMessage;
    }

    if (postProcessed.schema.violations.length > 0) {
      console.warn(`[analyze-response] Schema violations: ${postProcessed.schema.violations.length}`, 
        postProcessed.schema.violations.slice(0, 5).map(v => `${v.entity}[${v.index}].${v.field}: ${v.reason}`));
    }

    // ── CANONICAL RESULT — same shape as analysis-worker output ──
    const result: any = {
      // Three-bucket accounts (deterministic)
      derogatory_accounts: postProcessed.report.derogatory_accounts || [],
      manual_review_accounts: postProcessed.report.manual_review_accounts || [],
      clean_accounts: postProcessed.report.clean_accounts || [],
      all_tradelines: postProcessed.report.all_tradelines || [],

      // Non-account entities (first-class)
      collections: postProcessed.report.collections || [],
      charge_offs: postProcessed.report.charge_offs || [],
      inquiries: postProcessed.report.inquiries || [],
      public_records: postProcessed.report.public_records || [],

      // Identity mismatches
      inaccurate_names: postProcessed.report.inaccurate_names || [],
      inaccurate_addresses: postProcessed.report.inaccurate_addresses || [],
      inaccurate_employers: postProcessed.report.inaccurate_employers || [],
      extra_identifier_mismatches: postProcessed.report.extra_identifier_mismatches || [],

      // Validation/audit metadata
      tradeline_inventory: postProcessed.report.tradeline_inventory || {},
      validation_status: postProcessed.report.validation_status || postProcessed.validation.status || "SKIPPED",
      validation_messages: postProcessed.validation.messages || [],
      duplicate_flags: postProcessed.duplicateFlags || [],
      warnings: parsedResult.warnings || [],
      report_metadata: parsedResult.report_metadata || {},

      // Display-only convenience fields
      late_payment_summary: postProcessed.report.late_payment_summary || [],
      is_multi_bureau_report: parsedResult.is_multi_bureau_report || false,
      detected_bureaus: parsedResult.detected_bureaus || [],

      // Contract version for traceability
      _contract_version: CONTRACT_VERSION,

      // Non-contract downstream fields
      _downstream_summary: parsedResult.summary || null,
      _downstream_next_steps: parsedResult.next_steps || null,
      _schema_violations: postProcessed.schema.violations.length,
      _schema_rejected: postProcessed.schema.rejectedAccounts.length,
      _extraction_error: postProcessed.report._extraction_error || null,
      _extraction_error_message: postProcessed.report._extraction_error_message || null,
      _validation_fatal: postProcessed.validation.fatal,
    };

    console.log(`[analyze-response] Canonical result: ${result.derogatory_accounts.length} derog, ${result.manual_review_accounts.length} review, ${result.clean_accounts.length} clean, ${result.collections.length} collections, ${result.charge_offs.length} charge_offs, ${result.inquiries.length} inquiries, ${result.public_records.length} public_records`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in analyze-response function:", error);
    return new Response(JSON.stringify({ 
      error: "An error occurred while processing your request. Please try again." 
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
