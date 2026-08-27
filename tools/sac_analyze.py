#!/usr/bin/env python3
"""정규화 + 빈도 분석.

parsed.jsonl → works_index.json / perf_events.json / app/data/repertoire.json / stats.json

정규화는 조사 결론대로 2단계다: 작곡가 먼저 → 작품.
작품 키는 (작곡가, 형식, 번호) 와 (작곡가, 작품번호) 를 union-find 로 합친다.
같은 곡이 어떤 프로그램에선 Op. 를 달고 어떤 프로그램에선 '5번'만 달고 나오기 때문이다.
"""
import json
import os
import re
import sys
import math
import collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sac_names import find_composer_in_text
from sac_parse import OPUS, FORM_RE, NUM_RE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "sac_programs")

FORM_CANON = [
    (r"교향시|symphonic poem|tone poem", "symphonic poem"),
    (r"교향곡|symphon(y|ie|ia)\b", "symphony"),
    (r"신포니에타|sinfoniett", "sinfonietta"),
    (r"신포니아|sinfonia", "sinfonia"),
    (r"피아노\s?협주곡|piano concerto|klavierkonzert", "piano concerto"),
    (r"두\s?대의\s?피아노|two pianos|2\s?pianos", "concerto for two pianos"),
    (r"플루트\s?협주곡|flute concerto", "flute concerto"),
    (r"클라리넷\s?협주곡|clarinet concerto", "clarinet concerto"),
    (r"오보에\s?협주곡|oboe concerto", "oboe concerto"),
    (r"바순\s?협주곡|파곳\s?협주곡|bassoon concerto", "bassoon concerto"),
    (r"호른\s?협주곡|horn concerto", "horn concerto"),
    (r"트럼펫\s?협주곡|trumpet concerto", "trumpet concerto"),
    (r"기타\s?협주곡|guitar concerto", "guitar concerto"),
    (r"하프\s?협주곡|harp concerto", "harp concerto"),
    (r"비올라\s?협주곡|viola concerto", "viola concerto"),
    (r"바이올린\s?협주곡|violin concerto", "violin concerto"),
    (r"첼로\s?협주곡|cello concerto", "cello concerto"),
    (r"협주곡|concerto|concerti", "concerto"),
    (r"현악\s?(사중주|4중주)|string quartet", "string quartet"),
    (r"피아노\s?(삼중주|3중주)|piano trio", "piano trio"),
    (r"피아노\s?(오중주|5중주)|piano quintet", "piano quintet"),
    (r"피아노\s?(사중주|4중주)|piano quartet", "piano quartet"),
    (r"현악\s?(오중주|5중주)|string quintet", "string quintet"),
    (r"(사중주|4중주)|quartet", "quartet"),
    (r"(오중주|5중주)|quintet", "quintet"),
    (r"현악\s?(삼중주|3중주)|string trio", "string trio"),
    (r"클라리넷\s?(삼중주|3중주)|clarinet trio", "clarinet trio"),
    (r"(삼중주|3중주)|trio", "trio"),
    (r"(육중주|6중주)|sextet", "sextet"),
    (r"(팔중주|8중주)|octet", "octet"),
    (r"바이올린\s?소나타|violin sonata|sonata for violin|violinsonate", "violin sonata"),
    (r"첼로\s?소나타|cello sonata|sonata for (?:violon)?cello", "cello sonata"),
    (r"비올라\s?소나타|viola sonata", "viola sonata"),
    (r"플루트\s?소나타|flute sonata", "flute sonata"),
    (r"클라리넷\s?소나타|clarinet sonata", "clarinet sonata"),
    (r"오보에\s?소나타|oboe sonata", "oboe sonata"),
    (r"바순\s?소나타|파곳\s?소나타|bassoon sonata", "bassoon sonata"),
    (r"호른\s?소나타|horn sonata", "horn sonata"),
    (r"트럼펫\s?소나타|trumpet sonata", "trumpet sonata"),
    (r"피아노\s?소나타|piano sonata|klaviersonate", "piano sonata"),
    (r"오르간\s?소나타|organ sonata", "organ sonata"),
    (r"소나타|sonat[ae]", "sonata"),
    (r"전주곡|prelude", "prelude"),
    (r"녹턴|야상곡|nocturne", "nocturne"),
    (r"연습곡|에튀드|에튜드|[eé]tude|study|studies", "etude"),
    (r"변주곡|variation", "variations"),
    (r"모음곡|조곡|suite", "suite"),
    (r"서곡|overture|ouvert", "overture"),
    (r"환상곡|판타지|fantas", "fantasy"),
    (r"즉흥곡|impromptu", "impromptu"),
    (r"마주르카|mazurka", "mazurka"),
    (r"폴로네즈|폴로네이즈|polonaise", "polonaise"),
    (r"왈츠|원무곡|waltz|valse|walzer", "waltz"),
    (r"발라드|ballade", "ballade"),
    (r"랩소디|광시곡|rhapsod", "rhapsody"),
    (r"레퀴엠|requiem", "requiem"),
    (r"미사|miss[ae]\b|mass\b", "mass"),
    (r"칸타타|cantata", "cantata"),
    (r"오라토리오|oratorio", "oratorio"),
    (r"세레나데|serenade", "serenade"),
    (r"디베르티멘토|divertimento", "divertimento"),
    (r"론도|rondo", "rondo"),
    (r"스케르초|scherzo", "scherzo"),
    (r"카프리스|카프리치오|capric", "caprice"),
    (r"토카타|toccata", "toccata"),
    (r"파르티타|partita", "partita"),
    (r"푸가|fugue", "fugue"),
    (r"모테트|motet", "motet"),
    (r"샤콘|chaconne", "chaconne"),
    (r"파사칼리아|passacaglia", "passacaglia"),
    (r"간주곡|intermezzo", "intermezzo"),
    (r"자장가|berceuse|lullaby", "berceuse"),
    (r"행진곡|march\b|marsch", "march"),
    (r"아리아|aria", "aria"),
    (r"가곡|lied", "lied"),
]


