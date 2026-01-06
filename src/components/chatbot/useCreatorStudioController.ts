// src/components/chatbot/useCreatorStudioController.ts

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CategoryOption,
  CreatorTabId,
  CreatorType,
  CreatorValidationResult,
  CreatorWorkItem,
  CreatorSortMode,
  DepartmentOption,
  CreatorSourceFile,
  PipelineStage,
  JobTrainingOption,
  VideoTemplateOption,
} from "./creatorStudioTypes";

import {
  CREATOR_CATEGORIES,
  CREATOR_DEPARTMENTS,
  CREATOR_JOB_TRAININGS,
  CREATOR_VIDEO_TEMPLATES,
  categoryLabel,
  deptLabel,
  formatDateTime,
  jobTrainingLabel,
  labelStatus,
  templateLabel,
  getCategoryKind,
  isJobCategory,
} from "./creatorStudioCatalog";

// 공용 auth fetch (Authorization 포함)
import { fetchJson } from "../common/api/authHttp";
import keycloak from "../../keycloak";

type ToastKind = "success" | "error" | "info";

export interface CreatorToast {
  kind: ToastKind;
  message: string;
}

export interface UseCreatorStudioControllerOptions {
  creatorName?: string;

  /**
   * 제작자 타입 (P0: DEPT_CREATOR는 범위 제한)
   * - 미지정 시 allowedDeptIds 존재 여부로 추정 (있으면 DEPT_CREATOR, 없으면 GLOBAL_CREATOR)
   */
  creatorType?: CreatorType;

  /**
   * DEPT_CREATOR 시나리오를 위해 "허용 부서"를 주입할 수 있게 둠.
   * - 미지정이면 전부서 허용
   */
  allowedDeptIds?: string[] | null;
}

/**
 * Script Editor Target
 * - educationId → lookup(최신 video) → scriptId 확정 → editor로 전달
 * - editor가 videoId를 필요로 하는 경우를 대비해 videoId를 optional로 포함
 */
export type CreatorScriptEditorTarget = {
  open: boolean;
  educationId: string | null;
  videoId: string | null;
  scriptId: string | null;
  loading: boolean;
  error: string | null;
};

type EnvLike = Record<string, string | undefined>;
const ENV = import.meta.env as unknown as EnvLike;

function envStr(key: string, fallback: string): string {
  const v = ENV[key];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return fallback;
}

const EDU_BASE = String(ENV.VITE_EDU_API_BASE ?? "/api-edu").replace(/\/$/, "");
const SCRIPT_BASE = String(ENV.VITE_SCRIPT_API_BASE ?? EDU_BASE).replace(
  /\/$/,
  ""
);
const INFRA_BASE = String(ENV.VITE_INFRA_API_BASE ?? "/api-infra").replace(
  /\/$/,
  ""
);
const RAG_BASE = String(ENV.VITE_RAG_API_BASE ?? INFRA_BASE).replace(/\/$/, "");

/**
 * Creator Studio “실 API” 기본값 (env로 오버라이드 가능)
 * - 목록: /admin/edus/with-videos
 * - video 생성/수정/삭제/검토요청: /admin/videos...
 * - 영상 파이프라인:
 *    - 소스셋 생성: POST /video/source-sets  (documents → sourceset)
 *    - 영상 생성 job: POST /video/job, GET /video/job/{jobId}
 * - 스크립트:
 *    - lookup: GET /scripts/lookup?educationId=&videoId=
 */
const ADMIN_EDUS_WITH_VIDEOS_ENDPOINT = envStr(
  "VITE_ADMIN_EDUS_WITH_VIDEOS_ENDPOINT",
  `${EDU_BASE}/admin/edus/with-videos`
);

// “교육 목록(with-videos)”은 admin 경로/비-admin 경로가 섞여 있는 팀이 많아서
// 1) 새 env(VITE_EDU_WITH_VIDEOS_ENDPOINT) 우선
// 2) 없으면 기존 env(VITE_ADMIN_EDUS_WITH_VIDEOS_ENDPOINT) 사용
// 3) 그래도 실패하면 fallback 후보들을 순차 시도
const EDU_WITH_VIDEOS_ENDPOINT = envStr(
  "VITE_EDU_WITH_VIDEOS_ENDPOINT",
  ADMIN_EDUS_WITH_VIDEOS_ENDPOINT
);
const EDU_WITH_VIDEOS_FALLBACK_ENDPOINTS: string[] = [
  `${EDU_BASE}/admin/educations/with-videos`,
  `${EDU_BASE}/admin/edus/with-videos`,
  `${EDU_BASE}/educations/with-videos`,
  `${EDU_BASE}/edus/with-videos`,
];

const ADMIN_EDU_DETAIL_ENDPOINT = envStr(
  "VITE_ADMIN_EDU_DETAIL_ENDPOINT",
  `${EDU_BASE}/admin/edu/{educationId}`
);

const ADMIN_VIDEOS_ENDPOINT = envStr(
  "VITE_ADMIN_VIDEOS_ENDPOINT",
  `${EDU_BASE}/admin/videos`
);

// “드래프트 생성”도 백엔드마다 /admin/videos /videos 등으로 갈리는 경우가 있어
// 1) 새 env(VITE_CREATOR_DRAFT_CREATE_ENDPOINT) 우선
// 2) 없으면 기존 env(VITE_ADMIN_VIDEOS_ENDPOINT) 사용
// 3) 그래도 실패하면 fallback 후보들을 순차 시도
const CREATOR_DRAFT_CREATE_ENDPOINT = envStr(
  "VITE_CREATOR_DRAFT_CREATE_ENDPOINT",
  ADMIN_VIDEOS_ENDPOINT
);
const CREATOR_DRAFT_CREATE_FALLBACK_ENDPOINTS: string[] = [
  `${EDU_BASE}/videos`,
  `${EDU_BASE}/admin/video`,
  `${EDU_BASE}/video`,
];

const ADMIN_VIDEO_DETAIL_ENDPOINT = envStr(
  "VITE_ADMIN_VIDEO_DETAIL_ENDPOINT",
  `${ADMIN_VIDEOS_ENDPOINT}/{videoId}`
);
const ADMIN_VIDEO_REVIEW_REQUEST_ENDPOINT = envStr(
  "VITE_ADMIN_VIDEO_REVIEW_REQUEST_ENDPOINT",
  `${ADMIN_VIDEOS_ENDPOINT}/{videoId}/review-request`
);

// video service endpoints (동일 베이스를 기본으로 둠)
const VIDEO_GET_ENDPOINT = envStr(
  "VITE_VIDEO_GET_ENDPOINT",
  `${EDU_BASE}/video/{videoId}`
);
const VIDEO_SOURCESET_CREATE_ENDPOINT = envStr(
  "VITE_VIDEO_SOURCESET_CREATE_ENDPOINT",
  `${EDU_BASE}/video/source-sets`
);
const VIDEO_JOB_CREATE_ENDPOINT = envStr(
  "VITE_VIDEO_JOB_CREATE_ENDPOINT",
  `${EDU_BASE}/video/job`
);
const VIDEO_JOB_STATUS_ENDPOINT = envStr(
  "VITE_VIDEO_JOB_STATUS_ENDPOINT",
  `${EDU_BASE}/video/job/{jobId}`
);

// script service endpoints
const SCRIPT_LOOKUP_ENDPOINT = envStr(
  "VITE_SCRIPT_LOOKUP_ENDPOINT",
  `${SCRIPT_BASE}/scripts/lookup`
);
const SCRIPT_DETAIL_ENDPOINT = envStr(
  "VITE_SCRIPT_DETAIL_ENDPOINT",
  `${SCRIPT_BASE}/scripts/{scriptId}`
);
const SCRIPT_TEXT_FIELD = envStr("VITE_SCRIPT_TEXT_FIELD", "scriptText");
const SCRIPT_UPDATE_METHOD = envStr("VITE_SCRIPT_UPDATE_METHOD", "PUT"); // PUT or PATCH

// infra presign + rag
const INFRA_PRESIGN_UPLOAD_ENDPOINT = envStr(
  "VITE_INFRA_PRESIGN_UPLOAD_ENDPOINT",
  `${INFRA_BASE}/infra/files/presign/upload`
);
const INFRA_PRESIGN_UPLOAD_PUT_PROXY_ENDPOINT = envStr(
  "VITE_INFRA_PRESIGN_UPLOAD_PUT_PROXY_ENDPOINT",
  `${INFRA_BASE}/infra/files/presign/upload/put`
);
const RAG_DOCUMENT_UPLOAD_ENDPOINT = envStr(
  "VITE_RAG_DOCUMENT_UPLOAD_ENDPOINT",
  `${RAG_BASE}/rag/documents/upload`
);

function expandEndpoint(tpl: string, params: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(params)) {
    out = out.replaceAll(`{${k}}`, encodeURIComponent(v));
    out = out.replaceAll(`:${k}`, encodeURIComponent(v));
  }
  return out;
}

const CREATOR_ALLOWED_SOURCE_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "hwp",
  "hwpx",
];

function isAllowedSourceFileName(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  return CREATOR_ALLOWED_SOURCE_EXTENSIONS.includes(ext);
}

const MAX_SOURCE_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_SOURCE_FILE_NAME_LENGTH = 160;

function sanitizeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? raw;

  let cleaned = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) continue;
    cleaned += ch;
  }

  const trimmed = cleaned.trim();
  return trimmed.slice(0, MAX_SOURCE_FILE_NAME_LENGTH);
}

function validateSourceFile(file: File): {
  ok: boolean;
  name: string;
  size: number;
  mime?: string;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];

  const name = sanitizeFileName(file.name);
  if (name !== file.name)
    warnings.push("파일명에 포함된 특수/제어 문자를 정리했습니다.");

  if (!name) issues.push("파일명이 비어있습니다.");
  if (name.length >= MAX_SOURCE_FILE_NAME_LENGTH)
    warnings.push("파일명이 너무 길어 일부가 잘렸습니다.");

  if (file.size <= 0) issues.push("파일 크기가 0B 입니다.");
  if (file.size > MAX_SOURCE_FILE_SIZE_BYTES)
    issues.push("파일이 너무 큽니다. (최대 50MB)");

  if (!isAllowedSourceFileName(name)) {
    issues.push(
      "지원하지 않는 파일 형식입니다. (PDF/DOC/DOCX/PPT/PPTX/HWP/HWPX)"
    );
  }

  return {
    ok: issues.length === 0,
    name,
    size: file.size,
    mime: file.type || undefined,
    issues,
    warnings,
  };
}

/**
 * 단일 축 정책:
 * - "직무"가 아니면 = 4대(전사 필수) 카테고리로 간주
 */
