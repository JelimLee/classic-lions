/**
 * seatGeometry.ts — 좌석 → **위에서 본 좌석표(top-down)** 의 9격자 존
 *
 * ⚠️ 브라우저 API 의존 금지. venues.ts / ocrSchema.ts 와 같은 규칙 —
 *    Node 에서 그대로 import 되어야 한다 (테스트가 여기 의존한다).
 *
 * ─────────────────────────────────────────────────────────────────────
 * 이 파일의 제1원칙: **틀리게 그리는 것보다 안 그리는 게 낫다.**
 * ─────────────────────────────────────────────────────────────────────
 * 정보가 모자라면 precision 이 내려가고, 아예 없으면 아무것도 안 그린다.
 * 컴포넌트가 스스로 fallback 좌표를 만들 수 있는 경로는 없다 —
 * 화면은 `resolveSeatMap()` 이 돌려준 status/cell 만 쓴다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 왜 좌석 1개 = 픽셀 1개가 아니라 9격자인가
 * ─────────────────────────────────────────────────────────────────────
 * 좌석 하나하나를 찍으려면 "이 구역의 n번 좌석이 평면 어디냐"를 알아야 한다.
 * 우리가 가진 공식 자료로는 그걸 **구역 단위까지만** 확신할 수 있다.
 * 그래서 각 층을 앞/중/뒤 × 좌/중/우 = 9칸으로 쪼개고, 좌석은 그중 한 칸에
 * 들어간다. 칸 안에서의 정확한 자리는 주장하지 않는다.
 *
 *   무대 뒤(합창석)는 9격자 **밖**이다 — 별도 존 'behind-stage'.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 단면도(cross-section) 는 어디 갔나
 * ─────────────────────────────────────────────────────────────────────
 * services/crossSectionGeometry.ts + components/seatmap/halls/cross-section/
 * 로 통째로 옮겨 보관 중이다. 나중에 세 번째 뷰로 되살릴 수 있다.
 * 단면도의 최대 약점이던 `tier`(층 높이, 51개 블록 전부 추정값)는 top-down
 * 에서는 **아예 안 쓴다.** 높이가 필요 없기 때문이다.
 */

import type { BlockPosition, Confidence, VenueBlock, VenueProfile } from '../data/venues.ts';
import { findBlock, matchVenueDetailed } from '../data/venues.ts';
import type { ParsedSeat } from './ocrSchema.ts';

/* ------------------------------------------------------------------ *
 * 캔버스
 * ------------------------------------------------------------------ *
 * 평면도라서 단면도(160×104)와 달리 **세로로 길다**. 두 공연장 공식 배치도가
 * 전부 세로 그림이고, 사용자가 기억하는 그림도 그쪽이다.
 */

export const ART_W = 128;
export const ART_H = 160;

/** 확대는 정수 배율만. 1.5x/3x 는 아바타 픽셀을 깨뜨린다. */
export type ArtScale = 1 | 2 | 4;

export function pickScale(containerWidth: number): ArtScale {
  return containerWidth >= 512 ? 4 : containerWidth >= 256 ? 2 : 1;
}

/* ------------------------------------------------------------------ *
 * 타입
 * ------------------------------------------------------------------ */

export type Precision = 'exact' | 'row' | 'block' | 'floor' | 'none';

/** 9격자 가로 위치 */
export type Column = 'left' | 'center' | 'right';
/** 9격자 세로(무대로부터의 깊이) 위치 */
export type Band = 'front' | 'mid' | 'rear';

export type GridZone =
  | 'front-left' | 'front-center' | 'front-right'
  | 'mid-left'   | 'mid-center'   | 'mid-right'
  | 'rear-left'  | 'rear-center'  | 'rear-right';

/** 9격자 + 무대 뒤(합창석). 무대 뒤는 격자 밖이다. */
export type Zone = GridZone | 'behind-stage';

export const GRID_ZONES: readonly GridZone[] = [
  'front-left', 'front-center', 'front-right',
  'mid-left', 'mid-center', 'mid-right',
  'rear-left', 'rear-center', 'rear-right',
];

export const ALL_ZONES: readonly Zone[] = [...GRID_ZONES, 'behind-stage'];

export const zoneOf = (band: Band, col: Column): GridZone =>
  `${band}-${col}` as GridZone;

