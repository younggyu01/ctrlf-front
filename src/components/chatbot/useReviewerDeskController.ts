// src/components/chatbot/useReviewerDeskController.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "./creatorStudioUtils";
import type {
  AuditAction,
  ContentCategory,
  PiiRiskLevel,
  ReviewStatus,
  ReviewWorkItem,
  WorkItemLock,
} from "./reviewerDeskTypes";

import { getReviewerApi, type ReviewerApi } from "./reviewerApi";
import { isReviewerApiError } from "./reviewerApiErrors";
import type { ConflictPayload } from "./reviewerApiTypes";

export type ReviewerTabId = "pending" | "approved" | "rejected" | "my";
export type DetailTabId = "preview" | "script" | "checks" | "audit";
export type SortMode = "newest" | "risk";
export type ListMode = "paged" | "virtual";

export type ReviewStageFilter = "all" | "stage1" | "stage2" | "docs";
type StageCounts = { all: number; stage1: number; stage2: number; docs: number };

export function getReviewStage(it: ReviewWorkItem): 1 | 2 | null {
  if (it.contentType !== "VIDEO") return null; // 문서/정책 등
  
  // reviewStage 필드를 우선 확인 (백엔드에서 명시적으로 설정한 값 사용)
  if (it.reviewStage === "FINAL") return 2;
  if (it.reviewStage === "SCRIPT") return 1;
  
  // reviewStage가 없으면 videoUrl로 판단 (하위 호환성)
  return it.videoUrl?.trim() ? 2 : 1; // VIDEO: videoUrl 있으면 2차(최종)
}

export type ToastState =
  | { open: false }
  | { open: true; tone: "neutral" | "warn" | "danger"; message: string };

export type DecisionModalState =
  | { open: false; kind: null }
  | { open: true; kind: "approve"; message: string }
  | { open: true; kind: "reject"; reason: string; error?: string };

type BusyState =
  | { busy: false }
  | { busy: true; itemId: string; kind: "approve" | "reject"; startedAt: string };

type GuardTone = "neutral" | "warn" | "danger";
type GuardPill = { tone: GuardTone; label: string; detail?: string };
type GuardRow = { allowed: boolean; pills: GuardPill[] };

export type ActionGuardInfo = {
  headline: string;
  approve: GuardRow;
  reject: GuardRow;
};

export interface UseReviewerDeskControllerOptions {
  reviewerName?: string;
}

function statusLabel(s: ReviewStatus) {
  switch (s) {
    case "REVIEW_PENDING":
      return "검토 대기";
    case "APPROVED":
      return "승인됨";
    case "REJECTED":
      return "반려됨";
  }
}

function statusTone(s: ReviewStatus): "neutral" | "warn" | "danger" {
  switch (s) {
    case "REVIEW_PENDING":
      return "warn";
    case "APPROVED":
      return "neutral";
    case "REJECTED":
      return "danger";
  }
}

function categoryLabel(c: ContentCategory) {
  switch (c) {
    case "MANDATORY":
      return "4대 의무교육";
    case "JOB":
      return "직무교육";
    case "POLICY":
      return "사규/정책";
    case "OTHER":
      return "기타";
  }
}

function piiTone(level: PiiRiskLevel): "neutral" | "warn" | "danger" {
  if (level === "high") return "danger";
  if (level === "medium") return "warn";
  return "neutral";
}

type WorkItemLockView = WorkItemLock & {
  ownerId?: string;
  ownerName?: string;
};

// 내부 상태에서는 lock을 확장 형태로 관리
type ReviewWorkItemExt = Omit<ReviewWorkItem, "lock"> & {
  lock?: WorkItemLockView;
  rejectReason?: string;
  updatedAt?: string;
};

type LockState =
  | { kind: "idle" }
  | { kind: "locking"; itemId: string }
  | {
      kind: "locked";
      itemId: string;
      lockToken: string;
      expiresAt?: string;
      ownerName?: string;
    }
  | { kind: "blocked"; itemId: string; ownerName?: string; expiresAt?: string };

function formatConflictToast(payload?: ConflictPayload) {
  const code = payload?.code;
  if (code === "LOCK_CONFLICT")
    return {
      tone: "warn" as const,
      message: "다른 검토자가 먼저 처리 중입니다. 잠시 후 다시 시도하세요.",
    };
  if (code === "VERSION_CONFLICT")
    return {
      tone: "warn" as const,
      message: "다른 사용자에 의해 변경되었습니다. 최신 상태로 갱신합니다.",
    };
  if (code === "ALREADY_PROCESSED")
    return {
      tone: "warn" as const,
      message: "이미 처리된 항목입니다. 최신 상태를 확인하세요.",
    };
  return {
    tone: "warn" as const,
    message: "동시성 충돌이 발생했습니다. 최신 상태로 갱신합니다.",
  };
}

/**
 * 승인/반려 실패 원인을 토스트에 노출하기 위한 메시지 추출기
 * - http 모드(백엔드)에서 401/404/500 등의 원인을 빠르게 확인
 * - mock 모드에서 LOCK_TOKEN/버전 불일치 등 디버깅
 */
function extractApiErrorMessage(err: unknown): string | null {
  if (isReviewerApiError(err)) {
    const status = (err as { status?: unknown }).status;
    const statusNum = typeof status === "number" ? status : undefined;

    const details = err.details as unknown;
    const detailsObj =
      details && typeof details === "object" ? (details as Record<string, unknown>) : undefined;

    const code = typeof detailsObj?.code === "string" ? detailsObj.code : null;

    const detailsMessage = typeof detailsObj?.message === "string" ? detailsObj.message : null;

    const errMessage =
      err && typeof err === "object" && "message" in err
        ? (() => {
            const m = (err as unknown as Record<string, unknown>).message;
            return typeof m === "string" ? m : null;
          })()
        : null;

    const msg = detailsMessage ?? errMessage;

    if (msg && code && typeof statusNum === "number") return `${msg} (${code}, ${statusNum})`;
    if (msg && typeof statusNum === "number") return `${msg} (${statusNum})`;
    if (msg && code) return `${msg} (${code})`;
    if (msg) return msg;
    if (code && typeof statusNum === "number") return `요청 실패 (${code}, ${statusNum})`;
    if (code) return `요청 실패 (${code})`;
    if (typeof statusNum === "number") return `요청 실패 (${statusNum})`;
    return "요청 실패";
  }

  if (err instanceof Error && err.message) return err.message;

  if (err && typeof err === "object" && "message" in err) {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === "string" && m.trim()) return m.trim();
  }

  return null;
}

