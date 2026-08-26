/**
 * vrPoints.test.ts — 좌석 시야 지점 표가 깨지지 않았는지 지킨다.
 * 자산을 다시 만들면(tools/build_vr_points.py) 개수와 매칭이 여기서 걸린다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VR_POINTS, nearestVRPoint } from '../../data/vrPoints.ts';

const seat = (floor: any, block: any, row: any, number: any = null) =>
  ({ floor, block, row, number, grade: null, raw: '', confidence: 1 }) as any;

test('coverage', () => {
  const l = VR_POINTS.filter(p => p.venueId === 'lotte-concert-hall');
  const s = VR_POINTS.filter(p => p.venueId === 'sac-concert-hall');
  console.log('lotte', l.length, 'sac', s.length);
  assert.equal(l.length, 50); assert.equal(s.length, 155);
  assert.equal(new Set(VR_POINTS.map(p => p.id)).size, VR_POINTS.length, 'id 중복');
  assert.equal(new Set(VR_POINTS.map(p => p.asset)).size, VR_POINTS.length, 'asset 중복');
});

test('lotte matching', () => {
  const cases: [any, any, any, string][] = [
    [1,'C',3,'lotte'], [1,'C',22,'lotte'], [1,'B',1,'lotte'], [1,'A',9,'lotte'],
    [1,'P',3,'lotte'], [2,'C',5,'lotte'], [2,'L',1,'lotte'], [1,'RP',5,'lotte'],
  ];
  for (const [f,b,r] of cases) {
    const p = nearestVRPoint('lotte-concert-hall', seat(f,b,r,5));
    assert.ok(p, `${f}F ${b} ${r} -> null`);
    assert.equal(p!.floor, f); assert.equal(p!.block, b);
    console.log(`  ${f}층 ${b} ${r}열 -> ${p!.id}  ${p!.label}`);
  }
});

test('lotte C depth ordering', () => {
  const got = [1,5,9,14,18,23].map(r => nearestVRPoint('lotte-concert-hall', seat(1,'C',r))!.row);
  console.log('  C 1/5/9/14/18/23열 ->', got);
  for (let i=1;i<got.length;i++) assert.ok(got[i]! >= got[i-1]!, '단조 증가 아님');
});

test('sac exact', () => {
  const p = nearestVRPoint('sac-concert-hall', seat(1,'A',4,2));
  console.log('  예당 1층 A 4열 2번 ->', p!.id, p!.label);
  assert.equal(p!.row, 4); assert.equal(p!.number, 2);
  const q = nearestVRPoint('sac-concert-hall', seat(3,'BOX9',null,3));
  console.log('  예당 3층 BOX9 ->', q!.id, q!.label);
  assert.equal(q!.block, 'BOX9');
});

test('null 처리', () => {
  assert.equal(nearestVRPoint('lotte-concert-hall', seat(null,'C',3)), null, '층 모르면 null');
  assert.equal(nearestVRPoint('nope', seat(1,'C',3)), null, '모르는 홀은 null');
  assert.equal(nearestVRPoint('lotte-concert-hall', seat(9,'C',3)), null, '없는 층은 null');
  const p = nearestVRPoint('lotte-concert-hall', seat(1,null,null));
  console.log('  구역 모름 1층 ->', p?.id);
  assert.ok(p, '층만 알아도 뭔가 나와야');
});

test('블록 폴백 (2층 P는 없다)', () => {
  const p = nearestVRPoint('lotte-concert-hall', seat(2,'P',2,4));
  console.log('  2층 P(없는 구역) ->', p?.id, p?.label);
  assert.ok(p);
});
