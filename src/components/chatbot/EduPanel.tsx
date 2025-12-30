// src/components/chatbot/EduPanel.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./chatbot.css";
import { computePanelPosition, type Anchor, type PanelSize } from "../../utils/chat";

import {
  getMyEducations,
  getEducationVideos,
  postEduVideoProgress,
  type EducationItem,
  type EducationVideoItem,
} from "./educationServiceApi";

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

  /**
   * QuizPanel이 eduId 기반으로 시작하도록 설계하는 게 자연스러움.
   * (QuizPanel 실연동 시: GET /quiz/{eduId}/start)
   */
  onOpenQuizPanel?: (eduId?: string) => void;

  /**
   * 외부(상위)에서 관리하는 진행률 맵이 있으면 병합(호환 유지)
   * key는 "videoId"로 간주
   */
  videoProgressMap?: VideoProgressMap;

  /**
   * 기존(2 args) 호환 + 확장(4 args)
   * - progressPercent: 0~100
   * - resumeSeconds: 재생 위치(초)
   * - completed: 완료 여부
   */
  onUpdateVideoProgress?: (
    videoId: string,
    progressPercent: number,
    resumeSeconds?: number,
    completed?: boolean
  ) => void;

  onRequestFocus?: () => void;
  zIndex?: number;
}

// =======================
// 옵션: 상단 헤더 위로도 패널 이동을 허용할지
// =======================
const ALLOW_OVERLAP_APP_HEADER = true;

// 최소 크기
const MIN_WIDTH = 520;
const MIN_HEIGHT = 480;

// 최대 폭 + 화면 여백
const MAX_WIDTH = 1360;
const PANEL_MARGIN = 80;

// 시청 모드 기본 사이즈
const WATCH_DEFAULT_SIZE: Size = { width: 540, height: 480 };

// 패널이 화면 밖으로 나가지 않게 잡는 기본 여백
const EDGE_MARGIN = 0;

// 패널이 완전히 사라지지 않게 최소한 이만큼은 화면에 남김
const KEEP_VISIBLE_X = 120;
const KEEP_VISIBLE_Y = 80;

// Dock 주변 초기 위치 안전 여백
const DOCK_SAFE_RIGHT = 60;
const DOCK_SAFE_BOTTOM = 60;

// z-index 최상단
const EDU_LAYER_Z = 2147483000;

// progress 전송 주기(스펙 권장: 10~30s)
const PROGRESS_TICK_MS = 15_000;

// =======================
// UI 모델(섹션 = 교육, 카드 = 영상)
// =======================
type EduVideoStatusKey = "not-started" | "in-progress" | "completed";

type UiVideo = {
  id: string; // videoId
  title: string;
  videoUrl?: string;
  progress?: number; // 0~100
  resumeSeconds?: number; // seconds
  completed?: boolean;
};

type UiSection = {
  id: string; // educationId
  title: string;
  eduType?: string;
  completed?: boolean;
  videos: UiVideo[];
};

type VideoLoadState =
  | { status: "idle"; videos: UiVideo[] }
  | { status: "loading"; videos: UiVideo[] }
  | { status: "ready"; videos: UiVideo[] }
  | { status: "error"; videos: UiVideo[]; message: string };

type SelectedVideo = UiVideo & {
  educationId: string;
  educationTitle: string;
};

function getVideoStatus(progress: number): { label: string; key: EduVideoStatusKey } {
  if (progress <= 0) return { label: "시청전", key: "not-started" };
  if (progress >= 100) return { label: "시청완료", key: "completed" };
  return { label: "시청중", key: "in-progress" };
}

function getPageSize(panelWidth: number): number {
  if (panelWidth < 640) return 1;
  if (panelWidth < 920) return 2;
  return 3;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseCssPx(v: string): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const num = Number(s.replace("px", "").trim());
  return Number.isFinite(num) ? num : null;
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  return "name" in e && (e as { name?: unknown }).name === "AbortError";
}

/**
 * 헤더 높이를 “안전 상단 여백”으로 사용
 */
function readAppHeaderSafeTop(): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;

  try {
    const rootStyle = window.getComputedStyle(document.documentElement);

    const v1 = parseCssPx(rootStyle.getPropertyValue("--app-header-safe-top"));
    if (v1 !== null) return clamp(v1, 0, 200);

    const v2 = parseCssPx(rootStyle.getPropertyValue("--app-header-height"));
    if (v2 !== null) return clamp(v2, 0, 200);

    const headerEl =
      document.querySelector<HTMLElement>("[data-app-header]") ??
      document.querySelector<HTMLElement>("header");

    if (headerEl) {
      const h = headerEl.getBoundingClientRect().height;
      if (Number.isFinite(h) && h > 0) return clamp(h, 0, 200);
    }
  } catch {
    // ignore
  }

  return 72;
}

function getMinTop(topSafe: number) {
  return ALLOW_OVERLAP_APP_HEADER ? 0 : topSafe;
}

