/**
 * ocrSchema 회귀 테스트
 *
 *   cd app && npm test
 *   (Node 22+ 내장 test runner + 타입 스트리핑. 별도 의존성 없음)
 *
 * 여기 있는 케이스는 전부 **실물 티켓 판독으로 확인된 형태**다
 * (docs/RESEARCH_seat_avatar.md §1.1). 회귀하면 조용히 틀리기 때문에 고정해 둔다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSeat, normalizeDate, normalizeTime, parsePrice,
  extractComposers, postProcessOCR, stripNonSeatTokens,
  mergeOCRRuns, needsSecondPass,
  OCR_MODEL, OCR_PROMPT, OCR_RESPONSE_SCHEMA, OCR_GENERATION_CONFIG,
} from '../ocrSchema.ts';

/* ------------------------------------------------------------------ *
 * 🔴 게이트 문자열 충돌 — 최우선 방어 대상
 *
 * 롯데콘서트홀 실물 티켓에는 게이트 정보가 좌석과 나란히 인쇄된다.
 * 이걸 같이 먹으면 floor=8, number=2 로 좌석 기능 전체가 무의미해진다.
 * ------------------------------------------------------------------ */

test('게이트: "입장: 8층 2번 게이트"가 붙어도 객석 좌석만 읽는다', () => {
  const seat = parseSeat('입장: 8층 2번 게이트 좌석: 객석 1층 B구역 15열 01번');
  assert.equal(seat.floor, 1, 'floor는 게이트의 8이 아니라 객석의 1');
  assert.equal(seat.block, 'B');
  assert.equal(seat.row, 15);
  assert.equal(seat.number, 1, 'number는 게이트 번호 2가 아니라 좌석 01번');
  assert.ok(seat.confidence > 0.9);
});

test('게이트: "9F 8번 GATE" 영문 표기도 좌석을 오염시키지 않는다', () => {
  const seat = parseSeat('입장게이트: 9F 8번 GATE 객석1층 R구역 01열 12번');
  assert.equal(seat.floor, 1);
  assert.equal(seat.block, 'R', 'R은 구역이지 등급이 아니다');
  assert.equal(seat.row, 1);
  assert.equal(seat.number, 12);
});

test('게이트: 게이트 정보만 있으면 좌석으로 인정하지 않는다', () => {
  const seat = parseSeat('입장: 8층 2번 게이트');
  assert.equal(seat.floor, null);
  assert.equal(seat.number, null);
  assert.equal(seat.confidence, 0);
  assert.equal(seat.raw, '입장: 8층 2번 게이트', 'raw는 언제나 보존');
});

test('게이트: 층 범위(1~5) 밖의 값은 그 자체로 거부된다', () => {
  assert.equal(parseSeat('8층 2번').floor, null);
  assert.equal(parseSeat('9F').floor, null);
  assert.equal(parseSeat('3층 E블록 6열').floor, 3);
});

test('stripNonSeatTokens: 게이트/영문 캡션만 제거하고 좌석은 남긴다', () => {
  assert.equal(
    stripNonSeatTokens('입장: 8층 2번 게이트 좌석: 객석 1층 B구역 15열 01번'),
    '객석 1층 B구역 15열 01번',
  );
  assert.equal(
    stripNonSeatTokens('1층 Floor A블록 Block 15열 Row 10번 Seat'),
    '1층 A블록 15열 10번',
  );
});

/* ------------------------------------------------------------------ *
 * 🔴 등급 인식 — 한글/BOX 등급
 * ------------------------------------------------------------------ */

test('등급: 한글 등급 "회원석"을 인식한다 (예술의전당 실물)', () => {
  const seat = parseSeat('회원석');
  assert.equal(seat.grade, '회원석');
  assert.equal(seat.confidence, 0.5, '등급만 있으면 좌석은 못 그리지만 실패는 아니다');
});

test('등급: BOX석 / VVIP석 등 2글자 초과 등급', () => {
  assert.equal(parseSeat('BOX석 2층').grade, 'BOX석');
  assert.equal(parseSeat('VVIP석 1층 A구역 1열 1번').grade, 'VVIP석');
  assert.equal(parseSeat('시야제한석 3층').grade, '시야제한석');
});

test('등급: 등급 + 금액만 있는 티켓', () => {
  assert.deepEqual(
    { grade: parseSeat('R석 470,000원').grade, conf: parseSeat('R석 470,000원').confidence },
    { grade: 'R석', conf: 0.5 },
  );
  assert.equal(parseSeat('S석 21,000원').grade, 'S석');
  assert.equal(parseSeat('R석 초대').grade, 'R석');
});

