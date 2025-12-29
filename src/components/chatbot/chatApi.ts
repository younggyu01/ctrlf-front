// src/components/chatbot/chatApi.ts
import keycloak from "../../keycloak";
import type {
  ChatRequest,
  FeedbackValue,
  ChatSendResult,
  ChatDomain,
  ChatServiceDomain,
  FaqHomeItem,
  FaqItem,
  ReportPayload,
} from "../../types/chat";
import {
  normalizeChatDomain,
  normalizeServiceDomain,
  toChatServiceDomain,
} from "../../types/chat";

/**
 * Chat Service (9005) Swagger 스펙 기반 엔드포인트
 * - 프론트에서는 상대경로로 호출하고, Vite proxy가 9005로 라우팅한다.
 */
const CHAT_SESSIONS_ENDPOINT =
  import.meta.env.VITE_CHAT_SESSIONS_ENDPOINT?.toString() ?? "/api/chat/sessions";

const CHAT_MESSAGES_ENDPOINT =
  import.meta.env.VITE_CHAT_MESSAGES_ENDPOINT?.toString() ?? "/chat/messages";

const FAQ_HOME_ENDPOINT =
  import.meta.env.VITE_FAQ_HOME_ENDPOINT?.toString() ?? "/api/faq/home";

const FAQ_LIST_ENDPOINT =
  import.meta.env.VITE_FAQ_LIST_ENDPOINT?.toString() ?? "/api/faq";

/** Chat Service path base (env로 교체 가능) */
const CHAT_SESSIONS_BASE =
  import.meta.env.VITE_CHAT_SESSIONS_BASE?.toString() ?? "/chat/sessions";

/**
 * (선택) Streaming endpoint
 * - env 미설정/빈 값인 경우에도 스트리밍 시도를 위해 기본값을 CHAT_MESSAGES_ENDPOINT로 둔다.
 */
const CHAT_MESSAGES_STREAM_ENDPOINT =
  import.meta.env.VITE_CHAT_MESSAGES_STREAM_ENDPOINT?.toString() ??
  CHAT_MESSAGES_ENDPOINT;

/** (선택) 신고 endpoint 후보 (서버 스펙 확정 전까지 env로 제어) */
const REPORT_ENDPOINTS_RAW: string = String(import.meta.env.VITE_REPORT_ENDPOINTS ?? "");
const REPORT_ENDPOINTS: string[] = (REPORT_ENDPOINTS_RAW ? REPORT_ENDPOINTS_RAW.split(",") : [])
  .map((s: string) => s.trim())
  .filter((s: string) => s.length > 0);

/** 메시지 피드백 URL */
const CHAT_MESSAGE_FEEDBACK_URL = (sessionId: string, messageId: string) =>
  `${CHAT_SESSIONS_BASE}/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(
    messageId
  )}/feedback`;

/** (선택) 재시도 API */
const CHAT_MESSAGE_RETRY_URL = (sessionId: string, messageId: string) =>
  `${CHAT_SESSIONS_BASE}/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(
    messageId
  )}/retry`;

/** (히스토리) */
export const CHAT_SESSION_MESSAGES_URL = (sessionId: string) =>
  `${CHAT_SESSIONS_BASE}/${encodeURIComponent(sessionId)}/messages`;

/** 요청 타임아웃(ms) */
const DEFAULT_TIMEOUT_MS = 30_000;

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null;
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/** UUID 형식(대충) 체크 */
function isUuidLike(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v
  );
}

/**
 * (중요) 세션 매핑을 "유저 단위"로 분리
 */
const STORAGE_PREFIX = "cb_chat_client_to_server_session_map_v2";
const mapsByUser = new Map<string, Map<string, string>>();
const hydratedUsers = new Set<string>();

function getStorageKey(userUuid: string) {
  return `${STORAGE_PREFIX}:${userUuid}`;
}

function hydrateUserMapOnce(userUuid: string) {
  if (hydratedUsers.has(userUuid)) return;
  hydratedUsers.add(userUuid);

  const map = mapsByUser.get(userUuid) ?? new Map<string, string>();
  mapsByUser.set(userUuid, map);

  try {
    const raw = sessionStorage.getItem(getStorageKey(userUuid));
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [k, v] = entry;
      if (typeof k === "string" && typeof v === "string") {
        map.set(k, v);
      }
    }
  } catch {
    // ignore
  }
}