function clampPanelPos(pos: { top: number; left: number }, size: Size, minTop: number) {
  if (typeof window === "undefined") return pos;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const keepX = Math.min(KEEP_VISIBLE_X, Math.max(48, size.width - 48));
  const keepY = Math.min(KEEP_VISIBLE_Y, Math.max(40, size.height - 40));

  const rawLeftMin = -size.width + keepX;
  const rawLeftMax = vw - keepX;

  const rawTopMin = ALLOW_OVERLAP_APP_HEADER ? -size.height + keepY : minTop;
  const rawTopMax = vh - keepY;

  const leftMin = Math.min(rawLeftMin, rawLeftMax);
  const leftMax = Math.max(rawLeftMin, rawLeftMax);
  const topMin = Math.min(rawTopMin, rawTopMax);
  const topMax = Math.max(rawTopMin, rawTopMax);

  return {
    left: clamp(pos.left, leftMin, leftMax),
    top: clamp(pos.top, topMin, topMax),
  };
}

function createInitialSize(topSafe: number): Size {
  if (typeof window === "undefined") return { width: 960, height: 600 };

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const desiredWidth = Math.min(MAX_WIDTH, vw - PANEL_MARGIN);
  const maxAllowedWidth = Math.max(MIN_WIDTH, vw - EDGE_MARGIN * 2);
  const width = clamp(desiredWidth, MIN_WIDTH, maxAllowedWidth);

  const desiredHeight = vh - PANEL_MARGIN - topSafe;
  const maxAllowedHeight = Math.max(MIN_HEIGHT, vh - topSafe - EDGE_MARGIN);
  const height = clamp(desiredHeight, MIN_HEIGHT, maxAllowedHeight);

  return { width, height };
}

function computeDockFallbackPos(size: Size) {
  if (typeof window === "undefined") return { top: 80, left: 120 };

  const left = window.innerWidth - EDGE_MARGIN - size.width - DOCK_SAFE_RIGHT;
  const top = window.innerHeight - EDGE_MARGIN - size.height - DOCK_SAFE_BOTTOM;

  return { top, left };
}

function derivePosByBottomRight(
  prevPos: { top: number; left: number },
  prevSize: Size,
  nextSize: Size,
  minTop: number
) {
  const right = prevPos.left + prevSize.width;
  const bottom = prevPos.top + prevSize.height;

  const nextPos = {
    left: right - nextSize.width,
    top: bottom - nextSize.height,
  };

  return clampPanelPos(nextPos, nextSize, minTop);
}

/**
 * 외부 progressMap(videoId->progress%)을 섹션 비디오에 병합(호환 유지)
 */
function mergeExternalProgress(sections: UiSection[], progressMap?: VideoProgressMap): UiSection[] {
  if (!progressMap) return sections;

  return sections.map((s) => ({
    ...s,
    videos: s.videos.map((v) => {
      const ext = progressMap[v.id];
      if (ext === undefined) return v;
      const prev = v.progress ?? 0;
      return { ...v, progress: Math.max(prev, ext) };
    }),
  }));
}

function toUiVideo(v: EducationVideoItem): UiVideo {
  const p = typeof v.progressPercent === "number" ? clamp(v.progressPercent, 0, 100) : 0;
  const resume =
    typeof v.resumePositionSeconds === "number" ? Math.max(0, v.resumePositionSeconds) : undefined;

  return {
    id: v.id,
    title: v.title,
    videoUrl: v.fileUrl,
    progress: p,
    resumeSeconds: resume,
    completed: v.completed ?? (p >= 100 ? true : undefined),
  };
}

