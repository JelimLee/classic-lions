/**
 * StageView.tsx — "이 자리에서 본 무대" 탭
 *
 * 좌석 시야를 픽셀화한 이미지를 보여주는 화면. 자산(`data/vrPoints.ts`,
 * `assets/vr/*`)은 다른 담당이 준비 중이라 **아직 없을 수 있다.**
 * 없으면 "준비 중" 자리만 보여주고 조용히 넘어간다 — 이 컴포넌트는 절대
 * 자산 유무로 앱을 깨뜨리지 않는다.
 *
 * 자산을 만나는 지점은 services/stageView.ts 한 곳뿐이다. 여기서 vrPoints 를
 * 직접 import 하지 말 것.
 */

import React, { useEffect, useState } from 'react';
import type { ParsedSeat } from '../../types';
import { resolveStageView, type StageViewState } from '../../services/stageView.ts';

export interface StageViewProps {
  venueId: string;
  venueName: string;
  seat?: ParsedSeat | null;
  /** 좌석 한 줄 설명 (좌석표 캡션과 같은 문구) */
  caption?: string;
}

export const StageView: React.FC<StageViewProps> = ({ venueId, venueName, seat, caption }) => {
  const [state, setState] = useState<StageViewState | null>(null);

  useEffect(() => {
    let alive = true;
    resolveStageView(venueId, seat).then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, [venueId, seat]);

  if (!state) {
    return <Frame>불러오는 중…</Frame>;
  }

  if (state.kind === 'ready' && typeof state.point.image !== 'string') {
    // 지점은 찾았는데 이미지 파일이 아직 없다 (자산 폴더 미도착).
    return (
      <Frame>
        <span className="text-amber-300/60">{String(state.point.label ?? '가장 가까운 촬영 지점')}</span>
        <br />
        지점은 정해졌는데 시야 이미지가 아직 없어요.
      </Frame>
    );
  }

  if (state.kind === 'ready' && typeof state.point.image === 'string') {
    return (
      <div className="space-y-2">
        <img
          src={state.point.image}
          alt={`${venueName} ${caption ?? ''} 시야`}
          className="mx-auto block w-full max-w-[512px] rounded-xl border border-[#3e271c]"
          style={{ imageRendering: 'pixelated' }}
        />
        <p className="text-center text-[11px] text-amber-200/45">
          {state.point.label ?? caption ?? ''}
          <span className="ml-1 text-amber-200/25">· 가장 가까운 촬영 지점</span>
        </p>
        {/* 편성별 오케스트라 배치 오버레이가 들어올 자리 (다음 라운드) */}
      </div>
    );
  }

  if (state.kind === 'no-point') {
    return (
      <Frame>
        이 좌석 근처에는 아직 촬영 지점이 없어요.
        <br />
        <span className="text-amber-200/25">
          같은 층·구역의 다른 자리 시야가 들어오면 여기 보여드릴게요.
        </span>
      </Frame>
    );
  }

  return (
    <Frame>
      <span className="text-amber-300/60">이 자리에서 본 무대 — 준비 중</span>
      <br />
      좌석 시야 픽셀 이미지를 모으는 중이에요.
      <br />
      <span className="text-amber-200/25">
        자산이 들어오면(app/data/vrPoints.ts) 이 화면이 자동으로 켜집니다.
        <br />
        편성별(협주곡·교향곡·독주) 무대 위 연주자 배치는 그다음입니다.
      </span>
    </Frame>
  );
};

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-[#3e271c] bg-[#0f0805] px-4 py-8">
    <p className="text-center text-xs leading-relaxed text-amber-200/45">{children}</p>
  </div>
);

export default StageView;
