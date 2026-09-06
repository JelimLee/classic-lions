/**
 * parts.ts — DiceBear pixel-art 파트/색상 상수 + AvatarConfig 직렬화 (순수 TS)
 *
 * 브라우저 API를 쓰지 않는다(ocrSchema.ts와 같은 규칙). 그래야 node --test 에서
 * 그대로 돌릴 수 있다. React 의존도 없다 — 컴포넌트는 Avatar.tsx.
 *
 * 근거: docs/RESEARCH_seat_avatar.md §4.2~4.4 (설치된 정의 JSON 실측)
 *   - 캔버스 16×16, shape-rendering="crispEdges" 내장
 *   - 아트 CC0 1.0 (귀속 불필요), 코드 MIT
 *   - @dicebear/collection 9.4.2 로 고정. v10은 패키지·API가 전부 다르다.
 *
 * ⚠️ 파트는 **인덱스가 아니라 이름 문자열**로 저장한다. 인덱스로 저장하면
 *    라이브러리가 variant를 추가/재정렬했을 때 조용히 다른 그림이 된다.
 *    이름은 사라지면 명시적으로 실패하므로 감지할 수 있다.
 */

import { createAvatar } from '@dicebear/core';
import { pixelArt } from '@dicebear/collection';

/** 저장된 아바타가 어느 정의로 그려졌는지. 불일치 감지용. */
export const AVATAR_STYLE_VERSION = 'dicebear-pixel-art@9.4.2';
/** pixel-art 원본 캔버스. 표시 크기는 이 값의 정수배를 권장한다. */
export const AVATAR_CANVAS = 16;

/* ------------------------------------------------------------------ *
 * 파트 목록 — 설치된 pixelArt.schema 에서 뽑아 오름차순 고정
 * (일치 여부는 services/__tests__/avatar.test.ts 가 매 실행마다 검증한다)
 * ------------------------------------------------------------------ */

export const HAIR_VARIANTS = ["long01","long02","long03","long04","long05","long06","long07","long08","long09","long10","long11","long12","long13","long14","long15","long16","long17","long18","long19","long20","long21","short01","short02","short03","short04","short05","short06","short07","short08","short09","short10","short11","short12","short13","short14","short15","short16","short17","short18","short19","short20","short21","short22","short23","short24"];
export const EYES_VARIANTS = ["variant01","variant02","variant03","variant04","variant05","variant06","variant07","variant08","variant09","variant10","variant11","variant12"];
export const MOUTH_VARIANTS = ["happy01","happy02","happy03","happy04","happy05","happy06","happy07","happy08","happy09","happy10","happy11","happy12","happy13","sad01","sad02","sad03","sad04","sad05","sad06","sad07","sad08","sad09","sad10"];
export const CLOTHES_VARIANTS = ["variant01","variant02","variant03","variant04","variant05","variant06","variant07","variant08","variant09","variant10","variant11","variant12","variant13","variant14","variant15","variant16","variant17","variant18","variant19","variant20","variant21","variant22","variant23"];
export const BEARD_VARIANTS = ["variant01","variant02","variant03","variant04","variant05","variant06","variant07","variant08"];
export const GLASSES_VARIANTS = ["dark01","dark02","dark03","dark04","dark05","dark06","dark07","light01","light02","light03","light04","light05","light06","light07"];
export const HAT_VARIANTS = ["variant01","variant02","variant03","variant04","variant05","variant06","variant07","variant08","variant09","variant10"];
export const ACCESSORIES_VARIANTS = ["variant01","variant02","variant03","variant04"];

/** DiceBear 옵션 키 ≠ 우리 필드명. clothes → clothing 만 다르다. */
export const PART_TO_DICEBEAR = {
  hair: 'hair',
  eyes: 'eyes',
  mouth: 'mouth',
  clothes: 'clothing',
  beard: 'beard',
  glasses: 'glasses',
  hat: 'hat',
  accessories: 'accessories',
} as const;

export type PartKey = keyof typeof PART_TO_DICEBEAR;

export const PART_VARIANTS: Record<PartKey, string[]> = {
  hair: HAIR_VARIANTS,
  eyes: EYES_VARIANTS,
  mouth: MOUTH_VARIANTS,
  clothes: CLOTHES_VARIANTS,
  beard: BEARD_VARIANTS,
  glasses: GLASSES_VARIANTS,
  hat: HAT_VARIANTS,
  accessories: ACCESSORIES_VARIANTS,
};

