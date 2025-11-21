// src/components/chatbot/ChatbotApp.tsx
import React, { useEffect, useRef, useState } from "react";
import "./chatbot.css";
import Sidebar from "./Sidebar";
import ChatWindow from "./ChatWindow";
import {
  sendChatToAI,
  type ChatRequest,
  type ChatDomain,
} from "./chatApi";

interface Anchor {
  x: number;
  y: number;
}

interface ChatbotAppProps {
  onClose: () => void; // 닫기 요청 (X 버튼 또는 아이콘 클릭)
  anchor?: Anchor | null;
  animationState?: "opening" | "closing";
  onAnimationEnd?: () => void;
}

type Size = {
  width: number;
  height: number;
};

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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

// 🔹 세션 단위에 domain 추가
type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number; // 최근 업데이트 시간
  domain: ChatDomain;
  messages: ChatMessage[];
};

// 🔹 사이드바에 넘길 요약용 타입 (마지막 메시지 포함)
type SidebarSessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  domain: ChatDomain;
  lastMessage: string;
};

// 첫 사용자 메시지에서 세션 제목을 만들어주는 함수
function buildSessionTitleFromMessage(content: string): string {
  let title = content.replace(/\s+/g, " ").trim();

  if (!title) {
    return "새 채팅";
  }

  const maxLen = 18;
  if (title.length > maxLen) {
    title = title.slice(0, maxLen).trim() + "…";
  }
  return title;
}

// 마지막 메시지 한 줄 프리뷰용
function buildLastMessagePreview(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";

  const maxLen = 24;
  if (oneLine.length > maxLen) {
    return oneLine.slice(0, maxLen).trimEnd() + "…";
  }
  return oneLine;
}

const MIN_WIDTH = 520;
const MIN_HEIGHT = 480;
const INITIAL_SIZE: Size = { width: 550, height: 550 };

// 🔹 최대 세션 개수 (FIFO 기준)
const MAX_SESSIONS = 30;

// 아이콘 위치(anchor) + 패널 크기(size) -> 패널의 top/left 계산
function computePanelPosition(
  anchor: Anchor | null | undefined,
  size: Size
): { top: number; left: number } {
  if (typeof window === "undefined") {
    return { top: 0, left: 0 };
  }

  const { innerWidth, innerHeight } = window;
  const margin = 16; // 화면 가장자리 여백
  const visibleMargin = 40; // 아이콘과 패널 사이 최소 거리 (아이콘이 보이도록)
  const overlapY = -10; // 아이콘을 얼마나 가릴지 (음수면 더 위로)

  let left: number;
  let top: number;

  if (anchor) {
    // 세로 위치: 아이콘 바로 위에
    top = anchor.y - size.height + overlapY;

    const isRightSide = anchor.x >= innerWidth / 2;

    if (isRightSide) {
      left = anchor.x - visibleMargin - size.width;
    } else {
      left = anchor.x + visibleMargin;
    }
  } else {
    // anchor 없으면 fallback: 화면 중앙
    left = (innerWidth - size.width) / 2;
    top = (innerHeight - size.height) / 2;
  }

  // 화면 밖으로 나가지 않도록 클램핑
  if (left < margin) left = margin;
  if (left + size.width > innerWidth - margin) {
    left = innerWidth - margin - size.width;
  }

  if (top < margin) top = margin;
  if (top + size.height > innerHeight - margin) {
    top = innerHeight - margin - size.height;
  }

  return { top, left };
}

// 🔹 초기 세션 한 개 ("새 채팅")
const initialSessions: ChatSession[] = [
  {
    id: "session-1",
    title: "새 채팅",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    domain: "general", // 기본 도메인
    messages: [],
  },
];

