// src/components/dashboard/components/tabs/AdminPolicyTab.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "../../../chatbot/chatbot.css";
import {
  PolicyStoreError,
  type PolicyDocGroup,
  type PolicyDocStatus,
  type PolicyDocVersion,
  type PolicyAttachment,
} from "../../../chatbot/policyTypes";
import ProjectFilesModal, {
  type ProjectFileItem,
} from "../../../chatbot/ProjectFilesModal";
import {
  listPolicies,
  getPolicy,
  getPolicyVersion,
  createPolicy,
  createVersion,
  updateVersion,
  updateStatus,
  getS3PresignedUploadUrl,
  uploadFileToS3,
  retryPreprocess,
  getPreprocessPreview,
  replaceFile,
  type PolicyListItem,
  type VersionSummary,
  type VersionDetail,
  type PolicyDetailResponse,
  type CreateVersionRequest,
  type PreprocessPreviewResponse,
} from "../../api/ragApi";

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

type Toast =
  | { open: false }
  | { open: true; tone: "neutral" | "warn" | "danger"; message: string };

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
      return {
        tone: "warn",
        message: err.message || "처리할 수 없는 상태입니다.",
      };
    if (err.status >= 500)
      return {
        tone: "danger",
        message: "처리가 실패했습니다. 다시 시도하거나 관리자에게 문의",
      };

    return {
      tone: "warn",
      message: err.message || "요청을 처리할 수 없습니다.",
    };
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
        `cb-reviewer-pill--status-${status}`
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

