# Classic Lions — 앱 구현 아키텍처 & NLP 성능 최적화 설계

작성일: 2026-08-26
대상: `classic_lions_report.docx` 기반 프로토타입(React/Vite) → Flutter + 서버리스 프로덕션 전환

---

## 0. 전제와 결정 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 클라이언트 | **Flutter (Dart)** 재작성 | 보고서 원안, iOS/Android 스토어 배포 |
| 백엔드 | **서버리스 (Cloudflare Workers)** | API 키 은닉 + 캐시/벡터DB/큐가 한 벤더에 다 있음 |
| 최적화 우선순위 | 추천 품질 > 비용 > OCR > 지연 | 사용자 선택 (4축 전부, 순서는 임팩트순) |

**대안**: Firebase(Auth+Firestore+Functions)를 쓰면 보고서의 "향후 계획"과 그대로 맞지만, 벡터 검색을 별도 벤더(Pinecone 등)로 붙여야 한다. Cloudflare는 D1(SQL)·Vectorize(벡터)·KV(캐시)·R2(이미지)·Queues(배치)가 한 계정에서 끝나고 무료 티어가 이 규모엔 충분하다. 아래 설계는 Cloudflare 기준이되, 어댑터 계층을 둬서 Firebase로 갈아끼울 수 있게 한다.

---

## 1. 현재 프로토타입의 구조적 결함

아키텍처를 짜기 전에, 무엇을 고치는 설계인지 명확히 한다.

### 1-1. 치명적

**API 키 노출** — `vite.config.ts:14`
```js
define: { 'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY) }
```
Vite의 `define`은 빌드 시 **문자열 치환**이다. 번들 JS에 키가 평문으로 박힌다. 배포하는 순간 누구나 DevTools에서 꺼낸다. → 서버리스 전환의 1순위 이유.

**"Agentic RAG"인데 R(Retrieval)이 없다** — `geminiService.ts:88-96`
```js
expanded = await this.expandQuery(...);
systemPrompt += `\n추천 모드: ... [${expanded.join(', ')}]와 연관된 실제 공연을 찾으세요.`;
```
확장된 쿼리가 **프롬프트 문자열로만** 들어간다. 실제 검색 인덱스를 치지 않는다. 모델이 그 단어를 Google Search에 쓸지는 보장이 없고, 후보 풀이 없으니 **존재하지 않는 공연·이미 지난 공연을 추천해도 막을 방법이 없다.** 보고서 4-3의 "Query Expansion 과잉" 문제도 근본 원인이 이것이다 — 확장 결과를 검증할 후보 집합이 없어서 노이즈가 그대로 생성 단계로 흘러간다.

**피드백 루프가 더미 데이터를 학습** — `Dashboard.tsx:49-51`
```js
const reason = await summarizeFeedback({ title: "추천 공연", artist: "아티스트", ... });
```
실제 추천된 공연이 아니라 하드코딩 문자열을 LLM에 넘긴다. `summarizeFeedback`은 "추천 공연 by 아티스트를 좋아함" 같은 무의미한 문장을 만들고, 그게 다음 턴 System Instruction에 주입된다. **보고서 2-3의 플라이휠이 실제로는 돌지 않는다.**

### 1-2. 심각

| 위치 | 문제 |
|---|---|
| `App.tsx:14-16` | 상태가 전부 `useState`. 새로고침하면 아카이브·피드백 전소. 보고서의 "로컬 JSON 아카이브"는 구현 안 됨 |
| `TicketOCR.tsx:99` | 날짜 정규화가 `'2025년 3월 15일'` → `'2025-3-15'`. **zero-pad 없음** → `new Date()` 파싱은 되지만 문자열 정렬·비교가 깨짐. 보고서 4-1이 "해결됨"으로 기술한 버그가 실제로는 살아있음 |
| `geminiService.ts:16-27` | `expandQuery`만 스키마 없이 정규식 파싱(`text.match(/"([^"]+)".../)`). 보고서 3-1 "모든 LLM 호출에 JSON Schema 강제"와 모순 |
| `geminiService.ts:141` | `calculateStats()`가 호출되는 곳이 없음(dead code). statistics intent를 Pro 모델이 맨눈으로 세고 있음 — 느리고, 비싸고, 틀림 |
| `TicketOCR.tsx:105` | `composer: artist.includes('임윤찬') ? 'Rachmaninoff' : undefined`. 하드코딩. 작곡가는 `program`에서 파싱해야 함 |
| `TicketOCR.tsx:57-66` | OCR → enrich **직렬** 실행, 하나의 로더로 묶임. 사용자는 OCR 결과를 볼 수 있는데도 enrich가 끝날 때까지 기다림 |
| `geminiService.ts:64-83` | 매 턴 프로필 JSON 전체 + 관람 이력 전체 + 피드백 전체를 System Instruction에 재주입. 이력이 쌓일수록 토큰이 선형 증가, 캐시 없음 |

