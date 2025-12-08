// src/pages/MyPage.tsx
import React from "react";
import type { KeycloakTokenParsed } from "keycloak-js";
import keycloak from "../keycloak";
import "./MyPage.css";
import profileIcon from "../assets/profile-icon.png";

// 토큰에 있는 커스텀 클레임 타입 확장
interface CtrlfTokenParsed extends KeycloakTokenParsed {
  fullName?: string;
  department?: string;
  position?: string;
}

const MyPage: React.FC = () => {
  const token = (keycloak.tokenParsed || {}) as CtrlfTokenParsed;

  // 이름: fullName → name → preferred_username → username
  const displayName =
    token.fullName ||
    token.name ||
    token.preferred_username ||
    token.username ||
    "사용자 이름";

  const department = token.department ?? "부서 미설정";
  const position = token.position ?? "직급 미설정";
  const email = token.email ?? "이메일 미설정";

  return (
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
  );
};

export default MyPage;
