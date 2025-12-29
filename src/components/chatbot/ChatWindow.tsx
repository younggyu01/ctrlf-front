// src/components/chatbot/ChatWindow.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import robotIcon from "../../assets/robot.png";
import quizIcon from "../../assets/quiz.png";
import eduIcon from "../../assets/edu.png";
import adminIcon from "../../assets/admin-dashboard.png";
import reviewIcon from "../../assets/review.png";
import studioIcon from "../../assets/create.png";

// 액션 아이콘
import retryIcon from "../../assets/chat-retry.png"; // 다시 시도 아이콘

// 피드백(좋아요/별로예요) 아이콘
import feedbackGoodIcon from "../../assets/chat-good.png"; // 좋은 응답 아이콘
import feedbackBadIcon from "../../assets/chat-bad.png"; // 별로예요 아이콘

import type {
  ChatDomain,
  ChatSession,
  FeedbackValue,
  ReportPayload,
  ChatServiceDomain,
  FaqHomeItem,
  FaqItem,
} from "../../types/chat";
import { can, getChatHeaderTitle, type UserRole } from "../../auth/roles";

interface ChatWindowProps {
  activeSession: ChatSession | null;
  onSendMessage: (text: string) => void;
  isSending: boolean;
  onChangeDomain: (domain: ChatDomain) => void;
  onOpenEduPanel?: () => void;
  onOpenQuizPanel?: () => void;
  onOpenAdminPanel?: () => void;

  // FAQ: API 기반 (home + top10)
  faqHomeItems?: FaqHomeItem[];
  isFaqHomeLoading?: boolean;
  onRequestFaqTop10?: (domain: ChatServiceDomain) => Promise<FaqItem[]>;

  // FAQ 추천 클릭 → 같은 세션에 Q/A 추가 (ChatbotApp에서 처리)
  onFaqQuickSend?: (faqKey: number | string) => void;

  // 답변 기준 다시 시도 버튼
  onRetryFromMessage?: (sourceQuestion: string, mode: "retry" | "variant") => void;

  // 피드백 업데이트 콜백 (세션 상태 업데이트는 상위에서)
  onFeedbackChange?: (messageId: string, value: FeedbackValue) => void;

  // 신고 모달에서 제출 시
  onReportSubmit?: (payload: ReportPayload) => void;

  // 사용자 Role (관리자 전용 뷰 등 확장용)
  userRole: UserRole;

  onOpenReviewerPanel?: () => void;
  onOpenCreatorPanel?: () => void;
}

// UI에서 사용하는 메시지 타입
interface UiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // 신고 안내/접수 말풍선 같은 특수 메시지 구분용
  kind?: "normal" | "reportSuggestion" | "reportReceipt";
  // 피드백 (좋아요/별로예요)
  feedback?: FeedbackValue;
}

type FaqFilterDomain = ChatServiceDomain | null; // null = HOME(추천)

