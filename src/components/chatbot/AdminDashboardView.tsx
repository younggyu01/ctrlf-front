// src/components/chatbot/AdminDashboardView.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  computePanelPosition,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";
import AdminFilterBar from "./AdminFilterBar";
import type {
  CommonFilterState,
  PeriodPreset,
  DepartmentOption,
} from "./adminFilterTypes";

/**
 * 관리자 대시보드 탭 ID
 */
type AdminTabId =
  | "chatbot"
  | "education"
  | "quiz"
  | "metrics"
  | "accounts"
  | "logs";

// adminFilterTypes 의 PeriodPreset 을 그대로 사용
type PeriodFilter = PeriodPreset;

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
  /**
   * 해당 구간 에러율 (0~1, optional)
   * - 1차 스프린트: 질문 수 + 에러율 추이를 함께 보기 위한 필드
   */
  errorRatio?: number;
}

interface ChatbotDomainShare {
  id: string;
  domainLabel: string;
  ratio: number; // %
}

interface ChatbotRouteShare {
  id: string;
  routeLabel: string;
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

interface PiiTrendPoint {
  label: string;
  inputRatio: number; // 입력 PII 비율 (%)
  outputRatio: number; // 출력 PII 비율 (%)
}

interface LatencyBucket {
  label: string;
  count: number; // 해당 구간 응답 건수
}

interface ModelLatency {
  id: string;
  modelLabel: string;
  avgMs: number; // 평균 응답 시간(ms)
}

/**
 * 세부 로그 탭 타입들
 */
interface LogListItem {
  id: string;
  createdAt: string; // '2025-12-09 10:21:34'
  userId: string;
  userRole: string;
  department: string;
  domain: string;
  route: string;
  modelName: string;
  hasPiiInput: boolean;
  hasPiiOutput: boolean;
  ragUsed: boolean;
  ragSourceCount: number;
  latencyMsTotal: number;
  errorCode: string | null;
}

/**
 * 계정/롤 관리 탭 타입들
 * - Keycloak 롤 네이밍과 맞춤
 */
type RoleKey =
  | "EMPLOYEE"
  | "VIDEO_CREATOR"
  | "CONTENTS_REVIEWER"
  | "COMPLAINT_MANAGER"
  | "SYSTEM_ADMIN";

type CreatorType = "DEPT_CREATOR" | "GLOBAL_CREATOR" | null;

interface DeptScopeOption {
  id: string;
  name: string;
}

interface AdminUserSummary {
  id: string;
  name: string;
  employeeNo: string;
  deptCode: string;
  deptName: string;
  roles: RoleKey[];
  creatorType?: CreatorType;
  creatorDeptScope?: string[];
}

type AccountMessageType = "info" | "success" | "warning" | "error";

interface AccountMessage {
  type: AccountMessageType;
  text: string;
}

/** 롤 한글 라벨 매핑 (요약 표시용) */
const ROLE_LABELS: Record<RoleKey, string> = {
  EMPLOYEE: "EMPLOYEE (기본)",
  VIDEO_CREATOR: "VIDEO_CREATOR (영상 제작자)",
  CONTENTS_REVIEWER: "CONTENTS_REVIEWER (콘텐츠 검토자)",
  COMPLAINT_MANAGER: "COMPLAINT_MANAGER (신고 관리자)",
  SYSTEM_ADMIN: "SYSTEM_ADMIN (시스템 관리자)",
};

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

/**
 * 계정/롤 관리 탭에서 사용할 부서/범위 옵션
 * - 프로젝트 기준 부서로 통일
 */
const DEPT_SCOPE_OPTIONS: DeptScopeOption[] = [
  { id: "GA", name: "총무팀" },
  { id: "PLAN", name: "기획팀" },
  { id: "MKT", name: "마케팅팀" },
  { id: "HR", name: "인사팀" },
  { id: "FIN", name: "재무팀" },
  { id: "DEV", name: "개발팀" },
  { id: "SALES", name: "영업팀" },
  { id: "LEGAL", name: "법무팀" },
  { id: "ALL_ORG", name: "전사 공통(ALL)" },
];

// 계정/롤 탭에서 사용할 Mock 사용자 리스트
const MOCK_USERS: AdminUserSummary[] = [
  {
    id: "user-001",
    name: "김민수",
    employeeNo: "2025-01234",
    deptCode: "DEV",
    deptName: "개발팀",
    roles: ["SYSTEM_ADMIN", "EMPLOYEE"],
    creatorType: "GLOBAL_CREATOR",
    creatorDeptScope: ["ALL_ORG"],
  },
  {
    id: "user-002",
    name: "이서연",
    employeeNo: "2024-00321",
    deptCode: "HR",
    deptName: "인사팀",
    roles: ["EMPLOYEE", "COMPLAINT_MANAGER"],
  },
  {
    id: "user-003",
    name: "박지훈",
    employeeNo: "2023-00811",
    deptCode: "MKT",
    deptName: "마케팅팀",
    roles: ["EMPLOYEE", "VIDEO_CREATOR"],
    creatorType: "DEPT_CREATOR",
    creatorDeptScope: ["MKT"],
  },
  {
    id: "user-004",
    name: "최가영",
    employeeNo: "2022-00109",
    deptCode: "FIN",
    deptName: "재무팀",
    roles: ["EMPLOYEE"],
  },
  {
    id: "user-005",
    name: "정우진",
    employeeNo: "2021-00567",
    deptCode: "GA",
    deptName: "총무팀",
    roles: ["EMPLOYEE", "CONTENTS_REVIEWER"],
  },
  {
    id: "user-006",
    name: "한소연",
    employeeNo: "2020-00002",
    deptCode: "PLAN",
    deptName: "기획팀",
    roles: ["EMPLOYEE"],
  },
];

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

/**
 * 프로젝트 기준 부서 옵션
 * - 총무, 기획, 마케팅, 인사, 재무, 개발, 영업, 법무
 */
const DEPARTMENT_OPTIONS: DepartmentOption[] = [
  { id: "ALL", name: "전체 부서" },
  { id: "GA", name: "총무팀" },
  { id: "PLAN", name: "기획팀" },
  { id: "MKT", name: "마케팅팀" },
  { id: "HR", name: "인사팀" },
  { id: "FIN", name: "재무팀" },
  { id: "DEV", name: "개발팀" },
  { id: "SALES", name: "영업팀" },
  { id: "LEGAL", name: "법무팀" },
];

const TAB_LABELS: Record<AdminTabId, string> = {
  chatbot: "챗봇 이용 현황",
  education: "교육 이수 현황",
  quiz: "퀴즈 성적 현황",
  metrics: "보안·품질 지표",
  accounts: "계정 / 역할 관리",
  logs: "세부 로그 조회",
};

/**
 * ====== 챗봇 탭 – 기간별 Mock 데이터 ======
 */

// Primary KPI: 오늘 기준 필수 지표
const CHATBOT_PRIMARY_KPIS_BY_PERIOD: Record<PeriodFilter, KpiCard[]> = {
  "7d": [
    { id: "todayQuestions", label: "오늘 질문 수", value: "164건" },
    { id: "avgLatency", label: "평균 응답 시간", value: "420ms" },
    { id: "piiRatio", label: "PII 감지 비율", value: "3.6%" },
    { id: "errorRatio", label: "에러율", value: "0.8%" },
  ],
  "30d": [
    { id: "todayQuestions", label: "오늘 질문 수", value: "158건" },
    { id: "avgLatency", label: "평균 응답 시간", value: "415ms" },
    { id: "piiRatio", label: "PII 감지 비율", value: "3.4%" },
    { id: "errorRatio", label: "에러율", value: "0.9%" },
  ],
  "90d": [
    { id: "todayQuestions", label: "오늘 질문 수", value: "149건" },
    { id: "avgLatency", label: "평균 응답 시간", value: "438ms" },
    { id: "piiRatio", label: "PII 감지 비율", value: "3.9%" },
    { id: "errorRatio", label: "에러율", value: "1.0%" },
  ],
};

// Secondary KPI: 운영/활용도 지표
const CHATBOT_SECONDARY_KPIS_BY_PERIOD: Record<PeriodFilter, KpiCard[]> = {
  "7d": [
    {
      id: "weekQuestions",
      label: "최근 7일 질문 수",
      value: "1,124건",
      caption: "일평균 약 160건",
    },
    {
      id: "activeUsers",
      label: "활성 사용자 수",
      value: "63명",
      caption: "최근 7일 기준",
    },
    {
      id: "satisfaction",
      label: "응답 만족도",
      value: "94%",
      caption: "피드백 기준",
    },
    {
      id: "ragUsage",
      label: "RAG 사용 비율",
      value: "78%",
      caption: "전체 질문 대비",
    },
  ],
  "30d": [
    {
      id: "weekQuestions",
      label: "최근 7일 질문 수",
      value: "1,038건",
      caption: "일평균 약 148건",
    },
    {
      id: "activeUsers",
      label: "활성 사용자 수",
      value: "102명",
      caption: "최근 30일 기준",
    },
    {
      id: "satisfaction",
      label: "응답 만족도",
      value: "92%",
      caption: "피드백 기준",
    },
    {
      id: "ragUsage",
      label: "RAG 사용 비율",
      value: "80%",
      caption: "전체 질문 대비",
    },
  ],
  "90d": [
    {
      id: "weekQuestions",
      label: "최근 7일 질문 수",
      value: "986건",
      caption: "일평균 약 141건",
    },
    {
      id: "activeUsers",
      label: "활성 사용자 수",
      value: "157명",
      caption: "최근 90일 기준",
    },
    {
      id: "satisfaction",
      label: "응답 만족도",
      value: "90%",
      caption: "피드백 기준",
    },
    {
      id: "ragUsage",
      label: "RAG 사용 비율",
      value: "77%",
      caption: "전체 질문 대비",
    },
  ],
};

// 요일/주/월 단위 질문 수 + 에러율
const CHATBOT_VOLUME_BY_PERIOD: Record<PeriodFilter, ChatbotVolumePoint[]> = {
  "7d": [
    { label: "월", count: 168, errorRatio: 0.008 },
    { label: "화", count: 174, errorRatio: 0.007 },
    { label: "수", count: 189, errorRatio: 0.007 },
    { label: "목", count: 205, errorRatio: 0.009 },
    { label: "금", count: 223, errorRatio: 0.01 },
    { label: "토", count: 102, errorRatio: 0.006 },
    { label: "일", count: 63, errorRatio: 0.005 },
  ],
  "30d": [
    { label: "1주", count: 780, errorRatio: 0.009 },
    { label: "2주", count: 842, errorRatio: 0.009 },
    { label: "3주", count: 918, errorRatio: 0.008 },
    { label: "4주", count: 976, errorRatio: 0.01 },
  ],
  "90d": [
    { label: "1개월", count: 2310, errorRatio: 0.011 },
    { label: "2개월", count: 2480, errorRatio: 0.01 },
    { label: "3개월", count: 2625, errorRatio: 0.01 },
  ],
};

// 도메인별 비율
const CHATBOT_DOMAIN_SHARE_BY_PERIOD: Record<
  PeriodFilter,
  ChatbotDomainShare[]
> = {
  "7d": [
    { id: "policy", domainLabel: "규정 안내", ratio: 35 },
    { id: "faq", domainLabel: "FAQ", ratio: 23 },
    { id: "edu", domainLabel: "교육", ratio: 21 },
    { id: "quiz", domainLabel: "퀴즈", ratio: 12 },
    { id: "etc", domainLabel: "기타", ratio: 9 },
  ],
  "30d": [
    { id: "policy", domainLabel: "규정 안내", ratio: 36 },
    { id: "faq", domainLabel: "FAQ", ratio: 26 },
    { id: "edu", domainLabel: "교육", ratio: 19 },
    { id: "quiz", domainLabel: "퀴즈", ratio: 11 },
    { id: "etc", domainLabel: "기타", ratio: 8 },
  ],
  "90d": [
    { id: "policy", domainLabel: "규정 안내", ratio: 33 },
    { id: "faq", domainLabel: "FAQ", ratio: 28 },
    { id: "edu", domainLabel: "교육", ratio: 18 },
    { id: "quiz", domainLabel: "퀴즈", ratio: 10 },
    { id: "etc", domainLabel: "기타", ratio: 11 },
  ],
};

// 라우트별 비율
const CHATBOT_ROUTE_SHARE_BY_PERIOD: Record<
  PeriodFilter,
  ChatbotRouteShare[]
> = {
  "7d": [
    { id: "route_rag_internal", routeLabel: "RAG 기반 내부 규정", ratio: 49 },
    { id: "route_llm_only", routeLabel: "LLM 단독 답변", ratio: 20 },
    {
      id: "route_incident",
      routeLabel: "Incident 신고 라우트",
      ratio: 14,
    },
    {
      id: "route_faq_template",
      routeLabel: "FAQ 템플릿 응답",
      ratio: 10,
    },
    { id: "route_other", routeLabel: "기타/실험 라우트", ratio: 7 },
  ],
  "30d": [
    { id: "route_rag_internal", routeLabel: "RAG 기반 내부 규정", ratio: 50 },
    { id: "route_llm_only", routeLabel: "LLM 단독 답변", ratio: 19 },
    {
      id: "route_incident",
      routeLabel: "Incident 신고 라우트",
      ratio: 14,
    },
    {
      id: "route_faq_template",
      routeLabel: "FAQ 템플릿 응답",
      ratio: 10,
    },
    { id: "route_other", routeLabel: "기타/실험 라우트", ratio: 7 },
  ],
  "90d": [
    { id: "route_rag_internal", routeLabel: "RAG 기반 내부 규정", ratio: 47 },
    { id: "route_llm_only", routeLabel: "LLM 단독 답변", ratio: 22 },
    {
      id: "route_incident",
      routeLabel: "Incident 신고 라우트",
      ratio: 13,
    },
    {
      id: "route_faq_template",
      routeLabel: "FAQ 템플릿 응답",
      ratio: 9,
    },
    { id: "route_other", routeLabel: "기타/실험 라우트", ratio: 9 },
  ],
};

// 키워드 Top 5 (헤더가 Top 5라서 개수는 유지)
const POPULAR_KEYWORDS_BY_PERIOD: Record<PeriodFilter, PopularKeyword[]> = {
  "7d": [
    { keyword: "연차 사용 기준", count: 18 },
    { keyword: "재택 근무 규정", count: 15 },
    { keyword: "출장비 정산", count: 11 },
    { keyword: "보안 사고 신고", count: 9 },
    { keyword: "교육 이수 확인", count: 8 },
  ],
  "30d": [
    { keyword: "연차 사용 기준", count: 39 },
    { keyword: "개인정보 암호화", count: 32 },
    { keyword: "재택 근무 규정", count: 24 },
    { keyword: "보안 사고 신고", count: 19 },
    { keyword: "교육 이수 확인", count: 15 },
  ],
  "90d": [
    { keyword: "개인정보 암호화", count: 63 },
    { keyword: "직장 내 괴롭힘 예방", count: 46 },
    { keyword: "성희롱 예방 교육", count: 40 },
    { keyword: "모바일 기기 반출", count: 31 },
    { keyword: "원격 접속 보안", count: 27 },
  ],
};

/**
 * 세부 로그 탭 – 필터 옵션 & Mock 데이터
 */
const LOG_DOMAIN_OPTIONS = [
  { id: "ALL", label: "전체 도메인" },
  { id: "POLICY", label: "POLICY (규정)" },
  { id: "INCIDENT", label: "INCIDENT (신고)" },
  { id: "EDUCATION", label: "EDUCATION (교육)" },
  { id: "GENERAL", label: "GENERAL (일반)" },
];

const LOG_ROUTE_OPTIONS = [
  { id: "ALL", label: "전체 라우트" },
  { id: "ROUTE_RAG_INTERNAL", label: "ROUTE_RAG_INTERNAL" },
  { id: "ROUTE_LLM_ONLY", label: "ROUTE_LLM_ONLY" },
  { id: "ROUTE_INCIDENT", label: "ROUTE_INCIDENT" },
];

const LOG_MODEL_OPTIONS = [
  { id: "ALL", label: "전체 모델" },
  { id: "gpt-4o-mini", label: "gpt-4o-mini" },
  { id: "gpt-4.1", label: "gpt-4.1" },
  { id: "rerank+gpt-4o-mini", label: "rerank + gpt-4o-mini" },
];

/**
 * 프로젝트 부서 기준 + 데이터 양을 늘린 세부 로그 Mock
 */
const LOG_LIST_MOCK: LogListItem[] = [
  {
    id: "log-001",
    createdAt: "2025-12-09 10:21:34",
    userId: "2025-01234",
    userRole: "EMPLOYEE",
    department: "개발팀",
    domain: "POLICY",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4o-mini",
    hasPiiInput: true,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 4,
    latencyMsTotal: 380,
    errorCode: null,
  },
  {
    id: "log-002",
    createdAt: "2025-12-09 10:18:02",
    userId: "2024-00011",
    userRole: "EMPLOYEE",
    department: "영업팀",
    domain: "GENERAL",
    route: "ROUTE_LLM_ONLY",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: false,
    ragSourceCount: 0,
    latencyMsTotal: 290,
    errorCode: null,
  },
  {
    id: "log-003",
    createdAt: "2025-12-09 09:57:41",
    userId: "2023-00987",
    userRole: "EMPLOYEE",
    department: "인사팀",
    domain: "INCIDENT",
    route: "ROUTE_INCIDENT",
    modelName: "rerank+gpt-4o-mini",
    hasPiiInput: true,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 6,
    latencyMsTotal: 1280,
    errorCode: null,
  },
  {
    id: "log-004",
    createdAt: "2025-12-09 09:45:09",
    userId: "2022-00421",
    userRole: "EMPLOYEE",
    department: "법무팀",
    domain: "INCIDENT",
    route: "ROUTE_INCIDENT",
    modelName: "gpt-4.1",
    hasPiiInput: true,
    hasPiiOutput: true,
    ragUsed: true,
    ragSourceCount: 5,
    latencyMsTotal: 2150,
    errorCode: "INCIDENT_ROUTE_TIMEOUT",
  },
  {
    id: "log-005",
    createdAt: "2025-12-09 09:33:27",
    userId: "2024-00312",
    userRole: "EMPLOYEE",
    department: "총무팀",
    domain: "EDUCATION",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 3,
    latencyMsTotal: 510,
    errorCode: null,
  },
  {
    id: "log-006",
    createdAt: "2025-12-09 09:10:03",
    userId: "2020-00002",
    userRole: "SYSTEM_ADMIN",
    department: "기획팀",
    domain: "POLICY",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 2,
    latencyMsTotal: 430,
    errorCode: null,
  },
  {
    id: "log-007",
    createdAt: "2025-12-09 08:58:47",
    userId: "2021-01022",
    userRole: "EMPLOYEE",
    department: "마케팅팀",
    domain: "GENERAL",
    route: "ROUTE_LLM_ONLY",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: false,
    ragSourceCount: 0,
    latencyMsTotal: 312,
    errorCode: null,
  },
  {
    id: "log-008",
    createdAt: "2025-12-09 08:41:03",
    userId: "2023-00119",
    userRole: "EMPLOYEE",
    department: "재무팀",
    domain: "POLICY",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4o-mini",
    hasPiiInput: true,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 5,
    latencyMsTotal: 502,
    errorCode: null,
  },
  {
    id: "log-009",
    createdAt: "2025-12-09 08:20:19",
    userId: "2022-00771",
    userRole: "EMPLOYEE",
    department: "인사팀",
    domain: "EDUCATION",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 2,
    latencyMsTotal: 456,
    errorCode: null,
  },
  {
    id: "log-010",
    createdAt: "2025-12-08 17:42:51",
    userId: "2020-00007",
    userRole: "EMPLOYEE",
    department: "영업팀",
    domain: "POLICY",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "rerank+gpt-4o-mini",
    hasPiiInput: true,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 8,
    latencyMsTotal: 1310,
    errorCode: null,
  },
  {
    id: "log-011",
    createdAt: "2025-12-08 17:15:03",
    userId: "2023-00890",
    userRole: "EMPLOYEE",
    department: "마케팅팀",
    domain: "GENERAL",
    route: "ROUTE_LLM_ONLY",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: false,
    ragSourceCount: 0,
    latencyMsTotal: 275,
    errorCode: null,
  },
  {
    id: "log-012",
    createdAt: "2025-12-08 16:59:44",
    userId: "2021-00432",
    userRole: "EMPLOYEE",
    department: "총무팀",
    domain: "POLICY",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4.1",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 3,
    latencyMsTotal: 842,
    errorCode: null,
  },
  {
    id: "log-013",
    createdAt: "2025-12-08 16:30:12",
    userId: "2024-01001",
    userRole: "EMPLOYEE",
    department: "법무팀",
    domain: "INCIDENT",
    route: "ROUTE_INCIDENT",
    modelName: "gpt-4.1",
    hasPiiInput: true,
    hasPiiOutput: true,
    ragUsed: true,
    ragSourceCount: 7,
    latencyMsTotal: 2320,
    errorCode: "INCIDENT_ROUTE_TIMEOUT",
  },
  {
    id: "log-014",
    createdAt: "2025-12-08 15:57:37",
    userId: "2022-00021",
    userRole: "EMPLOYEE",
    department: "기획팀",
    domain: "GENERAL",
    route: "ROUTE_LLM_ONLY",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: false,
    ragSourceCount: 0,
    latencyMsTotal: 301,
    errorCode: null,
  },
  {
    id: "log-015",
    createdAt: "2025-12-08 15:33:09",
    userId: "2023-00345",
    userRole: "EMPLOYEE",
    department: "재무팀",
    domain: "POLICY",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4o-mini",
    hasPiiInput: true,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 4,
    latencyMsTotal: 497,
    errorCode: null,
  },
  {
    id: "log-016",
    createdAt: "2025-12-08 15:11:54",
    userId: "2021-00229",
    userRole: "EMPLOYEE",
    department: "개발팀",
    domain: "EDUCATION",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 3,
    latencyMsTotal: 462,
    errorCode: null,
  },
  {
    id: "log-017",
    createdAt: "2025-12-08 14:49:20",
    userId: "2020-00008",
    userRole: "VIDEO_CREATOR",
    department: "마케팅팀",
    domain: "EDUCATION",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 5,
    latencyMsTotal: 521,
    errorCode: null,
  },
  {
    id: "log-018",
    createdAt: "2025-12-08 14:22:06",
    userId: "2024-00933",
    userRole: "EMPLOYEE",
    department: "총무팀",
    domain: "GENERAL",
    route: "ROUTE_LLM_ONLY",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: false,
    ragSourceCount: 0,
    latencyMsTotal: 287,
    errorCode: null,
  },
  {
    id: "log-019",
    createdAt: "2025-12-08 13:58:17",
    userId: "2023-00217",
    userRole: "EMPLOYEE",
    department: "영업팀",
    domain: "POLICY",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "rerank+gpt-4o-mini",
    hasPiiInput: true,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 6,
    latencyMsTotal: 1453,
    errorCode: null,
  },
  {
    id: "log-020",
    createdAt: "2025-12-08 13:30:42",
    userId: "2022-00661",
    userRole: "EMPLOYEE",
    department: "법무팀",
    domain: "POLICY",
    route: "ROUTE_RAG_INTERNAL",
    modelName: "gpt-4o-mini",
    hasPiiInput: false,
    hasPiiOutput: false,
    ragUsed: true,
    ragSourceCount: 4,
    latencyMsTotal: 412,
    errorCode: null,
  },
];

const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  onClose,
  anchor,
  onRequestFocus,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTabId>("chatbot");
  const [period, setPeriod] = useState<PeriodFilter>("30d");
  const [selectedDept, setSelectedDept] = useState<string>("ALL");

