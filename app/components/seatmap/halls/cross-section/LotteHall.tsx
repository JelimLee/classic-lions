/**
 * LotteHall.tsx — 롯데콘서트홀 단면 실루엣 (설계문서 §2-1)
 *
 * 이 홀의 정체성: **무대가 홀 한가운데 있는 빈야드**.
 *   - 종단면이 무대를 기준으로 좌우로 갈라진다 (왼쪽 = 무대 뒤 합창석, 오른쪽 = 객석).
 *   - 낮고 **넓다**. 가로로 퍼진다.
 *   - 화면 왼쪽 위를 **파이프오르간 파사드**가 채운다. 이게 없으면 롯데 단면이
 *     "그냥 객석"이 된다 (공식 배치도에도 PIPE ORGAN 이 따로 표기돼 있다).
 *   - 2층은 하나의 층이 아니라 긴 측면 발코니(L/R)와 뒤 발코니(A~E) 두 덩어리다.
 *
 * ⚠️ 예당(SacHall)과 그림을 공유하지 않는다. 같은 그림 재탕이면 두 홀이
 *    다르게 보여야 한다는 요구사항 자체가 무너진다.
 */

import React from 'react';
import { ART_H, ART_W, HALLS } from '../../../../services/crossSectionGeometry.ts';
import { Bank, C, Ground, Stage } from './crossSectionArt.tsx';

const HALL = HALLS['lotte-concert-hall'];

/** 오르간 파사드 파이프 — 높이를 들쭉날쭉하게 (x, 파이프 상단 y) */
const PIPES: Array<[number, number]> = [
  [9, 14], [12, 10], [15, 12], [18, 8], [21, 9],
  [24, 8], [27, 11], [30, 10], [33, 13], [36, 15],
];

export const LotteHall: React.FC<{ activeBlock?: string | null; activeFloor?: number | null }> = ({
  activeBlock = null,
  activeFloor = null,
}) => {
  const isActive = (code: string, floor: number) =>
    activeBlock != null && activeFloor === floor && code === activeBlock;

  return (
    <g>
      {/* ── 홀 껍데기: 낮고 넓은 천장 ── */}
      <path
        d="M2 30 L2 18 L26 6 L134 6 L158 20 L158 34"
        fill="none"
        stroke={C.wall}
        strokeWidth={1}
        shapeRendering="crispEdges"
      />
      <rect x={0} y={0} width={ART_W} height={4} fill={C.wall} shapeRendering="crispEdges" />

      {/* ── 파이프오르간 파사드 (x 8..40, y 8..30). 롯데에만 있다 ── */}
      <g shapeRendering="crispEdges">
        <rect x={8} y={8} width={32} height={22} fill="#1c110a" stroke={C.wallLit} strokeWidth={1} />
        {PIPES.map(([x, top]) => (
          <g key={x}>
            <rect x={x} y={top} width={2} height={30 - top} fill={C.organ} />
            <rect x={x} y={top} width={2} height={1} fill={C.organLit} />
          </g>
        ))}
        <rect x={8} y={29} width={32} height={1} fill={C.organLit} />
      </g>

      {/* 홀 뒷벽 (무대 뒤쪽 끝) */}
      <rect x={4} y={20} width={1} height={64} fill={C.wall} shapeRendering="crispEdges" />

      <Ground floorY={HALL.floorLineY} baseY={HALL.baseY} width={ART_W} height={ART_H} />
      <Stage rect={HALL.stage} />

      {/* ── 좌석단: 앵커 표에서 그대로 파생 ── */}
      {HALL.anchors.map((an) => (
        <Bank
          key={`${an.floor}-${an.code}-${an.side}`}
          anchor={an}
          body={an.floor === 2 ? 4 : 5}
          maxY={an.floor === 1 ? HALL.floorLineY : undefined}
          active={isActive(an.code, an.floor)}
        />
      ))}

      {/* 2층 발코니 앞면 — "떠 있는 단"으로 읽히게 밑에 얇은 판을 붙인다 */}
      <g shapeRendering="crispEdges" opacity={0.75}>
        <rect x={124} y={49} width={32} height={1} fill={C.wallLit} />
        <rect x={124} y={49} width={1} height={4} fill={C.wallLit} />
      </g>

      {/* 층 라벨 */}
      <g fontFamily="ui-monospace, monospace" fontSize="5" fill={C.dim} opacity={0.75}>
        <text x={9} y={96}>1F</text>
        <text x={9} y={44}>2F</text>
      </g>
    </g>
  );
};

export default LotteHall;
