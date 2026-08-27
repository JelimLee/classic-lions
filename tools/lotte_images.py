#!/usr/bin/env python3
"""곡목이 이미지 안에만 있는 공연의 이미지 URL 목록을 만든다.

**OCR 은 하지 않는다.** 비용/쿼터 때문에 목록만 남기고, 나중에 macOS Vision
(tools/vision_ocr.py, 무료·무제한)으로 돌린다.

산출: work/lotte_programs/ocr_targets.json
"""
import json
import os
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "lotte_programs")


def main():
    entries = [json.loads(l) for l in open(os.path.join(BASE, "parsed.jsonl"))]
    rows = []
    for e in entries:
        if e["works"]:
            continue                       # 텍스트로 이미 곡목을 얻었다
        if e["genreConfidence"] < 0.7:
            continue                       # 클래식이 아닌 공연은 제외
        imgs = e.get("images") or []
        if not imgs:
            continue
        rows.append({
            "sn": e["sn"], "date": e["date"], "title": e["title"],
            "genre": e.get("genreRaw"), "productionType": e.get("productionType"),
            "images": imgs,
            "detailUrl": f"https://www.lotteconcerthall.com/product/ko/performance/{e['sn']}",
        })
    rows.sort(key=lambda r: r["date"], reverse=True)
    out = os.path.join(BASE, "ocr_targets.json")
    json.dump(rows, open(out, "w"), ensure_ascii=False, indent=1)
    print("concerts needing OCR:", len(rows),
          "| images:", sum(len(r["images"]) for r in rows))
    print("by year:", dict(sorted(collections.Counter(r["date"][:4] for r in rows).items())))
    print("->", out)


if __name__ == "__main__":
    main()
