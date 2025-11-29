// src/components/chatbot/QuizPanel.tsx
import React, { useEffect, useRef, useState } from "react";
import "./chatbot.css";
import {
  computePanelPosition,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";
import {
  initialCourses,
  type QuizCourse,
  type QuizQuestion,
  type WrongAnswerEntry,
  quizQuestionBank,
} from "./quizData";

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

// 통과 기준 점수
const PASSING_SCORE = 80;

// localStorage key
const STORAGE_KEY = "ctrlf_quiz_courses_v1";
const WRONG_NOTES_KEY = "ctrlf_quiz_wrong_notes_v1";

// =========================
// 데이터 타입
// =========================

type DepartmentScore = {
  id: string;
  name: string;
  avgScore: number; // 0~100
  progress: number; // 0~100, 전체 진행률
};

interface QuizPanelProps {
  anchor?: Anchor | null;
  onClose: () => void;
  onOpenNote?: (courseId: string) => void;
  unlockedCourseIds?: string[];
  // 현재 시험 모드(퀴즈 풀기 화면)인지 상위에 알려주는 콜백
  onExamModeChange?: (isExamMode: boolean) => void;
}

type PanelMode = "dashboard" | "solve" | "note";

// 알림 배너 타입
type ResultType = "success" | "warning" | "info";

type ResultMessage = {
  type: ResultType;
  title: string;
  description?: string;
};

// 모달 안에서 쓸 텍스트 묶음 타입
// 👉 요구사항에 따라 해설(개념 설명)만 노출
type ModalAnswerTexts = {
  explanation: string;
};

// =========================
// 부서 점수 더미
// =========================

const initialDepartments: DepartmentScore[] = [
  { id: "hr", name: "인사팀", avgScore: 85, progress: 50 },
  { id: "general", name: "총무팀", avgScore: 85, progress: 50 },
  { id: "plan", name: "기획팀", avgScore: 85, progress: 50 },
  { id: "marketing", name: "마케팅팀", avgScore: 85, progress: 50 },
  { id: "finance", name: "재무팀", avgScore: 85, progress: 50 },
  { id: "dev", name: "개발팀", avgScore: 85, progress: 50 },
  { id: "sales", name: "영업팀", avgScore: 85, progress: 50 },
  { id: "legal", name: "법무팀", avgScore: 85, progress: 50 },
];

// unlockedCourseIds 반영해서 기본 course 생성
const buildInitialCourses = (unlockedCourseIds?: string[]): QuizCourse[] => {
  if (!unlockedCourseIds || unlockedCourseIds.length === 0) {
    return initialCourses;
  }
  return initialCourses.map((course) =>
    unlockedCourseIds.includes(course.id)
      ? { ...course, unlocked: true }
      : course
  );
};

// localStorage 에서 기존 점수 복원 + 언락 반영
const loadCoursesFromStorage = (
  unlockedCourseIds?: string[]
): QuizCourse[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return buildInitialCourses(unlockedCourseIds);
    }
    const stored = JSON.parse(raw) as QuizCourse[];
    return stored.map((c) => ({
      ...c,
      unlocked:
        c.unlocked ||
        (unlockedCourseIds ? unlockedCourseIds.includes(c.id) : false),
    }));
  } catch {
    return buildInitialCourses(unlockedCourseIds);
  }
};

