// src/components/chatbot/ChatWindow.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import robotIcon from "../../assets/robot.png";
import quizIcon from "../../assets/quiz.png";
import eduIcon from "../../assets/edu.png";
import adminIcon from "../../assets/admin-dashboard.png";
import reviewIcon from "../../assets/review.png";
import studioIcon from "../../assets/create.png";

// 액션 아이콘
import retryIcon from "../../assets/chat-retry.png"; // 다시 시도 아이콘

// 피드백(좋아요/별로예요) 아이콘
import feedbackGoodIcon from "../../assets/chat-good.png"; // 좋은 응답 아이콘
import feedbackBadIcon from "../../assets/chat-bad.png"; // 별로예요 아이콘

import type {
  ChatDomain,
  ChatSession,
  FeedbackValue,
  ReportPayload,
  ChatServiceDomain,
  FaqHomeItem,
  FaqItem,
} from "../../types/chat";
import { can, getChatHeaderTitle, type UserRole } from "../../auth/roles";

interface ChatWindowProps {
  activeSession: ChatSession | null;
  onSendMessage: (text: string) => void;
  isSending: boolean;
  onChangeDomain: (domain: ChatDomain) => void;
  onOpenEduPanel?: () => void;
  onOpenQuizPanel?: () => void;
  onOpenAdminPanel?: () => void;

  // FAQ: API 기반 (home + top10)
  faqHomeItems?: FaqHomeItem[];
  isFaqHomeLoading?: boolean;
  onRequestFaqTop10?: (domain: ChatServiceDomain) => Promise<FaqItem[]>;

  // FAQ 추천 클릭 → 같은 세션에 Q/A 추가 (ChatbotApp에서 처리)
  onFaqQuickSend?: (faqKey: number | string) => void;

  // 답변 기준 다시 시도 버튼
  onRetryFromMessage?: (
    sourceQuestion: string,
    mode: "retry" | "variant"
  ) => void;

  // 피드백 업데이트 콜백 (세션 상태 업데이트는 상위에서)
  onFeedbackChange?: (messageId: string, value: FeedbackValue) => void;

  // 피드백 요청 중인 메시지 ID Set (in-flight 차단용)
  feedbackLoadingIds?: Set<string>;

  // 다시시도 요청 중인 메시지 ID (in-flight 차단용)
  retryLoadingMessageId?: string | null;

  // 신고 모달에서 제출 시
  onReportSubmit?: (payload: ReportPayload) => void;

  // 사용자 Role (관리자 전용 뷰 등 확장용)
  userRole: UserRole;

  onOpenReviewerPanel?: () => void;
  onOpenCreatorPanel?: () => void;
}

// UI에서 사용하는 메시지 타입
interface UiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // 신고 안내/접수 말풍선 같은 특수 메시지 구분용
  kind?: "normal" | "reportSuggestion" | "reportReceipt";
  // 피드백 (좋아요/별로예요)
  feedback?: FeedbackValue;
  // 서버 메시지 UUID (피드백/재시도에 필요)
  serverId?: string;
}

type FaqFilterDomain = ChatServiceDomain | null; // null = HOME(추천)

function toUpperKey(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

function normalizeFaqKey(v: string | number): string | number {
  const s = String(v ?? "").trim();
  if (!s) return s;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

/** ===== FAQ HOME 정규화 ===== */
function getFaqHomeLabel(it: FaqHomeItem): string {
  const rec = it as unknown as Record<string, unknown>;
  const candidates = ["label", "title", "question", "q"];
  for (const k of candidates) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "FAQ";
}

function getFaqHomeId(it: FaqHomeItem): string | null {
  const rec = it as unknown as Record<string, unknown>;
  const v = rec["faqId"] ?? rec["id"] ?? rec["key"];
  const s =
    typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return s ? s : null;
}

function getFaqHomeDomain(it: FaqHomeItem): ChatServiceDomain | null {
  const rec = it as unknown as Record<string, unknown>;
  const v = rec["domain"];
  const s = typeof v === "string" ? v.trim() : "";
  return s ? (toUpperKey(s) as ChatServiceDomain) : null;
}

/** ===== FAQ TOP10 정규화 ===== */
function getFaqItemId(it: FaqItem): string | null {
  const rec = it as unknown as Record<string, unknown>;
  const v = rec["id"] ?? rec["faqId"] ?? rec["key"];
  const s =
    typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return s ? s : null;
}

function getFaqItemQuestion(it: FaqItem): string {
  const rec = it as unknown as Record<string, unknown>;
  const candidates = ["question", "title", "q", "label"];
  for (const k of candidates) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "FAQ";
}

function getFaqItemDomain(it: FaqItem): ChatServiceDomain | null {
  const rec = it as unknown as Record<string, unknown>;
  const v = rec["domain"];
  const s = typeof v === "string" ? v.trim() : "";
  return s ? (toUpperKey(s) as ChatServiceDomain) : null;
}

const FAQ_DOMAIN_LABELS: Record<string, string> = {
  ACCOUNT: "계정",
  APPROVAL: "결재",
  HR: "인사",
  PAY: "급여",
  WELFARE: "복지",
  EDUCATION: "교육",
  IT: "IT",
  SECURITY: "보안",
  FACILITY: "시설",
  ETC: "기타",
};

const FAQ_DOMAIN_KEYS: string[] = [
  "ACCOUNT",
  "APPROVAL",
  "HR",
  "PAY",
  "WELFARE",
  "EDUCATION",
  "IT",
  "SECURITY",
  "FACILITY",
  "ETC",
];

function toServiceDomain(s: string): ChatServiceDomain {
  return s as ChatServiceDomain;
}

type RoleChip = {
  key: "admin" | "reviewer" | "creator";
  label: string;
  className: string;
  onClick: () => void;
};

/**
 * =========================
 * 최소 마크다운 렌더러 (라이브러리 없이)
 * 지원:
 * - 헤딩: # ~ ######  (###. 형태도 대응)
 * - 굵게: **bold** / __bold__
 * - 인라인 코드: `code`
 * - 펜스 코드블록: ```lang ... ```
 * - 인용문: > quote
 * - 구분선: --- / *** / ___ (공백 섞인 형태도 일부 대응)
 * - 목록:
 *   - Unordered: "- item" / "* item" / "• item" / "· item" / "● item"
 *   - Ordered: "1. item" / "1) item"
 *
 * 주의:
 * - XSS 방지: dangerouslySetInnerHTML 사용 안 함
 * - 스트리밍 중 미완성 토큰(**, `)은 그대로 텍스트로 표시되었다가
 *   닫히는 순간부터 자연스럽게 렌더링됨(깨짐 방지)
 * - “빈 줄이 껴 있는 목록(loose list)”도 같은 리스트로 유지해서
 *   <ol> 번호가 매 항목마다 1로 리셋되는 문제를 방지
 * =========================
 */

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function isOrderedListLine(line: string): boolean {
  // "1. item" / "1) item" 모두 허용
  return /^\s*\d+[.)]\s+/.test(line);
}

function isUnorderedListLine(line: string): boolean {
  // LLM이 흔히 섞는 bullet들도 같이 허용
  return /^\s*([-*•·●])\s+/.test(line);
}

function stripOrderedMarker(line: string): string {
  return line.replace(/^\s*\d+[.)]\s+/, "");
}

