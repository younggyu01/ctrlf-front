// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import DashboardPage from "./pages/Dashboard";

export default function App() {
  return (
    <Routes>
      {/* 기본 진입은 대시보드로 */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* 그룹웨어 대시보드 (Keycloak가 이미 로그인 보장) */}
      <Route path="/dashboard" element={<DashboardPage />} />

      {/* 그 외 모든 경로도 대시보드로 */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
