#!/usr/bin/env python3
"""예술의전당 상세페이지 HTML → ProgramEntry JSONL.

원칙
- rawText 는 무조건 보존한다. 파싱이 틀려도 원문이 있으면 나중에 고친다.
- 못 읽으면 null + 낮은 confidence. 지어내지 않는다.
- 소개 산문(연주자 약력)에 나오는 곡 언급을 연주 기록으로 세지 않는다 —
  이게 이 파서의 가장 중요한 방어선이다.
"""
import gzip
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sac_region import intro_region
from sac_names import find_composer_in_text, find_composer_pos

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "sac_programs")

# ------------------------------------------------------------------ 신호 정의
OPUS = re.compile(
    r"(?:\bOp(?:us)?\.?\s*(?:posth\.?\s*)?(\d+[a-zA-Z]?(?:\s*[-–/]\s*\d+[a-z]?)?)"
    r"|작품\s*(?:번호\s*)?(\d+(?:\s*[-–/]\s*\d+)?)"
    r"|\b(BWV|KV|K|D|Hob|WoO|RV|HWV|TrV|Sz|WAB|FP|BB|CD|JW|MWV|Anh|H|B|S)\.?\s*"
    r"(?:XVI\s*[:.]\s*)?(\d+[a-zA-Z]?(?:\s*[:.]\s*\d+)?))", re.I)

FORM_RE = re.compile(
    r"(교향곡|신포니아|협주곡|소나타|전주곡|녹턴|야상곡|연습곡|에튀드|에튜드|변주곡|모음곡|조곡|"
    r"서곡|환상곡|즉흥곡|마주르카|폴로네즈|폴로네이즈|왈츠|원무곡|발라드|랩소디|광시곡|미사|레퀴엠|"
    r"칸타타|오라토리오|교향시|세레나데|디베르티멘토|론도|스케르초|카프리스|카프리치오|토카타|푸가|"
    r"파르티타|모테트|미뉴에트|타란텔라|자장가|무언가|가곡|연가곡|사중주|4중주|삼중주|3중주|오중주|"
    r"5중주|이중주|2중주|육중주|6중주|팔중주|8중주|칠중주|7중주|중주곡|아리아|서주|간주곡|행진곡|"
    r"모음곡|무곡|춤곡|합창|성악곡|기악곡|하프시코드|판타지|샤콘|파사칼리아|트리오|콰르텟|콰르텟|"
    r"쿼텟|듀오|듀엣|심포니|신포니|콘체르토|프렐류드|프렐류디움|소나티나|오페라|모음곡|"
    r"미뉴엣|스케르초|녹턴|바가텔|카프리치오|랩소디|칸초네|로망스|엘레지|"
    r"\bSymphon(?:y|ie|ia)\b|\bConcerto\b|\bConcerti\b|\bSonat[ae]\b|\bPrelude|\bNocturne|"
    r"\b[EÉ]tude|\bEtude|\bVariation|\bSuite\b|\bOuvert|\bOverture\b|\bFantas|\bImpromptu|"
    r"\bMazurka|\bPolonaise|\bWaltz|\bValse\b|\bWalzer\b|\bBallade|\bRhapsod|\bMiss[ae]\b|"
    r"\bMass\b|\bRequiem\b|\bCantata\b|\bOratorio\b|\bSerenade\b|\bDivertimento\b|\bRondo\b|"
    r"\bScherzo\b|\bCapric|\bToccata\b|\bFugue?\b|\bPartita\b|\bMotet\b|\bMenuett?o?\b|"
    r"\bMinuet\b|\bTarantella\b|\bSinfoniett?a\b|\bQuartet\b|\bQuintet\b|\bTrio\b|\bSextet\b|"
    r"\bOctet\b|\bSeptet\b|\bDuo\b|\bAria\b|\bLied(?:er)?\b|\bChaconne\b|\bPassacaglia\b|"
    r"\bIntermezzo\b|\bNocturnes?\b|\bBerceuse\b|\bPolka\b|\bMarch\b|\bMarsch\b|\bDance\b|"
    r"\bDances\b|\bTanz\b|\bPoem\b|\bPoème\b|\bCaprice\b|\bStudy\b|\bStudies\b)", re.I)

NUM_RE = re.compile(r"(?:No\.?\s*|Nr\.?\s*|제\s*)(\d{1,3})\b|(\d{1,3})\s*번")