### 1-3. 보고서 ↔ 코드 불일치 (문서 수정 필요)

- 보고서: Flutter → 실제: React 19 + Vite
- 보고서: "로컬 JSON 아카이브 저장" → 실제: 메모리(useState)
- 보고서 3-2: "응답 속도 30%+ 개선" → 측정 근거 코드 없음. `AgentTimeline`은 단계별 실측만 하고 비교군이 없음

> 보고서를 그대로 둘 거라면 최소한 이 3개는 정정하는 걸 권한다. 러너톤 산출물로 남는 문서라면 검증 가능한 수치만 쓰는 게 안전하다.

---

## 2. 목표 아키텍처

### 2-1. 전체 구성

```
┌──────────────────────────────────────────────────────────┐
│  Flutter App (iOS / Android)                             │
│  ─────────────────────────────────────────────────────    │
│  Presentation   go_router · Riverpod                     │
│  Domain         UseCase (순수 Dart, 테스트 가능)          │
│  Data           Repository ─┬─ Drift (로컬 SQLite, SoT)   │
│                             └─ ApiClient (dio + SSE)     │
│  이미지          image_picker → 리사이즈/EXIF 보정 → 업로드│
└───────────────────────────┬──────────────────────────────┘
                            │ HTTPS / SSE
┌───────────────────────────┴──────────────────────────────┐
│  Edge API — Cloudflare Workers (TypeScript)              │
│  ─────────────────────────────────────────────────────    │
│  POST /v1/ocr          멀티모달 추출 + 신뢰도             │
│  POST /v1/enrich       프로그램 노트 (곡별 병렬, 스트림)  │
│  POST /v1/chat         SSE 스트리밍 큐레이션              │
│  POST /v1/feedback     구조화 신호 + 취향 프로필 갱신     │
│  GET  /v1/concerts     아카이브 동기화                    │
│  GET  /v1/search       하이브리드 검색 (디버그/직접호출)  │
└──┬────────┬────────┬────────┬────────┬───────────────────┘
   │        │        │        │        │
   │        │        │        │        └─→ Gemini API (키는 여기서만)
   │        │        │        └─→ KOPIS API (일 1회 배치, Queues)
   │        │        └─→ R2       티켓 원본 이미지
   │        └─→ KV        응답 캐시 · 시맨틱 캐시 · KOPIS 스냅샷
   └─→ D1 (SQLite)  concerts / archive / profile / feedback / works
       Vectorize     공연 임베딩 · 작품 지식 임베딩 · 사용자 취향 벡터
```

### 2-2. 왜 이 모양인가

**Local-first.** Drift(로컬 SQLite)가 UI의 단일 진실원이다. 화면은 항상 로컬 DB를 읽고, 서버 동기화는 백그라운드다. 지하철에서 티켓을 찍어도 저장되고(outbox 큐), 온라인이 되면 올라간다. 현재 프로토타입의 "새로고침하면 소멸" 문제가 구조적으로 사라진다.

**키는 엣지에만.** Flutter 바이너리는 디컴파일 가능하다. Gemini 키를 앱에 넣으면 웹 번들에 넣는 것과 똑같이 털린다. 모든 LLM 호출은 Worker를 경유한다.

**엣지에 두는 진짜 이유는 캐시다.** 키 은닉만이면 아무 서버나 된다. Workers를 고르는 건 KV 시맨틱 캐시·Vectorize 검색·D1 필터가 같은 런타임 안에 있어서 **RAG 한 사이클이 네트워크 홉 없이** 끝나기 때문이다. 3장의 최적화 대부분이 여기 의존한다.

---

## 3. 데이터 모델

D1과 Drift가 **같은 스키마**를 공유한다(마이그레이션 SQL 1벌을 양쪽에 적용).