/** 벗을 수 있는 파트 (undefined = 미착용). 나머지는 항상 있어야 한다. */
export const OPTIONAL_PARTS: PartKey[] = ['hat', 'glasses', 'beard', 'accessories'];
export const REQUIRED_PARTS: PartKey[] = ['hair', 'eyes', 'mouth', 'clothes'];

/* ------------------------------------------------------------------ *
 * 색상 팔레트 8종 — 팔레트 인덱스가 아니라 hex 원문을 저장한다
 * ------------------------------------------------------------------ */

export const PALETTES = {
  skin: ['#ffdbac', '#f5cfa0', '#eac393', '#e0b687', '#cb9e6e', '#b68655', '#a26d3d', '#8d5524'],
  hair: ['#cab188', '#603a14', '#83623b', '#a78961', '#611c17', '#603015', '#612616', '#28150a', '#009bbd', '#bd1700', '#91cb15'],
  clothes: ['#5bc0de', '#428bca', '#03396c', '#88d8b0', '#44c585', '#00b159', '#ff6f69', '#d11141', '#ae0001', '#ffeead', '#ffd969', '#ffc425'],
  hat: ['#2e1e05', '#2663a3', '#989789', '#3d8a6b', '#cc6192', '#614f8a', '#a62116'],
  eyes: ['#76778b', '#697b94', '#647b90', '#5b7c8b', '#588387', '#876658'],
  glasses: ['#4b4b4b', '#323232', '#191919', '#43677d', '#5f705c', '#a04b5d'],
  accessories: ['#daa520', '#ffd700', '#fafad2', '#d3d3d3', '#a9a9a9'],
  mouth: ['#d29985', '#c98276', '#e35d6a', '#de0f0d'],
} as const;

export type PaletteKey = keyof typeof PALETTES;

/**
 * 색상을 아직 고르지 않은 파트의 기본 색.
 * 모자만 팔레트 첫 값(#2e1e05, 거의 검정)이 어두운 UI에서 안 보여 두 번째 값을 쓴다.
 */
export const DEFAULT_PART_COLORS = {
  eyes: PALETTES.eyes[0],
  mouth: PALETTES.mouth[0],
  hat: PALETTES.hat[1],
  glasses: PALETTES.glasses[0],
  accessories: PALETTES.accessories[0],
} as const;

/* ------------------------------------------------------------------ *
 * 설정 스키마
 * ------------------------------------------------------------------ */

export interface AvatarConfig {
  hair: string;          // 파트 '이름' 문자열 (예: 'long01') — 인덱스 금지
  hairColor: string;     // hex
  skinColor: string;
  clothes: string;
  clothesColor: string;
  eyes: string;
  mouth: string;
  accessories?: string;
  hat?: string;
  beard?: string;
  glasses?: string;
  styleVersion: string;  // 예: 'dicebear-pixel-art@9.4.2'
  /** 계약 밖의 선택 색상. 없으면 팔레트 기본값을 쓴다. */
  eyesColor?: string;
  mouthColor?: string;
  hatColor?: string;
  glassesColor?: string;
  accessoriesColor?: string;
}

export const DEFAULT_AVATAR: AvatarConfig = {
  hair: 'long01',
  hairColor: '#603a14',
  skinColor: '#eac393',
  clothes: 'variant01',
  clothesColor: '#428bca',
  eyes: 'variant01',
  mouth: 'happy01',
  styleVersion: AVATAR_STYLE_VERSION,
};

/* ------------------------------------------------------------------ *
 * hex 정규화
 * ------------------------------------------------------------------ */

const HEX6 = /^#?([0-9a-fA-F]{6})$/;

