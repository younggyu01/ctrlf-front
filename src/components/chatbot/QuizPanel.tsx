// src/components/chatbot/QuizPanel.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./chatbot.css";
import { computePanelPosition, type Anchor, type PanelSize } from "../../utils/chat";
import type { QuizCourse, QuizQuestion, WrongAnswerEntry } from "./quizData";
import {
  formatScore,
  scoreToPercent,
  QUIZ_ATTEMPT_FALLBACK,
} from "./quizData";
import {
  getQuizAvailableEducations,
  getQuizDepartmentStats,
  getQuizEducationAttempts,
  getQuizMyAttempts,
  getQuizAttemptResult,
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

// 초기/자동 높이조정 시 "아래 잘림" 방지용 (패널을 화면 안쪽으로 살짝 끌어올림)
const OPEN_VISIBLE_MARGIN = 80;

// =========================
// UI Timeout (EduPanel과 동일 목적)
// =========================
const UI_TIMEOUT_DEFAULT_MS = 12_000;

class UiTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`${label} 요청 시간이 초과되었습니다. (${Math.round(timeoutMs / 1000)}s)`);
    this.name = "UiTimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

function isUiTimeoutError(err: unknown): err is UiTimeoutError {
  return err instanceof UiTimeoutError;
}

function makeAbortError(): Error {
  try {
    return new DOMException("Aborted", "AbortError");
  } catch {
    const e = new Error("Aborted");
    (e as Error & { name: string }).name = "AbortError";
    return e;
  }
}

function raceUiTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number = UI_TIMEOUT_DEFAULT_MS
): Promise<T> {
  if (typeof window === "undefined") return promise;

  const p = promise;
  p.catch(() => undefined);

  let tid: number | null = null;

  const timeout = new Promise<T>((_, reject) => {
    tid = window.setTimeout(() => reject(new UiTimeoutError(label, timeoutMs)), timeoutMs);
  });

  return Promise.race([p, timeout]).finally(() => {
    if (tid !== null) window.clearTimeout(tid);
  });
}