function stripUnorderedMarker(line: string): string {
  return line.replace(/^\s*([-*•·●])\s+/, "");
}

function parseHeadingLine(
  line: string
): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  // "### 제목", "###. 제목" (LLM이 가끔 ###. 형태로 출력) 둘 다 대응
  const m = /^\s{0,3}(#{1,6})\s*\.?\s+(.*)\s*$/.exec(line);
  if (!m) return null;

  const level = Math.min(6, Math.max(1, m[1].length)) as 1 | 2 | 3 | 4 | 5 | 6;
  const text = (m[2] ?? "").trim();
  if (!text) return null;

  return { level, text };
}

function isHorizontalRuleLine(line: string): boolean {
  // --- / *** / ___
  // 공백 섞인 형태(- - -)도 일부 대응
  const s = line.trim();
  if (!s) return false;
  if (/^(-\s*){3,}$/.test(s)) return true;
  if (/^(\*\s*){3,}$/.test(s)) return true;
  if (/^(_\s*){3,}$/.test(s)) return true;
  return false;
}

function parseBlockquoteLine(line: string): string | null {
  const m = /^\s{0,3}>\s?(.*)$/.exec(line);
  if (!m) return null;
  return m[1] ?? "";
}

function parseCodeFenceLine(line: string): { lang: string } | null {
  const m = /^\s{0,3}```\s*([A-Za-z0-9_-]+)?\s*$/.exec(line);
  if (!m) return null;
  const lang = (m[1] ?? "").trim();
  return { lang };
}

function findNextSpecial(
  src: string,
  from: number
): { pos: number; kind: "code" | "bold"; marker: "`" | "**" | "__" } | null {
  const pCode = src.indexOf("`", from);

  const pBold1 = src.indexOf("**", from);
  const pBold2 = src.indexOf("__", from);

  let bestPos = -1;
  let bestKind: "code" | "bold" = "code";
  let bestMarker: "`" | "**" | "__" = "`";

  if (pCode !== -1) {
    bestPos = pCode;
    bestKind = "code";
    bestMarker = "`";
  }

  const considerBold = (p: number, marker: "**" | "__") => {
    if (p === -1) return;
    if (bestPos === -1 || p < bestPos) {
      bestPos = p;
      bestKind = "bold";
      bestMarker = marker;
    }
  };

  considerBold(pBold1, "**");
  considerBold(pBold2, "__");

  if (bestPos === -1) return null;
  return { pos: bestPos, kind: bestKind, marker: bestMarker };
}

function renderInlineMarkdownLite(
  text: string,
  keyBase: string,
  depth = 0
): React.ReactNode {
  const src = String(text ?? "");
  if (!src) return null;

  // 과도한 재귀 방지(이론상 필요 거의 없지만 안전장치)
  if (depth > 6) return src;

  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < src.length) {
    const next = findNextSpecial(src, i);
    if (!next) {
      nodes.push(src.slice(i));
      break;
    }

    const { pos, kind, marker } = next;
    if (pos > i) nodes.push(src.slice(i, pos));

    if (kind === "code" && marker === "`") {
      const close = src.indexOf("`", pos + 1);
      if (close === -1) {
        // 닫힘이 없으면 남은 부분은 그대로 출력(스트리밍 중 미완성 방어)
        nodes.push(src.slice(pos));
        break;
      }

      const inner = src.slice(pos + 1, close);
      nodes.push(
        <code
          key={`${keyBase}:c:${key++}`}
          className="cb-md-code"
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            fontSize: "0.92em",
            padding: "0.08em 0.38em",
            borderRadius: 6,
            background: "rgba(0,0,0,0.06)",
          }}
        >
          {inner}
        </code>
      );
      i = close + 1;
      continue;
    }

    if (kind === "bold" && (marker === "**" || marker === "__")) {
      const close = src.indexOf(marker, pos + marker.length);
      if (close === -1) {
        // 닫힘이 없으면 그대로 출력(스트리밍 중 미완성 방어)
        nodes.push(src.slice(pos));
        break;
      }

      const inner = src.slice(pos + marker.length, close);
      nodes.push(
        <strong
          key={`${keyBase}:b:${key++}`}
          className="cb-md-bold"
          style={{ fontWeight: 700 }}
        >
          {renderInlineMarkdownLite(
            inner,
            `${keyBase}:binner:${key++}`,
            depth + 1
          )}
        </strong>
      );
      i = close + marker.length;
      continue;
    }

    // 이론상 도달하지 않음
    nodes.push(src.slice(pos, pos + 1));
    i = pos + 1;
  }

  return <>{nodes}</>;
}

function renderParagraphBlock(block: string, keyBase: string): React.ReactNode {
  const lines = normalizeNewlines(block).split("\n");
  // 문단 내부의 줄바꿈은 <br/>로 유지
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    out.push(
      <React.Fragment key={`${keyBase}:pl:${i}`}>
        {renderInlineMarkdownLite(line, `${keyBase}:in:${i}`)}
        {i < lines.length - 1 ? <br /> : null}
      </React.Fragment>
    );
  }

  return (
    <div
      key={keyBase}
      className="cb-md-paragraph"
      style={{
        margin: "6px 0",
      }}
    >
      {out}
    </div>
  );
}

function renderListBlock(block: string, keyBase: string): React.ReactNode {
  const lines = normalizeNewlines(block)
    .split("\n")
    .filter((l) => !isBlankLine(l));

  const allOrdered = lines.length > 0 && lines.every(isOrderedListLine);
  const allUnordered = lines.length > 0 && lines.every(isUnorderedListLine);

  if (!allOrdered && !allUnordered) {
    return renderParagraphBlock(block, keyBase);
  }

  const items = lines.map((l, idx) => {
    const content = allOrdered
      ? stripOrderedMarker(l)
      : stripUnorderedMarker(l);
    return (
      <li
        key={`${keyBase}:li:${idx}`}
        className="cb-md-li"
        style={{ margin: "4px 0" }}
      >
        {renderInlineMarkdownLite(content, `${keyBase}:li-in:${idx}`)}
      </li>
    );
  });

  const commonStyle: React.CSSProperties = {
    margin: "6px 0",
    paddingLeft: 18,
  };

  if (allOrdered) {
    return (
      <ol key={keyBase} className="cb-md-ol" style={commonStyle}>
        {items}
      </ol>
    );
  }

  return (
    <ul key={keyBase} className="cb-md-ul" style={commonStyle}>
      {items}
    </ul>
  );
}

