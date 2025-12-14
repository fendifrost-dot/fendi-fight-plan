import { Copy, Check, FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const templates = [
  {
    id: "round1",
    title: "Round 1: Certified Mail Dispute Letter",
    description: "Your initial dispute letter to the credit bureau. Send certified mail with return receipt.",
    template: `[YOUR FULL NAME]
[YOUR ADDRESS]
[CITY, STATE ZIP]
[DATE]

[BUREAU NAME]
[BUREAU ADDRESS]

RE: Formal Dispute Under FCRA §611 and §602(a)

To Whom It May Concern:

I am writing to formally dispute inaccurate information contained in my credit file. Under the Fair Credit Reporting Act, Section 611 (15 U.S.C. § 1681i), you are required to conduct a reasonable investigation of the disputed items within 30 days.

PERSONAL INFORMATION DISPUTES:

The following names on my file are NOT mine and must be removed:
• [INCORRECT NAME 1]
• [INCORRECT NAME 2]

The following addresses have NEVER been associated with me:
• [INCORRECT ADDRESS 1]
• [INCORRECT ADDRESS 2]

The following employers are INACCURATE:
• [INCORRECT EMPLOYER]

ACCOUNT DISPUTES:

I am disputing the following accounts which are [inaccurate/not mine/result of identity theft]:

1. Creditor: [CREDITOR NAME]
   Account Number: [ACCOUNT NUMBER]
   Date Opened: [DATE OPENED]
   Reason for Dispute: [REASON]

2. Creditor: [CREDITOR NAME]
   Account Number: [ACCOUNT NUMBER]
   Date Opened: [DATE OPENED]
   Reason for Dispute: [REASON]

INQUIRY DISPUTES:

The following inquiries were NOT authorized by me:
• [INQUIRY COMPANY] - [INQUIRY DATE]
• [INQUIRY COMPANY] - [INQUIRY DATE]

Per FCRA §602(a), accuracy in consumer reporting is a matter of national concern. Per §607(b), you must follow reasonable procedures to assure maximum possible accuracy. The presence of these inaccuracies demonstrates a failure in your verification procedures.

I demand that you:
1. Conduct a thorough investigation of each disputed item
2. Provide me with the method of verification for any item you verify as accurate
3. Delete all items you cannot verify
4. Send me an updated credit report upon completion

I have enclosed copies of my government-issued ID and proof of address for verification purposes.

This letter was sent via certified mail. I expect a response within 30 days as required by law.

Sincerely,

[YOUR SIGNATURE]
[YOUR FULL NAME]

Enclosures:
- Copy of government-issued ID
- Proof of address`,
  },
  {
    id: "mov",
    title: "Method of Verification (MoV) Demand Letter",
    description: "Request how the bureau verified disputed items. Use after partial deletion.",
    template: `[YOUR FULL NAME]
[YOUR ADDRESS]
[CITY, STATE ZIP]
[DATE]

[BUREAU NAME]
[BUREAU ADDRESS]

RE: Demand for Method of Verification Under FCRA §611(a)(7)

To Whom It May Concern:

I received your investigation results dated [RESPONSE DATE] regarding my dispute filed on [DISPUTE DATE]. You claim to have verified certain items as accurate, yet you have failed to provide the legally required method of verification.

Under FCRA §611(a)(7), upon completion of a reinvestigation, you MUST provide me with "a description of the procedure used to determine the accuracy and completeness of the information" for any disputed item that was not deleted.

You verified the following items without providing this mandatory information:

1. Creditor: [CREDITOR NAME]
   Account Number: [ACCOUNT NUMBER]
   Date Opened: [DATE OPENED]

2. Creditor: [CREDITOR NAME]
   Account Number: [ACCOUNT NUMBER]
   Date Opened: [DATE OPENED]

I DEMAND that you provide:
1. The exact method used to verify each disputed item
2. The name and contact information of the person who conducted the verification
3. The documents reviewed during verification
4. The date the verification was conducted

Your failure to provide this information within 15 days will be documented as willful noncompliance with the FCRA, which carries statutory damages of $100-$1,000 per violation plus punitive damages.

This is not a new dispute. This is a demand for legally required information you failed to provide.

Certified Mail Tracking: [TRACKING NUMBER]

Sincerely,

[YOUR SIGNATURE]
[YOUR FULL NAME]`,
  },
  {
    id: "cfpb-what",
    title: "CFPB Complaint: What Happened",
    description: "The narrative section of your CFPB complaint explaining the bureau's violations.",
    template: `I submitted a formal dispute to [BUREAU NAME] on [DISPUTE DATE] via certified mail (tracking: [TRACKING NUMBER]). I disputed the following items:

WRONG PERSONAL INFORMATION:
- Names that are not mine: [LIST NAMES]
- Addresses I've never lived at: [LIST ADDRESSES]

DISPUTED ACCOUNTS:
- [CREDITOR] Account #[ACCOUNT NUMBER], opened [DATE] - [REASON]
- [CREDITOR] Account #[ACCOUNT NUMBER], opened [DATE] - [REASON]

UNAUTHORIZED INQUIRIES:
- [COMPANY] on [DATE]
- [COMPANY] on [DATE]

On [RESPONSE DATE], I received [BUREAU NAME]'s response. They [verified all items without investigation / dismissed my dispute claiming they couldn't verify my identity / failed to respond within 30 days / other violation].

This violates:
1. FCRA §611 - Failure to conduct reasonable investigation
2. FCRA §607(b) - Failure to follow reasonable procedures for accuracy
3. FCRA §611(a)(7) - Failure to provide method of verification
[If identity theft: 4. FCRA §605B - Failure to block fraudulent accounts with identity theft report]

I have provided:
- Government-issued ID
- Proof of address
[If applicable: - FTC Identity Theft Report dated [DATE]]
[If applicable: - Police Report #[NUMBER]]

Despite proper documentation, [BUREAU NAME] has failed to comply with federal law.`,
  },
  {
    id: "cfpb-remedy",
    title: "CFPB Complaint: Requested Remedy",
    description: "What you want the bureau to do to resolve your complaint.",
    template: `I request that the CFPB order [BUREAU NAME] to:

1. DELETE all disputed items they cannot verify through documented procedures:
   - Account: [CREDITOR] #[ACCOUNT NUMBER]
   - Account: [CREDITOR] #[ACCOUNT NUMBER]
   - Inquiry: [COMPANY] dated [DATE]
   - All incorrect names and addresses

2. PROVIDE written documentation of their investigation procedures and method of verification for any item they maintain as accurate

3. BLOCK all fraudulent accounts under FCRA §605B [if identity theft applies]

4. PROVIDE a corrected credit report reflecting all deletions

5. CEASE reporting the disputed items to any third party until properly verified

6. COMPENSATE me for damages including:
   - Denial of credit/employment/housing due to inaccurate reporting
   - Time spent disputing inaccurate information
   - Emotional distress caused by their willful noncompliance

I reserve all rights under FCRA to pursue statutory and punitive damages if [BUREAU NAME] continues their pattern of noncompliance.`,
  },
  {
    id: "bbb",
    title: "BBB Complaint",
    description: "File with Better Business Bureau after CFPB if bureau remains noncompliant.",
    template: `I am filing this complaint against [BUREAU NAME] for repeated violations of the Fair Credit Reporting Act and failure to respond to formal disputes and regulatory complaints.

TIMELINE OF NONCOMPLIANCE:

1. [DISPUTE DATE]: I mailed a certified dispute letter to [BUREAU NAME]
2. [RESPONSE DATE]: Bureau responded by [verifying everything / dismissing dispute / other]
3. [CFPB DATE]: I filed CFPB complaint #[COMPLAINT NUMBER]
4. [CFPB RESPONSE DATE]: Bureau responded to CFPB by [describe response]

Despite multiple attempts through proper channels, [BUREAU NAME] has:
- Failed to conduct reasonable investigations
- Failed to provide legally required method of verification
- [Continued reporting inaccurate information / Dismissed valid disputes / Other]

DISPUTED ITEMS STILL ON MY REPORT:
- [CREDITOR] Account #[ACCOUNT NUMBER]
- [CREDITOR] Account #[ACCOUNT NUMBER]
- Unauthorized inquiry from [COMPANY]

I have documentation of every communication including:
- Certified mail receipts
- Bureau response letters
- CFPB complaint and response

[BUREAU NAME]'s pattern of ignoring consumer rights violates federal law. I request the BBB facilitate resolution and document this complaint publicly.`,
  },
  {
    id: "ag",
    title: "Attorney General Complaint",
    description: "For repeated patterns of noncompliance or reinsertion after deletion.",
    template: `[YOUR STATE] ATTORNEY GENERAL
CONSUMER PROTECTION DIVISION

COMPLAINT AGAINST: [BUREAU NAME]

I am filing this complaint to report a pattern of willful noncompliance with the Fair Credit Reporting Act by [BUREAU NAME].

COMPLAINANT:
Name: [YOUR FULL NAME]
Address: [YOUR ADDRESS]
Phone: [YOUR PHONE]
Email: [YOUR EMAIL]

PATTERN OF VIOLATIONS:

Date: [DATE] - Action: [Describe first violation]
Date: [DATE] - Action: [Describe CFPB complaint filing]
Date: [DATE] - Action: [Describe continued noncompliance]
[If applicable] Date: [DATE] - Action: Reinsertion of previously deleted items

SPECIFIC FCRA VIOLATIONS:
1. §611 - Failure to conduct reasonable reinvestigation
2. §607(b) - Failure to maintain reasonable procedures for accuracy
3. §611(a)(7) - Failure to provide method of verification
4. §611(a)(5) - [If applicable] Reinsertion without notice
5. §605B - [If identity theft] Failure to block fraudulent information

DOCUMENTATION ATTACHED:
1. All dispute letters with certified mail receipts
2. All bureau response letters
3. CFPB complaint #[NUMBER] and bureau response
4. BBB complaint #[NUMBER] and bureau response
5. Credit reports showing continued inaccuracies

REQUESTED ACTION:
I request that the Attorney General:
1. Investigate [BUREAU NAME]'s pattern of FCRA noncompliance
2. Take enforcement action including civil penalties
3. Require [BUREAU NAME] to correct my credit report
4. Prevent future violations against other consumers

This complaint demonstrates a systematic failure to comply with federal consumer protection law. I am prepared to provide additional documentation and testimony if needed.

Respectfully submitted,

[YOUR SIGNATURE]
[YOUR FULL NAME]
[DATE]`,
  },
];

const TemplateSection = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  const copyTemplate = async (template: string, id: string) => {
    await navigator.clipboard.writeText(template);
    setCopiedId(id);
    toast({
      title: "Template copied",
      description: "Template has been copied to your clipboard",
    });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <section id="templates" className="py-20 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-full mb-6">
            <FileText className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">Templates</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-serif font-bold text-foreground mb-4">
            Ready-to-Use Templates
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Copy, customize with your information, and send. Every placeholder marked with [BRACKETS].
          </p>
        </div>

        {/* Templates */}
        <div className="space-y-6">
          {templates.map((template) => (
            <div 
              key={template.id}
              className="card-elevated rounded-xl border border-border/50 overflow-hidden"
            >
              <div className="p-6 border-b border-border/30 bg-muted/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-xl font-serif font-semibold text-foreground">
                    {template.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {template.description}
                  </p>
                </div>
                <Button
                  onClick={() => copyTemplate(template.template, template.id)}
                  className="gap-2 flex-shrink-0"
                  variant={copiedId === template.id ? "secondary" : "default"}
                >
                  {copiedId === template.id ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Template
                    </>
                  )}
                </Button>
              </div>
              <div className="p-6 max-h-[400px] overflow-y-auto">
                <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                  {template.template}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TemplateSection;
