// src/components/chatbot/quizData.ts

// 퀴즈 코스 타입
export type QuizCourse = {
  id: string;
  title: string;
  scores: (number | null)[]; // 각 회차 점수 (null = 아직 안 본 회차)
  maxScore: number;
  unlocked: boolean;         // 교육 영상 시청 완료 여부
  activeIndex: number | null; // 현재 선택된 회차 index (0 = 1회차, 1 = 2회차, null = 아직 선택 안 됨)
};

// 🔹 퀴즈 기본 데이터
//   - 처음에는 모든 코스가 잠겨 있고(unlocked: false)
//   - 점수도 전부 null (아직 시험 안 본 상태)
//   - EduPanel에서 영상 100% 시청 시 FloatingChatbotRoot가
//     unlockedCourseIds 에 id를 넣어주면 언락됨
export const initialCourses: QuizCourse[] = [
  {
    id: "harassment",
    title: "직장 내 성희롱 예방",
    scores: [null, null], // 1회차, 2회차
    maxScore: 100,
    unlocked: false,
    activeIndex: 0,
  },
  {
    id: "privacy",
    title: "개인정보 보호",
    scores: [null, null],
    maxScore: 100,
    unlocked: false,
    activeIndex: 0,
  },
  {
    id: "bullying",
    title: "직장 내 괴롭힘",
    scores: [null, null],
    maxScore: 100,
    unlocked: false,
    activeIndex: 0,
  },
  {
    id: "disability",
    title: "장애인 인식 개선",
    scores: [null, null],
    maxScore: 100,
    unlocked: false,
    activeIndex: 0,
  },
];
