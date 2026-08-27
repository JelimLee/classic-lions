#!/usr/bin/env python3
"""롯데콘서트홀 월간 일정 수집.

사이트가 실제로 쓰는 2단계 경로를 그대로 따른다:
  1) POST /api/historyBack/create  {value: JSON.stringify(Filter)}  -> 불투명 키
  2) GET  /product/performance/month/calendar?q=<키>                -> 월간 JSON

- 요청 간 1.2초 지연, 순차 실행, 병렬 없음
- work/lotte_programs/cal/{YYYY-MM}.json 캐시. 이미 있으면 재요청 안 함 (재개 가능)
- robots.txt: www.lotteconcerthall.com / lotteconcerthall.com 모두 404 (금지 규칙 자체가 없음, 2026-08-27 확인)
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAL_DIR = os.path.join(ROOT, "work", "lotte_programs", "cal")
HOST = "https://www.lotteconcerthall.com"
UA = "ClassicLionsResearch/1.0 (personal, non-commercial repertoire study)"
DELAY = 1.2


def _req(url, data=None):
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
    })  # 응답에 BOM 이 붙어 오는 달이 있어 utf-8-sig 로 읽는다
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8-sig", "replace")


def fetch_month(year, month):
    flt = {"Year": year, "Month": month, "SelectDay": None, "Today": 1, "VenueID": 0}
    key = json.loads(_req(HOST + "/api/historyBack/create",
                          {"value": json.dumps(flt, ensure_ascii=False)}))["Tag"]
    time.sleep(DELAY)
    txt = _req(HOST + "/product/performance/month/calendar?q=" + key)
    d = json.loads(txt)
    got = d["Tag"]["Filter"]
    if got["Year"] != year or got["Month"] != month:
        raise RuntimeError(f"filter mismatch: asked {year}-{month}, got {got}")
    return txt


def main():
    y0, m0 = (int(x) for x in sys.argv[1].split("-"))
    y1, m1 = (int(x) for x in sys.argv[2].split("-"))
    os.makedirs(CAL_DIR, exist_ok=True)
    todo = [(y, m) for y in range(y0, y1 + 1) for m in range(1, 13)
            if (y, m) >= (y0, m0) and (y, m) <= (y1, m1)]
    for y, m in todo:
        path = os.path.join(CAL_DIR, f"{y}-{m:02d}.json")
        if os.path.exists(path) and os.path.getsize(path) > 100:
            continue
        for attempt in range(3):
            try:
                txt = fetch_month(y, m)
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
