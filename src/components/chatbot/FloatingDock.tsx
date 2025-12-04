// src/components/chatbot/FloatingDock.tsx
import React, { useEffect, useRef, useState } from "react";
import "./FloatingDock.css";
import type { Anchor } from "../../utils/chat";

type Position = { x: number; y: number };
type EyeOffset = { x: number; y: number };

type DragState = {
  dragging: boolean;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

interface FloatingDockProps {
  /** 챗봇 패널 열림 여부 (아이콘 상태 표현에 사용 가능) */
  isChatbotOpen: boolean;
  /** 아이콘 클릭 시, 현재 아이콘 기준 Anchor를 넘겨서 토글 요청 */
  onToggleChatbot: (anchor: Anchor) => void;
  /** 아이콘 위치(입 위치 기준 Anchor)가 바뀔 때마다 상위에 알려줌 */
  onAnchorChange?: (anchor: Anchor | null) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** 처음 렌더될 때 아이콘 기본 위치 계산 */
function getInitialPosition(): Position {
  if (typeof window === "undefined") {
    return { x: 80, y: 80 };
  }
  const { innerWidth, innerHeight } = window;
  return {
    x: innerWidth - 96,
    y: innerHeight - 120,
  };
}

/** 현재 position 을 주어진 viewport 안으로 클램프 */
function clampPositionToViewport(pos: Position): Position {
  if (typeof window === "undefined") return pos;
  const { innerWidth, innerHeight } = window;
  const x = clamp(pos.x, 40, innerWidth - 40 - 80);
  const y = clamp(pos.y, 40, innerHeight - 40 - 80);
  return { x, y };
}

const FloatingDock: React.FC<FloatingDockProps> = ({
  isChatbotOpen,
  onToggleChatbot,
  onAnchorChange,
}) => {
  const iconRef = useRef<HTMLButtonElement | null>(null);

  // 아이콘 위치
  const [position, setPosition] = useState<Position>(() => getInitialPosition());
  // 눈동자 위치
  const [eyeOffset, setEyeOffset] = useState<EyeOffset>({ x: 0, y: 0 });

  const dragRef = useRef<DragState>({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  });

  // 눈동자가 마우스를 따라가도록
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!iconRef.current) return;

      const rect = iconRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;

      const maxDistance = 10;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const scale = Math.min(maxDistance / distance, 1);

      setEyeOffset({
        x: dx * scale,
        y: dy * scale,
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // 윈도우 리사이즈 시, 현재 position 을 viewport 안으로 클램프
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => clampPositionToViewport(prev));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /** 아이콘의 "입" 위치 계산 (패널 기준점) */
  const calcAnchorFromIcon = (): Anchor | null => {
    if (!iconRef.current) return null;
    const rect = iconRef.current.getBoundingClientRect();

    // 입 쪽: 아이콘 아래쪽 70% 지점 정도로 잡기
    const mouthX = rect.left + rect.width / 2;
    const mouthY = rect.top + rect.height * 0.7;

    return { x: mouthX, y: mouthY };
  };

  /** 아이콘 위치(position)가 바뀔 때마다 Anchor를 상위에 알려줌 */
  useEffect(() => {
    if (!onAnchorChange) return;
    const anchor = calcAnchorFromIcon();
    onAnchorChange(anchor);
    // position 이 바뀔 때마다 다시 계산
  }, [position, onAnchorChange]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const { clientX, clientY } = event;

    dragRef.current = {
      dragging: true,
      startX: clientX,
      startY: clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current.dragging) return;

    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;

    if (!dragRef.current.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      dragRef.current.moved = true;
    }

    const nextPos: Position = {
      x: dragRef.current.originX + dx,
      y: dragRef.current.originY + dy,
    };

    setPosition(clampPositionToViewport(nextPos));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current.dragging) return;

    event.currentTarget.releasePointerCapture(event.pointerId);
    const moved = dragRef.current.moved;
    dragRef.current.dragging = false;
    dragRef.current.moved = false;

    // 드래그가 아니면 클릭으로 처리 → 상위(FloatingChatbotRoot)에 토글 요청
    if (!moved) {
      const anchor = calcAnchorFromIcon();
      if (!anchor) return;
      onToggleChatbot(anchor);
    }
  };

  return (
    <div
      className="ctrlf-floating-dock"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      <button
        ref={iconRef}
        type="button"
        className={`ctrlf-floating-button ${
          isChatbotOpen ? "ctrlf-floating-button-open" : ""
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-pressed={isChatbotOpen}
        aria-label={isChatbotOpen ? "챗봇 닫기" : "챗봇 열기"}
      >
        <div className="ctrlf-floating-face">
          <div className="ctrlf-floating-eye ctrlf-floating-eye-left">
            <div
              className="ctrlf-floating-pupil"
              style={{
                transform: `translate(${eyeOffset.x}px, ${eyeOffset.y}px)`,
              }}
            />
          </div>
          <div className="ctrlf-floating-eye ctrlf-floating-eye-right">
            <div
              className="ctrlf-floating-pupil"
              style={{
                transform: `translate(${eyeOffset.x}px, ${eyeOffset.y}px)`,
              }}
            />
          </div>
          <div className="ctrlf-floating-mouth" />
        </div>
      </button>
    </div>
  );
};

export default FloatingDock;
