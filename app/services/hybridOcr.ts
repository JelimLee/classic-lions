/**
 * hybridOcr.ts — macOS Vision + LLM 구조화 하이브리드 OCR
 *
 * 왜 이게 있는가:
 *   Gemini vision 단독 판독은 정확했지만(85.0%) 무료 티어가 **하루 20 요청**이다.
 *   티켓 20장을 넣으면 그날은 끝이다. 하이브리드는 1단계를 macOS Vision(무료·무제한·
 *   오프라인·~1.2초)으로 옮기고, LLM 에는 **이미지 대신 텍스트 줄**만 보낸다.
 *   텍스트는 가볍기 때문에 여러 장을 **한 요청**에 묶을 수 있고, 그래서 요청 수가
 *   장수에 비례하지 않는다 (20장 = 1요청).
 *
 * ⚠️ 이 파일은 브라우저 API에 의존하지 않는다 (document/canvas/window/fetch 금지).
 *    Node 평가 스크립트(tools/hybrid_ocr.mjs)가 그대로 import 한다.
 *    실제 HTTP 호출은 호출자(앱은 geminiService, 평가는 tools/hybrid_ocr.mjs)가 한다.
 *
 * ⚠️ 후처리는 하지 않는다. 이 파일의 출력은 `RawOCRResponse` 이고,
 *    parseSeat / normalizeDate / postProcessOCR 는 ocrSchema.ts 것을 그대로 쓴다.
 *    여기서 갈라지면 앱과 평가가 서로 다른 경로를 타게 된다.
 */

import { OCR_PROMPT, OCR_RESPONSE_SCHEMA } from './ocrSchema.ts';
import type { RawOCRResponse, OCRFieldValue } from './ocrSchema.ts';

/* ------------------------------------------------------------------ *
 * 1단계 산출물 타입 (tools/vision_ocr.py 출력과 1:1)
 * ------------------------------------------------------------------ */

/** [x, y, w, h] — 좌상단 원점, 0~1 정규화 */
export type BBox = [number, number, number, number];

export interface VisionLine {
  i: number;
  text: string;
  /** VNRecognizedText.confidence 0~1 */
  confidence: number;
  box: BBox | null;
  /** 글자 높이(=상대 폰트 크기 근사) */
  h: number | null;
}

export interface VisionPage {
  ok: boolean;
  width: number;
  height: number;
  lines: VisionLine[];
  error?: string;
}

export interface SystematicFix {
  i: number;
  before: string;
  after: string;
  rule: string;
}

/* ------------------------------------------------------------------ *
 * Vision 의 체계적 오류 교정
 *
 * macOS Vision 은 티켓 좌석 문자열에서 재현성 있게 같은 실수를 한다:
 *   "15열 01번" → "15일 01번" / "15월 01번"   (열 → 일/월)
 *   "1층"       → "l층" / "I층"               (1 → 소문자 L / 대문자 i)
 *   "01번"      → "O1번"                      (0 → 대문자 O)
 * 언어 보정(usesLanguageCorrection)이 한국어 문장 통계로 밀어버리는 탓이다.
 *
 * ⚠️ 무분별한 치환은 절대 금지다. "2024년 6월 20일" 의 '일/월' 을 '열' 로 바꾸면
 *    날짜가 통째로 깨진다. 그래서 **좌석 문맥으로 판정된 줄에만**, 그리고 그 줄
 *    안에서도 좌석 토큰 패턴에 맞을 때만 적용한다.
 * ------------------------------------------------------------------ */

/** 좌석 문자열로 보이는가 (층/구역/블록/열/번 조합 + 숫자) */
const SEAT_CONTEXT = /(좌석|객석|[0-9OolIi]\s*층|구역|블록|블럭|[0-9OolIi]\s*열|[0-9OolIi]\s*번)/;
/** 날짜 문맥 — 여기서는 '일/월' 을 절대 건드리지 않는다 */
const DATE_CONTEXT = /(\d{4}\s*[년.\-/]|\d{1,2}\s*월\s*\d{1,2}\s*일|년\s*\d{1,2}\s*월)/;

