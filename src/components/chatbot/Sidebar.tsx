// src/components/chatbot/Sidebar.tsx
import React, { useEffect, useState } from "react";
import chatLogo from "../../assets/chatlogo.png";
import newChatIcon from "../../assets/newchat.png";
import searchChatIcon from "../../assets/searchchat.png";
import type { SidebarSessionSummary } from "../../types/chat";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;

  sessions: SidebarSessionSummary[];
  activeSessionId: string | null;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, newTitle: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

// updatedAt 기준 상대 시간 포맷
function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  const dY = date.getFullYear();
  const dM = date.getMonth();
  const dD = date.getDate();

  const nY = now.getFullYear();
  const nM = now.getMonth();
  const nD = now.getDate();

  const two = (n: number) => n.toString().padStart(2, "0");

  // 오늘이면 HH:MM
  if (dY === nY && dM === nM && dD === nD) {
    const h = date.getHours();
    const m = date.getMinutes();
    return `${two(h)}:${two(m)}`;
  }

  // 올해 안이면 MM/DD
  if (dY === nY) {
    return `${two(dM + 1)}/${two(dD)}`;
  }

  // 그 외에는 YYYY/MM/DD
  return `${dY}/${two(dM + 1)}/${two(dD)}`;
}

const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapse,
  sessions,
  activeSessionId,
  searchTerm,
  onSearchTermChange,
  onNewChat,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}) => {
  // 어떤 채팅의 "더 보기" 메뉴가 열려 있는지
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // 인라인 이름 수정 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");

  // 바깥 클릭하면 메뉴 닫기
  useEffect(() => {
    if (!openMenuId) return;

    const handleClickOutside = () => {
      setOpenMenuId(null);
    };

    window.addEventListener("click", handleClickOutside);
    return () => {
      window.removeEventListener("click", handleClickOutside);
    };
  }, [openMenuId]);

  // 검색어로 세션 필터링 (최근 업데이트 순)
  const filteredSessions = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((session) => {
      const keyword = searchTerm.trim().toLowerCase();
      if (!keyword) return true;

      return (
        session.title.toLowerCase().includes(keyword) ||
        session.lastMessage.toLowerCase().includes(keyword)
      );
    });

  const handleMoreClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    sessionId: string
  ) => {
    e.stopPropagation();
    setOpenMenuId((prev) => (prev === sessionId ? null : sessionId));
  };

  // 인라인 이름 수정 시작
  const startEditing = (sessionId: string, currentTitle: string) => {
    setEditingId(sessionId);
    setEditingTitle(currentTitle);
    setOpenMenuId(null);
  };

  // 수정 확정
  const commitEdit = () => {
    if (!editingId) return;
    const trimmed = editingTitle.trim();
    if (trimmed) {
      onRenameSession(editingId, trimmed);
    }
    setEditingId(null);
    setEditingTitle("");
  };

  // 수정 취소
  const cancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commitEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const handleEditClick = (e: React.MouseEvent<HTMLInputElement>) => {
    // li 클릭으로 세션 선택되는 것 막기
    e.stopPropagation();
  };

  const handleDeleteClick = (sessionId: string) => {
    onDeleteSession(sessionId);
    setOpenMenuId(null);
    if (editingId === sessionId) {
      cancelEdit();
    }
  };

  return (
    <aside className={`cb-sidebar ${collapsed ? "collapsed" : ""}`}>
      {/* 로고 버튼 (접기/열기 토글) */}
      <button
        type="button"
        className="cb-sidebar-logo-btn"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
      >
        <div className="cb-sidebar-logo">
          <img src={chatLogo} alt="Ctrl F Chatbot 로고" />
        </div>
      </button>

      {/* 접힌 상태에서는 나머지 영역 숨김 */}
      {!collapsed && (
        <>
          {/* 새 채팅 / 채팅 검색 */}
          <div className="cb-sidebar-section cb-sidebar-actions">
            <button
              type="button"
              className="cb-sidebar-action"
              onClick={onNewChat}
            >
              <img
                src={newChatIcon}
                alt=""
                className="cb-sidebar-action-icon"
              />
              <span>새 채팅</span>
            </button>

            <div className="cb-sidebar-action cb-sidebar-search">
              <img
                src={searchChatIcon}
                alt=""
                className="cb-sidebar-action-icon"
              />
              <input
                type="text"
                className="cb-sidebar-search-input"
                placeholder="채팅 검색"
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
              />
            </div>
          </div>

          {/* 채팅 목록 */}
          <div className="cb-sidebar-section">
            <p className="cb-sidebar-label">채팅</p>
            <ul className="cb-sidebar-list">
              {filteredSessions.length === 0 ? (
                <li className="cb-sidebar-empty">대화 내역이 없습니다.</li>
              ) : (
                filteredSessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  const isEditing = session.id === editingId;

                  return (
                    <li
                      key={session.id}
                      className={isActive ? "active" : undefined}
                      onClick={() => onSelectSession(session.id)}
                    >
                      <div className="cb-sidebar-item-main">
                        {/* 제목 또는 인라인 입력 필드 */}
                        {isEditing ? (
                          <input
                            className="cb-sidebar-item-edit"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            onBlur={commitEdit}
                            onClick={handleEditClick}
                            autoFocus
                          />
                        ) : (
                          <div className="cb-sidebar-item-text">
                            <span className="cb-sidebar-item-title">
                              {session.title || "제목 없음"}
                            </span>
                            {session.lastMessage && (
                              <span className="cb-sidebar-item-preview">
                                {session.lastMessage}
                              </span>
                            )}
                          </div>
                        )}

                        {/* 마지막 업데이트 시간 */}
                        <span className="cb-sidebar-item-time">
                          {formatRelativeTime(session.updatedAt)}
                        </span>
                      </div>

                      {/* 더 보기 버튼 */}
                      <button
                        type="button"
                        className="cb-sidebar-item-more"
                        aria-label="채팅 옵션"
                        onClick={(e) => handleMoreClick(e, session.id)}
                      >
                        ⋯
                      </button>

                      {/* 더 보기 메뉴 (오른쪽 바깥으로) */}
                      {openMenuId === session.id && (
                        <div
                          className="cb-sidebar-item-menu"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="cb-sidebar-item-menu-item"
                            onClick={() =>
                              startEditing(session.id, session.title)
                            }
                          >
                            채팅 이름 바꾸기
                          </button>
                          <button
                            type="button"
                            className="cb-sidebar-item-menu-item cb-danger"
                            onClick={() => handleDeleteClick(session.id)}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      )}
    </aside>
  );
};

export default Sidebar;