const ChatbotApp: React.FC<ChatbotAppProps> = ({
  onClose,
  anchor,
  animationState,
  onAnimationEnd,
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

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        const maxWidth = Math.max(
          MIN_WIDTH,
          window.innerWidth - padding * 2
        );
        const maxHeight = Math.max(
          MIN_HEIGHT,
          window.innerHeight - padding * 2
        );

        // 오른쪽/아래
        if (resizeState.dir.includes("e")) {
          newWidth = resizeState.startWidth + dx;
        }
        if (resizeState.dir.includes("s")) {
          newHeight = resizeState.startHeight + dy;
        }

        // 왼쪽/위쪽
        if (resizeState.dir.includes("w")) {
          newWidth = resizeState.startWidth - dx;
          newLeft = resizeState.startLeft + dx;
        }
        if (resizeState.dir.includes("n")) {
          newHeight = resizeState.startHeight - dy;
          newTop = resizeState.startTop + dy;
        }

        // 크기 클램프
        newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, newHeight));

        // 위치 클램프
        const maxLeft = window.innerWidth - margin - newWidth;
        const maxTop = window.innerHeight - margin - newHeight;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        setSize({ width: newWidth, height: newHeight });
        setPanelPos({ top: newTop, left: newLeft });
        return;
      }

      // 2) 리사이즈가 아니면 드래그 처리
      if (dragState.dragging) {
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        let newTop = dragState.startTop + dy;
        let newLeft = dragState.startLeft + dx;

        const maxLeft = window.innerWidth - margin - size.width;
        const maxTop = window.innerHeight - margin - size.height;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        setPanelPos({ top: newTop, left: newLeft });
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

  // 🔹 새 채팅 (최대 30개, FIFO 삭제)
  const handleNewChat = () => {
    setSessions((prev) => {
      const now = Date.now();

      const newSession: ChatSession = {
        id: `session-${now}`,
        title: "새 채팅", // 숫자 제거
        createdAt: now,
        updatedAt: now,
        domain: "general", // 새 채팅 기본 도메인
        messages: [],
      };

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
      setActiveSessionId(newSession.id);
      return [newSession, ...nextSessions];
    });
  };

  // 🔹 세션 선택
  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
  };

  // 🔹 세션 이름 변경
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

  // 🔹 세션 삭제
  const handleDeleteSession = (sessionId: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  // 🔹 검색어 변경
  const handleSearchTermChange = (value: string) => {
    setSearchTerm(value);
  };

  // 🔹 현재 활성 세션
  const activeSession =
    sessions.find((s) => s.id === activeSessionId) ?? null;

  // 🔹 현재 활성 세션의 도메인 변경 (카드에서 호출)
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

  // 🔹 사이드바용 요약 데이터 (마지막 메시지 + updatedAt 포함)
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

  // ====== 메시지 전송 전체 플로우 ======
  const handleSendMessage = (text: string) => {
    void processSendMessage(text);
  };

  const processSendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !activeSessionId) return;

    const now = Date.now();

    const currentSession = sessions.find((s) => s.id === activeSessionId);
    if (!currentSession) return;

    const userMessage: ChatMessage = {
      id: `${activeSessionId}-${now}`,
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
        session.id === activeSessionId
          ? {
              ...session,
              title: nextTitle,
              messages: userAppendedMessages,
              updatedAt: now,
            }
          : session
      )
    );

    // 2) AI 요청 payload
    const requestPayload: ChatRequest = {
      sessionId: activeSessionId,
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
        id: `${activeSessionId}-assistant-${replyTime}`,
        role: "assistant",
        content: replyText,
        createdAt: replyTime,
      };

      // 3) 응답 도착 후 assistant 메시지 추가
      setSessions((prev) =>
        prev.map((session) =>
          session.id === activeSessionId
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
        id: `${activeSessionId}-assistant-error-${replyTime}`,
        role: "assistant",
        content:
          "죄송합니다. 서버와 통신 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
        createdAt: replyTime,
      };

      setSessions((prev) =>
        prev.map((session) =>
          session.id === activeSessionId
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
      >
        <div
          className="cb-chatbot-panel"
          style={{ width: size.width, height: size.height }}
        >
          {/* 상단 드래그 바 (투명, 위치 이동용) */}
          <div
            className="cb-drag-bar"
            onMouseDown={handleDragMouseDown}
          />

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
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatbotApp;
