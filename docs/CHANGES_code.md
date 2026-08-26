# 코드 수정 내역 (Classic Lions 로컬 프로토타입)

작성일: 2026-08-26
담당: 코드 수정
범위: `app/` 만. Flutter 재작성·서버리스 이전은 **하지 않았다** (다음 단계).
목표: **지금 로컬에서 돌려서 티켓 사진 인식이 잘 되는지 확인할 수 있게 만들기.**

검증 결과(2차 수정 후): `npx tsc --noEmit` 에러 0 · `npm run build` 성공 · `npm test` **40/40 통과** · `npm run dev` 200 OK.
평가 재실행은 **쿼터 소진(HTTP 429)으로 미완** — 자세한 내용은 아래 O절.

---

## 0. 새 파일 4개

| 파일 | 역할 |
|---|---|
| `app/services/ocrSchema.ts` | **계약 파일.** OCR 프롬프트/스키마 + 순수 파서. 브라우저 API 의존 없음 → Node에서 그대로 import 가능 |
| `app/services/imagePrep.ts` | canvas 리사이즈 · EXIF 회전 보정 (브라우저 전용) |
| `app/services/models.ts` | 모델 ID 단일 출처 |
| `app/services/storage.ts` | localStorage 영속화 + 용량 초과 처리 |
| `app/services/__tests__/ocrSchema.test.ts` | 회귀 테스트 25건 (`npm test`) |

---

## A. 좌석 정보 추출 (신규 — 이번 작업의 핵심)

**문제**: OCR 스키마에 `seat` 필드가 아예 없어서, 티켓에 또렷이 찍힌 좌석을 통째로 버리고 있었다.

**한 일**
- OCR 스키마에 `seatRaw` 추가. **원문 그대로** 받고 **파싱은 코드에서** 한다 (LLM에게 구조화를 맡기지 않는다).
- `parseSeat(raw): ParsedSeat` — `floor / block / row / number / grade / raw / confidence`.
- "구역"↔"블록"↔"블럭"↔"존" 혼용, 공백 유무(`객석 1층` / `객석1층`), zero-pad(`01열`, `08번`) 전부 처리.
- 파싱 실패 시 `confidence: 0`, **`raw`는 항상 보존**. 파서를 나중에 개선하면 저장된 raw를 재파싱해 소급 적용할 수 있다.
- 덤으로 `normalizeTime` / `parsePrice` / `extractComposers` / `postProcessOCR` 도 같은 파일에 넣었다 (전부 순수 함수).

### A-1. 실물 티켓 판독으로 드러난 버그 2건 (리서치 담당 제보 → 반영)

**🔴 게이트 문자열 충돌** — 좌석 기능 전체를 무의미하게 만드는 버그였다.

롯데콘서트홀 실물 티켓에는 입장 게이트가 좌석과 **나란히** 인쇄된다:
```
입장: 8층 2번 게이트           ← 건물 층 + 게이트 번호 (좌석 아님)
좌석: 객석 1층 B구역 15열 01번  ← 진짜 좌석
```
정규식이 첫 매치를 취하므로 `floor=8, number=2`로 완전히 틀린 값이 나왔다.

4중 방어를 넣었다:
1. `stripNonSeatTokens()` — 게이트 구문(`N층 M번 게이트`, `9F 8번 GATE`, `입장게이트:`)을 파싱 **전에** 제거. 좌석 부분은 남긴다.
2. `객석` 앵커 우선 — `객석`이 있으면 그 뒤만 파싱한다 (롯데는 항상 `객석`을 붙인다).
3. `floor` 유효범위 `1~20` → **`1~5`**. 국내 클래식 공연장 객석은 최대 3층이라, 게이트의 8층/9F가 범위 검증만으로 자동 차단된다.
4. OCR 프롬프트에 **negative 지침**을 명시 — "게이트 정보를 seatRaw에 넣지 마세요" + few-shot 예시에 그 상황을 적어 뒀다.

**🔴 등급 정규식이 실물을 못 잡음** — `[A-Z]{1,2}석` 패턴은 예술의전당 실물의 `회원석`, `BOX석`을 놓쳤다.
→ 화이트리스트 우선(`VVIP석 BOX석 VIP석 회원석 학생석 초대석 합창석 시야제한석 자유석 R석 S석 A석…`) + 대문자 1글자 폴백(`/(?<![A-Za-z])(VVIP|VIP|[A-Z])석/`)으로 교체.
소문자를 허용하지 않아 `객석` 등의 오탐도 함께 줄었다.

**등급 vs 구역 충돌**: `객석1층 R구역 01열 12번` 의 `R`은 **구역**이지 등급이 아니다. 현재 동작이 맞고, 회귀 테스트로 고정해 뒀다.

**예술의전당 표 레이아웃**: 값이 칼럼으로 흩어지고 각 칸에 영문 캡션(`Floor / Block / Row / Seat`)이 붙는다.
→ 파서에서 캡션을 제거하고, OCR 프롬프트에도 "캡션 없이 순서대로 이어 붙여 한 문자열로" 지시를 넣었다.

---

## B. 날짜 정규화 버그 (실제 버그였음)

