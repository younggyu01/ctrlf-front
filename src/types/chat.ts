// src/types/chat.ts

// 공통 역할 타입
export type ChatRole = "user" | "assistant";

/**
 * 프론트(UI) 세션 도메인 타입
 *
 * - Chat Service의 실제 domain(SECURITY/POLICY/EDUCATION/HR...)과는 별개로,
 *   UI에서는 "칩/카드/탭" 관점의 도메인을 유지합니다.
 *
 * - 기존 코드 호환을 위해 "faq", "quiz"는 유지하되,
 *   실제 Chat Service 요청 domain은 매핑(toChatServiceDomain)으로 정규화됩니다.
 */
export type ChatDomain =
  | "general"
  | "faq"
  | "quiz"
  | "edu"
  | "security"
  | "policy";

/**
 * Chat Service(9005)에서 사용하는 domain (대문자)
 * - 스펙 문서 기준 예: SECURITY, POLICY, EDUCATION, HR
 * - 배포/조직별로 추가될 수 있어 string 확장 허용
 */
export type ChatServiceDomain =
  | "SECURITY"
  | "POLICY"
  | "EDUCATION"
  | "HR"
  | (string & {});

// 피드백 값 타입 (좋아요 / 별로예요 / 없음)
export type FeedbackValue = "up" | "down" | null;

/**
 * 메시지 용도 구분
 * - normal           : 일반 Q/A
 * - system           : 시스템 안내(필요하면 확장용)
 * - reportSuggestion : 신고 유도 말풍선
 * - reportReceipt    : 신고 접수 안내 말풍선
 */
export type ChatMessageKind =
  | "normal"
  | "system"
  | "reportSuggestion"
  | "reportReceipt";

/** 개별 메시지 엔티티 */
export interface ChatMessage {
  /** 프론트 로컬 메시지 id */
  id: string;

  role: ChatRole;
  content: string;
  createdAt: number;

  /** 메시지 용도 (없으면 normal 취급) */
  kind?: ChatMessageKind;

  /** 사용자가 남긴 피드백 */
  feedback?: FeedbackValue;

  /**
   * 서버 메시지 UUID
   * - 피드백/재시도 등 서버 API 호출에 사용
   * - user 메시지는 서버에 저장/리턴되지 않을 수 있어 undefined일 수 있음
   */
  serverId?: string;

  /** RAG 참조 문서 목록 (출처 정보) - assistant 메시지에만 존재 */
  sources?: ChatSource[];
}

/** 세션 엔티티 */
export interface ChatSession {
  /** 프론트 로컬 세션 키 */
  id: string;

  title: string;
  createdAt: number;
  updatedAt: number;

  /**
   * UI 관점 도메인
   * - 서버 요청 도메인은 chatApi에서 toChatServiceDomain으로 변환하여 사용
   */
  domain: ChatDomain;

  messages: ChatMessage[];

  /**
   * 서버 세션 UUID
   * - 첫 메시지 전송 후 sendChatToAI 응답을 통해 채워짐
   * - 이후 피드백/재시도 등에서 사용
   */
  serverId?: string;
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

// 백엔드로 보내는 메시지 페이로드(프론트에서 유지)
export interface ChatMessagePayload {
  role: ChatRole;
  content: string;
}

// 백엔드로 보내는 채팅 요청 포맷(프론트 내부 포맷)
// - sessionId는 "클라이언트 로컬 세션 키"로 사용 가능
// - serverSessionId는 이미 서버 UUID를 알고 있는 경우 함께 전달
export interface ChatRequest {
  sessionId: string;
  domain: ChatDomain;
  messages: ChatMessagePayload[];

  /** 서버 세션 UUID(알고 있으면 전달) */
  serverSessionId?: string;

