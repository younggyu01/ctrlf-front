// src/components/chatbot/ChatWindow.tsx
import React, { useEffect, useRef, useState } from "react";
import robotIcon from "../../assets/robot.png";
import ruleIcon from "../../assets/rule.png";
import faqIcon from "../../assets/faq.png";
import quizIcon from "../../assets/quiz.png";
import eduIcon from "../../assets/edu.png";
import type { ChatDomain } from "./chatApi";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type ChatSessionForWindow = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  domain: ChatDomain; // 🔹 세션 도메인
  messages: ChatMessage[];
};

interface ChatWindowProps {
  activeSession: ChatSessionForWindow | null;
  onSendMessage: (text: string) => void;
  isSending: boolean; // 🔹 전송 중 여부
  onChangeDomain: (domain: ChatDomain) => void; // 🔹 도메인 변경 콜백
}

type ViewKey = "home" | "policy" | "faq" | "quiz" | "edu";

const ChatWindow: React.FC<ChatWindowProps> = ({
  activeSession,
  onSendMessage,
  isSending,
  onChangeDomain,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [activeView, setActiveView] = useState<ViewKey>("home");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const messages = activeSession?.messages ?? [];
  const hasMessages = messages.length > 0;

  // 메시지 추가되면 아래로 스크롤
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages.length]);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;

    onSendMessage(trimmed);
    setInputValue("");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  // 🔹 홈 카드 클릭 시: 도메인 변경 + 전용 화면으로 전환
  const handleFeatureClick = (targetDomain: ChatDomain, viewKey: ViewKey) => {
    if (isSending) return;
    onChangeDomain(targetDomain);
    setActiveView(viewKey);
  };

  // 🔹 전용 화면들 (임시 플레이스홀더)
  const renderPolicyView = () => (
    <div className="cb-domain-view">
      <h3 className="cb-domain-view-title">규정 안내</h3>
      <p className="cb-domain-view-desc">
        여기에는 사내 인사/복지/보안 등 각종 규정 요약 카드, 카테고리 필터,
        검색 박스 등을 넣을 수 있습니다.
      </p>
      <button
        type="button"
        className="cb-domain-view-back"
        onClick={() => setActiveView("home")}
      >
        ← 처음 화면으로 돌아가기
      </button>
    </div>
  );

  const renderFaqView = () => (
    <div className="cb-domain-view">
      <h3 className="cb-domain-view-title">FAQ</h3>
      <p className="cb-domain-view-desc">
        자주 묻는 질문을 카테고리별로 나누고, 클릭 시 상세 답변을 보여주는
        아코디언/리스트 UI를 구성할 수 있습니다.
      </p>
      <button
        type="button"
        className="cb-domain-view-back"
        onClick={() => setActiveView("home")}
      >
        ← 처음 화면으로 돌아가기
      </button>
    </div>
  );

  const renderQuizView = () => (
    <div className="cb-domain-view">
      <h3 className="cb-domain-view-title">퀴즈</h3>
      <p className="cb-domain-view-desc">
        직장 내 괴롭힘, 성희롱 예방, 보안 교육 등 교육 퀴즈를 문제/선택지
        형식으로 진행하는 화면을 붙일 수 있습니다.
      </p>
      <button
        type="button"
        className="cb-domain-view-back"
        onClick={() => setActiveView("home")}
      >
        ← 처음 화면으로 돌아가기
      </button>
    </div>
  );

  const renderEduView = () => (
    <div className="cb-domain-view">
      <h3 className="cb-domain-view-title">교육</h3>
      <p className="cb-domain-view-desc">
        필수/선택 교육 목록, 수강 현황, 교육 영상/문서 링크 등을 보여주는
        전용 대시보드를 구성할 수 있습니다.
      </p>
      <button
        type="button"
        className="cb-domain-view-back"
        onClick={() => setActiveView("home")}
      >
        ← 처음 화면으로 돌아가기
      </button>
    </div>
  );

  return (
    <main className="cb-main">
      {/* 상단 제목 (도메인 칩 제거됨) */}
      <header className="cb-main-header">
        <h2 className="cb-main-title">chatbot</h2>
      </header>

      <section className="cb-main-content">
        {/* 스크롤 영역 */}
        <div className="cb-chat-scroll">
          {/* HOME 화면: 기존 웰컴 + 카드 + (있으면) 채팅 메시지 */}
          {activeView === "home" && (
            <>
              {!hasMessages && (
                <div className="cb-feature-container">
                  <div className="cb-welcome-row">
                    <img
                      src={robotIcon}
                      alt="챗봇 아이콘"
                      className="cb-welcome-icon"
                    />
                    <div className="cb-welcome-text">
                      <p>안녕하세요.</p>
                      <p>Ctrl F의 챗봇(BlinQ)이 서비스를 시작합니다.</p>
                    </div>
                  </div>

                  <div className="cb-feature-row">
                    <button
                      type="button"
                      className="cb-feature-card"
                      onClick={() =>
                        handleFeatureClick("policy", "policy")
                      }
                    >
                      <img
                        src={ruleIcon}
                        alt="규정 안내"
                        className="cb-feature-icon"
                      />
                      <span className="cb-feature-label">규정 안내</span>
                    </button>

                    <button
                      type="button"
                      className="cb-feature-card"
                      onClick={() => handleFeatureClick("faq", "faq")}
                    >
                      <img
                        src={faqIcon}
                        alt="FAQ"
                        className="cb-feature-icon"
                      />
                      <span className="cb-feature-label">FAQ</span>
                    </button>

                    <button
                      type="button"
                      className="cb-feature-card"
                      onClick={() => handleFeatureClick("quiz", "quiz")}
                    >
                      <img
                        src={quizIcon}
                        alt="퀴즈"
                        className="cb-feature-icon"
                      />
                      <span className="cb-feature-label">퀴즈</span>
                    </button>

                    <button
                      type="button"
                      className="cb-feature-card"
                      onClick={() => handleFeatureClick("edu", "edu")}
                    >
                      <img
                        src={eduIcon}
                        alt="교육"
                        className="cb-feature-icon"
                      />
                      <span className="cb-feature-label">교육</span>
                    </button>
                  </div>
                </div>
              )}

              {hasMessages && (
                <div className="cb-chat-messages">
                  {messages.map((msg) => {
                    const isUser = msg.role === "user";

                    return (
                      <div
                        key={msg.id}
                        className={`cb-chat-bubble-row ${
                          isUser
                            ? "cb-chat-bubble-row-user"
                            : "cb-chat-bubble-row-bot"
                        }`}
                      >
                        {/* 봇 메시지일 때만 왼쪽에 아바타 표시 */}
                        {!isUser && (
                          <div className="cb-chat-avatar">
                            <img src={robotIcon} alt="챗봇" />
                          </div>
                        )}

                        <div
                          className={`cb-chat-bubble ${
                            isUser
                              ? "cb-chat-bubble-user"
                              : "cb-chat-bubble-bot"
                          }`}
                        >
                          <div className="cb-chat-bubble-text">
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* 도메인 전용 화면들 */}
          {activeView === "policy" && renderPolicyView()}
          {activeView === "faq" && renderFaqView()}
          {activeView === "quiz" && renderQuizView()}
          {activeView === "edu" && renderEduView()}

          <div ref={messagesEndRef} />
        </div>

        {/* 하단 입력 영역: 어떤 화면이든 공통으로 둠 */}
        <div className="cb-input-section">
          <p className="cb-input-hint">
            {isSending ? "답변을 생성하고 있어요…" : "무엇이든 물어보세요!"}
          </p>
          <div className="cb-input-pill">
            <button
              type="button"
              className="cb-input-plus"
              disabled={isSending}
            >
              +
            </button>
            <input
              type="text"
              className="cb-input"
              placeholder=""
              aria-label="질문 입력"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={isSending}
            />
            <button
              type="button"
              className="cb-input-send"
              onClick={handleSend}
              disabled={isSending}
            >
              <span className="cb-send-icon">▶</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default ChatWindow;
