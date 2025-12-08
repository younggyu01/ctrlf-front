// src/components/chatbot/FloatingChatbotRoot.tsx
import React, { useEffect, useState } from "react";
import FloatingDock from "./FloatingDock";
import ChatbotApp from "./ChatbotApp";
import EduPanel from "./EduPanel";
import QuizPanel from "./QuizPanel";
import AdminDashboardView from "./AdminDashboardView";
import { initialCourses } from "./quizData";
import type { Anchor } from "../../utils/chat";

type VideoProgressMap = Record<string, number>;

/**
 * EMPLOYEE / SYSTEM_ADMIN Role
 * - 현재는 둘 다 같은 디자인/플로우를 쓰지만,
 *   이후 관리자 전용 기능을 분기할 때 이 타입을 그대로 확장해서 사용.
 */
type UserRole = "SYSTEM_ADMIN" | "EMPLOYEE";

interface FloatingChatbotRootProps {
  userRole: UserRole;
}

/**
 * 여러 패널을 동시에 띄우면서 z-index를 제어하기 위한 Panel ID
 */
type PanelId = "chat" | "edu" | "quiz" | "admin";
type PanelOpenState = Record<PanelId, boolean>;

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

  if (x === null || y === null) {
    return anchor;
  }

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

  const nextAnchor: AnchorWithOptionalRect = {
    ...rectAnchor,
  };

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
        const elToClose = document.getElementById(TOAST_ID) as
          | HTMLDivElement
          | null;
        if (!elToClose) return;

        elToClose.style.opacity = "0";
        elToClose.style.transform = "translateX(-50%) translateY(12px)";

        window.setTimeout(() => {
          const el = document.getElementById(TOAST_ID);
          if (el) {
            el.remove();
          }
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
      if (toRemove) {
        toRemove.remove();
      }
    }, 260);

    examToastHideTimer = null;
  }, 3200);
};

/**
 * 플로팅 아이콘 + 챗봇 패널 + 교육/퀴즈/관리자 패널의 "최상위 컨테이너"
 */
