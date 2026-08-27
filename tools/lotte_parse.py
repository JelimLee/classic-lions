#!/usr/bin/env python3
"""롯데콘서트홀 상세페이지 → ProgramEntry JSONL.

예당(sac_parse.py)의 곡목 판별 로직을 그대로 **재사용**한다 (import, 수정 없음).
다른 것은 두 가지뿐:
  1) 본문 추출 경로 — 롯데는 서버렌더된 Vue data 안의 Details[] (lotte_region.py)
  2) 장르/공연장 메타 — 롯데는 상세페이지의 GenreName/Place 에서 온다

원칙은 동일하다: rawText 보존, 못 읽으면 null, 약력 산문의 곡 언급은 세지 않는다.
곡목이 이미지 안에만 있는 경우 이미지 URL 을 남긴다(OCR 은 여기서 하지 않는다).
"""
import gzip
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lotte_region import vue_data, intro_region, body_images
from sac_parse import find_block, parse_block, PERFORMER, FORM_RE, OPUS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "lotte_programs")
IMG_INDEX = os.path.join(BASE, "images", "index.json")
OCR_DIR = os.path.join(BASE, "ocr")

# url -> 캐시 파일명 (lotte_fetch_images.py 가 만든다)
_IMG_INDEX = json.load(open(IMG_INDEX)) if os.path.exists(IMG_INDEX) else {}

# OCR 은 세로줄 구분자 '|' 를 I / l / ǀ 로 자주 오독한다. 곡 줄 분리에 치명적이라 되돌린다.
_SEP = re.compile(r"(?<=\S)\s+[Il|｜ǀ丨ㅣ]\s+(?=\S)")
_OCR_NOISE = re.compile(r"^[\s\W_]{0,3}$")


def ocr_lines(images, min_conf=0.3):
    """이 공연의 상세이미지 OCR 결과를 읽는 순서대로 이어 붙인다.

    OCR 을 새로 돌리지 않는다 — tools/lotte_ocr.py 가 만들어 둔 캐시만 읽는다.
    """
    out = []
    for u in images:
        fn = _IMG_INDEX.get(u)
        if not fn:
            continue
        p = os.path.join(OCR_DIR, os.path.splitext(fn)[0] + ".json")
        if not os.path.exists(p):
            continue
        try:
            d = json.load(open(p))
        except Exception:
            continue
        if not d.get("ok"):
            continue
        for l in d.get("lines") or []:
            if l.get("confidence", 0) < min_conf:
                continue
            t = (l.get("text") or "").strip()
            if not t or _OCR_NOISE.match(t):
                continue
            out.append(_SEP.sub(" | ", t))
    return out

# GenreName → (장르명, genreConfidence). 롯데는 상세페이지에 장르가 문자열로 있다.
# confidence 는 "이 장르가 서양 클래식 레퍼토리인가"에 대한 신뢰도다.
GENRE_CONF = [
    (r"오케스트라|교향|관현악|심포니", ("오케스트라", 1.0)),
    (r"실내악|앙상블", ("실내악", 1.0)),
    (r"독주|리사이틀|기악", ("독주", 1.0)),
    (r"오라토리오|합창|성악|오페라|가곡", ("성악·합창", 1.0)),
    (r"고음악|바로크", ("고음악", 1.0)),
    (r"오르간", ("오르간", 1.0)),
    (r"협주", ("협주", 1.0)),
    (r"갈라", ("갈라", 0.9)),
    (r"어린이|청소년|교육", ("교육·어린이", 0.7)),
    (r"영상", ("영상+음악", 0.5)),
    (r"복합", ("복합장르", 0.4)),
    (r"크로스오버", ("크로스오버", 0.3)),
    (r"국악", ("국악", 0.2)),
    (r"재즈", ("재즈", 0.1)),
    (r"대중음악|콘서트\b", ("대중음악", 0.05)),
    (r"토크|마스터클래스|강연|투어", ("비연주", 0.05)),
]


def classify(genre_name):
    g = (genre_name or "").strip()
    for pat, val in GENRE_CONF:
        if re.search(pat, g):
            return val
    return (g or "미분류", 0.5)


