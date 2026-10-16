/**
 * Hub-mode caller for edge functions that otherwise require a signed-in browser session.
 *
 * A request that carries `x-api-key` is a server-to-server call (the Control Center or
 * the Credit Compass MCP). It must present FANFUEL_HUB_KEY and name a staff operator in
 * `x-operator-user-id`; requireOperator then checks the staff role and writes the
 * hub_operator_audit row before the function does anything else.
 *
 * A request without `x-api-key` returns null, and the function's existing session path
 * runs unchanged, so browser users (staff and customers) behave exactly as before.
 *
 * The operator goes in a header, not the body, so the function can still read its own
 * JSON body afterwards.
 */
import { requireOperator } from "./intake-auth.ts";
import { timingSafeEqual } from "./staff-cors.ts";

export type HubCaller = { ok: true; userId: string } | { ok: false; status: number; body: string };

export async function resolveHubCaller(req: Request): Promise<HubCaller | null> {
  const presented = req.headers.get("x-api-key") ?? "";
  if (!presented) return null;
  const expected = Deno.env.get("FANFUEL_HUB_KEY") ?? "";
  if (!expected || !timingSafeEqual(presented, expected)) {
    return { ok: false, status: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  const operatorUserId = req.headers.get("x-operator-user-id") ?? "";
  const auth = await requireOperator(req, { operatorUserId });
  if (!auth.ok) {
    return { ok: false, status: auth.response.status, body: await auth.response.text() };
  }
  return { ok: true, userId: auth.userId };
}

export function hubDenied(hub: { status: number; body: string }, cors: Record<string, string>): Response {
  return new Response(hub.body, { status: hub.status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** Same shape as `supabase.auth.getUser()` so a function can swap it in place. */
export function hubUser(hub: { userId: string }) {
  return { data: { user: { id: hub.userId } }, error: null };
}