**문제** (`TicketOCR.tsx:99` 구버전):
```js
'2025년 3월 15일' → '2025-3-15'   // zero-pad 없음 → 문자열 정렬/범위비교가 깨짐
'2025.03.15'      → 미처리
'15 Mar 2025'     → '15Mar2025' 로 파괴
```

**한 일**
- LLM에는 `dateRaw`로 **원문 그대로** 받는다. (프롬프트에 "형식을 바꾸지 마세요"를 명시)
- `normalizeDate(raw)` 가 포맷 후보를 순차 시도해 zero-padded `YYYY-MM-DD`를 만든다:
  `2025년 3월 15일` / `2025.03.15` / `20250315` / `15 Mar 2025` / `March 15, 2025` / `03-15-2025`.
- `2025-02-30` 같은 **실존하지 않는 날짜**는 검증으로 걸러내고 다음 후보로 넘어간다.
- 전부 실패 → `{ value: null, confidence: 0 }`. **조용히 깨진 문자열을 저장하지 않는다.**
- UI가 명시적으로 묻는다: 날짜 칸이 빨갛게 뜨고 `"2025년 봄" 를 해석하지 못했습니다. 직접 입력해 주세요.` 가 뜨며,
  **`YYYY-MM-DD`가 아니면 저장 버튼이 막힌다.**
- 연도가 뒤인 모호한 형식(`03/15/2025`)은 값은 주되 confidence를 낮춰(0.5~0.85) UI에서 노란 테두리가 뜨게 했다.

---

## C. 이미지 전처리 (`services/imagePrep.ts`)

`prepareTicketImage(file)`:
1. **EXIF 회전 보정** — `createImageBitmap(blob, { imageOrientation: 'from-image' })`.
   미지원 브라우저는 옵션 없는 `createImageBitmap` → `<img>` 순으로 폴백한다.
   (세로로 찍은 티켓이 눕혀져 들어가면 인식이 통째로 실패하던 문제)
2. **장변 1568px 축소** (그보다 작으면 원본 유지). Gemini 이미지 타일 수가 줄어 토큰·지연이 크게 준다.
3. **JPEG quality 0.85** 재인코딩. 축소 시 `imageSmoothingQuality = 'high'` 로 작은 글씨(열/번) 판독률을 지키고,
   투명 PNG가 검게 깔리지 않도록 흰 배경을 먼저 깐다.

UI에 `4032×3024 → 1568×1176 (장변 1568px로 축소) · 214KB` 같은 실측 라인을 띄워 효과를 눈으로 확인할 수 있게 했다.

---

## D. OCR 프롬프트 강화 + 필드별 신뢰도

**이전**: 한 줄짜리 프롬프트 (`"티켓 텍스트 추출: title, artist, venue, date(YYYY-MM-DD), program(배열) JSON만 출력."`)

**지금**:
- 절대 규칙 4개(원문 보존 / 전 필드 required / 추측 금지 / confidence 정의)
- 필드별 정의 + 한국 티켓 레이아웃 힌트(예매처 로고·예매번호·게이트 배제, 구역↔블록 차이)
- **few-shot 3종**: 롯데콘서트홀 정기연주회 / 예술의전당(곡목 없음, 등급만) / 초대권(좌석·시간 없음)
- **필드별 confidence** 반환:
  ```json
  { "title": {"value":"...","confidence":0.97}, "dateRaw": {"value":"2024.06.20(목)","confidence":0.9} }
  ```
- `temperature: 0` — 판독은 정형 태스크다.

**신뢰도 합성**: 최종 `confidence.date = LLM 판독 신뢰도 × 코드 파싱 신뢰도`.
둘 중 하나라도 0이면 0이 된다. "LLM은 또렷하게 읽었는데 우리가 파싱을 못 한" 경우와 "애초에 안 읽힌" 경우가 모두 사용자에게 드러난다.

**UI (HITL 주의 배분)**: `confidence < 0.8` 인 필드만 **노란 테두리 + 링**으로 강조하고,
각 라벨 오른쪽에 `%`를 띄운다. 폼 상단에 `AI 신뢰도가 낮은 3개 항목을 표시했습니다`.
사용자가 직접 고친 필드는 신뢰도 1로 올라가 강조가 사라진다.

---

## E. 영속화 (`services/storage.ts`)

`App.tsx`가 전부 `useState`라 새로고침하면 아카이브·취향·피드백이 전소되던 문제.

- `classic-lions/v1/{profile,concerts,feedback}` 키로 localStorage 저장/복원.
- Safari 프라이빗 모드처럼 **접근 자체가 던지는** 환경을 probe로 먼저 확인한다.
- **용량 초과 처리**: 티켓 이미지가 base64라 여기서만 쿼터가 터진다.
  `saveConcerts()` 가 쿼터 에러를 만나면 **오래된 항목부터 티켓 사진만 떼어내고** 재시도한다.
  공연 정보(제목·날짜·좌석·프로그램)는 전부 보존된다.
  그리고 **그 사실을 화면 상단 배너로 알린다** — 조용히 데이터를 버리지 않는다.
