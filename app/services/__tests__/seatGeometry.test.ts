/**
 * seatGeometry 불변식 + 회귀 테스트 — **9격자 top-down 기준**
 *
 *   cd app && npm test
 *
 * 검증하는 것
 *   - 지원 안 하는 홀을 절대 그리지 않는다 (사용자가 안 가본 홀에 앉는 사고 방지)
 *   - 모든 블록 × 여러 좌석 조합에서 칸이 캔버스/층 밖으로 안 나간다
 *   - 같은 층에서 열이 커질수록 뒤쪽 존으로만 간다 (앞으로 되돌아가지 않는다)
 *   - 무대 뒤 블록은 9격자가 아니라 'behind-stage' 로 빠진다
 *   - 불완전 좌석이 precision 5단계로 정확히 강등된다
 *   - column 이 venues.ts 의 position 과 어긋나지 않는다 (알파벳 추측 금지)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { VENUES, matchVenue } from '../../data/venues.ts';
import type { VenueProfile } from '../../data/venues.ts';
import type { ParsedSeat } from '../ocrSchema.ts';
import {
  ART_W,
  ART_H,
  GRID_ZONES,
  LOTTE_ROW_GAPS,
  PLANS,
  SAC_ROW_GAPS,
  ZONE_SPECS,
  bandOf,
  cellInsideCanvas,
  columnConflicts,
  findZoneSpec,
  occupiedZones,
  overlaps,
  pickScale,
  presentRows,
  resolveSeatMap,
  seatToZone,
} from '../seatGeometry.ts';
import type { Band, Cell, ZonePlacement } from '../seatGeometry.ts';

const seat = (o: Partial<ParsedSeat>): ParsedSeat => ({
  floor: null, block: null, row: null, number: null,
  grade: null, raw: '', confidence: 1, ...o,
});

const LOTTE = VENUES['lotte-concert-hall'];
const SAC = VENUES['sac-concert-hall'];
const BAND_ORDER: Record<Band, number> = { front: 0, mid: 1, rear: 2 };

/** cell 이 다른 cell 안에 완전히 들어가는가 */
function contains(outer: Cell, inner: Cell): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/* ------------------------------------------------------------------ *
 * 🔴 회귀 — 이게 깨지면 사용자가 안 가본 홀에 앉는다
 * ------------------------------------------------------------------ */

test('회귀: 예술의전당 CJ토월극장은 매칭되지 않는다', () => {
  assert.equal(matchVenue('예술의전당 CJ토월극장'), null);
  assert.equal(matchVenue('예술의전당 CJ 토월극장'), null);
  assert.equal(matchVenue('예술의전당 토월극장'), null);
});

test('회귀: 지원 안 하는 홀은 좌석표를 아예 안 그린다', () => {
  for (const v of ['예술의전당 CJ 토월극장', '세종문화회관 대극장', '예술의전당 IBK챔버홀']) {
    const r = resolveSeatMap(v, seat({ floor: 1, block: 'B', row: 3, number: 5 }));
    assert.equal(r.status, 'unsupported-venue', v);
    assert.equal(r.placement, null, `${v}: placement 를 만들면 안 된다`);
    assert.equal(r.plan, null);
    assert.equal(r.floorPlan, null);
  }
});

test('회귀: 모르는 홀도 아무것도 안 그린다 (fallback 홀 금지)', () => {
  const r = resolveSeatMap('통영국제음악당 콘서트홀', seat({ floor: 1, block: 'A', row: 2, number: 3 }));
  assert.equal(r.status, 'unknown-venue');
  assert.equal(r.placement, null);
  assert.equal(r.plan, null);
});

test('회귀: 롯데에는 3층이 없다 → 그리지 않는다', () => {
  const r = resolveSeatMap('롯데콘서트홀', seat({ floor: 3, block: 'B', row: 1, number: 1 }));
  assert.equal(r.status, 'seat-unknown');
  assert.equal(r.placement, null);
});

/* ------------------------------------------------------------------ *
 * 층 평면 자체의 불변식
 * ------------------------------------------------------------------ */

