// src/components/Layout.tsx
import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import keycloak from "../keycloak";
import type { KeycloakProfile, KeycloakTokenParsed } from "keycloak-js";

// 헤더/사이드바 스타일은 기존 Dashboard.css 재사용
import "../pages/Dashboard.css";
import FloatingChatbotRoot from "./chatbot/FloatingChatbotRoot";

interface LayoutProps {
  children: React.ReactNode;
  pageClassName?: string;
}

// 토큰 타입 확장 (혹시 토큰에도 fullName 매핑되어 있으면 같이 사용)
interface CtrlfTokenParsed extends KeycloakTokenParsed {
  fullName?: string;
}

// loadUserProfile() 결과 타입 확장
type ExtendedProfile = KeycloakProfile & {
  attributes?: {
    [key: string]: string | string[];
  };
};

const Layout: React.FC<LayoutProps> = ({ children, pageClassName }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [profile, setProfile] = useState<ExtendedProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();

  const token = (keycloak.tokenParsed || {}) as CtrlfTokenParsed;

  // user profile + attributes에서 fullName 가져오기
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const loaded = (await keycloak.loadUserProfile()) as ExtendedProfile;
        setProfile(loaded);
      } catch (err) {
        console.error("Failed to load user profile in Layout", err);
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
  }, []);

  // attributes 안전하게 꺼내는 헬퍼
  const getAttr = (key: string): string | undefined => {
    const raw = profile?.attributes?.[key];
    if (!raw) return undefined;
    if (Array.isArray(raw)) return raw[0];
    return raw;
  };

  // 1순위: profile.attributes.fullName
  // 2순위: profile.firstName / username
  const profileName =
    getAttr("fullName") || profile?.firstName || profile?.username || "";

  // 토큰에도 매핑해놨다면 fallback 용으로 사용
  const tokenName =
    token.fullName || token.name || token.preferred_username || token.username;

  const displayName = profileName || tokenName || "사용자 이름";

  const handleLogout = () => {
    keycloak.logout();
  };

  const handleNavigate = (path: string) => {
    setIsSidebarOpen(false);
    navigate(path);
  };

  const isActive = (path: string) => location.pathname === path;

  // Keycloak 로그인 여부
  const isAuthenticated = !!keycloak.authenticated;

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
            <span className="topbar-username">
              {loadingProfile ? "..." : displayName}
            </span>
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

      {/* 로그인된 경우에만 플로팅 챗봇 + 교육 패널 루트 표시 */}
      {isAuthenticated && <FloatingChatbotRoot />}
    </div>
  );
};

export default Layout;
