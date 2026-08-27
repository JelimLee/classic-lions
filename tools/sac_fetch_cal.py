#!/usr/bin/env python3
"""예술의전당 월간 일정(getProgramCalList) 수집.

- 요청 간 1.2초 지연, 순차 실행
- work/sac_programs/cal/{YYYY-MM}.json 캐시. 이미 있으면 재요청 안 함 (재개 가능)
- robots.txt 확인: /site/main/program/ 은 Disallow 대상 아님 (2026-08-27 확인)
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import calendar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAL_DIR = os.path.join(ROOT, "work", "sac_programs", "cal")
URL = "https://www.sac.or.kr/site/main/program/getProgramCalList"
UA = "ClassicLionsResearch/1.0 (personal, non-commercial repertoire study)"
DELAY = 1.2


def fetch_month(year, month):
    last = calendar.monthrange(year, month)[1]
    data = urllib.parse.urlencode({
        "searchYear": year,
        "searchMonth": month,
        "searchFirstDay": 1,
        "searchLastDay": last,
        "CATEGORY_PRIMARY": "",
    }).encode()
    req = urllib.request.Request(URL, data=data, headers={
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8")


def main():
    y0, y1 = int(sys.argv[1]), int(sys.argv[2])
    os.makedirs(CAL_DIR, exist_ok=True)
    todo = [(y, m) for y in range(y0, y1 + 1) for m in range(1, 13)]
    for y, m in todo:
        path = os.path.join(CAL_DIR, f"{y}-{m:02d}.json")
        if os.path.exists(path) and os.path.getsize(path) > 100:
            continue
        for attempt in range(3):
            try:
                txt = fetch_month(y, m)
                json.loads(txt)  # 검증
                with open(path, "w") as f:
                    f.write(txt)
                print(f"{y}-{m:02d} ok {len(txt)}b", flush=True)
                break
            except Exception as e:
                print(f"{y}-{m:02d} FAIL({attempt}) {e}", flush=True)
                time.sleep(5 * (attempt + 1))
        time.sleep(DELAY)


if __name__ == "__main__":
    main()
