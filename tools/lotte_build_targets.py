#!/usr/bin/env python3
"""월간 일정 캐시에서 상세 수집 대상(롯데콘서트홀 전 공연)을 뽑는다.

롯데콘서트홀 사이트의 월간 캘린더는 이 홀 하나(TheaterID 1088)만 담고 있어서
예당처럼 공연장 필터를 걸 필요가 없다. 장르 필터는 상세페이지의 GenreName 으로
수집 *이후* 에 건다 (캘린더에는 장르 정보가 없다).
"""
import json
import os
import sys
import glob
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "lotte_programs")


def iter_slots():
    for path in sorted(glob.glob(os.path.join(BASE, "cal", "*.json"))):
        d = json.load(open(path))
        tag = d.get("Tag") or {}
        for week in tag.get("Weeks") or []:
            for day in week or []:
                if not day:
                    continue
                for t in day.get("Times") or []:
                    yield path, t


def main():
    by_id = {}
    places = collections.Counter()
    for _, t in iter_slots():
        pid = str(t["PerformanceID"])
        places[t.get("Place")] += 1
        cur = by_id.get(pid)
        beg = t.get("PlayBeginDate") or ""
        end = t.get("PlayEndDate") or ""
        rec = {
            "id": pid,
            "title": t.get("Title"),
            "venue": t.get("Place"),
            "placeId": t.get("PlaceID"),
            "category": t.get("CategoryName"),
            "categoryId": t.get("CategoryID"),
            "productionType": t.get("ProductionTypeName"),  # 기획 / 대관
            "date": f"{beg[:4]}-{beg[4:6]}-{beg[6:8]}" if len(beg) == 8 else "",
            "endDate": f"{end[:4]}-{end[4:6]}-{end[6:8]}" if len(end) == 8 else "",
            "imageUrl": t.get("ImageUrl"),
            "detailsUrl": t.get("DetailsUrl"),
        }
        if cur is None or rec["date"] < cur["date"]:
            by_id[pid] = rec

    targets = sorted(by_id.values(), key=lambda t: (t["date"], t["id"]))

    # --with-gaps: 캘린더가 서버 500 을 뱉는 달(2016-11, 2024-07, 2025-11)을 메우기 위해
    # 관측된 PerformanceID 연속 구간에서 빠진 번호를 전부 대상에 넣는다.
    # 공연장/날짜 필터는 상세페이지를 받은 뒤에 건다 (여기서는 알 수 없다).
    if "--with-gaps" in sys.argv:
        nums = sorted(int(t["id"]) for t in targets)
        known = set(nums)
        gaps = [n for n in range(nums[0], nums[-1] + 1) if n not in known]
        for n in gaps:
            targets.append({"id": str(n), "title": None, "venue": None, "placeId": None,
                            "category": None, "categoryId": None, "productionType": None,
                            "date": "", "endDate": "", "imageUrl": None,
                            "detailsUrl": f"https://www.lotteconcerthall.com/product/ko/performance/{n}",
                            "fromGapScan": True})
        print("gap ids added:", len(gaps))
    with open(os.path.join(BASE, "targets.json"), "w") as f:
        json.dump(targets, f, ensure_ascii=False, indent=1)
    print("targets:", len(targets))
    yr = collections.Counter(t["date"][:4] for t in targets)
    for y in sorted(yr):
        print(" ", y, yr[y])
    print("place:", dict(places))
    print("productionType:", collections.Counter(t["productionType"] for t in targets))
    print("category:", collections.Counter(t["category"] for t in targets))


if __name__ == "__main__":
    main()
