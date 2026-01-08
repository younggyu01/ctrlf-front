# ctrlf-front

CTRL+F 프로젝트의 React + TypeScript + Vite 기반 프론트엔드 애플리케이션입니다.
Keycloak 인증, 역할 기반 접근 제어, AI 챗봇, 교육 관리, FAQ 관리 등 다양한 기능을 제공합니다.

## 주요 기능

- **AI 챗봇**: 사규/정책, 교육, HR 관련 질의응답 (RAG + LLM)
- **스트리밍 응답**: 실시간 토큰 스트리밍 지원
- **교육 관리**: 교육 영상 조회, 진행도 추적, 필수 교육 목록
- **FAQ 관리**: FAQ 조회, 검색, 카테고리별 필터링
- **퀴즈**: 교육 관련 퀴즈 풀이 및 결과 확인
- **관리자 대시보드**: 통계, 로그, 사용자 관리, RAG 문서 관리
- **검토자 데스크**: 교육 콘텐츠 검토 및 승인/반려
- **제작자 스튜디오**: 교육 영상 제작 및 스크립트 편집
- **역할 기반 접근 제어**: Keycloak 기반 사용자 역할별 기능 제한
- **반응형 UI**: Dark/Glassmorphism 디자인, 드래그 가능한 플로팅 패널

## 연동 서비스

| 서비스            | 포트 | 설명                    |
| ----------------- | ---- | ----------------------- |
| **chat-service**  | 9005 | 챗봇 서비스              |
| **education-service** | 9002 | 교육 서비스          |
| **infra-service** | 9003 | 인프라 서비스 (S3, RAG) |
| **api-gateway**   | 8080 | API 게이트웨이          |
| **Keycloak**      | 8090 | 인증 서버               |
| **ctrlf-ai**      | 8000 | AI Gateway (RAG, LLM)   |

---

## 사전 준비물

- Node.js 22.19.0
- npm >= 10.0.0
- Docker / Docker Compose v2 (프로덕션 배포 시)
- Keycloak 서버 (인증용)

---

## 빠른 시작

### 방법 1: 로컬 개발 (Hot Reload)

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (포트 5173)
npm run dev

# 브라우저에서 자동으로 열림: http://localhost:5173
```

- 개발 서버는 코드 수정 시 자동으로 Hot Module Replacement(HMR)가 적용됩니다.
- Vite 프록시 설정으로 백엔드 API를 자동으로 프록시합니다 (vite.config.ts 참고).

### 방법 2: 프로덕션 빌드

```bash
# TypeScript 타입 체크 + 빌드
npm run build

# 빌드 결과물 확인
npm run preview

# 빌드 산출물: dist/ 폴더
```

### 방법 3: Docker (프로덕션/배포)

```bash
# 빌드
docker build -t ctrlf-front:latest .

# 실행
docker run -p 80:80 ctrlf-front:latest

# 확인
curl http://localhost
```

---

## 환경변수

프론트엔드는 Vite 환경변수를 사용합니다. `.env` 파일을 생성하여 설정합니다.

```env
# Keycloak 설정
VITE_KEYCLOAK_URL=http://localhost:8090
VITE_KEYCLOAK_REALM=ctrlf
VITE_KEYCLOAK_CLIENT_ID=web-app

