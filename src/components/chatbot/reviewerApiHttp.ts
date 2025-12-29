// src/components/chatbot/reviewerApiHttp.ts
import type { ReviewWorkItem } from "./reviewerDeskTypes";
import type {
  AcquireLockResponse,
  ConflictPayload,
  DecisionRequest,
  DecisionResponse,
  ReviewListParams,
  ReviewListResponse,
  ReleaseLockResponse,
} from "./reviewerApiTypes";
import { ReviewerApiError, toReviewerApiError, type ReviewerApiErrorCode } from "./reviewerApiErrors";

const DEFAULT_BASE = "/api/reviewer"; // 필요 시 env로 교체

function getEnvString(key: string): string | undefined {
  const env = import.meta.env as unknown as Record<string, unknown>;
  const v = env[key];
  return typeof v === "string" ? v : undefined;
}

function apiBase(): string {
  const v = getEnvString("VITE_REVIEWER_API_BASE");
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
    res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
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
 * (백엔드가 준비되면 이 레이어만 유지하면 됨)
 */
export const reviewerApiHttp = {
  async listWorkItems(params: ReviewListParams): Promise<ReviewListResponse> {
    const qs = new URLSearchParams();
    qs.set("tab", params.tab);
    if (params.q) qs.set("q", params.q);
    if (params.sort) qs.set("sort", params.sort);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    return http<ReviewListResponse>(`/work-items?${qs.toString()}`, { method: "GET" });
  },

  async getWorkItem(id: string): Promise<ReviewWorkItem> {
    return http<ReviewWorkItem>(`/work-items/${encodeURIComponent(id)}`, { method: "GET" });
  },

  async acquireLock(id: string): Promise<AcquireLockResponse> {
    return http<AcquireLockResponse>(`/work-items/${encodeURIComponent(id)}/lock`, { method: "POST" });
  },

  async releaseLock(id: string, lockToken: string): Promise<ReleaseLockResponse> {
    return http<ReleaseLockResponse>(`/work-items/${encodeURIComponent(id)}/lock`, {
      method: "DELETE",
      body: JSON.stringify({ lockToken }),
    });
  },

  async approve(id: string, req: DecisionRequest): Promise<DecisionResponse> {
    return http<DecisionResponse>(`/work-items/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  async reject(id: string, req: DecisionRequest): Promise<DecisionResponse> {
    return http<DecisionResponse>(`/work-items/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  },
};
