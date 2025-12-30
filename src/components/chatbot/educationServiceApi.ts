// src/components/chatbot/educationServiceApi.ts
import { fetchJson } from "./authHttp";

type EnvLike = Record<string, string | undefined>;
const ENV = import.meta.env as unknown as EnvLike;

const EDU_BASE = String(ENV.VITE_EDU_API_BASE ?? "/api-edu").replace(/\/$/, "");

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function pickArray(raw: unknown, keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function unwrapRecord(raw: unknown, keys: string[] = ["data", "result"]): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;

  // 1) 최상위가 DTO인 경우
  const top = raw as Record<string, unknown>;

  // 2) { data: {...} } / { result: {...} } 래핑을 한 번 평탄화
  for (const k of keys) {
    const inner = top[k];
    if (isRecord(inner)) {
      return { ...top, ...(inner as Record<string, unknown>) };
    }
  }

  return top;
}

function unwrapAny(raw: unknown): unknown {
  // list 추출이 실패하는 흔한 케이스: { data: { items: [...] } }
  // => data/result를 한 번 평탄화한 객체로 바꿔서 pickArray가 작동하게 함
  const r = unwrapRecord(raw);
  return r ?? raw;
}

function toId(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function toNumOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toBoolOrNull(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

/* =========================
 * Education (기존)
 * ========================= */

export type EducationItem = {
  id: string;
  title: string;
  description?: string;
  eduType?: string;
  createdAt?: string;
  completed?: boolean; // isCompleted/completed 혼재 가능
};

export type EducationVideoItem = {
  id: string;
  title: string;
  fileUrl?: string;
  durationSeconds?: number;
  progressPercent?: number;
  resumePositionSeconds?: number;
  completed?: boolean;
};

export type EduProgressPayload = {
  position: number; // seconds
  watchTime: number; // seconds (delta)
};

export type EduProgressResponse = {
  progressPercent?: number;
  resumePositionSeconds?: number;
  videoCompleted?: boolean;
  eduCompleted?: boolean;
};

function buildEduQuery(params?: { completed?: boolean; eduType?: string; sort?: string }): string {
  if (!params) return "";
  const q = new URLSearchParams();
  if (params.completed !== undefined) q.set("completed", String(params.completed));
  if (params.eduType) q.set("eduType", params.eduType);
  if (params.sort) q.set("sort", params.sort);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function getMyEducations(
  params?: { completed?: boolean; eduType?: string; sort?: string },
  init?: Pick<RequestInit, "signal">
): Promise<EducationItem[]> {
  const qs = buildEduQuery(params);
  const url = `${EDU_BASE}/edus/me${qs}`;

  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });
  const list = pickArray(unwrapAny(raw), ["eduList", "educations", "items", "data", "result"]);

  return list
    .map((it): EducationItem | null => {
      if (!isRecord(it)) return null;

      const id = toId(it.id);
      if (!id) return null;

      const title =
        (typeof it.title === "string" && it.title.trim()) ||
        (typeof it.name === "string" && it.name.trim()) ||
        `교육 ${id}`;

      const completed =
        typeof it.isCompleted === "boolean"
          ? it.isCompleted
          : typeof it.completed === "boolean"
            ? it.completed
            : undefined;

      return {
        id,
        title,
        description: typeof it.description === "string" ? it.description : undefined,
        eduType: typeof it.eduType === "string" ? it.eduType : undefined,
        createdAt: typeof it.createdAt === "string" ? it.createdAt : undefined,
        completed,
      };
    })
    .filter((v): v is EducationItem => v !== null);
}

export async function getEducationVideos(
  educationId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<EducationVideoItem[]> {
  const url = `${EDU_BASE}/edu/${encodeURIComponent(String(educationId))}/videos`;
  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });

  const list = pickArray(unwrapAny(raw), ["videos", "videoList", "items", "data", "result"]);

  return list
    .map((it): EducationVideoItem | null => {
      if (!isRecord(it)) return null;

      const id = toId(it.id);
      if (!id) return null;

      const title =
        (typeof it.title === "string" && it.title.trim()) ||
        (typeof it.name === "string" && it.name.trim()) ||
        `영상 ${id}`;

      const progressPercent =
        typeof it.progressPercent === "number"
          ? it.progressPercent
          : typeof it.progress === "number"
            ? it.progress
            : undefined;

      const resumePositionSeconds =
        typeof it.resumePositionSeconds === "number"
          ? it.resumePositionSeconds
          : typeof it.resumeSeconds === "number"
            ? it.resumeSeconds
            : undefined;

      const completed =
        typeof it.isCompleted === "boolean"
          ? it.isCompleted
          : typeof it.completed === "boolean"
            ? it.completed
            : undefined;

      return {
        id,
        title,
        fileUrl: typeof it.fileUrl === "string" ? it.fileUrl : undefined,
        durationSeconds: typeof it.durationSeconds === "number" ? it.durationSeconds : undefined,
        progressPercent,
        resumePositionSeconds,
        completed,
      };
    })
    .filter((v): v is EducationVideoItem => v !== null);
}

