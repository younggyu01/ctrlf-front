// src/components/dashboard/api/adminNotificationsApi.ts
import { getAccessToken, withAuthHeaders, fetchJson } from "../../common/api/authHttp";

/**
 * 알림 타입 정의
 */
export interface AdminNotification {
  id: string;
  timestamp: string; // ISO 8601
  type?: string; // 알림 타입/레벨 (예: "error", "warning", "info")
  message: string;
  // 추가 필드는 백엔드 응답에 맞춰 확장 가능
  [key: string]: unknown;
}

/**
 * SSE 스트림 리스너 콜백 타입
 */
export type NotificationStreamCallback = (notification: AdminNotification) => void;
export type NotificationStreamErrorCallback = (error: Error) => void;

/**
 * SSE 엔드포인트 URL
 * 
 * Vite 프록시 설정:
 * - /api/chat/admin/* → http://localhost:9005/admin/*
 * 
 * 백엔드 엔드포인트 (구현 필요):
 * - GET /admin/notifications/stream (Server-Sent Events)
 * 
 * 참고: 현재 백엔드에 해당 엔드포인트가 없으면 404가 발생하지만,
 * 폴링으로 자동 전환되므로 문제없음
 */
const NOTIFICATION_STREAM_URL =
  import.meta.env.VITE_ADMIN_NOTIFICATION_STREAM_URL ||
  "/api/chat/admin/notifications/stream";

/**
 * 폴링 엔드포인트 URL (SSE fallback용)
 * 
 * Vite 프록시 설정:
 * - /api/chat/admin/* → http://localhost:9005/admin/*
 * 
 * 백엔드 엔드포인트 (구현 필요):
 * - GET /admin/notifications/recent?limit=50
 * 
 * 참고: 현재 백엔드에 해당 엔드포인트가 없으면 빈 배열 반환
 */
const NOTIFICATION_RECENT_URL =
  import.meta.env.VITE_ADMIN_NOTIFICATION_RECENT_URL ||
  "/api/chat/admin/notifications/recent";

/**
 * SSE를 통한 실시간 알림 스트림 구독
 * - fetch + ReadableStream을 사용하여 Authorization 헤더 포함 가능
 * - 연결 실패 시 null 반환 (폴링으로 fallback)
 */
