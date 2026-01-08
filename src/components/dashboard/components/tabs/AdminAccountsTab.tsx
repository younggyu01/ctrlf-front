import React, { useCallback, useEffect, useState } from "react";
import type {
  RoleKey,
  CreatorType,
  AdminUserSummary,
  AccountMessage,
} from "../../adminDashboardTypes";
import { DEPARTMENT_OPTIONS } from "../../adminDashboardMocks";
import {
  searchUsers,
  getUser,
  updateUser,
  updateUserRoles,
  type User,
} from "../../api/userApi";

/** 롤 한글 라벨 매핑 (요약 표시용) */
const ROLE_LABELS: Record<RoleKey, string> = {
  EMPLOYEE: "EMPLOYEE (기본)",
  VIDEO_CREATOR: "VIDEO_CREATOR (영상 제작자)",
  CONTENTS_REVIEWER: "CONTENTS_REVIEWER (콘텐츠 검토자)",
  SYSTEM_ADMIN: "SYSTEM_ADMIN (시스템 관리자)",
};

interface AdminAccountsTabProps {}

/**
 * API 응답 User를 AdminUserSummary로 변환
 */
// 부서 코드 → 부서 이름 매핑 (컴포넌트 외부 상수)
const DEPT_CODE_TO_NAME_MAP: Record<string, string> = {
  GA: "총무팀",
  PLAN: "기획팀",
  MKT: "마케팅팀",
  HR: "인사팀",
  FIN: "재무팀",
  DEV: "개발팀",
  SALES: "영업팀",
  LEGAL: "법무팀",
};

// 부서 이름 → 부서 코드 매핑
const DEPT_NAME_TO_CODE_MAP: Record<string, string> = {
  총무팀: "GA",
  기획팀: "PLAN",
  마케팅팀: "MKT",
  인사팀: "HR",
  재무팀: "FIN",
  개발팀: "DEV",
  영업팀: "SALES",
  법무팀: "LEGAL",
};

function convertUserToAdminUserSummary(user: User): AdminUserSummary {
  const attributes = user.attributes || {};
  const employeeNo = attributes.employeeNo?.[0] || "";
  const department = attributes.department?.[0] || "";
  const creatorType = (attributes.creatorType?.[0] as CreatorType) || undefined;
  const creatorDeptScope = attributes.creatorDeptScope || [];

  const deptCode = DEPT_NAME_TO_CODE_MAP[department] || department;
  const roles = (user.realmRoles || []) as RoleKey[];

  return {
    id: user.id,
    name: `${user.attributes?.fullName || ""}`.trim(),
    employeeNo,
    deptCode,
    deptName: department,
    roles,
    creatorType,
    creatorDeptScope,
  };
}

