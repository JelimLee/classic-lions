/**
 * stageView.ts — "이 자리에서 본 무대" 화면이 VR 자산을 만나는 **단 하나의 지점**
 *
 * ─────────────────────────────────────────────────────────────────────
 * 왜 이런 우회가 필요한가
 * ─────────────────────────────────────────────────────────────────────
 * 좌석 시야 자산(`data/vrPoints.ts`, `assets/vr/*`)은 **다른 담당이 만드는 중**이라
 * 아직 없을 수 있다. 그런데 없는 모듈을 `import` 하면 tsc 도 vite 빌드도 즉시
 * 깨진다. 그래서 여기서 `import.meta.glob` 으로 **있으면 쓰고 없으면 조용히
 * 준비 중**으로 넘어간다. 파일이 들어오는 순간 이 파일을 고치지 않아도 켜진다.
 *
 * 다른 파일에서 vrPoints 를 직접 import 하지 말 것. 그러면 이 안전장치가
 * 무의미해진다. 화면(StageView.tsx)은 이 모듈만 본다.
 *
 * 기대하는 계약 (다른 담당이 공지한 시그니처):
 *   export function nearestVRPoint(venueId: string, seat: ParsedSeat): VRPoint | null;
 * 실제로 들어온 모듈에는 자산 URL까지 해결해 주는 짝이 하나 더 있다:
 *   export function nearestVRPointResolved(...): ResolvedVRPoint | null;  // + image
 * `image` 가 있어야 <img> 로 그릴 수 있으므로 **Resolved 쪽을 먼저** 찾는다.
 */

import type { ParsedSeat } from './ocrSchema.ts';

/**
 * VR 지점의 **최소** 형태. 실제 타입은 data/vrPoints.ts 가 소유한다.
 * 여기서는 화면이 쓰는 필드만 느슨하게 받는다 — 남의 타입을 지어내지 않는다.
 */
export interface VRPointLike {
  id?: string;
  venueId?: string;
  floor?: number | null;
  block?: string | null;
  row?: number | null;
  number?: number | null;
  /** 번들러가 해결한 시야 이미지 URL. 자산이 없으면 null 일 수 있다. */
  image?: string | null;
  /** 자산 폴더 기준 상대 경로 (image 가 없을 때의 원본 힌트) */
  asset?: string;
  label?: string;
  [k: string]: unknown;
}

type NearestFn = (venueId: string, seat: ParsedSeat) => VRPointLike | null;

/**
 * 파일이 없으면 빈 객체가 된다 (vite 는 매칭 0개를 에러로 보지 않는다).
 *
 * ⚠️ `typeof import.meta.glob === 'function'` 으로 미리 재보지 말 것.
 *    `import.meta.glob` 은 **컴파일 타임 매크로**다. vite 가 이 호출을
 *    `Object.assign({...})` 로 통째로 바꿔치기하고, 런타임 `import.meta` 에는
 *    glob 이라는 속성이 아예 없다. 그래서 그 검사는 vite 에서도 항상 false 가 되어
 *    자산이 멀쩡히 있어도 "준비 중"으로 떨어진다. (실제로 한 번 그렇게 당했다.)
 *    Node(테스트)에서는 이 호출이 TypeError 를 던지므로 try/catch 로 받는다.
 */
function vrLoaders(): Record<string, () => Promise<unknown>> {
  try {
    // @ts-ignore vite 전용 컴파일 타임 API (tsconfig types 에 vite/client 가 없다)
    return import.meta.glob('../data/vrPoint*.ts') as Record<string, () => Promise<unknown>>;
  } catch {
    return {};
  }
}

export type StageViewState =
  /** 자산이 아직 없다 → "준비 중" 자리만 보여준다 */
  | { kind: 'pending' }
  /** 자산은 있는데 이 좌석 근처에 지점이 없다 */
  | { kind: 'no-point' }
  | { kind: 'ready'; point: VRPointLike };

let cached: NearestFn | null | undefined;

/** 모듈을 한 번만 읽어 캐시한다. 없으면 null. */
export async function loadNearestVRPoint(): Promise<NearestFn | null> {
  if (cached !== undefined) return cached;
  const loaders = Object.values(vrLoaders());
  if (loaders.length === 0) {
    cached = null;
    return null;
  }
  try {
    const mod = (await loaders[0]()) as {
      nearestVRPointResolved?: unknown;
      nearestVRPoint?: unknown;
    };
    const fn = mod.nearestVRPointResolved ?? mod.nearestVRPoint;
    cached = typeof fn === 'function' ? (fn as NearestFn) : null;
  } catch {
    // 자산이 반쯤 들어와서 import 가 실패해도 화면은 죽지 않는다.
    cached = null;
  }
  return cached;
}

export async function resolveStageView(
  venueId: string,
  seat: ParsedSeat | null | undefined,
): Promise<StageViewState> {
  const fn = await loadNearestVRPoint();
  if (!fn) return { kind: 'pending' };
  if (!seat) return { kind: 'no-point' };
  try {
    const p = fn(venueId, seat);
    return p ? { kind: 'ready', point: p } : { kind: 'no-point' };
  } catch {
    return { kind: 'pending' };
  }
}

/**
 * 편성별 오케스트라 배치(협주곡/교향곡/독주에 따라 무대 위 연주자 픽셀이 달라짐)
 * 는 **다음 라운드**다. 지금은 화면에 자리만 잡아둔다.
 * 들어올 때 이 타입부터 채우고 StageView.tsx 의 OrchestraOverlay 를 구현하면 된다.
 */
export type Ensemble = 'concerto' | 'symphony' | 'recital' | 'chamber' | 'unknown';

export const ENSEMBLE_KO: Record<Ensemble, string> = {
  concerto: '협주곡',
  symphony: '교향곡',
  recital: '독주',
  chamber: '실내악',
  unknown: '편성 미상',
};
