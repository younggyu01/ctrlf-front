// src/pages/MyPage.tsx
import React, { useEffect, useState } from "react";
import type { KeycloakProfile } from "keycloak-js";
import keycloak from "../keycloak";
import "./MyPage.css";
import profileIcon from "../assets/profile-icon.png";

// attributes 타입을 우리가 명시적으로 정의
type ExtendedProfile = KeycloakProfile & {
  attributes?: {
    [key: string]: string | string[];
  };
};

const MyPage: React.FC = () => {
  const [profile, setProfile] = useState<ExtendedProfile | null>(null);

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
