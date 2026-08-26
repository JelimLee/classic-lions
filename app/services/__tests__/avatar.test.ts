/**
 * 아바타 회귀 테스트
 *
 *   cd app && npm test
 *
 * 지키려는 것 (docs/RESEARCH_seat_avatar.md §4.4):
 *   1. 파트는 **이름 문자열**로 저장된다 — 라이브러리가 variant를 재정렬해도
 *      과거 아바타가 조용히 다른 그림이 되지 않는다.
 *   2. styleVersion 불일치를 **감지**한다.
 *   3. 직렬화 왕복에서 값이 변하지 않는다.
 *   4. 렌더는 네트워크 없이 로컬 번들만으로 된다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AVATAR_CANVAS,
  AVATAR_STYLE_VERSION,
  DEFAULT_AVATAR,
  OPTIONAL_PARTS,
  PALETTES,
  PART_VARIANTS,
  REQUIRED_PARTS,
  avatarToSvgString,
  deserializeAvatar,
  normalizeAvatarConfig,
  normalizeHex,
  randomAvatar,
  schemaVariantsFor,
  serializeAvatar,
  styleVersionMismatch,
  toDiceBearOptions,
  type PartKey,
} from '../../components/avatar/parts.ts';

/* ---------------- 파트 목록이 설치된 정의와 일치하는가 ---------------- */

const EXPECTED_COUNTS: Record<PartKey, number> = {
  hair: 45, clothes: 23, mouth: 23, glasses: 14, eyes: 12, hat: 10, beard: 8, accessories: 4,
};

for (const [part, count] of Object.entries(EXPECTED_COUNTS) as [PartKey, number][]) {
  test(`파트 '${part}' 목록이 설치된 DiceBear 정의와 정확히 일치한다`, () => {
    assert.deepEqual(PART_VARIANTS[part], schemaVariantsFor(part),
      'DiceBear 버전이 바뀌어 파트 목록이 어긋났다. parts.ts 를 갱신하고 styleVersion 을 올릴 것.');
    assert.equal(PART_VARIANTS[part].length, count, '리서치 실측 개수와 다르다');
  });
}

test('파트 값은 인덱스가 아니라 이름 문자열이다', () => {
  for (const part of [...REQUIRED_PARTS, ...OPTIONAL_PARTS]) {
    for (const v of PART_VARIANTS[part]) {
      assert.equal(typeof v, 'string');
      assert.match(v, /^[a-z]+\d{2}$/, `${part}: ${v}`);
    }
  }
});

/* ---------------- 기본값 유효성 ---------------- */

test('DEFAULT_AVATAR 의 파트가 전부 실재하고 색상이 팔레트에 있다', () => {
  assert.ok(PART_VARIANTS.hair.includes(DEFAULT_AVATAR.hair));
  assert.ok(PART_VARIANTS.eyes.includes(DEFAULT_AVATAR.eyes));
  assert.ok(PART_VARIANTS.mouth.includes(DEFAULT_AVATAR.mouth));
  assert.ok(PART_VARIANTS.clothes.includes(DEFAULT_AVATAR.clothes));
  assert.ok((PALETTES.hair as readonly string[]).includes(DEFAULT_AVATAR.hairColor));
  assert.ok((PALETTES.skin as readonly string[]).includes(DEFAULT_AVATAR.skinColor));
  assert.ok((PALETTES.clothes as readonly string[]).includes(DEFAULT_AVATAR.clothesColor));
  assert.equal(DEFAULT_AVATAR.styleVersion, AVATAR_STYLE_VERSION);
});

test('DEFAULT_AVATAR 는 선택 파트를 착용하지 않는다', () => {
  for (const part of OPTIONAL_PARTS) {
    assert.equal(DEFAULT_AVATAR[part], undefined);
  }
});

/* ---------------- 직렬화 왕복 ---------------- */

test('직렬화 왕복: 기본 아바타가 그대로 돌아온다', () => {
  const { config, warnings, changed } = deserializeAvatar(serializeAvatar(DEFAULT_AVATAR));
  assert.deepEqual(config, DEFAULT_AVATAR);
  assert.deepEqual(warnings, []);
  assert.equal(changed, false);
});

