#!/usr/bin/env python3
"""작곡가 이름 정규화 — 한국어 표기/영문 변형 → 정규 성(surname) 키.

출처: 수동 사전 + Open Opus(CC0) 덤프의 220명 complete_name.
"""
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "sac_programs")

SURNAME_ALIAS = {
    # 한국어 표기 → 정규 성(영문)
    "차이코프스키": "Tchaikovsky", "차이콥스키": "Tchaikovsky", "챠이코프스키": "Tchaikovsky",
    "차이컵스키": "Tchaikovsky",
    "베토벤": "Beethoven", "베에토벤": "Beethoven",
    "모차르트": "Mozart", "모짜르트": "Mozart",
    "브람스": "Brahms", "브라암스": "Brahms",
    "쇼팽": "Chopin", "쇼펭": "Chopin",
    "드보르작": "Dvorak", "드보르자크": "Dvorak", "드보르쟉": "Dvorak", "드보르샥": "Dvorak",
    "슈베르트": "Schubert",
    "슈만": "Schumann", "슈우만": "Schumann",
    "멘델스존": "Mendelssohn", "멘델스죤": "Mendelssohn",
    "라흐마니노프": "Rachmaninoff", "라흐마니노브": "Rachmaninoff", "라흐마니노푸": "Rachmaninoff",
    "프로코피예프": "Prokofiev", "프로코피에프": "Prokofiev",
    "쇼스타코비치": "Shostakovich", "쇼스타코비취": "Shostakovich",
    "말러": "Mahler", "구스타프말러": "Mahler",
    "브루크너": "Bruckner",
    "시벨리우스": "Sibelius",
    "생상스": "Saint-Saens", "생상": "Saint-Saens", "생-상스": "Saint-Saens",
    "드뷔시": "Debussy", "끌로드드뷔시": "Debussy",
    "라벨": "Ravel",
    "스트라빈스키": "Stravinsky", "스트라빈스끼": "Stravinsky",
    "바르톡": "Bartok", "바르토크": "Bartok", "버르토크": "Bartok",
    "리스트": "Liszt",
    "바흐": "Bach", "요한제바스티안바흐": "Bach", "J.S.바흐": "Bach",
    "헨델": "Handel", "händel": "Handel",
    "하이든": "Haydn",
    "비발디": "Vivaldi",
    "베르디": "Verdi",
    "푸치니": "Puccini",
    "로시니": "Rossini",
    "바그너": "Wagner",
    "리하르트슈트라우스": "R.Strauss", "R.슈트라우스": "R.Strauss",
    "요한슈트라우스": "J.Strauss",
    "그리그": "Grieg",
    "엘가": "Elgar",
    "홀스트": "Holst",
    "레스피기": "Respighi",
    "무소륵스키": "Mussorgsky", "무소르그스키": "Mussorgsky", "무쏘르그스키": "Mussorgsky",
    "림스키코르사코프": "Rimsky-Korsakov", "림스키-코르사코프": "Rimsky-Korsakov",
    "보로딘": "Borodin",
    "글린카": "Glinka",
    "하차투리안": "Khachaturian", "하챠투리안": "Khachaturian",
    "코다이": "Kodaly",
    "야나체크": "Janacek",
    "스메타나": "Smetana",
    "포레": "Faure", "포레이": "Faure",
    "프랑크": "Franck",
    "생상": "Saint-Saens",
    "베를리오즈": "Berlioz",
    "비제": "Bizet",
    "구노": "Gounod",
    "마스네": "Massenet",
    "풀랑크": "Poulenc", "풀랑": "Poulenc",
    "메시앙": "Messiaen",
    "브리튼": "Britten",
    "코플랜드": "Copland",
    "거슈윈": "Gershwin", "거쉰": "Gershwin",
    "번스타인": "Bernstein",
    "피아졸라": "Piazzolla", "피아쫄라": "Piazzolla",
    "사라사테": "Sarasate",
    "파가니니": "Paganini",
    "비에니아프스키": "Wieniawski",
    "크라이슬러": "Kreisler",
    "슈니트케": "Schnittke",
    "굴다": "Gulda",
    "리게티": "Ligeti",
    "펜데레츠키": "Penderecki",
    "윤이상": "Isang Yun",
    "진은숙": "Unsuk Chin",
    "베르크": "Berg",
    "쇤베르크": "Schoenberg", "쉔베르크": "Schoenberg",
    "베베른": "Webern",
    "힌데미트": "Hindemith",
    "레하르": "Lehar",
    "오펜바흐": "Offenbach",
    "도니제티": "Donizetti",
    "벨리니": "Bellini",
    "몬테베르디": "Monteverdi",
    "퍼셀": "Purcell",
    "텔레만": "Telemann",
    "코렐리": "Corelli",
    "알비노니": "Albinoni",
    "파헬벨": "Pachelbel",
    "스카를라티": "Scarlatti",
    "클레멘티": "Clementi",
    "체르니": "Czerny",
    "훔멜": "Hummel",
    "베버": "Weber",
    "슈포어": "Spohr",
    "생-상": "Saint-Saens",
    "알베니스": "Albeniz",
    "그라나도스": "Granados",
    "팔라": "Falla", "데파야": "Falla",
    "로드리고": "Rodrigo",
    "타레가": "Tarrega",
    "빌라로보스": "Villa-Lobos", "빌라-로보스": "Villa-Lobos",
    "히나스테라": "Ginastera",
    "닐센": "Nielsen", "닐슨": "Nielsen",
    "루토스와프스키": "Lutoslawski",
    "구바이둘리나": "Gubaidulina",
    "아르보페르트": "Part", "페르트": "Part",
    "글라스": "Glass",
    "라이히": "Reich",
    "아담스": "Adams",
    "코른골트": "Korngold",
    "체르하": "Cerha",
    "당디": "d'Indy",
    "쇼송": "Chausson",
    "생상스": "Saint-Saens",
    "이자이": "Ysaye",
    "에네스쿠": "Enescu",
    "도흐나니": "Dohnanyi",
    "졸리베": "Jolivet",
    "이베르": "Ibert",
    "생상": "Saint-Saens",
    "타티니": "Tartini",
    "보케리니": "Boccherini",
    "살리에리": "Salieri",
    "글루크": "Gluck",
    "케루비니": "Cherubini",
    "필드": "Field",
    "알캉": "Alkan",
    "고도프스키": "Godowsky",
    "메트너": "Medtner",
    "스크리아빈": "Scriabin", "스크랴빈": "Scriabin",
    "글라주노프": "Glazunov",
    "칼리니코프": "Kalinnikov",
    "아렌스키": "Arensky",
    "타네예프": "Taneyev",
    "카푸스틴": "Kapustin",
    "굴리다": "Gulda",
    "몸포우": "Mompou",
    "사티": "Satie",
    "생상스": "Saint-Saens",
    "쉬만노프스키": "Szymanowski", "시마노프스키": "Szymanowski",
    "마르티누": "Martinu",
    "힐데가르트": "Hildegard",
    "브릿지": "Bridge",
    "본윌리엄스": "Vaughan Williams", "본-윌리엄스": "Vaughan Williams",
    "월튼": "Walton",
    "델리어스": "Delius",
    "바버": "Barber",
    "아이브스": "Ives",
    "케이지": "Cage",
    "리버만": "Liebermann",
    "젠킨스": "Jenkins",
    "모리코네": "Morricone",
    "윌리엄스": "J.Williams",
}