/** 아트 좌표 사각형 */
export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZonePlacement {
  floor: number;
  /** null = 층만 안다 (precision 'floor'). 이때 cell 은 그 층 전체다. */
  zone: Zone | null;
  precision: Precision;
  /** 그릴 자리 (아트 좌표). 아바타는 이 칸 안에 들어간다. */
  cell: Cell;
  /** block.conf.geometry — UI 가 "≈" 를 붙일지 결정 */
  geometryConfidence: Confidence;

  /* ---- 아래는 화면 편의용 파생값. 계약의 핵심은 위 5개다. ---- */
  /** geometryConfidence !== 'confirmed'. UI 는 이 하나만 보면 된다. */
  approx: boolean;
  blockCode: string | null;
  column: Column | null;
  band: Band | null;
  /** 아바타를 놓을 칸 안의 점 (아트 좌표, 발밑) */
  anchor: { x: number; y: number };
  /** 사용자에게 보여줄 경고. 없으면 null */
  warning: string | null;
}

/* ------------------------------------------------------------------ *
 * 블록 → 존 매핑 표
 * ------------------------------------------------------------------ *
 *
 * 근거의 층위:
 *   column  — `venues.ts` 의 position 이 좌우를 말해주면 **그걸 그대로 쓴다**
 *             (side-left→left / side-right→right / mid→center).
 *             position 이 'rear'/'front' 라 좌우를 말해주지 않는 블록만
 *             공식 배치도 이미지를 직접 보고 채웠다.
 *             ⚠️ 알파벳 순서로 좌우를 추측한 항목은 하나도 없다.
 *             (columnConflicts() + 테스트가 이 규칙을 강제한다.)
 *   depth   — 그 층 객석 깊이(0 = 무대 쪽, 1 = 가장 먼 끝) 중 이 블록이
 *             차지하는 구간. 공식 배치도에서 블록이 그려진 범위를 읽었다.
 *   seatSpan— seatAxis==='depth' 인 블록에서 좌석 번호 ↔ 깊이 대응 범위.
 *             venues.ts sourceNote 에 명시된 값만 썼다.
 *
 * 공식 배치도 원본:
 *   docs/seatmaps/lotte_1f.png · lotte_2f.png
 *   docs/seatmaps/sac_official_1f.jpg · sac_official_2f3f.jpg
 */

export interface BlockZoneSpec {
  code: string;
  floor: number;
  column: Column;
  /** [t0, t1] — 그 층 깊이 0..1 안에서 이 블록이 걸쳐 있는 구간 */
  depth: [number, number];
  /** 무대 뒤(합창석)라 9격자 밖이다 */
  behindStage?: boolean;
  /** seatAxis==='depth' 블록의 좌석번호 범위 */
  seatSpan?: [number, number];
  /** rowMin..rowMax 안이지만 실제로는 좌석이 없는 열 */
  missingRows?: readonly number[];
}

/** 롯데 1층 B·D 는 8·16·17·18열에 좌석이 없다 (공식 배치도 직접 판독). */
export const LOTTE_ROW_GAPS: readonly number[] = [8, 16, 17, 18];
/** 예당 1층 A·E 는 14열이 통로라 좌석이 없다 (공식 엑셀 격자). */
export const SAC_ROW_GAPS: readonly number[] = [14];

const LOTTE_ZONES: BlockZoneSpec[] = [
  /* ── 1층 ─────────────────────────────────────────────────────────
     무대가 홀 한가운데. 위쪽(무대 뒤)에 P/LP/RP 합창석, 아래쪽에 A~E,
     무대 좌우에 L/R 측면 터레이스. 알파벳은 A(왼쪽)→E(오른쪽). */
  { code: 'P',  floor: 1, column: 'center', depth: [0, 0], behindStage: true },
  { code: 'LP', floor: 1, column: 'left',   depth: [0, 0], behindStage: true, seatSpan: [1, 17] },
  { code: 'RP', floor: 1, column: 'right',  depth: [0, 0], behindStage: true, seatSpan: [1, 17] },
  // 측면 터레이스: 무대 옆에서 시작해 객석 끝까지 흐른다. 깊이는 좌석 번호.
  { code: 'L',  floor: 1, column: 'left',   depth: [0.00, 0.90], seatSpan: [1, 18] },
  { code: 'R',  floor: 1, column: 'right',  depth: [0.00, 0.90], seatSpan: [1, 18] },
  // 정면 객석: B·C·D 가 1~23열로 층 전체 깊이를 덮고, A·E 는 16열까지만이다.
  { code: 'A',  floor: 1, column: 'left',   depth: [0.00, 0.70] },
  { code: 'B',  floor: 1, column: 'center', depth: [0.00, 1.00], missingRows: LOTTE_ROW_GAPS },
  { code: 'C',  floor: 1, column: 'center', depth: [0.00, 1.00] },
  { code: 'D',  floor: 1, column: 'center', depth: [0.00, 1.00], missingRows: LOTTE_ROW_GAPS },
  { code: 'E',  floor: 1, column: 'right',  depth: [0.00, 0.70] },

  /* ── 2층 ─────────────────────────────────────────────────────────
     긴 측면 발코니 L/R 이 무대 옆을 따라 흐르고, 뒤쪽에 A~E 발코니 한 덩어리.
     A~E 는 position 이 전부 'rear' 라 좌우를 안 알려준다 → 배치도에서 읽었다:
     lotte_2f.png 에서 A(맨 왼쪽) B C D E(맨 오른쪽) 순으로 라벨이 찍혀 있다. */
  { code: 'L',  floor: 2, column: 'left',   depth: [0.00, 0.85], seatSpan: [1, 34] },
  { code: 'R',  floor: 2, column: 'right',  depth: [0.00, 0.85], seatSpan: [1, 34] },
  { code: 'A',  floor: 2, column: 'left',   depth: [0.85, 1.00] },
  { code: 'B',  floor: 2, column: 'center', depth: [0.85, 1.00] },
  { code: 'C',  floor: 2, column: 'center', depth: [0.85, 1.00] },
  { code: 'D',  floor: 2, column: 'center', depth: [0.85, 1.00] },
  { code: 'E',  floor: 2, column: 'right',  depth: [0.85, 1.00] },
];

