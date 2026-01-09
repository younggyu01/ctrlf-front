// src/components/dashboard/AdminNotifications.tsx
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  subscribeToNotificationStream,
  fetchRecentNotifications,
  type AdminNotification,
} from "./api/adminNotificationsApi";

interface AdminNotificationsProps {
  /** 알림 모달 열림 여부 */
  isOpen: boolean;
  /** 모달 닫기 콜백 */
  onClose: () => void;
  /** 미확인 알림 개수 */
  unreadCount: number;
  /** unreadCount 업데이트 콜백 */
  onUnreadCountChange: (count: number) => void;
}

/**
 * 알림 모달 컴포넌트
 */
const AdminNotifications: React.FC<AdminNotificationsProps> = ({
  isOpen,
  onClose,
  unreadCount,
  onUnreadCountChange,
}) => {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const isStreamActiveRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const unreadCountRef = useRef(unreadCount);
  const hasInitializedRef = useRef(false); // 초기화 완료 여부

  // ===== 디자인 전용: 종 버튼(anchor) 기준으로 팝오버 위치 계산 =====
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  // 최대 알림 개수 (초과 시 오래된 것 제거)
  const MAX_NOTIFICATIONS = 200;

  // ref 업데이트 (클로저 문제 방지)
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    unreadCountRef.current = unreadCount;
  }, [unreadCount]);

  /**
   * 알림 추가 (최신 알림을 맨 위에 추가)
   */
  const addNotification = useCallback(
    (notification: AdminNotification) => {
      console.log("[알림] 새 알림 수신 (원본):", notification);
      console.log("[알림] 새 알림 수신 (JSON):", JSON.stringify(notification, null, 2));

      // 필수 필드 검증
      if (!notification) {
        console.warn("[알림] notification 객체가 없습니다");
        return;
      }

      if (!notification.id) {
        console.warn("[알림] id가 없습니다:", notification);
        return;
      }

      // message가 없거나 빈 문자열이면 기본 메시지 사용
      const message = notification.message
        ? String(notification.message).trim()
        : "(알림 메시지 없음)";

      if (message === "" || message === "(알림 메시지 없음)") {
        console.warn("[알림] 메시지가 비어있습니다:", notification);
      }

      // 메시지가 문자열이 아니면 문자열로 변환
      const normalizedNotification: AdminNotification = {
        ...notification,
        message: message,
        id: String(notification.id || ""),
        timestamp: String(notification.timestamp || new Date().toISOString()),
        type: notification.type ? String(notification.type) : undefined,
      };

      console.log("[알림] 정규화된 알림:", normalizedNotification);

      setNotifications((prev) => {
        // 중복 체크 (id 기준) - 더 엄격하게 체크
        const existingIndex = prev.findIndex((n) => n.id === normalizedNotification.id);
        if (existingIndex !== -1) {
          console.log("[알림] 중복 알림 무시:", normalizedNotification.id, "기존 인덱스:", existingIndex);
          return prev;
        }

        // 최신을 맨 위에 추가
        const updated = [normalizedNotification, ...prev];

        // 최대 개수 초과 시 오래된 것 제거
        if (updated.length > MAX_NOTIFICATIONS) {
          console.log("[알림] 최대 개수 초과, 오래된 알림 제거:", updated.length, "->", MAX_NOTIFICATIONS);
          return updated.slice(0, MAX_NOTIFICATIONS);
        }

        console.log("[알림] 알림 추가 완료, 총 개수:", updated.length, "알림 ID:", normalizedNotification.id);
        return updated;
      });

      // 모달이 닫혀 있을 때만 unreadCount 증가 (ref로 최신 상태 확인)
      if (!isOpenRef.current) {
        const nextCount = unreadCountRef.current + 1;
        unreadCountRef.current = nextCount;
        onUnreadCountChange(nextCount);
      }
    },
    [onUnreadCountChange]
  );

  /**
   * 폴링 시작 (SSE fallback)
   */
  const startPolling = useCallback(async () => {
    // 이미 폴링이 실행 중이면 중복 실행 방지
    if (pollingIntervalRef.current) {
      console.log("[알림] 폴링이 이미 실행 중입니다.");
      return;
    }

    console.log("[알림] 폴링 시작");

    // 초기 로드 (백엔드 엔드포인트가 없어도 에러 무시)
    try {
      console.log("[알림] 폴링 초기 로드 시작");
      const initialNotifications = await fetchRecentNotifications(50);
      console.log("[알림] 폴링 초기 로드 결과:", initialNotifications.length, "개");
      if (initialNotifications.length > 0) {
        // 초기 로드는 unreadCount를 증가시키지 않음 (이미 있는 알림)
        setNotifications((prev) => {
          const existingIds = new Set(prev.map((n) => n.id));
          const newOnes = initialNotifications.filter(
            (n) => !existingIds.has(n.id)
          );
          console.log("[알림] 새 알림 개수:", newOnes.length);
          if (newOnes.length > 0) {
            const updated = [...newOnes, ...prev].slice(0, MAX_NOTIFICATIONS);
            console.log("[알림] 초기 알림 설정 완료, 총 개수:", updated.length);
            return updated;
          }
          return prev;
        });
      } else {
        console.log("[알림] 초기 알림이 없습니다. (StrategyEvent 또는 TelemetryEvent 없음)");
      }
    } catch (error) {
      // 백엔드 엔드포인트가 없으면 조용히 무시
      console.log("[알림] 초기 알림 조회 실패:", error);
    }

    // 3초마다 폴링
    pollingIntervalRef.current = window.setInterval(async () => {
      try {
        const recent = await fetchRecentNotifications(20); // 최근 20개만 확인
        if (recent.length > 0) {
          setNotifications((prev) => {
            const existingIds = new Set(prev.map((n) => n.id));
            const newOnes = recent.filter((n) => !existingIds.has(n.id));
            for (const notification of newOnes) {
              addNotification(notification);
            }
            return prev;
          });
        }
      } catch {
        // 폴링 실패는 조용히 무시 (백엔드 엔드포인트가 없을 수 있음)
        // 콘솔 로그 제거하여 스팸 방지
      }
    }, 3000);

    console.log("[알림] 폴링 시작 (3초 간격)");
  }, [addNotification]);

  /**
   * SSE 스트림 구독 시작
   * @returns cleanup 함수 또는 null (SSE 연결 실패 시)
   */
  const startStream = useCallback(async (): Promise<(() => void) | null> => {
    if (isStreamActiveRef.current) {
      return streamCleanupRef.current;
    }

    try {
      const cleanup = await subscribeToNotificationStream(
        addNotification,
        (error) => {
          console.warn("[알림] SSE 스트림 오류:", error.message || error);
          // SSE 스트림 오류 발생 시 cleanup
          if (streamCleanupRef.current) {
            streamCleanupRef.current();
            streamCleanupRef.current = null;
            isStreamActiveRef.current = false;
          }
        }
      );

      if (cleanup) {
        isStreamActiveRef.current = true;
        streamCleanupRef.current = cleanup;
        console.log("[알림] SSE 스트림 구독 시작");
        return cleanup;
      } else {
        // SSE 연결 실패
        console.log("[알림] SSE 연결 실패 (404 등), 폴링으로 전환");
        return null;
      }
    } catch (error) {
      console.warn("[알림] SSE 연결 시도 중 예외:", error);
      return null;
    }
  }, [addNotification]);

  /**
   * 스트림/폴링 정리
   */
  const cleanup = useCallback(() => {
    if (streamCleanupRef.current) {
      streamCleanupRef.current();
      streamCleanupRef.current = null;
      isStreamActiveRef.current = false;
    }
    if (pollingIntervalRef.current !== null) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // 컴포넌트 마운트 시 스트림 시작 (모달이 열려있지 않아도 백그라운드에서 수신)
  // React Strict Mode에서 두 번 마운트되는 것을 방지
  useEffect(() => {
    // 이미 초기화되었으면 무시 (React Strict Mode 대응)
    if (hasInitializedRef.current) {
      return;
    }
    hasInitializedRef.current = true;

    let mounted = true;

    const initStream = async () => {
      if (!mounted) return;

      try {
        const cleanup = await startStream();
        if (!cleanup && mounted) {
          // SSE 실패 시 폴링 시작
          console.log("[알림] SSE 연결 실패, 폴링으로 전환");
          await startPolling();
        } else if (cleanup) {
          // SSE 연결 성공
          console.log("[알림] SSE 연결 성공");
        }
      } catch (error) {
        if (mounted) {
          console.warn("[알림] 스트림 시작 실패, 폴링으로 전환:", error);
          await startPolling();
        }
      }
    };

    initStream();

    // SSE 스트림이 종료되면 폴링으로 전환하는 로직
    // (startStream의 에러 핸들러에서 처리하지 않고 여기서 처리)
    const checkStreamAndPoll = setInterval(() => {
      if (mounted && !isStreamActiveRef.current && !pollingIntervalRef.current) {
        console.log("[알림] SSE 스트림 종료 감지, 폴링으로 전환");
        startPolling();
      }
    }, 5000); // 5초마다 확인

    return () => {
      mounted = false;
      clearInterval(checkStreamAndPoll);
      cleanup();
      // cleanup 시 초기화 플래그 리셋하지 않음 (마운트 해제 후 재마운트 시에만 리셋)
    };
  }, [startStream, startPolling, cleanup]);

  // 모달이 열릴 때 읽음 처리 (unreadCount = 0)
  useEffect(() => {
    if (isOpen && unreadCount > 0) {
      onUnreadCountChange(0);
    }
  }, [isOpen, unreadCount, onUnreadCountChange]);

  // ESC 키로 모달 닫기
  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  // ===== 디자인 전용: 종 버튼(.cb-admin-notif-btn) 옆에 붙여서 띄우기 =====
  useLayoutEffect(() => {
    if (!isOpen) return;

    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

    const updatePosition = () => {
      // 종 버튼 찾기 (관리자 대시보드 헤더의 알림 버튼)
      const anchor = document.querySelector(".cb-admin-notif-btn") as HTMLElement | null;

      // 버튼이 없으면 기존 기본 위치 유지 (안전)
      if (!anchor) {
        setPopoverStyle({});
        return;
      }

      const r = anchor.getBoundingClientRect();

      // CSS의 width(420)와 max-width 규칙을 그대로 반영해서 계산
      const padding = 12;
      const gap = 10;
      const desiredWidth = 420;
      const width = Math.min(desiredWidth, Math.max(280, window.innerWidth - 48)); // 너무 작아지는 것 방지
      const maxH = Math.min(560, window.innerHeight - 24); // 대략적인 최대치 (CSS max-height와 크게 충돌 안 나게)

      // 기본: 버튼 아래에, 버튼 오른쪽에 맞춰 정렬 (popover 느낌)
      let left = r.right - width;
      left = clamp(left, padding, window.innerWidth - width - padding);

      let top = r.bottom + gap;

      // 아래 공간이 부족하면 위로 띄우기
      const wouldOverflowBottom = top + maxH > window.innerHeight - padding;
      if (wouldOverflowBottom) {
        top = Math.max(padding, r.top - gap - maxH);
      }

      // 화살표(옵션) 위치: 버튼 중앙이 popover 내부에서 어디인지
      const anchorCenterX = r.left + r.width / 2;
      const arrowX = clamp(anchorCenterX - left, 24, width - 24);

      setPopoverStyle({
        top,
        left,
        right: "auto",
        // CSS에서 화살표 위치를 잡기 위한 변수
        "--cb-admin-notif-arrow-x": `${arrowX}px`,
      } as React.CSSProperties & { "--cb-admin-notif-arrow-x": string });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  /**
   * 시간 포맷팅 (예: "2025-01-15 14:30")
   */
  const formatTime = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch {
      return timestamp;
    }
  };

  // 모달이 열려있지 않으면 렌더링하지 않음
  if (!isOpen) return null;

  console.log("[알림] 모달 렌더링, 알림 개수:", notifications.length);

  // React Portal을 사용하여 body에 직접 렌더링 (z-index 문제 방지)
  const modalContent = (
    <>
      {/* 오버레이 */}
      <div
        className="cb-admin-notif-modal-overlay"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 모달 */}
      <div
        ref={modalRef}
        className="cb-admin-notif-modal"
        style={popoverStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="cb-admin-notif-modal-header">
          <h3 className="cb-admin-notif-modal-title">알림</h3>
          <button
            type="button"
            className="cb-admin-notif-modal-close"
            onClick={onClose}
            aria-label="알림 모달 닫기"
          >
            ✕
          </button>
        </div>

        {/* 본문: 알림 리스트 */}
        <div className="cb-admin-notif-list">
          {notifications.length === 0 ? (
            <div className="cb-admin-notif-empty">
              알림이 없습니다.
            </div>
          ) : (
            notifications.map((notification, index) => {
              // 중복 체크 (개발 모드에서만)
              if (import.meta.env.DEV) {
                const duplicateCount = notifications.filter(n => n.id === notification.id).length;
                if (duplicateCount > 1) {
                  console.warn("[알림] 중복 알림 발견:", notification.id, "개수:", duplicateCount);
                }
              }

              return (
                <div
                  key={`${notification.id}-${index}`}
                  className={`cb-admin-notif-item ${notification.type ? `cb-admin-notif-item--${notification.type}` : ""
                    }`}
                >
                  <div className="cb-admin-notif-item-time">
                    {formatTime(notification.timestamp)}
                  </div>
                  {notification.type && (
                    <div className="cb-admin-notif-item-type">
                      {notification.type}
                    </div>
                  )}
                  <div className="cb-admin-notif-item-message">
                    {notification.message || "(메시지 없음)"}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );

  // Portal을 사용하여 body에 직접 렌더링
  if (typeof document !== "undefined") {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
};

export default AdminNotifications;