const FloatingChatbotRoot: React.FC<FloatingChatbotRootProps> = ({
  userRole,
}) => {
  const [dockInstanceKey, setDockInstanceKey] = useState(0);
  const [chatbotAnimationState, setChatbotAnimationState] = useState<
    "opening" | "closing" | null
  >(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  // 여러 패널의 열린 상태를 하나의 객체로 관리
  const [openPanels, setOpenPanels] = useState<PanelOpenState>({
    chat: false,
    edu: false,
    quiz: false,
    admin: false,
  });

  // z-index 우선순위 관리 (마지막에 있는 PanelId 가 가장 위)
  const [zOrder, setZOrder] = useState<PanelId[]>([
    "chat",
    "edu",
    "quiz",
    "admin",
  ]);

  const [isQuizExamMode, setIsQuizExamMode] = useState(false);

  const [unlockedCourseIds, setUnlockedCourseIds] = useState<string[]>(() =>
    initialCourses.filter((c) => c.unlocked).map((c) => c.id)
  );

  const [videoProgressMap, setVideoProgressMap] = useState<VideoProgressMap>(
    {}
  );

  // chat 패널 열림 여부 (기존 isChatbotOpen 역할)
  const isChatbotOpen = openPanels.chat;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setDockInstanceKey((prev) => prev + 1);
      setAnchor((prev) => (prev ? clampAnchorToViewport(prev) : prev));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /**
   * z-index 계산: 기본 1000부터 시작해서 zOrder 순서대로 +1
   */
  const getZIndexForPanel = (id: PanelId): number => {
    const base = 1000;
    const idx = zOrder.indexOf(id);
    if (idx === -1) return base;
    return base + idx;
  };

  /**
   * 특정 패널을 "맨 위"로 올림
   */
  const bringToFront = (id: PanelId) => {
    setZOrder((prev) => [...prev.filter((p) => p !== id), id]);
  };

  /**
   * 패널 열기 + z-order 최상단으로 이동
   */
  const openPanel = (id: PanelId) => {
    setOpenPanels((prev) => ({
      ...prev,
      [id]: true,
    }));
    bringToFront(id);
  };

  /**
   * 패널 닫기
   */
  const closePanel = (id: PanelId) => {
    setOpenPanels((prev) => ({
      ...prev,
      [id]: false,
    }));
  };

  const handleUpdateVideoProgress = (videoId: string, progress: number) => {
    setVideoProgressMap((prev) => {
      const prevVal = prev[videoId] ?? 0;
      const nextVal = Math.max(prevVal, Math.round(progress));
      if (nextVal === prevVal) return prev;
      return {
        ...prev,
        [videoId]: nextVal,
      };
    });
  };

  /**
   * 플로팅 Dock 아이콘 클릭 → 챗봇 토글
   * - 열 때: chat 패널 open + z-order 맨 위 + opening 애니메이션
   * - 닫을 때: closing 애니메이션 후, 애니메이션 끝에서 실제 closePanel("chat")
   */
  const handleDockToggleChatbot = (nextAnchor: Anchor) => {
    if (isQuizExamMode) {
      showExamBlockedToast();
      return;
    }

    const safeAnchor = clampAnchorToViewport(nextAnchor);
    setAnchor(safeAnchor);

    if (!isChatbotOpen) {
      openPanel("chat");
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
   * - closing → 실제로 chat 패널 닫기
   * - opening → 애니메이션 상태만 초기화
   */
  const handleChatbotAnimationEnd = () => {
    if (chatbotAnimationState === "closing") {
      closePanel("chat");
      setChatbotAnimationState(null);
      return;
    }

    if (chatbotAnimationState === "opening") {
      setChatbotAnimationState(null);
    }
  };

  /**
   * 교육 패널 열기
   * - 기존처럼 챗봇과 함께 떠 있을 수 있음
   * - 마지막에 연 패널이므로 z-order 최상단으로 올림
   */
  const handleOpenEduPanel = () => {
    openPanel("edu");
  };

  const handleCloseEduPanel = () => {
    closePanel("edu");
  };

  /**
   * 퀴즈 패널 열기
   * - 필요 시 코스 언락
   * - 기존 흐름처럼 교육 패널은 닫고, 퀴즈 패널을 띄움
   * - 마지막에 연 패널 → z-order 최상단
   */
  const handleOpenQuizPanel = (quizId?: string) => {
    if (quizId) {
      setUnlockedCourseIds((prev) =>
        prev.includes(quizId) ? prev : [...prev, quizId]
      );
    }
    closePanel("edu");
    openPanel("quiz");
  };

  const handleCloseQuizPanel = () => {
    closePanel("quiz");
    setIsQuizExamMode(false);
  };

  /**
   * 관리자 대시보드 패널 열기/닫기
   * - 기존처럼 Edu/Quiz 패널은 닫고, Admin 패널만 띄움
   * - 마지막에 연 패널 → z-order 최상단
   */
  const handleOpenAdminPanel = () => {
    closePanel("edu");
    closePanel("quiz");
    openPanel("admin");
  };

  const handleCloseAdminPanel = () => {
    closePanel("admin");
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
      {openPanels.chat && !isQuizExamMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: getZIndexForPanel("chat"),
            pointerEvents: "none", // 전체 덮는 레이어는 클릭 막지 않기
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
            userRole={userRole}
            onRequestFocus={() => bringToFront("chat")} // 패널이 클릭되면 맨 앞으로
          />
        </div>
      )}

      {/* 교육 패널 */}
      {openPanels.edu && (
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
            onRequestFocus={() => bringToFront("edu")}   
          />
        </div>
      )}

      {openPanels.quiz && (
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
            onRequestFocus={() => bringToFront("quiz")} 
          />
        </div>
      )}

      {openPanels.admin && (
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
            onRequestFocus={() => bringToFront("admin")} 
          />
        </div>
      )}
    </>
  );
};

export default FloatingChatbotRoot;
