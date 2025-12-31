// src/components/chatbot/educationServiceApi.ts
import keycloak from "../../keycloak";
import { fetchJson } from "../common/api/authHttp";
import * as infraPresignApi from "./infraPresignApi";

type EnvLike = Record<string, string | undefined>;
const ENV = import.meta.env as unknown as EnvLike;

const EDU_BASE = String(ENV.VITE_EDU_API_BASE ?? "/api-edu").replace(/\/$/, "");

// 로컬 데모/백엔드 미구현 시 fallback (원하면 .env로 바꿀 수 있음)
const LOCAL_VIDEO_FALLBACK = String(
  ENV.VITE_EDU_LOCAL_VIDEO_FALLBACK ?? "/videos/test1.mp4"
);
const ALLOW_LOCAL_VIDEO_FALLBACK =
  String(ENV.VITE_EDU_ALLOW_LOCAL_VIDEO_FALLBACK ?? "").toLowerCase() ===
  "true";

// presign 캐시 (objectKey 단위)
const PRESIGN_CACHE_SAFETY_MS = 25_000; // 만료 직전 재사용 방지(안전 여유)
const presignCache = new Map<string, { url: string; expiresAtMs: number }>();
const presignInFlight = new Map<
  string,
  Promise<{ url: string; expiresAtMs: number }>
>();

function isPlayableUrl(u: string): boolean {
  const s = (u ?? "").trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s) || s.startsWith("/") || s.startsWith("blob:");
}

const DEBUG_EDU_API =
  String(ENV.VITE_DEBUG_EDU_API ?? "").toLowerCase() === "true";

