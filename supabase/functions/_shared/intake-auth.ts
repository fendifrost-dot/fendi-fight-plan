import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function requireOperator(
  req: Request,
  hubBody?: { operatorUserId?: string },
): Promise<
  { ok: true; userId: string; supabase: SupabaseClient; authHeader: string } | {
    ok: false;
    response: Response;
  }
> {
  const hubKey = req.headers.get("x-api-key");
  const expectedHub = Deno.env.get("FANFUEL_HUB_KEY");
  if (expectedHub && hubKey === expectedHub && hubBody?.operatorUserId?.match(/^[0-9a-f-]{36}$/i)) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: "Server misconfiguration" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    return {
      ok: true,
      userId: hubBody.operatorUserId,
      supabase,
      authHeader: "",
    };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Server misconfiguration" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  return { ok: true, userId: user.id, supabase, authHeader };
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