function persistUserMap(userUuid: string) {
  try {
    const map = mapsByUser.get(userUuid);
    if (!map) return;
    const entries = Array.from(map.entries());
    sessionStorage.setItem(getStorageKey(userUuid), JSON.stringify(entries));
  } catch {
    // ignore
  }
}

function setSessionMap(userUuid: string, clientKey: string, serverUuid: string) {
  hydrateUserMapOnce(userUuid);
  const map = mapsByUser.get(userUuid)!;
  map.set(clientKey, serverUuid);
  persistUserMap(userUuid);
}

/**
 * 외부(상위/Sidebar) 연동용: 로컬 세션 id -> 서버 세션 UUID 조회
 */
export function getServerSessionIdForLocalSession(localSessionId: string): string | undefined {
  const userUuid = getUserUuidFromKeycloak();
  if (!userUuid) return undefined;

  hydrateUserMapOnce(userUuid);
  const map = mapsByUser.get(userUuid);
  const sid = map?.get(localSessionId);

  return sid && isUuidLike(sid) ? sid : undefined;
}

/**
 * 외부(상위/Sidebar) 연동용: 로컬 세션 id -> 서버 세션 UUID 바인딩
 */
export function bindServerSessionIdToLocalSession(
  localSessionId: string,
  serverSessionId: string
): void {
  const userUuid = getUserUuidFromKeycloak();
  if (!userUuid) return;

  if (!localSessionId) return;
  if (!isUuidLike(serverSessionId)) return;

  setSessionMap(userUuid, localSessionId, serverSessionId);
}

export function getMappedServerSessionId(localSessionId: string): string | undefined {
  const userUuid = getUserUuidFromKeycloak();
  if (!userUuid) return undefined;
  hydrateUserMapOnce(userUuid);
  const map = mapsByUser.get(userUuid);
  return map?.get(localSessionId);
}

export function setMappedServerSessionId(localSessionId: string, serverSessionId: string): void {
  const userUuid = getUserUuidFromKeycloak();
  if (!userUuid) return;
  setSessionMap(userUuid, localSessionId, serverSessionId);
}

/**
 * (추가) 토큰이 "아직 준비 전"인 초기 레이스를 흡수하기 위해
 * 일정 시간 동안 토큰을 기다리는 버전
 */
async function waitForAuthToken(opts?: {
  timeoutMs?: number;
  pollMs?: number;
  minUpdateIntervalMs?: number;
}): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 8_000;
  const pollMs = opts?.pollMs ?? 250;
  const minUpdateIntervalMs = opts?.minUpdateIntervalMs ?? 1_000;

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

/**
 * Keycloak 토큰 갱신 후 최신 토큰 확보 (토큰 레이스 포함 흡수)
 */
async function ensureFreshToken(): Promise<string | null> {
  return await waitForAuthToken({ timeoutMs: 8_000, pollMs: 250, minUpdateIntervalMs: 1_000 });
}

/**
 * Keycloak tokenParsed.sub(UUID)를 userUuid로 사용
 */
function getUserUuidFromKeycloak(): string | null {
  const parsed = keycloak?.tokenParsed as unknown;
  if (!isRecord(parsed)) return null;
  const sub = parsed["sub"];
  if (isUuidLike(sub)) return sub;
  return typeof sub === "string" ? sub : null;
}

/**
 * Keycloak tokenParsed.domain → Chat Service domain
 */
