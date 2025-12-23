// src/components/chatbot/reviewerApiMock.ts
import type { ReviewWorkItem, WorkItemLock } from "./reviewerDeskTypes";
import type {
  AcquireLockResponse,
  ConflictPayload,
  DecisionRequest,
  DecisionResponse,
  ReviewListParams,
  ReviewListResponse,
  ReleaseLockResponse,
} from "./reviewerApiTypes";
import { ReviewerApiError, type ReviewerApiErrorCode } from "./reviewerApiErrors";
import type { ReviewerApi } from "./reviewerApi";
import {
  getReviewItemSnapshot,
  hydrateReviewStoreOnce,
  listReviewItemsSnapshot,
  upsertReviewItem,
} from "./reviewFlowStore";
import {
  onReviewerApprove,
  onReviewerReject,
  onReviewerApproveByVersionId,
  onReviewerRejectByVersionId,
} from "./policyStore";

function nowISO() {
  return new Date().toISOString();
}
function addSecondsISO(sec: number) {
  const d = new Date();
  d.setSeconds(d.getSeconds() + sec);
  return d.toISOString();
}
function randToken() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}
function randId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

type LockRec = {
  token: string;
  ownerId: string;
  ownerName?: string;
  expiresAt: string;
};

function isExpired(iso: string) {
  return Date.now() > new Date(iso).getTime();
}

/** VIDEO: videoUrl 있으면 2차(최종), 없으면 1차(스크립트) */
function isFinalStage(item: ReviewWorkItem): boolean {
  return item.contentType === "VIDEO" && (item.videoUrl ?? "").trim().length > 0;
}

/**
 * Creator 쪽에서 rejectReason/comment 등의 키를 “런타임”으로 읽는 경우가 있어서
 * 타입은 건드리지 않고(ReviewWorkItem 그대로), 객체에만 보강해준다.
 */
function attachDecisionCommentFields(item: ReviewWorkItem, comment?: string): ReviewWorkItem {
  const c = (comment ?? "").trim();
  if (!c) return item;

  const base = item as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {
    ...base,
    comment: base.comment ?? c,
    rejectReason: base.rejectReason ?? c,
    rejectedComment: base.rejectedComment ?? c,
    reviewerComment: base.reviewerComment ?? c,
    note: base.note ?? c,
  };
  return out as unknown as ReviewWorkItem;
}

function isMissingLinkedDocError(err: unknown) {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : err && typeof err === "object" && "message" in err
          ? String((err as Record<string, unknown>).message ?? "")
          : "";
  return msg.includes("연결된 문서를 찾을 수 없습니다");
}

function parsePolicyVersionLabel(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return Math.trunc(x);
  if (typeof x !== "string") return null;
  const s = x.trim();
  if (!s) return null;
  const m = /^v?(\d+)$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * ReviewWorkItem → PolicyDocVersion.id(pol-<documentId>-v<version>)로 해석
 * 우선순위:
 * 1) item.policyVersionId / item.policyDocVersionId 등 직접 링크
 * 2) contentId + contentVersionLabel 로 합성
 */
