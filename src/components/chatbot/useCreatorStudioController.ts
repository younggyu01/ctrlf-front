// src/components/chatbot/useCreatorStudioController.ts

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CREATOR_CATEGORIES,
  CREATOR_DEPARTMENTS,
  CREATOR_JOB_TRAININGS,
  CREATOR_VIDEO_TEMPLATES,
  categoryLabel,
  createMockCreatorWorkItems,
  deptLabel,
  formatDateTime,
  jobTrainingLabel,
  labelStatus,
  mockGenerateScript,
  mockVideoUrl,
  templateLabel,
  getCategoryKind,
  isJobCategory,
} from "./creatorStudioMocks";
import type {
  CategoryOption,
  CreatorTabId,
  CreatorType,
  CreatorValidationResult,
  CreatorWorkItem,
  CreatorSortMode,
  DepartmentOption,
  CreatorSourceFile,
} from "./creatorStudioTypes";
import {
  listReviewItemsSnapshot,
  submitCreatorReviewRequest,
} from "./reviewFlowStore";

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

  // eslint no-control-regex 회피: 정규식 대신 코드포인트로 ASCII 제어문자 제거
  let cleaned = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    // 0x00~0x1F(제어문자), 0x7F(DEL) 제거
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
  if (name !== file.name) warnings.push("파일명에 포함된 특수/제어 문자를 정리했습니다.");

  if (!name) issues.push("파일명이 비어있습니다.");
  if (name.length >= MAX_SOURCE_FILE_NAME_LENGTH)
    warnings.push("파일명이 너무 길어 일부가 잘렸습니다.");

  if (file.size <= 0) issues.push("파일 크기가 0B 입니다.");
  if (file.size > MAX_SOURCE_FILE_SIZE_BYTES)
    issues.push("파일이 너무 큽니다. (최대 50MB)");

  if (!isAllowedSourceFileName(name)) {
    issues.push("지원하지 않는 파일 형식입니다. (PDF/DOC/DOCX/PPT/PPTX/HWP/HWPX)");
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

function tabMatchesStatus(tab: CreatorTabId, item: CreatorWorkItem): boolean {
  const stage1Approved = getScriptApprovedAt(item) != null;

  switch (tab) {
    case "draft":
      // 초안 탭에서는 "1차 승인 완료된 초안(DRAFT+scriptApprovedAt)"은 제외 (중복 방지)
      return (item.status === "DRAFT" || item.status === "GENERATING") && !stage1Approved;

    case "review_pending":
      return item.status === "REVIEW_PENDING";

    case "rejected":
      return item.status === "REJECTED";

    case "approved":
      // 승인 탭 = 2차 최종 승인(APPROVED) + 1차 승인 완료(DRAFT/GENERATING + scriptApprovedAt)
      return (
        item.status === "APPROVED" ||
        ((item.status === "DRAFT" || item.status === "GENERATING") && stage1Approved)
      );

    case "failed":
      return item.status === "FAILED";

    default:
      return true;
  }
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
  // 반려/승인/검토대기/생성중은 “읽기 전용”
  // → 반려는 '새 버전으로 편집' 액션으로만 다시 작업
  return (
    item.status === "REVIEW_PENDING" ||
    item.status === "APPROVED" ||
    item.status === "REJECTED" ||
    item.status === "GENERATING" ||
    item.pipeline.state === "RUNNING"
  );
}

/**
 * "이미 생성된 결과를 무효화하는 변경"인지 판별
 */
function hadGeneratedOutput(item: CreatorWorkItem): boolean {
  return Boolean(
    item.assets.videoUrl ||
    item.assets.thumbnailUrl ||
    item.pipeline.state === "SUCCESS"
  );
}

const PIPELINE_MODE_FULL = "FULL" as CreatorWorkItem["pipeline"]["mode"];
const PIPELINE_MODE_VIDEO_ONLY =
  "VIDEO_ONLY" as CreatorWorkItem["pipeline"]["mode"];
const PIPELINE_MODE_SCRIPT_ONLY =
  "SCRIPT_ONLY" as CreatorWorkItem["pipeline"]["mode"];

function resetPipeline(
  mode: CreatorWorkItem["pipeline"]["mode"] = PIPELINE_MODE_FULL
): CreatorWorkItem["pipeline"] {
  return { mode, state: "IDLE", stage: null, progress: 0 };
}

function clearGeneratedAllAssets(item: CreatorWorkItem): CreatorWorkItem["assets"] {
  return {
    ...item.assets,
    script: "",
    videoUrl: "",
    thumbnailUrl: "",
  };
}

function clearVideoAssetsOnly(item: CreatorWorkItem): CreatorWorkItem["assets"] {
  return {
    ...item.assets,
    videoUrl: "",
    thumbnailUrl: "",
  };
}

function normalizeCreatorSourceFilesForItem(it: CreatorWorkItem): CreatorWorkItem {
  const src = Array.isArray(it.assets.sourceFiles) ? it.assets.sourceFiles.slice() : [];

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

function normalizeCreatorSourceFiles(items: CreatorWorkItem[]): CreatorWorkItem[] {
  return items.map(normalizeCreatorSourceFilesForItem);
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
  // DEPT_CREATOR는 전사(빈 배열) 타겟 아이템은 다루지 않게 한다.
  if (!item.targetDeptIds || item.targetDeptIds.length === 0) return false;
  return item.targetDeptIds.some((id) => allowedDeptIds.includes(id));
}

/**
 * 카테고리 타입(직무/4대) 판별 텍스트(검색/표시용)
 */
function categoryKindText(categoryId: string): string {
  const kind = getCategoryKind(categoryId);
  const job = isJobCategory(categoryId);
  if (job) return `직무 job ${String(kind).toLowerCase()}`;
  return `4대 mandatory ${String(kind).toLowerCase()}`;
}

/**
 * stage 판별: scriptApprovedAt은 number/string/0/빈문자 등 케이스를 안전하게 처리한다.
 * - number: >0만 승인으로 인정
 * - string: 숫자 문자열 또는 ISO/date parse 가능하면 >0만 승인
 */
function getScriptApprovedAt(item: unknown): number | null {
  if (!item || typeof item !== "object") return null;
  const v = (item as Record<string, unknown>)["scriptApprovedAt"];

  if (typeof v === "number" && Number.isFinite(v)) {
    return v > 0 ? v : null;
  }

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

  // 템플릿 선택 필수
  if (!item.templateId) issues.push("영상 템플릿을 선택해주세요.");

  // 직무일 때만 Training ID 필수
  if (isJobCategory(item.categoryId)) {
    if (!item.jobTrainingId) issues.push("직무교육(Training ID)을 선택해주세요.");
  }

  // 자료 파일
  if (!item.assets.sourceFileName) {
    issues.push("교육 자료 파일을 업로드해주세요.");
  } else if (!isAllowedSourceFileName(item.assets.sourceFileName)) {
    issues.push(
      "교육 자료 파일 형식이 올바르지 않습니다. PDF/DOC/DOCX/PPT/PPTX/HWP/HWPX만 허용됩니다."
    );
  }

  // 크기 제한(서버에서도 동일 제한 전제)
  if (
    item.assets.sourceFileSize &&
    item.assets.sourceFileSize > MAX_SOURCE_FILE_SIZE_BYTES
  ) {
    issues.push("교육 자료 파일이 너무 큽니다. (최대 50MB)");
  }

  // 스크립트
  const hasScript = Boolean(item.assets.script && item.assets.script.trim().length > 0);
  if (!hasScript) issues.push("스크립트가 준비되지 않았습니다.");

  // FINAL(2차)일 때만 영상 필요
  if (mode === "FINAL") {
    const hasVideo = Boolean(item.assets.videoUrl && item.assets.videoUrl.trim().length > 0);
    if (!hasVideo) issues.push("영상이 생성되지 않았습니다.");
  }

  /**
   * 중요 패치:
   * - SCRIPT(1차) 모드에서는 pipeline SUCCESS를 강제하지 않는다.
   *   (스크립트를 생성 후 수정하거나, 수동으로 작성해도 1차 검토 요청 가능해야 함)
   * - 다만 RUNNING이면 요청 금지 (실행 중에는 제출 불가)
   */
  if (item.pipeline.state === "RUNNING") {
    issues.push("자동 생성이 진행 중입니다. 완료 후 검토 요청이 가능합니다.");
  }
  if (item.pipeline.state === "FAILED") {
    // 상태상 DRAFT/FAILED 등이 섞일 수 있어 안전장치로 메시지 보강
    issues.push("자동 생성이 실패했습니다. 재시도 후 검토 요청이 가능합니다.");
  }

  if (item.status !== "DRAFT") {
    issues.push("초안(DRAFT) 상태에서만 검토 요청이 가능합니다.");
  }

  /**
   * 단일 축(4대) 정책:
   * - 4대 카테고리는 전사 대상 고정
   * - DEPT_CREATOR는 4대 제작 불가
   * - (모델 상 isMandatory가 있더라도, 4대는 사실상 전사 필수)
   */
  if (mandatoryCategory) {
    if (ctx.creatorType === "DEPT_CREATOR") {
      issues.push("부서 제작자는 4대 의무교육(전사 필수) 콘텐츠를 제작할 수 없습니다.");
    }
    if (item.targetDeptIds && item.targetDeptIds.length > 0) {
      issues.push("4대 의무교육은 전사 대상으로 고정됩니다.");
    }
    if (!item.isMandatory) {
      issues.push("4대 의무교육은 필수 교육으로만 생성할 수 있습니다.");
    }
  }

  // DEPT_CREATOR 제약: 전사 대상 금지(최소 1개 부서 필수) + allowed 범위 밖 금지
  if (isDeptCreator) {
    if (!item.targetDeptIds || item.targetDeptIds.length === 0) {
      issues.push("부서 제작자는 대상 부서를 최소 1개 이상 선택해야 합니다.");
    } else if (allowedDeptIds && allowedDeptIds.length > 0) {
      const invalid = item.targetDeptIds.filter((id) => !allowedDeptIds.includes(id));
      if (invalid.length > 0) {
        issues.push("대상 부서에 허용되지 않은 부서가 포함되어 있습니다.");
      }
    }

    // DEPT_CREATOR는 isMandatory 금지
    if (item.isMandatory) {
      issues.push("부서 제작자는 필수 교육으로 지정할 수 없습니다.");
    }
  }

  // isMandatory(카테고리와 별개로 켜진 경우) = 전사 대상 강제
  if (item.isMandatory) {
    if (item.targetDeptIds && item.targetDeptIds.length > 0) {
      issues.push("필수 교육은 전사 대상으로만 지정할 수 있습니다.");
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * “영상만 재생성” 필요 조건:
 * - 스크립트는 있고, 영상이 비어있는 상태(스크립트 수정/버전 업 등)
 * - 자료 파일도 있어야 함
 */
function shouldUseVideoOnly(item: CreatorWorkItem): boolean {
  const hasScript = Boolean(item.assets.script && item.assets.script.trim().length > 0);
  const hasFile = Boolean(item.assets.sourceFileName);
  const hasVideo = Boolean(item.assets.videoUrl && item.assets.videoUrl.trim().length > 0);
  return hasScript && hasFile && !hasVideo;
}

type ReviewStoreItem = ReturnType<typeof listReviewItemsSnapshot>[number];

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

function reviewHasVideo(r: ReviewStoreItem): boolean {
  const v = (r as { videoUrl?: string }).videoUrl ?? "";
  return v.trim().length > 0;
}

function reviewStageOf(r: ReviewStoreItem): "SCRIPT" | "FINAL" {
  return reviewHasVideo(r) ? "FINAL" : "SCRIPT";
}

/** 스토어 아이템에 시간이 없을 수도 있으니 여러 키를 순회해서 최대한 “그럴듯한 시각”을 뽑는다 */
function reviewTimeOf(r: ReviewStoreItem): number {
  const keys = ["reviewedAt", "updatedAt", "submittedAt", "createdAt"] as const;
  for (const k of keys) {
    const t = readNum(r, k);
    if (typeof t === "number" && t > 0) return t;
  }
  return Date.now();
}

function reviewCommentOf(r: ReviewStoreItem): string | undefined {
  const keys = ["comment", "reviewerComment", "rejectedComment", "rejectReason", "note"] as const;
  for (const k of keys) {
    const s = readStr(r, k);
    if (s && s.trim().length > 0) return s;
  }
  return undefined;
}

function pickLatest(reviews: ReviewStoreItem[]): ReviewStoreItem | null {
  if (!reviews || reviews.length === 0) return null;
  let best = reviews[0];
  let bestT = reviewTimeOf(best);
  for (let i = 1; i < reviews.length; i++) {
    const t = reviewTimeOf(reviews[i]);
    if (t >= bestT) {
      best = reviews[i];
      bestT = t;
    }
  }
  return best ?? null;
}

/**
 * reviewFlowStore 상태를 CreatorWorkItem에 반영한다.
 * - 1차 승인(스크립트) => scriptApprovedAt 세팅 + status=DRAFT 복귀
 * - 2차 승인(최종)     => status=APPROVED
 * - 반려/대기          => status/코멘트/단계 필드 반영
 */
function applyReviewStoreSync(prev: CreatorWorkItem[], reviews: ReviewStoreItem[]): CreatorWorkItem[] {
  if (!prev || prev.length === 0) return prev;

  // contentId 기준으로 그룹화
  const map = new Map<string, { script: ReviewStoreItem[]; final: ReviewStoreItem[] }>();
  for (const r of reviews) {
    const contentId = (r as { contentId?: string }).contentId;
    if (!contentId) continue;

    const bucket = map.get(contentId) ?? { script: [], final: [] };
    if (reviewStageOf(r) === "FINAL") bucket.final.push(r);
    else bucket.script.push(r);
    map.set(contentId, bucket);
  }

  let changedAny = false;

  const next = prev.map((it) => {
    const bucket = map.get(it.id);
    if (!bucket) return it;

    const latestFinal = pickLatest(bucket.final);
    const latestScript = pickLatest(bucket.script);

    let nextStatus = it.status;
    let nextScriptApprovedAt = it.scriptApprovedAt;
    let nextReviewStage = it.reviewStage;
    let nextRejectedStage = it.rejectedStage;
    let nextRejectedComment = it.rejectedComment;

    // 우선순위: FINAL(2차) 결과가 있으면 FINAL이 최종 상태를 결정
    if (latestFinal) {
      const st = (latestFinal as { status?: CreatorWorkItem["status"] }).status;

      if (st === "APPROVED") {
        nextStatus = "APPROVED";
        nextReviewStage = undefined;
        nextRejectedStage = undefined;
        nextRejectedComment = undefined;

        // FINAL 승인만 있고 scriptApprovedAt이 비어있으면(이상 케이스) 시간 보정
        if (!nextScriptApprovedAt) nextScriptApprovedAt = reviewTimeOf(latestFinal);
      } else if (st === "REJECTED") {
        nextStatus = "REJECTED";
        nextReviewStage = undefined;
        nextRejectedStage = "FINAL";
        nextRejectedComment =
          reviewCommentOf(latestFinal) ?? "최종(2차) 검토에서 반려되었습니다.";
      } else if (st === "REVIEW_PENDING") {
        nextStatus = "REVIEW_PENDING";
        nextReviewStage = "FINAL";
        nextRejectedStage = undefined;
        nextRejectedComment = undefined;
      }
    } else if (latestScript) {
      const st = (latestScript as { status?: CreatorWorkItem["status"] }).status;

      if (st === "APPROVED") {
        // 핵심: 1차 승인 → 영상 제작 가능 상태로 전환
        nextScriptApprovedAt = nextScriptApprovedAt ?? reviewTimeOf(latestScript);
        nextStatus = "DRAFT"; // REVIEW_PENDING에서 복귀
        nextReviewStage = undefined;
        nextRejectedStage = undefined;
        nextRejectedComment = undefined;
      } else if (st === "REJECTED") {
        nextStatus = "REJECTED";
        nextReviewStage = undefined;
        nextRejectedStage = "SCRIPT";
        nextRejectedComment =
          reviewCommentOf(latestScript) ?? "1차(스크립트) 검토에서 반려되었습니다.";
        // 1차 반려면 scriptApprovedAt은 의미가 없으니 제거
        nextScriptApprovedAt = undefined;
      } else if (st === "REVIEW_PENDING") {
        nextStatus = "REVIEW_PENDING";
        nextReviewStage = "SCRIPT";
        nextRejectedStage = undefined;
        nextRejectedComment = undefined;
      }
    }

    const changed =
      nextStatus !== it.status ||
      nextScriptApprovedAt !== it.scriptApprovedAt ||
      nextReviewStage !== it.reviewStage ||
      nextRejectedStage !== it.rejectedStage ||
      nextRejectedComment !== it.rejectedComment;

    if (!changed) return it;

    changedAny = true;

    // updatedAt은 리뷰 이벤트 시각으로 끌어올려 정렬/표시에 반영
    const t = latestFinal
      ? reviewTimeOf(latestFinal)
      : latestScript
        ? reviewTimeOf(latestScript)
        : Date.now();

    return {
      ...it,
      status: nextStatus,
      scriptApprovedAt: nextScriptApprovedAt,
      reviewStage: nextReviewStage,
      rejectedStage: nextRejectedStage,
      rejectedComment: nextRejectedComment,
      updatedAt: Math.max(it.updatedAt, t),
    };
  });

  return changedAny ? next : prev;
}

export function useCreatorStudioController(options?: UseCreatorStudioControllerOptions) {
  const creatorName = options?.creatorName ?? "VIDEO_CREATOR";
  const allowedDeptIds = options?.allowedDeptIds ?? null;

  const creatorType: CreatorType =
    options?.creatorType ??
    (allowedDeptIds && allowedDeptIds.length > 0 ? "DEPT_CREATOR" : "GLOBAL_CREATOR");

  const isDeptCreator = creatorType === "DEPT_CREATOR";

  const [items, setItems] = useState<CreatorWorkItem[]>(() =>
    normalizeCreatorSourceFiles(createMockCreatorWorkItems())
  );
  const [tab, setTab] = useState<CreatorTabId>("draft");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<CreatorSortMode>("updated_desc");

  /**
   * rawSelectedId: 사용자가 마지막으로 의도적으로 선택한 값
   * - items/tab 변경에 의해 강제 setState 하지 않고,
   * - selectedId(useMemo)에서 “항상 유효”하게 보정한다.
   */
  const [rawSelectedId, setRawSelectedId] = useState<string | null>(null);

  const [toast, setToast] = useState<CreatorToast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // 파이프라인 타이머(전체에서 1개만) - mock
  const timerRef = useRef<number | null>(null);

  // updateSelectedScript 토스트 스팸 방지(throttle)
  const scriptToastRef = useRef<{ id: string | null; ts: number }>({ id: null, ts: 0 });

  const clearToastSoon = (ms = 2200) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), ms);
  };

  const showToast = (kind: ToastKind, message: string, ms?: number) => {
    setToast({ kind, message });
    clearToastSoon(ms ?? (kind === "error" ? 3000 : 2200));
  };

  const stopPipelineTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const departments: DepartmentOption[] = useMemo(() => {
    if (!allowedDeptIds || allowedDeptIds.length === 0) return CREATOR_DEPARTMENTS;
    return CREATOR_DEPARTMENTS.filter((d) => allowedDeptIds.includes(d.id));
  }, [allowedDeptIds]);

  /**
   * P0: DEPT_CREATOR는 4대(전사 필수) 카테고리 선택/제작 불가
   * → UI/초안 생성 단계에서 목록 자체를 필터링해서 UX에서 원천 차단
   */
  const categories: CategoryOption[] = useMemo(() => {
    if (!isDeptCreator) return CREATOR_CATEGORIES;
    return CREATOR_CATEGORIES.filter((c) => isJobCategory(c.id));
  }, [isDeptCreator]);

  const templates = useMemo(() => CREATOR_VIDEO_TEMPLATES, []);
  const jobTrainings = useMemo(() => CREATOR_JOB_TRAININGS, []);

  const ensureTemplateId = (raw?: string | null) => {
    const fallback = templates[0]?.id ?? "";
    if (!raw) return fallback;
    return templates.some((t) => t.id === raw) ? raw : fallback;
  };

  const ensureJobTrainingId = (raw?: string | null) => {
    const fallback = jobTrainings[0]?.id ?? "";
    if (!raw) return fallback;
    return jobTrainings.some((t) => t.id === raw) ? raw : fallback;
  };

  /**
   * jobTrainingId 규칙
   * - 직무 카테고리: 유효값 유지, 없으면 기본값으로 자동 세팅
   * - 4대 카테고리: 항상 undefined로 제거(비활성)
   */
  function normalizeJobTrainingIdByCategory(
    categoryId: string,
    raw: string | null | undefined,
    ensure: (v?: string | null) => string
  ): string | undefined {
    if (!isJobCategory(categoryId)) return undefined; // 4대면 제거
    const ensured = ensure(raw ?? "");
    return ensured || undefined;
  }

  /**
   * targetDeptIds 규칙 (단일 축 + isMandatory 포함)
   * - 4대 카테고리: 무조건 전사([]) 고정
   * - isMandatory=true: 전사([]) 고정
   * - DEPT_CREATOR: 전사([]) 금지 → 최소 1개 유지
   */
  const normalizeTargetDeptIds = (
    rawIds: string[] | undefined,
    nextIsMandatory: boolean,
    categoryId: string
  ) => {
    if (isMandatoryByCategory(categoryId)) return []; // 4대는 전사 고정
    if (nextIsMandatory) return []; // 필수는 전사 고정

    const ids = uniq((rawIds ?? []).filter(Boolean));

    // 전사 대상(빈 배열)은 GLOBAL만 허용, DEPT는 금지
    if (ids.length === 0) {
      if (!isDeptCreator) return [];
      const first = departments[0]?.id;
      return first ? [first] : [];
    }

    // 현재 존재하는 부서만 허용 + (DEPT_CREATOR면 allowedDeptIds 내로 추가 제한)
    const allDeptSet = new Set(departments.map((d) => d.id));
    let filtered = ids.filter((id) => allDeptSet.has(id));

    if (isDeptCreator && allowedDeptIds && allowedDeptIds.length > 0) {
      const allowedSet = new Set(allowedDeptIds);
      filtered = filtered.filter((id) => allowedSet.has(id));
    }

    if (filtered.length > 0) return filtered;

    // 전부 걸러졌다면:
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

  /**
   * 버전 히스토리 엔트리 타입 추론(any 금지 대응)
   */
  type VersionEntry = CreatorWorkItem["versionHistory"] extends Array<infer E> ? E : never;

  const makeVersionEntry = (item: CreatorWorkItem, reason: string): VersionEntry => {
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

  /**
   * 반려 → 새 버전으로 작업 (P0)
   * - 기존 버전은 versionHistory로 누적(감사/추적)
   * - 새 버전은 DRAFT로 전환 + 편집 가능
   * - 스크립트/파일은 유지하되, 영상/썸네일은 비워 “영상만 재생성”을 자연스럽게 유도
   */
  const bumpVersionForRework = (item: CreatorWorkItem, reason: string) => {
    const now = Date.now();
    const prevHistory = Array.isArray(item.versionHistory) ? item.versionHistory : [];
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
    };

    // 단일 축 강제 정규화(안전)
    const mandatoryCategory = isMandatoryByCategory(next.categoryId);
    if (mandatoryCategory) {
      next.isMandatory = true;
      next.targetDeptIds = [];
      next.jobTrainingId = undefined;
    } else if (isDeptCreator) {
      next.isMandatory = false;
      next.targetDeptIds = normalizeTargetDeptIds(next.targetDeptIds, false, next.categoryId);
    }

    return next;
  };

  /**
   * selectedId를 “보정된 값”으로 파생 계산
   * - DEPT_CREATOR는 scope 밖 아이템(전사 대상 등)을 선택/노출에서 제외
   */
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

  /**
   * 초기 mock 데이터가 규칙과 어긋나도 1회 정규화
   * - 단일 축(4대) 강제, jobTrainingId 제거/보정, templateId 보정, DEPT_CREATOR 정책 보정 등
   */
  useEffect(() => {
    setItems((prev) =>
      prev.map((it) => {
        const nextCategoryId = it.categoryId;
        const mandatoryCategory = isMandatoryByCategory(nextCategoryId);

        const nextCategoryLabel = categoryLabel(nextCategoryId);
        const nextTemplateId = ensureTemplateId(it.templateId ?? "");
        const nextJobTrainingId = normalizeJobTrainingIdByCategory(
          nextCategoryId,
          it.jobTrainingId ?? null,
          ensureJobTrainingId
        );

        let nextIsMandatory = mandatoryCategory ? true : it.isMandatory;

        if (isDeptCreator && nextIsMandatory) nextIsMandatory = false;

        const nextTargetDeptIds = normalizeTargetDeptIds(
          it.targetDeptIds,
          nextIsMandatory,
          nextCategoryId
        );

        const nextVersion = typeof it.version === "number" && it.version >= 1 ? it.version : 1;
        const nextHistory = Array.isArray(it.versionHistory) ? it.versionHistory : [];

        const changed =
          it.categoryLabel !== nextCategoryLabel ||
          it.templateId !== nextTemplateId ||
          it.jobTrainingId !== nextJobTrainingId ||
          it.isMandatory !== nextIsMandatory ||
          it.targetDeptIds.join("|") !== nextTargetDeptIds.join("|") ||
          it.version !== nextVersion ||
          it.versionHistory !== nextHistory;

        if (!changed) return it;

        return {
          ...it,
          categoryLabel: nextCategoryLabel,
          templateId: nextTemplateId,
          jobTrainingId: nextJobTrainingId,
          isMandatory: nextIsMandatory,
          targetDeptIds: nextTargetDeptIds,
          version: nextVersion,
          versionHistory: nextHistory,
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            it.categoryLabel,
            categoryKindText(it.categoryId),
            labelStatus(it.status),
            `v${String(it.version ?? 1)}`,
            deptText,
            it.assets.sourceFileName ?? "",
            formatDateTime(it.updatedAt),
            templateLabel(it.templateId),
            it.jobTrainingId ? jobTrainingLabel(it.jobTrainingId) : "",
            it.isMandatory ? "필수 mandatory" : "선택 optional",
          ]
            .join(" ")
            .toLowerCase();

          return includesAny(hay, qTokens);
        });

    return sortItems(searched, sortMode);
  }, [items, query, sortMode, tab, isDeptCreator, allowedDeptIds]);

  const selectedValidation = useMemo(() => {
    if (!selectedItem) return { ok: false, issues: ["선택된 콘텐츠가 없습니다."] };

    const approvedAt = getScriptApprovedAt(selectedItem);
    const mode: "SCRIPT" | "FINAL" = approvedAt != null ? "FINAL" : "SCRIPT";

    return validateForReview(selectedItem, scopeCtx, mode);
  }, [selectedItem, scopeCtx]);

  const selectItem = (id: string) => setRawSelectedId(id);

  const createDraft = () => {
    const now = Date.now();

    const defaultCategoryId = categories[0]?.id ?? "C001";
    const defaultCategoryLabel = categories[0]?.name ?? categoryLabel(defaultCategoryId);

    const defaultTemplateId = ensureTemplateId(templates[0]?.id ?? "");

    const mandatoryCategory = isMandatoryByCategory(defaultCategoryId);

    const defaultJobTrainingId = isJobCategory(defaultCategoryId)
      ? ensureJobTrainingId(jobTrainings[0]?.id ?? "")
      : undefined;

    const defaultTargetDeptIds = mandatoryCategory
      ? []
      : departments[0]?.id
        ? [departments[0].id]
        : [];

    const next: CreatorWorkItem = {
      id: makeId("CR"),
      version: 1,
      versionHistory: [],
      title: "새 교육 콘텐츠",
      categoryId: defaultCategoryId,
      categoryLabel: defaultCategoryLabel,
      templateId: defaultTemplateId,
      jobTrainingId: defaultJobTrainingId,

      isMandatory: mandatoryCategory ? true : false,

      targetDeptIds: normalizeTargetDeptIds(
        defaultTargetDeptIds,
        mandatoryCategory ? true : false,
        defaultCategoryId
      ),

      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
      createdByName: creatorName,

      assets: {
        sourceFileName: "",
        sourceFileSize: 0,
        sourceFileMime: "",
        script: "",
        videoUrl: "",
        thumbnailUrl: "",
      },

      pipeline: resetPipeline(),
      failedReason: undefined,
      rejectedComment: undefined,
    };

    setItems((prev) => [next, ...prev]);
    setRawSelectedId(next.id);
    setTab("draft");
    showToast("success", "새 초안이 생성되었습니다.");
  };

  const updateSelected = (patch: Partial<CreatorWorkItem>) => {
    if (!selectedId) return;
    setItems((prev) =>
      prev.map((it) => (it.id === selectedId ? { ...it, ...patch, updatedAt: Date.now() } : it))
    );
  };

  const updateSelectedMeta = (
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
      showToast("info", "1차(스크립트) 승인 이후에는 기본 정보를 수정할 수 없습니다.");
      return;
    }

    if (isLockedForEdit(selectedItem)) {
      showToast("info", "검토 대기/승인/반려/생성 중 상태에서는 편집할 수 없습니다.");
      return;
    }

    const nextTitle = patch.title ?? selectedItem.title;

    const desiredCategoryId = patch.categoryId ?? selectedItem.categoryId;
    const desiredMandatoryCategory = isMandatoryByCategory(desiredCategoryId);

    if (isDeptCreator && desiredMandatoryCategory) {
      showToast("info", "부서 제작자는 4대 의무교육(전사 필수) 카테고리를 선택할 수 없습니다.");
      return;
    }

    const nextCategoryId = desiredCategoryId;
    const nextCategoryLabel = categoryLabel(nextCategoryId);

    const nextTemplateId = ensureTemplateId(patch.templateId ?? selectedItem.templateId ?? "");

    const nextJobTrainingId = normalizeJobTrainingIdByCategory(
      nextCategoryId,
      patch.jobTrainingId ?? selectedItem.jobTrainingId ?? null,
      ensureJobTrainingId
    );

    let nextIsMandatory = patch.isMandatory ?? selectedItem.isMandatory;

    if (desiredMandatoryCategory) nextIsMandatory = true;
    if (isDeptCreator && nextIsMandatory) {
      nextIsMandatory = false;
      showToast("info", "부서 제작자는 필수 교육으로 지정할 수 없습니다.");
    }

    const nextTargetDeptIds = normalizeTargetDeptIds(
      patch.targetDeptIds ?? selectedItem.targetDeptIds,
      nextIsMandatory,
      nextCategoryId
    );

    const prevJobTrainingId = selectedItem.jobTrainingId ?? "";
    const nextJobTrainingCompare = nextJobTrainingId ?? "";

    const willInvalidate =
      nextTitle !== selectedItem.title ||
      nextCategoryId !== selectedItem.categoryId ||
      nextTemplateId !== (selectedItem.templateId ?? "") ||
      (isJobCategory(nextCategoryId) && nextJobTrainingCompare !== prevJobTrainingId) ||
      nextIsMandatory !== selectedItem.isMandatory ||
      nextTargetDeptIds.join("|") !== selectedItem.targetDeptIds.join("|");

    const normalizedPatch: Partial<CreatorWorkItem> = {
      title: nextTitle,
      categoryId: nextCategoryId,
      categoryLabel: nextCategoryLabel,
      templateId: nextTemplateId,
      jobTrainingId: nextJobTrainingId,
      targetDeptIds: nextTargetDeptIds,
      isMandatory: nextIsMandatory,
    };

    if (willInvalidate && hadGeneratedOutput(selectedItem)) {
      normalizedPatch.assets = clearGeneratedAllAssets(selectedItem);
      normalizedPatch.pipeline = resetPipeline();
      normalizedPatch.failedReason = undefined;

      updateSelected(normalizedPatch);
      showToast("info", "기본 정보가 변경되어 생성 결과가 초기화되었습니다. 자동 생성을 다시 실행해 주세요.");
      return;
    }

    updateSelected(normalizedPatch);
  };

  const addSourceFilesToSelected = (files: File[]) => {
    if (!selectedItem) return;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      showToast("info", "1차(스크립트) 승인 이후에는 자료 파일을 변경할 수 없습니다.");
      return;
    }

    if (isLockedForEdit(selectedItem)) {
      showToast("info", "검토 대기/승인/반려/생성 중 상태에서는 파일을 변경할 수 없습니다.");
      return;
    }

    const cur = normalizeCreatorSourceFilesForItem(selectedItem);
    const prevFiles = Array.isArray(cur.assets.sourceFiles) ? cur.assets.sourceFiles.slice() : [];

    const existingNames = new Set(prevFiles.map((x) => x.name.trim().toLowerCase()));

    const added: CreatorSourceFile[] = [];
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

      added.push({
        id: makeId("SRC"),
        name: v.name,
        size: v.size,
        mime: v.mime ?? "",
        addedAt: Date.now(),
      });
    }

    if (added.length === 0) return;

    const nextFiles = [...prevFiles, ...added];
    const primary = nextFiles[0];

    updateSelected({
      assets: {
        ...clearGeneratedAllAssets(selectedItem),
        sourceFiles: nextFiles,
        sourceFileName: primary?.name ?? "",
        sourceFileSize: primary?.size ?? 0,
        sourceFileMime: primary?.mime ?? "",
      },
      pipeline: resetPipeline(),
      failedReason: undefined,
    });

    showToast("success", "파일이 업로드되었습니다. 자동 생성을 실행해 주세요.");
  };

  const removeSourceFileFromSelected = (fileId: string) => {
    if (!selectedItem) return;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      showToast("info", "1차(스크립트) 승인 이후에는 자료 파일을 변경할 수 없습니다.");
      return;
    }

    if (isLockedForEdit(selectedItem)) {
      showToast("info", "검토 대기/승인/반려/생성 중 상태에서는 파일을 변경할 수 없습니다.");
      return;
    }

    const cur = normalizeCreatorSourceFilesForItem(selectedItem);
    const prevFiles = Array.isArray(cur.assets.sourceFiles) ? cur.assets.sourceFiles.slice() : [];

    const removed = prevFiles.find((x) => x.id === fileId);
    const nextFiles = prevFiles.filter((x) => x.id !== fileId);
    if (nextFiles.length === prevFiles.length) return;

    const primary = nextFiles[0];

    updateSelected({
      assets: {
        ...clearGeneratedAllAssets(selectedItem),
        sourceFiles: nextFiles,
        sourceFileName: primary?.name ?? "",
        sourceFileSize: primary?.size ?? 0,
        sourceFileMime: primary?.mime ?? "",
      },
      pipeline: resetPipeline(),
      failedReason: undefined,
    });

    showToast("success", `파일이 삭제되었습니다${removed?.name ? `: ${removed.name}` : ""}.`);
  };

  // legacy 호환: 기존 단일 업로드 호출도 멀티로 흡수
  const attachFileToSelected = (file: File) => {
    addSourceFilesToSelected([file]);
  };

  /**
   * SCRIPT-ONLY pipeline: 업로드 → 스크립트
   * - P0: 동시에 하나만 실행(전체 items 기준)
   */
  const runPipelineForSelected = () => {
    if (!selectedItem) return;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      showToast(
        "info",
        "1차 승인 이후에는 스크립트 생성/재생성을 실행할 수 없습니다. 영상 생성(2차 준비)을 진행해 주세요."
      );
      return;
    }

    const anyRunning = items.some((it) => it.pipeline.state === "RUNNING");
    if (anyRunning) {
      showToast("info", "다른 콘텐츠의 자동 생성이 진행 중입니다. 완료 후 다시 시도해 주세요.");
      return;
    }

    const targetId = selectedItem.id;
    const mandatoryCategory = isMandatoryByCategory(selectedItem.categoryId);

    if (!selectedItem.templateId) {
      showToast("error", "영상 템플릿을 먼저 선택해 주세요.", 3000);
      return;
    }
    if (isJobCategory(selectedItem.categoryId) && !selectedItem.jobTrainingId) {
      showToast("error", "직무교육(Training ID)을 먼저 선택해 주세요.", 3000);
      return;
    }

    if (mandatoryCategory) {
      if (!selectedItem.isMandatory) {
        showToast("error", "4대 의무교육은 필수 교육으로만 생성할 수 있습니다.", 3000);
        return;
      }
      if (selectedItem.targetDeptIds.length > 0) {
        showToast("error", "4대 의무교육은 전사 대상으로 고정됩니다.", 3000);
        return;
      }
    }

    if (selectedItem.isMandatory && selectedItem.targetDeptIds.length > 0) {
      showToast("error", "필수 교육은 전사 대상으로만 지정할 수 있습니다.", 3000);
      return;
    }

    if (isDeptCreator && selectedItem.targetDeptIds.length === 0) {
      showToast("error", "부서 제작자는 대상 부서를 최소 1개 이상 선택해 주세요.", 3000);
      return;
    }

    if (!selectedItem.assets.sourceFileName) {
      showToast("error", "먼저 교육 자료 파일을 업로드해 주세요.", 3000);
      return;
    }
    if (!isAllowedSourceFileName(selectedItem.assets.sourceFileName)) {
      showToast(
        "error",
        "업로드된 파일 형식이 올바르지 않습니다. PDF/DOC/DOCX/PPT/PPTX/HWP/HWPX만 허용됩니다.",
        3500
      );
      return;
    }
    if (
      selectedItem.assets.sourceFileSize &&
      selectedItem.assets.sourceFileSize > MAX_SOURCE_FILE_SIZE_BYTES
    ) {
      showToast("error", "교육 자료 파일이 너무 큽니다. (최대 50MB)", 3500);
      return;
    }

    if (
      selectedItem.status === "REVIEW_PENDING" ||
      selectedItem.status === "APPROVED" ||
      selectedItem.status === "REJECTED"
    ) {
      showToast("info", "검토 대기/승인/반려 상태에서는 자동 생성을 실행할 수 없습니다.");
      return;
    }
    if (selectedItem.pipeline.state === "RUNNING" || selectedItem.status === "GENERATING") {
      showToast("info", "이미 자동 생성이 진행 중입니다.");
      return;
    }

    stopPipelineTimer();

    const startedAt = Date.now();
    updateSelected({
      status: "GENERATING",
      pipeline: {
        mode: PIPELINE_MODE_SCRIPT_ONLY,
        state: "RUNNING",
        stage: "UPLOAD",
        progress: 0,
        startedAt,
        message: "업로드 처리 중…",
      },
    });

    timerRef.current = window.setInterval(() => {
      setItems((prev) => {
        const next = prev.map((it): CreatorWorkItem => {
          if (it.id !== targetId) return it;
          if (it.pipeline.state !== "RUNNING") return it;

          const p = it.pipeline.progress;
          let stage = it.pipeline.stage ?? "UPLOAD";
          let message = it.pipeline.message ?? "";

          const inc = 4 + Math.floor(Math.random() * 7); // 4~10
          const np = clamp(p + inc, 0, 100);

          // SCRIPT_ONLY: VIDEO/THUMBNAIL 단계로 넘어가지 않게 정리
          if (np < 28) {
            stage = "UPLOAD";
            message = "업로드 처리 중…";
          } else if (np < 100) {
            stage = "SCRIPT";
            message = "스크립트 생성 중…";
          } else {
            stage = "DONE";
            message = "생성 완료";
          }

          if (np >= 100) {
            const finishedAt = Date.now();
            const script = mockGenerateScript(it.title, it.categoryLabel);

            return {
              ...it,
              status: "DRAFT",
              updatedAt: finishedAt,
              pipeline: {
                mode: PIPELINE_MODE_SCRIPT_ONLY,
                state: "SUCCESS",
                stage: "DONE",
                progress: 100,
                startedAt: it.pipeline.startedAt ?? startedAt,
                finishedAt,
                message: "생성 완료",
              },
              assets: {
                ...it.assets,
                script,
                videoUrl: "",
                thumbnailUrl: "",
              },
              failedReason: undefined,
            };
          }

          return {
            ...it,
            pipeline: {
              ...it.pipeline,
              progress: np,
              stage,
              message,
            },
          };
        });

        return next;
      });
    }, 480);
  };

  /**
   * VIDEO-ONLY pipeline: (스크립트 유지) 영상 → 썸네일
   * - P0: 동시에 하나만 실행(전체 items 기준)
   */
  const runVideoOnlyForSelected = () => {
    if (!selectedItem) return;

    // unused-vars 해결 + 성능: 스냅샷 1회만
    const reviews = listReviewItemsSnapshot();
    const stage1Approved =
      getScriptApprovedAt(selectedItem) != null ||
      reviews.some(
        (r) =>
          r.contentId === selectedItem.id &&
          (r.videoUrl ?? "").trim() === "" &&
          r.status === "APPROVED"
      );

    if (!stage1Approved) {
      showToast("error", "영상 생성은 1차(스크립트) 승인이 완료된 후에 가능합니다.", 3000);
      return;
    }

    const anyRunning = items.some((it) => it.pipeline.state === "RUNNING");
    if (anyRunning) {
      showToast("info", "다른 콘텐츠의 자동 생성이 진행 중입니다. 완료 후 다시 시도해 주세요.");
      return;
    }

    const targetId = selectedItem.id;
    const mandatoryCategory = isMandatoryByCategory(selectedItem.categoryId);

    if (!selectedItem.templateId) {
      showToast("error", "영상 템플릿을 먼저 선택해 주세요.", 3000);
      return;
    }
    if (isJobCategory(selectedItem.categoryId) && !selectedItem.jobTrainingId) {
      showToast("error", "직무교육(Training ID)을 먼저 선택해 주세요.", 3000);
      return;
    }

    if (mandatoryCategory) {
      if (!selectedItem.isMandatory) {
        showToast("error", "4대 의무교육은 필수 교육으로만 생성할 수 있습니다.", 3000);
        return;
      }
      if (selectedItem.targetDeptIds.length > 0) {
        showToast("error", "4대 의무교육은 전사 대상으로 고정됩니다.", 3000);
        return;
      }
    }

    if (selectedItem.isMandatory && selectedItem.targetDeptIds.length > 0) {
      showToast("error", "필수 교육은 전사 대상으로만 지정할 수 있습니다.", 3000);
      return;
    }
    if (isDeptCreator && selectedItem.targetDeptIds.length === 0) {
      showToast("error", "부서 제작자는 대상 부서를 최소 1개 이상 선택해 주세요.", 3000);
      return;
    }

    if (!selectedItem.assets.sourceFileName) {
      showToast("error", "먼저 교육 자료 파일을 업로드해 주세요.", 3000);
      return;
    }
    if (!isAllowedSourceFileName(selectedItem.assets.sourceFileName)) {
      showToast(
        "error",
        "업로드된 파일 형식이 올바르지 않습니다. PDF/DOC/DOCX/PPT/PPTX/HWP/HWPX만 허용됩니다.",
        3500
      );
      return;
    }
    if (
      selectedItem.assets.sourceFileSize &&
      selectedItem.assets.sourceFileSize > MAX_SOURCE_FILE_SIZE_BYTES
    ) {
      showToast("error", "교육 자료 파일이 너무 큽니다. (최대 50MB)", 3500);
      return;
    }

    if (!selectedItem.assets.script || selectedItem.assets.script.trim().length === 0) {
      showToast("error", "먼저 스크립트를 생성하거나 입력해 주세요.", 3000);
      return;
    }

    if (
      selectedItem.status === "REVIEW_PENDING" ||
      selectedItem.status === "APPROVED" ||
      selectedItem.status === "REJECTED"
    ) {
      showToast("info", "검토 대기/승인/반려 상태에서는 재생성을 실행할 수 없습니다.");
      return;
    }
    if (selectedItem.pipeline.state === "RUNNING" || selectedItem.status === "GENERATING") {
      showToast("info", "이미 자동 생성이 진행 중입니다.");
      return;
    }

    if (!shouldUseVideoOnly(selectedItem)) {
      showToast("info", "현재 상태에서는 전체 자동 생성을 실행해 주세요.");
      return;
    }

    stopPipelineTimer();

    const startedAt = Date.now();
    updateSelected({
      status: "GENERATING",
      pipeline: {
        mode: PIPELINE_MODE_VIDEO_ONLY,
        state: "RUNNING",
        stage: "VIDEO",
        progress: 0,
        startedAt,
        message: "영상 합성 중…",
      },
    });

    timerRef.current = window.setInterval(() => {
      setItems((prev) => {
        const next = prev.map((it): CreatorWorkItem => {
          if (it.id !== targetId) return it;
          if (it.pipeline.state !== "RUNNING") return it;

          const p = it.pipeline.progress;
          let stage = it.pipeline.stage ?? "VIDEO";
          let message = it.pipeline.message ?? "";

          const inc = 6 + Math.floor(Math.random() * 9); // 6~14
          const np = clamp(p + inc, 0, 100);

          if (np < 78) {
            stage = "VIDEO";
            message = "영상 합성 중…";
          } else if (np < 100) {
            stage = "THUMBNAIL";
            message = "썸네일 생성 중…";
          } else {
            stage = "DONE";
            message = "생성 완료";
          }

          if (np >= 100) {
            const finishedAt = Date.now();

            return {
              ...it,
              status: "DRAFT",
              updatedAt: finishedAt,
              pipeline: {
                mode: PIPELINE_MODE_VIDEO_ONLY,
                state: "SUCCESS",
                stage: "DONE",
                progress: 100,
                startedAt: it.pipeline.startedAt ?? startedAt,
                finishedAt,
                message: "생성 완료",
              },
              assets: {
                ...it.assets,
                videoUrl: mockVideoUrl(it.id),
                thumbnailUrl: `mock://thumbnail/${it.id}`,
              },
              failedReason: undefined,
            };
          }

          return {
            ...it,
            pipeline: {
              ...it.pipeline,
              progress: np,
              stage,
              message,
            },
          };
        });

        return next;
      });
    }, 420);
  };

  // items 변화를 보면서 RUNNING이 하나도 없을 때만 타이머 정리
  useEffect(() => {
    const running = items.some((it) => it.pipeline.state === "RUNNING");
    if (!running) stopPipelineTimer();
  }, [items]);

  // 언마운트 정리
  useEffect(() => {
    return () => stopPipelineTimer();
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // === reviewFlowStore -> Creator items 동기화 (P0: 폴링) ===
  useEffect(() => {
    if (typeof window === "undefined") return;

    setItems((prev) => applyReviewStoreSync(prev, listReviewItemsSnapshot()));

    const id = window.setInterval(() => {
      const snapshot = listReviewItemsSnapshot();
      setItems((prev) => applyReviewStoreSync(prev, snapshot));
    }, 600);

    return () => window.clearInterval(id);
  }, []);

  const failPipelineForSelected = (reason: string) => {
    if (!selectedItem) return;

    stopPipelineTimer();

    updateSelected({
      status: "FAILED",
      failedReason: reason,
      pipeline: {
        ...selectedItem.pipeline,
        state: "FAILED",
        message: "생성 실패",
        finishedAt: Date.now(),
      },
    });

    showToast("error", `자동 생성 실패: ${reason}`, 3000);
  };

  const retryPipelineForSelected = () => {
    if (!selectedItem) return;
    if (selectedItem.status !== "FAILED") return;

    setTab("draft");

    if (shouldUseVideoOnly(selectedItem)) {
      runVideoOnlyForSelected();
      return;
    }

    runPipelineForSelected();
  };

  const updateSelectedScript = (script: string, options?: { silent?: boolean }) => {
    if (!selectedItem) return;

    const approvedAt = getScriptApprovedAt(selectedItem);
    if (approvedAt != null) {
      showToast("info", "1차(스크립트) 승인 이후에는 스크립트를 수정할 수 없습니다.");
      return;
    }

    if (isLockedForEdit(selectedItem)) {
      showToast("info", "검토 대기/승인/반려/생성 중 상태에서는 스크립트를 수정할 수 없습니다.");
      return;
    }

    updateSelected({
      assets: {
        ...selectedItem.assets,
        script,
        videoUrl: "",
        thumbnailUrl: "",
      },
      pipeline: resetPipeline(PIPELINE_MODE_SCRIPT_ONLY),
      failedReason: undefined,
    });

    if (!options?.silent) {
      const now = Date.now();
      const last = scriptToastRef.current;
      const shouldToast = last.id !== selectedItem.id || now - last.ts > 1300;

      if (shouldToast) {
        scriptToastRef.current = { id: selectedItem.id, ts: now };
        showToast("info", "스크립트가 수정되었습니다. 스크립트 검토 요청(1차)이 가능합니다.");
      }
    }
  };

  const requestReviewForSelected = () => {
    if (!selectedItem) return;

    const hasVideo = Boolean(selectedItem.assets.videoUrl && selectedItem.assets.videoUrl.trim().length > 0);

    // 2차 요청은 "1차 승인"이 필요 (scriptApprovedAt 또는 store 승인 기록)
    const reviews = listReviewItemsSnapshot();
    const stage1Approved =
      getScriptApprovedAt(selectedItem) != null ||
      reviews.some(
        (r) =>
          r.contentId === selectedItem.id &&
          (r.videoUrl ?? "").trim() === "" &&
          r.status === "APPROVED"
      );

    if (hasVideo && !stage1Approved) {
      showToast("error", "2차(최종) 검토 요청은 1차 승인 후에만 가능합니다.", 3000);
      return;
    }

    const v = validateForReview(selectedItem, scopeCtx, hasVideo ? "FINAL" : "SCRIPT");
    if (!v.ok) {
      showToast("error", v.issues[0] ?? "검토 요청 조건을 확인해주세요.", 3000);
      return;
    }

    const dept =
      selectedItem.isMandatory
        ? "전사"
        : selectedItem.targetDeptIds.length > 0
          ? selectedItem.targetDeptIds.map(deptLabel).join(", ")
          : "전사";

    submitCreatorReviewRequest({
      contentId: selectedItem.id,
      title: selectedItem.title,
      department: dept,
      creatorName: selectedItem.createdByName ?? "VIDEO_CREATOR",
      contentCategory: isMandatoryByCategory(selectedItem.categoryId) ? "MANDATORY" : "JOB",
      scriptText: selectedItem.assets.script ?? "",
      videoUrl: hasVideo ? selectedItem.assets.videoUrl : undefined,
    });

    updateSelected({ status: "REVIEW_PENDING" });
    setTab("review_pending");

    showToast(
      "success",
      hasVideo
        ? "2차(최종) 검토 요청이 제출되었습니다. (스크립트+영상)"
        : "1차 검토 요청이 제출되었습니다. (스크립트만)"
    );
  };

  /**
   * 반려는 읽기 전용 → “새 버전으로 편집”으로만 재작업
   */
  const reopenRejectedToDraft = () => {
    if (!selectedItem) return;
    if (selectedItem.status !== "REJECTED") return;

    const next = bumpVersionForRework(selectedItem, "REJECTED → 새 버전 재작업");

    setItems((prev) => prev.map((it) => (it.id === selectedItem.id ? next : it)));
    setTab("draft");
    showToast("info", `새 버전(v${next.version})으로 편집을 시작합니다. 필요 시 '영상만 재생성'을 실행하세요.`);
  };

  const deleteDraft = () => {
    if (!selectedItem) return;

    if (selectedItem.status !== "DRAFT" && selectedItem.status !== "FAILED") {
      showToast("info", "초안/실패 상태만 삭제할 수 있습니다.");
      return;
    }

    const id = selectedItem.id;

    const remaining = items.filter((it) => it.id !== id);

    const allowedRemaining = isDeptCreator
      ? remaining.filter((it) => isVisibleToDeptCreator(it, allowedDeptIds))
      : remaining;

    const sorted = sortItems(allowedRemaining, "updated_desc");
    const byTab = sorted.filter((it) => tabMatchesStatus(tab, it));
    const nextId = (byTab[0] ?? sorted[0] ?? null)?.id ?? null;

    setItems(remaining);
    setRawSelectedId(nextId);

    showToast("success", "초안이 삭제되었습니다.");
  };

  return {
    // static data
    departments,
    categories,
    templates,
    jobTrainings,

    // role/scope
    creatorType,

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
  };
}
