// src/components/chatbot/ReviewerOverlays.tsx
import React, { useEffect, useRef, useState, useMemo } from "react";
import type { DecisionModalState } from "./useReviewerDeskController";
import type { ReviewWorkItem } from "./reviewerDeskTypes";
import { useStableEvent } from "./useStableEvent";
import CreatorScriptSceneEditor from "./CreatorScriptSceneEditor";

function getVideoStage(it: ReviewWorkItem): 1 | 2 | null {
  if (it.contentType !== "VIDEO") return null;

  // reviewStage 필드를 우선 확인 (백엔드에서 명시적으로 설정한 값 사용)
  if (it.reviewStage === "FINAL") return 2;
  if (it.reviewStage === "SCRIPT") return 1;

  // reviewStage가 없으면 videoUrl로 판단 (하위 호환성)
  return it.videoUrl?.trim() ? 2 : 1;
}

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

function getFocusable(container: HTMLElement) {
  const selectors = [
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ];
  return Array.from(
    container.querySelectorAll<HTMLElement>(selectors.join(","))
  ).filter(
    (el) =>
      !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
  );
}

/**
 * Reject 모달 바디 분리(기존 유지)
 */
const RejectModalBody: React.FC<{
  rejectTitleId: string;
  rejectDescId: string;

  initialReason: string;
  error?: string;

  isBusy: boolean;
  rejectProcessing: boolean;

  onCloseDecision: () => void;
  onReject: (reason: string) => void;
}> = ({
  rejectTitleId,
  rejectDescId,
  initialReason,
  error,
  isBusy,
  rejectProcessing,
  onCloseDecision,
  onReject,
}) => {
  const [reason, setReason] = useState(initialReason);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleSubmit = useStableEvent(() => {
    if (!reason.trim()) return;
    onReject(reason.trim());
  });

  return (
    <div className="cb-reviewer-reject-body">
      <div className="cb-reviewer-reject-form">
        <label htmlFor={rejectDescId} className="cb-reviewer-label">
          반려 사유 <span className="cb-reviewer-required">*</span>
        </label>
        <textarea
          id={rejectDescId}
          ref={textareaRef}
          className="cb-reviewer-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="반려 사유를 입력하세요. (필수)"
          disabled={isBusy || rejectProcessing}
          rows={4}
        />
        {error && <div className="cb-reviewer-error">{error}</div>}
      </div>

      <div className="cb-reviewer-reject-actions">
        <button
          type="button"
          className="cb-reviewer-ghost-btn"
          onClick={onCloseDecision}
          disabled={isBusy || rejectProcessing}
        >
          취소
        </button>
        <button
          type="button"
          className="cb-reviewer-danger-btn"
          onClick={handleSubmit}
          disabled={isBusy || rejectProcessing || !reason.trim()}
        >
          {rejectProcessing ? "반려 처리 중…" : "반려하기"}
        </button>
      </div>
    </div>
  );
};

