import React, { useEffect, useRef, useState } from "react";
import "./FloatingDock.css";
import ChatbotApp from "./ChatbotApp";

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

type ChatAnimationState = "opening" | "closing" | null;

type Anchor = {
  x: number;
  y: number;
};

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

const FloatingDock: React.FC = () => {
  const iconRef = useRef<HTMLButtonElement | null>(null);

  // 아이콘 위치
  const [position, setPosition] = useState<Position>(() => getInitialPosition());
  // 챗봇 표시 여부
  const [isChatVisible, setIsChatVisible] = useState(false);
  // 열림/닫힘 애니메이션 상태
  const [chatAnimation, setChatAnimation] =
    useState<ChatAnimationState>(null);
  // 패널을 띄울 기준이 되는 아이콘 "입" 위치(앵커)
  const [anchor, setAnchor] = useState<Anchor | null>(null);
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

  /** 아이콘의 "입" 위치 계산 (패널 기준점) */
  const calcAnchorFromIcon = (): Anchor | null => {
    if (!iconRef.current) return null;
    const rect = iconRef.current.getBoundingClientRect();

    // 입 쪽: 아이콘 아래쪽 70% 지점 정도로 잡기
    const mouthX = rect.left + rect.width / 2;
    const mouthY = rect.top + rect.height * 0.7;

    return { x: mouthX, y: mouthY };
  };

  /** 챗봇 열기 */
  const openChat = () => {
    if (chatAnimation) return; // 애니메이션 중에는 무시

    const newAnchor = calcAnchorFromIcon();
    if (!newAnchor) return;

    setAnchor(newAnchor);
    setIsChatVisible(true);
    setChatAnimation("opening");
  };

  /** 챗봇 닫기(애니메이션 시작) */
  const requestCloseChat = () => {
    if (!isChatVisible || chatAnimation) return;

    const newAnchor = calcAnchorFromIcon();
    if (newAnchor) {
      setAnchor(newAnchor);
    }
    setChatAnimation("closing");
  };

  /** 애니메이션 종료 콜백 */
  const handleAnimationEnd = () => {
    if (chatAnimation === "closing") {
      setIsChatVisible(false);
    }
    setChatAnimation(null);
  };

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

    const { innerWidth, innerHeight } = window;
    const nextX = clamp(
      dragRef.current.originX + dx,
      40,
      innerWidth - 40 - 80
    );
    const nextY = clamp(
      dragRef.current.originY + dy,
      40,
      innerHeight - 40 - 80
    );

    setPosition({ x: nextX, y: nextY });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current.dragging) return;

    event.currentTarget.releasePointerCapture(event.pointerId);
    const moved = dragRef.current.moved;
    dragRef.current.dragging = false;
    dragRef.current.moved = false;

    // 드래그가 아니면 클릭으로 처리 → 열기/닫기 토글
    if (!moved) {
      if (isChatVisible) {
        requestCloseChat();
      } else {
        openChat();
      }
    }
  };

  return (
    <>
      {/* 지니 효과 + 위치가 적용된 챗봇 패널 */}
      {isChatVisible && (
        <ChatbotApp
          onClose={requestCloseChat}
          anchor={anchor}
          animationState={chatAnimation ?? undefined}
          onAnimationEnd={handleAnimationEnd}
        />
      )}

      {/* 플로팅 아이콘 (항상 화면 오른쪽 아래 떠 있음) */}
      <div
        className="ctrlf-floating-dock"
        style={{ left: `${position.x}px`, top: `${position.y}px` }}
      >
        <button
          ref={iconRef}
          type="button"
          className="ctrlf-floating-button"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
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
    </>
  );
};

export default FloatingDock;
