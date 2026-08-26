# Classic Lions — OCR 평가용 티켓 이미지 데이터셋

한국 클래식/공연 티켓 사진 **18장**과 사람이 직접 눈으로 읽어 작성한 정답지(`eval/ground_truth.json`)로 구성된다.
OCR + 필드 추출 파이프라인의 정확도를 재는 것이 목적이다.

```
testdata/
  _raw_screenshots/   원본 화면 스크린샷 4장 (크롭 소스, 평가에는 쓰지 않음)
  tickets/            평가용 티켓 이미지 18장
  eval/ground_truth.json
  README.md           (이 파일)
```

---

## ⚠️ 이용 주의

이 이미지들은 **공개 웹(구글/다음 이미지 검색 결과, 네이버 블로그·티스토리·인스타그램 등)에서 수집**한 것으로,
**로컬 OCR 테스트 용도로만** 사용하며 **재배포하지 않는다.**
각 이미지의 저작권은 원 게시자에게 있다. 저장소 외부로 내보내거나 공개하지 말 것.

일부 티켓에는 바코드·QR코드·예매번호·휴대폰 번호 일부가 남아 있다(`has_pii: true`, 18장 중 13장).
정답지에 개인정보 문자열 자체는 옮겨 적지 않았다. 로그·스크린샷 공유 시 주의할 것.

---

## 수집 방법

### 1) 화면 스크린샷 크롭 — 10장
`_raw_screenshots/` 의 Safari 전체화면 스크린샷 4장(구글 이미지 검색 "롯데 콘서트홀 티켓 사진", "예술의 전당 티켓")에서
티켓이 선명하게 보이는 영역의 픽셀 좌표를 잡아 PIL 로 잘라냈다. 크롭 후 다시 열어 글자가 읽히는지 눈으로 확인했고,
읽히지 않는 크롭은 좌표를 조정하거나 버렸다.

### 2) 웹 수집 — 8장
`WebSearch`(미국 리전, 한국어 블로그 검색력이 약함)와 Bing 이미지 스크래핑은 한국어 질의에서 결과가 무의미했다.
최종적으로 **Daum 이미지 검색(`search.daum.net/search?w=img`) HTML 을 12개 한국어 질의로 긁어
후보 이미지 URL 647개 → 실제 다운로드 627개 → 콘택트시트로 눈 검수 → 티켓 사진 8장 선별**했다.
네이버 블로그 이미지(`postfiles.pstatic.net`)는 `Referer: https://blog.naver.com/` 을 붙인 `curl -L` 로 받았고,
썸네일 파라미터를 `?type=w2000` 으로 바꿔 원본에 가까운 해상도로 재다운로드했다.

**합성/생성 이미지는 한 장도 없다. 전부 실제 촬영본이다.**

---

## 이미지 목록