export async function subscribeToNotificationStream(
  onNotification: NotificationStreamCallback,
  onError?: NotificationStreamErrorCallback
): Promise<(() => void) | null> {
  try {
    const token = await getAccessToken(30);
    if (!token) {
      console.warn("[알림] 토큰이 없어 SSE 연결 불가");
      return null;
    }

    const headers = await withAuthHeaders({
      Accept: "text/event-stream",
    });

    const response = await fetch(NOTIFICATION_STREAM_URL, {
      method: "GET",
      headers,
    });

    if (!response.ok || !response.body) {
      console.warn(
        `[알림] SSE 연결 실패: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // 읽기 루프
    const readLoop = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("[알림] SSE 스트림 종료 (done=true) - 서버에서 연결 종료");
            // 스트림이 종료되면 오류로 처리하여 재연결 시도
            if (onError) {
              onError(new Error("SSE stream ended by server"));
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          console.log("[알림] SSE 원본 청크:", JSON.stringify(chunk.substring(0, 500)));
          console.log("[알림] 현재 버퍼 전체:", JSON.stringify(buffer));

          // SSE 메시지 파싱
          // 형식: event: notification\ndata: {...}\n\n
          // 빈 라인(\n\n)으로 메시지 구분
          // 주의: 여러 메시지가 연속으로 올 수 있음
          while (buffer.includes("\n\n")) {
            const messageEndIndex = buffer.indexOf("\n\n");
            const messageText = buffer.substring(0, messageEndIndex);
            buffer = buffer.substring(messageEndIndex + 2); // "\n\n" 제거

            if (!messageText.trim()) {
              continue;
            }

            console.log("[알림] 파싱할 메시지:", JSON.stringify(messageText));

            const lines = messageText.split("\n");
            let currentEvent: string | null = null;
            const currentDataLines: string[] = [];

            for (const line of lines) {
              const trimmed = line.trim();
              
              // 빈 라인 무시
              if (!trimmed) {
                continue;
              }
              
              // 주석 라인 무시
              if (trimmed.startsWith(":")) {
                continue;
              }

              // event: 필드 파싱 (공백 유무 관계없이)
              if (trimmed.startsWith("event:")) {
                // "event:" 이후의 값을 가져옴 (공백 제거)
                currentEvent = trimmed.substring(6).trim(); // "event:" 제거 후 trim
                console.log("[알림] SSE 이벤트 타입:", currentEvent);
                currentDataLines.length = 0; // 이벤트 변경 시 데이터 초기화
              } 
              // data: 필드 파싱 (공백 유무 관계없이)
              else if (trimmed.startsWith("data:")) {
                // "data:" 이후의 값을 가져옴 (공백 제거하지 않고 그대로, JSON 파싱을 위해)
                const dataValue = trimmed.substring(5).trimStart(); // "data:" 제거, 앞 공백만 제거
                currentDataLines.push(dataValue);
                console.log("[알림] SSE 데이터 라인 추가:", dataValue.substring(0, 100));
              }
            }

            // 이벤트와 데이터가 모두 있을 때만 처리
            if (currentEvent && currentDataLines.length > 0) {
              const currentData = currentDataLines.join("\n");
              console.log("[알림] 파싱된 이벤트:", currentEvent, "데이터:", currentData.substring(0, 200));
              
              if (currentEvent === "connected") {
                console.log("[알림] SSE 연결 확인:", currentData);
              } else if (currentEvent === "notification") {
                try {
                  const data = JSON.parse(currentData);
                  console.log("[알림] SSE 알림 수신 (파싱 성공):", JSON.stringify(data, null, 2));
                  
                  // 필수 필드 검증 및 정규화
                  if (data && data.id && data.message !== undefined) {
                    const normalizedNotification: AdminNotification = {
                      id: String(data.id),
                      timestamp: data.timestamp || new Date().toISOString(),
                      type: data.type ? String(data.type) : undefined,
                      message: String(data.message || ""),
                    };
                    console.log("[알림] 정규화된 알림:", normalizedNotification);
                    onNotification(normalizedNotification);
                    console.log("[알림] onNotification 콜백 호출 완료");
                  } else {
                    console.warn("[알림] SSE 알림 데이터 형식 오류 (필수 필드 누락):", data);
                  }
                } catch (parseError) {
                  console.warn("[알림] SSE 메시지 JSON 파싱 실패:", currentData, parseError);
                }
              } else {
                console.log("[알림] SSE 알 수 없는 이벤트 타입:", currentEvent, "데이터:", currentData.substring(0, 100));
              }
            } else {
              console.warn("[알림] SSE 메시지 불완전:", {
                event: currentEvent,
                dataLinesCount: currentDataLines.length,
                messageText: messageText.substring(0, 200),
              });
            }
          }
        }
      } catch (error) {
        if (onError) {
          onError(
            error instanceof Error
              ? error
              : new Error(String(error))
          );
        } else {
          console.error("[알림] SSE 읽기 오류:", error);
        }
      }
    };

    readLoop().catch((error) => {
      console.warn("[알림] SSE 읽기 루프 오류:", error);
      if (onError) {
        onError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    // cleanup 함수 반환
    return () => {
      console.log("[알림] SSE cleanup 호출 - 스트림 종료");
      reader.cancel().catch((err) => {
        console.warn("[알림] SSE reader.cancel() 오류:", err);
      });
    };
  } catch (error) {
    console.warn("[알림] SSE 연결 시도 실패:", error);
    return null;
  }
}

/**
 * 폴링을 통한 최근 알림 조회 (SSE fallback)
 */
export async function fetchRecentNotifications(
  limit: number = 50
): Promise<AdminNotification[]> {
  try {
    const query = limit > 0 ? `?limit=${limit}` : "";
    // 백엔드 응답: { notifications: [...] }
    const response = await fetchJson<{ notifications: AdminNotification[] }>(
      `${NOTIFICATION_RECENT_URL}${query}`
    );
    return response.notifications || [];
  } catch (error) {
    console.error("[알림] 최근 알림 조회 실패:", error);
    return [];
  }
}

