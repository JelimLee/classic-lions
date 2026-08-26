/**
 * hallArt.tsx — 두 홀이 공유하는 단면도 그리기 부품
 *
 * 사양: docs/SEATMAP_geometry.md §2 (실루엣) · §3-b (절단면 밖 = 해칭)
 *
 * ⚠️ 좌석단(bank)은 **앵커 표에서 파생**시킨다. 손으로 다시 그리지 않는다.
 *    그림과 좌표가 따로 놀면 아바타가 단 밖에 앉는다. 여기서는 그게 구조적으로
 *    불가능하다 — 아바타도 단도 같은 near/far 선분을 쓴다.
 */

import React from 'react';
import type { BlockAnchor, Rect } from '../../../../services/crossSectionGeometry.ts';

export const C = {
  bg: '#120a06',
  wall: '#3e271c',
  wallLit: '#5a3a28',
  bank: '#7a4f2c',
  bankTop: '#a8763c',
  bankFolded: '#5f3f26',
  stage: '#2b1a12',
  stageTop: '#d97706',
  organ: '#8a6234',
  organLit: '#c08a4a',
  floorLine: '#4a2f20',
  accent: '#f59e0b',
  dim: '#a3733f',
};

/** 45° 해칭 — 절단면 밖(접힌) 블록 전용 (§3-b) */
export const HatchDefs: React.FC = () => (
  <defs>
    <pattern id="sm-hatch" width="4" height="4" patternUnits="userSpaceOnUse">
      <path d="M0 4 L4 0" stroke={C.bankFolded} strokeWidth="1" shapeRendering="crispEdges" />
    </pattern>
    <pattern id="sm-hatch-hot" width="4" height="4" patternUnits="userSpaceOnUse">
      <path d="M0 4 L4 0" stroke={C.accent} strokeWidth="1" shapeRendering="crispEdges" />
    </pattern>
  </defs>
);

/**
 * 좌석단 하나. near→far 선분 위를 계단으로 채운다.
 *
 * folded=true 면 1px 외곽선 + 해칭 + 60% 밝기로 그린다. "반투명하게 접혀 있다"는
 * 시각 문법이 생기면 사용자는 자기가 벽 쪽 단에 앉았다는 걸 오히려 더 잘 안다.
 */
export const Bank: React.FC<{
  anchor: BlockAnchor;
  /** 단의 두께 (아래로 몇 px) */
  body?: number;
  /** 이 블록이 지금 강조 대상인가 */
  active?: boolean;
  /** 단의 밑면이 넘어가면 안 되는 y (바닥선). 넘으면 잘라낸다. */
  maxY?: number;
}> = ({ anchor, body = 5, active = false, maxY }) => {
  const { near, far, folded } = anchor;
  const dx = far.x - near.x;
  const dy = far.y - near.y;
  const len = Math.hypot(dx, dy);

  // 점 앵커(BOX) — 계단이 아니라 작은 상자 하나
  if (len < 1) {
    return (
      <rect
        x={near.x - 3}
        y={near.y - 2}
        width={6}
        height={4}
        fill={active ? 'url(#sm-hatch-hot)' : 'url(#sm-hatch)'}
        stroke={active ? C.accent : C.wallLit}
        strokeWidth={1}
        opacity={active ? 1 : 0.6}
        shapeRendering="crispEdges"
      />
    );
  }

  const stepW = 4;
  const steps = Math.max(2, Math.round(len / stepW));
  const rects: React.ReactNode[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1 || 1);
    const x = Math.round(near.x + dx * t);
    const y = Math.round(near.y + dy * t);
    // 단이 바닥선을 뚫고 내려가면 "떠 있는 판"처럼 보인다 → 잘라낸다.
    const h = maxY == null ? body : Math.max(1, Math.min(body, maxY - y));
    rects.push(
      <rect
        key={i}
        x={dx >= 0 ? x : x - stepW}
        y={y}
        width={stepW}
        height={h}
        shapeRendering="crispEdges"
      />,
    );
  }

  if (folded) {
    return (
      <g opacity={active ? 1 : 0.6}>
        <g fill={active ? 'url(#sm-hatch-hot)' : 'url(#sm-hatch)'} stroke="none">
          {rects}
        </g>
        <line
          x1={near.x}
          y1={near.y}
          x2={far.x}
          y2={far.y}
          stroke={active ? C.accent : C.wallLit}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      </g>
    );
  }

  return (
    <g>
      <g fill={active ? C.bankTop : C.bank} stroke="none">
        {rects}
      </g>
      {/* 좌석 윗면 1px 하이라이트 — 단면이 "단"으로 읽히게 한다 */}
      <line
        x1={near.x}
        y1={near.y}
        x2={far.x}
        y2={far.y}
        stroke={active ? C.accent : C.bankTop}
        strokeWidth={1}
        shapeRendering="crispEdges"
      />
    </g>
  );
};

/** 무대 상자. 두 홀 다 같은 부품이지만 위치·크기가 다르다. */
export const Stage: React.FC<{ rect: Rect; label?: boolean }> = ({ rect, label = true }) => {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  return (
    <g shapeRendering="crispEdges">
      <rect x={rect.x0} y={rect.y0} width={w} height={h} fill={C.stage} stroke={C.wallLit} strokeWidth={1} />
      <rect x={rect.x0} y={rect.y0} width={w} height={2} fill={C.stageTop} />
      {label && (
        <text
          x={rect.x0 + w / 2}
          y={rect.y0 + h / 2 + 3}
          textAnchor="middle"
          fontSize="5"
          fill={C.dim}
          fontFamily="ui-monospace, monospace"
          letterSpacing="0.5"
        >
          STAGE
        </text>
      )}
    </g>
  );
};

/** 바닥선 + 베이스. 두 홀의 y 가 다르다. */
export const Ground: React.FC<{ floorY: number; baseY: number; width: number; height: number }> = ({
  floorY,
  baseY,
  width,
  height,
}) => (
  <g shapeRendering="crispEdges">
    <rect x={0} y={floorY} width={width} height={1} fill={C.floorLine} />
    <rect x={0} y={baseY} width={width} height={height - baseY} fill="#0b0603" />
    <rect x={0} y={baseY} width={width} height={1} fill={C.wall} />
  </g>
);
