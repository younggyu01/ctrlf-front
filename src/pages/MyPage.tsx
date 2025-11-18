// src/pages/MyPage.tsx
import React, { useEffect, useState } from "react";
import type { KeycloakProfile } from "keycloak-js";
import keycloak from "../keycloak";
import "./Dashboard.css"; // 헤더/사이드바 스타일 재사용
import "./MyPage.css";    // 마이페이지 전용 스타일
import { useNavigate } from "react-router-dom";
import profileIcon from "../assets/profile-icon.png";

// attributes 타입을 우리가 명시적으로 정의
type ExtendedProfile = KeycloakProfile & {
  attributes?: {
    [key: string]: string | string[];
  };
};

const MyPage: React.FC = () => {
  const [profile, setProfile] = useState<ExtendedProfile | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const loaded = (await keycloak.loadUserProfile()) as ExtendedProfile;
        setProfile(loaded);
      } catch (err) {
        console.error("Failed to load user profile", err);
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

  // 이름: fullName attribute 우선, 없으면 username 사용
  const displayName =
    getAttr("fullName") || profile?.username || "사용자 이름";

  const department = getAttr("department") ?? "부서 미설정";
  const position = getAttr("position") ?? "직급 미설정";
  const email = profile?.email ?? "이메일 미설정";

  const handleLogout = () => {
    keycloak.logout();
  };

  const handleNavigate = (path: string) => {
    setIsSidebarOpen(false);
    navigate(path);
  };

  return (
    <div className="dashboard-page mypage-page">
      {/* ===== 대시보드와 완전히 동일한 헤더 ===== */}
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

      {/* ===== 사이드바 ===== */}
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
          <li onClick={() => handleNavigate("/dashboard")}>대시보드</li>
          <li onClick={() => handleNavigate("/mypage")}>마이페이지</li>
          <li>전자결제</li>
          <li>메세지</li>
          <li>행사일정</li>
          <li>공지사항</li>
          <li>조직도</li>
          <li>교육</li>
        </ul>
      </aside>
      {isSidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* ===== 본문: 사원증 카드 ===== */}
      <main className="dashboard-main mypage-main">
        <div className="idcard-wrapper">
          <div className="idcard-strap" />
          <div className="idcard-clip" />
          <div className="idcard-body-outer">
            <div className="idcard-body-inner">
              {/* 프로필 아이콘 */}
              <img
                src={profileIcon}
                alt="사용자 아이콘"
                className="idcard-avatar"
              />
              {/* 이름 */}
              <div className="idcard-name">{displayName}</div>
              {/* 정보 */}
              <ul className="idcard-info-list">
                <li>
                  <span className="idcard-info-label">업무 부서: </span>
                  <span>{department}</span>
                </li>
                <li>
                  <span className="idcard-info-label">직급: </span>
                  <span>{position}</span>
                </li>
                <li>
                  <span className="idcard-info-label">이메일: </span>
                  <span className="idcard-email-value">{email}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default MyPage;
