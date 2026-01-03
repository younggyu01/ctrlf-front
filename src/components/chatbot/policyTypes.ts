// src/components/chatbot/policyTypes.ts

export type PolicyDocStatus =
  | "DRAFT"
  | "PENDING_REVIEWER"
  | "ACTIVE"
  | "ARCHIVED"
  | "REJECTED"
  | "DELETED";

export type PreprocessStatus = "IDLE" | "PROCESSING" | "READY" | "FAILED";
export type IndexingStatus = "IDLE" | "INDEXING" | "DONE" | "FAILED";

export type PolicyStoreErrorCode =
  // 409
  | "DRAFT_ALREADY_EXISTS"
  | "VERSION_REVERSE"
  | "FILE_DUPLICATE"
  // common
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "INTERNAL_ERROR";

export class PolicyStoreError extends Error {
  code: PolicyStoreErrorCode;
  status: number;

  constructor(code: PolicyStoreErrorCode, message: string, status?: number) {
    super(message);
    this.name = "PolicyStoreError";
    this.code = code;
    this.status =
      status ??
      (code === "NOT_FOUND"
        ? 404
        : code === "FORBIDDEN"
        ? 403
        : code === "INVALID_STATE" ||
          code.endsWith("_EXISTS") ||
          code === "VERSION_REVERSE" ||
          code === "FILE_DUPLICATE"
        ? 409
        : 500);
  }
}

/**
 * attachments[0]이 Primary(기본)
 * 기존 단일 필드(fileName/fileSizeBytes)는 항상 attachments[0]과 동기화
 */
export type PolicyAttachment = {
  id: string;
  name: string;
  sizeBytes?: number;
  mime?: string;
  uploadedAt: string; // ISO
};

export type PolicyAuditAction =
  | "CREATE_DRAFT"
  | "UPDATE_DRAFT"
  | "UPLOAD_FILE"
  | "REMOVE_FILE"
  | "PREPROCESS_START"
  | "PREPROCESS_DONE"
  | "PREPROCESS_FAIL"
  | "SUBMIT_REVIEW"
  | "REVIEW_APPROVE"
  | "REVIEW_REJECT"
  | "INDEX_START"
  | "INDEX_DONE"
  | "INDEX_FAIL"
  | "SOFT_DELETE"
  | "ROLLBACK";

export type PolicyAuditEvent = {
  id: string;
  at: string; // ISO
  actor: string;
  action: PolicyAuditAction;
  message?: string;
};

export type PolicyPreprocessPreview = {
  pages: number;
  chars: number;
  excerpt: string;
};

export type PolicyDocVersion = {
  id: string;
  documentId: string;

  title: string;
  version: number;
  changeSummary: string;

  status: PolicyDocStatus;

  /** canonical: 멀티 파일 */
  attachments?: PolicyAttachment[];

  /** legacy(계속 유지): Primary(attachments[0])와 항상 동기화 */
  fileName?: string;
  fileSizeBytes?: number;
  sourceUrl?: string; // S3 파일 URL

  preprocessStatus: PreprocessStatus;
  preprocessError?: string;
  preprocessPreview?: PolicyPreprocessPreview;
  preprocessPages?: number;
  reviewRequestedAt?: string;
  reviewItemId?: string; // ReviewerDesk work item id
  preprocessChars?: string;
  preprocessExcerpt?: string;

  indexingStatus: IndexingStatus;
  indexingError?: string;

  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  activatedAt?: string;
  deletedAt?: string;
  rejectedAt?: string;
  rejectReason?: string;

  audit: PolicyAuditEvent[];
};

export type PolicyDocGroup = {
  documentId: string;
  title: string;
  active?: PolicyDocVersion;
  draft?: PolicyDocVersion;
  pending?: PolicyDocVersion;
  rejected?: PolicyDocVersion;
  archived: PolicyDocVersion[];
  deleted?: PolicyDocVersion;
  versions: PolicyDocVersion[];
};
