# Handoff — Credit Compass MCP

Written 2026-10-16. Repo `fendifrost-dot/fendi-fight-plan` (Credit Compass).
Lovable project **Credit Compass** `bfe3ffa4-da7d-42ae-ab36-7b020e50ac3c`,
workspace `A89kW78EdcdagG7TLXiw`. Supabase (Lovable Cloud) `imjnqwcrgpqrouiiazam`.

## What this is

Credit Compass had no MCP server. Agents could only reach it through the Control
Center hub key, which carries no agent identity and no scopes. This adds a server
modeled on the Credit Guardian MCP (fairway-fixer-18): staff enroll an agent in
Settings → Agent access, the secret is shown once and stored as a hash, every call
writes an audit row first, and tools are gated by scope.

The tools do not re-implement Compass logic. Each one calls the project's own
hub-authenticated edge function (`control-center-api`, `intake-*`, `payments-*`)
with the enrolling staff member as the operator, so existing validation, the staff
role check, and `hub_operator_audit` rows all still apply. Everything an agent
creates is attributed to that staff member (`dispute_sessions.user_id`,
`intake_clients.intake_operator_id`).

| Scope | Tool | Calls |
|---|---|---|
| `assessments.list` | `list_assessments` | control-center-api `get_assessments` |
| `assessments.read` | `get_assessment` | `get_assessment_detail` |
| `reports.read` | `get_report` | `get_report` |
| `assessments.create` | `create_assessment` | `create_assessment` as the staff user |
| `reports.generate` | `generate_report` | `generate_report` |
| `intake.list` | `list_intake_clients` | direct read, operator-scoped, summarized |
| `intake.read` | `get_intake_client` | direct read, operator-scoped, full record |
| `intake.create` | `create_intake_client` | `intake-create-canonical` |
| `intake.score` | `score_intake_client` | `intake-score-file` |
| `intake.approve_pricing` | `approve_pricing` | `intake-approve-pricing` |
| `intake.summary` | `generate_intake_summary` | `intake-generate-summary` |
| `payments.read` | `get_payment_status` | `payments-status` |
| `payments.record` | `record_payment` | `payments-record` |

Not available to agents: bureau PDF ingestion (upload from the app), starting the
report analyzer (`analysis-start` needs a staff session and storage paths under
that user's prefix), delete, email, card charges, SQL.

## Files

| | |
|---|---|
| Migration | `supabase/migrations/20261016120000_compass_mcp_agents.sql` (mcp_agents, mcp_audit_log) |
| Server | `supabase/functions/_shared/compassMcp.ts` (no Deno imports; vitest imports it) |
| Store | `supabase/functions/_shared/compassMcpSupabase.ts` |
| Functions | `supabase/functions/compass-mcp/index.ts` (verify_jwt=false), `supabase/functions/compass-mcp-enroll/index.ts` (verify_jwt=true, staff role) |
| Config | `supabase/config.toml` |
| UI | `src/pages/Settings.tsx` at `/settings` (staff only), `src/components/settings/AgentAccessCard.tsx`, nav link |
| Tests | `src/test/compassMcp.test.ts` (14) |

## Status

| Thing | State |
|---|---|
| Code | ✅ PR #4 merged 2026-10-16, merge commit `7514c28`. Lovable then added `19d30ec` (its preview-auth plumbing and a regenerated `types.ts` that now carries the two new tables; none of this work) |
| Local validation | ✅ `npx vitest run src/test/compassMcp.test.ts` 14/14; full suite 394 pass with 4 pre-existing failures in `tradelineSegmentation.test.ts` that this change does not touch; `npx tsc -p tsconfig.app.json --noEmit` clean; eslint clean on every new/changed file |
| Migration on the live DB | ✅ applied 2026-10-16 through Lovable and re-read: both tables exist, RLS enabled and forced, service_role granted, scopes CHECK lists all 13 scopes, 0 agents, 0 audit rows |
| Lovable synced `main` | ✅ `compass-mcp/index.ts` read back from Lovable at `main` matches the repo |
| Edge functions `compass-mcp`, `compass-mcp-enroll` deployed | ✅ Lovable deployed both 2026-10-16 06:45 UTC and probed them: `compass-mcp` without a secret returned 401 `"Unauthorized: missing secret"` (a string only the new handler emits); `compass-mcp-enroll` without a session returned 401. Not re-probed from the authoring session, whose proxy cannot reach `supabase.co` |
| Frontend published (Settings page) | ⚠️ Publish requested through Lovable (deployment `7201982b…`, `pending` when requested). Not independently verified; open `/settings` as staff and look for "Agent access" |
| Agents enrolled | ❌ none. Enrollment is a staff action in Settings → Agent access; the secret is shown once in the browser and never in chat |

## Hard rules

* ❌ No `supabase` CLI (403 = false wall). ❌ No supabase.com dashboard.
* ❌ Do not edit the migration to make it run; an error means the live DB differs.
* ❌ Never paste an agent secret or FANFUEL_HUB_KEY into chat, a doc, or a commit.
* ✅ SQL → Lovable SQL editor or Lovable MCP `query_database`. Functions →
  Lovable → Edge Functions → redeploy. Frontend → Lovable → Publish.
  **Publish ≠ edge redeploy.**

## Verify

1. **Migration:** `select to_regclass('public.mcp_agents'), to_regclass('public.mcp_audit_log');`
   Both non-null.
2. **Function deployed:** `POST https://imjnqwcrgpqrouiiazam.supabase.co/functions/v1/compass-mcp`
   with `{"jsonrpc":"2.0","id":1,"method":"ping"}` and no Authorization header.
   Expected `401` with `"Unauthorized: missing secret"`. `404` = not deployed.
3. **Enrollment UI:** signed in as staff, `/settings` shows "Agent access" with 13
   scope checkboxes. Enroll `claude` with Read and write, copy the secret into the
   MCP client config as `Authorization: Bearer <secret>` against the URL above.
4. **From that client:** `tools/list` returns **13 tools**. `list_intake_clients`
   returns `{"clients":[]}` (the live table had 0 rows on 2026-10-16).
   `select tool, success, error from public.mcp_audit_log order by created_at desc limit 5;`
   shows those calls.

## Noted, not built

* A `start_analysis` tool. `analysis-start` validates storage paths under the
  caller's own prefix and needs a session JWT. Supporting it from an agent means
  either a hub-mode branch in `analysis-start` (like `requireOperator`) or an
  agent-uploadable storage path convention. Decide before building.
* Linking a Compass intake client to its Credit Guardian client row. The two
  databases share no id today.
