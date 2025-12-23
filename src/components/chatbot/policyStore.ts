// src/components/chatbot/policyStore.ts
import type { ReviewWorkItem } from "./reviewerDeskTypes";
import { upsertReviewItem } from "./reviewFlowStore";
import { createMockPolicyVersions } from "./policyMocks";

export type {
  PolicyDocStatus,
  PreprocessStatus,
  IndexingStatus,
  PolicyStoreErrorCode,
  PolicyAuditAction,
  PolicyAuditEvent,
  PolicyPreprocessPreview,
  PolicyDocVersion,
  PolicyDocGroup,
} from "./policyTypes";
export { PolicyStoreError } from "./policyTypes";

import type {
  PolicyAuditAction,
  PolicyAuditEvent,
  PolicyDocGroup,
  PolicyDocVersion,
  PolicyPreprocessPreview,
  PolicyAttachment,
} from "./policyTypes";
import { PolicyStoreError } from "./policyTypes";

/**
 * Mock 전용: 사규/정책 문서(버전) 저장소 + 관리자(1차) 플로우 + 검토자(2차) 승인 연동 포인트
 *
 * - 관리자: 업로드/수정/교체/삭제(soft) + 전처리 미리보기 + 검토요청(PENDING_REVIEWER)
 * - 검토자: 승인/반려/롤백(향후 Reviewer Desk에서 onReviewer* 호출)
 * - 409/403/404/500 등 에러를 "코드"로 분기 가능하게 유지
 *
 * - 지금은 백엔드 없이 mock store로 동작
 * - Reviewer Desk mock API에서 onReviewerApprove/onReviewerReject/onReviewerRollback 을 호출하면 상태가 이어지도록 설계
 */

type Listener = () => void;

let hydrated = false;
const listeners = new Set<Listener>();

const byId = new Map<string, PolicyDocVersion>();

// snapshot caches (참조 안정성)
let versionsSnapshot: PolicyDocVersion[] = [];
let groupsSnapshot: PolicyDocGroup[] = [];

function isoNow() {
  return new Date().toISOString();
}

