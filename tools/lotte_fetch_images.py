#!/usr/bin/env python3
"""곡목이 이미지 안에만 있는 공연의 상세이미지를 내려받는다.

- 요청 간 1.2초, 순차, 재개 가능. 이미 받은 파일은 재요청 안 함
- work/lotte_programs/images/{sha1(url)[:16]}.{ext} 로 캐시 (URL 단위 dedupe —
  같은 배너가 여러 공연에 재사용되므로 한 번만 받는다)
- work/lotte_programs/images/index.json 에 url -> 파일 매핑
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "lotte_programs")
IMG = os.path.join(BASE, "images")
INDEX = os.path.join(IMG, "index.json")
UA = "ClassicLionsResearch/1.0 (personal, non-commercial repertoire study)"
DELAY = 1.2

# 곡목이 있을 리 없는 공용 배너/안내 이미지. 파일명으로 거른다.
SKIP = ("noimage", "코로나", "corona", "엔제리너스", "angelinus", "로고", "logo",
        "배너_공통", "공통배너", "kakao", "instagram")


def key_for(url):
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def ext_for(url):
    path = urllib.parse.urlparse(url).path
    e = os.path.splitext(path)[1].lower()
    return e if e in (".jpg", ".jpeg", ".png", ".gif", ".webp") else ".jpg"


def encode_url(url):
    """경로에 한글이 든 URL 은 퍼센트 인코딩해야 urllib 이 보낼 수 있다.
    (롯데 이미지 파일명은 '상세_롯데_700x.jpg' 처럼 한글이 흔하다)"""
    p = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((
        p.scheme, p.netloc,
        urllib.parse.quote(p.path, safe="/%"),
        urllib.parse.quote(p.query, safe="=&%"),
        p.fragment))


def wanted(url):
    low = urllib.parse.unquote(url).lower()
    return not any(s in low for s in SKIP)


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    os.makedirs(IMG, exist_ok=True)
    targets = json.load(open(os.path.join(BASE, "ocr_targets.json")))
    index = json.load(open(INDEX)) if os.path.exists(INDEX) else {}

    urls = []
    seen = set()
    for t in targets:                      # 최신 공연부터 (ocr_targets 가 이미 내림차순)
        for u in t["images"]:
            if u in seen or not wanted(u):
                continue
            seen.add(u)
            urls.append(u)
    print("unique image urls:", len(urls), flush=True)

    n = ok = 0
    for u in urls:
        k = key_for(u)
        path = os.path.join(IMG, k + ext_for(u))
        if os.path.exists(path) and os.path.getsize(path) > 1000:
            index[u] = os.path.basename(path)
            continue
        if u in index and index[u] is None:
            continue                       # 이전에 확정 실패
        if n >= limit:
            break
        try:
            req = urllib.request.Request(encode_url(u), headers={"User-Agent": UA,
                                                                 "Accept": "image/*"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if len(data) < 1000:
                raise ValueError(f"too small ({len(data)}b)")
            with open(path, "wb") as f:
                f.write(data)
            index[u] = os.path.basename(path)
            ok += 1
        except Exception as e:
            index[u] = None
            print(f"FAIL {e} {u[:110]}", flush=True)
        n += 1
        if n % 50 == 0:
            json.dump(index, open(INDEX, "w"), ensure_ascii=False, indent=1)
            print(f"... {n}/{len(urls)} (ok {ok})", flush=True)
        time.sleep(DELAY)
    json.dump(index, open(INDEX, "w"), ensure_ascii=False, indent=1)
    print(f"done. downloaded {ok}, failed {sum(1 for v in index.values() if v is None)}",
          flush=True)


if __name__ == "__main__":
    main()
