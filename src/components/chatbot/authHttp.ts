// src/components/chatbot/authHttp.ts
import keycloak from "../../keycloak";

type JsonLike = unknown;

function headersToObject(headers?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;

  if (headers instanceof Headers) {
    headers.forEach((v, k) => (out[k] = v));
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
    return out;
  }
  return { ...(headers as Record<string, string>) };
}

/**
 * 토큰 갱신을 "단일 비행(in-flight)"으로 dedupe하기 위한 Promise
 */
let tokenRefreshInFlight: Promise<void> | null = null;

async function sleep(ms: number) {
  return await new Promise<void>((r) => window.setTimeout(r, ms));
}

/**
 * keycloak.authenticated=true인데 token이 아직 없는 초기 레이스 흡수
 */
async function waitTokenReady(timeoutMs = 6_000, pollMs = 200): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!keycloak?.authenticated) {
      await sleep(pollMs);
      continue;
    }
    if (keycloak.token) return;

    // token이 없으면 updateToken(0)로 유도
    try {
      await keycloak.updateToken(0);
      if (keycloak.token) return;
    } catch {
      // ignore
    }

    await sleep(pollMs);
  }
}

export async function getAccessToken(minValiditySeconds: number = 30): Promise<string | null> {
  if (!keycloak?.authenticated) return null;

  // authenticated인데 token이 늦게 세팅되는 케이스 방지
  if (!keycloak.token) {
    await waitTokenReady(6_000, 200);
  }

  try {
    if (!tokenRefreshInFlight) {
      tokenRefreshInFlight = (async () => {
        try {
          await keycloak.updateToken(minValiditySeconds);
        } catch {
          // ignore
        }
      })().finally(() => {
        tokenRefreshInFlight = null;
      });
    }

    await tokenRefreshInFlight;
  } catch {
    // ignore
  }

  return keycloak.token ?? null;
}

export async function withAuthHeaders(headers?: HeadersInit): Promise<Record<string, string>> {
  const merged = headersToObject(headers);

  const token = await getAccessToken(30);
  if (token) merged["Authorization"] = `Bearer ${token}`;

  return merged;
}

async function readBodySafe(res: Response): Promise<JsonLike> {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

type HttpErrorInit = {
  url: string;
  status: number;
  statusText: string;
  body: JsonLike;
};

export class HttpError extends Error {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly body: JsonLike;

  constructor(init: HttpErrorInit) {
    super(`HTTP ${init.status} ${init.statusText}`);
    this.name = "HttpError";
    this.url = init.url;
    this.status = init.status;
    this.statusText = init.statusText;
    this.body = init.body;
  }
}

/**
 * (추가) 네트워크 중복 호출 dedupe
 * - GET/HEAD/PUT/PATCH/DELETE 는 동일 (method + url + body) 요청이 동시에 들어오면 1회만 수행
 */
const inflight = new Map<string, Promise<unknown>>();

function normalizeMethod(m?: string): string {
  return (m ?? "GET").toUpperCase();
}

function bodyToKey(body: BodyInit | null | undefined): string {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  // FormData/Blob/ReadableStream 등은 키 생성이 불안정하므로 생략(=dedupe 약화)
  return "";
}

function makeDedupeKey(url: string, init: RequestInit): string | null {
  const method = normalizeMethod(init.method);
  const dedupeMethods = new Set(["GET", "HEAD", "PUT", "PATCH", "DELETE"]);
  if (!dedupeMethods.has(method)) return null;

  const b = bodyToKey(init.body ?? null);
  return `${method} ${url} ${b}`;
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const dedupeKey = makeDedupeKey(url, init);

  if (dedupeKey) {
    const existed = inflight.get(dedupeKey);
    if (existed) {
      return (await existed) as T;
    }
  }

  const runner = (async () => {
    const headers = await withAuthHeaders(init.headers);

    const res = await fetch(url, { ...init, headers });
    const body = await readBodySafe(res);

    if (!res.ok) {
      throw new HttpError({
        url,
        status: res.status,
        statusText: res.statusText,
        body,
      });
    }

    return body as T;
  })();

  if (dedupeKey) {
    inflight.set(
      dedupeKey,
      runner.finally(() => {
        inflight.delete(dedupeKey);
      })
    );
  }

  return await runner;
}
