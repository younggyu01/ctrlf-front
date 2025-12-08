// src/components/chatbot/AdminDashboardView.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  computePanelPosition,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";

/**
 * 관리자 대시보드 탭 ID
 */
type AdminTabId = "chatbot" | "education" | "quiz" | "metrics" | "accounts";

type PeriodFilter = "7d" | "30d" | "90d";

interface DepartmentOption {
  id: string;
  name: string;
}

/**
 * KPI 카드 공통 타입
 */
interface KpiCard {
  id: string;
  label: string;
  value: string;
  caption?: string;
}

/**
 * 챗봇 탭용 타입들
 */
interface ChatbotVolumePoint {
  label: string;
  count: number;
}

interface ChatbotDomainShare {
  id: string;
  domainLabel: string;
  ratio: number; // %
}

interface PopularKeyword {
  keyword: string;
  count: number;
}

/**
 * 교육 탭용 타입들
 */
interface MandatoryCourseProgress {
  id: string;
  name: string;
  completionRate: number; // 0~100
}

type JobCourseStatus = "in-progress" | "completed" | "not-started";

interface JobCourseSummary {
  id: string;
  title: string;
  status: JobCourseStatus;
  learnerCount: number;
}

interface DeptEducationRow {
  id: string;
  deptName: string;
  targetCount: number;
  completedCount: number;
  completionRate: number;
}

/**
 * 퀴즈 탭용 타입들
 */
interface DeptQuizScoreRow {
  id: string;
  deptName: string;
  avgScore: number;
  participantCount: number;
}

interface QuizSummaryRow {
  id: string;
  quizTitle: string;
  round: number;
  avgScore: number;
  participantCount: number;
  passRate: number; // %
}

interface DifficultQuestion {
  id: string;
  title: string;
  wrongRate: number; // %
}

/**
 * 지표 탭용 타입들
 */
interface MetricItem {
  id: string;
  label: string;
  value: string;
  description?: string;
}

/**
 * 계정/롤 관리 탭 타입들
 */
type RoleKey =
  | "EMPLOYEE"
  | "VIDEO_CREATOR"
  | "VIDEO_REVIEWER"
  | "REPORT_MANAGER"
  | "ADMIN";

type CreatorType = "DEPT_CREATOR" | "GLOBAL_CREATOR" | null;

interface DeptScopeOption {
  id: string;
  name: string;
}

/**
 * 패널 사이즈 / 드래그 / 리사이즈 타입
 * (EduPanel / QuizPanel 과 동일 패턴)
 */
type Size = PanelSize;
type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type ResizeState = {
  resizing: boolean;
  dir: ResizeDirection | null;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startTop: number;
  startLeft: number;
};

type DragState = {
  dragging: boolean;
  startX: number;
  startY: number;
  startTop: number;
  startLeft: number;
};

/**
 * 레이아웃/드래그/리사이즈 상수
 * - 관리자 대시보드는 기본 크기를 조금 더 크게
 */
const MIN_WIDTH = 900;
const MIN_HEIGHT = 560;
const MAX_WIDTH = 1180;
const PANEL_MARGIN = 80;

/**
 * 화면 크기에 맞게 관리자 대시보드 초기 사이즈 계산
 * (EduPanel 의 createInitialSize 와 비슷한 방식)
 */
const createInitialSize = (): Size => {
  if (typeof window === "undefined") {
    // SSR 대비 fallback
    return { width: 980, height: 620 };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, vw - PANEL_MARGIN));
  const height = Math.max(MIN_HEIGHT, vh - PANEL_MARGIN);

  return { width, height };
};

// 계정/롤 관리 탭에서 사용할 부서/범위 옵션
const DEPT_SCOPE_OPTIONS: DeptScopeOption[] = [
  { id: "SEC01", name: "보안운영팀" },
  { id: "DEV01", name: "플랫폼개발팀" },
  { id: "SALES01", name: "기업영업1팀" },
  { id: "ALL_ORG", name: "전사 공통(ALL)" },
];

// (우측 유저 정보 UI는 제거하지만, 계정/롤 탭에서 기본값으로 사용)
const MOCK_USER_INFO = {
  name: "김민수",
  employeeNo: "2025-01234",
  deptCode: "SEC01",
  deptName: "보안운영팀",
};