# 영문 성 정규화 (악센트/철자 변형)
EN_ALIAS = {
    "tchaikovsky": "Tchaikovsky", "tschaikowsky": "Tchaikovsky", "chaikovsky": "Tchaikovsky",
    "tchaikowsky": "Tchaikovsky", "cajkovskij": "Tchaikovsky",
    "rachmaninoff": "Rachmaninoff", "rachmaninov": "Rachmaninoff", "rakhmaninov": "Rachmaninoff",
    "dvorak": "Dvorak", "dvořák": "Dvorak", "dvorák": "Dvorak",
    "saint-saens": "Saint-Saens", "saintsaens": "Saint-Saens", "saint-saëns": "Saint-Saens",
    "faure": "Faure", "fauré": "Faure",
    "bartok": "Bartok", "bartók": "Bartok",
    "kodaly": "Kodaly", "kodály": "Kodaly",
    "janacek": "Janacek", "janáček": "Janacek",
    "prokofiev": "Prokofiev", "prokofieff": "Prokofiev",
    "shostakovich": "Shostakovich", "schostakowitsch": "Shostakovich",
    "mussorgsky": "Mussorgsky", "musorgsky": "Mussorgsky", "moussorgsky": "Mussorgsky",
    "schoenberg": "Schoenberg", "schönberg": "Schoenberg",
    "handel": "Handel", "händel": "Handel", "haendel": "Handel",
    "grieg": "Grieg", "sibelius": "Sibelius",
    "part": "Part", "pärt": "Part",
    "lutoslawski": "Lutoslawski", "lutosławski": "Lutoslawski",
    "szymanowski": "Szymanowski",
    "villa-lobos": "Villa-Lobos", "villalobos": "Villa-Lobos",
    "albeniz": "Albeniz", "albéniz": "Albeniz",
    "falla": "Falla",
    "ysaye": "Ysaye", "ysaÿe": "Ysaye",
    "enescu": "Enescu", "enesco": "Enescu",
    "dohnanyi": "Dohnanyi", "dohnányi": "Dohnanyi",
    "martinu": "Martinu", "martinů": "Martinu",
    "scriabin": "Scriabin", "skrjabin": "Scriabin", "skryabin": "Scriabin",
    "glazunov": "Glazunov", "glazounov": "Glazunov",
    "khachaturian": "Khachaturian", "chatschaturjan": "Khachaturian",
    "rimsky-korsakov": "Rimsky-Korsakov", "rimskykorsakov": "Rimsky-Korsakov",
    "vaughan williams": "Vaughan Williams",
    "piazzolla": "Piazzolla",
}

