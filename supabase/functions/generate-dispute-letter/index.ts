import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a dispute letter generator for the Continuum Capital Group Credit Dispute System.

## CRITICAL OUTPUT RULES (NON-NEGOTIABLE)

1. OUTPUT FORMAT: You must output ONLY the letter text. No explanations, no commentary, no markdown formatting.

2. FORBIDDEN ELEMENTS (WILL CAUSE REJECTION):
   - Brackets of any kind: [ ] { } < >
   - Placeholders like "[YOUR NAME]", "[DATE]", "[ADDRESS]"
   - Instructional text like "Insert here" or "Fill in"
   - Notes or comments
   - Markdown formatting (no **, no ##, no \`\`\`)

3. REQUIRED LETTERHEAD FORMAT (EXACT STRUCTURE):

[Consumer's full legal name from consumerInfo]
[Street address line 1]
[Street address line 2 if provided]
[City, State ZIP]

[Current date - spelled out month, e.g., "January 7, 2026"]

[Bureau legal name]
[Bureau address]
[Bureau city, state ZIP]

RE: Formal Dispute Under the Fair Credit Reporting Act

Dear Sir or Madam,

[Body of letter...]

Sincerely,

[Consumer's full legal name]

---

## TONE & STYLE
- Prosecutor-style: formal, assertive, legally grounded
- NO casual language
- NO hedging: "may be", "possibly", "might be" are FORBIDDEN
- Every statement is an assertion

## LEGAL FRAMEWORK
Cite FCRA provisions:
- §602(a): Congressional intent for accurate credit reporting
- §607(b): Duty to ensure maximum possible accuracy
- §611(a): Reinvestigation requirements within 30 days
- §605B: Identity theft blocking procedures
- §623: Furnisher responsibilities

## CONDITIONAL ARGUMENTS (INCLUDE BASED ON SURVEY)

IF identity theft OR fraud = YES:
- Assert identity theft protections under FCRA §605B
- Demand blocking of disputed items
- Assert fraudulent accounts cannot be verified as belonging to consumer

IF police report OR FTC report = NO:
- State: "I am not required by law to provide a police report or FTC report to dispute these items. The FCRA places the burden of verification on you, not on the consumer."

IF data breach = YES:
- Assert third-party compromise and heightened duty of care
- Reference accounts opened after breach exposure are presumptively fraudulent

IF reinsertion = YES:
- Demand proof of certification under §611(a)(5)(B)
- Demand proof written notice was sent prior to reinsertion
- Assert violation if no certification exists

IF prior disputes = YES:
- Assert failure of reasonable reinvestigation
- Cite continued reporting as willful non-compliance

IF no creditor relationship = YES:
- Assert accounts cannot belong to consumer absent contractual relationship
- Demand proof of signed application or agreement

IF belongs to another person = YES:
- Assert mixed file error
- Demand procedures used to prevent file commingling

IF personal info errors caused accounts = YES:
- Assert inaccurate identifiers undermine integrity of ALL associated accounts

## FACT INTEGRATION (MANDATORY - INCLUDE ALL ITEMS)

List EVERY item provided. Do NOT skip any item for any reason.

Format for inaccurate names:
"The following name(s) do not belong to me and must be removed: [list each name]"

Format for inaccurate addresses:
"The following address(es) are inaccurate and must be corrected or removed: [list each address]"

Format for accounts (derogatory, collections, charge-offs):
"I dispute the following account(s):
- [Creditor Name], Account #[number], Date Opened: [date]
  [Reason for dispute based on survey answers]"

Format for inquiries:
"The following unauthorized inquiry/ies must be removed:
- [Inquirer Name], Date: [date]"

## CAUSAL CONNECTION (INCLUDE IN BODY)
Argue:
1. Inaccurate personal identifiers undermine associated account data
2. Accounts under incorrect identifiers cannot be presumed accurate
3. Inquiries tied to disputed items are likewise invalid

## REMEDY DEMANDS (REQUIRED AT END)
Demand:
1. Deletion or blocking of ALL disputed items
2. Correction of personal identifying information
3. Written confirmation of investigation results within 30 days
4. Description of method of verification for each item
5. Name and address of each furnisher contacted

## CLOSING
End with: "Sincerely," followed by the consumer's full legal name (no signature line placeholder).`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: "Service configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { survey, extractedData, consumerInfo, bureau } = await req.json();

    // Validation: All required fields must be present
    const missingFields: string[] = [];
    if (!consumerInfo?.fullName?.trim()) missingFields.push("Consumer full name");
    if (!consumerInfo?.addressLine1?.trim()) missingFields.push("Consumer street address");
    if (!consumerInfo?.cityStateZip?.trim()) missingFields.push("Consumer city/state/ZIP");
    if (!bureau?.legalName) missingFields.push("Bureau legal name");
    if (!bureau?.address) missingFields.push("Bureau address");
    if (!bureau?.cityStateZip) missingFields.push("Bureau city/state/ZIP");

    if (missingFields.length > 0) {
      return new Response(JSON.stringify({ 
        error: `Missing required data: ${missingFields.join(', ')}. Cannot generate letter.` 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!survey || !extractedData) {
      return new Response(JSON.stringify({ error: "Missing survey or extracted data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Service configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Format current date
    const currentDate = new Date().toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });

    // Build consumer address block
    const consumerAddressLines = [
      consumerInfo.fullName.trim(),
      consumerInfo.addressLine1.trim(),
      consumerInfo.addressLine2?.trim() || null,
      consumerInfo.cityStateZip.trim(),
    ].filter(Boolean).join('\n');

    // Build bureau address block
    const bureauAddressLines = [
      bureau.legalName,
      bureau.address,
      bureau.cityStateZip,
    ].join('\n');

    const userPrompt = `Generate a dispute letter with this EXACT information:

## LETTERHEAD DATA (USE EXACTLY AS PROVIDED)
Consumer Name: ${consumerInfo.fullName.trim()}
Consumer Address Line 1: ${consumerInfo.addressLine1.trim()}
${consumerInfo.addressLine2?.trim() ? `Consumer Address Line 2: ${consumerInfo.addressLine2.trim()}` : ''}
Consumer City/State/ZIP: ${consumerInfo.cityStateZip.trim()}

Date: ${currentDate}

Bureau Legal Name: ${bureau.legalName}
Bureau Address: ${bureau.address}
Bureau City/State/ZIP: ${bureau.cityStateZip}

## SURVEY RESPONSES
- Disputed items are fraudulent: ${survey.isFraudulent ? 'YES' : 'NO'}
- Victim of identity theft: ${survey.isIdentityTheft ? 'YES' : 'NO'}
- Filed police report: ${survey.hasPoliceReport ? 'YES' : 'NO'}
- Filed FTC Identity Theft Report: ${survey.hasFtcReport ? 'YES' : 'NO'}
- Exposed to data breach: ${survey.wasDataBreach ? 'YES' : 'NO'}
- Items previously removed then reinserted: ${survey.wasReinserted ? 'YES' : 'NO'}${survey.wasReinserted && survey.reinsertedDetails ? `\n  Reinsertion details: ${survey.reinsertedDetails}` : ''}
- Had contractual relationship with listed creditors: ${survey.hadCreditorRelationship ? 'YES' : 'NO'}
- Items belong to another person with similar name: ${survey.belongsToAnotherPerson ? 'YES' : 'NO'}
- Personal info errors caused these accounts: ${survey.hasPersonalInfoErrors ? 'YES' : 'NO'}
- Previously disputed these items: ${survey.hasPreviousDisputes ? 'YES' : 'NO'}
${survey.additionalFacts ? `\nAdditional consumer context: ${survey.additionalFacts}` : ''}

## DISPUTED ITEMS (INCLUDE ALL IN LETTER)

### INACCURATE NAMES (${extractedData.inaccurateNames?.length || 0} items)
${extractedData.inaccurateNames?.length > 0
  ? extractedData.inaccurateNames.map((n: any, i: number) => `${i + 1}. "${n.reported_name}" - ${n.mismatch_reason}`).join('\n')
  : 'None'}

### INACCURATE ADDRESSES (${extractedData.inaccurateAddresses?.length || 0} items)
${extractedData.inaccurateAddresses?.length > 0
  ? extractedData.inaccurateAddresses.map((a: any, i: number) => `${i + 1}. ${a.reported_address}`).join('\n')
  : 'None'}

### DEROGATORY ACCOUNTS (${extractedData.derogatoryAccounts?.length || 0} items)
${extractedData.derogatoryAccounts?.length > 0
  ? extractedData.derogatoryAccounts.map((a: any, i: number) => `${i + 1}. Creditor: ${a.creditor_name}, Account #: ${a.account_number}, Date Opened: ${a.date_opened}, Issues: ${a.derogatory_triggers?.join(', ') || 'Disputed'}`).join('\n')
  : 'None'}

### COLLECTIONS (${extractedData.collections?.length || 0} items)
${extractedData.collections?.length > 0
  ? extractedData.collections.map((c: any, i: number) => `${i + 1}. Creditor: ${c.creditor_name}, Account #: ${c.account_number}, Original Creditor: ${c.original_creditor || 'Unknown'}, Balance: ${c.balance}`).join('\n')
  : 'None'}

### CHARGE-OFFS (${extractedData.chargeOffs?.length || 0} items)
${extractedData.chargeOffs?.length > 0
  ? extractedData.chargeOffs.map((c: any, i: number) => `${i + 1}. Creditor: ${c.creditor_name}, Account #: ${c.account_number}, Date Charged Off: ${c.date_charged_off}, Balance: ${c.balance}`).join('\n')
  : 'None'}

### PUBLIC RECORDS (${extractedData.publicRecords?.length || 0} items)
${extractedData.publicRecords?.length > 0
  ? extractedData.publicRecords.map((p: any, i: number) => `${i + 1}. Type: ${p.type}, Court: ${p.court_jurisdiction}, Filing Date: ${p.filing_date}, Status: ${p.status}`).join('\n')
  : 'None'}

### INQUIRIES (${extractedData.inquiries?.length || 0} items)
${extractedData.inquiries?.length > 0
  ? extractedData.inquiries.map((inq: any, i: number) => `${i + 1}. Inquirer: ${inq.creditor_name}, Date: ${inq.date}, Type: ${inq.type}`).join('\n')
  : 'None'}

Generate the complete, print-ready dispute letter NOW. Output ONLY the letter text with no additional commentary.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Failed to generate letter. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    let letter = data.choices?.[0]?.message?.content;

    if (!letter) {
      return new Response(JSON.stringify({ error: "Failed to generate letter content" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Post-processing: Remove any markdown formatting that slipped through
    letter = letter
      .replace(/^```[\s\S]*?\n/g, '')
      .replace(/\n```$/g, '')
      .replace(/\*\*/g, '')
      .replace(/##\s*/g, '')
      .trim();

    // Validation: Check for forbidden placeholders
    const placeholderPatterns = [
      /\[.*?\]/g,
      /\{.*?\}/g,
      /<.*?>/g,
      /\[YOUR\s+\w+\]/gi,
      /\[INSERT\s+.*?\]/gi,
      /\[FILL\s+.*?\]/gi,
    ];

    for (const pattern of placeholderPatterns) {
      if (pattern.test(letter)) {
        console.error("Letter contains forbidden placeholders:", letter.match(pattern));
        return new Response(JSON.stringify({ 
          error: "Generated letter contains placeholders. Please try again." 
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ letter }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error generating dispute letter:", error);
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});