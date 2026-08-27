#!/usr/bin/env python3
"""예술의전당 공연 상세페이지(show_view?SN=) 수집.

- 요청 간 1.2초 지연, 순차 실행, 재개 가능
- work/sac_programs/raw/{SN}.html.gz 캐시. 이미 있으면 재요청 안 함
- 대상: work/sac_programs/targets.json (sac_build_targets.py 가 생성)
- 최신 → 과거 순으로 훑는다 (중간에 끊겨도 최근 연도는 완결되도록)
"""
import gzip
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "sac_programs")
RAW = os.path.join(BASE, "raw")
UA = "ClassicLionsResearch/1.0 (personal, non-commercial repertoire study)"
DELAY = 1.2


def fetch(sn):
    url = f"https://www.sac.or.kr/site/main/show/show_view?SN={sn}"
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    os.makedirs(RAW, exist_ok=True)
    targets = json.load(open(os.path.join(BASE, "targets.json")))
    # 최신 공연부터
    targets.sort(key=lambda t: t["date"], reverse=True)
    n = 0
    for t in targets:
        sn = t["sn"]
        path = os.path.join(RAW, f"{sn}.html.gz")
        if os.path.exists(path) and os.path.getsize(path) > 200:
            continue
        if n >= limit:
            break
        ok = False
        for attempt in range(3):
            try:
                html = fetch(sn)
                with gzip.open(path, "wt", encoding="utf-8") as f:
                    f.write(html)
                ok = True
                break
            except Exception as e:
                print(f"{sn} FAIL({attempt}) {e}", flush=True)
                time.sleep(5 * (attempt + 1))
        n += 1
        if n % 50 == 0:
            print(f"... {n} fetched (last {sn} {t['date']} ok={ok})", flush=True)
        time.sleep(DELAY)
    print(f"done, fetched {n}", flush=True)


if __name__ == "__main__":
    main()
