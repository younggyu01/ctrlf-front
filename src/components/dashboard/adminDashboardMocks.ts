// src/components/chatbot/adminDashboardMocks.ts
import type {
  AdminTabId,
  PeriodFilter,
  KpiCard,
  ChatbotVolumePoint,
  ChatbotDomainShare,
  ChatbotRouteShare,
  PopularKeyword,
  MandatoryCourseProgress,
  JobCourseSummary,
  DeptEducationRow,
  DeptQuizScoreRow,
  QuizSummaryRow,
  DifficultQuestion,
  MetricItem,
  PiiTrendPoint,
  LatencyBucket,
  ModelLatency,
  PiiReport,
  DeptScopeOption,
  AdminUserSummary,
  LogListItem,
} from "./adminDashboardTypes";
import type { DepartmentOption } from "./adminFilterTypes";

/**
 * AdminDashboardView.tsx 에 있던
 * 모든 Mock / 데모 데이터.
 */

/**
 * 공통 Mock 데이터
 */
export const PERIOD_OPTIONS: { id: PeriodFilter; label: string }[] = [
  { id: "7d", label: "최근 7일" },
  { id: "30d", label: "최근 30일" },
  { id: "90d", label: "최근 90일" },
];

/**
 * 프로젝트 기준 부서 옵션
 * - 총무, 기획, 마케팅, 인사, 재무, 개발, 영업, 법무
 */
