// src/components/chatbot/Sidebar.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import chatLogo from "../../assets/chatlogo.png";
import newChatIcon from "../../assets/newchat.png";
import searchChatIcon from "../../assets/searchchat.png";
import keycloak from "../../keycloak";
import type { SidebarSessionSummary, ChatDomain, ChatRole } from "../../types/chat";
import { fromChatServiceDomain, normalizeServiceDomain } from "../../types/chat";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;

  /** 로컬(프론트) 기준 세션 리스트 */
  sessions: SidebarSessionSummary[];
  activeSessionId: string | null;

  searchTerm: string;
  onSearchTermChange: (value: string) => void;

  onNewChat: () => void;

  onSelectSession: (sessionId: string) => void;

  onRenameSession: (sessionId: string, newTitle: string) => void;
  onDeleteSession: (sessionId: string) => void;

  // ==========================
  // 서버 동기화 확장(옵션)
  // ==========================

  /** 서버 동기화 활성화(기본 true) */
  enableServerSync?: boolean;

  /** 서버 세션 목록 엔드포인트(기본 /api/chat/sessions) */
  serverSessionsEndpoint?: string;

  /** 서버 세션 messages 엔드포인트 생성기(기본 /chat/sessions/{id}/messages) */
  serverSessionMessagesEndpoint?: (serverSessionId: string) => string;

  /** (선택) 서버 세션 rename 엔드포인트 생성기(기본 /api/chat/sessions/{id}) */
  serverSessionUpdateEndpoint?: (serverSessionId: string) => string;

  /** (선택) 서버 세션 delete 엔드포인트 생성기(기본 /api/chat/sessions/{id}) */
  serverSessionDeleteEndpoint?: (serverSessionId: string) => string;

  /** (선택) 서버 동기화 폴링 간격(ms) - 0 이하이면 폴링 비활성화 */
  serverSyncIntervalMs?: number;

  /** 로컬 세션 id → 서버 세션 UUID를 상위에서 제공 */
  getServerSessionIdForLocalSession?: (localSessionId: string) => string | undefined;

  /**
   * 서버 세션을 클릭했을 때 상위가 “해당 서버 세션을 로컬 세션으로 로드/생성”하도록 트리거
   */
  onSelectServerSession?: (serverSessionId: string) => void;

  onHydrateServerSession?: (payload: {
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
  }) => void;
}

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null;
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function isUuidLike(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v
  );
}

/** ISO 문자열 또는 ms를 number(ms)로 */
function toEpochMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return Date.now();
    const d = new Date(t);
    const ms = d.getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

function getUserUuidFromKeycloak(): string | null {
  const parsed = keycloak?.tokenParsed as unknown;
  if (!isRecord(parsed)) return null;
  const sub = parsed["sub"];
  const s = nonEmptyString(sub);
  if (!s) return null;
  return isUuidLike(s) ? s : null;
}