INTERMISSION = re.compile(
    r"^[\s\-–—~*·•]*(INTERMISSION|Intermission|인터미션|휴\s?식|중간\s?휴식)"
    r"[\s\-–—~*·•]*(\(?\s*\d+\s*(분|min|minutes?)\s*\)?)?[\s\-–—~*·•]*$", re.I)
ENCORE_HEAD = re.compile(r"^[\s\-–—*·•\[]*(앙\s?코\s?르|ENCORE|Encore|encore)\s*[\]\s:：\-–—]*$")
ENCORE_INLINE = re.compile(r"(앙\s?코\s?르|\bencore\b)", re.I)

PROG_HEAD = re.compile(
    r"^[\s\[\-–—*·•]*(?:\d\s*[.)]\s*)?(프로그램|PROGRAM|Program|PROGRAMME|Programme|연주\s?곡목|곡목|프로그램\s?안내)"
    r"[\s\]:：\-–—]*$")
STOP_HEAD = re.compile(
    r"^[\s\[\-–—*·•]*(?:\d\s*[.)]\s*)?("
    r"출연|출연진|출연자|연주자|아티스트|ARTIST|ARTISTS|Artist|Artists|"
    r"공연정보|공연 정보|티켓|예매|할인|주최|주관|문의|관람|기타|유의사항|안내|"
    r"프로필|PROFILE|Profile|소개|공연소개|작품소개|기획|후원|협찬|장소|일시|입장|"
    r"CAST|Cast|출연 및 제작|제작진|줄거리|시놉시스|SYNOPSIS"
    r")[\s\]:：\-–—]*$")

MOVEMENT = re.compile(
    r"^[\s\-–—*·•(\[]*("
    r"[IVXivx]{1,5}\s*[.．)\]]|"
    r"[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]+\s*[.．)\]]?|"
    r"\d\s*[.．)]\s*(?=[A-Za-zÀ-ÿ])|"
    r"제?\s*\d\s*악장"
    r")")
TEMPO = re.compile(
    r"^[\s\-–—*·•]*(Allegr|Adagi|Andant|Larg|Prest|Vivac|Moderat|Lent|Grave|Scherz|Menuett?|"
    r"Minuet|Final|Rond|Preludi|Fug|Ari|Variation|Introduct|Marci|March|Tempo|Sostenut|Assai|"
    r"Maestos|Molt|Con moto|Poco|Piu|Più|Non troppo|Recitativ|Chorale|Nicht|Sehr|Langsam|"
    r"Bewegt|Feierlich|Kräftig|Ruhig|Lebhaft)", re.I)

CONT = re.compile(
    r"^[\s,]*(?:(?:Op|WoO|BWV|KV|K|D|S|Hob|RV|HWV|Sz|B|H|No|Nr)\.?\s*\d|작품\s*\d|\d+\s*[,.]?\s*(?:Op|No)\.?|\d{1,3}\s*[,.]?\s*$)",
    re.I)

SENTENCE_END = re.compile(r"(다\.|다$|니다|습니다|였다|이다|였습니다|하였다|한다\.|된다|것이다|였고|하며|면서|"
                          r"때문|그리고|하지만|그러나|또한|이후|당시|현재|오늘날)")
NOISE = re.compile(
    r"(문의|예매|티켓|주최|주관|후원|협찬|저작권|홈페이지|www\.|http|할인|취소|환불|입장|"
    r"만\s?\d세|무료|초대|R석|S석|A석|B석|VIP|공연시간|관람시간|인터넷|콜센터|주차|"
    r"변경될 수|사정에 따라|미취학|초등학생|중학생|사진|촬영|녹음|녹화)")


LEAD = re.compile(r"^[\s\d]{0,4}[.)\]]?\s*[*·•▶▷■□◆◇※\-–—]{0,2}\s*")


def has_hangul(s):
    return bool(re.search(r"[가-힣]", s))


def latin_ratio(s):
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if ord(c) < 0x2000) / len(letters)


