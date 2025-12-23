// src/components/chatbot/policyMocks.ts

import type {
  PolicyAuditAction,
  PolicyAuditEvent,
  PolicyDocVersion,
  PolicyPreprocessPreview,
} from "./policyTypes";

type Ago = { days?: number; hours?: number; minutes?: number };

function isoNowMinus({ days = 0, hours = 0, minutes = 0 }: Ago) {
  const d = new Date();
  d.setMinutes(d.getMinutes() - minutes);
  d.setHours(d.getHours() - (days * 24 + hours));
  return d.toISOString();
}

function bytesMB(mb: number) {
  return Math.round(mb * 1024 * 1024);
}

function buildExcerpt(input: {
  documentId: string;
  title: string;
  version: number;
  sections: string[];
  notes?: string[];
}) {
  const header =
    `[전처리 미리보기] 일부 텍스트 발췌\n` +
    `문서명: ${input.title}\n` +
    `document_id: ${input.documentId}\n` +
    `버전: v${input.version}\n` +
    `\n… (중략) …\n\n`;

  const body =
    input.sections.map((s, i) => `${i + 1}. ${s}`).join("\n") +
    (input.notes && input.notes.length
      ? `\n\n[검토 메모 후보]\n${input.notes.map((n) => `- ${n}`).join("\n")}\n`
      : "\n");

  return header + body;
}

function mkPreview(input: {
  documentId: string;
  title: string;
  version: number;
  pages: number;
  chars: number;
  sections: string[];
  notes?: string[];
}): PolicyPreprocessPreview {
  return {
    pages: input.pages,
    chars: input.chars,
    excerpt: buildExcerpt({
      documentId: input.documentId,
      title: input.title,
      version: input.version,
      sections: input.sections,
      notes: input.notes,
    }),
  };
}

