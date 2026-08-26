# eval/ — 티켓 OCR 정확도 평가 하네스

`testdata/tickets/` 의 티켓 이미지를 **실제 앱과 똑같은 프롬프트·스키마**로 Gemini에 넣고,
`testdata/eval/ground_truth.json` 정답지와 대조해 필드별 정확도를 측정한다.

설계 근거: `ARCHITECTURE.md` 4-3절(OCR 정확도).

---

## 0. 핵심 원칙

**프롬프트·스키마·후처리기를 이 폴더에 복사하지 않는다.**
전부 `app/services/ocrSchema.ts` 에서 `import` 한다. 복사하는 순간 평가 대상이 실제 앱과 갈라져서
측정값이 무의미해진다. 이 규칙 때문에 `ocrSchema.ts` 가 없으면 하네스는 채점을 시작하지 않고
"코드 담당 산출물 대기 중"이라고 알린 뒤 종료한다.

하네스가 앱에서 가져다 쓰는 것:

| import | 쓰는 곳 |
|---|---|
| `OCR_MODEL` | 호출 모델 (기본값, `--model` 로 override 가능) |
| `OCR_PROMPT` | 요청 프롬프트 그대로 |
| `OCR_RESPONSE_SCHEMA` | `responseSchema` 그대로 |
| `normalizeDate(raw)` | `date` 채점 전 정규화 |
| `parseSeat(raw)` | `seat` 필드별 채점 |
| `parsePrice(raw)` | `price` 채점 (있으면 사용, 없으면 자체 숫자 파싱) |
| `postProcessOCR(raw)` | **있으면 최우선.** 앱이 실제로 저장하는 값·confidence 를 그대로 채점한다 |

`postProcessOCR()` 이 있으면 개별 함수 대신 그 결과를 쓴다. 앱이 화면에 띄우는 값과
평가가 채점하는 값이 같아야 하기 때문이다. 이 함수는 confidence 도 보정하므로
(`date` = LLM 판독 신뢰도 × 코드 파싱 신뢰도, 빈 값이면 0), 캘리브레이션은 **보정 전/후를 나눠서** 집계한다.

---

## 1. 준비

### 1-1. API 키

`GEMINI_API_KEY` 를 아래 중 한 곳에 넣는다(앞에 있는 파일이 우선).

```
eval/.env.local  →  eval/.env  →  .env.local  →  .env  →  app/.env.local  →  app/.env
```

```bash
echo 'GEMINI_API_KEY=여기에_실제_키' > app/.env
```

키는 https://aistudio.google.com/apikey 에서 발급한다. 이 파일들은 `.gitignore` 대상이다.

- **키 형식은 검증하지 않는다.** 구형 키는 `AIza…`, 신형 키는 `AQ.…` 로 시작한다.
  접두사를 요구하면 유효한 키를 거부하게 되므로, 하네스는 "비어 있는가 / `PLACEHOLDER` 로 시작하는가"만 본다.
- 키가 없거나 플레이스홀더면 러너는 **스택트레이스 없이** 한국어 안내를 출력하고 exit 1 한다.
- 키 값은 로그·리포트·저장 파일 어디에도 남지 않는다. API 실패 메시지도 `redact()` 를 거친다.

### 1-2. 의존성

없다. Node 22+ 내장 `fetch` 로 REST를 직접 호출하고, `.ts` 는 Node의 타입 스트리핑으로 그대로 import 한다.
`npm install` 불필요.

> `ocrSchema.ts` 가 `enum` / `namespace` / 생성자 파라미터 프로퍼티를 쓰면 Node가 실행하지 못한다.
> 그 경우 하네스가 무엇이 문제인지 알려준다. `as const` 객체로 바꾸면 된다.

---

## 2. 사용법

```bash
# 1) OCR 실행 → eval/out/raw/*.json
node eval/run.mjs

# 2) 채점 + 리포트 → eval/out/scores.json, eval/out/report.md
node eval/score.mjs

# 리포트만 다시 그리기
node eval/report.mjs
```

