// src/components/chatbot/QuizPanel.tsx
import React, { useEffect, useRef, useState } from "react";
import "./chatbot.css";
import {
  computePanelPosition,
  type Anchor,
  type PanelSize,
} from "../../utils/chat";
import { initialCourses, type QuizCourse } from "./quizData";

type Size = PanelSize;
type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type ResizeState = {
  resizing: boolean;
  dir: ResizeDirection | null;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startTop: number;
  startLeft: number;
};

type DragState = {
  dragging: boolean;
  startX: number;
  startY: number;
  startTop: number;
  startLeft: number;
};

const MIN_WIDTH = 520;
const MIN_HEIGHT = 420;
const INITIAL_SIZE: Size = { width: 540, height: 420 };

// 통과 기준 점수
const PASSING_SCORE = 80;

// localStorage key
const STORAGE_KEY = "ctrlf_quiz_courses_v1";
const WRONG_NOTES_KEY = "ctrlf_quiz_wrong_notes_v1";

// =========================
// 데이터 타입
// =========================

type DepartmentScore = {
  id: string;
  name: string;
  avgScore: number; // 0~100
  progress: number; // 0~100, 전체 진행률
};

interface QuizPanelProps {
  anchor?: Anchor | null;
  onClose: () => void;
  onOpenNote?: (courseId: string) => void;
  unlockedCourseIds?: string[];
}

type PanelMode = "dashboard" | "solve" | "note";

// 퀴즈 문제 타입
type QuizQuestion = {
  id: string;
  text: string;
  options: string[];
  correctIndex: number; // 정답 보기 index
};

// 알림 배너 타입
type ResultType = "success" | "warning" | "info";

type ResultMessage = {
  type: ResultType;
  title: string;
  description?: string;
};

// 오답노트 엔트리
type WrongAnswerEntry = {
  courseId: string;
  attemptIndex: number; // 0: 1회차, 1: 2회차
  questionIndex: number; // 0-based
  questionNumber: number; // 1,2,3...
  questionText: string;
  explanation: string;
};

// =========================
// 문제 데이터 (정답 포함)
// =========================