def work_signal(ln):
    """이 줄이 '곡 한 줄'로 보이는가 → 점수 (0=아님)"""
    if len(ln) > 450:
        return 0
    if NOISE.search(ln):
        return 0
    if SENTENCE_END.search(ln) and len(ln) > 40:
        return 0
    body = LEAD.sub("", ln).strip()
    comp, cconf, cpos, cend = find_composer_pos(body)
    strong = weak = False
    if comp:
        # 곡 줄은 작곡가가 맨 앞에 오고 곧바로 구분자가 붙거나, 줄 자체가 짧다.
        # 산문은 문장 중간에 작곡가 이름이 나온다 → 여기서 걸러진다.
        tail = body[cend:cend + 6]
        strong = cpos <= 30 and bool(re.match(r"\s*[-–—:：|｜┃ㅣ_,/·]", tail))
        weak = (not strong) and cpos <= 6 and len(body) <= 70
    if len(ln) > 200 and not strong:
        return 0
    has_op = bool(OPUS.search(ln))
    has_form = bool(FORM_RE.search(ln))
    score = 0
    if strong:
        score += 3
    elif weak:
        score += 2
    if has_op:
        score += 2
    if has_form:
        score += 1
    if score < 3:
        return 0
    return score


def find_block(lines):
    """프로그램 블록을 찾는다. → (block_lines, method)"""
    # (a) 명시적 헤딩
    for i, ln in enumerate(lines):
        if len(ln) < 40 and PROG_HEAD.match(ln):
            block = []
            for ln2 in lines[i + 1:]:
                if len(ln2) < 40 and (STOP_HEAD.match(ln2) or PROG_HEAD.match(ln2)):
                    break
                if len(ln2) > 450:
                    break
                block.append(ln2)
                if len(block) > 250:
                    break
            if any(work_signal(x) for x in block):
                return block, "heading"
    # (b) 클러스터링 — work-like 줄들의 최대 연속 구간(공백 허용)
    flags = [work_signal(ln) > 0 for ln in lines]
    if not any(flags):
        return [], "none"
    best = None
    i = 0
    n = len(lines)
    while i < n:
        if not flags[i]:
            i += 1
            continue
        j = i
        gap = 0
        last_hit = i
        while j + 1 < n:
            j += 1
            if flags[j]:
                gap = 0
                last_hit = j
            else:
                if len(lines[j]) > 450:
                    break
                gap += 1
                if gap > 4:
                    break
        seg = (i, last_hit)
        cnt = sum(1 for k in range(i, last_hit + 1) if flags[k])
        if best is None or cnt > best[0]:
            best = (cnt, seg)
        i = last_hit + 1
    s, e = best[1]
    return lines[s:e + 1], "cluster"


def parse_opus(s):
    m = OPUS.search(s)
    if not m:
        return None
    if m.group(1):
        return "op." + re.sub(r"\s+", "", m.group(1)).lower()
    if m.group(2):
        return "op." + re.sub(r"\s+", "", m.group(2)).lower()
    cat = m.group(3).upper()
    cat = {"KV": "K"}.get(cat, cat)
    return f"{cat}.{re.sub(chr(92)+'s+', '', m.group(4)).lower()}"


KEY_EN = re.compile(
    r"\b(?:in\s+)?([A-Ga-g])[\s-]?(sharp|flat|#|♯|♭)?[\s-]*(major|minor|Major|Minor|dur|moll)\b")
KEY_KO = re.compile(r"((?:올림|내림)?[다라마바사가나])\s?(장조|단조)")


def parse_key(s):
    m = KEY_KO.search(s)
    if m:
        return m.group(1) + m.group(2)
    m = KEY_EN.search(s)
    if m:
        acc = (m.group(2) or "").lower()
        acc = {"#": "sharp", "♯": "sharp", "♭": "flat"}.get(acc, acc)
        mode = m.group(3).lower()
        mode = {"dur": "major", "moll": "minor"}.get(mode, mode)
        return f"{m.group(1).upper()}{(' ' + acc) if acc else ''} {mode}"
    return None


SPLIT = re.compile(r"^(.{2,45}?)\s*[-–—:：|｜┃ㅣ]\s*(.+)$")


def split_line(ln):
    """'B. Britten: Simple Symphony, Op. 4 / 협연 홍길동'
       → (composerText, titleText, soloist)"""
    s = LEAD.sub("", ln).strip()
    soloist = None
    if "/" in s:
        head, tail = s.rsplit("/", 1)
        tail = tail.strip()
        if 0 < len(tail) <= 45 and not OPUS.search(tail) and not FORM_RE.search(tail):
            soloist = tail
            s = head.strip()
    m = SPLIT.match(s)
    if m and not re.match(r"^\s*(No|Op|op|제)\b", m.group(1)):
        return m.group(1).strip(), m.group(2).strip(), soloist
    return None, s, soloist