```sql
-- 공연 마스터 (KOPIS 수집 + 사용자 등록 병합)
CREATE TABLE concerts (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,          -- 'kopis' | 'ticket_ocr' | 'manual'
  title         TEXT NOT NULL,
  artist        TEXT,
  venue         TEXT,
  region        TEXT,                   -- 하드필터용: '서울' 등
  date_start    TEXT NOT NULL,          -- ISO 8601, zero-padded
  date_end      TEXT,
  price_min     INTEGER,
  price_max     INTEGER,
  booking_url   TEXT,
  poster_url    TEXT,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_concerts_date   ON concerts(date_start);
CREATE INDEX idx_concerts_region ON concerts(region, date_start);

-- 정규화된 작품 사전 (통계·추천의 기반)
CREATE TABLE works (
  id            TEXT PRIMARY KEY,       -- 'chopin-op28-preludes'
  composer       TEXT NOT NULL,          -- 'Frédéric Chopin' (canonical)
  composer_ko    TEXT,                   -- '쇼팽'
  title_en       TEXT NOT NULL,
  title_ko       TEXT,
  opus           TEXT,
  era            TEXT,                   -- baroque|classical|romantic|modern
  instrument     TEXT                    -- piano|violin|orchestra|...
);

-- 공연 ↔ 작품 (자유 문자열 program을 여기로 정규화)
CREATE TABLE concert_program (
  concert_id    TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  raw_text      TEXT NOT NULL,          -- OCR 원문 보존
  work_id       TEXT,                   -- 매칭 실패 시 NULL
  match_conf    REAL,
  PRIMARY KEY (concert_id, seq)
);

-- 사용자 관람 아카이브
CREATE TABLE archive (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  concert_id    TEXT,
  ticket_img_key TEXT,                  -- R2 object key
  attended_on   TEXT NOT NULL,
  price_paid    INTEGER,
  ocr_conf      TEXT,                   -- JSON: 필드별 신뢰도
  created_at    INTEGER NOT NULL
);

-- 취향 프로필 (명시 설정)
CREATE TABLE profile (
  user_id       TEXT PRIMARY KEY,
  eras          TEXT,                   -- JSON array
  instruments   TEXT,
  fav_artists   TEXT,
  fav_composers TEXT,
  region        TEXT,
  travel_ok     INTEGER,
  version       INTEGER NOT NULL        -- 캐시 무효화 키
);

-- 피드백: 자연어 + 구조화 신호 이중 트랙
CREATE TABLE feedback (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  concert_id    TEXT NOT NULL,          -- 더미 아님. 실제 추천된 공연
  liked         INTEGER NOT NULL,
  signals       TEXT NOT NULL,          -- JSON: {"composer":{"Rachmaninoff":1},"era":{"romantic":1},"scale":{"recital":1}}
  created_at    INTEGER NOT NULL
);

-- 롤링 취향 요약 (읽기 경로에서 이것 하나만 주입)
CREATE TABLE taste_profile (
  user_id       TEXT PRIMARY KEY,
  summary_ko    TEXT NOT NULL,          -- ≤300 토큰. 쓰기 시점에 갱신
  boosts        TEXT NOT NULL,          -- JSON: 검색 부스팅 가중치
  version       INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

**핵심 설계 포인트 3개**

1. `works` / `concert_program` 분리 — 현재 `program: string[]`는 자유 문자열이라 "가장 많이 만난 작곡가" 집계가 불가능하다(그래서 `Dashboard.tsx`가 `favoriteComposers`를 대신 보여주고 진행바 폭을 `85 - i*15`로 **하드코딩**하고 있다). 작품 사전에 매핑해야 통계와 추천이 동시에 살아난다.
2. `taste_profile` 분리 — 요약을 **읽기 시점이 아니라 쓰기 시점**에 만든다. 3-2에서 상술.
3. `profile.version` — 캐시 키에 넣는다. 취향이 바뀌면 그 사용자의 캐시만 자동 무효화된다.

---

## 4. NLP 성능 최적화

### 4-0. 임팩트 요약

| # | 항목 | 축 | 난이도 | 기대 효과 |
|---|---|---|---|---|
| A1 | 실제 후보 풀 + 하이브리드 검색 | 품질 | 상 | 할루시네이션 구조적 차단 |
| A2 | Constrained generation (ID 검증) | 품질 | 중 | 없는 공연 추천 0건 |
| A3 | 피드백 이중 트랙 | 품질 | 중 | 플라이휠 실제 작동 |
| B1 | 쓰기 시점 요약 (taste_profile) | 비용 | 중 | 입력 토큰 선형증가 → 상수 |
| B2 | Context caching | 비용·지연 | 하 | 반복 프리픽스 최대 75% 절감 |
| B3 | 모델 라우팅 규율 | 비용 | 하 | Pro 호출 ~50% 제거 |
| C1 | 이미지 리사이즈 (장변 1568) | OCR·비용·지연 | 하 | 토큰 대폭 감소, 정확도 유지 |
| C2 | Few-shot + 필드별 confidence | OCR | 중 | HITL 수정 횟수 감소 |
| C3 | 날짜는 서버에서 파싱 | OCR | 하 | 기존 zero-pad 버그 해소 |
| D1 | 최종 응답 SSE 스트리밍 | 지연 | 중 | 체감 6s → TTFT ~1.2s |
| D2 | intent+expansion 1콜 병합 | 지연 | 하 | 왕복 1회 제거 (~700ms) |
| D3 | statistics는 SQL로 (LLM 미사용) | 지연·비용 | 하 | ~5s → ~50ms |

권장 착수 순서: **C1 → D2 → D3 → B3 → B1 → D1 → A1 → A2 → A3 → B2 → C2 → C3**
(싸고 즉효인 것부터. A1이 가장 크지만 KOPIS 수집이 선행돼야 해서 뒤로 뺐다.)

---

### 4-1. 추천 품질 — "검색 없는 RAG"를 진짜 RAG로

현재 파이프라인은 생성 단계가 곧 검색 단계다. 모델이 Google Search로 알아서 찾고 알아서 쓴다. 통제점이 없다.

**바꿀 구조: 후보 풀 → 검색 → 재랭킹 → 제한된 생성**

```
사용자 질의
   ↓
