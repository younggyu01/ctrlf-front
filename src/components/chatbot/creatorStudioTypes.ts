// src/components/chatbot/creatorStudioTypes.ts

export type CreatorType = "DEPT_CREATOR" | "GLOBAL_CREATOR";

export type ReviewStage = "SCRIPT" | "FINAL";

/**
 * CreatorRawStatus는 "서버 Raw 상태(문자열)"를 의미합니다.
 * - UI에서 직접 사용하지 말고, 디버깅/가드/파생 상태 계산에만 사용하세요.
 *
 * 설계안 기준(대표):
 * DRAFT → SCRIPT_GENERATING → SCRIPT_READY → SCRIPT_REVIEW_REQUESTED
 * → (SCRIPT_REVIEW_REJECTED | SCRIPT_APPROVED)
 * → VIDEO_GENERATING → READY → FINAL_REVIEW_REQUESTED
 * → (FINAL_REVIEW_REJECTED | PUBLISHED)
 */
export type CreatorRawStatus =
  | "DRAFT"
  | "SCRIPT_GENERATING"
  | "SCRIPT_READY"
  | "SCRIPT_REVIEW_REQUESTED"
  | "SCRIPT_REVIEW_REJECTED"
  | "SCRIPT_APPROVED"
  | "VIDEO_GENERATING"
  | "READY"
  | "FINAL_REVIEW_REQUESTED"
  | "FINAL_REVIEW_REJECTED"
  | "PUBLISHED"
  | "DISABLED"
  | "FAILED"
  // 구/대체 명칭 호환(백엔드 구현 편차 흡수)
  | "PROCESSING";

/**
 * UI에서 사용하는 "정규화된 상태"
 * - 설계안 원칙: 버튼 enable/disable은 VideoStatus(raw) 중심이되,
 *   UI 탭/필터/정렬은 아래 CreatorStatus로 통일해서 사용 가능.
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
 * 기존 단일 필드(sourceFileName/Size/Mime)는 항상 sourceFiles[0]과 동기화하는 것을 권장
 */
export interface CreatorSourceFile {
  id: string;
  name: string;
  size: number;
  mime?: string;
  addedAt: number; // epoch ms
}

/**
 * 자동 생성 파이프라인 진행 상태(프론트/서버 혼합)
 */
export interface CreatorPipeline {
  state: PipelineState;

  /**
   * UI에서 사용하는 고정 단계 enum
   * - 서버 status 문자열을 직접 넣지 않음
   */
  stage: PipelineStage | null;

  progress: number; // 0~100
  startedAt?: number;
  finishedAt?: number;
  message?: string;

  mode: "FULL" | "VIDEO_ONLY" | "SCRIPT_ONLY";

  /**
   * 서버/잡/원본 상태 문자열(디버깅/표시용)
   * - 예: SCRIPT_GENERATING, VIDEO_GENERATING, JOB:xxxx, SCRIPT_READY ...
   */
  rawStage?: string;
}

export interface CreatorAssets {
  sourceFiles?: CreatorSourceFile[];

  sourceFileName?: string;
  sourceFileUrl?: string;
  sourceFileMime?: string; // file.type (호환성 유지용, 백엔드에서는 제공하지 않을 수 있음)

