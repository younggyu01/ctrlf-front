// src/components/chatbot/ChatWindow.tsx
import React, { useEffect, useRef, useState } from "react";
import robotIcon from "../../assets/robot.png";
import ruleIcon from "../../assets/rule.png";
import faqIcon from "../../assets/faq.png";
import quizIcon from "../../assets/quiz.png";
import eduIcon from "../../assets/edu.png";

// 액션 아이콘 3개 (파일명은 네가 저장한 이름대로 맞춰서 변경해도 됨)
import copyIcon from "../../assets/chat-copy.png";    // 복사 아이콘(3번째)
import retryIcon from "../../assets/chat-retry.png";  // 다시 시도 아이콘(2번째)
import variantIcon from "../../assets/chat-variant.png"; // 다른 답변 아이콘(1번째)

import type { ChatDomain, ChatSession } from "../../types/chat";
import { FAQ_ITEMS } from "./faqData";

interface ChatWindowProps {
  activeSession: ChatSession | null;
  onSendMessage: (text: string) => void;
  isSending: boolean;
  onChangeDomain: (domain: ChatDomain) => void;
  onOpenEduPanel?: () => void;
  onOpenQuizPanel?: () => void;
  onFaqQuickSend?: (faqId: number) => void;
  onPolicyQuickExplain?: (
    ruleId: string,
    title: string,
    summary: string
  ) => void;
  panelWidth?: number;
  // 답변 기준 다시 시도 / 다른 답변 버튼
  onRetryFromMessage?: (
    sourceQuestion: string,
    mode: "retry" | "variant"
  ) => void;
}

type ViewKey = "home" | "policy" | "faq";

type PolicyCategory = {
  id: string;
  name: string;
  description: string;
};

type PolicyRule = {
  id: string;
  categoryId: string;
  title: string;
  summary: string;
  badge?: "중요" | "필수" | "신규";
};

const POLICY_CATEGORIES: PolicyCategory[] = [
  {
    id: "hr",
    name: "인사 · 근태",
    description: "근무시간, 휴가, 재택근무 등 인사/근태 관련 규정",
  },
  {
    id: "ethics",
    name: "직장 내 괴롭힘 · 성희롱",
    description: "괴롭힘·성희롱 예방 및 신고·조치 절차",
  },
  {
    id: "security",
    name: "정보보안",
    description: "비밀번호, 계정 공유, 자료 반출 등 보안 관련 규정",
  },
  {
    id: "compliance",
    name: "준법 · 공정거래",
    description: "법령 준수, 공정거래, 이해상충 방지에 대한 규정",
  },
];

const POPULAR_RULES: PolicyRule[] = [
  {
    id: "rule-flex",
    categoryId: "hr",
    title: "유연근무제 운영 기준",
    summary:
      "시차출퇴근, 재택근무 등 유연근무 신청 및 승인 절차를 정리한 규정입니다.",
    badge: "신규",
  },
  {
    id: "rule-vacation",
    categoryId: "hr",
    title: "연차/반차 사용 원칙",
    summary:
      "연차/반차 신청 기한, 사용 순서, 사용 권장 기간 등 기본 원칙을 안내합니다.",
  },
  {
    id: "rule-harassment",
    categoryId: "ethics",
    title: "직장 내 괴롭힘 예방 규정",
    summary:
      "직장 내 괴롭힘의 정의, 금지 행위, 신고 및 조사 절차를 규정합니다.",
    badge: "필수",
  },
];

const IMPORTANT_RULES: PolicyRule[] = [
  {
    id: "rule-security",
    categoryId: "security",
    title: "정보보안 기본 수칙",
    summary:
      "사내 계정/비밀번호 관리, PC 잠금, 자료 반출·반입 시 준수 사항입니다.",
    badge: "중요",
  },
  {
    id: "rule-it-asset",
    categoryId: "security",
    title: "IT 자산 관리 규정",
    summary:
      "노트북, 모바일, 저장장치 등 IT 자산 분실/파손 시 보고 및 처리 절차입니다.",
  },
  {
    id: "rule-sexual",
    categoryId: "ethics",
    title: "성희롱 예방 및 신고 절차",
    summary:
      "성희롱의 예시, 신고 채널, 보호 조치 및 2차 피해 방지 원칙을 정의합니다.",
    badge: "필수",
  },
];

