#!/usr/bin/env python3
"""stats.json → 문서에 넣을 마크다운 표/차트 조각 출력."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(ROOT, "work", "sac_programs", "stats.json")))


def p(*a):
    print(*a)


c = S["collection"]
p("### 수집")
p(json.dumps(c, ensure_ascii=False, indent=1))
p()
p("### 연도별 [대상, 본문있음, 곡추출성공]")
for y, v in S["byYearParse"].items():
    p(f"| {y} | {v[0]} | {v[1]} | {v[2]} | {round(v[2]/v[0]*100,1)}% |")
p()
cv = S["coverage"]
p("### 커버리지")
p(json.dumps(cv, ensure_ascii=False, indent=1))
p()
p("### 누적 커버리지 ASCII")
for n, pct in cv["topN"].items():
    bar = "█" * int(float(pct) / 2)
    p(f"상위 {int(n):>5}곡 | {bar:<50} {pct:>5}%")
p()
p("### 상위 40곡")
for r in S["topWorks"][:40]:
    p(f"| {r['rank']} | {r['count']} | {r['composer']} | {r['label'][:60]} |")
p()
p("### 작곡가 상위 30")
for i, r in enumerate(S["topComposers"], 1):
    p(f"| {i} | {r['composer']} | {r['count']} | {r['share']}% | {r['uniqueWorks']} |")
p(json.dumps(S["composerStats"], ensure_ascii=False))
p()
p("### 코퍼스 기준선")
p(json.dumps(S["corpusBaseline"], ensure_ascii=False))
p()
p("### 연주자")
for r in S["artists"]:
    p(json.dumps(r, ensure_ascii=False))
p()
p("### 공동출현 상위")
for r in S["topPairs"][:20]:
    p(f"| {r['count']} | {r['a'][:50]} | {r['b'][:50]} |")
p()
p("### 프로그램 구성")
p(json.dumps({k: v for k, v in S["programShape"].items() if k != "topShapes"}, ensure_ascii=False))
for r in S["programShape"]["topShapes"]:
    p(f"| {r['count']} | {r['shape']} |")
p()
p("### 계절성 (월별 lift>=2, 3회 이상)")
for m, v in S["seasonality"].items():
    p(f"-- {m}월 (연주 {v['occurrences']})")
    for r in v["top"]:
        p(f"   x{r['lift']:<5} {r['inMonth']}/{r['overall']}  {r['label'][:55]}")
