import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ALL_SCOPES,
  READ_SCOPES,
  WRITE_SCOPES,
  type McpScope,
} from "../../../supabase/functions/_shared/compassMcp";

const SCOPE_LABELS: Record<McpScope, string> = {
  "assessments.list": "List assessments",
  "assessments.read": "Read an assessment",
  "reports.read": "Read generated letters",
  "intake.list": "List intake clients",
  "intake.read": "Read an intake client",
  "payments.read": "Read payment status",
  "analysis.read": "Read analysis job status",
  "assessments.create": "Create an assessment",
  "reports.generate": "Generate dispute letters (stored report)",
  "reports.upload": "Upload a bureau report",
  "intake.create": "Create an intake client",
  "intake.score": "Score a file",
  "intake.approve_pricing": "Approve pricing and open a payment plan",
  "intake.summary": "Generate summary documents",
  "payments.record": "Record a payment received",
  "payments.mark_late": "Mark overdue payment plans late",
  "analysis.start": "Start report analysis job",
  "analysis.chunk": "Analyze a report chunk",
  "analysis.response": "Analyze a bureau response",
  "documents.classify": "Classify dispute documents",
  "documents.map": "Map report page sections",
  "letters.dispute": "Generate a dispute letter (live)",
  "letters.specialty_freeze": "Generate a specialty freeze letter",
  "ai.ask": "Ask Credit Compass AI",
};

const NAME_CHOICES = ["claude", "cursor", "grok", "chatgpt", "other"] as const;

interface AgentRow {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  agent_name: string | null;
  tool: string;
  subject_id: string | null;
  success: boolean;
  error: string | null;
  created_at: string;
}

function dateInDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function invokeEnroll(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("compass-mcp-enroll", { body });
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  if (error) {
    let message = error.message;
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context && typeof context.json === "function") {
      try {
        const payload = await context.json();
        if (payload && typeof payload === "object" && "error" in payload && payload.error) {
          message = String(payload.error);
        }
      } catch {
        message = error.message;
      }
    }
    throw new Error(message);
  }
  return (data ?? {}) as Record<string, unknown>;
}

export function AgentAccessCard() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [nameChoice, setNameChoice] = useState<(typeof NAME_CHOICES)[number]>("claude");
  const [otherName, setOtherName] = useState("");
  const [scopes, setScopes] = useState<McpScope[]>([...READ_SCOPES]);
  const [expiresOn, setExpiresOn] = useState(dateInDays(90));
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [agentResult, auditResult] = await Promise.all([
      invokeEnroll({ action: "list" }),
      invokeEnroll({ action: "audit", limit: 20 }),
    ]);
    setAgents(Array.isArray(agentResult.agents) ? (agentResult.agents as AgentRow[]) : []);
    setAudits(Array.isArray(auditResult.rows) ? (auditResult.rows as AuditRow[]) : []);
  }, []);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not load agents");
    });
  }, [load]);

  function toggleScope(scope: McpScope, checked: boolean) {
    setScopes((current) => (checked ? [...current, scope] : current.filter((item) => item !== scope)));
  }

  async function enroll() {
    setError(null);
    setSecret(null);
    const name = nameChoice === "other" ? otherName.trim().toLowerCase() : nameChoice;
    setBusy(true);
    try {
      const result = await invokeEnroll({
        action: "create",
        name,
        scopes,
        expires_at: `${expiresOn}T23:59:59.000Z`,
      });
      if (typeof result.secret !== "string") throw new Error("Enrollment did not return a secret");
      setSecret(result.secret);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this agent? Its secret stops working immediately.")) return;
    setError(null);
    setBusy(true);
    try {
      await invokeEnroll({ action: "revoke", agent_id: id });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not revoke");
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          Agent access
        </CardTitle>
        <CardDescription>
          Enroll Claude, Cursor, or Grok with a one-time secret. This is not the Control Center hub key.
          The secret is stored only as a hash. Everything the agent creates is attributed to you.
          Delete, email, card charges, and SQL are not available to agents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {secret && (
          <div className="space-y-3 rounded-md border border-border bg-muted p-4">
            <p className="text-sm font-medium">Copy this secret now. It will not be shown again.</p>
            <code className="block break-all text-sm">{secret}</code>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={copySecret}>
                Copy
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setSecret(null)}>
                I saved it
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Agent</Label>
            <select
              id="agent-name"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={nameChoice}
              onChange={(event) => setNameChoice(event.target.value as (typeof NAME_CHOICES)[number])}
            >
              {NAME_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-expiry">Expiry</Label>
            <Input id="agent-expiry" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
          </div>
        </div>

        {nameChoice === "other" && (
          <div className="space-y-2">
            <Label htmlFor="agent-other-name">Name</Label>
            <Input
              id="agent-other-name"
              value={otherName}
              onChange={(event) => setOtherName(event.target.value)}
              placeholder="lowercase, such as cursor-2"
              autoComplete="off"
            />
          </div>
        )}

        <div className="space-y-3">
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setScopes([...READ_SCOPES])}>
              Read only
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setScopes([...ALL_SCOPES])}>
              Read and write
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ALL_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={scopes.includes(scope)}
                  onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                />
                <span>{SCOPE_LABELS[scope]}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Write scopes: {WRITE_SCOPES.length}. With Upload a bureau report, an enrolled agent can send a PDF, a
            public link, extracted text, or page images. The file is stored in your folder and analyzed like an
            upload from this app.
          </p>
        </div>

        <Button type="button" onClick={enroll} disabled={busy || scopes.length === 0 || !expiresOn}>
          Enroll agent
        </Button>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Enrolled</h3>
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents yet.</p>
          ) : (
            <ul className="space-y-3">
              {agents.map((agent) => (
                <li key={agent.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div className="text-sm">
                    <span className="font-medium">{agent.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {agent.revoked_at ? "revoked" : `expires ${agent.expires_at.slice(0, 10)}`}
                    </span>
                    <p className="text-muted-foreground">{agent.scopes.join(", ")}</p>
                  </div>
                  {!agent.revoked_at && (
                    <Button type="button" variant="outline" size="sm" onClick={() => revoke(agent.id)} disabled={busy}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Recent calls</h3>
          {audits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit rows yet.</p>
          ) : (
            <ul className="space-y-2">
              {audits.map((row) => (
                <li key={row.id} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-border pb-2 text-sm">
                  <span className="font-medium">{row.agent_name ?? "agent"}</span>
                  <span>{row.tool}</span>
                  <span className="text-muted-foreground">{row.subject_id ?? "no subject"}</span>
                  <span>{row.success ? "success" : "failure"}</span>
                  <time className="text-muted-foreground">{row.created_at}</time>
                  {row.error && <span className="text-muted-foreground">{row.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
