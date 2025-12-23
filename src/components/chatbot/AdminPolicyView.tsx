// src/components/chatbot/AdminPolicyView.tsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import "./chatbot.css";
import {
  PolicyStoreError,
  type PolicyDocGroup,
  type PolicyDocStatus,
  type PolicyDocVersion,
  subscribePolicyStore,
  listPolicyGroupsSnapshot,
  listPolicyVersionsSnapshot,
  getPolicyVersionSnapshot,
  createDraft,
  updateDraft,
  attachFilesToDraft,
  removeFileFromDraft,
  runPreprocess,
  submitReviewRequest,
  softDelete,
  suggestNextVersion,
} from "./policyStore";
import ProjectFilesModal, { type ProjectFileItem } from "./ProjectFilesModal";

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

type Toast =
  | { open: false }
  | { open: true; tone: "neutral" | "warn" | "danger"; message: string };

type DeleteModalState =
  | { open: false }
  | { open: true; reason: string; error?: string };

function statusLabel(s: PolicyDocStatus) {
  switch (s) {
    case "DRAFT":
      return "초안";
    case "PENDING_REVIEWER":
      return "검토 대기";
    case "ACTIVE":
      return "현재 적용중";
    case "ARCHIVED":
      return "보관됨";
    case "REJECTED":
      return "반려됨";
    case "DELETED":
      return "삭제됨";
  }
}

function statusTone(s: PolicyDocStatus): "neutral" | "warn" | "danger" {
  switch (s) {
    case "ACTIVE":
    case "ARCHIVED":
      return "neutral";
    case "DRAFT":
    case "PENDING_REVIEWER":
      return "warn";
    case "REJECTED":
    case "DELETED":
      return "danger";
  }
}

function mapPolicyError(err: unknown): {
  tone: "neutral" | "warn" | "danger";
  message: string;
} {
  if (err instanceof PolicyStoreError) {
    if (err.status === 403) return { tone: "danger", message: "권한 없음" };
    if (err.status === 404)
      return { tone: "danger", message: "문서를 찾을 수 없음" };

    if (err.code === "DRAFT_ALREADY_EXISTS")
      return {
        tone: "warn",
        message: "이미 개정안(초안)이 있습니다. 해당 개정안을 수정해주세요.",
      };
    if (err.code === "VERSION_REVERSE")
      return {
        tone: "warn",
        message: "현재 적용 버전보다 낮은 버전은 등록할 수 없습니다.",
      };
    if (err.code === "FILE_DUPLICATE")
      return { tone: "warn", message: "동일한 파일이 이미 등록되어 있습니다." };

    if (err.status === 409)
      return { tone: "warn", message: err.message || "처리할 수 없는 상태입니다." };
    if (err.status >= 500)
      return {
        tone: "danger",
        message: "처리가 실패했습니다. 다시 시도하거나 관리자에게 문의",
      };

    return { tone: "warn", message: err.message || "요청을 처리할 수 없습니다." };
  }
  return {
    tone: "danger",
    message: "처리가 실패했습니다. 다시 시도하거나 관리자에게 문의",
  };
}