export function looksLikeSeatLine(text: string): boolean {
  if (!text) return false;
  if (DATE_CONTEXT.test(text)) return false;
  if (!SEAT_CONTEXT.test(text)) return false;
  return /[0-9OolIi]/.test(text);
}

/**
 * 한 줄에 체계적 오류 교정을 적용한다.
 * @returns 교정된 문자열과 적용된 규칙 이름들
 */
export function fixSeatLine(text: string): { text: string; rules: string[] } {
  const rules: string[] = [];
  if (!looksLikeSeatLine(text)) return { text, rules };
  let out = text;

  // R1) 열 → 일/월 오독. "15일 01번" / "15월 01번" / "B구역 15일"
  //     '번' 이 뒤따르거나 층/구역/블록이 앞서는 경우로 한정한다.
  const r1a = out.replace(/(\d{1,3})\s*[일월](?=\s*\d{1,3}\s*번)/g, '$1열');
  if (r1a !== out) { rules.push('R1a:열←일/월(앞:숫자 뒤:N번)'); out = r1a; }
  const r1b = out.replace(/((?:층|구역|블록|블럭)\s*)(\d{1,3})\s*[일월](?![\d가-힣])/g, '$1$2열');
  if (r1b !== out) { rules.push('R1b:열←일/월(앞:층/구역/블록)'); out = r1b; }

  // R2) O↔0, l/I↔1 혼동. 좌석 단위(층/열/번/구역) 바로 앞 숫자 토큰에만 적용한다.
  const r2 = out.replace(/([0-9OolIi]{1,3})(?=\s*(?:층|열|번))/g, (m) => {
    if (!/[OolIi]/.test(m)) return m;          // 이미 순수 숫자면 손대지 않는다
    return m.replace(/[Oo]/g, '0').replace(/[lIi]/g, '1');
  });
  if (r2 !== out) { rules.push('R2:O→0,l/I→1(좌석 숫자 토큰)'); out = r2; }

  return { text: out, rules };
}

/** 페이지 전체에 교정을 적용한다. 원본은 바꾸지 않고 새 객체를 낸다. */
export function applySystematicFixes(page: VisionPage): { page: VisionPage; fixes: SystematicFix[] } {
  const fixes: SystematicFix[] = [];
  const lines = page.lines.map((ln) => {
    const { text, rules } = fixSeatLine(ln.text);
    if (text !== ln.text) {
      fixes.push({ i: ln.i, before: ln.text, after: text, rule: rules.join('+') });
      return { ...ln, text };
    }
    return ln;
  });
  return { page: { ...page, lines }, fixes };
}

/* ------------------------------------------------------------------ *
 * LLM 입력 렌더링
 * ------------------------------------------------------------------ */

const f2 = (n: number | null | undefined) => (typeof n === 'number' ? n.toFixed(2) : '?');

/**
 * Vision 결과 한 장을 LLM 이 읽을 텍스트 블록으로 만든다.
 * 위치(x,y)와 글자 높이(h)를 같이 준다 — "상단의 큰 글씨 = 공연명",
 * "우하단 스텁 = 좌석" 같은 판단은 위치 없이는 불가능하다.
 */
export function renderPageForLLM(page: VisionPage, index: number): string {
  if (!page.ok) return `### 티켓 ${index}\n(OCR 실패: ${page.error ?? '알 수 없음'})`;
  const head = `### 티켓 ${index}  (이미지 ${page.width}x${page.height}px, 줄 ${page.lines.length}개)`;
  const body = page.lines.map((ln) => {
    const b = ln.box ?? [0, 0, 0, 0];
    return `[${ln.i}] x=${f2(b[0])} y=${f2(b[1])} h=${f2(ln.h ?? b[3])} c=${f2(ln.confidence)} | ${ln.text}`;
  }).join('\n');
  return `${head}\n${body}`;
}

/** 배치 전체 사용자 메시지 */
export function renderBatchInput(pages: VisionPage[]): string {
  return pages.map((p, i) => renderPageForLLM(p, i)).join('\n\n');
}