# 성이 겹치는 작곡가 — 이니셜로 구분 (없으면 대표값)
FAMILY = {
    "Bach": {"j.s.": "Bach", "js": "Bach", "c.p.e.": "C.P.E.Bach", "cpe": "C.P.E.Bach",
             "j.c.": "J.C.Bach", "jc": "J.C.Bach", "w.f.": "W.F.Bach"},
    "Strauss": {"r.": "R.Strauss", "richard": "R.Strauss",
                "j.": "J.Strauss", "johann": "J.Strauss"},
    "Haydn": {"j.": "Haydn", "joseph": "Haydn", "m.": "M.Haydn", "michael": "M.Haydn"},
    "Mozart": {"w.a.": "Mozart", "wa": "Mozart", "wolfgang": "Mozart"},
    "Schumann": {"r.": "Schumann", "robert": "Schumann", "c.": "C.Schumann", "clara": "C.Schumann"},
    "Mendelssohn": {"f.": "Mendelssohn", "felix": "Mendelssohn", "fanny": "F.Mendelssohn-Hensel"},
}

INITIALS = re.compile(r"^((?:[A-Z]\.\s*){1,3})")


def norm_composer(comp_en, comp_ko):
    """(정규화된 작곡가 키, 신뢰도)"""
    cands = []
    for s in (comp_en, comp_ko):
        if not s:
            continue
        s = s.strip().strip(".,;:·-–— ")
        if not s or len(s) > 60:
            continue
        # 한국어
        k = re.sub(r"[\s·.]", "", s)
        if k in SURNAME_ALIAS:
            cands.append((SURNAME_ALIAS[k], 1.0))
            continue
        # 한국어인데 사전에 없으면 마지막 어절만 시도
        if re.search(r"[가-힣]", s):
            last = s.split()[-1]
            lk = re.sub(r"[\s·.]", "", last)
            if lk in SURNAME_ALIAS:
                cands.append((SURNAME_ALIAS[lk], 0.9))
            else:
                cands.append(("KO:" + lk, 0.3))
            continue
        # 영문: 이니셜 제거 후 성 추출
        m = INITIALS.match(s)
        prefix = (m.group(1).replace(" ", "").lower() if m else "")
        rest = s[m.end():].strip() if m else s
        rest = re.sub(r"\(.*?\)", "", rest).strip()
        low = unicodedata.normalize("NFC", rest).lower()
        low = re.sub(r"\s+", " ", low).strip(" .,")
        base = EN_ALIAS.get(low)
        if base is None:
            toks = low.replace("-", " ").split()
            if not toks:
                continue
            last = toks[-1]
            base = EN_ALIAS.get(last, last.capitalize())
            if len(toks) > 1 and toks[-2] in ("van", "von", "de", "del", "da", "vaughan", "saint"):
                base = EN_ALIAS.get(" ".join(toks[-2:]), base)
        if base in FAMILY and prefix:
            for p, v in FAMILY[base].items():
                if prefix.startswith(p.replace(".", "")) or prefix.replace(".", "").startswith(p.replace(".", "")):
                    base = v
                    break
        cands.append((base, 0.85))
    if not cands:
        return None, 0.0
    cands.sort(key=lambda x: -x[1])
    return cands[0]