export async function postEduVideoProgress(
  educationId: string | number,
  videoId: string | number,
  payload: EduProgressPayload,
  init?: Pick<RequestInit, "signal" | "keepalive">
): Promise<EduProgressResponse | null> {
  const url = `${EDU_BASE}/edu/${encodeURIComponent(String(educationId))}/video/${encodeURIComponent(String(videoId))}/progress`;

  const raw = await fetchJson<unknown>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: init?.signal,
    keepalive: init?.keepalive,
  });

  const dto = unwrapRecord(raw);
  return (dto as unknown as EduProgressResponse | null) ?? null;
}

export async function completeEducation(educationId: string | number): Promise<unknown | null> {
  const url = `${EDU_BASE}/edu/${encodeURIComponent(String(educationId))}/complete`;
  return await fetchJson<unknown | null>(url, { method: "POST" });
}

/* =========================
 * Quiz (신규/패치)
 * - 문서 기준 경로 정합성:
 *   retry-info / my-attempts / leave / wrongs
 * - start/submit 응답 raw 보존(추가 필드가 내려와도 UI에서 normalize로 읽을 수 있게)
 * ========================= */

export type QuizAvailableEducation = {
  educationId: string;
  title: string;
  category?: string | null;
  eduType?: string | null;
  educationStatus?: string | null; // NOT_STARTED | IN_PROGRESS | COMPLETED 등
  attemptCount: number;
  maxAttempts: number | null;
  hasAttempted: boolean;
  bestScore: number | null;
  passed: boolean | null;
};

export type QuizDepartmentStat = {
  departmentName: string;
  averageScore: number; // 0~100
  progressPercent: number; // 0~100
  participantCount: number;
};

export type QuizQuestionItem = {
  questionId: string;
  order: number;
  question: string;
  choices: string[];
  userSelectedIndex?: number | null;
  answerIndex?: number | null;
  correctOption?: number | null;
};

export type QuizStartResponse = {
  attemptId: string;
  questions: QuizQuestionItem[];
  savedAnswers?: Array<{ questionId: string; userSelectedIndex: number }>;
};

export type QuizTimerResponse = {
  timeLimit: number; // seconds
  startedAt: string; // ISO
  expiresAt: string; // ISO
  remainingSeconds: number;
  isExpired: boolean;
};

export type QuizAnswerPayloadItem = {
  questionId: string;
  userSelectedIndex: number; // 0-based
};

export type QuizSavePayload = {
  answers: QuizAnswerPayloadItem[];
  elapsedSeconds?: number; // seconds
};

export type QuizSaveResponse = {
  saved: boolean;
  savedCount?: number;
  savedAt?: string;
};

export type QuizSubmitPayload = {
  answers: QuizAnswerPayloadItem[];
};

export type QuizSubmitResponse = {
  score: number;
  passed: boolean;
  correctCount: number;
  wrongCount: number;
  totalCount: number;
  submittedAt?: string;
};

export type QuizResultResponse = {
  score: number;
  passed: boolean;
  passScore: number;
  correctCount: number;
  wrongCount: number;
  totalCount: number;
  finishedAt?: string;
};