const SAC_ZONES: BlockZoneSpec[] = [
  /* ── 1층 ─────────────────────────────────────────────────────────
     무대가 한쪽 끝. 그 앞으로 A~E 부채꼴이 1~22열까지 펼쳐진다.
     무대 뒤·옆구리에 합창석 G(정후면) / H(왼쪽 윙) / F(오른쪽 윙). */
  { code: 'A', floor: 1, column: 'left',   depth: [0.00, 1.00], missingRows: SAC_ROW_GAPS },
  { code: 'B', floor: 1, column: 'center', depth: [0.00, 1.00] },
  { code: 'C', floor: 1, column: 'center', depth: [0.00, 1.00] },
  { code: 'D', floor: 1, column: 'center', depth: [0.00, 1.00] },
  { code: 'E', floor: 1, column: 'right',  depth: [0.00, 1.00], missingRows: SAC_ROW_GAPS },
  { code: 'G', floor: 1, column: 'center', depth: [0, 0], behindStage: true },
  { code: 'H', floor: 1, column: 'left',   depth: [0, 0], behindStage: true, seatSpan: [1, 24] },
  { code: 'F', floor: 1, column: 'right',  depth: [0, 0], behindStage: true, seatSpan: [1, 24] },

  /* ── 2층 ─────────────────────────────────────────────────────────
     말굽. A(왼팔)·E(오른팔)이 무대 옆에서 뒤까지 감아 돌고, B·C·D 가 뒤 중앙.
     BOX1~3 은 왼쪽, BOX6~5~4 는 오른쪽. BOX1/BOX6 이 무대에 가장 가깝다.
     ⚠️ 2층 중앙 앞·중간은 좌석이 없다 (1층 위 허공). 그래서 그 칸은 비워 그린다. */
  { code: 'A', floor: 2, column: 'left',   depth: [0.00, 0.85], seatSpan: [1, 20] },
  { code: 'E', floor: 2, column: 'right',  depth: [0.00, 0.85], seatSpan: [1, 20] },
  { code: 'B', floor: 2, column: 'center', depth: [0.80, 1.00] },
  { code: 'C', floor: 2, column: 'center', depth: [0.80, 1.00] },
  { code: 'D', floor: 2, column: 'center', depth: [0.80, 1.00] },
  { code: 'BOX1', floor: 2, column: 'left',  depth: [0.00, 0.10] },
  { code: 'BOX2', floor: 2, column: 'left',  depth: [0.10, 0.20] },
  { code: 'BOX3', floor: 2, column: 'left',  depth: [0.20, 0.30] },
  { code: 'BOX6', floor: 2, column: 'right', depth: [0.00, 0.10] },
  { code: 'BOX5', floor: 2, column: 'right', depth: [0.10, 0.20] },
  { code: 'BOX4', floor: 2, column: 'right', depth: [0.20, 0.30] },

  /* ── 3층 ─────────────────────────────────────────────────────────
     2층과 같은 말굽인데 한 겹 더 뒤. A(왼팔)·G(오른팔).
     B~F 는 position 이 'rear' 라 좌우를 안 알려준다 → sac_official_2f3f.jpg
     에서 라벨 위치를 직접 읽었다: 왼쪽부터 A B / C D E / F G 로 좌우 대칭이고
     (B↔F, C↔E, D 가 정중앙), M·N 은 맨 뒤 한 줄이다. */
  { code: 'A', floor: 3, column: 'left',   depth: [0.00, 0.80], seatSpan: [1, 14] },
  { code: 'G', floor: 3, column: 'right',  depth: [0.00, 0.80], seatSpan: [1, 14] },
  { code: 'B', floor: 3, column: 'left',   depth: [0.70, 0.95] },
  { code: 'C', floor: 3, column: 'center', depth: [0.70, 0.95] },
  { code: 'D', floor: 3, column: 'center', depth: [0.70, 0.95] },
  { code: 'E', floor: 3, column: 'center', depth: [0.70, 0.95] },
  { code: 'F', floor: 3, column: 'right',  depth: [0.70, 0.95] },
  { code: 'M', floor: 3, column: 'center', depth: [0.95, 1.00] },
  { code: 'N', floor: 3, column: 'center', depth: [0.95, 1.00] },
  { code: 'BOX7',  floor: 3, column: 'left',  depth: [0.00, 0.10] },
  { code: 'BOX8',  floor: 3, column: 'left',  depth: [0.10, 0.20] },
  { code: 'BOX9',  floor: 3, column: 'left',  depth: [0.20, 0.30] },
  { code: 'BOX12', floor: 3, column: 'right', depth: [0.00, 0.10] },
  { code: 'BOX11', floor: 3, column: 'right', depth: [0.10, 0.20] },
  { code: 'BOX10', floor: 3, column: 'right', depth: [0.20, 0.30] },
];

