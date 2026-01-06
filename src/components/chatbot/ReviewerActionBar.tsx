// src/components/chatbot/ReviewerActionBar.tsx
import React from "react";
import type { ActionGuardInfo } from "./useReviewerDeskController";

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

type GuardPill = {
  tone: "neutral" | "warn" | "danger";
  label: string;
  detail?: string;
};
type GuardRow = { allowed: boolean; pills: GuardPill[] };

const ReviewerActionBar: React.FC<{
  actionGuard: ActionGuardInfo | null;
  canApprove: boolean;
  canReject: boolean;
  isBusy: boolean;
  isOverlayOpen: boolean;
  approveProcessing: boolean;
  rejectProcessing: boolean;
  approveLabel?: string;
  approveProcessingLabel?: string;
  onApprove: () => void;
  onReject: () => void;
}> = ({
  actionGuard,
  canApprove,
  canReject,
  isBusy,
  isOverlayOpen,
  approveProcessing,
  rejectProcessing,
  approveLabel,
  approveProcessingLabel,
  onApprove,
  onReject,
}) => {
  const renderGuardPill = (p: GuardPill, idx: number) => (
    <span
      key={`${p.label}-${idx}`}
      className={cx(
        "cb-reviewer-guard-pill",
        `cb-reviewer-guard-pill--${p.tone}`
      )}
      title={p.detail ?? p.label}
    >
      {p.label}
    </span>
  );

  const renderGuardRow = (label: string, row: GuardRow) => (
    <div className="cb-reviewer-guard-row">
      <span className="cb-reviewer-guard-k">{label}</span>
      <span
        className={cx(
          "cb-reviewer-guard-state",
          row.allowed
            ? "cb-reviewer-guard-state--ok"
            : "cb-reviewer-guard-state--no"
        )}
      >
        {row.allowed ? "가능" : "불가"}
      </span>
      <div className="cb-reviewer-guard-pills">
        {row.pills.map(renderGuardPill)}
      </div>
    </div>
  );

  return (
    <div className="cb-reviewer-actionbar">
      <div className="cb-reviewer-actionbar-left">
        {!actionGuard ? (
          <span className="cb-reviewer-muted">
            좌측 목록에서 검토할 항목을 선택하세요.
          </span>
        ) : (
          <div className="cb-reviewer-guard" title={actionGuard.headline}>
            <span className="cb-sr-only">{actionGuard.headline}</span>
            <div className="cb-reviewer-guard-rows">
              {renderGuardRow("승인", actionGuard.approve)}
              {renderGuardRow("반려", actionGuard.reject)}
            </div>
          </div>
        )}
      </div>

      <div className="cb-reviewer-actionbar-right">
        <button
          type="button"
          className="cb-reviewer-danger-btn"
          onClick={onReject}
          disabled={!canReject || isOverlayOpen || isBusy}
          title={
            !canReject
              ? "검토 대기 상태에서만 반려할 수 있습니다."
              : isBusy
              ? "처리 중입니다."
              : undefined
          }
        >
          {rejectProcessing ? "반려 중…" : "반려"}
        </button>

        <button
          type="button"
          className="cb-reviewer-primary-btn"
          onClick={onApprove}
          disabled={!canApprove || isOverlayOpen || isBusy}
          title={
            !canApprove
              ? "검토 대기 상태에서만 승인할 수 있습니다."
              : isBusy
              ? "처리 중입니다."
              : undefined
          }
        >
          {approveProcessing
            ? approveProcessingLabel ?? "승인 중…"
            : approveLabel ?? "승인"}
        </button>
      </div>
    </div>
  );
};

export default ReviewerActionBar;