- 첫 렌더의 저장 왕복은 건너뛴다(막 복원한 값을 되쓸 이유가 없다).

---

## F. 나머지 버그

### F1. `Dashboard.tsx:49` — 피드백이 더미를 학습하던 문제

**이전**: `summarizeFeedback({ title: "추천 공연", artist: "아티스트", ... })` 하드코딩.
LLM이 "추천 공연 by 아티스트를 좋아함" 같은 무의미한 문장을 만들고, 그게 다음 턴 System Instruction에 주입됐다. 플라이휠이 실제로는 돌지 않았다.

**구조적 원인**: 채팅 응답이 자유 텍스트라 "무엇을 추천했는지"가 구조화돼 있지 않았다. 넘길 실제 객체가 존재하지 않았던 것.

**한 일** — 넘길 객체를 만들어 냈다:
- `extractRecommendations(responseText)` 를 추가. 생성이 끝난 뒤 **값싼 Flash 1콜**로 추천된 공연을 `[{title, artist, venue, date, composer, reason}]` 로 구조화한다 (responseSchema 강제).
- 이 호출은 **화면 표시를 막지 않는다**. 응답은 즉시 뜨고, 추천 카드가 뒤늦게 채워진다 → TTFT 영향 없음.
- 피드백 버튼을 **메시지 단위 → 추천 카드 단위**로 옮겼다. 각 카드의 👍/👎가 그 카드의 실제 Concert 객체를 넘긴다.
- `FeedbackEntry`에 `concertId` / `artist` 를 추가해 무엇에 대한 피드백인지 남는다.
- **추출에 실패하거나 특정 가능한 공연이 없으면 그 사실을 UI에 드러낸다**:
  `이 답변에서 특정 가능한 추천 공연을 찾지 못해 피드백을 받을 수 없습니다.`
  (더미로 때우지 않는다.)

> 남은 한계: 추출된 `concertId`는 로컬에서 만든 임시 id다. 실제 공연 마스터(D1/KOPIS)와 연결되지 않아
> "같은 공연에 대한 반복 피드백"을 합칠 수 없다. 후보 풀이 생기는 단계(ARCHITECTURE 4-1)에서 해결될 문제다.

### F2. `expandQuery` 정규식 파싱 → `responseSchema`
`text.match(/"([^"]+)".../)` 로 따옴표를 긁어모으던 것을 `{ expandedQueries: string[] }` 스키마 강제로 교체.
`intent` 분류 스키마에도 `enum` + `required` 를 넣어 방어했다. 이제 "모든 LLM 호출에 JSON Schema 강제"가 실제로 참이다.

### F3. `calculateStats()` dead code → statistics 빠른 경로
- `calculateStats(history)` 를 export 하고, **statistics intent면 LLM을 아예 타지 않게** 연결했다 (`renderStats()`가 문장까지 만든다).
- 덤으로 **규칙 기반 프리라우팅**(`ruleRoute`)을 넣어 `"내 관람 통계"`, `"몇 번 갔어"` 같은 정형 질의는 **분류 호출조차 0회**다. `~5s → ~1ms`.
- 집계 내용도 늘렸다: 총 관람수 / 기간 / 누적 비용 / 상위 작곡가·연주자·공연장 / 월별 분포.
  작곡가는 `concert.composer` 하나가 아니라 `program`에서 뽑은 전체를 센다.
- Dashboard 좌측 "가장 많이 만난 작곡가" 진행바도 하드코딩(`85 - i*15`)을 없애고 **실제 집계값 비율**로 바꿨다.
  데이터가 없으면 가짜 막대 대신 "아직 집계할 프로그램이 없습니다"라고 말한다.

### F4. `composer: artist.includes('임윤찬') ? 'Rachmaninoff' : undefined` 하드코딩 제거
`extractComposers(program)` 으로 교체. 작곡가 사전(영문/한글 별칭 55종) 매칭 + `"Composer - Work"` 접두 패턴 폴백.
`Concert`에 `composers: string[]` 를 추가해 전체를 남기고, `composer`는 대표값(첫 번째)으로 둔다.

### F5. OCR/enrich 직렬 실행 분리
**이전**: `[OCR 2s] → [Enrich 6s] → 화면 표시`, 로더 하나로 묶여 8초 대기.
**지금**: OCR이 끝나는 즉시 `setLoading(false)` → 폼 표시. enrich는 `.then()` 백그라운드로 돌고,
프로그램 노트 섹션에만 `백그라운드 작성 중… (검수는 계속하셔도 됩니다)` 인라인 표시가 뜬다.
사용자가 폼을 검수하는 시간이 enrich 시간과 겹친다 — 공짜로 ~6초.
`reqIdRef` 세대 카운터로 사용자가 새 사진을 올렸을 때 이전 응답이 늦게 도착해 화면을 덮어쓰는 것도 막았다.

---

## G. 모델 ID (오케스트레이터 제보 반영)

`gemini-3-pro-preview` 는 **존재하지 않는 모델**이었다 (`models.list` 실측). `enrichProgramNotes()` 와 `chat()` 최종 생성이 런타임 404로 죽는 상태였다.

