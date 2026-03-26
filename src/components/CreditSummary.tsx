import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle,
  CreditCard,
  Search,
  FileWarning,
  User,
  MapPin,
  BarChart3,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { exportCreditSummaryPdf } from "@/lib/credit-summary-pdf";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CreditSummaryAccount {
  creditor_name: string;
  account_number?: string;
  date_opened?: string;
  balance?: string;
  past_due?: string;
  derogatory_triggers?: string[];
  status?: string;
  source?: string;
}

export interface CreditSummaryData {
  // Consumer identity
  fullLegalName: string;
  currentAddress: string;

  // Per-bureau scores
  scores?: {
    experian?: number;
    transunion?: number;
    equifax?: number;
  };

  // Per-bureau report dates
  reportDates?: {
    experian?: string;
    transunion?: string;
    equifax?: string;
  };

  // Disputed items
  inaccurateNames: { reported_name: string; mismatch_reason: string; source?: string }[];
  inaccurateAddresses: { reported_address: string; linked_to_derogatory: boolean; source?: string }[];
  derogatoryAccounts: CreditSummaryAccount[];
  collections: CreditSummaryAccount[];
  chargeOffs: CreditSummaryAccount[];
  inquiries: { creditor_name: string; date: string; type: string; source?: string }[];
  publicRecords: { type: string; filing_date: string; status: string; source?: string }[];
}

interface CreditSummaryProps {
  data: CreditSummaryData;
  className?: string;
}

// ---------------------------------------------------------------------------
// Score color helper
// ---------------------------------------------------------------------------
function scoreColor(score: number | undefined): string {
  if (!score) return "text-muted-foreground";
  if (score >= 720) return "text-green-500";
  if (score >= 660) return "text-yellow-500";
  if (score >= 580) return "text-orange-500";
  return "text-red-500";
}

function scoreLabel(score: number | undefined): string {
  if (!score) return "N/A";
  if (score >= 720) return "Good";
  if (score >= 660) return "Fair";
  if (score >= 580) return "Poor";
  return "Very Poor";
}

function scoreBg(score: number | undefined): string {
  if (!score) return "bg-muted/30";
  if (score >= 720) return "bg-green-500/10 border-green-500/30";
  if (score >= 660) return "bg-yellow-500/10 border-yellow-500/30";
  if (score >= 580) return "bg-orange-500/10 border-orange-500/30";
  return "bg-red-500/10 border-red-500/30";
}

// ---------------------------------------------------------------------------
// Parse dollar amounts for totaling
// ---------------------------------------------------------------------------
function parseDollar(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[$,]/g, ""));
  return isNaN(n) ? 0 : n;
}

