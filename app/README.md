# Classic Lions (클래식 리언즈) — 로컬 프로토타입

React 19 + Vite + TypeScript + `@google/genai`.
티켓 사진 한 장으로 공연을 아카이빙하고, 취향 기반 큐레이션을 받는 앱의 **로컬 프로토타입**입니다.

---

## 🚨 배포 금지

이 프로토타입은 **로컬 개발 전용**입니다. `npm run build` 결과물(`dist/`)을 어디에도 올리지 마세요.

`vite.config.ts`의 `define`은 빌드 시점 **문자열 치환**이라 Gemini API 키가 번들 JS에
**평문으로 박힙니다.** 배포하는 순간 누구나 DevTools에서 키를 꺼낼 수 있습니다.
(`npm run build` 를 실행하면 터미널에 이 경고가 뜹니다.)

배포하려면 먼저 키를 서버로 옮겨야 합니다 — 서버리스 프록시 설계는
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) 2장·7장 "0. 지혈" 참고.

---

## 실행

**필요:** Node.js 20+

```bash
cd app
npm install
# app/.env 에 GEMINI_API_KEY=발급받은키
npm run dev          # http://localhost:3000
```

`.env` 값은 Vite가 **빌드/기동 시점에** 읽습니다. 키를 바꾸면 **개발 서버를 재시작**하세요.
키가 없거나 자리표시자면 앱이 조용히 실패하지 않고 화면 상단에 빨간 안내를 띄웁니다.

```bash
npx tsc --noEmit     # 타입 체크
npm run build        # 프로덕션 빌드 (배포용 아님 — 위 경고 참고)
```

---

## 구조

```
app/
├─ App.tsx                    라우팅 + localStorage 영속화
├─ types.ts                   공용 타입 (OCR 타입은 ocrSchema.ts에서 re-export)
├─ components/
│  ├─ Dashboard.tsx           채팅 큐레이션 · 추천 카드 · 카드 단위 피드백 · 실측 통계
│  ├─ TicketOCR.tsx           티켓 업로드 → 전처리 → OCR → HITL 검수 폼
│  ├─ CalendarView.tsx        월별 아카이브
│  ├─ ProfileSettings.tsx     취향 설정
│  └─ AgentTimeline.tsx       단계별 소요시간
└─ services/
   ├─ models.ts               ⭐ 모델 ID 단일 출처
   ├─ ocrSchema.ts            ⭐ OCR 프롬프트/스키마 + 순수 파서 (브라우저 API 없음, Node에서 import 가능)
   ├─ imagePrep.ts            canvas 리사이즈 · EXIF 회전 보정 (브라우저 전용)
   ├─ geminiService.ts        Gemini 호출 · 통계 빠른 경로 · 에러 메시지
   └─ storage.ts              localStorage 영속화 + 용량 초과 처리
```

### `services/ocrSchema.ts` 는 계약 파일입니다

평가 파이프라인이 **이 파일을 그대로 import** 해서 앱과 동일한 로직을 테스트합니다.

- `OCR_MODEL` / `OCR_PROMPT` / `OCR_RESPONSE_SCHEMA`
- `parseSeat(raw, gradeRaw?): ParsedSeat` — 2번째 인자는 **optional**(단일 인자 호출 하위 호환)
- `normalizeDate(raw): { value: string | null; confidence: number }`
- 덤: `normalizeTime` / `parsePrice` / `extractComposers` / `postProcessOCR` /
  `stripNonSeatTokens` / `mergeOCRRuns` / `needsSecondPass`

### confidence 를 단독으로 믿지 말 것

실측(`eval/out/report.md`)에서 모델 자기신고 confidence는 **정답률과 상관 -0.042**,
139개 필드 중 130개가 0.9~1.0에 몰렸다. LLM에게 확신도를 물으면 거의 항상 높게 답한다.

그래서 `postProcessOCR().confidence` 는 자기신고를 **가공 없이 그대로** 통과시키고
(가공했더니 ECE가 0.211 → 0.282로 악화됐다), 진짜 신호는 따로 준다:

| 신호 | 뜻 |
|---|---|
| `confidence[f]` | 모델 자기신고. 변별력 낮음 |
| `parseConfidence.{date,time,seat}` | 코드 파싱 성공 여부. 자기신고와 **독립** |
| `value === ''` | 빈 값. 가장 확실한 검수 필요 신호 |
| `mergeOCRRuns()` 후의 `confidence` | 실행 간 **일치율**. 자기신고보다 정직 |

UI는 이 넷을 OR로 묶어 노란 테두리를 켠다.

규칙:
- **브라우저 API 금지** (`document`, `canvas`, `window`, `FileReader`). 유일한 import는 `./models.ts`.
- 프롬프트·스키마를 다른 파일에 복사하지 마세요. `geminiService.ts`는 여기서 import 합니다.
  두 벌이 되면 평가와 실제 앱이 갈라져 평가가 무의미해집니다.

### 모델 ID

`services/models.ts` 한 곳에서만 관리합니다. alias(`-latest`)는 재현성을 깨므로 쓰지 않습니다.

| 역할 | 모델 |
|---|---|
| OCR · 의도분류 · 쿼리확장 · 유틸 | `gemini-3-flash-preview` |
| 프로그램 노트 · 최종 응답 | `gemini-3.1-pro-preview` |

> `gemini-3-pro-preview` 는 **존재하지 않습니다.** 쓰면 런타임 404입니다.

---

## 저장

브라우저 `localStorage` (`classic-lions/v1/*`). 새로고침해도 아카이브·취향·피드백이 남습니다.
티켓 이미지는 base64라 용량이 큽니다 — 쿼터를 넘으면 오래된 티켓 **사진만** 떼어내고
공연 정보는 보존하며, 그 사실을 화면 상단 배너로 알립니다.

초기화가 필요하면 DevTools → Application → Local Storage 에서 `classic-lions/v1/*` 삭제.
