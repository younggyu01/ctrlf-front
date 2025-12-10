// src/components/chatbot/adminFilterTypes.ts

// 기간 프리셋 (AdminDashboardView 의 PeriodFilter 와 동일)
export type PeriodPreset = "7d" | "30d" | "90d";

// 부서 옵션 타입
export interface DepartmentOption {
  id: string;
  name: string;
}

/**
 * 공통 필터 상태
 * - overview 모드: period + departmentId 만 사용
 * - logs 모드: period + departmentId + domain/route/model + onlyError/hasPiiOnly 사용
 */
export interface CommonFilterState {
  period: PeriodPreset;
  departmentId: string;

  // logs 전용 필터
  domainId?: string;
  routeId?: string;
  modelId?: string;
  onlyError?: boolean;
  hasPiiOnly?: boolean;
}
