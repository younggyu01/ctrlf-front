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

/**
 * 메시지 용도 구분
 * - normal           : 일반 Q/A
 * - system           : 시스템 안내(필요하면 확장용)
 * - reportSuggestion : "신고 절차를 알려드릴게요!" 같이 신고 유도 말풍선
 * - reportReceipt    : "신고가 접수되었습니다" 같은 접수 안내 말풍선
 */
export type ChatMessageKind =
  | "normal"
  | "system"
  | "reportSuggestion"
  | "reportReceipt";

// 개별 메시지 엔티티
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;

  /**
   * 메시지 용도 (없으면 normal 취급)
   */
  kind?: ChatMessageKind;

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

// 신고 모달에서 넘어가는 신고 데이터
export interface ReportPayload {
  /** 어떤 세션에서 신고했는지 (없으면 프론트에서 activeSession 사용) */
  sessionId?: string;
  /** 신고 상세 내용 */
  content: string;
  /** 신고 생성 시각 (epoch ms) */
  createdAt: number;
}

// 도메인 메타 정보 (라벨/설명 등)
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