  /**
   * A/B 테스트 임베딩 모델 선택 (선택)
   * - "openai": text-embedding-3-large (기본값)
   * - "sroberta": ko-sroberta-multitask
   * - null/undefined: 기본값(openai) 사용
   */
  model?: "openai" | "sroberta" | null;
}

// =============================================================================
// ChatAction: AI 응답에 포함된 프론트엔드 액션 지시
// =============================================================================

/** 프론트엔드에서 실행할 액션 타입 */
export type ChatActionType = "PLAY_VIDEO" | "OPEN_EDU_PANEL" | "OPEN_QUIZ";

// =============================================================================
// ChatSource: AI 응답에 포함된 RAG 참조 문서 (출처) 정보
// =============================================================================

/** RAG 참조 문서 소스 유형 */
export type ChatSourceType = "POLICY" | "TRAINING_SCRIPT" | (string & {});

/** AI 응답에 포함된 RAG 참조 문서 정보 */
export interface ChatSource {
  /** 문서 ID */
  docId: string;
  /** 문서 제목 */
  title?: string;
  /** 페이지 번호 */
  page?: number;
  /** 검색 관련도 점수 (0.0 ~ 1.0) */
  score?: number;
  /** 문서 발췌 내용 */
  snippet?: string;
  /** 조항 라벨 (예: "제10조 (연차휴가) 제1항") */
  articleLabel?: string;
  /** 조항 경로 (예: "제3장 휴가 > 제10조 > 제1항") */
  articlePath?: string;
  /** 소스 유형: POLICY(정책문서), TRAINING_SCRIPT(교육스크립트) */
  sourceType?: ChatSourceType;
}

/** AI 응답에 포함된 프론트엔드 액션 정보 */
export interface ChatAction {
  type: ChatActionType;
  /** 교육 ID (영상 재생, 퀴즈 시작 시 사용) */
  educationId?: string;
  /** 영상 ID (영상 재생 시 필수) */
  videoId?: string;
  /** 이어보기 시작 위치(초) */
  resumePositionSeconds?: number;
  /** 교육 제목 (UI 표시용) */
  educationTitle?: string;
  /** 영상 제목 (UI 표시용) */
  videoTitle?: string;
  /** 현재 진도율(%) */
  progressPercent?: number;
  /** 퀴즈 ID (퀴즈 시작 시 선택) */
  quizId?: string;
}

/**
 * 교육 영상 재생 요청 파라미터
 * - AI 응답의 PLAY_VIDEO 액션에서 추출
 * - ChatbotApp → FloatingChatbotRoot → EduPanel 순으로 전달
 */
export interface PlayEducationVideoParams {
  educationId: string;
  videoId: string;
  resumePositionSeconds?: number;
}

/** sendChatToAI 결과(서버 UUID 포함) */
export interface ChatSendResult {
  sessionId: string; // server session uuid
  messageId: string; // server message uuid
  role: ChatRole;
  content: string;
  createdAt?: string;
  /** 프론트엔드에서 실행할 액션 정보 (영상 재생 등) */
  action?: ChatAction;
  /** RAG 참조 문서 목록 (출처 정보) */
  sources?: ChatSource[];
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
  faq: {
    label: "FAQ",
    description: "자주 묻는 질문을 빠르게 확인하는 영역입니다.",
  },
  quiz: {
    label: "퀴즈",
    description: "교육 관련 퀴즈를 통해 이해도를 점검하는 도메인입니다.",
  },
  edu: {
    label: "교육",
    description: "필수/선택 교육, 영상/자료 등 교육 관련 컨텐츠를 다룹니다.",
  },
  security: {
    label: "보안",
    description: "정보보안, 계정/접근 권한, 보안 사고 대응 관련 질문입니다.",
  },
  policy: {
    label: "정책",
    description: "사규/정책/규정/준법 등 정책 관련 질문입니다.",
  },
};

/** UI 도메인 → Chat Service 도메인 매핑 */
const UI_TO_SERVICE_DOMAIN: Record<ChatDomain, ChatServiceDomain> = {
  security: "SECURITY",
  policy: "POLICY",
  edu: "EDUCATION",

  // legacy/UX 도메인: 서버 도메인은 교육/정책으로 수렴
  quiz: "EDUCATION",
  faq: "POLICY",
  general: "POLICY",
};

/** Chat Service 도메인 → UI 도메인 매핑(알 수 없는 값은 fallback) */
const SERVICE_TO_UI_DOMAIN: Record<string, ChatDomain> = {
  SECURITY: "security",
  POLICY: "policy",
  EDUCATION: "edu",
  HR: "general",
};

export function normalizeServiceDomain(raw: unknown): ChatServiceDomain | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  return t.toUpperCase() as ChatServiceDomain;
}

export function normalizeChatDomain(raw: unknown): ChatDomain | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;

  const allowed: ChatDomain[] = [
    "general",
    "faq",
    "quiz",
    "edu",
    "security",
    "policy",
  ];
  return (allowed as string[]).includes(t) ? (t as ChatDomain) : null;
}

/**
 * UI 도메인을 Chat Service 도메인으로 변환
 * - tokenParsed.domain 같은 “조직 고정 도메인”이 있으면 fallback으로 넣는 것을 권장
 */
export function toChatServiceDomain(
  ui: ChatDomain,
  fallback?: ChatServiceDomain
): ChatServiceDomain {
  if (fallback && typeof fallback === "string" && fallback.trim()) {
    // UI가 general/faq 같이 애매한 경우 fallback(조직 도메인) 우선
    if (ui === "general" || ui === "faq") return fallback;
  }
  return UI_TO_SERVICE_DOMAIN[ui] ?? (fallback ?? "POLICY");
}

/** Chat Service 도메인을 UI 도메인으로 변환 */
export function fromChatServiceDomain(
  service: unknown,
  fallback: ChatDomain = "general"
): ChatDomain {
  const s = normalizeServiceDomain(service);
  if (!s) return fallback;
  return SERVICE_TO_UI_DOMAIN[String(s)] ?? fallback;
}

/** UI 도메인 라벨 */
export function chatDomainLabel(domain: ChatDomain): string {
  return DOMAIN_META[domain]?.label ?? domain;
}

/** Chat Service 도메인 라벨(표시용; 미지 값은 그대로) */
export function chatServiceDomainLabel(domain: ChatServiceDomain): string {
  const d = String(domain).toUpperCase();
  if (d === "SECURITY") return "보안";
  if (d === "POLICY") return "정책";
  if (d === "EDUCATION") return "교육";
  if (d === "HR") return "인사";
  return d;
}

/** FAQ(Home) 응답 모델 */
export interface FaqHomeItem {
  domain: ChatServiceDomain;
  title: string;
  faqId: string; // uuid
}

/** FAQ 리스트(Top 10) 응답 모델 */
export interface FaqItem {
  id: string; // uuid
  domain: ChatServiceDomain;
  question: string;
  answer: string;
  createdAt?: string;
  updatedAt?: string;
}