def canon_form(txt):
    for pat, val in FORM_CANON:
        if re.search(pat, txt, re.I):
            return val
    return None


def canon_num(txt):
    m = NUM_RE.search(txt)
    if not m:
        return None
    n = m.group(1) or m.group(2)
    if not n:
        return None
    n = int(n)
    return str(n) if 1 <= n <= 120 else None


STOPWORDS = set("""the a an of in for and or op no nr and with de la le les il un une
piano violin cello viola flute oboe clarinet horn trumpet solo duo major minor
sharp flat dur moll from and etc""".split())


def slug(txt):
    t = txt.split("\n")[0]
    t = re.sub(r"^[^:：\-–—]{2,45}\s*[-–—:：]\s*", "", t, count=1)
    t = re.sub(r"/.*$", "", t)
    t = OPUS.sub(" ", t)
    t = re.sub(r"[^A-Za-zÀ-ÿ가-힣0-9 ]", " ", t)
    t = re.sub(r"\s+", " ", t).strip().lower()
    toks = [w for w in t.split() if w not in STOPWORDS and len(w) > 1]
    return " ".join(toks[:6])


class UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def gini(counts):
    xs = sorted(counts)
    n = len(xs)
    if n == 0 or sum(xs) == 0:
        return 0.0
    cum = 0
    for i, x in enumerate(xs, 1):
        cum += i * x
    return (2 * cum) / (n * sum(xs)) - (n + 1) / n