function formatDollar(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CreditSummary({ data, className }: CreditSummaryProps) {
  const totalDerogatory = data.derogatoryAccounts.length + data.collections.length + data.chargeOffs.length;
  const totalInquiries = data.inquiries.length;
  const totalIdentityErrors = data.inaccurateNames.length + data.inaccurateAddresses.length;

  const totalBalance = useMemo(() => {
    const all = [...data.derogatoryAccounts, ...data.collections, ...data.chargeOffs];
    return all.reduce((sum, a) => sum + parseDollar(a.balance), 0);
  }, [data.derogatoryAccounts, data.collections, data.chargeOffs]);

  const totalPastDue = useMemo(() => {
    return data.derogatoryAccounts.reduce((sum, a) => sum + parseDollar(a.past_due), 0);
  }, [data.derogatoryAccounts]);

  const bureaus = ["experian", "transunion", "equifax"] as const;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-full mb-4">
          <BarChart3 className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-primary">Credit Summary</span>
        </div>
        <h3 className="text-2xl font-serif font-bold text-foreground">
          {data.fullLegalName || "Consumer Credit Summary"}
        </h3>
        {data.currentAddress && (
          <p className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1">
            <MapPin className="w-3 h-3" /> {data.currentAddress}
          </p>
        )}
      </div>

      {/* Credit Scores Row */}
      {data.scores && (
        <div className="grid grid-cols-3 gap-4">
          {bureaus.map((b) => {
            const score = data.scores?.[b];
            const date = data.reportDates?.[b];
            const label = b.charAt(0).toUpperCase() + b.slice(1);
            return (
              <div
                key={b}
                className={cn(
                  "rounded-xl border p-4 text-center",
                  scoreBg(score)
                )}
              >
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  {label}
                </p>
                <p className={cn("text-4xl font-bold font-mono", scoreColor(score))}>
                  {score ?? "â"}
                </p>
                <p className={cn("text-xs font-semibold mt-1", scoreColor(score))}>
                  {scoreLabel(score)}
                </p>
                {date && (
                  <p className="text-xs text-muted-foreground mt-2">{date}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          icon={<ShieldAlert className="w-5 h-5 text-red-500" />}
          label="Derogatory Items"
          value={String(totalDerogatory)}
          valueClass="text-red-500"
          bg="bg-red-500/10 border-red-500/20"
        />
        <MetricCard
          icon={<Search className="w-5 h-5 text-orange-500" />}
          label="Hard Inquiries"
          value={String(totalInquiries)}
          valueClass="text-orange-500"
          bg="bg-orange-500/10 border-orange-500/20"
        />
        <MetricCard
          icon={<User className="w-5 h-5 text-yellow-500" />}
          label="Identity Errors"
          value={String(totalIdentityErrors)}
          valueClass="text-yellow-500"
          bg="bg-yellow-500/10 border-yellow-500/20"
        />
        <MetricCard
          icon={<FileWarning className="w-5 h-5 text-purple-500" />}
          label="Public Records"
          value={String(data.publicRecords.length)}
          valueClass="text-purple-500"
          bg="bg-purple-500/10 border-purple-500/20"
        />
      </div>

      {/* Debt Summary */}
      {totalBalance > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-border/50 bg-muted/20 p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Disputed Balance</p>
            <p className="text-3xl font-bold text-destructive">{formatDollar(totalBalance)}</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/20 p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Past Due</p>
            <p className="text-3xl font-bold text-orange-500">{formatDollar(totalPastDue)}</p>
          </div>
        </div>
      )}

      {/* Account Breakdown */}
      <div className="rounded-2xl border border-border/50 p-6 space-y-4">
        <h4 className="font-serif font-semibold text-foreground flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          Account Breakdown
        </h4>

        {/* Derogatory Open Accounts */}
        {data.derogatoryAccounts.length > 0 && (
          <AccountGroup
            title={`Open Negative Accounts (${data.derogatoryAccounts.length})`}
            titleClass="text-orange-500"
            accounts={data.derogatoryAccounts}
            showPastDue
          />
        )}

        {/* Collections */}
        {data.collections.length > 0 && (
          <AccountGroup
            title={`Collections (${data.collections.length})`}
            titleClass="text-red-500"
            accounts={data.collections}
          />
        )}

        {/* Charge-Offs */}
        {data.chargeOffs.length > 0 && (
          <AccountGroup
            title={`Charge-Offs (${data.chargeOffs.length})`}
            titleClass="text-destructive"
            accounts={data.chargeOffs}
          />
        )}

        {totalDerogatory === 0 && (
          <div className="flex items-center gap-2 text-green-500 text-sm">
            <CheckCircle className="w-4 h-4" />
            No derogatory accounts found
          </div>
        )}
      </div>

      {/* Identity Errors */}
      {(data.inaccurateNames.length > 0 || data.inaccurateAddresses.length > 0) && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-6 space-y-4">
          <h4 className="font-serif font-semibold text-foreground flex items-center gap-2">
            <User className="w-5 h-5 text-yellow-500" />
            Identity Errors
          </h4>
          {data.inaccurateNames.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-yellow-600 uppercase tracking-wide mb-2">
                Inaccurate Names ({data.inaccurateNames.length})
              </p>
              <div className="space-y-1">
                {data.inaccurateNames.map((n, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="font-mono font-semibold text-foreground">"{n.reported_name}"</span>
                      {" â "}
                      <span className="text-muted-foreground">{n.mismatch_reason}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.inaccurateAddresses.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-yellow-600 uppercase tracking-wide mb-2">
                Inaccurate Addresses ({data.inaccurateAddresses.length})
              </p>
              <div className="space-y-1">
                {data.inaccurateAddresses.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <MapPin className="w-3.5 h-3.5 text-yellow-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="font-mono text-foreground">{a.reported_address}</span>
                      {a.linked_to_derogatory && (
                        <span className="ml-2 text-xs text-red-500 font-semibold">
                          [linked to derogatory]
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inquiries */}
      {data.inquiries.length > 0 && (
        <div className="rounded-2xl border border-border/50 p-6 space-y-3">
          <h4 className="font-serif font-semibold text-foreground flex items-center gap-2">
            <Search className="w-5 h-5 text-orange-500" />
            Hard Inquiries ({data.inquiries.length})
          </h4>
          <div className="grid gap-1.5">
            {data.inquiries.map((inq, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0"
              >
                <span className="font-medium text-foreground">{inq.creditor_name}</span>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{inq.date}</span>
                  {inq.source && (
                    <span className="text-xs px-1.5 py-0.5 bg-muted/50 rounded">
                      {inq.source}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass: string;
  bg: string;
}

function MetricCard({ icon, label, value, valueClass, bg }: MetricCardProps) {
  return (
    <div className={cn("rounded-xl border p-4 text-center", bg)}>
      <div className="flex justify-center mb-2">{icon}</div>
      <p className={cn("text-3xl font-bold", valueClass)}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

interface AccountGroupProps {
  title: string;
  titleClass: string;
  accounts: CreditSummaryAccount[];
  showPastDue?: boolean;
}

function AccountGroup({ title, titleClass, accounts, showPastDue }: AccountGroupProps) {
  return (
    <div>
      <p className={cn("text-xs font-semibold uppercase tracking-wide mb-2", titleClass)}>
        {title}
      </p>
      <div className="rounded-lg border border-border/40 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/30 border-b border-border/40">
              <th className="text-left p-2 font-semibold text-muted-foreground">Creditor</th>
              <th className="text-left p-2 font-semibold text-muted-foreground hidden md:table-cell">Account #</th>
              <th className="text-right p-2 font-semibold text-muted-foreground">Balance</th>
              {showPastDue && (
                <th className="text-right p-2 font-semibold text-muted-foreground hidden md:table-cell">
                  Past Due
                </th>
              )}
              <th className="text-right p-2 font-semibold text-muted-foreground hidden lg:table-cell">Bureau</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => (
              <tr
                key={i}
                className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors"
              >
                <td className="p-2 font-medium text-foreground">{a.creditor_name}</td>
                <td className="p-2 text-muted-foreground font-mono hidden md:table-cell">
                  {a.account_number || "â"}
                </td>
                <td className="p-2 text-right text-destructive font-semibold">
                  {a.balance || "â"}
                </td>
                {showPastDue && (
                  <td className="p-2 text-right text-orange-500 hidden md:table-cell">
                    {a.past_due || "â"}
                  </td>
                )}
                <td className="p-2 text-right text-muted-foreground hidden lg:table-cell">
                  {a.source || "â"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
