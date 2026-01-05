// src/components/dashboard/components/tabs/AdminFAQTab.tsx
import React, { useCallback, useEffect, useState } from "react";
import "../../../chatbot/chatbot.css";
import {
  listFAQCandidates,
  autoGenerateFAQCandidates,
  approveFAQCandidate,
  rejectFAQCandidate,
  type FAQCandidate,
  type FAQCandidateStatus,
  type AutoGenerateRequest,
} from "../../api/faqApi";

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(" ");
}

type Toast =
  | { open: false }
  | { open: true; tone: "neutral" | "warn" | "danger"; message: string };

function statusLabel(status: FAQCandidateStatus): string {
  switch (status) {
    case "NEW":
      return "신규";
    case "PENDING":
      return "대기중";
    case "APPROVED":
      return "승인됨";
    case "REJECTED":
      return "반려됨";
    default:
      return status;
  }
}

function statusTone(status: FAQCandidateStatus): "neutral" | "warn" | "danger" {
  switch (status) {
    case "NEW":
      return "warn"; // 신규는 주의 표시
    case "PENDING":
      return "neutral";
    case "APPROVED":
      return "neutral";
    case "REJECTED":
      return "danger";
    default:
      return "neutral";
  }
}

const AdminFAQTab: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<FAQCandidate[]>([]);
  const [statusFilter, setStatusFilter] = useState<FAQCandidateStatus | "ALL">(
    "ALL"
  );
  const [selectedCandidate, setSelectedCandidate] =
    useState<FAQCandidate | null>(null);

  // 자동 생성 설정
  const [autoGenSettings, setAutoGenSettings] = useState<AutoGenerateRequest>({
    minFrequency: 3,
    daysBack: 30,
  });

  const [toast, setToast] = useState<Toast>({ open: false });
  const toastTimerRef = React.useRef<number | null>(null);

  const showToast = (
    tone: "neutral" | "warn" | "danger",
    message: string
  ) => {
    setToast({ open: true, tone, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(
      () => setToast({ open: false }),
      2400
    );
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // FAQ 후보 목록 조회
  const fetchCandidates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      console.log("[FAQ] 목록 조회 시작, 필터:", statusFilter);
      const response = await listFAQCandidates(
        statusFilter === "ALL" ? undefined : statusFilter
      );
      console.log("[FAQ] 목록 조회 완료:", {
        response,
        itemsLength: response?.items?.length,
        total: response?.total,
        rawResponse: JSON.stringify(response, null, 2),
      });
      
      // 안전하게 배열로 설정
      const items = Array.isArray(response?.items) ? response.items : [];
      console.log("[FAQ] 설정할 후보 목록:", items.length, "개");
      
      // 목록이 비어있고 기존 후보가 있으면 기존 후보 유지 (목록 조회 API 문제일 수 있음)
      if (items.length === 0 && candidates.length > 0) {
        console.warn("[FAQ] ⚠️ 목록 조회가 빈 배열을 반환했지만 기존 후보가 있습니다. 기존 후보를 유지합니다.");
        // 기존 후보 유지, 로딩만 해제
        setLoading(false);
        return;
      }
      
      setCandidates(items);
      
      if (items.length === 0 && response?.total === 0) {
        console.log("[FAQ] 후보가 없습니다.");
      }
    } catch (err) {
      console.error("[FAQ] 목록 조회 실패:", err);
      setError("FAQ 후보 목록을 불러오는데 실패했습니다.");
      showToast("danger", "FAQ 후보 목록을 불러오는데 실패했습니다.");
      // 에러 발생 시 기존 목록 유지 (빈 배열로 덮어쓰지 않음)
      // setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, candidates.length]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  // 자동 생성 실행
  const handleAutoGenerate = useCallback(async () => {
    try {
      setGenerating(true);
      setError(null);
      console.log("=".repeat(50));
      console.log("[FAQ] 자동 생성 시작");
      console.log("[FAQ] 요청 파라미터:", {
        minFrequency: autoGenSettings.minFrequency ?? 3,
        daysBack: autoGenSettings.daysBack ?? 30,
        설명: "최근 N일 내 여러 사용자가 M회 이상 질문한 항목 찾기",
      });
      
      const response = await autoGenerateFAQCandidates(autoGenSettings);
      
      // 백엔드 응답 구조에 맞게 수정
      const candidatesFound = response?.candidatesFound ?? 0;
      const draftsGenerated = response?.draftsGenerated ?? 0;
      const drafts = response?.drafts ?? [];
      
      console.log("[FAQ] 자동 생성 응답:", JSON.stringify(response, null, 2));
      console.log("[FAQ] 응답 분석:", {
        status: response?.status,
        candidatesFound: `${candidatesFound}개 발견`,
        draftsGenerated: `${draftsGenerated}개 생성`,
        draftsFailed: `${response?.draftsFailed ?? 0}개 실패`,
        draftsLength: `${drafts.length}개`,
        errorMessage: response?.errorMessage,
      });
      
      if (candidatesFound === 0) {
        console.warn("[FAQ] ⚠️ 후보가 0개입니다. 확인 필요:");
        console.warn("  1. 최근", autoGenSettings.daysBack ?? 30, "일 내 질문이 있는지");
        console.warn("  2. 여러 사용자가 같은 질문을 했는지 (한 사용자가 여러 번은 제외)");
        console.warn("  3. 질문이", autoGenSettings.minFrequency ?? 3, "회 이상인지");
        console.warn("  4. 백엔드에서 유사도 검사가 너무 엄격한지");
      }
      console.log("=".repeat(50));
      
      if (response?.status === "FAILED") {
        showToast(
          "danger",
          `FAQ 후보 자동 생성에 실패했습니다: ${response?.errorMessage || "알 수 없는 오류"}`
        );
      } else if (candidatesFound === 0) {
        showToast(
          "warn",
          `조건에 맞는 FAQ 후보가 없습니다. (발견된 후보: ${candidatesFound}개)\n최근 ${autoGenSettings.daysBack ?? 30}일 내 여러 사용자가 ${autoGenSettings.minFrequency ?? 3}회 이상 질문한 항목이 있는지 확인해주세요.`
        );
      } else if (draftsGenerated === 0) {
        showToast(
          "warn",
          `후보는 발견되었지만 초안 생성에 실패했습니다. (발견: ${candidatesFound}개, 생성: ${draftsGenerated}개, 실패: ${response?.draftsFailed ?? 0}개)`
        );
      } else {
        showToast(
          "neutral",
          `${draftsGenerated}개의 FAQ 후보가 생성되었습니다. (발견: ${candidatesFound}개)`
        );
      }
      
      // 자동 생성 후 목록 새로고침 (DB 저장 완료 대기 후)
      // drafts 배열이 있으면 즉시 추가하고, 그 다음 목록 새로고침
      if (drafts && drafts.length > 0) {
        console.log("[FAQ] 자동 생성된 drafts를 목록에 추가:", drafts.length, "개");
        // FAQDraftItem을 FAQCandidate로 변환
        const { convertDraftToCandidate } = await import("../../api/faqApi");
        const newCandidates = drafts.map((draft) => convertDraftToCandidate(draft));
        
        setCandidates((prev) => {
          const existingIds = new Set(
            prev.map((c) => (c.id || c.faqDraftId || "")).filter(Boolean)
          );
          const uniqueNew = newCandidates.filter(
            (c) => {
              const id = c.id || c.faqDraftId || "";
              return id && !existingIds.has(id);
            }
          );
          console.log("[FAQ] 기존 후보:", prev.length, "개, 새 후보:", uniqueNew.length, "개");
          const updated = [...prev, ...uniqueNew];
          console.log("[FAQ] 업데이트된 후보 목록:", updated.length, "개");
          return updated;
        });
      }
      
      // DB 저장 완료를 기다린 후 목록 새로고침 (하지만 기존 목록이 있으면 유지)
      setTimeout(async () => {
        console.log("[FAQ] 목록 새로고침 시작...");
        // 목록 조회를 시도하되, 빈 배열이면 기존 목록 유지
        try {
          const response = await listFAQCandidates(
            statusFilter === "ALL" ? undefined : statusFilter
          );
          const items = Array.isArray(response?.items) ? response.items : [];
          console.log("[FAQ] 목록 새로고침 결과:", items.length, "개");
          
          // 목록 조회 결과가 있으면 업데이트, 없으면 기존 목록 유지
          if (items.length > 0) {
            setCandidates(items);
          } else {
            console.log("[FAQ] 목록 조회 결과가 비어있어 기존 목록을 유지합니다.");
          }
        } catch (err) {
          console.error("[FAQ] 목록 새로고침 실패:", err);
          // 에러 발생 시 기존 목록 유지
        }
      }, 2000);
    } catch (err) {
      console.error("[FAQ] 자동 생성 실패:", err);
      const errorMessage =
        err instanceof Error ? err.message : "FAQ 후보 자동 생성에 실패했습니다.";
      setError(errorMessage);
      showToast("danger", `FAQ 후보 자동 생성에 실패했습니다: ${errorMessage}`);
    } finally {
      setGenerating(false);
    }
  }, [autoGenSettings, fetchCandidates]);

  // 승인
  const handleApprove = useCallback(
    async (candidate: FAQCandidate) => {
      const candidateId = candidate.id || candidate.faqDraftId;
      if (!candidateId) {
        showToast("danger", "FAQ 후보 ID가 없습니다.");
        return;
      }
      
      try {
        setLoading(true);
        await approveFAQCandidate(candidateId);
        showToast("neutral", "FAQ 후보가 승인되었습니다.");
        await fetchCandidates(); // 목록 새로고침
        const currentId = selectedCandidate?.id || selectedCandidate?.faqDraftId;
        if (currentId === candidateId) {
          setSelectedCandidate(null);
        }
      } catch (err) {
        console.error("Failed to approve FAQ candidate:", err);
        showToast("danger", "FAQ 후보 승인에 실패했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [selectedCandidate, fetchCandidates]
  );

  // 반려
  const handleReject = useCallback(
    async (candidate: FAQCandidate) => {
      const candidateId = candidate.id || candidate.faqDraftId;
      if (!candidateId) {
        showToast("danger", "FAQ 후보 ID가 없습니다.");
        return;
      }
      
      try {
        setLoading(true);
        await rejectFAQCandidate(candidateId);
        showToast("neutral", "FAQ 후보가 반려되었습니다.");
        await fetchCandidates(); // 목록 새로고침
        const currentId = selectedCandidate?.id || selectedCandidate?.faqDraftId;
        if (currentId === candidateId) {
          setSelectedCandidate(null);
        }
      } catch (err) {
        console.error("Failed to reject FAQ candidate:", err);
        showToast("danger", "FAQ 후보 반려에 실패했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [selectedCandidate, fetchCandidates]
  );

  // 안전하게 필터링 (candidates가 배열인지 확인)
  const filteredCandidates = (Array.isArray(candidates) ? candidates : []).filter(
    (c) => statusFilter === "ALL" || c.status === statusFilter
  );

  return (
    <div className="cb-admin-tab-panel">
      {toast.open && (
        <div
          className={cx(
            "cb-reviewer-toast",
            `cb-reviewer-toast--${toast.tone}`
          )}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}

      <div className="cb-policy-root">
        <div className="cb-policy-layout">
          {/* 좌측: 후보 목록 */}
          <aside className="cb-policy-left">
            <div className="cb-policy-left-header">
              <div className="cb-policy-left-title">FAQ 후보</div>

              {/* 자동 생성 설정 및 버튼 */}
              <div className="cb-policy-left-actions">
                <div
                  style={{
                    padding: "12px",
                    backgroundColor: "#f0f7ff",
                    borderRadius: "4px",
                    marginBottom: "12px",
                    fontSize: "12px",
                    color: "#333",
                    lineHeight: "1.5",
                  }}
                >
                  <strong>💡 안내:</strong> 최근{" "}
                  {autoGenSettings.daysBack ?? 30}일 내{" "}
                  <strong>여러 사용자가</strong>{" "}
                  {autoGenSettings.minFrequency ?? 3}회 이상 질문한 항목이
                  자동 생성됩니다.
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    marginBottom: "12px",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <label style={{ fontSize: "12px", minWidth: "80px" }}>
                      최소 빈도:
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={autoGenSettings.minFrequency ?? 3}
                      onChange={(e) =>
                        setAutoGenSettings({
                          ...autoGenSettings,
                          minFrequency: parseInt(e.target.value, 10) || 3,
                        })
                      }
                      style={{
                        width: "60px",
                        padding: "4px 8px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                      }}
                    />
                    <span style={{ fontSize: "12px", color: "#666" }}>회</span>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <label style={{ fontSize: "12px", minWidth: "80px" }}>
                      기간:
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={autoGenSettings.daysBack ?? 30}
                      onChange={(e) =>
                        setAutoGenSettings({
                          ...autoGenSettings,
                          daysBack: parseInt(e.target.value, 10) || 30,
                        })
                      }
                      style={{
                        width: "60px",
                        padding: "4px 8px",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                      }}
                    />
                    <span style={{ fontSize: "12px", color: "#666" }}>일</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="cb-admin-primary-btn"
                  onClick={handleAutoGenerate}
                  disabled={generating || loading}
                  style={{ width: "100%" }}
                >
                  {generating ? "생성 중..." : "자동 생성"}
                </button>
              </div>

              {/* 필터 */}
              <div className="cb-policy-filters">
                <div className="cb-policy-filters-row">
                  <select
                    className="cb-policy-select"
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(
                        e.target.value as FAQCandidateStatus | "ALL"
                      )
                    }
                  >
                    <option value="ALL">전체</option>
                    <option value="NEW">신규</option>
                    <option value="PENDING">대기중</option>
                    <option value="APPROVED">승인됨</option>
                    <option value="REJECTED">반려됨</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 후보 목록 */}
            <div className="cb-policy-group-list">
              {loading ? (
                <div className="cb-policy-empty">로딩 중...</div>
              ) : error ? (
                <div className="cb-policy-empty" style={{ color: "red" }}>
                  {error}
                </div>
              ) : filteredCandidates.length === 0 ? (
                <div className="cb-policy-empty">
                  조건에 해당하는 FAQ 후보가 없습니다.
                </div>
              ) : (
                filteredCandidates.map((candidate) => {
                  const candidateId = candidate.id || candidate.faqDraftId || "";
                  const isSelected =
                    (selectedCandidate?.id || selectedCandidate?.faqDraftId) === candidateId;
                  return (
                    <div
                      key={candidateId}
                      role="button"
                      tabIndex={0}
                      className={cx(
                        "cb-policy-group",
                        isSelected && "is-selected"
                      )}
                      onClick={() => setSelectedCandidate(candidate)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedCandidate(candidate);
                        }
                      }}
                    >
                      <div className="cb-policy-group-top">
                        <div className="cb-policy-group-docid">
                          {candidate.frequency ? `${candidate.frequency}회 질문` : "자동 생성"}
                        </div>
                        <div className="cb-policy-group-top-right">
                          <span
                            className={cx(
                              "cb-reviewer-pill",
                              `cb-reviewer-pill--${statusTone(candidate.status)}`
                            )}
                          >
                            {statusLabel(candidate.status)}
                          </span>
                        </div>
                      </div>
                      <div className="cb-policy-group-title">
                        {candidate.question}
                      </div>
                      <div className="cb-policy-group-meta">
                        {candidate.firstAskedAt && candidate.lastAskedAt ? (
                          <span className="cb-policy-meta-chip">
                            {new Date(candidate.firstAskedAt).toLocaleDateString()}
                            {" ~ "}
                            {new Date(candidate.lastAskedAt).toLocaleDateString()}
                          </span>
                        ) : candidate.createdAt ? (
                          <span className="cb-policy-meta-chip">
                            생성: {new Date(candidate.createdAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* 우측: 상세 정보 및 승인/반려 */}
          <main className="cb-policy-right">
            {!selectedCandidate ? (
              <div className="cb-policy-right-empty">
                <div>
                  <div className="title">FAQ 후보를 선택하세요</div>
                  <div className="desc">
                    좌측 목록에서 FAQ 후보를 선택하면 상세 내용을 확인하고
                    승인/반려할 수 있습니다.
                  </div>
                </div>
              </div>
            ) : (
              <div className="cb-policy-right-shell">
                <div className="cb-policy-right-head">
                  <div className="cb-policy-right-head-top">
                    <div className="cb-policy-right-title">
                      <div className="name" title={selectedCandidate.question}>
                        {selectedCandidate.question}
                      </div>
                    </div>
                    <div className="cb-policy-right-head-badges">
                      <span
                        className={cx(
                          "cb-reviewer-pill",
                          `cb-reviewer-pill--${statusTone(selectedCandidate.status)}`
                        )}
                      >
                        {statusLabel(selectedCandidate.status)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="cb-policy-right-body">
                  <section className="cb-policy-card">
                    <div className="cb-policy-card-title">질문 정보</div>
                    <div className="cb-policy-detail-grid">
                      <div className="row">
                        <div className="k">질문</div>
                        <div className="v">{selectedCandidate.question}</div>
                      </div>
                      {selectedCandidate.frequency !== undefined && (
                        <div className="row">
                          <div className="k">질문 빈도</div>
                          <div className="v">{selectedCandidate.frequency}회</div>
                        </div>
                      )}
                      {selectedCandidate.firstAskedAt && (
                        <div className="row">
                          <div className="k">최초 질문</div>
                          <div className="v">
                            {new Date(
                              selectedCandidate.firstAskedAt
                            ).toLocaleString()}
                          </div>
                        </div>
                      )}
                      {selectedCandidate.lastAskedAt && (
                        <div className="row">
                          <div className="k">최근 질문</div>
                          <div className="v">
                            {new Date(
                              selectedCandidate.lastAskedAt
                            ).toLocaleString()}
                          </div>
                        </div>
                      )}
                      {selectedCandidate.createdAt && (
                        <div className="row">
                          <div className="k">생성일시</div>
                          <div className="v">
                            {new Date(selectedCandidate.createdAt).toLocaleString()}
                          </div>
                        </div>
                      )}
                      {selectedCandidate.clusterId && (
                        <div className="row">
                          <div className="k">클러스터 ID</div>
                          <div className="v">{selectedCandidate.clusterId}</div>
                        </div>
                      )}
                      <div className="row">
                        <div className="k">상태</div>
                        <div className="v">
                          <span
                            className={cx(
                              "cb-reviewer-pill",
                              `cb-reviewer-pill--${statusTone(selectedCandidate.status)}`
                            )}
                          >
                            {statusLabel(selectedCandidate.status)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="cb-policy-card">
                    <div className="cb-policy-card-title">자동 생성된 답변</div>
                    <div
                      style={{
                        padding: "16px",
                        backgroundColor: "#f5f5f5",
                        borderRadius: "4px",
                        whiteSpace: "pre-wrap",
                        lineHeight: "1.6",
                      }}
                    >
                      {selectedCandidate.answer || selectedCandidate.answerMarkdown || "답변이 없습니다."}
                    </div>
                    {selectedCandidate.aiConfidence !== undefined && (
                      <div style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
                        AI 신뢰도: {(selectedCandidate.aiConfidence * 100).toFixed(1)}%
                      </div>
                    )}
                  </section>

                  {(selectedCandidate.status === "NEW" || selectedCandidate.status === "PENDING") && (
                    <section className="cb-policy-card">
                      <div className="cb-policy-card-title">승인/반려</div>
                      <div className="cb-policy-review-box">
                        <div className="cb-policy-review-actions">
                          <button
                            type="button"
                            className="cb-admin-primary-btn"
                            onClick={() => handleApprove(selectedCandidate)}
                            disabled={loading}
                          >
                            승인
                          </button>
                          <button
                            type="button"
                            className="cb-admin-ghost-btn"
                            onClick={() => handleReject(selectedCandidate)}
                            disabled={loading}
                            style={{ marginLeft: "8px" }}
                          >
                            반려
                          </button>
                        </div>
                        <div className="cb-policy-hint" style={{ marginTop: "12px" }}>
                          승인하면 FAQ로 등록되고, 반려하면 목록에서 제외됩니다.
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default AdminFAQTab;
