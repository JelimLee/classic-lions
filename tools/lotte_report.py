#!/usr/bin/env python3
"""롯데콘서트홀 빈도 분석 리포트 + 예당 비교.

산출: work/lotte_programs/stats.json, app/data/repertoire_lotte.json
지표 정의는 docs/REPERTOIRE_ANALYSIS.md(예당) 와 동일하게 맞췄다.
"""
import json
import os
import re
import sys
import collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lotte_analyze as A
from sac_analyze import gini

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "lotte_programs")

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
    ("김봄소리", ["김봄소리", "Bomsori"]),
    ("양인모", ["양인모", "Inmo Yang"]),
    ("이혁", ["이혁", "Hyuk Lee"]),
    ("황수미", ["황수미", "Sumi Hwang"]),
    ("최하영", ["최하영", "Hayoung Choi"]),
    ("한재민", ["한재민", "Jaemin Han"]),
]


def cum_coverage(counts_sorted, total):
    out, acc = [], 0
    for i, c in enumerate(counts_sorted, 1):
        acc += c
        out.append((i, acc, acc / total))
    return out


def main():
    occ, works, core, entries, sac_occ = A.main()
    stats = {}

    raw_entries = [json.loads(l) for l in open(os.path.join(BASE, "parsed.jsonl"))]
    dropped = collections.Counter()
    for e in raw_entries:
        if not e.get("pageOk"):
            dropped["페이지 파싱 실패"] += 1
        elif e.get("venue") != "롯데콘서트홀":
            dropped[f"다른 공연장: {e.get('venue')}"] += 1
        elif not ("2016" <= e["date"][:4] <= "2026"):
            dropped[f"기간 밖: {e['date'][:4]}"] += 1
    stats["fetchedPages"] = len(raw_entries)
    stats["droppedPages"] = dict(dropped.most_common(20))
    errp = os.path.join(BASE, "fetch_errors.json")
    stats["httpErrors"] = json.load(open(errp)) if os.path.exists(errp) else {}
    stats["httpErrorCount"] = len(stats["httpErrors"])

    dated = [e for e in entries if e["date"]]
    by_year = collections.Counter(e["date"][:4] for e in dated)
    stats["collection"] = {
        "targets": len(entries),
        "dated": len(dated),
        "byYear": dict(sorted(by_year.items())),
        "pageOk": sum(1 for e in entries if e.get("pageOk")),
        "introEmpty": sum(1 for e in entries if e["introLines"] == 0),
        "blockMethod": dict(collections.Counter(e["blockMethod"] for e in entries)),
        "withWorks": sum(1 for e in entries if e["works"]),
        "coreGenre": len(core),
        "coreWithWorks": sum(1 for e in core if e["works"]),
        "occurrences": len(occ),
        "uniqueWorks": len(works),
        "imageOnly": sum(1 for e in entries if e["blockMethod"] == "image-only"),
        "imagesTotal": sum(len(e.get("images") or []) for e in entries),
    }

    # 연도별 [대상, 본문있음, 곡추출성공]  — core(클래식) 기준
    yr = collections.defaultdict(lambda: [0, 0, 0])
    for e in core:
        if not e["date"]:
            continue
        y = e["date"][:4]
        yr[y][0] += 1
        if e["introLines"] > 0:
            yr[y][1] += 1
        if e["works"]:
            yr[y][2] += 1
    stats["byYearParse"] = {k: v for k, v in sorted(yr.items())}

    stats["genreMix"] = dict(collections.Counter(e.get("genreRaw") for e in entries).most_common(40))
    stats["productionType"] = dict(collections.Counter(e.get("productionType") for e in entries))
    # 기획/대관별 곡목 확보율
    pt = collections.defaultdict(lambda: [0, 0])
    for e in core:
        k = e.get("productionType") or "?"
        pt[k][0] += 1
        if e["works"]:
            pt[k][1] += 1
    stats["programByProductionType"] = {k: v for k, v in pt.items()}

    # ---------------- 편중
    counts = [w["count"] for w in works]
    total = sum(counts)
    cov = cum_coverage(counts, total)
    marks = [10, 25, 50, 100, 200, 300, 500, 1000, 2000, 3000]
    need = {}
    for tgt in (0.5, 0.6, 0.7, 0.8, 0.9, 0.95):
        for i, _, f in cov:
            if f >= tgt:
                need[str(int(tgt * 100))] = i
                break
    stats["coverage"] = {
        "totalPerformances": total, "uniqueWorks": len(works),
        "topN": {n: round(cov[min(n, len(cov)) - 1][2] * 100, 1) for n in marks if n <= len(cov)},
        "needForCoverage": need,
        "gini": round(gini(counts), 3),
        "top10pctShare": round(sum(counts[:max(1, len(counts) // 10)]) / total * 100, 1),
        "top50pctShare": round(sum(counts[:max(1, len(counts) // 2)]) / total * 100, 1),
        "playedOnce": sum(1 for c in counts if c == 1),
        "playedOncePct": round(sum(1 for c in counts if c == 1) / len(counts) * 100, 1),
        "played5plus": sum(1 for c in counts if c >= 5),
        "played10plus": sum(1 for c in counts if c >= 10),
        "played20plus": sum(1 for c in counts if c >= 20),
        "median": sorted(counts)[len(counts) // 2],
    }
    stats["topWorks"] = [
        {"rank": w["rank"], "composer": w["composer"], "label": w["label"],
         "count": w["count"], "concerts": w["concertCount"], "form": w["form"],
         "opus": w["opus"]} for w in works[:60]]

    # ---------------- 작곡가
    comp = collections.Counter(o["composer"] for o in occ)
    comp_works = collections.defaultdict(set)
    for o in occ:
        comp_works[o["composer"]].add(o["workKey"])
    ctot = sum(comp.values())
    stats["topComposers"] = [
        {"composer": c, "count": n, "share": round(n / ctot * 100, 2),
         "uniqueWorks": len(comp_works[c])} for c, n in comp.most_common(30)]
    stats["composerStats"] = {
        "unique": len(comp),
        "top10Share": round(sum(n for _, n in comp.most_common(10)) / ctot * 100, 1),
        "top20Share": round(sum(n for _, n in comp.most_common(20)) / ctot * 100, 1),
        "top30Share": round(sum(n for _, n in comp.most_common(30)) / ctot * 100, 1),
        "gini": round(gini(list(comp.values())), 3),
    }

    # ---------------- 신규 작품(포화 여부)
    first_seen = {}
    for o in sorted(occ, key=lambda x: x["date"]):
        first_seen.setdefault(o["workKey"], o["date"][:4])
    novelty = collections.defaultdict(lambda: [0, 0])
    per_year_works = collections.defaultdict(set)
    for o in occ:
        per_year_works[o["date"][:4]].add(o["workKey"])
    for y, ws in per_year_works.items():
        novelty[y][0] = len(ws)
        novelty[y][1] = sum(1 for w in ws if first_seen[w] == y)
    stats["novelty"] = {k: v for k, v in sorted(novelty.items())}

    # ---------------- 연주자별 희귀도
    rarity = {w["workKey"]: w for w in works}
    occ_by_sn = collections.defaultdict(list)
    for o in occ:
        occ_by_sn[o["sn"]].append(o)
    ranks = [rarity[o["workKey"]]["rank"] for o in occ]
    cnts = [rarity[o["workKey"]]["count"] for o in occ]
    stats["corpusBaseline"] = {
        "medianRank": sorted(ranks)[len(ranks) // 2],
        "meanRank": round(sum(ranks) / len(ranks), 1),
        "pctRare": round(sum(1 for c in cnts if c <= 2) / len(cnts) * 100, 1),
        "meanCount": round(sum(cnts) / len(cnts), 1),
    }
    art_rows = []
    for name, pats in ARTISTS:
        pat = re.compile("|".join(re.escape(p) for p in pats), re.I)
        sns = set()
        for e in entries:
            hay = "\n".join([e.get("title") or ""] + list(e.get("performers") or [])
                            + [e.get("castField") or ""]
                            + [w.get("soloist") or "" for w in e["works"]])
            if pat.search(hay):
                sns.add(e["sn"])
        ws = [o for sn in sns for o in occ_by_sn.get(sn, [])]
        if not ws:
            art_rows.append({"artist": name, "concerts": len(sns), "works": 0})
            continue
        rk = [rarity[o["workKey"]]["rank"] for o in ws]
        cn = [rarity[o["workKey"]]["count"] for o in ws]
        art_rows.append({
            "artist": name, "concerts": len(sns), "works": len(ws),
            "uniqueWorks": len({o["workKey"] for o in ws}),
            "medianRank": sorted(rk)[len(rk) // 2],
            "meanRank": round(sum(rk) / len(rk), 1),
            "pctRare": round(sum(1 for c in cn if c <= 2) / len(cn) * 100, 1),
            "pctTop100": round(sum(1 for r in rk if r <= 100) / len(rk) * 100, 1),
            "sampleWorks": [rarity[o["workKey"]]["label"][:60] for o in ws[:6]],
        })
    art_rows.sort(key=lambda r: -(r.get("medianRank") or 0))
    stats["artists"] = art_rows

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
            if n >= 2 and (n / tot) > (overall / total) * 2.0:
                rows.append({"label": rarity[k]["label"][:60], "inMonth": n,
                             "overall": overall, "lift": round((n / tot) / (overall / total), 1)})
        rows.sort(key=lambda r: -r["lift"])
        season[m] = {"occurrences": tot, "top": rows[:6]}
    stats["seasonality"] = season

    # ---------------- 예당 비교 (이번 문서의 하이라이트)
    sac_works = collections.Counter(o["workKey"] for o in sac_occ)
    lot_works = collections.Counter(o["workKey"] for o in occ)
    both = set(sac_works) & set(lot_works)
    lot_only = set(lot_works) - set(sac_works)
    sac_only = set(sac_works) - set(lot_works)
    lot_lab = {w["workKey"]: w["label"] for w in works}
    sac_lab = {}
    for o in sac_occ:
        sac_lab.setdefault(o["workKey"], o["raw"])
    sac_total = sum(sac_works.values())

    sac_comp = collections.Counter(o["composer"] for o in sac_occ)
    sac_ctot = sum(sac_comp.values())

    def share(cnt, tot):
        return {c: round(n / tot * 100, 2) for c, n in cnt.items()}

    lc, sc = share(comp, ctot), share(sac_comp, sac_ctot)
    diff = []
    for c in set(lc) | set(sc):
        if comp.get(c, 0) + sac_comp.get(c, 0) < 15:
            continue
        diff.append({"composer": c, "lottePct": lc.get(c, 0.0), "sacPct": sc.get(c, 0.0),
                     "delta": round(lc.get(c, 0.0) - sc.get(c, 0.0), 2),
                     "lotteN": comp.get(c, 0), "sacN": sac_comp.get(c, 0)})
    diff.sort(key=lambda r: -r["delta"])

    stats["compare"] = {
        "lotteWorks": len(lot_works), "sacWorks": len(sac_works),
        "sharedWorks": len(both),
        "sharedShareOfLotteWorks": round(len(both) / len(lot_works) * 100, 1) if lot_works else 0,
        "sharedShareOfSacWorks": round(len(both) / len(sac_works) * 100, 1) if sac_works else 0,
        "lotteOnlyWorks": len(lot_only), "sacOnlyWorks": len(sac_only),
        "lottePerfInSharedPct": round(sum(lot_works[k] for k in both) / total * 100, 1),
        "sacPerfInSharedPct": round(sum(sac_works[k] for k in both) / sac_total * 100, 1),
        "jaccard": round(len(both) / len(set(sac_works) | set(lot_works)), 3),
        "lotteComposers": len(comp), "sacComposers": len(sac_comp),
        "sharedComposers": len(set(comp) & set(sac_comp)),
        "lotteOnlyComposers": sorted(set(comp) - set(sac_comp),
                                     key=lambda c: -comp[c])[:25],
        "composerDelta": diff[:20],
        "composerDeltaNeg": diff[-20:],
        "topLotteOnly": [{"label": lot_lab[k], "count": lot_works[k]}
                         for k in sorted(lot_only, key=lambda k: -lot_works[k])[:30]],
        "topSacOnly": [{"label": sac_lab[k], "count": sac_works[k]}
                       for k in sorted(sac_only, key=lambda k: -sac_works[k])[:30]],
        "sacGini": round(gini(list(sac_works.values())), 3),
        "sacComposerGini": round(gini(list(sac_comp.values())), 3),
        "sacTop10ComposerShare": round(
            sum(n for _, n in sac_comp.most_common(10)) / sac_ctot * 100, 1),
        "sacTop20ComposerShare": round(
            sum(n for _, n in sac_comp.most_common(20)) / sac_ctot * 100, 1),
        "sacTop30ComposerShare": round(
            sum(n for _, n in sac_comp.most_common(30)) / sac_ctot * 100, 1),
    }
    # 예당 코퍼스 기준 상위 100곡이 롯데 연주의 몇 %를 덮는가 (그 반대도)
    sac_rank = {k: i + 1 for i, (k, _) in enumerate(sac_works.most_common())}
    lot_rank = {k: i + 1 for i, (k, _) in enumerate(lot_works.most_common())}
    stats["compare"]["lottePerfInSacTop100Pct"] = round(
        sum(n for k, n in lot_works.items() if sac_rank.get(k, 10**9) <= 100) / total * 100, 1)
    stats["compare"]["sacPerfInLotteTop100Pct"] = round(
        sum(n for k, n in sac_works.items() if lot_rank.get(k, 10**9) <= 100) / sac_total * 100, 1)

    json.dump(stats, open(os.path.join(BASE, "stats.json"), "w"), ensure_ascii=False, indent=1)

    # ---------------- app/data/repertoire_lotte.json (repertoire.json 과 동일 스키마)
    rep = {
        "source": "롯데콘서트홀 공연 상세페이지 (www.lotteconcerthall.com)",
        "collectedAt": "2026-08-27",
        "range": {"from": min(o["date"] for o in occ), "to": max(o["date"] for o in occ)},
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
    outp = os.path.join(ROOT, "app", "data", "repertoire_lotte.json")
    json.dump(rep, open(outp, "w"), ensure_ascii=False)
    print("wrote", outp, os.path.getsize(outp), "bytes")
    print(json.dumps(stats["coverage"], ensure_ascii=False, indent=1))
    print(json.dumps(stats["compare"]["sharedWorks"], ensure_ascii=False))


if __name__ == "__main__":
    main()