### `run.mjs` 옵션

| 옵션 | 뜻 |
|---|---|
| `--scope in\|out\|all` | 평가 범위. `in` = 롯데+예당(채점기 기본), `out` = 세종, `all` = 전부 |
| `--only <파일명>` | 이미지 하나만 |
| `--no-cache` | 캐시 무시하고 전부 재호출 |
| `--repeat N` | 같은 이미지 N회 호출 (비결정성 측정). **기본 1 — 비용 주의** |
| `--concurrency N` | 동시 호출 수 (기본 3) |
| `--model <id>` | 모델 override. 기본값은 `OCR_MODEL` |
| `--out-suffix <s>` | 결과를 `out/raw-<s>/` 에 분리 저장 (모델 비교 시 필수) |
| `--resize <px>` | 장변 px로 리사이즈 후 호출 (macOS `sips`). ARCHITECTURE 4-3 **C1** 검증용 |
| `--temperature N` | 생성 온도 |
| `--max-retries N` | 429/5xx 재시도 (기본 4, 지수 백오프 + `Retry-After` 존중) |
| `--dry-run` | 호출 없이 대상·설정만 출력 |

### 리포트 무결성 규칙 (중요)

**라벨은 항상 데이터에서 나온다. CLI 인자나 요약 파일이 아니다.**

- 리포트의 모델 이름은 `eval/out/raw/**/*.json` 의 `meta.model` 에서 가져온다.
- 원 응답은 **모델별 디렉터리**에 저장된다: `eval/out/raw/<모델>/<파일>.json`
- `run-summary` 도 모델별로 분리된다: `eval/out/run-summary-<모델>.json`
- 원 응답에 모델이 2개 이상 있으면 `score.mjs` 는 **채점을 거부**하고 `--model` 을 요구한다.
  서로 다른 모델의 결과를 하나의 정확도로 합치면 그 수치는 아무 모델도 대표하지 못한다.
- 리포트 상단에 **모델별 raw 건수**가 찍힌다. 섞였으면 눈에 보인다.
- 원 응답의 **프롬프트/스키마 해시**가 현재 `ocrSchema.ts` 와 다르면 리포트 상단에 빨간 경고가 뜬다.
  (채점기는 현재 모듈의 후처리기를 쓰므로, 모듈이 바뀌면 같은 raw 라도 점수가 달라진다.)

> 왜 이 규칙이 있는가: 실제로 `--model` 비교 실행이 실패했는데 공유 `run-summary.json` 을 덮어써서,
> **이전 모델의 숫자에 새 모델 이름이 붙은 리포트**가 만들어진 적이 있다.
> 어느 모델의 숫자인지 틀리게 적힌 리포트는 없느니만 못하다.

**실패는 성공 캐시를 덮어쓰지 않는다.** 쿼터가 소진된 상태에서 재실행해도
기존의 성공 응답은 보존된다(`└ 기존 성공 응답 보존` 로그).

**캐시**는 `모델 + 프롬프트 해시 + 스키마 해시 + 이미지 해시 + resize` 가 전부 같을 때만 재사용한다.
코드 담당이 프롬프트를 고치면 캐시가 자동 무효화되므로 옛 응답으로 새 프롬프트를 평가하는 사고가 안 난다.
(`--allow-stale-cache` 로 강제 재사용 가능.)

### 모델 비교

```bash
node eval/run.mjs --model gemini-3-flash-preview --out-suffix flash3
node eval/run.mjs --model gemini-3.5-flash       --out-suffix flash35
node eval/score.mjs --raw-dir eval/out/raw-flash3  --out eval/out/flash3
node eval/score.mjs --raw-dir eval/out/raw-flash35 --out eval/out/flash35
```

### `score.mjs` 옵션