/**
 * 배치 구조화 프롬프트.
 *
 * 필드 정의는 **앱의 OCR_PROMPT 를 그대로 삽입**한다. 복사해서 손보면 앱과 평가가
 * 갈라지고, "하이브리드가 더 낫다/못하다"는 비교가 성립하지 않는다.
 * 앞뒤로 (a) 입력이 이미지가 아니라 OCR 줄이라는 점, (b) 배치·순서 규칙만 덧붙인다.
 */
export function buildBatchPrompt(n: number): string {
  return `당신은 한국 클래식 공연 티켓 판독 전문가입니다.

# 입력 형식 (중요 — 이미지가 아닙니다)
티켓 ${n}장을 macOS Vision OCR 로 읽은 **텍스트 줄 목록**이 주어집니다.
각 줄은 다음 형식입니다.

  [줄번호] x=<좌측 0~1> y=<상단 0~1> h=<글자높이 0~1> c=<OCR 신뢰도 0~1> | 텍스트

- x,y 는 이미지 좌상단이 (0,0), 우하단이 (1,1) 인 정규화 좌표입니다.
- h 가 클수록 큰 글씨입니다. **공연명은 대개 h 가 가장 큰 줄 중 하나**입니다.
- c 는 Vision 이 그 줄을 얼마나 또렷이 읽었는지입니다. c 가 낮은 줄은 글자가 깨졌을 수 있습니다.
- 줄은 읽는 순서(위→아래, 왼→오른쪽)로 정렬돼 있습니다.
- OCR 이라서 **글자가 틀릴 수 있습니다.** 같은 정보가 티켓 앞면과 스텁에 두 번
  인쇄돼 서로 다르게 읽힌 경우, c 가 높고 문맥이 자연스러운 쪽을 고르세요.
- 티켓에 인쇄되지 않은 정보는 줄 목록에도 없습니다. **줄 목록에 없는 값을 지어내지 마세요.**

# OCR 오독을 다루는 법 (이 파이프라인에만 있는 규칙)
Vision OCR 은 글자를 자주 깨뜨립니다. **닫힌 어휘**(공연장 이름, 좌석 구조 단어)는
표준 표기로 **교정해서** 내세요. 그 외에는 교정하지 마세요.

1. **공연장명은 표준 표기로 교정합니다.** 아래 목록 중 하나와 1~3글자만 다르면 그 이름으로 씁니다.
   롯데콘서트홀 / 예술의전당 콘서트홀 / 예술의전당 CJ 토월극장 / 예술의전당 자유소극장 /
   예술의전당 오페라극장 / 세종문화회관 대극장 / 세종문화회관 M씨어터
   예) "롯데크 너트홀" → "롯데콘서트홀" · "예술의전당 콘서트를" → "예술의전당 콘서트홀"
       "예술의전당 콘서트:" → "예술의전당 콘서트홀"
   ⚠️ 목록에 없는 전혀 다른 이름이면 교정하지 말고 읽은 대로 쓰세요.
2. **좌석 구조 단어도 표준 표기로 교정합니다**: 층 · 구역 · 블록 · 열 · 번 · 석 · 좌석 · 객석
   예) "C구이" → "C구역" · "A품을" → "A블록" · "좌식" → "좌석" · "⅞층" → "1층" · "리사이를" → "리사이틀"
3. ❌ **숫자는 절대 교정하지 마세요.** 연도·금액·열·번은 줄에 적힌 숫자 그대로 씁니다.
   그럴듯한 값으로 고치는 순간 그건 날조입니다.
4. ❌ **사람 이름·단체명은 교정하지 마세요.** 닫힌 어휘가 아닙니다.
5. 같은 정보가 **여러 줄로 중복**되어 나올 수 있습니다. 티켓 앞면과 스텁에 두 번
   인쇄됐거나, 같은 이미지를 여러 배율로 다시 읽었기 때문입니다.
   이때는 **c 가 높고 더 완전하며 더 그럴듯한 쪽**을 고르세요.
   예) "• 30.000명" 과 "• 30,000원" 이 같이 있으면 → "30,000원"
       "⅞층" 과 "1층" 이 같이 있으면 → "1층"
   ⚠️ 중복은 **같은 값의 다른 판독**입니다. 서로 다른 좌석/금액이 두 개 있다는 뜻이 아닙니다.

# seatRaw 조립 규칙 (중요 — 여기서 가장 많이 틀립니다)
좌석 값이 **여러 줄에 흩어져 있는 티켓이 많습니다.** 특히 예술의전당은 층/블록/열/번이
표의 별도 칸이라 Vision 이 각각 다른 줄로 읽습니다.

- 흩어져 있으면 **층 → 구역/블록 → 열 → 번** 순서로 **이어 붙여 한 문자열**로 만드세요.
  예) 줄에 "3층", "B블록", "6번" 이 따로 있으면 → "3층 B블록 6번"
      줄에 "D블록", "10열 1번" 이 따로 있으면 → "D블록 10열 1번"
- 없는 구성요소를 지어내 채우지 마세요. 읽힌 것만 순서대로 붙입니다.
- 줄 앞의 **캡션은 빼세요**: "좌석:", "좌식:", "SEAT:", "Floor", "Block", "Row", "Seat".
  단 **"객석" 은 값의 일부**입니다 ("객석 1층 B구역 15열 01번" 은 통째로 seatRaw).
- 좌석이 층/열/번 형태가 아닐 수도 있습니다. "롯데콘서트홀 표준좌석", "자유석", "전석 자유"
  같은 표기도 **그대로 seatRaw** 입니다. 공연장 이름이 들어 있다고 건너뛰지 마세요.
- ❌ 게이트 줄("입장게이트: 9F 8번 GATE", "8층 2번 게이트")은 절대 seatRaw 에 넣지 마세요.
- ❌ 예매번호/바코드 숫자를 좌석으로 착각하지 마세요.

# title / artist — 이 파이프라인에서 자주 나온 실수
- 공연명은 대개 **h 가 가장 큰 한국어 줄** 중 하나입니다. 여러 조각으로 잘려 읽혔으면
  같은 줄(y 가 비슷)끼리 이어 붙이고, 더 완전한 쪽을 고르세요.
- 한국어 공연명 바로 아래 **영문 표기**가 따로 인쇄된 경우가 많습니다.
  영문은 같은 공연명의 번역일 뿐입니다. **artist 에 넣지 마세요.**
  예) "황수미 & 앙상블 마테우스" / "Surmi Hwang & Ensemble Matheus"
      → title 은 한국어 쪽, artist 는 "" (연주자 칸이 따로 없으므로)

# priceRaw
- 같은 금액이 여러 번 읽혔으면 **천단위 구분이 제대로 된 쪽**을 고르세요.
  "100.000원" 은 "100,000원" 의 오독입니다 — 쉼표 쪽을 쓰세요.
- 쉼표 후보가 아예 없고 점 후보만 있으면, **점을 쉼표로 바꿔서** 옮기세요
  ("30.000원" → "30,000원"). 한국 티켓 금액에 소수점은 쓰지 않습니다.
- "30.000명" 처럼 단위까지 깨진 것도 금액일 수 있습니다. 숫자는 그대로 두고 원문을 옮기세요.

# dateRaw — 형식이 온전한 후보만 쓰세요
- **연·월·일이 모두 있고 실재하는 날짜**여야 합니다. 후보 중
  "YYYY.MM.DD" / "YYYY-MM-DD" / "YYYY년 M월 D일" 형태가 온전한 것을 고르세요.
- ❌ 자릿수가 깨진 후보는 버리세요. "202011. 12" 는 "2020-11-12" 의 오독입니다 —
  온전한 후보가 따로 있으면 그것을 쓰고, 없으면 자릿수를 복원해 "2020-11-12" 로 옮기세요.
- ❌ **공연명·부제에 들어 있는 연도를 날짜로 쓰지 마세요.**
  "2025 SNUAMP CONCERT", "2024 신년음악회" 는 공연명이지 날짜가 아닙니다.
  월·일이 없으면 날짜 후보가 아닙니다.
- 예매일/발권일이 아니라 **관람일**입니다.

# 구역/블록 라벨은 알파벳 한 글자입니다
"A구역" "B블록" "R구역" 처럼 구역·블록 이름은 **영문 대문자 한 글자**입니다.
숫자로 읽혔다면 오독입니다: "8블록" → "B블록", "0구역" → "D구역" 또는 "O구역",
"1블록" → "I블록". 다른 줄에 알파벳으로 읽힌 후보가 있으면 **그쪽을 쓰세요.**
알파벳 후보가 전혀 없으면 그 자리를 비우고 나머지만 이어 붙이세요 — 숫자를 그대로 두지 마세요.

# confidence 산정
value 를 어느 줄에서 가져왔다면, 그 줄의 c 를 넘지 않는 값을 주세요.
여러 줄을 이어 붙였으면 가장 낮은 c 를 쓰세요.
줄 목록 어디에도 근거가 없으면 value "" / confidence 0 입니다.

---
아래는 앱이 쓰는 필드 정의입니다. 위 규칙과 충돌하면 **위 규칙이 우선**합니다
(아래 정의는 이미지를 직접 보는 경우를 전제로 쓰였습니다).

${OCR_PROMPT}
---

# 출력 형식 (배치)
**${n}개 원소의 JSON 배열**만 출력하세요. 원소 순서는 입력 티켓 순서와 같아야 하고,
각 원소에는 입력의 티켓 번호를 \`index\` 로 반드시 넣으세요 (0부터 ${n - 1}).

- 원소를 빠뜨리거나 합치거나 순서를 바꾸지 마세요. 정확히 ${n}개입니다.
- 어떤 티켓이 통째로 판독 불가여도 그 자리의 원소를 만들고 전 필드를 "" / 0 으로 채우세요.
- 설명·마크다운 코드펜스 금지. JSON 배열만.`;
}

