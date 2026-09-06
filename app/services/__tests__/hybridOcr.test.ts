/**
 * hybridOcr 회귀 테스트 — 네트워크·API 키 불필요
 *
 *   cd app && npm test
 *
 * 여기서 지키는 것은 두 가지다.
 *
 * 1. **교정이 날짜를 깨지 않는가.** `fixSeatLine()` 은 Vision 의 재현성 있는 오독
 *    (`15열` → `15일`)을 되돌리는데, 무분별하게 적용하면 `2024년 6월 20일` 이 통째로
 *    망가진다. 좌석 문맥 한정이라는 제약이 이 테스트의 존재 이유다.
 *
 * 2. **배치 응답이 밀리는 것을 잡는가.** `validateBatch()` 가 조용히 통과시키면
 *    3번 티켓의 좌석이 5번 티켓에 붙고, 평가는 그것을 "정확도 하락" 으로만 본다.
 *    원인이 영영 안 보이게 되므로 반드시 예외여야 한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  looksLikeSeatLine,
  fixSeatLine,
  applySystematicFixes,
  renderPageForLLM,
  renderBatchInput,
  buildBatchPrompt,
  batchResponseSchema,
  batchJsonSchema,
  validateBatch,
  BatchShapeError,
  ruleBasedStructure,
} from '../hybridOcr.ts';
import type { VisionLine, VisionPage } from '../hybridOcr.ts';

/* ------------------------------------------------------------------ *
 * 헬퍼
 * ------------------------------------------------------------------ */

let _i = 0;
const line = (text: string, over: Partial<VisionLine> = {}): VisionLine => ({
  i: over.i ?? _i++,
  text,
  confidence: over.confidence ?? 0.9,
  box: over.box ?? [0.1, 0.5, 0.5, 0.03],
  h: over.h ?? 0.03,
});

const page = (texts: Array<string | VisionLine>, over: Partial<VisionPage> = {}): VisionPage => {
  _i = 0;
  return {
    ok: over.ok ?? true,
    width: over.width ?? 1200,
    height: over.height ?? 800,
    lines: texts.map((t) => (typeof t === 'string' ? line(t) : t)),
    ...(over.error ? { error: over.error } : {}),
  };
};

/* ------------------------------------------------------------------ *
 * looksLikeSeatLine — 교정을 적용할 줄을 고르는 게이트
 * ------------------------------------------------------------------ */

test('looksLikeSeatLine: 좌석 문맥을 인식한다', () => {
  assert.equal(looksLikeSeatLine('1층 A구역 15열 01번'), true);
  assert.equal(looksLikeSeatLine('2층 B블록 3열'), true);
  assert.equal(looksLikeSeatLine('객석 1층'), true);
});

test('looksLikeSeatLine: 날짜 문맥이면 무조건 제외한다 (교정 금지 구역)', () => {
  // 여기서 true 가 되면 fixSeatLine 이 '일' 을 '열' 로 바꿔 날짜를 깬다.
  assert.equal(looksLikeSeatLine('2024년 6월 20일'), false);
  assert.equal(looksLikeSeatLine('2024.06.20 오후 8시'), false);
  assert.equal(looksLikeSeatLine('2026-03-15'), false);
});

test('looksLikeSeatLine: 좌석 문맥이 없거나 숫자가 없으면 false', () => {
  assert.equal(looksLikeSeatLine('롯데콘서트홀'), false);
  assert.equal(looksLikeSeatLine('예매자 홍길동'), false);
  assert.equal(looksLikeSeatLine(''), false);
});

/* ------------------------------------------------------------------ *
 * fixSeatLine — Vision 체계적 오독 교정
 * ------------------------------------------------------------------ */

test('fixSeatLine R1a: "N일/월 + M번" 은 열의 오독이다', () => {
  assert.equal(fixSeatLine('1층 A구역 15일 01번').text, '1층 A구역 15열 01번');
  assert.equal(fixSeatLine('1층 A구역 15월 01번').text, '1층 A구역 15열 01번');
});

test('fixSeatLine R1b: 층/구역/블록 뒤의 "N일" 도 열이다', () => {
  assert.equal(fixSeatLine('B구역 15일').text, 'B구역 15열');
  assert.equal(fixSeatLine('2층 3월').text, '2층 3열');
});

test('fixSeatLine R2: 좌석 숫자 토큰의 O→0, l/I→1 을 되돌린다', () => {
  assert.equal(fixSeatLine('l층 A구역 3열 O1번').text, '1층 A구역 3열 01번');
  assert.equal(fixSeatLine('I층 B구역 2열').text, '1층 B구역 2열');
});

test('fixSeatLine R2: 이미 순수 숫자면 손대지 않는다', () => {
  const src = '1층 A구역 15열 01번';
  const { text, rules } = fixSeatLine(src);
  assert.equal(text, src);
  assert.deepEqual(rules, []);
});