[0] 하드 필터 (SQL, LLM 아님)
    date_start >= today
    AND (travel_ok = 1 OR region = :user_region)
    AND (price_min <= :budget OR :budget IS NULL)
   ↓  후보 수백~수천
[1] 하이브리드 검색  ── 확장 쿼리 N개를 각각 실행
    ├ 어휘: D1 FTS5 (BM25)      ← 고유명사에 강함 ('임윤찬', 'Op. 28')
    └ 의미: Vectorize (dense)    ← 개념에 강함 ('비 오는 날 어울리는')
    RRF로 병합: score = Σ 1/(60 + rank_i)
   ↓  top-50
[2] 재랭킹 (Flash 1회, 50개 일괄)
    후보 제목+프로그램+날짜 + 사용자 취향 → 점수 + 한 줄 근거
   ↓  top-8
[3] 생성 (Pro, 스트리밍)
    후보 8개 **안에서만** 선택하도록 강제
    출력 스키마: [{ concertId, reason, matchedPreference }]
   ↓
[4] 서버 검증
    concertId ∉ 후보 풀 → 폐기 후 1회 재시도, 그래도 실패면 재랭킹 결과 그대로 노출
```

**이 구조가 해결하는 것**

- *할루시네이션*: 생성 모델은 ID를 고를 뿐 만들 수 없다. [4]가 최후 방어선.
- *지난 공연 추천*: [0]에서 SQL로 잘린다. LLM에게 "미래 공연만 추천하세요"라고 부탁하지 않는다.
- *보고서 4-3의 Query Expansion 과잉*: 확장 쿼리는 이제 **검색어**다. 노이즈 확장은 검색 결과가 없거나 RRF 하위로 밀려 자연 소멸한다. 프롬프트에 넣을 때처럼 생성 결과를 오염시키지 않는다. 확장을 조건부 실행으로 막는 대신 **무해하게** 만드는 쪽이 옳다.

**쿼리 벡터에 취향을 섞기 (콜드스타트 대응)**

```
q_final = α · embed(query) + (1 − α) · user_vector
user_vector = 관람 이력 works 임베딩의 가중 평균 (최근 관람에 시간 가중치)
α = 1.0            (이력 0~2건: 순수 질의)
α = 0.7            (3~9건)
α = 0.55           (10건 이상)
```
"이번 주 추천 공연" 같은 무정보 질의에서 개인화가 실제로 작동하는 지점이 여기다. 지금은 System Instruction에 프로필을 적어두고 모델이 반영해주길 기대할 뿐이다.

**피드백 이중 트랙**

```
ThumbsUp/Down (실제 concertId 동반)
   ├─ 구조화 신호  →  feedback.signals  →  taste_profile.boosts
   │                  검색 [1]에서 부스팅, 재랭킹 [2]에서 피처
   └─ 자연어 요약  →  taste_profile.summary_ko
                      생성 [3]의 System Instruction (≤300 토큰 고정)
```
자연어만 쌓으면 검색을 못 고친다. 구조화 신호만 쌓으면 "왜 추천했는지" 설명이 빈약해진다. 둘 다 필요하고, 쓰는 곳이 다르다.

> 프론트 수정 필수: `Dashboard.tsx:49`의 더미 객체를 실제 추천 공연으로 교체. 피드백 단위도 메시지 인덱스가 아니라 추천 카드 단위여야 한다.

**평가 프레임 (보고서 향후계획의 Precision@K 구체화)**

골든셋 40건(질의, 정답 공연 집합)을 손으로 만든다. 하루면 된다.

| 지표 | 측정 대상 | 목표 |
|---|---|---|
| Recall@50 | [1] 검색 | ≥ 0.85 — 정답이 후보에 들어왔는가 |
| NDCG@8 | [2] 재랭킹 | ≥ 0.60 — 상위에 올렸는가 |
| Groundedness | [3] 생성 | ≥ 0.95 — 추천 이유가 실제 프로그램에 근거하는가 (LLM-judge) |
| Invalid-ID rate | [4] 검증 | = 0 — 후보 밖 ID 반환률 |

프롬프트를 고칠 때마다 돌린다. **감으로 프롬프트를 고치는 순간부터 품질은 랜덤워크가 된다.**

---

### 4-2. API 비용 — 토큰이 선형 증가하는 구조를 상수로

**현재 1턴 비용 구조** (`geminiService.ts:64-83`)
```
Flash(intent)  +  Flash(expand)  +  Pro(generate) + Google Search
                                    ↑ 프로필 JSON 전체
                                    ↑ 관람 이력 전체 (N건 → 무한 증가)
                                    ↑ 피드백 reason 전체 (M건 → 무한 증가)
                                    ↑ 채팅 히스토리 전체
