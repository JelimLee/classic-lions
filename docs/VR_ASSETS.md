# 좌석 시야(VR) 자산 — 조사 결과와 파이프라인

티켓의 좌석에 해당하는 **"그 자리에서 본 무대"** 픽셀아트를 만들기 위해
두 공연장의 공식 좌석 시야 서비스를 조사하고 자산을 뽑아낸 기록이다.

- 코드: `app/data/vrPoints.ts` (지점 표 + `nearestVRPoint`)
- 자산: `app/assets/vr/*.png` (205장) + `app/assets/vr/CREDITS.md` (출처)
- 도구: `tools/pixelate.py`, `tools/build_vr_points.py`
- 소비자: `app/services/stageView.ts` → `app/components/seatmap/StageView.tsx`

---

## 1. 결론 먼저

| | 롯데콘서트홀 | 예술의전당 콘서트홀 |
|---|---|---|
| 360° 좌석 VR | ✅ **있다** (krpano) | ❌ **없다** |
| 대신 있는 것 | — | 좌석별 **고정 화각 정지 사진** 155장 |
| 지점 수 | **50** (1층 35 / 2층 15) | **155** (1~3층 전체) |
| 원본 화질 | 큐브맵 6면 2048² (모바일 1024²) | 626×460 JPEG |
| 층·구역 확정 | 50/50 | 155/155 |
| 열·번 확정 | 18/50 (중앙 B·C·D 만) | 155/155 |

> 처음 예상은 카메라 아이콘 "20~25개"였는데 실제로는 **50개**다.
> 사용자 스크린샷 14장은 그중 일부였다. 스크린샷은 이제 쓰지 않는다 —
> 원본 파노라마를 직접 받았기 때문이다.

---

## 2. 롯데콘서트홀 — 어떻게 찾았나

옛 URL(`/kor/VenueGuide/FacilitySeat01`)은 사이트 개편으로 죽었고, 새 구조는
`/home/ko/display/region/content/{base64}` 라 URL 을 추측할 수 없다. 메인 페이지의
GNB 에서 "시설안내" 링크를 따라가 **객석안내 1층/2층** 페이지를 찾았다.

그 페이지 HTML 안에 카메라 아이콘이 그대로 들어 있다:

```html
<!-- C Block -->
<a href="#" class="btn_go c03" data-url="/vr/each/html/p_011.html">
  <img src="/images/sub/btn_seat_go.svg" alt="c석">
</a>
```

- **구역**은 CSS 클래스 접두사(`c03` → C 구역 3번 시점)에서 온다.
- **층**은 어느 페이지에 있느냐로 갈린다 (`map_gak01`=1층 / `map_gak02`=2층).
- **배치도상 좌표**는 `include/css/style.css` 에 하드코딩되어 있다:
  `.info_seat_map.map_gak01 .img_area .c03{top:634px;left:338px}`
  아이콘(`btn_seat_go.svg`)이 28×28 이므로 중심은 `+14, +14`.

  > 검증: 2층 배치도 PNG(`img_info_seat_gak02.png`)에는 카메라 아이콘 15개가
  > **인쇄되어** 있다. 그 15개의 무게중심과 위 CSS+14 좌표가 **3px 이내로 일치**했다.
  > 좌표 해석이 맞다는 증거다. (1층 PNG 에는 아이콘이 인쇄되어 있지 않다.)

뷰어는 krpano(`smartenterview.js` = 리브랜딩된 krpano) 다:

```
/vr/each/html/p_001.html → embedpano({ xml:"../xml/p_001.xml" })
/vr/each/xml/p_001.xml   → <view hlookat="0" vlookat="0" fov="100"/>
                            <cube url="../images/data/p_001.tiles/pano_%s.jpg"/>
                            <hotspot style="poistyle|poi04" ath="0.264" atv="-6.934"/>
```

**`p_001` ~ `p_050` 이 전부 존재한다** (모두 HTTP 200).

### 'i' 아이콘 문제는 사라졌다

주황색 `i` 핫스팟은 `<hotspot>` 엘리먼트로 **뷰어가 런타임에 그리는 것**이라
큐브맵 원본 JPEG 에는 찍혀 있지 않다. 스크린샷 기반이면 지울 방법이 없었지만,
원본을 받았으므로 결과물에는 아이콘도 브라우저 컨트롤바도 **없다.**

### 화각 재현

`pixelate.py cube` 가 큐브맵 6면을 xml 의 `hlookat/vlookat/fov` 로 다시 투영해
**공식 뷰어가 처음 보여주는 그 화각**을 그대로 만든다.

- 검증 1: `hlookat=0, vlookat=0, fov=90` 으로 렌더한 결과가 `pano_f.jpg` 와
  픽셀 평균 오차 6/255 (리샘플링 잡음 수준) → 면 방향·좌우반전 없음 확인.
- 검증 2: krpano 는 `vlookat` **양수가 아래**다. 처음에 부호를 반대로 잡아
  2층 지점들이 천장을 보고 있었다. 고친 뒤 전부 무대를 내려다본다.