/* ------------------------------------------------------------------ *
 * 응답 스키마 — 앱의 OCR_RESPONSE_SCHEMA 에 index 만 더한 배열
 * ------------------------------------------------------------------ */

type SchemaObj = { type: string; properties?: Record<string, unknown>; required?: string[]; items?: unknown; description?: string };

/** Gemini responseSchema (대문자 타입) 형태의 배치 스키마 */
export function batchResponseSchema(): object {
  const base = OCR_RESPONSE_SCHEMA as SchemaObj;
  const item: SchemaObj = {
    type: 'OBJECT',
    properties: {
      index: { type: 'INTEGER', description: '입력 티켓 번호 (0부터). 절대 빠뜨리지 말 것' },
      ...(base.properties ?? {}),
    },
    required: ['index', ...(base.required ?? [])],
  };
  return { type: 'ARRAY', items: item };
}

/** OpenAI structured outputs 용 JSON Schema (소문자 타입 + strict) */
export function batchJsonSchema(): object {
  const conv = (node: any): any => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(conv);
    const out: any = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'type' && typeof v === 'string') { out.type = v.toLowerCase(); continue; }
      out[k] = conv(v);
    }
    if (out.type === 'object') {
      out.additionalProperties = false;
      // strict 모드는 모든 프로퍼티가 required 여야 한다.
      out.required = Object.keys(out.properties ?? {});
    }
    return out;
  };
  const item = conv(batchResponseSchema());
  // 최상위는 object 여야 하므로 배열을 감싼다.
  return {
    type: 'object',
    additionalProperties: false,
    required: ['tickets'],
    properties: { tickets: item },
  };
}

