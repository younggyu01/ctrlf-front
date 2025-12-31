// src/components/chatbot/QuizPanel.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./chatbot.css";
import { computePanelPosition, type Anchor, type PanelSize } from "../../utils/chat";
import type { QuizCourse, QuizQuestion, WrongAnswerEntry } from "./quizData";
import {
  normalizeUnlockedFromStatus,
  formatScore,
  scoreToPercent,
  QUIZ_ATTEMPT_FALLBACK,
} from "./quizData";
import {
  getQuizAvailableEducations,
  getQuizDepartmentStats,
  getQuizEducationAttempts,
  getQuizRetryInfo,
  getQuizTimer,
  getQuizWrongs,
  postQuizLeave,
  putQuizTimer,
  saveQuizAnswers,
  startQuiz,
  submitQuizAnswers,
  type QuizAttemptSummary,
  type QuizDepartmentStat,
  type QuizQuestionItem,
} from "./educationServiceApi";

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

const MIN_WIDTH = 520;
const MIN_HEIGHT = 420;
const INITIAL_SIZE: Size = { width: 540, height: 420 };

// local UI 기준(서버가 내려주는 passScore는 result에서 확인 가능)
const DEFAULT_PASSING_SCORE = 80;

// =========================
// 패널 이동 정책 (EduPanel과 동일)
// =========================
const ALLOW_OVERLAP_APP_HEADER = true;
const KEEP_VISIBLE_X = 120;
const KEEP_VISIBLE_Y = 80;
const EDGE_MARGIN = 0;
const DOCK_SAFE_RIGHT = 60;
const DOCK_SAFE_BOTTOM = 60;

const QUIZ_LAYER_Z = 2147483000;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseCssPx(v: string): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const num = Number(s.replace("px", "").trim());
  return Number.isFinite(num) ? num : null;
}

function readAppHeaderSafeTop(): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;

  try {
    const rootStyle = window.getComputedStyle(document.documentElement);

    const v1 = parseCssPx(rootStyle.getPropertyValue("--app-header-safe-top"));
    if (v1 !== null) return clamp(v1, 0, 200);

    const v2 = parseCssPx(rootStyle.getPropertyValue("--app-header-height"));
    if (v2 !== null) return clamp(v2, 0, 200);

    const headerEl =
      document.querySelector<HTMLElement>("[data-app-header]") ??
      document.querySelector<HTMLElement>("header");

    if (headerEl) {
      const h = headerEl.getBoundingClientRect().height;
      if (Number.isFinite(h) && h > 0) return clamp(h, 0, 200);
    }
  } catch {
    // ignore
  }

  return 72;
}

function getMinTop(topSafe: number) {
  return ALLOW_OVERLAP_APP_HEADER ? 0 : topSafe;
}

function clampPanelPos(pos: { top: number; left: number }, size: Size, minTop: number) {
  if (typeof window === "undefined") return pos;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const keepX = Math.min(KEEP_VISIBLE_X, Math.max(48, size.width - 48));
  const keepY = Math.min(KEEP_VISIBLE_Y, Math.max(40, size.height - 40));

  const rawLeftMin = -size.width + keepX;
  const rawLeftMax = vw - keepX;

  const rawTopMin = ALLOW_OVERLAP_APP_HEADER ? -size.height + keepY : minTop;
  const rawTopMax = vh - keepY;

  const leftMin = Math.min(rawLeftMin, rawLeftMax);
  const leftMax = Math.max(rawLeftMin, rawLeftMax);
  const topMin = Math.min(rawTopMin, rawTopMax);
  const topMax = Math.max(rawTopMin, rawTopMax);

  return {
    left: clamp(pos.left, leftMin, leftMax),
    top: clamp(pos.top, topMin, topMax),
  };
}

function computeDockFallbackPos(size: Size) {
  if (typeof window === "undefined") return { top: 80, left: 120 };

  const left = window.innerWidth - EDGE_MARGIN - size.width - DOCK_SAFE_RIGHT;
  const top = window.innerHeight - EDGE_MARGIN - size.height - DOCK_SAFE_BOTTOM;

  return { top, left };
}

// =========================
// UI 타입
// =========================

type DepartmentScore = {
  id: string;
  name: string;
  avgScore: number; // 0~100
  progress: number; // 0~100
  participantCount: number;
};

interface QuizPanelProps {
  anchor?: Anchor | null;
  onClose: () => void;
  onOpenNote?: (courseId: string) => void;
  unlockedCourseIds?: string[];
  onExamModeChange?: (isExamMode: boolean) => void;
  onRequestFocus?: () => void;
  zIndex?: number;
  initialCourseId?: string;
}

type PanelMode = "dashboard" | "solve" | "note";

type ResultType = "success" | "warning" | "info";

type ResultMessage = {
  type: ResultType;
  title: string;
  description?: string;
};

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; savedAt?: string }
  | { status: "error"; message: string };

type RetryInfoUi = {
  canRetry: boolean | null;
  remainingAttempts: number | null;
  maxAttempts: number | null;
  usedAttempts: number | null;
  nextAvailableAt: string | null;
  reason: string | null;
  _raw?: unknown;
};

type SolveSession = {
  course: QuizCourse;
  attemptId: string;
  attemptNo?: number;
  questions: QuizQuestion[];
  passScore?: number | null; // 서버 DTO 우선
  retryInfo?: RetryInfoUi | null; // 서버 retry-info 우선
};

type CourseMeta = {
  passScore?: number | null;
  retryInfo?: RetryInfoUi | null;
};

function toUiDepartmentStats(stats: QuizDepartmentStat[]): DepartmentScore[] {
  return stats.map((s, idx) => ({
    id: `${s.departmentName}-${idx}`,
    name: s.departmentName,
    avgScore: Math.round(s.averageScore),
    progress: Math.round(s.progressPercent),
    participantCount: Math.round(s.participantCount),
  }));
}

function toUiCourses(raw: Awaited<ReturnType<typeof getQuizAvailableEducations>>): QuizCourse[] {
  return raw.map((r) => ({
    id: r.educationId,
    title: r.title,
    category: r.category ?? null,
    eduType: r.eduType ?? null,
    educationStatus: r.educationStatus ?? null,
    unlocked: normalizeUnlockedFromStatus(r.educationStatus),
    attemptCount: r.attemptCount ?? 0,
    maxAttempts: r.maxAttempts ?? null,
    hasAttempted: Boolean(r.hasAttempted),
    bestScore: r.bestScore ?? null,
    passed: r.passed ?? null,
  }));
}

function toUiQuestions(items: QuizQuestionItem[]): QuizQuestion[] {
  return items
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((q) => ({
      id: q.questionId,
      order: q.order ?? 0,
      question: q.question ?? "",
      choices: Array.isArray(q.choices) ? q.choices : [],
      userSelectedIndex: q.userSelectedIndex ?? null,
    }));
}

