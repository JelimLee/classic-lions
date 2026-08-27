#!/usr/bin/env python3
"""stats.json → 문서에 넣을 마크다운 표/차트 조각 출력."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(ROOT, "work", "lotte_programs", "stats.json")))
p = print

p("### 수집");  p(json.dumps(S["collection"], ensure_ascii=False, indent=1))
p("fetchedPages:", S.get("fetchedPages"), "httpErrors:", S.get("httpErrorCount"))
p("dropped:", json.dumps(S.get("droppedPages", {}), ensure_ascii=False)); p()
p("### 연도별 [대상, 본문있음, 곡추출성공]")
for y, v in S["byYearParse"].items():
    p(f"| {y} | {v[0]} | {v[1]} | {v[2]} | {round(v[2]/v[0]*100,1)}% |")
p()
p("### 장르 분포"); p(json.dumps(S["genreMix"], ensure_ascii=False, indent=1)); p()
p("### 기획/대관"); p(json.dumps(S["productionType"], ensure_ascii=False))
p(json.dumps(S["programByProductionType"], ensure_ascii=False)); p()
cv = S["coverage"]
p("### 커버리지"); p(json.dumps(cv, ensure_ascii=False, indent=1)); p()
p("### 누적 커버리지 ASCII")
for n, pct in cv["topN"].items():
    p(f"상위 {int(n):>5}곡 | {'█'*int(float(pct)/2):<50} {pct:>5}%")
p()
p("### 상위 40곡")
for r in S["topWorks"][:40]:
    p(f"| {r['rank']} | {r['count']} | {r['composer']} | {r['label'][:60]} |")
p()
p("### 작곡가 상위 30")
for i, r in enumerate(S["topComposers"], 1):
    p(f"| {i} | {r['composer']} | {r['count']} | {r['share']}% | {r['uniqueWorks']} |")
p(json.dumps(S["composerStats"], ensure_ascii=False)); p()
p("### 신규 작품"); p(json.dumps(S["novelty"], ensure_ascii=False)); p()
p("### 코퍼스 기준선"); p(json.dumps(S["corpusBaseline"], ensure_ascii=False)); p()
p("### 연주자")
for r in S["artists"]:
    p(json.dumps(r, ensure_ascii=False))
p()
p("### 계절성 (월별 lift>=2, 2회 이상)")
for m, v in S["seasonality"].items():
    p(f"-- {m}월 (연주 {v['occurrences']})")
    for r in v["top"]:
        p(f"   x{r['lift']:<5} {r['inMonth']}/{r['overall']}  {r['label'][:55]}")
p()
p("### 예당 비교")
C = S["compare"]
p(json.dumps({k: v for k, v in C.items()
              if k not in ("composerDelta", "composerDeltaNeg", "topLotteOnly",
                           "topSacOnly", "lotteOnlyComposers")},
             ensure_ascii=False, indent=1))
p("-- 롯데에서 비중이 높은 작곡가 (delta = 롯데% - 예당%)")
for r in C["composerDelta"]:
    p(f"| {r['composer']} | {r['lottePct']}% ({r['lotteN']}) | {r['sacPct']}% ({r['sacN']}) | {r['delta']:+} |")
p("-- 예당에서 비중이 높은 작곡가")
for r in reversed(C["composerDeltaNeg"]):
    p(f"| {r['composer']} | {r['lottePct']}% ({r['lotteN']}) | {r['sacPct']}% ({r['sacN']}) | {r['delta']:+} |")
p("-- 롯데에만 있는 작곡가"); p(", ".join(C["lotteOnlyComposers"]))
p("-- 롯데에만 있는 곡 상위")
for r in C["topLotteOnly"]:
    p(f"| {r['count']} | {r['label'][:70]} |")
p("-- 예당에만 있는 곡 상위")
for r in C["topSacOnly"]:
    p(f"| {r['count']} | {r['label'][:70]} |")
