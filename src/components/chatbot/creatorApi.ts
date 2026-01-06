// src/components/chatbot/creatorApi.ts

import { fetchJson } from "../common/api/authHttp";
import type {
  CreatorPutScriptPayload,
  CreatorScriptDetail,
  CreatorSourceSetCreatePayload,
  CreatorSourceSetPatchPayload,
} from "./creatorStudioTypes";

type EnvLike = Record<string, string | undefined>;
const ENV = import.meta.env as unknown as EnvLike;

function envStr(key: string, fallback: string): string {
  const v = ENV[key];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return fallback;
}

const EDU_BASE = String(ENV.VITE_EDU_API_BASE ?? "/api-edu").replace(/\/$/, "");
const SCRIPT_BASE = String(ENV.VITE_SCRIPT_API_BASE ?? EDU_BASE).replace(/\/$/, "");

// (컨트롤러와 동일한 기본 엔드포인트 구성)
const ADMIN_EDUS_WITH_VIDEOS_ENDPOINT = envStr(
  "VITE_ADMIN_EDUS_WITH_VIDEOS_ENDPOINT",
  `${EDU_BASE}/admin/edus/with-videos`
);
const ADMIN_EDU_DETAIL_ENDPOINT = envStr(
  "VITE_ADMIN_EDU_DETAIL_ENDPOINT",
  `${EDU_BASE}/admin/edu/{educationId}`
);
const ADMIN_EDU_CREATE_ENDPOINT = envStr(
  "VITE_ADMIN_EDU_CREATE_ENDPOINT",
  `${EDU_BASE}/admin/edu`
);

const ADMIN_VIDEOS_ENDPOINT = envStr("VITE_ADMIN_VIDEOS_ENDPOINT", `${EDU_BASE}/admin/videos`);
const ADMIN_VIDEO_DETAIL_ENDPOINT = envStr(
  "VITE_ADMIN_VIDEO_DETAIL_ENDPOINT",
  `${ADMIN_VIDEOS_ENDPOINT}/{videoId}`
);

// review-request: PUT /admin/videos/{videoId}/review-request + body { stage }
const ADMIN_VIDEO_REVIEW_REQUEST_ENDPOINT = envStr(
  "VITE_ADMIN_VIDEO_REVIEW_REQUEST_ENDPOINT",
  `${ADMIN_VIDEOS_ENDPOINT}/{videoId}/review-request`
);

// video service (user/common)
const VIDEO_GET_ENDPOINT = envStr("VITE_VIDEO_GET_ENDPOINT", `${EDU_BASE}/video/{videoId}`);
const VIDEO_SOURCESET_CREATE_ENDPOINT = envStr(
  "VITE_VIDEO_SOURCESET_CREATE_ENDPOINT",
  `${EDU_BASE}/video/source-sets`
);
const VIDEO_SOURCESET_PATCH_ENDPOINT = envStr(
  "VITE_VIDEO_SOURCESET_PATCH_ENDPOINT",
  `${EDU_BASE}/video/source-sets/{sourceSetId}`
);

const VIDEO_JOB_CREATE_ENDPOINT = envStr("VITE_VIDEO_JOB_CREATE_ENDPOINT", `${EDU_BASE}/video/job`);
const VIDEO_JOB_STATUS_ENDPOINT = envStr(
  "VITE_VIDEO_JOB_STATUS_ENDPOINT",
  `${EDU_BASE}/video/job/{jobId}`
);

// script service
const SCRIPT_LOOKUP_ENDPOINT = envStr("VITE_SCRIPT_LOOKUP_ENDPOINT", `${SCRIPT_BASE}/scripts/lookup`);
const SCRIPT_DETAIL_ENDPOINT = envStr("VITE_SCRIPT_DETAIL_ENDPOINT", `${SCRIPT_BASE}/scripts/{scriptId}`);

// ------------------------------
// Types (minimum shapes)
// ------------------------------