- 전부 `gemini-3.1-pro-preview` 로 교체.
- 모델 ID를 코드에 흩뿌리지 않도록 `app/services/models.ts` 에 모았다. `ocrSchema.ts`의 `OCR_MODEL`도 이 상수를 참조한다 (named export 계약은 유지).
- alias(`-latest`)는 쓰지 않는다 — 평가 재현성이 깨진다. 테스트로도 고정해 뒀다.
- 덤: `general`(잡담) intent는 Pro + Google Search 대신 **Flash + 검색 끔**으로 라우팅했다. "안녕"에 검색 과금할 이유가 없다.

---

## H. API 키 취급

로컬 개발에 필요하므로 `vite.config.ts` 의 `define` 은 **유지**했다. 대신:

- `vite.config.ts` 상단에 위험을 길게 명시 (번들에 평문으로 박힘 → 배포 금지).
- **프로덕션 빌드 시 경고를 띄우는 Vite 플러그인**을 추가했다. `npm run build` 하면:
  ```
  ⚠️  프로덕션 빌드에 GEMINI_API_KEY가 평문으로 포함됩니다.
      이 dist/ 를 공개된 곳에 배포하면 키가 즉시 유출됩니다.
  ```
  키가 비어 있으면 대신 "빌드는 되지만 모든 AI 기능이 실패합니다" 경고가 뜬다.
- `app/README.md` 상단에 **🚨 배포 금지** 섹션.
- **키가 없거나 자리표시자면 앱이 조용히 실패하지 않는다**: `MissingApiKeyError` 를 던지고,
  대시보드/티켓 등록 화면 상단에 빨간 안내(`app/.env` 에 `GEMINI_API_KEY` 설정 후 서버 재시작)를 띄운다.
  401/403/429/네트워크 오류도 `describeError()` 가 한국어 문장으로 바꿔 화면에 보여준다.
- 키 검증은 **접두사 형식 검사를 하지 않는다**. 유효한 신형 키가 `AQ.` 로 시작해서 `AIza` 검사를 하면 정상 키를 막는다.
  "비어 있는가 / `<여기에_붙여넣기>` 같은 자리표시자인가"만 본다.
- 환경변수는 `app/.env` 기준으로 코드·문서를 통일했다 (`.env.local` 은 존재하지 않음).

---

## I. 그 밖의 수정

- `index.html` 이 존재하지 않는 `/index.css` 를 링크하고 있었다 → 제거 (프로덕션 빌드 실패 원인).
- `ChatMessage` 에 `intent` / `recommendations` 추가, `Concert` 에 `dateRaw / time / seat / seatRaw / composers / ocrConfidence` 추가.
- OCR 관련 타입의 단일 출처를 `ocrSchema.ts` 로 옮기고 `types.ts` 는 re-export만 한다 (앱과 평가가 갈라지지 않도록).
- 관람 이력 주입을 최근 20건, 피드백을 최근 10건으로 잘랐다. 토큰이 무한 선형 증가하던 것을 임시로 막는 조치다
  (근본 해결은 쓰기 시점 요약 = ARCHITECTURE B1).
- `enrichProgramNotes` 가 프로그램이 비면 API를 아예 호출하지 않는다.
- JSON 파싱 실패 시 앱이 죽지 않도록 전부 try/catch + 기본값.

---

# 2차 수정 — OCR 평가 실측 반영

1차 평가 결과(`eval/out/report.md`, 롯데+예당 13장, 전체 필드 정확도 85.0%)로 드러난 문제를 고쳤다.
**감으로 고치지 않았다** — 리포트가 지목한 것만 손댔다.

## J. `seat.grade` 정확도 8.3% — 스키마 갭 (최우선)

**측정값**: 12건 중 **1건**만 맞음.

**원인**: `OCR_RESPONSE_SCHEMA` 에 **등급 필드가 없었다.** 필드는
`title, artist, venue, dateRaw, timeRaw, seatRaw, priceRaw, program` 이 전부였다.
그런데 실물 티켓에서 등급(`R석`, `회원석`, `VIP석`, `일반석`, `1층석`)은 좌석 문자열과
**완전히 다른 영역**(금액 옆·별도 박스·스텁)에 인쇄된다. `seatRaw` 에 안 담기니
`parseSeat()` 는 없는 걸 파싱할 수 없었다. 파서 문제가 아니라 **스키마 문제**였다.

**한 일**
- `OCR_RESPONSE_SCHEMA` 에 `gradeRaw` 필드 추가 (`required` 에도 포함).
- 프롬프트에 명시: *"등급은 좌석 문자열과 완전히 떨어진 위치에 인쇄되는 경우가 대부분입니다 —
  금액 옆, 별도 박스, 티켓 모서리, 스텁 쪽. 좌석 칸에 등급이 안 보이더라도 티켓 전체를 훑어
  반드시 따로 찾으세요."* + few-shot 3개 전부에 `gradeRaw` 를 넣었다.
