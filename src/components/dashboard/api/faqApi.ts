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
 * FAQ 후보 목록 조회
 * GET /admin/faq/candidates
 */
export async function listFAQCandidates(
  status?: FAQCandidateStatus
): Promise<FAQCandidatesResponse> {
  const query = buildQueryString({
    status: status || undefined,
  });
  const url = `${FAQ_API_BASE}/candidates${query}`;
  
  console.log("[FAQ API] 목록 조회 요청:", url);
  console.log("[FAQ API] 필터 상태:", status || "ALL");
  
  try {
    const response = await fetchJson<FAQCandidatesResponse>(url);
    console.log("[FAQ API] 목록 조회 응답:", {
      itemsCount: response?.items?.length ?? 0,
      total: response?.total ?? 0,
      items: response?.items,
    });
    return response;
  } catch (error) {
    console.error("[FAQ API] 목록 조회 실패:", error);
    throw error;
  }
}

/**
 * FAQ 후보 자동 생성
 * POST /admin/faq/candidates/auto-generate
 */
export async function autoGenerateFAQCandidates(
  params: AutoGenerateRequest = {}
): Promise<AutoGenerateResponse> {
  const requestBody = {
    minFrequency: params.minFrequency ?? 3,
    daysBack: params.daysBack ?? 30,
  };
  
  console.log("[FAQ API] 요청 URL:", `${FAQ_API_BASE}/candidates/auto-generate`);
  console.log("[FAQ API] 요청 Body:", JSON.stringify(requestBody, null, 2));
  
  try {
    const response = await fetchJson<AutoGenerateResponse>(
      `${FAQ_API_BASE}/candidates/auto-generate`,
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
    throw error;
  }
}

/**
 * FAQ 후보 승인
 * POST /admin/faq/candidates/{id}/approve
 */
export async function approveFAQCandidate(
  candidateId: string
): Promise<FAQCandidate> {
  return fetchJson<FAQCandidate>(
    `${FAQ_API_BASE}/candidates/${candidateId}/approve`,
    {
      method: "POST",
    }
  );
}

/**
 * FAQ 후보 반려
 * POST /admin/faq/candidates/{id}/reject
 */
export async function rejectFAQCandidate(
  candidateId: string
): Promise<FAQCandidate> {
  return fetchJson<FAQCandidate>(
    `${FAQ_API_BASE}/candidates/${candidateId}/reject`,
    {
      method: "POST",
    }
  );
}

