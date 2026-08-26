/**
 * crossSectionGeometry.ts — 【보관】 옆에서 본 단면도 좌표
 *
 * ⚠️ 현재 화면에 연결되어 있지 않다. 기본 좌석표는 위에서 본 평면도(top-down)
 *    9격자이고, 그건 services/seatGeometry.ts 가 담당한다.
 *    이 파일 + components/seatmap/halls/cross-section/ 은 나중에 "세 번째 뷰"
 *    (단면)로 되살릴 때를 위해 통째로 남겨둔 것이다. 설계는 docs/SEATMAP_geometry.md.
 *
 *    캔버스가 다르다: 단면 160×104, 평면 128×160. 두 모듈의 ART_W/ART_H 를
 *    섞어 쓰지 말 것.
 *
 * seatGeometry.ts — 좌석 → 픽셀아트 단면도 좌표
 *
 * 사양: docs/SEATMAP_geometry.md (§1 캔버스 / §4 매핑 / §5 앵커 표 / §6 불완전 좌석)
 *
 * ⚠️ 브라우저 API 의존 금지. venues.ts / ocrSchema.ts 와 같은 규칙 —
 *    Node 에서 그대로 import 되어야 한다 (테스트가 여기 의존한다).
 *
 * ─────────────────────────────────────────────────────────────────────
 * 이 파일의 제1원칙: **틀리게 그리는 것보다 안 그리는 게 낫다.**
 * ─────────────────────────────────────────────────────────────────────
 * 그래서 함수 이름이 `seatToXY` 인데도 `null` 을 자주 돌려준다. 모르는 값을
 * 그럴듯하게 채우는 경로는 이 파일에 없다. 정보가 모자라면 precision 이
 * 내려가고, 아예 없으면 아무것도 안 그린다.
 *
 * ⚠️ 앵커 픽셀 좌표는 **실측이 아니라 디자인 값**이다 (설계문서 §5-3).
 *    블록의 순서·좌우는 공식 자료 근거가 있지만 절대 좌표는 손으로 맞춘 값이다.
 *    conf.geometry 가 confirmed 가 아닌 블록은 UI 가 `≈` 를 붙인다.
 *
 * ⚠️ `tier` 는 좌표 계산에 **쓰지 않는다** (설계문서 §4-3).
 *    venues.ts 의 51개 블록 전부 `conf.tier === 'inferred'` 다 — 공식 자료가
 *    전부 평면도라 높이 정보가 아예 없다. 추론값을 y 에 곱하면 틀린 높이가
 *    그대로 화면에 나온다. tier 는 렌더 z-order(밴드 정렬)에만 쓰고,
 *    tier 에서 유래한 어떤 시각적 차이도 MAX_TIER_NUDGE_PX 를 넘지 않는다.
 */

import type { Confidence, VenueBlock, VenueProfile } from '../data/venues.ts';
import { findBlock, matchVenueDetailed } from '../data/venues.ts';
import type { ParsedSeat } from './ocrSchema.ts';

/* ------------------------------------------------------------------ *
 * 캔버스 (설계문서 §1)
 * ------------------------------------------------------------------ */

export const ART_W = 160;
export const ART_H = 104;

/** 확대는 정수 배율만. 1.5x/3x 는 아바타 픽셀을 깨뜨린다 (§1). */
export type ArtScale = 1 | 2 | 4;

export function pickScale(containerWidth: number): ArtScale {
  return containerWidth >= 640 ? 4 : containerWidth >= 320 ? 2 : 1;
}

/**
 * tier 에서 유래한 시각 차이의 상한 (§4-3).
 * 좌표 계산에는 tier 를 아예 안 쓰므로 현재 y 보정값은 0 이다.
 * 이 상수는 "혹시 나중에 tier 로 밴드를 흔들고 싶어지면 여기가 천장" 이라는
 * 계약을 코드에 남겨두기 위한 것이다.
 */
export const MAX_TIER_NUDGE_PX = 4;

/* ------------------------------------------------------------------ *
 * 타입
 * ------------------------------------------------------------------ */

