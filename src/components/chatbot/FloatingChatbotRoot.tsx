// src/components/chatbot/FloatingChatbotRoot.tsx
import React, { useEffect, useState } from "react";
import FloatingDock from "./FloatingDock";
import ChatbotApp from "./ChatbotApp";
import EduPanel from "./EduPanel";
import QuizPanel from "./QuizPanel";
import { initialCourses } from "./quizData";
import type { Anchor } from "../../utils/chat";

type VideoProgressMap = Record<string, number>;

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
 * - Anchor 구조가 { x, y, width, height } 이든 { left, top } 이든 둘 다 최대한 대응
 * - 화면 밖으로 나간 경우, 마진을 두고 안쪽으로 끌어옴
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

  // 우선 x / y 또는 left / top 좌표를 가져온다.
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

  // 좌표 정보가 없으면 건드리지 않고 그대로 반환
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

  // 원래 anchor 를 복사해서, 실제로 존재하는 좌표 필드에만 보정값을 덮어씀
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
 * - React state와는 완전히 분리 (DOM 직접 조작)
 * - 다시 눌러도 3초 동안 유지되고 부드럽게 사라짐
 */
const showExamBlockedToast = (): void => {
  if (typeof document === "undefined") return;

  const TOAST_ID = "ctrlf-exam-toast";

  // 이미 떠있는 토스트가 있으면 재사용
  let toastEl = document.getElementById(TOAST_ID) as HTMLDivElement | null;

  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.id = TOAST_ID;

    // 기본 스타일
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

    // 내용 (아이콘 + 문구 + 닫기 버튼)
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

    // X 버튼 클릭 시 닫기
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

  // 보이도록 애니메이션
  toastEl.style.opacity = "1";
  toastEl.style.transform = "translateX(-50%) translateY(0)";

  // 3.2초 뒤 자동으로 사라지게
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
 * 플로팅 아이콘 + 챗봇 패널 + 교육/퀴즈 패널의 "최상위 컨테이너"
 */
const FloatingChatbotRoot: React.FC = () => {
  // 플로팅 아이콘 강제 리마운트를 위한 key
  const [dockInstanceKey, setDockInstanceKey] = useState(0);

  // 챗봇 패널 열림/닫힘
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);

  // 챗봇 패널 애니메이션 상태
  const [chatbotAnimationState, setChatbotAnimationState] = useState<
    "opening" | "closing" | null
  >(null);

  // 챗봇/교육/퀴즈 패널 위치 기준이 되는 앵커 (플로팅 아이콘 위치 등)
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  // 교육 패널 열림/닫힘
  const [isEduPanelOpen, setIsEduPanelOpen] = useState(false);
  // 퀴즈 패널 열림/닫힘
  const [isQuizPanelOpen, setIsQuizPanelOpen] = useState(false);

  // 현재 "시험 모드(퀴즈 풀기 화면)"인지 여부
  const [isQuizExamMode, setIsQuizExamMode] = useState(false);

  // 이미 언락된 퀴즈 id 목록 (기본: initialCourses 중 unlocked=true)
  const [unlockedCourseIds, setUnlockedCourseIds] = useState<string[]>(() =>
    initialCourses.filter((c) => c.unlocked).map((c) => c.id)
  );

  // 교육 영상 시청률 상태 (videoId → 0~100)
  const [videoProgressMap, setVideoProgressMap] = useState<VideoProgressMap>(
    {}
  );

  /**
   * 창 리사이즈 시:
   *  - 플로팅 아이콘을 리마운트해서 기본 위치로 되돌림(= 화면 안으로 강제)
   *  - 저장되어 있던 anchor 좌표를 현재 viewport 안으로 보정
   *  - ❗열려 있던 패널(챗봇/교육/퀴즈)은 그대로 유지
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      // 플로팅 도크 강제 리마운트 → position: fixed 기준으로 항상 화면 안에 보이도록
      setDockInstanceKey((prev) => prev + 1);

      // 기존 anchor 도 화면 안으로 클램프
      setAnchor((prev) => (prev ? clampAnchorToViewport(prev) : prev));
      // 패널 open/close 상태는 건드리지 않음
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 시청률 업데이트 (항상 더 큰 값만 반영해서 진행률이 줄어들지 않게)
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
   * 플로팅 아이콘 토글
   */
  const handleDockToggleChatbot = (nextAnchor: Anchor) => {
    // 시험(퀴즈 풀기 화면) 중에는 챗봇 패널 열기/닫기 막고
    // 커스텀 토스트만 보여주기
    if (isQuizExamMode) {
      showExamBlockedToast();
      return;
    }

    // 현재 viewport 기준으로 anchor 를 한 번 보정해서 저장
    const safeAnchor = clampAnchorToViewport(nextAnchor);
    setAnchor(safeAnchor);

    // 단순 토글: 열려 있으면 닫기, 닫혀 있으면 열기
    if (!isChatbotOpen) {
      setIsChatbotOpen(true);
      setChatbotAnimationState("opening");
    } else {
      setChatbotAnimationState("closing");
    }
  };

  /**
   * ChatbotApp 내부 X 버튼에서 호출
   */
  const handleChatbotClose = () => {
    if (!isChatbotOpen) return;
    setChatbotAnimationState("closing");
  };

  /**
   * 지니 애니메이션 종료
   */
  const handleChatbotAnimationEnd = () => {
    if (chatbotAnimationState === "closing") {
      setIsChatbotOpen(false);
      setChatbotAnimationState(null);
      return;
    }

    if (chatbotAnimationState === "opening") {
      setChatbotAnimationState(null);
    }
  };

  /**
   * ChatWindow → ChatbotApp → 여기까지
   * 교육 영상 패널 열기 요청
   */
  const handleOpenEduPanel = () => {
    setIsEduPanelOpen(true);
  };

  const handleCloseEduPanel = () => {
    setIsEduPanelOpen(false);
  };

  /**
   * ChatWindow / EduPanel → 여기까지
   * 퀴즈 대시보드/퀴즈 패널 열기 요청
   *  - quizId가 넘어오면 해당 퀴즈를 언락 처리
   */
  const handleOpenQuizPanel = (quizId?: string) => {
    if (quizId) {
      setUnlockedCourseIds((prev) =>
        prev.includes(quizId) ? prev : [...prev, quizId]
      );
    }

    // 교육 패널은 닫고
    setIsEduPanelOpen(false);

    // 퀴즈 패널 열기
    setIsQuizPanelOpen(true);
  };

  const handleCloseQuizPanel = () => {
    setIsQuizPanelOpen(false);
    // 시험 모드 초기화
    setIsQuizExamMode(false);
  };

  // QuizPanel에서 모드가 바뀔 때 호출되는 콜백
  // solve 모드일 때만 true, 나머지 모드는 false
  const handleQuizExamModeChange = (isExamMode: boolean) => {
    setIsQuizExamMode(isExamMode);
  };

  // unlockedCourseIds가 바뀔 때마다 다른 key를 줘서 QuizPanel을 리마운트
  const quizKey =
    unlockedCourseIds.length > 0
      ? `quiz-${unlockedCourseIds.join("|")}`
      : "quiz-default";

  return (
    <>
      {/* 플로팅 아이콘 (챗봇 열기/닫기 토글)
          - key 를 줘서 창 크기 변경 시 강제로 리마운트 → 항상 화면 안에 보이도록 */}
      <FloatingDock
        key={dockInstanceKey}
        isChatbotOpen={isChatbotOpen}
        onToggleChatbot={handleDockToggleChatbot}
      />

      {/* 챗봇 패널
          시험(퀴즈 풀기 화면)일 때는 아예 렌더링하지 않도록 막기 */}
      {isChatbotOpen && !isQuizExamMode && (
        <ChatbotApp
          onClose={handleChatbotClose}
          anchor={anchor}
          animationState={chatbotAnimationState ?? undefined}
          onAnimationEnd={handleChatbotAnimationEnd}
          onOpenEduPanel={handleOpenEduPanel}
          // 홈에서 퀴즈 카드 클릭 시 새 퀴즈 패널 열기
          onOpenQuizPanel={handleOpenQuizPanel}
        />
      )}

      {/* 교육 영상 패널: 챗봇과 독립 */}
      {isEduPanelOpen && (
        <EduPanel
          anchor={anchor}
          onClose={handleCloseEduPanel}
          // 교육 100% 시청 후 "퀴즈 풀기" 버튼에서도 동일한 퀴즈 패널 열기 (+ 언락 처리 가능)
          onOpenQuizPanel={handleOpenQuizPanel}
          // 시청 상태 유지용 props
          videoProgressMap={videoProgressMap}
          onUpdateVideoProgress={handleUpdateVideoProgress}
        />
      )}

      {/* 퀴즈 대시보드 + 문제풀이 화면을 모두 포함하는 패널 */}
      {isQuizPanelOpen && (
        <QuizPanel
          key={quizKey} // 언락 상태 바뀔 때마다 초기 state를 새로 만들기 위함
          anchor={anchor}
          onClose={handleCloseQuizPanel}
          unlockedCourseIds={unlockedCourseIds}
          // solve 모드일 때만 true로 넘어옴
          onExamModeChange={handleQuizExamModeChange}
        />
      )}
    </>
  );
};

export default FloatingChatbotRoot;
