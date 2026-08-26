/**
 * SacHall.tsx — 예술의전당 콘서트홀 단면 실루엣 (설계문서 §2-2)
 *
 * 이 홀의 정체성: **한쪽 끝에 3단이 쌓인 아레나형 부채꼴**.
 *   - 무대가 홀 끝(왼쪽)에 있고 객석이 한 방향으로만 펼쳐진다.
 *   - 롯데가 가로로 퍼진다면 예당은 **세로로 쌓인다** — 뒤쪽에서 3층이 수직으로
 *     겹치며 높아진다. 그래서 천장이 높고 실루엣이 비대칭이다.
 *   - 오르간 파사드가 없다. 그 자리는 비어 있고, 대신 무대 위에 **음향 반사판**과
 *     무대 양옆에 뜬 **BOX 12개**가 이 홀의 표지다.
 *   - 3층 맨 뒤에 M/N 이 한 칸 더 얹힌다.
 */

import React from 'react';
import { ART_H, ART_W, HALLS } from '../../../../services/crossSectionGeometry.ts';
import { Bank, C, Ground, Stage } from './crossSectionArt.tsx';

const HALL = HALLS['sac-concert-hall'];

export const SacHall: React.FC<{ activeBlock?: string | null; activeFloor?: number | null }> = ({
  activeBlock = null,
  activeFloor = null,
}) => {
  const isActive = (code: string, floor: number) =>
    activeBlock != null && activeFloor === floor && code === activeBlock;

  return (
    <g>
      {/* ── 홀 껍데기: 무대 쪽이 아주 높고 객석 뒤로 갈수록 천장이 내려온다 ── */}
      <path
        d="M2 88 L2 10 L60 6 L150 12 L158 26 L158 44"
        fill="none"
        stroke={C.wall}
        strokeWidth={1}
        shapeRendering="crispEdges"
      />
      <rect x={0} y={0} width={ART_W} height={4} fill={C.wall} shapeRendering="crispEdges" />

      {/* 무대 쪽 높은 벽면 (롯데의 오르간 자리에 해당하지만 예당은 비어 있다) */}
      <rect x={2} y={10} width={4} height={78} fill="#1c110a" shapeRendering="crispEdges" />

      {/* ── 무대 위 음향 반사판 (예당의 표지) ── */}
      <g shapeRendering="crispEdges">
        <rect x={18} y={60} width={46} height={3} fill={C.organ} />
        <rect x={18} y={60} width={46} height={1} fill={C.organLit} />
        {[24, 32, 40, 48, 56].map((x) => (
          <rect key={x} x={x} y={63} width={1} height={3} fill={C.wallLit} />
        ))}
      </g>

      <Ground floorY={HALL.floorLineY} baseY={HALL.baseY} width={ART_W} height={ART_H} />
      <Stage rect={HALL.stage} />

      {/* ── 3단이 "쌓인" 느낌: 발코니 앞면 판 3개 ── */}
      <g shapeRendering="crispEdges" opacity={0.8}>
        {/* 2층 발코니 앞면 */}
        <rect x={94} y={59} width={44} height={1} fill={C.wallLit} />
        <rect x={94} y={55} width={1} height={5} fill={C.wallLit} />
        {/* 3층 발코니 앞면 */}
        <rect x={98} y={35} width={40} height={1} fill={C.wallLit} />
        <rect x={98} y={31} width={1} height={5} fill={C.wallLit} />
        {/* 3층 맨 뒤 M/N 단 */}
        <rect x={138} y={26} width={18} height={1} fill={C.wallLit} />
      </g>

      {/* ── 좌석단: 앵커 표에서 그대로 파생 ── */}
      {HALL.anchors.map((an) => (
        <Bank
          key={`${an.floor}-${an.code}-${an.side}`}
          anchor={an}
          body={an.floor === 1 ? 5 : 4}
          maxY={an.floor === 1 ? HALL.floorLineY : undefined}
          active={isActive(an.code, an.floor)}
        />
      ))}

      {/* 층 라벨 */}
      <g fontFamily="ui-monospace, monospace" fontSize="5" fill={C.dim} opacity={0.75}>
        <text x={148} y={84}>1F</text>
        <text x={148} y={60}>2F</text>
        <text x={148} y={36}>3F</text>
      </g>
    </g>
  );
};

export default SacHall;