- `parseSeat(raw, gradeRaw?)` 로 시그니처 확장.
  - `gradeRaw` 가 있으면 **그 값을 그대로** 등급으로 쓴다. 화이트리스트로 정규화하지 **않는다** —
    정답지에 `회원석` · `일반석` · `1층석` · `R석 초대` 처럼 다양한 표기가 그대로 들어 있다.
  - 없으면 기존 `seatRaw` 스캔으로 폴백.
- `postProcessOCR` 이 `gradeRaw` 를 `parseSeat` 에 넘기고 `OCRResult.gradeRaw` 로도 노출.
- 티켓 검수 폼에 **좌석 등급 입력칸**을 추가. 좌석/등급 중 하나를 고치면 둘을 합쳐 재파싱한다.

> ⚠️ **계약 변경.** `parseSeat(raw)` **단일 인자 호출은 그대로 동작한다** (2번째 인자 optional).
> 평가 하네스(`eval/lib/scoring.mjs`)는 `processed.seat` 이 있으면 그걸 쓰고, 없을 때만
> `mod.parseSeat(s.raw)` 로 폴백하므로 양쪽 경로 모두 안전하다. 회귀 테스트로 고정해 뒀다.

## K. confidence 가 무용지물이던 문제

**측정값**: confidence ↔ 정답률 상관 **-0.042**(부호까지 반대), 139개 필드 중 **130개가 0.9~1.0**.
그리고 내 `postProcessOCR` 보정이 ECE를 **0.211 → 0.282 로 악화**시키고 있었다.
즉 `ARCHITECTURE` 4-3 C2의 **"confidence < 0.8 노란 테두리" UI가 실제로는 아무것도 강조하지 못했다.**

**왜 내 보정이 오히려 나빴나** (리포트 4-1/4-2 표를 읽고 확인):
- `dateConfidence = LLM신뢰도 × 파싱신뢰도` 곱하기가 값을 0.4~0.7 구간으로 끌어내렸는데,
  그 구간의 **실제 정답률은 75~83%** 였다. 과소신뢰를 만들어 ECE를 키웠다.
- `값이 비면 confidence 0` 강제 때문에 0.0~0.1 버킷 샘플이 **5개 → 18개**로 늘었다.
  이 버킷은 정답률 100%(올바른 기권)이라 격차 -1.0이 그대로 ECE에 곱절로 들어갔다.
  **표본 수도 139 → 152로 늘려서** 내가 만든 항목이 지표를 지배했다.

**한 일**
1. **보정 제거.** `postProcessOCR().confidence` 는 이제 **모델 자기신고를 그대로 통과**시킨다.
   곱하기도, 빈 값 강제 0도 없앴다. → 보정 후 ≈ 보정 전이 되어 최소한 **악화는 사라진다.**
2. **파싱 신호를 분리.** 새 필드 `OCRResult.parseConfidence = { date, time, seat }`.
   "모델이 얼마나 또렷이 읽었나"(자기신고)와 "코드가 파싱에 성공했나"(독립 신호)를
   **섞지 않고 따로** 노출한다. 섞으면 둘 다 해석 불가능해진다.
   `seat.confidence` 도 순수 파싱 신뢰도로 되돌렸다.
3. **UI 판정을 3신호 OR 로.** 자기신고만 보면 아무것도 안 노래지므로:
   `자기신고 < 0.8` **또는** `날짜 파싱 실패` **또는** `좌석 파싱 실패` **또는** `값이 비어 있음`.
   빈 값과 파싱 실패는 자기신고와 무관하게 잡히므로 강조가 실제로 켜진다.
4. **negative few-shot 추가.** "빈 문자열로 반환하라"고 **말만** 하고 예시가 없던 것을 고쳤다.
   예시 3을 "티켓 오른쪽이 접혀 좌석·금액이 안 보이는 저품질 이미지"로 만들고,
   해당 필드에 `""` + `confidence: 0` 을 반환하는 **정답 예시**를 실제로 보여준다.
   이어서 ❌ 목록으로 실측된 실패를 그대로 적었다:
   *"금액이 안 보이는데 30,000원이라고 적는 것", "가려진 좌석에 S석 기획사운영석이라고 적는 것",
   "안 보이는 값에 confidence 0.9를 주는 것"*.
5. **self-consistency 도입** (자기신고 대신 실제 불확실성 신호).
   - `mergeOCRRuns(runs: OCRResult[])` — 순수 함수. 여러 판독 결과를 합치고
     **confidence 를 "실행 간 일치율"로 덮어쓴다.** 둘 다 같으면 1, 갈리면 0.5.
     `program` 은 모든 실행에 공통으로 등장한 곡만 남긴다.
   - `needsSecondPass(result)` — 평균 confidence가 낮거나 날짜/공연명이 비었을 때만 true.
     전건에 2회 호출하면 비용 2배라 **저신뢰 이미지에만** 조건부로 돈다.
   - `performOCR()` 이 이걸 물려 1차 → (필요시) 2차 → 병합. 2차 실패해도 1차 결과를 버리지 않는다.
   - 순수 함수라 평가 하네스가 `--repeat` 결과를 그대로 넣어 검증할 수 있다.

### K-1. 실제로 무엇이 ECE를 망가뜨리고 있었나 (재채점으로 확인)

