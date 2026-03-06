export interface UploadGuardFile {
  name?: string;
  error?: string;
  storagePaths: string[];
  isProcessing?: boolean;
  pipelinePath?: "text-first" | "vision-selective" | "vision-full" | "image-direct" | string;
}

export function getInvalidUploads(files: UploadGuardFile[]): UploadGuardFile[] {
  return files.filter((file) => Boolean(file.error) || file.storagePaths.length === 0);
}

export function isAnalysisStartBlocked(files: UploadGuardFile[]): boolean {
  if (files.some((file) => file.isProcessing)) return true;
  return getInvalidUploads(files).length > 0;
}

/**
 * Analyze-button upload guard: text-first PDFs are valid with zero storagePaths.
 * True blockers are failed/empty non-text-first uploads.
 */
export function hasAnalyzeBlockingUploadFailures(files: UploadGuardFile[]): boolean {
  const nonTextFirstFiles = files.filter((file) => file.pipelinePath !== "text-first");
  return getInvalidUploads(nonTextFirstFiles).length > 0;
}

export interface AnalysisGuardSelfTestResult {
  pass: boolean;
  blockedWhenFailedUpload: boolean;
  blockedWhenHealthyUploads: boolean;
  code?: "ANALYSIS_GUARD_BROKEN";
  details: string;
}

export function runAnalysisGuardSelfTest(): AnalysisGuardSelfTestResult {
  const failedCase: UploadGuardFile[] = [
    { error: "UPLOAD_FAILED", storagePaths: [] },
  ];
  const healthyCase: UploadGuardFile[] = [
    { storagePaths: ["uid/job/page-001.jpg"] },
  ];

  const blockedWhenFailedUpload = isAnalysisStartBlocked(failedCase);
  const blockedWhenHealthyUploads = isAnalysisStartBlocked(healthyCase);
  const pass = blockedWhenFailedUpload && !blockedWhenHealthyUploads;

  return {
    pass,
    blockedWhenFailedUpload,
    blockedWhenHealthyUploads,
    code: pass ? undefined : "ANALYSIS_GUARD_BROKEN",
    details: pass
      ? "analysis-start guard blocks failed uploads and allows healthy uploads"
      : "analysis-start guard did not enforce failed upload blocking invariant",
  };
}

