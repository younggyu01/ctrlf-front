// src/components/chatbot/CreatorScriptSceneEditor.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CreatorScriptChapter,
  CreatorScriptDetail,
  CreatorScriptScene,
  CreatorScriptScenePatchErrors,
} from "./creatorStudioTypes";
import { fetchJson, HttpError } from "../common/api/authHttp";

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

type ToastKind = "success" | "error" | "info";

type Props = {
  /** education-service scriptId */
  scriptId: string;

  /** (현재 스펙상 불필요) 기존 props 호환을 위해 유지 */
  videoId?: string | null;

  /** 상위에서 쓰는 스크립트 텍스트(초기 표시/백업용). API 성공 시 서버 값이 우선 */
  scriptText?: string;

  disabled?: boolean;

  showToast: (kind: ToastKind, message: string, ms?: number) => void;

  /** 저장 성공 후 “평문 스크립트”를 상위에도 반영 */
  onCommitScriptText?: (nextScriptText: string) => void;

  /** 상위에서 검토요청 버튼 가드 등에 쓰고 싶으면 연결 */
  onDirtyChange?: (dirty: boolean) => void;
};

type SceneDraft = Pick<CreatorScriptScene, "narration" | "caption" | "durationSec">;

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asRecord(v: unknown): AnyRecord | null {
  return isRecord(v) ? v : null;
}