NAME_TOK = re.compile(r"^(?:[A-ZÀ-Ý][a-zà-ÿ.'’\-]*|[A-Z]\.|van|von|de|del|da|der|le|la|di|"
                      r"[가-힣]{1,7}|\d{3,4}|[-–—()]+)$")


def composer_header(ln):
    """'Johann Sebastian Bach (1685-1750)' 처럼 작곡가 이름만 있는 줄인가."""
    body = LEAD.sub("", ln).strip()
    if len(body) > 60 or not body:
        return None
    if OPUS.search(body) or FORM_RE.search(body):
        return None
    comp, conf, cpos, cend = find_composer_pos(body)
    if not comp or cpos > 30:
        return None
    rest = body[:cpos] + " " + body[cend:]
    rest = re.sub(r"\(.*?\)|\[.*?\]", " ", rest)
    rest = re.sub(r"[,:：·、;]", " ", rest)
    toks = [t for t in rest.split() if t]
    if all(NAME_TOK.match(t) for t in toks):
        return comp
    return None


def is_translation(cur, ln):
    """앞 곡 줄과 이 줄이 같은 곡의 한/영 병기인가."""
    prev = cur["rawText"].split("\n")[0]
    lp, ln_r = latin_ratio(prev), latin_ratio(ln)
    if not ((lp > 0.55 and ln_r < 0.45) or (lp < 0.45 and ln_r > 0.55)):
        return False
    op_a, op_b = cur["opus"], parse_opus(ln)
    if op_a and op_b and op_a != op_b:
        return False
    c_b = find_composer_in_text(ln)[0]
    if cur["composer"] and c_b and cur["composer"] != c_b:
        return False
    if op_a and op_b and op_a == op_b:
        return True
    if cur["composer"] and c_b and cur["composer"] == c_b:
        return True
    # 한쪽에만 작곡가가 있고 번호도 안 어긋나면 병기로 본다
    if not c_b or not cur["composer"]:
        na = NUM_RE.search(prev)
        nb = NUM_RE.search(ln)
        if na and nb and (na.group(1) or na.group(2)) != (nb.group(1) or nb.group(2)):
            return False
        return True
    return False


def parse_block(block):
    works = []
    after_int = False
    encore = False
    cur = None
    ctx_composer = None

    def flush():
        nonlocal cur
        if cur is not None:
            works.append(cur)
        cur = None

    for raw in block:
        ln = raw.strip()
        if not ln or ln in ("ㅡ", "-", "–", "—", "*"):
            continue
        hdr = composer_header(ln)
        if hdr:
            flush()
            ctx_composer = hdr
            continue
        if INTERMISSION.match(ln):
            flush()
            after_int = True
            continue
        if ENCORE_HEAD.match(ln):
            flush()
            encore = True
            continue
        if cur is not None and not cur["movements"] and CONT.match(ln) and len(ln) < 30:
            # <br> 로 잘린 꼬리 (예: '슈만, 교향곡 ...' / 'WoO 29')
            cur["rawText"] = cur["rawText"].rstrip() + " " + ln
            if not cur["opus"]:
                cur["opus"] = parse_opus(cur["rawText"])
            if not cur["key"]:
                cur["key"] = parse_key(cur["rawText"])
            continue
        if cur is not None and (MOVEMENT.match(ln) or (TEMPO.match(ln) and len(ln) < 100)):
            cur["movements"].append(ln)
            continue
        sig = work_signal(ln)
        if sig == 0:
            # 앞 곡의 한글 병기 줄일 수 있다
            if (cur is not None and not cur["_paired"] and has_hangul(ln)
                    and latin_ratio(cur["rawText"].split("\n")[0]) > 0.55
                    and len(ln) < 160 and not NOISE.search(ln)
                    and (FORM_RE.search(ln) or OPUS.search(ln)
                         or find_composer_in_text(ln)[0])):
                pass  # 아래에서 병합
            else:
                continue
        else:
            # 새 곡인가 병기 줄인가?
            if cur is not None and not cur["_paired"] and is_translation(cur, ln):
                pass  # 병합
            else:
                flush()
                comp, title, sol = split_line(ln)
                ccanon, cconf = find_composer_in_text(comp or ln)
                if not ccanon and ctx_composer:
                    ccanon, cconf = ctx_composer, 0.7
                cur = {
                    "rawText": ln,
                    "composer": ccanon,
                    "composerConfidence": cconf,
                    "composerRaw": comp,
                    "composerKo": comp if (comp and has_hangul(comp)) else None,
                    "workTitle": title or None,
                    "workTitleKo": title if has_hangul(title or "") else None,
                    "opus": parse_opus(ln),
                    "key": parse_key(ln),
                    "movements": [],
                    "soloist": sol,
                    "isEncore": encore or bool(ENCORE_INLINE.search(ln)),
                    "afterIntermission": after_int,
                    "_paired": False,
                }
                continue
        # 병합 경로
        cur["rawText"] += "\n" + ln
        cur["_paired"] = True
        comp, title, sol = split_line(ln)
        if comp and has_hangul(comp):
            cur["composerKo"] = comp
        if title and has_hangul(title):
            cur["workTitleKo"] = title
        if not cur["opus"]:
            cur["opus"] = parse_opus(ln)
        if not cur["key"]:
            cur["key"] = parse_key(ln)
        if not cur["soloist"] and sol:
            cur["soloist"] = sol
        if not cur["composer"]:
            c, cc = find_composer_in_text(ln)
            if c:
                cur["composer"], cur["composerConfidence"] = c, cc
    flush()
    for i, w in enumerate(works):
        w["seq"] = i + 1
        w.pop("_paired", None)
        if not w["composer"] and w.pop("_ctx", None):
            pass
    return works