  // 계정/롤 관리용 상태: 사용자 리스트 + 선택 + 편집 버퍼
  const [userList, setUserList] =
    useState<AdminUserSummary[]>(MOCK_USERS);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    MOCK_USERS[0]?.id ?? null,
  );

  const [selectedRoles, setSelectedRoles] = useState<RoleKey[]>(
    MOCK_USERS[0]?.roles ?? ["EMPLOYEE"],
  );
  const [creatorType, setCreatorType] = useState<CreatorType>(
    MOCK_USERS[0]?.creatorType ?? null,
  );
  const [creatorDeptScope, setCreatorDeptScope] = useState<string[]>(
    MOCK_USERS[0]?.creatorDeptScope ??
    (MOCK_USERS[0] ? [MOCK_USERS[0].deptCode] : []),
  );

  // 계정/롤 관리용 검색/필터 상태
  const [accountMessage, setAccountMessage] = useState<AccountMessage | null>(null);
  const [userSearchKeyword, setUserSearchKeyword] = useState("");
  const [userDeptFilter, setUserDeptFilter] = useState<string>("ALL");
  const [userRoleFilter, setUserRoleFilter] =
    useState<RoleKey | "ALL">("ALL");

  // 세부 로그 탭 필터 상태
  const [logDomainFilter, setLogDomainFilter] = useState<string>("ALL");
  const [logRouteFilter, setLogRouteFilter] = useState<string>("ALL");
  const [logModelFilter, setLogModelFilter] = useState<string>("ALL");
  const [logOnlyError, setLogOnlyError] = useState<boolean>(false);
  const [logHasPiiOnly, setLogHasPiiOnly] = useState<boolean>(false);

  /**
   * === 패널 크기 + 위치 (EduPanel / QuizPanel 과 동일 패턴) ===
   */
  const [size, setSize] = useState<Size>(() => createInitialSize());
  const [panelPos, setPanelPos] = useState(() =>
    computePanelPosition(anchor ?? null, createInitialSize()),
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
          window.innerWidth - padding * 2,
        );
        const maxHeight = Math.max(
          MIN_HEIGHT,
          window.innerHeight - padding * 2,
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
   */
  const handleResizeMouseDown =
    (dir: ResizeDirection) =>
      (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
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

      // 현재 선택된 사용자 (있으면)
      const currentUser =
        selectedUserId != null
          ? userList.find((u) => u.id === selectedUserId) ?? null
          : null;

      if (exists) {
        // EMPLOYEE 하나만 남은 상태에서 EMPLOYEE 해제 방지
        if (role === "EMPLOYEE" && prev.length === 1) {
          return prev;
        }

        const nextRoles = prev.filter((r) => r !== role);

        // VIDEO_CREATOR 해제 시 제작 권한/범위 초기화
        if (role === "VIDEO_CREATOR") {
          setCreatorType(null);
          if (currentUser) {
            setCreatorDeptScope([currentUser.deptCode]);
          } else {
            setCreatorDeptScope([]);
          }
        }

        return nextRoles;
      }

      // 새 역할 추가
      const nextRoles = [...prev, role];

      // VIDEO_CREATOR 추가 시 기본값 세팅
      if (role === "VIDEO_CREATOR" && currentUser) {
        setCreatorType("DEPT_CREATOR");
        setCreatorDeptScope([currentUser.deptCode]);
      }

      return nextRoles;
    });
  };

  const handleCreatorTypeChange = (next: CreatorType) => {
    if (!selectedUserId) {
      setAccountMessage({
        type: "warning",
        text: "먼저 왼쪽에서 권한을 수정할 사용자를 선택해 주세요.",
      });
      return;
    }

    const currentUser = userList.find((u) => u.id === selectedUserId);
    if (!currentUser) {
      setAccountMessage({
        type: "error",
        text: "선택된 사용자를 찾을 수 없습니다. 목록을 새로 고침한 뒤 다시 시도해 주세요.",
      });
      return;
    }

    setCreatorType(next);

    if (!next) {
      // 타입 해제 시: 사용자 소속 부서 하나만 기본값으로
      setCreatorDeptScope([currentUser.deptCode]);
      return;
    }

    if (next === "DEPT_CREATOR") {
      setCreatorDeptScope([currentUser.deptCode]);
    } else if (next === "GLOBAL_CREATOR") {
      setCreatorDeptScope(["ALL_ORG"]);
    }

    setAccountMessage({
      type: "info",
      text: "영상 제작자 유형이 변경되었습니다. 필요하다면 아래에서 제작 가능 부서를 조정해 주세요.",
    });
  };

  const handleScopeToggle = (deptId: string) => {
    setCreatorDeptScope((prev) => {
      const exists = prev.includes(deptId);
      if (exists) {
        // 최소 1개는 남도록 보호
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== deptId);
      }
      return [...prev, deptId];
    });
  };

  const handleSaveAccountRoles = () => {
    if (!selectedUserId) {
      setAccountMessage({
        type: "warning",
        text: "왼쪽 목록에서 먼저 저장할 사용자를 선택해 주세요.",
      });
      return;
    }

    const targetUser = userList.find((u) => u.id === selectedUserId);
    if (!targetUser) {
      setAccountMessage({
        type: "error",
        text: "선택된 사용자를 찾을 수 없습니다. 목록을 새로 고침한 뒤 다시 선택해 주세요.",
      });
      return;
    }

    if (selectedRoles.length === 0) {
      setAccountMessage({
        type: "warning",
        text: "최소 한 개 이상의 기본 역할이 필요합니다. EMPLOYEE(기본) 역할은 항상 유지해 주세요.",
      });
      return;
    }

    if (selectedRoles.includes("VIDEO_CREATOR")) {
      if (!creatorType) {
        setAccountMessage({
          type: "warning",
          text: "VIDEO_CREATOR 권한에는 ‘부서 한정 제작자’ 또는 ‘전사 담당 제작자’ 유형을 선택해야 합니다.",
        });
        return;
      }
      if (creatorDeptScope.length === 0) {
        setAccountMessage({
          type: "warning",
          text: "영상 제작 권한을 부여할 부서를 최소 1개 이상 선택해 주세요.",
        });
        return;
      }
    }

    const nextUserList = userList.map((user) =>
      user.id === selectedUserId
        ? {
          ...user,
          roles: selectedRoles,
          creatorType,
          creatorDeptScope,
        }
        : user,
    );

    setUserList(nextUserList);

    console.log("[AdminDashboard] 계정/롤 설정 저장", {
      user: targetUser,
      nextRoles: selectedRoles,
      creatorType,
      creatorDeptScope,
    });

    setAccountMessage({
      type: "success",
      text: `${targetUser.name} 님의 계정/역할 설정이 저장되었습니다.`,
    });
  };

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
      title: "신규 입사자 온보딩(전사 공통)",
      status: "completed",
      learnerCount: 47,
    },
    {
      id: "job4",
      title: "영업제안서 작성 실무",
      status: "in-progress",
      learnerCount: 29,
    },
    {
      id: "job5",
      title: "리더십 코칭(팀장 대상)",
      status: "not-started",
      learnerCount: 14,
    },
    {
      id: "job6",
      title: "인사평가 운영 실무",
      status: "in-progress",
      learnerCount: 18,
    },
    {
      id: "job7",
      title: "재무제표 읽기와 분석",
      status: "not-started",
      learnerCount: 12,
    },
  ];

  const deptEducationRowsMock: DeptEducationRow[] = [
    {
      id: "dept-ga",
      deptName: "총무팀",
      targetCount: 18,
      completedCount: 17,
      completionRate: 94,
    },
    {
      id: "dept-plan",
      deptName: "기획팀",
      targetCount: 21,
      completedCount: 19,
      completionRate: 90,
    },
    {
      id: "dept-mkt",
      deptName: "마케팅팀",
      targetCount: 16,
      completedCount: 13,
      completionRate: 81,
    },
    {
      id: "dept-hr",
      deptName: "인사팀",
      targetCount: 14,
      completedCount: 13,
      completionRate: 93,
    },
    {
      id: "dept-fin",
      deptName: "재무팀",
      targetCount: 15,
      completedCount: 13,
      completionRate: 87,
    },
    {
      id: "dept-dev",
      deptName: "개발팀",
      targetCount: 32,
      completedCount: 27,
      completionRate: 84,
    },
    {
      id: "dept-sales",
      deptName: "영업팀",
      targetCount: 24,
      completedCount: 18,
      completionRate: 75,
    },
    {
      id: "dept-legal",
      deptName: "법무팀",
      targetCount: 9,
      completedCount: 8,
      completionRate: 89,
    },
  ];

  // 3) 퀴즈 탭 Mock
  const quizKpis: KpiCard[] = [
    { id: "avgScore", label: "전체 평균 점수", value: "84점" },
    { id: "participants", label: "응시자 수", value: "176명" },
    { id: "passRate", label: "통과율 (80점↑)", value: "78%" },
    { id: "quizParticipation", label: "퀴즈 응시율", value: "73%" },
  ];

  const deptQuizRowsMock: DeptQuizScoreRow[] = [
    { id: "dq-ga", deptName: "총무팀", avgScore: 83, participantCount: 15 },
    { id: "dq-plan", deptName: "기획팀", avgScore: 87, participantCount: 19 },
    { id: "dq-mkt", deptName: "마케팅팀", avgScore: 81, participantCount: 16 },
    { id: "dq-hr", deptName: "인사팀", avgScore: 89, participantCount: 13 },
    { id: "dq-fin", deptName: "재무팀", avgScore: 86, participantCount: 14 },
    { id: "dq-dev", deptName: "개발팀", avgScore: 85, participantCount: 28 },
    { id: "dq-sales", deptName: "영업팀", avgScore: 79, participantCount: 23 },
    { id: "dq-legal", deptName: "법무팀", avgScore: 88, participantCount: 10 },
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
    {
      id: "qs4",
      quizTitle: "정보보안 기본 수칙 퀴즈",
      round: 1,
      avgScore: 82,
      participantCount: 31,
      passRate: 73,
    },
    {
      id: "qs5",
      quizTitle: "내부 통제 및 컴플라이언스 퀴즈",
      round: 1,
      avgScore: 84,
      participantCount: 13,
      passRate: 77,
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
    {
      id: "dq4",
      title: "[컴플라이언스] 내부정보 이용 금지 위반에 해당하는 행위는?",
      wrongRate: 36,
    },
    {
      id: "dq5",
      title: "[정보보안] 패스워드 관리 시 금지해야 하는 행동은?",
      wrongRate: 29,
    },
  ];

  // 4) 지표 탭 – 그래프용 Mock 데이터
  const PII_TREND_BY_PERIOD: Record<PeriodFilter, PiiTrendPoint[]> = {
    "7d": [
      { label: "월", inputRatio: 4.1, outputRatio: 2.9 },
      { label: "화", inputRatio: 3.8, outputRatio: 2.6 },
      { label: "수", inputRatio: 3.4, outputRatio: 2.3 },
      { label: "목", inputRatio: 3.9, outputRatio: 2.7 },
      { label: "금", inputRatio: 4.3, outputRatio: 3.1 },
      { label: "토", inputRatio: 2.7, outputRatio: 1.9 },
      { label: "일", inputRatio: 2.1, outputRatio: 1.5 },
    ],
    "30d": [
      { label: "1주", inputRatio: 4.4, outputRatio: 3.0 },
      { label: "2주", inputRatio: 4.1, outputRatio: 2.8 },
      { label: "3주", inputRatio: 3.7, outputRatio: 2.5 },
      { label: "4주", inputRatio: 3.9, outputRatio: 2.7 },
    ],
    "90d": [
      { label: "1월", inputRatio: 4.8, outputRatio: 3.3 },
      { label: "2월", inputRatio: 4.2, outputRatio: 2.9 },
      { label: "3월", inputRatio: 4.0, outputRatio: 2.7 },
    ],
  };

  const LATENCY_BUCKET_BY_PERIOD: Record<PeriodFilter, LatencyBucket[]> = {
    "7d": [
      { label: "0-500ms", count: 320 },
      { label: "0.5-1s", count: 140 },
      { label: "1-2s", count: 62 },
      { label: "2s+", count: 18 },
    ],
    "30d": [
      { label: "0-500ms", count: 1280 },
      { label: "0.5-1s", count: 530 },
      { label: "1-2s", count: 260 },
      { label: "2s+", count: 71 },
    ],
    "90d": [
      { label: "0-500ms", count: 3650 },
      { label: "0.5-1s", count: 1490 },
      { label: "1-2s", count: 710 },
      { label: "2s+", count: 184 },
    ],
  };

  const MODEL_LATENCY_BY_PERIOD: Record<PeriodFilter, ModelLatency[]> = {
    "7d": [
      { id: "gpt-mini", modelLabel: "gpt-4o-mini", avgMs: 410 },
      { id: "gpt-large", modelLabel: "gpt-4.1", avgMs: 720 },
      { id: "rerank", modelLabel: "재랭크 포함", avgMs: 930 },
    ],
    "30d": [
      { id: "gpt-mini", modelLabel: "gpt-4o-mini", avgMs: 430 },
      { id: "gpt-large", modelLabel: "gpt-4.1", avgMs: 760 },
      { id: "rerank", modelLabel: "재랭크 포함", avgMs: 980 },
    ],
    "90d": [
      { id: "gpt-mini", modelLabel: "gpt-4o-mini", avgMs: 445 },
      { id: "gpt-large", modelLabel: "gpt-4.1", avgMs: 790 },
      { id: "rerank", modelLabel: "재랭크 포함", avgMs: 1010 },
    ],
  };

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

  const selectedDeptLabel =
    DEPARTMENT_OPTIONS.find((d) => d.id === selectedDept)?.name ?? "전체 부서";

  /**
   * ========== 탭별 렌더러 ==========
   */

  const renderKpiRow = (items: KpiCard[]) => (
    <div className="cb-admin-kpi-row" aria-label="핵심 지표 요약">
      {items.map((kpi) => (
        <div key={kpi.id} className="cb-admin-kpi-card">
          <div className="cb-admin-kpi-header">
            <span className="cb-admin-kpi-dot" aria-hidden="true" />
            <span className="cb-admin-kpi-label">{kpi.label}</span>
          </div>
          <div className="cb-admin-kpi-value">{kpi.value}</div>
          {kpi.caption && (
            <div className="cb-admin-kpi-caption">{kpi.caption}</div>
          )}
        </div>
      ))}
    </div>
  );

  const renderChatbotTab = () => {
    const filterValue: CommonFilterState = {
      period,
      departmentId: selectedDept,
    };

    const handleFilterChange = (next: CommonFilterState) => {
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
    };

    const primaryKpis = CHATBOT_PRIMARY_KPIS_BY_PERIOD[period];
    const secondaryKpis = CHATBOT_SECONDARY_KPIS_BY_PERIOD[period];
    const volumeData = CHATBOT_VOLUME_BY_PERIOD[period];
    const domainData = CHATBOT_DOMAIN_SHARE_BY_PERIOD[period];
    const routeData = CHATBOT_ROUTE_SHARE_BY_PERIOD[period];
    const keywordData = POPULAR_KEYWORDS_BY_PERIOD[period];

    const max = Math.max(...volumeData.map((p) => p.count), 1);
    const total = volumeData.reduce((sum, p) => sum + p.count, 0);
    const avg = Math.round(total / volumeData.length);

    const hasErrorRatio = volumeData.some(
      (p) => typeof p.errorRatio === "number",
    );
    const avgErrorRatio =
      hasErrorRatio && volumeData.length > 0
        ? volumeData.reduce(
          (sum, p) => sum + (p.errorRatio ?? 0),
          0,
        ) / volumeData.length
        : null;

    return (
      <div className="cb-admin-tab-panel">
        <AdminFilterBar
          mode="overview"
          value={filterValue}
          onChange={handleFilterChange}
          departments={DEPARTMENT_OPTIONS}
          onRefresh={handleRefreshClick}
        />

        {/* 필수 KPI / 운영 KPI 2줄 분리 */}
        {renderKpiRow(primaryKpis)}
        {renderKpiRow(secondaryKpis)}

        <div className="cb-admin-section-row">
          <section className="cb-admin-section">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">질문 수 · 에러율 추이</h3>
              <span className="cb-admin-section-sub">
                기간별 질문량과 에러율을 함께 확인합니다.
              </span>
            </div>

            {/* 기간 총 질문 / 평균 질문 / 평균 에러율 요약 칩 */}
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
                // 최소 40% ~ 최대 100% 사이로 표시
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
                      <div
                        className="cb-admin-bar-fill"
                        style={{ width }}
                      />
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

        {/* 라우트별 비율 카드 */}
        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">라우트별 질문 비율</h3>
            <span className="cb-admin-section-sub">
              RAG / LLM / Incident / FAQ 템플릿 등 라우팅 경로 기준 비중입니다.
            </span>
          </div>
          <div className="cb-admin-domain-list">
            {routeData.map((item) => (
              <div key={item.id} className="cb-admin-domain-item">
                <div className="cb-admin-domain-top">
                  <span className="cb-admin-domain-label">
                    {item.routeLabel}
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

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">
              최근 많이 질문된 키워드 Top 5
            </h3>
          </div>
          <ul className="cb-admin-keyword-list">
            {keywordData.map((item) => (
              <li key={item.keyword} className="cb-admin-keyword-item">
                <span className="cb-admin-keyword-label">
                  {item.keyword}
                </span>
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

  const renderEducationTab = () => {
    const filterValue: CommonFilterState = {
      period,
      departmentId: selectedDept,
    };

    const handleFilterChange = (next: CommonFilterState) => {
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
    };

    // 스펙 적용: 부서 필터가 선택된 경우, 부서별 이수율 테이블은 해당 부서만 표시
    const visibleDeptRows =
      selectedDept === "ALL"
        ? deptEducationRowsMock
        : deptEducationRowsMock.filter(
          (row) => row.deptName === selectedDeptLabel,
        );

    return (
      <div className="cb-admin-tab-panel">
        <AdminFilterBar
          mode="overview"
          value={filterValue}
          onChange={handleFilterChange}
          departments={DEPARTMENT_OPTIONS}
          onRefresh={handleRefreshClick}
        />
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
                {visibleDeptRows.map((row) => (
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
  };

  const renderQuizTab = () => {
    const filterValue: CommonFilterState = {
      period,
      departmentId: selectedDept,
    };

    const handleFilterChange = (next: CommonFilterState) => {
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
    };

    // 스펙 적용: 부서 필터가 선택된 경우, 부서별 평균 점수 그래프는 해당 부서만 표시
    const visibleDeptQuizRows =
      selectedDept === "ALL"
        ? deptQuizRowsMock
        : deptQuizRowsMock.filter(
          (row) => row.deptName === selectedDeptLabel,
        );

    return (
      <div className="cb-admin-tab-panel">
        <AdminFilterBar
          mode="overview"
          value={filterValue}
          onChange={handleFilterChange}
          departments={DEPARTMENT_OPTIONS}
          onRefresh={handleRefreshClick}
        />
        {renderKpiRow(quizKpis)}

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">부서별 평균 점수</h3>
          </div>
          <div className="cb-admin-bar-chart">
            {visibleDeptQuizRows.map((row) => {
              const width = `${Math.min(
                100,
                Math.round((row.avgScore / 100) * 100),
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
              오답 비율이 높은 문제 Top 5
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
  };

  const renderMetricsTab = () => {
    const filterValue: CommonFilterState = {
      period,
      departmentId: selectedDept,
    };

    const handleFilterChange = (next: CommonFilterState) => {
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
    };

    const piiTrend = PII_TREND_BY_PERIOD[period];
    const latencyBuckets = LATENCY_BUCKET_BY_PERIOD[period];
    const modelLatency = MODEL_LATENCY_BY_PERIOD[period];

    // PII 막대 너비 계산용 최대값
    const maxPiiRatio = Math.max(
      ...piiTrend.map((row) => Math.max(row.inputRatio, row.outputRatio)),
      1,
    );

    const maxLatencyCount = Math.max(
      ...latencyBuckets.map((b) => b.count),
      1,
    );

    const periodLabel =
      PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? "";

    return (
      <div className="cb-admin-tab-panel">
        <AdminFilterBar
          mode="overview"
          value={filterValue}
          onChange={handleFilterChange}
          departments={DEPARTMENT_OPTIONS}
          onRefresh={handleRefreshClick}
        />

        <div className="cb-admin-section-row">
          {/* 보안 · PII 블록 */}
          <section className="cb-admin-section cb-admin-section--metric">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">보안 · PII 지표</h3>
              <span className="cb-admin-section-sub">
                PII 감지 및 보안 차단 이벤트를 요약해서 확인합니다.
              </span>
            </div>

            <ul className="cb-admin-metric-list">
              {securityMetricsMock.map((m) => (
                <li key={m.id} className="cb-admin-metric-item">
                  <div className="cb-admin-metric-main">
                    <span className="cb-admin-metric-label">{m.label}</span>
                    <span className="cb-admin-metric-value">{m.value}</span>
                  </div>
                  {m.description && (
                    <div className="cb-admin-metric-desc">
                      {m.description}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* PII 감지 추이 */}
            <div className="cb-admin-metric-chart">
              <div className="cb-admin-metric-chart-header">
                <div className="cb-admin-metric-chart-title">
                  PII 감지 추이
                </div>
                <div className="cb-admin-metric-chart-legend">
                  <span className="cb-admin-metric-legend-dot cb-admin-metric-legend-dot--input" />
                  <span>입력 PII 비율</span>
                  <span className="cb-admin-metric-legend-separator">·</span>
                  <span className="cb-admin-metric-legend-dot cb-admin-metric-legend-dot--output" />
                  <span>출력 PII 비율</span>
                </div>
              </div>

              <div className="cb-admin-metric-chart-body cb-admin-metric-chart-body--pii">
                {piiTrend.map((point) => {
                  const inputWidth = `${Math.round(
                    (point.inputRatio / maxPiiRatio) * 100,
                  )}%`;
                  const outputWidth = `${Math.round(
                    (point.outputRatio / maxPiiRatio) * 100,
                  )}%`;

                  return (
                    <div
                      key={point.label}
                      className="cb-admin-metric-chart-row"
                    >
                      <div className="cb-admin-metric-chart-row-label">
                        {point.label}
                      </div>
                      <div className="cb-admin-metric-chart-row-bars">
                        <div className="cb-admin-metric-chart-track">
                          <div
                            className="cb-admin-metric-chart-bar cb-admin-metric-chart-bar--input"
                            style={{ width: inputWidth }}
                          />
                        </div>
                        <div className="cb-admin-metric-chart-track">
                          <div
                            className="cb-admin-metric-chart-bar cb-admin-metric-chart-bar--output"
                            style={{ width: outputWidth }}
                          />
                        </div>
                      </div>
                      <div className="cb-admin-metric-chart-row-value">
                        {point.inputRatio.toFixed(1)}% /{" "}
                        {point.outputRatio.toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="cb-admin-metric-chart-footer">
                <span className="cb-admin-metric-chart-footer-label">
                  기간 기준: {periodLabel}
                </span>
              </div>
            </div>
          </section>

          {/* 성능 · 장애 블록 */}
          <section className="cb-admin-section cb-admin-section--metric">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">성능 · 장애 지표</h3>
              <span className="cb-admin-section-sub">
                응답 시간 분포와 에러 현황을 모니터링합니다.
              </span>
            </div>

            <ul className="cb-admin-metric-list">
              {qualityMetricsMock.map((m) => (
                <li key={m.id} className="cb-admin-metric-item">
                  <div className="cb-admin-metric-main">
                    <span className="cb-admin-metric-label">{m.label}</span>
                    <span className="cb-admin-metric-value">{m.value}</span>
                  </div>
                  {m.description && (
                    <div className="cb-admin-metric-desc">
                      {m.description}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* 응답 시간 분포 + 모델별 평균 응답 시간 */}
            <div className="cb-admin-metric-chart">
              <div className="cb-admin-metric-chart-header">
                <div className="cb-admin-metric-chart-title">
                  응답 시간 분포
                </div>
                <div className="cb-admin-metric-chart-caption">
                  최근 {periodLabel} 기준
                </div>
              </div>

              <div className="cb-admin-metric-chart-body">
                {latencyBuckets.map((bucket) => {
                  const width = `${Math.round(
                    (bucket.count / maxLatencyCount) * 100,
                  )}%`;
                  return (
                    <div
                      key={bucket.label}
                      className="cb-admin-metric-chart-row"
                    >
                      <div className="cb-admin-metric-chart-row-label">
                        {bucket.label}
                      </div>
                      <div className="cb-admin-metric-chart-track">
                        <div
                          className="cb-admin-metric-chart-bar cb-admin-metric-chart-bar--latency"
                          style={{ width }}
                        />
                      </div>
                      <div className="cb-admin-metric-chart-row-value">
                        {bucket.count.toLocaleString()}건
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="cb-admin-metric-chart-footer">
                <span className="cb-admin-metric-chart-footer-label">
                  모델별 평균 응답 시간
                </span>
                <div className="cb-admin-metric-pill-row">
                  {modelLatency.map((model) => (
                    <span
                      key={model.id}
                      className="cb-admin-metric-pill"
                    >
                      {model.modelLabel}
                      <span className="cb-admin-metric-pill-value">
                        {model.avgMs}ms
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  };

  const renderAccountsTab = () => {
    const currentUser =
      selectedUserId != null
        ? userList.find((u) => u.id === selectedUserId) ?? null
        : null;

    const isVideoCreatorChecked = selectedRoles.includes("VIDEO_CREATOR");

    const availableScopeOptions =
      creatorType === "GLOBAL_CREATOR"
        // 전사 담당 제작자 → 전사 공통만 노출
        ? DEPT_SCOPE_OPTIONS.filter((d) => d.id === "ALL_ORG")
        // 부서 한정 제작자 → 실제 부서만 노출 (전사 공통 제외)
        : DEPT_SCOPE_OPTIONS.filter((d) => d.id !== "ALL_ORG");

    const selectedRoleLabels =
      selectedRoles.length === 0
        ? "선택된 역할 없음"
        : selectedRoles.map((r) => ROLE_LABELS[r]).join(", ");

    // 좌측 사용자 리스트 필터링
    const filteredUsers = userList.filter((user) => {
      if (userDeptFilter !== "ALL" && user.deptCode !== userDeptFilter) {
        return false;
      }
      if (userRoleFilter !== "ALL" && !user.roles.includes(userRoleFilter)) {
        return false;
      }
      if (userSearchKeyword.trim()) {
        const kw = userSearchKeyword.trim().toLowerCase();
        const nameMatch = user.name.toLowerCase().includes(kw);
        const noMatch = user.employeeNo.includes(kw);
        if (!nameMatch && !noMatch) {
          return false;
        }
      }
      return true;
    });

    const handleSelectUser = (user: AdminUserSummary) => {
      setSelectedUserId(user.id);
      setSelectedRoles(user.roles);
      setCreatorType(user.creatorType ?? null);
      setCreatorDeptScope(
        user.creatorDeptScope && user.creatorDeptScope.length > 0
          ? user.creatorDeptScope
          : [user.deptCode],
      );
      setAccountMessage({
        type: "info",
        text: `${user.name} 님의 권한을 편집할 수 있습니다. 변경 후 우측 하단 ‘저장’ 버튼을 눌러 반영해 주세요.`,
      });
    };

    return (
      <div className="cb-admin-tab-panel">
        <div className="cb-admin-account-layout">
          {/* ===== 좌측: 사용자 검색 / 선택 ===== */}
          <section className="cb-admin-account-card cb-admin-account-card--left">
            <h3 className="cb-admin-account-title">사용자 검색 / 선택</h3>
            <p className="cb-admin-hint">
              이름·사번·부서·역할로 필터링해서 계정을 선택한 뒤,
              우측에서 권한을 편집합니다.
            </p>

            <div className="cb-admin-account-search-row">
              <input
                type="text"
                className="cb-admin-input"
                placeholder="이름 또는 사번 검색"
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
                    e.target.value === "ALL"
                      ? "ALL"
                      : (e.target.value as RoleKey),
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
                        className={`cb-admin-account-user-item ${isActive ? "is-active" : ""
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
                            <span
                              key={role}
                              className="cb-admin-role-chip"
                            >
                              {role}
                            </span>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* ===== 우측: 선택 사용자 권한 편집 ===== */}
          <section className="cb-admin-account-card cb-admin-account-card--right">
            <h3 className="cb-admin-account-title">
              선택한 사용자 권한 편집
            </h3>

            {/* 계정/롤 탭 안내 토스트 */}
            {accountMessage && (
              <div
                className={`cb-admin-toast cb-admin-toast--${accountMessage.type}`}
              >
                {accountMessage.text}
              </div>
            )}

            {!currentUser ? (
              <p className="cb-admin-hint">
                왼쪽에서 계정을 선택하면 역할과 영상 제작 권한을 한 번에 편집할 수 있습니다.
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

                {/* 역할(Role) 설정 블록 */}
                <div className="cb-admin-account-subcard">
                  <h4 className="cb-admin-account-subtitle">
                    역할(Role) 설정
                  </h4>
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
                        onChange={() =>
                          handleToggleRole("CONTENTS_REVIEWER")
                        }
                      />
                      <span>CONTENTS_REVIEWER (콘텐츠 검토자)</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={isRoleChecked("COMPLAINT_MANAGER")}
                        onChange={() =>
                          handleToggleRole("COMPLAINT_MANAGER")
                        }
                      />
                      <span>COMPLAINT_MANAGER (신고 관리자)</span>
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

                {/* 영상 제작 권한 설정 블록 */}
                <div className="cb-admin-account-subcard">
                  <h4 className="cb-admin-account-subtitle">
                    영상 제작 권한 설정
                  </h4>

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
                          onChange={() =>
                            handleCreatorTypeChange("DEPT_CREATOR")
                          }
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
                          onChange={() =>
                            handleCreatorTypeChange("GLOBAL_CREATOR")
                          }
                        />
                        <span>전사 담당 제작자 (GLOBAL_CREATOR)</span>
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="cb-admin-fieldset">
                    <legend>제작 가능 부서</legend>

                    {!isVideoCreatorChecked && (
                      <p className="cb-admin-hint">
                        VIDEO_CREATOR 역할을 선택하면 제작 가능 부서를 설정할
                        수 있습니다.
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
                          <label
                            key={dept.id}
                            className="cb-admin-scope-item"
                          >
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
                </div>

                {/* 저장 / 되돌리기 */}
                <div className="cb-admin-account-actions">
                  <button
                    type="button"
                    className="cb-admin-secondary-btn"
                    onClick={() => {
                      // 현재 선택된 사용자 기준으로 편집 버퍼 되돌리기
                      setSelectedRoles(currentUser.roles);
                      setCreatorType(currentUser.creatorType ?? null);
                      setCreatorDeptScope(
                        currentUser.creatorDeptScope &&
                          currentUser.creatorDeptScope.length > 0
                          ? currentUser.creatorDeptScope
                          : [currentUser.deptCode],
                      );
                      setAccountMessage({
                        type: "info",
                        text: "화면의 변경 사항을 선택된 사용자 기준 값으로 되돌렸습니다.",
                      });
                    }}
                  >
                    되돌리기
                  </button>
                  <button
                    type="button"
                    className="cb-admin-primary-btn"
                    onClick={handleSaveAccountRoles}
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

  const renderLogsTab = () => {
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
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
      if (typeof next.domainId !== "undefined") {
        setLogDomainFilter(next.domainId);
      }
      if (typeof next.routeId !== "undefined") {
        setLogRouteFilter(next.routeId);
      }
      if (typeof next.modelId !== "undefined") {
        setLogModelFilter(next.modelId);
      }
      if (typeof next.onlyError !== "undefined") {
        setLogOnlyError(next.onlyError);
      }
      if (typeof next.hasPiiOnly !== "undefined") {
        setLogHasPiiOnly(next.hasPiiOnly);
      }
    };

    // 스펙 적용: 부서 필터도 실제로 로그에 반영
    const selectedDeptNameForLogs =
      selectedDept === "ALL" ? null : selectedDeptLabel;

    const filteredItems = LOG_LIST_MOCK.filter((item) => {
      if (selectedDeptNameForLogs && item.department !== selectedDeptNameForLogs) {
        return false;
      }
      if (logDomainFilter !== "ALL" && item.domain !== logDomainFilter) {
        return false;
      }
      if (logRouteFilter !== "ALL" && item.route !== logRouteFilter) {
        return false;
      }
      if (logModelFilter !== "ALL" && item.modelName !== logModelFilter) {
        return false;
      }
      if (logOnlyError && !item.errorCode) {
        return false;
      }
      if (
        logHasPiiOnly &&
        !item.hasPiiInput &&
        !item.hasPiiOutput
      ) {
        return false;
      }
      return true;
    });

    const totalCount = filteredItems.length;
    const errorCount = filteredItems.filter((i) => i.errorCode).length;
    const piiCount = filteredItems.filter(
      (i) => i.hasPiiInput || i.hasPiiOutput,
    ).length;

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
          onRefresh={handleRefreshClick}
        />

        <section className="cb-admin-section cb-admin-section--logs-drilldown">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">세부 로그 Drilldown</h3>
            <span className="cb-admin-section-sub">
              시간 / 도메인 / 라우트 / 모델 / PII / 에러 기준으로 필터링해서 턴
              단위 로그를 확인합니다.
            </span>
          </div>

          {/* 스펙 적용: 선택된 필터 기준 로그 요약 배지 */}
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
              </span>
            </div>
            <div className="cb-admin-trend-pill">
              <span className="cb-admin-trend-label">PII 포함</span>
              <span className="cb-admin-trend-value">
                {piiCount.toLocaleString()}건
              </span>
            </div>
          </div>

          <div className="cb-admin-table-wrapper cb-admin-table-wrapper--logs">
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
                  <th>PII</th>
                  <th>latency(ms)</th>
                  <th>error_code</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={10} className="cb-admin-table-empty">
                      조건에 해당하는 로그가 없습니다.
                    </td>
                  </tr>
                )}
                {filteredItems.map((item) => {
                  const hasError = !!item.errorCode;
                  const hasPii =
                    item.hasPiiInput || item.hasPiiOutput;

                  return (
                    <tr
                      key={item.id}
                      className={hasError ? "cb-admin-log-row--error" : ""}
                    >
                      <td>{item.createdAt}</td>
                      <td>{item.userId}</td>
                      <td>{item.userRole}</td>
                      <td>{item.department}</td>
                      <td>{item.domain}</td>
                      <td>{item.route}</td>
                      <td>{item.modelName}</td>
                      <td>
                        {hasPii ? (
                          <span className="cb-admin-badge cb-admin-badge--pii">
                            {item.hasPiiInput && "입력"}
                            {item.hasPiiInput &&
                              item.hasPiiOutput &&
                              " / "}
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
          </div>
        </section>
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
      onMouseDownCapture={() => onRequestFocus?.()}
    >
      <div className="cb-admin-root" style={{ position: "relative" }}>
        {/* 드래그 바 + 리사이즈 핸들 */}
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
            <div className="cb-admin-header-title-row">
              <span className="cb-admin-badge">SYSTEM ADMIN</span>
              <h2 className="cb-admin-title">관리자 대시보드</h2>
            </div>
            <p className="cb-admin-subtitle">
              챗봇, 교육, 퀴즈, 지표, 로그를 한 곳에서 관리하고 운영 상태를
              모니터링합니다.
            </p>

            <div className="cb-admin-header-context">
              <span className="cb-admin-context-chip">
                현재 <strong>{activeTabLabel}</strong> 기준으로 요약을 보고
                있습니다.
              </span>
              <span className="cb-admin-context-meta">
                기간{" "}
                <strong>
                  {PERIOD_OPTIONS.find((p) => p.id === period)?.label}
                </strong>
                · 부서 <strong>{selectedDeptLabel}</strong>
              </span>
            </div>
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

        <nav className="cb-admin-tabs" aria-label="관리자 대시보드 탭">
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "chatbot" ? "is-active" : ""
              }`}
            onClick={() => setActiveTab("chatbot")}
          >
            <span className="cb-admin-tab-label">챗봇</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "education" ? "is-active" : ""
              }`}
            onClick={() => setActiveTab("education")}
          >
            <span className="cb-admin-tab-label">교육</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "quiz" ? "is-active" : ""
              }`}
            onClick={() => setActiveTab("quiz")}
          >
            <span className="cb-admin-tab-label">퀴즈</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "metrics" ? "is-active" : ""
              }`}
            onClick={() => setActiveTab("metrics")}
          >
            <span className="cb-admin-tab-label">지표</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "logs" ? "is-active" : ""
              }`}
            onClick={() => setActiveTab("logs")}
          >
            <span className="cb-admin-tab-label">로그</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "accounts" ? "is-active" : ""
              }`}
            onClick={() => setActiveTab("accounts")}
          >
            <span className="cb-admin-tab-label">계정/롤 관리</span>
          </button>
        </nav>

        {/* 다른 패널처럼: 여기만 스크롤, 바디는 안 흔들리게 */}
        <div className="cb-admin-content">
          {activeTab === "chatbot" && renderChatbotTab()}
          {activeTab === "education" && renderEducationTab()}
          {activeTab === "quiz" && renderQuizTab()}
          {activeTab === "metrics" && renderMetricsTab()}
          {activeTab === "logs" && renderLogsTab()}
          {activeTab === "accounts" && renderAccountsTab()}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboardView;
