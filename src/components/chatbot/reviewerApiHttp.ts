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
import { listPolicies, getPolicyVersion, approveReview, rejectReview, type VersionDetail } from "../dashboard/api/ragApi";
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
   * VIDEO와 POLICY_DOC를 모두 조회하여 병합
   * - VIDEO: GET /admin/videos/review-queue
   * - POLICY_DOC: GET /rag/documents/policies
   */
  async listWorkItems(params: ReviewListParams): Promise<ReviewListResponse> {
    // VIDEO 목록 조회
    const videoQs = new URLSearchParams();
    
    // status: pending, approved, rejected
    // MY_ACTIVITY는 myProcessingOnly=true로 처리
    if (params.tab === "MY_ACTIVITY") {
      // 내 활동은 모든 상태에서 내가 처리한 항목만 조회
      videoQs.set("myProcessingOnly", "true");
      // status는 생략하거나 "pending"으로 설정 (백엔드에서 모든 상태 조회)
    } else {
      const status = params.tab === "REVIEW_PENDING" ? "pending" 
        : params.tab === "APPROVED" ? "approved"
        : params.tab === "REJECTED" ? "rejected"
        : "pending";
      videoQs.set("status", status);
    }
    
    // search: 제목/부서/제작자 검색
    if (params.q) videoQs.set("search", params.q);
    
    // myProcessingOnly: 내 처리만 필터 (MY_ACTIVITY가 아닌 경우에만)
    if (params.myProcessingOnly && params.tab !== "MY_ACTIVITY") {
      videoQs.set("myProcessingOnly", "true");
    }
    
    // reviewStage: first, second, document, all
    // document 필터가 있으면 VIDEO는 제외하고 POLICY_DOC만 조회
    const includeVideos = !params.reviewStage || params.reviewStage === "all" || params.reviewStage === "first" || params.reviewStage === "second";
    if (params.reviewStage && includeVideos) {
      videoQs.set("reviewStage", params.reviewStage);
    }
    
    // sort: latest, oldest, title
    if (params.sort) {
      const sortMap: Record<string, string> = {
        "NEWEST": "latest",
        "OLDEST": "oldest",
        "RISK_HIGH": "latest", // RISK_HIGH는 백엔드에서 지원하지 않으므로 latest로 매핑
      };
      videoQs.set("sort", sortMap[params.sort] || "latest");
    }
    
    // page, size: 페이징
    // page는 0 이상이어야 함 (0-base)
    const page = Math.max(0, params.page !== undefined ? params.page : 0);
    // size는 1 이상이어야 함
    const size = Math.max(1, params.size !== undefined ? params.size : (params.limit || 30));
    videoQs.set("page", String(page));
    videoQs.set("size", String(size));
    
    // VIDEO와 POLICY_DOC를 병렬로 조회
    const [videoResponse, policyResponse] = await Promise.all([
      // VIDEO 목록 조회
      includeVideos ? http<{
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
          fileUrl?: string;
          duration?: number;
          scriptId?: string;
          rejectedComment?: string;
          rejectedStage?: "SCRIPT" | "VIDEO" | string;
        }>;
        totalCount: number;
        page: number;
        size: number;
        totalPages: number;
        firstRoundCount?: number;
        secondRoundCount?: number;
        documentCount?: number;
      }>(`/admin/videos/review-queue?${videoQs.toString()}`, { method: "GET" }).catch(() => ({
        items: [],
        totalCount: 0,
        page: 0,
        size: 0,
        totalPages: 0,
        firstRoundCount: 0,
        secondRoundCount: 0,
        documentCount: 0,
      })) : Promise.resolve({
        items: [],
        totalCount: 0,
        page: 0,
        size: 0,
        totalPages: 0,
        firstRoundCount: 0,
        secondRoundCount: 0,
        documentCount: 0,
      }),
      // POLICY_DOC 목록 조회
      (() => {
        // document 필터가 있거나 all이면 POLICY_DOC 조회
        const includePolicies = !params.reviewStage || params.reviewStage === "all" || params.reviewStage === "document";
        if (!includePolicies) {
          return Promise.resolve({ items: [], total: 0, page: 0, size: 0 });
        }
        
        // 상태 매핑: REVIEW_PENDING -> PENDING, APPROVED -> ACTIVE, REJECTED -> REJECTED
        let policyStatus: string | undefined;
        if (params.tab === "REVIEW_PENDING") {
          policyStatus = "PENDING";
        } else if (params.tab === "APPROVED") {
          policyStatus = "ACTIVE";
        } else if (params.tab === "REJECTED") {
          policyStatus = "REJECTED";
        } else if (params.tab === "MY_ACTIVITY") {
          // MY_ACTIVITY는 모든 상태 조회 (필터링은 백엔드에서 처리)
          policyStatus = undefined;
        }
        
        return listPolicies({
          search: params.q,
          status: policyStatus,
          page,
          size,
        }).catch(() => ({ items: [], total: 0, page: 0, size: 0 }));
      })(),
    ]);
    
    // VIDEO 항목 변환
    const videoItems = videoResponse.items.map(transformQueueItemToWorkItem);
    
    // POLICY_DOC 항목 변환
    const policyItems: ReviewWorkItem[] = [];
    for (const policyItem of policyResponse.items) {
      // PENDING 상태인 버전만 검토 대상
      const pendingVersion = policyItem.versions.find(v => {
        if (params.tab === "REVIEW_PENDING") return v.status === "PENDING";
        if (params.tab === "APPROVED") return v.status === "ACTIVE";
        if (params.tab === "REJECTED") return v.status === "REJECTED";
        return true; // MY_ACTIVITY는 모든 상태
      });
      
      if (pendingVersion) {
        // 버전 상세 정보 조회
        try {
          const versionDetail = await getPolicyVersion(policyItem.documentId, pendingVersion.version);
          const workItem = await transformPolicyVersionToWorkItem(versionDetail, policyItem.title);
          policyItems.push(workItem);
        } catch (error) {
          // 조회 실패 시 로그만 남기고 계속 진행
          console.warn(`Failed to fetch policy version ${policyItem.documentId} v${pendingVersion.version}:`, error);
        }
      }
    }
    
    // 두 목록 병합 및 정렬
    const allItems = [...videoItems, ...policyItems];
    
    // 정렬 적용
    if (params.sort === "NEWEST") {
      allItems.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    } else if (params.sort === "OLDEST") {
      allItems.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
    } else if (params.sort === "RISK_HIGH") {
      allItems.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
    }
    
    // 페이징 적용 (병합 후)
    const start = page * size;
    const end = start + size;
    const paginatedItems = allItems.slice(start, end);
    
    return {
      items: paginatedItems,
      totalCount: allItems.length,
      page,
      size,
      totalPages: Math.ceil(allItems.length / size),
      firstRoundCount: videoResponse.firstRoundCount || 0,
      secondRoundCount: videoResponse.secondRoundCount || 0,
      documentCount: policyItems.length,
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
   * VIDEO와 POLICY_DOC 모두 지원
   * - VIDEO: GET /admin/videos/{videoId}/review-detail
   * - POLICY_DOC: GET /rag/documents/policies/{documentId}/versions/{version}
   */
  async getWorkItem(id: string): Promise<ReviewWorkItem> {
    // id 형식 판단:
    // 1. UUID 형식 (36자, 하이픈 포함) -> VIDEO
    // 2. REVIEW-{documentId}-v{version} 형식 -> POLICY_DOC
    // 3. {documentId}-v{version} 형식 -> POLICY_DOC
    // 4. 그 외 -> 먼저 VIDEO 시도, 실패하면 POLICY_DOC로 폴백
    
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const isReviewItemId = /^REVIEW-(.+?)-v(\d+)$/i.test(id);
    const isDocumentVersion = /^([A-Z0-9-]+)-v?(\d+)$/i.test(id) && !isReviewItemId;
    
    // POLICY_DOC인 경우 직접 처리
    if (isReviewItemId || isDocumentVersion) {
      let documentId: string | undefined;
      let version: number | undefined;
      
      if (isReviewItemId) {
        // REVIEW-POL-0004-v1 형식에서 documentId와 version 추출
        const match = /^REVIEW-(.+?)-v(\d+)$/i.exec(id);
        if (match) {
          documentId = match[1];
          version = parseInt(match[2], 10);
        }
      } else if (isDocumentVersion) {
        // POL-0004-v1 형식에서 documentId와 version 추출
        const match = /^([A-Z0-9-]+)-v?(\d+)$/i.exec(id);
        if (match) {
          documentId = match[1];
          version = parseInt(match[2], 10);
        }
      }
      
      if (documentId && version) {
        try {
          const versionDetail = await getPolicyVersion(documentId, version);
          return await transformPolicyVersionToWorkItem(versionDetail, versionDetail.title);
        } catch (error) {
          throw new ReviewerApiError("사규 문서를 찾을 수 없습니다.", {
            code: "NOT_FOUND",
            status: 404,
            details: error,
          });
        }
      }
    }
    
    // UUID 형식이거나 형식을 알 수 없는 경우 VIDEO로 시도
    if (isUuid || (!isReviewItemId && !isDocumentVersion)) {
      try {
        // VIDEO 상세 조회 시도
        const detail = await http<ReviewDetailResponse>(`/admin/videos/${encodeURIComponent(id)}/review-detail`, { 
          method: "GET" 
        });
        
        // fileUrl은 검토 상세 조회 응답에서 가져옴
        const fileUrl = detail.fileUrl;
        
        // scriptId가 없으면 lookup으로 조회 시도
        let scriptId = detail.scriptId;
        if (!scriptId && detail.educationId) {
          try {
            const SCRIPT_BASE = getEnvString("VITE_SCRIPT_API_BASE") || getEnvString("VITE_EDU_API_BASE");
            const base = SCRIPT_BASE && SCRIPT_BASE.trim() ? SCRIPT_BASE.trim() : apiBase();
            const lookupPath = `${base}/scripts/lookup?educationId=${encodeURIComponent(detail.educationId)}&videoId=${encodeURIComponent(id)}`;
            const relativePath = lookupPath.startsWith(apiBase()) 
              ? lookupPath.substring(apiBase().length)
              : `/scripts/lookup?educationId=${encodeURIComponent(detail.educationId)}&videoId=${encodeURIComponent(id)}`;
            const lookupRes = await http<{ scriptId?: string }>(relativePath, { method: "GET" });
            scriptId = lookupRes.scriptId;
          } catch (error) {
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
            console.warn(`Failed to fetch script ${scriptId}:`, error);
          }
        }
        
        const detailWithFileUrl = fileUrl ? { ...detail, fileUrl } : detail;
        const detailWithScriptId = scriptId ? { ...detailWithFileUrl, scriptId } : detailWithFileUrl;
        return transformDetailToWorkItem(detailWithScriptId, scriptText);
      } catch (videoError) {
        // VIDEO 조회 실패 시, reviewItemId로 POLICY_DOC 찾기 시도
        // (이미 위에서 처리했지만, 혹시 모를 경우를 대비)
        try {
          const policies = await listPolicies({ status: "PENDING" });
          for (const policy of policies.items) {
            const pendingVersion = policy.versions.find(v => v.status === "PENDING");
            if (pendingVersion) {
              try {
                const versionDetail = await getPolicyVersion(policy.documentId, pendingVersion.version);
                // reviewItemId가 일치하는지 확인
                if (versionDetail.reviewItemId === id) {
                  return await transformPolicyVersionToWorkItem(versionDetail, versionDetail.title);
                }
              } catch {
                // 무시하고 계속
              }
            }
          }
          
          throw new ReviewerApiError("검토 항목을 찾을 수 없습니다.", {
            code: "NOT_FOUND",
            status: 404,
            details: { videoError },
          });
        } catch (policyError) {
          throw new ReviewerApiError("검토 항목을 찾을 수 없습니다.", {
            code: "NOT_FOUND",
            status: 404,
            details: { videoError, policyError },
          });
        }
      }
    }
    
    // 여기까지 오면 안 됨
    throw new ReviewerApiError("검토 항목을 찾을 수 없습니다.", {
      code: "NOT_FOUND",
      status: 404,
    });
  },

  /**
   * 감사 이력 조회
   * VIDEO와 POLICY_DOC 모두 지원
   * - VIDEO: GET /admin/videos/{videoId}/review-history
   * - POLICY_DOC: 사규 버전의 audit 정보를 ReviewHistoryResponse 형식으로 변환
   */
  async getReviewHistory(videoId: string): Promise<ReviewHistoryResponse> {
    // ID 형식으로 타입 판단
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(videoId);
    const isReviewItemId = /^REVIEW-(.+?)-v(\d+)$/i.test(videoId);
    const isDocumentVersion = /^([A-Z0-9-]+)-v?(\d+)$/i.test(videoId) && !isReviewItemId;
    
    if (isReviewItemId || isDocumentVersion) {
      // POLICY_DOC 감사 이력 조회
      let documentId: string | undefined;
      let version: number | undefined;
      
      if (isReviewItemId) {
        const match = /^REVIEW-(.+?)-v(\d+)$/i.exec(videoId);
        if (match) {
          documentId = match[1];
          version = parseInt(match[2], 10);
        }
      } else if (isDocumentVersion) {
        const match = /^([A-Z0-9-]+)-v?(\d+)$/i.exec(videoId);
        if (match) {
          documentId = match[1];
          version = parseInt(match[2], 10);
        }
      }
      
      if (!documentId || !version) {
        throw new ReviewerApiError("사규 문서 정보가 올바르지 않습니다.", {
          code: "INVALID_REQUEST",
          status: 400,
        });
      }
      
      // 사규 버전 상세 정보 조회
      const versionDetail = await getPolicyVersion(documentId, version);
      
      // audit 정보를 ReviewHistoryResponse 형식으로 변환
      // VersionDetail에는 audit 필드가 없을 수 있으므로, 기본 이벤트 생성
      const history: ReviewHistoryResponse["history"] = [];
      
      // 생성 이벤트
      if (versionDetail.createdAt) {
        history.push({
          eventType: "CREATED",
          description: "사규 문서 생성",
          timestamp: versionDetail.createdAt,
          actorName: versionDetail.uploaderUuid || "SYSTEM",
          actorUuid: versionDetail.uploaderUuid,
          rejectionReason: null,
          rejectionStage: null,
        });
      }
      
      // 검토 요청 이벤트
      if (versionDetail.reviewRequestedAt) {
        history.push({
          eventType: "SUBMITTED",
          description: "검토 요청",
          timestamp: versionDetail.reviewRequestedAt,
          actorName: versionDetail.uploaderUuid || "SYSTEM",
          actorUuid: versionDetail.uploaderUuid,
          rejectionReason: null,
          rejectionStage: null,
        });
      }
      
      // 반려 이벤트
      if (versionDetail.rejectedAt && versionDetail.rejectReason) {
        history.push({
          eventType: "REJECTED",
          description: "검토 반려",
          timestamp: versionDetail.rejectedAt,
          actorName: "REVIEWER",
          actorUuid: undefined,
          rejectionReason: versionDetail.rejectReason,
          rejectionStage: null,
        });
      }
      
      // 승인 이벤트 (ACTIVE 상태인 경우)
      if (versionDetail.status === "ACTIVE" && versionDetail.processedAt) {
        history.push({
          eventType: "APPROVED",
          description: "검토 승인",
          timestamp: versionDetail.processedAt,
          actorName: "REVIEWER",
          actorUuid: undefined,
          rejectionReason: null,
          rejectionStage: null,
        });
      }
      
      // 시간순 정렬 (최신순)
      history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      return {
        videoId: videoId, // reviewItemId를 videoId로 사용 (호환성)
        videoTitle: versionDetail.title,
        history,
      };
    } else if (isUuid) {
      // VIDEO 감사 이력 조회
      return http<ReviewHistoryResponse>(`/admin/videos/${encodeURIComponent(videoId)}/review-history`, { 
        method: "GET" 
      });
    } else {
      // 형식을 알 수 없는 경우 에러
      throw new ReviewerApiError("지원하지 않는 항목 ID 형식입니다.", {
        code: "INVALID_REQUEST",
        status: 400,
      });
    }
  },

  /**
   * 승인 처리
   * VIDEO와 POLICY_DOC 모두 지원
   * - VIDEO: PUT /admin/videos/{videoId}/approve
   * - POLICY_DOC: POST /rag/documents/policies/{documentId}/versions/{version}/review/approve
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async approve(id: string, _req: DecisionRequest): Promise<DecisionResponse> {
    // id 형식으로 타입 판단 (getWorkItem 호출 전에 판단하여 불필요한 API 호출 방지)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const isReviewItemId = /^REVIEW-(.+?)-v(\d+)$/i.test(id);
    const isDocumentVersion = /^([A-Z0-9-]+)-v?(\d+)$/i.test(id) && !isReviewItemId;
    
    if (isReviewItemId || isDocumentVersion) {
      // POLICY_DOC 승인
      let documentId: string | undefined;
      let version: number | undefined;
      
      if (isReviewItemId) {
        const match = /^REVIEW-(.+?)-v(\d+)$/i.exec(id);
        if (match) {
          documentId = match[1];
          version = parseInt(match[2], 10);
        }
      } else if (isDocumentVersion) {
        const match = /^([A-Z0-9-]+)-v?(\d+)$/i.exec(id);
        if (match) {
          documentId = match[1];
          version = parseInt(match[2], 10);
        }
      }
      
      if (!documentId || !version) {
        throw new ReviewerApiError("사규 문서 정보가 올바르지 않습니다.", {
          code: "INVALID_REQUEST",
          status: 400,
        });
      }
      
      await approveReview(documentId, version);
      
      return {
        item: await this.getWorkItem(id),
      };
    } else if (isUuid) {
      // VIDEO 승인
      await http<{
        videoId: string;
        previousStatus: string;
        currentStatus: string;
        updatedAt: string;
      }>(`/admin/videos/${encodeURIComponent(id)}/approve`, {
        method: "PUT",
      });
      
      return {
        item: await this.getWorkItem(id),
      };
    } else {
      // 형식을 알 수 없는 경우 getWorkItem으로 타입 확인
      const item = await this.getWorkItem(id);
      
      if (item.contentType === "POLICY_DOC") {
        const documentId = item.contentId || (item as unknown as { policyDocId?: string }).policyDocId;
        const versionLabel = item.contentVersionLabel;
        
        if (!documentId || !versionLabel) {
          throw new ReviewerApiError("사규 문서 정보가 올바르지 않습니다.", {
            code: "INVALID_REQUEST",
            status: 400,
          });
        }
        
        const versionMatch = /^v?(\d+)$/.exec(versionLabel);
        if (!versionMatch) {
          throw new ReviewerApiError("버전 정보가 올바르지 않습니다.", {
            code: "INVALID_REQUEST",
            status: 400,
          });
        }
        
        const version = parseInt(versionMatch[1], 10);
        await approveReview(documentId, version);
        
        return {
          item: await this.getWorkItem(id),
        };
      } else {
        throw new ReviewerApiError("지원하지 않는 항목 타입입니다.", {
          code: "INVALID_REQUEST",
          status: 400,
        });
      }
    }
  },

  /**
   * 반려 처리
   * VIDEO와 POLICY_DOC 모두 지원
   * - VIDEO: PUT /admin/videos/{videoId}/reject
   * - POLICY_DOC: POST /rag/documents/policies/{documentId}/versions/{version}/review/reject
   */
  async reject(id: string, req: DecisionRequest): Promise<DecisionResponse> {
    // id 형식으로 타입 판단 (getWorkItem 호출 전에 판단하여 불필요한 API 호출 방지)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const isReviewItemId = /^REVIEW-(.+?)-v(\d+)$/i.test(id);
    const isDocumentVersion = /^([A-Z0-9-]+)-v?(\d+)$/i.test(id) && !isReviewItemId;
    
    if (isReviewItemId || isDocumentVersion) {
      // POLICY_DOC 반려
      let documentId: string | undefined;
      let version: number | undefined;
      
      if (isReviewItemId) {
        const match = /^REVIEW-(.+?)-v(\d+)$/i.exec(id);
        if (match) {
          documentId = match[1];
          version = parseInt(match[2], 10);
        }
      } else if (isDocumentVersion) {
        const match = /^([A-Z0-9-]+)-v?(\d+)$/i.exec(id);
        if (match) {
          documentId = match[1];
          version = parseInt(match[2], 10);
        }
      }
      
      if (!documentId || !version) {
        throw new ReviewerApiError("사규 문서 정보가 올바르지 않습니다.", {
          code: "INVALID_REQUEST",
          status: 400,
        });
      }
      
      if (!req.reason || !req.reason.trim()) {
        throw new ReviewerApiError("반려 사유를 입력해주세요.", {
          code: "INVALID_REQUEST",
          status: 400,
        });
      }
      
      await rejectReview(documentId, version, { reason: req.reason });
      
      return {
        item: await this.getWorkItem(id),
      };
    } else if (isUuid) {
      // VIDEO 반려
      await http<{
        videoId: string;
        previousStatus: string;
        currentStatus: string;
        updatedAt: string;
      }>(`/admin/videos/${encodeURIComponent(id)}/reject`, {
        method: "PUT",
        body: JSON.stringify({ reason: req.reason || "" }),
      });
      
      return {
        item: await this.getWorkItem(id),
      };
    } else {
      // 형식을 알 수 없는 경우 getWorkItem으로 타입 확인
      const item = await this.getWorkItem(id);
      
      if (item.contentType === "POLICY_DOC") {
        const documentId = item.contentId || (item as unknown as { policyDocId?: string }).policyDocId;
        const versionLabel = item.contentVersionLabel;
        
        if (!documentId || !versionLabel) {
          throw new ReviewerApiError("사규 문서 정보가 올바르지 않습니다.", {
            code: "INVALID_REQUEST",
            status: 400,
          });
        }
        
        if (!req.reason || !req.reason.trim()) {
          throw new ReviewerApiError("반려 사유를 입력해주세요.", {
            code: "INVALID_REQUEST",
            status: 400,
          });
        }
        
        const versionMatch = /^v?(\d+)$/.exec(versionLabel);
        if (!versionMatch) {
          throw new ReviewerApiError("버전 정보가 올바르지 않습니다.", {
            code: "INVALID_REQUEST",
            status: 400,
          });
        }
        
        const version = parseInt(versionMatch[1], 10);
        await rejectReview(documentId, version, { reason: req.reason });
        
        return {
          item: await this.getWorkItem(id),
        };
      } else {
        throw new ReviewerApiError("지원하지 않는 항목 타입입니다.", {
          code: "INVALID_REQUEST",
          status: 400,
        });
      }
    }
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

/**
 * 사규 버전 정보를 ReviewWorkItem 형식으로 변환
 */
// 사용자 이름 캐시 (UUID -> 이름 매핑)
const userNameCache = new Map<string, string>();

/**
 * UUID로 사용자 이름 조회 (캐싱 적용)
 */
async function getUserName(uuid: string | undefined): Promise<string> {
  if (!uuid || uuid.trim().length === 0) {
    return "SYSTEM_ADMIN";
  }
  
  // 캐시 확인
  if (userNameCache.has(uuid)) {
    return userNameCache.get(uuid)!;
  }
  
  // 캐시에 없으면 API 호출
  try {
    // 동적 import로 userApi 사용 (순환 참조 방지)
    const { getUser } = await import("../dashboard/api/userApi");
    const user = await getUser(uuid);
    const fullName = user.attributes?.fullName?.[0] || user.firstName || user.username || uuid;
    
    // 캐시에 저장
    userNameCache.set(uuid, fullName);
    return fullName;
  } catch (error) {
    // 조회 실패 시 UUID를 더 읽기 쉬운 형식으로 표시
    const shortUuid = uuid.length > 8 ? `${uuid.substring(0, 8)}...` : uuid;
    const fallbackName = `사용자 (${shortUuid})`;
    
    // 캐시에 저장하여 반복 호출 방지
    userNameCache.set(uuid, fallbackName);
    return fallbackName;
  }
}

async function transformPolicyVersionToWorkItem(version: VersionDetail, title: string): Promise<ReviewWorkItem> {
  // 상태 매핑: PENDING -> REVIEW_PENDING, ACTIVE -> APPROVED, REJECTED -> REJECTED
  const status: ReviewWorkItem["status"] = 
    version.status === "PENDING" ? "REVIEW_PENDING"
    : version.status === "ACTIVE" ? "APPROVED"
    : version.status === "REJECTED" ? "REJECTED"
    : "REVIEW_PENDING";
  
  // 전처리 미리보기에서 excerpt 추출
  const excerpt = version.preprocessExcerpt || "";
  const mergedExcerpt = version.changeSummary 
    ? `변경 요약: ${version.changeSummary}\n\n${excerpt}`
    : excerpt;
  
  // PII 리스크 레벨 추정 (제목과 변경 요약에서 키워드 확인)
  const upper = (version.title + " " + (version.changeSummary || "")).toUpperCase();
  const piiRiskLevel: "none" | "low" | "medium" | "high" =
    upper.includes("PRIV") || upper.includes("개인정보") ? "medium"
    : upper.includes("SEC") ? "medium"
    : "low";
  
  // 사용자 이름 조회
  const creatorName = await getUserName(version.uploaderUuid);
  
  const workItem: ReviewWorkItem = {
    id: version.reviewItemId || `${version.documentId}-v${version.version}`,
    contentId: version.documentId,
    contentVersionLabel: `v${version.version}`,
    sourceSystem: "POLICY_PIPELINE",
    title: title || version.title,
    department: "정책/사규",
    creatorName,
    creatorId: version.uploaderUuid,
    contentType: "POLICY_DOC",
    contentCategory: "POLICY",
    createdAt: version.createdAt,
    submittedAt: version.reviewRequestedAt || version.createdAt,
    lastUpdatedAt: version.processedAt || version.createdAt,
    status,
    approvedAt: version.status === "ACTIVE" ? version.processedAt : undefined,
    rejectedAt: version.rejectedAt,
    policyExcerpt: mergedExcerpt,
    autoCheck: {
      piiRiskLevel,
      piiFindings: piiRiskLevel === "medium" ? ["(샘플) 주민번호/계좌번호/주소 패턴 탐지 룰 점검 필요"] : [],
      bannedWords: [],
      qualityWarnings: (version.changeSummary || "").trim().length < 10
        ? ["변경 요약이 너무 짧습니다. (검토자가 반려할 수 있음)"]
        : [],
    },
    audit: [],
    version: 1,
    riskScore: piiRiskLevel === "medium" ? 45 : 15,
  };
  
  // 메타 정보 저장 (승인/반려 시 사용)
  (workItem as unknown as Record<string, unknown>)["policyVersionId"] = version.id;
  (workItem as unknown as Record<string, unknown>)["policyDocId"] = version.documentId;
  (workItem as unknown as Record<string, unknown>)["policyVersion"] = version.version;
  
  return workItem;
}
