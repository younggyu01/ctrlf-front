// src/components/chatbot/ReviewerDetail.tsx
import React, {
  useState,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { DetailTabId } from "./useReviewerDeskController";
import type { ReviewWorkItem } from "./reviewerDeskTypes";
import { formatDateTime, formatDuration } from "./creatorStudioUtils";
import keycloak from "../../keycloak";
import { resolveEducationVideoUrl } from "./educationServiceApi";

import {
  listPolicyVersionsSnapshot,
  subscribePolicyStore,
} from "./policyStore";
import type { PolicyDocVersion } from "./policyTypes";
import CreatorScriptSceneEditor from "./CreatorScriptSceneEditor";

const EDU_BASE = String(
  (import.meta.env as unknown as Record<string, unknown>).VITE_EDU_API_BASE ??
    "/api-edu"
).replace(/\/$/, "");

async function fetchVideoSourceFileUrl(
  videoId: string,
  init?: Pick<RequestInit, "signal">
): Promise<string> {
  const id = String(videoId ?? "").trim();
  if (!id) throw new Error("[ReviewerDetail] videoId가 비어 있습니다.");

  // keycloak 토큰 준비
  if (keycloak?.authenticated && typeof keycloak.updateToken === "function") {
    try {
      await keycloak.updateToken(30);
    } catch {
      // 토큰 갱신 실패는 무시
    }
  }

  const headers = new Headers();
  headers.set("accept", "application/json");
  if (keycloak?.token) headers.set("Authorization", `Bearer ${keycloak.token}`);

  const res = await fetch(`${EDU_BASE}/video/${encodeURIComponent(id)}`, {
    method: "GET",
    headers,
    signal: init?.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[ReviewerDetail] GET /video/${id} 실패: HTTP ${res.status} ${
        res.statusText
      }${text ? ` - ${text.slice(0, 200)}` : ""}`
    );
  }

  const body = (await res.json().catch(() => null)) as unknown as {
    fileUrl?: unknown;
  } | null;
  const src = typeof body?.fileUrl === "string" ? body.fileUrl.trim() : "";
  if (!src)
    throw new Error(
      "[ReviewerDetail] fileUrl이 없습니다. (/video/{id} 응답 확인 필요)"
    );
  return src;
}

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

function statusLabel(s: ReviewWorkItem["status"]) {
  switch (s) {
    case "REVIEW_PENDING":
      return "검토 대기";
    case "APPROVED":
      return "승인됨";
    case "REJECTED":
      return "반려됨";
  }
}

function statusTone(
  s: ReviewWorkItem["status"]
): "neutral" | "warn" | "danger" {
  switch (s) {
    case "REVIEW_PENDING":
      return "warn";
    case "APPROVED":
      return "neutral";
    case "REJECTED":
      return "danger";
  }
}

function categoryLabel(c: ReviewWorkItem["contentCategory"]) {
  switch (c) {
    case "MANDATORY":
      return "4대 의무교육";
    case "JOB":
      return "직무교육";
    case "POLICY":
      return "사규/정책";
    case "OTHER":
      return "기타";
  }
}

function renderStatusPill(s: ReviewWorkItem["status"]) {
  const tone = statusTone(s);
  return (
    <span className={cx("cb-reviewer-pill", `cb-reviewer-pill--${tone}`)}>
      {statusLabel(s)}
    </span>
  );
}

function renderCategoryPill(c: ReviewWorkItem["contentCategory"]) {
  return (
    <span className={cx("cb-reviewer-pill", "cb-reviewer-pill--neutral")}>
      {categoryLabel(c)}
    </span>
  );
}

function renderPiiPill(autoCheck: ReviewWorkItem["autoCheck"] | undefined) {
  const level = autoCheck?.piiRiskLevel ?? "none";
  const tone =
    level === "high" ? "danger" : level === "medium" ? "warn" : "neutral";

  const label =
    level === "high"
      ? "PII HIGH"
      : level === "medium"
      ? "PII MED"
      : level === "low"
      ? "PII LOW"
      : "PII NONE";

  return (
    <span className={cx("cb-reviewer-pill", `cb-reviewer-pill--${tone}`)}>
      {label}
    </span>
  );
}

function getVideoStage(it: ReviewWorkItem): 1 | 2 | null {
  if (it.contentType !== "VIDEO") return null;

  // reviewStage 필드를 우선 확인 (백엔드에서 명시적으로 설정한 값 사용)
  if (it.reviewStage === "FINAL") return 2;
  if (it.reviewStage === "SCRIPT") return 1;

  // reviewStage가 없으면 videoUrl로 판단 (하위 호환성)
  return it.videoUrl?.trim() ? 2 : 1;
}

function stageLabelShort(stage: 1 | 2) {
  return stage === 2 ? "2차" : "1차";
}

function stageLabelLong(stage: 1 | 2) {
  return stage === 2 ? "2차(최종)" : "1차(스크립트)";
}

function isPolicyDoc(it: ReviewWorkItem) {
  return it.contentType === "POLICY_DOC" || it.contentCategory === "POLICY";
}

function preprocessLabel(v?: PolicyDocVersion): OpsChip {
  if (!v)
    return {
      label: "전처리: 미연동",
      tone: "neutral",
      tooltip:
        "처리 상태를 불러올 수 없습니다. (백엔드/스토어 미연동 또는 policyVersionId 연결 누락)",
    };

  switch (v.preprocessStatus) {
    case "READY":
      return { label: "전처리: READY", tone: "neutral" };
    case "PROCESSING":
      return { label: "전처리: 처리 중", tone: "warn" };
    case "FAILED":
      return { label: "전처리: 실패", tone: "danger" };
    default:
      return { label: "전처리: 대기", tone: "neutral" };
  }
}

function indexingLabel(v?: PolicyDocVersion): OpsChip {
  if (!v)
    return {
      label: "인덱싱: 미연동",
      tone: "neutral",
      tooltip:
        "처리 상태를 불러올 수 없습니다. (백엔드/스토어 미연동 또는 policyVersionId 연결 누락)",
    };

  switch (v.indexingStatus) {
    case "DONE":
      return { label: "인덱싱: 완료", tone: "neutral" };
    case "INDEXING":
      return { label: "인덱싱: 진행 중", tone: "warn" };
    case "FAILED":
      return { label: "인덱싱: 실패", tone: "danger" };
    default:
      return { label: "인덱싱: 대기", tone: "neutral" };
  }
}

export interface ReviewerDetailProps {
  isBusy: boolean;
  isOverlayOpen: boolean;

  detailTab: DetailTabId;
  setDetailTab: (t: DetailTabId) => void;

  selectedItem: ReviewWorkItem | null;

  notesById: Record<string, string>;
  setNotesById: React.Dispatch<React.SetStateAction<Record<string, string>>>;

  onSaveNote: () => void;
  onOpenPreview: () => void;

  /** POLICY_DOC: 인덱싱 재시도(2차 확인은 ReviewerDeskView overlay에서 처리) */
  onRequestPolicyRetryIndexing?: (reviewItemId: string) => void;

  /** POLICY_DOC: 롤백(2차 확인/사유 입력은 ReviewerDeskView overlay에서 처리) */
  onRequestPolicyRollback?: (input: {
    documentId: string;
    targetVersionId: string;
    targetVersionLabel: string;
  }) => void;
}

/**
 * 롤백 사유는 ReviewerDeskView overlay에서 받는 구조이므로
 * Detail에서는 "선택된 archived 버전 id"만 관리한다.
 */
type RollbackDraft = { itemId: string | null; archivedId: string };

type OpsChip = {
  label: string;
  tone: "neutral" | "warn" | "danger";
  tooltip?: string;
};

const ReviewerDetail: React.FC<ReviewerDetailProps> = ({
  isBusy,
  isOverlayOpen,
  detailTab,
  setDetailTab,
  selectedItem,
  notesById: _notesById,
  setNotesById: _setNotesById,
  onSaveNote: _onSaveNote,
  onOpenPreview,
  onRequestPolicyRetryIndexing,
  onRequestPolicyRollback,
}) => {
  // 현재 미사용이지만 향후 노트 기능 구현 시 사용 예정
  void _notesById;
  void _setNotesById;
  void _onSaveNote;
  // Hooks는 반드시 early return 이전에 호출되어야 함
  const policyVersions = useSyncExternalStore(
    subscribePolicyStore,
    listPolicyVersionsSnapshot
  );

  // effect 없이 "선택 item별"로 롤백 선택을 스코프
  const [rollbackDraft, setRollbackDraft] = useState<RollbackDraft>({
    itemId: null,
    archivedId: "",
  });

  // 2차(최종) 검토 단계에서 "영상 미리보기"를 위해 s3:// → presign 변환 지원
  type VideoResolveSnapshot = {
    raw: string;
    resolvedUrl: string;
    error: string;
  };
  const [videoResolve, setVideoResolve] = useState<VideoResolveSnapshot>({
    raw: "",
    resolvedUrl: "",
    error: "",
  });

  type VideoSourceSnapshot = {
    videoId: string;
    sourceFileUrl: string;
    error: string;
  };
  const [videoSource, setVideoSource] = useState<VideoSourceSnapshot>({
    videoId: "",
    sourceFileUrl: "",
    error: "",
  });

  const scopedItemId = selectedItem?.id ?? null;

  const selectedArchivedId =
    rollbackDraft.itemId === scopedItemId ? rollbackDraft.archivedId : "";

  const setRollbackArchivedId = (archivedId: string) => {
    const itemId = selectedItem?.id ?? null;
    setRollbackDraft((prev) => {
      // item이 바뀌면 자동 초기화(효과적으로 reset)
      if (prev.itemId !== itemId) return { itemId, archivedId };
      return { ...prev, itemId, archivedId };
    });
  };

  // scriptId 추출 - Hook은 early return 이전에 호출되어야 함
  const isPolicy = selectedItem ? isPolicyDoc(selectedItem) : false;

  // scriptId 추출 (VIDEO 타입에서 스크립트 표시용)
  const scriptId = useMemo(() => {
    if (!selectedItem || isPolicy || selectedItem.contentType !== "VIDEO") {
      return "";
    }
    const any = selectedItem as unknown as Record<string, unknown>;
    return typeof any.scriptId === "string" && any.scriptId.trim()
      ? any.scriptId.trim()
      : "";
  }, [selectedItem, isPolicy]);

  const stage = useMemo(() => {
    if (!selectedItem) return null;
    return getVideoStage(selectedItem);
  }, [selectedItem]);

  const isFinalVideoPreview =
    !!selectedItem && selectedItem.contentType === "VIDEO" && stage === 2;
  const videoIdForFinalPreview = isFinalVideoPreview
    ? selectedItem?.id ?? ""
    : "";

  // 미리보기(2차): GET /video/{videoId}로 sourceFileUrl 조회
  useEffect(() => {
    if (!videoIdForFinalPreview) return;
    const videoId = videoIdForFinalPreview;
    const ac = new AbortController();

    void (async () => {
      try {
        const src = await fetchVideoSourceFileUrl(videoId, {
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        setVideoSource({ videoId, sourceFileUrl: src, error: "" });
      } catch (e) {
        if (ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setVideoSource({ videoId, sourceFileUrl: "", error: msg });
      }
    })();

    return () => ac.abort();
  }, [videoIdForFinalPreview]);

  const rawVideoUrl = useMemo(() => {
    if (!isFinalVideoPreview || !selectedItem) return "";
    if (videoSource.videoId !== selectedItem.id) return "";
    if (videoSource.error) return "";
    return (videoSource.sourceFileUrl ?? "").trim();
  }, [isFinalVideoPreview, selectedItem, videoSource]);

  const videoMetaLoading =
    isFinalVideoPreview &&
    !!selectedItem &&
    videoSource.videoId !== selectedItem.id;
  const videoMetaError =
    isFinalVideoPreview &&
    !!selectedItem &&
    videoSource.videoId === selectedItem.id
      ? videoSource.error
      : "";

  const resolvedVideoUrl =
    rawVideoUrl && videoResolve.raw === rawVideoUrl
      ? videoResolve.resolvedUrl
      : "";
  const videoResolveError =
    rawVideoUrl && videoResolve.raw === rawVideoUrl ? videoResolve.error : "";
  const videoResolveState: "idle" | "resolving" | "ready" | "error" =
    !rawVideoUrl
      ? "idle"
      : videoResolve.raw === rawVideoUrl
      ? videoResolveError
        ? "error"
        : "ready"
      : "resolving";

  // 2차(최종) 단계의 VIDEO는 fileUrl/videoUrl이 s3://일 수 있으므로 브라우저 재생 URL로 변환
  useEffect(() => {
    const ac = new AbortController();
    if (!rawVideoUrl) return () => ac.abort();

    void (async () => {
      try {
        const resolved = await resolveEducationVideoUrl(rawVideoUrl, {
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        setVideoResolve({ raw: rawVideoUrl, resolvedUrl: resolved, error: "" });
      } catch (e) {
        if (ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setVideoResolve({ raw: rawVideoUrl, resolvedUrl: "", error: msg });
      }
    })();

    return () => ac.abort();
  }, [rawVideoUrl]);

  // Hook들 호출 이후 early return
  if (!selectedItem) {
    return (
      <div className="cb-reviewer-detail-empty">
        좌측 목록에서 검토할 항목을 선택하세요.
      </div>
    );
  }

  const any = selectedItem as unknown as Record<string, unknown>;
  const linkedVersionId =
    typeof any.policyVersionId === "string" && any.policyVersionId.trim()
      ? any.policyVersionId.trim()
      : null;

  const policy: PolicyDocVersion | undefined = isPolicy
    ? linkedVersionId
      ? policyVersions.find((v) => v.id === linkedVersionId)
      : policyVersions.find((v) => v.reviewItemId === selectedItem.id)
    : undefined;

  const policyDocumentId =
    policy?.documentId ??
    (typeof any.contentId === "string" ? (any.contentId as string) : "") ??
    (typeof any.policyDocId === "string" ? (any.policyDocId as string) : "") ??
    "";

  const archivedVersions = policyDocumentId
    ? policyVersions
        .filter(
          (v) => v.documentId === policyDocumentId && v.status === "ARCHIVED"
        )
        .slice()
        .sort((a, b) => b.version - a.version)
    : [];

  const canShowRollback =
    isPolicy && !!policyDocumentId && archivedVersions.length > 0;

  const pre = preprocessLabel(policy);
  const idx = indexingLabel(policy);
  const opsUnlinked = isPolicy && !policy; // POLICY_DOC인데 store에서 버전을 못 찾는 상태

  const policyPreviewExcerpt =
    policy?.preprocessPreview?.excerpt ??
    (selectedItem as unknown as { policyExcerpt?: string }).policyExcerpt ??
    "";

  const bannedCnt = selectedItem.autoCheck?.bannedWords?.length ?? 0;

  const piiFindings = selectedItem.autoCheck?.piiFindings ?? [];
  const bannedWords = selectedItem.autoCheck?.bannedWords ?? [];
  const qualityWarnings = selectedItem.autoCheck?.qualityWarnings ?? [];

  return (
    <>
      <div className="cb-reviewer-detail-header">
        <div className="cb-reviewer-detail-header-left">
          <div className="cb-reviewer-detail-title">{selectedItem.title}</div>
          <div className="cb-reviewer-detail-meta">
            <span className="cb-reviewer-detail-meta-chip">
              {selectedItem.department}
            </span>
            <span className="cb-reviewer-detail-meta-chip">
              제작자: <strong>{selectedItem.creatorName}</strong>
            </span>
            <span className="cb-reviewer-detail-meta-chip">
              제출: <strong>{formatDateTime(selectedItem.submittedAt)}</strong>
            </span>
            {typeof selectedItem.durationSec === "number" && (
              <span className="cb-reviewer-detail-meta-chip">
                길이:{" "}
                <strong>{formatDuration(selectedItem.durationSec)}</strong>
              </span>
            )}
            {selectedItem.lastUpdatedAt && (
              <span className="cb-reviewer-detail-meta-chip">
                업데이트:{" "}
                <strong>{formatDateTime(selectedItem.lastUpdatedAt)}</strong>
              </span>
            )}
            {isPolicy && policyDocumentId && (
              <span className="cb-reviewer-detail-meta-chip">
                문서 ID: <strong>{policyDocumentId}</strong>
              </span>
            )}
          </div>
        </div>

        <div className="cb-reviewer-detail-header-right">
          {renderStatusPill(selectedItem.status)}
          {renderCategoryPill(selectedItem.contentCategory)}
          {renderPiiPill(selectedItem.autoCheck)}
          {stage && (
            <span
              className={cx("cb-reviewer-pill", "cb-reviewer-pill--neutral")}
              title={stageLabelLong(stage)}
            >
              {stageLabelShort(stage)}
            </span>
          )}
          {isPolicy && (
            <>
              <span
                className={cx(
                  "cb-reviewer-pill",
                  `cb-reviewer-pill--${pre.tone}`
                )}
                title={pre.tooltip}
              >
                {pre.label}
              </span>

              <span
                className={cx(
                  "cb-reviewer-pill",
                  `cb-reviewer-pill--${idx.tone}`
                )}
                title={idx.tooltip}
              >
                {idx.label}
              </span>
            </>
          )}
          {bannedCnt > 0 && (
            <span
              className={cx("cb-reviewer-pill", "cb-reviewer-pill--danger")}
            >
              금칙어 {bannedCnt}
            </span>
          )}
        </div>
      </div>

      <div className="cb-reviewer-detail-tabs">
        <button
          type="button"
          className={cx(
            "cb-reviewer-detail-tab",
            detailTab === "preview" && "cb-reviewer-detail-tab--active"
          )}
          onClick={() => setDetailTab("preview")}
          disabled={isOverlayOpen || isBusy}
        >
          미리보기
        </button>

        <button
          type="button"
          className={cx(
            "cb-reviewer-detail-tab",
            detailTab === "script" && "cb-reviewer-detail-tab--active"
          )}
          onClick={() => setDetailTab("script")}
          disabled={isOverlayOpen || isBusy}
        >
          {isPolicy ? "문서 정보" : "스크립트"}
        </button>

        <button
          type="button"
          className={cx(
            "cb-reviewer-detail-tab",
            detailTab === "checks" && "cb-reviewer-detail-tab--active"
          )}
          onClick={() => setDetailTab("checks")}
          disabled={isOverlayOpen || isBusy}
        >
          자동 점검
        </button>
      </div>

      <div className="cb-reviewer-detail-content">
        {detailTab === "preview" && (
          <>
            <div className="cb-reviewer-section">
              <div className="cb-reviewer-section-head">
                <div className="cb-reviewer-section-title">콘텐츠 미리보기</div>
                <div className="cb-reviewer-section-actions">
                  <button
                    type="button"
                    className="cb-reviewer-mini-btn"
                    onClick={onOpenPreview}
                    disabled={isOverlayOpen || isBusy}
                  >
                    확대 보기
                  </button>
                </div>
              </div>

              {selectedItem.contentType === "VIDEO" ? (
                selectedItem.videoUrl &&
                selectedItem.videoUrl.trim().length > 0 ? (
                  <div className="cb-reviewer-media-wrap">
                    <video
                      className="cb-reviewer-video"
                      src={selectedItem.videoUrl}
                      controls
                    />
                    {/* 2차 검토 시 영상과 함께 스크립트도 표시 */}
                    {stage === 2 && scriptId && scriptId.trim().length > 0 ? (
                      <div style={{ marginTop: 16 }}>
                        <CreatorScriptSceneEditor
                          scriptId={scriptId}
                          videoId={selectedItem.id}
                          scriptText={selectedItem.scriptText}
                          disabled={true}
                          showToast={() => {}}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : // 1차 검토 시 스크립트와 씬 표시
                scriptId && scriptId.trim().length > 0 ? (
                  <CreatorScriptSceneEditor
                    scriptId={scriptId}
                    videoId={selectedItem.id}
                    scriptText={selectedItem.scriptText}
                    disabled={true}
                    showToast={() => {}}
                  />
                ) : (
                  <div className="cb-reviewer-doc-preview">
                    <div className="cb-reviewer-doc-preview-title">
                      {stage === 2
                        ? "2차(최종) 검토 단계"
                        : "1차(스크립트) 검토 단계"}
                    </div>
                    <div className="cb-reviewer-doc-preview-body">
                      {stage === 2
                        ? "현재는 영상과 스크립트를 모두 검토합니다. 2차 승인 시 즉시 공개(PUBLISHED) 처리됩니다."
                        : "스크립트가 아직 생성되지 않았습니다. 제작자가 스크립트를 생성한 후 검토 요청이 올라옵니다."}
                    </div>
                  </div>
                )
              ) : (
                <div className="cb-reviewer-doc-preview">
                  <div className="cb-reviewer-doc-preview-title">
                    사규/정책 미리보기
                  </div>
                  <div className="cb-reviewer-doc-preview-body">
                    {policyPreviewExcerpt?.trim()
                      ? policyPreviewExcerpt
                      : "(미리보기 텍스트가 없습니다. 전처리 결과를 확인하세요.)"}
                  </div>
                </div>
              )}

              {isPolicy && (
                <div className="cb-reviewer-section" style={{ marginTop: 12 }}>
                  <div className="cb-reviewer-section-title">
                    상태/처리 현황
                  </div>

                  <div
                    className="cb-reviewer-doc-preview"
                    style={{ marginTop: 10 }}
                  >
                    <div className="cb-reviewer-doc-preview-body">
                      <div
                        className="cb-reviewer-muted"
                        style={{ marginBottom: 8 }}
                      >
                        승인 후 인덱싱이 진행되며, 실패 시 재시도 동선을
                        제공합니다.
                      </div>

                      {opsUnlinked && (
                        <div
                          className="cb-reviewer-muted"
                          style={{ marginBottom: 10 }}
                          title={pre.tooltip}
                        >
                          처리 상태를 표시할 수 없습니다. 현재는{" "}
                          <strong>미연동</strong> 상태입니다. (백엔드/스토어
                          미연동 또는 정책 버전 연결 누락)
                        </div>
                      )}

                      <div className="cb-reviewer-muted" title={pre.tooltip}>
                        전처리:{" "}
                        <strong>
                          {policy ? policy.preprocessStatus : "미연동"}
                        </strong>
                        {policy?.preprocessPreview && (
                          <>
                            {" "}
                            · pages{" "}
                            <strong>{policy.preprocessPreview.pages}</strong> ·
                            chars{" "}
                            <strong>{policy.preprocessPreview.chars}</strong>
                          </>
                        )}
                      </div>

                      {policy?.preprocessStatus === "FAILED" &&
                        policy.preprocessError && (
                          <div className="cb-reviewer-error">
                            전처리 실패: {policy.preprocessError}
                          </div>
                        )}

                      <div
                        className="cb-reviewer-muted"
                        style={{ marginTop: 8 }}
                        title={idx.tooltip}
                      >
                        인덱싱:{" "}
                        <strong>
                          {policy ? policy.indexingStatus : "미연동"}
                        </strong>
                      </div>

                      {policy?.indexingStatus === "FAILED" &&
                        policy.indexingError && (
                          <div className="cb-reviewer-error">
                            인덱싱 실패: {policy.indexingError}
                          </div>
                        )}

                      {policy?.indexingStatus === "FAILED" && (
                        <div style={{ marginTop: 10 }}>
                          <button
                            type="button"
                            className="cb-reviewer-mini-btn"
                            onClick={() =>
                              onRequestPolicyRetryIndexing?.(selectedItem.id)
                            }
                            disabled={isOverlayOpen || isBusy}
                          >
                            인덱싱 재시도
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {canShowRollback && (
                    <div
                      className="cb-reviewer-section"
                      style={{ marginTop: 12 }}
                    >
                      <div className="cb-reviewer-section-title">롤백</div>
                      <div
                        className="cb-reviewer-muted"
                        style={{ marginTop: 6 }}
                      >
                        ARCHIVED 버전을 선택해 현재 적용 버전(ACTIVE)을 되돌릴
                        수 있습니다. (2차 확인/사유는 오버레이에서 입력)
                      </div>

                      <div
                        className="cb-reviewer-check-card"
                        style={{ marginTop: 10 }}
                      >
                        <div className="cb-reviewer-check-title">
                          ARCHIVED 버전 목록
                        </div>
                        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                          {archivedVersions.map((v) => (
                            <label
                              key={v.id}
                              style={{
                                display: "flex",
                                gap: 10,
                                alignItems: "flex-start",
                              }}
                            >
                              <input
                                type="radio"
                                name={`rollback-${policyDocumentId}`}
                                checked={selectedArchivedId === v.id}
                                onChange={() => setRollbackArchivedId(v.id)}
                                disabled={isOverlayOpen || isBusy}
                                style={{ marginTop: 2 }}
                              />
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 800,
                                    color: "#111827",
                                  }}
                                >
                                  v{v.version} · {v.title}
                                </div>
                                <div
                                  className="cb-reviewer-muted"
                                  style={{ marginTop: 2 }}
                                >
                                  {v.archivedAt
                                    ? `ARCHIVED ${formatDateTime(v.archivedAt)}`
                                    : "ARCHIVED"}
                                  {v.changeSummary
                                    ? ` · ${v.changeSummary}`
                                    : ""}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>

                        <div
                          style={{
                            marginTop: 10,
                            display: "flex",
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            type="button"
                            className="cb-reviewer-danger-btn"
                            disabled={
                              isOverlayOpen || isBusy || !selectedArchivedId
                            }
                            onClick={() => {
                              const target = archivedVersions.find(
                                (v) => v.id === selectedArchivedId
                              );
                              if (!target) return;
                              onRequestPolicyRollback?.({
                                documentId: policyDocumentId,
                                targetVersionId: target.id,
                                targetVersionLabel: `v${target.version}`,
                              });
                            }}
                          >
                            선택 버전으로 롤백
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2차 승인(최종)에서만: 영상 미리보기 섹션(콘텐츠 미리보기 하단) */}
            {selectedItem.contentType === "VIDEO" && stage === 2 && (
              <div className="cb-reviewer-section" style={{ marginTop: 12 }}>
                <div className="cb-reviewer-section-head">
                  <div className="cb-reviewer-section-title">영상 미리보기</div>
                  <div className="cb-reviewer-section-actions">
                    {resolvedVideoUrl ? (
                      <a
                        className="cb-reviewer-mini-btn"
                        href={resolvedVideoUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                        }}
                        title="새 탭에서 열기"
                      >
                        새 탭에서 열기
                      </a>
                    ) : null}
                  </div>
                </div>

                {videoMetaLoading && (
                  <div className="cb-reviewer-muted">
                    영상 메타를 불러오는 중…
                  </div>
                )}

                {!videoMetaLoading && !!videoMetaError && (
                  <div className="cb-reviewer-error">
                    영상 미리보기를 불러올 수 없습니다: {videoMetaError}
                  </div>
                )}

                {!videoMetaLoading &&
                  !videoMetaError &&
                  videoResolveState === "resolving" && (
                    <div className="cb-reviewer-muted">
                      영상 URL을 해석하는 중… (s3:// → presign)
                    </div>
                  )}

                {!videoMetaLoading &&
                  !videoMetaError &&
                  videoResolveState === "error" && (
                    <div className="cb-reviewer-error">
                      영상 미리보기를 불러올 수 없습니다: {videoResolveError}
                    </div>
                  )}

                {!videoMetaLoading &&
                  !videoMetaError &&
                  videoResolveState === "idle" &&
                  videoResolveError && (
                    <div className="cb-reviewer-muted">{videoResolveError}</div>
                  )}

                {!videoMetaLoading &&
                  !videoMetaError &&
                  videoResolveState === "ready" &&
                  resolvedVideoUrl && (
                    <div className="cb-reviewer-media-wrap">
                      <video
                        className="cb-reviewer-video"
                        src={resolvedVideoUrl}
                        controls
                      />
                    </div>
                  )}
              </div>
            )}
            <div className="cb-reviewer-section-footer">
              <span className="cb-reviewer-muted">
                버전 {selectedItem.version} · 생성{" "}
                {formatDateTime(selectedItem.createdAt)}
              </span>
              {selectedItem.riskScore != null && (
                <span className="cb-reviewer-muted">
                  Risk Score {Math.round(selectedItem.riskScore)}
                </span>
              )}
            </div>
          </>
        )}

        {detailTab === "script" && (
          <div className="cb-reviewer-section">
            <div className="cb-reviewer-section-title">
              {isPolicy ? "문서 정보" : "스크립트"}
            </div>

            {isPolicy ? (
              <div className="cb-reviewer-doc-preview">
                <div className="cb-reviewer-doc-preview-title">변경 요약</div>
                <div className="cb-reviewer-doc-preview-body">
                  {policy?.changeSummary?.trim()
                    ? policy.changeSummary
                    : (
                        selectedItem as unknown as {
                          policyDiffSummary?: string;
                        }
                      ).policyDiffSummary ?? "(변경 요약이 없습니다.)"}
                </div>

                <div className="cb-reviewer-muted" style={{ marginTop: 10 }}>
                  문서 ID <strong>{policyDocumentId || "-"}</strong> · 버전{" "}
                  <strong>{policy ? `v${policy.version}` : "-"}</strong> · 파일{" "}
                  <strong>{policy?.fileName ?? "-"}</strong>
                </div>
              </div>
            ) : (
              <>
                {scriptId && scriptId.trim().length > 0 ? (
                  <CreatorScriptSceneEditor
                    scriptId={scriptId}
                    videoId={selectedItem.id}
                    scriptText={selectedItem.scriptText}
                    disabled={true}
                    showToast={() => {}}
                  />
                ) : (
                  <div className="cb-reviewer-doc-preview">
                    <div className="cb-reviewer-doc-preview-body">
                      {selectedItem.scriptText ||
                        "(스크립트가 없습니다. 제작자가 스크립트를 생성하고 검토 요청을 제출했는지 확인하세요.)"}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {detailTab === "checks" && (
          <div className="cb-reviewer-section">
            <div className="cb-reviewer-section-title">자동 점검 결과</div>
            <div className="cb-reviewer-check-grid">
              <div className="cb-reviewer-check-card">
                <div className="cb-reviewer-check-title">
                  개인정보(PII) 리스크
                </div>
                <div className="cb-reviewer-check-value">
                  {renderPiiPill(selectedItem.autoCheck)}
                </div>
                {piiFindings.length > 0 ? (
                  <ul className="cb-reviewer-check-list">
                    {piiFindings.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="cb-reviewer-muted">탐지된 항목 없음</div>
                )}
              </div>

              <div className="cb-reviewer-check-card">
                <div className="cb-reviewer-check-title">금칙어</div>
                {bannedWords.length > 0 ? (
                  <ul className="cb-reviewer-check-list">
                    {bannedWords.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="cb-reviewer-muted">탐지된 항목 없음</div>
                )}
              </div>

              <div className="cb-reviewer-check-card">
                <div className="cb-reviewer-check-title">품질 경고</div>
                {qualityWarnings.length > 0 ? (
                  <ul className="cb-reviewer-check-list">
                    {qualityWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="cb-reviewer-muted">경고 없음</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ReviewerDetail;