export type QuizWrongNoteItem = {
  question: string;
  userAnswerIndex: number;
  correctAnswerIndex: number;
  explanation: string;
  choices: string[];
};

export type QuizAttemptSummary = {
  attemptId: string;
  attemptNo: number;
  status: string; // IN_PROGRESS | SUBMITTED ...
  score: number | null;
  passed: boolean | null;
  startedAt?: string;
  submittedAt?: string;
};

export type QuizRetryInfo = {
  canRetry: boolean;
  currentAttemptCount: number;
  maxAttempts: number | null;
  remainingAttempts: number | null;
  bestScore: number | null;
  passed: boolean | null;
};

export type QuizLeavePayload = {
  timestamp?: string; // ISO
  reason?: string; // e.g. "CLOSE" | "HIDDEN" | "UNLOAD" | "BACK"
  leaveSeconds?: number;
};

export type QuizLeaveResponse = {
  recorded: boolean;
  leaveCount?: number;
  lastLeaveAt?: string;
};

function pickQuizList(raw: unknown): unknown[] {
  const r = unwrapAny(raw);
  return pickArray(r, [
    "data",
    "items",
    "result",
    "educations",
    "educationList",
    "list",
    "wrongs",
    "attempts",
    "myAttempts",
    "my_attempts",
    "my-attempts",
  ]);
}

export async function getQuizDepartmentStats(init?: Pick<RequestInit, "signal">): Promise<QuizDepartmentStat[]> {
  const url = `${EDU_BASE}/quiz/department-stats`;
  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });

  const list = pickQuizList(raw);

  return list
    .map((it): QuizDepartmentStat | null => {
      if (!isRecord(it)) return null;
      const departmentName =
        (typeof it.departmentName === "string" && it.departmentName) ||
        (typeof it.name === "string" && it.name) ||
        "";
      if (!departmentName) return null;

      const averageScore = toNumOrNull(it.averageScore) ?? 0;
      const progressPercent = toNumOrNull(it.progressPercent) ?? 0;
      const participantCount = toNumOrNull(it.participantCount) ?? 0;

      return {
        departmentName,
        averageScore,
        progressPercent,
        participantCount,
      };
    })
    .filter((v): v is QuizDepartmentStat => v !== null);
}

export async function getQuizAvailableEducations(init?: Pick<RequestInit, "signal">): Promise<QuizAvailableEducation[]> {
  const url = `${EDU_BASE}/quiz/available-educations`;
  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });

  const list = pickQuizList(raw);

  return list
    .map((it): QuizAvailableEducation | null => {
      if (!isRecord(it)) return null;

      const educationId = toId(it.educationId ?? (it as Record<string, unknown>)["education_id"] ?? (it as Record<string, unknown>)["education-id"]);
      if (!educationId) return null;

      const title =
        (typeof it.title === "string" && it.title.trim()) ||
        (typeof (it as Record<string, unknown>).educationTitle === "string" && String((it as Record<string, unknown>).educationTitle).trim()) ||
        `교육 ${educationId}`;

      const attemptCount = toNumOrNull(it.attemptCount) ?? 0;
      const maxAttempts = toNumOrNull(it.maxAttempts);
      const hasAttempted = (toBoolOrNull((it as Record<string, unknown>).hasAttempted) ?? false) as boolean;

      const bestScore = toNumOrNull(it.bestScore);
      const passed = toBoolOrNull(it.passed);

      const category =
        typeof it.category === "string"
          ? it.category
          : typeof (it as Record<string, unknown>).eduCategory === "string"
            ? String((it as Record<string, unknown>).eduCategory)
            : null;

      const eduType = typeof it.eduType === "string" ? it.eduType : null;
      const educationStatus = typeof it.educationStatus === "string" ? it.educationStatus : null;

      return {
        educationId,
        title,
        category,
        eduType,
        educationStatus,
        attemptCount,
        maxAttempts,
        hasAttempted,
        bestScore,
        passed,
      };
    })
    .filter((v): v is QuizAvailableEducation => v !== null);
}

