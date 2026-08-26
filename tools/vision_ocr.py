#!/usr/bin/env python3
"""macOS Vision OCR — 무료·무제한·오프라인. 한국어+영어 텍스트 추출."""
import sys, json
import Vision, Quartz
from Foundation import NSURL

def ocr(path, langs=("ko-KR","en-US")):
    url = NSURL.fileURLWithPath_(path)
    src = Quartz.CGImageSourceCreateWithURL(url, None)
    if src is None: return None
    img = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
    if img is None: return None
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setRecognitionLanguages_(list(langs))
    req.setUsesLanguageCorrection_(True)
    handler = Vision.VNImageRequestHandlerCliangeCGImage_options_(img, None) \
        if hasattr(Vision, 'VNImageRequestHandlerCliangeCGImage_options_') \
        else Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(img, None)
    ok, err = handler.performRequests_error_([req], None)
    if not ok: return None
    out=[]
    for obs in (req.results() or []):
        c = obs.topCandidates_(1)
        if c and len(c):
            out.append({"text": c[0].string(), "confidence": float(c[0].confidence())})
    return out

if __name__ == "__main__":
    res = {}
    for p in sys.argv[1:]:
        r = ocr(p)
        res[p] = r
    print(json.dumps(res, ensure_ascii=False, indent=1))
