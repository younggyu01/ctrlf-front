// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";
import MyPage from "./pages/MyPage";
import ApprovalPage from "./pages/ApprovalPage";
import MessagePage from "./pages/MessagePage";
import EventPage from "./pages/EventPage";
import NoticePage from "./pages/NoticePage";
import OrgChartPage from "./pages/OrgChartPage";
import EducationPage from "./pages/EducationPage";
import EduApiTest from "./pages/EduApiTest";
import Layout from "./components/Layout";

export default function App() {
  return (
    <Routes>
      {/* 기본 진입은 대시보드로 */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* 대시보드 */}
      <Route
        path="/dashboard"
        element={
          <Layout>
            <DashboardPage />
          </Layout>
        }
      />

      {/* 마이페이지 */}
      <Route
        path="/mypage"
        element={
          <Layout pageClassName="mypage-page">
            <MyPage />
          </Layout>
        }
      />

      {/* 전자결재 */}
      <Route
        path="/approval"
        element={
          <Layout pageClassName="approval-page">
            <ApprovalPage />
          </Layout>
        }
      />

      {/* 메세지(메신저) */}
      <Route
        path="/message"
        element={
          <Layout pageClassName="message-page">
            <MessagePage />
          </Layout>
        }
      />

      {/* 행사일정 */}
      <Route
        path="/events"
        element={
          <Layout pageClassName="event-page">
            <EventPage />
          </Layout>
        }
      />

      {/* 공지사항 */}
      <Route
        path="/notice"
        element={
          <Layout pageClassName="notice-page">
            <NoticePage />
          </Layout>
        }
      />

      {/* 조직도 */}
      <Route
        path="/orgchart"
        element={
          <Layout pageClassName="orgchart-page">
            <OrgChartPage />
          </Layout>
        }
      />

      {/* 교육 API 테스트 */}
      <Route
        path="/edu-api-test"
        element={
          <Layout pageClassName="edu-api-test-page">
            <EduApiTest />
          </Layout>
        }
      />

      {/* 교육 */}
      <Route
        path="/education"
        element={
          <Layout pageClassName="education-page">
            <EducationPage />
          </Layout>
        }
      />

      {/* 그 외 모든 경로도 대시보드로 */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