/* ------------------------------------------------------------------ *
 * 층 평면 (아트 좌표)
 * ------------------------------------------------------------------ *
 * 9칸을 **균등 격자로 자르지 않는다.** 롯데 1층의 측면 터레이스는 무대 옆까지
 * 올라오고, 예당 1층은 뒤로 갈수록 넓어지는 부채꼴이다. 칸 자체가 홀 모양을
 * 말하도록 손으로 맞췄다. (그림과 좌표가 같은 표를 쓰므로 아바타가 칸 밖에
 * 앉을 수 없다.)
 */

export interface FloorPlan {
  floor: number;
  /** 홀 외곽선 path (아트 좌표) */
  outline: string;
  /** 무대 사각형 */
  stage: Cell;
  /** 이 층에서 무대가 같은 높이인가 (false = 아래층 무대를 내려다봄 → 흐리게) */
  stageOnThisFloor: boolean;
  cells: Record<GridZone, Cell>;
  /** 무대 뒤 존. 그 층에 합창석이 없으면 null */
  behindStage: Cell | null;
  /** 층 전체 강조용 상자 (precision 'floor') */
  bounds: Cell;
}

export interface HallPlan {
  venueId: string;
  floors: Record<number, FloorPlan>;
}

const LOTTE_PLAN: HallPlan = {
  venueId: 'lotte-concert-hall',
  floors: {
    1: {
      floor: 1,
      // 빈야드 — 무대를 둘러싼 통 모양. 위가 무대 뒤(파이프오르간), 아래가 정면 객석.
      outline: 'M32 4 H96 L118 28 V128 L98 156 H30 L10 128 V28 Z',
      stage: { x: 40, y: 44, w: 48, h: 26 },
      stageOnThisFloor: true,
      behindStage: { x: 22, y: 14, w: 84, h: 26 },
      cells: {
        // 측면 터레이스는 무대 옆구리까지 올라온다 (lotte_1f.png 의 L/R)
        'front-left':   { x: 8,  y: 46,  w: 26, h: 54 },
        'front-center': { x: 40, y: 76,  w: 48, h: 24 },
        'front-right':  { x: 94, y: 46,  w: 26, h: 54 },
        'mid-left':     { x: 10, y: 104, w: 26, h: 24 },
        'mid-center':   { x: 40, y: 104, w: 48, h: 24 },
        'mid-right':    { x: 92, y: 104, w: 26, h: 24 },
        'rear-left':    { x: 14, y: 130, w: 26, h: 24 },
        'rear-center':  { x: 44, y: 130, w: 40, h: 24 },
        'rear-right':   { x: 88, y: 130, w: 26, h: 24 },
      },
      bounds: { x: 8, y: 44, w: 112, h: 112 },
    },
    2: {
      floor: 2,
      outline: 'M32 4 H96 L118 28 V128 L98 156 H30 L10 128 V28 Z',
      stage: { x: 42, y: 26, w: 44, h: 20 },
      stageOnThisFloor: false,
      behindStage: null, // 롯데 2층에는 P·LP·RP 가 없다 (공식 게이트안내)
      cells: {
        'front-left':   { x: 8,  y: 34,  w: 24, h: 50 },
        'front-center': { x: 40, y: 56,  w: 48, h: 28 }, // 좌석 없음 (1층 위 허공)
        'front-right':  { x: 96, y: 34,  w: 24, h: 50 },
        'mid-left':     { x: 8,  y: 88,  w: 24, h: 26 },
        'mid-center':   { x: 40, y: 88,  w: 48, h: 26 }, // 좌석 없음
        'mid-right':    { x: 96, y: 88,  w: 24, h: 26 },
        'rear-left':    { x: 12, y: 118, w: 28, h: 30 },
        'rear-center':  { x: 44, y: 118, w: 40, h: 30 },
        'rear-right':   { x: 88, y: 118, w: 28, h: 30 },
      },
      bounds: { x: 8, y: 26, w: 112, h: 122 },
    },
  },
};

