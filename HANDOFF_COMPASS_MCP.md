# Handoff — Credit Compass MCP

Written 2026-10-16; expanded same day for full staff tool authority.
Bureau upload added 2026-10-19 (`reports.upload`, tool 24).
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
| `reports.upload` | `upload_bureau_report` | `analysis-upload`, then `analysis-start` |
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

`upload_bureau_report` accepts a PDF (`pdf_base64` or a public `pdf_url`), extracted
`report_text`, and/or `page_images`, plus `bureau` and either `session_id` (assessment)
or `client_id` (intake). PDFs are read on the edge with pdf.js (no browser canvas).
Text-rich reports (Experian, Equifax, TransUnion, annualcreditreport, myFICO) are
chunked into `{staff_user_id}/{upload_id}/chunk-###.txt` and the worker analyzes that
text into the same `analysis_jobs.result_data` shape as an in-app image job. Page
images are stored as `{staff_user_id}/{upload_id}/page-###.{jpg,png,webp}`, 5 MB each,
24 MB combined, 80 images max. A scanned PDF with almost no text is refused until the
agent sends page images or text. The original PDF, when it fits, is kept at
`{staff_user_id}/bureau-reports/{upload_id}/source.pdf`. Working copies are removed
after a successful text job. Page images and the source PDF stay in that private bucket.

`queue` defaults to true, so the upload response includes `job_id`. Set `queue` false
to only store the file, then call `start_analysis` with `storage_paths` and
`input_mode`. Poll with `get_analysis_status`. When the job finishes, `result` is the
canonical analysis. The assessment row is set to `IN_PROGRESS` and then `DONE`, with
`active_job_id` / `latest_analysis_job_id`, so the analyzer shows it. An intake client
also gets `bureau_raw_extracts` for that bureau when text was extracted.

## Hub mode for session-only functions

`supabase/functions/_shared/hub-caller.ts`: a request with `x-api-key` must present
`FANFUEL_HUB_KEY` and name a staff operator in `x-operator-user-id`. Without
`x-api-key`, the existing browser session path is unchanged.

Wired into: `analysis-upload`, `analysis-start`, `analysis-status`, `analyze-chunk`, `analyze-response`,
`classify-documents`, `generate-dispute-letter`, `generate-specialty-freeze-letter`,
`google-ai-handler`, `map-document`.

Intake mutate tools no longer require `intake_operator_id === operator`; any staff
operator (including an enrolled agent) may act on any intake client. Creates are
still attributed to the enrolling staff member.

## Files

| | |
|---|---|
| Migrations | `20261016120000_compass_mcp_agents.sql`, `20261016180000_compass_mcp_full_scopes.sql`, `20261019170000_compass_mcp_reports_upload.sql` |
| Server | `supabase/functions/_shared/compassMcp.ts`, `supabase/functions/_shared/bureauReportUpload.ts` |
| Store | `supabase/functions/_shared/compassMcpSupabase.ts` |
| Hub caller | `supabase/functions/_shared/hub-caller.ts` |
| Functions | `compass-mcp`, `compass-mcp-enroll`, `analysis-upload`, plus session functions above |
| UI | `src/pages/Settings.tsx`, `src/components/settings/AgentAccessCard.tsx` |
| Tests | `src/test/compassMcp.test.ts`, `src/test/bureauReportUpload.test.ts` |

## Go live — agent bureau upload (do this; do not skip)

Apply and redeploy from Lovable. Do not run the Supabase CLI. Do not publish from
this repo. Do not run the new tool against production data until the functions below
are the ones serving `fendi-fight-plan.lovable.app`.

1. Lovable SQL editor: run `supabase/migrations/20261019170000_compass_mcp_reports_upload.sql`.
   It replaces `mcp_agents_scopes_check` with the 24-scope list, grants `reports.upload`
   to every non-revoked agent that already has `analysis.start` (grok, claude, cursor,
   chatgpt if they were enrolled with that scope), and allows `application/pdf` and
   `text/plain` on `analysis-images` when that bucket has a mime allow-list. It raises
   a file size cap only when one is already set and is below 20 MB.
2. Redeploy edge functions (Publish does not redeploy functions):
   - `compass-mcp` (the new tool)
   - `analysis-upload` (new; `verify_jwt` must stay false — hub key, not a user JWT)
   - `analysis-start` (text mode, session stamp)
   - `analysis-worker` (text chunks, session status when the job finishes)
3. Publish the frontend so Settings → Agent access shows **Upload a bureau report**
   and the note that agents can send the PDF.
4. Re-enroll only agents that do **not** have `analysis.start`. Agents that already
   have it receive `reports.upload` from the migration. Confirm with
   `select name, scopes from mcp_agents where revoked_at is null`.

### Sample MCP call sequence

Bearer token is the agent secret (`Authorization: Bearer ccma_...`). Endpoint:
`POST /functions/v1/compass-mcp`.

1. Upload (store only, so start is its own call):

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"upload_bureau_report","arguments":{"bureau":"experian","session_id":"<assessment-uuid>","pdf_url":"https://example.com/experian.pdf","queue":false}}}
```

Response includes `storage_paths`, `input_mode` (`text` or `images`), `page_count`,
`source_pdf_path`, and `queued: false`. `pdf_base64`, `report_text`, or `page_images`
can replace `pdf_url`. Use `client_id` instead of `session_id` for an intake client.
Omit `queue` (or set it true) to upload and start in one call and skip step 2.

2. Start:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"start_analysis","arguments":{"storage_paths":["<staff-user-id>/<upload-id>/chunk-001.txt"],"session_id":"<assessment-uuid>","input_mode":"text","bureau":"experian","total_pages":36,"report_type":"experian"}}}
```

Response: `{ "jobId": "<job-uuid>", "status": "QUEUED" }`. Image uploads use
`input_mode: "images"` and the `page-###` paths from step 1.

3. Status:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_analysis_status","arguments":{"job_id":"<job-uuid>"}}}
```

Repeat until `status` is `DONE`, `PARTIAL`, or `FAILED`.

4. Result: the same status payload's `result` field is the canonical analysis
(`derogatory_accounts`, `collections`, `inquiries`, and the rest of the worker
shape). `get_assessment` on that `session_id` shows `status` moving from
`IN_PROGRESS` to `DONE`. The signed-in staff member's analyzer also resumes the
job while it runs and loads a finished agent job for 12 hours.

## Deploy (Lovable only) — 2026-10-16 full scopes

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

1. Migration: scopes CHECK on `mcp_agents` includes `analysis.start`, `ai.ask`, and `reports.upload`.
2. `POST …/compass-mcp` with `{"jsonrpc":"2.0","id":1,"method":"ping"}` and no
   Authorization → `401` `"Unauthorized: missing secret"`.
3. Enrolled agent with every scope: `tools/list` returns **24 tools**, including `upload_bureau_report`.
4. `create_intake_client` with only `{ "legal_name": "Test Client" }` succeeds.
5. `mcp_audit_log` shows those calls.
