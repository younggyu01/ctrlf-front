// src/components/chatbot/FloatingChatbotRoot.tsx
import React, { useCallback, useEffect, useReducer, useState } from "react";
import FloatingDock from "./FloatingDock";
import ChatbotApp from "./ChatbotApp";
import EduPanel from "./EduPanel";
import QuizPanel from "./QuizPanel";
import AdminDashboardView from "../dashboard/AdminDashboardView";
import ReviewerDeskView from "./ReviewerDeskView";
import CreatorStudioView from "./CreatorStudioView";
import { initialCourses } from "./quizData";
import type { Anchor } from "../../utils/chat";
import type { PlayEducationVideoParams } from "../../types/chat";
import { can, type UserRole } from "../../auth/roles";

type VideoProgressMap = Record<string, number>;

interface FloatingChatbotRootProps {
  userRole: UserRole;
}

/**
 * 여러 패널을 동시에 띄우면서 z-index를 제어하기 위한 Panel ID
 */
type PanelId = "chat" | "edu" | "quiz" | "admin" | "reviewer" | "creator";

type PanelState = {
  open: Record<PanelId, boolean>;
  zOrder: PanelId[]; // 마지막이 최상단
};

type PanelAction =
  | { type: "OPEN"; id: PanelId }
  | { type: "OPEN_EXCLUSIVE"; id: PanelId; keep?: PanelId[] } // keep는 "열림 상태를 건드리지 않을 패널"
  | { type: "CLOSE"; id: PanelId }
  | { type: "FOCUS"; id: PanelId };

const PANEL_IDS: PanelId[] = [
  "chat",
  "edu",
  "quiz",
  "admin",
  "reviewer",
  "creator",
];

const initialPanelState: PanelState = {
  open: {
    chat: false,
    edu: false,
    quiz: false,
    admin: false,
    reviewer: false,
    creator: false,
  },
  zOrder: [...PANEL_IDS],
};

function bringToFront(order: PanelId[], id: PanelId): PanelId[] {
  return [...order.filter((p) => p !== id), id];
}

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "OPEN": {
      return {
        open: { ...state.open, [action.id]: true },
        zOrder: bringToFront(state.zOrder, action.id),
      };
    }

    case "FOCUS": {
      return {
        ...state,
        zOrder: bringToFront(state.zOrder, action.id),
      };
    }

    case "CLOSE": {
      return {
        ...state,
        open: { ...state.open, [action.id]: false },
      };
    }

    case "OPEN_EXCLUSIVE": {
      const keep = new Set<PanelId>(action.keep ?? ["chat"]); // 기본: chat은 건드리지 않음(열림/닫힘 유지)
      const nextOpen: Record<PanelId, boolean> = { ...state.open };

      for (const pid of PANEL_IDS) {
        if (pid === action.id) continue;
        if (keep.has(pid)) continue;
        nextOpen[pid] = false;
      }
      nextOpen[action.id] = true;

      return {
        open: nextOpen,
        zOrder: bringToFront(state.zOrder, action.id),
      };
    }

    default:
      return state;
  }
}

/**
 * 시험 중 챗봇 막힐 때 보여줄 토스트용 타이머 (모듈 전역)
 */
let examToastHideTimer: number | null = null;

/**
 * 창 리사이즈 시, 앵커 좌표를 화면 안으로 보정할 때 사용할 여백
 */
const ANCHOR_MARGIN = 24;

/**
 * Anchor 를 현재 viewport 안으로 강제(clamp)하는 헬퍼
 */
type AnchorWithOptionalRect = Anchor & {
  x?: number;
  y?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
};

const clampAnchorToViewport = (anchor: Anchor): Anchor => {
  if (typeof window === "undefined") return anchor;

  const rectAnchor = anchor as AnchorWithOptionalRect;

  let x: number | null = null;
  let y: number | null = null;

  if (typeof rectAnchor.x === "number" && typeof rectAnchor.y === "number") {
    x = rectAnchor.x;
    y = rectAnchor.y;
  } else if (
    typeof rectAnchor.left === "number" &&
    typeof rectAnchor.top === "number"
  ) {
    x = rectAnchor.left;
    y = rectAnchor.top;
  }

  if (x === null || y === null) return anchor;

  const width =
    typeof rectAnchor.width === "number" && rectAnchor.width > 0
      ? rectAnchor.width
      : 0;
  const height =
    typeof rectAnchor.height === "number" && rectAnchor.height > 0
      ? rectAnchor.height
      : 0;

  const maxX = Math.max(
    window.innerWidth - ANCHOR_MARGIN - width,
    ANCHOR_MARGIN
  );
  const maxY = Math.max(
    window.innerHeight - ANCHOR_MARGIN - height,
    ANCHOR_MARGIN
  );

  const clampedX = Math.min(Math.max(x, ANCHOR_MARGIN), maxX);
  const clampedY = Math.min(Math.max(y, ANCHOR_MARGIN), maxY);

  const nextAnchor: AnchorWithOptionalRect = { ...rectAnchor };

  if (typeof rectAnchor.x === "number" && typeof rectAnchor.y === "number") {
    nextAnchor.x = clampedX;
    nextAnchor.y = clampedY;
  }
  if (
    typeof rectAnchor.left === "number" &&
    typeof rectAnchor.top === "number"
  ) {
    nextAnchor.left = clampedX;
    nextAnchor.top = clampedY;
  }

  return nextAnchor as Anchor;
};

