#!/usr/bin/env python3
"""
좌석 시야 자산 빌더.

원본(docs/refs/**/raw) -> 픽셀아트(app/assets/vr) + 메타데이터(app/data/vrPoints.ts)
+ 출처 기록(app/assets/vr/CREDITS.md) 를 한 번에 만든다.

  python3 tools/build_vr_points.py

메타데이터의 출처
  롯데 : 공식 객석안내 페이지의 <a class="btn_go {block}{nn}" data-url="/vr/each/html/p_XXX.html">
         + style.css 의 .info_seat_map.map_gak0N .img_area .{block}{nn}{top;left}
         -> 층/구역은 공식 마크업에서 그대로 온다(confirmed).
         열(row)은 공식 배치도 PNG 에서 좌석 띠를 검출해 아이콘 좌표와 맞춘 값이라
         중앙 구역(B/C/D)만 채우고 나머지는 null 로 둔다.
  예당 : 공식 concertHall 페이지의 <area alt="1층A블록4열2번"> -> 층/구역/열/번 전부 확정.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "app" / "assets" / "vr"
LOTTE_RAW = ROOT / "docs" / "refs" / "lotte_vr" / "raw"
SAC_RAW = ROOT / "docs" / "refs" / "sac_seatview" / "raw"
CACHE = ROOT / "docs" / "refs" / "_source_cache"

LOTTE_SEAT_PAGE = {
    1: "https://www.lotteconcerthall.com/home/ko/display/region/content/"
       "JSVFSGpkUzVBaHYzUmMrZElSU3BxcERUVHFNUlk3bzZMYytkVXJtOXJqdEZaZz0=",
    2: "https://www.lotteconcerthall.com/home/ko/display/region/content/"
       "JSVFdUtsRnZ1QUViajZJNDdXNGp6MXBSbG14UDRFOElmdFVvL3RmMlUzQWZ5Zz0=",
}
SAC_SEAT_PAGE = "https://www.sac.or.kr/site/main/content/concertHall"
ICON = 14  # btn_seat_go.svg 는 28x28. CSS left/top 은 좌상단이라 +14 가 중심이다.

# 층별 무대 중심 (공식 배치도 픽셀). 깊이 순서를 매기는 데만 쓴다.
STAGE_CENTER = {1: (354.0, 350.0), 2: (326.0, 345.0)}
# 좌우 배열 순서. 같은 구역 포인트가 없을 때 이웃 구역으로 떨어지는 데 쓴다.
LOTTE_BLOCK_ORDER = ["LP", "L", "A", "B", "C", "D", "E", "R", "RP", "P"]
SAC_BLOCK_ORDER = ["H", "A", "B", "C", "D", "E", "F", "G"]


# ---------------------------------------------------------------- 롯데
def lotte_points(style_css: str, pages: dict[int, str]) -> list[dict]:
    """CSS 좌표 + 페이지의 data-url 을 합쳐 포인트 목록을 만든다."""
    coords: dict[int, dict[str, tuple[int, int]]] = {}
    for floor, cls in ((1, "map_gak01"), (2, "map_gak02")):
        coords[floor] = {
            m.group(1): (int(m.group(3)) + ICON, int(m.group(2)) + ICON)
            for m in re.finditer(
                rf"\.info_seat_map\.{cls} \.img_area \.([a-z]+\d\d)\{{top:(\d+)px;left:(\d+)px\}}",
                style_css,
            )
        }
    out = []
    for floor, page_html in pages.items():
        for m in re.finditer(
            r'<a[^>]*class="btn_go ([a-z]+)(\d\d)"[^>]*data-url="([^"]+)"', page_html
        ):
            block, idx, url = m.group(1).upper(), m.group(2), m.group(3)
            key = f"{block.lower()}{idx}"
            if key not in coords[floor]:
                print(f"  ! CSS 좌표 없음: {floor}F {key}", file=sys.stderr)
                continue
            x, y = coords[floor][key]
            pid = re.search(r"p_(\d+)\.html", url).group(1)
            out.append(
                {
                    "tile": f"p_{pid}",
                    "floor": floor,
                    "block": block,
                    "idx": int(idx),
                    "mapX": x,
                    "mapY": y,
                    "viewerUrl": f"https://www.lotteconcerthall.com/vr/each/html/p_{pid}.html",
                }
            )
    return out


def detect_row_bands(img: Image.Image, x0: int, x1: int, y0: int, y1: int) -> list[int]:
    """배치도에서 좌석 글리프의 가로 띠 중심 y 를 찾는다."""
    a = np.asarray(img.convert("RGB")).astype(int)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    sat = a.max(2) - a.min(2)
    gold = (sat > 25) & (r > g) & (g > b)
    slate = (a.max(2) < 150) & (a.min(2) > 40) & (b >= r)
    seat = gold | slate
    prof = seat[y0:y1, x0:x1].sum(1)
    thr = max(prof.max() * 0.25, 3)
    out, inb, s = [], False, 0
    for i, v in enumerate(prof):
        if v > thr and not inb:
            s, inb = i, True
        elif v <= thr and inb:
            out.append(y0 + (s + i) // 2)
            inb = False
    if inb:
        out.append(y0 + (s + len(prof)) // 2)
    return out


# ---------------------------------------------------------------- 예당
SAC_LABEL = re.compile(r"^(\d)층(BOX\d+|[A-Z])블록?(?:(\d+)열)?(\d+)번$")


def parse_sac_label(alt: str) -> dict | None:
    """'1층A블록4열2번' / '합창석G블록2열3번' / '3층 BOX12 5번' 을 뜯는다."""
    raw = unicodedata.normalize("NFKC", html.unescape(alt)).strip()
    # BOX 는 공백을 지우면 'BOX1 3번' -> 'BOX13번' 이 되어 번호와 붙어버린다.
    # 공백이 남아 있는 원문에서 먼저 잡는다.
    mb = re.match(r"^(\d)층\s+(BOX\d+)\s+(\d+)번$", raw)
    if mb:
        return {
            "floor": int(mb.group(1)),
            "block": mb.group(2),
            "row": None,
            "number": int(mb.group(3)),
            "choir": False,
        }
    s = raw.replace(" ", "")
    choir = s.startswith("합창석")
    if choir:  # 합창석 F/G/H 는 1층 무대 뒤다 (venues.ts 와 같은 취급)
        s = "1층" + s[len("합창석"):]
    s = s.replace("블럭", "블록")
    m = SAC_LABEL.match(s)
    if not m:
        return None
    floor, block, row, num = m.groups()
    return {
        "floor": int(floor),
        "block": block,
        "row": int(row) if row else None,
        "number": int(num),
        "choir": choir,
    }


# ---------------------------------------------------------------- 공통
def label_ko(venue: str, p: dict) -> str:
    parts = [f"{p['floor']}층", f"{p['block']}구역"]
    if p.get("row"):
        parts.append(f"{p['row']}열")
    if p.get("number"):
        parts.append(f"{p['number']}번")
    if venue == "lotte-concert-hall" and not p.get("row"):
        parts.append(f"시점{p['idx']}")
    if p.get("choir"):
        parts.insert(0, "합창석")
    return " ".join(parts)


def ts_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def main() -> int:
    ASSETS.mkdir(parents=True, exist_ok=True)
    style_css = (CACHE / "lotte_style.css").read_text(encoding="utf-8", errors="replace")
    pages = {
        f: (CACHE / f"lotte_seat_{f}f.html").read_text(encoding="utf-8", errors="replace")
        for f in (1, 2)
    }
    sac_html = (CACHE / "sac_concertHall.html").read_text(encoding="utf-8", errors="replace")

    # ---- 롯데 ----
    lot = lotte_points(style_css, pages)
    maps = {1: Image.open(CACHE / "lotte_map_1f.png"), 2: Image.open(CACHE / "lotte_map_2f.png")}
    # 중앙(C) 열 띠를 검출해 B/C/D 의 열 번호를 붙인다. B/D 는 8·16·17·18열이 없다.
    band = {
        1: detect_row_bands(maps[1], 290, 420, 480, 900),
        2: detect_row_bands(maps[2], 280, 380, 770, 920),
    }
    gaps = {8, 16, 17, 18}
    for p in lot:
        p["row"] = None
        bands = band[p["floor"]]
        expect = {1: 23, 2: 8}[p["floor"]]
        if p["block"] in ("B", "C", "D") and len(bands) == expect:
            rows = list(range(1, expect + 1))
            if p["floor"] == 1 and p["block"] in ("B", "D"):
                rows = [r for r in rows if r not in gaps]
            cand = [(abs(bands[r - 1] - p["mapY"]), r) for r in rows]
            dist, row = min(cand)
            if dist <= 12:
                p["row"] = row
        cx, cy = STAGE_CENTER[p["floor"]]
        p["dist"] = float(np.hypot(p["mapX"] - cx, p["mapY"] - cy))
        p["number"] = None
        p["asset"] = f"lotte_{p['floor']}f_{p['block'].lower()}{p['idx']:02d}.png"
        p["sourceUrl"] = LOTTE_SEAT_PAGE[p["floor"]]

    # ---- 예당 ----
    i1, i2 = sac_html.find('id="concert1_view"'), sac_html.find('id="concert2_view"')
    sac = []
    for m in re.finditer(r"<area\b[^>]*>", sac_html):
        tag = m.group(0)
        gid = re.search(r'id="view(\d+)"', tag)
        alt = re.search(r'alt="([^"]*)"', tag)
        co = re.search(r'coords="([^"]*)"', tag)
        if not (gid and alt):
            continue
        info = parse_sac_label(alt.group(1))
        if not info:
            print(f"  ! 라벨 파싱 실패: {alt.group(1)}", file=sys.stderr)
            continue
        n = int(gid.group(1))
        c = [int(v) for v in co.group(1).split(",")] if co else [0, 0, 0, 0]
        info.update(
            {
                "n": n,
                "mapX": (c[0] + c[2]) // 2,
                "mapY": (c[1] + c[3]) // 2,
                "sheet": 1 if m.start() < i2 else 2,
                "idx": n,
                "sourceUrl": SAC_SEAT_PAGE,
                "viewerUrl": f"https://www.sac.or.kr/design/theme/sac/images/sub/ct_view/ct_view{n}.jpg",
            }
        )
        blk = info["block"].lower()
        row = f"_{info['row']}r" if info["row"] else ""
        info["asset"] = f"sac_{info['floor']}f_{blk}{row}_{info['number']}n_{n:03d}.png"
        info["dist"] = None  # 예당은 열/번이 확정이라 깊이 순서가 필요 없다
        sac.append(info)

    # 예당은 층 안에서 열/번이 확정이라 깊이 대신 열을 그대로 쓴다.
    print(f"롯데 {len(lot)}개 / 예당 {len(sac)}개")

    # ---- 픽셀아트 생성 ----
    cube_dirs = [str(LOTTE_RAW / p["tile"]) for p in lot]
    names = [p["asset"] for p in lot]
    subprocess.run(
        [sys.executable, str(ROOT / "tools" / "pixelate.py"), "cube", *cube_dirs,
         "-o", str(ASSETS)],
        check=True,
    )
    for p, tile in zip(lot, [p["tile"] for p in lot]):
        src = ASSETS / f"{tile}.png"
        if src.exists():
            src.replace(ASSETS / p["asset"])
    sac_files = [str(SAC_RAW / f"ct_view{p['n']}.jpg") for p in sac]
    subprocess.run(
        [sys.executable, str(ROOT / "tools" / "pixelate.py"), "file", *sac_files,
         "-o", str(ASSETS), "--auto-trim"],
        check=True,
    )
    for p in sac:
        src = ASSETS / f"ct_view{p['n']}.png"
        if src.exists():
            src.replace(ASSETS / p["asset"])

    # ---- vrPoints.ts ----
    rows = []
    for venue, pts, order in (
        ("lotte-concert-hall", sorted(lot, key=lambda p: (p["floor"], p["block"], p["idx"])), LOTTE_BLOCK_ORDER),
        ("sac-concert-hall", sorted(sac, key=lambda p: p["n"]), SAC_BLOCK_ORDER),
    ):
        for p in pts:
            pid = Path(p["asset"]).stem
            rows.append(
                "  {\n"
                f"    id: {ts_str(pid)},\n"
                f"    venueId: {ts_str(venue)},\n"
                f"    floor: {p['floor']},\n"
                f"    block: {ts_str(p['block'])},\n"
                f"    row: {p['row'] if p['row'] else 'null'},\n"
                f"    number: {p.get('number') or 'null'},\n"
                f"    label: {ts_str(label_ko(venue, p))},\n"
                f"    asset: {ts_str('vr/' + p['asset'])},\n"
                f"    mapX: {p['mapX']},\n"
                f"    mapY: {p['mapY']},\n"
                f"    stageDist: {round(p['dist'], 1) if p['dist'] is not None else 'null'},\n"
                f"    sourceUrl: {ts_str(p['sourceUrl'])},\n"
                f"    assetUrl: {ts_str(p['viewerUrl'])},\n"
                "    confidence: 'confirmed',\n"
                "  },"
            )
    json.dump({"lotte": lot, "sac": sac}, open(CACHE / "vr_meta.json", "w"),
              ensure_ascii=False, indent=1, default=float)
    (CACHE / "vrPoints.rows.ts").write_text("\n".join(rows), encoding="utf-8")
    print(f"행 {len(rows)}개 -> {CACHE / 'vrPoints.rows.ts'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