function getServiceDomainFromKeycloak(): ChatServiceDomain | null {
  const parsed = keycloak?.tokenParsed as unknown;
  if (!isRecord(parsed)) return null;
  return normalizeServiceDomain(parsed["domain"]);
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

/**
 * ChatRequest에서 "클라이언트 세션 키" 추출
 */
function pickClientSessionKey(req: ChatRequest): string {
  const anyReq = req as unknown as JsonRecord;

  const candidates: unknown[] = [
    anyReq["sessionId"],
    anyReq["clientSessionId"],
    isRecord(anyReq["session"]) ? (anyReq["session"] as JsonRecord)["id"] : null,
  ];

  for (const c of candidates) {
    const s = nonEmptyString(c);
    if (s) return s;
  }

  const uiDomain = pickUiDomain(req) ?? "general";
  const fallbackServiceDomain =
    getServiceDomainFromKeycloak() ?? toChatServiceDomain(uiDomain, "POLICY");
  return `__fallback__:${fallbackServiceDomain}`;
}

/**
 * serverSessionId(uuid) 후보 추출
 */
function pickDirectServerSessionId(req: ChatRequest): string | null {
  const anyReq = req as unknown as JsonRecord;

  const candidates: unknown[] = [
    anyReq["serverSessionId"],
    anyReq["sessionUuid"],
    anyReq["sessionId"], // sessionId가 uuid인 경우
    isRecord(anyReq["session"]) ? (anyReq["session"] as JsonRecord)["id"] : null,
  ];

  for (const c of candidates) {
    const s = nonEmptyString(c);
    if (s && isUuidLike(s)) return s;
  }
  return null;
}

function pickUiDomain(req: ChatRequest): ChatDomain | null {
  const anyReq = req as unknown as JsonRecord;

  const candidates: unknown[] = [
    anyReq["domain"],
    anyReq["chatDomain"],
    isRecord(anyReq["session"]) ? (anyReq["session"] as JsonRecord)["domain"] : null,
  ];

  for (const c of candidates) {
    const d = normalizeChatDomain(c);
    if (d) return d;
  }
  return null;
}

function makeSessionTitleFromUserText(text: string): string {
  const t = text.trim();
  if (!t) return "새 채팅";
  return t.length <= 30 ? t : `${t.slice(0, 30)}…`;
}

/**
 * Swagger 스키마: ChatSessionCreateRequest
 */
type ChatSessionCreateRequest = {
  userUuid: string;
  title: string;
  domain: string;
};

/**
 * Swagger 스키마: ChatSessionResponse
 */
type ChatSessionResponse = {
  id: string; // uuid
  title: string;
  domain: string;
  userUuid: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Swagger 스키마: ChatMessageSendRequest
 */
type ChatMessageSendRequest = {
  sessionId: string; // uuid
  content: string;
};

/**
 * Swagger 스키마: ChatMessageSendResponse
 */
type ChatMessageSendResponse = {
  messageId: string; // uuid
  role: string;
  content: string;
  createdAt: string;
};

/**
 * Swagger 스키마: ChatFeedbackRequest (score: 1~5)
 */
type UpstreamChatFeedbackRequest = {
  score: number;
  comment?: string;
};

async function createChatSession(
  payload: ChatSessionCreateRequest,
  token: string
): Promise<ChatSessionResponse> {
  const res = await fetchWithTimeout(
    CHAT_SESSIONS_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    DEFAULT_TIMEOUT_MS
  );

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `Create session failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`
    );
  }

  const data: unknown = await res.json().catch(() => null);
  if (!isRecord(data) || !nonEmptyString(data["id"])) {
    throw new Error("Create session failed: invalid response shape");
  }

  return data as ChatSessionResponse;
}

async function sendChatMessage(
  payload: ChatMessageSendRequest,
  token: string
): Promise<ChatMessageSendResponse> {
  const res = await fetchWithTimeout(
    CHAT_MESSAGES_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    DEFAULT_TIMEOUT_MS
  );

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `Send message failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`
    );
  }

  const data: unknown = await res.json().catch(() => null);
  if (!isRecord(data) || !nonEmptyString(data["content"]) || !nonEmptyString(data["messageId"])) {
    throw new Error("Send message failed: invalid response shape");
  }

  return data as ChatMessageSendResponse;
}

/**
 * 채팅 전송 (Chat Service 9005 실제 API)
 */