test('fixSeatLine: 날짜는 절대 건드리지 않는다 (가장 중요한 회귀 방지)', () => {
  for (const s of ['2024년 6월 20일', '2024년 6월 20일 오후 8시', '공연일 2026.03.15']) {
    assert.equal(fixSeatLine(s).text, s, `날짜가 변형됐다: ${s}`);
  }
});

test('fixSeatLine: 적용된 규칙 이름을 돌려준다', () => {
  const { rules } = fixSeatLine('l층 A구역 15일 01번');
  assert.ok(rules.length >= 1);
  assert.ok(rules.some((r) => r.startsWith('R1a') || r.startsWith('R1b')));
  assert.ok(rules.some((r) => r.startsWith('R2')));
});

/* ------------------------------------------------------------------ *
 * applySystematicFixes — 페이지 단위, 원본 불변
 * ------------------------------------------------------------------ */

test('applySystematicFixes: 바뀐 줄만 fixes 에 기록한다', () => {
  const p = page(['롯데콘서트홀', '1층 A구역 15일 01번', '2024년 6월 20일']);
  const { page: fixed, fixes } = applySystematicFixes(p);

  assert.equal(fixes.length, 1, '좌석 줄 하나만 교정돼야 한다');
  assert.equal(fixes[0].before, '1층 A구역 15일 01번');
  assert.equal(fixes[0].after, '1층 A구역 15열 01번');
  assert.equal(fixed.lines[2].text, '2024년 6월 20일', '날짜 줄은 그대로여야 한다');
});

test('applySystematicFixes: 원본 page 를 변형하지 않는다', () => {
  const p = page(['1층 A구역 15일 01번']);
  const before = p.lines[0].text;
  const { page: fixed } = applySystematicFixes(p);

  assert.equal(p.lines[0].text, before, '원본이 변형됐다');
  assert.notEqual(fixed.lines[0].text, before);
  assert.notEqual(fixed.lines, p.lines);
});

test('applySystematicFixes: 교정할 게 없으면 fixes 는 빈 배열', () => {
  const { fixes } = applySystematicFixes(page(['롯데콘서트홀', '2024년 6월 20일']));
  assert.deepEqual(fixes, []);
});

/* ------------------------------------------------------------------ *
 * LLM 입력 렌더링 — 좌표가 빠지면 "상단 큰 글씨 = 공연명" 판단이 불가능해진다
 * ------------------------------------------------------------------ */

