// src/components/chatbot/reviewFlowStore.ts
import type { ReviewWorkItem } from "./reviewerDeskTypes";
import { getMyEducations, getEducationVideos } from "./educationServiceApi";

/**
 * Creator ↔ Reviewer ↔ Edu "흐름" 연결 저장소
 *
 * 핵심 포인트(현재 패치 기준)
 * - EduPanel은 educationServiceApi 기반으로 직접 조회/재생(presign resolve 포함) → 더미 제거 완료
 * - 여기(reviewFlowStore)의 PublishedEduVideos 스토어는 "게시 목록" 뷰(있다면)를 위한 보조 스토어
 * - 기본 동작은 API를 진실로(로컬 optimistic는 옵션/전환기에만)
 */

export type EduVideoProgressRef = {
  educationId: string;
  videoId: string;
};

export type PublishedEduOrigin = "API" | "LOCAL";

export type PublishedEduVideo = {
  id: string; // UI 식별자
  sourceContentId: string;
  title: string;
  videoUrl: string; // 원본 URL(필요 시 consumer가 presign resolve)
  publishedAt: string;
  contentCategory?: string;

  /**
   * 진행률 PATCH용 백엔드 식별자
   * - API로부터 온 항목만 존재
   * - optimistic/local 항목은 undefined
   */
  progressRef?: EduVideoProgressRef;

  /**
   * optimistic/local 항목 스킵을 위한 원천 표시
   */
  origin?: PublishedEduOrigin;
};

type Listener = () => void;

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null;
}

function getProp(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  return obj[key];
}

function isoNow() {
  return new Date().toISOString();
}

