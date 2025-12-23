// src/components/chatbot/AdminDashboardView.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  computePanelPosition,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";
import AdminFilterBar from "./AdminFilterBar";
import type { CommonFilterState } from "./adminFilterTypes";
import AdminRagGapView from "./AdminRagGapView";
import AdminPolicyView from "./AdminPolicyView";
import type {
  AdminTabId,
  PeriodFilter,
  KpiCard,
  PiiReport,
  PiiRiskLevel,
  RoleKey,
  CreatorType,
  AdminUserSummary,
  AccountMessage,
} from "./adminDashboardTypes";

import {
  PERIOD_OPTIONS,
  DEPARTMENT_OPTIONS,
  TAB_LABELS,
  CHATBOT_PRIMARY_KPIS_BY_PERIOD,
  CHATBOT_SECONDARY_KPIS_BY_PERIOD,
  CHATBOT_VOLUME_BY_PERIOD,
  CHATBOT_DOMAIN_SHARE_BY_PERIOD,
  CHATBOT_ROUTE_SHARE_BY_PERIOD,
  POPULAR_KEYWORDS_BY_PERIOD,
  LOG_DOMAIN_OPTIONS,
  LOG_ROUTE_OPTIONS,
  LOG_MODEL_OPTIONS,
  LOG_LIST_MOCK,
  PII_REPORT_NONE,
  PII_REPORT_WARNING,
  PII_REPORT_HIGH,
  educationKpis,
  mandatoryCoursesMock,
  jobCoursesMock,
  deptEducationRowsMock,
  quizKpis,
  deptQuizRowsMock,
  quizSummaryRowsMock,
  difficultQuestionsMock,
  PII_TREND_BY_PERIOD,
  LATENCY_BUCKET_BY_PERIOD,
  MODEL_LATENCY_BY_PERIOD,
  securityMetricsMock,
  qualityMetricsMock,
  DEPT_SCOPE_OPTIONS,
  MOCK_USERS,
} from "./adminDashboardMocks";

/** 롤 한글 라벨 매핑 (요약 표시용) */
const ROLE_LABELS: Record<RoleKey, string> = {
  EMPLOYEE: "EMPLOYEE (기본)",
  VIDEO_CREATOR: "VIDEO_CREATOR (영상 제작자)",
  CONTENTS_REVIEWER: "CONTENTS_REVIEWER (콘텐츠 검토자)",
  COMPLAINT_MANAGER: "COMPLAINT_MANAGER (신고 관리자)",
  SYSTEM_ADMIN: "SYSTEM_ADMIN (시스템 관리자)",
};

/**
 * 패널 사이즈 / 드래그 / 리사이즈 타입
 * (EduPanel / QuizPanel 과 동일 패턴)
 */
type Size = PanelSize;
type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type ResizeState = {
  resizing: boolean;
  dir: ResizeDirection | null;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startTop: number;
  startLeft: number;
};

type DragState = {
  dragging: boolean;
  startX: number;
  startY: number;
  startTop: number;
  startLeft: number;
};

/**
 * 레이아웃/드래그/리사이즈 상수
 * - 관리자 대시보드는 기본 크기를 조금 더 크게
 */
const MIN_WIDTH = 900;
const MIN_HEIGHT = 560;
const MAX_WIDTH = Number.POSITIVE_INFINITY;
const PANEL_MARGIN = 80;

// “데스크톱용 최소”는 유지하되, 뷰포트가 더 작으면 그에 맞춰 자동 축소
const ABS_MIN_WIDTH = 360;
const ABS_MIN_HEIGHT = 420;

// 패널이 화면 끝에 딱 붙지 않게 만드는 안전 여백
const VIEW_PADDING = 32; // 화면 양옆/상하 최소 여백 (패널 max 계산용)
const VIEW_MARGIN = 16; // 드래그/리사이즈 시 클램프 최소 여백

function clamp(n: number, min: number, max: number) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, n));
}

