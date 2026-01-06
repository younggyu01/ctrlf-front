// src/components/chatbot/CreatorStudioView.tsx

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  computePanelPosition,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";
import { can, type UserRole } from "../../auth/roles";
import { formatDateTime, labelStatus, isJobCategory } from "./creatorStudioCatalog";
import { useCreatorStudioController } from "./useCreatorStudioController";
import CreatorScriptSceneEditor from "./CreatorScriptSceneEditor";
import type {
  CreatorSortMode,
  CreatorTabId,
  CreatorWorkItem,
  ReviewStage,
  CreatorEducationWithVideosItem,
} from "./creatorStudioTypes";
import CreatorTrainingSelect from "./CreatorTrainingSelect";
import ProjectFilesModal, { type ProjectFileItem } from "./ProjectFilesModal";
import { resolveEducationVideoUrl } from "./educationServiceApi";

type Size = PanelSize;

type ResizeDirection =
  | "n"
  | "s"
  | "e"
  | "w"
  | "nw"
  | "ne"
  | "sw"
  | "se";

type ResizeState = {
  resizing: boolean;
  dir: ResizeDirection | null;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startTop: number;
  startLeft: number;
};

type DragState = {
  dragging: boolean;
  startX: number;
  startY: number;
  startTop: number;
  startLeft: number;
};

interface CreatorStudioViewProps {
  anchor?: Anchor | null;
  onClose: () => void;
  onRequestFocus?: () => void;

  /**
   * 추후 Keycloak token/백엔드에서 내려오는 creator metadata 연결용 (optional)
   */
  userRole?: UserRole;
  creatorName?: string;
  allowedDeptIds?: string[] | null;
}

const INITIAL_SIZE: Size = { width: 1080, height: 680 };
const MIN_WIDTH = 860;
const MIN_HEIGHT = 560;

// 패널이 화면 밖으로 “완전히” 못 나가게 하는 여백
const PANEL_PADDING = 24;

// 소스 파일 허용 확장자(컨트롤러와 동일)
const SOURCE_ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.hwp,.hwpx";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

/**
 * 상태 키를 문서 기준 문자열로 안전 변환
 * - 타입 유니온 변경(문서 상태 추가/변경)에도 TS 2367 방지
 */
function statusKey(v: unknown): string {
  return String(v ?? "").trim();
}

function toEducationList(raw: unknown): CreatorEducationWithVideosItem[] {
  if (!Array.isArray(raw)) return [];

  const toBool = (v: unknown): boolean | undefined => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t === "true" || t === "1" || t === "y" || t === "yes") return true;
      if (t === "false" || t === "0" || t === "n" || t === "no") return false;
    }
    return undefined;
  };

  return raw
    .map((it) => {
      if (!it || typeof it !== "object") return null;
      const id = readOptionalString(it, "id") ?? readOptionalString(it, "educationId");
      const title = readOptionalString(it, "title") ?? "";
      if (!id) return null;

      // departmentScope는 JSON string으로 올 수 있음 (스펙: docs/education_api_spec.md 2.1, 2.2)
      const scopeRaw = (it as Record<string, unknown>)["departmentScope"];
      let deptScope: string[] | undefined;
      
      if (typeof scopeRaw === "string" && scopeRaw.trim()) {
        // JSON string인 경우 파싱
        try {
          const parsed = JSON.parse(scopeRaw);
          deptScope = Array.isArray(parsed) 
            ? parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            : undefined;
        } catch {
          // 파싱 실패 시 undefined
          deptScope = undefined;
        }
      } else if (Array.isArray(scopeRaw)) {
        // 이미 배열인 경우 (호환성)
        deptScope = scopeRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      }

      const videosRaw = Array.isArray((it as Record<string, unknown>)["videos"])
        ? ((it as Record<string, unknown>)["videos"] as unknown[])
        : Array.isArray((it as Record<string, unknown>)["videoList"])
          ? ((it as Record<string, unknown>)["videoList"] as unknown[])
          : [];

      const videos = (Array.isArray(videosRaw) ? videosRaw : [])
        .map((v) => {
          if (!v || typeof v !== "object") return null;
          const vid = readOptionalString(v, "id") ?? readOptionalString(v, "videoId");
          if (!vid) return null;
          return {
            id: vid,
            title: readOptionalString(v, "title") ?? "",
            status: readOptionalString(v, "status") ?? null,
            updatedAt: readOptionalString(v, "updatedAt") ?? null,
          };
        })
        .filter(
          (v): v is { id: string; title: string; status: string | null; updatedAt: string | null } =>
            Boolean(v)
        );

      const requiredRaw =
        (it as Record<string, unknown>)["required"] ??
        (it as Record<string, unknown>)["isRequired"] ??
        (it as Record<string, unknown>)["mandatory"] ??
        (it as Record<string, unknown>)["isMandatory"];

      return {
        id,
        title,
        startAt: readOptionalString(it, "startAt") ?? "",
        endAt: readOptionalString(it, "endAt") ?? "",
        departmentScope: deptScope,
        required: toBool(requiredRaw),
        eduType: readOptionalString(it, "eduType") ?? readOptionalString(it, "type") ?? undefined,
        passScore: readOptionalNumber(it, "passScore") ?? undefined,
        passRatio: readOptionalNumber(it, "passRatio") ?? undefined,
        categoryId: readOptionalString(it, "categoryId") ?? readOptionalString(it, "categoryCode") ?? undefined,
        jobTrainingId: readOptionalString(it, "jobTrainingId") ?? undefined,
        templateId: readOptionalString(it, "templateId") ?? undefined,
        videos,
      } as CreatorEducationWithVideosItem;
    })
    .filter((v): v is CreatorEducationWithVideosItem => Boolean(v));
}

function formatIsoRange(startAt?: string | null, endAt?: string | null): string {
  const toK = (iso?: string) => {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    const d = new Date(t);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };
  const s0 = toK(startAt ?? "");
  const e0 = toK(endAt ?? "");
  if (!s0 && !e0) return "";

  const s = s0 ? s0.split("T")[0].replace(/-/g, ".") : "";
  const e = e0 ? e0.split("T")[0].replace(/-/g, ".") : "";
  if (s && e) return `${s} ~ ${e}`;
  return s || e;
}

/**
 * 뷰포트 크기를 기준으로 “허용 가능한 최대 패널 크기”를 계산
 */
function getViewportMaxSize(): Size {
  if (typeof window === "undefined") return INITIAL_SIZE;
  return {
    width: Math.max(MIN_WIDTH, window.innerWidth - PANEL_PADDING * 2),
    height: Math.max(MIN_HEIGHT, window.innerHeight - PANEL_PADDING * 2),
  };
}

/**
 * 원하는 크기를 뷰포트 제약(최대/최소)에 맞춰 보정
 */
function fitSizeToViewport(desired: Size): Size {
  const max = getViewportMaxSize();
  return {
    width: clamp(desired.width, MIN_WIDTH, max.width),
    height: clamp(desired.height, MIN_HEIGHT, max.height),
  };
}

/**
 * 패널 이동 가능한 범위를 계산
 * - 패널이 뷰포트보다 클 때도 “드래그가 잠기지 않도록”
 */
function getBounds(width: number, height: number) {
  if (typeof window === "undefined") {
    return {
      minLeft: PANEL_PADDING,
      maxLeft: PANEL_PADDING,
      minTop: PANEL_PADDING,
      maxTop: PANEL_PADDING,
    };
  }

  const rawMaxLeft = window.innerWidth - width - PANEL_PADDING;
  const rawMaxTop = window.innerHeight - height - PANEL_PADDING;

  return {
    minLeft: Math.min(PANEL_PADDING, rawMaxLeft),
    maxLeft: Math.max(PANEL_PADDING, rawMaxLeft),
    minTop: Math.min(PANEL_PADDING, rawMaxTop),
    maxTop: Math.max(PANEL_PADDING, rawMaxTop),
  };
}

function tabLabel(tab: CreatorTabId): string {
  switch (tab) {
    case "draft":
      return "초안";
    case "review_pending":
      return "검토 대기";
    case "rejected":
      return "반려";
    case "approved":
      return "승인";
    case "failed":
      return "실패";
    default:
      return tab;
  }
}

function statusToneClass(statusText: string): string {
  const st = statusText;

  // 문서 상태 기반
  if (st === "SCRIPT_REVIEW_REQUESTED" || st === "FINAL_REVIEW_REQUESTED") {
    return "cb-reviewer-pill cb-reviewer-pill--pending";
  }
  if (st === "PUBLISHED") {
    return "cb-reviewer-pill cb-reviewer-pill--approved";
  }
  if (st === "FAILED" || st === "ERROR") {
    return "cb-reviewer-pill cb-reviewer-pill--rejected";
  }
  if (st === "REJECTED") {
    return "cb-reviewer-pill cb-reviewer-pill--rejected";
  }

  // 레거시/호환
  if (st === "REVIEW_PENDING")
    return "cb-reviewer-pill cb-reviewer-pill--pending";
  if (st === "APPROVED")
    return "cb-reviewer-pill cb-reviewer-pill--approved";
  if (st === "FAILED")
    return "cb-reviewer-pill cb-reviewer-pill--rejected";

  return "cb-reviewer-pill";
}

/**
 * 커스텀 CSS 변수 타입 (no-explicit-any 회피)
 */