/* ------------------------------------------------------------------ *
 * 응답 검증 — 순서 뒤섞임 / 누락을 반드시 잡는다
 * ------------------------------------------------------------------ */

export class BatchShapeError extends Error {}

/**
 * LLM 배치 응답을 입력 순서대로 정렬한 길이 n 배열로 만든다.
 *
 * ⚠️ **개수가 다르면 에러다.** 조용히 채우면 3번 티켓의 좌석이 5번 티켓에 붙는
 *    사고가 나고, 평가는 그걸 "정확도 하락" 으로만 보게 된다. 호출자는 이 에러를
 *    받으면 배치를 쪼개 재시도해야 한다.
 */
export function validateBatch(raw: unknown, n: number): Array<Record<string, unknown>> {
  const arr = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as any).tickets)) ? (raw as any).tickets
    : (raw && typeof raw === 'object' && Array.isArray((raw as any).items)) ? (raw as any).items
    : null;
  if (!arr) throw new BatchShapeError(`응답이 배열이 아닙니다 (받은 타입: ${raw === null ? 'null' : typeof raw})`);
  if (arr.length !== n) throw new BatchShapeError(`응답 원소 수 불일치: 입력 ${n}장 vs 응답 ${arr.length}개`);

  const out = new Array<Record<string, unknown> | null>(n).fill(null);
  let missingIndex = 0;
  for (let k = 0; k < arr.length; k++) {
    const el = arr[k];
    if (!el || typeof el !== 'object') throw new BatchShapeError(`응답 [${k}] 이 객체가 아닙니다`);
    const idxRaw = (el as any).index;
    let idx = typeof idxRaw === 'number' ? idxRaw : Number.parseInt(String(idxRaw ?? ''), 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) {
      // index 를 안 줬거나 범위를 벗어나면 위치 순서로 떨어뜨린다(그리고 센다).
      missingIndex++;
      idx = k;
    }
    if (out[idx] !== null) throw new BatchShapeError(`index ${idx} 가 중복됐습니다 — 순서를 신뢰할 수 없습니다`);
    out[idx] = el as Record<string, unknown>;
  }
  const holes = out.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  if (holes.length) throw new BatchShapeError(`index 누락: ${holes.join(', ')}`);
  if (missingIndex === n && n > 1) {
    // 전부 index 가 없었다면 순서만 믿는 셈이라 경고 대상. 값은 그대로 쓰되 흔적을 남긴다.
    (out as any).__indexMissing = true;
  }
  return out as Array<Record<string, unknown>>;
}

