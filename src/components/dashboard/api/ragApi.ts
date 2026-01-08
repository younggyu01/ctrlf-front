// src/components/dashboard/api/ragApi.ts
import { fetchJson } from "../../common/api/authHttp";
import { buildQueryString } from "./utils";

/**
 * Infra Service RAG Documents API Base URL
 * - Vite proxy를 통해 /api-infra → http://localhost:9003로 라우팅
 */
const INFRA_API_BASE =
  import.meta.env.VITE_INFRA_API_BASE?.toString() ?? "/api-infra";

/**
 * 버전 요약 정보 타입
 */
export interface VersionSummary {
  version: number;
  status: string; // "ACTIVE" | "DRAFT" | "PENDING" | "ARCHIVED"
  createdAt: string; // ISO-8601
}

/**
 * 사규 목록 항목 타입
 */
export interface PolicyListItem {
  id: string; // 첫 번째 버전의 UUID (Primary Key)
  documentId: string; // 예: "POL-EDU-015"
  title: string;
  domain: string; // 예: "EDU", "HR", "SEC"
  versions: VersionSummary[];
  totalVersions: number;
}

/**
 * 페이지네이션 응답 타입
 */
export interface PageResponse<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

/**
 * 버전 상세 정보 타입
 */
export interface VersionDetail {
  id: string; // UUID
  documentId: string;
  title: string;
  domain: string;
  version: number;
  status: string; // "ACTIVE" | "DRAFT" | "PENDING" | "ARCHIVED"
  changeSummary?: string;
  sourceUrl?: string; // S3 파일 URL
  uploaderUuid?: string;
  createdAt: string; // ISO-8601
  processedAt?: string; // ISO-8601
  // 전처리 관련 필드 (READY: 면 검토 가능한 상태), PROCESSING: 전처리중
  preprocessStatus?: "IDLE" | "PROCESSING" | "READY" | "FAILED";
  preprocessPages?: number;
  preprocessChars?: number;
  preprocessExcerpt?: string;
  preprocessError?: string;
  // 검토 관련 필드
  reviewRequestedAt?: string;
  reviewItemId?: string;
  // 반려 관련 필드
  rejectReason?: string;
  rejectedAt?: string;
}

/**
 * 사규 상세 조회 응답 타입
 */
export interface PolicyDetailResponse {
  documentId: string;
  title: string;
  domain: string;
  versions: VersionDetail[];
}

/**
 * 새 사규 생성 요청 타입
 */
export interface CreatePolicyRequest {
  documentId: string; // 필수, 예: "POL-EDU-015"
  title: string; // 필수
  domain: string; // 필수, 예: "EDU", "HR", "SEC"
  fileUrl?: string; // S3 파일 URL
  changeSummary?: string;
}

/**
 * 새 사규 생성 응답 타입
 */
export interface CreatePolicyResponse {
  id: string; // UUID
  documentId: string;
  title: string;
  version: number;
  status: string; // "DRAFT"
  createdAt: string; // ISO-8601
}

/**
 * 새 버전 생성 요청 타입
 */
export interface CreateVersionRequest {
  fileUrl?: string; // S3 파일 URL
  changeSummary?: string;
  title?: string; // 문서 제목 (옵션, 없으면 최신 버전의 제목 사용)
  version?: number; // 버전 번호 (옵션, 없으면 자동 증가)
}

/**
 * 새 버전 생성 응답 타입
 */
export interface CreateVersionResponse {
  id: string; // UUID
  documentId: string;
  version: number;
  status: string; // "DRAFT"
  createdAt: string; // ISO-8601
}

/**
 * 버전 수정 요청 타입
 */
export interface UpdateVersionRequest {
  title?: string;
  changeSummary?: string;
  fileUrl?: string; // S3 파일 URL
}

/**
 * 버전 수정 응답 타입
 */
export interface UpdateVersionResponse {
  id: string; // UUID
  documentId: string;
  version: number;
  status: string;
  updatedAt: string; // ISO-8601
}

/**
 * 상태 변경 요청 타입
 */
export interface UpdateStatusRequest {
  status: string; // "ACTIVE" | "DRAFT" | "PENDING" | "ARCHIVED"
}

/**
 * 상태 변경 응답 타입
 */
export interface UpdateStatusResponse {
  id: string; // UUID
  documentId: string;
  version: number;
  status: string;
  updatedAt: string; // ISO-8601
}

