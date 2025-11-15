// src/pages/DashboardPage.tsx
import { useState } from "react";
import {
  User,
  FileText,
  MessageSquare,
  Calendar,
  Bell,
  Users,
  BookOpen,
  X,
} from "lucide-react";
import "./Dashboard.css";
import keycloak from "../keycloak";

const DashboardPage: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("대시보드");
  const [notificationCount] = useState(3);

  // Keycloak 토큰에서 사용자 이름 가져오기 (없으면 기본값)
  const token =
    keycloak.tokenParsed as { preferred_username?: string; name?: string } | undefined;
  const displayName = token?.name || token?.preferred_username || "홍길동";

  const sidebarItems = [
    { name: "마이페이지", icon: User },
    { name: "전자결재", icon: FileText },
    { name: "메세지", icon: MessageSquare },
    { name: "행사일정", icon: Calendar },
    { name: "공지사항", icon: Bell },
    { name: "조직도", icon: Users },
    { name: "교육", icon: BookOpen },
  ];

  const handleLogout = () => {
    // 🔑 Keycloak 로그아웃 후 로그인 페이지로 돌아가기
    keycloak.logout({
      redirectUri: `${window.location.origin}/login`,
    });
  };

  const renderContent = () => {
    switch (activeTab) {
      case "대시보드":
        return (
          <div className="content-section dashboard-content">
            <div className="stats-grid">
              <div className="stat-box">
                <div className="stat-value">12</div>
                <div className="stat-label">진행 중인 프로젝트</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">5</div>
                <div className="stat-label">미확인 공지</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">3</div>
                <div className="stat-label">예정된 행사</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">48</div>
                <div className="stat-label">팀 멤버</div>
              </div>
            </div>

            <div className="content-grid">
              <div className="content-box">
                <div className="box-header">
                  <h3>공지사항</h3>
                  <button className="view-all-link">전체보기</button>
                </div>
                <div className="notice-items">
                  <div className="notice-row">
                    <span className="notice-text">
                      2025년 1분기 전사 워크샵 안내
                    </span>
                    <span className="notice-date">2025.11.10</span>
                  </div>
                  <div className="notice-row">
                    <span className="notice-text">신규 보안 정책 적용 안내</span>
                    <span className="notice-date">2025.11.08</span>
                  </div>
                  <div className="notice-row">
                    <span className="notice-text">
                      12월 법인카드 사용 마감일 안내
                    </span>
                    <span className="notice-date">2025.11.05</span>
                  </div>
                  <div className="notice-row">
                    <span className="notice-text">사내 스터디 그룹 모집</span>
                    <span className="notice-date">2025.11.03</span>
                  </div>
                  <div className="notice-row">
                    <span className="notice-text">연말 휴가 신청 안내</span>
                    <span className="notice-date">2025.11.01</span>
                  </div>
                </div>
              </div>

              <div className="content-box">
                <div className="box-header">
                  <h3>다가오는 행사</h3>
                  <button className="view-all-link">전체보기</button>
                </div>
                <div className="event-items">
                  <div className="event-row">
                    <div className="event-dot lavender"></div>
                    <div className="event-info">
                      <div className="event-name">사업설명회</div>
                      <div className="event-time">2025.11.03 - 11.05</div>
                    </div>
                  </div>
                  <div className="event-row">
                    <div className="event-dot rose"></div>
                    <div className="event-info">
                      <div className="event-name">워크샵</div>
                      <div className="event-time">2025.11.13 - 11.14</div>
                    </div>
                  </div>
                  <div className="event-row">
                    <div className="event-dot sky"></div>
                    <div className="event-info">
                      <div className="event-name">팀 빌딩</div>
                      <div className="event-time">2025.11.20</div>
                    </div>
                  </div>
                  <div className="event-row">
                    <div className="event-dot mint"></div>
                    <div className="event-info">
                      <div className="event-name">송년회</div>
                      <div className="event-time">2025.12.20</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      case "마이페이지":
        return (
          <div className="content-section">
            <h2>마이페이지</h2>
            <div className="card-grid">
              <div className="info-card">
                <h3>내 정보</h3>
                <div className="info-item">
                  <span className="label">이름:</span>
                  <span className="value">{displayName}</span>
                </div>
                <div className="info-item">
                  <span className="label">사번:</span>
                  <span className="value">2024001</span>
                </div>
                <div className="info-item">
                  <span className="label">부서:</span>
                  <span className="value">개발팀</span>
                </div>
                <div className="info-item">
                  <span className="label">직급:</span>
                  <span className="value">대리</span>
                </div>
              </div>
              <div className="info-card">
                <h3>근태 현황</h3>
                <div className="info-item">
                  <span className="label">출근 시간:</span>
                  <span className="value">09:00</span>
                </div>
                <div className="info-item">
                  <span className="label">퇴근 시간:</span>
                  <span className="value">18:00</span>
                </div>
                <div className="info-item">
                  <span className="label">잔여 연차:</span>
                  <span className="value">12일</span>
                </div>
              </div>
            </div>
          </div>
        );
      case "전자결재":
        return (
          <div className="content-section">
            <h2>전자결재</h2>
            <div className="approval-stats">
              <div className="stat-card">
                <div className="stat-number">5</div>
                <div className="stat-label">결재 대기</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">12</div>
                <div className="stat-label">진행 중</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">48</div>
                <div className="stat-label">완료</div>
              </div>
            </div>
            <div className="document-list">
              <h3>최근 문서</h3>
              <div className="document-item">
                <span className="doc-title">연차 신청서</span>
                <span className="doc-status pending">대기</span>
              </div>
              <div className="document-item">
                <span className="doc-title">출장 신청서</span>
                <span className="doc-status approved">승인</span>
              </div>
              <div className="document-item">
                <span className="doc-title">구매 품의서</span>
                <span className="doc-status pending">대기</span>
              </div>
            </div>
          </div>
        );
      case "메세지":
        return (
          <div className="content-section">
            <h2>메세지</h2>
            <div className="message-list">
              <div className="message-item unread">
                <div className="message-sender">김철수</div>
                <div className="message-preview">회의 일정 확인 부탁드립니다.</div>
                <div className="message-time">10분 전</div>
              </div>
              <div className="message-item unread">
                <div className="message-sender">이영희</div>
                <div className="message-preview">
                  프로젝트 관련 문서 공유드립니다.
                </div>
                <div className="message-time">1시간 전</div>
              </div>
              <div className="message-item">
                <div className="message-sender">박민수</div>
                <div className="message-preview">
                  점심 식사 같이 하실래요?
                </div>
                <div className="message-time">3시간 전</div>
              </div>
            </div>
          </div>
        );
      case "행사일정":
        return (
          <div className="content-section">
            <h2>행사일정</h2>
            <div className="calendar-events">
              <div className="event-item">
                <div className="event-date">11월 20일</div>
                <div className="event-info">
                  <div className="event-title">전사 워크샵</div>
                  <div className="event-location">제주도 / 2박 3일</div>
                </div>
              </div>
              <div className="event-item">
                <div className="event-date">11월 25일</div>
                <div className="event-info">
                  <div className="event-title">부서 회식</div>
                  <div className="event-location">강남역 / 19:00</div>
                </div>
              </div>
              <div className="event-item">
                <div className="event-date">12월 1일</div>
                <div className="event-info">
                  <div className="event-title">송년회</div>
                  <div className="event-location">본사 대강당 / 18:00</div>
                </div>
              </div>
            </div>
          </div>
        );
      case "공지사항":
        return (
          <div className="content-section">
            <h2>공지사항</h2>
            <div className="notice-list">
              <div className="notice-item important">
                <span className="notice-badge">중요</span>
                <div className="notice-title">
                  2024년 하반기 인사 평가 안내
                </div>
                <div className="notice-date">2024.11.10</div>
              </div>
              <div className="notice-item">
                <div className="notice-title">사내 시스템 점검 안내</div>
                <div className="notice-date">2024.11.08</div>
              </div>
              <div className="notice-item">
                <div className="notice-title">복지 포인트 사용 기한 안내</div>
                <div className="notice-date">2024.11.05</div>
              </div>
              <div className="notice-item">
                <div className="notice-title">주차장 이용 안내</div>
                <div className="notice-date">2024.11.01</div>
              </div>
            </div>
          </div>
        );
      case "조직도":
        return (
          <div className="content-section">
            <h2>조직도</h2>
            <div className="org-chart">
              <div className="org-level">
                <div className="org-card ceo">
                  <div className="org-position">대표이사</div>
                  <div className="org-name">김대표</div>
                </div>
              </div>
              <div className="org-level">
                <div className="org-card">
                  <div className="org-position">개발본부장</div>
                  <div className="org-name">이본부</div>
                </div>
                <div className="org-card">
                  <div className="org-position">영업본부장</div>
                  <div className="org-name">박본부</div>
                </div>
                <div className="org-card">
                  <div className="org-position">경영지원본부장</div>
                  <div className="org-name">최본부</div>
                </div>
              </div>
              <div className="org-level">
                <div className="org-card small">
                  <div className="org-name">개발팀 (12명)</div>
                </div>
                <div className="org-card small">
                  <div className="org-name">디자인팀 (5명)</div>
                </div>
                <div className="org-card small">
                  <div className="org-name">영업팀 (8명)</div>
                </div>
                <div className="org-card small">
                  <div className="org-name">인사팀 (4명)</div>
                </div>
              </div>
            </div>
          </div>
        );
      case "교육":
        return (
          <div className="content-section">
            <h2>교육</h2>
            <div className="education-list">
              <div className="edu-card">
                <div className="edu-header">
                  <h3>신입사원 온보딩 교육</h3>
                  <span className="edu-status ongoing">진행중</span>
                </div>
                <p className="edu-description">
                  회사 소개, 업무 프로세스, 시스템 사용법
                </p>
                <div className="edu-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: "60%" }}
                    ></div>
                  </div>
                  <span className="progress-text">60% 완료</span>
                </div>
              </div>
              <div className="edu-card">
                <div className="edu-header">
                  <h3>정보보안 교육</h3>
                  <span className="edu-status required">필수</span>
                </div>
                <p className="edu-description">
                  개인정보보호, 보안 정책, 사이버 위협 대응
                </p>
                <div className="edu-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: "0%" }}
                    ></div>
                  </div>
                  <span className="progress-text">미수강</span>
                </div>
              </div>
              <div className="edu-card">
                <div className="edu-header">
                  <h3>리더십 과정</h3>
                  <span className="edu-status optional">선택</span>
                </div>
                <p className="edu-description">
                  팀 관리, 커뮤니케이션, 의사결정
                </p>
                <div className="edu-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: "100%" }}
                    ></div>
                  </div>
                  <span className="progress-text">완료</span>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <button
            className="header-logo-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="메뉴 열기"
          >
            Group ware
          </button>
        </div>
        <div className="header-right">
          <span className="user-name">{displayName}</span>
          <button className="notification-button" aria-label="알림">
            <Bell size={20} />
            {notificationCount > 0 && (
              <span className="notification-badge">{notificationCount}</span>
            )}
          </button>
          <button className="logout-button" onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      </header>

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2>메뉴</h2>
          <button
            className="close-button"
            onClick={() => setSidebarOpen(false)}
            aria-label="닫기"
          >
            <X size={24} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                className={`nav-item ${
                  activeTab === item.name ? "active" : ""
                }`}
                onClick={() => {
                  setActiveTab(item.name);
                  setSidebarOpen(false);
                }}
              >
                <Icon size={20} />
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="dashboard-main">{renderContent()}</main>
    </div>
  );
};

export default DashboardPage;
