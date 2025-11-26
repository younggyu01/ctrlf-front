// src/components/chatbot/FloatingChatbotRoot.tsx
import React, { useState } from "react";
import FloatingDock from "./FloatingDock";
import ChatbotApp from "./ChatbotApp";
import EduPanel from "./EduPanel";
import QuizPanel from "./QuizPanel";
import { initialCourses } from "./quizData";
import type { Anchor } from "../../utils/chat";

type VideoProgressMap = Record<string, number>;

/**
 * 플로팅 아이콘 + 챗봇 패널 + 교육/퀴즈 패널의 "최상위 컨테이너"
 */
const FloatingChatbotRoot: React.FC = () => {
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

  // 🔹 이미 언락된 퀴즈 id 목록 (기본: initialCourses 중 unlocked=true)
  const [unlockedCourseIds, setUnlockedCourseIds] = useState<string[]>(() =>
    initialCourses.filter((c) => c.unlocked).map((c) => c.id)
  );

  // 🔹 교육 영상 시청률 상태 (videoId → 0~100)
  const [videoProgressMap, setVideoProgressMap] = useState<VideoProgressMap>(
    {}
  );

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
    setAnchor(nextAnchor);

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
   * ChatWindow → ChatbotApp/EduPanel → 여기까지
   * 퀴즈 대시보드 패널 열기 요청
   *  - quizId가 넘어오면 해당 퀴즈를 언락 처리
   */
  const handleOpenQuizPanel = (quizId?: string) => {
    if (quizId) {
      setUnlockedCourseIds((prev) =>
        prev.includes(quizId) ? prev : [...prev, quizId]
      );
    }
    setIsQuizPanelOpen(true);
  };

  const handleCloseQuizPanel = () => {
    setIsQuizPanelOpen(false);
  };

  // 🔹 unlockedCourseIds가 바뀔 때마다 다른 key를 줘서 QuizPanel을 리마운트
  const quizKey =
    unlockedCourseIds.length > 0
      ? `quiz-${unlockedCourseIds.join("|")}`
      : "quiz-default";

  return (
    <>
      {/* 플로팅 아이콘 (챗봇 열기/닫기 토글) */}
      <FloatingDock
        isChatbotOpen={isChatbotOpen}
        onToggleChatbot={handleDockToggleChatbot}
      />

      {/* 챗봇 패널 */}
      {isChatbotOpen && (
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
          // 🔹 시청 상태 유지용 props
          videoProgressMap={videoProgressMap}
          onUpdateVideoProgress={handleUpdateVideoProgress}
        />
      )}

      {/* 퀴즈 대시보드 + 문제풀이 화면을 모두 포함하는 패널 */}
      {isQuizPanelOpen && (
        <QuizPanel
          key={quizKey} // 🔹 언락 상태 바뀔 때마다 초기 state를 새로 만들기 위함
          anchor={anchor}
          onClose={handleCloseQuizPanel}
          unlockedCourseIds={unlockedCourseIds}
        />
      )}
    </>
  );
};

export default FloatingChatbotRoot;
