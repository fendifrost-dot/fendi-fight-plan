/**
 * Credit Compass MCP.
 *
 * Agent calls authenticate with Authorization: Bearer <agent secret>.
 * The secret is stored only as a SHA-256 hash. A Supabase session JWT is
 * rejected, and so is FANFUEL_HUB_KEY (that stays the Control Center key).
 *
 * Every read and write inserts an mcp_audit_log row first. If that insert
 * fails, the call does not run.
 *
 * The tools do not re-implement intake, pricing, or payments. They call the
 * project's own hub-authenticated edge functions (intake-*, payments-*,
 * control-center-api) with the enrolling staff member as the operator, so the
 * existing validation, staff checks, and hub_operator_audit rows all still apply.
 *
 * This module has no Deno imports so the frontend and vitest can import it.
 */

export const SERVER_NAME = "credit-compass";
export const SERVER_VERSION = "1.0.0";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = "2025-06-18";

export const READ_SCOPES = [
  "assessments.list",
  "assessments.read",
  "reports.read",
  "intake.list",
  "intake.read",
  "payments.read",
] as const;

export const WRITE_SCOPES = [
  "assessments.create",
  "reports.generate",
  "intake.create",
  "intake.score",
  "intake.approve_pricing",
  "intake.summary",
  "payments.record",
] as const;

export const ALL_SCOPES = [...READ_SCOPES, ...WRITE_SCOPES] as const;
export type McpScope = (typeof ALL_SCOPES)[number];

const SCOPE_SET = new Set<string>(ALL_SCOPES);

export const ASSESSMENT_MODES = ["ai", "manual"] as const;
export const BUREAUS = ["equifax", "experian", "transunion"] as const;
export const INTAKE_STATUSES = ["intake", "awaiting_approval", "approved", "doc_generated", "engaged"] as const;

/** High-risk names. They are not tools and never will be on an agent token. */
export const BLOCKED_TOOLS = [
  "delete_assessment",
  "delete_intake_client",
  "delete_client",
  "send_email",
  "send_pitch_email",
  "export_all",
  "run_sql",
  "query_sql",
  "raw_sql",
] as const;

const BLOCKED_TOOL_SET = new Set<string>(BLOCKED_TOOLS);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SECRET_RE =
  /ccma_[A-Za-z0-9_-]+|cgma_[A-Za-z0-9_-]+|FANFUEL_HUB_KEY|LOVABLE_API_KEY|SUPABASE_SERVICE_ROLE_KEY|service_role|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

const MAX_EXPIRY_MS = 366 * 24 * 60 * 60 * 1000;
const LIST_DEFAULT = 50;
const LIST_MAX = 100;

export interface McpAgentRecord {
  id: string;
  name: string;
  secretHash: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  /** Staff user who enrolled the agent. Everything the agent creates is attributed to this user. */
  createdBy: string | null;
}

export interface AuditInsert {
  agentId: string;
  tool: string;
  subjectId: string | null;
  success: boolean;
  error: string | null;
}

/** Result of calling one of the project's own hub-authenticated edge functions. */
export interface HubResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
}

export type StoreResult<T> = { data: T } | { error: string } | { notFound: true };

export interface IntakeClientRow {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  record: Record<string, unknown>;
}

export interface CompassMcpStore {
  findAgentByHash(secretHash: string): Promise<McpAgentRecord | null>;
  insertAudit(row: AuditInsert): Promise<{ id: string } | { error: string }>;
  finishAudit(id: string, success: boolean, error: string | null, subjectId?: string | null): Promise<void>;
  /** control-center-api with the hub key. */
  hub(action: string, params: Record<string, unknown>): Promise<HubResult>;
  /** intake-* / payments-record with the hub key; operatorUserId is set by the caller. */
  intake(path: string, body: Record<string, unknown>): Promise<HubResult>;
  /** payments-status (GET) with the hub key. */
  paymentsStatus(clientId: string, operatorUserId: string): Promise<HubResult>;
  listIntakeClients(operatorUserId: string, limit: number): Promise<{ data: IntakeClientRow[] } | { error: string }>;
  getIntakeClient(operatorUserId: string, clientId: string): Promise<StoreResult<IntakeClientRow>>;
}

export interface EnrolledAgentPublic {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface AuditPublic {
  id: string;
  agent_id: string;
  agent_name: string | null;
  tool: string;
  subject_id: string | null;
  success: boolean;
  error: string | null;
  created_at: string;
}

export interface EnrollStore {
  insertAgent(row: {
    name: string;
    secret_hash: string;
    scopes: string[];
    expires_at: string;
    created_by: string;
  }): Promise<{ agent: EnrolledAgentPublic } | { error: string }>;
  listAgents(): Promise<{ agents: EnrolledAgentPublic[] } | { error: string }>;
  revokeAgent(id: string): Promise<StoreResult<EnrolledAgentPublic>>;
  listAudit(limit: number): Promise<{ rows: AuditPublic[] } | { error: string }>;
}

export interface McpDeps {
  store: CompassMcpStore;
  isForbiddenSecret?: (token: string) => boolean;
  now?: () => Date;
  corsHeaders?: Record<string, string>;
}

export interface EnrollDeps {
  store: EnrollStore;
  authorize: (req: Request) => Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }>;
  now?: () => Date;
  corsHeaders?: Record<string, string>;
}

