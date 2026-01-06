// src/components/chatbot/ReviewerQueue.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewWorkItem } from "./reviewerDeskTypes";
import type { ListMode, ReviewerTabId, SortMode, ReviewStageFilter } from "./useReviewerDeskController";
import { formatDateTime } from "./creatorStudioUtils";

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

function statusTone(s: ReviewWorkItem["status"]): "neutral" | "warn" | "danger" {
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

function renderStatusPill(s: ReviewWorkItem["status"]) {
    const tone = statusTone(s);
    return <span className={cx("cb-reviewer-pill", `cb-reviewer-pill--${tone}`)}>{statusLabel(s)}</span>;
}

function renderCategoryPill(c: ReviewWorkItem["contentCategory"]) {
    return <span className={cx("cb-reviewer-pill", "cb-reviewer-pill--neutral")}>{categoryLabel(c)}</span>;
}

function renderPiiPill(item: ReviewWorkItem["autoCheck"]) {
    const level = item.piiRiskLevel;
    const tone = level === "high" ? "danger" : level === "medium" ? "warn" : "neutral";
    const label =
        level === "high"
            ? "PII HIGH"
            : level === "medium"
                ? "PII MED"
                : level === "low"
                    ? "PII LOW"
                    : "PII NONE";
    return <span className={cx("cb-reviewer-pill", `cb-reviewer-pill--${tone}`)}>{label}</span>;
}

function renderStagePill(stage: 1 | 2) {
    return (
        <span
            className={cx("cb-reviewer-pill", "cb-reviewer-pill--neutral")}
            title={stageLabelLong(stage)}
        >
            {stageLabelShort(stage)}
        </span>
    );
}

function renderDocPill(it: ReviewWorkItem) {
    if (it.contentType === "VIDEO") return null;
    return (
        <span className={cx("cb-reviewer-pill", "cb-reviewer-pill--neutral")} title="문서/정책">
            문서
        </span>
    );
}

function isRiskItem(it: ReviewWorkItem) {
    const pii = it.autoCheck?.piiRiskLevel;
    const banned = it.autoCheck?.bannedWords?.length ?? 0;
    const qwarn = it.autoCheck?.qualityWarnings?.length ?? 0;
    return pii === "high" || pii === "medium" || banned > 0 || qwarn > 0;
}

export interface ReviewerQueueProps {
    uid: string;

    activeTab: ReviewerTabId;
    setActiveTab: (t: ReviewerTabId) => void;
    counts: { pending: number; approved: number; rejected: number; my: number };

    query: string;
    setQuery: (v: string) => void;

    onlyMine: boolean;
    setOnlyMine: (v: boolean) => void;

    riskOnly: boolean;
    setRiskOnly: (v: boolean) => void;

    sortMode: SortMode;
    setSortMode: (v: SortMode) => void;

    isBusy: boolean;
    isOverlayOpen: boolean;

    selectedId: string | null;
    setSelectedId: (id: string) => void;
    selectedIndex: number;

    filtered: ReviewWorkItem[];

    listMode: ListMode;
    setListMode: (m: ListMode) => void;

    pageIndex: number;
    setPageIndex: (n: number) => void;
    pageSize: number;
    setPageSize: (n: number) => void;
    totalPages: number;

    pageItems: ReviewWorkItem[];

    stageFilter: ReviewStageFilter;
    setStageFilter: (v: ReviewStageFilter) => void;
    stageCounts: { all: number; stage1: number; stage2: number; docs: number };
}

const ROW_STEP = 122; // item height + gap (가상 스크롤 기준)
const OVERSCAN = 6;
const VIRTUAL_GAP = 10; // 기존 .cb-reviewer-item margin-bottom 값(가상 스크롤에서는 gap을 ROW_STEP로 만들 것)
const VIRTUAL_ITEM_HEIGHT = ROW_STEP - VIRTUAL_GAP; // 112
const MAX_PILLS_VIRTUAL = 4; // 가상 스크롤에서는 1줄 유지 위해 최대 N개만 (+N 표시)

const ReviewerQueue: React.FC<ReviewerQueueProps> = (props) => {
    const {
        uid,
        activeTab,
        setActiveTab,
        counts,
        query,
        setQuery,
        onlyMine,
        setOnlyMine,
        riskOnly,
        setRiskOnly,
        sortMode,
        setSortMode,
        isBusy,
        isOverlayOpen,
        selectedId,
        setSelectedId,
        selectedIndex,
        filtered,
        listMode,
        setListMode,
        pageIndex,
        setPageIndex,
        pageSize,
        setPageSize,
        totalPages,
        pageItems,
        stageFilter,
        setStageFilter,
        stageCounts,
    } = props;

    const isVirtual = listMode === "virtual";
    const listRef = useRef<HTMLDivElement | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportH, setViewportH] = useState(560);

    useEffect(() => {
        if (!isVirtual) return;
        const root = listRef.current;
        if (!root) return;

        const update = () => setViewportH(root.clientHeight || 560);
        update();

        if (typeof ResizeObserver === "undefined") return;

        const ro = new ResizeObserver(() => update());
        ro.observe(root);
        return () => ro.disconnect();
    }, [isVirtual]);

    const queueEmptyLabel = useMemo(() => {
        if (query.trim()) return "검색 조건에 해당하는 항목이 없습니다.";
        if (riskOnly) return "리스크 조건에 해당하는 항목이 없습니다.";
        if (stageFilter !== "all") {
            const label =
                stageFilter === "stage1" ? "1차" :
                    stageFilter === "stage2" ? "2차" :
                        "문서";
            return `${label} 조건에 해당하는 항목이 없습니다.`;
        }
        if (activeTab === "my") return "내 활동 내역이 없습니다.";
        return "현재 큐가 비어있습니다.";
    }, [activeTab, query, riskOnly, stageFilter]);

    // selection visible
    useEffect(() => {
        if (!selectedId) return;
        const root = listRef.current;
        if (!root) return;

        if (isVirtual) {
            if (selectedIndex < 0) return;
            const top = Math.max(0, selectedIndex * ROW_STEP - ROW_STEP);
            root.scrollTo({ top, behavior: "auto" });
            return;
        }

        const btn = root.querySelector<HTMLButtonElement>(`button[data-id="${selectedId}"]`);
        btn?.scrollIntoView({ block: "nearest" });
    }, [selectedId, selectedIndex, isVirtual]);

    const onScroll = () => {
        const root = listRef.current;
        if (!root) return;
        setScrollTop(root.scrollTop);
    };

    // virtualization window
    const virtualWindow = useMemo(() => {
        if (!isVirtual) return null;
        const total = filtered.length;
        const totalHeight = total * ROW_STEP + 12;

        const start = Math.max(0, Math.floor(scrollTop / ROW_STEP) - OVERSCAN);
        const end = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_STEP) + OVERSCAN);

        const slice = filtered.slice(start, end);

        return { total, totalHeight, start, end, slice };
    }, [filtered, isVirtual, scrollTop, viewportH]);

    // virtual: scrollTop clamp (effect 내 동기 setState 금지 패턴 반영)
    useEffect(() => {
        if (!isVirtual) return;
        const root = listRef.current;
        if (!root) return;

        const totalHeight = filtered.length * ROW_STEP + 12;
        const max = Math.max(0, totalHeight - viewportH);

        if (root.scrollTop > max) {
            root.scrollTop = max;
            requestAnimationFrame(() => {
                const r = listRef.current;
                if (!r) return;
                setScrollTop(r.scrollTop);
            });
        }
    }, [isVirtual, filtered.length, viewportH]);

    const displayed = isVirtual ? filtered : pageItems;
    const onlyMineDisabled = activeTab === "pending";

    return (
        <div className="cb-reviewer-queue">
            <div className="cb-reviewer-queue-top">
                <div className="cb-reviewer-tabs">
                    <button
                        type="button"
                        className={cx("cb-reviewer-tab", activeTab === "pending" && "cb-reviewer-tab--active")}
                        onClick={() => setActiveTab("pending")}
                        disabled={isOverlayOpen || isBusy}
                    >
                        검토 대기 <span className="cb-reviewer-tab-count">{counts.pending}</span>
                    </button>
                    <button
                        type="button"
                        className={cx("cb-reviewer-tab", activeTab === "approved" && "cb-reviewer-tab--active")}
                        onClick={() => setActiveTab("approved")}
                        disabled={isOverlayOpen || isBusy}
                    >
                        승인됨 <span className="cb-reviewer-tab-count">{counts.approved}</span>
                    </button>
                    <button
                        type="button"
                        className={cx("cb-reviewer-tab", activeTab === "rejected" && "cb-reviewer-tab--active")}
                        onClick={() => setActiveTab("rejected")}
                        disabled={isOverlayOpen || isBusy}
                    >
                        반려됨 <span className="cb-reviewer-tab-count">{counts.rejected}</span>
                    </button>
                    <button
                        type="button"
                        className={cx("cb-reviewer-tab", activeTab === "my" && "cb-reviewer-tab--active")}
                        onClick={() => setActiveTab("my")}
                        disabled={isOverlayOpen || isBusy}
                    >
                        내 활동 <span className="cb-reviewer-tab-count">{counts.my}</span>
                    </button>
                </div>

                <div className="cb-reviewer-queue-controls">
                    <input
                        className="cb-reviewer-search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="제목/부서/제작자 검색 ( / 로 포커스 )"
                        disabled={isOverlayOpen || isBusy}
                    />
                    <label
                        className="cb-reviewer-toggle"
                        title={onlyMineDisabled ? "검토 대기 탭에서는 적용되지 않습니다." : undefined}
                    >
                        <input
                            type="checkbox"
                            checked={onlyMine}
                            onChange={(e) => setOnlyMine(e.target.checked)}
                            disabled={isOverlayOpen || isBusy || onlyMineDisabled}
                        />
                        내 처리만
                    </label>
                </div>

                <div className="cb-reviewer-queue-quick">
                    {/* 첫 번째 줄: 리스크만, 정렬, 리스트 */}
                    <div className="cb-reviewer-queue-quick-row">
                        <label className="cb-reviewer-toggle cb-reviewer-toggle--pill">
                            <input
                                type="checkbox"
                                checked={riskOnly}
                                onChange={(e) => setRiskOnly(e.target.checked)}
                                disabled={isOverlayOpen || isBusy}
                            />
                            리스크만
                        </label>

                        <div className="cb-reviewer-sort">
                            <span className="cb-reviewer-sort-label">정렬</span>
                            <select
                                className="cb-reviewer-sort-select"
                                value={sortMode}
                                onChange={(e) => setSortMode(e.target.value as SortMode)}
                                disabled={isOverlayOpen || isBusy}
                            >
                                <option value="newest">최신순</option>
                                <option value="risk">리스크 우선</option>
                            </select>
                        </div>

                        <div className="cb-reviewer-mode">
                            <span className="cb-reviewer-sort-label">리스트</span>
                            <button
                                type="button"
                                className={cx("cb-reviewer-mode-pill", isVirtual && "cb-reviewer-mode-pill--active")}
                                onClick={() => setListMode(isVirtual ? "paged" : "virtual")}
                                disabled={isOverlayOpen || isBusy}
                                title={isVirtual ? "페이지네이션으로 전환" : "가상 스크롤로 전환"}
                                aria-label={isVirtual ? "리스트 모드: 가상 스크롤" : "리스트 모드: 페이지"}
                            >
                                {isVirtual ? "스크롤" : "페이지"}
                            </button>
                        </div>

                        <div className="cb-reviewer-hotkeys">↑↓ 이동 · Enter 미리보기 · / 검색</div>
                    </div>

                    {/* 두 번째 줄: 전체/1차/2차/문서 필터 */}
                    {stageCounts && (
                        <div className="cb-reviewer-stage-row">
                            <div className="cb-reviewer-stage">
                                <div className="cb-reviewer-stage-pills">
                                    <button
                                        type="button"
                                        className={cx("cb-reviewer-stage-pill", stageFilter === "all" && "cb-reviewer-stage-pill--active")}
                                        onClick={() => setStageFilter("all")}
                                        disabled={isOverlayOpen || isBusy}
                                    >
                                        전체 <span className="cb-reviewer-stage-count">{stageCounts.all ?? 0}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={cx("cb-reviewer-stage-pill", stageFilter === "stage1" && "cb-reviewer-stage-pill--active")}
                                        onClick={() => setStageFilter("stage1")}
                                        disabled={isOverlayOpen || isBusy}
                                        title="VIDEO 1차(스크립트) 단계"
                                    >
                                        1차 <span className="cb-reviewer-stage-count">{stageCounts.stage1 ?? 0}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={cx("cb-reviewer-stage-pill", stageFilter === "stage2" && "cb-reviewer-stage-pill--active")}
                                        onClick={() => setStageFilter("stage2")}
                                        disabled={isOverlayOpen || isBusy}
                                        title="VIDEO 2차(최종) 단계"
                                    >
                                        2차 <span className="cb-reviewer-stage-count">{stageCounts.stage2 ?? 0}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={cx(
                                            "cb-reviewer-stage-pill",
                                            stageFilter === "docs" && "cb-reviewer-stage-pill--active"
                                        )}
                                        onClick={() => setStageFilter("docs")}
                                        disabled={isOverlayOpen || isBusy || (stageCounts.docs ?? 0) === 0}
                                        title="VIDEO가 아닌 문서/정책"
                                    >
                                        문서 <span className="cb-reviewer-stage-count">{stageCounts.docs ?? 0}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div
                ref={listRef}
                className={cx("cb-reviewer-list", isVirtual && "cb-reviewer-list--virtual")}
                role="listbox"
                aria-label="검토 항목 목록"
                aria-activedescendant={selectedId ? `${uid}-item-${selectedId}` : undefined}
                onScroll={isVirtual ? onScroll : undefined}
            >
                {displayed.length === 0 ? (
                    <div className="cb-reviewer-empty">{queueEmptyLabel}</div>
                ) : isVirtual && virtualWindow ? (
                    <div className="cb-reviewer-virtual-spacer" style={{ height: virtualWindow.totalHeight }}>
                        {virtualWindow.slice.map((it, i) => {
                            const index = virtualWindow.start + i;
                            const isActive = it.id === selectedId;

                            const bannedCnt = it.autoCheck?.bannedWords?.length ?? 0;
                            const riskWarn = isRiskItem(it);

                            const stage = getVideoStage(it);

                            const pillsRaw: Array<React.ReactNode | null> = [
                                renderStatusPill(it.status),
                                renderCategoryPill(it.contentCategory),
                                renderPiiPill(it.autoCheck),

                                // VIDEO 아니면 문서 pill
                                renderDocPill(it),

                                // VIDEO면 1/2차 pill
                                stage ? renderStagePill(stage) : null,

                                bannedCnt > 0 ? (
                                    <span className={cx("cb-reviewer-pill", "cb-reviewer-pill--danger")}>금칙어 {bannedCnt}</span>
                                ) : null,
                                riskWarn && it.riskScore != null ? (
                                    <span className={cx("cb-reviewer-pill", "cb-reviewer-pill--warn")}>
                                        Risk {Math.round(it.riskScore)}
                                    </span>
                                ) : null,
                            ];

                            const pills = pillsRaw.filter(Boolean) as React.ReactNode[];
                            const shown = pills.slice(0, MAX_PILLS_VIRTUAL);
                            const extra = pills.length - shown.length;

                            return (
                                <button
                                    key={it.id}
                                    data-id={it.id}
                                    type="button"
                                    className={cx(
                                        "cb-reviewer-item",
                                        "cb-reviewer-item--virtual",
                                        isActive && "cb-reviewer-item--active"
                                    )}
                                    style={{
                                        transform: `translateY(${index * ROW_STEP}px)`,
                                        height: VIRTUAL_ITEM_HEIGHT,
                                    }}
                                    onClick={() => {
                                        if (isOverlayOpen || isBusy) return;
                                        setSelectedId(it.id);
                                    }}
                                    disabled={isOverlayOpen || isBusy}
                                    id={`${uid}-item-${it.id}`}
                                    role="option"
                                    aria-selected={isActive}
                                >
                                    <div className="cb-reviewer-item-top">
                                        <div className="cb-reviewer-item-title">{it.title}</div>
                                        {riskWarn && <span className="cb-reviewer-risk-dot" aria-label="risk" />}
                                    </div>

                                    {/* (가상 스크롤만) meta 한 줄 고정 */}
                                    <div className={cx("cb-reviewer-item-meta", "cb-reviewer-item-meta--single")}>
                                        {it.department} • {it.creatorName} • {formatDateTime(it.submittedAt)}
                                    </div>

                                    {/* (가상 스크롤만) pills 한 줄 + +N */}
                                    <div className={cx("cb-reviewer-item-pills", "cb-reviewer-item-pills--single")}>
                                        <div className="cb-reviewer-item-pills-main">
                                            {shown.map((node, idx) => (
                                                <React.Fragment key={idx}>{node}</React.Fragment>
                                            ))}
                                        </div>

                                        {extra > 0 && (
                                            <span className={cx("cb-reviewer-pill", "cb-reviewer-pill--neutral", "cb-reviewer-pill--more")}>
                                                +{extra}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    pageItems.map((it) => {
                        const isActive = it.id === selectedId;

                        const bannedCnt = it.autoCheck?.bannedWords?.length ?? 0;
                        const riskWarn = isRiskItem(it);
                        const stage = getVideoStage(it);

                        return (
                            <button
                                key={it.id}
                                data-id={it.id}
                                type="button"
                                className={cx("cb-reviewer-item", isActive && "cb-reviewer-item--active")}
                                onClick={() => {
                                    if (isOverlayOpen || isBusy) return;
                                    setSelectedId(it.id);
                                }}
                                disabled={isOverlayOpen || isBusy}
                                id={`${uid}-item-${it.id}`}
                                role="option"
                                aria-selected={isActive}
                            >
                                <div className="cb-reviewer-item-top">
                                    <div className="cb-reviewer-item-title">{it.title}</div>
                                    {riskWarn && <span className="cb-reviewer-risk-dot" aria-label="risk" />}
                                </div>

                                <div className="cb-reviewer-item-meta">
                                    <span>{it.department}</span>
                                    <span className="cb-reviewer-meta-sep">•</span>
                                    <span>{it.creatorName}</span>
                                    <span className="cb-reviewer-meta-sep">•</span>
                                    <span>{formatDateTime(it.submittedAt)}</span>
                                </div>

                                <div className="cb-reviewer-item-pills">
                                    {renderStatusPill(it.status)}
                                    {renderCategoryPill(it.contentCategory)}
                                    {renderPiiPill(it.autoCheck)}
                                    {renderDocPill(it)}
                                    {stage && renderStagePill(stage)}
                                    {bannedCnt > 0 && (
                                        <span className={cx("cb-reviewer-pill", "cb-reviewer-pill--danger")}>금칙어 {bannedCnt}</span>
                                    )}
                                    {riskWarn && it.riskScore != null && (
                                        <span className={cx("cb-reviewer-pill", "cb-reviewer-pill--warn")}>
                                            Risk {Math.round(it.riskScore)}
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })
                )}
            </div>

            {/* pagination footer (paged 모드에서만) */}
            {!isVirtual && (
                <div className="cb-reviewer-list-footer">
                    <div className="cb-reviewer-pagination">
                        <button
                            type="button"
                            className="cb-reviewer-page-btn"
                            onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
                            disabled={isOverlayOpen || isBusy || pageIndex <= 0}
                        >
                            이전
                        </button>
                        <div className="cb-reviewer-page-info">
                            <strong>{pageIndex + 1}</strong> / {totalPages}
                            <span className="cb-reviewer-page-sep">•</span>
                            {filtered.length} items
                        </div>
                        <button
                            type="button"
                            className="cb-reviewer-page-btn"
                            onClick={() => setPageIndex(Math.min(totalPages - 1, pageIndex + 1))}
                            disabled={isOverlayOpen || isBusy || pageIndex >= totalPages - 1}
                        >
                            다음
                        </button>
                    </div>

                    <div className="cb-reviewer-page-size">
                        <span className="cb-reviewer-sort-label">페이지 크기</span>
                        <select
                            className="cb-reviewer-sort-select"
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            disabled={isOverlayOpen || isBusy}
                        >
                            <option value={20}>20</option>
                            <option value={30}>30</option>
                            <option value={50}>50</option>
                            <option value={80}>80</option>
                        </select>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReviewerQueue;
