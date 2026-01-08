// src/components/dashboard/api/faqApi.ts
import { fetchJson } from "../../common/api/authHttp";
import { buildQueryString } from "./utils";

/**
 * FAQ Admin API Base URL
 * - Vite proxy를 통해 /admin/faq → http://localhost:9005로 라우팅
 */
const FAQ_API_BASE =
  import.meta.env.VITE_FAQ_API_BASE?.toString() ?? "/admin/faq";

/**
 * AI 표준 도메인(RouterDomain Enum)을 FAQ 도메인으로 매핑
 * 
 * AI 표준 도메인:
 * - POLICY: 사규/보안 정책
 * - EDU: 4대 교육/직무 교육
 * - HR: 인사/근태/복지/연차/급여
 * - QUIZ: 퀴즈/시험 관련
 * - GENERAL: 일반
 * 
 * FAQ 도메인 (챗봇 UI에 표시되는 10개):
 * - ACCOUNT, APPROVAL, HR, PAY, WELFARE, EDUCATION, IT, SECURITY, FACILITY, ETC
 */
function mapRouterDomainToFaqDomain(routerDomain?: string): string | undefined {
  if (!routerDomain) return undefined;
  
  const upperDomain = routerDomain.toUpperCase();
  
  switch (upperDomain) {
    case "POLICY":
      // 사규/보안 정책 → SECURITY (보안 정책이므로)
      return "SECURITY";
    case "EDU":
    case "EDUCATION":
      // 4대 교육/직무 교육 → EDUCATION
      return "EDUCATION";
    case "HR":
      // 인사/근태/복지/연차/급여 → HR (기본값, 세분화는 추후 고려)
      return "HR";
    case "QUIZ":
      // 퀴즈/시험 관련 → EDUCATION
      return "EDUCATION";
    case "GENERAL":
      // 일반 → ETC
      return "ETC";
    default:
      // 이미 FAQ 도메인인 경우 그대로 반환 (ACCOUNT, APPROVAL, PAY, WELFARE, IT, SECURITY, FACILITY, ETC 등)
      // 또는 알 수 없는 경우 undefined 반환
      const faqDomains = ["ACCOUNT", "APPROVAL", "HR", "PAY", "WELFARE", "EDUCATION", "IT", "SECURITY", "FACILITY", "ETC"];
      if (faqDomains.includes(upperDomain)) {
        return upperDomain;
      }
      return undefined;
  }
}

/**
 * FAQ 후보 상태
 * - NEW: 자동 생성된 후보 (아직 검토 전)
 * - PENDING: 검토 대기 중 (수동 생성 또는 NEW에서 전환)
 * - APPROVED: 승인됨
 * - REJECTED: 반려됨
 */
export type FAQCandidateStatus = "NEW" | "PENDING" | "APPROVED" | "REJECTED";

/**
 * FAQ 후보 항목 (백엔드 실제 응답 구조)
 */
export interface FAQCandidate {
  faqDraftId?: string; // 백엔드 응답에서 사용
  id?: string; // 목록 조회 시 사용될 수 있음
  domain?: string; // 도메인 (POLICY, FAQ 등)
  clusterId?: string; // 클러스터 ID
  question: string; // 사용자 질문
  answer?: string; // 자동 생성된 답변 (일반 텍스트)
  answerMarkdown?: string; // 자동 생성된 답변 (마크다운)
  frequency?: number; // 질문 빈도 (몇 번 질문되었는지)
  firstAskedAt?: string; // ISO 8601 형식
  lastAskedAt?: string; // ISO 8601 형식
  status: FAQCandidateStatus;
  createdAt?: string; // ISO 8601 형식
  updatedAt?: string; // ISO 8601 형식
  summary?: string; // 요약
  sourceDocId?: string | null;
  sourceDocVersion?: number | null;
  sourceArticleLabel?: string | null;
  sourceArticlePath?: string | null;
  answerSource?: string; // MILVUS 등
  aiConfidence?: number; // AI 신뢰도
}

/**
 * FAQ 후보 목록 응답
 */
export interface FAQCandidatesResponse {
  items: FAQCandidate[];
  total: number;
}

/**
 * 자동 생성 요청 파라미터
 */