/**
 * (핵심 FIX) Sidebar도 token race 흡수:
 * - 처음 열 때 token이 아직 없으면 sync 자체가 스킵되어 “체크리스트 1번(/api/chat/sessions) 안 뜸”
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

  const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

  while (Date.now() - start < timeoutMs) {
    if (!keycloak?.authenticated) {
      await sleep(pollMs);
      continue;
    }

    if (keycloak.token) {
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

  try {
    if (keycloak?.authenticated && typeof keycloak.updateToken === "function") {
      await keycloak.updateToken(30);
    }
  } catch {
    // ignore
  }

  return keycloak?.token ?? null;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchJson<T = unknown>(url: string, token: string, timeoutMs = 15_000): Promise<T> {
  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
    timeoutMs
  );

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `GET ${url} failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`
    );
  }

  const data = (await res.json().catch(() => null)) as T;
  if (data === null) throw new Error(`GET ${url} failed: invalid JSON`);
  return data;
}

/** /api/chat/sessions 응답에서 세션 배열을 방어적으로 추출 */
function extractSessionArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  const candidates = ["items", "data", "sessions", "content", "result"];
  for (const k of candidates) {
    const v = data[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** /chat/sessions/{id}/messages 응답에서 메시지 배열을 방어적으로 추출 */
function extractMessageArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  const candidates = ["items", "data", "messages", "content", "result"];
  for (const k of candidates) {
    const v = data[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/** 서버 role 문자열 → ChatRole("user" | "assistant") 정규화 */
function normalizeServerRole(v: unknown): ChatRole {
  const s = nonEmptyString(v)?.toLowerCase() ?? "";
  if (s.includes("user")) return "user";
  // system/bot/assistant/ai 등은 전부 assistant로 흡수
  return "assistant";
}

function normalizeServerMessage(v: unknown): {
  role: ChatRole;
  content: string;
  createdAt: number;
  serverMessageId?: string;
} | null {
  if (!isRecord(v)) return null;

  const content =
    nonEmptyString(v["content"]) ??
    nonEmptyString(v["message"]) ??
    nonEmptyString(v["text"]) ??
    null;

  if (!content) return null;

  const role = normalizeServerRole(v["role"] ?? v["sender"] ?? v["type"]);
  const createdAt = toEpochMs(v["createdAt"] ?? v["created_at"] ?? v["timestamp"]);

  const serverMessageId =
    nonEmptyString(v["messageId"]) ??
    nonEmptyString(v["id"]) ??
    nonEmptyString(v["uuid"]) ??
    undefined;

  return { role, content, createdAt, serverMessageId };
}

type ServerSessionMeta = {
  serverSessionId: string;
  title: string;
  domain: ChatDomain;
  createdAt: number;
  updatedAt: number;
  userUuid?: string;
  lastMessage?: string;
};

function normalizeServerSession(v: unknown): ServerSessionMeta | null {
  if (!isRecord(v)) return null;

  const id = nonEmptyString(v["id"]) ?? nonEmptyString(v["sessionId"]) ?? nonEmptyString(v["uuid"]);
  if (!id || !isUuidLike(id)) return null;

  const title = nonEmptyString(v["title"]) ?? "새 채팅";

  // 서비스 도메인(POLICY/SECURITY/EDUCATION/HR...) → UI 도메인
  const serviceDomain = normalizeServiceDomain(v["domain"]);
  const domain: ChatDomain = fromChatServiceDomain(serviceDomain, "general");

  const createdAt = toEpochMs(v["createdAt"]);
  const updatedAt = toEpochMs(v["updatedAt"]);

  // 다른 계정 세션 섞임 방지용
  const userUuid =
    nonEmptyString(v["userUuid"]) ??
    nonEmptyString(v["userId"]) ??
    nonEmptyString(v["ownerUuid"]) ??
    nonEmptyString(v["ownerId"]) ??
    undefined;

  const lastMessage =
    nonEmptyString(v["lastMessage"]) ??
    nonEmptyString(v["preview"]) ??
    nonEmptyString(v["lastContent"]) ??
    nonEmptyString(v["last_message"]) ??
    undefined;

  return {
    serverSessionId: id,
    title,
    domain,
    createdAt,
    updatedAt,
    userUuid,
    lastMessage,
  };
}

// updatedAt 기준 상대 시간 포맷
function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  const dY = date.getFullYear();
  const dM = date.getMonth();
  const dD = date.getDate();

  const nY = now.getFullYear();
  const nM = now.getMonth();
  const nD = now.getDate();

  const two = (n: number) => n.toString().padStart(2, "0");

  if (dY === nY && dM === nM && dD === nD) {
    const h = date.getHours();
    const m = date.getMinutes();
    return `${two(h)}:${two(m)}`;
  }

  if (dY === nY) {
    return `${two(dM + 1)}/${two(dD)}`;
  }

  return `${dY}/${two(dM + 1)}/${two(dD)}`;
}

/** Sidebar 표시용 row: 로컬/서버를 한 리스트로 합치기 위해 확장 */
type SidebarRow = SidebarSessionSummary & {
  source: "local" | "server";
  serverSessionId?: string;
  isServerOnly?: boolean;
};

const DEFAULT_SESSIONS_ENDPOINT = "/api/chat/sessions";
const DEFAULT_UPDATE_ENDPOINT = (id: string) => `/api/chat/sessions/${id}`;
const DEFAULT_DELETE_ENDPOINT = (id: string) => `/api/chat/sessions/${id}`;

const DEFAULT_SYNC_INTERVAL_MS = 0;

const TOMBSTONE_TTL_MS = 30_000;

type TombstoneMap = Record<string, number>;

function pruneTombstones(map: TombstoneMap, now: number): TombstoneMap {
  const next: TombstoneMap = {};
  let changed = false;

  for (const [id, at] of Object.entries(map)) {
    if (now - at < TOMBSTONE_TTL_MS) {
      next[id] = at;
    } else {
      changed = true;
    }
  }

  return changed ? next : map;
}

async function updateServerSessionTitle(
  title: string,
  token: string,
  endpoint: string
): Promise<void> {
  const payload = JSON.stringify({ title });

  const tries: Array<"PATCH" | "PUT"> = ["PATCH", "PUT"];

  let lastErr: unknown = null;
  for (const method of tries) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: payload,
        },
        12_000
      );

      if (res.ok) return;

      const text = await res.text().catch(() => "");
      lastErr = new Error(`${method} ${endpoint} failed: ${res.status} ${text}`);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("updateServerSessionTitle failed");
}

async function deleteServerSession(token: string, endpoint: string): Promise<void> {
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    12_000
  );

  if (res.ok) return;
  if (res.status === 404 || res.status === 410) return;

  const text = await res.text().catch(() => "");
  throw new Error(`DELETE ${endpoint} failed: ${res.status} ${text}`);
}

