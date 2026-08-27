#!/usr/bin/env python3
"""macOS Vision OCR — 무료·무제한·오프라인. 한국어+영어 텍스트 추출.

Gemini vision 을 쓰지 않고 티켓 이미지에서 raw 텍스트를 뽑는 1단계.
줄마다 text / confidence / 바운딩박스를 낸다. 바운딩박스가 있어야
"상단의 큰 글씨 = 공연명" 같은 판단을 2단계 LLM 이 할 수 있다.

사용법:
    python3 tools/vision_ocr.py <이미지...> [--out <파일>] [--langs ko-KR,en-US]
                                [--min-conf 0.0] [--no-sort] [--pretty]

출력(JSON):
{
  "<path>": {
    "ok": true,
    "width": 1200, "height": 800,
    "lines": [
      {"i": 0, "text": "객석 1층 B구역 15열 01번", "confidence": 1.0,
       "box": [x, y, w, h],        # 좌상단 원점, 0~1 정규화, 소수 4자리
       "h": 0.031}                 # 글자 높이(=상대 폰트 크기 근사)
    ]
  }
}
좌표계: Vision 은 좌하단 원점이라 y 를 뒤집어 **좌상단 원점**으로 바꿔서 낸다
(이미지를 보는 사람/모델의 직관과 같아진다).
"""
import sys, json, argparse

import Vision, Quartz
from Foundation import NSURL


def _box(obs):
    """VNRecognizedTextObservation → [x, y, w, h] (좌상단 원점, 0~1)."""
    try:
        bb = obs.boundingBox()
        x = float(bb.origin.x)
        y = float(bb.origin.y)
        w = float(bb.size.width)
        h = float(bb.size.height)
    except Exception:
        return None
    # Vision: 좌하단 원점 → 좌상단 원점으로 뒤집는다.
    top = 1.0 - (y + h)
    return [round(x, 4), round(top, 4), round(w, 4), round(h, 4)]


def ocr(path, langs=("ko-KR", "en-US"), min_conf=0.0, sort_lines=True):
    url = NSURL.fileURLWithPath_(path)
    src = Quartz.CGImageSourceCreateWithURL(url, None)
    if src is None:
        return {"ok": False, "error": "이미지를 열 수 없습니다"}
    img = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
    if img is None:
        return {"ok": False, "error": "이미지를 디코딩할 수 없습니다"}

    width = int(Quartz.CGImageGetWidth(img))
    height = int(Quartz.CGImageGetHeight(img))

    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setRecognitionLanguages_(list(langs))
    req.setUsesLanguageCorrection_(True)

    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(img, None)
    ok, err = handler.performRequests_error_([req], None)
    if not ok:
        return {"ok": False, "error": f"Vision 요청 실패: {err}"}

    lines = []
    for obs in (req.results() or []):
        cands = obs.topCandidates_(1)
        if not cands or not len(cands):
            continue
        c = cands[0]
        conf = float(c.confidence())
        if conf < min_conf:
            continue
        text = c.string()
        if not text or not text.strip():
            continue
        box = _box(obs)
        lines.append({
            "text": text,
            "confidence": round(conf, 4),
            "box": box,
            "h": box[3] if box else None,
        })

    if sort_lines:
        # 읽는 순서(위→아래, 같은 줄이면 왼→오른쪽).
        # 밴드 폭은 이미지 높이의 2% 고정 — 글자 높이로 나누면 폰트가 섞인
        # 티켓에서 같은 줄이 서로 다른 밴드로 갈라진다.
        BAND = 0.02
        def key(ln):
            b = ln["box"] or [0.0, 0.0, 0.0, 0.0]
            ycenter = b[1] + b[3] / 2.0
            return (int(ycenter / BAND), b[0])
        lines.sort(key=key)

    for i, ln in enumerate(lines):
        ln["i"] = i

    return {"ok": True, "width": width, "height": height, "lines": lines}


def main():
    ap = argparse.ArgumentParser(description="macOS Vision OCR (무료·오프라인)")
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", default=None, help="결과 JSON 파일 경로 (기본: stdout)")
    ap.add_argument("--langs", default="ko-KR,en-US")
    ap.add_argument("--min-conf", type=float, default=0.0)
    ap.add_argument("--no-sort", action="store_true", help="Vision 원래 순서 유지")
    ap.add_argument("--pretty", action="store_true")
    a = ap.parse_args()

    langs = tuple(s.strip() for s in a.langs.split(",") if s.strip())
    res = {}
    for p in a.images:
        try:
            res[p] = ocr(p, langs=langs, min_conf=a.min_conf, sort_lines=not a.no_sort)
        except Exception as e:  # 한 장이 실패해도 나머지는 낸다
            res[p] = {"ok": False, "error": f"{type(e).__name__}: {e}"}

    text = json.dumps(res, ensure_ascii=False, indent=1 if a.pretty else None)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"{len(res)}건 → {a.out}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
