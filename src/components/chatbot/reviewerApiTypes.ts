// src/components/chatbot/reviewerApiTypes.ts
import type { ReviewWorkItem } from "./reviewerDeskTypes";

export type ReviewerSortMode = "NEWEST" | "OLDEST" | "DUE_SOON" | "RISK_HIGH";
export type ReviewerTabKey =
  | "REVIEW_PENDING"
  | "REJECTED"
  | "APPROVED"
  | "MY_ACTIVITY";

/**
 * 검토 목록 조회 파라미터
 * 백엔드 문서: GET /admin/videos/review-queue
 */
export interface ReviewListParams {
  tab: ReviewerTabKey;
  q?: string; // search: 제목/부서/제작자 검색
  sort?: ReviewerSortMode;
  myProcessingOnly?: boolean; // 내 처리만 필터
  reviewStage?: "first" | "second" | "document" | "all"; // 검토 단계 필터
  page?: number; // 페이지 번호 (0-base)
  size?: number; // 페이지 크기 (기본값: 30)
  limit?: number; // 호환성 유지 (size로 매핑)
  cursor?: string; // 호환성 유지 (사용 안 함)
}

/**
 * 검토 목록 조회 응답
 * 백엔드 문서: GET /admin/videos/review-queue Response
 */
export interface ReviewListResponse {
  items: ReviewWorkItem[];
  totalCount: number;
  page: number;
  size: number;
  totalPages: number;
  firstRoundCount?: number; // 1차 검토 대기 개수
  secondRoundCount?: number; // 2차 검토 대기 개수
  documentCount?: number; // 문서 타입 개수
  nextCursor?: string; // 호환성 유지
}

/**
 * 검토 통계 조회 응답
 * 백엔드 문서: GET /admin/videos/review-stats Response
 */
export interface ReviewStatsResponse {
  pendingCount: number; // 검토 대기
  approvedCount: number; // 승인됨
  rejectedCount: number; // 반려됨
  myActivityCount: number; // 내 활동
}

/**
 * 검토 상세 정보 조회 응답
 * 백엔드 문서: GET /admin/videos/{videoId}/review-detail Response
 */
export interface ReviewDetailResponse {
  videoId: string;
  educationId: string;
  educationTitle: string;
  videoTitle: string;
  status: "SCRIPT_REVIEW_REQUESTED" | "FINAL_REVIEW_REQUESTED" | "PUBLISHED" | string;
  reviewStage: "1차" | "2차" | "승인됨" | "1차 반려" | "2차 반려" | "SCRIPT" | "FINAL";
  creatorDepartment?: string;
  creatorName?: string;
  creatorUuid?: string;
  submittedAt: string; // ISO8601
  updatedAt: string; // ISO8601
  category?: string;
  eduType?: "MANDATORY" | "JOB";
  scriptId?: string;
  scriptVersion?: number;
  // 백엔드에서 제공할 수 있는 추가 필드 (optional)
  fileUrl?: string; // 영상 파일 URL (2차 검토 시 필요)
  duration?: number; // 영상 길이(초)
  rejectedComment?: string; // 반려 사유
  rejectedStage?: "SCRIPT" | "VIDEO" | string; // 반려된 단계
}

/**
 * 감사 이력 조회 응답
 * 백엔드 문서: GET /admin/videos/{videoId}/review-history Response
 */
export interface ReviewHistoryResponse {
  videoId: string;
  videoTitle: string;
  history: Array<{
    eventType: "CREATED" | "AUTO_CHECKED" | "REJECTED" | "APPROVED" | "PUBLISHED" | string;
    description: string;
    timestamp: string; // ISO8601
    actorName: string;
    actorUuid?: string;
    rejectionReason?: string | null;
    rejectionStage?: "SCRIPT" | "VIDEO" | null;
  }>;
}

/**
 * 승인/반려 요청
 * 백엔드 문서: PUT /admin/videos/{videoId}/approve, PUT /admin/videos/{videoId}/reject
 */
export interface DecisionRequest {
  version?: number; // 호환성 유지 (백엔드에서 사용 안 함)
  lockToken?: string; // 호환성 유지 (백엔드에서 사용 안 함)
  reason?: string; // 반려 사유 (reject 시 필수)
}

/**
 * 승인/반려 응답
 */
export interface DecisionResponse {
  item: ReviewWorkItem;
}

/**
 * Lock 획득 응답
 * 백엔드 API에는 lock 기능이 없으므로 호환성을 위한 타입
 */
export interface AcquireLockResponse {
  lockToken: string;
  expiresAt: string; // ISO8601
  ownerId: string;
  ownerName: string;
}

/**
 * Lock 해제 응답
 * 백엔드 API에는 lock 기능이 없으므로 호환성을 위한 타입
 */
export interface ReleaseLockResponse {
  released: boolean;
}

/**
 * 409 충돌 payload 권장 형태
 * - code로 충돌 원인을 명확하게 내려주면 프론트 UX가 안정된다.
 */
export type ConflictCode =
  | "LOCK_CONFLICT"
  | "VERSION_CONFLICT"
  | "ALREADY_PROCESSED";

export interface ConflictPayload {
  code: ConflictCode;
  message?: string;
  current?: Partial<ReviewWorkItem> & {
    id?: string;
    version?: number;
    status?: string;
    // lock 스키마는 reviewerDeskTypes에 맞춰서 partial로 둔다
  };
}
