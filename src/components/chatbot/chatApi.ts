// src/components/chatbot/chatApi.ts
import keycloak from "../../keycloak";
import type {
  ChatAction,
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
  import.meta.env.VITE_CHAT_SESSIONS_ENDPOINT?.toString() ??
  "/api/chat/sessions";

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
 * (Swagger 기준) messageId 기반 SSE 스트림 템플릿
 * - 기본: /chat/messages/{messageId}/stream
 * - env로 교체 가능:
 *   - VITE_CHAT_MESSAGE_STREAM_TEMPLATE=/chat/messages/{messageId}/stream
 *   - (호환) VITE_CHAT_MESSAGES_STREAM_ENDPOINT 도 템플릿으로 사용 가능
 */
const CHAT_MESSAGE_STREAM_TEMPLATE =
  import.meta.env.VITE_CHAT_MESSAGE_STREAM_TEMPLATE?.toString() ??
  import.meta.env.VITE_CHAT_MESSAGES_STREAM_ENDPOINT?.toString() ??
  "/chat/messages/{messageId}/stream";

/** SSE는 응답이 길어질 수 있어 타임아웃을 별도로 둔다 */
const SSE_TIMEOUT_MS = 120_000;

function buildMessageStreamUrl(messageId: string): string {
  const enc = encodeURIComponent(messageId);
  const tpl = (CHAT_MESSAGE_STREAM_TEMPLATE || "").trim();

  // 템플릿 형태 지원
  if (tpl.includes("{messageId}")) return tpl.split("{messageId}").join(enc);
  if (tpl.includes(":messageId")) return tpl.replace(":messageId", enc);

  // 만약 누군가 /chat/messages 만 넣어둔 경우를 방어
  const base = tpl.endsWith("/") ? tpl.slice(0, -1) : tpl;
  if (base.endsWith("/chat/messages")) return `${base}/${enc}/stream`;

  // 최후 fallback
  const msgBase = (CHAT_MESSAGES_ENDPOINT || "").trim() || "/chat/messages";
  return `${msgBase.replace(/\/$/, "")}/${enc}/stream`;
}

/** (선택) 신고 endpoint 후보 (서버 스펙 확정 전까지 env로 제어) */
const REPORT_ENDPOINTS_RAW: string = String(
  import.meta.env.VITE_REPORT_ENDPOINTS ?? ""
);
const REPORT_ENDPOINTS: string[] = (
  REPORT_ENDPOINTS_RAW ? REPORT_ENDPOINTS_RAW.split(",") : []
)
  .map((s: string) => s.trim())
  .filter((s: string) => s.length > 0);

/** 메시지 피드백 URL */
const CHAT_MESSAGE_FEEDBACK_URL = (sessionId: string, messageId: string) =>
  `${CHAT_SESSIONS_BASE}/${encodeURIComponent(
    sessionId
  )}/messages/${encodeURIComponent(messageId)}/feedback`;

/** (선택) 재시도 API */
const CHAT_MESSAGE_RETRY_URL = (sessionId: string, messageId: string) =>
  `${CHAT_SESSIONS_BASE}/${encodeURIComponent(
    sessionId
  )}/messages/${encodeURIComponent(messageId)}/retry`;

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
export function getServerSessionIdForLocalSession(
  localSessionId: string
): string | undefined {
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

export function getMappedServerSessionId(
  localSessionId: string
): string | undefined {
  const userUuid = getUserUuidFromKeycloak();
  if (!userUuid) return undefined;
  hydrateUserMapOnce(userUuid);
  const map = mapsByUser.get(userUuid);
  return map?.get(localSessionId);
}

export function setMappedServerSessionId(
  localSessionId: string,
  serverSessionId: string
): void {
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

  const sleep = (ms: number) =>
    new Promise<void>((r) => window.setTimeout(r, ms));

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
  return await waitForAuthToken({
    timeoutMs: 8_000,
    pollMs: 250,
    minUpdateIntervalMs: 1_000,
  });
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

/**
 * Keycloak tokenParsed.department → 사용자 부서 정보
 */
function getDepartmentFromKeycloak(): string | null {
  const parsed = keycloak?.tokenParsed as unknown;
  if (!isRecord(parsed)) return null;
  const dept = parsed["department"];
  return typeof dept === "string" && dept.trim() ? dept.trim() : null;
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
 * =========================
 * (추가) 세션 rename / delete 유틸
 * =========================
 * - 백엔드가 PATCH 미지원인 케이스가 확인되었으므로 PUT/DELETE로 고정
 */
const CHAT_SESSION_ENDPOINT = (sessionId: string) =>
  `${CHAT_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}`;

export async function renameChatSession(
  sessionId: string,
  title: string
): Promise<void> {
  const token = await ensureFreshToken();
  if (!token) throw new Error("Not authenticated: Keycloak token is missing.");

  if (!isUuidLike(sessionId))
    throw new Error("renameChatSession: sessionId must be UUID.");

  const res = await fetchWithTimeout(
    CHAT_SESSION_ENDPOINT(sessionId),
    {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title }),
    },
    12_000
  );

  if (res.ok) return;

  const text = await res.text().catch(() => "");
  throw new Error(
    `renameChatSession failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""
    }`
  );
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const token = await ensureFreshToken();
  if (!token) throw new Error("Not authenticated: Keycloak token is missing.");

  if (!isUuidLike(sessionId))
    throw new Error("deleteChatSession: sessionId must be UUID.");

  const res = await fetchWithTimeout(
    CHAT_SESSION_ENDPOINT(sessionId),
    {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
    12_000
  );

  if (res.ok) return;
  if (res.status === 404 || res.status === 410) return;

  const text = await res.text().catch(() => "");
  throw new Error(
    `deleteChatSession failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""
    }`
  );
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
    isRecord(anyReq["session"])
      ? (anyReq["session"] as JsonRecord)["domain"]
      : null,
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
  department?: string | null;
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
  /**
   * A/B 테스트 임베딩 모델 선택 (선택)
   * - "openai": text-embedding-3-large (기본값)
   * - "sroberta": ko-sroberta-multitask
   * - null/undefined: 기본값(openai) 사용
   */
  model?: string | null;
  department?: string | null;
};

/**
 * Swagger 스키마: ChatMessageSendResponse
 */
type ChatMessageSendResponse = {
  messageId: string; // uuid
  role: string;
  content: string;
  createdAt: string;
  /** AI 응답에 포함된 프론트엔드 액션 정보 */
  action?: ChatAction;
};

/**
 * Swagger 스키마: ChatFeedbackRequest (score: 1~5)
 */
type UpstreamChatFeedbackRequest = {
  score: number;
  comment?: string;
};

/**
 * 세션 목록 조회 (GET /api/chat/sessions)
 * - 스펙: GET /api/chat/sessions
 * - Response: 배열 형태의 세션 목록
 */
export async function getChatSessions(): Promise<ChatSessionResponse[]> {
  const token = await ensureFreshToken();
  if (!token) {
    throw new Error("Not authenticated: Keycloak token is missing.");
  }

  const res = await fetchWithTimeout(
    CHAT_SESSIONS_ENDPOINT,
    {
      method: "GET",
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
      `Get sessions failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""
      }`
    );
  }

  const data: unknown = await res.json().catch(() => null);

  // 배열 형태 응답 처리
  if (Array.isArray(data)) {
    return data.filter(
      (item): item is ChatSessionResponse =>
        isRecord(item) && nonEmptyString(item["id"]) !== null
    ) as ChatSessionResponse[];
  }

  // 객체 형태 응답에서 배열 추출 (방어적 처리)
  if (isRecord(data)) {
    const candidates = ["items", "data", "sessions", "content", "result"];
    for (const key of candidates) {
      const value = data[key];
      if (Array.isArray(value)) {
        return value.filter(
          (item): item is ChatSessionResponse =>
            isRecord(item) && nonEmptyString(item["id"]) !== null
        ) as ChatSessionResponse[];
      }
    }
  }

  return [];
}

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
      `Create session failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""
      }`
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
      `Send message failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""
      }`
    );
  }

  const data: unknown = await res.json().catch(() => null);

  const messageId = isRecord(data) ? nonEmptyString(data["messageId"]) : null;
  if (!messageId) {
    throw new Error("Send message failed: invalid response shape");
  }

  const role =
    isRecord(data) && typeof data["role"] === "string"
      ? data["role"]
      : "assistant";

  // (중요) content는 비어있을 수 있음: stream(JSON/SSE)에서 최종이 내려오는 구조 방어
  const content =
    isRecord(data) && typeof data["content"] === "string" ? data["content"] : "";

  const createdAt =
    isRecord(data) && typeof data["createdAt"] === "string"
      ? data["createdAt"]
      : new Date().toISOString();

  // AI 응답의 meta.action 또는 action 필드에서 액션 정보 추출
  let action: ChatAction | undefined;
  if (isRecord(data)) {
    const metaObj = data["meta"];
    const actionData = isRecord(metaObj)
      ? metaObj["action"]
      : data["action"];

    if (isRecord(actionData) && typeof actionData["type"] === "string") {
      action = {
        type: actionData["type"] as ChatAction["type"],
        educationId:
          nonEmptyString(actionData["education_id"]) ??
          nonEmptyString(actionData["educationId"]) ??
          undefined,
        videoId:
          nonEmptyString(actionData["video_id"]) ??
          nonEmptyString(actionData["videoId"]) ??
          undefined,
        resumePositionSeconds:
          typeof actionData["resume_position_seconds"] === "number"
            ? actionData["resume_position_seconds"]
            : typeof actionData["resumePositionSeconds"] === "number"
              ? actionData["resumePositionSeconds"]
              : undefined,
        educationTitle:
          nonEmptyString(actionData["education_title"]) ??
          nonEmptyString(actionData["educationTitle"]) ??
          undefined,
        videoTitle:
          nonEmptyString(actionData["video_title"]) ??
          nonEmptyString(actionData["videoTitle"]) ??
          undefined,
        progressPercent:
          typeof actionData["progress_percent"] === "number"
            ? actionData["progress_percent"]
            : typeof actionData["progressPercent"] === "number"
              ? actionData["progressPercent"]
              : undefined,
      };
    }
  }

  return { messageId, role, content, createdAt, action };
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
    const department = getDepartmentFromKeycloak();
    const created = await createChatSession(
      {
        userUuid,
        title,
        domain: String(serviceDomain),
        department: department ?? undefined,
      },
      token
    );

    serverSessionId = created.id;
    setSessionMap(userUuid, clientSessionKey, created.id);
  }

  // A/B 테스트: req.model 추출
  const abModel = (req as unknown as { model?: string | null }).model ?? null;
  const department = getDepartmentFromKeycloak();

  const sent = await sendChatMessage(
    {
      sessionId: serverSessionId,
      content: lastUser,
      model: abModel,
      department: department ?? undefined,
    },
    token
  );

  return {
    sessionId: serverSessionId,
    messageId: sent.messageId,
    role: "assistant",
    content: sent.content || "응답이 비어 있습니다.",
    createdAt: sent.createdAt,
    action: sent.action,
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
    console.warn(
      "[chatApi] feedback skipped: sessionId/messageId must be UUID",
      req
    );
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
    console.warn(
      `[chatApi] feedback failed: ${res.status} ${res.statusText}`,
      bodyText
    );
  }
}