test('등급: "객석"을 등급으로 오인하지 않는다', () => {
  const seat = parseSeat('객석 1층 B구역 15열 01번');
  assert.equal(seat.grade, null);
});

test('등급/구역 충돌: "R구역"은 등급 R석이 아니다', () => {
  const seat = parseSeat('객석1층 R구역 01열 12번');
  assert.equal(seat.block, 'R');
  assert.equal(seat.grade, null);
});

/* ------------------------------------------------------------------ *
 * 좌석 표기 변형
 * ------------------------------------------------------------------ */

test('좌석: 구역/블록 혼용, 공백 유무, zero-pad', () => {
  const cases: [string, any][] = [
    ['객석 1층 B구역 15열 01번', { floor: 1, block: 'B', row: 15, number: 1 }],
    ['객석1층 R구역 01열 12번',   { floor: 1, block: 'R', row: 1,  number: 12 }],
    ['객석1층 C구역 08열 01번',   { floor: 1, block: 'C', row: 8,  number: 1 }],
    ['1층 A블록 15열 10번',       { floor: 1, block: 'A', row: 15, number: 10 }],
    ['3층 B블록 4열 6번',         { floor: 3, block: 'B', row: 4,  number: 6 }],
    ['1층 B구역15열1번',          { floor: 1, block: 'B', row: 15, number: 1 }],
    ['2층 가구역 3열 7번',        { floor: 2, block: '가', row: 3, number: 7 }],
  ];
  for (const [raw, want] of cases) {
    const got = parseSeat(raw);
    assert.deepEqual(
      { floor: got.floor, block: got.block, row: got.row, number: got.number },
      want,
      raw,
    );
  }
});

test('좌석: 번(Seat)이 없는 티켓도 부분 성공으로 취급', () => {
  const seat = parseSeat('3층 E블록 6열');
  assert.deepEqual(
    { floor: seat.floor, block: seat.block, row: seat.row, number: seat.number },
    { floor: 3, block: 'E', row: 6, number: null },
  );
  assert.ok(seat.confidence > 0.8, '부분 성공을 실패로 취급하지 않는다');
});

test('좌석: 예술의전당 표 레이아웃(영문 캡션 혼입)', () => {
  const seat = parseSeat('1층 Floor A블록 Block 15열 Row 10번 Seat');
  assert.deepEqual(
    { floor: seat.floor, block: seat.block, row: seat.row, number: seat.number },
    { floor: 1, block: 'A', row: 15, number: 10 },
  );
});

test('좌석: 파싱 실패해도 raw는 보존하고 confidence만 0', () => {
  for (const raw of ['', 'T1234567890', '롯데콘서트홀 표준좌석']) {
    const seat = parseSeat(raw);
    assert.equal(seat.confidence, 0, raw);
    assert.equal(seat.raw, raw, raw);
  }
});

test('좌석: 예매번호를 좌석 번호로 읽지 않는다', () => {
  assert.equal(parseSeat('예매번호 12345678').number, null);
});

/* ------------------------------------------------------------------ *
 * 날짜 정규화 — zero-pad 버그 회귀 방지
 * ------------------------------------------------------------------ */

test('날짜: zero-padded YYYY-MM-DD로 정규화된다', () => {
  const cases: [string, string][] = [
    ['2025년 3월 15일', '2025-03-15'],   // 예전: '2025-3-15' (zero-pad 없음)
    ['2025.03.15',      '2025-03-15'],   // 예전: 미처리
    ['15 Mar 2025',     '2025-03-15'],   // 예전: '15Mar2025' 로 파괴
    ['2024.06.20(목)',  '2024-06-20'],
    ['2026-01-09',      '2026-01-09'],
    ['20250315',        '2025-03-15'],
    ['March 15, 2025',  '2025-03-15'],
    ['2025년3월5일(수) 오후 7시 30분', '2025-03-05'],
  ];
  for (const [raw, want] of cases) {
    const got = normalizeDate(raw);
    assert.equal(got.value, want, raw);
    assert.ok(got.confidence > 0, raw);
  }
});

test('날짜: 해석 못 하면 null + confidence 0 (조용히 깨진 문자열 금지)', () => {
  for (const raw of ['', '3월 15일', '2025-02-30', '날짜미정', '곧 공지']) {
    const got = normalizeDate(raw);
    assert.equal(got.value, null, raw);
    assert.equal(got.confidence, 0, raw);
  }
});