interface AdminDashboardViewProps {
  onClose?: () => void;
  anchor?: Anchor | null;
  onRequestFocus?: () => void;
}

/**
 * 공통 Mock 데이터
 */
const PERIOD_OPTIONS: { id: PeriodFilter; label: string }[] = [
  { id: "7d", label: "최근 7일" },
  { id: "30d", label: "최근 30일" },
  { id: "90d", label: "최근 90일" },
];

const DEPARTMENT_OPTIONS: DepartmentOption[] = [
  { id: "ALL", name: "전체 부서" },
  { id: "HQ", name: "본사" },
  { id: "SEC", name: "보안운영팀" },
  { id: "DEV", name: "개발팀" },
  { id: "SALES", name: "영업팀" },
];

const TAB_LABELS: Record<AdminTabId, string> = {
  chatbot: "챗봇 이용 현황",
  education: "교육 이수 현황",
  quiz: "퀴즈 성적 현황",
  metrics: "보안·품질 지표",
  accounts: "계정 / 역할 관리",
};

const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  onClose,
  anchor,
  onRequestFocus,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTabId>("chatbot");
  const [period, setPeriod] = useState<PeriodFilter>("30d");
  const [selectedDept, setSelectedDept] = useState<string>("ALL");

  // 계정/롤 관리용 상태
  const [selectedRoles, setSelectedRoles] = useState<RoleKey[]>(["EMPLOYEE"]);
  const [creatorType, setCreatorType] = useState<CreatorType>(null);
  const [creatorDeptScope, setCreatorDeptScope] = useState<string[]>([
    MOCK_USER_INFO.deptCode,
  ]);

  /**
   * === 패널 크기 + 위치 (EduPanel / QuizPanel 과 동일 패턴) ===
   */
  const [size, setSize] = useState<Size>(() => createInitialSize());
  const [panelPos, setPanelPos] = useState(() =>
    computePanelPosition(anchor ?? null, createInitialSize())
  );

  const resizeRef = useRef<ResizeState>({
    resizing: false,
    dir: null,
    startX: 0,
    startY: 0,
    startWidth: size.width,
    startHeight: size.height,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  const dragRef = useRef<DragState>({
    dragging: false,
    startX: 0,
    startY: 0,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  /**
   * 드래그 / 리사이즈 공통 이벤트
   * (QuizPanel / EduPanel 의 로직 그대로 복사)
   */
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      const margin = 16;
      const padding = 32;

      // 1) 리사이즈 중일 때
      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        const maxWidth = Math.max(
          MIN_WIDTH,
          window.innerWidth - padding * 2
        );
        const maxHeight = Math.max(
          MIN_HEIGHT,
          window.innerHeight - padding * 2
        );

        if (resizeState.dir.includes("e")) {
          newWidth = resizeState.startWidth + dx;
        }
        if (resizeState.dir.includes("s")) {
          newHeight = resizeState.startHeight + dy;
        }

        if (resizeState.dir.includes("w")) {
          newWidth = resizeState.startWidth - dx;
          newLeft = resizeState.startLeft + dx;
        }
        if (resizeState.dir.includes("n")) {
          newHeight = resizeState.startHeight - dy;
          newTop = resizeState.startTop + dy;
        }

        newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, newHeight));

        const maxLeft = window.innerWidth - margin - newWidth;
        const maxTop = window.innerHeight - margin - newHeight;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        setSize({ width: newWidth, height: newHeight });
        setPanelPos({ top: newTop, left: newLeft });
        return;
      }

      // 2) 드래그 중일 때
      if (dragState.dragging) {
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        let newTop = dragState.startTop + dy;
        let newLeft = dragState.startLeft + dx;

        const maxLeft = window.innerWidth - margin - size.width;
        const maxTop = window.innerHeight - margin - size.height;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        setPanelPos({ top: newTop, left: newLeft });
      }
    };

    const handleMouseUp = () => {
      if (resizeRef.current.resizing) {
        resizeRef.current.resizing = false;
        resizeRef.current.dir = null;
      }
      if (dragRef.current.dragging) {
        dragRef.current.dragging = false;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [size.width, size.height]);

  /**
   * 리사이즈 핸들 down
   * (모서리/변 8개 모두 동일 함수 사용)
   */
  const handleResizeMouseDown =
    (dir: ResizeDirection) =>
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      // 패널 상호작용 시 포커스 요청
      onRequestFocus?.();

      resizeRef.current = {
        resizing: true,
        dir,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: size.width,
        startHeight: size.height,
        startTop: panelPos.top,
        startLeft: panelPos.left,
      };
      dragRef.current.dragging = false;
    };

  /**
   * 상단 드래그 바 down
   */
  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    // 드래그 시작 시에도 포커스 요청
    onRequestFocus?.();

    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: panelPos.top,
      startLeft: panelPos.left,
    };
    resizeRef.current.resizing = false;
    resizeRef.current.dir = null;
  };

  const handleRefreshClick = () => {
    console.log("[AdminDashboard] 데이터 새로고침", {
      activeTab,
      period,
      selectedDept,
    });
  };

  const handleToggleRole = (role: RoleKey) => {
    setSelectedRoles((prev) => {
      const exists = prev.includes(role);
      if (exists) {
        if (role === "EMPLOYEE" && prev.length === 1) {
          return prev;
        }
        return prev.filter((r) => r !== role);
      }
      return [...prev, role];
    });
  };

  const handleCreatorTypeChange = (next: CreatorType) => {
    setCreatorType(next);

    if (!next) {
      setCreatorDeptScope([MOCK_USER_INFO.deptCode]);
      return;
    }

    if (next === "DEPT_CREATOR") {
      setCreatorDeptScope([MOCK_USER_INFO.deptCode]);
    } else if (next === "GLOBAL_CREATOR") {
      setCreatorDeptScope(["ALL_ORG"]);
    }
  };

  const handleScopeToggle = (deptId: string) => {
    setCreatorDeptScope((prev) => {
      const exists = prev.includes(deptId);
      if (exists) {
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== deptId);
      }
      return [...prev, deptId];
    });
  };

  const handleSaveAccountRoles = () => {
    if (selectedRoles.length === 0) {
      alert("최소 한 개 이상의 기본 역할이 선택되어야 합니다.");
      return;
    }

    if (selectedRoles.includes("VIDEO_CREATOR")) {
      if (!creatorType) {
        alert("영상 제작자 유형을 선택해 주세요.");
        return;
      }
      if (creatorDeptScope.length === 0) {
        alert("제작 가능 부서를 최소 1개 이상 선택해 주세요.");
        return;
      }
    }

    console.log("[AdminDashboard] 계정/롤 설정 저장", {
      user: MOCK_USER_INFO,
      selectedRoles,
      creatorType,
      creatorDeptScope,
    });

    alert("계정/롤 설정이 저장되었습니다. (Mock)");
  };

  /**
   * ========== 탭별 Mock 데이터 ==========
   */

  // 1) 챗봇 탭 KPI + 상세
  const chatbotKpis: KpiCard[] = [
    { id: "todayQuestions", label: "오늘 질문 수", value: "128건" },
    { id: "weekQuestions", label: "최근 7일 질문 수", value: "842건" },
    { id: "activeUsers", label: "활성 사용자 수", value: "63명" },
    { id: "satisfaction", label: "응답 만족도", value: "92%" },
  ];

  const chatbotVolumeMock: ChatbotVolumePoint[] = [
    { label: "월", count: 120 },
    { label: "화", count: 160 },
    { label: "수", count: 210 },
    { label: "목", count: 190 },
    { label: "금", count: 240 },
  ];

  const chatbotDomainShareMock: ChatbotDomainShare[] = [
    { id: "policy", domainLabel: "규정 안내", ratio: 38 },
    { id: "faq", domainLabel: "FAQ", ratio: 26 },
    { id: "edu", domainLabel: "교육", ratio: 18 },
    { id: "quiz", domainLabel: "퀴즈", ratio: 12 },
    { id: "etc", domainLabel: "기타", ratio: 6 },
  ];

  const popularKeywordsMock: PopularKeyword[] = [
    { keyword: "연차 사용 기준", count: 34 },
    { keyword: "개인정보 암호화", count: 27 },
    { keyword: "재택 근무 규정", count: 19 },
    { keyword: "보안 사고 신고", count: 14 },
    { keyword: "교육 이수 확인", count: 11 },
  ];

  // 2) 교육 탭 Mock
  const educationKpis: KpiCard[] = [
    {
      id: "avgCompletion",
      label: "전체 평균 이수율",
      value: "87%",
      caption: "모든 교육 과정 기준",
    },
    {
      id: "notCompleted",
      label: "미이수자 수",
      value: "42명",
    },
    {
      id: "mandatoryAvg",
      label: "4대 의무교육 평균",
      value: "91%",
    },
    {
      id: "jobAvg",
      label: "직무교육 평균",
      value: "82%",
    },
  ];

  const mandatoryCoursesMock: MandatoryCourseProgress[] = [
    { id: "course1", name: "성희롱 예방교육", completionRate: 95 },
    { id: "course2", name: "개인정보보호 교육", completionRate: 92 },
    { id: "course3", name: "직장 내 괴롭힘 예방", completionRate: 88 },
    { id: "course4", name: "장애인 인식개선", completionRate: 89 },
  ];

  const jobCoursesMock: JobCourseSummary[] = [
    {
      id: "job1",
      title: "보안 관제 기초",
      status: "in-progress",
      learnerCount: 38,
    },
    {
      id: "job2",
      title: "AI 기반 위협 탐지",
      status: "completed",
      learnerCount: 21,
    },
    {
      id: "job3",
      title: "CSIRT 실무 사례",
      status: "not-started",
      learnerCount: 12,
    },
  ];

  const deptEducationRowsMock: DeptEducationRow[] = [
    {
      id: "dept1",
      deptName: "보안운영팀",
      targetCount: 28,
      completedCount: 27,
      completionRate: 96,
    },
    {
      id: "dept2",
      deptName: "플랫폼개발팀",
      targetCount: 22,
      completedCount: 18,
      completionRate: 82,
    },
    {
      id: "dept3",
      deptName: "기업영업1팀",
      targetCount: 19,
      completedCount: 15,
      completionRate: 79,
    },
  ];

  // 3) 퀴즈 탭 Mock
  const quizKpis: KpiCard[] = [
    { id: "avgScore", label: "전체 평균 점수", value: "84점" },
    { id: "participants", label: "응시자 수", value: "132명" },
    { id: "passRate", label: "통과율 (80점↑)", value: "78%" },
    { id: "quizParticipation", label: "퀴즈 응시율", value: "73%" },
  ];

  const deptQuizRowsMock: DeptQuizScoreRow[] = [
    { id: "dq1", deptName: "보안운영팀", avgScore: 88, participantCount: 26 },
    { id: "dq2", deptName: "플랫폼개발팀", avgScore: 82, participantCount: 19 },
    { id: "dq3", deptName: "기업영업1팀", avgScore: 79, participantCount: 17 },
  ];

  const quizSummaryRowsMock: QuizSummaryRow[] = [
    {
      id: "qs1",
      quizTitle: "개인정보보호 퀴즈",
      round: 1,
      avgScore: 86,
      participantCount: 57,
      passRate: 81,
    },
    {
      id: "qs2",
      quizTitle: "직장 내 괴롭힘 예방 퀴즈",
      round: 1,
      avgScore: 83,
      participantCount: 49,
      passRate: 75,
    },
    {
      id: "qs3",
      quizTitle: "성희롱 예방교육 퀴즈",
      round: 2,
      avgScore: 88,
      participantCount: 26,
      passRate: 85,
    },
  ];

  const difficultQuestionsMock: DifficultQuestion[] = [
    {
      id: "dq1",
      title: "[개인정보] 민감정보에 해당하는 항목은?",
      wrongRate: 42,
    },
    {
      id: "dq2",
      title: "[보안 사고] 내부 신고 채널이 아닌 것은?",
      wrongRate: 38,
    },
    {
      id: "dq3",
      title: "[괴롭힘 예방] 직장 내 괴롭힘에 해당하지 않는 사례는?",
      wrongRate: 31,
    },
  ];

  // 4) 지표 탭 Mock
  const securityMetricsMock: MetricItem[] = [
    {
      id: "m1",
      label: "PII 차단 횟수",
      value: "128건",
      description: "주민등록번호 / 계좌번호 / 카드번호 등 자동 차단",
    },
    {
      id: "m2",
      label: "외부 도메인 차단",
      value: "36건",
      description: "허용되지 않은 외부 링크 공유 시도",
    },
  ];

  const qualityMetricsMock: MetricItem[] = [
    {
      id: "q1",
      label: "답변 불만족 비율",
      value: "4.2%",
      description: "사용자가 '별로예요'를 선택한 비율",
    },
    {
      id: "q2",
      label: "재질문 비율",
      value: "17%",
      description: "같은 주제에 대해 2회 이상 재질문한 세션 비율",
    },
    {
      id: "q3",
      label: "Out-of-scope 응답 수",
      value: "23건",
      description: "챗봇이 답변 불가로 응답한 횟수",
    },
  ];

  const isRoleChecked = (role: RoleKey) => selectedRoles.includes(role);

  /**
   * ========== 탭별 렌더러 ==========
   */

  const renderFilterBar = () => (
    <div className="cb-admin-filter-bar">
      <div className="cb-admin-filter-group">
        <span className="cb-admin-filter-label">기간</span>
        <div className="cb-admin-filter-control">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="cb-admin-filter-group">
        <span className="cb-admin-filter-label">부서</span>
        <div className="cb-admin-filter-control">
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
          >
            {DEPARTMENT_OPTIONS.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        className="cb-admin-filter-refresh-btn"
        onClick={handleRefreshClick}
      >
        데이터 새로고침
      </button>
    </div>
  );

  const renderKpiRow = (items: KpiCard[]) => (
    <div className="cb-admin-kpi-row" aria-label="핵심 지표 요약">
      {items.map((kpi) => (
        <div key={kpi.id} className="cb-admin-kpi-card">
          <div className="cb-admin-kpi-label">{kpi.label}</div>
          <div className="cb-admin-kpi-value">{kpi.value}</div>
          {kpi.caption && (
            <div className="cb-admin-kpi-caption">{kpi.caption}</div>
          )}
        </div>
      ))}
    </div>
  );

  const renderChatbotTab = () => {
    const max = Math.max(...chatbotVolumeMock.map((p) => p.count), 1);

    return (
      <div className="cb-admin-tab-panel">
        {renderFilterBar()}
        {renderKpiRow(chatbotKpis)}

        <div className="cb-admin-section-row">
          <section className="cb-admin-section">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">질문 수 추이</h3>
              <span className="cb-admin-section-sub">
                일/주 단위로 간단히 확인
              </span>
            </div>
            <div className="cb-admin-bar-chart">
              {chatbotVolumeMock.map((point) => {
                const width = `${Math.round((point.count / max) * 100)}%`;
                return (
                  <div key={point.label} className="cb-admin-bar-row">
                    <span className="cb-admin-bar-label">{point.label}</span>
                    <div className="cb-admin-bar-track">
                      <div
                        className="cb-admin-bar-fill"
                        style={{ width }}
                      />
                    </div>
                    <span className="cb-admin-bar-value">
                      {point.count.toLocaleString()}건
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
                규정 / FAQ / 교육 / 퀴즈 / 기타
              </span>
            </div>
            <div className="cb-admin-domain-list">
              {chatbotDomainShareMock.map((item) => (
                <div key={item.id} className="cb-admin-domain-item">
                  <div className="cb-admin-domain-top">
                    <span className="cb-admin-domain-label">
                      {item.domainLabel}
                    </span>
                    <span className="cb-admin-domain-ratio">
                      {item.ratio}%
                    </span>
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

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">
              최근 많이 질문된 키워드 Top 5
            </h3>
          </div>
          <ul className="cb-admin-keyword-list">
            {popularKeywordsMock.map((item) => (
              <li key={item.keyword} className="cb-admin-keyword-item">
                <span className="cb-admin-keyword-label">{item.keyword}</span>
                <span className="cb-admin-keyword-count">
                  {item.count.toLocaleString()}회
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  };

  const renderEducationTab = () => (
    <div className="cb-admin-tab-panel">
      {renderFilterBar()}
      {renderKpiRow(educationKpis)}

      <div className="cb-admin-section-row">
        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">4대 의무교육 이수율</h3>
          </div>
          <div className="cb-admin-bar-chart">
            {mandatoryCoursesMock.map((course) => (
              <div key={course.id} className="cb-admin-bar-row">
                <span className="cb-admin-bar-label">{course.name}</span>
                <div className="cb-admin-bar-track">
                  <div
                    className="cb-admin-bar-fill"
                    style={{ width: `${course.completionRate}%` }}
                  />
                </div>
                <span className="cb-admin-bar-value">
                  {course.completionRate}%
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">직무교육 이수 현황</h3>
          </div>
          <ul className="cb-admin-course-list">
            {jobCoursesMock.map((course) => (
              <li key={course.id} className="cb-admin-course-item">
                <div className="cb-admin-course-main">
                  <span className="cb-admin-course-title">
                    {course.title}
                  </span>
                  <span
                    className={`cb-admin-course-status is-${course.status}`}
                  >
                    {course.status === "in-progress" && "진행 중"}
                    {course.status === "completed" && "이수 완료"}
                    {course.status === "not-started" && "미시작"}
                  </span>
                </div>
                <div className="cb-admin-course-meta">
                  학습자 {course.learnerCount}명
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="cb-admin-section">
        <div className="cb-admin-section-header">
          <h3 className="cb-admin-section-title">부서별 이수율 현황</h3>
        </div>
        <div className="cb-admin-table-wrapper">
          <table className="cb-admin-table">
            <thead>
              <tr>
                <th>부서</th>
                <th>대상자 수</th>
                <th>이수자 수</th>
                <th>이수율</th>
                <th>미이수자 수</th>
              </tr>
            </thead>
            <tbody>
              {deptEducationRowsMock.map((row) => (
                <tr key={row.id}>
                  <td>{row.deptName}</td>
                  <td>{row.targetCount}</td>
                  <td>{row.completedCount}</td>
                  <td>{row.completionRate}%</td>
                  <td>{row.targetCount - row.completedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderQuizTab = () => (
    <div className="cb-admin-tab-panel">
      {renderFilterBar()}
      {renderKpiRow(quizKpis)}

      <section className="cb-admin-section">
        <div className="cb-admin-section-header">
          <h3 className="cb-admin-section-title">부서별 평균 점수</h3>
        </div>
        <div className="cb-admin-bar-chart">
          {deptQuizRowsMock.map((row) => {
            const width = `${Math.min(
              100,
              Math.round((row.avgScore / 100) * 100)
            )}%`;
            return (
              <div key={row.id} className="cb-admin-bar-row">
                <span className="cb-admin-bar-label">{row.deptName}</span>
                <div className="cb-admin-bar-track">
                  <div
                    className="cb-admin-bar-fill"
                    style={{ width }}
                  />
                </div>
                <span className="cb-admin-bar-value">
                  {row.avgScore}점 / {row.participantCount}명
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="cb-admin-section">
        <div className="cb-admin-section-header">
          <h3 className="cb-admin-section-title">퀴즈별 통계</h3>
        </div>
        <div className="cb-admin-table-wrapper">
          <table className="cb-admin-table">
            <thead>
              <tr>
                <th>퀴즈 제목</th>
                <th>회차</th>
                <th>평균 점수</th>
                <th>응시 수</th>
                <th>통과율</th>
              </tr>
            </thead>
            <tbody>
              {quizSummaryRowsMock.map((row) => (
                <tr key={row.id}>
                  <td>{row.quizTitle}</td>
                  <td>{row.round}회차</td>
                  <td>{row.avgScore}점</td>
                  <td>{row.participantCount}명</td>
                  <td>{row.passRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="cb-admin-section">
        <div className="cb-admin-section-header">
          <h3 className="cb-admin-section-title">
            오답 비율이 높은 문제 Top 3
          </h3>
        </div>
        <ul className="cb-admin-keyword-list">
          {difficultQuestionsMock.map((q) => (
            <li key={q.id} className="cb-admin-keyword-item">
              <span className="cb-admin-keyword-label">{q.title}</span>
              <span className="cb-admin-keyword-count">
                오답률 {q.wrongRate}%
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  const renderMetricsTab = () => (
    <div className="cb-admin-tab-panel">
      {renderFilterBar()}

      <div className="cb-admin-section-row">
        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">보안 관련 지표</h3>
          </div>
          <ul className="cb-admin-metric-list">
            {securityMetricsMock.map((m) => (
              <li key={m.id} className="cb-admin-metric-item">
                <div className="cb-admin-metric-main">
                  <span className="cb-admin-metric-label">{m.label}</span>
                  <span className="cb-admin-metric-value">{m.value}</span>
                </div>
                {m.description && (
                  <div className="cb-admin-metric-desc">{m.description}</div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">품질 관련 지표</h3>
          </div>
          <ul className="cb-admin-metric-list">
            {qualityMetricsMock.map((m) => (
              <li key={m.id} className="cb-admin-metric-item">
                <div className="cb-admin-metric-main">
                  <span className="cb-admin-metric-label">{m.label}</span>
                  <span className="cb-admin-metric-value">{m.value}</span>
                </div>
                {m.description && (
                  <div className="cb-admin-metric-desc">{m.description}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );

  const renderAccountsTab = () => {
    const isVideoCreatorChecked = selectedRoles.includes("VIDEO_CREATOR");
    const availableScopeOptions =
      creatorType === "GLOBAL_CREATOR"
        ? DEPT_SCOPE_OPTIONS
        : DEPT_SCOPE_OPTIONS.filter((d) => d.id !== "ALL_ORG");

    return (
      <div className="cb-admin-tab-panel">
        <div className="cb-admin-account-layout">
          <section className="cb-admin-account-card">
            <h3 className="cb-admin-account-title">사용자 기본 정보</h3>
            <dl className="cb-admin-account-info">
              <div>
                <dt>이름</dt>
                <dd>{MOCK_USER_INFO.name}</dd>
              </div>
              <div>
                <dt>사번</dt>
                <dd>{MOCK_USER_INFO.employeeNo}</dd>
              </div>
              <div>
                <dt>소속 부서</dt>
                <dd>{MOCK_USER_INFO.deptName}</dd>
              </div>
            </dl>
          </section>

          <section className="cb-admin-account-card">
            <h3 className="cb-admin-account-title">역할(Role) 설정</h3>
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
                  checked={isRoleChecked("VIDEO_REVIEWER")}
                  onChange={() => handleToggleRole("VIDEO_REVIEWER")}
                />
                <span>VIDEO_REVIEWER (영상 검토자)</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={isRoleChecked("REPORT_MANAGER")}
                  onChange={() => handleToggleRole("REPORT_MANAGER")}
                />
                <span>REPORT_MANAGER (신고/민원 담당자)</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={isRoleChecked("ADMIN")}
                  onChange={() => handleToggleRole("ADMIN")}
                />
                <span>ADMIN (시스템 관리자)</span>
              </label>
            </div>
          </section>

          <section className="cb-admin-account-card">
            <h3 className="cb-admin-account-title">영상 제작 권한 설정</h3>

            <fieldset className="cb-admin-fieldset">
              <legend>영상 제작자 유형</legend>
              <div className="cb-admin-radio-group">
                <label>
                  <input
                    type="radio"
                    name="creatorType"
                    value="DEPT_CREATOR"
                    disabled={!isVideoCreatorChecked}
                    checked={creatorType === "DEPT_CREATOR"}
                    onChange={() => handleCreatorTypeChange("DEPT_CREATOR")}
                  />
                  <span>부서 한정 제작자 (DEPT_CREATOR)</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="creatorType"
                    value="GLOBAL_CREATOR"
                    disabled={!isVideoCreatorChecked}
                    checked={creatorType === "GLOBAL_CREATOR"}
                    onChange={() => handleCreatorTypeChange("GLOBAL_CREATOR")}
                  />
                  <span>전사 담당 제작자 (GLOBAL_CREATOR)</span>
                </label>
              </div>
            </fieldset>

            <fieldset className="cb-admin-fieldset">
              <legend>제작 가능 부서</legend>

              {!isVideoCreatorChecked && (
                <p className="cb-admin-hint">
                  VIDEO_CREATOR 역할을 선택하면 제작 가능 부서를 설정할 수
                  있습니다.
                </p>
              )}

              {isVideoCreatorChecked && !creatorType && (
                <p className="cb-admin-hint cb-admin-hint--warning">
                  먼저 영상 제작자 유형(DEPT_CREATOR / GLOBAL_CREATOR)을
                  선택해 주세요.
                </p>
              )}

              {isVideoCreatorChecked && creatorType && (
                <div className="cb-admin-scope-grid">
                  {availableScopeOptions.map((dept) => (
                    <label key={dept.id} className="cb-admin-scope-item">
                      <input
                        type="checkbox"
                        value={dept.id}
                        checked={creatorDeptScope.includes(dept.id)}
                        onChange={() => handleScopeToggle(dept.id)}
                      />
                      <span>{dept.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="cb-admin-account-actions">
              <button
                type="button"
                className="cb-admin-secondary-btn"
                onClick={() => {
                  setSelectedRoles(["EMPLOYEE"]);
                  setCreatorType(null);
                  setCreatorDeptScope([MOCK_USER_INFO.deptCode]);
                }}
              >
                취소
              </button>
              <button
                type="button"
                className="cb-admin-primary-btn"
                onClick={handleSaveAccountRoles}
              >
                저장
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  };

  /**
   * ========== 최상위 렌더링 ==========
   */
  const panelStyle: React.CSSProperties = {
    position: "fixed",
    top: panelPos.top,
    left: panelPos.left,
    width: size.width,
    height: size.height,
    zIndex: 9999,
    pointerEvents: "auto",
  };

  const activeTabLabel = TAB_LABELS[activeTab];

  return (
    <div
      className="cb-admin-panel-container"
      style={panelStyle}
      // 패널 어딜 클릭해도 이 패널이 '최상단'으로 오는 느낌을 맞추기 위함
      onMouseDownCapture={() => onRequestFocus?.()}
    >
      <div className="cb-admin-root" style={{ position: "relative" }}>
        {/* Edu/Quiz 와 같은 드래그 바 + 리사이즈 핸들 */}
        <div className="cb-drag-bar" onMouseDown={handleDragMouseDown} />

        <div
          className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-nw"
          onMouseDown={handleResizeMouseDown("nw")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-ne"
          onMouseDown={handleResizeMouseDown("ne")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-sw"
          onMouseDown={handleResizeMouseDown("sw")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-se"
          onMouseDown={handleResizeMouseDown("se")}
        />

        <div
          className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-n"
          onMouseDown={handleResizeMouseDown("n")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-s"
          onMouseDown={handleResizeMouseDown("s")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-w"
          onMouseDown={handleResizeMouseDown("w")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-e"
          onMouseDown={handleResizeMouseDown("e")}
        />

        <header className="cb-admin-header">
          <div className="cb-admin-header-main">
            <span className="cb-admin-badge">SYSTEM ADMIN</span>
            <h2 className="cb-admin-title">관리자 대시보드</h2>
            <p className="cb-admin-subtitle">
              챗봇, 교육, 퀴즈, 지표를 한 곳에서 관리하고 운영 상태를
              모니터링합니다.
            </p>
            <span className="cb-admin-context-chip">
              현재 <strong>{activeTabLabel}</strong> 기준으로 요약을 보고
              있습니다.
            </span>
          </div>

          {onClose && (
            <button
              type="button"
              className="cb-admin-header-close-btn"
              onClick={onClose}
              aria-label="관리자 대시보드 닫기"
            >
              ✕
            </button>
          )}
        </header>

        <nav className="cb-admin-tabs">
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "chatbot" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("chatbot")}
          >
            챗봇
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "education" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("education")}
          >
            교육
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "quiz" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("quiz")}
          >
            퀴즈
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "metrics" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("metrics")}
          >
            지표
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "accounts" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("accounts")}
          >
            계정/롤 관리
          </button>
        </nav>

        {/* 다른 패널처럼: 여기만 스크롤, 바디는 안 흔들리게 */}
        <div className="cb-admin-content">
          {activeTab === "chatbot" && renderChatbotTab()}
          {activeTab === "education" && renderEducationTab()}
          {activeTab === "quiz" && renderQuizTab()}
          {activeTab === "metrics" && renderMetricsTab()}
          {activeTab === "accounts" && renderAccountsTab()}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboardView;
