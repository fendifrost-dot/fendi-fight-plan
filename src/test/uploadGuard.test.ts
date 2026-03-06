import { describe, expect, it } from "vitest";
import {
  getInvalidUploads,
  hasAnalyzeBlockingUploadFailures,
  isAnalysisStartBlocked,
  runAnalysisGuardSelfTest,
} from "@/lib/upload-guard";

describe("upload analysis guard", () => {
  it("blocks analysis when any upload failed", () => {
    const files = [
      { storagePaths: ["uid/job/page-001.jpg"] },
      { storagePaths: [], error: "AUTH_NOT_READY" },
    ];

    expect(getInvalidUploads(files)).toHaveLength(1);
    expect(isAnalysisStartBlocked(files)).toBe(true);
  });

  it("allows analysis for healthy uploads", () => {
    const files = [
      { storagePaths: ["uid/job/page-001.jpg"] },
      { storagePaths: ["uid/job/page-002.jpg"] },
    ];

    expect(getInvalidUploads(files)).toHaveLength(0);
    expect(isAnalysisStartBlocked(files)).toBe(false);
  });

  it("does not block analyze button for text-first files with no storage paths", () => {
    const files = [{ pipelinePath: "text-first", storagePaths: [] }];
    expect(hasAnalyzeBlockingUploadFailures(files)).toBe(false);
  });

  it("blocks analyze button for non-text-first failed uploads", () => {
    const files = [{ pipelinePath: "vision-full", storagePaths: [], error: "UPLOAD_FAILED" }];
    expect(hasAnalyzeBlockingUploadFailures(files)).toBe(true);
  });

  it("self-test reports pass", () => {
    const result = runAnalysisGuardSelfTest();
    expect(result.pass).toBe(true);
    expect(result.blockedWhenFailedUpload).toBe(true);
    expect(result.blockedWhenHealthyUploads).toBe(false);
  });
});