export interface AutoGenerateRequest {
  minFrequency?: number; // 기본값: 3
  daysBack?: number; // 기본값: 30
}

/**
 * 자동 생성 응답의 Draft 항목 (백엔드 실제 응답 구조)
 */
export interface FAQDraftItem {
  faqDraftId: string;
  domain: string;
  clusterId: string;
  question: string;
  answerMarkdown: string;
  summary?: string;
  sourceDocId?: string | null;
  sourceDocVersion?: number | null;
  sourceArticleLabel?: string | null;
  sourceArticlePath?: string | null;
  answerSource: string;
  aiConfidence: number;
  createdAt: string;
}

/**
 * 자동 생성 응답 (백엔드 실제 응답 구조)
 */
export interface AutoGenerateResponse {
  status: "SUCCESS" | "FAILED";
  candidatesFound: number; // 발견된 후보 수
  draftsGenerated: number; // 생성된 초안 수
  draftsFailed: number; // 생성 실패 수
  drafts: FAQDraftItem[]; // 생성된 초안 목록
  errorMessage: string | null;
}

/**
 * FAQDraftItem을 FAQCandidate로 변환
 */
export function convertDraftToCandidate(draft: FAQDraftItem): FAQCandidate {
  return {
    id: draft.faqDraftId,
    faqDraftId: draft.faqDraftId,
    domain: draft.domain,
    clusterId: draft.clusterId,
    question: draft.question,
    answer: draft.answerMarkdown, // answerMarkdown을 answer로 매핑
    answerMarkdown: draft.answerMarkdown,
    status: "NEW", // 자동 생성된 것은 기본적으로 NEW 상태
    createdAt: draft.createdAt,
    updatedAt: draft.createdAt,
    summary: draft.summary,
    sourceDocId: draft.sourceDocId,
    sourceDocVersion: draft.sourceDocVersion,
    sourceArticleLabel: draft.sourceArticleLabel,
    sourceArticlePath: draft.sourceArticlePath,
    answerSource: draft.answerSource,
    aiConfidence: draft.aiConfidence,
    // frequency, firstAskedAt, lastAskedAt는 목록 조회 API에서 제공될 것으로 예상
    frequency: undefined,
    firstAskedAt: undefined,
    lastAskedAt: undefined,
  };
}

/**
 * 프론트엔드 상태를 백엔드 상태로 변환
 * - APPROVED → PUBLISHED
 * - PENDING → DRAFT
 * - REJECTED → REJECTED
 */
function mapStatusToBackend(status?: FAQCandidateStatus): string | undefined {
  if (!status) return undefined;
  switch (status) {
    case "APPROVED":
      return "PUBLISHED";
    case "PENDING":
      return "DRAFT";
    case "REJECTED":
      return "REJECTED";
    case "NEW":
      return "DRAFT"; // NEW도 DRAFT로 매핑
    default:
      return undefined;
  }
}

/**
 * 백엔드 상태를 프론트엔드 상태로 변환
 * - PUBLISHED → APPROVED
 * - DRAFT → PENDING
 * - REJECTED → REJECTED
 */
function mapStatusFromBackend(backendStatus: string): FAQCandidateStatus {
  switch (backendStatus.toUpperCase()) {
    case "PUBLISHED":
      return "APPROVED";
    case "DRAFT":
      return "PENDING";
    case "REJECTED":
      return "REJECTED";
    default:
      return "PENDING"; // 기본값
  }
}

/**
 * FAQCandidate의 상태를 백엔드 응답에서 변환
 */
function normalizeCandidateStatus(candidate: FAQCandidate): FAQCandidate {
  if (candidate.status && (candidate.status === "PUBLISHED" || candidate.status === "DRAFT")) {
    return {
      ...candidate,
      status: mapStatusFromBackend(candidate.status),
    };
  }
  return candidate;
}

/**
 * FAQ 후보 목록 조회
 * GET /admin/faq/drafts
 */
