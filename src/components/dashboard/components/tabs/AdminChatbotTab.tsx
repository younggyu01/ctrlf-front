import React, { useCallback, useEffect, useState } from "react";
import AdminFilterBar from "../../AdminFilterBar";
import type { CommonFilterState } from "../../adminFilterTypes";
import KpiRow from "../KpiRow";
import { DEPARTMENT_OPTIONS } from "../../adminDashboardMocks";
import type {
  PeriodFilter,
  KpiCard,
  ChatbotVolumePoint,
  ChatbotDomainShare,
} from "../../adminDashboardTypes";
import { getChatSummary, getTrends, getDomainShare } from "../../api/chatApi";

interface AdminChatbotTabProps {
  period: PeriodFilter;
  selectedDept: string;
  selectedDeptLabel: string;
  onFilterChange: (filter: CommonFilterState) => void;
}

const AdminChatbotTab: React.FC<AdminChatbotTabProps> = ({
  period,
  selectedDept,
  selectedDeptLabel,
  onFilterChange,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    todayQuestionCount: number;
    averageResponseTime: number;
    piiDetectionRate: number;
    errorRate: number;
    last7DaysQuestionCount: number;
    activeUserCount: number;
    satisfactionRate: number;
    ragUsageRate: number;
  } | null>(null);
  const [volumeData, setVolumeData] = useState<ChatbotVolumePoint[]>([]);
  const [domainData, setDomainData] = useState<ChatbotDomainShare[]>([]);
  const [trendSummary, setTrendSummary] = useState<{
    totalQuestionCount: number;
    averageQuestionCountPerPeriod: number;
    averageErrorRate: number;
  } | null>(null);

  const filterValue: CommonFilterState = {
    period,
    departmentId: selectedDept,
  };

  const handleFilterChange = (next: CommonFilterState) => {
    onFilterChange(next);
  };

  // API 호출 함수
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const department = selectedDept === "ALL" ? undefined : selectedDeptLabel;

      // 병렬로 모든 API 호출 (구현된 API만 사용)
      // 최근 7일 질문 수는 항상 표시해야 하므로 별도로 조회
      const [summaryRes, weekSummaryRes, trendRes, domainRes] =
        await Promise.all([
          getChatSummary(period, department),
          period !== "7d" ? getChatSummary("7d", department) : null, // period가 7d가 아니면 별도 조회
          getTrends(period, department, "week"), // bucket: "week" 기본값
          getDomainShare(period, department),
        ]);

      // 최근 7일 질문 수 계산
      const last7DaysCount =
        period === "7d"
          ? summaryRes.periodQuestionCount || 0
          : weekSummaryRes?.periodQuestionCount || 0;

      // 백엔드 응답을 프론트엔드 형식으로 변환
      setSummary({
        todayQuestionCount: summaryRes.todayQuestionCount || 0,
        averageResponseTime: summaryRes.avgLatencyMs || 0,
        piiDetectionRate: (summaryRes.piiDetectRate || 0) * 100, // 0~1을 %로 변환
        errorRate: (summaryRes.errorRate || 0) * 100, // 0~1을 %로 변환
        last7DaysQuestionCount: last7DaysCount,
        activeUserCount: summaryRes.activeUsers || 0,
        satisfactionRate: (summaryRes.satisfactionRate || 0) * 100, // 0~1을 %로 변환
        ragUsageRate: (summaryRes.ragUsageRate || 0) * 100, // 0~1을 %로 변환
      });

      // 질문 수 · 에러율 추이 요약 정보 저장
      if (trendRes && trendRes.series) {
        const totalCount = trendRes.series.reduce(
          (sum, item) => sum + (item.questionCount || 0),
          0
        );
        const avgCount =
          trendRes.series.length > 0 ? totalCount / trendRes.series.length : 0;
        const avgError =
          trendRes.series.length > 0
            ? trendRes.series.reduce(
                (sum, item) => sum + (item.errorRate || 0),
                0
              ) / trendRes.series.length
            : 0;

        setTrendSummary({
          totalQuestionCount: totalCount,
          averageQuestionCountPerPeriod: avgCount,
          averageErrorRate: avgError * 100, // 0~1을 %로 변환
        });

        // 질문 수 · 에러율 추이 데이터 변환
        setVolumeData(
          trendRes.series.map((item, idx) => ({
            label: item.bucketStart || `구간 ${idx + 1}`,
            count: item.questionCount || 0,
            errorRatio: item.errorRate || 0, // 이미 0~1 형식
          }))
        );
      } else {
        setTrendSummary({
          totalQuestionCount: 0,
          averageQuestionCountPerPeriod: 0,
          averageErrorRate: 0,
        });
        setVolumeData([]);
      }

      // 도메인별 질문 비율 데이터 변환
      setDomainData(
        (domainRes?.items || []).map((item) => ({
          id: (item.domain || "").toLowerCase(),
          domainLabel: item.label || "",
          ratio: (item.share || 0) * 100, // 0~1을 %로 변환
        }))
      );
    } catch (err) {
      console.error("[AdminChatbotTab] API 호출 실패:", err);
      setError(
        err instanceof Error ? err.message : "데이터를 불러오는데 실패했습니다."
      );
    } finally {
      setLoading(false);
    }
  }, [period, selectedDept, selectedDeptLabel]);

  // 필터 변경 시 데이터 재조회
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 자동 새로고침: 10초마다 최신 데이터 확인
  useEffect(() => {
    const intervalId = setInterval(() => {
      void fetchData();
    }, 10000); // 10초마다 새로고침

    // 컴포넌트 언마운트 시 인터벌 정리
    return () => {
      clearInterval(intervalId);
    };
  }, [fetchData]);

  // KPI 데이터 생성
  const primaryKpis: KpiCard[] = summary
    ? [
        {
          id: "todayQuestions",
          label: "오늘 질문 수",
          value: `${(summary.todayQuestionCount || 0).toLocaleString()}건`,
        },
        {
          id: "avgLatency",
          label: "평균 응답 시간",
          value: `${summary.averageResponseTime || 0}ms`,
        },
        {
          id: "piiRatio",
          label: "PII 감지 비율",
          value: `${(summary.piiDetectionRate || 0).toFixed(1)}%`,
        },
        {
          id: "errorRatio",
          label: "에러율",
          value: `${(summary.errorRate || 0).toFixed(1)}%`,
        },
      ]
    : [];

  const secondaryKpis: KpiCard[] = summary
    ? [
        {
          id: "weekQuestions",
          label: "최근 7일 질문 수",
          value: `${(summary.last7DaysQuestionCount || 0).toLocaleString()}건`,
          caption: `일평균 약 ${Math.round(
            (summary.last7DaysQuestionCount || 0) / 7
          )}건`,
        },
        {
          id: "activeUsers",
          label: "활성 사용자 수",
          value: `${summary.activeUserCount || 0}명`,
          caption: `최근 ${
            period === "7d" ? "7일" : period === "30d" ? "30일" : "90일"
          } 기준`,
        },
        {
          id: "satisfaction",
          label: "응답 만족도",
          value: `${(summary.satisfactionRate || 0).toFixed(1)}%`,
          caption: "피드백 기준",
        },
        {
          id: "ragUsage",
          label: "RAG 사용 비율",
          value: `${(summary.ragUsageRate || 0).toFixed(1)}%`,
          caption: "전체 질문 대비",
        },
      ]
    : [];

  const max = Math.max(...volumeData.map((p) => p.count), 1);
  const total = trendSummary
    ? trendSummary.totalQuestionCount
    : volumeData.reduce((sum, p) => sum + p.count, 0);
  const avg = trendSummary
    ? trendSummary.averageQuestionCountPerPeriod
    : Math.round(total / volumeData.length);
  const avgErrorRatio = trendSummary
    ? trendSummary.averageErrorRate / 100
    : volumeData.length > 0
    ? volumeData.reduce((sum, p) => sum + (p.errorRatio ?? 0), 0) /
      volumeData.length
    : null;

  return (
    <div className="cb-admin-tab-panel">
      <AdminFilterBar
        mode="overview"
        value={filterValue}
        onChange={handleFilterChange}
        departments={DEPARTMENT_OPTIONS}
        onRefresh={() => {
          fetchData();
        }}
      />
      {loading && (
        <div style={{ padding: "20px", textAlign: "center" }}>
          데이터를 불러오는 중...
        </div>
      )}
      {error && (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            color: "#d32f2f",
            backgroundColor: "#ffebee",
            borderRadius: "4px",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      )}

      <KpiRow items={primaryKpis} />
      <KpiRow items={secondaryKpis} />

      <div className="cb-admin-section-row">
        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">질문 수 · 에러율 추이</h3>
            <span className="cb-admin-section-sub">
              기간별 질문량과 에러율을 함께 확인합니다.
            </span>
          </div>

          <div className="cb-admin-trend-summary">
            <div className="cb-admin-trend-pill">
              <span className="cb-admin-trend-label">기간 총 질문 수</span>
              <span className="cb-admin-trend-value">
                {total.toLocaleString()}건
              </span>
            </div>
            <div className="cb-admin-trend-pill">
              <span className="cb-admin-trend-label">구간당 평균</span>
              <span className="cb-admin-trend-value">
                {avg.toLocaleString()}건
              </span>
            </div>
            {avgErrorRatio !== null && (
              <div className="cb-admin-trend-pill">
                <span className="cb-admin-trend-label">평균 에러율</span>
                <span className="cb-admin-trend-value">
                  {(avgErrorRatio * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>

          <div className="cb-admin-bar-chart">
            {volumeData.map((point) => {
              const ratio = point.count / max;
              const widthPercent = 40 + ratio * 60; // 40% ~ 100%
              const width = `${Math.round(widthPercent)}%`;
              const errorRatioPercent =
                typeof point.errorRatio === "number"
                  ? (point.errorRatio * 100).toFixed(1)
                  : null;

              return (
                <div key={point.label} className="cb-admin-bar-row">
                  <span className="cb-admin-bar-label">{point.label}</span>
                  <div className="cb-admin-bar-track">
                    <div className="cb-admin-bar-fill" style={{ width }} />
                  </div>
                  <span className="cb-admin-bar-value">
                    {point.count.toLocaleString()}건
                    {errorRatioPercent && (
                      <span className="cb-admin-bar-subvalue">
                        {" · 에러율 "}
                        {errorRatioPercent}%
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">도메인별 질문 비율</h3>
            <span className="cb-admin-section-sub">
              규정 / FAQ / 교육 / 퀴즈 / 기타 비중
            </span>
          </div>
          <div className="cb-admin-domain-list">
            {domainData.map((item) => (
              <div key={item.id} className="cb-admin-domain-item">
                <div className="cb-admin-domain-top">
                  <span className="cb-admin-domain-label">
                    {item.domainLabel}
                  </span>
                  <span className="cb-admin-domain-ratio">{item.ratio}%</span>
                </div>
                <div className="cb-admin-domain-track">
                  <div
                    className="cb-admin-domain-fill"
                    style={{ width: `${item.ratio}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminChatbotTab;
