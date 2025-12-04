// src/components/chatbot/ChatWindow.tsx

import React, { useEffect, useRef, useState } from "react";
import robotIcon from "../../assets/robot.png";
import quizIcon from "../../assets/quiz.png";
import eduIcon from "../../assets/edu.png";

// 액션 아이콘
import retryIcon from "../../assets/chat-retry.png"; // 다시 시도 아이콘

// 피드백(좋아요/별로예요) 아이콘
import feedbackGoodIcon from "../../assets/chat-good.png"; // 좋은 응답 아이콘
import feedbackBadIcon from "../../assets/chat-bad.png"; // 별로인 응답 아이콘

import type {
  ChatDomain,
  ChatSession,
  FeedbackValue,
  ReportPayload,
} from "../../types/chat";
import {
  FAQ_ITEMS,
  FAQ_CATEGORY_LABELS,
  type FaqCategory,
} from "./faqData";

interface ChatWindowProps {
  activeSession: ChatSession | null;
  onSendMessage: (text: string) => void;
  isSending: boolean;
  onChangeDomain: (domain: ChatDomain) => void;
  onOpenEduPanel?: () => void;
  onOpenQuizPanel?: () => void;
  onFaqQuickSend?: (faqId: number) => void;
  // 답변 기준 다시 시도 버튼
  onRetryFromMessage?: (
    sourceQuestion: string,
    mode: "retry" | "variant"
  ) => void;
  // 피드백 업데이트 콜백 (세션 상태 업데이트는 상위에서)
  onFeedbackChange?: (messageId: string, value: FeedbackValue) => void;
  // 신고 모달에서 제출 시
  onReportSubmit?: (payload: ReportPayload) => void;
}

// UI에서 사용하는 메시지 타입
interface UiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // 신고 안내 말풍선 같은 특수 메시지 구분용
  kind?: "normal" | "reportSuggestion";
  // 피드백 (좋아요/별로예요)
  feedback?: FeedbackValue;
}

// FAQ 필터용 타입 (전체 + 카테고리)
type FaqFilter = "all" | FaqCategory;

// "전체" 포함 라벨 맵
const FAQ_FILTER_LABELS: Record<FaqFilter, string> = {
  all: "전체",
  ...FAQ_CATEGORY_LABELS,
};

// 칩으로 보여줄 실제 카테고리 키 목록 ("전체" 칩 제거)
const FAQ_FILTER_KEYS: FaqCategory[] = [
  "account",
  "approval",
  "hr",
  "pay",
  "welfare",
  "education",
  "it",
  "security",
  "facility",
  "etc",
];