interface ToolDef {
  name: string;
  scope: McpScope;
  description: string;
  inputSchema: Record<string, unknown>;
}

const uuidSchema = { type: "string", format: "uuid" };
const dateSchema = { type: "string", description: "YYYY-MM-DD" };

const TOOLS: ToolDef[] = [
  {
    name: "list_assessments",
    scope: "assessments.list",
    description: "List credit report assessments (dispute sessions): status, mode, bureaus, consumer name.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: LIST_MAX } },
    },
  },
  {
    name: "get_assessment",
    scope: "assessments.read",
    description:
      "One assessment in full: consumer info, analysis status and result, triaged accounts, and the latest analysis job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["session_id"],
      properties: { session_id: uuidSchema },
    },
  },
  {
    name: "get_report",
    scope: "reports.read",
    description: "Generated dispute letters for one assessment, per bureau. Does not mail anything.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["session_id"],
      properties: { session_id: uuidSchema },
    },
  },
  {
    name: "create_assessment",
    scope: "assessments.create",
    description:
      "Create a new assessment (dispute session) owned by the staff member who enrolled this agent. " +
      "Report PDFs are then uploaded and analyzed from the Credit Compass app; this tool only opens the file.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        full_name: { type: "string" },
        address_line1: { type: "string" },
        address_line2: { type: "string" },
        city_state_zip: { type: "string" },
        mode: { type: "string", enum: [...ASSESSMENT_MODES], description: "default ai" },
        bureaus: { type: "array", items: { type: "string", enum: [...BUREAUS] } },
      },
    },
  },
  {
    name: "generate_report",
    scope: "reports.generate",
    description:
      "Generate dispute letters for every selected bureau on an analyzed assessment with selected accounts. " +
      "Uses the AI letter generator and stores the result on the assessment. Does not mail anything.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["session_id"],
      properties: { session_id: uuidSchema },
    },
  },
  {
    name: "list_intake_clients",
    scope: "intake.list",
    description:
      "List intake clients for the enrolling staff member: status, legal name, quoted fee, payment plan status, remaining balance.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: LIST_MAX },
        status: { type: "string", enum: [...INTAKE_STATUSES] },
      },
    },
  },
  {
    name: "get_intake_client",
    scope: "intake.read",
    description:
      "One intake client's full record: canonical identity, per-bureau snapshots, reconciliation, file profile, pricing, payment plan, artifacts.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["client_id"],
      properties: { client_id: uuidSchema },
    },
  },
  {
    name: "create_intake_client",
    scope: "intake.create",
    description:
      "Start a new intake client from canonical identity. legal_name, dob, address_line1, city, state, zip, phone, and email are required. " +
      "The record is owned by the staff member who enrolled this agent. Bureau PDFs are ingested from the app afterwards.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["legal_name", "dob", "address_line1", "city", "state", "zip", "phone", "email"],
      properties: {
        legal_name: { type: "string" },
        dob: dateSchema,
        address_line1: { type: "string" },
        address_line2: { type: "string" },
        city: { type: "string" },
        state: { type: "string", description: "two-letter" },
        zip: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        employer: { type: "string" },
        referred_by: { type: "string" },
      },
    },
  },
  {
    name: "score_intake_client",
    scope: "intake.score",
    description: "Recompute the file profile and pricing recommendation for an intake client from its bureau data.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["client_id"],
      properties: { client_id: uuidSchema },
    },
  },
  {
    name: "approve_pricing",
    scope: "intake.approve_pricing",
    description:
      "Approve the quoted fee and open the payment plan (deposit plus installments) for an intake client. " +
      "A fee outside the recommended tier needs override_reason.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["client_id", "quoted_fee", "deposit_amount", "deposit_due_by"],
      properties: {
        client_id: uuidSchema,
        quoted_fee: { type: "number" },
        deposit_amount: { type: "number" },
        deposit_due_by: dateSchema,
        schedule_note: { type: "string" },
        discount_label: { type: "string" },
        discount_amount: { type: "number" },
        discount_deadline_hours: { type: "integer" },
        discount_stipulation: { type: "string" },
        override_reason: { type: "string" },
      },
    },
  },
  {
    name: "generate_intake_summary",
    scope: "intake.summary",
    description:
      "Generate the client summary and internal pricing card documents for an intake client with approved pricing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["client_id"],
      properties: { client_id: uuidSchema },
    },
  },
  {
    name: "get_payment_status",
    scope: "payments.read",
    description: "Payment plan state for an intake client: total, paid, remaining, next due, and whether it is late or paid in full.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["client_id"],
      properties: { client_id: uuidSchema },
    },
  },
  {
    name: "record_payment",
    scope: "payments.record",
    description: "Record a payment received against an intake client's plan. Does not charge anyone.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["client_id", "amount"],
      properties: {
        client_id: uuidSchema,
        amount: { type: "number", exclusiveMinimum: 0 },
        method: { type: "string" },
        date: dateSchema,
        reference: { type: "string" },
      },
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export function looksLikeSessionToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  return parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

export async function hashAgentSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateAgentSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `ccma_${encoded}`;
}

export function publicError(message: string): string {
  return message.replace(SECRET_RE, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 300);
}

