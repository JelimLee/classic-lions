/**
 * CrossSectionMap.tsx — 【보관】 옆에서 본 단면도 뷰
 *
 * ⚠️ 현재 화면에 연결되어 있지 않다. 기본 좌석표는 위에서 본 평면도
 *    (components/seatmap/SeatMap.tsx + halls/{LotteHall,SacHall}.tsx) 다.
 *    이 폴더는 나중에 "세 번째 뷰"(단면)로 되살릴 때를 위해 통째로 남겨둔 것이고,
 *    좌표는 services/crossSectionGeometry.ts 가 계속 들고 있다.
 *
 * SeatMap.tsx — 티켓 좌석을 픽셀아트 공연장 단면도 위에 올린다.
 *
 * 사양: docs/SEATMAP_geometry.md
 *   §1 캔버스 160×104, 정수 배율만
 *   §3 절단면 밖은 해칭 / 좌우는 인셋 미니 평면도
 *   §6 precision 5단계 + 지원 안 하는 홀
 *
 * ─────────────────────────────────────────────────────────────────────
 * 이 컴포넌트는 좌표를 스스로 만들지 않는다. `resolveSeatMap()` 이 돌려준
 * status 로만 분기한다. 그래서 "모르는데 그럴듯하게 그리는" 경로가 없다.
 * ─────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedSeat } from '../../../../types';
import {
  ART_H,
  ART_W,
  pickScale,
  resolveSeatMap,
} from '../../../../services/crossSectionGeometry.ts';
import type { ArtScale, HallGeometry, Placement } from '../../../../services/crossSectionGeometry.ts';
import { C, HatchDefs } from './crossSectionArt.tsx';
import LotteHall from './LotteHall.tsx';
import SacHall from './SacHall.tsx';
import { SeatAvatar } from '../../AvatarSlot.tsx';
import type { AvatarConfig } from '../../../avatar/Avatar';

/* ------------------------------------------------------------------ *
 * 인셋 미니 평면도 (§3-c)
 * ------------------------------------------------------------------ *
 * 좌우(side-left / side-right)는 단면이 절대 표현하지 못한다. x 로 옮기면
 * 깊이가 거짓말이 된다. 그래서 좌우는 좌표에서 빼고 24×18 인셋으로 뺀다.
 *
 * 두 홀 다 **무대를 위**에 두는 공식 배치도 방향으로 그린다 (사용자가 아는 그림).
 */
interface InsetSpec {
  /** 인셋 좌상단 (겹치는 좌석단이 없는 자리를 홀마다 따로 골랐다) */
  origin: { x: number; y: number };
  /** 평면 윤곽 path (인셋 로컬 좌표 24×18) */
  outline: string;
  /** 무대 사각형 (인셋 로컬) */
  stage: { x: number; y: number; w: number; h: number };
  /** 단면 x → 깊이 0..1 로 환산할 때 쓰는 도달 거리 */
  reachFront: number;
  reachBehind: number;
}

