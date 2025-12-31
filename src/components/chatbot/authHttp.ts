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
 * updateToken / token-ready 단계에서 가끔 네트워크/키클락 문제로 "영원히 await" 되는 케이스 방어
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = window.setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
  });

  return Promise.race([
    p.finally(() => {
      if (t !== undefined) window.clearTimeout(t);
    }),
    timeout,
  ]);
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

    // token이 없으면 updateToken(0)로 유도 (단, 무한대기 방지)
    try {
      await withTimeout(Promise.resolve(keycloak.updateToken(0)), 2_500, "keycloak.updateToken(0)");
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
          // updateToken 자체도 가끔 hang 가능 → 타임아웃 방어
          await withTimeout(
            Promise.resolve(keycloak.updateToken(minValiditySeconds)),
            5_000,
            `keycloak.updateToken(${minValiditySeconds})`
          );
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
 * - 동일 (method + url + body) 요청이 동시에 들어오면 1회만 수행
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

  // “중복 호출 방지”를 위해 PUT/PATCH/DELETE도 포함
  // (원치 않으면 여기서 GET/HEAD만 남기면 됨)
  const dedupeMethods = new Set(["GET", "HEAD", "PUT", "PATCH", "DELETE"]);
  if (!dedupeMethods.has(method)) return null;

  const b = bodyToKey(init.body ?? null);
  return `${method} ${url} ${b}`;
}

function canRetryWithSameBody(init: RequestInit): boolean {
  // 401 재시도 시 body를 그대로 재사용할 수 있는지 판단
  const b = init.body ?? null;
  if (!b) return true;
  if (typeof b === "string") return true;
  if (b instanceof URLSearchParams) return true;
  // FormData/Blob/ReadableStream 등은 안전하게 재시도 불가로 처리
  return false;
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
    // 401이면 1회 강제 토큰 갱신 후 재시도(무한루프 방지)
    let retried401 = false;

    const doFetchOnce = async (): Promise<{ res: Response; body: JsonLike }> => {
      const headers = await withAuthHeaders(init.headers);
      const res = await fetch(url, { ...init, headers });
      const body = await readBodySafe(res);
      return { res, body };
    };

    while (true) {
      const { res, body } = await doFetchOnce();

      if (res.ok) {
        return body as T;
      }

      // 401 한 번은 토큰 갱신 후 재시도
      if (
        res.status === 401 &&
        !retried401 &&
        keycloak?.authenticated &&
        canRetryWithSameBody(init)
      ) {
        retried401 = true;
        try {
          // 강제 갱신 (hang 방지 포함)
          await withTimeout(Promise.resolve(keycloak.updateToken(0)), 5_000, "keycloak.updateToken(0) retry");
        } catch {
          // ignore
        }
        continue;
      }

      throw new HttpError({
        url,
        status: res.status,
        statusText: res.statusText,
        body,
      });
    }
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
