// src/components/Layout.tsx
import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import keycloak from "../keycloak";
import type { KeycloakTokenParsed } from "keycloak-js";

// 헤더/사이드바 스타일은 기존 Dashboard.css 재사용
import "../pages/Dashboard.css";
import FloatingChatbotRoot from "./chatbot/FloatingChatbotRoot";

import { normalizeRoles, pickPrimaryRole, type UserRole } from "../auth/roles";

interface LayoutProps {
  children: React.ReactNode;
  pageClassName?: string;
}

// 토큰 타입 확장 (fullName, department, position 등 커스텀 클레임)
interface CtrlfTokenParsed extends KeycloakTokenParsed {
  fullName?: string;
  department?: string;
  position?: string;
}

const Layout: React.FC<LayoutProps> = ({ children, pageClassName }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  // Keycloak 토큰 파싱
  const token = (keycloak.tokenParsed || {}) as CtrlfTokenParsed;

  // 토큰에서 바로 이름 정보 가져오기
  const displayName =
    token.fullName ||
    token.name ||
    token.preferred_username ||
    token.username ||
    "사용자 이름";

  const handleLogout = () => {
    keycloak.logout();
  };

  const handleNavigate = (path: string) => {
    setIsSidebarOpen(false);
    navigate(path);
  };

  const isActive = (path: string) => location.pathname === path;

  // Keycloak 로그인 여부
  const isAuthenticated = keycloak.authenticated === true;

  /**
   * Keycloak Role 기반 사용자 Role 계산
   *
   * - realm 레벨 Role: keycloak.realmAccess?.roles
   * - client 레벨 Role: keycloak.resourceAccess?.[clientId]?.roles
   *
   * (주의) 환경에 따라 clientId가 web-app / ctrlf-frontend 등으로 다를 수 있으니 둘 다 탐색
   */
  const realmRoles = keycloak.realmAccess?.roles ?? [];

  const candidateClientIds = ["web-app", "ctrlf-frontend"];
  const clientRoles = candidateClientIds.flatMap(
    (cid) => keycloak.resourceAccess?.[cid]?.roles ?? []
  );

  const rawRoles = Array.from(new Set([...realmRoles, ...clientRoles]));

  const roleSet = normalizeRoles(rawRoles);
  const userRole: UserRole = pickPrimaryRole(roleSet);

  return (
    <div className={`dashboard-page ${pageClassName ?? ""}`}>
      {/* === 공통 헤더 === */}
      <header className="dashboard-topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
            <button
              type="button"
              className="topbar-groupware-btn"
              onClick={() => setIsSidebarOpen(true)}
            >
              Group ware
            </button>
          </div>

          <div className="topbar-right">
            <span className="topbar-username">{displayName}</span>
            <button type="button" className="topbar-notice-btn">
              알림
            </button>
            <button
              type="button"
              className="topbar-logout-btn"
              onClick={handleLogout}
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* === 공통 사이드바 === */}
      <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <span className="sidebar-title">Group ware</span>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="사이드바 닫기"
          >
            ✕
          </button>
        </div>
        <ul className="sidebar-nav">
          <li
            className={isActive("/dashboard") ? "active" : ""}
            onClick={() => handleNavigate("/dashboard")}
          >
            대시보드
          </li>
          <li
            className={isActive("/mypage") ? "active" : ""}
            onClick={() => handleNavigate("/mypage")}
          >
            마이페이지
          </li>
          <li
            className={isActive("/approval") ? "active" : ""}
            onClick={() => handleNavigate("/approval")}
          >
            전자결재
          </li>
          <li
            className={isActive("/message") ? "active" : ""}
            onClick={() => handleNavigate("/message")}
          >
            메세지
          </li>
          <li
            className={isActive("/events") ? "active" : ""}
            onClick={() => handleNavigate("/events")}
          >
            행사일정
          </li>
          <li
            className={isActive("/notice") ? "active" : ""}
            onClick={() => handleNavigate("/notice")}
          >
            공지사항
          </li>
          <li
            className={isActive("/orgchart") ? "active" : ""}
            onClick={() => handleNavigate("/orgchart")}
          >
            조직도
          </li>
          <li
            className={isActive("/education") ? "active" : ""}
            onClick={() => handleNavigate("/education")}
          >
            교육
          </li>
        </ul>
      </aside>

      {isSidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* 각 페이지의 본문이 들어가는 자리 */}
      {children}

      {/* 로그인 + Role 기반 플로팅 챗봇 루트 */}
      {isAuthenticated && <FloatingChatbotRoot userRole={userRole} />}
    </div>
  );
};

export default Layout;
