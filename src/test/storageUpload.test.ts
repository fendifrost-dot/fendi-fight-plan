import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import {
  buildObjectPath,
  classifyStorageProbeFailureCode,
  runUploadSelfTest,
} from "@/lib/storage-upload";

vi.mock("@/integrations/supabase/client", () => {
  const from = vi.fn();
  return {
    supabase: {
      auth: {
        getUser: vi.fn(),
        getSession: vi.fn(),
      },
      storage: { from },
      functions: {
        invoke: vi.fn(),
      },
    },
  };
});

describe("buildObjectPath contract", () => {
  it("produces {uid}/{uploadId}/page-001.{ext}", () => {
    expect(buildObjectPath("abc-123", "job-456", 1, "png")).toBe("abc-123/job-456/page-001.png");
  });

  it("pads page numbers to 3 digits", () => {
    expect(buildObjectPath("u", "j", 7, "jpg")).toBe("u/j/page-007.jpg");
    expect(buildObjectPath("u", "j", 42, "webp")).toBe("u/j/page-042.webp");
    expect(buildObjectPath("u", "j", 100, "png")).toBe("u/j/page-100.png");
  });
});

describe("self-test production path and cleanup", () => {
  const removeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: "uid-1" } } });
    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          expires_at: 9999999999,
        },
      },
    });

    removeMock.mockResolvedValue({ error: null });

    (supabase.storage.from as any).mockImplementation((bucket: string) => {
      return {
        upload: vi.fn(async () => {
          if (bucket === "analysis-images") {
            return { error: null };
          }
          if (bucket === "analysis-images-typo") {
            return {
              error: {
                name: "StorageApiError",
                message: "Bucket not found",
                statusCode: 404,
                error: "NotFound",
                details: "The resource was not found",
              },
            };
          }
          return { error: null };
        }),
        remove: removeMock,
        list: vi.fn(),
      };
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        policies: [],
        policyCount: 0,
        rlsEnabled: true,
        rowSecuritySetting: "on",
        queryMethod: "pg_direct",
        queryError: null,
        bucketConfig: {
          id: "analysis-images",
          name: "analysis-images",
          public: false,
          allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
          file_size_limit: null,
        },
      },
      error: null,
    });
  });

  it("self-test uses production object path format", async () => {
    const report = await runUploadSelfTest("selftest");
    expect(report.objectNameUsed).toBe("uid-1/selftest/page-001.png");
    expect(report.tests.pathContract.pass).toBe(true);
    expect(report.tests.storageWriteProbe.objectPath).toBe("uid-1/selftest/page-001.png");
  });

  it("probe cleans up uploaded object on PASS", async () => {
    await runUploadSelfTest("selftest");
    expect(removeMock).toHaveBeenCalledWith(["uid-1/selftest/page-001.png"]);
  });

  it("bucket sanity classifies wrong bucket differently than RLS 403", async () => {
    const report = await runUploadSelfTest("selftest");
    expect(report.tests.bucketIdSanity.pass).toBe(true);
    expect(report.tests.bucketIdSanity.details).toContain("status=404");
  });
});

describe("storage error classification", () => {
  it("classifies 403 as STORAGE_403", () => {
    expect(classifyStorageProbeFailureCode(403)).toBe("STORAGE_403");
  });

  it("classifies 404 as STORAGE_WRITE_PROBE_FAILED", () => {
    expect(classifyStorageProbeFailureCode(404)).toBe("STORAGE_WRITE_PROBE_FAILED");
  });
});