/* ------------------------------------------------------------------ *
 * 오프라인 폴백 — LLM 없이 Vision + 규칙만으로 구조화
 *
 * 네트워크가 없거나 크레딧이 떨어져도 앱이 죽으면 안 된다.
 * 날짜·시각·좌석·금액·공연장은 정규식으로 상당히 잡힌다. 공연명은 위치·크기로 추정한다.
 * ------------------------------------------------------------------ */

const fv = (value: string, confidence: number): OCRFieldValue => ({ value, confidence });
const EMPTY = () => fv('', 0);

const VENUE_PATTERNS: Array<[RegExp, string]> = [
  [/롯데\s*콘서트\s*홀/, '롯데콘서트홀'],
  [/예술의\s*전당.{0,4}콘서트\s*홀/, '예술의전당 콘서트홀'],
  [/예술의\s*전당.{0,6}토월/, '예술의전당 CJ 토월극장'],
  [/예술의\s*전당.{0,4}자유\s*소극장/, '예술의전당 자유소극장'],
  [/예술의\s*전당/, '예술의전당'],
  [/세종문화회관.{0,4}대극장/, '세종문화회관 대극장'],
  [/세종문화회관/, '세종문화회관'],
];

const GATE_RE = /(게이트|gate|입장구|출입구)/i;
const GRADE_RE = /((?:VIP|vip|R|S|A|B|C|D|E)\s*석|회원석|일반석|학생석|보호자석|[1-3]\s*층석|BOX\s*석)/;
const PRICE_RE = /([0-9][0-9,]{2,})\s*원/;
const PRICE_BARE_RE = /\b([0-9]{1,3}(?:,[0-9]{3})+)\b/;
const FREE_RE = /(초대권?|무료)/;
const DATE_RES: RegExp[] = [
  /\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}\s*(?:\([^)]{1,3}\))?/,
  /\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/,
];
const TIME_RES: RegExp[] = [
  /(?:오전|오후)\s*\d{1,2}\s*[:시]\s*\d{0,2}\s*분?/,
  /\b\d{1,2}\s*:\s*\d{2}\b/,
];
/** 예매번호/바코드처럼 좌석이 아닌 긴 숫자 */
const BOOKING_RE = /^[A-Z]?\d{8,}$/;

