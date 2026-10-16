/**
 * Credit Compass MCP endpoint for Claude, Cursor, and Grok.
 *
 * verify_jwt is false in config.toml ON PURPOSE. Agent secrets are not
 * Supabase JWTs; the platform JWT check would reject every legitimate call.
 * This handler rejects a missing secret, any session JWT, and FANFUEL_HUB_KEY.
 */
import { handleCompassMcpRequest, timingSafeEqual } from "../_shared/compassMcp.ts";
import { createCompassMcpStore, serviceClient } from "../_shared/compassMcpSupabase.ts";
import { corsFor } from "../_shared/staff-cors.ts";

Deno.serve((req) => {
  const hubKey = Deno.env.get("FANFUEL_HUB_KEY") ?? "";
  return handleCompassMcpRequest(req, {
    store: createCompassMcpStore(serviceClient()),
    corsHeaders: corsFor(req, "authorization, content-type, accept, mcp-protocol-version"),
    isForbiddenSecret: (token) => hubKey.length > 0 && timingSafeEqual(token, hubKey),
  });
});