function resolvePolicyVersionIdFromReviewItem(item: ReviewWorkItem): string | null {
  const any = item as unknown as Record<string, unknown>;

  const directKeys = [
    "policyVersionId",
    "policyDocVersionId",
    "targetVersionId",
    "linkedVersionId",
    "versionId",
  ];

  for (const k of directKeys) {
    const v = any[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  const docId =
    (typeof any.contentId === "string" && any.contentId.trim()) ||
    (typeof any.policyDocId === "string" && any.policyDocId.trim()) ||
    (typeof any.documentId === "string" && any.documentId.trim()) ||
    "";

  const ver = parsePolicyVersionLabel(
    any.contentVersionLabel ?? any.policyVersionLabel ?? any["policyVersion"]
  );

  if (docId && ver !== null) return `pol-${docId}-v${ver}`;
  return null;
}

function safePolicyApprove(reviewItem: ReviewWorkItem, actor: string) {
  const versionId = resolvePolicyVersionIdFromReviewItem(reviewItem);

  try {
    if (versionId) {
      onReviewerApproveByVersionId(versionId, actor);
      return;
    }
    // fallback: legacy (reviewItemId)
    onReviewerApprove(reviewItem.id, actor);
  } catch (e) {
    if (isMissingLinkedDocError(e)) return;
    if (import.meta.env.DEV) console.warn("[policyStore] approve link failed", e);
  }
}

function safePolicyReject(reviewItem: ReviewWorkItem, actor: string, reason: string) {
  const versionId = resolvePolicyVersionIdFromReviewItem(reviewItem);

  try {
    if (versionId) {
      onReviewerRejectByVersionId(versionId, actor, reason);
      return;
    }
    // fallback: legacy (reviewItemId)
    onReviewerReject(reviewItem.id, actor, reason);
  } catch (e) {
    if (isMissingLinkedDocError(e)) return;
    if (import.meta.env.DEV) console.warn("[policyStore] reject link failed", e);
  }
}

export function createReviewerApiMock(opts?: {
  initialItems?: ReviewWorkItem[];
  me?: { id: string; name?: string };
  lockTtlSec?: number;
}): ReviewerApi {
  const me = opts?.me ?? { id: "me", name: "나(로컬)" };
  const lockTtlSec = opts?.lockTtlSec ?? 90;

  const locks = new Map<string, LockRec>();

  // 전역 store에 1회 seed
  hydrateReviewStoreOnce((opts?.initialItems ?? []) as ReviewWorkItem[]);

  function getLockRec(id: string): LockRec | null {
    const l = locks.get(id);
    if (!l) return null;
    if (isExpired(l.expiresAt)) {
      locks.delete(id);
      return null;
    }
    return l;
  }

  function getLockView(id: string): WorkItemLock | undefined {
    const l = getLockRec(id);
    if (!l) return undefined;
    const owner = (l.ownerName ?? "").trim() || l.ownerId;
    return { owner, expiresAt: l.expiresAt };
  }

  function throwConflict(
    code: ConflictPayload["code"],
    current?: Partial<ReviewWorkItem>,
    message?: string
  ): never {
    const payload: ConflictPayload = {
      code,
      current,
      message: message ?? "다른 사용자에 의해 변경되었습니다.",
    };

    throw new ReviewerApiError(payload.message ?? "충돌", {
      status: 409,
      code: code as ReviewerApiErrorCode,
      details: payload,
    });
  }

  function sortItems(items: ReviewWorkItem[], sort?: ReviewListParams["sort"]) {
    const copy = [...items];

    switch (sort) {
      case "OLDEST":
        copy.sort((a, b) =>
          (a.submittedAt ?? a.createdAt).localeCompare(b.submittedAt ?? b.createdAt)
        );
        break;
      case "DUE_SOON":
        copy.sort((a, b) =>
          (a.submittedAt ?? a.createdAt).localeCompare(b.submittedAt ?? b.createdAt)
        );
        break;
      case "RISK_HIGH":
        copy.sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
        break;
      case "NEWEST":
      default:
        copy.sort((a, b) =>
          (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt)
        );
        break;
    }

    return copy;
  }

  function filterByTab(all: ReviewWorkItem[], tab: ReviewListParams["tab"]) {
    if (tab === "REVIEW_PENDING") return all.filter((it) => it.status === "REVIEW_PENDING");
    if (tab === "APPROVED") return all.filter((it) => it.status === "APPROVED");
    if (tab === "REJECTED") return all.filter((it) => it.status === "REJECTED");

    const meKey = ((me.name ?? "").trim() || me.id).toLowerCase();
    return all.filter((it) =>
      (it.audit ?? []).some((a) => (a.actor ?? "").toLowerCase() === meKey)
    );
  }

  function applySearch(items: ReviewWorkItem[], q?: string) {
    const query = (q ?? "").trim().toLowerCase();
    if (!query) return items;

    return items.filter((it) => {
      const hay = `${it.title ?? ""} ${it.department ?? ""} ${it.creatorName ?? ""}`.toLowerCase();
      return hay.includes(query);
    });
  }

  function paginate(items: ReviewWorkItem[], cursor?: string, limit = 50) {
    if (!cursor) {
      const sliced = items.slice(0, limit);
      const nextCursor = items.length > sliced.length ? sliced[sliced.length - 1]?.id : undefined;
      return { sliced, nextCursor };
    }

    const idx = items.findIndex((it) => it.id === cursor);
    const start = idx >= 0 ? idx + 1 : 0;

    const sliced = items.slice(start, start + limit);
    const nextCursor =
      items.length > start + sliced.length ? sliced[sliced.length - 1]?.id : undefined;

    return { sliced, nextCursor };
  }

  function stageLabelOf(item: ReviewWorkItem) {
    if (item.contentType === "POLICY_DOC") return "사규";
    return isFinalStage(item) ? "2차(최종)" : "1차(스크립트)";
  }

  return {
    async listWorkItems(params: ReviewListParams): Promise<ReviewListResponse> {
      const all = listReviewItemsSnapshot().map((it) => ({
        ...it,
        lock: getLockView(it.id),
      }));

      let items = filterByTab(all, params.tab);
      items = applySearch(items, params.q);
      items = sortItems(items, params.sort);

      const limit = params.limit ?? 50;
      const { sliced, nextCursor } = paginate(items, params.cursor, limit);

      return { items: sliced, nextCursor };
    },

    async getWorkItem(id: string): Promise<ReviewWorkItem> {
      const item = getReviewItemSnapshot(id);
      if (!item) {
        throw new ReviewerApiError("항목을 찾을 수 없습니다.", {
          status: 404,
          code: "NOT_FOUND",
        });
      }
      return { ...item, lock: getLockView(id) };
    },

    async acquireLock(id: string): Promise<AcquireLockResponse> {
      const item = getReviewItemSnapshot(id);
      if (!item) {
        throw new ReviewerApiError("항목을 찾을 수 없습니다.", {
          status: 404,
          code: "NOT_FOUND",
        });
      }

      const existing = getLockRec(id);
      if (existing && existing.ownerId !== me.id) {
        throwConflict("LOCK_CONFLICT", item, "다른 검토자가 처리 중입니다.");
      }

      const token = randToken();
      const lock: LockRec = {
        token,
        ownerId: me.id,
        ownerName: me.name,
        expiresAt: addSecondsISO(lockTtlSec),
      };
      locks.set(id, lock);

      upsertReviewItem({
        ...(item as ReviewWorkItem),
        lock: getLockView(id),
        lastUpdatedAt: nowISO(),
      });

      return {
        lockToken: token,
        expiresAt: lock.expiresAt,
        ownerId: lock.ownerId,
        ownerName: lock.ownerName,
      };
    },

    async releaseLock(id: string, lockToken: string): Promise<ReleaseLockResponse> {
      const l = getLockRec(id);
      if (!l) return { released: true };
      if (l.token !== lockToken) return { released: false };

      locks.delete(id);

      const item = getReviewItemSnapshot(id);
      if (item) {
        upsertReviewItem({
          ...(item as ReviewWorkItem),
          lock: undefined,
          lastUpdatedAt: nowISO(),
        });
      }

      return { released: true };
    },

    async approve(id: string, req: DecisionRequest): Promise<DecisionResponse> {
      const item = getReviewItemSnapshot(id);
      if (!item) {
        throw new ReviewerApiError("항목을 찾을 수 없습니다.", {
          status: 404,
          code: "NOT_FOUND",
        });
      }

      const l = getLockRec(id);
      if (!l || l.token !== req.lockToken) throwConflict("LOCK_CONFLICT", item, "락이 유효하지 않습니다.");
      if (item.version !== req.version) throwConflict("VERSION_CONFLICT", item, "버전이 변경되었습니다.");
      if (item.status !== "REVIEW_PENDING") throwConflict("ALREADY_PROCESSED", item, "이미 처리된 항목입니다.");

      const now = nowISO();
      const stageLabel = stageLabelOf(item);
      const actor = (me.name ?? "").trim() || me.id;

      const next: ReviewWorkItem = {
        ...item,
        status: "APPROVED",
        version: item.version + 1,
        lastUpdatedAt: now,
        approvedAt: item.approvedAt ?? now,
        lock: undefined,
        audit: [
          ...(item.audit ?? []),
          {
            id: randId("aud"),
            action: "APPROVED",
            actor,
            at: now,
            detail: `${stageLabel} 승인`,
          },
        ],
      };

      // 락 해제 + store 반영은 먼저(결정 자체는 성공이어야 함)
      locks.delete(id);
      upsertReviewItem(next);

      // POLICY_DOC 승인 → policyStore에 반영(인덱싱 트리거) (best-effort)
      if (next.contentType === "POLICY_DOC") {
        safePolicyApprove(next, actor);
      }

      return { item: next };
    },

    async reject(id: string, req: DecisionRequest): Promise<DecisionResponse> {
      const item = getReviewItemSnapshot(id);
      if (!item) {
        throw new ReviewerApiError("항목을 찾을 수 없습니다.", {
          status: 404,
          code: "NOT_FOUND",
        });
      }

      const l = getLockRec(id);
      if (!l || l.token !== req.lockToken) throwConflict("LOCK_CONFLICT", item, "락이 유효하지 않습니다.");
      if (item.version !== req.version) throwConflict("VERSION_CONFLICT", item, "버전이 변경되었습니다.");
      if (item.status !== "REVIEW_PENDING") throwConflict("ALREADY_PROCESSED", item, "이미 처리된 항목입니다.");

      const now = nowISO();
      const stageLabel = stageLabelOf(item);
      const actor = (me.name ?? "").trim() || me.id;
      const reason = (req.reason ?? "").trim();

      const baseNext: ReviewWorkItem = {
        ...item,
        status: "REJECTED",
        version: item.version + 1,
        lastUpdatedAt: now,
        rejectedAt: item.rejectedAt ?? now,
        lock: undefined,
        audit: [
          ...(item.audit ?? []),
          {
            id: randId("aud"),
            action: "REJECTED",
            actor,
            at: now,
            detail: reason ? `${stageLabel} 반려: ${reason}` : `${stageLabel} 반려`,
          },
        ],
      };

      const next = attachDecisionCommentFields(baseNext, reason);

      // 락 해제 + store 반영은 먼저
      locks.delete(id);
      upsertReviewItem(next);

      // POLICY_DOC 반려 → policyStore에 반영 (best-effort)
      if (next.contentType === "POLICY_DOC") {
        safePolicyReject(next, actor, reason);
      }

      return { item: next };
    },
  };
}