export async function startQuiz(
  educationId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizStartResponse> {
  const url = `${EDU_BASE}/quiz/${encodeURIComponent(String(educationId))}/start`;
  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });

  const dto = unwrapRecord(raw);
  if (!dto) throw new Error("퀴즈 시작 응답 형식이 올바르지 않습니다.");

  const attemptId = toId(dto.attemptId ?? dto["attempt_id"] ?? dto["attempt-id"]);
  if (!attemptId) throw new Error("attemptId가 누락되었습니다.");

  const qList = pickArray(dto, ["questions", "items", "data", "result"]);
  const questions: QuizQuestionItem[] = qList
    .map((q): QuizQuestionItem | null => {
      if (!isRecord(q)) return null;

      const questionId = toId((q as Record<string, unknown>).questionId ?? (q as Record<string, unknown>).id);
      if (!questionId) return null;

      const order = toNumOrNull((q as Record<string, unknown>).order) ?? 0;
      const question =
        (typeof (q as Record<string, unknown>).question === "string" && String((q as Record<string, unknown>).question)) ||
        (typeof (q as Record<string, unknown>).text === "string" && String((q as Record<string, unknown>).text)) ||
        "";

      const choicesRaw = (q as Record<string, unknown>).choices;
      const choices = Array.isArray(choicesRaw) ? (choicesRaw.filter((x) => typeof x === "string") as string[]) : [];

      const userSelectedIndex = toNumOrNull((q as Record<string, unknown>).userSelectedIndex);
      const answerIndex = toNumOrNull((q as Record<string, unknown>).answerIndex);
      const correctOption = toNumOrNull((q as Record<string, unknown>).correctOption);

      return {
        questionId,
        order,
        question,
        choices,
        userSelectedIndex,
        answerIndex,
        correctOption,
      };
    })
    .filter((v): v is QuizQuestionItem => v !== null);

  const savedAnswersRaw = pickArray(dto, ["savedAnswers", "saved_answers", "answers"]);
  const savedAnswers = savedAnswersRaw
    .map((a): { questionId: string; userSelectedIndex: number } | null => {
      if (!isRecord(a)) return null;
      const questionId = toId((a as Record<string, unknown>).questionId ?? (a as Record<string, unknown>).id);
      const idx = toNumOrNull((a as Record<string, unknown>).userSelectedIndex);
      if (!questionId || idx === null) return null;
      return { questionId, userSelectedIndex: idx };
    })
    .filter((v): v is { questionId: string; userSelectedIndex: number } => v !== null);

  // 중요: raw 전체 필드를 보존하여(passScore, retry-info, attemptNo 등) UI normalize 함수가 읽을 수 있게 한다.
  const merged: Record<string, unknown> = {
    ...(dto as Record<string, unknown>),
    attemptId,
    questions,
  };
  if (savedAnswers.length) merged.savedAnswers = savedAnswers;

  return merged as unknown as QuizStartResponse;
}

export async function getQuizTimer(
  attemptId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizTimerResponse> {
  const url = `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/timer`;
  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });

  const dto = unwrapRecord(raw);
  if (!dto) throw new Error("타이머 응답 형식이 올바르지 않습니다.");

  const timeLimit = toNumOrNull(dto.timeLimit) ?? 0;
  const startedAt = typeof dto.startedAt === "string" ? dto.startedAt : "";
  const expiresAt = typeof dto.expiresAt === "string" ? dto.expiresAt : "";
  const remainingSeconds = toNumOrNull(dto.remainingSeconds) ?? 0;
  const isExpired = (toBoolOrNull(dto.isExpired) ?? false) as boolean;

  return { timeLimit, startedAt, expiresAt, remainingSeconds, isExpired };
}

/**
 * 일부 구현체는 PUT /timer 로 "remainingSeconds 업데이트"를 요구할 수 있음.
 */
export async function putQuizTimer(
  attemptId: string | number,
  payload: { remainingSeconds: number },
  init?: Pick<RequestInit, "signal" | "keepalive">
): Promise<{ updated: boolean } | null> {
  const url = `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/timer`;
  const raw = await fetchJson<unknown>(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: init?.signal,
    keepalive: init?.keepalive,
  });

  const dto = unwrapRecord(raw);
  if (!dto) return null;

  const updated = (toBoolOrNull(dto.updated) ?? true) as boolean;
  return { updated };
}