export function createMockPolicyVersions(): PolicyDocVersion[] {
  let auditSeq = 0;
  const mkAudit = (
    action: PolicyAuditAction,
    atAgo: Ago,
    actor: string,
    message?: string
  ): PolicyAuditEvent => {
    auditSeq += 1;
    return {
      id: `pa-${String(auditSeq).padStart(4, "0")}`,
      at: isoNowMinus(atAgo),
      actor,
      action,
      message,
    };
  };

  const ADMIN = "SYSTEM_ADMIN";
  const REVIEWER = "CONTENTS_REVIEWER";
  const SYSTEM = "SYSTEM";

  const versions: PolicyDocVersion[] = [];

  // =========================================================
  // POL-COM-001: 사내 보안 정책(공통) — 다버전/ACTIVE/ARCHIVED/DRAFT
  // =========================================================
  {
    const documentId = "POL-COM-001";
    const title = "사내 보안 정책(공통)";

    const v1: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "초기 등록",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.35),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 12,
        chars: 23840,
        sections: [
          "계정/비밀번호 최소 요건",
          "사내 기기 반출/반입 기준",
          "보안 사고 신고 채널 및 SLA",
          "권한 신청/승인 프로세스",
        ],
        notes: ["표준 용어 정의(‘민감정보’/‘개인정보’) 보강 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 160 }),
      updatedAt: isoNowMinus({ days: 120 }),
      reviewRequestedAt: isoNowMinus({ days: 150 }),
      reviewItemId: "rvw-pol-seed-com-001-v1",
      activatedAt: isoNowMinus({ days: 149, hours: 10 }),
      archivedAt: isoNowMinus({ days: 120 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 160 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 159, hours: 22 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 159, hours: 20 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 150 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 149, hours: 10 }, REVIEWER, "승인"),
        mkAudit("INDEX_START", { days: 149, hours: 9 }, SYSTEM, "인덱싱 시작"),
        mkAudit("INDEX_DONE", { days: 149, hours: 8 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 120 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "비밀번호 정책 강화 및 MFA 예외 기준 정리",
      status: "ARCHIVED",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.42),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 13,
        chars: 25510,
        sections: [
          "MFA 의무 적용 범위(외부접속/관리자 계정)",
          "비밀번호 변경 주기/재사용 금지",
          "예외 승인(임시 계정/서비스 계정) 절차",
          "로그/감사 보관 기간(기본 1년)",
        ],
        notes: ["예외 승인 시 ‘만료일’ 필수 입력 UI 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 120 }),
      updatedAt: isoNowMinus({ days: 60 }),
      reviewRequestedAt: isoNowMinus({ days: 75 }),
      reviewItemId: "rvw-pol-seed-com-001-v2",
      activatedAt: isoNowMinus({ days: 74, hours: 12 }),
      archivedAt: isoNowMinus({ days: 60 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 120 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 119, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 119, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 75 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 74, hours: 12 }, REVIEWER, "승인"),
        mkAudit("INDEX_START", { days: 74, hours: 11 }, SYSTEM, "인덱싱 시작"),
        mkAudit("INDEX_DONE", { days: 74, hours: 10 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 60 }, SYSTEM, "v3 적용으로 ARCHIVED 전환"),
      ],
    };

    const v3: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "원격근무/협력사 계정 예외 조항 및 접근통제 강화",
      status: "ACTIVE",
      fileName: `${documentId}_v3.pdf`,
      fileSizeBytes: bytesMB(0.48),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 15,
        chars: 28980,
        sections: [
          "원격근무 시 VDI/Zero Trust 접속 원칙",
          "협력사 계정: 최소권한 + 만료일 + 로그 모니터링",
          "데이터 반출 승인(요청/승인/회수) 체크리스트",
          "보안 사고 유형별(피싱/악성코드/유출) 대응 단계",
        ],
        notes: ["협력사 계정 해지 배치 처리(매일 02:00) 명시"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 60 }),
      updatedAt: isoNowMinus({ days: 6 }),
      reviewRequestedAt: isoNowMinus({ days: 8 }),
      reviewItemId: "rvw-pol-seed-com-001-v3",
      activatedAt: isoNowMinus({ days: 7, hours: 18 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 60 }, ADMIN, "v3 생성"),
        mkAudit("UPLOAD_FILE", { days: 59, hours: 18 }, ADMIN, `${documentId}_v3.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 59, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 8 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 7, hours: 18 }, REVIEWER, "승인"),
        mkAudit("INDEX_START", { days: 7, hours: 17 }, SYSTEM, "인덱싱 시작"),
        mkAudit("INDEX_DONE", { days: 7, hours: 16 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v4: PolicyDocVersion = {
      id: `pol-${documentId}-v4`,
      documentId,
      title,
      version: 4,
      changeSummary: "보안 로그 보관기간 조정 + 내부 권한 점검 주기 명확화",
      status: "DRAFT",
      fileName: `${documentId}_v4_draft.pdf`,
      fileSizeBytes: bytesMB(0.52),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 4,
        pages: 16,
        chars: 30110,
        sections: [
          "로그 보관 기간: 서비스 등급별(핵심/일반) 차등 적용",
          "권한 점검 주기: 분기 1회(필수), 로그 샘플링 기준",
          "비정상 로그인 탐지 룰(지역/디바이스/시간대)",
          "보안 교육 미이수 시 계정 제한(예외 프로세스 포함)",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 3 }),
      updatedAt: isoNowMinus({ hours: 10 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 3 }, ADMIN, "v4 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 2, hours: 20 }, ADMIN, `${documentId}_v4_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 2, hours: 18 }, SYSTEM, "전처리 완료"),
      ],
    };

    versions.push(v1, v2, v3, v4);
  }

  // =========================================================
  // POL-PRIV-004: 개인정보 처리지침 — ACTIVE + PENDING_REVIEWER
  // =========================================================
  {
    const documentId = "POL-PRIV-004";
    const title = "개인정보 처리지침";

    const v1: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "초기 등록(수집/이용/파기 기본 원칙)",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.62),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 22,
        chars: 40100,
        sections: [
          "개인정보 처리 목적/항목/보유기간 표준",
          "수탁사 관리(점검/재위탁 금지)",
          "열람/정정/삭제 요청 처리 절차",
          "파기(논리/물리) 및 증적 보관",
        ],
        notes: ["보유기간 산정 예시(법령/내규) 표 추가 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 210 }),
      updatedAt: isoNowMinus({ days: 130 }),
      activatedAt: isoNowMinus({ days: 205 }),
      archivedAt: isoNowMinus({ days: 130 }),
      reviewRequestedAt: isoNowMinus({ days: 206 }),
      reviewItemId: "rvw-pol-seed-priv-004-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 210 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 209, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 209, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 206 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 205 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 205, hours: 2 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 130 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "민감정보 처리 가이드 + 마스킹 기준 상세화",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.78),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 26,
        chars: 45220,
        sections: [
          "민감정보/고유식별정보 처리 금지 원칙 및 예외 승인",
          "마스킹/가명처리 기준(로그/리포트/다운로드)",
          "접근권한(need-to-know) 및 이력 관리",
          "유출 사고 시 통지/보고 타임라인",
        ],
        notes: ["로그 PII 탐지 룰셋(정규식/NER) 업데이트 주기 정의"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 130 }),
      updatedAt: isoNowMinus({ days: 2 }),
      activatedAt: isoNowMinus({ days: 10 }),
      reviewRequestedAt: isoNowMinus({ days: 11 }),
      reviewItemId: "rvw-pol-seed-priv-004-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 130 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 129, hours: 20 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 129, hours: 18 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 11 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 10 }, REVIEWER, "승인"),
        mkAudit("INDEX_START", { days: 10, hours: 22 }, SYSTEM, "인덱싱 시작"),
        mkAudit("INDEX_DONE", { days: 10, hours: 21 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v3: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "해외 이전/국외 이전 체크리스트 및 표준 문구 추가",
      status: "PENDING_REVIEWER",
      fileName: `${documentId}_v3.pdf`,
      fileSizeBytes: bytesMB(0.81),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 28,
        chars: 47110,
        sections: [
          "국외 이전 사전 점검(법적 근거/동의/고지)",
          "DPA(개인정보 처리위탁 계약) 필수 조항",
          "데이터 위치/백업/파기 책임 분장",
          "감사 대응(요청서/증적 템플릿)",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 4 }),
      updatedAt: isoNowMinus({ days: 1, hours: 6 }),
      reviewRequestedAt: isoNowMinus({ days: 1, hours: 6 }),
      reviewItemId: "rvw-pol-seed-priv-004-v3",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 4 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 3, hours: 20 }, ADMIN, `${documentId}_v3.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 3, hours: 18 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 1, hours: 6 }, ADMIN, "검토 요청"),
      ],
    };

    versions.push(v1, v2, v3);
  }

  // =========================================================
  // POL-HR-002: 인사 규정(휴가/근태) — REJECTED + PENDING + DRAFT
  // =========================================================
  {
    const documentId = "POL-HR-002";
    const title = "인사 규정(휴가/근태)";

    const v1Rejected: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "연차/대체휴무 산정 기준 정리(초안)",
      status: "REJECTED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.55),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 18,
        chars: 32210,
        sections: [
          "연차 발생/소진 기준(입사일 기준)",
          "반차/반반차 운영 원칙",
          "유연근무(시차출퇴근) 신청/승인",
          "근태 예외(병가/공가) 증빙 기준",
        ],
        notes: ["‘근태 예외’ 정의가 모호함(사례 추가 필요)"],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 14 }),
      updatedAt: isoNowMinus({ days: 12 }),
      reviewRequestedAt: isoNowMinus({ days: 13 }),
      reviewItemId: "rvw-pol-seed-hr-002-v1",
      rejectedAt: isoNowMinus({ days: 12 }),
      rejectReason: "근태 예외 케이스 정의가 불명확합니다. 사례와 처리 흐름을 추가해주세요.",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 14 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 13, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 13, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 13 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_REJECT", { days: 12 }, REVIEWER, "반려"),
      ],
    };

    const v2Pending: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "예외 케이스 사례 추가 + 승인 책임자 명확화",
      status: "PENDING_REVIEWER",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.61),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 20,
        chars: 35120,
        sections: [
          "근태 예외(병가/공가/가족돌봄) 사례 표 추가",
          "승인권자: 1차 팀장, 2차 HR(특정 케이스)",
          "연차 소진 우선순위(법정/대체/연차)",
          "근태 정정(소급) 요청 기간 제한 및 로그",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 8 }),
      updatedAt: isoNowMinus({ days: 6 }),
      reviewRequestedAt: isoNowMinus({ days: 6 }),
      reviewItemId: "rvw-pol-seed-hr-002-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 8 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 7, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 7, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 6 }, ADMIN, "검토 요청"),
      ],
    };

    const v3Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "근무형태(재택/현장)별 근태 룰 추가(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v3_draft.pdf`,
      fileSizeBytes: bytesMB(0.58),
      preprocessStatus: "IDLE",
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 1, hours: 10 }),
      updatedAt: isoNowMinus({ hours: 6 }),
      audit: [mkAudit("CREATE_DRAFT", { days: 1, hours: 10 }, ADMIN, "v3 초안 생성")],
    };

    versions.push(v1Rejected, v2Pending, v3Draft);
  }

  // =========================================================
  // POL-FIN-003: 지출/정산 규정 — ARCHIVED + ACTIVE + DELETED
  // =========================================================
  {
    const documentId = "POL-FIN-003";
    const title = "지출/정산 규정";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "법인카드/개인비용 정산 기본 원칙",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.29),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 10,
        chars: 17770,
        sections: [
          "법인카드 사용 가능 항목/불가 항목",
          "개인비용 정산 시 증빙(영수증/세금계산서)",
          "출장비 정산 기한 및 미준수 페널티",
          "비용 분개(프로젝트/부서) 기준",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 140 }),
      updatedAt: isoNowMinus({ days: 40 }),
      archivedAt: isoNowMinus({ days: 40 }),
      activatedAt: isoNowMinus({ days: 138 }),
      reviewRequestedAt: isoNowMinus({ days: 139 }),
      reviewItemId: "rvw-pol-seed-fin-003-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 140 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 139, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 139, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 139 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 138 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 137, hours: 22 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 40 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2Active: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "증빙 예외 케이스 정리 + 전자영수증 허용 범위 확대",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.33),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 12,
        chars: 19680,
        sections: [
          "전자영수증/카드매출전표 증빙 기준",
          "증빙 누락 시 사후 제출 기한(7일)",
          "결재라인(팀장→재무) 예외 규칙",
          "반복 비용(구독/유지보수) 승인 템플릿",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 40 }),
      updatedAt: isoNowMinus({ days: 1 }),
      activatedAt: isoNowMinus({ days: 35 }),
      reviewRequestedAt: isoNowMinus({ days: 36 }),
      reviewItemId: "rvw-pol-seed-fin-003-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 40 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 39, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 39, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 36 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 35 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 35, hours: 20 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v3Deleted: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "정산 위반 페널티 강화(초안) — 보류 후 삭제",
      status: "DELETED",
      fileName: `${documentId}_v3_draft.pdf`,
      fileSizeBytes: bytesMB(0.31),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 11,
        chars: 18810,
        sections: [
          "정산 위반 유형(무증빙/허위/기한초과) 분류",
          "재발 방지 교육/권한 제한(단계적)",
          "프로젝트 비용 집행 상한/예외 승인",
          "내부 감사 요청 시 제출 증적 목록",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 9 }),
      updatedAt: isoNowMinus({ days: 7 }),
      deletedAt: isoNowMinus({ days: 7 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 9 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 8, hours: 21 }, ADMIN, `${documentId}_v3_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 8, hours: 19 }, SYSTEM, "전처리 완료"),
        mkAudit("SOFT_DELETE", { days: 7 }, ADMIN, "우선순위 변경으로 초안 삭제(soft)"),
      ],
    };

    versions.push(v1Archived, v2Active, v3Deleted);
  }

  // =========================================================
  // POL-TRV-008: 출장/여비 규정 — ARCHIVED + ACTIVE + DRAFT
  // =========================================================
  {
    const documentId = "POL-TRV-008";
    const title = "출장/여비 규정";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "출장비 기본(교통/숙박/식비) 기준",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.44),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 14,
        chars: 24120,
        sections: [
          "출장 신청/승인 프로세스",
          "숙박 상한(지역/등급) 기준",
          "식비 정액/실비 기준",
          "렌터카/택시 사용 허용 조건",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 190 }),
      updatedAt: isoNowMinus({ days: 80 }),
      activatedAt: isoNowMinus({ days: 185 }),
      archivedAt: isoNowMinus({ days: 80 }),
      reviewRequestedAt: isoNowMinus({ days: 186 }),
      reviewItemId: "rvw-pol-seed-trv-008-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 190 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 189, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 189, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 186 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 185 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 185, hours: 20 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 80 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2Active: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "항공/숙박 상한 조정 + 야간 이동 예외 규정 추가",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.49),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 16,
        chars: 26640,
        sections: [
          "항공: 이코노미 기본, 야간/긴급 시 예외 승인",
          "숙박 상한 상향(지역별), 성수기 예외 기준",
          "현장 업무(야간) 택시 사용 허용",
          "출장 정산 제출 기한 및 증빙 체크리스트",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 80 }),
      updatedAt: isoNowMinus({ days: 5 }),
      activatedAt: isoNowMinus({ days: 70 }),
      reviewRequestedAt: isoNowMinus({ days: 71 }),
      reviewItemId: "rvw-pol-seed-trv-008-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 80 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 79, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 79, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 71 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 70 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 70, hours: 20 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v3Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "해외 출장 환율/현지 교통비 가이드 보강(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v3_draft.pdf`,
      fileSizeBytes: bytesMB(0.51),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 17,
        chars: 27900,
        sections: [
          "환율 적용 기준(승인일/정산일) 명시",
          "현지 교통비(대중교통/택시) 허용 범위",
          "해외 결제 수수료 처리 기준",
          "현지 영수증 언어/번역 제출 예외 규정",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 2 }),
      updatedAt: isoNowMinus({ hours: 14 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 2 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 1, hours: 20 }, ADMIN, `${documentId}_v3_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 1, hours: 18 }, SYSTEM, "전처리 완료"),
      ],
    };

    versions.push(v1Archived, v2Active, v3Draft);
  }

  // =========================================================
  // POL-PROC-006: 구매/계약 프로세스 — ACTIVE + REJECTED + DRAFT
  // =========================================================
  {
    const documentId = "POL-PROC-006";
    const title = "구매/계약 프로세스";

    const v1Active: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "구매요청/견적/계약/검수 기본 흐름",
      status: "ACTIVE",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.67),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 24,
        chars: 43300,
        sections: [
          "구매요청(PR) → 견적(RFQ) → 발주(PO) 흐름",
          "계약 체결 전 필수 검토(법무/보안/개인정보)",
          "검수(납품 확인) 및 지급 조건",
          "수의계약/긴급구매 예외 절차",
        ],
        notes: ["수의계약 예외 기준(금액/기간) 표준화 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 55 }),
      updatedAt: isoNowMinus({ days: 3 }),
      activatedAt: isoNowMinus({ days: 50 }),
      reviewRequestedAt: isoNowMinus({ days: 51 }),
      reviewItemId: "rvw-pol-seed-proc-006-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 55 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 54, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 54, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 51 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 50 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 50, hours: 20 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v2Rejected: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "협력사 평가 지표 추가(초안)",
      status: "REJECTED",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.69),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 25,
        chars: 45210,
        sections: [
          "협력사 평가 지표(납기/품질/보안) 정의",
          "평가 결과 반영(등급별 계약 조건)",
          "연간 재평가 주기 및 책임자",
          "평가 증적(문서/로그) 보관 기준",
        ],
        notes: ["평가 지표 산식이 모호함(측정 방법/데이터 소스 명시 필요)"],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 20 }),
      updatedAt: isoNowMinus({ days: 16 }),
      reviewRequestedAt: isoNowMinus({ days: 17 }),
      reviewItemId: "rvw-pol-seed-proc-006-v2",
      rejectedAt: isoNowMinus({ days: 16 }),
      rejectReason: "평가 산식/근거 데이터가 부족합니다. 산식과 예시를 추가해주세요.",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 20 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 19, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 19, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 17 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_REJECT", { days: 16 }, REVIEWER, "반려"),
      ],
    };

    const v3Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "평가 지표 산식/예시 추가 + 보안 체크리스트 연결(재작성)",
      status: "DRAFT",
      fileName: `${documentId}_v3_draft.pdf`,
      fileSizeBytes: bytesMB(0.71),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 26,
        chars: 46800,
        sections: [
          "평가 지표 산식(정량/정성) 및 데이터 소스 정의",
          "보안 체크리스트(계정/로그/취약점) 연결",
          "등급별 계약 조건 예시(납기/지급 조건)",
          "평가 이의제기(재검토) 프로세스",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 2, hours: 18 }),
      updatedAt: isoNowMinus({ hours: 9 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 2, hours: 18 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 2, hours: 10 }, ADMIN, `${documentId}_v3_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 2, hours: 8 }, SYSTEM, "전처리 완료"),
      ],
    };

    versions.push(v1Active, v2Rejected, v3Draft);
  }

  // =========================================================
  // POL-IT-009: 계정/접근권한 관리 — ARCHIVED + ACTIVE(인덱싱 실패) + DRAFT
  // =========================================================
  {
    const documentId = "POL-IT-009";
    const title = "계정/접근권한 관리";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "권한 신청/회수 기본 원칙",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.38),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 13,
        chars: 24400,
        sections: [
          "권한 신청(사유/기간) 필수 입력",
          "온보딩/오프보딩 체크리스트",
          "관리자 권한(Privileged) 별도 승인",
          "정기 권한 점검(분기 1회)",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 95 }),
      updatedAt: isoNowMinus({ days: 50 }),
      activatedAt: isoNowMinus({ days: 92 }),
      archivedAt: isoNowMinus({ days: 50 }),
      reviewRequestedAt: isoNowMinus({ days: 93 }),
      reviewItemId: "rvw-pol-seed-it-009-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 95 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 94, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 94, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 93 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 92 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 92, hours: 20 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 50 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2ActiveIndexFail: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "SSO/Keycloak 연동 기준 + 서비스계정 만료 정책 추가",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.41),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 14,
        chars: 26120,
        sections: [
          "SSO(키클록) 기반 역할/스코프 매핑 원칙",
          "서비스계정/봇 계정: 만료일/책임자 필수",
          "권한 변경은 티켓 기반(감사 추적)",
          "긴급 권한 부여: 24시간 자동 만료",
        ],
        notes: ["서비스계정 실사용 점검(30일 미사용 자동 잠금) 추가 고려"],
      }),
      indexingStatus: "FAILED",
      indexingError:
        "인덱싱 실패(500): 문서 파싱 중 오류가 발생했습니다. (첨부 내 표 구조 확인 필요)",
      createdAt: isoNowMinus({ days: 50 }),
      updatedAt: isoNowMinus({ days: 1, hours: 2 }),
      activatedAt: isoNowMinus({ days: 45 }),
      reviewRequestedAt: isoNowMinus({ days: 46 }),
      reviewItemId: "rvw-pol-seed-it-009-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 50 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 49, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 49, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 46 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 45 }, REVIEWER, "승인"),
        mkAudit("INDEX_START", { days: 45, hours: 22 }, SYSTEM, "인덱싱 시작"),
        mkAudit("INDEX_FAIL", { days: 45, hours: 21 }, SYSTEM, "인덱싱 실패"),
      ],
    };

    const v3Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "인덱싱 실패 원인(표/이미지) 보정 + 문서 구조 단순화(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v3_draft.pdf`,
      fileSizeBytes: bytesMB(0.39),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 13,
        chars: 24880,
        sections: [
          "표/이미지 최소화(텍스트 구조화) 가이드",
          "권한 매트릭스(역할→기능) 표준 템플릿",
          "긴급 권한 부여/회수 자동화 절차",
          "감사 로그 필수 필드 정의",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 1, hours: 20 }),
      updatedAt: isoNowMinus({ hours: 12 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 1, hours: 20 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 1, hours: 12 }, ADMIN, `${documentId}_v3_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 1, hours: 10 }, SYSTEM, "전처리 완료"),
      ],
    };

    versions.push(v1Archived, v2ActiveIndexFail, v3Draft);
  }

  // =========================================================
  // POL-SEC-010: 사고 대응(Incident Response) — PENDING_REVIEWER + DRAFT
  // =========================================================
  {
    const documentId = "POL-SEC-010";
    const title = "보안 사고 대응(Incident Response)";

    const v1Pending: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "사고 분류/초동/에스컬레이션 체계 수립",
      status: "PENDING_REVIEWER",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.73),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 20,
        chars: 36810,
        sections: [
          "사고 레벨(L1~L4) 정의 및 대응 목표 시간",
          "초동 대응 체크리스트(격리/증적/커뮤니케이션)",
          "법무/대외 커뮤니케이션 승인 라인",
          "사후 분석(RCA) 템플릿 및 재발 방지",
        ],
        notes: ["L3 이상은 30분 내 CSO/법무 알림(자동)"],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 6 }),
      updatedAt: isoNowMinus({ days: 3 }),
      reviewRequestedAt: isoNowMinus({ days: 3 }),
      reviewItemId: "rvw-pol-seed-sec-010-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 6 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 5, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 5, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 3 }, ADMIN, "검토 요청"),
      ],
    };

    const v2Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "포렌식 증적 범위/보관기간 추가(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v2_draft.pdf`,
      fileSizeBytes: bytesMB(0.76),
      preprocessStatus: "IDLE",
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 1, hours: 8 }),
      updatedAt: isoNowMinus({ hours: 3 }),
      audit: [mkAudit("CREATE_DRAFT", { days: 1, hours: 8 }, ADMIN, "v2 초안 생성")],
    };

    versions.push(v1Pending, v2Draft);
  }

  // =========================================================
  // POL-OPS-011: 문서/기록 보존 및 폐기 — ACTIVE + DRAFT
  // =========================================================
  {
    const documentId = "POL-OPS-011";
    const title = "문서/기록 보존 및 폐기";

    const v1Active: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "기록 보존 등급/기간 및 파기 절차",
      status: "ACTIVE",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.58),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 18,
        chars: 33200,
        sections: [
          "보존 등급(핵심/중요/일반) 정의",
          "보존 기간 매트릭스(법정/내규/계약)",
          "파기 승인/집행/증적 보관 절차",
          "전자문서/메일/채팅 기록 포함 범위",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 35 }),
      updatedAt: isoNowMinus({ days: 2 }),
      activatedAt: isoNowMinus({ days: 30 }),
      reviewRequestedAt: isoNowMinus({ days: 31 }),
      reviewItemId: "rvw-pol-seed-ops-011-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 35 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 34, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 34, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 31 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 30 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 30, hours: 20 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v2Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "채팅/회의록 보존 범위 상세화(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v2_draft.pdf`,
      fileSizeBytes: bytesMB(0.60),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 19,
        chars: 34880,
        sections: [
          "회의록/결재 기록 보존 기준(프로젝트 종료 후 N년)",
          "사내 메신저/채팅 로그 보존 범위 및 접근권한",
          "민감 문서(인사/재무) 별도 보관소 정책",
          "파기 요청 시 법무/감사 동시 검토 프로세스",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 2, hours: 12 }),
      updatedAt: isoNowMinus({ hours: 7 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 2, hours: 12 }, ADMIN, "v2 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 2, hours: 6 }, ADMIN, `${documentId}_v2_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 2, hours: 4 }, SYSTEM, "전처리 완료"),
      ],
    };

    versions.push(v1Active, v2Draft);
  }

  // =========================================================
  // POL-DEV-012: 개발/배포 표준 — ARCHIVED + ACTIVE + DRAFT(전처리 실패)
  // =========================================================
  {
    const documentId = "POL-DEV-012";
    const title = "개발/배포 표준";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "초기 표준(브랜치/릴리즈/코드리뷰)",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.46),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 16,
        chars: 28300,
        sections: [
          "브랜치 전략(main/develop/feature/hotfix)",
          "PR 리뷰 규칙(2인 승인, CI 통과 필수)",
          "릴리즈 태깅/체인지로그 작성",
          "긴급 배포(Hotfix) 승인/회귀 테스트",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 125 }),
      updatedAt: isoNowMinus({ days: 60 }),
      activatedAt: isoNowMinus({ days: 120 }),
      archivedAt: isoNowMinus({ days: 60 }),
      reviewRequestedAt: isoNowMinus({ days: 121 }),
      reviewItemId: "rvw-pol-seed-dev-012-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 125 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 124, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 124, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 121 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 120 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 120, hours: 20 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 60 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2Active: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "보안 린트/취약점 스캔 게이트 추가 + 배포 승인 분리",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.52),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 18,
        chars: 31150,
        sections: [
          "SAST/Dependency Scan 실패 시 머지 차단",
          "배포 승인: Creator/Reviewer SoD 원칙 준수",
          "릴리즈 노트 자동 생성 규칙(템플릿)",
          "장애 시 롤백/롤포워드 판단 기준",
        ],
        notes: ["CI 파이프라인 ‘필수 체크’ 목록 UI 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 60 }),
      updatedAt: isoNowMinus({ days: 2 }),
      activatedAt: isoNowMinus({ days: 55 }),
      reviewRequestedAt: isoNowMinus({ days: 56 }),
      reviewItemId: "rvw-pol-seed-dev-012-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 60 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 59, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 59, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 56 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 55 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 55, hours: 20 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v3DraftPreprocessFail: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "문서 템플릿 교체(표/이미지 포함) — 전처리 실패 케이스(샘플)",
      status: "DRAFT",
      fileName: `${documentId}_v3_draft_fail.pdf`,
      fileSizeBytes: bytesMB(0.57),
      preprocessStatus: "FAILED",
      preprocessError:
        "전처리 실패: 텍스트 추출에 실패했습니다. (암호화 PDF/스캔본 여부 확인 필요)",
      preprocessPreview: undefined,
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 3 }),
      updatedAt: isoNowMinus({ days: 2, hours: 8 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 3 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 2, hours: 22 }, ADMIN, `${documentId}_v3_draft_fail.pdf`),
        mkAudit("PREPROCESS_START", { days: 2, hours: 12 }, ADMIN, "전처리 시작"),
        mkAudit("PREPROCESS_FAIL", { days: 2, hours: 8 }, SYSTEM, "전처리 실패"),
      ],
    };

    versions.push(v1Archived, v2Active, v3DraftPreprocessFail);
  }

  // =====================================================================
  // 아래부터 “데이터 밀도 증가” 추가 세트 (총 20문서 / 55버전 수준)
  // =====================================================================

  // =========================================================
  // POL-LEGAL-013: 법무/컴플라이언스 가이드 — ARCHIVED + ACTIVE + DRAFT
  // =========================================================
  {
    const documentId = "POL-LEGAL-013";
    const title = "법무/컴플라이언스 가이드";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "초기 등록(계약/분쟁/표준 조항)",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.74),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 28,
        chars: 49800,
        sections: [
          "표준 계약 조항(비밀유지/책임 제한/준거법) 가이드",
          "계약 체결 전 체크리스트(개인정보/보안/수출규제)",
          "분쟁 발생 시 커뮤니케이션/증적 보관 원칙",
          "법무 검토 SLA 및 긴급 처리 프로세스",
        ],
        notes: ["계약 템플릿(서비스/구매/위탁) 링크 구조 통일 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 240 }),
      updatedAt: isoNowMinus({ days: 140 }),
      activatedAt: isoNowMinus({ days: 235 }),
      archivedAt: isoNowMinus({ days: 140 }),
      reviewRequestedAt: isoNowMinus({ days: 236 }),
      reviewItemId: "rvw-pol-seed-legal-013-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 240 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 239, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 239, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 236 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 235 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 235, hours: 18 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 140 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2Active: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "대외 공지/표준 문구(Disclaimer) 및 위반 대응 절차 보강",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.82),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 30,
        chars: 52210,
        sections: [
          "대외 커뮤니케이션 표준 문구(홍보/PR/공지) 템플릿",
          "컴플라이언스 위반 신고/조사/징계 프로세스(요약)",
          "수출통제/제재 대상 거래 스크리닝 기준(기본)",
          "자료 제출 요청(감사/수사) 대응 시 보안 원칙",
        ],
        notes: ["‘자료제출’ 요청은 법무 승인 후 진행(로그 필수)"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 140 }),
      updatedAt: isoNowMinus({ days: 3 }),
      activatedAt: isoNowMinus({ days: 25 }),
      reviewRequestedAt: isoNowMinus({ days: 26 }),
      reviewItemId: "rvw-pol-seed-legal-013-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 140 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 139, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 139, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 26 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 25 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 25, hours: 20 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v3Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "AI/자동화 계약 조항(데이터 사용/저작권) 추가(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v3_draft.pdf`,
      fileSizeBytes: bytesMB(0.86),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 32,
        chars: 54480,
        sections: [
          "AI/자동화 기능 포함 계약 시 데이터 사용 범위 조항",
          "저작권/라이선스(오픈소스/콘텐츠) 체크리스트",
          "데이터 보관/파기 및 국외 이전 문구 샘플",
          "분쟁 발생 시 책임 분담(사업/법무/보안) R&R",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 2, hours: 22 }),
      updatedAt: isoNowMinus({ hours: 8 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 2, hours: 22 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 2, hours: 10 }, ADMIN, `${documentId}_v3_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 2, hours: 8 }, SYSTEM, "전처리 완료"),
      ],
    };

    versions.push(v1Archived, v2Active, v3Draft);
  }

  // =========================================================
  // POL-INFO-014: 정보자산 분류/취급 기준 — ARCHIVED + ACTIVE + PENDING_REVIEWER
  // =========================================================
  {
    const documentId = "POL-INFO-014";
    const title = "정보자산 분류/취급 기준";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "초기 등록(자산 분류/라벨링/반출 원칙)",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.66),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 21,
        chars: 38710,
        sections: [
          "자산 등급(공개/내부/기밀/극비) 정의",
          "문서 라벨링 및 공유 범위(외부 공유 금지 기준)",
          "반출 승인(사유/기간/회수) 체크리스트",
          "저장소 정책(공유드라이브/개인PC/USB 금지)",
        ],
        notes: ["‘극비’ 등급은 접근권한/로그 기준 별도 표 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 200 }),
      updatedAt: isoNowMinus({ days: 95 }),
      activatedAt: isoNowMinus({ days: 195 }),
      archivedAt: isoNowMinus({ days: 95 }),
      reviewRequestedAt: isoNowMinus({ days: 196 }),
      reviewItemId: "rvw-pol-seed-info-014-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 200 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 199, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 199, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 196 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 195 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 195, hours: 20 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 95 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2Active: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "분류 자동화(템플릿) + 다운로드 제한 정책 추가",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.71),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 23,
        chars: 41220,
        sections: [
          "문서 템플릿 기반 자동 라벨(부서/프로젝트/등급)",
          "다운로드 제한(기밀 이상: 승인 필요) 및 워터마크",
          "외부 전송(메일/메신저) 정책 및 DLP 연계",
          "보안 위반 시 조치(경고→권한 제한→감사 요청)",
        ],
        notes: ["워터마크 규칙(문서ID/사용자/시간) 고정 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 95 }),
      updatedAt: isoNowMinus({ days: 4 }),
      activatedAt: isoNowMinus({ days: 45 }),
      reviewRequestedAt: isoNowMinus({ days: 46 }),
      reviewItemId: "rvw-pol-seed-info-014-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 95 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 94, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 94, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 46 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 45 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 45, hours: 21 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v3Pending: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "외부 협업(협력사) 공유 폴더 정책/만료 규칙 추가",
      status: "PENDING_REVIEWER",
      fileName: `${documentId}_v3.pdf`,
      fileSizeBytes: bytesMB(0.76),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 24,
        chars: 42610,
        sections: [
          "협력사 공유폴더: 기간 기반 만료(기본 30일) + 갱신 승인",
          "공유 권한: 최소권한(읽기 기본), 다운로드 제한 정책",
          "공유 이벤트 감사 로그(열람/다운로드/삭제) 필수",
          "계정 종료 시 공유 링크 자동 폐기(배치)",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 5, hours: 2 }),
      updatedAt: isoNowMinus({ days: 1, hours: 12 }),
      reviewRequestedAt: isoNowMinus({ days: 1, hours: 12 }),
      reviewItemId: "rvw-pol-seed-info-014-v3",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 5, hours: 2 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 4, hours: 18 }, ADMIN, `${documentId}_v3.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 4, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 1, hours: 12 }, ADMIN, "검토 요청"),
      ],
    };

    versions.push(v1Archived, v2Active, v3Pending);
  }

  // =========================================================
  // POL-EDU-015: 교육/퀴즈 운영 정책 — ACTIVE + DRAFT(전처리 진행중)
  // =========================================================
  {
    const documentId = "POL-EDU-015";
    const title = "교육/퀴즈 운영 정책";

    const v1Active: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "필수교육 운영(수강/평가/이수증) 기본 원칙",
      status: "ACTIVE",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.59),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 19,
        chars: 35220,
        sections: [
          "필수교육 지정/배포(연 1회) 및 대상자 산정",
          "퀴즈 난이도/문항 품질 기준(오답률/변별도)",
          "미이수자 리마인드(자동) 및 제한 정책",
          "이수 기록/증적 보관 기간 및 관리자 권한",
        ],
        notes: ["진도율 계산 기준(재생시간/구간) 정의를 문서에 명시"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 48 }),
      updatedAt: isoNowMinus({ days: 2 }),
      activatedAt: isoNowMinus({ days: 40 }),
      reviewRequestedAt: isoNowMinus({ days: 41 }),
      reviewItemId: "rvw-pol-seed-edu-015-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 48 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 47, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 47, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 41 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 40 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 40, hours: 20 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v2DraftProcessing: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "퀴즈 리포트(오답 분석/재학습) 및 배포 캘린더 추가(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v2_draft.pdf`,
      fileSizeBytes: bytesMB(0.63),
      preprocessStatus: "PROCESSING",
      preprocessPreview: undefined,
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 1, hours: 18 }),
      updatedAt: isoNowMinus({ hours: 2, minutes: 30 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 1, hours: 18 }, ADMIN, "v2 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 1, hours: 10 }, ADMIN, `${documentId}_v2_draft.pdf`),
        mkAudit("PREPROCESS_START", { hours: 2, minutes: 30 }, ADMIN, "전처리 시작(진행중)"),
      ],
    };

    versions.push(v1Active, v2DraftProcessing);
  }

  // =========================================================
  // POL-REMOTE-016: 재택/원격근무 운영 기준 — ACTIVE + PENDING_REVIEWER
  // =========================================================
  {
    const documentId = "POL-REMOTE-016";
    const title = "재택/원격근무 운영 기준";

    const v1Active: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "원격근무 신청/승인/보안 준수 기본 규정",
      status: "ACTIVE",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.47),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 16,
        chars: 29510,
        sections: [
          "원격근무 가능 직무/기간 기준 및 승인 책임",
          "근태 기록(시작/종료) 및 회의/응답 SLA",
          "원격 접속(VDI/VPN) 의무 및 단말 보안",
          "보안 위반(공유기/공용PC/스크린샷) 금지 항목",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 62 }),
      updatedAt: isoNowMinus({ days: 1, hours: 10 }),
      activatedAt: isoNowMinus({ days: 58 }),
      reviewRequestedAt: isoNowMinus({ days: 59 }),
      reviewItemId: "rvw-pol-seed-remote-016-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 62 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 61, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 61, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 59 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 58 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 58, hours: 21 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v2Pending: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "해외 원격근무 예외 승인 + 시간대/접속 제한 추가",
      status: "PENDING_REVIEWER",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.53),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 18,
        chars: 32240,
        sections: [
          "해외 원격근무: 사전 승인(법무/보안) 및 기간 제한",
          "접속 허용 국가/시간대 정책(위반 시 차단)",
          "업무 자료 저장 위치(암호화 드라이브) 강제",
          "응급상황(접속 불가) 대체 커뮤니케이션 채널",
        ],
        notes: ["국가 목록은 분기별 업데이트(보안팀 승인)"],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 5, hours: 12 }),
      updatedAt: isoNowMinus({ days: 2 }),
      reviewRequestedAt: isoNowMinus({ days: 2 }),
      reviewItemId: "rvw-pol-seed-remote-016-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 5, hours: 12 }, ADMIN, "v2 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 5, hours: 2 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 5 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 2 }, ADMIN, "검토 요청"),
      ],
    };

    versions.push(v1Active, v2Pending);
  }

  // =========================================================
  // POL-RET-017: 퇴직/오프보딩 체크리스트 — ACTIVE + DRAFT
  // =========================================================
  {
    const documentId = "POL-RET-017";
    const title = "퇴직/오프보딩 체크리스트";

    const v1Active: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "오프보딩(계정/자산/자료) 표준 절차",
      status: "ACTIVE",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.39),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 14,
        chars: 25840,
        sections: [
          "퇴직 확정 → 권한 회수 일정(T-7/T-1/T) 정의",
          "자산 반납(노트북/출입증) 및 서명 절차",
          "공유 계정/서비스 계정 인수인계 원칙",
          "데이터 반출/삭제 이슈 발생 시 감사 요청",
        ],
        notes: ["결재/문서 소유권 이전(팀장/PM) 절차 예시 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 44 }),
      updatedAt: isoNowMinus({ days: 3 }),
      activatedAt: isoNowMinus({ days: 38 }),
      reviewRequestedAt: isoNowMinus({ days: 39 }),
      reviewItemId: "rvw-pol-seed-ret-017-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 44 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 43, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 43, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 39 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 38 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 38, hours: 20 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v2Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "프로젝트별 인수인계(리포지토리/키/토큰) 체크 항목 확장(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v2_draft.pdf`,
      fileSizeBytes: bytesMB(0.42),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 15,
        chars: 27460,
        sections: [
          "Git 리포지토리 권한/소유자 이전 절차",
          "비밀키/토큰 회수(키보관소/CI 변수) 체크리스트",
          "고객/협력사 커뮤니케이션 담당자 인계",
          "퇴직 당일 접근 차단 확인(로그/알림) 증적",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 2, hours: 6 }),
      updatedAt: isoNowMinus({ hours: 9 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 2, hours: 6 }, ADMIN, "v2 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 2 }, ADMIN, `${documentId}_v2_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 1, hours: 22 }, SYSTEM, "전처리 완료"),
      ],
    };

    versions.push(v1Active, v2Draft);
  }

  // =========================================================
  // POL-RISK-018: 리스크 관리/내부통제 기준 — ARCHIVED + ACTIVE + REJECTED
  // =========================================================
  {
    const documentId = "POL-RISK-018";
    const title = "리스크 관리/내부통제 기준";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "초기 등록(리스크 분류/평가/대응 기본)",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.64),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 22,
        chars: 40210,
        sections: [
          "리스크 분류(전략/운영/보안/법무/재무) 정의",
          "평가 기준(영향도/가능성) 및 등급 산정",
          "대응 전략(회피/완화/전가/수용) 템플릿",
          "월간 리스크 리뷰(위원회) 운영 원칙",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 180 }),
      updatedAt: isoNowMinus({ days: 90 }),
      activatedAt: isoNowMinus({ days: 175 }),
      archivedAt: isoNowMinus({ days: 90 }),
      reviewRequestedAt: isoNowMinus({ days: 176 }),
      reviewItemId: "rvw-pol-seed-risk-018-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 180 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 179, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 179, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 176 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 175 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 175, hours: 20 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 90 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2Active: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "KRI(핵심 리스크 지표) 및 담당자 R&R 추가",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.71),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 24,
        chars: 43100,
        sections: [
          "KRI 정의(지표/임계치/알림) 및 운영 주기",
          "리스크 오너/컨트롤 오너 역할 분리(SoD)",
          "이슈 트래킹(티켓) 연동 및 증적 첨부 기준",
          "분기별 내부감사 샘플링 룰(우선순위 기반)",
        ],
        notes: ["KRI 알림은 Slack/메일/대시보드 동시 노출(중복 방지)"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 90 }),
      updatedAt: isoNowMinus({ days: 2 }),
      activatedAt: isoNowMinus({ days: 35 }),
      reviewRequestedAt: isoNowMinus({ days: 36 }),
      reviewItemId: "rvw-pol-seed-risk-018-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 90 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 89, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 89, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 36 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 35 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 35, hours: 21 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v3Rejected: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "전사 리스크 점수 자동 산정 로직 도입(초안)",
      status: "REJECTED",
      fileName: `${documentId}_v3.pdf`,
      fileSizeBytes: bytesMB(0.73),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 25,
        chars: 44880,
        sections: [
          "자동 산정 로직(가중치) 정의 및 근거 데이터 명시",
          "모델 변경(가중치 변경) 시 승인 프로세스",
          "오탐/미탐 대응(수동 조정) 기준 및 로그",
          "월간 리포트: Top 리스크/완화 진행률 표준",
        ],
        notes: ["가중치 근거 데이터(기간/표본) 정의가 필요"],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 18 }),
      updatedAt: isoNowMinus({ days: 15 }),
      reviewRequestedAt: isoNowMinus({ days: 16 }),
      reviewItemId: "rvw-pol-seed-risk-018-v3",
      rejectedAt: isoNowMinus({ days: 15 }),
      rejectReason: "가중치/근거 데이터 정의가 부족합니다. 산정 예시와 검증 방법을 추가해주세요.",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 18 }, ADMIN, "v3 생성"),
        mkAudit("UPLOAD_FILE", { days: 17, hours: 18 }, ADMIN, `${documentId}_v3.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 17, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 16 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_REJECT", { days: 15 }, REVIEWER, "반려"),
      ],
    };

    versions.push(v1Archived, v2Active, v3Rejected);
  }

  // =========================================================
  // POL-AI-019: 생성형 AI 사용 가이드라인 — ACTIVE + DRAFT + PENDING_REVIEWER
  // =========================================================
  {
    const documentId = "POL-AI-019";
    const title = "생성형 AI 사용 가이드라인";

    const v1Active: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "사내 AI 사용 범위/금지 항목/로그 정책 기본",
      status: "ACTIVE",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.68),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 22,
        chars: 40500,
        sections: [
          "금지 입력: 개인정보/기밀/소스코드(승인 없는 외부 전송 금지)",
          "허용 사용: 요약/초안/아이디어/번역(검토 필수)",
          "프롬프트/응답 로그 보관 및 마스킹 기준",
          "업무 적용 시 책임(검토자/승인자) 및 사고 대응",
        ],
        notes: ["‘외부 LLM’ 사용은 승인된 도메인/계정만 허용"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 32 }),
      updatedAt: isoNowMinus({ days: 1, hours: 6 }),
      activatedAt: isoNowMinus({ days: 28 }),
      reviewRequestedAt: isoNowMinus({ days: 29 }),
      reviewItemId: "rvw-pol-seed-ai-019-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 32 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 31, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 31, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 29 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 28 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 28, hours: 21 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    const v2Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "RAG/내부 문서 인용 규칙 + 출처 표기 템플릿 추가(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v2_draft.pdf`,
      fileSizeBytes: bytesMB(0.72),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 24,
        chars: 43280,
        sections: [
          "내부 문서 인용: 문서ID/버전/발췌 구간 표기 원칙",
          "출처 표기 템플릿(보고서/공지/회의록) 제공",
          "근거 부족 시 표현 가이드(추정/가정/추가 확인 필요)",
          "감사 로그: 근거 문서 조회 이력 포함",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 3, hours: 6 }),
      updatedAt: isoNowMinus({ hours: 11 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 3, hours: 6 }, ADMIN, "v2 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 3 }, ADMIN, `${documentId}_v2_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 2, hours: 22 }, SYSTEM, "전처리 완료"),
      ],
    };

    const v3Pending: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "개발자 모드(코드/시크릿) 안전가드 및 예외 승인 기준 추가",
      status: "PENDING_REVIEWER",
      fileName: `${documentId}_v3.pdf`,
      fileSizeBytes: bytesMB(0.75),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 25,
        chars: 44610,
        sections: [
          "시크릿/토큰/키 입력 차단(정규식/스캐너) 및 예외 승인 절차",
          "코드 생성 시 라이선스/저작권 주의 문구(필수)",
          "LLM 응답 검증(테스트/리뷰) 체크리스트",
          "위반 탐지 시 알림/차단/사후 교육 프로세스",
        ],
        notes: ["예외 승인은 만료일 필수 + 사유 템플릿 적용"],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 6, hours: 10 }),
      updatedAt: isoNowMinus({ days: 2, hours: 6 }),
      reviewRequestedAt: isoNowMinus({ days: 2, hours: 6 }),
      reviewItemId: "rvw-pol-seed-ai-019-v3",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 6, hours: 10 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 6 }, ADMIN, `${documentId}_v3.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 5, hours: 22 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 2, hours: 6 }, ADMIN, "검토 요청"),
      ],
    };

    versions.push(v1Active, v2Draft, v3Pending);
  }

  // =========================================================
  // POL-NET-020: 네트워크/방화벽 운영 기준 — ARCHIVED + ACTIVE(인덱싱 실패) + DRAFT
  // =========================================================
  {
    const documentId = "POL-NET-020";
    const title = "네트워크/방화벽 운영 기준";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "방화벽 정책 요청/승인/배포 기본 프로세스",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.53),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 18,
        chars: 33400,
        sections: [
          "정책 변경 요청서 필수 항목(출발지/목적지/포트/기간)",
          "정책 승인 라인(보안→네트워크→서비스 오너)",
          "배포 윈도우/롤백 플랜 및 사전 검증",
          "정책 만료/정리(주기) 및 감사 로그",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 150 }),
      updatedAt: isoNowMinus({ days: 70 }),
      activatedAt: isoNowMinus({ days: 145 }),
      archivedAt: isoNowMinus({ days: 70 }),
      reviewRequestedAt: isoNowMinus({ days: 146 }),
      reviewItemId: "rvw-pol-seed-net-020-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 150 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 149, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 149, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 146 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 145 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 145, hours: 21 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 70 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2ActiveIndexFail: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "정책 만료 자동화 + 예외 포트(관리) 통제 강화",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.58),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 20,
        chars: 36200,
        sections: [
          "정책 만료일 필수(기본 30일), 자동 연장 금지",
          "관리 포트(SSH/RDP) 예외 허용 조건(승인/기간/로그)",
          "정책 정리(Expired) 배치 및 영향도 리포트",
          "인시던트 발생 시 네트워크 차단(긴급) 절차",
        ],
        notes: ["표(포트 매트릭스) 구조 단순화 권장(인덱싱 이슈 회피)"],
      }),
      indexingStatus: "FAILED",
      indexingError:
        "인덱싱 실패(500): 표 구조/특수문자 처리 중 오류가 발생했습니다. (포트 매트릭스 표 분리 권장)",
      createdAt: isoNowMinus({ days: 70 }),
      updatedAt: isoNowMinus({ days: 1, hours: 1 }),
      activatedAt: isoNowMinus({ days: 60 }),
      reviewRequestedAt: isoNowMinus({ days: 61 }),
      reviewItemId: "rvw-pol-seed-net-020-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 70 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 69, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 69, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 61 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 60 }, REVIEWER, "승인"),
        mkAudit("INDEX_START", { days: 60, hours: 22 }, SYSTEM, "인덱싱 시작"),
        mkAudit("INDEX_FAIL", { days: 60, hours: 21 }, SYSTEM, "인덱싱 실패"),
      ],
    };

    const v3Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "인덱싱 안정화(표 분리/텍스트화) 및 예외 승인 UI 기준 추가(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v3_draft.pdf`,
      fileSizeBytes: bytesMB(0.56),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 19,
        chars: 35180,
        sections: [
          "포트 매트릭스 표 분리(부록) + 본문은 텍스트 중심",
          "예외 승인 UI: 만료일/사유/승인자/로그링크 필수",
          "정책 변경 알림(영향 서비스/담당자) 자동 생성",
          "정책 감사 리포트(만료 임박/장기 예외) 템플릿",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 2, hours: 20 }),
      updatedAt: isoNowMinus({ hours: 13 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 2, hours: 20 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 2, hours: 12 }, ADMIN, `${documentId}_v3_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 2, hours: 10 }, SYSTEM, "전처리 완료"),
      ],
    };

    versions.push(v1Archived, v2ActiveIndexFail, v3Draft);
  }

  // =========================================================
  // POL-BCP-021: 재해복구/BCP — PENDING_REVIEWER + DRAFT + ARCHIVED
  // =========================================================
  {
    const documentId = "POL-BCP-021";
    const title = "재해복구/BCP(업무연속성)";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "초기 등록(RTO/RPO 및 복구 훈련 기본)",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.77),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 26,
        chars: 48620,
        sections: [
          "서비스 등급별 RTO/RPO 정의(핵심/중요/일반)",
          "DR(재해복구) 훈련 연 2회 원칙 및 체크리스트",
          "백업/복구 절차(권한/승인/로그) 표준",
          "사고 시 의사결정(워룸) 및 커뮤니케이션 템플릿",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 220 }),
      updatedAt: isoNowMinus({ days: 110 }),
      activatedAt: isoNowMinus({ days: 215 }),
      archivedAt: isoNowMinus({ days: 110 }),
      reviewRequestedAt: isoNowMinus({ days: 216 }),
      reviewItemId: "rvw-pol-seed-bcp-021-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 220 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 219, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 219, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 216 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 215 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 215, hours: 20 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 110 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2Pending: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "클라우드 기반 DR 시나리오 + 장애 등급별 대응표 추가",
      status: "PENDING_REVIEWER",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.84),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 28,
        chars: 51240,
        sections: [
          "클라우드 DR: 리전 장애/가용영역 장애 시나리오 정의",
          "장애 등급(L1~L4)별 의사결정/복구 목표 시간표",
          "복구 테스트 결과 리포트(표준) 및 개선 과제 관리",
          "연락망(비상 연락/대체 채널) 최신화 주기",
        ],
        notes: ["연락망은 분기 1회 자동 검증(반송/미응답 체크)"],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 12 }),
      updatedAt: isoNowMinus({ days: 6 }),
      reviewRequestedAt: isoNowMinus({ days: 6 }),
      reviewItemId: "rvw-pol-seed-bcp-021-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 12 }, ADMIN, "v2 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 11, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 11, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 6 }, ADMIN, "검토 요청"),
      ],
    };

    const v3Draft: PolicyDocVersion = {
      id: `pol-${documentId}-v3`,
      documentId,
      title,
      version: 3,
      changeSummary: "훈련 자동화(런북) + 복구 권한 분리(SoD) 보강(초안)",
      status: "DRAFT",
      fileName: `${documentId}_v3_draft.pdf`,
      fileSizeBytes: bytesMB(0.88),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 3,
        pages: 29,
        chars: 52880,
        sections: [
          "런북(Runbook) 자동 실행/검증 및 실패 시 롤백 규칙",
          "복구 권한: 운영/보안/감사 분리(승인 로그 필수)",
          "복구 후 데이터 정합성 검증(체크섬/샘플링) 가이드",
          "훈련 결과 KPI(복구시간/성공률) 대시보드 표준",
        ],
      }),
      indexingStatus: "IDLE",
      createdAt: isoNowMinus({ days: 2, hours: 16 }),
      updatedAt: isoNowMinus({ hours: 6 }),
      audit: [
        mkAudit("CREATE_DRAFT", { days: 2, hours: 16 }, ADMIN, "v3 초안 생성"),
        mkAudit("UPLOAD_FILE", { days: 2, hours: 8 }, ADMIN, `${documentId}_v3_draft.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 2, hours: 6 }, SYSTEM, "전처리 완료"),
      ],
    };

    versions.push(v1Archived, v2Pending, v3Draft);
  }

  // =========================================================
  // POL-ETH-022: 윤리/반부패 정책 — ARCHIVED + ACTIVE
  // =========================================================
  {
    const documentId = "POL-ETH-022";
    const title = "윤리/반부패 정책";

    const v1Archived: PolicyDocVersion = {
      id: `pol-${documentId}-v1`,
      documentId,
      title,
      version: 1,
      changeSummary: "초기 등록(선물/접대/이해상충 기본 원칙)",
      status: "ARCHIVED",
      fileName: `${documentId}_v1.pdf`,
      fileSizeBytes: bytesMB(0.45),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 1,
        pages: 17,
        chars: 30640,
        sections: [
          "이해상충(겸직/친족/투자) 신고 원칙",
          "선물/접대 수수 한도 및 신고 절차",
          "부정청탁/리베이트 금지 및 위반 조치",
          "익명 제보 채널 및 조사 절차(요약)",
        ],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 170 }),
      updatedAt: isoNowMinus({ days: 75 }),
      activatedAt: isoNowMinus({ days: 165 }),
      archivedAt: isoNowMinus({ days: 75 }),
      reviewRequestedAt: isoNowMinus({ days: 166 }),
      reviewItemId: "rvw-pol-seed-eth-022-v1",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 170 }, ADMIN, "v1 생성"),
        mkAudit("UPLOAD_FILE", { days: 169, hours: 18 }, ADMIN, `${documentId}_v1.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 169, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 166 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 165 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 165, hours: 21 }, SYSTEM, "인덱싱 완료"),
        mkAudit("ROLLBACK", { days: 75 }, SYSTEM, "v2 적용으로 ARCHIVED 전환"),
      ],
    };

    const v2Active: PolicyDocVersion = {
      id: `pol-${documentId}-v2`,
      documentId,
      title,
      version: 2,
      changeSummary: "이해상충 신고 범위 확장 + 협력사 윤리 준수 서약 절차 추가",
      status: "ACTIVE",
      fileName: `${documentId}_v2.pdf`,
      fileSizeBytes: bytesMB(0.52),
      preprocessStatus: "READY",
      preprocessPreview: mkPreview({
        documentId,
        title,
        version: 2,
        pages: 19,
        chars: 33410,
        sections: [
          "이해상충 신고 대상 확대(자문/외부 강의/자산 보유)",
          "협력사 윤리 준수 서약(계약 시 필수) 및 증적 관리",
          "위반 조사 단계(접수→예비검토→본조사→조치) 표준",
          "교육/서약 미이행 시 거래 제한(예외 승인 포함)",
        ],
        notes: ["서약서 템플릿 버전 관리(문서ID/버전) 강제 필요"],
      }),
      indexingStatus: "DONE",
      createdAt: isoNowMinus({ days: 75 }),
      updatedAt: isoNowMinus({ days: 1 }),
      activatedAt: isoNowMinus({ days: 18 }),
      reviewRequestedAt: isoNowMinus({ days: 19 }),
      reviewItemId: "rvw-pol-seed-eth-022-v2",
      audit: [
        mkAudit("CREATE_DRAFT", { days: 75 }, ADMIN, "v2 생성"),
        mkAudit("UPLOAD_FILE", { days: 74, hours: 18 }, ADMIN, `${documentId}_v2.pdf`),
        mkAudit("PREPROCESS_DONE", { days: 74, hours: 16 }, SYSTEM, "전처리 완료"),
        mkAudit("SUBMIT_REVIEW", { days: 19 }, ADMIN, "검토 요청"),
        mkAudit("REVIEW_APPROVE", { days: 18 }, REVIEWER, "승인"),
        mkAudit("INDEX_DONE", { days: 18, hours: 21 }, SYSTEM, "인덱싱 완료"),
      ],
    };

    versions.push(v1Archived, v2Active);
  }

  // 최종 반환 (store에서 정렬/그룹핑 처리)
  return versions;
}
