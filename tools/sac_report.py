#!/usr/bin/env python3
"""빈도 분석 리포트 — 가설 검증 숫자 산출."""
import json
import os
import re
import sys
import collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sac_analyze as A

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "sac_programs")

ARTISTS = [
    ("임윤찬", ["임윤찬", "Yunchan Lim", "Lim Yunchan"]),
    ("손열음", ["손열음", "Yeol Eum Son", "Son Yeol Eum"]),
    ("조성진", ["조성진", "Seong-Jin Cho", "Seong Jin Cho"]),
    ("김선욱", ["김선욱", "Sunwook Kim"]),
    ("백건우", ["백건우", "Kun Woo Paik", "Kun-Woo Paik"]),
    ("선우예권", ["선우예권", "Yekwon Sunwoo"]),
    ("문지영", ["문지영", "Jiyeong Mun", "Ji Yeong Mun"]),
    ("박재홍", ["박재홍"]),
    ("임동혁", ["임동혁", "Dong Hyek Lim", "Dong-Hyek Lim"]),
    ("조진주", ["조진주"]),
    ("클라라 주미 강", ["클라라 주미 강", "클라라주미강", "Clara-Jumi Kang", "Clara Jumi Kang"]),
    ("정경화", ["정경화", "Kyung Wha Chung", "Kyung-Wha Chung"]),
    ("한동일", ["한동일"]),
    ("김봄소리", ["김봄소리", "Bomsori"]),
    ("양인모", ["양인모", "Inmo Yang"]),
    ("이혁", ["이혁", "Hyuk Lee"]),
    ("황수미", ["황수미", "Sumi Hwang"]),
    ("조성현", ["조성현"]),
    ("최하영", ["최하영", "Hayoung Choi"]),
    ("한재민", ["한재민", "Jaemin Han"]),
]


def cum_coverage(counts_sorted, total):
    out = []
    acc = 0
    for i, c in enumerate(counts_sorted, 1):
        acc += c
        out.append((i, acc, acc / total))
    return out


