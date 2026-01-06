// src/components/chatbot/reviewerDeskTypes.ts

export type ReviewStatus = "REVIEW_PENDING" | "APPROVED" | "REJECTED";

export type ReviewStage = "SCRIPT" | "FINAL";

export type ContentCategory = "MANDATORY" | "JOB" | "POLICY" | "OTHER";

export type ContentType = "VIDEO" | "POLICY_DOC";

export type PiiRiskLevel = "none" | "low" | "medium" | "high";

export type AuditAction =
  | "CREATED"
  | "SUBMITTED"
  | "AUTO_CHECKED"
  | "COMMENTED"
  | "APPROVED"
  | "REJECTED"
  | "PUBLISHED"
  | "UPDATED_BY_OTHER" // 충돌/외부 변경 시뮬레이션용
  | "SCRIPT_GENERATED" // 스크립트 생성
  | "SCRIPT_REVIEW_REQUESTED" // 1차 검토 요청
  | "FINAL_REVIEW_REQUESTED" // 2차 검토 요청
  | "VIDEO_GENERATED" // 영상 생성
  | string; // 백엔드에서 추가 이벤트 타입이 올 수 있음

export interface AuditEvent {
  id: string;
  at: string; // ISO string
  actor: string;
  action: AuditAction;
  detail?: string;
}

export interface AutoCheckResult {
  piiRiskLevel: PiiRiskLevel;
  piiFindings: string[];
  bannedWords: string[];
  qualityWarnings: string[];
}

/**
 * 연동 대비(옵셔널): 실제 백엔드 붙일 때 확장 포인트
 */
export interface WorkItemLock {
  owner: string;
  expiresAt: string; // ISO
}

export interface ReviewWorkItem {
  id: string;

  // 연동 대비 식별자 (옵셔널)
  contentId?: string;
  contentVersionLabel?: string;
  sourceSystem?: "VIDEO_PIPELINE" | "POLICY_PIPELINE";

  title: string;
  department: string;
  creatorName: string;

  // 연동 대비: creator id (옵셔널)
  creatorId?: string;

  contentType: ContentType;
  contentCategory: ContentCategory;

  createdAt: string; // ISO
  submittedAt: string; // ISO
  lastUpdatedAt?: string; // ISO

  status: ReviewStatus;
  approvedAt?: string;
  rejectedAt?: string;

  // VIDEO
  videoUrl?: string;
  durationSec?: number;
  scriptText?: string;

  // POLICY_DOC
  policyExcerpt?: string;

  autoCheck: AutoCheckResult;
  audit: AuditEvent[];

  // optimistic-lock (데모/연동 공통)
  version: number;

  // 운영성 필드(옵셔널)
  lock?: WorkItemLock;
  tags?: string[];
  riskScore?: number; // 0~100 가정(모의)

  reviewStage?: ReviewStage; // VIDEO 타입에서만 의미 있음
}