/**
 * 시험 중 챗봇을 열려고 할 때 화면 하단에 예쁜 토스트를 띄워주는 함수
 */
const showExamBlockedToast = (): void => {
  if (typeof document === "undefined") return;

  const TOAST_ID = "ctrlf-exam-toast";
  let toastEl = document.getElementById(TOAST_ID) as HTMLDivElement | null;

  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.id = TOAST_ID;

    toastEl.style.position = "fixed";
    toastEl.style.left = "50%";
    toastEl.style.bottom = "28px";
    toastEl.style.transform = "translateX(-50%) translateY(12px)";
    toastEl.style.zIndex = "9999";
    toastEl.style.padding = "10px 16px";
    toastEl.style.borderRadius = "999px";
    toastEl.style.backgroundColor = "rgba(15, 23, 42, 0.96)";
    toastEl.style.color = "#f9fafb";
    toastEl.style.display = "flex";
    toastEl.style.alignItems = "center";
    toastEl.style.gap = "8px";
    toastEl.style.boxShadow = "0 12px 30px rgba(15, 23, 42, 0.5)";
    toastEl.style.fontSize = "13px";
    toastEl.style.lineHeight = "1.4";
    toastEl.style.maxWidth = "90vw";
    toastEl.style.pointerEvents = "auto";
    toastEl.style.cursor = "default";
    toastEl.style.opacity = "0";
    toastEl.style.transition =
      "opacity 0.25s ease-out, transform 0.25s ease-out";

    toastEl.innerHTML = `
      <span style="font-size:16px;">⏳</span>
      <span>
        현재 퀴즈 응시 중에는 챗봇을 열 수 없습니다.
        <span style="opacity:0.9;">시험을 제출하거나 나가면 다시 이용할 수 있어요.</span>
      </span>
      <button
        type="button"
        style="
          margin-left:6px;
          border:none;
          background:transparent;
          color:#e5e7eb;
          cursor:pointer;
          font-size:14px;
          padding:2px;
        "
      >
        ✕
      </button>
    `;

    toastEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target.tagName.toLowerCase() === "button") {
        const elToClose = document.getElementById(
          TOAST_ID
        ) as HTMLDivElement | null;
        if (!elToClose) return;

        elToClose.style.opacity = "0";
        elToClose.style.transform = "translateX(-50%) translateY(12px)";

        window.setTimeout(() => {
          const el = document.getElementById(TOAST_ID);
          if (el) el.remove();
        }, 260);

        if (examToastHideTimer !== null) {
          window.clearTimeout(examToastHideTimer);
          examToastHideTimer = null;
        }
      }
    });

    document.body.appendChild(toastEl);
  }

  toastEl.style.opacity = "1";
  toastEl.style.transform = "translateX(-50%) translateY(0)";

  if (examToastHideTimer !== null) {
    window.clearTimeout(examToastHideTimer);
  }
  examToastHideTimer = window.setTimeout(() => {
    const el = document.getElementById(TOAST_ID) as HTMLDivElement | null;
    if (!el) {
      examToastHideTimer = null;
      return;
    }

    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(12px)";

    window.setTimeout(() => {
      const toRemove = document.getElementById(TOAST_ID);
      if (toRemove) toRemove.remove();
    }, 260);

    examToastHideTimer = null;
  }, 3200);
};

