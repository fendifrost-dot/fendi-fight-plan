import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, ShieldCheck, ShieldAlert, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { DisputeAccount, BureauKey, AccountStatus, AccountBucket } from "@/types/disputes";

interface AccountReviewTableProps {
  accounts: DisputeAccount[];
  onAccountChange: (id: string, changes: Partial<DisputeAccount>) => void;
  onSelectAll: (selected: boolean) => void;
  disabled?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  current: "bg-green-500/20 text-green-400 border-green-500/30",
  closed: "bg-muted text-muted-foreground border-border",
  late: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  charge_off: "bg-red-500/20 text-red-400 border-red-500/30",
  collection: "bg-red-500/20 text-red-400 border-red-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

const BUCKET_LABELS: Record<AccountBucket, { label: string; color: string; icon: typeof ShieldAlert }> = {
  derogatory: { label: "Derogatory", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: ShieldAlert },
  manual_review: { label: "Manual Review", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: Eye },
  clean: { label: "Clean", color: "bg-green-500/20 text-green-400 border-green-500/30", icon: ShieldCheck },
};

const DISPUTE_REASONS = [
  "Not my account",
  "Identity theft / Fraud",
  "Incorrect balance",
  "Incorrect payment history",
  "Account paid / closed",
  "Mixed file (belongs to another person)",
  "Never late",
  "Duplicate entry",
  "Outdated information",
  "Other (custom reason)",
];

function StatusBadge({ status }: { status?: AccountStatus }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={STATUS_COLORS[status.status] || STATUS_COLORS.unknown}>
      {status.status.replace("_", " ")}
    </Badge>
  );
}

function BucketBadge({ bucket }: { bucket?: AccountBucket }) {
  const info = BUCKET_LABELS[bucket || "manual_review"];
  const Icon = info.icon;
  return (
    <Badge variant="outline" className={info.color}>
      <Icon className="w-3 h-3 mr-1" />
      {info.label}
    </Badge>
  );
}