def main():
    occ, works, core, entries = A.main()
    stats = {}

    # ---------------- 수집 범위
    by_year = collections.Counter(e["date"][:4] for e in entries)
    parsed_ok = [e for e in entries if e["works"]]
    stats["collection"] = {
        "targets": len(entries),
        "byYear": dict(sorted(by_year.items())),
        "introEmpty": sum(1 for e in entries if e["introLines"] == 0),
        "blockMethod": dict(collections.Counter(e["blockMethod"] for e in entries)),
        "withWorks": len(parsed_ok),
        "coreGenre": len(core),
        "coreWithWorks": sum(1 for e in core if e["works"]),
        "occurrences": len(occ),
        "uniqueWorks": len(works),
    }

    # 연도별 파싱 성공률
    yr = collections.defaultdict(lambda: [0, 0, 0])
    for e in entries:
        y = e["date"][:4]
        yr[y][0] += 1
        if e["introLines"] > 0:
            yr[y][1] += 1
        if e["works"]:
            yr[y][2] += 1
    stats["byYearParse"] = {k: v for k, v in sorted(yr.items())}

    # ---------------- 편중
    counts = [w["count"] for w in works]
    total = sum(counts)
    cov = cum_coverage(counts, total)
    marks = [10, 25, 50, 100, 200, 300, 500, 1000, 2000, 3000]
    stats["coverage"] = {
        "totalPerformances": total, "uniqueWorks": len(works),
        "topN": {n: round(cov[min(n, len(cov)) - 1][2] * 100, 1) for n in marks if n <= len(cov)},
        "gini": round(A.gini(counts), 3),
        "top10pctShare": round(sum(counts[:max(1, len(counts) // 10)]) / total * 100, 1),
        "top50pctShare": round(sum(counts[:max(1, len(counts) // 2)]) / total * 100, 1),
        "playedOnce": sum(1 for c in counts if c == 1),
        "playedOncePct": round(sum(1 for c in counts if c == 1) / len(counts) * 100, 1),
        "played5plus": sum(1 for c in counts if c >= 5),
        "played10plus": sum(1 for c in counts if c >= 10),
        "median": sorted(counts)[len(counts) // 2],
    }
    stats["topWorks"] = [
        {"rank": w["rank"], "composer": w["composer"], "label": w["label"],
         "count": w["count"], "concerts": w["concertCount"], "form": w["form"],
         "opus": w["opus"]}
        for w in works[:60]]

    # ---------------- 작곡가
    comp = collections.Counter(o["composer"] for o in occ)
    comp_works = collections.defaultdict(set)
    for o in occ:
        comp_works[o["composer"]].add(o["workKey"])
    ctot = sum(comp.values())
    stats["topComposers"] = [
        {"composer": c, "count": n, "share": round(n / ctot * 100, 2),
         "uniqueWorks": len(comp_works[c])}
        for c, n in comp.most_common(30)]
    stats["composerStats"] = {
        "unique": len(comp),
        "top10Share": round(sum(n for _, n in comp.most_common(10)) / ctot * 100, 1),
        "top20Share": round(sum(n for _, n in comp.most_common(20)) / ctot * 100, 1),
        "gini": round(A.gini(list(comp.values())), 3),
    }

    # ---------------- 연주자별 레퍼토리 희귀도
    rarity = {w["workKey"]: w for w in works}
    occ_by_sn = collections.defaultdict(list)
    for o in occ:
        occ_by_sn[o["sn"]].append(o)
    ent_by_sn = {e["sn"]: e for e in entries}

    corpus_ranks = [rarity[o["workKey"]]["rank"] for o in occ]
    corpus_counts = [rarity[o["workKey"]]["count"] for o in occ]
    med = sorted(corpus_ranks)[len(corpus_ranks) // 2]
    stats["corpusBaseline"] = {
        "medianRank": med,
        "meanRank": round(sum(corpus_ranks) / len(corpus_ranks), 1),
        "pctRare": round(sum(1 for c in corpus_counts if c <= 2) / len(corpus_counts) * 100, 1),
        "meanCount": round(sum(corpus_counts) / len(corpus_counts), 1),
    }

    art_rows = []
    for name, pats in ARTISTS:
        pat = re.compile("|".join(re.escape(p) for p in pats), re.I)
        sns = set()
        for e in entries:
            # 출연 크레딧에만 매칭한다. 남의 약력 산문에 이름이 언급된 것은 세지 않는다.
            hay = "\n".join(
                [e.get("title") or ""]
                + list(e.get("performers") or [])
                + [w.get("soloist") or "" for w in e["works"]])
            if pat.search(hay):
                sns.add(e["sn"])
        head_sns = {e["sn"] for e in entries if pat.search(e.get("title") or "")}
        ws = [o for sn in sns for o in occ_by_sn.get(sn, [])]
        hws = [o for sn in head_sns for o in occ_by_sn.get(sn, [])]
        if not ws:
            art_rows.append({"artist": name, "concerts": len(sns), "works": 0})
            continue
        rk = [rarity[o["workKey"]]["rank"] for o in ws]
        cn = [rarity[o["workKey"]]["count"] for o in ws]
        art_rows.append({
            "artist": name,
            "concerts": len(sns),
            "works": len(ws),
            "uniqueWorks": len({o["workKey"] for o in ws}),
            "medianRank": sorted(rk)[len(rk) // 2],
            "meanRank": round(sum(rk) / len(rk), 1),
            "pctRare": round(sum(1 for c in cn if c <= 2) / len(cn) * 100, 1),
            "pctTop100": round(sum(1 for r in rk if r <= 100) / len(rk) * 100, 1),
            "meanCount": round(sum(cn) / len(cn), 1),
            "sampleWorks": [rarity[o["workKey"]]["label"][:60] for o in ws[:6]],
        })
        if hws:
            hrk = [rarity[o["workKey"]]["rank"] for o in hws]
            hcn = [rarity[o["workKey"]]["count"] for o in hws]
            art_rows[-1].update({
                "headlineConcerts": len(head_sns),
                "headlineWorks": len(hws),
                "headlineMedianRank": sorted(hrk)[len(hrk) // 2],
                "headlinePctRare": round(sum(1 for c in hcn if c <= 2) / len(hcn) * 100, 1),
            })
    art_rows.sort(key=lambda r: -(r.get("medianRank") or 0))
    stats["artists"] = art_rows

    # ---------------- 공동출현
    pairs = collections.Counter()
    for sn, os_ in occ_by_sn.items():
        ks = sorted({o["workKey"] for o in os_})
        for i in range(len(ks)):
            for j in range(i + 1, len(ks)):
                pairs[(ks[i], ks[j])] += 1
    stats["topPairs"] = [
        {"a": rarity[a]["label"][:70], "b": rarity[b]["label"][:70], "count": n}
        for (a, b), n in pairs.most_common(25)]

    # ---------------- 프로그램 구성 패턴
    shapes = collections.Counter()
    classic_shape = 0
    orch = 0
    for sn, os_ in occ_by_sn.items():
        e = ent_by_sn.get(sn)
        if not e or e["genre"] not in ("교향곡", "클래식", "관현악"):
            continue
        seq = [o["form"] for o in sorted(os_, key=lambda x: x["seq"])]
        if len(seq) < 2:
            continue
        orch += 1
        shapes[tuple(x or "?" for x in seq)[:4]] += 1
        has_ov = any(f == "overture" for f in seq)
        ci = next((i for i, f in enumerate(seq) if f and "concerto" in f), None)
        si = next((i for i, f in enumerate(seq) if f == "symphony"), None)
        if ci is not None and si is not None and ci < si:
            classic_shape += 1
    stats["programShape"] = {
        "orchestraConcerts": orch,
        "concertoBeforeSymphony": classic_shape,
        "concertoBeforeSymphonyPct": round(classic_shape / orch * 100, 1) if orch else None,
        "topShapes": [{"shape": " → ".join(s), "count": n} for s, n in shapes.most_common(12)],
    }

    # ---------------- 계절성
    month_work = collections.defaultdict(collections.Counter)
    for o in occ:
        month_work[o["date"][5:7]][o["workKey"]] += 1
    season = {}
    for m in sorted(month_work):
        tot = sum(month_work[m].values())
        rows = []
        for k, n in month_work[m].most_common(200):
            overall = rarity[k]["count"]
            share_m = n / tot
            share_all = overall / total
            if n >= 3 and share_m > share_all * 2.0:
                rows.append({"label": rarity[k]["label"][:60], "inMonth": n,
                             "overall": overall, "lift": round(share_m / share_all, 1)})
        rows.sort(key=lambda r: -r["lift"])
        season[m] = {"occurrences": tot, "top": rows[:6]}
    stats["seasonality"] = season

    json.dump(stats, open(os.path.join(BASE, "stats.json"), "w"), ensure_ascii=False, indent=1)

    # ---------------- app/data/repertoire.json
    rep = {
        "source": "예술의전당 콘서트홀·IBK챔버홀 공연 상세페이지 (www.sac.or.kr)",
        "collectedAt": "2026-08-27",
        "range": {"from": min(e["date"] for e in entries), "to": max(e["date"] for e in entries)},
        "concertsParsed": len([e for e in core if e["works"]]),
        "performances": total,
        "works": [
            {"id": w["workKey"], "composer": w["composer"], "label": w["label"],
             "form": w["form"], "opus": w["opus"], "number": w["number"],
             "count": w["count"], "concerts": w["concertCount"],
             "rank": w["rank"], "rarity": w["rarity"],
             "rarityPct": round(w["rank"] / len(works), 4),
             "firstDate": w["firstDate"], "lastDate": w["lastDate"],
             "monthHist": dict(w["months"]), "altLabels": w["altLabels"]}
            for w in works],
    }
    outp = os.path.join(ROOT, "app", "data", "repertoire.json")
    json.dump(rep, open(outp, "w"), ensure_ascii=False)
    print("wrote", outp, os.path.getsize(outp), "bytes")
    print(json.dumps(stats["coverage"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