export function resolveScopes(input: unknown): { ok: true; scopes: McpScope[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "scopes must be a non-empty list" };
  const chosen = new Set<string>();
  for (const entry of input) {
    if (typeof entry !== "string") return { ok: false, error: "scopes must be strings" };
    if (entry === "read") {
      READ_SCOPES.forEach((scope) => chosen.add(scope));
      continue;
    }
    if (entry === "write") {
      WRITE_SCOPES.forEach((scope) => chosen.add(scope));
      continue;
    }
    if (!SCOPE_SET.has(entry)) return { ok: false, error: `unknown scope: ${entry}` };
    chosen.add(entry);
  }
  const scopes = ALL_SCOPES.filter((scope) => chosen.has(scope));
  if (scopes.length === 0) return { ok: false, error: "scopes must be a non-empty list" };
  return { ok: true, scopes };
}

export function validateEnrollment(
  input: { name?: unknown; scopes?: unknown; expires_at?: unknown },
  now: Date,
): { ok: true; name: string; scopes: McpScope[]; expiresAt: string } | { ok: false; error: string } {
  if (typeof input.name !== "string") return { ok: false, error: "name is required" };
  const name = input.name.trim().toLowerCase();
  if (!AGENT_NAME_RE.test(name)) {
    return { ok: false, error: "name must be lowercase letters, digits, hyphens, or underscores, and start with a letter" };
  }
  const scopes = resolveScopes(input.scopes);
  if (scopes.ok !== true) return { ok: false, error: (scopes as { error: string }).error };
  if (typeof input.expires_at !== "string") return { ok: false, error: "expires_at is required" };
  const expiresMs = Date.parse(input.expires_at);
  if (!Number.isFinite(expiresMs)) return { ok: false, error: "expires_at must be a date" };
  if (expiresMs <= now.getTime()) return { ok: false, error: "expires_at must be in the future" };
  if (expiresMs > now.getTime() + MAX_EXPIRY_MS) return { ok: false, error: "expires_at cannot be more than 366 days away" };
  return { ok: true, name, scopes: (scopes as { scopes: McpScope[] }).scopes, expiresAt: new Date(expiresMs).toISOString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pick(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = row[field] ?? null;
  return out;
}

function rpcId(msg: Record<string, unknown>): string | number | null {
  const id = msg.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function json(body: unknown, status: number, cors: Record<string, string>, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors, ...extra },
  });
}

function authError(message: string, cors: Record<string, string>): Response {
  return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, 401, cors);
}

function wantsSse(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  if (!accept) return false;
  if (accept.includes("application/json") || accept.includes("*/*")) return false;
  return accept.includes("text/event-stream");
}

function rpcResponse(
  req: Request,
  id: string | number | null,
  payload: { result?: unknown; error?: { code: number; message: string } },
  cors: Record<string, string>,
  protocol: string,
): Response {
  const body = { jsonrpc: "2.0", id, ...payload };
  const extra = { "MCP-Protocol-Version": protocol };
  if (!wantsSse(req)) return json(body, 200, cors, extra);
  const sse = `event: message\ndata: ${JSON.stringify(body)}\n\n`;
  return new Response(sse, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", ...cors, ...extra },
  });
}

function toolResult(isError: boolean, value: unknown): Record<string, unknown> {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError };
}

function unknownField(args: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(args)) if (!allowed.includes(key)) return key;
  return null;
}

function requireUuid(value: unknown, field: string): string | { error: string } {
  if (typeof value !== "string" || !UUID_RE.test(value)) return { error: `${field} must be a uuid` };
  return value;
}

function requireText(value: unknown, field: string, max: number): string | { error: string } {
  if (typeof value !== "string" || value.trim() === "") return { error: `${field} is required` };
  if (value.length > max) return { error: `${field} is too long` };
  return value.trim();
}

