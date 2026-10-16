# Handoff — Credit Compass MCP

Written 2026-10-16; expanded same day for full staff tool authority.
Repo `fendifrost-dot/fendi-fight-plan` (Credit Compass).
Lovable project **Credit Compass** `bfe3ffa4-da7d-42ae-ab36-7b020e50ac3c`,
workspace `A89kW78EdcdagG7TLXiw`. Supabase (Lovable Cloud) `imjnqwcrgpqrouiiazam`.

## What this is

Credit Compass MCP lets enrolled agents act as the staff member who enrolled them.
Every call writes `mcp_audit_log` first, then calls the project's own edge functions
(hub key + operator) so staff checks and `hub_operator_audit` still apply.

| Scope | Tool | Calls |
|---|---|---|
| `assessments.list` | `list_assessments` | control-center-api `get_assessments` |
| `assessments.read` | `get_assessment` | `get_assessment_detail` |
| `reports.read` | `get_report` | `get_report` |
| `assessments.create` | `create_assessment` | `create_assessment` as the staff user |
| `reports.generate` | `generate_report` | `generate_report` |
| `intake.list` | `list_intake_clients` | direct read, all intake clients, summarized |
| `intake.read` | `get_intake_client` | direct read, full record |
| `intake.create` | `create_intake_client` | `intake-create-canonical` (**legal_name only** required) |
| `intake.score` | `score_intake_client` | `intake-score-file` |
| `intake.approve_pricing` | `approve_pricing` | `intake-approve-pricing` |
| `intake.summary` | `generate_intake_summary` | `intake-generate-summary` |
| `payments.read` | `get_payment_status` | `payments-status` |
| `payments.record` | `record_payment` | `payments-record` |
| `payments.mark_late` | `mark_late_payments` | `payments-mark-late` |
| `analysis.start` | `start_analysis` | `analysis-start` (hub mode) |
| `analysis.read` | `get_analysis_status` | `analysis-status` (hub mode) |
| `analysis.chunk` | `analyze_chunk` | `analyze-chunk` (hub mode) |
| `analysis.response` | `analyze_response` | `analyze-response` (hub mode) |
| `documents.classify` | `classify_documents` | `classify-documents` (hub mode) |
| `documents.map` | `map_document` | `map-document` (hub mode) |
| `letters.dispute` | `generate_dispute_letter` | `generate-dispute-letter` (hub mode) |
| `letters.specialty_freeze` | `generate_specialty_freeze_letter` | `generate-specialty-freeze-letter` (hub mode) |
| `ai.ask` | `ask_compass_ai` | `google-ai-handler` (hub mode) |

Still not available to agents: delete, email / pitch send, card charges, SQL.
Bureau PDF binary upload remains multipart from the app (`intake-ingest-bureau-pdfs`);
`start_analysis` needs storage paths already under the enrolling staff prefix.

## Hub mode for session-only functions

`supabase/functions/_shared/hub-caller.ts`: a request with `x-api-key` must present
`FANFUEL_HUB_KEY` and name a staff operator in `x-operator-user-id`. Without
`x-api-key`, the existing browser session path is unchanged.

Wired into: `analysis-start`, `analysis-status`, `analyze-chunk`, `analyze-response`,
`classify-documents`, `generate-dispute-letter`, `generate-specialty-freeze-letter`,
`google-ai-handler`, `map-document`.

Intake mutate tools no longer require `intake_operator_id === operator`; any staff
operator (including an enrolled agent) may act on any intake client. Creates are
still attributed to the enrolling staff member.

## Files

| | |
|---|---|
| Migrations | `20261016120000_compass_mcp_agents.sql`, `20261016180000_compass_mcp_full_scopes.sql` |
| Server | `supabase/functions/_shared/compassMcp.ts` |
| Store | `supabase/functions/_shared/compassMcpSupabase.ts` |
| Hub caller | `supabase/functions/_shared/hub-caller.ts` |
| Functions | `compass-mcp`, `compass-mcp-enroll`, plus session functions above |
| UI | `src/pages/Settings.tsx`, `src/components/settings/AgentAccessCard.tsx` |
| Tests | `src/test/compassMcp.test.ts` |

## Deploy (Lovable only)

1. Apply `20261016180000_compass_mcp_full_scopes.sql` in the **Lovable SQL editor**.
2. Redeploy edge functions (Publish ≠ redeploy):
   - `compass-mcp`, `compass-mcp-enroll`
   - `analysis-start`, `analysis-status`, `analyze-chunk`, `analyze-response`
   - `classify-documents`, `map-document`
   - `generate-dispute-letter`, `generate-specialty-freeze-letter`, `google-ai-handler`
   - `intake-create-canonical`, `intake-score-file`, `intake-approve-pricing`,
     `intake-generate-summary`, `intake-ingest-bureau-pdfs`
   - `payments-status`, `payments-record`, `payments-mark-late`
3. **Publish** the frontend so Settings shows the expanded scope checkboxes.
4. Re-enroll agents (or enroll with Read + Write) so they receive the new scopes.
   Existing agents keep their old scope arrays until re-enrolled or updated.

## Hard rules

* ❌ No `supabase` CLI (403 = false wall). ❌ No supabase.com dashboard.
* ❌ Do not edit an already-applied migration to make it run.
* ❌ Never paste an agent secret or FANFUEL_HUB_KEY into chat, a doc, or a commit.
* ✅ SQL → Lovable SQL editor or Lovable MCP `query_database`. Functions →
  Lovable → Edge Functions → redeploy. Frontend → Lovable → Publish.

## Verify

1. Migration: scopes CHECK on `mcp_agents` includes `analysis.start` and `ai.ask`.
2. `POST …/compass-mcp` with `{"jsonrpc":"2.0","id":1,"method":"ping"}` and no
   Authorization → `401` `"Unauthorized: missing secret"`.
3. Enrolled agent with write scopes: `tools/list` returns **23 tools**.
4. `create_intake_client` with only `{ "legal_name": "Test Client" }` succeeds.
5. `mcp_audit_log` shows those calls.