export const DEPARTMENT_OPTIONS: DepartmentOption[] = [
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

export const TAB_LABELS: Record<AdminTabId, string> = {
  chatbot: "챗봇 이용 현황",
  education: "교육 이수 현황",
  quiz: "퀴즈 성적 현황",
  metrics: "보안·품질 지표",
  accounts: "계정 / 역할 관리",
  policy: "사규 / 정책 관리",
  logs: "세부 로그 조회",
  faq: "FAQ 관리",
};

/**
 * ====== 챗봇 탭 – 기간별 Mock 데이터 ======
 */

// Primary KPI: 오늘 기준 필수 지표
export const CHATBOT_PRIMARY_KPIS_BY_PERIOD: Record<PeriodFilter, KpiCard[]> = {
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
export const CHATBOT_SECONDARY_KPIS_BY_PERIOD: Record<PeriodFilter, KpiCard[]> =
  {
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
export const CHATBOT_VOLUME_BY_PERIOD: Record<
  PeriodFilter,
  ChatbotVolumePoint[]
> = {
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
export const CHATBOT_DOMAIN_SHARE_BY_PERIOD: Record<
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
export const CHATBOT_ROUTE_SHARE_BY_PERIOD: Record<
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
export const POPULAR_KEYWORDS_BY_PERIOD: Record<
  PeriodFilter,
  PopularKeyword[]
> = {
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
export const LOG_DOMAIN_OPTIONS = [
  { id: "ALL", label: "전체 도메인" },
  { id: "POLICY", label: "POLICY (규정)" },
  { id: "INCIDENT", label: "INCIDENT (신고)" },
  { id: "EDUCATION", label: "EDUCATION (교육)" },
  { id: "GENERAL", label: "GENERAL (일반)" },
];

export const LOG_ROUTE_OPTIONS = [
  { id: "ALL", label: "전체 라우트" },
  { id: "ROUTE_RAG_INTERNAL", label: "ROUTE_RAG_INTERNAL" },
  { id: "ROUTE_LLM_ONLY", label: "ROUTE_LLM_ONLY" },
  { id: "ROUTE_INCIDENT", label: "ROUTE_INCIDENT" },
];

export const LOG_MODEL_OPTIONS = [
  { id: "ALL", label: "전체 모델" },
  { id: "gpt-4o-mini", label: "gpt-4o-mini" },
  { id: "gpt-4.1", label: "gpt-4.1" },
  { id: "rerank+gpt-4o-mini", label: "rerank + gpt-4o-mini" },
];

/**
 * 프로젝트 부서 기준 + 데이터 양을 늘린 세부 로그 Mock
 */
export const LOG_LIST_MOCK: LogListItem[] = [
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

export const PII_REPORT_NONE: PiiReport = {
  riskLevel: "none",
  summaryLines: [
    "현재 선택된 로그 기준으로 이름, 주민등록번호, 여권번호, 계좌번호, 휴대전화, 이메일, 주소, 사번 등 주요 개인정보가 탐지되지 않았습니다.",
    "동일한 조건으로 운영을 지속해도 개인정보 관점에서 즉각적인 위험 신호는 보이지 않습니다.",
  ],
  detectedItems: [
    "탐지된 주민등록번호 / 여권번호 / 운전면허번호: 0건",
    "탐지된 계좌번호 / 카드번호: 0건",
    "탐지된 연락처(휴대전화, 이메일, 주소): 0건",
    "탐지된 사번 / 고객번호 / 내부 식별자: 0건",
  ],
  recommendedActions: [
    "다만, 문서 내에 서버명, 내부 시스템 URL, 사내 IP, 회의 링크 등 회사 내부 인프라 정보가 포함되어 있다면 외부 공유 시에는 별도의 보안 검토를 받는 것을 권장합니다.",
  ],
  maskedText: undefined,
  modelName: "GLiNER-PII v1.0",
  analyzedAt: "2025-12-11 10:32:18",
  traceId: "pii-trace-demo-none",
};

export const PII_REPORT_WARNING: PiiReport = {
  riskLevel: "warning",
  summaryLines: [
    "현재 선택된 로그 집합에서 이름, 연락처, 이메일, 사번 등 일반 개인정보가 다수 포함된 요청·응답이 탐지되었습니다.",
    "내부 참고용으로 사용하는 것은 가능하지만, 외부 공유나 교육 자료로 활용하기 전에는 반드시 마스킹 또는 삭제가 필요합니다.",
  ],
  detectedItems: [
    "이름·별칭: 5개",
    "휴대전화번호: 3개",
    "이메일 주소(회사/개인 포함): 2개",
    "사번·직원ID·내부 계정명: 4개",
  ],
  recommendedActions: [
    "모든 이름, 전화번호, 이메일 주소, 사번은 각각 [이름], [휴대전화번호], [이메일], [사번]과 같이 가상의 토큰으로 대체해 주세요.",
    "실제 고객·직원을 특정할 수 있는 내부 계정명, 고객번호, 티켓ID 등은 교육/매뉴얼 문서에는 등장하지 않도록 샘플 ID로 치환하는 것을 권장합니다.",
    "외부 파트너나 고객에게 전달하는 자료라면, 본문에 실제 사례가 아닌 가상의 예시 데이터만 남도록 최종 검수 과정을 거쳐 주세요.",
  ],
  maskedText: [
    "[이름]님(사번 [사번])의 요청에 따라 [날짜]에 처리된 상담 내용입니다.",
    "연락처는 [휴대전화번호], 이메일은 [이메일]로 등록되어 있으며, 추가 문의는 내부 포털의 문의 게시판을 통해 접수해 주세요.",
  ].join("\n"),
  modelName: "GLiNER-PII v1.0",
  analyzedAt: "2025-12-11 10:32:18",
  traceId: "pii-trace-demo-warning",
};

export const PII_REPORT_HIGH: PiiReport = {
  riskLevel: "high",
  summaryLines: [
    "현재 선택된 로그들 중 일부에서 주민등록번호, 계좌번호, 카드번호 등 고위험 개인정보가 포함된 요청·응답이 탐지되었습니다.",
    "이 상태로 저장·공유하거나 교육 자료에 포함하는 것은 회사 내부 규정 및 개인정보보호법을 위반할 가능성이 매우 높습니다.",
  ],
  detectedItems: [
    "주민등록번호: 1개",
    "계좌번호(급여·정산 계좌 포함): 1개",
    "신용/체크카드 번호(PAN): 2개",
    "고객ID·내부 식별자(계약번호, 청구ID 등): 3개",
    "주소(자택/직장 주소): 2개",
    "생년월일(주민번호 외 별도 표기 포함): 2개",
  ],
  recommendedActions: [
    "원본 텍스트를 즉시 보안 구역(암호화된 사내 저장소)으로 옮기고, 개인 PC, 메일함, 메신저, 공유 드라이브 등에 남아 있는 동일 내용의 복사본은 모두 삭제해 주세요.",
    "주민등록번호, 계좌번호, 카드번호, 생년월일 등 고위험 정보는 전부 [주민등록번호], [계좌번호], [카드번호], [생년월일]과 같이 완전히 마스킹하거나, 필요 시 해당 문장을 통째로 삭제해야 합니다.",
    "이 내용이 이미 외부로 전송·공유되었을 가능성이 있다면, 즉시 보안 담당자(신고 관리자)에게 Incident 신고를 접수하고, 수신 대상·전송 채널을 함께 공유해 후속 조치를 진행해 주세요.",
    "실제 고객·직원 사례가 필요한 교육 자료라면, 유사한 패턴의 더미 데이터 세트를 별도로 생성해 활용하고, 실데이터가 포함된 원본 텍스트는 교육 환경에 업로드하지 않도록 관리해 주세요.",
  ],
  maskedText: [
    "[이름] 고객님의 주민등록번호는 [주민등록번호]이며 급여 이체 계좌는 [계좌번호]로 등록되어 있습니다.",
    "결제에 사용된 카드번호는 [카드번호]로, 청구지는 [주소]로 설정되어 있으며, 생년월일은 [생년월일]로 관리됩니다.",
  ].join("\n"),
  modelName: "GLiNER-PII v1.0",
  analyzedAt: "2025-12-11 10:32:18",
  traceId: "pii-trace-demo-high",
};

/**
 * 계정/롤 관리 탭에서 사용할 부서/범위 옵션
 * - 프로젝트 기준 부서로 통일
 */
export const DEPT_SCOPE_OPTIONS: DeptScopeOption[] = [
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
export const MOCK_USERS: AdminUserSummary[] = [
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

// 교육 탭 Mock
export const educationKpis: KpiCard[] = [
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

export const mandatoryCoursesMock: MandatoryCourseProgress[] = [
  { id: "course1", name: "성희롱 예방교육", completionRate: 95 },
  { id: "course2", name: "개인정보보호 교육", completionRate: 92 },
  { id: "course3", name: "직장 내 괴롭힘 예방", completionRate: 88 },
  { id: "course4", name: "장애인 인식개선", completionRate: 89 },
];

export const jobCoursesMock: JobCourseSummary[] = [
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

export const deptEducationRowsMock: DeptEducationRow[] = [
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

// 퀴즈 탭 Mock
export const quizKpis: KpiCard[] = [
  { id: "avgScore", label: "전체 평균 점수", value: "84점" },
  { id: "participants", label: "응시자 수", value: "176명" },
  { id: "passRate", label: "통과율 (80점↑)", value: "78%" },
  { id: "quizParticipation", label: "퀴즈 응시율", value: "73%" },
];

export const deptQuizRowsMock: DeptQuizScoreRow[] = [
  { id: "dq-ga", deptName: "총무팀", avgScore: 83, participantCount: 15 },
  { id: "dq-plan", deptName: "기획팀", avgScore: 87, participantCount: 19 },
  { id: "dq-mkt", deptName: "마케팅팀", avgScore: 81, participantCount: 16 },
  { id: "dq-hr", deptName: "인사팀", avgScore: 89, participantCount: 13 },
  { id: "dq-fin", deptName: "재무팀", avgScore: 86, participantCount: 14 },
  { id: "dq-dev", deptName: "개발팀", avgScore: 85, participantCount: 28 },
  { id: "dq-sales", deptName: "영업팀", avgScore: 79, participantCount: 23 },
  { id: "dq-legal", deptName: "법무팀", avgScore: 88, participantCount: 10 },
];

export const quizSummaryRowsMock: QuizSummaryRow[] = [
  {
    id: "qs1",
    quizTitle: "개인정보보호 퀴즈",
    avgScore: 86,
    participantCount: 57,
    passRate: 81,
  },
  {
    id: "qs2",
    quizTitle: "직장 내 괴롭힘 예방 퀴즈",
    avgScore: 83,
    participantCount: 49,
    passRate: 75,
  },
  {
    id: "qs3",
    quizTitle: "성희롱 예방교육 퀴즈",
    avgScore: 88,
    participantCount: 26,
    passRate: 85,
  },
  {
    id: "qs4",
    quizTitle: "정보보안 기본 수칙 퀴즈",
    avgScore: 82,
    participantCount: 31,
    passRate: 73,
  },
  {
    id: "qs5",
    quizTitle: "내부 통제 및 컴플라이언스 퀴즈",
    avgScore: 84,
    participantCount: 13,
    passRate: 77,
  },
];

export const difficultQuestionsMock: DifficultQuestion[] = [
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

// 지표 탭 – 그래프용 Mock 데이터
export const PII_TREND_BY_PERIOD: Record<PeriodFilter, PiiTrendPoint[]> = {
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

export const LATENCY_BUCKET_BY_PERIOD: Record<PeriodFilter, LatencyBucket[]> = {
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

export const MODEL_LATENCY_BY_PERIOD: Record<PeriodFilter, ModelLatency[]> = {
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

// 지표 탭 Mock
export const securityMetricsMock: MetricItem[] = [
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

export const qualityMetricsMock: MetricItem[] = [
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