const quizQuestionBank: Record<string, QuizQuestion[]> = {
  harassment: [
    {
      id: "harassment-q1",
      text: "직장 내 성희롱에 대한 설명으로 가장 올바른 것은 무엇인가요?",
      options: [
        "상사가 한 말은 농담이므로 성희롱이 될 수 없다.",
        "성별과 관계없이 성적 굴욕감이나 불쾌감을 주는 모든 행동이 성희롱이 될 수 있다.",
        "근무시간 외에는 어떤 행동도 성희롱이 될 수 없다.",
        "피해자가 바로 항의하지 않으면 성희롱이 아니다.",
      ],
      correctIndex: 1,
    },
    {
      id: "harassment-q2",
      text: "다음 중 직장 내 성희롱에 해당할 수 있는 행동은 무엇인가요?",
      options: [
        "업무 보고에 대해 피드백을 주는 것",
        "외모나 옷차림에 대해 성적 농담을 반복하는 것",
        "회의 일정을 조정해 달라고 요청하는 것",
        "팀 회식 장소를 함께 논의하는 것",
      ],
      correctIndex: 1,
    },
    {
      id: "harassment-q3",
      text: "성희롱 예방을 위해 관리자가 해야 할 적절한 행동은 무엇인가요?",
      options: [
        "문제가 생기면 그때 가서 대응하면 된다고 생각한다.",
        "성희롱 관련 교육을 정기적으로 실시하고, 신고 절차를 안내한다.",
        "피해를 주장하는 직원에게 조용히 넘어가자고 설득한다.",
        "가해자로 지목된 직원의 말을 우선적으로 믿는다.",
      ],
      correctIndex: 1,
    },
    {
      id: "harassment-q4",
      text: "다음 중 성희롱 피해를 받은 동료를 대하는 올바른 태도는 무엇인가요?",
      options: [
        "괜히 일 키우지 말라고 조언한다.",
        "자세한 내용을 사적인 호기심으로 캐묻는다.",
        "상담 창구나 신고 절차를 안내해 주고, 원하면 동행을 제안한다.",
        "본인이 직접 가해자에게 따지러 간다.",
      ],
      correctIndex: 2,
    },
    {
      id: "harassment-q5",
      text: "사내 메신저에서의 성적인 농담과 이미지는 어떻게 보는 것이 맞을까요?",
      options: [
        "사적인 공간이므로 전혀 문제가 되지 않는다.",
        "서로 친하면 괜찮으므로 별도 기준이 없다.",
        "업무용 도구에서도 상대가 불쾌감을 느끼면 성희롱이 될 수 있다.",
        "부서장이 허용하면 괜찮다.",
      ],
      correctIndex: 2,
    },
    {
      id: "harassment-q6",
      text: "성희롱 신고가 접수되었을 때 회사가 해야 할 조치로 가장 적절한 것은?",
      options: [
        "소문이 나지 않도록 아무 조치도 하지 않는다.",
        "피해자에게 사직을 권유한다.",
        "신속하게 사실관계를 조사하고, 2차 피해가 발생하지 않도록 보호조치를 한다.",
        "가해자로 지목된 사람의 의견만 먼저 듣고 종결한다.",
      ],
      correctIndex: 2,
    },
    {
      id: "harassment-q7",
      text: "다음 중 직장 내 성희롱 예방 교육이 필요한 이유로 가장 적절한 것은?",
      options: [
        "법에서 정했으니 어쩔 수 없이 받아야 하기 때문이다.",
        "교육 이수 여부만 체크하면 되기 때문이다.",
        "모든 구성원이 기준을 공유하고, 서로 존중하는 문화를 만들기 위해서이다.",
        "문제가 생겼을 때 책임을 피하기 위해서이다.",
      ],
      correctIndex: 2,
    },
    {
      id: "harassment-q8",
      text: "성희롱 피해를 입은 직원이 상담을 요청했을 때 관리자의 바람직한 태도는?",
      options: [
        "개인의 문제라며 업무 이야기를 하자고 돌려 말한다.",
        "감정적으로 반응하며 가해자를 즉시 공개 비난한다.",
        "차분히 이야기를 듣고, 공식 절차와 지원 제도를 안내한다.",
        "무조건 참고 넘어가라고 말한다.",
      ],
      correctIndex: 2,
    },
    {
      id: "harassment-q9",
      text: "다음 중 성희롱 관련 2차 피해에 해당하는 행동은 무엇인가요?",
      options: [
        "피해자에게 상담 센터를 안내한다.",
        "사건 내용을 팀 회식 자리에서 농담처럼 퍼뜨린다.",
        "사건과 무관한 팀원들의 근무시간을 조정한다.",
        "외부 전문가에게 자문을 구한다.",
      ],
      correctIndex: 1,
    },
    {
      id: "harassment-q10",
      text: "성희롱 예방을 위한 개인의 실천으로 가장 적절한 것은?",
      options: [
        "상대방의 반응과 상관없이 농담을 계속한다.",
        "언어·행동이 상대에게 어떻게 느껴질지 먼저 생각하고 조심한다.",
        "상대방이 불편하다고 말해도 농담이라고 웃어넘긴다.",
        "상대방의 SNS를 몰래 확인하고 평가한다.",
      ],
      correctIndex: 1,
    },
  ],

  privacy: [
    {
      id: "privacy-q1",
      text: "개인정보에 해당하는 정보로 가장 적절한 것은 무엇인가요?",
      options: [
        "회사 전체 매출액",
        "직원의 이름과 주민등록번호",
        "공개된 회사 주소",
        "제품 단가 정보",
      ],
      correctIndex: 1,
    },
    {
      id: "privacy-q2",
      text: "다음 중 개인정보를 안전하게 관리하는 방법은 무엇인가요?",
      options: [
        "공용 PC에 비밀번호를 자동 저장해 둔다.",
        "업무 편의를 위해 동료와 계정을 공유한다.",
        "문서를 사용하지 않을 때는 잠금 장치가 있는 서랍/보관함에 보관한다.",
        "USB에 암호 없이 저장해 다닌다.",
      ],
      correctIndex: 2,
    },
    {
      id: "privacy-q3",
      text: "고객 정보를 외부에 제공해야 하는 상황에서 가장 올바른 조치는?",
      options: [
        "상대 회사가 믿을 만하면 동의 없이 제공한다.",
        "업무 지시이므로 사전 안내 없이 전달한다.",
        "법적 근거 또는 고객의 동의 여부를 확인한 뒤 필요한 최소한의 정보만 제공한다.",
        "전체 엑셀 파일을 그대로 보낸다.",
      ],
      correctIndex: 2,
    },
    {
      id: "privacy-q4",
      text: "다음 중 개인정보 유출 가능성을 높이는 행동은 무엇인가요?",
      options: [
        "종이 문서를 분쇄 후 폐기한다.",
        "회의실 화이트보드에 고객 이름을 적어 둔 채 사진을 찍어 SNS에 올린다.",
        "PC 잠금 기능을 활성화한다.",
        "사무실 출입을 카드로 통제한다.",
      ],
      correctIndex: 1,
    },
    {
      id: "privacy-q5",
      text: "업무 종료 후 해야 할 개인정보 보호 조치로 가장 적절한 것은?",
      options: [
        "모니터에 띄워진 화면을 그대로 두고 퇴근한다.",
        "고객 정보를 담은 문서를 책상 위에 올려두고 자리를 뜬다.",
        "PC를 잠그거나 로그아웃하고, 문서는 지정된 장소에 보관 또는 파쇄한다.",
        "동료에게 대신 보관해 달라고 맡긴다.",
      ],
      correctIndex: 2,
    },
    {
      id: "privacy-q6",
      text: "비밀번호 관리에 대한 설명 중 올바른 것은?",
      options: [
        "여러 서비스에 같은 비밀번호를 사용하는 것이 편하고 안전하다.",
        "비밀번호를 포스트잇에 적어 모니터에 붙여 둔다.",
        "주기적으로 변경하고, 추측하기 어렵게 설정한다.",
        "생년월일이나 전화번호처럼 기억하기 쉬운 숫자를 사용한다.",
      ],
      correctIndex: 2,
    },
    {
      id: "privacy-q7",
      text: "개인정보를 포함한 이메일을 보낼 때 가장 주의해야 할 사항은?",
      options: [
        "받는 사람 주소를 여러 명 추가할수록 좋다.",
        "파일을 압축하더라도 암호를 걸지 않는다.",
        "수신자 주소와 첨부 파일을 한 번 더 확인하고, 필요 시 암호화한다.",
        "제목에 '개인정보'라고만 적으면 충분하다.",
      ],
      correctIndex: 2,
    },
    {
      id: "privacy-q8",
      text: "다음 중 개인정보 최소 수집 원칙에 맞는 예시는?",
      options: [
        "서비스 가입에 주민등록번호, 가족 정보까지 모두 받는다.",
        "이벤트 참여에 이름과 연락처 정도만 수집한다.",
        "향후 마케팅에 필요할 수 있으니 가능한 한 많이 수집한다.",
        "직무와 상관없는 사적인 정보를 요구한다.",
      ],
      correctIndex: 1,
    },
    {
      id: "privacy-q9",
      text: "개인정보 침해가 의심될 때 직원이 취해야 할 가장 적절한 행동은?",
      options: [
        "혼자 해결하려고 시도한다.",
        "관련 내용을 사적인 SNS에 먼저 올린다.",
        "회사 내 개인정보 보호 담당자나 보안 담당자에게 즉시 알린다.",
        "문제를 피하기 위해 그냥 넘어간다.",
      ],
      correctIndex: 2,
    },
    {
      id: "privacy-q10",
      text: "업무에서 더 이상 사용하지 않는 개인정보를 처리하는 올바른 방법은?",
      options: [
        "언제 필요할지 모르니 계속 보관한다.",
        "개인용 메일로 보내 개인적으로 보관한다.",
        "관련 법령과 내부 정책에 따라 안전하게 파기 또는 익명화한다.",
        "USB에 옮겨 아무 곳에나 둔다.",
      ],
      correctIndex: 2,
    },
  ],

  bullying: [
    {
      id: "bullying-q1",
      text: "직장 내 괴롭힘의 기본 개념으로 가장 적절한 것은 무엇인가요?",
      options: [
        "직급에 따른 정당한 업무 지시",
        "업무상 적정 범위를 넘어 신체적·정신적 고통을 주는 행위",
        "업무 성과에 대한 객관적 평가",
        "정기적인 업무 보고 요구",
      ],
      correctIndex: 1,
    },
    {
      id: "bullying-q2",
      text: "다음 중 직장 내 괴롭힘에 해당할 수 있는 행동은?",
      options: [
        "필요한 교육 기회를 제공하는 것",
        "특정 직원을 반복적으로 따돌리거나 회의에서 의도적으로 배제하는 것",
        "업무 매뉴얼을 안내하는 것",
        "휴가 사용 방법을 설명하는 것",
      ],
      correctIndex: 1,
    },
    {
      id: "bullying-q3",
      text: "후배 직원에게 반복적으로 모욕적인 별명을 부르는 행동은 어떻게 보아야 할까요?",
      options: [
        "친해지기 위한 방법이므로 문제가 없다.",
        "당사자가 싫다고 표현하지 않았으니 괜찮다.",
        "상대에게 굴욕감·수치심을 줄 수 있어 괴롭힘이 될 수 있다.",
        "부서장이 허락했다면 상관없다.",
      ],
      correctIndex: 2,
    },
    {
      id: "bullying-q4",
      text: "괴롭힘 피해를 호소하는 동료에게 가장 적절한 말은?",
      options: [
        "그 정도는 어디서나 있는 일이라고 대수롭지 않게 여긴다.",
        "괜히 문제 만들지 말라고 한다.",
        "경청하고 공감하며, 공식적인 상담 창구와 절차를 안내한다.",
        "가해자로 지목된 사람을 대신 비난해 준다.",
      ],
      correctIndex: 2,
    },
    {
      id: "bullying-q5",
      text: "다음 중 직장 내 괴롭힘 예방을 위한 조직 문화로 가장 적절한 것은?",
      options: [
        "성과만 좋으면 어떤 말과 행동도 허용되는 문화",
        "상명하복을 강조해 질문을 허용하지 않는 문화",
        "상호 존중과 소통을 중시하고, 문제 제기를 안전하게 할 수 있는 문화",
        "개인 간 갈등은 회사가 개입하지 않는 문화",
      ],
      correctIndex: 2,
    },
    {
      id: "bullying-q6",
      text: "관리자가 업무 지시를 할 때 괴롭힘으로 오해받지 않기 위해 필요한 태도는?",
      options: [
        "공개적인 자리에서 감정적으로 질책한다.",
        "개인의 인격을 비난하며 지시한다.",
        "구체적인 기준과 기대를 설명하고, 존중하는 태도로 피드백한다.",
        "실수에 대해 모두가 보는 앞에서 망신을 준다.",
      ],
      correctIndex: 2,
    },
    {
      id: "bullying-q7",
      text: "괴롭힘 신고가 접수되었을 때 회사가 먼저 해야 할 일은?",
      options: [
        "피해자에게 침묵을 요청한다.",
        "가해자로 지목된 사람에게만 사실 여부를 확인한다.",
        "사실관계를 공정하게 조사하고, 관련자에게 불이익이 가지 않도록 보호 조치를 취한다.",
        "소문이 퍼지지 않게 피해자를 다른 부서로 전출한다.",
      ],
      correctIndex: 2,
    },
    {
      id: "bullying-q8",
      text: "다음 중 직장 내 괴롭힘 2차 가해에 해당하는 것은?",
      options: [
        "피해자에게 상담 기관 정보를 알려준다.",
        "피해자의 행동을 탓하며 '네가 참았으면 좋았을 텐데'라고 말한다.",
        "조사 결과를 비밀로 유지한다.",
        "중립적인 태도로 사실을 확인한다.",
      ],
      correctIndex: 1,
    },
    {
      id: "bullying-q9",
      text: "괴롭힘 예방 교육의 주요 목적은 무엇인가요?",
      options: [
        "형식적인 이수율만 채우기 위해서",
        "분위기를 다소 엄격하게 만들기 위해서",
        "괴롭힘의 기준을 이해하고, 서로를 존중하는 직장 문화를 만들기 위해서",
        "가해자를 색출하기 위해서",
      ],
      correctIndex: 2,
    },
    {
      id: "bullying-q10",
      text: "동료 간 갈등이 생겼을 때 바람직한 해결 방식은?",
      options: [
        "소문을 퍼뜨려 상대를 고립시킨다.",
        "SNS에 상대방을 비난하는 글을 올린다.",
        "당사자 간 대화를 시도하고, 필요 시 제3자의 중재나 공식 절차를 활용한다.",
        "일절 말을 하지 않고 무시한다.",
      ],
      correctIndex: 2,
    },
  ],

  disability: [
    {
      id: "disability-q1",
      text: "장애인에 대한 올바른 표현은 무엇인가요?",
      options: [
        "불구자, 병신",
        "장애인, 장애가 있는 사람",
        "정상인이 아닌 사람",
        "불편한 사람들",
      ],
      correctIndex: 1,
    },
    {
      id: "disability-q2",
      text: "장애인과 대화할 때의 적절한 태도가 아닌 것은?",
      options: [
        "옆에 있는 보호자에게만 말하고, 당사자에게는 말하지 않는다.",
        "말이 느리더라도 끝까지 듣고 기다린다.",
        "필요할 때는 '이 부분 설명 다시 해드려도 될까요?'라고 정중하게 묻는다.",
        "상대방의 속도에 맞춰 천천히 이야기한다.",
      ],
      correctIndex: 0,
    },
    {
      id: "disability-q3",
      text: "청각장애인 동료와 소통할 때 가장 적절한 방법은?",
      options: [
        "목소리를 아주 크게 질러서 말한다.",
        "알아듣지 못하면 그냥 포기하고 다른 동료에게만 설명한다.",
        "입 모양이 잘 보이게 천천히 말하고, 필요하면 메신저/메모를 활용한다.",
        "‘내가 안 들리니까 중요한 일은 맡기는 게 낫겠다’고 생각한다.",
      ],
      correctIndex: 2,
    },
    {
      id: "disability-q4",
      text: "장애인 동료와 함께 일할 때 필요한 기본 태도는?",
      options: [
        "장애를 가진 사람으로만 바라본다.",
        "업무 능력과 역할을 중심으로 동료로 대한다.",
        "실수할까 봐 중요한 업무는 절대 맡기지 않는다.",
        "항상 도움을 주어야 한다고 생각한다.",
      ],
      correctIndex: 1,
    },
    {
      id: "disability-q5",
      text: "휠체어를 사용하는 동료와 함께 이동할 때 가장 적절한 행동은?",
      options: [
        "본인 의사와 상관없이 휠체어를 밀어준다.",
        "휠체어 손잡이를 잡기 전에 먼저 도움 필요 여부를 물어본다.",
        "이동이 불편해 보이면 그냥 회의에 부르지 않는다.",
        "계단만 있는 곳으로 안내한다.",
      ],
      correctIndex: 1,
    },
    {
      id: "disability-q6",
      text: "장애인 인식 개선 교육이 필요한 이유로 가장 적절한 것은?",
      options: [
        "법정 교육 시간이 정해져 있기 때문이다.",
        "장애인에 대한 편견과 차별을 줄이고, 함께 일하기 좋은 환경을 만들기 위해서이다.",
        "장애인 채용 비율을 맞추기 위해서이다.",
        "교육 이수증을 발급받기 위해서이다.",
      ],
      correctIndex: 1,
    },
    {
      id: "disability-q7",
      text: "발달장애인을 대할 때 가장 적절한 의사소통 방법은?",
      options: [
        "어린아이 대하듯 과장된 말투로 이야기한다.",
        "짧고 분명한 문장으로 천천히 설명하고, 이해했는지 확인한다.",
        "질문을 하지 못하게 한다.",
        "대답을 기다리지 않고 바로 결론을 말해 준다.",
      ],
      correctIndex: 1,
    },
    {
      id: "disability-q8",
      text: "장애인의 입장에서 불편함을 최소화하기 위한 직장 내 배려로 적절한 것은?",
      options: [
        "장애인 동료는 회의에 참여하지 않도록 한다.",
        "모든 동료가 사용할 수 있는 높이의 책상·출입문 등을 마련한다.",
        "장애인만 사용하는 별도의 공간을 만들어 항상 분리한다.",
        "장애인 동료의 자리를 가장 안쪽에 배치한다.",
      ],
      correctIndex: 1,
    },
    {
      id: "disability-q9",
      text: "장애인 동료가 도움을 요청했을 때 적절한 태도는?",
      options: [
        "바쁘다는 이유로 항상 거절한다.",
        "도움이 필요하다고 말하기 전에 먼저 모든 일을 대신 처리한다.",
        "요청 내용을 듣고 가능한 범위에서 도와주거나, 다른 도움 창구를 안내한다.",
        "도움을 요청한 사실을 다른 동료들에게 소문낸다.",
      ],
      correctIndex: 2,
    },
    {
      id: "disability-q10",
      text: "장애인과 함께 일하는 직장 문화로 가장 바람직한 것은?",
      options: [
        "장애 여부에 따라 역할을 고정하는 문화",
        "장애인과 비장애인이 서로를 동등한 동료로 존중하는 문화",
        "장애인과의 교류를 최소화하는 문화",
        "장애인의 의견을 중요하지 않게 여기는 문화",
      ],
      correctIndex: 1,
    },
  ],
};