function isMandatoryByCategory(categoryId: string): boolean {
  return !isJobCategory(categoryId);
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function includesAny(hay: string, needles: string[]): boolean {
  for (const n of needles) {
    if (hay.includes(n)) return true;
  }
  return false;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function sortItems(
  items: CreatorWorkItem[],
  mode: CreatorSortMode
): CreatorWorkItem[] {
  const next = [...items];
  next.sort((a, b) => {
    const av = mode.startsWith("created") ? a.createdAt : a.updatedAt;
    const bv = mode.startsWith("created") ? b.createdAt : b.updatedAt;
    const diff = av - bv;
    return mode.endsWith("asc") ? diff : -diff;
  });
  return next;
}

type ReviewScopeContext = {
  creatorType: CreatorType;
  allowedDeptIds?: string[] | null;
  allDepartmentIds: string[];
};

function isLockedForEdit(item: CreatorWorkItem): boolean {
  return (
    item.status === "REVIEW_PENDING" ||
    item.status === "APPROVED" ||
    item.status === "REJECTED" ||
    item.status === "GENERATING" ||
    item.pipeline.state === "RUNNING"
  );
}

function resetPipeline(
  mode: CreatorWorkItem["pipeline"]["mode"] = "FULL" as CreatorWorkItem["pipeline"]["mode"]
): CreatorWorkItem["pipeline"] {
  return { mode, state: "IDLE", stage: null, progress: 0 };
}

function clearGeneratedAllAssets(
  item: CreatorWorkItem
): CreatorWorkItem["assets"] {
  return {
    ...item.assets,
    script: "",
    videoUrl: "",
    thumbnailUrl: "",
  };
}

function clearVideoAssetsOnly(
  item: CreatorWorkItem
): CreatorWorkItem["assets"] {
  return {
    ...item.assets,
    videoUrl: "",
    thumbnailUrl: "",
  };
}

function makeId(prefix = "CR"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now()
    .toString(36)
    .slice(2, 8)}`;
}

function isVisibleToDeptCreator(
  item: CreatorWorkItem,
  allowedDeptIds: string[] | null
): boolean {
  if (!allowedDeptIds || allowedDeptIds.length === 0) return true;
  if (!item.targetDeptIds || item.targetDeptIds.length === 0) return false;
  return item.targetDeptIds.some((id) => allowedDeptIds.includes(id));
}

function categoryKindText(categoryId: string): string {
  const kind = getCategoryKind(categoryId);
  const job = isJobCategory(categoryId);
  if (job) return `직무 job ${String(kind).toLowerCase()}`;
  return `4대 mandatory ${String(kind).toLowerCase()}`;
}

function getScriptApprovedAt(item: unknown): number | null {
  if (!item || typeof item !== "object") return null;
  const v = (item as Record<string, unknown>)["scriptApprovedAt"];

  if (typeof v === "number" && Number.isFinite(v)) return v > 0 ? v : null;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    const n = Number(s);
    if (Number.isFinite(n)) return n > 0 ? n : null;

    const t = Date.parse(s);
    return Number.isFinite(t) && t > 0 ? t : null;
  }

  return null;
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;

  // 표준 fetch abort
  if (err instanceof DOMException) return err.name === "AbortError";

  // 일부 래퍼(fetchJson 등)가 Error로 감싸거나 message로만 내려주는 케이스 대응
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;

    const msg = (err.message ?? "").toLowerCase();
    if (
      msg.includes("aborterror") ||
      msg.includes("signal is aborted") ||
      msg.includes("aborted") ||
      msg.includes("abort")
    ) {
      return true;
    }

    // Error.cause로 감싸는 케이스까지 추적
    const anyErr = err as unknown as { cause?: unknown };
    if (anyErr.cause && isAbortError(anyErr.cause)) return true;
  }

  // name/message만 있는 plain object 케이스
  if (typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    const name =
      typeof anyErr["name"] === "string" ? (anyErr["name"] as string) : "";
    const msg =
      typeof anyErr["message"] === "string"
        ? (anyErr["message"] as string).toLowerCase()
        : "";
    if (name === "AbortError") return true;
    if (
      msg.includes("signal is aborted") ||
      msg.includes("aborted") ||
      msg.includes("abort")
    )
      return true;
  }

  return false;
}

/* -----------------------------
 * API normalize helpers
 * ----------------------------- */

function readNum(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

function readStr(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function readMetaStrFromItem(
  item: CreatorWorkItem,
  key: string
): string | undefined {
  const v = (item as unknown as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

function readArr(obj: unknown, key: string): unknown[] | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : undefined;
}

function parseTimeLike(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return undefined;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

/**
 * 백엔드 videoStatus → 프론트 CreatorWorkItem.status(legacy) 로 매핑
 *
 * - 1차(SCRIPT) 승인 이후에도 Creator가 “영상 생성” 단계로 진행해야 하므로
 *   SCRIPT_APPROVED / READY / VIDEO_READY 는 legacy status 를 DRAFT로 유지한다.
 * - 최종 승인/게시(PUBLISHED/APPROVED 등)만 APPROVED로 올린다.
 */
function normalizeVideoStatusToLegacyStatus(
  raw: unknown
): CreatorWorkItem["status"] {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!s) return "DRAFT";

  // 명시적인 반려
  if (s.includes("REJECT")) return "REJECTED";

  // 검토 요청/대기
  if (s.includes("REVIEW_REQUEST")) return "REVIEW_PENDING";
  if (s.includes("REVIEW_PENDING")) return "REVIEW_PENDING";
  if (s.includes("REVIEW")) return "REVIEW_PENDING";

  // 실패
  if (s.includes("FAIL") || s === "ERROR") return "FAILED";

  // 진행중
  if (
    s.includes("GENERATING") ||
    s.includes("PROCESSING") ||
    s.includes("RUNNING") ||
    s === "SCRIPT_GENERATING" ||
    s === "VIDEO_GENERATING"
  ) {
    return "GENERATING";
  }

  // 1차 산출물 준비/승인: Creator는 다음 단계(영상 생성) 진행이 필요 → DRAFT로 유지
  if (s === "SCRIPT_READY") return "DRAFT";
  if (s === "SCRIPT_APPROVED") return "DRAFT";

  // 영상 준비(최종 검토 직전): 여전히 Creator 액션(최종 검토 요청 등) 단계 → DRAFT로 유지
  if (s === "READY" || s === "VIDEO_READY" || s.includes("FINAL_READY"))
    return "DRAFT";

  // 최종 승인/게시
  if (s === "PUBLISHED" || s === "DONE" || s === "APPROVED") return "APPROVED";
  if (s.includes("PUBLISH")) return "APPROVED";
  if (s.includes("FINAL_APPROVED")) return "APPROVED";

  // default
  return "DRAFT";
}

function inferPipelineStageFromRawStatus(upper: string): PipelineStage | null {
  if (!upper) return null;

  // 썸네일
  if (upper.includes("THUMB")) return "THUMBNAIL";

  // 완료/게시
  if (upper === "PUBLISHED" || upper === "DONE" || upper === "APPROVED")
    return "DONE";

  // 영상 단계(READY/FINAL도 영상 단계로 간주)
  if (
    upper.includes("VIDEO") ||
    upper === "READY" ||
    upper === "VIDEO_READY" ||
    upper.includes("FINAL")
  ) {
    return "VIDEO";
  }

  // 스크립트 단계
  if (upper.includes("SCRIPT")) return "SCRIPT";

  // 업로드/소스셋/문서 단계
  if (
    upper.includes("UPLOAD") ||
    upper.includes("SOURCE") ||
    upper.includes("DOCUMENT")
  )
    return "UPLOAD";

  return null;
}

function normalizePipelineFromVideoStatus(
  videoStatusRaw: unknown
): CreatorWorkItem["pipeline"] {
  const raw = typeof videoStatusRaw === "string" ? videoStatusRaw.trim() : "";
  const upper = raw.toUpperCase();
  if (!upper) return resetPipeline();

  const stage = inferPipelineStageFromRawStatus(upper);
  const mode: CreatorWorkItem["pipeline"]["mode"] = "FULL";

  if (upper.includes("FAIL") || upper === "ERROR") {
    return { mode, state: "FAILED", stage, progress: 0, rawStage: upper };
  }

  if (
    upper.includes("GENERATING") ||
    upper.includes("PROCESSING") ||
    upper.includes("RUNNING")
  ) {
    return { mode, state: "RUNNING", stage, progress: 0, rawStage: upper };
  }

  // DRAFT 상태는 진행률 0으로 설정 (파일 업로드 후 스크립트 생성 대기 상태)
  if (upper === "DRAFT" || upper === "" || !upper) {
    return {
      mode,
      state: "IDLE",
      stage,
      progress: 0,
      rawStage: upper || "DRAFT",
    };
  }

  // 스크립트 준비/승인: 단계 성공으로 표시(UX 일관성)
  if (upper === "SCRIPT_READY" || upper === "SCRIPT_APPROVED") {
    return {
      mode,
      state: "SUCCESS",
      stage: "SCRIPT",
      progress: 100,
      rawStage: upper,
    };
  }

  // 영상 준비: 단계 성공
  if (
    upper === "READY" ||
    upper === "VIDEO_READY" ||
    upper.includes("FINAL_READY")
  ) {
    return {
      mode,
      state: "SUCCESS",
      stage: "VIDEO",
      progress: 100,
      rawStage: upper,
    };
  }

  // 게시/완료는 성공으로 간주
  if (upper === "PUBLISHED" || upper === "DONE" || upper === "APPROVED") {
    return {
      mode,
      state: "SUCCESS",
      stage: "DONE",
      progress: 100,
      rawStage: upper,
    };
  }

  return { mode, state: "IDLE", stage, progress: 0, rawStage: upper };
}

function normalizeCreatorSourceFilesForItem(
  it: CreatorWorkItem
): CreatorWorkItem {
  const src = Array.isArray(it.assets.sourceFiles)
    ? it.assets.sourceFiles.slice()
    : [];

  if (src.length === 0 && it.assets.sourceFileName) {
    src.push({
      id: `src-legacy-${it.id}`,
      name: it.assets.sourceFileName,
      size: it.assets.sourceFileSize ?? 0,
      mime: it.assets.sourceFileMime ?? "",
      addedAt: it.updatedAt,
    });
  }

  const primary = src[0];

  return {
    ...it,
    assets: {
      ...it.assets,
      sourceFiles: src,
      sourceFileName: primary?.name ?? it.assets.sourceFileName ?? "",
      sourceFileSize: primary ? primary.size : it.assets.sourceFileSize ?? 0,
      sourceFileMime: primary?.mime ?? it.assets.sourceFileMime ?? "",
    },
  };
}

function normalizeCreatorSourceFiles(
  items: CreatorWorkItem[]
): CreatorWorkItem[] {
  return items.map(normalizeCreatorSourceFilesForItem);
}

// 세션 스토리지에 파일 정보 저장/복원 (브라우저 종료 시 자동 정리)
// TODO: 장기적으로는 서버 응답에 파일 정보가 포함되어야 함 (백엔드 협업 필요)
const STORAGE_PREFIX = "creator-source-files";

function getStorageKey(videoId: string): string {
  return `${STORAGE_PREFIX}:${videoId}`;
}

function saveSourceFilesToStorage(
  videoId: string,
  sourceFiles: CreatorSourceFile[],
  sourceFileName: string,
  sourceFileSize: number,
  sourceFileMime: string
): void {
  try {
    const data = {
      sourceFiles,
      sourceFileName,
      sourceFileSize,
      sourceFileMime,
      savedAt: Date.now(),
    };
    // 세션 스토리지 사용 (브라우저 종료 시 자동 정리)
    sessionStorage.setItem(getStorageKey(videoId), JSON.stringify(data));
  } catch {
    // sessionStorage 실패는 조용히 무시
  }
}

function loadSourceFilesFromStorage(videoId: string): {
  sourceFiles: CreatorSourceFile[];
  sourceFileName: string;
  sourceFileSize: number;
  sourceFileMime: string;
} | null {
  try {
    const raw = sessionStorage.getItem(getStorageKey(videoId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const sourceFiles = Array.isArray(parsed.sourceFiles)
      ? parsed.sourceFiles
      : [];
    const sourceFileName =
      typeof parsed.sourceFileName === "string" ? parsed.sourceFileName : "";
    const sourceFileSize =
      typeof parsed.sourceFileSize === "number" ? parsed.sourceFileSize : 0;
    const sourceFileMime =
      typeof parsed.sourceFileMime === "string" ? parsed.sourceFileMime : "";

    // 실제 documentId가 있는 파일만 반환 (레거시나 임시 ID 제외)
    const realFiles = sourceFiles.filter(
      (f: CreatorSourceFile) =>
        f &&
        typeof f === "object" &&
        "id" in f &&
        typeof f.id === "string" &&
        !f.id.startsWith("src-legacy-") &&
        !f.id.startsWith("SRC_TMP")
    );

    if (realFiles.length === 0 && !sourceFileName) return null;

    return {
      sourceFiles: realFiles.length > 0 ? realFiles : sourceFiles,
      sourceFileName,
      sourceFileSize,
      sourceFileMime,
    };
  } catch {
    return null;
  }
}

function removeSourceFilesFromStorage(videoId: string): void {
  try {
    sessionStorage.removeItem(getStorageKey(videoId));
  } catch {
    // sessionStorage 실패는 조용히 무시
  }
}

type EduSummary = {
  educationId: string;
  title: string;
  categoryId: string;
  categoryLabel: string;

  // 부서 범위가 deptIds가 아니라 departmentScope(이름 배열)로 내려오는 케이스 흡수
  targetDeptIds?: string[];
  departmentScope?: string[];

  templateId?: string;
  jobTrainingId?: string;
};

// -----------------------------
// defaults (옵션이 비어 UI가 잠기는 것 방지용)
// -----------------------------
const DEFAULT_TEMPLATE_ID = (
  Array.isArray(CREATOR_VIDEO_TEMPLATES) && CREATOR_VIDEO_TEMPLATES[0]?.id
    ? String(CREATOR_VIDEO_TEMPLATES[0].id)
    : ""
).trim();

const DEFAULT_JOB_TRAINING_ID = (
  Array.isArray(CREATOR_JOB_TRAININGS) && CREATOR_JOB_TRAININGS[0]?.id
    ? String(CREATOR_JOB_TRAININGS[0].id)
    : ""
).trim();

// -----------------------------
// departmentScope helpers
// -----------------------------
function readStrArr(obj: unknown, key: string): string[] | undefined {
  const arr = readArr(obj, key);
  if (!Array.isArray(arr)) return undefined;
  const out = arr
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * departmentScope(부서명 배열) → deptId 배열로 최대한 매핑
 * - 매핑 실패 시: "이름 자체"를 id로 사용 (UI가 비는 것 방지)
 */
function normalizeDepartmentScopeToDeptIds(
  scopeNames: string[] | undefined,
  knownDepts: ReadonlyArray<DepartmentOption>
): string[] {
  if (!scopeNames || scopeNames.length === 0) return [];

  const normalizedNames = scopeNames
    .map((x) => String(x ?? "").trim())
    .filter((x) => x.length > 0);

  // "전체 부서" 포함 → 전사 전체 의미 → deptIds 비움
  const hasAll = normalizedNames.some(
    (n) => n === "전체 부서" || n === "전사" || n.toLowerCase() === "all"
  );
  if (hasAll) return [];

  const byName = new Map<string, string>();
  const knownIds = new Set<string>();

  for (const d of knownDepts) {
    if (!d?.id) continue;
    knownIds.add(d.id);

    const n1 = (d.name ?? "").trim().toLowerCase();
    if (n1) byName.set(n1, d.id);

    const n2 = (deptLabel(d.id) ?? "").trim().toLowerCase();
    if (n2) byName.set(n2, d.id);
  }

  const out: string[] = [];
  for (const raw of normalizedNames) {
    const s = String(raw ?? "").trim();
    if (!s) continue;

    if (knownIds.has(s)) {
      out.push(s);
      continue;
    }

    const mapped = byName.get(s.toLowerCase());
    out.push(mapped ?? s);
  }

  return uniq(out);
}

function lockTargetDeptIdsByEducation(
  desiredTargetDeptIds: string[] | undefined,
  boundEdu: { targetDeptIds?: string[]; departmentScope?: string[] } | null,
  categoryId: string,
  knownDepts: ReadonlyArray<DepartmentOption>
): string[] {
  // 필수(MANDATORY)면 전사 고정
  const cat = String(categoryId ?? "")
    .trim()
    .toUpperCase();
  if (cat === "MANDATORY") return [];

  if (!boundEdu)
    return Array.isArray(desiredTargetDeptIds) ? desiredTargetDeptIds : [];

  // 1) education.targetDeptIds 우선
  if (
    Array.isArray(boundEdu.targetDeptIds) &&
    boundEdu.targetDeptIds.length > 0
  ) {
    return [...boundEdu.targetDeptIds];
  }

  // 2) departmentScope(부서명 배열) 매핑
  const scopeNames = Array.isArray(boundEdu.departmentScope)
    ? boundEdu.departmentScope
    : [];
  if (scopeNames.length > 0) {
    const mapped = normalizeDepartmentScopeToDeptIds(scopeNames, knownDepts);
    // scope에 '전체 부서'가 있으면 mapped는 [] (전사 전체) → 그대로 OK
    if (mapped.length > 0) return mapped;
    if (scopeNames.some((n) => String(n).trim() === "전체 부서")) return [];
  }

  return Array.isArray(desiredTargetDeptIds) ? desiredTargetDeptIds : [];
}

function toDepartmentScopeNamesFromIds(
  deptIds: string[] | undefined,
  knownDepts: ReadonlyArray<DepartmentOption>
): string[] {
  if (!deptIds || deptIds.length === 0) return [];

  const byId = new Map<string, string>();
  for (const d of knownDepts) {
    if (d?.id) byId.set(d.id, (d.name ?? deptLabel(d.id) ?? d.id).trim());
  }

  return deptIds
    .map((id) => (byId.get(id) ?? deptLabel(id) ?? id).trim())
    .filter(Boolean);
}

function deriveDepartmentOptionsFromEducations(
  edus: EduSummary[]
): DepartmentOption[] {
  const known = (CREATOR_DEPARTMENTS as DepartmentOption[]) ?? [];

  const idsFromTarget = uniq(
    edus
      .flatMap((e) => (Array.isArray(e.targetDeptIds) ? e.targetDeptIds : []))
      .filter(Boolean)
  );

  const idsFromScope = uniq(
    edus
      .flatMap((e) =>
        Array.isArray(e.departmentScope) ? e.departmentScope : []
      )
      .filter(Boolean)
  );

  // scope(이름)도 deptId로 최대한 변환
  const mappedScopeIds = normalizeDepartmentScopeToDeptIds(idsFromScope, known);

  const all = uniq([...idsFromTarget, ...mappedScopeIds]).filter(
    (x) => String(x).trim().length > 0
  );

  // id→name(알 수 없으면 id 그대로)
  const byId = new Map<string, string>();
  for (const d of known) {
    if (!d?.id) continue;
    byId.set(d.id, (d.name ?? deptLabel(d.id) ?? d.id).trim());
  }

  return all.map(
    (id) =>
      ({ id, name: byId.get(id) ?? deptLabel(id) ?? id } as DepartmentOption)
  );
}

function normalizeAllowedDeptIds(
  rawAllowed: string[] | null | undefined,
  baseDepts: ReadonlyArray<DepartmentOption>
): string[] | null {
  if (!rawAllowed || rawAllowed.length === 0) return null;

  const byName = new Map<string, string>();
  const knownIds = new Set<string>();

  for (const d of baseDepts) {
    if (!d?.id) continue;
    knownIds.add(d.id);
    const n = (d.name ?? "").trim().toLowerCase();
    if (n) byName.set(n, d.id);
  }

  const out: string[] = [];
  for (const raw of rawAllowed) {
    const s = String(raw ?? "").trim();
    if (!s) continue;

    if (knownIds.has(s)) out.push(s);
    else {
      const mapped = byName.get(s.toLowerCase());
      out.push(mapped ?? s); // 못 찾으면 그대로(이름을 id로 쓰는 케이스도 지원)
    }
  }

  return uniq(out);
}

function unwrapArrayLike(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const items = (raw as Record<string, unknown>)["items"];
    if (Array.isArray(items)) return items;
    const educations = (raw as Record<string, unknown>)["educations"];
    if (Array.isArray(educations)) return educations;
  }
  return [];
}

function deriveCategoryOptionsFromEducations(
  edus: EduSummary[]
): CategoryOption[] {
  const out: CategoryOption[] = edus
    .filter((e) => Boolean(e.categoryId))
    .map(
      (e) =>
        ({
          id: e.categoryId,
          name: e.categoryLabel || e.categoryId,
        } as CategoryOption)
    );
  return uniqBy(out, (x) => x.id);
}

function deriveTemplateOptionsFromData(
  edus: EduSummary[],
  vids: CreatorWorkItem[]
): VideoTemplateOption[] {
  const ids = uniq(
    [
      ...edus.map((e) => e.templateId ?? ""),
      ...vids.map((v) => v.templateId ?? ""),
    ].filter((x) => typeof x === "string" && x.trim().length > 0)
  );

  return ids.map(
    (id) => ({ id, name: templateLabel(id) ?? id } as VideoTemplateOption)
  );
}

function deriveJobTrainingOptionsFromData(
  edus: EduSummary[],
  vids: CreatorWorkItem[]
): JobTrainingOption[] {
  const ids = uniq(
    [
      ...edus.map((e) => e.jobTrainingId ?? ""),
      ...vids.map((v) => v.jobTrainingId ?? ""),
    ].filter((x) => typeof x === "string" && x.trim().length > 0)
  );

  return ids.map(
    (id) => ({ id, name: jobTrainingLabel(id) ?? id } as JobTrainingOption)
  );
}

function buildIdNameMap<T extends { id: string; name: string }>(
  arr: ReadonlyArray<T>
): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of arr) {
    if (!it?.id) continue;
    m.set(it.id, it.name ?? it.id);
  }
  return m;
}

function pickLatestVideoFromList(videos: unknown[]): unknown | null {
  if (!videos || videos.length === 0) return null;

  let best = videos[0];
  let bestUpdated =
    parseTimeLike((best as Record<string, unknown>)?.["updatedAt"]) ?? 0;
  let bestCreated =
    parseTimeLike((best as Record<string, unknown>)?.["createdAt"]) ?? 0;

  for (let i = 1; i < videos.length; i++) {
    const it = videos[i];
    const u =
      parseTimeLike((it as Record<string, unknown>)?.["updatedAt"]) ?? 0;
    const c =
      parseTimeLike((it as Record<string, unknown>)?.["createdAt"]) ?? 0;
    if (u > bestUpdated || (u === bestUpdated && c >= bestCreated)) {
      best = it;
      bestUpdated = u;
      bestCreated = c;
    }
  }

  return best;
}

function normalizeCreatorWorkItemFromEduVideoPair(
  edu: EduSummary,
  videoRaw: unknown,
  fallbackCreatorName: string
): CreatorWorkItem | null {
  if (!videoRaw || typeof videoRaw !== "object") return null;

  const videoId = readStr(videoRaw, "videoId") ?? readStr(videoRaw, "id");
  if (!videoId) return null;

  const videoStatusRaw =
    readStr(videoRaw, "status") ?? readStr(videoRaw, "videoStatus") ?? "DRAFT";
  const reviewStage = readStr(videoRaw, "reviewStage") ?? "";

  // reviewStage가 "1차 반려" 또는 "2차 반려"로 나오면 반려 상태로 설정
  const status =
    reviewStage === "1차 반려" || reviewStage === "2차 반려"
      ? "REJECTED"
      : normalizeVideoStatusToLegacyStatus(videoStatusRaw);

  const createdAt =
    parseTimeLike((videoRaw as Record<string, unknown>)["createdAt"]) ??
    Date.now();
  const updatedAt =
    parseTimeLike((videoRaw as Record<string, unknown>)["updatedAt"]) ??
    createdAt;

  const title = readStr(videoRaw, "title") ?? edu.title ?? "새 교육 콘텐츠";
  const createdByName =
    readStr(videoRaw, "createdByName") ??
    readStr(videoRaw, "creatorName") ??
    fallbackCreatorName;

  // 템플릿: 비어있으면 DEFAULT로 채워서 드롭다운 공백/저장 실패를 줄임
  const templateId = (
    readStr(videoRaw, "templateId") ??
    readStr(videoRaw, "videoTemplateId") ??
    edu.templateId ??
    DEFAULT_TEMPLATE_ID ??
    ""
  ).trim();

  const rawJobTraining =
    readStr(videoRaw, "jobTrainingId") ??
    readStr(videoRaw, "trainingId") ??
    edu.jobTrainingId ??
    "";

  // ✅ 필수 여부는 "카테고리 단일 축"으로만 결정 (서버 required/mandatory 무시)
  const isMandatory = isMandatoryByCategory(edu.categoryId);

  // dept ids 우선
  const deptIdsRaw =
    readArr(videoRaw, "targetDeptIds") ??
    readArr(videoRaw, "deptIds") ??
    edu.targetDeptIds ??
    [];

  const fromIds = (Array.isArray(deptIdsRaw) ? deptIdsRaw : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);

  // dept scope(부서명) fallback
  const scopeNames =
    readStrArr(videoRaw, "departmentScope") ??
    readStrArr(videoRaw, "deptScope") ??
    readStrArr(videoRaw, "departmentScopes") ??
    edu.departmentScope ??
    [];

  const knownDepts = (CREATOR_DEPARTMENTS as DepartmentOption[]) ?? [];
  const fromScope = normalizeDepartmentScopeToDeptIds(scopeNames, knownDepts);

  // mandatory(4대)면 전사 고정 → dept 비움
  const targetDeptIds = isMandatory
    ? []
    : uniq(fromIds.length > 0 ? fromIds : fromScope);

  // 직무 카테고리만 jobTrainingId 사용, 4대(필수)는 항상 undefined
  const jobTrainingId = isJobCategory(edu.categoryId)
    ? (rawJobTraining.trim() || DEFAULT_JOB_TRAINING_ID || "").trim() ||
      undefined
    : undefined;

  const fileUrl =
    readStr(videoRaw, "fileUrl") ?? readStr(videoRaw, "videoUrl") ?? "";
  const thumbnailUrl = readStr(videoRaw, "thumbnailUrl") ?? "";

  const scriptPreview =
    readStr(videoRaw, "scriptText") ?? readStr(videoRaw, "script") ?? "";
  const upperStatus = String(videoStatusRaw ?? "").toUpperCase();

  // 1차 승인 시간: 서버가 안 주는 케이스도 있어 status로 보정
  let scriptApprovedAt =
    parseTimeLike((videoRaw as Record<string, unknown>)["scriptApprovedAt"]) ??
    parseTimeLike((videoRaw as Record<string, unknown>)["approvedAt"]) ??
    undefined;

  // READY, VIDEO_READY 상태는 이미 1차 승인이 완료된 상태이므로 scriptApprovedAt 설정
  // (서버가 timestamp를 보내주지 않는 경우를 대비)
  if (
    !scriptApprovedAt &&
    (upperStatus === "SCRIPT_APPROVED" ||
      upperStatus === "READY" ||
      upperStatus === "VIDEO_READY")
  ) {
    // 서버가 timestamp를 누락하면 updatedAt을 최소 보정값으로 사용
    // 단, READY 상태는 영상 생성 완료 후 상태이므로 createdAt을 사용 (더 정확한 시간)
    scriptApprovedAt =
      upperStatus === "READY" || upperStatus === "VIDEO_READY"
        ? createdAt
        : updatedAt;
  }

  const failedReason =
    readStr(videoRaw, "failedReason") ??
    readStr(videoRaw, "errorMessage") ??
    undefined;

  // rejectedComment와 rejectedStage 필드 확인
  const rejectedComment = readStr(videoRaw, "rejectedComment") ?? undefined;
  const rejectedStage =
    (readStr(videoRaw, "rejectedStage") as CreatorWorkItem["rejectedStage"]) ??
    undefined;

  // rejectedComment나 rejectedStage가 있으면 status를 "REJECTED"로 설정
  const finalStatus =
    (rejectedComment && rejectedComment.trim().length > 0) || rejectedStage
      ? "REJECTED"
      : status;

  // 서버 응답에서 sourceFiles 배열 읽기 (있는 경우)
  const sourceFilesRaw =
    readArr(videoRaw, "sourceFiles") ?? readArr(videoRaw, "attachments") ?? [];
  const sourceFileName = readStr(videoRaw, "sourceFileName") ?? "";
  const sourceFileSize = readNum(videoRaw, "sourceFileSize") ?? 0;
  const sourceFileMime = readStr(videoRaw, "sourceFileMime") ?? "";

  // 서버 응답에서 documentId 또는 documentIds 읽기
  const documentId =
    readStr(videoRaw, "documentId") ??
    readStr(videoRaw, "sourceDocumentId") ??
    "";
  const documentIds =
    readArr(videoRaw, "documentIds") ??
    readArr(videoRaw, "sourceDocumentIds") ??
    [];

  // sourceFiles 재구성
  let sourceFiles: CreatorSourceFile[] = [];

  // 1. 서버가 sourceFiles 배열을 제공한 경우
  if (Array.isArray(sourceFilesRaw) && sourceFilesRaw.length > 0) {
    sourceFiles = sourceFilesRaw
      .map((f): CreatorSourceFile | null => {
        if (!f || typeof f !== "object") return null;
        const id = readStr(f, "id") ?? readStr(f, "documentId") ?? "";
        const name = readStr(f, "name") ?? readStr(f, "fileName") ?? "";
        const size = readNum(f, "size") ?? readNum(f, "sizeBytes") ?? 0;
        const mime = readStr(f, "mime") ?? readStr(f, "mimeType") ?? undefined;
        if (!id || !name) return null;
        return {
          id,
          name,
          size,
          mime,
          addedAt:
            parseTimeLike((f as Record<string, unknown>)["addedAt"]) ??
            parseTimeLike((f as Record<string, unknown>)["uploadedAt"]) ??
            updatedAt,
        };
      })
      .filter((f): f is CreatorSourceFile => f !== null);
  }

  // 2. sourceFiles가 없고 documentId/documentIds가 있는 경우
  if (sourceFiles.length === 0 && (documentId || documentIds.length > 0)) {
    const ids = documentId
      ? [documentId]
      : Array.isArray(documentIds)
      ? documentIds.map((x) => (typeof x === "string" ? x : ""))
      : [];
    const validIds = ids.filter((id) => id.trim().length > 0);

    if (validIds.length > 0 && sourceFileName) {
      // documentId가 있고 sourceFileName이 있으면 sourceFiles 재구성
      sourceFiles = validIds.map((id) => ({
        id: id.trim(),
        name: sourceFileName,
        size: sourceFileSize,
        mime: sourceFileMime || undefined,
        addedAt: updatedAt,
      }));
    }
  }

  const item: CreatorWorkItem = {
    id: videoId,
    educationId: edu.educationId,
    version: readNum(videoRaw, "version") ?? 1,
    versionHistory: (readArr(videoRaw, "versionHistory") ??
      []) as CreatorWorkItem["versionHistory"],
    title,
    categoryId: edu.categoryId,
    categoryLabel: edu.categoryLabel,
    templateId,
    jobTrainingId: jobTrainingId || undefined,
    isMandatory,
    targetDeptIds,
    status: finalStatus,
    createdAt,
    updatedAt,
    createdByName,
    assets: {
      sourceFiles,
      sourceFileName,
      sourceFileSize,
      sourceFileMime,
      script: scriptPreview,
      videoUrl: fileUrl,
      thumbnailUrl,
    },
    pipeline: normalizePipelineFromVideoStatus(videoStatusRaw),
    failedReason,
    rejectedComment,
    reviewStage: (() => {
      const rawReviewStage = readStr(videoRaw, "reviewStage") ?? "";
      // "1차 반려" 또는 "2차 반려"를 적절한 ReviewStage로 변환
      if (rawReviewStage === "1차 반려") return "SCRIPT";
      if (rawReviewStage === "2차 반려") return "FINAL";
      return (rawReviewStage as CreatorWorkItem["reviewStage"]) || undefined;
    })(),
    rejectedStage: (() => {
      // reviewStage가 "1차 반려" 또는 "2차 반려"이면 rejectedStage 설정
      const rawReviewStage = readStr(videoRaw, "reviewStage") ?? "";
      if (rawReviewStage === "1차 반려") return "SCRIPT";
      if (rawReviewStage === "2차 반려") return "FINAL";
      return rejectedStage;
    })(),
    scriptApprovedAt: scriptApprovedAt || undefined,
  };

  const meta = item as unknown as Record<string, unknown>;
  meta["educationId"] = edu.educationId;
  meta["videoStatusRaw"] = String(videoStatusRaw ?? "");
  meta["jobId"] = readStr(videoRaw, "jobId") ?? undefined;
  meta["scriptId"] =
    readStr(videoRaw, "scriptId") ??
    readStr((videoRaw as Record<string, unknown>)["script"], "id") ??
    undefined;

  // departmentScope만 보관(필수 여부 관련 메타는 제거)
  meta["departmentScope"] = toDepartmentScopeNamesFromIds(
    targetDeptIds,
    knownDepts
  );

  return normalizeCreatorSourceFilesForItem(item);
}

function normalizeEduWithVideosResponse(
  raw: unknown,
  fallbackCreatorName: string
): {
  educations: EduSummary[];
  videos: CreatorWorkItem[];
} {
  const arr = unwrapArrayLike(raw);
  const educations: EduSummary[] = [];
  const videos: CreatorWorkItem[] = [];

  for (const node of arr) {
    if (!node || typeof node !== "object") continue;

    const eduId =
      readStr(node, "educationId") ??
      readStr(node, "eduId") ??
      readStr(node, "id");
    const videosArr =
      readArr(node, "videos") ?? readArr(node, "videoList") ?? [];

    // Case A) education with videos
    if (eduId && Array.isArray(videosArr) && videosArr.length >= 0) {
      const categoryId =
        readStr(node, "categoryId") ?? readStr(node, "categoryCode") ?? "C001";
      const eduTitle = readStr(node, "title") ?? "교육";
      const edu: EduSummary = {
        educationId: eduId,
        title: eduTitle,
        categoryId,
        categoryLabel:
          readStr(node, "categoryLabel") ??
          readStr(node, "categoryName") ??
          categoryLabel(categoryId),

        targetDeptIds: (
          readArr(node, "targetDeptIds") ??
          readArr(node, "deptIds") ??
          []
        )
          .map((x) => (typeof x === "string" ? x : ""))
          .filter((x) => x.trim().length > 0),

        departmentScope:
          readStrArr(node, "departmentScope") ??
          readStrArr(node, "deptScope") ??
          readStrArr(node, "departmentScopes") ??
          undefined,

        templateId:
          readStr(node, "templateId") ??
          readStr(node, "videoTemplateId") ??
          undefined,
        jobTrainingId:
          readStr(node, "jobTrainingId") ??
          readStr(node, "trainingId") ??
          undefined,
      };

      educations.push(edu);

      const vids = Array.isArray(videosArr) ? videosArr : [];
      for (const v of vids) {
        const it = normalizeCreatorWorkItemFromEduVideoPair(
          edu,
          v,
          fallbackCreatorName
        );
        if (it) videos.push(it);
      }
      continue;
    }

    // Case B) already flattened video item
    const videoId = readStr(node, "videoId") ?? readStr(node, "id");
    const educationId = readStr(node, "educationId") ?? readStr(node, "eduId");
    if (videoId && educationId) {
      const categoryId = readStr(node, "categoryId") ?? "C001";
      const edu: EduSummary = {
        educationId,
        title:
          readStr(node, "eduTitle") ??
          readStr(node, "educationTitle") ??
          "교육",
        categoryId,
        categoryLabel:
          readStr(node, "categoryLabel") ?? categoryLabel(categoryId),
        templateId: readStr(node, "templateId") ?? undefined,
        jobTrainingId: readStr(node, "jobTrainingId") ?? undefined,
      };

      const it = normalizeCreatorWorkItemFromEduVideoPair(
        edu,
        node,
        fallbackCreatorName
      );
      if (it) videos.push(it);
    }
  }

  return { educations: uniqBy(educations, (e) => e.educationId), videos };
}

function uniqBy<T>(arr: T[], keyFn: (v: T) => string): T[] {
  const m = new Map<string, T>();
  for (const it of arr) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, it);
  }
  return Array.from(m.values());
}

type KeycloakLike = {
  token?: string;
  authenticated?: boolean;
  updateToken?: (minValiditySeconds: number) => Promise<boolean>;
};

async function tryGetBearerToken(
  minValiditySeconds = 30
): Promise<string | null> {
  const kc = keycloak as unknown as KeycloakLike;

  try {
    if (typeof kc.updateToken === "function") {
      await kc.updateToken(minValiditySeconds);
    }
  } catch {
    // token refresh 실패는 무시 (fallback fetch는 토큰 없이도 시도 가능)
  }

  const t = kc.token;
  return typeof t === "string" && t.trim().length > 0 ? t.trim() : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function extractHttpStatus(err: unknown): number | null {
  // authHttp(fetchJson)가 status를 붙여 던지는 구현도 있으니 최대한 흡수
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

function compactPayload(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim().length === 0) continue;
    out[k] = v;
  }
  return out;
}

type AdminUpdateOrder = "PUT_THEN_PATCH" | "PATCH_THEN_PUT";

const ADMIN_UPDATE_ORDER = envStr(
  "VITE_ADMIN_UPDATE_ORDER",
  "PUT_THEN_PATCH"
).toUpperCase() as AdminUpdateOrder;

async function patchOrPutJson(
  url: string,
  body: Record<string, unknown>
): Promise<void> {
  const payload = JSON.stringify(body);

  const FALLBACK_STATUSES = new Set([405, 415, 500, 501]);

  const first: "PUT" | "PATCH" =
    ADMIN_UPDATE_ORDER === "PATCH_THEN_PUT" ? "PATCH" : "PUT";
  const second: "PUT" | "PATCH" = first === "PATCH" ? "PUT" : "PATCH";

  const call = async (method: "PUT" | "PATCH") => {
    await safeFetchJson(url, {
      method,
      headers: { "content-type": "application/json" },
      body: payload,
    });
  };

  try {
    await call(first);
    return;
  } catch (e1) {
    const status1 = extractHttpStatus(e1);

    // method 미지원/게이트웨이 변환 실패/내부에러 등에만 2차 시도
    if (status1 != null && FALLBACK_STATUSES.has(status1)) {
      await call(second);
      return;
    }

    // status를 못 뽑는 래퍼 예외 케이스(특히 PATCH-first일 때 PUT로 살릴 수 있는 경우가 많음)
    if (status1 == null && first === "PATCH") {
      await call("PUT");
      return;
    }

    throw e1;
  }
}

async function patchOrPutJsonCompat(args: {
  url: string;
  compatBody: Record<string, unknown>;
  strictBody?: Record<string, unknown>;
  tolerateStatuses?: number[];
}): Promise<void> {
  const tolerate = new Set(args.tolerateStatuses ?? [400, 404, 422]);

  // compatBody가 비어있으면 아무것도 하지 않음
  if (!args.compatBody || Object.keys(args.compatBody).length === 0) return;

  try {
    await patchOrPutJson(args.url, args.compatBody);
  } catch (e) {
    const st = extractHttpStatus(e);

    // video endpoint가 unknown field를 거절하는 등 "호환 실패"는 무시하거나 strict로 재시도
    if (st != null && tolerate.has(st)) {
      if (args.strictBody && Object.keys(args.strictBody).length > 0) {
        await patchOrPutJson(args.url, args.strictBody);
      }
      return;
    }

    // 그 외는 진짜 실패로 간주
    throw e;
  }
}

async function safeFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const MAX_ATTEMPTS = 3;

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // 1) 기본: 공용 authHttp(fetchJson)로 시도
      return (await fetchJson(url, init)) as unknown as T;
    } catch (err) {
      lastErr = err;

      // Abort는 그대로 전파
      if (isAbortError(err)) throw err;

      const status = extractHttpStatus(err);

      // 401/403은 "초기 인증 준비 / 토큰 갱신 타이밍"에서 흔하게 1~2번 튀는 케이스라 재시도
      if ((status === 401 || status === 403) && attempt < MAX_ATTEMPTS) {
        await sleep(250 * attempt);
        continue;
      }

      // fetchJson이 "HTTP xxx" 형태로 이미 던진 케이스도
      // 401/403이 아니면 즉시 종료(중복 요청 방지)
      const msg = err instanceof Error ? err.message : String(err);
      if (/HTTP\s+\d{3}/i.test(msg)) throw err;

      // 2) “요청 전에” 죽는 케이스 fallback: native fetch
      const token = await tryGetBearerToken();

      const headers = new Headers(init?.headers ?? undefined);
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const res = await fetch(url, { ...init, headers });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const tail = text ? ` - ${text.slice(0, 200)}` : "";
        const e2 = new Error(`HTTP ${res.status} ${res.statusText}${tail}`);

        if (
          (res.status === 401 || res.status === 403) &&
          attempt < MAX_ATTEMPTS
        ) {
          await sleep(250 * attempt);
          continue;
        }

        throw e2;
      }

      if (res.status === 204) return undefined as unknown as T;

      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) return (await res.json()) as T;

      // 일부 서버가 text로 주는 케이스 흡수
      const t = await res.text();
      return t as unknown as T;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr ?? "요청 실패"));
}

function dedupUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const s = String(u ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * ✅ 교육 목록(with-videos) 조회
 * - /api-edu/... 경로가 팀/환경별로 달라서 후보 endpoint를 순차 시도
 */
async function getEducationsWithVideos(args?: {
  signal?: AbortSignal;
}): Promise<unknown> {
  const endpoints = dedupUrls([
    EDU_WITH_VIDEOS_ENDPOINT,
    ...EDU_WITH_VIDEOS_FALLBACK_ENDPOINTS,
  ]);

  let lastErr: unknown = null;

  for (const url of endpoints) {
    try {
      return await safeFetchJson<unknown>(url, {
        method: "GET",
        signal: args?.signal,
      });
    } catch (e) {
      lastErr = e;
      const st = extractHttpStatus(e);

      // “경로가 없어서” 실패하는 케이스만 다음 후보로 진행
      if (st === 404 || st === 405) continue;

      // 401/403/400/500 등은 “진짜 실패”로 보고 즉시 중단
      throw e;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("교육 목록(with-videos) endpoint를 찾지 못했습니다.");
}

/**
 * ✅ educationId 포함해서 DRAFT 생성
 * - 1차: videos 계열 endpoint로 생성 시도
 * - 2차: (videos가 아예 없을 때만) source-sets로 fallback 시도
 */
async function createDraftForEducation(args: {
  educationId: string;
  title?: string;
  templateId?: string;
  departmentScope?: string[]; // 교육의 departmentScope를 전달할 수 있도록 추가
  signal?: AbortSignal;
}): Promise<{ videoId: string | null; raw: unknown }> {
  const educationId = String(args.educationId ?? "").trim();
  if (!educationId)
    throw new Error("createDraftForEducation: educationId가 비었습니다.");

  const title = (args.title ?? "새 교육 콘텐츠").trim();

  const endpoints = dedupUrls([
    CREATOR_DRAFT_CREATE_ENDPOINT,
    ...CREATOR_DRAFT_CREATE_FALLBACK_ENDPOINTS,
  ]);

  let lastErr: unknown = null;

  // ✅ (A) videos endpoint로 DRAFT 생성
  for (const url of endpoints) {
    try {
      const payload = compactPayload({
        // 핵심: educationId 반드시 포함
        educationId,
        eduId: educationId, // 호환 alias
        title,

        // 템플릿을 받는 서버도 있고(필수), 없어도 되는 서버도 있어서 "값 있을 때만"
        templateId: args.templateId || undefined,
        videoTemplateId: args.templateId || undefined, // alias

        // 백엔드 API 문서 기준: departmentScope는 optional이지만, 교육 정보가 있으면 전달
        departmentScope:
          Array.isArray(args.departmentScope) && args.departmentScope.length > 0
            ? args.departmentScope
            : undefined,

        // 상태를 받는 서버가 있으면 도움이 되고, 거절하면 compactPayload로 빠짐
        status: "DRAFT",
      });

      const created = await safeFetchJson<unknown>(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: args.signal,
      });

      const videoId =
        (created &&
          typeof created === "object" &&
          (readStr(created, "videoId") ?? readStr(created, "id"))) ||
        null;

      return {
        videoId: typeof videoId === "string" ? videoId.trim() : null,
        raw: created,
      };
    } catch (e) {
      lastErr = e;
      const st = extractHttpStatus(e);

      // “경로가 없어서” 실패하는 케이스만 다음 후보로 진행
      if (st === 404 || st === 405) continue;

      // 400/401/403/500 등은 스펙/권한/검증 문제 → 즉시 중단(원인 숨기지 않음)
      throw e;
    }
  }

  // ✅ (B) videos endpoint가 “아예 없다”면 source-sets로 DRAFT 생성 fallback
  // - 일부 백엔드는 source-sets 생성 시 video를 같이 만들기도 해서 여기로 구제
  try {
    const created = await safeFetchJson<unknown>(
      VIDEO_SOURCESET_CREATE_ENDPOINT,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          compactPayload({
            // 핵심: educationId 반드시 포함
            educationId,
            eduId: educationId, // alias
            title,

            // 서버가 optional로 받을 수도 있어 빈 배열로라도 넣어 둠(거절하면 400으로 드러남)
            documentIds: [],

            // 서버가 요구하는 케이스가 있어 기본값 제공(거절하면 400으로 드러남)
            domain: "JOB_TRAINING",
          })
        ),
        signal: args.signal,
      }
    );

    const videoId =
      (created &&
        typeof created === "object" &&
        (readStr(created, "videoId") ?? readStr(created, "id"))) ||
      null;

    return {
      videoId: typeof videoId === "string" ? videoId.trim() : null,
      raw: created,
    };
  } catch (e2) {
    // 마지막 실패는 마지막 에러를 던져 디버깅 가능하게
    throw (lastErr ?? e2) as unknown;
  }
}

function pickMostRecentVideoIdForEducation(
  educationId: string,
  items: CreatorWorkItem[]
): string | null {
  const target = items.filter(
    (it) => String(it.educationId ?? "").trim() === educationId
  );
  if (target.length === 0) return null;

  let best = target[0];
  for (let i = 1; i < target.length; i++) {
    const it = target[i];
    const bu = best.updatedAt ?? 0;
    const iu = it.updatedAt ?? 0;
    if (iu > bu) best = it;
  }
  return best.id ?? null;
}

/* -----------------------------
 * educationId → lookup → 최신 videoId → scriptId 확정
 * ----------------------------- */

function pickVideoIdFromEduDetail(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;

  const direct =
    readStr(raw, "latestVideoId") ??
    readStr(raw, "videoId") ??
    readStr((raw as Record<string, unknown>)["latestVideo"], "videoId") ??
    readStr((raw as Record<string, unknown>)["latestVideo"], "id");
  if (direct && direct.trim().length > 0) return direct.trim();

  const vids = readArr(raw, "videos") ?? readArr(raw, "videoList");
  if (Array.isArray(vids) && vids.length > 0) {
    const best = pickLatestVideoFromList(vids);
    const id = best ? readStr(best, "videoId") ?? readStr(best, "id") : null;
    if (id && id.trim().length > 0) return id.trim();
  }

  return null;
}

function pickScriptIdFromScriptLookup(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;

  const direct = readStr(raw, "scriptId") ?? readStr(raw, "id");
  if (direct && direct.trim().length > 0) return direct.trim();

  const nested = (raw as Record<string, unknown>)["script"];
  if (nested && typeof nested === "object") {
    const nid = readStr(nested, "scriptId") ?? readStr(nested, "id");
    if (nid && nid.trim().length > 0) return nid.trim();
  }

  return null;
}

async function resolveLatestVideoIdForEducation(
  educationId: string,
  signal?: AbortSignal
): Promise<string> {
  const url = expandEndpoint(ADMIN_EDU_DETAIL_ENDPOINT, { educationId });
  const edu = await safeFetchJson<unknown>(url, { method: "GET", signal });
  const vid = pickVideoIdFromEduDetail(edu);
  if (!vid)
    throw new Error("education lookup에서 최신 videoId를 찾지 못했습니다.");
  return vid;
}

async function resolveScriptIdForEducationOrVideo(params: {
  educationId: string;
  videoId?: string | null;
  signal?: AbortSignal;
}): Promise<{ educationId: string; videoId: string; scriptId: string }> {
  const { educationId, signal } = params;

  const videoId =
    (params.videoId && params.videoId.trim().length > 0
      ? params.videoId.trim()
      : null) ?? (await resolveLatestVideoIdForEducation(educationId, signal));

  // scripts lookup: educationId+videoId 모두 전달(백엔드 구현 차이를 흡수)
  const qs = new URLSearchParams({ educationId, videoId }).toString();
  const url = `${SCRIPT_LOOKUP_ENDPOINT}${
    SCRIPT_LOOKUP_ENDPOINT.includes("?") ? "&" : "?"
  }${qs}`;
  const lookup = await safeFetchJson<unknown>(url, { method: "GET", signal });
  const scriptId = pickScriptIdFromScriptLookup(lookup);

  if (!scriptId) {
    throw new Error(
      "scripts/lookup에서 scriptId를 찾지 못했습니다. (소스셋 생성 후 다시 시도해 주세요)"
    );
  }

  return { educationId, videoId, scriptId };
}

/* -----------------------------
 * Infra presign + S3 PUT + RAG register
 * ----------------------------- */

type PresignUploadResponse = {
  uploadUrl?: string;
  fileUrl?: string;
  url?: string; // 일부 구현
  key?: string;
};

type RagUploadResponse = {
  documentId?: string;
  id?: string;
};

async function requestPresignUpload(args: {
  fileName: string;
  contentType?: string;
  size?: number;
  signal?: AbortSignal;
}): Promise<{ uploadUrl: string; fileUrl: string }> {
  const res = await safeFetchJson<unknown>(INFRA_PRESIGN_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      type: "docs",
    }),
    signal: args.signal,
  });

  const r = (res ?? {}) as PresignUploadResponse;
  const uploadUrl = (r.uploadUrl ?? r.url ?? "").trim();
  const fileUrl = (r.fileUrl ?? "").trim();

  if (!uploadUrl || !fileUrl) {
    throw new Error(
      "Presign 응답 형식이 올바르지 않습니다. (uploadUrl/fileUrl 누락)"
    );
  }

  return { uploadUrl, fileUrl };
}

function putToS3DirectWithProgress(args: {
  uploadUrl: string;
  file: File;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", args.uploadUrl, true);

    // presigned PUT은 Authorization 등 커스텀 헤더 금지
    if (args.file.type) xhr.setRequestHeader("Content-Type", args.file.type);

    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const pct = Math.round((evt.loaded / evt.total) * 100);
      args.onProgress?.(clamp(pct, 0, 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 direct PUT 실패 (HTTP ${xhr.status})`));
    };

    xhr.onerror = () => reject(new Error("S3 direct PUT 네트워크/CORS 오류"));
    xhr.onabort = () => reject(new Error("S3 direct PUT 중단"));

    if (args.signal) {
      if (args.signal.aborted) xhr.abort();
      else
        args.signal.addEventListener("abort", () => xhr.abort(), {
          once: true,
        });
    }

    xhr.send(args.file);
  });
}

