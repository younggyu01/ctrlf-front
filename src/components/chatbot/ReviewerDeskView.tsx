// src/components/chatbot/ReviewerDeskView.tsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import "./chatbot.css";
import { computePanelPosition, type Anchor, type PanelSize } from "../../utils/chat";

import { useReviewerDeskController } from "./useReviewerDeskController";
import ReviewerQueue from "./ReviewerQueue";
import ReviewerDetail from "./ReviewerDetail";
import ReviewerActionBar from "./ReviewerActionBar";
import ReviewerOverlays from "./ReviewerOverlays";

import {
  listPolicyVersionsSnapshot,
  subscribePolicyStore,
  retryIndexing,
  onReviewerRollback,
  getPolicyVersionSnapshot,
  PolicyStoreError,
} from "./policyStore";

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

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

interface ReviewerDeskViewProps {
  anchor?: Anchor | null;
  onClose: () => void;
  onRequestFocus?: () => void;

  /**
   * 추후 Keycloak 토큰/백엔드 API에서 내려오는 값 연결용
   * - 검토자는 전사 범위 고정(타입/범위 분리 없음)
   */
  reviewerName?: string;
}

const MIN_WIDTH = 980;
const MIN_HEIGHT = 620;
const MAX_WIDTH = 1240;
const PANEL_MARGIN = 80;

const createInitialSize = (): PanelSize => {
  if (typeof window === "undefined") return { width: 1080, height: 740 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, vw - PANEL_MARGIN));
  const height = Math.max(MIN_HEIGHT, vh - PANEL_MARGIN);
  return { width, height };
};

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

function cursorForResizeDir(dir: ResizeDirection) {
  if (dir === "n" || dir === "s") return "ns-resize";
  if (dir === "e" || dir === "w") return "ew-resize";
  if (dir === "ne" || dir === "sw") return "nesw-resize";
  return "nwse-resize"; // nw, se
}

function isTextInputTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function clampPanelPos(pos: { top: number; left: number }, size: PanelSize) {
  const margin = 16;
  if (typeof window === "undefined") return pos;
  const maxLeft = Math.max(margin, window.innerWidth - margin - size.width);
  const maxTop = Math.max(margin, window.innerHeight - margin - size.height);
  return {
    left: Math.max(margin, Math.min(maxLeft, pos.left)),
    top: Math.max(margin, Math.min(maxTop, pos.top)),
  };
}

function clampPanelSize(size: PanelSize) {
  const margin = 16;
  if (typeof window === "undefined") return size;

  const maxW = Math.max(320, window.innerWidth - margin * 2);
  const maxH = Math.max(320, window.innerHeight - margin * 2);

  const minW = Math.min(MIN_WIDTH, maxW);
  const minH = Math.min(MIN_HEIGHT, maxH);

  return {
    width: Math.max(minW, Math.min(MAX_WIDTH, Math.min(maxW, size.width))),
    height: Math.max(minH, Math.min(maxH, size.height)),
  };
}

type ToastTone = "neutral" | "warn" | "danger";
type ToastState = { open: boolean; tone: ToastTone; message: string };

type PolicyModalState =
  | { open: false }
  | {
      open: true;
      kind: "retryIndexing";
      /** 사용자가 선택한 "검토 아이템" 기준 식별자(기존 인터페이스 유지) */
      reviewItemId: string;
      /** 표준: 가능하면 "버전ID"를 우선 사용 (없으면 reviewItemId로 폴백) */
      versionId?: string;
      versionLabel?: string;
      error?: string;
    }
  | {
      open: true;
      kind: "rollback";
      documentId: string;
      targetVersionId: string;
      targetVersionLabel: string;
      reason: string;
      error?: string;
    };

function readStringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function resolvePolicyVersionIdForRetry(inputId: string, selectedItem: unknown): string | undefined {
  // 1) inputId 자체가 policy versionId 인지(스토어에 존재하면) 우선 판단
  const snapByInput = getPolicyVersionSnapshot(inputId);
  if (snapByInput) return inputId;

  // 2) selectedItem에 version id가 별도 필드로 있는 경우(런타임 필드명 변화 대비)
  const candidate =
    readStringField(selectedItem, "policyVersionId") ??
    readStringField(selectedItem, "versionId") ??
    readStringField(selectedItem, "targetVersionId");

  if (candidate) {
    const snap = getPolicyVersionSnapshot(candidate);
    if (snap) return candidate;
    // 스토어에 없더라도 "버전ID 우선" 정책 상 candidate를 사용해도 되는 경우가 있어 반환
    return candidate;
  }

  // 3) 마지막 폴백: 검토 아이템 id 사용
  return undefined;
}

