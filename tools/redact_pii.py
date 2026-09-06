#!/usr/bin/env python3
"""티켓 사진에서 개인정보를 가린 뒤 저장한다. 전량 로컬 처리.

왜 필요한가
-----------
Gemini 무료 티어 약관: "human reviewers may read, annotate, and process your
API input and output." 우리 티켓 사진 14장 중 12장에 실명·예매번호·QR 이 있다.
**내보낼 개인정보가 없으면 이 조항이 적용될 대상 자체가 사라진다.**

macOS Vision 이 텍스트 줄마다 바운딩박스를, 바코드/QR 은 별도로 좌표를 준다.
그걸로 가릴 위치를 정확히 안다. 전 과정이 오프라인이다.

사용:
    python3 tools/redact_pii.py IMG_1598.jpg -o out/
    python3 tools/redact_pii.py *.jpg -o out/ --preview   # 빨간 테두리로 미리보기
    python3 tools/redact_pii.py IMG_1598.jpg --report      # 무엇을 가릴지만 출력

설계 원칙
---------
* **과하게 가린다.** 공연명 한두 글자를 잃는 것보다 실명이 새는 게 나쁘다.
* **가린 뒤 다시 OCR 해서 검증한다.** 패턴이 여전히 읽히면 실패로 처리한다.
  가렸다고 믿고 넘어가면 안 된다.
* 좌석·날짜·공연장·곡목은 **절대 가리지 않는다.** 그게 우리가 필요한 데이터다.
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

# macOS Vision / Quartz / Pillow 는 **지연 임포트**한다.
#
# 최상위에서 임포트하면 순수 판정 로직(classify / _is_fragment / 패턴표)을 macOS 밖에서는
# import 조차 할 수 없어 테스트가 불가능해진다. 실제로 필요한 시점은 이미지를 읽을 때뿐이다.
# 사용자가 보는 동작은 같다 — OCR 을 수행하는 순간 같은 안내와 함께 ImportError 가 난다.
Vision = Quartz = NSURL = None
Image = ImageDraw = None


def _load_vision() -> None:
    """macOS Vision/Quartz 를 로드한다 (analyze 진입 시)."""
    global Vision, Quartz, NSURL
    if Vision is not None:
        return
    try:
        import Vision as _Vision, Quartz as _Quartz
        from Foundation import NSURL as _NSURL
    except ImportError:
        print("pyobjc 가 필요하다: pip install pyobjc-framework-Vision", file=sys.stderr)
        raise
    Vision, Quartz, NSURL = _Vision, _Quartz, _NSURL


def _load_pil() -> None:
    """Pillow 를 로드한다 (redact 진입 시)."""
    global Image, ImageDraw
    if Image is not None:
        return
    try:
        from PIL import Image as _Image, ImageDraw as _ImageDraw
    except ImportError:
        print("Pillow 가 필요하다: pip install Pillow", file=sys.stderr)
        raise
    Image, ImageDraw = _Image, _ImageDraw

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# 개인정보 패턴
# ---------------------------------------------------------------------------
# 가릴 것
PII_PATTERNS = [
    (re.compile(r'\bT\d{9,13}\b'),                    'booking_no'),   # 예매번호 T1234567890
    (re.compile(r'\b\d{10,}\b'),                      'long_digits'),  # 바코드 숫자열
    (re.compile(r'\b\d{6}[-\s]?[1-4]\d{6}\b'),        'rrn'),          # 주민번호
    (re.compile(r'\b01[016-9][-\s]?\d{3,4}[-\s]?\d{4}\b'), 'phone'),
    (re.compile(r'\b\d{4}[-./]\d{2}[-./]\d{2}\b(?=.*생)'), 'birth'),
    (re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+'),          'email'),
]

# 이 라벨 뒤/옆에 오는 값은 이름이다
NAME_LABELS = re.compile(r'(예매자|예매인|성\s*명|이\s*름|구매자|회원명|고객명)')

# 절대 가리면 안 되는 것 — 우리가 필요한 데이터
KEEP = re.compile(
    r'(객석|구역|블록|열|번|층|게이트|입장|'
    r'콘서트홀|예술의전당|롯데|세종|아트센터|'
    r'\d{4}[-.]\d{1,2}[-.]\d{1,2}|'          # 공연일
    r'오후|오전|\d{1,2}:\d{2}|'                # 공연시각
    r'[RSAVB]석|초대|원)'
)

# 한글 2~4자 단독 줄 = 이름일 가능성. 단 아래 단어는 제외
NOT_A_NAME = {
    '지휘', '피아노', '바이올린', '첼로', '비올라', '플루트', '클라리넷',
    '오보에', '바순', '호른', '트럼펫', '하프', '성악', '소프라노',
    '테너', '바리톤', '베이스', '알토', '협연', '연주', '독주', '관람',
    '공연', '일시', '장소', '좌석', '등급', '가격', '금액', '정가',
    '할인', '취소', '환불', '주최', '주관', '후원', '문의', '예매',
    '티켓', '입장', '게이트', '객석', '구역', '블록', '합창', '교향',
    '서울', '경기', '부산', '대구', '광주', '대전', '인천',
}


def _handler(img):
    return Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(img, None)


def analyze(path: Path) -> dict:
    """OCR + 바코드 검출. 정규화 좌표(0~1, 좌하단 원점)로 반환."""
    _load_vision()
    url = NSURL.fileURLWithPath_(str(path))
    src = Quartz.CGImageSourceCreateWithURL(url, None)
    if src is None:
        return {'ok': False, 'error': 'cannot open'}
    img = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
    if img is None:
        return {'ok': False, 'error': 'cannot decode'}

    W = Quartz.CGImageGetWidth(img)
    H = Quartz.CGImageGetHeight(img)

    text_req = Vision.VNRecognizeTextRequest.alloc().init()
    text_req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    text_req.setRecognitionLanguages_(['ko-KR', 'en-US'])
    text_req.setUsesLanguageCorrection_(True)

    bar_req = Vision.VNDetectBarcodesRequest.alloc().init()

    ok, _ = _handler(img).performRequests_error_([text_req, bar_req], None)
    if not ok:
        return {'ok': False, 'error': 'vision failed'}

    lines = []
    for obs in (text_req.results() or []):
        cands = obs.topCandidates_(1)
        if not cands or not len(cands):
            continue
        bb = obs.boundingBox()
        lines.append({
            'text': cands[0].string(),
            'confidence': float(cands[0].confidence()),
            'box': [bb.origin.x, bb.origin.y, bb.size.width, bb.size.height],
        })

    barcodes = []
    for obs in (bar_req.results() or []):
        bb = obs.boundingBox()
        barcodes.append({
            'symbology': str(obs.symbology()),
            'box': [bb.origin.x, bb.origin.y, bb.size.width, bb.size.height],
        })

    return {'ok': True, 'width': W, 'height': H,
            'lines': lines, 'barcodes': barcodes}


def _is_fragment(t: str, lines: list[dict], self_i: int) -> bool:
    """다른 (더 긴) 줄 안에 그대로 들어 있으면 잘린 파편으로 본다.

    실명은 티켓에 단독으로 찍히지, 공연명 안에 들어 있지 않다.
    반대로 "하모닉" 은 "로열 필하모닉 오케스트라" 안에 있다.
    """
    for j, o in enumerate(lines):
        if j == self_i:
            continue
        other = o['text'].strip()
        if len(other) > len(t) and t in other:
            return True
    return False


def classify(lines: list[dict]) -> list[dict]:
    """가릴 줄을 고른다. 이유를 함께 남긴다."""
    marked = []
    label_idx = {i for i, l in enumerate(lines) if NAME_LABELS.search(l['text'])}

    for i, l in enumerate(lines):
        t = l['text'].strip()
        reasons = []

        for pat, kind in PII_PATTERNS:
            if pat.search(t):
                reasons.append(kind)

        # "예매자" 라벨과 같은 줄이거나 바로 다음 줄이면 이름으로 본다
        if i in label_idx:
            reasons.append('name_label_line')
        elif (i - 1) in label_idx or (i + 1) in label_idx:
            if re.fullmatch(r'[가-힣]{2,4}', t) and t not in NOT_A_NAME:
                reasons.append('name_near_label')

        # 한글 2~4자 단독 줄 — 이름일 가능성. 필요한 데이터가 섞였으면 제외
        #
        # ⚠️ 가장자리에서 잘린 파편이 여기 걸린다. 실측 사례:
        #     "하모닉"  ← "로열 필하모닉 오케스트라…" 의 잘린 조각 (y=-0.004)
        #     "정명한"  ← 공연명 파편 (y=0.001)
        # 이걸 가리면 공연명이 손상된다. **다른 긴 줄의 부분문자열이면 건너뛴다.**
        if (re.fullmatch(r'[가-힣]{2,4}', t)
                and t not in NOT_A_NAME
                and not KEEP.search(t)
                and not _is_fragment(t, lines, i)):
            reasons.append('bare_korean_name')

        if reasons:
            marked.append({**l, 'reasons': sorted(set(reasons))})
    return marked


def redact(path: Path, out_dir: Path, preview: bool = False,
           pad: float = 0.006) -> dict:
    a = analyze(path)
    if not a['ok']:
        return {'file': path.name, 'ok': False, 'error': a.get('error')}

    W, H = a['width'], a['height']
    targets = classify(a['lines'])

    _load_pil()
    im = Image.open(path).convert('RGB')
    if im.size != (W, H):          # EXIF 회전 등으로 어긋나면 좌표가 안 맞는다
        im = im.resize((W, H))
    d = ImageDraw.Draw(im)

    def to_px(box):
        x, y, w, h = box
        # Vision 은 좌하단 원점. PIL 은 좌상단 원점.
        x0 = max(0, (x - pad) * W)
        x1 = min(W, (x + w + pad) * W)
        y0 = max(0, (1 - y - h - pad) * H)
        y1 = min(H, (1 - y + pad) * H)
        return [x0, y0, x1, y1]

    boxes = [(to_px(t['box']), ','.join(t['reasons'])) for t in targets]
    boxes += [(to_px(b['box']), 'barcode') for b in a['barcodes']]

    for rect, why in boxes:
        if preview:
            d.rectangle(rect, outline=(255, 0, 0), width=max(2, W // 400))
        else:
            d.rectangle(rect, fill=(0, 0, 0))

    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = '_preview' if preview else '_redacted'
    out_path = out_dir / f'{path.stem}{suffix}.jpg'
    im.save(out_path, quality=92)   # 재인코딩이라 EXIF(GPS 포함)도 함께 사라진다

    result = {
        'file': path.name,
        'ok': True,
        'out': str(out_path),
        'redacted_text': len(targets),
        'redacted_barcodes': len(a['barcodes']),
        'reasons': sorted({r for t in targets for r in t['reasons']}),
    }

    # --- 검증: 가린 이미지를 다시 읽어 패턴이 남았는지 본다 -----------------
    if not preview:
        again = analyze(out_path)
        leaked = []
        if again['ok']:
            for l in again['lines']:
                for pat, kind in PII_PATTERNS:
                    if pat.search(l['text']):
                        leaked.append({'kind': kind, 'text': l['text'][:40]})
        result['verified'] = not leaked
        result['leaked'] = leaked
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('images', nargs='+')
    ap.add_argument('-o', '--out', default=str(ROOT / 'work/redacted'))
    ap.add_argument('--preview', action='store_true',
                    help='가리는 대신 빨간 테두리로 표시')
    ap.add_argument('--report', action='store_true',
                    help='이미지를 만들지 않고 무엇을 가릴지만 출력')
    a = ap.parse_args()

    out_dir = Path(a.out)
    results = []
    for p in a.images:
        path = Path(p)
        if not path.exists():
            print(f'없음: {p}', file=sys.stderr)
            continue
        if a.report:
            info = analyze(path)
            if not info['ok']:
                continue
            t = classify(info['lines'])
            print(f'\n[{path.name}] 가릴 것 {len(t)}건 + 바코드 {len(info["barcodes"])}건')
            for x in t:
                print(f'   {",".join(x["reasons"]):22s} {x["text"][:44]}')
            continue
        results.append(redact(path, out_dir, a.preview))

    if results:
        print(json.dumps(results, ensure_ascii=False, indent=1))
        bad = [r for r in results if r.get('leaked')]
        if bad:
            print(f'\n⚠️ 검증 실패 {len(bad)}건 — 가린 뒤에도 패턴이 읽힌다.',
                  file=sys.stderr)
            return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