/** '#RRGGBB' 로 정규화. 못 읽으면 null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = HEX6.exec(value.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** DiceBear v9 는 '#' 없는 6자리를 받는다. */
function toDiceBearHex(value: string): string {
  return value.replace(/^#/, '').toLowerCase();
}

/* ------------------------------------------------------------------ *
 * 검증 / 마이그레이션
 * ------------------------------------------------------------------ */

export interface NormalizeResult {
  config: AvatarConfig;
  /** 사용자에게 보여줄 경고 (버전 불일치, 사라진 파트 등) */
  warnings: string[];
  /** 값이 하나라도 교정됐는가 */
  changed: boolean;
}

function pickVariant(part: PartKey, value: unknown): string | null {
  return typeof value === 'string' && PART_VARIANTS[part].includes(value) ? value : null;
}

/**
 * 저장소에서 읽은 값을 믿지 않고 정규화한다.
 * - 없는 파트 이름 → 기본값으로 되돌리고 경고
 * - styleVersion 불일치 → 그림이 달라질 수 있다고 경고 (값은 현재 버전으로 갱신)
 */
export function normalizeAvatarConfig(raw: unknown): NormalizeResult {
  const warnings: string[] = [];
  let changed = false;
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<AvatarConfig>;

  if (!raw || typeof raw !== 'object') {
    return { config: { ...DEFAULT_AVATAR }, warnings, changed: raw != null };
  }

  const out: AvatarConfig = { ...DEFAULT_AVATAR };

  for (const part of REQUIRED_PARTS) {
    const v = pickVariant(part, src[part]);
    if (v) out[part] = v;
    else {
      changed = true;
      if (src[part] != null) warnings.push(`'${part}' 파트 "${String(src[part])}" 를 현재 스타일에서 찾을 수 없어 기본값으로 되돌렸습니다.`);
    }
  }

  for (const part of OPTIONAL_PARTS) {
    const rawVal = src[part];
    if (rawVal == null || rawVal === '') continue;   // 미착용
    const v = pickVariant(part, rawVal);
    if (v) out[part] = v;
    else {
      changed = true;
      warnings.push(`'${part}' 파트 "${String(rawVal)}" 를 현재 스타일에서 찾을 수 없어 벗겼습니다.`);
    }
  }

  const colorFields: [keyof AvatarConfig, PaletteKey][] = [
    ['hairColor', 'hair'],
    ['skinColor', 'skin'],
    ['clothesColor', 'clothes'],
    ['eyesColor', 'eyes'],
    ['mouthColor', 'mouth'],
    ['hatColor', 'hat'],
    ['glassesColor', 'glasses'],
    ['accessoriesColor', 'accessories'],
  ];
  for (const [field] of colorFields) {
    const hex = normalizeHex(src[field]);
    if (hex) (out as unknown as Record<string, unknown>)[field] = hex;
    else if (src[field] != null) {
      changed = true;
      warnings.push(`색상 '${String(field)}' 값을 읽을 수 없어 기본값을 씁니다.`);
    }
  }

  if (typeof src.styleVersion === 'string' && src.styleVersion !== AVATAR_STYLE_VERSION) {
    warnings.push(
      `저장된 아바타는 ${src.styleVersion} 로 만들어졌습니다. 현재는 ${AVATAR_STYLE_VERSION} 입니다 — 그림이 조금 달라질 수 있습니다.`,
    );
    changed = true;
  }
  out.styleVersion = AVATAR_STYLE_VERSION;

  return { config: out, warnings, changed };
}

/** styleVersion 불일치만 따로 보고 싶을 때. 일치하면 null. */
export function styleVersionMismatch(config: Pick<AvatarConfig, 'styleVersion'>): string | null {
  if (config.styleVersion === AVATAR_STYLE_VERSION) return null;
  return `${config.styleVersion} → ${AVATAR_STYLE_VERSION}`;
}

/** JSON 왕복. 저장은 storage.ts 의 saveState 가 하므로 여기선 순수 변환만. */
export function serializeAvatar(config: AvatarConfig): string {
  return JSON.stringify(config);
}

export function deserializeAvatar(json: string): NormalizeResult {
  try {
    return normalizeAvatarConfig(JSON.parse(json));
  } catch {
    return { config: { ...DEFAULT_AVATAR }, warnings: ['아바타 설정을 읽을 수 없어 기본값을 씁니다.'], changed: true };
  }
}

/* ------------------------------------------------------------------ *
 * 랜덤
 * ------------------------------------------------------------------ */

const OPTIONAL_CHANCE: Record<string, number> = { hat: 0.2, glasses: 0.3, beard: 0.15, accessories: 0.2 };

function pick<T>(arr: readonly T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

/** rnd 를 주입할 수 있게 해서 테스트에서 결정적으로 돌린다. */
export function randomAvatar(rnd: () => number = Math.random): AvatarConfig {
  const cfg: AvatarConfig = {
    hair: pick(HAIR_VARIANTS, rnd),
    hairColor: pick(PALETTES.hair, rnd),
    skinColor: pick(PALETTES.skin, rnd),
    clothes: pick(CLOTHES_VARIANTS, rnd),
    clothesColor: pick(PALETTES.clothes, rnd),
    eyes: pick(EYES_VARIANTS, rnd),
    mouth: pick(MOUTH_VARIANTS, rnd),
    styleVersion: AVATAR_STYLE_VERSION,
  };
  for (const part of OPTIONAL_PARTS) {
    if (rnd() < OPTIONAL_CHANCE[part]) {
      cfg[part] = pick(PART_VARIANTS[part], rnd);
      const colorField = `${part}Color` as keyof AvatarConfig;
      if (part !== 'beard' && PALETTES[part as PaletteKey]) {
        (cfg as unknown as Record<string, unknown>)[colorField] = pick(PALETTES[part as PaletteKey], rnd);
      }
    }
  }
  return cfg;
}

/* ------------------------------------------------------------------ *
 * 렌더 — npm 번들만 사용. api.dicebear.com 호출 없음.
 * ------------------------------------------------------------------ */

/** AvatarConfig → DiceBear v9 옵션(배열 1개 = 고정). 확률은 0/100으로 강제. */
export function toDiceBearOptions(config: AvatarConfig, size?: number): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    // seed 는 고정 파트가 다 지정돼 있으면 결과에 영향을 주지 않지만,
    // 값이 비어 파트가 랜덤으로 뽑히는 경우까지 재현 가능하게 고정해 둔다.
    seed: 'classic-lions',
    backgroundColor: ['transparent'],
    hair: [config.hair],
    hairColor: [toDiceBearHex(config.hairColor)],
    skinColor: [toDiceBearHex(config.skinColor)],
    clothing: [config.clothes],
    clothingColor: [toDiceBearHex(config.clothesColor)],
    eyes: [config.eyes],
    eyesColor: [toDiceBearHex(config.eyesColor ?? DEFAULT_PART_COLORS.eyes)],
    mouth: [config.mouth],
    mouthColor: [toDiceBearHex(config.mouthColor ?? DEFAULT_PART_COLORS.mouth)],
  };

  const optional: [PartKey, string, string | undefined, string | undefined][] = [
    ['hat', 'hat', config.hat, config.hatColor ?? DEFAULT_PART_COLORS.hat],
    ['glasses', 'glasses', config.glasses, config.glassesColor ?? DEFAULT_PART_COLORS.glasses],
    ['beard', 'beard', config.beard, undefined],
    ['accessories', 'accessories', config.accessories, config.accessoriesColor ?? DEFAULT_PART_COLORS.accessories],
  ];
  for (const [, key, variant, color] of optional) {
    if (variant) {
      opts[key] = [variant];
      opts[`${key}Probability`] = 100;
      if (color) opts[`${key}Color`] = [toDiceBearHex(color)];
    } else {
      opts[`${key}Probability`] = 0;
    }
  }

  if (size != null) opts.size = size;
  return opts;
}

/**
 * 인라인 삽입용 SVG 문자열. 16×16 viewBox, shape-rendering="crispEdges".
 * size 를 주면 width/height 속성이 붙는다 (정수배 권장 — 32/64/128).
 */
export function avatarToSvgString(config: AvatarConfig, size?: number): string {
  return createAvatar(pixelArt, toDiceBearOptions(config, size)).toString();
}

/** 썸네일용: <metadata> 블록을 떼어 DOM 부담을 줄인다 (CC0라 귀속 의무 없음). */
export function avatarToCompactSvgString(config: AvatarConfig, size?: number): string {
  return avatarToSvgString(config, size).replace(/<metadata[\s\S]*?<\/metadata>/, '');
}

/** 설치된 정의와 우리 상수 목록이 어긋났는지 확인 (테스트 전용). */
export function schemaVariantsFor(part: PartKey): string[] {
  const props = (pixelArt as unknown as { schema: { properties: Record<string, { items?: { enum?: string[] } }> } }).schema.properties;
  const key = PART_TO_DICEBEAR[part];
  return [...(props[key]?.items?.enum ?? [])].sort();
}