/**
 * P1 표준: http 상태코드 기반의 “짧고 일관된” 토스트 메시지
 * - TS18048 방지: status가 undefined일 수 있으므로 number 체크 후 비교/범위 연산
 */
function toStdHttpErrorMessage(
  kindLabel: string,
  err: unknown
): { tone: "warn" | "danger"; message: string } {
  if (isReviewerApiError(err)) {
    const rawStatus = (err as { status?: unknown }).status;
    const s = typeof rawStatus === "number" ? rawStatus : undefined;

    if (s === 403) return { tone: "danger", message: `${kindLabel} 실패: 권한이 없습니다. (403)` };
    if (s === 404) return { tone: "danger", message: `${kindLabel} 실패: 대상을 찾을 수 없습니다. (404)` };
    if (s === 409)
      return {
        tone: "warn",
        message: `${kindLabel} 실패: 상태가 변경되었습니다. 새로고침 후 다시 시도하세요. (409)`,
      };
    if (typeof s === "number" && s >= 500)
      return {
        tone: "danger",
        message: `${kindLabel} 실패: 서버 오류가 발생했습니다. 잠시 후 다시 시도하세요. (500)`,
      };

    // status가 없거나(undefined) 위 케이스에 안 걸리는 경우도 표준 메시지 유지
    return {
      tone: "danger",
      message: `${kindLabel} 실패: 요청에 실패했습니다.${typeof s === "number" ? ` (${s})` : ""}`,
    };
  }

  const m = extractApiErrorMessage(err);
  return {
    tone: "danger",
    message: m ? `${kindLabel} 실패: ${m}` : `${kindLabel} 실패: 알 수 없는 오류`,
  };
}


function isPolicyDocItem(it: ReviewWorkItem) {
  return it.contentType === "POLICY_DOC" || it.contentCategory === "POLICY";
}

function readPolicyMeta(it: ReviewWorkItem): { documentId: string; versionLabel: string } {
  const any = it as unknown as Record<string, unknown>;

  const documentId =
    (typeof any.contentId === "string" && any.contentId.trim()) ||
    (typeof any.policyDocId === "string" && any.policyDocId.trim()) ||
    "";

  const versionLabel = (typeof any.contentVersionLabel === "string" && any.contentVersionLabel.trim()) || "";

  return { documentId, versionLabel };
}