/**
 * 파일 교체 요청 타입
 */
export interface ReplaceFileRequest {
  fileUrl: string; // 필수, S3 파일 URL
}

/**
 * 파일 교체 응답 타입
 */
export interface ReplaceFileResponse {
  id: string; // UUID
  documentId: string;
  version: number;
  sourceUrl: string; // S3 파일 URL
  updatedAt: string; // ISO-8601
}

/**
 * 1. 사규 목록 조회
 *
 * 사규 목록을 document_id별로 그룹화하여 조회합니다.
 * 검색, 상태 필터, 페이지네이션을 지원합니다.
 * 기본적으로 ARCHIVED 상태는 제외됩니다.
 */
export async function listPolicies(params?: {
  search?: string; // document_id 또는 제목 검색어
  status?: string; // "ACTIVE" | "DRAFT" | "PENDING" | "ARCHIVED" | 전체
  page?: number; // 페이지 번호 (기본값: 0)
  size?: number; // 페이지 크기 (기본값: 20)
}): Promise<PageResponse<PolicyListItem>> {
  const { page = 0, size = 20, ...rest } = params || {};
  const query = buildQueryString({
    ...rest,
    page,
    size,
  });
  return fetchJson<PageResponse<PolicyListItem>>(
    `${INFRA_API_BASE}/rag/documents/policies${query}`
  );
}

/**
 * 2. 사규 상세 조회
 *
 * document_id로 사규의 모든 버전을 조회합니다.
 */
export async function getPolicy(
  documentId: string
): Promise<PolicyDetailResponse> {
  return fetchJson<PolicyDetailResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}`
  );
}

/**
 * 3. 버전별 상세 조회
 *
 * 특정 버전의 상세 정보를 조회합니다.
 */
export async function getPolicyVersion(
  documentId: string,
  version: number
): Promise<VersionDetail> {
  return fetchJson<VersionDetail>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions/${version}`
  );
}

/**
 * 4. 버전 목록 조회
 *
 * 사규의 모든 버전 목록을 조회합니다.
 */
export async function getPolicyVersions(
  documentId: string
): Promise<VersionDetail[]> {
  return fetchJson<VersionDetail[]>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions`
  );
}

/**
 * 5. 새 사규 생성
 *
 * 새로운 사규를 생성합니다.
 * 초기 버전(v1)이 DRAFT 상태로 생성됩니다.
 * JWT Bearer Token이 필요합니다 (uploaderUuid는 자동 추출).
 */
export async function createPolicy(
  data: CreatePolicyRequest
): Promise<CreatePolicyResponse> {
  return fetchJson<CreatePolicyResponse>(
    `${INFRA_API_BASE}/rag/documents/policies`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );
}

/**
 * 6. 새 버전 생성
 *
 * 기존 사규의 새 버전을 생성합니다.
 * 버전 번호는 자동으로 증가하며 DRAFT 상태로 생성됩니다.
 * JWT Bearer Token이 필요합니다 (uploaderUuid는 자동 추출).
 */
export async function createVersion(
  documentId: string,
  data: CreateVersionRequest
): Promise<CreateVersionResponse> {
  return fetchJson<CreateVersionResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );
}

/**
 * 7. 버전 수정
 *
 * 사규 버전의 change_summary나 파일을 수정합니다.
 */
export async function updateVersion(
  documentId: string,
  version: number,
  data: UpdateVersionRequest
): Promise<UpdateVersionResponse> {
  return fetchJson<UpdateVersionResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions/${version}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );
}

/**
 * 8. 상태 변경
 *
 * 사규 버전의 상태를 변경합니다.
 * ACTIVE로 변경 시 같은 document_id의 다른 ACTIVE 버전은 자동으로 DRAFT로 변경됩니다.
 */
export async function updateStatus(
  documentId: string,
  version: number,
  data: UpdateStatusRequest
): Promise<UpdateStatusResponse> {
  return fetchJson<UpdateStatusResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions/${version}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );
}

/**
 * 9. 파일 업로드/교체
 *
 * 사규 버전의 파일을 교체합니다.
 */
export async function replaceFile(
  documentId: string,
  version: number,
  data: ReplaceFileRequest
): Promise<ReplaceFileResponse> {
  return fetchJson<ReplaceFileResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions/${version}/file`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );
}

