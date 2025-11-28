// src/types/chat.ts

// 공통 역할 타입
export type ChatRole = "user" | "assistant";

// 세션 도메인 타입
export type ChatDomain =
  | "general"
  | "policy"
  | "faq"
  | "quiz"
  | "edu"
  | "security";

// 피드백 값 타입 (좋아요 / 별로예요 / 없음)
export type FeedbackValue = "up" | "down" | null;

// 개별 메시지 엔티티
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /**
   * 사용자가 남긴 피드백
   * - "up"  : 좋은 응답
   * - "down": 별로인 응답
   * - null / undefined: 피드백 없음
   */
  feedback?: FeedbackValue;
}

// 세션 엔티티
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  domain: ChatDomain;
  messages: ChatMessage[];
}

// 사이드바에서 사용하는 요약용 세션 타입
export interface SidebarSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  domain: ChatDomain;
  lastMessage: string;
}

// 백엔드로 보내는 메시지 페이로드
export interface ChatMessagePayload {
  role: ChatRole;
  content: string;
}

// 백엔드로 보내는 채팅 요청 포맷
export interface ChatRequest {
  sessionId: string;
  domain: ChatDomain;
  messages: ChatMessagePayload[];
}

// 도메인 메타 정보 (라벨/설명 등)
// 현재는 바로 사용하지 않지만, 앞으로 도메인별 화면/태그/색상 등에 공통으로 쓸 수 있음.
export interface DomainMeta {
  label: string;
  description: string;
}

export const DOMAIN_META: Record<ChatDomain, DomainMeta> = {
  general: {
    label: "일반",
    description: "일반 상담 및 간단한 문의를 처리하는 기본 도메인입니다.",
  },
  policy: {
    label: "규정 안내",
    description: "사내 인사/복지/보안 등 각종 규정과 관련된 질문을 처리합니다.",
  },
  faq: {
    label: "FAQ",
    description: "자주 묻는 질문과 반복되는 문의를 빠르게 안내하는 영역입니다.",
  },
  quiz: {
    label: "퀴즈",
    description: "교육 관련 퀴즈를 풀면서 이해도를 점검하는 도메인입니다.",
  },
  edu: {
    label: "교육",
    description: "필수/선택 교육, 영상/자료 등 교육 관련 컨텐츠를 다룹니다.",
  },
  security: {
    label: "보안",
    description: "정보보안, 계정/접근 권한, 보안 사고 대응과 관련된 질문입니다.",
  },
};