const Sidebar: React.FC<SidebarProps> = (props) => {
  const {
    collapsed,
    onToggleCollapse,
    sessions,
    activeSessionId,
    searchTerm,
    onSearchTermChange,
    onNewChat,
    onSelectSession,
    onRenameSession,
    onDeleteSession,
    getServerSessionIdForLocalSession,
    onSelectServerSession,
    serverSessionMessagesEndpoint: serverSessionMessagesEndpointProp,
    onHydrateServerSession,
  } = props;

  const enableServerSync = props.enableServerSync ?? true;
  const serverSessionsEndpoint = props.serverSessionsEndpoint ?? DEFAULT_SESSIONS_ENDPOINT;
  const serverSessionUpdateEndpoint = props.serverSessionUpdateEndpoint ?? DEFAULT_UPDATE_ENDPOINT;
  const serverSessionDeleteEndpoint = props.serverSessionDeleteEndpoint ?? DEFAULT_DELETE_ENDPOINT;
  const serverSyncIntervalMs = props.serverSyncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS;

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");

  const [serverMetas, setServerMetas] = useState<ServerSessionMeta[]>([]);

  const [tombstones, setTombstones] = useState<TombstoneMap>({});
  const tombstonesRef = useRef<TombstoneMap>({});
  useEffect(() => {
    tombstonesRef.current = tombstones;
  }, [tombstones]);

  const syncSeqRef = useRef(0);
  const syncingRef = useRef(false);

  const timeoutsRef = useRef<number[]>([]);

  const isTombstoned = useCallback((serverSessionId: string) => {
    const at = tombstonesRef.current[serverSessionId];
    if (typeof at !== "number") return false;
    return Date.now() - at < TOMBSTONE_TTL_MS;
  }, []);

  const markTombstone = useCallback((serverSessionId: string) => {
    setTombstones((prev) => {
      const now = Date.now();
      const pruned = pruneTombstones(prev, now);
      return { ...pruned, [serverSessionId]: now };
    });
  }, []);

  const syncServerSessions = useCallback(async () => {
    if (!enableServerSync) return;
    if (syncingRef.current) return;

    const token = await waitForAuthToken({ timeoutMs: 6_000, pollMs: 200 });
    if (!token) return;

    const myUserUuid = getUserUuidFromKeycloak();

    syncingRef.current = true;
    const mySeq = ++syncSeqRef.current;

    try {
      setTombstones((prev) => pruneTombstones(prev, Date.now()));

      const raw = await fetchJson<unknown>(serverSessionsEndpoint, token, 15_000);
      if (mySeq !== syncSeqRef.current) return;

      const arr = extractSessionArray(raw);

      const metas: ServerSessionMeta[] = [];
      for (const item of arr) {
        const m = normalizeServerSession(item);
        if (!m) continue;
        if (isTombstoned(m.serverSessionId)) continue;

        if (m.userUuid && myUserUuid && m.userUuid !== myUserUuid) continue;

        metas.push(m);
      }

      metas.sort((a, b) => b.updatedAt - a.updatedAt);
      if (mySeq !== syncSeqRef.current) return;

      setServerMetas(metas);
    } catch (e) {
      console.warn("[Sidebar] server sync failed:", e);
    } finally {
      syncingRef.current = false;
    }
  }, [enableServerSync, serverSessionsEndpoint, isTombstoned]);

  // 서버 세션 클릭 시: 메시지 로드 → onHydrateServerSession → onSelectSession
  const hydratingRef = useRef<Set<string>>(new Set());

  const getServerSessionMessagesEndpoint = useCallback(
    (serverSessionId: string) => {
      if (serverSessionMessagesEndpointProp) return serverSessionMessagesEndpointProp(serverSessionId);
      // 기본값: Swagger 가정(/chat/sessions/{id}/messages)
      return `/chat/sessions/${encodeURIComponent(serverSessionId)}/messages`;
    },
    [serverSessionMessagesEndpointProp]
  );

  const hydrateAndSelectServerSession = useCallback(
    async (serverSessionId: string) => {
      if (hydratingRef.current.has(serverSessionId)) return;
      hydratingRef.current.add(serverSessionId);

      try {
        // hydrate 콜백이 없으면 그냥 선택만
        if (!onHydrateServerSession) {
          onSelectSession(serverSessionId);
          return;
        }

        const meta = serverMetas.find((m) => m.serverSessionId === serverSessionId) ?? null;
        if (!meta) {
          onSelectSession(serverSessionId);
          return;
        }

        const token = await waitForAuthToken({ timeoutMs: 6_000, pollMs: 200 });
        if (!token) {
          onSelectSession(serverSessionId);
          return;
        }

        const url = getServerSessionMessagesEndpoint(serverSessionId);
        const raw = await fetchJson<unknown>(url, token, 15_000);

        const arr = extractMessageArray(raw);

        const messages: Array<{
          role: ChatRole;
          content: string;
          createdAt: number;
          serverMessageId?: string;
        }> = [];

        for (const it of arr) {
          const m = normalizeServerMessage(it);
          if (m) messages.push(m);
        }

        onHydrateServerSession({
          serverSessionId,
          title: meta.title,
          domain: meta.domain,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          messages,
          raw,
        });

        onSelectSession(serverSessionId);
      } catch (e) {
        console.warn("[Sidebar] hydrate server session failed:", e);
        onSelectSession(serverSessionId);
      } finally {
        hydratingRef.current.delete(serverSessionId);
      }
    },
    [
      onHydrateServerSession,
      onSelectSession,
      serverMetas,
      getServerSessionMessagesEndpoint,
    ]
  );

  const scheduleResync = useCallback(
    (delays: number[]) => {
      if (!enableServerSync) return;
      for (const t of timeoutsRef.current) window.clearTimeout(t);
      timeoutsRef.current = [];

      for (const d of delays) {
        const t = window.setTimeout(() => {
          void syncServerSessions();
        }, d);
        timeoutsRef.current.push(t);
      }
    },
    [enableServerSync, syncServerSessions]
  );

  useEffect(() => {
    if (!openMenuId) return;

    const handleClickOutside = () => {
      setOpenMenuId(null);
    };

    window.addEventListener("click", handleClickOutside);
    return () => {
      window.removeEventListener("click", handleClickOutside);
    };
  }, [openMenuId]);

  useEffect(() => {
    return () => {
      for (const t of timeoutsRef.current) window.clearTimeout(t);
      timeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!enableServerSync) return;

    void syncServerSessions();

    const onFocus = () => void syncServerSessions();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncServerSessions();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    let timer: number | null = null;
    if (serverSyncIntervalMs > 0) {
      timer = window.setInterval(() => {
        void syncServerSessions();
      }, Math.max(3_000, serverSyncIntervalMs));
    }

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer != null) window.clearInterval(timer);
    };
  }, [enableServerSync, syncServerSessions, serverSyncIntervalMs]);

  const mergedRows: SidebarRow[] = useMemo(() => {
    const localRows: SidebarRow[] = sessions.map((s) => ({
      ...s,
      source: "local",
    }));

    const mappedServerIds = new Set<string>();
    if (getServerSessionIdForLocalSession) {
      for (const s of sessions) {
        const sid = getServerSessionIdForLocalSession(s.id);
        if (sid && isUuidLike(sid)) mappedServerIds.add(sid);
      }
    }

    const serverOnlyRows: SidebarRow[] = serverMetas
      .filter((m) => !mappedServerIds.has(m.serverSessionId))
      .filter((m) => !isTombstoned(m.serverSessionId))
      .map((m) => ({
        id: m.serverSessionId,
        title: m.title,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        domain: m.domain,
        lastMessage: m.lastMessage ?? "",
        source: "server",
        serverSessionId: m.serverSessionId,
        isServerOnly: true,
      }));

    return [...localRows, ...serverOnlyRows];
  }, [sessions, serverMetas, getServerSessionIdForLocalSession, isTombstoned]);

  const filteredSessions = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    return [...mergedRows]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((session) => {
        if (!keyword) return true;
        return (
          session.title.toLowerCase().includes(keyword) ||
          (session.lastMessage ?? "").toLowerCase().includes(keyword)
        );
      });
  }, [mergedRows, searchTerm]);

  const handleMoreClick = (e: React.MouseEvent<HTMLButtonElement>, sessionId: string) => {
    e.stopPropagation();
    setOpenMenuId((prev) => (prev === sessionId ? null : sessionId));
  };

  const startEditing = (sessionId: string, currentTitle: string) => {
    setEditingId(sessionId);
    setEditingTitle(currentTitle);
    setOpenMenuId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const commitEdit = useCallback(() => {
    if (!editingId) return;

    const id = editingId;
    const trimmed = editingTitle.trim();

    setEditingId(null);
    setEditingTitle("");

    if (!trimmed) return;

    const row = mergedRows.find((r) => r.id === id) ?? null;

    if (row?.source === "local") {
      onRenameSession(id, trimmed);
    } else if (row?.source === "server" && row.serverSessionId) {
      setServerMetas((prev) =>
        prev.map((m) =>
          m.serverSessionId === row.serverSessionId
            ? { ...m, title: trimmed, updatedAt: Date.now() }
            : m
        )
      );
    }

    let serverId: string | null = null;

    if (row?.source === "server") {
      serverId = row.serverSessionId ?? row.id;
    } else {
      const mapped = getServerSessionIdForLocalSession?.(id);
      if (mapped && isUuidLike(mapped)) serverId = mapped;
      else if (isUuidLike(id)) serverId = id;
    }

    if (serverId && isUuidLike(serverId)) {
      void (async () => {
        const token = await waitForAuthToken({ timeoutMs: 6_000, pollMs: 200 });
        if (!token) return;

        const endpoint = serverSessionUpdateEndpoint(serverId);

        try {
          await updateServerSessionTitle(trimmed, token, endpoint);
          scheduleResync([600, 2200]);
        } catch (e) {
          console.warn("[Sidebar] rename server session failed:", e);
          scheduleResync([900, 2600]);
        }
      })();
    }
  }, [
    editingId,
    editingTitle,
    mergedRows,
    onRenameSession,
    getServerSessionIdForLocalSession,
    serverSessionUpdateEndpoint,
    scheduleResync,
  ]);

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commitEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const handleEditClick = (e: React.MouseEvent<HTMLInputElement>) => {
    e.stopPropagation();
  };

  const handleDeleteClick = useCallback(
    (sessionId: string) => {
      syncSeqRef.current += 1;

      const row = mergedRows.find((r) => r.id === sessionId) ?? null;

      let serverId: string | null = null;

      if (row?.source === "server") {
        serverId = row.serverSessionId ?? row.id;
      } else {
        const mapped = getServerSessionIdForLocalSession?.(sessionId);
        if (mapped && isUuidLike(mapped)) serverId = mapped;
        else if (isUuidLike(sessionId)) serverId = sessionId;
      }

      if (serverId && isUuidLike(serverId)) {
        markTombstone(serverId);

        setServerMetas((prev) => prev.filter((m) => m.serverSessionId !== serverId));

        void (async () => {
          const token = await waitForAuthToken({ timeoutMs: 6_000, pollMs: 200 });
          if (!token) return;

          const endpoint = serverSessionDeleteEndpoint(serverId as string);

          try {
            await deleteServerSession(token, endpoint);
            scheduleResync([600, 2200]);
          } catch (e) {
            console.warn("[Sidebar] delete server session failed:", e);
            scheduleResync([900, 2600]);
          }
        })();
      }

      if (row?.source === "server" && row.serverSessionId) {
        onDeleteSession(row.serverSessionId);
      } else {
        onDeleteSession(sessionId);
      }

      setOpenMenuId(null);
      if (editingId === sessionId) cancelEdit();

      scheduleResync([600, 2500]);
    },
    [
      mergedRows,
      getServerSessionIdForLocalSession,
      markTombstone,
      onDeleteSession,
      editingId,
      serverSessionDeleteEndpoint,
      scheduleResync,
    ]
  );

  const handleSelectRow = (row: SidebarRow) => {
    if (row.source === "server" && row.serverSessionId) {
      if (isTombstoned(row.serverSessionId)) return;

      // 상위에서 “서버 세션 선택 로직(별도 hydrate 포함)”을 이미 구현한 경우
      if (onSelectServerSession) {
        onSelectServerSession(row.serverSessionId);
        return;
      }

      // Sidebar 자체가 메시지 로드 + hydrate + select까지 처리
      void hydrateAndSelectServerSession(row.serverSessionId);
      return;
    }

    onSelectSession(row.id);
  };

  return (
    <aside className={`cb-sidebar ${collapsed ? "collapsed" : ""}`}>
      <button
        type="button"
        className="cb-sidebar-logo-btn"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
      >
        <div className="cb-sidebar-logo">
          <img src={chatLogo} alt="Ctrl F Chatbot 로고" />
        </div>
      </button>

      {!collapsed && (
        <>
          <div className="cb-sidebar-section cb-sidebar-actions">
            <button type="button" className="cb-sidebar-action" onClick={onNewChat}>
              <img src={newChatIcon} alt="" className="cb-sidebar-action-icon" />
              <span>새 채팅</span>
            </button>

            <div className="cb-sidebar-action cb-sidebar-search">
              <img src={searchChatIcon} alt="" className="cb-sidebar-action-icon" />
              <input
                type="text"
                className="cb-sidebar-search-input"
                placeholder="채팅 검색"
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
              />
            </div>
          </div>

          <div className="cb-sidebar-section">
            <p className="cb-sidebar-label" style={{ margin: 0 }}>
              채팅
            </p>

            <ul className="cb-sidebar-list">
              {filteredSessions.length === 0 ? (
                <li className="cb-sidebar-empty">대화 내역이 없습니다.</li>
              ) : (
                filteredSessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  const isEditing = session.id === editingId;

                  return (
                    <li
                      key={`${session.source}:${session.id}`}
                      className={isActive ? "active" : undefined}
                      onClick={() => handleSelectRow(session)}
                    >
                      <div className="cb-sidebar-item-main">
                        {isEditing ? (
                          <input
                            className="cb-sidebar-item-edit"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            onBlur={commitEdit}
                            onClick={handleEditClick}
                            autoFocus
                          />
                        ) : (
                          <div className="cb-sidebar-item-text">
                            <span className="cb-sidebar-item-title">
                              {session.title || "제목 없음"}
                            </span>
                            {session.lastMessage && (
                              <span className="cb-sidebar-item-preview">{session.lastMessage}</span>
                            )}
                          </div>
                        )}

                        <span className="cb-sidebar-item-time">
                          {formatRelativeTime(session.updatedAt)}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="cb-sidebar-item-more"
                        aria-label="채팅 옵션"
                        onClick={(e) => handleMoreClick(e, session.id)}
                      >
                        ⋯
                      </button>

                      {openMenuId === session.id && (
                        <div className="cb-sidebar-item-menu" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="cb-sidebar-item-menu-item"
                            onClick={() => startEditing(session.id, session.title)}
                          >
                            채팅 이름 바꾸기
                          </button>
                          <button
                            type="button"
                            className="cb-sidebar-item-menu-item cb-danger"
                            onClick={() => handleDeleteClick(session.id)}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      )}
    </aside>
  );
};

export default Sidebar;