test('모든 층 평면의 9칸·무대·합창석·bounds 가 캔버스 안에 있다', () => {
  for (const plan of Object.values(PLANS)) {
    for (const fp of Object.values(plan.floors)) {
      const tag = `${plan.venueId} ${fp.floor}층`;
      assert.ok(cellInsideCanvas(fp.stage), `${tag} 무대`);
      assert.ok(cellInsideCanvas(fp.bounds), `${tag} bounds`);
      if (fp.behindStage) assert.ok(cellInsideCanvas(fp.behindStage), `${tag} 합창석`);
      for (const z of GRID_ZONES) {
        assert.ok(cellInsideCanvas(fp.cells[z]), `${tag} ${z}`);
      }
    }
  }
});

test('9칸끼리 겹치지 않고, 무대·합창석과도 겹치지 않는다', () => {
  for (const plan of Object.values(PLANS)) {
    for (const fp of Object.values(plan.floors)) {
      const tag = `${plan.venueId} ${fp.floor}층`;
      for (let i = 0; i < GRID_ZONES.length; i++) {
        for (let j = i + 1; j < GRID_ZONES.length; j++) {
          assert.ok(
            !overlaps(fp.cells[GRID_ZONES[i]], fp.cells[GRID_ZONES[j]]),
            `${tag}: ${GRID_ZONES[i]} 와 ${GRID_ZONES[j]} 가 겹친다`,
          );
        }
        assert.ok(!overlaps(fp.cells[GRID_ZONES[i]], fp.stage), `${tag}: ${GRID_ZONES[i]} 가 무대를 덮는다`);
        if (fp.behindStage) {
          assert.ok(
            !overlaps(fp.cells[GRID_ZONES[i]], fp.behindStage),
            `${tag}: ${GRID_ZONES[i]} 가 합창석을 덮는다`,
          );
        }
      }
      if (fp.behindStage) assert.ok(!overlaps(fp.behindStage, fp.stage), `${tag}: 합창석이 무대를 덮는다`);
    }
  }
});

test('9칸은 가로로 좌<중<우, 세로로 앞<중<뒤 순서다', () => {
  const cx = (c: Cell) => c.x + c.w / 2;
  const cy = (c: Cell) => c.y + c.h / 2;
  for (const plan of Object.values(PLANS)) {
    for (const fp of Object.values(plan.floors)) {
      const tag = `${plan.venueId} ${fp.floor}층`;
      for (const band of ['front', 'mid', 'rear'] as Band[]) {
        assert.ok(cx(fp.cells[`${band}-left`]) < cx(fp.cells[`${band}-center`]), `${tag} ${band} 좌<중`);
        assert.ok(cx(fp.cells[`${band}-center`]) < cx(fp.cells[`${band}-right`]), `${tag} ${band} 중<우`);
      }
      for (const col of ['left', 'center', 'right'] as const) {
        assert.ok(cy(fp.cells[`front-${col}`]) < cy(fp.cells[`mid-${col}`]), `${tag} ${col} 앞<중`);
        assert.ok(cy(fp.cells[`mid-${col}`]) < cy(fp.cells[`rear-${col}`]), `${tag} ${col} 중<뒤`);
      }
      // 무대는 늘 앞쪽 칸보다 위(=무대 쪽)에 있다
      assert.ok(fp.stage.y < cy(fp.cells['front-center']), `${tag}: 무대가 앞칸보다 아래에 있다`);
    }
  }
});

