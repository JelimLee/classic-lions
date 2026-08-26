/**
 * SeatMapPreview.tsx — 좌석표 QA 페이지 (`/#/seatmap`)
 *
 * 네비게이션에는 넣지 않는다. "눈으로" 검증을 사람이 한 화면에서 하려고 만든
 * 페이지다. 실제 정답지(testdata/eval/ground_truth.json)에 있는 좌석 문자열을
 * 그대로 쓴다 — 데모용으로 지어낸 좌석이 아니다.
 */

import React from 'react';
import { SeatMap } from './SeatMap.tsx';
import type { ParsedSeat } from '../../types';
import { loadAvatar } from '../../services/storage';
import { resolveSeatMap, zoneLabel } from '../../services/seatGeometry.ts';

const s = (o: Partial<ParsedSeat>): ParsedSeat => ({
  floor: null, block: null, row: null, number: null,
  grade: null, raw: '', confidence: 1, ...o,
});

interface Case { note: string; venue: string; seat: ParsedSeat | null }

/** ★ = testdata/eval/ground_truth.json 에 실제로 있는 좌석 */
const LOTTE_CASES: Case[] = [
  { note: '★ 객석 1층 B구역 15열 01번', venue: '롯데콘서트홀', seat: s({ floor: 1, block: 'B', row: 15, number: 1 }) },
  { note: '★ 객석1층 C구역 08열 01번', venue: '롯데콘서트홀', seat: s({ floor: 1, block: 'C', row: 8, number: 1 }) },
  { note: '★ 객석 1층 D구역 03열 07번', venue: '롯데콘서트홀', seat: s({ floor: 1, block: 'D', row: 3, number: 7 }) },
  { note: '★ 객석1층 R구역 01열 12번 — 측면 터레이스, 좌석번호가 깊이', venue: '롯데콘서트홀', seat: s({ floor: 1, block: 'R', row: 1, number: 12 }) },
  { note: '★ 객석 1층 R구역 04열 11번', venue: '롯데콘서트홀', seat: s({ floor: 1, block: 'R', row: 4, number: 11 }) },
  { note: '1층 P구역 4열 10번 — 무대 뒤 합창석 (9격자 밖)', venue: '롯데콘서트홀', seat: s({ floor: 1, block: 'P', row: 4, number: 10 }) },
  { note: '2층 L구역 1열 30번 — 긴 측면 발코니 (번호가 커지면 뒤로)', venue: '롯데콘서트홀', seat: s({ floor: 2, block: 'L', row: 1, number: 30 }) },
  { note: '2층 C구역 6열 5번 — 뒤 발코니', venue: '롯데콘서트홀', seat: s({ floor: 2, block: 'C', row: 6, number: 5 }) },
  { note: '1층 B구역 17열 — ⚠️ 없는 열 (8·16·17·18)', venue: '롯데콘서트홀', seat: s({ floor: 1, block: 'B', row: 17, number: 5 }) },
  { note: '★ 롯데콘서트홀 표준좌석 → 아바타 없음', venue: '롯데콘서트홀', seat: null },
];

const SAC_CASES: Case[] = [
  { note: '★ 1층 A블록 15열 10번', venue: '예술의전당 콘서트홀', seat: s({ floor: 1, block: 'A', row: 15, number: 10 }) },
  { note: '★ 1층 D블록 10열 1번', venue: '예술의전당 콘서트홀', seat: s({ floor: 1, block: 'D', row: 10, number: 1 }) },
  { note: '★ 3층 E블록 6열 1번', venue: '예술의전당 콘서트홀', seat: s({ floor: 3, block: 'E', row: 6, number: 1 }) },
  { note: '★ 3층 B블록 4열 6번 — rowMin=4', venue: '예술의전당 콘서트홀', seat: s({ floor: 3, block: 'B', row: 4, number: 6 }) },
  { note: '2층 A블록 3열 1번 — 왼팔 away (무대 쪽)', venue: '예술의전당 콘서트홀', seat: s({ floor: 2, block: 'A', row: 3, number: 1 }) },
  { note: '2층 E블록 3열 1번 — 오른팔 toward (뒤쪽!)', venue: '예술의전당 콘서트홀', seat: s({ floor: 2, block: 'E', row: 3, number: 1 }) },
  { note: '1층 G블록 2열 5번 — 무대 뒤 합창석 (9격자 밖)', venue: '예술의전당 콘서트홀', seat: s({ floor: 1, block: 'G', row: 2, number: 5 }) },
  { note: '2층 BOX2 — 열 체계 미확인 → block', venue: '예술의전당 콘서트홀', seat: s({ floor: 2, block: 'BOX2' }) },
  { note: '★ 1층 E블록 (불완전) → block', venue: '예술의전당 콘서트홀', seat: s({ floor: 1, block: 'E' }) },
  { note: '★ 1층 (불완전) → floor', venue: '예술의전당 콘서트홀', seat: s({ floor: 1 }) },
];

