// src/components/dashboard/api/logApi.ts
import { fetchJson } from "../../common/api/authHttp";
import { buildQueryString } from "./utils";
import type { LogListItem } from "../adminDashboardTypes";

/**
 * Infra Service Admin Dashboard Logs API Base URL
 * - Vite proxy를 통해 /api-infra → http://localhost:9003로 라우팅
 */
const INFRA_API_BASE =
  import.meta.env.VITE_INFRA_API_BASE?.toString() ?? "/api-infra";

/**
 * 로그 조회 요청 파라미터
 */
export interface LogsQueryParams {
  startDate: string; // ISO-8601 형식 (필수)
  endDate: string; // ISO-8601 형식 (필수)
  domain?: string; // 도메인 필터 (POLICY, INCIDENT, EDUCATION)
  userId?: string; // 사용자 ID 필터
  userRole?: string; // 사용자 역할 필터
  intent?: string; // 의도 필터
  route?: string; // 라우트 필터
  hasPiiInput?: boolean; // 입력 PII 검출 여부
  hasPiiOutput?: boolean; // 출력 PII 검출 여부
  ragUsed?: boolean; // RAG 사용 여부
  page?: number; // 페이지 번호 (0부터 시작)
  size?: number; // 페이지 크기 (기본: 20, 최대: 100)
  sort?: string; // 정렬 필드 및 방향 (예: "createdAt,desc")
}

/**
 * 로그 조회 응답 타입
 */
export interface LogsResponse {
  content: LogListItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

/**
 * 기간 필터를 시작/종료 날짜로 변환
 */
export function periodToDateRange(period: string): {
  startDate: string;
  endDate: string;
} {
  const endDate = new Date();
  const startDate = new Date();

  switch (period) {
    case "7d":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(startDate.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(startDate.getDate() - 90);
      break;
    default:
      // 기본값: 최근 30일
      startDate.setDate(startDate.getDate() - 30);
  }

  // 시작일은 00:00:00, 종료일은 23:59:59로 설정
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
}

/**
 * 관리자 대시보드 로그 조회
 * GET /admin/dashboard/logs
 */
export async function getAdminLogs(
  params: LogsQueryParams
): Promise<LogsResponse> {
  const queryParams: Record<string, string | number | boolean | undefined> = {
    startDate: params.startDate,
    endDate: params.endDate,
  };

  if (params.domain && params.domain !== "ALL") {
    queryParams.domain = params.domain;
  }

  if (params.userId) {
    queryParams.userId = params.userId;
  }

  if (params.userRole) {
    queryParams.userRole = params.userRole;
  }

  if (params.intent) {
    queryParams.intent = params.intent;
  }

  if (params.route && params.route !== "ALL") {
    queryParams.route = params.route;
  }

  if (params.hasPiiInput !== undefined) {
    queryParams.hasPiiInput = params.hasPiiInput;
  }

  if (params.hasPiiOutput !== undefined) {
    queryParams.hasPiiOutput = params.hasPiiOutput;
  }

  if (params.ragUsed !== undefined) {
    queryParams.ragUsed = params.ragUsed;
  }

  if (params.page !== undefined) {
    queryParams.page = params.page;
  }

  if (params.size !== undefined) {
    queryParams.size = params.size;
  }

  if (params.sort) {
    queryParams.sort = params.sort;
  }

  const query = buildQueryString(queryParams);
  const url = `${INFRA_API_BASE}/admin/dashboard/logs${query}`;

  console.log("[Logs API] 요청 URL:", url);
  console.log("[Logs API] 요청 파라미터:", {
    startDate: params.startDate,
    endDate: params.endDate,
    domain: params.domain,
    route: params.route,
    page: params.page,
    size: params.size,
    sort: params.sort,
  });

  try {
    const response = await fetchJson<LogsResponse>(url);
    console.log("[Logs API] 응답 성공:", {
      contentLength: response.content?.length ?? 0,
      totalElements: response.totalElements,
      totalPages: response.totalPages,
    });
    return response;
  } catch (error) {
    console.error("[Logs API] 요청 실패:", {
      url,
      error,
      // HttpError인 경우 상세 정보 로깅
      ...(error instanceof Error && "status" in error
        ? {
            status: (error as { status?: number }).status,
            statusText: (error as { statusText?: string }).statusText,
            body: (error as { body?: unknown }).body,
          }
        : {}),
    });
    throw error;
  }

  // 응답이 배열 형태로 올 수도 있음 (방어적 처리)
  if (Array.isArray(response)) {
    return {
      content: response,
      page: 0,
      size: response.length,
      totalElements: response.length,
      totalPages: 1,
      first: true,
      last: true,
    };
  }

  // 응답이 객체 형태인 경우
  if (response && typeof response === "object" && "content" in response) {
    return response as LogsResponse;
  }

  // content 필드가 없는 경우 빈 배열로 반환
  return {
    content: [],
    page: 0,
    size: 0,
    totalElements: 0,
    totalPages: 0,
    first: true,
    last: true,
  };
}

