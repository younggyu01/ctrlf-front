// src/components/chatbot/ChatbotApp.tsx

import React, { useEffect, useRef, useState } from "react";
import "./chatbot.css";
import Sidebar from "./Sidebar";
import ChatWindow from "./ChatWindow";
import { sendChatToAI, sendFeedbackToAI } from "./chatApi";
import {
  type ChatDomain,
  type ChatMessage,
  type ChatSession,
  type SidebarSessionSummary,
  type ChatRequest,
  type FeedbackValue,
  type ReportPayload,
} from "../../types/chat";
import {
  computePanelPosition,
  buildLastMessagePreview,
  buildSessionTitleFromMessage,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";
import { FAQ_ITEMS } from "./faqData";

interface ChatbotAppProps {
  onClose: () => void;
  anchor?: Anchor | null;
  animationState?: "opening" | "closing";
  onAnimationEnd?: () => void;
  onOpenEduPanel?: () => void;
  onOpenQuizPanel?: (quizId?: string) => void;
  onOpenAdminPanel?: () => void;
  // Layout → FloatingChatbotRoot → 여기까지 전달되는 사용자 Role
  userRole: UserRole;
  onRequestFocus?: () => void;
}

type Size = PanelSize;

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

type RetryMode = "retry" | "variant";

const MIN_WIDTH = 520;
const MIN_HEIGHT = 480;
const INITIAL_SIZE: Size = { width: 550, height: 550 };

// 최대 세션 개수 (FIFO 기준)
const MAX_SESSIONS = 30;

// 초기 세션 한 개 ("새 채팅")
const initialSessions: ChatSession[] = [
  {
    id: "session-1",
    title: "새 채팅",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    domain: "general",
    messages: [],
  },
];

// ✅ 사용자 Role 타입 (Layout/FloatingChatbotRoot와 동일하게 유지)
type UserRole = "SYSTEM_ADMIN" | "EMPLOYEE";

// "신고하고싶어", "괴롭힘을 신고하고 싶어요" 같은 문장을 잡아주는 간단한 헬퍼
function shouldSuggestReport(raw: string): boolean {
  const compact = raw.replace(/\s+/g, ""); // 공백 제거

  const keywords = [
    "신고하고싶어",
    "신고하고싶어요",
    "신고하고싶은데",
    "괴롭힘신고",
    "괴롭힘을신고",
    "성희롱신고",
    "성희롱을신고",
  ];

  if (keywords.some((k) => compact.includes(k))) return true;

  // "괴롭힘 ... 신고", "성희롱 ... 신고" 패턴도 허용
  if (compact.includes("괴롭힘") && compact.includes("신고")) return true;
  if (compact.includes("성희롱") && compact.includes("신고")) return true;

  return false;
}

const ChatbotApp: React.FC<ChatbotAppProps> = ({
  onClose,
  anchor,
  animationState,
  onAnimationEnd,
  onOpenEduPanel,
  onOpenQuizPanel,
  onOpenAdminPanel,
  userRole,
  onRequestFocus,
}) => {
  // 패널 크기 + 위치
  const [size, setSize] = useState<Size>(INITIAL_SIZE);
  const [panelPos, setPanelPos] = useState(() =>
    computePanelPosition(anchor ?? null, INITIAL_SIZE)
  );

  // 사이드바 접힘 상태
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // 세션 목록 + 현재 선택된 세션
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessions[0]?.id ?? null
  );

  // 검색어
  const [searchTerm, setSearchTerm] = useState("");

  // 전송 중 상태
  const [isSending, setIsSending] = useState(false);

  const resizeRef = useRef<ResizeState>({
    resizing: false,
    dir: null,
    startX: 0,
    startY: 0,
    startWidth: INITIAL_SIZE.width,
    startHeight: INITIAL_SIZE.height,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  const dragRef = useRef<DragState>({
    dragging: false,
    startX: 0,
    startY: 0,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  // 애니메이션용 래퍼
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // transform-origin (아이콘 위치 기준)
  let transformOrigin = "85% 100%";
  if (anchor) {
    const relX = ((anchor.x - panelPos.left) / size.width) * 100;
    const relY = ((anchor.y - panelPos.top) / size.height) * 100;
    const originX = Math.max(-50, Math.min(150, relX));
    const originY = Math.max(-50, Math.min(150, relY));
    transformOrigin = `${originX}% ${originY}%`;
  }

  // 세션은 있는데 activeSessionId 가 null 이면 자동으로 첫 세션을 활성화
  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  // ====== 리사이즈 + 드래그 공통 처리 ======
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      const margin = 16;
      const padding = 32;

      // 1) 리사이즈 중이면 리사이즈 우선 처리
      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - padding * 2);
        const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - padding * 2);

        const {
          startWidth,
          startHeight,
          startTop,
          startLeft,
          dir,
        } = resizeState;

        let width = startWidth;
        let height = startHeight;
        let top = startTop;
        let left = startLeft;

        // 오른쪽/아래
        if (dir.includes("e")) {
          width = startWidth + dx;
        }
        if (dir.includes("s")) {
          height = startHeight + dy;
        }

        // 왼쪽/위쪽
        if (dir.includes("w")) {
          width = startWidth - dx;
          left = startLeft + dx;
        }
        if (dir.includes("n")) {
          height = startHeight - dy;
          top = startTop + dy;
        }

        // 크기 클램프
        width = Math.max(MIN_WIDTH, Math.min(maxWidth, width));
        height = Math.max(MIN_HEIGHT, Math.min(maxHeight, height));

        // 위치 클램프
        const maxLeft = window.innerWidth - margin - width;
        const maxTop = window.innerHeight - margin - height;

        left = Math.max(margin, Math.min(maxLeft, left));
        top = Math.max(margin, Math.min(maxTop, top));

        setSize({ width, height });
        setPanelPos({ top, left });
        return;
      }

      // 2) 리사이즈가 아니면 드래그 처리
      if (dragState.dragging) {
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        let top = dragState.startTop + dy;
        let left = dragState.startLeft + dx;

        const maxLeft = window.innerWidth - margin - size.width;
        const maxTop = window.innerHeight - margin - size.height;

        left = Math.max(margin, Math.min(maxLeft, left));
        top = Math.max(margin, Math.min(maxTop, top));

        setPanelPos({ top, left });
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
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [size.width, size.height]);

  // ✅ 창 리사이즈 시 챗봇 패널 크기/위치를 화면 안으로 보정
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleWindowResize = () => {
      const margin = 16;
      const padding = 32;

      const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - padding * 2);
      const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - padding * 2);

      setSize((prevSize) => {
        const width = Math.min(prevSize.width, maxWidth);
        const height = Math.min(prevSize.height, maxHeight);

        setPanelPos((prevPos) => {
          const maxLeft = window.innerWidth - margin - width;
          const maxTop = window.innerHeight - margin - height;

          let left = prevPos.left;
          let top = prevPos.top;

          left = Math.max(margin, Math.min(maxLeft, left));
          top = Math.max(margin, Math.min(maxTop, top));

          return { top, left };
        });

        return { width, height };
      });
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  // 리사이즈 시작
  const handleResizeMouseDown =
    (dir: ResizeDirection) =>
      (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();

        resizeRef.current = {
          resizing: true,
          dir,
          startX: event.clientX,
          startY: event.clientY,
          startWidth: size.width,
          startHeight: size.height,
          startTop: panelPos.top,
          startLeft: panelPos.left,
        };
        // 드래그 중이던 것도 끊어주기
        dragRef.current.dragging = false;
      };

  // 드래그 시작 (상단 드래그 바)
  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    // 닫기 버튼/리사이즈 핸들 클릭일 경우는 각자 onMouseDown에서 stopPropagation 했으니 여기 안 들어옴
    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: panelPos.top,
      startLeft: panelPos.left,
    };
    // 리사이즈 중이던 것도 끊기
    resizeRef.current.resizing = false;
    resizeRef.current.dir = null;
  };

  // 새 채팅 (최대 30개, FIFO 삭제)
  const handleNewChat = () => {
    const now = Date.now();

    const newSession: ChatSession = {
      id: `session-${now}`,
      title: "새 채팅",
      createdAt: now,
      updatedAt: now,
      domain: "general",
      messages: [],
    };

    setSessions((prev) => {
      const nextSessions = [...prev];

      // 최대 개수(30개)에 도달한 경우 → 가장 오래된 세션 삭제 (FIFO, createdAt 기준)
      if (nextSessions.length >= MAX_SESSIONS) {
        let oldestIndex = 0;
        for (let i = 1; i < nextSessions.length; i += 1) {
          if (nextSessions[i].createdAt < nextSessions[oldestIndex].createdAt) {
            oldestIndex = i;
          }
        }
        nextSessions.splice(oldestIndex, 1);
      }

      // 새 세션을 목록 맨 앞에 추가
      return [newSession, ...nextSessions];
    });

    // 새 세션 활성화
    setActiveSessionId(newSession.id);
  };

  // 세션 선택
  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
  };

  // 세션 이름 변경
  const handleRenameSession = (sessionId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, title: trimmed, updatedAt: Date.now() }
          : s
      )
    );
  };

  // 세션 삭제
  const handleDeleteSession = (sessionId: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);

      // 현재 보고 있던 세션을 삭제했다면 첫 번째 세션으로 포커스 이동
      if (activeSessionId === sessionId) {
        setActiveSessionId(next[0]?.id ?? null);
      }

      return next;
    });
  };

  // 검색어 변경
  const handleSearchTermChange = (value: string) => {
    setSearchTerm(value);
  };

  // 현재 활성 세션
  const activeSession =
    sessions.find((s) => s.id === activeSessionId) ?? null;

  // 현재 활성 세션의 도메인 변경 (카드에서 호출)
  const handleChangeSessionDomain = (nextDomain: ChatDomain) => {
    if (!activeSessionId) return;
    const now = Date.now();

    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSessionId
          ? { ...session, domain: nextDomain, updatedAt: now }
          : session
      )
    );
  };

  // 사이드바용 요약 데이터
  const sidebarSessions: SidebarSessionSummary[] = sessions.map((session) => {
    const last = session.messages[session.messages.length - 1];
    const lastMessage = last ? buildLastMessagePreview(last.content) : "";

    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      domain: session.domain,
      lastMessage,
    };
  });

  // ====== FAQ 빠른 질문: 질문 + 답변 한 번에 추가 (AI 호출 없음) ======
  const handleFaqQuickSend = (faqId: number) => {
    if (!activeSessionId) return;

    const faqItem = FAQ_ITEMS.find((item) => item.id === faqId);
    if (!faqItem) return;

    const now = Date.now();

    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== activeSessionId) return session;

        const hasUserMessage = session.messages.some(
          (m) => m.role === "user"
        );
        const isDefaultTitle = session.title.startsWith("새 채팅");

        const nextTitle =
          !hasUserMessage && isDefaultTitle
            ? buildSessionTitleFromMessage(faqItem.question)
            : session.title;

        const userMessage: ChatMessage = {
          id: `${activeSessionId}-faq-${faqId}-user-${now}`,
          role: "user",
          content: faqItem.question,
          createdAt: now,
        };

        const assistantMessage: ChatMessage = {
          id: `${activeSessionId}-faq-${faqId}-assistant-${now + 1}`,
          role: "assistant",
          content: faqItem.answer,
          createdAt: now + 1,
        };

        return {
          ...session,
          title: nextTitle,
          // FAQ 카드를 누른 세션은 FAQ 도메인으로 전환
          domain: "faq",
          messages: [...session.messages, userMessage, assistantMessage],
          updatedAt: now + 1,
        };
      })
    );
  };

  // ====== 메시지 전송 전체 플로우 (일반 채팅: AI 호출) ======
  const handleSendMessage = (text: string) => {
    void processSendMessage(text);
  };

  const processSendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const sessionIdForSend =
      activeSessionId ?? (sessions.length > 0 ? sessions[0].id : null);

    if (!sessionIdForSend) {
      return;
    }

    const now = Date.now();

    const currentSession = sessions.find((s) => s.id === sessionIdForSend);
    if (!currentSession) return;

    const userMessage: ChatMessage = {
      id: `${sessionIdForSend}-${now}`,
      role: "user",
      content: trimmed,
      createdAt: now,
    };

    const hasUserMessage = currentSession.messages.some(
      (m) => m.role === "user"
    );
    const isDefaultTitle = currentSession.title.startsWith("새 채팅");

    const nextTitle =
      !hasUserMessage && isDefaultTitle
        ? buildSessionTitleFromMessage(trimmed)
        : currentSession.title;

    const userAppendedMessages = [...currentSession.messages, userMessage];

    // 1) 우선 user 메시지만 바로 상태에 반영
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionIdForSend
          ? {
            ...session,
            title: nextTitle,
            messages: userAppendedMessages,
            updatedAt: now,
          }
          : session
      )
    );

    // 2) 신고 의도인 경우: AI 호출 대신 신고 안내 말풍선 + 신고 버튼 제공
    if (shouldSuggestReport(trimmed)) {
      const suggestionTime = now + 1;
      const suggestionMessage: ChatMessage = {
        id: `${sessionIdForSend}-report-suggestion-${suggestionTime}`,
        role: "assistant",
        content:
          "신고 절차를 알려드릴게요! 부적절한 상황이라면 지금 바로 신고할 수 있어요.",
        createdAt: suggestionTime,
        kind: "reportSuggestion",
      };

      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionIdForSend
            ? {
              ...session,
              messages: [...userAppendedMessages, suggestionMessage],
              updatedAt: suggestionTime,
            }
            : session
        )
      );

      return;
    }

    // 3) 일반 메시지: AI 요청 payload
    const requestPayload: ChatRequest = {
      sessionId: sessionIdForSend,
      domain: currentSession.domain,
      messages: userAppendedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    try {
      setIsSending(true);
      const replyText = await sendChatToAI(requestPayload);

      const replyTime = Date.now();
      const assistantMessage: ChatMessage = {
        id: `${sessionIdForSend}-assistant-${replyTime}`,
        role: "assistant",
        content: replyText,
        createdAt: replyTime,
      };

      // 응답 도착 후 assistant 메시지 추가
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionIdForSend
            ? {
              ...session,
              messages: [...session.messages, assistantMessage],
              updatedAt: replyTime,
            }
            : session
        )
      );
    } catch (error) {
      console.error("sendChatToAI error:", error);
      const replyTime = Date.now();
      const errorMessage: ChatMessage = {
        id: `${sessionIdForSend}-assistant-error-${replyTime}`,
        role: "assistant",
        content:
          "죄송합니다. 서버와 통신 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
        createdAt: replyTime,
      };

      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionIdForSend
            ? {
              ...session,
              messages: [...session.messages, errorMessage],
              updatedAt: replyTime,
            }
            : session
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  // 특정 답변 기준으로 "다시 시도 / 다른 답변" 요청
  const handleRetryFromMessage = (sourceQuestion: string, mode: RetryMode) => {
    const base = sourceQuestion.trim();
    if (!base || isSending) return;

    let question = base;

    if (mode === "variant") {
      // 다른 답변 모드: 같은 질문이지만, 다른 방식으로 설명 요청
      question = `${base}\n\n같은 내용이지만 다른 방식으로도 한 번 더 설명해줘.`;
    }

    void processSendMessage(question);
  };

  // ====== 피드백 업데이트 (좋아요 / 별로예요) ======
  const handleFeedbackChange = (messageId: string, value: FeedbackValue) => {
    if (!activeSessionId) return;
    const now = Date.now();

    // 1) 프론트 상태에 반영
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== activeSessionId) return session;

        const updatedMessages = session.messages.map((m) =>
          m.id === messageId ? { ...m, feedback: value } : m
        );

        return {
          ...session,
          messages: updatedMessages,
          updatedAt: now,
        };
      })
    );

    // 2) (선택) 백엔드로도 피드백 전달 - 지금은 Mock
    void sendFeedbackToAI({
      sessionId: activeSessionId,
      messageId,
      feedback: value,
    });
  };

  // ====== 신고 모달에서 제출된 신고 처리 ======
  const handleSubmitReport = (payload: ReportPayload) => {
    const sessionId = payload.sessionId || activeSessionId;
    if (!sessionId) return;

    const now = Date.now();

    const receiptMessage: ChatMessage = {
      id: `${sessionId}-report-receipt-${now}`,
      role: "assistant",
      content:
        "신고가 접수되었습니다. 담당자가 내용을 확인한 후 필요한 경우 별도로 연락드리겠습니다.",
      createdAt: now,
      kind: "reportReceipt",
    };

    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
            ...session,
            messages: [...session.messages, receiptMessage],
            updatedAt: now,
          }
          : session
      )
    );

    // TODO: 실제 신고 저장 API 연동 시 payload 전송
    console.log("[신고 접수] payload:", payload);
  };

  // === 교육/퀴즈 패널 열기 핸들러 (챗봇 자동 닫기) ===
  const handleOpenEduPanelFromChat = () => {
    if (onOpenEduPanel) {
      onOpenEduPanel();
    }
    onClose(); // 교육 패널이 열릴 때 챗봇 패널은 닫기
  };

  const handleOpenQuizPanelFromChat = () => {
    if (onOpenQuizPanel) {
      onOpenQuizPanel(); // quizId는 아직 사용하지 않음
    }
    onClose(); // 퀴즈 패널이 열릴 때 챗봇 패널 닫기
  };

  const handleOpenAdminPanelFromChat = () => {
    if (onOpenAdminPanel) {
      onOpenAdminPanel();
    }
    onClose(); // 관리자 패널이 열릴 때 챗봇 패널은 닫기 
  };

  // 지니 애니메이션 종료 이벤트
  useEffect(() => {
    if (!wrapperRef.current || !onAnimationEnd) return;

    const handleAnimationEnd = (e: AnimationEvent) => {
      if (e.target === wrapperRef.current) {
        onAnimationEnd();
      }
    };

    const el = wrapperRef.current;
    el.addEventListener("animationend", handleAnimationEnd);
    return () => {
      el.removeEventListener("animationend", handleAnimationEnd);
    };
  }, [onAnimationEnd]);

  const genieClass =
    animationState === "opening"
      ? "cb-genie-opening"
      : animationState === "closing"
        ? "cb-genie-closing"
        : "";

  return (
    <div className="cb-genie-wrapper">
      <div
        ref={wrapperRef}
        className={`cb-chatbot-wrapper ${genieClass}`}
        style={{
          top: panelPos.top,
          left: panelPos.left,
          transformOrigin,
        }}
        onMouseDown={onRequestFocus}
      >
        <div
          className="cb-chatbot-panel"
          style={{ width: size.width, height: size.height }}
        >
          {/* 상단 드래그 바 (투명, 위치 이동용) */}
          <div className="cb-drag-bar" onMouseDown={handleDragMouseDown} />

          {/* 리사이즈 핸들: 모서리 4개 + 변 4개 (투명) */}
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

          {/* 닫기 버튼 */}
          <button
            type="button"
            className="cb-panel-close-btn"
            onClick={onClose}
            aria-label="챗봇 창 닫기"
          >
            ✕
          </button>

          <div className="cb-chatbot-layout">
            <Sidebar
              collapsed={isSidebarCollapsed}
              onToggleCollapse={() =>
                setIsSidebarCollapsed((prev) => !prev)
              }
              sessions={sidebarSessions}
              activeSessionId={activeSessionId}
              searchTerm={searchTerm}
              onSearchTermChange={handleSearchTermChange}
              onNewChat={handleNewChat}
              onSelectSession={handleSelectSession}
              onRenameSession={handleRenameSession}
              onDeleteSession={handleDeleteSession}
            />
            <ChatWindow
              key={activeSession?.id ?? "no-session"}
              activeSession={activeSession}
              onSendMessage={handleSendMessage}
              isSending={isSending}
              onChangeDomain={handleChangeSessionDomain}
              // 교육/퀴즈 카드 클릭 시: 새 패널 열고 챗봇 닫기
              onOpenEduPanel={handleOpenEduPanelFromChat}
              onOpenQuizPanel={handleOpenQuizPanelFromChat}
              onOpenAdminPanel={handleOpenAdminPanelFromChat}
              onFaqQuickSend={handleFaqQuickSend}
              onRetryFromMessage={handleRetryFromMessage}
              onFeedbackChange={handleFeedbackChange}
              onReportSubmit={handleSubmitReport}
              // SYSTEM_ADMIN / EMPLOYEE 정보 전달
              userRole={userRole}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatbotApp;
