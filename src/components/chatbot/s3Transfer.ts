// src/components/chatbot/s3Transfer.ts
import keycloak from "../../keycloak";

export type PutProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export type PutOptions = {
  signal?: AbortSignal;
  contentType?: string;
  onProgress?: (p: PutProgress) => void;
};

/**
 * S3 Presigned PUT 업로드 (직접 PUT, Authorization 등 커스텀 헤더 금지)
 * - 진행률 필요 → XHR 사용
 */
export function s3Put(url: string, body: Blob, opts?: PutOptions): Promise<void> {
  const target = (url ?? "").trim();
  if (!target) return Promise.reject(new Error("[S3] PUT: url is empty"));

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target, true);

    if (opts?.contentType) {
      try {
        xhr.setRequestHeader("Content-Type", opts.contentType);
      } catch {
        // 일부 presigned URL은 Content-Type 헤더 자체가 서명에 포함될 수 있음 → 설정 실패 시 무시
      }
    }

    xhr.upload.onprogress = (evt) => {
      if (!opts?.onProgress) return;
      const total = typeof evt.total === "number" && evt.total > 0 ? evt.total : null;
      const percent = total ? Math.round((evt.loaded / total) * 100) : null;
      opts.onProgress({ loaded: evt.loaded, total, percent });
    };

    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (ok) resolve();
      else reject(new Error(`[S3] PUT failed: status=${xhr.status} body=${(xhr.responseText ?? "").slice(0, 200)}`));
    };

    xhr.onerror = () => reject(new Error("[S3] PUT failed: network error"));
    xhr.onabort = () => {
      const err = new Error("[S3] PUT aborted");
      (err as unknown as { name: string }).name = "AbortError";
      reject(err);
    };

    // abort wiring
    const onAbort = () => xhr.abort();
    if (opts?.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      xhr.send(body);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function getTokenOrThrow(): string {
  const t = (keycloak as unknown as { token?: unknown })?.token;
  if (typeof t === "string" && t.trim()) return t;
  throw new Error("[S3_PROXY] token is missing");
}

/**
 * infra-service proxy PUT 폴백
 * - proxyPutUrl: /infra/files/presign/upload/put?url=<presignedUrl>
 * - Authorization: Bearer 토큰 필요(인프라 서비스가 보호되어 있다고 가정)
 * - 진행률이 필요하면 XHR로 동일하게 처리
 */
export function proxyPut(proxyPutUrl: string, body: Blob, opts?: PutOptions): Promise<void> {
  const target = (proxyPutUrl ?? "").trim();
  if (!target) return Promise.reject(new Error("[S3_PROXY] PUT: url is empty"));

  const token = getTokenOrThrow();

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target, true);

    try {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    } catch {
      // ignore
    }

    if (opts?.contentType) {
      try {
        xhr.setRequestHeader("Content-Type", opts.contentType);
      } catch {
        // ignore
      }
    }

    xhr.upload.onprogress = (evt) => {
      if (!opts?.onProgress) return;
      const total = typeof evt.total === "number" && evt.total > 0 ? evt.total : null;
      const percent = total ? Math.round((evt.loaded / total) * 100) : null;
      opts.onProgress({ loaded: evt.loaded, total, percent });
    };

    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (ok) resolve();
      else reject(new Error(`[S3_PROXY] PUT failed: status=${xhr.status} body=${(xhr.responseText ?? "").slice(0, 200)}`));
    };

    xhr.onerror = () => reject(new Error("[S3_PROXY] PUT failed: network error"));
    xhr.onabort = () => {
      const err = new Error("[S3_PROXY] PUT aborted");
      (err as unknown as { name: string }).name = "AbortError";
      reject(err);
    };

    const onAbort = () => xhr.abort();
    if (opts?.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      xhr.send(body);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * direct PUT → 실패 시 proxy PUT 폴백
 * (CORS/403/서명 mismatch 등에서 폴백이 의미 있음)
 */
export async function putWithProxyFallback(
  presignedPutUrl: string,
  proxyPutUrl: string,
  body: Blob,
  opts?: PutOptions
): Promise<{ usedProxy: boolean }> {
  try {
    await s3Put(presignedPutUrl, body, opts);
    return { usedProxy: false };
  } catch (e) {
    // abort는 폴백 금지(사용자 의도)
    if (e instanceof Error && e.name === "AbortError") throw e;
    await proxyPut(proxyPutUrl, body, opts);
    return { usedProxy: true };
  }
}