function optionalText(value: unknown, field: string, max: number): string | undefined | { error: string } {
  if (value == null) return undefined;
  if (typeof value !== "string") return { error: `${field} must be text` };
  if (value.length > max) return { error: `${field} is too long` };
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function requireDate(value: unknown, field: string): string | { error: string } {
  if (typeof value !== "string" || !isCalendarDate(value)) return { error: `${field} must be YYYY-MM-DD` };
  return value;
}

function requireAmount(value: unknown, field: string): number | { error: string } {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return { error: `${field} must be a positive number` };
  return Math.round(value * 100) / 100;
}

function subjectIdOf(args: Record<string, unknown>): string | null {
  for (const key of ["client_id", "session_id"]) {
    const id = args[key];
    if (typeof id === "string" && UUID_RE.test(id)) return id;
  }
  return null;
}

function parseLimit(value: unknown): number | { error: string } {
  if (value == null) return LIST_DEFAULT;
  if (typeof value !== "number" || !Number.isInteger(value)) return { error: "limit must be an integer" };
  if (value < 1 || value > LIST_MAX) return { error: `limit must be from 1 to ${LIST_MAX}` };
  return value;
}

type ToolOutcome = { ok: true; value: unknown; subjectId?: string } | { ok: false; error: string };

/** Turn a hub/edge function reply into a tool outcome. Error bodies pass through, redacted. */
function fromHub(result: HubResult, subjectId?: string): ToolOutcome {
  if (!result.ok) {
    const body = result.body ?? {};
    const message =
      typeof body.error === "string"
        ? body.error
        : isRecord(body.error) && typeof body.error.message === "string"
          ? body.error.message
          : `request failed (${result.status})`;
    return { ok: false, error: message };
  }
  return { ok: true, value: result.body ?? {}, subjectId };
}

/** Summarize an intake row for list output without the full bureau snapshots. */
export function summarizeIntakeClient(row: IntakeClientRow): Record<string, unknown> {
  const record = row.record;
  const canonical = isRecord(record.canonical) ? record.canonical : {};
  const pricingApproved = isRecord(record.pricingApproved) ? record.pricingApproved : null;
  const pricingRecommendation = isRecord(record.pricingRecommendation) ? record.pricingRecommendation : null;
  const tier = pricingRecommendation && isRecord(pricingRecommendation.tier) ? pricingRecommendation.tier : null;
  const plan = isRecord(record.paymentPlan) ? record.paymentPlan : null;
  return {
    client_id: row.id,
    status: row.status,
    legal_name: typeof canonical.legalName === "string" ? canonical.legalName : null,
    email: typeof canonical.email === "string" ? canonical.email : null,
    phone: typeof canonical.phone === "string" ? canonical.phone : null,
    recommended_tier: tier && typeof tier.name === "string" ? tier.name : null,
    quoted_fee: pricingApproved && typeof pricingApproved.quotedFee === "number" ? pricingApproved.quotedFee : null,
    net_total: pricingApproved && typeof pricingApproved.netTotal === "number" ? pricingApproved.netTotal : null,
    payment_status: plan && typeof plan.status === "string" ? plan.status : null,
    remaining_balance: plan && typeof plan.remainingBalance === "number" ? plan.remainingBalance : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Validate create_intake_client arguments into the canonical shape intake-create-canonical expects. */
export function parseCreateIntakeArgs(
  args: Record<string, unknown>,
): { ok: true; canonical: Record<string, unknown> } | { ok: false; error: string } {
  const allowed = [
    "legal_name",
    "dob",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "zip",
    "phone",
    "email",
    "employer",
    "referred_by",
  ];
  const extra = unknownField(args, allowed);
  if (extra) return { ok: false, error: `unknown field: ${extra}` };

  const legalName = requireText(args.legal_name, "legal_name", 200);
  if (typeof legalName !== "string") return { ok: false, error: legalName.error };
  const dob = requireDate(args.dob, "dob");
  if (typeof dob !== "string") return { ok: false, error: dob.error };
  const line1 = requireText(args.address_line1, "address_line1", 200);
  if (typeof line1 !== "string") return { ok: false, error: line1.error };
  const line2 = optionalText(args.address_line2, "address_line2", 200);
  if (line2 && typeof line2 === "object") return { ok: false, error: line2.error };
  const city = requireText(args.city, "city", 100);
  if (typeof city !== "string") return { ok: false, error: city.error };
  const state = requireText(args.state, "state", 2);
  if (typeof state !== "string") return { ok: false, error: state.error };
  if (!/^[A-Za-z]{2}$/.test(state)) return { ok: false, error: "state must be two letters" };
  const zip = requireText(args.zip, "zip", 10);
  if (typeof zip !== "string") return { ok: false, error: zip.error };
  if (!/^\d{5}(-\d{4})?$/.test(zip)) return { ok: false, error: "zip must be 5 digits or ZIP+4" };
  const phone = requireText(args.phone, "phone", 40);
  if (typeof phone !== "string") return { ok: false, error: phone.error };
  const email = requireText(args.email, "email", 320);
  if (typeof email !== "string") return { ok: false, error: email.error };
  if (!email.includes("@")) return { ok: false, error: "email must contain @" };
  const employer = optionalText(args.employer, "employer", 200);
  if (employer && typeof employer === "object") return { ok: false, error: employer.error };
  const referredBy = optionalText(args.referred_by, "referred_by", 200);
  if (referredBy && typeof referredBy === "object") return { ok: false, error: referredBy.error };

  const canonical: Record<string, unknown> = {
    legalName,
    dob,
    currentAddress: { line1, line2: typeof line2 === "string" ? line2 : undefined, city, state: state.toUpperCase(), zip },
    phone,
    email: email.toLowerCase(),
  };
  if (typeof employer === "string") canonical.employer = employer;
  if (typeof referredBy === "string") canonical.referredBy = referredBy;
  return { ok: true, canonical };
}

async function withAudit(
  store: CompassMcpStore,
  row: AuditInsert,
  run: () => Promise<ToolOutcome>,
): Promise<{ isError: boolean; value: unknown }> {
  const inserted = await store.insertAudit({ ...row, error: publicError(row.error ?? "pending"), success: false });
  if ("error" in inserted) {
    return { isError: true, value: { error: "Audit log did not record this call, so it was refused." } };
  }
  let outcome: ToolOutcome;
  try {
    outcome = await run();
  } catch (err) {
    console.error("compass-mcp tool failed", err instanceof Error ? err.name : "error");
    outcome = { ok: false, error: "request failed" };
  }
  const failed = outcome.ok !== true;
  const error = failed ? publicError((outcome as { error: string }).error) : null;
  const subject = outcome.ok === true && typeof outcome.subjectId === "string" ? outcome.subjectId : null;
  try {
    await store.finishAudit(inserted.id, !failed, error, subject ?? row.subjectId);
  } catch (err) {
    console.error("compass-mcp audit finish failed", err instanceof Error ? err.name : "error");
  }
  if (failed) return { isError: true, value: { error } };
  return { isError: false, value: (outcome as { value: unknown }).value };
}

const ASSESSMENT_DETAIL_FIELDS = [
  "session_id",
  "user_id",
  "created_at",
  "updated_at",
  "status",
  "is_analyzed",
  "mode",
  "bureaus",
  "consumer_info",
  "analysis_result",
  "outcome_confirmation",
  "survey",
  "documents",
  "accounts",
  "account_count",
] as const;

async function executeTool(
  store: CompassMcpStore,
  agent: McpAgentRecord,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const operator = agent.createdBy && UUID_RE.test(agent.createdBy) ? agent.createdBy : null;
  const needsOperator = name !== "list_assessments" && name !== "get_assessment" && name !== "get_report" && name !== "generate_report";
  if (needsOperator && !operator) {
    return { ok: false, error: "this agent has no enrolling staff member to act as; re-enroll it in Settings" };
  }

  if (name === "list_assessments") {
    const extra = unknownField(args, ["limit"]);
    if (extra) return { ok: false, error: `unknown field: ${extra}` };
    const limit = parseLimit(args.limit);
    if (typeof limit !== "number") return { ok: false, error: limit.error };
    const result = fromHub(await store.hub("get_assessments", {}));
    if (result.ok !== true) return result;
    const body = isRecord(result.value) ? result.value : {};
    const rows = Array.isArray(body.assessments) ? body.assessments.slice(0, limit) : [];
    return { ok: true, value: { assessments: rows } };
  }

  if (name === "get_assessment" || name === "get_report" || name === "generate_report") {
    const extra = unknownField(args, ["session_id"]);
    if (extra) return { ok: false, error: `unknown field: ${extra}` };
    const sessionId = requireUuid(args.session_id, "session_id");
    if (typeof sessionId !== "string") return { ok: false, error: sessionId.error };
    const action = name === "get_assessment" ? "get_assessment_detail" : name;
    const result = fromHub(await store.hub(action, { session_id: sessionId }), sessionId);
    if (result.ok !== true || name !== "get_assessment") return result;
    const body = isRecord(result.value) ? result.value : {};
    return { ok: true, subjectId: sessionId, value: pick(body, ASSESSMENT_DETAIL_FIELDS) };
  }

  if (name === "create_assessment") {
    const allowed = ["full_name", "address_line1", "address_line2", "city_state_zip", "mode", "bureaus"];
    const extra = unknownField(args, allowed);
    if (extra) return { ok: false, error: `unknown field: ${extra}` };
    const text: Record<string, string> = {};
    for (const [key, target] of [
      ["full_name", "fullName"],
      ["address_line1", "addressLine1"],
      ["address_line2", "addressLine2"],
      ["city_state_zip", "cityStateZip"],
    ] as const) {
      const parsed = optionalText(args[key], key, 300);
      if (parsed && typeof parsed === "object") return { ok: false, error: parsed.error };
      text[target] = typeof parsed === "string" ? parsed : "";
    }
    let mode = "ai";
    if (args.mode != null) {
      if (typeof args.mode !== "string" || !(ASSESSMENT_MODES as readonly string[]).includes(args.mode)) {
        return { ok: false, error: "mode must be ai or manual" };
      }
      mode = args.mode;
    }
    const bureaus: string[] = [];
    if (args.bureaus != null) {
      if (!Array.isArray(args.bureaus)) return { ok: false, error: "bureaus must be a list" };
      for (const entry of args.bureaus) {
        if (typeof entry !== "string" || !(BUREAUS as readonly string[]).includes(entry)) {
          return { ok: false, error: "bureaus must be equifax, experian, or transunion" };
        }
        if (!bureaus.includes(entry)) bureaus.push(entry);
      }
    }
    const result = fromHub(
      await store.hub("create_assessment", {
        user_id: operator,
        consumer_info: text,
        mode,
        selected_bureaus: bureaus,
      }),
    );
    if (result.ok !== true) return result;
    const body = isRecord(result.value) ? result.value : {};
    const sessionId = typeof body.session_id === "string" ? body.session_id : undefined;
    return { ok: true, subjectId: sessionId, value: pick(body, ["session_id", "created_at", "status"]) };
  }

  if (name === "list_intake_clients") {
    const extra = unknownField(args, ["limit", "status"]);
    if (extra) return { ok: false, error: `unknown field: ${extra}` };
    const limit = parseLimit(args.limit);
    if (typeof limit !== "number") return { ok: false, error: limit.error };
    let status: string | null = null;
    if (args.status != null) {
      if (typeof args.status !== "string" || !(INTAKE_STATUSES as readonly string[]).includes(args.status)) {
        return { ok: false, error: `status must be one of ${INTAKE_STATUSES.join(", ")}` };
      }
      status = args.status;
    }
    const listed = await store.listIntakeClients(operator!, limit);
    if ("error" in listed) return { ok: false, error: listed.error };
    const rows = listed.data.filter((row) => status == null || row.status === status).slice(0, limit);
    return { ok: true, value: { clients: rows.map(summarizeIntakeClient) } };
  }

  if (name === "get_intake_client") {
    const extra = unknownField(args, ["client_id"]);
    if (extra) return { ok: false, error: `unknown field: ${extra}` };
    const clientId = requireUuid(args.client_id, "client_id");
    if (typeof clientId !== "string") return { ok: false, error: clientId.error };
    const found = await store.getIntakeClient(operator!, clientId);
    if ("error" in found) return { ok: false, error: found.error };
    if ("notFound" in found) return { ok: false, error: "intake client not found" };
    return {
      ok: true,
      subjectId: clientId,
      value: { ...summarizeIntakeClient(found.data), record: found.data.record },
    };
  }

  if (name === "create_intake_client") {
    const parsed = parseCreateIntakeArgs(args);
    if (parsed.ok !== true) return { ok: false, error: (parsed as { error: string }).error };
    const result = fromHub(
      await store.intake("intake-create-canonical", {
        operatorUserId: operator,
        canonical: (parsed as { canonical: Record<string, unknown> }).canonical,
      }),
    );
    if (result.ok !== true) return result;
    const body = isRecord(result.value) ? result.value : {};
    const clientId = typeof body.clientId === "string" ? body.clientId : undefined;
    const record = isRecord(body.record) ? body.record : {};
    return { ok: true, subjectId: clientId, value: { client_id: clientId ?? null, status: record.status ?? null } };
  }

  if (name === "score_intake_client" || name === "generate_intake_summary" || name === "get_payment_status") {
    const extra = unknownField(args, ["client_id"]);
    if (extra) return { ok: false, error: `unknown field: ${extra}` };
    const clientId = requireUuid(args.client_id, "client_id");
    if (typeof clientId !== "string") return { ok: false, error: clientId.error };
    if (name === "get_payment_status") {
      return fromHub(await store.paymentsStatus(clientId, operator!), clientId);
    }
    const path = name === "score_intake_client" ? "intake-score-file" : "intake-generate-summary";
    const result = fromHub(await store.intake(path, { operatorUserId: operator, clientId }), clientId);
    if (result.ok !== true) return result;
    const body = isRecord(result.value) ? result.value : {};
    if (name === "score_intake_client") {
      return { ok: true, subjectId: clientId, value: pick(body, ["fileProfile", "pricingRecommendation"]) };
    }
    return { ok: true, subjectId: clientId, value: pick(body, ["clientId", "artifacts"]) };
  }

  if (name === "approve_pricing") {
    const allowed = [
      "client_id",
      "quoted_fee",
      "deposit_amount",
      "deposit_due_by",
      "schedule_note",
      "discount_label",
      "discount_amount",
      "discount_deadline_hours",
      "discount_stipulation",
      "override_reason",
    ];
    const extra = unknownField(args, allowed);
    if (extra) return { ok: false, error: `unknown field: ${extra}` };
    const clientId = requireUuid(args.client_id, "client_id");
    if (typeof clientId !== "string") return { ok: false, error: clientId.error };
    const quotedFee = requireAmount(args.quoted_fee, "quoted_fee");
    if (typeof quotedFee !== "number") return { ok: false, error: quotedFee.error };
    const depositAmount = requireAmount(args.deposit_amount, "deposit_amount");
    if (typeof depositAmount !== "number") return { ok: false, error: depositAmount.error };
    const depositDueBy = requireDate(args.deposit_due_by, "deposit_due_by");
    if (typeof depositDueBy !== "string") return { ok: false, error: depositDueBy.error };
    const scheduleNote = optionalText(args.schedule_note, "schedule_note", 500);
    if (scheduleNote && typeof scheduleNote === "object") return { ok: false, error: scheduleNote.error };
    const overrideReason = optionalText(args.override_reason, "override_reason", 500);
    if (overrideReason && typeof overrideReason === "object") return { ok: false, error: overrideReason.error };

    let discount: Record<string, unknown> | undefined;
    const hasDiscount =
      args.discount_label != null || args.discount_amount != null || args.discount_deadline_hours != null || args.discount_stipulation != null;
    if (hasDiscount) {
      const label = requireText(args.discount_label, "discount_label", 100);
      if (typeof label !== "string") return { ok: false, error: label.error };
      const amount = requireAmount(args.discount_amount, "discount_amount");
      if (typeof amount !== "number") return { ok: false, error: amount.error };
      const hours = args.discount_deadline_hours;
      if (typeof hours !== "number" || !Number.isInteger(hours) || hours <= 0) {
        return { ok: false, error: "discount_deadline_hours must be a positive whole number" };
      }
      const stipulation = requireText(args.discount_stipulation, "discount_stipulation", 500);
      if (typeof stipulation !== "string") return { ok: false, error: stipulation.error };
      discount = { label, amount, deadlineHours: hours, stipulation };
    }

    const result = fromHub(
      await store.intake("intake-approve-pricing", {
        operatorUserId: operator,
        clientId,
        quotedFee,
        discount,
        payment: { deposit: { amount: depositAmount, dueBy: depositDueBy }, scheduleNote },
        overrideReason,
      }),
      clientId,
    );
    if (result.ok !== true) return result;
    const body = isRecord(result.value) ? result.value : {};
    const record = isRecord(body.record) ? body.record : {};
    return {
      ok: true,
      subjectId: clientId,
      value: { client_id: clientId, status: record.status ?? null, pricing_approved: record.pricingApproved ?? null, payment_plan: record.paymentPlan ?? null },
    };
  }

  if (name === "record_payment") {
    const extra = unknownField(args, ["client_id", "amount", "method", "date", "reference"]);
    if (extra) return { ok: false, error: `unknown field: ${extra}` };
    const clientId = requireUuid(args.client_id, "client_id");
    if (typeof clientId !== "string") return { ok: false, error: clientId.error };
    const amount = requireAmount(args.amount, "amount");
    if (typeof amount !== "number") return { ok: false, error: amount.error };
    const method = optionalText(args.method, "method", 60);
    if (method && typeof method === "object") return { ok: false, error: method.error };
    let date: string | undefined;
    if (args.date != null) {
      const parsed = requireDate(args.date, "date");
      if (typeof parsed !== "string") return { ok: false, error: parsed.error };
      date = parsed;
    }
    const reference = optionalText(args.reference, "reference", 120);
    if (reference && typeof reference === "object") return { ok: false, error: reference.error };
    const result = fromHub(
      await store.intake("payments-record", { operatorUserId: operator, clientId, amount, method, date, reference }),
      clientId,
    );
    if (result.ok !== true) return result;
    const body = isRecord(result.value) ? result.value : {};
    return { ok: true, subjectId: clientId, value: { client_id: clientId, payment_plan: body.paymentPlan ?? null } };
  }

  return { ok: false, error: "unknown tool" };
}

function negotiatedProtocol(requested: unknown): string | null {
  if (typeof requested !== "string") return null;
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : null;
}

async function handleMessage(
  agent: McpAgentRecord,
  msg: Record<string, unknown>,
  store: CompassMcpStore,
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const id = rpcId(msg);
  const method = msg.method;
  if (typeof method !== "string" || method.length === 0) {
    return rpcResponse(req, id, { error: { code: -32600, message: "Invalid request" } }, cors, "2025-03-26");
  }
  const headerProtocol = negotiatedProtocol(req.headers.get("mcp-protocol-version")) ?? "2025-03-26";

  if (method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store", ...cors } });
  }

  const params = isRecord(msg.params) ? msg.params : {};
  let tool = method;
  let subjectId: string | null = null;
  if (method === "tools/call") {
    tool = typeof params.name === "string" ? params.name.slice(0, 80) : "tools/call";
    const args = isRecord(params.arguments) ? params.arguments : {};
    subjectId = subjectIdOf(args);
  }

  const outcome = await withAudit(store, { agentId: agent.id, tool, subjectId, success: false, error: "pending" }, async () => {
    if (method === "initialize") {
      const protocol = negotiatedProtocol(params.protocolVersion) ?? LATEST_PROTOCOL_VERSION;
      return {
        ok: true,
        value: {
          protocolVersion: protocol,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions:
            "Credit Compass staff file: assessments, intake clients, pricing, and payment plans. Every call is audited. " +
            "This server cannot delete anything, send mail, charge a card, or run SQL.",
        },
      };
    }
    if (method === "ping") return { ok: true, value: {} };
    if (method === "tools/list") {
      const tools = TOOLS.filter((item) => agent.scopes.includes(item.scope)).map((item) => ({
        name: item.name,
        description: item.description,
        inputSchema: item.inputSchema,
      }));
      return { ok: true, value: { tools } };
    }
    if (method === "tools/call") {
      const name = params.name;
      if (typeof name !== "string" || !TOOL_BY_NAME.has(name)) {
        const blocked = typeof name === "string" && BLOCKED_TOOL_SET.has(name);
        return { ok: false, error: blocked ? "not available on an agent token" : "unknown tool" };
      }
      const def = TOOL_BY_NAME.get(name)!;
      if (!agent.scopes.includes(def.scope)) return { ok: false, error: "agent is not allowed to use this tool" };
      const args = isRecord(params.arguments) ? params.arguments : {};
      return executeTool(store, agent, name, args);
    }
    return { ok: false, error: "unknown method" };
  });

  if (method === "initialize" || method === "ping" || method === "tools/list") {
    if (outcome.isError) {
      return rpcResponse(
        req,
        id,
        { error: { code: -32603, message: String((outcome.value as { error?: string }).error ?? "request failed") } },
        cors,
        headerProtocol,
      );
    }
    const protocol =
      method === "initialize" && isRecord(outcome.value) && typeof outcome.value.protocolVersion === "string"
        ? outcome.value.protocolVersion
        : headerProtocol;
    return rpcResponse(req, id, { result: outcome.value }, cors, protocol);
  }

  if (method !== "tools/call") {
    return rpcResponse(req, id, { error: { code: -32601, message: "Method not found" } }, cors, headerProtocol);
  }

  return rpcResponse(req, id, { result: toolResult(outcome.isError, outcome.value) }, cors, headerProtocol);
}

export async function handleCompassMcpRequest(req: Request, deps: McpDeps): Promise<Response> {
  const cors = deps.corsHeaders ?? {};
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { "Cache-Control": "no-store", ...cors } });
  }
  if (req.method !== "POST") {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Method not allowed" } }, 405, cors);
  }

  const token = bearerToken(req);
  if (!token) return authError("Unauthorized: missing secret", cors);
  if (looksLikeSessionToken(token)) return authError("Unauthorized: session tokens are not accepted", cors);
  if (deps.isForbiddenSecret?.(token)) return authError("Unauthorized: the hub key is not an MCP secret", cors);

  const now = deps.now ?? (() => new Date());
  let agent: McpAgentRecord | null = null;
  try {
    agent = await deps.store.findAgentByHash(await hashAgentSecret(token));
  } catch (err) {
    console.error("compass-mcp agent lookup failed", err instanceof Error ? err.name : "error");
    return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "request failed" } }, 500, cors);
  }
  if (!agent) return authError("Unauthorized: unknown agent secret", cors);

  const expiresMs = Date.parse(agent.expiresAt);
  const active = !agent.revokedAt && Number.isFinite(expiresMs) && expiresMs > now().getTime();

  let parsed: unknown;
  try {
    parsed = JSON.parse(await req.text());
  } catch {
    parsed = null;
  }

  if (!active) {
    const peek = isRecord(parsed) ? parsed : {};
    const method = typeof peek.method === "string" ? peek.method.slice(0, 80) : "(unparsed)";
    const params = isRecord(peek.params) ? peek.params : {};
    const args = isRecord(params.arguments) ? params.arguments : {};
    try {
      await deps.store.insertAudit({
        agentId: agent.id,
        tool: method === "tools/call" && typeof params.name === "string" ? params.name.slice(0, 80) : method,
        subjectId: subjectIdOf(args),
        success: false,
        error: "expired or revoked",
      });
    } catch (err) {
      console.error("compass-mcp expired audit failed", err instanceof Error ? err.name : "error");
    }
    return authError("Unauthorized: agent secret is expired or revoked", cors);
  }

  if (Array.isArray(parsed)) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch requests are not supported" } }, 400, cors);
  }
  if (!isRecord(parsed)) {
    try {
      await deps.store.insertAudit({ agentId: agent.id, tool: "(unparsed)", subjectId: null, success: false, error: "invalid json" });
    } catch (err) {
      console.error("compass-mcp parse audit failed", err instanceof Error ? err.name : "error");
    }
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400, cors);
  }
  if (parsed.jsonrpc !== "2.0") {
    return rpcResponse(req, rpcId(parsed), { error: { code: -32600, message: "Invalid request" } }, cors, "2025-03-26");
  }

  return handleMessage(agent, parsed, deps.store, req, cors);
}