function logDebug(...args: unknown[]) {
  if (!DEBUG_EDU_API) return;
  console.warn("[EDU_API]", ...args);
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
  // fetch() 네트워크 실패는 보통 TypeError("Failed to fetch") 형태
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

/**
 * fetchJson 자체가 “fetch 이전 단계”에서 멈출 수도 있어서,
 * signal 기반 abort만으론 못 끊는 경우가 있음 → Promise.race로 하드 타임아웃을 강제.
 */
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

/**
 * FIX: RequestInit.signal은 AbortSignal | null 일 수 있음
 * → null 허용하도록 타입을 넓혀 TS2345 해결
 */
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

async function directFetchJson<T>(
  url: string,
  init: RequestInit,
  context: string
): Promise<T> {
  const token = getCurrentAccessTokenOrNull();
  if (!token) {
    throw new Error(
      `[EDU_API] ${context}: fallback fetch 실패 (현재 토큰이 없습니다)`
    );
  }

  const headers = mergeHeaders(init.headers, {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  });

  const res = await fetch(url, { ...init, headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[EDU_API] ${context}: fallback fetch HTTP ${res.status} ${
        res.statusText
      }${text ? ` - ${text.slice(0, 300)}` : ""}`
    );
  }

  // 204/빈 바디 대응
  if (res.status === 204) return null as unknown as T;

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }

  // json이 아닌데 json처럼 내려오는 케이스도 있어서 한 번 더 시도
  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `[EDU_API] ${context}: fallback fetch 응답이 JSON이 아닙니다. content-type=${
        ct || "unknown"
      } body=${text.slice(0, 200)}`
    );
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
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

function toId(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function toNumOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toBoolOrNull(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function toStrOrNull(v: unknown): string | null {
  if (typeof v === "string") return v;
  return null;
}

function safeMsg(err: unknown): string {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name || "error";
  if (typeof err === "object") {
    const rec = err as Record<string, unknown>;
    const m = typeof rec.message === "string" ? rec.message : "";
    const s = typeof rec.status === "number" ? `status=${rec.status}` : "";
    return [m, s].filter(Boolean).join(" ").trim() || "error";
  }
  return "error";
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
    if (isRecord(inner)) {
      return { ...top, ...(inner as Record<string, unknown>) };
    }
  }
  return top;
}

function unwrapAny(raw: unknown): unknown {
  const r = unwrapRecord(raw);
  return r ?? raw;
}

/**
 * "배열을 못 찾으면 빈 배열로 뭉개지 말고" 형식 불일치로 에러를 던져야 함
 * - 그래야 UI에서 "정확한 에러"로 보이고, 지금처럼 조용히 빈 화면이 안됨
 */
function extractArrayOrThrow<T>(
  raw: unknown,
  candidateKeys: string[],
  itemGuard: (x: unknown) => x is T,
  context: string
): T[] {
  const u = unwrapAny(raw);

  if (Array.isArray(u)) {
    return u.filter(itemGuard);
  }

  if (isRecord(u)) {
    // 1) 명시 키에서 배열 찾기
    for (const k of candidateKeys) {
      const v = (u as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.filter(itemGuard);
    }

    // 2) 1-depth 스캔: 값이 배열인 항목 중, guard 만족하는 배열을 찾기
    for (const [, v] of Object.entries(u)) {
      if (!Array.isArray(v)) continue;
      const filtered = v.filter(itemGuard);
      if (filtered.length > 0 || v.length === 0) return filtered;
    }
  }

  throw new Error(
    `[EDU_API] ${context}: 응답에서 배열을 찾지 못했습니다. ${keysPreview(
      isRecord(u) ? u : raw
    )}`
  );
}

async function eduFetch<T>(
  url: string,
  init: RequestInit,
  context: string
): Promise<T> {
  const method = String(init.method ?? "GET").toUpperCase();

  // “fetchJson이 잠깐이라도 멈추면 짧게 끊기” → GET은 더 짧게
  const PRIMARY_TIMEOUT_MS = method === "GET" ? 2500 : 5000;
  const FALLBACK_TIMEOUT_MS = method === "GET" ? 8000 : 12000;

  // 1) fetchJson 시도(하드 타임아웃)
  const ctrl1 = new AbortController();
  attachParentAbort(init.signal, ctrl1);

  try {
    const r = await withHardTimeout(
      fetchJson<T>(url, { ...init, signal: ctrl1.signal }),
      PRIMARY_TIMEOUT_MS,
      `[EDU_API] ${context} (fetchJson)`,
      () => ctrl1.abort()
    );
    return r;
  } catch (e) {
    // Abort는 그대로 위로 올리되, “멈춤/네트워크” 계열은 fallback 대상으로 본다.
    const fallbackCandidate =
      isAbortLikeError(e) || isTimeoutLikeError(e) || isNetworkLikeError(e);

    logDebug(`${context} primary failed`, e);

    if (!fallbackCandidate) {
      // 진짜 서버 에러/파싱 에러는 그대로 표면화(조용히 무한로딩 방지)
      throw new Error(`[EDU_API] ${context}: ${safeMsg(e)}`);
    }
  }

  // 2) fallback: 현재 토큰으로 직접 fetch (fetchJson을 우회)
  const ctrl2 = new AbortController();
  attachParentAbort(init.signal, ctrl2);

  try {
    const r2 = await withHardTimeout(
      directFetchJson<T>(url, { ...init, signal: ctrl2.signal }, context),
      FALLBACK_TIMEOUT_MS,
      `[EDU_API] ${context} (fallback fetch)`,
      () => ctrl2.abort()
    );
    logDebug(`${context} fallback success`);
    return r2;
  } catch (e2) {
    logDebug(`${context} fallback failed`, e2);

    // Abort는 상위에서 silent 처리될 수 있도록 name 유지
    if (isAbortLikeError(e2)) {
      const err = new Error(`[EDU_API] ${context}: aborted (${safeMsg(e2)})`);
      (err as unknown as { name: string }).name = "AbortError";
      throw err;
    }

    throw new Error(`[EDU_API] ${context}: fallback까지 실패 (${safeMsg(e2)})`);
  }
}

/* =========================
 * Presign(download)
 * ========================= */

/**
 * Edu video fileUrl을 “브라우저 재생 가능한 URL”로 변환
 * - http(s)/relative(/...)는 그대로 반환
 * - s3://... 는 infra presign(download)로 변환 (infraPresignApi.ts 사용)
 * - presign 실패 시(로컬 dev에서만) test1.mp4 fallback 가능
 */
export async function resolveEducationVideoUrl(
  fileUrl: string,
  init?: Pick<RequestInit, "signal">
): Promise<string> {
  const raw = (fileUrl ?? "").trim();
  if (!raw)
    throw new Error(
      "[EDU_API] resolveEducationVideoUrl: fileUrl이 비어 있습니다."
    );

  if (isPlayableUrl(raw)) return raw;

  // s3 helper는 infraPresignApi로 위임
  if (!infraPresignApi.isS3Url(raw)) return raw;

  // 캐시 키는 objectKey로 유지 (s3://bucket/key -> bucket/key)
  const objectKey = infraPresignApi.extractS3ObjectKey(raw);
  if (!objectKey)
    throw new Error("[INFRA] presign(download): objectKey 추출 실패");

  const now = Date.now();
  const cached = presignCache.get(objectKey);
  if (cached && cached.expiresAtMs - now > PRESIGN_CACHE_SAFETY_MS) {
    return cached.url;
  }

  // 동시 호출 dedupe(같은 objectKey로 여러 번 호출될 때 presign 요청 1회만)
  const existed = presignInFlight.get(objectKey);
  if (existed) {
    const r = await existed;
    return r.url;
  }

  const runner = (async () => {
    try {
      const { url, expiresAtMs } = await infraPresignApi.presignDownload(raw, {
        type: "video",
        signal: init?.signal ?? undefined, // null이면 undefined로 정규화됨
      });

      if (!url)
        throw new Error("[INFRA] presign(download): url이 비어 있습니다.");

      presignCache.set(objectKey, { url, expiresAtMs });
      return { url, expiresAtMs };
    } catch (e) {
      if (ALLOW_LOCAL_VIDEO_FALLBACK) {
        logDebug("presign(download) failed -> local fallback", e);
        return { url: LOCAL_VIDEO_FALLBACK, expiresAtMs: Date.now() + 60_000 };
      }
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      presignInFlight.delete(objectKey);
    }
  })();

  presignInFlight.set(objectKey, runner);

  const r = await runner;
  return r.url;
}

/* =========================
 * Education
 * ========================= */

export type EducationItem = {
  id: string;
  title: string;
  description?: string;
  eduType?: string;
  createdAt?: string;

  completed?: boolean;

  progressPercent?: number;
  watchStatus?: string;

  videos?: EducationVideoItem[];
};

export type EducationVideoItem = {
  id: string;
  title: string;

  fileUrl?: string;
  durationSeconds?: number;

  progressPercent?: number;
  resumePositionSeconds?: number;

  completed?: boolean;

  totalWatchSeconds?: number;
  watchStatus?: string;
};

export type EduProgressPayload = {
  position: number; // seconds
  watchTime: number; // seconds (delta)
};

export type EduProgressResponse = {
  progressPercent?: number;
  resumePositionSeconds?: number;
  videoCompleted?: boolean;
  eduCompleted?: boolean;

  eduProgressPercent?: number;
  totalWatchSeconds?: number;
};

function isCompletedByStatus(status: unknown): boolean | null {
  const s = toStrOrNull(status);
  if (!s) return null;
  const u = s.trim().toUpperCase();
  if (u === "COMPLETED" || u === "COMPLETE" || u === "DONE") return true;
  if (u === "IN_PROGRESS" || u === "INPROGRESS") return false;
  if (u === "NOT_STARTED" || u === "NOTSTARTED") return false;
  return null;
}

function normalizeResumePositionSeconds(
  raw: number | null,
  durationSeconds?: number
): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;

  let v = raw;

  // duration 기반 ms -> sec heuristic
  if (typeof durationSeconds === "number" && durationSeconds > 0) {
    // ms로 보이는 케이스: duration 대비 지나치게 크고, 절대값도 충분히 큼
    if (v > durationSeconds * 20 && v > 10_000) v = v / 1000;

    if (v < 0) v = 0;

    // duration을 넘어가면 신뢰 불가(시청 화면에서 end로 seek되어 100%로 튀는 현상 방지)
    if (v > durationSeconds + 1) return undefined;
  } else {
    // duration이 없으면 “ms로 보이면” 완화 변환만 적용
    if (v > 10_000) v = v / 1000;
    if (v < 0) v = 0;
  }

  return v;
}

function normalizeVideoRecord(
  it: Record<string, unknown>
): EducationVideoItem | null {
  const id = toId(it.id ?? it.videoId ?? it.video_id ?? it["video-id"]);
  if (!id) return null;

  const title =
    (typeof it.title === "string" && it.title.trim()) ||
    (typeof it.name === "string" && it.name.trim()) ||
    `영상 ${id}`;

  const fileUrl =
    (typeof it.fileUrl === "string" && it.fileUrl) ||
    (typeof it.videoUrl === "string" && it.videoUrl) ||
    (typeof it.url === "string" && it.url) ||
    (typeof it.file_url === "string" && String(it.file_url)) ||
    undefined;

  const durationSeconds =
    toNumOrNull(it.durationSeconds) ??
    toNumOrNull(it.duration) ??
    toNumOrNull(it.duration_sec) ??
    undefined;

  const progressPercent =
    toNumOrNull(it.progressPercent) ??
    toNumOrNull(it.progress) ??
    toNumOrNull(it.videoProgress) ??
    undefined;

  const resumeRaw =
    toNumOrNull(it.resumePositionSeconds) ??
    toNumOrNull(it.resumePosition) ??
    toNumOrNull(it.resumeSeconds) ??
    toNumOrNull(it.resume_position) ??
    null;

  const resumePositionSeconds = normalizeResumePositionSeconds(
    resumeRaw,
    durationSeconds
  );

  const completed =
    toBoolOrNull(it.isCompleted) ??
    toBoolOrNull(it.completed) ??
    isCompletedByStatus(it.watchStatus ?? it.status) ??
    (typeof progressPercent === "number" ? progressPercent >= 100 : null) ??
    undefined;

  const totalWatchSeconds =
    toNumOrNull(it.totalWatchSeconds) ??
    toNumOrNull(it.total_watch_seconds) ??
    undefined;

  const watchStatus =
    typeof it.watchStatus === "string"
      ? it.watchStatus
      : typeof it.status === "string"
      ? it.status
      : undefined;

  return {
    id,
    title,
    fileUrl,
    durationSeconds,
    progressPercent,
    resumePositionSeconds,
    completed,
    totalWatchSeconds,
    watchStatus,
  };
}

function buildEduQuery(params?: {
  completed?: boolean;
  eduType?: string;
  sort?: string;
}): string {
  if (!params) return "";
  const q = new URLSearchParams();
  if (params.completed !== undefined)
    q.set("completed", String(params.completed));
  if (params.eduType) q.set("eduType", params.eduType);
  if (params.sort) q.set("sort", params.sort);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function getMyEducations(
  params?: { completed?: boolean; eduType?: string; sort?: string },
  init?: Pick<RequestInit, "signal">
): Promise<EducationItem[]> {
  const qs = buildEduQuery(params);
  const url = `${EDU_BASE}/edus/me${qs}`;

  const raw = await eduFetch<unknown>(
    url,
    { method: "GET", signal: init?.signal },
    "GET /edus/me"
  );

  const u = unwrapAny(raw);
  const list = Array.isArray(u)
    ? u
    : extractArrayOrThrow<Record<string, unknown>>(
        u,
        ["edus", "eduList", "educations", "items", "list", "data", "result"],
        (x): x is Record<string, unknown> => isRecord(x),
        "GET /edus/me"
      );

  return list
    .map((it): EducationItem | null => {
      if (!isRecord(it)) return null;

      const id = toId(
        it.id ?? it.educationId ?? it.education_id ?? it["education-id"]
      );
      if (!id) return null;

      const title =
        (typeof it.title === "string" && it.title.trim()) ||
        (typeof it.name === "string" && it.name.trim()) ||
        `교육 ${id}`;

      const progressPercent =
        toNumOrNull(it.progressPercent) ??
        toNumOrNull(it.eduProgress) ??
        toNumOrNull(it.edu_progress) ??
        undefined;

      const watchStatus =
        typeof it.watchStatus === "string" ? it.watchStatus : undefined;

      const completed =
        toBoolOrNull(it.eduCompleted) ??
        toBoolOrNull(it.isCompleted) ??
        toBoolOrNull(it.completed) ??
        isCompletedByStatus(it.watchStatus) ??
        (typeof progressPercent === "number"
          ? progressPercent >= 100
          : undefined);

      const videosRaw = (it.videos ?? it.videoList ?? it.items) as unknown;
      const videosArr = Array.isArray(videosRaw) ? videosRaw : [];
      const videos = videosArr
        .map((v): EducationVideoItem | null =>
          isRecord(v) ? normalizeVideoRecord(v) : null
        )
        .filter((v): v is EducationVideoItem => v !== null);

      return {
        id,
        title,
        description:
          typeof it.description === "string" ? it.description : undefined,
        eduType: typeof it.eduType === "string" ? it.eduType : undefined,
        createdAt: typeof it.createdAt === "string" ? it.createdAt : undefined,
        completed,
        progressPercent,
        watchStatus,
        videos: videos.length ? videos : undefined,
      };
    })
    .filter((v): v is EducationItem => v !== null);
}

export async function getEducationVideos(
  educationId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<EducationVideoItem[]> {
  const url = `${EDU_BASE}/edu/${encodeURIComponent(
    String(educationId)
  )}/videos`;
  const raw = await eduFetch<unknown>(
    url,
    { method: "GET", signal: init?.signal },
    "GET /edu/:id/videos"
  );

  const list = extractArrayOrThrow<Record<string, unknown>>(
    raw,
    ["videos", "videoList", "items", "list", "data", "result"],
    (x): x is Record<string, unknown> => isRecord(x),
    "GET /edu/:id/videos"
  );

  return list
    .map((it) => normalizeVideoRecord(it))
    .filter((v): v is EducationVideoItem => v !== null);
}

export async function postEduVideoProgress(
  educationId: string | number,
  videoId: string | number,
  payload: EduProgressPayload,
  init?: Pick<RequestInit, "signal" | "keepalive">
): Promise<EduProgressResponse | null> {
  const url = `${EDU_BASE}/edu/${encodeURIComponent(
    String(educationId)
  )}/video/${encodeURIComponent(String(videoId))}/progress`;

  const raw = await eduFetch<unknown>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: init?.signal,
      keepalive: init?.keepalive,
    },
    "POST /edu/:id/video/:id/progress"
  );

  const dto = unwrapRecord(raw);
  if (!dto) return null;

  const progressPercent =
    toNumOrNull(dto.progressPercent) ?? toNumOrNull(dto.progress) ?? undefined;

  const videoCompleted =
    toBoolOrNull(dto.videoCompleted) ??
    toBoolOrNull(dto.isCompleted) ??
    (typeof progressPercent === "number" ? progressPercent >= 100 : undefined);

  const eduCompleted =
    toBoolOrNull(dto.eduCompleted) ??
    toBoolOrNull(dto.educationCompleted) ??
    undefined;

  const eduProgressPercent =
    toNumOrNull(dto.eduProgress) ?? toNumOrNull(dto.edu_progress) ?? undefined;

  const totalWatchSeconds =
    toNumOrNull(dto.totalWatchSeconds) ??
    toNumOrNull(dto.total_watch_seconds) ??
    undefined;

  // resumePosition은 ms로 오는 케이스/음수/비정상값 방어
  const durationSeconds =
    toNumOrNull(dto.durationSeconds ?? dto.duration ?? dto.duration_sec) ??
    undefined;
  const resumeRaw =
    toNumOrNull(dto.resumePositionSeconds) ??
    toNumOrNull(dto.resumePosition) ??
    toNumOrNull(dto.resumeSeconds) ??
    payload.position;

  const resumePositionSeconds =
    normalizeResumePositionSeconds(resumeRaw, durationSeconds) ??
    payload.position;

  return {
    progressPercent,
    resumePositionSeconds,
    videoCompleted,
    eduCompleted,
    eduProgressPercent,
    totalWatchSeconds,
  };
}

export async function completeEducation(
  educationId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<unknown | null> {
  const url = `${EDU_BASE}/edu/${encodeURIComponent(
    String(educationId)
  )}/complete`;
  return await eduFetch<unknown | null>(
    url,
    { method: "POST", signal: init?.signal },
    "POST /edu/:id/complete"
  );
}

/* =========================
 * Quiz
 * ========================= */

export type QuizAvailableEducation = {
  educationId: string;
  title: string;
  category?: string | null;
  eduType?: string | null;
  educationStatus?: string | null;
  attemptCount: number;
  maxAttempts: number | null;
  hasAttempted: boolean;
  bestScore: number | null;
  passed: boolean | null;
};

export type QuizDepartmentStat = {
  departmentName: string;
  averageScore: number;
  progressPercent: number;
  participantCount: number;
};

export type QuizQuestionItem = {
  questionId: string;
  order: number;
  question: string;
  choices: string[];
  userSelectedIndex?: number | null;
  answerIndex?: number | null;
  correctOption?: number | null;
};

export type QuizStartResponse = {
  attemptId: string;
  questions: QuizQuestionItem[];
  savedAnswers?: Array<{ questionId: string; userSelectedIndex: number }>;
};

export type QuizTimerResponse = {
  timeLimit: number;
  startedAt: string;
  expiresAt: string;
  remainingSeconds: number;
  isExpired: boolean;
};

export type QuizAnswerPayloadItem = {
  questionId: string;
  userSelectedIndex: number;
};

export type QuizSavePayload = {
  answers: QuizAnswerPayloadItem[];
  elapsedSeconds?: number;
};

export type QuizSaveResponse = {
  saved: boolean;
  savedCount?: number;
  savedAt?: string;
};

export type QuizSubmitPayload = {
  answers: QuizAnswerPayloadItem[];
};

export type QuizSubmitResponse = {
  score: number;
  passed: boolean;
  correctCount: number;
  wrongCount: number;
  totalCount: number;
  submittedAt?: string;
};

export type QuizWrongNoteItem = {
  question: string;
  userAnswerIndex: number;
  correctAnswerIndex: number;
  explanation: string;
  choices: string[];
};

export type QuizAttemptSummary = {
  attemptId: string;
  attemptNo: number;
  status: string;
  score: number | null;
  passed: boolean | null;
  startedAt?: string;
  submittedAt?: string;
};

export type QuizRetryInfo = {
  canRetry: boolean;
  currentAttemptCount: number;
  maxAttempts: number | null;
  remainingAttempts: number | null;
  bestScore: number | null;
  passed: boolean | null;
};

export type QuizLeavePayload = {
  timestamp?: string;
  reason?: string;
  leaveSeconds?: number;
};

export type QuizLeaveResponse = {
  recorded: boolean;
  leaveCount?: number;
  lastLeaveAt?: string;
};

function isDeptStatItem(x: unknown): x is Record<string, unknown> {
  if (!isRecord(x)) return false;
  return typeof (x.departmentName ?? x.name) === "string";
}

function isAvailEduItem(x: unknown): x is Record<string, unknown> {
  if (!isRecord(x)) return false;
  const id = x.educationId ?? x.education_id ?? x["education-id"];
  const title = x.title ?? x.educationTitle ?? x.name;
  return (
    (typeof id === "string" || typeof id === "number") &&
    typeof title === "string"
  );
}

function isAttemptItem(x: unknown): x is Record<string, unknown> {
  if (!isRecord(x)) return false;
  const id = x.attemptId ?? x.attempt_id ?? x["attempt-id"];
  return typeof id === "string" || typeof id === "number";
}

function isWrongItem(x: unknown): x is Record<string, unknown> {
  if (!isRecord(x)) return false;
  return typeof x.question === "string";
}

export async function getQuizDepartmentStats(
  init?: Pick<RequestInit, "signal">
): Promise<QuizDepartmentStat[]> {
  const url = `${EDU_BASE}/quiz/department-stats`;
  const raw = await eduFetch<unknown>(
    url,
    { method: "GET", signal: init?.signal },
    "GET /quiz/department-stats"
  );

  const list = extractArrayOrThrow<Record<string, unknown>>(
    raw,
    [
      "departmentStats",
      "department_stats",
      "stats",
      "items",
      "list",
      "data",
      "result",
    ],
    isDeptStatItem,
    "GET /quiz/department-stats"
  );

  return list
    .map((it): QuizDepartmentStat | null => {
      const departmentName =
        (typeof it.departmentName === "string" && it.departmentName) ||
        (typeof it.name === "string" && it.name) ||
        "";
      if (!departmentName) return null;

      const averageScore = toNumOrNull(it.averageScore) ?? 0;
      const progressPercent = toNumOrNull(it.progressPercent) ?? 0;
      const participantCount = toNumOrNull(it.participantCount) ?? 0;

      return {
        departmentName,
        averageScore,
        progressPercent,
        participantCount,
      };
    })
    .filter((v): v is QuizDepartmentStat => v !== null);
}

export async function getQuizAvailableEducations(
  init?: Pick<RequestInit, "signal">
): Promise<QuizAvailableEducation[]> {
  const url = `${EDU_BASE}/quiz/available-educations`;
  const raw = await eduFetch<unknown>(
    url,
    { method: "GET", signal: init?.signal },
    "GET /quiz/available-educations"
  );

  const list = extractArrayOrThrow<Record<string, unknown>>(
    raw,
    [
      "availableEducations",
      "available_educations",
      "educations",
      "educationList",
      "items",
      "list",
      "data",
      "result",
    ],
    isAvailEduItem,
    "GET /quiz/available-educations"
  );

  return list
    .map((it): QuizAvailableEducation | null => {
      const educationId = toId(
        it.educationId ?? it.education_id ?? it["education-id"]
      );
      if (!educationId) return null;

      const title =
        (typeof it.title === "string" && it.title.trim()) ||
        (typeof it.educationTitle === "string" && it.educationTitle.trim()) ||
        (typeof it.name === "string" && it.name.trim()) ||
        `교육 ${educationId}`;

      const attemptCount = toNumOrNull(it.attemptCount) ?? 0;
      const maxAttempts = toNumOrNull(it.maxAttempts);
      const hasAttempted = (toBoolOrNull(it.hasAttempted) ?? false) as boolean;

      const bestScore = toNumOrNull(it.bestScore);
      const passed = toBoolOrNull(it.passed);

      const category =
        typeof it.category === "string"
          ? it.category
          : typeof it.eduCategory === "string"
          ? it.eduCategory
          : null;

      const eduType = typeof it.eduType === "string" ? it.eduType : null;
      const educationStatus =
        typeof it.educationStatus === "string" ? it.educationStatus : null;

      return {
        educationId,
        title,
        category,
        eduType,
        educationStatus,
        attemptCount,
        maxAttempts: maxAttempts ?? null,
        hasAttempted,
        bestScore: bestScore ?? null,
        passed: passed ?? null,
      };
    })
    .filter((v): v is QuizAvailableEducation => v !== null);
}

export async function startQuiz(
  educationId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizStartResponse> {
  const url = `${EDU_BASE}/quiz/${encodeURIComponent(
    String(educationId)
  )}/start`;
  const raw = await eduFetch<unknown>(
    url,
    { method: "GET", signal: init?.signal },
    "GET /quiz/:educationId/start"
  );

  const dto = unwrapRecord(raw);
  if (!dto)
    throw new Error("[EDU_API] startQuiz: 응답 형식이 올바르지 않습니다.");

  const attemptId = toId(
    dto.attemptId ?? dto["attempt_id"] ?? dto["attempt-id"]
  );
  if (!attemptId)
    throw new Error("[EDU_API] startQuiz: attemptId가 누락되었습니다.");

  const qList = extractArrayOrThrow<Record<string, unknown>>(
    dto,
    ["questions", "items", "list", "data", "result"],
    (x): x is Record<string, unknown> => isRecord(x),
    "GET /quiz/:educationId/start (questions)"
  );

  const questions: QuizQuestionItem[] = qList
    .map((q): QuizQuestionItem | null => {
      if (!isRecord(q)) return null;

      const questionId = toId(q.questionId ?? q.id);
      if (!questionId) return null;

      const order = toNumOrNull(q.order) ?? 0;
      const question =
        (typeof q.question === "string" && String(q.question)) ||
        (typeof q.text === "string" && String(q.text)) ||
        "";

      const choicesRaw = q.choices;
      const choices = Array.isArray(choicesRaw)
        ? (choicesRaw.filter((x) => typeof x === "string") as string[])
        : [];

      const userSelectedIndex = toNumOrNull(q.userSelectedIndex);
      const answerIndex = toNumOrNull(q.answerIndex);
      const correctOption = toNumOrNull(q.correctOption);

      return {
        questionId,
        order,
        question,
        choices,
        userSelectedIndex,
        answerIndex,
        correctOption,
      };
    })
    .filter((v): v is QuizQuestionItem => v !== null);

  const savedAnswersRaw = (() => {
    const u = unwrapAny(dto);
    if (!isRecord(u)) return [];
    const v = (u.savedAnswers ??
      (u as Record<string, unknown>)["saved_answers"] ??
      u.answers) as unknown;
    return Array.isArray(v) ? v : [];
  })();

  const savedAnswers = savedAnswersRaw
    .map((a): { questionId: string; userSelectedIndex: number } | null => {
      if (!isRecord(a)) return null;
      const questionId = toId(a.questionId ?? a.id);
      const idx = toNumOrNull(a.userSelectedIndex);
      if (!questionId || idx === null) return null;
      return { questionId, userSelectedIndex: idx };
    })
    .filter(
      (v): v is { questionId: string; userSelectedIndex: number } => v !== null
    );

  const merged: Record<string, unknown> = {
    ...(dto as Record<string, unknown>),
    attemptId,
    questions,
  };
  if (savedAnswers.length) merged.savedAnswers = savedAnswers;

  return merged as unknown as QuizStartResponse;
}

export async function getQuizTimer(
  attemptId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizTimerResponse> {
  const candidates = [
    `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/timer`,
  ];

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const raw = await eduFetch<unknown>(
        url,
        { method: "GET", signal: init?.signal },
        "GET /quiz/attempt/:id/timer"
      );

      const dto = unwrapRecord(raw);
      if (!dto)
        throw new Error(
          "[EDU_API] getQuizTimer: 응답 형식이 올바르지 않습니다."
        );

      const timeLimit = toNumOrNull(dto.timeLimit) ?? 0;
      const startedAt = typeof dto.startedAt === "string" ? dto.startedAt : "";
      const expiresAt = typeof dto.expiresAt === "string" ? dto.expiresAt : "";
      const remainingSeconds = toNumOrNull(dto.remainingSeconds) ?? 0;
      const isExpired = (toBoolOrNull(dto.isExpired) ?? false) as boolean;

      return { timeLimit, startedAt, expiresAt, remainingSeconds, isExpired };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function putQuizTimer(
  attemptId: string | number,
  payload: { remainingSeconds: number },
  init?: Pick<RequestInit, "signal" | "keepalive">
): Promise<{ updated: boolean } | null> {
  const candidates = [
    `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/timer`,
    `${EDU_BASE}/quiz/attempts/${encodeURIComponent(String(attemptId))}/timer`,
  ];

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const raw = await eduFetch<unknown>(
        url,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: init?.signal,
          keepalive: init?.keepalive,
        },
        "PUT /quiz/attempt/:id/timer"
      );

      const dto = unwrapRecord(raw);
      if (!dto) return { updated: true };

      const updated = (toBoolOrNull(dto.updated) ?? true) as boolean;
      return { updated };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function saveQuizAnswers(
  attemptId: string | number,
  payload: QuizSavePayload,
  init?: Pick<RequestInit, "signal" | "keepalive">
): Promise<QuizSaveResponse | null> {
  const candidates = [
    `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/save`,
    `${EDU_BASE}/quiz/attempts/${encodeURIComponent(String(attemptId))}/save`,
  ];

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const raw = await eduFetch<unknown>(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: init?.signal,
          keepalive: init?.keepalive,
        },
        "POST /quiz/attempt/:id/save"
      );

      const dto = unwrapRecord(raw);
      if (!dto) return { saved: true };

      const saved = (toBoolOrNull(dto.saved) ?? true) as boolean;
      const savedCount = toNumOrNull(dto.savedCount) ?? undefined;
      const savedAt = typeof dto.savedAt === "string" ? dto.savedAt : undefined;

      return { saved, savedCount, savedAt };
    } catch (e) {
      if (isAbortLikeError(e)) throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function submitQuizAnswers(
  attemptId: string | number,
  payload: QuizSubmitPayload,
  init?: Pick<RequestInit, "signal">
): Promise<QuizSubmitResponse> {
  const candidates = [
    `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/submit`,
    `${EDU_BASE}/quiz/attempts/${encodeURIComponent(String(attemptId))}/submit`,
    `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/finish`,
  ];

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const raw = await eduFetch<unknown>(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: init?.signal,
        },
        "POST /quiz/attempt/:id/submit"
      );

      const dto = unwrapRecord(raw);
      if (!dto)
        throw new Error(
          "[EDU_API] submitQuizAnswers: 응답 형식이 올바르지 않습니다."
        );

      const score = toNumOrNull(dto.score);
      const passed = toBoolOrNull(dto.passed);
      const correctCount = toNumOrNull(dto.correctCount);
      const wrongCount = toNumOrNull(dto.wrongCount);
      const totalCount = toNumOrNull(dto.totalCount);

      if (
        score === null ||
        passed === null ||
        correctCount === null ||
        wrongCount === null ||
        totalCount === null
      ) {
        throw new Error(
          `[EDU_API] submitQuizAnswers: 필수 필드 누락 (score/passed/correctCount/wrongCount/totalCount). ${keysPreview(
            dto
          )}`
        );
      }

      const submittedAt =
        typeof dto.submittedAt === "string" ? dto.submittedAt : undefined;

      return {
        score,
        passed,
        correctCount,
        wrongCount,
        totalCount,
        submittedAt,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getQuizEducationAttempts(
  educationId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizAttemptSummary[]> {
  const candidates = [
    `${EDU_BASE}/quiz/${encodeURIComponent(String(educationId))}/my-attempts`,
    `${EDU_BASE}/quiz/${encodeURIComponent(String(educationId))}/my_attempts`,
    `${EDU_BASE}/quiz/${encodeURIComponent(String(educationId))}/attempts`,
    `${EDU_BASE}/quiz/education/${encodeURIComponent(
      String(educationId)
    )}/my-attempts`,
  ];

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const raw = await eduFetch<unknown>(
        url,
        { method: "GET", signal: init?.signal },
        "GET /quiz/:educationId/my-attempts"
      );

      const list = extractArrayOrThrow<Record<string, unknown>>(
        raw,
        [
          "myAttempts",
          "my_attempts",
          "my-attempts",
          "attempts",
          "items",
          "list",
          "data",
          "result",
        ],
        isAttemptItem,
        "GET /quiz/:educationId/my-attempts"
      );

      return list
        .map((it): QuizAttemptSummary | null => {
          const attemptId = toId(
            it.attemptId ?? it.attempt_id ?? it["attempt-id"]
          );
          const attemptNo = toNumOrNull(
            it.attemptNo ?? it.attempt_no ?? it["attempt-no"]
          );
          const status = typeof it.status === "string" ? it.status : "";
          if (!attemptId || attemptNo === null) return null;

          const score = toNumOrNull(it.score);
          const passed = toBoolOrNull(it.passed);

          const startedAt =
            typeof it.startedAt === "string" ? it.startedAt : undefined;
          const submittedAt =
            typeof it.submittedAt === "string" ? it.submittedAt : undefined;

          return {
            attemptId,
            attemptNo,
            status,
            score: score ?? null,
            passed: passed ?? null,
            startedAt,
            submittedAt,
          };
        })
        .filter((v): v is QuizAttemptSummary => v !== null);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getQuizRetryInfo(
  educationId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizRetryInfo> {
  const candidates = [
    `${EDU_BASE}/quiz/${encodeURIComponent(String(educationId))}/retry-info`,
    `${EDU_BASE}/quiz/${encodeURIComponent(String(educationId))}/retry_info`,
    `${EDU_BASE}/quiz/${encodeURIComponent(String(educationId))}/retry`,
    `${EDU_BASE}/quiz/retry-info/${encodeURIComponent(String(educationId))}`,
  ];

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const raw = await eduFetch<unknown>(
        url,
        { method: "GET", signal: init?.signal },
        "GET /quiz/:educationId/retry-info"
      );

      const dto = unwrapRecord(raw);
      if (!dto)
        throw new Error(
          "[EDU_API] getQuizRetryInfo: 응답 형식이 올바르지 않습니다."
        );

      const canRetry = toBoolOrNull(
        dto.canRetry ?? dto.isRetryable ?? dto.available
      );
      const currentAttemptCount = toNumOrNull(
        dto.currentAttemptCount ??
          dto.current_attempt_count ??
          dto.usedAttempts ??
          dto.used
      );
      const maxAttempts = toNumOrNull(dto.maxAttempts ?? dto.max_attempts);
      const remainingAttempts = toNumOrNull(
        dto.remainingAttempts ?? dto.remaining_attempts ?? dto.left
      );
      const bestScore = toNumOrNull(dto.bestScore ?? dto.best_score);
      const passed = toBoolOrNull(dto.passed);

      if (canRetry === null || currentAttemptCount === null) {
        throw new Error(
          `[EDU_API] getQuizRetryInfo: 필수 필드 누락 (canRetry/currentAttemptCount). ${keysPreview(
            dto
          )}`
        );
      }

      return {
        canRetry,
        currentAttemptCount,
        maxAttempts: maxAttempts ?? null,
        remainingAttempts: remainingAttempts ?? null,
        bestScore: bestScore ?? null,
        passed: passed ?? null,
      };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getQuizWrongs(
  attemptId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizWrongNoteItem[]> {
  const candidates = [
    `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/wrongs`,
    `${EDU_BASE}/quiz/attempts/${encodeURIComponent(String(attemptId))}/wrongs`,
    `${EDU_BASE}/quiz/${encodeURIComponent(String(attemptId))}/wrongs`,
  ];

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const raw = await eduFetch<unknown>(
        url,
        { method: "GET", signal: init?.signal },
        "GET /quiz/attempt/:id/wrongs"
      );

      const list = extractArrayOrThrow<Record<string, unknown>>(
        raw,
        ["wrongs", "wrongList", "items", "list", "data", "result"],
        isWrongItem,
        "GET /quiz/attempt/:id/wrongs"
      );

      return list.map((it) => ({
        question: typeof it.question === "string" ? it.question : "",
        userAnswerIndex:
          toNumOrNull(it.userAnswerIndex ?? it.user_answer_index) ?? -1,
        correctAnswerIndex:
          toNumOrNull(it.correctAnswerIndex ?? it.correct_answer_index) ?? -1,
        explanation: typeof it.explanation === "string" ? it.explanation : "",
        choices: Array.isArray(it.choices)
          ? (it.choices.filter((x) => typeof x === "string") as string[])
          : [],
      }));
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function postQuizLeave(
  attemptId: string | number,
  payload: QuizLeavePayload,
  init?: Pick<RequestInit, "signal" | "keepalive">
): Promise<QuizLeaveResponse | null> {
  const candidates = [
    `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/leave`,
    `${EDU_BASE}/quiz/attempts/${encodeURIComponent(String(attemptId))}/leave`,
    `${EDU_BASE}/quiz/leave/${encodeURIComponent(String(attemptId))}`,
  ];

  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const raw = await eduFetch<unknown>(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: init?.signal,
          keepalive: init?.keepalive,
        },
        "POST /quiz/attempt/:id/leave"
      );

      const dto = unwrapRecord(raw);
      if (!dto) return { recorded: true };

      const recorded = (toBoolOrNull(dto.recorded) ?? true) as boolean;
      const leaveCount = toNumOrNull(dto.leaveCount) ?? undefined;
      const lastLeaveAt =
        typeof dto.lastLeaveAt === "string" ? dto.lastLeaveAt : undefined;

      return { recorded, leaveCount, lastLeaveAt };
    } catch (e) {
      if (isAbortLikeError(e)) throw e;
      lastErr = e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
