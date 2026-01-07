// src/components/chatbot/reviewerApiErrors.ts
export type ReviewerApiErrorCode =
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INVALID_REQUEST"
  | "LOCK_CONFLICT"
  | "VERSION_CONFLICT"
  | "ALREADY_PROCESSED"
  | "UNKNOWN_ERROR";

export class ReviewerApiError extends Error {
  readonly status?: number;
  readonly code: ReviewerApiErrorCode;
  readonly details?: unknown;

  constructor(
    message: string,
    opts?: { status?: number; code?: ReviewerApiErrorCode; details?: unknown }
  ) {
    super(message);
    this.name = "ReviewerApiError";
    this.status = opts?.status;
    this.code = opts?.code ?? "UNKNOWN_ERROR";
    this.details = opts?.details;
  }
}

export function isReviewerApiError(e: unknown): e is ReviewerApiError {
  if (typeof e !== "object" || e === null) return false;
  const maybe = e as { name?: unknown };
  return maybe.name === "ReviewerApiError";
}

/**
 * 백엔드가 { code, message, ... } 형태로 주는 걸 표준화해서 에러로 만든다.
 * - body는 unknown으로 받고, 필요한 필드만 안전하게 읽는다.
 */
export function toReviewerApiError(params: {
  status?: number;
  body?: unknown;
  fallbackMessage: string;
}): ReviewerApiError {
  const { status, body, fallbackMessage } = params;

  const b = (body ?? null) as { code?: unknown; message?: unknown } | null;
  const bodyCode = typeof b?.code === "string" ? (b.code as ReviewerApiErrorCode) : undefined;
  const bodyMessage = typeof b?.message === "string" ? b.message : undefined;

  const mapped: ReviewerApiErrorCode =
    bodyCode ??
    (status === 401
      ? "UNAUTHORIZED"
      : status === 403
        ? "FORBIDDEN"
        : status === 404
          ? "NOT_FOUND"
          : status === 409
            ? "VERSION_CONFLICT"
            : status && status >= 500
              ? "UNKNOWN_ERROR"
              : "UNKNOWN_ERROR");

  return new ReviewerApiError(bodyMessage ?? fallbackMessage, {
    status,
    code: mapped,
    details: body,
  });
}
