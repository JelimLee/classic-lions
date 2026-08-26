/**
 * AvatarSlot.tsx — 단면도가 아바타를 부르는 **단 하나의 지점**
 *
 * 아바타 본체는 `components/avatar/Avatar.tsx` 가 소유한다. 여기서는 그 계약만
 * 쓴다 (AvatarConfig / DEFAULT_AVATAR / avatarToCompactSvgString).
 *
 * 왜 <Avatar> 컴포넌트를 직접 안 쓰나:
 *   <Avatar> 는 HTML <span> 을 돌려준다. 단면도는 <svg> 안이라 span 을 못 넣는다.
 *   그래서 같은 파일이 export 하는 `avatarToCompactSvgString()` 로 16×16 SVG
 *   문자열을 받아 <g> 안에 인라인으로 심는다 (아바타 담당 권고: 단면도처럼
 *   작게 여러 개 놓는 자리에는 metadata 를 뗀 compact 버전을 쓸 것).
 *
 * 크기 계약 (설계문서 §1 — 정수 배율만):
 *   원본 16×16 → 아트 좌표 8×8 (scale 0.5) → 화면 배율 2x 에서 16px(1:1),
 *   4x 에서 32px(2:1). 어떤 배율에서도 픽셀이 반쪽으로 잘리지 않는다.
 */

import React, { useMemo } from 'react';
import { avatarToCompactSvgString, DEFAULT_AVATAR, type AvatarConfig } from '../avatar/Avatar';

export { DEFAULT_AVATAR };
export type { AvatarConfig };

/** 아바타 상자 한 변 (아트 픽셀). */
export const AVATAR_ART_SIZE = 8;
/** 원본 스프라이트 한 변 */
const SPRITE = 16;

export interface SeatAvatarProps {
  config?: AvatarConfig | null;
  /** 무대를 바라보게 좌우 반전할지 (스프라이트 미러링) */
  mirrored?: boolean;
  /** 근사 위치라 흐리게 그릴지 */
  faded?: boolean;
  /**
   * 아트 좌표에서 아바타 한 변의 길이.
   * 16 의 약수/배수만 써야 픽셀이 반쪽으로 잘리지 않는다 (8 / 16 / 32).
   * top-down 9격자는 칸이 크므로 16 을 쓴다 (화면 배율 2x 에서 32px).
   */
  artSize?: number;
}

/**
 * 단면도 좌표에 아바타를 얹는다. (x, y) 는 좌석 지점이고 아바타의 **발밑**이 여기 온다.
 */
export const SeatAvatar: React.FC<SeatAvatarProps & { x: number; y: number }> = ({
  x,
  y,
  config,
  mirrored = false,
  faded = false,
  artSize = AVATAR_ART_SIZE,
}) => {
  const svg = useMemo(
    () => avatarToCompactSvgString(config ?? DEFAULT_AVATAR, SPRITE),
    [config],
  );

  const k = artSize / SPRITE;
  const top = y - artSize + 1;
  // 미러링은 오른쪽 끝으로 옮긴 뒤 x축을 뒤집는다.
  const transform = mirrored
    ? `translate(${x + artSize / 2},${top}) scale(${-k},${k})`
    : `translate(${x - artSize / 2},${top}) scale(${k})`;

  return (
    <g
      transform={transform}
      opacity={faded ? 0.55 : 1}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default SeatAvatar;