export type Precision = 'exact' | 'row' | 'block' | 'floor' | 'none';
export type Side = 'left' | 'right' | 'center';

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 블록 하나를 캔버스 위 **선분**으로 고정한다 (§4-1). 점이 아니다. */
export interface BlockAnchor {
  code: string;
  floor: number;
  /** 무대에 가장 가까운 끝 */
  near: Pt;
  /** 무대에서 가장 먼 끝 */
  far: Pt;
  side: Side;
  /** 절단면 밖 = 해칭 스타일로 그린다 (§3-b) */
  folded: boolean;
  /** seatAxis==='depth' 블록에서 near..far 에 대응하는 좌석 번호 범위 */
  seatSpan?: [number, number];
  /**
   * 한 열의 최대 좌석 번호. 좌우 지터(§4-4)에만 쓴다 (±1px).
   * venues.ts sourceNote 에 명시된 값만 채웠다. 없으면 지터를 안 건다.
   */
  maxSeatInRow?: number;
  /** rowMin..rowMax 범위 안이지만 실제로는 좌석이 없는 열 (§5 ⚠️) */
  missingRows?: number[];
}

export interface HallGeometry {
  venueId: string;
  /** 무대 상자. 여기 안에는 절대 좌석이 찍히면 안 된다 (§8). */
  stage: Rect;
  floorLineY: number;
  baseY: number;
  anchors: BlockAnchor[];
  /** 층만 알 때 쓰는 대표점 (§6) */
  floorPoint: Record<number, Pt>;
}

export interface Placement {
  x: number;
  y: number;
  side: Side;
  precision: Precision;
  /** block.conf.geometry — UI 가 "≈" 를 붙일지 결정 (§6) */
  geometryConfidence: Confidence;
  /** true 면 절단면 밖 = 해칭 스타일 */
  folded: boolean;
  /** geometryConfidence !== 'confirmed'. UI 가 이 하나만 보면 된다. */
  approx: boolean;
  blockCode: string | null;
  floor: number | null;
  /** precision==='block' 일 때 블록 선분 전체를 강조하려고 쓴다 */
  segment: { near: Pt; far: Pt } | null;
  /** 사용자에게 보여줄 경고 (없는 열, 범위 밖 등). 없으면 null */
  warning: string | null;
}

/* ------------------------------------------------------------------ *
 * 앵커 표 (설계문서 §5)
 * ------------------------------------------------------------------ *
 *
 * 근거의 층위 (§5-3):
 *   블록의 순서·좌우  → 공식 자료. 신뢰도 높음.
 *   상대 길이         → 격자 폭/배치도 비율. 중간.
 *   절대 픽셀 좌표    → 손으로 맞춘 디자인 값. **낮음.**
 *   층 높이(y 밴드)   → 어느 자료에도 없다. 낮음.
 */

const a = (
  code: string,
  floor: number,
  near: [number, number],
  far: [number, number],
  side: Side,
  folded: boolean,
  extra: Partial<BlockAnchor> = {},
): BlockAnchor => ({
  code,
  floor,
  near: { x: near[0], y: near[1] },
  far: { x: far[0], y: far[1] },
  side,
  folded,
  ...extra,
});

/** 롯데 1층 B·D 는 8·16·17·18열에 좌석이 없다 (공식 배치도 직접 판독, §5-1). */
export const LOTTE_ROW_GAPS: readonly number[] = [8, 16, 17, 18];
/** 예당 1층 A·E 는 14열이 통로라 좌석이 없다 (공식 엑셀 격자, §5-2). */
export const SAC_ROW_GAPS: readonly number[] = [14];

