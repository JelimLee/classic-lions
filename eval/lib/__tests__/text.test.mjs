/**
 * eval/lib/text.mjs 단위 테스트 — 네트워크·API 키 불필요
 *
 *   cd eval && npm test
 *
 * 왜 이게 필요한가: **채점기가 틀리면 모든 측정이 틀린다.**
 * `--fixtures` self-test 가 채점을 end-to-end 로 보긴 하지만, 정규화·유사도 같은
 * 바닥 함수가 미묘하게 어긋나면 어느 단계에서 깨졌는지 알 수 없다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeText, normalizeWork, levenshtein, similarity,
  normSimilarity, isEmptyValue, toNumber,
} from '../text.mjs';

/* ---------------- normalizeText ---------------- */

test('normalizeText: 공백·괄호·구두점을 지우고 소문자 NFKC 로 만든다', () => {
  assert.equal(normalizeText('  Chopin: Nocturne (Op. 27-2) '), 'chopinnocturneop272');
  assert.equal(normalizeText('예술의 전당 콘서트홀'), '예술의전당콘서트홀');
});

test('normalizeText: 전각/반각을 통일한다 (NFKC)', () => {
  assert.equal(normalizeText('ＡＢＣ１２３'), normalizeText('ABC123'));
});

test('normalizeText: null/undefined 는 빈 문자열', () => {
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
});

test('normalizeText: 표기 변형이 같은 값으로 접힌다 (exact 과소평가 방지의 근거)', () => {
  assert.equal(
    normalizeText('빈 필하모닉 오케스트라 내한공연'),
    normalizeText('빈필하모닉오케스트라 내한공연'),
  );
});

/* ---------------- normalizeWork ---------------- */

test('normalizeWork: Op. / 작품번호 / No. 표기를 통일한다', () => {
  // eval/README.md 3장에 명시된 계약: 두 표기는 같은 곡이어야 한다.
  assert.equal(
    normalizeWork('Chopin: 24 Preludes Op. 28'),
    normalizeWork('Chopin - 24 Preludes, Op.28'),
  );
});

test('normalizeWork: 한글 "작품번호" 도 op 로 접힌다', () => {
  assert.equal(normalizeWork('쇼팽 전주곡 작품번호 28'), normalizeWork('쇼팽 전주곡 Op.28'));
});

test('normalizeWork: No. / Nr. 를 같게 본다', () => {
  assert.equal(normalizeWork('Symphony No. 5'), normalizeWork('Symphony Nr.5'));
});

/* ---------------- levenshtein / similarity ---------------- */

test('levenshtein: 기본 성질', () => {
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('levenshtein: 대칭이다', () => {
  assert.equal(levenshtein('조성진', '조성인'), levenshtein('조성인', '조성진'));
});

test('similarity: 1.0 = 동일, 0.0 = 완전 불일치', () => {
  assert.equal(similarity('abc', 'abc'), 1);
  assert.equal(similarity('', ''), 1);
  assert.equal(similarity('abc', 'xyz'), 0);
});

test('similarity: 0~1 범위를 벗어나지 않는다', () => {
  for (const [a, b] of [['조성진 리사이틀', '조성진 리싸이틀'], ['a', 'abcdefg'], ['', 'x']]) {
    const s = similarity(a, b);
    assert.ok(s >= 0 && s <= 1, `범위 이탈: ${s}`);
  }
});

test('normSimilarity: 정규화 후 비교라 괄호·공백 차이는 감점되지 않는다', () => {
  assert.equal(normSimilarity('빈 필하모닉 (2025)', '빈필하모닉(2025)'), 1);
  // 부제가 실제로 붙은 경우는 1 미만이어야 한다 — 아니면 오답을 정답으로 센다.
  assert.ok(normSimilarity('빈 필하모닉 오케스트라 내한공연', '빈 필하모닉 오케스트라 내한공연 (2025)') < 1);
});

/* ---------------- isEmptyValue ---------------- */

test('isEmptyValue: 빈 값 표현들을 모두 잡는다', () => {
  for (const v of [null, undefined, '', '   ', '-', 'N/A', 'null', '없음', '미상', '알 수 없음', [], {}, NaN]) {
    assert.equal(isEmptyValue(v), true, `비었다고 판정해야 한다: ${JSON.stringify(v)}`);
  }
});

test('isEmptyValue: 숫자 0 은 비어 있지 않다 (무료·초대권이 유효한 정답이다)', () => {
  // 이게 뒤집히면 초대권 티켓의 정답 0 이 null 로 취급돼 할루시네이션 집계가 통째로 틀린다.
  assert.equal(isEmptyValue(0), false);
});

test('isEmptyValue: 값이 든 배열은 비어 있지 않다', () => {
  assert.equal(isEmptyValue(['Brahms']), false);
  assert.equal(isEmptyValue(['', null]), true);
});

/* ---------------- toNumber ---------------- */

test('toNumber: 통화 표기를 숫자로 만든다', () => {
  assert.equal(toNumber('470,000원'), 470000);
  assert.equal(toNumber('₩470000'), 470000);
  assert.equal(toNumber(470000), 470000);
  assert.equal(toNumber('120,000 원'), 120000);
});

test('toNumber: 숫자가 없으면 null (0 으로 만들지 않는다)', () => {
  assert.equal(toNumber('초대권'), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber('-'), null);
});

test('toNumber: 0 은 0 으로 살아남는다', () => {
  assert.equal(toNumber(0), 0);
  assert.equal(toNumber('0원'), 0);
});
