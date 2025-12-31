// src/components/chatbot/infraPresignApi.ts
import keycloak from "../../keycloak";
import { fetchJson } from "../common/api/authHttp";

type EnvLike = Record<string, string | undefined>;
const ENV = import.meta.env as unknown as EnvLike;

const INFRA_BASE = String(ENV.VITE_INFRA_API_BASE ?? "/api-infra").replace(
  /\/$/,
  ""
);

/**
 * Infra presign endpoints (Vite proxy로 infra-service로 라우팅)
 * - upload:   /infra/files/presign/upload
 * - download: /infra/files/presign/download
 * - proxyPut: /infra/files/presign/upload/put?url=...
 */
const PRESIGN_UPLOAD_ENDPOINT = `${INFRA_BASE}/infra/files/presign/upload`;
const PRESIGN_DOWNLOAD_ENDPOINT = `${INFRA_BASE}/infra/files/presign/download`;
const PRESIGN_UPLOAD_PROXY_PUT_ENDPOINT = `${INFRA_BASE}/infra/files/presign/upload/put`;

// 만료 직전 URL 재사용 방지(안전 여유)
const PRESIGN_CACHE_SAFETY_MS = 25_000;

export type PresignFileType = "image" | "docs" | "video";

export function isS3Url(u: string): boolean {
  return (u ?? "").trim().toLowerCase().startsWith("s3://");
}

/**
 * s3://bucket/path/to/file.mp4 -> "bucket/path/to/file.mp4"
 * s3://path/to/file.mp4       -> "path/to/file.mp4"
 */
export function extractS3ObjectKey(s3url: string): string {
  const s = (s3url ?? "").trim();
  if (!isS3Url(s)) return "";
  return s.replace(/^s3:\/\//i, "").replace(/^\/+/, "");
}

/**
 * backend가 "fileUrl required"를 강제하므로
 * - 입력이 s3://... 이면 그대로 fileUrl
 * - 입력이 bucket/key(objectKey) 형태면 s3://bucket/key로 승격
 * - bucket 없이 key만 들어오면 변환 불가 → 에러
 */
function normalizeToFileUrl(input: string): {
  fileUrl: string;
  objectKey: string;
} {
  const raw = (input ?? "").trim();
  if (!raw)
    throw new Error(
      "[INFRA] presign(download): fileUrl required (empty input)"
    );

  if (isS3Url(raw)) {
    const objectKey = extractS3ObjectKey(raw);
    if (!objectKey)
      throw new Error("[INFRA] presign(download): objectKey 추출 실패");
    return { fileUrl: raw, objectKey };
  }

  // objectKey 스타일: "bucket/key"
  if (raw.includes("/")) {
    const objectKey = raw.replace(/^\/+/, "");
    return { fileUrl: `s3://${objectKey}`, objectKey };
  }

  throw new Error(
    `[INFRA] presign(download): cannot normalize to s3:// (input=${raw})`
  );
}

function getCurrentAccessTokenOrNull(): string | null {
  const t = (keycloak as unknown as { token?: unknown })?.token;
  if (typeof t === "string" && t.trim()) return t;
  return null;
}

function mergeHeaders(
  base: HeadersInit | undefined,
  extra: Record<string, string>
): Headers {
  const h = new Headers(base ?? undefined);
  for (const [k, v] of Object.entries(extra)) {
    if (!h.has(k)) h.set(k, v);
  }
  return h;
}

function isAbortLikeError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    if ((err.message ?? "").toLowerCase().includes("aborted")) return true;
  }
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    const msg = typeof rec.message === "string" ? rec.message : "";
    if (name === "AbortError") return true;
    if (msg.toLowerCase().includes("aborted")) return true;
  }
  return false;
}

function isTimeoutLikeError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    const msg = (err.message ?? "").toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("etimedout")
    );
  }
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    const code = typeof rec.code === "string" ? rec.code.toLowerCase() : "";
    const msg =
      typeof rec.message === "string" ? rec.message.toLowerCase() : "";
    return (
      code.includes("etimedout") ||
      msg.includes("timeout") ||
      msg.includes("timed out")
    );
  }
  return false;
}

function isNetworkLikeError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const msg = (err.message ?? "").toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network error")
    );
  }
  return false;
}

function attachParentAbort(
  parent: AbortSignal | null | undefined,
  ctrl: AbortController
) {
  if (!parent) return;
  if (parent.aborted) {
    ctrl.abort();
    return;
  }
  parent.addEventListener("abort", () => ctrl.abort(), { once: true });
}

function withHardTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  let t: number | undefined;

  const timeout = new Promise<never>((_, reject) => {
    t = window.setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // ignore
      }
      const err = new Error(`${label}: timeout after ${ms}ms`);
      (err as unknown as { code?: string }).code = "ETIMEDOUT";
      reject(err);
    }, ms);
  });

  return Promise.race([
    p.finally(() => {
      if (t !== undefined) window.clearTimeout(t);
    }),
    timeout,
  ]);
}

async function directFetchJson<T>(
  url: string,
  init: RequestInit,
  context: string
): Promise<T> {
  const token = getCurrentAccessTokenOrNull();
  if (!token)
    throw new Error(
      `[INFRA] ${context}: fallback fetch 실패 (현재 토큰이 없습니다)`
    );

  const headers = mergeHeaders(init.headers, {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  });

  const res = await fetch(url, { ...init, headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[INFRA] ${context}: fallback fetch HTTP ${res.status} ${res.statusText}${
        text ? ` - ${text.slice(0, 300)}` : ""
      }`
    );
  }

  if (res.status === 204) return null as unknown as T;

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) return (await res.json()) as T;

  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `[INFRA] ${context}: JSON 아님. content-type=${
        ct || "unknown"
      } body=${text.slice(0, 200)}`
    );
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toNumOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toMsFromUnknown(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const d = Date.parse(v);
    if (Number.isFinite(d)) return d;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function keysPreview(raw: unknown): string {
  if (!isRecord(raw)) return "";
  const ks = Object.keys(raw).slice(0, 18);
  return ks.length ? `keys=[${ks.join(", ")}]` : "";
}

function unwrapRecord(
  raw: unknown,
  keys: string[] = ["data", "result"]
): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const top = raw as Record<string, unknown>;
  for (const k of keys) {
    const inner = top[k];
    if (isRecord(inner))
      return { ...top, ...(inner as Record<string, unknown>) };
  }
  return top;
}

function normalizePresignDownloadDto(raw: unknown): {
  url: string;
  expiresAtMs: number;
} {
  const dto = unwrapRecord(raw);
  if (!dto)
    throw new Error(
      "[INFRA] presign(download): 응답 형식이 올바르지 않습니다."
    );

  const url =
    (typeof dto.url === "string" && dto.url) ||
    (typeof dto.downloadUrl === "string" && dto.downloadUrl) ||
    (typeof (dto as Record<string, unknown>)["download_url"] === "string" &&
      String((dto as Record<string, unknown>)["download_url"])) ||
    (typeof dto.presignedUrl === "string" && dto.presignedUrl) ||
    (typeof (dto as Record<string, unknown>)["presigned_url"] === "string" &&
      String((dto as Record<string, unknown>)["presigned_url"])) ||
    (typeof (dto as Record<string, unknown>)["signedUrl"] === "string" &&
      String((dto as Record<string, unknown>)["signedUrl"])) ||
    (typeof (dto as Record<string, unknown>)["signed_url"] === "string" &&
      String((dto as Record<string, unknown>)["signed_url"])) ||
    "";

  if (!url)
    throw new Error(`[INFRA] presign(download): url 누락. ${keysPreview(dto)}`);

  const expiresAtMs =
    toMsFromUnknown(
      dto.expiresAt ??
        (dto as Record<string, unknown>)["expires_at"] ??
        dto.expireAt
    ) ??
    (() => {
      const sec = toNumOrNull(
        dto.expiresIn ??
          (dto as Record<string, unknown>)["expires_in"] ??
          dto.ttlSeconds
      );
      if (sec !== null) return Date.now() + sec * 1000;
      return null;
    })() ??
    Date.now() + 10 * 60 * 1000;

  return { url, expiresAtMs };
}

function normalizePresignUploadDto(raw: unknown): {
  url: string;
  expiresAtMs: number;
  objectKey: string;
} {
  const dto = unwrapRecord(raw);
  if (!dto)
    throw new Error("[INFRA] presign(upload): 응답 형식이 올바르지 않습니다.");

  const url =
    (typeof dto.uploadUrl === "string" && dto.uploadUrl) ||
    (typeof (dto as Record<string, unknown>)["upload_url"] === "string" &&
      String((dto as Record<string, unknown>)["upload_url"])) ||
    (typeof dto.presignedUrl === "string" && dto.presignedUrl) ||
    (typeof dto.url === "string" && dto.url) ||
    "";

  const objectKey =
    (typeof dto.objectKey === "string" && dto.objectKey) ||
    (typeof (dto as Record<string, unknown>)["object_key"] === "string" &&
      String((dto as Record<string, unknown>)["object_key"])) ||
    (typeof dto.key === "string" && dto.key) ||
    "";

  if (!url)
    throw new Error(`[INFRA] presign(upload): url 누락. ${keysPreview(dto)}`);
  if (!objectKey)
    throw new Error(
      `[INFRA] presign(upload): objectKey 누락. ${keysPreview(dto)}`
    );

  const expiresAtMs =
    toMsFromUnknown(
      dto.expiresAt ??
        (dto as Record<string, unknown>)["expires_at"] ??
        dto.expireAt
    ) ??
    (() => {
      const sec = toNumOrNull(
        dto.expiresIn ??
          (dto as Record<string, unknown>)["expires_in"] ??
          dto.ttlSeconds
      );
      if (sec !== null) return Date.now() + sec * 1000;
      return null;
    })() ??
    Date.now() + 10 * 60 * 1000;

  return { url, expiresAtMs, objectKey };
}

async function infraFetch<T>(
  url: string,
  init: RequestInit,
  context: string
): Promise<T> {
  const method = String(init.method ?? "GET").toUpperCase();
  const PRIMARY_TIMEOUT_MS = method === "GET" ? 2500 : 5000;
  const FALLBACK_TIMEOUT_MS = method === "GET" ? 8000 : 12000;

  const ctrl1 = new AbortController();
  attachParentAbort(init.signal, ctrl1);

  try {
    return await withHardTimeout(
      fetchJson<T>(url, { ...init, signal: ctrl1.signal }),
      PRIMARY_TIMEOUT_MS,
      `[INFRA] ${context} (fetchJson)`,
      () => ctrl1.abort()
    );
  } catch (e) {
    const fallbackCandidate =
      isAbortLikeError(e) || isTimeoutLikeError(e) || isNetworkLikeError(e);
    if (!fallbackCandidate) throw e;
  }

  const ctrl2 = new AbortController();
  attachParentAbort(init.signal, ctrl2);

  return await withHardTimeout(
    directFetchJson<T>(url, { ...init, signal: ctrl2.signal }, context),
    FALLBACK_TIMEOUT_MS,
    `[INFRA] ${context} (fallback fetch)`,
    () => ctrl2.abort()
  );
}

/** download 캐시(objectKey 단위) */
const downloadCache = new Map<string, { url: string; expiresAtMs: number }>();

/**
 * presign(download): POST + fileUrl 로 단일화
 * - backend 에러: "fileUrl required"
 * - 405 원인: GET 미지원
 * - 따라서 GET 시도/쿼리키 난사(objectKey/key/path 등) 제거
 *
 * 입력은 아래 모두 허용:
 * - "s3://bucket/key"
 * - "bucket/key" (objectKey)
 */
export async function presignDownload(
  fileUrlOrObjectKey: string,
  opts?: { signal?: AbortSignal | null; type?: PresignFileType }
): Promise<{ url: string; expiresAtMs: number }> {
  const { fileUrl, objectKey } = normalizeToFileUrl(fileUrlOrObjectKey);

  const now = Date.now();
  const cached = downloadCache.get(objectKey);
  if (cached && cached.expiresAtMs - now > PRESIGN_CACHE_SAFETY_MS)
    return cached;

  const type = opts?.type ?? "video";

  // 서버 구현 편차 흡수: query + body 둘 다 실어준다.
  const qs = new URLSearchParams({ type, fileUrl }).toString();
  const urlWithQuery = `${PRESIGN_DOWNLOAD_ENDPOINT}?${qs}`;

  const raw = await infraFetch<unknown>(
    urlWithQuery,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, fileUrl }),
      signal: opts?.signal ?? undefined,
    },
    "POST presign/download"
  );

  const norm = normalizePresignDownloadDto(raw);
  downloadCache.set(objectKey, norm);
  return norm;
}

export function buildProxyPutUrl(uploadUrl: string): string {
  return `${PRESIGN_UPLOAD_PROXY_PUT_ENDPOINT}?url=${encodeURIComponent(
    uploadUrl
  )}`;
}

export async function presignUpload(
  params: { type: PresignFileType; fileName: string; contentType?: string },
  opts?: { signal?: AbortSignal | null }
): Promise<{
  objectKey: string;
  url: string;
  expiresAtMs: number;
  proxyPutUrl: string;
}> {
  const body = {
    type: params.type,
    fileName: params.fileName,
    contentType: params.contentType ?? "application/octet-stream",
  };

  const raw = await infraFetch<unknown>(
    PRESIGN_UPLOAD_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts?.signal ?? undefined,
    },
    "POST presign/upload"
  );

  const norm = normalizePresignUploadDto(raw);

  return {
    objectKey: norm.objectKey,
    url: norm.url,
    expiresAtMs: norm.expiresAtMs,
    proxyPutUrl: buildProxyPutUrl(norm.url),
  };
}
