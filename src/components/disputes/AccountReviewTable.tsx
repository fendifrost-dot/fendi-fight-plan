import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronRight, FileText } from "lucide-react";
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
import type { DisputeAccount, BureauKey, AccountStatus } from "@/types/disputes";

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
  if (!status) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <Badge variant="outline" className={STATUS_COLORS[status.status] || STATUS_COLORS.unknown}>
      {status.status.replace("_", " ")}
    </Badge>
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

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={`border rounded-lg transition-colors ${account.isSelected ? "border-primary/50 bg-primary/5" : "border-border"}`}>
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

            {/* Dispute reason */}
            {account.isSelected && (
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
                <Badge variant="outline" className="text-xs">
                  {Math.round(account.confidence * 100)}% confidence
                </Badge>
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
      {/* Header */}
      <div className="flex items-center justify-between">
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

        <div className="hidden md:flex items-center gap-6 text-xs text-muted-foreground">
          <span className="w-[100px] text-center">Experian</span>
          <span className="w-[100px] text-center">Equifax</span>
          <span className="w-[100px] text-center">TransUnion</span>
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