export async function sendChatToAI(req: ChatRequest): Promise<ChatSendResult> {
  const token = await ensureFreshToken();
  if (!token) {
    throw new Error("Not authenticated: Keycloak token is missing.");
  }

  const userUuid = getUserUuidFromKeycloak();
  if (!userUuid) {
    throw new Error("Not authenticated: userUuid(sub) is missing in token.");
  }

  hydrateUserMapOnce(userUuid);

  const lastUser =
    [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const uiDomain = pickUiDomain(req) ?? "general";
  const tokenDomain = getServiceDomainFromKeycloak();
  const serviceDomain = toChatServiceDomain(uiDomain, tokenDomain ?? "POLICY");

  const clientSessionKey = pickClientSessionKey(req);

  // 1) 서버 세션 UUID 결정 우선순위:
  //    (a) req에 명시된 serverSessionId(uuid)
  //    (b) 유저 스코프 매핑 캐시
  //    (c) 새로 생성
  let serverSessionId: string | null = null;

  const directServerSessionId = pickDirectServerSessionId(req);
  if (directServerSessionId) {
    serverSessionId = directServerSessionId;
    setSessionMap(userUuid, clientSessionKey, directServerSessionId);
  } else {
    const map = mapsByUser.get(userUuid)!;
    serverSessionId = map.get(clientSessionKey) ?? null;
  }

  if (!serverSessionId) {
    const title = makeSessionTitleFromUserText(lastUser);
    const created = await createChatSession(
      {
        userUuid,
        title,
        domain: String(serviceDomain),
      },
      token
    );

    serverSessionId = created.id;
    setSessionMap(userUuid, clientSessionKey, created.id);
  }

  const sent = await sendChatMessage(
    {
      sessionId: serverSessionId,
      content: lastUser,
    },
    token
  );

  return {
    sessionId: serverSessionId,
    messageId: sent.messageId,
    role: "assistant",
    content: sent.content || "응답이 비어 있습니다.",
    createdAt: sent.createdAt,
  };
}

/**
 * 피드백 저장용 요청 타입
 */
export interface ChatFeedbackRequest {
  sessionId: string;
  messageId: string;
  feedback: FeedbackValue;
  comment?: string;
}

function toScore(feedback: FeedbackValue): number | null {
  if (feedback === "up") return 5;
  if (feedback === "down") return 1;
  return null;
}

export async function sendFeedbackToAI(req: ChatFeedbackRequest): Promise<void> {
  const token = await ensureFreshToken();
  if (!token) {
    console.warn("[chatApi] feedback skipped: not authenticated");
    return;
  }

  if (!isUuidLike(req.sessionId) || !isUuidLike(req.messageId)) {
    console.warn("[chatApi] feedback skipped: sessionId/messageId must be UUID", req);
    return;
  }

  const score = toScore(req.feedback);
  if (score == null) return;

  const payload: UpstreamChatFeedbackRequest = {
    score,
    comment: req.comment ?? "",
  };

  const res = await fetchWithTimeout(
    CHAT_MESSAGE_FEEDBACK_URL(req.sessionId, req.messageId),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    10_000
  );

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    console.warn(`[chatApi] feedback failed: ${res.status} ${res.statusText}`, bodyText);
  }
}

export async function retryMessage(sessionId: string, messageId: string): Promise<ChatSendResult> {
  const token = await ensureFreshToken();
  if (!token) {
    throw new Error("Not authenticated: Keycloak token is missing.");
  }

  if (!isUuidLike(sessionId) || !isUuidLike(messageId)) {
    throw new Error("Retry failed: sessionId/messageId must be UUID.");
  }

  const res = await fetchWithTimeout(
    CHAT_MESSAGE_RETRY_URL(sessionId, messageId),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
    DEFAULT_TIMEOUT_MS
  );

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `Retry failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`
    );
  }

  const data: unknown = await res.json().catch(() => null);
  if (isRecord(data) && nonEmptyString(data["content"]) && nonEmptyString(data["messageId"])) {
    return {
      sessionId,
      messageId: String(data["messageId"]),
      role: "assistant",
      content: String(data["content"]),
      createdAt: nonEmptyString(data["createdAt"]) ?? new Date().toISOString(),
    };
  }

  const text = await res.text().catch(() => "");
  return {
    sessionId,
    messageId,
    role: "assistant",
    content: text || "응답이 비어 있습니다.",
    createdAt: new Date().toISOString(),
  };
}

/* =========================
   FAQ API
========================= */

const faqHomeCache: { items: FaqHomeItem[]; fetchedAt: number } = {
  items: [],
  fetchedAt: 0,
};
const faqListCache = new Map<string, { items: FaqItem[]; fetchedAt: number }>();
const FAQ_CACHE_TTL_MS = 60_000;

