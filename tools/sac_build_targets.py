#!/usr/bin/env python3
"""월간 일정 캐시에서 상세 수집 대상(콘서트홀 + IBK챔버홀 클래식)을 뽑는다."""
import json
import os
import glob
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "work", "sac_programs")

VENUES = {
    "콘서트홀": "콘서트홀",
    "IBK기업은행챔버홀": "IBK챔버홀",
    "IBK챔버홀": "IBK챔버홀",
}

# CATEGORY_SECONDARY 코드 → (장르명, genreConfidence)
GENRE = {
    "000005": ("클래식", 1.0),
    "000013": ("교향곡", 1.0),
    "000014": ("실내악", 1.0),
    "000015": ("합창", 1.0),
    "000016": ("성악", 1.0),
    "000018": ("독주", 1.0),
    "000001": ("미분류(11시콘서트 등)", 0.8),  # 예당 11시콘서트·아티스트라운지 다수
    "32":     ("관현악", 0.8),
    "000004": ("미분류", 0.7),        # 리사이틀·앙상블 정기연주회 섞임
    "000002": ("오페라", 0.5),       # 콘서트홀 연주회형 오페라/갈라
    "000003": ("이벤트콘서트", 0.4),  # 팝스·크로스오버 섞임
    "000017": ("크로스오버", 0.3),
    "000011": ("복합장르", 0.2),
    "000012": ("재즈", 0.1),
}


def main():
    by_sn = {}
    dropped = collections.Counter()
    for path in sorted(glob.glob(os.path.join(BASE, "cal", "*.json"))):
        d = json.load(open(path))
        for k, v in d.items():
            if k == "result":
                continue
            for r in v:
                place = (r.get("PLACE_NAME") or "").replace(" ", "")
                if place not in VENUES:
                    dropped[("place", place)] += 1
                    continue
                code = r.get("CATEGORY_SECONDARY")
                if code not in GENRE:
                    dropped[("genre", place, code, r.get("CATEGORY_SECONDARY_NAME"))] += 1
                    continue
                gname, gconf = GENRE[code]
                sn = str(r["SN"])
                by_sn[sn] = {
                    "sn": sn,
                    "title": r.get("PROGRAM_SUBJECT"),
                    "titleEng": r.get("PROGRAM_SUBJECT_ENG"),
                    "venue": VENUES[place],
                    "genre": gname,
                    "genreConfidence": gconf,
                    "date": (r.get("BEGIN_DATE") or "").replace(".", "-"),
                    "endDate": (r.get("END_DATE") or "").replace(".", "-"),
                    "runtimeMin": (r.get("HOMEPAGE_CONTACT_TIME") or "").strip(),
                    "priceInfo": r.get("PRICE_INFO"),
                }
    targets = sorted(by_sn.values(), key=lambda t: t["date"])
    with open(os.path.join(BASE, "targets.json"), "w") as f:
        json.dump(targets, f, ensure_ascii=False, indent=1)
    print("targets:", len(targets))
    yr = collections.Counter(t["date"][:4] for t in targets)
    for y in sorted(yr):
        print(" ", y, yr[y])
    print("venue:", collections.Counter(t["venue"] for t in targets))
    print("genre:", collections.Counter(t["genre"] for t in targets))
    print("\ndropped top 15:")
    for k, c in dropped.most_common(15):
        print("  ", k, c)


if __name__ == "__main__":
    main()
