import React, { useState, useEffect, useCallback } from "react";
import AdminFilterBar from "../../AdminFilterBar";
import AdminRagGapView from "../../AdminRagGapView";
import PiiReportCard from "../PiiReportCard";
import type { CommonFilterState } from "../../adminFilterTypes";
import type { PeriodFilter, PiiRiskLevel, LogListItem } from "../../adminDashboardTypes";
import {
  PERIOD_OPTIONS,
  DEPARTMENT_OPTIONS,
  LOG_DOMAIN_OPTIONS,
  LOG_ROUTE_OPTIONS,
  LOG_MODEL_OPTIONS,
  PII_REPORT_NONE,
  PII_REPORT_WARNING,
  PII_REPORT_HIGH,
} from "../../adminDashboardMocks";
import { getAdminLogs, periodToDateRange } from "../../api/logApi";

interface AdminLogsTabProps {
  period: PeriodFilter;
  selectedDept: string;
  selectedDeptLabel: string;
  logDomainFilter: string;
  logRouteFilter: string;
  logModelFilter: string;
  logOnlyError: boolean;
  logHasPiiOnly: boolean;
  onFilterChange: (filter: CommonFilterState) => void;
}

const AdminLogsTab: React.FC<AdminLogsTabProps> = ({
  period,
  selectedDept,
  selectedDeptLabel,
  logDomainFilter,
  logRouteFilter,
  logModelFilter,
  logOnlyError,
  logHasPiiOnly,
  onFilterChange,
}) => {
  const [showRagGapView, setShowRagGapView] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const filterValue: CommonFilterState = {
    period,
    departmentId: selectedDept,
    domainId: logDomainFilter,
    routeId: logRouteFilter,
    modelId: logModelFilter,
    onlyError: logOnlyError,
    hasPiiOnly: logHasPiiOnly,
  };

  const handleFilterChange = (next: CommonFilterState) => {
    onFilterChange(next);
  };

  // 로그 조회 함수
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 기간을 시작/종료 날짜로 변환
      const { startDate, endDate } = periodToDateRange(period);

      // 디버깅: 날짜 범위 확인
      console.log("[AdminLogsTab] 날짜 범위:", {
        period,
        startDate,
        endDate,
        startDateLocal: new Date(startDate).toLocaleString("ko-KR"),
        endDateLocal: new Date(endDate).toLocaleString("ko-KR"),
        현재시간: new Date().toLocaleString("ko-KR"),
      });

      // 필터 파라미터 구성
      const filters: Parameters<typeof getAdminLogs>[0] = {
        startDate,
        endDate,
        page: 0, // 기본값: 첫 페이지
        size: 100, // 기본값: 100개 (최대값)
        sort: "createdAt,desc", // 최신순 정렬
      };

      // 부서 필터
      if (selectedDept && selectedDept !== "ALL") {
        // 부서명을 직접 전달 (백엔드가 부서명을 받는 경우)
        // 또는 부서 코드를 사용하는 경우는 백엔드 스펙에 맞춰 조정 필요
        // filters.department = selectedDeptLabel;
      }

      // 도메인 필터
      if (logDomainFilter && logDomainFilter !== "ALL") {
        filters.domain = logDomainFilter;
      }

      // 라우트 필터
      if (logRouteFilter && logRouteFilter !== "ALL") {
        filters.route = logRouteFilter;
      }

      // 모델 필터는 백엔드 API에 없으므로 제외 (필요시 백엔드에 요청)

      // 에러 로그만 필터링 (errorCode가 null이 아닌 것만)
      // 백엔드 API에 onlyError 파라미터가 없으므로 클라이언트 측 필터링 필요
      // 또는 백엔드에 요청하여 추가 필요

      // PII 필터
      if (logHasPiiOnly) {
        filters.hasPiiInput = true; // 또는 hasPiiOutput = true
        // 둘 중 하나라도 true면 PII 포함으로 간주
      }

      const response = await getAdminLogs(filters);

      // 디버깅: 응답 데이터 확인
      console.log("[AdminLogsTab] 응답 데이터:", {
        totalElements: response.totalElements,
        contentLength: response.content?.length ?? 0,
        firstLogTime: response.content?.[0]?.createdAt
          ? new Date(response.content[0].createdAt).toLocaleString("ko-KR")
          : null,
        lastLogTime: response.content?.[response.content.length - 1]?.createdAt
          ? new Date(response.content[response.content.length - 1].createdAt).toLocaleString("ko-KR")
          : null,
        logs: response.content?.slice(0, 3).map((log) => ({
          id: log.id,
          createdAt: log.createdAt,
          createdAtLocal: new Date(log.createdAt).toLocaleString("ko-KR"),
          userId: log.userId,
          domain: log.domain,
        })),
      });

      // 에러 로그만 필터링 (백엔드에서 지원하지 않는 경우 클라이언트 측 필터링)
      let filteredLogs = response.content || [];
      if (logOnlyError) {
        filteredLogs = filteredLogs.filter((item) => item.errorCode != null);
      }

      console.log("[AdminLogsTab] 필터링 후 로그 개수:", filteredLogs.length);
      setLogs(filteredLogs);
    } catch (err) {
      let errorMessage = "로그 조회에 실패했습니다.";
      
      // HttpError인 경우 상세 정보 추출
      if (err instanceof Error && "status" in err) {
        const httpError = err as {
          status?: number;
          statusText?: string;
          body?: unknown;
          message?: string;
        };
        
        if (httpError.status === 500) {
          errorMessage = "서버 오류가 발생했습니다. 백엔드 서버를 확인해주세요.";
          // 백엔드 에러 메시지가 있으면 추가
          if (httpError.body && typeof httpError.body === "object") {
            const body = httpError.body as { message?: string; error?: string };
            if (body.message || body.error) {
              errorMessage += ` (${body.message || body.error})`;
            }
          }
        } else if (httpError.status === 400) {
          errorMessage = "잘못된 요청입니다. 날짜 범위를 확인해주세요.";
        } else if (httpError.status === 401) {
          errorMessage = "인증이 필요합니다. 다시 로그인해주세요.";
        } else if (httpError.status === 403) {
          errorMessage = "관리자 권한이 필요합니다.";
        } else {
          errorMessage = httpError.message || `HTTP ${httpError.status} ${httpError.statusText || ""}`;
        }
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      console.error("[AdminLogsTab] 로그 조회 실패:", {
        error: err,
        period,
        filters: {
          domain: logDomainFilter,
          route: logRouteFilter,
          onlyError: logOnlyError,
          hasPiiOnly: logHasPiiOnly,
        },
      });
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, [
    period,
    selectedDept,
    logDomainFilter,
    logRouteFilter,
    logModelFilter,
    logOnlyError,
    logHasPiiOnly,
  ]);

  // 필터 변경 시 로그 조회
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // 자동 새로고침: 30초마다 최신 로그 확인
  useEffect(() => {
    const intervalId = setInterval(() => {
      void fetchLogs();
    }, 30000); // 30초마다 새로고침

    // 컴포넌트 언마운트 시 인터벌 정리
    return () => {
      clearInterval(intervalId);
    };
  }, [fetchLogs]);

  const filteredItems = logs;

  const totalCount = filteredItems.length;
  const errorCount = filteredItems.filter((i) => i.errorCode).length;

  const piiInputCount = filteredItems.filter((i) => i.hasPiiInput).length;
  const piiOutputCount = filteredItems.filter((i) => i.hasPiiOutput).length;
  const piiCount = filteredItems.filter(
    (i) => i.hasPiiInput || i.hasPiiOutput
  ).length;

  const errorRatioInLogs = totalCount > 0 ? (errorCount / totalCount) * 100 : 0;
  const piiRatioInLogs = totalCount > 0 ? (piiCount / totalCount) * 100 : 0;

  const inputRatioInLogs =
    totalCount > 0 ? (piiInputCount / totalCount) * 100 : 0;
  const outputRatioInLogs =
    totalCount > 0 ? (piiOutputCount / totalCount) * 100 : 0;

  let riskLevel: PiiRiskLevel = "none";
  if (totalCount > 0 && piiCount > 0) {
    if (outputRatioInLogs >= 5 || piiOutputCount >= 3) {
      riskLevel = "high";
    } else if (
      outputRatioInLogs === 0 &&
      (inputRatioInLogs >= 20 || piiInputCount >= 15)
    ) {
      riskLevel = "high";
    } else {
      riskLevel = "warning";
    }
  }

  let activePiiReport;
  switch (riskLevel) {
    case "none":
      activePiiReport = PII_REPORT_NONE;
      break;
    case "high":
      activePiiReport = PII_REPORT_HIGH;
      break;
    case "warning":
    default:
      activePiiReport = PII_REPORT_WARNING;
      break;
  }

  const periodLabel =
    PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? "전체 기간";
  const logDomainLabel =
    LOG_DOMAIN_OPTIONS.find((d) => d.id === logDomainFilter)?.label ??
    "전체 도메인";
  const logRouteLabel =
    LOG_ROUTE_OPTIONS.find((r) => r.id === logRouteFilter)?.label ??
    "전체 라우트";
  const logModelLabel =
    LOG_MODEL_OPTIONS.find((m) => m.id === logModelFilter)?.label ??
    "전체 모델";

  const contextParts: string[] = [
    `기간 ${periodLabel}`,
    `부서 ${selectedDeptLabel}`,
    `도메인 ${logDomainLabel}`,
    `라우트 ${logRouteLabel}`,
    `모델 ${logModelLabel}`,
  ];

  if (logOnlyError) contextParts.push("에러 로그만");
  if (logHasPiiOnly) contextParts.push("PII 포함 로그만");

  const piiContextSummary = contextParts.join(" · ");

  const onRefresh = () => {
    void fetchLogs();
  };

  return (
    <div className="cb-admin-tab-panel cb-admin-tab-panel--logs">
      <AdminFilterBar
        mode="logs"
        value={filterValue}
        onChange={handleFilterChange}
        departments={DEPARTMENT_OPTIONS}
        domainOptions={LOG_DOMAIN_OPTIONS}
        routeOptions={LOG_ROUTE_OPTIONS}
        modelOptions={LOG_MODEL_OPTIONS}
        onRefresh={onRefresh}
      />

      <section className="cb-admin-section cb-admin-section--logs-drilldown">
        <div className="cb-admin-section-header cb-admin-section-header--logs">
          <div className="cb-admin-section-header-main">
            <h3 className="cb-admin-section-title">
              {showRagGapView ? "RAG 갭 분석" : "세부 로그 Drilldown"}
            </h3>
            <span className="cb-admin-section-sub">
              {showRagGapView
                ? "RAG 검색 실패·갭 후보를 모아서 어떤 규정/교육 문서가 추가로 필요할지 확인합니다."
                : "시간 / 도메인 / 라우트 / 모델 / PII(입력/출력) / 에러 기준으로 필터링해서 턴 단위 로그를 확인합니다."}
            </span>
          </div>
          <button
            type="button"
            className="cb-admin-ghost-btn"
            onClick={() => setShowRagGapView((prev) => !prev)}
          >
            {showRagGapView ? "전체 로그 보기" : "RAG 갭 분석"}
          </button>
        </div>

        {showRagGapView ? (
          <AdminRagGapView filterValue={filterValue} />
        ) : (
          <>
            <PiiReportCard
              report={activePiiReport}
              contextSummary={piiContextSummary}
            />

            <div className="cb-admin-trend-summary">
              <div className="cb-admin-trend-pill">
                <span className="cb-admin-trend-label">총 로그</span>
                <span className="cb-admin-trend-value">
                  {totalCount.toLocaleString()}건
                </span>
              </div>
              <div className="cb-admin-trend-pill">
                <span className="cb-admin-trend-label">에러 로그</span>
                <span className="cb-admin-trend-value">
                  {errorCount.toLocaleString()}건
                  {totalCount > 0 && ` (${errorRatioInLogs.toFixed(1)}%)`}
                </span>
              </div>
              <div className="cb-admin-trend-pill">
                <span className="cb-admin-trend-label">PII 포함</span>
                <span className="cb-admin-trend-value">
                  {piiCount.toLocaleString()}건
                  {totalCount > 0 && ` (${piiRatioInLogs.toFixed(1)}%)`}
                </span>
              </div>
            </div>

            {error && (
              <div className="cb-admin-error-message" style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#fee", color: "#c33", borderRadius: "4px" }}>
                ⚠️ {error}
              </div>
            )}

            <div className="cb-admin-table-wrapper cb-admin-table-wrapper--logs">
              {isLoading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>
                  로그를 불러오는 중...
                </div>
              ) : (
                <table className="cb-admin-table cb-admin-table--logs">
                  <thead>
                    <tr>
                      <th>시간</th>
                      <th>user_id</th>
                      <th>user_role</th>
                      <th>부서</th>
                      <th>domain</th>
                      <th>route</th>
                      <th>model</th>
                      <th>PII (입력/출력)</th>
                      <th>latency(ms)</th>
                      <th>error_code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={10} className="cb-admin-table-empty">
                          {error ? "로그를 불러올 수 없습니다." : "조건에 해당하는 로그가 없습니다."}
                        </td>
                      </tr>
                    )}
                    {filteredItems.map((item) => {
                    const hasError = !!item.errorCode;
                    const hasPii = item.hasPiiInput || item.hasPiiOutput;

                    return (
                      <tr
                        key={item.id}
                        className={hasError ? "cb-admin-log-row--error" : ""}
                      >
                        <td>
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleString("ko-KR", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })
                            : "-"}
                        </td>
                        <td>{item.userId}</td>
                        <td>{item.userRole || "-"}</td>
                        <td>{item.department || "-"}</td>
                        <td>{item.domain}</td>
                        <td>{item.route}</td>
                        <td>{item.modelName || "-"}</td>
                        <td>
                          {hasPii ? (
                            <span className="cb-admin-badge cb-admin-badge--pii">
                              {item.hasPiiInput && "입력"}
                              {item.hasPiiInput && item.hasPiiOutput && " / "}
                              {item.hasPiiOutput && "출력"}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>{item.latencyMsTotal.toLocaleString()}</td>
                        <td>
                          {hasError ? (
                            <span className="cb-admin-log-error-code">
                              {item.errorCode}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export default AdminLogsTab;