// =========================
// 부서 점수 더미
// =========================

const initialDepartments: DepartmentScore[] = [
  { id: "hr", name: "인사팀", avgScore: 85, progress: 50 },
  { id: "general", name: "총무팀", avgScore: 85, progress: 50 },
  { id: "plan", name: "기획팀", avgScore: 85, progress: 50 },
  { id: "marketing", name: "마케팅팀", avgScore: 85, progress: 50 },
  { id: "finance", name: "재무팀", avgScore: 85, progress: 50 },
  { id: "dev", name: "개발팀", avgScore: 85, progress: 50 },
  { id: "sales", name: "영업팀", avgScore: 85, progress: 50 },
  { id: "legal", name: "법무팀", avgScore: 85, progress: 50 },
];

// 🔹 unlockedCourseIds 반영해서 기본 course 생성
const buildInitialCourses = (unlockedCourseIds?: string[]): QuizCourse[] => {
  if (!unlockedCourseIds || unlockedCourseIds.length === 0) {
    return initialCourses;
  }
  return initialCourses.map((course) =>
    unlockedCourseIds.includes(course.id)
      ? { ...course, unlocked: true }
      : course
  );
};

// 🔹 localStorage 에서 기존 점수 복원 + 언락 반영
const loadCoursesFromStorage = (
  unlockedCourseIds?: string[]
): QuizCourse[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return buildInitialCourses(unlockedCourseIds);
    }
    const stored = JSON.parse(raw) as QuizCourse[];
    return stored.map((c) => ({
      ...c,
      unlocked:
        c.unlocked ||
        (unlockedCourseIds ? unlockedCourseIds.includes(c.id) : false),
    }));
  } catch {
    return buildInitialCourses(unlockedCourseIds);
  }
};

