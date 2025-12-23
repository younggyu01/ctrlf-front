// src/components/chatbot/ProjectFilesModal.tsx
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./chatbot.css";

export type ProjectFileItem = {
  id: string;
  name: string;
  sizeBytes?: number;
  meta?: string; // 예: "기본"
};

type PendingStatus = "uploading" | "done" | "error";

type PendingRow = {
  tempId: string;
  key: string; // name|size 기반 매칭키
  name: string;
  sizeBytes: number;
  file?: File; // 재시도용
  status: PendingStatus;
  createdAt: number;
  linkedId?: string; // 실제 files에 반영된 뒤 매칭된 id
  errorMessage?: string;
};

const MIN_SPIN_MS = 3000; // 스피너 최소 노출 시간
const DONE_HOLD_MS = 3000; // pending(done) 상태를 잠깐 보여주고 실제 파일 행으로 전환

// 프론트 정책(백엔드 제한에 맞게 조정)
// 예: 20MB = 20 * 1024 * 1024
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

function formatBytes(bytes?: number) {
  const n = typeof bytes === "number" ? bytes : 0;
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  const fixed = u === 0 ? `${Math.round(v)}` : `${v.toFixed(v >= 10 ? 1 : 2)}`;
  return `${fixed} ${units[u]}`;
}

function fileKey(name: string, sizeBytes?: number) {
  const s =
    typeof sizeBytes === "number" && Number.isFinite(sizeBytes) ? sizeBytes : 0;
  return `${name}__${s}`;
}

function getExt(name: string) {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i).toLowerCase(); // ".pdf"
}

type AcceptSpec = {
  exts: Set<string>; // ".pdf"
  mimes: Set<string>; // "application/pdf"
  wildcards: Set<string>; // "image/" for "image/*"
};

function parseAccept(accept?: string): AcceptSpec | null {
  if (!accept) return null;
  const tokens = accept
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  const spec: AcceptSpec = {
    exts: new Set<string>(),
    mimes: new Set<string>(),
    wildcards: new Set<string>(),
  };

  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower.startsWith(".")) {
      spec.exts.add(lower);
      continue;
    }
    if (lower.endsWith("/*")) {
      // image/* => image/
      spec.wildcards.add(lower.slice(0, lower.length - 1));
      continue;
    }
    if (lower.includes("/")) {
      spec.mimes.add(lower);
      continue;
    }
  }
  return spec;
}

function buildAllowedLabel(spec: AcceptSpec | null) {
  if (!spec) return "";
  const exts = Array.from(spec.exts);
  const mimes = Array.from(spec.mimes);
  const wild = Array.from(spec.wildcards).map((p) => `${p}*`);
  const all = [...exts, ...wild, ...mimes].filter(Boolean);
  if (all.length === 0) return "";
  // 너무 길어지면 UX가 깨져서, 확장자 우선 요약
  if (exts.length > 0) return exts.join(", ");
  return all.slice(0, 4).join(", ") + (all.length > 4 ? " …" : "");
}

function isAccepted(file: File, spec: AcceptSpec | null) {
  if (!spec) return true;

  const ext = getExt(file.name);
  const mime = (file.type || "").toLowerCase();

  // 확장자 우선
  if (ext && spec.exts.size > 0 && spec.exts.has(ext)) return true;

  // mime exact
  if (mime && spec.mimes.size > 0 && spec.mimes.has(mime)) return true;

  // mime wildcard (image/*)
  if (mime && spec.wildcards.size > 0) {
    for (const p of spec.wildcards) {
      if (mime.startsWith(p)) return true;
    }
  }

  // accept가 존재하는데 어떤 조건도 만족 못하면 불허
  return false;
}

type ValidationResult = { ok: true } | { ok: false; message: string };