### 열(row) 을 어디까지 알아냈나

공식 자료는 지점마다 열을 적어두지 않는다. 그래서 배치도 PNG 에서 좌석 글리프의
가로 띠를 검출해 아이콘의 y좌표와 맞췄다.

- 1층 중앙 열 띠 검출 = 정확히 23줄, 2층 = 정확히 8줄 (venues.ts 의 rowMin/rowMax 와 일치).
- 이 표로 C 구역을 읽으면 **1, 8, 9, 16, 17, 21열** 이 나온다.
  1·8 / 9·16 / 17·21 — 배치도의 **단(段) 경계 첫 열과 끝 열**이다. 눈으로 읽은 값과도 일치했다.
- B·D 도 같은 물리적 열이라 같은 표를 쓰되, 1층 B·D 에 없는 8·16·17·18열은 건너뛴다.
- **A·E·L·R·P·LP·RP 는 열을 채우지 않았다(null).** 열 축이 기울었거나(A/E)
  열이 깊이가 아니라 높이라서(L/R/LP/RP) 같은 방법이 안 통한다.
  `null` 은 "지점이 부정확하다"가 아니라 **"열 라벨이 없다"** 는 뜻이다.
  매칭은 `stageDist` 순서로 열 없이도 동작한다.

---

## 3. 예술의전당 — 360° VR 은 없다

`sac.or.kr` 을 뒤진 결과:

- **공식 좌석 VR / 360° 시야 미리보기: 없다.** 이건 확정이다.
- 대신 콘서트홀 페이지가 좌석배치도에 `<img usemap>` 이미지맵을 걸고,
  좌석마다 **고정 화각 정지 사진**을 띄운다:
  ```html
  <area shape="rect" id="view1" alt="1층A블록4열2번" coords="172,439,194,460">
  → https://www.sac.or.kr/design/theme/sac/images/sub/ct_view/ct_view1.jpg
  ```
  `view1`…`view155` ↔ `ct_view1.jpg`…`ct_view155.jpg` 1:1. `ct_view156` 은 302 → 정확히 155장.
- alt 텍스트에 층·구역·열·번이 전부 박혀 있어 **155개 전부 확정**이다.
  `합창석H블록1열2번` 같은 표기는 1층 F/G/H 로 정규화했다 (venues.ts 와 같은 취급).
- 별도로 `sac.or.kr/cybertour/` 에 krpano 360° 투어가 있지만 콘서트홀 객석
  시점은 **2개뿐**(`객석1`, `객석2`)이고 `global.xml` 이 krpano 암호화라 타일 URL 을
  정적으로 못 딴다. **쓰지 않았다.**

### 이게 뜻하는 것

예당은 롯데만큼 촘촘한 시야를 줄 수 없다. 지금은 155개 표본으로 충분히
쓸 만하지만(좌석 2,505석에 표본 155개), 화질(626×460)과 "360°가 아님"이 한계다.
**절차적 생성으로 갈 거라면 예당이 먼저다.**

---

## 4. 파이프라인

```bash
# 전체 재생성 (원본이 docs/refs/**/raw 에 있어야 한다)
python3 tools/build_vr_points.py

# 낱장 변환
python3 tools/pixelate.py cube docs/refs/lotte_vr/raw/p_001 -o out --preview-scale 6
python3 tools/pixelate.py file shot.png -o out --crop 0,0,1580,980   # 브라우저 UI 잘라내기
python3 tools/pixelate.py file photo.jpg -o out --auto-trim          # 검은 테두리 자동 제거
```

확정 사양 **128×74 / 24색**:
`Image.BOX` 축소 → `quantize(MEDIANCUT, dither=NONE)` → 표시할 때 `NEAREST` 정수배 확대.
`pixelate.py` 는 1x 원본만 저장하고 확대는 화면 쪽(`imageRendering: 'pixelated'`) 책임이다.

## 5. 저작권 격리

- 모든 자산이 `app/assets/vr/` **한 폴더**에 있다. 지우면 기능만 조용히 꺼진다.
- 이미지 경로를 아는 코드는 `app/data/vrPoints.ts` 의 `VR_ASSETS` **한 군데뿐**이다.
  절차적 생성으로 바꿀 때 그 함수만 갈아끼우면 된다.
- 자산별 출처 URL·취득일·저작권자는 `app/assets/vr/CREDITS.md`.
- 원본(100MB)은 `.gitignore` 로 git 에서 뺐다. 픽셀화 결과물(약 800KB)만 커밋한다.
- **공개 배포하려면 롯데문화재단 / 예술의전당 사전 허락이 필요하다.**

## 6. 남은 것

- 롯데 A·E·L·R·P·LP·RP 의 열 라벨 (지금 null). 지점 자체는 정확하다.
- 예당 절차적 생성 (360° 원본이 없으므로 장기적으로 필요).
- 편성별 오케스트라 오버레이 — `stageView.ts` 의 `Ensemble` 타입만 잡혀 있고 미구현.