const FloatingChatbotRoot: React.FC<FloatingChatbotRootProps> = ({
  userRole,
}) => {
  const [dockInstanceKey, setDockInstanceKey] = useState(0);
  const [chatbotAnimationState, setChatbotAnimationState] = useState<
    "opening" | "closing" | null
  >(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const [panels, dispatch] = useReducer(panelReducer, initialPanelState);

  const [isQuizExamMode, setIsQuizExamMode] = useState(false);

  const [unlockedCourseIds, setUnlockedCourseIds] = useState<string[]>(() =>
    initialCourses.filter((c) => c.unlocked).map((c) => c.id)
  );

  const [videoProgressMap, setVideoProgressMap] = useState<VideoProgressMap>(
    {}
  );

  // 교육 영상 자동 재생 대기 상태 (AI 응답에서 PLAY_VIDEO 액션 감지 시)
  const [pendingVideoPlay, setPendingVideoPlay] =
    useState<PlayEducationVideoParams | null>(null);

  const isChatbotOpen = panels.open.chat;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setDockInstanceKey((prev) => prev + 1);
      setAnchor((prev) => (prev ? clampAnchorToViewport(prev) : prev));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const getZIndexForPanel = (id: PanelId): number => {
    const base = 1000;
    const idx = panels.zOrder.indexOf(id);
    if (idx === -1) return base;
    return base + idx;
  };

  const handleUpdateVideoProgress = (videoId: string, progress: number) => {
    setVideoProgressMap((prev) => {
      const prevVal = prev[videoId] ?? 0;
      const nextVal = Math.max(prevVal, Math.round(progress));
      if (nextVal === prevVal) return prev;
      return { ...prev, [videoId]: nextVal };
    });
  };

  /**
   * Dock 아이콘 클릭 → 챗봇 토글
   */
  const handleDockToggleChatbot = (nextAnchor: Anchor) => {
    if (isQuizExamMode) {
      showExamBlockedToast();
      return;
    }

    const safeAnchor = clampAnchorToViewport(nextAnchor);
    setAnchor(safeAnchor);

    if (!isChatbotOpen) {
      dispatch({ type: "OPEN", id: "chat" });
      setChatbotAnimationState("opening");
    } else {
      setChatbotAnimationState("closing");
    }
  };

  const handleChatbotClose = () => {
    if (!isChatbotOpen) return;
    setChatbotAnimationState("closing");
  };

  /**
   * Genie 애니메이션 종료 콜백
   * - closing → chat 실제 닫기
   */
  const handleChatbotAnimationEnd = () => {
    if (chatbotAnimationState === "closing") {
      dispatch({ type: "CLOSE", id: "chat" });
      setChatbotAnimationState(null);
      return;
    }
    if (chatbotAnimationState === "opening") {
      setChatbotAnimationState(null);
    }
  };

  /**
   * - Secondary panel은 서로 배타적으로 운용
   * - OPEN_EXCLUSIVE로 edu/quiz/admin/reviewer/creator는 한 번에 하나만
   * - chat은 keep(default)로 "열림 상태 유지"
   */
  const handleOpenEduPanel = () => {
    dispatch({ type: "OPEN_EXCLUSIVE", id: "edu" });
  };

  const handleCloseEduPanel = () => {
    dispatch({ type: "CLOSE", id: "edu" });
    // 패널 닫을 때 대기 중인 영상 재생 정보 초기화
    setPendingVideoPlay(null);
  };

  /**
   * AI 응답에서 영상 재생 액션이 감지되었을 때 호출
   * - EduPanel을 열고 해당 영상을 자동 재생하도록 설정
   */
  const handlePlayEducationVideo = useCallback(
    (params: PlayEducationVideoParams) => {
      // 1. 영상 재생 정보 저장
      setPendingVideoPlay(params);
      // 2. EduPanel 열기
      dispatch({ type: "OPEN_EXCLUSIVE", id: "edu" });
    },
    []
  );

  const handleOpenQuizPanel = (quizId?: string) => {
    if (quizId) {
      setUnlockedCourseIds((prev) =>
        prev.includes(quizId) ? prev : [...prev, quizId]
      );
    }
    dispatch({ type: "OPEN_EXCLUSIVE", id: "quiz" });
  };

  const handleCloseQuizPanel = () => {
    dispatch({ type: "CLOSE", id: "quiz" });
    setIsQuizExamMode(false);
  };

  const handleOpenAdminPanel = () => {
    if (!can(userRole, "OPEN_ADMIN_DASHBOARD")) return;
    dispatch({ type: "OPEN_EXCLUSIVE", id: "admin" });
  };

  const handleCloseAdminPanel = () => {
    dispatch({ type: "CLOSE", id: "admin" });
  };

  const handleOpenReviewerPanel = () => {
    if (!can(userRole, "OPEN_REVIEWER_DESK")) return;
    dispatch({ type: "OPEN_EXCLUSIVE", id: "reviewer" });
  };

  const handleCloseReviewerPanel = () => {
    dispatch({ type: "CLOSE", id: "reviewer" });
  };

  const handleOpenCreatorPanel = () => {
    if (!can(userRole, "OPEN_CREATOR_STUDIO")) return;
    dispatch({ type: "OPEN_EXCLUSIVE", id: "creator" });
  };

  const handleCloseCreatorPanel = () => {
    dispatch({ type: "CLOSE", id: "creator" });
  };

  const handleQuizExamModeChange = (isExamMode: boolean) => {
    setIsQuizExamMode(isExamMode);
  };

  const quizKey =
    unlockedCourseIds.length > 0
      ? `quiz-${unlockedCourseIds.join("|")}`
      : "quiz-default";

  return (
    <>
      <FloatingDock
        key={dockInstanceKey}
        isChatbotOpen={isChatbotOpen}
        onToggleChatbot={handleDockToggleChatbot}
      />

      {/* CHATBOT 패널 (Genie 애니메이션 + 플로팅) */}
      {panels.open.chat && !isQuizExamMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: getZIndexForPanel("chat"),
            pointerEvents: "none",
          }}
        >
          <ChatbotApp
            onClose={handleChatbotClose}
            anchor={anchor}
            animationState={chatbotAnimationState ?? undefined}
            onAnimationEnd={handleChatbotAnimationEnd}
            onOpenEduPanel={handleOpenEduPanel}
            onOpenQuizPanel={handleOpenQuizPanel}
            onOpenAdminPanel={handleOpenAdminPanel}
            onOpenReviewerPanel={handleOpenReviewerPanel}
            onOpenCreatorPanel={handleOpenCreatorPanel}
            userRole={userRole}
            onRequestFocus={() => dispatch({ type: "FOCUS", id: "chat" })}
            onPlayEducationVideo={handlePlayEducationVideo}
          />
        </div>
      )}

      {/* 교육 패널 */}
      {panels.open.edu && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: getZIndexForPanel("edu"),
            pointerEvents: "none",
          }}
        >
          <EduPanel
            anchor={anchor}
            onClose={handleCloseEduPanel}
            onOpenQuizPanel={handleOpenQuizPanel}
            videoProgressMap={videoProgressMap}
            onUpdateVideoProgress={handleUpdateVideoProgress}
            onRequestFocus={() => dispatch({ type: "FOCUS", id: "edu" })}
            initialVideo={pendingVideoPlay ?? undefined}
            onInitialVideoConsumed={() => setPendingVideoPlay(null)}
          />
        </div>
      )}

      {/* 퀴즈 패널 */}
      {panels.open.quiz && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: getZIndexForPanel("quiz"),
            pointerEvents: "none",
          }}
        >
          <QuizPanel
            key={quizKey}
            anchor={anchor}
            onClose={handleCloseQuizPanel}
            unlockedCourseIds={unlockedCourseIds}
            onExamModeChange={handleQuizExamModeChange}
            onRequestFocus={() => dispatch({ type: "FOCUS", id: "quiz" })}
          />
        </div>
      )}

      {/* 관리자 대시보드 */}
      {panels.open.admin && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: getZIndexForPanel("admin"),
            pointerEvents: "none",
          }}
        >
          <AdminDashboardView
            anchor={anchor}
            onClose={handleCloseAdminPanel}
            onRequestFocus={() => dispatch({ type: "FOCUS", id: "admin" })}
          />
        </div>
      )}

      {/* 검토 Desk */}
      {panels.open.reviewer && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: getZIndexForPanel("reviewer"),
            pointerEvents: "none",
          }}
        >
          <ReviewerDeskView
            anchor={anchor}
            onClose={handleCloseReviewerPanel}
            onRequestFocus={() => dispatch({ type: "FOCUS", id: "reviewer" })}
          />
        </div>
      )}

      {/* 제작 Studio */}
      {panels.open.creator && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: getZIndexForPanel("creator"),
            pointerEvents: "none",
          }}
        >
          <CreatorStudioView
            anchor={anchor}
            onClose={handleCloseCreatorPanel}
            onRequestFocus={() => dispatch({ type: "FOCUS", id: "creator" })}
            sourceDomain={(() => {
              if (typeof window === "undefined") return "EDU";
              const stored = localStorage.getItem(
                "ctrlf-creator-source-domain"
              );
              return stored === "POLICY" || stored === "EDU" ? stored : "EDU";
            })()}
          />
        </div>
      )}
    </>
  );
};

export default FloatingChatbotRoot;
