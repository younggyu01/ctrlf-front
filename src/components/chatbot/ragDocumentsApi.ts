// src/components/chatbot/ragDocumentsApi.ts

import { fetchJson, getAccessToken } from "../common/api/authHttp";

type EnvLike = Record<string, string | undefined>;
const ENV = import.meta.env as unknown as EnvLike;

const INFRA_BASE = String(ENV.VITE_INFRA_API_BASE ?? "/api-infra").replace(
  /\/$/,
  ""
);

function jsonBody(body: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function pickId(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export type RagUploadResponse = { documentId: string };
export type RagDocStatusResponse = {
  status: string; // PENDING/PROCESSING/COMPLETED/FAILED 등
  errorMessage?: string | null;
};

/**
 * 문서 목록 항목 타입
 */
export interface RagDocumentListItem {
  id: string; // UUID
  title: string;
  domain: string; // 예: "HR", "SEC", "EDU"
  uploaderUuid?: string;
  createdAt: string; // ISO-8601
}

/**
 * 문서 정보 타입
 */
export interface RagDocumentInfo {
  id: string; // UUID
  title: string;
  domain: string; // 예: "HR", "SEC", "EDU"
  sourceUrl: string; // S3 파일 URL
  status: string; // "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED"
}

/**
 * 문서 수정 응답 타입
 */
export interface RagDocumentUpdateResponse {
  documentId: string;
  status: string; // "REPROCESSING" 등
  updatedAt: string; // ISO-8601
}

/**
 * 문서 삭제 응답 타입
 */
export interface RagDocumentDeleteResponse {
  documentId: string;
  status: string; // "DELETED"
  deletedAt: string; // ISO-8601
}

/**
 * 문서 재처리 요청 타입
 */
export interface RagDocumentReprocessRequest {
  title?: string;
  domain?: string;
  fileUrl?: string;
  requestedBy?: string;
}

/**
 * 문서 재처리 응답 타입
 */
export interface RagDocumentReprocessResponse {
  documentId: string;
  accepted: boolean;
  status: string; // "REPROCESSING"
  jobId?: string;
  updatedAt: string; // ISO-8601
}

/**
 * 문서 원문 텍스트 응답 타입
 */
export interface RagDocumentTextResponse {
  documentId: string;
  text: string;
}

/**
 * Query 파라미터를 URL에 추가
 */
function buildQueryString(
  params: Record<string, string | number | boolean | undefined>
): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.append(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function uploadDocument(payload: {
  title: string;
  domain: string;
  fileUrl: string;
  uploaderUuid?: string;
}): Promise<RagUploadResponse> {
  console.log("uploadDocument", payload);
  
  // JWT 토큰 확인 - 없으면 명시적으로 에러 발생
  const token = await getAccessToken(30);
  if (!token) {
    throw new Error(
      "인증 토큰이 없습니다. 로그인이 필요합니다. JWT 토큰을 가져올 수 없습니다."
    );
  }
  
  const res = await fetchJson<Record<string, unknown>>(
    `${INFRA_BASE}/rag/documents/upload`,
    {
      method: "POST",
      ...jsonBody(payload),
    }
  );

  const documentId =
    pickId(res, ["documentId", "id", "materialId"]) ??
    pickId(res?.data, ["documentId", "id", "materialId"]) ??
    pickId(res?.document, ["documentId", "id", "materialId"]);

  if (!documentId)
    throw new Error("RAG 문서 업로드 응답에서 documentId를 찾지 못했습니다.");
  return { documentId };
}

export async function getDocumentStatus(
  documentId: string
): Promise<RagDocStatusResponse> {
  const res = await fetchJson<Record<string, unknown>>(
    `${INFRA_BASE}/rag/documents/${encodeURIComponent(documentId)}/status`,
    { method: "GET" }
  );

  // 가능한 응답 키들 모두 흡수
  const data =
    res?.data && typeof res.data === "object"
      ? (res.data as Record<string, unknown>)
      : null;
  const status =
    (typeof res?.status === "string" && res.status) ||
    (typeof res?.state === "string" && res.state) ||
    (data && typeof data.status === "string" ? data.status : null) ||
    "UNKNOWN";

  const errorMessage =
    (typeof res?.errorMessage === "string" && res.errorMessage) ||
    (typeof res?.message === "string" && res.message) ||
    (data && typeof data.errorMessage === "string"
      ? data.errorMessage
      : null) ||
    null;

  return { status, errorMessage };
}

/**
 * 문서 목록 조회
 *
 * 등록된 문서 목록을 필터링 및 페이징하여 조회합니다.
 */
export async function listDocuments(params?: {
  domain?: string; // 문서 도메인 필터
  uploaderUuid?: string; // 업로더 UUID 필터
  startDate?: string; // 기간 시작 (yyyy-MM-dd)
  endDate?: string; // 기간 끝 (yyyy-MM-dd)
  keyword?: string; // 제목 키워드 검색
  page?: number; // 페이지 번호 (기본값: 0)
  size?: number; // 페이지 크기 (기본값: 10)
}): Promise<RagDocumentListItem[]> {
  const { page = 0, size = 10, ...rest } = params || {};
  const query = buildQueryString({
    ...rest,
    page,
    size,
  });
  return fetchJson<RagDocumentListItem[]>(
    `${INFRA_BASE}/rag/documents${query}`
  );
}

/**
 * 문서 정보 조회
 *
 * 문서의 메타 정보를 조회합니다.
 */
export async function getDocument(documentId: string): Promise<RagDocumentInfo> {
  return fetchJson<RagDocumentInfo>(
    `${INFRA_BASE}/rag/documents/${encodeURIComponent(documentId)}`
  );
}

/**
 * 문서 수정
 *
 * 문서의 메타 정보를 수정합니다.
 */
export async function updateDocument(
  documentId: string,
  data: {
    title?: string;
    domain?: string;
    fileUrl?: string;
  }
): Promise<RagDocumentUpdateResponse> {
  return fetchJson<RagDocumentUpdateResponse>(
    `${INFRA_BASE}/rag/documents/${encodeURIComponent(documentId)}`,
    {
      method: "PATCH",
      ...jsonBody(data),
    }
  );
}

/**
 * 문서 삭제
 *
 * 문서를 삭제합니다.
 */
export async function deleteDocument(
  documentId: string
): Promise<RagDocumentDeleteResponse> {
  return fetchJson<RagDocumentDeleteResponse>(
    `${INFRA_BASE}/rag/documents/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
    }
  );
}

/**
 * 문서 재처리 요청
 *
 * 문서의 재처리를 요청합니다.
 */
export async function reprocessDocument(
  documentId: string,
  data?: RagDocumentReprocessRequest
): Promise<RagDocumentReprocessResponse> {
  return fetchJson<RagDocumentReprocessResponse>(
    `${INFRA_BASE}/rag/documents/${encodeURIComponent(documentId)}/reprocess`,
    {
      method: "POST",
      ...jsonBody(data || {}),
    }
  );
}

/**
 * 문서 원문 텍스트 조회
 *
 * 문서의 원문 텍스트를 조회합니다. S3에서 파일을 다운로드하여 텍스트를 추출합니다.
 */
export async function getDocumentText(
  documentId: string
): Promise<RagDocumentTextResponse> {
  return fetchJson<RagDocumentTextResponse>(
    `${INFRA_BASE}/rag/documents/${encodeURIComponent(documentId)}/text`,
    {
      method: "GET",
    }
  );
}