PERFORMER = re.compile(
    r"(지휘|conductor|피아노|piano|바이올린|violin|첼로|cello|비올라|viola|플루트|flute|"
    r"오보에|oboe|클라리넷|clarinet|바순|bassoon|호른|horn|트럼펫|trumpet|트롬본|trombone|"
    r"소프라노|soprano|메조|mezzo|알토|alto|테너|tenor|바리톤|baritone|베이스|bass|"
    r"하프|harp|기타|guitar|오르간|organ|하프시코드|harpsichord|타악|percussion|"
    r"관현악단|오케스트라|orchestra|합창단|choir|chorus|앙상블|ensemble|사중주단|quartet)", re.I)


def parse_one(sn, html, meta):
    lines = intro_region(html) or []
    entry = {
        "sn": sn,
        "date": meta["date"],
        "endDate": meta.get("endDate"),
        "title": meta["title"],
        "venue": meta["venue"],
        "genre": meta["genre"],
        "genreConfidence": meta["genreConfidence"],
        "introLines": len(lines),
        "works": [],
        "performers": [],
        "parseConfidence": 0.0,
        "blockMethod": "none",
    }
    if not lines:
        return entry
    block, method = find_block(lines)
    entry["blockMethod"] = method
    if not block:
        return entry
    entry["programRaw"] = "\n".join(block)[:6000]
    works = parse_block(block)
    entry["works"] = works
    perf = []
    for ln in lines[:120]:
        if len(ln) < 60 and PERFORMER.search(ln) and not FORM_RE.search(ln) and not OPUS.search(ln):
            perf.append(ln)
    entry["performers"] = perf[:20]
    entry["perfText"] = "\n".join(lines[:150])[:5000]
    if works:
        n_op = sum(1 for w in works if w["opus"])
        n_c = sum(1 for w in works if w["composer"])
        base = 0.35 if method == "cluster" else 0.45
        entry["parseConfidence"] = round(
            base + 0.3 * (n_c / len(works)) + 0.25 * (n_op / len(works)), 2)
    return entry


def main():
    targets = {t["sn"]: t for t in json.load(open(os.path.join(BASE, "targets.json")))}
    out_path = os.path.join(BASE, "parsed.jsonl")
    n = 0
    with open(out_path, "w") as out:
        for path in sorted(glob.glob(os.path.join(BASE, "raw", "*.html.gz"))):
            sn = os.path.basename(path).split(".")[0]
            if sn not in targets:
                continue
            try:
                with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
                    html = f.read()
            except Exception as e:
                print("READFAIL", sn, e)
                continue
            out.write(json.dumps(parse_one(sn, html, targets[sn]), ensure_ascii=False) + "\n")
            n += 1
    print("parsed", n, "->", out_path)


if __name__ == "__main__":
    main()