const LOTTE_HALL: HallGeometry = {
  venueId: 'lotte-concert-hall',
  // 무대가 홀 **한가운데**다. 왼쪽이 무대 뒤, 오른쪽이 객석 (§3-a).
  stage: { x0: 56, y0: 72, x1: 86, y1: 84 },
  floorLineY: 84,
  baseY: 100,
  anchors: [
    /* 1층 무대 뒤 */
    a('P', 1, [52, 80], [34, 68], 'center', false, { maxSeatInRow: 30 }),
    a('LP', 1, [48, 78], [30, 64], 'left', true, { seatSpan: [1, 17], maxSeatInRow: 17 }),
    a('RP', 1, [48, 78], [30, 64], 'right', true, { seatSpan: [1, 17], maxSeatInRow: 17 }),
    /* 1층 측면 터레이스 — 열이 높이, 좌석 번호가 깊이 */
    a('L', 1, [76, 72], [120, 62], 'left', true, { seatSpan: [1, 18], maxSeatInRow: 18 }),
    a('R', 1, [76, 72], [120, 62], 'right', true, { seatSpan: [1, 18], maxSeatInRow: 18 }),
    /* 1층 정면 객석 */
    a('A', 1, [90, 82], [134, 70], 'left', false),
    a('B', 1, [90, 82], [150, 66], 'center', false, { missingRows: [...LOTTE_ROW_GAPS] }),
    a('C', 1, [90, 82], [150, 66], 'center', false),
    a('D', 1, [90, 82], [150, 66], 'center', false, { missingRows: [...LOTTE_ROW_GAPS] }),
    a('E', 1, [90, 82], [134, 70], 'right', false),
    /* 2층 — 긴 측면 발코니(L/R)와 뒤쪽 발코니(A~E) 두 덩어리 */
    a('L', 2, [58, 50], [140, 46], 'left', true, { seatSpan: [1, 34] }),
    a('R', 2, [58, 50], [140, 46], 'right', true, { seatSpan: [1, 34] }),
    a('A', 2, [126, 44], [146, 36], 'left', false, { maxSeatInRow: 11 }),
    a('B', 2, [126, 44], [154, 32], 'center', false),
    a('C', 2, [126, 44], [154, 32], 'center', false),
    a('D', 2, [126, 44], [154, 32], 'center', false),
    a('E', 2, [126, 44], [146, 36], 'right', false, { maxSeatInRow: 11 }),
  ],
  floorPoint: { 1: { x: 120, y: 74 }, 2: { x: 140, y: 38 } },
};

/**
 * BOX 는 열 번호 체계를 확인하지 못했다 (conf.rows === 'unknown').
 * 그래서 선분이 아니라 **점**으로 고정하고 precision 을 block 에서 못 올린다.
 * 좌표는 §5-2 의 "BOX1→3 / BOX6→4" 선분을 3등분한 값이다.
 */
const SAC_HALL: HallGeometry = {
  venueId: 'sac-concert-hall',
  // 무대가 홀 **한쪽 끝**. 객석이 한 방향으로만 펼쳐지고 뒤에서 3단이 쌓인다.
  stage: { x0: 26, y0: 76, x1: 56, y1: 88 },
  floorLineY: 88,
  baseY: 100,
  anchors: [
    /* 1층 무대 뒤 합창석. G 만 무대 정후면, H·F 는 무대 옆구리다. */
    a('G', 1, [22, 78], [10, 70], 'center', false),
    a('H', 1, [26, 80], [14, 72], 'left', true, { seatSpan: [1, 24] }),
    a('F', 1, [26, 80], [14, 72], 'right', true, { seatSpan: [1, 24] }),
    /* 1층 부채꼴 */
    a('A', 1, [60, 86], [120, 72], 'left', false, { maxSeatInRow: 12, missingRows: [...SAC_ROW_GAPS] }),
    a('B', 1, [60, 86], [126, 70], 'center', false, { maxSeatInRow: 14 }),
    a('C', 1, [60, 86], [126, 70], 'center', false, { maxSeatInRow: 16 }),
    a('D', 1, [60, 86], [126, 70], 'center', false, { maxSeatInRow: 14 }),
    a('E', 1, [60, 86], [120, 72], 'right', false, { maxSeatInRow: 12, missingRows: [...SAC_ROW_GAPS] }),
    /* 2층 BOX — 점 앵커 */
    a('BOX1', 2, [70, 58], [70, 58], 'left', true),
    a('BOX2', 2, [58, 54], [58, 54], 'left', true),
    a('BOX3', 2, [46, 50], [46, 50], 'left', true),
    a('BOX6', 2, [70, 58], [70, 58], 'right', true),
    a('BOX5', 2, [58, 54], [58, 54], 'right', true),
    a('BOX4', 2, [46, 50], [46, 50], 'right', true),
    /* 2층 팔 + 뒤 발코니.
       ⚠️ A 와 E 는 대칭이지만 깊이 방향이 **정반대**다 (seatDepthDir). */
    a('A', 2, [62, 52], [136, 44], 'left', true, { seatSpan: [1, 20], maxSeatInRow: 20 }),
    a('B', 2, [96, 54], [136, 44], 'center', false, { maxSeatInRow: 14 }),
    a('C', 2, [96, 54], [132, 45], 'center', false, { maxSeatInRow: 13 }),
    a('D', 2, [96, 54], [136, 44], 'center', false, { maxSeatInRow: 14 }),
    a('E', 2, [62, 52], [136, 44], 'right', true, { seatSpan: [1, 20], maxSeatInRow: 20 }),
    /* 3층 BOX */
    a('BOX7', 3, [72, 38], [72, 38], 'left', true),
    a('BOX8', 3, [60, 34], [60, 34], 'left', true),
    a('BOX9', 3, [48, 30], [48, 30], 'left', true),
    a('BOX12', 3, [72, 38], [72, 38], 'right', true),
    a('BOX11', 3, [60, 34], [60, 34], 'right', true),
    a('BOX10', 3, [48, 30], [48, 30], 'right', true),
    /* 3층 팔 + 뒤 발코니 (B~F 는 rowMin=4 다 — venues.ts 가 들고 있다) */
    a('A', 3, [70, 34], [134, 24], 'left', true, { seatSpan: [1, 14], maxSeatInRow: 14 }),
    a('B', 3, [100, 30], [134, 24], 'center', false, { maxSeatInRow: 9 }),
    a('C', 3, [100, 30], [134, 24], 'center', false, { maxSeatInRow: 13 }),
    a('D', 3, [100, 30], [134, 24], 'center', false, { maxSeatInRow: 13 }),
    a('E', 3, [100, 30], [134, 24], 'center', false, { maxSeatInRow: 13 }),
    a('F', 3, [100, 30], [134, 24], 'center', false, { maxSeatInRow: 9 }),
    a('G', 3, [70, 34], [134, 24], 'right', true, { seatSpan: [1, 14], maxSeatInRow: 14 }),
    /* 3층 M·N — 열 번호가 1부터 다시 시작하지만 물리적으로는 7열보다 더 뒤·더 위다.
       그래서 앵커를 따로 준다 (§5-2 ⚠️). */
    a('M', 3, [140, 22], [152, 18], 'left', false),
    a('N', 3, [140, 22], [152, 18], 'right', false),
  ],
  floorPoint: { 1: { x: 93, y: 78 }, 2: { x: 116, y: 49 }, 3: { x: 109, y: 29 } },
};