async function putToS3ViaProxy(args: {
  uploadUrl: string;
  file: File;
  signal?: AbortSignal;
}): Promise<void> {
  // 서버 프록시가 presigned URL로 PUT을 대행
  const qs = new URLSearchParams({ url: args.uploadUrl }).toString();
  const url = `${INFRA_PRESIGN_UPLOAD_PUT_PROXY_ENDPOINT}${
    INFRA_PRESIGN_UPLOAD_PUT_PROXY_ENDPOINT.includes("?") ? "&" : "?"
  }${qs}`;

  const token = await tryGetBearerToken();
  const headers = new Headers();

  // 프록시 PUT은 서버로 가는 요청이므로 Authorization 허용
  if (token) headers.set("Authorization", `Bearer ${token}`);

  if (args.file.type) headers.set("Content-Type", args.file.type);

  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: args.file,
    signal: args.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const tail = text ? ` - ${text.slice(0, 200)}` : "";
    throw new Error(`S3 proxy PUT 실패 (HTTP ${res.status})${tail}`);
  }
}

async function putToS3WithFallback(args: {
  uploadUrl: string;
  file: File;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}): Promise<void> {
  try {
    await putToS3DirectWithProgress(args);
  } catch {
    // direct PUT이 막히는 환경(CORS/사내망/네트워크) 대비: proxy로 1회 폴백
    args.onProgress?.(0);
    await putToS3ViaProxy({
      uploadUrl: args.uploadUrl,
      file: args.file,
      signal: args.signal,
    });
    args.onProgress?.(100);
  }
}