function firstMatch(lines: VisionLine[], res: RegExp[], reject?: RegExp): { text: string; conf: number } | null {
  for (const re of res) {
    for (const ln of lines) {
      if (reject && reject.test(ln.text)) continue;
      const m = ln.text.match(re);
      if (m) return { text: m[0].replace(/\s+/g, ' ').trim(), conf: ln.confidence };
    }
  }
  return null;
}

/** 좌석 줄 후보 점수 — 층/구역/열/번이 많이 붙어 있을수록 좋다 */
function seatScore(text: string): number {
  if (GATE_RE.test(text)) return -1;
  if (BOOKING_RE.test(text.trim())) return -1;
  let s = 0;
  if (/\d\s*층/.test(text)) s += 2;
  if (/(구역|블록|블럭)/.test(text)) s += 2;
  if (/\d\s*열/.test(text)) s += 3;
  if (/\d\s*번/.test(text)) s += 2;
  if (/(좌석|객석)/.test(text)) s += 2;
  return s;
}

/**
 * LLM 없이 Vision 결과만으로 RawOCRResponse 를 만든다.
 * 정확도는 LLM 구조화보다 낮다 — 어디까지나 폴백이다.
 */
export function ruleBasedStructure(page: VisionPage): RawOCRResponse {
  const empty: RawOCRResponse = {
    title: EMPTY(), artist: EMPTY(), venue: EMPTY(), dateRaw: EMPTY(),
    timeRaw: EMPTY(), seatRaw: EMPTY(), gradeRaw: EMPTY(), priceRaw: EMPTY(), program: [],
  };
  if (!page.ok || !page.lines.length) return empty;
  const lines = page.lines;

  // venue — 알려진 공연장 표기와 대조 (Vision 오독을 흡수하려고 느슨한 패턴)
  let venue = EMPTY();
  outer: for (const ln of lines) {
    for (const [re, canon] of VENUE_PATTERNS) {
      if (re.test(ln.text)) { venue = fv(canon, Math.min(0.95, ln.confidence)); break outer; }
    }
  }

  // date / time
  const d = firstMatch(lines, DATE_RES);
  const t = firstMatch(lines, TIME_RES);

  // seat — 점수가 가장 높은 줄. 게이트/예매번호는 배제.
  let best: { text: string; conf: number; score: number } | null = null;
  for (const ln of lines) {
    const sc = seatScore(ln.text);
    if (sc <= 0) continue;
    if (!best || sc > best.score) {
      // "좌석:" 같은 캡션은 떼어낸다
      const cleaned = ln.text.replace(/^\s*(좌석|객석|SEAT)\s*[:：]\s*/i, '').trim();
      best = { text: cleaned, conf: ln.confidence, score: sc };
    }
  }
  const seatRaw = best ? fv(best.text, Math.min(0.9, best.conf)) : EMPTY();

  // grade — 좌석 줄이 아닌 곳에도 흩어져 있다. 짧은 줄 우선.
  let grade = EMPTY();
  const gradeCands = lines
    .map((ln) => ({ ln, m: ln.text.match(GRADE_RE) }))
    .filter((x) => x.m)
    .sort((a, b) => a.ln.text.length - b.ln.text.length);
  if (gradeCands.length) grade = fv(gradeCands[0].m![0].replace(/\s+/g, ''), Math.min(0.85, gradeCands[0].ln.confidence));

  // price
  let price = EMPTY();
  for (const ln of lines) {
    const m = ln.text.match(PRICE_RE) || ln.text.match(PRICE_BARE_RE);
    if (m) { price = fv(m[0].trim(), Math.min(0.9, ln.confidence)); break; }
  }
  if (!price.value) {
    const free = lines.find((ln) => FREE_RE.test(ln.text) && ln.text.length <= 12);
    if (free) price = fv(free.text.match(FREE_RE)![0], Math.min(0.7, free.confidence));
  }

  // title — 이미 다른 필드로 쓰인 줄, 공연장명, 캡션·안내문을 뺀 뒤
  //         "글자가 크고 위쪽" 인 줄을 고른다.
  const used = new Set<string>([seatRaw.value, grade.value, price.value, d?.text ?? '', t?.text ?? '']);
  const titleCands = lines.filter((ln) => {
    const s = ln.text.trim();
    if (s.length < 3 || s.length > 60) return false;
    if (used.has(s)) return false;
    if (VENUE_PATTERNS.some(([re]) => re.test(s))) return false;
    if (GATE_RE.test(s) || BOOKING_RE.test(s)) return false;
    if (/^[\d\s.,:\-/()]+$/.test(s)) return false;                 // 숫자만
    if (/(예매|취소|환불|주최|주관|후원|문의|안내|입장|관람|티켓링크|인터파크|예스24|SAMPLE)/.test(s)) return false;
    if (seatScore(s) > 0) return false;
    if (DATE_RES.some((re) => re.test(s)) || TIME_RES.some((re) => re.test(s))) return false;
    if (GRADE_RE.test(s) && s.length <= 6) return false;
    return true;
  });
  let title = EMPTY();
  if (titleCands.length) {
    // 큰 글씨 우선, 동률이면 위쪽 우선. 한글이 섞인 줄에 가산점(영문 부제보다 국문 공연명).
    const scored = titleCands.map((ln) => {
      const h = ln.h ?? (ln.box ? ln.box[3] : 0) ?? 0;
      const y = ln.box ? ln.box[1] : 0.5;
      const hangul = /[가-힣]/.test(ln.text) ? 1.15 : 1;
      return { ln, s: h * hangul - y * 0.01 };
    }).sort((a, b) => b.s - a.s);
    title = fv(scored[0].ln.text.trim(), Math.min(0.6, scored[0].ln.confidence));
  }

  return {
    title,
    artist: EMPTY(),              // 규칙만으로 연주자 칸을 판별할 수 없다 — 지어내지 않는다
    venue,
    dateRaw: d ? fv(d.text, Math.min(0.95, d.conf)) : EMPTY(),
    timeRaw: t ? fv(t.text, Math.min(0.9, t.conf)) : EMPTY(),
    seatRaw,
    gradeRaw: grade,
    priceRaw: price,
    program: [],                  // 곡목은 규칙으로 안전하게 뽑을 수 없다
  };
}