export type AdminEducationDetail = {
  id: string; // educationId 또는 id를 normalize해서 넣는다
  title: string;
  category?: string;
  eduType?: string;
  required?: boolean;
  passScore?: number;
  passRatio?: number;
  startAt?: string | null;
  endAt?: string | null;
  departmentScope?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type AdminVideoSummary = {
  id: string; // videoId 또는 id를 normalize해서 넣는다
  title: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  isPublished?: boolean;
};

export type AdminEducationWithVideosItem = {
  id: string; // educationId 또는 id normalize
  title: string;
  startAt?: string | null;
  endAt?: string | null;
  departmentScope?: string[];
  videos: AdminVideoSummary[];
};

export type VideoDetail = {
  id: string;
  title: string;
  educationId?: string;
  status: string;
  fileUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  isPublished?: boolean;
  scriptId?: string | null;
  jobId?: string | null;
  thumbnailUrl?: string | null;
  scriptText?: string | null;
};

// ------------------------------
// Helpers (no any)
// ------------------------------

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function readStr(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function readNum(obj: unknown, key: string): number | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function readBool(obj: unknown, key: string): boolean | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "boolean" ? v : undefined;
}

function readArr(obj: unknown, key: string): unknown[] | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return Array.isArray(v) ? v : undefined;
}

function pickId(obj: unknown, keys: string[]): string | null {
  if (!isRecord(obj)) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function jsonBody(body: unknown): RequestInit {
  return {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function expandEndpoint(tpl: string, params: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(params)) {
    out = out.replaceAll(`{${k}}`, encodeURIComponent(v));
    out = out.replaceAll(`:${k}`, encodeURIComponent(v));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => globalThis.setTimeout(r, ms));
}

function extractHttpStatus(err: unknown): number | null {
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    const s1 = anyErr["status"];
    if (typeof s1 === "number" && Number.isFinite(s1)) return s1;

    const resp = anyErr["response"];
    if (resp && typeof resp === "object") {
      const s2 = (resp as Record<string, unknown>)["status"];
      if (typeof s2 === "number" && Number.isFinite(s2)) return s2;
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/HTTP\s+(\d{3})/i);
  if (m) return Number(m[1]);
  return null;
}

async function safeFetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const MAX_ATTEMPTS = 3;

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return (await fetchJson(url, init)) as unknown as T;
    } catch (e) {
      lastErr = e;

      const status = extractHttpStatus(e);
      if ((status === 401 || status === 403) && attempt < MAX_ATTEMPTS) {
        await sleep(250 * attempt);
        continue;
      }
      throw e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "요청 실패"));
}

function normalizeEducationDetail(raw: unknown): AdminEducationDetail {
  const id =
    pickId(raw, ["educationId", "id"]) ??
    (isRecord(raw) && isRecord(raw["data"]) ? pickId(raw["data"], ["educationId", "id"]) : null) ??
    "";

  const title =
    readStr(raw, "title") ??
    (isRecord(raw) && isRecord(raw["data"]) ? readStr(raw["data"], "title") : undefined) ??
    "";

  // departmentScope는 JSON string으로 올 수 있음 (스펙: docs/education_api_spec.md 2.1, 2.2)
  const deptScopeRaw = isRecord(raw) ? raw["departmentScope"] : undefined;
  let departmentScope: string[] = [];
  
  if (typeof deptScopeRaw === "string" && deptScopeRaw.trim()) {
    // JSON string인 경우 파싱
    try {
      const parsed = JSON.parse(deptScopeRaw);
      departmentScope = Array.isArray(parsed) 
        ? parsed.filter(x => typeof x === "string" && x.trim().length > 0)
        : [];
    } catch {
      // 파싱 실패 시 빈 배열
      departmentScope = [];
    }
  } else if (Array.isArray(deptScopeRaw)) {
    // 이미 배열인 경우 (호환성)
    departmentScope = deptScopeRaw
      .map((x) => (typeof x === "string" ? x : ""))
      .filter(Boolean);
  }

  return {
    id,
    title,
    category: readStr(raw, "category"),
    eduType: readStr(raw, "eduType"),
    required: readBool(raw, "required"),
    passScore: readNum(raw, "passScore"),
    passRatio: readNum(raw, "passRatio"),
    startAt: (readStr(raw, "startAt") ?? null) as string | null,
    endAt: (readStr(raw, "endAt") ?? null) as string | null,
    departmentScope,
    createdAt: readStr(raw, "createdAt"),
    updatedAt: readStr(raw, "updatedAt"),
  };
}

function normalizeVideoSummary(raw: unknown): AdminVideoSummary | null {
  const id = pickId(raw, ["videoId", "id"]);
  if (!id) return null;

  return {
    id,
    title: readStr(raw, "title") ?? "",
    status: readStr(raw, "status") ?? readStr(raw, "videoStatus") ?? "DRAFT",
    createdAt: readStr(raw, "createdAt"),
    updatedAt: readStr(raw, "updatedAt"),
    isPublished: readBool(raw, "isPublished"),
  };
}