function publicAgent(agent: EnrolledAgentPublic): EnrolledAgentPublic {
  return {
    id: agent.id,
    name: agent.name,
    scopes: agent.scopes,
    expires_at: agent.expires_at,
    revoked_at: agent.revoked_at,
    created_at: agent.created_at,
    created_by: agent.created_by,
  };
}

export async function handleCompassMcpEnrollRequest(req: Request, deps: EnrollDeps): Promise<Response> {
  const cors = deps.corsHeaders ?? {};
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { "Cache-Control": "no-store", ...cors } });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const token = bearerToken(req);
  if (!token) return json({ error: "Unauthorized: missing secret" }, 401, cors);
  if (!looksLikeSessionToken(token)) return json({ error: "Unauthorized: staff session required" }, 401, cors);

  const auth = await deps.authorize(req);
  if (auth.ok !== true) {
    const denied = auth as { status: number; error: string };
    return json({ error: denied.error }, denied.status, cors);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!isRecord(parsed)) return json({ error: "Invalid JSON body" }, 400, cors);
    body = parsed;
  } catch {
    return json({ error: "Invalid JSON body" }, 400, cors);
  }

  const action = body.action;
  const now = deps.now ?? (() => new Date());

  if (action === "list") {
    const listed = await deps.store.listAgents();
    if ("error" in listed) return json({ error: listed.error }, 500, cors);
    return json({ agents: listed.agents.map(publicAgent) }, 200, cors);
  }

  if (action === "audit") {
    const limit = parseLimit(body.limit);
    if (typeof limit !== "number" && body.limit != null) return json({ error: (limit as { error: string }).error }, 400, cors);
    const rows = await deps.store.listAudit(typeof limit === "number" ? limit : 50);
    if ("error" in rows) return json({ error: rows.error }, 500, cors);
    return json(
      {
        rows: rows.rows.map((row) => ({
          id: row.id,
          agent_id: row.agent_id,
          agent_name: row.agent_name,
          tool: row.tool,
          subject_id: row.subject_id,
          success: row.success,
          error: row.error == null ? null : publicError(row.error),
          created_at: row.created_at,
        })),
      },
      200,
      cors,
    );
  }

  if (action === "revoke") {
    const id = requireUuid(body.agent_id, "agent_id");
    if (typeof id !== "string") return json({ error: id.error }, 400, cors);
    const revoked = await deps.store.revokeAgent(id);
    if ("error" in revoked) return json({ error: revoked.error }, 500, cors);
    if ("notFound" in revoked) return json({ error: "agent not found" }, 404, cors);
    return json({ agent: publicAgent(revoked.data) }, 200, cors);
  }

  if (action === "create") {
    const parsed = validateEnrollment({ name: body.name, scopes: body.scopes, expires_at: body.expires_at }, now());
    if (parsed.ok !== true) return json({ error: (parsed as { error: string }).error }, 400, cors);
    const enrolled = parsed as { name: string; scopes: string[]; expiresAt: string };
    const secret = generateAgentSecret();
    const secretHash = await hashAgentSecret(secret);
    const inserted = await deps.store.insertAgent({
      name: enrolled.name,
      secret_hash: secretHash,
      scopes: enrolled.scopes,
      expires_at: enrolled.expiresAt,
      created_by: auth.userId,
    });
    if ("error" in inserted) return json({ error: inserted.error }, 500, cors);
    return json({ agent: publicAgent(inserted.agent), secret }, 200, cors);
  }

  return json({ error: "unknown action" }, 400, cors);
}