function nowMs() {
  return Date.now();
}

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];
  const keys = ["items", "data", "content", "result", "list", "faqs"];
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function normalizeFaqHomeItems(raw: unknown): FaqHomeItem[] {
  const arr = extractArray(raw);
  if (!Array.isArray(arr)) return [];

  const out: FaqHomeItem[] = [];

  for (const it of arr) {
    if (!isRecord(it)) continue;

    const title =
      nonEmptyString(it["title"]) ??
      nonEmptyString(it["question"]) ??
      nonEmptyString(it["name"]) ??
      null;

    const faqId =
      nonEmptyString(it["faqId"]) ??
      nonEmptyString(it["id"]) ??
      nonEmptyString(it["faq_id"]) ??
      null;

    const domain =
      normalizeServiceDomain(it["domain"]) ??
      normalizeServiceDomain(it["serviceDomain"]) ??
      normalizeServiceDomain(it["category"]) ??
      null;

    if (!title || !faqId || !domain) continue;

    out.push({ title, faqId, domain });
  }

  return out;
}

function normalizeFaqItems(raw: unknown): FaqItem[] {
  const arr = extractArray(raw);
  if (!Array.isArray(arr)) return [];

  const out: FaqItem[] = [];

  for (const it of arr) {
    if (!isRecord(it)) continue;

    const id =
      nonEmptyString(it["id"]) ??
      nonEmptyString(it["faqId"]) ??
      nonEmptyString(it["faq_id"]);
    if (!id) continue;

    const domain =
      normalizeServiceDomain(it["domain"]) ??
      normalizeServiceDomain(it["serviceDomain"]) ??
      normalizeServiceDomain(it["category"]) ??
      null;
    if (!domain) continue;

    const question =
      nonEmptyString(it["question"]) ??
      nonEmptyString(it["q"]) ??
      nonEmptyString(it["title"]) ??
      null;
    const answer =
      nonEmptyString(it["answer"]) ??
      nonEmptyString(it["a"]) ??
      nonEmptyString(it["content"]) ??
      null;

    if (!question || !answer) continue;

    const createdAt =
      nonEmptyString(it["createdAt"]) ?? nonEmptyString(it["created_at"]) ?? undefined;
    const updatedAt =
      nonEmptyString(it["updatedAt"]) ?? nonEmptyString(it["updated_at"]) ?? undefined;

    out.push({ id, domain, question, answer, createdAt, updatedAt });
  }

  return out;
}

async function fetchFaqJson(url: string, token: string, timeoutMs = 15_000): Promise<unknown> {
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

  const data = (await res.json().catch(() => null)) as unknown;
  if (data === null) throw new Error(`GET ${url} failed: invalid JSON`);
  return data;
}

/** FAQ Home */
export async function fetchFaqHome(): Promise<FaqHomeItem[]> {
  const now = nowMs();
  if (faqHomeCache.items.length > 0 && now - faqHomeCache.fetchedAt < FAQ_CACHE_TTL_MS) {
    return faqHomeCache.items;
  }

  const token = await ensureFreshToken();
  if (!token) throw new Error("Not authenticated: Keycloak token is missing.");

  const raw = await fetchFaqJson(FAQ_HOME_ENDPOINT, token, 15_000);
  const items = normalizeFaqHomeItems(raw);

  // 빈 배열 고착 방지: 성공적으로 items가 있을 때만 캐시
  if (items.length > 0) {
    faqHomeCache.items = items;
    faqHomeCache.fetchedAt = now;
  } else {
    faqHomeCache.items = [];
    faqHomeCache.fetchedAt = 0;
  }

  return items;
}

/** FAQ Top 10 */
export async function fetchFaqList(domain: ChatServiceDomain): Promise<FaqItem[]> {
  const key = String(domain).toUpperCase();
  const now = nowMs();

  const cached = faqListCache.get(key);
  if (cached && cached.items.length > 0 && now - cached.fetchedAt < FAQ_CACHE_TTL_MS) {
    return cached.items;
  }

  const token = await ensureFreshToken();
  if (!token) throw new Error("Not authenticated: Keycloak token is missing.");

  const url = `${FAQ_LIST_ENDPOINT}?domain=${encodeURIComponent(String(domain).toUpperCase())}`;
  const raw = await fetchFaqJson(url, token, 15_000);
  const items = normalizeFaqItems(raw);

  // 빈 배열 고착 방지: items가 있을 때만 캐시
  if (items.length > 0) {
    faqListCache.set(key, { items, fetchedAt: now });
  } else {
    faqListCache.delete(key);
  }

  return items;
}