function normalizeVideoDetail(raw: unknown, fallbackVideoId: string): VideoDetail {
  const id = pickId(raw, ["videoId", "id"]) ?? fallbackVideoId;

  return {
    id,
    title: readStr(raw, "title") ?? "",
    educationId: readStr(raw, "educationId") ?? readStr(raw, "eduId"),
    status: readStr(raw, "status") ?? readStr(raw, "videoStatus") ?? "DRAFT",
    fileUrl: (readStr(raw, "fileUrl") ?? readStr(raw, "videoUrl") ?? null) as string | null,
    thumbnailUrl: (readStr(raw, "thumbnailUrl") ?? null) as string | null,
    createdAt: readStr(raw, "createdAt"),
    updatedAt: readStr(raw, "updatedAt"),
    isPublished: readBool(raw, "isPublished"),
    scriptId: (readStr(raw, "scriptId") ?? null) as string | null,
    jobId: (readStr(raw, "jobId") ?? null) as string | null,
    scriptText: (readStr(raw, "scriptText") ?? readStr(raw, "script") ?? null) as string | null,
  };
}

// ------------------------------
// Education(Admin)
// ------------------------------

export async function adminCreateEducation(payload: {
  title: string;
  category: string;
  eduType: "MANDATORY" | "JOB" | "ETC";
  required: boolean;
  passScore?: number;
  passRatio?: number;
  startAt?: string;
  endAt?: string;
  departmentScope?: string[];
}): Promise<AdminEducationDetail> {
  const raw = await safeFetchJson<unknown>(ADMIN_EDU_CREATE_ENDPOINT, {
    method: "POST",
    ...jsonBody(payload),
  });
  return normalizeEducationDetail(raw);
}

export async function adminGetEducation(educationId: string): Promise<AdminEducationDetail> {
  const url = expandEndpoint(ADMIN_EDU_DETAIL_ENDPOINT, { educationId });
  const raw = await safeFetchJson<unknown>(url, { method: "GET" });
  return normalizeEducationDetail(raw);
}

export async function adminGetEducationsWithVideos(params?: {
  status?: string;
}): Promise<AdminEducationWithVideosItem[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);

  const url = `${ADMIN_EDUS_WITH_VIDEOS_ENDPOINT}${qs.toString() ? `?${qs.toString()}` : ""}`;
  const raw = await safeFetchJson<unknown>(url, { method: "GET" });

  // 응답이 배열 또는 {items|educations} 형태일 수 있으므로 흡수
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw["items"])
      ? (raw["items"] as unknown[])
      : isRecord(raw) && Array.isArray(raw["educations"])
        ? (raw["educations"] as unknown[])
        : [];

  const out: AdminEducationWithVideosItem[] = [];

  for (const node of list) {
    if (!isRecord(node)) continue;

    const eduId = pickId(node, ["educationId", "eduId", "id"]) ?? "";
    if (!eduId) continue;

    const videosRaw = readArr(node, "videos") ?? readArr(node, "videoList") ?? [];
    const videos: AdminVideoSummary[] = (Array.isArray(videosRaw) ? videosRaw : [])
      .map(normalizeVideoSummary)
      .filter((v): v is AdminVideoSummary => Boolean(v));

    // departmentScope는 JSON string으로 올 수 있음 (스펙: docs/education_api_spec.md 2.1, 2.2)
    const deptScopeRaw = node["departmentScope"] ?? node["deptIds"];
    let departmentScope: string[] = [];
    
    if (typeof deptScopeRaw === "string" && deptScopeRaw.trim()) {
      // JSON string인 경우 파싱
      try {
        const parsed = JSON.parse(deptScopeRaw);
        departmentScope = Array.isArray(parsed) 
          ? parsed.filter(x => typeof x === "string" && x.trim().length > 0)
          : [];
      } catch {
        // 파싱 실패 시 빈 배열
        departmentScope = [];
      }
    } else if (Array.isArray(deptScopeRaw)) {
      // 이미 배열인 경우 (호환성)
      departmentScope = deptScopeRaw
        .map((x) => (typeof x === "string" ? x : ""))
        .filter(Boolean);
    }

    out.push({
      id: eduId,
      title: readStr(node, "title") ?? readStr(node, "eduTitle") ?? "교육",
      startAt: (readStr(node, "startAt") ?? null) as string | null,
      endAt: (readStr(node, "endAt") ?? null) as string | null,
      departmentScope,
      videos,
    });
  }

  return out;
}

// ------------------------------
// Video(Admin/User)
// ------------------------------

