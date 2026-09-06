/**
 * eval/lib/scope.mjs 단위 테스트
 *
 * 평가 범위(scope)는 "세종문화회관을 왜 빼는가" 라는 **측정 정당성**의 문제다.
 * 범위 외 항목을 조용히 지우면 정확도가 부풀고, 조용히 섞으면 구조적으로
 * 맞출 수 없는 항목(알파벳 열) 때문에 정확도가 부당하게 깎인다.
 * 그래서 "빼되 따로 집계한다" 는 규칙이 성립하는지 여기서 고정한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeScopeFilter, parseScope, DEFAULT_OUT_OF_SCOPE_PREFIXES } from '../scope.mjs';

test('DEFAULT_OUT_OF_SCOPE_PREFIXES: 세종만 범위 외다', () => {
  assert.deepEqual(DEFAULT_OUT_OF_SCOPE_PREFIXES, ['sejong_']);
});

test('parseScope: in|out|all 만 받는다', () => {
  assert.equal(parseScope('in'), 'in');
  assert.equal(parseScope('OUT'), 'out');
  assert.equal(parseScope('all'), 'all');
  assert.equal(parseScope(undefined), 'in', '기본값은 in');
});

test('parseScope: 잘못된 값은 던진다 (조용히 기본값으로 넘어가지 않는다)', () => {
  assert.throws(() => parseScope('lotte'), /scope/);
  assert.throws(() => parseScope(''), /scope/);
});

test('isOut / isIn: 접두사로만 판정한다', () => {
  const f = makeScopeFilter();
  assert.equal(f.isOut('sejong_harry_potter_2025.jpg'), true);
  assert.equal(f.isIn('lotte_met_opera_2024.jpg'), true);
  assert.equal(f.isIn('sac_new_year_concert_2024.jpg'), true);
});

test('accepts: scope=in 은 롯데·예당만', () => {
  const f = makeScopeFilter({ scope: 'in' });
  assert.equal(f.accepts('lotte_a.jpg'), true);
  assert.equal(f.accepts('sac_a.jpg'), true);
  assert.equal(f.accepts('sejong_a.jpg'), false);
});

test('accepts: scope=out 은 세종만', () => {
  const f = makeScopeFilter({ scope: 'out' });
  assert.equal(f.accepts('sejong_a.jpg'), true);
  assert.equal(f.accepts('lotte_a.jpg'), false);
});

test('accepts: scope=all 은 전부 (범위 외를 삭제하지 않는다는 규칙의 근거)', () => {
  const f = makeScopeFilter({ scope: 'all' });
  for (const n of ['sejong_a.jpg', 'lotte_a.jpg', 'sac_a.jpg']) {
    assert.equal(f.accepts(n), true);
  }
});

test('label: 리포트에 붙는 in/out 라벨', () => {
  const f = makeScopeFilter();
  assert.equal(f.label('sejong_a.jpg'), 'out');
  assert.equal(f.label('lotte_a.jpg'), 'in');
});

test('prefixes 를 바꿔 끼울 수 있다', () => {
  const f = makeScopeFilter({ scope: 'in', prefixes: ['lotte_'] });
  assert.equal(f.accepts('lotte_a.jpg'), false);
  assert.equal(f.accepts('sejong_a.jpg'), true);
});