function toNum(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function readFirstStr(obj: AnyRecord | null, keys: string[], fallback = ""): string {
  if (!obj) return fallback;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return fallback;
}

function readFirstNum(obj: AnyRecord | null, keys: string[], fallback = 0): number {
  if (!obj) return fallback;
  for (const k of keys) {
    const v = obj[k];
    const n = toNum(v, Number.NaN);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function unwrapDto(raw: unknown): AnyRecord | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  // 서버 구현 편차 흡수: {data:{...}} / {result:{...}} / {...}
  const inner = asRecord(obj.data) ?? asRecord(obj.result);
  if (inner) return { ...obj, ...inner };
  return obj;
}

function normalizeScriptDetail(raw: unknown): CreatorScriptDetail {
  const dto = unwrapDto(raw);
  if (!dto) {
    throw new Error("스크립트 응답 형식이 올바르지 않습니다.");
  }

  const scriptId = readFirstStr(dto, ["scriptId", "script_id", "id"], "");
  const title = readFirstStr(dto, ["title"], "");
  const totalDurationSec = readFirstNum(dto, ["totalDurationSec", "total_duration_sec"], 0);

  const educationId = readFirstStr(dto, ["educationId", "education_id"], "");
  const videoId = readFirstStr(dto, ["videoId", "video_id"], "");

  const version =
    typeof dto.version === "number" && Number.isFinite(dto.version) ? dto.version : undefined;

  const llmModel = readFirstStr(dto, ["llmModel", "llm_model"], "");
  const rawPayload = (dto.rawPayload ?? dto.raw_payload ?? dto.script ?? undefined) as unknown;

  const chaptersRaw = dto.chapters;
  const chaptersArr = Array.isArray(chaptersRaw) ? chaptersRaw : [];

  const chapters: CreatorScriptChapter[] = chaptersArr.map((c, idx) => {
    const ch = asRecord(c);

    const chapterId =
      readFirstStr(ch, ["chapterId", "chapter_id", "id"], "") || `chapter-${idx + 1}`;
    const index = readFirstNum(ch, ["index", "chapterIndex", "chapter_order", "order"], idx + 1);
    const chTitle =
      readFirstStr(ch, ["title", "chapterTitle", "chapter_title"], "") || `챕터 ${index}`;
    const durationSec = readFirstNum(ch, ["durationSec", "duration_sec"], 0);

    const scenesRaw = ch ? (ch.scenes ?? ch.items) : undefined;
    const scenesArr = Array.isArray(scenesRaw) ? scenesRaw : [];

    const scenes: CreatorScriptScene[] = scenesArr.map((s, sIdx) => {
      const sc = asRecord(s);

      const sceneId =
        readFirstStr(sc, ["sceneId", "scene_id", "id"], "") || `scene-${idx + 1}-${sIdx + 1}`;
      const sIndex = readFirstNum(sc, ["index", "sceneIndex", "scene_order", "order"], sIdx + 1);

      const purpose = readFirstStr(sc, ["purpose"], "");
      const narration = readFirstStr(sc, ["narration"], "");
      const caption = readFirstStr(sc, ["caption"], "");
      const visual = readFirstStr(sc, ["visual"], "");

      const sDurationSec = readFirstNum(sc, ["durationSec", "duration_sec"], 0);

      const sourceChunkIndexesRaw =
        sc?.sourceChunkIndexes ?? sc?.source_chunk_indexes ?? sc?.sourceChunkIndex ?? sc?.source_refs;
      const sourceChunkIndexes = Array.isArray(sourceChunkIndexesRaw)
        ? sourceChunkIndexesRaw
            .map((x) => toNum(x, Number.NaN))
            .filter((n) => Number.isFinite(n))
        : [];

      const confidenceScoreRaw = sc?.confidenceScore ?? sc?.confidence_score;
      const confidenceScore =
        typeof confidenceScoreRaw === "number" && Number.isFinite(confidenceScoreRaw)
          ? confidenceScoreRaw
          : confidenceScoreRaw == null
            ? null
            : undefined;

      return {
        sceneId,
        index: sIndex,
        purpose,
        narration,
        caption,
        visual: visual || undefined,
        durationSec: sDurationSec,
        sourceChunkIndexes,
        confidenceScore,

        // derived
        chapterId,
        chapterTitle: chTitle,
        chapterIndex: index,
      };
    });

    return {
      chapterId,
      index,
      title: chTitle,
      durationSec,
      scenes,
    };
  });

  return {
    scriptId: scriptId || "(unknown)",
    educationId: educationId || null,
    videoId: videoId || null,
    title: title || "(untitled)",
    totalDurationSec,
    version,
    llmModel: llmModel || undefined,
    rawPayload,
    chapters,
  };
}

function flattenScenes(chapters: CreatorScriptChapter[]): CreatorScriptScene[] {
  const out: CreatorScriptScene[] = [];
  for (const ch of chapters) {
    for (const s of ch.scenes) out.push(s);
  }
  out.sort((a, b) => {
    const ca = a.chapterIndex ?? 0;
    const cb = b.chapterIndex ?? 0;
    if (ca !== cb) return ca - cb;
    return a.index - b.index;
  });
  return out;
}

function recalcDurations(chapters: CreatorScriptChapter[]): {
  chapters: CreatorScriptChapter[];
  totalDurationSec: number;
} {
  const nextChapters = chapters.map((ch) => {
    const sum = ch.scenes.reduce((acc, s) => acc + (Number.isFinite(s.durationSec) ? s.durationSec : 0), 0);
    return { ...ch, durationSec: sum };
  });
  const totalDurationSec = nextChapters.reduce((acc, ch) => acc + (Number.isFinite(ch.durationSec) ? ch.durationSec : 0), 0);
  return { chapters: nextChapters, totalDurationSec };
}

function composeScriptText(chapters: CreatorScriptChapter[]): string {
  const lines: string[] = [];
  const sortedCh = chapters.slice().sort((a, b) => a.index - b.index);

  for (const ch of sortedCh) {
    lines.push(`## ${ch.title} (${ch.durationSec}s)`);
    const sortedScenes = ch.scenes.slice().sort((a, b) => a.index - b.index);

    for (const s of sortedScenes) {
      lines.push(`- Scene ${s.index}${s.purpose ? ` · ${s.purpose}` : ""} · ${s.durationSec}s`);
      if (s.narration.trim()) lines.push(`  Narration: ${s.narration.trim()}`);
      if (s.caption.trim()) lines.push(`  Caption: ${s.caption.trim()}`);
      if ((s.visual ?? "").trim()) lines.push(`  Visual: ${(s.visual ?? "").trim()}`);
      lines.push("");
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function normalizeRawPayloadForUpdate(rawPayload: unknown): unknown {
  // 스펙상 PUT body.script는 "rawPayload JSON string"이지만,
  // 서버 구현 편차를 고려해 object/string 둘 다 안전하게 보냄.
  if (rawPayload == null) return undefined;
  if (typeof rawPayload === "string") return rawPayload;
  if (isRecord(rawPayload) || Array.isArray(rawPayload)) {
    try {
      return JSON.stringify(rawPayload);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * PUT /scripts/{scriptId} 요청 바디 생성 (스펙: chapters 전체 교체)
 * - chapterId/sceneId는 스펙에 없으므로 전송하지 않음(엄격 검증 대비)
 */
function buildPutBody(detail: CreatorScriptDetail): unknown {
  const safeScript = normalizeRawPayloadForUpdate(detail.rawPayload);

  const chapters = detail.chapters
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((ch) => ({
      index: ch.index,
      title: ch.title,
      durationSec: ch.durationSec,
      scenes: ch.scenes
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((s) => ({
          index: s.index,
          purpose: s.purpose,
          narration: s.narration,
          caption: s.caption,
          visual: s.visual ?? "",
          durationSec: s.durationSec,
          sourceChunkIndexes: s.sourceChunkIndexes ?? [],
          confidenceScore: s.confidenceScore ?? null,
        })),
    }));

  // 스펙에서 script는 optional → 값이 있으면 포함
  return safeScript !== undefined ? { script: safeScript, chapters } : { chapters };
}

function extractFieldErrors(payload: unknown): CreatorScriptScenePatchErrors {
  const errors: CreatorScriptScenePatchErrors = {};
  const obj = asRecord(payload);
  if (!obj) return errors;

  // 1) { errors: { narration: "...", ... } }
  const e = asRecord(obj.errors);
  if (e) {
    if (typeof e.narration === "string") errors.narration = e.narration;
    if (typeof e.caption === "string") errors.caption = e.caption;
    if (typeof e.durationSec === "string") errors.durationSec = e.durationSec;
    if (typeof (e as AnyRecord)["duration_sec"] === "string")
      errors.durationSec = String((e as AnyRecord)["duration_sec"]);
    return errors;
  }

  // 2) FastAPI 스타일 { detail: [ { loc: ["body","narration"], msg: "..." }, ... ] }
  const detail = obj.detail;
  if (Array.isArray(detail)) {
    for (const d of detail) {
      const row = asRecord(d);
      if (!row) continue;

      const loc = Array.isArray(row.loc) ? row.loc.map(String) : [];
      const msg =
        typeof row.msg === "string"
          ? row.msg
          : typeof row.message === "string"
            ? row.message
            : "";

      const field = loc[loc.length - 1];
      if (!msg) continue;

      if (field === "narration") errors.narration = msg;
      if (field === "caption") errors.caption = msg;
      if (field === "durationSec" || field === "duration_sec") errors.durationSec = msg;
    }
    return errors;
  }

  // 3) Spring Validation 메시지(구현 편차): message / error / errors[]
  if (typeof obj.message === "string" && obj.message.trim()) {
    // 필드 매핑이 불가하면 공통 에러로만 사용 (필드 에러는 비움)
    return errors;
  }

  return errors;
}

type EnvLike = Record<string, string | undefined>;
const ENV = import.meta.env as unknown as EnvLike;
const EDU_BASE = String(ENV.VITE_EDU_API_BASE ?? "/api-edu").replace(/\/$/, "");
const SCRIPT_DETAIL_ENDPOINT = (scriptId: string) => {
  const sid = scriptId?.trim() ?? "";
  if (!sid || sid.length === 0) {
    throw new Error("SCRIPT_DETAIL_ENDPOINT: scriptId가 필요합니다.");
  }
  return `${EDU_BASE}/scripts/${encodeURIComponent(sid)}`;
};

export default function CreatorScriptSceneEditor({
  scriptId,
  videoId, // 호환용(현재 스펙에서 불필요)
  scriptText,
  disabled,
  showToast,
  onCommitScriptText,
  onDirtyChange,
}: Props) {
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const scriptTextRef = useRef<string | undefined>(scriptText);
  useEffect(() => {
    scriptTextRef.current = scriptText;
  }, [scriptText]);

  const [loading, setLoading] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  const [script, setScript] = useState<CreatorScriptDetail | null>(null);
  
  // 현재 실행 중인 loadScript 요청을 추적하기 위한 ref
  const loadScriptAbortControllerRef = useRef<AbortController | null>(null);
  // 현재 로드 중인 scriptId를 추적 (React Strict Mode 이중 실행 방지)
  const loadingScriptIdRef = useRef<string | null>(null);

  const scenes = useMemo(() => flattenScenes(script?.chapters ?? []), [script]);

  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  const selectedScene = useMemo(() => {
    return scenes.find((s) => s.sceneId === selectedSceneId) ?? null;
  }, [scenes, selectedSceneId]);

  const [draftById, setDraftById] = useState<Record<string, SceneDraft>>({});
  const [dirtyIds, setDirtyIds] = useState<Record<string, true>>({});
  const [fieldErrorsById, setFieldErrorsById] = useState<
    Record<string, CreatorScriptScenePatchErrors | undefined>
  >({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    onDirtyChange?.(Object.keys(dirtyIds).length > 0);
  }, [dirtyIds, onDirtyChange]);

  const selectedDraft: SceneDraft | null = useMemo(() => {
    if (!selectedScene) return null;
    return (
      draftById[selectedScene.sceneId] ?? {
        narration: selectedScene.narration ?? "",
        caption: selectedScene.caption ?? "",
        durationSec: selectedScene.durationSec ?? 0,
      }
    );
  }, [draftById, selectedScene]);

  const [collapsedChapterIds, setCollapsedChapterIds] = useState<Record<string, true>>({});

  const chaptersForUI = useMemo(() => {
    const list = (script?.chapters ?? []).slice().sort((a, b) => a.index - b.index);
    return list;
  }, [script]);

  const toggleChapter = (chapterId: string) => {
    setCollapsedChapterIds((prev) => {
      const next = { ...prev };
      if (next[chapterId]) delete next[chapterId];
      else next[chapterId] = true;
      return next;
    });
  };

  const hardDisabled = Boolean(disabled || saving || loading);

  const loadScript = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadingError(null);

      try {
        const endpoint = SCRIPT_DETAIL_ENDPOINT(scriptId);
        const raw = await fetchJson<unknown>(endpoint, {
          method: "GET",
          signal,
        });

        const detail = normalizeScriptDetail(raw);

        // 서버 스크립트가 비어있거나 실패해도, 상위에서 내려준 scriptText는 "표시용"으로만 유지 가능
        // (여기서는 API 데이터 우선)
        setScript(detail);

        setSelectedSceneId((prev) => {
          if (prev && flattenScenes(detail.chapters).some((s) => s.sceneId === prev)) return prev;
          const first = flattenScenes(detail.chapters)[0];
          return first?.sceneId ?? null;
        });

        setDraftById({});
        setDirtyIds({});
        setFieldErrorsById({});
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status === 403) {
            showToastRef.current("error", "권한이 없습니다. (403)", 3500);
            setLoadingError("권한이 없어 스크립트를 불러올 수 없습니다.");
          } else if (e.status === 404) {
            showToastRef.current("error", "스크립트를 찾을 수 없습니다. (404)", 3500);
            setLoadingError("대상(scriptId)을 찾을 수 없습니다.");
          } else {
            showToastRef.current("error", `스크립트 조회 실패 (${e.status})`, 3500);
            setLoadingError(`스크립트 조회 실패 (${e.status})`);
          }
        } else if (e instanceof Error && e.name === "AbortError") {
          // ignore
        } else {
          showToastRef.current("error", "스크립트 조회 중 예외가 발생했습니다.", 3500);
          setLoadingError("스크립트 조회 중 예외가 발생했습니다.");
        }
      } finally {
        setLoading(false);
      }
    },
    [scriptId]
  );

  useEffect(() => {
    if (!scriptId || scriptId.trim().length === 0) {
      // 이전 요청 취소
      if (loadScriptAbortControllerRef.current) {
        loadScriptAbortControllerRef.current.abort();
        loadScriptAbortControllerRef.current = null;
      }
      loadingScriptIdRef.current = null;
      setLoading(false);
      setLoadingError("scriptId가 없습니다.");
      setScript(null);
      setSelectedSceneId(null);
      return;
    }
    
    // 이미 같은 scriptId를 로드 중이면 중복 요청 방지
    if (loadingScriptIdRef.current === scriptId && loadScriptAbortControllerRef.current) {
      return;
    }
    
    // 이전 요청이 있으면 취소
    if (loadScriptAbortControllerRef.current) {
      loadScriptAbortControllerRef.current.abort();
    }
    
    // 새로운 AbortController 생성
    const ctrl = new AbortController();
    loadScriptAbortControllerRef.current = ctrl;
    loadingScriptIdRef.current = scriptId;
    
    // loadScript 실행
    const currentScriptId = scriptId; // 클로저로 scriptId 캡처
    void loadScript(ctrl.signal)
      .then(() => {
        // 요청이 성공적으로 완료되면 ref 정리 (같은 scriptId에 대한 요청인 경우에만)
        if (loadScriptAbortControllerRef.current === ctrl && loadingScriptIdRef.current === currentScriptId) {
          loadScriptAbortControllerRef.current = null;
          loadingScriptIdRef.current = null;
        }
      })
      .catch((err) => {
        // AbortError는 정상적인 취소이므로 무시
        if (err instanceof Error && err.name === "AbortError") {
          // cleanup에서 취소된 경우이므로 ref는 cleanup에서 정리됨
          return;
        }
        // 다른 에러인 경우 ref 정리
        if (loadScriptAbortControllerRef.current === ctrl && loadingScriptIdRef.current === currentScriptId) {
          loadScriptAbortControllerRef.current = null;
          loadingScriptIdRef.current = null;
        }
      });
    
    return () => {
      // React Strict Mode 이중 실행 방지: cleanup을 약간 지연시켜 두 번째 실행이 완료될 시간을 줌
      // 같은 scriptId에 대한 요청은 취소하지 않음
      const timeoutId = setTimeout(() => {
        const currentScriptIdInRef = loadingScriptIdRef.current;
        
        // scriptId가 변경되지 않았는데 cleanup이 호출되는 경우는 React Strict Mode 이중 실행
        // 이 경우 cleanup하지 않고 두 번째 실행이 완료되도록 함
        if (loadScriptAbortControllerRef.current === ctrl && currentScriptIdInRef === currentScriptId) {
          // cleanup하지 않음 - 두 번째 실행이 완료되도록 함
          clearTimeout(timeoutId);
          return;
        }
        
        // scriptId가 실제로 변경되었거나 컴포넌트가 unmount된 경우에만 취소
        if (loadScriptAbortControllerRef.current === ctrl) {
          ctrl.abort();
          if (loadingScriptIdRef.current === currentScriptId) {
            loadScriptAbortControllerRef.current = null;
            loadingScriptIdRef.current = null;
          }
        }
        clearTimeout(timeoutId);
      }, 50); // 50ms 지연으로 React Strict Mode 이중 실행 완화
    };
  }, [loadScript, scriptId]);

  // script가 업데이트되면 selectedSceneId를 유효한 씬으로 업데이트
  useEffect(() => {
    if (!script) return;
    const currentScenes = flattenScenes(script.chapters);
    setSelectedSceneId((prev) => {
      // 현재 선택된 씬이 여전히 유효하면 유지
      if (prev && currentScenes.some((s) => s.sceneId === prev)) {
        return prev;
      }
      // 현재 선택된 씬이 없거나 유효하지 않으면 첫 번째 씬 선택
      const first = currentScenes[0];
      return first?.sceneId ?? null;
    });
  }, [script]);

  const markDirty = (sceneId: string) => {
    setDirtyIds((prev) => (prev[sceneId] ? prev : { ...prev, [sceneId]: true }));
  };

  const updateDraft = (sceneId: string, patch: Partial<SceneDraft>) => {
    const baseScene = scenes.find((s) => s.sceneId === sceneId);

    setDraftById((prev) => {
      const base = prev[sceneId];
      const next: SceneDraft = {
        narration: base?.narration ?? baseScene?.narration ?? "",
        caption: base?.caption ?? baseScene?.caption ?? "",
        durationSec: base?.durationSec ?? baseScene?.durationSec ?? 0,
        ...patch,
      };
      return { ...prev, [sceneId]: next };
    });

    markDirty(sceneId);
    setFieldErrorsById((prev) => ({ ...prev, [sceneId]: undefined }));
  };

  const canSaveSelected =
    !disabled && // disabled prop 체크 추가
    !hardDisabled &&
    selectedScene != null &&
    Boolean(dirtyIds[selectedScene.sceneId]) &&
    selectedDraft != null &&
    script != null;

  const saveSelectedScene = async () => {
    if (disabled) return; // disabled일 때는 저장 불가
    if (!script || !selectedScene || !selectedDraft) return;
    if (!dirtyIds[selectedScene.sceneId]) return;

    const dur = Number(selectedDraft.durationSec);
    if (!Number.isFinite(dur) || dur <= 0) {
      setFieldErrorsById((prev) => ({
        ...prev,
        [selectedScene.sceneId]: {
          ...(prev[selectedScene.sceneId] ?? {}),
          durationSec: "1 이상의 숫자를 입력해 주세요.",
        },
      }));
      return;
    }

    setSaving(true);

    try {
      // 1) 로컬에서 chapters 전체에 반영
      const patchedChapters = script.chapters.map((ch) => {
        const nextScenes = ch.scenes.map((s) => {
          if (s.sceneId !== selectedScene.sceneId) return s;
          return {
            ...s,
            narration: selectedDraft.narration,
            caption: selectedDraft.caption,
            durationSec: dur,
          };
        });
        return { ...ch, scenes: nextScenes };
      });

      const { chapters: recalcedChapters, totalDurationSec } = recalcDurations(patchedChapters);

      const nextDetail: CreatorScriptDetail = {
        ...script,
        chapters: recalcedChapters,
        totalDurationSec,
      };

      // 2) PUT /scripts/{scriptId} (전체 교체)
      const putBody = buildPutBody(nextDetail);

      const raw = await fetchJson<unknown>(SCRIPT_DETAIL_ENDPOINT(scriptId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(putBody),
      });

      // 3) 응답이 스크립트 형태면 반영, 아니면 로컬 상태로 반영
      let updated: CreatorScriptDetail | null = null;
      try {
        updated = normalizeScriptDetail(raw);
        // 서버 응답에 chapters가 없거나 비어있으면 로컬 상태 사용
        if (!updated.chapters || updated.chapters.length === 0) {
          updated = null;
        }
      } catch {
        updated = null;
      }

      const finalDetail = updated ?? nextDetail;

      // script 상태를 업데이트 (이것이 scenes useMemo를 트리거하고, useEffect에서 selectedSceneId도 자동 업데이트됨)
      // finalDetail.chapters가 비어있지 않은지 확인 (로컬 상태를 사용하므로 항상 있어야 함)
      if (!finalDetail.chapters || finalDetail.chapters.length === 0) {
        showToastRef.current("error", "저장된 스크립트에 챕터가 없습니다.", 3500);
        setSaving(false);
        return;
      }

      // finalDetail이 유효한지 확인 (scriptId가 있어야 함)
      if (!finalDetail.scriptId || finalDetail.scriptId.trim().length === 0) {
        showToastRef.current("error", "저장된 스크립트에 scriptId가 없습니다.", 3500);
        setSaving(false);
        return;
      }

      // script 상태를 업데이트 (React의 배치 업데이트를 고려하여 즉시 업데이트)
      setScript(finalDetail);
      
      // draftById도 업데이트된 씬 정보로 갱신
      if (selectedScene?.sceneId && selectedDraft) {
        setDraftById((prev) => {
          const updated = { ...prev };
          updated[selectedScene.sceneId] = {
            narration: selectedDraft.narration,
            caption: selectedDraft.caption,
            durationSec: selectedDraft.durationSec,
          };
          return updated;
        });
      }

      setDirtyIds((prev) => {
        const next = { ...prev };
        delete next[selectedScene.sceneId];
        return next;
      });
      setFieldErrorsById((prev) => ({ ...prev, [selectedScene.sceneId]: undefined }));

      showToastRef.current("success", "씬이 저장되었습니다.", 1800);

      onCommitScriptText?.(composeScriptText(finalDetail.chapters));
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 403) {
          showToastRef.current("error", "권한이 없습니다. (403) - 현재 계정 권한을 확인하세요.", 4200);
        } else if (e.status === 409) {
          showToastRef.current(
            "error",
            "다른 사용자가 먼저 수정했어요. 새로고침 후 다시 시도해주세요. (409)",
            4500
          );
          await loadScript(undefined);
        } else if (e.status === 404) {
          showToastRef.current("error", "대상을 찾을 수 없습니다. (404)", 3500);
        } else if (e.status === 400 || e.status === 422) {
          const errs = extractFieldErrors(e.body);
          setFieldErrorsById((prev) => ({ ...prev, [selectedScene.sceneId]: errs }));
          showToastRef.current("error", "입력값 오류가 있습니다. 필드를 확인해 주세요.", 3500);
        } else {
          showToastRef.current("error", `씬 저장 실패 (${e.status})`, 3500);
        }
      } else {
        showToastRef.current("error", "씬 저장 중 오류가 발생했습니다.", 3500);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cx("cb-creator-scene-editor", hardDisabled && "is-disabled")}
      onMouseDown={(e) => e.stopPropagation()}
      data-videoid={videoId ?? ""} // 호환용 (현재는 사용하지 않음)
    >
      <div className="cb-creator-scene-list">
        <div className="cb-creator-scene-list-head">
          <span>씬 목록</span>
          <button
            type="button"
            className="cb-creator-scene-reload"
            onClick={() => void loadScript(undefined)}
            disabled={loading || disabled}
          >
            새로고침
          </button>
        </div>

        {loadingError && (
          <div className="cb-creator-scene-error">
            {loadingError}
            <div className="cb-creator-scene-error-sub">
              문제가 지속되면 권한/대상(scriptId) 및 백엔드 Script API 연결을 확인하세요.
            </div>
          </div>
        )}

        {loading && <div className="cb-creator-scene-muted">불러오는 중…</div>}

        {!loading && !script && (
          <div className="cb-creator-scene-muted">
            표시할 데이터가 없습니다. (scriptId 확인 필요)
          </div>
        )}

        {!loading && script && chaptersForUI.length === 0 && (
          <div className="cb-creator-scene-muted">
            표시할 챕터/씬이 없습니다. (스크립트 생성 후 다시 시도)
            {scriptTextRef.current ? (
              <div className="cb-creator-scene-error-sub" style={{ marginTop: 8 }}>
                참고: 상위에서 내려준 scriptText는 존재하지만, 서버 chapters가 비어있습니다.
              </div>
            ) : null}
          </div>
        )}

        {!loading &&
          script &&
          chaptersForUI.map((ch) => {
            const collapsed = Boolean(collapsedChapterIds[ch.chapterId]);
            return (
              <div key={ch.chapterId} className="cb-creator-chapter">
                <button
                  type="button"
                  className="cb-creator-chapter-head"
                  onClick={() => toggleChapter(ch.chapterId)}
                >
                  <span className="cb-creator-chapter-title">{ch.title}</span>
                  <span className="cb-creator-chapter-meta">
                    {ch.scenes.length}개
                    <span className={cx("cb-creator-chevron", collapsed && "is-collapsed")}>
                      ▾
                    </span>
                  </span>
                </button>

                {!collapsed && (
                  <div className="cb-creator-chapter-body">
                    {ch.scenes
                      .slice()
                      .sort((a, b) => a.index - b.index)
                      .map((s) => {
                        const isSelected = s.sceneId === selectedSceneId;
                        const isDirty = Boolean(dirtyIds[s.sceneId]);
                        return (
                          <button
                            key={s.sceneId}
                            type="button"
                            className={cx("cb-creator-scene-row", isSelected && "is-selected")}
                            onClick={() => setSelectedSceneId(s.sceneId)}
                          >
                            <span className="cb-creator-scene-order">{s.index}</span>
                            <span className="cb-creator-scene-purpose">
                              {s.purpose || "(목적 없음)"}
                            </span>
                            <span className="cb-creator-scene-duration">{s.durationSec}s</span>
                            {isDirty && <span className="cb-creator-scene-dirty">수정됨</span>}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      <div className="cb-creator-scene-edit">
        <div className="cb-creator-scene-edit-head">
          <div className="cb-creator-scene-edit-title">
            {selectedScene ? `Scene ${selectedScene.index}` : "씬 선택"}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="cb-admin-primary-btn cb-creator-scene-save"
              disabled={!canSaveSelected || disabled}
              onClick={() => void saveSelectedScene()}
            >
              {saving ? "저장 중…" : "저장(씬)"}
            </button>
          </div>
        </div>

        {!selectedScene && (
          <div className="cb-creator-scene-muted">왼쪽 목록에서 씬을 선택하세요.</div>
        )}

        {selectedScene && selectedDraft && script && (
          <>
            <div className="cb-creator-scene-readonly">
              <div className="cb-creator-scene-ro-row">
                <span className="cb-creator-scene-ro-label">chapter</span>
                <span className="cb-creator-scene-ro-value">
                  {selectedScene.chapterTitle ?? "-"}
                </span>
              </div>
              <div className="cb-creator-scene-ro-row">
                <span className="cb-creator-scene-ro-label">purpose</span>
                <span className="cb-creator-scene-ro-value">{selectedScene.purpose || "-"}</span>
              </div>
              <div className="cb-creator-scene-ro-row">
                <span className="cb-creator-scene-ro-label">sourceChunkIndexes</span>
                <span className="cb-creator-scene-ro-value">
                  {(selectedScene.sourceChunkIndexes?.length ?? 0)}개
                </span>
              </div>
              <div className="cb-creator-scene-ro-row">
                <span className="cb-creator-scene-ro-label">confidenceScore</span>
                <span className="cb-creator-scene-ro-value">
                  {selectedScene.confidenceScore == null ? "-" : String(selectedScene.confidenceScore)}
                </span>
              </div>
              <div className="cb-creator-scene-ro-row">
                <span className="cb-creator-scene-ro-label">script</span>
                <span className="cb-creator-scene-ro-value">
                  {script.title} · {script.totalDurationSec}s · v{script.version ?? "?"}
                </span>
              </div>
            </div>

            <label className="cb-creator-scene-field">
              <div className="cb-creator-scene-field-label">narration</div>
              <textarea
                className={cx(
                  "cb-reviewer-textarea",
                  "cb-creator-scene-field-textarea",
                  fieldErrorsById[selectedScene.sceneId]?.narration && "is-invalid"
                )}
                value={selectedDraft.narration}
                disabled={hardDisabled}
                onChange={(e) => updateDraft(selectedScene.sceneId, { narration: e.target.value })}
              />
              {fieldErrorsById[selectedScene.sceneId]?.narration && (
                <div className="cb-creator-scene-field-error">
                  {fieldErrorsById[selectedScene.sceneId]?.narration}
                </div>
              )}
            </label>

            <label className="cb-creator-scene-field">
              <div className="cb-creator-scene-field-label">caption</div>
              <textarea
                className={cx(
                  "cb-reviewer-textarea",
                  "cb-creator-scene-field-textarea",
                  fieldErrorsById[selectedScene.sceneId]?.caption && "is-invalid"
                )}
                value={selectedDraft.caption}
                disabled={hardDisabled}
                onChange={(e) => updateDraft(selectedScene.sceneId, { caption: e.target.value })}
              />
              {fieldErrorsById[selectedScene.sceneId]?.caption && (
                <div className="cb-creator-scene-field-error">
                  {fieldErrorsById[selectedScene.sceneId]?.caption}
                </div>
              )}
            </label>

            <label className="cb-creator-scene-field">
              <div className="cb-creator-scene-field-label">durationSec</div>
              <input
                className={cx(
                  "cb-admin-input",
                  "cb-creator-scene-field-number",
                  fieldErrorsById[selectedScene.sceneId]?.durationSec && "is-invalid"
                )}
                type="number"
                min={1}
                step={1}
                value={selectedDraft.durationSec}
                disabled={hardDisabled}
                onChange={(e) =>
                  updateDraft(selectedScene.sceneId, { durationSec: Number(e.target.value) })
                }
              />
              {fieldErrorsById[selectedScene.sceneId]?.durationSec && (
                <div className="cb-creator-scene-field-error">
                  {fieldErrorsById[selectedScene.sceneId]?.durationSec}
                </div>
              )}
            </label>
          </>
        )}
      </div>
    </div>
  );
}
