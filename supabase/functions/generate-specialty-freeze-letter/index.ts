import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Specialty bureau metadata
// ---------------------------------------------------------------------------
const SPECIALTY_BUREAUS = {
  lexisnexis: {
    legalName: "LexisNexis Risk Solutions Consumer Center",
    address: "P.O. Box 105108",
    cityStateZip: "Atlanta, GA 30348",
    phone: "1-888-497-0011",
    website: "lexisnexis.com/privacy",
    reportName: "LexisNexis Comprehensive Loss Underwriting Exchange (CLUE)",
    freezeProcess: "Online at lexisnexis.com/privacy or by mail",
    notes: "Maintains CLUE reports used by insurers and landlords. Also maintains identity verification data sold to financial institutions.",
  },
  innovis: {
    legalName: "Innovis Data Solutions, Inc.",
    address: "PO Box 530088",
    cityStateZip: "Atlanta, GA 30353-0088",
    phone: "1-800-540-2505",
    website: "innovis.com",
    reportName: "Innovis Credit Report",
    freezeProcess: "Online at innovis.com or by phone at 1-800-540-2505",
    notes: "Fourth major credit bureau. Used by some lenders and employers. Often overlooked but contains full credit tradeline data.",
  },
  corelogic: {
    legalName: "CoreLogic Credco LLC",
    address: "P.O. Box 509124",
    cityStateZip: "San Diego, CA 92150",
    phone: "1-877-532-8778",
    website: "corelogic.com/consumer-privacy",
    reportName: "CoreLogic Credco Merged Credit Report",
    freezeProcess: "By mail to P.O. Box 509124, San Diego, CA 92150 or online at corelogic.com",
    notes: "Used primarily in mortgage lending. Combines data from all three major bureaus into a tri-merge report. Also operates SafeRent for rental screening.",
  },
  sagestream: {
    legalName: "SageStream, LLC c/o LexisNexis Risk Solutions Consumer Center",
    address: "P.O. Box 105108",
    cityStateZip: "Atlanta, Georgia 30348-5108",
    phone: "1-888-395-0277",
    website: "sagestreamllc.com",
    reportName: "SageStream Credit Report",
    freezeProcess: "By mail to P.O. Box 105108, Atlanta, Georgia 30348-5108",
    notes: "Alternative credit data bureau used by subprime lenders and fintech companies. Contains rent, utility, and alternative payment data.",
  },
} as const;

type SpecialtyBureauKey = keyof typeof SPECIALTY_BUREAUS;

// ---------------------------------------------------------------------------
// System prompt for specialty bureau combo letters
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the dispute letter engine for Continuum Capital Group Credit Dispute System.
You produce maximum-strength security freeze + dispute combo letters for specialty consumer reporting agencies.