def main():
    entries = [json.loads(l) for l in open(os.path.join(BASE, "parsed.jsonl"))]
    core = [e for e in entries if e["genreConfidence"] >= 0.7]

    occ = []
    for e in core:
        for w in e["works"]:
            comp = w["composer"]
            if not comp:
                continue
            txt = w["rawText"]
            form = canon_form(txt)
            num = canon_num(txt)
            op = w["opus"]
            occ.append({
                "sn": e["sn"], "date": e["date"], "venue": e["venue"],
                "concert": e["title"], "genre": e["genre"],
                "composer": comp, "form": form, "num": num, "opus": op,
                "slug": slug(txt), "raw": txt.split("\n")[0][:140],
                "rawFull": txt[:400],
                "isEncore": w["isEncore"], "key": w["key"],
                "soloist": w["soloist"], "seq": w["seq"],
                "parseConfidence": e["parseConfidence"],
            })

    # --- 작품 키 확정 (union-find 대신 다수결 매핑: 전이 병합 폭주를 막는다)
    GENERIC = {"sonata", "concerto", "quartet", "quintet", "trio", "sextet", "octet",
               "suite", "fantasy", None}
    pair_all = collections.Counter()
    pair_spec = collections.Counter()
    for o in occ:
        a = f"{o['composer']}|{o['form']}#{o['num']}" if (o["form"] and o["num"]) else None
        b = f"{o['composer']}|{o['opus']}" if o["opus"] else None
        o["_a"], o["_b"] = a, b
        if a and b:
            pair_all[(b, a)] += 1
            if o["form"] not in GENERIC:
                pair_spec[(b, a)] += 1
    b2a = {}
    for pc in (pair_spec, pair_all):
        for (b, a), n in pc.most_common():
            if b not in b2a:
                b2a[b] = (a, n)
    for o in occ:
        a, b = o.pop("_a"), o.pop("_b")
        # 작품번호가 있고 형식어가 뭉뚱그려진 경우('소나타 1번')는 다수결로 구체화한다
        if a and o["form"] in GENERIC and b in b2a:
            o["workKey"] = b2a[b][0]
        elif a:
            o["workKey"] = a
        elif b:
            o["workKey"] = b2a[b][0] if b in b2a else b
        elif o["form"] and o["slug"]:
            o["workKey"] = f"{o['composer']}|{o['form']}|{o['slug']}"
        elif o["slug"]:
            o["workKey"] = f"{o['composer']}|t|{o['slug']}"
        else:
            o["workKey"] = f"{o['composer']}|?|{o['raw'][:30]}"

    # 작품 인덱스
    idx = {}
    for o in occ:
        r = idx.setdefault(o["workKey"], {
            "workKey": o["workKey"], "composer": o["composer"],
            "form": o["form"], "opus": o["opus"], "number": o["num"],
            "count": 0, "encoreCount": 0, "labels": collections.Counter(),
            "dates": [], "concerts": set(),
        })
        r["count"] += 1
        if o["isEncore"]:
            r["encoreCount"] += 1
        r["labels"][o["raw"]] += 1
        r["dates"].append(o["date"])
        r["concerts"].add(o["sn"])
        if not r["form"] and o["form"]:
            r["form"] = o["form"]
        if not r["opus"] and o["opus"]:
            r["opus"] = o["opus"]

    works = []
    for r in idx.values():
        lab = r["labels"].most_common(3)
        works.append({
            "workKey": r["workKey"], "composer": r["composer"],
            "form": r["form"], "opus": r["opus"], "number": r["number"],
            "count": r["count"], "concertCount": len(r["concerts"]),
            "encoreCount": r["encoreCount"],
            "label": lab[0][0], "altLabels": [x[0] for x in lab[1:]],
            "firstDate": min(r["dates"]), "lastDate": max(r["dates"]),
            "months": sorted(collections.Counter(d[5:7] for d in r["dates"]).items()),
        })
    works.sort(key=lambda w: (-w["count"], w["composer"]))
    for i, w in enumerate(works, 1):
        w["rank"] = i
        w["rarity"] = round(1 - w["count"] / works[0]["count"], 4)

    json.dump(works, open(os.path.join(BASE, "works_index.json"), "w"), ensure_ascii=False)
    json.dump(occ, open(os.path.join(BASE, "perf_events.json"), "w"), ensure_ascii=False)
    print("occurrences:", len(occ), "unique works:", len(works))
    return occ, works, core, entries


if __name__ == "__main__":
    main()
