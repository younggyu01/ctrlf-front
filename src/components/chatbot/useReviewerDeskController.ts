// src/components/chatbot/useReviewerDeskController.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createMockReviewWorkItems,
  formatDateTime,
  mutateMockForConflict,
} from "./reviewerDeskMocks";
import type {
  AuditAction,
  ContentCategory,
  PiiRiskLevel,
  ReviewStatus,
  ReviewWorkItem,
  WorkItemLock,
} from "./reviewerDeskTypes";

import { getReviewerApi, type ReviewerApi } from "./reviewerApi";
import { createReviewerApiMock } from "./reviewerApiMock";
import { isReviewerApiError } from "./reviewerApiErrors";
import type { ConflictPayload } from "./reviewerApiTypes";
import { subscribeReviewStore } from "./reviewFlowStore";

export type ReviewerTabId = "pending" | "approved" | "rejected" | "my";
export type DetailTabId = "preview" | "script" | "checks" | "audit";
export type SortMode = "newest" | "risk";
export type ListMode = "paged" | "virtual";

export type ReviewStageFilter = "all" | "stage1" | "stage2" | "docs";
type StageCounts = { all: number; stage1: number; stage2: number; docs: number };

function getReviewStage(it: ReviewWorkItem): 1 | 2 | null {
  if (it.contentType !== "VIDEO") return null; // 문서/정책 등
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

function getEnvString(key: string): string | undefined {
  const env = import.meta.env as unknown as Record<string, unknown>;
  const v = env[key];
  return typeof v === "string" ? v : undefined;
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

function readLockOwnerName(lock: unknown): string | undefined {
  if (!lock || typeof lock !== "object") return undefined;
  const l = lock as Record<string, unknown>;

  const ownerName = l["ownerName"];
  if (typeof ownerName === "string" && ownerName.trim()) return ownerName.trim();

  const owner = l["owner"];
  if (typeof owner === "string" && owner.trim()) return owner.trim();

  // 레거시 방어 (owner: {name})
  if (owner && typeof owner === "object") {
    const o = owner as Record<string, unknown>;
    const nm = o["name"];
    if (typeof nm === "string" && nm.trim()) return nm.trim();
  }
  return undefined;
}

function readLockExpiresAt(lock: unknown): string | undefined {
  if (!lock || typeof lock !== "object") return undefined;
  const l = lock as Record<string, unknown>;
  const exp = l["expiresAt"];
  return typeof exp === "string" ? exp : undefined;
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

function isMissingLinkedDocMessage(msg: string | null) {
  if (!msg) return false;
  return msg.includes("연결된 문서를 찾을 수 없습니다");
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

// id 기반 병합(중복 제거) 유틸
function mergeUniqueById<T extends { id: string }>(lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const arr of lists) for (const it of arr) map.set(it.id, it);
  return Array.from(map.values());
}

export function useReviewerDeskController(options: UseReviewerDeskControllerOptions) {
  const effectiveReviewerName = options.reviewerName ?? "Reviewer";

  const apiModeRaw = getEnvString("VITE_REVIEWER_API_MODE");
  const apiMode: "mock" | "http" = apiModeRaw === "http" ? "http" : "mock";
  const isHttpMode = apiMode === "http";

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

  // ===== mock data (운영 시나리오 + 대량 생성 지원) =====
  const [datasetKey, setDatasetKey] = useState<"base" | "load">("base");

  const seedItems = useMemo((): ReviewWorkItemExt[] => {
    const preset = datasetKey === "load" ? "load" : "base";
    const total = datasetKey === "load" ? 800 : 120;
    const seed = datasetKey === "load" ? 23 : 7;
    return createMockReviewWorkItems({
      preset,
      reviewerName: effectiveReviewerName,
      total,
      seed,
    }) as ReviewWorkItemExt[];
  }, [datasetKey, effectiveReviewerName]);

  // Reviewer API 인스턴스 (mock 모드에서는 seedItems로 store를 구성)
  const apiRef = useRef<ReviewerApi | null>(null);
  if (!apiRef.current) {
    apiRef.current = isHttpMode
      ? getReviewerApi()
      : createReviewerApiMock({
          initialItems: seedItems,
          me: { id: effectiveReviewerName, name: effectiveReviewerName },
        });
  }

  // http 모드: 최초 refresh로 세팅 / mock 모드: seedItems로 초기화
  const [items, setItems] = useState<ReviewWorkItemExt[]>(() => (isHttpMode ? [] : seedItems));

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
  const [listMode, setListMode] = useState<ListMode>(() =>
    (isHttpMode ? 0 : seedItems.length) >= 260 ? "virtual" : "paged"
  );
  const [pageSize, setPageSize] = useState<number>(30);
  const [pageIndex, setPageIndex] = useState<number>(0);

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
        const api = apiRef.current!;
        const [p, a, r] = await Promise.all([
          api.listWorkItems({ tab: "REVIEW_PENDING", limit: 2000 }),
          api.listWorkItems({ tab: "APPROVED", limit: 2000 }),
          api.listWorkItems({ tab: "REJECTED", limit: 2000 }),
        ]);

        const merged = mergeUniqueById([
          p.items as ReviewWorkItemExt[],
          a.items as ReviewWorkItemExt[],
          r.items as ReviewWorkItemExt[],
        ]);

        setItems(merged);
        setLastRefreshedAt(new Date().toISOString());
        if (!opts?.silent) toastStd.ok("새로고침 완료");
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[ReviewerDesk] refreshAllFromApi failed", err);
        toastStd.err("새로고침에 실패했습니다.");
      } finally {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
      }
    },
    [toastStd]
  );

  // http 모드: 최초 1회 로딩
  useEffect(() => {
    if (!isHttpMode) return;
    void refreshAllFromApi({ silent: true });
  }, [isHttpMode, refreshAllFromApi]);

  // datasetKey 변경 시(mock) api store 재시드 + 상태 초기화
  useEffect(() => {
    if (isHttpMode) return;

    // 기존 락이 있으면 best-effort 해제 (mock에서도 상태 꼬임 방지)
    const cur = decisionLockRef.current;
    if (cur) {
      void apiRef.current?.releaseLock(cur.itemId, cur.lockToken).catch(() => {});
      decisionLockRef.current = null;
    }

    apiRef.current = createReviewerApiMock({
      initialItems: seedItems,
      me: { id: effectiveReviewerName, name: effectiveReviewerName },
    });

    setItems(seedItems);
    setActiveTab("pending");
    setDetailTab("preview");
    setQuery("");
    setOnlyMine(false);
    setRiskOnly(false);
    setSortMode("newest");
    setStageFilter("all");
    setPageIndex(0);
    setListMode(seedItems.length >= 260 ? "virtual" : "paged");
    setSelectedId(null);
    setLastRefreshedAt(new Date().toISOString());
    setLockState({ kind: "idle" });
    decisionCtxRef.current = null;
    lockReqSeqRef.current += 1;
  }, [datasetKey, seedItems, isHttpMode, effectiveReviewerName]);

  // store 이벤트에서 최신 refresh 콜백을 쓰기 위한 ref
  const refreshRef = useRef(refreshAllFromApi);
  useEffect(() => {
    refreshRef.current = refreshAllFromApi;
  }, [refreshAllFromApi]);

  useEffect(() => {
    if (isHttpMode) return;
    let t: number | null = null;

    const unsub = subscribeReviewStore(() => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        void refreshRef.current({ silent: true, force: true });
      }, 60);
    });

    void refreshRef.current({ silent: true, force: true });

    return () => {
      if (t) window.clearTimeout(t);
      unsub();
    };
  }, [isHttpMode, datasetKey]);

  // ===== counts =====
  const counts = useMemo(() => {
    const pending = items.filter((i) => i.status === "REVIEW_PENDING").length;
    const approved = items.filter((i) => i.status === "APPROVED").length;
    const rejected = items.filter((i) => i.status === "REJECTED").length;
    const mine = items.filter((i) => i.audit.some((a) => a.actor === effectiveReviewerName)).length;
    return { pending, approved, rejected, my: mine };
  }, [items, effectiveReviewerName]);

  // ===== filtered =====
  const filteredBase = useMemo(() => {
    const q = query.trim().toLowerCase();

    const byTab = items.filter((it) => {
      if (activeTab === "pending") return it.status === "REVIEW_PENDING";
      if (activeTab === "approved") return it.status === "APPROVED";
      if (activeTab === "rejected") return it.status === "REJECTED";
      return it.audit.some((a) => a.actor === effectiveReviewerName);
    });

    const byMine = onlyMine
      ? byTab.filter((it) => it.audit.some((a) => a.actor === effectiveReviewerName))
      : byTab;

    const byRisk = riskOnly ? byMine.filter((it) => isRiskItem(it)) : byMine;

    const byQuery = q
      ? byRisk.filter((it) => {
          const hay = `${it.title} ${it.department} ${it.creatorName}`.toLowerCase();
          return hay.includes(q);
        })
      : byRisk;

    const list = [...byQuery];

    const riskRank = (it: ReviewWorkItem) => {
      const pii = it.autoCheck.piiRiskLevel;
      const piiScore = pii === "high" ? 100 : pii === "medium" ? 60 : pii === "low" ? 20 : 0;
      const banned = (it.autoCheck.bannedWords?.length ?? 0) * 15;
      const qwarn = (it.autoCheck.qualityWarnings?.length ?? 0) * 8;
      const base = it.riskScore ?? 0;
      return piiScore + banned + qwarn + base;
    };

    if (sortMode === "risk") {
      list.sort((a, b) => {
        const diff = riskRank(b) - riskRank(a);
        if (diff !== 0) return diff;
        return a.submittedAt < b.submittedAt ? 1 : -1;
      });
      return list;
    }

    list.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
    return list;
  }, [items, activeTab, query, onlyMine, riskOnly, sortMode, effectiveReviewerName, isRiskItem]);

  const stageCounts = useMemo((): StageCounts => {
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
  }, [filteredBase]);

  const filtered = useMemo(() => {
    if (stageFilter === "all") return filteredBase;

    if (stageFilter === "docs") {
      return filteredBase.filter((it) => getReviewStage(it) === null);
    }

    const target = stageFilter === "stage1" ? 1 : 2;
    return filteredBase.filter((it) => getReviewStage(it) === target);
  }, [filteredBase, stageFilter]);

  // pagination 계산
  const totalPages = useMemo(() => {
    if (listMode === "virtual") return 1;
    return Math.max(1, Math.ceil(filtered.length / pageSize));
  }, [filtered.length, pageSize, listMode]);

  useEffect(() => {
    if (listMode === "virtual") return;
    if (pageIndex > totalPages - 1) setPageIndex(totalPages - 1);
  }, [pageIndex, totalPages, listMode]);

  const pageItems = useMemo(() => {
    if (listMode === "virtual") return filtered;
    const start = pageIndex * pageSize;
    const end = start + pageSize;
    return filtered.slice(start, end);
  }, [filtered, listMode, pageIndex, pageSize]);

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
  useEffect(() => {
    if (listMode === "virtual") return;
    if (!selectedId) return;
    const idx = filtered.findIndex((f) => f.id === selectedId);
    if (idx < 0) return;
    const nextPage = Math.floor(idx / pageSize);
    if (nextPage !== pageIndex) setPageIndex(nextPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, listMode, pageSize, filtered.length]);

  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1;
    return filtered.findIndex((f) => f.id === selectedId);
  }, [filtered, selectedId]);

  const selectedItem = useMemo((): ReviewWorkItemExt | null => {
    if (!selectedId) return null;
    return items.find((i) => i.id === selectedId) ?? null;
  }, [items, selectedId]);

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

  // ===== audit helpers =====
  const appendAudit = (itemId: string, action: AuditAction, detail?: string) => {
    const at = new Date().toISOString();
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        return {
          ...it,
          audit: [
            ...it.audit,
            {
              id: `aud-${Math.random().toString(36).slice(2, 10)}`,
              at,
              actor: action === "AUTO_CHECKED" || action === "PUBLISHED" ? "SYSTEM" : effectiveReviewerName,
              action,
              detail,
            },
          ],
          lastUpdatedAt: at,
        };
      })
    );
  };

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
    const api = apiRef.current!;
    setLockState({ kind: "locking", itemId });

    try {
      const r = await api.acquireLock(itemId);
      decisionLockRef.current = { itemId, lockToken: r.lockToken };

      patchItemLock(itemId, {
        owner: (r.ownerName ?? effectiveReviewerName).trim() || r.ownerId,
        ownerId: r.ownerId,
        ownerName: r.ownerName ?? effectiveReviewerName,
        expiresAt: r.expiresAt,
      });

      setLockState({
        kind: "locked",
        itemId,
        lockToken: r.lockToken,
        expiresAt: r.expiresAt,
        ownerName: r.ownerName ?? effectiveReviewerName,
      });

      return r;
    } catch (err: unknown) {
      if (isReviewerApiError(err) && err.status === 409) {
        const payload = err.details as ConflictPayload | undefined;

        if (payload?.code === "LOCK_CONFLICT") {
          const cur = (payload.current ?? undefined) as Partial<ReviewWorkItemExt> | undefined;
          const ownerName = readLockOwnerName(cur?.lock as unknown);
          const expiresAt = readLockExpiresAt(cur?.lock as unknown);

          if (cur?.lock) patchItemLock(itemId, cur.lock as WorkItemLockView);

          setLockState({ kind: "blocked", itemId, ownerName, expiresAt });
          toastStd.warn("다른 검토자가 먼저 처리 중입니다.");
          return null;
        }
      }

      setLockState({ kind: "idle" });
      toastStd.err("락 확보에 실패했습니다.");
      return null;
    }
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

      const isFinal =
        selectedItem.contentType !== "VIDEO"
          ? true
          : Boolean(selectedItem.videoUrl && selectedItem.videoUrl.trim().length > 0);

      if (!isHttpMode) {
        appendAudit(
          selectedItem.id,
          "APPROVED",
          selectedItem.contentType !== "VIDEO"
            ? "승인 처리"
            : isFinal
              ? "2차(최종) 승인 처리"
              : "1차(스크립트) 승인 처리"
        );

        if (isFinal) {
          appendAudit(
            selectedItem.id,
            "PUBLISHED",
            selectedItem.contentType !== "VIDEO" ? "승인 후 공개" : "2차 승인 후 공개"
          );
        }
      }

      toastStd.ok(
        isPolicyDocItem(selectedItem)
          ? "사규/정책 승인 완료 · 인덱싱 시작"
          : selectedItem.contentType !== "VIDEO"
            ? "승인 완료 (공개됨)"
            : isFinal
              ? "2차(최종) 승인 완료 (공개됨)"
              : "1차 승인 완료 (비공개: 제작자가 영상 생성 가능)"
      );

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

      const m = extractApiErrorMessage(err);

      // mock 모드: policyStore 연동 문서 미존재로 실패하는 경우 UI 실패 방지
      if (!isHttpMode && isMissingLinkedDocMessage(m)) {
        toastStd.warn("연결된 문서를 찾지 못해 연동 반영은 생략했습니다. (Mock)");
        setDecisionModal({ open: false, kind: null });
        decisionCtxRef.current = null;
        await refreshAllFromApi({ silent: true, force: true });
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

      if (!isHttpMode) appendAudit(selectedItem.id, "REJECTED", trimmed);

      toastStd.ok(isPolicyDocItem(selectedItem) ? "사규/정책 반려 완료" : "반려 완료");
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

      const m = extractApiErrorMessage(err);

      // mock 모드: policyStore 연동 문서 미존재로 실패하는 경우 UI 실패 방지
      if (!isHttpMode && isMissingLinkedDocMessage(m)) {
        toastStd.warn("연결된 문서를 찾지 못해 연동 반영은 생략했습니다. (Mock)");
        setDecisionModal({ open: false, kind: null });
        decisionCtxRef.current = null;
        await refreshAllFromApi({ silent: true, force: true });
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
    appendAudit(selectedItem.id, "COMMENTED", note);
    toastStd.ok("메모가 감사 이력에 저장되었습니다.");
  };

  // ===== DEV: 대량 데이터 + 충돌 시뮬레이션 =====
  const devEnabled = import.meta.env.DEV;

  const toggleDataset = () => {
    if (!devEnabled) return;
    if (isBusy || isOverlayOpen || lockState.kind === "locking") return;
    if (isHttpMode) {
      toastStd.warn("http 모드에서는 로컬 데이터셋 전환이 비활성화됩니다.");
      return;
    }

    setDatasetKey((prev) => {
      const next = prev === "base" ? "load" : "base";
      toastStd.ok(next === "load" ? "대량 데이터 로드" : "기본 데이터 로드");
      return next;
    });
  };

  const simulateConflict = () => {
    if (!devEnabled) return;
    if (!selectedId) return;
    if (isBusy || isOverlayOpen || lockState.kind === "locking") return;
    if (isHttpMode) {
      toastStd.warn("http 모드에서는 충돌 시뮬레이션이 비활성화됩니다.");
      return;
    }

    const modes: Array<Parameters<typeof mutateMockForConflict>[2]> = [
      "version_bump",
      "already_approved",
      "already_rejected",
    ];
    const mode = modes[Math.floor(Math.random() * modes.length)];

    setItems((prev) => {
      const next = mutateMockForConflict(prev as ReviewWorkItem[], selectedId, mode) as ReviewWorkItemExt[];
      apiRef.current = createReviewerApiMock({
        initialItems: next,
        me: { id: effectiveReviewerName, name: effectiveReviewerName },
      });
      return next;
    });

    toastStd.warn(`충돌 시뮬레이션 적용: ${mode.replace("_", " ")}`);
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

    devtools: {
      enabled: devEnabled,
      datasetLabel: datasetKey === "load" ? "대량 데이터" : "기본 데이터",
      toggleDataset,
      simulateConflict,
    },
  };
}