```
관람 50건 · 피드백 30건이면 System Instruction만 수천 토큰. **매 턴 전액 재과금**.

**B1. 요약을 읽기가 아니라 쓰기 시점으로**

```
현재: 읽기 시점 — 매 턴 원시 피드백 M건 전부 주입     → O(M) / 턴
개선: 쓰기 시점 — 피드백 1건 들어올 때 taste_profile 갱신 → O(1) / 턴
```
`summarizeFeedback`을 이미 만들어 뒀는데 **쓰는 위치가 틀렸다.** 결과를 배열에 append하고 매번 전부 붙이는 대신, 기존 `summary_ko`와 신규 피드백 1건을 합쳐 300토큰 이내로 다시 압축한다. 관람 이력도 같다 — 원시 목록 대신 SQL 집계(상위 작곡가 5·시대 분포·최근 3건)를 주입한다.

**B2. Context caching**

System Instruction 구조를 **[고정 프리픽스][가변 서픽스]** 로 나눈다.
```
고정 (캐시 대상, 사용자당 profile.version 동안 불변):
  큐레이터 역할 정의 · 출력 규칙 · few-shot 예시 · taste_profile.summary_ko
가변:
  이번 질의 · 검색 후보 8개 · 채팅 최근 턴
```
Gemini의 context caching으로 프리픽스를 재사용한다. 캐시 히트 토큰은 정가 대비 크게 싸고, 전송·처리가 줄어 **지연도 같이 준다.** 캐시 키에 `profile.version`을 넣어 취향 변경 시 자동 무효화.

**B3. 모델 라우팅 규율**

| intent | 현재 | 개선 | 근거 |
|---|---|---|---|
| statistics | **Pro + 이력 전체** | LLM 없음 (SQL) 또는 Flash 나레이션 | 숫자 세기에 추론 모델은 낭비이자 부정확 |
| general | Pro + Search | Flash, Search 끔 | "안녕" 에 검색이 왜 필요한가 |
| information | Pro + Search | Pro + Search 유지 | 팩트 정확도 필요 |
| recommendation | Pro + Search | **Pro + 내부검색** (Google Search 끔) | 후보 풀이 D1에 있으므로 외부 검색 불필요 |

Google Search grounding은 요청당 과금이다. 현재는 statistics 빼고 **전부 켜져 있다**(`geminiService.ts:113`). recommendation에서 끄는 게 비용·품질 양쪽에 이득 — 후보 풀이 ground truth이므로 외부 검색은 노이즈만 더한다.

**B4. 시맨틱 캐시 (KV)**

질의 임베딩을 KV에 두고, 같은 `profile.version` 안에서 코사인 ≥ 0.95면 캐시 응답. 클래식 질의는 반복률이 높다("이번 주 추천", "브람스 공연"). TTL은 하루(공연 일정 변동 주기).

**B5. Thinking budget**

분류·재랭킹처럼 답이 짧고 정형인 태스크는 thinking을 최소로 설정한다. 기본값으로 두면 보이지 않는 추론 토큰에 계속 과금된다.

> 누적 효과: 이력이 쌓인 헤비 유저 기준 턴당 입력 토큰이 상수로 묶이고, Pro 호출은 절반 이하로 줄어든다.

---

### 4-3. OCR 정확도

**C1. 업로드 전 리사이즈 — 가장 싸고 효과 큰 한 방**

```dart
// 폰 카메라 원본 4032×3024 → Gemini 이미지 타일 다수 → 토큰·지연 폭증
final resized = await FlutterImageCompress.compressWithFile(
  path,
  minWidth: 1568, minHeight: 1568,   // 장변 1568 기준
  quality: 85,
  autoCorrectionAngle: true,          // EXIF 회전 — 세로 티켓 오인식의 흔한 원인
);
```
1568px는 인식률을 유지하면서 타일 수를 줄이는 실용적 균형점이다. **정확도·비용·지연이 동시에 개선되는 드문 항목.** EXIF 보정을 빠뜨리면 세로로 찍은 티켓이 눕혀진 채 들어가 인식이 통째로 실패한다.

**C2. 프롬프트 강화 + 필드별 신뢰도**

현재 프롬프트는 한 줄이다(`geminiService.ts:196`).
```
"티켓 텍스트 추출: title, artist, venue, date(YYYY-MM-DD), program(배열) JSON만 출력."
```
개선:
- **Few-shot 3~4종** 인라인 — 인터파크 / 예술의전당 / YES24 / 롯데콘서트홀. 한국 티켓은 레이아웃이 정형화돼 있어 예시 효과가 크다.
- **필드별 confidence 추가**:
```json
{
  "title":  { "value": "조성진 피아노 리사이틀", "confidence": 0.97 },
  "date":   { "value": "2025년 3월 15일",       "confidence": 0.62 },
  "program":[{ "value": "Chopin - 24 Preludes, Op.28", "confidence": 0.88 }]
}
```
UI에서 **confidence < 0.8인 필드만 노란 테두리**로 표시한다. 보고서 2-1의 HITL은 "다 고칠 수 있게 열어둔" 수준인데, 어디를 봐야 하는지 알려주면 검수 시간이 줄고 수정 누락도 준다. HITL의 병목은 편집 가능 여부가 아니라 **주의 배분**이다.

- **required 규칙 명시**: 보고서 4-2의 교훈대로 전 필드 required + 없으면 빈 문자열. 여기에 confidence 0을 함께 반환하게 하면 "모름"과 "빈 값"이 구분된다.

**C3. 날짜는 LLM이 아니라 서버가 정규화**

보고서 4-1의 결론("후처리 레이어 필수")은 맞는데 구현이 미완이다.
```js
// 현재 — TicketOCR.tsx:99
'2025년 3월 15일' → '2025-3-15'   // zero-pad 없음 → 정렬·범위쿼리 깨짐
'2025.03.15'      → '2025.03.15'  // 미처리
'15 Mar 2025'     → '15Mar2025'   // 파괴됨
```
LLM에는 **원문 그대로** 받고, 서버에서 포맷 후보를 순차 시도한다.
```ts
const PATTERNS = [
  /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
  /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
  /(\d{1,2})\s+(Jan|Feb|...)\s+(\d{4})/i,
];
// 전부 실패 → date_confidence = 0 → UI가 사용자에게 명시적으로 물음
// 반드시 zero-pad: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
```
파싱 실패를 **조용히 넘기지 않는 것**이 핵심이다. 지금은 깨진 문자열이 그대로 저장돼 캘린더에서 조용히 사라진다.

**C4. 프로그램 곡목 정규화 (통계·추천의 전제)**

`"쇼팽 전주곡 24개"`, `"Chopin: 24 Preludes Op.28"`, `"F. Chopin - Preludes"` 는 같은 곡이다. 지금은 다른 문자열이라 집계가 불가능하다.
```
OCR raw_text → 임베딩 → works 사전에서 최근접 탐색 → 유사도 ≥ 0.85면 work_id 매핑
                                                    미만이면 NULL + 리뷰 큐