# ---------------------------------------------------------------- 인덱스
def _openopus_surnames():
    p = os.path.join(BASE, "openopus_dump.json")
    out = {}
    if not os.path.exists(p):
        return out
    d = json.load(open(p))
    for c in d["composers"]:
        full = c["complete_name"]
        toks = re.sub(r"\(.*?\)", "", full).strip().split()
        if not toks:
            continue
        forms = [toks[-1]]
        if len(toks) > 1 and toks[-2].lower() in (
                "van", "von", "de", "del", "da", "der", "vaughan", "saint"):
            forms.append(" ".join(toks[-2:]))
        canon = None
        for f in forms:
            k = unicodedata.normalize("NFC", f).lower()
            if k in EN_ALIAS:
                canon = EN_ALIAS[k]
        if canon is None:
            base = toks[-1]
            canon = base[0].upper() + base[1:]
        for f in forms:
            k = unicodedata.normalize("NFC", f).lower()
            out.setdefault(k, canon)
            plain = "".join(ch for ch in unicodedata.normalize("NFD", k)
                            if unicodedata.category(ch) != "Mn")
            out.setdefault(plain, canon)
    return out


_OO = None


def en_surname_index():
    global _OO
    if _OO is None:
        _OO = _openopus_surnames()
        for k, v in EN_ALIAS.items():
            _OO[k] = v
    return _OO


_KO_RE = None


def ko_alias_regex():
    """한국어 작곡가 표기 매칭용 정규식 (긴 것 우선)."""
    global _KO_RE
    if _KO_RE is None:
        keys = sorted(SURNAME_ALIAS, key=len, reverse=True)
        _KO_RE = re.compile("(" + "|".join(re.escape(k) for k in keys) + ")")
    return _KO_RE


EN_WORD = re.compile(r"[A-Za-zÀ-ÿŠšŽžĆćČčĐđŁłŃńŘřŚśŤťŰűŮůŽ'’]{3,}(?:[- ][A-Za-zÀ-ÿ'’]{3,})?")


def find_composer_in_text(s):
    """문자열에서 작곡가를 찾는다. → (canon, confidence) 또는 (None, 0)"""
    # 한국어: 음절 경계 검사 (골드베르크 안의 '베르크' 차단)
    best = None
    for m in ko_alias_regex().finditer(s):
        a, b = m.start(), m.end()
        prev = s[a - 1] if a > 0 else ""
        nxt = s[b] if b < len(s) else ""
        if re.match(r"[가-힣]", prev) or re.match(r"[가-힣]", nxt):
            continue
        cand = (SURNAME_ALIAS[m.group(1)], 0.95, len(m.group(1)))
        if best is None or cand[2] > best[2]:
            best = cand
    if best:
        return best[0], best[1]
    idx = en_surname_index()
    for m in EN_WORD.finditer(s):
        raw = unicodedata.normalize("NFC", m.group(0)).lower().strip("'’- ")
        parts = re.split(r"[- ]", raw)
        for w in (raw, parts[0], parts[-1]):
            if w and w in idx:
                return idx[w], 0.9
    return None, 0.0


def find_composer_pos(s):
    """find_composer_in_text 와 같되 매칭 위치도 준다. → (canon, conf, start, end)"""
    best = None
    for m in ko_alias_regex().finditer(s):
        a, b = m.start(), m.end()
        prev = s[a - 1] if a > 0 else ""
        nxt = s[b] if b < len(s) else ""
        if re.match(r"[가-힣]", prev) or re.match(r"[가-힣]", nxt):
            continue
        cand = (SURNAME_ALIAS[m.group(1)], 0.95, a, b, len(m.group(1)))
        if best is None or cand[4] > best[4]:
            best = cand
    if best:
        return best[0], best[1], best[2], best[3]
    idx = en_surname_index()
    for m in EN_WORD.finditer(s):
        raw = unicodedata.normalize("NFC", m.group(0)).lower().strip("'’- ")
        parts = re.split(r"[- ]", raw)
        for w in (raw, parts[0], parts[-1]):
            if w and w in idx:
                off = m.group(0).lower().find(w)
                off = off if off >= 0 else 0
                return idx[w], 0.9, m.start() + off, m.start() + off + len(w)
    return None, 0.0, -1, -1