export async function adminCreateVideo(payload: {
  // 호환: educationId 또는 eduId 둘 다 허용
  educationId?: string;
  eduId?: string;

  title: string;

  templateId?: string;
  departmentScope?: string[];
  targetDeptIds?: string[];
  isMandatory?: boolean;
  jobTrainingId?: string;
}): Promise<{ id: string }> {
  const educationId = (payload.educationId ?? payload.eduId ?? "").trim();
  if (!educationId) throw new Error("adminCreateVideo: educationId가 필요합니다.");

  // 백엔드 API 문서 기준: POST /admin/videos
  // 필수: educationId, title
  // 선택: departmentScope
  const body: Record<string, unknown> = {
    educationId,
    title: payload.title,
  };

  // 백엔드 API 문서에 정의된 필드만 전송
  if (payload.departmentScope && payload.departmentScope.length > 0) {
    body.departmentScope = payload.departmentScope;
  }

  const raw = await safeFetchJson<unknown>(ADMIN_VIDEOS_ENDPOINT, {
    method: "POST",
    ...jsonBody(body),
  });

  const id =
    pickId(raw, ["videoId", "id"]) ??
    (isRecord(raw) && isRecord(raw["data"]) ? pickId(raw["data"], ["videoId", "id"]) : null) ??
    (isRecord(raw) && isRecord(raw["video"]) ? pickId(raw["video"], ["videoId", "id"]) : null);

  if (!id) throw new Error("영상 생성 응답에서 video id를 찾지 못했습니다.");
  return { id };
}

export async function adminGetVideo(videoId: string): Promise<VideoDetail> {
  const url = expandEndpoint(ADMIN_VIDEO_DETAIL_ENDPOINT, { videoId });
  const raw = await safeFetchJson<unknown>(url, { method: "GET" });
  return normalizeVideoDetail(raw, videoId);
}

export async function getVideo(videoId: string): Promise<VideoDetail> {
  const url = expandEndpoint(VIDEO_GET_ENDPOINT, { videoId });
  const raw = await safeFetchJson<unknown>(url, { method: "GET" });
  return normalizeVideoDetail(raw, videoId);
}

/**
 * 검토 요청
 * - 백엔드 API 문서 기준: PUT /admin/videos/{videoId}/review-request (Body 없음)
 * - 백엔드가 현재 상태를 보고 자동으로 다음 상태로 전환
 *   - SCRIPT_READY → SCRIPT_REVIEW_REQUESTED (1차)
 *   - READY → FINAL_REVIEW_REQUESTED (2차)
 */
export async function requestVideoReview(videoId: string): Promise<void> {
  const url = expandEndpoint(ADMIN_VIDEO_REVIEW_REQUEST_ENDPOINT, { videoId });
  
  // 백엔드 API 문서 기준: Body 없음
  await safeFetchJson(url, {
    method: "PUT",
  });
}

// ------------------------------
// Source Set (SCRIPT 생성 트리거)
// ------------------------------

/**
 * 설계안: POST /video/source-sets
 * body: { title, domain?, documentIds[], educationId, videoId }
 *
 * 백엔드 구현 편차(eduId)를 흡수하기 위해 educationId + eduId를 함께 보냅니다.
 */
export async function createSourceSet(payload: CreatorSourceSetCreatePayload): Promise<{ id: string }> {
  const educationId = payload.educationId?.trim();
  if (!educationId) throw new Error("createSourceSet: educationId가 필요합니다.");
  if (!payload.videoId?.trim()) throw new Error("createSourceSet: videoId가 필요합니다.");
  if (!payload.title?.trim()) throw new Error("createSourceSet: title이 필요합니다.");
  if (!Array.isArray(payload.documentIds) || payload.documentIds.length === 0) {
    throw new Error("createSourceSet: documentIds가 필요합니다.");
  }

  const body: Record<string, unknown> = {
    title: payload.title,
    domain: payload.domain,
    documentIds: payload.documentIds,
    educationId: educationId,
    // 호환
    eduId: educationId,
    videoId: payload.videoId,
  };

  const raw = await safeFetchJson<unknown>(VIDEO_SOURCESET_CREATE_ENDPOINT, {
    method: "POST",
    ...jsonBody(body),
  });

  const id =
    pickId(raw, ["sourceSetId", "id"]) ??
    (isRecord(raw) && isRecord(raw["data"]) ? pickId(raw["data"], ["sourceSetId", "id"]) : null) ??
    (isRecord(raw) && isRecord(raw["sourceSet"]) ? pickId(raw["sourceSet"], ["sourceSetId", "id"]) : null) ??
    "";

  return { id };
}