const AdminAccountsTab: React.FC<AdminAccountsTabProps> = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userList, setUserList] = useState<AdminUserSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<RoleKey[]>([]);
  const [creatorType, setCreatorType] = useState<CreatorType>(null);
  const [creatorDeptScope, setCreatorDeptScope] = useState<string[]>([]);
  const [accountMessage, setAccountMessage] = useState<AccountMessage | null>(
    null
  );
  const [userSearchKeyword, setUserSearchKeyword] = useState("");
  const [debouncedSearchKeyword, setDebouncedSearchKeyword] = useState("");
  const [userDeptFilter, setUserDeptFilter] = useState("ALL");
  const [userRoleFilter, setUserRoleFilter] = useState<RoleKey | "ALL">("ALL");
  const [currentPage, setCurrentPage] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const pageSize = 10;

  // 원본 데이터 (되돌리기용)
  const [originalUserData, setOriginalUserData] = useState<{
    roles: RoleKey[];
    creatorType: CreatorType;
    creatorDeptScope: string[];
  } | null>(null);

  // 검색어 디바운싱 (500ms 지연)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchKeyword(userSearchKeyword);
    }, 800);

    return () => clearTimeout(timer);
  }, [userSearchKeyword]);

  // 사용자 목록 및 역할 목록 로드
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 부서 코드를 부서 이름으로 변환
      const department =
        userDeptFilter === "ALL"
          ? undefined
          : DEPT_CODE_TO_NAME_MAP[userDeptFilter] || userDeptFilter;
      const role = userRoleFilter === "ALL" ? undefined : userRoleFilter;
      const search = debouncedSearchKeyword.trim() || undefined;

      const usersRes = await searchUsers({
        search,
        department,
        role,
        page: currentPage,
        size: pageSize,
      });

      const convertedUsers = usersRes.items.map(convertUserToAdminUserSummary);
      setUserList(convertedUsers);
      setTotalUsers(usersRes.total);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "사용자 목록을 불러오는 중 오류가 발생했습니다."
      );
      console.error("Failed to fetch users:", err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchKeyword, userDeptFilter, userRoleFilter, currentPage]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // 필터 변경 시 첫 페이지로 리셋
  useEffect(() => {
    setCurrentPage(0);
  }, [debouncedSearchKeyword, userDeptFilter, userRoleFilter]);

  // 선택된 사용자 상세 정보 로드
  const fetchSelectedUser = useCallback(async () => {
    if (!selectedUserId) {
      setSelectedRoles([]);
      setCreatorType(null);
      setCreatorDeptScope([]);
      setOriginalUserData(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const user = await getUser(selectedUserId);
      const summary = convertUserToAdminUserSummary(user);

      setSelectedRoles(summary.roles);
      setCreatorType(summary.creatorType || null);
      setCreatorDeptScope(summary.creatorDeptScope || []);

      // 원본 데이터 저장 (되돌리기용)
      setOriginalUserData({
        roles: summary.roles,
        creatorType: summary.creatorType || null,
        creatorDeptScope: summary.creatorDeptScope || [],
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "사용자 정보를 불러오는 중 오류가 발생했습니다."
      );
      console.error("Failed to fetch user:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedUserId]);

  useEffect(() => {
    fetchSelectedUser();
  }, [fetchSelectedUser]);

  const currentUser =
    selectedUserId != null
      ? userList.find((u) => u.id === selectedUserId) ?? null
      : null;

  const selectedRoleLabels =
    selectedRoles.length === 0
      ? "선택된 역할 없음"
      : selectedRoles.map((r) => ROLE_LABELS[r]).join(", ");

  // 필터링은 API에서 처리되므로 userList를 그대로 사용
  const filteredUsers = userList;

  // 페이지네이션 계산
  const totalPages = Math.ceil(totalUsers / pageSize);
  const hasNextPage = currentPage < totalPages - 1;
  const hasPrevPage = currentPage > 0;

  // 페이지 변경 핸들러
  const handlePageChange = (newPage: number) => {
    if (newPage >= 0 && newPage < totalPages) {
      setCurrentPage(newPage);
    }
  };

  const isRoleChecked = (role: RoleKey) => selectedRoles.includes(role);

  // 사용자 선택 핸들러
  const handleSelectUser = (user: AdminUserSummary) => {
    setSelectedUserId(user.id);
  };

  // 역할 토글 핸들러
  const handleToggleRole = (role: RoleKey) => {
    setSelectedRoles((prev) => {
      if (prev.includes(role)) {
        const next = prev.filter((r) => r !== role);
        // VIDEO_CREATOR 제거 시 관련 속성도 제거
        if (role === "VIDEO_CREATOR") {
          setCreatorType(null);
          setCreatorDeptScope([]);
        }
        return next;
      } else {
        return [...prev, role];
      }
    });
  };

  // 저장 핸들러
  const handleSave = async () => {
    if (!selectedUserId) return;

    setLoading(true);
    setError(null);
    try {
      // 역할 업데이트
      await updateUserRoles(selectedUserId, selectedRoles);

      // VIDEO_CREATOR 관련 속성 업데이트
      // if (selectedRoles.includes("VIDEO_CREATOR")) {
      //   const attributes: Record<string, string[]> = {};
      //   if (creatorType) {
      //     attributes.creatorType = [creatorType];
      //   }
      //   if (creatorDeptScope.length > 0) {
      //     attributes.creatorDeptScope = creatorDeptScope;
      //   }

      //   await updateUser(selectedUserId, {
      //     attributes,
      //   });
      // } else {
      //   // VIDEO_CREATOR 역할이 없으면 속성 제거
      //   await updateUser(selectedUserId, {
      //     attributes: {
      //       creatorType: [],
      //       creatorDeptScope: [],
      //     },
      //   });
      // }

      setAccountMessage({
        type: "success",
        text: "사용자 권한이 성공적으로 저장되었습니다.",
      });

      // 저장 후 목록 새로고침
      await fetchUsers();
      await fetchSelectedUser();

      // 메시지 3초 후 자동 제거
      setTimeout(() => {
        setAccountMessage(null);
      }, 3000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "저장 중 오류가 발생했습니다."
      );
      setAccountMessage({
        type: "error",
        text:
          err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.",
      });
      console.error("Failed to save user:", err);
    } finally {
      setLoading(false);
    }
  };

  // 되돌리기 핸들러
  const handleReset = () => {
    if (originalUserData) {
      setSelectedRoles(originalUserData.roles);
      setCreatorType(originalUserData.creatorType);
      setCreatorDeptScope(originalUserData.creatorDeptScope);
    }
    setAccountMessage(null);
  };

  if (loading && userList.length === 0) {
    return (
      <div className="cb-admin-tab-panel">
        <div style={{ padding: "2rem", textAlign: "center" }}>
          데이터를 불러오는 중...
        </div>
      </div>
    );
  }

  if (error && userList.length === 0) {
    return (
      <div className="cb-admin-tab-panel">
        <div style={{ padding: "2rem", textAlign: "center", color: "red" }}>
          오류: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="cb-admin-tab-panel">
      <div className="cb-admin-account-layout">
        <section className="cb-admin-account-card cb-admin-account-card--left">
          <h3 className="cb-admin-account-title">사용자 검색 / 선택</h3>
          <p className="cb-admin-hint">
            이름·사번·부서·역할로 필터링해서 계정을 선택한 뒤, 우측에서 권한을
            편집합니다.
          </p>

          <div className="cb-admin-account-search-row">
            <input
              type="text"
              className="cb-admin-input"
              placeholder="이름 검색"
              value={userSearchKeyword}
              onChange={(e) => setUserSearchKeyword(e.target.value)}
            />
            <select
              className="cb-admin-select"
              value={userDeptFilter}
              onChange={(e) => setUserDeptFilter(e.target.value)}
            >
              {DEPARTMENT_OPTIONS.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
            <select
              className="cb-admin-select"
              value={userRoleFilter}
              onChange={(e) =>
                setUserRoleFilter(
                  e.target.value === "ALL" ? "ALL" : (e.target.value as RoleKey)
                )
              }
            >
              <option value="ALL">전체 역할</option>
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="cb-admin-account-user-list">
            {filteredUsers.length === 0 ? (
              <div className="cb-admin-account-empty">
                조건에 해당하는 사용자가 없습니다.
              </div>
            ) : (
              <ul>
                {filteredUsers.map((user) => {
                  const isActive = user.id === selectedUserId;
                  return (
                    <li
                      key={user.id}
                      className={`cb-admin-account-user-item ${
                        isActive ? "is-active" : ""
                      }`}
                      onClick={() => handleSelectUser(user)}
                    >
                      <div className="cb-admin-account-user-main">
                        <span className="cb-admin-account-user-name">
                          {user.name}
                        </span>
                        <span className="cb-admin-account-user-meta">
                          {user.employeeNo} · {user.deptName}
                        </span>
                      </div>
                      <div className="cb-admin-account-user-roles">
                        {user.roles.map((role) => (
                          <span key={role} className="cb-admin-role-chip">
                            {role}
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div
                className="cb-admin-pagination"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "1rem",
                  marginTop: "1.5rem",
                  paddingTop: "1rem",
                  borderTop: "1px solid #e5e7eb",
                }}
              >
                <button
                  type="button"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={!hasPrevPage || loading}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #d1d5db",
                    backgroundColor:
                      !hasPrevPage || loading ? "#f3f4f6" : "#ffffff",
                    color: !hasPrevPage || loading ? "#9ca3af" : "#374151",
                    cursor: !hasPrevPage || loading ? "not-allowed" : "pointer",
                    fontSize: "0.875rem",
                    fontWeight: "500",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    if (hasPrevPage && !loading) {
                      e.currentTarget.style.backgroundColor = "#f9fafb";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (hasPrevPage && !loading) {
                      e.currentTarget.style.backgroundColor = "#ffffff";
                    }
                  }}
                >
                  이전
                </button>
                <div
                  className="cb-admin-pagination-info"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    fontSize: "0.875rem",
                    color: "#6b7280",
                  }}
                >
                  <span>
                    {currentPage + 1} / {totalPages}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={!hasNextPage || loading}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #d1d5db",
                    backgroundColor:
                      !hasNextPage || loading ? "#f3f4f6" : "#ffffff",
                    color: !hasNextPage || loading ? "#9ca3af" : "#374151",
                    cursor: !hasNextPage || loading ? "not-allowed" : "pointer",
                    fontSize: "0.875rem",
                    fontWeight: "500",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    if (hasNextPage && !loading) {
                      e.currentTarget.style.backgroundColor = "#f9fafb";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (hasNextPage && !loading) {
                      e.currentTarget.style.backgroundColor = "#ffffff";
                    }
                  }}
                >
                  다음
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="cb-admin-account-card cb-admin-account-card--right">
          <h3 className="cb-admin-account-title">선택한 사용자 권한 편집</h3>

          {accountMessage && (
            <div
              className={`cb-admin-toast cb-admin-toast--${accountMessage.type}`}
            >
              {accountMessage.text}
            </div>
          )}

          {!currentUser ? (
            <p className="cb-admin-hint">
              왼쪽에서 계정을 선택하면 역할과 영상 제작 권한을 한 번에 편집할 수
              있습니다.
            </p>
          ) : (
            <>
              <div className="cb-admin-account-selected">
                <div className="cb-admin-account-selected-main">
                  <span className="cb-admin-account-selected-name">
                    {currentUser.name}
                  </span>
                  <span className="cb-admin-account-selected-meta">
                    {currentUser.employeeNo} · {currentUser.deptName}
                  </span>
                </div>
                <div className="cb-admin-account-selected-roles">
                  {currentUser.roles.map((role) => (
                    <span
                      key={role}
                      className="cb-admin-role-chip cb-admin-role-chip--current"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>

              <div className="cb-admin-account-subcard">
                <h4 className="cb-admin-account-subtitle">역할(Role) 설정</h4>
                <div className="cb-admin-role-checkboxes">
                  <label>
                    <input
                      type="checkbox"
                      checked={isRoleChecked("EMPLOYEE")}
                      onChange={() => handleToggleRole("EMPLOYEE")}
                    />
                    <span>EMPLOYEE (기본)</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={isRoleChecked("VIDEO_CREATOR")}
                      onChange={() => handleToggleRole("VIDEO_CREATOR")}
                    />
                    <span>VIDEO_CREATOR (영상 제작자)</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={isRoleChecked("CONTENTS_REVIEWER")}
                      onChange={() => handleToggleRole("CONTENTS_REVIEWER")}
                    />
                    <span>CONTENTS_REVIEWER (콘텐츠 검토자)</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={isRoleChecked("SYSTEM_ADMIN")}
                      onChange={() => handleToggleRole("SYSTEM_ADMIN")}
                    />
                    <span>SYSTEM_ADMIN (시스템 관리자)</span>
                  </label>
                </div>

                <p className="cb-admin-hint">
                  현재 선택된 역할(편집 중 기준): {selectedRoleLabels}
                </p>
              </div>

              <div className="cb-admin-account-actions">
                <button
                  type="button"
                  className="cb-admin-secondary-btn"
                  onClick={handleReset}
                >
                  되돌리기
                </button>
                <button
                  type="button"
                  className="cb-admin-primary-btn"
                  onClick={handleSave}
                  disabled={loading}
                >
                  저장
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminAccountsTab;