// 오답노트 복원
const loadWrongNotesFromStorage = (): WrongAnswerEntry[] => {
  try {
    const raw = window.localStorage.getItem(WRONG_NOTES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WrongAnswerEntry[];
  } catch {
    return [];
  }
};

// 카드 개수 계산
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

// eslint에서 any 경고 안 나게 하기 위한 range 유틸
const range = (count: number): number[] =>
  Array.from({ length: count }, (_, idx) => idx);

// 오답 해설 문장 생성 (정답 문장만, "내 답 / 정답"은 UI에서 직접 노출하지 않음)
const buildExplanation = (courseId: string, question: QuizQuestion): string => {
  const answer = question.options[question.correctIndex];

  switch (courseId) {
    case "harassment":
      return `이 문항의 핵심은 "${answer}"에 담긴 기준입니다. 직장 내 성희롱의 정의와 예방 원칙을 이해하고, 상대방이 성적 굴욕감이나 불쾌감을 느낄 수 있는 언행을 하지 않는 것이 중요합니다.`;
    case "privacy":
      return `이 문항은 개인정보를 어떻게 안전하게 다뤄야 하는지를 묻고 있습니다. "${answer}"처럼 최소 수집, 목적 외 사용 금지, 안전한 보관·파기 원칙을 지키는 것이 핵심입니다.`;
    case "bullying":
      return `이 문항의 핵심은 "${answer}"가 설명하는 직장 내 괴롭힘의 기준입니다. 업무상 적정 범위를 넘어 신체적·정신적 고통을 주는 행위를 피하고, 서로를 존중하는 조직 문화를 만드는 것이 중요합니다.`;
    case "disability":
      return `이 문항은 장애에 대한 올바른 인식과 태도를 묻고 있습니다. "${answer}"처럼 상대방을 동등한 동료로 존중하고, 편견이나 비하 표현을 피하는 것이 중요합니다.`;
    default:
      return `이 문항은 "${answer}"에 담긴 개념을 이해했는지를 확인하는 문제입니다. 보기들 중에서 문제의 취지와 기준에 가장 잘 맞는 선택지를 고르는 것이 핵심입니다.`;
  }
};

// (모달용) 현재 선택된 오답에 대한 해설만 계산
// 👉 선택한 보기/정답 텍스트는 UI에 노출하지 않음
const getModalAnswerTexts = (entry: WrongAnswerEntry | null): ModalAnswerTexts => {
  if (!entry) {
    return {
      explanation: "",
    };
  }

  const questions = quizQuestionBank[entry.courseId] ?? [];
  const q = questions[entry.questionIndex];

  if (!q) {
    return {
      explanation: entry.explanation ?? "",
    };
  }

  // 항상 최신 로직으로 해설을 다시 계산해서,
  // 예전에 저장된 이상한 문장도 자동으로 교체되도록 함
  const explanation = buildExplanation(entry.courseId, q);

  return { explanation };
};

const QuizPanel: React.FC<QuizPanelProps> = ({
  anchor,
  onClose,
  onOpenNote,
  unlockedCourseIds,
  onExamModeChange,
}) => {
  // === 패널 크기 + 위치 ===
  const [size, setSize] = useState<Size>(INITIAL_SIZE);
  const [panelPos, setPanelPos] = useState(() =>
    computePanelPosition(anchor ?? null, INITIAL_SIZE)
  );

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

  const [departments] = useState<DepartmentScore[]>(initialDepartments);

  // 점수를 localStorage 에 저장/복원
  const [courses, setCourses] = useState<QuizCourse[]>(() =>
    loadCoursesFromStorage(unlockedCourseIds)
  );

  // 오답노트 데이터 (과목/회차별 틀린 문제)
  const [wrongNotes, setWrongNotes] = useState<WrongAnswerEntry[]>(() =>
    loadWrongNotesFromStorage()
  );

  const [deptPage, setDeptPage] = useState(0);
  const [quizPage, setQuizPage] = useState(0);

  const [mode, setMode] = useState<PanelMode>("dashboard");
  const [solveCourse, setSolveCourse] = useState<QuizCourse | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);

  // 오답노트 전용 상태
  const [noteCourse, setNoteCourse] = useState<QuizCourse | null>(null);
  const [noteAttemptIndex, setNoteAttemptIndex] = useState<number>(0);
  const [noteModal, setNoteModal] = useState<WrongAnswerEntry | null>(null);

  // 알림 배너 상태
  const [resultMessage, setResultMessage] = useState<ResultMessage | null>(
    null
  );

  // 모드 변경될 때마다 상위에 "시험 모드 여부" 전달
  useEffect(() => {
    if (onExamModeChange) {
      onExamModeChange(mode === "solve");
    }
  }, [mode, onExamModeChange]);

  // 언마운트 시에는 항상 false 로 리셋
  useEffect(() => {
    return () => {
      if (onExamModeChange) {
        onExamModeChange(false);
      }
    };
  }, [onExamModeChange]);

  const showResultMessage = (
    type: ResultType,
    title: string,
    description?: string
  ) => {
    setResultMessage({ type, title, description });
  };

  // 알림 자동 닫기
  useEffect(() => {
    if (!resultMessage) return;
    const timer = window.setTimeout(() => setResultMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [resultMessage]);

  // courses 변경 시 localStorage 저장
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
    } catch {
      // ignore
    }
  }, [courses]);

  // wrongNotes 변경 시 localStorage 저장
  useEffect(() => {
    try {
      window.localStorage.setItem(WRONG_NOTES_KEY, JSON.stringify(wrongNotes));
    } catch {
      // ignore
    }
  }, [wrongNotes]);

  // unlockedCourseIds 가 변경되면 언락 반영
  useEffect(() => {
    if (!unlockedCourseIds || unlockedCourseIds.length === 0) return;
    setCourses((prev) =>
      prev.map((c) =>
        unlockedCourseIds.includes(c.id) ? { ...c, unlocked: true } : c
      )
    );
  }, [unlockedCourseIds]);

  // ===== 페이지 계산 =====
  const deptPageSize = getDeptPageSize(size.width);
  const totalDeptPages =
    Math.max(1, Math.ceil(departments.length / deptPageSize)) || 1;
  const safeDeptPage = Math.min(deptPage, totalDeptPages - 1);
  const deptStart = safeDeptPage * deptPageSize;
  const visibleDepartments = departments.slice(
    deptStart,
    deptStart + deptPageSize
  );

  const quizPageSize = getQuizPageSize(size.width);
  const totalQuizPages =
    Math.max(1, Math.ceil(courses.length / quizPageSize)) || 1;
  const safeQuizPage = Math.min(quizPage, totalQuizPages - 1);
  const quizStart = safeQuizPage * quizPageSize;
  const visibleCourses = courses.slice(quizStart, quizStart + quizPageSize);

  const extraWidth = Math.max(0, size.width - INITIAL_SIZE.width);
  const baseCardHeight = 150;
  const maxCardHeight = 210;

  const responsiveCardHeight = Math.min(
    maxCardHeight,
    baseCardHeight + extraWidth / 8
  );

  // 패널 높이 자동 조정
  useEffect(() => {
    if (!contentRef.current) return;

    const contentHeight = contentRef.current.offsetHeight;
    const desiredHeight = Math.min(
      Math.max(contentHeight + 40, MIN_HEIGHT),
      window.innerHeight - 80
    );

    setSize((prev) => {
      if (Math.abs(prev.height - desiredHeight) < 2) return prev;
      return { ...prev, height: desiredHeight };
    });

    setPanelPos((prev) => {
      const margin = 16;
      const maxTop = window.innerHeight - margin - desiredHeight;
      const top = Math.max(margin, Math.min(prev.top, maxTop));
      return { ...prev, top };
    });
  }, [size.width, mode]);

  // ===== 드래그 / 리사이즈 =====
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      const margin = 16;
      const padding = 32;

      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - padding * 2);
        const maxHeight = Math.max(
          MIN_HEIGHT,
          window.innerHeight - padding * 2
        );

        if (resizeState.dir.includes("e")) {
          newWidth = resizeState.startWidth + dx;
        }
        if (resizeState.dir.includes("s")) {
          newHeight = resizeState.startHeight + dy;
        }
        if (resizeState.dir.includes("w")) {
          newWidth = resizeState.startWidth - dx;
          newLeft = resizeState.startLeft + dx;
        }
        if (resizeState.dir.includes("n")) {
          newHeight = resizeState.startHeight - dy;
          newTop = resizeState.startTop + dy;
        }

        newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, newHeight));

        const maxLeft = window.innerWidth - margin - newWidth;
        const maxTop = window.innerHeight - margin - newHeight;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        setSize({ width: newWidth, height: newHeight });
        setPanelPos({ top: newTop, left: newLeft });
        return;
      }

      if (dragState.dragging) {
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        let newTop = dragState.startTop + dy;
        let newLeft = dragState.startLeft + dx;

        const maxLeft = window.innerWidth - margin - size.width;
        const maxTop = window.innerHeight - margin - size.height;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        setPanelPos({ top: newTop, left: newLeft });
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
  }, [size.width, size.height]);

  const handleResizeMouseDown =
    (dir: ResizeDirection) =>
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      resizeRef.current = {
        resizing: true,
        dir,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: size.width,
        startHeight: size.height,
        startTop: panelPos.top,
        startLeft: panelPos.left,
      };
      dragRef.current.dragging = false;
    };

  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: panelPos.top,
      startLeft: panelPos.left,
    };
    resizeRef.current.resizing = false;
    resizeRef.current.dir = null;
  };

  // ===== 페이지 전환 =====
  const handlePrevDept = () => {
    setDeptPage((prev) => Math.max(prev - 1, 0));
  };

  const handleNextDept = () => {
    const pageSize = getDeptPageSize(size.width);
    const maxPage = Math.max(0, Math.ceil(departments.length / pageSize) - 1);
    setDeptPage((prev) => Math.min(prev + 1, maxPage));
  };

  const handlePrevQuiz = () => {
    setQuizPage((prev) => Math.max(prev - 1, 0));
  };

  const handleNextQuiz = () => {
    const pageSize = getQuizPageSize(size.width);
    const maxPage = Math.max(0, Math.ceil(courses.length / pageSize) - 1);
    setQuizPage((prev) => Math.min(prev + 1, maxPage));
  };

  // 회차 토글
  const handleToggleAttempt = (courseId: string, index: number) => {
    setCourses((prev) =>
      prev.map((course) =>
        course.id === courseId ? { ...course, activeIndex: index } : course
      )
    );

    setSolveCourse((prev) =>
      prev && prev.id === courseId ? { ...prev, activeIndex: index } : prev
    );

    // 오답노트에서 회차 바꾸고 있는 중이라면 같이 동기화
    setNoteCourse((prev) =>
      prev && prev.id === courseId ? { ...prev, activeIndex: index } : prev
    );
    setNoteAttemptIndex(index);
  };

  const handleOpenNoteClick = (course: QuizCourse) => {
    if (!course.unlocked) return;

    setNoteCourse(course);
    setNoteAttemptIndex(course.activeIndex ?? 0);
    setMode("note");

    if (onOpenNote) {
      onOpenNote(course.id);
    }
  };

  // 퀴즈 시작 (다음 응시 가능한 회차 계산)
  const handleStartQuiz = (course: QuizCourse) => {
    if (!course.unlocked) return;

    const firstScore = course.scores[0];
    const secondScore = course.scores[1];

    let attemptIndex: number | null = null;

    if (firstScore == null) {
      attemptIndex = 0;
    } else if (firstScore < PASSING_SCORE && secondScore == null) {
      attemptIndex = 1;
    }

    if (attemptIndex === null) {
      showResultMessage(
        "info",
        "퀴즈 응시 안내",
        "이미 2회까지 응시를 완료했거나 기준 점수를 넘어 재응시가 제한됩니다."
      );
      return;
    }

    const questions = quizQuestionBank[course.id] ?? [];
    setSelectedAnswers(questions.map(() => -1));

    setCourses((prev) =>
      prev.map((c) =>
        c.id === course.id ? { ...c, activeIndex: attemptIndex! } : c
      )
    );

    setSolveCourse({ ...course, activeIndex: attemptIndex });
    setMode("solve");
  };

  const handleBackFromSolve = () => {
    setMode("dashboard");
    setSolveCourse(null);
    setSelectedAnswers([]);
  };

  const handleBackFromNote = () => {
    setMode("dashboard");
    setNoteCourse(null);
    setNoteModal(null);
  };

  const currentQuestions: QuizQuestion[] = solveCourse
    ? quizQuestionBank[solveCourse.id] ?? []
    : [];

  const handleSelectOption = (qIndex: number, optionIndex: number) => {
    setSelectedAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = optionIndex;
      return next;
    });
  };

  const handleSubmitAnswers = () => {
    if (!solveCourse) return;

    const questions = currentQuestions;
    if (questions.length === 0) return;

    const allAnswered =
      selectedAnswers.length === questions.length &&
      selectedAnswers.every((idx) => idx >= 0);

    if (!allAnswered) {
      showResultMessage(
        "warning",
        "답변이 완료되지 않았습니다",
        "모든 문항에 대해 보기 하나를 선택해 주세요."
      );
      return;
    }

    let correctCount = 0;
    questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correctIndex) correctCount++;
    });

    const score = Math.round(
      (correctCount / questions.length) * solveCourse.maxScore
    );

    const attemptIndex = solveCourse.activeIndex ?? 0;

    // 오답노트 데이터 구성 (틀린 문제만)
    const wrongEntries: WrongAnswerEntry[] = questions
      .map((q, idx) => {
        const selected = selectedAnswers[idx];
        if (selected === q.correctIndex) return null;

        return {
          courseId: solveCourse.id,
          attemptIndex,
          questionIndex: idx,
          questionNumber: idx + 1,
          questionText: q.text,
          selectedIndex: selected,
          correctIndex: q.correctIndex,
          // 저장할 때도 최신 해설 문자열을 넣어 두긴 하지만,
          // 화면에서는 항상 buildExplanation으로 다시 계산해서 사용함
          explanation: buildExplanation(solveCourse.id, q),
        };
      })
      .filter((v): v is WrongAnswerEntry => v !== null);

    // 기존 해당 과목/회차 오답 제거 후 새로 저장
    setWrongNotes((prev) => {
      const filtered = prev.filter(
        (item) =>
          !(
            item.courseId === solveCourse.id &&
            item.attemptIndex === attemptIndex
          )
      );
      return [...filtered, ...wrongEntries];
    });

    // courses 업데이트 (점수/activeIndex)
    setCourses((prev) =>
      prev.map((course) => {
        if (course.id !== solveCourse.id) return course;

        const newScores = [...course.scores];
        newScores[attemptIndex] = score;

        let newActiveIndex = course.activeIndex;
        if (
          attemptIndex === 0 &&
          score < PASSING_SCORE &&
          course.scores.length > 1 &&
          course.scores[1] === null
        ) {
          newActiveIndex = 1;
        }

        return {
          ...course,
          scores: newScores,
          activeIndex: newActiveIndex,
        };
      })
    );

    // solveCourse 동기화
    setSolveCourse((prev) => {
      if (!prev) return prev;
      const newScores = [...prev.scores];
      newScores[attemptIndex] = score;

      let newActiveIndex = prev.activeIndex;
      if (
        attemptIndex === 0 &&
        score < PASSING_SCORE &&
        prev.scores.length > 1 &&
        prev.scores[1] === null
      ) {
        newActiveIndex = 1;
      }

      return {
        ...prev,
        scores: newScores,
        activeIndex: newActiveIndex,
      };
    });

    const passed = score >= PASSING_SCORE;

    if (passed) {
      showResultMessage(
        "success",
        "합격입니다 🎉",
        `점수는 ${score}점입니다. 기준 점수(${PASSING_SCORE}점)를 넘어 합격했습니다.`
      );
    } else if (attemptIndex === 0) {
      showResultMessage(
        "warning",
        "2회차 응시가 가능합니다",
        `점수는 ${score}점입니다. 기준 점수(${PASSING_SCORE}점) 미만으로 한 번 더 응시할 수 있습니다.`
      );
    } else {
      showResultMessage(
        "info",
        "응시가 종료되었습니다",
        `점수는 ${score}점입니다. 최대 2회까지 응시할 수 있으며, 이번 시험으로 해당 회차 응시가 종료되었습니다.`
      );
    }

    // 제출 후 대시보드로 이동
    handleBackFromSolve();
  };

  const canSubmit =
    mode === "solve" &&
    currentQuestions.length > 0 &&
    selectedAnswers.length === currentQuestions.length &&
    selectedAnswers.every((idx) => idx >= 0);

  // 현재 선택된 과목/회차의 오답 리스트
  const currentWrongNotes: WrongAnswerEntry[] =
    noteCourse != null
      ? wrongNotes.filter(
          (w) =>
            w.courseId === noteCourse.id &&
            w.attemptIndex === noteAttemptIndex
        )
      : [];

  const modalAnswerTexts = getModalAnswerTexts(noteModal);

  return (
    <div className="cb-edu-wrapper">
      <div
        className="cb-edu-panel-container"
        style={{ top: panelPos.top, left: panelPos.left }}
      >
        <div
          className="cb-edu-panel cb-chatbot-panel"
          style={{ width: size.width, height: size.height }}
        >
          {/* 드래그 바 + 리사이즈 핸들 */}
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

          {/* 닫기 버튼 */}
          <button
            type="button"
            className="cb-panel-close-btn"
            onClick={onClose}
            aria-label="퀴즈 패널 닫기"
          >
            ✕
          </button>

          <div
            className="cb-edu-panel-inner"
            ref={contentRef}
            style={{ position: "relative" }}
          >
            {/* 하단 알림 배너 */}
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
                    maxWidth: 420,
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
                    {resultMessage.type === "success"
                      ? "✅"
                      : resultMessage.type === "warning"
                      ? "⚠️"
                      : "ℹ️"}
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

            {/* 대시보드 */}
            {mode === "dashboard" && (
              <div className="cb-quiz-panel" aria-label="교육 퀴즈 대시보드">
                {/* 부서별 점수판 */}
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
                        <div
                          key={dept.id}
                          className="cb-quiz-dept-card"
                          style={{ minHeight: responsiveCardHeight }}
                        >
                          <div className="cb-quiz-dept-name">{dept.name}</div>
                          <div className="cb-quiz-dept-score">
                            {dept.avgScore}점
                          </div>
                          <div className="cb-quiz-dept-progress-label">
                            전체 진행률&nbsp;
                            <span className="cb-quiz-dept-progress-value">
                              {dept.progress}%
                            </span>
                          </div>
                          <div className="cb-quiz-progress-bar">
                            <div
                              className="cb-quiz-progress-bar-fill"
                              style={{ width: `${dept.progress}%` }}
                            />
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

                {/* Quiz 섹션 */}
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

                        const totalAttempts = course.scores.length;
                        const activeIndex = course.activeIndex ?? 0;
                        const activeScore = course.scores[activeIndex];
                        const hasActiveScore =
                          activeScore !== null &&
                          activeScore !== undefined;

                        const displayScore = hasActiveScore
                          ? `${activeScore}점`
                          : "-";

                        const progressPercent = hasActiveScore
                          ? (activeScore / course.maxScore) * 100
                          : 0;

                        const firstScore = course.scores[0];
                        const secondScore = course.scores[1];

                        const canStartFirst = firstScore == null;
                        const canStartSecond =
                          firstScore !== null &&
                          firstScore < PASSING_SCORE &&
                          secondScore == null;

                        const canStartQuiz =
                          !isLocked && (canStartFirst || canStartSecond);

                        // 단일 버튼 클릭 핸들러
                        const handlePrimaryClick = () => {
                          if (isLocked) return;
                          if (!hasActiveScore && canStartQuiz) {
                            // 아직 시험 안 봤고 응시 가능 → 퀴즈 풀기
                            handleStartQuiz(course);
                          } else if (hasActiveScore) {
                            // 점수 있음 → 오답노트
                            handleOpenNoteClick(course);
                          }
                        };

                        const primaryLabel = hasActiveScore
                          ? "오답노트"
                          : "퀴즈 풀기";

                        const primaryDisabled =
                          isLocked || (!hasActiveScore && !canStartQuiz);

                        const attemptIndexes = range(totalAttempts);

                        return (
                          <article
                            key={course.id}
                            className={
                              "cb-quiz-course-card" +
                              (isLocked ? " is-locked" : "")
                            }
                            style={{ minHeight: responsiveCardHeight }}
                          >
                            <header className="cb-quiz-course-header">
                              <h3 className="cb-quiz-course-title">
                                {course.title}
                              </h3>

                              <div className="cb-quiz-course-attempt-toggle">
                                {attemptIndexes.map((idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    className={
                                      "cb-quiz-attempt-dot" +
                                      (activeIndex === idx ? " is-active" : "")
                                    }
                                    onClick={() =>
                                      handleToggleAttempt(course.id, idx)
                                    }
                                    aria-label={`${idx + 1}회차 점수 보기`}
                                  >
                                    {idx + 1}
                                  </button>
                                ))}
                              </div>
                            </header>

                            <div className="cb-quiz-course-body">
                              <div className="cb-quiz-course-score-row">
                                <span className="cb-quiz-course-score-label">
                                  개인 점수
                                </span>
                                <span className="cb-quiz-course-score-value">
                                  {displayScore}
                                </span>
                              </div>

                              <div className="cb-quiz-progress-bar cb-quiz-course-progress">
                                <div
                                  className="cb-quiz-progress-bar-fill"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>

                              {isLocked && (
                                <p className="cb-quiz-locked-text">
                                  교육 영상 시청 완료 후 퀴즈를 풀 수 있어요.
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

            {/* 문제 풀기 화면 */}
            {mode === "solve" && solveCourse && (
              <div className="cb-quiz-solve-layout">
                <header className="cb-quiz-solve-header">
                  <div className="cb-quiz-solve-header-left">
                    <button
                      type="button"
                      className="cb-quiz-solve-back-btn"
                      onClick={handleBackFromSolve}
                      aria-label="퀴즈 목록으로 돌아가기"
                    >
                      ◀
                    </button>
                    <h2 className="cb-quiz-solve-title">퀴즈풀기</h2>
                    <div className="cb-quiz-solve-tabs">
                      {range(solveCourse.scores.length).map((idx) => (
                        <div
                          key={idx}
                          className={
                            "cb-quiz-solve-tab" +
                            (solveCourse.activeIndex === idx
                              ? " is-active"
                              : "")
                          }
                        >
                          {idx + 1}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="cb-quiz-solve-meta">
                    {solveCourse.title}
                  </div>
                </header>

                <div className="cb-quiz-solve-body">
                  <div className="cb-quiz-solve-card">
                    <div className="cb-quiz-solve-scroll">
                      {currentQuestions.map((q, idx) => (
                        <div className="cb-quiz-solve-question" key={q.id}>
                          <div className="cb-quiz-solve-question-title">
                            {idx + 1}. {q.text}
                          </div>
                          <ul className="cb-quiz-solve-options">
                            {q.options.map((opt, optIdx) => (
                              <li
                                key={optIdx}
                                className={
                                  "cb-quiz-solve-option" +
                                  (selectedAnswers[idx] === optIdx
                                    ? " is-selected"
                                    : "")
                                }
                                onClick={() =>
                                  handleSelectOption(idx, optIdx)
                                }
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
                        onClick={handleSubmitAnswers}
                        disabled={!canSubmit}
                      >
                        제출하기
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 오답노트 화면 */}
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
                      {noteCourse.scores.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={
                            "cb-quiz-note-tab" +
                            (noteAttemptIndex === idx ? " is-active" : "")
                          }
                          onClick={() => setNoteAttemptIndex(idx)}
                          aria-label={`${idx + 1}회차 오답 보기`}
                        >
                          {idx + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cb-quiz-note-meta">{noteCourse.title}</div>
                </header>

                <div className="cb-quiz-note-body">
                  <div className="cb-quiz-note-card">
                    <div className="cb-quiz-note-table-header-row">
                      <div className="cb-quiz-note-header-cell">문제번호</div>
                      <div className="cb-quiz-note-header-cell">문제</div>
                      <div className="cb-quiz-note-header-cell">해설</div>
                    </div>

                    <div className="cb-quiz-note-table-scroll">
                      {currentWrongNotes.length === 0 ? (
                        <div className="cb-quiz-note-empty">
                          해당 회차에서 틀린 문제가 없습니다.
                        </div>
                      ) : (
                        currentWrongNotes.map((item) => (
                          <div
                            key={`${item.courseId}-${item.attemptIndex}-${item.questionIndex}`}
                            className="cb-quiz-note-row"
                          >
                            <div className="cb-quiz-note-question-no">
                              {item.questionNumber}
                            </div>
                            <div className="cb-quiz-note-question-text">
                              {item.questionText}
                            </div>
                            <div className="cb-quiz-note-explain-cell">
                              <button
                                type="button"
                                className="cb-quiz-note-explain-btn"
                                onClick={() => setNoteModal(item)}
                              >
                                해설보기
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* 해설 모달 */}
                {noteModal && (
                  <div className="cb-quiz-note-modal-backdrop">
                    <div className="cb-quiz-note-modal">
                      <div className="cb-quiz-note-modal-header">
                        <div className="cb-quiz-note-modal-title">
                          {noteModal.questionText}
                        </div>
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
                        {/* 정답 해설: 개념 설명만 제공 (정답/선택 보기 텍스트는 별도 노출 X) */}
                        <div className="cb-quiz-note-modal-explanation">
                          <div className="cb-quiz-note-modal-explanation-title">
                            📌 정답 해설
                          </div>
                          <div className="cb-quiz-note-modal-explanation-text">
                            {modalAnswerTexts.explanation}
                          </div>
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
    </div>
  );
};

export default QuizPanel;
