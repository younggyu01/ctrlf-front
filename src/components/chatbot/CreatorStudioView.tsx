// src/components/chatbot/CreatorStudioView.tsx

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  computePanelPosition,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";
import { can, type UserRole } from "../../auth/roles";
import {
  categoryLabel,
  deptLabel,
  formatDateTime,
  labelStatus,
  templateLabel,
  jobTrainingLabel,
  isJobCategory, // 직무/4대 판별 + Training UI 조건부
} from "./creatorStudioMocks";
import { useCreatorStudioController } from "./useCreatorStudioController";
import CreatorScriptSceneEditor from "./CreatorScriptSceneEditor";
import type {
  CreatorSortMode,
  CreatorTabId,
  CreatorWorkItem,
  ReviewStage,
} from "./creatorStudioTypes";
import CreatorTrainingSelect from "./CreatorTrainingSelect";
import ProjectFilesModal, { type ProjectFileItem } from "./ProjectFilesModal";

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

function statusToneClass(status: CreatorWorkItem["status"]): string {
  switch (status) {
    case "DRAFT":
    case "GENERATING":
    case "REVIEW_PENDING":
      return "cb-reviewer-pill cb-reviewer-pill--pending";
    case "REJECTED":
      return "cb-reviewer-pill cb-reviewer-pill--rejected";
    case "APPROVED":
      return "cb-reviewer-pill cb-reviewer-pill--approved";
    case "FAILED":
      return "cb-reviewer-pill cb-reviewer-pill--rejected";
    default:
      return "cb-reviewer-pill";
  }
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
 * 단계/승인 필드가 타입에 없을 수도 있어서 안전 접근 유틸
 * (any 금지 유지)
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

/* =========================
   Policy helpers
========================= */

type CreatorStageFilter = "all" | "stage1" | "stage2";

function getScriptApprovedAt(it: CreatorWorkItem): number | null {
  return readOptionalNumber(it, "scriptApprovedAt");
}

function isScriptApproved(it: CreatorWorkItem): boolean {
  return getScriptApprovedAt(it) != null;
}

function inferReviewStage(it: CreatorWorkItem): ReviewStage {
  if (it.reviewStage) return it.reviewStage;
  return isScriptApproved(it) ? "FINAL" : "SCRIPT";
}

function inferRejectedStage(it: CreatorWorkItem): ReviewStage {
  if (it.rejectedStage) return it.rejectedStage;
  if (it.reviewStage) return it.reviewStage;
  return isScriptApproved(it) ? "FINAL" : "SCRIPT";
}

/**
 * 4대 의무교육(전사필수) 여부 (카테고리 기반)
 */
function isCategoryMandatoryFixed(categoryId: string): boolean {
  return !isJobCategory(categoryId);
}

/**
 * 정책상 필수 여부 (4대면 무조건 true)
 */
function getEffectiveMandatoryForItem(it: CreatorWorkItem): boolean {
  return isCategoryMandatoryFixed(it.categoryId) ? true : Boolean(it.isMandatory);
}

/**
 * 정책상 전사 대상 여부
 * - 4대/필수면 무조건 전사
 * - 아니면 targetDeptIds=[] 일 때 전사
 */
function isAllCompanyByPolicy(it: CreatorWorkItem): boolean {
  const effMandatory = getEffectiveMandatoryForItem(it);
  return effMandatory ? true : it.targetDeptIds.length === 0;
}

function matchTab(tab: CreatorTabId, it: CreatorWorkItem): boolean {
  const sa = isScriptApproved(it);

  switch (tab) {
    case "draft":
      return (it.status === "DRAFT" || it.status === "GENERATING") && !sa;

    case "approved":
      return (
        it.status === "APPROVED" ||
        ((it.status === "DRAFT" || it.status === "GENERATING") && sa)
      );

    case "review_pending":
      return it.status === "REVIEW_PENDING";

    case "rejected":
      return it.status === "REJECTED";

    case "failed":
      return it.status === "FAILED";

    default:
      return false;
  }
}

function getStageForTab(tab: CreatorTabId, it: CreatorWorkItem): 1 | 2 | null {
  if (tab === "approved") {
    if (it.status === "APPROVED") return 2;
    if ((it.status === "DRAFT" || it.status === "GENERATING") && isScriptApproved(it)) return 1;
    return null;
  }

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
  const sa = isScriptApproved(it);

  if ((it.status === "DRAFT" || it.status === "GENERATING") && sa) {
    return {
      label: "승인(1차)",
      className: "cb-reviewer-pill cb-reviewer-pill--approved",
    };
  }

  if (it.status === "REVIEW_PENDING") {
    const st = inferReviewStage(it);
    return {
      label: st === "FINAL" ? "검토 대기(2차)" : "검토 대기(1차)",
      className: statusToneClass(it.status),
    };
  }

  if (it.status === "REJECTED") {
    const st = inferRejectedStage(it);
    return {
      label: st === "FINAL" ? "반려(2차)" : "반려(1차)",
      className: statusToneClass(it.status),
    };
  }

  return { label: labelStatus(it.status), className: statusToneClass(it.status) };
}

function normalizeText(s: string): string {
  return s.toLowerCase().trim();
}

function filterByQuery(
  items: CreatorWorkItem[],
  query: string,
  departments: Array<{ id: string; name: string }>,
  templates: Array<{ id: string; name: string }>,
  jobTrainings: Array<{ id: string; name: string }>
) {
  const q = normalizeText(query);
  if (!q) return items;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;

  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
  const templateNameById = new Map(templates.map((t) => [t.id, t.name]));
  const trainingNameById = new Map(jobTrainings.map((t) => [t.id, t.name]));

  return items.filter((it) => {
    const pill = getDisplayStatusPill(it);

    const allCompany = isAllCompanyByPolicy(it);

    const deptText = allCompany
      ? "전사"
      : it.targetDeptIds
        .map((id) => deptNameById.get(id) ?? deptLabel(id))
        .join(" ");

    const templateText = templateNameById.get(it.templateId) ?? templateLabel(it.templateId);

    const trainingText = it.jobTrainingId
      ? trainingNameById.get(it.jobTrainingId) ?? jobTrainingLabel(it.jobTrainingId)
      : "";

    const kindText = isJobCategory(it.categoryId) ? "직무" : "4대 전사필수";

    const effMandatory = getEffectiveMandatoryForItem(it);
    const mandatoryText = effMandatory ? "필수" : "선택";

    const versionText = `v${it.version ?? 1}`;

    const stageHint =
      it.status === "APPROVED"
        ? "2차 최종 승인 게시"
        : (it.status === "DRAFT" || it.status === "GENERATING") && isScriptApproved(it)
          ? "1차 승인 완료 영상 생성"
          : it.status === "REVIEW_PENDING"
            ? inferReviewStage(it) === "FINAL"
              ? "2차 검토"
              : "1차 검토"
            : it.status === "REJECTED"
              ? inferRejectedStage(it) === "FINAL"
                ? "2차 반려"
                : "1차 반려"
              : "";

    const hay = normalizeText(
      [
        it.title,
        it.categoryLabel,
        kindText,
        deptText,
        templateText,
        trainingText,
        mandatoryText,
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

function getEmptyCopy(tab: CreatorTabId, stage: CreatorStageFilter, query: string): { title: string; desc: string } {
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
      desc: "새 교육 만들기를 눌러 제작을 시작할 수 있습니다.",
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
    if (stage === "stage1") {
      return {
        title: "1차 승인 완료 항목이 없습니다",
        desc: "스크립트 1차 승인 완료 후 이곳에서 영상 생성 및 최종(2차) 검토 요청을 진행합니다.",
      };
    }
    if (stage === "stage2") {
      return {
        title: "최종 승인(2차) 완료 항목이 없습니다",
        desc: "최종 승인 완료된 콘텐츠는 교육 페이지에 게시(노출)됩니다.",
      };
    }
    return {
      title: "승인 단계 항목이 없습니다",
      desc: "1차 승인 완료 또는 최종 승인 완료된 콘텐츠가 없습니다.",
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
  status: CreatorWorkItem["status"];
  hasSourceFile: boolean;
  hasScript: boolean;
  hasVideo: boolean;
  isScriptApproved: boolean;
  isPipelineRunning: boolean;
};

function buildCreatorFlowSteps(input: CreatorFlowInput): {
  steps: CreatorFlowStep[];
  activeKey: CreatorFlowStepKey | null;
} {
  const {
    status,
    hasSourceFile,
    hasScript,
    hasVideo,
    isScriptApproved,
    isPipelineRunning,
  } = input;

  const doneUpload = hasSourceFile;
  const doneScript = hasScript;
  const doneReview1 = isScriptApproved;
  const doneVideo = hasVideo;
  const doneReview2 = status === "APPROVED";
  const donePublish = status === "APPROVED";

  const order: CreatorFlowStepKey[] = [
    "upload",
    "script",
    "review1",
    "video",
    "review2",
    "publish",
  ];

  const base: Array<Omit<CreatorFlowStep, "state"> & { done: boolean }> = [
    {
      key: "upload",
      label: "자료 업로드",
      done: doneUpload,
      hint: doneUpload ? "완료" : "파일 업로드 필요",
    },
    {
      key: "script",
      label: "스크립트 생성",
      done: doneScript,
      hint: doneScript ? "완료" : "생성 필요",
    },
    {
      key: "review1",
      label: "1차 승인(스크립트)",
      done: doneReview1,
      hint: doneReview1 ? "승인 완료" : "검토 요청/승인 필요",
    },
    {
      key: "video",
      label: "영상 생성",
      done: doneVideo,
      hint: doneVideo ? "완료" : "생성 필요",
    },
    {
      key: "review2",
      label: "2차 승인(최종)",
      done: doneReview2,
      hint: doneReview2 ? "승인 완료" : "최종 검토/승인 필요",
    },
    {
      key: "publish",
      label: "게시(교육 노출)",
      done: donePublish,
      hint: donePublish ? "노출 중" : "승인 후 자동 게시",
    },
  ];

  let activeKey: CreatorFlowStepKey | null = null;

  if (status === "APPROVED") {
    activeKey = null;
  } else if (status === "REJECTED") {
    activeKey = isScriptApproved ? "review2" : "review1";
  } else if (status === "FAILED") {
    activeKey = isScriptApproved ? "video" : "script";
  } else if (status === "REVIEW_PENDING") {
    activeKey = isScriptApproved ? "review2" : "review1";
  } else if (status === "GENERATING" || isPipelineRunning) {
    activeKey = isScriptApproved ? "video" : "script";
  } else {
    if (!hasSourceFile) activeKey = "upload";
    else if (!hasScript) activeKey = "script";
    else if (!isScriptApproved) activeKey = "review1";
    else if (!hasVideo) activeKey = "video";
    else activeKey = "review2";
  }

  const activeIndex =
    activeKey == null ? -1 : order.findIndex((k) => k === activeKey);

  const steps: CreatorFlowStep[] = base.map((s) => {
    const idx = order.findIndex((k) => k === s.key);

    if (status === "REJECTED" && s.key === activeKey) {
      return {
        key: s.key,
        label: s.label,
        state: "error",
        hint: "반려됨 · 새 버전으로 재작업",
      };
    }
    if (status === "FAILED" && s.key === activeKey) {
      return {
        key: s.key,
        label: s.label,
        state: "error",
        hint: "실패 · 재시도 필요",
      };
    }

    if (s.done) {
      return { key: s.key, label: s.label, state: "done", hint: s.hint };
    }

    if (activeKey != null && s.key === activeKey) {
      let hint = s.hint;

      if (status === "REVIEW_PENDING") {
        hint = isScriptApproved ? "검토 중(2차)" : "검토 중(1차)";
      } else if (status === "GENERATING" || isPipelineRunning) {
        hint = isScriptApproved ? "생성 중(영상)" : "생성 중(스크립트)";
      } else if (s.key === "review1") {
        hint = "검토 요청 필요(1차)";
      } else if (s.key === "review2") {
        hint = "검토 요청 필요(2차)";
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
        steps[i] = {
          ...steps[i],
          state: "locked",
          hint: "1차 승인 후 가능",
        };
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

const CreatorFlowStepper: React.FC<{
  steps: CreatorFlowStep[];
  metaText?: string;
}> = ({ steps, metaText }) => {
  return (
    <div className="cb-creator-stepper-wrap" aria-label="제작 단계">
      <div className="cb-creator-stepper-head">
        <div className="cb-creator-stepper-title">진행 단계</div>
        {metaText ? (
          <div className="cb-creator-stepper-meta">{metaText}</div>
        ) : null}
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
            <span className="cb-creator-step-badge" aria-hidden="true">
              {StepBadgeText(s, idx)}
            </span>
            <span className="cb-creator-step-main">
              <span className="cb-creator-step-label">{s.label}</span>
              {s.hint ? (
                <span className="cb-creator-step-hint">{s.hint}</span>
              ) : null}
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
  const assets = selected.assets as unknown as {
    sourceFiles?: Array<{ id: string; name: string; size: number }>;
  };
  return Array.isArray(assets?.sourceFiles) ? assets.sourceFiles : [];
}

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

  const controller = useCreatorStudioController({
    creatorName: creatorName ?? "VIDEO_CREATOR",
    allowedDeptIds,
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

    filteredItems, // fallback
    selectedItem,
    selectItem,
    createDraft,
    updateSelectedMeta,

    addSourceFilesToSelected,
    removeSourceFileFromSelected,

    runPipelineForSelected,
    runVideoOnlyForSelected,
    retryPipelineForSelected,
    updateSelectedScript,
    showToast,
    requestReviewForSelected,
    reopenRejectedToDraft,
    deleteDraft,
    selectedValidation,
    toast,
  } = controller;

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

    return src;
  }, [controller, filteredItems]);

  const [creatorStageFilter, setCreatorStageFilter] =
    useState<CreatorStageFilter>("all");

  useEffect(() => {
    setCreatorStageFilter("all");
  }, [tab]);

  const tabMatchedItems = useMemo(() => {
    return rawItems.filter((it) => matchTab(tab, it));
  }, [rawItems, tab]);

  const searchedItems = useMemo(() => {
    return filterByQuery(tabMatchedItems, query, departments, templates, jobTrainings);
  }, [tabMatchedItems, query, departments, templates, jobTrainings]);

  const sortedItems = useMemo(() => {
    return sortItems(searchedItems, sortMode);
  }, [searchedItems, sortMode]);

  const creatorStageCounts = useMemo(() => {
    if (tab === "draft" || tab === "failed") {
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
    if (tab === "draft" || tab === "failed") return sortedItems;
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

  const isDeptCreator = creatorType === "DEPT_CREATOR";

  const initialSizeRef = useRef<Size>(fitSizeToViewport(INITIAL_SIZE));
  const [size, setSize] = useState<Size>(initialSizeRef.current);

  const sizeRef = useRef<Size>(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const [panelPos, setPanelPos] = useState(() => {
    const pos = computePanelPosition(anchor ?? null, initialSizeRef.current);
    const b = getBounds(
      initialSizeRef.current.width,
      initialSizeRef.current.height
    );
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

  useEffect(() => {
    const currentSize = fitSizeToViewport(sizeRef.current);

    if (
      currentSize.width !== sizeRef.current.width ||
      currentSize.height !== sizeRef.current.height
    ) {
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
    if (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      tag === "button" ||
      tag === "label"
    )
      return;

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

  const scriptApprovedAt = selectedItem
    ? readOptionalNumber(selectedItem, "scriptApprovedAt")
    : null;
  const selectedIsScriptApproved = scriptApprovedAt != null;

  const isPipelineRunning =
    Boolean(selectedItem?.pipeline?.state === "RUNNING") ||
    selectedItem?.status === "GENERATING";

  const isHardLocked =
    !selectedItem ||
    selectedItem.status === "REVIEW_PENDING" ||
    selectedItem.status === "APPROVED" ||
    selectedItem.status === "REJECTED" ||
    isPipelineRunning;

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

  // pipeline 안전 접근 (크래시 방지)
  const pipelineState = selectedItem?.pipeline?.state ?? "IDLE";
  const pipelineProgress = selectedItem?.pipeline?.progress ?? 0;
  const pipelineMessage = selectedItem?.pipeline?.message ?? "";

  const progressScale = clamp(pipelineProgress / 100, 0, 1);
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

  const videoUrl = selectedItem?.assets?.videoUrl ?? "";
  const isMockVideo = videoUrl.startsWith("mock://");
  const canRenderVideoPlayer = videoUrl.length > 0 && !isMockVideo;

  const isJob = selectedItem ? isJobCategory(selectedItem.categoryId) : false;
  const mandatoryByCategory = selectedItem ? !isJobCategory(selectedItem.categoryId) : false;

  const effectiveMandatory = selectedItem
    ? mandatoryByCategory
      ? true
      : Boolean(selectedItem.isMandatory)
    : false;

  const isAllCompany = selectedItem
    ? effectiveMandatory
      ? true
      : selectedItem.targetDeptIds.length === 0
    : false;

  const hasScript = (selectedItem?.assets?.script?.trim().length ?? 0) > 0;
  const sourceFilesCount = selectedItem ? readSourceFiles(selectedItem).length : 0;

  const hasSourceFile =
    sourceFilesCount > 0 ||
    (selectedItem?.assets?.sourceFileName ?? "").trim().length > 0;

  const hasVideo = (selectedItem?.assets?.videoUrl ?? "").trim().length > 0;

  const canGenerateScript =
    !!selectedItem &&
    selectedItem.status === "DRAFT" &&
    !isHardLocked &&
    hasSourceFile &&
    !selectedIsScriptApproved;

  const canGenerateVideo =
    !!selectedItem &&
    selectedItem.status === "DRAFT" &&
    !isHardLocked &&
    selectedIsScriptApproved &&
    hasSourceFile &&
    hasScript;

  const scriptGenLabel = hasScript ? "스크립트 재생성" : "스크립트 생성";
  const videoGenLabel = hasVideo ? "영상 재생성" : "영상 생성";

  const pipelineCardRef = useRef<HTMLDivElement | null>(null);

  function phaseHintFor(item: CreatorWorkItem | null) {
    if (!item) return "";

    const sa = isScriptApproved(item);

    if (item.status === "REVIEW_PENDING") {
      return sa ? "2차(최종) 검토 대기" : "1차(스크립트) 검토 대기";
    }
    if (item.status === "APPROVED") return "2차 승인 완료(게시됨)";
    if (item.status === "REJECTED") return "반려됨";
    if (item.status === "FAILED") return "생성 실패";

    if (item.status === "GENERATING") return "생성 중…";

    // 멀티 파일(sourceFiles)까지 포함해서 판정
    const _hasSource =
      readSourceFiles(item).length > 0 ||
      (item.assets?.sourceFileName ?? "").trim().length > 0;

    const _hasScript = (item.assets?.script ?? "").trim().length > 0;
    const _hasVideo = (item.assets?.videoUrl ?? "").trim().length > 0;

    if (!_hasSource) return "자료 업로드 대기";
    if (!_hasScript && !sa) return "스크립트 생성 대기";
    if (!sa) return "1차(스크립트) 검토 요청 가능";
    if (!_hasVideo) return "1차 승인 완료 · 영상 생성 대기";
    return "2차(최종) 검토 요청 가능";
  }

  function listStepText(it: CreatorWorkItem) {
    const sa = isScriptApproved(it);

    if (it.status === "REVIEW_PENDING") {
      const st = inferReviewStage(it);
      return st === "FINAL" ? " · 2차 검토" : " · 1차 검토";
    }
    if (it.status === "REJECTED") {
      const st = inferRejectedStage(it);
      return st === "FINAL" ? " · 2차 반려" : " · 1차 반려";
    }
    if (it.status === "APPROVED") return " · 2차 승인 완료";
    if ((it.status === "DRAFT" || it.status === "GENERATING") && sa) return " · 1차 승인 완료";
    return "";
  }

  const selectedId = selectedItem?.id ?? null;
  const selectedStatus = selectedItem?.status ?? null;

  const flowModel = useMemo(() => {
    if (!selectedId || !selectedStatus) return null;

    return buildCreatorFlowSteps({
      status: selectedStatus,
      hasSourceFile,
      hasScript,
      hasVideo,
      isScriptApproved: selectedIsScriptApproved,
      isPipelineRunning,
    });
  }, [
    selectedId,
    selectedStatus,
    hasSourceFile,
    hasScript,
    hasVideo,
    selectedIsScriptApproved,
    isPipelineRunning,
  ]);

  const flowMetaText = selectedItem
    ? `현재: ${phaseHintFor(selectedItem)}${selectedIsScriptApproved && scriptApprovedAt
      ? ` · 1차 승인 ${formatDateTime(scriptApprovedAt)}`
      : ""
    }`
    : "";

  const emptyCopy = useMemo(() => {
    return getEmptyCopy(tab, creatorStageFilter, query);
  }, [tab, creatorStageFilter, query]);

  const showStagePills = tab !== "draft" && tab !== "failed" && creatorStageCounts.enabled;

  const selectedPill = selectedItem ? getDisplayStatusPill(selectedItem) : null;

  const creatorFiles: ProjectFileItem[] = useMemo(() => {
    if (!selectedItem) return [];
    const src = readSourceFiles(selectedItem);
    return src.map((f, idx) => ({
      id: f.id,
      name: f.name,
      sizeBytes: f.size,
      meta: idx === 0 ? "기본" : undefined,
    }));
  }, [selectedItem]);

  // 삭제 버튼 클릭 가드(1차 승인 이후 삭제 금지)
  const onDeleteDraft = () => {
    if (!selectedItem) return;
    if (selectedIsScriptApproved) {
      showToast("info", "1차 승인 이후에는 삭제할 수 없습니다. 반려 → 새 버전으로 편집 흐름을 사용하세요.");
      return;
    }
    deleteDraft();
  };

  return (
    <div className="cb-creator-wrapper" aria-hidden={false}>
      <div
        className="cb-creator-panel-container"
        style={containerStyle}
        onMouseDown={onPanelMouseDown}
      >
        <div
          className={cx("cb-panel", "cb-creator-panel")}
          style={panelStyle}
          tabIndex={0}
          role="dialog"
          aria-label="Creator Studio"
        >
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
          <div
            className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-nw"
            onMouseDown={handleResizeMouseDown("nw")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-ne"
            onMouseDown={handleResizeMouseDown("ne")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-sw"
            onMouseDown={handleResizeMouseDown("sw")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-se"
            onMouseDown={handleResizeMouseDown("se")}
          />

          <div
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-n"
            onMouseDown={handleResizeMouseDown("n")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-s"
            onMouseDown={handleResizeMouseDown("s")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-e"
            onMouseDown={handleResizeMouseDown("e")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-w"
            onMouseDown={handleResizeMouseDown("w")}
          />

          {/* Header */}
          <div className="cb-creator-header" onMouseDown={handleHeaderMouseDown}>
            <div className="cb-creator-header-main">
              <div className="cb-creator-badge">CREATOR STUDIO</div>
              <div className="cb-creator-title">교육 콘텐츠 제작</div>
              <div className="cb-creator-subrow">
                <div className="cb-creator-subtitle">
                  자료 업로드 → <b>스크립트 생성</b> → <b>1차(스크립트) 승인</b> →{" "}
                  <b>영상 생성</b> → <b>2차(최종) 승인</b> → 게시(교육 노출)
                </div>

                <button
                  className="cb-admin-primary-btn cb-creator-create-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={createDraft}
                  type="button"
                >
                  새 교육 만들기
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
                    {(
                      ["draft", "review_pending", "rejected", "approved", "failed"] as CreatorTabId[]
                    ).map((t) => (
                      <button
                        key={t}
                        className={cx(
                          "cb-reviewer-tab",
                          tab === t && "cb-reviewer-tab--active"
                        )}
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
                          className={cx(
                            "cb-reviewer-stage-pill",
                            creatorStageFilter === "all" &&
                            "cb-reviewer-stage-pill--active"
                          )}
                          onClick={() => setCreatorStageFilter("all")}
                        >
                          전체{" "}
                          <span className="cb-reviewer-stage-count">
                            {creatorStageCounts.all}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={cx(
                            "cb-reviewer-stage-pill",
                            creatorStageFilter === "stage1" &&
                            "cb-reviewer-stage-pill--active"
                          )}
                          onClick={() => setCreatorStageFilter("stage1")}
                        >
                          1차{" "}
                          <span className="cb-reviewer-stage-count">
                            {creatorStageCounts.stage1}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={cx(
                            "cb-reviewer-stage-pill",
                            creatorStageFilter === "stage2" &&
                            "cb-reviewer-stage-pill--active"
                          )}
                          onClick={() => setCreatorStageFilter("stage2")}
                        >
                          2차{" "}
                          <span className="cb-reviewer-stage-count">
                            {creatorStageCounts.stage2}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="cb-creator-spacer-10" />

                  <div className="cb-creator-search-row">
                    <input
                      className={cx("cb-admin-input", "cb-creator-search-input")}
                      placeholder="제목/카테고리(직무/4대)/부서/템플릿/Training ID/버전/단계 검색"
                      value={query}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <select
                      className={cx("cb-admin-select", "cb-creator-search-select")}
                      value={sortMode}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        setSortMode(e.target.value as CreatorSortMode)
                      }
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
                      const kindText = isJobCategory(it.categoryId)
                        ? "직무"
                        : "4대(전사필수)";

                      const effMandatory = getEffectiveMandatoryForItem(it);
                      const allCompany = isAllCompanyByPolicy(it);

                      const v = it.version ?? 1;
                      const stepText = listStepText(it);
                      const pill = getDisplayStatusPill(it);

                      const deptText = allCompany
                        ? "전사"
                        : it.targetDeptIds.map(deptLabel).join(", ");

                      return (
                        <button
                          key={it.id}
                          className={cx(
                            "cb-reviewer-item",
                            "cb-creator-item",
                            selectedItem?.id === it.id &&
                            "cb-reviewer-item--active"
                          )}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => selectItem(it.id)}
                          type="button"
                        >
                          <div className="cb-creator-item-top">
                            <div className="cb-creator-item-main">
                              <div className="cb-creator-item-title">
                                {it.title}{" "}
                                <span className="cb-creator-muted">{`v${v}`}</span>
                              </div>
                              <div className="cb-creator-item-sub">
                                {it.categoryLabel} · {kindText} ·{" "}
                                {templateLabel(it.templateId)}
                                {it.jobTrainingId
                                  ? ` · ${jobTrainingLabel(it.jobTrainingId)}`
                                  : ""}
                                {effMandatory ? " · 필수" : ""}
                                {stepText}
                              </div>
                            </div>

                            <span className={pill.className}>{pill.label}</span>
                          </div>

                          <div className="cb-creator-item-bottom">
                            <div className="cb-creator-item-depts">{deptText}</div>
                            <div className="cb-creator-item-date">
                              {formatDateTime(it.updatedAt)}
                            </div>
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
                          {selectedItem.createdByName}
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
                        {(selectedItem.status === "DRAFT" ||
                          selectedItem.status === "FAILED") &&
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
                        {selectedItem.status === "REJECTED" &&
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

                        {selectedItem.status === "FAILED" &&
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
                                value={selectedItem.title}
                                disabled={disableMeta}
                                onMouseDown={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  updateSelectedMeta({ title: e.target.value })
                                }
                              />
                            </label>

                            <label className="cb-creator-field">
                              <div className="cb-creator-field-label">카테고리</div>
                              <select
                                className="cb-admin-select"
                                value={selectedItem.categoryId}
                                disabled={disableMeta}
                                onMouseDown={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const id = e.target.value;
                                  updateSelectedMeta({
                                    categoryId: id,
                                    categoryLabel: categoryLabel(id),
                                  });
                                }}
                              >
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          {/* row B */}
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
                                {templates.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="cb-creator-field">
                              <div className="cb-creator-field-label">
                                직무교육(Training ID)
                              </div>

                              {isJob ? (
                                <CreatorTrainingSelect
                                  value={selectedItem.jobTrainingId ?? ""}
                                  options={jobTrainings}
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

                          {/* row C */}
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
                                      isDeptCreator ||
                                      effectiveMandatory ||
                                      mandatoryByCategory
                                    }
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        updateSelectedMeta({ targetDeptIds: [] });
                                      } else {
                                        const first = departments[0]?.id;
                                        updateSelectedMeta({
                                          targetDeptIds: first ? [first] : [],
                                        });
                                      }
                                    }}
                                  />
                                  전사 대상(전체)
                                </label>

                                {mandatoryByCategory && (
                                  <span className="cb-creator-muted">
                                    4대 의무교육은 전사 대상으로 고정됩니다.
                                  </span>
                                )}

                                {isDeptCreator && (
                                  <span className="cb-creator-muted">
                                    부서 제작자는 전사 대상으로 설정할 수 없습니다.
                                  </span>
                                )}

                                {effectiveMandatory && !mandatoryByCategory && (
                                  <span className="cb-creator-muted">
                                    필수 교육은 전사 대상으로만 지정할 수 있습니다.
                                  </span>
                                )}

                                <div className="cb-creator-spacer-8" />

                                {!effectiveMandatory && !mandatoryByCategory && (
                                  <>
                                    {departments.map((d) => {
                                      const checked =
                                        !isAllCompany &&
                                        selectedItem.targetDeptIds.includes(d.id);
                                      const disabled = disableMeta || isAllCompany;
                                      return (
                                        <label
                                          key={d.id}
                                          className="cb-creator-checkitem"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={disabled}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              const base = isAllCompany
                                                ? []
                                                : selectedItem.targetDeptIds;

                                              const next = e.target.checked
                                                ? Array.from(new Set([...base, d.id]))
                                                : base.filter((x) => x !== d.id);

                                              updateSelectedMeta({ targetDeptIds: next });
                                            }}
                                          />
                                          {d.name}
                                        </label>
                                      );
                                    })}

                                    {isAllCompany && (
                                      <span className="cb-creator-muted">
                                        전사 대상을 선택하면 개별 부서 선택이 비활성화됩니다.
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </label>

                            <label className="cb-creator-field">
                              <div className="cb-creator-field-label">필수 여부</div>

                              {mandatoryByCategory ? (
                                <div className="cb-creator-inline-box">
                                  <span className="cb-creator-inline-text">
                                    4대 의무교육은 <b>전사 필수</b>로 고정됩니다.
                                  </span>
                                </div>
                              ) : (
                                <div className="cb-creator-inline-box">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(selectedItem.isMandatory)}
                                    disabled={disableMeta || isDeptCreator}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      updateSelectedMeta({
                                        isMandatory: e.target.checked,
                                      })
                                    }
                                  />
                                  <span className="cb-creator-inline-text">
                                    {isDeptCreator
                                      ? "부서 제작자는 지정 불가"
                                      : selectedItem.isMandatory
                                        ? "필수"
                                        : "선택"}
                                  </span>
                                </div>
                              )}
                            </label>
                          </div>

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
                            <b>1차:</b> 자료 업로드 후 스크립트를 먼저 생성하고 스크립트만
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
                                const src = readSourceFiles(selectedItem);
                                if (src.length > 0) {
                                  const first = src[0];
                                  const extra = src.length > 1 ? ` 외 ${src.length - 1}개` : "";
                                  return (
                                    <>
                                      업로드됨: {first.name}
                                      {extra ? <span className="cb-creator-muted">{extra}</span> : null}
                                      {typeof first.size === "number" && first.size > 0 ? (
                                        <span className="cb-creator-muted">{` (${formatBytes(first.size)})`}</span>
                                      ) : null}
                                    </>
                                  );
                                }

                                return selectedItem.assets.sourceFileName ? (
                                  <>
                                    업로드됨: {selectedItem.assets.sourceFileName}
                                    {selectedItem.assets.sourceFileSize ? (
                                      <span className="cb-creator-muted">
                                        {` (${formatBytes(
                                          selectedItem.assets.sourceFileSize
                                        )})`}
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
                                {pipelineState === "RUNNING"
                                  ? pipelineMessage || "진행 중"
                                  : phaseHintFor(selectedItem)}
                              </div>

                              <div className="cb-creator-pipeline-status-desc">
                                {pipelineState !== "IDLE" && pipelineProgress > 0
                                  ? `진행률 ${pipelineProgress}%`
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
                              {selectedItem.status === "FAILED" ? (
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
                                    scriptId={selectedItem.id}
                                    videoId={selectedItem.id}
                                    scriptText={selectedItem.assets.script ?? ""}
                                    disabled={disableMeta}
                                    showToast={showToast}
                                    onCommitScriptText={(next) => updateSelectedScript(next, { silent: true })}
                                    onDirtyChange={(dirty) => setScriptSceneDirty(dirty)}
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
                                {videoUrl ? (
                                  canRenderVideoPlayer ? (
                                    <video
                                      className="cb-creator-video-player"
                                      src={videoUrl}
                                      controls
                                      preload="metadata"
                                      playsInline
                                    />
                                  ) : (
                                    <div className="cb-creator-video-placeholder">
                                      (mock) video: {videoUrl}
                                      <div className="cb-creator-video-subline">
                                        실제 연동 시 HTML5 video player가 재생됩니다.
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
                        {!selectedValidation.ok && selectedItem.status === "DRAFT" && (
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
                              {selectedValidation.issues.map((it, idx) => (
                                <li key={idx}>{it}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom action bar */}
                    <div className="cb-creator-actionbar">
                      <div className="cb-creator-actionbar-hint">
                        {selectedItem.status === "REVIEW_PENDING"
                          ? selectedIsScriptApproved
                            ? "2차(최종) 검토 대기 중입니다. 검토자는 스크립트/영상을 확인 후 최종 승인/반려를 처리합니다."
                            : "1차(스크립트) 검토 대기 중입니다. 검토자는 스크립트를 확인 후 1차 승인/반려를 처리합니다."
                          : selectedItem.status === "APPROVED"
                            ? "최종(2차) 승인 완료 상태입니다. 교육 페이지에 게시(노출)됩니다."
                            : selectedItem.status === "REJECTED"
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
                        {selectedItem.status === "REJECTED" ? (
                          <button
                            className="cb-admin-primary-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={reopenRejectedToDraft}
                            type="button"
                          >
                            새 버전으로 편집
                          </button>
                        ) : selectedItem.status === "APPROVED" ? (
                          <button className="cb-admin-primary-btn" type="button" disabled>
                            승인 완료
                          </button>
                        ) : selectedItem.status === "REVIEW_PENDING" ? (
                          <button className="cb-admin-primary-btn" type="button" disabled>
                            {selectedIsScriptApproved ? "검토 중(2차)" : "검토 중(1차)"}
                          </button>
                        ) : selectedItem.status === "FAILED" ? (
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
                              selectedItem.status !== "DRAFT" ||
                              scriptSceneDirty ||
                              isPipelineRunning
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
            <div
              className={cx("cb-creator-toast", `cb-creator-toast--${toast.kind}`)}
              role="status"
              aria-live="polite"
            >
              {toast.message}
            </div>
          )}
        </div>
      </div>

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
            // 상세 스크롤 컨테이너 기준으로 자연스럽게 이동
            requestAnimationFrame(() => {
              pipelineCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          }
        }}
        onAddFiles={(fs) => {
          if (disableMeta || !selectedItem) return;
          try {
            addSourceFilesToSelected(fs);

            // 업로드 후에도 모달은 유지
            setJumpToPipelineOnClose(true);

            showToast(
              "info",
              "파일 업로드 완료 · 닫으면 자동 생성(스크립트/영상) 섹션으로 이동합니다."
            );
          } catch {
            showToast("error", "파일 업로드에 실패했습니다.");
          }
        }}
        onRemoveFile={(id) => {
          if (disableMeta || !selectedItem) return;
          try {
            removeSourceFileFromSelected(id);
            showToast("info", "파일이 삭제되었습니다.");
          } catch {
            showToast("error", "파일 삭제에 실패했습니다.");
          }
        }}
      />
    </div>
  );
};

export default CreatorStudioView;
