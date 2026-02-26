/**
 * Storage upload utilities for streaming page uploads.
 * Object naming invariant: "{uid}/{jobId}/page-###.{ext}"
 * No bucket prefix in object name.
 */
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "analysis-images";
const TRIAGE_LOCAL_KEY = "cc_upload_triage_mode";
const CLIENT_SINGLETON_KEY = "__cc_supabase_client_singleton__";
const CLIENT_INSTANCE_IDS_KEY = "__cc_supabase_client_instance_ids__";

export interface UploadFailureDetails {
  stage: "CLIENT_PDF";
  code: string;
  message: string;
  meta: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    pageCount?: number | null;
    failingPage?: number;
    operation: "load" | "render" | "text" | "upload";
    usedScale?: number;
    usedFormat?: string;
    usedQuality?: number;
    pdfjsError?: string;
    uid: string | null;
    expectedUid?: string;
    objectPath?: string;
    prefixFolder?: string;
    bucket: string;
    upsert: boolean;
    sessionPresent: boolean;
    expires_at: number | null;
    authTokenPresent: boolean;
    projectUrlHash: string;
    clientInstanceId: string;
    storageStatus?: number;
    storageError?: string;
  };
}

export interface UploadTriageEvent {
  uid: string | null;
  expectedUid?: string;
  sessionPresent: boolean;
  expires_at: number | null;
  authTokenPresent: boolean;
  objectPath: string;
  prefixFolder: string;
  bucket: string;
  mimeType: string;
  fileSize: number;
  fileName?: string;
  upsert: boolean;
  projectUrlHash: string;
  clientInstanceId: string;
  clientSingletonMatched: boolean;
  uploadOptions: {
    upsert: boolean;
    contentType: string;
  };
  error?: {
    name?: string;
    code?: string;
    message: string;
    status?: number;
    details?: string;
  };
}

export interface UploadSelfTestReport {
  uid: string | null;
  sessionPresent: boolean;
  expires_at: number | null;
  objectNameUsed: string;
  clientInstanceId: string;
  tests: {
    authHydration: { pass: boolean; code?: string; details?: string };
    pathContract: { pass: boolean; code?: string; details?: string };
    clientSingleton: { pass: boolean; code?: string; details?: string };
    storageWriteProbe: {
      pass: boolean;
      objectPath: string;
      status?: number;
      error?: string;
      errorPayload?: Record<string, unknown>;
    };
  };
  errors: Array<{ code: string; message: string; meta?: Record<string, unknown> }>;
  conclusion:
    | "missing session at upload time"
    | "wrong client instance"
    | "path mismatch"
    | "RLS/policy conflict"
    | "bucket/mime restriction"
    | "upsert/update"
    | "pass";
}

function simpleHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = Math.imul(31, h) + value.charCodeAt(i) | 0;
  return Math.abs(h).toString(16).slice(0, 12);
}

export function getProjectUrlHash(): string {
  const raw = import.meta.env.VITE_SUPABASE_URL || "";
  return simpleHash(raw);
}

function normalizeStatusCode(status: unknown): number | undefined {
  if (typeof status === "number") return status;
  if (typeof status === "string") {
    const parsed = Number(status);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function isUploadTriageModeEnabled(): boolean {
  if (import.meta.env.VITE_UPLOAD_TRIAGE_MODE === "true") return true;
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("triage") === "1") {
    localStorage.setItem(TRIAGE_LOCAL_KEY, "true");
    return true;
  }
  return localStorage.getItem(TRIAGE_LOCAL_KEY) === "true";
}

export function setUploadTriageMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TRIAGE_LOCAL_KEY, enabled ? "true" : "false");
}

function getClientInstanceId(): string {
  const g = globalThis as Record<string, unknown>;
  if (!g[CLIENT_INSTANCE_IDS_KEY]) {
    g[CLIENT_INSTANCE_IDS_KEY] = new WeakMap<object, string>();
  }
  const ids = g[CLIENT_INSTANCE_IDS_KEY] as WeakMap<object, string>;
  const clientObject = supabase as unknown as object;
  if (!ids.has(clientObject)) {
    ids.set(clientObject, `sb-${simpleHash(`${Date.now()}-${Math.random()}`)}`);
  }
  return ids.get(clientObject)!;
}

function ensureClientSingleton(): { pass: boolean; details: string } {
  const g = globalThis as Record<string, unknown>;
  if (!g[CLIENT_SINGLETON_KEY]) {
    g[CLIENT_SINGLETON_KEY] = supabase;
    return { pass: true, details: "singleton initialized" };
  }
  const same = g[CLIENT_SINGLETON_KEY] === supabase;
  return { pass: same, details: same ? "singleton matched" : "supabase client mismatch" };
}