test('직렬화 왕복: 소품까지 다 낀 아바타도 손실 없이 돌아온다', () => {
  const full = {
    ...DEFAULT_AVATAR,
    hair: 'short24', hairColor: '#28150a', skinColor: '#8d5524',
    clothes: 'variant23', clothesColor: '#ae0001',
    eyes: 'variant12', mouth: 'sad10',
    hat: 'variant10', hatColor: '#a62116',
    glasses: 'light07', glassesColor: '#a04b5d',
    beard: 'variant08',
    accessories: 'variant04', accessoriesColor: '#daa520',
  };
  const { config } = deserializeAvatar(serializeAvatar(full));
  assert.deepEqual(config, full);
});

test('직렬화 왕복: 랜덤 아바타 200개가 전부 왕복에서 살아남는다', () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 200; i++) {
    const cfg = randomAvatar(rnd);
    const { config, warnings } = deserializeAvatar(serializeAvatar(cfg));
    assert.deepEqual(config, cfg);
    assert.deepEqual(warnings, []);
  }
});

test('깨진 JSON 은 던지지 않고 기본값 + 경고로 떨어진다', () => {
  const r = deserializeAvatar('{not json');
  assert.deepEqual(r.config, DEFAULT_AVATAR);
  assert.equal(r.warnings.length, 1);
});

/* ---------------- styleVersion 불일치 감지 ---------------- */

test('styleVersion 이 다르면 경고하고 현재 버전으로 갱신한다', () => {
  const old = { ...DEFAULT_AVATAR, styleVersion: 'dicebear-pixel-art@8.0.0' };
  const { config, warnings, changed } = normalizeAvatarConfig(old);
  assert.equal(changed, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /8\.0\.0/);
  assert.equal(config.styleVersion, AVATAR_STYLE_VERSION);
});

test('styleVersionMismatch: 같으면 null, 다르면 설명 문자열', () => {
  assert.equal(styleVersionMismatch(DEFAULT_AVATAR), null);
  assert.match(styleVersionMismatch({ styleVersion: 'x@1' })!, /x@1/);
});

/* ---------------- 없는 파트 / 깨진 색상 방어 ---------------- */

test('없는 헤어 이름은 조용히 다른 그림이 되지 않고 기본값 + 경고가 된다', () => {
  const { config, warnings } = normalizeAvatarConfig({ ...DEFAULT_AVATAR, hair: 'long99' });
  assert.equal(config.hair, DEFAULT_AVATAR.hair);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /long99/);
});

test('없는 선택 파트는 벗기고 경고한다', () => {
  const { config, warnings } = normalizeAvatarConfig({ ...DEFAULT_AVATAR, hat: 'variant99' });
  assert.equal(config.hat, undefined);
  assert.match(warnings[0], /variant99/);
});

test('파트를 인덱스(숫자)로 저장한 옛 값은 거부된다', () => {
  const { config, warnings } = normalizeAvatarConfig({ ...DEFAULT_AVATAR, hair: 3 });
  assert.equal(config.hair, DEFAULT_AVATAR.hair);
  assert.equal(warnings.length, 1);
});

test('normalizeHex: # 유무·대소문자를 흡수하고 쓰레기는 거부한다', () => {
  assert.equal(normalizeHex('#AABBCC'), '#aabbcc');
  assert.equal(normalizeHex('aabbcc'), '#aabbcc');
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex(123), null);
});

test('null / 문자열 / 배열을 넣어도 기본 아바타로 떨어진다', () => {
  assert.deepEqual(normalizeAvatarConfig(null).config, DEFAULT_AVATAR);
  assert.deepEqual(normalizeAvatarConfig('x').config, DEFAULT_AVATAR);
});

/* ---------------- DiceBear 옵션 매핑 ---------------- */

test('clothes 는 DiceBear 옵션 clothing 으로 매핑된다', () => {
  const o = toDiceBearOptions(DEFAULT_AVATAR);
  assert.deepEqual(o.clothing, [DEFAULT_AVATAR.clothes]);
  assert.equal(o.clothes, undefined);
});

