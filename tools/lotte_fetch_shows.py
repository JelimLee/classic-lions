#!/usr/bin/env python3
"""롯데콘서트홀 공연 상세페이지(/product/ko/performance/{id}) 수집.

- 요청 간 1.2초 지연, 순차 실행, 재개 가능
- work/lotte_programs/raw/{ID}.html.gz 캐시. 이미 있으면 재요청 안 함
- 대상: work/lotte_programs/targets.json (lotte_build_targets.py 가 생성)
- 최신 -> 과거 순 (중간에 끊겨도 최근 연도는 완결되도록)
- HTTP 실패는 work/lotte_programs/fetch_errors.json 에 기록 (페이지 소멸 판정용)
"""
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "lotte_programs")
RAW = os.path.join(BASE, "raw")
ERRS = os.path.join(BASE, "fetch_errors.json")
UA = "ClassicLionsResearch/1.0 (personal, non-commercial repertoire study)"
DELAY = 1.2


def fetch(pid):
    url = f"https://www.lotteconcerthall.com/product/ko/performance/{pid}"
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
    targets.sort(key=lambda t: t["date"], reverse=True)
    errs = json.load(open(ERRS)) if os.path.exists(ERRS) else {}
    n = 0
    for t in targets:
        pid = t["id"]
        path = os.path.join(RAW, f"{pid}.html.gz")
        if os.path.exists(path) and os.path.getsize(path) > 200:
            continue
        if pid in errs and errs[pid].get("final"):
            continue
        if n >= limit:
            break
        last = None
        for attempt in range(3):
            try:
                html = fetch(pid)
                with gzip.open(path, "wt", encoding="utf-8") as f:
                    f.write(html)
                last = None
                break
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code}"
                if e.code in (404, 410):
                    break          # 페이지 소멸 -> 재시도 무의미
                time.sleep(5 * (attempt + 1))
            except Exception as e:
                last = str(e)
                time.sleep(5 * (attempt + 1))
        if last:
            errs[pid] = {"error": last, "date": t["date"], "title": t["title"], "final": True}
            print(f"{pid} {t['date']} FAIL {last}", flush=True)
            with open(ERRS, "w") as f:
                json.dump(errs, f, ensure_ascii=False, indent=1)
        n += 1
        if n % 50 == 0:
            print(f"... {n} fetched (last {pid} {t['date']})", flush=True)
        time.sleep(DELAY)
    with open(ERRS, "w") as f:
        json.dump(errs, f, ensure_ascii=False, indent=1)
    print(f"done, fetched {n}, errors {len(errs)}", flush=True)


if __name__ == "__main__":
    main()
