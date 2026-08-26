/**
 * Avatar.tsx — 좌석도/프로필이 공유하는 아바타 렌더 계약
 *
 * 좌석도 담당이 import 하는 공개 표면은 여기 4개다:
 *   AvatarConfig / DEFAULT_AVATAR / Avatar / avatarToSvgString
 *
 * 렌더 규칙 (docs/RESEARCH_seat_avatar.md §3.2, §4.3):
 *   - 인라인 SVG. <img src=data:> 보다 선명하고 좌표 계산이 쉽다.
 *   - 원본 16×16 → 표시 크기는 16의 정수배(32/64/128)를 권장.
 *   - image-rendering: pixelated + shape-rendering="crispEdges"(정의에 내장).
 *   - 네트워크 호출 없음. npm 번들만 쓴다.
 */

import React, { useMemo } from 'react';
import {
  AVATAR_CANVAS,
  avatarToSvgString,
  DEFAULT_AVATAR,
  type AvatarConfig,
} from './parts';

export type { AvatarConfig };
export {
  DEFAULT_AVATAR,
  avatarToSvgString,
  AVATAR_CANVAS,
  AVATAR_STYLE_VERSION,
  PALETTES,
  PART_VARIANTS,
  OPTIONAL_PARTS,
  REQUIRED_PARTS,
  randomAvatar,
  normalizeAvatarConfig,
  styleVersionMismatch,
  serializeAvatar,
  deserializeAvatar,
  avatarToCompactSvgString,
  type PartKey,
} from './parts';

export interface AvatarProps {
  config: AvatarConfig;
  /**
   * 표시 픽셀 크기. **16의 정수배(32/64/128)를 권장**한다.
   * 정수배가 아니면 넘치지 않도록 아래쪽 정수배로 내림한다(예: 40 → 32).
   */
  size: number;
  className?: string;
}

/**
 * 요청 크기를 넘지 않는 가장 큰 16의 정수배로 내림. 최소 16.
 * 내림인 이유: 좌석도처럼 칸 크기가 정해진 곳에 넣을 때 절대 넘치지 않아야 한다.
 * (비정수 배율은 픽셀 폭이 들쭉날쭉해진다 — RESEARCH §3.2)
 */
export function snapToPixelScale(size: number): number {
  if (!Number.isFinite(size) || size < AVATAR_CANVAS) return AVATAR_CANVAS;
  return Math.floor(size / AVATAR_CANVAS) * AVATAR_CANVAS;
}

export function Avatar({ config, size, className }: AvatarProps): React.JSX.Element {
  const px = snapToPixelScale(size);
  const svg = useMemo(() => avatarToSvgString(config, px), [config, px]);
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        width: px,
        height: px,
        lineHeight: 0,
        imageRendering: 'pixelated',
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default Avatar;