function getViewportConstraints() {
  if (typeof window === "undefined") {
    return {
      minW: MIN_WIDTH,
      minH: MIN_HEIGHT,
      maxW: MAX_WIDTH,
      maxH: 9999,
      margin: VIEW_MARGIN,
      vw: 1920,
      vh: 1080,
    };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const maxW = Math.max(ABS_MIN_WIDTH, vw - VIEW_PADDING * 2);
  const maxH = Math.max(ABS_MIN_HEIGHT, vh - VIEW_PADDING * 2);

  // 뷰포트가 작으면 min도 같이 내려가야 “패널이 뷰포트를 초과”하지 않음
  const minW = Math.max(ABS_MIN_WIDTH, Math.min(MIN_WIDTH, maxW));
  const minH = Math.max(ABS_MIN_HEIGHT, Math.min(MIN_HEIGHT, maxH));

  return { minW, minH, maxW, maxH, margin: VIEW_MARGIN, vw, vh };
}

/**
 * 화면 크기에 맞게 관리자 대시보드 초기 사이즈 계산
 * (EduPanel 의 createInitialSize 와 비슷한 방식)
 */
const createInitialSize = (): Size => {
  if (typeof window === "undefined") {
    return { width: 980, height: 620 };
  }

  const { minW, minH, maxW, maxH, vw, vh } = getViewportConstraints();

  // 기본은 “뷰포트 기준으로 넉넉히”, 단 min/max 범위 내에서만
  const desiredW = vw - VIEW_PADDING * 2;
  const desiredH = vh - PANEL_MARGIN;

  const width = clamp(desiredW, minW, maxW);
  const height = clamp(desiredH, minH, maxH);

  return { width, height };
};

function clampPanelToViewport(pos: { top: number; left: number }, size: Size) {
  if (typeof window === "undefined") return { pos, size };

  const { minW, minH, maxW, maxH, margin, vw, vh } = getViewportConstraints();

  const nextSize: Size = {
    width: clamp(size.width, minW, maxW),
    height: clamp(size.height, minH, maxH),
  };

  const maxLeft = Math.max(margin, vw - margin - nextSize.width);
  const maxTop = Math.max(margin, vh - margin - nextSize.height);

  const nextPos = {
    left: clamp(pos.left, margin, maxLeft),
    top: clamp(pos.top, margin, maxTop),
  };

  return { pos: nextPos, size: nextSize };
}

interface AdminDashboardViewProps {
  onClose?: () => void;
  anchor?: Anchor | null;
  onRequestFocus?: () => void;
}

interface PiiReportCardProps {
  report: PiiReport;
  /**
   * 카드 상단에 "어떤 기간/부서/조건 기준 요약인지" 한 줄로 보여줄 문장
   */
  contextSummary: string;
}

const PiiReportCard: React.FC<PiiReportCardProps> = ({
  report,
  contextSummary,
}) => {
  const [showMasked, setShowMasked] = useState(false);

  const hasMaskedText = !!report.maskedText && report.riskLevel !== "none";

  let badgeLabel = "";
  let badgeClass = "";

  switch (report.riskLevel) {
    case "none":
      badgeLabel = "위험 없음";
      badgeClass = "cb-admin-pii-badge--safe";
      break;
    case "warning":
      badgeLabel = "주의";
      badgeClass = "cb-admin-pii-badge--warning";
      break;
    case "high":
      badgeLabel = "고위험";
      badgeClass = "cb-admin-pii-badge--danger";
      break;
  }

  return (
    <section className="cb-admin-section cb-admin-section--pii-report">
      <div className="cb-admin-pii-header">
        <div className="cb-admin-pii-header-main">
          <h3 className="cb-admin-section-title">PII 점검 결과</h3>
          <span className="cb-admin-section-sub">{contextSummary}</span>
          <span className="cb-admin-section-sub cb-admin-section-sub--muted">
            위 조건에 해당하는 요청·응답 로그를 기준으로 개인정보 탐지 위험도를
            요약합니다.
          </span>
        </div>

        <div className="cb-admin-pii-header-right">
          <span className={`cb-admin-pii-badge ${badgeClass}`}>
            {badgeLabel}
          </span>
        </div>
      </div>

      <div className="cb-admin-pii-block">
        {report.summaryLines.map((line, idx) => (
          <p key={idx} className="cb-admin-pii-summary-line">
            {line}
          </p>
        ))}
      </div>

      <div className="cb-admin-pii-block">
        <h4 className="cb-admin-pii-block-title">탐지된 개인정보 항목</h4>
        {report.detectedItems.length === 0 ? (
          <p className="cb-admin-pii-empty">탐지된 개인정보 항목 없음.</p>
        ) : (
          <ul className="cb-admin-pii-list">
            {report.detectedItems.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="cb-admin-pii-block">
        <h4 className="cb-admin-pii-block-title">권장 조치</h4>
        <ol className="cb-admin-pii-actions">
          {report.recommendedActions.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ol>
      </div>

      <div className="cb-admin-pii-block cb-admin-pii-block--mask">
        <button
          type="button"
          className="cb-admin-ghost-btn cb-admin-pii-mask-toggle"
          disabled={!hasMaskedText}
          onClick={() => hasMaskedText && setShowMasked((prev) => !prev)}
        >
          {showMasked ? "마스킹된 텍스트 숨기기" : "마스킹된 텍스트 보기"}
        </button>

        {!hasMaskedText && (
          <p className="cb-admin-pii-hint">
            탐지된 개인정보가 없거나, 아직 마스킹된 텍스트가 생성되지
            않았습니다.
          </p>
        )}

        {hasMaskedText && showMasked && (
          <div className="cb-admin-pii-masked-text">
            <pre>{report.maskedText}</pre>
          </div>
        )}
      </div>

      <div className="cb-admin-pii-meta">
        <span>분석 모델: {report.modelName}</span>
        <span>분석 시간: {report.analyzedAt}</span>
        <span>분석 ID: {report.traceId}</span>
      </div>

      <p className="cb-admin-pii-disclaimer">
        ※ 로그 내 개인정보 여부는 AI 기반 자동 탐지 결과이며, 일부 누락이나
        오탐이 있을 수 있습니다. 민감도가 높은 사례는 반드시 보안 담당자의
        추가 검토를 거쳐 주세요.
      </p>
    </section>
  );
};

const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  onClose,
  anchor,
  onRequestFocus,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTabId>("chatbot");
  const [period, setPeriod] = useState<PeriodFilter>("30d");
  const [selectedDept, setSelectedDept] = useState<string>("ALL");

  // 계정/롤 관리용 상태: 사용자 리스트 + 선택 + 편집 버퍼
  const [userList, setUserList] = useState<AdminUserSummary[]>(MOCK_USERS);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    MOCK_USERS[0]?.id ?? null,
  );

  const [selectedRoles, setSelectedRoles] = useState<RoleKey[]>(
    MOCK_USERS[0]?.roles ?? ["EMPLOYEE"],
  );
  const [creatorType, setCreatorType] = useState<CreatorType>(
    MOCK_USERS[0]?.creatorType ?? null,
  );
  const [creatorDeptScope, setCreatorDeptScope] = useState<string[]>(
    MOCK_USERS[0]?.creatorDeptScope ??
      (MOCK_USERS[0] ? [MOCK_USERS[0].deptCode] : []),
  );

  // 계정/롤 관리용 검색/필터 상태
  const [accountMessage, setAccountMessage] = useState<AccountMessage | null>(
    null,
  );
  const [userSearchKeyword, setUserSearchKeyword] = useState("");
  const [userDeptFilter, setUserDeptFilter] = useState<string>("ALL");
  const [userRoleFilter, setUserRoleFilter] = useState<RoleKey | "ALL">("ALL");

  // 세부 로그 탭 필터 상태
  const [logDomainFilter, setLogDomainFilter] = useState<string>("ALL");
  const [logRouteFilter, setLogRouteFilter] = useState<string>("ALL");
  const [logModelFilter, setLogModelFilter] = useState<string>("ALL");
  const [logOnlyError, setLogOnlyError] = useState<boolean>(false);
  const [logHasPiiOnly, setLogHasPiiOnly] = useState<boolean>(false);
  const [showRagGapView, setShowRagGapView] = useState<boolean>(false);

  // 로그 탭이 아닌 곳으로 이동하면 RAG 갭 뷰는 자동 해제(탭 상태 혼선 방지)
  useEffect(() => {
    if (activeTab !== "logs" && showRagGapView) {
      setShowRagGapView(false);
    }
  }, [activeTab, showRagGapView]);

  /**
   * === 패널 크기 + 위치 (EduPanel / QuizPanel 과 동일 패턴) ===
   * - 초기 size 계산을 1회만 수행
   * - 드래그/리사이즈 중에도 viewport constraint를 일관되게 적용
   */
  const initialSize = useMemo<Size>(() => createInitialSize(), []);
  const initialPos = useMemo(
    () => computePanelPosition(anchor ?? null, initialSize),
    // initialSize는 memo이므로 안전
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [{ width: initW, height: initH }, setSize] = useState<Size>(() => {
    const { size } = clampPanelToViewport({ top: initialPos.top, left: initialPos.left }, initialSize);
    return size;
  });
  const [panelPos, setPanelPos] = useState(() => {
    const { pos } = clampPanelToViewport(
      { top: initialPos.top, left: initialPos.left },
      { width: initW, height: initH },
    );
    return pos;
  });

  // state refs (window 이벤트 핸들러에서 최신값 사용)
  const sizeRef = useRef<Size>({ width: initW, height: initH });
  const posRef = useRef<{ top: number; left: number }>(panelPos);

  useEffect(() => {
    sizeRef.current = { width: initW, height: initH };
  }, [initW, initH]);

  useEffect(() => {
    posRef.current = panelPos;
  }, [panelPos]);

  const resizeRef = useRef<ResizeState>({
    resizing: false,
    dir: null,
    startX: 0,
    startY: 0,
    startWidth: initW,
    startHeight: initH,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  const dragRef = useRef<DragState>({
    dragging: false,
    startX: 0,
    startY: 0,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  /**
   * 드래그 / 리사이즈 공통 이벤트
   * - listeners는 1회만 등록
   * - 내부에서 ref 기반으로 최신 size/pos를 읽고, viewport constraint 기반으로 클램프
   */
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      // 1) 리사이즈 중일 때
      if (resizeState.resizing && resizeState.dir) {
        const { minW, minH, maxW, maxH, margin, vw, vh } =
          getViewportConstraints();

        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        // 동/서 (width, left)
        if (resizeState.dir.includes("e")) {
          newWidth = clamp(resizeState.startWidth + dx, minW, maxW);
        }
        if (resizeState.dir.includes("w")) {
          const proposed = resizeState.startWidth - dx;
          if (proposed < minW) {
            newWidth = minW;
            newLeft = resizeState.startLeft + (resizeState.startWidth - minW);
          } else if (proposed > maxW) {
            newWidth = maxW;
            newLeft = resizeState.startLeft + (resizeState.startWidth - maxW);
          } else {
            newWidth = proposed;
            newLeft = resizeState.startLeft + dx;
          }
        }

        // 남/북 (height, top)
        if (resizeState.dir.includes("s")) {
          newHeight = clamp(resizeState.startHeight + dy, minH, maxH);
        }
        if (resizeState.dir.includes("n")) {
          const proposed = resizeState.startHeight - dy;
          if (proposed < minH) {
            newHeight = minH;
            newTop = resizeState.startTop + (resizeState.startHeight - minH);
          } else if (proposed > maxH) {
            newHeight = maxH;
            newTop = resizeState.startTop + (resizeState.startHeight - maxH);
          } else {
            newHeight = proposed;
            newTop = resizeState.startTop + dy;
          }
        }

        // 최종 위치 클램프 (패널이 화면 밖으로 못 나가게)
        const maxLeft = Math.max(margin, vw - margin - newWidth);
        const maxTop = Math.max(margin, vh - margin - newHeight);

        newLeft = clamp(newLeft, margin, maxLeft);
        newTop = clamp(newTop, margin, maxTop);

        const nextSize = { width: newWidth, height: newHeight };
        const nextPos = { top: newTop, left: newLeft };

        // ref를 즉시 갱신해서 “다음 move”에서 stale 값 사용 방지
        sizeRef.current = nextSize;
        posRef.current = nextPos;

        setSize(nextSize);
        setPanelPos(nextPos);
        return;
      }

      // 2) 드래그 중일 때
      if (dragState.dragging) {
        const { margin, vw, vh } = getViewportConstraints();

        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        const curSize = sizeRef.current;

        const maxLeft = Math.max(margin, vw - margin - curSize.width);
        const maxTop = Math.max(margin, vh - margin - curSize.height);

        const newLeft = clamp(dragState.startLeft + dx, margin, maxLeft);
        const newTop = clamp(dragState.startTop + dy, margin, maxTop);

        const nextPos = { top: newTop, left: newLeft };
        posRef.current = nextPos;
        setPanelPos(nextPos);
      }
    };

    const handleMouseUp = () => {
      if (resizeRef.current.resizing) {
        resizeRef.current.resizing = false;
        resizeRef.current.dir = null;
      }
      if (dragRef.current.dragging) {
        dragRef.current.dragging = false;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  /**
   * 뷰포트 리사이즈 시: 현재 패널 size/pos를 즉시 클램프
   * - “창을 키우거나 최대화했을 때 하단/우측이 막혀 이동 불가” 같은 케이스 방지
   */
  useEffect(() => {
    const onResize = () => {
      const curSize = sizeRef.current;
      const curPos = posRef.current;

      const { pos, size } = clampPanelToViewport(curPos, curSize);

      // 변화가 없으면 state 업데이트하지 않음(불필요 리렌더 방지)
      const sizeChanged = size.width !== curSize.width || size.height !== curSize.height;
      const posChanged = pos.left !== curPos.left || pos.top !== curPos.top;

      if (sizeChanged) {
        sizeRef.current = size;
        setSize(size);
      }
      if (posChanged) {
        posRef.current = pos;
        setPanelPos(pos);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /**
   * anchor가 바뀌어 재오픈/재배치가 필요한 경우:
   * - 드래그/리사이즈 중이 아닐 때만 위치를 재계산
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dragRef.current.dragging || resizeRef.current.resizing) return;

    const curSize = sizeRef.current;
    const nextRaw = computePanelPosition(anchor ?? null, curSize);
    const { pos } = clampPanelToViewport({ top: nextRaw.top, left: nextRaw.left }, curSize);

    posRef.current = pos;
    setPanelPos(pos);

  }, [anchor]);

  /**
   * 리사이즈 핸들 down
   */
  const handleResizeMouseDown =
    (dir: ResizeDirection) =>
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onRequestFocus?.();

      resizeRef.current = {
        resizing: true,
        dir,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: sizeRef.current.width,
        startHeight: sizeRef.current.height,
        startTop: posRef.current.top,
        startLeft: posRef.current.left,
      };
      dragRef.current.dragging = false;
    };

  /**
   * 상단 드래그 바 down
   */
  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    onRequestFocus?.();

    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: posRef.current.top,
      startLeft: posRef.current.left,
    };
    resizeRef.current.resizing = false;
    resizeRef.current.dir = null;
  };

  const handleRefreshClick = () => {
    console.log("[AdminDashboard] 데이터 새로고침", {
      activeTab,
      period,
      selectedDept,
    });
  };

  const handleToggleRole = (role: RoleKey) => {
    setSelectedRoles((prev) => {
      const exists = prev.includes(role);

      // 현재 선택된 사용자 (있으면)
      const currentUser =
        selectedUserId != null
          ? userList.find((u) => u.id === selectedUserId) ?? null
          : null;

      if (exists) {
        // EMPLOYEE 하나만 남은 상태에서 EMPLOYEE 해제 방지
        if (role === "EMPLOYEE" && prev.length === 1) {
          return prev;
        }

        const nextRoles = prev.filter((r) => r !== role);

        // VIDEO_CREATOR 해제 시 제작 권한/범위 초기화
        if (role === "VIDEO_CREATOR") {
          setCreatorType(null);
          if (currentUser) {
            setCreatorDeptScope([currentUser.deptCode]);
          } else {
            setCreatorDeptScope([]);
          }
        }

        return nextRoles;
      }

      // 새 역할 추가
      const nextRoles = [...prev, role];

      // VIDEO_CREATOR 추가 시 기본값 세팅
      if (role === "VIDEO_CREATOR" && currentUser) {
        setCreatorType("DEPT_CREATOR");
        setCreatorDeptScope([currentUser.deptCode]);
      }

      return nextRoles;
    });
  };

  const handleCreatorTypeChange = (next: CreatorType) => {
    if (!selectedUserId) {
      setAccountMessage({
        type: "warning",
        text: "먼저 왼쪽에서 권한을 수정할 사용자를 선택해 주세요.",
      });
      return;
    }

    const currentUser = userList.find((u) => u.id === selectedUserId);
    if (!currentUser) {
      setAccountMessage({
        type: "error",
        text: "선택된 사용자를 찾을 수 없습니다. 목록을 새로 고침한 뒤 다시 시도해 주세요.",
      });
      return;
    }

    setCreatorType(next);

    if (!next) {
      setCreatorDeptScope([currentUser.deptCode]);
      return;
    }

    if (next === "DEPT_CREATOR") {
      setCreatorDeptScope([currentUser.deptCode]);
    } else if (next === "GLOBAL_CREATOR") {
      setCreatorDeptScope(["ALL_ORG"]);
    }

    setAccountMessage({
      type: "info",
      text: "영상 제작자 유형이 변경되었습니다. 필요하다면 아래에서 제작 가능 부서를 조정해 주세요.",
    });
  };

  const handleScopeToggle = (deptId: string) => {
    setCreatorDeptScope((prev) => {
      const exists = prev.includes(deptId);
      if (exists) {
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== deptId);
      }
      return [...prev, deptId];
    });
  };

  const handleSaveAccountRoles = () => {
    if (!selectedUserId) {
      setAccountMessage({
        type: "warning",
        text: "왼쪽 목록에서 먼저 저장할 사용자를 선택해 주세요.",
      });
      return;
    }

    const targetUser = userList.find((u) => u.id === selectedUserId);
    if (!targetUser) {
      setAccountMessage({
        type: "error",
        text: "선택된 사용자를 찾을 수 없습니다. 목록을 새로 고침한 뒤 다시 선택해 주세요.",
      });
      return;
    }

    if (selectedRoles.length === 0) {
      setAccountMessage({
        type: "warning",
        text: "최소 한 개 이상의 기본 역할이 필요합니다. EMPLOYEE(기본) 역할은 항상 유지해 주세요.",
      });
      return;
    }

    if (selectedRoles.includes("VIDEO_CREATOR")) {
      if (!creatorType) {
        setAccountMessage({
          type: "warning",
          text: "VIDEO_CREATOR 권한에는 ‘부서 한정 제작자’ 또는 ‘전사 담당 제작자’ 유형을 선택해야 합니다.",
        });
        return;
      }
      if (creatorDeptScope.length === 0) {
        setAccountMessage({
          type: "warning",
          text: "영상 제작 권한을 부여할 부서를 최소 1개 이상 선택해 주세요.",
        });
        return;
      }
    }

    const nextUserList = userList.map((user) =>
      user.id === selectedUserId
        ? {
            ...user,
            roles: selectedRoles,
            creatorType,
            creatorDeptScope,
          }
        : user,
    );

    setUserList(nextUserList);

    console.log("[AdminDashboard] 계정/롤 설정 저장", {
      user: targetUser,
      nextRoles: selectedRoles,
      creatorType,
      creatorDeptScope,
    });

    setAccountMessage({
      type: "success",
      text: `${targetUser.name} 님의 계정/역할 설정이 저장되었습니다.`,
    });
  };

  const isRoleChecked = (role: RoleKey) => selectedRoles.includes(role);

  const selectedDeptLabel =
    DEPARTMENT_OPTIONS.find((d) => d.id === selectedDept)?.name ?? "전체 부서";

  /**
   * ========== 탭별 렌더러 ==========
   */

  const renderKpiRow = (items: KpiCard[]) => (
    <div className="cb-admin-kpi-row" aria-label="핵심 지표 요약">
      {items.map((kpi) => (
        <div key={kpi.id} className="cb-admin-kpi-card">
          <div className="cb-admin-kpi-header">
            <span className="cb-admin-kpi-dot" aria-hidden="true" />
            <span className="cb-admin-kpi-label">{kpi.label}</span>
          </div>
          <div className="cb-admin-kpi-value">{kpi.value}</div>
          {kpi.caption && (
            <div className="cb-admin-kpi-caption">{kpi.caption}</div>
          )}
        </div>
      ))}
    </div>
  );

  const renderChatbotTab = () => {
    const filterValue: CommonFilterState = {
      period,
      departmentId: selectedDept,
    };

    const handleFilterChange = (next: CommonFilterState) => {
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
    };

    const primaryKpis = CHATBOT_PRIMARY_KPIS_BY_PERIOD[period];
    const secondaryKpis = CHATBOT_SECONDARY_KPIS_BY_PERIOD[period];
    const volumeData = CHATBOT_VOLUME_BY_PERIOD[period];
    const domainData = CHATBOT_DOMAIN_SHARE_BY_PERIOD[period];
    const routeData = CHATBOT_ROUTE_SHARE_BY_PERIOD[period];
    const keywordData = POPULAR_KEYWORDS_BY_PERIOD[period];

    const max = Math.max(...volumeData.map((p) => p.count), 1);
    const total = volumeData.reduce((sum, p) => sum + p.count, 0);
    const avg = Math.round(total / volumeData.length);

    const hasErrorRatio = volumeData.some(
      (p) => typeof p.errorRatio === "number",
    );
    const avgErrorRatio =
      hasErrorRatio && volumeData.length > 0
        ? volumeData.reduce((sum, p) => sum + (p.errorRatio ?? 0), 0) /
          volumeData.length
        : null;

    return (
      <div className="cb-admin-tab-panel">
        <AdminFilterBar
          mode="overview"
          value={filterValue}
          onChange={handleFilterChange}
          departments={DEPARTMENT_OPTIONS}
          onRefresh={handleRefreshClick}
        />

        {renderKpiRow(primaryKpis)}
        {renderKpiRow(secondaryKpis)}

        <div className="cb-admin-section-row">
          <section className="cb-admin-section">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">질문 수 · 에러율 추이</h3>
              <span className="cb-admin-section-sub">
                기간별 질문량과 에러율을 함께 확인합니다.
              </span>
            </div>

            <div className="cb-admin-trend-summary">
              <div className="cb-admin-trend-pill">
                <span className="cb-admin-trend-label">기간 총 질문 수</span>
                <span className="cb-admin-trend-value">
                  {total.toLocaleString()}건
                </span>
              </div>
              <div className="cb-admin-trend-pill">
                <span className="cb-admin-trend-label">구간당 평균</span>
                <span className="cb-admin-trend-value">
                  {avg.toLocaleString()}건
                </span>
              </div>
              {avgErrorRatio !== null && (
                <div className="cb-admin-trend-pill">
                  <span className="cb-admin-trend-label">평균 에러율</span>
                  <span className="cb-admin-trend-value">
                    {(avgErrorRatio * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>

            <div className="cb-admin-bar-chart">
              {volumeData.map((point) => {
                const ratio = point.count / max;
                const widthPercent = 40 + ratio * 60; // 40% ~ 100%
                const width = `${Math.round(widthPercent)}%`;
                const errorRatioPercent =
                  typeof point.errorRatio === "number"
                    ? (point.errorRatio * 100).toFixed(1)
                    : null;

                return (
                  <div key={point.label} className="cb-admin-bar-row">
                    <span className="cb-admin-bar-label">{point.label}</span>
                    <div className="cb-admin-bar-track">
                      <div className="cb-admin-bar-fill" style={{ width }} />
                    </div>
                    <span className="cb-admin-bar-value">
                      {point.count.toLocaleString()}건
                      {errorRatioPercent && (
                        <span className="cb-admin-bar-subvalue">
                          {" · 에러율 "}
                          {errorRatioPercent}%
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="cb-admin-section">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">도메인별 질문 비율</h3>
              <span className="cb-admin-section-sub">
                규정 / FAQ / 교육 / 퀴즈 / 기타 비중
              </span>
            </div>
            <div className="cb-admin-domain-list">
              {domainData.map((item) => (
                <div key={item.id} className="cb-admin-domain-item">
                  <div className="cb-admin-domain-top">
                    <span className="cb-admin-domain-label">
                      {item.domainLabel}
                    </span>
                    <span className="cb-admin-domain-ratio">{item.ratio}%</span>
                  </div>
                  <div className="cb-admin-domain-track">
                    <div
                      className="cb-admin-domain-fill"
                      style={{ width: `${item.ratio}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">라우트별 질문 비율</h3>
            <span className="cb-admin-section-sub">
              RAG / LLM / Incident / FAQ 템플릿 등 라우팅 경로 기준 비중입니다.
            </span>
          </div>
          <div className="cb-admin-domain-list">
            {routeData.map((item) => (
              <div key={item.id} className="cb-admin-domain-item">
                <div className="cb-admin-domain-top">
                  <span className="cb-admin-domain-label">
                    {item.routeLabel}
                  </span>
                  <span className="cb-admin-domain-ratio">{item.ratio}%</span>
                </div>
                <div className="cb-admin-domain-track">
                  <div
                    className="cb-admin-domain-fill"
                    style={{ width: `${item.ratio}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">
              최근 많이 질문된 키워드 Top 5
            </h3>
          </div>
          <ul className="cb-admin-keyword-list">
            {keywordData.map((item) => (
              <li key={item.keyword} className="cb-admin-keyword-item">
                <span className="cb-admin-keyword-label">{item.keyword}</span>
                <span className="cb-admin-keyword-count">
                  {item.count.toLocaleString()}회
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  };

  const renderEducationTab = () => {
    const filterValue: CommonFilterState = {
      period,
      departmentId: selectedDept,
    };

    const handleFilterChange = (next: CommonFilterState) => {
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
    };

    const visibleDeptRows =
      selectedDept === "ALL"
        ? deptEducationRowsMock
        : deptEducationRowsMock.filter((row) => row.deptName === selectedDeptLabel);

    return (
      <div className="cb-admin-tab-panel">
        <AdminFilterBar
          mode="overview"
          value={filterValue}
          onChange={handleFilterChange}
          departments={DEPARTMENT_OPTIONS}
          onRefresh={handleRefreshClick}
        />
        {renderKpiRow(educationKpis)}

        <div className="cb-admin-section-row">
          <section className="cb-admin-section">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">4대 의무교육 이수율</h3>
            </div>
            <div className="cb-admin-bar-chart">
              {mandatoryCoursesMock.map((course) => (
                <div key={course.id} className="cb-admin-bar-row">
                  <span className="cb-admin-bar-label">{course.name}</span>
                  <div className="cb-admin-bar-track">
                    <div
                      className="cb-admin-bar-fill"
                      style={{ width: `${course.completionRate}%` }}
                    />
                  </div>
                  <span className="cb-admin-bar-value">
                    {course.completionRate}%
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="cb-admin-section">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">직무교육 이수 현황</h3>
            </div>
            <ul className="cb-admin-course-list">
              {jobCoursesMock.map((course) => (
                <li key={course.id} className="cb-admin-course-item">
                  <div className="cb-admin-course-main">
                    <span className="cb-admin-course-title">{course.title}</span>
                    <span className={`cb-admin-course-status is-${course.status}`}>
                      {course.status === "in-progress" && "진행 중"}
                      {course.status === "completed" && "이수 완료"}
                      {course.status === "not-started" && "미시작"}
                    </span>
                  </div>
                  <div className="cb-admin-course-meta">
                    학습자 {course.learnerCount}명
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">부서별 이수율 현황</h3>
          </div>
          <div className="cb-admin-table-wrapper">
            <table className="cb-admin-table">
              <thead>
                <tr>
                  <th>부서</th>
                  <th>대상자 수</th>
                  <th>이수자 수</th>
                  <th>이수율</th>
                  <th>미이수자 수</th>
                </tr>
              </thead>
              <tbody>
                {visibleDeptRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.deptName}</td>
                    <td>{row.targetCount}</td>
                    <td>{row.completedCount}</td>
                    <td>{row.completionRate}%</td>
                    <td>{row.targetCount - row.completedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  };

  const renderQuizTab = () => {
    const filterValue: CommonFilterState = {
      period,
      departmentId: selectedDept,
    };

    const handleFilterChange = (next: CommonFilterState) => {
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
    };

    const visibleDeptQuizRows =
      selectedDept === "ALL"
        ? deptQuizRowsMock
        : deptQuizRowsMock.filter((row) => row.deptName === selectedDeptLabel);

    return (
      <div className="cb-admin-tab-panel">
        <AdminFilterBar
          mode="overview"
          value={filterValue}
          onChange={handleFilterChange}
          departments={DEPARTMENT_OPTIONS}
          onRefresh={handleRefreshClick}
        />
        {renderKpiRow(quizKpis)}

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">부서별 평균 점수</h3>
          </div>
          <div className="cb-admin-bar-chart">
            {visibleDeptQuizRows.map((row) => {
              const width = `${Math.min(
                100,
                Math.round((row.avgScore / 100) * 100),
              )}%`;
              return (
                <div key={row.id} className="cb-admin-bar-row">
                  <span className="cb-admin-bar-label">{row.deptName}</span>
                  <div className="cb-admin-bar-track">
                    <div className="cb-admin-bar-fill" style={{ width }} />
                  </div>
                  <span className="cb-admin-bar-value">
                    {row.avgScore}점 / {row.participantCount}명
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">퀴즈별 통계</h3>
          </div>
          <div className="cb-admin-table-wrapper">
            <table className="cb-admin-table">
              <thead>
                <tr>
                  <th>퀴즈 제목</th>
                  <th>회차</th>
                  <th>평균 점수</th>
                  <th>응시 수</th>
                  <th>통과율</th>
                </tr>
              </thead>
              <tbody>
                {quizSummaryRowsMock.map((row) => (
                  <tr key={row.id}>
                    <td>{row.quizTitle}</td>
                    <td>{row.round}회차</td>
                    <td>{row.avgScore}점</td>
                    <td>{row.participantCount}명</td>
                    <td>{row.passRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="cb-admin-section">
          <div className="cb-admin-section-header">
            <h3 className="cb-admin-section-title">
              오답 비율이 높은 문제 Top 5
            </h3>
          </div>
          <ul className="cb-admin-keyword-list">
            {difficultQuestionsMock.map((q) => (
              <li key={q.id} className="cb-admin-keyword-item">
                <span className="cb-admin-keyword-label">{q.title}</span>
                <span className="cb-admin-keyword-count">
                  오답률 {q.wrongRate}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  };

  const renderMetricsTab = () => {
    const filterValue: CommonFilterState = {
      period,
      departmentId: selectedDept,
    };

    const handleFilterChange = (next: CommonFilterState) => {
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
    };

    const piiTrend = PII_TREND_BY_PERIOD[period];
    const latencyBuckets = LATENCY_BUCKET_BY_PERIOD[period];
    const modelLatency = MODEL_LATENCY_BY_PERIOD[period];

    const maxPiiRatio = Math.max(
      ...piiTrend.map((row) => Math.max(row.inputRatio, row.outputRatio)),
      1,
    );

    const maxLatencyCount = Math.max(...latencyBuckets.map((b) => b.count), 1);

    const periodLabel =
      PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? "";

    return (
      <div className="cb-admin-tab-panel">
        <AdminFilterBar
          mode="overview"
          value={filterValue}
          onChange={handleFilterChange}
          departments={DEPARTMENT_OPTIONS}
          onRefresh={handleRefreshClick}
        />

        <div className="cb-admin-section-row">
          <section className="cb-admin-section cb-admin-section--metric">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">보안 · PII 지표</h3>
              <span className="cb-admin-section-sub">
                PII 감지 및 보안 차단 이벤트를 요약해서 확인합니다.
              </span>
            </div>

            <ul className="cb-admin-metric-list">
              {securityMetricsMock.map((m) => (
                <li key={m.id} className="cb-admin-metric-item">
                  <div className="cb-admin-metric-main">
                    <span className="cb-admin-metric-label">{m.label}</span>
                    <span className="cb-admin-metric-value">{m.value}</span>
                  </div>
                  {m.description && (
                    <div className="cb-admin-metric-desc">{m.description}</div>
                  )}
                </li>
              ))}
            </ul>

            <div className="cb-admin-metric-chart">
              <div className="cb-admin-metric-chart-header">
                <div className="cb-admin-metric-chart-title">PII 감지 추이</div>
                <div className="cb-admin-metric-chart-legend">
                  <span className="cb-admin-metric-legend-dot cb-admin-metric-legend-dot--input" />
                  <span>입력 PII 비율</span>
                  <span className="cb-admin-metric-legend-separator">·</span>
                  <span className="cb-admin-metric-legend-dot cb-admin-metric-legend-dot--output" />
                  <span>출력 PII 비율</span>
                </div>
              </div>

              <div className="cb-admin-metric-chart-body cb-admin-metric-chart-body--pii">
                {piiTrend.map((point) => {
                  const inputWidth = `${Math.round(
                    (point.inputRatio / maxPiiRatio) * 100,
                  )}%`;
                  const outputWidth = `${Math.round(
                    (point.outputRatio / maxPiiRatio) * 100,
                  )}%`;

                  return (
                    <div key={point.label} className="cb-admin-metric-chart-row">
                      <div className="cb-admin-metric-chart-row-label">
                        {point.label}
                      </div>
                      <div className="cb-admin-metric-chart-row-bars">
                        <div className="cb-admin-metric-chart-track">
                          <div
                            className="cb-admin-metric-chart-bar cb-admin-metric-chart-bar--input"
                            style={{ width: inputWidth }}
                          />
                        </div>
                        <div className="cb-admin-metric-chart-track">
                          <div
                            className="cb-admin-metric-chart-bar cb-admin-metric-chart-bar--output"
                            style={{ width: outputWidth }}
                          />
                        </div>
                      </div>
                      <div className="cb-admin-metric-chart-row-value">
                        {point.inputRatio.toFixed(1)}% /{" "}
                        {point.outputRatio.toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="cb-admin-metric-chart-footer">
                <span className="cb-admin-metric-chart-footer-label">
                  기간 기준: {periodLabel}
                </span>
              </div>
            </div>
          </section>

          <section className="cb-admin-section cb-admin-section--metric">
            <div className="cb-admin-section-header">
              <h3 className="cb-admin-section-title">성능 · 장애 지표</h3>
              <span className="cb-admin-section-sub">
                응답 시간 분포와 에러 현황을 모니터링합니다.
              </span>
            </div>

            <ul className="cb-admin-metric-list">
              {qualityMetricsMock.map((m) => (
                <li key={m.id} className="cb-admin-metric-item">
                  <div className="cb-admin-metric-main">
                    <span className="cb-admin-metric-label">{m.label}</span>
                    <span className="cb-admin-metric-value">{m.value}</span>
                  </div>
                  {m.description && (
                    <div className="cb-admin-metric-desc">{m.description}</div>
                  )}
                </li>
              ))}
            </ul>

            <div className="cb-admin-metric-chart">
              <div className="cb-admin-metric-chart-header">
                <div className="cb-admin-metric-chart-title">응답 시간 분포</div>
                <div className="cb-admin-metric-chart-caption">
                  {periodLabel} 기준
                </div>
              </div>

              <div className="cb-admin-metric-chart-body">
                {latencyBuckets.map((bucket) => {
                  const width = `${Math.round(
                    (bucket.count / maxLatencyCount) * 100,
                  )}%`;
                  return (
                    <div key={bucket.label} className="cb-admin-metric-chart-row">
                      <div className="cb-admin-metric-chart-row-label">
                        {bucket.label}
                      </div>
                      <div className="cb-admin-metric-chart-track">
                        <div
                          className="cb-admin-metric-chart-bar cb-admin-metric-chart-bar--latency"
                          style={{ width }}
                        />
                      </div>
                      <div className="cb-admin-metric-chart-row-value">
                        {bucket.count.toLocaleString()}건
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="cb-admin-metric-chart-footer">
                <span className="cb-admin-metric-chart-footer-label">
                  모델별 평균 응답 시간
                </span>
                <div className="cb-admin-metric-pill-row">
                  {modelLatency.map((model) => (
                    <span key={model.id} className="cb-admin-metric-pill">
                      {model.modelLabel}
                      <span className="cb-admin-metric-pill-value">
                        {model.avgMs}ms
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  };

  const renderAccountsTab = () => {
    const currentUser =
      selectedUserId != null
        ? userList.find((u) => u.id === selectedUserId) ?? null
        : null;

    const isVideoCreatorChecked = selectedRoles.includes("VIDEO_CREATOR");

    const availableScopeOptions =
      creatorType === "GLOBAL_CREATOR"
        ? DEPT_SCOPE_OPTIONS.filter((d) => d.id === "ALL_ORG")
        : DEPT_SCOPE_OPTIONS.filter((d) => d.id !== "ALL_ORG");

    const selectedRoleLabels =
      selectedRoles.length === 0
        ? "선택된 역할 없음"
        : selectedRoles.map((r) => ROLE_LABELS[r]).join(", ");

    const filteredUsers = userList.filter((user) => {
      if (userDeptFilter !== "ALL" && user.deptCode !== userDeptFilter) {
        return false;
      }
      if (userRoleFilter !== "ALL" && !user.roles.includes(userRoleFilter)) {
        return false;
      }
      if (userSearchKeyword.trim()) {
        const kw = userSearchKeyword.trim().toLowerCase();
        const nameMatch = user.name.toLowerCase().includes(kw);
        const noMatch = user.employeeNo.includes(kw);
        if (!nameMatch && !noMatch) {
          return false;
        }
      }
      return true;
    });

    const handleSelectUser = (user: AdminUserSummary) => {
      setSelectedUserId(user.id);
      setSelectedRoles(user.roles);
      setCreatorType(user.creatorType ?? null);
      setCreatorDeptScope(
        user.creatorDeptScope && user.creatorDeptScope.length > 0
          ? user.creatorDeptScope
          : [user.deptCode],
      );
      setAccountMessage({
        type: "info",
        text: `${user.name} 님의 권한을 편집할 수 있습니다. 변경 후 우측 하단 ‘저장’ 버튼을 눌러 반영해 주세요.`,
      });
    };

    return (
      <div className="cb-admin-tab-panel">
        <div className="cb-admin-account-layout">
          <section className="cb-admin-account-card cb-admin-account-card--left">
            <h3 className="cb-admin-account-title">사용자 검색 / 선택</h3>
            <p className="cb-admin-hint">
              이름·사번·부서·역할로 필터링해서 계정을 선택한 뒤,
              우측에서 권한을 편집합니다.
            </p>

            <div className="cb-admin-account-search-row">
              <input
                type="text"
                className="cb-admin-input"
                placeholder="이름 또는 사번 검색"
                value={userSearchKeyword}
                onChange={(e) => setUserSearchKeyword(e.target.value)}
              />
              <select
                className="cb-admin-select"
                value={userDeptFilter}
                onChange={(e) => setUserDeptFilter(e.target.value)}
              >
                {DEPARTMENT_OPTIONS.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
              <select
                className="cb-admin-select"
                value={userRoleFilter}
                onChange={(e) =>
                  setUserRoleFilter(
                    e.target.value === "ALL"
                      ? "ALL"
                      : (e.target.value as RoleKey),
                  )
                }
              >
                <option value="ALL">전체 역할</option>
                {Object.entries(ROLE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="cb-admin-account-user-list">
              {filteredUsers.length === 0 ? (
                <div className="cb-admin-account-empty">
                  조건에 해당하는 사용자가 없습니다.
                </div>
              ) : (
                <ul>
                  {filteredUsers.map((user) => {
                    const isActive = user.id === selectedUserId;
                    return (
                      <li
                        key={user.id}
                        className={`cb-admin-account-user-item ${
                          isActive ? "is-active" : ""
                        }`}
                        onClick={() => handleSelectUser(user)}
                      >
                        <div className="cb-admin-account-user-main">
                          <span className="cb-admin-account-user-name">
                            {user.name}
                          </span>
                          <span className="cb-admin-account-user-meta">
                            {user.employeeNo} · {user.deptName}
                          </span>
                        </div>
                        <div className="cb-admin-account-user-roles">
                          {user.roles.map((role) => (
                            <span key={role} className="cb-admin-role-chip">
                              {role}
                            </span>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="cb-admin-account-card cb-admin-account-card--right">
            <h3 className="cb-admin-account-title">선택한 사용자 권한 편집</h3>

            {accountMessage && (
              <div className={`cb-admin-toast cb-admin-toast--${accountMessage.type}`}>
                {accountMessage.text}
              </div>
            )}

            {!currentUser ? (
              <p className="cb-admin-hint">
                왼쪽에서 계정을 선택하면 역할과 영상 제작 권한을 한 번에 편집할 수 있습니다.
              </p>
            ) : (
              <>
                <div className="cb-admin-account-selected">
                  <div className="cb-admin-account-selected-main">
                    <span className="cb-admin-account-selected-name">
                      {currentUser.name}
                    </span>
                    <span className="cb-admin-account-selected-meta">
                      {currentUser.employeeNo} · {currentUser.deptName}
                    </span>
                  </div>
                  <div className="cb-admin-account-selected-roles">
                    {currentUser.roles.map((role) => (
                      <span
                        key={role}
                        className="cb-admin-role-chip cb-admin-role-chip--current"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="cb-admin-account-subcard">
                  <h4 className="cb-admin-account-subtitle">역할(Role) 설정</h4>
                  <div className="cb-admin-role-checkboxes">
                    <label>
                      <input
                        type="checkbox"
                        checked={isRoleChecked("EMPLOYEE")}
                        onChange={() => handleToggleRole("EMPLOYEE")}
                      />
                      <span>EMPLOYEE (기본)</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={isRoleChecked("VIDEO_CREATOR")}
                        onChange={() => handleToggleRole("VIDEO_CREATOR")}
                      />
                      <span>VIDEO_CREATOR (영상 제작자)</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={isRoleChecked("CONTENTS_REVIEWER")}
                        onChange={() => handleToggleRole("CONTENTS_REVIEWER")}
                      />
                      <span>CONTENTS_REVIEWER (콘텐츠 검토자)</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={isRoleChecked("COMPLAINT_MANAGER")}
                        onChange={() => handleToggleRole("COMPLAINT_MANAGER")}
                      />
                      <span>COMPLAINT_MANAGER (신고 관리자)</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={isRoleChecked("SYSTEM_ADMIN")}
                        onChange={() => handleToggleRole("SYSTEM_ADMIN")}
                      />
                      <span>SYSTEM_ADMIN (시스템 관리자)</span>
                    </label>
                  </div>

                  <p className="cb-admin-hint">
                    현재 선택된 역할(편집 중 기준): {selectedRoleLabels}
                  </p>
                </div>

                <div className="cb-admin-account-subcard">
                  <h4 className="cb-admin-account-subtitle">영상 제작 권한 설정</h4>

                  <fieldset className="cb-admin-fieldset">
                    <legend>영상 제작자 유형</legend>
                    <div className="cb-admin-radio-group">
                      <label>
                        <input
                          type="radio"
                          name="creatorType"
                          value="DEPT_CREATOR"
                          disabled={!isVideoCreatorChecked}
                          checked={creatorType === "DEPT_CREATOR"}
                          onChange={() => handleCreatorTypeChange("DEPT_CREATOR")}
                        />
                        <span>부서 한정 제작자 (DEPT_CREATOR)</span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="creatorType"
                          value="GLOBAL_CREATOR"
                          disabled={!isVideoCreatorChecked}
                          checked={creatorType === "GLOBAL_CREATOR"}
                          onChange={() =>
                            handleCreatorTypeChange("GLOBAL_CREATOR")
                          }
                        />
                        <span>전사 담당 제작자 (GLOBAL_CREATOR)</span>
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="cb-admin-fieldset">
                    <legend>제작 가능 부서</legend>

                    {!isVideoCreatorChecked && (
                      <p className="cb-admin-hint">
                        VIDEO_CREATOR 역할을 선택하면 제작 가능 부서를 설정할 수 있습니다.
                      </p>
                    )}

                    {isVideoCreatorChecked && !creatorType && (
                      <p className="cb-admin-hint cb-admin-hint--warning">
                        먼저 영상 제작자 유형(DEPT_CREATOR / GLOBAL_CREATOR)을 선택해 주세요.
                      </p>
                    )}

                    {isVideoCreatorChecked && creatorType && (
                      <div className="cb-admin-scope-grid">
                        {availableScopeOptions.map((dept) => (
                          <label key={dept.id} className="cb-admin-scope-item">
                            <input
                              type="checkbox"
                              value={dept.id}
                              checked={creatorDeptScope.includes(dept.id)}
                              onChange={() => handleScopeToggle(dept.id)}
                            />
                            <span>{dept.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>
                </div>

                <div className="cb-admin-account-actions">
                  <button
                    type="button"
                    className="cb-admin-secondary-btn"
                    onClick={() => {
                      setSelectedRoles(currentUser.roles);
                      setCreatorType(currentUser.creatorType ?? null);
                      setCreatorDeptScope(
                        currentUser.creatorDeptScope &&
                          currentUser.creatorDeptScope.length > 0
                          ? currentUser.creatorDeptScope
                          : [currentUser.deptCode],
                      );
                      setAccountMessage({
                        type: "info",
                        text: "화면의 변경 사항을 선택된 사용자 기준 값으로 되돌렸습니다.",
                      });
                    }}
                  >
                    되돌리기
                  </button>
                  <button
                    type="button"
                    className="cb-admin-primary-btn"
                    onClick={handleSaveAccountRoles}
                  >
                    저장
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    );
  };

  const renderLogsTab = () => {
    const filterValue: CommonFilterState = {
      period,
      departmentId: selectedDept,
      domainId: logDomainFilter,
      routeId: logRouteFilter,
      modelId: logModelFilter,
      onlyError: logOnlyError,
      hasPiiOnly: logHasPiiOnly,
    };

    const handleFilterChange = (next: CommonFilterState) => {
      if (next.period && next.period !== period) {
        setPeriod(next.period as PeriodFilter);
      }
      if (next.departmentId && next.departmentId !== selectedDept) {
        setSelectedDept(next.departmentId);
      }
      if (typeof next.domainId !== "undefined") {
        setLogDomainFilter(next.domainId);
      }
      if (typeof next.routeId !== "undefined") {
        setLogRouteFilter(next.routeId);
      }
      if (typeof next.modelId !== "undefined") {
        setLogModelFilter(next.modelId);
      }
      if (typeof next.onlyError !== "undefined") {
        setLogOnlyError(next.onlyError);
      }
      if (typeof next.hasPiiOnly !== "undefined") {
        setLogHasPiiOnly(next.hasPiiOnly);
      }
    };

    const selectedDeptNameForLogs =
      selectedDept === "ALL" ? null : selectedDeptLabel;

    const filteredItems = LOG_LIST_MOCK.filter((item) => {
      if (selectedDeptNameForLogs && item.department !== selectedDeptNameForLogs) {
        return false;
      }
      if (logDomainFilter !== "ALL" && item.domain !== logDomainFilter) {
        return false;
      }
      if (logRouteFilter !== "ALL" && item.route !== logRouteFilter) {
        return false;
      }
      if (logModelFilter !== "ALL" && item.modelName !== logModelFilter) {
        return false;
      }
      if (logOnlyError && !item.errorCode) {
        return false;
      }
      if (logHasPiiOnly && !item.hasPiiInput && !item.hasPiiOutput) {
        return false;
      }
      return true;
    });

    const totalCount = filteredItems.length;
    const errorCount = filteredItems.filter((i) => i.errorCode).length;

    const piiInputCount = filteredItems.filter((i) => i.hasPiiInput).length;
    const piiOutputCount = filteredItems.filter((i) => i.hasPiiOutput).length;
    const piiCount = filteredItems.filter(
      (i) => i.hasPiiInput || i.hasPiiOutput,
    ).length;

    const errorRatioInLogs = totalCount > 0 ? (errorCount / totalCount) * 100 : 0;
    const piiRatioInLogs = totalCount > 0 ? (piiCount / totalCount) * 100 : 0;

    const inputRatioInLogs = totalCount > 0 ? (piiInputCount / totalCount) * 100 : 0;
    const outputRatioInLogs = totalCount > 0 ? (piiOutputCount / totalCount) * 100 : 0;

    let riskLevel: PiiRiskLevel = "none";
    if (totalCount > 0 && piiCount > 0) {
      if (outputRatioInLogs >= 5 || piiOutputCount >= 3) {
        riskLevel = "high";
      } else if (
        outputRatioInLogs === 0 &&
        (inputRatioInLogs >= 20 || piiInputCount >= 15)
      ) {
        riskLevel = "high";
      } else {
        riskLevel = "warning";
      }
    }

    let activePiiReport: PiiReport;
    switch (riskLevel) {
      case "none":
        activePiiReport = PII_REPORT_NONE;
        break;
      case "high":
        activePiiReport = PII_REPORT_HIGH;
        break;
      case "warning":
      default:
        activePiiReport = PII_REPORT_WARNING;
        break;
    }

    const periodLabel =
      PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? "전체 기간";
    const logDomainLabel =
      LOG_DOMAIN_OPTIONS.find((d) => d.id === logDomainFilter)?.label ??
      "전체 도메인";
    const logRouteLabel =
      LOG_ROUTE_OPTIONS.find((r) => r.id === logRouteFilter)?.label ??
      "전체 라우트";
    const logModelLabel =
      LOG_MODEL_OPTIONS.find((m) => m.id === logModelFilter)?.label ??
      "전체 모델";

    const contextParts: string[] = [
      `기간 ${periodLabel}`,
      `부서 ${selectedDeptLabel}`,
      `도메인 ${logDomainLabel}`,
      `라우트 ${logRouteLabel}`,
      `모델 ${logModelLabel}`,
    ];

    if (logOnlyError) contextParts.push("에러 로그만");
    if (logHasPiiOnly) contextParts.push("PII 포함 로그만");

    const piiContextSummary = contextParts.join(" · ");

    return (
      <div className="cb-admin-tab-panel cb-admin-tab-panel--logs">
        <AdminFilterBar
          mode="logs"
          value={filterValue}
          onChange={handleFilterChange}
          departments={DEPARTMENT_OPTIONS}
          domainOptions={LOG_DOMAIN_OPTIONS}
          routeOptions={LOG_ROUTE_OPTIONS}
          modelOptions={LOG_MODEL_OPTIONS}
          onRefresh={handleRefreshClick}
        />

        <section className="cb-admin-section cb-admin-section--logs-drilldown">
          <div className="cb-admin-section-header cb-admin-section-header--logs">
            <div className="cb-admin-section-header-main">
              <h3 className="cb-admin-section-title">
                {showRagGapView ? "RAG 갭 분석" : "세부 로그 Drilldown"}
              </h3>
              <span className="cb-admin-section-sub">
                {showRagGapView
                  ? "RAG 검색 실패·갭 후보를 모아서 어떤 규정/교육 문서가 추가로 필요할지 확인합니다."
                  : "시간 / 도메인 / 라우트 / 모델 / PII(입력/출력) / 에러 기준으로 필터링해서 턴 단위 로그를 확인합니다."}
              </span>
            </div>
            <button
              type="button"
              className="cb-admin-ghost-btn"
              onClick={() => setShowRagGapView((prev) => !prev)}
            >
              {showRagGapView ? "전체 로그 보기" : "RAG 갭 분석"}
            </button>
          </div>

          {showRagGapView ? (
            <AdminRagGapView filterValue={filterValue} />
          ) : (
            <>
              <PiiReportCard report={activePiiReport} contextSummary={piiContextSummary} />

              <div className="cb-admin-trend-summary">
                <div className="cb-admin-trend-pill">
                  <span className="cb-admin-trend-label">총 로그</span>
                  <span className="cb-admin-trend-value">
                    {totalCount.toLocaleString()}건
                  </span>
                </div>
                <div className="cb-admin-trend-pill">
                  <span className="cb-admin-trend-label">에러 로그</span>
                  <span className="cb-admin-trend-value">
                    {errorCount.toLocaleString()}건
                    {totalCount > 0 && ` (${errorRatioInLogs.toFixed(1)}%)`}
                  </span>
                </div>
                <div className="cb-admin-trend-pill">
                  <span className="cb-admin-trend-label">PII 포함</span>
                  <span className="cb-admin-trend-value">
                    {piiCount.toLocaleString()}건
                    {totalCount > 0 && ` (${piiRatioInLogs.toFixed(1)}%)`}
                  </span>
                </div>
              </div>

              <div className="cb-admin-table-wrapper cb-admin-table-wrapper--logs">
                <table className="cb-admin-table cb-admin-table--logs">
                  <thead>
                    <tr>
                      <th>시간</th>
                      <th>user_id</th>
                      <th>user_role</th>
                      <th>부서</th>
                      <th>domain</th>
                      <th>route</th>
                      <th>model</th>
                      <th>PII (입력/출력)</th>
                      <th>latency(ms)</th>
                      <th>error_code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={10} className="cb-admin-table-empty">
                          조건에 해당하는 로그가 없습니다.
                        </td>
                      </tr>
                    )}
                    {filteredItems.map((item) => {
                      const hasError = !!item.errorCode;
                      const hasPii = item.hasPiiInput || item.hasPiiOutput;

                      return (
                        <tr
                          key={item.id}
                          className={hasError ? "cb-admin-log-row--error" : ""}
                        >
                          <td>{item.createdAt}</td>
                          <td>{item.userId}</td>
                          <td>{item.userRole}</td>
                          <td>{item.department}</td>
                          <td>{item.domain}</td>
                          <td>{item.route}</td>
                          <td>{item.modelName}</td>
                          <td>
                            {hasPii ? (
                              <span className="cb-admin-badge cb-admin-badge--pii">
                                {item.hasPiiInput && "입력"}
                                {item.hasPiiInput && item.hasPiiOutput && " / "}
                                {item.hasPiiOutput && "출력"}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>{item.latencyMsTotal.toLocaleString()}</td>
                          <td>
                            {hasError ? (
                              <span className="cb-admin-log-error-code">
                                {item.errorCode}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    );
  };

  /**
   * ========== 최상위 렌더링 ==========
   */
  const panelStyle: React.CSSProperties = {
    position: "fixed",
    top: panelPos.top,
    left: panelPos.left,
    width: sizeRef.current.width,
    height: sizeRef.current.height,
    zIndex: 9999,
    pointerEvents: "auto",
  };

  const activeTabLabel = TAB_LABELS[activeTab];

  return (
    <div
      className="cb-admin-panel-container"
      style={panelStyle}
      onMouseDownCapture={() => onRequestFocus?.()}
    >
      <div className="cb-admin-root" style={{ position: "relative" }}>
        <div className="cb-drag-bar" onMouseDown={handleDragMouseDown} />

        <div
          className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-nw"
          onMouseDown={handleResizeMouseDown("nw")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-ne"
          onMouseDown={handleResizeMouseDown("ne")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-sw"
          onMouseDown={handleResizeMouseDown("sw")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-se"
          onMouseDown={handleResizeMouseDown("se")}
        />

        <div
          className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-n"
          onMouseDown={handleResizeMouseDown("n")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-s"
          onMouseDown={handleResizeMouseDown("s")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-w"
          onMouseDown={handleResizeMouseDown("w")}
        />
        <div
          className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-e"
          onMouseDown={handleResizeMouseDown("e")}
        />

        <header className="cb-admin-header">
          <div className="cb-admin-header-main">
            <div className="cb-admin-header-title-row">
              <span className="cb-admin-badge">SYSTEM ADMIN</span>
              <h2 className="cb-admin-title">관리자 대시보드</h2>
            </div>
            <p className="cb-admin-subtitle">
              챗봇, 교육, 퀴즈, 지표, 로그를 한 곳에서 관리하고 운영 상태를
              모니터링합니다.
            </p>

            <div className="cb-admin-header-context">
              <span className="cb-admin-context-chip">
                현재 <strong>{activeTabLabel}</strong> 기준으로 요약을 보고
                있습니다.
              </span>
              <span className="cb-admin-context-meta">
                기간{" "}
                <strong>
                  {PERIOD_OPTIONS.find((p) => p.id === period)?.label}
                </strong>
                · 부서 <strong>{selectedDeptLabel}</strong>
              </span>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              className="cb-admin-header-close-btn"
              onClick={onClose}
              aria-label="관리자 대시보드 닫기"
            >
              ✕
            </button>
          )}
        </header>

        <nav className="cb-admin-tabs" aria-label="관리자 대시보드 탭">
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "chatbot" ? "is-active" : ""}`}
            onClick={() => setActiveTab("chatbot")}
          >
            <span className="cb-admin-tab-label">챗봇</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "education" ? "is-active" : ""}`}
            onClick={() => setActiveTab("education")}
          >
            <span className="cb-admin-tab-label">교육</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "quiz" ? "is-active" : ""}`}
            onClick={() => setActiveTab("quiz")}
          >
            <span className="cb-admin-tab-label">퀴즈</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "metrics" ? "is-active" : ""}`}
            onClick={() => setActiveTab("metrics")}
          >
            <span className="cb-admin-tab-label">지표</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "logs" ? "is-active" : ""}`}
            onClick={() => setActiveTab("logs")}
          >
            <span className="cb-admin-tab-label">로그</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "accounts" ? "is-active" : ""}`}
            onClick={() => setActiveTab("accounts")}
          >
            <span className="cb-admin-tab-label">계정/롤 관리</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${activeTab === "policy" ? "is-active" : ""}`}
            onClick={() => setActiveTab("policy")}
          >
            <span className="cb-admin-tab-label">사규 관리</span>
          </button>
        </nav>

        <div className="cb-admin-content">
          {activeTab === "chatbot" && renderChatbotTab()}
          {activeTab === "education" && renderEducationTab()}
          {activeTab === "quiz" && renderQuizTab()}
          {activeTab === "metrics" && renderMetricsTab()}
          {activeTab === "logs" && renderLogsTab()}
          {activeTab === "policy" && (
            <div className="cb-admin-tab-panel cb-admin-tab-panel--policy">
              <AdminPolicyView />
            </div>
          )}
          {activeTab === "accounts" && renderAccountsTab()}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboardView;