const ChatWindow: React.FC<ChatWindowProps> = ({
  activeSession,
  onSendMessage,
  isSending,
  onChangeDomain,
  onOpenEduPanel,
  onOpenQuizPanel,
  onFaqQuickSend,
  onPolicyQuickExplain,
  panelWidth,
  onRetryFromMessage,
}) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const messages = activeSession?.messages ?? [];
  const hasMessages = messages.length > 0;

  const sessionDomain = activeSession?.domain;

  // 세션의 domain 값으로 뷰를 바로 계산
  const activeView: ViewKey =
    sessionDomain === "policy"
      ? "policy"
      : sessionDomain === "faq"
      ? "faq"
      : "home";

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

  // 메시지 전송 (뷰 전환 X, domain에 따라 뷰 유지)
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

  const handleFeatureClick = (targetDomain: ChatDomain) => {
    if (isSending) return;
    onChangeDomain(targetDomain);
    // domain만 바꾸면, 위에서 activeView가 알아서 policy/faq로 바뀜
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

  // FAQ 추천 버튼 클릭 시: 같은 세션에 Q/A 추가 + FAQ 화면 유지
  const handleFaqSuggestionClick = (faqId: number) => {
    if (isSending) return;
    if (!onFaqQuickSend) return;

    onFaqQuickSend(faqId);
  };

  // 규정 카드 클릭 시: policy 화면 유지 + 아래 채팅만 추가
  const handlePolicyRuleClick = (rule: PolicyRule) => {
    if (isSending) return;

    if (onPolicyQuickExplain) {
      onPolicyQuickExplain(rule.id, rule.title, rule.summary);
    }
  };

  // 답변 내용 복사
  const handleCopyMessage = async (content: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        // 구형 브라우저용 fallback
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      // 나중에 토스트 붙이면 여기서 호출 가능
      // showToast("답변이 복사되었습니다.");
    } catch (err) {
      console.error("copy failed", err);
    }
  };

  // 패널 폭에 따라 규정 카드 폭 단계 조절
  let policyWidthClass = "cb-policy-view";
  if (panelWidth && panelWidth >= 1200) {
    policyWidthClass += " cb-policy-view-xl";
  } else if (panelWidth && panelWidth >= 900) {
    policyWidthClass += " cb-policy-view-lg";
  }

  const renderPolicyView = () => (
    <div className={policyWidthClass}>
      <div className="cb-policy-header">
        <div className="cb-policy-header-icon">
          <img src={ruleIcon} alt="규정 아이콘" />
        </div>
        <div className="cb-policy-header-text">
          <p className="cb-policy-header-line">사내 규정 안내</p>
          <p className="cb-policy-header-line cb-policy-header-line-strong">
            자주 확인하는 규정을 한 번에 모았습니다.
          </p>
        </div>
      </div>

      <div className="cb-policy-layout">
        {/* 좌측: 카테고리 + 규정 리스트 */}
        <div className="cb-policy-left">
          <section className="cb-policy-section">
            <h4 className="cb-policy-section-title">규정 카테고리</h4>
            <p className="cb-policy-section-desc">
              자주 사용하는 인사, 보안, 직장 내 괴롭힘 관련 규정을 카테고리별로
              모아두었습니다.
            </p>
            <div className="cb-policy-category-list">
              {POLICY_CATEGORIES.map((cat) => (
                <div key={cat.id} className="cb-policy-category-card">
                  <div className="cb-policy-category-name">{cat.name}</div>
                  <div className="cb-policy-category-desc">
                    {cat.description}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="cb-policy-section">
            <h4 className="cb-policy-section-title">최근 많이 본 규정</h4>
            <ul className="cb-policy-rule-list">
              {POPULAR_RULES.map((rule) => (
                <li key={rule.id}>
                  <button
                    type="button"
                    className="cb-policy-rule-item"
                    onClick={() => handlePolicyRuleClick(rule)}
                  >
                    <div className="cb-policy-rule-text">
                      <span className="cb-policy-rule-title">
                        {rule.title}
                      </span>
                      <span className="cb-policy-rule-summary">
                        {rule.summary}
                      </span>
                    </div>
                    {rule.badge && (
                      <span className="cb-policy-rule-badge">
                        {rule.badge}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="cb-policy-section">
            <h4 className="cb-policy-section-title">중요 공지된 규정</h4>
            <ul className="cb-policy-rule-list">
              {IMPORTANT_RULES.map((rule) => (
                <li key={rule.id}>
                  <button
                    type="button"
                    className="cb-policy-rule-item"
                    onClick={() => handlePolicyRuleClick(rule)}
                  >
                    <div className="cb-policy-rule-text">
                      <span className="cb-policy-rule-title">
                        {rule.title}
                      </span>
                      <span className="cb-policy-rule-summary">
                        {rule.summary}
                      </span>
                    </div>
                    {rule.badge && (
                      <span className="cb-policy-rule-badge cb-policy-rule-badge-accent">
                        {rule.badge}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );

  const renderFaqView = () => (
    <div className="cb-faq-view">
      <div className="cb-faq-header">
        <div className="cb-faq-icon">
          <img src={robotIcon} alt="챗봇 아이콘" />
        </div>
        <div className="cb-faq-header-text">
          <p className="cb-faq-header-line">사용자가 가장 많이 묻는 질문 기반</p>
          <p className="cb-faq-header-line cb-faq-header-line-strong">
            FAQ입니다.
          </p>
        </div>
      </div>

      <div className="cb-faq-divider" />

      <div className="cb-faq-suggestions">
        {FAQ_ITEMS.map((item) => (
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

          return (
            <div
              key={msg.id}
              className={`cb-chat-bubble-row ${
                isUser ? "cb-chat-bubble-row-user" : "cb-chat-bubble-row-bot"
              }`}
            >
              {!isUser && (
                <div className="cb-chat-avatar">
                  <img src={robotIcon} alt="챗봇" />
                </div>
              )}

              <div
                className={
                  "cb-chat-bubble-container " +
                  (isUser
                    ? "cb-chat-bubble-container-user"
                    : "cb-chat-bubble-container-bot")
                }
              >
                <div
                  className={`cb-chat-bubble ${
                    isUser ? "cb-chat-bubble-user" : "cb-chat-bubble-bot"
                  } ${isErrorAssistant ? "cb-chat-bubble-error" : ""}`}
                >
                  <div className="cb-chat-bubble-text">{msg.content}</div>
                </div>

                {/* assistant 답변 밑에: 복사 / 다시 시도 / 다른 답변 아이콘 */}
                {isAssistant && (
                  <div className="cb-chat-bubble-actions">
                    {isErrorAssistant && (
                      <span className="cb-chat-bubble-error-text">
                        네트워크 오류로 실패했어요.
                      </span>
                    )}

                    {/* 복사 아이콘 (항상 노출) */}
                    <button
                      type="button"
                      className="cb-chat-bubble-action-btn"
                      onClick={() => handleCopyMessage(msg.content)}
                      disabled={isSending}
                      title="답변 복사"
                      aria-label="답변 복사"
                    >
                      <img
                        src={copyIcon}
                        alt="답변 복사"
                        className="cb-chat-bubble-action-icon"
                      />
                    </button>

                    {/* 다시 시도 / 다른 답변은 sourceQuestion + onRetryFromMessage 있을 때만 */}
                    {sourceQuestion && onRetryFromMessage && (
                      <>
                        <button
                          type="button"
                          className="cb-chat-bubble-action-btn"
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

                        <button
                          type="button"
                          className="cb-chat-bubble-action-btn"
                          onClick={() =>
                            onRetryFromMessage(sourceQuestion, "variant")
                          }
                          disabled={isSending}
                          title="다른 답변"
                          aria-label="다른 답변"
                        >
                          <img
                            src={variantIcon}
                            alt="다른 답변"
                            className="cb-chat-bubble-action-icon"
                          />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* 로딩 중일 때: 타이핑 인디케이터 말풍선 */}
        {isSending && (
          <div className="cb-chat-bubble-row cb-chat-bubble-row-bot cb-chat-bubble-row-loading">
            <div className="cb-chat-avatar">
              <img src={robotIcon} alt="챗봇" />
            </div>
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

  return (
    <main className="cb-main">
      <header className="cb-main-header">
        <h2 className="cb-main-title">chatbot</h2>
      </header>

      <section className="cb-main-content">
        <div className="cb-chat-scroll">
          {/* 홈 뷰: 환영 카드 + 메시지 */}
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
                      onClick={() => handleFeatureClick("policy")}
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
                      onClick={() => handleFeatureClick("faq")}
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
                </div>
              )}

              {renderMessages()}
            </>
          )}

          {/* 규정 뷰: 위에는 규정 카드, 아래에는 채팅 말풍선 */}
          {activeView === "policy" && (
            <>
              {renderPolicyView()}
              {renderMessages()}
            </>
          )}

          {/* FAQ 뷰: 위에는 FAQ 카드, 아래에는 채팅 말풍선 */}
          {activeView === "faq" && (
            <>
              {renderFaqView()}
              {renderMessages()}
            </>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 하단 입력 영역 (어느 뷰에서든 공통) */}
        <div className="cb-input-section">
          {/* 로딩 중일 때만 안내 문구 표시 */}
          {isSending && (
            <p className="cb-input-hint">답변을 생성하고 있어요…</p>
          )}

          <div
            className={
              "cb-input-pill" + (isSending ? " cb-input-pill-disabled" : "")
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
              placeholder="" // placeholder 문구 완전 제거
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
      </section>
    </main>
  );
};

export default ChatWindow;