function extFromMime(mimeType: string): "jpg" | "webp" | "png" {
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/png") return "png";
  return "jpg";
}

function buildObjectPath(uid: string, uploadId: string, pageNumber: number, ext: string): string {
  return `${uid}/${uploadId}/page-${String(pageNumber).padStart(3, "0")}.${ext}`;
}

function toUploadFailure(details: UploadTriageEvent): UploadFailureDetails {
  return {
    stage: "CLIENT_PDF",
    code: details.error?.status === 403 ? "STORAGE_403" : "UPLOAD_FAILED",
    message: details.error?.message || "Storage upload failed",
    meta: {
      fileName: details.fileName,
      fileSize: details.fileSize,
      mimeType: details.mimeType,
      pageCount: null,
      failingPage: Number(details.objectPath.match(/page-(\d{3})/)?.[1]) || undefined,
      operation: "upload",
      usedFormat: details.mimeType,
      uid: details.uid,
      expectedUid: details.expectedUid,
      objectPath: details.objectPath,
      prefixFolder: details.prefixFolder,
      bucket: details.bucket,
      upsert: details.upsert,
      sessionPresent: details.sessionPresent,
      expires_at: details.expires_at,
      authTokenPresent: details.authTokenPresent,
      projectUrlHash: details.projectUrlHash,
      clientInstanceId: details.clientInstanceId,
      storageStatus: details.error?.status,
      storageError: details.error?.details,
      pdfjsError: details.error
        ? `${details.error.name ? `[${details.error.name}] ` : ""}${details.error.message}${details.error.details ? ` | ${details.error.details}` : ""}`
        : undefined,
    },
  };
}

interface UploadBlobParams {
  expectedUserId?: string;
  uploadId: string;
  pageNumber: number; // 1-based page number from PDF pipeline
  blob: Blob;
  mimeType: string;
  fileName?: string;
  onTriageEvent?: (event: UploadTriageEvent) => void;
}