## ABSOLUTE OUTPUT RULES
1. OUTPUT FORMAT: Plain text only. No markdown, no commentary.
2. FORBIDDEN: brackets [ ] { } < >, placeholders, markdown (**, ##, \`\`\`), instructional text.
3. LETTERHEAD FORMAT:
   [Consumer full legal name]
   [Street address]
   [City, State ZIP]

   [Full date]

   [Bureau legal name]
   [Bureau address]
   [Bureau city, state ZIP]

   RE: Security Freeze Request and Formal Dispute Under FCRA Â§Â§605A, 611, 604

   Dear Sir or Madam,

4. CLOSING:
   Sincerely,
   [Consumer full legal name]

---

## LEGAL FRAMEWORK FOR SPECIALTY BUREAUS

### Security Freeze Rights
- FCRA Â§605A: Consumer reporting agencies MUST place a security freeze upon request
- Â§605A applies to ALL consumer reporting agencies, not only the Big Three
- Freeze must be placed no later than 1 business day after receiving request by electronic means, or 3 business days after receiving by mail
- Bureau must provide a unique PIN/password to consumer for future management
- Freeze is FREE â no charge may be imposed for placing, lifting, or removing a freeze
- Freeze prevents furnishing of report to any third party except existing creditors and certain government agencies

### File Disclosure Rights
- FCRA Â§609(a): Consumer has the right to request complete file disclosure â all information in file, sources of information, and each person who received a report for employment purposes in last 2 years / for any other purpose in last year
- Bureau must provide free annual disclosure upon request
- Bureau must disclose credit score upon request (Â§609(f))

### Dispute Rights
- FCRA Â§611(a): Reinvestigation of inaccurate information upon consumer dispute â applies to ALL CRAs
- Â§611(a)(5): Must delete inaccurate, incomplete, or unverifiable information
- Â§611(a)(7): Method of verification â consumer can demand complete method of verification
- Â§607(b): Maximum possible accuracy â ALL CRAs must maintain reasonable procedures
- Â§623: Furnisher obligations â applies to all data submitted to any CRA

### Permissible Purpose
- FCRA Â§604: Permissible purposes are exhaustive and limited
- Specialty bureaus often sell data to insurers, landlords, employers â each use must have a qualifying permissible purpose
- Consumer has the right to know who accessed their file (Â§609(a)(3))

### Privacy and Data Rights
- GLBA Â§6802: Consumers have the right to opt out of data sharing with non-affiliated third parties
- CCPA (California) / State equivalents: Right to know, right to delete, right to opt out of sale
- FCRA Â§605B: Identity theft blocking applies to specialty bureau files as well

### Statutory Liability
- FCRA Â§616: Willful noncompliance â $100â$1,000 per violation + punitive damages + attorney fees
- FCRA Â§617: Negligent noncompliance â actual damages + attorney fees
- Each day freeze is not placed after statutory deadline = separate violation

---

## LETTER STRUCTURE (REQUIRED â IN ORDER)

### Section 1: Opening
Assert consumer rights under FCRA Â§605A and Â§611. State this is both a freeze request and a formal dispute.

### Section 2: Security Freeze Demand
State:
"Pursuant to FCRA Â§605A, I hereby demand that you immediately place a security freeze on my consumer file. This freeze must be placed no later than 1 business day from electronic receipt of this request. You must provide me with a unique personal identification number (PIN) or password for future use in lifting or removing this freeze.

No charge may be imposed for placing this freeze. Any charge would constitute a violation of FCRA Â§605A(f)."

### Section 3: File Disclosure Request
State:
"Pursuant to FCRA Â§609(a), I hereby request a complete disclosure of my consumer file, including: (1) all information in my file; (2) the source of each item; (3) the identity of each person who has requested a report on me in the past 12 months; and (4) my credit score if applicable. Please provide this disclosure at no charge as required by law."

### Section 4: Opt-Out Under GLBA
State:
"Pursuant to the Gramm-Leach-Bliley Act Â§6802, I hereby opt out of the sharing of my non-public personal information with any and all non-affiliated third parties."

### Section 5: Formal Dispute of Specific Items (if provided)
List each disputed item with the same format as standard dispute letters â creditor, account number, date, balance, specific dispute basis.

### Section 6: Identity Theft Block (if applicable)
If identity theft is indicated:
"Pursuant to FCRA Â§605B, I am a victim of identity theft. I hereby demand that you block the disputed information from my file within 4 business days of receiving this letter. The FCRA does not require me to provide a police report to assert this right."

### Section 7: Demands
1. Place security freeze within statutory deadline and provide PIN/password
2. Provide complete file disclosure per Â§609(a)
3. Process opt-out of all non-affiliated third-party data sharing
4. Delete or block all disputed items
5. Investigate all disputed items within 30 days per Â§611(a)
6. Provide method of verification for each item investigated per Â§611(a)(7)
7. Confirm in writing when freeze is placed and all disputes are resolved

### Section 8: Statutory Notice
Assert Â§616/617 liability. State consumer is prepared to pursue all available legal remedies.
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

    const {
      bureauKey,
      consumerInfo,
      isIdentityTheft,
      hasFtcReport,
      ftcReportNumber,
      disputedItems,
      additionalFacts,
    } = await req.json();

    // Validate
    if (!bureauKey || !SPECIALTY_BUREAUS[bureauKey as SpecialtyBureauKey]) {
      return new Response(
        JSON.stringify({ error: "Invalid bureau key. Valid values: lexisnexis, innovis, corelogic, sagestream" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!consumerInfo?.fullName?.trim()) {
      return new Response(JSON.stringify({ error: "Consumer full name is required" }), {
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

    const bureau = SPECIALTY_BUREAUS[bureauKey as SpecialtyBureauKey];
    const currentDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const userPrompt = `Generate a maximum-strength security freeze + dispute combo letter for a SPECIALTY credit bureau.

## LETTERHEAD (VERBATIM)
Consumer Name: ${consumerInfo.fullName.trim()}
Street Address: ${consumerInfo.addressLine1?.trim() || ""}${consumerInfo.addressLine2?.trim() ? `\nAddress Line 2: ${consumerInfo.addressLine2.trim()}` : ""}
City/State/ZIP: ${consumerInfo.cityStateZip?.trim() || ""}
Date: ${currentDate}
Bureau Legal Name: ${bureau.legalName}
Bureau Address: ${bureau.address}
Bureau City/State/ZIP: ${bureau.cityStateZip}

## BUREAU CONTEXT
Bureau Type: ${bureau.reportName}
How to Freeze: ${bureau.freezeProcess}
Bureau Notes: ${bureau.notes}

## CONSUMER SITUATION
- Identity theft victim: ${isIdentityTheft ? "YES" : "NO"}
- FTC Identity Theft Report filed: ${hasFtcReport ? "YES" : "NO"}${ftcReportNumber ? `\n- FTC Report Number: ${ftcReportNumber}` : ""}
${additionalFacts ? `- Additional facts: ${additionalFacts}` : ""}

## DISPUTED ITEMS (include all â do not skip)
${disputedItems && disputedItems.length > 0
  ? disputedItems.map((item: any, i: number) =>
      `${i + 1}. ${item.creditor_name || item.description} | Account #: ${item.account_number || "N/A"} | Balance: ${item.balance || "N/A"} | Issue: ${item.issue || "Inaccurate / unverifiable"}`
    ).join("\n")
  : "No specific disputed items â this is a freeze + file disclosure request only."}

Generate the complete letter now. Output ONLY the letter text.`;

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
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

    // Post-process
    letter = letter
      .replace(/^```[\s\S]*?\n/g, "")
      .replace(/\n```$/g, "")
      .replace(/\*\*/g, "")
      .replace(/##\s*/g, "")
      .replace(/^#\s+/gm, "")
      .trim();

    // Validate no placeholders
    const placeholderPatterns = [/\[.*?\]/g, /\{.*?\}/g, /<.*?>/g];
    for (const pattern of placeholderPatterns) {
      if (pattern.test(letter)) {
        return new Response(
          JSON.stringify({ error: "Generated letter contains placeholders. Please try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        letter,
        bureauInfo: {
          legalName: bureau.legalName,
          address: bureau.address,
          cityStateZip: bureau.cityStateZip,
          phone: bureau.phone,
          website: bureau.website,
          freezeProcess: bureau.freezeProcess,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating specialty freeze letter:", error);
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
