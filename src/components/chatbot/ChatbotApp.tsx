// src/components/chatbot/ChatbotApp.tsx

import React, { useCallback, useEffect, useRef, useState } from "react";
import "./chatbot.css";
import Sidebar from "./Sidebar";
import ChatWindow from "./ChatWindow";
import {
  sendChatToAI,
  sendChatToAIStream,
  sendFeedbackToAI,
  retryMessage,
  retryMessageStream,
  fetchFaqHome,
  fetchFaqList,
  submitReportToServer,
} from "./chatApi";
import keycloak from "../../keycloak";
import {
  type ChatDomain,
  type ChatMessage,
  type ChatRole,
  type ChatSession,
  type SidebarSessionSummary,
  type ChatRequest,
  type FeedbackValue,
  type ReportPayload,
  type ChatServiceDomain,
  type FaqHomeItem,
  type FaqItem,
  type ChatSendResult,
  type PlayEducationVideoParams,
  fromChatServiceDomain,
  normalizeServiceDomain,
} from "../../types/chat";
import {
  computePanelPosition,
  buildLastMessagePreview,
  buildSessionTitleFromMessage,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";
import { can, type UserRole } from "../../auth/roles";

// Re-export for backwards compatibility
export type { PlayEducationVideoParams } from "../../types/chat";

interface ChatbotAppProps {
  onClose: () => void;
  anchor?: Anchor | null;
  animationState?: "opening" | "closing";
  onAnimationEnd?: () => void;
  onOpenEduPanel?: () => void;
  onOpenQuizPanel?: (quizId?: string) => void;
  onOpenAdminPanel?: () => void;
  userRole: UserRole;
  onRequestFocus?: () => void;
  onOpenReviewerPanel?: () => void;
  onOpenCreatorPanel?: () => void;
  /** AI 응답에서 영상 재생 액션이 감지되었을 때 호출 */
  onPlayEducationVideo?: (params: PlayEducationVideoParams) => void;
}

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

type RetryMode = "retry" | "variant";

const MIN_WIDTH = 520;
const MIN_HEIGHT = 480;
const INITIAL_SIZE: Size = { width: 550, height: 550 };

// 최대 세션 개수 (FIFO 기준)
const MAX_SESSIONS = 30;

function asString(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function trimStr(v: unknown): string {
  return asString(v).trim();
}

function makeLocalId(prefix: string) {
  try {
    const uuid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`;
    return `${prefix}-${uuid}`;
  } catch {
    return `${prefix}-${Date.now()}`;
  }
}

function isUuidLike(v: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v
  );
}

function toEpochMs(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return fallback;
}

/**
 * ChatRole은 보통 "user" | "assistant"만 허용.
 * 서버가 system/other를 보내도 프론트 모델에선 "assistant"로 흡수.
 */
function normalizeRole(v: unknown): ChatRole {
  const s = asString(v).toLowerCase();
  if (s === "user" || s === "human") return "user";
  return "assistant";
}

function mergeHeaders(
  base: Record<string, string>,
  extra?: HeadersInit
): Record<string, string> {
  const out: Record<string, string> = { ...base };

  if (!extra) return out;

  if (extra instanceof Headers) {
    extra.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  if (Array.isArray(extra)) {
    for (const [k, v] of extra) out[k] = v;
    return out;
  }

  for (const [k, v] of Object.entries(extra)) out[k] = String(v);
  return out;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === target);
}

/**
 * (핵심 FIX) token race 흡수: Sidebar/History 호출이 토큰 준비 전에 스킵/401 나서
 * “첫 클릭은 로딩만 → 두 번째 클릭에 열림”이 발생하므로, 여기서 짧게 기다렸다가 진행.
 */
async function waitForAuthToken(opts?: {
  timeoutMs?: number;
  pollMs?: number;
  minUpdateIntervalMs?: number;
}): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 6_000;
  const pollMs = opts?.pollMs ?? 200;
  const minUpdateIntervalMs = opts?.minUpdateIntervalMs ?? 900;

  const start = Date.now();
  let lastUpdateAttempt = 0;

  const sleep = (ms: number) =>
    new Promise<void>((r) => window.setTimeout(r, ms));

  while (Date.now() - start < timeoutMs) {
    if (!keycloak?.authenticated) {
      await sleep(pollMs);
      continue;
    }

    if (keycloak.token) {
      // 한 번 갱신 시도(너무 자주 치지 않게 제한)
      const now = Date.now();
      if (
        typeof keycloak.updateToken === "function" &&
        now - lastUpdateAttempt >= minUpdateIntervalMs
      ) {
        lastUpdateAttempt = now;
        try {
          await keycloak.updateToken(30);
        } catch {
          // ignore
        }
      }
      return keycloak.token ?? null;
    }

    // authenticated인데 token이 아직 없으면 updateToken(0)로 채우기 시도
    const now = Date.now();
    if (
      typeof keycloak.updateToken === "function" &&
      now - lastUpdateAttempt >= minUpdateIntervalMs
    ) {
      lastUpdateAttempt = now;
      try {
        await keycloak.updateToken(0);
        if (keycloak.token) return keycloak.token;
      } catch {
        // ignore
      }
    }

    await sleep(pollMs);
  }

  // 마지막 best-effort
  try {
    if (keycloak?.authenticated && typeof keycloak.updateToken === "function") {
      await keycloak.updateToken(30);
    }
  } catch {
    // ignore
  }

  return keycloak?.token ?? null;
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const token = await waitForAuthToken({ timeoutMs: 6_000, pollMs: 200 });
  if (token) headers.Authorization = `Bearer ${token}`;

  return headers;
}

async function apiFetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<
  { ok: true; data: T } | { ok: false; status: number; text: string }
> {
  const authHeaders = await buildAuthHeaders();
  const mergedHeaders = mergeHeaders(authHeaders, init?.headers);

  const hasBody = init?.body != null;
  if (hasBody && !hasHeader(mergedHeaders, "Content-Type")) {
    mergedHeaders["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(url, { ...init, headers: mergedHeaders });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, text };

    try {
      const data = (text ? (JSON.parse(text) as unknown) : null) as T;
      return { ok: true, data };
    } catch {
      return { ok: false, status: res.status, text };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, text: msg || "network error" };
  }
}

/* =========================
   Server history (messages) - 방어/페이징
========================= */

type ServerHistoryMessage = {
  id?: string;
  messageId?: string;
  role?: string;
  sender?: string;
  content?: string;
  text?: string;
  createdAt?: number | string;
  created_at?: number | string;
  timestamp?: number | string;
};

type ServerMessagesPage = {
  messages?: ServerHistoryMessage[];
  items?: ServerHistoryMessage[];
  history?: ServerHistoryMessage[];
  nextCursor?: string | null;
  cursor?: string | null;
  hasNext?: boolean;
  has_next?: boolean;
};

type ServerSessionListItem = {
  id?: string;
  title?: string;
  domain?: string;
  createdAt?: string;
  updatedAt?: string;
  userUuid?: string;
};

type ServerSessionListResponse = {
  sessions?: ServerSessionListItem[];
  items?: ServerSessionListItem[];
  nextCursor?: string | null;
  hasNext?: boolean;
};

function pickMessagesArray(page: ServerMessagesPage): ServerHistoryMessage[] {
  return page.messages ?? page.items ?? page.history ?? [];
}

async function fetchServerSessionMeta(serverSessionId: string): Promise<{
  title: string;
  domain: ChatDomain;
  createdAt: number;
  updatedAt: number;
} | null> {
  const directCandidates = [
    `/api/chat/sessions/${encodeURIComponent(serverSessionId)}`,
  ];

  for (const url of directCandidates) {
    const r = await apiFetchJson<ServerSessionListItem>(url, { method: "GET" });
    if (!r.ok) continue;
    const it = r.data ?? {};
    const title = trimStr(it.title) || "서버 대화";
    const domain = fromChatServiceDomain(it.domain, "general");
    const now = Date.now();
    return {
      title,
      domain,
      createdAt: toEpochMs(it.createdAt, now),
      updatedAt: toEpochMs(it.updatedAt, now),
    };
  }

  const listUrl = `/api/chat/sessions?size=100`;
  const lr = await apiFetchJson<ServerSessionListResponse>(listUrl, {
    method: "GET",
  });
  if (!lr.ok) return null;

  const list = lr.data?.sessions ?? lr.data?.items ?? [];
  const found = list.find((s) => s?.id === serverSessionId) ?? null;
  if (!found) return null;

  const title = trimStr(found.title) || "서버 대화";
  const domain = fromChatServiceDomain(found.domain, "general");
  const now = Date.now();
  return {
    title,
    domain,
    createdAt: toEpochMs(found.createdAt, now),
    updatedAt: toEpochMs(found.updatedAt, now),
  };
}

async function fetchServerSessionHistory(serverSessionId: string): Promise<{
  serverSessionId: string;
  title: string;
  domain: ChatDomain;
  createdAt: number;
  updatedAt: number;
  messages: Array<{
    role: ChatRole;
    content: string;
    createdAt: number;
    serverMessageId?: string;
  }>;
} | null> {
  const meta = (await fetchServerSessionMeta(serverSessionId)) ?? {
    title: "서버 대화",
    domain: "general" as ChatDomain,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // 스펙 엔드포인트 시도: GET /api/chat/sessions/{sessionId}/history
  // 스펙 응답: { sessionId, title, messages: [...] }
  const historyUrl = `/api/chat/sessions/${encodeURIComponent(
    serverSessionId
  )}/history`;
  const historyResponse = await apiFetchJson<{
    sessionId?: string;
    title?: string;
    messages?: ServerHistoryMessage[];
  }>(historyUrl, { method: "GET" });

  if (historyResponse.ok && historyResponse.data) {
    const historyData = historyResponse.data;
    const messages = pickMessagesArray(historyData);

    if (messages.length > 0) {
      const now = Date.now();
      const normalized = messages
        .filter((m) => trimStr((m.content ?? m.text)?.toString()).length > 0)
        .map((m, idx) => {
          const role = normalizeRole(m.role ?? m.sender);
          const content = trimStr(m.content ?? m.text ?? "");
          const created = toEpochMs(
            m.createdAt ?? m.created_at ?? m.timestamp,
            now + idx
          );

          return {
            role,
            content,
            createdAt: created,
            serverMessageId: (m.id ?? m.messageId) as string | undefined,
          };
        });

      const updatedAt =
        normalized.length > 0
          ? normalized[normalized.length - 1].createdAt
          : meta.updatedAt;

      // 스펙 응답에서 title이 있으면 사용
      const finalTitle = trimStr(historyData.title) || meta.title;

      return {
        serverSessionId,
        title: finalTitle,
        domain: meta.domain,
        createdAt: meta.createdAt,
        updatedAt,
        messages: normalized,
      };
    }
  }

  // Fallback: 기존 엔드포인트 사용 (/chat/sessions/{sessionId}/messages)
  const pageSize = 100;
  let cursor: string | null = null;
  let hasNext = true;

  const all: ServerHistoryMessage[] = [];
  let guard = 0;

  while (hasNext && guard < 20) {
    guard += 1;

    const url =
      cursor && trimStr(cursor)
        ? `/chat/sessions/${encodeURIComponent(
            serverSessionId
          )}/messages?size=${pageSize}&cursor=${encodeURIComponent(cursor)}`
        : `/chat/sessions/${encodeURIComponent(
            serverSessionId
          )}/messages?size=${pageSize}`;

    const r = await apiFetchJson<ServerMessagesPage>(url, { method: "GET" });
    if (!r.ok) {
      console.warn("[ChatbotApp] fetchServerSessionHistory failed:", {
        serverSessionId,
        status: r.status,
        text: r.text,
      });
      return null;
    }

    const page = r.data ?? {};
    const chunk = pickMessagesArray(page);
    all.push(...chunk);

    const nextCursor = (page.nextCursor ?? page.cursor ?? null) as
      | string
      | null;
    const hn = (page.hasNext ?? page.has_next ?? false) as boolean;

    cursor = nextCursor && trimStr(nextCursor) ? asString(nextCursor) : null;
    hasNext = Boolean(hn && cursor);
  }

  const now = Date.now();

  const normalized = all
    .filter((m) => trimStr((m.content ?? m.text)?.toString()).length > 0)
    .map((m, idx) => {
      const role = normalizeRole(m.role ?? m.sender);
      const content = trimStr(m.content ?? m.text ?? "");
      const created = toEpochMs(
        m.createdAt ?? m.created_at ?? m.timestamp,
        now + idx
      );

      return {
        role,
        content,
        createdAt: created,
        serverMessageId: (m.id ?? m.messageId) as string | undefined,
      };
    });

  const updatedAt =
    normalized.length > 0
      ? normalized[normalized.length - 1].createdAt
      : meta.updatedAt;

  return {
    serverSessionId,
    title: meta.title,
    domain: meta.domain,
    createdAt: meta.createdAt,
    updatedAt,
    messages: normalized,
  };
}

async function deleteServerSession(serverSessionId: string): Promise<boolean> {
  const candidates = [
    `/api/chat/sessions/${encodeURIComponent(serverSessionId)}`,
    `/chat/sessions/${encodeURIComponent(serverSessionId)}`,
  ];

  let lastErr: { status: number; text: string } | null = null;

  for (const url of candidates) {
    const r = await apiFetchJson<unknown>(url, { method: "DELETE" });
    if (r.ok) return true;
    lastErr = { status: r.status, text: r.text };
  }

  console.warn("[ChatbotApp] deleteServerSession failed:", {
    serverSessionId,
    lastErr,
  });
  return false;
}

/* =========================
   default domain from token (no-any)
========================= */

function getTokenParsedDomain(tokenParsed: unknown): unknown {
  if (!tokenParsed || typeof tokenParsed !== "object") return undefined;
  if (!("domain" in tokenParsed)) return undefined;
  return (tokenParsed as { domain?: unknown }).domain;
}

function getDefaultUiDomainFromToken(): ChatDomain {
  const parsed = keycloak?.tokenParsed as unknown;
  const d = getTokenParsedDomain(parsed);
  const sd = normalizeServiceDomain(d);
  return fromChatServiceDomain(sd, "general");
}

/* =========================
   initial sessions
========================= */

function createInitialSession(): ChatSession {
  const now = Date.now();
  return {
    id: makeLocalId("local-session"),
    title: "새 채팅",
    createdAt: now,
    updatedAt: now,
    domain: getDefaultUiDomainFromToken(),
    messages: [],
    serverId: undefined,
  };
}

const initialSessions: ChatSession[] = [createInitialSession()];

/* =========================
   신고 의도 간단 감지
========================= */

function shouldSuggestReport(raw: string): boolean {
  const compact = raw.replace(/\s+/g, "");

  const keywords = [
    "신고하고싶어",
    "신고하고싶어요",
    "신고하고싶은데",
    "괴롭힘신고",
    "괴롭힘을신고",
    "성희롱신고",
    "성희롱을신고",
  ];

  if (keywords.some((k) => compact.includes(k))) return true;
  if (compact.includes("괴롭힘") && compact.includes("신고")) return true;
  if (compact.includes("성희롱") && compact.includes("신고")) return true;

  return false;
}

/* =========================
   FAQ
========================= */

function isLikelyUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return isUuidLike(v);
}

const ChatbotApp: React.FC<ChatbotAppProps> = ({
  onClose,
  anchor,
  animationState,
  onAnimationEnd,
  onOpenEduPanel,
  onOpenQuizPanel,
  onOpenAdminPanel,
  userRole,
  onRequestFocus,
  onOpenReviewerPanel,
  onOpenCreatorPanel,
  onPlayEducationVideo,
}) => {
  // 패널 크기 + 위치
  const [size, setSize] = useState<Size>(INITIAL_SIZE);
  const [panelPos, setPanelPos] = useState(() =>
    computePanelPosition(anchor ?? null, INITIAL_SIZE)
  );

  // 사이드바 접힘 상태
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // 세션 목록 + 현재 선택된 세션
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessions[0]?.id ?? null
  );

  // 최신 sessions 참조(stale 방지)
  const sessionsRef = useRef<ChatSession[]>(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // 검색어
  const [searchTerm, setSearchTerm] = useState("");

  // 전송 중 상태
  const [isSending, setIsSending] = useState(false);

  // 피드백 요청 중인 메시지 ID Set (in-flight 차단용)
  const [feedbackLoadingIds, setFeedbackLoadingIds] = useState<Set<string>>(
    () => new Set()
  );

  // 재시도 요청 중인 메시지 ID (in-flight 차단용)
  const [retryLoadingMessageId, setRetryLoadingMessageId] = useState<string | null>(null);

  // 토스트 메시지 상태 (에러 알림용)
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  // 토스트 표시 헬퍼
  const showToast = useCallback((message: string, durationMs = 3000) => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, durationMs);
  }, []);

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

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // transform-origin (아이콘 위치 기준)
  let transformOrigin = "85% 100%";
  if (anchor) {
    const relX = ((anchor.x - panelPos.left) / size.width) * 100;
    const relY = ((anchor.y - panelPos.top) / size.height) * 100;
    const originX = Math.max(-50, Math.min(150, relX));
    const originY = Math.max(-50, Math.min(150, relY));
    transformOrigin = `${originX}% ${originY}%`;
  }

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  // ====== 리사이즈 + 드래그 공통 처리 ======
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      const margin = 16;
      const padding = 32;

      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - padding * 2);
        const maxHeight = Math.max(
          MIN_HEIGHT,
          window.innerHeight - padding * 2
        );

        const { startWidth, startHeight, startTop, startLeft, dir } =
          resizeState;

        let width = startWidth;
        let height = startHeight;
        let top = startTop;
        let left = startLeft;

        if (dir.includes("e")) width = startWidth + dx;
        if (dir.includes("s")) height = startHeight + dy;

        if (dir.includes("w")) {
          width = startWidth - dx;
          left = startLeft + dx;
        }
        if (dir.includes("n")) {
          height = startHeight - dy;
          top = startTop + dy;
        }

        width = Math.max(MIN_WIDTH, Math.min(maxWidth, width));
        height = Math.max(MIN_HEIGHT, Math.min(maxHeight, height));

        const maxLeft = window.innerWidth - margin - width;
        const maxTop = window.innerHeight - margin - height;

        left = Math.max(margin, Math.min(maxLeft, left));
        top = Math.max(margin, Math.min(maxTop, top));

        setSize({ width, height });
        setPanelPos({ top, left });
        return;
      }

      if (dragState.dragging) {
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        let top = dragState.startTop + dy;
        let left = dragState.startLeft + dx;

        const margin2 = 16;
        const maxLeft = window.innerWidth - margin2 - size.width;
        const maxTop = window.innerHeight - margin2 - size.height;

        left = Math.max(margin2, Math.min(maxLeft, left));
        top = Math.max(margin2, Math.min(maxTop, top));

        setPanelPos({ top, left });
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

  // 창 리사이즈 시 챗봇 패널 크기/위치를 화면 안으로 보정
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleWindowResize = () => {
      const margin = 16;
      const padding = 32;

      const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - padding * 2);
      const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - padding * 2);

      setSize((prevSize) => {
        const width = Math.min(prevSize.width, maxWidth);
        const height = Math.min(prevSize.height, maxHeight);

        setPanelPos((prevPos) => {
          const maxLeft = window.innerWidth - margin - width;
          const maxTop = window.innerHeight - margin - height;

          let left = prevPos.left;
          let top = prevPos.top;

          left = Math.max(margin, Math.min(maxLeft, left));
          top = Math.max(margin, Math.min(maxTop, top));

          return { top, left };
        });

        return { width, height };
      });
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  const handleResizeMouseDown =
    (dir: ResizeDirection) => (event: React.MouseEvent<HTMLDivElement>) => {
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

  function createLocalSession(now: number): ChatSession {
    return {
      id: makeLocalId("local-session"),
      title: "새 채팅",
      createdAt: now,
      updatedAt: now,
      domain: getDefaultUiDomainFromToken(),
      messages: [],
      serverId: undefined,
    };
  }

  // ====== 서버 세션 ↔ 로컬 세션 동기화 핵심 ======

  const findLocalSessionByServerId = useCallback(
    (serverSessionId: string, list: ChatSession[]) =>
      list.find((s) => s.serverId === serverSessionId) ?? null,
    []
  );

  const upsertSessionWithFifo = useCallback(
    (_prev: ChatSession[], next: ChatSession[]) => {
      if (next.length <= MAX_SESSIONS) return next;

      let oldestIndex = 0;
      for (let i = 1; i < next.length; i += 1) {
        if (next[i].createdAt < next[oldestIndex].createdAt) {
          oldestIndex = i;
        }
      }

      const pruned = [...next];
      pruned.splice(oldestIndex, 1);
      return pruned;
    },
    []
  );

  const handleHydrateServerSession = useCallback(
    (payload: {
      serverSessionId: string;
      title: string;
      domain: ChatDomain;
      createdAt: number;
      updatedAt: number;
      messages: Array<{
        role: ChatRole;
        content: string;
        createdAt: number;
        serverMessageId?: string;
      }>;
      raw?: unknown;
    }) => {
      if (!payload?.serverSessionId || !isUuidLike(payload.serverSessionId))
        return;

      setSessions((prev) => {
        const byServer = prev.find(
          (s) => s.serverId === payload.serverSessionId
        );
        const byIdFallback = prev.find((s) => s.id === payload.serverSessionId);
        const target = byServer ?? byIdFallback ?? null;

        // (핵심) target이 없으면 id를 serverSessionId로 고정
        const targetId = target?.id ?? payload.serverSessionId;

        const normalizedMessages: ChatMessage[] = payload.messages
          .filter((m) => trimStr(m.content).length > 0)
          .map((m) => ({
            id: makeLocalId("local-msg"),
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            serverId: m.serverMessageId,
          }));

        const hydrated: ChatSession = {
          id: targetId,
          title: payload.title || "새 채팅",
          createdAt: payload.createdAt || Date.now(),
          updatedAt: payload.updatedAt || Date.now(),
          domain: payload.domain || "general",
          messages: normalizedMessages,
          serverId: payload.serverSessionId,
        };

        const next: ChatSession[] = target
          ? prev.map((s) => (s.id === targetId ? hydrated : s))
          : [hydrated, ...prev];

        return upsertSessionWithFifo(prev, next);
      });
    },
    [upsertSessionWithFifo]
  );

  const getServerSessionIdForLocalSession = useCallback(
    (localSessionId: string) => {
      const s = sessionsRef.current.find((x) => x.id === localSessionId);
      return s?.serverId;
    },
    []
  );

  const ensureHydratedByServerId = useCallback(
    async (serverSessionId: string) => {
      const res = await fetchServerSessionHistory(serverSessionId);
      if (!res) return;

      handleHydrateServerSession({
        serverSessionId: res.serverSessionId,
        title: res.title,
        domain: res.domain,
        createdAt: res.createdAt,
        updatedAt: res.updatedAt,
        messages: res.messages,
        raw: res,
      });
    },
    [handleHydrateServerSession]
  );

  const handleSelectServerSession = useCallback(
    (serverSessionId: string) => {
      if (!serverSessionId || !isUuidLike(serverSessionId)) return;

      // (핵심) 이미 로컬에 있으면 그대로 사용
      const existing =
        findLocalSessionByServerId(serverSessionId, sessionsRef.current) ??
        sessionsRef.current.find((s) => s.id === serverSessionId) ??
        null;

      if (existing) {
        setActiveSessionId(existing.id);
        if (existing.serverId && existing.messages.length === 0) {
          void ensureHydratedByServerId(existing.serverId);
        } else if (!existing.serverId) {
          // id 자체가 serverSessionId인 케이스
          void ensureHydratedByServerId(serverSessionId);
        }
        return;
      }

      const now = Date.now();

      // (핵심 FIX) placeholder id를 serverSessionId로 고정 → hydrate 후에도 activeSessionId 안정
      const placeholderId = serverSessionId;

      const placeholder: ChatSession = {
        id: placeholderId,
        title: "불러오는 중…",
        createdAt: now,
        updatedAt: now,
        domain: getDefaultUiDomainFromToken(),
        messages: [],
        serverId: serverSessionId,
      };

      setSessions((prev) =>
        upsertSessionWithFifo(prev, [placeholder, ...prev])
      );
      setActiveSessionId(placeholderId);

      void ensureHydratedByServerId(serverSessionId);
    },
    [
      ensureHydratedByServerId,
      findLocalSessionByServerId,
      upsertSessionWithFifo,
    ]
  );

  // ====== 로컬 세션 관리 ======

  const handleNewChat = () => {
    const now = Date.now();
    const newSession = createLocalSession(now);

    setSessions((prev) => {
      const next = [newSession, ...prev];
      return upsertSessionWithFifo(prev, next);
    });

    setActiveSessionId(newSession.id);
  };

  const handleSelectSession = (sessionId: string) => {
    const exists = sessionsRef.current.some((s) => s.id === sessionId);
    if (!exists && isUuidLike(sessionId)) {
      handleSelectServerSession(sessionId);
      return;
    }

    setActiveSessionId(sessionId);

    const s = sessionsRef.current.find((x) => x.id === sessionId);
    if (s?.serverId && s.messages.length === 0) {
      void ensureHydratedByServerId(s.serverId);
    }
  };

  const handleRenameSession = (sessionId: string, newTitle: string) => {
    const trimmed = trimStr(newTitle);
    if (!trimmed) return;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, title: trimmed, updatedAt: Date.now() } : s
      )
    );
  };

  const handleDeleteSession = (sessionId: string) => {
    const byLocal = sessionsRef.current.find((s) => s.id === sessionId) ?? null;
    const byServer =
      sessionsRef.current.find((s) => s.serverId === sessionId) ?? null;

    const target = byLocal ?? byServer;
    const serverSessionId =
      target?.serverId ?? (isUuidLike(sessionId) ? sessionId : undefined);

    void (async () => {
      if (serverSessionId) {
        const ok = await deleteServerSession(serverSessionId);
        if (!ok) return;
      }

      setSessions((prev) => {
        const next = prev.filter(
          (s) => s.id !== (target?.id ?? sessionId) && s.serverId !== sessionId
        );

        if (activeSessionId === (target?.id ?? sessionId)) {
          setActiveSessionId(next[0]?.id ?? null);
        }

        return next;
      });
    })();
  };

  const handleSearchTermChange = (value: string) => {
    setSearchTerm(value);
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const handleChangeSessionDomain = (nextDomain: ChatDomain) => {
    if (!activeSessionId) return;
    const now = Date.now();

    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSessionId
          ? { ...session, domain: nextDomain, updatedAt: now }
          : session
      )
    );
  };

  const sidebarSessions: SidebarSessionSummary[] = sessions.map((session) => {
    const last = session.messages[session.messages.length - 1];
    const lastMessage = last ? buildLastMessagePreview(last.content) : "";

    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      domain: session.domain,
      lastMessage,
    };
  });

  /* =========================
     FAQ state (API 연동)
  ========================= */

  const [faqHome, setFaqHome] = useState<FaqHomeItem[]>([]);
  const [faqHomeLoading, setFaqHomeLoading] = useState(false);

  const faqHomeRef = useRef<FaqHomeItem[]>([]);
  const faqIndexByIdRef = useRef<Map<string, FaqItem>>(new Map());
  const faqHomeByIndexRef = useRef<
    Map<number, { faqId: string; domain: ChatServiceDomain }>
  >(new Map());
  const faqListCacheRef = useRef<Map<string, FaqItem[]>>(new Map());

  // 토큰 준비 레이스를 잡기 위한 auth-ready 트리거
  const [authReadyTick, setAuthReadyTick] = useState(0);
  const hadAuthTokenRef = useRef(false);

  useEffect(() => {
    const check = () => {
      const authed = Boolean(keycloak?.authenticated);
      const token = keycloak?.token ?? null;

      if (authed && token) {
        if (!hadAuthTokenRef.current) {
          hadAuthTokenRef.current = true;
          setAuthReadyTick((x) => x + 1);
        }
      } else {
        hadAuthTokenRef.current = false;
      }
    };

    check();
    const id = window.setInterval(check, 500);
    return () => window.clearInterval(id);
  }, []);

  // FAQ Home 로딩: mount + (토큰 준비 후) 재시도
  useEffect(() => {
    let alive = true;

    void (async () => {
      setFaqHomeLoading(true);
      try {
        const items = await fetchFaqHome();
        const safe = Array.isArray(items) ? items : [];

        if (!alive) return;

        setFaqHome(safe);
        faqHomeRef.current = safe;

        const map = new Map<
          number,
          { faqId: string; domain: ChatServiceDomain }
        >();
        safe.forEach((it, idx) => {
          map.set(idx, { faqId: it.faqId, domain: it.domain });
        });
        faqHomeByIndexRef.current = map;
      } catch (e) {
        if (!alive) return;
        console.warn("[ChatbotApp] fetchFaqHome failed:", e);
        setFaqHome([]);
        faqHomeRef.current = [];
        faqHomeByIndexRef.current = new Map();
      } finally {
        if (alive) setFaqHomeLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [authReadyTick]);

  // FAQ list 캐싱: “빈 배열 고착” 방지
  const ensureFaqListCached = useCallback(async (domain: ChatServiceDomain) => {
    const key = String(domain).toUpperCase();
    const cached = faqListCacheRef.current.get(key);
    if (cached && cached.length > 0) return cached;

    const list = await fetchFaqList(domain);
    const safe = Array.isArray(list) ? list : [];

    if (safe.length > 0) {
      faqListCacheRef.current.set(key, safe);
      for (const item of safe) {
        faqIndexByIdRef.current.set(item.id, item);
      }
    } else {
      faqListCacheRef.current.delete(key);
    }

    return safe;
  }, []);

  // ====== FAQ 빠른 질문: API 기반으로 Q/A 추가 (AI 호출 없음) ======
  const handleFaqQuickSend = useCallback(
    (faqKey: number | string) => {
      void (async () => {
        if (!activeSessionId) return;

        const now = Date.now();

        // faqId/domain 추론
        let faqId: string | null = null;
        let domain: ChatServiceDomain | null = null;

        if (typeof faqKey === "string" && isLikelyUuid(faqKey)) {
          faqId = faqKey;
        } else if (typeof faqKey === "number") {
          const hit = faqHomeByIndexRef.current.get(faqKey);
          if (hit) {
            faqId = hit.faqId;
            domain = hit.domain;
          }
        } else if (typeof faqKey === "string") {
          faqId = trimStr(faqKey) || null;
        }

        if (!faqId) {
          const msg: ChatMessage = {
            id: makeLocalId("local-msg"),
            role: "assistant",
            content:
              "FAQ 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
            createdAt: now,
          };
          setSessions((prev) =>
            prev.map((s) =>
              s.id === activeSessionId
                ? { ...s, messages: [...s.messages, msg], updatedAt: now }
                : s
            )
          );
          return;
        }

        // 1) 캐시에서 바로 찾기
        let item = faqIndexByIdRef.current.get(faqId) ?? null;

        // 2) domain을 아는 경우 해당 domain list 캐시/로딩 후 찾기
        if (!item && domain) {
          const list = await ensureFaqListCached(domain);
          item = list.find((x) => x.id === faqId) ?? null;
        }

        // 3) domain을 모르면 home의 도메인들을 순회하며 찾기
        if (!item) {
          const home = faqHomeRef.current ?? [];
          const domains = Array.from(
            new Set(home.map((h) => String(h.domain).toUpperCase()))
          );
          for (const d of domains) {
            const list = await ensureFaqListCached(d as ChatServiceDomain);
            const found = list.find((x) => x.id === faqId);
            if (found) {
              item = found;
              domain = found.domain;
              break;
            }
          }
        }

        if (!item) {
          const msg: ChatMessage = {
            id: makeLocalId("local-msg"),
            role: "assistant",
            content: "FAQ 항목을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.",
            createdAt: now,
          };
          setSessions((prev) =>
            prev.map((s) =>
              s.id === activeSessionId
                ? { ...s, messages: [...s.messages, msg], updatedAt: now }
                : s
            )
          );
          return;
        }

        // FAQ 모드 유지: domain을 "faq"로 설정하여 입력창 숨김 및 카테고리 칩 계속 표시
        const targetDomain: ChatDomain = "faq";

        setSessions((prev) =>
          prev.map((session) => {
            if (session.id !== activeSessionId) return session;

            const hasUserMessage = session.messages.some(
              (m) => m.role === "user"
            );
            const isDefaultTitle = session.title.startsWith("새 채팅");

            const nextTitle =
              !hasUserMessage && isDefaultTitle
                ? buildSessionTitleFromMessage(item.question)
                : session.title;

            const userMessage: ChatMessage = {
              id: makeLocalId("local-msg"),
              role: "user",
              content: item.question,
              createdAt: now,
            };

            const assistantMessage: ChatMessage = {
              id: makeLocalId("local-msg"),
              role: "assistant",
              content: item.answer,
              createdAt: now + 1,
            };

            return {
              ...session,
              title: nextTitle,
              domain: targetDomain,
              messages: [...session.messages, userMessage, assistantMessage],
              updatedAt: now + 1,
            };
          })
        );
      })();
    },
    [activeSessionId, ensureFaqListCached]
  );

  // ====== 메시지 전송 전체 플로우 (일반 채팅: AI 호출) ======
  const handleSendMessage = (text: string) => {
    void processSendMessage(text);
  };

  const processSendMessage = async (text: string) => {
    const trimmed = trimStr(text);
    if (!trimmed) return;

    const currentSessions = sessionsRef.current;
    const sessionIdForSend =
      activeSessionId ??
      (currentSessions.length > 0 ? currentSessions[0].id : null);
    if (!sessionIdForSend) return;

    const now = Date.now();
    const currentSession = currentSessions.find(
      (s) => s.id === sessionIdForSend
    );
    if (!currentSession) return;

    const userMessage: ChatMessage = {
      id: makeLocalId("local-msg"),
      role: "user",
      content: trimmed,
      createdAt: now,
    };

    const hasUserMessage = currentSession.messages.some(
      (m) => m.role === "user"
    );
    const isDefaultTitle = currentSession.title.startsWith("새 채팅");

    const nextTitle =
      !hasUserMessage && isDefaultTitle
        ? buildSessionTitleFromMessage(trimmed)
        : currentSession.title;

    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionIdForSend
          ? {
              ...session,
              title: nextTitle,
              messages: [...session.messages, userMessage],
              updatedAt: now,
            }
          : session
      )
    );

    if (shouldSuggestReport(trimmed)) {
      const suggestionTime = now + 1;
      const suggestionMessage: ChatMessage = {
        id: makeLocalId("local-msg"),
        role: "assistant",
        content:
          "신고 절차를 알려드릴게요! 부적절한 상황이라면 지금 바로 신고할 수 있어요.",
        createdAt: suggestionTime,
        kind: "reportSuggestion",
      };

      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionIdForSend
            ? {
                ...session,
                messages: [...session.messages, suggestionMessage],
                updatedAt: suggestionTime,
              }
            : session
        )
      );

      return;
    }

    const requestPayload: ChatRequest = {
      sessionId: sessionIdForSend,
      serverSessionId: currentSession.serverId,
      domain: currentSession.domain,
      messages: [...currentSession.messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    try {
      setIsSending(true);

      // 기본값을 true로: env 미설정이어도 스트리밍 경로(sendChatToAIStream)를 반드시 탄다.
      // 서버가 스트림을 못 주면 chatApi.ts에서 자동 fallback 처리한다.
      const ENABLE_CHAT_STREAMING =
        String(import.meta.env.VITE_CHAT_STREAMING ?? "true").toLowerCase() ===
        "true";
      try {
        setIsSending(true);

        if (ENABLE_CHAT_STREAMING) {
          // 1) placeholder assistant 메시지 생성
          const placeholderId = makeLocalId("local-msg");
          const placeholderTime = Date.now();

          const placeholder: ChatMessage = {
            id: placeholderId,
            role: "assistant",
            content: "",
            createdAt: placeholderTime,
          };

          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionIdForSend
                ? {
                    ...session,
                    messages: [...session.messages, placeholder],
                    updatedAt: placeholderTime,
                  }
                : session
            )
          );

          let acc = "";

          const final = await sendChatToAIStream(requestPayload, {
            onDelta: (delta: string) => {
              acc += delta;

              // placeholder content 업데이트
              setSessions((prev) =>
                prev.map((session) => {
                  if (session.id !== sessionIdForSend) return session;

                  const nextMessages = session.messages.map((m) =>
                    m.id === placeholderId ? { ...m, content: acc } : m
                  );

                  return {
                    ...session,
                    messages: nextMessages,
                    updatedAt: Date.now(),
                  };
                })
              );
            },
            onFinal: (f: ChatSendResult) => {
              // 최종 serverId / sessionId 확정
              setSessions((prev) =>
                prev.map((session) => {
                  if (session.id !== sessionIdForSend) return session;

                  const nextMessages = session.messages.map((m) =>
                    m.id === placeholderId
                      ? {
                          ...m,
                          content: f.content || acc,
                          serverId: f.messageId,
                        }
                      : m
                  );

                  return {
                    ...session,
                    serverId: session.serverId ?? f.sessionId,
                    messages: nextMessages,
                    updatedAt: Date.now(),
                  };
                })
              );

              // AI 응답에 영상 재생 액션이 있으면 처리
              if (
                f.action?.type === "PLAY_VIDEO" &&
                f.action.educationId &&
                f.action.videoId
              ) {
                onPlayEducationVideo?.({
                  educationId: f.action.educationId,
                  videoId: f.action.videoId,
                  resumePositionSeconds: f.action.resumePositionSeconds,
                });
              }
              // AI 응답에 퀴즈 패널 열기 액션이 있으면 처리
              if (f.action?.type === "OPEN_QUIZ") {
                onOpenQuizPanel?.(f.action.educationId || f.action.quizId);
              }
              // AI 응답에 교육 패널 열기 액션이 있으면 처리
              if (f.action?.type === "OPEN_EDU_PANEL") {
                onOpenEduPanel?.();
              }
            },
          });

          // sendChatToAIStream 내부에서 UI 업데이트를 끝내지만,
          // 여기서 final을 안 쓰면 lint가 불편할 수 있어 유지
          void final;
        } else {
          // 기존 non-stream
          const reply = await sendChatToAI(requestPayload);
          const replyTime = Date.now();

          const assistantMessage: ChatMessage = {
            id: makeLocalId("local-msg"),
            role: "assistant",
            content: reply.content,
            createdAt: replyTime,
            serverId: reply.messageId,
          };

          setSessions((prev) =>
            prev.map((session) => {
              if (session.id !== sessionIdForSend) return session;
              return {
                ...session,
                serverId: session.serverId ?? reply.sessionId,
                messages: [...session.messages, assistantMessage],
                updatedAt: replyTime,
              };
            })
          );

          // AI 응답에 영상 재생 액션이 있으면 처리
          if (
            reply.action?.type === "PLAY_VIDEO" &&
            reply.action.educationId &&
            reply.action.videoId
          ) {
            onPlayEducationVideo?.({
              educationId: reply.action.educationId,
              videoId: reply.action.videoId,
              resumePositionSeconds: reply.action.resumePositionSeconds,
            });
          }
          // AI 응답에 퀴즈 패널 열기 액션이 있으면 처리
          if (reply.action?.type === "OPEN_QUIZ") {
            onOpenQuizPanel?.(reply.action.educationId || reply.action.quizId);
          }
          // AI 응답에 교육 패널 열기 액션이 있으면 처리
          if (reply.action?.type === "OPEN_EDU_PANEL") {
            onOpenEduPanel?.();
          }
        }
      } catch (error) {
        console.error("sendChatToAI error:", error);

        const replyTime = Date.now();
        const errorMessage: ChatMessage = {
          id: makeLocalId("local-msg"),
          role: "assistant",
          content:
            "죄송합니다. 서버와 통신 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
          createdAt: replyTime,
        };

        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionIdForSend
              ? {
                  ...session,
                  messages: [...session.messages, errorMessage],
                  updatedAt: replyTime,
                }
              : session
          )
        );
      } finally {
        setIsSending(false);
      }
    } catch (error) {
      console.error("sendChatToAI error:", error);

      const replyTime = Date.now();
      const errorMessage: ChatMessage = {
        id: makeLocalId("local-msg"),
        role: "assistant",
        content:
          "죄송합니다. 서버와 통신 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
        createdAt: replyTime,
      };

      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionIdForSend
            ? {
                ...session,
                messages: [...session.messages, errorMessage],
                updatedAt: replyTime,
              }
            : session
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleRetryFromMessage = (sourceQuestion: string, mode: RetryMode) => {
    const base = trimStr(sourceQuestion);
    if (!base || isSending) return;

    const current = activeSessionId
      ? sessionsRef.current.find((s) => s.id === activeSessionId) ?? null
      : null;

    if (mode === "retry" && current?.serverId) {
      const idx = current.messages.findIndex(
        (m) => m.role === "user" && trimStr(m.content) === base
      );

      if (idx >= 0) {
        const nextAssistant = current.messages
          .slice(idx + 1)
          .find((m) => m.role === "assistant");
        const targetMessageId = nextAssistant?.serverId;

        if (!targetMessageId || !isUuidLike(targetMessageId)) {
          // targetMessageId가 없거나 UUID가 아니면 일반 재전송으로 fallback
          console.warn(
            "[ChatbotApp] retry skipped: targetMessageId invalid, falling back to resend"
          );
          // 일반 메시지로 재전송 (아래 fallthrough로 처리됨)
        } else {
          // 재시도 로딩 상태 설정 (in-flight 차단)
          const retryingLocalId = nextAssistant?.id ?? null;
          if (retryingLocalId) {
            setRetryLoadingMessageId(retryingLocalId);
          }

          void (async () => {
            try {
              setIsSending(true);

              // 기본값을 true로: env 미설정이어도 스트리밍 경로를 반드시 탄다.
              const ENABLE_CHAT_STREAMING =
                String(
                  import.meta.env.VITE_CHAT_STREAMING ?? "true"
                ).toLowerCase() === "true";

              if (ENABLE_CHAT_STREAMING) {
                // 일반 메시지와 동일한 스트리밍 방식으로 처리
                // 1) placeholder assistant 메시지 생성
                const placeholderId = makeLocalId("local-msg");
                const placeholderTime = Date.now();

                const placeholder: ChatMessage = {
                  id: placeholderId,
                  role: "assistant",
                  content: "",
                  createdAt: placeholderTime,
                };

                setSessions((prev) =>
                  prev.map((session) =>
                    session.id === current.id
                      ? {
                          ...session,
                          messages: [...session.messages, placeholder],
                          updatedAt: placeholderTime,
                        }
                      : session
                  )
                );

                let acc = "";

                const final = await retryMessageStream(
                  current.serverId as string,
                  targetMessageId,
                  {
                    onDelta: (delta: string) => {
                      acc += delta;

                      // placeholder content 업데이트
                      setSessions((prev) =>
                        prev.map((session) => {
                          if (session.id !== current.id) return session;

                          const nextMessages = session.messages.map((m) =>
                            m.id === placeholderId ? { ...m, content: acc } : m
                          );

                          return {
                            ...session,
                            messages: nextMessages,
                            updatedAt: Date.now(),
                          };
                        })
                      );
                    },
                    onFinal: (f: ChatSendResult) => {
                      // 최종 serverId / sessionId 확정
                      setSessions((prev) =>
                        prev.map((session) => {
                          if (session.id !== current.id) return session;

                          const nextMessages = session.messages.map((m) =>
                            m.id === placeholderId
                              ? {
                                  ...m,
                                  content: f.content || acc,
                                  serverId: f.messageId,
                                }
                              : m
                          );

                          return {
                            ...session,
                            serverId: session.serverId ?? f.sessionId,
                            messages: nextMessages,
                            updatedAt: Date.now(),
                          };
                        })
                      );

                      // AI 응답에 영상 재생 액션이 있으면 처리 (일반 메시지와 동일)
                      if (
                        f.action?.type === "PLAY_VIDEO" &&
                        f.action.educationId &&
                        f.action.videoId
                      ) {
                        onPlayEducationVideo?.({
                          educationId: f.action.educationId,
                          videoId: f.action.videoId,
                          resumePositionSeconds: f.action.resumePositionSeconds,
                        });
                      }
                      // AI 응답에 퀴즈 패널 열기 액션이 있으면 처리
                      if (f.action?.type === "OPEN_QUIZ") {
                        onOpenQuizPanel?.(f.action.educationId || f.action.quizId);
                      }
                      // AI 응답에 교육 패널 열기 액션이 있으면 처리
                      if (f.action?.type === "OPEN_EDU_PANEL") {
                        onOpenEduPanel?.();
                      }
                    },
                  }
                );

                // retryMessageStream 내부에서 UI 업데이트를 끝내지만,
                // 여기서 final을 안 쓰면 lint가 불편할 수 있어 유지
                void final;
              } else {
                // 기존 non-stream (fallback)
                const res = await retryMessage(
                  current.serverId as string,
                  targetMessageId
                );
                const t = Date.now();

                const assistantMessage: ChatMessage = {
                  id: makeLocalId("local-msg"),
                  role: "assistant",
                  content: res.content,
                  createdAt: t,
                  serverId: res.messageId,
                };

                setSessions((prev) =>
                  prev.map((s) =>
                    s.id === current.id
                      ? {
                          ...s,
                          messages: [...s.messages, assistantMessage],
                          updatedAt: t,
                        }
                      : s
                  )
                );

                // AI 응답에 영상 재생 액션이 있으면 처리
                if (
                  res.action?.type === "PLAY_VIDEO" &&
                  res.action.educationId &&
                  res.action.videoId
                ) {
                  onPlayEducationVideo?.({
                    educationId: res.action.educationId,
                    videoId: res.action.videoId,
                    resumePositionSeconds: res.action.resumePositionSeconds,
                  });
                }
                // AI 응답에 퀴즈 패널 열기 액션이 있으면 처리
                if (res.action?.type === "OPEN_QUIZ") {
                  onOpenQuizPanel?.(res.action.educationId || res.action.quizId);
                }
                // AI 응답에 교육 패널 열기 액션이 있으면 처리
                if (res.action?.type === "OPEN_EDU_PANEL") {
                  onOpenEduPanel?.();
                }
              }
            } catch (e) {
              console.warn(
                "[ChatbotApp] retryMessage failed, fallback to resend:",
                e
              );
              await processSendMessage(base);
            } finally {
              setIsSending(false);
              setRetryLoadingMessageId(null);
            }
          })();
          return;
        }
      }
    }

    let question = base;
    if (mode === "variant") {
      question = `${base}\n\n같은 내용이지만 다른 방식으로도 한 번 더 설명해줘.`;
    }
    void processSendMessage(question);
  };

  const handleFeedbackChange = (
    localMessageId: string,
    value: FeedbackValue
  ) => {
    if (!activeSessionId) return;

    // in-flight 차단: 이미 해당 메시지에 대한 피드백 요청이 진행 중이면 무시
    if (feedbackLoadingIds.has(localMessageId)) {
      console.warn(
        "[ChatbotApp] feedback skipped: already in-flight",
        localMessageId
      );
      return;
    }

    const now = Date.now();
    const s = sessionsRef.current.find((x) => x.id === activeSessionId) ?? null;
    const serverSessionId = s?.serverId;
    const targetMessage = s?.messages.find((x) => x.id === localMessageId);
    const serverMessageId = targetMessage?.serverId;
    const prevFeedback = targetMessage?.feedback ?? null;

    // 서버 ID가 없으면 피드백 불가
    if (!serverSessionId) {
      console.warn(
        "[ChatbotApp] feedback skipped: server sessionId is missing"
      );
      return;
    }
    if (!serverMessageId) {
      console.warn(
        "[ChatbotApp] feedback skipped: server messageId is missing"
      );
      return;
    }

    // 1. Optimistic Update: 즉시 UI 반영
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== activeSessionId) return session;

        const updatedMessages = session.messages.map((m) =>
          m.id === localMessageId ? { ...m, feedback: value } : m
        );

        return {
          ...session,
          messages: updatedMessages,
          updatedAt: now,
        };
      })
    );

    // 2. 로딩 상태 설정 (in-flight 표시)
    setFeedbackLoadingIds((prev) => {
      const next = new Set(prev);
      next.add(localMessageId);
      return next;
    });

    // 3. API 호출 (비동기)
    void (async () => {
      try {
        await sendFeedbackToAI({
          sessionId: serverSessionId,
          messageId: serverMessageId,
          feedback: value,
        });
        // 성공: 상태 유지 (이미 Optimistic Update 완료)
      } catch (error) {
        console.error("[ChatbotApp] feedback failed:", error);

        // 4. 실패 시 롤백: 이전 상태로 복원
        setSessions((prev) =>
          prev.map((session) => {
            if (session.id !== activeSessionId) return session;

            const rolledBackMessages = session.messages.map((m) =>
              m.id === localMessageId ? { ...m, feedback: prevFeedback } : m
            );

            return {
              ...session,
              messages: rolledBackMessages,
              updatedAt: Date.now(),
            };
          })
        );

        // 5. 토스트로 에러 알림
        showToast("피드백 저장에 실패했습니다");
      } finally {
        // 6. 로딩 상태 해제
        setFeedbackLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(localMessageId);
          return next;
        });
      }
    })();
  };

  const handleSubmitReport = (payload: ReportPayload) => {
    const sessionId = payload.sessionId || activeSessionId;
    if (!sessionId) return;

    const now = Date.now();
    const pendingId = makeLocalId("local-msg");

    // 1) 즉시 “접수 중” 메시지 표시 (UX)
    const pendingMessage: ChatMessage = {
      id: pendingId,
      role: "assistant",
      content: "신고를 접수 중입니다…",
      createdAt: now,
    };

    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: [...session.messages, pendingMessage],
              updatedAt: now,
            }
          : session
      )
    );

    // 2) 서버 제출
    void (async () => {
      const res = await submitReportToServer({
        ...payload,
        sessionId,
      });

      const t = Date.now();

      const okText =
        "신고가 접수되었습니다. 담당자가 내용을 확인한 후 필요한 경우 별도로 연락드리겠습니다.";
      const failText =
        "신고 접수에 실패했습니다. 잠시 후 다시 시도해 주세요. (계속 실패하면 관리자에게 문의)";

      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) return session;

          const nextMessages = session.messages.map((m) => {
            if (m.id !== pendingId) return m;
            return {
              ...m,
              content: res.ok ? okText : failText,
              createdAt: t,
              kind: res.ok ? "reportReceipt" : m.kind,
            };
          });

          return { ...session, messages: nextMessages, updatedAt: t };
        })
      );

      if (!res.ok) {
        console.warn(
          "[ChatbotApp] report submit failed:",
          res.status,
          res.message
        );
      }
    })();
  };

  const handleOpenEduPanelFromChat = () => {
    onOpenEduPanel?.();
    onClose();
  };

  const handleOpenQuizPanelFromChat = () => {
    onOpenQuizPanel?.();
    onClose();
  };

  const handleOpenAdminPanelFromChat = () => {
    if (!can(userRole, "OPEN_ADMIN_DASHBOARD")) return;
    onOpenAdminPanel?.();
    onClose();
  };

  const handleOpenReviewerPanelFromChat = () => {
    if (!can(userRole, "OPEN_REVIEWER_DESK")) return;
    onOpenReviewerPanel?.();
    onClose();
  };

  const handleOpenCreatorPanelFromChat = () => {
    if (!can(userRole, "OPEN_CREATOR_STUDIO")) return;
    onOpenCreatorPanel?.();
    onClose();
  };

  useEffect(() => {
    if (!wrapperRef.current || !onAnimationEnd) return;

    const handleAnimationEnd = (e: AnimationEvent) => {
      if (e.target === wrapperRef.current) {
        onAnimationEnd();
      }
    };

    const el = wrapperRef.current;
    el.addEventListener("animationend", handleAnimationEnd);
    return () => {
      el.removeEventListener("animationend", handleAnimationEnd);
    };
  }, [onAnimationEnd]);

  const genieClass =
    animationState === "opening"
      ? "cb-genie-opening"
      : animationState === "closing"
      ? "cb-genie-closing"
      : "";

  return (
    <div className="cb-genie-wrapper">
      {/* 토스트 알림 */}
      {toastMessage && (
        <div
          className="cb-toast"
          role="alert"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(40, 40, 40, 0.95)",
            color: "#fff",
            padding: "12px 24px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 10001,
            animation: "cb-toast-fade-in 0.2s ease-out",
          }}
        >
          {toastMessage}
        </div>
      )}

      <div
        ref={wrapperRef}
        className={`cb-chatbot-wrapper ${genieClass}`}
        style={{
          top: panelPos.top,
          left: panelPos.left,
          transformOrigin,
        }}
        onMouseDown={onRequestFocus}
      >
        <div
          className="cb-chatbot-panel"
          style={{ width: size.width, height: size.height }}
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
            className="cb-panel-close-btn"
            onClick={onClose}
            aria-label="챗봇 창 닫기"
          >
            ✕
          </button>

          <div className="cb-chatbot-layout">
            <Sidebar
              collapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
              sessions={sidebarSessions}
              activeSessionId={activeSessionId}
              searchTerm={searchTerm}
              onSearchTermChange={handleSearchTermChange}
              onNewChat={handleNewChat}
              onSelectSession={handleSelectSession}
              onRenameSession={handleRenameSession}
              onDeleteSession={handleDeleteSession}
              enableServerSync={true}
              // 핵심: 폴링 OFF (요청 계속 오는 문제 차단)
              serverSyncIntervalMs={0}
              getServerSessionIdForLocalSession={
                getServerSessionIdForLocalSession
              }
              onSelectServerSession={handleSelectServerSession}
              onHydrateServerSession={handleHydrateServerSession}
            />

            <ChatWindow
              key={activeSession?.id ?? "no-session"}
              activeSession={activeSession}
              onSendMessage={handleSendMessage}
              isSending={isSending}
              onChangeDomain={handleChangeSessionDomain}
              onOpenEduPanel={handleOpenEduPanelFromChat}
              onOpenQuizPanel={handleOpenQuizPanelFromChat}
              onOpenAdminPanel={handleOpenAdminPanelFromChat}
              onOpenReviewerPanel={handleOpenReviewerPanelFromChat}
              onOpenCreatorPanel={handleOpenCreatorPanelFromChat}
              faqHomeItems={faqHome}
              isFaqHomeLoading={faqHomeLoading}
              onRequestFaqTop10={ensureFaqListCached}
              onFaqQuickSend={handleFaqQuickSend}
              onRetryFromMessage={handleRetryFromMessage}
              onFeedbackChange={handleFeedbackChange}
              feedbackLoadingIds={feedbackLoadingIds}
              retryLoadingMessageId={retryLoadingMessageId}
              onReportSubmit={handleSubmitReport}
              userRole={userRole}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatbotApp;