export async function uploadBlobWithTriage(params: UploadBlobParams): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = userData.user?.id ?? null;
  const session = sessionData.session;
  const clientInstanceId = getClientInstanceId();
  const singleton = ensureClientSingleton();

  const ext = extFromMime(params.mimeType);
  const objectPath = uid
    ? buildObjectPath(uid, params.uploadId, params.pageNumber, ext)
    : `unknown/${params.uploadId}/page-${String(params.pageNumber).padStart(3, "0")}.${ext}`;
  const prefixFolder = objectPath.split("/")[0] || "";

  const triageEvent: UploadTriageEvent = {
    uid,
    expectedUid: params.expectedUserId,
    sessionPresent: Boolean(session),
    expires_at: session?.expires_at ?? null,
    authTokenPresent: Boolean(session?.access_token),
    objectPath,
    prefixFolder,
    bucket: BUCKET,
    mimeType: params.mimeType,
    fileSize: params.blob.size,
    fileName: params.fileName,
    upsert: false,
    projectUrlHash: getProjectUrlHash(),
    clientInstanceId,
    clientSingletonMatched: singleton.pass,
    uploadOptions: {
      upsert: false,
      contentType: params.mimeType,
    },
  };

  if (!uid) {
    triageEvent.error = {
      name: "AuthHydrationError",
      code: "AUTH_NOT_READY",
      message: "Auth hydration incomplete: no user available at upload time",
    };
    params.onTriageEvent?.(triageEvent);
    throw {
      stage: "CLIENT_PDF",
      code: "AUTH_NOT_READY",
      message: "Auth hydration incomplete: no user available at upload time",
      meta: {
        fileName: params.fileName,
        fileSize: params.blob.size,
        mimeType: params.mimeType,
        operation: "upload",
        bucket: BUCKET,
        uid: null,
        expectedUid: params.expectedUserId,
        objectPath,
        prefixFolder,
        upsert: false,
        sessionPresent: Boolean(session),
        expires_at: session?.expires_at ?? null,
        authTokenPresent: Boolean(session?.access_token),
        projectUrlHash: getProjectUrlHash(),
        clientInstanceId,
      },
    } as UploadFailureDetails;
  }

  if (!singleton.pass) {
    triageEvent.error = {
      name: "SupabaseClientMismatchError",
      code: "CLIENT_INSTANCE_MISMATCH",
      message: "Storage/auth are not using the same client instance",
      details: singleton.details,
    };
    params.onTriageEvent?.(triageEvent);
    throw {
      stage: "CLIENT_PDF",
      code: "CLIENT_INSTANCE_MISMATCH",
      message: "Storage/auth are not using the same client instance",
      meta: {
        fileName: params.fileName,
        fileSize: params.blob.size,
        mimeType: params.mimeType,
        operation: "upload",
        bucket: BUCKET,
        uid,
        expectedUid: params.expectedUserId,
        objectPath,
        prefixFolder,
        upsert: false,
        sessionPresent: Boolean(session),
        expires_at: session?.expires_at ?? null,
        authTokenPresent: Boolean(session?.access_token),
        projectUrlHash: getProjectUrlHash(),
        clientInstanceId,
        pdfjsError: singleton.details,
      },
    } as UploadFailureDetails;
  }

  if (params.expectedUserId && params.expectedUserId !== uid) {
    triageEvent.error = {
      name: "UidPathMismatchError",
      code: "UID_PATH_MISMATCH",
      message: "Expected UID does not match hydrated UID",
    };
    params.onTriageEvent?.(triageEvent);
    throw {
      stage: "CLIENT_PDF",
      code: "UID_PATH_MISMATCH",
      message: "Expected UID does not match hydrated UID",
      meta: {
        fileName: params.fileName,
        fileSize: params.blob.size,
        mimeType: params.mimeType,
        operation: "upload",
        bucket: BUCKET,
        uid,
        expectedUid: params.expectedUserId,
        objectPath,
        prefixFolder,
        upsert: false,
        sessionPresent: Boolean(session),
        expires_at: session?.expires_at ?? null,
        authTokenPresent: Boolean(session?.access_token),
        projectUrlHash: getProjectUrlHash(),
        clientInstanceId,
      },
    } as UploadFailureDetails;
  }

  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, params.blob, {
    contentType: params.mimeType,
    upsert: false,
  });

  if (error) {
    const normalizedStatus = normalizeStatusCode((error as { statusCode?: unknown }).statusCode);
    triageEvent.error = {
      name: (error as { name?: string }).name,
      code: (error as { error?: string }).error,
      message: error.message,
      status: normalizedStatus,
      details: (error as { details?: string }).details,
    };
    params.onTriageEvent?.(triageEvent);
    throw toUploadFailure(triageEvent);
  }

  params.onTriageEvent?.(triageEvent);
  return objectPath;
}

/**
 * Upload a single page blob to storage.
 * Returns the object path (NOT including bucket name).
 */
export async function uploadPageBlob(
  userId: string,
  uploadId: string,
  pageIndex: number,
  blob: Blob,
  mimeType: string = "image/jpeg",
  fileName?: string,
  onTriageEvent?: (event: UploadTriageEvent) => void,
): Promise<string> {
  return uploadBlobWithTriage({
    expectedUserId: userId,
    uploadId,
    pageNumber: pageIndex,
    blob,
    mimeType,
    fileName,
    onTriageEvent,
  });
}

/**
 * Upload a single image file (non-PDF) to storage.
 * Reads as blob, uploads with correct path.
 */
export async function uploadImageFile(
  userId: string,
  uploadId: string,
  file: File,
  pageIndex: number = 1,
  onTriageEvent?: (event: UploadTriageEvent) => void,
): Promise<string> {
  // For non-JPEG images, convert via canvas to ensure JPEG output unless PNG/WebP already provided
  let blob: Blob;
  let mimeType = file.type || "image/jpeg";

  if (file.type === "image/jpeg" || file.type === "image/webp" || file.type === "image/png") {
    blob = file;
  } else {
    blob = await convertImageToJpegBlob(file);
    mimeType = "image/jpeg";
  }

  return uploadBlobWithTriage({
    expectedUserId: userId,
    uploadId,
    pageNumber: pageIndex,
    blob,
    mimeType,
    fileName: file.name,
    onTriageEvent,
  });
}

/**
 * Convert any supported image to a JPEG blob via canvas.
 */
async function convertImageToJpegBlob(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas context creation failed"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (b) => {
          URL.revokeObjectURL(url);
          canvas.width = 0;
          canvas.height = 0;
          b ? resolve(b) : reject(new Error("toBlob failed"));
        },
        "image/jpeg",
        0.85,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };

    img.src = url;
  });
}

