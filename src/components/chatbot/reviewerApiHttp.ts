// src/components/chatbot/reviewerApiHttp.ts
import type { ReviewWorkItem } from "./reviewerDeskTypes";
import type {
  AcquireLockResponse,
  ConflictPayload,
  DecisionRequest,
  DecisionResponse,
  ReleaseLockResponse,
  ReviewListParams,
  ReviewListResponse,
  ReviewStatsResponse,
  ReviewDetailResponse,
  ReviewHistoryResponse,
} from "./reviewerApiTypes";
import { ReviewerApiError, toReviewerApiError, type ReviewerApiErrorCode } from "./reviewerApiErrors";
import { getScript } from "./creatorApi";
import type { CreatorScriptDetail } from "./creatorStudioTypes";
// NOTE: /admin/videos/{videoId} API는 GET 메서드를 지원하지 않으므로 사용하지 않음
// 백엔드에 검토 상세 조회 응답에 fileUrl을 포함하도록 요청 필요

// 교육 서비스 API Base URL (백엔드 문서 기준: http://localhost:9002)
// Vite proxy를 통해 /api-edu → http://localhost:9002로 라우팅
const DEFAULT_BASE = "/api-edu";

function getEnvString(key: string): string | undefined {
  const env = import.meta.env as unknown as Record<string, unknown>;
  const v = env[key];
  return typeof v === "string" ? v : undefined;
}

function apiBase(): string {
  const v = getEnvString("VITE_EDU_API_BASE");
  return v && v.trim() ? v.trim() : DEFAULT_BASE;
}

async function readBodySafe(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    return text ? { message: text } : null;
  }
  return await res.json().catch(() => null);
}

