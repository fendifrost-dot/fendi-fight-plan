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
    // Verify caller is authenticated
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Query pg_policies for storage.objects
    const { data: policies, error: policiesError } = await supabase.rpc(
      "get_storage_policies" as any
    ).maybeSingle();

    // Fallback: direct SQL via postgres connection
    // Since rpc won't work without a function, use a raw query approach
    // We'll query via the REST API by creating a temporary approach

    // Actually, let's just use the admin client to query
    const { data: rlsCheck, error: rlsError } = await supabase
      .from("pg_policies" as any)
      .select("*")
      .then(() => ({ data: null, error: { message: "pg_policies not accessible via REST" } as any }));

    // The only reliable way is to use the postgres connection directly
    // Let's use supabase-js sql() if available, otherwise report inability
    let policySnapshot: any[] | null = null;
    let rlsEnabled: boolean | null = null;
    let queryMethod = "none";
    let queryError: string | null = null;

    try {
      // Use the management API or direct SQL
      const dbUrl = Deno.env.get("SUPABASE_DB_URL");
      if (dbUrl) {
        // Use postgres directly via Deno
        // @ts-ignore - dynamic import
        const { Pool } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
        const pool = new Pool(dbUrl, 1);
        const conn = await pool.connect();

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
            WHERE schemaname = 'storage' AND tablename = 'objects'
            ORDER BY policyname
          `;
          policySnapshot = policiesResult.rows;
          queryMethod = "pg_direct";

          const rlsResult = await conn.queryObject<{ relrowsecurity: boolean }>`
            SELECT relrowsecurity
            FROM pg_class
            WHERE oid = 'storage.objects'::regclass
          `;
          rlsEnabled = rlsResult.rows[0]?.relrowsecurity ?? null;
        } finally {
          conn.release();
          await pool.end();
        }
      } else {
        queryError = "SUPABASE_DB_URL not available";
        queryMethod = "unavailable";
      }
    } catch (err) {
      queryError = err instanceof Error ? err.message : String(err);
      queryMethod = "pg_direct_failed";
    }

    // Also get bucket config
    let bucketConfig: any = null;
    try {
      const { data } = await supabase.storage.getBucket("analysis-images");
      bucketConfig = data
        ? {
            id: data.id,
            name: data.name,
            public: data.public,
            allowed_mime_types: data.allowed_mime_types,
            file_size_limit: data.file_size_limit,
          }
        : null;
    } catch {}

    return new Response(
      JSON.stringify({
        policies: policySnapshot,
        policyCount: policySnapshot?.length ?? null,
        rlsEnabled,
        queryMethod,
        queryError,
        bucketConfig,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