async function raceUiTimeoutWithAbort<T>(
  label: string,
  work: (signal: AbortSignal) => Promise<T>,
  opts?: { timeoutMs?: number; parentSignal?: AbortSignal }
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? UI_TIMEOUT_DEFAULT_MS;

  if (typeof window === "undefined") {
    const ac = new AbortController();
    if (opts?.parentSignal?.aborted) ac.abort();
    return work(ac.signal);
  }

  const ac = new AbortController();

  // parentSignal abort listener는 정상 완료 시에도 해제되어야 함(누수 방지)
  const parent = opts?.parentSignal;
  let parentAbortHandler: (() => void) | null = null;

  const parentAbortPromise = new Promise<T>((_, reject) => {
    if (!parent) return;

    const onAbort = () => {
      ac.abort();
      reject(makeAbortError());
    };

    parentAbortHandler = onAbort;

    if (parent.aborted) {
      onAbort();
      return;
    }

    parent.addEventListener("abort", onAbort);
  });

  let tid: number | null = null;
  let timedOut = false;

  const p = work(ac.signal);
  p.catch(() => undefined);

  const timeout = new Promise<T>((_, reject) => {
    tid = window.setTimeout(() => {
      timedOut = true;
      ac.abort();
      reject(new UiTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([p, timeout, parentAbortPromise]);
  } catch (e) {
    if (timedOut) throw new UiTimeoutError(label, timeoutMs);
    throw e;
  } finally {
    if (tid !== null) window.clearTimeout(tid);

    // 정상 완료/타임아웃/에러 모두에서 리스너 해제
    if (parent && parentAbortHandler) {
      parent.removeEventListener("abort", parentAbortHandler);
      parentAbortHandler = null;
    }
  }
}

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

// 패널이 "화면 아래로 잘려 보이는" 초기/자동 높이조정 상황에서
// 패널을 가능한 한 화면 안에 완전히 넣도록(top을 위로 당겨) 보정
function clampPanelPosFullyVisible(pos: { top: number; left: number }, size: Size, minTop: number) {
  if (typeof window === "undefined") return pos;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const rawLeftMin = EDGE_MARGIN;
  const rawLeftMax = vw - size.width - EDGE_MARGIN;

  const rawTopMin = minTop;
  const rawTopMax = vh - size.height - OPEN_VISIBLE_MARGIN;

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

type PanelMode = "dashboard" | "solve" | "result" | "note";

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
  passScore?: number | null;
  retryInfo?: RetryInfoUi | null;
};

type CourseMeta = {
  passScore?: number | null;
  retryInfo?: RetryInfoUi | null;
};

type AttemptResultUi = {
  attemptId: string;
  attemptNo: number | null;
  score: number | null;
  passed: boolean | null;
  correctCount: number | null;
  wrongCount: number | null;
  totalCount: number | null;
  submittedAt: string | null;
  passScore: number | null;
  retryInfo: RetryInfoUi | null;
  _raw?: unknown;
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
    // 스펙에 따르면 available-educations는 이미 이수 완료한 교육만 반환하므로 unlocked는 항상 true
    unlocked: true,
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

  if (isUiTimeoutError(err)) {
    return `${err.label} 응답이 지연되고 있습니다. 네트워크/로그인 상태를 확인 후 다시 시도해 주세요.`;
  }

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

function isAbortLikeError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    const msg = typeof rec.message === "string" ? rec.message : "";
    if (name === "AbortError") return true;
    if (msg.toLowerCase().includes("aborted")) return true;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    if ((err.message ?? "").toLowerCase().includes("aborted")) return true;
  }
  return false;
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

function pickBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return null;
}

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * attemptNo 추출 (DTO/환경별 키 변형 흡수)
 */
function normalizeAttemptNo(dto: unknown): number | null {
  if (!isRecord(dto)) return null;
  const rec = dto as Record<string, unknown>;
  const v = rec.attemptNo ?? rec["attempt_no"] ?? rec["attempt-no"];
  return pickNumber(v);
}

/**
 * 서버 DTO passScore 키 변형 대응
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
 * 서버 DTO retry-info 키 변형 대응
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
    (result
      ? (result.retryInfo ??
        result["retry-info"] ??
        result["retry_info"] ??
        (result as Record<string, unknown>).retry)
      : null);

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

  const remaining =
    pickNumber(r.remainingAttempts ?? r.remainingCount ?? r.remaining ?? r.left) ?? null;
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
    typeof r.reason === "string" ? r.reason : typeof r.message === "string" ? r.message : null;

  const resolvedCanRetry = canRetry !== null ? canRetry : remaining !== null ? remaining > 0 : null;

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

function normalizeAttemptResult(dto: unknown, attemptIdFallback?: string): AttemptResultUi | null {
  if (!isRecord(dto)) return null;

  const rec = dto as Record<string, unknown>;
  const base = isRecord(rec.result) ? (rec.result as Record<string, unknown>) : rec;

  const attemptId =
    pickString(base.attemptId ?? base["attempt_id"] ?? base["attempt-id"]) ??
    attemptIdFallback ??
    null;

  if (!attemptId) return null;

  const attemptNo = normalizeAttemptNo(base);

  const score = pickNumber(base.score ?? base["finalScore"] ?? base["final_score"]);
  const passed = pickBoolean(base.passed ?? base["isPassed"] ?? base["is_passed"]);

  const correctCount = pickNumber(base.correctCount ?? base["correct_count"] ?? base["correct-count"]);
  const wrongCount = pickNumber(base.wrongCount ?? base["wrong_count"] ?? base["wrong-count"]);
  const totalCount = pickNumber(base.totalCount ?? base["total_count"] ?? base["total-count"]);

  const submittedAt =
    pickString(base.submittedAt ?? base["submitted_at"] ?? base["submitted-at"]) ??
    pickString(base.createdAt ?? base["created_at"] ?? base["created-at"]) ??
    null;

  const passScore = normalizePassScore(dto);
  const retryInfo = normalizeRetryInfo(dto);

  return {
    attemptId,
    attemptNo,
    score,
    passed,
    correctCount,
    wrongCount,
    totalCount,
    submittedAt,
    passScore,
    retryInfo,
    _raw: dto,
  };
}

// =========================
// Attempt DTO union (my-attempts vs education-attempts)
// =========================
type MyAttemptsReturn = Awaited<ReturnType<typeof getQuizMyAttempts>>;
type QuizMyAttemptItem = MyAttemptsReturn extends Array<infer R> ? R : never;

type QuizAttemptLike = QuizAttemptSummary | QuizMyAttemptItem;

function getAttemptId(a: QuizAttemptLike | undefined | null): string | null {
  if (!a) return null;
  const rec = a as unknown as Record<string, unknown>;
  const v = rec.attemptId ?? rec["attempt_id"] ?? rec["attempt-id"];
  return pickString(v) ?? null;
}

function getAttemptScore(a: QuizAttemptLike | undefined | null): number | null {
  if (!a) return null;
  const rec = a as unknown as Record<string, unknown>;
  return pickNumber(rec.score ?? rec["finalScore"] ?? rec["final_score"]) ?? null;
}

function getAttemptSubmittedAt(a: QuizAttemptLike | undefined | null): string | null {
  if (!a) return null;
  const rec = a as unknown as Record<string, unknown>;
  return (
    pickString(rec.submittedAt ?? rec["submitted_at"] ?? rec["submitted-at"]) ??
    pickString(rec.createdAt ?? rec["created_at"] ?? rec["created-at"]) ??
    null
  );
}

function getAttemptStatus(a: QuizAttemptLike | undefined | null): string | null {
  if (!a) return null;
  const rec = a as unknown as Record<string, unknown>;
  const st = pickString(rec.status ?? rec["attemptStatus"] ?? rec["attempt_status"]);
  return st ? st.toUpperCase() : null;
}

function isSubmittedAttempt(a: QuizAttemptLike | undefined | null): boolean {
  const st = getAttemptStatus(a);
  if (st) return st === "SUBMITTED";
  // status가 없는 DTO(my-attempts)면 제출 시각/점수 기반으로 제출 처리로 간주
  const submittedAt = getAttemptSubmittedAt(a);
  if (submittedAt) return true;
  const score = getAttemptScore(a);
  return score !== null;
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

  // 사용자가 직접 드래그/리사이즈를 했는지 (자동 위치 보정 적용 여부)
  const userMovedRef = useRef(false);

  // === 패널 크기 + 위치 ===
  const [size, setSize] = useState<Size>(INITIAL_SIZE);
  const [panelPos, setPanelPos] = useState(() => {
    if (!hasDOM) return { top: 80, left: 120 };

    const pos = anchor
      ? computePanelPosition(anchor, INITIAL_SIZE)
      : computeDockFallbackPos(INITIAL_SIZE);

    const minTop = getMinTop(initialTopSafe);

    // 초기 렌더에서는 "완전 가시" 우선(아래 잘림 방지)
    return clampPanelPosFullyVisible(pos, INITIAL_SIZE, minTop);
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
  const [attemptsByCourseId, setAttemptsByCourseId] = useState<
    Record<string, QuizAttemptLike[] | undefined>
  >({});
  const attemptsLoadingRef = useRef<Set<string>>(new Set());

  const [attemptsErrorByCourseId, setAttemptsErrorByCourseId] = useState<
    Record<string, string | undefined>
  >({});

  // attempt result cache (attemptId -> result)
  const [attemptResultById, setAttemptResultById] = useState<
    Record<string, AttemptResultUi | undefined>
  >({});
  const [attemptResultErrorById, setAttemptResultErrorById] = useState<
    Record<string, string | undefined>
  >({});
  const attemptResultLoadingRef = useRef<Set<string>>(new Set());

  // 서버 DTO meta 캐시(대시보드/solve/result에 그대로 표시)
  const [courseMetaById, setCourseMetaById] = useState<Record<string, CourseMeta>>({});

  // dashboard selection
  const [deptPage, setDeptPage] = useState(0);
  const [quizPage, setQuizPage] = useState(0);
  const [activeAttemptIndexByCourseId, setActiveAttemptIndexByCourseId] = useState<
    Record<string, number>
  >({});

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

  // result session
  const [resultCourse, setResultCourse] = useState<QuizCourse | null>(null);
  const [resultAttemptId, setResultAttemptId] = useState<string | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);

  // note
  const [noteCourse, setNoteCourse] = useState<QuizCourse | null>(null);
  const [noteAttemptIndex, setNoteAttemptIndex] = useState<number>(0);
  const [noteAttemptId, setNoteAttemptId] = useState<string | null>(null);
  const [noteItems, setNoteItems] = useState<WrongAnswerEntry[]>([]);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteModal, setNoteModal] = useState<WrongAnswerEntry | null>(null);
  const noteLoadSeqRef = useRef(0);

  const [resultMessage, setResultMessage] = useState<ResultMessage | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // timer/remaining ref
  const timeLimitRef = useRef<number>(timeLimit);
  const remainingRef = useRef<number>(remainingSeconds);
  useEffect(() => {
    timeLimitRef.current = timeLimit;
  }, [timeLimit]);
  useEffect(() => {
    remainingRef.current = remainingSeconds;
  }, [remainingSeconds]);

  // leave 중복 방지 (attemptId 단위)
  const leaveOnceRef = useRef<Set<string>>(new Set());

  // timer pull/push in-flight 가드
  const timerPullInFlightRef = useRef(false);
  const timerPushInFlightRef = useRef(false);

  // solve meta latch
  const solveLatchedMetaRef = useRef<{ passScore: number | null; retry: RetryInfoUi | null }>({
    passScore: null,
    retry: null,
  });

  // 모드 변경될 때마다 상위에 "시험 모드 여부" 전달
  useEffect(() => {
    onExamModeChange?.(mode === "solve");
  }, [mode, onExamModeChange]);

  useEffect(() => {
    return () => onExamModeChange?.(false);
  }, [onExamModeChange]);

  const showResultMessage = useCallback((type: ResultType, title: string, description?: string) => {
    setResultMessage({ type, title, description });
  }, []);

  useEffect(() => {
    if (!resultMessage) return;
    if (!hasDOM) return;
    const t = window.setTimeout(() => setResultMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [resultMessage, hasDOM]);

  // 헤더 safe-top 변경(리사이즈) 대응
  useEffect(() => {
    if (!hasDOM) return;

    const updateTopSafe = () => {
      const next = readAppHeaderSafeTop();
      topSafeRef.current = next;

      const minTop = getMinTop(next);
      const curSize = sizeRef.current;
      const curPos = posRef.current;

      // 사용자가 이동시키지 않은 상태면 "완전 가시" 기준으로 보정
      const clamped = userMovedRef.current
        ? clampPanelPos(curPos, curSize, minTop)
        : clampPanelPosFullyVisible(curPos, curSize, minTop);

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
  const dashSeqRef = useRef(0);

  const refreshDashboard = useCallback(
    async (signal?: AbortSignal) => {
      const seq = ++dashSeqRef.current;

      try {
        setLoadError(null);

        const [deptRaw, courseRaw] = await raceUiTimeoutWithAbort(
          "퀴즈 대시보드",
          (s) =>
            Promise.all([getQuizDepartmentStats({ signal: s }), getQuizAvailableEducations({ signal: s })]),
          { timeoutMs: 12_000, parentSignal: signal }
        );

        if (signal?.aborted) return;
        if (seq !== dashSeqRef.current) return;
        if (!aliveRef.current) return;

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
        if (signal?.aborted || isAbortLikeError(e)) return;
        if (seq !== dashSeqRef.current) return;
        if (!aliveRef.current) return;

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
  //  - Flow: my-attempts + retry-info
  // =========================
  const ensureAttemptsLoaded = useCallback(
    async (courseId: string, opts?: { force?: boolean }): Promise<QuizAttemptLike[]> => {
      const force = Boolean(opts?.force);

      const hasAttemptsKey = Object.prototype.hasOwnProperty.call(attemptsByCourseId, courseId);
      const hasRetryMeta = courseMetaById[courseId]?.retryInfo !== undefined;
      const prevErr = attemptsErrorByCourseId[courseId];

      if (!force && hasAttemptsKey && hasRetryMeta && !prevErr) {
        return attemptsByCourseId[courseId] ?? [];
      }

      if (attemptsLoadingRef.current.has(courseId)) {
        return attemptsByCourseId[courseId] ?? [];
      }

      attemptsLoadingRef.current.add(courseId);
      try {
        if (aliveRef.current) {
          setAttemptsErrorByCourseId((prev) => ({ ...prev, [courseId]: undefined }));
        }

        const needAttempts = force || !hasAttemptsKey || Boolean(prevErr);
        const needRetryMeta = force || !hasRetryMeta;

        const [list, retryInfoApi] = await Promise.all([
          needAttempts
            ? (async () => {
                // 문서 플로우 우선: my-attempts (educationId 필수)
                try {
                  return await raceUiTimeout(
                    "응시 내역 조회(my-attempts)",
                    getQuizMyAttempts({ educationId: courseId }),
                    10_000
                  );
                } catch {
                  // 폴백: 기존 education-attempts
                  return await raceUiTimeout("응시 내역 조회", getQuizEducationAttempts(courseId), 10_000);
                }
              })()
            : Promise.resolve(attemptsByCourseId[courseId] ?? []),

          needRetryMeta ? raceUiTimeout("재응시 정보 조회", getQuizRetryInfo(courseId), 8_000) : Promise.resolve(null),
        ]);

        const normalizedList = Array.isArray(list) ? (list as QuizAttemptLike[]) : [];

        if (aliveRef.current) {
          if (needAttempts) {
            setAttemptsByCourseId((prev) => ({ ...prev, [courseId]: normalizedList }));
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

          // attempts 내 최신 회차에서 passScore/retry-info 파생(환경별 DTO 흡수)
          if (normalizedList.length > 0) {
            const latest = normalizedList.reduce<QuizAttemptLike>((acc, cur) => {
              const a = normalizeAttemptNo(acc) ?? -1;
              const b = normalizeAttemptNo(cur) ?? -1;
              return b >= a ? cur : acc;
            }, normalizedList[0]);

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
        }

        return normalizedList;
      } catch (e) {
        if (aliveRef.current) {
          setAttemptsErrorByCourseId((prev) => ({ ...prev, [courseId]: safeErrorMessage(e) }));
          setAttemptsByCourseId((prev) => ({ ...prev, [courseId]: prev[courseId] ?? [] }));
        }
        throw e;
      } finally {
        attemptsLoadingRef.current.delete(courseId);
      }
    },
    [attemptsByCourseId, courseMetaById, attemptsErrorByCourseId]
  );

  // =========================
  // attempt-result on-demand
  //  - Flow: attempt-result
  // =========================
  const ensureAttemptResultLoaded = useCallback(
    async (attemptId: string, opts?: { force?: boolean; courseId?: string }) => {
      if (!attemptId) return null;

      const force = Boolean(opts?.force);
      const exists = Object.prototype.hasOwnProperty.call(attemptResultById, attemptId);
      const prevErr = attemptResultErrorById[attemptId];

      if (!force && exists && !prevErr) return attemptResultById[attemptId] ?? null;
      if (attemptResultLoadingRef.current.has(attemptId)) {
        return attemptResultById[attemptId] ?? null;
      }

      attemptResultLoadingRef.current.add(attemptId);
      try {
        if (aliveRef.current) {
          setAttemptResultErrorById((prev) => ({ ...prev, [attemptId]: undefined }));
        }

        const dto = await raceUiTimeout("응시 결과 조회(attempt-result)", getQuizAttemptResult(attemptId), 10_000);

        const ui = normalizeAttemptResult(dto, attemptId);
        if (!ui) throw new Error("attempt-result 응답을 해석할 수 없습니다.");

        if (aliveRef.current) {
          setAttemptResultById((prev) => ({ ...prev, [attemptId]: ui }));

          // 결과에서 passScore/retry-info가 내려오면 course meta도 안정화(가능한 경우)
          if (opts?.courseId) {
            if (ui.passScore !== null || ui.retryInfo !== null) {
              setCourseMetaById((prev) => ({
                ...prev,
                [opts.courseId as string]: {
                  passScore: ui.passScore ?? prev[opts.courseId as string]?.passScore ?? null,
                  retryInfo: ui.retryInfo ?? prev[opts.courseId as string]?.retryInfo ?? null,
                },
              }));
            }
          }
        }

        return ui;
      } catch (e) {
        const msg = safeErrorMessage(e);
        if (aliveRef.current) setAttemptResultErrorById((prev) => ({ ...prev, [attemptId]: msg }));
        throw e;
      } finally {
        attemptResultLoadingRef.current.delete(attemptId);
      }
    },
    [attemptResultById, attemptResultErrorById]
  );

  // =========================
  // leave 기록(문서 경로 포함) + 중복 방지
  // =========================
  const recordLeave = useCallback(
    (attemptId: string, reason: "CLOSE" | "HIDDEN" | "UNLOAD" | "BACK", keepalive?: boolean) => {
      if (!attemptId) return Promise.resolve(undefined);
      const key = `${attemptId}:${reason}`;
      if (leaveOnceRef.current.has(key)) return Promise.resolve(undefined);
      leaveOnceRef.current.add(key);

      const nowIso = new Date().toISOString();
      const tl = timeLimitRef.current;
      const rs = remainingRef.current;
      const leaveSeconds = tl > 0 ? Math.max(0, Math.round(tl - rs)) : undefined;

      return raceUiTimeout(
        "이탈 기록",
        postQuizLeave(
          attemptId,
          { timestamp: nowIso, reason, leaveSeconds },
          keepalive ? { keepalive: true } : undefined
        ),
        3_000
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

      if (resizeRef.current.resizing || dragRef.current.dragging) return;

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

        // 자동 높이 조정으로 인해 아래가 잘리는 경우,
        // 사용자가 이동시키지 않았다면 화면 안에 "완전 가시"가 되도록 top을 위로 보정
        setPanelPos((prev) => {
          const nextSize = { width: sizeRef.current.width, height: desiredHeight };
          return userMovedRef.current
            ? clampPanelPos(prev, nextSize, minTop)
            : clampPanelPosFullyVisible(prev, nextSize, minTop);
        });
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
      scheduleAutoHeightRef.current?.();
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

      // 사용자가 수동 조작 시작
      userMovedRef.current = true;

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

    // 사용자가 수동 조작 시작
    userMovedRef.current = true;

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

  const visibleCourseIdsKey = useMemo(
    () => visibleCourses.map((c) => c.id).join("|"),
    [visibleCourses]
  );

  useEffect(() => {
    if (!hasDOM) return;
    if (mode !== "dashboard") return;
    if (!visibleCourseIdsKey) return;

    for (const c of visibleCourses) {
      ensureAttemptsLoaded(c.id)
        .then((list) => {
          const idx = activeAttemptIndexByCourseId[c.id] ?? 0;
          const picked = list[idx];
          if (picked && isSubmittedAttempt(picked)) {
            const attemptId = getAttemptId(picked);
            if (attemptId && !attemptResultById[attemptId]) {
              ensureAttemptResultLoaded(attemptId, { courseId: c.id }).catch(() => undefined);
            }
          }
        })
        .catch(() => undefined);
    }
  }, [
    hasDOM,
    mode,
    visibleCourseIdsKey,
    visibleCourses,
    ensureAttemptsLoaded,
    activeAttemptIndexByCourseId,
    attemptResultById,
    ensureAttemptResultLoaded,
  ]);

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
    try {
      const needForce =
        !Object.prototype.hasOwnProperty.call(attemptsByCourseId, courseId) ||
        !!attemptsErrorByCourseId[courseId];
      const list = await ensureAttemptsLoaded(courseId, { force: needForce });
      const picked = list[index];
      const attemptId = picked ? getAttemptId(picked) : null;

      if (picked && isSubmittedAttempt(picked) && attemptId) {
        await ensureAttemptResultLoaded(attemptId, { courseId });
      }
    } catch (e) {
      showResultMessage("warning", "응시 내역/결과 조회 실패", safeErrorMessage(e));
    }
  };

  // =========================
  // Solve: 타이머 + 임시저장(디바운스)
  // =========================
  const saveDebounceMs = 650;
  const pendingSaveTimerRef = useRef<number | null>(null);
  const lastSavedFingerprintRef = useRef<string>("");

  useEffect(() => {
    lastSavedFingerprintRef.current = "";

    if (typeof window !== "undefined" && pendingSaveTimerRef.current) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
  }, [solve?.attemptId]);

  const buildAnswerPayload = useCallback(
    (): { answers: Array<{ questionId: string; userSelectedIndex: number }> } => {
      if (!solve) return { answers: [] };
      const answers = solve.questions
        .map((q, idx) => {
          const sel = selectedAnswers[idx];
          if (sel === undefined || sel === null || sel < 0) return null;
          return { questionId: q.id, userSelectedIndex: sel };
        })
        .filter((v): v is { questionId: string; userSelectedIndex: number } => v !== null);

      return { answers };
    },
    [solve, selectedAnswers]
  );

  const flushSaveNow = useCallback(
    async (opts?: { keepalive?: boolean; silent?: boolean }) => {
      if (!solve) return;
      const payload = buildAnswerPayload();

      const fingerprint = JSON.stringify(payload.answers);
      if (fingerprint === lastSavedFingerprintRef.current) return;

      if (!opts?.silent && aliveRef.current) setSaveState({ status: "saving" });
      try {
        const tl = timeLimitRef.current;
        const rs = remainingRef.current;
        const elapsed = tl > 0 ? Math.max(0, Math.round(tl - rs)) : undefined;

        const res = await raceUiTimeout(
          "임시 저장",
          saveQuizAnswers(
            solve.attemptId,
            { answers: payload.answers, elapsedSeconds: elapsed },
            opts?.keepalive ? { keepalive: true } : undefined
          ),
          8_000
        );
        lastSavedFingerprintRef.current = fingerprint;

        if (!opts?.silent && aliveRef.current) {
          const savedAt =
            isRecord(res) && typeof (res as Record<string, unknown>).savedAt === "string"
              ? ((res as Record<string, unknown>).savedAt as string)
              : undefined;

          setSaveState({ status: "saved", savedAt });
        }
      } catch (e) {
        if (!opts?.silent && aliveRef.current) setSaveState({ status: "error", message: safeErrorMessage(e) });
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

  // =========================
  // Solve: 타이머 동기(로컬 tick + 서버 push/pull)
  // =========================
  const TIMER_PULL_INTERVAL_MS = 15_000;
  const TIMER_PUSH_INTERVAL_MS = 10_000;

  useEffect(() => {
    if (!hasDOM) return;
    if (!solve) return;

    autoSubmitOnceRef.current = false;

    for (const k of Array.from(leaveOnceRef.current)) {
      if (k.startsWith(`${solve.attemptId}:`)) leaveOnceRef.current.delete(k);
    }

    solveLatchedMetaRef.current = { passScore: null, retry: null };

    const tick = window.setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    const push = window.setInterval(() => {
      if (timerPushInFlightRef.current) return;
      timerPushInFlightRef.current = true;

      const rs = Math.max(0, remainingRef.current);
      raceUiTimeout("타이머 저장", putQuizTimer(solve.attemptId, { remainingSeconds: rs }), 4_000)
        .catch(() => undefined)
        .finally(() => {
          timerPushInFlightRef.current = false;
        });
    }, TIMER_PUSH_INTERVAL_MS);

    const pull = window.setInterval(async () => {
      if (timerPullInFlightRef.current) return;
      timerPullInFlightRef.current = true;

      try {
        const t = await raceUiTimeout("타이머 조회", getQuizTimer(solve.attemptId), 5_000);

        // null = 제한 없음이므로 0으로 처리 (UI 호환)
        setTimeLimit(t.timeLimit ?? 0);
        setServerExpired(t.isExpired);
        setRemainingSeconds((prev) => {
          const newRemaining = t.remainingSeconds ?? 0;
          return Math.abs(prev - newRemaining) >= 2 ? newRemaining : prev;
        });
      } catch {
        // ignore
      } finally {
        timerPullInFlightRef.current = false;
      }
    }, TIMER_PULL_INTERVAL_MS);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(push);
      window.clearInterval(pull);
    };
  }, [hasDOM, solve]);

  // =========================
  // Solve: passScore/retry-info latch (표시 안정화)
  // =========================
  const solvePassScoreFromServer = solve
    ? (solve.passScore ?? courseMetaById[solve.course.id]?.passScore ?? null)
    : null;
  const solveRetryInfoFromServer = solve
    ? (solve.retryInfo ?? courseMetaById[solve.course.id]?.retryInfo ?? null)
    : null;

  useEffect(() => {
    if (!solve) {
      solveLatchedMetaRef.current = { passScore: null, retry: null };
      return;
    }

    if (solvePassScoreFromServer !== null && Number.isFinite(solvePassScoreFromServer)) {
      solveLatchedMetaRef.current.passScore = solvePassScoreFromServer;
    }
    if (solveRetryInfoFromServer) {
      solveLatchedMetaRef.current.retry = solveRetryInfoFromServer;
    }
  }, [solve, solvePassScoreFromServer, solveRetryInfoFromServer]);

  const solvePassScoreDisplay = solveLatchedMetaRef.current.passScore ?? DEFAULT_PASSING_SCORE;
  const solveRetryDisplay = solveLatchedMetaRef.current.retry;

  // =========================
  // 오답노트 공통: 특정 attempt로 바로 열기
  // =========================
  const openNoteForAttempt = useCallback(
    async (course: QuizCourse, attemptId: string) => {
      if (!course.unlocked) return;

      let seq = 0;
      try {
        const list = await ensureAttemptsLoaded(course.id, { force: true });
        const idx = Math.max(0, list.findIndex((a) => getAttemptId(a) === attemptId));
        const picked = list[idx] ?? list[list.length - 1];

        if (!picked || !isSubmittedAttempt(picked)) {
          showResultMessage("info", "오답노트 안내", "해당 회차는 아직 제출되지 않았습니다.");
          return;
        }

        const pickedId = getAttemptId(picked);
        if (!pickedId) {
          showResultMessage("warning", "오답노트 조회 실패", "attemptId를 찾을 수 없습니다.");
          return;
        }

        setNoteCourse(course);
        setNoteAttemptIndex(idx);
        setNoteAttemptId(pickedId);
        setNoteModal(null);
        setNoteError(null);
        setNoteLoading(true);

        seq = ++noteLoadSeqRef.current;

        const wrongs = await raceUiTimeout("오답노트 조회", getQuizWrongs(pickedId), 10_000);

        if (!aliveRef.current) return;
        if (noteLoadSeqRef.current !== seq) return;

        const ui: WrongAnswerEntry[] = wrongs.map((w, i) => ({
          attemptId: pickedId,
          questionNumber: i + 1,
          questionText: w.question,
          explanation: w.explanation ?? "",
        }));

        setNoteItems(ui);
        setMode("note");
        onOpenNote?.(course.id);
      } catch (e) {
        if (aliveRef.current) setNoteError(safeErrorMessage(e));
        showResultMessage("warning", "오답노트 조회 실패", safeErrorMessage(e));
      } finally {
        if (aliveRef.current && seq > 0 && noteLoadSeqRef.current === seq) {
          setNoteLoading(false);
        }
      }
    },
    [ensureAttemptsLoaded, showResultMessage, onOpenNote]
  );

  // =========================
  // 타임아웃 자동 제출(1회만)
  // =========================
  useEffect(() => {
    if (!solve) return;

    const expired = serverExpired || remainingSeconds <= 0;
    if (!expired) return;
    if (autoSubmitOnceRef.current) return;

    autoSubmitOnceRef.current = true;

    (async () => {
      const attemptId = solve.attemptId;
      const course = solve.course;

      try {
        await flushSaveNow();

        const payload = buildAnswerPayload();
        const submitRes = await raceUiTimeout("퀴즈 자동 제출", submitQuizAnswers(attemptId, payload), 15_000);

        setResultLoading(true);
        setResultError(null);

        let resultUi: AttemptResultUi | null = null;
        try {
          resultUi = await ensureAttemptResultLoaded(attemptId, { force: true, courseId: course.id });
        } catch {
          resultUi = normalizeAttemptResult(submitRes, attemptId);
          if (resultUi && aliveRef.current)
            setAttemptResultById((prev) => ({ ...prev, [attemptId]: resultUi as AttemptResultUi }));
        }

        const passScore =
          (resultUi?.passScore ?? null) ??
          normalizePassScore(submitRes) ??
          solve.passScore ??
          courseMetaById[course.id]?.passScore ??
          null;

        const retryInfo =
          (resultUi?.retryInfo ?? null) ??
          normalizeRetryInfo(submitRes) ??
          solve.retryInfo ??
          courseMetaById[course.id]?.retryInfo ??
          null;

        if (aliveRef.current && (passScore !== null || retryInfo !== null)) {
          setCourseMetaById((prev) => ({
            ...prev,
            [course.id]: {
              passScore: passScore ?? prev[course.id]?.passScore ?? null,
              retryInfo: retryInfo ?? prev[course.id]?.retryInfo ?? null,
            },
          }));
        }

        const retryDesc = retryInfo
          ? ` / 재응시 ${retryInfo.canRetry === null ? "-" : retryInfo.canRetry ? "가능" : "불가"} (남은 ${
              retryInfo.remainingAttempts ?? "-"
            } / ${retryInfo.maxAttempts ?? "-"})`
          : "";

        const score = pickNumber((submitRes as unknown as { score?: unknown }).score) ?? resultUi?.score ?? null;
        const correctCount =
          pickNumber((submitRes as unknown as { correctCount?: unknown }).correctCount) ??
          resultUi?.correctCount ??
          null;
        const totalCount =
          pickNumber((submitRes as unknown as { totalCount?: unknown }).totalCount) ?? resultUi?.totalCount ?? null;

        if (aliveRef.current) {
          showResultMessage(
            pickBoolean((submitRes as unknown as { passed?: unknown }).passed) ? "success" : "info",
            "시간 만료로 자동 제출되었습니다",
            `점수 ${score !== null ? Math.round(score) : "-"}점 (정답 ${correctCount ?? "-"}/${totalCount ?? "-"})${
              passScore !== null ? ` / 합격 기준 ${Math.round(passScore)}점` : ""
            }${retryDesc}`
          );
        }

        if (aliveRef.current) await refreshDashboard();

        if (aliveRef.current) {
          setResultCourse(course);
          setResultAttemptId(attemptId);
          setMode("result");
        }
      } catch (e) {
        showResultMessage("warning", "자동 제출 실패", safeErrorMessage(e));
        if (aliveRef.current) setMode("dashboard");
      } finally {
        if (aliveRef.current) {
          setSolve(null);
          setSelectedAnswers([]);
          setSaveState({ status: "idle" });
          setTimeLimit(0);
          setRemainingSeconds(0);
          setServerExpired(false);
          setResultLoading(false);
        }
      }
    })();
  }, [
    serverExpired,
    remainingSeconds,
    solve,
    flushSaveNow,
    buildAnswerPayload,
    courseMetaById,
    refreshDashboard,
    showResultMessage,
    ensureAttemptResultLoaded,
  ]);

  // 페이지 이탈/숨김 시: 저장 + 타이머/leave 기록(keepalive)
  useEffect(() => {
    if (!hasDOM) return;
    if (!solve) return;

    const attemptId = solve.attemptId;

    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;

      flushSaveNow({ keepalive: true, silent: true }).catch(() => undefined);

      const rs = Math.max(0, remainingRef.current);
      putQuizTimer(attemptId, { remainingSeconds: rs }, { keepalive: true }).catch(() => undefined);

      recordLeave(attemptId, "HIDDEN", true);
    };

    const onBeforeUnload = () => {
      flushSaveNow({ keepalive: true, silent: true }).catch(() => undefined);

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

  // solve 언마운트/패널 강제 제거 대비
  useEffect(() => {
    if (!hasDOM) return;
    if (!solve) return;

    const attemptId = solve.attemptId;

    return () => {
      flushSaveNow({ keepalive: true, silent: true }).catch(() => undefined);

      const rs = Math.max(0, remainingRef.current);
      putQuizTimer(attemptId, { remainingSeconds: rs }, { keepalive: true }).catch(() => undefined);

      recordLeave(attemptId, "CLOSE", true);
    };
  }, [hasDOM, solve, flushSaveNow, recordLeave]);

  // =========================
  // 액션: 퀴즈 시작/제출/노트
  // =========================
  const handleStartQuiz = async (course: QuizCourse) => {
    if (!course.unlocked) return;

    if (course.passed === true) {
      showResultMessage("info", "이미 합격 처리되었습니다", "오답노트에서 틀린 문제를 확인해 주세요.");
      return;
    }

    try {
      setResultCourse(null);
      setResultAttemptId(null);
      setResultError(null);

      setSaveState({ status: "idle" });
      setServerExpired(false);
      setTimeLimit(0);
      setRemainingSeconds(0);

      // 시작 전 retry-info 확보
      try {
        const r = await raceUiTimeout("재응시 정보 조회", getQuizRetryInfo(course.id), 7_000);
        if (aliveRef.current) {
          setCourseMetaById((prev) => ({
            ...prev,
            [course.id]: {
              passScore: prev[course.id]?.passScore ?? null,
              retryInfo: toRetryInfoUiFromRetryInfoApi(r),
            },
          }));
        }

        if (r.canRetry === false) {
          showResultMessage("info", "재응시가 불가능합니다", "남은 횟수를 확인하거나 관리자에게 문의해 주세요.");
          return;
        }
      } catch (e) {
        showResultMessage("warning", "재응시 정보 조회 실패", safeErrorMessage(e));
      }

      const started = await raceUiTimeout("퀴즈 시작", startQuiz(course.id), 12_000);
      if (!aliveRef.current) return;

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
        const t = await raceUiTimeout("타이머 조회", getQuizTimer(started.attemptId), 6_000);
        // null = 제한 없음이므로 0으로 처리 (UI 호환)
        setTimeLimit(t.timeLimit ?? 0);
        setRemainingSeconds(t.remainingSeconds ?? 0);
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

    const attemptId = solve.attemptId;
    const course = solve.course;

    try {
      if (pendingSaveTimerRef.current && hasDOM) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
      await flushSaveNow();

      const payload = buildAnswerPayload();
      const submitRes = await raceUiTimeout("퀴즈 제출", submitQuizAnswers(attemptId, payload), 15_000);

      setResultLoading(true);
      setResultError(null);

      let resultUi: AttemptResultUi | null = null;
      try {
        resultUi = await ensureAttemptResultLoaded(attemptId, { force: true, courseId: course.id });
      } catch (e) {
        resultUi = normalizeAttemptResult(submitRes, attemptId);
        if (!resultUi) setResultError(safeErrorMessage(e));
        else setAttemptResultById((prev) => ({ ...prev, [attemptId]: resultUi as AttemptResultUi }));
      }

      const passScore =
        (resultUi?.passScore ?? null) ??
        normalizePassScore(submitRes) ??
        solve.passScore ??
        courseMetaById[course.id]?.passScore ??
        null;

      const retryInfo =
        (resultUi?.retryInfo ?? null) ??
        normalizeRetryInfo(submitRes) ??
        solve.retryInfo ??
        courseMetaById[course.id]?.retryInfo ??
        null;

      if (passScore !== null || retryInfo !== null) {
        setCourseMetaById((prev) => ({
          ...prev,
          [course.id]: {
            passScore: passScore ?? prev[course.id]?.passScore ?? null,
            retryInfo: retryInfo ?? prev[course.id]?.retryInfo ?? null,
          },
        }));
      }

      const retryDesc = retryInfo
        ? ` / 재응시 ${retryInfo.canRetry === null ? "-" : retryInfo.canRetry ? "가능" : "불가"} (남은 ${
            retryInfo.remainingAttempts ?? "-"
          } / ${retryInfo.maxAttempts ?? "-"})`
        : "";

      const score = pickNumber((submitRes as unknown as { score?: unknown }).score) ?? resultUi?.score ?? null;
      const correctCount =
        pickNumber((submitRes as unknown as { correctCount?: unknown }).correctCount) ?? resultUi?.correctCount ?? null;
      const totalCount =
        pickNumber((submitRes as unknown as { totalCount?: unknown }).totalCount) ?? resultUi?.totalCount ?? null;
      const wrongCount =
        pickNumber((submitRes as unknown as { wrongCount?: unknown }).wrongCount) ?? resultUi?.wrongCount ?? null;
      const passed = pickBoolean((submitRes as unknown as { passed?: unknown }).passed) ?? resultUi?.passed ?? null;

      showResultMessage(
        passed ? "success" : "info",
        passed ? "합격입니다" : "제출 완료",
        `점수 ${score !== null ? Math.round(score) : "-"}점 (정답 ${correctCount ?? "-"}/${totalCount ?? "-"}, 오답 ${
          wrongCount ?? "-"
        })${passScore !== null ? ` / 합격 기준 ${Math.round(passScore)}점` : ""}${retryDesc}`
      );

      await refreshDashboard();

      setResultCourse(course);
      setResultAttemptId(attemptId);
      setMode("result");
    } catch (e) {
      showResultMessage("warning", "제출 실패", safeErrorMessage(e));
      return;
    } finally {
      setSolve(null);
      setSelectedAnswers([]);
      setSaveState({ status: "idle" });
      setTimeLimit(0);
      setRemainingSeconds(0);
      setServerExpired(false);
      autoSubmitOnceRef.current = false;
      setResultLoading(false);
    }
  };

  const handleBackFromSolve = async () => {
    try {
      if (pendingSaveTimerRef.current && hasDOM) {
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

  const handleBackFromResult = async () => {
    setMode("dashboard");
    setResultCourse(null);
    setResultAttemptId(null);
    setResultError(null);
    await refreshDashboard().catch(() => undefined);
  };

  const handleRetryFromResult = async () => {
    if (!resultCourse) return;
    const c = resultCourse;
    setResultCourse(null);
    setResultAttemptId(null);
    setResultError(null);
    await handleStartQuiz(c);
  };

  const handleOpenNoteClick = async (course: QuizCourse) => {
    if (!course.unlocked) return;

    try {
      const list = await ensureAttemptsLoaded(course.id, { force: true });
      if (list.length === 0) {
        showResultMessage("info", "오답노트 안내", "제출된 응시 내역이 없습니다.");
        return;
      }

      const idx = activeAttemptIndexByCourseId[course.id] ?? 0;
      const picked = list[idx] ?? list[list.length - 1];

      if (!picked || !isSubmittedAttempt(picked)) {
        showResultMessage("info", "오답노트 안내", "해당 회차는 아직 제출되지 않았습니다.");
        return;
      }

      const attemptId = getAttemptId(picked);
      if (!attemptId) {
        showResultMessage("warning", "오답노트 조회 실패", "attemptId를 찾을 수 없습니다.");
        return;
      }

      await openNoteForAttempt(course, attemptId);
    } catch (e) {
      setNoteError(safeErrorMessage(e));
      showResultMessage("warning", "오답노트 조회 실패", safeErrorMessage(e));
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

  // =========================
  // Result 화면 진입 시 attempt-result 보강 로딩
  // =========================
  useEffect(() => {
    if (!hasDOM) return;
    if (mode !== "result") return;
    if (!resultAttemptId) return;

    const hasCache = !!attemptResultById[resultAttemptId];
    const hasErr = !!attemptResultErrorById[resultAttemptId];
    if (hasCache && !hasErr) return;

    let cancelled = false;
    setResultLoading(true);
    setResultError(null);

    ensureAttemptResultLoaded(resultAttemptId, { force: true, courseId: resultCourse?.id })
      .catch((e) => {
        if (cancelled) return;
        setResultError(safeErrorMessage(e));
      })
      .finally(() => {
        if (cancelled) return;
        setResultLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    hasDOM,
    mode,
    resultAttemptId,
    ensureAttemptResultLoaded,
    attemptResultById,
    attemptResultErrorById,
    resultCourse?.id,
  ]);

  // =========================
  // Note 모달 ESC 닫기
  // =========================
  useEffect(() => {
    if (!hasDOM) return;
    if (!noteModal) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNoteModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasDOM, noteModal]);

  // =========================
  // Render helpers (hooks must be unconditional)
  // =========================
  const resultUi: AttemptResultUi | null = useMemo(() => {
    if (!resultAttemptId) return null;
    return attemptResultById[resultAttemptId] ?? null;
  }, [resultAttemptId, attemptResultById]);

  const resultPassScore =
    resultUi?.passScore ?? (resultCourse ? courseMetaById[resultCourse.id]?.passScore ?? null : null);

  const resultRetry =
    resultUi?.retryInfo ?? (resultCourse ? courseMetaById[resultCourse.id]?.retryInfo ?? null : null);

  const resultCanRetry =
    resultRetry?.canRetry !== null && resultRetry?.canRetry !== undefined ? resultRetry.canRetry : null;

  const resultPassed = resultUi?.passed ?? null;
  const resultWrongCount = resultUi?.wrongCount ?? null;

  const resultCanOpenNote = Boolean(resultAttemptId) && (resultWrongCount === null ? true : resultWrongCount > 0);

  // hooks 이후에만 DOM 가드
  if (!hasDOM) return null;

  // result에서 재응시 버튼 노출 정책
  const canRetryButton = resultPassed === true ? false : resultCanRetry !== null ? resultCanRetry : true;

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
        className="cb-quiz-panel-container"
        style={{
          position: "fixed",
          top: panelPos.top,
          left: panelPos.left,
          pointerEvents: "auto",
        }}
      >
        <div
          className="cb-quiz-panel cb-chatbot-panel"
          style={{ width: size.width, height: size.height }}
          onMouseDown={() => onRequestFocus?.()}
        >
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

          <button
            type="button"
            className="cb-panel-close-btn"
            onClick={() => {
              if (mode === "solve" && solve) {
                const attemptId = solve.attemptId;

                flushSaveNow({ keepalive: true, silent: true }).catch(() => undefined);

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

          <div className="cb-quiz-panel-inner" ref={contentRef} style={{ position: "relative" }}>
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
              <div className="cb-quiz-padding-medium cb-quiz-text-medium cb-quiz-text-muted">퀴즈 데이터를 불러오는 중입니다...</div>
            )}

            {mode === "dashboard" && !loading && loadError && (
              <div className="cb-quiz-padding-medium">
                <div className="cb-quiz-text-medium cb-quiz-text-error" style={{ marginBottom: 10 }}>
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

                  {departments.length === 0 ? (
                    <div className="cb-quiz-padding-small cb-quiz-text-normal cb-quiz-text-secondary">
                      표시할 부서 점수 데이터가 없습니다.
                    </div>
                  ) : (
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
                  )}
                </section>

                <section className="cb-quiz-section cb-quiz-section-quiz">
                  <div className="cb-quiz-section-header">
                    <h2 className="cb-quiz-section-title">Quiz</h2>
                  </div>

                  {courses.length === 0 ? (
                    <div className="cb-quiz-padding-small cb-quiz-text-normal cb-quiz-text-secondary">표시할 퀴즈가 없습니다.</div>
                  ) : (
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

                          const attemptId = getAttemptId(attemptFromApi);
                          const attemptResult = attemptId ? attemptResultById[attemptId] : undefined;

                          const attemptScore = getAttemptScore(attemptFromApi);

                          const activeScore =
                            attemptResult?.score !== null && attemptResult?.score !== undefined
                              ? attemptResult.score
                              : attemptScore !== null
                                ? attemptScore
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

                          const submitted = isSubmittedAttempt(attemptFromApi);

                          const hasAnySubmitted = submitted
                            ? true
                            : Array.isArray(attempts)
                              ? attempts.some((a) => isSubmittedAttempt(a))
                              : false;

                          const meta = courseMetaById[course.id];

                          const metaPassScore =
                            attemptResult?.passScore ?? normalizePassScore(attemptFromApi) ?? meta?.passScore ?? null;

                          const metaRetry =
                            attemptResult?.retryInfo ?? normalizeRetryInfo(attemptFromApi) ?? meta?.retryInfo ?? null;

                          const fallbackRemaining =
                            course.maxAttempts !== null ? Math.max(0, course.maxAttempts - course.attemptCount) : null;

                          const canStartByRetryInfo =
                            metaRetry?.canRetry !== null && metaRetry?.canRetry !== undefined ? metaRetry.canRetry : null;

                          const coursePassed = course.passed === true || attemptResult?.passed === true;

                          const canStartQuiz =
                            !isLocked &&
                            (canStartByRetryInfo !== null
                              ? canStartByRetryInfo
                              : course.maxAttempts === null
                                ? true
                                : course.attemptCount < course.maxAttempts) &&
                            coursePassed !== true;

                          const preferNote = !isLocked && (coursePassed === true || hasAnySubmitted);
                          const primaryLabel = preferNote ? "오답노트" : "퀴즈 풀기";
                          const primaryDisabled = isLocked || (!preferNote && !canStartQuiz);

                          const handlePrimaryClick = () => {
                            if (primaryDisabled) return;

                            if (preferNote) handleOpenNoteClick(course).catch(() => undefined);
                            else handleStartQuiz(course).catch(() => undefined);
                          };

                          const attemptsErr = attemptsErrorByCourseId[course.id];
                          const attemptResultErr = attemptId ? attemptResultErrorById[attemptId] : undefined;

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

                                <div className="cb-quiz-course-info-grid">
                                  <div className="cb-quiz-course-info-item">
                                    <span>합격 기준</span>
                                    <span className="cb-quiz-text-value">
                                      {metaPassScore !== null ? `${Math.round(metaPassScore)}점` : "-"}
                                    </span>
                                  </div>

                                  <div className="cb-quiz-course-info-item">
                                    <span>재응시</span>
                                    <span className="cb-quiz-text-value">
                                      {metaRetry
                                        ? metaRetry.canRetry === null
                                          ? "-"
                                          : metaRetry.canRetry
                                            ? "가능"
                                            : "불가"
                                        : coursePassed === true
                                          ? "불가"
                                          : "가능"}
                                    </span>
                                  </div>

                                  <div className="cb-quiz-course-info-item">
                                    <span>남은 횟수</span>
                                    <span className="cb-quiz-text-value">
                                      {metaRetry
                                        ? `${metaRetry.remainingAttempts ?? "-"} / ${metaRetry.maxAttempts ?? "-"}`
                                        : fallbackRemaining !== null && course.maxAttempts !== null
                                          ? `${fallbackRemaining} / ${course.maxAttempts}`
                                          : "-"}
                                    </span>
                                  </div>

                                  <div className="cb-quiz-course-info-item">
                                    <span>응시 횟수</span>
                                    <span className="cb-quiz-text-value">
                                      {metaRetry?.usedAttempts !== null && metaRetry?.usedAttempts !== undefined
                                        ? `${metaRetry.usedAttempts}`
                                        : `${course.attemptCount}`}
                                    </span>
                                  </div>
                                </div>

                                {attemptsErr && (
                                  <p className="cb-quiz-locked-text cb-quiz-text-error">
                                    응시 내역/메타 불러오기 실패: {attemptsErr}
                                  </p>
                                )}

                                {attemptResultErr && (
                                  <p className="cb-quiz-locked-text cb-quiz-text-error">
                                    응시 결과 불러오기 실패: {attemptResultErr}
                                  </p>
                                )}

                                {isLocked && <p className="cb-quiz-locked-text">교육 이수 완료 후 퀴즈를 풀 수 있어요.</p>}

                                {!isLocked && coursePassed === true && (
                                  <p className="cb-quiz-locked-text cb-quiz-text-success">
                                    이미 합격 처리되었습니다. 오답노트만 확인할 수 있어요.
                                  </p>
                                )}

                                {!isLocked && metaRetry?.reason && (
                                  <p className="cb-quiz-locked-text cb-quiz-text-muted">
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
                  )}
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
                      <div className="cb-quiz-solve-tab is-active cb-quiz-solve-tab-active">
                        {formatRemaining(remainingSeconds)}
                      </div>
                    </div>
                  </div>

                  <div className="cb-quiz-solve-meta cb-quiz-flex-center">
                    <span>{solve.course.title}</span>

                    <span
                      className="cb-quiz-solve-meta-badge"
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
                                className={
                                  "cb-quiz-solve-option" + (selectedAnswers[idx] === optIdx ? " is-selected" : "")
                                }
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

                    <div className="cb-quiz-solve-info-grid">
                      <div className="cb-quiz-flex-row">
                        <span>합격 기준(passScore)</span>
                        <span className="cb-quiz-text-value">
                          {Number.isFinite(solvePassScoreDisplay) ? `${Math.round(solvePassScoreDisplay)}점` : "-"}
                        </span>
                      </div>

                      <div className="cb-quiz-flex-row">
                        <span>재응시(retry-info)</span>
                        <span className="cb-quiz-text-value">
                          {solveRetryDisplay
                            ? solveRetryDisplay.canRetry === null
                              ? "-"
                              : solveRetryDisplay.canRetry
                                ? "가능"
                                : "불가"
                            : "-"}
                        </span>
                      </div>

                      <div className="cb-quiz-flex-row">
                        <span>남은 횟수</span>
                        <span className="cb-quiz-text-value">
                          {solveRetryDisplay
                            ? `${solveRetryDisplay.remainingAttempts ?? "-"} / ${solveRetryDisplay.maxAttempts ?? "-"}`
                            : "-"}
                        </span>
                      </div>

                      <div className="cb-quiz-opacity-90">
                        서버 DTO가 아직 내려오지 않는 환경에서는 기본 합격 기준 {DEFAULT_PASSING_SCORE}점으로 표시됩니다.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* result */}
            {mode === "result" && resultCourse && resultAttemptId && (
              <div className="cb-quiz-solve-layout">
                <header className="cb-quiz-solve-header">
                  <div className="cb-quiz-solve-header-left">
                    <button
                      type="button"
                      className="cb-quiz-solve-back-btn"
                      onClick={() => handleBackFromResult().catch(() => undefined)}
                      aria-label="퀴즈 목록으로 돌아가기"
                    >
                      ◀
                    </button>
                    <h2 className="cb-quiz-solve-title">결과</h2>
                  </div>

                  <div className="cb-quiz-solve-meta cb-quiz-flex-center">
                    <span>{resultCourse.title}</span>
                    <span className="cb-quiz-solve-meta-badge">
                      {resultPassed === null ? "결과 확인" : resultPassed ? "합격" : "불합격"}
                    </span>
                  </div>
                </header>

                <div className="cb-quiz-solve-body">
                  <div className="cb-quiz-solve-card">
                    <div className="cb-quiz-padding-result cb-quiz-grid-small">
                      {resultLoading ? (
                        <div className="cb-quiz-text-medium cb-quiz-text-muted">결과를 불러오는 중입니다...</div>
                      ) : resultError ? (
                        <div className="cb-quiz-text-medium cb-quiz-text-error">결과 불러오기 실패: {resultError}</div>
                      ) : (
                        <>
                          <div className="cb-quiz-flex-row">
                            <span className="cb-quiz-result-label">점수</span>
                            <span className="cb-quiz-result-value">
                              {resultUi?.score !== null && resultUi?.score !== undefined ? `${Math.round(resultUi.score)}점` : "-"}
                            </span>
                          </div>

                          <div className="cb-quiz-flex-row">
                            <span className="cb-quiz-result-label">정답/전체</span>
                            <span className="cb-quiz-text-value">
                              {resultUi?.correctCount ?? "-"} / {resultUi?.totalCount ?? "-"}
                            </span>
                          </div>

                          <div className="cb-quiz-flex-row">
                            <span className="cb-quiz-result-label">오답</span>
                            <span className="cb-quiz-text-value">{resultUi?.wrongCount ?? "-"}</span>
                          </div>

                          <div className="cb-quiz-flex-row">
                            <span className="cb-quiz-result-label-small">합격 기준(passScore)</span>
                            <span className="cb-quiz-text-value">
                              {resultPassScore !== null ? `${Math.round(resultPassScore)}점` : "-"}
                            </span>
                          </div>

                          <div className="cb-quiz-flex-row">
                            <span className="cb-quiz-result-label-small">재응시(retry-info)</span>
                            <span className="cb-quiz-text-value">
                              {resultRetry
                                ? resultRetry.canRetry === null
                                  ? "-"
                                  : resultRetry.canRetry
                                    ? "가능"
                                    : "불가"
                                : "-"}
                            </span>
                          </div>

                          <div className="cb-quiz-flex-row">
                            <span className="cb-quiz-result-label-small">남은 횟수</span>
                            <span className="cb-quiz-text-value">
                              {resultRetry ? `${resultRetry.remainingAttempts ?? "-"} / ${resultRetry.maxAttempts ?? "-"}` : "-"}
                            </span>
                          </div>

                          {resultUi?.submittedAt && (
                            <div className="cb-quiz-flex-row">
                              <span className="cb-quiz-result-label">제출 시각</span>
                              <span className="cb-quiz-text-value cb-quiz-text-normal">{resultUi.submittedAt}</span>
                            </div>
                          )}

                          <div className="cb-quiz-result-actions">
                            <button
                              type="button"
                              className="cb-quiz-note-btn"
                              disabled={!resultCanOpenNote}
                              onClick={() => {
                                if (!resultCourse || !resultAttemptId) return;
                                openNoteForAttempt(resultCourse, resultAttemptId).catch(() => undefined);
                              }}
                            >
                              오답노트
                            </button>

                            <button
                              type="button"
                              className="cb-quiz-note-btn"
                              disabled={!canRetryButton}
                              onClick={() => handleRetryFromResult().catch(() => undefined)}
                              title={canRetryButton ? "다시 응시" : "재응시 불가"}
                            >
                              다시 풀기
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* note */}
            {mode === "note" && noteCourse && noteAttemptId && (
              <div className="cb-quiz-solve-layout">
                <header className="cb-quiz-solve-header">
                  <div className="cb-quiz-solve-header-left">
                    <button
                      type="button"
                      className="cb-quiz-solve-back-btn"
                      onClick={handleBackFromNote}
                      aria-label="퀴즈 목록으로 돌아가기"
                    >
                      ◀
                    </button>
                    <h2 className="cb-quiz-solve-title">오답노트</h2>
                  </div>

                  <div className="cb-quiz-solve-meta cb-quiz-flex-center">
                    <span>{noteCourse.title}</span>
                    <span className="cb-quiz-solve-meta-badge">
                      {noteAttemptIndex + 1}회차
                    </span>
                  </div>
                </header>

                <div className="cb-quiz-solve-body">
                  <div className="cb-quiz-solve-card">
                    <div className="cb-quiz-padding-small">
                      {noteLoading ? (
                        <div className="cb-quiz-text-medium cb-quiz-text-muted">오답노트를 불러오는 중입니다...</div>
                      ) : noteError ? (
                        <div className="cb-quiz-text-medium cb-quiz-text-error">불러오기 실패: {noteError}</div>
                      ) : noteItems.length === 0 ? (
                        <div className="cb-quiz-text-medium cb-quiz-text-muted">표시할 오답이 없습니다.</div>
                      ) : (
                        <div className="cb-quiz-grid-note">
                          {noteItems.map((it) => (
                            <button
                              key={`${it.attemptId}-${it.questionNumber}`}
                              type="button"
                              className="cb-quiz-note-btn cb-quiz-note-item-btn"
                              onClick={() => setNoteModal(it)}
                            >
                              <span className="cb-quiz-note-item-number">
                                {it.questionNumber}
                              </span>
                              <span className="cb-quiz-note-item-text">{it.questionText}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* note modal */}
                {noteModal && (
                  <div
                    role="dialog"
                    aria-modal="true"
                    className="cb-quiz-note-modal-backdrop"
                    onClick={() => setNoteModal(null)}
                  >
                    <div
                      className="cb-quiz-note-modal"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="cb-quiz-note-modal-header">
                        <div className="cb-quiz-note-modal-title">{noteModal.questionNumber}번 문제</div>
                        <button
                          type="button"
                          className="cb-quiz-note-btn"
                          onClick={() => setNoteModal(null)}
                          style={{ width: "auto" }}
                        >
                          닫기
                        </button>
                      </div>

                      <div className="cb-quiz-note-modal-body">
                        <div className="cb-quiz-note-modal-section-title">문제</div>
                        <div className="cb-quiz-note-modal-section-content">{noteModal.questionText}</div>

                        <div className="cb-quiz-note-modal-section-title">해설</div>
                        <div className="cb-quiz-note-modal-explanation">{noteModal.explanation || "해설이 없습니다."}</div>
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