| 옵션 | 뜻 |
|---|---|
| `--scope in\|out\|all` | 헤드라인 지표의 범위 (기본 `in`). 범위 외도 "참고" 섹션에 따로 집계된다 |
| `--fixtures` | **채점기 self-test.** API 키·이미지 불필요 |
| `--truth <path>` / `--raw-dir <path>` / `--out <dir>` | 경로 override |
| `--low-conf N` | "저신뢰 기권" 판정 임계값 (기본 0.5) |
| `--no-report` | `report.md` 생략 |

---

## 3. 채점 기준 — 필드마다 다르다

| 필드 | 기준 | 왜 |
|---|---|---|
| `date` | `normalizeDate()` 통과 후 **정확일치** (zero-padded `YYYY-MM-DD`) | 4-3 C3. `2025-3-15` 처럼 zero-pad 없는 값은 **오답**. 정렬·범위쿼리가 깨지므로 관용하면 안 된다 |
| `seat` | `parseSeat()` 결과를 `floor`/`block`/`row`/`number`/`grade` **각각** 채점 | 좌석 전체를 한 덩어리로 보면 "1층만 틀림"과 "전부 틀림"이 같은 점수가 된다 |
| `seat_raw` | 문자열 유사도 + 정규화 exact | OCR 자체 품질과 파서 품질을 분리해서 봐야 어디를 고칠지 안다 |
| `title` `artist` `venue` | 정규화 후 **exact** + **Levenshtein 유사도** 둘 다 | 클래식 공연명은 표기 변형(괄호·공백·부제)이 많아 exact만 보면 과소평가된다 |
| `program` | 집합 비교 **precision / recall / F1** | 순서는 무의미하고 누락/추가를 구분해야 한다 |
| `price` | 숫자 정확일치 (`parsePrice` 경유) | |
| 정답이 `null`/`""` 인 필드 | **할루시네이션 판정** — 아래 4장 | |

정규화 = NFKC → 소문자 → 괄호·구두점 제거 → 공백 전부 제거.
`program` 은 추가로 `Op.`/`작품번호`/`No.` 표기를 통일한다 (`Chopin: 24 Preludes Op. 28` ≡ `Chopin - 24 Preludes, Op.28`).

---

## 4. 할루시네이션 — 가장 중요한 지표

정답지의 `unreadable_fields` (또는 정답이 `null`/`""`)는 **티켓에 실제로 없는 정보**를 뜻한다.
여기서 모델이 무엇을 하는지가 이 앱의 신뢰도를 결정한다.

**"정답이 null인데 값이 있다" 를 전부 할루시네이션으로 세면 과대계상된다.**
실측에서 성격이 다른 세 가지가 섞여 나왔고, 고치는 방법도 서로 다르다.

| 판정 | 조건 | 정답? |
|---|---|---|
| `abstain_empty` | 빈 값 반환 | ✅ |
| `abstain_lowconf` | 값은 냈지만 `confidence < 0.5` | ✅ |
| `nonnumeric_text` | `price` 정답이 null 인데 모델이 숫자 없는 인쇄 문자열(`초대권`)을 읽음 | ✅ raw 판독으로는 정상 |
| `misattributed` | 값이 **같은 티켓의 다른 정답 필드 글자**에 포함됨 (공연명을 artist 에도 복사) | ❌ 오답, 단 날조 아님 |
| `fabricated` | 위 어디에도 해당 없음 = 티켓에 없는 정보를 지어냄 | ❌ **진짜 할루시네이션** |

리포트는 세 숫자를 모두 낸다:

- **`hallucination_rate` = `fabricated` / (정답 null 필드)** ← 헤드라인. "모델이 거짓말을 하는가"
- `misattribution_rate` = `misattributed` / (정답 null 필드) ← 프롬프트의 필드 정의 문제
- `strictRate` = 값이 있으면 전부 오답 ← 가장 보수적인 상한

`misattributed` 판정은 예측값을 정규화해 같은 티켓의 다른 정답 필드 문자열과 **포함 관계**로 비교한다.
정보를 만들어낸 것과 필드를 잘못 고른 것을 구분하지 않으면, 프롬프트를 어디에서 고쳐야 하는지 알 수 없다.