def parse_one(pid, html, meta):
    data = vue_data(html)
    entry = {
        "sn": pid,
        "date": meta.get("date") or "",
        "endDate": meta.get("endDate") or "",
        "title": meta.get("title"),
        "venue": None,
        "genre": None,
        "genreConfidence": 0.0,
        "productionType": meta.get("productionType"),
        "introLines": 0,
        "works": [],
        "performers": [],
        "images": [],
        "parseConfidence": 0.0,
        "blockMethod": "none",
        "pageOk": data is not None,
    }
    if data is None:
        # 존재하지 않는 PerformanceID 는 404 가 아니라 메인페이지로 조용히 리다이렉트된다.
        # (#body Vue 블록이 없다) — ID 갭 스캔의 '없는 번호' 가 여기로 온다.
        entry["blockMethod"] = "no-page"
        return entry
    entry["title"] = data.get("PerformanceName") or entry["title"]
    entry["titleEng"] = data.get("EnglishPerformanceName") or None
    entry["venue"] = data.get("Place") or entry["venue"]
    entry["productionType"] = data.get("ProductionTypeName") or entry["productionType"]
    entry["genreRaw"] = data.get("GenreName")
    entry["genre"], entry["genreConfidence"] = classify(data.get("GenreName"))
    pd = (data.get("PlayDate") or "").strip()
    m = re.match(r"(\d{4})\.(\d{2})\.(\d{2})", pd)
    if m:
        entry["date"] = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m2 = re.search(r"~\s*(\d{4})\.(\d{2})\.(\d{2})", pd)
    if m2:
        entry["endDate"] = f"{m2.group(1)}-{m2.group(2)}-{m2.group(3)}"
    for d in data.get("Descriptions") or []:
        if d.get("Name") == "출연" and d.get("Value"):
            entry.setdefault("castField", d["Value"])

    entry["images"] = body_images(data)
    lines = intro_region(data)
    entry["introLines"] = len(lines)

    block, method = ([], "none")
    if lines:
        block, method = find_block(lines)

    # 텍스트로 곡목을 못 얻었으면 상세이미지 OCR 결과로 한 번 더 시도한다.
    # (롯데는 곡목을 이미지로 싣는 게 기본이다 — 예당과 가장 다른 지점)
    if not block:
        olines = ocr_lines(entry["images"])
        entry["ocrLines"] = len(olines)
        if olines:
            oblock, omethod = find_block(olines)
            if oblock:
                block, method = oblock, "ocr-" + omethod
                lines = olines

    entry["blockMethod"] = method
    if method == "none":
        if not lines and not entry["images"]:
            entry["blockMethod"] = "empty"
        elif entry["images"]:
            entry["blockMethod"] = "image-only"
    if not block:
        return entry
    entry["fromOCR"] = method.startswith("ocr-")
    entry["programRaw"] = "\n".join(block)[:6000]
    works = parse_block(block)
    entry["works"] = works
    perf = []
    for ln in lines[:120]:
        if len(ln) < 60 and PERFORMER.search(ln) and not FORM_RE.search(ln) and not OPUS.search(ln):
            perf.append(ln)
    entry["performers"] = perf[:20]
    entry["perfText"] = "\n".join(lines[:150])[:5000]
    if works:
        n_op = sum(1 for w in works if w["opus"])
        n_c = sum(1 for w in works if w["composer"])
        base = 0.35 if method.endswith("cluster") else 0.45
        if method.startswith("ocr-"):
            base -= 0.10          # OCR 오독 여지를 신뢰도에 반영한다
        entry["parseConfidence"] = round(
            base + 0.3 * (n_c / len(works)) + 0.25 * (n_op / len(works)), 2)
    return entry


def main():
    targets = {t["id"]: t for t in json.load(open(os.path.join(BASE, "targets.json")))}
    out_path = os.path.join(BASE, "parsed.jsonl")
    n = 0
    with open(out_path, "w") as out:
        for path in sorted(glob.glob(os.path.join(BASE, "raw", "*.html.gz"))):
            pid = os.path.basename(path).split(".")[0]
            try:
                with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
                    html = f.read()
            except Exception as e:
                print("READFAIL", pid, e)
                continue
            out.write(json.dumps(parse_one(pid, html, targets.get(pid, {})),
                                 ensure_ascii=False) + "\n")
            n += 1
    print("parsed", n, "->", out_path)


if __name__ == "__main__":
    main()
