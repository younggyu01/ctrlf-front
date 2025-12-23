// src/components/chatbot/creatorStudioTypes.ts

export type CreatorType = "DEPT_CREATOR" | "GLOBAL_CREATOR";

export type ReviewStage = "SCRIPT" | "FINAL";

/**
 * CreatorStatus는 "시스템 상태"를 의미합니다.
 *
 * 정책(중요):
 * - 1차(스크립트) 승인이 완료되면 scriptApprovedAt이 세팅되며,
 *   아이템은 "영상 생성/2차 준비"를 위해 status가 DRAFT로 유지/복귀될 수 있습니다.
 *   즉, "1차 승인 완료"는 status가 아니라 scriptApprovedAt(+파생 상태)로 표현됩니다.
 */
export type CreatorStatus =
  | "DRAFT"
  | "GENERATING"
  | "REVIEW_PENDING"
  | "REJECTED"
  | "APPROVED"
  | "FAILED";

export type PipelineStage = "UPLOAD" | "SCRIPT" | "VIDEO" | "THUMBNAIL" | "DONE";
export type PipelineState = "IDLE" | "RUNNING" | "SUCCESS" | "FAILED";

export interface DepartmentOption {
  id: string;
  name: string;
}

export type CategoryKind = "JOB" | "MANDATORY";

export interface CategoryOption {
  id: string;
  name: string;
  kind: CategoryKind;
}

export interface VideoTemplateOption {
  id: string;
  name: string;
  description?: string;
}

export interface JobTrainingOption {
  id: string;
  name: string;
}

export type CreatorTabId =
  | "draft"
  | "review_pending"
  | "rejected"
  | "approved"
  | "failed";

export type CreatorSortMode =
  | "updated_desc"
  | "updated_asc"
  | "created_desc"
  | "created_asc";

/**
 * sourceFiles[0]이 Primary(기본)
 * 기존 단일 필드(sourceFileName/Size/Mime)는 항상 sourceFiles[0]과 동기화
 */
export interface CreatorSourceFile {
  id: string;
  name: string;
  size: number;
  mime?: string;
  addedAt: number; // epoch ms
}

/**
 * 자동 생성 파이프라인 진행 상태(프론트 mock)
 */
export interface CreatorPipeline {
  state: PipelineState;
  stage: PipelineStage | null;
  progress: number; // 0~100
  startedAt?: number;
  finishedAt?: number;
  message?: string;
  mode: "FULL" | "VIDEO_ONLY" | "SCRIPT_ONLY";
}

export interface CreatorAssets {
  sourceFiles?: CreatorSourceFile[];

  sourceFileName?: string;
  sourceFileSize?: number; // bytes
  sourceFileMime?: string; // file.type

  script?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
}


export interface CreatorWorkItem {
  id: string;

  version: number; // v1, v2...
  versionHistory: CreatorVersionSnapshot[];

  title: string;
  categoryId: string;
  categoryLabel: string;

  /** 영상 생성 템플릿(배경/자막 스타일 등) */
  templateId: string;

  /** 직무교육인 경우 연결되는 직무교육 ID(Stub) */
  jobTrainingId?: string;

  /** 교육 대상 부서(직무교육이면 보통 1개, 전사/4대교육은 전체 가능) */
  targetDeptIds: string[];

  /** UI에서 “필수” 토글용 (직무교육도 필수/선택이 가능하다는 가정) */
  isMandatory: boolean;

  status: CreatorStatus;

  createdAt: number;
  updatedAt: number;

  createdByName: string;

  /** 반려 코멘트(반려 상태일 때) */
  rejectedComment?: string;

  /** 실패 사유(FAILED 상태일 때) */
  failedReason?: string;

  assets: CreatorAssets;
  pipeline: CreatorPipeline;

  /**
   * 1차(스크립트) 승인 시각
   * - 존재하면 "영상 생성 가능(2차 준비)" 단계로 진입했다고 해석
   * - UI 탭 분류는 status가 아니라 이 값(파생 상태)을 기준으로 수행 가능
   */
  scriptApprovedAt?: number;

  /** REVIEW_PENDING/REJECTED일 때 현재 단계(명시적 stage) */
  reviewStage?: ReviewStage;

  /** 반려가 1차인지 2차인지(명시적 stage) */
  rejectedStage?: ReviewStage;
}

export interface CreatorValidationResult {
  ok: boolean;
  issues: string[];
}

export interface CreatorVersionSnapshot {
  version: number;
  submittedAt: number; // 검토 요청 제출 시각
  note?: string;

  // 제출 당시 상태(보통 REVIEW_PENDING으로 기록)
  status: CreatorStatus;

  // 제출 당시 메타/자산 스냅샷
  title: string;
  categoryId: string;
  categoryLabel: string;
  templateId: string;
  jobTrainingId?: string;
  targetDeptIds: string[];
  assets: CreatorAssets;

  reviewStage?: ReviewStage;
  recordedAt?: number;
  reason?: string;
  sourceFileName?: string;
  isMandatory?: boolean;
  script?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface CreatorScriptScene {
  id: string;

  chapter_id?: string;
  chapter_title?: string;
  chapter_order?: number;

  scene_order: number;
  purpose: string;
  duration_sec: number;

  narration: string;
  caption: string;

  source_refs: string[];
  updated_at: string;
}

export type CreatorScriptScenePatchErrors = Partial<{
  narration: string;
  caption: string;
  duration_sec: string;
}>;