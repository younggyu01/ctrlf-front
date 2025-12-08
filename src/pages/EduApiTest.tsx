import React, { useMemo, useState } from "react";
import keycloak from "../keycloak";

type GetParams = {
  page?: number;
  size?: number;
  completed?: "" | "true" | "false";
  year?: number | "";
  category?: "" | "MANDATORY" | "JOB" | "ETC";
};

const defaultBody = `{
  "title": "안전교육 1",
  "description": "예시 설명",
  "category": "MANDATORY",
  "require": true,
  "passScore": 80,
  "passRatio": 90,
  "departmentScope": ["HR", "ENG"]
}`;

export default function EduApiTest() {
  const [getParams, setGetParams] = useState<GetParams>({
    page: 0,
    size: 10,
    completed: "",
    year: "",
    category: "",
  });
  const [getResult, setGetResult] = useState<string>("");
  const [postBody, setPostBody] = useState<string>(defaultBody);
  const [postResult, setPostResult] = useState<string>("");
  const [loadingGet, setLoadingGet] = useState(false);
  const [loadingPost, setLoadingPost] = useState(false);

  const tokenInfo = useMemo(() => {
    return {
      hasToken: !!keycloak.token,
      sub: keycloak.tokenParsed?.sub,
    };
  }, [keycloak.token, keycloak.tokenParsed]);

  async function getAuthHeaders(): Promise<HeadersInit> {
    try {
      await keycloak.updateToken(30);
    } catch {
      // ignore; if update fails we'll try with current token
    }
    if (!keycloak.token) {
      throw new Error("Keycloak 토큰이 없습니다. 로그인 상태를 확인하세요.");
    }
    return {
      Authorization: `Bearer ${keycloak.token}`,
      "Content-Type": "application/json",
    };
  }

  async function handleGet() {
    setLoadingGet(true);
    setGetResult("");
    try {
      const q = new URLSearchParams();
      if (getParams.page !== undefined && getParams.page !== null)
        q.set("page", String(getParams.page));
      if (getParams.size !== undefined && getParams.size !== null)
        q.set("size", String(getParams.size));
      if (getParams.completed) q.set("completed", getParams.completed);
      if (
        getParams.year !== "" &&
        getParams.year !== undefined &&
        getParams.year !== null
      )
        q.set("year", String(getParams.year));
      if (getParams.category) q.set("category", getParams.category);

      const headers = await getAuthHeaders();
      const resp = await fetch(`/api-edu/edus?${q.toString()}`, {
        method: "GET",
        headers,
      });
      const text = await resp.text();
      setGetResult(formatResult(resp.status, text));
    } catch (e: any) {
      setGetResult(`ERROR: ${e?.message ?? String(e)}`);
    } finally {
      setLoadingGet(false);
    }
  }

  async function handlePost() {
    setLoadingPost(true);
    setPostResult("");
    try {
      let bodyObj: unknown;
      try {
        bodyObj = JSON.parse(postBody);
      } catch (e) {
        throw new Error("유효한 JSON 형식이 아닙니다.");
      }
      const headers = await getAuthHeaders();
      const resp = await fetch("/api-edu/edu", {
        method: "POST",
        headers,
        body: JSON.stringify(bodyObj),
      });
      const text = await resp.text();
      setPostResult(formatResult(resp.status, text));
    } catch (e: any) {
      setPostResult(`ERROR: ${e?.message ?? String(e)}`);
    } finally {
      setLoadingPost(false);
    }
  }

  function formatResult(status: number, raw: string) {
    try {
      const parsed = JSON.parse(raw);
      return `status: ${status}\n` + JSON.stringify(parsed, null, 2);
    } catch {
      return `status: ${status}\n` + raw;
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h2>교육 API 테스트</h2>
      <div
        style={{
          margin: "8px 0 16px",
          color: tokenInfo.hasToken ? "green" : "crimson",
        }}
      >
        토큰: {tokenInfo.hasToken ? "있음" : "없음"}{" "}
        {tokenInfo.sub ? `(sub: ${tokenInfo.sub})` : ""}
      </div>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginBottom: 8 }}>GET /edus</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "140px 1fr",
            gap: 8,
            maxWidth: 560,
          }}
        >
          <label>page</label>
          <input
            type="number"
            value={getParams.page ?? 0}
            onChange={(e) =>
              setGetParams((p) => ({ ...p, page: Number(e.target.value) }))
            }
          />
          <label>size</label>
          <input
            type="number"
            value={getParams.size ?? 10}
            onChange={(e) =>
              setGetParams((p) => ({ ...p, size: Number(e.target.value) }))
            }
          />
          <label>completed</label>
          <select
            value={getParams.completed}
            onChange={(e) =>
              setGetParams((p) => ({
                ...p,
                completed: e.target.value as GetParams["completed"],
              }))
            }
          >
            <option value="">(unset)</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <label>year</label>
          <input
            type="number"
            placeholder="(unset)"
            value={getParams.year ?? ""}
            onChange={(e) =>
              setGetParams((p) => ({
                ...p,
                year: e.target.value === "" ? "" : Number(e.target.value),
              }))
            }
          />
          <label>category</label>
          <select
            value={getParams.category}
            onChange={(e) =>
              setGetParams((p) => ({
                ...p,
                category: e.target.value as GetParams["category"],
              }))
            }
          >
            <option value="">(unset)</option>
            <option value="MANDATORY">MANDATORY</option>
            <option value="JOB">JOB</option>
            <option value="ETC">ETC</option>
          </select>
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            onClick={handleGet}
            disabled={loadingGet}
            style={{ padding: "6px 12px" }}
          >
            {loadingGet ? "요청 중..." : "호출"}
          </button>
        </div>
        <pre
          style={{
            background: "#111",
            color: "#0f0",
            padding: 12,
            marginTop: 12,
            overflowX: "auto",
          }}
        >
          {getResult}
        </pre>
      </section>

      <section>
        <h3 style={{ marginBottom: 8 }}>POST /edu</h3>
        <div>
          <textarea
            value={postBody}
            onChange={(e) => setPostBody(e.target.value)}
            style={{
              width: "100%",
              maxWidth: 800,
              height: 220,
              fontFamily: "monospace",
            }}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            onClick={handlePost}
            disabled={loadingPost}
            style={{ padding: "6px 12px" }}
          >
            {loadingPost ? "요청 중..." : "생성"}
          </button>
        </div>
        <pre
          style={{
            background: "#111",
            color: "#0f0",
            padding: 12,
            marginTop: 12,
            overflowX: "auto",
          }}
        >
          {postResult}
        </pre>
      </section>
    </div>
  );
}
