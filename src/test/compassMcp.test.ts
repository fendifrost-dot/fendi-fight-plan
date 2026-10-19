/**
 * Credit Compass MCP: scope gating, audit ordering, operator attribution, and
 * argument validation, run through the real request handler against an
 * in-memory store that records what it would have sent to the hub functions.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_SCOPES,
  READ_SCOPES,
  WRITE_SCOPES,
  handleCompassMcpRequest,
  hashAgentSecret,
  parseCreateIntakeArgs,
  resolveScopes,
  summarizeIntakeClient,
  type CompassMcpStore,
  type HubResult,
  type IntakeClientRow,
  type McpAgentRecord,
} from "../../supabase/functions/_shared/compassMcp";

const SECRET = "ccma_test-secret";
const STAFF_ID = "1219f344-75a0-49b6-88a0-c2a94afe0e76";
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const SESSION_ID = "66666666-7777-4888-9999-aaaaaaaaaaaa";

interface HubCall {
  kind: "hub" | "intake" | "payments" | "session" | "sessionGet";
  target: string;
  body: Record<string, unknown>;
}

interface FakeState {
  agent: McpAgentRecord;
  audits: Array<{ id: string; tool: string; subjectId: string | null; success: boolean; error: string | null }>;
  calls: HubCall[];
  hubReply?: HubResult;
  intakeRows?: IntakeClientRow[];
}

const okReply = (body: Record<string, unknown>): HubResult => ({ ok: true, status: 200, body });

function fakeStore(state: FakeState): CompassMcpStore {
  return {
    async findAgentByHash(hash) {
      return hash === state.agent.secretHash ? state.agent : null;
    },
    async insertAudit(row) {
      const id = `audit-${state.audits.length + 1}`;
      state.audits.push({ id, tool: row.tool, subjectId: row.subjectId, success: row.success, error: row.error });
      return { id };
    },
    async finishAudit(id, success, error, subjectId) {
      const row = state.audits.find((item) => item.id === id);
      if (!row) throw new Error("missing audit row");
      row.success = success;
      row.error = error;
      if (subjectId) row.subjectId = subjectId;
    },
    async hub(action, params) {
      state.calls.push({ kind: "hub", target: action, body: params });
      return state.hubReply ?? okReply({ session_id: SESSION_ID, created_at: "2026-10-16T00:00:00Z", status: "created" });
    },
    async intake(path, body) {
      state.calls.push({ kind: "intake", target: path, body });
      return state.hubReply ?? okReply({ clientId: CLIENT_ID, record: { status: "intake" } });
    },
    async session(path, body, operatorUserId) {
      state.calls.push({ kind: "session", target: path, body: { ...body, operatorUserId } });
      return state.hubReply ?? okReply({ ok: true, path });
    },
    async sessionGet(path, query, operatorUserId) {
      state.calls.push({ kind: "sessionGet", target: path, body: { ...query, operatorUserId } });
      return state.hubReply ?? okReply({ jobId: query.jobId, status: "QUEUED" });
    },
    async paymentsStatus(clientId, operatorUserId) {
      state.calls.push({ kind: "payments", target: "payments-status", body: { clientId, operatorUserId } });
      return state.hubReply ?? okReply({ clientId, paymentPlan: null });
    },
    async listIntakeClients(operatorUserId, limit) {
      state.calls.push({ kind: "hub", target: "list_intake_clients", body: { operatorUserId, limit } });
      return { data: state.intakeRows ?? [] };
    },
    async getIntakeClient(operatorUserId, clientId) {
      state.calls.push({ kind: "hub", target: "get_intake_client", body: { operatorUserId, clientId } });
      const row = (state.intakeRows ?? []).find((item) => item.id === clientId);
      return row ? { data: row } : { notFound: true };
    },
  };
}

async function agentWith(scopes: readonly string[], createdBy: string | null = STAFF_ID): Promise<McpAgentRecord> {
  return {
    id: "agent-1",
    name: "claude",
    secretHash: await hashAgentSecret(SECRET),
    scopes: [...scopes],
    expiresAt: "2027-01-06T23:59:59.000Z",
    revokedAt: null,
    createdBy,
  };
}

async function rpc(store: CompassMcpStore, method: string, params: Record<string, unknown>, token = SECRET) {
  const req = new Request("https://example.test/compass-mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const res = await handleCompassMcpRequest(req, { store, isForbiddenSecret: (t) => t === "hub-key" });
  return { status: res.status, json: (await res.json()) as { result?: Record<string, unknown>; error?: { message: string } } };
}

function toolText(result: Record<string, unknown> | undefined): Record<string, unknown> {
  const content = (result?.content as Array<{ text: string }>) ?? [];
  return JSON.parse(content[0]?.text ?? "{}");
}

const intakeRow: IntakeClientRow = {
  id: CLIENT_ID,
  status: "approved",
  created_at: "2026-10-16T00:00:00Z",
  updated_at: "2026-10-16T01:00:00Z",
  record: {
    canonical: { legalName: "Deajah Newman", email: "d@example.com", phone: "7735551234", dob: "1995-06-01" },
    pricingRecommendation: { score: 4, tier: { name: "Tier 2 — Moderate", low: 1000, high: 1500 } },
    pricingApproved: { quotedFee: 1250, netTotal: 1250 },
    paymentPlan: { status: "current", remainingBalance: 750, totalAgreed: 1250 },
    bureauReported: { equifax: { derogatoryAccounts: [] } },
  },
};

describe("scopes and auth", () => {
  it("defines the Compass scope set and the read/write aliases", () => {
    expect(READ_SCOPES).toContain("payments.read");
    expect(WRITE_SCOPES).toContain("intake.create");
    expect(ALL_SCOPES.length).toBe(READ_SCOPES.length + WRITE_SCOPES.length);
    const resolved = resolveScopes(["write"]);
    expect(resolved.ok).toBe(true);
    expect((resolved as { scopes: string[] }).scopes).toEqual([...WRITE_SCOPES]);
    expect(resolveScopes(["clients.create"]).ok).toBe(false);
  });

  it("rejects the hub key and session tokens as agent secrets", async () => {
    const store = fakeStore({ agent: await agentWith(ALL_SCOPES), audits: [], calls: [] });
    const hub = await rpc(store, "ping", {}, "hub-key");
    expect(hub.status).toBe(401);
    expect(hub.json.error?.message).toContain("hub key");
    const jwt = await rpc(store, "ping", {}, "eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl");
    expect(jwt.status).toBe(401);
  });

  it("lists only the tools the agent's scopes allow", async () => {
    const store = fakeStore({ agent: await agentWith(["intake.list", "payments.read"]), audits: [], calls: [] });
    const listed = await rpc(store, "tools/list", {});
    const names = (listed.json.result?.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
    expect(names).toEqual(["get_payment_status", "list_intake_clients"]);
  });

  it("refuses a tool outside the agent's scopes and audits the refusal", async () => {
    const state: FakeState = { agent: await agentWith(["intake.list"]), audits: [], calls: [] };
    const res = await rpc(fakeStore(state), "tools/call", { name: "record_payment", arguments: { client_id: CLIENT_ID, amount: 100 } });
    expect(res.json.result?.isError).toBe(true);
    expect(toolText(res.json.result).error).toBe("agent is not allowed to use this tool");
    expect(state.calls).toHaveLength(0);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].success).toBe(false);
    expect(state.audits[0].subjectId).toBe(CLIENT_ID);
  });

  it("never exposes blocked names", async () => {
    const state: FakeState = { agent: await agentWith(ALL_SCOPES), audits: [], calls: [] };
    const res = await rpc(fakeStore(state), "tools/call", { name: "send_pitch_email", arguments: {} });
    expect(toolText(res.json.result).error).toBe("not available on an agent token");
  });
});

describe("intake tools act as the enrolling staff member", () => {
  it("create_intake_client sends the canonical shape with operatorUserId", async () => {
    const state: FakeState = { agent: await agentWith(["intake.create"]), audits: [], calls: [] };
    const res = await rpc(fakeStore(state), "tools/call", {
      name: "create_intake_client",
      arguments: {
        legal_name: "Deajah Newman",
        dob: "1995-06-01",
        address_line1: "123 Main St",
        city: "Dolton",
        state: "il",
        zip: "60419",
        phone: "773-555-1234",
        email: "Deajah@Example.com",
      },
    });
    expect(res.json.result?.isError).toBe(false);
    expect(toolText(res.json.result)).toEqual({ client_id: CLIENT_ID, status: "intake" });
    expect(state.calls).toHaveLength(1);
    const call = state.calls[0];
    expect(call.kind).toBe("intake");
    expect(call.target).toBe("intake-create-canonical");
    expect(call.body.operatorUserId).toBe(STAFF_ID);
    const canonical = call.body.canonical as Record<string, unknown>;
    expect(canonical.legalName).toBe("Deajah Newman");
    expect(canonical.email).toBe("deajah@example.com");
    expect((canonical.currentAddress as Record<string, unknown>).state).toBe("IL");
    expect(state.audits[0].success).toBe(true);
    expect(state.audits[0].subjectId).toBe(CLIENT_ID);
  });

  it("create_intake_client accepts legal_name alone with pending placeholders", async () => {
    const state: FakeState = { agent: await agentWith(["intake.create"]), audits: [], calls: [] };
    const res = await rpc(fakeStore(state), "tools/call", {
      name: "create_intake_client",
      arguments: { legal_name: "New Client" },
    });
    expect(res.json.result?.isError).toBe(false);
    const canonical = state.calls[0].body.canonical as Record<string, unknown>;
    expect(canonical.legalName).toBe("New Client");
    expect(canonical.email).toBe("pending@example.invalid");
    expect((canonical.currentAddress as Record<string, unknown>).line1).toBe("Address pending");
  });

  it("session tools call hub-mode edge functions as the enrolling staff member", async () => {
    const jobId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const state: FakeState = {
      agent: await agentWith(["analysis.start", "analysis.read", "letters.dispute", "ai.ask"]),
      audits: [],
      calls: [],
      hubReply: okReply({ jobId, status: "QUEUED" }),
    };
    const store = fakeStore(state);
    await rpc(store, "tools/call", {
      name: "start_analysis",
      arguments: { storage_paths: [`${STAFF_ID}/reports/page-1.png`], session_id: SESSION_ID },
    });
    await rpc(store, "tools/call", { name: "get_analysis_status", arguments: { job_id: jobId } });
    await rpc(store, "tools/call", {
      name: "generate_dispute_letter",
      arguments: {
        survey: { goals: [] },
        extracted_data: { accounts: [] },
        consumer_info: { fullName: "A" },
        bureau: { key: "experian" },
      },
    });
    await rpc(store, "tools/call", { name: "ask_compass_ai", arguments: { prompt: "summarize this file" } });
    expect(state.calls.map((c) => c.kind)).toEqual(["session", "sessionGet", "session", "session"]);
    expect(state.calls[0]).toMatchObject({
      target: "analysis-start",
      body: { operatorUserId: STAFF_ID, sessionId: SESSION_ID, inputMode: "images", source: "agent_upload" },
    });
    expect(state.calls[1]).toMatchObject({ target: "analysis-status", body: { jobId, operatorUserId: STAFF_ID } });
    expect(state.calls[2].target).toBe("generate-dispute-letter");
    expect(state.calls[3].target).toBe("google-ai-handler");
  });

  it("refuses when the agent has no enrolling staff member", async () => {
    const state: FakeState = { agent: await agentWith(["intake.list"], null), audits: [], calls: [] };
    const res = await rpc(fakeStore(state), "tools/call", { name: "list_intake_clients", arguments: {} });
    expect(res.json.result?.isError).toBe(true);
    expect(String(toolText(res.json.result).error)).toContain("re-enroll");
    expect(state.calls).toHaveLength(0);
  });

  it("surfaces the edge function's own error, redacted, and audits the failure", async () => {
    const state: FakeState = {
      agent: await agentWith(["intake.approve_pricing"]),
      audits: [],
      calls: [],
      hubReply: { ok: false, status: 400, body: { error: "quotedFee must be between 750 and 2500 (FANFUEL_HUB_KEY)" } },
    };
    const res = await rpc(fakeStore(state), "tools/call", {
      name: "approve_pricing",
      arguments: { client_id: CLIENT_ID, quoted_fee: 100, deposit_amount: 50, deposit_due_by: "2026-11-01" },
    });
    expect(res.json.result?.isError).toBe(true);
    expect(toolText(res.json.result).error).toBe("quotedFee must be between 750 and 2500 ([redacted])");
    expect(state.audits[0].success).toBe(false);
    const sent = state.calls[0].body;
    expect(sent.quotedFee).toBe(100);
    expect((sent.payment as Record<string, unknown>).deposit).toEqual({ amount: 50, dueBy: "2026-11-01" });
  });

  it("record_payment and get_payment_status carry the operator through", async () => {
    const state: FakeState = { agent: await agentWith(["payments.record", "payments.read"]), audits: [], calls: [] };
    const store = fakeStore(state);
    await rpc(store, "tools/call", { name: "record_payment", arguments: { client_id: CLIENT_ID, amount: 250.5, method: "zelle" } });
    await rpc(store, "tools/call", { name: "get_payment_status", arguments: { client_id: CLIENT_ID } });
    expect(state.calls[0]).toMatchObject({ kind: "intake", target: "payments-record", body: { operatorUserId: STAFF_ID, clientId: CLIENT_ID, amount: 250.5, method: "zelle" } });
    expect(state.calls[1]).toMatchObject({ kind: "payments", body: { clientId: CLIENT_ID, operatorUserId: STAFF_ID } });
  });

  it("list and get intake clients are summarized for staff agents", async () => {
    const state: FakeState = { agent: await agentWith(["intake.list", "intake.read"]), audits: [], calls: [], intakeRows: [intakeRow] };
    const store = fakeStore(state);
    const listed = await rpc(store, "tools/call", { name: "list_intake_clients", arguments: { status: "approved" } });
    const clients = toolText(listed.json.result).clients as Array<Record<string, unknown>>;
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ client_id: CLIENT_ID, legal_name: "Deajah Newman", payment_status: "current", remaining_balance: 750, quoted_fee: 1250 });
    expect(clients[0]).not.toHaveProperty("record");
    expect(state.calls[0].body.operatorUserId).toBe(STAFF_ID);

    const got = await rpc(store, "tools/call", { name: "get_intake_client", arguments: { client_id: CLIENT_ID } });
    const detail = toolText(got.json.result);
    expect((detail.record as Record<string, unknown>).bureauReported).toBeDefined();

    const filtered = await rpc(store, "tools/call", { name: "list_intake_clients", arguments: { status: "engaged" } });
    expect(toolText(filtered.json.result).clients).toEqual([]);
  });
});

describe("bureau report upload", () => {
  const reportText = "Account CAPITAL ONE balance $1200 status charge off ".repeat(40);

  it("lists the upload tool for an agent with reports.upload", async () => {
    const store = fakeStore({ agent: await agentWith(ALL_SCOPES), audits: [], calls: [] });
    const listed = await rpc(store, "tools/list", {});
    const names = (listed.json.result?.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toContain("upload_bureau_report");
    expect(names).toHaveLength(ALL_SCOPES.length);
  });

  it("stores the report through analysis-upload and returns the queued job", async () => {
    const jobId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const state: FakeState = {
      agent: await agentWith(["reports.upload"]),
      audits: [],
      calls: [],
      hubReply: okReply({
        job_id: jobId,
        status: "QUEUED",
        queued: true,
        bureau: "experian",
        input_mode: "text",
        page_count: 36,
        text_chars: reportText.length,
        storage_paths: [`${STAFF_ID}/upload/chunk-001.txt`],
        source_pdf_path: `${STAFF_ID}/bureau-reports/upload/source.pdf`,
        source_pdf_stored: true,
        session_id: SESSION_ID,
        client_id: null,
        upload_id: "upload",
        intake_saved: false,
      }),
    };
    const res = await rpc(fakeStore(state), "tools/call", {
      name: "upload_bureau_report",
      arguments: { bureau: "experian", session_id: SESSION_ID, report_text: reportText, filename: "experian.pdf" },
    });
    expect(res.json.result?.isError).toBe(false);
    expect(toolText(res.json.result)).toMatchObject({
      job_id: jobId,
      status: "QUEUED",
      queued: true,
      input_mode: "text",
      session_id: SESSION_ID,
      bureau: "experian",
    });
    expect(state.calls[0]).toMatchObject({
      kind: "session",
      target: "analysis-upload",
      body: { operatorUserId: STAFF_ID, bureau: "experian", session_id: SESSION_ID, queue: true },
    });
    expect(String(state.calls[0].body.report_text)).toContain("CAPITAL ONE");
    expect(JSON.stringify(state.calls[0].body)).not.toContain(SECRET);
    expect(state.audits[0].success).toBe(true);
    expect(state.audits[0].subjectId).toBe(SESSION_ID);
  });

  it("can store without starting, then start_analysis uses the text chunks", async () => {
    const state: FakeState = {
      agent: await agentWith(["reports.upload", "analysis.start"]),
      audits: [],
      calls: [],
      hubReply: okReply({
        queued: false,
        bureau: "equifax",
        input_mode: "text",
        storage_paths: [`${STAFF_ID}/upload/chunk-001.txt`],
        session_id: null,
        client_id: CLIENT_ID,
      }),
    };
    const store = fakeStore(state);
    const uploaded = await rpc(store, "tools/call", {
      name: "upload_bureau_report",
      arguments: { bureau: "equifax", client_id: CLIENT_ID, report_text: reportText, queue: false },
    });
    expect(toolText(uploaded.json.result).queued).toBe(false);
    state.hubReply = okReply({ jobId: "job-1", status: "QUEUED" });
    const started = await rpc(store, "tools/call", {
      name: "start_analysis",
      arguments: {
        storage_paths: [`${STAFF_ID}/upload/chunk-001.txt`],
        client_id: CLIENT_ID,
        input_mode: "text",
        bureau: "equifax",
        total_pages: 36,
        report_type: "equifax",
      },
    });
    expect(started.json.result?.isError).toBe(false);
    expect(state.calls[1]).toMatchObject({
      target: "analysis-start",
      body: {
        operatorUserId: STAFF_ID,
        clientId: CLIENT_ID,
        inputMode: "text",
        bureau: "equifax",
        totalPages: 36,
        source: "agent_upload",
      },
    });
  });

  it("refuses a bad upload before any hub call", async () => {
    const state: FakeState = { agent: await agentWith(["reports.upload", "analysis.start"]), audits: [], calls: [] };
    const res = await rpc(fakeStore(state), "tools/call", {
      name: "upload_bureau_report",
      arguments: { bureau: "experian", session_id: SESSION_ID, pdf_url: "https://169.254.169.254/report.pdf" },
    });
    expect(res.json.result?.isError).toBe(true);
    expect(toolText(res.json.result).error).toContain("not allowed");
    expect(state.calls).toHaveLength(0);
    expect(state.audits[0].success).toBe(false);

    const outside = await rpc(fakeStore(state), "tools/call", {
      name: "start_analysis",
      arguments: { storage_paths: ["someone-else/page-001.jpg"] },
    });
    expect(toolText(outside.json.result).error).toContain("staff member");
    expect(state.calls).toHaveLength(0);
  });

  it("does not offer upload without the scope", async () => {
    const state: FakeState = { agent: await agentWith(["analysis.start"]), audits: [], calls: [] };
    const res = await rpc(fakeStore(state), "tools/call", {
      name: "upload_bureau_report",
      arguments: { bureau: "experian", session_id: SESSION_ID, report_text: reportText },
    });
    expect(toolText(res.json.result).error).toBe("agent is not allowed to use this tool");
    expect(state.calls).toHaveLength(0);
  });
});

describe("assessment tools", () => {
  it("create_assessment is owned by the enrolling staff member", async () => {
    const state: FakeState = { agent: await agentWith(["assessments.create"]), audits: [], calls: [] };
    const res = await rpc(fakeStore(state), "tools/call", {
      name: "create_assessment",
      arguments: { full_name: "Deajah Newman", bureaus: ["experian", "equifax", "experian"] },
    });
    expect(res.json.result?.isError).toBe(false);
    expect(toolText(res.json.result).session_id).toBe(SESSION_ID);
    expect(state.calls[0]).toMatchObject({
      kind: "hub",
      target: "create_assessment",
      body: { user_id: STAFF_ID, mode: "ai", selected_bureaus: ["experian", "equifax"] },
    });
    expect((state.calls[0].body.consumer_info as Record<string, unknown>).fullName).toBe("Deajah Newman");
    expect(state.audits[0].subjectId).toBe(SESSION_ID);
  });

  it("get_assessment picks the documented fields from the hub reply", async () => {
    const state: FakeState = {
      agent: await agentWith(["assessments.read"]),
      audits: [],
      calls: [],
      hubReply: okReply({ session_id: SESSION_ID, status: "DONE", accounts: [], account_count: 0, secret_internal: "x" }),
    };
    const res = await rpc(fakeStore(state), "tools/call", { name: "get_assessment", arguments: { session_id: SESSION_ID } });
    const detail = toolText(res.json.result);
    expect(detail.status).toBe("DONE");
    expect(detail).not.toHaveProperty("secret_internal");
    expect(state.calls[0]).toMatchObject({ target: "get_assessment_detail", body: { session_id: SESSION_ID } });
  });
});

describe("validation", () => {
  const bad = (args: Record<string, unknown>) => {
    const parsed = parseCreateIntakeArgs(args);
    expect(parsed.ok).toBe(false);
    return (parsed as { error: string }).error;
  };
  const base = {
    legal_name: "A B",
    dob: "1990-01-01",
    address_line1: "1 St",
    city: "Chicago",
    state: "IL",
    zip: "60601",
    phone: "3125551212",
    email: "a@b.c",
  };

  it("requires legal_name and validates optional fields when present", () => {
    expect(parseCreateIntakeArgs({ legal_name: "Only Name" }).ok).toBe(true);
    expect(bad({ ...base, dob: "1990-02-30" })).toBe("dob must be YYYY-MM-DD");
    expect(bad({ ...base, zip: "ABC" })).toBe("zip must be 5 digits or ZIP+4");
    expect(bad({ ...base, state: "Ill" })).toBe("state is too long");
    expect(bad({ ...base, email: "nope" })).toBe("email must contain @");
    expect(bad({ ...base, operator_user_id: STAFF_ID })).toBe("unknown field: operator_user_id");
  });

  it("summarizes an intake row without the bureau snapshots", () => {
    const summary = summarizeIntakeClient(intakeRow);
    expect(summary.recommended_tier).toBe("Tier 2 — Moderate");
    expect(summary).not.toHaveProperty("bureauReported");
  });
});
