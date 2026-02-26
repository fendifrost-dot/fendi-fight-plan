import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");

    if (!supabaseUrl || !serviceRoleKey || !dbUrl) {
      return new Response(
        JSON.stringify({
          policies: null,
          policyCount: null,
          rlsEnabled: null,
          rowSecuritySetting: null,
          queryMethod: "missing_env",
          queryError: "Required env vars missing for snapshot query",
          bucketConfig: null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // @ts-ignore - Deno import at runtime
    const { Pool } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
    const pool = new Pool(dbUrl, 1);
    const conn = await pool.connect();

    let policies: Array<{
      policyname: string;
      permissive: string;
      roles: string[];
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }> | null = null;
    let rlsEnabled: boolean | null = null;
    let rowSecuritySetting: string | null = null;
    let queryMethod = "pg_direct";
    let queryError: string | null = null;

    try {
      const policiesResult = await conn.queryObject<{
        policyname: string;
        permissive: string;
        roles: string[];
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>`
        SELECT policyname, permissive, roles, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname='storage' AND tablename='objects'
        ORDER BY policyname
      `;
      policies = policiesResult.rows;

      const rlsResult = await conn.queryObject<{ relrowsecurity: boolean }>`
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'storage.objects'::regclass
      `;
      rlsEnabled = rlsResult.rows[0]?.relrowsecurity ?? null;

      const rowSecurityResult = await conn.queryObject<{ row_security: string }>`
        SHOW row_security
      `;
      rowSecuritySetting = rowSecurityResult.rows[0]?.row_security ?? null;
    } catch (err) {
      queryMethod = "pg_direct_failed";
      queryError = err instanceof Error ? err.message : String(err);
    } finally {
      conn.release();
      await pool.end();
    }

    let bucketConfig: {
      id: string;
      name: string;
      public: boolean;
      allowed_mime_types: string[] | null;
      file_size_limit: number | null;
    } | null = null;

    try {
      const { data } = await supabase.storage.getBucket("analysis-images");
      if (data) {
        bucketConfig = {
          id: data.id,
          name: data.name,
          public: data.public,
          allowed_mime_types: data.allowed_mime_types,
          file_size_limit: data.file_size_limit,
        };
      }
    } catch {
      // Keep bucketConfig as null
    }

    return new Response(
      JSON.stringify({
        policies,
        policyCount: policies?.length ?? null,
        rlsEnabled,
        rowSecuritySetting,
        queryMethod,
        queryError,
        bucketConfig,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