```
이게 붙어야 "가장 많이 만난 작곡가"가 실제 데이터로 계산된다(현재 하드코딩), 시대/악기 취향이 자동 추정되고, 취향 벡터가 만들어진다. **1건의 작업이 통계·추천·개인화 3곳을 동시에 살린다.**

**C5. 선택적 셀프 검증**

confidence 평균이 낮은 이미지에 한해 2차 패스: 추출 결과와 원본 이미지를 함께 주고 "이 추출이 정확한가?" 검증. 전건에 하면 비용 2배니 **저신뢰 건에만** 조건부로.

---

### 4-4. 응답 지연

**현재 체감 흐름**
```
[Flash 의도분류 ~0.8s] → [Flash 확장 ~0.9s] → [Pro+Search 생성 ~4-7s]
└─────────────────── 화면은 계속 "추론 중..." ───────────────────┘
                                              총 6~9초, 첫 글자까지 6~9초
```

**D1. 스트리밍 — 지연 개선의 8할**

`generateContentStream` → Worker에서 SSE 릴레이 → Flutter가 토큰 단위 렌더.
총 시간은 그대로여도 **첫 글자까지(TTFT)가 ~1.2초**로 떨어진다. 사용자가 느끼는 건 총 시간이 아니라 TTFT다. 다른 최적화 전부를 합친 것보다 체감 개선이 크다.

Worker(SSE):
```ts
const stream = await ai.models.generateContentStream({...});
return new Response(
  new ReadableStream({
    async start(c) {
      for await (const chunk of stream) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify({t: chunk.text})}\n\n`));
      }
      c.close();
    }
  }),
  { headers: { 'Content-Type': 'text/event-stream' } }
);
```

**D2. 1단계 + 2단계 병합**

의도 분류와 쿼리 확장은 둘 다 같은 입력에 대한 값싼 Flash 태스크다. 나눌 이유가 없다.
```json
// 단일 Flash 호출, 스키마 강제
{
  "intent": "recommendation",
  "entities": ["임윤찬", "리사이틀"],
  "expandedQueries": ["임윤찬 쇼팽", "임윤찬 라흐마니노프", "한국 피아니스트 리사이틀 2026"],
  "filters": { "region": "서울", "afterDate": "2026-08-26" }
}
```
`intent != recommendation`이면 `expandedQueries: []`를 반환하라고 지시한다. 보고서 2-3의 "조건부 실행" 의도는 그대로 지키면서 **왕복 1회(~700ms)를 없앤다.** 덤으로 `expandQuery`의 정규식 파싱도 사라져 보고서 3-1의 "전 호출 스키마 강제"가 실제로 참이 된다.

**D3. 빠른 경로 (LLM 우회)**

- **statistics**: LLM에 이력을 넣고 세게 하지 않는다. Drift/D1에 SQL 한 방 → 차트 렌더. **~5s → ~50ms.** 죽어 있는 `calculateStats()`를 살리면 된다. 문장 설명이 필요하면 집계 결과만 Flash에 넘겨 나레이션(선택).
- **규칙 기반 프리라우팅**: "내 통계", "몇 번 갔어", "이번 달 얼마" 같은 정형 질의는 클라이언트 정규식으로 잡는다. 분류 호출 자체가 0회.

**D4. 검색 병렬화**

확장 쿼리 3개 × (BM25 + dense) = 6회 검색을 `Promise.all`로. 같은 Worker 안이라 네트워크 홉이 없어 수십 ms에 끝난다.

**D5. OCR/Enrich 분리 — 프로토타입의 명백한 손해**

```
현재: [OCR 2s] → [Enrich 6s] → 화면 표시        사용자 대기 8초
개선: [OCR 2s] → 폼 즉시 표시 (편집 시작 가능)
                 └ [Enrich 백그라운드/스트림] → 준비되는 대로 아코디언 채움
```
`TicketOCR.tsx:57-66`이 둘을 하나의 로더로 묶어 놨다. OCR 결과는 이미 손에 있는데 보여주지 않는다. **사용자가 폼을 검수하는 시간이 곧 enrich 시간과 겹친다** — 공짜로 6초를 번다.
추가로 enrich를 곡별로 쪼개 병렬 호출하면(곡 5개 → 5콜 동시) enrich 자체도 ~6s → ~2s.

**목표치**

| 시나리오 | 현재 | 목표 |
|---|---|---|
| 추천 채팅 TTFT | 6~9s | **≤ 1.5s** |
| 추천 채팅 완료 | 6~9s | ≤ 5s |
| 통계 질의 | ~5s | **≤ 100ms** |
| 티켓 등록(폼 표시까지) | ~8s | **≤ 2.5s** |
| 일반 대화 | ~5s | ≤ 1.5s |

---

## 5. Flutter 구현

### 5-1. 패키지

| 용도 | 선택 | 비고 |
|---|---|---|
| 상태관리 | `flutter_riverpod` + `riverpod_generator` | 테스트 용이, 비동기 캐싱 내장 |
| 라우팅 | `go_router` | 딥링크(공유된 공연 → 앱) |
| 로컬 DB | `drift` | 타입 안전 SQLite, D1과 스키마 공유 |
| 네트워크 | `dio` | + SSE 스트림 파서 |
| 이미지 | `image_picker`, `flutter_image_compress` | **C1 리사이즈 필수** |
| 직렬화 | `freezed` + `json_serializable` | 불변 모델 |
| 차트 | `fl_chart` | 통계 화면 |
| 보안저장 | `flutter_secure_storage` | 세션 토큰 (Gemini 키 아님) |

### 5-2. 디렉터리 (feature-first)

```
lib/
├─ main.dart
├─ app/                     라우터 · 테마(현 앰버/다크 팔레트 이식) · DI
├─ core/
│  ├─ network/              dio 클라이언트 · SSE · 재시도/백오프
│  ├─ db/                   drift 스키마 · 마이그레이션 · outbox
│  └─ result.dart           Result<T, Failure>
└─ features/
   ├─ archive/              티켓 등록 (OCR + HITL 폼 + 프로그램 노트)
   │  ├─ data/  domain/  presentation/
   ├─ curator/              채팅 · AgentTimeline · 피드백
   ├─ calendar/             월별 그리드
   ├─ stats/                통계 (LLM 미경유)
   └─ profile/              취향 설정
```

**React → Flutter 매핑**

| 현재 | Flutter |
|---|---|
| `App.tsx` useState 3종 | Riverpod Notifier + Drift 영속화 |
| `Dashboard.tsx` | `features/curator/` — 스트리밍 대응으로 재작성 |
| `AgentTimeline.tsx` | 동일 UI, SSE 이벤트로 **실시간** 채움 (현재는 완료 후 일괄) |
| `TicketOCR.tsx` | `features/archive/` — OCR/Enrich 분리(D5) |
| `CalendarView.tsx` | 거의 1:1 이식 |
| `services/geminiService.ts` | **삭제.** 전부 Worker로 이동 |

> `AgentTimeline`은 스트리밍과 궁합이 좋다. 각 단계 완료 시점에 SSE 이벤트를 흘리면 "의도 분석 완료 → 검색 12건 → 생성 중..."이 실시간으로 뜬다. 대기 시간이 **진행 상황**으로 바뀌어 체감 지연이 한 번 더 준다.

### 5-3. 오프라인 outbox

```dart
// 티켓 등록: 로컬 우선 커밋 → 화면 즉시 갱신 → 백그라운드 동기화
await db.archive.insert(entry);              // UI 즉시 반영
await db.outbox.insert(SyncTask.upload(entry.id));
unawaited(syncService.drain());              // 실패해도 UI 영향 없음
```

---

## 6. 서버리스 API 계약

```
POST /v1/ocr
  req  { imageBase64, mime }
  res  { fields: { title:{value,confidence}, ... }, rawDate, warnings[] }

POST /v1/enrich          (SSE)
  req  { concertDraft }
  ev   note   { seq, note, sources[] }      곡별로 준비되는 대로
  ev   done   { }

POST /v1/chat            (SSE)
  req  { message, sessionId, clientHints? }
  ev   step   { name:'route',     ms, intent, entities, expandedQueries }
  ev   step   { name:'retrieve',  ms, candidateCount }
  ev   step   { name:'rerank',    ms, topK }
  ev   token  { t }                          ← 생성 토큰 스트림
  ev   cards  { concerts: [{id, title, reason, bookingUrl}] }
  ev   done   { totalMs, cached, model }

POST /v1/feedback
  req  { concertId, liked, recommendationId }
  res  { tasteProfileVersion }

GET  /v1/concerts?since=<ts>                아카이브 델타 동기화
GET  /v1/search?q=&debug=1                  검색 디버깅 (평가 파이프라인용)
```

`step` 이벤트가 `AgentTimeline`을 실시간으로 먹인다 — 관측성과 UX를 같은 채널로 해결.

### 6-1. Worker 내부 흐름 (`/v1/chat`)

```ts
export async function chat(req, env) {
  const t0 = Date.now();

  // 0. 빠른 경로
  const fast = ruleRoute(req.message);                      // D3
  if (fast?.intent === 'statistics') return statsFromD1(env, req.userId);

  // 1. 라우팅: 의도 + 확장 + 필터 (Flash 1콜)             // D2
  const route = await routeQuery(req.message, env);

  // 2. 시맨틱 캐시                                          // B4
  const hit = await semanticCache.get(env, req.userId, req.message, profileVersion);
  if (hit) return sse.replay(hit);

  if (route.intent === 'recommendation') {
    // 3. 하드필터 + 하이브리드 검색 (병렬)                  // A1, D4
    const cands = await hybridSearch(env, route, profile);   // → top-50
    // 4. 재랭킹 (Flash 1콜, 50개 일괄)
    const top = await rerank(env, cands, tasteProfile);      // → top-8
    // 5. 제한된 생성 (Pro, 스트리밍, Search 끔)             // A2, B3, D1
    return streamGenerate(env, req, top, { enforceIds: top.map(c => c.id) });
  }
  // information → Pro + Search / general → Flash
  return streamGenerate(env, req, [], { model: pickModel(route.intent) });
}
```

---

## 7. 단계별 로드맵

| 단계 | 기간 | 내용 | 완료 기준 |
|---|---|---|---|
| **0. 지혈** | 2일 | Worker 프록시 세우고 키 이동 · 이미지 리사이즈(C1) · 날짜 파서(C3) | 클라이언트 번들·바이너리에 Gemini 키 0건 |
| **1. Flutter 셸** | 1주 | Riverpod + Drift + go_router, 4개 화면 이식, 영속화 | 앱 종료 후 재실행에도 아카이브 유지 |
| **2. 지연 개선** | 4일 | SSE 스트리밍(D1) · 라우터 병합(D2) · 통계 SQL(D3) · OCR/Enrich 분리(D5) | TTFT ≤ 1.5s, 통계 ≤ 100ms |
| **3. 비용 개선** | 3일 | taste_profile 쓰기 시점 요약(B1) · 모델 라우팅(B3) · context caching(B2) | 헤비유저 턴당 입력 토큰 상수화 |
| **4. RAG 본체** | 1.5주 | KOPIS 수집 배치 · works 사전 · D1 FTS + Vectorize · RRF · 재랭킹 · ID 검증 | Invalid-ID rate = 0, Recall@50 ≥ 0.85 |
| **5. 플라이휠** | 4일 | 피드백 이중 트랙(A3) · 취향 벡터 · 검색 부스팅 | 피드백 10건 후 NDCG@8 유의 상승 |
| **6. 평가·계측** | 3일 | 골든셋 40건 · CI 회귀 · 지연/비용 대시보드 | 프롬프트 변경 시 자동 리포트 |

**단계 0은 다른 무엇보다 먼저.** 현재 상태로는 배포도, 시연 링크 공유도 하면 안 된다.

---

## 8. 보고서에 반영할 것

1. **정정**: Flutter → (현 시점) React 프로토타입 / "로컬 JSON 아카이브" → 인메모리 / "응답 속도 30%+ 개선"은 측정 근거를 붙이거나 삭제
2. **보강**: 4-3(Query Expansion 과잉)의 결론을 "조건부 실행"에서 한 단계 밀어붙이기 — 근본 원인은 확장 자체가 아니라 **확장 결과를 검증할 후보 풀이 없다는 것**. 이게 4장에서 가장 깊이 있는 트러블슈팅 항목이 될 수 있다.
3. **추가**: 향후 계획의 "벡터 DB 연동 / Precision@K"를 4-1의 하이브리드 검색 + 4장 평가 프레임으로 구체화

---