보정을 없앤 것만으로는 **부족했다.** 기존 원 응답을 새 코드로 재채점해 보니 여전히
`0.0–0.1` 버킷에 샘플이 18개 있었고 ECE는 0.279였다. 원인을 표본 수에서 찾았다:

```
보정 전 표본 139  vs  보정 후 표본 152   → 차이 13 = 이미지 수와 정확히 일치
```

**내 `confidence` 맵이 모델이 응답에 넣지도 않은 필드에 `0` 을 지어내고 있었다.**
특히 `program: []` — 한국 티켓은 곡목이 안 찍히는 게 정상이라 13장 전부 빈 배열이었고,
거기에 매번 `confidence.program = 0` 을 만들어 붙였다. 정답도 null이라 "올바른 기권"으로
정답률 100%가 되고, 격차 -1.0이 13번 ECE에 곱해졌다. **없는 것에 대한 "확신도 0"은
정보가 아니라 노이즈다.**

**한 일**: `buildConfidenceMap()` 을 만들어 **모델이 실제로 응답에 넣은 필드에만** 항목을 만든다.
빈 `program` 배열도 항목을 만들지 않는다.

### K-2. 측정 결과 (API 호출 0회 — 기존 원 응답 재채점)

쿼터가 소진돼 새로 수집은 못 했지만, **기존 raw 응답을 새 `postProcessOCR` 로 다시 채점**하면
코드 변경분의 효과는 그대로 측정된다. `node eval/score.mjs --raw-dir eval/out/raw --out <임시경로>`.

| 지표 | 수정 전 | 수정 후 | |
|---|---:|---:|---|
| ECE (보정 후) | 0.282 | **0.212** | ✅ 개선 |
| **보정으로 인한 악화폭** | **+0.071** | **+0.001** | ✅ 사실상 제거 |
| 상관계수 (보정 후) | -0.107 | **-0.015** | ✅ 개선 |
| 표본 수 (보정 후) | 152 | **139** | ✅ 지어낸 항목 제거 |
| 전체 필드 정확도 | 85.0% | 85.0% | — 변화 없음 |

즉 **"보정이 지표를 악화시키는" 문제는 해소됐다.** 목표는 달성했다.

⚠️ **단, 모델 자기신고 자체는 여전히 나쁘다** (보정 전 ECE 0.210, 상관 0.000).
이건 코드로 못 고친다 — 프롬프트 negative few-shot과 self-consistency, 그리고 UI의 3신호 OR가
그걸 겨냥한 것이고, **그 효과는 쿼터 회복 후 재수집해야 측정된다.**

⚠️ **부수 변화 하나를 숨기지 않고 적는다**: 할루시네이션율이 15.6% → 17.8%로 **1건 늘었다.**
`sac_musical_gwangju_2022.jpg` 의 `seat_raw: "S석"` 이 원래 `0.9 × 0.5 = 0.45` 로
"저신뢰 기권"(임계값 0.5) 처리되던 것이, 곱하기를 없애면서 `0.5` 가 되어 임계값을 못 넘었다.
**모델 동작은 그대로다** — 0.45와 0.50이 0.5 경계를 사이에 두고 뒤집힌 채점 아티팩트다.
오히려 새 판정이 더 정직하다(모델은 실제로 없는 좌석을 지어냈다).

## L. 지연 20.3초 — thinking 토큰 과다

**측정값**: 평균 20,281ms · p95 33,146ms · thinking 1,475토큰 vs 출력 168토큰(**9배**).

**한 일**: `thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }` 을 **답이 짧고 정형인 호출 5곳**에
적용 — OCR · 의도분류 · 쿼리확장 · 추천카드 추출 · 피드백 요약 (ARCHITECTURE 4-2 B5).
티켓에서 글자를 읽는 데 출력의 9배짜리 추론은 필요 없다. 지연과 비용이 함께 준다.
최종 응답 생성(Pro)에는 적용하지 **않았다** — 거기선 추론이 값을 한다.

⚠️ **이 수정은 현재 평가 하네스로는 측정되지 않는다.** `eval/lib/gemini.mjs` 가
`generationConfig` 를 직접 조립하고, `ocrSchema.ts` 에서는 프롬프트·스키마만 가져가기 때문이다.
그래서 **`OCR_GENERATION_CONFIG` 를 새로 export** 했다 (SDK 의존 없는 순수 객체,
REST `generationConfig` 에 그대로 펼쳐 넣을 수 있는 모양):

```ts
export const OCR_GENERATION_CONFIG = {
  temperature: 0,
  thinkingConfig: { thinkingLevel: 'MINIMAL' },
};
```

앱(`geminiService.ts`)은 이미 이걸 쓴다. 평가 담당이 `generateOcr()` 의 `generationConfig` 에
이 객체를 펼쳐 넣어 주면 지연 개선이 리포트에 반영된다. **한 줄이면 된다.**

## M. artist 귀속 오류/날조 (리포트 3-1·3-2에서 발견)

리포트의 할루시네이션 12건 중 **8건이 `artist`** 였다 (날조 3 + 귀속오류 5).
확인해 보니 **내 프롬프트가 직접 시킨 것**이었다:

