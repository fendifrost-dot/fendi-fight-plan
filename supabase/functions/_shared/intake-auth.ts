import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor, timingSafeEqual } from "./staff-cors.ts";

export { corsFor };

const OPERATOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status: number, error: string) {
  return {
    ok: false as const,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

function toolName(req: Request): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "intake";
}

function adminClient(): SupabaseClient | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

async function recordHubAudit(
  admin: SupabaseClient,
  row: { operator_user_id: string | null; tool: string; success: boolean; error: string | null },
): Promise<boolean> {
  const { data, error } = await admin.from("hub_operator_audit").insert(row).select("id").single();
  return !error && typeof data?.id === "string";
}

async function userIsStaff(admin: SupabaseClient, userId: string): Promise<{ staff: boolean; failed: boolean }> {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "staff")
    .maybeSingle();
  if (error) return { staff: false, failed: true };
  return { staff: !!data, failed: false };
}

export async function requireHubWrite(
  req: Request,
  tool: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const hubKey = req.headers.get("x-api-key") ?? "";
  const expectedHub = Deno.env.get("FANFUEL_HUB_KEY") ?? "";
  if (!timingSafeEqual(hubKey, expectedHub)) return fail(401, "Unauthorized");
  const admin = adminClient();
  if (!admin) return fail(500, "Server misconfiguration");
  const wrote = await recordHubAudit(admin, {
    operator_user_id: null,
    tool,
    success: true,
    error: null,
  });
  if (!wrote) return fail(500, "Audit row required");
  return { ok: true };
}

export async function requireOperator(
  req: Request,
  hubBody?: { operatorUserId?: string },
): Promise<
  | { ok: true; userId: string; supabase: SupabaseClient; authHeader: string }
  | { ok: false; response: Response }
> {
  const hubKey = req.headers.get("x-api-key") ?? "";
  const expectedHub = Deno.env.get("FANFUEL_HUB_KEY") ?? "";
  if (expectedHub.length > 0 && hubKey.length > 0 && timingSafeEqual(hubKey, expectedHub)) {
    const admin = adminClient();
    if (!admin) return fail(500, "Server misconfiguration");
    const tool = toolName(req);
    const operatorId = hubBody?.operatorUserId ?? "";
    if (!OPERATOR_UUID.test(operatorId)) {
      const wrote = await recordHubAudit(admin, {
        operator_user_id: null,
        tool,
        success: false,
        error: "operator_user_id_invalid",
      });
      if (!wrote) return fail(500, "Audit row required");
      return fail(403, "Staff role required");
    }
    const staff = await userIsStaff(admin, operatorId);
    if (staff.failed) {
      const wrote = await recordHubAudit(admin, {
        operator_user_id: operatorId,
        tool,
        success: false,
        error: "staff_check_failed",
      });
      if (!wrote) return fail(500, "Audit row required");
      return fail(500, "Staff check failed");
    }
    if (!staff.staff) {
      const wrote = await recordHubAudit(admin, {
        operator_user_id: operatorId,
        tool,
        success: false,
        error: "not_staff",
      });
      if (!wrote) return fail(500, "Audit row required");
      return fail(403, "Staff role required");
    }
    const wrote = await recordHubAudit(admin, {
      operator_user_id: operatorId,
      tool,
      success: true,
      error: null,
    });
    if (!wrote) return fail(500, "Audit row required");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !supabaseAnonKey) return fail(500, "Server misconfiguration");
    return {
      ok: true,
      userId: operatorId,
      supabase: createClient(supabaseUrl, supabaseAnonKey),
      authHeader: "",
    };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "Authentication required");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) return fail(500, "Server misconfiguration");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return fail(401, "Invalid or expired session");
  const admin = adminClient();
  if (!admin) return fail(500, "Server misconfiguration");
  const staff = await userIsStaff(admin, user.id);
  if (staff.failed) return fail(500, "Staff check failed");
  if (!staff.staff) return fail(403, "Staff role required");
  return { ok: true, userId: user.id, supabase, authHeader };
}

export function json(data: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