async function registerDocumentToRag(args: {
  fileUrl: string;
  fileName: string;
  contentType?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await safeFetchJson<unknown>(RAG_DOCUMENT_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileUrl: args.fileUrl,
      fileName: args.fileName,
      contentType: args.contentType,
    }),
    signal: args.signal,
  });

  const r = (res ?? {}) as RagUploadResponse;
  const docId = (r.documentId ?? r.id ?? "").trim();

  if (!docId)
    throw new Error("RAG 업로드 응답에서 documentId를 찾지 못했습니다.");
  return docId;
}

/* -----------------------------
 * validation
 * ----------------------------- */

function validateForReview(
  item: CreatorWorkItem,
  ctx: ReviewScopeContext,
  mode: "SCRIPT" | "FINAL"
): CreatorValidationResult {
  const issues: string[] = [];

  const isDeptCreator = ctx.creatorType === "DEPT_CREATOR";
  const allowedDeptIds = ctx.allowedDeptIds ?? null;
  const mandatoryCategory = isMandatoryByCategory(item.categoryId);

  if (!item.title || item.title.trim().length < 3)
    issues.push("제목을 3자 이상 입력해주세요.");
  if (!item.categoryId) issues.push("카테고리를 선택해주세요.");
  // 영상 템플릿과 직무교육 필드는 UI에서 숨김 처리되었으므로 검증에서 제외
  // if (!item.templateId) issues.push("영상 템플릿을 선택해주세요.");

  // if (isJobCategory(item.categoryId)) {
  //   if (!item.jobTrainingId) issues.push("직무교육(Training ID)을 선택해주세요.");
  // }

  // 자료 파일: 업로드 + 문서등록(documentId)까지 완료되어야 소스셋 생성 가능
  const srcFiles = Array.isArray(item.assets.sourceFiles)
    ? item.assets.sourceFiles
    : [];
  if (srcFiles.length === 0 || !item.assets.sourceFileName) {
    issues.push("교육 자료 파일을 업로드해주세요.");
  } else if (!isAllowedSourceFileName(item.assets.sourceFileName)) {
    issues.push(
      "교육 자료 파일 형식이 올바르지 않습니다. PDF/DOC/DOCX/PPT/PPTX/HWP/HWPX만 허용됩니다."
    );
  }

  if (
    item.assets.sourceFileSize &&
    item.assets.sourceFileSize > MAX_SOURCE_FILE_SIZE_BYTES
  ) {
    issues.push("교육 자료 파일이 너무 큽니다. (최대 50MB)");
  }

  // script 상태 판단
  const videoStatusRaw = String(
    ((item as unknown as Record<string, unknown>)[
      "videoStatusRaw"
    ] as string) ?? ""
  );
  const stage1Approved = getScriptApprovedAt(item) != null;

  const upper = videoStatusRaw.toUpperCase();
  const scriptReadyByStatus =
    upper === "SCRIPT_READY" ||
    upper === "SCRIPT_APPROVED" ||
    upper === "READY" ||
    upper === "VIDEO_READY" ||
    upper.includes("REVIEW") ||
    upper === "PUBLISHED" ||
    upper === "APPROVED";

  const hasScriptText = Boolean(
    item.assets.script && item.assets.script.trim().length > 0
  );

  if (mode === "SCRIPT") {
    if (!hasScriptText && !scriptReadyByStatus) {
      issues.push(
        "스크립트가 준비되지 않았습니다. (소스셋 생성/스크립트 생성 후 다시 시도)"
      );
    }
  } else {
    // FINAL
    if (!stage1Approved)
      issues.push(
        "1차(스크립트) 승인이 완료되어야 최종 검토 요청이 가능합니다."
      );
    const hasVideo = Boolean(
      item.assets.videoUrl && item.assets.videoUrl.trim().length > 0
    );
    if (!hasVideo) issues.push("영상이 생성되지 않았습니다.");
  }

  if (item.pipeline.state === "RUNNING")
    issues.push("자동 생성이 진행 중입니다. 완료 후 검토 요청이 가능합니다.");
  if (item.pipeline.state === "FAILED")
    issues.push("자동 생성이 실패했습니다. 재시도 후 검토 요청이 가능합니다.");

  if (mandatoryCategory) {
    if (ctx.creatorType === "DEPT_CREATOR") {
      issues.push(
        "부서 제작자는 4대 의무교육(전사 필수) 콘텐츠를 제작할 수 없습니다."
      );
    }
    if (item.targetDeptIds && item.targetDeptIds.length > 0) {
      issues.push("4대 의무교육은 전사 대상으로 고정됩니다.");
    }
  }

  if (isDeptCreator) {
    if (!item.targetDeptIds || item.targetDeptIds.length === 0) {
      issues.push("부서 제작자는 대상 부서를 최소 1개 이상 선택해야 합니다.");
    } else if (allowedDeptIds && allowedDeptIds.length > 0) {
      const invalid = item.targetDeptIds.filter(
        (id) => !allowedDeptIds.includes(id)
      );
      if (invalid.length > 0)
        issues.push("대상 부서에 허용되지 않은 부서가 포함되어 있습니다.");
    }
  }

  return { ok: issues.length === 0, issues };
}

/* -----------------------------
 * tab filter (legacy status 기반)
 *
 * 설계안 반영:
 * - draft 탭은 "작업 진행(스크립트 승인 포함)"을 모두 포함
 * - approved 탭은 "최종 승인/게시"만
 * ----------------------------- */

function tabMatchesStatus(tab: CreatorTabId, item: CreatorWorkItem): boolean {
  switch (tab) {
    case "draft":
      return item.status === "DRAFT" || item.status === "GENERATING";

    case "review_pending":
      return item.status === "REVIEW_PENDING";

    case "rejected":
      return item.status === "REJECTED";

    case "approved":
      return item.status === "APPROVED";

    case "failed":
      return item.status === "FAILED";

    default:
      return true;
  }
}

/* -----------------------------
 * Hook
 * ----------------------------- */