const UNSUPPORTED: Case[] = [
  { note: '★ 예술의전당 CJ 토월극장 → 안 그린다', venue: '예술의전당 CJ 토월극장', seat: s({ floor: 1, block: 'B' }) },
  { note: '★ 세종문화회관 대극장 → 안 그린다', venue: '세종문화회관 대극장', seat: s({ floor: 1, number: 191 }) },
];

const Row: React.FC<{ c: Case; avatar: ReturnType<typeof loadAvatar>['config'] }> = ({ c, avatar }) => {
  const r = resolveSeatMap(c.venue, c.seat);
  return (
    <div className="rounded-2xl border border-[#3e271c] bg-[#1a0f0a] p-3">
      <p className="mb-1 text-[11px] font-medium text-amber-200/50">{c.note}</p>
      <p className="mb-2 font-mono text-[10px] text-amber-200/30">
        {r.status}
        {r.placement && ` · ${r.placement.precision} · ${r.placement.zone ?? '층 전체'}`}
        {r.placement?.zone && ` (${zoneLabel(r.placement.zone)})`}
      </p>
      <SeatMap venue={c.venue} seat={c.seat} avatarConfig={avatar} scale={2} showTabs={false} />
    </div>
  );
};

export const SeatMapPreview: React.FC = () => {
  const avatar = React.useMemo(() => loadAvatar().config, []);
  return (
    <div className="space-y-8">
      <header>
        <h2 className="serif text-3xl font-bold text-amber-500">좌석표 QA (위에서 본 9격자)</h2>
        <p className="mt-1 text-sm text-amber-100/40">
          각 층을 앞/중/뒤 × 좌/중/우 9칸으로 나눈다. 무대 뒤 합창석은 격자 밖 별도 존.
          ★ 는 testdata/eval/ground_truth.json 의 실제 좌석. 네비게이션에는 없는 페이지입니다.
        </p>
      </header>

      <section>
        <h3 className="serif mb-3 text-xl font-bold text-amber-400">
          롯데콘서트홀 — 무대를 둘러싼 빈야드
        </h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {LOTTE_CASES.map((c) => <Row key={c.note} c={c} avatar={avatar} />)}
        </div>
      </section>

      <section>
        <h3 className="serif mb-3 text-xl font-bold text-amber-400">
          예술의전당 콘서트홀 — 무대 앞 부채꼴 + 말굽 발코니
        </h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {SAC_CASES.map((c) => <Row key={c.note} c={c} avatar={avatar} />)}
        </div>
      </section>

      <section>
        <h3 className="serif mb-3 text-xl font-bold text-amber-400">
          탭 확인 — 좌석표 / 이 자리에서 본 무대
        </h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {(['map', 'view'] as const).map((t) => (
            <div key={t} className="rounded-2xl border border-[#3e271c] bg-[#1a0f0a] p-3">
              <p className="mb-2 font-mono text-[10px] text-amber-200/30">defaultTab={t}</p>
              <SeatMap
                venue="롯데콘서트홀"
                seat={s({ floor: 1, block: 'B', row: 15, number: 1 })}
                avatarConfig={avatar}
                scale={2}
                defaultTab={t}
              />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="serif mb-3 text-xl font-bold text-amber-400">지원 안 하는 홀</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {UNSUPPORTED.map((c) => <Row key={c.note} c={c} avatar={avatar} />)}
        </div>
      </section>
    </div>
  );
};

export default SeatMapPreview;