function validateFile(file: File, accept?: string): ValidationResult {
  // 용량 제한
  if (Number.isFinite(file.size) && file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      message: `용량 제한(${formatBytes(MAX_FILE_SIZE_BYTES)}) 초과: ${formatBytes(
        file.size
      )}`,
    };
  }

  // accept 제한
  const spec = parseAccept(accept);
  if (spec && !isAccepted(file, spec)) {
    const ext = getExt(file.name);
    const allowed = buildAllowedLabel(spec);
    const got = ext || (file.type ? file.type : "알 수 없음");
    const allowedText = allowed ? ` (허용: ${allowed})` : "";
    return {
      ok: false,
      message: `허용되지 않는 형식: ${got}${allowedText}`,
    };
  }

  return { ok: true };
}

export default function ProjectFilesModal(props: {
  open: boolean;
  title?: string; // default: "문서 업로드"
  description?: string;
  accept?: string;
  files: ProjectFileItem[];
  disabled?: boolean;
  onClose: () => void;
  onAddFiles: (files: File[]) => void | Promise<void>;
  onRemoveFile: (id: string) => void | Promise<void>;
}) {
  const {
    open,
    title = "문서 업로드",
    description = "문서를 추가하세요.",
    accept,
    files,
    disabled,
    onClose,
    onAddFiles,
    onRemoveFile,
  } = props;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const titleId = useId();
  const descId = useId();

  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastActiveElRef = useRef<HTMLElement | null>(null);

  // drag flicker 방지
  const dragCounterRef = useRef(0);

  // 모달 오픈 중 배경 스크롤 잠금
  const prevBodyOverflowRef = useRef<string>("");
  const prevHtmlOverflowRef = useRef<string>("");

  // 업로드/삭제 UI 상태
  const [pending, setPending] = useState<PendingRow[]>([]);
  const pendingRef = useRef<PendingRow[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  // 업로드 완료 표시(모달 닫을 때까지 유지)
  const [recentDoneIds, setRecentDoneIds] = useState<Set<string>>(new Set());

  const timersRef = useRef<Map<string, { done?: number; cleanup?: number }>>(
    new Map()
  );

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach((t) => {
      if (t.done) window.clearTimeout(t.done);
      if (t.cleanup) window.clearTimeout(t.cleanup);
    });
    timersRef.current.clear();
  }, []);

  const clearTimersFor = useCallback((tempId: string) => {
    const t = timersRef.current.get(tempId);
    if (t?.done) window.clearTimeout(t.done);
    if (t?.cleanup) window.clearTimeout(t.cleanup);
    timersRef.current.delete(tempId);
  }, []);

  // open/close 시 정리
  useEffect(() => {
    if (open) return;
    clearAllTimers();
    setPending([]);
    setDragging(false);
    dragCounterRef.current = 0;
    setRemovingIds(new Set());
    setRecentDoneIds(new Set());
  }, [open, clearAllTimers]);

  useEffect(() => {
    if (!open) return;

    prevBodyOverflowRef.current = document.body.style.overflow;
    prevHtmlOverflowRef.current = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevBodyOverflowRef.current;
      document.documentElement.style.overflow = prevHtmlOverflowRef.current;
    };
  }, [open]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // open 시 포커스 이동 + close 시 원래 포커스로 복원
  useEffect(() => {
    if (!open) return;

    lastActiveElRef.current = document.activeElement as HTMLElement | null;

    const t = window.setTimeout(() => {
      addBtnRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(t);
      lastActiveElRef.current?.focus?.();
    };
  }, [open]);

  // 모달 열린 상태에서 dropzone 밖 드롭 시 브라우저가 파일을 여는 것 방지
  useEffect(() => {
    if (!open) return;

    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);

    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, [open]);

  const sortedFiles = useMemo(() => {
    return Array.isArray(files) ? files : [];
  }, [files]);

  const filesById = useMemo(() => {
    const m = new Map<string, ProjectFileItem>();
    for (const f of sortedFiles) m.set(f.id, f);
    return m;
  }, [sortedFiles]);

  const dismissPending = useCallback(
    (tempId: string) => {
      clearTimersFor(tempId);
      setPending((prev) => prev.filter((p) => p.tempId !== tempId));
    },
    [clearTimersFor]
  );

  const isUploadingNow = useMemo(
    () => pending.some((p) => p.status === "uploading"),
    [pending]
  );

  // 업로드 중에는 “추가” UX 자체를 잠금
  const addLocked = disabled || isUploadingNow;

  const startUpload = useCallback(
    async (list: File[]) => {
      if (disabled) return;
      if (!list || list.length === 0) return;

      // 이중 방어: 업로드 중에는 추가 진입 자체를 막음
      if (pendingRef.current.some((p) => p.status === "uploading")) return;

      const now = Date.now();

      const rows: PendingRow[] = [];
      const validFiles: File[] = [];
      const validTempIds = new Set<string>();

      list.forEach((f, idx) => {
        const sizeBytes = typeof f.size === "number" ? f.size : 0;
        const tempId = `pending_${now}_${idx}_${Math.random()
          .toString(16)
          .slice(2)}`;

        const v = validateFile(f, accept);
        if (!v.ok) {
          rows.push({
            tempId,
            key: fileKey(f.name, sizeBytes),
            name: f.name,
            sizeBytes,
            file: f,
            status: "error",
            createdAt: now,
            errorMessage: v.message,
          });
          return;
        }

        rows.push({
          tempId,
          key: fileKey(f.name, sizeBytes),
          name: f.name,
          sizeBytes,
          file: f,
          status: "uploading",
          createdAt: now,
        });

        validFiles.push(f);
        validTempIds.add(tempId);
      });

      if (rows.length > 0) setPending((prev) => [...rows, ...prev]);

      // 전부 invalid면 API 호출 없음
      if (validFiles.length === 0) return;

      try {
        await Promise.resolve(onAddFiles(validFiles));
      } catch {
        // 업로드 호출 실패: 이번 배치의 uploading row를 error로 전환
        setPending((prev) =>
          prev.map((p) =>
            validTempIds.has(p.tempId)
              ? {
                  ...p,
                  status: "error",
                  errorMessage:
                    p.errorMessage ||
                    "업로드 실패(서버/네트워크). 잠시 후 재시도하세요.",
                }
              : p
          )
        );
      }
    },
    [accept, disabled, onAddFiles]
  );

  const retryOne = useCallback(
    async (row: PendingRow) => {
      if (disabled) return;
      if (pendingRef.current.some((p) => p.status === "uploading")) return;

      if (!row.file) {
        setPending((prev) =>
          prev.map((p) =>
            p.tempId === row.tempId
              ? {
                  ...p,
                  status: "error",
                  errorMessage: "재시도할 파일 정보를 찾을 수 없습니다.",
                }
              : p
          )
        );
        return;
      }

      // 재시도 전에 정책 검증을 다시 수행(형식/용량)
      const v = validateFile(row.file, accept);
      if (!v.ok) {
        setPending((prev) =>
          prev.map((p) =>
            p.tempId === row.tempId
              ? { ...p, status: "error", errorMessage: v.message }
              : p
          )
        );
        return;
      }

      clearTimersFor(row.tempId);

      setPending((prev) =>
        prev.map((p) =>
          p.tempId === row.tempId
            ? {
                ...p,
                status: "uploading",
                createdAt: Date.now(),
                linkedId: undefined,
                errorMessage: undefined,
              }
            : p
        )
      );

      try {
        await Promise.resolve(onAddFiles([row.file]));
      } catch {
        setPending((prev) =>
          prev.map((p) =>
            p.tempId === row.tempId
              ? {
                  ...p,
                  status: "error",
                  errorMessage:
                    "업로드 실패(서버/네트워크). 잠시 후 재시도하세요.",
                }
              : p
          )
        );
      }
    },
    [accept, disabled, onAddFiles, clearTimersFor]
  );

  const retryAllErrors = useCallback(async () => {
    if (disabled) return;
    if (pendingRef.current.some((p) => p.status === "uploading")) return;

    const errs = pending.filter((p) => p.status === "error");
    for (const row of errs) {
      // 순차 재시도(스토어 매칭 혼선 최소화)

      await retryOne(row);
    }
  }, [disabled, pending, retryOne]);

  const pick = () => {
    if (addLocked) return;
    inputRef.current?.click();
  };

  const handleInputChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const list = Array.from(e.target.files ?? []);
    if (list.length > 0) startUpload(list);
    e.target.value = "";
  };

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current = 0;
    setDragging(false);

    if (addLocked) return;

    const list = Array.from(e.dataTransfer.files ?? []);
    if (list.length > 0) startUpload(list);
  };

  // pending(uploading) ↔ 실제 files 매칭(linkedId)
  useEffect(() => {
    if (!open) return;
    if (pending.length === 0) return;

    setPending((prev) => {
      let changed = false;
      const used = new Set<string>();
      for (const p of prev) {
        if (p.linkedId) used.add(p.linkedId);
      }

      const next = prev.map((p) => {
        if (p.status !== "uploading" || p.linkedId) return p;

        const match = sortedFiles.find((f) => {
          if (used.has(f.id)) return false;
          return fileKey(f.name, f.sizeBytes) === p.key;
        });

        if (!match) return p;

        used.add(match.id);
        changed = true;
        return { ...p, linkedId: match.id };
      });

      return changed ? next : prev;
    });
  }, [open, pending.length, sortedFiles]);

  // pending 상태 전환 스케줄링 (uploading→done→cleanup)
  // error는 자동 제거하지 않음(재시도/삭제 버튼으로 제어)
  useEffect(() => {
    if (!open) return;
    if (pending.length === 0) return;

    for (const p of pending) {
      const existing = timersRef.current.get(p.tempId);

      if (p.status === "uploading" && p.linkedId) {
        if (existing?.done) continue;

        const elapsed = Date.now() - p.createdAt;
        const wait = Math.max(0, MIN_SPIN_MS - elapsed);

        const doneTimer = window.setTimeout(() => {
          if (p.linkedId) {
            setRecentDoneIds((prev) => {
              const n = new Set(prev);
              n.add(p.linkedId!);
              return n;
            });
          }

          setPending((prev) =>
            prev.map((x) =>
              x.tempId === p.tempId ? { ...x, status: "done" } : x
            )
          );

          const cleanupTimer = window.setTimeout(() => {
            dismissPending(p.tempId);
          }, DONE_HOLD_MS);

          timersRef.current.set(p.tempId, { cleanup: cleanupTimer });
        }, wait);

        timersRef.current.set(p.tempId, { done: doneTimer });
      }
    }
  }, [open, pending, dismissPending]);

  const hiddenIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of pending) {
      // pending row가 존재하는 동안만 실제 파일 행을 숨김
      if (p.linkedId && p.status !== "error") s.add(p.linkedId);
    }
    return s;
  }, [pending]);

  const visibleFiles = useMemo(() => {
    return sortedFiles.filter((f) => !hiddenIds.has(f.id));
  }, [sortedFiles, hiddenIds]);

  const removeActual = useCallback(
    async (id: string) => {
      if (disabled) return;

      setRemovingIds((prev) => {
        const n = new Set(prev);
        n.add(id);
        return n;
      });

      try {
        await Promise.resolve(onRemoveFile(id));
        setRecentDoneIds((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      } finally {
        setRemovingIds((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    },
    [disabled, onRemoveFile]
  );

  const renderStatusIcon = (status: PendingStatus) => {
    if (status === "uploading")
      return <span className="cb-files-status-spinner" aria-hidden="true" />;
    if (status === "done")
      return (
        <span className="cb-files-status-check" aria-hidden="true">
          ✓
        </span>
      );
    return (
      <span className="cb-files-status-error" aria-hidden="true">
        !
      </span>
    );
  };

  const statusBadgeLabel = (status: PendingStatus) => {
    if (status === "uploading") return "업로드 중";
    if (status === "done") return "완료";
    return "실패";
  };

  const uploadingCount = useMemo(
    () => pending.filter((p) => p.status === "uploading").length,
    [pending]
  );
  const errorCount = useMemo(
    () => pending.filter((p) => p.status === "error").length,
    [pending]
  );

  const body = open ? (
    <div
      className="cb-files-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cb-files-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cb-files-modal-header">
          <div className="cb-files-modal-title" id={titleId}>
            {title}
          </div>

          <div className="cb-files-modal-header-actions">
            <button
              ref={addBtnRef}
              type="button"
              className="cb-files-modal-add-btn"
              onClick={pick}
              disabled={addLocked}
              title={
                disabled
                  ? "현재 상태에서는 파일을 변경할 수 없습니다."
                  : isUploadingNow
                  ? "업로드 진행 중에는 파일을 추가할 수 없습니다."
                  : "파일 추가"
              }
            >
              파일 추가
            </button>

            <button
              type="button"
              className="cb-files-modal-close"
              onClick={onClose}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>

        <div className="cb-files-modal-body">
          <div className="cb-files-modal-desc" id={descId}>
            {description}
          </div>

          {(uploadingCount > 0 || errorCount > 0) && (
            <div
              className={cx(
                "cb-files-banner",
                uploadingCount > 0 && "cb-files-banner--progress",
                uploadingCount === 0 && errorCount > 0 && "cb-files-banner--error"
              )}
              role="status"
              aria-live="polite"
            >
              <div className="cb-files-banner-left">
                {uploadingCount > 0 ? (
                  <span className="cb-files-status-spinner" aria-hidden="true" />
                ) : (
                  <span className="cb-files-status-error" aria-hidden="true">
                    !
                  </span>
                )}

                <div className="cb-files-banner-text">
                  {uploadingCount > 0
                    ? `${uploadingCount}개 업로드 중…`
                    : "업로드 실패 항목이 있습니다."}
                  {errorCount > 0 ? (
                    <span className="cb-files-banner-sub">{` · 실패 ${errorCount}개`}</span>
                  ) : null}
                </div>
              </div>

              <div className="cb-files-banner-actions">
                {errorCount > 0 ? (
                  <button
                    type="button"
                    className="cb-files-banner-btn"
                    onClick={retryAllErrors}
                    disabled={disabled || isUploadingNow}
                    title={
                      disabled
                        ? "편집 불가"
                        : isUploadingNow
                        ? "업로드 진행 중에는 재시도할 수 없습니다."
                        : "실패 항목 모두 재시도"
                    }
                  >
                    실패 모두 재시도
                  </button>
                ) : null}
              </div>
            </div>
          )}

          <div
            className={cx(
              "cb-files-dropzone",
              dragging && "is-dragging",
              addLocked && "is-disabled"
            )}
            role="button"
            tabIndex={addLocked ? -1 : 0}
            aria-disabled={addLocked ? "true" : "false"}
            onClick={pick}
            onKeyDown={(e) => {
              if (addLocked) return;
              if (e.key === "Enter" || e.key === " ") pick();
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (addLocked) return;
              dragCounterRef.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (addLocked) return;
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (addLocked) return;
              dragCounterRef.current = Math.max(
                0,
                dragCounterRef.current - 1
              );
              if (dragCounterRef.current === 0) setDragging(false);
            }}
            onDrop={handleDrop}
          >
            <div className="cb-files-dropzone-icon">＋</div>
            <div className="cb-files-dropzone-title">파일을 추가하세요</div>
            <div className="cb-files-dropzone-sub">
              {disabled
                ? "편집 불가 상태"
                : isUploadingNow
                ? "업로드 진행 중… (추가 불가)"
                : "클릭하거나 드래그 앤 드롭"}
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            className="cb-files-hidden-input"
            onChange={handleInputChange}
            disabled={addLocked}
          />

          <div className="cb-files-list">
            {pending.length === 0 && visibleFiles.length === 0 ? (
              <div className="cb-files-empty">추가된 파일이 없습니다.</div>
            ) : (
              <>
                {pending.map((p) => {
                  const linked = p.linkedId
                    ? filesById.get(p.linkedId)
                    : undefined;

                  return (
                    <div
                      key={p.tempId}
                      className={cx(
                        "cb-files-item",
                        "cb-files-item--pending",
                        p.status === "done" && "is-done",
                        p.status === "error" && "is-error"
                      )}
                    >
                      <div
                        className="cb-files-item-status"
                        title={statusBadgeLabel(p.status)}
                        aria-label={statusBadgeLabel(p.status)}
                      >
                        {renderStatusIcon(p.status)}
                      </div>

                      <div className="cb-files-item-left">
                        <div className="cb-files-item-name-row">
                          <div className="cb-files-item-name" title={p.name}>
                            {p.name}
                          </div>

                          {linked?.meta ? (
                            <span className="cb-files-badge">{linked.meta}</span>
                          ) : null}

                          <span
                            className={cx(
                              "cb-files-badge",
                              p.status === "uploading" && "is-uploading",
                              p.status === "done" && "is-done",
                              p.status === "error" && "is-error"
                            )}
                          >
                            {statusBadgeLabel(p.status)}
                          </span>
                        </div>

                        <div className="cb-files-item-meta">
                          {formatBytes(p.sizeBytes)}
                          {p.status === "error" && p.errorMessage
                            ? ` · ${p.errorMessage}`
                            : ""}
                        </div>
                      </div>

                      <div className="cb-files-item-actions">
                        {p.status === "error" ? (
                          <button
                            type="button"
                            className="cb-files-item-retry"
                            onClick={() => retryOne(p)}
                            disabled={disabled || isUploadingNow}
                            title={
                              disabled
                                ? "편집 불가"
                                : isUploadingNow
                                ? "업로드 진행 중에는 재시도할 수 없습니다."
                                : "재시도"
                            }
                          >
                            재시도
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className="cb-files-item-remove"
                          onClick={() => dismissPending(p.tempId)}
                          disabled={disabled ? true : p.status === "uploading"}
                          aria-label="삭제"
                          title={
                            disabled
                              ? "편집 불가"
                              : p.status === "uploading"
                              ? "업로드 중에는 삭제할 수 없습니다."
                              : "목록에서 제거"
                          }
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}

                {visibleFiles.map((f) => {
                  const removing = removingIds.has(f.id);
                  const isDone = recentDoneIds.has(f.id);

                  return (
                    <div key={f.id} className="cb-files-item">
                      <div
                        className={cx(
                          "cb-files-item-status",
                          isDone
                            ? "cb-files-item-status--done"
                            : "cb-files-item-status--idle"
                        )}
                        aria-hidden="true"
                        title={isDone ? "업로드 완료" : "등록됨"}
                      >
                        {isDone ? (
                          <span className="cb-files-status-check" aria-hidden="true">
                            ✓
                          </span>
                        ) : null}
                      </div>

                      <div className="cb-files-item-left">
                        <div className="cb-files-item-name-row">
                          <div className="cb-files-item-name" title={f.name}>
                            {f.name}
                          </div>

                          {f.meta ? (
                            <span className="cb-files-badge">{f.meta}</span>
                          ) : null}

                          {isDone ? (
                            <span className={cx("cb-files-badge", "is-done")}>
                              완료
                            </span>
                          ) : null}
                        </div>

                        {f.sizeBytes ? (
                          <div className="cb-files-item-meta">
                            {formatBytes(f.sizeBytes)}
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        className={cx(
                          "cb-files-item-remove",
                          removing && "is-loading"
                        )}
                        onClick={() => removeActual(f.id)}
                        disabled={disabled || removing}
                        aria-label="삭제"
                        title={disabled ? "편집 불가" : removing ? "삭제 중" : "삭제"}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (typeof document === "undefined") return null;
  return open ? createPortal(body, document.body) : null;
}
