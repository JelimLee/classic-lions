/**
 * SacHall.tsx — 예술의전당 콘서트홀 **위에서 본 평면도** (top-down)
 *
 * 근거: docs/seatmaps/sac_official_1f.jpg / sac_official_2f3f.jpg
 *       (+ docs/seatmaps/sac_official_ConcertHallSeatingPlan_2021.xls — 셀 하나 = 좌석 하나)
 *   무대가 홀 **한쪽 끝**에 있고 객석이 한 방향으로 부채꼴로 펼쳐진다.
 *   1층: 무대 뒤·옆에 합창석 G·H·F, 무대 앞으로 A~E 부채꼴(1~22열).
 *   2·3층: 옆·뒤를 감싸는 말굽 발코니 + 무대 양옆 BOX.
 *          가운데 앞·중간은 1층 위 허공이라 좌석이 없다.
 *
 * ⚠️ 칸 좌표는 전부 seatGeometry.ts 의 FloorPlan 에서 온다. 여기서 안 만든다.
 */

import React from 'react';
import {
  ART_H,
  ART_W,
  GRID_ZONES,
  PLANS,
  occupiedZones,
} from '../../../services/seatGeometry.ts';
import type { Zone } from '../../../services/seatGeometry.ts';
import { C, CellTag, Outline, SeatCluster, StageBox } from '../planArt.tsx';
import type { HallProps } from './LotteHall.tsx';

const VENUE_ID = 'sac-concert-hall';

const TAG: Record<string, string> = {
  'front-left': '앞좌', 'front-center': '앞중', 'front-right': '앞우',
  'mid-left': '중좌', 'mid-center': '중중', 'mid-right': '중우',
  'rear-left': '뒤좌', 'rear-center': '뒤중', 'rear-right': '뒤우',
};

/**
 * 2·3층 무대 양옆 BOX — 무대 옆구리에 계단식으로 붙는다 (sac_official_2f3f.jpg).
 * ⚠️ 9격자 칸과 겹치면 안 된다. 그래서 무대와 같은 높이 띠(앞칸이 시작되기 전)
 *    에만 그린다. BOX 좌석 자체는 존 표에서 front-left / front-right 로 간다.
 */
const BOXES: Record<number, { x: number; y: number; label: string }[]> = {
  2: [
    { x: 4, y: 4, label: 'BOX1' }, { x: 8, y: 12, label: 'BOX2' }, { x: 12, y: 20, label: 'BOX3' },
    { x: 110, y: 4, label: 'BOX6' }, { x: 106, y: 12, label: 'BOX5' }, { x: 102, y: 20, label: 'BOX4' },
  ],
  3: [
    { x: 4, y: 4, label: 'BOX7' }, { x: 7, y: 11, label: 'BOX8' }, { x: 10, y: 18, label: 'BOX9' },
    { x: 110, y: 4, label: 'BOX12' }, { x: 107, y: 11, label: 'BOX11' }, { x: 104, y: 18, label: 'BOX10' },
  ],
};

export const SacHall: React.FC<HallProps> = ({ floor, activeZone, floorOnly = false }) => {
  const fp = PLANS[VENUE_ID].floors[floor];
  if (!fp) return null;
  const live = occupiedZones(VENUE_ID, floor);

  return (
    <g>
      <rect x={0} y={0} width={ART_W} height={ART_H} fill={C.bg} />
      <Outline d={fp.outline} />

      {/* 파이프오르간 — 합창석 뒤 벽면. 롯데와 마찬가지로 이 홀의 표식이다.
          1층에만 그린다 (2·3층 평면도에는 무대 뒤가 안 잡힌다).
          ⚠ 예당은 합창석 띠가 y=6 부터라 롯데(y=14)보다 위쪽 여백이 좁다.
          파이프를 y 0..5 안에 넣어 띠를 침범하지 않게 한다. */}
      {floor === 1 && (
        <g shapeRendering="crispEdges">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect
              key={i}
              x={45 + i * 6}
              y={i % 2}
              width={4}
              height={5 - (i % 2)}
              fill={C.wallLit}
            />
          ))}
        </g>
      )}

      {/* 무대 뒤 합창석 (9격자 밖) — 1층에만 있다 */}
      {fp.behindStage && (
        <>
          <SeatCluster
            cell={fp.behindStage}
            pattern="straight"
            labelStrip
            active={activeZone === 'behind-stage'}
            dim={floorOnly}
          />
          <CellTag
            cell={fp.behindStage}
            text="무대 뒤 합창석"
            active={activeZone === 'behind-stage'}
          />
        </>
      )}

      <StageBox rect={fp.stage} muted={!fp.stageOnThisFloor} />

      {/* 무대 양옆 BOX (2·3층). 어느 BOX 인지까지는 강조하지 않는다 —
          BOX 는 열 번호 체계를 확인 못 해서 존이 앞좌/앞우까지만 확정된다. */}
      {(BOXES[floor] ?? []).map((b) => (
        <g key={b.label} shapeRendering="crispEdges">
          <rect x={b.x} y={b.y} width={14} height={6} fill={C.cellFill} stroke={C.wall} strokeWidth={1} />
          <rect x={b.x + 2} y={b.y + 2} width={2} height={2} fill={C.seat} />
          <rect x={b.x + 6} y={b.y + 2} width={2} height={2} fill={C.seat} />
          <rect x={b.x + 10} y={b.y + 2} width={2} height={2} fill={C.seat} />
        </g>
      ))}

      {/* 9격자 — 예당 1층은 뒤로 갈수록 벌어지는 부채꼴이라 fan 패턴 */}
      {GRID_ZONES.map((z) => (
        <React.Fragment key={z}>
          <SeatCluster
            cell={fp.cells[z]}
            pattern={floor === 1 ? 'fan' : 'straight'}
            labelStrip={live.has(z)}
            active={activeZone === z}
            empty={!live.has(z)}
            dim={floorOnly}
          />
          {live.has(z) && <CellTag cell={fp.cells[z]} text={TAG[z]} active={activeZone === z} />}
        </React.Fragment>
      ))}

      {floorOnly && (
        <rect
          x={fp.bounds.x}
          y={fp.bounds.y}
          width={fp.bounds.w}
          height={fp.bounds.h}
          fill={C.accent}
          opacity={0.08}
          stroke={C.accent}
          strokeOpacity={0.4}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      )}
    </g>
  );
};

export default SacHall;
