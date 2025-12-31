// src/components/chatbot/quizData.ts

export type QuizCourse = {
  id: string; // educationId
  title: string;
  category?: string | null;
  eduType?: string | null;
  educationStatus?: string | null;

  // UI 계산 필드
  unlocked: boolean; // 교육 이수 완료(혹은 퀴즈 가능 상태)
  attemptCount: number;
  maxAttempts: number | null;
  hasAttempted: boolean;
  bestScore: number | null; // 0~100
  passed: boolean | null;
};

/**
 * attempt dots UI 기본값(서버가 maxAttempts를 주지 않거나 unlimited(null)일 때의 안전한 표시용)
 * - 실제 제한은 서버가 최종 권한(서버 응답이 우선)
 */
export const QUIZ_ATTEMPT_FALLBACK = 2;

export type QuizQuestion = {
  id: string; // questionId
  order: number;
  question: string;
  choices: string[];
  userSelectedIndex?: number | null;
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

export type WrongAnswerEntry = {
  attemptId: string;
  questionNumber: number;
  questionText: string;
  explanation: string;
};

export function normalizeUnlockedFromStatus(
  status: string | null | undefined
): boolean {
  if (!status) return true; // 서버가 completed만 내려주는 구현도 있어서 “기본 true”가 안전
  const s = status.toUpperCase();
  return s === "COMPLETED" || s === "DONE" || s === "FINISHED";
}

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "-";
  if (!Number.isFinite(score)) return "-";
  return `${Math.round(score)}점`;
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function scoreToPercent(score: number | null | undefined): number {
  if (score === null || score === undefined) return 0;
  if (!Number.isFinite(score)) return 0;
  return clamp01(score / 100) * 100;
}

/**
 * FloatingChatbotRoot에서 "초기 unlockedCourseIds"를 계산할 때 사용하는 코스 시드.
 * - 백엔드(API)에서 코스 목록을 받아오는 구조면 빈 배열이어도 정상 동작(초기 언락 없음)
 * - 로컬에서 기본 코스를 보여주고 싶으면 여기 배열에 QuizCourse를 채우면 됨
 *
 * 중요:
 * - FloatingChatbotRoot는 "스캔 방식"을 쓰지 않고,
 *   이 export 하나만 정확히 import 해서 사용하도록 설계한다.
 */
export const initialCourses: QuizCourse[] = [];
