/**
 * planArt.tsx — 위에서 본 좌석표(top-down)가 공유하는 픽셀아트 부품
 *
 * ⚠️ 칸(cell)은 **seatGeometry.ts 의 FloorPlan 에서 그대로 받는다.**
 *    여기서 좌표를 다시 만들지 않는다. 그림과 좌표가 따로 놀면 아바타가
 *    칸 밖에 앉는다. 같은 표를 쓰면 그게 구조적으로 불가능하다.
 */

import React from 'react';
import type { Cell } from '../../services/seatGeometry.ts';

export const C = {
  bg: '#120a06',
  wall: '#3e271c',
  wallLit: '#5a3a28',
  seat: '#6d472a',
  seatLit: '#a8763c',
  seatHot: '#fbbf24',
  cellFill: '#1b100a',
  cellFillHot: '#3a2205',
  stage: '#2b1a12',
  stageTop: '#d97706',
  void: '#170d08',
  accent: '#f59e0b',
  dim: '#a3733f',
  ink: '#e7c98f',
};

/** 좌석 한 칸의 크기와 간격 (아트 픽셀) */
const SEAT_PX = 2;
const PITCH = 3;
/** 이름표 띠 높이. CellTag 와 SeatCluster 가 같이 쓴다. */
const LABEL_H = 9;

export type SeatPattern = 'straight' | 'fan' | 'stagger';

/**
 * 한 존(9격자 중 하나)을 좌석 덩어리로 채운다.
 *
 * pattern
 *   straight — 격자 그대로 (발코니·박스)
 *   fan      — 뒤로 갈수록 한 줄이 넓어진다 (예당 1층 부채꼴)
 *   stagger  — 한 줄 걸러 반 칸 밀린다 (롯데 빈야드 단)
 */
export const SeatCluster: React.FC<{
  cell: Cell;
  active?: boolean;
  pattern?: SeatPattern;
  /** 좌석이 없는 칸 (예: 2층 중앙 = 1층 위 허공) */
  empty?: boolean;
  /** 층 전체 강조 중이라 살짝 밝게 */
  dim?: boolean;
  /** 위쪽에 이름표 자리를 비워둔다 (CellTag 와 짝) */
  labelStrip?: boolean;
}> = ({
  cell,
  active = false,
  pattern = 'straight',
  empty = false,
  dim = false,
  labelStrip = false,
}) => {
  if (empty) {
    return (
      <g shapeRendering="crispEdges">
        <rect
          x={cell.x}
          y={cell.y}
          width={cell.w}
          height={cell.h}
          fill={C.void}
          stroke={C.wall}
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.7}
        />
      </g>
    );
  }

  const pad = 2;
  const padTop = labelStrip ? LABEL_H : pad;
  const innerX = cell.x + pad;
  const innerY = cell.y + padTop;
  const innerW = cell.w - pad * 2;
  const innerH = cell.h - padTop - pad;
  const rows = Math.max(1, Math.floor((innerH + 1) / PITCH));

  const dots: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const rt = rows <= 1 ? 0 : r / (rows - 1);
    // fan: 앞줄은 좁고 뒷줄이 넓다 (무대에서 멀어질수록 벌어진다)
    const rowW = pattern === 'fan' ? Math.round(innerW * (0.72 + 0.28 * rt)) : innerW;
    const cols = Math.max(1, Math.floor((rowW + 1) / PITCH));
    const used = cols * PITCH - 1;
    const x0 = Math.round(innerX + (innerW - used) / 2);
    const shift = pattern === 'stagger' && r % 2 === 1 ? 1 : 0;
    const y = innerY + r * PITCH;
    for (let c = 0; c < cols; c++) {
      dots.push(
        <rect
          key={`${r}-${c}`}
          x={x0 + c * PITCH + shift}
          y={y}
          width={SEAT_PX}
          height={SEAT_PX}
        />,
      );
    }
  }

  return (
    <g shapeRendering="crispEdges">
      <rect
        x={cell.x}
        y={cell.y}
        width={cell.w}
        height={cell.h}
        fill={active ? C.cellFillHot : C.cellFill}
        stroke={active ? C.accent : 'none'}
        strokeWidth={active ? 1 : 0}
      />
      <g fill={active ? C.seatHot : dim ? C.seatLit : C.seat} opacity={active ? 1 : dim ? 0.85 : 0.72}>
        {dots}
      </g>
    </g>
  );
};

/** 무대. 그 층에 무대가 없으면(위층에서 내려다보는 중) 흐리게 그린다. */
export const StageBox: React.FC<{ rect: Cell; muted?: boolean; label?: string }> = ({
  rect,
  muted = false,
  label = 'STAGE',
}) => (
  <g shapeRendering="crispEdges" opacity={muted ? 0.45 : 1}>
    <rect
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      fill={C.stage}
      stroke={muted ? C.wall : C.stageTop}
      strokeWidth={1}
      strokeDasharray={muted ? '3 2' : undefined}
    />
    {!muted && <rect x={rect.x} y={rect.y + rect.h - 2} width={rect.w} height={2} fill={C.stageTop} />}
    <text
      x={rect.x + rect.w / 2}
      y={rect.y + rect.h / 2 + 2}
      textAnchor="middle"
      fontSize="6"
      fill={muted ? C.dim : C.ink}
      fontFamily="ui-monospace, monospace"
      letterSpacing="0.6"
    >
      {label}
    </text>
  </g>
);

/** 홀 외곽선 */
export const Outline: React.FC<{ d: string }> = ({ d }) => (
  <path d={d} fill="none" stroke={C.wallLit} strokeWidth={1} shapeRendering="crispEdges" />
);

/**
 * 칸 이름표. SeatCluster 가 labelStrip 으로 비워둔 위쪽 띠에 앉는다.
 * (좌석 점 위에 그냥 얹으면 6px 한글이 점과 뒤엉켜 안 읽힌다.)
 */
export const CellTag: React.FC<{ cell: Cell; text: string; active?: boolean }> = ({
  cell,
  text,
  active = false,
}) => (
  <g shapeRendering="crispEdges">
    <rect
      x={cell.x + 1}
      y={cell.y + 1}
      width={cell.w - 2}
      height={LABEL_H - 2}
      fill={C.bg}
      opacity={0.85}
    />
    <text
      x={cell.x + 2}
      y={cell.y + 7}
      fontSize="6"
      fill={active ? C.accent : C.dim}
      opacity={active ? 1 : 0.75}
      fontFamily="ui-monospace, monospace"
      letterSpacing="0.4"
    >
      {text}
    </text>
  </g>
);

export default SeatCluster;