test('날짜: 연도가 뒤인 모호한 형식은 신뢰도를 낮춘다', () => {
  const ambiguous = normalizeDate('03/15/2025');
  const explicit = normalizeDate('2025.03.15');
  assert.equal(ambiguous.value, '2025-03-15');
  assert.ok(ambiguous.confidence < explicit.confidence);
});

/* ------------------------------------------------------------------ *
 * 시간 / 금액 / 작곡가
 * ------------------------------------------------------------------ */

test('시간: 오전/오후 표기를 24시간제로', () => {
  assert.equal(normalizeTime('19:30').value, '19:30');
  assert.equal(normalizeTime('오후 5시').value, '17:00');
  assert.equal(normalizeTime('오후 8시 30분').value, '20:30');
  assert.equal(normalizeTime('오전 11시').value, '11:00');
  assert.equal(normalizeTime('').value, null);
});

test('금액: 콤마/원 표기와 초대권', () => {
  assert.equal(parsePrice('470,000원'), 470000);
  assert.equal(parsePrice('60,000'), 60000);
  assert.equal(parsePrice('초대'), 0);
  assert.equal(parsePrice(''), null);
});

test('작곡가: program에서 추출한다 (하드코딩 금지)', () => {
  assert.deepEqual(
    extractComposers(['Rachmaninoff - Piano Concerto No.3 Op.30', 'Sibelius - Symphony No.2']),
    ['Rachmaninoff', 'Sibelius'],
  );
  assert.deepEqual(extractComposers(['쇼팽 - 발라드 1번']), ['Chopin']);
  assert.deepEqual(extractComposers([]), []);
});

/* ------------------------------------------------------------------ *
 * 계약 / 통합
 * ------------------------------------------------------------------ */

test('계약: 평가 파이프라인이 쓰는 export가 살아 있다', () => {
  assert.equal(typeof OCR_MODEL, 'string');
  assert.ok(OCR_MODEL.length > 0);
  assert.ok(!OCR_MODEL.includes('latest'), 'alias는 재현성을 깬다');
  assert.notEqual(OCR_MODEL, 'gemini-3-pro-preview', '존재하지 않는 모델');
  assert.ok(OCR_PROMPT.includes('seatRaw'));
  assert.ok(OCR_PROMPT.includes('게이트'), '게이트 negative 지침이 프롬프트에 있어야 한다');
  assert.equal(typeof OCR_RESPONSE_SCHEMA, 'object');
  // 지연 개선(thinking MINIMAL)이 평가에도 반영되려면 하네스가 이 설정을 써야 한다.
  assert.equal((OCR_GENERATION_CONFIG as any).temperature, 0);
  assert.equal((OCR_GENERATION_CONFIG as any).thinkingConfig.thinkingLevel, 'MINIMAL');
  assert.ok((OCR_RESPONSE_SCHEMA as any).properties.seatRaw, 'seatRaw 필드가 스키마에 있어야 한다');
  assert.ok((OCR_RESPONSE_SCHEMA as any).properties.gradeRaw, 'gradeRaw 필드가 스키마에 있어야 한다');
  assert.deepEqual(
    (OCR_RESPONSE_SCHEMA as any).required,
    ['title', 'artist', 'venue', 'dateRaw', 'timeRaw', 'seatRaw', 'gradeRaw', 'priceRaw', 'program'],
  );
});

test('통합: postProcessOCR이 날짜/좌석/금액/작곡가를 모두 정규화한다', () => {
  const result = postProcessOCR(JSON.stringify({
    title:    { value: 'KBS교향악단 제800회 정기연주회', confidence: 0.97 },
    artist:   { value: '피에타리 잉키넨 / 임윤찬', confidence: 0.92 },
    venue:    { value: '롯데콘서트홀', confidence: 0.98 },
    dateRaw:  { value: '2024.06.20(목)', confidence: 0.96 },
    timeRaw:  { value: '19:30', confidence: 0.95 },
    seatRaw:  { value: '객석 1층 B구역 15열 01번', confidence: 0.9 },
    priceRaw: { value: '70,000원', confidence: 0.88 },
    program:  [{ value: 'Rachmaninoff - Piano Concerto No.3 Op.30', confidence: 0.9 }],
  }));

  assert.equal(result.date, '2024-06-20');
  assert.equal(result.dateRaw, '2024.06.20(목)', '원문은 보존');
  assert.equal(result.time, '19:30');
  assert.equal(result.seat.floor, 1);
  assert.equal(result.seat.block, 'B');
  assert.equal(result.price, 70000);
  assert.deepEqual(result.composers, ['Rachmaninoff']);
  assert.ok(result.confidence.date > 0.8);
});