const INSETS: Record<string, InsetSpec> = {
  // 롯데: 무대가 한가운데인 빈야드 → 팔각형 링, 무대가 중앙
  'lotte-concert-hall': {
    origin: { x: 132, y: 4 },
    outline: 'M7 2 H17 L22 6 V13 L17 16 H7 L2 13 V6 Z',
    stage: { x: 10, y: 7, w: 4, h: 4 },
    reachFront: 68,
    reachBehind: 26,
  },
  // 예당: 무대가 한쪽 끝인 부채꼴 → 사다리꼴, 무대가 위
  'sac-concert-hall': {
    origin: { x: 4, y: 4 },
    outline: 'M8 2 H16 L21 16 H3 Z',
    stage: { x: 9, y: 2, w: 6, h: 3 },
    reachFront: 96,
    reachBehind: 16,
  },
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const PlanInset: React.FC<{ hall: HallGeometry; placement: Placement | null }> = ({
  hall,
  placement,
}) => {
  const spec = INSETS[hall.venueId];
  if (!spec) return null;

  let dot: { x: number; y: number } | null = null;
  if (placement) {
    const behind = placement.x < (hall.stage.x0 + hall.stage.x1) / 2;
    const depth = behind
      ? clamp01((hall.stage.x0 - placement.x) / spec.reachBehind)
      : clamp01((placement.x - hall.stage.x1) / spec.reachFront);
    const lateral = placement.side === 'left' ? -1 : placement.side === 'right' ? 1 : 0;
    const cx = spec.stage.x + spec.stage.w / 2;
    const stageTop = spec.stage.y;
    const stageBottom = spec.stage.y + spec.stage.h;
    dot = {
      x: Math.round(cx + lateral * (2 + depth * 5)),
      y: behind
        ? Math.round(stageTop - 1 - depth * 1.5)
        : Math.round(stageBottom + 1 + depth * 9),
    };
  }

  return (
    <g transform={`translate(${spec.origin.x},${spec.origin.y})`} shapeRendering="crispEdges">
      <rect x={0} y={0} width={24} height={18} fill="#0b0603" stroke={C.wall} strokeWidth={1} />
      <path d={spec.outline} fill="none" stroke={C.wallLit} strokeWidth={1} />
      <rect
        x={spec.stage.x}
        y={spec.stage.y}
        width={spec.stage.w}
        height={spec.stage.h}
        fill={C.stageTop}
      />
      {dot && (
        <>
          <rect x={dot.x - 1} y={dot.y - 1} width={3} height={3} fill={C.bg} />
          <rect x={dot.x} y={dot.y} width={1} height={1} fill={C.accent} />
        </>
      )}
    </g>
  );
};

/* ------------------------------------------------------------------ *
 * 강조 (precision 별 렌더 상태, §6)
 * ------------------------------------------------------------------ */

/** precision==='floor' — 그 층 밴드 전체를 은은하게 강조 */
const FloorBand: React.FC<{ hall: HallGeometry; floor: number }> = ({ hall, floor }) => {
  const ans = hall.anchors.filter((a) => a.floor === floor);
  if (ans.length === 0) return null;
  const xs = ans.flatMap((a) => [a.near.x, a.far.x]);
  const ys = ans.flatMap((a) => [a.near.y, a.far.y]);
  const x0 = Math.min(...xs) - 3;
  const x1 = Math.max(...xs) + 5;
  const y0 = Math.min(...ys) - 3;
  const y1 = Math.max(...ys) + 7;
  return (
    <rect
      x={x0}
      y={y0}
      width={x1 - x0}
      height={y1 - y0}
      fill={C.accent}
      opacity={0.1}
      stroke={C.accent}
      strokeOpacity={0.35}
      strokeWidth={1}
      shapeRendering="crispEdges"
    />
  );
};

/* ------------------------------------------------------------------ *
 * 본체
 * ------------------------------------------------------------------ */

export interface CrossSectionMapProps {
  /** OCR 이 읽은 공연장 문자열 (원문 그대로 넘겨도 된다) */
  venue: string;
  seat?: ParsedSeat | null;
  /** 저장된 아바타 (services/storage.ts loadAvatar()). 없으면 DEFAULT_AVATAR */
  avatarConfig?: AvatarConfig | null;
  /** 강제 배율. 없으면 컨테이너 폭으로 고른다 (1x는 썸네일 전용) */
  scale?: ArtScale;
  showInset?: boolean;
  /** 캡션(층·구역 문구, 경고)을 함께 그릴지 */
  showCaption?: boolean;
  className?: string;
}

export const CrossSectionMap: React.FC<CrossSectionMapProps> = ({
  venue,
  seat,
  avatarConfig,
  scale,
  showInset = true,
  showCaption = true,
  className = '',
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const res = useMemo(() => resolveSeatMap(venue, seat), [venue, seat]);
  const s: ArtScale = scale ?? pickScale(width || 360);

  // ── 지원 안 하는 홀 / 모르는 홀: 아무것도 안 그린다 (§6 마지막 두 줄) ──
  if (!res.hall) {
    return (
      <div
        ref={boxRef}
        className={`rounded-2xl border border-dashed border-[#3e271c] bg-[#120a06]/60 px-4 py-6 text-center ${className}`}
      >
        <p className="text-xs text-amber-200/45 leading-relaxed">{res.message}</p>
        <p className="mt-1 text-[10px] text-amber-200/25">
          롯데콘서트홀 · 예술의전당 콘서트홀만 좌석도를 그릴 수 있어요.
        </p>
      </div>
    );
  }

  const hall = res.hall;
  const p = res.placement;
  const Hall = hall.venueId === 'lotte-concert-hall' ? LotteHall : SacHall;

  return (
    <div ref={boxRef} className={className}>
      <div className="flex justify-center">
        <svg
          width={ART_W * s}
          height={ART_H * s}
          viewBox={`0 0 ${ART_W} ${ART_H}`}
          style={{ imageRendering: 'pixelated', display: 'block' }}
          role="img"
          aria-label={`${res.profile?.nameKo ?? ''} 좌석 단면도 — ${res.message}`}
        >
          <HatchDefs />
          <rect x={0} y={0} width={ART_W} height={ART_H} fill={C.bg} />

          {/* 층 강조는 좌석단 **아래** 에 깔아야 단이 안 가려진다 */}
          {p?.precision === 'floor' && p.floor != null && (
            <FloorBand hall={hall} floor={p.floor} />
          )}

          <Hall
            activeBlock={p && p.precision !== 'floor' ? p.blockCode : null}
            activeFloor={p?.floor ?? null}
          />

          {showInset && <PlanInset hall={hall} placement={p} />}

          {/* 아바타 — precision 'none'(placement null) 이면 아예 안 그린다 */}
          {p && (
            <>
              {/* 접힌(절단면 밖) 좌석은 발밑에 1px 후광을 깐다 (§3-b).
                  스프라이트를 상자로 둘러싸면 액자처럼 보여서 발밑 선으로 바꿨다. */}
              {p.folded && (
                <rect
                  x={p.x - 3}
                  y={p.y}
                  width={6}
                  height={1}
                  fill={C.accent}
                  opacity={0.8}
                  shapeRendering="crispEdges"
                />
              )}
              <SeatAvatar
                x={p.x}
                y={p.y}
                config={avatarConfig}
                mirrored={p.side === 'left'}
                faded={p.precision === 'floor'}
              />
              {/* 근사 위치 표시 — conf.geometry 가 confirmed 가 아닐 때 (§6) */}
              {p.approx && (
                <text
                  x={p.x + 5}
                  y={p.y - 7}
                  fontSize="6"
                  fill={C.accent}
                  fontFamily="ui-monospace, monospace"
                >
                  ≈
                </text>
              )}
            </>
          )}
        </svg>
      </div>

      {showCaption && (
        <div className="mt-2 space-y-1 text-center">
          <p className="text-xs font-semibold text-amber-400">
            {res.profile?.nameKo}
            <span className="mx-1.5 text-amber-200/25">·</span>
            <span className="text-amber-100/70">{res.message}</span>
          </p>
          {p?.warning && (
            <p className="text-[10px] leading-relaxed text-amber-300/60">⚠ {p.warning}</p>
          )}
          {p?.approx && !p.warning && (
            <p className="text-[10px] text-amber-200/30">
              ≈ 는 위치가 근사라는 뜻이에요 (공식 자료가 평면도뿐이라 높이는 추정값).
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CrossSectionMap;