export async function retryMessage(
  sessionId: string,
  messageId: string
): Promise<ChatSendResult> {
  const token = await ensureFreshToken();
  if (!token) throw new Error("Not authenticated: Keycloak token is missing.");

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

  // 에러면 텍스트 그대로 포함
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `Retry failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""
      }`
    );
  }

  // (중요) 바디는 1번만 읽는다
  const rawText = await res.text().catch(() => "");
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

  // JSON 가능성이 있으면 파싱 시도 (content-type이 json이거나, 본문이 { 로 시작하는 경우)
  let parsed: unknown = null;
  const looksJson =
    contentType.includes("application/json") || rawText.trim().startsWith("{");

  if (looksJson && rawText.trim()) {
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      parsed = null;
    }
  }

  // JSON 응답 케이스: id/messageId 모두 허용 + content 추출
  if (isRecord(parsed)) {
    const returnedSessionId =
      nonEmptyString(parsed["sessionId"]) ??
      nonEmptyString(parsed["session_id"]) ??
      null;

    const returnedMessageId =
      nonEmptyString(parsed["messageId"]) ??
      nonEmptyString(parsed["message_id"]) ??
      nonEmptyString(parsed["id"]) ?? // <-- 네 백엔드 응답은 여기로 들어옴
      null;

    const extractedContent = extractTextLikeContent(parsed) ?? "";

    const createdAt =
      nonEmptyString(parsed["createdAt"]) ??
      nonEmptyString(parsed["created_at"]) ??
      new Date().toISOString();

    // AI 응답의 meta.action 또는 action 필드에서 액션 정보 추출 (일반 메시지와 동일)
    let action: ChatAction | undefined;
    const metaObj = parsed["meta"];
    const actionData = isRecord(metaObj)
      ? metaObj["action"]
      : parsed["action"];

    if (isRecord(actionData) && typeof actionData["type"] === "string") {
      action = {
        type: actionData["type"] as ChatAction["type"],
        educationId:
          nonEmptyString(actionData["education_id"]) ??
          nonEmptyString(actionData["educationId"]) ??
          undefined,
        videoId:
          nonEmptyString(actionData["video_id"]) ??
          nonEmptyString(actionData["videoId"]) ??
          undefined,
        resumePositionSeconds:
          typeof actionData["resume_position_seconds"] === "number"
            ? actionData["resume_position_seconds"]
            : typeof actionData["resumePositionSeconds"] === "number"
              ? actionData["resumePositionSeconds"]
              : undefined,
        educationTitle:
          nonEmptyString(actionData["education_title"]) ??
          nonEmptyString(actionData["educationTitle"]) ??
          undefined,
        videoTitle:
          nonEmptyString(actionData["video_title"]) ??
          nonEmptyString(actionData["videoTitle"]) ??
          undefined,
        progressPercent:
          typeof actionData["progress_percent"] === "number"
            ? actionData["progress_percent"]
            : typeof actionData["progressPercent"] === "number"
              ? actionData["progressPercent"]
              : undefined,
      };
    }

    return {
      sessionId: returnedSessionId ?? sessionId,
      messageId: returnedMessageId ?? messageId,
      role: "assistant",
      content: extractedContent.trim() ? extractedContent : "응답이 비어 있습니다.",
      createdAt,
      action,
    };
  }

  // 텍스트 응답 케이스(JSON 파싱 실패 or text/plain)
  return {
    sessionId,
    messageId,
    role: "assistant",
    content: rawText.trim() ? rawText : "응답이 비어 있습니다.",
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
      nonEmptyString(it["createdAt"]) ??
      nonEmptyString(it["created_at"]) ??
      undefined;
    const updatedAt =
      nonEmptyString(it["updatedAt"]) ??
      nonEmptyString(it["updated_at"]) ??
      undefined;

    out.push({ id, domain, question, answer, createdAt, updatedAt });
  }

  return out;
}

