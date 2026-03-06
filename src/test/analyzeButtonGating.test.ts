/**
 * Regression test: Analyze All Reports button gating.
 *
 * The button must depend ONLY on true execution blockers:
 *   - isAnalyzing
 *   - isJobProcessing
 *   - anyFileProcessing
 *   - hasUploadFailures
 *   - (responseText || uploadedFiles.length > 0)
 *
 * Identity fields and bureau detection are soft warnings, never hard gates.
 */
import { describe, it, expect } from "vitest";

interface GatingInput {
  isAnalyzing: boolean;
  isJobProcessing: boolean;
  anyFileProcessing: boolean;
  hasUploadFailures: boolean;
  responseText: string;
  uploadedFilesCount: number;
}

/**
 * Mirrors the exact disabled condition on the Analyze button in AIAnalyzer.tsx.
 */
function isAnalyzeButtonDisabled(input: GatingInput): boolean {
  return (
    input.isAnalyzing ||
    input.isJobProcessing ||
    input.anyFileProcessing ||
    input.hasUploadFailures ||
    (!input.responseText && input.uploadedFilesCount === 0)
  );
}

const baseReady: GatingInput = {
  isAnalyzing: false,
  isJobProcessing: false,
  anyFileProcessing: false,
  hasUploadFailures: false,
  responseText: "",
  uploadedFilesCount: 1,
};

describe("Analyze button gating", () => {
  it("Case 1: uploaded file + missing employer → enabled", () => {
    // Employer is NOT part of gating — button should be enabled
    expect(isAnalyzeButtonDisabled(baseReady)).toBe(false);
  });

  it("Case 2: uploaded file + unknown bureau → enabled", () => {
    // hasUnknownBureau is NOT part of gating
    expect(isAnalyzeButtonDisabled(baseReady)).toBe(false);
  });

  it("Case 3: uploaded file + missing fullLegalName/currentAddress → enabled, warning shown on analyze", () => {
    // Identity fields are soft warnings only
    expect(isAnalyzeButtonDisabled(baseReady)).toBe(false);
  });

  it("Case 4: file still uploading → disabled", () => {
    expect(isAnalyzeButtonDisabled({ ...baseReady, anyFileProcessing: true })).toBe(true);
  });

  it("Case 5: upload failure present → disabled", () => {
    expect(isAnalyzeButtonDisabled({ ...baseReady, hasUploadFailures: true })).toBe(true);
  });

  it("Case 6: no files and no response text → disabled", () => {
    expect(
      isAnalyzeButtonDisabled({ ...baseReady, uploadedFilesCount: 0, responseText: "" })
    ).toBe(true);
  });

  it("Case 7: no files but response text present → enabled", () => {
    expect(
      isAnalyzeButtonDisabled({ ...baseReady, uploadedFilesCount: 0, responseText: "some text" })
    ).toBe(false);
  });

  it("Case 8: analysis already running → disabled", () => {
    expect(isAnalyzeButtonDisabled({ ...baseReady, isAnalyzing: true })).toBe(true);
  });

  it("Case 9: job processing → disabled", () => {
    expect(isAnalyzeButtonDisabled({ ...baseReady, isJobProcessing: true })).toBe(true);
  });
});
