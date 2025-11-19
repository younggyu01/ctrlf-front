// src/pages/Dashboard.tsx
import React from "react";
import "./Dashboard.css";

type InboxItem = {
  id: number;
  title: string;
  from: string;
  date: string;
};

const inboxItems: InboxItem[] = [
  {
    id: 1,
    title: "Daily Report",
    from: "남동팀 / 장윤섭 / BrityWorks",
    date: "11-28 09:38",
  },
  {
    id: 2,
    title: "[내용확인] 리뷰 결과",
    from: "김현경 / 컨설팅 / BrityWorks",
    date: "11-27 10:01",
  },
  {
    id: 3,
    title: "마케팅 자료 검토",
    from: "정태민 / A팀 / BrityOffice",
    date: "11-25 16:19",
  },
  {
    id: 4,
    title: "[공지홍보] 시스템 비용 유지 및 범위 신청서",
    from: "박민아 / 파트D / BrityWorks",
    date: "11-24 11:03",
  },
  {
    id: 5,
    title: "기간 한정 영업 자료료 조정",
    from: "박민아 / 파트D / BrityWorks",
    date: "11-24 11:03",
  },
  {
    id: 6,
    title: "[Invitation] 주간회의",
    from: "남동팀 / 장윤섭 / BrityWorks",
    date: "11-14 10:58",
  },
  {
    id: 7,
    title: "[Scheduled] 품질 정기 회의",
    from: "남동팀 / 장윤섭 / BrityWorks",
    date: "11-14 10:56",
  },
  {
    id: 8,
    title: "[Invitation] 출장 경기 회의",
    from: "남동팀 / 장윤섭 / BrityWorks",
    date: "11-14 10:56",
  },
];

const noticeItems: string[] = [
  "[토론인지] Slack Desktop 보안 업데이트 조치 안내",
  "미국쪽 투표보고와, 출근길 Labor Day 안내",
  "프로고 이탈 수수",
  "20년 하반기 직원 운임 시간 안내다",
];

const DashboardPage: React.FC = () => {
  return (
    <>
      {/* 본문 그리드만 렌더링 (헤더/사이드바는 Layout에서 처리) */}
      <main className="dashboard-main">
        <div className="dashboard-grid">
          {/* 1행 1열 - Welcome 카드 */}
          <section className="card hero-card">
            <div className="hero-content">
              <p className="hero-subtitle">Welcome to</p>
              <h1 className="hero-title">Ctrl F</h1>
              <p className="hero-description">Mail, Messenger, Meeting</p>
            </div>
          </section>

          {/* 1행 2열 - 위쪽 이미지 */}
          <section className="card image-card image-card-top">
            <img
              src="/team-collaboration-meeting-office.jpg"
              alt="Team meeting"
            />
          </section>

          {/* 2행 1열 - 공지사항 */}
          <section className="card notice-card">
            <div className="notice-header">
              <button className="notice-tab active">공지사항</button>
            </div>

            <ul className="notice-list">
              {noticeItems.map((item, idx) => (
                <li key={idx} className="notice-item">
                  <span className="notice-bullet">•</span>
                  <span className="notice-text">{item}</span>
                </li>
              ))}
            </ul>

            <div className="notice-pagination">
              <button className="page-btn active">1</button>
              <button className="page-btn">2</button>
              <button className="page-btn">3</button>
            </div>
          </section>

          {/* 2행 2열 - 아래쪽 이미지 */}
          <section className="card image-card image-card-bottom">
            <img
              src="/futuristic-holographic-cloud-technology-digital-in.jpg"
              alt="Cloud technology"
            />
          </section>

          {/* 1~2행 3열 - 다가오는 일정 */}
          <aside className="card inbox-card">
            <div className="inbox-header">
              <h2>다가오는 일정</h2>
              <div className="inbox-filters">
                <button className="filter-btn active">All</button>
                <button className="filter-btn">Unread</button>
              </div>
            </div>

            <div className="inbox-list">
              {inboxItems.map((item) => (
                <div key={item.id} className="inbox-item">
                  <div className="inbox-item-main">
                    <div className="inbox-item-title">{item.title}</div>
                    <div className="inbox-item-date">{item.date}</div>
                  </div>
                  <div className="inbox-item-sub">{item.from}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </main>

      {/* 푸터는 대시보드에만 유지 */}
      <footer className="dashboard-footer">
        <div className="footer-inner">
          <div className="footer-left">
            Copyright 2025 CtrlF, All rights reserved.
          </div>
          <div className="footer-right">
            <span className="footer-help-icon">?</span>
            <span className="footer-help-text">SUPPORT</span>
            <span className="footer-divider" />
            <span className="footer-contact">
              SERVICE DESK +82-02-1234-567(내선)
            </span>
          </div>
        </div>
      </footer>
    </>
  );
};

export default DashboardPage;