export async function listFAQCandidates(
  status?: FAQCandidateStatus
): Promise<FAQCandidatesResponse> {
  // 백엔드 상태 값으로 변환
  const backendStatus = mapStatusToBackend(status);
  const query = buildQueryString({
    status: backendStatus || undefined,
  });
  const url = `${FAQ_API_BASE}/drafts${query}`;
  
  console.log("[FAQ API] 목록 조회 요청:", url);
  console.log("[FAQ API] 프론트 필터 상태:", status || "ALL");
  console.log("[FAQ API] 백엔드 상태:", backendStatus || "ALL");
  
  try {
    const response = await fetchJson<FAQCandidatesResponse | FAQCandidate[]>(url);
    
    // 응답이 배열인 경우 (백엔드가 직접 배열을 반환하는 경우)
    if (Array.isArray(response)) {
      console.log("[FAQ API] 응답이 배열 형태입니다. 변환합니다.");
      // 상태 값 변환
      const normalizedItems = response.map(normalizeCandidateStatus);
      const converted: FAQCandidatesResponse = {
        items: normalizedItems,
        total: normalizedItems.length,
      };
      console.log("[FAQ API] 목록 조회 응답:", {
        itemsCount: converted.items?.length ?? 0,
        total: converted.total ?? 0,
      });
      return converted;
    }
    
    // 응답이 객체인 경우
    const responseObj = response as FAQCandidatesResponse;
    if (responseObj.items && Array.isArray(responseObj.items)) {
      // 상태 값 변환
      responseObj.items = responseObj.items.map(normalizeCandidateStatus);
    }
    console.log("[FAQ API] 목록 조회 응답:", {
      itemsCount: responseObj?.items?.length ?? 0,
      total: responseObj?.total ?? 0,
    });
    return responseObj;
  } catch (error) {
    console.error("[FAQ API] 목록 조회 실패:", error);
    throw error;
  }
}

/**
 * FAQ 후보 자동 생성
 * POST /admin/faq/drafts/auto-generate
 */
export async function autoGenerateFAQCandidates(
  params: AutoGenerateRequest = {}
): Promise<AutoGenerateResponse> {
  const requestBody = {
    minFrequency: params.minFrequency ?? 3,
    daysBack: params.daysBack ?? 30,
  };
  
  console.log("[FAQ API] 요청 URL:", `${FAQ_API_BASE}/drafts/auto-generate`);
  console.log("[FAQ API] 요청 Body:", JSON.stringify(requestBody, null, 2));
  
  try {
    const response = await fetchJson<AutoGenerateResponse>(
      `${FAQ_API_BASE}/drafts/auto-generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );
    console.log("[FAQ API] 응답 성공:", response);
    return response;
  } catch (error) {
    console.error("[FAQ API] 요청 실패:", error);
    // HttpError인 경우 상세 정보 로깅
    if (error instanceof Error && "status" in error) {
      const httpError = error as {
        status?: number;
        statusText?: string;
        body?: unknown;
        message?: string;
      };
      console.error("[FAQ API] HTTP 에러 상세:", {
        status: httpError.status,
        statusText: httpError.statusText,
        body: httpError.body,
        message: httpError.message,
        requestBody,
        url: `${FAQ_API_BASE}/drafts/auto-generate`,
      });
    }
    throw error;
  }
}

/**
 * FAQ 후보 승인
 * POST /admin/faq/drafts/{id}/approve
 * 백엔드는 성공 시 null을 반환할 수 있음
 */
export async function approveFAQCandidate(
  candidateId: string,
  params: {
    reviewerId: string;
    question: string;
    answer: string;
  }
): Promise<FAQCandidate | null> {
  const requestBody = {
    reviewerId: params.reviewerId,
    question: params.question,
    answer: params.answer,
  };
  
  console.log("[FAQ API] 승인 요청:", `${FAQ_API_BASE}/drafts/${candidateId}/approve`, requestBody);
  try {
    const response = await fetchJson<FAQCandidate | null>(
      `${FAQ_API_BASE}/drafts/${candidateId}/approve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );
    console.log("[FAQ API] 승인 응답:", response);
    
    // 백엔드가 null을 반환하는 경우 (정상 동작)
    if (!response) {
      console.log("[FAQ API] 승인 응답이 null입니다. (백엔드 정상 동작)");
      return null;
    }
    
    console.log("[FAQ API] 승인된 FAQ 정보:", {
      id: response.id || response.faqDraftId,
      question: response.question,
      domain: response.domain,
      status: response.status,
    });
    return response;
  } catch (error) {
    console.error("[FAQ API] 승인 요청 실패:", error);
    throw error;
  }
}