| 파일 | 공연장 | 공연 | 공연일 | 난이도 | 형태 | 출처 |
|---|---|---|---|---|---|---|
| `lotte_met_opera_2024.jpg` | 롯데콘서트홀 | 메트로폴리탄 오페라 오케스트라 | 2024-06-20 | easy | 지류 | 스크린샷 크롭 (뉴데일리 기사 이미지) |
| `lotte_sumi_hwang_2016.jpg` | 롯데콘서트홀 | 황수미 & 앙상블 마테우스 | 2016-10-23 | easy | 지류 | 스크린샷 크롭 (네이버 블로그) |
| `lotte_son_yeoleum_2017.jpg` | 롯데콘서트홀 | 손열음의 음.악.편.지.I | 2017-04-22 | medium | 지류 | 스크린샷 크롭 (이데일리 기사) |
| `lotte_korea_russia_30th_2020.jpg` | 롯데콘서트홀 | 한.러수교 30주년 기념 음악회 | 2020-11-12 | hard | 지류 | 스크린샷 크롭 (브런치) |
| `lotte_snuamp_family_2025.jpg` | 롯데콘서트홀 | 서울대AMP총동창회 가족음악회 | 2025-10-21 | easy | 초대권 | 스크린샷 크롭 (당근마켓) |
| `sac_member_concert_2024.jpg` | 예술의전당 콘서트홀 | 2024 예술의전당 회원음악회 | 2024-09-07 | easy | 지류 | 스크린샷 크롭 (네이버 블로그) |
| `sac_opera_highlight_2023.jpg` | 예술의전당 콘서트홀 | (공연명 잘림) | 2023-07-31 | hard | 지류 | 스크린샷 크롭 (티스토리) |
| `sac_new_year_concert_2024.jpg` | 예술의전당 콘서트홀 | 예술의전당과 함께하는 2024 신년콘서트 | 2023-12-30 | medium | 지류 | 스크린샷 크롭 (인스타그램) |
| `sac_musical_gwangju_2022.jpg` | 예술의전당 CJ 토월극장 | 뮤지컬 〈광주〉 | 2022-04-22 | hard | 초대권 | 스크린샷 크롭 (번개장터) |
| `sac_saturday_concert_2023.jpg` | 예술의전당 콘서트홀 | 신세계와 함께하는 2023 토요콘서트(9월) | 2023-09-16 | hard | 지류 | 스크린샷 크롭 (개인 블로그) |
| `lotte_poongwol_humanities_2022.jpg` | 롯데콘서트홀 | 풍월 인문학 콘서트 봄봄 | 2022-04-17 | easy | 지류 | 웹 수집 (네이버 블로그) |
| `sac_park_hyesang_recital_2026.jpg` | 예술의전당 콘서트홀 | 소프라노 박혜상 리사이틀 〈한국가곡 연대기〉 | 2026-07-14 | easy | 지류 | 웹 수집 (네이버 블로그) |
| `sac_symphony_festival_2025.jpg` | 예술의전당 콘서트홀 | 2025 예술의전당 교향악축제 – 수원시립교향악단 | 2025-04-04 | hard | 지류 | 웹 수집 (네이버 블로그) |
| `sejong_harry_potter_2025.jpg` | 세종문화회관 대극장 | 해리 포터와 혼혈 왕자™ 인 콘서트 | 2025-05-18 | medium | 지류 | 웹 수집 (네이버 블로그) |
| `sejong_notre_dame_2025.jpg` | 세종문화회관 대극장 | 노트르담 드 파리 | 2025-09-19 | medium | 지류 | 웹 수집 (네이버 블로그) |
| `sac_cj_towol_dance_2026.jpg` | 예술의전당 CJ 토월극장 | 국립현대무용단 〈내가 물에서 본 것〉 | 2026-06-14 | hard | 지류 | 웹 수집 (네이버 블로그) |
| `sac_shakespeare_in_love_2023.jpg` | 예술의전당 CJ 토월극장 | 셰익스피어 인 러브 | 2023-02-01 | medium | 지류 | 웹 수집 (네이버 블로그) |
| `sejong_beethoven_mobile_2026.jpg` | 세종문화회관 대극장 | 뮤지컬 〈베토벤〉 | 2026-07-24 | easy | 모바일 | 웹 수집 (네이버 블로그) |

웹 수집 8장의 원본 이미지 URL 은 `eval/ground_truth.json` 의 `source` 필드와 아래 목록으로 추적할 수 있다.

<details>
<summary>웹 수집분 원본 URL</summary>

- `lotte_poongwol_humanities_2022.jpg` — `postfiles.pstatic.net/MjAyMjA0MjhfNTMg/...temp_1650377871332.1933062675.jpeg`
- `sac_park_hyesang_recital_2026.jpg` — `postfiles.pstatic.net/MjAyNjA3MjBfMTM2/...SE-22d00faf-710a-4114-9942-59e9aaba851f.jpg`
- `sac_symphony_festival_2025.jpg` — `postfiles.pstatic.net/MjAyNTA0MDZfMzUg/...SE-15bf4281-12bd-11f0-82ba-f9be53b61c05.jpg`
- `sejong_harry_potter_2025.jpg` — `postfiles.pstatic.net/MjAyNTA1MzFfNSAg/...1748691030223.jpg`
- `sejong_notre_dame_2025.jpg` — `postfiles.pstatic.net/MjAyNTExMTBfMjIz/...SE-19283D05-CBE7-4BD4-9690-38B5917B8578.jpg`
- `sac_cj_towol_dance_2026.jpg` — `postfiles.pstatic.net/MjAyNjA2MTRfMTkz/...900_1781446336918.jpg`
- `sac_shakespeare_in_love_2023.jpg` — `postfiles.pstatic.net/MjAyMzAyMDRfMTIy/...SE-6034380C-95A9-4A16-AEA7-4ADDB547C057.jpg`
- `sejong_beethoven_mobile_2026.jpg` — `postfiles.pstatic.net/MjAyNjA3MzBfMTMg/...SE-C5BFDF6B-2063-48E5-ABD9-C9FC76477822.jpg`