type CreatorCSSVars = React.CSSProperties & {
  "--cb-creator-x"?: string;
  "--cb-creator-y"?: string;
  "--cb-creator-w"?: string;
  "--cb-creator-h"?: string;
  "--cb-creator-progress"?: string;
};

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${mb.toFixed(1)}MB`;
}

/**
 * 안전 접근 유틸
 */
function readOptionalNumber(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;

  const v = (obj as Record<string, unknown>)[key];

  if (typeof v === "number" && Number.isFinite(v)) return v;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    const n = Number(s);
    if (Number.isFinite(n)) return n;

    const t = Date.parse(s);
    if (Number.isFinite(t)) return t;
  }

  return null;
}

function readOptionalString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];

  // id/코드가 number로 내려오는 케이스(백엔드/DB) 방어
  if (typeof v === "number" && Number.isFinite(v)) return String(v);

  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}

type IdName = Readonly<{ id: string; name: string }>;

function toIdNameList(
  arr: readonly unknown[],
  fallbackName?: (id: string) => string
): IdName[] {
  const out: IdName[] = [];

  const readFirst = (obj: unknown, keys: string[]): string | null => {
    for (const k of keys) {
      const v = readOptionalString(obj, k);
      if (v) return v;
    }
    return null;
  };

  for (const it of arr) {
    // string[] 지원
    if (typeof it === "string") {
      const id = it.trim();
      if (!id) continue;
      const name = (fallbackName ? fallbackName(id) : id) ?? id;
      out.push({ id, name });
      continue;
    }

    if (!it || typeof it !== "object") continue;

    // id 키 다양성 지원(더미 제거/실 API 연동 시 흔함)
    const id =
      readFirst(it, [
        "id",
        "code",
        "value",
        "key",

        "deptId",
        "departmentId",
        "departmentCode",

        "categoryId",
        "categoryCode",

        "templateId",
        "videoTemplateId",

        "trainingId",
        "jobTrainingId",
      ]) ?? null;
    if (!id) continue;

    // name 키 다양성 지원(name/label/title 등)
    const name =
      readFirst(it, [
        "name",
        "label",
        "title",
        "text",
        "displayName",

        "deptName",
        "departmentName",

        "categoryName",

        "templateName",

        "trainingName",
        "jobTrainingName",
      ]) ?? (fallbackName ? fallbackName(id) : id);

    out.push({ id, name });
  }

  return out;
}

/**
 * 컨트롤러에 “카탈로그 로딩 트리거 함수”가 있는 경우를 대비한 안전 호출
 * - 컨트롤러 구현이 auto-load(useEffect)에서 explicit call 방식으로 바뀌면,
 *   이 뷰에서 한 번 호출해줘야 Network 탭에 /admin/catalog/* 요청이 발생한다.
 */
type UnknownFn = (...args: unknown[]) => unknown;

function pickFirstFunction(obj: unknown, keys: readonly string[]): UnknownFn | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "function") return v as UnknownFn;
  }
  return null;
}

/* =========================
   Policy helpers (문서 상태 정합)
========================= */

type CreatorStageFilter = "all" | "stage1" | "stage2";

function getScriptApprovedAt(it: CreatorWorkItem): number | null {
  return readOptionalNumber(it, "scriptApprovedAt");
}

/**
 * 문서 상태 기반 “스크립트 승인 완료” 판정
 */
function isScriptApprovedByPolicy(it: CreatorWorkItem): boolean {
  const sa = getScriptApprovedAt(it);
  if (sa != null) return true;

  const st = statusKey((it as unknown as { status?: unknown }).status);
  return (
    st === "SCRIPT_APPROVED" ||
    st === "READY" ||
    st === "FINAL_REVIEW_REQUESTED" ||
    st === "PUBLISHED" ||
    st === "APPROVED"
  );
}

/**
 * 반려 판정: 문서 상태(REJECTED) + review-history 내 REJECTED 태깅 + rejectedComment/rejectedStage 필드
 */
function isRejectedByHistory(it: CreatorWorkItem): boolean {
  const st = statusKey((it as unknown as { status?: unknown }).status);
  if (st === "REJECTED") return true;

  // rejectedComment나 rejectedStage 필드가 있으면 반려된 것으로 판단
  if (it.rejectedComment && it.rejectedComment.trim().length > 0) return true;
  if (it.rejectedStage) return true;

  const history = (it as unknown as { reviewHistory?: unknown }).reviewHistory;
  if (!Array.isArray(history)) return false;

  for (const h of history) {
    if (!h || typeof h !== "object") continue;
    const hs = readOptionalString(h, "status") ?? readOptionalString(h, "state");
    if (hs && statusKey(hs) === "REJECTED") return true;
  }
  return false;
}

function inferReviewStage(it: CreatorWorkItem): ReviewStage {
  if (it.reviewStage) return it.reviewStage;

  const st = statusKey((it as unknown as { status?: unknown }).status);
  if (st === "FINAL_REVIEW_REQUESTED") return "FINAL";
  if (st === "SCRIPT_REVIEW_REQUESTED") return "SCRIPT";

  return isScriptApprovedByPolicy(it) ? "FINAL" : "SCRIPT";
}

function inferRejectedStage(it: CreatorWorkItem): ReviewStage {
  if (it.rejectedStage) return it.rejectedStage;
  if (it.reviewStage) return it.reviewStage;
  return isScriptApprovedByPolicy(it) ? "FINAL" : "SCRIPT";
}

/**
 * 전사(전체) 판정 유틸
 * - “필수/의무교육” 개념 제거 버전
 * - targetDeptIds가 비어있거나, 전체부서 sentinel(id)이 섞여 있으면 전사로 본다
 */
function hasAllDeptSentinel(ids: readonly string[], allDeptIdSet: ReadonlySet<string>): boolean {
  return ids.some((id) => allDeptIdSet.has(id));
}

function cleanDeptIds(ids: readonly string[], allDeptIdSet: ReadonlySet<string>): string[] {
  return ids.filter((id) => !allDeptIdSet.has(id));
}

function isAllCompanyTarget(ids: readonly string[], allDeptIdSet: ReadonlySet<string>): boolean {
  return ids.length === 0 || hasAllDeptSentinel(ids, allDeptIdSet);
}

function matchTab(tab: CreatorTabId, it: CreatorWorkItem): boolean {
  const st = statusKey((it as unknown as { status?: unknown }).status);

  switch (tab) {
    case "draft":
      return (
        st === "DRAFT" ||
        st === "SCRIPT_READY" ||
        st === "SCRIPT_GENERATING" ||
        st === "SCRIPT_APPROVED" ||
        st === "READY" ||
        st === "GENERATING"
      );

    case "review_pending":
      return (
        st === "SCRIPT_REVIEW_REQUESTED" ||
        st === "FINAL_REVIEW_REQUESTED" ||
        st === "REVIEW_PENDING"
      );

    case "approved":
      return st === "PUBLISHED" || st === "APPROVED";

    case "rejected":
      return isRejectedByHistory(it);

    case "failed":
      return st === "FAILED" || st === "ERROR";

    default:
      return false;
  }
}

function getStageForTab(tab: CreatorTabId, it: CreatorWorkItem): 1 | 2 | null {
  if (tab === "review_pending") {
    const st = inferReviewStage(it);
    return st === "FINAL" ? 2 : 1;
  }
  if (tab === "rejected") {
    const st = inferRejectedStage(it);
    return st === "FINAL" ? 2 : 1;
  }
  return null;
}

function getDisplayStatusPill(it: CreatorWorkItem): { label: string; className: string } {
  const st = statusKey((it as unknown as { status?: unknown }).status);

  if (st === "PUBLISHED") {
    return { label: "게시됨", className: "cb-reviewer-pill cb-reviewer-pill--approved" };
  }
  if (st === "FINAL_REVIEW_REQUESTED") {
    return { label: "최종 검토중", className: "cb-reviewer-pill cb-reviewer-pill--pending" };
  }
  if (st === "SCRIPT_REVIEW_REQUESTED") {
    return { label: "검토중(1차)", className: "cb-reviewer-pill cb-reviewer-pill--pending" };
  }
  if (st === "SCRIPT_READY") {
    return { label: "스크립트 준비", className: "cb-reviewer-pill cb-reviewer-pill--pending" };
  }
  if (st === "SCRIPT_GENERATING") {
    return { label: "스크립트 생성중", className: "cb-reviewer-pill cb-reviewer-pill--pending" };
  }
  if (st === "READY") {
    return { label: "영상 준비", className: "cb-reviewer-pill cb-reviewer-pill--pending" };
  }
  if (st === "SCRIPT_APPROVED") {
    return { label: "1차 승인 완료", className: "cb-reviewer-pill cb-reviewer-pill--approved" };
  }
  if (st === "FAILED" || st === "ERROR") {
    return { label: "실패", className: "cb-reviewer-pill cb-reviewer-pill--rejected" };
  }
  if (isRejectedByHistory(it)) {
    return { label: "반려", className: "cb-reviewer-pill cb-reviewer-pill--rejected" };
  }

  return { label: labelStatus(it.status), className: statusToneClass(st) };
}

function normalizeText(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * departments 응답에 섞여 들어오는 “전사/전체” 계열 옵션 제거용
 * (전사 대상(전체) 체크박스가 별도로 존재하므로 중복 제거)
 */
function isAllDeptOption(d: IdName): boolean {
  const id = normalizeText(d.id);
  const name = normalizeText(d.name);

  // name 기반
  if (name === "전체 부서") return true;
  if (name === "전사" || name === "전사 대상" || name === "전사 대상(전체)") return true;
  if (name.includes("전체") && name.includes("부서")) return true;

  // id 기반(백엔드/더미/레거시 대응)
  if (id === "all" || id === "all_dept" || id === "all_depts" || id === "total") return true;

  return false;
}

function filterByQuery(
  items: readonly CreatorWorkItem[],
  query: string,
  departments: readonly IdName[],
  categories: readonly IdName[],
  templates: readonly IdName[],
  jobTrainings: readonly IdName[]
): CreatorWorkItem[] {
  const src = [...items];
  const q = normalizeText(query);
  if (!q) return src;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return src;

  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const templateNameById = new Map(templates.map((t) => [t.id, t.name]));
  const trainingNameById = new Map(jobTrainings.map((t) => [t.id, t.name]));

  const allDeptIdSet = new Set<string>();
  for (const d of departments) {
    if (isAllDeptOption(d)) allDeptIdSet.add(d.id);
  }
  ["ALL", "all", "ALL_DEPT", "ALL_DEPTS", "ALL_DEPARTMENTS", "TOTAL"].forEach((x) => allDeptIdSet.add(x));

  return src.filter((it) => {
    const pill = getDisplayStatusPill(it);

    const allCompany = isAllCompanyTarget(it.targetDeptIds, allDeptIdSet);
    const cleanedDeptIds = cleanDeptIds(it.targetDeptIds, allDeptIdSet);

    const deptText = allCompany
      ? "전사"
      : cleanedDeptIds.map((id) => deptNameById.get(id) ?? id).join(" ");

    const categoryText =
      categoryNameById.get(it.categoryId) ||
      (typeof it.categoryLabel === "string" && it.categoryLabel.trim() ? it.categoryLabel : "") ||
      it.categoryId;

    const templateText = templateNameById.get(it.templateId) ?? it.templateId;

    const trainingText = it.jobTrainingId
      ? trainingNameById.get(it.jobTrainingId) ?? it.jobTrainingId
      : "";

    const kindText = isJobCategory(it.categoryId) ? "직무" : "4대";

    const versionText = `v${it.version ?? 1}`;

    const st = statusKey((it as unknown as { status?: unknown }).status);
    const stageHint =
      st === "PUBLISHED"
        ? "게시됨"
        : st === "FINAL_REVIEW_REQUESTED"
          ? "2차 검토"
          : st === "SCRIPT_REVIEW_REQUESTED"
            ? "1차 검토"
            : st === "READY"
              ? "2차 검토 요청 가능"
              : st === "SCRIPT_READY"
                ? "1차 검토 요청 가능"
                : st === "SCRIPT_APPROVED"
                  ? "1차 승인 완료"
                  : "";

    const hay = normalizeText(
      [
        it.title,
        categoryText,
        kindText,
        deptText,
        templateText,
        trainingText,
        versionText,
        pill.label,
        stageHint,
      ]
        .filter(Boolean)
        .join(" ")
    );

    return tokens.every((t) => hay.includes(t));
  });
}

function sortItems(items: CreatorWorkItem[], mode: CreatorSortMode): CreatorWorkItem[] {
  const arr = [...items];
  arr.sort((a, b) => {
    const ua = a.updatedAt ?? 0;
    const ub = b.updatedAt ?? 0;
    const ca = a.createdAt ?? 0;
    const cb = b.createdAt ?? 0;

    switch (mode) {
      case "updated_desc":
        return ub - ua;
      case "updated_asc":
        return ua - ub;
      case "created_desc":
        return cb - ca;
      case "created_asc":
        return ca - cb;
      default:
        return ub - ua;
    }
  });
  return arr;
}

function getEmptyCopy(tab: CreatorTabId, _stage: CreatorStageFilter, query: string): { title: string; desc: string } {
  const hasQuery = normalizeText(query).length > 0;

  if (hasQuery) {
    return {
      title: "목록이 비어있습니다",
      desc: "현재 검색/필터 조건에 해당하는 제작 콘텐츠가 없습니다.",
    };
  }

  if (tab === "draft") {
    return {
      title: "초안이 없습니다",
      desc: "‘교육 선택 후 콘텐츠 만들기’를 눌러 제작을 시작할 수 있습니다.",
    };
  }

  if (tab === "review_pending") {
    return {
      title: "검토 대기 항목이 없습니다",
      desc: "현재 검토 요청이 제출된 콘텐츠가 없습니다.",
    };
  }

  if (tab === "rejected") {
    return {
      title: "반려된 항목이 없습니다",
      desc: "현재 반려 상태의 콘텐츠가 없습니다.",
    };
  }

  if (tab === "approved") {
    return {
      title: "게시된 항목이 없습니다",
      desc: "최종 승인 완료된 콘텐츠가 아직 없습니다.",
    };
  }

  if (tab === "failed") {
    return {
      title: "실패한 항목이 없습니다",
      desc: "현재 생성 실패 상태의 콘텐츠가 없습니다.",
    };
  }

  return {
    title: "목록이 비어있습니다",
    desc: "현재 조건에 해당하는 제작 콘텐츠가 없습니다.",
  };
}

/* =========================
   Flow Stepper
========================= */

type CreatorFlowStepKey =
  | "upload"
  | "script"
  | "review1"
  | "video"
  | "review2"
  | "publish";

type CreatorFlowStepState = "done" | "active" | "locked" | "error";

type CreatorFlowStep = {
  key: CreatorFlowStepKey;
  label: string;
  state: CreatorFlowStepState;
  hint?: string;
};

type CreatorFlowInput = {
  statusText: string;
  hasSourceFile: boolean;
  hasScript: boolean;
  hasVideo: boolean;
  isScriptApproved: boolean;
  isPipelineRunning: boolean;
  scriptId?: string;
};

function buildCreatorFlowSteps(input: CreatorFlowInput): {
  steps: CreatorFlowStep[];
  activeKey: CreatorFlowStepKey | null;
} {
  const {
    statusText,
    hasSourceFile,
    hasScript,
    hasVideo,
    isScriptApproved,
    isPipelineRunning,
    scriptId,
  } = input;

  const st = statusText;

  const doneUpload = hasSourceFile;
  // scriptId가 있거나, 1차 승인 이후 상태라면 스크립트가 생성된 것으로 간주
  const doneScript = hasScript || isScriptApproved || Boolean(scriptId && scriptId.trim().length > 0);
  const doneReview1 = isScriptApproved;
  const doneVideo = hasVideo;
  const doneReview2 = st === "PUBLISHED" || st === "APPROVED";
  const donePublish = st === "PUBLISHED" || st === "APPROVED";

  const order: CreatorFlowStepKey[] = [
    "upload",
    "script",
    "review1",
    "video",
    "review2",
    "publish",
  ];

  const base: Array<Omit<CreatorFlowStep, "state"> & { done: boolean }> = [
    { key: "upload", label: "자료 업로드", done: doneUpload, hint: doneUpload ? "완료" : "파일 업로드 필요" },
    { key: "script", label: "스크립트 생성", done: doneScript, hint: doneScript ? "완료" : "생성 필요" },
    { key: "review1", label: "1차 승인(스크립트)", done: doneReview1, hint: doneReview1 ? "승인 완료" : "검토 요청/승인 필요" },
    { key: "video", label: "영상 생성", done: doneVideo, hint: doneVideo ? "완료" : "생성 필요" },
    { key: "review2", label: "2차 승인(최종)", done: doneReview2, hint: doneReview2 ? "승인 완료" : "최종 검토/승인 필요" },
    { key: "publish", label: "게시(교육 노출)", done: donePublish, hint: donePublish ? "노출 중" : "승인 후 자동 게시" },
  ];

  let activeKey: CreatorFlowStepKey | null = null;

  if (st === "PUBLISHED" || st === "APPROVED") activeKey = null;
  else if (st === "FINAL_REVIEW_REQUESTED") activeKey = "review2";
  else if (st === "SCRIPT_REVIEW_REQUESTED") activeKey = "review1";
  else if (st === "FAILED" || st === "ERROR") activeKey = isScriptApproved ? "video" : "script";
  else if (st === "SCRIPT_GENERATING" || st === "GENERATING" || isPipelineRunning) activeKey = isScriptApproved ? "video" : "script";
  else {
    if (!hasSourceFile) activeKey = "upload";
    else if (!hasScript) activeKey = "script";
    else if (!isScriptApproved) activeKey = "review1";
    else if (!hasVideo) activeKey = "video";
    else activeKey = "review2";
  }

  const activeIndex = activeKey == null ? -1 : order.findIndex((k) => k === activeKey);

  const steps: CreatorFlowStep[] = base.map((s) => {
    const idx = order.findIndex((k) => k === s.key);

    if ((st === "FAILED" || st === "ERROR") && s.key === activeKey) {
      return { key: s.key, label: s.label, state: "error", hint: "실패 · 재시도 필요" };
    }

    if (s.done) return { key: s.key, label: s.label, state: "done", hint: s.hint };

    if (activeKey != null && s.key === activeKey) {
      let hint = s.hint;
      if (st === "SCRIPT_REVIEW_REQUESTED") hint = "검토 중(1차)";
      if (st === "FINAL_REVIEW_REQUESTED") hint = "검토 중(2차)";
      if (st === "SCRIPT_GENERATING" || st === "GENERATING" || isPipelineRunning) {
        hint = isScriptApproved ? "생성 중(영상)" : "생성 중(스크립트)";
      }
      return { key: s.key, label: s.label, state: "active", hint };
    }

    if (activeIndex >= 0 && idx > activeIndex) {
      return { key: s.key, label: s.label, state: "locked", hint: "잠금" };
    }

    return { key: s.key, label: s.label, state: "locked", hint: "잠금" };
  });

  if (!isScriptApproved) {
    const lockAfter: CreatorFlowStepKey[] = ["video", "review2", "publish"];
    for (let i = 0; i < steps.length; i += 1) {
      if (lockAfter.includes(steps[i].key) && steps[i].state !== "done") {
        steps[i] = { ...steps[i], state: "locked", hint: "1차 승인 후 가능" };
      }
    }
  }

  return { steps, activeKey };
}

function StepBadgeText(step: CreatorFlowStep, index: number): string {
  if (step.state === "done") return "✓";
  if (step.state === "error") return "!";
  return String(index + 1);
}

const CreatorFlowStepper: React.FC<{ steps: CreatorFlowStep[]; metaText?: string }> = ({ steps, metaText }) => {
  return (
    <div className="cb-creator-stepper-wrap" aria-label="제작 단계">
      <div className="cb-creator-stepper-head">
        <div className="cb-creator-stepper-title">진행 단계</div>
        {metaText ? <div className="cb-creator-stepper-meta">{metaText}</div> : null}
      </div>

      <ol className="cb-creator-stepper" aria-label="제작 플로우">
        {steps.map((s, idx) => (
          <li
            key={s.key}
            className={cx(
              "cb-creator-step",
              s.state === "done" && "cb-creator-step--done",
              s.state === "active" && "cb-creator-step--active",
              s.state === "locked" && "cb-creator-step--locked",
              s.state === "error" && "cb-creator-step--error"
            )}
            aria-current={s.state === "active" ? "step" : undefined}
          >
            <span className="cb-creator-step-badge" aria-hidden="true">{StepBadgeText(s, idx)}</span>
            <span className="cb-creator-step-main">
              <span className="cb-creator-step-label">{s.label}</span>
              {s.hint ? <span className="cb-creator-step-hint">{s.hint}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};
/* ========================= */

function readSourceFiles(selected: CreatorWorkItem | null): Array<{ id: string; name: string; size: number }> {
  if (!selected) return [];

  const assets = (selected as unknown as { assets?: unknown }).assets;
  if (assets && typeof assets === "object") {
    const sf = (assets as Record<string, unknown>)["sourceFiles"];
    if (Array.isArray(sf)) {
      return sf
        .map((x) => {
          if (!x || typeof x !== "object") return null;
          const id = readOptionalString(x, "id") ?? "";
          const name = readOptionalString(x, "name") ?? "";
          const size = readOptionalNumber(x, "size") ?? 0;
          if (!id || !name) return null;
          return { id, name, size };
        })
        .filter(Boolean) as Array<{ id: string; name: string; size: number }>;
    }
  }

  const direct = (selected as unknown as { sourceFiles?: unknown }).sourceFiles;
  if (Array.isArray(direct)) {
    return direct
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const id = readOptionalString(x, "id") ?? "";
        const name = readOptionalString(x, "name") ?? "";
        const size = readOptionalNumber(x, "size") ?? 0;
        if (!id || !name) return null;
        return { id, name, size };
      })
      .filter(Boolean) as Array<{ id: string; name: string; size: number }>;
  }

  return [];
}

function uniqWorkItemsById(items: CreatorWorkItem[]): CreatorWorkItem[] {
  const bestById = new Map<string, CreatorWorkItem>();
  const order: string[] = [];

  for (const it of items) {
    const prev = bestById.get(it.id);
    if (!prev) {
      bestById.set(it.id, it);
      order.push(it.id);
      continue;
    }
    const pu = prev.updatedAt ?? 0;
    const nu = it.updatedAt ?? 0;
    if (nu >= pu) bestById.set(it.id, it);
  }

  const out: CreatorWorkItem[] = [];
  for (const id of order) {
    const v = bestById.get(id);
    if (v) out.push(v);
  }
  return out;
}

/**
 * s3:// videoUrl을 브라우저에서 직접 로드하면 실패가 발생할 수 있어 presign 해석
 */
function extractUrlFromUnknown(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (!v || typeof v !== "object") return "";
  const url = (v as Record<string, unknown>)["url"];
  if (typeof url === "string") return url.trim();
  const playableUrl = (v as Record<string, unknown>)["playableUrl"];
  if (typeof playableUrl === "string") return playableUrl.trim();
  return "";
}

async function resolvePlayableVideoUrl(raw: string, signal: AbortSignal): Promise<string> {
  const s = raw.trim();
  if (!s) return "";

  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("blob:") || s.startsWith("data:")) {
    return s;
  }
  if (s.startsWith("mock://")) return s;

  if (s.startsWith("s3://")) {
    const fn = resolveEducationVideoUrl as unknown;

    if (typeof fn === "function") {
      try {
        const r2 = await (fn as (a: string, b: { signal?: AbortSignal }) => Promise<unknown>)(s, { signal });
        const u2 = extractUrlFromUnknown(r2);
        if (u2) return u2;
      } catch {
        // fallthrough
      }

      try {
        const r1 = await (fn as (a: string) => Promise<unknown>)(s);
        const u1 = extractUrlFromUnknown(r1);
        if (u1) return u1;
      } catch {
        return "";
      }
    }
  }

  return "";
}

type VideoResolveState = "idle" | "resolving" | "ready" | "error";

function readPipelineView(it: CreatorWorkItem | null): { state: string; progress: number; message: string; running: boolean } {
  if (!it) return { state: "IDLE", progress: 0, message: "", running: false };

  const pipeline = (it as unknown as { pipeline?: unknown }).pipeline;
  if (pipeline && typeof pipeline === "object") {
    const state = readOptionalString(pipeline, "state") ?? "IDLE";
    const progress = readOptionalNumber(pipeline, "progress") ?? 0;
    const message = readOptionalString(pipeline, "message") ?? "";
    const running = state === "RUNNING";
    return { state, progress, message, running };
  }

  const job = (it as unknown as { jobStatus?: unknown }).jobStatus;
  if (job && typeof job === "object") {
    const state = readOptionalString(job, "state") ?? readOptionalString(job, "status") ?? "IDLE";
    const progress = readOptionalNumber(job, "progress") ?? 0;
    const message = readOptionalString(job, "message") ?? "";
    const running = statusKey(state) === "RUNNING" || statusKey(state) === "PROCESSING";
    return { state: statusKey(state) || "IDLE", progress, message, running };
  }

  return { state: "IDLE", progress: 0, message: "", running: false };
}

function readScriptText(it: CreatorWorkItem | null): string {
  if (!it) return "";
  const assets = (it as unknown as { assets?: unknown }).assets;
  if (assets && typeof assets === "object") {
    const s = (assets as Record<string, unknown>)["script"];
    if (typeof s === "string") return s;
  }
  const direct = (it as unknown as { script?: unknown }).script;
  if (typeof direct === "string") return direct;
  const direct2 = (it as unknown as { scriptText?: unknown }).scriptText;
  if (typeof direct2 === "string") return direct2;
  return "";
}

function readVideoUrl(it: CreatorWorkItem | null): string {
  if (!it) return "";
  const assets = (it as unknown as { assets?: unknown }).assets;
  if (assets && typeof assets === "object") {
    const v = (assets as Record<string, unknown>)["videoUrl"];
    if (typeof v === "string") return v;
  }
  const direct = (it as unknown as { videoUrl?: unknown }).videoUrl;
  if (typeof direct === "string") return direct;
  return "";
}

function readSourceFileName(it: CreatorWorkItem | null): string {
  if (!it) return "";
  const assets = (it as unknown as { assets?: unknown }).assets;
  if (assets && typeof assets === "object") {
    const n = (assets as Record<string, unknown>)["sourceFileName"];
    if (typeof n === "string") return n;
  }
  const direct = (it as unknown as { sourceFileName?: unknown }).sourceFileName;
  if (typeof direct === "string") return direct;
  return "";
}

function readSourceFileSize(it: CreatorWorkItem | null): number | null {
  if (!it) return null;
  const assets = (it as unknown as { assets?: unknown }).assets;
  if (assets && typeof assets === "object") {
    const s = (assets as Record<string, unknown>)["sourceFileSize"];
    if (typeof s === "number" && Number.isFinite(s)) return s;
  }
  const direct = (it as unknown as { sourceFileSize?: unknown }).sourceFileSize;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  return null;
}

function readScriptId(it: CreatorWorkItem | null): string {
  if (!it) return "";
  
  // 1. 메타데이터에서 scriptId 확인 (우선순위 높음)
  const meta = it as unknown as Record<string, unknown>;
  const metaScriptId = meta["scriptId"];
  if (typeof metaScriptId === "string" && metaScriptId.trim().length > 0) {
    return metaScriptId.trim();
  }
  
  // 2. 직접 필드에서 확인
  const direct = (it as unknown as { scriptId?: unknown }).scriptId;
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();

  // 3. assets에서 확인
  const assets = (it as unknown as { assets?: unknown }).assets;
  if (assets && typeof assets === "object") {
    const v = (assets as Record<string, unknown>)["scriptId"];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }

  return "";
}

function readVideoIdPreferred(it: CreatorWorkItem | null): string {
  if (!it) return "";
  const v1 = (it as unknown as { videoId?: unknown }).videoId;
  if (typeof v1 === "string" && v1.trim()) return v1.trim();
  const v2 = (it as unknown as { educationId?: unknown }).educationId;
  if (typeof v2 === "string" && v2.trim()) return v2.trim();
  return it.id;
}

const EMPTY_IDS: string[] = [];

const CreatorStudioView: React.FC<CreatorStudioViewProps> = ({
  anchor,
  onClose,
  onRequestFocus,
  userRole,
  creatorName,
  allowedDeptIds,
}) => {
  const role: UserRole = userRole ?? "VIDEO_CREATOR";
  const canOpen = can(role, "OPEN_CREATOR_STUDIO");
  useEffect(() => {
    if (!canOpen) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen]);

  // 컨트롤러가 undefined를 "필터 적용/허용 없음"으로 해석하는 케이스 방어
  const safeAllowedDeptIds = allowedDeptIds ?? null;

  const controller = useCreatorStudioController({
    creatorName: creatorName ?? "VIDEO_CREATOR",
    allowedDeptIds: safeAllowedDeptIds,
  });

  const {
    departments,
    categories,
    templates,
    jobTrainings,
    creatorType,

    tab,
    setTab,
    query,
    setQuery,
    sortMode,
    setSortMode,

    filteredItems,
    selectedItem,
    selectItem,
    createDraft,
    updateSelectedMeta,
    updateSelected,

    addSourceFilesToSelected,
    removeSourceFileFromSelected,

    runPipelineForSelected,
    runVideoOnlyForSelected,
    retryPipelineForSelected,
    showToast,
    requestReviewForSelected,
    reopenRejectedToDraft,
    deleteDraft,
    selectedValidation,
    toast,
    refreshItems,
  } = controller;

  // 화면 포커스 시 목록 갱신 (승인 후 복귀 시 상태 동기화)
  useEffect(() => {
    if (!canOpen) return;
    
    const handleFocus = () => {
      if (refreshItems) {
        void refreshItems({ silent: true });
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [canOpen, refreshItems]);

  // 뷰 → 컨트롤러 patch 전달 래퍼(타입 유연성 유지)
  const updateSelectedMetaCompat = useCallback(
    (patch: Record<string, unknown>) => {
      updateSelectedMeta(patch as unknown as Record<string, unknown>);
    },
    [updateSelectedMeta]
  );

  // 제목 입력 debounce를 위한 로컬 state 및 타이머
  const [localTitle, setLocalTitle] = useState<string>("");
  const titleDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // selectedItem의 title이 변경될 때 로컬 state 동기화
  useEffect(() => {
    if (selectedItem) {
      setLocalTitle(selectedItem.title ?? "");
    } else {
      setLocalTitle("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id, selectedItem?.title]);

  // 제목 저장 debounce 함수
  const debouncedSaveTitle = useCallback(
    (newTitle: string) => {
      // 기존 타이머 취소
      if (titleDebounceTimerRef.current) {
        clearTimeout(titleDebounceTimerRef.current);
      }

      // 새로운 타이머 설정 (500ms 후 저장)
      titleDebounceTimerRef.current = setTimeout(() => {
        if (selectedItem && newTitle !== selectedItem.title) {
          updateSelectedMeta({ title: newTitle });
        }
        titleDebounceTimerRef.current = null;
      }, 500);
    },
    [selectedItem, updateSelectedMeta]
  );

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (titleDebounceTimerRef.current) {
        clearTimeout(titleDebounceTimerRef.current);
      }
    };
  }, []);

  // ==== options normalization (컨트롤러 shape 변화 대비) ====
  const normalizedDepartments = useMemo<IdName[]>(
    () => toIdNameList(departments as unknown as unknown[]),
    [departments]
  );

  // “전체 부서/전사” 옵션의 id를 수집 (targetDeptIds에 섞여 내려오는 레거시 케이스 대응)
  const allDeptIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const d of normalizedDepartments) {
      if (isAllDeptOption(d)) set.add(d.id);
    }
    // 흔한 sentinel id들 추가 방어
    ["ALL", "all", "ALL_DEPT", "ALL_DEPTS", "ALL_DEPARTMENTS", "TOTAL"].forEach((x) => set.add(x));
    return set;
  }, [normalizedDepartments]);

  // 선택 가능한 부서 목록(부서 제작자/허용 부서 스코프 반영)
  const selectableDepartments = useMemo(() => {
    const base = normalizedDepartments;

    const scoped =
      creatorType === "DEPT_CREATOR" &&
        Array.isArray(safeAllowedDeptIds) &&
        safeAllowedDeptIds.length > 0
        ? (() => {
          const allow = new Set(safeAllowedDeptIds);
          return base.filter((d) => allow.has(d.id));
        })()
        : base;

    // “전체 부서/전사” 옵션 제거 (전사 대상(전체) 체크박스만 남긴다)
    return scoped.filter((d) => !isAllDeptOption(d));
  }, [normalizedDepartments, creatorType, safeAllowedDeptIds]);

  // 전사(전체) ↔ 개별부서 토글 시 “마지막 개별 부서 선택”을 기억/복원
  const deptSelectionMemoryRef = useRef<Map<string, string[]>>(new Map());

  const selectedItemId = selectedItem?.id ?? "";
  const selectedTargetDeptIds = selectedItem?.targetDeptIds ?? EMPTY_IDS;

  useEffect(() => {
    if (!selectedItemId) return;

    // 전사 sentinel(전체 부서 등)은 기억에서 제거
    const cleaned = selectedTargetDeptIds.filter((id) => !allDeptIdSet.has(id));

    if (cleaned.length > 0) {
      deptSelectionMemoryRef.current.set(selectedItemId, [...cleaned]);
    }
  }, [selectedItemId, selectedTargetDeptIds, allDeptIdSet]);

  const normalizedCategories = useMemo<IdName[]>(
    () => toIdNameList(categories as unknown as unknown[], (id) => id),
    [categories]
  );

  const normalizedTemplates = useMemo<IdName[]>(
    () => toIdNameList(templates as unknown as unknown[], (id) => id),
    [templates]
  );

  const normalizedJobTrainings = useMemo<IdName[]>(
    () => toIdNameList(jobTrainings as unknown as unknown[], (id) => id),
    [jobTrainings]
  );

  // label maps (여기서 원본 categories 쓰면 name 누락 시 전부 id만 표기됨)
  const deptNameById = useMemo(
    () => new Map(normalizedDepartments.map((d) => [d.id, d.name])),
    [normalizedDepartments]
  );
  const categoryNameById = useMemo(
    () => new Map(normalizedCategories.map((c) => [c.id, c.name])),
    [normalizedCategories]
  );
  const templateNameById = useMemo(
    () => new Map(normalizedTemplates.map((t) => [t.id, t.name])),
    [normalizedTemplates]
  );
  const trainingNameById = useMemo(
    () => new Map(normalizedJobTrainings.map((t) => [t.id, t.name])),
    [normalizedJobTrainings]
  );

  type TrainingOptionsProp = React.ComponentProps<typeof CreatorTrainingSelect>["options"];
  const trainingOptions = useMemo<TrainingOptionsProp>(() => normalizedJobTrainings, [normalizedJobTrainings]);

  const needsCatalog =
    normalizedDepartments.length === 0 ||
    normalizedCategories.length <= 1 || // 현재 “C001만 보임” 케이스 대응
    normalizedTemplates.length === 0 ||
    normalizedJobTrainings.length === 0;

  const catalogBootstrapFn = useMemo(() => {
    return pickFirstFunction(controller, [
      "loadCatalogs",
      "refreshCatalogs",
      "fetchCatalogs",
      "bootstrapCatalog",
      "bootstrap",
      "init",
      "ensureCatalogs",
      "ensureCatalogLoaded",
      "reloadCatalogs",
    ]);
  }, [controller]);

  const runCatalogBootstrap = useCallback(
    async (reason: "auto" | "manual") => {
      if (!catalogBootstrapFn) return;
      try {
        await Promise.resolve(catalogBootstrapFn());
      } catch {
        if (reason === "manual") {
          showToast(
            "error",
            "카탈로그 로딩에 실패했습니다. Network 탭에서 /admin/catalog/* 요청이 발생하는지 먼저 확인하세요."
          );
        }
      }
    },
    [catalogBootstrapFn, showToast]
  );

  useEffect(() => {
    if (!needsCatalog) return;
    // auto 1회 + 수동 reload(seq)마다 재시도
    runCatalogBootstrap("auto");
  }, [needsCatalog, runCatalogBootstrap]);

  const rawItems: CreatorWorkItem[] = useMemo(() => {
    const maybe = controller as unknown as {
      items?: CreatorWorkItem[];
      allItems?: CreatorWorkItem[];
      workItems?: CreatorWorkItem[];
    };

    const src =
      (Array.isArray(maybe.items) && maybe.items) ||
      (Array.isArray(maybe.allItems) && maybe.allItems) ||
      (Array.isArray(maybe.workItems) && maybe.workItems) ||
      (Array.isArray(filteredItems) && filteredItems) ||
      [];

    return uniqWorkItemsById(src);
  }, [controller, filteredItems]);

  const [creatorStageFilter, setCreatorStageFilter] = useState<CreatorStageFilter>("all");

  useEffect(() => {
    setCreatorStageFilter("all");
  }, [tab]);

  const tabMatchedItems = useMemo(() => rawItems.filter((it) => matchTab(tab, it)), [rawItems, tab]);

  const searchedItems = useMemo(() => {
    return filterByQuery(
      tabMatchedItems,
      query,
      normalizedDepartments,
      normalizedCategories,
      normalizedTemplates,
      normalizedJobTrainings
    );
  }, [
    tabMatchedItems,
    query,
    normalizedDepartments,
    normalizedCategories,
    normalizedTemplates,
    normalizedJobTrainings,
  ]);

  const sortedItems = useMemo(() => sortItems(searchedItems, sortMode), [searchedItems, sortMode]);

  const creatorStageCounts = useMemo(() => {
    if (tab === "draft" || tab === "failed" || tab === "approved") {
      return { all: sortedItems.length, stage1: 0, stage2: 0, enabled: false };
    }

    let stage1 = 0;
    let stage2 = 0;

    for (const it of sortedItems) {
      const st = getStageForTab(tab, it);
      if (st === 1) stage1 += 1;
      else if (st === 2) stage2 += 1;
    }

    return { all: sortedItems.length, stage1, stage2, enabled: stage1 + stage2 > 0 };
  }, [sortedItems, tab]);

  const visibleItems = useMemo(() => {
    if (tab === "draft" || tab === "failed" || tab === "approved") return sortedItems;
    if (creatorStageFilter === "all") return sortedItems;

    const target = creatorStageFilter === "stage1" ? 1 : 2;
    return sortedItems.filter((it) => getStageForTab(tab, it) === target);
  }, [sortedItems, creatorStageFilter, tab]);

  useEffect(() => {
    if (!selectedItem) return;
    if (visibleItems.length === 0) return;
    const exists = visibleItems.some((it) => it.id === selectedItem.id);
    if (!exists) selectItem(visibleItems[0].id);
  }, [visibleItems, selectedItem, selectItem]);

  const initialSizeRef = useRef<Size>(fitSizeToViewport(INITIAL_SIZE));
  const [size, setSize] = useState<Size>(initialSizeRef.current);

  const sizeRef = useRef<Size>(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const [panelPos, setPanelPos] = useState(() => {
    const pos = computePanelPosition(anchor ?? null, initialSizeRef.current);
    const b = getBounds(initialSizeRef.current.width, initialSizeRef.current.height);
    return {
      left: Math.round(clamp(pos.left, b.minLeft, b.maxLeft)),
      top: Math.round(clamp(pos.top, b.minTop, b.maxTop)),
    };
  });

  const panelPosRef = useRef(panelPos);
  useEffect(() => {
    panelPosRef.current = panelPos;
  }, [panelPos]);

  const userMovedRef = useRef(false);
  const didInitFromAnchorRef = useRef(false);

  const resizeRef = useRef<ResizeState>({
    resizing: false,
    dir: null,
    startX: 0,
    startY: 0,
    startWidth: initialSizeRef.current.width,
    startHeight: initialSizeRef.current.height,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  const dragRef = useRef<DragState>({
    dragging: false,
    startX: 0,
    startY: 0,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  const [filesModalOpen, setFilesModalOpen] = useState(false);
  const [jumpToPipelineOnClose, setJumpToPipelineOnClose] = useState(false);
  const detailScrollRef = useRef<HTMLDivElement | null>(null);

  /* =========================
   Education picker (교육 선택 → 콘텐츠 생성)
========================= */

  const [eduPickerOpen, setEduPickerOpen] = useState(false);
  const [eduPickerQuery, setEduPickerQuery] = useState("");
  const [eduLoading, setEduLoading] = useState(false);
  const [eduError, setEduError] = useState<string | null>(null);
  const [educations, setEducations] = useState<CreatorEducationWithVideosItem[]>([]);
  const [eduSelectedId, setEduSelectedId] = useState<string>("");

  const educationLoaderFn = useMemo(() => {
    return pickFirstFunction(controller, [
      "getEducationsWithVideos",
      "loadEducationsWithVideos",
      "fetchEducationsWithVideos",
      "listEducationsWithVideos",
      "getEducations",
      "loadEducations",
      "fetchEducations",
      "listEducations",
    ]);
  }, [controller]);

  const educationCreateDraftFn = useMemo(() => {
    return pickFirstFunction(controller, [
      "createDraftForEducation",
      "createDraftWithEducation",
      "createDraftByEducation",
      "createDraftWithEducationId",
    ]);
  }, [controller]);

  const educationsById = useMemo(() => {
    const m = new Map<string, CreatorEducationWithVideosItem>();
    for (const e of educations) m.set(e.id, e);
    return m;
  }, [educations]);

  const boundEducationId = useMemo(() => {
    if (!selectedItem) return "";
    return readOptionalString(selectedItem as unknown, "educationId") ?? "";
  }, [selectedItem]);

  const boundEducation = useMemo(() => {
    if (!boundEducationId) return null;
    return educationsById.get(boundEducationId) ?? null;
  }, [boundEducationId, educationsById]);

  const boundDeptLocked = !!(
    boundEducation &&
    Array.isArray(boundEducation.departmentScope) &&
    boundEducation.departmentScope.length > 0
  );

  const deptIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of normalizedDepartments) {
      // 같은 이름이 여러 개면 최초 1개 매칭(일단 안전)
      if (!m.has(d.name)) m.set(d.name, d.id);
    }
    return m;
  }, [normalizedDepartments]);

  const mapDeptNamesToIds = useCallback(
    (names: readonly string[]) => {
      const out: string[] = [];
      for (const nm of names) {
        const id = deptIdByName.get(nm);
        if (id) out.push(id);
      }
      // 중복 제거
      return Array.from(new Set(out));
    },
    [deptIdByName]
  );

  const loadEducationsOnce = useCallback(async () => {
    if (!educationLoaderFn) {
      setEduError("교육 목록 로더 함수가 없습니다. (useCreatorStudioController.ts에서 교육 목록 API를 노출해야 합니다.)");
      return;
    }
    setEduLoading(true);
    setEduError(null);
    try {
      const raw = await Promise.resolve(educationLoaderFn());
      const list = toEducationList(raw);
      setEducations(list);

      // 최초 오픈 시 1개 기본 선택
      if (!eduSelectedId && list.length > 0) setEduSelectedId(list[0].id);
    } catch {
      setEduError("교육 목록을 불러오지 못했습니다. Network 탭에서 교육 목록 요청이 발생하는지 확인하세요.");
    } finally {
      setEduLoading(false);
    }
  }, [educationLoaderFn, eduSelectedId]);

  useEffect(() => {
    if (!eduPickerOpen) return;
    if (educations.length > 0) return;
    // 모달이 열릴 때 1회 로드
    loadEducationsOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eduPickerOpen]);

  const filteredEducations = useMemo(() => {
    const q = normalizeText(eduPickerQuery);
    if (!q) return educations;

    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return educations;

    return educations.filter((e) => {
      const deptText = Array.isArray(e.departmentScope) ? e.departmentScope.join(" ") : "";
      const period = formatIsoRange(e.startAt, e.endAt);
      const hay = normalizeText([e.title, deptText, period].filter(Boolean).join(" "));
      return tokens.every((t) => hay.includes(t));
    });
  }, [educations, eduPickerQuery]);

  // 생성 직후 “선택한 교육 메타 주입”을 위한 pending ref
  const pendingEducationApplyRef = useRef<CreatorEducationWithVideosItem | null>(null);
  const pendingPreSelectedItemIdRef = useRef<string>("");
  const pendingTargetItemIdRef = useRef<string>("");

  const applyEducationMetaToSelected = useCallback((edu: CreatorEducationWithVideosItem) => {
    if (!selectedItem) return;

    const patch: Record<string, unknown> = {};
    // WorkItem이 educationId를 안 들고 있으면 심어준다(뷰/표시/잠금 판단용)
    patch.educationId = edu.id;

    // title은 백엔드가 이미 설정할 수 있으므로 “명백히 더미/빈 값”일 때만 덮는다
    const curTitle = String(selectedItem.title ?? "").trim();
    if (!curTitle || curTitle.includes("새 교육")) {
      const pendingTitle = pendingDraftTitleRef.current.trim();
      patch.title = pendingTitle || edu.title;
    }

    // 대상 부서: 교육의 departmentScope(부서명)을 현재 부서 카탈로그(부서명→id)로 매핑
    if (Array.isArray(edu.departmentScope)) {
      const names = edu.departmentScope.filter((x) => typeof x === "string" && x.trim()) as string[];
      if (names.length === 0) {
        // 전사(전체)로 해석: targetDeptIds=[]
        patch.targetDeptIds = [];
      } else {
        const mapped = mapDeptNamesToIds(names);
        if (mapped.length > 0) {
          patch.targetDeptIds = mapped;
        } else {
          // 매핑 실패 시에도 초안 생성은 계속 진행 (부서는 빈 배열로 설정)
          // 경고 메시지는 표시하되, 초안 생성은 중단하지 않음
          patch.targetDeptIds = [];
          showToast(
            "info",
            "선택한 교육의 대상 부서를 현재 부서 목록에서 매핑하지 못했습니다. 부서 카탈로그(명칭/옵션)를 확인해주세요. 초안은 생성되지만 부서 설정이 비어있습니다.",
            5000
          );
        }
      }
    }

    updateSelectedMetaCompat(patch);
  },
    [mapDeptNamesToIds, selectedItem, showToast, updateSelectedMetaCompat]
  );

  // selectedItem이 “새로 생성된 초안”으로 바뀌는 시점에 교육 메타를 1회 주입
  useEffect(() => {
    const pendingEdu = pendingEducationApplyRef.current;
    if (!pendingEdu) return;
    if (!selectedItem) return;

    const pre = pendingPreSelectedItemIdRef.current;
    const targetId = pendingTargetItemIdRef.current;

    const selectedId = selectedItem.id;

    // (1) create 함수가 id를 반환한 경우: 그 id가 선택됐을 때 적용
    if (targetId && selectedId !== targetId) return;

    // (2) id를 모르는 경우: “생성 전 선택 id”와 다르면 새 초안으로 판단하고 적용
    if (!targetId && pre && selectedId === pre) return;

    pendingEducationApplyRef.current = null;
    pendingPreSelectedItemIdRef.current = "";
    pendingTargetItemIdRef.current = "";
    pendingDraftTitleRef.current = "";

    applyEducationMetaToSelected(pendingEdu);
  }, [selectedItem, applyEducationMetaToSelected]);

  const openEducationPicker = useCallback(() => {
    setEduPickerQuery("");
    setEduError(null);
    setEduPickerOpen(true);

    if (boundEducationId) {
      setEduSelectedId(boundEducationId);
    } else if (educations.length > 0) {
      setEduSelectedId((prev) => prev || educations[0].id);
    }
  }, [boundEducationId, educations]);

  // createDraftForEducation에 넘길 "버전명(title)" 규칙
  // - 동일 educationId로 이미 생성된 workItem들의 max(version)+1 기반
  // - 제목은 UI의 vN 뱃지와 중복되지 않도록 "N차 초안" 형태로 구성
  const buildDraftTitleForEducation = useCallback(
    (edu: CreatorEducationWithVideosItem) => {
      const base = String(edu.title ?? "").trim() || "새 교육 콘텐츠";

      let maxVersion = 0;
      for (const it of rawItems) {
        const eid = readOptionalString(it as unknown, "educationId") ?? "";
        if (eid !== edu.id) continue;

        const v = typeof it.version === "number" ? it.version : Number(it.version ?? 0);
        if (Number.isFinite(v) && v > maxVersion) maxVersion = v;
      }

      const next = Math.max(1, maxVersion + 1);
      return `${base} - ${next}차 초안`;
    },
    [rawItems]
  );

  // 생성 직후 title 보정이 필요할 때를 대비 (백엔드가 title 미세팅/더미인 경우)
  const pendingDraftTitleRef = useRef<string>("");


  const confirmEducationAndCreateDraft = useCallback(async () => {
    const edu = educationsById.get(eduSelectedId);
    if (!edu) {
      showToast("info", "교육을 선택해주세요.");
      return;
    }

    // 생성 전 선택 id(비교용)
    pendingPreSelectedItemIdRef.current = selectedItem?.id ?? "";
    pendingEducationApplyRef.current = edu;
    pendingTargetItemIdRef.current = "";

    setEduPickerOpen(false);

    // 1) 컨트롤러에 createDraftForEducation(educationId, title)가 있으면 그걸 사용
    if (educationCreateDraftFn) {
      try {
        const draftTitle = buildDraftTitleForEducation(edu);
        pendingDraftTitleRef.current = draftTitle;

        // createDraftForEducation 호출: 객체 형태로 전달 (컨트롤러에서 지원하는 형태)
        const r = await Promise.resolve(
          (educationCreateDraftFn as unknown as (args: {
            educationId: string;
            title: string;
            departmentScope?: string[];
          }) => Promise<unknown> | unknown)({
            educationId: edu.id,
            title: draftTitle,
            departmentScope: Array.isArray(edu.departmentScope) && edu.departmentScope.length > 0
              ? edu.departmentScope
              : undefined,
          })
        );

        // 반환값이 (id|string|{id}) 일 수 있으니 최대한 해석
        const rid =
          typeof r === "string"
            ? r
            : r && typeof r === "object"
              ? readOptionalString(r, "id") ?? ""
              : "";

        if (rid) {
          pendingTargetItemIdRef.current = rid;
          selectItem(rid);
        }
        return;
      } catch {
        showToast("error", "초안 생성에 실패했습니다. (createDraftForEducation 시그니처: educationId + title 확인 필요)");
        return;
      }
    }

    // 2) 없으면 기존 createDraft를 호출하되, 이 경우는 controller 수정이 필요하다는 토스트를 띄운다
    showToast(
      "info",
      "현재는 ‘교육 선택 후 초안 생성’ 함수가 컨트롤러에 없습니다. 다음 단계로 useCreatorStudioController.ts를 수정해야 합니다."
    );
    try {
      await Promise.resolve(createDraft());
    } catch {
      // createDraft 자체가 실패할 수 있음
    }
  }, [
    createDraft,
    educationsById,
    eduSelectedId,
    educationCreateDraftFn,
    buildDraftTitleForEducation,
    selectItem,
    selectedItem?.id,
    showToast,
  ]);

  useEffect(() => {
    const currentSize = fitSizeToViewport(sizeRef.current);

    if (currentSize.width !== sizeRef.current.width || currentSize.height !== sizeRef.current.height) {
      setSize(currentSize);
    }

    const b = getBounds(currentSize.width, currentSize.height);

    if (userMovedRef.current && didInitFromAnchorRef.current) {
      setPanelPos((p) => ({
        left: Math.round(clamp(p.left, b.minLeft, b.maxLeft)),
        top: Math.round(clamp(p.top, b.minTop, b.maxTop)),
      }));
      return;
    }

    const nextPos = computePanelPosition(anchor ?? null, currentSize);

    setPanelPos({
      left: Math.round(clamp(nextPos.left, b.minLeft, b.maxLeft)),
      top: Math.round(clamp(nextPos.top, b.minTop, b.maxTop)),
    });

    didInitFromAnchorRef.current = true;
  }, [anchor]);

  useEffect(() => {
    const handleWindowResize = () => {
      setSize((prev) => {
        const next = fitSizeToViewport(prev);
        const b = getBounds(next.width, next.height);

        setPanelPos((p) => ({
          left: Math.round(clamp(p.left, b.minLeft, b.maxLeft)),
          top: Math.round(clamp(p.top, b.minTop, b.maxTop)),
        }));

        return next;
      });
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const rs = resizeRef.current;
      const dir = rs.dir;

      if (rs.resizing) {
        if (!dir) return;

        const dx = event.clientX - rs.startX;
        const dy = event.clientY - rs.startY;

        const max = getViewportMaxSize();
        let width = rs.startWidth;
        let height = rs.startHeight;
        let top = rs.startTop;
        let left = rs.startLeft;

        if (dir.includes("e")) width = rs.startWidth + dx;
        if (dir.includes("s")) height = rs.startHeight + dy;
        if (dir.includes("w")) {
          width = rs.startWidth - dx;
          left = rs.startLeft + dx;
        }
        if (dir.includes("n")) {
          height = rs.startHeight - dy;
          top = rs.startTop + dy;
        }

        width = clamp(width, MIN_WIDTH, max.width);
        height = clamp(height, MIN_HEIGHT, max.height);

        const b = getBounds(width, height);
        left = clamp(left, b.minLeft, b.maxLeft);
        top = clamp(top, b.minTop, b.maxTop);

        setSize({ width, height });
        setPanelPos({ left: Math.round(left), top: Math.round(top) });
        return;
      }

      const ds = dragRef.current;
      if (ds.dragging) {
        const dx = event.clientX - ds.startX;
        const dy = event.clientY - ds.startY;

        const curSize = sizeRef.current;
        const b = getBounds(curSize.width, curSize.height);

        const left = clamp(ds.startLeft + dx, b.minLeft, b.maxLeft);
        const top = clamp(ds.startTop + dy, b.minTop, b.maxTop);

        setPanelPos({ left: Math.round(left), top: Math.round(top) });
      }
    };

    const onUp = () => {
      const wasResizing = resizeRef.current.resizing;
      const wasDragging = dragRef.current.dragging;

      resizeRef.current.resizing = false;
      resizeRef.current.dir = null;
      dragRef.current.dragging = false;

      if (wasResizing || wasDragging) {
        userMovedRef.current = true;
      }

      if (typeof document !== "undefined") {
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleResizeMouseDown =
    (dir: ResizeDirection) => (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (typeof document !== "undefined") {
        document.body.style.userSelect = "none";
      }

      const curPos = panelPosRef.current;
      const curSize = sizeRef.current;

      resizeRef.current = {
        resizing: true,
        dir,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: curSize.width,
        startHeight: curSize.height,
        startTop: curPos.top,
        startLeft: curPos.left,
      };

      dragRef.current.dragging = false;
    };

  const handleHeaderMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || tag === "label") return;

    event.preventDefault();

    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
    }

    const curPos = panelPosRef.current;

    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: curPos.top,
      startLeft: curPos.left,
    };

    resizeRef.current.resizing = false;
    resizeRef.current.dir = null;

    onRequestFocus?.();
  };

  const onPanelMouseDown = () => {
    onRequestFocus?.();
  };

  const onCloseClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  // videoStatusRaw를 우선 확인하고, 없으면 status 사용
  const getVideoStatusRaw = (item: CreatorWorkItem | null): string => {
    if (!item) return "";
    const raw = (item as unknown as Record<string, unknown>)["videoStatusRaw"];
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim().toUpperCase();
    return statusKey(item.status);
  };

  const selectedStatusText = selectedItem ? getVideoStatusRaw(selectedItem) : "";
  const scriptApprovedAt = selectedItem ? getScriptApprovedAt(selectedItem) : null;
  const selectedIsScriptApproved = selectedItem ? isScriptApprovedByPolicy(selectedItem) : false;

  const pipelineView = useMemo(() => readPipelineView(selectedItem ?? null), [selectedItem]);
  const isPipelineRunning =
    pipelineView.running ||
    selectedStatusText === "SCRIPT_GENERATING" ||
    selectedStatusText === "GENERATING";

  const isLockedByDocState =
    selectedStatusText === "SCRIPT_GENERATING" ||
    selectedStatusText === "SCRIPT_REVIEW_REQUESTED" ||
    selectedStatusText === "FINAL_REVIEW_REQUESTED" ||
    selectedStatusText === "PUBLISHED" ||
    selectedStatusText === "REVIEW_PENDING" ||
    selectedStatusText === "APPROVED";

  const isHardLocked = !selectedItem || isLockedByDocState || isPipelineRunning;

  const disableMeta = isHardLocked || selectedIsScriptApproved;

  const onPickFile = () => {
    if (!selectedItem) {
      showToast("info", "선택된 콘텐츠가 없습니다.");
      return;
    }
    if (disableMeta) {
      showToast(
        "info",
        selectedIsScriptApproved
          ? "1차 승인 이후에는 소스 파일을 변경할 수 없습니다."
          : "현재 상태에서는 파일을 변경할 수 없습니다."
      );
      return;
    }
    setJumpToPipelineOnClose(false);
    setFilesModalOpen(true);
  };

  const progressScale = clamp(pipelineView.progress / 100, 0, 1);
  const selectedKey = selectedItem?.id ?? null;

  const [scriptSceneDirty, setScriptSceneDirty] = useState(false);
  useEffect(() => {
    setScriptSceneDirty(false);
  }, [selectedKey]);

  useLayoutEffect(() => {
    if (!selectedKey) return;
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedKey]);

  const containerStyle: CreatorCSSVars = {
    "--cb-creator-x": `${panelPos.left}px`,
    "--cb-creator-y": `${panelPos.top}px`,
  };

  const panelStyle: CreatorCSSVars = {
    "--cb-creator-w": `${size.width}px`,
    "--cb-creator-h": `${size.height}px`,
    "--cb-creator-progress": `${progressScale}`,
  };

  const rawVideoUrl = readVideoUrl(selectedItem ?? null).trim();
  const isMockVideo = rawVideoUrl.startsWith("mock://");

  const [playableVideoUrl, setPlayableVideoUrl] = useState<string>("");
  const [videoResolveState, setVideoResolveState] = useState<VideoResolveState>("idle");

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    const run = async () => {
      const raw = rawVideoUrl;

      if (!raw) {
        setPlayableVideoUrl("");
        setVideoResolveState("idle");
        return;
      }

      if (raw.startsWith("mock://")) {
        setPlayableVideoUrl(raw);
        setVideoResolveState("ready");
        return;
      }

      setVideoResolveState(raw.startsWith("s3://") ? "resolving" : "ready");

      const next = await resolvePlayableVideoUrl(raw, ac.signal);

      if (!alive || ac.signal.aborted) return;

      if (next) {
        setPlayableVideoUrl(next);
        setVideoResolveState("ready");
      } else {
        setPlayableVideoUrl("");
        setVideoResolveState("error");
      }
    };

    run().catch(() => {
      if (!alive || ac.signal.aborted) return;
      setPlayableVideoUrl("");
      setVideoResolveState("error");
    });

    return () => {
      alive = false;
      ac.abort();
    };
  }, [selectedItem?.id, rawVideoUrl]);

  const canRenderVideoPlayer =
    playableVideoUrl.length > 0 &&
    !isMockVideo &&
    (playableVideoUrl.startsWith("http://") ||
      playableVideoUrl.startsWith("https://") ||
      playableVideoUrl.startsWith("blob:") ||
      playableVideoUrl.startsWith("data:"));

  const resolvedVideoId = readVideoIdPreferred(selectedItem ?? null);
  const resolvedScriptId = readScriptId(selectedItem ?? null);

  const isJob = selectedItem ? isJobCategory(selectedItem.categoryId) : false;

  const hasAllDeptSentinelSelected = selectedItem
    ? hasAllDeptSentinel(selectedItem.targetDeptIds, allDeptIdSet)
    : false;

  // targetDeptIds가 [] 이거나 “전체부서 sentinel”이 들어있으면 전사로 본다 (필수 로직 없음)
  const isAllCompany = selectedItem
    ? selectedItem.targetDeptIds.length === 0 || hasAllDeptSentinelSelected
    : false;

  const scriptText = readScriptText(selectedItem ?? null);
  const scriptId = selectedItem ? readScriptId(selectedItem) : "";
  // scriptId가 있거나 scriptText가 있으면 스크립트가 생성된 것으로 간주
  const hasScript = scriptText.trim().length > 0 || Boolean(scriptId && scriptId.trim().length > 0);

  const sourceFilesCount = selectedItem ? readSourceFiles(selectedItem).length : 0;
  const hasSourceFile = sourceFilesCount > 0 || readSourceFileName(selectedItem ?? null).trim().length > 0;

  const hasVideo = rawVideoUrl.trim().length > 0;

  const canGenerateScript =
    !!selectedItem &&
    (selectedStatusText === "DRAFT" || selectedStatusText === "SCRIPT_READY" || selectedStatusText === "SCRIPT_GENERATING") &&
    !isHardLocked &&
    hasSourceFile &&
    !selectedIsScriptApproved;

  const canGenerateVideo =
    !!selectedItem &&
    (selectedStatusText === "SCRIPT_APPROVED" || selectedStatusText === "READY" || selectedStatusText === "DRAFT" || selectedIsScriptApproved) &&
    !isHardLocked &&
    selectedIsScriptApproved &&
    hasSourceFile &&
    (hasScript || Boolean(scriptId && scriptId.trim().length > 0));

  const scriptGenLabel = hasScript ? "스크립트 재생성" : "스크립트 생성";
  const videoGenLabel = hasVideo ? "영상 재생성" : "영상 생성";

  const pipelineCardRef = useRef<HTMLDivElement | null>(null);

  function phaseHintFor(item: CreatorWorkItem | null) {
    if (!item) return "";

    // videoStatusRaw를 우선 확인하고, 없으면 status 사용
    const rawStatus = (item as unknown as Record<string, unknown>)["videoStatusRaw"];
    const rawStatusUpper = typeof rawStatus === "string" && rawStatus.trim().length > 0 
      ? rawStatus.trim().toUpperCase() 
      : "";
    const st = rawStatusUpper || statusKey(item.status);
    const sa = isScriptApprovedByPolicy(item);

    if (st === "PUBLISHED" || st === "APPROVED") return "게시됨(최종 승인 완료)";
    if (st === "FINAL_REVIEW_REQUESTED") return "2차(최종) 검토중";
    if (st === "SCRIPT_REVIEW_REQUESTED") return "1차(스크립트) 검토중";
    if (st === "SCRIPT_READY") return "스크립트 준비(1차 요청 가능)";
    if (st === "SCRIPT_APPROVED") return "1차 승인 완료(영상 생성 가능)";
    if (st === "READY") return "영상 준비(2차 요청 가능)";
    if (st === "SCRIPT_GENERATING" || st === "GENERATING") return "생성 중…";
    if (st === "FAILED" || st === "ERROR") return "실패";

    const _hasSource = readSourceFiles(item).length > 0 || readSourceFileName(item).trim().length > 0;
    const _hasScript = readScriptText(item).trim().length > 0;
    const _hasVideo = readVideoUrl(item).trim().length > 0;

    // SCRIPT_READY 상태이면 스크립트 준비 완료로 표시
    if (st === "SCRIPT_READY" || (rawStatusUpper === "SCRIPT_READY")) {
      return "스크립트 준비(1차 요청 가능)";
    }

    if (!_hasSource) return "자료 업로드 대기";
    if (!_hasScript && !sa) return "스크립트 생성 대기";
    if (!sa) return "1차(스크립트) 검토 요청 가능";
    if (!_hasVideo) return "1차 승인 완료 · 영상 생성 대기";
    return "2차(최종) 검토 요청 가능";
  }

  function listStepText(it: CreatorWorkItem) {
    const st = statusKey(it.status);
    if (st === "SCRIPT_REVIEW_REQUESTED") return " · 1차 검토";
    if (st === "FINAL_REVIEW_REQUESTED") return " · 2차 검토";
    if (st === "PUBLISHED" || st === "APPROVED") return " · 게시됨";
    if (isRejectedByHistory(it)) return " · 반려";
    if (st === "FAILED" || st === "ERROR") return " · 실패";
    if (st === "SCRIPT_READY") return " · 1차 요청 가능";
    if (st === "READY") return " · 2차 요청 가능";
    if (st === "SCRIPT_APPROVED") return " · 1차 승인 완료";
    return "";
  }

  const flowModel = useMemo(() => {
    if (!selectedItem) return null;

    return buildCreatorFlowSteps({
      statusText: selectedStatusText,
      hasSourceFile,
      hasScript,
      hasVideo,
      isScriptApproved: selectedIsScriptApproved,
      isPipelineRunning,
      scriptId: resolvedScriptId,
    });
  }, [
    selectedItem,
    selectedStatusText,
    hasSourceFile,
    hasScript,
    hasVideo,
    selectedIsScriptApproved,
    isPipelineRunning,
    resolvedScriptId,
  ]);

  const flowMetaText = selectedItem
    ? `현재: ${phaseHintFor(selectedItem)}${selectedIsScriptApproved && scriptApprovedAt ? ` · 1차 승인 ${formatDateTime(scriptApprovedAt)}` : ""
    }`
    : "";

  const emptyCopy = useMemo(() => getEmptyCopy(tab, creatorStageFilter, query), [tab, creatorStageFilter, query]);

  const showStagePills =
    tab !== "draft" && tab !== "failed" && tab !== "approved" && creatorStageCounts.enabled;

  const selectedPill = selectedItem ? getDisplayStatusPill(selectedItem) : null;

  const creatorFiles: ProjectFileItem[] = useMemo(() => {
    if (!selectedItem) return [];
    const src = readSourceFiles(selectedItem);
    // SRC_TMP로 시작하는 임시 ID는 제외 (업로드 중인 파일은 모달에서 표시하지 않음)
    const completedFiles = src.filter((f) => !f.id.startsWith("SRC_TMP"));
    return completedFiles.map((f, idx) => ({
      id: f.id,
      name: f.name,
      sizeBytes: f.size,
      meta: idx === 0 ? "기본" : undefined,
    }));
  }, [selectedItem]);

  const onDeleteDraft = () => {
    if (!selectedItem) return;

    if (selectedIsScriptApproved) {
      showToast("info", "1차 승인 이후에는 삭제할 수 없습니다. 반려 → 새 버전으로 편집 흐름을 사용하세요.");
      return;
    }

    if (!(selectedStatusText === "DRAFT" || selectedStatusText === "SCRIPT_READY" || selectedStatusText === "FAILED")) {
      showToast("info", "현재 상태에서는 삭제할 수 없습니다.");
      return;
    }

    deleteDraft();
  };

  const safeAwait = async (fn: () => void | Promise<void>) => {
    await Promise.resolve().then(fn);
  };

  return (
    <div className="cb-creator-wrapper" aria-hidden={false}>
      <div className="cb-creator-panel-container" style={containerStyle} onMouseDown={onPanelMouseDown}>
        <div className={cx("cb-panel", "cb-creator-panel")} style={panelStyle} tabIndex={0} role="dialog" aria-label="Creator Studio">
          <button
            className="cb-panel-close-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onCloseClick}
            type="button"
            aria-label="닫기"
          >
            ×
          </button>

          {/* resize handles */}
          <div className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-nw" onMouseDown={handleResizeMouseDown("nw")} />
          <div className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-ne" onMouseDown={handleResizeMouseDown("ne")} />
          <div className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-sw" onMouseDown={handleResizeMouseDown("sw")} />
          <div className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-se" onMouseDown={handleResizeMouseDown("se")} />

          <div className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-n" onMouseDown={handleResizeMouseDown("n")} />
          <div className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-s" onMouseDown={handleResizeMouseDown("s")} />
          <div className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-e" onMouseDown={handleResizeMouseDown("e")} />
          <div className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-w" onMouseDown={handleResizeMouseDown("w")} />

          {/* Header */}
          <div className="cb-creator-header" onMouseDown={handleHeaderMouseDown}>
            <div className="cb-creator-header-main">
              <div className="cb-creator-badge">CREATOR STUDIO</div>
              <div className="cb-creator-title">교육 콘텐츠 제작</div>
              <div className="cb-creator-subrow">
                <div className="cb-creator-subtitle">
                  자료 업로드 → <b>스크립트 생성</b> → <b>1차(스크립트) 승인</b> → <b>영상 생성</b> → <b>2차(최종) 승인</b> → 게시(교육 노출)
                </div>

                <button
                  className="cb-admin-primary-btn cb-creator-create-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={openEducationPicker}
                  type="button"
                >
                  교육 선택 후 콘텐츠 만들기
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="cb-creator-body">
            <div className="cb-creator-layout">
              {/* Left: Queue */}
              <div className="cb-creator-left">
                <div className="cb-creator-left-top">
                  <div className="cb-creator-tabs">
                    {(["draft", "review_pending", "rejected", "approved", "failed"] as CreatorTabId[]).map((t) => (
                      <button
                        key={t}
                        className={cx("cb-reviewer-tab", tab === t && "cb-reviewer-tab--active")}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setTab(t)}
                        type="button"
                      >
                        {tabLabel(t)}
                      </button>
                    ))}
                  </div>

                  {showStagePills && (
                    <div className="cb-creator-stage-row">
                      <div className="cb-reviewer-stage-pills">
                        <button
                          type="button"
                          className={cx("cb-reviewer-stage-pill", creatorStageFilter === "all" && "cb-reviewer-stage-pill--active")}
                          onClick={() => setCreatorStageFilter("all")}
                        >
                          전체 <span className="cb-reviewer-stage-count">{creatorStageCounts.all}</span>
                        </button>
                        <button
                          type="button"
                          className={cx("cb-reviewer-stage-pill", creatorStageFilter === "stage1" && "cb-reviewer-stage-pill--active")}
                          onClick={() => setCreatorStageFilter("stage1")}
                        >
                          1차 <span className="cb-reviewer-stage-count">{creatorStageCounts.stage1}</span>
                        </button>
                        <button
                          type="button"
                          className={cx("cb-reviewer-stage-pill", creatorStageFilter === "stage2" && "cb-reviewer-stage-pill--active")}
                          onClick={() => setCreatorStageFilter("stage2")}
                        >
                          2차 <span className="cb-reviewer-stage-count">{creatorStageCounts.stage2}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="cb-creator-spacer-10" />

                  <div className="cb-creator-search-row">
                    <input
                      className={cx("cb-admin-input", "cb-creator-search-input")}
                      placeholder="제목/카테고리(직무/4대)/부서/템플릿/Training/버전/단계 검색"
                      value={query}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <select
                      className={cx("cb-admin-select", "cb-creator-search-select")}
                      value={sortMode}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => setSortMode(e.target.value as CreatorSortMode)}
                    >
                      <option value="updated_desc">최근 수정</option>
                      <option value="created_desc">최근 생성</option>
                      <option value="updated_asc">수정 오래된</option>
                      <option value="created_asc">생성 오래된</option>
                    </select>
                  </div>
                </div>

                <div className="cb-creator-list">
                  {visibleItems.length === 0 ? (
                    <div className="cb-creator-empty">
                      <div className="cb-creator-empty-title">{emptyCopy.title}</div>
                      <div className="cb-creator-empty-desc">{emptyCopy.desc}</div>
                    </div>
                  ) : (
                    visibleItems.map((it) => {
                      const kindText = isJobCategory(it.categoryId) ? "직무" : "4대";

                      const allCompany = isAllCompanyTarget(it.targetDeptIds, allDeptIdSet);
                      const cleanedDeptIds = cleanDeptIds(it.targetDeptIds, allDeptIdSet);

                      const v = it.version ?? 1;
                      const stepText = listStepText(it);
                      const pill = getDisplayStatusPill(it);

                      const deptText = allCompany
                        ? "전사"
                        : cleanedDeptIds.map((id) => deptNameById.get(id) ?? id).join(", ");

                      const templateText = templateNameById.get(it.templateId) ?? it.templateId;
                      const trainingText = it.jobTrainingId ? trainingNameById.get(it.jobTrainingId) ?? it.jobTrainingId : "";

                      return (
                        <button
                          key={it.id}
                          className={cx("cb-reviewer-item", "cb-creator-item", selectedItem?.id === it.id && "cb-reviewer-item--active")}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => selectItem(it.id)}
                          type="button"
                        >
                          <div className="cb-creator-item-top">
                            <div className="cb-creator-item-main">
                              <div className="cb-creator-item-title">
                                {it.title} <span className="cb-creator-muted">{`v${v}`}</span>
                              </div>
                              <div className="cb-creator-item-sub">
                                {(categoryNameById.get(it.categoryId) ||
                                  (typeof it.categoryLabel === "string" && it.categoryLabel.trim() ? it.categoryLabel : "") ||
                                  it.categoryId)}{" "}
                                · {kindText} · {templateText}
                                {trainingText ? ` · ${trainingText}` : ""}
                                {stepText}
                              </div>
                            </div>

                            <span className={pill.className}>{pill.label}</span>
                          </div>

                          <div className="cb-creator-item-bottom">
                            <div className="cb-creator-item-depts">{deptText}</div>
                            <div className="cb-creator-item-date">{formatDateTime(it.updatedAt)}</div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right: Detail */}
              <div className="cb-creator-right">
                {!selectedItem ? (
                  <div className="cb-creator-right-empty">
                    <div className="cb-creator-empty">
                      <div className="cb-creator-empty-title">
                        선택된 콘텐츠가 없습니다
                      </div>
                      <div className="cb-creator-empty-desc">
                        왼쪽 목록에서 제작할 콘텐츠를 선택해주세요.
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Detail header */}
                    <div className="cb-creator-detail-header">
                      <div className="cb-creator-detail-head-left">
                        <div className="cb-creator-detail-title-row">
                          <div className="cb-creator-detail-title">
                            {selectedItem.title}{" "}
                            <span className="cb-creator-muted">{`v${selectedItem.version ?? 1}`}</span>
                          </div>

                          {selectedPill ? (
                            <span
                              className={cx(
                                selectedPill.className,
                                "cb-creator-detail-status"
                              )}
                            >
                              {selectedPill.label}
                            </span>
                          ) : null}
                        </div>

                        <div className="cb-creator-detail-subline">
                          생성: {formatDateTime(selectedItem.createdAt)} · 수정:{" "}
                          {formatDateTime(selectedItem.updatedAt)} · 작성자:{" "}
                          {selectedItem.createdByName ?? "-"}
                          {" · "}
                          <span className="cb-creator-muted">
                            단계: {phaseHintFor(selectedItem)}
                            {selectedIsScriptApproved && scriptApprovedAt
                              ? ` (1차 승인 ${formatDateTime(scriptApprovedAt)})`
                              : ""}
                          </span>
                        </div>
                      </div>

                      <div className="cb-creator-detail-header-actions">
                        {(selectedStatusText === "DRAFT" ||
                          selectedStatusText === "SCRIPT_READY" ||
                          selectedStatusText === "FAILED") &&
                          !selectedIsScriptApproved && (
                            <button
                              className="cb-admin-ghost-btn"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={onDeleteDraft}
                              type="button"
                            >
                              삭제
                            </button>
                          )}
                      </div>
                    </div>

                    {/* Detail content */}
                    <div className="cb-creator-detail-scroll" ref={detailScrollRef}>
                      <div className="cb-creator-detail-stack">
                        {/* Rejected comment */}
                        {isRejectedByHistory(selectedItem) &&
                          selectedItem.rejectedComment && (
                            <div className="cb-reviewer-detail-card">
                              <div className="cb-reviewer-detail-card-title">
                                반려 사유
                              </div>
                              <div className="cb-reviewer-detail-card-desc">
                                {selectedItem.rejectedComment}
                              </div>
                              <div className="cb-creator-spacer-8" />
                              <div className="cb-creator-muted">
                                반려 건은 읽기 전용입니다. 아래 “새 버전으로 편집”을
                                눌러 재작업을 시작하세요.
                              </div>
                            </div>
                          )}

                        {(selectedStatusText === "FAILED" || selectedStatusText === "ERROR") &&
                          selectedItem.failedReason && (
                            <div className="cb-reviewer-detail-card">
                              <div className="cb-reviewer-detail-card-title">
                                생성 실패
                              </div>
                              <div className="cb-reviewer-detail-card-desc">
                                {selectedItem.failedReason}
                              </div>
                            </div>
                          )}

                        {flowModel?.steps ? (
                          <div className="cb-reviewer-detail-card">
                            <CreatorFlowStepper
                              steps={flowModel.steps}
                              metaText={flowMetaText}
                            />
                          </div>
                        ) : null}

                        {/* Version */}
                        <div className="cb-reviewer-detail-card">
                          <div className="cb-reviewer-detail-card-title">버전</div>
                          <div className="cb-reviewer-detail-card-desc">
                            현재 버전: <b>{`v${selectedItem.version ?? 1}`}</b>
                            {Array.isArray(selectedItem.versionHistory) &&
                              selectedItem.versionHistory.length > 0
                              ? ` · 이전 버전 ${selectedItem.versionHistory.length}개 기록됨`
                              : " · 이전 버전 기록 없음"}
                          </div>
                        </div>

                        {/* Metadata */}
                        <div className="cb-reviewer-detail-card">
                          <div className="cb-reviewer-detail-card-title">기본 정보</div>

                          {/* row A */}
                          <div className="cb-creator-meta-grid2">
                            <label className="cb-creator-field">
                              <div className="cb-creator-field-label">제목</div>
                              <input
                                className="cb-admin-input"
                                value={localTitle}
                                disabled={disableMeta}
                                onMouseDown={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const newTitle = e.target.value;
                                  setLocalTitle(newTitle);
                                  debouncedSaveTitle(newTitle);
                                }}
                                onBlur={() => {
                                  // 포커스가 벗어날 때 즉시 저장 (debounce 타이머가 있다면 취소하고 바로 저장)
                                  if (titleDebounceTimerRef.current) {
                                    clearTimeout(titleDebounceTimerRef.current);
                                    titleDebounceTimerRef.current = null;
                                  }
                                  if (selectedItem && localTitle !== selectedItem.title) {
                                    updateSelectedMeta({ title: localTitle });
                                  }
                                }}
                              />
                            </label>

                            {/* 카테고리 필드 숨김 처리 (데이터/타입은 유지) - 나중에 다시 사용할 수 있도록 주석 처리 */}
                            {(() => {
                              const SHOW_CATEGORY_FIELD = false; // 나중에 다시 사용할 수 있도록 플래그로 제어
                              return SHOW_CATEGORY_FIELD && selectedItem ? (
                                <label className="cb-creator-field">
                                  <div className="cb-creator-field-label">카테고리</div>
                                  <select
                                    className="cb-admin-select"
                                    value={selectedItem.categoryId}
                                    disabled={disableMeta}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const id = e.target.value;
                                      const label = categoryNameById.get(id) ?? id;
                                      updateSelectedMeta({
                                        categoryId: id,
                                        categoryLabel: label,
                                      });
                                    }}
                                  >
                                    {normalizedCategories.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : null;
                            })()}
                          </div>

                          {/* row B - 숨김 처리 (데이터/타입은 유지) - 나중에 다시 사용할 수 있도록 주석 처리 */}
                          {(() => {
                            const SHOW_TEMPLATE_TRAINING_FIELDS = false; // 나중에 다시 사용할 수 있도록 플래그로 제어
                            return SHOW_TEMPLATE_TRAINING_FIELDS && selectedItem ? (
                              <div className="cb-creator-meta-grid2 cb-creator-meta-grid2--mt">
                                <label className="cb-creator-field">
                                  <div className="cb-creator-field-label">영상 템플릿</div>
                                  <select
                                    className="cb-admin-select"
                                    value={selectedItem.templateId ?? ""}
                                    disabled={disableMeta}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      updateSelectedMeta({ templateId: e.target.value })
                                    }
                                  >
                                    {normalizedTemplates.map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="cb-creator-field">
                                  <div className="cb-creator-field-label">
                                    직무교육(Training)
                                  </div>

                                  {isJob ? (
                                    <CreatorTrainingSelect
                                      value={selectedItem.jobTrainingId ?? ""}
                                      options={trainingOptions}
                                      disabled={disableMeta}
                                      onChange={(nextId) =>
                                        updateSelectedMeta({ jobTrainingId: nextId })
                                      }
                                    />
                                  ) : (
                                    <select
                                      className="cb-admin-select"
                                      value=""
                                      disabled
                                      onMouseDown={(e) => e.stopPropagation()}
                                    >
                                      <option value="">
                                        해당 없음 (4대 의무교육 카테고리)
                                      </option>
                                    </select>
                                  )}
                                </label>
                              </div>
                            ) : null;
                          })()}

                          {/* row C - 숨김 처리 (데이터/타입은 유지) - 나중에 다시 사용할 수 있도록 주석 처리 */}
                          {(() => {
                            const SHOW_DEPT_FIELDS = false; // 나중에 다시 사용할 수 있도록 플래그로 제어
                            return SHOW_DEPT_FIELDS && selectedItem ? (
                              <div className="cb-creator-meta-grid2 cb-creator-meta-grid2--mt">
                                <label className="cb-creator-field">
                                  <div className="cb-creator-field-label">대상 부서</div>

                                  <div className="cb-creator-checkbox-box">
                                    <label className="cb-creator-checkitem">
                                      <input
                                        type="checkbox"
                                        checked={isAllCompany}
                                        disabled={
                                          disableMeta ||
                                          creatorType === "DEPT_CREATOR" ||
                                          boundDeptLocked ||
                                          (isAllCompany && selectableDepartments.length === 0)
                                        }
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onChange={(e) => {
                                          if (!selectedItem) return;

                                          const nextChecked = e.target.checked;

                                          // 전사 ON: targetDeptIds = []
                                          if (nextChecked) {
                                            const cleaned = cleanDeptIds(selectedItem.targetDeptIds, allDeptIdSet);
                                            if (cleaned.length > 0) {
                                              deptSelectionMemoryRef.current.set(selectedItem.id, [...cleaned]);
                                            }
                                            updateSelectedMetaCompat({ targetDeptIds: [] });
                                            return;
                                          }

                                          // 전사 OFF: 기억해둔 개별 선택 or 첫 부서로 복원
                                          const rememberedRaw = deptSelectionMemoryRef.current.get(selectedItem.id) ?? [];
                                          const remembered = rememberedRaw.filter((id) => !allDeptIdSet.has(id));
                                          const fallbackFirst = selectableDepartments[0]?.id ? [selectableDepartments[0].id] : [];
                                          const nextDeptIds = remembered.length > 0 ? remembered : fallbackFirst;

                                          if (nextDeptIds.length === 0) {
                                            showToast("info", "부서 목록이 아직 로딩되지 않아 전사 설정을 해제할 수 없습니다.");
                                            return;
                                          }

                                          updateSelectedMetaCompat({ targetDeptIds: nextDeptIds });
                                        }}
                                      />
                                      전사 대상(전체)
                                    </label>

                                    {creatorType === "DEPT_CREATOR" && (
                                      <span className="cb-creator-muted">
                                        부서 제작자는 전사 대상으로 설정할 수 없습니다.
                                      </span>
                                    )}

                                    <div className="cb-creator-spacer-8" />

                                    {/* 전사(전체)일 때는 개별 부서 체크박스를 숨김 */}
                                    {!isAllCompany && (
                                      <>
                                        {selectableDepartments.map((d) => {
                                          const checked = selectedItem.targetDeptIds.includes(d.id);
                                          const disabled = disableMeta || boundDeptLocked;

                                          return (
                                            <label key={d.id} className="cb-creator-checkitem">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={disabled}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onChange={(e) => {
                                                  if (!selectedItem) return;

                                                  const base = selectedItem.targetDeptIds.filter((id) => !allDeptIdSet.has(id));
                                                  const next = e.target.checked
                                                    ? Array.from(new Set([...base, d.id]))
                                                    : base.filter((x) => x !== d.id);

                                                  updateSelectedMetaCompat({ targetDeptIds: next });
                                                }}
                                              />
                                              {d.name}
                                            </label>
                                          );
                                        })}
                                      </>
                                    )}

                                    {isAllCompany && (
                                      <span className="cb-creator-muted">
                                        전사 대상으로 지정되어 개별 부서 선택은 숨김 처리됩니다.
                                      </span>
                                    )}
                                  </div>
                                </label>

                                <label className="cb-creator-field">
                                  <div className="cb-creator-field-label">대상 안내</div>
                                  <div className="cb-creator-inline-box">
                                    <span className="cb-creator-inline-text">
                                      필수/선택 구분 없이 "대상 부서"만 설정합니다.
                                    </span>
                                  </div>
                                </label>
                              </div>
                            ) : null;
                          })()}

                          {selectedIsScriptApproved && (
                            <div className="cb-creator-muted cb-creator-mt-8">
                              1차(스크립트) 승인 이후에는 기본 정보/스크립트 변경이 제한됩니다.
                              수정이 필요하면 반려 처리 후 “새 버전으로 편집” 흐름으로 진행하세요.
                            </div>
                          )}
                        </div>

                        {/* Upload + Pipeline */}
                        <div className="cb-reviewer-detail-card" ref={pipelineCardRef}>
                          <div className="cb-reviewer-detail-card-title">
                            자료 업로드 & 자동 생성
                          </div>
                          <div className="cb-reviewer-detail-card-desc">
                            <b>1차:</b> 자료 업로드 후 스크립트를 생성하고 스크립트만
                            검토 요청합니다. <b>2차:</b> 1차 승인 후 영상 생성/재생성을
                            수행한 뒤 최종 검토 요청을 보냅니다.
                          </div>

                          <div className="cb-creator-upload-row">
                            <button
                              className="cb-admin-ghost-btn"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={onPickFile}
                              disabled={disableMeta}
                              type="button"
                            >
                              자료 업로드
                            </button>

                            <div className="cb-creator-upload-filename">
                              {(() => {
                                // 업로드 완료된 파일만 표시 (SRC_TMP로 시작하는 임시 ID 제외)
                                const src = readSourceFiles(selectedItem).filter(
                                  (f) => !f.id.startsWith("SRC_TMP")
                                );
                                
                                if (src.length > 0) {
                                  const first = src[0];
                                  const extra = src.length > 1 ? ` 외 ${src.length - 1}개` : "";
                                  // 업로드 중인 파일이 있는지 확인
                                  const uploading = readSourceFiles(selectedItem).some(
                                    (f) => f.id.startsWith("SRC_TMP")
                                  );
                                  
                                  return (
                                    <>
                                      업로드됨: {first.name}
                                      {extra ? <span className="cb-creator-muted">{extra}</span> : null}
                                      {typeof first.size === "number" && first.size > 0 ? (
                                        <span className="cb-creator-muted">{` (${formatBytes(first.size)})`}</span>
                                      ) : null}
                                      {uploading ? (
                                        <span className="cb-creator-muted"> · 업로드 중...</span>
                                      ) : null}
                                    </>
                                  );
                                }

                                // sourceFiles가 없을 때만 레거시 필드 확인
                                const name = readSourceFileName(selectedItem);
                                const size = readSourceFileSize(selectedItem);

                                return name ? (
                                  <>
                                    업로드됨: {name}
                                    {size ? (
                                      <span className="cb-creator-muted">
                                        {` (${formatBytes(size)})`}
                                      </span>
                                    ) : null}
                                  </>
                                ) : (
                                  "업로드된 파일 없음"
                                );
                              })()}
                            </div>
                          </div>

                          <div className="cb-creator-pipeline-row">
                            <div className="cb-creator-pipeline-status">
                              <div className="cb-creator-pipeline-status-title">
                                상태:{" "}
                                {pipelineView.state === "RUNNING"
                                  ? pipelineView.message || "진행 중"
                                  : phaseHintFor(selectedItem)}
                              </div>

                              <div className="cb-creator-pipeline-status-desc">
                                {pipelineView.state !== "IDLE" && pipelineView.progress > 0
                                  ? `진행률 ${pipelineView.progress}%`
                                  : !hasSourceFile
                                    ? "자료를 업로드하세요."
                                    : !selectedIsScriptApproved
                                      ? hasScript
                                        ? "스크립트가 생성되었습니다. 1차(스크립트) 검토 요청을 제출하세요."
                                        : "스크립트를 생성하세요."
                                      : !hasVideo
                                        ? "1차 승인 완료. 영상 생성 버튼으로 2차 준비를 진행하세요."
                                        : "영상이 준비되었습니다. 최종 검토 요청(2차)을 제출하세요."}
                              </div>
                            </div>

                            <div className="cb-creator-pipeline-actions">
                              {(selectedStatusText === "FAILED" || selectedStatusText === "ERROR") ? (
                                <button
                                  className="cb-admin-primary-btn"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={retryPipelineForSelected}
                                  type="button"
                                >
                                  재시도
                                </button>
                              ) : selectedIsScriptApproved ? (
                                <button
                                  className="cb-admin-primary-btn"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={runVideoOnlyForSelected}
                                  disabled={!canGenerateVideo}
                                  type="button"
                                >
                                  {videoGenLabel}
                                </button>
                              ) : (
                                <button
                                  className="cb-admin-primary-btn"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={runPipelineForSelected}
                                  disabled={!canGenerateScript}
                                  type="button"
                                >
                                  {scriptGenLabel}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="cb-creator-progress">
                            <div className="cb-creator-progress-bar" />
                          </div>
                        </div>

                        {/* Preview */}
                        <div className="cb-reviewer-detail-card">
                          <div className="cb-reviewer-detail-card-title">미리보기</div>
                          <div className="cb-reviewer-detail-card-desc">
                            <b>1차:</b> 스크립트를 확인/수정 후 검토 요청 <b>2차:</b>{" "}
                            (1차 승인 후) 영상까지 생성해 최종 검토 요청
                          </div>

                          <div className="cb-creator-preview-grid">
                            <div className="cb-creator-preview-col">
                              <div className="cb-creator-preview-label">
                                스크립트{" "}
                                {selectedIsScriptApproved
                                  ? "(1차 승인 완료)"
                                  : "(1차 검토 대상)"}
                              </div>

                              {hasScript ? (
                                <>
                                  <CreatorScriptSceneEditor
                                    scriptId={resolvedScriptId}
                                    videoId={resolvedVideoId}
                                    scriptText={scriptText}
                                    disabled={disableMeta}
                                    showToast={showToast}
                                    onCommitScriptText={(next) => {
                                      // 씬 저장 후에는 로컬 상태만 업데이트 (이미 PUT /scripts/{scriptId}로 저장됨)
                                      // updateSelectedScript는 불필요한 API 호출을 하므로 직접 updateSelected 사용
                                      // updateSelected는 함수형 업데이트를 사용하므로 최신 selectedItem 자동 반영
                                      updateSelected({
                                        assets: {
                                          script: next,
                                        },
                                      });
                                    }}
                                    onDirtyChange={setScriptSceneDirty}
                                  />

                                  {scriptSceneDirty && !disableMeta ? (
                                    <div className="cb-creator-muted cb-creator-mt-6">
                                      저장되지 않은 스크립트 수정이 있습니다. 수정한 씬에서 “저장(씬)”을 눌러 반영하세요.
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <div className="cb-creator-muted">스크립트 생성 후 씬 편집이 가능합니다.</div>
                              )}

                              {selectedIsScriptApproved && (
                                <div className="cb-creator-muted cb-creator-mt-6">
                                  1차 승인 이후 스크립트는 잠금됩니다.
                                </div>
                              )}
                            </div>

                            <div className="cb-creator-preview-col">
                              <div className="cb-creator-preview-label">
                                영상 (2차 검토 대상)
                              </div>
                              <div className="cb-creator-video-frame">
                                {rawVideoUrl ? (
                                  isMockVideo ? (
                                    <div className="cb-creator-video-placeholder">
                                      (mock) video: {rawVideoUrl}
                                      <div className="cb-creator-video-subline">
                                        실제 연동 시 HTML5 video player가 재생됩니다.
                                      </div>
                                    </div>
                                  ) : canRenderVideoPlayer ? (
                                    <video
                                      key={playableVideoUrl}
                                      className="cb-creator-video-player"
                                      src={playableVideoUrl}
                                      controls
                                      preload="metadata"
                                      playsInline
                                    />
                                  ) : (
                                    <div className="cb-creator-video-placeholder">
                                      {videoResolveState === "resolving"
                                        ? "영상 URL 해석 중…"
                                        : videoResolveState === "error"
                                          ? "영상 URL 해석에 실패했습니다. (s3:// → presign 변환 필요)"
                                          : "영상 URL이 올바르지 않습니다."}
                                      <div className="cb-creator-video-subline">
                                        원본: <span className="cb-creator-muted">{rawVideoUrl}</span>
                                      </div>
                                    </div>
                                  )
                                ) : (
                                  <div className="cb-creator-video-placeholder">
                                    {!selectedIsScriptApproved
                                      ? "1차 승인 후 영상 생성이 가능합니다."
                                      : "아직 생성된 영상이 없습니다. 영상 생성 버튼을 실행하세요."}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Validation issues */}
                        {!selectedValidation.ok &&
                          (selectedStatusText === "DRAFT" ||
                            selectedStatusText === "SCRIPT_READY" ||
                            selectedStatusText === "READY") && (
                            <div className="cb-reviewer-detail-card">
                              <div className="cb-reviewer-detail-card-title">
                                {selectedIsScriptApproved
                                  ? "최종(2차) 검토 요청 전 체크"
                                  : "1차(스크립트) 검토 요청 전 체크"}
                              </div>
                              <div className="cb-reviewer-detail-card-desc">
                                아래 항목을 충족해야 검토 요청을 보낼 수 있습니다.
                              </div>
                              <ul className="cb-creator-validation-list">
                                {(selectedValidation.issues as unknown[]).map((it, idx) => (
                                  <li key={idx}>{typeof it === "string" ? it : String(it)}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                      </div>
                    </div>

                    {/* Bottom action bar */}
                    <div className="cb-creator-actionbar">
                      <div className="cb-creator-actionbar-hint">
                        {selectedStatusText === "SCRIPT_REVIEW_REQUESTED"
                          ? "1차(스크립트) 검토 중입니다. 검토자는 스크립트를 확인 후 1차 승인/반려를 처리합니다."
                          : selectedStatusText === "FINAL_REVIEW_REQUESTED"
                            ? "2차(최종) 검토 중입니다. 검토자는 스크립트/영상을 확인 후 최종 승인/반려를 처리합니다."
                            : selectedStatusText === "PUBLISHED" || selectedStatusText === "APPROVED"
                              ? "최종 승인 완료 상태입니다. 교육 페이지에 게시(노출)됩니다."
                              : isRejectedByHistory(selectedItem)
                                ? "반려되었습니다. ‘새 버전으로 편집’ 후 수정/재생성하고 다시 검토 요청을 제출하세요."
                                : !hasSourceFile
                                  ? "자료 업로드 후 스크립트를 생성하고 1차(스크립트) 검토 요청을 제출하세요."
                                  : !selectedIsScriptApproved
                                    ? "스크립트를 생성/수정한 뒤 1차(스크립트) 검토 요청을 제출하세요."
                                    : !hasVideo
                                      ? "1차 승인 완료. 먼저 영상 생성 후 최종(2차) 검토 요청을 제출하세요."
                                      : "영상까지 확인한 뒤 최종(2차) 검토 요청을 제출하세요."}
                      </div>

                      <div className="cb-creator-actionbar-actions">
                        {isRejectedByHistory(selectedItem) ? (
                          <button
                            className="cb-admin-primary-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={reopenRejectedToDraft}
                            type="button"
                          >
                            새 버전으로 편집
                          </button>
                        ) : selectedStatusText === "PUBLISHED" || selectedStatusText === "APPROVED" ? (
                          <button className="cb-admin-primary-btn" type="button" disabled>
                            게시됨
                          </button>
                        ) : selectedStatusText === "SCRIPT_REVIEW_REQUESTED" ? (
                          <button className="cb-admin-primary-btn" type="button" disabled>
                            검토 중(1차)
                          </button>
                        ) : selectedStatusText === "FINAL_REVIEW_REQUESTED" ? (
                          <button className="cb-admin-primary-btn" type="button" disabled>
                            최종 검토중
                          </button>
                        ) : (selectedStatusText === "FAILED" || selectedStatusText === "ERROR") ? (
                          <button
                            className="cb-admin-primary-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={retryPipelineForSelected}
                            type="button"
                          >
                            재시도
                          </button>
                        ) : selectedIsScriptApproved && !hasVideo ? (
                          <button
                            className="cb-admin-primary-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={runVideoOnlyForSelected}
                            disabled={!canGenerateVideo}
                            type="button"
                          >
                            {videoGenLabel}
                          </button>
                        ) : (
                          <button
                            className="cb-admin-primary-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={requestReviewForSelected}
                            disabled={
                              !selectedValidation.ok ||
                              scriptSceneDirty ||
                              isPipelineRunning ||
                              // 문서 정책: REVIEW_REQUESTED/PUBLISHED에서는 요청 불가
                              selectedStatusText === "SCRIPT_REVIEW_REQUESTED" ||
                              selectedStatusText === "FINAL_REVIEW_REQUESTED" ||
                              selectedStatusText === "PUBLISHED" ||
                              selectedStatusText === "APPROVED"
                            }
                            type="button"
                          >
                            {selectedIsScriptApproved ? "최종 검토 요청(2차)" : "스크립트 검토 요청(1차)"}
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {toast && (
            <div className={cx("cb-creator-toast", `cb-creator-toast--${toast.kind}`)} role="status" aria-live="polite">
              {toast.message}
            </div>
          )}
        </div>
      </div>

      {eduPickerOpen &&
        createPortal(
          <div
            className="cb-creator-edu-modal-overlay"
            onMouseDown={() => setEduPickerOpen(false)}
            role="presentation"
          >
            <div
              className="cb-creator-edu-modal"
              role="dialog"
              aria-label="교육 선택"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="cb-creator-edu-modal__head">
                <div className="cb-creator-edu-modal__head-left">
                  <div className="cb-creator-edu-modal__badge">EDUCATION</div>
                  <div className="cb-creator-edu-modal__title">교육 선택</div>
                  <div className="cb-creator-edu-modal__desc">
                    교육을 선택하면 해당 교육을 기반으로 초안이 생성됩니다.
                  </div>
                </div>

                <button
                  type="button"
                  className="cb-creator-edu-modal__close"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setEduPickerOpen(false)}
                  aria-label="닫기"
                >
                  ×
                </button>
              </div>

              <div className="cb-creator-edu-modal__body">
                <div className="cb-creator-edu-modal__search">
                  <input
                    className="cb-admin-input cb-creator-edu-modal__search-input"
                    placeholder="교육명/대상부서/기간 검색"
                    value={eduPickerQuery}
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => setEduPickerQuery(e.target.value)}
                  />

                  <button
                    type="button"
                    className="cb-admin-ghost-btn cb-creator-edu-modal__reload"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={loadEducationsOnce}
                    disabled={eduLoading}
                  >
                    새로고침
                  </button>
                </div>

                {eduError ? <div className="cb-creator-edu-modal__error">{eduError}</div> : null}

                <div className="cb-creator-edu-modal__list" role="listbox" aria-label="교육 목록">
                  {eduLoading ? (
                    <div className="cb-creator-edu-modal__empty">불러오는 중…</div>
                  ) : filteredEducations.length === 0 ? (
                    <div className="cb-creator-edu-modal__empty">검색 결과가 없습니다.</div>
                  ) : (
                    filteredEducations.map((e) => {
                      const selected = e.id === eduSelectedId;
                      const period = formatIsoRange(e.startAt, e.endAt);
                      const deptText = Array.isArray(e.departmentScope) && e.departmentScope.length > 0
                        ? e.departmentScope.join(", ")
                        : "전사";

                      return (
                        <button
                          key={e.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={cx("cb-creator-edu-row", selected && "cb-creator-edu-row--selected")}
                          onMouseDown={(ev) => ev.stopPropagation()}
                          onClick={() => setEduSelectedId(e.id)}
                        >
                          <div className="cb-creator-edu-row__title">{e.title}</div>
                          <div className="cb-creator-edu-row__meta">
                            <span className="cb-creator-edu-row__dept">{deptText}</span>
                            <span className="cb-creator-edu-row__dot">·</span>
                            <span className="cb-creator-edu-row__period">{period}</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="cb-creator-edu-modal__actions">
                  <button
                    type="button"
                    className="cb-admin-ghost-btn"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setEduPickerOpen(false)}
                  >
                    취소
                  </button>

                  <button
                    type="button"
                    className="cb-admin-primary-btn"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={confirmEducationAndCreateDraft}
                    disabled={!eduSelectedId || eduLoading}
                  >
                    선택한 교육으로 초안 생성
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      <ProjectFilesModal
        open={filesModalOpen}
        title="문서 업로드"
        accept={SOURCE_ACCEPT}
        files={creatorFiles}
        disabled={disableMeta}
        onClose={() => {
          setFilesModalOpen(false);

          if (jumpToPipelineOnClose) {
            setJumpToPipelineOnClose(false);
            requestAnimationFrame(() => {
              pipelineCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          }
        }}
        onAddFiles={(fs) => {
          if (disableMeta || !selectedItem) return;

          safeAwait(async () => {
            await Promise.resolve(addSourceFilesToSelected(fs));
            setJumpToPipelineOnClose(true);
            showToast("info", "파일 업로드 완료 · 닫으면 자동 생성(스크립트/영상) 섹션으로 이동합니다.");
          }).catch(() => {
            showToast("error", "파일 업로드에 실패했습니다.");
          });
        }}
        onRemoveFile={(id) => {
          if (disableMeta || !selectedItem) return;

          safeAwait(async () => {
            await Promise.resolve(removeSourceFileFromSelected(id));
            showToast("info", "파일이 삭제되었습니다.");
          }).catch(() => {
            showToast("error", "파일 삭제에 실패했습니다.");
          });
        }}
      />
    </div>
  );
};

export default CreatorStudioView;