/**
 * 설계안: PATCH /video/source-sets/{sourceSetId}
 * body: { addDocumentIds?:[], removeDocumentIds?:[] }
 */
export async function patchSourceSet(sourceSetId: string, payload: CreatorSourceSetPatchPayload): Promise<void> {
  const sid = sourceSetId.trim();
  if (!sid) throw new Error("patchSourceSet: sourceSetId가 필요합니다.");

  const url = expandEndpoint(VIDEO_SOURCESET_PATCH_ENDPOINT, { sourceSetId: sid });

  const body: Record<string, unknown> = {};
  if (payload.addDocumentIds && payload.addDocumentIds.length > 0) body.addDocumentIds = payload.addDocumentIds;
  if (payload.removeDocumentIds && payload.removeDocumentIds.length > 0)
    body.removeDocumentIds = payload.removeDocumentIds;

  await safeFetchJson(url, { method: "PATCH", ...jsonBody(body) });
}

// ------------------------------
// Script
// ------------------------------

/**
 * 설계안: GET /scripts/lookup?videoId=...
 * - 백엔드가 educationId까지 받는 구현도 있을 수 있어 optional로 허용
 */
export async function lookupScript(params: { videoId: string; educationId?: string }): Promise<string | null> {
  const qs = new URLSearchParams();
  qs.set("videoId", params.videoId);
  if (params.educationId) qs.set("educationId", params.educationId);

  const url = `${SCRIPT_LOOKUP_ENDPOINT}${SCRIPT_LOOKUP_ENDPOINT.includes("?") ? "&" : "?"}${qs.toString()}`;
  const raw = await safeFetchJson<unknown>(url, { method: "GET" });

  const direct = pickId(raw, ["scriptId", "id"]);
  if (direct) return direct;

  const nested = isRecord(raw) ? raw["script"] : undefined;
  if (nested && isRecord(nested)) {
    return pickId(nested, ["scriptId", "id"]);
  }

  return null;
}

export async function getScript(scriptId: string): Promise<CreatorScriptDetail> {
  const sid = scriptId?.trim() ?? "";
  if (!sid || sid.length === 0) {
    throw new Error("getScript: scriptId가 필요합니다.");
  }
  const url = expandEndpoint(SCRIPT_DETAIL_ENDPOINT, { scriptId: sid });
  return safeFetchJson<CreatorScriptDetail>(url, { method: "GET" });
}

/**
 * PUT /scripts/{scriptId}
 * - 1) chapters 전체 교체 payload
 * - 2) 또는 string(script/rawPayload) payload
 */
export async function putScript(scriptId: string, payload: CreatorPutScriptPayload): Promise<CreatorScriptDetail> {
  const sid = scriptId?.trim() ?? "";
  if (!sid || sid.length === 0) {
    throw new Error("putScript: scriptId가 필요합니다.");
  }
  const url = expandEndpoint(SCRIPT_DETAIL_ENDPOINT, { scriptId: sid });

  // payload 형태에 따라 그대로 전송 (설계안/구현 편차 흡수)
  return safeFetchJson<CreatorScriptDetail>(url, {
    method: "PUT",
    ...jsonBody(payload),
  });
}

// ------------------------------
// Video Job
// ------------------------------

export async function startVideoJob(payload: {
  // 호환: educationId 또는 eduId
  educationId?: string;
  eduId?: string;

  videoId: string;
  scriptId: string;
}): Promise<string> {
  const eduId = (payload.eduId ?? payload.educationId ?? "").trim();
  if (!eduId) throw new Error("startVideoJob: eduId가 필요합니다.");

  // 백엔드 API 문서 기준: POST /video/job
  // 필수: eduId, scriptId, videoId
  const raw = await safeFetchJson<unknown>(VIDEO_JOB_CREATE_ENDPOINT, {
    method: "POST",
    ...jsonBody({
      eduId,
      scriptId: payload.scriptId,
      videoId: payload.videoId,
    }),
  });

  const jobId =
    pickId(raw, ["jobId", "id"]) ??
    (isRecord(raw) && isRecord(raw["data"]) ? pickId(raw["data"], ["jobId", "id"]) : null);

  if (!jobId) throw new Error("영상 생성 job 응답에서 jobId를 찾지 못했습니다.");
  return jobId;
}

export async function getVideoJob(jobId: string): Promise<unknown> {
  const url = expandEndpoint(VIDEO_JOB_STATUS_ENDPOINT, { jobId });
  return safeFetchJson<unknown>(url, { method: "GET" });
}
