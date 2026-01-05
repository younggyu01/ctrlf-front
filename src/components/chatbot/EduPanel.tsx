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
  resolveEducationVideoUrl,
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

import type { PlayEducationVideoParams } from "../../types/chat";

type VideoProgressMap = Record<string, number>;

export interface EduPanelProps {
  anchor?: Anchor | null;
  onClose: () => void;

  onOpenQuizPanel?: (eduId?: string) => void;

  videoProgressMap?: VideoProgressMap;

  onUpdateVideoProgress?: (
    videoId: string,
    progressPercent: number,
    resumeSeconds?: number,
    completed?: boolean
  ) => void;

  onRequestFocus?: () => void;
  zIndex?: number;

  /** 자동 재생할 교육 영상 정보 (AI 챗봇에서 전달) */
  initialVideo?: PlayEducationVideoParams;

  /** initialVideo 처리 완료 후 호출 */
  onInitialVideoConsumed?: () => void;
}

const ALLOW_OVERLAP_APP_HEADER = true;

const MIN_WIDTH = 520;
const MIN_HEIGHT = 480;

const MAX_WIDTH = 1360;
const PANEL_MARGIN = 80;

const WATCH_DEFAULT_SIZE: Size = { width: 540, height: 480 };

const EDGE_MARGIN = 0;

const KEEP_VISIBLE_X = 120;
const KEEP_VISIBLE_Y = 80;

const DOCK_SAFE_RIGHT = 60;
const DOCK_SAFE_BOTTOM = 60;

const EDU_LAYER_Z = 2147483000;

const PROGRESS_TICK_MS = 15_000;

// fetchJson이 내부에서 pending에 빠져도 UI가 무한 로딩에 갇히지 않도록 패널 레벨 타임아웃
const EDU_LIST_TIMEOUT_MS = 4_500;
const EDU_VIDEOS_TIMEOUT_MS = 4_500;

function isTimeoutError(e: unknown): boolean {
  if (!e) return false;
  if (e instanceof Error) return (e.message ?? "").startsWith("TIMEOUT:");
  if (typeof e === "object") {
    const rec = e as Record<string, unknown>;
    const msg = typeof rec.message === "string" ? rec.message : "";
    return msg.startsWith("TIMEOUT:");
  }
  return false;
}

/**
 * Promise가 영원히 pending이면 ms 후 강제로 reject
 * - onTimeout에서 AbortController.abort()를 호출해 실제 fetch도 끊을 수 있게 함
 * - fetchJson이 fetch 이전 단계에서 멈춰도 race로 UI는 탈출 가능
 */
function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  onTimeout?: () => void
): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;

  const timeoutP = new Promise<never>((_, reject) => {
    t = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new Error(`TIMEOUT:${ms}`));
      }
    }, ms);
  });

  return Promise.race([p, timeoutP]).finally(() => {
    if (t !== null) clearTimeout(t);
  });
}

// 앞으로 점프(seek forward) 허용치(초) — 너무 빡빡하면 UX가 깨질 수 있어 약간 둠
const SEEK_FORWARD_TOLERANCE_SEC = 1.25;

/**
 * resumePositionSeconds가 백엔드/저장 계층에서 ms로 들어오거나(예: 50123),
 * duration보다 큰 값으로 내려오는 케이스를 방어한다.
 * - duration보다 약간 큰 값(오차)까지는 clamp
 * - duration보다 많이 크면 ms로 가정하고 /1000 변환을 시도
 */
function normalizeResumeSeconds(raw: number, durationSec: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;

  // duration이 유효하면 범위를 보고 ms 여부를 더 정확히 판단
  if (Number.isFinite(durationSec) && durationSec > 0) {
    const hardMax = durationSec + 10; // 오차 허용

    // 정상 초 단위로 보이는 범위
    if (raw <= hardMax) return clamp(raw, 0, durationSec);

    // duration 대비 과도하게 크면(ms 가능성 높음) /1000 시도
    if (raw > durationSec * 10) {
      const sec = raw / 1000;
      if (sec <= hardMax) return clamp(sec, 0, durationSec);
    }
  }

  // duration이 없거나 판단 불가: 휴리스틱
  // 6시간(21600초)보다 큰 값은 ms일 확률이 높다고 보고 /1000
  if (raw > 60 * 60 * 6) return raw / 1000;

  return raw;
}