const SAC_PLAN: HallPlan = {
  venueId: 'sac-concert-hall',
  floors: {
    1: {
      floor: 1,
      // 무대가 한쪽 끝. 객석이 뒤로 갈수록 넓어지는 부채꼴.
      outline: 'M34 4 H94 L100 34 L120 148 L116 156 H12 L8 148 L28 34 Z',
      stage: { x: 40, y: 26, w: 48, h: 16 },
      stageOnThisFloor: true,
      behindStage: { x: 30, y: 6, w: 68, h: 16 },
      cells: {
        'front-left':   { x: 24, y: 52,  w: 26, h: 32 },
        'front-center': { x: 52, y: 52,  w: 24, h: 32 },
        'front-right':  { x: 78, y: 52,  w: 26, h: 32 },
        'mid-left':     { x: 18, y: 88,  w: 29, h: 30 },
        'mid-center':   { x: 49, y: 88,  w: 30, h: 30 },
        'mid-right':    { x: 81, y: 88,  w: 29, h: 30 },
        'rear-left':    { x: 12, y: 122, w: 32, h: 30 },
        'rear-center':  { x: 46, y: 122, w: 36, h: 30 },
        'rear-right':   { x: 84, y: 122, w: 32, h: 30 },
      },
      bounds: { x: 12, y: 52, w: 104, h: 100 },
    },
    2: {
      floor: 2,
      outline: 'M34 4 H94 L104 30 L120 140 L114 154 H14 L8 140 L24 30 Z',
      stage: { x: 40, y: 8, w: 48, h: 14 },
      stageOnThisFloor: false,
      behindStage: null, // 예당 합창석 F·G·H 는 1층에만 있다
      cells: {
        'front-left':   { x: 8,  y: 28,  w: 22, h: 44 },
        'front-center': { x: 40, y: 28,  w: 48, h: 24 }, // 좌석 없음
        'front-right':  { x: 98, y: 28,  w: 22, h: 44 },
        'mid-left':     { x: 8,  y: 76,  w: 24, h: 34 },
        'mid-center':   { x: 40, y: 76,  w: 48, h: 34 }, // 좌석 없음
        'mid-right':    { x: 96, y: 76,  w: 24, h: 34 },
        'rear-left':    { x: 12, y: 114, w: 30, h: 36 },
        'rear-center':  { x: 46, y: 114, w: 36, h: 36 },
        'rear-right':   { x: 86, y: 114, w: 30, h: 36 },
      },
      bounds: { x: 8, y: 28, w: 112, h: 122 },
    },
    3: {
      floor: 3,
      outline: 'M34 4 H94 L106 28 L122 138 L116 154 H12 L6 138 L22 28 Z',
      stage: { x: 42, y: 6, w: 44, h: 12 },
      stageOnThisFloor: false,
      behindStage: null,
      cells: {
        'front-left':   { x: 8,  y: 24,  w: 22, h: 44 },
        'front-center': { x: 40, y: 24,  w: 48, h: 22 }, // 좌석 없음
        'front-right':  { x: 98, y: 24,  w: 22, h: 44 },
        'mid-left':     { x: 8,  y: 72,  w: 24, h: 34 },
        'mid-center':   { x: 40, y: 72,  w: 48, h: 34 }, // 좌석 없음
        'mid-right':    { x: 96, y: 72,  w: 24, h: 34 },
        'rear-left':    { x: 12, y: 110, w: 30, h: 40 },
        'rear-center':  { x: 46, y: 110, w: 36, h: 40 },
        'rear-right':   { x: 86, y: 110, w: 30, h: 40 },
      },
      bounds: { x: 8, y: 24, w: 114, h: 126 },
    },
  },
};