function renderHeadingBlock(
  level: 1 | 2 | 3 | 4 | 5 | 6,
  text: string,
  keyBase: string
): React.ReactNode {
  // 말풍선 안에서는 너무 과한 H1 느낌 대신 "섹션 타이틀" 톤으로 절제
  const fontSize =
    level === 1
      ? "1.12em"
      : level === 2
      ? "1.08em"
      : level === 3
      ? "1.04em"
      : "1.00em";

  return (
    <div
      key={keyBase}
      className={`cb-md-h cb-md-h${level}`}
      style={{
        margin: "10px 0 6px",
        fontWeight: 800,
        fontSize,
        lineHeight: 1.25,
      }}
    >
      {renderInlineMarkdownLite(text, `${keyBase}:h:${level}`)}
    </div>
  );
}

function renderHorizontalRule(keyBase: string): React.ReactNode {
  return (
    <hr
      key={keyBase}
      className="cb-md-hr"
      style={{
        border: 0,
        borderTop: "1px solid rgba(0,0,0,0.12)",
        margin: "10px 0",
      }}
    />
  );
}

function renderCodeBlock(
  code: string,
  lang: string,
  keyBase: string
): React.ReactNode {
  const label = lang ? lang.toUpperCase() : "";
  return (
    <div key={keyBase} className="cb-md-prewrap" style={{ margin: "10px 0" }}>
      {label && (
        <div
          className="cb-md-code-label"
          style={{
            fontSize: "0.78em",
            opacity: 0.7,
            marginBottom: 6,
            fontWeight: 700,
            letterSpacing: 0.3,
          }}
        >
          {label}
        </div>
      )}
      <pre
        className="cb-md-pre"
        style={{
          margin: 0,
          padding: "10px 12px",
          borderRadius: 10,
          background: "rgba(0,0,0,0.06)",
          overflowX: "auto",
          whiteSpace: "pre",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          fontSize: "0.92em",
          lineHeight: 1.4,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderBlockquoteBlock(
  content: string,
  keyBase: string,
  depth: number
): React.ReactNode {
  return (
    <div
      key={keyBase}
      className="cb-md-quote"
      style={{
        margin: "10px 0",
        padding: "8px 10px",
        borderLeft: "3px solid rgba(0,0,0,0.18)",
        background: "rgba(0,0,0,0.03)",
        borderRadius: 10,
      }}
    >
      {renderMarkdownLite(content, `${keyBase}:inner`, depth + 1)}
    </div>
  );
}

function renderMarkdownLite(
  text: string,
  keyBase = "md",
  depth = 0
): React.ReactNode {
  const src = String(text ?? "");
  if (!src) return null;

  // 재귀 안전장치(인용문 내부에서 다시 renderMarkdownLite 호출)
  if (depth > 2) {
    return renderParagraphBlock(src, `${keyBase}:maxdepth`);
  }

  const lines = normalizeNewlines(src).split("\n");

  const out: React.ReactNode[] = [];
  let paraBuf: string[] = [];

  let listBuf: string[] = [];
  let listKind: "ordered" | "unordered" | null = null;

  // loose list: 목록 중간의 빈 줄이 <ol>을 분리해 번호가 1로 리셋되는 문제 방지
  let pendingListBlank = false;

  // blockquote
  let quoteBuf: string[] = [];

  // fenced code
  let inCodeFence = false;
  let codeFenceLang = "";
  let codeBuf: string[] = [];

  let pIndex = 0;
  let lIndex = 0;
  let hIndex = 0;
  let rIndex = 0;
  let qIndex = 0;
  let cIndex = 0;

  const flushPara = () => {
    if (paraBuf.length === 0) return;
    out.push(
      renderParagraphBlock(paraBuf.join("\n"), `${keyBase}:p:${pIndex++}`)
    );
    paraBuf = [];
  };

  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push(renderListBlock(listBuf.join("\n"), `${keyBase}:l:${lIndex++}`));
    listBuf = [];
    listKind = null;
    pendingListBlank = false;
  };

  const flushQuote = () => {
    if (quoteBuf.length === 0) return;
    out.push(
      renderBlockquoteBlock(
        quoteBuf.join("\n"),
        `${keyBase}:q:${qIndex++}`,
        depth
      )
    );
    quoteBuf = [];
  };

  const flushCode = () => {
    if (!inCodeFence) return;
    out.push(
      renderCodeBlock(
        codeBuf.join("\n"),
        codeFenceLang,
        `${keyBase}:c:${cIndex++}`
      )
    );
    inCodeFence = false;
    codeFenceLang = "";
    codeBuf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine;

    // 1) fenced code 내부
    if (inCodeFence) {
      const fence = parseCodeFenceLine(line);
      if (fence) {
        // closing fence
        flushCode();
        continue;
      }
      codeBuf.push(line);
      continue;
    }

    // 2) code fence 시작
    const fenceStart = parseCodeFenceLine(line);
    if (fenceStart) {
      flushQuote();
      flushList();
      flushPara();

      inCodeFence = true;
      codeFenceLang = fenceStart.lang;
      codeBuf = [];
      continue;
    }

    // 3) 빈 줄 처리
    if (isBlankLine(line)) {
      // quote 진행 중이면 빈 줄도 유지(인용문 내부 문단 유지)
      if (quoteBuf.length > 0) {
        quoteBuf.push("");
        continue;
      }

      // list 진행 중이면 일단 보류(다음 라인이 list이면 같은 리스트로 유지)
      if (listKind !== null) {
        pendingListBlank = true;
        continue;
      }

      // 일반 문단 종료
      flushPara();
      continue;
    }

    // 4) list blank 보류 상태 처리
    if (pendingListBlank && listKind !== null) {
      const isOl = isOrderedListLine(line);
      const isUl = isUnorderedListLine(line);
      const kind: "ordered" | "unordered" | null = isOl
        ? "ordered"
        : isUl
        ? "unordered"
        : null;

      if (!kind || kind !== listKind) {
        flushList();
      } else {
        pendingListBlank = false;
      }
    }

    // 5) 구분선
    if (isHorizontalRuleLine(line)) {
      flushQuote();
      flushList();
      flushPara();
      out.push(renderHorizontalRule(`${keyBase}:hr:${rIndex++}`));
      continue;
    }

    // 6) 인용문
    const q = parseBlockquoteLine(line);
    if (q !== null) {
      flushList();
      flushPara();
      quoteBuf.push(q);
      continue;
    } else if (quoteBuf.length > 0) {
      flushQuote();
    }

    // 7) 헤딩
    const heading = parseHeadingLine(line);
    if (heading) {
      flushList();
      flushPara();
      out.push(
        renderHeadingBlock(
          heading.level,
          heading.text,
          `${keyBase}:h:${hIndex++}`
        )
      );
      continue;
    }

    // 8) 리스트
    const isOl = isOrderedListLine(line);
    const isUl = isUnorderedListLine(line);

    if (isOl || isUl) {
      const kind: "ordered" | "unordered" = isOl ? "ordered" : "unordered";
      flushPara();

      if (listKind === null) {
        listKind = kind;
        listBuf.push(line);
        pendingListBlank = false;
        continue;
      }

      if (listKind === kind) {
        listBuf.push(line);
        pendingListBlank = false;
        continue;
      }

      flushList();
      listKind = kind;
      listBuf.push(line);
      pendingListBlank = false;
      continue;
    }

    // 9) 일반 문단
    flushList();
    paraBuf.push(line);
  }

  // tail flush
  flushCode();
  flushQuote();
  flushList();
  flushPara();

  return (
    <div className="cb-md-root" style={{ margin: 0 }}>
      {out}
    </div>
  );
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  activeSession,
  onSendMessage,
  isSending,
  onChangeDomain,
  onOpenEduPanel,
  onOpenQuizPanel,
  onOpenAdminPanel,
  faqHomeItems,
  isFaqHomeLoading,
  onRequestFaqTop10,
  onFaqQuickSend,
  onRetryFromMessage,
  onFeedbackChange,
  feedbackLoadingIds,
  retryLoadingMessageId,
  onReportSubmit,
  userRole,
  onOpenReviewerPanel,
  onOpenCreatorPanel,
}) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 전송이 끝난 뒤 입력창에 포커스를 “복구”하기 위한 플래그
  const refocusAfterSendRef = useRef(false);

  // FAQ: 선택된 도메인(없으면 HOME=추천)
  const [faqDomainFilter, setFaqDomainFilter] = useState<FaqFilterDomain>(null);

  // FAQ: 도메인별 top10 캐시(컴포넌트 로컬 UI 캐시)
  const [faqTop10ByDomain, setFaqTop10ByDomain] = useState<
    Record<string, FaqItem[]>
  >({});
  const faqTop10ByDomainRef = useRef<Record<string, FaqItem[]>>({});
  useEffect(() => {
    faqTop10ByDomainRef.current = faqTop10ByDomain;
  }, [faqTop10ByDomain]);

  const [faqTop10Loading, setFaqTop10Loading] = useState(false);
  const [faqTop10Error, setFaqTop10Error] = useState<string | null>(null);

  // 신고 모달 상태
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportContent, setReportContent] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const reportTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 세션/도메인 정보
  const currentDomain: ChatDomain = activeSession?.domain ?? "general";
  const isFaqDomain = currentDomain === "faq";
  const isGeneralDomain = currentDomain === "general";

  // 입력창 포커스 복구 헬퍼 (FAQ/신고모달/전송중 상태 고려)
  const focusChatInput = useCallback(
    (opts?: { force?: boolean }) => {
      // FAQ 도메인에서는 입력창이 없으므로 제외
      if (isFaqDomain) return;
      // 신고 모달이 열려있으면 모달 입력이 우선
      if (isReportModalOpen) return;
      // 전송 중에는 textarea가 disabled → 포커스 불가
      if (isSending) return;

      const el = inputRef.current;
      if (!el) return;

      // 사용자가 다른 입력창(검색/리네임 등)에 포커스를 둔 경우 포커스 강탈 방지
      const active = document.activeElement as HTMLElement | null;
      if (!opts?.force && active && active !== el) {
        const tag = active.tagName;
        const isTextField =
          tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable;
        if (isTextField) return;
      }

      window.setTimeout(() => el.focus(), 0);
    },
    [isFaqDomain, isReportModalOpen, isSending]
  );

  // Role 정보
  const isAdmin = can(userRole, "OPEN_ADMIN_DASHBOARD");
  const isReviewer = can(userRole, "OPEN_REVIEWER_DESK");
  const isCreator = can(userRole, "OPEN_CREATOR_STUDIO");

  // 홈 상단이 3카드(가운데 역할 카드 포함)인지
  const hasMiddleRoleCard = isAdmin || isReviewer || isCreator;

  // 원본 세션 메시지 → UI 타입으로 캐스팅
  const rawMessages = activeSession?.messages ?? [];
  const messages = rawMessages as UiChatMessage[];
  const hasMessages = messages.length > 0;

  // Streaming UX: 마지막 메시지가 assistant면 별도 타이핑 버블을 띄우지 않음
  const hasAssistantTail = useMemo(() => {
    if (!messages.length) return false;
    return messages[messages.length - 1].role === "assistant";
  }, [messages]);

  const showTypingBubble = isSending && !hasAssistantTail;

  // 세션이 바뀌면 FAQ 필터는 HOME로 리셋(UX 안정)
  useEffect(() => {
    setFaqDomainFilter(null);
    setFaqTop10Error(null);
    setFaqTop10Loading(false);
  }, [activeSession?.id]);

  // 스크롤: streaming은 length가 안 변할 수 있으니 "마지막 메시지 content 길이" 기반으로도 내려줌
  const scrollKey = useMemo(() => {
    const last = messages[messages.length - 1];
    const lastId = last?.id ?? "";
    const lastLen = last?.content?.length ?? 0;
    return `${messages.length}:${lastId}:${lastLen}:${isSending ? 1 : 0}`;
  }, [messages, isSending]);

  useEffect(() => {
    if (!messagesEndRef.current) return;
    messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [scrollKey]);

  // textarea 자동 높이 조절
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "24px";
    const next = Math.min(el.scrollHeight, 120);
    el.style.height = `${next}px`;
  }, [inputValue]);

  // 전송이 끝나는 순간(isSending=false)에 입력창 포커스를 자동 복구
  useEffect(() => {
    if (isSending) return;
    if (!refocusAfterSendRef.current) return;

    refocusAfterSendRef.current = false;
    focusChatInput({ force: true });
  }, [isSending, focusChatInput]);

  // 신고 모달이 닫힌 뒤에는 입력창으로 자연스럽게 복귀
  useEffect(() => {
    if (isReportModalOpen) return;
    focusChatInput();
  }, [isReportModalOpen, focusChatInput]);

  // 신고 모달 열릴 때 textarea 포커스 + ESC 닫기
  useEffect(() => {
    if (!isReportModalOpen) return;

    const t = window.setTimeout(() => {
      reportTextareaRef.current?.focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsReportModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isReportModalOpen]);

  // ====== 공통 핸들러들 ======

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;

    // 이번 요청이 끝나면 입력창으로 포커스를 “복구”해야 함
    refocusAfterSendRef.current = true;

    onSendMessage(trimmed);
    setInputValue("");
  }, [inputValue, isSending, onSendMessage]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleEduClick = useCallback(() => {
    if (isSending) return;
    onChangeDomain("edu");
    onOpenEduPanel?.();
  }, [isSending, onChangeDomain, onOpenEduPanel]);

  const handleQuizClick = useCallback(() => {
    if (isSending) return;
    onChangeDomain("quiz");
    onOpenQuizPanel?.();
  }, [isSending, onChangeDomain, onOpenQuizPanel]);

  const handleOpenAdminDashboard = useCallback(() => {
    if (isSending) return;
    if (!isAdmin) return;
    // 관리자 버튼 클릭 시 sourceDomain을 POLICY로 저장
    if (typeof window !== "undefined") {
      localStorage.setItem("ctrlf-creator-source-domain", "POLICY");
    }
    onOpenAdminPanel?.();
  }, [isSending, isAdmin, onOpenAdminPanel]);

  const handleOpenReviewerDesk = useCallback(() => {
    if (isSending) return;
    if (!isReviewer) return;
    onOpenReviewerPanel?.();
  }, [isSending, isReviewer, onOpenReviewerPanel]);

  const handleOpenCreatorStudio = useCallback(() => {
    if (isSending) return;
    if (!isCreator) return;
    // 제작 버튼 클릭 시 sourceDomain을 EDU로 저장
    if (typeof window !== "undefined") {
      localStorage.setItem("ctrlf-creator-source-domain", "EDU");
    }
    onOpenCreatorPanel?.();
  }, [isSending, isCreator, onOpenCreatorPanel]);

  // ===== 헤더에 표시할 "역할 칩" (관리자/검토/제작) =====
  const roleChips: RoleChip[] = useMemo(() => {
    const arr: RoleChip[] = [];
    if (isAdmin) {
      arr.push({
        key: "admin",
        label: "관리자",
        className: "cb-main-chip-role cb-main-chip-admin",
        onClick: handleOpenAdminDashboard,
      });
    }
    if (isReviewer) {
      arr.push({
        key: "reviewer",
        label: "검토",
        className: "cb-main-chip-role cb-main-chip-reviewer",
        onClick: handleOpenReviewerDesk,
      });
    }
    if (isCreator) {
      arr.push({
        key: "creator",
        label: "제작",
        className: "cb-main-chip-role cb-main-chip-creator",
        onClick: handleOpenCreatorStudio,
      });
    }
    return arr;
  }, [
    isAdmin,
    isReviewer,
    isCreator,
    handleOpenAdminDashboard,
    handleOpenReviewerDesk,
    handleOpenCreatorStudio,
  ]);

  const handleFaqChipClick = useCallback(() => {
    if (isSending) return;
    onChangeDomain("faq");
  }, [isSending, onChangeDomain]);

  const handleGoGeneral = useCallback(() => {
    if (isSending) return;
    onChangeDomain("general");
  }, [isSending, onChangeDomain]);

  // FAQ 추천 버튼 클릭 시: 같은 세션에 Q/A 추가
  const handleFaqSuggestionClick = useCallback(
    (faqKey: number | string) => {
      if (isSending) return;
      if (!onFaqQuickSend) return;
      onFaqQuickSend(faqKey);
    },
    [isSending, onFaqQuickSend]
  );

  // 신고 모달 열기
  const handleOpenReportModal = useCallback(() => {
    if (isSending) return;
    setReportContent("");
    setReportError(null);
    setIsReportModalOpen(true);
  }, [isSending]);

  const handleCloseReportModal = useCallback(() => {
    setIsReportModalOpen(false);
  }, []);

  const handleSubmitReportClick = useCallback(() => {
    const trimmed = reportContent.trim();
    if (!trimmed) {
      setReportError("신고 내용을 입력해 주세요.");
      reportTextareaRef.current?.focus();
      return;
    }

    if (!onReportSubmit || !activeSession) {
      setIsReportModalOpen(false);
      return;
    }

    const payload: ReportPayload = {
      sessionId: activeSession.id,
      content: trimmed,
      createdAt: Date.now(),
    };

    onReportSubmit(payload);
    setIsReportModalOpen(false);
    setReportContent("");
    setReportError(null);
  }, [reportContent, onReportSubmit, activeSession]);

  // ====== FAQ: 도메인 top10 로딩 ======
  const loadFaqTop10 = useCallback(
    async (domain: ChatServiceDomain) => {
      const key = toUpperKey(domain);
      if (!key) return;

      if (!onRequestFaqTop10) {
        setFaqTop10Error("FAQ 목록 API가 연결되지 않았습니다.");
        return;
      }

      setFaqTop10Loading(true);
      setFaqTop10Error(null);

      try {
        console.log(`[FAQ] 도메인별 FAQ 로드 시작: ${key} (${domain})`);
        const list = await onRequestFaqTop10(domain);
        console.log(`[FAQ] 도메인별 FAQ 응답 (${key}):`, {
          rawList: list,
          listLength: Array.isArray(list) ? list.length : 0,
          listType: Array.isArray(list) ? "array" : typeof list,
        });

        if (!Array.isArray(list) || list.length === 0) {
          console.warn(`[FAQ] 도메인 ${key}에 대한 FAQ 데이터가 없습니다.`);
          setFaqTop10ByDomain((prev) => ({ ...prev, [key]: [] }));
          return;
        }

        // 먼저 모든 항목을 정규화하고 도메인 정보 확인
        const allNormalized = (Array.isArray(list) ? list : []).map((it) => {
          const id = getFaqItemId(it);
          const question = getFaqItemQuestion(it);
          const d = getFaqItemDomain(it);
          const itemDomainKey = d ? toUpperKey(d) : null;
          return {
            raw: it,
            id,
            question,
            domain: d,
            domainKey: itemDomainKey,
            matches: itemDomainKey === key,
          };
        });

        console.log(
          `[FAQ] 모든 항목 정규화 결과 (${key}):`,
          allNormalized.map((x) => ({
            id: x.id,
            question: x.question?.substring(0, 30),
            domain: x.domain,
            domainKey: x.domainKey,
            matches: x.matches,
            requestedKey: key,
          }))
        );

        // 필터링: ID와 질문이 있고, 도메인이 일치하는 것만
        const filtered = allNormalized.filter((x) => {
          if (!x.id || !x.question?.trim()) {
            console.log(`[FAQ] 필터링 제외 (ID/질문 없음):`, x.id, x.question);
            return false;
          }
          if (x.domainKey !== key) {
            console.log(
              `[FAQ] 필터링 제외 (도메인 불일치): 요청=${key}, 항목=${x.domainKey}`
            );
            return false;
          }
          return true;
        });

        console.log(`[FAQ] 필터링 후 FAQ (${key}):`, filtered.length, "개");

        // 중복 제거 (ID 기준)
        const seenIds = new Set<string>();
        const items = filtered
          .map((x) => x.raw)
          .filter((it) => {
            const id = getFaqItemId(it);
            if (!id) return false;
            if (seenIds.has(id)) {
              console.log(`[FAQ] 중복 제거:`, id);
              return false;
            }
            seenIds.add(id);
            return true;
          });

        console.log(`[FAQ] 최종 저장할 FAQ (${key}):`, items.length, "개");
        setFaqTop10ByDomain((prev) => ({ ...prev, [key]: items }));

        if (items.length === 0) {
          console.warn(
            `[FAQ] ⚠️ 도메인 ${key}에 대한 FAQ가 0개입니다. 백엔드 응답을 확인하세요.`
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[FAQ] 도메인 ${key} 로드 실패:`, e);
        setFaqTop10Error(msg || "FAQ 목록을 불러오지 못했습니다.");
        // 에러 발생 시 빈 배열로 설정하여 재시도 가능하도록 함
        setFaqTop10ByDomain((prev) => ({ ...prev, [key]: [] }));
      } finally {
        setFaqTop10Loading(false);
      }
    },
    [onRequestFaqTop10]
  );

  // FAQ 도메인 필터 토글 (HOME <-> DOMAIN)
  const handleToggleFaqDomain = useCallback(
    (domain: ChatServiceDomain | null) => {
      if (isSending) return;

      if (domain === null) {
        setFaqDomainFilter(null);
        setFaqTop10Error(null);
        return;
      }

      // 같은 도메인을 다시 누르면 HOME으로
      if (
        faqDomainFilter &&
        toUpperKey(faqDomainFilter) === toUpperKey(domain)
      ) {
        setFaqDomainFilter(null);
        setFaqTop10Error(null);
        return;
      }

      setFaqDomainFilter(domain);
      void loadFaqTop10(domain);
    },
    [isSending, faqDomainFilter, loadFaqTop10]
  );

  const faqSuggestionButtons = useMemo(() => {
    // HOME: faqHomeItems top10
    if (!faqDomainFilter) {
      const home = Array.isArray(faqHomeItems) ? faqHomeItems.slice(0, 10) : [];
      return {
        mode: "HOME" as const,
        items: home.map((it, idx) => {
          const faqId = getFaqHomeId(it);
          const label = getFaqHomeLabel(it);
          const domain = getFaqHomeDomain(it);
          const stableKey = faqId ? `home:${faqId}` : `home:${idx}:${label}`;
          return { key: stableKey, faqId, label, domain };
        }),
      };
    }

    // DOMAIN: 도메인별로 백엔드에서 반환하는 모든 FAQ 표시 (초기 데이터는 각 도메인별 2개)
    const domainKey = toUpperKey(faqDomainFilter);
    const list = faqTop10ByDomain[domainKey] ?? [];
    return {
      mode: "DOMAIN" as const,
      items: list.map((it, idx) => {
        const id = getFaqItemId(it) ?? `d:${domainKey}:${idx}`;
        const label = getFaqItemQuestion(it);
        const domain = getFaqItemDomain(it);
        return { key: `top:${id}`, faqId: id, label, domain };
      }),
    };
  }, [faqDomainFilter, faqHomeItems, faqTop10ByDomain]);

  // FAQ 영역 렌더링 (홈/FAQ 도메인 공통 사용)
  const renderFaqSection = () => {
    const homeLoading = Boolean(isFaqHomeLoading);
    const showHome = !faqDomainFilter;

    const showLoadingRow = showHome ? homeLoading : faqTop10Loading;
    const showErrorText = Boolean(faqTop10Error);

    return (
      <div className="cb-home-faq-section">
        <div className="cb-faq-category-row">
          {/* HOME(추천) */}
          <button
            type="button"
            className={
              "cb-faq-category-chip" + (!faqDomainFilter ? " is-active" : "")
            }
            onClick={() => handleToggleFaqDomain(null)}
            disabled={isSending}
          >
            추천
          </button>

          {/* 도메인 칩 */}
          {FAQ_DOMAIN_KEYS.map((k) => {
            const sd = toServiceDomain(k);
            const label = FAQ_DOMAIN_LABELS[k] ?? k;
            const active = faqDomainFilter && toUpperKey(faqDomainFilter) === k;
            return (
              <button
                key={k}
                type="button"
                className={
                  "cb-faq-category-chip" + (active ? " is-active" : "")
                }
                onClick={() => handleToggleFaqDomain(sd)}
                disabled={isSending}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="cb-faq-suggestions">
          {showLoadingRow && (
            <>
              <button type="button" className="cb-faq-suggestion-btn" disabled>
                FAQ를 불러오는 중…
              </button>
              <button type="button" className="cb-faq-suggestion-btn" disabled>
                잠시만 기다려 주세요…
              </button>
            </>
          )}

          {!showLoadingRow && showErrorText && (
            <button type="button" className="cb-faq-suggestion-btn" disabled>
              {faqTop10Error}
            </button>
          )}

          {!showLoadingRow &&
            !showErrorText &&
            faqSuggestionButtons.items.map((it) => {
              const faqId = it.faqId;
              const disabled = isSending || !faqId;

              return (
                <button
                  key={it.key}
                  type="button"
                  className="cb-faq-suggestion-btn"
                  onClick={() => {
                    if (!faqId) return;
                    handleFaqSuggestionClick(normalizeFaqKey(faqId));
                  }}
                  disabled={disabled}
                  title={it.label}
                  aria-label={it.label}
                >
                  {it.label}
                </button>
              );
            })}

          {!showLoadingRow &&
            !showErrorText &&
            faqSuggestionButtons.items.length === 0 && (
              <button type="button" className="cb-faq-suggestion-btn" disabled>
                표시할 FAQ가 없습니다.
              </button>
            )}
        </div>
      </div>
    );
  };

  // 공통 메시지 렌더링
  const renderMessages = () => {
    if (!messages.length && !isSending) return null;

    return (
      <div className="cb-chat-messages">
        {messages.map((msg, index) => {
          const isUser = msg.role === "user";
          const isAssistant = !isUser;

          const isErrorAssistant =
            isAssistant &&
            msg.content.startsWith(
              "죄송합니다. 서버와 통신 중 문제가 발생했어요"
            );

          // Streaming 상태: 마지막 assistant 메시지는 전송 중일 때 “스트리밍 말풍선”로 표시
          const isStreaming =
            isAssistant && isSending && index === messages.length - 1;

          // 스트리밍 시작 직후: placeholder assistant가 먼저 생기고 content가 비어있으면
          const isStreamingEmpty =
            isStreaming && (msg.content?.length ?? 0) === 0;

          // 이 assistant 답변의 기준이 되는 user 질문 찾기
          let sourceQuestion: string | null = null;
          if (isAssistant) {
            for (let i = index - 1; i >= 0; i -= 1) {
              if (messages[i].role === "user") {
                sourceQuestion = messages[i].content;
                break;
              }
            }
          }

          const msgKind = msg.kind ?? "normal";
          const isReportSuggestion = msgKind === "reportSuggestion";
          const isReportReceipt = msgKind === "reportReceipt";

          const feedback: FeedbackValue = msg.feedback ?? null;

          // 피드백/재시도는 “스트리밍 중인 마지막 답변”에는 노출/동작 금지
          const allowActions = isAssistant && !isStreaming;

          return (
            <div
              key={msg.id}
              className={`cb-chat-bubble-row ${
                isUser ? "cb-chat-bubble-row-user" : "cb-chat-bubble-row-bot"
              }`}
            >
              <div
                className={
                  "cb-chat-bubble-container " +
                  (isUser
                    ? "cb-chat-bubble-container-user"
                    : "cb-chat-bubble-container-bot")
                }
              >
                {isAssistant && isReportSuggestion ? (
                  <div className="cb-chat-bubble cb-chat-bubble-bot cb-chat-bubble-report">
                    <span
                      className="cb-chat-bubble-report-icon"
                      aria-hidden="true"
                    >
                      🔍
                    </span>
                    <span className="cb-chat-bubble-report-text">
                      {msg.content}
                    </span>
                    <button
                      type="button"
                      className="cb-report-suggest-inline-btn"
                      onClick={handleOpenReportModal}
                      disabled={isSending}
                    >
                      신고
                    </button>
                  </div>
                ) : isAssistant && isReportReceipt ? (
                  <div className="cb-chat-bubble cb-chat-bubble-bot cb-chat-bubble-receipt">
                    <span
                      className="cb-chat-bubble-receipt-icon"
                      aria-hidden="true"
                    >
                      ✅
                    </span>
                    <span className="cb-chat-bubble-receipt-text">
                      {msg.content}
                    </span>
                  </div>
                ) : (
                  <>
                    <div
                      className={[
                        "cb-chat-bubble",
                        isUser ? "cb-chat-bubble-user" : "cb-chat-bubble-bot",
                        isErrorAssistant ? "cb-chat-bubble-error" : "",
                        isStreaming ? "cb-chat-bubble-streaming" : "",
                      ].join(" ")}
                    >
                      <div
                        className="cb-chat-bubble-text"
                        style={{
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {isStreamingEmpty ? (
                          <span
                            aria-label="답변 생성 중"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            <span
                              className="cb-typing-dots"
                              style={{ margin: 0 }}
                            >
                              <span />
                              <span />
                              <span />
                            </span>
                          </span>
                        ) : (
                          <>
                            {isAssistant
                              ? renderMarkdownLite(msg.content, `m:${msg.id}`)
                              : msg.content}
                            {isStreaming && (
                              <span
                                className="cb-streaming-caret"
                                aria-hidden="true"
                              />
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {allowActions && (
                      <div className="cb-chat-bubble-actions">
                        {isErrorAssistant && (
                          <span className="cb-chat-bubble-error-text">
                            네트워크 오류로 실패했어요.
                          </span>
                        )}

                        <div className="cb-chat-actions-icon-group">
                          <div className="cb-chat-feedback-group">
                            {(() => {
                              // 피드백 버튼 비활성화 조건
                              const hasServerId = Boolean(msg.serverId);
                              const isFeedbackLoading = feedbackLoadingIds?.has(msg.id) ?? false;
                              const canFeedback = onFeedbackChange && hasServerId && !isFeedbackLoading;

                              // serverId 없으면 개발자용 경고 (최초 1회만)
                              if (!hasServerId && isAssistant) {
                                console.warn(
                                  `[ChatWindow] 피드백 버튼 비활성화: serverId 없음 (messageId: ${msg.id})`
                                );
                              }

                              return (
                                <>
                                  <button
                                    type="button"
                                    className={`cb-chat-bubble-icon-btn cb-chat-feedback-btn ${
                                      feedback === "up" ? "is-selected" : ""
                                    }${isFeedbackLoading ? " is-loading" : ""}`}
                                    onClick={() => {
                                      if (!canFeedback) return;
                                      // 같은 버튼 재클릭 시 아무 동작 없음 (평가 해제 불가)
                                      if (feedback === "up") return;
                                      onFeedbackChange(msg.id, "up");
                                    }}
                                    title={!hasServerId ? "피드백 불가 (메시지 처리 중)" : "좋은 응답"}
                                    aria-label="도움이 되었어요"
                                    aria-pressed={feedback === "up"}
                                    disabled={!canFeedback}
                                  >
                                    <img
                                      src={feedbackGoodIcon}
                                      alt="좋은 응답"
                                      className="cb-chat-bubble-action-icon"
                                    />
                                  </button>

                                  <button
                                    type="button"
                                    className={`cb-chat-bubble-icon-btn cb-chat-feedback-btn ${
                                      feedback === "down" ? "is-selected" : ""
                                    }${isFeedbackLoading ? " is-loading" : ""}`}
                                    onClick={() => {
                                      if (!canFeedback) return;
                                      // 같은 버튼 재클릭 시 아무 동작 없음 (평가 해제 불가)
                                      if (feedback === "down") return;
                                      onFeedbackChange(msg.id, "down");
                                    }}
                                    title={!hasServerId ? "피드백 불가 (메시지 처리 중)" : "별로인 응답"}
                                    aria-label="별로인 응답이에요"
                                    aria-pressed={feedback === "down"}
                                    disabled={!canFeedback}
                                  >
                                    <img
                                      src={feedbackBadIcon}
                                      alt="별로예요"
                                      className="cb-chat-bubble-action-icon"
                                    />
                                  </button>
                                </>
                              );
                            })()}
                          </div>

                          {sourceQuestion && onRetryFromMessage && (
                            <button
                              type="button"
                              className={`cb-chat-bubble-icon-btn${
                                retryLoadingMessageId === msg.id ? " is-loading" : ""
                              }`}
                              onClick={() => {
                                // in-flight 차단: 이미 재시도 중이면 무시
                                if (retryLoadingMessageId) return;
                                onRetryFromMessage(sourceQuestion, "retry");
                              }}
                              disabled={isSending || Boolean(retryLoadingMessageId)}
                              title={retryLoadingMessageId ? "재시도 중..." : "다시 시도"}
                              aria-label="다시 시도"
                            >
                              <img
                                src={retryIcon}
                                alt="다시 시도"
                                className="cb-chat-bubble-action-icon"
                              />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {showTypingBubble && (
          <div className="cb-chat-bubble-row cb-chat-bubble-row-bot cb-chat-bubble-row-loading">
            <div className="cb-chat-bubble-container cb-chat-bubble-container-bot">
              <div className="cb-chat-bubble cb-chat-bubble-bot cb-chat-bubble-loading">
                <div className="cb-typing-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // 헤더 타이틀
  const headerTitle = isFaqDomain ? "FAQ" : getChatHeaderTitle(userRole);

  // 메인(환영 화면)에서는 칩 숨기고, 채팅 메시지가 있는 "채팅방"에서만 칩 표시
  const showHeaderChips = hasMessages;

  return (
    <>
      <main className="cb-main">
        <header className="cb-main-header">
          <div className="cb-main-header-row">
            <h2 className="cb-main-title">{headerTitle}</h2>

            {showHeaderChips && (
              <div className="cb-main-header-chips">
                {roleChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={`cb-main-chip-btn ${chip.className}`}
                    onClick={chip.onClick}
                    disabled={isSending}
                    title={chip.label}
                    aria-label={`${chip.label} 화면 열기`}
                  >
                    {chip.label}
                  </button>
                ))}

                {/* FAQ 도메인에서는 “일반(챗봇)” 복귀 칩 제공 */}
                {isFaqDomain ? (
                  <button
                    type="button"
                    className="cb-main-chip-btn cb-main-chip-general"
                    onClick={handleGoGeneral}
                    disabled={isSending}
                  >
                    챗봇
                  </button>
                ) : (
                  isGeneralDomain && (
                    <button
                      type="button"
                      className="cb-main-chip-btn cb-main-chip-faq"
                      onClick={handleFaqChipClick}
                      disabled={isSending}
                    >
                      FAQ
                    </button>
                  )
                )}

                <button
                  type="button"
                  className="cb-main-chip-btn cb-main-chip-edu"
                  onClick={handleEduClick}
                  disabled={isSending}
                >
                  교육
                </button>
                <button
                  type="button"
                  className="cb-main-chip-btn cb-main-chip-quiz"
                  onClick={handleQuizClick}
                  disabled={isSending}
                >
                  퀴즈
                </button>
              </div>
            )}
          </div>
        </header>

        <section className="cb-main-content">
          <div className="cb-chat-scroll">
            {/* 홈 영역: 메시지가 없을 때만 환영 카드 + 퀴즈/교육(+역할) + FAQ 노출 */}
            {!hasMessages && (
              <div className="cb-feature-container">
                <div className="cb-welcome-row">
                  <img
                    src={robotIcon}
                    alt="챗봇 아이콘"
                    className="cb-welcome-icon"
                  />
                  <div className="cb-welcome-text">
                    <p>안녕하세요.</p>
                    <p>Ctrl F의 챗봇(BlinQ)이 서비스를 시작합니다.</p>
                  </div>
                </div>

                <div
                  className={
                    "cb-feature-row" +
                    (hasMiddleRoleCard ? " cb-feature-row--admin" : "")
                  }
                >
                  <button
                    type="button"
                    className="cb-feature-card"
                    onClick={handleQuizClick}
                  >
                    <img
                      src={quizIcon}
                      alt="퀴즈"
                      className="cb-feature-icon"
                    />
                    <span className="cb-feature-label">퀴즈</span>
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      className="cb-feature-card cb-feature-card-admin"
                      onClick={handleOpenAdminDashboard}
                      disabled={isSending}
                    >
                      <img
                        src={adminIcon}
                        alt="관리자 대시보드"
                        className="cb-feature-icon"
                      />
                      <span className="cb-feature-label">관리자</span>
                    </button>
                  )}

                  {isReviewer && (
                    <button
                      type="button"
                      className="cb-feature-card cb-feature-card-role"
                      onClick={handleOpenReviewerDesk}
                      disabled={isSending}
                    >
                      <img
                        src={reviewIcon}
                        alt="콘텐츠 검토"
                        className="cb-feature-icon"
                      />
                      <span className="cb-feature-label">검토</span>
                    </button>
                  )}

                  {isCreator && (
                    <button
                      type="button"
                      className="cb-feature-card cb-feature-card-role"
                      onClick={handleOpenCreatorStudio}
                      disabled={isSending}
                    >
                      <img
                        src={studioIcon}
                        alt="교육 콘텐츠 제작"
                        className="cb-feature-icon"
                      />
                      <span className="cb-feature-label">제작</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="cb-feature-card"
                    onClick={handleEduClick}
                  >
                    <img src={eduIcon} alt="교육" className="cb-feature-icon" />
                    <span className="cb-feature-label">교육</span>
                  </button>
                </div>

                {/* 하단: 자주하는 질문 (API: home + top10) */}
                {renderFaqSection()}
              </div>
            )}

            {renderMessages()}

            {/* FAQ 도메인일 때: 스레드 하단에 카테고리 + 추천/top10 노출 */}
            {isFaqDomain && (
              <div className="cb-faq-thread-section">{renderFaqSection()}</div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 하단 입력 영역 (FAQ 채팅방에서는 숨김) */}
          {!isFaqDomain && (
            <div className="cb-input-section">
              <p className="cb-input-title">무엇이든 물어보세요!</p>

              {isSending && (
                <p className="cb-input-hint">답변을 생성하고 있어요…</p>
              )}

              <div
                className={
                  "cb-input-pill" + (isSending ? " cb-input-pill-disabled" : "")
                }
              >
                <button
                  type="button"
                  className="cb-input-plus"
                  disabled={isSending}
                >
                  +
                </button>
                <textarea
                  ref={inputRef}
                  className="cb-input"
                  placeholder=""
                  aria-label="질문 입력"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  disabled={isSending}
                  rows={1}
                />
                <button
                  type="button"
                  className="cb-input-send"
                  onClick={handleSend}
                  disabled={isSending || !inputValue.trim()}
                >
                  <span className="cb-send-icon">▶</span>
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* 신고 모달 */}
      {isReportModalOpen && (
        <div
          className="cb-report-backdrop"
          onMouseDown={(e) => {
            // backdrop 클릭 닫기(모달 바디 클릭은 유지)
            if (e.target === e.currentTarget) handleCloseReportModal();
          }}
        >
          <div
            className="cb-report-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cb-report-title"
          >
            <header className="cb-report-header">
              <h3 id="cb-report-title" className="cb-report-title">
                신고하기
              </h3>
              <button
                type="button"
                className="cb-report-close-btn"
                onClick={handleCloseReportModal}
                aria-label="신고 창 닫기"
              >
                ✕
              </button>
            </header>

            <div className="cb-report-body">
              <section className="cb-report-section">
                <div className="cb-report-label-row">
                  <span className="cb-report-pin">📌</span>
                  <span className="cb-report-label">신고유형</span>
                </div>
                <div className="cb-report-types">
                  직장 내 괴롭힘 / 성희롱 / 욕설, 혐오발언 /<br />
                  보안 위반 / 보안 사고 / etc
                </div>
              </section>

              <section className="cb-report-section">
                <div className="cb-report-label-row">
                  <span className="cb-report-pin">📌</span>
                  <span className="cb-report-label">상세 내용 입력</span>
                </div>

                <div className="cb-report-textarea-wrapper">
                  <textarea
                    ref={reportTextareaRef}
                    className="cb-report-textarea"
                    placeholder="신고내용을 입력해주세요.(상황, 시간, 장소, 문제 내용 등)"
                    value={reportContent}
                    onChange={(e) => {
                      setReportContent(e.target.value);
                      if (reportError) setReportError(null);
                    }}
                    onKeyDown={(e) => {
                      // 제품 UX: Ctrl+Enter 제출
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        handleSubmitReportClick();
                      }
                    }}
                  />
                </div>

                {reportError && (
                  <div className="cb-report-error-text">{reportError}</div>
                )}
              </section>

              <section className="cb-report-section cb-report-section-guide">
                <div className="cb-report-guide-title-row">
                  <span className="cb-report-guide-icon">⚠️</span>
                  <span className="cb-report-guide-title">안내</span>
                </div>
                <ul className="cb-report-guide-list">
                  <li>허위 신고 시 불이익이 발생할 수 있습니다.</li>
                  <li>제출 후 검토가 진행됩니다.</li>
                </ul>
              </section>
            </div>

            <footer className="cb-report-footer">
              <button
                type="button"
                className="cb-report-btn cb-report-btn-cancel"
                onClick={handleCloseReportModal}
              >
                취소
              </button>
              <button
                type="button"
                className="cb-report-btn cb-report-btn-submit"
                onClick={handleSubmitReportClick}
                disabled={!reportContent.trim()}
                title={
                  !reportContent.trim() ? "신고 내용을 입력해 주세요." : "제출"
                }
              >
                제출하기
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatWindow;