test('통합: 쓰레기 입력에도 던지지 않고 빈 결과를 준다', () => {
  const result = postProcessOCR('not json at all');
  assert.equal(result.title, '');
  assert.equal(result.date, null);
  assert.deepEqual(result.program, []);
  // 모델이 아무 필드도 주지 않았으므로 confidence 항목 자체가 없어야 한다.
  // (없는 필드에 0을 지어내면 캘리브레이션 지표가 오염된다 — 실측 ECE 0.282의 원인)
  assert.deepEqual(result.confidence, {});
  assert.equal(result.parseConfidence.date, 0);
});

test('confidence: 모델이 응답에 넣지 않은 필드에는 항목을 만들지 않는다', () => {
  const r = postProcessOCR({ title: { value: 'x', confidence: 0.9 } });
  assert.deepEqual(Object.keys(r.confidence), ['title']);
  assert.equal('price' in r.confidence, false);
  assert.equal('program' in r.confidence, false);
});

test('confidence: 빈 program 배열에도 항목을 만들지 않는다', () => {
  // 한국 티켓은 곡목이 없는 게 정상이다. 없는 것에 대한 "확신도 0"은 정보가 아니다.
  const r = postProcessOCR({ program: [], title: { value: 'x', confidence: 0.9 } });
  assert.deepEqual(r.program, []);
  assert.equal('program' in r.confidence, false);

  const withProgram = postProcessOCR({ program: [{ value: 'Chopin - Ballade', confidence: 0.8 }] });
  assert.equal(withProgram.confidence.program, 0.8);
});



/* ------------------------------------------------------------------ *
 * gradeRaw — 실측 seat.grade 정확도 8.3% 의 원인이었던 스키마 갭
 *
 * 등급(R석/회원석/일반석…)은 좌석 문자열과 **다른 영역**에 인쇄된다.
 * seatRaw 에만 의존하면 구조적으로 잡을 수 없다.
 * ------------------------------------------------------------------ */

test('등급: gradeRaw 가 주어지면 그 값을 등급으로 쓴다', () => {
  const seat = parseSeat('객석 1층 B구역 15열 01번', 'R석');
  assert.equal(seat.grade, 'R석');
  assert.equal(seat.floor, 1);
  assert.equal(seat.confidence, 1);
});

test('등급: 인쇄된 표기를 그대로 보존한다 (정규화하지 않음)', () => {
  // 실측 정답지에 실제로 등장한 형태들
  for (const g of ['회원석', '일반석', '1층석', 'R석 초대', 'VIP석', 'C석']) {
    assert.equal(parseSeat('1층 A블록 3열 5번', g).grade, g, g);
  }
});

test('등급: 좌석 문자열이 비고 등급만 있어도 정보로 인정한다', () => {
  const seat = parseSeat('', '회원석');
  assert.equal(seat.grade, '회원석');
  assert.equal(seat.confidence, 0.5);
  assert.equal(seat.raw, '');
});

test('등급: gradeRaw 가 비면 기존 seatRaw 스캔으로 폴백한다', () => {
  assert.equal(parseSeat('R석 초대', '').grade, 'R석');
  assert.equal(parseSeat('R석 초대', undefined).grade, 'R석');
});

test('계약: parseSeat 단일 인자 호출이 계속 동작한다 (하위 호환)', () => {
  assert.equal(parseSeat.length >= 1, true);
  const seat = parseSeat('객석 1층 B구역 15열 01번');
  assert.deepEqual(
    { floor: seat.floor, block: seat.block, row: seat.row, number: seat.number },
    { floor: 1, block: 'B', row: 15, number: 1 },
  );
  assert.equal(parseSeat('').confidence, 0);
});

test('통합: postProcessOCR 이 gradeRaw 를 seat.grade 로 흘려보낸다', () => {
  const r = postProcessOCR({
    seatRaw:  { value: '객석 1층 B구역 15열 01번', confidence: 0.9 },
    gradeRaw: { value: '회원석', confidence: 0.88 },
  });
  assert.equal(r.gradeRaw, '회원석');
  assert.equal(r.seat.grade, '회원석');
  assert.equal(r.confidence.grade, 0.88);
});

/* ------------------------------------------------------------------ *
 * confidence — 자기신고를 손대지 않는다 (ECE 악화 방지)
 * ------------------------------------------------------------------ */