function renderAttachmentSummary(
  v: PolicyDocVersion,
  pendingFileUrl?: string | null,
  pendingFileInfo?: { name: string; sizeBytes: number } | null
) {
  // pendingFileUrl이 있으면 우선 표시 (파일 업로드 후 저장 전 상태)
  if (pendingFileUrl && pendingFileInfo) {
    const sizeText = pendingFileInfo.sizeBytes
      ? ` ${formatBytes(pendingFileInfo.sizeBytes)}`
      : "";
    return (
      <>
        {pendingFileInfo.name}
        <span className="muted">{sizeText}</span>
      </>
    );
  }

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

type RightTab = "OVERVIEW" | "DRAFT" | "PREPROCESS" | "REVIEW";

function safeTime(v?: string) {
  const t = v ? new Date(v).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * - 현재 스토어 상태(groups)로부터 "결정적"으로 다음 문서 ID를 생성한다.
 */
function nextPolicyDocumentId(groups: PolicyDocGroup[]) {
  const existing = new Set(groups.map((g) => g.documentId.toUpperCase()));
  const now = new Date();
  
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  let candidate = `POL-${timestamp}`;
  
  // 중복 시 밀리초 추가
  let suffix = 0;
  while (existing.has(candidate.toUpperCase())) {
    suffix += 1;
    candidate = `POL-${timestamp}-${suffix}`;
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
    ? {
        key: "deleted",
        label: "DELETED",
        className: "cb-policy-meta-chip--danger",
      }
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
    return {
      show: false,
      label: "개정안",
      disabled: true,
      title: "",
      mode: "NONE",
    };
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
      title:
        "이미 개정안(초안)이 있습니다. 클릭하면 해당 개정안으로 이동합니다.",
      mode: "GOTO_DRAFT",
    };
  }

  if (
    g.deleted &&
    !g.active &&
    !g.rejected &&
    (!g.archived || g.archived.length === 0)
  ) {
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

function defaultRightTabForStatus(
  status: PolicyDocStatus | null | undefined
): RightTab {
  if (status === "DRAFT") return "DRAFT";
  if (status === "PENDING_REVIEWER") return "REVIEW";
  return "OVERVIEW";
}

/**
 * API 상태를 PolicyDocStatus로 변환
 */
function mapApiStatusToPolicyStatus(status: string): PolicyDocStatus {
  switch (status.toUpperCase()) {
    case "DRAFT":
      return "DRAFT";
    case "PENDING":
      return "PENDING_REVIEWER";
    case "ACTIVE":
      return "ACTIVE";
    case "ARCHIVED":
      return "ARCHIVED";
    case "REJECTED":
      return "REJECTED";
    case "DELETED":
      return "DELETED";
    default:
      return "DRAFT";
  }
}

/**
 * VersionDetail을 PolicyDocVersion으로 변환
 */
function convertVersionDetailToPolicyDocVersion(
  v: VersionDetail
): PolicyDocVersion {
  // sourceUrl에서 파일명 추출
  const fileName = v.sourceUrl
    ? v.sourceUrl.split("/").pop() || undefined
    : undefined;

  // attachments 구성 (API에서 제공하지 않으면 기본값)
  const attachments: PolicyAttachment[] = v.sourceUrl
    ? [
        {
          id: v.id,
          name: fileName || "파일",
          sizeBytes: undefined,
          mime: undefined,
          uploadedAt: v.createdAt,
        },
      ]
    : [];

  // 전처리 미리보기 구성
  const preprocessPreview =
    v.preprocessStatus === "READY" &&
    (v.preprocessPages !== undefined ||
      v.preprocessChars !== undefined ||
      v.preprocessExcerpt)
      ? {
          pages: v.preprocessPages || 0,
          chars: v.preprocessChars || 0,
          excerpt: v.preprocessExcerpt || "",
        }
      : undefined;

  return {
    id: v.id,
    documentId: v.documentId,
    title: v.title,
    version: v.version,
    changeSummary: v.changeSummary || "",
    status: mapApiStatusToPolicyStatus(v.status),
    attachments,
    fileName,
    fileSizeBytes: undefined,
    sourceUrl: v.sourceUrl,
    preprocessStatus: (v.preprocessStatus || "IDLE") as
      | "IDLE"
      | "PROCESSING"
      | "READY"
      | "FAILED",
    preprocessError: v.preprocessError,
    preprocessPreview,
    reviewRequestedAt: v.reviewRequestedAt,
    reviewItemId: v.reviewItemId,
    indexingStatus: "IDLE",
    indexingError: undefined,
    createdAt: v.createdAt,
    updatedAt: v.processedAt || v.createdAt,
    archivedAt: v.status === "ARCHIVED" ? v.createdAt : undefined,
    activatedAt: v.status === "ACTIVE" ? v.createdAt : undefined,
    deletedAt: undefined,
    rejectedAt: undefined,
    rejectReason: undefined,
    audit: [], // 히스토리는 별도 API로 조회
  };
}

/**
 * PolicyDetailResponse를 PolicyDocGroup으로 변환
 */
function convertPolicyDetailToGroup(
  detail: PolicyDetailResponse
): PolicyDocGroup {
  const versions = detail.versions.map((v) =>
    convertVersionDetailToPolicyDocVersion(v)
  );

  const active = versions.find((v) => v.status === "ACTIVE");
  const draft = versions.find((v) => v.status === "DRAFT");
  const pending = versions.find((v) => v.status === "PENDING_REVIEWER");
  const rejected = versions.find((v) => v.status === "REJECTED");
  const deleted = versions.find((v) => v.status === "DELETED");
  const archived = versions.filter((v) => v.status === "ARCHIVED");

  return {
    documentId: detail.documentId,
    title: detail.title,
    active,
    draft,
    pending,
    rejected,
    archived,
    deleted,
    versions,
  };
}

/**
 * VersionSummary를 PolicyDocVersion으로 변환 (목록용, 최소 정보만)
 */
function convertVersionSummaryToPolicyDocVersion(
  item: PolicyListItem,
  vs: VersionSummary
): PolicyDocVersion {
  // VersionSummary에는 id가 없으므로 documentId와 version으로 임시 ID 생성
  const tempId = `${item.documentId}-v${vs.version}`;

  return {
    id: tempId,
    documentId: item.documentId,
    title: item.title,
    version: vs.version,
    changeSummary: "",
    status: mapApiStatusToPolicyStatus(vs.status),
    attachments: [],
    fileName: undefined,
    fileSizeBytes: undefined,
    preprocessStatus: "IDLE",
    preprocessError: undefined,
    preprocessPreview: undefined,
    reviewRequestedAt: undefined,
    reviewItemId: undefined,
    indexingStatus: "IDLE",
    indexingError: undefined,
    createdAt: vs.createdAt,
    updatedAt: vs.createdAt,
    archivedAt: vs.status === "ARCHIVED" ? vs.createdAt : undefined,
    activatedAt: vs.status === "ACTIVE" ? vs.createdAt : undefined,
    deletedAt: undefined,
    rejectedAt: undefined,
    rejectReason: undefined,
    audit: [],
  };
}

/**
 * PolicyListItem을 PolicyDocGroup으로 변환 (목록용, 최소 정보만)
 */
function convertPolicyListItemToGroup(item: PolicyListItem): PolicyDocGroup {
  const versions = item.versions.map((vs) =>
    convertVersionSummaryToPolicyDocVersion(item, vs)
  );

  const active = versions.find((v) => v.status === "ACTIVE");
  const draft = versions.find((v) => v.status === "DRAFT");
  const pending = versions.find((v) => v.status === "PENDING_REVIEWER");
  const rejected = versions.find((v) => v.status === "REJECTED");
  const deleted = versions.find((v) => v.status === "DELETED");
  const archived = versions.filter((v) => v.status === "ARCHIVED");

  return {
    documentId: item.documentId,
    title: item.title,
    active,
    draft,
    pending,
    rejected,
    archived,
    deleted,
    versions,
  };
}

/**
 * PolicyListItem 배열을 PolicyDocGroup 배열로 변환
 * 목록 정보만 사용 (각 사규마다 getPolicy 호출하지 않음)
 */
function convertPolicyListToGroups(items: PolicyListItem[]): PolicyDocGroup[] {
  return items.map((item) => convertPolicyListItemToGroup(item));
}

export default function AdminPolicyTab() {
  const [groups, setGroups] = useState<PolicyDocGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [toast, setToast] = useState<Toast>({ open: false });
  const toastTimerRef = useRef<number | null>(null);

  // 검색 및 필터 상태
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState(""); // 실제 검색에 사용되는 쿼리 (debounced)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    undefined
  );
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 페이징 상태
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize] = useState(10); // 페이지 크기 고정
  const [totalItems, setTotalItems] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] =
    useState<PolicyDocVersion | null>(null);
  const [isNewVersionPending, setIsNewVersionPending] = useState(false);

  // 파일 업로드 관련 상태
  const [filesModalOpen, setFilesModalOpen] = useState(false);
  const [jumpToPreprocessOnClose, setJumpToPreprocessOnClose] = useState(false);
  const [pendingFileUrl, setPendingFileUrl] = useState<string | null>(null);
  const [pendingFileInfo, setPendingFileInfo] = useState<{
    name: string;
    sizeBytes: number;
  } | null>(null);
  const [pendingFileVersionId, setPendingFileVersionId] = useState<
    string | null
  >(null);

  // 전처리 미리보기 관련 상태
  const [preprocessPreview, setPreprocessPreview] =
    useState<PreprocessPreviewResponse | null>(null);
  const [preprocessPreviewLoading, setPreprocessPreviewLoading] =
    useState(false);
  const [preprocessPreviewError, setPreprocessPreviewError] = useState<
    string | null
  >(null);

  // 검색어 debounce: 입력이 멈춘 후 800ms 후에 검색 실행
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(search);
    }, 800);

    return () => clearTimeout(timer);
  }, [search]);

  // 데이터 로드
  const fetchPolicies = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // status 필터 변환: PENDING_REVIEWER -> PENDING
      const statusParam =
        statusFilter === "PENDING_REVIEWER" ? "PENDING" : statusFilter;

      const response = await listPolicies({
        search: searchQuery || undefined,
        status: statusParam,
        page: currentPage,
        size: pageSize,
      });

      // 목록 정보만으로 그룹 구성 (각 사규마다 getPolicy 호출하지 않음)
      const convertedGroups = convertPolicyListToGroups(response.items);

      // 기존 groups에서 상세 정보가 있는 그룹들은 유지하고, 새 그룹이나 변경된 그룹만 업데이트
      setGroups((prevGroups) => {
        const prevGroupsByDocId = new Map(
          prevGroups.map((g) => [g.documentId, g])
        );

        // 새로 가져온 그룹들로 업데이트하되, 기존에 상세 정보가 있으면 유지
        return convertedGroups.map((newGroup) => {
          const existingGroup = prevGroupsByDocId.get(newGroup.documentId);

          // 기존 그룹이 있고, 버전 수가 같고, 버전 상태가 모두 일치하면 상세 정보 유지
          if (existingGroup) {
            // 버전 수와 상태를 비교하여 실제로 변경되었는지 확인
            const versionsMatch =
              existingGroup.versions.length === newGroup.versions.length &&
              existingGroup.versions.every((existingVersion, idx) => {
                const newVersion = newGroup.versions[idx];
                return (
                  existingVersion.version === newVersion.version &&
                  existingVersion.status === newVersion.status
                );
              });

            // 버전이 변경되지 않았고, 기존 그룹에 상세 정보가 있으면 유지
            // (상세 정보는 sourceUrl이나 attachments 등이 있는 것으로 판단)
            if (versionsMatch) {
              const hasDetailedInfo = existingGroup.versions.some(
                (v) =>
                  v.sourceUrl || (v.attachments && v.attachments.length > 0)
              );

              if (hasDetailedInfo) {
                // 제목만 업데이트 (제목이 변경되었을 수 있음)
                return {
                  ...existingGroup,
                  title: newGroup.title,
                };
              }
            }
          }

          // 새 그룹이거나 변경된 경우 새 정보 사용
          return newGroup;
        });
      });

      setTotalItems(response.total);
    } catch (err) {
      console.error("Failed to fetch policies:", err);
      setError("사규 목록을 불러오는데 실패했습니다.");
      const t = mapPolicyError(err);
      showToast(t.tone, t.message);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, currentPage, pageSize]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  // 검색어나 필터 변경 시 첫 페이지로 리셋
  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery, statusFilter]);

  // 선택된 버전 로드
  useEffect(() => {
    if (!selectedId) {
      setSelectedVersion(null);
      return;
    }

    // 임시 버전 ID인 경우 건너뛰기 (이미 selectedVersion에 설정되어 있음)
    if (selectedId.startsWith("temp-")) {
      return;
    }

    // groups에서 찾기
    for (const group of groups) {
      const found = group.versions.find((v) => v.id === selectedId);
      if (found) {
        setSelectedVersion(found);
        return;
      }
    }

    // groups에 없으면 API에서 직접 조회
    const loadVersion = async () => {
      try {
        // selectedId에서 documentId와 version 추출
        // selectedId는 "documentId-version" 형식일 수 있음
        // 또는 UUID일 수 있음
        // 일단 groups에서 찾지 못했으면 API로 조회 시도
        // 하지만 documentId와 version을 알아야 함
        // 일단 groups에서 찾지 못하면 null로 설정
        setSelectedVersion(null);
      } catch (err) {
        console.error("Failed to load version:", err);
        setSelectedVersion(null);
      }
    };

    loadVersion();
  }, [selectedId, groups]);

  const selected = selectedVersion;

  const selectedGroup = useMemo<PolicyDocGroup | null>(() => {
    if (!selected) return null;
    return groups.find((g) => g.documentId === selected.documentId) ?? null;
  }, [selected, groups]);

  // (3) 모달용 파일 목록 구성
  const policyFiles: ProjectFileItem[] = useMemo(() => {
    if (!selected) return [];
    const atts = selected.attachments ?? [];
    const files = atts.map((a, idx) => ({
      id: a.id,
      name: a.name,
      sizeBytes: a.sizeBytes,
      meta: idx === 0 ? "기본" : undefined,
    }));

    // pendingFileUrl이 있고 현재 선택된 버전과 일치하는 경우에만 임시 파일 추가
    if (
      pendingFileUrl &&
      pendingFileInfo &&
      pendingFileVersionId === selected.id
    ) {
      files.push({
        id: `pending-${Date.now()}`, // 임시 ID
        name: pendingFileInfo.name,
        sizeBytes: pendingFileInfo.sizeBytes,
        meta: "업로드 완료",
      });
    }

    return files;
  }, [selected, pendingFileUrl, pendingFileInfo, pendingFileVersionId]);

  // API 응답 순서 유지
  const filteredGroups = groups;

  const showToast = (tone: "neutral" | "warn" | "danger", message: string) => {
    setToast({ open: true, tone, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(
      () => setToast({ open: false }),
      2400
    );
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

  // 우측: “섹션 탭”으로 길이 폭증 방지
  const [rightTab, setRightTab] = useState<RightTab>("OVERVIEW");
  const rightBodyRef = useRef<HTMLDivElement | null>(null);
  const selectVersion = (v: PolicyDocVersion | null) => {
    setSelectedId(v?.id ?? null);
    setSelectedVersion(v);

    // 선택된 버전이 변경되면 다른 버전의 pending 상태 초기화
    if (v && pendingFileVersionId && pendingFileVersionId !== v.id) {
      setPendingFileUrl(null);
      setPendingFileInfo(null);
      setPendingFileVersionId(null);
    }

    const nextTab = defaultRightTabForStatus(v?.status);
    setRightTab(nextTab);

    // 새 버전이 아니면 isNewVersionPending 초기화
    if (v && v.version !== 0) {
      setIsNewVersionPending(false);
    }

    if (v && v.status === "DRAFT") {
      setDraftForm({
        documentId: v.documentId,
        title: v.title,
        version: v.version === 0 ? "" : String(v.version),
        changeSummary: v.changeSummary,
      });
    } else {
      setDraftForm({
        documentId: "",
        title: "",
        version: "",
        changeSummary: "",
      });
    }
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

  const onClickGroup = async (g: PolicyDocGroup) => {
    try {
      // API로 최신 사규 정보 조회
      const detail = await getPolicy(g.documentId);
      const updatedGroup = convertPolicyDetailToGroup(detail);

      // groups 상태 업데이트
      setGroups((prevGroups) =>
        prevGroups.map((prevGroup) =>
          prevGroup.documentId === g.documentId ? updatedGroup : prevGroup
        )
      );

      // 업데이트된 그룹의 첫 번째 버전 선택
      safeSelectFirstVersion(updatedGroup);
    } catch (e) {
      console.error("Failed to fetch policy:", e);
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
      // 에러가 발생해도 기존 그룹으로 선택
      safeSelectFirstVersion(g);
    }
  };

  const onCreateDraft = async () => {
    try {
      let docId = nextPolicyDocumentId(groups);
      let attempts = 0;
      const maxAttempts = 10; // 최대 10번까지 재시도

      while (attempts < maxAttempts) {
        try {
          const response = await createPolicy({
            documentId: docId,
            title: "새 사규/정책",
            domain: "사내규정", // 사규 문서는 항상 POLICY 도메인
            changeSummary: "초안 생성",
          });

          // 목록 새로고침 (새 사규가 목록에 포함되도록)
          await fetchPolicies();

          // 새로 생성된 버전 정보 가져오기
          const detail = await getPolicyVersion(docId, response.version);
          const version = convertVersionDetailToPolicyDocVersion(detail);

          // 선택된 버전과 ID 설정 (순서 중요: ID를 먼저 설정하면 useEffect가 실행될 수 있음)
          setSelectedId(version.id);
          setSelectedVersion(version);

          // groups 업데이트: 새로 생성된 사규가 현재 페이지에 있으면 업데이트
          const policyDetail = await getPolicy(docId);
          const updatedGroup = convertPolicyDetailToGroup(policyDetail);
          setGroups((prevGroups) => {
            const existingIndex = prevGroups.findIndex(
              (g) => g.documentId === docId
            );
            if (existingIndex >= 0) {
              // 이미 목록에 있으면 업데이트
              const next = [...prevGroups];
              next[existingIndex] = updatedGroup;
              return next;
            }
            // 목록에 없으면 추가 (현재 페이지에 표시되지 않을 수도 있음)
            return [updatedGroup, ...prevGroups];
          });

          showToast("neutral", "새 초안을 생성했습니다.");
          return; // 성공 시 함수 종료
        } catch (createError: unknown) {
          // 409 Conflict 에러이고 "already exists" 메시지가 있으면 다음 ID로 재시도
          const error = createError as { status?: number; message?: string };
          if (
            error?.status === 409 &&
            (error?.message?.includes("already exists") ||
              error?.message?.includes("이미 존재"))
          ) {
            attempts += 1;
            // 다음 ID 생성
            const match = /^POL-(\d+)$/i.exec(docId);
            if (match) {
              const num = parseInt(match[1], 10);
              docId = `POL-${String(num + 1).padStart(4, "0")}`;
            } else {
              // 형식이 맞지 않으면 기본값에서 증가
              docId = `POL-${String(attempts + 1).padStart(4, "0")}`;
            }
            continue; // 재시도
          }
          // 다른 에러는 그대로 throw
          throw createError;
        }
      }

      // 최대 시도 횟수 초과
      showToast(
        "danger",
        "사규 ID를 생성하는데 실패했습니다. 다시 시도해주세요."
      );
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  const onCreateNextDraftFromLifecycle = async (g: PolicyDocGroup) => {
    try {
      if (!canShowGroupActionButton(g)) {
        showToast(
          "warn",
          "해당 문서는 아직 적용/검토 이력이 없어 개정안(초안)을 만들 수 없습니다."
        );
        return;
      }

      if (g.pending) {
        showToast(
          "warn",
          "검토 대기(PENDING) 문서입니다. ‘검토안’으로 내용을 확인하세요."
        );
        setSelectedVersion(g.pending);
        setSelectedId(g.pending.id);
        return;
      }

      if (g.draft) {
        setSelectedVersion(g.draft);
        setSelectedId(g.draft.id);
        showToast(
          "warn",
          "이미 개정안(초안)이 있습니다. 해당 개정안을 수정해주세요."
        );
        return;
      }

      const response = await createVersion(g.documentId, {
        changeSummary: "변경 사항 요약을 입력하세요.",
      });

      // 목록 새로고침
      await fetchPolicies();

      // 새로 생성된 버전 정보 가져오기
      const detail = await getPolicyVersion(g.documentId, response.version);
      const version = convertVersionDetailToPolicyDocVersion(detail);

      // groups 업데이트: 새로 생성된 버전이 포함되도록
      const policyDetail = await getPolicy(g.documentId);
      const updatedGroup = convertPolicyDetailToGroup(policyDetail);
      setGroups((prevGroups) =>
        prevGroups.map((prevGroup) =>
          prevGroup.documentId === g.documentId ? updatedGroup : prevGroup
        )
      );

      // 선택된 버전과 ID 설정
      setSelectedId(version.id);
      setSelectedVersion(version);

      showToast("neutral", "개정안(초안)을 생성했습니다.");
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  const onCreateNewVersion = () => {
    if (!selectedGroup) return;

    // 이미 DRAFT가 있으면 경고하고 해당 DRAFT로 이동
    if (selectedGroup.draft) {
      setSelectedVersion(selectedGroup.draft);
      setSelectedId(selectedGroup.draft.id);
      showToast(
        "warn",
        "이미 개정안(초안)이 있습니다. 해당 개정안을 수정해주세요."
      );
      return;
    }

    // 임시 버전 객체 생성 (API 호출 없이)
    const tempVersion: PolicyDocVersion = {
      id: `temp-${selectedGroup.documentId}-new`,
      documentId: selectedGroup.documentId,
      version: 0, // 임시 값
      status: "DRAFT",
      title: "",
      changeSummary: "변경 사항 요약을 입력하세요.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attachments: [],
      preprocessStatus: "IDLE",
      preprocessPages: undefined,
      preprocessChars: undefined,
      preprocessExcerpt: undefined,
      preprocessError: undefined,
      reviewRequestedAt: undefined,
      reviewItemId: undefined,
      indexingStatus: "IDLE",
      indexingError: undefined,
      audit: [],
    };

    setSelectedVersion(tempVersion);
    setSelectedId(tempVersion.id);
    setIsNewVersionPending(true);
    setRightTab("DRAFT"); // 초안 탭으로 이동

    // draftForm 초기화 (폼이 표시되도록)
    setDraftForm({
      documentId: tempVersion.documentId,
      title: tempVersion.title,
      version: "", // 새 버전이므로 빈 문자열
      changeSummary: tempVersion.changeSummary,
    });

    showToast(
      "neutral",
      "새 버전을 작성해주세요. 저장 버튼을 눌러 생성됩니다."
    );
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

  const onDeleteDraft = async () => {
    if (!selected || selected.status !== "DRAFT") return;

    // 임시 버전(version === 0 또는 temp-로 시작하는 ID)인 경우
    const isTemporaryVersion =
      selected.version === 0 || selected.id.startsWith("temp-");

    if (isTemporaryVersion) {
      // 임시 버전은 서버에 저장되지 않았으므로 그냥 선택 해제
      showToast(
        "neutral",
        `작성 중인 초안을 취소합니다. (${selected.documentId})`
      );

      // 선택 해제
      setSelectedVersion(null);
      setSelectedId(null);
      setRightTab("OVERVIEW");
      setDraftForm({
        documentId: "",
        title: "",
        version: "",
        changeSummary: "",
      });

      // pending 상태 초기화
      setPendingFileUrl(null);
      setPendingFileInfo(null);
      setPendingFileVersionId(null);
      setIsNewVersionPending(false);

      return;
    }

    // 저장된 초안 삭제
    showToast(
      "neutral",
      `초안을 삭제합니다. (${selected.documentId} v${selected.version})`
    );

    try {
      // 상태를 DELETED로 변경
      await updateStatus(selected.documentId, selected.version, {
        status: "DELETED",
      });

      // 목록 새로고침
      await fetchPolicies();

      // 선택 해제
      setSelectedVersion(null);
      setSelectedId(null);
      setRightTab("OVERVIEW");
      setDraftForm({
        documentId: "",
        title: "",
        version: "",
        changeSummary: "",
      });

      // pending 상태 초기화
      setPendingFileUrl(null);
      setPendingFileInfo(null);
      setPendingFileVersionId(null);
      setIsNewVersionPending(false);

      showToast("neutral", "초안을 삭제했습니다.");
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  const onSaveDraft = async () => {
    if (!selected || selected.status !== "DRAFT") return;

    console.log("onSaveDraft - pendingFileUrl:", pendingFileUrl);
    console.log("onSaveDraft - isNewVersionPending:", isNewVersionPending);

    try {
      // 새 버전 생성 대기 중이면 createVersion 호출
      if (isNewVersionPending) {
        const requestData: CreateVersionRequest = {
          title: draftForm.title || undefined,
          changeSummary: draftForm.changeSummary || undefined,
        };

        // version이 입력되어 있으면 숫자로 변환하여 포함
        if (draftForm.version && draftForm.version.trim()) {
          const versionNum = parseInt(draftForm.version, 10);
          if (!isNaN(versionNum)) {
            requestData.version = versionNum;
          }
        }

        console.log("pendingFileUrl data:", pendingFileUrl);

        // pendingFileUrl이 있으면 fileUrl 포함 (빈 문자열 체크 포함)
        if (pendingFileUrl && pendingFileUrl.trim()) {
          requestData.fileUrl = pendingFileUrl;
        }

        console.log("Creating new version with data:", requestData);
        const response = await createVersion(selected.documentId, requestData);

        setIsNewVersionPending(false);

        // 새 버전 생성 후 pendingFileUrl과 pendingFileInfo 초기화
        setPendingFileUrl(null);
        setPendingFileInfo(null);
        setPendingFileVersionId(null);

        // 목록 새로고침
        await fetchPolicies();

        // 저장한 사규가 계속 보이도록 선택 상태 유지
        // 전체 사규 정보를 가져와서 업데이트하고 저장한 버전 선택
        const detail = await getPolicy(selected.documentId);
        const updatedGroup = convertPolicyDetailToGroup(detail);

        // groups 상태 업데이트 (해당 사규가 현재 페이지에 있으면 업데이트)
        setGroups((prevGroups) =>
          prevGroups.map((prevGroup) =>
            prevGroup.documentId === selected.documentId
              ? updatedGroup
              : prevGroup
          )
        );

        // 저장한 버전 선택 (response.version 사용)
        const savedVersion = updatedGroup.versions.find(
          (v) => v.version === response.version
        );
        if (savedVersion) {
          setSelectedVersion(savedVersion);
          setSelectedId(savedVersion.id);
        }

        showToast("neutral", "새 버전을 생성했습니다.");
      } else {
        // 기존 버전 업데이트
        const updateData: {
          title?: string;
          changeSummary?: string;
          fileUrl?: string;
        } = {
          title: draftForm.title,
          changeSummary: draftForm.changeSummary,
        };

        // pendingFileUrl이 있으면 fileUrl 포함
        if (pendingFileUrl) {
          updateData.fileUrl = pendingFileUrl;
        }

        await updateVersion(selected.documentId, selected.version, updateData);

        // 업데이트된 버전 정보 가져오기
        const detail = await getPolicyVersion(
          selected.documentId,
          selected.version
        );
        const updatedVersion = convertVersionDetailToPolicyDocVersion(detail);

        setSelectedVersion(updatedVersion);

        // pendingFileUrl과 pendingFileInfo 초기화
        setPendingFileUrl(null);
        setPendingFileInfo(null);
        setPendingFileVersionId(null);

        // 목록 새로고침
        await fetchPolicies();

        // 저장한 사규가 계속 보이도록 선택 상태 유지
        // 전체 사규 정보를 가져와서 업데이트하고 저장한 버전 선택
        const policyDetail = await getPolicy(selected.documentId);
        const updatedGroup = convertPolicyDetailToGroup(policyDetail);
        setGroups((prevGroups) =>
          prevGroups.map((prevGroup) =>
            prevGroup.documentId === selected.documentId
              ? updatedGroup
              : prevGroup
          )
        );

        // 저장한 버전 선택
        const savedVersion = updatedGroup.versions.find(
          (v) => v.version === updatedVersion.version
        );
        if (savedVersion) {
          setSelectedVersion(savedVersion);
          setSelectedId(savedVersion.id);
        }

        showToast("neutral", "초안을 저장했습니다.");
      }
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  const onPickFile = () => {
    if (!selected || selected.status !== "DRAFT") return;

    // 모달을 열 때 다른 버전의 pending 상태가 남아있지 않도록 확인
    // selected가 변경되면 pendingFileUrl도 해당 버전의 것인지 확인하고,
    // 다른 버전의 것이면 초기화해야 함
    // 하지만 pendingFileUrl은 선택된 버전과 무관하게 유지되므로,
    // 실제로는 파일 업로드 시 선택된 버전과 일치하는지 확인하는 것이 더 안전

    setJumpToPreprocessOnClose(false);
    setFilesModalOpen(true);
  };

  const onRetryPreprocess = async () => {
    if (!selected || selected.status !== "DRAFT") return;
    try {
      await retryPreprocess(selected.documentId, selected.version);
      showToast("neutral", "전처리를 재시도합니다.");
      // 데이터 새로고침
      await fetchPolicies();
      // 선택된 버전 다시 로드
      if (selectedId) {
        const version = await getPolicyVersion(
          selected.documentId,
          selected.version
        );
        const converted = convertVersionDetailToPolicyDocVersion(version);
        setSelectedVersion(converted);
      }
    } catch (e) {
      const t = mapPolicyError(e);
      showToast(t.tone, t.message);
    }
  };

  // preprocessPreview의 최신 상태도 함께 확인
  const currentPreprocessStatus =
    preprocessPreview?.preprocessStatus || selected?.preprocessStatus;
  const canSubmitReview =
    selected?.status === "DRAFT" && currentPreprocessStatus === "READY";

  const onSubmitReview = async () => {
    // preprocessPreview의 최신 상태도 함께 확인
    const currentPreprocessStatus =
      preprocessPreview?.preprocessStatus || selected?.preprocessStatus;
    console.log("onSubmitReview called", {
      selected: selected?.documentId,
      status: selected?.status,
      preprocessStatus: selected?.preprocessStatus,
      preprocessPreviewStatus: preprocessPreview?.preprocessStatus,
      currentPreprocessStatus,
      canSubmitReview,
    });
    if (
      !selected ||
      selected.status !== "DRAFT" ||
      currentPreprocessStatus !== "READY"
    ) {
      console.log("Early return:", {
        hasSelected: !!selected,
        status: selected?.status,
        preprocessStatus: selected?.preprocessStatus,
        preprocessPreviewStatus: preprocessPreview?.preprocessStatus,
        currentPreprocessStatus,
      });
      return;
    }
    console.log("Proceeding with review request...");

    try {
      await updateStatus(selected.documentId, selected.version, {
        status: "PENDING",
      });

      // 업데이트된 버전 정보 가져오기
      const detail = await getPolicyVersion(
        selected.documentId,
        selected.version
      );
      const updatedVersion = convertVersionDetailToPolicyDocVersion(detail);

      setSelectedVersion(updatedVersion);
      setRightTab("REVIEW");
      setDraftForm({
        documentId: "",
        title: "",
        version: "",
        changeSummary: "",
      });

      await fetchPolicies(); // 목록 새로고침

      showToast("neutral", "검토 요청을 전송했습니다.");
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

  // PREPROCESS 탭에서 전처리 미리보기 로드
  useEffect(() => {
    if (rightTab === "PREPROCESS" && selected && selected.version > 0) {
      const loadPreprocessPreview = async () => {
        try {
          setPreprocessPreviewLoading(true);
          setPreprocessPreviewError(null);
          const preview = await getPreprocessPreview(
            selected.documentId,
            selected.version
          );
          setPreprocessPreview(preview);
        } catch (err) {
          console.error("Failed to load preprocess preview:", err);
          setPreprocessPreviewError(
            "전처리 미리보기를 불러오는데 실패했습니다."
          );
          setPreprocessPreview(null);
        } finally {
          setPreprocessPreviewLoading(false);
        }
      };

      loadPreprocessPreview();
    } else {
      // PREPROCESS 탭이 아니거나 선택된 버전이 없으면 상태 초기화
      setPreprocessPreview(null);
      setPreprocessPreviewError(null);
    }
  }, [rightTab, selected]);

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
    ];
  }, [right?.status]);

  const onChangeVersionSelect = (id: string) => {
    const found = sortedVersionsInGroup.find((v) => v.id === id) ?? null;

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
                  {renderAttachmentSummary(
                    right,
                    pendingFileUrl,
                    pendingFileInfo
                  )}
                </div>
              </div>
              <div className="row">
                <div className="k">업데이트</div>
                <div className="v">
                  {new Date(right.updatedAt).toLocaleString()}
                </div>
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

          {/* 전처리 미리보기가 있으면 표시 */}
          {right.preprocessStatus === "READY" && right.preprocessPreview ? (
            <section className="cb-policy-card">
              <div className="cb-policy-card-title">사규 내용 미리보기</div>
              <div className="cb-policy-preprocess">
                <div className="row">
                  <div className="k">요약</div>
                  <div className="v">
                    {right.preprocessPreview.pages}p /{" "}
                    {right.preprocessPreview.chars.toLocaleString()} chars
                  </div>
                </div>
                <pre className="cb-policy-excerpt">
                  {right.preprocessPreview.excerpt}
                </pre>
              </div>
            </section>
          ) : null}

          {/* 파일이 있으면 다운로드 링크 표시 */}
          {pendingFileUrl ||
          right.fileName ||
          right.sourceUrl ||
          (right.attachments && right.attachments.length > 0) ? (
            <section className="cb-policy-card">
              <div className="cb-policy-card-title">파일</div>
              <div className="cb-policy-detail-grid">
                <div className="row">
                  <div className="k">파일</div>
                  <div className="v">
                    {pendingFileUrl && pendingFileInfo ? (
                      <span>
                        {pendingFileInfo.name}
                        {pendingFileInfo.sizeBytes
                          ? ` (${formatBytes(pendingFileInfo.sizeBytes)})`
                          : ""}
                      </span>
                    ) : right.sourceUrl ? (
                      <a
                        href={right.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cb-policy-file-link"
                      >
                        {right.fileName || "파일 다운로드"}
                        {right.fileSizeBytes
                          ? ` (${formatBytes(right.fileSizeBytes)})`
                          : ""}
                      </a>
                    ) : (
                      renderAttachmentSummary(right)
                    )}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <section className="cb-policy-card">
            <div className="cb-policy-card-title">빠른 안내</div>
            <div className="cb-policy-empty">
              우측 상단에서 탭으로 <b>초안/전처리/검토/히스토리</b>를 전환할 수
              있습니다.
              {right.status === "PENDING_REVIEWER" ? (
                <>
                  <br />
                  현재는 <b>검토 대기</b> 상태이므로 <b>검토</b> 탭에서
                  "검토안(읽기 전용)"을 확인하세요.
                </>
              ) : null}
            </div>
          </section>
        </>
      );
    }

    if (rightTab === "DRAFT") {
      if (right.status !== "DRAFT") {
        return (
          <div className="cb-policy-empty">
            초안(DRAFT)에서만 편집이 가능합니다.
          </div>
        );
      }

      return (
        <section className="cb-policy-card cb-policy-card--with-delete">
          <div className="cb-policy-card-title">업로드/수정/교체 (초안)</div>

          <div className="cb-policy-form">
            <div className="field">
              <div className="label">document_id</div>
              <input
                className="cb-policy-input"
                value={draftForm.documentId}
                disabled
              />
            </div>

            <div className="field">
              <div className="label">title</div>
              <input
                className="cb-policy-input"
                value={draftForm.title}
                onChange={(e) =>
                  setDraftForm((s) => ({ ...s, title: e.target.value }))
                }
                placeholder="문서 제목"
              />
            </div>

            <div className="field">
              <div className="label">version</div>
              <input
                className="cb-policy-input"
                value={draftForm.version}
                onChange={(e) =>
                  setDraftForm((s) => ({ ...s, version: e.target.value }))
                }
                placeholder="숫자"
                inputMode="numeric"
              />
              {selectedGroup?.active ? (
                <div className="hint">
                  현재 ACTIVE: v{selectedGroup.active.version} (추천: v
                  {selectedGroup.active.version + 1})
                </div>
              ) : (
                <div className="hint">현재 ACTIVE 없음(v1부터 시작)</div>
              )}
            </div>

            <div className="field full">
              <div className="label">change_summary</div>
              <textarea
                className="cb-policy-textarea"
                value={draftForm.changeSummary}
                onChange={(e) =>
                  setDraftForm((s) => ({ ...s, changeSummary: e.target.value }))
                }
                placeholder="변경 요약(필수)"
                rows={4}
              />
            </div>

            <div className="cb-policy-form-actions">
              <button
                type="button"
                className="cb-admin-primary-btn"
                onClick={onSaveDraft}
              >
                저장
              </button>

              <button
                type="button"
                className="cb-admin-ghost-btn"
                onClick={onPickFile}
              >
                파일 업로드/교체
              </button>
            </div>
          </div>

          <button
            type="button"
            className="cb-policy-delete-btn"
            onClick={onDeleteDraft}
          >
            삭제
          </button>
        </section>
      );
    }

    if (rightTab === "PREPROCESS") {
      const status =
        preprocessPreview?.preprocessStatus || right.preprocessStatus || "IDLE";

      return (
        <section className="cb-policy-card">
          <div className="cb-policy-card-title">전처리 미리보기</div>

          <div className="cb-policy-preprocess">
            <div className="row">
              <div className="k">상태</div>
              <div className="v">
                <span
                  className={cx(
                    "cb-policy-pre-badge",
                    `is-${status.toLowerCase()}`
                  )}
                >
                  {status}
                </span>
                {status === "FAILED" && preprocessPreviewError ? (
                  <span className="err"> {preprocessPreviewError}</span>
                ) : null}
              </div>
            </div>

            {preprocessPreviewLoading ? (
              <div className="cb-policy-empty muted">로딩 중...</div>
            ) : preprocessPreviewError ? (
              <div className="cb-policy-empty muted" style={{ color: "red" }}>
                {preprocessPreviewError}
              </div>
            ) : preprocessPreview &&
              (preprocessPreview.preprocessPages !== null ||
                preprocessPreview.preprocessChars !== null ||
                preprocessPreview.preprocessExcerpt) ? (
              <>
                {preprocessPreview.preprocessPages !== null &&
                  preprocessPreview.preprocessPages !== undefined && (
                    <div className="row">
                      <div className="k">페이지 수</div>
                      <div className="v">
                        {preprocessPreview.preprocessPages.toLocaleString()}p
                      </div>
                    </div>
                  )}
                {preprocessPreview.preprocessChars !== null &&
                  preprocessPreview.preprocessChars !== undefined && (
                    <div className="row">
                      <div className="k">문자 수</div>
                      <div className="v">
                        {preprocessPreview.preprocessChars.toLocaleString()}{" "}
                        chars
                      </div>
                    </div>
                  )}
                {preprocessPreview.preprocessExcerpt && (
                  <div className="row">
                    <div className="k">미리보기</div>
                    <div className="v">
                      <pre className="cb-policy-excerpt">
                        {preprocessPreview.preprocessExcerpt}
                      </pre>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="cb-policy-empty muted">
                {status === "IDLE"
                  ? "파일 업로드 후 전처리를 실행하면 미리보기가 표시됩니다."
                  : status === "PROCESSING"
                  ? "전처리 진행 중…"
                  : status === "FAILED"
                  ? "전처리에 실패했습니다. 재업로드 또는 재시도하세요."
                  : "미리보기가 없습니다."}
              </div>
            )}

            {right.status === "DRAFT" && status === "FAILED" && (
              <div className="cb-policy-pre-actions">
                <button
                  type="button"
                  className="cb-admin-ghost-btn"
                  onClick={async () => {
                    await onRetryPreprocess();
                    // 재시도 후 미리보기 다시 로드
                    if (selected && selected.version > 0) {
                      try {
                        setPreprocessPreviewLoading(true);
                        setPreprocessPreviewError(null);
                        const preview = await getPreprocessPreview(
                          selected.documentId,
                          selected.version
                        );
                        setPreprocessPreview(preview);
                      } catch (err) {
                        console.error(
                          "Failed to reload preprocess preview:",
                          err
                        );
                        setPreprocessPreviewError(
                          "전처리 미리보기를 불러오는데 실패했습니다."
                        );
                      } finally {
                        setPreprocessPreviewLoading(false);
                      }
                    }
                  }}
                >
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
                    {renderAttachmentSummary(
                      right,
                      pendingFileUrl,
                      pendingFileInfo
                    )}
                  </div>
                </div>

                <div className="row">
                  <div className="k">업데이트</div>
                  <div className="v">
                    {new Date(right.updatedAt).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="cb-policy-empty muted" style={{ marginTop: 8 }}>
                검토 대기 중인 문서입니다. 이 화면에서는 편집할 수 없으며, 내용
                확인만 가능합니다.
              </div>
            </section>

            <section className="cb-policy-card">
              <div className="cb-policy-card-title">
                검토안 내용 (전처리 미리보기)
              </div>

              {right.preprocessStatus === "READY" && right.preprocessPreview ? (
                <div className="cb-policy-preprocess">
                  <div className="row">
                    <div className="k">요약</div>
                    <div className="v">
                      {right.preprocessPreview.pages}p /{" "}
                      {right.preprocessPreview.chars.toLocaleString()} chars
                    </div>
                  </div>
                  <pre className="cb-policy-excerpt">
                    {right.preprocessPreview.excerpt}
                  </pre>
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
            <div className="cb-policy-card-title">검토요청</div>
            <div className="cb-policy-empty">
              초안(DRAFT)에서만 검토 요청이 가능합니다.
            </div>
          </section>
        );
      }

      return (
        <section className="cb-policy-card">
          <div className="cb-policy-card-title">검토요청</div>

          <div className="cb-policy-review-box">
            <div className="cb-policy-review-actions">
              {right.preprocessStatus !== "READY" && (
                <div className="cb-policy-hint">
                  전처리 미리보기가 READY여야 합니다.
                </div>
              )}

              <button
                type="button"
                className="cb-admin-primary-btn"
                onClick={onSubmitReview}
                disabled={!canSubmitReview}
                title={
                  !canSubmitReview
                    ? "전처리 상태가 READY여야 합니다."
                    : "검토 요청"
                }
              >
                검토요청
              </button>
            </div>
          </div>
        </section>
      );
    }

    return null;
  };

  if (loading) {
    return (
      <div className="cb-policy-root">
        <div style={{ padding: "2rem", textAlign: "center" }}>로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cb-policy-root">
        <div style={{ padding: "2rem", textAlign: "center", color: "red" }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="cb-policy-root">
      {toast.open && (
        <div
          className={cx(
            "cb-reviewer-toast",
            `cb-reviewer-toast--${toast.tone}`
          )}
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
              <button
                type="button"
                className="cb-admin-ghost-btn"
                onClick={onCreateDraft}
              >
                새 사규 업로드
              </button>
            </div>

            <div className="cb-policy-filters">
              <div className="cb-policy-filters-row">
                <input
                  ref={searchInputRef}
                  className="cb-policy-input"
                  placeholder="document_id / 제목 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="cb-policy-filters-row">
                <select
                  className="cb-policy-select"
                  value={statusFilter || ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setStatusFilter(v === "" ? undefined : v);
                  }}
                >
                  <option value="">전체</option>
                  <option value="DRAFT">초안</option>
                  <option value="PENDING">검토 대기</option>
                  <option value="ACTIVE">현재 적용중</option>
                  <option value="REJECTED">반려됨</option>
                  <option value="ARCHIVED">보관됨</option>
                </select>
              </div>
            </div>
          </div>

          {/* 페이징 컨트롤 (상단) */}
          {!loading && totalItems > 0 && (
            <div className="cb-policy-pagination">
              <div className="cb-policy-pagination-controls">
                <button
                  type="button"
                  className="cb-admin-ghost-btn"
                  onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  title="이전 페이지"
                >
                  «
                </button>
                <span className="cb-policy-pagination-page">
                  {currentPage + 1} / {Math.ceil(totalItems / pageSize)}
                </span>
                <button
                  type="button"
                  className="cb-admin-ghost-btn"
                  onClick={() =>
                    setCurrentPage((p) =>
                      Math.min(Math.ceil(totalItems / pageSize) - 1, p + 1)
                    )
                  }
                  disabled={currentPage >= Math.ceil(totalItems / pageSize) - 1}
                  title="다음 페이지"
                >
                  »
                </button>
              </div>
            </div>
          )}

          <div className="cb-policy-group-list">
            {filteredGroups.length === 0 ? (
              <div className="cb-policy-empty">
                조건에 해당하는 문서가 없습니다.
              </div>
            ) : (
              filteredGroups.map((g) => {
                const active = g.active;
                const draft = g.draft;
                const pending = g.pending;

                const representative =
                  draft ??
                  pending ??
                  active ??
                  g.rejected ??
                  g.archived?.[0] ??
                  g.deleted;

                const isSelected = Boolean(
                  right && right.documentId === g.documentId
                );

                const actionBtn = getGroupActionButtonState(g);
                const metaChips = buildGroupMetaChips(g);

                return (
                  <div
                    key={g.documentId}
                    role="button"
                    tabIndex={0}
                    className={cx(
                      "cb-policy-group",
                      isSelected && "is-selected"
                    )}
                    onClick={() => onClickGroup(g)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onClickGroup(g);
                      }
                    }}
                  >
                    <div className="cb-policy-group-top">
                      <div className="cb-policy-group-docid">
                        {g.documentId}
                      </div>

                      <div className="cb-policy-group-top-right">
                        {representative ? (
                          <StatusPill status={representative.status} />
                        ) : null}

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
                        <span
                          key={c.key}
                          className={cx("cb-policy-meta-chip", c.className)}
                        >
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
                  좌측 목록에서 문서를 선택하면 상세/업로드/검토요청을 진행할 수
                  있습니다.
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
                      <span className="cb-reviewer-pill cb-reviewer-pill--neutral">
                        현재 적용중
                      </span>
                    ) : null}
                  </div>

                  <div className="cb-policy-right-head-actions"></div>
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
                          {`v${v.version} · ${v.status} · ${new Date(
                            v.updatedAt
                          ).toLocaleDateString()}`}
                        </option>
                      ))}
                    </select>
                    {selectedGroup ? (
                      <button
                        type="button"
                        className="cb-admin-ghost-btn cb-policy-version-add-btn"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onCreateNewVersion();
                        }}
                        disabled={false}
                        title="새 버전(DRAFT)을 생성합니다."
                      >
                        + 새 버전 추가
                      </button>
                    ) : null}
                  </div>

                  <div
                    className="cb-policy-tabs"
                    role="tablist"
                    aria-label="Policy detail tabs"
                  >
                    {tabItems.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={rightTab === t.id}
                        className={cx(
                          "cb-policy-tab",
                          rightTab === t.id && "is-active"
                        )}
                        onClick={() => setRightTab(t.id)}
                        disabled={Boolean(t.disabled)}
                        title={
                          t.disabled
                            ? "초안(DRAFT)에서만 사용 가능합니다."
                            : t.label
                        }
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
        onClose={async () => {
          // 모달을 닫을 때는 파일 URL을 유지하고 모달만 닫기
          // 실제 DB 반영은 저장 버튼을 눌렀을 때 수행됨
          setFilesModalOpen(false);

          // jumpToPreprocessOnClose가 설정되어 있으면 전처리 탭으로 이동
          if (jumpToPreprocessOnClose) {
            setRightTab("PREPROCESS");
            setJumpToPreprocessOnClose(false);
          }
        }}
        onAddFiles={async (fs) => {
          if (!selected || selected.status !== "DRAFT") {
            return fs.map((f) => ({
              key: `${f.name}__${f.size}`,
              ok: false,
              errorMessage: "초안 상태가 아닙니다.",
            }));
          }
          try {
            if (fs.length === 0) return [];

            // 여러 파일을 순차적으로 업로드
            const results: Array<{
              key: string;
              ok: boolean;
              errorMessage?: string;
            }> = [];

            for (const file of fs) {
              try {
                // 1. S3 Presigned URL 발급
                const presignResponse = await getS3PresignedUploadUrl({
                  filename: file.name,
                  contentType: file.type || "application/octet-stream",
                  type: "docs", // 사규 문서는 docs 타입
                });

                // 2. Presigned URL로 S3에 파일 업로드
                await uploadFileToS3(presignResponse.uploadUrl, file);

                // S3 업로드 성공 - DB 반영은 저장 버튼에서 처리
                // 첫 번째 파일만 pending 상태로 저장
                if (results.length === 0) {
                  setPendingFileUrl(presignResponse.fileUrl);
                  setPendingFileInfo({
                    name: file.name,
                    sizeBytes: file.size,
                  });
                  setPendingFileVersionId(selected.id);
                }
                results.push({
                  key: `${file.name}__${file.size}`,
                  ok: true,
                });
              } catch (fileError) {
                const t = mapPolicyError(fileError);
                results.push({
                  key: `${file.name}__${file.size}`,
                  ok: false,
                  errorMessage: t.message,
                });
              }
            }

            // 업로드 성공 시 토스트 메시지 표시 (DB 반영은 저장 버튼에서)
            if (results.some((r) => r.ok)) {
              const successCount = results.filter((r) => r.ok).length;
              if (successCount === fs.length) {
                showToast(
                  "neutral",
                  `${successCount}개 파일이 업로드되었습니다. 저장 버튼을 눌러 반영하세요.`
                );
              } else {
                showToast(
                  "warn",
                  `${successCount}/${fs.length}개 파일이 업로드되었습니다. 저장 버튼을 눌러 반영하세요.`
                );
              }
            }

            return results;
          } catch (e) {
            const t = mapPolicyError(e);
            showToast(t.tone, t.message);

            // 실패 결과 반환
            return fs.map((f) => ({
              key: `${f.name}__${f.size}`,
              ok: false,
              errorMessage: t.message,
            }));
          }
        }}
        onRemoveFile={async (fileId: string) => {
          if (!selected || selected.status !== "DRAFT") return;
          try {
            // pending 파일 삭제 (아직 저장되지 않은 파일)
            if (fileId.startsWith("pending-")) {
              setPendingFileUrl(null);
              setPendingFileInfo(null);
              setPendingFileVersionId(null);
              showToast("neutral", "파일이 삭제되었습니다.");
              return;
            }

            // 저장된 파일 삭제
            const attachments = selected.attachments ?? [];
            const fileToRemove = attachments.find((a) => a.id === fileId);

            if (!fileToRemove) {
              showToast("warn", "삭제할 파일을 찾을 수 없습니다.");
              return;
            }

            // 버전이 이미 존재하는 경우
            if (selected.version > 0) {
              // 파일 삭제는 현재 API에서 완전히 지원되지 않음
              // 백엔드에 파일 삭제 API 구현이 필요함
              // 현재는 updateVersion이나 replaceFile로는 개별 파일 삭제가 불가능
              // updateVersion에 빈 값이나 동일한 값을 보내면 "no fields to update" 에러 발생
              showToast(
                "warn",
                "파일 삭제는 현재 API에서 지원되지 않습니다. 백엔드에 파일 삭제 API 구현이 필요합니다."
              );
              return;
            } else {
              // 새 버전(version === 0)인 경우 pending 상태만 초기화
              if (pendingFileVersionId === selected.id) {
                setPendingFileUrl(null);
                setPendingFileInfo(null);
                setPendingFileVersionId(null);
              }
              showToast("neutral", "파일이 삭제되었습니다.");
            }
          } catch (e) {
            const t = mapPolicyError(e);
            showToast(t.tone, t.message);
          }
        }}
      />
    </div>
  );
}