function StatusPill({ status }: { status: PolicyDocStatus }) {
  return (
    <span
      className={cx(
        "cb-reviewer-pill",
        `cb-reviewer-pill--${statusTone(status)}`,
        `cb-reviewer-pill--status-${status}`,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function formatBytes(n?: number) {
  if (!n || n <= 0) return "";
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function renderAttachmentSummary(v: PolicyDocVersion) {
  const atts = v.attachments ?? [];
  if (atts.length === 0) return <span className="muted">미업로드</span>;

  const first = atts[0];
  const firstSize = first.sizeBytes ? ` ${formatBytes(first.sizeBytes)}` : "";
  const rest = atts.length > 1 ? ` · 외 ${atts.length - 1}개` : "";

  return (
    <>
      {first.name}
      <span className="muted">
        {firstSize}
        {rest}
      </span>
    </>
  );
}

type SortMode = "STATUS" | "DOCID_ASC";
type RightTab = "OVERVIEW" | "DRAFT" | "PREPROCESS" | "REVIEW" | "HISTORY";

function safeTime(v?: string) {
  const t = v ? new Date(v).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function groupPriority(g: PolicyDocGroup) {
  // 낮을수록 상단 노출
  if (g.draft) return 0;
  if (g.pending) return 1;
  if (g.active) return 2;
  if (g.rejected) return 3;
  if (g.archived && g.archived.length > 0) return 4;
  if (g.deleted) return 5;
  return 6;
}

function groupLatestUpdatedAt(g: PolicyDocGroup) {
  let max = 0;
  for (const v of g.versions) {
    max = Math.max(max, safeTime(v.updatedAt));
  }
  return max;
}

/**
 * - 현재 스토어 상태(groups)로부터 "결정적"으로 다음 문서 ID를 생성한다.
 */
function nextPolicyDocumentId(groups: PolicyDocGroup[]) {
  let max = 0;
  const existing = new Set(groups.map((g) => g.documentId.toUpperCase()));

  for (const g of groups) {
    const m = /^POL-(\d{1,})$/i.exec(g.documentId);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }

  let next = Math.max(max + 1, groups.length + 1);
  let candidate = `POL-${String(next).padStart(4, "0")}`;
  while (existing.has(candidate.toUpperCase())) {
    next += 1;
    candidate = `POL-${String(next).padStart(4, "0")}`;
  }
  return candidate;
}

/**
 * (2) 카드 메타: REJECTED/ARCHIVED/DELETED 강조 + 한 줄 고정 + 초과분 +N
 */
type MetaChip = { key: string; label: string; className?: string };

const MAX_STATUS_CHIPS = 3;

function buildGroupMetaChips(g: PolicyDocGroup): MetaChip[] {
  const active = g.active;
  const draft = g.draft;
  const pending = g.pending;
  const rejected = g.rejected;
  const deleted = g.deleted;
  const archivedCount = g.archived?.length ?? 0;

  const activeChip: MetaChip = active
    ? { key: "active", label: `ACTIVE v${active.version}` }
    : {
      key: "active-none",
      label: "ACTIVE 없음",
      className: "cb-policy-meta-chip--muted",
    };

  const draftChip: MetaChip | null = draft
    ? { key: "draft", label: `DRAFT v${draft.version}` }
    : null;

  const pendingChip: MetaChip | null = pending
    ? { key: "pending", label: `PENDING v${pending.version}` }
    : null;

  const rejectedChip: MetaChip | null = rejected
    ? {
      key: "rejected",
      label: `REJECTED v${rejected.version}`,
      className: "cb-policy-meta-chip--danger",
    }
    : null;

  const archivedChip: MetaChip | null =
    archivedCount > 0
      ? {
        key: "archived",
        label: `ARCHIVED ${archivedCount}`,
        className: "cb-policy-meta-chip--muted",
      }
      : null;

  const deletedChip: MetaChip | null = deleted
    ? { key: "deleted", label: "DELETED", className: "cb-policy-meta-chip--danger" }
    : null;

  const totalChip: MetaChip = {
    key: "total",
    label: `전체 ${g.versions.length}개`,
    className: "cb-policy-meta-chip--muted",
  };

  const candidates: MetaChip[] = [];
  const pushUnique = (chip: MetaChip | null) => {
    if (!chip) return;
    if (candidates.some((c) => c.key === chip.key)) return;
    candidates.push(chip);
  };

  if (active) pushUnique(activeChip);
  else if (pending) pushUnique(pendingChip);
  else if (draft) pushUnique(draftChip);
  else if (rejected) pushUnique(rejectedChip);
  else if (archivedCount > 0) pushUnique(archivedChip);
  else if (deleted) pushUnique(deletedChip);

  pushUnique(deletedChip);
  pushUnique(rejectedChip);
  pushUnique(archivedChip);

  pushUnique(pendingChip);
  pushUnique(draftChip);
  pushUnique(activeChip);

  const visible = candidates.slice(0, MAX_STATUS_CHIPS);
  const hiddenCount = Math.max(0, candidates.length - visible.length);

  const out: MetaChip[] = [...visible];
  if (hiddenCount > 0) {
    out.push({
      key: "more",
      label: `+${hiddenCount}`,
      className: "cb-policy-meta-chip--count",
    });
  }
  out.push(totalChip);

  return out;
}

/**
 * (1) 좌측 그룹 액션 버튼(우상단 미니버튼) 규칙
 */
type GroupActionMode = "GOTO_DRAFT" | "VIEW_PENDING" | "CREATE_DRAFT" | "NONE";

function canShowGroupActionButton(g: PolicyDocGroup) {
  const hasLifecycle =
    Boolean(g.active) ||
    Boolean(g.pending) ||
    Boolean(g.rejected) ||
    Boolean(g.archived && g.archived.length > 0);
  return hasLifecycle;
}

function getGroupActionButtonState(g: PolicyDocGroup): {
  show: boolean;
  label: string;
  disabled: boolean;
  title: string;
  mode: GroupActionMode;
} {
  const show = canShowGroupActionButton(g);
  if (!show) {
    return { show: false, label: "개정안", disabled: true, title: "", mode: "NONE" };
  }

  if (g.pending) {
    return {
      show: true,
      label: "검토안",
      disabled: false,
      title: "검토 대기(PENDING) 문서 내용을 확인합니다.",
      mode: "VIEW_PENDING",
    };
  }

  if (g.draft) {
    return {
      show: true,
      label: "개정안",
      disabled: false,
      title: "이미 개정안(초안)이 있습니다. 클릭하면 해당 개정안으로 이동합니다.",
      mode: "GOTO_DRAFT",
    };
  }

  if (g.deleted && !g.active && !g.rejected && (!g.archived || g.archived.length === 0)) {
    return {
      show: true,
      label: "개정안",
      disabled: true,
      title: "삭제된 문서는 개정안(초안)을 만들 수 없습니다.",
      mode: "NONE",
    };
  }

  return {
    show: true,
    label: "개정안",
    disabled: false,
    title: g.active
      ? "현재 문서의 다음 버전(DRAFT)을 생성합니다. (ACTIVE 기준)"
      : "현재 문서의 다음 버전(DRAFT)을 생성합니다.",
    mode: "CREATE_DRAFT",
  };
}

function defaultRightTabForStatus(status: PolicyDocStatus | null | undefined): RightTab {
  if (status === "DRAFT") return "DRAFT";
  if (status === "PENDING_REVIEWER") return "REVIEW";
  return "OVERVIEW";
}

export default function AdminPolicyView() {
  const groups = useSyncExternalStore(subscribePolicyStore, listPolicyGroupsSnapshot);
  const versions = useSyncExternalStore(subscribePolicyStore, listPolicyVersionsSnapshot);

  const [toast, setToast] = useState<Toast>({ open: false });
  const toastTimerRef = useRef<number | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<PolicyDocStatus | "ALL">("ALL");

  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("STATUS");

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const actor = "SYSTEM_ADMIN";

  // versions를 실제로 참조해서 selected를 계산 → store 변경 시 갱신 보장
  const selected = useMemo<PolicyDocVersion | null>(() => {
    if (!selectedId) return null;

    const found = versions.find((v) => v.id === selectedId);
    if (found) return found;

    return getPolicyVersionSnapshot(selectedId) ?? null;
  }, [selectedId, versions]);

  const selectedGroup = useMemo<PolicyDocGroup | null>(() => {
    if (!selected) return null;
    return groups.find((g) => g.documentId === selected.documentId) ?? null;
  }, [selected, groups]);

  // (3) 모달용 파일 목록 구성
  const policyFiles: ProjectFileItem[] = useMemo(() => {
    if (!selected) return [];
    const atts = selected.attachments ?? [];
    return atts.map((a, idx) => ({
      id: a.id,
      name: a.name,
      sizeBytes: a.sizeBytes,
      meta: idx === 0 ? "기본" : undefined,
    }));
  }, [selected]);

  const filteredGroups = useMemo(() => {
    const query = q.trim().toLowerCase();

    const excluded = new Set<PolicyDocStatus>();
    if (!includeArchived) excluded.add("ARCHIVED");
    if (!includeDeleted) excluded.add("DELETED");

    const base = groups
      .map((g) => {
        const hay = `${g.documentId} ${g.title}`.toLowerCase();
        const matchQ = !query || hay.includes(query);
        if (!matchQ) return null;

        if (statusFilter === "ALL") {
          const hasAnyVisible = g.versions.some((v) => !excluded.has(v.status));
          return hasAnyVisible ? g : null;
        }

        const has = g.versions.some((v) => v.status === statusFilter);
        return has ? g : null;
      })
      .filter(Boolean) as PolicyDocGroup[];

    const sorted = base.slice().sort((a, b) => {
      if (sortMode === "DOCID_ASC") {
        return a.documentId.localeCompare(b.documentId);
      }

      const pa = groupPriority(a);
      const pb = groupPriority(b);
      if (pa !== pb) return pa - pb;

      const ta = groupLatestUpdatedAt(a);
      const tb = groupLatestUpdatedAt(b);
      if (ta !== tb) return tb - ta;

      return a.documentId.localeCompare(b.documentId);
    });

    return sorted;
  }, [groups, q, statusFilter, includeArchived, includeDeleted, sortMode]);

  const showToast = (tone: "neutral" | "warn" | "danger", message: string) => {
    setToast({ open: true, tone, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast({ open: false }), 2400);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const [draftForm, setDraftForm] = useState<{
    documentId: string;
    title: string;
    version: string;
    changeSummary: string;
  }>({ documentId: "", title: "", version: "", changeSummary: "" });

  const [reviewCheck, setReviewCheck] = useState({
    checkedBasics: false,
    checkedPreview: false,
  });

  // 우측: “섹션 탭”으로 길이 폭증 방지
  const [rightTab, setRightTab] = useState<RightTab>("OVERVIEW");
  const rightBodyRef = useRef<HTMLDivElement | null>(null);
  const selectVersion = (v: PolicyDocVersion | null) => {
    setSelectedId(v?.id ?? null);

    const nextTab = defaultRightTabForStatus(v?.status);
    setRightTab(nextTab);

    if (v && v.status === "DRAFT") {
      setDraftForm({
        documentId: v.documentId,
        title: v.title,
        version: String(v.version),
        changeSummary: v.changeSummary,
      });
    } else {
      setDraftForm({ documentId: "", title: "", version: "", changeSummary: "" });
    }

    // 체크리스트는 선택 변경 시 초기화(요구사항)
    setReviewCheck({ checkedBasics: false, checkedPreview: false });
  };

  const safeSelectFirstVersion = (g: PolicyDocGroup) => {
    const pick =
      g.draft ??
      g.pending ??
      g.active ??
      g.rejected ??
      g.archived?.[0] ??
      g.deleted ??
      g.versions[0] ??
      null;

    selectVersion(pick);
  };

  const onClickGroup = (g: PolicyDocGroup) => {
    safeSelectFirstVersion(g);
  };

  const onCreateDraft = () => {
    try {
      const docId = nextPolicyDocumentId(groups);

      const v = createDraft({
        documentId: docId,
        title: "새 사규/정책",
        version: 1,
        changeSummary: "초안 생성",
        actor,
      });

      selectVersion(v);
      showToast("neutral", "새 초안을 생성했습니다.");
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  const onCreateNextDraftFromLifecycle = (g: PolicyDocGroup) => {
    try {
      if (!canShowGroupActionButton(g)) {
        showToast(
          "warn",
          "해당 문서는 아직 적용/검토 이력이 없어 개정안(초안)을 만들 수 없습니다.",
        );
        return;
      }

      if (g.pending) {
        showToast("warn", "검토 대기(PENDING) 문서입니다. ‘검토안’으로 내용을 확인하세요.");
        selectVersion(g.pending);
        return;
      }

      if (g.draft) {
        selectVersion(g.draft);
        showToast("warn", "이미 개정안(초안)이 있습니다. 해당 개정안을 수정해주세요.");
        return;
      }

      const nextVer = suggestNextVersion(g.documentId);
      const v = createDraft({
        documentId: g.documentId,
        title: g.title,
        version: nextVer,
        changeSummary: "변경 사항 요약을 입력하세요.",
        actor,
      });

      selectVersion(v);
      showToast("neutral", "개정안(초안)을 생성했습니다.");
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  const onOpenPendingReadOnly = (g: PolicyDocGroup) => {
    if (!g.pending) return;
    selectVersion(g.pending);
  };

  const onOpenDraft = (g: PolicyDocGroup) => {
    if (!g.draft) return;
    selectVersion(g.draft);
  };

  const onClickGroupActionButton = (g: PolicyDocGroup) => {
    const btn = getGroupActionButtonState(g);
    if (!btn.show || btn.disabled) return;

    if (btn.mode === "VIEW_PENDING") {
      onOpenPendingReadOnly(g);
      return;
    }
    if (btn.mode === "GOTO_DRAFT") {
      onOpenDraft(g);
      return;
    }
    if (btn.mode === "CREATE_DRAFT") {
      onCreateNextDraftFromLifecycle(g);
      return;
    }
  };

  const onSaveDraft = () => {
    if (!selected || selected.status !== "DRAFT") return;

    try {
      const nextVersionNum = Number(draftForm.version);
      if (!Number.isFinite(nextVersionNum) || nextVersionNum <= 0) {
        showToast("warn", "버전은 1 이상의 숫자여야 합니다.");
        return;
      }

      updateDraft(selected.id, {
        actor,
        title: draftForm.title,
        changeSummary: draftForm.changeSummary,
        version: nextVersionNum,
      });

      showToast("neutral", "초안을 저장했습니다.");
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  // (2) fileInputRef / onFileSelected 제거 + 모달 open state
  const [filesModalOpen, setFilesModalOpen] = useState(false);
  const [jumpToPreprocessOnClose, setJumpToPreprocessOnClose] = useState(false);

  const onPickFile = () => {
    if (!selected || selected.status !== "DRAFT") return;
    setJumpToPreprocessOnClose(false);
    setFilesModalOpen(true);
  };

  const onRetryPreprocess = () => {
    if (!selected || selected.status !== "DRAFT") return;
    try {
      runPreprocess(selected.id, actor);
      showToast("neutral", "전처리를 재시도합니다.");
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  const canSubmitReview =
    selected?.status === "DRAFT" &&
    selected.preprocessStatus === "READY" &&
    reviewCheck.checkedBasics &&
    reviewCheck.checkedPreview;

  const onSubmitReview = () => {
    if (!selected || selected.status !== "DRAFT") return;

    try {
      submitReviewRequest(selected.id, actor);

      setRightTab("REVIEW");
      setReviewCheck({ checkedBasics: false, checkedPreview: false });
      setDraftForm({ documentId: "", title: "", version: "", changeSummary: "" });

      showToast("neutral", "검토 요청을 전송했습니다.");
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  // (4) 삭제 사유 모달 (DoD)
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({ open: false });
  const deleteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const openDeleteModal = () => {
    if (!selected) return;
    if (selected.status === "ACTIVE") return;
    setDeleteModal({ open: true, reason: "", error: undefined });
  };

  const closeDeleteModal = () => setDeleteModal({ open: false });

  // 모달 열릴 때 textarea 포커스 + ESC 전역 처리 보강
  useEffect(() => {
    if (!deleteModal.open) return;

    const t = window.setTimeout(() => {
      deleteTextareaRef.current?.focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDeleteModal();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [deleteModal.open]);

  const confirmDelete = () => {
    if (!selected) return;
    if (!deleteModal.open) return;

    const reason = deleteModal.reason.trim();
    if (!reason) {
      setDeleteModal((prev) =>
        prev.open ? { ...prev, error: "삭제 사유를 입력하세요." } : prev,
      );
      return;
    }

    try {
      softDelete(selected.id, actor, reason);
      showToast("neutral", "삭제 처리했습니다.");

      selectVersion(null);

      closeDeleteModal();
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  const right = selected;
  const rightId = right?.id ?? null;

  // 탭 전환 시 상단으로 (외부 시스템 동기화 → useEffect OK)
  useEffect(() => {
    rightBodyRef.current?.scrollTo({ top: 0 });
  }, [rightTab, rightId]);

  const sortedVersionsInGroup = useMemo(() => {
    if (!selectedGroup) return [];
    const list = selectedGroup.versions.slice();
    list.sort((a, b) => {
      const order = (s: PolicyDocStatus) => {
        if (s === "DRAFT") return 0;
        if (s === "PENDING_REVIEWER") return 1;
        if (s === "ACTIVE") return 2;
        if (s === "REJECTED") return 3;
        if (s === "ARCHIVED") return 4;
        if (s === "DELETED") return 5;
        return 6;
      };
      const oa = order(a.status);
      const ob = order(b.status);
      if (oa !== ob) return oa - ob;
      if (a.version !== b.version) return b.version - a.version;
      return safeTime(b.updatedAt) - safeTime(a.updatedAt);
    });
    return list;
  }, [selectedGroup]);

  const tabItems = useMemo(() => {
    const isDraft = right?.status === "DRAFT";
    return [
      { id: "OVERVIEW" as const, label: "요약" },
      { id: "DRAFT" as const, label: "초안", disabled: !isDraft },
      { id: "PREPROCESS" as const, label: "전처리" },
      { id: "REVIEW" as const, label: "검토" },
      { id: "HISTORY" as const, label: "히스토리" },
    ];
  }, [right?.status]);

  const onChangeVersionSelect = (id: string) => {
    const found =
      sortedVersionsInGroup.find((v) => v.id === id) ??
      versions.find((v) => v.id === id) ??
      getPolicyVersionSnapshot(id) ??
      null;

    // 선택이 가능한 상태에서만 호출되므로 대부분 found는 존재
    selectVersion(found);
  };

  const renderRightBody = () => {
    if (!right) return null;

    if (rightTab === "OVERVIEW") {
      return (
        <>
          <section className="cb-policy-card">
            <div className="cb-policy-card-title">문서 정보</div>

            <div className="cb-policy-detail-grid">
              <div className="row">
                <div className="k">버전</div>
                <div className="v">v{right.version}</div>
              </div>
              <div className="row">
                <div className="k">변경 요약</div>
                <div className="v">{right.changeSummary || "-"}</div>
              </div>
              <div className="row">
                <div className="k">파일</div>
                <div className="v">
                  {renderAttachmentSummary(right)}
                </div>
              </div>
              <div className="row">
                <div className="k">업데이트</div>
                <div className="v">{new Date(right.updatedAt).toLocaleString()}</div>
              </div>

              {right.status === "PENDING_REVIEWER" ? (
                <>
                  <div className="row">
                    <div className="k">검토 항목</div>
                    <div className="v">
                      <span className="mono">{right.reviewItemId || "-"}</span>
                    </div>
                  </div>
                  <div className="row">
                    <div className="k">검토 요청 시각</div>
                    <div className="v">
                      {right.reviewRequestedAt
                        ? new Date(right.reviewRequestedAt).toLocaleString()
                        : "-"}
                    </div>
                  </div>
                </>
              ) : null}

              {selectedGroup ? (
                <div className="row">
                  <div className="k">문서 상태</div>
                  <div className="v">
                    <span className="muted">
                      총 {selectedGroup.versions.length}개 버전 ·{" "}
                      {selectedGroup.active
                        ? `ACTIVE v${selectedGroup.active.version}`
                        : "ACTIVE 없음"}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="cb-policy-card">
            <div className="cb-policy-card-title">빠른 안내</div>
            <div className="cb-policy-empty">
              우측 상단에서 탭으로 <b>초안/전처리/검토/히스토리</b>를 전환할 수 있습니다.
              {right.status === "PENDING_REVIEWER" ? (
                <>
                  <br />
                  현재는 <b>검토 대기</b> 상태이므로 <b>검토</b> 탭에서 “검토안(읽기 전용)”을
                  확인하세요.
                </>
              ) : null}
            </div>
          </section>
        </>
      );
    }

    if (rightTab === "DRAFT") {
      if (right.status !== "DRAFT") {
        return <div className="cb-policy-empty">초안(DRAFT)에서만 편집이 가능합니다.</div>;
      }

      return (
        <section className="cb-policy-card">
          <div className="cb-policy-card-title">업로드/수정/교체 (초안)</div>

          <div className="cb-policy-form">
            <div className="field">
              <div className="label">document_id</div>
              <input className="cb-policy-input" value={draftForm.documentId} disabled />
            </div>

            <div className="field">
              <div className="label">title</div>
              <input
                className="cb-policy-input"
                value={draftForm.title}
                onChange={(e) => setDraftForm((s) => ({ ...s, title: e.target.value }))}
                placeholder="문서 제목"
              />
            </div>

            <div className="field">
              <div className="label">version</div>
              <input
                className="cb-policy-input"
                value={draftForm.version}
                onChange={(e) => setDraftForm((s) => ({ ...s, version: e.target.value }))}
                placeholder="숫자"
                inputMode="numeric"
              />
              {selectedGroup?.active ? (
                <div className="hint">
                  현재 ACTIVE: v{selectedGroup.active.version} (추천: v
                  {selectedGroup.active.version + 1})
                </div>
              ) : (
                <div className="hint">현재 ACTIVE 없음 (v1부터 시작)</div>
              )}
            </div>

            <div className="field full">
              <div className="label">change_summary</div>
              <textarea
                className="cb-policy-textarea"
                value={draftForm.changeSummary}
                onChange={(e) => setDraftForm((s) => ({ ...s, changeSummary: e.target.value }))}
                placeholder="변경 요약(필수)"
                rows={4}
              />
            </div>

            <div className="cb-policy-form-actions">
              <button type="button" className="cb-admin-primary-btn" onClick={onSaveDraft}>
                저장
              </button>

              <button type="button" className="cb-admin-ghost-btn" onClick={onPickFile}>
                파일 업로드/교체
              </button>
            </div>
          </div>
        </section>
      );
    }

    if (rightTab === "PREPROCESS") {
      return (
        <section className="cb-policy-card">
          <div className="cb-policy-card-title">스테이징 전처리 미리보기</div>

          <div className="cb-policy-preprocess">
            <div className="row">
              <div className="k">상태</div>
              <div className="v">
                <span
                  className={cx("cb-policy-pre-badge", `is-${right.preprocessStatus.toLowerCase()}`)}
                >
                  {right.preprocessStatus}
                </span>
                {right.preprocessStatus === "FAILED" && right.preprocessError ? (
                  <span className="err"> {right.preprocessError}</span>
                ) : null}
              </div>
            </div>

            {right.preprocessStatus === "READY" && right.preprocessPreview ? (
              <>
                <div className="row">
                  <div className="k">요약</div>
                  <div className="v">
                    {right.preprocessPreview.pages}p /{" "}
                    {right.preprocessPreview.chars.toLocaleString()} chars
                  </div>
                </div>
                <pre className="cb-policy-excerpt">{right.preprocessPreview.excerpt}</pre>
              </>
            ) : (
              <div className="cb-policy-empty muted">
                {right.preprocessStatus === "IDLE"
                  ? "파일 업로드 후 전처리를 실행하면 미리보기가 표시됩니다."
                  : right.preprocessStatus === "PROCESSING"
                    ? "전처리 진행 중…"
                    : right.preprocessStatus === "FAILED"
                      ? "전처리에 실패했습니다. 재업로드 또는 재시도하세요."
                      : "미리보기가 없습니다."}
              </div>
            )}

            {right.status === "DRAFT" && right.preprocessStatus === "FAILED" && (
              <div className="cb-policy-pre-actions">
                <button type="button" className="cb-admin-ghost-btn" onClick={onRetryPreprocess}>
                  전처리 재시도
                </button>
              </div>
            )}
          </div>
        </section>
      );
    }

    if (rightTab === "REVIEW") {
      if (right.status === "PENDING_REVIEWER") {
        return (
          <>
            <section className="cb-policy-card">
              <div className="cb-policy-card-title">검토안 (읽기 전용)</div>

              <div className="cb-policy-detail-grid">
                <div className="row">
                  <div className="k">상태</div>
                  <div className="v">
                    <StatusPill status={right.status} />
                  </div>
                </div>

                <div className="row">
                  <div className="k">검토 항목 ID</div>
                  <div className="v">
                    <span className="mono">{right.reviewItemId || "-"}</span>
                  </div>
                </div>

                <div className="row">
                  <div className="k">검토 요청 시각</div>
                  <div className="v">
                    {right.reviewRequestedAt
                      ? new Date(right.reviewRequestedAt).toLocaleString()
                      : "-"}
                  </div>
                </div>

                <div className="row">
                  <div className="k">버전</div>
                  <div className="v">v{right.version}</div>
                </div>

                <div className="row">
                  <div className="k">변경 요약</div>
                  <div className="v">{right.changeSummary || "-"}</div>
                </div>

                <div className="row">
                  <div className="k">파일</div>
                  <div className="v">
                    {renderAttachmentSummary(right)}
                  </div>
                </div>

                <div className="row">
                  <div className="k">업데이트</div>
                  <div className="v">{new Date(right.updatedAt).toLocaleString()}</div>
                </div>
              </div>

              <div className="cb-policy-empty muted" style={{ marginTop: 8 }}>
                검토 대기 중인 문서입니다. 이 화면에서는 편집할 수 없으며, 내용 확인만 가능합니다.
              </div>
            </section>

            <section className="cb-policy-card">
              <div className="cb-policy-card-title">검토안 내용 (전처리 미리보기)</div>

              {right.preprocessStatus === "READY" && right.preprocessPreview ? (
                <div className="cb-policy-preprocess">
                  <div className="row">
                    <div className="k">요약</div>
                    <div className="v">
                      {right.preprocessPreview.pages}p /{" "}
                      {right.preprocessPreview.chars.toLocaleString()} chars
                    </div>
                  </div>
                  <pre className="cb-policy-excerpt">{right.preprocessPreview.excerpt}</pre>
                </div>
              ) : (
                <div className="cb-policy-empty muted">
                  전처리 미리보기가 없습니다. (status={right.preprocessStatus})
                </div>
              )}
            </section>
          </>
        );
      }

      if (right.status !== "DRAFT") {
        return (
          <section className="cb-policy-card">
            <div className="cb-policy-card-title">1차 검토 / 검토요청</div>
            <div className="cb-policy-empty">초안(DRAFT)에서만 검토 요청이 가능합니다.</div>
          </section>
        );
      }

      return (
        <section className="cb-policy-card">
          <div className="cb-policy-card-title">1차 검토 / 검토요청</div>

          <div className="cb-policy-review-box">
            <label className="cb-policy-check">
              <input
                type="checkbox"
                checked={reviewCheck.checkedBasics}
                onChange={(e) =>
                  setReviewCheck((s) => ({ ...s, checkedBasics: e.target.checked }))
                }
              />
              <span>필수 입력(document_id/title/version/change_summary/파일) 확인</span>
            </label>

            <label className="cb-policy-check">
              <input
                type="checkbox"
                checked={reviewCheck.checkedPreview}
                onChange={(e) =>
                  setReviewCheck((s) => ({ ...s, checkedPreview: e.target.checked }))
                }
                disabled={right.preprocessStatus !== "READY"}
              />
              <span>전처리 미리보기 확인</span>
            </label>

            <div className="cb-policy-review-actions">
              <button
                type="button"
                className="cb-admin-primary-btn"
                onClick={onSubmitReview}
                disabled={!canSubmitReview}
                title={!canSubmitReview ? "체크/전처리 조건을 만족해야 합니다." : "검토 요청"}
              >
                검토요청
              </button>

              {right.preprocessStatus !== "READY" && (
                <div className="cb-policy-hint">전처리 미리보기가 READY여야 합니다.</div>
              )}
            </div>
          </div>
        </section>
      );
    }

    // HISTORY
    return (
      <section className="cb-policy-card">
        <div className="cb-policy-card-title">히스토리</div>
        {right.audit.length === 0 ? (
          <div className="cb-policy-empty">기록이 없습니다.</div>
        ) : (
          <div className="cb-policy-timeline">
            {right.audit
              .slice()
              .sort((a, b) => (a.at < b.at ? 1 : -1))
              .map((a) => (
                <div key={a.id} className="cb-policy-timeline-row">
                  <div className="t">{new Date(a.at).toLocaleString()}</div>
                  <div className="a">{a.action}</div>
                  <div className="m">
                    <span className="actor">{a.actor}</span>
                    {a.message ? <span className="msg">{a.message}</span> : null}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="cb-policy-root">
      {toast.open && (
        <div
          className={cx("cb-reviewer-toast", `cb-reviewer-toast--${toast.tone}`)}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}

      <div className="cb-policy-layout">
        <aside className="cb-policy-left">
          <div className="cb-policy-left-header">
            <div className="cb-policy-left-title">사규/정책 문서</div>

            <div className="cb-policy-left-actions">
              <button type="button" className="cb-admin-ghost-btn" onClick={onCreateDraft}>
                새 사규 업로드
              </button>
            </div>

            <div className="cb-policy-filters">
              <div className="cb-policy-filters-row">
                <input
                  className="cb-policy-input"
                  placeholder="document_id / 제목 검색"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>

              <div className="cb-policy-filters-row cb-policy-filters-row--2">
                <select
                  className="cb-policy-select"
                  value={statusFilter}
                  onChange={(e) => {
                    const v = e.target.value as PolicyDocStatus | "ALL";
                    setStatusFilter(v);
                    if (v === "ARCHIVED") setIncludeArchived(true);
                    if (v === "DELETED") setIncludeDeleted(true);
                  }}
                >
                  <option value="ALL">전체</option>
                  <option value="DRAFT">초안</option>
                  <option value="PENDING_REVIEWER">검토 대기</option>
                  <option value="ACTIVE">현재 적용중</option>
                  <option value="REJECTED">반려됨</option>
                  <option value="ARCHIVED">보관됨</option>
                  <option value="DELETED">삭제됨</option>
                </select>

                <select
                  className="cb-policy-select"
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                >
                  <option value="STATUS">정렬: 상태 우선</option>
                  <option value="DOCID_ASC">정렬: 문서ID</option>
                </select>
              </div>

              {statusFilter === "ALL" ? (
                <>
                  <div className="cb-policy-filters-row cb-policy-filters-row--toggles">
                    <label className="cb-policy-toggle">
                      <input
                        type="checkbox"
                        checked={includeArchived}
                        onChange={(e) => setIncludeArchived(e.target.checked)}
                      />
                      <span>보관 포함</span>
                    </label>
                    <label className="cb-policy-toggle">
                      <input
                        type="checkbox"
                        checked={includeDeleted}
                        onChange={(e) => setIncludeDeleted(e.target.checked)}
                      />
                      <span>삭제 포함</span>
                    </label>

                    <div className="cb-policy-result-count">
                      {filteredGroups.length.toLocaleString()}건
                    </div>
                  </div>

                  <div className="cb-policy-filter-hint">
                    보관/삭제 포함 옵션은 <b>상태: 전체</b>에서만 적용됩니다.
                  </div>
                </>
              ) : (
                <div className="cb-policy-filters-row cb-policy-filters-row--count-only">
                  <div className="cb-policy-filter-hint">
                    보관/삭제 포함 옵션은 <b>상태: 전체</b>에서만 적용됩니다.
                  </div>
                  <div className="cb-policy-result-count">
                    {filteredGroups.length.toLocaleString()}건
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="cb-policy-group-list">
            {filteredGroups.length === 0 ? (
              <div className="cb-policy-empty">조건에 해당하는 문서가 없습니다.</div>
            ) : (
              filteredGroups.map((g) => {
                const active = g.active;
                const draft = g.draft;
                const pending = g.pending;

                const representative =
                  draft ?? pending ?? active ?? g.rejected ?? g.archived?.[0] ?? g.deleted;

                const isSelected = Boolean(right && right.documentId === g.documentId);

                const actionBtn = getGroupActionButtonState(g);
                const metaChips = buildGroupMetaChips(g);

                return (
                  <div
                    key={g.documentId}
                    role="button"
                    tabIndex={0}
                    className={cx("cb-policy-group", isSelected && "is-selected")}
                    onClick={() => onClickGroup(g)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onClickGroup(g);
                      }
                    }}
                  >
                    <div className="cb-policy-group-top">
                      <div className="cb-policy-group-docid">{g.documentId}</div>

                      <div className="cb-policy-group-top-right">
                        {representative ? <StatusPill status={representative.status} /> : null}

                        {actionBtn.show ? (
                          <button
                            type="button"
                            className="cb-admin-mini-btn cb-policy-group-mini-btn"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onClickGroupActionButton(g);
                            }}
                            disabled={actionBtn.disabled}
                            title={actionBtn.title}
                          >
                            {actionBtn.label}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="cb-policy-group-title">{g.title}</div>

                    <div className="cb-policy-group-meta">
                      {metaChips.map((c) => (
                        <span key={c.key} className={cx("cb-policy-meta-chip", c.className)}>
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <main className="cb-policy-right">
          {!right ? (
            <div className="cb-policy-right-empty">
              <div>
                <div className="title">사규/정책을 선택하세요</div>
                <div className="desc">
                  좌측 목록에서 문서를 선택하면 상세/업로드/검토요청을 진행할 수 있습니다.
                </div>
              </div>
            </div>
          ) : (
            <div className="cb-policy-right-shell">
              <div className="cb-policy-right-head">
                <div className="cb-policy-right-head-top">
                  <div className="cb-policy-right-title">
                    <div className="docid">{right.documentId}</div>
                    <div className="name" title={right.title}>
                      {right.title}
                    </div>
                  </div>

                  <div className="cb-policy-right-head-badges">
                    <StatusPill status={right.status} />
                    {right.status === "ACTIVE" ? (
                      <span className="cb-reviewer-pill cb-reviewer-pill--neutral">현재 적용중</span>
                    ) : null}
                  </div>

                  <div className="cb-policy-right-head-actions">
                    <button
                      type="button"
                      className="cb-admin-ghost-btn"
                      onClick={openDeleteModal}
                      disabled={right.status === "ACTIVE"}
                      title={
                        right.status === "ACTIVE"
                          ? "현재 적용중 문서는 삭제할 수 없습니다."
                          : "삭제(soft)"
                      }
                    >
                      삭제
                    </button>
                  </div>
                </div>

                <div className="cb-policy-right-head-sub">
                  <div className="cb-policy-version-switcher">
                    <div className="label">버전 선택</div>
                    <select
                      className="cb-policy-select cb-policy-version-select"
                      value={right.id}
                      onChange={(e) => onChangeVersionSelect(e.target.value)}
                      disabled={sortedVersionsInGroup.length === 0}
                    >
                      {sortedVersionsInGroup.map((v) => (
                        <option key={v.id} value={v.id}>
                          {`v${v.version} · ${v.status} · ${new Date(v.updatedAt).toLocaleDateString()}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="cb-policy-tabs" role="tablist" aria-label="Policy detail tabs">
                    {tabItems.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={rightTab === t.id}
                        className={cx("cb-policy-tab", rightTab === t.id && "is-active")}
                        onClick={() => setRightTab(t.id)}
                        disabled={Boolean(t.disabled)}
                        title={t.disabled ? "초안(DRAFT)에서만 사용 가능합니다." : t.label}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="cb-policy-right-body" ref={rightBodyRef}>
                {renderRightBody()}
              </div>
            </div>
          )}
        </main>
      </div>

      <ProjectFilesModal
        open={filesModalOpen}
        title="문서 업로드"
        accept=".pdf,.doc,.docx,.ppt,.pptx,.hwp,.hwpx"
        files={policyFiles}
        disabled={!selected || selected.status !== "DRAFT"}
        onClose={() => {
          setFilesModalOpen(false);

          if (jumpToPreprocessOnClose) {
            setRightTab("PREPROCESS");
            setJumpToPreprocessOnClose(false);
          }
        }}
        onAddFiles={(fs) => {
          if (!selected || selected.status !== "DRAFT") return;
          try {
            attachFilesToDraft(selected.id, fs, actor);
            runPreprocess(selected.id, actor);

            setJumpToPreprocessOnClose(true);

            showToast(
              "neutral",
              "파일 업로드 완료 · 전처리를 시작했습니다. (닫으면 전처리 탭으로 이동)",
            );
          } catch (e) {
            const t = mapPolicyError(e);
            showToast(t.tone, t.message);
          }
        }}
        onRemoveFile={(id) => {
          if (!selected || selected.status !== "DRAFT") return;
          try {
            removeFileFromDraft(selected.id, id, actor);
            const next = getPolicyVersionSnapshot(selected.id);
            const hasAny = (next?.attachments?.length ?? 0) > 0;
            if (hasAny) {
              runPreprocess(selected.id, actor);
              setJumpToPreprocessOnClose(true);
            }
            showToast("neutral", "파일이 삭제되었습니다.");
          } catch (e) {
            const t = mapPolicyError(e);
            showToast(t.tone, t.message);
          }
        }}
      />

      {deleteModal.open && (
        <div
          className="cb-reviewer-modal-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDeleteModal();
          }}
        >
          <div className="cb-reviewer-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="cb-reviewer-modal-title">삭제 사유 입력</div>
            <div className="cb-reviewer-modal-desc">
              삭제는 복구 정책에 따라 제한될 수 있습니다. 사유는 감사 로그에 남습니다. (필수)
            </div>

            <div style={{ marginTop: 10 }}>
              <textarea
                ref={deleteTextareaRef}
                className="cb-reviewer-textarea"
                value={deleteModal.reason}
                onChange={(e) =>
                  setDeleteModal((prev) =>
                    prev.open ? { ...prev, reason: e.target.value, error: undefined } : prev,
                  )
                }
                placeholder="삭제 사유를 입력하세요. (필수)"
              />
            </div>

            {deleteModal.error && <div className="cb-reviewer-error">{deleteModal.error}</div>}

            <div className="cb-reviewer-modal-actions">
              <button type="button" className="cb-reviewer-ghost-btn" onClick={closeDeleteModal}>
                취소
              </button>
              <button
                type="button"
                className="cb-reviewer-danger-btn"
                onClick={confirmDelete}
                disabled={!deleteModal.reason.trim()}
              >
                삭제 실행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