function toUpperKey(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function normalizeFaqKey(v: string | number): string | number {
  const s = String(v ?? "").trim();
  if (!s) return s;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

/** ===== FAQ HOME 정규화 ===== */
function getFaqHomeLabel(it: FaqHomeItem): string {
  const rec = it as unknown as Record<string, unknown>;
  const candidates = ["label", "title", "question", "q"];
  for (const k of candidates) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "FAQ";
}

function getFaqHomeId(it: FaqHomeItem): string | null {
  const rec = it as unknown as Record<string, unknown>;
  const v = rec["faqId"] ?? rec["id"] ?? rec["key"];
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return s ? s : null;
}

function getFaqHomeDomain(it: FaqHomeItem): ChatServiceDomain | null {
  const rec = it as unknown as Record<string, unknown>;
  const v = rec["domain"];
  const s = typeof v === "string" ? v.trim() : "";
  return s ? (toUpperKey(s) as ChatServiceDomain) : null;
}

/** ===== FAQ TOP10 정규화 ===== */
function getFaqItemId(it: FaqItem): string | null {
  const rec = it as unknown as Record<string, unknown>;
  const v = rec["id"] ?? rec["faqId"] ?? rec["key"];
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return s ? s : null;
}

function getFaqItemQuestion(it: FaqItem): string {
  const rec = it as unknown as Record<string, unknown>;
  const candidates = ["question", "title", "q", "label"];
  for (const k of candidates) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "FAQ";
}

function getFaqItemDomain(it: FaqItem): ChatServiceDomain | null {
  const rec = it as unknown as Record<string, unknown>;
  const v = rec["domain"];
  const s = typeof v === "string" ? v.trim() : "";
  return s ? (toUpperKey(s) as ChatServiceDomain) : null;
}

const FAQ_DOMAIN_LABELS: Record<string, string> = {
  ACCOUNT: "계정",
  APPROVAL: "결재",
  HR: "인사",
  PAY: "급여",
  WELFARE: "복지",
  EDUCATION: "교육",
  IT: "IT",
  SECURITY: "보안",
  FACILITY: "시설",
  ETC: "기타",
};

const FAQ_DOMAIN_KEYS: string[] = [
  "ACCOUNT",
  "APPROVAL",
  "HR",
  "PAY",
  "WELFARE",
  "EDUCATION",
  "IT",
  "SECURITY",
  "FACILITY",
  "ETC",
];

function toServiceDomain(s: string): ChatServiceDomain {
  return s as ChatServiceDomain;
}

type RoleChip = {
  key: "admin" | "reviewer" | "creator";
  label: string;
  className: string;
  onClick: () => void;
};

const ChatWindow: React.FC<ChatWindowProps> = ({
  activeSession,
  onSendMessage,
  isSending,
  onChangeDomain,
  onOpenEduPanel,
  onOpenQuizPanel,
  onOpenAdminPanel,
  faqHomeItems,
  isFaqHomeLoading,
  onRequestFaqTop10,
  onFaqQuickSend,
  onRetryFromMessage,
  onFeedbackChange,
  onReportSubmit,
  userRole,
  onOpenReviewerPanel,
  onOpenCreatorPanel,
}) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // FAQ: 선택된 도메인(없으면 HOME=추천)
  const [faqDomainFilter, setFaqDomainFilter] = useState<FaqFilterDomain>(null);

  // FAQ: 도메인별 top10 캐시(컴포넌트 로컬 UI 캐시)
  const [faqTop10ByDomain, setFaqTop10ByDomain] = useState<Record<string, FaqItem[]>>({});
  const faqTop10ByDomainRef = useRef<Record<string, FaqItem[]>>({});
  useEffect(() => {
    faqTop10ByDomainRef.current = faqTop10ByDomain;
  }, [faqTop10ByDomain]);

  const [faqTop10Loading, setFaqTop10Loading] = useState(false);
  const [faqTop10Error, setFaqTop10Error] = useState<string | null>(null);

  // 신고 모달 상태
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportContent, setReportContent] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const reportTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 세션/도메인 정보
  const currentDomain: ChatDomain = activeSession?.domain ?? "general";
  const isFaqDomain = currentDomain === "faq";
  const isGeneralDomain = currentDomain === "general";

  // Role 정보
  const isAdmin = can(userRole, "OPEN_ADMIN_DASHBOARD");
  const isReviewer = can(userRole, "OPEN_REVIEWER_DESK");
  const isCreator = can(userRole, "OPEN_CREATOR_STUDIO");

  // 홈 상단이 3카드(가운데 역할 카드 포함)인지
  const hasMiddleRoleCard = isAdmin || isReviewer || isCreator;

  // 원본 세션 메시지 → UI 타입으로 캐스팅
  const rawMessages = activeSession?.messages ?? [];
  const messages = rawMessages as UiChatMessage[];
  const hasMessages = messages.length > 0;

  // Streaming UX: 마지막 메시지가 assistant면(상위에서 streaming 업데이트하는 구조일 때) 별도 타이핑 버블을 띄우지 않음
  const hasAssistantTail = useMemo(() => {
    if (!messages.length) return false;
    return messages[messages.length - 1].role === "assistant";
  }, [messages]);

  const showTypingBubble = isSending && !hasAssistantTail;

  // 세션이 바뀌면 FAQ 필터는 HOME로 리셋(UX 안정)
  useEffect(() => {
    setFaqDomainFilter(null);
    setFaqTop10Error(null);
    setFaqTop10Loading(false);
  }, [activeSession?.id]);

  // 스크롤: streaming은 length가 안 변할 수 있으니 "마지막 메시지 content 길이" 기반으로도 내려줌
  const scrollKey = useMemo(() => {
    const last = messages[messages.length - 1];
    const lastId = last?.id ?? "";
    const lastLen = last?.content?.length ?? 0;
    return `${messages.length}:${lastId}:${lastLen}:${isSending ? 1 : 0}`;
  }, [messages, isSending]);

  useEffect(() => {
    if (!messagesEndRef.current) return;
    messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [scrollKey]);

  // textarea 자동 높이 조절
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "24px";
    const next = Math.min(el.scrollHeight, 120);
    el.style.height = `${next}px`;
  }, [inputValue]);

  // 신고 모달 열릴 때 textarea 포커스 + ESC 닫기
  useEffect(() => {
    if (!isReportModalOpen) return;

    const t = window.setTimeout(() => {
      reportTextareaRef.current?.focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsReportModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isReportModalOpen]);

  // ====== 공통 핸들러들 ======

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;

    onSendMessage(trimmed);
    setInputValue("");
  }, [inputValue, isSending, onSendMessage]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleEduClick = useCallback(() => {
    if (isSending) return;
    onChangeDomain("edu");
    onOpenEduPanel?.();
  }, [isSending, onChangeDomain, onOpenEduPanel]);

  const handleQuizClick = useCallback(() => {
    if (isSending) return;
    onChangeDomain("quiz");
    onOpenQuizPanel?.();
  }, [isSending, onChangeDomain, onOpenQuizPanel]);

  const handleOpenAdminDashboard = useCallback(() => {
    if (isSending) return;
    if (!isAdmin) return;
    onOpenAdminPanel?.();
  }, [isSending, isAdmin, onOpenAdminPanel]);

  const handleOpenReviewerDesk = useCallback(() => {
    if (isSending) return;
    if (!isReviewer) return;
    onOpenReviewerPanel?.();
  }, [isSending, isReviewer, onOpenReviewerPanel]);

  const handleOpenCreatorStudio = useCallback(() => {
    if (isSending) return;
    if (!isCreator) return;
    onOpenCreatorPanel?.();
  }, [isSending, isCreator, onOpenCreatorPanel]);

  // ===== 헤더에 표시할 "역할 칩" (관리자/검토/제작) =====
  const roleChips: RoleChip[] = useMemo(() => {
    const arr: RoleChip[] = [];
    if (isAdmin) {
      arr.push({
        key: "admin",
        label: "관리자",
        className: "cb-main-chip-role cb-main-chip-admin",
        onClick: handleOpenAdminDashboard,
      });
    }
    if (isReviewer) {
      arr.push({
        key: "reviewer",
        label: "검토",
        className: "cb-main-chip-role cb-main-chip-reviewer",
        onClick: handleOpenReviewerDesk,
      });
    }
    if (isCreator) {
      arr.push({
        key: "creator",
        label: "제작",
        className: "cb-main-chip-role cb-main-chip-creator",
        onClick: handleOpenCreatorStudio,
      });
    }
    return arr;
  }, [
    isAdmin,
    isReviewer,
    isCreator,
    handleOpenAdminDashboard,
    handleOpenReviewerDesk,
    handleOpenCreatorStudio,
  ]);

  const handleFaqChipClick = useCallback(() => {
    if (isSending) return;
    onChangeDomain("faq");
  }, [isSending, onChangeDomain]);

  const handleGoGeneral = useCallback(() => {
    if (isSending) return;
    onChangeDomain("general");
  }, [isSending, onChangeDomain]);

  // FAQ 추천 버튼 클릭 시: 같은 세션에 Q/A 추가
  const handleFaqSuggestionClick = useCallback(
    (faqKey: number | string) => {
      if (isSending) return;
      if (!onFaqQuickSend) return;
      onFaqQuickSend(faqKey);
    },
    [isSending, onFaqQuickSend]
  );

  // 신고 모달 열기
  const handleOpenReportModal = useCallback(() => {
    if (isSending) return;
    setReportContent("");
    setReportError(null);
    setIsReportModalOpen(true);
  }, [isSending]);

  const handleCloseReportModal = useCallback(() => {
    setIsReportModalOpen(false);
  }, []);

  const handleSubmitReportClick = useCallback(() => {
    const trimmed = reportContent.trim();
    if (!trimmed) {
      setReportError("신고 내용을 입력해 주세요.");
      reportTextareaRef.current?.focus();
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
    setReportError(null);
  }, [reportContent, onReportSubmit, activeSession]);

  // ====== FAQ: 도메인 top10 로딩 ======
  const loadFaqTop10 = useCallback(
    async (domain: ChatServiceDomain) => {
      const key = toUpperKey(domain);
      if (!key) return;

      if (faqTop10ByDomainRef.current[key]?.length) return;
      if (!onRequestFaqTop10) {
        setFaqTop10Error("FAQ 목록 API가 연결되지 않았습니다.");
        return;
      }

      setFaqTop10Loading(true);
      setFaqTop10Error(null);

      try {
        const list = await onRequestFaqTop10(domain);
        const normalized = (Array.isArray(list) ? list : [])
          .map((it) => {
            const id = getFaqItemId(it);
            const question = getFaqItemQuestion(it);
            const d = getFaqItemDomain(it);
            return { raw: it, id, question, domain: d };
          })
          .filter((x) => Boolean(x.id) && Boolean(x.question?.trim()));

        // top10
        const top10 = normalized.slice(0, 10).map((x) => x.raw);
        setFaqTop10ByDomain((prev) => ({ ...prev, [key]: top10 }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setFaqTop10Error(msg || "FAQ 목록을 불러오지 못했습니다.");
      } finally {
        setFaqTop10Loading(false);
      }
    },
    [onRequestFaqTop10]
  );

  // FAQ 도메인 필터 토글 (HOME <-> DOMAIN)
  const handleToggleFaqDomain = useCallback(
    (domain: ChatServiceDomain | null) => {
      if (isSending) return;

      if (domain === null) {
        setFaqDomainFilter(null);
        setFaqTop10Error(null);
        return;
      }

      // 같은 도메인을 다시 누르면 HOME으로
      if (faqDomainFilter && toUpperKey(faqDomainFilter) === toUpperKey(domain)) {
        setFaqDomainFilter(null);
        setFaqTop10Error(null);
        return;
      }

      setFaqDomainFilter(domain);
      void loadFaqTop10(domain);
    },
    [isSending, faqDomainFilter, loadFaqTop10]
  );

  const faqSuggestionButtons = useMemo(() => {
    // HOME: faqHomeItems top10
    if (!faqDomainFilter) {
      const home = Array.isArray(faqHomeItems) ? faqHomeItems.slice(0, 10) : [];
      return {
        mode: "HOME" as const,
        items: home.map((it, idx) => {
          const faqId = getFaqHomeId(it);
          const label = getFaqHomeLabel(it);
          const domain = getFaqHomeDomain(it);
          const stableKey = faqId ? `home:${faqId}` : `home:${idx}:${label}`;
          return { key: stableKey, faqId, label, domain };
        }),
      };
    }

    // DOMAIN: top10 list
    const domainKey = toUpperKey(faqDomainFilter);
    const list = faqTop10ByDomain[domainKey] ?? [];
    return {
      mode: "DOMAIN" as const,
      items: list.map((it, idx) => {
        const id = getFaqItemId(it) ?? `d:${domainKey}:${idx}`;
        const label = getFaqItemQuestion(it);
        const domain = getFaqItemDomain(it);
        return { key: `top:${id}`, faqId: id, label, domain };
      }),
    };
  }, [faqDomainFilter, faqHomeItems, faqTop10ByDomain]);

  // FAQ 영역 렌더링 (홈/FAQ 도메인 공통 사용)
  const renderFaqSection = () => {
    const homeLoading = Boolean(isFaqHomeLoading);
    const showHome = !faqDomainFilter;

    const showLoadingRow = showHome ? homeLoading : faqTop10Loading;
    const showErrorText = Boolean(faqTop10Error);

    return (
      <div className="cb-home-faq-section">
        <div className="cb-faq-category-row">
          {/* HOME(추천) */}
          <button
            type="button"
            className={"cb-faq-category-chip" + (!faqDomainFilter ? " is-active" : "")}
            onClick={() => handleToggleFaqDomain(null)}
            disabled={isSending}
          >
            추천
          </button>

          {/* 도메인 칩 */}
          {FAQ_DOMAIN_KEYS.map((k) => {
            const sd = toServiceDomain(k);
            const label = FAQ_DOMAIN_LABELS[k] ?? k;
            const active = faqDomainFilter && toUpperKey(faqDomainFilter) === k;
            return (
              <button
                key={k}
                type="button"
                className={"cb-faq-category-chip" + (active ? " is-active" : "")}
                onClick={() => handleToggleFaqDomain(sd)}
                disabled={isSending}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="cb-faq-suggestions">
          {showLoadingRow && (
            <>
              <button type="button" className="cb-faq-suggestion-btn" disabled>
                FAQ를 불러오는 중…
              </button>
              <button type="button" className="cb-faq-suggestion-btn" disabled>
                잠시만 기다려 주세요…
              </button>
            </>
          )}

          {!showLoadingRow && showErrorText && (
            <button type="button" className="cb-faq-suggestion-btn" disabled>
              {faqTop10Error}
            </button>
          )}

          {!showLoadingRow &&
            !showErrorText &&
            faqSuggestionButtons.items.map((it) => {
              const faqId = it.faqId;
              const disabled = isSending || !faqId;

              return (
                <button
                  key={it.key}
                  type="button"
                  className="cb-faq-suggestion-btn"
                  onClick={() => {
                    if (!faqId) return;
                    handleFaqSuggestionClick(normalizeFaqKey(faqId));
                  }}
                  disabled={disabled}
                  title={it.label}
                  aria-label={it.label}
                >
                  {it.label}
                </button>
              );
            })}

          {!showLoadingRow && !showErrorText && faqSuggestionButtons.items.length === 0 && (
            <button type="button" className="cb-faq-suggestion-btn" disabled>
              표시할 FAQ가 없습니다.
            </button>
          )}
        </div>
      </div>
    );
  };

  // 공통 메시지 렌더링
  const renderMessages = () => {
    if (!messages.length && !isSending) return null;

    return (
      <div className="cb-chat-messages">
        {messages.map((msg, index) => {
          const isUser = msg.role === "user";
          const isAssistant = !isUser;

          const isErrorAssistant =
            isAssistant &&
            msg.content.startsWith("죄송합니다. 서버와 통신 중 문제가 발생했어요");

          // Streaming 상태: 마지막 assistant 메시지는 전송 중일 때 “스트리밍 말풍선”로 표시
          const isStreaming = isAssistant && isSending && index === messages.length - 1;

          // 이 assistant 답변의 기준이 되는 user 질문 찾기
          let sourceQuestion: string | null = null;
          if (isAssistant) {
            for (let i = index - 1; i >= 0; i -= 1) {
              if (messages[i].role === "user") {
                sourceQuestion = messages[i].content;
                break;
              }
            }
          }

          const msgKind = msg.kind ?? "normal";
          const isReportSuggestion = msgKind === "reportSuggestion";
          const isReportReceipt = msgKind === "reportReceipt";

          const feedback: FeedbackValue = msg.feedback ?? null;

          // 피드백/재시도는 “스트리밍 중인 마지막 답변”에는 노출/동작 금지
          const allowActions = isAssistant && !isStreaming;

          return (
            <div
              key={msg.id}
              className={`cb-chat-bubble-row ${
                isUser ? "cb-chat-bubble-row-user" : "cb-chat-bubble-row-bot"
              }`}
            >
              <div
                className={
                  "cb-chat-bubble-container " +
                  (isUser
                    ? "cb-chat-bubble-container-user"
                    : "cb-chat-bubble-container-bot")
                }
              >
                {isAssistant && isReportSuggestion ? (
                  <div className="cb-chat-bubble cb-chat-bubble-bot cb-chat-bubble-report">
                    <span className="cb-chat-bubble-report-icon" aria-hidden="true">
                      🔍
                    </span>
                    <span className="cb-chat-bubble-report-text">{msg.content}</span>
                    <button
                      type="button"
                      className="cb-report-suggest-inline-btn"
                      onClick={handleOpenReportModal}
                      disabled={isSending}
                    >
                      신고
                    </button>
                  </div>
                ) : isAssistant && isReportReceipt ? (
                  <div className="cb-chat-bubble cb-chat-bubble-bot cb-chat-bubble-receipt">
                    <span className="cb-chat-bubble-receipt-icon" aria-hidden="true">
                      ✅
                    </span>
                    <span className="cb-chat-bubble-receipt-text">{msg.content}</span>
                  </div>
                ) : (
                  <>
                    <div
                      className={[
                        "cb-chat-bubble",
                        isUser ? "cb-chat-bubble-user" : "cb-chat-bubble-bot",
                        isErrorAssistant ? "cb-chat-bubble-error" : "",
                        isStreaming ? "cb-chat-bubble-streaming" : "",
                      ].join(" ")}
                    >
                      <div className="cb-chat-bubble-text">
                        {msg.content}
                        {isStreaming && <span className="cb-streaming-caret" aria-hidden="true" />}
                      </div>
                    </div>

                    {allowActions && (
                      <div className="cb-chat-bubble-actions">
                        {isErrorAssistant && (
                          <span className="cb-chat-bubble-error-text">
                            네트워크 오류로 실패했어요.
                          </span>
                        )}

                        <div className="cb-chat-actions-icon-group">
                          <div className="cb-chat-feedback-group">
                            <button
                              type="button"
                              className={`cb-chat-bubble-icon-btn cb-chat-feedback-btn ${
                                feedback === "up" ? "is-selected" : ""
                              }`}
                              onClick={() => {
                                if (!onFeedbackChange) return;
                                const next: FeedbackValue = feedback === "up" ? null : "up";
                                onFeedbackChange(msg.id, next);
                              }}
                              title="좋은 응답"
                              aria-label="도움이 되었어요"
                              aria-pressed={feedback === "up"}
                              disabled={!onFeedbackChange}
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
                              disabled={!onFeedbackChange}
                            >
                              <img
                                src={feedbackBadIcon}
                                alt="별로인 응답"
                                className="cb-chat-bubble-action-icon"
                              />
                            </button>
                          </div>

                          {sourceQuestion && onRetryFromMessage && (
                            <button
                              type="button"
                              className="cb-chat-bubble-icon-btn"
                              onClick={() => onRetryFromMessage(sourceQuestion, "retry")}
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

        {showTypingBubble && (
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

  // 헤더 타이틀
  const headerTitle = isFaqDomain ? "FAQ" : getChatHeaderTitle(userRole);

  // 메인(환영 화면)에서는 칩 숨기고, 채팅 메시지가 있는 "채팅방"에서만 칩 표시
  const showHeaderChips = hasMessages;

  return (
    <>
      <main className="cb-main">
        <header className="cb-main-header">
          <div className="cb-main-header-row">
            <h2 className="cb-main-title">{headerTitle}</h2>

            {showHeaderChips && (
              <div className="cb-main-header-chips">
                {roleChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={`cb-main-chip-btn ${chip.className}`}
                    onClick={chip.onClick}
                    disabled={isSending}
                    title={chip.label}
                    aria-label={`${chip.label} 화면 열기`}
                  >
                    {chip.label}
                  </button>
                ))}

                {/* FAQ 도메인에서는 “일반(챗봇)” 복귀 칩 제공 */}
                {isFaqDomain ? (
                  <button
                    type="button"
                    className="cb-main-chip-btn cb-main-chip-general"
                    onClick={handleGoGeneral}
                    disabled={isSending}
                  >
                    챗봇
                  </button>
                ) : (
                  isGeneralDomain && (
                    <button
                      type="button"
                      className="cb-main-chip-btn cb-main-chip-faq"
                      onClick={handleFaqChipClick}
                      disabled={isSending}
                    >
                      FAQ
                    </button>
                  )
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
            {/* 홈 영역: 메시지가 없을 때만 환영 카드 + 퀴즈/교육(+역할) + FAQ 노출 */}
            {!hasMessages && (
              <div className="cb-feature-container">
                <div className="cb-welcome-row">
                  <img src={robotIcon} alt="챗봇 아이콘" className="cb-welcome-icon" />
                  <div className="cb-welcome-text">
                    <p>안녕하세요.</p>
                    <p>Ctrl F의 챗봇(BlinQ)이 서비스를 시작합니다.</p>
                  </div>
                </div>

                <div
                  className={
                    "cb-feature-row" + (hasMiddleRoleCard ? " cb-feature-row--admin" : "")
                  }
                >
                  <button type="button" className="cb-feature-card" onClick={handleQuizClick}>
                    <img src={quizIcon} alt="퀴즈" className="cb-feature-icon" />
                    <span className="cb-feature-label">퀴즈</span>
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      className="cb-feature-card cb-feature-card-admin"
                      onClick={handleOpenAdminDashboard}
                      disabled={isSending}
                    >
                      <img src={adminIcon} alt="관리자 대시보드" className="cb-feature-icon" />
                      <span className="cb-feature-label">관리자</span>
                    </button>
                  )}

                  {isReviewer && (
                    <button
                      type="button"
                      className="cb-feature-card cb-feature-card-role"
                      onClick={handleOpenReviewerDesk}
                      disabled={isSending}
                    >
                      <img src={reviewIcon} alt="콘텐츠 검토" className="cb-feature-icon" />
                      <span className="cb-feature-label">검토</span>
                    </button>
                  )}

                  {isCreator && (
                    <button
                      type="button"
                      className="cb-feature-card cb-feature-card-role"
                      onClick={handleOpenCreatorStudio}
                      disabled={isSending}
                    >
                      <img src={studioIcon} alt="교육 콘텐츠 제작" className="cb-feature-icon" />
                      <span className="cb-feature-label">제작</span>
                    </button>
                  )}

                  <button type="button" className="cb-feature-card" onClick={handleEduClick}>
                    <img src={eduIcon} alt="교육" className="cb-feature-icon" />
                    <span className="cb-feature-label">교육</span>
                  </button>
                </div>

                {/* 하단: 자주하는 질문 (API: home + top10) */}
                {renderFaqSection()}
              </div>
            )}

            {renderMessages()}

            {/* FAQ 도메인일 때: 스레드 하단에 카테고리 + 추천/top10 노출 */}
            {isFaqDomain && <div className="cb-faq-thread-section">{renderFaqSection()}</div>}

            <div ref={messagesEndRef} />
          </div>

          {/* 하단 입력 영역 (FAQ 채팅방에서는 숨김) */}
          {!isFaqDomain && (
            <div className="cb-input-section">
              <p className="cb-input-title">무엇이든 물어보세요!</p>

              {isSending && <p className="cb-input-hint">답변을 생성하고 있어요…</p>}

              <div className={"cb-input-pill" + (isSending ? " cb-input-pill-disabled" : "")}>
                <button type="button" className="cb-input-plus" disabled={isSending}>
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
        <div
          className="cb-report-backdrop"
          onMouseDown={(e) => {
            // backdrop 클릭 닫기(모달 바디 클릭은 유지)
            if (e.target === e.currentTarget) handleCloseReportModal();
          }}
        >
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
                  직장 내 괴롭힘 / 성희롱 / 욕설, 혐오발언 /<br />
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
                    onChange={(e) => {
                      setReportContent(e.target.value);
                      if (reportError) setReportError(null);
                    }}
                    onKeyDown={(e) => {
                      // 제품 UX: Ctrl+Enter 제출
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        handleSubmitReportClick();
                      }
                    }}
                  />
                </div>

                {reportError && <div className="cb-report-error-text">{reportError}</div>}
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
                disabled={!reportContent.trim()}
                title={!reportContent.trim() ? "신고 내용을 입력해 주세요." : "제출"}
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