test('confidence: postProcessOCR 은 모델 자기신고를 그대로 통과시킨다', () => {
  const r = postProcessOCR({
    title:   { value: '어떤 공연', confidence: 0.91 },
    dateRaw: { value: '2024.06.20', confidence: 0.77 },
    seatRaw: { value: '1층 A블록 3열', confidence: 0.62 },
  });
  // 예전에는 dateRaw.confidence × 파싱신뢰도 로 곱해서 ECE 를 악화시켰다.
  assert.equal(r.confidence.title, 0.91);
  assert.equal(r.confidence.date, 0.77);
  assert.equal(r.confidence.seat, 0.62);
});

test('confidence: 파싱 성공 여부는 parseConfidence 로 따로 노출한다', () => {
  const ok = postProcessOCR({ dateRaw: { value: '2024.06.20', confidence: 0.9 } });
  assert.ok(ok.parseConfidence.date > 0);

  const bad = postProcessOCR({ dateRaw: { value: '날짜미정', confidence: 0.9 } });
  assert.equal(bad.date, null);
  assert.equal(bad.parseConfidence.date, 0, '파싱 실패는 여기서 드러난다');
  assert.equal(bad.confidence.date, 0.9, '자기신고는 건드리지 않는다');
});

test('confidence: 빈 값에 높은 자기신고가 와도 그대로 둔다 (UI가 빈 값을 직접 본다)', () => {
  const r = postProcessOCR({ title: { value: '', confidence: 0.99 } });
  assert.equal(r.title, '');
  assert.equal(r.confidence.title, 0.99);
});

/* ------------------------------------------------------------------ *
 * self-consistency
 * ------------------------------------------------------------------ */

test('self-consistency: 두 실행이 일치하면 confidence 1', () => {
  const a = postProcessOCR({
    title: { value: '조성진 리사이틀', confidence: 0.95 },
    dateRaw: { value: '2025.03.15', confidence: 0.9 },
  });
  const merged = mergeOCRRuns([a, a]);
  assert.equal(merged.title, '조성진 리사이틀');
  assert.equal(merged.confidence.title, 1);
  assert.equal(merged.confidence.date, 1);
});

test('self-consistency: 값이 갈리면 confidence 가 떨어진다 (자기신고가 높아도)', () => {
  const a = postProcessOCR({ priceRaw: { value: '30,000원', confidence: 0.92 } });
  const b = postProcessOCR({ priceRaw: { value: '', confidence: 0.92 } });
  const merged = mergeOCRRuns([a, b]);
  assert.equal(merged.confidence.price, 0.5, '반반으로 갈렸으므로 0.5');
  assert.ok(merged.confidence.price < 0.8, '노란 테두리가 실제로 켜져야 한다');
});

test('self-consistency: 실행이 1개면 원본을 그대로 돌려준다', () => {
  const a = postProcessOCR({ title: { value: 'x', confidence: 0.5 } });
  assert.equal(mergeOCRRuns([a]), a);
});

test('self-consistency: program 은 모든 실행에 공통인 곡만 남긴다', () => {
  const a = postProcessOCR({ program: [{ value: 'Chopin - Ballade No.1', confidence: 0.9 }, { value: 'Liszt - Sonata', confidence: 0.9 }] });
  const b = postProcessOCR({ program: [{ value: 'Chopin - Ballade No.1', confidence: 0.9 }] });
  const merged = mergeOCRRuns([a, b]);
  assert.deepEqual(merged.program, ['Chopin - Ballade No.1']);
  assert.ok(merged.confidence.program < 1);
});

test('needsSecondPass: 날짜를 못 읽었으면 2차 패스를 요구한다', () => {
  const bad = postProcessOCR({
    title:   { value: 'x', confidence: 0.99 },
    dateRaw: { value: '', confidence: 0 },
  });
  assert.equal(needsSecondPass(bad), true);

  const good = postProcessOCR({
    title:   { value: '조성진 리사이틀', confidence: 0.98 },
    artist:  { value: '조성진', confidence: 0.95 },
    venue:   { value: '예술의전당', confidence: 0.99 },
    dateRaw: { value: '2025.03.15', confidence: 0.97 },
    timeRaw: { value: '19:30', confidence: 0.95 },
    seatRaw: { value: '1층 A블록 3열 5번', confidence: 0.93 },
    gradeRaw:{ value: 'R석', confidence: 0.9 },
    priceRaw:{ value: '70,000원', confidence: 0.92 },
    program: [{ value: 'Chopin - Ballade No.1', confidence: 0.9 }],
  });
  assert.equal(needsSecondPass(good), false);
});