test('renderPageForLLM: 좌표·글자높이·confidence 를 함께 넘긴다', () => {
  const out = renderPageForLLM(page([line('테스트 공연', { i: 0, box: [0.12, 0.34, 0.5, 0.06], h: 0.06, confidence: 0.88 })]), 0);
  assert.match(out, /### 티켓 0/);
  assert.match(out, /1200x800px/);
  assert.match(out, /\[0\] x=0\.12 y=0\.34 h=0\.06 c=0\.88 \| 테스트 공연/);
});

test('renderPageForLLM: OCR 실패 페이지는 이유를 적어 넘긴다 (조용히 빈 페이지로 만들지 않는다)', () => {
  const out = renderPageForLLM(page([], { ok: false, error: '파일 없음' }), 2);
  assert.match(out, /### 티켓 2/);
  assert.match(out, /OCR 실패: 파일 없음/);
});

test('renderBatchInput: 페이지 순서대로 인덱스를 붙인다', () => {
  const out = renderBatchInput([page(['가']), page(['나'])]);
  assert.ok(out.indexOf('### 티켓 0') < out.indexOf('### 티켓 1'));
});

test('buildBatchPrompt: 앱의 OCR_PROMPT 를 그대로 품는다 (복사본 금지 규칙)', async () => {
  const { OCR_PROMPT } = await import('../ocrSchema.ts');
  const prompt = buildBatchPrompt(3);
  // 프롬프트를 복사해서 손보면 앱과 평가가 갈라진다. 부분 문자열로 포함을 강제한다.
  const probe = OCR_PROMPT.slice(0, 40);
  assert.ok(prompt.includes(probe), 'buildBatchPrompt 가 OCR_PROMPT 를 포함하지 않는다');
  assert.match(prompt, /3/);
});

/* ------------------------------------------------------------------ *
 * 스키마
 * ------------------------------------------------------------------ */

test('batchResponseSchema: Gemini 형식(대문자 타입) 배열이고 index 를 필수로 요구한다', () => {
  const s = batchResponseSchema() as any;
  assert.equal(s.type, 'ARRAY');
  assert.equal(s.items.type, 'OBJECT');
  assert.ok(s.items.properties.index, 'index 속성이 없다');
  assert.ok(s.items.required.includes('index'), 'index 가 required 가 아니면 순서 검증이 무너진다');
});

test('batchJsonSchema: OpenAI strict 형식(소문자 타입) 이고 tickets 로 감싼다', () => {
  const s = batchJsonSchema() as any;
  assert.equal(s.type, 'object');
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.required, ['tickets']);
  assert.equal(s.properties.tickets.type, 'array');
  assert.equal(s.properties.tickets.items.type, 'object');
  assert.equal(s.properties.tickets.items.additionalProperties, false);
});

test('batchJsonSchema: 앱 스키마의 필드를 그대로 물려받는다', () => {
  const gem = batchResponseSchema() as any;
  const json = batchJsonSchema() as any;
  assert.deepEqual(
    Object.keys(json.properties.tickets.items.properties).sort(),
    Object.keys(gem.items.properties).sort(),
  );
});

/* ------------------------------------------------------------------ *
 * validateBatch — 순서 뒤섞임/누락은 반드시 예외
 * ------------------------------------------------------------------ */

test('validateBatch: index 대로 재정렬한다', () => {
  const raw = { tickets: [{ index: 1, title: 'B' }, { index: 0, title: 'A' }] };
  const out = validateBatch(raw, 2);
  assert.equal(out[0].title, 'A');
  assert.equal(out[1].title, 'B');
});

test('validateBatch: 최상위 배열 / {tickets} / {items} 를 모두 받는다', () => {
  const els = [{ index: 0, title: 'A' }];
  for (const raw of [els, { tickets: els }, { items: els }]) {
    assert.equal(validateBatch(raw, 1)[0].title, 'A');
  }
});

test('validateBatch: 개수가 다르면 BatchShapeError (조용히 채우지 않는다)', () => {
  assert.throws(() => validateBatch({ tickets: [{ index: 0 }] }, 2), BatchShapeError);
  assert.throws(() => validateBatch({ tickets: [{ index: 0 }, { index: 1 }, { index: 2 }] }, 2), BatchShapeError);
});

test('validateBatch: index 중복은 BatchShapeError — 순서를 신뢰할 수 없다', () => {
  assert.throws(
    () => validateBatch({ tickets: [{ index: 0, t: 'a' }, { index: 0, t: 'b' }] }, 2),
    BatchShapeError,
  );
});

test('validateBatch: 배열이 아니면 BatchShapeError', () => {
  assert.throws(() => validateBatch(null, 1), BatchShapeError);
  assert.throws(() => validateBatch({ nope: 1 }, 1), BatchShapeError);
  assert.throws(() => validateBatch('문자열', 1), BatchShapeError);
});

test('validateBatch: 원소가 객체가 아니면 BatchShapeError', () => {
  assert.throws(() => validateBatch({ tickets: ['문자열'] }, 1), BatchShapeError);
});

test('validateBatch: index 가 없으면 위치 순서로 떨어뜨린다', () => {
  const out = validateBatch({ tickets: [{ title: 'A' }, { title: 'B' }] }, 2);
  assert.equal(out[0].title, 'A');
  assert.equal(out[1].title, 'B');
});

test('validateBatch: index 가 범위를 벗어나면 위치 순서로 폴백한다', () => {
  const out = validateBatch({ tickets: [{ index: 99, title: 'A' }] }, 1);
  assert.equal(out[0].title, 'A');
});

/* ------------------------------------------------------------------ *
 * ruleBasedStructure — 오프라인 폴백. "지어내지 않는 것" 이 요구사항이다
 * ------------------------------------------------------------------ */

test('ruleBasedStructure: 공연장·날짜·시각·좌석·등급·금액을 규칙으로 뽑는다', () => {
  const r = ruleBasedStructure(page([
    line('롯데콘서트홀', { h: 0.02 }),
    line('조성진 피아노 리사이틀', { h: 0.08, box: [0.1, 0.1, 0.6, 0.08] }),
    line('2024.06.20 오후 8시', { h: 0.02 }),
    line('1층 A구역 15열 01번', { h: 0.02 }),
    line('R석', { h: 0.02 }),
    line('120,000원', { h: 0.02 }),
  ]));

  assert.equal(r.venue.value, '롯데콘서트홀');
  assert.match(r.dateRaw.value, /2024/);
  assert.match(r.timeRaw.value, /8/);
  assert.match(r.seatRaw.value, /15열/);
  assert.equal(r.gradeRaw.value, 'R석');
  assert.match(r.priceRaw.value, /120,000/);
  assert.equal(r.title.value, '조성진 피아노 리사이틀');
});

/**
 * ⚠️ 알려진 한계 (현재 동작을 고정해 둔다 — 고칠 때 이 테스트가 먼저 빨개져야 한다)
 *
 * title 후보 필터가 `seatScore(s) > 0` 인 줄을 버린다. 그런데 `seatScore` 는 `N번` 에
 * 가점을 준다. 한국어 클래식 공연명은 `교향곡 2번`, `피아노 협주곡 4번` 처럼 **거의 항상
 * 작품 번호를 포함**하므로, 오프라인 규칙 폴백은 이런 공연명을 통째로 버린다.
 *
 * 좌석의 `번`(좌석 번호)과 작품의 `번`(작품 번호)이 같은 글자라서 생기는 충돌이다.
 * 제대로 고치려면 `번` 단독이 아니라 `열`+`번` 동시 출현 같은 조건이 필요하다.
 * LLM 경로에는 이 문제가 없고, 여기는 어디까지나 네트워크 없을 때의 폴백이다.
 */
test('ruleBasedStructure [알려진 한계]: 작품 번호가 든 공연명은 좌석으로 오인돼 버려진다', () => {
  for (const t of ['말러 교향곡 2번 부활', '브람스 교향곡 4번']) {
    const r = ruleBasedStructure(page([
      line('롯데콘서트홀', { h: 0.02 }),
      line(t, { h: 0.08, box: [0.1, 0.1, 0.6, 0.08] }),
    ]));
    assert.equal(r.title.value, '', `동작이 바뀌었다면 한계가 해소된 것이다: ${t}`);
  }
});

test('ruleBasedStructure: artist 와 program 은 절대 지어내지 않는다', () => {
  const r = ruleBasedStructure(page(['롯데콘서트홀', '말러 교향곡 2번', '1층 A구역 15열 01번']));
  assert.equal(r.artist.value, '', '규칙만으로 연주자를 판별할 수 없으므로 비어 있어야 한다');
  assert.equal(r.artist.confidence, 0);
  assert.deepEqual(r.program, []);
});

test('ruleBasedStructure: 게이트 안내를 좌석으로 오인하지 않는다', () => {
  const r = ruleBasedStructure(page([
    line('입장: 8층 2번 게이트'),
    line('1층 A구역 15열 01번'),
  ]));
  assert.match(r.seatRaw.value, /A구역/);
  assert.ok(!r.seatRaw.value.includes('게이트'));
});

test('ruleBasedStructure: 예매번호(긴 숫자)를 좌석/공연명으로 쓰지 않는다', () => {
  const r = ruleBasedStructure(page([
    line('T1234567890'),
    line('롯데콘서트홀'),
    line('빈 필하모닉 내한공연', { h: 0.09, box: [0.1, 0.1, 0.6, 0.09] }),
  ]));
  assert.ok(!r.seatRaw.value.includes('1234567890'));
  assert.equal(r.title.value, '빈 필하모닉 내한공연');
});

test('ruleBasedStructure: 초대권은 금액 자리에 원문을 남긴다', () => {
  const r = ruleBasedStructure(page(['예술의전당 콘서트홀', '초대권']));
  assert.match(r.priceRaw.value, /초대/);
});

test('ruleBasedStructure: 좌석 캡션("좌석:")은 값에서 떼어낸다', () => {
  const r = ruleBasedStructure(page(['좌석: 2층 B구역 3열 12번']));
  assert.ok(!r.seatRaw.value.startsWith('좌석'));
  assert.match(r.seatRaw.value, /2층 B구역/);
});

test('ruleBasedStructure: 실패했거나 빈 페이지면 전 필드가 비어 있다', () => {
  for (const p of [page([], { ok: false, error: 'x' }), page([])]) {
    const r = ruleBasedStructure(p);
    for (const f of ['title', 'artist', 'venue', 'dateRaw', 'timeRaw', 'seatRaw', 'gradeRaw', 'priceRaw'] as const) {
      assert.equal(r[f].value, '', `${f} 가 비어 있지 않다`);
      assert.equal(r[f].confidence, 0);
    }
    assert.deepEqual(r.program, []);
  }
});

test('ruleBasedStructure: 예술의전당 세부 공연장을 구분한다', () => {
  assert.equal(ruleBasedStructure(page(['예술의전당 콘서트홀'])).venue.value, '예술의전당 콘서트홀');
  assert.equal(ruleBasedStructure(page(['예술의전당 CJ 토월극장'])).venue.value, '예술의전당 CJ 토월극장');
  assert.equal(ruleBasedStructure(page(['세종문화회관 대극장'])).venue.value, '세종문화회관 대극장');
});

test('ruleBasedStructure: confidence 는 상한을 넘지 않는다 (규칙 기반임을 숨기지 않는다)', () => {
  const r = ruleBasedStructure(page([
    line('롯데콘서트홀', { confidence: 1 }),
    line('1층 A구역 15열 01번', { confidence: 1 }),
  ]));
  assert.ok(r.venue.confidence <= 0.95);
  assert.ok(r.seatRaw.confidence <= 0.9);
});