> 이전: `artist : 연주자/연주단체. … 공연명 안에만 있으면 거기서 가져오세요.`

이 한 줄 때문에 모델이 `손열음의 음.악.편.지.` 에서 `손열음` 을, `소프라노 박혜상 리사이틀` 에서
`소프라노 박혜상` 을 artist로 복사했다. 정답지 기준으로는 전부 **오답**(티켓에 연주자 칸이 없음)이다.

**한 일**: 해당 지침을 삭제하고 반대로 명시했다 —
*"연주자 칸이 따로 인쇄돼 있을 때만 채웁니다. 공연명에서 연주자를 추출하지 마세요.
포스터 이미지의 단체명·주최사·후원사를 연주자로 옮기지 마세요. 없으면 "" + confidence 0."*
예시 2도 "공연명에 사람 이름이 없고 연주자 칸도 없으므로 artist는 빈 문자열"로 바꿨다.

## O. 평가 재실행 — 쿼터 소진으로 **미완**

`node eval/run.mjs` 재실행을 시도했으나 **HTTP 429 (You exceeded your current quota)** 로 전부 실패했다.

```
FAIL  lotte_met_opera_2024.jpg  HTTP 429: "You exceeded your current quota..."
```

(처음엔 `타임아웃 90000ms` 로만 보였다 — 재시도 백오프가 429를 삼키고 있었다.
`--max-retries 0` 으로 한 번 찔러서 진짜 원인을 확인했다.)

**그래서 한 것 / 안 한 것**
- ✅ **API 없이 측정 가능한 것은 측정했다** — 기존 원 응답 재채점으로 K-2의 ECE 수치를 얻었다.
- ❌ 새 프롬프트(`gradeRaw`, negative few-shot, artist 지침)와 thinking 설정의 효과는
  **아직 측정되지 않았다.** 쿼터 회복 후 재수집이 필요하다.
- 억지로 돌리지 않았다. 실패한 시도의 산출물(`eval/out/raw-v2/`, `raw-probe/`,
  `run-summary-gemini-3.7-flash.json`)은 **전부 지웠다.**
  평가 담당의 기준선(`eval/out/raw/gemini-3-flash-preview/`, `report.md`, `scores.json`,
  `run-summary-gemini-3-flash-preview.json`)은 **그대로 보존**돼 있다.

**쿼터 회복 후 실행할 것** (프롬프트·스키마 해시가 바뀌었으므로 캐시는 자동 무효화된다):
```bash
node eval/run.mjs            # --model 지정하지 말 것. 기준선이 OCR_MODEL(gemini-3-flash-preview)로 측정됐다
node eval/score.mjs
```

확인할 것: `seat.grade` 정확도(8.3% → ?), 할루시네이션율(특히 `artist`), 평균 지연(20.3초 → ?).
**떨어지면 되돌린다.** 특히 thinking MINIMAL은 정확도를 깎을 수 있으니 반드시 대조할 것.

## N. 회귀 테스트 25 → 40건

추가한 것: `gradeRaw` 경로 6건 · **`parseSeat` 단일 인자 하위 호환 1건** ·
confidence 무보정/무날조 정책 5건 · self-consistency/`needsSecondPass` 5건 ·
`OCR_GENERATION_CONFIG` 계약 1건.
`OCR_RESPONSE_SCHEMA.required` 에 `gradeRaw` 가 있는지도 계약 테스트로 고정했다.

폐기한 테스트 1건: `값이 비었는데 confidence가 높다고 우기면 0으로 깎는다` —
이 동작이 바로 ECE를 악화시킨 원인이라 **정책이 바뀌었다.** 새 정책 테스트가 대체한다.

---

## 평가 담당과의 인터페이스 계약 (지킨 상태)

`app/services/ocrSchema.ts` named export:

```ts
export const OCR_MODEL: string;                     // 'gemini-3-flash-preview' (models.ts 참조)
export const OCR_PROMPT: string;
export const OCR_RESPONSE_SCHEMA: object;
export function parseSeat(raw: string, gradeRaw?: string): ParsedSeat;  // 2번째 인자 optional — 단일 인자 호출 하위 호환
export function normalizeDate(raw: string): { value: string | null; confidence: number };
export interface ParsedSeat { floor; block; row; number; grade; raw; confidence }
```

추가로 쓸 수 있는 것 (전부 순수 함수):
`normalizeTime` · `parsePrice` · `extractComposers` · `postProcessOCR` · `stripNonSeatTokens` ·
`mergeOCRRuns` · `needsSecondPass` · `LOW_CONFIDENCE_THRESHOLD` · `withUserEdit`

`OCR_RESPONSE_SCHEMA.required` (2차 수정 후):
`title, artist, venue, dateRaw, timeRaw, seatRaw, **gradeRaw**, priceRaw, program`

`OCRResult` 에 추가된 것: `gradeRaw: string` · `parseConfidence: { date, time, seat }`.
`confidence` 는 이제 **모델 자기신고 그대로**(보정 없음)라는 점에 주의.

