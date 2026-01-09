// src/components/dashboard/components/tabs/AdminFAQTab.tsx
import React, { useCallback, useEffect, useState } from "react";
import "../../../chatbot/chatbot.css";
import keycloak from "../../../../keycloak";
import {
  listFAQCandidates,
  autoGenerateFAQCandidates,
  approveFAQCandidate,
  rejectFAQCandidate,
  deleteFAQCandidate,
  type FAQCandidate,
  type FAQCandidateStatus,
  type AutoGenerateRequest,
} from "../../api/faqApi";
import { invalidateFaqListCache, invalidateFaqHomeCache } from "../../../chatbot/chatApi";

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
      console.log("[FAQ] 설정할 후보 목록:", items.length, "개", "필터:", statusFilter);
      console.log("[FAQ] 응답 항목 상세:", items.map((item) => ({
        id: item.id || item.faqDraftId,
        question: item.question,
        status: item.status,
      })));
      
      // 항상 API 응답을 반영 (승인/반려 후 상태 변경 반영)
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
        const searchStartDate = new Date(Date.now() - (autoGenSettings.daysBack ?? 30) * 24 * 60 * 60 * 1000);
        console.warn("=".repeat(60));
        console.warn("[FAQ] ⚠️ 후보가 0개입니다. 확인 필요:");
        console.warn("=".repeat(60));
        console.warn("  1. 최근", autoGenSettings.daysBack ?? 30, "일 내 질문이 있는지");
        console.warn("  2. 여러 사용자가 같은 질문을 했는지 (한 사용자가 여러 번은 제외)");
        console.warn("  3. 질문이", autoGenSettings.minFrequency ?? 3, "회 이상인지");
        console.warn("  4. 백엔드에서 유사도 검사가 너무 엄격한지");
        console.warn("  5. 질문 후 시간이 지났는지 확인 (클러스터링 처리 시간 필요)");
        console.warn("  6. 백엔드 로그 확인: /admin/chat/logs 에서 최근 질문 확인");
        console.warn("");
        console.warn("  [디버깅] 현재 요청 정보:");
        console.warn(JSON.stringify({
          minFrequency: autoGenSettings.minFrequency ?? 3,
          daysBack: autoGenSettings.daysBack ?? 30,
          검색시작일시: searchStartDate.toISOString(),
          검색시작일시_로컬: searchStartDate.toLocaleString("ko-KR"),
          현재일시: new Date().toISOString(),
          현재일시_로컬: new Date().toLocaleString("ko-KR"),
          검색기간: `${autoGenSettings.daysBack ?? 30}일`,
          최소빈도: `${autoGenSettings.minFrequency ?? 3}회`,
        }, null, 2));
        console.warn("");
        console.warn("  [디버깅] 백엔드 응답:");
        console.warn(JSON.stringify({
          status: response?.status,
          candidatesFound: response?.candidatesFound,
          draftsGenerated: response?.draftsGenerated,
          draftsFailed: response?.draftsFailed,
          errorMessage: response?.errorMessage,
          draftsCount: response?.drafts?.length ?? 0,
        }, null, 2));
        console.warn("=".repeat(60));
      }
      console.log("=".repeat(50));
      
      if (response?.status === "FAILED") {
        showToast(
          "danger",
          `FAQ 후보 자동 생성에 실패했습니다: ${response?.errorMessage || "알 수 없는 오류"}`
        );
      } else if (candidatesFound === 0) {
        // 토스트 메시지는 간결하게, 상세 정보는 콘솔에만 출력
        showToast(
          "warn",
          `조건에 맞는 FAQ 후보가 없습니다. (발견: ${candidatesFound}개)\n최근 ${autoGenSettings.daysBack ?? 30}일 내 ${autoGenSettings.minFrequency ?? 3}회 이상 질문한 항목이 있는지 확인하거나, 콘솔 로그를 확인해주세요.`
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
      let errorMessage = "FAQ 후보 자동 생성에 실패했습니다.";
      
      // HttpError인 경우 상세 정보 추출
      if (err instanceof Error && "status" in err) {
        const httpError = err as {
          status?: number;
          statusText?: string;
          body?: unknown;
          message?: string;
        };
        
        console.error("[FAQ] HTTP 에러 상세:", {
          status: httpError.status,
          statusText: httpError.statusText,
          body: httpError.body,
          message: httpError.message,
          requestParams: {
            minFrequency: autoGenSettings.minFrequency ?? 3,
            daysBack: autoGenSettings.daysBack ?? 30,
          },
        });
        
        if (httpError.status === 500) {
          errorMessage = "서버 오류가 발생했습니다. 백엔드 서버를 확인해주세요.";
          // 백엔드 에러 메시지가 있으면 추가
          if (httpError.body && typeof httpError.body === "object") {
            const body = httpError.body as { message?: string; error?: string; detail?: string };
            if (body.message) {
              errorMessage += `\n에러 메시지: ${body.message}`;
            } else if (body.error) {
              errorMessage += `\n에러: ${body.error}`;
            } else if (body.detail) {
              errorMessage += `\n상세: ${body.detail}`;
            }
          } else if (typeof httpError.body === "string") {
            errorMessage += `\n응답: ${httpError.body}`;
          }
        } else if (httpError.status === 400) {
          errorMessage = "잘못된 요청입니다. 파라미터를 확인해주세요.";
          if (httpError.body && typeof httpError.body === "object") {
            const body = httpError.body as { message?: string; error?: string };
            if (body.message || body.error) {
              errorMessage += ` (${body.message || body.error})`;
            }
          }
        } else if (httpError.status === 401) {
          errorMessage = "인증이 필요합니다. 다시 로그인해주세요.";
        } else if (httpError.status === 403) {
          errorMessage = "관리자 권한이 필요합니다.";
        } else {
          errorMessage = httpError.message || `HTTP ${httpError.status} ${httpError.statusText || ""}`;
        }
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      showToast("danger", errorMessage);
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
      
      // reviewerId 가져오기 (keycloak token에서)
      const reviewerId = (keycloak.tokenParsed as { sub?: string })?.sub;
      if (!reviewerId) {
        showToast("danger", "사용자 ID를 가져올 수 없습니다. 다시 로그인해주세요.");
        return;
      }
      
      // question과 answer 가져오기
      const question = candidate.question;
      const answer = candidate.answer || candidate.answerMarkdown || "";
      
      if (!question || !answer) {
        showToast("danger", "FAQ 후보의 질문 또는 답변이 없습니다.");
        return;
      }
      
      try {
        setLoading(true);
        console.log("[FAQ] 승인 요청 시작:", { candidateId, candidate, reviewerId });
        
        // AI 표준 도메인을 FAQ 도메인으로 매핑 (질문 내용 분석 포함)
        const candidateDomain = candidate.domain;
        const questionText = question.toLowerCase();
        let faqDomain: string | undefined = undefined;
        
        // 질문 내용 기반 도메인 감지 (우선순위 높음)
        const accountKeywords = ["계정", "로그인", "비밀번호", "아이디", "회원가입", "회원", "인증", "접속"];
        const approvalKeywords = ["결재", "승인", "결제"];
        const payKeywords = ["급여", "월급", "연봉", "봉급"];
        const welfareKeywords = ["복지", "혜택", "지원금", "보조금"];
        const hrKeywords = ["인사", "채용", "면접", "입사", "퇴사", "이직"];
        const educationKeywords = ["교육", "강의", "학습", "훈련", "과정", "수강"];
        const itKeywords = ["it", "컴퓨터", "시스템", "프로그램", "소프트웨어", "하드웨어"];
        const securityKeywords = ["보안", "해킹", "침해", "암호화", "권한", "접근제어"];
        const facilityKeywords = ["시설", "회의실", "주차", "건물", "사무실"];
        
        if (accountKeywords.some(keyword => questionText.includes(keyword))) {
          faqDomain = "ACCOUNT";
          console.log("[FAQ] 질문 내용 분석: 계정 관련 키워드 감지 → ACCOUNT");
        } else if (approvalKeywords.some(keyword => questionText.includes(keyword))) {
          faqDomain = "APPROVAL";
          console.log("[FAQ] 질문 내용 분석: 결재 관련 키워드 감지 → APPROVAL");
        } else if (payKeywords.some(keyword => questionText.includes(keyword))) {
          faqDomain = "PAY";
          console.log("[FAQ] 질문 내용 분석: 급여 관련 키워드 감지 → PAY");
        } else if (welfareKeywords.some(keyword => questionText.includes(keyword))) {
          faqDomain = "WELFARE";
          console.log("[FAQ] 질문 내용 분석: 복지 관련 키워드 감지 → WELFARE");
        } else if (hrKeywords.some(keyword => questionText.includes(keyword))) {
          faqDomain = "HR";
          console.log("[FAQ] 질문 내용 분석: 인사 관련 키워드 감지 → HR");
        } else if (educationKeywords.some(keyword => questionText.includes(keyword))) {
          faqDomain = "EDUCATION";
          console.log("[FAQ] 질문 내용 분석: 교육 관련 키워드 감지 → EDUCATION");
        } else if (itKeywords.some(keyword => questionText.includes(keyword))) {
          faqDomain = "IT";
          console.log("[FAQ] 질문 내용 분석: IT 관련 키워드 감지 → IT");
        } else if (securityKeywords.some(keyword => questionText.includes(keyword))) {
          faqDomain = "SECURITY";
          console.log("[FAQ] 질문 내용 분석: 보안 관련 키워드 감지 → SECURITY");
        } else if (facilityKeywords.some(keyword => questionText.includes(keyword))) {
          faqDomain = "FACILITY";
          console.log("[FAQ] 질문 내용 분석: 시설 관련 키워드 감지 → FACILITY");
        }
        
        // 질문 내용 분석으로 도메인을 찾지 못한 경우, AI 표준 도메인 매핑 사용
        if (!faqDomain && candidateDomain) {
          const upperDomain = candidateDomain.toUpperCase();
          switch (upperDomain) {
            case "POLICY":
              // POLICY는 질문 내용에 따라 SECURITY 또는 ETC로 매핑
              // 이미 보안 키워드 체크를 했으므로, 여기서는 기본값으로 SECURITY
              faqDomain = "SECURITY";
              break;
            case "EDU":
            case "EDUCATION":
              faqDomain = "EDUCATION";
              break;
            case "HR":
              faqDomain = "HR";
              break;
            case "QUIZ":
              faqDomain = "EDUCATION";
              break;
            case "GENERAL":
              faqDomain = "ETC";
              break;
            default:
              // 이미 FAQ 도메인인 경우 그대로 사용
              const faqDomains = ["ACCOUNT", "APPROVAL", "HR", "PAY", "WELFARE", "EDUCATION", "IT", "SECURITY", "FACILITY", "ETC"];
              if (faqDomains.includes(upperDomain)) {
                faqDomain = upperDomain;
              } else {
                faqDomain = candidateDomain; // 알 수 없는 경우 원본 사용
              }
              break;
          }
          console.log("[FAQ] AI 표준 도메인 매핑:", { 원본: candidateDomain, FAQ도메인: faqDomain });
        }
        
        // 최종적으로 도메인을 찾지 못한 경우 ETC로 설정
        if (!faqDomain) {
          faqDomain = "ETC";
          console.log("[FAQ] 도메인을 찾지 못해 기본값 ETC 사용");
        }
        
        console.log("[FAQ] 최종 도메인 결정:", { 원본도메인: candidateDomain, 질문: question.substring(0, 30), 결정된FAQ도메인: faqDomain });
        
        const approvedResponse = await approveFAQCandidate(candidateId, {
          reviewerId,
          question,
          answer,
          domain: faqDomain, // 매핑된 FAQ 도메인 전달
        });
        console.log("[FAQ] 승인 성공:", candidateId);
        console.log("[FAQ] 승인 응답 상세:", approvedResponse);
        
        // 승인된 FAQ 정보 확인 (응답이 null일 수 있음)
        const approvedDomain = approvedResponse?.domain || faqDomain || candidate.domain;
        
        // 챗봇 UI의 FAQ 캐시 무효화 (승인된 FAQ가 챗봇 UI에 즉시 반영되도록)
        if (approvedDomain) {
          // 해당 도메인의 FAQ 목록 캐시 무효화
          // approvedDomain은 string이지만 ChatServiceDomain으로 사용 가능
          invalidateFaqListCache(approvedDomain.toUpperCase() as any);
          console.log("[FAQ] 챗봇 UI FAQ 캐시 무효화:", approvedDomain);
          
          // FAQ Home 캐시도 무효화 (FAQ Home에 새로 추가된 FAQ가 표시되도록)
          invalidateFaqHomeCache();
          console.log("[FAQ] 챗봇 UI FAQ Home 캐시 무효화");
        } else {
          // 도메인이 없는 경우 전체 캐시 무효화
          invalidateFaqListCache();
          invalidateFaqHomeCache();
          console.log("[FAQ] 챗봇 UI 전체 FAQ 캐시 무효화");
        }
        
        // 승인 완료 메시지
        showToast(
          "neutral", 
          `FAQ 후보가 승인되었습니다.${approvedDomain ? ` (도메인: ${approvedDomain})` : ""}\n승인된 FAQ는 해당 도메인의 FAQ 목록에 추가됩니다.\n챗봇 UI에서 해당 도메인을 선택하면 새로 추가된 FAQ를 확인할 수 있습니다.`
        );
        
        // 선택된 항목 해제
        const currentId = selectedCandidate?.id || selectedCandidate?.faqDraftId;
        if (currentId === candidateId) {
          setSelectedCandidate(null);
        }
        
        // 목록 새로고침 (상태 변경 반영)
        // 현재 필터가 "대기중"이면 승인된 항목은 자동으로 사라짐
        await fetchCandidates();
      } catch (err) {
        console.error("[FAQ] 승인 실패:", err);
        let errorMessage = "FAQ 후보 승인에 실패했습니다.";
        
        // HttpError인 경우 상세 정보 추출
        if (err instanceof Error && "status" in err) {
          const httpError = err as {
            status?: number;
            statusText?: string;
            body?: unknown;
            message?: string;
          };
          
          console.error("[FAQ] HTTP 에러 상세:", {
            status: httpError.status,
            statusText: httpError.statusText,
            body: httpError.body,
            message: httpError.message,
            candidateId,
            candidate: candidate,
          });
          
          // body를 JSON으로 출력하여 상세 확인
          if (httpError.body) {
            console.error("[FAQ] 에러 응답 body 상세:", JSON.stringify(httpError.body, null, 2));
          }
          
          if (httpError.status === 404) {
            errorMessage = "FAQ 후보를 찾을 수 없습니다.";
          } else if (httpError.status === 400) {
            errorMessage = "잘못된 요청입니다.";
            // 백엔드 에러 메시지 추출
            if (httpError.body && typeof httpError.body === "object") {
              const body = httpError.body as { 
                message?: string; 
                error?: string; 
                detail?: string;
                reason?: string;
              };
              if (body.message) {
                errorMessage = body.message;
              } else if (body.error) {
                errorMessage = body.error;
              } else if (body.detail) {
                errorMessage = body.detail;
              } else if (body.reason) {
                errorMessage = body.reason;
              } else {
                errorMessage = "FAQ 후보 상태를 확인해주세요. (이미 처리되었거나 유효하지 않은 상태일 수 있습니다)";
              }
            } else if (typeof httpError.body === "string") {
              errorMessage = httpError.body;
            } else {
              errorMessage = "FAQ 후보 상태를 확인해주세요. (이미 처리되었거나 유효하지 않은 상태일 수 있습니다)";
            }
          } else if (httpError.status === 401) {
            errorMessage = "인증이 필요합니다. 다시 로그인해주세요.";
          } else if (httpError.status === 403) {
            errorMessage = "관리자 권한이 필요합니다.";
          } else if (httpError.status === 409) {
            errorMessage = "이미 처리된 FAQ 후보입니다.";
          } else if (httpError.status === 500) {
            errorMessage = "서버 오류가 발생했습니다. 백엔드 서버를 확인해주세요.";
            if (httpError.body && typeof httpError.body === "object") {
              const body = httpError.body as { message?: string; error?: string };
              if (body.message || body.error) {
                errorMessage += ` (${body.message || body.error})`;
              }
            }
          } else {
            errorMessage = httpError.message || `HTTP ${httpError.status} ${httpError.statusText || ""}`;
          }
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }
        
        showToast("danger", errorMessage);
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
      
      // reviewerId 가져오기 (keycloak token에서)
      const reviewerId = (keycloak.tokenParsed as { sub?: string })?.sub;
      if (!reviewerId) {
        showToast("danger", "사용자 ID를 가져올 수 없습니다. 다시 로그인해주세요.");
        return;
      }
      
      // question과 answer 가져오기
      const question = candidate.question;
      const answer = candidate.answer || candidate.answerMarkdown || "";
      
      if (!question || !answer) {
        showToast("danger", "FAQ 후보의 질문 또는 답변이 없습니다.");
        return;
      }
      
      try {
        setLoading(true);
        console.log("[FAQ] 반려 요청 시작:", { candidateId, candidate, reviewerId });
        const rejectResponse = await rejectFAQCandidate(candidateId, {
          reviewerId,
          question,
          answer,
        });
        console.log("[FAQ] 반려 성공:", candidateId);
        console.log("[FAQ] 반려 응답 상세:", rejectResponse);
        showToast("neutral", "FAQ 후보가 반려되었습니다.");
        
        // 선택된 항목 해제
        const currentId = selectedCandidate?.id || selectedCandidate?.faqDraftId;
        if (currentId === candidateId) {
          setSelectedCandidate(null);
        }
        
        // 목록 새로고침 (상태 변경 반영)
        // 현재 필터가 "대기중"이면 반려된 항목은 자동으로 사라짐
        await fetchCandidates();
      } catch (err) {
        console.error("[FAQ] 반려 실패:", err);
        let errorMessage = "FAQ 후보 반려에 실패했습니다.";
        
        // HttpError인 경우 상세 정보 추출
        if (err instanceof Error && "status" in err) {
          const httpError = err as {
            status?: number;
            statusText?: string;
            body?: unknown;
            message?: string;
          };
          
          console.error("[FAQ] HTTP 에러 상세:", {
            status: httpError.status,
            statusText: httpError.statusText,
            body: httpError.body,
            message: httpError.message,
            candidateId,
            candidate: candidate,
          });
          
          // body를 JSON으로 출력하여 상세 확인
          if (httpError.body) {
            console.error("[FAQ] 에러 응답 body 상세:", JSON.stringify(httpError.body, null, 2));
          }
          
          if (httpError.status === 404) {
            errorMessage = "FAQ 후보를 찾을 수 없습니다.";
          } else if (httpError.status === 400) {
            errorMessage = "잘못된 요청입니다.";
            // 백엔드 에러 메시지 추출
            if (httpError.body && typeof httpError.body === "object") {
              const body = httpError.body as { 
                message?: string; 
                error?: string; 
                detail?: string;
                reason?: string;
              };
              if (body.message) {
                errorMessage = body.message;
              } else if (body.error) {
                errorMessage = body.error;
              } else if (body.detail) {
                errorMessage = body.detail;
              } else if (body.reason) {
                errorMessage = body.reason;
              } else {
                errorMessage = "FAQ 후보 상태를 확인해주세요. (이미 처리되었거나 유효하지 않은 상태일 수 있습니다)";
              }
            } else if (typeof httpError.body === "string") {
              errorMessage = httpError.body;
            } else {
              errorMessage = "FAQ 후보 상태를 확인해주세요. (이미 처리되었거나 유효하지 않은 상태일 수 있습니다)";
            }
          } else if (httpError.status === 401) {
            errorMessage = "인증이 필요합니다. 다시 로그인해주세요.";
          } else if (httpError.status === 403) {
            errorMessage = "관리자 권한이 필요합니다.";
          } else if (httpError.status === 409) {
            errorMessage = "이미 처리된 FAQ 후보입니다.";
          } else if (httpError.status === 500) {
            errorMessage = "서버 오류가 발생했습니다. 백엔드 서버를 확인해주세요.";
            if (httpError.body && typeof httpError.body === "object") {
              const body = httpError.body as { message?: string; error?: string };
              if (body.message || body.error) {
                errorMessage += ` (${body.message || body.error})`;
              }
            }
          } else {
            errorMessage = httpError.message || `HTTP ${httpError.status} ${httpError.statusText || ""}`;
          }
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }
        
        showToast("danger", errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [selectedCandidate, fetchCandidates]
  );

  // 삭제
  const handleDelete = useCallback(
    async (candidate: FAQCandidate, event?: React.MouseEvent) => {
      // 이벤트 전파 방지 (카드 클릭 이벤트와 충돌 방지)
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      
      const candidateId = candidate.id || candidate.faqDraftId;
      if (!candidateId) {
        showToast("danger", "FAQ 후보 ID가 없습니다.");
        return;
      }
      
      // reviewerId 가져오기 (keycloak token에서)
      const reviewerId = (keycloak.tokenParsed as { sub?: string })?.sub;
      if (!reviewerId) {
        showToast("danger", "사용자 ID를 가져올 수 없습니다. 다시 로그인해주세요.");
        return;
      }
      
      // 확인 다이얼로그
      const confirmed = window.confirm(
        `정말로 이 FAQ 후보를 삭제하시겠습니까?\n\n질문: ${candidate.question}\n상태: ${statusLabel(candidate.status)}`
      );
      
      if (!confirmed) {
        return;
      }
      
      try {
        setLoading(true);
        console.log("[FAQ] 삭제 요청 시작:", { candidateId, candidate, reviewerId });
        await deleteFAQCandidate(candidateId, reviewerId);
        console.log("[FAQ] 삭제 성공:", candidateId);
        showToast("neutral", "FAQ 후보가 삭제되었습니다.");
        
        // 선택된 항목 해제
        const currentId = selectedCandidate?.id || selectedCandidate?.faqDraftId;
        if (currentId === candidateId) {
          setSelectedCandidate(null);
        }
        
        // 목록 새로고침
        await fetchCandidates();
      } catch (err) {
        console.error("[FAQ] 삭제 실패:", err);
        let errorMessage = "FAQ 후보 삭제에 실패했습니다.";
        
        // HttpError인 경우 상세 정보 추출
        if (err instanceof Error && "status" in err) {
          const httpError = err as {
            status?: number;
            statusText?: string;
            body?: unknown;
            message?: string;
          };
          
          if (httpError.status === 404) {
            errorMessage = "FAQ 후보를 찾을 수 없습니다.";
          } else if (httpError.status === 403) {
            errorMessage = "삭제 권한이 없습니다.";
          } else if (httpError.status === 409) {
            errorMessage = "이미 처리된 FAQ 후보는 삭제할 수 없습니다.";
          } else {
            errorMessage = httpError.message || `HTTP ${httpError.status} ${httpError.statusText || ""}`;
          }
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }
        
        showToast("danger", errorMessage);
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div className="cb-policy-left-title">FAQ 후보</div>
                <div
                  style={{
                    padding: "8px 12px",
                    backgroundColor: "#f0f7ff",
                    borderRadius: "4px",
                    fontSize: "12px",
                    color: "#333",
                    lineHeight: "1.5",
                    flex: "1",
                    marginLeft: "12px",
                  }}
                >
                  <strong>💡 안내:</strong> 최근{" "}
                  {autoGenSettings.daysBack ?? 30}일 내{" "}
                  <strong>여러 사용자가</strong>{" "}
                  {autoGenSettings.minFrequency ?? 3}회 이상 질문한 항목이
                  자동 생성됩니다.
                </div>
              </div>

              {/* 자동 생성 설정 및 버튼 */}
              <div className="cb-policy-left-actions">
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
                        <div className="cb-policy-group-top-right" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          {/* 모든 상태에서 삭제 버튼 표시 (초안 포함) */}
                          <button
                            type="button"
                            onClick={(e) => handleDelete(candidate, e)}
                            disabled={loading}
                            style={{
                              padding: "4px 8px",
                              fontSize: "12px",
                              backgroundColor: "transparent",
                              border: "1px solid #ddd",
                              borderRadius: "4px",
                              cursor: loading ? "not-allowed" : "pointer",
                              color: "#666",
                              opacity: loading ? 0.5 : 1,
                            }}
                            title="삭제"
                          >
                            삭제
                          </button>
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
                        <div className="cb-policy-review-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
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
                          >
                            반려
                          </button>
                          <button
                            type="button"
                            className="cb-admin-ghost-btn"
                            onClick={() => handleDelete(selectedCandidate)}
                            disabled={loading}
                            style={{
                              borderColor: "#dc3545",
                              color: "#dc3545",
                            }}
                          >
                            삭제
                          </button>
                        </div>
                        <div className="cb-policy-hint" style={{ marginTop: "12px" }}>
                          승인하면 FAQ로 등록되고, 반려하면 목록에서 제외됩니다. 삭제하면 초안이 완전히 제거됩니다.
                        </div>
                      </div>
                    </section>
                  )}

                  {/* 초안이 아닌 상태에서도 삭제 가능하도록 삭제 섹션 추가 */}
                  {(selectedCandidate.status === "APPROVED" || selectedCandidate.status === "REJECTED") && (
                    <section className="cb-policy-card">
                      <div className="cb-policy-card-title">삭제</div>
                      <div className="cb-policy-review-box">
                        <div className="cb-policy-review-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                          <button
                            type="button"
                            className="cb-admin-ghost-btn"
                            onClick={() => handleDelete(selectedCandidate)}
                            disabled={loading}
                            style={{
                              borderColor: "#dc3545",
                              color: "#dc3545",
                            }}
                          >
                            삭제
                          </button>
                        </div>
                        <div className="cb-policy-hint" style={{ marginTop: "12px" }}>
                          이 FAQ 후보를 완전히 삭제합니다. 삭제된 항목은 복구할 수 없습니다.
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