</details>

---

## 분포

### 공연장

| 공연장 | 장수 |
|---|---|
| 롯데콘서트홀 | 6 |
| 예술의전당 콘서트홀 | 6 |
| 예술의전당 CJ 토월극장 | 3 |
| 세종문화회관 대극장 | 3 |
| **합계** | **18** |

### 난이도

| 난이도 | 정의 | 장수 |
|---|---|---|
| easy | 정면·선명 | 7 |
| medium | 약간 기울거나 어둡거나 일부 잘림 | 5 |
| hard | 심하게 기울거나 흐림·모자이크·프레임 밖 잘림 | 6 |
| **합계** | | **18** |

### 티켓 형태

| 형태 | 장수 |
|---|---|
| 지류티켓 | 15 |
| 초대권 | 2 |
| 모바일티켓 | 1 |

### 촬영 조건 (중복 카운트)

- 손에 들고 촬영: 10장
- 평평한 바닥/테이블 위: 7장
- 화면 캡처(모바일 티켓): 1장
- 티켓 2장 이상 겹침: 11장
- 원 게시자 모자이크 처리 포함: 5장

---

## 정답지 규칙 (`eval/ground_truth.json`)

- 이미지를 직접 보고 **읽히는 그대로** 적었다. 읽을 수 없으면 `null` + `unreadable_fields` 에 명시했고, **추측해서 채우지 않았다.**
- `unreadable_fields` 에는 흐려서 못 읽은 필드뿐 아니라 **티켓에 애초에 인쇄되지 않은 필드**(초대권의 금액 등)도 포함한다.
- `date` 는 `YYYY-MM-DD` zero-padded. `time` 은 24시간제 `HH:MM`.
- `seat.row` 는 숫자 열이면 정수, 알파벳 열(세종문화회관 `B열` 등)이면 문자열이다.
- `seat.block` 은 예술의전당은 `블록`, 롯데콘서트홀은 `구역` 표기를 파싱한 값이다. 세종문화회관 티켓에는 블록 개념이 없어 `null`.
- 티켓이 여러 장 겹쳐 찍힌 사진(`multi_ticket: true`)은 **가장 앞/가장 완전하게 보이는 티켓 1장**을 기준으로 기록했고,
  어느 장을 기준으로 했는지 `reader_note` 에 적었다.
- 전체 leaf 필드 234개 중 **65개(27.8%)를 `null`** 로 남겼다. 대부분 `artist`(티켓에 별도 연주자 필드가 없음)와
  `gate`(예술의전당·세종문화회관 티켓에는 게이트 표기가 없음)이다.

### 알려진 함정 (파이프라인이 자주 틀리는 지점)

- `sac_new_year_concert_2024.jpg` — 공연명은 "2024 신년콘서트"인데 실제 공연일은 **2023-12-30**이다. 연도를 공연명에서 끌어오면 틀린다.
- `sac_opera_highlight_2023.jpg` — 공연명 윗부분이 잘려 있다. 정답은 `null`이므로, 그럴듯한 공연명을 지어내면 감점 대상이다.
- `lotte_snuamp_family_2025.jpg`, `sac_musical_gwangju_2022.jpg` — 초대교환권이라 좌석/금액이 아예 없다.
- `sejong_*` — 좌석 체계가 `1층 B열 191번`(블록 없음)으로 예술의전당/롯데와 다르다.
- `sac_symphony_festival_2025.jpg` — 공연명 안에 `(4.4)`라는 날짜 조각이 들어 있어 날짜 파서가 혼동하기 쉽다.
