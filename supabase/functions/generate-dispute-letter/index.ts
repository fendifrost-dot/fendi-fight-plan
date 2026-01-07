import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a dispute letter generator for the Continuum Capital Group Credit Dispute System. Your task is to generate ONE complete, legally-grounded dispute letter.

## TONE & STYLE (NON-NEGOTIABLE)
- Prosecutor-style: formal, assertive, legally grounded
- NO casual language
- NO disclaimers like "may be incorrect" or "possibly inaccurate"
- NO hedging language whatsoever
- Every statement is an assertion, not a suggestion

## LEGAL FRAMEWORK
Cite FCRA provisions where applicable:
- §602(a): Congressional intent for accurate credit reporting
- §607(b): Duty to ensure maximum possible accuracy
- §611(a): Reinvestigation requirements
- §605B: Identity theft blocking procedures
- §623: Furnisher responsibilities

## CONDITIONAL ARGUMENT LOGIC (CRITICAL)
Based on survey answers, include these arguments:

IF identity theft OR fraud = YES:
- Assert identity theft protections under FCRA §605B
- Demand blocking of disputed items
- Assert that fraudulent accounts cannot be verified as belonging to consumer

IF police report OR FTC report = NO:
- Explicitly state: "I am not required by law to provide a police report or FTC report to dispute these items. The FCRA places the burden of verification on you, not on the consumer."

IF data breach = YES:
- Assert third-party compromise
- Assert heightened duty of care
- Reference that accounts opened after breach exposure are presumptively fraudulent

IF reinsertion = YES:
- Demand proof of certification under §611(a)(5)(B)
- Demand proof that written notice was sent prior to reinsertion
- Assert violation if no certification exists

IF prior disputes = YES:
- Assert failure of reasonable reinvestigation
- Cite continued reporting as willful non-compliance

IF no creditor relationship = YES:
- Assert that accounts cannot belong to consumer absent any contractual relationship
- Demand proof of signed application or agreement

IF belongs to another person = YES:
- Assert mixed file error
- Demand procedures used to prevent file commingling

IF personal info errors caused accounts = YES:
- Assert that inaccurate identifiers undermine the integrity of ALL associated accounts
- Accounts reported under incorrect identifiers cannot be presumed accurate

## FACT INTEGRATION (MANDATORY)
The letter MUST explicitly list:

1. ALL inaccurate names with exact spelling as reported
2. ALL inaccurate addresses with full text as reported
3. ALL disputed accounts with:
   - Creditor name
   - Account number (as shown)
   - Date opened (as shown)
4. ALL inquiries with:
   - Inquirer name
   - Inquiry date

NO ITEM MAY BE OMITTED. Include closed accounts, old accounts, everything.

## CAUSAL CONNECTION REQUIREMENT
The letter must argue:
1. Inaccurate personal identifiers undermine the integrity of associated accounts
2. Accounts reported under incorrect identifiers cannot be presumed to belong to the consumer
3. Inquiries tied to disputed accounts or identifiers are likewise invalid

## REMEDY DEMANDS (REQUIRED)
The letter must demand:
1. Deletion or blocking of ALL listed items
2. Correction of personal identifying information
3. Written confirmation of investigation results
4. Description of method of verification used for each item
5. Name and address of each furnisher contacted

## OUTPUT FORMAT (CRITICAL)
- ONE complete dispute letter
- Ready to print and send
- NO placeholders (e.g., [YOUR NAME])
- NO brackets of any kind
- NO instructional text
- NO comments or notes
- Use the consumer's actual name and address from extractedData
- Current date at top

This is a dispute-grade legal document, not a template.