function isConflictCode(x: unknown): x is ReviewerApiErrorCode {
  return x === "LOCK_CONFLICT" || x === "VERSION_CONFLICT" || x === "ALREADY_PROCESSED";
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    // 인증 헤더 추가
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    
    // keycloak 토큰 추가
    const keycloak = (await import("../../keycloak")).default;
    if (keycloak?.authenticated && keycloak.token) {
      try {
        await keycloak.updateToken(30);
      } catch {
        // 토큰 갱신 실패는 무시
      }
      if (keycloak.token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${keycloak.token}`);
      }
    }
    
    res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers,
    });
  } catch (err: unknown) {
    throw new ReviewerApiError("네트워크 오류로 요청에 실패했습니다.", {
      code: "NETWORK_ERROR",
      details: err,
    });
  }

  if (res.status === 204) return undefined as unknown as T;

  const body = await readBodySafe(res);

  if (!res.ok) {
    // 409는 body.code로 LOCK/VERSION/ALREADY를 분기하는 걸 권장
    if (res.status === 409) {
      const payload = (body ?? null) as ConflictPayload | null;
      const rawCode = typeof payload?.code === "string" ? payload.code : undefined;
      const code: ReviewerApiErrorCode = isConflictCode(rawCode) ? rawCode : "VERSION_CONFLICT";

      throw new ReviewerApiError(
        typeof payload?.message === "string" ? payload.message : "동시성 충돌이 발생했습니다.",
        {
          status: 409,
          code,
          details: payload ?? body,
        }
      );
    }

    throw toReviewerApiError({
      status: res.status,
      body,
      fallbackMessage: "요청 처리 중 오류가 발생했습니다.",
    });
  }

  return body as T;
}

/**
 * HTTP 기반 reviewer API
 * 백엔드 문서 기준: docs/education-service/video/api/video_api_spec.md
 * Base URL: /api-edu (Vite proxy를 통해 http://localhost:9002로 라우팅)
 */
export const reviewerApiHttp = {
  /**
   * 검토 목록 조회
   * GET /admin/videos/review-queue
   * 백엔드 문서: 4.1 검토 목록 조회
   */
  async listWorkItems(params: ReviewListParams): Promise<ReviewListResponse> {
    const qs = new URLSearchParams();
    
    // status: pending, approved, rejected
    // MY_ACTIVITY는 myProcessingOnly=true로 처리
    if (params.tab === "MY_ACTIVITY") {
      // 내 활동은 모든 상태에서 내가 처리한 항목만 조회
      qs.set("myProcessingOnly", "true");
      // status는 생략하거나 "pending"으로 설정 (백엔드에서 모든 상태 조회)
    } else {
      const status = params.tab === "REVIEW_PENDING" ? "pending" 
        : params.tab === "APPROVED" ? "approved"
        : params.tab === "REJECTED" ? "rejected"
        : "pending";
      qs.set("status", status);
    }
    
    // search: 제목/부서/제작자 검색
    if (params.q) qs.set("search", params.q);
    
    // myProcessingOnly: 내 처리만 필터 (MY_ACTIVITY가 아닌 경우에만)
    if (params.myProcessingOnly && params.tab !== "MY_ACTIVITY") {
      qs.set("myProcessingOnly", "true");
    }
    
    // reviewStage: first, second, document, all
    if (params.reviewStage) qs.set("reviewStage", params.reviewStage);
    
    // sort: latest, oldest, title
    if (params.sort) {
      const sortMap: Record<string, string> = {
        "NEWEST": "latest",
        "OLDEST": "oldest",
        "RISK_HIGH": "latest", // RISK_HIGH는 백엔드에서 지원하지 않으므로 latest로 매핑
      };
      qs.set("sort", sortMap[params.sort] || "latest");
    }
    
    // page, size: 페이징
    // page는 0 이상이어야 함 (0-base)
    const page = Math.max(0, params.page !== undefined ? params.page : 0);
    // size는 1 이상이어야 함
    const size = Math.max(1, params.size !== undefined ? params.size : (params.limit || 30));
    qs.set("page", String(page));
    qs.set("size", String(size));
    
    const response = await http<{
      items: Array<{
        videoId: string;
        educationId: string;
        educationTitle: string;
        videoTitle: string;
        status: string;
        reviewStage: string;
        creatorDepartment?: string;
        creatorName?: string;
        creatorUuid?: string;
        submittedAt: string;
        category?: string;
        eduType?: string;
        // 백엔드에서 제공할 수 있는 추가 필드 (optional)
        fileUrl?: string; // 영상 파일 URL (2차 검토 시 필요)
        duration?: number; // 영상 길이(초)
        scriptId?: string; // 스크립트 ID (1차 검토 시 필요)
        rejectedComment?: string; // 반려 사유
        rejectedStage?: "SCRIPT" | "VIDEO" | string; // 반려된 단계
      }>;
      totalCount: number;
      page: number;
      size: number;
      totalPages: number;
      firstRoundCount?: number;
      secondRoundCount?: number;
      documentCount?: number;
    }>(`/admin/videos/review-queue?${qs.toString()}`, { method: "GET" });
    
    // 백엔드 응답을 ReviewWorkItem 배열로 변환
    return {
      items: response.items.map(transformQueueItemToWorkItem),
      totalCount: response.totalCount,
      page: response.page,
      size: response.size,
      totalPages: response.totalPages,
      firstRoundCount: response.firstRoundCount,
      secondRoundCount: response.secondRoundCount,
      documentCount: response.documentCount,
    };
  },

  /**
   * 검토 통계 조회
   * GET /admin/videos/review-stats
   * 백엔드 문서: 4.2 검토 통계 조회
   */
  async getReviewStats(): Promise<ReviewStatsResponse> {
    return http<ReviewStatsResponse>(`/admin/videos/review-stats`, { method: "GET" });
  },

  /**
   * 검토 상세 정보 조회
   * GET /admin/videos/{videoId}/review-detail
   * 백엔드 문서: 4.4 검토 상세 정보 조회
   */
  async getWorkItem(id: string): Promise<ReviewWorkItem> {
    const detail = await http<ReviewDetailResponse>(`/admin/videos/${encodeURIComponent(id)}/review-detail`, { 
      method: "GET" 
    });
    
    // fileUrl은 검토 상세 조회 응답에서 가져옴
    // 백엔드에서 fileUrl을 제공하지 않으면 undefined로 유지
    // (백엔드 API가 fileUrl을 제공하도록 수정 필요)
    const fileUrl = detail.fileUrl;
    
    // scriptId가 없으면 lookup으로 조회 시도
    let scriptId = detail.scriptId;
    if (!scriptId && detail.educationId) {
      try {
        // 직접 lookup API 호출
        const SCRIPT_BASE = getEnvString("VITE_SCRIPT_API_BASE") || getEnvString("VITE_EDU_API_BASE");
        const base = SCRIPT_BASE && SCRIPT_BASE.trim() ? SCRIPT_BASE.trim() : apiBase();
        const lookupPath = `${base}/scripts/lookup?educationId=${encodeURIComponent(detail.educationId)}&videoId=${encodeURIComponent(id)}`;
        // apiBase()가 이미 포함되어 있으므로 상대 경로로 변환
        const relativePath = lookupPath.startsWith(apiBase()) 
          ? lookupPath.substring(apiBase().length)
          : `/scripts/lookup?educationId=${encodeURIComponent(detail.educationId)}&videoId=${encodeURIComponent(id)}`;
        const lookupRes = await http<{ scriptId?: string }>(relativePath, { method: "GET" });
        scriptId = lookupRes.scriptId;
      } catch (error) {
        // lookup 실패는 조용히 무시
        console.warn(`Failed to lookup scriptId for video ${id}:`, error);
      }
    }
    
    // scriptId가 있으면 스크립트를 조회하여 텍스트 추출
    let scriptText: string | undefined;
    if (scriptId) {
      try {
        const script = await getScript(scriptId);
        scriptText = extractScriptText(script);
      } catch (error) {
        // 스크립트 조회 실패 시 로그만 남기고 계속 진행
        console.warn(`Failed to fetch script ${scriptId}:`, error);
      }
    }
    
    // ReviewDetailResponse를 ReviewWorkItem 형식으로 변환 (scriptId, fileUrl 포함)
    const detailWithFileUrl = fileUrl ? { ...detail, fileUrl } : detail;
    const detailWithScriptId = scriptId ? { ...detailWithFileUrl, scriptId } : detailWithFileUrl;
    return transformDetailToWorkItem(detailWithScriptId, scriptText);
  },

  /**
   * 감사 이력 조회
   * GET /admin/videos/{videoId}/review-history
   * 백엔드 문서: 4.3 영상 감사 이력 조회
   */
  async getReviewHistory(videoId: string): Promise<ReviewHistoryResponse> {
    return http<ReviewHistoryResponse>(`/admin/videos/${encodeURIComponent(videoId)}/review-history`, { 
      method: "GET" 
    });
  },

  /**
   * 영상 승인
   * PUT /admin/videos/{videoId}/approve
   * 백엔드 문서: 1.7 검토 승인
   * - 1차 승인: SCRIPT_REVIEW_REQUESTED → SCRIPT_APPROVED
   * - 2차 승인: FINAL_REVIEW_REQUESTED → PUBLISHED
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async approve(id: string, _req: DecisionRequest): Promise<DecisionResponse> {
    // 백엔드 API는 body가 없음 (PUT 메서드만 사용)
    await http<{
      videoId: string;
      previousStatus: string;
      currentStatus: string;
      updatedAt: string;
    }>(`/admin/videos/${encodeURIComponent(id)}/approve`, {
      method: "PUT",
    });
    
    // 응답을 DecisionResponse 형식으로 변환
    return {
      item: await this.getWorkItem(id),
    };
  },

  /**
   * 영상 반려
   * PUT /admin/videos/{videoId}/reject
   * 백엔드 문서: 1.8 검토 반려
   * - 1차 반려: SCRIPT_REVIEW_REQUESTED → SCRIPT_READY
   * - 2차 반려: FINAL_REVIEW_REQUESTED → READY
   */
  async reject(id: string, req: DecisionRequest): Promise<DecisionResponse> {
    // 백엔드 API는 reason만 body로 전송
    await http<{
      videoId: string;
      previousStatus: string;
      currentStatus: string;
      updatedAt: string;
    }>(`/admin/videos/${encodeURIComponent(id)}/reject`, {
      method: "PUT",
      body: JSON.stringify({ reason: req.reason || "" }),
    });
    
    // 응답을 DecisionResponse 형식으로 변환
    return {
      item: await this.getWorkItem(id),
    };
  },

  /**
   * Lock 관련 메서드 (백엔드에서 지원하지 않으므로 빈 구현)
   * 호환성을 위해 유지
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async acquireLock(_id: string): Promise<AcquireLockResponse> {
    // 백엔드 API에는 lock 기능이 없으므로 빈 구현
    return {
      lockToken: "",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      ownerId: "",
      ownerName: "",
    };
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async releaseLock(_id: string, _lockToken: string): Promise<ReleaseLockResponse> {
    // 백엔드 API에는 lock 기능이 없으므로 빈 구현
    return { released: true };
  },
};

/**
 * 백엔드 응답의 review-queue items를 ReviewWorkItem 형식으로 변환
 */
function transformQueueItemToWorkItem(item: {
  videoId: string;
  educationId: string;
  educationTitle: string;
  videoTitle: string;
  status: string;
  reviewStage: string;
  creatorDepartment?: string;
  creatorName?: string;
  creatorUuid?: string;
  submittedAt: string;
  category?: string;
  eduType?: string;
  fileUrl?: string; // 영상 파일 URL (2차 검토 시 필요)
  duration?: number; // 영상 길이(초)
  scriptId?: string; // 스크립트 ID (1차 검토 시 필요)
}): ReviewWorkItem {
  // reviewStage가 "2차"/"FINAL"이거나 FINAL_REVIEW_REQUESTED/PUBLISHED 상태이거나 fileUrl이 있으면 2차 검토 단계
  const isSecondStage = 
    item.reviewStage === "2차" || 
    item.reviewStage === "FINAL" ||
    item.status === "FINAL_REVIEW_REQUESTED" ||
    item.status === "PUBLISHED" || // 2차 승인 후 PUBLISHED 상태도 2차 단계로 간주
    (item.fileUrl && item.fileUrl.trim().length > 0);
  
  const workItem: ReviewWorkItem = {
    id: item.videoId,
    contentId: item.videoId,
    title: item.videoTitle,
    department: item.creatorDepartment || "",
    creatorName: item.creatorName || "",
    creatorId: item.creatorUuid,
    contentType: "VIDEO",
    contentCategory: item.eduType === "MANDATORY" ? "MANDATORY" : "JOB",
    createdAt: item.submittedAt,
    submittedAt: item.submittedAt,
    lastUpdatedAt: item.submittedAt,
    status: (() => {
      // reviewStage가 "1차 반려" 또는 "2차 반려"로 나오면 반려 상태
      if (item.reviewStage === "1차 반려" || item.reviewStage === "2차 반려") {
        return "REJECTED";
      }
      
      // rejectedComment나 rejectedStage 필드가 있으면 반려 상태
      const rejectedComment = (item as { rejectedComment?: string }).rejectedComment;
      const rejectedStage = (item as { rejectedStage?: string }).rejectedStage;
      if ((rejectedComment && rejectedComment.trim().length > 0) || rejectedStage) {
        return "REJECTED";
      }
      
      // 검토 요청 상태
      if (item.status === "SCRIPT_REVIEW_REQUESTED" || item.status === "FINAL_REVIEW_REQUESTED") {
        return "REVIEW_PENDING";
      }
      
      // 승인/공개 상태
      if (item.status === "PUBLISHED") {
        return "APPROVED";
      }
      
      // 기본값: 반려 상태로 간주
      return "REJECTED";
    })(),
    // reviewStage 우선 확인, 없으면 상태로 판단
    // PUBLISHED 상태는 2차 승인 완료 상태이므로 FINAL로 설정
    reviewStage: item.reviewStage === "1차" || item.reviewStage === "SCRIPT" 
      ? "SCRIPT" 
      : item.reviewStage === "2차" || item.reviewStage === "FINAL"
      ? "FINAL"
      : item.reviewStage === "1차 반려"
      ? "SCRIPT" // 1차 반려는 SCRIPT 단계
      : item.reviewStage === "2차 반려"
      ? "FINAL" // 2차 반려는 FINAL 단계
      : item.status === "PUBLISHED"
      ? "FINAL" // 2차 승인 완료 상태
      : item.status === "FINAL_REVIEW_REQUESTED"
      ? "FINAL"
      : item.status === "SCRIPT_REVIEW_REQUESTED"
      ? "SCRIPT"
      : isSecondStage 
      ? "FINAL" 
      : undefined,
    // 2차 검토 단계인 경우 videoUrl 설정
    // reviewStage가 FINAL이거나 FINAL_REVIEW_REQUESTED 상태이면 fileUrl이 있으면 videoUrl에 설정
    // 또는 isSecondStage가 true이고 fileUrl이 있으면 videoUrl에 설정
    // reviewStage가 FINAL로 설정되었거나 isSecondStage가 true이면 fileUrl이 있으면 videoUrl에 설정
    videoUrl: (() => {
      const finalReviewStage = item.reviewStage === "1차" || item.reviewStage === "SCRIPT" 
        ? "SCRIPT" 
        : item.reviewStage === "2차" || item.reviewStage === "FINAL"
        ? "FINAL"
        : item.status === "FINAL_REVIEW_REQUESTED"
        ? "FINAL"
        : item.status === "SCRIPT_REVIEW_REQUESTED"
        ? "SCRIPT"
        : isSecondStage 
        ? "FINAL" 
        : undefined;
      
      // 2차 검토 단계이고 fileUrl이 있으면 videoUrl에 설정
      if (finalReviewStage === "FINAL" && item.fileUrl && item.fileUrl.trim().length > 0) {
        return item.fileUrl;
      }
      // isSecondStage가 true이고 fileUrl이 있으면 videoUrl에 설정
      if (isSecondStage && item.fileUrl && item.fileUrl.trim().length > 0) {
        return item.fileUrl;
      }
      return undefined;
    })(),
    durationSec: item.duration,
    autoCheck: {
      piiRiskLevel: "none",
      piiFindings: [],
      bannedWords: [],
      qualityWarnings: [],
    },
    audit: [],
    version: 1,
    rejectedComment: (item as { rejectedComment?: string }).rejectedComment,
    rejectedStage: (item as { rejectedStage?: string }).rejectedStage as ReviewWorkItem["rejectedStage"],
  } as ReviewWorkItem;
  
  // scriptId가 있으면 메타에 저장 (getWorkItem에서 사용)
  if (item.scriptId) {
    (workItem as unknown as Record<string, unknown>)["scriptId"] = item.scriptId;
  }
  
  return workItem;
}

/**
 * 스크립트 상세 정보에서 텍스트를 추출
 * chapters → scenes → narration 또는 caption을 합쳐서 반환
 */
function extractScriptText(script: CreatorScriptDetail): string {
  const parts: string[] = [];
  
  for (const chapter of script.chapters || []) {
    for (const scene of chapter.scenes || []) {
      // narration이 있으면 우선 사용, 없으면 caption 사용
      const text = scene.narration || scene.caption || "";
      if (text.trim()) {
        parts.push(text.trim());
      }
    }
  }
  
  return parts.join("\n\n");
}

/**
 * ReviewDetailResponse를 ReviewWorkItem 형식으로 변환
 */
function transformDetailToWorkItem(detail: ReviewDetailResponse, scriptText?: string): ReviewWorkItem {
  // reviewStage가 "2차"/"FINAL"이거나 FINAL_REVIEW_REQUESTED/PUBLISHED 상태이거나 fileUrl이 있으면 2차 검토 단계
  const isSecondStage = 
    detail.reviewStage === "2차" || 
    detail.reviewStage === "FINAL" ||
    detail.status === "FINAL_REVIEW_REQUESTED" ||
    detail.status === "PUBLISHED" || // 2차 승인 후 PUBLISHED 상태도 2차 단계로 간주
    (detail.fileUrl && detail.fileUrl.trim().length > 0);
  
  const workItem: ReviewWorkItem = {
    id: detail.videoId,
    contentId: detail.videoId,
    title: detail.videoTitle,
    department: detail.creatorDepartment || "",
    creatorName: detail.creatorName || "",
    creatorId: detail.creatorUuid,
    contentType: "VIDEO",
    contentCategory: detail.eduType === "MANDATORY" ? "MANDATORY" : "JOB",
    createdAt: detail.submittedAt,
    submittedAt: detail.submittedAt,
    lastUpdatedAt: detail.updatedAt,
    status: (() => {
      // reviewStage가 "1차 반려" 또는 "2차 반려"로 나오면 반려 상태
      if (detail.reviewStage === "1차 반려" || detail.reviewStage === "2차 반려") {
        return "REJECTED";
      }
      
      // rejectedComment나 rejectedStage 필드가 있으면 반려 상태
      const rejectedComment = (detail as { rejectedComment?: string }).rejectedComment;
      const rejectedStage = (detail as { rejectedStage?: string }).rejectedStage;
      if ((rejectedComment && rejectedComment.trim().length > 0) || rejectedStage) {
        return "REJECTED";
      }
      
      // 검토 요청 상태
      if (detail.status === "SCRIPT_REVIEW_REQUESTED" || detail.status === "FINAL_REVIEW_REQUESTED") {
        return "REVIEW_PENDING";
      }
      
      // 승인/공개 상태
      if (detail.status === "PUBLISHED") {
        return "APPROVED";
      }
      
      // 기본값: 반려 상태로 간주
      return "REJECTED";
    })(),
    // reviewStage 우선 확인, 없으면 상태로 판단
    // PUBLISHED 상태는 2차 승인 완료 상태이므로 FINAL로 설정
    reviewStage: detail.reviewStage === "1차" || detail.reviewStage === "SCRIPT"
      ? "SCRIPT"
      : detail.reviewStage === "2차" || detail.reviewStage === "FINAL"
      ? "FINAL"
      : detail.reviewStage === "1차 반려"
      ? "SCRIPT" // 1차 반려는 SCRIPT 단계
      : detail.reviewStage === "2차 반려"
      ? "FINAL" // 2차 반려는 FINAL 단계
      : detail.status === "PUBLISHED"
      ? "FINAL" // 2차 승인 완료 상태
      : detail.status === "FINAL_REVIEW_REQUESTED"
      ? "FINAL"
      : detail.status === "SCRIPT_REVIEW_REQUESTED"
      ? "SCRIPT"
      : isSecondStage
      ? "FINAL"
      : undefined,
    // 2차 검토 단계인 경우 videoUrl 설정
    // reviewStage가 FINAL이거나 FINAL_REVIEW_REQUESTED 상태이면 fileUrl이 있으면 videoUrl에 설정
    // 또는 isSecondStage가 true이고 fileUrl이 있으면 videoUrl에 설정
    // reviewStage가 FINAL로 설정되었거나 isSecondStage가 true이면 fileUrl이 있으면 videoUrl에 설정
    videoUrl: (() => {
      const finalReviewStage = detail.reviewStage === "1차" || detail.reviewStage === "SCRIPT"
        ? "SCRIPT"
        : detail.reviewStage === "2차" || detail.reviewStage === "FINAL"
        ? "FINAL"
        : detail.status === "FINAL_REVIEW_REQUESTED"
        ? "FINAL"
        : detail.status === "SCRIPT_REVIEW_REQUESTED"
        ? "SCRIPT"
        : isSecondStage
        ? "FINAL"
        : undefined;
      
      // 2차 검토 단계이고 fileUrl이 있으면 videoUrl에 설정
      if (finalReviewStage === "FINAL" && detail.fileUrl && detail.fileUrl.trim().length > 0) {
        return detail.fileUrl;
      }
      // isSecondStage가 true이고 fileUrl이 있으면 videoUrl에 설정
      if (isSecondStage && detail.fileUrl && detail.fileUrl.trim().length > 0) {
        return detail.fileUrl;
      }
      return undefined;
    })(),
    durationSec: detail.duration,
    scriptText,
    autoCheck: {
      piiRiskLevel: "none",
      piiFindings: [],
      bannedWords: [],
      qualityWarnings: [],
    },
    audit: [],
    version: detail.scriptVersion || 1,
    rejectedComment: (detail as { rejectedComment?: string }).rejectedComment,
    rejectedStage: (detail as { rejectedStage?: string }).rejectedStage as ReviewWorkItem["rejectedStage"],
  } as ReviewWorkItem;
  
  // scriptId가 있으면 메타에 저장 (ReviewerDetail에서 사용)
  if (detail.scriptId) {
    (workItem as unknown as Record<string, unknown>)["scriptId"] = detail.scriptId;
  }
  
  return workItem;
}