export async function saveQuizAnswers(
  attemptId: string | number,
  payload: QuizSavePayload,
  init?: Pick<RequestInit, "signal" | "keepalive">
): Promise<QuizSaveResponse | null> {
  const url = `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/save`;

  const raw = await fetchJson<unknown>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: init?.signal,
    keepalive: init?.keepalive,
  });

  const dto = unwrapRecord(raw);
  if (!dto) return null;

  const saved = (toBoolOrNull(dto.saved) ?? true) as boolean;
  const savedCount = toNumOrNull(dto.savedCount ?? dto.saved_count) ?? undefined;
  const savedAt = typeof dto.savedAt === "string" ? dto.savedAt : typeof dto.saved_at === "string" ? String(dto.saved_at) : undefined;

  const out: QuizSaveResponse = { saved };
  if (savedCount !== undefined) out.savedCount = savedCount;
  if (savedAt) out.savedAt = savedAt;
  return out;
}

export async function submitQuizAnswers(
  attemptId: string | number,
  payload: QuizSubmitPayload,
  init?: Pick<RequestInit, "signal">
): Promise<QuizSubmitResponse> {
  const url = `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/submit`;
  const raw = await fetchJson<unknown>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: init?.signal,
  });

  const dto = unwrapRecord(raw);
  if (!dto) throw new Error("제출 응답 형식이 올바르지 않습니다.");

  const score = toNumOrNull(dto.score) ?? 0;
  const passed = (toBoolOrNull(dto.passed) ?? false) as boolean;
  const correctCount = toNumOrNull(dto.correctCount) ?? 0;
  const wrongCount = toNumOrNull(dto.wrongCount) ?? 0;
  const totalCount = toNumOrNull(dto.totalCount) ?? 0;
  const submittedAt = typeof dto.submittedAt === "string" ? dto.submittedAt : undefined;

  // 중요: raw 전체 필드를 보존하여(passScore, retry-info 등) UI normalize 함수가 읽을 수 있게 한다.
  const merged: Record<string, unknown> = {
    ...(dto as Record<string, unknown>),
    score,
    passed,
    correctCount,
    wrongCount,
    totalCount,
  };
  if (submittedAt) merged.submittedAt = submittedAt;

  return merged as unknown as QuizSubmitResponse;
}

export async function getQuizResult(
  attemptId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizResultResponse> {
  const url = `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/result`;
  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });

  const dto = unwrapRecord(raw);
  if (!dto) throw new Error("결과 응답 형식이 올바르지 않습니다.");

  const score = toNumOrNull(dto.score) ?? 0;
  const passed = (toBoolOrNull(dto.passed) ?? false) as boolean;
  const passScore = toNumOrNull(dto.passScore ?? dto.pass_score ?? dto["pass-score"]) ?? 0;
  const correctCount = toNumOrNull(dto.correctCount) ?? 0;
  const wrongCount = toNumOrNull(dto.wrongCount) ?? 0;
  const totalCount = toNumOrNull(dto.totalCount) ?? 0;
  const finishedAt = typeof dto.finishedAt === "string" ? dto.finishedAt : undefined;

  return { score, passed, passScore, correctCount, wrongCount, totalCount, finishedAt };
}

export async function getQuizWrongs(
  attemptId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizWrongNoteItem[]> {
  // 문서 정합성: wrongs는 attempt 기준
  const url = `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/wrongs`;
  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });

  const list = pickQuizList(raw);

  return list
    .map((it): QuizWrongNoteItem | null => {
      if (!isRecord(it)) return null;

      const question = typeof it.question === "string" ? it.question : "";
      if (!question) return null;

      const userAnswerIndex = toNumOrNull(it.userAnswerIndex) ?? -1;
      const correctAnswerIndex = toNumOrNull(it.correctAnswerIndex) ?? -1;
      const explanation = typeof it.explanation === "string" ? it.explanation : "";

      const choicesRaw = it.choices;
      const choices = Array.isArray(choicesRaw) ? (choicesRaw.filter((x) => typeof x === "string") as string[]) : [];

      return { question, userAnswerIndex, correctAnswerIndex, explanation, choices };
    })
    .filter((v): v is QuizWrongNoteItem => v !== null);
}

