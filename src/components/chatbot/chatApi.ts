// src/components/chatbot/chatApi.ts
import type {
  ChatDomain,
  ChatRequest,
  FeedbackValue,
} from "../../types/chat";

/**
 * 실제로는 여기에서:
 *   - fetch("/api/chat", { method: "POST", body: JSON.stringify(req) })
 *   - 또는 SSE / WebSocket 등으로 AI 서버와 통신하게 될 예정.
 *
 * 지금은 데모용 Mock 함수로, 마지막 user 메시지를 기반으로
 * 간단한 예시 답변만 반환한다.
 */
export async function sendChatToAI(req: ChatRequest): Promise<string> {
  console.log("[Mock] sendChatToAI 요청:", req);

  // 로딩 느낌만 내기 위한 지연
  await new Promise((resolve) => setTimeout(resolve, 700));

  // 대화 중 마지막 user 메시지 찾기
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");

  if (!lastUser) {
    return "무슨 말씀인지 잘 못 알아들었어요. 한 번만 더 질문해 주실 수 있을까요?";
  }

  // 너무 과하지 않게, 도메인 정보만 살짝 표시
  const domainLabelMap: Record<ChatDomain, string> = {
    general: "일반",
    policy: "규정 안내",
    faq: "FAQ",
    quiz: "퀴즈",
    edu: "교육",
    security: "보안",
  };
  const domainLabel = domainLabelMap[req.domain] ?? "일반";

  return (
    `지금은 데모 모드라서 실제 AI 응답은 아니고요,\n\n` +
    `현재 도메인: [${domainLabel}]\n\n` +
    `방금 하신 질문은\n“${lastUser.content}”\n이었어요.\n\n` +
    `나중에 백엔드/AI가 붙으면 이 부분에서 진짜 답변이 돌아오게 됩니다. 🙂`
  );
}

/**
 * 피드백 저장용 요청 타입
 * - 아직은 Mock 이고, 나중에 실제 API 붙일 때 이 포맷으로 보내면 됨.
 */
export interface ChatFeedbackRequest {
  sessionId: string;
  messageId: string;
  feedback: FeedbackValue;
}

/**
 * 피드백 전송 Mock 함수
 * - 지금은 콘솔 로그 + 약간의 지연만 넣어 둠
 * - 실제 구현 시: POST /api/chat/feedback 등으로 연동
 */
export async function sendFeedbackToAI(
  req: ChatFeedbackRequest
): Promise<void> {
  console.log("[Mock] sendFeedbackToAI 요청:", req);

  // 너무 길 필요는 없고, 살짝 지연만
  await new Promise((resolve) => setTimeout(resolve, 150));
}
