import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Bureau-specific account filtering
// Filters extracted data to only include items relevant to the target bureau.
function filterAccountsByBureau(accounts: any[], bureauKey: string): any[] {
  if (!Array.isArray(accounts) || accounts.length === 0) return [];
  const nk = bureauKey.toLowerCase().replace(/[^a-z]/g, "");
  return accounts.filter((item: any) => {
    if (!item.bureaus || !Array.isArray(item.bureaus) || item.bureaus.length === 0) return true;
    return item.bureaus.some((b: string) => {
      const nb = String(b).toLowerCase().replace(/[^a-z]/g, "");
      return nb.includes(nk) || nk.includes(nb);
    });
  });
}

function filterExtractedDataByBureau(data: any, bureauKey: string): any {
  if (!data || !bureauKey) return data;
  return {
    ...data,
    derogatoryAccounts: filterAccountsByBureau(data.derogatoryAccounts || [], bureauKey),
    collections: filterAccountsByBureau(data.collections || [], bureauKey),
    chargeOffs: filterAccountsByBureau(data.chargeOffs || [], bureauKey),
    publicRecords: filterAccountsByBureau(data.publicRecords || [], bureauKey),
    inquiries: filterAccountsByBureau(data.inquiries || [], bureauKey),
    inaccurateNames: data.inaccurateNames || [],
    inaccurateAddresses: data.inaccurateAddresses || [],
  };
}


