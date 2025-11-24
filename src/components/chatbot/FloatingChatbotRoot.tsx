// src/components/chatbot/FloatingChatbotRoot.tsx
import React, { useState } from "react";
import FloatingDock from "./FloatingDock";
import ChatbotApp from "./ChatbotApp";
import EduPanel from "./EduPanel";
import type { Anchor } from "../../utils/chat";

/**
 * 플로팅 아이콘 + 챗봇 패널 + 교육 영상 패널의 "최상위 컨테이너"
 *
 * - FloatingDock        : 오른쪽 아래 플로팅 아이콘 (Ctrl F)
 * - ChatbotApp          : 지니 애니메이션 + 사이드바 + 채팅 UI
 * - EduPanel            : 교육 영상 전용 패널
 *
 * 여기서 상태를 들고 있기 때문에:
 *  - 플로팅 아이콘으로 챗봇을 닫아도(isChatbotOpen=false)
 *  - 교육 패널(isEduPanelOpen)은 그대로 유지된다.
 */
const FloatingChatbotRoot: React.FC = () => {
  // 챗봇 패널 열림/닫힘
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);

  // 챗봇 패널 애니메이션 상태
  const [chatbotAnimationState, setChatbotAnimationState] = useState<
    "opening" | "closing" | null
  >(null);

  // 챗봇/교육 패널 위치 기준이 되는 앵커 (플로팅 아이콘 위치 등)
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  // 교육 패널 열림/닫힘 (※ 챗봇과 완전히 독립)
  const [isEduPanelOpen, setIsEduPanelOpen] = useState(false);

  /**
   * 플로팅 아이콘에서 호출되는 토글 핸들러
   * - 아직 챗봇이 닫혀 있으면 → 열기(Opening 애니메이션)
   * - 이미 열려 있으면         → 닫기(Closing 애니메이션)
   *
   * @param nextAnchor 아이콘 중심 좌표 (FloatingDock에서 계산해서 전달)
   */
  const handleDockToggleChatbot = (nextAnchor: Anchor) => {
    setAnchor(nextAnchor);

    if (!isChatbotOpen) {
      // 챗봇을 새로 열기
      setIsChatbotOpen(true);
      setChatbotAnimationState("opening");
    } else {
      // 이미 열려 있으면 닫기 애니메이션 시작
      setChatbotAnimationState("closing");
    }
  };

  /**
   * ChatbotApp 내부 X 버튼에서 호출할 닫기 요청
   * (플로팅 아이콘으로 닫을 때와 동일하게 Closing 애니메이션만 트리거)
   */
  const handleChatbotClose = () => {
    if (!isChatbotOpen) return;
    setChatbotAnimationState("closing");
  };

  /**
   * ChatbotApp의 지니 애니메이션 종료 콜백
   * - opening 끝   → 애니메이션 상태만 초기화
   * - closing 끝   → 실제로 언마운트(isChatbotOpen=false)
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
   * ChatWindow → ChatbotApp → 여기까지 타고 올라오는
   * "교육 영상 패널을 열어달라"는 요청
   *
   * 플로팅 아이콘으로 챗봇을 닫더라도 이 state는 그대로 유지된다.
   */
  const handleOpenEduPanel = () => {
    setIsEduPanelOpen(true);
  };

  /**
   * EduPanel X 버튼에서 호출하는 닫기
   * (챗봇 열림/닫힘과는 완전히 별개)
   */
  const handleCloseEduPanel = () => {
    setIsEduPanelOpen(false);
  };

  return (
    <>
      {/* 플로팅 아이콘 (챗봇 열기/닫기 토글) */}
      <FloatingDock
        isChatbotOpen={isChatbotOpen}
        onToggleChatbot={handleDockToggleChatbot}
      />

      {/* 챗봇 패널: isChatbotOpen일 때만 렌더 */}
      {isChatbotOpen && (
        <ChatbotApp
          onClose={handleChatbotClose}
          anchor={anchor}
          animationState={chatbotAnimationState ?? undefined}
          onAnimationEnd={handleChatbotAnimationEnd}
          // 교육 카드 클릭 시 호출되는 콜백
          onOpenEduPanel={handleOpenEduPanel}
        />
      )}

      {/* 교육 영상 패널: 챗봇과 독립적으로 열려있을 수 있음 */}
      {isEduPanelOpen && (
        <EduPanel
          anchor={anchor}
          onClose={handleCloseEduPanel}
        />
      )}
    </>
  );
};

export default FloatingChatbotRoot;
