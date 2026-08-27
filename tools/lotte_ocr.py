#!/usr/bin/env python3
"""롯데 상세이미지 → macOS Vision OCR (무료·오프라인·무제한).

핵심: **세로로 긴 상세이미지는 잘라서 원본 해상도로 돌려야 한다.**
롯데 상세이미지는 700x8000 급이 흔한데, 통째로 넣으면 Vision 이 내부적으로
축소해서 한글이 뭉개진다(실측: 8211px 이미지 통짜 = 11줄, 타일 분할 = 177줄).
그래서 세로 1200px, 겹침 150px 타일로 잘라 각각 OCR 하고 겹침 중복을 제거한다.

- 결과는 work/lotte_programs/ocr/{키}.json 에 캐시. 재실행 시 재OCR 안 함
- 로컬 CPU 작업이므로 병렬로 돌린다 (서버 부하와 무관)
- 사용법: python3 tools/lotte_ocr.py [워커수]
"""
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "lotte_programs")
IMG = os.path.join(BASE, "images")
OUT = os.path.join(BASE, "ocr")

TILE_H = 1200
OVERLAP = 150
MIN_W, MIN_H = 300, 300     # 이보다 작으면 배너/아이콘 — 곡목이 있을 리 없다
MAX_PIXELS = 60_000_000     # 방어


def _dims(path):
    r = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                       capture_output=True, text=True)
    w = h = 0
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith("pixelWidth:"):
            w = int(line.split(":")[1])
        elif line.startswith("pixelHeight:"):
            h = int(line.split(":")[1])
    return w, h


def ocr_image(path):
    """한 장 → {"ok", "width", "height", "tiles", "lines":[{text,confidence}]}"""
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import vision_ocr

    w, h = _dims(path)
    if not w or not h:
        return {"ok": False, "error": "dims 실패"}
    if w < MIN_W or h < MIN_H:
        return {"ok": True, "width": w, "height": h, "tiles": 0, "skipped": "too small",
                "lines": []}
    if w * h > MAX_PIXELS:
        return {"ok": False, "error": f"too big {w}x{h}"}

    lines = []
    tiles = 0
    if h <= TILE_H:
        res = vision_ocr.ocr(path)
        tiles = 1
        if not res.get("ok"):
            return {"ok": False, "error": res.get("error"), "width": w, "height": h}
        lines = [{"text": l["text"], "confidence": l["confidence"]} for l in res["lines"]]
    else:
        with tempfile.TemporaryDirectory() as td:
            y = 0
            while y < h:
                th = min(TILE_H, h - y)
                tp = os.path.join(td, f"t{tiles:03d}.png")
                r = subprocess.run(["sips", "-c", str(th), str(w),
                                    "--cropOffset", str(y), "0", path, "--out", tp],
                                   capture_output=True)
                if r.returncode == 0 and os.path.exists(tp):
                    res = vision_ocr.ocr(tp)
                    if res.get("ok"):
                        for l in res["lines"]:
                            lines.append({"text": l["text"], "confidence": l["confidence"]})
                tiles += 1
                if y + th >= h:
                    break
                y += TILE_H - OVERLAP

    # 타일 겹침으로 생긴 중복 제거 (근처에서 같은 문장이 반복될 때만)
    dedup = []
    recent = []
    for l in lines:
        t = l["text"].strip()
        if not t:
            continue
        if t in recent:
            continue
        dedup.append(l)
        recent.append(t)
        if len(recent) > 40:
            recent.pop(0)
    return {"ok": True, "width": w, "height": h, "tiles": tiles, "lines": dedup}


def _job(args):
    key, path = args
    try:
        return key, ocr_image(path)
    except Exception as e:
        return key, {"ok": False, "error": f"{type(e).__name__}: {e}"}


def main():
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else max(2, (os.cpu_count() or 4) - 2)
    os.makedirs(OUT, exist_ok=True)
    todo = []
    for fn in sorted(os.listdir(IMG)):
        if fn == "index.json":
            continue
        key = os.path.splitext(fn)[0]
        outp = os.path.join(OUT, key + ".json")
        if os.path.exists(outp) and os.path.getsize(outp) > 2:
            continue
        todo.append((key, os.path.join(IMG, fn)))
    print(f"to OCR: {len(todo)} images, workers={workers}", flush=True)
    done = 0
    with ProcessPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_job, t) for t in todo]
        for f in as_completed(futs):
            key, res = f.result()
            json.dump(res, open(os.path.join(OUT, key + ".json"), "w"), ensure_ascii=False)
            done += 1
            if done % 25 == 0:
                print(f"... {done}/{len(todo)}", flush=True)
    print("done", done, flush=True)


if __name__ == "__main__":
    main()
