#!/usr/bin/env python3
"""
좌석 시야 이미지 -> 픽셀아트 변환기.

확정 사양: 128x74 / 24색.
  축소   Image.BOX      (박스 평균. LANCZOS 같은 샤프닝 커널은 픽셀아트에 링잉을 만든다)
  색감축 quantize(method=MEDIANCUT, dither=NONE)
  표시   NEAREST 정수배 확대 (뷰어 쪽 책임. 이 스크립트는 1x 원본만 저장한다)

입력은 두 가지다.
  1) file  : 평범한 이미지(스크린샷/사진). 필요하면 브라우저 UI 를 크롭해서 잘라낸다.
  2) cube  : krpano 큐브맵 타일 폴더(pano_{f,l,r,b,u,d}.jpg 또는 mobile_*.jpg).
             옆에 있는 p_XXX.xml 의 hlookat/vlookat/fov 를 읽어서
             공식 뷰어가 처음 보여주는 화각 그대로 원근 투영한다.
             핫스팟('i' 아이콘)은 뷰어가 런타임에 그리는 것이라 원본 타일에는 없다.

사용 예:
  python3 tools/pixelate.py cube docs/refs/lotte_vr/raw/p_* -o app/assets/vr --prefix lotte_
  python3 tools/pixelate.py file docs/refs/sac_seatview/raw/*.jpg -o app/assets/vr --prefix sac_
  python3 tools/pixelate.py file shot.png -o out --crop 0,0,1580,980     # 하단 컨트롤바 제거
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow 와 numpy 가 필요하다:  pip install pillow numpy")

# ---- 확정 사양 -------------------------------------------------------------
W, H, COLORS = 128, 74, 24
CUBE_FACES = ("f", "l", "r", "b", "u", "d")


# ---- 1. 픽셀화 -------------------------------------------------------------
def pixelate(img: Image.Image, w: int = W, h: int = H, colors: int = COLORS) -> Image.Image:
    """BOX 축소 -> MEDIANCUT 감색. 반환은 팔레트 이미지(1x)."""
    small = img.convert("RGB").resize((w, h), Image.BOX)
    return small.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE)


def auto_trim(img: Image.Image, thr: int = 12) -> Image.Image:
    """
    사방을 두른 **검은 여백**을 잘라낸다.

    예당 ct_view*.jpg 는 626x460 안에 12px 검은 테두리가 둘려 있다. 그냥 축소하면
    24색 팔레트에서 색을 하나 날리고 화각도 틀어진다.
    """
    a = np.asarray(img.convert("RGB")).astype(int).max(2)
    nz = a > thr
    if not nz.any():
        return img
    ys = np.where(nz.any(1))[0]
    xs = np.where(nz.any(0))[0]
    return img.crop((int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1))


def fit_aspect(img: Image.Image, w: int, h: int) -> Image.Image:
    """대상 비율에 맞게 가운데를 잘라낸다 (찌그러뜨리지 않는다)."""
    target = w / h
    src = img.width / img.height
    if abs(src - target) < 1e-3:
        return img
    if src > target:  # 원본이 더 넓다 -> 좌우를 자른다
        nw = round(img.height * target)
        x0 = (img.width - nw) // 2
        return img.crop((x0, 0, x0 + nw, img.height))
    nh = round(img.width / target)  # 원본이 더 높다 -> 위아래를 자른다
    y0 = (img.height - nh) // 2
    return img.crop((0, y0, img.width, y0 + nh))


# ---- 2. 큐브맵 -> 원근 투영 -------------------------------------------------
def load_cube(tiles_dir: Path) -> dict[str, np.ndarray]:
    """pano_*.jpg 를 우선 쓰고, 없으면 mobile_*.jpg 로 떨어진다."""
    for stem in ("pano", "mobile"):
        paths = {f: tiles_dir / f"{stem}_{f}.jpg" for f in CUBE_FACES}
        if all(p.exists() for p in paths.values()):
            return {f: np.asarray(Image.open(p).convert("RGB")) for f, p in paths.items()}
    raise FileNotFoundError(f"{tiles_dir}: pano_*.jpg / mobile_*.jpg 둘 다 없다")


def read_view(xml_path: Path) -> tuple[float, float, float]:
    """krpano <view hlookat vlookat fov> 를 읽는다. 없으면 (0,0,100)."""
    if not xml_path.exists():
        return 0.0, 0.0, 100.0
    m = re.search(r"<view\b([^>]*)>", xml_path.read_text(encoding="utf-8", errors="replace"))
    if not m:
        return 0.0, 0.0, 100.0
    attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))

    def num(key: str, default: float) -> float:
        try:
            return float(attrs.get(key, default))
        except ValueError:
            return default

    return num("hlookat", 0.0), num("vlookat", 0.0), num("fov", 100.0)


def cube_to_perspective(
    faces: dict[str, np.ndarray], hlookat: float, vlookat: float, fov: float, w: int, h: int
) -> Image.Image:
    """
    큐브맵을 원근 카메라로 다시 찍는다.

    krpano 규약: hlookat 은 y축 회전(오른쪽이 +), vlookat 은 아래로 내려다보는 각(+ 가 아래).
    fov 는 화면의 **더 긴 변** 기준(MFOV)이라 가로가 긴 우리 출력에서는 수평 화각이다.
    """
    fx = np.tan(np.radians(fov) / 2.0)
    fy = fx * (h / w)

    # 화면 격자 -> 카메라 공간 광선. +z 가 정면, +x 오른쪽, +y 아래.
    u = (np.arange(w) + 0.5) / w * 2.0 - 1.0
    v = (np.arange(h) + 0.5) / h * 2.0 - 1.0
    ux, vy = np.meshgrid(u * fx, v * fy)
    x, y, z = ux, vy, np.ones_like(ux)

    # 시선 회전 (pitch 먼저, 그 다음 yaw).
    # krpano 부호 규약: vlookat + 는 아래를 본다, hlookat + 는 오른쪽으로 돈다.
    p, yaw = np.radians(vlookat), np.radians(hlookat)
    y, z = y * np.cos(p) + z * np.sin(p), -y * np.sin(p) + z * np.cos(p)
    x, z = x * np.cos(yaw) + z * np.sin(yaw), -x * np.sin(yaw) + z * np.cos(yaw)

    ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
    out = np.zeros((h, w, 3), dtype=np.uint8)

    # 면별 (major 축, 면 안에서의 s, t). 부호는 f 면이 뒤집히지 않는 쪽으로 맞춰 두었다.
    plan = {
        "f": (az >= ax) & (az >= ay) & (z > 0),
        "b": (az >= ax) & (az >= ay) & (z <= 0),
        "r": (ax >= ay) & (ax > az) & (x > 0),
        "l": (ax >= ay) & (ax > az) & (x <= 0),
        "d": (ay > ax) & (ay > az) & (y > 0),
        "u": (ay > ax) & (ay > az) & (y <= 0),
    }
    for face, mask in plan.items():
        if not mask.any():
            continue
        img = faces[face]
        n = img.shape[0]
        xm, ym, zm = x[mask], y[mask], z[mask]
        if face == "f":
            s, t, d = xm, ym, zm
        elif face == "b":
            s, t, d = -xm, ym, -zm
        elif face == "r":
            s, t, d = -zm, ym, xm
        elif face == "l":
            s, t, d = zm, ym, -xm
        elif face == "d":
            s, t, d = xm, -zm, ym
        else:  # "u"
            s, t, d = xm, zm, -ym
        su = np.clip(((s / d) * 0.5 + 0.5) * n, 0, n - 1).astype(np.int32)
        tv = np.clip(((t / d) * 0.5 + 0.5) * n, 0, n - 1).astype(np.int32)
        out[mask] = img[tv, su]
    return Image.fromarray(out)


# ---- 3. CLI ----------------------------------------------------------------
def parse_crop(spec: str | None) -> tuple[int, int, int, int] | None:
    if not spec:
        return None
    parts = [int(p) for p in spec.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("--crop 은 L,T,R,B 네 개다")
    return tuple(parts)  # type: ignore[return-value]


def save(img: Image.Image, out: Path, preview_scale: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)
    if preview_scale > 1:
        prev = out.with_name(out.stem + f"@{preview_scale}x.png")
        img.convert("RGB").resize(
            (img.width * preview_scale, img.height * preview_scale), Image.NEAREST
        ).save(prev)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="좌석 시야 -> 128x74/24색 픽셀아트")
    ap.add_argument("mode", choices=("file", "cube"))
    ap.add_argument("inputs", nargs="+", help="이미지 파일들 / 큐브맵 타일 폴더들")
    ap.add_argument("-o", "--out", required=True, help="출력 폴더")
    ap.add_argument("--prefix", default="", help="출력 파일명 앞에 붙일 문자열")
    ap.add_argument("--width", type=int, default=W)
    ap.add_argument("--height", type=int, default=H)
    ap.add_argument("--colors", type=int, default=COLORS)
    ap.add_argument(
        "--crop",
        help="file 모드에서 잘라낼 영역 L,T,R,B. 브라우저 컨트롤바 등 UI 제거용.",
    )
    ap.add_argument(
        "--auto-trim",
        action="store_true",
        help="file 모드에서 사방의 검은 여백을 자동으로 잘라낸다 (예당 사진의 12px 테두리).",
    )
    ap.add_argument(
        "--trim-bottom",
        type=int,
        default=0,
        help="file 모드에서 아래쪽 N 픽셀을 버린다 (VR 뷰어 컨트롤바).",
    )
    ap.add_argument("--fov", type=float, default=None, help="cube 모드에서 xml 값을 무시하고 강제")
    ap.add_argument(
        "--preview-scale", type=int, default=0, help=">1 이면 NEAREST 확대본을 같이 저장"
    )
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    crop = parse_crop(a.crop)
    outdir = Path(a.out)
    made = 0
    for raw in a.inputs:
        src = Path(raw)
        try:
            if a.mode == "cube":
                if not src.is_dir():
                    print(f"skip (폴더가 아니다): {src}", file=sys.stderr)
                    continue
                faces = load_cube(src)
                xmls = sorted(src.glob("*.xml"))
                hl, vl, fov = read_view(xmls[0]) if xmls else (0.0, 0.0, 100.0)
                if a.fov is not None:
                    fov = a.fov
                # 픽셀아트보다 크게 렌더한 뒤 BOX 로 내려야 앨리어싱이 덜하다.
                big = cube_to_perspective(faces, hl, vl, fov, a.width * 8, a.height * 8)
                img, stem = big, src.name
            else:
                img = Image.open(src)
                if a.auto_trim:
                    img = auto_trim(img)
                if crop:
                    img = img.crop(crop)
                if a.trim_bottom:
                    img = img.crop((0, 0, img.width, img.height - a.trim_bottom))
                img = fit_aspect(img, a.width, a.height)
                stem = src.stem
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {src}: {exc}", file=sys.stderr)
            continue

        dst = outdir / f"{a.prefix}{stem}.png"
        if a.dry_run:
            print(f"[dry] {src} -> {dst}")
            continue
        save(pixelate(img, a.width, a.height, a.colors), dst, a.preview_scale)
        made += 1
    print(f"{made} 개 생성 -> {outdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
