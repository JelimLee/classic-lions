/**
 * eval/lib/extract.mjs 단위 테스트
 *
 * 이 모듈은 모델 출력에서 필드를 **관대하게** 꺼낸다. 관대함이 과하면 위험하다 —
 * 없는 필드를 있다고 하면(present) 채점기가 "모델이 값을 냈다" 고 오판하고,
 * 그 오판은 곧바로 할루시네이션 집계를 오염시킨다.
 * 그래서 여기서는 "잘 꺼내는가" 만큼 "없을 때 없다고 하는가" 를 함께 고정한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { unwrap, pick, pickConfidence, pickSeatRaw, ALIASES } from '../extract.mjs';

/* ---------------- unwrap ---------------- */

test('unwrap: 평문 값은 그대로, wrapped=false', () => {
  assert.deepEqual(unwrap('조성진'), { value: '조성진', confidence: null, wrapped: false });
});

test('unwrap: {value, confidence} 래퍼를 푼다', () => {
  assert.deepEqual(unwrap({ value: '조성진', confidence: 0.97 }), {
    value: '조성진', confidence: 0.97, wrapped: true,
  });
});

test('unwrap: conf 축약 키도 인식한다', () => {
  assert.equal(unwrap({ value: 'x', conf: 0.5 }).confidence, 0.5);
});

test('unwrap: 배열은 원소별로 풀고 confidence 는 평균낸다', () => {
  const r = unwrap([{ value: 'A', confidence: 0.8 }, { value: 'B', confidence: 0.6 }]);
  assert.deepEqual(r.value, ['A', 'B']);
  assert.ok(Math.abs(r.confidence - 0.7) < 1e-9);
});

test('unwrap: 평문 배열도 받는다', () => {
  assert.deepEqual(unwrap(['A', 'B']).value, ['A', 'B']);
});

test('unwrap: null/undefined 는 value null', () => {
  assert.equal(unwrap(null).value, null);
  assert.equal(unwrap(undefined).value, null);
});

test('unwrap: 중첩 객체(seat 등)는 풀지 않고 그대로 넘긴다', () => {
  const seat = { floor: 1, block: 'A', row: 15 };
  assert.deepEqual(unwrap(seat).value, seat);
});

/* ---------------- pick ---------------- */

test('pick: 표준 이름으로 꺼낸다', () => {
  assert.equal(pick({ title: '조성진 리사이틀' }, 'title').value, '조성진 리사이틀');
});

test('pick: 별칭을 인식한다 (dateRaw / seatRaw / 한국어 키)', () => {
  assert.equal(pick({ dateRaw: '2024.06.20' }, 'date').value, '2024.06.20');
  assert.equal(pick({ seatRaw: '1층 A구역' }, 'seat_raw').value, '1층 A구역');
  assert.equal(pick({ 공연장: '롯데콘서트홀' }, 'venue').value, '롯데콘서트홀');
});

test('pick: 별칭 우선순위는 ALIASES 순서를 따른다', () => {
  const obj = { price: 1000, priceRaw: '2,000원' };
  assert.equal(ALIASES.price[0], 'price');
  assert.equal(pick(obj, 'price').value, 1000);
});

test('pick: fields/data/result/ocr 안쪽까지 찾는다', () => {
  assert.equal(pick({ fields: { title: 'A' } }, 'title').value, 'A');
  assert.equal(pick({ data: { title: 'B' } }, 'title').value, 'B');
  assert.equal(pick({ ocr: { title: 'C' } }, 'title').value, 'C');
});

test('pick: 없는 필드는 present=false 다 (있다고 하면 할루시네이션 집계가 오염된다)', () => {
  const r = pick({ title: 'A' }, 'artist');
  assert.equal(r.present, false);
  assert.equal(r.value, null);
  assert.equal(r.key, null);
});

test('pick: 값이 빈 문자열이어도 키가 있으면 present=true', () => {
  // "모델이 기권했다(빈 값)" 와 "필드 자체가 없다" 는 다른 사건이다.
  const r = pick({ artist: '' }, 'artist');
  assert.equal(r.present, true);
  assert.equal(r.value, '');
});

test('pick: 객체가 아니면 present=false', () => {
  assert.equal(pick(null, 'title').present, false);
  assert.equal(pick('문자열', 'title').present, false);
});

/* ---------------- pickConfidence ---------------- */

test('pickConfidence: 인라인 숫자가 있으면 그것을 쓴다', () => {
  assert.equal(pickConfidence({}, 'title', 0.9), 0.9);
});

test('pickConfidence: 별도 confidence 맵을 지원한다', () => {
  assert.equal(pickConfidence({ confidences: { title: 0.75 } }, 'title'), 0.75);
  assert.equal(pickConfidence({ confidence: { title: 0.6 } }, 'title'), 0.6);
  assert.equal(pickConfidence({ fieldConfidence: { title: 0.4 } }, 'title'), 0.4);
});

test('pickConfidence: 없으면 null — 0 으로 지어내지 않는다', () => {
  // 0 을 지어내면 캘리브레이션 표본 수가 이미지 수만큼 부풀어 ECE 가 틀어진다
  // (DEVLOG §5-22 에서 실제로 났던 사고다).
  assert.equal(pickConfidence({}, 'title'), null);
});

/* ---------------- pickSeatRaw ---------------- */

test('pickSeatRaw: 문자열을 그대로 돌려준다', () => {
  const r = pickSeatRaw({ seat_raw: '1층 A구역 15열 01번' });
  assert.equal(r.raw, '1층 A구역 15열 01번');
  assert.equal(r.present, true);
});

test('pickSeatRaw: 객체로 와도 안쪽 문자열을 꺼낸다', () => {
  assert.equal(pickSeatRaw({ seat_raw: { raw: '2층 B구역' } }).raw, '2층 B구역');
  assert.equal(pickSeatRaw({ seat_raw: { text: '2층 C구역' } }).raw, '2층 C구역');
});

test('pickSeatRaw: 없으면 raw=null, present=false', () => {
  const r = pickSeatRaw({});
  assert.equal(r.raw, null);
  assert.equal(r.present, false);
});

test('pickSeatRaw: {value, confidence} 래퍼도 흡수한다', () => {
  const r = pickSeatRaw({ seatRaw: { value: '1층 A구역', confidence: 0.8 } });
  assert.equal(r.raw, '1층 A구역');
  assert.equal(r.confidence, 0.8);
});
