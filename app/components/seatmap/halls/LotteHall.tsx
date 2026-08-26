/**
 * LotteHall.tsx — 롯데콘서트홀 **위에서 본 평면도** (top-down)
 *
 * 근거: docs/seatmaps/lotte_1f.png / lotte_2f.png (공식 좌석배치도 원본)
 *   빈야드 — 무대가 홀 **한가운데**에 있고 객석이 그 둘레를 감싼다.
 *   1층: 무대 위쪽(뒤)에 P·LP·RP 합창석, 아래쪽에 A~E 정면 객석,
 *        무대 좌우에 L·R 측면 터레이스.
 *   2층: 무대 옆을 따라 흐르는 긴 발코니 L·R + 맨 뒤 발코니 A~E.
 *        2층 중앙은 1층 위 허공이라 좌석이 없다.
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

const VENUE_ID = 'lotte-concert-hall';

/** 9칸 한글 약칭 — 격자라는 걸 눈으로 읽히게 한다 */
const TAG: Record<string, string> = {
  'front-left': '앞좌', 'front-center': '앞중', 'front-right': '앞우',
  'mid-left': '중좌', 'mid-center': '중중', 'mid-right': '중우',
  'rear-left': '뒤좌', 'rear-center': '뒤중', 'rear-right': '뒤우',
};

export interface HallProps {
  floor: number;
  activeZone: Zone | null;
  /** precision === 'floor' — 어느 칸인지 모른다 */
  floorOnly?: boolean;
}

export const LotteHall: React.FC<HallProps> = ({ floor, activeZone, floorOnly = false }) => {
  const fp = PLANS[VENUE_ID].floors[floor];
  if (!fp) return null;
  const live = occupiedZones(VENUE_ID, floor);

  return (
    <g>
      <rect x={0} y={0} width={ART_W} height={ART_H} fill={C.bg} />
      <Outline d={fp.outline} />

      {/* 파이프오르간 — 롯데 평면도의 가장 알아보기 쉬운 표식 (맨 위 가운데) */}
      <g shapeRendering="crispEdges">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <rect key={i} x={44 + i * 6} y={4 - (i % 2)} width={4} height={6 + (i % 2)} fill={C.wallLit} />
        ))}
      </g>

      {/* 무대 뒤 합창석 (9격자 밖) */}
      {fp.behindStage && (
        <>
          <SeatCluster
            cell={fp.behindStage}
            pattern="stagger"
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

      {/* 9격자 */}
      {GRID_ZONES.map((z) => (
        <React.Fragment key={z}>
          <SeatCluster
            cell={fp.cells[z]}
            pattern="stagger"
            labelStrip={live.has(z)}
            active={activeZone === z}
            empty={!live.has(z)}
            dim={floorOnly}
          />
          {live.has(z) && <CellTag cell={fp.cells[z]} text={TAG[z]} active={activeZone === z} />}
        </React.Fragment>
      ))}

      {/* 층 전체 강조 (어느 칸인지 모를 때) */}
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

export default LotteHall;
