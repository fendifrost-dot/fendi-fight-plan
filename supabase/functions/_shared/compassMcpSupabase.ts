/**
 * Service-role adapter for the Credit Compass MCP.
 *
 * Agent and audit rows are read and written directly. Everything about
 * assessments, intake, pricing, and payments goes through the project's own
 * hub-authenticated edge functions with FANFUEL_HUB_KEY, so their validation,
 * staff checks, and hub_operator_audit rows stay in force.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  AuditInsert,
  AuditPublic,
  CompassMcpStore,
  EnrollStore,
  EnrolledAgentPublic,
  HubResult,
  IntakeClientRow,
  McpAgentRecord,
} from "./compassMcp.ts";

const AGENT_PUBLIC = "id, name, scopes, expires_at, revoked_at, created_at, created_by";

function dbFail(error: { message?: string; code?: string } | null): { error: string } {
  console.error("compass-mcp db", error?.code ?? "", error?.message ?? "");
  const code = error?.code ?? "";
  if (code === "PGRST116") return { error: "not found" };
  if (code === "23503") return { error: "related row not found" };
  if (code === "23514" || code === "22P02" || code === "23502") return { error: "invalid value" };
  return { error: "request failed" };
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asAgent(row: Record<string, unknown>): EnrolledAgentPublic {
  return {
    id: String(row.id),
    name: String(row.name),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    expires_at: String(row.expires_at),
    revoked_at: row.revoked_at == null ? null : String(row.revoked_at),
    created_at: String(row.created_at),
    created_by: row.created_by == null ? null : String(row.created_by),
  };
}

function asIntakeRow(row: Record<string, unknown>): IntakeClientRow {
  return {
    id: String(row.id),
    status: String(row.status),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    record: asRecord(row.record),
  };
}

async function readHub(resp: Response): Promise<HubResult> {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await resp.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { ok: resp.ok, status: resp.status, body };
}

function hubBase(): { url: string; key: string } | null {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("FANFUEL_HUB_KEY") ?? "";
  if (!url || !key) return null;
  return { url, key };
}

const MISCONFIGURED: HubResult = { ok: false, status: 500, body: { error: "hub key is not configured on this function" } };

export function createCompassMcpStore(supabase: SupabaseClient): CompassMcpStore {
  return {
    async findAgentByHash(secretHash) {
      const { data, error } = await supabase
        .from("mcp_agents")
        .select("id, name, secret_hash, scopes, expires_at, revoked_at, created_by")
        .eq("secret_hash", secretHash)
        .maybeSingle();
      if (error) throw new Error("agent lookup failed");
      if (!data) return null;
      const row = asRecord(data);
      return {
        id: String(row.id),
        name: String(row.name),
        secretHash: String(row.secret_hash),
        scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
        expiresAt: String(row.expires_at),
        revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
        createdBy: row.created_by == null ? null : String(row.created_by),
      } satisfies McpAgentRecord;
    },

    async insertAudit(row: AuditInsert) {
      const { data, error } = await supabase
        .from("mcp_audit_log")
        .insert({ agent_id: row.agentId, tool: row.tool, subject_id: row.subjectId, success: row.success, error: row.error })
        .select("id")
        .single();
      if (error || !data) return dbFail(error);
      return { id: String(asRecord(data).id) };
    },

    async finishAudit(id, success, errorText, subjectId) {
      const patch: Record<string, unknown> = { success, error: errorText };
      if (subjectId) patch.subject_id = subjectId;
      const { error } = await supabase.from("mcp_audit_log").update(patch).eq("id", id);
      if (error) throw new Error("audit finish failed");
    },

    async hub(action, params) {
      const base = hubBase();
      if (!base) return MISCONFIGURED;
      const resp = await fetch(`${base.url}/functions/v1/control-center-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": base.key },
        body: JSON.stringify({ action, ...params }),
      });
      return readHub(resp);
    },

    async intake(path, body) {
      const base = hubBase();
      if (!base) return MISCONFIGURED;
      const resp = await fetch(`${base.url}/functions/v1/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": base.key },
        body: JSON.stringify(body),
      });
      return readHub(resp);
    },

    async session(path, body, operatorUserId) {
      const base = hubBase();
      if (!base) return MISCONFIGURED;
      const resp = await fetch(`${base.url}/functions/v1/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": base.key,
          "x-operator-user-id": operatorUserId,
        },
        body: JSON.stringify(body),
      });
      return readHub(resp);
    },

    async sessionGet(path, query, operatorUserId) {
      const base = hubBase();
      if (!base) return MISCONFIGURED;
      const qs = new URLSearchParams(query);
      const resp = await fetch(`${base.url}/functions/v1/${path}?${qs}`, {
        method: "GET",
        headers: {
          "x-api-key": base.key,
          "x-operator-user-id": operatorUserId,
        },
      });
      return readHub(resp);
    },

    async paymentsStatus(clientId, operatorUserId) {
      const base = hubBase();
      if (!base) return MISCONFIGURED;
      const query = new URLSearchParams({ clientId, operatorUserId });
      const resp = await fetch(`${base.url}/functions/v1/payments-status?${query}`, {
        method: "GET",
        headers: { "x-api-key": base.key },
      });
      return readHub(resp);
    },

    async listIntakeClients(_operatorUserId, limit) {
      // Staff-attributed agents may list every intake client (not only their own).
      const { data, error } = await supabase
        .from("intake_clients")
        .select("id, status, created_at, updated_at, record")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return dbFail(error);
      return { data: (data ?? []).map((row) => asIntakeRow(asRecord(row))) };
    },

    async getIntakeClient(_operatorUserId, clientId) {
      const { data, error } = await supabase
        .from("intake_clients")
        .select("id, status, created_at, updated_at, record")
        .eq("id", clientId)
        .maybeSingle();
      if (error) return dbFail(error);
      if (!data) return { notFound: true };
      return { data: asIntakeRow(asRecord(data)) };
    },
  };
}

export function createEnrollStore(supabase: SupabaseClient): EnrollStore {
  return {
    async insertAgent(row) {
      const { data, error } = await supabase
        .from("mcp_agents")
        .insert({
          name: row.name,
          secret_hash: row.secret_hash,
          scopes: row.scopes,
          expires_at: row.expires_at,
          created_by: row.created_by,
        })
        .select(AGENT_PUBLIC)
        .single();
      if (error || !data) return dbFail(error);
      return { agent: asAgent(asRecord(data)) };
    },

    async listAgents() {
      const { data, error } = await supabase.from("mcp_agents").select(AGENT_PUBLIC).order("created_at", { ascending: false }).limit(100);
      if (error) return dbFail(error);
      return { agents: (data ?? []).map((row) => asAgent(asRecord(row))) };
    },

    async revokeAgent(id) {
      const { data, error } = await supabase
        .from("mcp_agents")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .select(AGENT_PUBLIC)
        .maybeSingle();
      if (error) return dbFail(error);
      if (!data) return { notFound: true };
      return { data: asAgent(asRecord(data)) };
    },

    async listAudit(limit) {
      const { data, error } = await supabase
        .from("mcp_audit_log")
        .select("id, agent_id, tool, subject_id, success, error, created_at, mcp_agents(name)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return dbFail(error);
      const rows: AuditPublic[] = (data ?? []).map((item) => {
        const row = asRecord(item);
        const related = row.mcp_agents;
        let agentName: string | null = null;
        if (Array.isArray(related)) {
          const first = asRecord(related[0]);
          agentName = typeof first.name === "string" ? first.name : null;
        } else if (related && typeof related === "object") {
          const name = asRecord(related).name;
          agentName = typeof name === "string" ? name : null;
        }
        return {
          id: String(row.id),
          agent_id: String(row.agent_id),
          agent_name: agentName,
          tool: String(row.tool),
          subject_id: row.subject_id == null ? null : String(row.subject_id),
          success: row.success === true,
          error: row.error == null ? null : String(row.error),
          created_at: String(row.created_at),
        };
      });
      return { rows };
    },
  };
}
