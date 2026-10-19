/**
 * Pure validation and layout for agent bureau-report uploads.
 *
 * No Deno or Supabase imports: the MCP handler, the analysis-upload function,
 * and vitest all share this file. Bytes are decoded here; network and storage
 * stay in the edge function.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 800_000;
export const MAX_PAGE_IMAGES = 80;
export const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
export const MAX_PDF_PAGES = 120;
export const TEXT_CHUNK_CHARS = 14_000;
export const MAX_TEXT_CHUNKS = 80;
export const TEXT_FIRST_CHARS_PER_PAGE = 150;
export const MIN_TEXT_CHARS = 400;
export const MAX_QUESTIONNAIRE_CHARS = 20_000;

export const UPLOAD_BUREAUS = ["equifax", "experian", "transunion"] as const;
export type UploadBureau = (typeof UPLOAD_BUREAUS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata.internal"]);
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".localdomain"];

export interface ParsedBureauUpload {
  bureau: UploadBureau;
  sessionId?: string;
  clientId?: string;
  pdfBase64?: string;
  pdfUrl?: string;
  reportText?: string;
  pageImages?: string[];
  questionnaire?: Record<string, unknown>;
  filename?: string;
  reportType?: string;
  /** When true, analysis-upload also queues the analysis job. */
  queue: boolean;
}

export interface TextViability {
  viable: boolean;
  chars: number;
  charsPerPage: number;
  reason: string;
}

type Fail = { ok: false; error: string };
type Ok<T> = { ok: true; value: T };

/** strictNullChecks is off in this app, so `ok` does not narrow by itself. */
export function isUploadFailure<T>(result: Ok<T> | Fail): result is Fail {
  return result.ok === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function estimatedDecodedBytes(base64: string): number {
  const clean = base64.replace(/\s+/g, "");
  if (clean.length === 0) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** Split a raw base64 string or a data URL. Does not decode. */
export function splitEncodedPayload(input: string): { mime?: string; base64: string } | Fail {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "payload is empty" };
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(trimmed);
  if (!match) return { base64: trimmed.replace(/\s+/g, "") };
  if (!match[2]) return { ok: false, error: "data URL must be base64" };
  const mime = match[1]?.trim().toLowerCase();
  return { mime: mime || undefined, base64: match[3].replace(/\s+/g, "") };
}

export function decodeBase64Bytes(base64: string): Uint8Array | Fail {
  const clean = base64.replace(/\s+/g, "");
  if (clean.length === 0 || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
    return { ok: false, error: "payload is not valid base64" };
  }
  let binary: string;
  try {
    binary = atob(clean);
  } catch {
    return { ok: false, error: "payload is not valid base64" };
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function sniffPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function extensionForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain") return "txt";
  return "bin";
}

function isPrivateOrLocalIp(host: string): boolean {
  if (/^\d+$/.test(host)) return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  if (match.slice(1).some((part) => part.length > 1 && part.startsWith("0"))) return true;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((n) => n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Public https URL only. Private, link-local, and metadata hosts are refused. */
export function validatePublicHttpsUrl(raw: string): Ok<URL> | Fail {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "pdf_url must be an https URL" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "pdf_url must be an https URL" };
  if (url.username || url.password) return { ok: false, error: "pdf_url must not include credentials" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host.includes(":") || !host.includes(".")) return { ok: false, error: "pdf_url host is not allowed" };
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, error: "pdf_url host is not allowed" };
  }
  if (isPrivateOrLocalIp(host)) return { ok: false, error: "pdf_url host is not allowed" };
  return { ok: true, value: url };
}

export function textFirstViable(text: string, pageCount: number): TextViability {
  const normalized = text.replace(/\s+/g, " ").trim();
  const chars = normalized.length;
  const pages = pageCount > 0 ? pageCount : 1;
  const charsPerPage = Math.round(chars / pages);
  if (chars < MIN_TEXT_CHARS) {
    return { viable: false, chars, charsPerPage, reason: "text is too thin for text-first analysis" };
  }
  if (chars > MAX_TEXT_CHARS) {
    return { viable: false, chars, charsPerPage, reason: "text is too long" };
  }
  if (charsPerPage >= TEXT_FIRST_CHARS_PER_PAGE) {
    return { viable: true, chars, charsPerPage, reason: "text-first" };
  }
  return { viable: false, chars, charsPerPage, reason: "text is too thin for text-first analysis" };
}

export function estimatePageCount(text: string): number {
  const formFeeds = text.split("\f").length;
  if (formFeeds > 1) return Math.min(formFeeds, MAX_PDF_PAGES);
  const marks = text.match(/\bpage\s+\d+\s+of\s+(\d+)/gi) ?? [];
  const totals = marks
    .map((mark) => Number(/\bof\s+(\d+)/i.exec(mark)?.[1] ?? "0"))
    .filter((n) => n > 0 && n <= MAX_PDF_PAGES);
  if (totals.length > 0) return Math.max(...totals);
  return Math.max(1, Math.ceil(text.length / 1800));
}

/** Split report text on a paragraph boundary so each worker chunk stays small. */
export function chunkReportText(text: string, size = TEXT_CHUNK_CHARS): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let index = 0;
  while (index < clean.length) {
    let end = Math.min(index + size, clean.length);
    if (end < clean.length) {
      const breakAt = clean.lastIndexOf("\n", end);
      if (breakAt > index + Math.floor(size * 0.6)) end = breakAt + 1;
    }
    const slice = clean.slice(index, end).trim();
    if (slice) chunks.push(slice);
    if (end <= index) break;
    index = end;
  }
  return chunks;
}

