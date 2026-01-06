// src/components/dashboard/api/utils.ts

/**
 * 기간 필터를 백엔드 형식(일수)으로 변환
 */
export function periodToDays(period: string): number | undefined {
  switch (period) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    default:
      return undefined;
  }
}

/**
 * Query 파라미터를 URL에 추가
 */
export function buildQueryString(
  params: Record<string, string | number | boolean | undefined>
): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      // boolean 값은 "true"/"false" 문자열로 변환
      if (typeof value === "boolean") {
        searchParams.append(key, String(value));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

/**
 * 교육 서비스 API Base URL
 * - Vite proxy를 통해 /api-edu → http://localhost:9002로 라우팅
 */
export const API_BASE = "/api-edu";