export const PLANS: Record<string, HallPlan> = {
  'lotte-concert-hall': LOTTE_PLAN,
  'sac-concert-hall': SAC_PLAN,
};

export const ZONE_SPECS: Record<string, BlockZoneSpec[]> = {
  'lotte-concert-hall': LOTTE_ZONES,
  'sac-concert-hall': SAC_ZONES,
};

export function planFor(profile: VenueProfile | null): HallPlan | null {
  if (!profile) return null;
  return PLANS[profile.id] ?? null;
}

export function floorPlanFor(plan: HallPlan, floor: number): FloorPlan | null {
  return plan.floors[floor] ?? null;
}

export function findZoneSpec(
  venueId: string,
  floor: number,
  code: string,
): BlockZoneSpec | null {
  const c = code.trim().toUpperCase();
  const specs = ZONE_SPECS[venueId];
  if (!specs) return null;
  return specs.find((s) => s.floor === floor && s.code === c) ?? null;
}

/** 그 칸의 중앙 (아바타 발밑 기준점) */
export function cellAnchor(cell: Cell): { x: number; y: number } {
  return {
    x: Math.round(cell.x + cell.w / 2),
    y: Math.round(cell.y + cell.h / 2 + 3),
  };
}

/**
 * 그 층에서 **실제로 좌석이 있는** 존들.
 * 표에서 파생시킨다 — 손으로 관리하는 두 번째 목록을 만들지 않는다.
 * (2층 중앙처럼 비어 있는 칸을 좌석으로 그리면 거짓말이 된다.)
 */