export function useReviewerDeskController(options: UseReviewerDeskControllerOptions) {
  const effectiveReviewerName = options.reviewerName ?? "Reviewer";

  // ===== toast 표준화 =====
  const TOAST_MS = 2200;

  const [toast, setToast] = useState<ToastState>({ open: false });
  const toastTimerRef = useRef<number | null>(null);

  const closeToast = useCallback(() => {
    setToast({ open: false });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const pushToast = useCallback(
    (tone: "neutral" | "warn" | "danger", message: string) => {
      const msg = String(message ?? "").replace(/\s+/g, " ").trim();
      if (!msg) return;

      setToast({ open: true, tone, message: msg });

      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      toastTimerRef.current = window.setTimeout(() => {
        setToast({ open: false });
        toastTimerRef.current = null;
      }, TOAST_MS);
    },
    [TOAST_MS]
  );

  const toastStd = useMemo(() => {
    return {
      ok: (message: string) => pushToast("neutral", message),
      warn: (message: string) => pushToast("warn", message),
      err: (message: string) => pushToast("danger", message),
      conflict: (payload?: ConflictPayload) => {
        const t = formatConflictToast(payload);
        pushToast(t.tone, t.message);
      },
    } as const;
  }, [pushToast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  // Reviewer API 인스턴스
  const apiRef = useRef<ReviewerApi | null>(null);
  if (!apiRef.current) {
    apiRef.current = getReviewerApi();
  }

  // http 모드: 최초 refresh로 세팅
  const [items, setItems] = useState<ReviewWorkItemExt[]>([]);

  // 탭/필터/정렬
  const [activeTab, setActiveTab] = useState<ReviewerTabId>("pending");
  const [detailTab, setDetailTab] = useState<DetailTabId>("preview");
  const [query, setQuery] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [riskOnly, setRiskOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [stageFilter, setStageFilter] = useState<ReviewStageFilter>("all");

  useEffect(() => {
    if (activeTab === "pending" && onlyMine) setOnlyMine(false);
  }, [activeTab, onlyMine]);

  // 리스트 모드(페이지/가상스크롤)
  const [listMode, setListMode] = useState<ListMode>("paged");
  const [pageSize, setPageSize] = useState<number>(30);
  const [pageIndex, setPageIndex] = useState<number>(0);
  
  // pageSize 변경 시 pageIndex를 적절히 조정하기 위한 ref
  const prevPageSizeRef = useRef<number>(pageSize);
  const pageIndexRef = useRef<number>(pageIndex);
  
  // pageIndex ref 동기화
  useEffect(() => {
    pageIndexRef.current = pageIndex;
  }, [pageIndex]);

  // 선택
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // notes
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  // overlays
  const [decisionModal, setDecisionModal] = useState<DecisionModalState>({
    open: false,
    kind: null,
  });
  const [previewOpen, setPreviewOpen] = useState(false);

  // busy
  const [busy, setBusy] = useState<BusyState>({ busy: false });

  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(new Date().toISOString());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // decision optimistic-lock context (+ lockToken)
  const decisionCtxRef = useRef<{ itemId: string; version: number; lockToken: string } | null>(null);

  // lock state
  const [lockState, setLockState] = useState<LockState>({ kind: "idle" });
  const decisionLockRef = useRef<{ itemId: string; lockToken: string } | null>(null);
  const lockReqSeqRef = useRef(0);

  const isBusy = busy.busy;
  const isOverlayOpen = decisionModal.open || previewOpen;

  // busy/refreshing 최신값을 callback 내부에서 안정적으로 읽기 위한 ref
  const isBusyRef = useRef(isBusy);
  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  const isRefreshingRef = useRef(isRefreshing);
  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  // busy timer label
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!busy.busy) return;
    setNowTs(Date.now());
    const id = window.setInterval(() => setNowTs(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [busy.busy]);

  const busyText = useMemo(() => {
    if (!busy.busy) return null;
    const elapsedMs = Math.max(0, nowTs - new Date(busy.startedAt).getTime());
    const sec = Math.round(elapsedMs / 100) / 10;
    const kind = busy.kind === "approve" ? "승인" : "반려";
    return `${kind} 처리 중 · ${sec.toFixed(1)}s`;
  }, [busy, nowTs]);

  const lastRefreshedAtLabel = useMemo(() => formatDateTime(lastRefreshedAt), [lastRefreshedAt]);

  const isRiskItem = useCallback((it: ReviewWorkItem) => {
    const pii = it.autoCheck.piiRiskLevel;
    const banned = it.autoCheck.bannedWords?.length ?? 0;
    const qwarn = it.autoCheck.qualityWarnings?.length ?? 0;
    return pii === "high" || pii === "medium" || banned > 0 || qwarn > 0;
  }, []);

  useEffect(() => {
    return () => {
      // 언마운트 시 남은 락 해제(상태 업데이트는 의미 없으니 API만 best-effort)
      const cur = decisionLockRef.current;
      if (cur) {
        void apiRef.current?.releaseLock(cur.itemId, cur.lockToken).catch(() => {});
        decisionLockRef.current = null;
      }
      decisionCtxRef.current = null;
      lockReqSeqRef.current += 1;
    };
  }, []);

  // ===== patch helpers =====
  const patchItemInState = (next: ReviewWorkItemExt) => {
    setItems((prev) => {
      let found = false;
      const out = prev.map((it) => {
        if (it.id !== next.id) return it;
        found = true;
        return next;
      });
      if (!found) out.unshift(next);
      return out;
    });
  };

  const patchItemLock = (itemId: string, lock?: WorkItemLockView) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const patched: ReviewWorkItemExt = { ...it, lock };
        return patched;
      })
    );
  };

  // ===== refreshAllFromApi (useCallback + refs로 안정화) =====
  const refreshAllFromApi = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      if (!opts?.force) {
        if (isBusyRef.current) return;
      }
      if (isRefreshingRef.current) return;

      isRefreshingRef.current = true;
      setIsRefreshing(true);

      try {
        const api = apiRef.current;
        if (!api) {
          throw new Error("API 인스턴스가 초기화되지 않았습니다.");
        }
        
        // 백엔드 API 사용: 현재 activeTab과 필터 조건에 맞는 데이터만 조회
        const reviewStageMap: Record<ReviewStageFilter, "first" | "second" | "document" | "all" | undefined> = {
          all: undefined,
          stage1: "first",
          stage2: "second",
          docs: "document",
        };

        // page는 0 이상이어야 함 (0-base)
        // pageIndexRef를 사용하여 최신 값을 참조 (pageSize 변경 시에도 안정적)
        const currentPageIndex = pageIndexRef.current;
        const safePageIndex = Math.max(0, currentPageIndex);
        // size는 1 이상이어야 함
        const safePageSize = Math.max(1, pageSize);

        const params: import("./reviewerApiTypes").ReviewListParams = {
          tab: activeTab === "pending" ? "REVIEW_PENDING" 
            : activeTab === "approved" ? "APPROVED"
            : activeTab === "rejected" ? "REJECTED"
            : "MY_ACTIVITY",
          q: query.trim() || undefined,
          sort: sortMode === "newest" ? "NEWEST" : sortMode === "risk" ? "RISK_HIGH" : "OLDEST",
          myProcessingOnly: onlyMine || undefined,
          reviewStage: reviewStageMap[stageFilter],
          page: safePageIndex,
          size: safePageSize,
        };

        const response = await api.listWorkItems(params);
        
        // 응답이 유효한지 확인
        if (response && Array.isArray(response.items)) {
          setItems(response.items as ReviewWorkItemExt[]);
          
          // totalPages 업데이트 (백엔드에서 받은 값 사용)
          if (response.totalPages !== undefined) {
            setBackendTotalPages(response.totalPages);
          }
          
          // stage counts 업데이트 (백엔드에서 받은 값 사용)
          // 백엔드는 필터와 관계없이 전체 카운트를 제공함
          if (response.firstRoundCount !== undefined || 
              response.secondRoundCount !== undefined || 
              response.documentCount !== undefined) {
            const all = (response.firstRoundCount ?? 0) + 
                       (response.secondRoundCount ?? 0) + 
                       (response.documentCount ?? 0);
            setBackendStageCounts({
              all,
              stage1: response.firstRoundCount ?? 0,
              stage2: response.secondRoundCount ?? 0,
              docs: response.documentCount ?? 0,
            });
          }
        } else {
          // 응답이 유효하지 않으면 빈 배열로 설정
          setItems([]);
          setBackendTotalPages(0);
          setBackendStageCounts(null);
        }

        setLastRefreshedAt(new Date().toISOString());
        if (!opts?.silent) toastStd.ok("새로고침 완료");
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error("[ReviewerDesk] refreshAllFromApi failed", err);
        }
        // 에러 발생 시에도 빈 배열로 설정하여 컴포넌트가 렌더링되도록 함
        setItems([]);
        setBackendTotalPages(0);
        setBackendStageCounts(null);
        if (!opts?.silent) {
          toastStd.err("새로고침에 실패했습니다.");
        }
      } finally {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
      }
    },
    [toastStd, activeTab, query, sortMode, onlyMine, stageFilter, pageSize] // pageIndex는 pageIndexRef로 참조
  );

  // pageSize 변경으로 인한 pageIndex 조정을 추적하는 ref
  const isPageSizeChangingRef = useRef(false);
  // 사용자가 직접 페이지를 변경했는지 추적하는 ref (자동 페이지 이동 방지용)
  const isUserPageChangeRef = useRef(false);
  // stageFilter 변경으로 인한 pageIndex 자동 리셋을 추적하는 ref
  const isStageFilterChangingRef = useRef(false);
  
  // 필터 변경 시 pageIndex를 0으로 리셋하고 API 재조회
  const prevFiltersRef = useRef<{ stageFilter: ReviewStageFilter; activeTab: ReviewerTabId; query: string; sortMode: SortMode; onlyMine: boolean; pageSize: number } | null>(null);
  const isInitialMountRef = useRef(true);
  
  useEffect(() => {
    if (listMode === "virtual") return;
    
    const prev = prevFiltersRef.current;
    const isInitial = isInitialMountRef.current;
    
    // 초기 마운트이거나 필터/페이지 크기가 변경된 경우
    const filtersChanged = isInitial || 
      !prev ||
      prev.stageFilter !== stageFilter ||
      prev.activeTab !== activeTab ||
      prev.query !== query ||
      prev.sortMode !== sortMode ||
      prev.onlyMine !== onlyMine ||
      prev.pageSize !== pageSize;
    
    if (filtersChanged) {
      if (isInitial) {
        isInitialMountRef.current = false;
      }
      prevFiltersRef.current = { stageFilter, activeTab, query, sortMode, onlyMine, pageSize };
      
      // 필터가 변경되면 첫 페이지로 이동하고 API 재조회
      // 단, pageSize 변경만 있는 경우는 pageIndex를 리셋하지 않음 (pageSize 변경 useEffect에서 처리)
      const isPageSizeOnlyChange = prev && 
        prev.stageFilter === stageFilter &&
        prev.activeTab === activeTab &&
        prev.query === query &&
        prev.sortMode === sortMode &&
        prev.onlyMine === onlyMine &&
        prev.pageSize !== pageSize;
      
      if (!isPageSizeOnlyChange) {
        // 필터 변경이 있으면 첫 페이지로 이동
        const currentPageIndex = pageIndexRef.current;
        if (currentPageIndex !== 0) {
          // pageIndex가 0이 아니면 0으로 리셋 (pageIndex 변경 useEffect에서 API 호출)
          isStageFilterChangingRef.current = true; // 플래그 설정
          setPageIndex(0);
        } else {
          // pageIndex가 이미 0이면 직접 API 호출
          void refreshAllFromApi({ silent: true });
        }
      } else {
        // pageSize만 변경된 경우는 pageSize 변경 useEffect에서 처리
        // 여기서는 API 호출하지 않음
      }
    }
  }, [stageFilter, activeTab, query, sortMode, onlyMine, pageSize, listMode, refreshAllFromApi]);
  
  // pageIndex 변경 시 재조회 (pageSize 변경으로 인한 조정은 제외)
  useEffect(() => {
    // pageSize 변경으로 인한 pageIndex 조정인 경우 API 호출 스킵
    if (isPageSizeChangingRef.current) {
      isPageSizeChangingRef.current = false; // 플래그 리셋
      return;
    }
    // stageFilter 변경으로 인한 자동 리셋인 경우 플래그 리셋만 하고 API 호출은 진행
    if (isStageFilterChangingRef.current) {
      isStageFilterChangingRef.current = false; // 플래그 리셋
      // stageFilter 변경으로 인한 리셋이므로 isUserPageChangeRef는 설정하지 않음
      void refreshAllFromApi({ silent: true });
      return;
    }
    // 사용자가 직접 페이지를 변경한 경우 플래그 설정
    isUserPageChangeRef.current = true;
    void refreshAllFromApi({ silent: true });
  }, [refreshAllFromApi, pageIndex]);

  // ===== counts =====
  const [statsCounts, setStatsCounts] = useState<{
    pending: number;
    approved: number;
    rejected: number;
    my: number;
  }>({ pending: 0, approved: 0, rejected: 0, my: 0 });

  // 백엔드 API에서 통계 조회
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !("getReviewStats" in api) || typeof api.getReviewStats !== "function") return;

    void (async () => {
      try {
        const stats = await api.getReviewStats!();
        setStatsCounts({
          pending: stats.pendingCount,
          approved: stats.approvedCount,
          rejected: stats.rejectedCount,
          my: stats.myActivityCount,
        });
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[ReviewerDesk] getReviewStats failed", err);
      }
    })();
  }, [lastRefreshedAt]);

  const counts = useMemo(() => {
    // 백엔드 통계 사용 (통계 조회 실패 시 로컬 계산으로 폴백)
    if (statsCounts.pending > 0 || statsCounts.approved > 0 || statsCounts.rejected > 0 || statsCounts.my > 0) {
      return statsCounts;
    }
    
    // 통계 조회 실패 시 로컬 계산
    const pending = items.filter((i) => i.status === "REVIEW_PENDING").length;
    const approved = items.filter((i) => i.status === "APPROVED").length;
    const rejected = items.filter((i) => i.status === "REJECTED").length;
    const mine = items.filter((i) => i.audit.some((a) => a.actor === effectiveReviewerName)).length;
    return { pending, approved, rejected, my: mine };
  }, [items, effectiveReviewerName, statsCounts]);

  // ===== filtered =====
  // 백엔드 API에서 필터링된 결과를 받아오므로, 로컬 필터링은 최소화
  const filteredBase = useMemo(() => {
    // 백엔드에서 이미 필터링된 items 사용
    // 추가 로컬 필터링은 riskOnly, query만 적용
    let filtered = items;

    if (riskOnly) {
      filtered = filtered.filter((it) => isRiskItem(it));
    }

    const q = query.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((it) => {
        const hay = `${it.title} ${it.department} ${it.creatorName}`.toLowerCase();
        return hay.includes(q);
      });
    }

    // 정렬
    const riskRank = (it: ReviewWorkItem) => {
      const pii = it.autoCheck.piiRiskLevel;
      const piiScore = pii === "high" ? 100 : pii === "medium" ? 60 : pii === "low" ? 20 : 0;
      const banned = (it.autoCheck.bannedWords?.length ?? 0) * 15;
      const qwarn = (it.autoCheck.qualityWarnings?.length ?? 0) * 8;
      const base = it.riskScore ?? 0;
      return piiScore + banned + qwarn + base;
    };

    if (sortMode === "risk") {
      filtered = [...filtered].sort((a, b) => {
        const diff = riskRank(b) - riskRank(a);
        if (diff !== 0) return diff;
        return a.submittedAt < b.submittedAt ? 1 : -1;
      });
    } else {
      filtered = [...filtered].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
    }

    return filtered;
  }, [items, query, riskOnly, sortMode, isRiskItem]);

  // 백엔드에서 받은 stage counts 저장 (stageCounts useMemo보다 먼저 선언)
  const [backendStageCounts, setBackendStageCounts] = useState<StageCounts | null>(null);
  
  // pagination 계산
  // 백엔드에서 totalPages를 받아옴
  const [backendTotalPages, setBackendTotalPages] = useState<number | null>(null);

  // stageCounts는 백엔드 API에서 받은 값을 우선 사용
  // 백엔드는 필터와 관계없이 전체 카운트를 제공함
  const stageCounts = useMemo((): StageCounts => {
    // 백엔드에서 받은 stage counts가 있으면 사용
    if (backendStageCounts) {
      return backendStageCounts;
    }
    
    // 백엔드에서 받은 값이 없으면 로컬 계산으로 폴백
    // (초기 로딩 전이나 에러 발생 시)
    // filteredBase가 아직 정의되지 않았을 수 있으므로 안전하게 처리
    if (!filteredBase || !Array.isArray(filteredBase)) {
      return { all: 0, stage1: 0, stage2: 0, docs: 0 };
    }
    
    let stage1 = 0;
    let stage2 = 0;
    let docs = 0;

    for (const it of filteredBase) {
      const st = getReviewStage(it);
      if (st === 1) stage1 += 1;
      else if (st === 2) stage2 += 1;
      else docs += 1;
    }

    return { all: filteredBase.length, stage1, stage2, docs };
  }, [backendStageCounts, filteredBase]);

  // 백엔드에서 이미 stageFilter가 적용된 데이터를 받아오므로,
  // 로컬에서 다시 stageFilter를 적용할 필요가 없음
  // filtered는 filteredBase를 그대로 사용
  const filtered = useMemo(() => {
    return filteredBase;
  }, [filteredBase]);
  
  const totalPages = useMemo(() => {
    if (listMode === "virtual") return 1;
    if (backendTotalPages !== null) {
      return backendTotalPages;
    }
    return Math.max(1, Math.ceil(filtered.length / pageSize));
  }, [filtered.length, pageSize, listMode, backendTotalPages]);

  // pageSize 변경 시 pageIndex를 적절히 조정하고 API 재조회 (페이지 크기 변경 시 현재 보던 항목 유지)
  useEffect(() => {
    if (listMode === "virtual") return;
    
    const prevPageSize = prevPageSizeRef.current;
    const currentPageIndex = pageIndexRef.current;
    
    if (prevPageSize !== pageSize && prevPageSize > 0 && currentPageIndex >= 0) {
      // pageSize 변경 중임을 표시
      isPageSizeChangingRef.current = true;
      
      // pageSize가 변경되었을 때, 현재 페이지의 첫 번째 항목 인덱스를 계산
      const currentFirstItemIndex = currentPageIndex * prevPageSize;
      // 새로운 pageSize에 맞는 pageIndex 계산 (현재 보던 항목이 포함된 페이지로 이동)
      const newPageIndex = Math.max(0, Math.floor(currentFirstItemIndex / pageSize));
      
      // pageIndex를 업데이트 (totalPages가 업데이트되면 다시 조정됨)
      if (newPageIndex !== currentPageIndex) {
        setPageIndex(newPageIndex);
        // pageIndex 변경 useEffect에서 API 호출 (isPageSizeChangingRef 플래그로 구분)
      } else {
        // pageIndex가 변경되지 않았으면 직접 API 호출
        isPageSizeChangingRef.current = false; // 플래그 리셋
        void refreshAllFromApi({ silent: true });
      }
    }
    
    // prevPageSizeRef 업데이트는 항상 수행
    prevPageSizeRef.current = pageSize;
  }, [pageSize, listMode, refreshAllFromApi]); // pageIndexRef를 사용하므로 dependency에서 제외
  
  // totalPages 변경 시 pageIndex 유효성 검증 및 조정
  // pageSize 변경으로 인한 totalPages 변경 시에는 pageIndex를 유지하려고 시도
  useEffect(() => {
    if (listMode === "virtual") return;
    
    // totalPages가 0이면 조정하지 않음 (API 호출 중이거나 데이터가 없을 수 있음)
    if (totalPages <= 0) return;
    
    // pageIndex가 유효한 범위를 벗어나면 조정
    const currentPageIndex = pageIndexRef.current;
    if (currentPageIndex > totalPages - 1) {
      // 유효 범위를 벗어나면 마지막 페이지로 조정
      setPageIndex(Math.max(0, totalPages - 1));
    } else if (currentPageIndex < 0) {
      setPageIndex(0);
    }
    // 유효 범위 내에 있으면 그대로 유지 (pageSize 변경으로 인한 totalPages 변경 시에도)
  }, [totalPages, listMode]); // pageIndex를 dependency에서 제거하여 무한 루프 방지

  // 백엔드에서 이미 페이지네이션된 데이터를 받아오므로,
  // items는 이미 현재 페이지의 데이터만 포함함
  // 따라서 pageItems는 filtered를 그대로 사용 (로컬 필터링만 적용된 현재 페이지 데이터)
  const pageItems = useMemo(() => {
    if (listMode === "virtual") return filtered;
    // 백엔드에서 이미 페이지네이션된 데이터를 받아오므로 slice 불필요
    return filtered;
  }, [filtered, listMode]);

  // selection 유지/초기화
  const selectionFrozen = isOverlayOpen || isBusy || lockState.kind === "locking";

  useEffect(() => {
    if (selectionFrozen) return;

    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }

    setSelectedId((prev) => {
      if (!prev) return filtered[0].id;
      const exists = filtered.some((f) => f.id === prev);
      return exists ? prev : filtered[0].id;
    });
  }, [filtered, selectionFrozen]);

  // paged 모드에서 선택 항목이 페이지 밖이면 페이지 이동
  // 단, 사용자가 직접 페이지를 변경한 직후에는 실행하지 않음 (무한 루프 방지)
  useEffect(() => {
    if (listMode === "virtual") return;
    if (!selectedId) return;
    
    // 사용자가 직접 페이지를 변경한 직후에는 자동 페이지 이동 스킵
    if (isUserPageChangeRef.current) {
      isUserPageChangeRef.current = false; // 플래그 리셋
      return;
    }
    
    const idx = filtered.findIndex((f) => f.id === selectedId);
    if (idx < 0) return;
    const nextPage = Math.floor(idx / pageSize);
    if (nextPage !== pageIndex) {
      // 자동 페이지 이동 시에는 플래그를 설정하지 않음 (API 호출은 하지만 자동 이동임을 표시)
      setPageIndex(nextPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, listMode, pageSize]); // filtered.length 제거하여 API 응답으로 인한 불필요한 재실행 방지

  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1;
    return filtered.findIndex((f) => f.id === selectedId);
  }, [filtered, selectedId]);

  // 백엔드 API에서 감사 이력 조회 (selectedItem 변경 시)
  const [auditHistoryById, setAuditHistoryById] = useState<Record<string, ReviewWorkItemExt["audit"]>>({});
  
  // 백엔드 API에서 상세 정보 조회 (selectedItem 변경 시) - fileUrl 등 상세 정보를 가져오기 위해
  const [detailLoadedById, setDetailLoadedById] = useState<Record<string, boolean>>({});
  
  useEffect(() => {
    if (!selectedId) return;
    
    const api = apiRef.current;
    if (!api || !("getWorkItem" in api) || typeof api.getWorkItem !== "function") return;

    // 이미 상세 정보를 조회한 항목이면 스킵
    if (detailLoadedById[selectedId]) return;

    void (async () => {
      try {
        const detail = await api.getWorkItem!(selectedId);
        
        // items 배열을 업데이트하여 상세 정보 반영 (fileUrl, videoUrl 등)
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== selectedId) return it;
            // 상세 정보로 병합 (기존 정보는 유지하되 상세 정보로 업데이트)
            return { ...it, ...detail };
          })
        );
        
        setDetailLoadedById((prev) => ({
          ...prev,
          [selectedId]: true,
        }));
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[ReviewerDesk] getWorkItem failed", err);
      }
    })();
  }, [selectedId, detailLoadedById]);

  const selectedItem = useMemo((): ReviewWorkItemExt | null => {
    if (!selectedId) return null;
    const item = items.find((i) => i.id === selectedId);
    if (!item) return null;
    
    // auditHistoryById에 감사 이력이 있으면 병합
    const auditHistory = auditHistoryById[selectedId];
    if (auditHistory && auditHistory.length > 0) {
      return { ...item, audit: auditHistory };
    }
    
    return item;
  }, [items, selectedId, auditHistoryById]);
  
  useEffect(() => {
    if (!selectedId) return;
    
    const api = apiRef.current;
    if (!api || !("getReviewHistory" in api) || typeof api.getReviewHistory !== "function") return;

    // 이미 조회한 이력이 있으면 스킵
    if (auditHistoryById[selectedId]) return;

    void (async () => {
      try {
        const history = await api.getReviewHistory!(selectedId);
        
        // 백엔드 응답을 AuditEvent 배열로 변환
        const auditEvents = history.history.map((h) => ({
          id: `aud-${h.timestamp}-${h.eventType}`,
          at: h.timestamp,
          actor: h.actorName,
          action: h.eventType as AuditAction,
          detail: h.description || h.rejectionReason || undefined,
        }));

        setAuditHistoryById((prev) => ({
          ...prev,
          [selectedId]: auditEvents,
        }));

        // items의 audit 필드도 업데이트
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== selectedId) return it;
            return { ...it, audit: auditEvents };
          })
        );
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[ReviewerDesk] getReviewHistory failed", err);
      }
    })();
  }, [selectedId, auditHistoryById]);

  const busyKindForSelected = useMemo(() => {
    if (!busy.busy) return null;
    if (!selectedItem) return null;
    if (busy.itemId !== selectedItem.id) return null;
    return busy.kind;
  }, [busy, selectedItem]);

  const approveProcessing = busyKindForSelected === "approve";
  const rejectProcessing = busyKindForSelected === "reject";

  const canApprove = !!selectedItem && selectedItem.status === "REVIEW_PENDING";
  const canReject = !!selectedItem && selectedItem.status === "REVIEW_PENDING";

  // 감사 이력은 백엔드 API에서 자동으로 관리됨

  // ===== lock helpers =====
  const releaseDecisionLockSafely = async () => {
    const cur = decisionLockRef.current;
    if (!cur) {
      setLockState({ kind: "idle" });
      return;
    }

    decisionLockRef.current = null;
    try {
      await apiRef.current!.releaseLock(cur.itemId, cur.lockToken);
    } catch {
      // TTL 기반 회복 가정
    } finally {
      patchItemLock(cur.itemId, undefined);
      setLockState({ kind: "idle" });
    }
  };

  const acquireDecisionLock = async (itemId: string) => {
    // 백엔드 API에는 lock 기능이 없으므로 바로 성공 처리
    const fakeToken = `lock-${Date.now()}`;
    decisionLockRef.current = { itemId, lockToken: fakeToken };
    setLockState({
      kind: "locked",
      itemId,
      lockToken: fakeToken,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      ownerName: effectiveReviewerName,
    });
    return {
      lockToken: fakeToken,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      ownerId: "",
      ownerName: effectiveReviewerName,
    };
  };

  // ===== action guard =====
  const actionGuard: ActionGuardInfo | null = useMemo(() => {
    if (!selectedItem) return null;

    const statusBlock = selectedItem.status !== "REVIEW_PENDING";
    const overlayBlock = decisionModal.open || previewOpen;
    const busyBlock = busy.busy;

    const lockBlockingForSelected =
      (lockState.kind === "locking" && lockState.itemId === selectedItem.id) ||
      (lockState.kind === "blocked" && lockState.itemId === selectedItem.id);

    const commonBlockers: GuardPill[] = [];

    const stage = getReviewStage(selectedItem);

    if (lockBlockingForSelected) {
      if (lockState.kind === "locking") {
        commonBlockers.push({
          tone: "warn",
          label: "락 확보 중",
          detail: "다른 검토자와의 충돌을 방지하기 위해 잠시 대기합니다.",
        });
      } else {
        commonBlockers.push({
          tone: "warn",
          label: "다른 검토자가 처리 중",
          detail: lockState.ownerName
            ? `처리자: ${lockState.ownerName}${
                lockState.expiresAt ? ` · 만료 ${formatDateTime(lockState.expiresAt)}` : ""
              }`
            : "잠시 후 다시 시도하세요.",
        });
      }
    }

    if (decisionModal.open) {
      commonBlockers.push({
        tone: "warn",
        label: "결정 모달 열림",
        detail: "모달을 닫은 뒤 승인/반려를 진행할 수 있습니다.",
      });
    } else if (previewOpen) {
      commonBlockers.push({
        tone: "warn",
        label: "확대 미리보기 열림",
        detail: "미리보기를 닫은 뒤 승인/반려를 진행할 수 있습니다.",
      });
    }

    if (busy.busy) {
      const isSameItem = selectedItem.id === busy.itemId;
      const kindLabel = busy.kind === "approve" ? "승인" : "반려";
      commonBlockers.push({
        tone: "warn",
        label: isSameItem ? `현재 항목 ${kindLabel} 처리 중` : `다른 항목 ${kindLabel} 처리 중`,
        detail: "처리가 끝나면 다시 시도하세요.",
      });
    }

    if (statusBlock) {
      commonBlockers.push({
        tone: "warn",
        label: `상태: ${statusLabel(selectedItem.status)}`,
        detail: "승인/반려는 '검토 대기' 상태에서만 가능합니다.",
      });
    }

    const approveAllowed =
      commonBlockers.length === 0 && !overlayBlock && !busyBlock && !statusBlock && !lockBlockingForSelected;
    const rejectAllowed =
      commonBlockers.length === 0 && !overlayBlock && !busyBlock && !statusBlock && !lockBlockingForSelected;

    const approvePills: GuardPill[] = approveAllowed
      ? isPolicyDocItem(selectedItem)
        ? [
            {
              tone: "neutral",
              label: "승인 시 즉시 공개 + 인덱싱",
              detail:
                "승인 후 문서가 ACTIVE로 전환되며 인덱싱이 자동 시작됩니다. 실패 시 인덱싱 재시도를 진행하세요.",
            },
          ]
        : [
            selectedItem.contentType === "VIDEO" && stage === 1
              ? {
                  tone: "neutral",
                  label: "1차 승인: 비공개",
                  detail: "스크립트만 승인되며, 제작자가 영상 생성을 진행합니다.",
                }
              : {
                  tone: "neutral",
                  label: "승인 시 즉시 공개",
                  detail: "승인(APPROVED) 후 자동 공개(PUBLISHED) 이력이 함께 기록됩니다.",
                },
          ]
      : commonBlockers;

    const rejectPills: GuardPill[] = rejectAllowed
      ? [
          {
            tone: "neutral",
            label: "반려 사유 필수",
            detail: "반려 사유는 제작자에게 전달되며, 감사 이력에 기록됩니다.",
          },
        ]
      : commonBlockers;

    const headline = approveAllowed && rejectAllowed ? "처리 가이드" : "실행 제한 사유";

    return {
      headline,
      approve: { allowed: approveAllowed, pills: approvePills },
      reject: { allowed: rejectAllowed, pills: rejectPills },
    };
  }, [selectedItem, decisionModal.open, previewOpen, busy, lockState]);

  // ===== handlers =====
  const handleRefresh = async () => {
    if (isBusy) return;
    await refreshAllFromApi();
  };

  const moveSelection = (delta: number) => {
    if (filtered.length === 0) return;
    const curIdx = Math.max(0, filtered.findIndex((f) => f.id === selectedId));
    const next = Math.min(filtered.length - 1, Math.max(0, curIdx + delta));
    const nextId = filtered[next]?.id;
    if (nextId) setSelectedId(nextId);
  };

  const closeDecisionModal = () => {
    lockReqSeqRef.current += 1;
    setDecisionModal({ open: false, kind: null });
    decisionCtxRef.current = null;
    void releaseDecisionLockSafely();
  };

  const openApproveModal = () => {
    if (!selectedItem) return;
    if (selectedItem.status !== "REVIEW_PENDING") {
      toastStd.warn("현재 상태에서는 승인할 수 없습니다.");
      return;
    }
    if (isBusy) return;
    if (decisionModal.open || previewOpen) return;

    const itemId = selectedItem.id;
    const itemVersion = selectedItem.version;
    const stage = getReviewStage(selectedItem);
    const isPolicy = isPolicyDocItem(selectedItem);
    const { documentId, versionLabel } = readPolicyMeta(selectedItem);

    const message = isPolicy
      ? `'${selectedItem.title}' 사규/정책을 승인합니다.${
          documentId ? ` (${documentId}${versionLabel ? ` · ${versionLabel}` : ""})` : ""
        }\n승인 즉시 공개되며 인덱싱이 시작됩니다.`
      : selectedItem.contentType !== "VIDEO"
        ? `'${selectedItem.title}' 항목을 승인합니다. 승인 시 즉시 공개(PUBLISHED) 처리됩니다.`
        : stage === 1
          ? `'${selectedItem.title}' 항목을 1차(스크립트) 승인합니다. (공개되지 않으며, 제작자가 영상 생성을 진행합니다.)`
          : `'${selectedItem.title}' 항목을 2차(최종) 승인합니다. 승인 시 즉시 공개(PUBLISHED) 처리됩니다.`;

    const seq = ++lockReqSeqRef.current;

    void (async () => {
      const lock = await acquireDecisionLock(itemId);
      if (!lock) return;

      if (lockReqSeqRef.current !== seq || selectedIdRef.current !== itemId) {
        await releaseDecisionLockSafely();
        return;
      }

      decisionCtxRef.current = { itemId, version: itemVersion, lockToken: lock.lockToken };
      setDecisionModal({ open: true, kind: "approve", message });
    })();
  };

  const openRejectModal = () => {
    if (!selectedItem) return;
    if (selectedItem.status !== "REVIEW_PENDING") {
      toastStd.warn("현재 상태에서는 반려할 수 없습니다.");
      return;
    }
    if (isBusy) return;
    if (decisionModal.open || previewOpen) return;

    const itemId = selectedItem.id;
    const itemVersion = selectedItem.version;
    const seq = ++lockReqSeqRef.current;

    void (async () => {
      const lock = await acquireDecisionLock(itemId);
      if (!lock) return;

      if (lockReqSeqRef.current !== seq || selectedIdRef.current !== itemId) {
        await releaseDecisionLockSafely();
        return;
      }

      decisionCtxRef.current = { itemId, version: itemVersion, lockToken: lock.lockToken };
      setDecisionModal({ open: true, kind: "reject", reason: "" });
    })();
  };

  const ensureDecisionFresh = (expected: { itemId: string; version: number }) => {
    const cur = items.find((i) => i.id === expected.itemId);
    if (!cur) return { ok: false as const, reason: "해당 항목을 찾을 수 없습니다." };
    if (cur.version !== expected.version)
      return { ok: false as const, reason: "다른 사용자에 의해 변경되었습니다. 새로고침 후 다시 시도하세요." };
    if (cur.status !== "REVIEW_PENDING")
      return { ok: false as const, reason: "이미 처리된 항목입니다. 상태를 확인하세요." };
    return { ok: true as const, item: cur };
  };

  const normalizeDecisionResult = (item: ReviewWorkItemExt, kind: "approve" | "reject", reason?: string) => {
    const now = new Date().toISOString();
    const patched: ReviewWorkItemExt = { ...item };

    if (kind === "approve") {
      if (!patched.approvedAt) patched.approvedAt = now;
    } else {
      if (!patched.rejectedAt) patched.rejectedAt = now;
      if (reason && !patched.rejectReason) patched.rejectReason = reason;
    }
    if (!patched.lastUpdatedAt) patched.lastUpdatedAt = now;

    return patched;
  };

  const applyApprove = async () => {
    if (!selectedItem) return;
    if (!canApprove) {
      toastStd.warn("승인 조건을 만족하지 않습니다.");
      return;
    }
    if (isBusy) return;

    const ctx = decisionCtxRef.current;
    if (!ctx || ctx.itemId !== selectedItem.id) {
      toastStd.warn("처리 컨텍스트가 유효하지 않습니다. 다시 시도하세요.");
      closeDecisionModal();
      return;
    }

    const fresh = ensureDecisionFresh({ itemId: ctx.itemId, version: ctx.version });
    if (!fresh.ok) {
      toastStd.err(fresh.reason);
      closeDecisionModal();
      return;
    }

    setBusy({ busy: true, itemId: selectedItem.id, kind: "approve", startedAt: new Date().toISOString() });

    try {
      const api = apiRef.current!;
      const res = await api.approve(selectedItem.id, { version: ctx.version, lockToken: ctx.lockToken });

      const next = normalizeDecisionResult(res.item as ReviewWorkItemExt, "approve");
      patchItemInState(next);

      // reviewStage를 사용하여 1차/2차 승인 구분
      const reviewStage = getReviewStage(selectedItem);
      const isFinal = selectedItem.contentType !== "VIDEO"
        ? true
        : reviewStage === 2; // 2차 검토 단계인지 확인

      // 감사 이력은 백엔드에서 자동으로 기록됨

      toastStd.ok(
        isPolicyDocItem(selectedItem)
          ? "사규/정책 승인 완료 · 인덱싱 시작"
          : selectedItem.contentType !== "VIDEO"
            ? "승인 완료 (공개됨)"
            : isFinal
              ? "2차(최종) 승인 완료 (공개됨)"
              : "1차 승인 완료 (비공개: 제작자가 영상 생성 가능)"
      );

      // 승인 성공 후 목록 갱신 (optimistic update로 즉시 제거)
      setItems((prev) => prev.filter((it) => it.id !== selectedItem.id));
      // 백엔드에서 최신 상태로 재조회
      await refreshAllFromApi({ silent: true, force: true });

      setDecisionModal({ open: false, kind: null });
      decisionCtxRef.current = null;
    } catch (err: unknown) {
      if (isReviewerApiError(err) && err.status === 409) {
        const payload = err.details as ConflictPayload | undefined;
        toastStd.conflict(payload);

        const targetId = ctx.itemId;
        try {
          const latest = await apiRef.current!.getWorkItem(targetId);
          patchItemInState(latest as ReviewWorkItemExt);
        } catch {
          await refreshAllFromApi({ silent: true, force: true });
        }

        setDecisionModal({ open: false, kind: null });
        decisionCtxRef.current = null;
        return;
      }

      const f = toStdHttpErrorMessage("승인", err);
      if (f.tone === "warn") toastStd.warn(f.message);
      else toastStd.err(f.message);
    } finally {
      setBusy({ busy: false });
      await releaseDecisionLockSafely();
    }
  };

  const applyReject = async (reason: string) => {
    if (!selectedItem) return;
    if (!canReject) {
      toastStd.warn("반려 조건을 만족하지 않습니다.");
      return;
    }
    if (isBusy) return;

    const trimmed = reason.trim();
    if (!trimmed) {
      setDecisionModal({ open: true, kind: "reject", reason, error: "반려 사유는 필수입니다." });
      return;
    }

    const ctx = decisionCtxRef.current;
    if (!ctx || ctx.itemId !== selectedItem.id) {
      toastStd.warn("처리 컨텍스트가 유효하지 않습니다. 다시 시도하세요.");
      closeDecisionModal();
      return;
    }

    const fresh = ensureDecisionFresh({ itemId: ctx.itemId, version: ctx.version });
    if (!fresh.ok) {
      toastStd.err(fresh.reason);
      closeDecisionModal();
      return;
    }

    setBusy({ busy: true, itemId: selectedItem.id, kind: "reject", startedAt: new Date().toISOString() });

    try {
      const api = apiRef.current!;
      const res = await api.reject(selectedItem.id, {
        version: ctx.version,
        lockToken: ctx.lockToken,
        reason: trimmed,
      });

      const next = normalizeDecisionResult(res.item as ReviewWorkItemExt, "reject", trimmed);
      patchItemInState(next);

      // 감사 이력은 백엔드에서 자동으로 기록됨

      toastStd.ok(isPolicyDocItem(selectedItem) ? "사규/정책 반려 완료" : "반려 완료");
      
      // 반려 성공 후 목록 갱신 (optimistic update로 즉시 제거)
      setItems((prev) => prev.filter((it) => it.id !== selectedItem.id));
      // 백엔드에서 최신 상태로 재조회
      await refreshAllFromApi({ silent: true, force: true });

      setDecisionModal({ open: false, kind: null });
      decisionCtxRef.current = null;
    } catch (err: unknown) {
      if (isReviewerApiError(err) && err.status === 409) {
        const payload = err.details as ConflictPayload | undefined;
        toastStd.conflict(payload);

        const targetId = ctx.itemId;
        try {
          const latest = await apiRef.current!.getWorkItem(targetId);
          patchItemInState(latest as ReviewWorkItemExt);
        } catch {
          await refreshAllFromApi({ silent: true, force: true });
        }

        setDecisionModal({ open: false, kind: null });
        decisionCtxRef.current = null;
        return;
      }

      const f = toStdHttpErrorMessage("반려", err);
      if (f.tone === "warn") toastStd.warn(f.message);
      else toastStd.err(f.message);
    } finally {
      setBusy({ busy: false });
      await releaseDecisionLockSafely();
    }
  };

  const openPreview = () => {
    if (!selectedItem) return;
    setPreviewOpen(true);
  };

  const closePreview = () => setPreviewOpen(false);

  const handleSaveNote = () => {
    if (!selectedItem) return;
    const note = (notesById[selectedItem.id] ?? "").trim();
    if (!note) return;
    // 메모 저장은 백엔드 API를 통해 처리되어야 함 (현재는 UI만 제공)
    toastStd.ok("메모 저장 기능은 백엔드 API 연동 후 사용 가능합니다.");
  };

  return {
    effectiveReviewerName,

    items,
    setItems,

    activeTab,
    setActiveTab,
    detailTab,
    setDetailTab,
    query,
    setQuery,
    onlyMine,
    setOnlyMine,
    riskOnly,
    setRiskOnly,
    sortMode,
    setSortMode,

    listMode,
    setListMode,
    pageIndex,
    setPageIndex,
    pageSize,
    setPageSize,
    totalPages,
    filtered,
    pageItems,

    selectedId,
    setSelectedId,
    selectedIndex,
    selectedItem,

    counts,

    notesById,
    setNotesById,

    actionGuard,
    canApprove,
    canReject,
    approveProcessing,
    rejectProcessing,

    decisionModal,
    previewOpen,
    isOverlayOpen,

    isBusy,
    busyText,
    toast,
    closeToast,

    handleRefresh,
    openApproveModal,
    openRejectModal,
    closeDecisionModal,
    applyApprove,
    applyReject,
    openPreview,
    closePreview,
    handleSaveNote,
    moveSelection,

    stageFilter,
    setStageFilter,
    stageCounts,

    lastRefreshedAtLabel,

    ui: { statusLabel, statusTone, categoryLabel, piiTone, isRiskItem },
  };
}