export const HALLS: Record<string, HallGeometry> = {
  'lotte-concert-hall': LOTTE_HALL,
  'sac-concert-hall': SAC_HALL,
};

export function hallFor(profile: VenueProfile | null): HallGeometry | null {
  if (!profile) return null;
  return HALLS[profile.id] ?? null;
}

export function findAnchor(
  hall: HallGeometry,
  floor: number,
  code: string,
): BlockAnchor | null {
  const c = code.trim().toUpperCase();
  return hall.anchors.find((an) => an.floor === floor && an.code === c) ?? null;
}

/* ------------------------------------------------------------------ *
 * 매핑 (설계문서 §4)
 * ------------------------------------------------------------------ */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (p: number, q: number, t: number) => p + (q - p) * t;

/** rowMin..rowMax 에서 실제로 존재하는 열만. 없는 열을 균등 보간하지 않기 위한 것. */
export function presentRows(block: VenueBlock, anchor: BlockAnchor): number[] {
  if (block.rowMin == null || block.rowMax == null) return [];
  const gaps = new Set(anchor.missingRows ?? []);
  const out: number[] = [];
  for (let r = block.rowMin; r <= block.rowMax; r++) if (!gaps.has(r)) out.push(r);
  return out;
}

interface Depth {
  t: number;
  precision: Precision;
  warning: string | null;
}

/**
 * 깊이 비율 t (0 = 무대 쪽 끝, 1 = 먼 끝) — §4-2.
 *
 * 판정 순서가 곧 정확도다:
 *   (0) 열 번호 체계를 모른다 (BOX)            → 블록 한가운데
 *   (1) 깊이 축이 **좌석 번호**인 블록          → 좌석 번호로 잰다
 *   (2) 깊이 축이 **열**인 블록 (대부분의 객석) → 열로 잰다
 *   (3) 나머지                                  → 블록 한가운데
 *
 * ⚠️ (1)이 (2)보다 먼저인 이유: 예당 2층 A/E·3층 A/G 는 venues.ts 에서
 *    rowAxis 도 'depth' 지만 실제 깊이는 좌석 번호다(열 1~8 은 발코니 폭).
 *    (2)를 먼저 태우면 34m 짜리 팔이 열 8칸 안에 뭉개진다.
 */
