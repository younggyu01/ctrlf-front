// src/components/chatbot/AdminDashboardView.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  computePanelPosition,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";
import type { CommonFilterState } from "./adminFilterTypes";
import AdminPolicyTab from "./components/tabs/AdminPolicyTab";
import AdminNotifications from "./AdminNotifications";
import type {
  AdminTabId,
  PeriodFilter,
  RoleKey,
  CreatorType,
  AdminUserSummary,
  AccountMessage,
} from "./adminDashboardTypes";

import {
  PERIOD_OPTIONS,
  DEPARTMENT_OPTIONS,
  TAB_LABELS,
  MOCK_USERS,
} from "./adminDashboardMocks";

// 탭 컴포넌트 import
import AdminChatbotTab from "./components/tabs/AdminChatbotTab";
import AdminEducationTab from "./components/tabs/AdminEducationTab";
import AdminQuizTab from "./components/tabs/AdminQuizTab";
import AdminMetricsTab from "./components/tabs/AdminMetricsTab";
import AdminLogsTab from "./components/tabs/AdminLogsTab";
import AdminAccountsTab from "./components/tabs/AdminAccountsTab";
import AdminFAQTab from "./components/tabs/AdminFAQTab";

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
    MOCK_USERS[0]?.id ?? null
  );

  const [selectedRoles, setSelectedRoles] = useState<RoleKey[]>(
    MOCK_USERS[0]?.roles ?? ["EMPLOYEE"]
  );
  const [creatorType, setCreatorType] = useState<CreatorType>(
    MOCK_USERS[0]?.creatorType ?? null
  );
  const [creatorDeptScope, setCreatorDeptScope] = useState<string[]>(
    MOCK_USERS[0]?.creatorDeptScope ??
      (MOCK_USERS[0] ? [MOCK_USERS[0].deptCode] : [])
  );

  // 계정/롤 관리용 검색/필터 상태
  const [accountMessage, setAccountMessage] = useState<AccountMessage | null>(
    null
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

  // 알림 관련 상태
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  // 알림 모달 열기 핸들러
  // 읽음 처리는 AdminNotifications 컴포넌트 내부에서 처리
  const handleOpenNotificationModal = () => {
    setIsNotificationModalOpen(true);
  };

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
    []
  );

  const [{ width: initW, height: initH }, setSize] = useState<Size>(() => {
    const { size } = clampPanelToViewport(
      { top: initialPos.top, left: initialPos.left },
      initialSize
    );
    return size;
  });
  const [panelPos, setPanelPos] = useState(() => {
    const { pos } = clampPanelToViewport(
      { top: initialPos.top, left: initialPos.left },
      { width: initW, height: initH }
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
      const sizeChanged =
        size.width !== curSize.width || size.height !== curSize.height;
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
    const { pos } = clampPanelToViewport(
      { top: nextRaw.top, left: nextRaw.left },
      curSize
    );

    posRef.current = pos;
    setPanelPos(pos);
  }, [anchor]);

  /**
   * 리사이즈 핸들 down
   */
  const handleResizeMouseDown =
    (dir: ResizeDirection) => (event: React.MouseEvent<HTMLDivElement>) => {
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
        : user
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

  const selectedDeptLabel =
    DEPARTMENT_OPTIONS.find((d) => d.id === selectedDept)?.name ?? "전체 부서";

  // 필터 변경 핸들러
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

  // Accounts 탭 핸들러들
  const handleSelectUser = (user: AdminUserSummary) => {
    setSelectedUserId(user.id);
    setSelectedRoles(user.roles);
    setCreatorType(user.creatorType ?? null);
    setCreatorDeptScope(
      user.creatorDeptScope && user.creatorDeptScope.length > 0
        ? user.creatorDeptScope
        : [user.deptCode]
    );
    setAccountMessage({
      type: "info",
      text: `${user.name} 님의 권한을 편집할 수 있습니다. 변경 후 우측 하단 '저장' 버튼을 눌러 반영해 주세요.`,
    });
  };

  const handleResetAccountRoles = () => {
    if (!selectedUserId) return;
    const currentUser = userList.find((u) => u.id === selectedUserId);
    if (!currentUser) return;

    setSelectedRoles(currentUser.roles);
    setCreatorType(currentUser.creatorType ?? null);
    setCreatorDeptScope(
      currentUser.creatorDeptScope && currentUser.creatorDeptScope.length > 0
        ? currentUser.creatorDeptScope
        : [currentUser.deptCode]
    );
    setAccountMessage({
      type: "info",
      text: "화면의 변경 사항을 선택된 사용자 기준 값으로 되돌렸습니다.",
    });
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

          <div className="cb-admin-header-actions">
            {/* 알림 버튼 */}
            <button
              type="button"
              className="cb-admin-notif-btn"
              onClick={handleOpenNotificationModal}
              aria-label="알림"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadNotificationCount > 0 && (
                <span className="cb-admin-notif-badge">
                  {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                </span>
              )}
            </button>

            {/* 닫기 버튼 */}
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
          </div>
        </header>

        {/* 알림 모달 */}
        <AdminNotifications
          isOpen={isNotificationModalOpen}
          onClose={() => setIsNotificationModalOpen(false)}
          unreadCount={unreadNotificationCount}
          onUnreadCountChange={setUnreadNotificationCount}
        />

        <nav className="cb-admin-tabs" aria-label="관리자 대시보드 탭">
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "chatbot" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("chatbot")}
          >
            <span className="cb-admin-tab-label">챗봇</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "education" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("education")}
          >
            <span className="cb-admin-tab-label">교육</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "quiz" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("quiz")}
          >
            <span className="cb-admin-tab-label">퀴즈</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "metrics" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("metrics")}
          >
            <span className="cb-admin-tab-label">지표</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "logs" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("logs")}
          >
            <span className="cb-admin-tab-label">로그</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "accounts" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("accounts")}
          >
            <span className="cb-admin-tab-label">계정/롤 관리</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "policy" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("policy")}
          >
            <span className="cb-admin-tab-label">사규 관리</span>
          </button>
          <button
            type="button"
            className={`cb-admin-tab-btn ${
              activeTab === "faq" ? "is-active" : ""
            }`}
            onClick={() => setActiveTab("faq")}
          >
            <span className="cb-admin-tab-label">FAQ</span>
          </button>
        </nav>

        <div className="cb-admin-content">
          {activeTab === "chatbot" && (
            <AdminChatbotTab
              period={period}
              selectedDept={selectedDept}
              selectedDeptLabel={selectedDeptLabel}
              onFilterChange={handleFilterChange}
            />
          )}
          {activeTab === "education" && (
            <AdminEducationTab
              period={period}
              selectedDept={selectedDept}
              selectedDeptLabel={selectedDeptLabel}
              onFilterChange={handleFilterChange}
            />
          )}
          {activeTab === "quiz" && (
            <AdminQuizTab
              period={period}
              selectedDept={selectedDept}
              selectedDeptLabel={selectedDeptLabel}
              onFilterChange={handleFilterChange}
            />
          )}
          {activeTab === "metrics" && (
            <AdminMetricsTab
              period={period}
              selectedDept={selectedDept}
              onFilterChange={handleFilterChange}
            />
          )}
          {activeTab === "logs" && (
            <AdminLogsTab
              period={period}
              selectedDept={selectedDept}
              selectedDeptLabel={selectedDeptLabel}
              logDomainFilter={logDomainFilter}
              logRouteFilter={logRouteFilter}
              logModelFilter={logModelFilter}
              logOnlyError={logOnlyError}
              logHasPiiOnly={logHasPiiOnly}
              onFilterChange={handleFilterChange}
            />
          )}
          {activeTab === "policy" && (
            <div className="cb-admin-tab-panel cb-admin-tab-panel--policy">
              <AdminPolicyTab />
            </div>
          )}
          {activeTab === "faq" && (
            <div className="cb-admin-tab-panel cb-admin-tab-panel--faq">
              <AdminFAQTab />
            </div>
          )}
          {activeTab === "accounts" && <AdminAccountsTab />}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboardView;