const ReviewerOverlays: React.FC<{
  isBusy: boolean;

  canApprove: boolean;
  approveProcessing: boolean;
  rejectProcessing: boolean;

  approveLabel?: string;
  approveProcessingLabel?: string;

  decisionModal: DecisionModalState;
  onCloseDecision: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;

  previewOpen: boolean;
  onClosePreview: () => void;
  previewItem: ReviewWorkItem | null;
}> = ({
  isBusy,
  canApprove,
  approveProcessing,
  rejectProcessing,
  approveLabel,
  approveProcessingLabel,
  decisionModal,
  onCloseDecision,
  onApprove,
  onReject,
  previewOpen,
  onClosePreview,
  previewItem,
}) => {
  const uid = React.useId();

  const approveLabelText = (approveLabel ?? "승인").trim() || "승인";
  const approveBtnText = approveProcessing
    ? approveProcessingLabel ?? `${approveLabelText} 처리 중…`
    : `${approveLabelText}하기`;

  const approveTitleId = `cb-reviewer-approve-title-${uid}`;
  const approveDescId = `cb-reviewer-approve-desc-${uid}`;
  const rejectTitleId = `cb-reviewer-reject-title-${uid}`;
  const rejectDescId = `cb-reviewer-reject-desc-${uid}`;
  const previewTitleId = `cb-reviewer-preview-title-${uid}`;
  const previewDescId = `cb-reviewer-preview-desc-${uid}`;

  const decisionModalRef = useRef<HTMLDivElement>(null);
  const previewModalRef = useRef<HTMLDivElement>(null);

  // Decision Modal: ESC 키로 닫기
  useEffect(() => {
    if (decisionModal.open && decisionModalRef.current) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && !isBusy) {
          onCloseDecision();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [decisionModal.open, isBusy, onCloseDecision]);

  // Preview Modal: ESC 키로 닫기
  useEffect(() => {
    if (previewOpen && previewModalRef.current) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && !isBusy) {
          onClosePreview();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [previewOpen, isBusy, onClosePreview]);

  // Decision Modal: 포커스 트랩
  useEffect(() => {
    if (decisionModal.open && decisionModalRef.current) {
      const container = decisionModalRef.current;
      const focusable = getFocusable(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      const handleTab = (e: KeyboardEvent) => {
        if (e.key !== "Tab") return;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      container.addEventListener("keydown", handleTab);
      first.focus();

      return () => {
        container.removeEventListener("keydown", handleTab);
      };
    }
  }, [decisionModal.open]);

  // Preview Modal: 포커스 트랩
  useEffect(() => {
    if (previewOpen && previewModalRef.current) {
      const container = previewModalRef.current;
      const focusable = getFocusable(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      const handleTab = (e: KeyboardEvent) => {
        if (e.key !== "Tab") return;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      container.addEventListener("keydown", handleTab);
      first.focus();

      return () => {
        container.removeEventListener("keydown", handleTab);
      };
    }
  }, [previewOpen]);

  const onCloseDecisionEv = useStableEvent(() => {
    if (isBusy) return;
    onCloseDecision();
  });

  const onClosePreviewEv = useStableEvent(() => {
    if (isBusy) return;
    onClosePreview();
  });

  const onApproveEv = useStableEvent(() => {
    if (isBusy || !canApprove) return;
    onApprove();
  });

  const onRejectEv = useStableEvent((reason: string) => {
    if (isBusy) return;
    onReject(reason);
  });

  return (
    <>
      {/* Decision Modal */}
      {decisionModal.open && (
        <div
          className="cb-reviewer-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={
            decisionModal.kind === "approve" ? approveTitleId : rejectTitleId
          }
          ref={decisionModalRef}
        >
          <div className="cb-reviewer-modal">
            <div className="cb-reviewer-modal-head">
              <h2
                id={
                  decisionModal.kind === "approve"
                    ? approveTitleId
                    : rejectTitleId
                }
                className="cb-reviewer-modal-title"
              >
                {decisionModal.kind === "approve"
                  ? `${approveLabelText} 확인`
                  : "반려 확인"}
              </h2>
              <button
                type="button"
                className="cb-reviewer-close-btn"
                onClick={onCloseDecisionEv}
                aria-label="close modal"
                disabled={isBusy}
                title={isBusy ? "처리 중에는 닫을 수 없습니다." : undefined}
              >
                ✕
              </button>
            </div>

            {decisionModal.kind === "approve" ? (
              <div className="cb-reviewer-approve-body">
                <p id={approveDescId} className="cb-reviewer-muted">
                  이 항목을 {approveLabelText}하시겠습니까?
                </p>
                <div className="cb-reviewer-approve-actions">
                  <button
                    type="button"
                    className="cb-reviewer-ghost-btn"
                    onClick={onCloseDecisionEv}
                    disabled={isBusy || approveProcessing}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="cb-reviewer-primary-btn"
                    onClick={onApproveEv}
                    disabled={isBusy || !canApprove || approveProcessing}
                  >
                    {approveBtnText}
                  </button>
                </div>
              </div>
            ) : (
              <RejectModalBody
                rejectTitleId={rejectTitleId}
                rejectDescId={rejectDescId}
                initialReason={
                  decisionModal.kind === "reject" ? decisionModal.reason : ""
                }
                error={decisionModal.error}
                isBusy={isBusy}
                rejectProcessing={rejectProcessing}
                onCloseDecision={onCloseDecisionEv}
                onReject={onRejectEv}
              />
            )}
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewOpen && previewItem && (
        <div
          className="cb-reviewer-modal-overlay cb-reviewer-modal-overlay--preview"
          role="dialog"
          aria-modal="true"
          aria-labelledby={previewTitleId}
          ref={previewModalRef}
        >
          <div className="cb-reviewer-preview-modal">
            <div className="cb-reviewer-preview-head">
              <h2 id={previewTitleId} className="cb-reviewer-preview-title">
                {previewItem.title}
              </h2>
              <button
                type="button"
                className="cb-reviewer-close-btn"
                onClick={() => {
                  if (isBusy) return;
                  onClosePreviewEv();
                }}
                aria-label="close preview"
                disabled={isBusy}
                title={isBusy ? "처리 중에는 닫을 수 없습니다." : undefined}
              >
                ✕
              </button>
            </div>

            <div className="cb-reviewer-preview-body">
              {previewItem.contentType === "VIDEO" ? (
                (() => {
                  const stage = getVideoStage(previewItem);
                  const any = previewItem as unknown as Record<string, unknown>;
                  const scriptId =
                    typeof any.scriptId === "string" && any.scriptId.trim()
                      ? any.scriptId.trim()
                      : "";

                  // 1차 검토(스크립트 검토)일 때는 스크립트 표시
                  if (stage === 1 && scriptId) {
                    return (
                      <CreatorScriptSceneEditor
                        scriptId={scriptId}
                        videoId={previewItem.id}
                        scriptText={previewItem.scriptText}
                        disabled={true}
                        showToast={() => {}}
                      />
                    );
                  }

                  // 2차 검토(영상 검토)일 때는 영상 표시
                  if (
                    stage === 2 &&
                    previewItem.videoUrl &&
                    previewItem.videoUrl.trim().length > 0
                  ) {
                    return (
                      <div className="cb-reviewer-preview-media">
                        <video
                          className="cb-reviewer-preview-video"
                          src={previewItem.videoUrl}
                          controls
                        />
                        {/* 2차 검토 시 영상과 함께 스크립트도 표시 */}
                        {scriptId ? (
                          <div style={{ marginTop: 16 }}>
                            <CreatorScriptSceneEditor
                              scriptId={scriptId}
                              videoId={previewItem.id}
                              scriptText={previewItem.scriptText}
                              disabled={true}
                              showToast={() => {}}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  // 스크립트나 영상이 없는 경우
                  return (
                    <div className="cb-reviewer-doc-preview">
                      <div className="cb-reviewer-doc-preview-title">
                        {stage === 2
                          ? "2차(최종) 검토 단계"
                          : "1차(스크립트) 검토 단계"}
                      </div>
                      <div className="cb-reviewer-doc-preview-body">
                        {stage === 2
                          ? "영상이 아직 생성되지 않았습니다."
                          : "스크립트가 아직 생성되지 않았습니다."}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="cb-reviewer-doc-preview">
                  <div className="cb-reviewer-doc-preview-title">
                    {previewItem.title}
                  </div>
                  <div className="cb-reviewer-doc-preview-body">
                    {previewItem.policyExcerpt ??
                      "(미리보기 텍스트가 없습니다)"}
                  </div>
                </div>
              )}
            </div>

            <div className="cb-reviewer-preview-foot">
              <span id={previewDescId} className="cb-reviewer-muted">
                {previewItem.department} · 제작자 {previewItem.creatorName} ·
                버전 {previewItem.version}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ReviewerOverlays;