/* ------------------------------------------------------------------ *
 * 앱 통합용 인터페이스 (이번 범위 밖 — 형태만 확정)
 * ------------------------------------------------------------------ */

/** 2단계 구조화를 수행하는 주체. 앱은 geminiService, 평가는 tools/hybrid_ocr.mjs 가 구현한다. */
export interface BatchStructurer {
  /**
   * @param prompt buildBatchPrompt(n)
   * @param input  renderBatchInput(pages)
   * @param n      티켓 수 (응답 검증용)
   * @returns 길이 n 의 RawOCRResponse 배열
   */
  structure(prompt: string, input: string, n: number): Promise<Array<Record<string, unknown>>>;
}

export interface HybridOptions {
  /** LLM 없이 규칙만 쓴다 (오프라인/쿼터 소진) */
  noLlm?: boolean;
  /** 체계적 오류 교정 비활성화 (A/B 측정용) */
  noFix?: boolean;
}

/**
 * Vision 결과 배열 → RawOCRResponse 배열.
 * 이미지→Vision 은 호출자가 한다(앱은 네이티브 브리지, 평가는 python).
 * 반환값은 그대로 `postProcessOCR()` 에 넣으면 된다.
 */
export async function structureVisionPages(
  pages: VisionPage[],
  structurer: BatchStructurer | null,
  opts: HybridOptions = {},
): Promise<{ results: Array<Record<string, unknown>>; fixes: SystematicFix[][]; usedLlm: boolean }> {
  const fixed = pages.map((p) => (opts.noFix ? { page: p, fixes: [] as SystematicFix[] } : applySystematicFixes(p)));
  const prepared = fixed.map((f) => f.page);
  const fixes = fixed.map((f) => f.fixes);

  if (opts.noLlm || !structurer) {
    return { results: prepared.map((p) => ruleBasedStructure(p) as unknown as Record<string, unknown>), fixes, usedLlm: false };
  }
  const n = prepared.length;
  const results = await structurer.structure(buildBatchPrompt(n), renderBatchInput(prepared), n);
  return { results, fixes, usedLlm: true };
}
