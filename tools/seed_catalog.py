#!/usr/bin/env python3
"""repertoire.json → Postgres 카탈로그 시드 (composers, works).

예술의전당 11년치 수집 결과를 db/schema.sql 의 카탈로그 테이블로 적재한다.

사용:
    python3 tools/seed_catalog.py --dsn "postgresql://..."      # 실제 적재
    python3 tools/seed_catalog.py --dsn "..." --dry-run          # 검증만
    python3 tools/seed_catalog.py --out seed.sql                 # SQL 파일로 출력

설계 원칙
---------
* **모르는 것은 NULL 로 둔다.** repertoire.json 에 없는 값(생몰년·조성·작곡연도)을
  추측해 채우지 않는다. 나중에 Open Opus/Wikidata 로 채운다.
* `form`(73종 자유 어휘) → `forces`(스키마의 7종 CHECK) 매핑은 **확실한 것만** 한다.
  애매하면 NULL + forces_conf 낮게. 틀린 태그가 빈 태그보다 나쁘다.
* `rarity` 는 이미 계산된 값(백분위)을 그대로 쓴다. LLM 불필요.
  ⚠️ `1 − n/max` 선형식은 롱테일에서 무너진다(베토벤 황제협주곡이 0.90).
     repertoire.json 의 `rarityPct` 가 백분위라 이걸 쓴다.
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 한 INSERT 에 넣을 행 수. API 요청 크기 한도(413) 때문에 나눈다.
BATCH = 400

# ---------------------------------------------------------------------------
# form(자유 어휘 73종) → forces(스키마 CHECK 7종)
# ---------------------------------------------------------------------------
# 확실한 것만 매핑한다. 애매한 것은 의도적으로 뺐다:
#   suite      — 관현악 모음곡일 수도, 바흐 첼로 모음곡일 수도 있다
#   fantasy    — 쇼팽 환상곡(독주) vs 교향적 환상곡(관현악)
#   variations — 양쪽 다 있다
#   trio/quintet 등 숫자 앙상블은 chamber 로 안전하게 잡힌다
FORCES_MAP: dict[str, str] = {}

def _put(forces: str, *forms: str) -> None:
    for f in forms:
        FORCES_MAP[f] = forces

_put('symphony', 'symphony', 'sinfonia', 'symphonic poem', 'sinfonietta')
_put('concerto',
     'concerto', 'piano concerto', 'violin concerto', 'cello concerto',
     'flute concerto', 'clarinet concerto', 'horn concerto', 'oboe concerto',
     'bassoon concerto', 'trumpet concerto', 'harp concerto', 'viola concerto',
     'double concerto', 'triple concerto', 'concerto for two pianos',
     'concerto grosso', 'concertino')
_put('solo',
     'sonata', 'piano sonata', 'violin sonata', 'cello sonata', 'flute sonata',
     'viola sonata', 'clarinet sonata', 'prelude', 'etude', 'nocturne',
     'ballade', 'scherzo', 'impromptu', 'mazurka', 'polonaise', 'waltz',
     'rhapsody', 'intermezzo', 'toccata', 'fugue', 'partita', 'capriccio',
     'barcarolle', 'berceuse', 'bagatelle', 'moment musical')
_put('chamber',
     'string quartet', 'piano quartet', 'string quintet', 'piano quintet',
     'string trio', 'piano trio', 'trio', 'quartet', 'quintet', 'sextet',
     'septet', 'octet', 'nonet', 'duo', 'divertimento')
_put('orchestral_short',
     'overture', 'serenade', 'march', 'dance', 'polka', 'entr\'acte',
     'prelude and fugue', 'fanfare')
_put('vocal',
     'lied', 'aria', 'song cycle', 'mass', 'requiem', 'cantata', 'oratorio',
     'motet', 'chorus', 'song', 'te deum', 'stabat mater', 'magnificat')
_put('stage', 'opera', 'ballet', 'operetta', 'musical', 'incidental music')


def map_forces(form: str | None) -> tuple[str | None, float | None]:
    """form → (forces, forces_conf). 모르면 (None, None)."""
    if not form:
        return None, None
    key = form.strip().lower()
    if key in FORCES_MAP:
        return FORCES_MAP[key], 0.9
    # "violin concerto no.2" 처럼 뒤에 붙은 경우
    for k, v in FORCES_MAP.items():
        if key.startswith(k + ' ') or key.endswith(' ' + k):
            return v, 0.7
    return None, None


SOLO_INST = {
    'piano concerto': 'piano', 'violin concerto': 'violin',
    'cello concerto': 'cello', 'flute concerto': 'flute',
    'clarinet concerto': 'clarinet', 'horn concerto': 'horn',
    'oboe concerto': 'oboe', 'bassoon concerto': 'bassoon',
    'trumpet concerto': 'trumpet', 'harp concerto': 'harp',
    'viola concerto': 'viola',
    'piano sonata': 'piano', 'violin sonata': 'violin',
    'cello sonata': 'cello', 'flute sonata': 'flute',
    'viola sonata': 'viola', 'clarinet sonata': 'clarinet',
}


def map_soloist(form: str | None) -> str | None:
    if not form:
        return None
    return SOLO_INST.get(form.strip().lower())


# ---------------------------------------------------------------------------
def q(v) -> str:
    """SQL 리터럴. None → NULL."""
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def jq(v) -> str:
    return q(json.dumps(v, ensure_ascii=False)) + '::jsonb'


def sort_name(name: str) -> str:
    """'Ludwig van Beethoven' → 'Beethoven, Ludwig van'. 성만 있으면 그대로."""
    parts = name.strip().split()
    if len(parts) <= 1:
        return name.strip()
    return f"{parts[-1]}, {' '.join(parts[:-1])}"


def build(rep: dict) -> tuple[list[str], dict]:
    works = rep['works']

    # --- composers: works 에서 역으로 뽑는다 ------------------------------
    #
    # 한글 작곡가명 추출.
    # ⚠️ label 첫 단어를 그냥 쓰면 안 된다. label 은 두 형태가 섞여 있다:
    #     "베토벤 교향곡 5번"                  → 첫 단어가 작곡가명 (맞음)
    #     "Flute Quartet in D Major, KV 285"   → 작곡가명이 아예 없음
    #     "교회칸타타 ..."                      → 첫 단어가 곡명 (틀림)
    # 실제로 이렇게 했다가 작곡가 한글명이 '교향곡'·'대관식'·'녹턴' 으로 들어갔다.
    #
    # 대신 두 신호를 **빈도 투표**로 합친다:
    #   (1) "베토벤 / ..." "쇼팽, ..." 처럼 구분자가 붙은 형태 — 가장 신뢰도 높음
    #   (2) 한글 첫 토큰 — 보조. 같은 작곡가의 여러 작품에서 반복되는 것만 인정
    # 어느 쪽도 임계값을 못 넘으면 **NULL**. 추측해서 채우지 않는다.
    from collections import Counter

    votes: dict[str, Counter] = {}
    strong: dict[str, Counter] = {}
    totals: Counter = Counter()

    sep_re = re.compile(r'^\s*([가-힣]{2,7})\s*[/,]')
    head_re = re.compile(r'^\s*([가-힣]{2,7})\s')

    for w in works:
        c = (w.get('composer') or '').strip()
        if not c:
            continue
        votes.setdefault(c, Counter())
        strong.setdefault(c, Counter())
        totals[c] += 1
        for text in [w.get('label') or ''] + list(w.get('altLabels') or []):
            m = sep_re.match(text)
            if m:
                strong[c][m.group(1)] += 1
            m2 = head_re.match(text)
            if m2:
                votes[c][m2.group(1)] += 1

    comp_names: dict[str, set[str]] = {}
    ko_resolved = 0
    for c in votes:
        chosen: str | None = None
        if strong[c]:
            chosen = strong[c].most_common(1)[0][0]          # (1) 구분자 형태 우선
        elif votes[c]:
            name, n = votes[c].most_common(1)[0]
            # (2) 보조 신호는 그 작곡가 작품의 25% 이상에서 반복될 때만 인정
            if n >= max(2, 0.25 * totals[c]):
                chosen = name
        comp_names[c] = {chosen} if chosen else set()
        if chosen:
            ko_resolved += 1
    build.ko_resolved = ko_resolved  # type: ignore[attr-defined]

    stmts: list[str] = []
    stmts.append('-- 예술의전당 2016-01~2026-12 수집분. tools/seed_catalog.py 생성.')
    stmts.append('BEGIN;')

    comp_rows = []
    for name, kos in sorted(comp_names.items()):
        ko = sorted(kos)[0] if kos else None
        aliases = sorted(kos - {ko}) if ko else []
        comp_rows.append(
            f'({q(name)}, {q(name)}, {q(ko)}, {q(sort_name(name))}, '
            f'{jq(aliases)}, {q("sac_repertoire")})'
        )
    for i in range(0, len(comp_rows), BATCH):
        chunk = ',\n  '.join(comp_rows[i:i + BATCH])
        stmts.append(
            'INSERT INTO composers (id, name_en, name_ko, sort_name, aliases, source) '
            f'VALUES\n  {chunk}\n'
            'ON CONFLICT (id) DO UPDATE SET '
            'name_ko = COALESCE(composers.name_ko, EXCLUDED.name_ko), '
            'aliases = EXCLUDED.aliases;'
        )

    skipped = 0
    forces_known = 0
    work_rows: list[str] = []
    for w in works:
        composer = (w.get('composer') or '').strip()
        if not composer:
            skipped += 1
            continue
        forces, fconf = map_forces(w.get('form'))
        if forces:
            forces_known += 1
        label = w.get('label')
        alt = w.get('altLabels') or []

        # catalog: "op.67" → ('op', '67')
        cat = cat_no = None
        opus = (w.get('opus') or '').strip()
        m = re.match(r'([A-Za-z.]+)\s*\.?\s*([\d/\-]+.*)$', opus) if opus else None
        if m:
            cat = m.group(1).rstrip('.').lower()
            cat_no = m.group(2).strip()

        work_no = None
        if w.get('number'):
            m2 = re.match(r'\d+', str(w['number']))
            if m2:
                work_no = int(m2.group(0))

        work_rows.append(
            f'({q(w["id"])}, {q(composer)}, {q(label or w["id"])}, {q(label)}, '
            f'{jq(alt)}, {q(cat)}, {q(cat_no)}, {q(work_no)}, '
            f'{q(forces)}, {q(map_soloist(w.get("form")))}, {q(fconf)}, '
            f'{q(w.get("rarityPct"))}, {q(w.get("count"))}, '
            f'{q("sac_2016_2026_percentile")}, {q("sac_repertoire")})'
        )

    for i in range(0, len(work_rows), BATCH):
        chunk = ',\n  '.join(work_rows[i:i + BATCH])
        stmts.append(
            'INSERT INTO works (id, composer_id, title_en, title_ko, aliases, '
            'catalog, catalog_no, work_no, forces, soloist_inst, forces_conf, '
            'rarity, rarity_n, rarity_basis, source) '
            f'VALUES\n  {chunk}\n'
            'ON CONFLICT (id) DO UPDATE SET '
            # 두 홀을 병합할 때 rarity 를 덮어쓰면 안 된다.
            # 각 홀 코퍼스 안에서 계산된 백분위라 합치면 의미가 달라진다.
            # 연주 횟수만 합산하고, rarity 는 NULL 로 두어 재계산 대상임을 표시한다.
            'rarity_n = COALESCE(works.rarity_n,0) + COALESCE(EXCLUDED.rarity_n,0), '
            'rarity = NULL, rarity_basis = \'needs_recompute\', '
            'title_ko = COALESCE(works.title_ko, EXCLUDED.title_ko), '
            'forces = COALESCE(works.forces, EXCLUDED.forces), '
            'aliases = EXCLUDED.aliases, updated_at = now();'
        )

    stmts.append('COMMIT;')
    stats = {
        'composers': len(comp_names),
        'composers_ko_resolved': getattr(build, 'ko_resolved', 0),
        'works': len(works) - skipped,
        'skipped_no_composer': skipped,
        'forces_mapped': forces_known,
        'forces_null': len(works) - skipped - forces_known,
    }
    return stmts, stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', default=str(ROOT / 'app/data/repertoire.json'))
    ap.add_argument('--out', help='SQL 파일로 출력')
    ap.add_argument('--dsn', help='직접 적재할 Postgres DSN')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    rep = json.loads(Path(a.input).read_text(encoding='utf-8'))
    stmts, stats = build(rep)

    print('생성 통계:', file=sys.stderr)
    for k, v in stats.items():
        print(f'  {k}: {v:,}', file=sys.stderr)
    pct = 100 * stats['forces_mapped'] / stats['works'] if stats['works'] else 0
    print(f'  forces 매핑률: {pct:.1f}%  (나머지는 NULL — 추측하지 않음)',
          file=sys.stderr)

    sql = '\n'.join(stmts) + '\n'
    if a.out:
        Path(a.out).write_text(sql, encoding='utf-8')
        print(f'\n{a.out} 에 {len(stmts):,}개 문장 기록', file=sys.stderr)
    if a.dry_run or not a.dsn:
        return 0

    import subprocess
    r = subprocess.run(['psql', a.dsn, '-v', 'ON_ERROR_STOP=1', '-q'],
                       input=sql, text=True, capture_output=True)
    if r.returncode != 0:
        print(r.stderr[:2000], file=sys.stderr)
        return r.returncode
    print('\n적재 완료', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
