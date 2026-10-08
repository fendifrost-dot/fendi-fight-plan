const COMPASS_PROJECT_ID = "bfe3ffa4-da7d-42ae-ab36-7b020e50ac3c";
const PUBLISHED_ORIGINS = new Set([
  "https://fendi-fight-plan.lovable.app",
]);

export function isStaffAppOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.origin !== origin) return false;
  if (PUBLISHED_ORIGINS.has(url.origin)) return true;
  const previewSuffix = `--${COMPASS_PROJECT_ID}.lovable.app`;
  return url.host.endsWith(previewSuffix);
}

function extraOrigins(): string[] {
  const runtime = globalThis as { Deno?: { env: { get: (name: string) => string | undefined } } };
  const raw = runtime.Deno?.env.get("COMPASS_STAFF_ORIGINS") ?? "";
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

export function corsFor(
  req: Request,
  allowHeaders = "authorization, x-client-info, apikey, content-type, x-api-key",
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
  const origin = req.headers.get("Origin") ?? "";
  if (origin && (isStaffAppOrigin(origin) || extraOrigins().includes(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0 && a.length > 0 && b.length > 0;
}