const ChatWindow: React.FC<ChatWindowProps> = ({
  activeSession,
  onSendMessage,
  isSending,
  onChangeDomain,
  onOpenEduPanel,
  onOpenQuizPanel,
  onFaqQuickSend,
  onRetryFromMessage,
  onFeedbackChange,
  onReportSubmit,
}) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // FAQ 필터 상태 (전체/카테고리) - 초기 "all" 이면 질문 카드 숨김
  const [faqFilter, setFaqFilter] = useState<FaqFilter>("all");

  // 신고 모달 상태
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportContent, setReportContent] = useState("");
  const reportTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 세션/도메인 정보
  const currentDomain: ChatDomain = activeSession?.domain ?? "general";
  const isFaqDomain = currentDomain === "faq";
  const isGeneralDomain = currentDomain === "general";

  // 원본 세션 메시지 → UI 타입으로 캐스팅
  const rawMessages = activeSession?.messages ?? [];
  const messages = rawMessages as UiChatMessage[];
  const hasMessages = messages.length > 0;

  // 현재 선택된 필터 기준으로 질문 카드 필터링
  // faqFilter === "all" 인 경우에는 아무 카드도 노출하지 않음
  const filteredFaqItems =
    faqFilter === "all"
      ? []
      : FAQ_ITEMS.filter((item) => item.category === faqFilter);

  // 스크롤 맨 아래로
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages.length]);

  // textarea 자동 높이 조절
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "24px"; // 기본 높이 초기화
    const next = Math.min(el.scrollHeight, 120); // 최대 높이 제한
    el.style.height = `${next}px`;
  }, [inputValue]);

  // 신고 모달 열릴 때 textarea 포커스
  useEffect(() => {
    if (isReportModalOpen && reportTextareaRef.current) {
      reportTextareaRef.current.focus();
    }
  }, [isReportModalOpen]);

  // 메시지 전송
  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;

    onSendMessage(trimmed);
    setInputValue("");
  };

  const handleInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEduClick = () => {
    if (isSending) return;
    onChangeDomain("edu");
    if (onOpenEduPanel) {
      onOpenEduPanel();
    }
  };

  const handleQuizClick = () => {
    if (isSending) return;
    onChangeDomain("quiz");
    if (onOpenQuizPanel) {
      onOpenQuizPanel();
    }
  };

  // 🔹 헤더의 FAQ 칩 클릭 시: 일반 도메인에서 FAQ 도메인으로 전환
  const handleFaqChipClick = () => {
    if (isSending) return;
    onChangeDomain("faq");
  };

  // FAQ 추천 버튼 클릭 시: 같은 세션에 Q/A 추가
  const handleFaqSuggestionClick = (faqId: number) => {
    if (isSending) return;
    if (!onFaqQuickSend) return;

    onFaqQuickSend(faqId);
  };

  // 신고 모달 열기
  const handleOpenReportModal = () => {
    if (isSending) return;
    setReportContent("");
    setIsReportModalOpen(true);
  };

  const handleCloseReportModal = () => {
    setIsReportModalOpen(false);
  };

  // 신고 제출
  const handleSubmitReportClick = () => {
    const trimmed = reportContent.trim();
    if (!trimmed) {
      window.alert("신고 내용을 입력해 주세요.");
      return;
    }

    if (!onReportSubmit || !activeSession) {
      setIsReportModalOpen(false);
      return;
    }

    const payload: ReportPayload = {
      sessionId: activeSession.id,
      content: trimmed,
      createdAt: Date.now(),
    };

    onReportSubmit(payload);
    setIsReportModalOpen(false);
    setReportContent("");
  };

  // FAQ 영역 렌더링 (홈/FAQ 도메인 공통 사용)
  const renderFaqSection = () => (
    <div className="cb-home-faq-section">
      <div className="cb-faq-category-row">
        {FAQ_FILTER_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={
              "cb-faq-category-chip" +
              (faqFilter === key ? " is-active" : "")
            }
            onClick={() =>
              setFaqFilter((prev) => (prev === key ? "all" : key))
            }
            disabled={isSending}
          >
            {FAQ_FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="cb-faq-suggestions">
        {filteredFaqItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="cb-faq-suggestion-btn"
            onClick={() => handleFaqSuggestionClick(item.id)}
            disabled={isSending}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );

  // 공통 메시지 렌더링
  const renderMessages = () => {
    if (!hasMessages && !isSending) return null;

    return (
      <div className="cb-chat-messages">
        {messages.map((msg, index) => {
          const isUser = msg.role === "user";
          const isAssistant = !isUser;

          // 에러 메시지 여부 (현재 에러 문구 기반)
          const isErrorAssistant =
            isAssistant &&
            msg.content.startsWith(
              "죄송합니다. 서버와 통신 중 문제가 발생했어요"
            );

          // 이 assistant 답변의 기준이 되는 user 질문 찾기 (바로 앞쪽 user 메시지)
          let sourceQuestion: string | null = null;
          if (isAssistant) {
            for (let i = index - 1; i >= 0; i -= 1) {
              if (messages[i].role === "user") {
                sourceQuestion = messages[i].content;
                break;
              }
            }
          }

          // kind (신고 안내 말풍선 등)
          const msgKind = msg.kind ?? "normal";
          const isReportSuggestion = msgKind === "reportSuggestion";

          // 이 메시지에 대한 피드백 값 (없으면 null)
          const feedback: FeedbackValue = msg.feedback ?? null;

          return (
            <div
              key={msg.id}
              className={`cb-chat-bubble-row ${
                isUser ? "cb-chat-bubble-row-user" : "cb-chat-bubble-row-bot"
              }`}
            >
              {/* 챗봇 아바타는 디자인상 제거된 상태 */}

              <div
                className={
                  "cb-chat-bubble-container " +
                  (isUser
                    ? "cb-chat-bubble-container-user"
                    : "cb-chat-bubble-container-bot")
                }
              >
                {/* 신고 안내 전용 말풍선: 한 줄에 텍스트 + 버튼 */}
                {isAssistant && isReportSuggestion ? (
                  <div className="cb-chat-bubble cb-chat-bubble-bot cb-chat-bubble-report">
                    <span
                      className="cb-chat-bubble-report-icon"
                      aria-hidden="true"
                    >
                      🔍
                    </span>
                    <span className="cb-chat-bubble-report-text">
                      {msg.content}
                    </span>
                    <button
                      type="button"
                      className="cb-report-suggest-inline-btn"
                      onClick={handleOpenReportModal}
                      disabled={isSending}
                    >
                      신고
                    </button>
                  </div>
                ) : (
                  <>
                    {/* 기본 말풍선 */}
                    <div
                      className={`cb-chat-bubble ${
                        isUser ? "cb-chat-bubble-user" : "cb-chat-bubble-bot"
                      } ${isErrorAssistant ? "cb-chat-bubble-error" : ""}`}
                    >
                      <div className="cb-chat-bubble-text">
                        {msg.content}
                      </div>
                    </div>

                    {/* 일반 assistant 답변 밑에: 피드백 + 다시 시도만 표시 */}
                    {isAssistant && (
                      <div className="cb-chat-bubble-actions">
                        {isErrorAssistant && (
                          <span className="cb-chat-bubble-error-text">
                            네트워크 오류로 실패했어요.
                          </span>
                        )}

                        <div className="cb-chat-actions-icon-group">
                          {/* 좋은 응답 / 별로인 응답 */}
                          <div className="cb-chat-feedback-group">
                            <button
                              type="button"
                              className={`cb-chat-bubble-icon-btn cb-chat-feedback-btn ${
                                feedback === "up" ? "is-selected" : ""
                              }`}
                              onClick={() => {
                                if (!onFeedbackChange) return;
                                const next: FeedbackValue =
                                  feedback === "up" ? null : "up";
                                onFeedbackChange(msg.id, next);
                              }}
                              title="좋은 응답"
                              aria-label="도움이 되었어요"
                              aria-pressed={feedback === "up"}
                            >
                              <img
                                src={feedbackGoodIcon}
                                alt="좋은 응답"
                                className="cb-chat-bubble-action-icon"
                              />
                            </button>

                            <button
                              type="button"
                              className={`cb-chat-bubble-icon-btn cb-chat-feedback-btn ${
                                feedback === "down" ? "is-selected" : ""
                              }`}
                              onClick={() => {
                                if (!onFeedbackChange) return;
                                const next: FeedbackValue =
                                  feedback === "down" ? null : "down";
                                onFeedbackChange(msg.id, next);
                              }}
                              title="별로인 응답"
                              aria-label="별로인 응답이에요"
                              aria-pressed={feedback === "down"}
                            >
                              <img
                                src={feedbackBadIcon}
                                alt="별로인 응답"
                                className="cb-chat-bubble-action-icon"
                              />
                            </button>
                          </div>

                          {/* 다시 시도 버튼만 유지 */}
                          {sourceQuestion && onRetryFromMessage && (
                            <button
                              type="button"
                              className="cb-chat-bubble-icon-btn"
                              onClick={() =>
                                onRetryFromMessage(sourceQuestion, "retry")
                              }
                              disabled={isSending}
                              title="다시 시도"
                              aria-label="다시 시도"
                            >
                              <img
                                src={retryIcon}
                                alt="다시 시도"
                                className="cb-chat-bubble-action-icon"
                              />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* 로딩 중일 때: 타이핑 인디케이터 말풍선 (챗봇 아이콘 제거) */}
        {isSending && (
          <div className="cb-chat-bubble-row cb-chat-bubble-row-bot cb-chat-bubble-row-loading">
            <div className="cb-chat-bubble-container cb-chat-bubble-container-bot">
              <div className="cb-chat-bubble cb-chat-bubble-bot cb-chat-bubble-loading">
                <div className="cb-typing-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // 헤더 타이틀: 일반 = chatbot, FAQ 도메인 = FAQ
  const headerTitle = isFaqDomain ? "FAQ" : "chatbot";
  // 메인(환영 화면)에서는 칩 숨기고, 채팅 메시지가 있는 "채팅방"에서만 칩 표시
  const showHeaderChips = hasMessages;

  return (
    <>
      <main
        className="cb-main"
        style={{ width: "100%", maxWidth: "100%" }}
      >
        <header className="cb-main-header">
          <div className="cb-main-header-row">
            <h2 className="cb-main-title">{headerTitle}</h2>

            {/* 메인 타이틀 우측 칩 – 채팅방(메시지가 있을 때)에서만 표시 */}
            {showHeaderChips && (
              <div className="cb-main-header-chips">
                {/* 🔹 일반 도메인에서만 보이는 FAQ 칩 */}
                {isGeneralDomain && (
                  <button
                    type="button"
                    className="cb-main-chip-btn cb-main-chip-faq"
                    onClick={handleFaqChipClick}
                    disabled={isSending}
                  >
                    FAQ
                  </button>
                )}

                <button
                  type="button"
                  className="cb-main-chip-btn cb-main-chip-edu"
                  onClick={handleEduClick}
                  disabled={isSending}
                >
                  교육
                </button>
                <button
                  type="button"
                  className="cb-main-chip-btn cb-main-chip-quiz"
                  onClick={handleQuizClick}
                  disabled={isSending}
                >
                  퀴즈
                </button>
              </div>
            )}
          </div>
        </header>

        <section className="cb-main-content">
          <div className="cb-chat-scroll">
            {/* 홈 영역: 메시지가 없을 때만 환영 카드 + 퀴즈/교육 + FAQ 노출 */}
            {!hasMessages && (
              <div
                className="cb-feature-container"
                style={{ width: "100%", maxWidth: "100%" }}
              >
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

                {/* 상단 기능 카드: 퀴즈 / 교육 */}
                <div className="cb-feature-row">
                  <button
                    type="button"
                    className="cb-feature-card"
                    onClick={handleQuizClick}
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
                    onClick={handleEduClick}
                  >
                    <img
                      src={eduIcon}
                      alt="교육"
                      className="cb-feature-icon"
                    />
                    <span className="cb-feature-label">교육</span>
                  </button>
                </div>

                {/* 하단: 자주하는 질문 (카테고리 + 질문 버튼) */}
                {renderFaqSection()}
              </div>
            )}

            {/* 실제 채팅 메시지 영역 */}
            {renderMessages()}

            {/* FAQ 도메인일 때: 항상 답변 밑에 카테고리 + 자주하는 질문 카드 노출 */}
            {isFaqDomain && (
              <div className="cb-faq-thread-section">{renderFaqSection()}</div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 하단 입력 영역 (FAQ 채팅방에서는 숨김) */}
          {!isFaqDomain && (
            <div className="cb-input-section">
              {/* 입력 영역 안내 문구 - 중앙 정렬 */}
              <p className="cb-input-title">무엇이든 물어보세요!</p>

              {isSending && (
                <p className="cb-input-hint">답변을 생성하고 있어요…</p>
              )}

              <div
                className={
                  "cb-input-pill" +
                  (isSending ? " cb-input-pill-disabled" : "")
                }
              >
                <button
                  type="button"
                  className="cb-input-plus"
                  disabled={isSending}
                >
                  +
                </button>
                <textarea
                  ref={inputRef}
                  className="cb-input"
                  placeholder=""
                  aria-label="질문 입력"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  disabled={isSending}
                  rows={1}
                />
                <button
                  type="button"
                  className="cb-input-send"
                  onClick={handleSend}
                  disabled={isSending || !inputValue.trim()}
                >
                  <span className="cb-send-icon">▶</span>
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* 신고 모달 */}
      {isReportModalOpen && (
        <div className="cb-report-backdrop">
          <div
            className="cb-report-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cb-report-title"
          >
            <header className="cb-report-header">
              <h3 id="cb-report-title" className="cb-report-title">
                신고하기
              </h3>
              <button
                type="button"
                className="cb-report-close-btn"
                onClick={handleCloseReportModal}
                aria-label="신고 창 닫기"
              >
                ✕
              </button>
            </header>

            <div className="cb-report-body">
              <section className="cb-report-section">
                <div className="cb-report-label-row">
                  <span className="cb-report-pin">📌</span>
                  <span className="cb-report-label">신고유형</span>
                </div>
                <div className="cb-report-types">
                  직장 내 괴롭힘 / 성희롱 / 욕설, 혐오발언 /
                  <br />
                  보안 위반 / 보안 사고 / etc
                </div>
              </section>

              <section className="cb-report-section">
                <div className="cb-report-label-row">
                  <span className="cb-report-pin">📌</span>
                  <span className="cb-report-label">상세 내용 입력</span>
                </div>

                <div className="cb-report-textarea-wrapper">
                  <textarea
                    ref={reportTextareaRef}
                    className="cb-report-textarea"
                    placeholder="신고내용을 입력해주세요.(상황, 시간, 장소, 문제 내용 등)"
                    value={reportContent}
                    onChange={(e) => setReportContent(e.target.value)}
                  />
                </div>
              </section>

              <section className="cb-report-section cb-report-section-guide">
                <div className="cb-report-guide-title-row">
                  <span className="cb-report-guide-icon">⚠️</span>
                  <span className="cb-report-guide-title">안내</span>
                </div>
                <ul className="cb-report-guide-list">
                  <li>허위 신고 시 불이익이 발생할 수 있습니다.</li>
                  <li>제출 후 검토가 진행됩니다.</li>
                </ul>
              </section>
            </div>

            <footer className="cb-report-footer">
              <button
                type="button"
                className="cb-report-btn cb-report-btn-cancel"
                onClick={handleCloseReportModal}
              >
                취소
              </button>
              <button
                type="button"
                className="cb-report-btn cb-report-btn-submit"
                onClick={handleSubmitReportClick}
              >
                제출하기
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatWindow;