/**
 * 검토 승인 요청 타입
 */
export interface ApproveReviewRequest {
  // 승인은 사유가 필요 없음
}

/**
 * 검토 반려 요청 타입
 */
export interface RejectReviewRequest {
  reason: string; // 반려 사유 (필수)
}

/**
 * 검토 승인/반려 응답 타입
 */
export interface ReviewResponse {
  id: string;
  documentId: string;
  version: number;
  status: string;
  rejectReason?: string;
  rejectedAt?: string;
  updatedAt: string;
}

/**
 * 10. 검토 승인
 *
 * 검토 대기(PENDING) 상태인 사규를 승인하여 ACTIVE 상태로 변경합니다.
 */
export async function approveReview(
  documentId: string,
  version: number,
  data: ApproveReviewRequest = {}
): Promise<ReviewResponse> {
  return fetchJson<ReviewResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions/${version}/review/approve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );
}

/**
 * 11. 검토 반려
 *
 * 검토 대기(PENDING) 상태인 사규를 반려하여 REJECTED 상태로 변경합니다.
 */
export async function rejectReview(
  documentId: string,
  version: number,
  data: RejectReviewRequest
): Promise<ReviewResponse> {
  return fetchJson<ReviewResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions/${version}/review/reject`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );
}

/**
 * S3 Presigned URL 발급 요청 타입
 */
export interface S3PresignUploadRequest {
  filename: string;
  contentType: string;
  type: "image" | "docs" | "video";
}

/**
 * S3 Presigned URL 발급 응답 타입
 */
export interface S3PresignUploadResponse {
  uploadUrl: string; // Presigned PUT URL
  fileUrl: string; // s3://bucket/key
}

/**
 * S3 Presigned Upload URL 발급
 *
 * 파일 업로드를 위한 Presigned URL을 발급받습니다.
 */
export async function getS3PresignedUploadUrl(
  data: S3PresignUploadRequest
): Promise<S3PresignUploadResponse> {
  return fetchJson<S3PresignUploadResponse>(
    `${INFRA_API_BASE}/files/presign/upload`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }
  );
}

/**
 * S3에 파일 업로드
 *
 * Presigned URL을 사용하여 S3에 파일을 업로드합니다.
 */
export async function uploadFileToS3(
  presignedUrl: string,
  file: File
): Promise<void> {
  const response = await fetch(presignedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`S3 업로드 실패: ${response.status} ${errorText}`);
  }
}

// ========== Preprocess API ==========

/**
 * 전처리 미리보기 청크 타입
 */
export interface PreprocessChunk {
  chunkIndex: number;
  text: string;
}

/**
 * 전처리 미리보기 응답 타입
 */
export interface PreprocessPreviewResponse {
  preprocessStatus: "IDLE" | "PROCESSING" | "READY" | "FAILED";
  preprocessPages: number | null;
  preprocessChars: number | null;
  preprocessExcerpt: string | null;
  preprocessError: string | null;
  content: string | null;
}

/**
 * 전처리 재시도 응답 타입
 */
export interface RetryPreprocessResponse {
  documentId: string;
  version: number;
  preprocessStatus: string;
  message: string;
}

/**
 * 전처리 미리보기 조회
 */
export async function getPreprocessPreview(
  documentId: string,
  version: number
): Promise<PreprocessPreviewResponse> {
  return fetchJson<PreprocessPreviewResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions/${version}/preprocess`
  );
}

/**
 * 전처리 재시도
 */
export async function retryPreprocess(
  documentId: string,
  version: number
): Promise<RetryPreprocessResponse> {
  return fetchJson<RetryPreprocessResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions/${version}/preprocess/retry`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );
}

// ========== History API ==========

/**
 * 히스토리 항목 타입
 */
export interface HistoryItem {
  id: string;
  documentId: string;
  version: number;
  action: string;
  actor?: string;
  message?: string;
  createdAt: string;
}

/**
 * 히스토리 조회 응답 타입
 */
export interface HistoryResponse {
  documentId: string;
  version: number;
  items: HistoryItem[];
}

/**
 * 히스토리 조회
 */
export async function getHistory(
  documentId: string,
  version: number
): Promise<HistoryResponse> {
  return fetchJson<HistoryResponse>(
    `${INFRA_API_BASE}/rag/documents/policies/${documentId}/versions/${version}/history`
  );
}