test('무대 뒤 합창석은 무대보다 위(9격자 반대편)에 있다', () => {
  for (const plan of Object.values(PLANS)) {
    for (const fp of Object.values(plan.floors)) {
      if (!fp.behindStage) continue;
      assert.ok(
        fp.behindStage.y + fp.behindStage.h <= fp.stage.y,
        `${plan.venueId} ${fp.floor}층: 합창석이 무대 뒤가 아니다`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * 🔴 column 은 알파벳이 아니라 position/공식 배치도에서 온다
 * ------------------------------------------------------------------ */

test('column 이 venues.ts 의 position 과 어긋나지 않는다', () => {
  for (const p of Object.values(VENUES)) {
    assert.deepEqual(columnConflicts(p), [], `${p.id}: position 과 column 이 어긋난다`);
  }
});

test("position==='rear' 인 블록은 깊이 구간이 층의 뒤쪽 절반에 있다", () => {
  for (const p of Object.values(VENUES)) {
    for (const b of p.blocks) {
      if (b.position !== 'rear') continue;
      const spec = findZoneSpec(p.id, b.floor, b.code);
      assert.ok(spec, `${p.id} ${b.floor}층 ${b.code} 존 정의 없음`);
      assert.ok(spec!.depth[0] >= 0.5, `${p.id} ${b.floor}층 ${b.code}: rear 인데 앞쪽에 있다`);
    }
  }
});

test('venues.ts 의 모든 블록에 존 정의가 있다 (그 반대도)', () => {
  for (const p of Object.values(VENUES)) {
    for (const b of p.blocks) {
      assert.ok(findZoneSpec(p.id, b.floor, b.code), `${p.id} ${b.floor}층 ${b.code} 존 없음`);
    }
    for (const s of ZONE_SPECS[p.id]) {
      const hit = p.blocks.find((b) => b.floor === s.floor && b.code === s.code);
      assert.ok(hit, `${p.id} ${s.floor}층 ${s.code}: venues.ts 에 없는 블록`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 전 블록 × 여러 좌석 조합 스윕
 * ------------------------------------------------------------------ */

function sweepSeats(p: VenueProfile): { label: string; s: ParsedSeat }[] {
  const out: { label: string; s: ParsedSeat }[] = [];
  for (const b of p.blocks) {
    const rows =
      b.rowMin != null && b.rowMax != null
        ? [b.rowMin, Math.round((b.rowMin + b.rowMax) / 2), b.rowMax]
        : [null];
    for (const row of rows) {
      for (const number of [null, 1, 7, 34]) {
        out.push({
          label: `${p.id} ${b.floor}층 ${b.code} ${row ?? '?'}열 ${number ?? '?'}번`,
          s: seat({ floor: b.floor, block: b.code, row, number }),
        });
      }
    }
  }
  return out;
}

test('전 블록 × 여러 좌석 조합: 칸이 캔버스 밖으로 안 나가고 층 안에 있다', () => {
  for (const p of Object.values(VENUES)) {
    for (const { label, s } of sweepSeats(p)) {
      const pl = seatToZone(p, s) as ZonePlacement;
      assert.ok(pl, `${label}: placement 가 null`);
      assert.ok(cellInsideCanvas(pl.cell), `${label}: 칸이 캔버스 밖 ${JSON.stringify(pl.cell)}`);
      assert.ok(
        pl.anchor.x >= 0 && pl.anchor.x < ART_W && pl.anchor.y >= 0 && pl.anchor.y < ART_H,
        `${label}: 아바타 기준점이 캔버스 밖`,
      );
      const fp = PLANS[p.id].floors[pl.floor];
      if (pl.zone && pl.zone !== 'behind-stage') {
        assert.ok(contains(fp.bounds, pl.cell), `${label}: 칸이 층 bounds 밖`);
      }
    }
  }
});

test('전 블록 스윕: precision 이 5단계 중 하나이고 zone 이 유효하다', () => {
  const ok = new Set(['exact', 'row', 'block', 'floor', 'none']);
  for (const p of Object.values(VENUES)) {
    for (const { label, s } of sweepSeats(p)) {
      const pl = seatToZone(p, s) as ZonePlacement;
      assert.ok(ok.has(pl.precision), `${label}: 이상한 precision ${pl.precision}`);
      assert.ok(pl.zone !== null, `${label}: 블록을 알면 zone 이 있어야 한다`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 🔴 단조성 — 열이 커지면 뒤로만 간다
 * ------------------------------------------------------------------ */

test('같은 층·블록에서 열이 커질수록 뒤쪽 존으로만 간다 (앞으로 되돌아가지 않는다)', () => {
  for (const p of Object.values(VENUES)) {
    for (const b of p.blocks) {
      if (b.rowMin == null || b.rowMax == null) continue;
      const spec = findZoneSpec(p.id, b.floor, b.code)!;
      let prev = -1;
      for (const row of presentRows(b, spec)) {
        const pl = seatToZone(p, seat({ floor: b.floor, block: b.code, row }))!;
        if (pl.band == null) continue; // 무대 뒤는 격자 밖이라 밴드가 없다
        const idx = BAND_ORDER[pl.band];
        assert.ok(
          idx >= prev,
          `${p.id} ${b.floor}층 ${b.code}: ${row}열에서 앞쪽으로 되돌아갔다 (${prev} → ${idx})`,
        );
        prev = idx;
      }
    }
  }
});

test('층 전체 깊이를 덮는 블록은 앞→중→뒤를 실제로 다 지난다', () => {
  const cases: [VenueProfile, number, string][] = [
    [LOTTE, 1, 'B'],
    [LOTTE, 1, 'C'],
    [SAC, 1, 'C'],
    [SAC, 1, 'A'],
  ];
  for (const [p, floor, code] of cases) {
    const b = p.blocks.find((x) => x.floor === floor && x.code === code)!;
    const spec = findZoneSpec(p.id, floor, code)!;
    const bands = new Set(
      presentRows(b, spec).map((row) => seatToZone(p, seat({ floor, block: code, row }))!.band),
    );
    assert.deepEqual(
      [...bands].sort(),
      ['front', 'mid', 'rear'],
      `${p.id} ${floor}층 ${code}: 앞/중/뒤를 다 지나지 않는다`,
    );
  }
});

test('롯데 2층 뒤 발코니(A~E)는 열과 무관하게 늘 뒤쪽이다', () => {
  for (const code of ['A', 'B', 'C', 'D', 'E']) {
    for (const row of [1, 3, 6]) {
      const pl = seatToZone(LOTTE, seat({ floor: 2, block: code, row, number: 4 }))!;
      assert.equal(pl.band, 'rear', `롯데 2층 ${code} ${row}열`);
    }
  }
});

test('롯데 2층 측면 발코니 L 은 좌석 번호가 커질수록 뒤로 간다', () => {
  const bands = [1, 17, 34].map((n) => seatToZone(LOTTE, seat({ floor: 2, block: 'L', row: 1, number: n }))!.band);
  assert.deepEqual(bands, ['front', 'mid', 'rear']);
});

/* ------------------------------------------------------------------ *
 * 🔴 무대 뒤 블록
 * ------------------------------------------------------------------ */

test("무대 뒤(합창석) 블록은 전부 zone 'behind-stage' 다", () => {
  let seen = 0;
  for (const p of Object.values(VENUES)) {
    for (const b of p.blocks.filter((x) => x.position === 'behind-stage')) {
      const pl = seatToZone(p, seat({ floor: b.floor, block: b.code, row: b.rowMin, number: 3 }))!;
      assert.equal(pl.zone, 'behind-stage', `${p.id} ${b.floor}층 ${b.code}`);
      assert.equal(pl.band, null);
      assert.equal(pl.column, null);
      // 무대 뒤 칸은 9격자 어느 칸과도 다른 자리를 쓴다
      const fp = PLANS[p.id].floors[b.floor];
      assert.ok(fp.behindStage, `${p.id} ${b.floor}층: 합창석 칸이 정의돼 있어야 한다`);
      seen++;
    }
  }
  assert.equal(seen, 6, '롯데 P·LP·RP + 예당 G·H·F = 6개여야 한다');
});

test('무대 뒤가 아닌 블록은 절대 behind-stage 로 안 간다', () => {
  for (const p of Object.values(VENUES)) {
    for (const b of p.blocks) {
      if (b.position === 'behind-stage') continue;
      const pl = seatToZone(p, seat({ floor: b.floor, block: b.code, row: b.rowMin, number: 2 }))!;
      assert.notEqual(pl.zone, 'behind-stage', `${p.id} ${b.floor}층 ${b.code}`);
    }
  }
});

/**
 * ⚠️ venues.ts 의 `behindStageBlocks` 는 **층을 구분하지 않는 코드 목록**이다.
 * 예당은 3층에도 'F' 구역(뒤 발코니)이 있어서 코드만 보면 합창석으로 오인한다.
 * 그래서 위 두 테스트도, seatGeometry 도 `position === 'behind-stage'` 를 본다.
 * 이 테스트는 그 함정이 여전히 존재한다는 사실 자체를 고정해 둔다.
 */
test('behindStageBlocks 는 층을 구분하지 않는다 — position 을 봐야 한다', () => {
  assert.ok(SAC.behindStageBlocks.includes('F'));
  const chorusF = SAC.blocks.find((b) => b.code === 'F' && b.floor === 1)!;
  const balconyF = SAC.blocks.find((b) => b.code === 'F' && b.floor === 3)!;
  assert.equal(chorusF.position, 'behind-stage');
  assert.equal(balconyF.position, 'rear');
  assert.equal(seatToZone(SAC, seat({ floor: 3, block: 'F', row: 5, number: 2 }))!.zone, 'rear-right');
});

/* ------------------------------------------------------------------ *
 * 🔴 precision 5단계 강등
 * ------------------------------------------------------------------ */

test("불완전 좌석(1층만) → precision 'floor', zone null, 층 전체 상자", () => {
  for (const [venue, p] of [['롯데콘서트홀', LOTTE], ['예술의전당 콘서트홀', SAC]] as const) {
    const r = resolveSeatMap(venue, seat({ floor: 1 }));
    assert.equal(r.status, 'ok');
    assert.equal(r.placement!.precision, 'floor');
    assert.equal(r.placement!.zone, null);
    assert.deepEqual(r.placement!.cell, PLANS[p.id].floors[1].bounds);
    assert.ok(r.message.startsWith('≈'), r.message);
  }
});

test("블록만 알면 precision 'block'", () => {
  const r = resolveSeatMap('예술의전당 콘서트홀', seat({ floor: 1, block: 'E' }));
  assert.equal(r.placement!.precision, 'block');
  assert.equal(r.placement!.zone, 'mid-right');
});

test("열까지 알면 'row', 번호까지 알면 'exact'", () => {
  const row = seatToZone(LOTTE, seat({ floor: 1, block: 'B', row: 15 }))!;
  assert.equal(row.precision, 'row');
  const exact = seatToZone(LOTTE, seat({ floor: 1, block: 'B', row: 15, number: 1 }))!;
  assert.equal(exact.precision, 'exact');
  assert.equal(row.zone, exact.zone);
});

test("좌석을 전혀 모르면 precision 'none' — 아바타를 안 그린다", () => {
  const r = resolveSeatMap('롯데콘서트홀', seat({ raw: '롯데콘서트홀 표준좌석' }));
  assert.equal(r.status, 'seat-unknown');
  assert.equal(r.placement, null);
  assert.ok(r.plan, '홀은 알고 있어야 한다 (평면도는 그린다)');
});

test("없는 구역을 읽으면 층으로 강등하고 경고한다", () => {
  const pl = seatToZone(LOTTE, seat({ floor: 1, block: 'Z', row: 3, number: 1 }))!;
  assert.equal(pl.precision, 'floor');
  assert.equal(pl.zone, null);
  assert.match(pl.warning ?? '', /구역이 없어요/);
});

/* ------------------------------------------------------------------ *
 * 결번 열 / 범위 밖
 * ------------------------------------------------------------------ */

test('롯데 1층 B·D 의 결번(8·16·17·18열)은 그럴듯하게 찍지 않고 블록으로 강등한다', () => {
  for (const code of ['B', 'D']) {
    for (const row of LOTTE_ROW_GAPS) {
      const pl = seatToZone(LOTTE, seat({ floor: 1, block: code, row, number: 5 }))!;
      assert.equal(pl.precision, 'block', `롯데 1층 ${code} ${row}열`);
      assert.match(pl.warning ?? '', /없어요/);
    }
  }
});

test('롯데 1층 C 에는 결번이 없다 (B·D 에만 있다)', () => {
  for (const row of LOTTE_ROW_GAPS) {
    const pl = seatToZone(LOTTE, seat({ floor: 1, block: 'C', row, number: 5 }))!;
    assert.equal(pl.precision, 'exact', `롯데 1층 C ${row}열`);
    assert.equal(pl.warning, null);
  }
});

test('예당 1층 A·E 의 14열은 통로다', () => {
  for (const code of ['A', 'E']) {
    const rows = presentRows(SAC.blocks.find((b) => b.floor === 1 && b.code === code)!, findZoneSpec(SAC.id, 1, code)!);
    assert.ok(!rows.includes(SAC_ROW_GAPS[0]), `예당 1층 ${code} 14열이 남아 있다`);
    const pl = seatToZone(SAC, seat({ floor: 1, block: code, row: 14, number: 3 }))!;
    assert.equal(pl.precision, 'block');
  }
});

test('범위 밖 열은 경고와 함께 블록으로 강등한다', () => {
  const pl = seatToZone(LOTTE, seat({ floor: 1, block: 'A', row: 99, number: 1 }))!;
  assert.equal(pl.precision, 'block');
  assert.match(pl.warning ?? '', /범위 밖/);
});

/* ------------------------------------------------------------------ *
 * 좌우 대칭 / 방향
 * ------------------------------------------------------------------ */

test('좌우 대칭 짝은 같은 밴드, 반대 컬럼이다', () => {
  const pairs: [VenueProfile, number, string, string][] = [
    [LOTTE, 1, 'A', 'E'],
    [LOTTE, 1, 'L', 'R'],
    [SAC, 1, 'A', 'E'],
    [SAC, 3, 'B', 'F'],
  ];
  for (const [p, floor, l, r] of pairs) {
    const a = seatToZone(p, seat({ floor, block: l, row: 5, number: 4 }))!;
    const b = seatToZone(p, seat({ floor, block: r, row: 5, number: 4 }))!;
    assert.equal(a.band, b.band, `${p.id} ${floor}층 ${l}/${r} 밴드`);
    assert.equal(a.column, 'left');
    assert.equal(b.column, 'right');
  }
});

test('예당 2층 A(away)와 E(toward)는 같은 번호에서 깊이가 반대다', () => {
  const a = seatToZone(SAC, seat({ floor: 2, block: 'A', row: 3, number: 1 }))!;
  const e = seatToZone(SAC, seat({ floor: 2, block: 'E', row: 3, number: 1 }))!;
  assert.equal(a.zone, 'front-left');
  assert.equal(e.zone, 'rear-right');
});

test('예당 2·3층 BOX 는 열 체계 미확인이라 블록까지만, 무대 쪽 앞 칸이다', () => {
  for (const [floor, code, zone] of [
    [2, 'BOX1', 'front-left'],
    [2, 'BOX4', 'front-right'],
    [3, 'BOX9', 'front-left'],
    [3, 'BOX12', 'front-right'],
  ] as const) {
    const pl = seatToZone(SAC, seat({ floor, block: code, row: 1, number: 2 }))!;
    assert.equal(pl.precision, 'block', `${code} precision`);
    assert.equal(pl.zone, zone, `${code} zone`);
  }
});

/* ------------------------------------------------------------------ *
 * 비어 있는 칸 / occupiedZones
 * ------------------------------------------------------------------ */

test('2·3층 중앙 앞·중간은 좌석이 없다 (1층 위 허공)', () => {
  for (const [venueId, floor] of [
    ['lotte-concert-hall', 2],
    ['sac-concert-hall', 2],
    ['sac-concert-hall', 3],
  ] as const) {
    const live = occupiedZones(venueId, floor);
    assert.ok(!live.has('front-center'), `${venueId} ${floor}층 front-center`);
    assert.ok(!live.has('mid-center'), `${venueId} ${floor}층 mid-center`);
    assert.ok(live.has('rear-center'), `${venueId} ${floor}층 rear-center 는 있어야 한다`);
  }
});

test('1층은 9칸이 전부 좌석으로 차고 합창석도 있다', () => {
  for (const venueId of ['lotte-concert-hall', 'sac-concert-hall']) {
    const live = occupiedZones(venueId, 1);
    for (const z of GRID_ZONES) assert.ok(live.has(z), `${venueId} 1층 ${z} 가 비었다`);
    assert.ok(live.has('behind-stage'), `${venueId} 1층 합창석`);
  }
});

test('occupiedZones 에 들어간 칸은 실제로 그 층 평면에 존재한다', () => {
  for (const plan of Object.values(PLANS)) {
    for (const fp of Object.values(plan.floors)) {
      for (const z of occupiedZones(plan.venueId, fp.floor)) {
        if (z === 'behind-stage') {
          assert.ok(fp.behindStage, `${plan.venueId} ${fp.floor}층: 합창석 칸이 없는데 존이 있다`);
        } else {
          assert.ok(fp.cells[z], `${plan.venueId} ${fp.floor}층 ${z}`);
        }
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * ≈ 표시 / 잡다한 순수 함수
 * ------------------------------------------------------------------ */

test('conf.geometry 가 confirmed 가 아니면 approx=true 이고 문구에 ≈ 가 붙는다', () => {
  // 예당 2층 A 는 conf.geometry === 'inferred'
  const r = resolveSeatMap('예술의전당 콘서트홀', seat({ floor: 2, block: 'A', row: 1, number: 5 }));
  assert.equal(r.placement!.approx, true);
  assert.ok(r.message.startsWith('≈'), r.message);

  // 롯데 1층 C 는 confirmed
  const ok = resolveSeatMap('롯데콘서트홀', seat({ floor: 1, block: 'C', row: 3, number: 5 }));
  assert.equal(ok.placement!.approx, false);
  assert.ok(!ok.message.startsWith('≈'), ok.message);
});

test('approx 는 언제나 geometryConfidence 와 일치한다', () => {
  for (const p of Object.values(VENUES)) {
    for (const { label, s } of sweepSeats(p)) {
      const pl = seatToZone(p, s)!;
      assert.equal(pl.approx, pl.geometryConfidence !== 'confirmed', label);
    }
  }
});

test('bandOf 경계', () => {
  assert.equal(bandOf(0), 'front');
  assert.equal(bandOf(0.32), 'front');
  assert.equal(bandOf(1 / 3), 'mid');
  assert.equal(bandOf(0.66), 'mid');
  assert.equal(bandOf(2 / 3), 'rear');
  assert.equal(bandOf(1), 'rear');
  assert.equal(bandOf(-5), 'front');
  assert.equal(bandOf(9), 'rear');
});

test('pickScale 은 정수 배율만 돌려준다', () => {
  assert.equal(pickScale(200), 1);
  assert.equal(pickScale(256), 2);
  assert.equal(pickScale(600), 4);
});

/* ------------------------------------------------------------------ *
 * 실데이터 (testdata/eval/ground_truth.json) — 읽기 전용
 * ------------------------------------------------------------------ */

const GT_PATH = path.resolve(import.meta.dirname, '../../../testdata/eval/ground_truth.json');

test('실데이터 정답지 17건이 기대한 status 로 떨어진다', (t) => {
  if (!fs.existsSync(GT_PATH)) return t.skip('ground_truth.json 없음');
  const gt = JSON.parse(fs.readFileSync(GT_PATH, 'utf8')) as {
    items: { truth: { venue: string; seat: Record<string, unknown> | null } }[];
  };

  let drawn = 0;
  let refused = 0;
  for (const it of gt.items) {
    const t0 = it.truth;
    const raw = t0.seat ?? {};
    const s = seat({
      floor: typeof raw.floor === 'number' ? raw.floor : null,
      block: typeof raw.block === 'string' ? raw.block : null,
      row: typeof raw.row === 'number' ? raw.row : null,
      number: typeof raw.number === 'number' ? raw.number : null,
    });
    const r = resolveSeatMap(t0.venue, s);

    if (/토월|세종/.test(t0.venue)) {
      assert.equal(r.status, 'unsupported-venue', `${t0.venue}: 그리면 안 된다`);
      assert.equal(r.placement, null);
      refused++;
    } else {
      assert.notEqual(r.status, 'unsupported-venue', t0.venue);
      assert.ok(r.plan, t0.venue);
      if (r.placement) {
        assert.ok(cellInsideCanvas(r.placement.cell), `${t0.venue} ${JSON.stringify(raw)}`);
        drawn++;
      }
    }
  }
  assert.ok(drawn >= 9, `아바타를 그린 건이 너무 적다: ${drawn}`);
  assert.ok(refused >= 5, `거절한 건이 너무 적다: ${refused}`);
});