export async function getQuizEducationAttempts(
  educationId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizAttemptSummary[]> {
  // 문서 정합성: my-attempts
  const url = `${EDU_BASE}/quiz/${encodeURIComponent(String(educationId))}/my-attempts`;
  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });

  const list = pickQuizList(raw);

  return list
    .map((it): QuizAttemptSummary | null => {
      if (!isRecord(it)) return null;

      const attemptId = toId(it.attemptId ?? (it as Record<string, unknown>)["attempt_id"] ?? (it as Record<string, unknown>)["attempt-id"]);
      if (!attemptId) return null;

      const attemptNo = toNumOrNull(it.attemptNo ?? (it as Record<string, unknown>)["attempt_no"] ?? (it as Record<string, unknown>)["attempt-no"]) ?? 0;
      const status = typeof it.status === "string" ? it.status : "UNKNOWN";

      const score = toNumOrNull(it.score);
      const passed = toBoolOrNull(it.passed);

      const startedAt = typeof it.startedAt === "string" ? it.startedAt : undefined;
      const submittedAt = typeof it.submittedAt === "string" ? it.submittedAt : undefined;

      return { attemptId, attemptNo, status, score, passed, startedAt, submittedAt };
    })
    .filter((v): v is QuizAttemptSummary => v !== null);
}

export async function getQuizRetryInfo(
  educationId: string | number,
  init?: Pick<RequestInit, "signal">
): Promise<QuizRetryInfo> {
  const url = `${EDU_BASE}/quiz/${encodeURIComponent(String(educationId))}/retry-info`;
  const raw = await fetchJson<unknown>(url, { method: "GET", signal: init?.signal });

  const dto = unwrapRecord(raw);
  if (!dto) throw new Error("재응시 정보 응답 형식이 올바르지 않습니다.");

  const canRetry = (toBoolOrNull(dto.canRetry ?? dto.can_retry ?? dto["can-retry"]) ?? false) as boolean;
  const currentAttemptCount = toNumOrNull(dto.currentAttemptCount ?? dto.current_attempt_count ?? dto["current-attempt-count"]) ?? 0;
  const maxAttempts = toNumOrNull(dto.maxAttempts ?? dto.max_attempts ?? dto["max-attempts"]);
  const remainingAttempts = toNumOrNull(dto.remainingAttempts ?? dto.remaining_attempts ?? dto["remaining-attempts"]);
  const bestScore = toNumOrNull(dto.bestScore ?? dto.best_score ?? dto["best-score"]);
  const passed = toBoolOrNull(dto.passed);

  return { canRetry, currentAttemptCount, maxAttempts, remainingAttempts, bestScore, passed };
}

export async function postQuizLeave(
  attemptId: string | number,
  payload: QuizLeavePayload,
  init?: Pick<RequestInit, "signal" | "keepalive">
): Promise<QuizLeaveResponse | null> {
  const url = `${EDU_BASE}/quiz/attempt/${encodeURIComponent(String(attemptId))}/leave`;

  const raw = await fetchJson<unknown>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: init?.signal,
    keepalive: init?.keepalive,
  });

  const dto = unwrapRecord(raw);
  if (!dto) return null;

  const recorded = (toBoolOrNull(dto.recorded) ?? true) as boolean;
  const leaveCount = toNumOrNull(dto.leaveCount ?? dto.leave_count) ?? undefined;
  const lastLeaveAt = typeof dto.lastLeaveAt === "string" ? dto.lastLeaveAt : typeof dto.last_leave_at === "string" ? String(dto.last_leave_at) : undefined;

  const out: QuizLeaveResponse = { recorded };
  if (leaveCount !== undefined) out.leaveCount = leaveCount;
  if (lastLeaveAt) out.lastLeaveAt = lastLeaveAt;
  return out;
}