async function postJsonWithAuth(
  url: string,
  token: string,
  body: unknown,
  timeoutMs = 15_000
): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}

/**
 * 신고 제출 (실서비스 연동)
 * - 엔드포인트가 아직 확정되지 않았다면 VITE_REPORT_ENDPOINTS로 설정
 *   예: VITE_REPORT_ENDPOINTS=/api/reports,/api/report
 */
export async function submitReportToServer(
  payload: ReportPayload
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const token = await ensureFreshToken();
  if (!token) {
    return { ok: false, status: 401, message: "Not authenticated" };
  }

  // 엔드포인트 미설정이면 “프론트 더미”로 남지 않도록 명확히 실패 처리
  if (REPORT_ENDPOINTS.length === 0) {
    return {
      ok: false,
      status: 0,
      message: "Report endpoint is not configured. Set VITE_REPORT_ENDPOINTS in env.",
    };
  }

  let last: { status: number; text: string } = { status: 0, text: "" };

  for (const url of REPORT_ENDPOINTS) {
    try {
      const r = await postJsonWithAuth(url, token, payload, 15_000);
      if (r.ok) return { ok: true };
      last = { status: r.status, text: r.text };
    } catch (e: unknown) {
      last = { status: 0, text: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    ok: false,
    status: last.status,
    message: last.text || "Report submit failed",
  };
}

export type ChatStreamHandlers = {
  onDelta: (delta: string) => void; // 토큰/청크 단위 델타
  onFinal?: (final: ChatSendResult) => void; // 최종 결과
};

/**
 * 스트리밍(선택)
 * - env가 비어 있어도 CHAT_MESSAGES_ENDPOINT로 스트림을 “시도”한다.
 * - 서버가 JSON으로 한 번에 주면: onDelta 1회 + onFinal (UX 일관)
 * - 서버가 SSE/NDJSON/텍스트 스트림이면: 가능한 범위에서 증분 파싱하여 onDelta 호출
 */
export async function sendChatToAIStream(
  req: ChatRequest,
  handlers: ChatStreamHandlers
): Promise<ChatSendResult> {
  const streamUrl = (CHAT_MESSAGES_STREAM_ENDPOINT || "").trim() || CHAT_MESSAGES_ENDPOINT;

  const token = await ensureFreshToken();
  if (!token) throw new Error("Not authenticated: Keycloak token is missing.");

  const userUuid = getUserUuidFromKeycloak();
  if (!userUuid) throw new Error("Not authenticated: userUuid(sub) is missing in token.");

  hydrateUserMapOnce(userUuid);

  const lastUser =
    [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const clientSessionKey = pickClientSessionKey(req);

  // 서버 세션 UUID 결정 (sendChatToAI와 동일)
  let serverSessionId: string | null = null;

  const directServerSessionId = pickDirectServerSessionId(req);
  if (directServerSessionId) {
    serverSessionId = directServerSessionId;
    setSessionMap(userUuid, clientSessionKey, directServerSessionId);
  } else {
    const map = mapsByUser.get(userUuid)!;
    serverSessionId = map.get(clientSessionKey) ?? null;
  }

  if (!serverSessionId) {
    const title = makeSessionTitleFromUserText(lastUser);
    const uiDomain = pickUiDomain(req) ?? "general";
    const tokenDomain = getServiceDomainFromKeycloak();
    const serviceDomain = toChatServiceDomain(uiDomain, tokenDomain ?? "POLICY");

    const created = await createChatSession({ userUuid, title, domain: String(serviceDomain) }, token);
    serverSessionId = created.id;
    setSessionMap(userUuid, clientSessionKey, created.id);
  }

  const res = await fetchWithTimeout(
    streamUrl,
    {
      method: "POST",
      headers: {
        Accept: "text/event-stream, application/x-ndjson, application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        sessionId: serverSessionId,
        content: lastUser,
      }),
    },
    DEFAULT_TIMEOUT_MS
  );

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `Stream send failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`
    );
  }

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();

  // 서버가 JSON이면 "스트림이 아닌 것"으로 간주하고 최종만 처리 (단, UX 일관 위해 onDelta 1회 호출)
  if (ct.includes("application/json")) {
    const data: unknown = await res.json().catch(() => null);
    if (!isRecord(data) || !nonEmptyString(data["content"]) || !nonEmptyString(data["messageId"])) {
      throw new Error("Stream send failed: invalid json response shape");
    }

    const final: ChatSendResult = {
      sessionId: serverSessionId,
      messageId: String(data["messageId"]),
      role: "assistant",
      content: String(data["content"]),
      createdAt: nonEmptyString(data["createdAt"]) ?? new Date().toISOString(),
    };

    handlers.onDelta(final.content);
    handlers.onFinal?.(final);
    return final;
  }

  // SSE/NDJSON/Plain text 스트림 처리
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text().catch(() => "");
    handlers.onDelta(text);
    const final: ChatSendResult = {
      sessionId: serverSessionId,
      messageId: crypto.randomUUID?.() ?? `${Date.now()}`,
      role: "assistant",
      content: text || "응답이 비어 있습니다.",
      createdAt: new Date().toISOString(),
    };
    handlers.onFinal?.(final);
    return final;
  }

  const decoder = new TextDecoder("utf-8");
  let acc = "";
  let pending = "";
  let stop = false;

  let finalMessageId: string | null = null;
  let finalCreatedAt: string | null = null;

  const tryDeltaFromJson = (
    line: string
  ): { delta?: string; messageId?: string; createdAt?: string } | null => {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "string") return { delta: parsed };

      if (!isRecord(parsed)) return null;

      const delta =
        nonEmptyString(parsed["delta"]) ??
        nonEmptyString(parsed["content"]) ??
        null;

      const messageId =
        nonEmptyString(parsed["messageId"]) ?? nonEmptyString(parsed["id"]) ?? null;

      const createdAt =
        nonEmptyString(parsed["createdAt"]) ?? nonEmptyString(parsed["created_at"]) ?? null;

      if (!delta && !messageId && !createdAt) return null;
      return {
        delta: delta ?? undefined,
        messageId: messageId ?? undefined,
        createdAt: createdAt ?? undefined,
      };
    } catch {
      return null;
    }
  };

  const emitDelta = (delta: string) => {
    if (!delta) return;
    acc += delta;
    handlers.onDelta(delta);
  };

  const flushLines = () => {
    while (true) {
      const idx = pending.indexOf("\n");
      if (idx < 0) break;

      const rawLine = pending.slice(0, idx);
      pending = pending.slice(idx + 1);

      const line = rawLine.replace(/\r$/, "");
      if (!line) continue;

      // SSE keep-alive 주석 라인
      if (line.startsWith(":")) continue;

      // SSE data 라인
      if (line.startsWith("data:")) {
        const dataPart = line.slice(5).trimStart();
        if (!dataPart) continue;

        if (dataPart === "[DONE]") {
          stop = true;
          break;
        }

        const j = tryDeltaFromJson(dataPart);
        if (j?.messageId) finalMessageId = j.messageId;
        if (j?.createdAt) finalCreatedAt = j.createdAt;

        if (j?.delta) emitDelta(j.delta);
        else emitDelta(dataPart);

        continue;
      }

      // NDJSON/Plain line
      const j = tryDeltaFromJson(line);
      if (j?.messageId) finalMessageId = j.messageId;
      if (j?.createdAt) finalCreatedAt = j.createdAt;

      if (j?.delta) emitDelta(j.delta);
      else emitDelta(line + "\n");
    }
  };

  while (true) {
    const r = await reader.read();
    if (r.done) break;

    const chunk = r.value ? decoder.decode(r.value, { stream: true }) : "";
    if (!chunk) continue;

    pending += chunk;
    flushLines();
    if (stop) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      break;
    }
  }

  // 남아있는 pending 마지막 처리
  const tail = pending.trim();
  if (tail.length > 0 && !stop) {
    const j = tryDeltaFromJson(tail);
    if (j?.messageId) finalMessageId = j.messageId;
    if (j?.createdAt) finalCreatedAt = j.createdAt;
    if (j?.delta) emitDelta(j.delta);
    else emitDelta(pending);
  }

  const final: ChatSendResult = {
    sessionId: serverSessionId,
    messageId: finalMessageId ?? (crypto.randomUUID?.() ?? `${Date.now()}`),
    role: "assistant",
    content: acc || "응답이 비어 있습니다.",
    createdAt: finalCreatedAt ?? new Date().toISOString(),
  };

  handlers.onFinal?.(final);
  return final;
}