function formatPolicyVersionLabel(snapshot: unknown, fallback: string) {
  const label =
    readStringField(snapshot, "versionLabel") ??
    readStringField(snapshot, "label") ??
    readStringField(snapshot, "versionName") ??
    readStringField(snapshot, "version");
  return label ? label : fallback;
}

function normalizePolicyErrorP1(err: unknown): { tone: ToastTone; message: string } {
  // P1 표준: 상태코드/충돌은 warn, 그 외는 danger 중심. 메시지는 사용자 액션을 유도.
  if (err instanceof PolicyStoreError) {
    const status = (err as PolicyStoreError).status;
    const raw = (err as PolicyStoreError).message || "";

    if (status === 403) {
      return { tone: "danger", message: "권한이 없습니다. 권한 부여 후 다시 시도하세요." };
    }
    if (status === 404) {
      return {
        tone: "danger",
        message: "대상 문서/버전을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.",
      };
    }
    if (status === 409) {
      return {
        tone: "warn",
        message: raw || "충돌이 발생했습니다. 최신 상태로 갱신 후 다시 시도하세요.",
      };
    }
    if (status === 400 || status === 422) {
      return {
        tone: "warn",
        message: raw || "요청 값이 올바르지 않습니다. 입력을 확인하세요.",
      };
    }
    return {
      tone: "danger",
      message: raw || "처리에 실패했습니다. 다시 시도하거나 관리자에게 문의하세요.",
    };
  }

  if (err instanceof Error) {
    return {
      tone: "danger",
      message: err.message || "처리에 실패했습니다. 다시 시도하거나 관리자에게 문의하세요.",
    };
  }

  return {
    tone: "danger",
    message: "처리에 실패했습니다. 다시 시도하거나 관리자에게 문의하세요.",
  };
}