function depthFraction(
  block: VenueBlock,
  anchor: BlockAnchor,
  seat: ParsedSeat,
): Depth {
  const mid: Depth = { t: 0.5, precision: 'block', warning: null };

  // (0) 열 번호 체계 자체를 모른다 → 열 보간을 하지 마라 (§6)
  if (block.conf.rows === 'unknown' && block.seatAxis !== 'depth') return mid;

  // (1) 좌석 번호가 깊이인 블록
  if (block.seatAxis === 'depth' && anchor.seatSpan) {
    if (seat.number == null) {
      // 이 블록에서 열은 깊이가 아니다. 열만 알면 깊이는 여전히 모른다.
      return mid;
    }
    const [s0, s1] = anchor.seatSpan;
    const u = clamp01((seat.number - s0) / Math.max(1, s1 - s0));
    // ⚠️ 좌우 대칭 짝이라도 방향이 반대일 수 있다 (예당 2층 A away / E toward).
    const t = block.seatDepthDir === 'toward' ? 1 - u : u;
    return { t, precision: 'exact', warning: null };
  }

  // (2) 열이 곧 깊이인 블록 — 대부분의 정면 객석
  if (
    block.rowAxis === 'depth' &&
    seat.row != null &&
    block.rowMin != null &&
    block.rowMax != null
  ) {
    const rows = presentRows(block, anchor);
    const idx = rows.indexOf(seat.row);

    if (idx < 0) {
      const gaps = anchor.missingRows ?? [];
      if (gaps.includes(seat.row)) {
        // 없는 자리다. 그럴듯하게 찍지 말고 블록 한가운데로 내린다.
        return {
          t: 0.5,
          precision: 'block',
          warning: `${block.code}구역엔 ${seat.row}열이 없어요 (통로/단차). 읽은 값이 틀렸을 수 있어요.`,
        };
      }
      return {
        t: 0.5,
        precision: 'block',
        warning: `${block.code}구역은 ${block.rowMin}~${block.rowMax}열까지예요. ${seat.row}열은 범위 밖이에요.`,
      };
    }

    const t = rows.length <= 1 ? 0.5 : idx / (rows.length - 1);
    return {
      t,
      precision: seat.number != null ? 'exact' : 'row',
      warning: null,
    };
  }

  // (3) 블록만 안다
  return mid;
}

/**
 * 좌우 지터 (§4-4) — 블록 안 가로 위치를 **±1px 안에서만** 흔든다.
 * 2px 이상 흔들면 깊이 정보와 섞여서 거짓말이 된다. 좌우는 인셋이 담당한다.
 */
export function lateralJitter(seatNumber: number, maxSeatInRow: number): number {
  if (maxSeatInRow <= 1) return 0;
  const lateral = clamp01((seatNumber - 1) / (maxSeatInRow - 1));
  return Math.round((lateral - 0.5) * 2);
}

/**
 * 좌석 → 캔버스 좌표.
 *
 * 못 그리면 `null` 을 돌려준다. **fallback 좌표를 지어내지 않는다.**
 */
export function seatToXY(
  profile: VenueProfile,
  seat: ParsedSeat | null | undefined,
): Placement | null {
  const hall = hallFor(profile);
  if (!hall || !seat) return null;
  if (seat.floor == null) return null; // 층도 모르면 아무것도 못 한다 → precision 'none'

  const floor = seat.floor;

  // ---- 블록을 못 찾는 경우: 층 대표점으로 내려간다 (§6) ----
  const block = seat.block ? findBlock(profile, floor, seat.block) : null;
  const anchor = seat.block ? findAnchor(hall, floor, seat.block) : null;

  if (!block || !anchor) {
    const fp = hall.floorPoint[floor];
    if (!fp) return null; // 없는 층 (예: 롯데 3층) → 안 그린다
    return {
      x: fp.x,
      y: fp.y,
      side: 'center',
      precision: 'floor',
      geometryConfidence: 'inferred',
      folded: false,
      approx: true,
      blockCode: null,
      floor,
      segment: null,
      warning: seat.block
        ? `${floor}층에 '${seat.block}' 구역이 없어요. 층만 표시할게요.`
        : null,
    };
  }

  const d = depthFraction(block, anchor, seat);
  let x = Math.round(lerp(anchor.near.x, anchor.far.x, d.t));
  const y = Math.round(lerp(anchor.near.y, anchor.far.y, d.t));

  if (d.precision === 'exact' && seat.number != null && anchor.maxSeatInRow) {
    x += lateralJitter(seat.number, anchor.maxSeatInRow);
  }

  const geometryConfidence = block.conf.geometry;

  return {
    x: Math.max(0, Math.min(ART_W - 1, x)),
    y: Math.max(0, Math.min(ART_H - 1, y)),
    side: anchor.side,
    precision: d.precision,
    geometryConfidence,
    folded: anchor.folded,
    approx: geometryConfidence !== 'confirmed',
    blockCode: block.code,
    floor,
    segment: d.precision === 'block' ? { near: anchor.near, far: anchor.far } : null,
    warning: d.warning,
  };
}