export function sourcePdfObjectPath(userId: string, uploadId: string): string {
  return `${userId}/bureau-reports/${uploadId}/source.pdf`;
}

export function pageObjectPath(userId: string, uploadId: string, pageNumber: number, ext: string): string {
  return `${userId}/${uploadId}/page-${String(pageNumber).padStart(3, "0")}.${ext}`;
}

export function chunkObjectPath(userId: string, uploadId: string, chunkNumber: number): string {
  return `${userId}/${uploadId}/chunk-${String(chunkNumber).padStart(3, "0")}.txt`;
}

export function pathBelongsToStaff(path: string, staffUserId: string): boolean {
  return path.startsWith(`${staffUserId}/`) && !path.includes("..") && !path.includes("\\") && !path.includes("\0");
}

function requireUuid(value: unknown, field: string): string | Fail {
  if (typeof value !== "string" || !UUID_RE.test(value)) return { ok: false, error: `${field} must be a uuid` };
  return value;
}

function optionalEncoded(value: unknown, field: string, maxBytes: number): string | undefined | Fail {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim() === "") return { ok: false, error: `${field} must be base64 text` };
  const split = splitEncodedPayload(value);
  if ("ok" in split) return split;
  if (estimatedDecodedBytes(split.base64) > maxBytes) {
    return { ok: false, error: `${field} is larger than ${Math.round(maxBytes / (1024 * 1024))} MB` };
  }
  return value.trim();
}