export function useCreatorStudioController(
  options?: UseCreatorStudioControllerOptions
) {
  const creatorName = options?.creatorName ?? "VIDEO_CREATOR";
  const allowedDeptIds = options?.allowedDeptIds ?? null;

  const creatorType: CreatorType =
    options?.creatorType ??
    (allowedDeptIds && allowedDeptIds.length > 0
      ? "DEPT_CREATOR"
      : "GLOBAL_CREATOR");

  const isDeptCreator = creatorType === "DEPT_CREATOR";

  // 서버 로딩
  const [items, setItems] = useState<CreatorWorkItem[]>([]);
  const [educations, setEducations] = useState<EduSummary[]>([]);

  type CreatorCatalogState = {
    categories: CategoryOption[];
    departments: DepartmentOption[];
    templates: VideoTemplateOption[];
    jobTrainings: JobTrainingOption[];
  };

  const [creatorCatalog, setCreatorCatalog] = useState<CreatorCatalogState>(
    () => ({
      categories: ((CREATOR_CATEGORIES as CategoryOption[]) ?? []).slice(),
      departments: ((CREATOR_DEPARTMENTS as DepartmentOption[]) ?? []).slice(),
      templates: (
        (CREATOR_VIDEO_TEMPLATES as VideoTemplateOption[]) ?? []
      ).slice(),
      jobTrainings: (
        (CREATOR_JOB_TRAININGS as JobTrainingOption[]) ?? []
      ).slice(),
    })
  );

  const [selectedEducationId, setSelectedEducationId] = useState<string | null>(
    null
  );

  const [tab, setTab] = useState<CreatorTabId>("draft");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<CreatorSortMode>("updated_desc");
  const [rawSelectedId, setRawSelectedId] = useState<string | null>(null);

  const [toast, setToast] = useState<CreatorToast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // polling
  const pollRef = useRef<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  // list fetch abort
  const listAbortRef = useRef<AbortController | null>(null);

  // 최초 로딩 실패를 silent로 묻지 않기 위한 플래그
  const initLoadDoneRef = useRef(false);

  // script editor abort
  const scriptAbortRef = useRef<AbortController | null>(null);

  // script editor target
  const [scriptEditor, setScriptEditor] = useState<CreatorScriptEditorTarget>({
    open: false,
    educationId: null,
    videoId: null,
    scriptId: null,
    loading: false,
    error: null,
  });

  const clearToastSoon = (ms = 2200) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), ms);
  };

  const showToast = (kind: ToastKind, message: string, ms?: number) => {
    setToast({ kind, message });
    clearToastSoon(ms ?? (kind === "error" ? 3000 : 2200));
  };

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (pollAbortRef.current) {
      pollAbortRef.current.abort();
      pollAbortRef.current = null;
    }
  };

  const derivedDepartments = useMemo<DepartmentOption[]>(
    () => deriveDepartmentOptionsFromEducations(educations),
    [educations]
  );

  const departments = useMemo<DepartmentOption[]>(() => {
    const base =
      derivedDepartments.length > 0
        ? derivedDepartments
        : (CREATOR_DEPARTMENTS as DepartmentOption[]) ?? [];

    const normalizedAllowed = normalizeAllowedDeptIds(
      allowedDeptIds ?? null,
      base
    );
    if (!normalizedAllowed || normalizedAllowed.length === 0) return base;

    const allowSet = new Set(normalizedAllowed);
    return base.filter((d) => allowSet.has(d.id));
  }, [derivedDepartments, allowedDeptIds]);

  // 서버 catalog가 비어있으면: refreshItems로 받은 데이터에서 파생(더미 제거 관점에서 “실데이터 기반”)
  const derivedCategories = useMemo(
    () => deriveCategoryOptionsFromEducations(educations),
    [educations]
  );
  const derivedTemplates = useMemo(
    () => deriveTemplateOptionsFromData(educations, items),
    [educations, items]
  );
  const derivedJobTrainings = useMemo(
    () => deriveJobTrainingOptionsFromData(educations, items),
    [educations, items]
  );

  const allCategories = useMemo<CategoryOption[]>(() => {
    if (derivedCategories.length > 0) return derivedCategories;
    return (CREATOR_CATEGORIES as CategoryOption[]) ?? [];
  }, [derivedCategories]);

  const categories = useMemo<CategoryOption[]>(() => {
    const base = allCategories;
    if (!isDeptCreator) return base;
    // DEPT_CREATOR는 job 카테고리만 노출
    return base.filter((c) => isJobCategory(c.id));
  }, [allCategories, isDeptCreator]);

  const templates = useMemo<ReadonlyArray<VideoTemplateOption>>(() => {
    const base =
      derivedTemplates.length > 0
        ? derivedTemplates
        : CREATOR_VIDEO_TEMPLATES ?? [];
    if (base.length > 0) return base;

    // 최후 fallback: 1개라도 있어야 select가 공백/잠김이 안 생김
    if (DEFAULT_TEMPLATE_ID) {
      return [
        {
          id: DEFAULT_TEMPLATE_ID,
          name: templateLabel(DEFAULT_TEMPLATE_ID) ?? DEFAULT_TEMPLATE_ID,
        },
      ];
    }
    return [];
  }, [derivedTemplates]);

  const jobTrainings = useMemo<ReadonlyArray<JobTrainingOption>>(() => {
    const base =
      derivedJobTrainings.length > 0
        ? derivedJobTrainings
        : CREATOR_JOB_TRAININGS ?? [];
    if (base.length > 0) return base;

    if (DEFAULT_JOB_TRAINING_ID) {
      return [
        {
          id: DEFAULT_JOB_TRAINING_ID,
          name:
            jobTrainingLabel(DEFAULT_JOB_TRAINING_ID) ??
            DEFAULT_JOB_TRAINING_ID,
        },
      ];
    }
    return [];
  }, [derivedJobTrainings]);

  // label lookup (상수 label 함수가 비어 있어도 UI가 안 비게)
  const categoryNameMap = useMemo(
    () => buildIdNameMap(allCategories),
    [allCategories]
  );
  const templateNameMap = useMemo(() => buildIdNameMap(templates), [templates]);
  const jobTrainingNameMap = useMemo(
    () => buildIdNameMap(jobTrainings),
    [jobTrainings]
  );

  const getCategoryName = useCallback(
    (id: string) => categoryNameMap.get(id) ?? categoryLabel(id) ?? id,
    [categoryNameMap]
  );

  const getTemplateName = useCallback(
    (id: string) => templateNameMap.get(id) ?? templateLabel(id) ?? id,
    [templateNameMap]
  );

  const getJobTrainingName = useCallback(
    (id: string) => jobTrainingNameMap.get(id) ?? jobTrainingLabel(id) ?? id,
    [jobTrainingNameMap]
  );

  const ensureTemplateId = (raw?: string | null) => {
    const fallback = templates[0]?.id ?? DEFAULT_TEMPLATE_ID ?? "";
    if (!raw) return fallback;
    return templates.some((t) => t.id === raw) ? raw : fallback;
  };

  const ensureJobTrainingId = (raw?: string | null) => {
    const fallback = jobTrainings[0]?.id ?? DEFAULT_JOB_TRAINING_ID ?? "";
    if (!raw) return fallback;
    return jobTrainings.some((t) => t.id === raw) ? raw : fallback;
  };

  function normalizeJobTrainingIdByCategory(
    categoryId: string,
    raw: string | null | undefined,
    ensure: (v?: string | null) => string
  ): string | undefined {
    if (!isJobCategory(categoryId)) return undefined;
    const ensured = ensure(raw ?? "");
    return ensured || undefined;
  }

  const normalizeTargetDeptIds = (
    rawIds: string[] | undefined,
    categoryId: string
  ) => {
    // 단일 축: mandatory 카테고리는 항상 전사 고정
    if (isMandatoryByCategory(categoryId)) return [];

    const ids = uniq((rawIds ?? []).filter(Boolean));

    if (ids.length === 0) {
      if (!isDeptCreator) return [];
      const first = departments[0]?.id;
      return first ? [first] : [];
    }

    const allDeptSet = new Set(departments.map((d) => d.id));
    let filtered = ids.filter((id) => allDeptSet.has(id));

    if (isDeptCreator && allowedDeptIds && allowedDeptIds.length > 0) {
      const allowedSet = new Set(allowedDeptIds);
      filtered = filtered.filter((id) => allowedSet.has(id));
    }

    if (filtered.length > 0) return filtered;

    if (!isDeptCreator) return [];
    const first = departments[0]?.id;
    return first ? [first] : [];
  };

  const scopeCtx = useMemo(
    () => ({
      creatorType,
      allowedDeptIds,
      allDepartmentIds: departments.map((d) => d.id),
    }),
    [creatorType, allowedDeptIds, departments]
  );

  type VersionEntry = CreatorWorkItem["versionHistory"] extends Array<infer E>
    ? E
    : never;

  const makeVersionEntry = (
    item: CreatorWorkItem,
    reason: string
  ): VersionEntry => {
    const now = Date.now();
    const entry = {
      version: item.version ?? 1,
      status: item.status,
      title: item.title,
      categoryId: item.categoryId,
      templateId: item.templateId,
      jobTrainingId: item.jobTrainingId,
      targetDeptIds: item.targetDeptIds,
      isMandatory: item.isMandatory,
      sourceFileName: item.assets?.sourceFileName ?? "",
      recordedAt: now,
      reason,
    } as unknown as VersionEntry;

    return entry;
  };

  const bumpVersionForRework = (item: CreatorWorkItem, reason: string) => {
    const now = Date.now();
    const prevHistory = Array.isArray(item.versionHistory)
      ? item.versionHistory
      : [];
    const nextHistory = [...prevHistory, makeVersionEntry(item, reason)];

    const nextVersion = (item.version ?? 1) + 1;

    const next: CreatorWorkItem = {
      ...item,
      version: nextVersion,
      versionHistory: nextHistory,
      status: "DRAFT",
      updatedAt: now,
      rejectedComment: undefined,
      failedReason: undefined,
      pipeline: resetPipeline(),
      assets: clearVideoAssetsOnly(item),
      scriptApprovedAt: undefined, // 새 버전 재작업이면 1차 승인 초기화
    };

    // 메타도 함께 정리
    const meta = next as unknown as Record<string, unknown>;
    meta["videoStatusRaw"] = "DRAFT";
    delete meta["jobId"];
    delete meta["scriptId"];
    delete meta["scriptApprovedAt"];

    const mandatoryCategory = isMandatoryByCategory(next.categoryId);

    // 항상 카테고리 기반으로만
    next.isMandatory = mandatoryCategory;

    if (mandatoryCategory) {
      next.targetDeptIds = [];
      next.jobTrainingId = undefined;
    } else if (isDeptCreator) {
      next.targetDeptIds = normalizeTargetDeptIds(
        next.targetDeptIds,
        next.categoryId
      );
    }

    return next;
  };

  const selectedId = useMemo(() => {
    const allowedItems = isDeptCreator
      ? items.filter((it) => isVisibleToDeptCreator(it, allowedDeptIds))
      : items;

    if (allowedItems.length === 0) return null;

    const sorted = sortItems(allowedItems, "updated_desc");
    const byTab = sorted.filter((it) => tabMatchesStatus(tab, it));
    const fallback = (byTab[0] ?? sorted[0] ?? null)?.id ?? null;

    if (!rawSelectedId) return fallback;

    const exists = allowedItems.some((it) => it.id === rawSelectedId);
    if (!exists) return fallback;

    const cur = allowedItems.find((it) => it.id === rawSelectedId) ?? null;
    if (cur && !tabMatchesStatus(tab, cur)) {
      return (byTab[0] ?? null)?.id ?? null;
    }

    return rawSelectedId;
  }, [items, tab, rawSelectedId, isDeptCreator, allowedDeptIds]);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId]
  );

  // 선택된 아이템이 변경될 때 최신 상태 확인 (스웨거에서 직접 완료 처리한 경우 대응)
  useEffect(() => {
    if (!selectedItem || !selectedId) return;

    // scriptId가 있고 스크립트 텍스트가 없으면 스크립트를 로드 (스크립트 생성 완료 후 자동 표시)
    const currentScriptId = readMetaStrFromItem(selectedItem, "scriptId");
    const currentScriptText = selectedItem.assets.script || "";
    const videoStatusRaw = getVideoStatusRawOfItem(selectedItem);
    const upperStatus = String(videoStatusRaw ?? "").toUpperCase();
    const isScriptReady =
      upperStatus === "SCRIPT_READY" || upperStatus === "SCRIPT_APPROVED";

    // scriptId가 있거나 SCRIPT_READY 상태일 때 스크립트 로드 (스웨거로 완료 처리한 경우 대응)
    if (
      isScriptReady &&
      (!currentScriptText || currentScriptText.trim().length === 0)
    ) {
      void (async () => {
        try {
          // scriptId가 없으면 lookup으로 조회
          let scriptIdToLoad = currentScriptId;
          if (!scriptIdToLoad) {
            const educationId = getEducationIdOfItem(selectedItem);
            if (educationId) {
              const resolved = await resolveScriptIdForEducationOrVideo({
                educationId,
                videoId: selectedId,
              });
              if (resolved.scriptId) {
                scriptIdToLoad = resolved.scriptId;
                // scriptId를 메타데이터에 저장
                setItems((prev) =>
                  prev.map((item) => {
                    if (item.id !== selectedId) return item;
                    const updated = { ...item };
                    (updated as unknown as Record<string, unknown>)[
                      "scriptId"
                    ] = resolved.scriptId;
                    return updated;
                  })
                );
              }
            }
          }

          if (!scriptIdToLoad) return;

          const { getScript } = await import("./creatorApi");
          const script = await getScript(scriptIdToLoad);
          // chapters → scenes → narration 또는 caption을 합쳐서 텍스트 추출
          const parts: string[] = [];
          for (const chapter of script.chapters || []) {
            for (const scene of chapter.scenes || []) {
              const text = scene.narration || scene.caption || "";
              if (text.trim()) {
                parts.push(text.trim());
              }
            }
          }
          const extractedText = parts.join("\n\n");

          // 스크립트 텍스트 업데이트
          setItems((prev) =>
            prev.map((item) => {
              if (item.id !== selectedId) return item;
              return {
                ...item,
                assets: {
                  ...item.assets,
                  script: extractedText || item.assets.script || "",
                },
              };
            })
          );
        } catch (err) {
          console.warn(`Failed to fetch script:`, err);
        }
      })();
    }

    // 폴링이 실행 중이 아니면 최신 상태 확인 (스웨거에서 직접 완료 처리한 경우 대응)
    if (!pollRef.current) {
      void (async () => {
        try {
          const url = expandEndpoint(VIDEO_GET_ENDPOINT, {
            videoId: selectedId,
          });
          const raw = await safeFetchJson<unknown>(url, { method: "GET" });

          const statusRaw =
            readStr(raw, "status") ?? readStr(raw, "videoStatus") ?? "";
          const currentStatusRaw = getVideoStatusRawOfItem(selectedItem);
          const upperCurrent = currentStatusRaw.toUpperCase();
          const upperNew = String(statusRaw ?? "").toUpperCase();

          // scriptId 확인 (상태 변경 여부와 관계없이)
          const newScriptId =
            readStr(raw, "scriptId") ??
            readMetaStrFromItem(selectedItem, "scriptId");
          const currentScriptId = readMetaStrFromItem(selectedItem, "scriptId");
          const scriptIdChanged =
            newScriptId && newScriptId !== currentScriptId;

          // 상태가 변경되었거나 scriptId가 변경되었으면 업데이트 (특히 DRAFT → SCRIPT_READY 등)
          if (upperNew !== upperCurrent || scriptIdChanged) {
            const legacy = normalizeVideoStatusToLegacyStatus(statusRaw);
            const pipeline = normalizePipelineFromVideoStatus(statusRaw);

            setItems((prev) =>
              prev.map((it) => {
                if (it.id !== selectedId) return it;

                // sourceFiles 정보 보존 (기존 sourceFiles가 있으면 유지)
                const existingSourceFiles = Array.isArray(it.assets.sourceFiles)
                  ? it.assets.sourceFiles
                  : [];
                const sourceFileName =
                  readStr(raw, "sourceFileName") ??
                  it.assets.sourceFileName ??
                  "";
                const sourceFileSize =
                  readNum(raw, "sourceFileSize") ??
                  it.assets.sourceFileSize ??
                  0;
                const sourceFileMime =
                  readStr(raw, "sourceFileMime") ??
                  it.assets.sourceFileMime ??
                  "";

                const next: CreatorWorkItem = {
                  ...it,
                  status: legacy,
                  pipeline: { ...it.pipeline, ...pipeline },
                  assets: {
                    ...it.assets,
                    // sourceFiles는 기존 것을 유지 (없으면 sourceFileName으로 재생성되도록 normalizeCreatorSourceFilesForItem에서 처리)
                    sourceFiles:
                      existingSourceFiles.length > 0
                        ? existingSourceFiles
                        : it.assets.sourceFiles,
                    sourceFileName:
                      sourceFileName || it.assets.sourceFileName || "",
                    sourceFileSize:
                      sourceFileSize || it.assets.sourceFileSize || 0,
                    sourceFileMime:
                      sourceFileMime || it.assets.sourceFileMime || "",
                    script: readStr(raw, "scriptText") ?? it.assets.script,
                    videoUrl:
                      readStr(raw, "fileUrl") ??
                      readStr(raw, "videoUrl") ??
                      it.assets.videoUrl,
                    thumbnailUrl:
                      readStr(raw, "thumbnailUrl") ?? it.assets.thumbnailUrl,
                  },
                  updatedAt: Date.now(),
                };

                (next as unknown as Record<string, unknown>)["videoStatusRaw"] =
                  String(statusRaw ?? "");
                // scriptId는 위에서 이미 확인했으므로 여기서는 업데이트만
                const finalScriptId =
                  readStr(raw, "scriptId") ??
                  readMetaStrFromItem(it, "scriptId") ??
                  newScriptId;
                if (finalScriptId) {
                  (next as unknown as Record<string, unknown>)["scriptId"] =
                    finalScriptId;
                }

                // scriptId가 있고 스크립트 텍스트가 없으면 스크립트 상세를 조회하여 텍스트 가져오기
                const validScriptId =
                  typeof finalScriptId === "string" &&
                  finalScriptId.trim().length > 0
                    ? finalScriptId.trim()
                    : null;
                if (
                  validScriptId &&
                  (!next.assets.script ||
                    next.assets.script.trim().length === 0)
                ) {
                  void (async () => {
                    try {
                      const { getScript } = await import("./creatorApi");
                      const script = await getScript(validScriptId);
                      // chapters → scenes → narration 또는 caption을 합쳐서 텍스트 추출
                      const parts: string[] = [];
                      for (const chapter of script.chapters || []) {
                        for (const scene of chapter.scenes || []) {
                          const text = scene.narration || scene.caption || "";
                          if (text.trim()) {
                            parts.push(text.trim());
                          }
                        }
                      }
                      const extractedText = parts.join("\n\n");

                      // 스크립트 텍스트 업데이트
                      setItems((prev) =>
                        prev.map((item) => {
                          if (item.id !== selectedId) return item;
                          return {
                            ...item,
                            assets: {
                              ...item.assets,
                              script: extractedText || item.assets.script || "",
                            },
                          };
                        })
                      );
                    } catch (err) {
                      console.warn(
                        `Failed to fetch script ${newScriptId}:`,
                        err
                      );
                    }
                  })();
                }

                // normalizeCreatorSourceFilesForItem을 적용하여 일관성 유지 (sourceFileName이 있으면 sourceFiles 재생성)
                return normalizeCreatorSourceFilesForItem(next);
              })
            );
          }
        } catch {
          // 조용히 무시 (폴링이 곧 처리할 것)
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const filteredItems = useMemo(() => {
    const q = normalizeQuery(query);
    const qTokens = q ? q.split(/\s+/).filter(Boolean) : [];

    const baseAll = items.filter((it) => tabMatchesStatus(tab, it));
    const base = isDeptCreator
      ? baseAll.filter((it) => isVisibleToDeptCreator(it, allowedDeptIds))
      : baseAll;

    const searched =
      qTokens.length === 0
        ? base
        : base.filter((it) => {
            const deptText =
              it.targetDeptIds.length === 0
                ? "전사 전체 all company"
                : it.targetDeptIds.map(deptLabel).join(" ");

            const hay = [
              it.title,

              // getCategoryName 실제 사용 (eslint no-unused-vars 해결 + 데이터 누락 시에도 안전)
              getCategoryName(it.categoryId),
              it.categoryLabel,

              categoryKindText(it.categoryId),
              labelStatus(it.status),
              `v${String(it.version ?? 1)}`,
              deptText,
              it.assets.sourceFileName ?? "",
              formatDateTime(it.updatedAt),

              // useMemo 내부에서 쓰는 함수는 deps에 포함되도록
              getTemplateName(it.templateId),
              it.jobTrainingId ? getJobTrainingName(it.jobTrainingId) : "",
            ]
              .join(" ")
              .toLowerCase();

            return includesAny(hay, qTokens);
          });

    return sortItems(searched, sortMode);
  }, [
    items,
    query,
    sortMode,
    tab,
    isDeptCreator,
    allowedDeptIds,
    getCategoryName,
    getTemplateName,
    getJobTrainingName,
  ]);

  const selectedValidation = useMemo(() => {
    if (!selectedItem)
      return { ok: false, issues: ["선택된 콘텐츠가 없습니다."] };

    const approvedAt = getScriptApprovedAt(selectedItem);
    const mode: "SCRIPT" | "FINAL" = approvedAt != null ? "FINAL" : "SCRIPT";

    return validateForReview(selectedItem, scopeCtx, mode);
  }, [selectedItem, scopeCtx]);

  const selectItem = (id: string) => setRawSelectedId(id);

  /* -----------------------------
   * Server: list/load
   * ----------------------------- */

  const refreshItems = async (opts?: {
    silent?: boolean;
  }): Promise<{
    educations: EduSummary[];
    items: CreatorWorkItem[];
  } | null> => {
    // 이전 요청 중단(최신 요청만 유지)
    listAbortRef.current?.abort();

    const ac = new AbortController();
    listAbortRef.current = ac;

    try {
      const raw = await getEducationsWithVideos({ signal: ac.signal });

      const { educations: edus, videos } = normalizeEduWithVideosResponse(
        raw,
        creatorName
      );

      // 기존 items의 sourceFiles와 script 정보 보존 (로컬에 저장된 파일 정보 유지)
      // items 상태를 직접 참조하여 merged 계산 (setItems 콜백과 동일한 로직)
      // normalizeCreatorSourceFiles 호출 전에 prevMap을 생성하여 기존 파일 정보를 보존
      const prevMap = new Map(items.map((it) => [it.id, it]));

      const normalized = normalizeCreatorSourceFiles(videos);

      // scriptId가 없는 아이템들에 대해 lookup 시도 (스크립트가 생성되었을 수 있음)
      // getEducationIdOfItem과 getVideoStatusRawOfItem은 hook 내부에 정의되어 있으므로
      // 여기서는 직접 메타데이터를 읽어야 함
      const itemsNeedingScriptIdLookup = normalized
        .filter((item) => {
          const scriptId = readMetaStrFromItem(item, "scriptId");
          const educationId =
            readMetaStrFromItem(item, "educationId") ?? item.educationId;
          const videoStatusRaw = (item as unknown as Record<string, unknown>)[
            "videoStatusRaw"
          ] as string | undefined;
          // scriptId가 없고, 스크립트가 생성되었을 수 있는 상태인 경우
          return (
            !scriptId &&
            educationId &&
            videoStatusRaw &&
            (videoStatusRaw === "SCRIPT_READY" ||
              videoStatusRaw === "SCRIPT_GENERATING" ||
              videoStatusRaw === "SCRIPT_APPROVED" ||
              videoStatusRaw === "VIDEO_GENERATING" ||
              videoStatusRaw === "VIDEO_READY")
          );
        })
        .map((item) => ({
          item,
          educationId:
            readMetaStrFromItem(item, "educationId") ?? item.educationId ?? "",
          videoId: item.id,
        }))
        .filter(
          ({ educationId }) => educationId && educationId.trim().length > 0
        );

      // scriptId lookup을 병렬로 수행
      const scriptIdLookupResults = await Promise.allSettled(
        itemsNeedingScriptIdLookup.map(
          async ({ item, educationId, videoId }) => {
            try {
              const resolved = await resolveScriptIdForEducationOrVideo({
                educationId,
                videoId,
                signal: ac.signal,
              });
              return { itemId: item.id, scriptId: resolved.scriptId };
            } catch {
              return { itemId: item.id, scriptId: null };
            }
          }
        )
      );

      // lookup 결과를 맵으로 변환
      const scriptIdMap = new Map<string, string>();
      for (const result of scriptIdLookupResults) {
        if (result.status === "fulfilled" && result.value.scriptId) {
          scriptIdMap.set(result.value.itemId, result.value.scriptId);
        }
      }

      // lookup으로 찾은 scriptId를 아이템에 추가
      const normalizedWithScriptIds = normalized.map((item) => {
        const lookedUpScriptId = scriptIdMap.get(item.id);
        if (lookedUpScriptId) {
          (item as unknown as Record<string, unknown>)["scriptId"] =
            lookedUpScriptId;
        }
        return item;
      });

      const merged = normalizedWithScriptIds.map((newItem) => {
        const prevItem = prevMap.get(newItem.id);

        // prevItem이 없는 경우 (페이지를 처음 열거나 닫았다가 다시 열었을 때)
        // 로컬 스토리지에서 파일 정보 복원 시도
        if (!prevItem) {
          const stored = loadSourceFilesFromStorage(newItem.id);
          if (stored && stored.sourceFiles.length > 0) {
            // 로컬 스토리지에 저장된 파일 정보가 있으면 복원
            const restored: CreatorWorkItem = {
              ...newItem,
              assets: {
                ...newItem.assets,
                sourceFiles: stored.sourceFiles,
                sourceFileName: stored.sourceFileName,
                sourceFileSize: stored.sourceFileSize,
                sourceFileMime: stored.sourceFileMime,
              },
            };
            return normalizeCreatorSourceFilesForItem(restored);
          }
          // 로컬 스토리지에도 없으면 normalizeCreatorSourceFilesForItem 적용
          return normalizeCreatorSourceFilesForItem(newItem);
        }

        // 기존 sourceFiles가 있고 새 아이템의 sourceFiles가 비어있으면 보존
        const prevSourceFiles = Array.isArray(prevItem.assets.sourceFiles)
          ? prevItem.assets.sourceFiles
          : [];
        const newSourceFiles = Array.isArray(newItem.assets.sourceFiles)
          ? newItem.assets.sourceFiles
          : [];

        // 기존 sourceFiles 중 실제 업로드된 파일(레거시가 아닌, 임시 ID가 아닌) 확인
        // SRC_TMP로 시작하는 것은 업로드 진행 중인 임시 파일이므로 제외
        // src-legacy-로 시작하는 것은 서버에서 받은 레거시 파일이므로 제외
        const prevRealSourceFiles = prevSourceFiles.filter(
          (f) =>
            f &&
            typeof f === "object" &&
            "id" in f &&
            typeof f.id === "string" &&
            !f.id.startsWith("src-legacy-") &&
            !f.id.startsWith("SRC_TMP")
        );

        // 새 sourceFiles 중 실제 업로드된 파일(레거시가 아닌, 임시 ID가 아닌) 확인
        const newRealSourceFiles = newSourceFiles.filter(
          (f) =>
            f &&
            typeof f === "object" &&
            "id" in f &&
            typeof f.id === "string" &&
            !f.id.startsWith("src-legacy-") &&
            !f.id.startsWith("SRC_TMP")
        );

        // 기존 script와 scriptId 보존
        const prevScript = prevItem.assets.script || "";
        const prevScriptId = readMetaStrFromItem(prevItem, "scriptId");
        const newScriptId = readMetaStrFromItem(newItem, "scriptId");
        const newScript = newItem.assets.script || "";

        // sourceFiles 보존 여부 확인
        // 기존에 실제 업로드된 파일이 있고, 새 것에는 실제 업로드된 파일이 없으면 보존
        // 서버 응답에 sourceFiles 정보가 없을 수 있으므로, 기존에 실제 파일이 있으면 보존
        // 또는 기존에 sourceFileName이 있고 새 것에는 없으면 보존 (파일이 업로드되었음을 의미)
        const prevHasSourceFileName = Boolean(
          prevItem.assets.sourceFileName &&
            prevItem.assets.sourceFileName.trim().length > 0
        );
        const newHasSourceFileName = Boolean(
          newItem.assets.sourceFileName &&
            newItem.assets.sourceFileName.trim().length > 0
        );
        const shouldPreserveSourceFiles =
          (prevRealSourceFiles.length > 0 && newRealSourceFiles.length === 0) ||
          (prevHasSourceFileName &&
            !newHasSourceFileName &&
            prevRealSourceFiles.length > 0);
        // script 보존 여부 확인 (기존 script가 있으면 항상 보존, 새 것이 없거나 비어있으면 보존)
        // scriptId가 있으면 scriptText도 보존 (스크립트가 생성되었음을 의미)
        const shouldPreserveScript =
          (prevScript.trim().length > 0 || prevScriptId) &&
          (!newScript || newScript.trim().length === 0);

        // scriptApprovedAt 보존: 기존에 1차 승인이 완료된 경우 보존
        // READY, VIDEO_READY 상태는 이미 1차 승인이 완료된 상태이므로 scriptApprovedAt을 보존해야 함
        const prevScriptApprovedAt = prevItem.scriptApprovedAt;
        const newScriptApprovedAt = newItem.scriptApprovedAt;
        const videoStatusRaw = readMetaStrFromItem(
          newItem,
          "videoStatusRaw"
        ) as string | undefined;
        const isReadyState =
          videoStatusRaw === "READY" || videoStatusRaw === "VIDEO_READY";
        // 기존에 scriptApprovedAt이 있고, 새 것이 없거나 READY 상태인 경우 보존
        const shouldPreserveScriptApprovedAt =
          prevScriptApprovedAt != null &&
          (newScriptApprovedAt == null ||
            (isReadyState && newScriptApprovedAt == null));

        // sourceFiles는 기존에 실제 업로드된 파일이 있으면 항상 보존
        // script는 기존 것이 있으면 보존
        if (
          shouldPreserveSourceFiles ||
          shouldPreserveScript ||
          shouldPreserveScriptApprovedAt
        ) {
          // 기존 sourceFiles, script, scriptId, scriptApprovedAt 보존
          const mergedItem = {
            ...newItem,
            scriptApprovedAt: shouldPreserveScriptApprovedAt
              ? prevScriptApprovedAt
              : newScriptApprovedAt ?? prevScriptApprovedAt,
            assets: {
              ...newItem.assets,
              sourceFiles: shouldPreserveSourceFiles
                ? prevSourceFiles
                : newItem.assets.sourceFiles,
              sourceFileName: shouldPreserveSourceFiles
                ? prevItem.assets.sourceFileName ||
                  newItem.assets.sourceFileName ||
                  ""
                : newItem.assets.sourceFileName,
              sourceFileSize: shouldPreserveSourceFiles
                ? prevItem.assets.sourceFileSize ||
                  newItem.assets.sourceFileSize ||
                  0
                : newItem.assets.sourceFileSize,
              sourceFileMime: shouldPreserveSourceFiles
                ? prevItem.assets.sourceFileMime ||
                  newItem.assets.sourceFileMime ||
                  ""
                : newItem.assets.sourceFileMime,
              script: shouldPreserveScript
                ? prevScript
                : newItem.assets.script || "",
            },
          };

          // scriptId 보존 (새 scriptId가 없거나 같으면 기존 것 유지, 또는 기존 scriptId가 있고 새 것이 없으면 보존)
          if (
            prevScriptId &&
            (!newScriptId ||
              !newScriptId.trim() ||
              newScriptId === prevScriptId)
          ) {
            (mergedItem as unknown as Record<string, unknown>)["scriptId"] =
              prevScriptId;
          } else if (newScriptId && newScriptId.trim()) {
            (mergedItem as unknown as Record<string, unknown>)["scriptId"] =
              newScriptId;
          }

          return mergedItem;
        }

        // sourceFiles만 보존해야 하는 경우 (script는 보존하지 않음)
        // 또는 sourceFileName이 있으면 보존 (파일이 업로드되었음을 의미)
        if (
          shouldPreserveSourceFiles ||
          (prevHasSourceFileName && !newHasSourceFileName)
        ) {
          const mergedItem = {
            ...newItem,
            // scriptApprovedAt 보존 (기존 값이 있으면 보존)
            scriptApprovedAt: prevScriptApprovedAt ?? newItem.scriptApprovedAt,
            assets: {
              ...newItem.assets,
              sourceFiles: shouldPreserveSourceFiles
                ? prevSourceFiles
                : prevSourceFiles.length > 0
                ? prevSourceFiles
                : newItem.assets.sourceFiles,
              sourceFileName:
                prevItem.assets.sourceFileName ||
                newItem.assets.sourceFileName ||
                "",
              sourceFileSize:
                prevItem.assets.sourceFileSize ||
                newItem.assets.sourceFileSize ||
                0,
              sourceFileMime:
                prevItem.assets.sourceFileMime ||
                newItem.assets.sourceFileMime ||
                "",
            },
          };

          // scriptId 보존 (기존 scriptId가 있으면 항상 보존, 새 것이 없거나 같으면 기존 것 유지)
          if (
            prevScriptId &&
            (!newScriptId ||
              !newScriptId.trim() ||
              newScriptId === prevScriptId)
          ) {
            (mergedItem as unknown as Record<string, unknown>)["scriptId"] =
              prevScriptId;
          } else if (newScriptId && newScriptId.trim()) {
            (mergedItem as unknown as Record<string, unknown>)["scriptId"] =
              newScriptId;
          } else if (prevScriptId) {
            // 새 scriptId가 없고 기존 것이 있으면 보존
            (mergedItem as unknown as Record<string, unknown>)["scriptId"] =
              prevScriptId;
          }

          return mergedItem;
        }

        // scriptId는 항상 보존 (새 것이 없으면 기존 것 유지, 둘 다 있으면 새 것 사용)
        const finalScriptId =
          newScriptId && newScriptId.trim() ? newScriptId : prevScriptId;
        if (finalScriptId && finalScriptId !== newScriptId) {
          const merged = {
            ...newItem,
            // scriptApprovedAt 보존 (기존 값이 있으면 보존)
            scriptApprovedAt: prevScriptApprovedAt ?? newItem.scriptApprovedAt,
          };
          (merged as unknown as Record<string, unknown>)["scriptId"] =
            finalScriptId;
          // scriptText도 함께 보존 (scriptId가 있으면 scriptText도 있어야 함)
          if (
            prevScript.trim().length > 0 &&
            (!newScript || newScript.trim().length === 0)
          ) {
            merged.assets = {
              ...merged.assets,
              script: prevScript,
            };
          }
          return merged;
        }

        // 모든 경우에 scriptApprovedAt 보존 (기존 값이 있으면 보존)
        if (prevScriptApprovedAt != null) {
          return {
            ...newItem,
            scriptApprovedAt: prevScriptApprovedAt,
          };
        }

        return newItem;
      });

      // 최근 생성순 정렬 유지 (createdAt 내림차순)
      const sorted = sortItems(merged, "created_desc");

      // setItems로 상태 업데이트 (동일한 로직 사용)
      setItems(() => sorted);

      setEducations(edus);

      // ---- catalog 보강: 서버 catalog가 없거나 비어도 UI가 잠기지 않게 "항상" 채움 ----
      const derivedCats = deriveCategoryOptionsFromEducations(edus);
      const derivedDepts = deriveDepartmentOptionsFromEducations(edus);
      const derivedTemps = deriveTemplateOptionsFromData(edus, normalized);
      const derivedTrains = deriveJobTrainingOptionsFromData(edus, normalized);

      setCreatorCatalog({
        categories:
          derivedCats.length > 0
            ? derivedCats
            : (CREATOR_CATEGORIES as CategoryOption[]) ?? [],
        departments:
          derivedDepts.length > 0
            ? derivedDepts
            : (CREATOR_DEPARTMENTS as DepartmentOption[]) ?? [],
        templates:
          derivedTemps.length > 0
            ? derivedTemps
            : (CREATOR_VIDEO_TEMPLATES as VideoTemplateOption[]) ?? [],
        jobTrainings:
          derivedTrains.length > 0
            ? derivedTrains
            : (CREATOR_JOB_TRAININGS as JobTrainingOption[]) ?? [],
      });

      setSelectedEducationId((cur) => cur ?? edus[0]?.educationId ?? null);
      setRawSelectedId((cur) => cur ?? sorted[0]?.id ?? null);

      return { educations: edus, items: sorted };
    } catch (e) {
      // 스테일(이미 다른 refresh가 시작됨) / Abort는 "정상 흐름"으로 간주하고 조용히 무시
      const isStale = listAbortRef.current !== ac;
      if (isStale) return null;

      if (ac.signal.aborted || isAbortError(e)) return null;

      const msg = e instanceof Error ? e.message : "요청 실패";
      const status = extractHttpStatus(e);
      const statusText = status ? `HTTP ${status}` : "UNKNOWN";

      const shouldShow =
        (!opts?.silent && initLoadDoneRef.current) ||
        (!opts?.silent && !initLoadDoneRef.current) ||
        (!initLoadDoneRef.current && status !== 401 && status !== 403);

      if (shouldShow) {
        showToast(
          "error",
          `Creator 목록을 불러오지 못했습니다. (${statusText}) ${msg}`,
          3800
        );
      }

      return null;
    } finally {
      // 완료된 컨트롤러는 ref에서 제거(불필요한 abort 연쇄 방지)
      if (listAbortRef.current === ac) listAbortRef.current = null;
      initLoadDoneRef.current = true;
    }
  };

  useEffect(() => {
    let alive = true;

    void (async () => {
      const r1 = await refreshItems({ silent: false });
      if (!alive) return;

      // 초기 진입 시 Abort/경합으로 null 떨어지는 케이스가 있어 1회만 재시도
      if (!r1) {
        await sleep(250);
        if (!alive) return;
        await refreshItems({ silent: true });
      }
    })();

    return () => {
      alive = false;
      listAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -----------------------------
   * Create / Update / Delete (서버 연동)
   * ----------------------------- */

  const updateSelected = (
    patch: Partial<CreatorWorkItem> & Record<string, unknown>
  ) => {
    if (!selectedId) return;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== selectedId) return it;
        // assets는 병합해야 함 (일부 필드만 업데이트하는 경우)
        const assetsPatch = patch.assets;
        const restPatch = { ...patch };
        delete restPatch.assets;

        const next = {
          ...it,
          ...restPatch,
          updatedAt: Date.now(),
          assets: assetsPatch ? { ...it.assets, ...assetsPatch } : it.assets,
        } as CreatorWorkItem;

        // patch에 educationId/videoStatusRaw/scriptId/jobId 등을 섞어 넣는 케이스 지원
        for (const [k, v] of Object.entries(restPatch)) {
          if (!(k in next)) (next as unknown as Record<string, unknown>)[k] = v;
        }
        return next;
      })
    );
  };

  const createDraft = async () => {
    const eduId =
      selectedEducationId ??
      (selectedItem
        ? (selectedItem as unknown as Record<string, unknown>)["educationId"]
        : null);

    let educationId =
      typeof eduId === "string" && eduId.trim().length > 0
        ? eduId.trim()
        : null;

    if (!educationId) {
      const loaded = await refreshItems({ silent: false });
      const first = loaded?.educations?.[0]?.educationId ?? null;

      if (first) {
        educationId = first;
        setSelectedEducationId(first);
      }
    }

    if (!educationId) {
      showToast(
        "error",
        "교육(education)을 먼저 선택/생성해 주세요. (목록 로딩 실패 가능)",
        3400
      );
      return;
    }

    const maybeTemplateId = ensureTemplateId(templates[0]?.id ?? "");

    try {
      const { videoId: createdVideoId } = await createDraftForEducation({
        educationId,
        title: "새 교육 콘텐츠",
        templateId: maybeTemplateId || undefined,
      });

      showToast("success", "새 초안이 생성되었습니다.");

      const loaded = await refreshItems({ silent: true });

      // 서버가 videoId를 바로 안 주는 케이스(또는 source-sets fallback) 대비:
      // educationId 기준으로 “가장 최근” 항목을 찾아 선택
      const nextId =
        (createdVideoId && createdVideoId.trim().length > 0
          ? createdVideoId.trim()
          : null) ??
        (loaded
          ? pickMostRecentVideoIdForEducation(educationId, loaded.items)
          : null);

      if (nextId) {
        setRawSelectedId(nextId);
        setTab("draft");
      }
    } catch (e) {
      const status = extractHttpStatus(e);
      const msg = e instanceof Error ? e.message : "초안 생성 실패";
      const tail = status ? ` (HTTP ${status})` : "";
      showToast("error", `초안 생성에 실패했습니다.${tail} ${msg}`, 3600);
    }
  };

  const updateSelectedMeta = async (
    patch: Partial<
      Pick<
        CreatorWorkItem,
        | "title"
        | "categoryId"
        | "categoryLabel"
        | "templateId"
        | "jobTrainingId"
        | "targetDeptIds"
        | "isMandatory"
      >
    >
  ) => {
    if (!selectedItem) return;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      showToast(
        "info",
        "1차(스크립트) 승인 이후에는 기본 정보를 수정할 수 없습니다."
      );
      return;
    }

    if (isLockedForEdit(selectedItem)) {
      showToast(
        "info",
        "검토 대기/승인/반려/생성 중 상태에서는 편집할 수 없습니다."
      );
      return;
    }

    const nextTitle = patch.title ?? selectedItem.title;

    const boundEducation = selectedItem.educationId
      ? educations.find((e) => e.educationId === selectedItem.educationId) ??
        null
      : null;

    const categoryFromEducation = boundEducation?.categoryId?.trim() || null;
    const jobTrainingFromEducation =
      boundEducation?.jobTrainingId?.trim() || null;

    const desiredCategoryId = (
      categoryFromEducation ??
      patch.categoryId ??
      selectedItem.categoryId
    ).trim();
    const desiredMandatoryCategory = isMandatoryByCategory(desiredCategoryId);

    const desiredJobTrainingId =
      jobTrainingFromEducation ??
      patch.jobTrainingId ??
      selectedItem.jobTrainingId ??
      null;

    const desiredTargetDeptIdsRaw =
      patch.targetDeptIds ?? selectedItem.targetDeptIds;
    const desiredTargetDeptIds =
      boundEducation != null
        ? lockTargetDeptIdsByEducation(
            desiredTargetDeptIdsRaw,
            boundEducation,
            desiredCategoryId,
            departments
          )
        : desiredTargetDeptIdsRaw;

    const nextCategoryId = desiredCategoryId;
    const nextCategoryLabel = categoryLabel(nextCategoryId);

    const nextTemplateId = ensureTemplateId(
      patch.templateId ?? selectedItem.templateId ?? ""
    );
    const nextJobTrainingId = normalizeJobTrainingIdByCategory(
      nextCategoryId,
      desiredJobTrainingId,
      ensureJobTrainingId
    );

    const nextIsMandatory = isMandatoryByCategory(nextCategoryId);

    const nextTargetDeptIds = normalizeTargetDeptIds(
      desiredTargetDeptIds,
      nextCategoryId
    );

    if (isDeptCreator && desiredMandatoryCategory) {
      showToast(
        "info",
        "부서 제작자는 4대 의무교육(전사 필수) 카테고리를 선택할 수 없습니다."
      );
      return;
    }

    // (정책 유지) DEPT_CREATOR는 4대 의무교육 카테고리 자체를 선택 불가
    if (isDeptCreator && nextIsMandatory) {
      showToast(
        "info",
        "부서 제작자는 4대 의무교육(전사 필수) 카테고리를 선택할 수 없습니다."
      );
      return;
    }

    const normalizedPatch: Partial<CreatorWorkItem> = {
      title: nextTitle,
      categoryId: nextCategoryId,
      categoryLabel: nextCategoryLabel,
      templateId: nextTemplateId,
      jobTrainingId: nextJobTrainingId,
      targetDeptIds: nextTargetDeptIds,
      isMandatory: nextIsMandatory,
    };

    // 메타 변경 시 산출물 초기화(타이틀만 변경하면 유지)
    const metaChanged =
      nextCategoryId !== selectedItem.categoryId ||
      nextTemplateId !== selectedItem.templateId ||
      nextJobTrainingId !== selectedItem.jobTrainingId ||
      nextIsMandatory !== selectedItem.isMandatory ||
      (nextTargetDeptIds ?? []).join(",") !==
        (selectedItem.targetDeptIds ?? []).join(",");

    if (metaChanged) {
      updateSelected({
        ...normalizedPatch,
        assets: {
          ...selectedItem.assets,
          ...clearGeneratedAllAssets(selectedItem),
          // sourceFiles는 유지
          sourceFiles: selectedItem.assets.sourceFiles,
          sourceFileName: selectedItem.assets.sourceFileName,
          sourceFileSize: selectedItem.assets.sourceFileSize,
          sourceFileMime: selectedItem.assets.sourceFileMime,
        },
        pipeline: resetPipeline(),
        failedReason: undefined,
        videoStatusRaw: "DRAFT",
      });
    } else {
      updateSelected(normalizedPatch);
    }

    try {
      const educationId =
        getEducationIdOfItem(selectedItem) ?? selectedItem.educationId ?? null;
      if (!educationId) {
        showToast(
          "error",
          "educationId를 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.",
          3200
        );
        return;
      }

      const videoUrl = expandEndpoint(ADMIN_VIDEO_DETAIL_ENDPOINT, {
        videoId: selectedItem.id,
      });
      const eduUrl = expandEndpoint(ADMIN_EDU_DETAIL_ENDPOINT, { educationId });

      const curDeptKey = (selectedItem.targetDeptIds ?? []).join(",");
      const nextDeptKey = (nextTargetDeptIds ?? []).join(",");

      // 변경 여부 판단 (불필요한 요청 제거)
      const videoChanged =
        nextTitle !== selectedItem.title ||
        nextTemplateId !== selectedItem.templateId;

      const eduChanged =
        nextCategoryId !== selectedItem.categoryId ||
        nextJobTrainingId !== selectedItem.jobTrainingId ||
        nextIsMandatory !== selectedItem.isMandatory ||
        nextDeptKey !== curDeptKey;

      // dept clear 정책
      const shouldClearDept = desiredMandatoryCategory; // (== isMandatoryByCategory(nextCategoryId))

      const deptPayloadNeeded = shouldClearDept
        ? curDeptKey !== "" // 기존에 dept가 있었으면 clear 필요
        : nextDeptKey !== curDeptKey;

      const deptPayload = deptPayloadNeeded
        ? shouldClearDept
          ? []
          : nextTargetDeptIds
        : undefined;

      // dept ids -> departmentScope(names)로도 같이 보내서 백엔드 구현 차이를 흡수
      const deptScopePayload =
        deptPayload !== undefined
          ? toDepartmentScopeNamesFromIds(deptPayload, departments)
          : undefined;

      // 1) VIDEO strict payload (title/template 등 "반드시" 저장되어야 하는 것만)
      const videoBodyStrict = videoChanged
        ? compactPayload({
            title: nextTitle !== selectedItem.title ? nextTitle : undefined,
            templateId:
              nextTemplateId !== selectedItem.templateId
                ? nextTemplateId || undefined
                : undefined,
            videoTemplateId:
              nextTemplateId !== selectedItem.templateId
                ? nextTemplateId || undefined
                : undefined, // alias
            version: selectedItem.version ?? undefined,
          })
        : {};

      // 1-2) VIDEO compat payload (백엔드가 video에 isMandatory/targetDeptIds를 저장하는 경우 대비)
      // - strict + meta를 "같이" 보내보고
      // - video endpoint가 거절하면(400/404/422) strict만 재시도
      const videoBodyCompat = compactPayload({
        ...videoBodyStrict,

        categoryId:
          nextCategoryId !== selectedItem.categoryId
            ? nextCategoryId
            : undefined,
        categoryCode:
          nextCategoryId !== selectedItem.categoryId
            ? nextCategoryId
            : undefined,

        jobTrainingId:
          nextJobTrainingId !== selectedItem.jobTrainingId
            ? nextJobTrainingId ?? undefined
            : undefined,
        trainingId:
          nextJobTrainingId !== selectedItem.jobTrainingId
            ? nextJobTrainingId ?? undefined
            : undefined,

        targetDeptIds: deptPayload,
        deptIds: deptPayload,

        departmentScope: deptScopePayload,
        deptScope: deptScopePayload,
      });

      const eduBody = eduChanged
        ? compactPayload({
            categoryId:
              nextCategoryId !== selectedItem.categoryId
                ? nextCategoryId
                : undefined,
            categoryCode:
              nextCategoryId !== selectedItem.categoryId
                ? nextCategoryId
                : undefined,

            jobTrainingId:
              nextJobTrainingId !== selectedItem.jobTrainingId
                ? nextJobTrainingId ?? undefined
                : undefined,
            trainingId:
              nextJobTrainingId !== selectedItem.jobTrainingId
                ? nextJobTrainingId ?? undefined
                : undefined,

            targetDeptIds: deptPayload,
            deptIds: deptPayload,

            departmentScope: deptScopePayload,
            deptScope: deptScopePayload,
          })
        : {};

      // 실행 순서:
      // - video는 compat로 먼저 시도(호환), 실패하면 strict로 재시도
      // - edu는 그대로 업데이트
      if (Object.keys(videoBodyCompat).length > 0) {
        await patchOrPutJsonCompat({
          url: videoUrl,
          compatBody: videoBodyCompat,
          strictBody: videoBodyStrict,
          // video endpoint가 meta 필드를 거절하는 흔한 케이스를 tolerate
          tolerateStatuses: [400, 404, 422],
        });
      } else if (Object.keys(videoBodyStrict).length > 0) {
        // 방어(원칙상 여기까지 올 일은 거의 없지만 안전하게)
        await patchOrPutJson(videoUrl, videoBodyStrict);
      }

      if (Object.keys(eduBody).length > 0) {
        await patchOrPutJson(eduUrl, eduBody);
      }

      await refreshItems({ silent: true });
    } catch (e) {
      const status = extractHttpStatus(e);
      const msg = e instanceof Error ? e.message : "저장 실패";
      const tail = status ? ` (HTTP ${status})` : "";
      showToast("error", `서버 저장에 실패했습니다.${tail} ${msg}`, 3400);
    }
  };

  const deleteDraft = async () => {
    if (!selectedItem) return;

    // 1차 승인 이후에는 삭제 금지(legacy status가 DRAFT일 수 있음)
    const stage1Approved = getScriptApprovedAt(selectedItem) != null;
    if (stage1Approved) {
      showToast(
        "info",
        "1차(스크립트) 승인 이후에는 삭제할 수 없습니다. (운영 정책)",
        3200
      );
      return;
    }

    if (selectedItem.status !== "DRAFT" && selectedItem.status !== "FAILED") {
      // "비활성화” 정책 제거 → 삭제만 허용
      showToast("info", "초안/실패 상태만 삭제할 수 있습니다.");
      return;
    }

    const id = selectedItem.id;

    try {
      const url = expandEndpoint(ADMIN_VIDEO_DETAIL_ENDPOINT, { videoId: id });

      // DELETE-only: PATCH(soft-disable) 및 폴백 제거
      await safeFetchJson(url, { method: "DELETE" });

      // UX: 즉시 목록에서 제거해 "삭제됐는데 남아있는" 느낌 방지
      setItems((prev) => prev.filter((it) => it.id !== id));
      setRawSelectedId(null);

      // 로컬 스토리지에서도 제거
      removeSourceFilesFromStorage(id);

      showToast("success", "초안이 삭제되었습니다.");
      await refreshItems({ silent: true });
    } catch (e) {
      const status = extractHttpStatus(e);
      const msg = e instanceof Error ? e.message : "삭제 실패";
      const tail = status ? ` (HTTP ${status})` : "";
      showToast("error", `삭제에 실패했습니다.${tail} ${msg}`, 3200);
    }
  };

  /* -----------------------------
   * Source file: 업로드 + RAG 등록까지 이 controller에서 처리
   * ----------------------------- */

  const uploadAbortRef = useRef<AbortController | null>(null);

  const addSourceFilesToSelected = async (files: File[]) => {
    if (!selectedItem) return;

    const videoIdSnapshot = selectedItem.id;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      showToast(
        "info",
        "1차(스크립트) 승인 이후에는 자료 파일을 변경할 수 없습니다."
      );
      return;
    }

    if (isLockedForEdit(selectedItem)) {
      showToast(
        "info",
        "검토 대기/승인/반려/생성 중 상태에서는 파일을 변경할 수 없습니다."
      );
      return;
    }

    const cur = normalizeCreatorSourceFilesForItem(selectedItem);
    const prevFiles = Array.isArray(cur.assets.sourceFiles)
      ? cur.assets.sourceFiles.slice()
      : [];
    const existingNames = new Set(
      prevFiles.map((x) => x.name.trim().toLowerCase())
    );

    const addedMeta: CreatorSourceFile[] = [];
    const validFiles: { file: File; meta: CreatorSourceFile }[] = [];

    for (const f of files) {
      const v = validateSourceFile(f);
      if (!v.ok) {
        showToast("error", v.issues[0] ?? "파일 검증에 실패했습니다.", 3500);
        return;
      }
      if (v.warnings.length > 0) showToast("info", v.warnings[0]);

      const key = v.name.trim().toLowerCase();
      if (existingNames.has(key)) continue;
      existingNames.add(key);

      const tmpId = makeId("SRC_TMP");
      const meta: CreatorSourceFile = {
        id: tmpId,
        name: v.name,
        size: v.size,
        mime: v.mime ?? "",
        addedAt: Date.now(),
      };

      addedMeta.push(meta);
      validFiles.push({ file: f, meta });
    }

    if (addedMeta.length === 0) return;

    const nextFiles = [...prevFiles, ...addedMeta];
    const primary = nextFiles[0];

    // optimistic: 파일 업로드 시작 시 assets만 업데이트, pipeline은 변경하지 않음
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== videoIdSnapshot) return it;
        const nextIt: CreatorWorkItem = {
          ...it,
          assets: {
            ...clearGeneratedAllAssets(it),
            sourceFiles: nextFiles,
            sourceFileName: primary?.name ?? "",
            sourceFileSize: primary?.size ?? 0,
            sourceFileMime: primary?.mime ?? "",
          },
          // pipeline은 변경하지 않음 (파일 업로드만으로는 진행률이 올라가지 않음)
          failedReason: undefined,
          updatedAt: Date.now(),
        };
        (nextIt as unknown as Record<string, unknown>)["videoStatusRaw"] =
          "DRAFT";
        return nextIt;
      })
    );

    uploadAbortRef.current?.abort();
    const ac = new AbortController();
    uploadAbortRef.current = ac;

    try {
      showToast("info", "자료 업로드/등록을 시작합니다…", 1800);

      for (const { file, meta } of validFiles) {
        const presign = await requestPresignUpload({
          fileName: meta.name,
          contentType: meta.mime || file.type || undefined,
          size: meta.size,
          signal: ac.signal,
        });

        await putToS3WithFallback({
          uploadUrl: presign.uploadUrl,
          file,
          signal: ac.signal,
        });

        const documentId = await registerDocumentToRag({
          fileUrl: presign.fileUrl,
          fileName: meta.name,
          contentType: meta.mime || file.type || undefined,
          signal: ac.signal,
        });

        // id를 documentId로 치환
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== videoIdSnapshot) return it;
            const sf = Array.isArray(it.assets.sourceFiles)
              ? it.assets.sourceFiles
              : [];

            // 1. meta.id로 매칭 시도
            let patched = sf.map((x) =>
              x.id === meta.id ? { ...x, id: documentId } : x
            );

            // 2. 매칭 실패 시 이름과 크기로 매칭 시도 (fallback)
            const foundById = patched.some((x) => x.id === documentId);
            if (!foundById) {
              const foundByNameAndSize = sf.find(
                (x) => x.name === meta.name && x.size === meta.size
              );
              if (foundByNameAndSize) {
                patched = sf.map((x) =>
                  x.name === meta.name && x.size === meta.size
                    ? { ...x, id: documentId }
                    : x
                );
              } else {
                // 3. 매칭 실패 시 새로 추가 (optimistic update가 반영되지 않은 경우 대비)
                patched = [
                  ...sf,
                  {
                    id: documentId,
                    name: meta.name,
                    size: meta.size,
                    mime: meta.mime,
                    addedAt: Date.now(),
                  },
                ];
              }
            }

            const primary2 = patched[0];
            const updated = {
              ...it,
              assets: {
                ...it.assets,
                sourceFiles: patched,
                sourceFileName:
                  primary2?.name ?? it.assets.sourceFileName ?? "",
                sourceFileSize: primary2?.size ?? it.assets.sourceFileSize ?? 0,
                sourceFileMime:
                  primary2?.mime ?? it.assets.sourceFileMime ?? "",
              },
              updatedAt: Date.now(),
            };

            // 로컬 스토리지에 저장
            saveSourceFilesToStorage(
              videoIdSnapshot,
              patched,
              updated.assets.sourceFileName,
              updated.assets.sourceFileSize,
              updated.assets.sourceFileMime
            );

            return updated;
          })
        );
      }

      // 파일 업로드 완료 시 pipeline은 변경하지 않음 (IDLE 상태 유지)
      // 스크립트 생성을 눌러야 pipeline이 진행됨
      showToast(
        "success",
        "자료 업로드/등록이 완료되었습니다. (스크립트 생성 가능)"
      );
    } catch (e) {
      if (ac.signal.aborted) return;
      const msg =
        e instanceof Error ? e.message : "자료 업로드/등록에 실패했습니다.";
      showToast("error", msg, 3500);
    } finally {
      if (uploadAbortRef.current === ac) uploadAbortRef.current = null;
    }
  };

  const removeSourceFileFromSelected = (fileId: string) => {
    if (!selectedItem) return;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      showToast(
        "info",
        "1차(스크립트) 승인 이후에는 자료 파일을 변경할 수 없습니다."
      );
      return;
    }

    if (isLockedForEdit(selectedItem)) {
      showToast(
        "info",
        "검토 대기/승인/반려/생성 중 상태에서는 파일을 변경할 수 없습니다."
      );
      return;
    }

    const cur = normalizeCreatorSourceFilesForItem(selectedItem);
    const prevFiles = Array.isArray(cur.assets.sourceFiles)
      ? cur.assets.sourceFiles.slice()
      : [];

    const removed = prevFiles.find((x) => x.id === fileId);
    const nextFiles = prevFiles.filter((x) => x.id !== fileId);
    if (nextFiles.length === prevFiles.length) return;

    const primary = nextFiles[0];
    const nextFileName = primary?.name ?? "";
    const nextFileSize = primary?.size ?? 0;
    const nextFileMime = primary?.mime ?? "";

    updateSelected({
      assets: {
        ...clearGeneratedAllAssets(selectedItem),
        sourceFiles: nextFiles,
        sourceFileName: nextFileName,
        sourceFileSize: nextFileSize,
        sourceFileMime: nextFileMime,
      },
      pipeline: resetPipeline(),
      failedReason: undefined,
      videoStatusRaw: "DRAFT",
    });

    // 로컬 스토리지 업데이트
    if (nextFiles.length === 0) {
      // 모든 파일이 삭제되면 로컬 스토리지에서도 제거
      removeSourceFilesFromStorage(selectedItem.id);
    } else {
      // 일부 파일만 삭제된 경우 업데이트
      saveSourceFilesToStorage(
        selectedItem.id,
        nextFiles,
        nextFileName,
        nextFileSize,
        nextFileMime
      );
    }

    showToast(
      "success",
      `파일이 삭제되었습니다${removed?.name ? `: ${removed.name}` : ""}.`
    );
  };

  const attachFileToSelected = (file: File) => {
    void addSourceFilesToSelected([file]);
  };

  /* -----------------------------
   * Pipeline helpers
   * ----------------------------- */

  function getEducationIdOfItem(item: CreatorWorkItem): string | null {
    const v = readMetaStrFromItem(item, "educationId");
    return v && v.trim().length > 0 ? v.trim() : null;
  }

  function getVideoStatusRawOfItem(item: CreatorWorkItem): string {
    const meta = (item as unknown as Record<string, unknown>)["videoStatusRaw"];
    if (typeof meta === "string" && meta.trim().length > 0) return meta.trim();

    const rawStage = item.pipeline?.rawStage;
    if (typeof rawStage === "string" && rawStage.trim().length > 0)
      return rawStage.trim();

    return "";
  }

  function getDocumentIdsFromItem(item: CreatorWorkItem): string[] {
    const src = Array.isArray(item.assets.sourceFiles)
      ? item.assets.sourceFiles
      : [];
    return uniq(
      src
        .map((x) => x.id)
        .filter(
          (id) =>
            typeof id === "string" &&
            id.trim().length > 0 &&
            !id.startsWith("SRC_TMP")
        )
    );
  }

  const pollVideoStatus = (videoId: string) => {
    stopPolling();

    const ac = new AbortController();
    pollAbortRef.current = ac;

    const tick = () => {
      void (async () => {
        if (ac.signal.aborted) return;

        try {
          const url = expandEndpoint(VIDEO_GET_ENDPOINT, { videoId });
          const raw = await safeFetchJson<unknown>(url, {
            method: "GET",
            signal: ac.signal,
          });

          const statusRaw =
            readStr(raw, "status") ?? readStr(raw, "videoStatus") ?? "";
          const legacy = normalizeVideoStatusToLegacyStatus(statusRaw);
          const pipeline = normalizePipelineFromVideoStatus(statusRaw);

          // 1차 승인 시간 보정
          const upper = String(statusRaw ?? "").toUpperCase();
          let scriptApprovedAt =
            parseTimeLike(
              (raw as Record<string, unknown>)["scriptApprovedAt"]
            ) ??
            parseTimeLike((raw as Record<string, unknown>)["approvedAt"]) ??
            undefined;

          if (!scriptApprovedAt && upper === "SCRIPT_APPROVED") {
            scriptApprovedAt = Date.now();
          }

          setItems((prev) =>
            prev.map((it) => {
              if (it.id !== videoId) return it;

              const next: CreatorWorkItem = {
                ...it,
                status: legacy,
                pipeline: { ...it.pipeline, ...pipeline },
                assets: {
                  ...it.assets,
                  script: readStr(raw, "scriptText") ?? it.assets.script,
                  videoUrl:
                    readStr(raw, "fileUrl") ??
                    readStr(raw, "videoUrl") ??
                    it.assets.videoUrl,
                  thumbnailUrl:
                    readStr(raw, "thumbnailUrl") ?? it.assets.thumbnailUrl,
                },
                updatedAt: Date.now(),
                failedReason:
                  pipeline.state === "FAILED"
                    ? readStr(raw, "failedReason") ??
                      readStr(raw, "errorMessage") ??
                      it.failedReason
                    : it.failedReason,
                scriptApprovedAt: scriptApprovedAt ?? it.scriptApprovedAt,
              };

              (next as unknown as Record<string, unknown>)["videoStatusRaw"] =
                String(statusRaw ?? "");
              (next as unknown as Record<string, unknown>)["jobId"] =
                readStr(raw, "jobId") ?? readMetaStrFromItem(it, "jobId");
              const newScriptId =
                readStr(raw, "scriptId") ?? readMetaStrFromItem(it, "scriptId");

              // scriptId가 있으면 항상 즉시 반영 (SCRIPT_READY 상태일 때 UI가 즉시 반응하도록)
              // newScriptId가 undefined나 null이 아닌 경우에만 업데이트
              // readScriptId는 it.scriptId를 먼저 확인하므로 메타데이터에 저장하면 작동함
              if (
                newScriptId &&
                typeof newScriptId === "string" &&
                newScriptId.trim().length > 0
              ) {
                (next as unknown as Record<string, unknown>)["scriptId"] =
                  newScriptId;
              }
              if (scriptApprovedAt)
                (next as unknown as Record<string, unknown>)[
                  "scriptApprovedAt"
                ] = scriptApprovedAt;

              // scriptId가 새로 추가되었거나 변경되었고, 스크립트 텍스트가 없으면 즉시 로드
              // (pollRef.current가 true일 때 selectedItem 변경 감지 로직이 실행되지 않으므로 여기서 처리)
              // SCRIPT_READY 상태일 때도 스크립트 텍스트를 로드하여 미리보기 섹션에 즉시 표시
              const validScriptId =
                typeof newScriptId === "string" && newScriptId.trim().length > 0
                  ? newScriptId.trim()
                  : null;
              const needsScriptLoad =
                validScriptId &&
                (!next.assets.script || next.assets.script.trim().length === 0);

              if (needsScriptLoad) {
                void (async () => {
                  try {
                    const { getScript } = await import("./creatorApi");
                    const script = await getScript(validScriptId);
                    // chapters → scenes → narration 또는 caption을 합쳐서 텍스트 추출
                    const parts: string[] = [];
                    for (const chapter of script.chapters || []) {
                      for (const scene of chapter.scenes || []) {
                        const text = scene.narration || scene.caption || "";
                        if (text.trim()) {
                          parts.push(text.trim());
                        }
                      }
                    }
                    const extractedText = parts.join("\n\n");

                    // 스크립트 텍스트 업데이트
                    setItems((prev) =>
                      prev.map((item) => {
                        if (item.id !== videoId) return item;
                        return {
                          ...item,
                          assets: {
                            ...item.assets,
                            script: extractedText || item.assets.script || "",
                          },
                        };
                      })
                    );
                  } catch (err) {
                    console.warn(
                      `Failed to fetch script ${validScriptId}:`,
                      err
                    );
                  }
                })();
              }

              return next;
            })
          );

          // 종료 조건
          if (
            upper === "SCRIPT_READY" ||
            upper === "SCRIPT_APPROVED" ||
            upper === "READY" ||
            upper === "VIDEO_READY" ||
            upper.includes("REVIEW") ||
            upper === "PUBLISHED" ||
            upper === "APPROVED" ||
            upper.includes("FAIL") ||
            upper.includes("REJECT")
          ) {
            stopPolling();
            // SCRIPT_READY 상태로 전이되면 pipeline stage도 업데이트 및 scriptId 조회
            if (upper === "SCRIPT_READY") {
              // raw에서 scriptId를 즉시 읽어서 업데이트 (비동기 작업 전에 먼저 반영)
              const rawScriptId = readStr(raw, "scriptId");

              // pipeline과 scriptId를 먼저 즉시 업데이트하여 UI가 즉시 반응하도록
              setItems((prev) => {
                const currentItem = prev.find((it) => it.id === videoId);
                if (!currentItem) {
                  // currentItem이 없으면 pipeline만 업데이트
                  return prev.map((it) => {
                    if (it.id !== videoId) return it;
                    const next: CreatorWorkItem = {
                      ...it,
                      pipeline: {
                        ...it.pipeline,
                        state: "SUCCESS" as const,
                        stage: "SCRIPT",
                        progress: 100,
                        rawStage: "SCRIPT_READY",
                      },
                    };
                    // raw에서 scriptId를 읽었으면 즉시 반영
                    if (rawScriptId) {
                      (next as unknown as Record<string, unknown>)["scriptId"] =
                        rawScriptId;
                    }
                    return next;
                  });
                }

                const currentScriptId =
                  readMetaStrFromItem(currentItem, "scriptId") || rawScriptId;
                const needsScriptId = !currentScriptId;
                const needsScriptText =
                  !currentItem.assets.script ||
                  currentItem.assets.script.trim().length === 0;

                // scriptId가 있으면 즉시 반영 (비동기 작업 전에 먼저 업데이트하여 UI가 즉시 반응하도록)
                const immediateScriptId = currentScriptId || rawScriptId;

                // pipeline과 scriptId는 즉시 업데이트 (scriptText는 비동기로 나중에 업데이트)
                const immediateUpdate = prev.map((it) => {
                  if (it.id !== videoId) return it;
                  const next: CreatorWorkItem = {
                    ...it,
                    pipeline: {
                      ...it.pipeline,
                      state: "SUCCESS" as const,
                      stage: "SCRIPT",
                      progress: 100,
                      rawStage: "SCRIPT_READY",
                    },
                  };
                  // raw에서 scriptId를 읽었거나 현재 scriptId가 없으면 즉시 반영
                  if (
                    immediateScriptId &&
                    typeof immediateScriptId === "string" &&
                    immediateScriptId.trim().length > 0
                  ) {
                    (next as unknown as Record<string, unknown>)["scriptId"] =
                      immediateScriptId;
                  }
                  return next;
                });

                // 스크립트 텍스트가 필요하면 비동기로 로드 (Promise로 감싸서 완료를 기다릴 수 있도록)
                if (needsScriptId || needsScriptText) {
                  const educationId = getEducationIdOfItem(currentItem);
                  if (educationId) {
                    // 비동기 작업을 Promise로 감싸서 완료를 기다릴 수 있도록
                    void (async () => {
                      try {
                        const resolved = needsScriptId
                          ? await resolveScriptIdForEducationOrVideo({
                              educationId,
                              videoId,
                              signal: ac.signal,
                            })
                          : {
                              educationId,
                              videoId,
                              scriptId: immediateScriptId!,
                            };

                        if (ac.signal.aborted || !resolved.scriptId) return;

                        // 스크립트 텍스트 조회
                        let extractedText = currentItem.assets.script || "";
                        if (needsScriptText) {
                          try {
                            const { getScript } = await import("./creatorApi");
                            const script = await getScript(resolved.scriptId);
                            // chapters → scenes → narration 또는 caption을 합쳐서 텍스트 추출
                            const parts: string[] = [];
                            for (const chapter of script.chapters || []) {
                              for (const scene of chapter.scenes || []) {
                                const text =
                                  scene.narration || scene.caption || "";
                                if (text.trim()) {
                                  parts.push(text.trim());
                                }
                              }
                            }
                            extractedText = parts.join("\n\n");
                          } catch (err) {
                            console.warn(
                              `Failed to fetch script ${resolved.scriptId}:`,
                              err
                            );
                          }
                        }

                        // setItems로 한 번에 업데이트 (scriptId, assets.script, pipeline 모두)
                        setItems((prev2) =>
                          prev2.map((it) => {
                            if (it.id !== videoId) return it;
                            const next = {
                              ...it,
                              pipeline: {
                                ...it.pipeline,
                                state: "SUCCESS",
                                stage: "SCRIPT",
                                progress: 100,
                                rawStage: "SCRIPT_READY",
                              },
                              assets: {
                                ...it.assets,
                                script: extractedText || it.assets.script || "",
                              },
                            } as CreatorWorkItem;
                            // scriptId 메타데이터 업데이트
                            if (
                              needsScriptId ||
                              resolved.scriptId !== immediateScriptId
                            ) {
                              (next as unknown as Record<string, unknown>)[
                                "scriptId"
                              ] = resolved.scriptId;
                            }
                            return next;
                          })
                        );
                      } catch {
                        // lookup 실패는 조용히 무시 (refreshItems에서 재시도)
                      }
                    })();
                  }
                }

                return immediateUpdate;
              });

              // React의 상태 업데이트가 반영되도록 다음 틱까지 대기
              // setItems는 비동기적으로 처리되므로, 상태가 반영된 후 refreshItems 호출
              void (async () => {
                // React 상태 업데이트가 반영되도록 다음 이벤트 루프까지 대기
                await new Promise((resolve) => setTimeout(resolve, 0));

                // scriptId가 업데이트되었는지 확인하고, 필요하면 refreshItems 호출
                // 하지만 scriptId는 이미 setItems로 업데이트되었으므로,
                // refreshItems는 서버에서 최신 데이터를 가져오기 위해 호출
                // 단, scriptId가 이미 있으면 즉시 UI에 반영되므로 refreshItems는 선택적
                if (!ac.signal.aborted) {
                  // scriptId가 이미 업데이트되었으므로, refreshItems는 백그라운드에서 호출
                  // UI는 이미 scriptId로 업데이트되었으므로 즉시 반응함
                  void refreshItems({ silent: true });
                }
              })();
            } else {
              // SCRIPT_READY가 아닌 다른 종료 상태는 즉시 refreshItems 호출
              await refreshItems({ silent: true });
            }
          }
        } catch {
          if (ac.signal.aborted) return;
          // transient ignore
        }
      })();
    };

    pollRef.current = window.setInterval(tick, 1500);
    tick();
  };

  const pollJobStatus = (jobId: string, videoId: string) => {
    stopPolling();

    const ac = new AbortController();
    pollAbortRef.current = ac;

    const tick = () => {
      void (async () => {
        if (ac.signal.aborted) return;

        try {
          const url = expandEndpoint(VIDEO_JOB_STATUS_ENDPOINT, { jobId });
          const raw = await safeFetchJson<unknown>(url, {
            method: "GET",
            signal: ac.signal,
          });

          const state = (
            readStr(raw, "status") ??
            readStr(raw, "state") ??
            ""
          ).toUpperCase();
          const progress =
            readNum(raw, "progress") ?? readNum(raw, "percent") ?? 0;
          // job 응답에서 videoUrl 읽기 (영상 생성 완료 시 포함됨)
          const videoUrl =
            readStr(raw, "videoUrl") ?? readStr(raw, "fileUrl") ?? null;

          setItems((prev) =>
            prev.map((it) => {
              if (it.id !== videoId) return it;
              const next = {
                ...it,
                status:
                  state === "RUNNING" || state === "PROCESSING"
                    ? "GENERATING"
                    : it.status,
                pipeline: {
                  ...it.pipeline,
                  state:
                    state === "RUNNING" || state === "PROCESSING"
                      ? "RUNNING"
                      : it.pipeline.state,
                  stage: "VIDEO",
                  rawStage: `JOB:${jobId}`,
                  progress: clamp(progress, 0, 100),
                },
                assets: {
                  ...it.assets,
                  // videoUrl이 있으면 즉시 업데이트
                  videoUrl: videoUrl ?? it.assets.videoUrl,
                },
                updatedAt: Date.now(),
              } as CreatorWorkItem;
              (next as unknown as Record<string, unknown>)["jobId"] = jobId;
              return next;
            })
          );

          // COMPLETED, SUCCESS, FAILED, DONE 상태일 때 폴링 중지하고 video 상태 확인
          if (
            state === "COMPLETED" ||
            state === "SUCCESS" ||
            state === "FAILED" ||
            state === "DONE"
          ) {
            stopPolling();
            // 영상 생성 완료 시 즉시 video 상태를 확인하여 최신 상태 반영
            pollVideoStatus(videoId);
          }
        } catch {
          if (ac.signal.aborted) return;
          // transient ignore
        }
      })();
    };

    pollRef.current = window.setInterval(tick, 1500);
    tick();
  };

  /**
   * SCRIPT 생성 (sourceset create)
   */
  const runPipelineForSelected = async () => {
    if (!selectedItem) return;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      showToast(
        "info",
        "1차 승인 이후에는 스크립트 생성/재생성을 실행할 수 없습니다."
      );
      return;
    }

    const anyRunning = items.some((it) => it.pipeline.state === "RUNNING");
    if (anyRunning) {
      showToast(
        "info",
        "다른 콘텐츠의 자동 생성이 진행 중입니다. 완료 후 다시 시도해 주세요."
      );
      return;
    }

    const educationId = getEducationIdOfItem(selectedItem);
    if (!educationId) {
      showToast(
        "error",
        "educationId를 찾지 못했습니다. 목록을 새로고침 후 다시 시도해 주세요.",
        3500
      );
      return;
    }

    // sourceFiles 배열 또는 레거시 sourceFileName 필드 확인
    const sourceFiles = Array.isArray(selectedItem.assets.sourceFiles)
      ? selectedItem.assets.sourceFiles
      : [];
    const hasSourceFile =
      sourceFiles.length > 0 ||
      (selectedItem.assets.sourceFileName ?? "").trim().length > 0;

    if (!hasSourceFile) {
      showToast("error", "먼저 교육 자료 파일을 업로드해 주세요.", 3000);
      return;
    }

    const docIds = getDocumentIdsFromItem(selectedItem);
    if (docIds.length === 0) {
      // sourceFiles가 있지만 documentId가 없는 경우는 업로드가 아직 진행 중일 수 있음
      // sourceFiles에 SRC_TMP로 시작하는 임시 ID가 있는지 확인
      const hasTempFiles = sourceFiles.some(
        (f) => f.id && String(f.id).startsWith("SRC_TMP")
      );
      if (hasTempFiles) {
        showToast(
          "error",
          "문서 업로드가 아직 완료되지 않았습니다. 업로드가 끝난 뒤 다시 시도해 주세요.",
          3500
        );
      } else {
        showToast(
          "error",
          "문서 등록(documentId)이 완료되지 않았습니다. 업로드가 끝난 뒤 다시 시도해 주세요.",
          3500
        );
      }
      return;
    }

    updateSelected({
      status: "GENERATING",
      pipeline: {
        mode: "SCRIPT_ONLY" as CreatorWorkItem["pipeline"]["mode"],
        state: "RUNNING",
        stage: "SCRIPT",
        rawStage: "SCRIPT_GENERATING",
        progress: 0,
      },
      failedReason: undefined,
      videoStatusRaw: "SCRIPT_GENERATING",
    });

    try {
      await safeFetchJson(VIDEO_SOURCESET_CREATE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // swagger 필수
          educationId,
          videoId: selectedItem.id,
          documentIds: docIds,

          // swagger 필수(또는 서버에서 사실상 요구하는 경우가 많음)
          title: (selectedItem.title ?? "").trim() || "교육 자료",
          // domain 값은 백엔드 enum에 맞춰야 함
          // - 직무면 JOB_TRAINING, 의무면 FOUR_MANDATORY로 가정(스웨거 예시 기준)
          // categoryId를 기준으로 판단 (jobTrainingId는 직무 카테고리에서만 사용)
          domain: isJobCategory(selectedItem.categoryId)
            ? "JOB_TRAINING"
            : "FOUR_MANDATORY",

          // 과거 스펙/백엔드 호환용 alias
          eduId: educationId,
        }),
      });

      // 스크립트 생성 요청 성공 시 진행 단계 전이
      updateSelected({
        pipeline: {
          mode: "SCRIPT_ONLY" as CreatorWorkItem["pipeline"]["mode"],
          state: "RUNNING",
          stage: "SCRIPT",
          rawStage: "SCRIPT_GENERATING",
          progress: 0,
        },
        videoStatusRaw: "SCRIPT_GENERATING",
      });

      showToast(
        "info",
        "소스셋 생성 요청이 완료되었습니다. 스크립트 생성 상태를 확인합니다…",
        2000
      );
      pollVideoStatus(selectedItem.id);
    } catch (e) {
      const status = extractHttpStatus(e);
      let msg = e instanceof Error ? e.message : "소스셋 생성에 실패했습니다.";

      // 403 Forbidden 오류의 경우 더 명확한 메시지 제공
      if (status === 403) {
        msg =
          "스크립트 생성 권한이 없습니다. (403) 백엔드 내부 토큰 설정을 확인해주세요.";
      } else if (status === 401) {
        msg = "인증이 필요합니다. (401) 로그인 상태를 확인해주세요.";
      } else if (status) {
        msg = `${msg} (HTTP ${status})`;
      }

      showToast("error", msg, 5000);
      updateSelected({
        status: "FAILED",
        failedReason:
          status === 403
            ? "스크립트 생성 권한 오류 (백엔드 내부 토큰 설정 필요)"
            : "소스셋 생성 실패",
        pipeline: {
          ...selectedItem.pipeline,
          state: "FAILED",
          stage: "SCRIPT",
          rawStage: selectedItem.pipeline.rawStage ?? "SCRIPT_GENERATING",
        },
        videoStatusRaw: "FAILED",
      });
    }
  };

  /**
   * VIDEO 생성 job
   * - 1차 승인(SCRIPT_APPROVED) 이후에만 허용
   */
  const runVideoOnlyForSelected = async () => {
    if (!selectedItem) return;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt == null) {
      showToast("info", "영상 생성은 1차(스크립트) 승인 이후에만 가능합니다.");
      return;
    }

    const anyRunning = items.some((it) => it.pipeline.state === "RUNNING");
    if (anyRunning) {
      showToast(
        "info",
        "다른 콘텐츠의 자동 생성이 진행 중입니다. 완료 후 다시 시도해 주세요."
      );
      return;
    }

    const educationId = getEducationIdOfItem(selectedItem);
    if (!educationId) {
      showToast(
        "error",
        "educationId를 찾지 못했습니다. 목록을 새로고침 후 다시 시도해 주세요.",
        3500
      );
      return;
    }

    let scriptId: string;
    try {
      const resolved = await resolveScriptIdForEducationOrVideo({
        educationId,
        videoId: selectedItem.id,
      });
      scriptId = resolved.scriptId;
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "scriptId 확정에 실패했습니다.";
      showToast("error", msg, 3500);
      return;
    }

    updateSelected({
      status: "GENERATING",
      pipeline: {
        mode: "VIDEO_ONLY" as CreatorWorkItem["pipeline"]["mode"],
        state: "RUNNING",
        stage: "VIDEO",
        rawStage: "VIDEO_GENERATING",
        progress: 0,
      },
      failedReason: undefined,
      videoStatusRaw: "VIDEO_GENERATING",
      scriptId,
    });

    try {
      const created = await safeFetchJson<unknown>(VIDEO_JOB_CREATE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          educationId,
          videoId: selectedItem.id,
          scriptId,
          eduId: educationId, // 호환용
        }),
      });

      const jobId =
        (created &&
          typeof created === "object" &&
          (readStr(created, "jobId") ?? readStr(created, "id"))) ||
        null;

      if (!jobId || typeof jobId !== "string") {
        throw new Error("영상 생성 jobId를 받지 못했습니다.");
      }

      showToast(
        "info",
        "영상 생성 작업이 시작되었습니다. 진행 상태를 확인합니다…",
        2000
      );
      pollJobStatus(jobId, selectedItem.id);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "영상 생성 시작에 실패했습니다.";
      showToast("error", msg, 3500);
      updateSelected({
        status: "FAILED",
        failedReason: "영상 생성 시작 실패",
        pipeline: {
          ...selectedItem.pipeline,
          state: "FAILED",
          stage: "VIDEO",
          rawStage: selectedItem.pipeline.rawStage ?? "VIDEO_GENERATING",
        },
        videoStatusRaw: "FAILED",
      });
    }
  };

  const retryPipelineForSelected = () => {
    if (!selectedItem) return;
    if (selectedItem.status !== "FAILED") return;

    setTab("draft");

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      void runVideoOnlyForSelected();
      return;
    }
    void runPipelineForSelected();
  };

  const failPipelineForSelected = (reason: string) => {
    if (!selectedItem) return;
    stopPolling();

    updateSelected({
      status: "FAILED",
      failedReason: reason,
      pipeline: {
        ...selectedItem.pipeline,
        state: "FAILED",
        stage: selectedItem.pipeline.stage ?? null,
        rawStage: selectedItem.pipeline.rawStage ?? "FAILED",
      },
      videoStatusRaw: "FAILED",
    });

    showToast("error", `자동 생성 실패: ${reason}`, 3000);
  };

  /* -----------------------------
   * Script Editor open/close
   * ----------------------------- */

  const openScriptEditorForEducation = async (educationId: string) => {
    scriptAbortRef.current?.abort();
    const ac = new AbortController();
    scriptAbortRef.current = ac;

    setScriptEditor({
      open: true,
      educationId,
      videoId: null,
      scriptId: null,
      loading: true,
      error: null,
    });

    try {
      const resolved = await resolveScriptIdForEducationOrVideo({
        educationId,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;

      setSelectedEducationId(resolved.educationId);
      setRawSelectedId(resolved.videoId);

      setScriptEditor({
        open: true,
        educationId: resolved.educationId,
        videoId: resolved.videoId,
        scriptId: resolved.scriptId,
        loading: false,
        error: null,
      });
    } catch (e) {
      if (ac.signal.aborted) return;
      const msg =
        e instanceof Error ? e.message : "scriptId 확정에 실패했습니다.";
      setScriptEditor({
        open: true,
        educationId,
        videoId: null,
        scriptId: null,
        loading: false,
        error: msg,
      });
      showToast("error", msg, 3500);
    }
  };

  const openScriptEditorForSelected = async () => {
    if (!selectedItem) return;

    const educationId = getEducationIdOfItem(selectedItem);
    if (!educationId) {
      showToast(
        "error",
        "educationId를 찾지 못했습니다. 목록을 새로고침 후 다시 시도해 주세요.",
        3500
      );
      return;
    }

    scriptAbortRef.current?.abort();
    const ac = new AbortController();
    scriptAbortRef.current = ac;

    setScriptEditor({
      open: true,
      educationId,
      videoId: selectedItem.id,
      scriptId: null,
      loading: true,
      error: null,
    });

    try {
      const resolved = await resolveScriptIdForEducationOrVideo({
        educationId,
        videoId: selectedItem.id,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;

      updateSelected({ scriptId: resolved.scriptId });

      setScriptEditor({
        open: true,
        educationId: resolved.educationId,
        videoId: resolved.videoId,
        scriptId: resolved.scriptId,
        loading: false,
        error: null,
      });
    } catch (e) {
      if (ac.signal.aborted) return;
      const msg =
        e instanceof Error ? e.message : "scriptId 확정에 실패했습니다.";
      setScriptEditor({
        open: true,
        educationId,
        videoId: selectedItem.id,
        scriptId: null,
        loading: false,
        error: msg,
      });
      showToast("error", msg, 3500);
    }
  };

  const closeScriptEditor = () => {
    scriptAbortRef.current?.abort();
    scriptAbortRef.current = null;

    setScriptEditor({
      open: false,
      educationId: null,
      videoId: null,
      scriptId: null,
      loading: false,
      error: null,
    });
  };

  const onScriptSaved = async (
    educationId: string,
    opts?: { refresh?: boolean; silent?: boolean }
  ) => {
    setItems((prev) =>
      prev.map((it) =>
        getEducationIdOfItem(it) === educationId
          ? { ...it, updatedAt: Date.now() }
          : it
      )
    );
    if (opts?.refresh) await refreshItems({ silent: opts?.silent ?? true });
  };

  /**
   * (옵션) inline script 편집을 유지하는 경우: scriptId resolve → PUT/PATCH
   */
  const updateSelectedScript = async (
    script: string,
    options?: { silent?: boolean }
  ) => {
    if (!selectedItem) return;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      showToast(
        "info",
        "1차(스크립트) 승인 이후에는 스크립트를 수정할 수 없습니다."
      );
      return;
    }

    if (isLockedForEdit(selectedItem)) {
      showToast(
        "info",
        "검토 대기/승인/반려/생성 중 상태에서는 스크립트를 수정할 수 없습니다."
      );
      return;
    }

    const educationId = getEducationIdOfItem(selectedItem);
    if (!educationId) {
      showToast(
        "error",
        "educationId를 찾지 못했습니다. 목록을 새로고침 후 다시 시도해 주세요.",
        3500
      );
      return;
    }

    try {
      const resolved = await resolveScriptIdForEducationOrVideo({
        educationId,
        videoId: selectedItem.id,
      });

      updateSelected({ scriptId: resolved.scriptId });

      const url = expandEndpoint(SCRIPT_DETAIL_ENDPOINT, {
        scriptId: resolved.scriptId,
      });
      await safeFetchJson(url, {
        method:
          SCRIPT_UPDATE_METHOD.toUpperCase() === "PATCH" ? "PATCH" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [SCRIPT_TEXT_FIELD]: script }),
      });

      updateSelected({
        assets: {
          ...selectedItem.assets,
          script,
          videoUrl: selectedItem.assets.videoUrl,
          thumbnailUrl: selectedItem.assets.thumbnailUrl,
        },
        failedReason: undefined,
        scriptId: resolved.scriptId,
      });

      if (!options?.silent) showToast("info", "스크립트가 저장되었습니다.");
    } catch {
      showToast("error", "스크립트 저장에 실패했습니다.", 3200);
    }
  };

  /* -----------------------------
   * Review 요청
   * ----------------------------- */

  const requestReviewForSelected = async () => {
    if (!selectedItem) return;

    const statusRaw = getVideoStatusRawOfItem(selectedItem).toUpperCase();
    const wantsFinal =
      statusRaw === "READY" ||
      statusRaw === "VIDEO_READY" ||
      Boolean(selectedItem.assets.videoUrl);

    const v = validateForReview(
      selectedItem,
      scopeCtx,
      wantsFinal ? "FINAL" : "SCRIPT"
    );
    if (!v.ok) {
      showToast("error", v.issues[0] ?? "검토 요청 조건을 확인해주세요.", 3000);
      return;
    }

    const educationId = getEducationIdOfItem(selectedItem);
    if (!educationId) {
      showToast(
        "error",
        "educationId를 찾지 못했습니다. 목록을 새로고침 후 다시 시도해 주세요.",
        3500
      );
      return;
    }

    const cachedScriptId = readMetaStrFromItem(selectedItem, "scriptId");
    if (!cachedScriptId || cachedScriptId.trim().length === 0) {
      try {
        const resolved = await resolveScriptIdForEducationOrVideo({
          educationId,
          videoId: selectedItem.id,
        });
        updateSelected({ scriptId: resolved.scriptId });
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "scriptId 확정에 실패했습니다.";
        showToast("error", `검토 요청 전 scriptId 확인 실패: ${msg}`, 3500);
        return;
      }
    }

    try {
      const url = expandEndpoint(ADMIN_VIDEO_REVIEW_REQUEST_ENDPOINT, {
        videoId: selectedItem.id,
      });
      await safeFetchJson(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stage: wantsFinal ? "FINAL" : "SCRIPT",
        }),
      });

      updateSelected({
        status: "REVIEW_PENDING",
        videoStatusRaw: wantsFinal
          ? "FINAL_REVIEW_REQUESTED"
          : "SCRIPT_REVIEW_REQUESTED",
      });
      setTab("review_pending");

      showToast(
        "success",
        wantsFinal
          ? "2차(최종) 검토 요청이 제출되었습니다."
          : "1차(스크립트) 검토 요청이 제출되었습니다."
      );

      await refreshItems({ silent: true });
    } catch {
      showToast("error", "검토 요청 제출에 실패했습니다.", 3200);
    }
  };

  const reopenRejectedToDraft = async () => {
    if (!selectedItem) return;
    if (selectedItem.status !== "REJECTED") return;

    const next = bumpVersionForRework(
      selectedItem,
      "REJECTED → 새 버전 재작업"
    );

    setItems((prev) =>
      prev.map((it) => (it.id === selectedItem.id ? next : it))
    );
    setTab("draft");

    showToast("info", `새 버전(v${next.version})으로 편집을 시작합니다.`);
    await refreshItems({ silent: true });
  };

  // 언마운트 정리
  useEffect(() => {
    return () => {
      stopPolling();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      listAbortRef.current?.abort();
      scriptAbortRef.current?.abort();
      uploadAbortRef.current?.abort();
    };
  }, []);

  return {
    // static data
    departments,
    categories,
    templates,
    jobTrainings,

    // role/scope
    creatorType,

    // education context
    educations,
    selectedEducationId,
    setSelectedEducationId,

    // patch2: 교육 목록(영상 포함) 로더
    getEducationsWithVideos: (args?: { signal?: AbortSignal }) =>
      getEducationsWithVideos({ signal: args?.signal }),

    // patch2: 선택한 교육ID로 초안 생성
    createDraftForEducation: async (
      educationId:
        | string
        | { educationId: string; title?: string; departmentScope?: string[] },
      opts?: { title?: string; templateId?: string; departmentScope?: string[] }
    ) => {
      // 객체 형태와 개별 파라미터 형태 모두 지원
      let eid: string;
      let title: string | undefined;
      let departmentScope: string[] | undefined;
      let templateId: string | undefined;

      if (typeof educationId === "object" && educationId !== null) {
        eid = String(educationId.educationId ?? "").trim();
        title = educationId.title;
        departmentScope = educationId.departmentScope;
        templateId = opts?.templateId;
      } else {
        eid = String(educationId ?? "").trim();
        title = opts?.title;
        departmentScope = opts?.departmentScope;
        templateId = opts?.templateId;
      }

      if (!eid) {
        showToast("error", "교육을 선택해 주세요.");
        return null;
      }

      const edu = educations.find((e) => e.educationId === eid);
      const desiredTitle =
        (title ?? opts?.title ?? "").trim() ||
        (edu ? `${edu.title} - 새 콘텐츠` : "새 교육 콘텐츠");
      const desiredTemplateId =
        (templateId ?? opts?.templateId ?? "").trim() ||
        edu?.templateId ||
        DEFAULT_TEMPLATE_ID ||
        "";
      const desiredDepartmentScope =
        departmentScope ?? opts?.departmentScope ?? edu?.departmentScope;

      try {
        // 선택 교육 컨텍스트 고정
        setSelectedEducationId(eid);

        const { videoId: createdVideoId } = await createDraftForEducation({
          educationId: eid,
          title: desiredTitle,
          templateId: desiredTemplateId || undefined,
          departmentScope:
            Array.isArray(desiredDepartmentScope) &&
            desiredDepartmentScope.length > 0
              ? desiredDepartmentScope
              : undefined,
        });

        const loaded = await refreshItems({ silent: true });

        // 서버가 videoId를 바로 안 주는 케이스 대비: educationId 기준으로 “가장 최근” 항목을 찾아 선택
        const vid =
          (createdVideoId && createdVideoId.trim().length > 0
            ? createdVideoId.trim()
            : null) ??
          (loaded
            ? pickMostRecentVideoIdForEducation(eid, loaded.items)
            : null);

        if (!vid) {
          showToast("error", "초안 생성에 실패했습니다.");
          return null;
        }

        // 선택 + 탭 이동(초안은 항상 draft 탭으로)
        selectItem(vid);
        setTab("draft");

        showToast("success", "새 콘텐츠 초안이 생성되었습니다.");
        return vid;
      } catch (e) {
        const status = extractHttpStatus(e);
        const msg = e instanceof Error ? e.message : "초안 생성 실패";
        const tail = status ? ` (HTTP ${status})` : "";
        showToast(
          "error",
          `초안 생성 중 오류가 발생했습니다.${tail} ${msg}`,
          3600
        );
        return null;
      }
    },

    // state
    tab,
    setTab,
    query,
    setQuery,
    sortMode,
    setSortMode,
    items,
    filteredItems,
    selectedId,
    selectedItem,
    selectedValidation,
    toast,

    // editor target + actions
    scriptEditor,
    openScriptEditorForSelected,
    openScriptEditorForEducation,
    closeScriptEditor,
    onScriptSaved,

    // actions
    selectItem,
    createDraft,
    updateSelectedMeta,
    attachFileToSelected,
    runPipelineForSelected,
    runVideoOnlyForSelected,
    retryPipelineForSelected,
    failPipelineForSelected,
    updateSelectedScript,
    showToast,
    requestReviewForSelected,
    reopenRejectedToDraft,
    deleteDraft,
    addSourceFilesToSelected,
    removeSourceFileFromSelected,
    creatorCatalog,
    // optional
    refreshItems,
    // internal utility (씬 저장 후 로컬 상태 업데이트용)
    updateSelected,
  };
}
