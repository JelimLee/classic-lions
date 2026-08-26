/**
 * SeatMap.tsx — 티켓 좌석을 **위에서 본 픽셀아트 좌석표** 위에 올린다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 이 컴포넌트는 좌표를 스스로 만들지 않는다. `resolveSeatMap()` 이 돌려준
 * status / cell 로만 분기한다. 그래서 "모르는데 그럴듯하게 그리는" 경로가 없다.
 * ─────────────────────────────────────────────────────────────────────
 *
 * 밀도: 각 층을 앞/중/뒤 × 좌/중/우 9칸으로 나눈다. 좌석 하나하나를 찍지
 * 않는다 — 공식 자료로 확신할 수 있는 해상도가 구역 단위이기 때문이다.
 * 무대 뒤(합창석)는 9칸 밖의 별도 존이다.
 *
 * 탭:
 *   좌석표          — 이 파일
 *   이 자리에서 본 무대 — StageView.tsx (자산 준비 중이면 "준비 중" 자리)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedSeat } from '../../types';
import {
  ART_H,
  ART_W,
  pickScale,
  resolveSeatMap,
} from '../../services/seatGeometry.ts';
import type { ArtScale } from '../../services/seatGeometry.ts';
import { C } from './planArt.tsx';
import LotteHall from './halls/LotteHall.tsx';
import SacHall from './halls/SacHall.tsx';
import { SeatAvatar } from './AvatarSlot.tsx';
import StageView from './StageView.tsx';
import type { AvatarConfig } from '../avatar/Avatar';

/** 9격자는 칸이 크다 → 아바타를 단면도(8)보다 크게 넣는다. 2x 화면에서 32px. */
const AVATAR_ART = 16;

export interface SeatMapProps {
  /** OCR 이 읽은 공연장 문자열 (원문 그대로 넘겨도 된다) */
  venue: string;
  seat?: ParsedSeat | null;
  /** 저장된 아바타 (services/storage.ts loadAvatar()). 없으면 DEFAULT_AVATAR */
  avatarConfig?: AvatarConfig | null;
  /** 강제 배율. 없으면 컨테이너 폭으로 고른다 */
  scale?: ArtScale;
  /** 캡션(층·구역 문구, 경고)을 함께 그릴지 */
  showCaption?: boolean;
  /** "이 자리에서 본 무대" 탭을 붙일지 (썸네일에서는 끈다) */
  showTabs?: boolean;
  /** 처음 열릴 탭. QA/딥링크용 */
  defaultTab?: 'map' | 'view';
  className?: string;
}

type Tab = 'map' | 'view';

export const SeatMap: React.FC<SeatMapProps> = ({
  venue,
  seat,
  avatarConfig,
  scale,
  showCaption = true,
  showTabs = true,
  defaultTab = 'map',
  className = '',
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tab, setTab] = useState<Tab>(defaultTab);

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
  const s: ArtScale = scale ?? pickScale(width || 288);

  // ── 지원 안 하는 홀 / 모르는 홀: 아무것도 안 그린다 ──
  if (!res.plan || !res.floorPlan) {
    return (
      <div
        ref={boxRef}
        className={`rounded-2xl border border-dashed border-[#3e271c] bg-[#120a06]/60 px-4 py-6 text-center ${className}`}
      >
        <p className="text-xs leading-relaxed text-amber-200/45">{res.message}</p>
        <p className="mt-1 text-[10px] text-amber-200/25">
          롯데콘서트홀 · 예술의전당 콘서트홀만 좌석도를 그릴 수 있어요.
        </p>
      </div>
    );
  }

  const fp = res.floorPlan;
  const p = res.placement;
  const Hall = res.plan.venueId === 'lotte-concert-hall' ? LotteHall : SacHall;
  const floorOnly = p?.precision === 'floor';

  return (
    <div ref={boxRef} className={className}>
      {showTabs && (
        <div className="mb-3 flex justify-center gap-1.5">
          <TabButton active={tab === 'map'} onClick={() => setTab('map')}>
            좌석표
          </TabButton>
          <TabButton active={tab === 'view'} onClick={() => setTab('view')}>
            이 자리에서 본 무대
          </TabButton>
        </div>
      )}

      {tab === 'view' && showTabs ? (
        <StageView
          venueId={res.plan.venueId}
          venueName={res.profile?.nameKo ?? ''}
          seat={seat}
          caption={res.message}
        />
      ) : (
        <div className="flex justify-center">
          <svg
            width={ART_W * s}
            height={ART_H * s}
            viewBox={`0 0 ${ART_W} ${ART_H}`}
            style={{ imageRendering: 'pixelated', display: 'block' }}
            role="img"
            aria-label={`${res.profile?.nameKo ?? ''} ${fp.floor}층 좌석표 — ${res.message}`}
          >
            <Hall
              floor={fp.floor}
              activeZone={floorOnly ? null : p?.zone ?? null}
              floorOnly={floorOnly}
            />

            {/* 층 표시 — 9격자는 층마다 따로다. 어느 층 그림인지 늘 보여야 한다. */}
            <text
              x={ART_W - 3}
              y={ART_H - 3}
              textAnchor="end"
              fontSize="7"
              fill={C.dim}
              fontFamily="ui-monospace, monospace"
            >
              {fp.floor}F
            </text>

            {/* 아바타 — precision 'none'(placement null) 이면 아예 안 그린다 */}
            {p && (
              <>
                {/* 발밑 후광. 칸 강조와 별개로 "여기 한 사람"이라는 점을 찍는다. */}
                <rect
                  x={p.anchor.x - 5}
                  y={p.anchor.y}
                  width={10}
                  height={1}
                  fill={C.accent}
                  opacity={0.85}
                  shapeRendering="crispEdges"
                />
                <SeatAvatar
                  x={p.anchor.x}
                  y={p.anchor.y}
                  config={avatarConfig}
                  artSize={AVATAR_ART}
                  mirrored={p.column === 'right'}
                  faded={floorOnly}
                />
                {p.approx && (
                  <text
                    x={p.anchor.x + AVATAR_ART / 2 + 1}
                    y={p.anchor.y - AVATAR_ART + 6}
                    fontSize="7"
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
      )}

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
              ≈ 는 위치가 근사라는 뜻이에요 (구역의 평면 위치를 공식 자료에서 확정하지 못했어요).
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
      active
        ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
        : 'border-[#3e271c] bg-[#120a06] text-amber-200/40 hover:text-amber-200/70'
    }`}
  >
    {children}
  </button>
);

export default SeatMap;