export function occupiedZones(venueId: string, floor: number): Set<Zone> {
  const out = new Set<Zone>();
  const specs = ZONE_SPECS[venueId] ?? [];
  for (const s of specs) {
    if (s.floor !== floor) continue;
    if (s.behindStage) {
      out.add('behind-stage');
      continue;
    }
    for (const t of [s.depth[0], (s.depth[0] + s.depth[1]) / 2, s.depth[1]]) {
      out.add(zoneOf(bandOf(t), s.column));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 매핑
 * ------------------------------------------------------------------ */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (p: number, q: number, t: number) => p + (q - p) * t;

/** 깊이 비율 → 앞/중/뒤. 경계는 1/3, 2/3. */
export function bandOf(t: number): Band {
  const v = clamp01(t);
  return v < 1 / 3 ? 'front' : v < 2 / 3 ? 'mid' : 'rear';
}

/** rowMin..rowMax 에서 실제로 존재하는 열만. 없는 열을 균등 보간하지 않기 위한 것. */
export function presentRows(block: VenueBlock, spec: BlockZoneSpec): number[] {
  if (block.rowMin == null || block.rowMax == null) return [];
  const gaps = new Set(spec.missingRows ?? []);
  const out: number[] = [];
  for (let r = block.rowMin; r <= block.rowMax; r++) if (!gaps.has(r)) out.push(r);
  return out;
}

interface DepthResult {
  /** 블록 안에서의 위치 0..1 */
  u: number;
  precision: Precision;
  warning: string | null;
}

/**
 * 블록 안에서의 깊이 비율 u (0 = 블록의 무대 쪽 끝, 1 = 먼 끝).
 *
 * 판정 순서가 곧 정확도다:
 *   (0) 열 번호 체계를 모른다 (BOX)             → 블록 한가운데
 *   (1) 깊이 축이 **좌석 번호**인 블록           → 좌석 번호로 잰다
 *   (2) 깊이 축이 **열**인 블록 (대부분의 객석)  → 열로 잰다
 *   (3) 나머지                                   → 블록 한가운데
 *
 * ⚠️ (1)이 (2)보다 먼저인 이유: 예당 2층 A/E·3층 A/G 는 rowAxis 도 'depth'
 *    지만 실제 깊이는 좌석 번호다(열 1~8 은 발코니 폭). (2)를 먼저 태우면
 *    무대를 감아 도는 긴 팔이 열 8칸 안에 뭉개진다.
 */
function depthWithinBlock(
  block: VenueBlock,
  spec: BlockZoneSpec,
  seat: ParsedSeat,
): DepthResult {
  const mid: DepthResult = { u: 0.5, precision: 'block', warning: null };

  // (0) 열 번호 체계 자체를 모른다 → 열 보간을 하지 마라
  if (block.conf.rows === 'unknown' && block.seatAxis !== 'depth') return mid;

  // (1) 좌석 번호가 깊이인 블록
  if (block.seatAxis === 'depth' && spec.seatSpan) {
    if (seat.number == null) return mid; // 이 블록에서 열은 깊이가 아니다
    const [s0, s1] = spec.seatSpan;
    const raw = clamp01((seat.number - s0) / Math.max(1, s1 - s0));
    // ⚠️ 좌우 대칭 짝이라도 방향이 반대일 수 있다 (예당 2층 A away / E toward).
    const u = block.seatDepthDir === 'toward' ? 1 - raw : raw;
    return { u, precision: 'exact', warning: null };
  }

  // (2) 열이 곧 깊이인 블록 — 대부분의 정면 객석
  if (
    block.rowAxis === 'depth' &&
    typeof seat.row === 'number' &&
    block.rowMin != null &&
    block.rowMax != null
  ) {
    const rows = presentRows(block, spec);
    const idx = rows.indexOf(seat.row);

    if (idx < 0) {
      const gaps = spec.missingRows ?? [];
      if (gaps.includes(seat.row)) {
        // 없는 자리다. 그럴듯하게 찍지 말고 블록 한가운데로 내린다.
        return {
          u: 0.5,
          precision: 'block',
          warning: `${block.code}구역엔 ${seat.row}열이 없어요 (통로/단차). 읽은 값이 틀렸을 수 있어요.`,
        };
      }
      return {
        u: 0.5,
        precision: 'block',
        warning: `${block.code}구역은 ${block.rowMin}~${block.rowMax}열까지예요. ${seat.row}열은 범위 밖이에요.`,
      };
    }

    const u = rows.length <= 1 ? 0.5 : idx / (rows.length - 1);
    return { u, precision: seat.number != null ? 'exact' : 'row', warning: null };
  }

  // (3) 블록만 안다
  return mid;
}

/**
 * 좌석 → 9격자 존.
 *
 * 못 그리면 `null` 을 돌려준다. **fallback 좌표를 지어내지 않는다.**
 */
export function seatToZone(
  profile: VenueProfile,
  seat: ParsedSeat | null | undefined,
): ZonePlacement | null {
  const plan = planFor(profile);
  if (!plan || !seat) return null;
  if (seat.floor == null) return null; // 층도 모르면 precision 'none'

  const floor = seat.floor;
  const fp = floorPlanFor(plan, floor);
  if (!fp) return null; // 없는 층 (예: 롯데 3층) → 안 그린다

  const block = seat.block ? findBlock(profile, floor, seat.block) : null;
  const spec = seat.block ? findZoneSpec(plan.venueId, floor, seat.block) : null;

  // ---- 블록을 못 찾는 경우: 층 전체로 내려간다 ----
  if (!block || !spec) {
    return {
      floor,
      zone: null,
      precision: 'floor',
      cell: fp.bounds,
      geometryConfidence: 'inferred',
      approx: true,
      blockCode: null,
      column: null,
      band: null,
      anchor: cellAnchor(fp.bounds),
      warning: seat.block
        ? `${floor}층에 '${seat.block}' 구역이 없어요. 층만 표시할게요.`
        : null,
    };
  }

  const d = depthWithinBlock(block, spec, seat);

  // ---- 무대 뒤는 9격자 밖 ----
  if (spec.behindStage) {
    const cell = fp.behindStage ?? fp.bounds;
    return {
      floor,
      zone: 'behind-stage',
      // 무대 뒤 존은 한 칸뿐이라 열/번을 알아도 칸이 더 좁아지지 않는다.
      // 그래도 precision 은 "어디까지 읽었는지"를 뜻하므로 그대로 전달한다.
      precision: d.precision,
      cell,
      geometryConfidence: block.conf.geometry,
      approx: block.conf.geometry !== 'confirmed',
      blockCode: block.code,
      column: null,
      band: null,
      anchor: cellAnchor(cell),
      warning: d.warning,
    };
  }

  const t = lerp(spec.depth[0], spec.depth[1], d.u);
  const band = bandOf(t);
  const zone = zoneOf(band, spec.column);
  const cell = fp.cells[zone];

  return {
    floor,
    zone,
    precision: d.precision,
    cell,
    geometryConfidence: block.conf.geometry,
    approx: block.conf.geometry !== 'confirmed',
    blockCode: block.code,
    column: spec.column,
    band,
    anchor: cellAnchor(cell),
    warning: d.warning,
  };
}

/* ------------------------------------------------------------------ *
 * 화면이 쓰는 최종 판정
 * ------------------------------------------------------------------ */

export type SeatMapStatus =
  /** 아바타를 그린다 */
  | 'ok'
  /** 홀은 안다, 좌석은 모른다 → 평면도만 */
  | 'seat-unknown'
  /** 이름은 읽혔지만 좌석도가 없는 홀 → 아무것도 안 그린다 */
  | 'unsupported-venue'
  /** 어느 홀인지 모르겠다 → 아무것도 안 그린다 */
  | 'unknown-venue';

export interface SeatMapResolution {
  status: SeatMapStatus;
  profile: VenueProfile | null;
  plan: HallPlan | null;
  /** status 가 ok / seat-unknown 일 때 그릴 층 평면. 좌석을 모르면 기본 층. */
  floorPlan: FloorPlan | null;
  /** status==='ok' 일 때만 non-null */
  placement: ZonePlacement | null;
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
    return {
      status: m.reason === 'unsupported-venue' ? 'unsupported-venue' : 'unknown-venue',
      profile: null,
      plan: null,
      floorPlan: null,
      placement: null,
      message:
        m.reason === 'unsupported-venue'
          ? '이 공연장은 아직 좌석도가 없어요.'
          : '어느 공연장인지 확인하지 못했어요.',
    };
  }

  const plan = planFor(m.profile);
  if (!plan) {
    return {
      status: 'unsupported-venue',
      profile: m.profile,
      plan: null,
      floorPlan: null,
      placement: null,
      message: '이 공연장은 아직 좌석도가 없어요.',
    };
  }

  const placement = seatToZone(m.profile, seat);
  if (!placement) {
    return {
      status: 'seat-unknown',
      profile: m.profile,
      plan,
      floorPlan: floorPlanFor(plan, 1),
      placement: null,
      message: '좌석 정보가 없어요.',
    };
  }

  return {
    status: 'ok',
    profile: m.profile,
    plan,
    floorPlan: floorPlanFor(plan, placement.floor),
    placement,
    message: describePlacement(m.profile, placement),
  };
}

const ZONE_KO: Record<Zone, string> = {
  'front-left': '앞쪽 왼편',
  'front-center': '앞쪽 가운데',
  'front-right': '앞쪽 오른편',
  'mid-left': '중간 왼편',
  'mid-center': '중간 가운데',
  'mid-right': '중간 오른편',
  'rear-left': '뒤쪽 왼편',
  'rear-center': '뒤쪽 가운데',
  'rear-right': '뒤쪽 오른편',
  'behind-stage': '무대 뒤 합창석',
};

export function zoneLabel(zone: Zone | null): string {
  return zone ? ZONE_KO[zone] : '';
}

/** 아바타 옆에 쓸 한 줄. 근사면 `≈` 를 붙인다. */
export function describePlacement(
  profile: VenueProfile,
  p: ZonePlacement,
): string {
  const term = profile.blockTerm;
  const approx = p.approx ? '≈ ' : '';
  const where = zoneLabel(p.zone);
  switch (p.precision) {
    case 'exact':
    case 'row':
      return `${approx}${p.floor}층 ${p.blockCode}${term} · ${where}`;
    case 'block':
      return `≈ ${p.floor}층 ${p.blockCode}${term} 어딘가 · ${where}`;
    case 'floor':
      return `≈ ${p.floor}층 어딘가`;
    default:
      return '좌석 정보 없음';
  }
}

/* ------------------------------------------------------------------ *
 * 불변식 (테스트가 이걸 부른다)
 * ------------------------------------------------------------------ */

/** 칸이 캔버스 안에 있는가 */
export function cellInsideCanvas(c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.w > 0 && c.h > 0 && c.x + c.w <= ART_W && c.y + c.h <= ART_H;
}

/** 두 사각형이 겹치는가 (경계 접촉은 겹침이 아니다) */
export function overlaps(a: Cell, b: Cell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * `column` 이 venues.ts 의 position 과 어긋나지 않는지 검사한다.
 * position 이 좌우를 말해주는 값(side-left/side-right/mid)일 때만 강제한다.
 * 나머지(front/rear/behind-stage)는 position 이 좌우 정보를 안 담고 있으므로
 * 공식 배치도에서 읽은 값을 그대로 둔다.
 */
const POSITION_COLUMN: Partial<Record<BlockPosition, Column>> = {
  'side-left': 'left',
  'side-right': 'right',
  mid: 'center',
};

export function columnConflicts(
  profile: VenueProfile,
): { code: string; floor: number; position: BlockPosition; column: Column }[] {
  const out: { code: string; floor: number; position: BlockPosition; column: Column }[] = [];
  for (const b of profile.blocks) {
    const spec = findZoneSpec(profile.id, b.floor, b.code);
    if (!spec) continue;
    const expected = POSITION_COLUMN[b.position];
    if (expected && expected !== spec.column) {
      out.push({ code: b.code, floor: b.floor, position: b.position, column: spec.column });
    }
  }
  return out;
}
