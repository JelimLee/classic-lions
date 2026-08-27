#!/usr/bin/env python3
"""롯데콘서트홀 정규화 + 빈도 분석.

작품 키 규칙은 예당(sac_analyze.py)과 **완전히 동일**해야 한다. 안 그러면 두 홀을
비교할 수 없다. 그래서 형식어/번호/슬러그 정규화 함수를 sac_analyze 에서 import 하고,
'작품번호 -> (형식#번호)' 다수결 매핑은 **예당 + 롯데 합본**으로 만든다.
합본이어야 같은 곡이 두 홀에서 같은 id 를 받는다 (= app/data/repertoire.json 과 병합 가능).

parsed.jsonl -> works_index.json / perf_events.json
"""
import json
import os
import sys
import collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sac_analyze import canon_form, canon_num, slug, gini

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "lotte_programs")
SAC = os.path.join(ROOT, "work", "sac_programs")

# sac_analyze.main() 안의 로컬 상수와 같은 값이어야 한다 (import 불가라 복제).
GENERIC = {"sonata", "concerto", "quartet", "quintet", "trio", "sextet", "octet",
           "suite", "fantasy", None}


def occurrences(entries, venue_tag):
    """parsed 엔트리 -> 연주 기록(occurrence) 목록. sac_analyze.main() 과 같은 필드."""
    occ = []
    for e in entries:
        for w in e["works"]:
            comp = w["composer"]
            if not comp:
                continue
            txt = w["rawText"]
            occ.append({
                "sn": e["sn"], "date": e["date"], "venue": e.get("venue"),
                "hall": venue_tag,
                "concert": e["title"], "genre": e.get("genre"),
                "composer": comp, "form": canon_form(txt), "num": canon_num(txt),
                "opus": w["opus"], "slug": slug(txt),
                "raw": txt.split("\n")[0][:140], "rawFull": txt[:400],
                "isEncore": w["isEncore"], "key": w["key"],
                "soloist": w["soloist"], "seq": w["seq"],
                "parseConfidence": e["parseConfidence"],
            })
    return occ


def sac_occurrences():
    """예당 perf_events.json 을 그대로 읽어 온다 (재파싱 없음, 읽기 전용)."""
    p = os.path.join(SAC, "perf_events.json")
    if not os.path.exists(p):
        return []
    out = json.load(open(p))
    for o in out:
        o["hall"] = "SAC"
    return out


def build_key_map(*occ_lists):
    """작품번호 -> (형식#번호) 다수결 매핑. 여러 코퍼스를 합쳐서 만든다."""
    pair_all = collections.Counter()
    pair_spec = collections.Counter()
    for occ in occ_lists:
        for o in occ:
            a = f"{o['composer']}|{o['form']}#{o['num']}" if (o["form"] and o["num"]) else None
            b = f"{o['composer']}|{o['opus']}" if o["opus"] else None
            if a and b:
                pair_all[(b, a)] += 1
                if o["form"] not in GENERIC:
                    pair_spec[(b, a)] += 1
    b2a = {}
    for pc in (pair_spec, pair_all):
        for (b, a), n in pc.most_common():
            b2a.setdefault(b, (a, n))
    return b2a


def assign_keys(occ, b2a):
    for o in occ:
        a = f"{o['composer']}|{o['form']}#{o['num']}" if (o["form"] and o["num"]) else None
        b = f"{o['composer']}|{o['opus']}" if o["opus"] else None
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
    return occ


def index_works(occ):
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
    return works


# 서양 클래식 레퍼토리로 볼 장르 문턱. 예당과 같은 0.7.
CORE_CONF = 0.7


def main():
    entries = [json.loads(l) for l in open(os.path.join(BASE, "parsed.jsonl"))]
    # 대상 한정: 롯데콘서트홀에서 열린, 수집 범위(2016-2026) 안의 공연만.
    # ID 갭 스캔으로 딸려 온 페이지 중 다른 공연장/기간 밖 건을 여기서 떨군다.
    entries = [e for e in entries
               if e.get("venue") == "롯데콘서트홀" and "2016" <= e["date"][:4] <= "2026"]
    core = [e for e in entries if e["genreConfidence"] >= CORE_CONF]
    occ = occurrences(core, "LOTTE")
    sac = sac_occurrences()
    b2a = build_key_map(sac, occ)
    assign_keys(occ, b2a)
    assign_keys(sac, b2a)
    works = index_works(occ)

    json.dump(works, open(os.path.join(BASE, "works_index.json"), "w"), ensure_ascii=False)
    json.dump(occ, open(os.path.join(BASE, "perf_events.json"), "w"), ensure_ascii=False)
    print("occurrences:", len(occ), "unique works:", len(works),
          "| sac occurrences for comparison:", len(sac))
    return occ, works, core, entries, sac


if __name__ == "__main__":
    main()