function readNumberField<T extends object>(obj: T, key: string): number | undefined {
  const v = (obj as unknown as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function readBoolField<T extends object>(obj: T, key: string): boolean | undefined {
  const v = (obj as unknown as Record<string, unknown>)[key];
  return typeof v === "boolean" ? v : undefined;
}

function progressFromResumeSeconds(resumeSec: number, durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  if (!Number.isFinite(resumeSec) || resumeSec <= 0) return 0;
  return clamp((resumeSec / durationSec) * 100, 0, 100);
}

function normalizeCompletedFlag(progressPercent: number, completed?: boolean): boolean {
  if (completed === true) return true;
  return progressPercent >= 100;
}

type EduVideoStatusKey = "not-started" | "in-progress" | "completed";

type UiVideo = {
  id: string;
  title: string;
  videoUrl?: string; // 원본(or 이미 playable인) URL

  // 목록에서도 resumeSeconds -> % 정규화가 가능해짐
  durationSeconds?: number;

  // progress는 “표시용 %”로 통일(= resumeSeconds 기반으로 정규화된 값)
  progress?: number; // 0..100

  // 이어보기 초(정규화된 값)
  resumeSeconds?: number;

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
  rawVideoUrl: string;
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
  // 서버 필드 케이스 대응:
  // - progressPercent (동일)
  // - durationSeconds | duration
  // - resumePositionSeconds | resumePosition
  // - completed | isCompleted
  const pRaw = readNumberField(v, "progressPercent") ?? 0;
  const p = clamp(pRaw, 0, 100);

  const durationSec =
    readNumberField(v, "durationSeconds") ??
    readNumberField(v, "duration") ??
    undefined;

  const resumeRaw =
    readNumberField(v, "resumePositionSeconds") ??
    readNumberField(v, "resumePosition") ??
    undefined;

  const completedRaw =
    readBoolField(v, "completed") ??
    readBoolField(v, "isCompleted") ??
    undefined;

  const completed = normalizeCompletedFlag(p, completedRaw);

  // resumeSeconds 정규화(초/ms 혼입 방어) + 완료면 duration으로 정리
  let resumeSeconds: number | undefined = undefined;
  if (typeof resumeRaw === "number") {
    if (typeof durationSec === "number" && durationSec > 0) {
      resumeSeconds = normalizeResumeSeconds(resumeRaw, durationSec);
    } else {
      resumeSeconds = Math.max(0, resumeRaw);
    }
  }

  if (completed && typeof durationSec === "number" && durationSec > 0) {
    resumeSeconds = durationSec;
  }

  // 표시용 progress는 “항상 resumeSeconds 기반”으로 통일(가능할 때)
  // - duration/resume가 없으면 서버 progressPercent fallback
  // - 완료면 무조건 100
  let progress = p;
  if (completed) {
    progress = 100;
  } else if (typeof durationSec === "number" && durationSec > 0 && typeof resumeSeconds === "number") {
    progress = progressFromResumeSeconds(resumeSeconds, durationSec);
  }

  return {
    id: v.id,
    title: v.title,
    videoUrl: (v as unknown as { fileUrl?: string }).fileUrl, // 기존 코드 유지 목적(필드명)
    durationSeconds: durationSec,
    progress,
    resumeSeconds,
    completed,
  };
}

function isSectionDone(section: UiSection): boolean {
  if (section.completed) return true;
  if (!section.videos || section.videos.length === 0) return false;
  return section.videos.every((v) => Boolean(v.completed) || (v.progress ?? 0) >= 100);
}

// “playable URL 판별”
function isPlayableUrl(url: string): boolean {
  const s = (url ?? "").trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (s.startsWith("/")) return true; // same-origin relative
  if (s.startsWith("blob:") || s.startsWith("data:")) return true;
  return false;
}

/**
 * presign URL은 만료된다.
 * - educationServiceApi.ts 내부에서도 objectKey 기준 캐시를 하지만,
 * EduPanel이 raw→url을 “무기한 캐시”하면 만료 URL을 재사용할 수 있음.
 * - 그래서 EduPanel 캐시는 TTL을 둔다(보수적으로 8분).
 */
const PRESIGN_UI_CACHE_MS = 8 * 60 * 1000;
const PRESIGN_UI_SAFETY_MS = 25_000;

type PresignState =
  | { status: "idle" }
  | { status: "resolving" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

function getCachedUrl(
  m: Map<string, { url: string; expiresAtMs: number }>,
  raw: string
): string | undefined {
  const now = Date.now();
  const hit = m.get(raw);
  if (!hit) return undefined;
  if (hit.expiresAtMs - now <= PRESIGN_UI_SAFETY_MS) {
    m.delete(raw);
    return undefined;
  }
  return hit.url;
}

/**
 * 최소 토스트 구현 (외부 의존 없이 패널 내부에서만 표시)
 * - 스팸 방지를 위해 key별 쿨다운 적용
 */
type ToastVariant = "info" | "success" | "warn" | "error";
type ToastItem = { id: string; message: string; variant: ToastVariant };

function nowMs() {
  return Date.now();
}
function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const EduPanel: React.FC<EduPanelProps> = ({
  anchor,
  onClose,
  onOpenQuizPanel,
  videoProgressMap,
  onUpdateVideoProgress,
  onRequestFocus,
  zIndex,
  initialVideo,
  onInitialVideoConsumed,
}) => {
  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";

  const initialTopSafe = hasDOM ? readAppHeaderSafeTop() : 0;
  const topSafeRef = useRef<number>(initialTopSafe);

  const [educations, setEducations] = useState<EducationItem[]>([]);
  const [eduLoading, setEduLoading] = useState<boolean>(false);
  const [eduError, setEduError] = useState<string | null>(null);
  const [eduReloadKey, setEduReloadKey] = useState<number>(0);

  const [videosByEduId, setVideosByEduId] = useState<Record<string, VideoLoadState>>({});
  const videosByEduIdRef = useRef<Record<string, VideoLoadState>>({});

  useEffect(() => {
    videosByEduIdRef.current = videosByEduId;
  }, [videosByEduId]);

  const videosAbortRef = useRef<Map<string, AbortController>>(new Map());

  const [size, setSize] = useState<Size>(() => createInitialSize(initialTopSafe));
  const [panelPos, setPanelPos] = useState(() => {
    const initialSize = createInitialSize(initialTopSafe);

    if (!hasDOM) return { top: 80, left: 120 };

    const pos = anchor
      ? computePanelPosition(anchor, initialSize)
      : computeDockFallbackPos(initialSize);
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

  const [sectionPages, setSectionPages] = useState<Record<string, number>>({});

  const syncCachesForEducationList = useCallback((nextList: EducationItem[]) => {
    const nextIds = new Set(nextList.map((e) => e.id));

    setSectionPages((prev) => {
      const next: Record<string, number> = {};
      for (const id of nextIds) next[id] = prev[id] ?? 0;
      return next;
    });

    setVideosByEduId((prev) => {
      const next: Record<string, VideoLoadState> = {};
      for (const edu of nextList) {
        const id = edu.id;

        const embedded = Array.isArray(edu.videos) ? edu.videos.map(toUiVideo) : [];
        const hasEmbedded = embedded.length > 0;

        const existing = prev[id];

        if (hasEmbedded) {
          if (existing?.status === "ready" && existing.videos.length > 0) {
            next[id] = existing;
          } else {
            next[id] = { status: "ready", videos: embedded };
          }
        } else {
          next[id] = existing ?? { status: "idle", videos: [] };
        }
      }

      videosByEduIdRef.current = next;

      return next;
    });

    const abortMap = videosAbortRef.current;
    for (const [id, controller] of abortMap.entries()) {
      if (!nextIds.has(id)) {
        controller.abort();
        abortMap.delete(id);
      }
    }
  }, []);

  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const selectedVideoRef = useRef<SelectedVideo | null>(null);
  useEffect(() => {
    selectedVideoRef.current = selectedVideo;
  }, [selectedVideo]);

  const listRestoreRef = useRef<{ size: Size; pos: { top: number; left: number } } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoDurationRef = useRef<number>(0);
  const maxWatchedTimeRef = useRef<number>(0);

  // programmatic seek(복원/초기화) 구간에서는 seek-guard를 잠깐 해제
  const allowProgrammaticSeekRef = useRef<boolean>(false);

  const [watchPercent, setWatchPercent] = useState<number>(0);
  const watchPercentRef = useRef<number>(0);
  useEffect(() => {
    watchPercentRef.current = watchPercent;
  }, [watchPercent]);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const roundedWatchPercent = Math.round(watchPercent);

  const tickHandleRef = useRef<ReturnType<typeof window.setInterval> | null>(null);

  const lastTimeSampleRef = useRef<number | null>(null);
  const watchTimeAccumRef = useRef<number>(0);

  const progressAbortRef = useRef<AbortController | null>(null);

  /**
   * 완료 관련:
   * - completedSentRef: "서버(또는 서버 결과 기반)로 완료 확정된 상태"로 취급
   * - completeRequestPosRef: 완료 플러시 요청을 중복으로 날리지 않기 위한 마지막 요청 position(초)
   */
  const completedSentRef = useRef<boolean>(false);
  const completeRequestPosRef = useRef<number | null>(null);

  // =========================
  // progress 저장 상태(Watch UI 표시용)
  // =========================
  type SaveStatus = "idle" | "saving" | "saved" | "error";
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSaveTimer = useCallback(() => {
    if (saveStatusTimerRef.current) {
      clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }
  }, []);

  const setSaveStatusTransient = useCallback(
    (status: SaveStatus, backToIdleMs: number) => {
      setSaveStatus(status);
      clearSaveTimer();
      saveStatusTimerRef.current = setTimeout(() => {
        setSaveStatus("idle");
      }, backToIdleMs);
    },
    [clearSaveTimer]
  );

  // =========================
  // toast state
  // =========================
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const toastCooldownRef = useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const tm = toastTimersRef.current.get(id);
    if (tm) clearTimeout(tm);
    toastTimersRef.current.delete(id);
  }, []);

  const pushToast = useCallback(
    (message: string, variant: ToastVariant = "info", ttlMs = 2400) => {
      const id = uid();
      setToasts((prev) => {
        const next = [...prev, { id, message, variant }];
        // 너무 길어지면 최근 4개만 유지
        return next.slice(-4);
      });

      const tm = setTimeout(() => removeToast(id), ttlMs);
      toastTimersRef.current.set(id, tm);
    },
    [removeToast]
  );

  const pushToastOnce = useCallback(
    (key: string, message: string, variant: ToastVariant, cooldownMs: number) => {
      const last = toastCooldownRef.current.get(key) ?? 0;
      const n = nowMs();
      if (n - last < cooldownMs) return;
      toastCooldownRef.current.set(key, n);
      pushToast(message, variant);
    },
    [pushToast]
  );

  // unmount cleanup
  useEffect(() => {
    // eslint react-hooks/exhaustive-deps 경고 방지: cleanup에서 ref.current 직접 참조하지 않도록 캡처
    const toastTimers = toastTimersRef.current;
    const toastCooldown = toastCooldownRef.current;

    return () => {
      for (const [, tm] of toastTimers.entries()) clearTimeout(tm);
      toastTimers.clear();
      toastCooldown.clear();
      clearSaveTimer();
    };
  }, [clearSaveTimer]);

  // =========================
  // presign 결과 캐시/상태 + resolve 제어 state/ref
  // =========================
  const presignCacheRef = useRef<Map<string, { url: string; expiresAtMs: number }>>(new Map()); // rawUrl -> playableUrl(+ttl)
  const presignInFlightRef = useRef<Map<string, Promise<string>>>(new Map()); // rawUrl -> promise
  const presignAbortByRawRef = useRef<Map<string, AbortController>>(new Map()); // rawUrl -> controller

  const [presignByVideoId, setPresignByVideoId] = useState<Record<string, PresignState>>({});
  const presignByVideoIdRef = useRef<Record<string, PresignState>>({});
  useEffect(() => {
    presignByVideoIdRef.current = presignByVideoId;
  }, [presignByVideoId]);

  const watchResolvingRawRef = useRef<string | null>(null);

  const setPresignState = useCallback((videoId: string, next: PresignState) => {
    setPresignByVideoId((prev) => ({ ...prev, [videoId]: next }));
  }, []);

  const abortWatchResolve = useCallback(() => {
    const raw = watchResolvingRawRef.current;
    if (!raw) return;

    const ac = presignAbortByRawRef.current.get(raw);
    if (ac) ac.abort();

    presignAbortByRawRef.current.delete(raw);
    watchResolvingRawRef.current = null;
  }, []);

  const abortAllResolves = useCallback(() => {
    for (const [, ac] of presignAbortByRawRef.current.entries()) ac.abort();
    presignAbortByRawRef.current.clear();
    presignInFlightRef.current.clear();
    watchResolvingRawRef.current = null;
  }, []);

  const getKnownPlayableUrl = useCallback((videoId: string, rawUrl: string): string | undefined => {
    const raw = (rawUrl ?? "").trim();
    if (!raw) return undefined;

    const st = presignByVideoIdRef.current[videoId];
    if (st && st.status === "ready") return st.url;

    // playable은 그대로
    if (isPlayableUrl(raw)) return raw;

    // s3 등은 TTL 캐시만 신뢰
    const cached = getCachedUrl(presignCacheRef.current, raw);
    if (cached) return cached;

    return undefined;
  }, []);

  // =========================
  // presign resolve 함수 (EduPanel 내부)
  // =========================
  const resolvePlayableUrl = useCallback(
    async (videoId: string, rawUrl: string, opts?: { force?: boolean; watch?: boolean }) => {
      const raw = (rawUrl ?? "").trim();
      if (!raw) throw new Error("EMPTY_RAW_URL");

      // playable이면 그대로
      if (isPlayableUrl(raw)) {
        presignCacheRef.current.set(raw, {
          url: raw,
          expiresAtMs: Date.now() + 365 * 24 * 60 * 60 * 1000,
        });
        setPresignState(videoId, { status: "ready", url: raw });
        return raw;
      }

      if (!opts?.force) {
        const cached = getCachedUrl(presignCacheRef.current, raw);
        if (cached) {
          setPresignState(videoId, { status: "ready", url: cached });
          return cached;
        }

        const existingState = presignByVideoIdRef.current[videoId];
        if (existingState?.status === "ready") return existingState.url;

        const inFlight = presignInFlightRef.current.get(raw);
        if (inFlight) {
          setPresignState(videoId, { status: "resolving" });
          return inFlight;
        }
      }

      // watch 컨텍스트면 이전 watch resolve는 abort
      if (opts?.watch) {
        abortWatchResolve();
        watchResolvingRawRef.current = raw;
      }

      const ac = new AbortController();
      presignAbortByRawRef.current.set(raw, ac);

      setPresignState(videoId, { status: "resolving" });

      const p = resolveEducationVideoUrl(raw, { signal: ac.signal })
        .then((resolved) => {
          const u = (resolved ?? "").trim();
          if (!u) throw new Error("EMPTY_RESOLVED_URL");

          // UI 캐시는 TTL
          presignCacheRef.current.set(raw, { url: u, expiresAtMs: Date.now() + PRESIGN_UI_CACHE_MS });

          setPresignState(videoId, { status: "ready", url: u });
          return u;
        })
        .catch((e: unknown) => {
          // abort는 “조용히” 처리
          if (isAbortError(e)) {
            setPresignState(videoId, { status: "idle" });
            throw e;
          }

          const msg = "영상 URL을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.";
          setPresignState(videoId, { status: "error", message: msg });

          // 리스트에서도 사용자 인지가 필요하므로 토스트 1회
          pushToastOnce(`presign:${videoId}`, "영상 URL 준비에 실패했습니다.", "error", 8000);

          throw e;
        })
        .finally(() => {
          const cur = presignAbortByRawRef.current.get(raw);
          if (cur === ac) presignAbortByRawRef.current.delete(raw);
          presignInFlightRef.current.delete(raw);
          if (opts?.watch && watchResolvingRawRef.current === raw) {
            watchResolvingRawRef.current = null;
          }
        });

      presignInFlightRef.current.set(raw, p);
      return p;
    },
    [abortWatchResolve, setPresignState, pushToastOnce]
  );

  // =========================
  // [수정] handleVideoClick 정의를 여기로 이동 (자동 재생 useEffect보다 위로)
  // =========================
  const handleVideoClick = useCallback(
    async (educationId: string, educationTitle: string, video: UiVideo) => {
      const raw = (video.videoUrl ?? "").trim();
      if (!raw) {
        pushToast("영상 URL이 없습니다. 관리자에게 문의해 주세요.", "warn");
        return;
      }

      // watch 전환 시 이전 resolve는 abort
      abortWatchResolve();

      listRestoreRef.current = { size: sizeRef.current, pos: posRef.current };

      const base = clamp(video.progress ?? 0, 0, 100);

      // watch 패널부터 먼저 열어 UX 지연 방지
      const prevPos = posRef.current;
      const prevSize = sizeRef.current;
      const nextSize = WATCH_DEFAULT_SIZE;
      const minTop = getMinTop(topSafeRef.current);
      setSize(nextSize);
      setPanelPos(derivePosByBottomRight(prevPos, prevSize, nextSize, minTop));

      // 초기 선택 상태 (rawVideoUrl은 항상 유지)
      const knownPlayable = getKnownPlayableUrl(video.id, raw);

      setSelectedVideo({
        ...video,
        educationId,
        educationTitle,
        rawVideoUrl: raw,
        videoUrl: knownPlayable, // presign된 URL이 있으면 즉시 반영
        progress: base,
      });

      // watch 상태 초기화
      setWatchPercent(base);

      // 완료/완료요청 상태 초기화
      completedSentRef.current = Boolean(video.completed) || base >= 100;
      completeRequestPosRef.current = null;

      maxWatchedTimeRef.current = 0;
      videoDurationRef.current = 0;
      watchTimeAccumRef.current = 0;
      lastTimeSampleRef.current = null;
      setIsPlaying(false);
      setSaveStatus("idle");
      clearSaveTimer();

      // playable이 이미 확보되면 끝
      if (knownPlayable) {
        setPresignState(video.id, { status: "ready", url: knownPlayable });
        return;
      }

      // 아니면 presign resolve
      try {
        const resolved = await resolvePlayableUrl(video.id, raw, { watch: true });

        // 이미 다른 영상으로 이동한 경우 state 업데이트 금지
        const cur = selectedVideoRef.current;
        if (!cur || cur.id !== video.id) return;

        setSelectedVideo((prev) => (prev && prev.id === video.id ? { ...prev, videoUrl: resolved } : prev));
      } catch (e: unknown) {
        if (isAbortError(e)) return;
      }
    },
    [abortWatchResolve, clearSaveTimer, getKnownPlayableUrl, pushToast, resolvePlayableUrl, setPresignState]
  );

  // =========================
  // (1) getResumeSeconds (실사용)
  // - 서버에 보낼 position/resume는 currentTime이 아니라 "실제로 본 최대 시점" 기반이 더 안전
  // =========================
  const getResumeSeconds = useCallback((): number => {
    const v = videoRef.current;
    const duration = videoDurationRef.current || v?.duration || 0;

    // 기준: 최대 시청 시점(가드/누적 기준) 우선
    let sec = Number.isFinite(maxWatchedTimeRef.current)
      ? maxWatchedTimeRef.current
      : v?.currentTime ?? 0;

    if (!Number.isFinite(sec) || sec < 0) sec = 0;

    if (Number.isFinite(duration) && duration > 0) {
      // 끝 근처면 duration으로 정리(완료 판정/서버 처리 안정화)
      if (sec >= Math.max(0, duration - 0.25)) sec = duration;
      sec = clamp(sec, 0, duration);
    }

    return Math.max(0, Math.floor(sec));
  }, []);

  // =========================
  // 1) 교육 목록 로드
  // =========================
  const manualReloadRef = useRef<boolean>(false);

  useEffect(() => {
    if (!hasDOM) return;

    const ac = new AbortController();
    let alive = true;
    let timedOut = false;

    setEduLoading(true);
    setEduError(null);

    void withTimeout(
      getMyEducations(undefined, { signal: ac.signal }),
      EDU_LIST_TIMEOUT_MS,
      () => {
        timedOut = true;
        ac.abort();
      }
    )
      .then((list) => {
        if (!alive) return;
        setEducations(list);
        syncCachesForEducationList(list);

        if (manualReloadRef.current) {
          manualReloadRef.current = false;
          pushToast("교육 목록이 업데이트되었습니다.", "success");
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;

        // “unmount/재요청 abort”는 조용히 무시
        if (isAbortError(e) && !timedOut) return;

        // timeout은 무한 로딩 대신 에러로 전환
        if (timedOut || isTimeoutError(e)) {
          setEduError("교육 목록 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
          if (manualReloadRef.current) {
            manualReloadRef.current = false;
            pushToast("교육 목록 새로고침에 실패했습니다.", "error");
          }
          return;
        }

        console.warn("[EduPanel] getMyEducations failed", e);
        setEduError("교육 목록을 불러오지 못했습니다.");

        if (manualReloadRef.current) {
          manualReloadRef.current = false;
          pushToast("교육 목록 새로고침에 실패했습니다.", "error");
        }
      })
      .finally(() => {
        if (!alive) return;
        setEduLoading(false);
      });

    return () => {
      alive = false;
      ac.abort();
    };
  }, [hasDOM, syncCachesForEducationList, eduReloadKey, pushToast]);

  const ensureVideosLoaded = useCallback(async (educationId: string) => {
    const state = videosByEduIdRef.current[educationId];
    if (state && (state.status === "loading" || state.status === "ready")) return;

    const prev = videosAbortRef.current.get(educationId);
    if (prev) prev.abort();

    const ac = new AbortController();
    videosAbortRef.current.set(educationId, ac);

    setVideosByEduId((prevMap) => {
      const next = {
        ...prevMap,
        [educationId]: {
          status: "loading",
          videos: prevMap[educationId]?.videos ?? [],
        } as VideoLoadState,
      };
      videosByEduIdRef.current = next;
      return next;
    });

    let timedOut = false;

    try {
      const list = await withTimeout(
        getEducationVideos(educationId, { signal: ac.signal }),
        EDU_VIDEOS_TIMEOUT_MS,
        () => {
          timedOut = true;
          ac.abort();
        }
      );

      const videos = list.map(toUiVideo);

      setVideosByEduId((prevMap) => {
        const next = {
          ...prevMap,
          [educationId]: { status: "ready", videos } as VideoLoadState,
        };
        videosByEduIdRef.current = next;
        return next;
      });
    } catch (e: unknown) {
      // “재요청/언마운트 abort”는 무시 (타임아웃 abort만 에러로)
      if (isAbortError(e) && !timedOut) return;

      const msg =
        timedOut || isTimeoutError(e)
          ? "영상 목록 요청 시간이 초과되었습니다. 다시 시도해 주세요."
          : "영상 목록을 불러오지 못했습니다.";

      console.warn("[EduPanel] getEducationVideos failed", e);

      setVideosByEduId((prevMap) => {
        const next = {
          ...prevMap,
          [educationId]: {
            status: "error",
            videos: prevMap[educationId]?.videos ?? [],
            message: msg,
          } as VideoLoadState,
        };
        videosByEduIdRef.current = next;
        return next;
      });
    } finally {
      // 완료/에러 후 controller 정리 (메모리/누수 방지)
      const cur = videosAbortRef.current.get(educationId);
      if (cur === ac) videosAbortRef.current.delete(educationId);
    }
  }, []);

  useEffect(() => {
    if (!hasDOM) return;
    if (educations.length === 0) return;

    for (const edu of educations) {
      void ensureVideosLoaded(edu.id);
    }
  }, [hasDOM, educations, ensureVideosLoaded]);

  // =========================
  // 1-C) 자동 재생 처리 (AI 챗봇에서 PLAY_VIDEO 액션 감지 시)
  // - 취소 플래그 + 요청 토큰 패턴으로 동시성/역전 방지
  // =========================
  const playRequestIdRef = useRef(0);

  useEffect(() => {
    // initialVideo가 없으면 스킵
    if (!initialVideo) return;
    // 교육 목록 로딩 중이면 대기
    if (eduLoading) return;
    // 교육 목록이 비어있으면 대기
    if (educations.length === 0) return;

    // 요청 토큰 증가 (최신 요청만 유효하게 처리)
    const reqId = ++playRequestIdRef.current;
    let cancelled = false;

    const { educationId, videoId, resumePositionSeconds } = initialVideo;

    // 해당 교육 찾기
    const targetEducation = educations.find((e) => e.id === educationId);
    if (!targetEducation) {
      console.warn(
        `[EduPanel] initialVideo: education not found (educationId=${educationId})`
      );
      onInitialVideoConsumed?.();
      return;
    }

    // 비동기로 영상 로드 후 자동 재생
    const loadAndPlay = async () => {
      try {
        // 해당 교육의 영상 목록 로드
        await ensureVideosLoaded(educationId);

        // 취소 또는 새 요청이 들어왔으면 중단
        if (cancelled) return;
        if (playRequestIdRef.current !== reqId) return;

        // 영상 찾기 (상태가 업데이트되기 전일 수 있으므로 ref 사용)
        const loadState = videosByEduIdRef.current[educationId];
        const videos = loadState?.videos ?? [];
        const targetVideo = videos.find((v) => v.id === videoId);

        if (!targetVideo) {
          console.warn(
            `[EduPanel] initialVideo: video not found (videoId=${videoId})`
          );
          onInitialVideoConsumed?.();
          return;
        }

        // 다시 취소 체크 (영상 목록 로드 후)
        if (cancelled) return;
        if (playRequestIdRef.current !== reqId) return;

        // 영상 선택 (handleVideoClick 호출)
        // resumePositionSeconds가 있으면 영상의 resumeSeconds를 덮어씀
        const videoWithResume: UiVideo = resumePositionSeconds != null
          ? { ...targetVideo, resumeSeconds: resumePositionSeconds }
          : targetVideo;

        await handleVideoClick(
          educationId,
          targetEducation.title,
          videoWithResume
        );

        // 최종 취소 체크 후 완료 콜백
        if (cancelled) return;
        if (playRequestIdRef.current !== reqId) return;

        onInitialVideoConsumed?.();
      } catch (error) {
        // 취소된 경우 에러 무시
        if (cancelled) return;
        console.error("[EduPanel] initialVideo: auto-play failed", error);
        onInitialVideoConsumed?.();
      }
    };

    void loadAndPlay();

    // cleanup: 패널 닫힘/언마운트 시 취소
    return () => {
      cancelled = true;
    };
  }, [
    initialVideo,
    eduLoading,
    educations,
    ensureVideosLoaded,
    handleVideoClick,
    onInitialVideoConsumed,
  ]);

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

  const canTakeQuizForSelected = useMemo(() => {
    if (!selectedVideo) return false;
    const section = sections.find((s) => s.id === selectedVideo.educationId);
    if (!section) return false;
    return isSectionDone(section);
  }, [selectedVideo, sections]);

  // =========================
  // 2-A) 섹션 완료 토스트 (완료 전환 감지)
  // =========================
  const sectionDoneRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    // watch 중에도 완료 처리(서버 응답/로컬 계산)가 올 수 있으니 항상 감지
    for (const s of sections) {
      const done = isSectionDone(s);
      const prevDone = sectionDoneRef.current[s.id] ?? false;
      if (!prevDone && done) {
        const msg = onOpenQuizPanel
          ? `“${s.title}” 교육을 완료했습니다. 퀴즈를 풀 수 있습니다.`
          : `“${s.title}” 교육을 완료했습니다.`;
        pushToastOnce(`edu-done:${s.id}`, msg, "success", 15_000);
      }
      sectionDoneRef.current[s.id] = done;
    }
  }, [sections, onOpenQuizPanel, pushToastOnce]);

  // =========================
  // 2-1) 리스트 썸네일 presign 백그라운드 resolve (visibleVideos 기준)
  // =========================
  type ThumbTarget = { videoId: string; rawUrl: string };

  const visibleThumbTargets = useMemo<ThumbTarget[]>(() => {
    // watch 화면에서는 리스트 썸네일 resolve 불필요
    if (selectedVideo) return [];

    const out: ThumbTarget[] = [];
    const pageSize = getPageSize(size.width);

    for (const section of sections) {
      const videos = section.videos ?? [];
      if (videos.length === 0) continue;

      const maxPage = Math.max(0, Math.ceil(videos.length / pageSize) - 1);
      const currentPage = Math.min(sectionPages[section.id] ?? 0, maxPage);

      const start = currentPage * pageSize;
      const visible = videos.slice(start, start + pageSize);

      for (const v of visible) {
        const raw = (v.videoUrl ?? "").trim();
        if (!raw) continue;

        // 이미 재생 가능이면 skip
        if (isPlayableUrl(raw)) continue;

        // TTL 캐시 hit면 skip
        if (getCachedUrl(presignCacheRef.current, raw)) continue;

        // videoId 기준 state가 resolving/ready/error면 skip (error는 자동 재시도 X)
        const st = presignByVideoId[v.id];
        if (st?.status === "ready" || st?.status === "resolving" || st?.status === "error") continue;

        // raw 기준 inFlight면 skip (중복 호출 방지)
        if (presignInFlightRef.current.has(raw)) continue;

        out.push({ videoId: v.id, rawUrl: raw });
      }
    }

    return out;
  }, [selectedVideo, sections, sectionPages, size.width, presignByVideoId]);

  useEffect(() => {
    if (!hasDOM) return;
    if (visibleThumbTargets.length === 0) return;

    let cancelled = false;

    const MAX_CONCURRENCY = 4;
    let idx = 0;

    const worker = async () => {
      while (!cancelled) {
        const t = visibleThumbTargets[idx++];
        if (!t) break;

        try {
          await resolvePlayableUrl(t.videoId, t.rawUrl, { watch: false });
        } catch (e: unknown) {
          if (isAbortError(e)) continue;
        }
      }
    };

    const count = Math.min(MAX_CONCURRENCY, visibleThumbTargets.length);
    for (let i = 0; i < count; i++) void worker();

    return () => {
      cancelled = true;
    };
  }, [hasDOM, visibleThumbTargets, resolvePlayableUrl]);

  // =========================
  // 3) 헤더 safe top 동기화
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

      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - EDGE_MARGIN * 2);
        const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - minTop - EDGE_MARGIN);

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
    event.stopPropagation();
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
      if (
        nextProgressPercent === undefined &&
        nextResumeSeconds === undefined &&
        eduCompleted === undefined &&
        videoCompleted === undefined
      )
        return;

      setVideosByEduId((prev) => {
        const st = prev[educationId];
        if (!st) return prev;

        const videos = st.videos.map((v) => {
          if (v.id !== videoId) return v;

          const durationSec = v.durationSeconds;

          let resume =
            typeof nextResumeSeconds === "number" ? Math.max(0, nextResumeSeconds) : v.resumeSeconds;

          let completed = videoCompleted ?? v.completed ?? false;

          // nextProgressPercent가 직접 오면 일단 반영하되,
          // resume+duration이 있으면 “표시용 progress”는 resume 기준으로 재정규화
          let p =
            typeof nextProgressPercent === "number"
              ? clamp(nextProgressPercent, 0, 100)
              : v.progress ?? 0;

          const derivedCompleted = normalizeCompletedFlag(p, completed);
          completed = derivedCompleted;

          if (completed && typeof durationSec === "number" && durationSec > 0) {
            resume = durationSec;
            p = 100;
          } else if (
            typeof durationSec === "number" &&
            durationSec > 0 &&
            typeof resume === "number"
          ) {
            p = progressFromResumeSeconds(resume, durationSec);
          }

          return { ...v, progress: p, resumeSeconds: resume, completed };
        });

        const next = { ...prev, [educationId]: { ...st, videos } as VideoLoadState };
        videosByEduIdRef.current = next;
        return next;
      });

      setEducations((prev) => {
        const next = prev.map((e) => {
          if (e.id !== educationId) return e;
          if (eduCompleted !== undefined) return { ...e, completed: eduCompleted };

          const st = videosByEduIdRef.current[educationId];
          if (!st || st.status !== "ready" || st.videos.length === 0) return e;

          const derivedDone = st.videos.every(
            (v) => (v.completed ?? false) || (v.progress ?? 0) >= 100
          );
          return derivedDone ? { ...e, completed: true } : e;
        });
        return next;
      });
    },
    []
  );

  const flushProgress = useCallback(
    async (opts?: {
      force?: boolean;
      keepalive?: boolean;
      reason?: "pause" | "back" | "close" | "ended" | "complete";
    }) => {
      const sel = selectedVideoRef.current;
      const v = videoRef.current;
      if (!sel || !v) return;

      const watchTime = Math.round(watchTimeAccumRef.current);
      if (!opts?.force && watchTime < 1) return;

      // (1) position은 currentTime이 아니라 "최대 시청 시점" 기반으로 보냄
      const position = getResumeSeconds();

      abortInFlightProgress();
      const ac = new AbortController();
      progressAbortRef.current = ac;

      // force flush인 경우에만 UI에 "저장중" 표시
      if (opts?.force) setSaveStatus("saving");

      const educationId = sel.educationId;
      const videoId = sel.id;

      try {
        const res = await postEduVideoProgress(
          educationId,
          videoId,
          { position, watchTime },
          { signal: ac.signal, keepalive: opts?.keepalive }
        );

        // 이 요청이 최신 요청인지 확인(최신만 진행표시/상태 업데이트)
        if (progressAbortRef.current === ac) progressAbortRef.current = null;

        watchTimeAccumRef.current = 0;

        const duration = videoDurationRef.current || v.duration || 0;

        const serverProgress =
          typeof res?.progressPercent === "number" ? clamp(res.progressPercent, 0, 100) : undefined;

        const rawResume =
          typeof res?.resumePositionSeconds === "number"
            ? res.resumePositionSeconds
            : (res as unknown as Record<string, unknown>)["resumePosition"] as number | undefined;

        const normalizedResume =
          typeof rawResume === "number"
            ? normalizeResumeSeconds(rawResume, duration)
            : position;

        let resumeInt = Math.max(0, Math.floor(normalizedResume));

        const serverVideoCompleted =
          typeof res?.videoCompleted === "boolean" ? res.videoCompleted : undefined;

        const serverEduCompleted =
          typeof res?.eduCompleted === "boolean" ? res.eduCompleted : undefined;

        const localPercent = clamp(Math.round(watchPercentRef.current), 0, 100);
        const baseProgress = serverProgress ?? localPercent;

        const derivedCompleted = normalizeCompletedFlag(baseProgress, serverVideoCompleted);
        const finalCompleted = Boolean(derivedCompleted);

        if (finalCompleted && duration > 0) {
          resumeInt = Math.max(0, Math.floor(duration));
        }

        // progress는 resume 기준으로 재정규화(가능할 때), 완료면 100 고정
        let progressToApply = baseProgress;
        if (finalCompleted) {
          progressToApply = 100;
        } else if (duration > 0) {
          progressToApply = progressFromResumeSeconds(resumeInt, duration);
        }

        // 확정 상태 플래그 업데이트
        completedSentRef.current = finalCompleted || completedSentRef.current;

        // 부모/로컬 반영(정규화된 값)
        syncProgressToParent(videoId, progressToApply, resumeInt, finalCompleted);

        patchLocalVideoProgress(
          educationId,
          videoId,
          progressToApply,
          resumeInt,
          serverEduCompleted,
          finalCompleted
        );

        if (opts?.force) {
          setSaveStatusTransient("saved", 1600);

          // 토스트는 과도하면 UX가 깨지므로 '의도된 액션'에 한해 제한적으로 표시
          if (opts.reason === "pause" || opts.reason === "back" || opts.reason === "close") {
            pushToastOnce(`progress-saved:${videoId}`, "진행률이 저장되었습니다.", "success", 9000);
          }
          if (opts.reason === "ended" || opts.reason === "complete") {
            if (finalCompleted) {
              pushToastOnce(`video-done:${videoId}`, "시청 완료 처리되었습니다.", "success", 12_000);
            }
          }
        }
      } catch (e: unknown) {
        if (isAbortError(e)) return;
        console.warn("[EduPanel] postEduVideoProgress failed", e);

        if (opts?.force) {
          setSaveStatusTransient("error", 2600);
          pushToastOnce(
            "progress-error",
            "진행률 저장에 실패했습니다. 네트워크를 확인해 주세요.",
            "error",
            8000
          );
        }
      } finally {
        if (progressAbortRef.current === ac) progressAbortRef.current = null;
      }
    },
    [
      abortInFlightProgress,
      getResumeSeconds,
      patchLocalVideoProgress,
      pushToastOnce,
      setSaveStatusTransient,
      syncProgressToParent,
    ]
  );

  const startTick = useCallback(() => {
    if (tickHandleRef.current) return;
    tickHandleRef.current = window.setInterval(() => {
      void flushProgress({ force: false });
    }, PROGRESS_TICK_MS);
  }, [flushProgress]);

  // 탭 숨김/언로드 시에도 진행도 flush (keepalive)
  useEffect(() => {
    if (!hasDOM) return;
    if (!selectedVideo) return;

    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      void flushProgress({ force: true, keepalive: true, reason: "close" });
    };

    const onBeforeUnload = () => {
      void flushProgress({ force: true, keepalive: true, reason: "close" });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hasDOM, selectedVideo, flushProgress]);

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

  // =========================
  // 7) video events
  // =========================
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;

    const duration = v.duration || 0;
    videoDurationRef.current = duration;

    const basePercent = clamp(selectedVideo?.progress ?? 0, 0, 100);
    const isCompleted = Boolean(selectedVideo?.completed) || basePercent >= 100;

    const resumeSecondsRaw = selectedVideo?.resumeSeconds;

    let startTime = 0;

    if (duration > 0) {
      if (isCompleted) {
        startTime = Math.max(0, duration - 0.25);
      } else if (typeof resumeSecondsRaw === "number" && resumeSecondsRaw > 0) {
        startTime = normalizeResumeSeconds(resumeSecondsRaw, duration);
        startTime = clamp(startTime, 0, Math.max(0, duration - 0.25));
      } else {
        startTime = duration * (basePercent / 100);
        startTime = clamp(startTime, 0, Math.max(0, duration - 0.25));
      }
    }

    try {
      allowProgrammaticSeekRef.current = true;
      v.currentTime = startTime;
      window.setTimeout(() => {
        allowProgrammaticSeekRef.current = false;
      }, 0);
    } catch {
      allowProgrammaticSeekRef.current = false;
    }

    maxWatchedTimeRef.current = startTime;
    lastTimeSampleRef.current = startTime;

    // 표시 퍼센트도 startTime(=resume 기준)으로 단일화
    if (isCompleted) {
      setWatchPercent(100);
    } else if (duration > 0) {
      const derivedPercent = (startTime / duration) * 100;
      setWatchPercent(clamp(derivedPercent, 0, 100));
    } else {
      setWatchPercent(basePercent);
    }
  };

  // 앞으로 점프 seek 방지
  const handleSeeking = () => {
    const v = videoRef.current;
    if (!v) return;

    if (allowProgrammaticSeekRef.current) return;

    const target = v.currentTime;
    const maxAllowed = maxWatchedTimeRef.current + SEEK_FORWARD_TOLERANCE_SEC;

    if (Number.isFinite(target) && target > maxAllowed) {
      try {
        allowProgrammaticSeekRef.current = true;
        v.currentTime = maxWatchedTimeRef.current;
        window.setTimeout(() => {
          allowProgrammaticSeekRef.current = false;
        }, 0);
      } catch {
        allowProgrammaticSeekRef.current = false;
      }
    }
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    const duration = videoDurationRef.current;
    if (!v || !duration) return;

    const current = v.currentTime;

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

    const newMax = Math.max(maxWatchedTimeRef.current, current);
    maxWatchedTimeRef.current = newMax;

    const newPercent = Math.min(100, (newMax / duration) * 100);

    // (2) 완료는 "서버 응답으로 확정"한다.
    // - 여기서는 완료를 로컬 확정/부모 반영하지 않고, 완료 플러시만 1회 트리거.
    if (selectedVideo && !completedSentRef.current && Math.round(newPercent) >= 100) {
      const reqPos = getResumeSeconds();
      if (completeRequestPosRef.current !== reqPos) {
        completeRequestPosRef.current = reqPos;
        void flushProgress({ force: true, reason: "complete" });
      }
    }

    setWatchPercent((prev) => {
      const next = newPercent > prev ? newPercent : prev;
      return next;
    });
  };

  const handleEnded = () => {
    setIsPlaying(false);
    stopTick();

    // ended도 서버 응답으로 완료 확정
    const reqPos = getResumeSeconds();
    completeRequestPosRef.current = reqPos;

    void flushProgress({ force: true, reason: "ended" });

    const duration = videoDurationRef.current || videoRef.current?.duration || 0;
    if (duration > 0) {
      maxWatchedTimeRef.current = duration;
      setWatchPercent(100);
    }
  };

  const canWatchPlay = useMemo(() => {
    if (!selectedVideo) return false;

    const st = presignByVideoId[selectedVideo.id];
    if (st?.status === "resolving") return false;
    if (st?.status === "error") return false;

    return Boolean(selectedVideo.videoUrl);
  }, [selectedVideo, presignByVideoId]);

  const handlePlayPause = () => {
    const v = videoRef.current;
    if (!v) return;

    if (!canWatchPlay) return;

    if (v.paused || v.ended) {
      v.play()
        .then(() => {
          setIsPlaying(true);
          lastTimeSampleRef.current = v.currentTime;
          startTick();
        })
        .catch(() => {
          setIsPlaying(false);
          stopTick();
        });
    } else {
      v.pause();
      setIsPlaying(false);
      stopTick();
      void flushProgress({ force: true, reason: "pause" });
    }
  };

  const retryResolveSelected = useCallback(() => {
    const cur = selectedVideoRef.current;
    if (!cur) return;

    const raw = (cur.rawVideoUrl ?? "").trim();
    if (!raw) return;

    if (isPlayableUrl(raw)) {
      presignCacheRef.current.set(raw, {
        url: raw,
        expiresAtMs: Date.now() + 365 * 24 * 60 * 60 * 1000,
      });
      setPresignState(cur.id, { status: "ready", url: raw });
      setSelectedVideo((prev) => (prev && prev.id === cur.id ? { ...prev, videoUrl: raw } : prev));
      return;
    }

    void (async () => {
      try {
        const resolved = await resolvePlayableUrl(cur.id, raw, { force: true, watch: true });

        const latest = selectedVideoRef.current;
        if (!latest || latest.id !== cur.id) return;

        setSelectedVideo((prev) => (prev && prev.id === cur.id ? { ...prev, videoUrl: resolved } : prev));
      } catch (e: unknown) {
        if (isAbortError(e)) return;
      }
    })();
  }, [resolvePlayableUrl, setPresignState]);

  const handleGoToQuiz = () => {
    if (!selectedVideo) return;
    if (!onOpenQuizPanel) return;

    if (!canTakeQuizForSelected) {
      pushToastOnce("quiz-blocked", "교육 영상을 모두 시청 완료해야 퀴즈를 볼 수 있습니다.", "warn", 6000);
      return;
    }

    void flushProgress({ force: true, reason: "back" });
    onOpenQuizPanel(selectedVideo.educationId);
  };

  const resetWatchState = () => {
    abortInFlightProgress();
    stopTick();
    clearSaveTimer();

    videoDurationRef.current = 0;
    maxWatchedTimeRef.current = 0;
    watchTimeAccumRef.current = 0;
    lastTimeSampleRef.current = null;

    setWatchPercent(0);
    setIsPlaying(false);

    completedSentRef.current = false;
    completeRequestPosRef.current = null;

    setSaveStatus("idle");
  };

  const handleBackToList = () => {
    abortWatchResolve();

    if (selectedVideo) {
      videoRef.current?.pause();
      setIsPlaying(false);
      stopTick();
      void flushProgress({ force: true, reason: "back" });
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
    abortAllResolves();

    if (selectedVideo) {
      videoRef.current?.pause();
      setIsPlaying(false);
      stopTick();
      void flushProgress({ force: true, keepalive: true, reason: "close" });
    }

    const abortMap = videosAbortRef.current;
    for (const [, c] of abortMap.entries()) c.abort();
    abortMap.clear();

    onClose();
  };

  useEffect(() => {
    const abortMap = videosAbortRef.current;
    return () => {
      stopTick();
      abortInFlightProgress();
      abortAllResolves();
      clearSaveTimer();

      for (const [, c] of abortMap.entries()) c.abort();
      abortMap.clear();
    };
  }, [stopTick, abortInFlightProgress, abortAllResolves, clearSaveTimer]);

  if (!hasDOM) return null;

  const selectedPresignState: PresignState | undefined =
    selectedVideo ? presignByVideoId[selectedVideo.id] : undefined;

  const isResolvingSelected = selectedPresignState?.status === "resolving";
  const isErrorSelected = selectedPresignState?.status === "error";
  const selectedErrorMessage =
    selectedPresignState && selectedPresignState.status === "error"
      ? selectedPresignState.message
      : "영상 URL을 준비하지 못했습니다.";

  // =========================
  // UI helpers
  // =========================
  const renderThumb = (v: UiVideo) => {
    const raw = (v.videoUrl ?? "").trim();
    const playable = raw ? getKnownPlayableUrl(v.id, raw) : undefined;
    const st = presignByVideoId[v.id];

    const labelStyle: React.CSSProperties = {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      opacity: 0.85,
      pointerEvents: "none",
    };

    if (st?.status === "resolving") {
      return (
        <div className="cb-edu-video-thumbnail">
          <div style={labelStyle}>URL 준비 중…</div>
        </div>
      );
    }

    if (st?.status === "error") {
      return (
        <div className="cb-edu-video-thumbnail">
          <div style={labelStyle}>URL 오류</div>
        </div>
      );
    }

    if (playable) {
      return (
        <div className="cb-edu-video-thumbnail">
          <video
            className="cb-edu-video-thumbnail-video"
            src={playable}
            muted
            playsInline
            preload="metadata"
            controls={false}
            disablePictureInPicture
            disableRemotePlayback
            onContextMenu={(e) => e.preventDefault()}
            onLoadedMetadata={(e) => {
              try {
                const el = e.currentTarget;
                el.currentTime = 0;
                el.pause();
              } catch {
                // ignore
              }
            }}
          />
          <div className="cb-edu-video-play-circle">
            <span className="cb-edu-video-play-icon">▶</span>
          </div>
        </div>
      );
    }

    return (
      <div className="cb-edu-video-thumbnail">
        <div style={labelStyle}>미리보기 없음</div>
      </div>
    );
  };

  // 토스트 UI (패널 내부 고정)
  const toastStack = (
    <div
      className="cb-edu-toast-stack"
      style={{ zIndex: (zIndex ?? EDU_LAYER_Z) + 10 }}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`cb-edu-toast cb-edu-toast--${t.variant}`}
          role={t.variant === "error" ? "alert" : "status"}
        >
          {t.message}
        </div>
      ))}
    </div>
  );

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
          style={{ width: size.width, height: size.height, position: "relative" }}
          onMouseDown={() => onRequestFocus?.()}
        >
          {toastStack}

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
              // =========================
              // WATCH VIEW
              // =========================
              <div className="cb-edu-watch-layout">
                <header className="cb-edu-watch-header">
                  <button
                    type="button"
                    className="cb-edu-watch-back-btn"
                    onClick={handleBackToList}
                    aria-label="교육 영상 목록으로 돌아가기"
                  >
                    ◀
                  </button>
                  <h2 className="cb-edu-watch-title" title={selectedVideo.title}>
                    {selectedVideo.title}
                  </h2>
                </header>

                <div className="cb-edu-watch-body">
                  <div className="cb-edu-watch-player-wrapper">
                    <video
                      className="cb-edu-watch-video"
                      src={selectedVideo.videoUrl}
                      ref={videoRef}
                      onLoadedMetadata={handleLoadedMetadata}
                      onTimeUpdate={handleTimeUpdate}
                      onSeeking={handleSeeking}
                      onEnded={handleEnded}
                      onClick={handlePlayPause}
                      controls={false}
                      playsInline
                      preload="metadata"
                      controlsList="nodownload noplaybackrate noremoteplayback"
                      disablePictureInPicture
                      disableRemotePlayback
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      브라우저가 비디오 태그를 지원하지 않습니다.
                    </video>

                    {isResolvingSelected ? (
                      <div
                        className="cb-edu-empty"
                        style={{
                          position: "absolute",
                          inset: 12,
                          pointerEvents: "auto",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div>
                          <div className="cb-edu-empty-title">영상 URL을 준비하는 중…</div>
                          <div className="cb-edu-empty-desc">잠시만 기다려 주세요.</div>
                        </div>
                      </div>
                    ) : null}

                    {isErrorSelected ? (
                      <div
                        className="cb-edu-empty"
                        style={{
                          position: "absolute",
                          inset: 12,
                          pointerEvents: "auto",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div>
                          <div className="cb-edu-empty-title">영상 재생 준비 실패</div>
                          <div className="cb-edu-empty-desc">{selectedErrorMessage}</div>
                          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
                            <button type="button" className="cb-btn cb-btn-primary" onClick={retryResolveSelected}>
                              다시 시도
                            </button>
                            <button type="button" className="cb-btn" onClick={handleBackToList}>
                              목록으로
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="cb-edu-watch-overlay">
                      {!isResolvingSelected && !isErrorSelected ? (
                        <>
                          <button
                            type="button"
                            className="cb-edu-watch-play-btn"
                            onClick={handlePlayPause}
                            disabled={!canWatchPlay}
                            aria-label={isPlaying ? "일시정지" : "재생"}
                            title={!canWatchPlay ? "영상 URL 준비 중입니다." : undefined}
                          >
                            {isPlaying ? "❚❚" : "▶"}
                          </button>

                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                            <div className="cb-edu-watch-progress-text">{clamp(roundedWatchPercent, 0, 100)}%</div>

                            {/* 진행률 저장 상태(요청된 UI: 진행률/완료 상태 표시) */}
                            <div style={{ fontSize: 12, opacity: 0.82 }}>
                              {saveStatus === "saving"
                                ? "저장중…"
                                : saveStatus === "saved"
                                  ? "저장됨"
                                  : saveStatus === "error"
                                    ? "저장 실패"
                                    : null}
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <footer className="cb-edu-watch-footer">
                    <button
                      type="button"
                      className={`cb-edu-watch-quiz-btn ${canTakeQuizForSelected ? "is-active" : ""}`}
                      onClick={handleGoToQuiz}
                      disabled={!canTakeQuizForSelected}
                      title={!canTakeQuizForSelected ? "교육 영상 전체를 시청 완료해야 퀴즈를 볼 수 있습니다." : undefined}
                    >
                      퀴즈 풀러가기
                    </button>
                  </footer>
                </div>
              </div>
            ) : (
              // =========================
              // LIST VIEW
              // =========================
              <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <header className="cb-edu-header cb-edu-header-row">
                  <h2 className="cb-edu-title">교육</h2>

                  <button
                    type="button"
                    className="cb-edu-nav-btn cb-edu-refresh-btn"
                    onClick={() => {
                      manualReloadRef.current = true;
                      setEduReloadKey((k) => k + 1);
                    }}
                    disabled={eduLoading}
                    aria-label="교육 목록 새로고침"
                    title="새로고침"
                  >
                    ⟳
                  </button>
                </header>

                <div className="cb-edu-body">
                  {eduLoading ? (
                    <div className="cb-edu-empty">
                      <div className="cb-edu-empty-title">교육 목록을 불러오는 중…</div>
                      <div className="cb-edu-empty-desc">잠시만 기다려 주세요.</div>
                    </div>
                  ) : eduError ? (
                    <div className="cb-edu-empty">
                      <div className="cb-edu-empty-title">교육 목록 로드 실패</div>
                      <div className="cb-edu-empty-desc">{eduError}</div>
                      <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                        <button
                          type="button"
                          className="cb-btn cb-btn-primary"
                          onClick={() => {
                            manualReloadRef.current = true;
                            setEduReloadKey((k) => k + 1);
                          }}
                        >
                          다시 시도
                        </button>
                      </div>
                    </div>
                  ) : sections.length === 0 ? (
                    <div className="cb-edu-empty">
                      <div className="cb-edu-empty-title">표시할 교육이 없습니다.</div>
                      <div className="cb-edu-empty-desc">배정된 교육이 없거나 아직 게시되지 않았습니다.</div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {sections.map((section) => {
                        const st = videosByEduId[section.id] ?? { status: "idle", videos: [] };

                        const pageSize = getPageSize(size.width);
                        const maxPage = Math.max(0, Math.ceil(section.videos.length / pageSize) - 1);
                        const currentPage = Math.min(sectionPages[section.id] ?? 0, maxPage);

                        const start = currentPage * pageSize;
                        const visible = section.videos.slice(start, start + pageSize);

                        const done = isSectionDone(section);
                        const showPager = section.videos.length > pageSize;

                        // 진행률/완료 상태(요청된 UI) — 섹션 요약
                        const total = section.videos.length;
                        const doneCount = section.videos.filter(
                          (v) => (v.completed ?? false) || (v.progress ?? 0) >= 100
                        ).length;
                        const avgProgress =
                          total > 0
                            ? Math.round(
                              section.videos.reduce((acc, v) => acc + clamp(v.progress ?? 0, 0, 100), 0) / total
                            )
                            : 0;

                        return (
                          <div key={section.id} className="cb-edu-section">
                            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                              <div className="cb-edu-section-title">{section.title}</div>

                              <div style={{ fontSize: 12, opacity: 0.85 }}>
                                {section.eduType ? section.eduType : "교육"} · {done ? "완료" : "진행 중"} ·{" "}
                                {total > 0 ? `${doneCount}/${total} 완료 · ${avgProgress}%` : "0건"}
                              </div>

                              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                                {onOpenQuizPanel ? (
                                  <button
                                    type="button"
                                    className={`cb-edu-watch-quiz-btn ${done ? "is-active" : ""}`}
                                    style={{ height: 34, padding: "0 14px", fontSize: 13 }}
                                    disabled={!done}
                                    onClick={() => onOpenQuizPanel(section.id)}
                                    title={!done ? "교육 영상 전체를 시청 완료해야 퀴즈를 볼 수 있습니다." : undefined}
                                  >
                                    퀴즈
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            <div style={{ marginTop: 10 }}>
                              {st.status === "loading" ? (
                                <div className="cb-edu-empty" style={{ padding: 10 }}>
                                  <div className="cb-edu-empty-title">영상 목록 로딩 중…</div>
                                </div>
                              ) : st.status === "error" ? (
                                <div className="cb-edu-empty" style={{ padding: 10 }}>
                                  <div className="cb-edu-empty-title">영상 목록 로드 실패</div>
                                  <div className="cb-edu-empty-desc">{st.message}</div>
                                  <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
                                    <button
                                      type="button"
                                      className="cb-btn cb-btn-primary"
                                      onClick={() => void ensureVideosLoaded(section.id)}
                                    >
                                      다시 시도
                                    </button>
                                  </div>
                                </div>
                              ) : visible.length === 0 ? (
                                <div className="cb-edu-empty" style={{ padding: 10 }}>
                                  <div className="cb-edu-empty-title">영상이 없습니다.</div>
                                </div>
                              ) : (
                                <>
                                  <div className="cb-edu-section-row">
                                    {showPager ? (
                                      <button
                                        type="button"
                                        className="cb-edu-nav-btn"
                                        onClick={() => handlePrevClick(section.id)}
                                        disabled={currentPage <= 0}
                                        aria-label="이전"
                                        title="이전"
                                      >
                                        ◀
                                      </button>
                                    ) : (
                                      <div style={{ width: 34, height: 34 }} />
                                    )}

                                    <div className="cb-edu-videos-row">
                                      {visible.map((v) => {
                                        const p = clamp(v.progress ?? 0, 0, 100);
                                        const vs = getVideoStatus(p);
                                        const isComplete = (v.completed ?? false) || p >= 100;

                                        return (
                                          <button
                                            key={v.id}
                                            type="button"
                                            className="cb-edu-video-card"
                                            onClick={() => void handleVideoClick(section.id, section.title, v)}
                                          >
                                            {renderThumb(v)}

                                            <div className="cb-edu-video-title" title={v.title}>
                                              {v.title}
                                            </div>

                                            <div className="cb-edu-video-progress">
                                              <div className="cb-edu-video-progress-track">
                                                <div className="cb-edu-video-progress-fill" style={{ width: `${p}%` }} />
                                              </div>
                                            </div>

                                            <div className="cb-edu-video-meta">
                                              <div className="cb-edu-progress-text">{Math.round(p)}%</div>
                                              <div className={`cb-edu-status ${isComplete ? "completed" : vs.key}`}>
                                                {isComplete ? "완료" : vs.label}
                                              </div>
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>

                                    {showPager ? (
                                      <button
                                        type="button"
                                        className="cb-edu-nav-btn"
                                        onClick={() => handleNextClick(section.id)}
                                        disabled={currentPage >= maxPage}
                                        aria-label="다음"
                                        title="다음"
                                      >
                                        ▶
                                      </button>
                                    ) : (
                                      <div style={{ width: 34, height: 34 }} />
                                    )}
                                  </div>

                                  {showPager ? (
                                    <div
                                      style={{
                                        marginTop: 8,
                                        display: "flex",
                                        justifyContent: "center",
                                        fontSize: 12,
                                        opacity: 0.8,
                                      }}
                                    >
                                      {currentPage + 1} / {maxPage + 1}
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default EduPanel;