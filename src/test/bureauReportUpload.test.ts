import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_SCOPES } from "../../supabase/functions/_shared/compassMcp";
import {
  MAX_IMAGE_BYTES,
  chunkObjectPath,
  chunkReportText,
  decodeBase64Bytes,
  estimatedDecodedBytes,
  isUploadFailure,
  pageObjectPath,
  parseBureauUploadArgs,
  pathBelongsToStaff,
  sniffImage,
  sniffPdf,
  sourcePdfObjectPath,
  textFirstViable,
  validatePublicHttpsUrl,
} from "../../supabase/functions/_shared/bureauReportUpload";
import { agentUploadSurfaceAction } from "@/lib/analysisJobs";

const SESSION = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const CLIENT = "11111111-2222-4333-8444-555555555555";
const STAFF = "1219f344-75a0-49b6-88a0-c2a94afe0e76";

function denseText(pages: number, charsPerPage: number): string {
  return Array.from({ length: pages }, (_, index) => {
    const body = `Account ${index} balance $${1000 + index} status late `.repeat(Math.ceil(charsPerPage / 40));
    return `--- PAGE ${index + 1} ---\n${body.slice(0, charsPerPage)}`;
  }).join("\n\n");
}

describe("bureau report upload validation", () => {
  it("accepts extracted text for an assessment and queues by default", () => {
    const parsed = parseBureauUploadArgs({
      bureau: "experian",
      session_id: SESSION,
      report_text: denseText(4, 200),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.queue).toBe(true);
    expect(parsed.value.sessionId).toBe(SESSION);
    expect(parsed.value.reportText?.startsWith("--- PAGE 1 ---")).toBe(true);
  });

  it("requires a client or an assessment and a report source", () => {
    expect(parseBureauUploadArgs({ bureau: "equifax", report_text: denseText(1, 500) }).ok).toBe(false);
    expect(parseBureauUploadArgs({ bureau: "equifax", client_id: CLIENT }).ok).toBe(false);
    expect(parseBureauUploadArgs({ bureau: "other", client_id: CLIENT, report_text: "x" }).ok).toBe(false);
  });

  it("refuses private and non-https PDF links", () => {
    const base = { bureau: "transunion", client_id: CLIENT };
    expect(parseBureauUploadArgs({ ...base, pdf_url: "http://example.com/report.pdf" }).ok).toBe(false);
    expect(parseBureauUploadArgs({ ...base, pdf_url: "https://127.0.0.1/report.pdf" }).ok).toBe(false);
    expect(parseBureauUploadArgs({ ...base, pdf_url: "https://192.168.1.8/report.pdf" }).ok).toBe(false);
    expect(parseBureauUploadArgs({ ...base, pdf_url: "https://169.254.169.254/latest/meta-data" }).ok).toBe(false);
    expect(parseBureauUploadArgs({ ...base, pdf_url: "https://user:secret@example.com/report.pdf" }).ok).toBe(false);
    const ok = parseBureauUploadArgs({ ...base, pdf_url: "https://files.example.com/experian.pdf" });
    expect(ok.ok).toBe(true);
    expect(validatePublicHttpsUrl("https://10.1.2.3/a.pdf").ok).toBe(false);
  });

  it("rejects a page image above 5 MB and keeps paths under the staff folder", () => {
    const tooBig = "A".repeat(Math.ceil((MAX_IMAGE_BYTES + 8) * 4 / 3 / 4) * 4);
    expect(estimatedDecodedBytes(tooBig)).toBeGreaterThan(MAX_IMAGE_BYTES);
    const parsed = parseBureauUploadArgs({
      bureau: "equifax",
      session_id: SESSION,
      page_images: [tooBig],
    });
    expect(isUploadFailure(parsed)).toBe(true);
    if (!isUploadFailure(parsed)) return;
    expect(parsed.error).toContain("5 MB");

    const uploadId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(pageObjectPath(STAFF, uploadId, 2, "jpg")).toBe(`${STAFF}/${uploadId}/page-002.jpg`);
    expect(chunkObjectPath(STAFF, uploadId, 12)).toBe(`${STAFF}/${uploadId}/chunk-012.txt`);
    expect(sourcePdfObjectPath(STAFF, uploadId)).toBe(`${STAFF}/bureau-reports/${uploadId}/source.pdf`);
    expect(pathBelongsToStaff(`${STAFF}/../etc/passwd`, STAFF)).toBe(false);
    expect(pathBelongsToStaff(pageObjectPath(STAFF, uploadId, 1, "png"), STAFF)).toBe(true);
  });

  it("treats a text-rich bureau PDF as text-first and a thin scan as not", () => {
    const rich = textFirstViable(denseText(40, 220), 40);
    expect(rich.viable).toBe(true);
    expect(rich.charsPerPage).toBeGreaterThanOrEqual(150);
    const scan = textFirstViable("EXPERIAN\n".repeat(20), 60);
    expect(scan.viable).toBe(false);
  });

  it("chunks long text without dropping a trailing account line", () => {
    const text = denseText(30, 800);
    const chunks = chunkReportText(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
    const bytes = decodeBase64Bytes(btoa("%PDF-1.4"));
    expect(bytes).toBeInstanceOf(Uint8Array);
    if (bytes instanceof Uint8Array) expect(sniffPdf(bytes)).toBe(true);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    expect(sniffImage(jpeg)).toBe("image/jpeg");
  });

  it("keeps the scope allow-list in the migration aligned with the server", () => {
    const sql = readFileSync("supabase/migrations/20261019170000_compass_mcp_reports_upload.sql", "utf8");
    for (const scope of ALL_SCOPES) expect(sql).toContain(`'${scope}'`);
    expect(sql).toContain("reports.upload");
    expect(sql).toContain("analysis.start");
    expect(ALL_SCOPES).toContain("reports.upload");
  });
});

describe("agent upload surface", () => {
  const now = Date.parse("2026-10-19T16:00:00.000Z");

  it("hydrates a recent finished agent job and skips everyone else's", () => {
    expect(agentUploadSurfaceAction({
      status: "DONE",
      completed_at: "2026-10-19T15:00:00.000Z",
      input_data: { _source: "agent_upload" },
    }, now)).toBe("hydrate");
    expect(agentUploadSurfaceAction({
      status: "DONE",
      completed_at: "2026-10-18T00:00:00.000Z",
      input_data: { _source: "agent_upload" },
    }, now)).toBe("skip");
    expect(agentUploadSurfaceAction({
      status: "DONE",
      completed_at: "2026-10-19T15:00:00.000Z",
      input_data: {},
    }, now)).toBe("skip");
    expect(agentUploadSurfaceAction({
      status: "RUNNING",
      created_at: "2026-10-19T15:30:00.000Z",
      input_data: { _source: "agent_upload" },
    }, now)).toBe("resume");
  });
});