// 🔹 오답노트 복원
const loadWrongNotesFromStorage = (): WrongAnswerEntry[] => {
  try {
    const raw = window.localStorage.getItem(WRONG_NOTES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WrongAnswerEntry[];
  } catch {
    return [];
  }
};

// ✅ 카드 개수 계산
const getDeptPageSize = (panelWidth: number): number => {
  if (panelWidth < 680) return 3;
  if (panelWidth < 960) return 4;
  if (panelWidth < 1240) return 5;
  return 6;
};

const getQuizPageSize = (panelWidth: number): number => {
  if (panelWidth < 680) return 2;
  if (panelWidth < 980) return 3;
  if (panelWidth < 1280) return 4;
  return 5;
};

// 🔹 오답 해설 문장 생성(간단 버전)
const buildExplanation = (
  courseId: string,
  question: QuizQuestion
): string => {
  const answer = question.options[question.correctIndex];

  switch (courseId) {
    case "harassment":
      return `정답은 "${answer}"입니다. 직장 내 성희롱의 정의와 예방 원칙을 가장 잘 설명하는 보기입니다. 상대방의 입장에서 성적 굴욕감이나 불쾌감을 느낄 수 있는 언행은 모두 성희롱이 될 수 있다는 점을 기억해야 합니다.`;
    case "privacy":
      return `정답은 "${answer}"입니다. 개인정보는 식별 가능한 개인과 직접적으로 연결되는 정보이므로, 최소 수집·목적 외 사용 금지·안전한 보관과 파기 원칙을 지켜야 합니다.`;
    case "bullying":
      return `정답은 "${answer}"입니다. 직장 내 괴롭힘은 '업무상 적정 범위를 넘어' 반복적으로 신체적·정신적 고통을 주는 행위라는 점이 핵심입니다. 서로를 존중하는 조직 문화를 만드는 것이 중요합니다.`;
    case "disability":
      return `정답은 "${answer}"입니다. 장애를 가진 사람을 비하하거나 낙인찍는 표현 대신, '장애인' 또는 '장애가 있는 사람'처럼 존중을 담은 표현을 사용하는 것이 바람직합니다.`;
    default:
      return `정답은 "${answer}"입니다. 보기들 중에서 문제의 취지와 기준에 가장 잘 맞는 선택지입니다.`;
  }
};

const QuizPanel: React.FC<QuizPanelProps> = ({
  anchor,
  onClose,
  onOpenNote,
  unlockedCourseIds,
}) => {
  // === 패널 크기 + 위치 ===
  const [size, setSize] = useState<Size>(INITIAL_SIZE);
  const [panelPos, setPanelPos] = useState(() =>
    computePanelPosition(anchor ?? null, INITIAL_SIZE)
  );

  const resizeRef = useRef<ResizeState>({
    resizing: false,
    dir: null,
    startX: 0,
    startY: 0,
    startWidth: INITIAL_SIZE.width,
    startHeight: INITIAL_SIZE.height,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  const dragRef = useRef<DragState>({
    dragging: false,
    startX: 0,
    startY: 0,
    startTop: panelPos.top,
    startLeft: panelPos.left,
  });

  const contentRef = useRef<HTMLDivElement | null>(null);

  const [departments] = useState<DepartmentScore[]>(initialDepartments);

  // 🔹 점수를 localStorage 에 저장/복원
  const [courses, setCourses] = useState<QuizCourse[]>(() =>
    loadCoursesFromStorage(unlockedCourseIds)
  );

  // 🔹 오답노트 데이터 (과목/회차별 틀린 문제)
  const [wrongNotes, setWrongNotes] = useState<WrongAnswerEntry[]>(() =>
    loadWrongNotesFromStorage()
  );

  const [deptPage, setDeptPage] = useState(0);
  const [quizPage, setQuizPage] = useState(0);

  const [mode, setMode] = useState<PanelMode>("dashboard");
  const [solveCourse, setSolveCourse] = useState<QuizCourse | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);

  // 오답노트 전용 상태
  const [noteCourse, setNoteCourse] = useState<QuizCourse | null>(null);
  const [noteAttemptIndex, setNoteAttemptIndex] = useState<number>(0);
  const [noteModal, setNoteModal] = useState<WrongAnswerEntry | null>(null);

  // 알림 배너 상태
  const [resultMessage, setResultMessage] = useState<ResultMessage | null>(
    null
  );

  const showResultMessage = (
    type: ResultType,
    title: string,
    description?: string
  ) => {
    setResultMessage({ type, title, description });
  };

  // 알림 자동 닫기
  useEffect(() => {
    if (!resultMessage) return;
    const timer = window.setTimeout(() => setResultMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [resultMessage]);

  // 🔹 courses 변경 시 localStorage 저장
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
    } catch {
      // ignore
    }
  }, [courses]);

  // 🔹 wrongNotes 변경 시 localStorage 저장
  useEffect(() => {
    try {
      window.localStorage.setItem(WRONG_NOTES_KEY, JSON.stringify(wrongNotes));
    } catch {
      // ignore
    }
  }, [wrongNotes]);

  // 🔹 unlockedCourseIds 가 변경되면 언락 반영
  useEffect(() => {
    if (!unlockedCourseIds || unlockedCourseIds.length === 0) return;
    setCourses((prev) =>
      prev.map((c) =>
        unlockedCourseIds.includes(c.id) ? { ...c, unlocked: true } : c
      )
    );
  }, [unlockedCourseIds]);

  // ===== 페이지 계산 =====
  const deptPageSize = getDeptPageSize(size.width);
  const totalDeptPages =
    Math.max(1, Math.ceil(departments.length / deptPageSize)) || 1;
  const safeDeptPage = Math.min(deptPage, totalDeptPages - 1);
  const deptStart = safeDeptPage * deptPageSize;
  const visibleDepartments = departments.slice(
    deptStart,
    deptStart + deptPageSize
  );

  const quizPageSize = getQuizPageSize(size.width);
  const totalQuizPages =
    Math.max(1, Math.ceil(courses.length / quizPageSize)) || 1;
  const safeQuizPage = Math.min(quizPage, totalQuizPages - 1);
  const quizStart = safeQuizPage * quizPageSize;
  const visibleCourses = courses.slice(quizStart, quizStart + quizPageSize);

  const extraWidth = Math.max(0, size.width - INITIAL_SIZE.width);
  const baseCardHeight = 150;
  const maxCardHeight = 210;

  const responsiveCardHeight = Math.min(
    maxCardHeight,
    baseCardHeight + extraWidth / 8
  );

  // 🔹 패널 높이 자동 조정
  useEffect(() => {
    if (!contentRef.current) return;

    const contentHeight = contentRef.current.offsetHeight;
    const desiredHeight = Math.min(
      Math.max(contentHeight + 40, MIN_HEIGHT),
      window.innerHeight - 80
    );

    setSize((prev) => {
      if (Math.abs(prev.height - desiredHeight) < 2) return prev;
      return { ...prev, height: desiredHeight };
    });

    setPanelPos((prev) => {
      const margin = 16;
      const maxTop = window.innerHeight - margin - desiredHeight;
      const top = Math.max(margin, Math.min(prev.top, maxTop));
      return { ...prev, top };
    });
  }, [size.width, mode]);

  // ===== 드래그 / 리사이즈 =====
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeRef.current;
      const dragState = dragRef.current;

      const margin = 16;
      const padding = 32;

      if (resizeState.resizing && resizeState.dir) {
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;

        let newWidth = resizeState.startWidth;
        let newHeight = resizeState.startHeight;
        let newTop = resizeState.startTop;
        let newLeft = resizeState.startLeft;

        const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - padding * 2);
        const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - padding * 2);

        if (resizeState.dir.includes("e")) {
          newWidth = resizeState.startWidth + dx;
        }
        if (resizeState.dir.includes("s")) {
          newHeight = resizeState.startHeight + dy;
        }
        if (resizeState.dir.includes("w")) {
          newWidth = resizeState.startWidth - dx;
          newLeft = resizeState.startLeft + dx;
        }
        if (resizeState.dir.includes("n")) {
          newHeight = resizeState.startHeight - dy;
          newTop = resizeState.startTop + dy;
        }

        newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, newHeight));

        const maxLeft = window.innerWidth - margin - newWidth;
        const maxTop = window.innerHeight - margin - newHeight;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        setSize({ width: newWidth, height: newHeight });
        setPanelPos({ top: newTop, left: newLeft });
        return;
      }

      if (dragState.dragging) {
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        let newTop = dragState.startTop + dy;
        let newLeft = dragState.startLeft + dx;

        const maxLeft = window.innerWidth - margin - size.width;
        const maxTop = window.innerHeight - margin - size.height;

        newLeft = Math.max(margin, Math.min(maxLeft, newLeft));
        newTop = Math.max(margin, Math.min(maxTop, newTop));

        setPanelPos({ top: newTop, left: newLeft });
      }
    };

    const handleMouseUp = () => {
      if (resizeRef.current.resizing) {
        resizeRef.current.resizing = false;
        resizeRef.current.dir = null;
      }
      if (dragRef.current.dragging) {
        dragRef.current.dragging = false;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [size.width, size.height]);

  const handleResizeMouseDown =
    (dir: ResizeDirection) =>
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      resizeRef.current = {
        resizing: true,
        dir,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: size.width,
        startHeight: size.height,
        startTop: panelPos.top,
        startLeft: panelPos.left,
      };
      dragRef.current.dragging = false;
    };

  const handleDragMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startTop: panelPos.top,
      startLeft: panelPos.left,
    };
    resizeRef.current.resizing = false;
    resizeRef.current.dir = null;
  };

  // ===== 페이지 전환 =====
  const handlePrevDept = () => {
    setDeptPage((prev) => Math.max(prev - 1, 0));
  };

  const handleNextDept = () => {
    const pageSize = getDeptPageSize(size.width);
    const maxPage = Math.max(0, Math.ceil(departments.length / pageSize) - 1);
    setDeptPage((prev) => Math.min(prev + 1, maxPage));
  };

  const handlePrevQuiz = () => {
    setQuizPage((prev) => Math.max(prev - 1, 0));
  };

  const handleNextQuiz = () => {
    const pageSize = getQuizPageSize(size.width);
    const maxPage = Math.max(0, Math.ceil(courses.length / pageSize) - 1);
    setQuizPage((prev) => Math.min(prev + 1, maxPage));
  };

  // 회차 토글
  const handleToggleAttempt = (courseId: string, index: number) => {
    setCourses((prev) =>
      prev.map((course) =>
        course.id === courseId ? { ...course, activeIndex: index } : course
      )
    );

    setSolveCourse((prev) =>
      prev && prev.id === courseId ? { ...prev, activeIndex: index } : prev
    );

    // 오답노트에서 회차 바꾸고 있는 중이라면 같이 동기화
    setNoteCourse((prev) =>
      prev && prev.id === courseId ? { ...prev, activeIndex: index } : prev
    );
    setNoteAttemptIndex(index);
  };

  const handleOpenNoteClick = (course: QuizCourse) => {
    if (!course.unlocked) return;

    setNoteCourse(course);
    setNoteAttemptIndex(course.activeIndex ?? 0);
    setMode("note");

    if (onOpenNote) {
      onOpenNote(course.id);
    }
  };

  // 🔹 퀴즈 시작 (다음 응시 가능한 회차 계산)
  const handleStartQuiz = (course: QuizCourse) => {
    if (!course.unlocked) return;

    const firstScore = course.scores[0];
    const secondScore = course.scores[1];

    let attemptIndex: number | null = null;

    if (firstScore == null) {
      attemptIndex = 0;
    } else if (firstScore < PASSING_SCORE && secondScore == null) {
      attemptIndex = 1;
    }

    if (attemptIndex === null) {
      showResultMessage(
        "info",
        "퀴즈 응시 안내",
        "이미 2회까지 응시를 완료했거나 기준 점수를 넘어 재응시가 제한됩니다."
      );
      return;
    }

    const questions = quizQuestionBank[course.id] ?? [];
    setSelectedAnswers(questions.map(() => -1));

    setCourses((prev) =>
      prev.map((c) =>
        c.id === course.id ? { ...c, activeIndex: attemptIndex! } : c
      )
    );

    setSolveCourse({ ...course, activeIndex: attemptIndex });
    setMode("solve");
  };

  const handleBackFromSolve = () => {
    setMode("dashboard");
    setSolveCourse(null);
    setSelectedAnswers([]);
  };

  const handleBackFromNote = () => {
    setMode("dashboard");
    setNoteCourse(null);
    setNoteModal(null);
  };

  const currentQuestions: QuizQuestion[] = solveCourse
    ? quizQuestionBank[solveCourse.id] ?? []
    : [];

  const handleSelectOption = (qIndex: number, optionIndex: number) => {
    setSelectedAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = optionIndex;
      return next;
    });
  };

  const handleSubmitAnswers = () => {
    if (!solveCourse) return;

    const questions = currentQuestions;
    if (questions.length === 0) return;

    const allAnswered =
      selectedAnswers.length === questions.length &&
      selectedAnswers.every((idx) => idx >= 0);

    if (!allAnswered) {
      showResultMessage(
        "warning",
        "답변이 완료되지 않았습니다",
        "모든 문항에 대해 보기 하나를 선택해 주세요."
      );
      return;
    }

    let correctCount = 0;
    questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correctIndex) correctCount++;
    });

    const score = Math.round(
      (correctCount / questions.length) * solveCourse.maxScore
    );

    const attemptIndex = solveCourse.activeIndex ?? 0;

    // 🔹 오답노트 데이터 구성
    const wrongEntries: WrongAnswerEntry[] = questions
      .map((q, idx) => {
        const selected = selectedAnswers[idx];
        if (selected === q.correctIndex) return null;
        return {
          courseId: solveCourse.id,
          attemptIndex,
          questionIndex: idx,
          questionNumber: idx + 1,
          questionText: q.text,
          explanation: buildExplanation(solveCourse.id, q),
        };
      })
      .filter((v): v is WrongAnswerEntry => v !== null);

    // 기존 해당 과목/회차 오답 제거 후 새로 저장
    setWrongNotes((prev) => {
      const filtered = prev.filter(
        (item) =>
          !(
            item.courseId === solveCourse.id &&
            item.attemptIndex === attemptIndex
          )
      );
      return [...filtered, ...wrongEntries];
    });

    // courses 업데이트 (점수/activeIndex)
    setCourses((prev) =>
      prev.map((course) => {
        if (course.id !== solveCourse.id) return course;

        const newScores = [...course.scores];
        newScores[attemptIndex] = score;

        let newActiveIndex = course.activeIndex;
        if (
          attemptIndex === 0 &&
          score < PASSING_SCORE &&
          course.scores.length > 1 &&
          course.scores[1] === null
        ) {
          newActiveIndex = 1;
        }

        return {
          ...course,
          scores: newScores,
          activeIndex: newActiveIndex,
        };
      })
    );

    // solveCourse 동기화
    setSolveCourse((prev) => {
      if (!prev) return prev;
      const newScores = [...prev.scores];
      newScores[attemptIndex] = score;

      let newActiveIndex = prev.activeIndex;
      if (
        attemptIndex === 0 &&
        score < PASSING_SCORE &&
        prev.scores.length > 1 &&
        prev.scores[1] === null
      ) {
        newActiveIndex = 1;
      }

      return {
        ...prev,
        scores: newScores,
        activeIndex: newActiveIndex,
      };
    });

    const passed = score >= PASSING_SCORE;

    if (passed) {
      showResultMessage(
        "success",
        "합격입니다 🎉",
        `점수는 ${score}점입니다. 기준 점수(${PASSING_SCORE}점)를 넘어 합격했습니다.`
      );
    } else if (attemptIndex === 0) {
      showResultMessage(
        "warning",
        "2회차 응시가 가능합니다",
        `점수는 ${score}점입니다. 기준 점수(${PASSING_SCORE}점) 미만으로 한 번 더 응시할 수 있습니다.`
      );
    } else {
      showResultMessage(
        "info",
        "응시가 종료되었습니다",
        `점수는 ${score}점입니다. 최대 2회까지 응시할 수 있으며, 이번 시험으로 해당 회차 응시가 종료되었습니다.`
      );
    }

    // 제출 후 대시보드로 이동
    handleBackFromSolve();
  };

  const canSubmit =
    mode === "solve" &&
    currentQuestions.length > 0 &&
    selectedAnswers.length === currentQuestions.length &&
    selectedAnswers.every((idx) => idx >= 0);

  // 🔹 현재 선택된 과목/회차의 오답 리스트
  const currentWrongNotes: WrongAnswerEntry[] =
    noteCourse != null
      ? wrongNotes.filter(
          (w) =>
            w.courseId === noteCourse.id &&
            w.attemptIndex === noteAttemptIndex
        )
      : [];

  return (
    <div className="cb-edu-wrapper">
      <div
        className="cb-edu-panel-container"
        style={{ top: panelPos.top, left: panelPos.left }}
      >
        <div
          className="cb-edu-panel cb-chatbot-panel"
          style={{ width: size.width, height: size.height }}
        >
          {/* 드래그 바 + 리사이즈 핸들 */}
          <div className="cb-drag-bar" onMouseDown={handleDragMouseDown} />

          <div
            className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-nw"
            onMouseDown={handleResizeMouseDown("nw")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-ne"
            onMouseDown={handleResizeMouseDown("ne")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-sw"
            onMouseDown={handleResizeMouseDown("sw")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-corner cb-resize-handle-se"
            onMouseDown={handleResizeMouseDown("se")}
          />

          <div
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-n"
            onMouseDown={handleResizeMouseDown("n")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-s"
            onMouseDown={handleResizeMouseDown("s")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-w"
            onMouseDown={handleResizeMouseDown("w")}
          />
          <div
            className="cb-resize-handle cb-resize-handle-edge cb-resize-handle-e"
            onMouseDown={handleResizeMouseDown("e")}
          />

          {/* 닫기 버튼 */}
          <button
            type="button"
            className="cb-panel-close-btn"
            onClick={onClose}
            aria-label="퀴즈 패널 닫기"
          >
            ✕
          </button>

          <div
            className="cb-edu-panel-inner"
            ref={contentRef}
            style={{ position: "relative" }}
          >
            {/* 하단 알림 배너 */}
            {resultMessage && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 16,
                  display: "flex",
                  justifyContent: "center",
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    pointerEvents: "auto",
                    maxWidth: 420,
                    padding: "10px 16px",
                    borderRadius: 999,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor:
                      resultMessage.type === "success"
                        ? "#ecfdf5"
                        : resultMessage.type === "warning"
                        ? "#fef3c7"
                        : "#eff6ff",
                    border:
                      "1px solid " +
                      (resultMessage.type === "success"
                        ? "#bbf7d0"
                        : resultMessage.type === "warning"
                        ? "#fde68a"
                        : "#bfdbfe"),
                    color: "#111827",
                    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.22)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontSize: 16 }}>
                    {resultMessage.type === "success"
                      ? "✅"
                      : resultMessage.type === "warning"
                      ? "⚠️"
                      : "ℹ️"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: resultMessage.description ? 2 : 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {resultMessage.title}
                    </div>
                    {resultMessage.description && (
                      <div
                        style={{
                          opacity: 0.95,
                          lineHeight: 1.4,
                          maxHeight: 40,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {resultMessage.description}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setResultMessage(null)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#374151",
                      cursor: "pointer",
                      fontSize: 14,
                      padding: 4,
                    }}
                    aria-label="알림 닫기"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* 대시보드 */}
            {mode === "dashboard" && (
              <div className="cb-quiz-panel" aria-label="교육 퀴즈 대시보드">
                {/* 부서별 점수판 */}
                <section className="cb-quiz-section">
                  <div className="cb-quiz-section-header">
                    <h2 className="cb-quiz-section-title">부서별 점수판</h2>
                  </div>

                  <div className="cb-quiz-dept-row">
                    <button
                      type="button"
                      className="cb-quiz-arrow-btn"
                      onClick={handlePrevDept}
                      disabled={safeDeptPage === 0}
                      aria-label="이전 부서 보기"
                    >
                      ◀
                    </button>

                    <div className="cb-quiz-dept-list">
                      {visibleDepartments.map((dept) => (
                        <div
                          key={dept.id}
                          className="cb-quiz-dept-card"
                          style={{ minHeight: responsiveCardHeight }}
                        >
                          <div className="cb-quiz-dept-name">{dept.name}</div>
                          <div className="cb-quiz-dept-score">
                            {dept.avgScore}점
                          </div>
                          <div className="cb-quiz-dept-progress-label">
                            전체 진행률&nbsp;
                            <span className="cb-quiz-dept-progress-value">
                              {dept.progress}%
                            </span>
                          </div>
                          <div className="cb-quiz-progress-bar">
                            <div
                              className="cb-quiz-progress-bar-fill"
                              style={{ width: `${dept.progress}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="cb-quiz-arrow-btn"
                      onClick={handleNextDept}
                      disabled={safeDeptPage >= totalDeptPages - 1}
                      aria-label="다음 부서 보기"
                    >
                      ▶
                    </button>
                  </div>
                </section>

                {/* Quiz 섹션 */}
                <section className="cb-quiz-section cb-quiz-section-quiz">
                  <div className="cb-quiz-section-header">
                    <h2 className="cb-quiz-section-title">Quiz</h2>
                  </div>

                  <div className="cb-quiz-course-row">
                    <button
                      type="button"
                      className="cb-quiz-arrow-btn"
                      onClick={handlePrevQuiz}
                      disabled={safeQuizPage === 0}
                      aria-label="이전 퀴즈 보기"
                    >
                      ◀
                    </button>

                    <div className="cb-quiz-course-list">
                      {visibleCourses.map((course) => {
                        const isLocked = !course.unlocked;

                        const totalAttempts = course.scores.length;
                        const activeIndex = course.activeIndex ?? 0;
                        const activeScore = course.scores[activeIndex];
                        const hasActiveScore =
                          activeScore !== null &&
                          activeScore !== undefined;

                        const displayScore = hasActiveScore
                          ? `${activeScore}점`
                          : "-";

                        const progressPercent = hasActiveScore
                          ? (activeScore / course.maxScore) * 100
                          : 0;

                        const firstScore = course.scores[0];
                        const secondScore = course.scores[1];

                        const canStartFirst = firstScore == null;
                        const canStartSecond =
                          firstScore !== null &&
                          firstScore < PASSING_SCORE &&
                          secondScore == null;

                        const canStartQuiz =
                          !isLocked && (canStartFirst || canStartSecond);

                        // 단일 버튼 클릭 핸들러
                        const handlePrimaryClick = () => {
                          if (isLocked) return;
                          if (!hasActiveScore && canStartQuiz) {
                            // 아직 시험 안 봤고 응시 가능 → 퀴즈 풀기
                            handleStartQuiz(course);
                          } else if (hasActiveScore) {
                            // 점수 있음 → 오답노트
                            handleOpenNoteClick(course);
                          }
                        };

                        const primaryLabel = hasActiveScore
                          ? "오답노트"
                          : "퀴즈 풀기";

                        const primaryDisabled =
                          isLocked || (!hasActiveScore && !canStartQuiz);

                        return (
                          <article
                            key={course.id}
                            className={
                              "cb-quiz-course-card" +
                              (isLocked ? " is-locked" : "")
                            }
                            style={{ minHeight: responsiveCardHeight }}
                          >
                            <header className="cb-quiz-course-header">
                              <h3 className="cb-quiz-course-title">
                                {course.title}
                              </h3>

                              <div className="cb-quiz-course-attempt-toggle">
                                {Array.from({ length: totalAttempts }).map(
                                  (_, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      className={
                                        "cb-quiz-attempt-dot" +
                                        (activeIndex === idx
                                          ? " is-active"
                                          : "")
                                      }
                                      onClick={() =>
                                        handleToggleAttempt(course.id, idx)
                                      }
                                      aria-label={`${idx + 1}회차 점수 보기`}
                                    >
                                      {idx + 1}
                                    </button>
                                  )
                                )}
                              </div>
                            </header>

                            <div className="cb-quiz-course-body">
                              <div className="cb-quiz-course-score-row">
                                <span className="cb-quiz-course-score-label">
                                  개인 점수
                                </span>
                                <span className="cb-quiz-course-score-value">
                                  {displayScore}
                                </span>
                              </div>

                              <div className="cb-quiz-progress-bar cb-quiz-course-progress">
                                <div
                                  className="cb-quiz-progress-bar-fill"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>

                              {isLocked && (
                                <p className="cb-quiz-locked-text">
                                  교육 영상 시청 완료 후 퀴즈를 풀 수 있어요.
                                </p>
                              )}
                            </div>

                            <footer className="cb-quiz-course-footer">
                              {!isLocked && (
                                <button
                                  type="button"
                                  className="cb-quiz-note-btn"
                                  disabled={primaryDisabled}
                                  onClick={handlePrimaryClick}
                                >
                                  {primaryLabel}
                                </button>
                              )}
                            </footer>
                          </article>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      className="cb-quiz-arrow-btn"
                      onClick={handleNextQuiz}
                      disabled={safeQuizPage >= totalQuizPages - 1}
                      aria-label="다음 퀴즈 보기"
                    >
                      ▶
                    </button>
                  </div>
                </section>
              </div>
            )}

            {/* 문제 풀기 화면 */}
            {mode === "solve" && solveCourse && (
              <div className="cb-quiz-solve-layout">
                <header className="cb-quiz-solve-header">
                  <div className="cb-quiz-solve-header-left">
                    <button
                      type="button"
                      className="cb-quiz-solve-back-btn"
                      onClick={handleBackFromSolve}
                      aria-label="퀴즈 목록으로 돌아가기"
                    >
                      ◀
                    </button>
                    <h2 className="cb-quiz-solve-title">퀴즈풀기</h2>
                    <div className="cb-quiz-solve-tabs">
                      {Array.from({ length: solveCourse.scores.length }).map(
                        (_, idx) => (
                          <div
                            key={idx}
                            className={
                              "cb-quiz-solve-tab" +
                              (solveCourse.activeIndex === idx
                                ? " is-active"
                                : "")
                            }
                          >
                            {idx + 1}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                  <div className="cb-quiz-solve-meta">
                    {solveCourse.title}
                  </div>
                </header>

                <div className="cb-quiz-solve-body">
                  <div className="cb-quiz-solve-card">
                    <div className="cb-quiz-solve-scroll">
                      {currentQuestions.map((q, idx) => (
                        <div className="cb-quiz-solve-question" key={q.id}>
                          <div className="cb-quiz-solve-question-title">
                            {idx + 1}. {q.text}
                          </div>
                          <ul className="cb-quiz-solve-options">
                            {q.options.map((opt, optIdx) => (
                              <li
                                key={optIdx}
                                className={
                                  "cb-quiz-solve-option" +
                                  (selectedAnswers[idx] === optIdx
                                    ? " is-selected"
                                    : "")
                                }
                                onClick={() =>
                                  handleSelectOption(idx, optIdx)
                                }
                              >
                                {opt}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>

                    <div className="cb-quiz-solve-submit-row">
                      <button
                        type="button"
                        className="cb-quiz-solve-submit-btn"
                        onClick={handleSubmitAnswers}
                        disabled={!canSubmit}
                      >
                        제출하기
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 오답노트 화면 */}
            {mode === "note" && noteCourse && (
              <div className="cb-quiz-note-layout">
                <header className="cb-quiz-note-header">
                  <div className="cb-quiz-note-header-left">
                    <button
                      type="button"
                      className="cb-quiz-note-back-btn"
                      onClick={handleBackFromNote}
                      aria-label="퀴즈 대시보드로 돌아가기"
                    >
                      ◀
                    </button>
                    <h2 className="cb-quiz-note-title">오답노트</h2>
                    <div className="cb-quiz-note-tabs">
                      {noteCourse.scores.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={
                            "cb-quiz-note-tab" +
                            (noteAttemptIndex === idx ? " is-active" : "")
                          }
                          onClick={() => setNoteAttemptIndex(idx)}
                          aria-label={`${idx + 1}회차 오답 보기`}
                        >
                          {idx + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cb-quiz-note-meta">{noteCourse.title}</div>
                </header>

                <div className="cb-quiz-note-body">
                  <div className="cb-quiz-note-card">
                    <div className="cb-quiz-note-table-header-row">
                      <div className="cb-quiz-note-header-cell">문제번호</div>
                      <div className="cb-quiz-note-header-cell">문제</div>
                      <div className="cb-quiz-note-header-cell">해설</div>
                    </div>

                    <div className="cb-quiz-note-table-scroll">
                      {currentWrongNotes.length === 0 ? (
                        <div className="cb-quiz-note-empty">
                          해당 회차에서 틀린 문제가 없습니다.
                        </div>
                      ) : (
                        currentWrongNotes.map((item) => (
                          <div
                            key={`${item.courseId}-${item.attemptIndex}-${item.questionIndex}`}
                            className="cb-quiz-note-row"
                          >
                            <div className="cb-quiz-note-question-no">
                              {item.questionNumber}
                            </div>
                            <div className="cb-quiz-note-question-text">
                              {item.questionText}
                            </div>
                            <div className="cb-quiz-note-explain-cell">
                              <button
                                type="button"
                                className="cb-quiz-note-explain-btn"
                                onClick={() => setNoteModal(item)}
                              >
                                해설보기
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* 해설 모달 */}
                {noteModal && (
                  <div className="cb-quiz-note-modal-backdrop">
                    <div className="cb-quiz-note-modal">
                      <div className="cb-quiz-note-modal-header">
                        <div className="cb-quiz-note-modal-title">
                          {noteModal.questionText}
                        </div>
                        <button
                          type="button"
                          className="cb-quiz-note-modal-close-btn"
                          onClick={() => setNoteModal(null)}
                          aria-label="해설 닫기"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="cb-quiz-note-modal-body">
                        {noteModal.explanation}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuizPanel;
