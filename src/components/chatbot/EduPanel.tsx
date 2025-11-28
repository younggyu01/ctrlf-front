// src/components/chatbot/EduPanel.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./chatbot.css";
import {
  computePanelPosition,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";

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

type VideoProgressMap = Record<string, number>;

export interface EduPanelProps {
  anchor?: Anchor | null;
  onClose: () => void;
  // 특정 영상 시청 완료 후 퀴즈 대시보드 패널 열기 (연결된 퀴즈 id를 넘길 수도 있음)
  onOpenQuizPanel?: (quizId?: string) => void;
  // 부모에서 관리하는 시청률 상태 (videoId → 0~100)
  videoProgressMap?: VideoProgressMap;
  // 시청률 변경 시 부모에 알려주는 콜백
  onUpdateVideoProgress?: (videoId: string, progress: number) => void;
}

const MIN_WIDTH = 520;
const MIN_HEIGHT = 420;
const INITIAL_SIZE: Size = { width: 540, height: 420 };

// URL 없는 카드용 fallback 비디오
const SAMPLE_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

// =======================
// 교육 도메인용 타입/데이터
// =======================

type EduVideoStatusKey = "not-started" | "in-progress" | "completed";

interface EduVideo {
  id: string;
  title: string;
  progress?: number; // 0 ~ 100, 없으면 0
  videoUrl?: string;
  quizId?: string;
}

interface EduSection {
  id: string;
  title: string;
  videos: EduVideo[];
}

// 섹션당 더미 데이터 (초기 progress 없음)
const EDU_SECTIONS: EduSection[] = [
  {
    id: "job",
    title: "직무 교육",
    videos: [
      {
        id: "job-1",
        title: "곰",
        videoUrl: "/videos/test1.mp4",
      },
      { id: "job-2", title: "직무교육 2차" },
      { id: "job-3", title: "직무교육 3차" },
      { id: "job-4", title: "신입사원 온보딩" },
      { id: "job-5", title: "문서작성 실무" },
      { id: "job-6", title: "리더십 스킬 향상" },
    ],
  },
  {
    id: "sexual-harassment",
    title: "성희롱 예방",
    videos: [
      { id: "sh-1", title: "성희롱 예방 교육 (기본)", quizId: "harassment" },
      { id: "sh-2", title: "성희롱 예방 교육 (심화)", quizId: "harassment" },
      { id: "sh-3", title: "사례로 보는 성희롱", quizId: "harassment" },
      { id: "sh-4", title: "관리자 필수 과정", quizId: "harassment" },
      { id: "sh-5", title: "신고·처리 절차 안내", quizId: "harassment" },
    ],
  },
  {
    id: "privacy",
    title: "개인 정보 보호",
    videos: [
      { id: "pi-1", title: "개인정보보호 기본 교육", quizId: "privacy" },
      { id: "pi-2", title: "개인정보 유출 사례", quizId: "privacy" },
      { id: "pi-3", title: "마케팅·홍보 시 유의사항", quizId: "privacy" },
      { id: "pi-4", title: "업무별 체크리스트", quizId: "privacy" },
      { id: "pi-5", title: "개인정보보호법 개정 사항", quizId: "privacy" },
    ],
  },
  {
    id: "bullying",
    title: "괴롭힘",
    videos: [
      { id: "bully-1", title: "직장 내 괴롭힘 예방교육", quizId: "bullying" },
      { id: "bully-2", title: "실제 사례와 판례", quizId: "bullying" },
      { id: "bully-3", title: "관리자 대응 매뉴얼", quizId: "bullying" },
      { id: "bully-4", title: "동료로서의 대응 방법", quizId: "bullying" },
      { id: "bully-5", title: "피해자 보호 절차", quizId: "bullying" },
    ],
  },
  {
    id: "disability-awareness",
    title: "장애인 인식 개선",
    videos: [
      {
        id: "da-1",
        title: "장애인 인식개선 기본 교육",
        quizId: "disability",
      },
      { id: "da-2", title: "장애 유형별 이해", quizId: "disability" },
      { id: "da-3", title: "배려가 필요한 상황들", quizId: "disability" },
      { id: "da-4", title: "말·행동 가이드", quizId: "disability" },
      { id: "da-5", title: "사내 사례 모음", quizId: "disability" },
    ],
  },
];

function getVideoStatus(
  progress: number
): { label: string; key: EduVideoStatusKey } {
  if (progress <= 0) {
    return { label: "시청전", key: "not-started" };
  }
  if (progress >= 100) {
    return { label: "시청완료", key: "completed" };
  }
  return { label: "시청중", key: "in-progress" };
}

// 패널 너비에 따라 한 번에 보여줄 카드 개수
function getPageSize(panelWidth: number): number {
  if (panelWidth < 640) return 1;
  if (panelWidth < 920) return 2;
  return 3;
}

// 부모에서 내려온 videoProgressMap을 섹션 구조에 반영해서
// "렌더용 sections"를 만드는 함수 (상태 X, 순수 계산)
function buildSectionsWithProgress(
  progressMap?: VideoProgressMap
): EduSection[] {
  if (!progressMap) {
    // 깊은 복사
    return EDU_SECTIONS.map((section) => ({
      ...section,
      videos: section.videos.map((v) => ({ ...v })),
    }));
  }

  return EDU_SECTIONS.map((section) => ({
    ...section,
    videos: section.videos.map((video) => {
      const external = progressMap[video.id];
      if (external === undefined) return { ...video };
      const prev = video.progress ?? 0;
      return {
        ...video,
        progress: Math.max(prev, external),
      };
    }),
  }));
}

const EduPanel: React.FC<EduPanelProps> = ({
  anchor,
  onClose,
  onOpenQuizPanel,
  videoProgressMap,
  onUpdateVideoProgress,
}) => {
  // 패널 크기 + 위치
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

  // 섹션별 페이지 인덱스만 state로 관리
  const [sectionPages, setSectionPages] = useState<Record<string, number>>(
    () => {
      const initial: Record<string, number> = {};
      EDU_SECTIONS.forEach((section) => {
        initial[section.id] = 0;
      });
      return initial;
    }
  );

  // 실제 카드 렌더용 섹션: props(videoProgressMap) + 더미 데이터를 기반으로 매번 계산
  const sections: EduSection[] = useMemo(
    () => buildSectionsWithProgress(videoProgressMap),
    [videoProgressMap]
  );

  // 현재 시청 중인 영상
  const [selectedVideo, setSelectedVideo] = useState<EduVideo | null>(null);

  // 비디오 진행률 계산용
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoDurationRef = useRef<number>(0);
  const maxWatchedTimeRef = useRef<number>(0); // 가장 멀리 본 지점(초)
  const [watchPercent, setWatchPercent] = useState<number>(0); // 0~100
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // 시청률 / 퀴즈 가능 여부
  const roundedWatchPercent = Math.round(watchPercent);
  const canTakeQuiz = roundedWatchPercent >= 100;

  // ====== 드래그/리사이즈 ======
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      const margin = 16;
      const padding = 32;

      // 1) 리사이즈
      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        const maxWidth = Math.max(
          MIN_WIDTH,
          window.innerWidth - padding * 2
        );
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

      // 2) 드래그
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

  // 부모 progress 업데이트만 담당하는 헬퍼
  const syncProgressToParent = (videoId: string, progress: number) => {
    const finalProgress = Math.round(progress);
    if (onUpdateVideoProgress) {
      onUpdateVideoProgress(videoId, finalProgress);
    }
  };

  // 섹션별 이전/다음
  const handlePrevClick = (sectionId: string) => {
    setSectionPages((prev) => {
      const pageSize = getPageSize(size.width);
      const section = sections.find((s) => s.id === sectionId);
      if (!section) return prev;

      const maxPage = Math.max(
        0,
        Math.ceil(section.videos.length / pageSize) - 1
      );
      const current = Math.min(prev[sectionId] ?? 0, maxPage);
      const nextPage = Math.max(0, current - 1);
      return { ...prev, [sectionId]: nextPage };
    });
  };

  const handleNextClick = (sectionId: string) => {
    setSectionPages((prev) => {
      const pageSize = getPageSize(size.width);
      const section = sections.find((s) => s.id === sectionId);
      if (!section) return prev;

      const maxPage = Math.max(
        0,
        Math.ceil(section.videos.length / pageSize) - 1
      );
      const current = Math.min(prev[sectionId] ?? 0, maxPage);
      const nextPage = Math.min(maxPage, current + 1);
      return { ...prev, [sectionId]: nextPage };
    });
  };

  // 카드 클릭 → 시청 모드
  const handleVideoClick = (video: EduVideo) => {
    const localProgress = video.progress ?? 0;
    const externalProgress =
      videoProgressMap && videoProgressMap[video.id] !== undefined
        ? videoProgressMap[video.id]
        : 0;
    const base = Math.max(localProgress, externalProgress);

    setSelectedVideo({ ...video, progress: base });
    setWatchPercent(base);
    maxWatchedTimeRef.current = 0;
    videoDurationRef.current = 0;
    setIsPlaying(false);
  };

  // 메타데이터 로딩 → 전체 길이 + 기존 진행률 위치로 이동
  const handleLoadedMetadata = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const duration = videoEl.duration || 0;
    videoDurationRef.current = duration;

    const basePercent = selectedVideo?.progress ?? 0;
    const startTime = duration * (basePercent / 100);

    videoEl.currentTime = startTime;
    maxWatchedTimeRef.current = startTime;
    setWatchPercent(basePercent);
  };

  // 재생 중 진행 상황 갱신
  const handleTimeUpdate = () => {
    const videoEl = videoRef.current;
    const duration = videoDurationRef.current;
    if (!videoEl || !duration) return;

    const current = videoEl.currentTime;
    const newMax = Math.max(maxWatchedTimeRef.current, current);
    maxWatchedTimeRef.current = newMax;

    const newPercent = (newMax / duration) * 100;
    setWatchPercent((prev) => (newPercent > prev ? newPercent : prev));
  };

  // 재생 끝났을 때 100% 처리
  const handleEnded = () => {
    const duration =
      videoDurationRef.current || videoRef.current?.duration || 0;
    if (duration > 0) {
      maxWatchedTimeRef.current = duration;
      setWatchPercent(100);
    }
    setIsPlaying(false);
  };

  // 재생/일시정지 토글 (비디오 클릭 + 버튼 둘 다 사용)
  const handlePlayPause = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (videoEl.paused || videoEl.ended) {
      videoEl.play();
      setIsPlaying(true);
    } else {
      videoEl.pause();
      setIsPlaying(false);
    }
  };

  // 퀴즈 페이지 이동 (퀴즈 대시보드 패널 열기 + 해당 퀴즈 언락 요청)
  const handleGoToQuiz = () => {
    if (!selectedVideo || !canTakeQuiz) return;

    // 진행률 100% 반영 (부모에만 전달)
    syncProgressToParent(selectedVideo.id, roundedWatchPercent);

    const quizId = selectedVideo.quizId;

    if (onOpenQuizPanel) {
      onOpenQuizPanel(quizId);
    } else {
      console.log(
        "퀴즈 페이지로 이동 (패널 콜백 없음):",
        selectedVideo.id,
        quizId
      );
    }
  };

  // 목록으로 돌아갈 때, 현재 시청 진행률을 부모에 반영
  const handleBackToList = () => {
    if (selectedVideo) {
      if (videoRef.current) {
        videoRef.current.pause();
      }
      syncProgressToParent(selectedVideo.id, watchPercent);
    }

    setSelectedVideo(null);
    videoDurationRef.current = 0;
    maxWatchedTimeRef.current = 0;
    setWatchPercent(0);
    setIsPlaying(false);
  };

  // 창 닫기 버튼 클릭 시에도 현재 시청 중이면 진행률 반영
  const handleCloseClick = () => {
    if (selectedVideo) {
      if (videoRef.current) {
        videoRef.current.pause();
      }
      syncProgressToParent(selectedVideo.id, watchPercent);
    }
    onClose();
  };

  const currentVideoSrc = selectedVideo?.videoUrl ?? SAMPLE_VIDEO_URL;

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
            className="cb-panel-close-btn cb-edu-close-btn"
            onClick={handleCloseClick}
            aria-label="교육 영상 창 닫기"
          >
            ✕
          </button>

          {/* 실제 콘텐츠 */}
          <div className="cb-edu-panel-inner">
            {selectedVideo ? (
              // =======================
              // 시청 모드
              // =======================
              <div className="cb-edu-watch-layout">
                <header className="cb-edu-watch-header">
                  <button
                    type="button"
                    className="cb-edu-nav-btn cb-edu-watch-back-btn"
                    onClick={handleBackToList}
                    aria-label="교육 영상 목록으로 돌아가기"
                  >
                    ◀
                  </button>
                  <h2 className="cb-edu-watch-title">{selectedVideo.title}</h2>
                </header>

                <div className="cb-edu-watch-body">
                  <div className="cb-edu-watch-player-wrapper">
                    <video
                      className="cb-edu-watch-video"
                      src={currentVideoSrc}
                      ref={videoRef}
                      onLoadedMetadata={handleLoadedMetadata}
                      onTimeUpdate={handleTimeUpdate}
                      onEnded={handleEnded}
                      onClick={handlePlayPause}
                      controls={false}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      브라우저가 비디오 태그를 지원하지 않습니다.
                    </video>

                    {/* 왼쪽 아래 커스텀 컨트롤 */}
                    <div className="cb-edu-watch-overlay">
                      <button
                        type="button"
                        className="cb-edu-watch-play-btn"
                        onClick={handlePlayPause}
                        aria-label={isPlaying ? "일시정지" : "재생"}
                      >
                        <span className="cb-edu-watch-play-icon">
                          {isPlaying ? "❚❚" : "▶"}
                        </span>
                      </button>
                      <span className="cb-edu-watch-progress-text">
                        시청률 {roundedWatchPercent}%
                      </span>
                    </div>
                  </div>

                  {/* 아래 오른쪽 퀴즈 버튼 */}
                  <div className="cb-edu-watch-footer">
                    <button
                      type="button"
                      className={
                        "cb-edu-watch-quiz-btn" +
                        (canTakeQuiz ? " is-active" : "")
                      }
                      onClick={handleGoToQuiz}
                      disabled={!canTakeQuiz}
                    >
                      퀴즈 풀기
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // =======================
              // 목록 모드
              // =======================
              <>
                <header className="cb-edu-header">
                  <h2 className="cb-edu-title">교육 영상</h2>
                </header>

                <div className="cb-edu-body">
                  <div className="cb-edu-sections">
                    {sections.map((section) => {
                      const pageSize = getPageSize(size.width);
                      const maxPage = Math.max(
                        0,
                        Math.ceil(section.videos.length / pageSize) - 1
                      );
                      const currentPage = Math.min(
                        sectionPages[section.id] ?? 0,
                        maxPage
                      );
                      const start = currentPage * pageSize;
                      const visibleVideos = section.videos.slice(
                        start,
                        start + pageSize
                      );
                      const canPrev = currentPage > 0;
                      const canNext = currentPage < maxPage;

                      return (
                        <section key={section.id} className="cb-edu-section">
                          <h3 className="cb-edu-section-title">
                            {section.title}
                          </h3>

                          <div className="cb-edu-section-row">
                            <button
                              type="button"
                              className="cb-edu-nav-btn cb-edu-nav-prev"
                              onClick={() => handlePrevClick(section.id)}
                              disabled={!canPrev}
                              aria-label={`${section.title} 이전 영상`}
                            >
                              ◀
                            </button>

                            <div className="cb-edu-videos-row">
                              {visibleVideos.map((video) => {
                                const progress = video.progress ?? 0;
                                const { label, key } =
                                  getVideoStatus(progress);

                                // 썸네일에 사용할 비디오 소스
                                const thumbnailSrc =
                                  video.videoUrl ?? SAMPLE_VIDEO_URL;

                                return (
                                  <article
                                    key={video.id}
                                    className="cb-edu-video-card"
                                    aria-label={video.title}
                                  >
                                    <button
                                      type="button"
                                      className="cb-edu-video-close"
                                      aria-label="영상 제거"
                                      disabled
                                    >
                                      ✕
                                    </button>

                                    {/* 썸네일 클릭 → 시청 모드 */}
                                    <div
                                      className="cb-edu-video-thumbnail cb-edu-video-thumbnail-clickable"
                                      onClick={() =>
                                        handleVideoClick(video)
                                      }
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => {
                                        if (
                                          e.key === "Enter" ||
                                          e.key === " "
                                        ) {
                                          e.preventDefault();
                                          handleVideoClick(video);
                                        }
                                      }}
                                    >
                                      {/* 실제 비디오 첫 프레임을 썸네일로 사용 */}
                                      <video
                                        className="cb-edu-video-thumbnail-video"
                                        src={thumbnailSrc}
                                        muted
                                        preload="metadata"
                                        playsInline
                                        aria-hidden="true"
                                      />

                                      <div className="cb-edu-video-play-circle">
                                        <span className="cb-edu-video-play-icon">
                                          ▶
                                        </span>
                                      </div>
                                    </div>

                                    <div className="cb-edu-video-progress">
                                      <div className="cb-edu-video-progress-track">
                                        <div
                                          className="cb-edu-video-progress-fill"
                                          style={{
                                            width: `${progress}%`,
                                          }}
                                        />
                                      </div>
                                      <div className="cb-edu-video-meta">
                                        <span className="cb-edu-progress-text">
                                          시청률 {progress}%
                                        </span>
                                        <span
                                          className={`cb-edu-status cb-edu-status-${key}`}
                                        >
                                          {label}
                                        </span>
                                      </div>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>

                            <button
                              type="button"
                              className="cb-edu-nav-btn cb-edu-nav-next"
                              onClick={() => handleNextClick(section.id)}
                              disabled={!canNext}
                              aria-label={`${section.title} 다음 영상`}
                            >
                              ▶
                            </button>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EduPanel;