const EduPanel: React.FC<EduPanelProps> = ({
  anchor,
  onClose,
  onOpenQuizPanel,
  videoProgressMap,
  onUpdateVideoProgress,
  onRequestFocus,
  zIndex,
}) => {
  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";

  const initialTopSafe = hasDOM ? readAppHeaderSafeTop() : 0;
  const topSafeRef = useRef<number>(initialTopSafe);

  // ====== education list / videos cache ======
  const [educations, setEducations] = useState<EducationItem[]>([]);
  const [eduLoading, setEduLoading] = useState<boolean>(false);
  const [eduError, setEduError] = useState<string | null>(null);

  const [videosByEduId, setVideosByEduId] = useState<Record<string, VideoLoadState>>({});
  const videosByEduIdRef = useRef<Record<string, VideoLoadState>>({});
  useEffect(() => {
    videosByEduIdRef.current = videosByEduId;
  }, [videosByEduId]);

  const videosAbortRef = useRef<Map<string, AbortController>>(new Map());

  // ====== panel position/size ======
  const [size, setSize] = useState<Size>(() => createInitialSize(initialTopSafe));
  const [panelPos, setPanelPos] = useState(() => {
    const initialSize = createInitialSize(initialTopSafe);

    if (!hasDOM) return { top: 80, left: 120 };

    const pos = anchor ? computePanelPosition(anchor, initialSize) : computeDockFallbackPos(initialSize);
    return clampPanelPos(pos, initialSize, initialTopSafe);
  });

  const sizeRef = useRef<Size>(size);
  const posRef = useRef(panelPos);
  useEffect(() => {
    sizeRef.current = size;
    posRef.current = panelPos;
  }, [size, panelPos]);

  const resizeRef = useRef<ResizeState>({
    resizing: false,
    dir: null,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
    startTop: 0,
    startLeft: 0,
  });

  const dragRef = useRef<DragState>({
    dragging: false,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0,
  });

  // 섹션 페이징(educationId -> page)
  const [sectionPages, setSectionPages] = useState<Record<string, number>>({});

  /**
   * 교육 목록이 바뀌는 "시점"에만 섹션 페이지/비디오 캐시를 정리한다.
   * - useEffect 안에서 setState를 하면 eslint 규칙(react-hooks/set-state-in-effect)에 걸릴 수 있어
   *   목록 로드 성공 콜백에서만 호출한다.
   */
  const syncCachesForEducationList = useCallback((nextList: EducationItem[]) => {
    const nextIds = new Set(nextList.map((e) => e.id));

    // sectionPages: 존재하는 교육만 유지 + 신규는 0으로
    setSectionPages((prev) => {
      const next: Record<string, number> = {};
      for (const id of nextIds) next[id] = prev[id] ?? 0;
      return next;
    });

    // videosByEduId: 존재하는 교육만 유지 + 신규는 idle로
    setVideosByEduId((prev) => {
      const next: Record<string, VideoLoadState> = {};
      for (const id of nextIds) {
        next[id] = prev[id] ?? { status: "idle", videos: [] };
      }
      return next;
    });

    // 제거된 교육의 in-flight 요청 abort + ref cleanup
    const abortMap = videosAbortRef.current;
    for (const [id, controller] of abortMap.entries()) {
      if (!nextIds.has(id)) {
        controller.abort();
        abortMap.delete(id);
      }
    }
  }, []);

  // ====== watch state ======
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const selectedVideoRef = useRef<SelectedVideo | null>(null);
  useEffect(() => {
    selectedVideoRef.current = selectedVideo;
  }, [selectedVideo]);

  const listRestoreRef = useRef<{ size: Size; pos: { top: number; left: number } } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoDurationRef = useRef<number>(0);
  const maxWatchedTimeRef = useRef<number>(0);

  const [watchPercent, setWatchPercent] = useState<number>(0);
  const watchPercentRef = useRef<number>(0);
  useEffect(() => {
    watchPercentRef.current = watchPercent;
  }, [watchPercent]);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const roundedWatchPercent = Math.round(watchPercent);

  // ====== progress sending(throttle/flush/abort) ======
  const tickHandleRef = useRef<ReturnType<typeof window.setInterval> | null>(null);

  const lastTimeSampleRef = useRef<number | null>(null);
  const watchTimeAccumRef = useRef<number>(0);

  const progressAbortRef = useRef<AbortController | null>(null);
  const completedSentRef = useRef<boolean>(false);

  // =========================
  // 1) 교육 목록 로드
  // =========================
  useEffect(() => {
    if (!hasDOM) return;

    const ac = new AbortController();

    /**
     * eslint(react-hooks/set-state-in-effect) 대응:
     * - effect 본문에서 동기 setState 금지
     * - rAF(또는 setTimeout) 콜백으로 “외부 시스템 이벤트”처럼 처리
     */
    const raf = window.requestAnimationFrame(() => {
      setEduLoading(true);
      setEduError(null);
    });

    getMyEducations(undefined, { signal: ac.signal })
      .then((list) => {
        setEducations(list);

        // educations 목록이 "갱신되는 순간"에 캐시/페이지 상태 동기화
        syncCachesForEducationList(list);
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        console.warn("[EduPanel] getMyEducations failed", e);
        setEduError("교육 목록을 불러오지 못했습니다.");
      })
      .finally(() => setEduLoading(false));

    return () => {
      window.cancelAnimationFrame(raf);
      ac.abort();
    };
  }, [hasDOM, syncCachesForEducationList]);

  const ensureVideosLoaded = useCallback(async (educationId: string) => {
    const state = videosByEduIdRef.current[educationId];
    if (state && (state.status === "loading" || state.status === "ready")) return;

    // 기존 요청 abort 후 재시도
    const prev = videosAbortRef.current.get(educationId);
    if (prev) prev.abort();

    const ac = new AbortController();
    videosAbortRef.current.set(educationId, ac);

    setVideosByEduId((prevMap) => ({
      ...prevMap,
      [educationId]: { status: "loading", videos: prevMap[educationId]?.videos ?? [] },
    }));

    try {
      const list = await getEducationVideos(educationId, { signal: ac.signal });
      const videos = list.map(toUiVideo);

      setVideosByEduId((prevMap) => ({
        ...prevMap,
        [educationId]: { status: "ready", videos },
      }));
    } catch (e: unknown) {
      if (isAbortError(e)) return;
      console.warn("[EduPanel] getEducationVideos failed", e);

      setVideosByEduId((prevMap) => ({
        ...prevMap,
        [educationId]: {
          status: "error",
          videos: prevMap[educationId]?.videos ?? [],
          message: "영상 목록을 불러오지 못했습니다.",
        },
      }));
    }
  }, []);

  // 교육 목록이 준비되면: 전체 영상 목록을 백그라운드로 순차 로드
  useEffect(() => {
    if (!hasDOM) return;
    if (educations.length === 0) return;

    let cancelled = false;

    (async () => {
      for (const edu of educations) {
        if (cancelled) return;
        await ensureVideosLoaded(edu.id);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasDOM, educations, ensureVideosLoaded]);

  // =========================
  // 2) 섹션 모델 구성
  // =========================
  const sections: UiSection[] = useMemo(() => {
    const out: UiSection[] = educations.map((edu) => {
      const st = videosByEduId[edu.id] ?? { status: "idle", videos: [] };
      return {
        id: edu.id,
        title: edu.title,
        eduType: edu.eduType,
        completed: edu.completed,
        videos: st.videos,
      };
    });

    return mergeExternalProgress(out, videoProgressMap);
  }, [educations, videosByEduId, videoProgressMap]);

  // =========================
  // 3) 헤더 safe top 동기화(리사이즈/이동)
  // =========================
  useEffect(() => {
    if (!hasDOM) return;

    const updateTopSafe = () => {
      const next = readAppHeaderSafeTop();
      topSafeRef.current = next;

      const minTop = getMinTop(next);
      const curSize = sizeRef.current;
      const curPos = posRef.current;

      const clamped = clampPanelPos(curPos, curSize, minTop);
      if (clamped.top === curPos.top && clamped.left === curPos.left) return;

      window.requestAnimationFrame(() => {
        setPanelPos(clamped);
      });
    };

    updateTopSafe();
    window.addEventListener("resize", updateTopSafe);
    return () => window.removeEventListener("resize", updateTopSafe);
  }, [hasDOM]);

  // =========================
  // 4) 전역 드래그/리사이즈 핸들러
  // =========================
  useEffect(() => {
    if (!hasDOM) return;

    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      const minTop = getMinTop(topSafeRef.current);

      // 1) 리사이즈
      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        const maxWidth = Math.max(MIN_WIDTH, window.innerWidth);
        const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - minTop);

        const proposedWidthForW = resizeState.startWidth - dx;
        const proposedHeightForN = resizeState.startHeight - dy;

        if (resizeState.dir.includes("e")) newWidth = resizeState.startWidth + dx;
        if (resizeState.dir.includes("s")) newHeight = resizeState.startHeight + dy;

        if (resizeState.dir.includes("w")) {
          newWidth = proposedWidthForW;
          newLeft = resizeState.startLeft + dx;
        }
        if (resizeState.dir.includes("n")) {
          newHeight = proposedHeightForN;
          newTop = resizeState.startTop + dy;
        }

        const clampedWidth = clamp(newWidth, MIN_WIDTH, maxWidth);
        const clampedHeight = clamp(newHeight, MIN_HEIGHT, maxHeight);

        if (resizeState.dir.includes("w") && clampedWidth !== proposedWidthForW) {
          newLeft = resizeState.startLeft + (resizeState.startWidth - clampedWidth);
        }
        if (resizeState.dir.includes("n") && clampedHeight !== proposedHeightForN) {
          newTop = resizeState.startTop + (resizeState.startHeight - clampedHeight);
        }

        const nextSize = { width: clampedWidth, height: clampedHeight };
        const clampedPos = clampPanelPos({ top: newTop, left: newLeft }, nextSize, minTop);

        setSize(nextSize);
        setPanelPos(clampedPos);
        return;
      }

      // 2) 드래그
      if (dragState.dragging) {
        const currentSize = sizeRef.current;

        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        const nextPos = {
          top: dragState.startTop + dy,
          left: dragState.startLeft + dx,
        };

        const clampedPos = clampPanelPos(nextPos, currentSize, minTop);
        setPanelPos(clampedPos);
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
  }, [hasDOM]);

  const handleResizeMouseDown =
    (dir: ResizeDirection) => (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const currentPos = posRef.current;
      const currentSize = sizeRef.current;

      resizeRef.current = {
        resizing: true,
        dir,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: currentSize.width,
        startHeight: currentSize.height,
        startTop: currentPos.top,
        startLeft: currentPos.left,
      };
      dragRef.current.dragging = false;
      onRequestFocus?.();
    };

  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const currentPos = posRef.current;

    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: currentPos.top,
      startLeft: currentPos.left,
    };
    resizeRef.current.resizing = false;
    resizeRef.current.dir = null;
    onRequestFocus?.();
  };

  // =========================
  // 5) progress send helpers
  // =========================
  const stopTick = useCallback(() => {
    if (tickHandleRef.current) {
      window.clearInterval(tickHandleRef.current);
      tickHandleRef.current = null;
    }
  }, []);

  const abortInFlightProgress = useCallback(() => {
    if (progressAbortRef.current) {
      progressAbortRef.current.abort();
      progressAbortRef.current = null;
    }
  }, []);

  const syncProgressToParent = useCallback(
    (videoId: string, progressPercent: number, resumeSeconds: number, completed: boolean) => {
      onUpdateVideoProgress?.(videoId, progressPercent, resumeSeconds, completed);
    },
    [onUpdateVideoProgress]
  );

  const patchLocalVideoProgress = useCallback(
    (
      educationId: string,
      videoId: string,
      nextProgressPercent?: number,
      nextResumeSeconds?: number,
      eduCompleted?: boolean,
      videoCompleted?: boolean
    ) => {
      if (eduCompleted !== undefined) {
        setEducations((prev) =>
          prev.map((e) => (e.id === educationId ? { ...e, completed: eduCompleted } : e))
        );
      }

      if (
        nextProgressPercent === undefined &&
        nextResumeSeconds === undefined &&
        videoCompleted === undefined
      )
        return;

      setVideosByEduId((prev) => {
        const st = prev[educationId];
        if (!st) return prev;

        const videos = st.videos.map((v) => {
          if (v.id !== videoId) return v;

          const p =
            typeof nextProgressPercent === "number"
              ? clamp(nextProgressPercent, 0, 100)
              : v.progress ?? 0;

          const resume =
            typeof nextResumeSeconds === "number" ? Math.max(0, nextResumeSeconds) : v.resumeSeconds;
          const completed = videoCompleted ?? v.completed ?? p >= 100;

          return { ...v, progress: p, resumeSeconds: resume, completed };
        });

        return { ...prev, [educationId]: { ...st, videos } };
      });
    },
    []
  );

  const getResumeSeconds = useCallback(() => {
    const v = videoRef.current;
    if (!v) return 0;
    const t = maxWatchedTimeRef.current > 0 ? maxWatchedTimeRef.current : v.currentTime;
    return Math.max(0, Math.floor(t));
  }, []);

  const flushProgress = useCallback(
    async (opts?: { force?: boolean; keepalive?: boolean }) => {
      const sel = selectedVideoRef.current;
      const v = videoRef.current;
      if (!sel || !v) return;

      const watchTime = Math.round(watchTimeAccumRef.current);
      if (!opts?.force && watchTime < 1) return;

      const position = Math.max(0, Math.floor(v.currentTime));

      // 최신 상태 우선: 이전 in-flight는 abort
      abortInFlightProgress();
      const ac = new AbortController();
      progressAbortRef.current = ac;

      try {
        const res = await postEduVideoProgress(
          sel.educationId,
          sel.id,
          { position, watchTime },
          { signal: ac.signal, keepalive: opts?.keepalive }
        );

        // 성공 시에만 누적 watchTime 리셋
        watchTimeAccumRef.current = 0;

        const nextProgress =
          typeof res?.progressPercent === "number" ? res.progressPercent : undefined;
        const nextResume =
          typeof res?.resumePositionSeconds === "number" ? res.resumePositionSeconds : position;

        const videoCompleted =
          typeof res?.videoCompleted === "boolean"
            ? res.videoCompleted
            : nextProgress !== undefined
              ? nextProgress >= 100
              : undefined;

        const eduCompleted = typeof res?.eduCompleted === "boolean" ? res.eduCompleted : undefined;

        // 상위 호환 업데이트
        if (nextProgress !== undefined) {
          syncProgressToParent(sel.id, clamp(nextProgress, 0, 100), nextResume, Boolean(videoCompleted));
        } else {
          const localPercent = clamp(Math.round(watchPercentRef.current), 0, 100);
          syncProgressToParent(sel.id, localPercent, nextResume, localPercent >= 100);
        }

        patchLocalVideoProgress(sel.educationId, sel.id, nextProgress, nextResume, eduCompleted, videoCompleted);
      } catch (e: unknown) {
        if (isAbortError(e)) return;
        console.warn("[EduPanel] postEduVideoProgress failed", e);
        // 실패 시 watchTime 누적은 유지(다음 tick에서 재시도)
      }
    },
    [abortInFlightProgress, patchLocalVideoProgress, syncProgressToParent]
  );

  const startTick = useCallback(() => {
    if (tickHandleRef.current) return;
    tickHandleRef.current = window.setInterval(() => {
      void flushProgress({ force: false });
    }, PROGRESS_TICK_MS);
  }, [flushProgress]);

  // =========================
  // 6) list interactions
  // =========================
  const handlePrevClick = (sectionId: string) => {
    setSectionPages((prev) => {
      const pageSize = getPageSize(sizeRef.current.width);
      const section = sections.find((s) => s.id === sectionId);
      if (!section) return prev;

      const maxPage = Math.max(0, Math.ceil(section.videos.length / pageSize) - 1);
      const current = Math.min(prev[sectionId] ?? 0, maxPage);
      const nextPage = Math.max(0, current - 1);
      return { ...prev, [sectionId]: nextPage };
    });
  };

  const handleNextClick = (sectionId: string) => {
    setSectionPages((prev) => {
      const pageSize = getPageSize(sizeRef.current.width);
      const section = sections.find((s) => s.id === sectionId);
      if (!section) return prev;

      const maxPage = Math.max(0, Math.ceil(section.videos.length / pageSize) - 1);
      const current = Math.min(prev[sectionId] ?? 0, maxPage);
      const nextPage = Math.min(maxPage, current + 1);
      return { ...prev, [sectionId]: nextPage };
    });
  };

  const handleVideoClick = (educationId: string, educationTitle: string, video: UiVideo) => {
    if (!video.videoUrl) return;

    listRestoreRef.current = { size: sizeRef.current, pos: posRef.current };

    const base = clamp(video.progress ?? 0, 0, 100);

    setSelectedVideo({
      ...video,
      educationId,
      educationTitle,
      progress: base,
    });

    setWatchPercent(base);
    completedSentRef.current = base >= 100;

    // watch tracking reset
    maxWatchedTimeRef.current = 0;
    videoDurationRef.current = 0;
    watchTimeAccumRef.current = 0;
    lastTimeSampleRef.current = null;
    setIsPlaying(false);

    const prevPos = posRef.current;
    const prevSize = sizeRef.current;
    const nextSize = WATCH_DEFAULT_SIZE;

    const minTop = getMinTop(topSafeRef.current);
    setSize(nextSize);
    setPanelPos(derivePosByBottomRight(prevPos, prevSize, nextSize, minTop));
  };

  // =========================
  // 7) video events (seek/resume + watchTime accumulate)
  // =========================
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;

    const duration = v.duration || 0;
    videoDurationRef.current = duration;

    const basePercent = selectedVideo?.progress ?? 0;
    const resumeSeconds = selectedVideo?.resumeSeconds;

    let startTime = 0;
    if (typeof resumeSeconds === "number" && resumeSeconds > 0) {
      startTime = resumeSeconds;
    } else if (duration > 0) {
      startTime = duration * (basePercent / 100);
    }

    startTime = Math.max(0, Math.min(duration || startTime, startTime));

    try {
      v.currentTime = startTime;
    } catch {
      // ignore
    }

    maxWatchedTimeRef.current = startTime;
    lastTimeSampleRef.current = startTime;

    setWatchPercent(basePercent);
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    const duration = videoDurationRef.current;
    if (!v || !duration) return;

    const current = v.currentTime;

    // 누적 watchTime: "재생으로 인한 증가"만 반영(큰 점프는 seek로 간주)
    if (!v.paused && !v.ended && isPlaying) {
      const prev = lastTimeSampleRef.current;
      if (typeof prev === "number") {
        const delta = current - prev;
        if (delta > 0 && delta <= 2.5) watchTimeAccumRef.current += delta;
      }
      lastTimeSampleRef.current = current;
    } else {
      lastTimeSampleRef.current = current;
    }

    // 진행률: 최대 시청 위치 기반(되감기 방지)
    const newMax = Math.max(maxWatchedTimeRef.current, current);
    maxWatchedTimeRef.current = newMax;

    const newPercent = Math.min(100, (newMax / duration) * 100);

    setWatchPercent((prev) => {
      const next = newPercent > prev ? newPercent : prev;

      // 100% 달성 1회 처리(상위 상태만)
      if (selectedVideo && !completedSentRef.current && Math.round(next) >= 100) {
        completedSentRef.current = true;
        const resume = getResumeSeconds();
        syncProgressToParent(selectedVideo.id, 100, resume, true);
        patchLocalVideoProgress(selectedVideo.educationId, selectedVideo.id, 100, resume, undefined, true);
      }

      return next;
    });
  };

  const handleEnded = () => {
    setIsPlaying(false);
    stopTick();

    void flushProgress({ force: true });

    const duration = videoDurationRef.current || videoRef.current?.duration || 0;
    if (duration > 0) {
      maxWatchedTimeRef.current = duration;
      setWatchPercent(100);

      if (selectedVideo && !completedSentRef.current) {
        completedSentRef.current = true;
        const resume = Math.floor(duration);
        syncProgressToParent(selectedVideo.id, 100, resume, true);
        patchLocalVideoProgress(selectedVideo.educationId, selectedVideo.id, 100, resume, undefined, true);
      }
    }
  };

  const handlePlayPause = () => {
    const v = videoRef.current;
    if (!v) return;

    if (v.paused || v.ended) {
      void v.play();
      setIsPlaying(true);
      startTick();
    } else {
      v.pause();
      setIsPlaying(false);
      stopTick();
      void flushProgress({ force: true });
    }
  };

  const handleGoToQuiz = () => {
    if (!selectedVideo) return;
    if (!onOpenQuizPanel) return;
    if (roundedWatchPercent < 100) return;

    void flushProgress({ force: true });
    onOpenQuizPanel(selectedVideo.educationId);
  };

  const resetWatchState = () => {
    abortInFlightProgress();
    stopTick();

    videoDurationRef.current = 0;
    maxWatchedTimeRef.current = 0;
    watchTimeAccumRef.current = 0;
    lastTimeSampleRef.current = null;

    setWatchPercent(0);
    setIsPlaying(false);
    completedSentRef.current = false;
  };

  const handleBackToList = () => {
    if (selectedVideo) {
      videoRef.current?.pause();
      setIsPlaying(false);
      stopTick();
      void flushProgress({ force: true });
    }

    setSelectedVideo(null);
    resetWatchState();

    const restore = listRestoreRef.current;
    const minTop = getMinTop(topSafeRef.current);

    if (restore) {
      setSize(restore.size);
      setPanelPos(clampPanelPos(restore.pos, restore.size, minTop));
      return;
    }

    const listSize = createInitialSize(topSafeRef.current);
    setSize(listSize);

    if (hasDOM) {
      const pos = anchor ? computePanelPosition(anchor, listSize) : computeDockFallbackPos(listSize);
      setPanelPos(clampPanelPos(pos, listSize, minTop));
    } else {
      setPanelPos({ top: 80, left: 120 });
    }
  };

  const handleCloseClick = () => {
    if (selectedVideo) {
      videoRef.current?.pause();
      setIsPlaying(false);
      stopTick();
      void flushProgress({ force: true, keepalive: true });
    }

    const abortMap = videosAbortRef.current;
    for (const [, c] of abortMap.entries()) c.abort();
    abortMap.clear();

    onClose();
  };

  // 언마운트 cleanup
  useEffect(() => {
    const abortMap = videosAbortRef.current;
    return () => {
      stopTick();
      for (const [, c] of abortMap.entries()) c.abort();
      abortMap.clear();
    };
  }, [stopTick]);

  if (!hasDOM) return null;

  return createPortal(
    <div
      className="cb-edu-wrapper"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: zIndex ?? EDU_LAYER_Z,
        pointerEvents: "none",
      }}
    >
      <div
        className="cb-edu-panel-container"
        style={{
          position: "fixed",
          top: panelPos.top,
          left: panelPos.left,
          pointerEvents: "auto",
        }}
      >
        <div
          className="cb-edu-panel cb-chatbot-panel"
          style={{ width: size.width, height: size.height }}
          onMouseDown={() => onRequestFocus?.()}
        >
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

          <button
            type="button"
            className="cb-panel-close-btn cb-edu-close-btn"
            onClick={handleCloseClick}
            aria-label="교육 영상 창 닫기"
          >
            ✕
          </button>

          <div className="cb-edu-panel-inner">
            {selectedVideo ? (
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
                      src={selectedVideo.videoUrl}
                      ref={videoRef}
                      onLoadedMetadata={handleLoadedMetadata}
                      onTimeUpdate={handleTimeUpdate}
                      onEnded={handleEnded}
                      onClick={handlePlayPause}
                      controls={false}
                      playsInline
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      브라우저가 비디오 태그를 지원하지 않습니다.
                    </video>

                    <div className="cb-edu-watch-overlay">
                      <button
                        type="button"
                        className="cb-edu-watch-play-btn"
                        onClick={handlePlayPause}
                        aria-label={isPlaying ? "일시정지" : "재생"}
                      >
                        <span className="cb-edu-watch-play-icon">{isPlaying ? "❚❚" : "▶"}</span>
                      </button>
                      <span className="cb-edu-watch-progress-text">시청률 {roundedWatchPercent}%</span>
                    </div>
                  </div>

                  <div className="cb-edu-watch-footer">
                    {onOpenQuizPanel ? (
                      <button
                        type="button"
                        className={"cb-edu-watch-quiz-btn" + (roundedWatchPercent >= 100 ? " is-active" : "")}
                        onClick={handleGoToQuiz}
                        disabled={roundedWatchPercent < 100}
                      >
                        퀴즈 풀기
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <header className="cb-edu-header">
                  <h2 className="cb-edu-title">교육 영상</h2>
                </header>

                <div className="cb-edu-body">
                  {eduLoading ? (
                    <div className="cb-edu-empty">
                      <div className="cb-edu-empty-title">교육 목록을 불러오는 중…</div>
                    </div>
                  ) : eduError ? (
                    <div className="cb-edu-empty">
                      <div className="cb-edu-empty-title">{eduError}</div>
                      <div className="cb-edu-empty-desc">education-service가 실행 중인지 확인해 주세요.</div>
                    </div>
                  ) : educations.length === 0 ? (
                    <div className="cb-edu-empty">
                      <div className="cb-edu-empty-title">표시할 교육이 없습니다.</div>
                      <div className="cb-edu-empty-desc">배정된 교육이 있으면 이 화면에 표시됩니다.</div>
                    </div>
                  ) : (
                    <div className="cb-edu-sections">
                      {sections.map((section) => {
                        const pageSize = getPageSize(size.width);

                        const st = videosByEduId[section.id];
                        const status: VideoLoadState["status"] = st?.status ?? "idle";
                        const videos = section.videos;

                        const maxPage = Math.max(0, Math.ceil(videos.length / pageSize) - 1);
                        const currentPage = Math.min(sectionPages[section.id] ?? 0, maxPage);

                        const start = currentPage * pageSize;
                        const visibleVideos = videos.slice(start, start + pageSize);

                        const canPrev = currentPage > 0;
                        const canNext = currentPage < maxPage;

                        const showLoading = status === "loading" || status === "idle";
                        const showError = status === "error";
                        const errorMessage =
                          st && st.status === "error" ? st.message : "영상 목록을 불러오지 못했습니다.";

                        return (
                          <section key={section.id} className="cb-edu-section">
                            <h3 className="cb-edu-section-title">
                              {section.title}
                              {section.completed ? (
                                <span className="cb-edu-status cb-edu-status-completed" style={{ marginLeft: 8 }}>
                                  이수완료
                                </span>
                              ) : null}
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
                                {showError ? (
                                  <div className="cb-edu-empty">
                                    <div className="cb-edu-empty-title">{errorMessage}</div>
                                    <button
                                      type="button"
                                      className="cb-edu-watch-quiz-btn is-active"
                                      style={{ marginTop: 10 }}
                                      onClick={() => void ensureVideosLoaded(section.id)}
                                    >
                                      다시 시도
                                    </button>
                                  </div>
                                ) : showLoading ? (
                                  <div className="cb-edu-empty">
                                    <div className="cb-edu-empty-title">영상 목록을 불러오는 중…</div>
                                  </div>
                                ) : visibleVideos.length === 0 ? (
                                  <div className="cb-edu-empty">
                                    <div className="cb-edu-empty-title">등록된 영상이 없습니다.</div>
                                    <div className="cb-edu-empty-desc">이 교육에 게시된 영상이 없습니다.</div>
                                  </div>
                                ) : (
                                  visibleVideos.map((video) => {
                                    const progress = clamp(video.progress ?? 0, 0, 100);
                                    const { label, key } = getVideoStatus(progress);
                                    const canPlay = Boolean(video.videoUrl);

                                    return (
                                      <article key={video.id} className="cb-edu-video-card" aria-label={video.title}>
                                        <button type="button" className="cb-edu-video-close" aria-label="영상 제거" disabled>
                                          ✕
                                        </button>

                                        <div
                                          className={
                                            "cb-edu-video-thumbnail cb-edu-video-thumbnail-clickable" +
                                            (canPlay ? "" : " is-disabled")
                                          }
                                          onClick={() => {
                                            if (!canPlay) return;
                                            handleVideoClick(section.id, section.title, video);
                                          }}
                                          role="button"
                                          tabIndex={0}
                                          onKeyDown={(e) => {
                                            if (!canPlay) return;
                                            if (e.key === "Enter" || e.key === " ") {
                                              e.preventDefault();
                                              handleVideoClick(section.id, section.title, video);
                                            }
                                          }}
                                        >
                                          {canPlay ? (
                                            <>
                                              <video
                                                className="cb-edu-video-thumbnail-video"
                                                src={video.videoUrl}
                                                muted
                                                preload="metadata"
                                                playsInline
                                                aria-hidden="true"
                                              />
                                              <div className="cb-edu-video-play-circle">
                                                <span className="cb-edu-video-play-icon">▶</span>
                                              </div>
                                            </>
                                          ) : (
                                            <div className="cb-edu-empty" style={{ height: "100%" }}>
                                              <div className="cb-edu-empty-title">파일 준비중</div>
                                            </div>
                                          )}
                                        </div>

                                        <div className="cb-edu-video-progress">
                                          <div className="cb-edu-video-progress-track">
                                            <div className="cb-edu-video-progress-fill" style={{ width: `${progress}%` }} />
                                          </div>
                                          <div className="cb-edu-video-meta">
                                            <span className="cb-edu-progress-text">시청률 {progress}%</span>
                                            <span className={`cb-edu-status cb-edu-status-${key}`}>{label}</span>
                                          </div>
                                        </div>
                                      </article>
                                    );
                                  })
                                )}
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
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default EduPanel;