async function fetchFaqJson(
  url: string,
  token: string,
  timeoutMs = 15_000
): Promise<unknown> {
  console.log(`[FAQ API] fetchFaqJson 호출:`, { url, timeoutMs, hasToken: !!token });
  try {
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

    console.log(`[FAQ API] 응답 상태:`, { 
      url, 
      status: res.status, 
      statusText: res.statusText,
      ok: res.ok 
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.error(`[FAQ API] 요청 실패:`, { 
        url, 
        status: res.status, 
        statusText: res.statusText,
        body: bodyText 
      });
      throw new Error(
        `GET ${url} failed: ${res.status} ${res.statusText}${bodyText ? ` - ${bodyText}` : ""}`
      );
    }

    const data = (await res.json().catch(() => null)) as unknown;
    if (data === null) {
      console.error(`[FAQ API] JSON 파싱 실패:`, { url });
      throw new Error(`GET ${url} failed: invalid JSON`);
    }
    console.log(`[FAQ API] 응답 데이터:`, { url, dataType: Array.isArray(data) ? 'array' : typeof data, dataLength: Array.isArray(data) ? data.length : 'N/A' });
    return data;
  } catch (error) {
    console.error(`[FAQ API] fetchFaqJson 에러:`, { url, error });
    throw error;
  }
}

/** FAQ Home */
export async function fetchFaqHome(): Promise<FaqHomeItem[]> {
  const now = nowMs();
  if (
    faqHomeCache.items.length > 0 &&
    now - faqHomeCache.fetchedAt < FAQ_CACHE_TTL_MS
  ) {
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
  if (
    cached &&
    cached.items.length > 0 &&
    now - cached.fetchedAt < FAQ_CACHE_TTL_MS
  ) {
    console.log(`[FAQ API] 캐시에서 반환 (${key}):`, cached.items.length, "개");
    return cached.items;
  }

  const token = await ensureFreshToken();
  if (!token) throw new Error("Not authenticated: Keycloak token is missing.");

  const url = `${FAQ_LIST_ENDPOINT}?domain=${encodeURIComponent(
    String(domain).toUpperCase()
  )}`;
  console.log(`[FAQ API] 요청 URL (${key}):`, url);
  
  const raw = await fetchFaqJson(url, token, 15_000);
  console.log(`[FAQ API] 원본 응답 (${key}):`, raw);
  
  const items = normalizeFaqItems(raw);
  console.log(`[FAQ API] 정규화된 FAQ (${key}):`, items.length, "개", items);

  // 빈 배열 고착 방지: items가 있을 때만 캐시
  if (items.length > 0) {
    faqListCache.set(key, { items, fetchedAt: now });
    console.log(`[FAQ API] 캐시 저장 (${key}):`, items.length, "개");
  } else {
    faqListCache.delete(key);
    console.warn(`[FAQ API] ⚠️ 도메인 ${key}에 대한 FAQ가 0개입니다.`);
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
      message:
        "Report endpoint is not configured. Set VITE_REPORT_ENDPOINTS in env.",
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

function extractTextLikeContent(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (!isRecord(raw)) return null;

  // 1) 1차 후보 키
  const directCandidates = [
    "content",
    "text",
    "message",
    "answer",
    "data",
    "result",
    "response",
    "payload",
    "output",
  ] as const;

  for (const k of directCandidates) {
    const v = raw[k];
    if (typeof v === "string") return v;

    if (isRecord(v)) {
      const nested =
        v["content"] ?? v["text"] ?? v["message"] ?? v["answer"] ?? v["output"];
      if (typeof nested === "string") return nested;
    }
  }

  // 2) OpenAI/LLM 스타일 방어: choices[0].message.content / choices[0].delta.content
  const choices = raw["choices"];
  if (Array.isArray(choices) && choices.length > 0 && isRecord(choices[0])) {
    const c0 = choices[0] as Record<string, unknown>;
    const msg = c0["message"];
    if (isRecord(msg) && typeof msg["content"] === "string") return msg["content"];
    const delta = c0["delta"];
    if (isRecord(delta) && typeof delta["content"] === "string")
      return delta["content"];
  }

  return null;
}

async function streamMessageByIdSSE(
  messageId: string,
  token: string,
  onDelta: (delta: string) => void
): Promise<{ content: string }> {
  const url = buildMessageStreamUrl(messageId);

  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache",
      },
    },
    SSE_TIMEOUT_MS
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `SSE GET ${url} failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""
      }`
    );
  }

  // 서버가 스트림 대신 JSON/텍스트로 한 방에 주는 케이스 방어
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("text/event-stream")) {
    if (contentType.includes("application/json")) {
      const j: unknown = await res.json().catch(() => null);
      const txt = extractTextLikeContent(j);
      const out = txt ?? "";
      if (out) onDelta(out);
      return { content: out };
    }

    const t = await res.text().catch(() => "");
    if (t) onDelta(t);
    return { content: t };
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("SSE response has no body reader");

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let acc = "";
  let done = false;

  const normalizeNewlines = (s: string) =>
    s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const tryParseDeltaFromJson = (raw: string): string | null => {
    // JSON 파싱 용도: 앞뒤 공백만 제거(데이터 자체의 공백/개행은 JSON 문자열로 들어오면 보존됨)
    const t = raw.trim();
    if (!t.startsWith("{") || !t.endsWith("}")) return null;

    try {
      const obj = JSON.parse(t) as unknown;
      if (!isRecord(obj)) return null;
      const v =
        obj["delta"] ??
        obj["token"] ??
        obj["content"] ??
        obj["text"] ??
        obj["message"];
      return typeof v === "string" ? v : null;
    } catch {
      return null;
    }
  };

  // --- (핵심) data: 뒤의 "관례적 1공백" 존재 여부를 자동 판별 ---
  // prefix가 "data: "인 서버: 모든 data payload가 항상 공백으로 시작(토큰이 공백 없어도)
  // prefix가 "data:"인 서버: payload가 공백/비공백이 섞여 나옴(토큰 선행 공백이 실제 띄어쓰기)
  type PrefixMode = "unknown" | "stripOneLeadingSpace" | "keepAsIs";
  let prefixMode: PrefixMode = "unknown";
  const prebuffer: string[] = [];
  const PREBUFFER_LIMIT = 20;

  const applyPrefixMode = (d: string) => {
    if (prefixMode === "stripOneLeadingSpace" && d.startsWith(" "))
      return d.slice(1);
    return d;
  };

  const flushPrebuffer = () => {
    for (const b of prebuffer) {
      const out = applyPrefixMode(b);
      if (!out) continue;
      acc += out;
      onDelta(out);
    }
    prebuffer.length = 0;
  };

  const emitDelta = (rawDelta: string) => {
    if (!rawDelta) return;

    if (prefixMode === "unknown") {
      prebuffer.push(rawDelta);

      // 하나라도 "공백으로 시작하지 않는 delta"가 나오면 → data:(공백 없음) 스타일로 판단
      if (!rawDelta.startsWith(" ")) {
        prefixMode = "keepAsIs";
        flushPrebuffer();
        return;
      }

      // 일정 샘플 동안 계속 공백으로 시작하면 → data: (관례적 1공백) 스타일로 판단
      if (prebuffer.length >= PREBUFFER_LIMIT) {
        prefixMode = "stripOneLeadingSpace";
        flushPrebuffer();
      }
      return;
    }

    const out = applyPrefixMode(rawDelta);
    if (!out) return;
    acc += out;
    onDelta(out);
  };

  const flushEvents = () => {
    buffer = normalizeNewlines(buffer);

    while (true) {
      const sep = buffer.indexOf("\n\n");
      if (sep < 0) break;

      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const lines = rawEvent.split("\n");
      let eventName = "";
      const dataLines: string[] = [];

      for (const line of lines) {
        // 빈 라인은 이벤트 내에서는 의미가 없으므로 스킵
        if (!line) continue;

        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          // (핵심) "data:" 뒤 첫 공백을 무조건 제거하면 안 됨.
          // 서버가 `data:<delta>`(콜론 뒤 공백 없음)이고 delta 자체가 " 개인정보"처럼 선행 공백이면
          // 여기서 공백이 잘려서 '띄어쓰기 없는' 스트림 출력이 된다.
          const v = line.slice("data:".length); // 공백 포함 원문 보존
          dataLines.push(v);
        }
        // 기타 필드(id:, retry:) 등은 무시
      }

      // data 라인이 0개면 의미 있는 이벤트가 아님
      if (dataLines.length === 0) continue;

      const dataRaw = dataLines.join("\n");

      // 제어용 비교는 trim 사용 (단, 델타 자체는 절대 trim하지 않음)
      const dataControl = dataRaw.trim();

      // 서버 스펙: token 이벤트에서 [DONE]
      if (dataControl === "[DONE]") {
        done = true;
        break;
      }

      // meta stream-start 같은 것은 토큰으로 붙이지 않음
      if (eventName === "meta" && dataControl === "stream-start") continue;

      // token or unnamed event → data를 델타로 취급
      if (
        !eventName ||
        eventName === "token" ||
        eventName === "delta" ||
        eventName === "message"
      ) {
        // 공백/개행만 있는 토큰도 유효하므로 절대 trim 기반으로 버리지 않는다.
        const fromJson = tryParseDeltaFromJson(dataRaw);
        const delta = fromJson ?? dataRaw;

        // 완전 빈 문자열(길이 0)만 제외
        if (delta.length === 0) continue;

        emitDelta(delta);
      }
    }
  };

  while (true) {
    const r = await reader.read();
    if (r.done) break;

    const chunk = r.value ? decoder.decode(r.value, { stream: true }) : "";
    if (!chunk) continue;

    buffer += chunk;
    flushEvents();

    if (done) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      break;
    }
  }

  // tail 처리: trim 금지(공백/개행만 남아도 이벤트가 될 수 있음)
  if (!done && buffer.length > 0) {
    buffer += "\n\n";
    flushEvents();
  }

  // 스트림이 짧아서 prefix 판별이 끝나지 않은 채 종료될 수 있음 → 안전하게 flush
  if (prebuffer.length > 0) {
    if (prefixMode === "unknown") {
      // 끝까지 "공백 시작"만 봤다면 data: <payload> 스타일일 확률이 높음
      prefixMode = "stripOneLeadingSpace";
    }
    flushPrebuffer();
  }

  return { content: acc };
}