const ReviewerDeskView: React.FC<ReviewerDeskViewProps> = ({
  anchor,
  onClose,
  onRequestFocus,
  reviewerName,
}) => {
  const [size, setSize] = useState<PanelSize>(() => createInitialSize());
  const [panelPos, setPanelPos] = useState(() =>
    computePanelPosition(anchor ?? null, createInitialSize())
  );

  const uid = React.useId();

  const sizeRef = useRef<PanelSize>(size);
  const posRef = useRef(panelPos);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    posRef.current = panelPos;
  }, [panelPos]);

  useEffect(() => {
    const next = computePanelPosition(anchor ?? null, sizeRef.current);
    const clamped = clampPanelPos(next, sizeRef.current);
    setPanelPos(clamped);
    posRef.current = clamped;
  }, [anchor]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onResize = () => {
      const nextSize = clampPanelSize(sizeRef.current);
      const nextPos = clampPanelPos(posRef.current, nextSize);

      const sizeChanged =
        nextSize.width !== sizeRef.current.width || nextSize.height !== sizeRef.current.height;
      const posChanged = nextPos.left !== posRef.current.left || nextPos.top !== posRef.current.top;

      if (sizeChanged) {
        sizeRef.current = nextSize;
        setSize(nextSize);
      }
      if (sizeChanged || posChanged) {
        posRef.current = nextPos;
        setPanelPos(nextPos);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const panelRef = useRef<HTMLDivElement | null>(null);

  const resizeRef = useRef<ResizeState>({
    resizing: false,
    dir: null,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
    startTop: 0,
    startLeft: 0,
  });

  const dragRef = useRef<DragState>({
    dragging: false,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0,
  });

  const desk = useReviewerDeskController({
    reviewerName,
  });

  const {
    effectiveReviewerName,
    counts,
    listMode,
    setListMode,
    pageIndex,
    setPageIndex,
    pageSize,
    setPageSize,
    totalPages,
    filtered,
    pageItems,
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
    selectedId,
    setSelectedId,
    selectedIndex,
    selectedItem,
    notesById,
    setNotesById,
    actionGuard,
    canApprove,
    canReject,
    approveProcessing,
    rejectProcessing,
    busyText,
    isBusy: baseBusy,
    isOverlayOpen: baseOverlayOpen,
    toast,
    closeToast,
    handleRefresh,
    decisionModal,
    openApproveModal,
    openRejectModal,
    closeDecisionModal,
    applyApprove,
    applyReject,
    previewOpen,
    openPreview,
    closePreview,
    handleSaveNote,
    moveSelection,
    lastRefreshedAtLabel,
    devtools,
    stageFilter,
    setStageFilter,
    stageCounts,
  } = desk;

  // 정책 store snapshot (렌더 동기화 목적)
  useSyncExternalStore(subscribePolicyStore, listPolicyVersionsSnapshot);

  // 정책 액션(인덱싱 재시도/롤백)은 desk busy와 별개로 "P1 처리중 상태"를 갖는다.
  const [policyProcessing, setPolicyProcessing] = useState(false);
  const isBusy = baseBusy || policyProcessing;

  const [localToast, setLocalToast] = useState<ToastState>({
    open: false,
    tone: "neutral",
    message: "",
  });
  const localToastTimerRef = useRef<number | null>(null);

  const showLocalToast = (tone: ToastTone, message: string) => {
    if (typeof window === "undefined") return;
    if (localToastTimerRef.current) window.clearTimeout(localToastTimerRef.current);
    setLocalToast({ open: true, tone, message });
    localToastTimerRef.current = window.setTimeout(() => {
      setLocalToast((prev) => ({ ...prev, open: false }));
    }, 2600);
  };

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (localToastTimerRef.current) window.clearTimeout(localToastTimerRef.current);
    };
  }, []);

  // P1 표준: 한 화면에서 토스트는 단일 슬롯(우선순위: 로컬(정책) > 컨트롤러)
  const effectiveToast: ToastState = localToast.open ? localToast : (toast as ToastState);
  const closeEffectiveToast = () => {
    if (localToast.open) setLocalToast((prev) => ({ ...prev, open: false }));
    else closeToast();
  };

  const [policyModal, setPolicyModal] = useState<PolicyModalState>({ open: false });

  useEffect(() => {
    if (policyModal.open) setPolicyModal({ open: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const isOverlayOpen = baseOverlayOpen || policyModal.open;

  const approvalCtx = useMemo(() => {
    if (!selectedItem) {
      return { stage: null as 1 | 2 | null, publishOnApprove: false, label: "승인" };
    }

    if (selectedItem.contentType === "VIDEO") {
      const stage: 1 | 2 = selectedItem.videoUrl?.trim() ? 2 : 1;
      return {
        stage,
        publishOnApprove: stage === 2,
        label: stage === 2 ? "2차 승인" : "1차 승인",
      };
    }

    return { stage: null as 1 | 2 | null, publishOnApprove: true, label: "승인" };
  }, [selectedItem]);

  const titleId = `cb-reviewer-title-${uid}`;
  const subtitleId = `cb-reviewer-sub-${uid}`;

  const onPanelMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    onRequestFocus?.();
    if (isTextInputTarget(e.target)) return;
    panelRef.current?.focus();
  };

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isOverlayOpen) return;
    if (isTextInputTarget(e.target)) return;

    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      const input = panelRef.current?.querySelector<HTMLInputElement>(".cb-reviewer-search");
      input?.focus();
      return;
    }
    if (e.key === "Enter") {
      if (!selectedItem) return;
      e.preventDefault();
      openPreview();
      return;
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const margin = 16;

    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        const dir = resizeState.dir;

        if (dir.includes("e")) newWidth = resizeState.startWidth + dx;
        if (dir.includes("s")) newHeight = resizeState.startHeight + dy;
        if (dir.includes("w")) {
          newWidth = resizeState.startWidth - dx;
          newLeft = resizeState.startLeft + dx;
        }
        if (dir.includes("n")) {
          newHeight = resizeState.startHeight - dy;
          newTop = resizeState.startTop + dy;
        }

        const maxWidth = window.innerWidth - margin * 2;
        const maxHeight = window.innerHeight - margin * 2;

        newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, newHeight));

        const maxLeft = window.innerWidth - margin - newWidth;
        const maxTop = window.innerHeight - margin - newHeight;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        const nextSize = { width: newWidth, height: newHeight };
        const nextPos = { top: newTop, left: newLeft };

        sizeRef.current = nextSize;
        posRef.current = nextPos;

        setSize(nextSize);
        setPanelPos(nextPos);
        return;
      }

      if (dragState.dragging) {
        const curSize = sizeRef.current;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        let newTop = dragState.startTop + dy;
        let newLeft = dragState.startLeft + dx;

        const maxLeft = window.innerWidth - margin - curSize.width;
        const maxTop = window.innerHeight - margin - curSize.height;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        const nextPos = { top: newTop, left: newLeft };
        posRef.current = nextPos;
        setPanelPos(nextPos);
      }
    };

    const handleMouseUp = () => {
      if (resizeRef.current.resizing) {
        resizeRef.current.resizing = false;
        resizeRef.current.dir = null;
      }
      if (dragRef.current.dragging) {
        dragRef.current.dragging = false;
      }

      if (typeof document !== "undefined") {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleResizeMouseDown =
    (dir: ResizeDirection) => (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (typeof document !== "undefined") {
        document.body.style.userSelect = "none";
        document.body.style.cursor = cursorForResizeDir(dir);
      }

      resizeRef.current = {
        resizing: true,
        dir,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: sizeRef.current.width,
        startHeight: sizeRef.current.height,
        startTop: posRef.current.top,
        startLeft: posRef.current.left,
      };
      dragRef.current.dragging = false;
    };

  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }

    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: posRef.current.top,
      startLeft: posRef.current.left,
    };
    resizeRef.current.resizing = false;
    resizeRef.current.dir = null;
  };

  const requestPolicyRetryIndexing = (reviewItemId: string) => {
    if (isBusy || isOverlayOpen) return;

    const versionId = resolvePolicyVersionIdForRetry(reviewItemId, selectedItem);
    const snap = versionId ? getPolicyVersionSnapshot(versionId) : null;
    const versionLabel = versionId
      ? formatPolicyVersionLabel(snap, versionId)
      : undefined;

    setPolicyModal({
      open: true,
      kind: "retryIndexing",
      reviewItemId,
      versionId,
      versionLabel,
    });
  };

  const requestPolicyRollback = (input: {
    documentId: string;
    targetVersionId: string;
    targetVersionLabel: string;
  }) => {
    if (isBusy || isOverlayOpen) return;
    setPolicyModal({
      open: true,
      kind: "rollback",
      documentId: input.documentId,
      targetVersionId: input.targetVersionId,
      targetVersionLabel: input.targetVersionLabel,
      reason: "",
    });
  };

  const closePolicyModal = () => setPolicyModal({ open: false });

  const confirmPolicyRetryIndexing = async () => {
    if (!policyModal.open || policyModal.kind !== "retryIndexing") return;
    if (policyProcessing) return;

    // 표준: 버전ID 우선 (없으면 reviewItemId)
    const effectiveId = policyModal.versionId || policyModal.reviewItemId;

    // 선검증(있으면): 이미 INDEXING 상태면 warn 토스트 + 모달 유지
    const snap = getPolicyVersionSnapshot(effectiveId);
    const indexingStatus =
      readStringField(snap, "indexingStatus") ??
      readStringField(snap, "indexStatus") ??
      readStringField(snap, "status");

    if (indexingStatus === "INDEXING") {
      const msg = "이미 인덱싱 진행 중입니다. 잠시 후 상태를 다시 확인하세요.";
      showLocalToast("warn", msg);
      setPolicyModal((prev) =>
        prev.open && prev.kind === "retryIndexing" ? { ...prev, error: msg } : prev
      );
      return;
    }

    setPolicyProcessing(true);
    setPolicyModal((prev) =>
      prev.open && prev.kind === "retryIndexing" ? { ...prev, error: undefined } : prev
    );

    try {
      await Promise.resolve(retryIndexing(effectiveId, effectiveReviewerName));

      const label = policyModal.versionLabel
        ? `(${policyModal.versionLabel}) `
        : "";
      showLocalToast("neutral", `${label}인덱싱 재시도 요청이 접수되었습니다.`);
      closePolicyModal();
    } catch (err) {
      const { tone, message } = normalizePolicyErrorP1(err);
      showLocalToast(tone, message);
      setPolicyModal((prev) =>
        prev.open && prev.kind === "retryIndexing" ? { ...prev, error: message } : prev
      );
    } finally {
      setPolicyProcessing(false);
    }
  };

  const confirmPolicyRollback = async () => {
    if (!policyModal.open || policyModal.kind !== "rollback") return;
    if (policyProcessing) return;

    const reason = policyModal.reason.trim();
    if (!reason) {
      const msg = "롤백 사유를 입력하세요.";
      showLocalToast("warn", msg);
      setPolicyModal((prev) =>
        prev.open && prev.kind === "rollback" ? { ...prev, error: msg } : prev
      );
      return;
    }

    // 선검증: 대상 버전이 존재하지 않으면 즉시 에러
    const targetSnap = getPolicyVersionSnapshot(policyModal.targetVersionId);
    if (!targetSnap) {
      const msg = "대상 버전을 찾을 수 없습니다. 목록을 새로고침 후 다시 시도하세요.";
      showLocalToast("danger", msg);
      setPolicyModal((prev) =>
        prev.open && prev.kind === "rollback" ? { ...prev, error: msg } : prev
      );
      return;
    }

    // 선검증(있으면): 이미 ACTIVE라면 warn (롤백 불필요)
    const lifecycle =
      readStringField(targetSnap, "lifecycle") ??
      readStringField(targetSnap, "state") ??
      readStringField(targetSnap, "status");

    if (lifecycle === "ACTIVE") {
      const msg = "이미 해당 버전이 적용(ACTIVE) 상태입니다.";
      showLocalToast("warn", msg);
      setPolicyModal((prev) =>
        prev.open && prev.kind === "rollback" ? { ...prev, error: msg } : prev
      );
      return;
    }

    setPolicyProcessing(true);
    setPolicyModal((prev) =>
      prev.open && prev.kind === "rollback" ? { ...prev, error: undefined } : prev
    );

    try {
      await Promise.resolve(
        onReviewerRollback({
          documentId: policyModal.documentId,
          targetVersionId: policyModal.targetVersionId,
          actor: effectiveReviewerName,
          reason,
        })
      );

      showLocalToast("neutral", `롤백 완료 · ${policyModal.targetVersionLabel} 적용`);
      closePolicyModal();
    } catch (err) {
      const { tone, message } = normalizePolicyErrorP1(err);
      showLocalToast(tone, message);
      setPolicyModal((prev) =>
        prev.open && prev.kind === "rollback" ? { ...prev, error: message } : prev
      );
    } finally {
      setPolicyProcessing(false);
    }
  };

  const rollbackTarget = useMemo(() => {
    if (!policyModal.open || policyModal.kind !== "rollback") return null;
    return getPolicyVersionSnapshot(policyModal.targetVersionId) ?? null;
  }, [policyModal]);

  const headerBusyText = policyProcessing ? "정책 처리 중…" : busyText;

  return (
    <div className="cb-reviewer-wrapper">
      <div
        className="cb-reviewer-panel-container"
        style={{ top: panelPos.top, left: panelPos.left }}
      >
        <div
          ref={panelRef}
          className="cb-reviewer-panel cb-chatbot-panel"
          style={{ width: size.width, height: size.height }}
          onMouseDown={onPanelMouseDown}
          onKeyDown={handlePanelKeyDown}
          tabIndex={0}
          role="region"
          aria-labelledby={titleId}
          aria-describedby={subtitleId}
          aria-busy={isBusy}
        >
          <div className="cb-drag-bar" onMouseDown={handleDragMouseDown} />

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
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-w"
            onMouseDown={handleResizeMouseDown("w")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-e"
            onMouseDown={handleResizeMouseDown("e")}
          />

          {effectiveToast.open && (
            <div
              className={cx("cb-reviewer-toast", `cb-reviewer-toast--${effectiveToast.tone}`)}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span>{effectiveToast.message}</span>
              <button
                type="button"
                className="cb-reviewer-toast-close"
                onClick={closeEffectiveToast}
                aria-label="close toast"
              >
                ✕
              </button>
            </div>
          )}

          <div className="cb-reviewer-header">
            <div className="cb-reviewer-header-main">
              <div className="cb-reviewer-title-row">
                <span className="cb-reviewer-badge">REVIEWER DESK</span>
                <h2 id={titleId} className="cb-reviewer-title">
                  콘텐츠 검토 데스크
                </h2>
              </div>

              <p id={subtitleId} className="cb-reviewer-subtitle">
                검토 대기 콘텐츠를 승인/반려하고 감사 이력을 남깁니다.
                {selectedItem &&
                  (selectedItem.contentType === "POLICY_DOC"
                    ? " (사규/정책은 승인 후 전처리/인덱싱 상태가 표시됩니다.)"
                    : approvalCtx.publishOnApprove
                    ? " (승인 시 즉시 공개)"
                    : " (1차 승인은 공개되지 않으며, 제작자가 영상 제작을 진행합니다.)")}
              </p>

              <div className="cb-reviewer-context">
                {headerBusyText && (
                  <span className="cb-reviewer-context-chip" aria-live="polite">
                    {headerBusyText}
                  </span>
                )}
                <span className="cb-reviewer-context-chip">
                  검토자 <strong>{effectiveReviewerName}</strong>
                </span>
                <span className="cb-reviewer-context-meta">
                  업데이트 <strong>{lastRefreshedAtLabel}</strong>
                </span>
              </div>
            </div>

            <div className="cb-reviewer-header-actions">
              {devtools.enabled && (
                <>
                  <button
                    type="button"
                    className="cb-reviewer-ghost-btn"
                    onClick={devtools.toggleDataset}
                    disabled={isBusy || isOverlayOpen}
                    title="DEV: 대량 데이터/기본 데이터 토글"
                  >
                    {devtools.datasetLabel}
                  </button>
                  <button
                    type="button"
                    className="cb-reviewer-ghost-btn"
                    onClick={devtools.simulateConflict}
                    disabled={isBusy || isOverlayOpen || !selectedId}
                    title="DEV: 충돌 시뮬레이션(버전/상태 변경)"
                  >
                    충돌 시뮬
                  </button>
                </>
              )}

              <button
                type="button"
                className="cb-reviewer-ghost-btn"
                onClick={handleRefresh}
                disabled={isBusy}
                title={isBusy ? "처리 중에는 새로고침할 수 없습니다." : undefined}
              >
                새로고침
              </button>
              <button
                type="button"
                className="cb-reviewer-close-btn"
                onClick={onClose}
                aria-label="close"
                disabled={isBusy}
                title={isBusy ? "처리 중에는 닫을 수 없습니다." : undefined}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="cb-reviewer-body">
            <ReviewerQueue
              uid={uid}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              counts={counts}
              query={query}
              setQuery={setQuery}
              onlyMine={onlyMine}
              setOnlyMine={setOnlyMine}
              riskOnly={riskOnly}
              setRiskOnly={setRiskOnly}
              sortMode={sortMode}
              setSortMode={setSortMode}
              isBusy={isBusy}
              isOverlayOpen={isOverlayOpen}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              selectedIndex={selectedIndex}
              filtered={filtered}
              listMode={listMode}
              setListMode={setListMode}
              pageIndex={pageIndex}
              setPageIndex={setPageIndex}
              pageSize={pageSize}
              setPageSize={setPageSize}
              totalPages={totalPages}
              pageItems={pageItems}
              stageFilter={stageFilter}
              setStageFilter={setStageFilter}
              stageCounts={stageCounts}
            />

            <div className="cb-reviewer-detail">
              <ReviewerDetail
                isBusy={isBusy}
                isOverlayOpen={isOverlayOpen}
                detailTab={detailTab}
                setDetailTab={setDetailTab}
                selectedItem={selectedItem}
                notesById={notesById}
                setNotesById={setNotesById}
                onSaveNote={handleSaveNote}
                onOpenPreview={openPreview}
                onRequestPolicyRetryIndexing={requestPolicyRetryIndexing}
                onRequestPolicyRollback={requestPolicyRollback}
              />

              <ReviewerActionBar
                actionGuard={actionGuard}
                canApprove={canApprove}
                canReject={canReject}
                isBusy={isBusy}
                isOverlayOpen={isOverlayOpen}
                approveProcessing={approveProcessing}
                rejectProcessing={rejectProcessing}
                onApprove={openApproveModal}
                onReject={openRejectModal}
                approveLabel={approvalCtx.label}
                approveProcessingLabel={`${approvalCtx.label} 중…`}
              />
            </div>
          </div>

          <ReviewerOverlays
            isBusy={isBusy}
            canApprove={canApprove}
            approveProcessing={approveProcessing}
            rejectProcessing={rejectProcessing}
            decisionModal={decisionModal}
            onCloseDecision={closeDecisionModal}
            onApprove={applyApprove}
            onReject={applyReject}
            previewOpen={previewOpen}
            onClosePreview={closePreview}
            previewItem={selectedItem}
            approveLabel={approvalCtx.label}
            approveProcessingLabel={`${approvalCtx.label} 처리 중…`}
          />

          {policyModal.open && (
            <div
              className="cb-reviewer-modal-overlay"
              role="dialog"
              aria-modal="true"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) closePolicyModal();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") closePolicyModal();
              }}
            >
              <div className="cb-reviewer-modal" onMouseDown={(e) => e.stopPropagation()}>
                {policyModal.kind === "retryIndexing" && (
                  <>
                    <div className="cb-reviewer-modal-title">인덱싱 재시도</div>
                    <div className="cb-reviewer-modal-desc">
                      인덱싱 실패 상태를 재시도합니다. 상태가 INDEXING으로 변경되며 완료/실패 결과가 갱신됩니다.
                      {policyModal.versionLabel ? (
                        <>
                          <br />
                          대상 버전: <strong>{policyModal.versionLabel}</strong>
                        </>
                      ) : null}
                    </div>

                    {policyModal.error && <div className="cb-reviewer-error">{policyModal.error}</div>}

                    <div className="cb-reviewer-modal-actions">
                      <button
                        type="button"
                        className="cb-reviewer-ghost-btn"
                        onClick={closePolicyModal}
                        disabled={policyProcessing}
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        className="cb-reviewer-primary-btn"
                        onClick={confirmPolicyRetryIndexing}
                        disabled={isBusy}
                      >
                        재시도
                      </button>
                    </div>
                  </>
                )}

                {policyModal.kind === "rollback" && (
                  <>
                    <div className="cb-reviewer-modal-title">롤백 확인</div>
                    <div className="cb-reviewer-modal-desc">
                      문서 <strong>{policyModal.documentId}</strong>를{" "}
                      <strong>{policyModal.targetVersionLabel}</strong>로 되돌립니다.
                      <br />
                      현재 ACTIVE 버전은 ARCHIVED로 전환됩니다. (사유 필수)
                      {rollbackTarget && readStringField(rollbackTarget, "changeSummary") ? (
                        <>
                          <br />
                          선택 버전 변경 요약:{" "}
                          <strong>{readStringField(rollbackTarget, "changeSummary")}</strong>
                        </>
                      ) : null}
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <textarea
                        className="cb-reviewer-textarea"
                        value={policyModal.reason}
                        onChange={(e) =>
                          setPolicyModal((prev) =>
                            prev.open && prev.kind === "rollback"
                              ? { ...prev, reason: e.target.value, error: undefined }
                              : prev
                          )
                        }
                        placeholder="롤백 사유를 입력하세요. (필수)"
                        disabled={isBusy}
                      />
                    </div>

                    {policyModal.error && <div className="cb-reviewer-error">{policyModal.error}</div>}

                    <div className="cb-reviewer-modal-actions">
                      <button
                        type="button"
                        className="cb-reviewer-ghost-btn"
                        onClick={closePolicyModal}
                        disabled={policyProcessing}
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        className="cb-reviewer-danger-btn"
                        onClick={confirmPolicyRollback}
                        disabled={isBusy || !policyModal.reason.trim()}
                      >
                        롤백 실행
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReviewerDeskView;