두 가지 설계 결정을 기억할 것:

1. **판정은 모델 원값으로 한다.** 후처리 결과로 하면 안 된다.
   `parsePrice('초대') === 0` 처럼 후처리기가 sentinel 을 만들기 때문에,
   원값을 보지 않으면 "모델이 아무 말도 안 했는데 0을 지어냈다"고 오판한다.
2. **정답 `""` 는 `null` 과 같게 취급한다.** 단, **숫자 `0` 은 유효한 정답**(무료·초대권)이라 절대 null로 바꾸지 않는다.

---

## 5. 리포트 읽는 법 (`eval/out/report.md`)

| 절 | 무엇을 보나 |
|---|---|
| 0 | 한눈에 — 전체 정확도, 할루시네이션율, ECE, 지연 |
| 1 | 필드별 정확도. **exact 와 문자유사도를 같이 볼 것** — 둘의 격차가 크면 "거의 맞는데 표기만 다름" |
| 2 | 난이도별 / 공연장별 분해. 공연장별 편차가 크면 그 레이아웃의 few-shot 예시가 부족하다는 뜻 (4-3 C2) |
| 3 | 할루시네이션 + 지어낸 값 전체 목록 |
| 4 | **confidence 캘리브레이션.** 모델이 말한 confidence 가 실제 정답률과 맞는가 |
| 5 | 비결정성 (`--repeat` 사용 시) |
| 6 | 이미지별 상세 — 틀린 필드의 `기대값 → 실제값` |
| 7 | 지연 · 토큰 · 비용 |

### 캘리브레이션을 왜 보나

ARCHITECTURE 4-3 C2 는 "confidence < 0.8 필드만 노란 테두리"라는 UI 규칙을 제안한다.
**이 규칙은 confidence 가 실제로 정답률과 상관이 있을 때만 작동한다.**

- **ECE** 가 0에 가까우면 confidence 를 액면 그대로 믿어도 된다.
- **상관계수**가 0 근처면 confidence 는 정답 여부와 무관하다 → 노란 테두리는 무작위 하이라이트가 되고,
  HITL 검수자의 주의를 엉뚱한 곳에 쓰게 만든다. 이 경우 임계값 튜닝이 아니라 **프롬프트를 고쳐야** 한다.
- 격차가 양수 = **과신**(자신있다 해놓고 틀림). 이게 가장 위험하다.

### 비결정성을 왜 보나

`flip rate` 가 높으면 리포트의 정확도 수치 자체에 넓은 신뢰구간이 있다는 뜻이다.
정확도 2%p 차이로 프롬프트 A/B 를 판정하려는데 flip rate 가 10%면, 그 차이는 노이즈다.

```bash
node eval/run.mjs --repeat 3 --only lotte_met_opera_2024.jpg
```
비용이 배로 드니 이미지 2~3장에만 쓴다.

### 비용

`eval/pricing.json` 의 단가가 비어 있으면 리포트는 **"미산출"** 이라고 쓴다.
추측한 숫자를 채우면 리포트 전체의 신뢰도가 떨어지므로, 공식 가격표에서 확인한 값만 넣는다.

```json
{ "models": { "gemini-3-flash-preview": {
    "inputPerMTok": 0.00, "outputPerMTok": 0.00,
    "currency": "USD", "source": "…", "checkedAt": "2026-08-26" } } }
```

> **thinking 토큰 주의.** 이 모델은 `thoughtsTokenCount` 가 입력/출력 어느 쪽에도 안 잡히면서
> 출력 단가로 과금된다. 실측상 이미지당 출력 176토큰 대비 thinking 1,543토큰으로 **9배** 였다.
> 빠뜨리면 비용을 크게 과소추정한다. 리포트는 이를 합산한다.

---

## 6. 채점기 self-test

**채점기가 틀리면 모든 측정이 틀린다.** 그래서 채점기 자체에 테스트가 있다.