function randId(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}`;
}

function sanitizePolicyFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? raw;
  let cleaned = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) continue;
    cleaned += ch;
  }
  return cleaned.trim() || "upload.bin";
}

function normalizePolicyAttachments(v: PolicyDocVersion): PolicyDocVersion {
  const existing = Array.isArray(v.attachments) ? v.attachments.slice() : [];

  // legacy → attachments로 승격(초기 seed/구버전 호환)
  if (existing.length === 0 && v.fileName) {
    existing.push({
      id: `att-legacy-${v.id}`,
      name: v.fileName,
      sizeBytes: v.fileSizeBytes,
      uploadedAt: v.updatedAt || v.createdAt,
    });
  }

  const primary = existing[0];

  return {
    ...v,
    attachments: existing,
    fileName: primary?.name ?? undefined,
    fileSizeBytes: primary?.sizeBytes ?? undefined,
  };
}

function audit(action: PolicyAuditAction, actor: string, message?: string): PolicyAuditEvent {
  return { id: randId("pa"), at: isoNow(), actor, action, message };
}

function emit() {
  for (const l of listeners) l();
}

function rebuildSnapshots() {
  // versions
  const arr = Array.from(byId.values());
  // 정렬: documentId ASC, version DESC, updatedAt DESC
  arr.sort((a, b) => {
    if (a.documentId !== b.documentId) return a.documentId.localeCompare(b.documentId);
    if (a.version !== b.version) return b.version - a.version;
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
  versionsSnapshot = arr;

  // groups
  const groupMap = new Map<string, PolicyDocGroup>();

  for (const v of arr) {
    const g =
      groupMap.get(v.documentId) ??
      ({
        documentId: v.documentId,
        title: v.title,
        archived: [],
        versions: [],
      } as PolicyDocGroup);

    g.title = v.title || g.title;
    g.versions.push(v);

    if (v.status === "ACTIVE") g.active = v;
    else if (v.status === "DRAFT") g.draft = v;
    else if (v.status === "PENDING_REVIEWER") g.pending = v;
    else if (v.status === "REJECTED") g.rejected = v;
    else if (v.status === "DELETED") g.deleted = v;
    else if (v.status === "ARCHIVED") g.archived.push(v);

    groupMap.set(v.documentId, g);
  }

  const groups = Array.from(groupMap.values());
  // 그룹 정렬: ACTIVE 우선, 그 다음 documentId
  groups.sort((a, b) => {
    const aActive = a.active ? 1 : 0;
    const bActive = b.active ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return a.documentId.localeCompare(b.documentId);
  });

  // archived는 최신이 위로
  for (const g of groups) {
    g.archived.sort((a, b) => b.version - a.version);
    // versions는 최신이 위로
    g.versions.sort((a, b) => b.version - a.version);
  }

  groupsSnapshot = groups;
}

/**
 * seed된 PENDING_REVIEWER 정책 문서를 ReviewerDesk 쪽 WorkItem으로도 올려준다.
 * (실서비스 느낌 + “검토자 승인/반려” 시나리오 데모 가능)
 */
function seedReviewerItemsFromPending(versions: PolicyDocVersion[]) {
  const now = isoNow();

  for (const v of versions) {
    if (v.status !== "PENDING_REVIEWER") continue;
    if (!v.reviewItemId) continue;

    const excerpt =
      `변경 요약: ${v.changeSummary || "(없음)"}\n\n` + (v.preprocessPreview?.excerpt ?? "(전처리 미리보기 없음)");

    // 문서 성격에 따라 위험도(샘플)
    const upper = `${v.documentId} ${v.title}`.toUpperCase();
    const piiRiskLevel =
      upper.includes("PRIV") || upper.includes("개인정보") ? "medium" : upper.includes("SEC") ? "medium" : "low";

    const reviewItem = {
      id: v.reviewItemId,

      sourceSystem: "POLICY_PIPELINE",
      contentId: v.documentId,
      contentVersionLabel: `v${v.version}`,

      title: v.title,
      department: "정책/사규",
      creatorName: "SYSTEM_ADMIN",
      contentType: "POLICY_DOC",
      contentCategory: "POLICY",

      createdAt: v.createdAt || now,
      submittedAt: v.reviewRequestedAt || now,
      lastUpdatedAt: v.updatedAt || now,
      status: "REVIEW_PENDING",

      policyExcerpt: excerpt,

      autoCheck: {
        piiRiskLevel,
        piiFindings: piiRiskLevel === "medium" ? ["(샘플) 주민번호/계좌번호/주소 패턴 탐지 룰 점검 필요"] : [],
        bannedWords: [],
        qualityWarnings:
          (v.changeSummary || "").trim().length < 10
            ? ["변경 요약이 너무 짧습니다. (검토자가 반려할 수 있음)"]
            : [],
      },

      audit: [
        { id: randId("aud"), action: "CREATED", actor: "SYSTEM_ADMIN", at: v.createdAt || now, detail: "사규/정책 검토 항목 생성(Seed)" },
        { id: randId("aud"), action: "SUBMITTED", actor: "SYSTEM_ADMIN", at: v.reviewRequestedAt || now, detail: "검토 요청(Seed)" },
      ],

      version: 1,
      riskScore: piiRiskLevel === "medium" ? 45 : 15,
    } as unknown as ReviewWorkItem;

    // 런타임 링크(승인/반려 연결용)
    (reviewItem as unknown as Record<string, unknown>)["policyVersionId"] = v.id;
    (reviewItem as unknown as Record<string, unknown>)["policyDocId"] = v.documentId;

    upsertReviewItem(reviewItem);
  }
}

function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;

  const seededRaw = createMockPolicyVersions();
  const seeded = seededRaw.map(normalizePolicyAttachments);
  for (const v of seeded) byId.set(v.id, v);

  rebuildSnapshots();
  seedReviewerItemsFromPending(seeded);

  emit();
}

/** ===== Public: subscribe/snapshot ===== */

export function subscribePolicyStore(listener: Listener) {
  ensureHydrated();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listPolicyVersionsSnapshot(): PolicyDocVersion[] {
  ensureHydrated();
  return versionsSnapshot;
}

export function listPolicyGroupsSnapshot(): PolicyDocGroup[] {
  ensureHydrated();
  return groupsSnapshot;
}

export function getPolicyVersionSnapshot(id: string): PolicyDocVersion | undefined {
  ensureHydrated();
  return byId.get(id);
}

/** ===== Helpers: constraints ===== */

function requireVersion(id: string): PolicyDocVersion {
  const v = byId.get(id);
  if (!v) throw new PolicyStoreError("NOT_FOUND", "문서를 찾을 수 없습니다.", 404);
  return v;
}

function getActiveVersion(documentId: string): PolicyDocVersion | undefined {
  for (const v of versionsSnapshot) {
    if (v.documentId === documentId && v.status === "ACTIVE") return v;
  }
  return undefined;
}

function getDraftVersion(documentId: string): PolicyDocVersion | undefined {
  for (const v of versionsSnapshot) {
    if (v.documentId === documentId && v.status === "DRAFT") return v;
  }
  return undefined;
}

function checkDraftUnique(documentId: string) {
  const draft = getDraftVersion(documentId);
  if (draft) {
    throw new PolicyStoreError("DRAFT_ALREADY_EXISTS", "이미 초안이 있습니다. 해당 초안을 수정해주세요.", 409);
  }
}

function checkVersionMonotonic(documentId: string, nextVersion: number) {
  const active = getActiveVersion(documentId);
  if (active && nextVersion <= active.version) {
    throw new PolicyStoreError("VERSION_REVERSE", "현재 적용 버전보다 낮거나 같은 버전은 등록할 수 없습니다.", 409);
  }
}

function checkFileDuplicate(documentId: string, fileName: string) {
  const target = fileName.trim().toLowerCase();

  const dup = versionsSnapshot.find((v) => {
    if (v.documentId !== documentId) return false;

    const legacy = (v.fileName || "").trim().toLowerCase();
    if (legacy && legacy === target) return true;

    const atts = Array.isArray(v.attachments) ? v.attachments : [];
    return atts.some((a) => (a.name || "").trim().toLowerCase() === target);
  });

  if (dup) {
    throw new PolicyStoreError("FILE_DUPLICATE", "동일한 파일이 이미 등록되어 있습니다.", 409);
  }
}

function updateVersion(next: PolicyDocVersion) {
  const normalized = normalizePolicyAttachments(next);
  byId.set(normalized.id, normalized);
  rebuildSnapshots();
  emit();
}

/** ===== Commands (Admin: create/update/upload/preprocess/submit/delete) ===== */

export function createDraft(input: {
  documentId: string;
  title: string;
  version: number;
  changeSummary: string;
  actor: string; // SYSTEM_ADMIN
}): PolicyDocVersion {
  ensureHydrated();

  const documentId = input.documentId.trim();
  if (!documentId) throw new PolicyStoreError("INVALID_STATE", "document_id가 비어있습니다.", 409);

  checkDraftUnique(documentId);
  checkVersionMonotonic(documentId, input.version);

  const now = isoNow();
  const v: PolicyDocVersion = {
    id: `pol-${documentId}-v${input.version}`,
    documentId,
    title: input.title.trim() || documentId,
    version: input.version,
    changeSummary: input.changeSummary.trim(),
    status: "DRAFT",
    attachments: [],
    preprocessStatus: "IDLE",
    indexingStatus: "IDLE",
    createdAt: now,
    updatedAt: now,
    audit: [audit("CREATE_DRAFT", input.actor, `v${input.version} 초안 생성`)],
  };

  byId.set(v.id, v);
  rebuildSnapshots();
  emit();
  return v;
}

export function updateDraft(
  id: string,
  patch: Partial<Pick<PolicyDocVersion, "title" | "changeSummary" | "version">> & { actor: string }
) {
  ensureHydrated();
  const prev = requireVersion(id);

  if (prev.status !== "DRAFT") {
    throw new PolicyStoreError("INVALID_STATE", "초안(DRAFT)만 수정할 수 있습니다.", 409);
  }

  const nextVersion = typeof patch.version === "number" ? patch.version : prev.version;
  if (nextVersion !== prev.version) {
    checkVersionMonotonic(prev.documentId, nextVersion);
  }

  const now = isoNow();
  const next: PolicyDocVersion = {
    ...prev,
    title: typeof patch.title === "string" ? patch.title : prev.title,
    changeSummary: typeof patch.changeSummary === "string" ? patch.changeSummary : prev.changeSummary,
    version: nextVersion,
    updatedAt: now,
    audit: [...prev.audit, audit("UPDATE_DRAFT", patch.actor, "초안 수정")],
  };

  // id 규칙 유지(문서ID + version)
  if (next.id !== `pol-${next.documentId}-v${next.version}`) {
    byId.delete(prev.id);
    next.id = `pol-${next.documentId}-v${next.version}`;
  }

  updateVersion(next);
}

export function attachFileToDraft(id: string, file: File, actor: string) {
  // legacy 호환: 단일 업로드도 멀티로 흡수
  attachFilesToDraft(id, [file], actor);
}

export function attachFilesToDraft(id: string, files: File[], actor: string) {
  ensureHydrated();
  const prev0 = requireVersion(id);
  if (prev0.status !== "DRAFT") {
    throw new PolicyStoreError("INVALID_STATE", "초안(DRAFT)만 파일을 업로드할 수 있습니다.", 409);
  }

  const prev = normalizePolicyAttachments(prev0);
  const now = isoNow();

  const prevAtts = Array.isArray(prev.attachments) ? prev.attachments.slice() : [];
  const existingNames = new Set(prevAtts.map((a) => (a.name || "").trim().toLowerCase()));

  const toAdd: PolicyAttachment[] = [];
  for (const f of files) {
    const name = sanitizePolicyFileName(f.name || "upload.bin");
    checkFileDuplicate(prev.documentId, name);

    const key = name.trim().toLowerCase();
    if (existingNames.has(key)) {
      // 같은 draft 내 중복은 무시(에러로 만들면 UX가 나빠짐)
      continue;
    }
    existingNames.add(key);

    toAdd.push({
      id: randId("att"),
      name,
      sizeBytes: f.size ?? undefined,
      mime: f.type || undefined,
      uploadedAt: now,
    });
  }

  if (toAdd.length === 0) return;

  const nextAtts = [...prevAtts, ...toAdd];
  const primary = nextAtts[0];

  const next: PolicyDocVersion = {
    ...prev,
    attachments: nextAtts,
    fileName: primary?.name,
    fileSizeBytes: primary?.sizeBytes,
    preprocessStatus: "IDLE",
    preprocessError: undefined,
    preprocessPreview: undefined,
    updatedAt: now,
    audit: [
      ...prev.audit,
      audit("UPLOAD_FILE", actor, `파일 추가: ${toAdd.map((x) => x.name).join(", ")}`),
    ],
  };

  updateVersion(next);
}

export function removeFileFromDraft(id: string, attachmentId: string, actor: string) {
  ensureHydrated();
  const prev0 = requireVersion(id);
  if (prev0.status !== "DRAFT") {
    throw new PolicyStoreError("INVALID_STATE", "초안(DRAFT)만 파일을 삭제할 수 있습니다.", 409);
  }

  const prev = normalizePolicyAttachments(prev0);
  const now = isoNow();

  const prevAtts = Array.isArray(prev.attachments) ? prev.attachments.slice() : [];
  const removed = prevAtts.find((a) => a.id === attachmentId);
  const nextAtts = prevAtts.filter((a) => a.id !== attachmentId);
  if (nextAtts.length === prevAtts.length) return;

  const primary = nextAtts[0];

  const next: PolicyDocVersion = {
    ...prev,
    attachments: nextAtts,
    fileName: primary?.name,
    fileSizeBytes: primary?.sizeBytes,
    preprocessStatus: "IDLE",
    preprocessError: undefined,
    preprocessPreview: undefined,
    updatedAt: now,
    audit: [
      ...prev.audit,
      audit("REMOVE_FILE", actor, `파일 삭제: ${removed?.name ?? attachmentId}`),
    ],
  };

  updateVersion(next);
}

export function runPreprocess(id: string, actor: string) {
  ensureHydrated();
  const prev = requireVersion(id);
  if (prev.status !== "DRAFT")
    throw new PolicyStoreError("INVALID_STATE", "초안(DRAFT)만 전처리를 실행할 수 있습니다.", 409);
  if (!prev.fileName) throw new PolicyStoreError("INVALID_STATE", "파일 업로드 후 전처리를 실행할 수 있습니다.", 409);

  const startedAt = isoNow();

  updateVersion({
    ...prev,
    preprocessStatus: "PROCESSING",
    preprocessError: undefined,
    preprocessPreview: undefined,
    updatedAt: startedAt,
    audit: [...prev.audit, audit("PREPROCESS_START", actor, "전처리 시작")],
  });

  // mock: 450ms 후 완료(일부 케이스 실패도 가능)
  window.setTimeout(() => {
    const cur = byId.get(prev.id);
    if (!cur) return;

    // 실패 조건(샘플): 파일명이 "fail" 포함이면 실패
    const fail = (cur.fileName || "").toLowerCase().includes("fail");

    if (fail) {
      updateVersion({
        ...cur,
        preprocessStatus: "FAILED",
        preprocessError: "전처리 실패: 텍스트 추출에 실패했습니다.",
        updatedAt: isoNow(),
        audit: [...cur.audit, audit("PREPROCESS_FAIL", "SYSTEM", "전처리 실패")],
      });
      return;
    }

    const excerpt =
      `[전처리 미리보기]\n` +
      `문서: ${cur.title} (document_id=${cur.documentId})\n` +
      `버전: v${cur.version}\n\n` +
      `… (중략) …\n` +
      `본 문서는 사내 사규/정책 mock 텍스트입니다.\n`;

    const preview: PolicyPreprocessPreview = {
      pages: 10 + (cur.version % 4),
      chars: 18000 + cur.version * 700,
      excerpt,
    };

    updateVersion({
      ...cur,
      preprocessStatus: "READY",
      preprocessPreview: preview,
      updatedAt: isoNow(),
      audit: [...cur.audit, audit("PREPROCESS_DONE", "SYSTEM", "전처리 완료")],
    });
  }, 450);
}

export function submitReviewRequest(id: string, actor: string): PolicyDocVersion {
  ensureHydrated();
  const prev = requireVersion(id);

  if (prev.status !== "DRAFT")
    throw new PolicyStoreError("INVALID_STATE", "초안(DRAFT)만 검토요청할 수 있습니다.", 409);
  if (prev.preprocessStatus !== "READY")
    throw new PolicyStoreError("INVALID_STATE", "전처리 미리보기가 READY여야 합니다.", 409);

  // 초안 1개 원칙 방어
  const anotherDraft = versionsSnapshot.find(
    (v) => v.documentId === prev.documentId && v.status === "DRAFT" && v.id !== prev.id
  );
  if (anotherDraft) {
    throw new PolicyStoreError("DRAFT_ALREADY_EXISTS", "이미 초안이 있습니다. 해당 초안을 수정해주세요.", 409);
  }

  const now = isoNow();
  const reviewItemId = `rvw-pol-${prev.documentId}-v${prev.version}-${Math.random().toString(16).slice(2)}`;

  // Reviewer Desk로 “문서 검토 항목” 생성
  const mergedExcerpt =
    `변경 요약: ${prev.changeSummary || "(없음)"}\n\n` + (prev.preprocessPreview?.excerpt ?? "");

  const reviewItem: ReviewWorkItem = {
    id: reviewItemId,

    sourceSystem: "POLICY_PIPELINE",
    contentId: prev.documentId,
    contentVersionLabel: `v${prev.version}`,

    title: prev.title,
    department: "정책/사규",
    creatorName: actor,
    contentType: "POLICY_DOC",
    contentCategory: "POLICY",

    createdAt: now,
    submittedAt: now,
    lastUpdatedAt: now,
    status: "REVIEW_PENDING",

    policyExcerpt: mergedExcerpt,

    autoCheck: {
      piiRiskLevel: "low",
      piiFindings: [] as string[],
      bannedWords: [] as string[],
      qualityWarnings: prev.changeSummary.trim().length < 6 ? ["변경 요약이 너무 짧습니다."] : [],
    },

    audit: [
      { id: randId("aud"), action: "CREATED", actor, at: now, detail: "사규/정책 검토 항목 생성" },
      { id: randId("aud"), action: "SUBMITTED", actor, at: now, detail: "검토 요청" },
    ],

    version: 1,
    riskScore: 10,
  };

  (reviewItem as unknown as Record<string, unknown>)["policyVersionId"] = prev.id;
  (reviewItem as unknown as Record<string, unknown>)["policyDocId"] = prev.documentId;

  upsertReviewItem(reviewItem);

  const next: PolicyDocVersion = {
    ...prev,
    status: "PENDING_REVIEWER",
    reviewRequestedAt: now,
    reviewItemId,
    updatedAt: now,
    audit: [...prev.audit, audit("SUBMIT_REVIEW", actor, "검토 요청")],
  };

  updateVersion(next);
  return next;
}

export function softDelete(id: string, actor: string, reason?: string) {
  ensureHydrated();
  const prev = requireVersion(id);

  // ACTIVE는 여기서 삭제하지 않도록(운영 정책)
  if (prev.status === "ACTIVE") {
    throw new PolicyStoreError("INVALID_STATE", "현재 적용중(ACTIVE) 문서는 바로 삭제할 수 없습니다.", 409);
  }

  const now = isoNow();
  const next: PolicyDocVersion = {
    ...prev,
    status: "DELETED",
    deletedAt: now,
    updatedAt: now,
    audit: [...prev.audit, audit("SOFT_DELETE", actor, reason ? `삭제: ${reason}` : "삭제(soft)")],
  };

  updateVersion(next);
}

/**
 * "ACTIVE 기반으로 다음 버전 초안 생성" 편의 함수
 */
export function suggestNextVersion(documentId: string): number {
  ensureHydrated();
  const active = getActiveVersion(documentId);
  return (active?.version ?? 0) + 1;
}

/** ===== Reviewer linkage (2차: approve/reject/rollback/indexing) ===== */

export function onReviewerApproveByVersionId(versionId: string, actor: string) {
  ensureHydrated();

  const target = requireVersion(versionId);

  if (target.status !== "PENDING_REVIEWER") {
    throw new PolicyStoreError("INVALID_STATE", "승인 가능한 상태가 아닙니다.", 409);
  }

  const now = isoNow();

  // 기존 ACTIVE 찾기
  const curActive = getActiveVersion(target.documentId);
  if (curActive) {
    updateVersion({
      ...curActive,
      status: "ARCHIVED",
      archivedAt: now,
      updatedAt: now,
      audit: [...curActive.audit, audit("INDEX_DONE", "SYSTEM", `v${target.version} 적용으로 ARCHIVED 전환`)],
    });
  }

  updateVersion({
    ...target,
    status: "ACTIVE",
    activatedAt: now,
    indexingStatus: "INDEXING",
    indexingError: undefined,
    updatedAt: now,
    audit: [...target.audit, audit("REVIEW_APPROVE", actor, "승인"), audit("INDEX_START", "SYSTEM", "인덱싱 시작")],
  });

  window.setTimeout(() => {
    const cur = byId.get(target.id);
    if (!cur) return;

    const fail = (cur.changeSummary || "").toUpperCase().includes("FAIL_INDEX");

    if (fail) {
      updateVersion({
        ...cur,
        indexingStatus: "FAILED",
        indexingError: "인덱싱 실패(500): 처리 중 오류가 발생했습니다.",
        updatedAt: isoNow(),
        audit: [...cur.audit, audit("INDEX_FAIL", "SYSTEM", "인덱싱 실패")],
      });
      return;
    }

    updateVersion({
      ...cur,
      indexingStatus: "DONE",
      updatedAt: isoNow(),
      audit: [...cur.audit, audit("INDEX_DONE", "SYSTEM", "인덱싱 완료")],
    });
  }, 650);
}

export function onReviewerRejectByVersionId(versionId: string, actor: string, reason: string) {
  ensureHydrated();

  const target = requireVersion(versionId);

  if (target.status !== "PENDING_REVIEWER") {
    throw new PolicyStoreError("INVALID_STATE", "반려 가능한 상태가 아닙니다.", 409);
  }

  const now = isoNow();
  updateVersion({
    ...target,
    status: "REJECTED",
    rejectedAt: now,
    rejectReason: reason,
    updatedAt: now,
    audit: [...target.audit, audit("REVIEW_REJECT", actor, "반려")],
  });
}

export function retryIndexingByVersionId(versionId: string, actor: string) {
  ensureHydrated();

  const target = requireVersion(versionId);
  if (target.status !== "ACTIVE") throw new PolicyStoreError("INVALID_STATE", "ACTIVE 상태에서만 재시도 가능합니다.", 409);

  if (target.indexingStatus !== "FAILED") {
    throw new PolicyStoreError("INVALID_STATE", "인덱싱 실패 상태에서만 재시도 가능합니다.", 409);
  }

  const now = isoNow();
  updateVersion({
    ...target,
    indexingStatus: "INDEXING",
    indexingError: undefined,
    updatedAt: now,
    audit: [...target.audit, audit("INDEX_START", actor, "인덱싱 재시도")],
  });

  window.setTimeout(() => {
    const cur = byId.get(target.id);
    if (!cur) return;

    updateVersion({
      ...cur,
      indexingStatus: "DONE",
      updatedAt: isoNow(),
      audit: [...cur.audit, audit("INDEX_DONE", "SYSTEM", "인덱싱 완료")],
    });
  }, 650);
}

export function onReviewerApprove(reviewItemId: string, actor: string) {
  ensureHydrated();
  const target = versionsSnapshot.find((v) => v.reviewItemId === reviewItemId);
  if (!target) throw new PolicyStoreError("NOT_FOUND", "연결된 문서를 찾을 수 없습니다.", 404);
  return onReviewerApproveByVersionId(target.id, actor);
}

export function onReviewerReject(reviewItemId: string, actor: string, reason: string) {
  ensureHydrated();
  const target = versionsSnapshot.find((v) => v.reviewItemId === reviewItemId);
  if (!target) throw new PolicyStoreError("NOT_FOUND", "연결된 문서를 찾을 수 없습니다.", 404);
  return onReviewerRejectByVersionId(target.id, actor, reason);
}

export function retryIndexing(reviewItemId: string, actor: string) {
  ensureHydrated();
  const target = versionsSnapshot.find((v) => v.reviewItemId === reviewItemId);
  if (!target) throw new PolicyStoreError("NOT_FOUND", "연결된 문서를 찾을 수 없습니다.", 404);
  return retryIndexingByVersionId(target.id, actor);
}

export function onReviewerRollback(input: {
  documentId: string;
  targetVersionId: string; // PolicyDocVersion.id
  actor: string;
  reason?: string;
}) {
  ensureHydrated();

  const target = requireVersion(input.targetVersionId);
  if (target.documentId !== input.documentId) {
    throw new PolicyStoreError("INVALID_STATE", "롤백 대상 문서가 일치하지 않습니다.", 409);
  }

  if (target.status !== "ARCHIVED") {
    throw new PolicyStoreError("INVALID_STATE", "ARCHIVED 버전만 롤백할 수 있습니다.", 409);
  }

  const now = isoNow();
  const curActive = getActiveVersion(input.documentId);

  if (curActive) {
    updateVersion({
      ...curActive,
      status: "ARCHIVED",
      archivedAt: now,
      updatedAt: now,
      audit: [...curActive.audit, audit("ROLLBACK", input.actor, `롤백으로 ARCHIVED 전환 (from v${curActive.version})`)],
    });
  }

  updateVersion({
    ...target,
    status: "ACTIVE",
    activatedAt: now,
    indexingStatus: "DONE",
    indexingError: undefined,
    updatedAt: now,
    audit: [...target.audit, audit("ROLLBACK", input.actor, input.reason ? `롤백: ${input.reason}` : "롤백")],
  });
}