export function parseBureauUploadArgs(args: Record<string, unknown>): Ok<ParsedBureauUpload> | Fail {
  const allowed = [
    "bureau",
    "session_id",
    "client_id",
    "pdf_base64",
    "pdf_url",
    "report_text",
    "page_images",
    "questionnaire",
    "filename",
    "report_type",
    "queue",
  ];
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) return { ok: false, error: `unknown field: ${key}` };
  }

  if (typeof args.bureau !== "string" || !(UPLOAD_BUREAUS as readonly string[]).includes(args.bureau)) {
    return { ok: false, error: "bureau must be equifax, experian, or transunion" };
  }

  let sessionId: string | undefined;
  if (args.session_id != null) {
    const parsed = requireUuid(args.session_id, "session_id");
    if (typeof parsed !== "string") return parsed;
    sessionId = parsed;
  }
  let clientId: string | undefined;
  if (args.client_id != null) {
    const parsed = requireUuid(args.client_id, "client_id");
    if (typeof parsed !== "string") return parsed;
    clientId = parsed;
  }
  if (!sessionId && !clientId) return { ok: false, error: "session_id or client_id is required" };

  const pdfBase64 = optionalEncoded(args.pdf_base64, "pdf_base64", MAX_PDF_BYTES);
  if (pdfBase64 && typeof pdfBase64 === "object") return pdfBase64;
  let pdfUrl: string | undefined;
  if (args.pdf_url != null) {
    if (typeof args.pdf_url !== "string" || args.pdf_url.trim() === "") return { ok: false, error: "pdf_url must be an https URL" };
    const checked = validatePublicHttpsUrl(args.pdf_url.trim());
    if (isUploadFailure(checked)) return checked;
    pdfUrl = checked.value.toString();
  }
  let reportText: string | undefined;
  if (args.report_text != null) {
    if (typeof args.report_text !== "string") return { ok: false, error: "report_text must be text" };
    const trimmed = args.report_text.trim();
    if (!trimmed) return { ok: false, error: "report_text is empty" };
    if (trimmed.length > MAX_TEXT_CHARS) return { ok: false, error: "report_text is too long" };
    reportText = trimmed;
  }

  let pageImages: string[] | undefined;
  if (args.page_images != null) {
    if (!Array.isArray(args.page_images)) return { ok: false, error: "page_images must be a list" };
    if (args.page_images.length === 0) return { ok: false, error: "page_images is empty" };
    if (args.page_images.length > MAX_PAGE_IMAGES) {
      return { ok: false, error: `page_images cannot exceed ${MAX_PAGE_IMAGES}` };
    }
    let total = 0;
    const images: string[] = [];
    for (const image of args.page_images) {
      const encoded = optionalEncoded(image, "page image", MAX_IMAGE_BYTES);
      if (encoded == null) return { ok: false, error: "page image is empty" };
      if (typeof encoded !== "string") return encoded;
      const split = splitEncodedPayload(encoded);
      if ("ok" in split) return split;
      const bytes = estimatedDecodedBytes(split.base64);
      if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: "page image is larger than 5 MB" };
      total += bytes;
      if (total > MAX_TOTAL_IMAGE_BYTES) return { ok: false, error: "page images are larger than 24 MB combined" };
      images.push(encoded);
    }
    pageImages = images;
  }

  if (!pdfBase64 && !pdfUrl && !reportText && !pageImages) {
    return { ok: false, error: "provide pdf_base64, pdf_url, report_text, or page_images" };
  }

  let questionnaire: Record<string, unknown> | undefined;
  if (args.questionnaire != null) {
    if (!isRecord(args.questionnaire)) return { ok: false, error: "questionnaire must be an object" };
    if (JSON.stringify(args.questionnaire).length > MAX_QUESTIONNAIRE_CHARS) {
      return { ok: false, error: "questionnaire is too long" };
    }
    questionnaire = args.questionnaire;
  }

  let filename: string | undefined;
  if (args.filename != null) {
    if (typeof args.filename !== "string") return { ok: false, error: "filename must be text" };
    const trimmed = args.filename.trim();
    if (!trimmed || trimmed.length > 120) return { ok: false, error: "filename must be 1 to 120 characters" };
    if (/[\\/\0]/.test(trimmed)) return { ok: false, error: "filename must not include a path" };
    filename = trimmed;
  }

  let reportType: string | undefined;
  if (args.report_type != null) {
    if (typeof args.report_type !== "string") return { ok: false, error: "report_type must be text" };
    const trimmed = args.report_type.trim();
    if (!trimmed || trimmed.length > 80) return { ok: false, error: "report_type must be 1 to 80 characters" };
    reportType = trimmed;
  }

  let queue = true;
  if (args.queue != null) {
    if (typeof args.queue !== "boolean") return { ok: false, error: "queue must be true or false" };
    queue = args.queue;
  }

  return {
    ok: true,
    value: {
      bureau: args.bureau as UploadBureau,
      sessionId,
      clientId,
      pdfBase64: typeof pdfBase64 === "string" ? pdfBase64 : undefined,
      pdfUrl,
      reportText,
      pageImages,
      questionnaire,
      filename,
      reportType,
      queue,
    },
  };
}

export function toAnalysisUploadBody(parsed: ParsedBureauUpload): Record<string, unknown> {
  return {
    bureau: parsed.bureau,
    session_id: parsed.sessionId,
    client_id: parsed.clientId,
    pdf_base64: parsed.pdfBase64,
    pdf_url: parsed.pdfUrl,
    report_text: parsed.reportText,
    page_images: parsed.pageImages,
    questionnaire: parsed.questionnaire,
    filename: parsed.filename,
    report_type: parsed.reportType,
    queue: parsed.queue,
  };
}