/**
 * 스트리밍
 * - env가 비어 있어도 CHAT_MESSAGES_ENDPOINT로 스트림을 “시도”한다.
 * - 서버가 JSON으로 한 번에 주면: onDelta 1회 + onFinal (UX 일관)
 * - 서버가 SSE/NDJSON/텍스트 스트림이면: 가능한 범위에서 증분 파싱하여 onDelta 호출
 */
export async function sendChatToAIStream(
  req: ChatRequest,
  handlers: ChatStreamHandlers
): Promise<ChatSendResult> {
  const token = await ensureFreshToken();
  if (!token) throw new Error("Not authenticated: Keycloak token is missing.");

  const userUuid = getUserUuidFromKeycloak();
  if (!userUuid)
    throw new Error("Not authenticated: userUuid(sub) is missing in token.");

  hydrateUserMapOnce(userUuid);

  const lastUser =
    [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const clientSessionKey = pickClientSessionKey(req);

  // 1) 서버 세션 UUID 결정 (sendChatToAI와 동일)
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
    const department = getDepartmentFromKeycloak();

    const created = await createChatSession(
      { userUuid, title, domain: String(serviceDomain), department: department ?? undefined },
      token
    );
    serverSessionId = created.id;
    setSessionMap(userUuid, clientSessionKey, created.id);
  }

  // A/B 테스트: req.model 추출
  const abModel = (req as unknown as { model?: string | null }).model ?? null;
  const department = getDepartmentFromKeycloak();

  // 2) 먼저 POST /chat/messages 로 messageId 확보
  const sent = await sendChatMessage(
    {
      sessionId: serverSessionId,
      content: lastUser,
      model: abModel,
      department: department ?? undefined,
    },
    token
  );

  // 3) 그 다음 GET /chat/messages/{messageId}/stream 으로 SSE 구독
  let streamed = "";
  try {
    const r = await streamMessageByIdSSE(
      sent.messageId,
      token,
      handlers.onDelta
    );
    streamed = r.content;
  } catch (err: unknown) {
    console.warn(
      "[chatApi] SSE stream failed; falling back to non-stream response",
      err
    );
    // SSE가 실패하거나 서버가 스트림을 안 주는 경우: UX를 위해 최소 1회 델타로라도 반영
    const fallback = sent.content || "응답이 비어 있습니다.";
    handlers.onDelta(fallback);
    streamed = fallback;
  }

  const final: ChatSendResult = {
    sessionId: serverSessionId,
    messageId: sent.messageId,
    role: "assistant",
    content: streamed || sent.content || "응답이 비어 있습니다.",
    createdAt: sent.createdAt || new Date().toISOString(),
  };

  handlers.onFinal?.(final);
  return final;
}

