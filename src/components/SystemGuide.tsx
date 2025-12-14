import DisputeStep from "./DisputeStep";
import { AlertTriangle, CheckCircle, FileText, Lock, Mail, Search, Shield, Target } from "lucide-react";

const SystemGuide = () => {
  return (
    <section id="system" className="py-20 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-full mb-6">
            <FileText className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">The Foundation</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-serif font-bold text-foreground mb-4">
            The Step-by-Step System
          </h2>
          <p className="text-muted-foreground text-lg">
            Do this first. Every step matters. No shortcuts.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          <DisputeStep stepNumber={1} title="Freeze Verification Databases" defaultOpen={true}>
            <div className="flex items-start gap-3 mb-4">
              <Lock className="w-5 h-5 text-primary flex-shrink-0 mt-1" />
              <p className="text-foreground">
                Freeze <strong>LexisNexis</strong>, <strong>CoreLogic</strong>, and <strong>Innovis</strong> BEFORE disputing anything.
              </p>
            </div>
            
            <div className="bg-muted/50 rounded-lg p-4 border border-border/50 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  <strong className="text-foreground">LexisNexis will email/mail a PIN and/or confirmation number.</strong> Keep this PIN/confirmation to unfreeze quickly when needed.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  <strong className="text-foreground">For funding approvals</strong>: Temporarily unfreeze LexisNexis because Equifax and lenders often rely on LN for identity verification.
                </p>
              </div>
            </div>
          </DisputeStep>

          <DisputeStep stepNumber={2} title="Pull Your Full Reports">
            <div className="flex items-start gap-3 mb-4">
              <Search className="w-5 h-5 text-primary flex-shrink-0 mt-1" />
              <p className="text-foreground">
                Pull full reports from <strong>Experian</strong>, <strong>Equifax</strong>, and <strong>TransUnion</strong>. Credit Karma is not enough.
              </p>
            </div>
            
            <p className="text-foreground font-medium mb-3">Extract this data from each report:</p>
            <ul className="space-y-2 list-disc list-inside">
              <li>All names on file (current and historical)</li>
              <li>All addresses on file</li>
              <li>All employers listed</li>
              <li>Every account (creditor name, account number, date opened, balance)</li>
              <li>All inquiries (company name, date of inquiry)</li>
            </ul>
          </DisputeStep>

          <DisputeStep stepNumber={3} title="Build the Master Dispute Sheet">
            <div className="flex items-start gap-3 mb-4">
              <Target className="w-5 h-5 text-primary flex-shrink-0 mt-1" />
              <p className="text-foreground">
                Create a document with <strong>4 buckets</strong>. This is your ammunition.
              </p>
            </div>

            <div className="grid gap-3">
              <div className="bg-muted/30 rounded-lg p-4 border border-border/30">
                <p className="font-medium text-foreground mb-1">1. Wrong Names</p>
                <p className="text-sm">Every name variation that isn't legally yours</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/30">
                <p className="font-medium text-foreground mb-1">2. Wrong Addresses</p>
                <p className="text-sm">Addresses you've never lived at or are outdated</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/30">
                <p className="font-medium text-foreground mb-1">3. Wrong Employers</p>
                <p className="text-sm">Companies you've never worked for</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/30">
                <p className="font-medium text-foreground mb-1">4. Disputed Accounts & Inquiries</p>
                <p className="text-sm">Include: <strong>Creditor + Account # + Date Opened</strong> for accounts</p>
                <p className="text-sm">Include: <strong>Company + Date</strong> for inquiries</p>
              </div>
            </div>

            <div className="mt-4 p-4 bg-primary/10 border border-primary/30 rounded-lg">
              <p className="font-semibold text-primary">"Specificity is non-negotiable."</p>
            </div>
          </DisputeStep>

          <DisputeStep stepNumber={4} title="Assemble Your Proof Pack">
            <div className="flex items-start gap-3 mb-4">
              <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-1" />
              <p className="text-foreground">
                Your evidence package that proves who you are and supports your dispute.
              </p>
            </div>

            <p className="font-medium text-foreground mb-3">Required documents:</p>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-success flex-shrink-0 mt-1" />
                <span><strong>Government-issued ID</strong> (driver's license or passport)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-success flex-shrink-0 mt-1" />
                <span><strong>Proof of address</strong>: Utility bill, lease agreement, or bank statement</span>
              </li>
            </ul>

            <p className="font-medium text-foreground mt-6 mb-3">For identity theft cases:</p>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-success flex-shrink-0 mt-1" />
                <span><strong>FTC Identity Theft Report</strong> (from IdentityTheft.gov)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-4 h-4 flex-shrink-0" />
                <span className="text-muted-foreground">AND/OR Police Report (optional)</span>
              </li>
            </ul>

            <div className="mt-4 p-4 bg-muted/50 border border-border/50 rounded-lg">
              <p className="text-sm">
                <strong className="text-foreground">Note:</strong> A police report is not required because many police departments won't generate one for identity theft. The FTC report is sufficient and reliable.
              </p>
            </div>
          </DisputeStep>

          <DisputeStep stepNumber={5} title="Choose Your First Dispute Route">
            <div className="flex items-start gap-3 mb-4">
              <Mail className="w-5 h-5 text-primary flex-shrink-0 mt-1" />
              <p className="text-foreground">
                <strong>Primary route: Certified mail dispute letters.</strong>
              </p>
            </div>

            <p className="mb-4">
              CFPB is <strong>NOT</strong> required for your first dispute unless the bureau blocks you procedurally:
            </p>
            
            <ul className="space-y-2 list-disc list-inside text-muted-foreground">
              <li>Cannot access your report</li>
              <li>"Non-residential address" excuse</li>
              <li>"Can't verify identity" excuse</li>
              <li>Quick dismissal without investigation</li>
            </ul>
          </DisputeStep>

          <DisputeStep stepNumber={6} title="Round 1: Send Certified Mail Disputes">
            <p className="text-foreground mb-4">
              Send a <strong>separate letter to each bureau</strong>. Do not combine. Each letter must be certified mail with return receipt.
            </p>

            <p className="font-medium text-foreground mb-3">Include these statutes in every letter:</p>
            <div className="grid sm:grid-cols-2 gap-2 mb-4">
              <div className="bg-muted/30 rounded px-3 py-2 border border-border/30 font-mono text-sm">FCRA §602(a)</div>
              <div className="bg-muted/30 rounded px-3 py-2 border border-border/30 font-mono text-sm">FCRA §607(b)</div>
              <div className="bg-muted/30 rounded px-3 py-2 border border-border/30 font-mono text-sm">FCRA §611</div>
              <div className="bg-muted/30 rounded px-3 py-2 border border-border/30 font-mono text-sm">FCRA §605B (identity theft)</div>
            </div>

            <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg">
              <p className="font-medium text-foreground">
                Tie wrong identifiers (names/addresses) to accounts/inquiries to show a pattern of inaccuracy or mixed file.
              </p>
            </div>
          </DisputeStep>

          <DisputeStep stepNumber={7} title="Wait for Response & Use the Response Gears">
            <p className="text-foreground mb-6">
              After Round 1, you'll get one of three outcomes. Each requires a different response.
            </p>

            <div className="space-y-4">
              <div className="bg-success/10 border border-success/30 rounded-lg p-4">
                <p className="font-semibold text-success mb-2">Outcome A: Deleted Everything</p>
                <p className="text-sm">Stop and monitor. Watch for reinsertion over the next 30-90 days. If they reinsert, that's a FCRA violation.</p>
              </div>

              <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                <p className="font-semibold text-warning mb-2">Outcome B: Deleted Some, Verified the Rest</p>
                <p className="text-sm">Send Method of Verification (MoV) demand + second dispute letter. They must prove HOW they verified.</p>
              </div>

              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <p className="font-semibold text-destructive mb-2">Outcome C: Verified Everything / Dismissed / Identity Excuse</p>
                <p className="text-sm">Escalate to CFPB immediately. Then BBB/AG if still noncompliant.</p>
              </div>
            </div>
          </DisputeStep>

          <DisputeStep stepNumber={8} title="Escalation Rules (When to Use CFPB / BBB / AG)">
            <div className="space-y-4">
              <div className="bg-card rounded-lg p-4 border border-border/50">
                <p className="font-semibold text-foreground mb-2 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold">1</span>
                  CFPB (Consumer Financial Protection Bureau)
                </p>
                <p className="text-sm text-muted-foreground ml-10">
                  Use after Round 1 fails OR immediately if blocked procedurally. This creates a formal paper trail the bureau must respond to.
                </p>
              </div>

              <div className="bg-card rounded-lg p-4 border border-border/50">
                <p className="font-semibold text-foreground mb-2 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold">2</span>
                  BBB (Better Business Bureau)
                </p>
                <p className="text-sm text-muted-foreground ml-10">
                  Use after CFPB if still noncompliant. BBB complaints are public pressure—companies hate bad ratings.
                </p>
              </div>

              <div className="bg-card rounded-lg p-4 border border-border/50">
                <p className="font-semibold text-foreground mb-2 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold">3</span>
                  AG (Attorney General)
                </p>
                <p className="text-sm text-muted-foreground ml-10">
                  Use when there's a repeated pattern of noncompliance or reinsertion. This is enforcement escalation—they can investigate and fine.
                </p>
              </div>
            </div>
          </DisputeStep>
        </div>
      </div>
    </section>
  );
};

export default SystemGuide;