/* ------------------------------------------------------------------ *
 * 화면이 쓰는 최종 판정 (§6 표를 그대로 코드로)
 * ------------------------------------------------------------------ */

export type SeatMapStatus =
  /** 아바타를 그린다 */
  | 'ok'
  /** 홀은 안다, 좌석은 모른다 → 실루엣만 */
  | 'seat-unknown'
  /** 이름은 읽혔지만 좌석도가 없는 홀 → 아무것도 안 그린다 */
  | 'unsupported-venue'
  /** 어느 홀인지 모르겠다 → 아무것도 안 그린다 */
  | 'unknown-venue';

export interface SeatMapResolution {
  status: SeatMapStatus;
  profile: VenueProfile | null;
  hall: HallGeometry | null;
  /** status==='ok' 일 때만 non-null */
  placement: Placement | null;
  /** 사용자에게 그대로 보여줘도 되는 한 줄 */
  message: string;
}

/**
 * 공연장 문자열 + 파싱된 좌석 → 무엇을 그릴지.
 *
 * 여기가 "안 그린다"를 강제하는 지점이다. 컴포넌트는 이 함수의 status 만 보고
 * 분기하면 되고, 스스로 fallback 을 만들 수 없다.
 */
export function resolveSeatMap(
  venueString: string | null | undefined,
  seat?: ParsedSeat | null,
): SeatMapResolution {
  const m = matchVenueDetailed(venueString ?? '');

  if (!m.profile) {
    if (m.reason === 'unsupported-venue') {
      return {
        status: 'unsupported-venue',
        profile: null,
        hall: null,
        placement: null,
        message: '이 공연장은 아직 좌석도가 없어요.',
      };
    }
    return {
      status: 'unknown-venue',
      profile: null,
      hall: null,
      placement: null,
      message: '어느 공연장인지 확인하지 못했어요.',
    };
  }

  const hall = hallFor(m.profile);
  if (!hall) {
    return {
      status: 'unsupported-venue',
      profile: m.profile,
      hall: null,
      placement: null,
      message: '이 공연장은 아직 좌석도가 없어요.',
    };
  }

  const placement = seatToXY(m.profile, seat);
  if (!placement) {
    return {
      status: 'seat-unknown',
      profile: m.profile,
      hall,
      placement: null,
      message: '좌석 정보가 없어요.',
    };
  }

  return {
    status: 'ok',
    profile: m.profile,
    hall,
    placement,
    message: describePlacement(m.profile, placement),
  };
}

/** 아바타 옆에 쓸 한 줄. 근사면 `≈` 를 붙인다 (§6). */
export function describePlacement(
  profile: VenueProfile,
  p: Placement,
): string {
  const term = profile.blockTerm;
  const approx = p.approx ? '≈ ' : '';
  switch (p.precision) {
    case 'exact':
      return `${approx}${p.floor}층 ${p.blockCode}${term}`;
    case 'row':
      return `${approx}${p.floor}층 ${p.blockCode}${term}`;
    case 'block':
      return `≈ ${p.floor}층 ${p.blockCode}${term} 어딘가`;
    case 'floor':
      return `≈ ${p.floor}층 어딘가`;
    default:
      return '좌석 정보 없음';
  }
}

/** 무대 상자 **내부**인가. 경계는 내부가 아니다 (§8 불변식). */
export function isInsideStage(p: Pt, stage: Rect): boolean {
  return p.x > stage.x0 && p.x < stage.x1 && p.y > stage.y0 && p.y < stage.y1;
}
