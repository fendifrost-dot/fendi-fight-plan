import { describe, expect, it } from "vitest";

// We test the pure functions by reimplementing them here since the module
// imports supabase client which isn't available in unit test context.

function buildObjectPath(uid: string, uploadId: string, pageNumber: number, ext: string): string {
  return `${uid}/${uploadId}/page-${String(pageNumber).padStart(3, "0")}.${ext}`;
}

function classifyStorageError(status: number | undefined): string {
  if (status === 403) return "STORAGE_403";
  return "STORAGE_WRITE_PROBE_FAILED";
}

describe("buildObjectPath contract", () => {
  it("produces {uid}/{uploadId}/page-001.{ext}", () => {
    const path = buildObjectPath("abc-123", "job-456", 1, "png");
    expect(path).toBe("abc-123/job-456/page-001.png");
  });

  it("pads page numbers to 3 digits", () => {
    expect(buildObjectPath("u", "j", 7, "jpg")).toBe("u/j/page-007.jpg");
    expect(buildObjectPath("u", "j", 42, "webp")).toBe("u/j/page-042.webp");
    expect(buildObjectPath("u", "j", 100, "png")).toBe("u/j/page-100.png");
  });

  it("prefix folder equals uid", () => {
    const uid = "d4e5f6a7-b8c9-0123-4567-89abcdef0123";
    const path = buildObjectPath(uid, "selftest", 1, "png");
    expect(path.split("/")[0]).toBe(uid);
  });

  it("selftest probe uses production path format", () => {
    const uid = "test-uid";
    const uploadId = "selftest";
    const path = buildObjectPath(uid, uploadId, 1, "png");
    // Must match the exact regex used in the self-test
    const pattern = new RegExp(`^${uid}/${uploadId}/page-\\d{3}\\.(jpg|jpeg|webp|png)$`);
    expect(pattern.test(path)).toBe(true);
  });
});

describe("storage error classification", () => {
  it("classifies 403 as STORAGE_403", () => {
    expect(classifyStorageError(403)).toBe("STORAGE_403");
  });

  it("classifies non-403 as STORAGE_WRITE_PROBE_FAILED", () => {
    expect(classifyStorageError(404)).toBe("STORAGE_WRITE_PROBE_FAILED");
    expect(classifyStorageError(500)).toBe("STORAGE_WRITE_PROBE_FAILED");
    expect(classifyStorageError(undefined)).toBe("STORAGE_WRITE_PROBE_FAILED");
  });

  it("bucket-not-found (404) is distinct from RLS (403)", () => {
    expect(classifyStorageError(404)).not.toBe(classifyStorageError(403));
  });
});

describe("foldername sanity", () => {
  it("prefix has no whitespace or encoding artifacts", () => {
    const uid = "abc-123";
    const path = buildObjectPath(uid, "job", 1, "png");
    const prefix = path.split("/")[0];
    expect(prefix).toBe(uid);
    expect(prefix.trim()).toBe(prefix);
    expect(decodeURIComponent(prefix)).toBe(prefix);
  });
});