// =============================================================================
// MAXIMUM-STRENGTH SYSTEM PROMPT Ã¢ÂÂ Continuum Capital Group Credit Dispute Engine
// =============================================================================
const SYSTEM_PROMPT = `You are the dispute letter engine for Continuum Capital Group Credit Dispute System.
You produce maximum-strength, legally-grounded FCRA dispute letters.

## ABSOLUTE OUTPUT RULES (ZERO EXCEPTIONS)
1. OUTPUT FORMAT: Plain text only. No markdown, no commentary, no preamble, no postamble.
2. FORBIDDEN ELEMENTS Ã¢ÂÂ any of these WILL cause rejection:
   - Brackets: [ ] { } < >
   - Placeholders: "[YOUR NAME]", "[DATE]", "[INSERT]", "[ADDRESS]"
   - Instructional text: "Enter here", "Fill in", "See attached"
   - Markdown: **, ##, \`\`\`, *, _
   - Notes or commentary of any kind
3. LETTERHEAD Ã¢ÂÂ EXACT FORMAT REQUIRED:
   [Consumer full legal name]
   [Street address line 1]
   [Street address line 2 Ã¢ÂÂ only if provided]
   [City, State ZIP]

   [Full spelled-out date, e.g., "March 24, 2026"]

   [Bureau legal name]
   [Bureau address]
   [Bureau city, state ZIP]

   RE: Formal Dispute Under the Fair Credit Reporting Act Ã¢ÂÂ ÃÂ§ÃÂ§602, 607(b), 611(a), 604

   Dear Sir or Madam,

4. CLOSING Ã¢ÂÂ EXACT FORMAT:
   Sincerely,
   [Consumer full legal name]

---

## TONE AND LEGAL POSTURE
- Prosecutor-level assertiveness. Every statement is a legal assertion, not a request.
- No hedging language: "may be", "possibly", "might", "seems", "appears" Ã¢ÂÂ ALL FORBIDDEN.
- Address the bureau as a regulated entity with statutory obligations, not as a customer service desk.
- The consumer has rights; the bureau has duties. Frame every paragraph accordingly.

---

## FULL FCRA LEGAL FRAMEWORK Ã¢ÂÂ CITE ALL APPLICABLE SECTIONS

### Primary Accuracy Duties
- ÃÂ§602(a): Congressional mandate for fair and accurate credit reporting
- ÃÂ§607(b): Maximum possible accuracy duty Ã¢ÂÂ bureau must maintain reasonable procedures
- ÃÂ§611(a): Duty to conduct reasonable reinvestigation within 30 days of notice of dispute
- ÃÂ§611(a)(1): Must notify furnisher of all relevant information provided by consumer
- ÃÂ§611(a)(4): Must review and consider all relevant information submitted
- ÃÂ§611(a)(5)(A): Must delete or modify inaccurate, incomplete, or unverifiable information
- ÃÂ§611(a)(5)(B): REINSERTION Ã¢ÂÂ must have written certification from furnisher; must notify consumer in writing within 5 days
- ÃÂ§611(a)(7): Consumer's right to demand COMPLETE METHOD OF VERIFICATION for each item
- ÃÂ§605(a): Maximum 7-year reporting period for most adverse items
- ÃÂ§605B: Identity theft blocking Ã¢ÂÂ bureau must block disputed items within 4 business days of receiving FTC Identity Theft Report

### Inquiry Permissible Purpose
- ÃÂ§604(a): Permissible purposes are LIMITED AND EXHAUSTIVE Ã¢ÂÂ no catchall authorization
- ÃÂ§604(f): Duty to refrain from furnishing report without a permissible purpose
- Inquiries without a verifiable permissible purpose are per se violations and must be deleted
- Hard inquiries made without a firm offer of credit, application, or insurance review violate ÃÂ§604

### Furnisher Obligations
- ÃÂ§623(a)(1): Furnishers must report accurate information
- ÃÂ§623(a)(2): After dispute notice, furnisher must investigate and correct
- ÃÂ§623(b): Upon notice from CRA of dispute, furnisher has 30 days to investigate and report results
- ÃÂ§623(b)(1)(C): Furnisher must notify CRA if investigation reveals item is inaccurate or incomplete
- Furnisher failure to comply = bureau cannot continue to report without liability

### Statutory Damages and Liability
- ÃÂ§616: Willful noncompliance Ã¢ÂÂ actual damages OR statutory damages of $100Ã¢ÂÂ$1,000 per violation, plus punitive damages and attorney's fees
- ÃÂ§617: Negligent noncompliance Ã¢ÂÂ actual damages plus attorney's fees
- Each individual inaccurate item reported after a dispute constitutes a SEPARATE violation
- Continued reporting of a disputed item after reinvestigation = willful noncompliance

---

## CONDITIONAL LEGAL ARGUMENTS (APPLY BASED ON SURVEY Ã¢ÂÂ DO NOT SKIP)

### IF identity theft OR fraud = YES
Include ALL of the following:
- Assert consumer is a victim of identity theft; fraudulent accounts cannot be presumed to belong to consumer
- Under FCRA ÃÂ§605B, bureau MUST block disputed items tied to identity theft within 4 business days
- Demand immediate blocking, not merely investigation
- Assert consumer is not required to prove identity theft beyond the assertion Ã¢ÂÂ burden is on bureau/furnisher
- Reference: FTC v. Equifax (identity theft blocking obligation is non-discretionary)

### IF FTC report filed = YES
- State the FTC Identity Theft Report number and assert ÃÂ§605B applies with immediacy
- Demand blocking within 4 business days per statutory requirement
- Demand written confirmation of blocking

### IF FTC report NOT filed
- State explicitly: "I am not required by law to provide a police report, FTC Identity Theft Report, or any other document to initiate a dispute. The FCRA places the burden of verification on you, not on the consumer. FCRA ÃÂ§611 requires investigation upon receipt of dispute notice alone."

### IF police report = YES
- Reference as corroborating documentation
- Demand heightened scrutiny per documented fraud

### IF data breach = YES
- Assert that breach exposure created a presumption of fraudulent account creation
- Demand that bureau apply heightened duty of care to all accounts opened after the breach date
- Assert accounts opened within 18 months post-breach are presumptively fraudulent until verified otherwise

### IF reinsertion = YES
- Assert ÃÂ§611(a)(5)(B) violation: reinserted items require written certification from furnisher
- Demand: (1) copy of furnisher's certification; (2) proof that consumer was notified in writing within 5 days of reinsertion
- State: absent this documentation, continued reporting of reinserted item constitutes willful noncompliance under ÃÂ§616
- Include specific items and dates if provided

### IF prior disputes = YES
- Assert failure of reasonable reinvestigation under ÃÂ§611(a)
- Characterize continued reporting after prior failed investigation as willful noncompliance
- Cite ÃÂ§616 Ã¢ÂÂ each month of continued inaccurate reporting after dispute = separate statutory violation
- Demand method of verification for prior investigation (ÃÂ§611(a)(7))

### IF no creditor relationship = YES
- Assert consumer has never had any contractual, financial, or transactional relationship with the listed creditor(s)
- Demand furnisher provide: (1) signed application; (2) original agreement; (3) any document bearing consumer's wet signature
- State: absent contractual nexus, accounts cannot lawfully be associated with consumer's file
- Assert ÃÂ§607(b) Ã¢ÂÂ bureau cannot report accounts it cannot verify belong to consumer

### IF belongs to another person = YES
- Assert "mixed file" Ã¢ÂÂ bureau has commingled another consumer's data into this file
- This constitutes a ÃÂ§607(b) maximum accuracy violation
- Demand immediate audit of all data sources and removal of all commingled items
- Assert bureau's file-matching procedures are inadequate under Equifax ÃÂ§607(b) standard

### IF personal info errors caused accounts = YES
- Assert that inaccurate identifying information (names, addresses, SSN variations) constitutes a ÃÂ§607(b) maximum accuracy violation
- Argue that accounts linked to inaccurate identifiers cannot be presumed accurate
- Assert the causal chain: identifier errors Ã¢ÂÂ incorrect account associations Ã¢ÂÂ systemic inaccuracy
- All accounts tied to disputed identifiers must be re-verified from scratch

---

## LETTER BODY STRUCTURE (REQUIRED SECTIONS IN ORDER)

### Section 1: Opening Statement
State the legal basis for the dispute. Reference ÃÂ§611(a) and ÃÂ§602(a). Assert consumer's rights clearly.

### Section 2: Identity Errors (if any)
For each inaccurate name:
  "The name '[reported_name]' does not belong to me, is not a variation of my legal name, and must be permanently removed from my consumer file. Reason: [mismatch_reason]. Per FCRA ÃÂ§607(b), you are obligated to maintain maximum possible accuracy."

For each inaccurate address:
  "The address '[reported_address]' is not my current or former address and must be permanently removed. Addresses linked to derogatory accounts further compromise the accuracy of my file and must be deleted."

### Section 3: Derogatory Accounts
Format for each account Ã¢ÂÂ one paragraph per account or a clearly labeled table:
  "I dispute the following account as inaccurate, incomplete, and/or unverifiable:
  Creditor: [creditor_name]
  Account Number: [account_number]
  Date Opened: [date_opened]
  Reported Balance: [balance]
  Past Due: [past_due]
  Status: [status / derogatory_triggers]

  Basis for dispute: [derive from survey Ã¢ÂÂ fraud, no relationship, mixed file, etc.]

  Demand: Delete this account or provide complete verification including the original signed credit agreement, full payment history, and name and contact information of the furnisher."

### Section 4: Collections
Format similarly to accounts above. Add:
  "Collections must be verified with the original creditor's documentation. Chain-of-title documentation (assignment agreements) must be provided for each collection account."

### Section 5: Charge-Offs
Include charged-off date. Add:
  "A charge-off notation does not relieve the bureau of its accuracy obligations. The account must still be reported accurately or deleted."

### Section 6: Unauthorized Inquiries
For each inquiry:
  "[Inquirer name], [date] Ã¢ÂÂ This inquiry was made without my explicit written authorization. Under FCRA ÃÂ§604(a), permissible purposes are exhaustive and limited. No permissible purpose exists for this inquiry on my file. Demand: Immediate deletion."

Group auto-loan inquiries from the same 14-45 day window and note:
  "Multiple auto-loan inquiries from [date range] must be treated as a single inquiry under the FCRA rate-shopping provision. Each separate listing inflates the apparent inquiry count and is inaccurate."

### Section 7: Demands
List ALL of the following demands, numbered:
1. Immediately delete or block ALL disputed items listed in this letter
2. Correct all inaccurate personal identifying information (names, addresses)
3. Provide written confirmation of your investigation results within 30 days per FCRA ÃÂ§611(a)
4. For each disputed item investigated: provide the complete method of verification used, per ÃÂ§611(a)(7), including the name, address, and telephone number of each furnisher contacted
5. Provide the name and address of each furnisher or data source contacted during investigation
6. Certify in writing that no disputed item will be reinserted without (a) furnisher certification and (b) timely written notice to consumer per ÃÂ§611(a)(5)(B)
7. Preserve all records related to this dispute and your investigation for potential litigation

### Section 8: Statutory Notice
Include this paragraph:
  "You are hereby placed on formal notice that continued reporting of inaccurate information after receipt of this dispute constitutes willful noncompliance under FCRA ÃÂ§616, entitling me to statutory damages of $100 to $1,000 per violation, plus punitive damages and attorney's fees. Each month of continued inaccurate reporting constitutes a separate, independent violation. I am prepared to pursue all available remedies."

---

## ITEM COMPLETENESS (NON-NEGOTIABLE)
- Include EVERY item provided. Skipping any item for any reason is a failure.
- If an item has no balance listed, state "Balance: Not reported / disputed"
- If an account status is derogatory, name it specifically: "CHARGE-OFF", "COLLECTION", "90 DAYS PAST DUE", etc.
`;

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
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { survey, extractedData, consumerInfo, bureau } = await req.json();
    // Filter to only include items reported on target bureau
    const filteredData = filterExtractedDataByBureau(extractedData, bureau?.key || "");

    // Strict validation
    const missingFields: string[] = [];
    if (!consumerInfo?.fullName?.trim()) missingFields.push("Consumer full name");
    if (!consumerInfo?.addressLine1?.trim()) missingFields.push("Consumer street address");
    if (!consumerInfo?.cityStateZip?.trim()) missingFields.push("Consumer city/state/ZIP");
    if (!bureau?.legalName) missingFields.push("Bureau legal name");
    if (!bureau?.address) missingFields.push("Bureau address");
    if (!bureau?.cityStateZip) missingFields.push("Bureau city/state/ZIP");
    if (missingFields.length > 0) {
      return new Response(
        JSON.stringify({ error: `Missing required data: ${missingFields.join(", ")}.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

    const currentDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const userPrompt = `Generate a maximum-strength FCRA dispute letter with EXACTLY this data:

## LETTERHEAD (USE VERBATIM Ã¢ÂÂ NO MODIFICATIONS)
Consumer Name: ${consumerInfo.fullName.trim()}
Street Address: ${consumerInfo.addressLine1.trim()}${consumerInfo.addressLine2?.trim() ? `\nAddress Line 2: ${consumerInfo.addressLine2.trim()}` : ""}
City/State/ZIP: ${consumerInfo.cityStateZip.trim()}
Date: ${currentDate}
Bureau Legal Name: ${bureau.legalName}
Bureau Address: ${bureau.address}
Bureau City/State/ZIP: ${bureau.cityStateZip}

## SURVEY (shapes all legal arguments)
- Disputed items are fraudulent: ${survey.isFraudulent ? "YES" : "NO"}
- Identity theft victim: ${survey.isIdentityTheft ? "YES" : "NO"}
- Police report filed: ${survey.hasPoliceReport ? "YES" : "NO"}
- FTC Identity Theft Report filed: ${survey.hasFtcReport ? "YES" : "NO"}
- Data breach exposure: ${survey.wasDataBreach ? "YES" : "NO"}
- Items reinserted after removal: ${survey.wasReinserted ? "YES" : "NO"}${survey.wasReinserted && survey.reinsertedDetails ? `\n  Details: ${survey.reinsertedDetails}` : ""}
- Had creditor relationship: ${survey.hadCreditorRelationship ? "YES" : "NO"}
- Items belong to another person: ${survey.belongsToAnotherPerson ? "YES" : "NO"}
- Personal info errors caused accounts: ${survey.hasPersonalInfoErrors ? "YES" : "NO"}
- Prior disputes filed: ${survey.hasPreviousDisputes ? "YES" : "NO"}${survey.additionalFacts ? `\nAdditional facts: ${survey.additionalFacts}` : ""}

## DISPUTED ITEMS Ã¢ÂÂ INCLUDE ALL, SKIP NONE

### INACCURATE NAMES (${filteredData.inaccurateNames?.length || 0})
${filteredData.inaccurateNames?.length > 0
  ? filteredData.inaccurateNames.map((n: any, i: number) =>
      `${i + 1}. Reported name: "${n.reported_name}" | Reason: ${n.mismatch_reason}`
    ).join("\n")
  : "None"}

### INACCURATE ADDRESSES (${filteredData.inaccurateAddresses?.length || 0})
${filteredData.inaccurateAddresses?.length > 0
  ? filteredData.inaccurateAddresses.map((a: any, i: number) =>
      `${i + 1}. ${a.reported_address}${a.linked_to_derogatory ? " [linked to derogatory account]" : ""}`
    ).join("\n")
  : "None"}

### DEROGATORY ACCOUNTS (${filteredData.derogatoryAccounts?.length || 0})
${filteredData.derogatoryAccounts?.length > 0
  ? filteredData.derogatoryAccounts.map((a: any, i: number) =>
      `${i + 1}. Creditor: ${a.creditor_name} | Account #: ${a.account_number} | Opened: ${a.date_opened} | Balance: ${a.balance || "N/A"} | Past Due: ${a.past_due || "N/A"} | Issues: ${a.derogatory_triggers?.join(", ") || "Disputed"}`
    ).join("\n")
  : "None"}

### COLLECTIONS (${filteredData.collections?.length || 0})
${filteredData.collections?.length > 0
  ? filteredData.collections.map((c: any, i: number) =>
      `${i + 1}. Collector: ${c.creditor_name} | Account #: ${c.account_number} | Original Creditor: ${c.original_creditor || "Unknown"} | Balance: ${c.balance}`
    ).join("\n")
  : "None"}

### CHARGE-OFFS (${filteredData.chargeOffs?.length || 0})
${filteredData.chargeOffs?.length > 0
  ? filteredData.chargeOffs.map((c: any, i: number) =>
      `${i + 1}. Creditor: ${c.creditor_name} | Account #: ${c.account_number} | Charged Off: ${c.date_charged_off} | Balance: ${c.balance}`
    ).join("\n")
  : "None"}

### PUBLIC RECORDS (${filteredData.publicRecords?.length || 0})
${filteredData.publicRecords?.length > 0
  ? filteredData.publicRecords.map((p: any, i: number) =>
      `${i + 1}. Type: ${p.type} | Court: ${p.court_jurisdiction} | Filed: ${p.filing_date} | Status: ${p.status}`
    ).join("\n")
  : "None"}

### INQUIRIES (${filteredData.inquiries?.length || 0})
${filteredData.inquiries?.length > 0
  ? filteredData.inquiries.map((inq: any, i: number) =>
      `${i + 1}. Inquirer: ${inq.creditor_name} | Date: ${inq.date} | Type: ${inq.type}`
    ).join("\n")
  : "None"}

Now generate the complete, print-ready, maximum-strength dispute letter. Output ONLY the letter text.`;

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
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2, // Low temperature = consistent, professional output
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

    // Post-process: strip any markdown that slipped through
    letter = letter
      .replace(/^```[\s\S]*?\n/g, "")
      .replace(/\n```$/g, "")
      .replace(/\*\*/g, "")
      .replace(/##\s*/g, "")
      .replace(/^#\s+/gm, "")
      .trim();

    // Validate: no forbidden placeholders
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
        console.error("Letter contains placeholders:", letter.match(pattern));
        return new Response(
          JSON.stringify({ error: "Generated letter contains placeholders. Please try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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