/**
 * 재시도 메시지 스트리밍 (일반 메시지와 동일한 스트리밍 방식)
 * - retryMessage를 호출하여 messageId를 얻고, 그 messageId로 스트리밍을 시작
 * - 서버가 스트림을 못 주면 retryMessage의 응답을 fallback으로 사용
 */
export async function retryMessageStream(
  sessionId: string,
  messageId: string,
  handlers: ChatStreamHandlers
): Promise<ChatSendResult> {
  const token = await ensureFreshToken();
  if (!token) throw new Error("Not authenticated: Keycloak token is missing.");

  if (!isUuidLike(sessionId) || !isUuidLike(messageId)) {
    throw new Error("Retry failed: sessionId/messageId must be UUID.");
  }

  // 1) 먼저 retryMessage를 호출하여 새 messageId 확보
  const retryResult = await retryMessage(sessionId, messageId);
  const newMessageId = retryResult.messageId;

  // 2) 새 messageId로 스트리밍 시작
  let streamed = "";
  try {
    const r = await streamMessageByIdSSE(newMessageId, token, handlers.onDelta);
    streamed = r.content;
  } catch (err: unknown) {
    console.warn(
      "[chatApi] retryMessageStream SSE failed; falling back to non-stream response",
      err
    );
    // SSE가 실패하거나 서버가 스트림을 안 주는 경우: UX를 위해 최소 1회 델타로라도 반영
    const fallback = retryResult.content || "응답이 비어 있습니다.";
    handlers.onDelta(fallback);
    streamed = fallback;
  }

  const final: ChatSendResult = {
    sessionId: retryResult.sessionId ?? sessionId,
    messageId: newMessageId,
    role: "assistant",
    content: streamed || retryResult.content || "응답이 비어 있습니다.",
    createdAt: retryResult.createdAt || new Date().toISOString(),
    action: retryResult.action,
  };

  handlers.onFinal?.(final);
  return final;
}