function TriggerList({ triggers }: { triggers?: string[] }) {
  if (!triggers || triggers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">No deterministic triggers detected</p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Deterministic Triggers:</p>
      <div className="flex flex-wrap gap-1">
        {triggers.map((t, i) => (
          <Badge key={i} variant="secondary" className="text-xs font-mono">
            {t}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function AccountRow({
  account,
  onAccountChange,
  disabled,
}: {
  account: DisputeAccount;
  onAccountChange: (id: string, changes: Partial<DisputeAccount>) => void;
  disabled?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDerogatory = Object.values(account.bureauStatuses).some(
    (s) => s && ["late", "charge_off", "collection"].includes(s.status)
  );

  const handleMoveToBucket = (newBucket: AccountBucket) => {
    const changes: Partial<DisputeAccount> = { bucket: newBucket };
    if (newBucket === "derogatory") {
      changes.triageState = "included";
      changes.isSelected = true;
    } else if (newBucket === "manual_review") {
      changes.triageState = "pending";
      changes.isSelected = false;
    } else {
      changes.triageState = "excluded";
      changes.isSelected = false;
      changes.excludeReason = "Clean tradeline — no derogatory triggers";
    }
    onAccountChange(account.id, changes);
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={`border rounded-lg transition-colors ${
        account.triageState === "excluded" 
          ? "border-destructive/30 bg-destructive/5 opacity-60" 
          : account.triageState === "pending"
          ? "border-amber-500/30 bg-amber-500/5"
          : account.isSelected 
          ? "border-primary/50 bg-primary/5" 
          : "border-border"
      }`}>
        {/* Main row */}
        <div className="flex items-center gap-4 p-4">
          <Checkbox
            checked={account.isSelected}
            onCheckedChange={(checked) => onAccountChange(account.id, { isSelected: !!checked })}
            disabled={disabled}
            aria-label={`Select ${account.creditorName}`}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate">{account.creditorName}</p>
              {hasDerogatory && (
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              )}
              <BucketBadge bucket={account.bucket} />
            </div>
            <p className="text-sm text-muted-foreground font-mono">
              {account.maskedAccountNumber}
            </p>
            {account.dateOpened && (
              <p className="text-xs text-muted-foreground">
                Opened: {account.dateOpened}
              </p>
            )}
          </div>

          {/* Bureau status columns */}
          <div className="hidden md:grid grid-cols-3 gap-4 text-center min-w-[300px]">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Experian</p>
              <StatusBadge status={account.bureauStatuses.experian} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Equifax</p>
              <StatusBadge status={account.bureauStatuses.equifax} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">TransUnion</p>
              <StatusBadge status={account.bureauStatuses.transunion} />
            </div>
          </div>

          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>
        </div>

        {/* Expanded details */}
        <CollapsibleContent>
          <div className="px-4 pb-4 pt-2 border-t border-border space-y-4">
            {/* Mobile bureau statuses */}
            <div className="md:hidden grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Experian</p>
                <StatusBadge status={account.bureauStatuses.experian} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Equifax</p>
                <StatusBadge status={account.bureauStatuses.equifax} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">TransUnion</p>
                <StatusBadge status={account.bureauStatuses.transunion} />
              </div>
            </div>

            {/* Triggers proof */}
            <TriggerList triggers={account.derogatoryTriggers} />

            {/* Confidence + bucket info */}
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <Badge variant="secondary">
                {Math.round(account.confidence * 100)}% confidence
              </Badge>
              <span className="text-muted-foreground">
                Bucket: <strong>{account.bucket || "unknown"}</strong>
              </span>
            </div>

            {/* Manual correction controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Move to:</span>
              <Button
                size="sm"
                variant={account.bucket === "derogatory" ? "default" : "outline"}
                onClick={() => handleMoveToBucket("derogatory")}
                disabled={disabled}
                className="h-7 text-xs"
              >
                <ShieldAlert className="w-3 h-3 mr-1" />
                Keep as Derogatory
              </Button>
              <Button
                size="sm"
                variant={account.bucket === "manual_review" ? "default" : "outline"}
                onClick={() => handleMoveToBucket("manual_review")}
                disabled={disabled}
                className="h-7 text-xs"
              >
                <Eye className="w-3 h-3 mr-1" />
                Manual Review
              </Button>
              <Button
                size="sm"
                variant={account.bucket === "clean" ? "default" : "outline"}
                onClick={() => handleMoveToBucket("clean")}
                disabled={disabled}
                className="h-7 text-xs"
              >
                <ShieldCheck className="w-3 h-3 mr-1" />
                Remove from Derogatory
              </Button>
            </div>

            {/* Pending indicator */}
            {account.triageState === "pending" && (
              <div className="flex items-center gap-2 text-amber-500 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>Manual review needed — no deterministic triggers confirmed this as derogatory</span>
              </div>
            )}

            {/* Exclude reason input */}
            {account.triageState === "excluded" && (
              <div>
                <Label className="text-sm">Reason for exclusion</Label>
                <Textarea
                  value={account.excludeReason || ""}
                  onChange={(e) => onAccountChange(account.id, { excludeReason: e.target.value })}
                  placeholder="e.g., Account is current, never late"
                  rows={2}
                  disabled={disabled}
                  className="mt-1"
                />
              </div>
            )}

            {/* Dispute reason (only for included) */}
            {account.triageState === "included" && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Dispute Reason</Label>
                  <Select
                    value={account.disputeReason || ""}
                    onValueChange={(value) => onAccountChange(account.id, { disputeReason: value })}
                    disabled={disabled}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select a reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      {DISPUTE_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {account.disputeReason === "Other (custom reason)" && (
                  <div>
                    <Label className="text-sm">Custom Reason</Label>
                    <Textarea
                      value={account.customReason || ""}
                      onChange={(e) => onAccountChange(account.id, { customReason: e.target.value })}
                      placeholder="Enter your specific dispute reason..."
                      rows={2}
                      disabled={disabled}
                      className="mt-1"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Source reference */}
            {account.sourceFile && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="w-3 h-3" />
                <span>
                  Source: {account.sourceFile}
                  {account.sourcePage && `, Page ${account.sourcePage}`}
                </span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function AccountReviewTable({
  accounts,
  onAccountChange,
  onSelectAll,
  disabled,
}: AccountReviewTableProps) {
  const selectedCount = accounts.filter((a) => a.isSelected).length;
  const allSelected = accounts.length > 0 && selectedCount === accounts.length;
  const someSelected = selectedCount > 0 && selectedCount < accounts.length;

  const derogatoryCount = accounts.filter(a => a.bucket === "derogatory").length;
  const reviewCount = accounts.filter(a => a.bucket === "manual_review").length;
  const cleanCount = accounts.filter(a => a.bucket === "clean").length;

  if (accounts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No accounts found in analysis.</p>
        <p className="text-sm">Upload and analyze bureau response to see accounts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with bucket summary */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={allSelected}
            // @ts-ignore - indeterminate is valid
            indeterminate={someSelected}
            onCheckedChange={(checked) => onSelectAll(!!checked)}
            disabled={disabled}
            aria-label="Select all accounts"
          />
          <span className="text-sm text-muted-foreground">
            {selectedCount} of {accounts.length} selected for dispute
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20">
            {derogatoryCount} derogatory
          </Badge>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20">
            {reviewCount} review
          </Badge>
          <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20">
            {cleanCount} clean
          </Badge>
        </div>
      </div>

      {/* Account list */}
      <div className="space-y-3">
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            onAccountChange={onAccountChange}
            disabled={disabled}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={STATUS_COLORS.current}>current</Badge>
          <span className="text-xs text-muted-foreground">Good standing</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={STATUS_COLORS.late}>late</Badge>
          <span className="text-xs text-muted-foreground">Delinquent</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={STATUS_COLORS.charge_off}>charge off</Badge>
          <span className="text-xs text-muted-foreground">Written off</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={STATUS_COLORS.collection}>collection</Badge>
          <span className="text-xs text-muted-foreground">In collections</span>
        </div>
      </div>
    </div>
  );
}