  /** Creator Studio에서 사용 중인 "평문 스크립트(요약/미리보기용)" */
  script?: string;

  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface CreatorWorkItem {
  /**
   * education-service videoId
   * (현재 코드에서는 id를 videoId로 사용하고 있으므로 그대로 둡니다)
   */
  id: string;

  /**
   * education-service educationId
   * - scripts lookup / 저장 / 검토요청 등에 필요
   */
  educationId: string;

  /**
   * scripts lookup 결과로 확정되는 scriptId
   * - 없으면 lookup 필요
   */
  scriptId?: string;

  /**
   * video jobId (폴링/상태확인에 사용)
   */
  jobId?: string;

  /**
   * 서버 raw status 문자열 (디버깅/가드/UI 표시용)
   * - 예: SCRIPT_GENERATING, SCRIPT_READY ...
   */
  videoStatusRaw?: CreatorRawStatus | string;

  version: number; // v1, v2...
  versionHistory: CreatorVersionSnapshot[];

  title: string;
  categoryId: string;
  categoryLabel: string;

  templateId: string;
  jobTrainingId?: string;

  targetDeptIds: string[];
  isMandatory: boolean;

  status: CreatorStatus;
  createdAt: number;
  updatedAt: number;

  createdByName: string;
  rejectedComment?: string;
  failedReason?: string;

  assets: CreatorAssets;
  pipeline: CreatorPipeline;

  /**
   * 정책(중요):
   * - 1차(스크립트) 승인이 완료되면 scriptApprovedAt이 세팅되며,
   *   아이템은 "영상 생성/2차 준비"를 위해 status가 DRAFT로 유지/복귀될 수 있습니다.
   *   즉, "1차 승인 완료"는 status가 아니라 scriptApprovedAt(+파생 상태)로 표현됩니다.
   */
  scriptApprovedAt?: number;
  reviewStage?: ReviewStage;
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

/**
 * ===== Script API (education-service) 타입 =====
 * - GET /scripts/{scriptId} 응답 스키마 기준
 * - PUT /scripts/{scriptId} 요청은 "chapters 전체 교체" 방식으로 사용 (설계안)
 */
export interface CreatorScriptDetail {
  scriptId: string;
  educationId?: string | null;
  videoId?: string | null;

  title: string;
  totalDurationSec: number;

  version?: number;
  llmModel?: string;

  /** GET 응답은 json object일 수 있음(스펙). PUT 요청용으로는 내부에서 문자열/객체로 정규화 가능 */
  rawPayload?: unknown;

  chapters: CreatorScriptChapter[];
}

export interface CreatorScriptChapter {
  chapterId: string;
  index: number;
  title: string;
  durationSec: number;
  scenes: CreatorScriptScene[];
}

/**
 * Scene: GET /scripts/{scriptId} 응답의 scene 스키마 기준
 * - chapter 매핑 정보는 UI 편의를 위해 "derived"로 추가(서버 필드 아님)
 */
export interface CreatorScriptScene {
  sceneId: string;
  index: number;

  purpose: string;
  narration: string;
  caption: string;
  visual?: string;

  durationSec: number;

  sourceChunkIndexes: number[];
  confidenceScore?: number | null;

  /** derived (UI grouping) */
  chapterId?: string;
  chapterTitle?: string;
  chapterIndex?: number;
}

/**
 * PUT /scripts/{scriptId} 요청 바디(설계안)
 * - 1) chapters 전체 교체
 * - 2) 또는 script(rawPayload) 문자열/JSON을 그대로 올리는 구현 편차도 흡수
 */
export type CreatorPutScriptPayload =
  | Readonly<{
      chapters: CreatorScriptChapter[];
      title?: string;
      totalDurationSec?: number;
      rawPayload?: unknown;
    }>
  | Readonly<{
      script: string;
      rawPayload?: unknown;
    }>;

/**
 * SourceSet API 타입(설계안)
 */
export type CreatorSourceSetCreatePayload = Readonly<{
  title: string;
  domain?: string;
  documentIds: string[];
  educationId: string;
  videoId: string;
}>;

export type CreatorSourceSetPatchPayload = Readonly<{
  addDocumentIds?: string[];
  removeDocumentIds?: string[];
}>;

/**
 * 저장/검증 에러(서버 구현 편차 흡수)
 */
export type CreatorScriptScenePatchErrors = Partial<{
  narration: string;
  caption: string;
  durationSec: string;
}>;

/**
 * (선택) raw → ui 상태 파생 헬퍼
 * - 컨트롤러에서 이미 파생하고 있다면 사용하지 않아도 됩니다.
 */
export function deriveCreatorStatus(input: {
  raw?: CreatorRawStatus | string | null | undefined;
}): CreatorStatus {
  const raw = String(input.raw ?? "").trim();

  if (!raw) return "DRAFT";
  if (raw === "FAILED") return "FAILED";
  if (raw === "DISABLED") return "FAILED";

  if (raw === "SCRIPT_GENERATING") return "GENERATING";
  if (raw === "VIDEO_GENERATING" || raw === "PROCESSING") return "GENERATING";

  if (raw === "SCRIPT_REVIEW_REQUESTED" || raw === "FINAL_REVIEW_REQUESTED") return "REVIEW_PENDING";
  if (raw === "SCRIPT_REVIEW_REJECTED" || raw === "FINAL_REVIEW_REJECTED") return "REJECTED";

  if (raw === "PUBLISHED") return "APPROVED";

  // SCRIPT_READY / SCRIPT_APPROVED / READY / DRAFT 등은 "작업 가능"으로 DRAFT 취급
  return "DRAFT";
}

// 패치2: Creator Studio에서 교육(education) 선택 모달을 위한 'with-videos' 응답 타입
export type CreatorEducationVideoSummary = Readonly<{
  id: string;
  title: string;
  status?: string | null;
  updatedAt?: string | null;
}>;

export type CreatorEducationWithVideosItem = Readonly<{
  id: string;
  title: string;
  startAt?: string | null;
  endAt?: string | null;
  departmentScope?: string[];
  required?: boolean | null;
  eduType?: string | null;
  passScore?: number | null;
  passRatio?: number | null;
  categoryId?: string | null;
  jobTrainingId?: string | null;
  templateId?: string | null;
  videos: CreatorEducationVideoSummary[];
}>;