export async function runUploadSelfTest(uploadId: string = "selftest"): Promise<UploadSelfTestReport> {
  const errors: Array<{ code: string; message: string; meta?: Record<string, unknown> }> = [];
  const { data: userData } = await supabase.auth.getUser();
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = userData.user?.id ?? null;
  const session = sessionData.session;
  const clientInstanceId = getClientInstanceId();

  const objectNameUsed = uid
    ? buildObjectPath(uid, uploadId, 1, "png")
    : "unknown/selftest/page-001.png";

  const authHydrationPass = Boolean(uid);
  if (!authHydrationPass) {
    errors.push({ code: "AUTH_NOT_READY", message: "getUser() returned null user before upload" });
  }

  const pathContractPass = uid
    ? new RegExp(`^${uid}/${uploadId}/page-\\d{3}\\.(jpg|jpeg|webp|png)$`).test(objectNameUsed) && objectNameUsed.split("/")[0] === uid
    : false;
  if (!pathContractPass) {
    errors.push({ code: "UID_PATH_MISMATCH", message: "objectName does not match required {uid}/{uploadId}/page-###.{ext}" });
  }

  const singleton = ensureClientSingleton();
  if (!singleton.pass) {
    errors.push({ code: "MULTIPLE_SUPABASE_CLIENTS", message: singleton.details });
  }

  const probePath = uid ? `${uid}/probe/probe.png` : "unknown/probe/probe.png";
  let probePass = false;
  let probeStatus: number | undefined;
  let probeError: string | undefined;
  let probeErrorPayload: Record<string, unknown> | undefined;

  if (uid) {
    const onePxPng = new Blob([
      Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,248,15,4,0,9,251,3,253,160,71,50,157,0,0,0,0,73,69,78,68,174,66,96,130]),
    ], { type: "image/png" });

    const { error } = await supabase.storage.from(BUCKET).upload(probePath, onePxPng, {
      contentType: "image/png",
      upsert: false,
    });

    if (error) {
      probeStatus = normalizeStatusCode((error as { statusCode?: unknown }).statusCode);
      probeError = `${error.message}${(error as { details?: string }).details ? ` | ${(error as { details?: string }).details}` : ""}`;
      probeErrorPayload = {
        name: (error as { name?: string }).name,
        code: (error as { error?: string }).error,
        message: error.message,
        status: probeStatus,
        details: (error as { details?: string }).details,
      };
      errors.push({ code: probeStatus === 403 ? "STORAGE_403" : "STORAGE_WRITE_PROBE_FAILED", message: probeError, meta: probeErrorPayload });
    } else {
      probePass = true;
      await supabase.storage.from(BUCKET).remove([probePath]);
    }
  }

  const conclusion: UploadSelfTestReport["conclusion"] = !authHydrationPass
    ? "missing session at upload time"
    : !singleton.pass
      ? "wrong client instance"
      : !pathContractPass
        ? "path mismatch"
        : !probePass
          ? (probeStatus === 403 ? "RLS/policy conflict" : "bucket/mime restriction")
          : "pass";

  return {
    uid,
    sessionPresent: Boolean(session),
    expires_at: session?.expires_at ?? null,
    objectNameUsed,
    clientInstanceId,
    tests: {
      authHydration: {
        pass: authHydrationPass,
        code: authHydrationPass ? undefined : "AUTH_NOT_READY",
        details: authHydrationPass ? "getUser() returned uid" : "getUser() returned null",
      },
      pathContract: {
        pass: pathContractPass,
        code: pathContractPass ? undefined : "UID_PATH_MISMATCH",
        details: objectNameUsed,
      },
      clientSingleton: {
        pass: singleton.pass,
        code: singleton.pass ? undefined : "MULTIPLE_SUPABASE_CLIENTS",
        details: `${singleton.details} | clientInstanceId=${clientInstanceId}`,
      },
      storageWriteProbe: {
        pass: probePass,
        objectPath: probePath,
        status: probeStatus,
        error: probeError,
        errorPayload: probeErrorPayload,
      },
    },
    errors,
    conclusion,
  };
}

/**
 * Delete all objects under a job prefix.
 * Used for cleanup on cancel/error during upload.
 */
export async function deleteJobObjects(
  userId: string,
  uploadId: string,
): Promise<void> {
  const prefix = `${userId}/${uploadId}/`;
  const { data: files } = await supabase.storage
    .from(BUCKET)
    .list(prefix.replace(/\/$/, ""), { limit: 200 });

  if (files && files.length > 0) {
    await supabase.storage
      .from(BUCKET)
      .remove(files.map((f) => `${prefix}${f.name}`));
  }
}

