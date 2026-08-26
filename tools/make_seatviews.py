#!/usr/bin/env python3
"""
내가 찍은 시야 사진 -> app/assets/seatviews/ 픽셀아트(128x74 / 24색).

세로 사진이 많아서 tools/pixelate.py 의 fit_aspect(가운데 크롭)를 그대로 쓰면
프레임 아래쪽의 프로그램북/앞사람 뒤통수가 화면 절반을 먹는다.
그래서 사진마다 세로 중심(anchor, 0=맨 위 ~ 1=맨 아래)을 직접 지정한다.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from PIL import Image
from pixelate import pixelate, W, H, COLORS

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'app/assets/seatviews'

# (폴더, 인덱스, anchor, venue, 촬영일, 일련번호)
SPEC = [
    # ---- 롯데콘서트홀 ----
    ('fixed',  1, 0.28, 'lotte', '2025-07-22'),
    ('fixed',  2, 0.30, 'lotte', '2025-07-22'),
    ('fixed',  3, 0.42, 'lotte', '2025-07-22'),
    ('fixed',  6, 0.50, 'lotte', '2025-07-22'),
    ('fixed', 56, 0.45, 'lotte', '2025-07-22'),
    ('fixed', 57, 0.50, 'lotte', '2025-07-22'),
    ('fixed', 61, 0.50, 'lotte', '2025-08-19'),
    ('fixed', 62, 0.42, 'lotte', '2025-08-19'),
    ('fixed', 64, 0.50, 'lotte', '2025-08-19'),
    ('fixed', 66, 0.50, 'lotte', '2025-11-13'),
    ('fixed', 67, 0.50, 'lotte', '2025-11-13'),
    ('fixed', 68, 0.40, 'lotte', '2025-11-13'),
    ('fixed', 69, 0.45, 'lotte', '2025-11-13'),
    ('fixed', 70, 0.50, 'lotte', '2025-11-19'),
    ('fixed', 72, 0.38, 'lotte', '2025-11-19'),
    ('fixed', 74, 0.40, 'lotte', '2025-11-19'),
    # ---- 예술의전당 ----
    ('sac_fixed', 2, 0.60, 'sac', '2025-07-04'),
    ('sac_fixed', 4, 0.44, 'sac', '2025-07-04'),
    ('sac_fixed', 6, 0.60, 'sac', '2026-03-25'),
    ('sac_fixed', 7, 0.60, 'sac', '2026-03-25'),
    ('sac_fixed', 1, 0.42, 'sac', '2026-04-01'),
]


def crop_anchor(img: Image.Image, anchor: float, w=W, h=H) -> Image.Image:
    """대상 비율(16:9 근사)로 자르되, 세로 위치를 anchor 로 정한다."""
    target = w / h
    if img.width / img.height > target:      # 원본이 더 넓다 -> 좌우만 가운데서 자른다
        nw = round(img.height * target)
        x0 = (img.width - nw) // 2
        return img.crop((x0, 0, x0 + nw, img.height))
    nh = round(img.width / target)           # 원본이 더 높다 -> anchor 로 위아래를 자른다
    y0 = int(round(anchor * img.height - nh / 2))
    y0 = max(0, min(img.height - nh, y0))
    return img.crop((0, y0, img.width, y0 + nh))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob('*.png'):
        f.unlink()
    counter: dict[tuple[str, str], int] = {}
    rows = []
    for folder, idx, anchor, venue, date in SPEC:
        files = sorted((ROOT / 'work/myphotos' / folder).glob('*.jpg'))
        src = files[idx]
        n = counter.get((venue, date), 0) + 1
        counter[(venue, date)] = n
        name = f'{venue}_{date}_{n:02d}.png'
        img = crop_anchor(Image.open(src), anchor)
        pixelate(img, W, H, COLORS).save(OUT / name, optimize=True)
        rows.append((name, folder, idx, src.name, anchor))
        print(f'{name}  <- {folder}[{idx}] {src.name} anchor={anchor}')
    print(f'\n{len(rows)} 개 -> {OUT}')


if __name__ == '__main__':
    main()
