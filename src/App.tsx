// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";
import MyPage from "./pages/MyPage";
import ApprovalPage from "./pages/ApprovalPage";
import MessagePage from "./pages/MessagePage";
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

      {/* 그 외 모든 경로도 대시보드로 */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