/**
 * FAQ 후보 반려
 * POST /admin/faq/drafts/{id}/reject
 * 백엔드는 성공 시 null을 반환할 수 있음
 */
export async function rejectFAQCandidate(
  candidateId: string,
  params: {
    reviewerId: string;
    question: string;
    answer: string;
  }
): Promise<FAQCandidate | null> {
  const requestBody = {
    reviewerId: params.reviewerId,
    question: params.question,
    answer: params.answer,
  };
  
  console.log("[FAQ API] 반려 요청:", `${FAQ_API_BASE}/drafts/${candidateId}/reject`, requestBody);
  try {
    const response = await fetchJson<FAQCandidate | null>(
      `${FAQ_API_BASE}/drafts/${candidateId}/reject`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );
    console.log("[FAQ API] 반려 응답:", response);
    
    // 백엔드가 null을 반환하는 경우 (정상 동작)
    if (!response) {
      console.log("[FAQ API] 반려 응답이 null입니다. (백엔드 정상 동작)");
      return null;
    }
    
    console.log("[FAQ API] 반려된 FAQ 정보:", {
      id: response.id || response.faqDraftId,
      question: response.question,
      domain: response.domain,
      status: response.status,
    });
    return response;
  } catch (error) {
    console.error("[FAQ API] 반려 요청 실패:", error);
    throw error;
  }
}

/**
 * FAQ 후보 삭제
 * DELETE /admin/faq/drafts/{draftId}?reviewerId={uuid}
 */
export async function deleteFAQCandidate(
  candidateId: string,
  reviewerId: string
): Promise<void> {
  const query = buildQueryString({
    reviewerId,
  });
  const url = `${FAQ_API_BASE}/drafts/${candidateId}${query}`;
  
  console.log("[FAQ API] 삭제 요청:", url, { candidateId, reviewerId });
  try {
    await fetchJson<void>(
      url,
      {
        method: "DELETE",
      }
    );
    console.log("[FAQ API] 삭제 성공:", candidateId);
  } catch (error) {
    console.error("[FAQ API] 삭제 요청 실패:", error);
    throw error;
  }
}

/**
 * 실제 서비스에 게시된 FAQ 목록 조회 (도메인별)
 * GET /api/faq?domain={domain}
 */
export interface PublishedFAQItem {
  id: string;
  domain: string;
  question: string;
  answer: string;
  createdAt?: string;
  updatedAt?: string;
}

const FAQ_SERVICE_ENDPOINT =
  import.meta.env.VITE_FAQ_LIST_ENDPOINT?.toString() ?? "/api/faq";

export async function listPublishedFAQs(
  domain?: string
): Promise<PublishedFAQItem[]> {
  const query = buildQueryString({
    domain: domain ? domain.toUpperCase() : undefined,
  });
  const url = `${FAQ_SERVICE_ENDPOINT}${query}`;
  
  console.log("[FAQ API] 게시된 FAQ 목록 조회 요청:", url);
  
  try {
    const response = await fetchJson<PublishedFAQItem[] | unknown>(url);
    
    // 응답이 배열인 경우
    if (Array.isArray(response)) {
      console.log("[FAQ API] 게시된 FAQ 목록 조회 성공:", response.length, "개");
      return response;
    }
    
    // 응답이 객체인 경우 (items 필드가 있을 수 있음)
    if (response && typeof response === "object" && "items" in response) {
      const items = (response as { items: unknown }).items;
      if (Array.isArray(items)) {
        console.log("[FAQ API] 게시된 FAQ 목록 조회 성공:", items.length, "개");
        return items as PublishedFAQItem[];
      }
    }
    
    console.warn("[FAQ API] 게시된 FAQ 목록 응답 형식이 예상과 다릅니다:", response);
    return [];
  } catch (error) {
    console.error("[FAQ API] 게시된 FAQ 목록 조회 실패:", error);
    throw error;
  }
}