function safeErrorMessage(err: unknown): string {
  if (!err) return "알 수 없는 오류가 발생했습니다.";
  if (typeof err === "string") return err;

  if (err instanceof Error) {
    const msg = err.message?.trim();
    return msg ? msg : "요청 처리 중 오류가 발생했습니다.";
  }

  if (typeof err === "object") {
    const rec = err as Record<string, unknown>;
    const m = typeof rec.message === "string" ? rec.message : "";
    const e = typeof rec.error === "string" ? rec.error : "";
    const s = typeof rec.status === "number" ? ` (status: ${rec.status})` : "";
    const picked = (m || e).trim();
    if (picked) return `${picked}${s}`;
    if (s) return `요청 처리 중 오류가 발생했습니다.${s}`;
  }

  return "요청 처리 중 오류가 발생했습니다.";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * attemptNo 추출 (DTO/환경별 키 변형 흡수)
 * - attemptNo / attempt_no / attempt-no
 */
function normalizeAttemptNo(dto: unknown): number | null {
  if (!isRecord(dto)) return null;
  const v = (dto as Record<string, unknown>).attemptNo ?? (dto as Record<string, unknown>)["attempt_no"] ?? (dto as Record<string, unknown>)["attempt-no"];
  return pickNumber(v);
}

/**
 * 서버 DTO passScore 키 변형 대응:
 * - passScore / pass_score / pass-score
 * - result.passScore / ...
 */
function normalizePassScore(dto: unknown): number | null {
  if (!isRecord(dto)) return null;

  const rec = dto as Record<string, unknown>;
  const result = isRecord(rec.result) ? (rec.result as Record<string, unknown>) : null;

  const v =
    rec.passScore ??
    rec["pass_score"] ??
    rec["pass-score"] ??
    (result ? (result.passScore ?? result["pass_score"] ?? result["pass-score"]) : null);

  const n = pickNumber(v);
  if (n === null) return null;
  if (n < 0 || n > 1000) return null;
  return n;
}

/**
 * 서버 DTO retry-info 키 변형 대응:
 * - retryInfo / retry-info / retry_info / retry
 * - result.retryInfo / result.retry-info / ...
 */
function normalizeRetryInfo(dto: unknown): RetryInfoUi | null {
  if (!isRecord(dto)) return null;

  const rec = dto as Record<string, unknown>;
  const result = isRecord(rec.result) ? (rec.result as Record<string, unknown>) : null;

  const raw =
    rec.retryInfo ??
    rec["retry-info"] ??
    rec["retry_info"] ??
    rec.retry ??
    (result ? (result.retryInfo ?? result["retry-info"] ?? result["retry_info"] ?? (result as Record<string, unknown>).retry) : null);

  if (!isRecord(raw)) return null;
  const r = raw as Record<string, unknown>;

  const canRetry =
    typeof r.canRetry === "boolean"
      ? r.canRetry
      : typeof r.available === "boolean"
        ? r.available
        : typeof r.isRetryable === "boolean"
          ? r.isRetryable
          : null;

  const remaining = pickNumber(r.remainingAttempts ?? r.remainingCount ?? r.remaining ?? r.left) ?? null;
  const max = pickNumber(r.maxAttempts ?? r.maxCount ?? r.max ?? r.limit) ?? null;
  const used = pickNumber(r.usedAttempts ?? r.usedCount ?? r.used ?? r.attempted) ?? null;

  const nextAvailableAt =
    typeof r.nextAvailableAt === "string"
      ? r.nextAvailableAt
      : typeof r.nextRetryAt === "string"
        ? r.nextRetryAt
        : typeof r.availableAt === "string"
          ? r.availableAt
          : null;

  const reason =
    typeof r.reason === "string"
      ? r.reason
      : typeof r.message === "string"
        ? r.message
        : null;

  const resolvedCanRetry =
    canRetry !== null
      ? canRetry
      : remaining !== null
        ? remaining > 0
        : null;

  return {
    canRetry: resolvedCanRetry,
    remainingAttempts: remaining,
    maxAttempts: max,
    usedAttempts: used,
    nextAvailableAt,
    reason,
    _raw: raw,
  };
}

function toRetryInfoUiFromRetryInfoApi(raw: {
  canRetry: boolean;
  currentAttemptCount: number;
  maxAttempts: number | null;
  remainingAttempts: number | null;
  bestScore: number | null;
  passed: boolean | null;
}): RetryInfoUi {
  return {
    canRetry: raw.canRetry,
    remainingAttempts: raw.remainingAttempts ?? null,
    maxAttempts: raw.maxAttempts ?? null,
    usedAttempts: Number.isFinite(raw.currentAttemptCount) ? raw.currentAttemptCount : null,
    nextAvailableAt: null,
    reason: null,
    _raw: raw,
  };
}

const getDeptPageSize = (panelWidth: number): number => {
  if (panelWidth < 680) return 3;
  if (panelWidth < 960) return 4;
  if (panelWidth < 1240) return 5;
  return 6;
};

const getQuizPageSize = (panelWidth: number): number => {
  if (panelWidth < 680) return 2;
  if (panelWidth < 980) return 3;
  if (panelWidth < 1280) return 4;
  return 5;
};

const range = (count: number): number[] => Array.from({ length: count }, (_, idx) => idx);

function formatRemaining(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(mm)}:${pad(ss)}`;
}

const QuizPanel: React.FC<QuizPanelProps> = ({
  anchor,
  onClose,
  onOpenNote,
  unlockedCourseIds,
  onExamModeChange,
  onRequestFocus,
  zIndex,
  initialCourseId,
}) => {
  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";

  const initialTopSafe = hasDOM ? readAppHeaderSafeTop() : 0;
  const topSafeRef = useRef<number>(initialTopSafe);

  // === 패널 크기 + 위치 ===
  const [size, setSize] = useState<Size>(INITIAL_SIZE);
  const [panelPos, setPanelPos] = useState(() => {
    if (!hasDOM) return { top: 80, left: 120 };

    const pos = anchor ? computePanelPosition(anchor, INITIAL_SIZE) : computeDockFallbackPos(INITIAL_SIZE);
    return clampPanelPos(pos, INITIAL_SIZE, getMinTop(initialTopSafe));
  });

  const sizeRef = useRef<Size>(size);
  const posRef = useRef(panelPos);
  useEffect(() => {
    sizeRef.current = size;
    posRef.current = panelPos;
  }, [size, panelPos]);

  const resizeRef = useRef<ResizeState>({
    resizing: false,
    dir: null,
    startX: 0,
    startY: 0,
    startWidth: INITIAL_SIZE.width,
    startHeight: INITIAL_SIZE.height,
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

  const contentRef = useRef<HTMLDivElement | null>(null);

  // =========================
  // 데이터 상태 (API 연동)
  // =========================
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [departments, setDepartments] = useState<DepartmentScore[]>([]);
  const [courses, setCourses] = useState<QuizCourse[]>([]);

  // attempt details (on-demand)
  const [attemptsByCourseId, setAttemptsByCourseId] = useState<Record<string, QuizAttemptSummary[] | undefined>>({});
  const attemptsLoadingRef = useRef<Set<string>>(new Set());

  // 서버 DTO meta 캐시(대시보드/solve에 그대로 표시)
  const [courseMetaById, setCourseMetaById] = useState<Record<string, CourseMeta>>({});

  // dashboard selection
  const [deptPage, setDeptPage] = useState(0);
  const [quizPage, setQuizPage] = useState(0);
  const [activeAttemptIndexByCourseId, setActiveAttemptIndexByCourseId] = useState<Record<string, number>>({});

  // mode
  const [mode, setMode] = useState<PanelMode>("dashboard");

  // solve session
  const [solve, setSolve] = useState<SolveSession | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  const [timeLimit, setTimeLimit] = useState<number>(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [serverExpired, setServerExpired] = useState<boolean>(false);

  const autoSubmitOnceRef = useRef(false);

  // note
  const [noteCourse, setNoteCourse] = useState<QuizCourse | null>(null);
  const [noteAttemptIndex, setNoteAttemptIndex] = useState<number>(0);
  const [noteAttemptId, setNoteAttemptId] = useState<string | null>(null);
  const [noteItems, setNoteItems] = useState<WrongAnswerEntry[]>([]);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteModal, setNoteModal] = useState<WrongAnswerEntry | null>(null);

  const [resultMessage, setResultMessage] = useState<ResultMessage | null>(null);

  // timer/remaining ref (unload/visibility 시 최신값 확보 + 이벤트 리스너 재바인딩 방지)
  const timeLimitRef = useRef<number>(timeLimit);
  const remainingRef = useRef<number>(remainingSeconds);
  useEffect(() => {
    timeLimitRef.current = timeLimit;
  }, [timeLimit]);
  useEffect(() => {
    remainingRef.current = remainingSeconds;
  }, [remainingSeconds]);

  // 모드 변경될 때마다 상위에 "시험 모드 여부" 전달
  useEffect(() => {
    onExamModeChange?.(mode === "solve");
  }, [mode, onExamModeChange]);

  // 언마운트 시 리셋
  useEffect(() => {
    return () => onExamModeChange?.(false);
  }, [onExamModeChange]);

  const showResultMessage = useCallback((type: ResultType, title: string, description?: string) => {
    setResultMessage({ type, title, description });
  }, []);

  useEffect(() => {
    if (!resultMessage) return;
    const t = window.setTimeout(() => setResultMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [resultMessage]);

  // 헤더 safe-top 변경(리사이즈) 대응
  useEffect(() => {
    if (!hasDOM) return;

    const updateTopSafe = () => {
      const next = readAppHeaderSafeTop();
      topSafeRef.current = next;

      const minTop = getMinTop(next);
      const curSize = sizeRef.current;
      const curPos = posRef.current;

      const clamped = clampPanelPos(curPos, curSize, minTop);
      if (clamped.top === curPos.top && clamped.left === curPos.left) return;

      window.requestAnimationFrame(() => setPanelPos(clamped));
    };

    updateTopSafe();
    window.addEventListener("resize", updateTopSafe);
    return () => window.removeEventListener("resize", updateTopSafe);
  }, [hasDOM]);

  // =========================
  // Dashboard API 로딩/리프레시
  // =========================
  const refreshDashboard = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoadError(null);

        const [deptRaw, courseRaw] = await Promise.all([
          getQuizDepartmentStats({ signal }),
          getQuizAvailableEducations({ signal }),
        ]);

        const deptUi = toUiDepartmentStats(deptRaw);
        const courseUi = toUiCourses(courseRaw);

        if (unlockedCourseIds && unlockedCourseIds.length > 0) {
          const unlockedSet = new Set(unlockedCourseIds);
          for (const c of courseUi) {
            if (unlockedSet.has(c.id)) c.unlocked = true;
          }
        }

        setDepartments(deptUi);
        setCourses(courseUi);

        setActiveAttemptIndexByCourseId((prev) => {
          const next = { ...prev };
          for (const c of courseUi) {
            if (next[c.id] === undefined) next[c.id] = 0;
          }
          return next;
        });

        setLoading(false);
      } catch (e) {
        setLoading(false);
        setLoadError(safeErrorMessage(e));
      }
    },
    [unlockedCourseIds]
  );

  useEffect(() => {
    if (!hasDOM) return;
    const ac = new AbortController();
    setLoading(true);
    refreshDashboard(ac.signal);
    return () => ac.abort();
  }, [hasDOM, refreshDashboard]);

  // (선택) 특정 코스가 보이도록 페이지 이동
  const appliedInitialCourseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialCourseId) return;
    if (appliedInitialCourseRef.current === initialCourseId) return;

    const idx = courses.findIndex((c) => c.id === initialCourseId);
    if (idx < 0) return;

    const pageSize = getQuizPageSize(sizeRef.current.width);
    const nextPage = Math.floor(idx / pageSize);

    appliedInitialCourseRef.current = initialCourseId;

    setMode("dashboard");
    setQuizPage(nextPage);
  }, [initialCourseId, courses]);

  // =========================
  // attempt list + retry-info on-demand
  // =========================
  const ensureAttemptsLoaded = async (courseId: string) => {
    const hasAttemptsKey = Object.prototype.hasOwnProperty.call(attemptsByCourseId, courseId);
    const hasRetryMeta = courseMetaById[courseId]?.retryInfo !== undefined;

    if (hasAttemptsKey && hasRetryMeta) return;
    if (attemptsLoadingRef.current.has(courseId)) return;

    attemptsLoadingRef.current.add(courseId);
    try {
      const [list, retryInfoApi] = await Promise.all([
        hasAttemptsKey ? Promise.resolve(attemptsByCourseId[courseId] ?? []) : getQuizEducationAttempts(courseId),
        hasRetryMeta ? Promise.resolve(null) : getQuizRetryInfo(courseId).catch(() => null),
      ]);

      if (!hasAttemptsKey) {
        setAttemptsByCourseId((prev) => ({ ...prev, [courseId]: list }));
      }

      if (retryInfoApi) {
        const retryUi = toRetryInfoUiFromRetryInfoApi(retryInfoApi);
        setCourseMetaById((prev) => ({
          ...prev,
          [courseId]: {
            passScore: prev[courseId]?.passScore ?? null,
            retryInfo: retryUi,
          },
        }));
      }

      if (Array.isArray(list) && list.length > 0) {
        const latest = list.reduce<QuizAttemptSummary>((acc, cur) => {
          const a = normalizeAttemptNo(acc) ?? -1;
          const b = normalizeAttemptNo(cur) ?? -1;
          return b >= a ? cur : acc;
        }, list[0]);

        const passScore = normalizePassScore(latest);
        const retryInfo = normalizeRetryInfo(latest);

        if (passScore !== null || retryInfo !== null) {
          setCourseMetaById((prev) => ({
            ...prev,
            [courseId]: {
              passScore: passScore ?? prev[courseId]?.passScore ?? null,
              retryInfo: retryInfo ?? prev[courseId]?.retryInfo ?? null,
            },
          }));
        }
      }
    } catch {
      setAttemptsByCourseId((prev) => ({ ...prev, [courseId]: prev[courseId] ?? [] }));
    } finally {
      attemptsLoadingRef.current.delete(courseId);
    }
  };

  // =========================
  // leave 기록(문서 경로 포함)
  // =========================
  const recordLeave = useCallback(
    (attemptId: string, reason: "CLOSE" | "HIDDEN" | "UNLOAD" | "BACK", keepalive?: boolean) => {
      const nowIso = new Date().toISOString();
      const tl = timeLimitRef.current;
      const rs = remainingRef.current;
      const leaveSeconds = tl > 0 ? Math.max(0, Math.round(tl - rs)) : undefined;

      return postQuizLeave(
        attemptId,
        { timestamp: nowIso, reason, leaveSeconds },
        keepalive ? { keepalive: true } : undefined
      ).catch(() => undefined);
    },
    []
  );

  // =========================
  // 패널 높이 자동 조정 (ResizeObserver)
  // =========================
  const scheduleAutoHeightRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!hasDOM) return;
    const el = contentRef.current;
    if (!el) return;

    let raf = 0;

    const schedule = () => {
      if (!hasDOM) return;
      if (!contentRef.current) return;

      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const contentEl = contentRef.current;
        if (!contentEl) return;

        const contentHeight = contentEl.offsetHeight;
        const minTop = getMinTop(topSafeRef.current);

        const desiredHeight = Math.min(Math.max(contentHeight + 40, MIN_HEIGHT), window.innerHeight - 40);

        setSize((prev) => {
          if (Math.abs(prev.height - desiredHeight) < 2) return prev;
          return { ...prev, height: desiredHeight };
        });

        setPanelPos((prev) => clampPanelPos(prev, { width: sizeRef.current.width, height: desiredHeight }, minTop));
      });
    };

    scheduleAutoHeightRef.current = schedule;

    if (typeof ResizeObserver === "undefined") {
      schedule();
      const onWinResize = () => schedule();
      window.addEventListener("resize", onWinResize);
      return () => {
        window.removeEventListener("resize", onWinResize);
        window.cancelAnimationFrame(raf);
        scheduleAutoHeightRef.current = null;
      };
    }

    const ro = new ResizeObserver(() => {
      schedule();
    });
    ro.observe(el);

    schedule();

    return () => {
      ro.disconnect();
      window.cancelAnimationFrame(raf);
      scheduleAutoHeightRef.current = null;
    };
  }, [hasDOM]);

  useEffect(() => {
    if (!hasDOM) return;
    scheduleAutoHeightRef.current?.();
  }, [mode, hasDOM]);

  // =========================
  // 드래그 / 리사이즈
  // =========================
  useEffect(() => {
    if (!hasDOM) return;

    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      const minTop = getMinTop(topSafeRef.current);

      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - EDGE_MARGIN * 2);
        const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - minTop - EDGE_MARGIN);

        const proposedWidthForW = resizeState.startWidth - dx;
        const proposedHeightForN = resizeState.startHeight - dy;

        if (resizeState.dir.includes("e")) newWidth = resizeState.startWidth + dx;
        if (resizeState.dir.includes("s")) newHeight = resizeState.startHeight + dy;

        if (resizeState.dir.includes("w")) {
          newWidth = proposedWidthForW;
          newLeft = resizeState.startLeft + dx;
        }
        if (resizeState.dir.includes("n")) {
          newHeight = proposedHeightForN;
          newTop = resizeState.startTop + dy;
        }

        const clampedWidth = clamp(newWidth, MIN_WIDTH, maxWidth);
        const clampedHeight = clamp(newHeight, MIN_HEIGHT, maxHeight);

        if (resizeState.dir.includes("w") && clampedWidth !== proposedWidthForW) {
          newLeft = resizeState.startLeft + (resizeState.startWidth - clampedWidth);
        }
        if (resizeState.dir.includes("n") && clampedHeight !== proposedHeightForN) {
          newTop = resizeState.startTop + (resizeState.startHeight - clampedHeight);
        }

        const nextSize = { width: clampedWidth, height: clampedHeight };
        const clampedPos = clampPanelPos({ top: newTop, left: newLeft }, nextSize, minTop);

        setSize(nextSize);
        setPanelPos(clampedPos);
        return;
      }

      if (dragState.dragging) {
        const currentSize = sizeRef.current;

        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        const nextPos = {
          top: dragState.startTop + dy,
          left: dragState.startLeft + dx,
        };

        setPanelPos(clampPanelPos(nextPos, currentSize, minTop));
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
  }, [hasDOM]);

  const handleResizeMouseDown =
    (dir: ResizeDirection) => (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const currentPos = posRef.current;
      const currentSize = sizeRef.current;

      resizeRef.current = {
        resizing: true,
        dir,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: currentSize.width,
        startHeight: currentSize.height,
        startTop: currentPos.top,
        startLeft: currentPos.left,
      };
      dragRef.current.dragging = false;
      onRequestFocus?.();
    };

  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const currentPos = posRef.current;

    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: currentPos.top,
      startLeft: currentPos.left,
    };
    resizeRef.current.resizing = false;
    resizeRef.current.dir = null;
    onRequestFocus?.();
  };

  // =========================
  // 페이지 계산
  // =========================
  const deptPageSize = getDeptPageSize(size.width);
  const totalDeptPages = Math.max(1, Math.ceil(departments.length / deptPageSize)) || 1;
  const safeDeptPage = Math.min(deptPage, totalDeptPages - 1);
  const deptStart = safeDeptPage * deptPageSize;
  const visibleDepartments = departments.slice(deptStart, deptStart + deptPageSize);

  const quizPageSize = getQuizPageSize(size.width);
  const totalQuizPages = Math.max(1, Math.ceil(courses.length / quizPageSize)) || 1;
  const safeQuizPage = Math.min(quizPage, totalQuizPages - 1);
  const quizStart = safeQuizPage * quizPageSize;
  const visibleCourses = courses.slice(quizStart, quizStart + quizPageSize);

  const extraWidth = Math.max(0, size.width - INITIAL_SIZE.width);
  const baseCardHeight = 150;
  const maxCardHeight = 210;
  const responsiveCardHeight = Math.min(maxCardHeight, baseCardHeight + extraWidth / 8);

  // =========================
  // 대시보드 네비
  // =========================
  const handlePrevDept = () => setDeptPage((prev) => Math.max(prev - 1, 0));
  const handleNextDept = () => {
    const pageSize = getDeptPageSize(sizeRef.current.width);
    const maxPage = Math.max(0, Math.ceil(departments.length / pageSize) - 1);
    setDeptPage((prev) => Math.min(prev + 1, maxPage));
  };

  const handlePrevQuiz = () => setQuizPage((prev) => Math.max(prev - 1, 0));
  const handleNextQuiz = () => {
    const pageSize = getQuizPageSize(sizeRef.current.width);
    const maxPage = Math.max(0, Math.ceil(courses.length / pageSize) - 1);
    setQuizPage((prev) => Math.min(prev + 1, maxPage));
  };

  const handleToggleAttempt = async (courseId: string, index: number) => {
    setActiveAttemptIndexByCourseId((prev) => ({ ...prev, [courseId]: index }));
    await ensureAttemptsLoaded(courseId);
  };

  // =========================
  // Solve: 타이머 + 임시저장(디바운스)
  // =========================
  const saveDebounceMs = 650;
  const pendingSaveTimerRef = useRef<number | null>(null);
  const lastSavedFingerprintRef = useRef<string>("");

  const buildAnswerPayload = useCallback((): { answers: Array<{ questionId: string; userSelectedIndex: number }> } => {
    if (!solve) return { answers: [] };
    const answers = solve.questions
      .map((q, idx) => {
        const sel = selectedAnswers[idx];
        if (sel === undefined || sel === null || sel < 0) return null;
        return { questionId: q.id, userSelectedIndex: sel };
      })
      .filter((v): v is { questionId: string; userSelectedIndex: number } => v !== null);

    return { answers };
  }, [solve, selectedAnswers]);

  const flushSaveNow = useCallback(
    async (opts?: { keepalive?: boolean }) => {
      if (!solve) return;
      const payload = buildAnswerPayload();

      const fingerprint = JSON.stringify(payload.answers);
      if (fingerprint === lastSavedFingerprintRef.current) {
        return;
      }

      setSaveState({ status: "saving" });
      try {
        const tl = timeLimitRef.current;
        const rs = remainingRef.current;
        const elapsed = tl > 0 ? Math.max(0, Math.round(tl - rs)) : undefined;

        const res = await saveQuizAnswers(
          solve.attemptId,
          { answers: payload.answers, elapsedSeconds: elapsed },
          opts?.keepalive ? { keepalive: true } : undefined
        );
        lastSavedFingerprintRef.current = fingerprint;
        setSaveState({ status: "saved", savedAt: res?.savedAt });
      } catch (e) {
        setSaveState({ status: "error", message: safeErrorMessage(e) });
      }
    },
    [solve, buildAnswerPayload]
  );

  const scheduleSave = useCallback(() => {
    if (!hasDOM) return;
    if (!solve) return;

    if (pendingSaveTimerRef.current) window.clearTimeout(pendingSaveTimerRef.current);
    pendingSaveTimerRef.current = window.setTimeout(() => {
      flushSaveNow().catch(() => undefined);
    }, saveDebounceMs);
  }, [hasDOM, solve, flushSaveNow]);

  useEffect(() => {
    if (!hasDOM) return;
    return () => {
      if (pendingSaveTimerRef.current) window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    };
  }, [hasDOM]);

  // solve 중: 1초 tick (로컬), 10초마다 서버 sync
  useEffect(() => {
    if (!hasDOM) return;
    if (!solve) return;

    autoSubmitOnceRef.current = false;

    const tick = window.setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    const sync = window.setInterval(async () => {
      try {
        const t = await getQuizTimer(solve.attemptId);
        setTimeLimit(t.timeLimit);
        setServerExpired(t.isExpired);

        setRemainingSeconds((prev) => (Math.abs(prev - t.remainingSeconds) >= 2 ? t.remainingSeconds : prev));
      } catch {
        // ignore
      }
    }, 10_000);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(sync);
    };
  }, [hasDOM, solve]);

  // 타임아웃 자동 제출(1회만)
  useEffect(() => {
    if (!solve) return;

    const expired = serverExpired || remainingSeconds <= 0;
    if (!expired) return;
    if (autoSubmitOnceRef.current) return;

    autoSubmitOnceRef.current = true;

    (async () => {
      try {
        await flushSaveNow();

        const payload = buildAnswerPayload();
        const res = await submitQuizAnswers(solve.attemptId, payload);

        const passScore =
          normalizePassScore(res) ??
          solve.passScore ??
          courseMetaById[solve.course.id]?.passScore ??
          null;

        const retryInfo =
          normalizeRetryInfo(res) ??
          solve.retryInfo ??
          courseMetaById[solve.course.id]?.retryInfo ??
          null;

        if (passScore !== null || retryInfo !== null) {
          setCourseMetaById((prev) => ({
            ...prev,
            [solve.course.id]: {
              passScore: passScore ?? prev[solve.course.id]?.passScore ?? null,
              retryInfo: retryInfo ?? prev[solve.course.id]?.retryInfo ?? null,
            },
          }));
        }

        const retryDesc =
          retryInfo
            ? ` / 재응시 ${retryInfo.canRetry === null ? "-" : retryInfo.canRetry ? "가능" : "불가"} (남은 ${retryInfo.remainingAttempts ?? "-"} / ${retryInfo.maxAttempts ?? "-"})`
            : "";

        showResultMessage(
          res.passed ? "success" : "info",
          "시간 만료로 자동 제출되었습니다",
          `점수 ${Math.round(res.score)}점 (정답 ${res.correctCount}/${res.totalCount})${passScore !== null ? ` / 합격 기준 ${Math.round(passScore)}점` : ""}${retryDesc}`
        );

        await refreshDashboard();
      } catch (e) {
        showResultMessage("warning", "자동 제출 실패", safeErrorMessage(e));
      } finally {
        setMode("dashboard");
        setSolve(null);
        setSelectedAnswers([]);
        setSaveState({ status: "idle" });
        setTimeLimit(0);
        setRemainingSeconds(0);
        setServerExpired(false);
      }
    })();
  }, [serverExpired, remainingSeconds, solve, flushSaveNow, buildAnswerPayload, courseMetaById, refreshDashboard, showResultMessage]);

  // 페이지 이탈/숨김 시: 저장 + 타이머/leave 기록(keepalive)
  useEffect(() => {
    if (!hasDOM) return;
    if (!solve) return;

    const attemptId = solve.attemptId;

    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;

      flushSaveNow({ keepalive: true }).catch(() => undefined);

      const rs = Math.max(0, remainingRef.current);
      putQuizTimer(attemptId, { remainingSeconds: rs }, { keepalive: true }).catch(() => undefined);

      recordLeave(attemptId, "HIDDEN", true);
    };

    const onBeforeUnload = () => {
      flushSaveNow({ keepalive: true }).catch(() => undefined);

      const rs = Math.max(0, remainingRef.current);
      putQuizTimer(attemptId, { remainingSeconds: rs }, { keepalive: true }).catch(() => undefined);

      recordLeave(attemptId, "UNLOAD", true);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hasDOM, solve, flushSaveNow, recordLeave]);

  // =========================
  // 액션: 퀴즈 시작/제출/노트
  // =========================
  const handleStartQuiz = async (course: QuizCourse) => {
    if (!course.unlocked) return;

    try {
      setSaveState({ status: "idle" });
      setServerExpired(false);
      setTimeLimit(0);
      setRemainingSeconds(0);

      // 시작 전 retry-info를 확보(문서 경로 사용 + UI gating 품질)
      try {
        const r = await getQuizRetryInfo(course.id);
        setCourseMetaById((prev) => ({
          ...prev,
          [course.id]: {
            passScore: prev[course.id]?.passScore ?? null,
            retryInfo: toRetryInfoUiFromRetryInfoApi(r),
          },
        }));

        // “명시적으로 재응시 불가”가 내려오면, 호출 전에 컷(백엔드 정책과 UX 일치)
        if (r.canRetry === false) {
          showResultMessage("info", "재응시가 불가능합니다", "남은 횟수를 확인하거나 관리자에게 문의해 주세요.");
          return;
        }
      } catch {
        // ignore
      }

      const started = await startQuiz(course.id);
      const questions = toUiQuestions(started.questions);

      const startedPassScore = normalizePassScore(started);
      const startedRetryInfo = normalizeRetryInfo(started);
      const startedAttemptNo = normalizeAttemptNo(started) ?? undefined;

      if (startedPassScore !== null || startedRetryInfo !== null) {
        setCourseMetaById((prev) => ({
          ...prev,
          [course.id]: {
            passScore: startedPassScore ?? prev[course.id]?.passScore ?? null,
            retryInfo: startedRetryInfo ?? prev[course.id]?.retryInfo ?? null,
          },
        }));
      }

      const savedMap = new Map<string, number>();
      if (Array.isArray(started.savedAnswers)) {
        for (const a of started.savedAnswers) savedMap.set(a.questionId, a.userSelectedIndex);
      }

      const mergedQuestions: QuizQuestion[] = questions.map((q) => {
        const restored = savedMap.get(q.id);
        const userSel = restored !== undefined ? restored : q.userSelectedIndex ?? null;
        return { ...q, userSelectedIndex: userSel };
      });

      const initialSelected = mergedQuestions.map((q) =>
        q.userSelectedIndex !== null && q.userSelectedIndex !== undefined ? q.userSelectedIndex : -1
      );

      setSolve({
        course,
        attemptId: started.attemptId,
        attemptNo: startedAttemptNo,
        questions: mergedQuestions,
        passScore: startedPassScore,
        retryInfo: startedRetryInfo,
      });
      setSelectedAnswers(initialSelected);
      setMode("solve");

      ensureAttemptsLoaded(course.id).catch(() => undefined);

      try {
        const t = await getQuizTimer(started.attemptId);
        setTimeLimit(t.timeLimit);
        setRemainingSeconds(t.remainingSeconds);
        setServerExpired(t.isExpired);
      } catch {
        setTimeLimit(20 * 60);
        setRemainingSeconds(20 * 60);
      }
    } catch (e) {
      showResultMessage("warning", "퀴즈 시작 실패", safeErrorMessage(e));
      refreshDashboard().catch(() => undefined);
    }
  };

  const handleSelectOption = (qIndex: number, optionIndex: number) => {
    setSelectedAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = optionIndex;
      return next;
    });

    scheduleSave();
  };

  const handleSubmitAnswers = async () => {
    if (!solve) return;
    if (solve.questions.length === 0) return;

    const answeredCount = selectedAnswers.filter((x) => x >= 0).length;
    const total = solve.questions.length;

    if (answeredCount < total) {
      showResultMessage("warning", "답변이 완료되지 않았습니다", "모든 문항에 대해 보기 하나를 선택해 주세요.");
      return;
    }

    try {
      if (pendingSaveTimerRef.current) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
      await flushSaveNow();

      const payload = buildAnswerPayload();
      const res = await submitQuizAnswers(solve.attemptId, payload);

      const passScore =
        normalizePassScore(res) ??
        solve.passScore ??
        courseMetaById[solve.course.id]?.passScore ??
        null;

      const retryInfo =
        normalizeRetryInfo(res) ??
        solve.retryInfo ??
        courseMetaById[solve.course.id]?.retryInfo ??
        null;

      if (passScore !== null || retryInfo !== null) {
        setCourseMetaById((prev) => ({
          ...prev,
          [solve.course.id]: {
            passScore: passScore ?? prev[solve.course.id]?.passScore ?? null,
            retryInfo: retryInfo ?? prev[solve.course.id]?.retryInfo ?? null,
          },
        }));
      }

      const retryDesc =
        retryInfo
          ? ` / 재응시 ${retryInfo.canRetry === null ? "-" : retryInfo.canRetry ? "가능" : "불가"} (남은 ${retryInfo.remainingAttempts ?? "-"} / ${retryInfo.maxAttempts ?? "-"})`
          : "";

      showResultMessage(
        res.passed ? "success" : "info",
        res.passed ? "합격입니다" : "제출 완료",
        `점수 ${Math.round(res.score)}점 (정답 ${res.correctCount}/${res.totalCount}, 오답 ${res.wrongCount})${passScore !== null ? ` / 합격 기준 ${Math.round(passScore)}점` : ""}${retryDesc}`
      );

      await refreshDashboard();
    } catch (e) {
      showResultMessage("warning", "제출 실패", safeErrorMessage(e));
      return;
    } finally {
      setMode("dashboard");
      setSolve(null);
      setSelectedAnswers([]);
      setSaveState({ status: "idle" });
      setTimeLimit(0);
      setRemainingSeconds(0);
      setServerExpired(false);
      autoSubmitOnceRef.current = false;
    }
  };

  const handleBackFromSolve = async () => {
    try {
      if (pendingSaveTimerRef.current) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
      await flushSaveNow();
      if (solve) {
        const rs = Math.max(0, remainingRef.current);
        await putQuizTimer(solve.attemptId, { remainingSeconds: rs }).catch(() => undefined);
        await recordLeave(solve.attemptId, "BACK", false);
      }
    } catch {
      // ignore
    }

    setMode("dashboard");
    setSolve(null);
    setSelectedAnswers([]);
    setSaveState({ status: "idle" });
    setTimeLimit(0);
    setRemainingSeconds(0);
    setServerExpired(false);
    autoSubmitOnceRef.current = false;
  };

  const handleOpenNoteClick = async (course: QuizCourse) => {
    if (!course.unlocked) return;

    try {
      await ensureAttemptsLoaded(course.id);
      const list = attemptsByCourseId[course.id] ?? [];
      if (list.length === 0) {
        showResultMessage("info", "오답노트 안내", "제출된 응시 내역이 없습니다.");
        return;
      }

      const idx = activeAttemptIndexByCourseId[course.id] ?? 0;
      const picked = list[idx] ?? list[list.length - 1];

      const pickedStatus = (picked?.status ?? "").toUpperCase();
      if (!picked || pickedStatus !== "SUBMITTED") {
        showResultMessage("info", "오답노트 안내", "해당 회차는 아직 제출되지 않았습니다.");
        return;
      }

      setNoteCourse(course);
      setNoteAttemptIndex(idx);
      setNoteAttemptId(picked.attemptId);
      setNoteModal(null);
      setNoteError(null);
      setNoteLoading(true);

      const wrongs = await getQuizWrongs(picked.attemptId);

      const ui: WrongAnswerEntry[] = wrongs.map((w, i) => ({
        attemptId: picked.attemptId,
        questionNumber: i + 1,
        questionText: w.question,
        explanation: w.explanation ?? "",
      }));

      setNoteItems(ui);
      setMode("note");
      onOpenNote?.(course.id);
    } catch (e) {
      setNoteError(safeErrorMessage(e));
      showResultMessage("warning", "오답노트 조회 실패", safeErrorMessage(e));
    } finally {
      setNoteLoading(false);
    }
  };

  const handleBackFromNote = () => {
    setMode("dashboard");
    setNoteCourse(null);
    setNoteAttemptId(null);
    setNoteItems([]);
    setNoteError(null);
    setNoteLoading(false);
    setNoteModal(null);
  };

  const canSubmit =
    mode === "solve" &&
    !!solve &&
    solve.questions.length > 0 &&
    selectedAnswers.length === solve.questions.length &&
    selectedAnswers.every((idx) => idx >= 0);

  if (!hasDOM) return null;

  const solvePassScoreFromServer = solve ? (solve.passScore ?? courseMetaById[solve.course.id]?.passScore ?? null) : null;
  const solveRetryInfoFromServer = solve ? (solve.retryInfo ?? courseMetaById[solve.course.id]?.retryInfo ?? null) : null;

  return createPortal(
    <div
      className="cb-edu-wrapper"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: zIndex ?? QUIZ_LAYER_Z,
        pointerEvents: "none",
      }}
    >
      <div
        className="cb-edu-panel-container"
        style={{
          position: "fixed",
          top: panelPos.top,
          left: panelPos.left,
          pointerEvents: "auto",
        }}
      >
        <div
          className="cb-edu-panel cb-chatbot-panel"
          style={{ width: size.width, height: size.height }}
          onMouseDown={() => onRequestFocus?.()}
        >
          <div className="cb-drag-bar" onMouseDown={handleDragMouseDown} />

          <div className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-nw" onMouseDown={handleResizeMouseDown("nw")} />
          <div className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-ne" onMouseDown={handleResizeMouseDown("ne")} />
          <div className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-sw" onMouseDown={handleResizeMouseDown("sw")} />
          <div className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-se" onMouseDown={handleResizeMouseDown("se")} />

          <div className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-n" onMouseDown={handleResizeMouseDown("n")} />
          <div className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-s" onMouseDown={handleResizeMouseDown("s")} />
          <div className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-w" onMouseDown={handleResizeMouseDown("w")} />
          <div className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-e" onMouseDown={handleResizeMouseDown("e")} />

          <button
            type="button"
            className="cb-panel-close-btn"
            onClick={() => {
              if (mode === "solve" && solve) {
                const attemptId = solve.attemptId;

                flushSaveNow({ keepalive: true }).catch(() => undefined);

                const rs = Math.max(0, remainingRef.current);
                putQuizTimer(attemptId, { remainingSeconds: rs }, { keepalive: true }).catch(() => undefined);

                recordLeave(attemptId, "CLOSE", true);
              }
              onClose();
            }}
            aria-label="퀴즈 패널 닫기"
          >
            ✕
          </button>

          <div className="cb-edu-panel-inner" ref={contentRef} style={{ position: "relative" }}>
            {resultMessage && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 16,
                  display: "flex",
                  justifyContent: "center",
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    pointerEvents: "auto",
                    maxWidth: 460,
                    padding: "10px 16px",
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor:
                      resultMessage.type === "success"
                        ? "#ecfdf5"
                        : resultMessage.type === "warning"
                          ? "#fef3c7"
                          : "#eff6ff",
                    border:
                      "1px solid " +
                      (resultMessage.type === "success"
                        ? "#bbf7d0"
                        : resultMessage.type === "warning"
                          ? "#fde68a"
                          : "#bfdbfe"),
                    color: "#111827",
                    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.22)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontSize: 16 }}>
                    {resultMessage.type === "success" ? "✅" : resultMessage.type === "warning" ? "⚠️" : "ℹ️"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: resultMessage.description ? 2 : 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {resultMessage.title}
                    </div>
                    {resultMessage.description && (
                      <div
                        style={{
                          opacity: 0.95,
                          lineHeight: 1.4,
                          maxHeight: 40,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {resultMessage.description}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setResultMessage(null)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#374151",
                      cursor: "pointer",
                      fontSize: 14,
                      padding: 4,
                    }}
                    aria-label="알림 닫기"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* 로딩/에러 */}
            {mode === "dashboard" && loading && (
              <div style={{ padding: 18, fontSize: 13, color: "#cbd5e1" }}>퀴즈 데이터를 불러오는 중입니다...</div>
            )}

            {mode === "dashboard" && !loading && loadError && (
              <div style={{ padding: 18 }}>
                <div style={{ fontSize: 13, color: "#fecaca", marginBottom: 10 }}>
                  불러오기에 실패했습니다: {loadError}
                </div>
                <button
                  type="button"
                  className="cb-quiz-note-btn"
                  onClick={() => {
                    setLoading(true);
                    refreshDashboard().catch(() => undefined);
                  }}
                >
                  다시 시도
                </button>
              </div>
            )}

            {/* 대시보드 */}
            {mode === "dashboard" && !loading && !loadError && (
              <div className="cb-quiz-panel" aria-label="교육 퀴즈 대시보드">
                <section className="cb-quiz-section">
                  <div className="cb-quiz-section-header">
                    <h2 className="cb-quiz-section-title">부서별 점수판</h2>
                  </div>

                  <div className="cb-quiz-dept-row">
                    <button
                      type="button"
                      className="cb-quiz-arrow-btn"
                      onClick={handlePrevDept}
                      disabled={safeDeptPage === 0}
                      aria-label="이전 부서 보기"
                    >
                      ◀
                    </button>

                    <div className="cb-quiz-dept-list">
                      {visibleDepartments.map((dept) => (
                        <div key={dept.id} className="cb-quiz-dept-card" style={{ minHeight: responsiveCardHeight }}>
                          <div className="cb-quiz-dept-name">{dept.name}</div>
                          <div className="cb-quiz-dept-score">{dept.avgScore}점</div>
                          <div className="cb-quiz-dept-progress-label">
                            전체 진행률&nbsp;<span className="cb-quiz-dept-progress-value">{dept.progress}%</span>
                          </div>
                          <div className="cb-quiz-progress-bar">
                            <div className="cb-quiz-progress-bar-fill" style={{ width: `${dept.progress}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="cb-quiz-arrow-btn"
                      onClick={handleNextDept}
                      disabled={safeDeptPage >= totalDeptPages - 1}
                      aria-label="다음 부서 보기"
                    >
                      ▶
                    </button>
                  </div>
                </section>

                <section className="cb-quiz-section cb-quiz-section-quiz">
                  <div className="cb-quiz-section-header">
                    <h2 className="cb-quiz-section-title">Quiz</h2>
                  </div>

                  <div className="cb-quiz-course-row">
                    <button
                      type="button"
                      className="cb-quiz-arrow-btn"
                      onClick={handlePrevQuiz}
                      disabled={safeQuizPage === 0}
                      aria-label="이전 퀴즈 보기"
                    >
                      ◀
                    </button>

                    <div className="cb-quiz-course-list">
                      {visibleCourses.map((course) => {
                        const isLocked = !course.unlocked;

                        const activeIdx = activeAttemptIndexByCourseId[course.id] ?? 0;

                        const attempts = attemptsByCourseId[course.id];
                        const attemptFromApi = attempts?.[activeIdx];

                        const activeScore =
                          attemptFromApi?.score !== null && attemptFromApi?.score !== undefined
                            ? attemptFromApi.score
                            : activeIdx === 0
                              ? course.bestScore
                              : null;

                        const hasScore = activeScore !== null && activeScore !== undefined;

                        const displayScore = hasScore ? formatScore(activeScore) : "-";
                        const progressPercent = hasScore ? scoreToPercent(activeScore) : 0;

                        const totalAttempts =
                          course.maxAttempts !== null
                            ? Math.max(1, course.maxAttempts)
                            : Math.min(Math.max(QUIZ_ATTEMPT_FALLBACK, course.attemptCount), 3);

                        const attemptIndexes = range(totalAttempts);

                        const submitted = ((attemptFromApi?.status ?? "") as string).toUpperCase() === "SUBMITTED";
                        const canOpenNote = !isLocked && (submitted || (course.hasAttempted && course.bestScore !== null));

                        const meta = courseMetaById[course.id];
                        const metaPassScore = normalizePassScore(attemptFromApi) ?? meta?.passScore ?? null;
                        const metaRetry = normalizeRetryInfo(attemptFromApi) ?? meta?.retryInfo ?? null;

                        const fallbackRemaining =
                          course.maxAttempts !== null ? Math.max(0, course.maxAttempts - course.attemptCount) : null;

                        const canStartByRetryInfo =
                          metaRetry?.canRetry !== null && metaRetry?.canRetry !== undefined ? metaRetry.canRetry : null;

                        const canStartQuiz =
                          !isLocked &&
                          (canStartByRetryInfo !== null
                            ? canStartByRetryInfo
                            : course.maxAttempts === null
                              ? true
                              : course.attemptCount < course.maxAttempts) &&
                          course.passed !== true;

                        const primaryLabel = canOpenNote ? "오답노트" : "퀴즈 풀기";
                        const primaryDisabled = isLocked || (!canOpenNote && !canStartQuiz);

                        const handlePrimaryClick = () => {
                          if (primaryDisabled) return;

                          if (canOpenNote) {
                            handleOpenNoteClick(course).catch(() => undefined);
                          } else {
                            handleStartQuiz(course).catch(() => undefined);
                          }
                        };

                        return (
                          <article
                            key={course.id}
                            className={"cb-quiz-course-card" + (isLocked ? " is-locked" : "")}
                            style={{ minHeight: responsiveCardHeight }}
                          >
                            <header className="cb-quiz-course-header">
                              <h3 className="cb-quiz-course-title">{course.title}</h3>

                              <div className="cb-quiz-course-attempt-toggle">
                                {attemptIndexes.map((idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    className={"cb-quiz-attempt-dot" + (activeIdx === idx ? " is-active" : "")}
                                    onClick={() => handleToggleAttempt(course.id, idx)}
                                    aria-label={`${idx + 1}회차 보기`}
                                  >
                                    {idx + 1}
                                  </button>
                                ))}
                              </div>
                            </header>

                            <div className="cb-quiz-course-body">
                              <div className="cb-quiz-course-score-row">
                                <span className="cb-quiz-course-score-label">개인 점수</span>
                                <span className="cb-quiz-course-score-value">{displayScore}</span>
                              </div>

                              <div className="cb-quiz-progress-bar cb-quiz-course-progress">
                                <div className="cb-quiz-progress-bar-fill" style={{ width: `${progressPercent}%` }} />
                              </div>

                              <div
                                style={{
                                  marginTop: 10,
                                  fontSize: 12,
                                  color: "#94a3b8",
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  rowGap: 6,
                                  columnGap: 10,
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                  <span>합격 기준</span>
                                  <span style={{ color: "#e2e8f0" }}>
                                    {metaPassScore !== null ? `${Math.round(metaPassScore)}점` : "-"}
                                  </span>
                                </div>

                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                  <span>재응시</span>
                                  <span style={{ color: "#e2e8f0" }}>
                                    {metaRetry
                                      ? metaRetry.canRetry === null
                                        ? "-"
                                        : metaRetry.canRetry
                                          ? "가능"
                                          : "불가"
                                      : course.passed === true
                                        ? "불가"
                                        : "가능"}
                                  </span>
                                </div>

                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                  <span>남은 횟수</span>
                                  <span style={{ color: "#e2e8f0" }}>
                                    {metaRetry
                                      ? `${metaRetry.remainingAttempts ?? "-"} / ${metaRetry.maxAttempts ?? "-"}`
                                      : fallbackRemaining !== null && course.maxAttempts !== null
                                        ? `${fallbackRemaining} / ${course.maxAttempts}`
                                        : "-"}
                                  </span>
                                </div>

                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                  <span>응시 횟수</span>
                                  <span style={{ color: "#e2e8f0" }}>
                                    {metaRetry?.usedAttempts !== null && metaRetry?.usedAttempts !== undefined
                                      ? `${metaRetry.usedAttempts}`
                                      : `${course.attemptCount}`}
                                  </span>
                                </div>
                              </div>

                              {isLocked && <p className="cb-quiz-locked-text">교육 이수 완료 후 퀴즈를 풀 수 있어요.</p>}

                              {!isLocked && course.passed === true && (
                                <p className="cb-quiz-locked-text" style={{ color: "#a7f3d0" }}>
                                  이미 합격 처리되었습니다. 오답노트만 확인할 수 있어요.
                                </p>
                              )}

                              {!isLocked && metaRetry?.reason && (
                                <p className="cb-quiz-locked-text" style={{ color: "#cbd5e1" }}>
                                  {metaRetry.reason}
                                </p>
                              )}
                            </div>

                            <footer className="cb-quiz-course-footer">
                              {!isLocked && (
                                <button
                                  type="button"
                                  className="cb-quiz-note-btn"
                                  disabled={primaryDisabled}
                                  onClick={handlePrimaryClick}
                                >
                                  {primaryLabel}
                                </button>
                              )}
                            </footer>
                          </article>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      className="cb-quiz-arrow-btn"
                      onClick={handleNextQuiz}
                      disabled={safeQuizPage >= totalQuizPages - 1}
                      aria-label="다음 퀴즈 보기"
                    >
                      ▶
                    </button>
                  </div>
                </section>
              </div>
            )}

            {/* solve */}
            {mode === "solve" && solve && (
              <div className="cb-quiz-solve-layout">
                <header className="cb-quiz-solve-header">
                  <div className="cb-quiz-solve-header-left">
                    <button
                      type="button"
                      className="cb-quiz-solve-back-btn"
                      onClick={() => handleBackFromSolve().catch(() => undefined)}
                      aria-label="퀴즈 목록으로 돌아가기"
                    >
                      ◀
                    </button>
                    <h2 className="cb-quiz-solve-title">퀴즈풀기</h2>

                    <div className="cb-quiz-solve-tabs" title="남은 시간">
                      <div className="cb-quiz-solve-tab is-active" style={{ minWidth: 86 }}>
                        {formatRemaining(remainingSeconds)}
                      </div>
                    </div>
                  </div>

                  <div className="cb-quiz-solve-meta" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span>{solve.course.title}</span>

                    <span
                      style={{
                        fontSize: 12,
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(148,163,184,.35)",
                        background: "rgba(15,23,42,.25)",
                        color: "#e2e8f0",
                      }}
                      title={
                        saveState.status === "saved"
                          ? `저장됨${saveState.savedAt ? ` (${saveState.savedAt})` : ""}`
                          : saveState.status === "saving"
                            ? "저장 중..."
                            : saveState.status === "error"
                              ? `저장 실패: ${saveState.message}`
                              : "저장 대기"
                      }
                    >
                      {saveState.status === "saving"
                        ? "저장중..."
                        : saveState.status === "saved"
                          ? "저장됨"
                          : saveState.status === "error"
                            ? "저장 실패"
                            : "저장 대기"}
                    </span>
                  </div>
                </header>

                <div className="cb-quiz-solve-body">
                  <div className="cb-quiz-solve-card">
                    <div className="cb-quiz-solve-scroll">
                      {solve.questions.map((q, idx) => (
                        <div className="cb-quiz-solve-question" key={q.id}>
                          <div className="cb-quiz-solve-question-title">
                            {idx + 1}. {q.question}
                          </div>
                          <ul className="cb-quiz-solve-options">
                            {q.choices.map((opt, optIdx) => (
                              <li
                                key={optIdx}
                                className={"cb-quiz-solve-option" + (selectedAnswers[idx] === optIdx ? " is-selected" : "")}
                                onClick={() => handleSelectOption(idx, optIdx)}
                              >
                                {opt}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>

                    <div className="cb-quiz-solve-submit-row">
                      <button
                        type="button"
                        className="cb-quiz-solve-submit-btn"
                        onClick={() => handleSubmitAnswers().catch(() => undefined)}
                        disabled={!canSubmit}
                      >
                        제출하기
                      </button>
                    </div>

                    <div style={{ padding: "10px 14px", fontSize: 12, color: "#94a3b8", display: "grid", rowGap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span>합격 기준(passScore)</span>
                        <span style={{ color: "#e2e8f0" }}>
                          {solvePassScoreFromServer !== null ? `${Math.round(solvePassScoreFromServer)}점` : "-"}
                        </span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span>재응시(retry-info)</span>
                        <span style={{ color: "#e2e8f0" }}>
                          {solveRetryInfoFromServer
                            ? solveRetryInfoFromServer.canRetry === null
                              ? "-"
                              : solveRetryInfoFromServer.canRetry
                                ? "가능"
                                : "불가"
                            : "-"}
                        </span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span>남은 횟수</span>
                        <span style={{ color: "#e2e8f0" }}>
                          {solveRetryInfoFromServer
                            ? `${solveRetryInfoFromServer.remainingAttempts ?? "-"} / ${solveRetryInfoFromServer.maxAttempts ?? "-"}`
                            : "-"}
                        </span>
                      </div>

                      <div style={{ opacity: 0.9 }}>
                        서버 DTO가 아직 내려오지 않는 환경에서는 기본 합격 기준 {DEFAULT_PASSING_SCORE}점으로만 표시될 수 있습니다.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* note */}
            {mode === "note" && noteCourse && (
              <div className="cb-quiz-note-layout">
                <header className="cb-quiz-note-header">
                  <div className="cb-quiz-note-header-left">
                    <button
                      type="button"
                      className="cb-quiz-note-back-btn"
                      onClick={handleBackFromNote}
                      aria-label="퀴즈 대시보드로 돌아가기"
                    >
                      ◀
                    </button>
                    <h2 className="cb-quiz-note-title">오답노트</h2>

                    <div className="cb-quiz-note-tabs">
                      {(() => {
                        const attempts = attemptsByCourseId[noteCourse.id] ?? [];
                        const total =
                          noteCourse.maxAttempts !== null
                            ? Math.max(1, noteCourse.maxAttempts)
                            : Math.min(Math.max(QUIZ_ATTEMPT_FALLBACK, noteCourse.attemptCount), 3);

                        const tabs =
                          attempts.length > 0 ? attempts.map((a) => a.attemptNo) : range(total).map((i) => i + 1);

                        return tabs.map((n, idx) => (
                          <button
                            key={`${n}-${idx}`}
                            type="button"
                            className={"cb-quiz-note-tab" + (noteAttemptIndex === idx ? " is-active" : "")}
                            onClick={() => {
                              setNoteAttemptIndex(idx);

                              const courseId = noteCourse.id;
                              const list = attemptsByCourseId[courseId] ?? [];
                              const picked = list[idx];
                              const st = ((picked?.status ?? "") as string).toUpperCase();

                              if (!picked || st !== "SUBMITTED") {
                                setNoteItems([]);
                                setNoteAttemptId(null);
                                setNoteError("해당 회차는 아직 제출되지 않았습니다.");
                                return;
                              }

                              setNoteAttemptId(picked.attemptId);
                              setNoteError(null);
                              setNoteLoading(true);
                              getQuizWrongs(picked.attemptId)
                                .then((wrongs) => {
                                  const ui: WrongAnswerEntry[] = wrongs.map((w, i) => ({
                                    attemptId: picked.attemptId,
                                    questionNumber: i + 1,
                                    questionText: w.question,
                                    explanation: w.explanation ?? "",
                                  }));
                                  setNoteItems(ui);
                                })
                                .catch((e) => setNoteError(safeErrorMessage(e)))
                                .finally(() => setNoteLoading(false));
                            }}
                            aria-label={`${n}회차 오답 보기`}
                          >
                            {n}
                          </button>
                        ));
                      })()}
                    </div>
                  </div>

                  <div className="cb-quiz-note-meta" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div>{noteCourse.title}</div>
                    {noteAttemptId && (
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        응시 ID:{" "}
                        <span
                          style={{
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            color: "#e2e8f0",
                          }}
                        >
                          {noteAttemptId}
                        </span>
                      </div>
                    )}
                  </div>
                </header>

                <div className="cb-quiz-note-body">
                  <div className="cb-quiz-note-card">
                    <div className="cb-quiz-note-table-header-row">
                      <div className="cb-quiz-note-header-cell">문제번호</div>
                      <div className="cb-quiz-note-header-cell">문제</div>
                      <div className="cb-quiz-note-header-cell">해설</div>
                    </div>

                    <div className="cb-quiz-note-table-scroll">
                      {noteLoading ? (
                        <div className="cb-quiz-note-empty">오답노트를 불러오는 중입니다...</div>
                      ) : noteError ? (
                        <div className="cb-quiz-note-empty" style={{ color: "#fecaca" }}>
                          {noteError}
                        </div>
                      ) : noteItems.length === 0 ? (
                        <div className="cb-quiz-note-empty">해당 회차에서 틀린 문제가 없습니다.</div>
                      ) : (
                        noteItems.map((item) => (
                          <div key={`${item.attemptId}-${item.questionNumber}`} className="cb-quiz-note-row">
                            <div className="cb-quiz-note-question-no">{item.questionNumber}</div>
                            <div className="cb-quiz-note-question-text">{item.questionText}</div>
                            <div className="cb-quiz-note-explain-cell">
                              <button type="button" className="cb-quiz-note-explain-btn" onClick={() => setNoteModal(item)}>
                                해설보기
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {noteModal && (
                  <div className="cb-quiz-note-modal-backdrop">
                    <div className="cb-quiz-note-modal">
                      <div className="cb-quiz-note-modal-header">
                        <div className="cb-quiz-note-modal-title">{noteModal.questionText}</div>
                        <button
                          type="button"
                          className="cb-quiz-note-modal-close-btn"
                          onClick={() => setNoteModal(null)}
                          aria-label="해설 닫기"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="cb-quiz-note-modal-body">
                        <div className="cb-quiz-note-modal-explanation">
                          <div className="cb-quiz-note-modal-explanation-title">정답 해설</div>
                          <div className="cb-quiz-note-modal-explanation-text">{noteModal.explanation}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default QuizPanel;
