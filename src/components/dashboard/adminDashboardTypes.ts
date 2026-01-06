// src/components/dashboard/adminDashboardTypes.ts
import type { PeriodPreset } from "./adminFilterTypes";

/**
 * 관리자 대시보드 탭 ID
 */
export type AdminTabId =
  | "chatbot"
  | "education"
  | "quiz"
  | "metrics"
  | "accounts"
  | "logs"
  | "policy"
  | "faq";

// adminFilterTypes 의 PeriodPreset 을 그대로 사용
export type PeriodFilter = PeriodPreset;

/**
 * KPI 카드 공통 타입
 */
export interface KpiCard {
  id: string;
  label: string;
  value: string;
  caption?: string;
}

/**
 * 챗봇 탭용 타입들
 */
export interface ChatbotVolumePoint {
  label: string;
  count: number;
  /**
   * 해당 구간 에러율 (0~1, optional)
   * - 질문 수 + 에러율 추이를 함께 보기 위한 필드
   */
  errorRatio?: number;
}

export interface ChatbotDomainShare {
  id: string;
  domainLabel: string;
  ratio: number; // %
}

export interface ChatbotRouteShare {
  id: string;
  routeLabel: string;
  ratio: number; // %
}

export interface PopularKeyword {
  keyword: string;
  count: number;
}

/**
 * 교육 탭용 타입들
 */
export interface MandatoryCourseProgress {
  id: string;
  name: string;
  completionRate: number; // 0~100
}

export type JobCourseStatus = "in-progress" | "completed" | "not-started";

export interface JobCourseSummary {
  id: string;
  title: string;
  status: JobCourseStatus;
  learnerCount: number;
}

export interface DeptEducationRow {
  id: string;
  deptName: string;
  targetCount: number;
  completedCount: number;
  completionRate: number;
}

/**
 * 퀴즈 탭용 타입들
 */
export interface DeptQuizScoreRow {
  id: string;
  deptName: string;
  avgScore: number;
  participantCount: number;
}

export interface QuizSummaryRow {
  id: string;
  quizTitle: string;
  avgScore: number;
  participantCount: number;
  passRate: number; // %
}

export interface DifficultQuestion {
  id: string;
  title: string;
  wrongRate: number; // %
}

/**
 * 지표 탭용 타입들
 */
export interface MetricItem {
  id: string;
  label: string;
  value: string;
  description?: string;
}

export interface PiiTrendPoint {
  label: string;
  inputRatio: number; // 입력 PII 비율 (%)
  outputRatio: number; // 출력 PII 비율 (%)
}

export interface LatencyBucket {
  label: string;
  count: number; // 해당 구간 응답 건수
}

export interface ModelLatency {
  id: string;
  modelLabel: string;
  avgMs: number; // 평균 응답 시간(ms)
}

/**
 * PII 리포트 타입
 */
export type PiiRiskLevel = "none" | "warning" | "high";

export interface PiiReport {
  riskLevel: PiiRiskLevel;
  /**
   * 요약 문장 블록 (문단 단위)
   */
  summaryLines: string[];
  /**
   * 탐지된 개인정보 항목 리스트 (이미 포맷팅된 문장)
   */
  detectedItems: string[];
  /**
   * 권장 조치 리스트
   */
  recommendedActions: string[];
  /**
   * 마스킹된 텍스트 (있을 때만 표시)
   */
  maskedText?: string;
  /**
   * 하단 메타 정보
   */
  modelName: string;
  analyzedAt: string;
  traceId: string;
}

/**
 * 세부 로그 탭 타입들
 * 백엔드 API 스펙에 맞춘 타입 정의
 */
export interface LogListItem {
  id: number; // 로그 ID (PK)
  createdAt: string; // ISO-8601 형식 (예: "2025-01-15T10:30:00Z")
  userId: string; // 사용자 ID / 사번
  userRole: string; // 사용자 역할 (EMPLOYEE, MANAGER, ADMIN, INCIDENT_MANAGER)
  department: string | null; // 사용자 부서 (nullable)
  domain: string; // 도메인 (POLICY, INCIDENT, EDUCATION)
  intent: string; // 질문 의도 (POLICY_QA, INCIDENT_REPORT, EDUCATION_QA, GENERAL_CHAT 등)
  route: string; // 라우팅 결과 (ROUTE_RAG_INTERNAL, ROUTE_LLM_ONLY, ROUTE_INCIDENT 등)
  modelName: string | null; // 사용된 LLM 모델명 (nullable)
  hasPiiInput: boolean; // 입력(질문)에서 PII 검출 여부
  hasPiiOutput: boolean; // 출력(답변)에서 PII 검출 여부
  ragUsed: boolean; // RAG 검색 사용 여부
  ragSourceCount: number; // RAG로 검색된 문서 개수
  latencyMsTotal: number; // 전체 처리 시간 (밀리초)
  errorCode: string | null; // 에러 코드 (에러 발생 시)
  errorMessage: string | null; // 에러 메시지 (에러 발생 시)
  conversationId: string; // 채팅 세션 ID
  turnId: number | null; // 세션 내 턴 인덱스 (0부터 시작, nullable)
  questionMasked: string | null; // 마스킹된 질문 텍스트 (PII 제거됨, nullable)
  answerMasked: string | null; // 마스킹된 답변 텍스트 (PII 제거됨, nullable)
}

/**
 * 계정/롤 관리 탭 타입들
 * - Keycloak 롤 네이밍과 맞춤
 */
export type RoleKey =
  | "EMPLOYEE"
  | "VIDEO_CREATOR"
  | "CONTENTS_REVIEWER"
  | "SYSTEM_ADMIN";

export type CreatorType = "DEPT_CREATOR" | "GLOBAL_CREATOR" | null;

export interface DeptScopeOption {
  id: string;
  name: string;
}

export interface AdminUserSummary {
  id: string;
  name: string;
  employeeNo: string;
  deptCode: string;
  deptName: string;
  roles: RoleKey[];
  creatorType?: CreatorType;
  creatorDeptScope?: string[];
}

export type AccountMessageType = "info" | "success" | "warning" | "error";

export interface AccountMessage {
  type: AccountMessageType;
  text: string;
}
