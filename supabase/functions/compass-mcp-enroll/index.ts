/**
 * Staff enrollment for Credit Compass MCP agents.
 * verify_jwt is true. A valid session is not enough: the caller must hold the
 * staff role in user_roles. Agent secrets and customer sessions cannot enroll.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bearerToken, handleCompassMcpEnrollRequest } from "../_shared/compassMcp.ts";
import { createEnrollStore, serviceClient } from "../_shared/compassMcpSupabase.ts";
import { corsFor } from "../_shared/staff-cors.ts";

Deno.serve((req) =>
  handleCompassMcpEnrollRequest(req, {
    store: createEnrollStore(serviceClient()),
    corsHeaders: corsFor(req),
    authorize: async (request) => {
      const token = bearerToken(request);
      if (!token) return { ok: false, status: 401, error: "Unauthorized: staff session required" };

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data: userData, error: userErr } = await authClient.auth.getUser();
      if (userErr || !userData?.user) return { ok: false, status: 401, error: "Unauthorized: invalid session" };

      const admin = serviceClient();
      const { data: roleRow, error: roleErr } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("role", "staff")
        .maybeSingle();
      if (roleErr) return { ok: false, status: 500, error: "Authorization check failed" };
      if (!roleRow) return { ok: false, status: 403, error: "Forbidden: staff role required" };
      return { ok: true, userId: userData.user.id };
    },
  })
);