test('색상은 # 없이 6자리로 넘어간다', () => {
  const o = toDiceBearOptions(DEFAULT_AVATAR);
  assert.deepEqual(o.hairColor, ['603a14']);
  assert.deepEqual(o.skinColor, ['eac393']);
});

test('선택 파트는 확률 0/100 으로 강제된다 (랜덤 등장 금지)', () => {
  const off = toDiceBearOptions(DEFAULT_AVATAR);
  assert.equal(off.hatProbability, 0);
  assert.equal(off.glassesProbability, 0);
  assert.equal(off.beardProbability, 0);
  assert.equal(off.accessoriesProbability, 0);
  const on = toDiceBearOptions({ ...DEFAULT_AVATAR, hat: 'variant01' });
  assert.equal(on.hatProbability, 100);
  assert.deepEqual(on.hat, ['variant01']);
});

/* ---------------- 렌더 ---------------- */

test('렌더 결과는 16×16 crispEdges SVG 다', () => {
  const svg = avatarToSvgString(DEFAULT_AVATAR);
  assert.match(svg, /^<svg /);
  assert.match(svg, new RegExp(`viewBox="0 0 ${AVATAR_CANVAS} ${AVATAR_CANVAS}"`));
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(svg, /api\.dicebear\.com/, 'CDN 호출 금지 — npm 번들만 쓴다');
});

test('size 를 주면 width/height 가 붙는다', () => {
  const svg = avatarToSvgString(DEFAULT_AVATAR, 64);
  assert.match(svg, /width="64"/);
  assert.match(svg, /height="64"/);
});

test('파트를 바꾸면 실제로 다른 SVG 가 나온다 (썸네일이 전부 같아지지 않는다)', () => {
  const seen = new Set<string>();
  for (const hair of PART_VARIANTS.hair) {
    seen.add(avatarToSvgString({ ...DEFAULT_AVATAR, hair }));
  }
  assert.equal(seen.size, PART_VARIANTS.hair.length, '헤어 45종이 서로 다른 그림이어야 한다');
});

test('색상을 바꾸면 SVG 에 그 hex 가 나타난다', () => {
  const svg = avatarToSvgString({ ...DEFAULT_AVATAR, clothesColor: '#d11141' });
  assert.match(svg, /d11141/i);
});

test('같은 설정은 항상 같은 SVG 를 낸다 (재현성)', () => {
  assert.equal(avatarToSvgString(DEFAULT_AVATAR), avatarToSvgString({ ...DEFAULT_AVATAR }));
});

test('randomAvatar 결과는 언제나 normalize 를 경고 없이 통과한다', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 100; i++) {
    const { warnings } = normalizeAvatarConfig(randomAvatar(rnd));
    assert.deepEqual(warnings, []);
  }
});

/* ---------------- storage.ts 왕복 (localStorage 스텁) ---------------- */

test('storage: saveAvatar → loadAvatar 왕복이 값을 보존한다', async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  };
  const { loadAvatar, saveAvatar } = await import('../storage.ts');

  // 저장 전에는 기본 아바타
  const empty = loadAvatar();
  assert.equal(empty.isDefault, true);
  assert.deepEqual(empty.config, DEFAULT_AVATAR);

  const mine = { ...DEFAULT_AVATAR, hair: 'short12', skinColor: '#8d5524', hat: 'variant03', hatColor: '#2663a3' };
  assert.equal(saveAvatar(mine).ok, true);

  const back = loadAvatar();
  assert.equal(back.isDefault, false);
  assert.deepEqual(back.config, mine);
  assert.deepEqual(back.warnings, []);

  // 옛 버전으로 저장된 값은 경고와 함께 복원된다
  store.set('classic-lions/v1/avatar', JSON.stringify({ ...mine, styleVersion: 'dicebear-pixel-art@8.0.0' }));
  const stale = loadAvatar();
  assert.equal(stale.warnings.length, 1);
  assert.equal(stale.config.styleVersion, AVATAR_STYLE_VERSION);

  delete (globalThis as Record<string, unknown>).window;
});