```bash
node eval/score.mjs --fixtures
```

`eval/fixtures/` 의 목 데이터로 채점 로직을 검증한다. API 키도 이미지도 필요 없다.

- `mockOcrSchema.ts` — 픽스처 전용 참조 구현. `parseSeat`/`normalizeDate`/`parsePrice` 의 기대 동작을 보여준다
- `ground_truth.json` — 정답/오답/할루시네이션/기권/표기변형/빈값 케이스를 모두 포함한 목 정답지
- `raw/*.json` — 목 모델 응답 (`{value, confidence}` 형태와 평문 형태 둘 다)
- `expected.json` — 필드별 기대 판정. **채점 로직을 고치면 여기가 먼저 깨져야 한다**

`--repeat` 없이도 비결정성 경로가 검증되도록 `fx_perfect.jpg` 는 `r1`/`r2` 두 회차가 들어 있다.

> 이 테스트가 실제로 빨간불이 되는지 확인된 항목: zero-pad 제거, Levenshtein 파괴,
> 저신뢰 임계값 변경, 빈 문자열 정답 처리 제거, 할루시네이션 판정을 후처리 결과로 되돌리기.

---

## 7. 산출물

```
eval/out/
├─ raw/<모델>/<이미지>.json    모델 원 응답 + usage + 지연 (캐시 겸용)
├─ raw/<모델>/_run-summary.json
├─ run-summary-<모델>.json     호출 통계, 지연 분포, 토큰 합계
├─ scores.json                필드별 채점 결과 전체
├─ report.md                  한국어 리포트
└─ fixture-*.{json,md}        self-test 결과
```

`eval/out/` 은 `.gitignore` 대상이다.

---

## 8. 평가 범위 (scope)

사용자 결정으로 대상 공연장은 **롯데콘서트홀 + 예술의전당** 두 곳이다.
세종문화회관(`sejong_` 접두사) 이미지는 **삭제하지 않고** 범위 외로 분류해 리포트 9장에 따로 집계한다.

범위 축소의 실질적 이유는 채점 가능성이다. 세종 대극장은 열 번호가 **알파벳**이다(`1층 B열 191번`).
정답지의 `seat.row` 가 문자열인데 `ParsedSeat.row` 는 `number | null` 이라 **어떤 모델을 써도 맞출 수 없다.**
롯데·예당은 전부 숫자 열이라 이 문제가 없다.

채점기는 문자열 `row` 를 만나도 크래시하지 않고 오답 처리한 뒤 `typeMismatch` 플래그를 세워
리포트 8장에 "구조적으로 일치 불가" 로 표시한다.

범위 접두사는 `eval/lib/scope.mjs` 의 `DEFAULT_OUT_OF_SCOPE_PREFIXES` 에 있다.

---

## 9. 알려진 제약

- **무료 티어 일일 쿼터.** `gemini-3-flash` 는 하루 20회다(`generate_content_free_tier_requests`).
  18장 + 재시도를 돌리면 하루 안에 소진된다. 러너는 429 를 지수 백오프로 재시도하고,
  실패한 이미지는 `eval/out/raw/<파일>.json` 에 `error` 로 남긴다.
  **실패한 이미지는 캐시로 재사용되지 않으므로**, 쿼터가 회복된 뒤 `node eval/run.mjs` 를 다시 돌리면
  성공한 것은 캐시에서 읽고 실패한 것만 재호출한다.
- 리포트의 이미지 수가 정답지 항목 수보다 적으면 0장 상단에 "원 응답이 없어 제외된 항목" 으로 표시된다.
  **미실행을 정확도 계산에서 조용히 빼지 않는다.**

---

## 10. 이 폴더의 소유 범위

`eval/` 만 쓴다. `app/`, `testdata/`, `docs/` 는 **읽기 전용**이다.
정답지(`testdata/eval/ground_truth.json`)도 읽기만 하며, 값이 이상해 보이면 리포트에 적을 뿐 고치지 않는다.