# 백엔드 API (개발 환경에서는 vite.config.ts의 proxy 설정 사용)
# 프로덕션에서는 nginx 설정 또는 환경변수로 관리
VITE_API_BASE_URL=http://localhost:8080
```

환경변수는 `import.meta.env.VITE_*` 형태로 접근합니다.

---

## API 프록시 설정

개발 환경에서 Vite는 다음 경로를 백엔드 서비스로 프록시합니다:

| 프론트엔드 경로        | 백엔드 서비스      | 실제 경로 변환              |
| --------------------- | ------------------ | -------------------------- |
| `/api-edu/*`          | education-service  | `/*`                       |
| `/api-infra/files/*`  | infra-service      | `/infra/files/*`           |
| `/api-infra/infra/*`  | infra-service      | `/infra/*`                 |
| `/api-infra/rag/*`    | infra-service      | `/rag/*`                   |
| `/api-infra/*`        | infra-service      | `/*`                       |
| `/api/chat/admin/*`   | chat-service       | `/admin/*`                 |
| `/api/chat/*`         | chat-service       | `/api/chat/*`              |
| `/chat/*`             | chat-service       | `/chat/*` (WebSocket 지원) |
| `/api/faq/*`          | chat-service       | `/faq/*`                   |
| `/faq/*`              | chat-service       | `/faq/*`                   |
| `/admin/faq*`         | chat-service       | `/admin/faq*`              |

프록시 설정은 `vite.config.ts`에서 관리됩니다.

---

## Keycloak 인증

### 기본 설정

| 항목     | 값                      |
| -------- | ----------------------- |
| Base URL | `http://localhost:8090` |
| Realm    | `ctrlf`                 |
| Client   | `web-app`               |

값은 `src/keycloak.ts`에서 변경할 수 있습니다.

### 사용자 역할

프론트엔드는 다음 역할을 지원합니다:

| 역할                | 설명                    | 주요 기능                          |
| ------------------- | ----------------------- | ---------------------------------- |
| **SYSTEM_ADMIN**    | 시스템 관리자           | 관리자 대시보드, 통계, 로그 조회   |
| **COMPLAINT_MANAGER** | 민원 관리자          | (향후 구현)                        |
| **CONTENTS_REVIEWER** | 콘텐츠 검토자        | 검토자 데스크, 승인/반려           |
| **VIDEO_CREATOR**   | 교육 영상 제작자        | 제작자 스튜디오, 스크립트 편집     |
| **EMPLOYEE**        | 일반 직원               | 챗봇, 교육 조회, FAQ 조회          |

### 역할 우선순위

여러 역할이 할당된 경우 다음 우선순위로 Primary Role이 결정됩니다:

1. SYSTEM_ADMIN
2. COMPLAINT_MANAGER
3. CONTENTS_REVIEWER
4. VIDEO_CREATOR
5. EMPLOYEE

### 역할 기반 접근 제어

- **SYSTEM_ADMIN**: 관리자 대시보드만 접근 가능
- **CONTENTS_REVIEWER**: 검토자 데스크만 접근 가능
- **VIDEO_CREATOR**: 제작자 스튜디오만 접근 가능
- **EMPLOYEE**: 기본 챗봇, 교육, FAQ 기능 사용

역할 정규화 및 권한 체크는 `src/auth/roles.ts`에서 관리됩니다.

### 토큰 자동 갱신

Keycloak 토큰은 만료 60초 전에 자동으로 갱신됩니다 (30초마다 체크).
갱신 로직은 `src/main.tsx`에 구현되어 있습니다.

---

## 프로젝트 구조

```
ctrlf-front/
├── src/
│   ├── main.tsx                    # 진입점, Keycloak 초기화
│   ├── App.tsx                     # 라우팅 설정
│   ├── keycloak.ts                 # Keycloak 클라이언트 설정
│   ├── index.css                   # 전역 스타일
│   │
│   ├── auth/
│   │   └── roles.ts                # 역할 정의 및 권한 체크
│   │
│   ├── components/
│   │   ├── Layout.tsx              # 공통 레이아웃 (사이드바, 헤더)
│   │   │
│   │   ├── chatbot/                # 챗봇 관련 컴포넌트
│   │   │   ├── ChatbotApp.tsx      # 챗봇 메인 앱
│   │   │   ├── ChatWindow.tsx      # 채팅 창
│   │   │   ├── Sidebar.tsx         # 세션 사이드바
│   │   │   ├── FloatingChatbotRoot.tsx  # 플로팅 챗봇 루트
│   │   │   ├── FloatingDock.tsx    # 플로팅 도크
│   │   │   ├── EduPanel.tsx        # 교육 패널
│   │   │   ├── QuizPanel.tsx       # 퀴즈 패널
│   │   │   ├── ReviewerDeskView.tsx # 검토자 데스크
│   │   │   ├── CreatorStudioView.tsx # 제작자 스튜디오
│   │   │   ├── chatApi.ts           # 채팅 API
│   │   │   ├── educationServiceApi.ts # 교육 API
│   │   │   ├── reviewerApi.ts      # 검토자 API
│   │   │   ├── creatorApi.ts        # 제작자 API
│   │   │   └── ...
│   │   │
│   │   ├── dashboard/               # 관리자 대시보드
│   │   │   ├── AdminDashboardView.tsx
│   │   │   ├── AdminRagGapView.tsx
│   │   │   ├── AdminFilterBar.tsx
│   │   │   ├── api/                 # 대시보드 API
│   │   │   └── components/          # 대시보드 하위 컴포넌트
│   │   │
│   │   └── common/
│   │       └── api/
│   │           └── authHttp.ts      # 인증 포함 HTTP 유틸
│   │
│   ├── pages/                       # 그룹웨어 페이지 컴포넌트
│   │   ├── Dashboard.tsx
│   │   ├── EducationPage.tsx
│   │   ├── MyPage.tsx
│   │   ├── ApprovalPage.tsx
│   │   ├── MessagePage.tsx
│   │   ├── EventPage.tsx
│   │   ├── NoticePage.tsx
│   │   └── OrgChartPage.tsx
│   │
│   ├── types/
│   │   └── chat.ts                  # 채팅 관련 타입
│   │
│   └── utils/
│       └── chat.ts                  # 채팅 유틸리티
│
├── public/                           # 정적 리소스
├── nginx/                            # Nginx 설정 (프로덕션)
├── kubernetes/                       # Kubernetes 배포 설정
├── docs/                             # 문서
├── vite.config.ts                    # Vite 설정
├── tsconfig.json                     # TypeScript 설정
├── package.json
└── Dockerfile
```

---

## 주요 컴포넌트

### 챗봇 (ChatbotApp)

- **위치**: `src/components/chatbot/ChatbotApp.tsx`
- **기능**: AI 채팅 세션 관리, 메시지 전송/수신, 스트리밍 응답 처리
- **특징**:
  - 드래그 가능한 플로팅 패널
  - 세션별 사이드바
  - 마크다운 렌더링
  - 피드백 (좋아요/싫어요) 제출
  - 재시도 기능

### 교육 패널 (EduPanel)

- **위치**: `src/components/chatbot/EduPanel.tsx`
- **기능**: 교육 영상 목록, 재생, 진행도 추적
- **연동**: education-service

### 퀴즈 패널 (QuizPanel)

- **위치**: `src/components/chatbot/QuizPanel.tsx`
- **기능**: 퀴즈 목록, 문제 풀이, 결과 확인
- **연동**: education-service

### 관리자 대시보드 (AdminDashboardView)

- **위치**: `src/components/dashboard/AdminDashboardView.tsx`
- **기능**: 통계, 로그 조회, 사용자 관리, RAG 문서 관리
- **권한**: SYSTEM_ADMIN만 접근 가능
- **탭**:
  - 통계 (Metrics)
  - 챗봇 (Chatbot)
  - 교육 (Education)
  - FAQ
  - 퀴즈 (Quiz)
  - 로그 (Logs)
  - 계정 (Accounts)
  - 정책 (Policy)

### 검토자 데스크 (ReviewerDeskView)

- **위치**: `src/components/chatbot/ReviewerDeskView.tsx`
- **기능**: 교육 콘텐츠 검토, 승인/반려, 코멘트 작성
- **권한**: CONTENTS_REVIEWER만 접근 가능

### 제작자 스튜디오 (CreatorStudioView)

- **위치**: `src/components/chatbot/CreatorStudioView.tsx`
- **기능**: 교육 영상 제작, 스크립트 편집, 씬 관리
- **권한**: VIDEO_CREATOR만 접근 가능

---

## 빌드 및 배포

### 개발 빌드

```bash
npm run build
```

빌드 결과물은 `dist/` 폴더에 생성됩니다.

### 프로덕션 빌드 (Docker)

```bash
# 이미지 빌드
docker build -t ctrlf-front:latest .

# 컨테이너 실행
docker run -d -p 80:80 --name ctrlf-front ctrlf-front:latest
```

### Kubernetes 배포

```bash
# 배포
kubectl apply -f kubernetes/front-deploy.yaml
kubectl apply -f kubernetes/front-service.yaml

# 상태 확인
kubectl get pods -l app=ctrlf-front
kubectl get svc front-service
```

---

## 테스트

### 타입 체크

```bash
npm run build
# TypeScript 컴파일러가 타입 오류를 검사합니다
```

### 린트

```bash
npm run lint
```

### 개발 서버 확인

```bash
npm run dev
# 브라우저에서 http://localhost:5173 접속하여 기능 테스트
```

---

## 문제 해결 (Troubleshooting)

| 문제                         | 해결 방법                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 포트 충돌                    | 5173 포트가 사용 중인지 확인, `vite.config.ts`에서 포트 변경 가능                                                      |
| Keycloak 연결 실패            | `VITE_KEYCLOAK_URL` 환경변수 확인, Keycloak 서버 실행 여부 확인                                                       |
| API 프록시 오류              | 백엔드 서비스 실행 여부 확인 (9002, 9003, 9005), `vite.config.ts`의 proxy 설정 확인                                   |
| 빌드 실패                    | Node.js 버전 확인 (22.19.0), `npm install` 재실행, `node_modules` 삭제 후 재설치                                      |
| 토큰 갱신 실패               | Keycloak 서버 상태 확인, 브라우저 콘솔에서 에러 메시지 확인                                                             |
| 역할 인식 안 됨              | Keycloak에서 사용자 역할 할당 확인, `src/auth/roles.ts`의 역할 정규화 로직 확인                                        |
| CORS 오류                    | 개발 환경에서는 Vite 프록시 사용, 프로덕션에서는 nginx 설정 또는 백엔드 CORS 설정 확인                                  |
| S3 업로드 실패               | Presigned URL 발급 API 호출 성공 여부 확인, S3 버킷 권한 확인, 커스텀 헤더(Auth 등) 제거 확인                           |

---

## 개발 가이드

### 코드 컨벤션

- **언어**: TypeScript, React (Function Component + Hooks)
- **스타일링**: CSS 파일 사용 (inline style 금지)
- **네이밍**:
  - 컴포넌트: PascalCase (예: `ChatbotApp`)
  - 함수/변수: camelCase (예: `sendMessage`)
  - 상수: UPPER_SNAKE_CASE (예: `MAX_RETRY_COUNT`)
  - 타입: PascalCase (예: `ChatMessage`)
- **파일 구조**:
  - UI 컴포넌트: `*.tsx`
  - API 호출: `*Api.ts`
  - 타입 정의: `*Types.ts` 또는 `types/*.ts`
  - 유틸리티: `utils/*.ts`

### 스타일 가이드

- **CSS 클래스**: BEM-like 네이밍 (`cb-*` prefix 사용)
- **디자인**: Dark/Glassmorphism 톤 유지
- **반응형**: 모바일/태블릿/데스크톱 대응
- **접근성**: 키보드 네비게이션, 포커스 링 지원

### API 호출 규칙

- 인증이 필요한 호출은 `src/components/common/api/authHttp.ts`의 `fetchJson` 사용
- AbortSignal을 사용하여 컴포넌트 unmount 시 요청 취소
- S3 Presigned URL은 발급 API만 authHttp 사용, 실제 업로드/다운로드는 순수 PUT/GET

### 상태 관리

- React Hooks (useState, useEffect, useCallback, useMemo) 사용
- 전역 상태 관리 라이브러리는 사용하지 않음 (필요 시 Context API 사용)

### 역할 및 권한

- 역할 정규화: `normalizeRoles()` 함수 사용
- Primary Role 선택: `pickPrimaryRole()` 함수 사용
- 권한 체크: `can(userRole, capability)` 함수 사용

자세한 개발 규칙은 `.cursor/rules/ctrlf-frontend.mdc` 참고

---

## 기능별 테스트 가이드

### 1. 챗봇 기능 테스트

#### 1-1. 기본 채팅

1. 브라우저에서 `http://localhost:5173` 접속
2. Keycloak 로그인
3. 플로팅 도크에서 챗봇 아이콘 클릭
4. 메시지 입력 후 전송
5. AI 응답 확인

#### 1-2. 스트리밍 응답

1. 챗봇에서 긴 질문 입력
2. 실시간으로 토큰이 스트리밍되는지 확인
3. 중간에 취소 가능한지 확인

#### 1-3. 세션 관리

1. 새 세션 생성
2. 세션 목록에서 이전 세션 선택
3. 세션별 메시지 히스토리 확인

---

### 2. 교육 기능 테스트

#### 2-1. 교육 목록 조회

1. 챗봇에서 교육 패널 열기
2. 교육 목록 확인
3. 필터링/검색 기능 테스트

#### 2-2. 교육 영상 재생

1. 교육 영상 선택
2. 재생 확인
3. 진행도 저장 확인

---

### 3. FAQ 기능 테스트

#### 3-1. FAQ 조회

1. 챗봇에서 FAQ 검색
2. 카테고리별 필터링
3. FAQ 상세 확인

---

### 4. 관리자 대시보드 테스트

#### 4-1. 접근 권한 확인

1. SYSTEM_ADMIN 역할로 로그인
2. 관리자 대시보드 접근 가능 확인
3. 다른 역할로 로그인 시 접근 불가 확인

#### 4-2. 통계 조회

1. 관리자 대시보드 → 통계 탭
2. KPI 카드 확인
3. 차트 데이터 확인

#### 4-3. 로그 조회

1. 관리자 대시보드 → 로그 탭
2. 필터링 (도메인, 날짜, 의도 등)
3. 로그 상세 확인

---

### 5. 검토자 데스크 테스트

#### 5-1. 접근 권한 확인

1. CONTENTS_REVIEWER 역할로 로그인
2. 검토자 데스크 접근 가능 확인

#### 5-2. 검토 작업

1. 검토 대기 목록 확인
2. 콘텐츠 상세 확인
3. 승인/반려 처리
4. 코멘트 작성

---

### 6. 제작자 스튜디오 테스트

#### 6-1. 접근 권한 확인

1. VIDEO_CREATOR 역할로 로그인
2. 제작자 스튜디오 접근 가능 확인

#### 6-2. 영상 제작

1. 새 프로젝트 생성
2. 스크립트 편집
3. 씬 관리
4. 파일 업로드 (S3)

---

### 7. S3 파일 업로드 테스트

#### 7-1. Presigned URL 발급

1. 파일 선택
2. Presigned URL 발급 API 호출
3. 토큰 포함 여부 확인

#### 7-2. S3 업로드

1. Presigned URL로 PUT 요청
2. 커스텀 헤더(Auth 등) 제거 확인
3. 업로드 성공 확인

---

### 8. Keycloak 토큰 갱신 테스트

#### 8-1. 자동 갱신

1. 브라우저 개발자 도구 → Network 탭
2. 30초마다 토큰 갱신 요청 확인
3. 만료 60초 전 갱신 확인

#### 8-2. 갱신 실패 처리

1. Keycloak 서버 중지
2. 토큰 갱신 실패 시 로그아웃 또는 에러 처리 확인

---

## 라이선스

Private - CTRL+F Team

---