function randId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function toMs(iso: unknown): number | undefined {
  if (typeof iso !== "string") return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

function trimStr(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function stripUrlQuery(url: string): string {
  const s = trimStr(url);
  if (!s) return "";
  const i = s.search(/[?#]/);
  const base = i >= 0 ? s.slice(0, i) : s;
  // origin 제거(절대/상대 혼용 대응)
  return base.replace(/^https?:\/\/[^/]+/i, "");
}

/* =====================================================================================
 * Review Store (Reviewer Desk)
 * ===================================================================================== */

let hydrated = false;

const reviewItemsById = new Map<string, ReviewWorkItem>();
const reviewListeners = new Set<Listener>();

/**
 * useSyncExternalStore 호환: getSnapshot은 "항상 같은 참조"를 반환해야 한다.
 * - reviewItemsSnapshot은 변경 시에만 새 배열로 교체한다.
 */
let reviewItemsSnapshot: ReviewWorkItem[] = [];

function emitReview() {
  reviewListeners.forEach((l) => l());
}

/**
 * Creator(useCreatorStudioController)의 applyReviewStoreSync가
 * 숫자(ms) 기반 키(reviewedAt/updatedAt)를 읽을 수 있도록 보강한다.
 */
function normalizeForCreatorSync(item: ReviewWorkItem): ReviewWorkItem {
  const base = item as unknown as UnknownRecord;

  const lastUpdatedIso =
    getProp(base, "lastUpdatedAt") ??
    getProp(base, "updatedAt") ??
    getProp(base, "submittedAt") ??
    getProp(base, "createdAt");

  const updatedAtRaw = getProp(base, "updatedAt");
  const updatedAtMs = typeof updatedAtRaw === "number" ? updatedAtRaw : toMs(lastUpdatedIso) ?? Date.now();

  const decisionIso = getProp(base, "approvedAt") ?? getProp(base, "rejectedAt") ?? getProp(base, "reviewedAt");

  const reviewedAtRaw = getProp(base, "reviewedAt");
  const reviewedAtMs = typeof reviewedAtRaw === "number" ? reviewedAtRaw : toMs(decisionIso);

  const comment =
    (typeof getProp(base, "comment") === "string" && trimStr(getProp(base, "comment"))) ||
    (typeof getProp(base, "rejectReason") === "string" && trimStr(getProp(base, "rejectReason"))) ||
    (typeof getProp(base, "rejectedComment") === "string" && trimStr(getProp(base, "rejectedComment"))) ||
    (typeof getProp(base, "reviewerComment") === "string" && trimStr(getProp(base, "reviewerComment"))) ||
    (typeof getProp(base, "note") === "string" && trimStr(getProp(base, "note"))) ||
    "";

  const out: UnknownRecord = {
    ...base,
    updatedAt: updatedAtMs,
  };

  if (typeof reviewedAtMs === "number" && reviewedAtMs > 0) {
    out.reviewedAt = reviewedAtMs;
  }

  if (comment) {
    out.comment = out.comment ?? comment;
    out.rejectReason = out.rejectReason ?? comment;
    out.rejectedComment = out.rejectedComment ?? comment;
    out.reviewerComment = out.reviewerComment ?? comment;
    out.note = out.note ?? comment;
  }

  return out as unknown as ReviewWorkItem;
}

/** 스냅샷 캐시 재빌드(변경 시에만 호출) */
function rebuildReviewSnapshot() {
  reviewItemsSnapshot = Array.from(reviewItemsById.values()).sort((a, b) => {
    const ta = (a.submittedAt ?? a.createdAt) || "";
    const tb = (b.submittedAt ?? b.createdAt) || "";
    return tb.localeCompare(ta);
  });
}

/**
 * ReviewerApiMock 초기 seed를 1회만 적재
 */
export function hydrateReviewStoreOnce(items: ReviewWorkItem[]) {
  if (hydrated) return;

  items.forEach((it) => {
    const normalized = normalizeForCreatorSync(it);
    reviewItemsById.set(normalized.id, normalized);
  });

  hydrated = true;

  rebuildReviewSnapshot();
  emitReview();

  // seed된 review item 중 이미 최종 승인/영상URL이 있는 경우, 로컬 게시 목록도 동기화(옵션)
  seedLocalPublishedFromReviewSnapshot();
}

export function subscribeReviewStore(listener: Listener) {
  reviewListeners.add(listener);
  return () => {
    reviewListeners.delete(listener);
  };
}

/** "매 호출마다 새 배열 생성" 금지 */
export function listReviewItemsSnapshot(): ReviewWorkItem[] {
  return reviewItemsSnapshot;
}

export function getReviewItemSnapshot(id: string) {
  return reviewItemsById.get(id);
}

/* =====================================================================================
 * Published Edu Videos Store
 * ===================================================================================== */

export type PublishedEduSourceMode = "API" | "DUAL" | "MOCK";

type PublishedEduSourceConfig = {
  mode: PublishedEduSourceMode;

  /**
   * 백엔드 "교육 게시 목록" 조회(fetch)
   * - 반환은 PublishedEduVideo[] 형태로 정규화된 결과여야 함
   */
  fetchPublished?: () => Promise<PublishedEduVideo[]>;

  /**
   * (선택) 최종 승인 시 백엔드 publish 트리거가 별도로 필요할 때 사용
   */
  pushPublished?: (published: PublishedEduVideo, fromReview: ReviewWorkItem) => Promise<void>;

  /**
   * API 모드에서도 승인 직후 UX 지연을 줄이기 위해
   * 로컬 publish(optimistic)를 API 목록에 병합해서 노출할지 여부.
   *
   * - "더미 제거" 관점에서 기본값은 false(= API 진실만)
   */
  optimisticInApi?: boolean;
};

const eduListeners = new Set<Listener>();

function emitEdu() {
  eduListeners.forEach((l) => l());
}

function coercePublishedMode(v: unknown): PublishedEduSourceMode {
  const s = String(v ?? "").toUpperCase();
  if (s === "MOCK") return "MOCK";
  if (s === "API") return "API";
  if (s === "DUAL") return "DUAL";
  // 기본값: 실서버 기준 API 진실
  return "API";
}

async function fetchPublishedEduVideosFromEducationApi(): Promise<PublishedEduVideo[]> {
  const nowIso = isoNow();

  const eduList = await getMyEducations();

  const perEdu = await Promise.all(
    eduList.map(async (edu) => {
      try {
        const videos = await getEducationVideos(edu.id);

        const eduId = edu.id;
        const eduTitle = edu.title ?? "교육";
        const eduType = edu.eduType;
        const eduCreatedAt = (edu as unknown as { createdAt?: string }).createdAt ?? nowIso;

        const mapped = videos
          .map((v) => {
            const fileUrl =
              (v as unknown as { fileUrl?: string; videoUrl?: string }).fileUrl ??
              (v as unknown as { fileUrl?: string; videoUrl?: string }).videoUrl;

            if (!fileUrl) return null;

            const rawVideoId = v.id;
            const fallbackUiId = `${eduId}:${String((v as unknown as { order?: number | string }).order ?? "") || "0"}`;

            const uiId = rawVideoId || fallbackUiId;

            const title = v.title ?? eduTitle;
            const publishedAt = (v as unknown as { createdAt?: string }).createdAt ?? eduCreatedAt;

            const item: PublishedEduVideo = {
              id: uiId,
              sourceContentId: eduId,
              title,
              videoUrl: fileUrl,
              publishedAt,
              contentCategory: eduType,
              origin: "API",
              progressRef: rawVideoId ? { educationId: eduId, videoId: rawVideoId } : undefined,
            };

            return item;
          })
          .filter(Boolean) as PublishedEduVideo[];

        return mapped;
      } catch (e) {
        console.warn("[reviewFlowStore] getEducationVideos failed:", edu.id, e);
        return [];
      }
    })
  );

  const out = perEdu.flat();

  out.sort(
    (a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.title.localeCompare(b.title)
  );

  return out;
}

function readEnvVar(key: string): unknown {
  const env = import.meta.env as unknown as UnknownRecord;
  return env[key];
}

let publishedConfig: PublishedEduSourceConfig = {
  mode: coercePublishedMode(readEnvVar("VITE_EDU_PUBLISHED_SOURCE") ?? readEnvVar("VITE_PUBLISHED_EDU_SOURCE")),
  optimisticInApi: false,
  fetchPublished: fetchPublishedEduVideosFromEducationApi,
  pushPublished: undefined,
};

/**
 * publishedLocal: 로컬 publish(옵티미스틱/전환기)
 * publishedFromApi: 백엔드 조회 결과(Truth)
 * publishedSnapshot: useSyncExternalStore 제공용(참조 안정성 필요)
 */
let publishedLocal: PublishedEduVideo[] = [];
let publishedFromApi: PublishedEduVideo[] = [];
let publishedSnapshot: PublishedEduVideo[] = [];

/** Published 정렬: publishedAt 내림차순 */
function sortPublishedDesc(list: PublishedEduVideo[]) {
  return [...list].sort((a, b) => {
    const ta = toMs(a.publishedAt) ?? 0;
    const tb = toMs(b.publishedAt) ?? 0;
    return tb - ta;
  });
}

/** id 기준 중복 제거 병합(우선순위: api 우선) */
function mergePublished(apiList: PublishedEduVideo[], localList: PublishedEduVideo[]) {
  const byId = new Map<string, PublishedEduVideo>();

  for (const v of apiList) byId.set(v.id, v);

  for (const v of localList) {
    const prev = byId.get(v.id);
    if (!prev) {
      byId.set(v.id, v);
      continue;
    }
    const p1 = toMs(prev.publishedAt) ?? 0;
    const p2 = toMs(v.publishedAt) ?? 0;
    if (p2 > p1) byId.set(v.id, v);
  }

  return sortPublishedDesc(Array.from(byId.values()));
}

function samePublishedArray(a: PublishedEduVideo[], b: PublishedEduVideo[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];

    const px = x.progressRef;
    const py = y.progressRef;

    if (
      x.id !== y.id ||
      x.publishedAt !== y.publishedAt ||
      x.videoUrl !== y.videoUrl ||
      x.title !== y.title ||
      x.sourceContentId !== y.sourceContentId ||
      (x.contentCategory ?? "") !== (y.contentCategory ?? "") ||
      (x.origin ?? "") !== (y.origin ?? "") ||
      (px?.educationId ?? "") !== (py?.educationId ?? "") ||
      (px?.videoId ?? "") !== (py?.videoId ?? "")
    ) {
      return false;
    }
  }

  return true;
}

function shouldUseLocalPublish(): boolean {
  const mode = publishedConfig.mode;
  if (mode === "MOCK") return true;
  if (mode === "DUAL") return true;
  // API
  return Boolean(publishedConfig.optimisticInApi);
}

/**
 * 스냅샷 재계산(변경 시에만 publishedSnapshot 참조 교체)
 */
function rebuildPublishedSnapshotAndEmitIfChanged(emit: boolean) {
  const mode = publishedConfig.mode;

  let next: PublishedEduVideo[] = [];

  if (mode === "MOCK") {
    next = publishedLocal;
  } else if (mode === "API") {
    next = publishedConfig.optimisticInApi ? mergePublished(publishedFromApi, publishedLocal) : publishedFromApi;
  } else {
    // DUAL
    next = mergePublished(publishedFromApi, publishedLocal);
  }

  const normalizedNext = mode === "MOCK" ? publishedLocal : next;

  if (!samePublishedArray(publishedSnapshot, normalizedNext)) {
    publishedSnapshot = normalizedNext;
    if (emit) emitEdu();
  }
}

/**
 * 외부에서 Published 소스 전환/설정
 */
export function configurePublishedEduSource(config: Partial<PublishedEduSourceConfig>) {
  publishedConfig = {
    ...publishedConfig,
    ...config,
  };

  rebuildPublishedSnapshotAndEmitIfChanged(true);
}

/**
 * 백엔드 게시 목록을 당겨와 publishedFromApi에 반영
 */
let refreshInFlight: Promise<void> | null = null;
let lastRefreshStartedAt = 0;

type RefreshOpts = {
  force?: boolean;
  minIntervalMs?: number;
};

function reconcileLocalWithApi(): boolean {
  if (publishedLocal.length === 0 || publishedFromApi.length === 0) return false;

  const apiKeys = new Set<string>();
  for (const a of publishedFromApi) {
    apiKeys.add(`${a.sourceContentId}::${stripUrlQuery(a.videoUrl)}`);
  }

  const nextLocal = publishedLocal.filter((l) => {
    if (l.origin !== "LOCAL") return true;
    const key = `${l.sourceContentId}::${stripUrlQuery(l.videoUrl)}`;
    return !apiKeys.has(key);
  });

  if (nextLocal.length !== publishedLocal.length) {
    publishedLocal = nextLocal;
    return true;
  }
  return false;
}

export async function refreshPublishedEduVideosFromApi(opts: RefreshOpts = {}) {
  const fetcher = publishedConfig.fetchPublished;
  if (!fetcher) return;

  const minIntervalMs = opts.minIntervalMs ?? 600;
  const now = Date.now();

  if (!opts.force && now - lastRefreshStartedAt < minIntervalMs) {
    if (refreshInFlight) return refreshInFlight;
    return;
  }

  if (refreshInFlight) return refreshInFlight;

  lastRefreshStartedAt = now;

  refreshInFlight = (async () => {
    try {
      const next = await fetcher();

      const normalized = (Array.isArray(next) ? next : [])
        .filter((v) => v && typeof v.id === "string" && v.id.trim().length > 0)
        .map((v) => {
          const vRec = isRecord(v as unknown) ? (v as unknown as UnknownRecord) : undefined;
          const altContentId = vRec ? trimStr(getProp(vRec, "contentId")) : "";

          const id = trimStr((v as PublishedEduVideo).id);
          const sourceContentId = trimStr((v as PublishedEduVideo).sourceContentId) || altContentId || id;

          const title = trimStr((v as PublishedEduVideo).title);
          const videoUrl = trimStr((v as PublishedEduVideo).videoUrl);
          const publishedAt = trimStr((v as PublishedEduVideo).publishedAt) || isoNow();

          const origin = (v as PublishedEduVideo).origin ?? "API";
          const progressRef = (v as PublishedEduVideo).progressRef;

          return {
            ...(v as PublishedEduVideo),
            id,
            sourceContentId,
            title,
            videoUrl,
            publishedAt,
            origin,
            progressRef,
          };
        });

      const sorted = sortPublishedDesc(normalized);

      const apiChanged = !samePublishedArray(publishedFromApi, sorted);
      if (apiChanged) publishedFromApi = sorted;

      const localChanged = reconcileLocalWithApi();

      if (apiChanged || localChanged) {
        rebuildPublishedSnapshotAndEmitIfChanged(true);
      }
    } catch (e) {
      console.warn("[reviewFlowStore] refreshPublishedEduVideosFromApi failed:", e);
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * polling 헬퍼(선택)
 */
export function startPublishedEduVideosPolling(intervalMs = 30_000) {
  let timer: number | null = null;

  const canUseWindow = typeof window !== "undefined" && typeof window.setInterval === "function";
  if (!canUseWindow) return () => {};

  void refreshPublishedEduVideosFromApi({ force: true });

  timer = window.setInterval(() => {
    void refreshPublishedEduVideosFromApi();
  }, Math.max(5_000, intervalMs));

  return () => {
    if (timer != null) window.clearInterval(timer);
    timer = null;
  };
}

export function subscribePublishedEduVideos(listener: Listener) {
  eduListeners.add(listener);
  return () => {
    eduListeners.delete(listener);
  };
}

export function listPublishedEduVideosSnapshot(): PublishedEduVideo[] {
  return publishedSnapshot;
}

/* =====================================================================================
 * Review ↔ Publish 연결 로직
 * ===================================================================================== */

/**
 * 로컬 publish upsert(불변 업데이트 + 최신을 앞에)
 */
function upsertLocalPublished(next: PublishedEduVideo) {
  const id = next.id;
  const rest = publishedLocal.filter((v) => v.id !== id);
  publishedLocal = [next, ...rest];
}

/**
 * review snapshot에서 최종 승인+videoUrl 존재인 항목을 publishedLocal에 seed
 * - "로컬을 쓰는 모드"에서만 수행
 */
function seedLocalPublishedFromReviewSnapshot() {
  if (!shouldUseLocalPublish()) return;

  for (const it of reviewItemsSnapshot) {
    if (it.status === "APPROVED" && trimStr(it.videoUrl).length > 0) {
      const published = toPublishedEduVideo(it, it.approvedAt ?? isoNow());
      upsertLocalPublished(published);
    }
  }
  rebuildPublishedSnapshotAndEmitIfChanged(true);
}

/**
 * ReviewWorkItem → PublishedEduVideo 변환
 */
function toPublishedEduVideo(reviewItem: ReviewWorkItem, publishedAt = isoNow()): PublishedEduVideo {
  const sourceContentId = reviewItem.contentId ?? reviewItem.id;

  return {
    id: `local:${sourceContentId}`,
    sourceContentId,
    title: reviewItem.title,
    videoUrl: trimStr(reviewItem.videoUrl),
    publishedAt,
    contentCategory: reviewItem.contentCategory,
    origin: "LOCAL",
    progressRef: undefined,
  };
}

export function upsertReviewItem(next: ReviewWorkItem) {
  const prev = reviewItemsById.get(next.id);

  const normalized = normalizeForCreatorSync(next);
  reviewItemsById.set(normalized.id, normalized);

  rebuildReviewSnapshot();
  emitReview();

  const prevStatus = prev?.status ?? "";
  const nextStatus = normalized.status ?? "";
  const prevVideo = trimStr(prev?.videoUrl);
  const nextVideo = trimStr(normalized.videoUrl);

  const shouldPublish =
    nextStatus === "APPROVED" && nextVideo.length > 0 && (prevStatus !== "APPROVED" || prevVideo !== nextVideo);

  if (shouldPublish) {
    void publishEduFromReviewItem(normalized);
  }
}

export function submitCreatorReviewRequest(input: {
  contentId: string;
  title: string;
  department: string;
  creatorName: string;
  contentCategory: ReviewWorkItem["contentCategory"];
  scriptText: string;
  videoUrl?: string;
}): ReviewWorkItem {
  const now = isoNow();
  const hasVideo = Boolean(input.videoUrl && input.videoUrl.trim().length > 0);

  const item: ReviewWorkItem = {
    id: randId("rw"),
    contentId: input.contentId,
    title: input.title,
    department: input.department,
    creatorName: input.creatorName,
    contentType: "VIDEO",
    contentCategory: input.contentCategory,

    createdAt: now,
    submittedAt: now,
    lastUpdatedAt: now,

    status: "REVIEW_PENDING",

    videoUrl: hasVideo ? (input.videoUrl as string) : "",
    durationSec: hasVideo ? 120 : 0,

    scriptText: input.scriptText,

    autoCheck: {
      piiRiskLevel: "low",
      piiFindings: [],
      bannedWords: [],
      qualityWarnings: [],
    },

    audit: [
      {
        id: randId("aud"),
        action: "CREATED",
        actor: input.creatorName,
        at: now,
        detail: "Creator Studio에서 생성",
      },
      {
        id: randId("aud"),
        action: "SUBMITTED",
        actor: input.creatorName,
        at: now,
        detail: hasVideo ? "2차(최종) 검토 요청" : "1차(스크립트) 검토 요청",
      },
    ],

    version: 1,
    riskScore: 10,
  };

  upsertReviewItem(item);
  return item;
}

export async function publishEduFromReviewItem(reviewItem: ReviewWorkItem) {
  const videoUrl = trimStr(reviewItem.videoUrl);
  if (!videoUrl) return;

  const publishedAt = isoNow();
  const next = toPublishedEduVideo(reviewItem, publishedAt);

  // 1) 로컬 optimistic는 "사용하도록 설정된 모드"에서만 반영
  if (shouldUseLocalPublish()) {
    upsertLocalPublished(next);
    rebuildPublishedSnapshotAndEmitIfChanged(true);
  }

  // 2) (선택) 서버 publish 트리거
  const pusher = publishedConfig.pushPublished;
  if (pusher) {
    try {
      await pusher(next, reviewItem);
    } catch (e) {
      console.warn("[reviewFlowStore] pushPublished failed:", e);
    }
  }

  // 3) API/DUAL에서는 서버 진실 refresh
  if (publishedConfig.mode !== "MOCK" && publishedConfig.fetchPublished) {
    await refreshPublishedEduVideosFromApi();
  }
}
