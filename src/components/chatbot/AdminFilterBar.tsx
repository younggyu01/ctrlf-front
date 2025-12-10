// src/components/chatbot/AdminFilterBar.tsx
import React from "react";
import type {
  CommonFilterState,
  PeriodPreset,
  DepartmentOption,
} from "./adminFilterTypes";

type AdminFilterMode = "overview" | "logs";

interface BasicOption {
  id: string;
  label: string;
}

interface AdminFilterBarProps {
  mode: AdminFilterMode;
  value: CommonFilterState;
  onChange: (next: CommonFilterState) => void;

  departments: DepartmentOption[];

  // logs 모드에서만 사용하는 옵션들
  domainOptions?: BasicOption[];
  routeOptions?: BasicOption[];
  modelOptions?: BasicOption[];

  onRefresh?: () => void;
  isRefreshing?: boolean;
}

/**
 * 기간 프리셋 버튼 정의
 * - AdminDashboardView 의 PERIOD_OPTIONS 와 텍스트를 맞춤
 */
const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "7d", label: "최근 7일" },
  { id: "30d", label: "최근 30일" },
  { id: "90d", label: "최근 90일" },
];

const AdminFilterBar: React.FC<AdminFilterBarProps> = ({
  mode,
  value,
  onChange,
  departments,
  domainOptions,
  routeOptions,
  modelOptions,
  onRefresh,
  isRefreshing,
}) => {
  const handlePeriodClick = (next: PeriodPreset) => {
    if (next === value.period) return;
    onChange({ ...value, period: next });
  };

  const handleDeptChange: React.ChangeEventHandler<HTMLSelectElement> = (
    event,
  ) => {
    onChange({ ...value, departmentId: event.target.value });
  };

  const handleDomainChange: React.ChangeEventHandler<HTMLSelectElement> = (
    event,
  ) => {
    onChange({ ...value, domainId: event.target.value });
  };

  const handleRouteChange: React.ChangeEventHandler<HTMLSelectElement> = (
    event,
  ) => {
    onChange({ ...value, routeId: event.target.value });
  };

  const handleModelChange: React.ChangeEventHandler<HTMLSelectElement> = (
    event,
  ) => {
    onChange({ ...value, modelId: event.target.value });
  };

  const handleHasPiiOnlyChange: React.ChangeEventHandler<HTMLInputElement> = (
    event,
  ) => {
    onChange({ ...value, hasPiiOnly: event.target.checked });
  };

  const handleOnlyErrorChange: React.ChangeEventHandler<HTMLInputElement> = (
    event,
  ) => {
    onChange({ ...value, onlyError: event.target.checked });
  };

  return (
    <>
      {/* 1줄차: 기간 + 부서 + 새로고침 (overview / logs 공통) */}
      <div className="cb-admin-filter-bar">
        <div className="cb-admin-filter-group">
          <span className="cb-admin-filter-label">기간</span>
          <div
            className="cb-admin-filter-control cb-admin-filter-control--pills"
            role="tablist"
            aria-label="통계 조회 기간"
          >
            {PERIOD_PRESETS.map((opt) => {
              const isActive = opt.id === value.period;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`cb-admin-filter-pill ${
                    isActive ? "is-active" : ""
                  }`}
                  onClick={() => handlePeriodClick(opt.id)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="cb-admin-filter-group">
          <span className="cb-admin-filter-label">부서</span>
          <div className="cb-admin-filter-control">
            <select value={value.departmentId} onChange={handleDeptChange}>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="cb-admin-filter-actions">
          <button
            type="button"
            className="cb-admin-filter-refresh-btn"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <span className="cb-admin-filter-refresh-icon" aria-hidden="true">
              ↻
            </span>
            <span>{isRefreshing ? "갱신 중..." : "데이터 새로고침"}</span>
          </button>
        </div>
      </div>

      {/* logs 모드일 때만: 도메인 / Route / 모델 + PII/에러 토글 2번째 줄 */}
      {mode === "logs" && (
        <div className="cb-admin-filter-bar cb-admin-filter-bar--sub cb-admin-log-filter-row">
          {/* 왼쪽: 도메인 / Route / 모델 셀렉트들 */}
          <div className="cb-admin-log-filter-selects">
            {domainOptions && (
              <div className="cb-admin-filter-group">
                <span className="cb-admin-filter-label">도메인</span>
                <div className="cb-admin-filter-control">
                  <select
                    value={value.domainId ?? "ALL"}
                    onChange={handleDomainChange}
                  >
                    {domainOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {routeOptions && (
              <div className="cb-admin-filter-group">
                <span className="cb-admin-filter-label">Route</span>
                <div className="cb-admin-filter-control">
                  <select
                    value={value.routeId ?? "ALL"}
                    onChange={handleRouteChange}
                  >
                    {routeOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {modelOptions && (
              <div className="cb-admin-filter-group">
                <span className="cb-admin-filter-label">모델</span>
                <div className="cb-admin-filter-control">
                  <select
                    value={value.modelId ?? "ALL"}
                    onChange={handleModelChange}
                  >
                    {modelOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* 오른쪽: PII / 에러 토글 버튼들 */}
          <div className="cb-admin-log-flag-group">
            <label
              className={`cb-admin-flag-toggle ${
                value.hasPiiOnly ? "is-active" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={!!value.hasPiiOnly}
                onChange={handleHasPiiOnlyChange}
              />
              <span className="cb-admin-flag-toggle-knob" />
              <span className="cb-admin-flag-toggle-label">PII 포함만</span>
            </label>

            <label
              className={`cb-admin-flag-toggle ${
                value.onlyError ? "is-active" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={!!value.onlyError}
                onChange={handleOnlyErrorChange}
              />
              <span className="cb-admin-flag-toggle-knob" />
              <span className="cb-admin-flag-toggle-label">
                에러 로그만
              </span>
            </label>
          </div>
        </div>
      )}
    </>
  );
};

export default AdminFilterBar;