- **브라우저 API 의존 없음.** 유일한 import는 `./models.ts` (역시 순수).
  `node --experimental-strip-types` 로 직접 import 되는 것을 확인했다.
- 이미지 전처리는 `app/services/imagePrep.ts` 에 분리돼 있다.
- `geminiService.ts` 는 프롬프트/스키마를 **복사하지 않고 import** 한다. 두 벌이 되면 평가가 무의미해진다.

---

## 못 고친 것 / 일부러 안 한 것

| 항목 | 이유 |
|---|---|
| **Flutter 재작성** | 이번 범위 밖. 로컬 React 프로토타입이 계속 돌아야 한다 |
| **서버리스 백엔드 이전** | 이번 범위 밖. 그래서 API 키는 여전히 번들에 박힌다 — **배포 금지 상태 유지** |
| **진짜 RAG (후보 풀 + 하이브리드 검색 + ID 검증)** | KOPIS 수집·D1·Vectorize가 선행돼야 한다. 지금도 추천은 Google Search 그라운딩에 의존하며, **존재하지 않는/지난 공연을 추천할 수 있다.** 프롬프트에 "오늘 이후만" "지어내지 마세요"를 넣었지만 이건 부탁이지 보증이 아니다 |
| **SSE 스트리밍 (TTFT 개선)** | `@google/genai` 로 클라이언트 스트리밍은 가능하지만, 체감 개선의 본체는 Worker SSE 릴레이 설계와 함께 가는 게 맞다고 판단해 미뤘다. 지금 추천 응답은 여전히 완료까지 4~7초 |
| **context caching / taste_profile 쓰기 시점 요약** | 서버 쪽 설계(B1/B2)와 묶여 있다. 대신 이력·피드백 주입을 최근 N건으로 잘라 임시 방어만 했다 |
| **곡목 정규화 (`works` 사전 + 임베딩 매칭)** | `extractComposers`는 문자열 사전 매칭이라 사전에 없는 작곡가는 놓친다. `"Chopin: 24 Preludes"`와 `"쇼팽 전주곡 24개"`가 같은 **곡**이라는 것도 아직 모른다 (작곡가 수준까지만 정규화됨) |
| **좌석 → 픽셀아트 단면도 / 아바타** | 리서치 문서 §3~ 범위. 이번 목표는 "티켓 인식이 잘 되는지 확인"이라 파서까지만 했다. `ParsedSeat`에 `behindStage` / `seatNumbers` / `rowLabel` 을 추가하는 스키마 확장도 함께 보류 — 평가 계약을 흔들지 않기 위해 |
| **`confidence` 가중치 재설계** (리서치 §2.5) | 지금은 `0.4 + 0.15 × 채워진 필드 수`. 단면도를 그릴 때는 층 가중치를 높이는 게 맞지만, 그 소비자가 아직 없고 평가 담당의 기대값을 흔들 수 있어 이번 라운드에서는 유지했다 |
| **좌석 수동 보정 UI (드롭다운)** | `seatRaw` 텍스트 직접 수정 + 파싱 결과 실시간 미리보기까지만 넣었다. 층/구역/열/번 개별 드롭다운은 단면도가 생길 때 함께 |
| **연석(`15열 10,11번`) / 알파벳 열(`A열`) / OCR 글자 오인(`B↔8`)** | 리서치 §2.4 우선순위 중. 실물 확인이 아직 `[추론]` 단계라 보류 |
| **`AgentTimeline` 의 "30% 개선" 근거** | 비교군 측정 코드가 없다. 보고서에서 정정하거나 근거를 붙여야 한다 (ARCHITECTURE 1-3) |
| **번들 크기 608KB** | Vite가 경고한다. 코드 스플리팅은 로컬 확인 목적에 불필요해서 손대지 않았다 |

---

## 다음에 해야 할 것 (권장 순서)

1. **실물 티켓 4장으로 OCR 실측** — `testdata/_raw_screenshots/` 를 실제로 올려 보고, 특히 게이트가 인쇄된 롯데 티켓에서 `seatRaw`에 게이트가 섞여 들어오는지 확인한다. 섞여 들어온다면 파서(방어 3중)가 막아 주지만, 프롬프트 쪽에서 먼저 막는 게 낫다.
2. **좌석 파서 실측 커버리지 확장** — 실측에서 깨지는 케이스를 `ocrSchema.test.ts` 에 계속 추가한다. 회귀하면 조용히 틀린다.
3. **`ParsedSeat` 스키마 확장** (`behindStage` / `seatNumbers` / `rowLabel`) + confidence 가중치 재설계 → 단면도 렌더러와 함께.
4. **키를 서버로** (ARCHITECTURE 7단계 "0. 지혈"). 이게 끝나기 전에는 어떤 형태로도 배포·링크 공유 금지.
5. **추천 후보 풀** (KOPIS 수집 → 하이브리드 검색 → ID 검증). 할루시네이션을 구조적으로 막는 유일한 방법이고, F1의 임시 `concertId` 문제도 여기서 사라진다.
6. **SSE 스트리밍** — 총 시간이 같아도 TTFT가 6~9s → ~1.2s로 떨어진다. 체감 개선이 가장 크다.
