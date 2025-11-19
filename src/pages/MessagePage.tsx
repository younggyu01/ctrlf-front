// src/pages/MessagePage.tsx
import React, { useMemo, useState } from "react";
import "./MessagePage.css";
import profileIcon from "../assets/profile-icon.png";

type Author = "me" | "them";

interface ChatMessage {
  id: number;
  author: Author;
  text: string;
  time: string; // HH:MM
  read: boolean;
}

interface Thread {
  id: number;
  name: string;
  role: string;
  messages: ChatMessage[];
}

// 초기 더미 데이터 (read 여부까지 포함)
const initialThreads: Thread[] = [
  {
    id: 1,
    name: "임성현",
    role: "팀장",
    messages: [
      {
        id: 1,
        author: "them",
        text: "혜윙~! 메세지 보내는 창",
        time: "09:17",
        read: true,
      },
    ],
  },
  {
    id: 2,
    name: "임성현",
    role: "팀장",
    messages: [
      {
        id: 1,
        author: "them",
        text: "두 번째 안 읽은 메세지입니다",
        time: "09:11",
        read: false,
      },
      {
        id: 2,
        author: "them",
        text: "가장 최근 대화가 됩니다",
        time: "09:17",
        read: false,
      },
    ],
  },
];

const MessagePage: React.FC = () => {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [selectedId, setSelectedId] = useState<number>(initialThreads[0].id);
  const [searchTerm, setSearchTerm] = useState("");
  const [inputText, setInputText] = useState("");

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? threads[0],
    [threads, selectedId]
  );

  // 검색어 적용된 스레드 목록
  const filteredThreads = useMemo(() => {
    if (!searchTerm.trim()) return threads;
    const lower = searchTerm.toLowerCase();
    return threads.filter((t) => {
      const last = t.messages[t.messages.length - 1];
      const lastText = last?.text ?? "";
      return (
        t.name.toLowerCase().includes(lower) ||
        lastText.toLowerCase().includes(lower)
      );
    });
  }, [threads, searchTerm]);

  // 스레드 선택 시: 선택 + 해당 스레드의 상대방 메시지를 읽음 처리
  const handleSelectThread = (id: number) => {
    setSelectedId(id);
    setThreads((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.author === "them" ? { ...m, read: true } : m
              ),
            }
          : t
      )
    );
  };

  // 메시지 전송
  const handleSend = () => {
    const text = inputText.trim();
    if (!text || !selectedThread) return;

    const now = new Date();
    const time = now.toTimeString().slice(0, 5); // HH:MM

    const newMessage: ChatMessage = {
      id: Date.now(),
      author: "me",
      text,
      time,
      read: true,
    };

    setThreads((prev) =>
      prev.map((t) =>
        t.id === selectedThread.id
          ? {
              ...t,
              messages: [...t.messages, newMessage],
            }
          : t
      )
    );

    setInputText("");
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!selectedThread) return null;

  return (
    // 페이지 padding은 .message-page .dashboard-main에서 조절
    <main className="dashboard-main">
      {/* 메신저 전체 레이아웃 */}
      <section className="message-layout">
        {/* 왼쪽: 대화 목록 영역 */}
        <div className="message-left">
          <div className="message-left-header">
            <h1 className="message-title">메신저</h1>
            <p className="message-subtitle">팀원들과 소통하세요</p>
          </div>

          {/* 검색바 */}
          <div className="message-search-wrapper">
            <input
              className="message-search-input"
              placeholder="이름 또는 메세지 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* 대화 리스트 */}
          <ul className="message-thread-list">
            {filteredThreads.map((thread) => {
              const lastMessage =
                thread.messages[thread.messages.length - 1] ?? null;
              const unreadCount = thread.messages.filter(
                (m) => m.author === "them" && !m.read
              ).length;

              return (
                <li
                  key={thread.id}
                  className={
                    "message-thread-item" +
                    (thread.id === selectedId ? " active" : "")
                  }
                  onClick={() => handleSelectThread(thread.id)}
                >
                  <div className="message-thread-avatar">
                    <img src={profileIcon} alt="프로필" />
                  </div>
                  <div className="message-thread-text">
                    <div className="message-thread-name">{thread.name}</div>
                    <div className="message-thread-preview">
                      {lastMessage
                        ? lastMessage.text
                        : "메세지가 아직 없습니다"}
                    </div>
                  </div>
                  <div className="message-thread-meta">
                    <span className="message-thread-time">
                      {lastMessage?.time ?? ""}
                    </span>
                    {unreadCount > 0 && (
                      <span className="message-thread-badge">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* 가운데 구분선 */}
        <div className="message-divider" />

        {/* 오른쪽: 대화 내용 영역 */}
        <div className="message-right">
          {/* 상단 프로필 영역 */}
          <header className="message-conversation-header">
            <div className="message-conversation-avatar">
              <img src={profileIcon} alt="상대 프로필" />
            </div>
            <div className="message-conversation-info">
              <div className="message-conversation-name">
                {selectedThread.name}
              </div>
              <div className="message-conversation-status">
                {selectedThread.role}
              </div>
            </div>
          </header>

          {/* 실제 메세지 영역 */}
          <div className="message-conversation-body">
            {selectedThread.messages.map((msg) => (
              <div
                key={msg.id}
                className={
                  "message-bubble-row" +
                  (msg.author === "me" ? " me" : " them")
                }
              >
                {msg.author === "them" && (
                  <div className="message-bubble-avatar">
                    <img src={profileIcon} alt="상대 프로필" />
                  </div>
                )}
                <div className="message-bubble-block">
                  <div className="message-bubble">{msg.text}</div>
                  <div className="message-bubble-time">{msg.time}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 입력 영역 */}
          <div className="message-input-area">
            <input
              className="message-input"
              placeholder="메세지를 입력하세요..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              className="message-send-btn"
              onClick={handleSend}
            >
              전송
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default MessagePage;