Begin the letter with the date, then consumer's name and address, then the bureau address section (leave bureau address as the consumer will fill that in themselves), then "RE: Formal Dispute Under Fair Credit Reporting Act", then the body.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication
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

    const { survey, extractedData } = await req.json();

    if (!survey || !extractedData) {
      return new Response(JSON.stringify({ error: "Missing required data" }), {
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

    // Build the user prompt with all data
    const userPrompt = `Generate a dispute letter with the following information:

## CONSUMER INFORMATION
Full Legal Name: ${extractedData.fullLegalName}
Current Address: ${extractedData.currentAddress}
Date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

## SURVEY RESPONSES
- Disputed items are fraudulent: ${survey.isFraudulent ? 'YES' : 'NO'}
- Victim of identity theft: ${survey.isIdentityTheft ? 'YES' : 'NO'}
- Filed police report: ${survey.hasPoliceReport ? 'YES' : 'NO'}
- Filed FTC Identity Theft Report: ${survey.hasFtcReport ? 'YES' : 'NO'}
- Exposed to data breach: ${survey.wasDataBreach ? 'YES' : 'NO'}
- Items previously removed then reinserted: ${survey.wasReinserted ? 'YES' : 'NO'}${survey.wasReinserted && survey.reinsertedDetails ? `\n  Details: ${survey.reinsertedDetails}` : ''}
- Had contractual relationship with listed creditors: ${survey.hadCreditorRelationship ? 'YES' : 'NO'}
- Items belong to another person with similar name: ${survey.belongsToAnotherPerson ? 'YES' : 'NO'}
- Personal info errors caused these accounts: ${survey.hasPersonalInfoErrors ? 'YES' : 'NO'}
- Previously disputed these items: ${survey.hasPreviousDisputes ? 'YES' : 'NO'}
${survey.additionalFacts ? `\nAdditional context from consumer: ${survey.additionalFacts}` : ''}

## INACCURATE NAMES (${extractedData.inaccurateNames.length} items)
${extractedData.inaccurateNames.length > 0 
  ? extractedData.inaccurateNames.map((n: any, i: number) => `${i + 1}. "${n.reported_name}" - ${n.mismatch_reason}${n.source ? ` [${n.source}]` : ''}`).join('\n')
  : 'None identified'}

## INACCURATE ADDRESSES (${extractedData.inaccurateAddresses.length} items)
${extractedData.inaccurateAddresses.length > 0
  ? extractedData.inaccurateAddresses.map((a: any, i: number) => `${i + 1}. ${a.reported_address}${a.linked_to_derogatory ? ' [LINKED TO DEROGATORY]' : ''}${a.source ? ` [${a.source}]` : ''}`).join('\n')
  : 'None identified'}

## DEROGATORY ACCOUNTS (${extractedData.derogatoryAccounts.length} items)
${extractedData.derogatoryAccounts.length > 0
  ? extractedData.derogatoryAccounts.map((a: any, i: number) => `${i + 1}. Creditor: ${a.creditor_name}
   Account Number: ${a.account_number}
   Date Opened: ${a.date_opened}
   Derogatory Triggers: ${a.derogatory_triggers.join(', ')}${a.source ? `\n   Bureau: ${a.source}` : ''}`).join('\n\n')
  : 'None identified'}

## COLLECTIONS (${extractedData.collections.length} items)
${extractedData.collections.length > 0
  ? extractedData.collections.map((c: any, i: number) => `${i + 1}. Creditor: ${c.creditor_name}
   Account Number: ${c.account_number}
   Original Creditor: ${c.original_creditor || 'Unknown'}
   Balance: ${c.balance}${c.source ? `\n   Bureau: ${c.source}` : ''}`).join('\n\n')
  : 'None identified'}

## CHARGE-OFFS (${extractedData.chargeOffs.length} items)
${extractedData.chargeOffs.length > 0
  ? extractedData.chargeOffs.map((c: any, i: number) => `${i + 1}. Creditor: ${c.creditor_name}
   Account Number: ${c.account_number}
   Date Charged Off: ${c.date_charged_off}
   Balance: ${c.balance}${c.source ? `\n   Bureau: ${c.source}` : ''}`).join('\n\n')
  : 'None identified'}

## PUBLIC RECORDS (${extractedData.publicRecords.length} items)
${extractedData.publicRecords.length > 0
  ? extractedData.publicRecords.map((p: any, i: number) => `${i + 1}. Type: ${p.type}
   Court/Jurisdiction: ${p.court_jurisdiction}
   Filing Date: ${p.filing_date}
   Status: ${p.status}${p.source ? `\n   Bureau: ${p.source}` : ''}`).join('\n\n')
  : 'None identified'}

## INQUIRIES (${extractedData.inquiries.length} items)
${extractedData.inquiries.length > 0
  ? extractedData.inquiries.map((inq: any, i: number) => `${i + 1}. Inquirer: ${inq.creditor_name}
   Date: ${inq.date}
   Type: ${inq.type}${inq.source ? `\n   Bureau: ${inq.source}` : ''}`).join('\n\n')
  : 'None identified'}

Generate the complete dispute letter now. Remember: NO placeholders, NO brackets, NO instructional text. This must be print-ready.`;

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
    const letter = data.choices?.[0]?.message?.content;

    if (!letter) {
      return new Response(JSON.stringify({ error: "Failed to generate letter content" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
