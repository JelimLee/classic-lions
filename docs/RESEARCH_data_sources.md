# 한국 공연 데이터 소스 조사 — Classic Lions

조사일: 2026-08-26
대상: `ARCHITECTURE.md` §3(데이터 모델) / §4-1(추천 품질)의 두 공백
— **[작품 사전]** (`works` 테이블)과 **[실제 공연 후보 풀]** (`concerts` 테이블)

이 문서의 모든 API 스펙·필드·수치는 **실제 호출하거나 1차 문서(PDF/robots.txt/SPARQL)를 열어 확인**한 것이다.
확인하지 못한 것은 §5에 `미확인`으로 분리했다. 추측은 본문에 넣지 않았다.

---

## 1. 요약 — 결론부터

1. **KOPIS는 곡목을 주지 않는다.** 개발가이드 v5.0(2026.04.23 배포) 전문에 `곡목`·`프로그램`·`레퍼토리` 문자열이 **0회**. 공연상세 응답 39개 필드 어디에도 프로그램이 없다. 대신 무료·전국·과거공연 포함·`afterdate` 증분조회를 준다 → **`concerts` 후보 풀의 뼈대로 확정.**
2. **곡목의 실제 출처는 공연장 상세페이지다.** 예술의전당 `show_view?SN=` 페이지는 `1. 프로그램` 절에 **작곡가·곡명·작품번호·악장·INTERMISSION까지 한/영 병기 선택 가능 텍스트**로 싣는다. 과거 공연 32건을 표본 검증한 결과 **페이지 생존 100%, 곡목 기계판독 가능 88%** — 사후 조회가 실제로 작동한다. 그래도 지연·안정성 때문에 일 1회 D1 스냅샷을 권한다.
3. **작품 사전은 Open Opus로 시작한다.** CC0·무인증·덤프 1회 다운로드(3.3MB)로 **작곡가 220명 / 작품 24,975건**을 즉시 확보(실측). 이걸 `works`에 그대로 붓는다.
4. **한↔영 작곡가명 매핑은 Wikidata SPARQL이 답이다.** `rdfs:label@ko` + `skos:altLabel@ko`로 Open Opus 220명 중 **207명(94.1%)** 커버, 그중 114명은 `쇼팽`·`바흐` 같은 **한국 티켓 표기 그대로의 축약형**을 alias로 갖고 있다(실측). 다만 `드보르작` 누락, `슈만`→William Schuman 오매칭 같은 구멍이 있어 **상위 50명 수동 오버라이드 테이블이 필수.**
5. **매칭은 2단계(작곡가 먼저 → 작품)** 가 맞다. 임베딩은 이 규모(2.5만 건)에 과잉이고, 작곡가를 먼저 확정하면 후보가 평균 113건으로 줄어 정규화+퍼지매칭으로 충분하다. 다만 **한국어 부분문자열 매칭은 위험**하다(`골드베르크` 안의 `베르크`가 Alban Berg로 잡힘 — 실측 실패 사례).

---

## 2. KOPIS (공연예술통합전산망)

### 2-1. 신청·인증·비용

| 항목 | 확인 내용 | 출처 |
|---|---|---|
| 운영 주체 | (재)예술경영지원센터 | https://kopis.or.kr/ |
| 신청 경로 | **KOPIS 자체** 신청 폼 (data.go.kr은 LINK형 미러) | https://kopis.or.kr/por/cs/openapi/openApiUseSend.do?menuId=MNU_00074 |
| data.go.kr 미러 | `예술경영지원센터_공연예술통합전산망_DB검색_공연목록` — **비용: 무료 / 이용허락범위: 제한 없음 / 데이터포맷: XML** (페이지 원문) | https://www.data.go.kr/data/15097805/openapi.do |
| 인증 방식 | 쿼리스트링 `service={인증키}`. HTTP(비-SSL). 개발가이드 표기: `전송레벨암호화 [O] 없음` | 개발가이드 v5.0 p.1 |
| 키 발급 제약 | "인증키는 **1인당 1개**만 발급되며, 타인에게 양도 및 공유 불가", "인증키 발급은 **PC에서만** 가능" | https://kopis.or.kr/por/cs/openapi/openApiInfo.do (2022 아카이브 스냅샷) |
| **출처 표시 의무** | "KOPIS에 의거하여 개발된 프로그램 또는 서비스라는 점을 **반드시 명시**하여야 합니다. 예시) 출처: (재)예술경영지원센터 공연예술통합전산망(www.kopis.or.kr)" — **미명시 시 서비스 중단 가능** | 같은 페이지 |
| 호출 제한 | "발급받은 인증키는 **쿼리에 제한이 있을 수 있으며**, 이를 초과할 경우 서비스가 중지됩니다" — **구체적 일일 건수는 문서에 없음** | 같은 페이지 / 개발가이드 |
| 요청당 제한 (문서 명시) | **조회 기간 최대 31일**, **페이지당 최대 100건** | 개발가이드 v5.0, 전 서비스 공통 |

> data.go.kr의 "신청 가능 트래픽"란은 `해당 기관의 정책에 따라 트래픽 수는 상이 할 수 있음` 이라고만 적혀 있다. **일일 호출 상한 수치는 공개 문서에 존재하지 않는다.** (§5 미확인)

**엔드포인트 생존 확인 (키 없이 실제 호출):**
```
$ curl "http://kopis.or.kr/openApi/restful/pblprfr?service=TESTKEY&stdate=20260801&eddate=20260831&cpage=1&rows=5"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dbs><db><returncode>02</returncode>
<errmsg>SERVICE KEY IS NOT REGISTERED ERROR</errmsg>
<responsetime>2026-08-26 17:48:16</responsetime></db></dbs>
```
엔드포인트·파라미터명·XML 포맷·에러코드 체계 모두 실물로 확인됨.

### 2-2. 제공 엔드포인트 전체 (개발가이드 v5.0, 18종)

가이드 PDF 원본: `https://kopis.or.kr/upload/openApi/공연예술통합전산망OpenAPI개발가이드.pdf`
(32p, 최종 서비스 버전 **5.0**, 배포일자 **2026.04.23** — 라이브 다운로드로 확인)

| # | 서비스 | URL |
|---|---|---|
| 1 | 공연목록 조회 | `/openApi/restful/pblprfr` |
| 2 | **공연 상세 조회** | `/openApi/restful/pblprfr/{공연ID}` |
| 3 | 공연시설 목록 | `/openApi/restful/prfplc` |
| 4 | 공연시설 상세 | `/openApi/restful/prfplc/{공연시설ID}` |
| 5 | 기획/제작사 목록 | `/openApi/restful/mnfct` |
| 6 | 수상작 목록 | `/openApi/restful/prfawad` |
| 7 | 축제 목록 | `/openApi/restful/prffest` |
| 8 | 원·창작자 목록 | `/openApi/restful/prfper` |
| 9 | 예매상황판 | `/openApi/restful/boxoffice` |
| 10~13 | 예매통계 기간별/장르별/시간대별/가격대별 | `/boxStats`, `/boxStatsCate`, `/boxStatsTime`, `/boxStatsPrice` |
| 14~18 | 공연통계 기간별/지역별/장르별/공연별/공연시설별/가격대별 | `/prfstsTotal`, `/prfstsArea`, `/prfstsCate`, `/prfstsPrfBy`, `/prfstsPrfByFct`, `/prfstsPrice` |

### 2-3. ⚠ 핵심 답변 — 곡목(프로그램)을 주는가? **아니오.**

**공연상세(`pblprfr/{id}`) 응답 필드 전체** (개발가이드 v5.0 p.4~5 원문 그대로):

```
mt20id 공연ID          prfnm 공연명           mt10id 공연시설ID      mt13id 공연장ID
fcltynm 공연시설명       frstregdt 최초등록일    prfpdfrom 공연시작일    prfpdto 공연종료일
prfcast 공연출연진       prfcrew 공연제작진      prfruntime 공연 런타임   prfage 공연 관람 연령
entrpsnm 기획제작사      entrpsnmP 제작사        entrpsnmA 기획사        entrpsnmH 주최
entrpsnmS 주관          pcseguidance 티켓가격   poster 포스터이미지경로  sty 줄거리
area 지역              genrenm 공연장르명      openrun 오픈런          visit 내한
child 아동             daehakro 대학로         festival 축제           musicallicense 뮤지컬 라이센스
musicalcreate 뮤지컬 창작 updatedate 최종수정일  prfstate 공연상태        dtguidance 공연시간
styurls > styurl 소개이미지1~4                relates > relatenm/relateurl 예매처명·URL
```

**검증 방법**: 가이드 PDF 32페이지 전문을 텍스트 추출 후
`grep -E '곡목|프로그램|레퍼토리|악곡|repertoire|program'` → **매치 0건.**

당신의 예상이 맞다. 공연명·출연진(`prfcast`)·기간·장르·포스터·티켓가격은 주지만 **곡목은 없다.**

다만 두 개의 우회로가 응답 안에 있다:
- **`styurls` (소개이미지 1~4)** — 클래식 공연은 이 소개이미지가 곧 **프로그램이 박힌 홍보 이미지**인 경우가 많다. 즉 곡목이 **이미지 안에** 있을 수 있다 → 이미 OCR 파이프라인이 있으므로 재활용 가능. (실제 클래식 공연에서의 곡목 포함률은 §5 미확인 — 키 발급 후 표본 조사 필요)
- **`relates` (예매처 URL)** — `booking_url` 컬럼에 그대로 매핑된다.
- `sty`(줄거리)는 연극·뮤지컬용 필드. 클래식에서 채워지는지는 미확인.

### 2-4. 장르 분류 체계 — 클래식/양악 구분

**1차 출처**: `공연예술통합전산망OpenAPI공통코드.pdf` (57p) p.1
다운로드: `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002498713&fileDetailSn=1`

```
장르 코드   변수명: shcate   필드명: genrenm
  AAAA  연극(연극)
  AAAB  연극(뮤지컬)
  BBBA  무용(무용)
  CCCA  음악(클래식)     ← 이것
  CCCB  음악(오페라)
  CCCC  음악(국악)
  EEEA  복합(복합)
```

**주의 1 — 요청 코드와 응답 문자열이 다르다.** 요청은 `shcate=CCCA`지만, 응답 `genrenm`에 실제로 담기는 문자열은 공식 예제 기준 **`서양음악(클래식)`**, `한국음악(국악)`, `대중음악`, `연극` 이다. 코드표의 `음악(클래식)`과 표기가 불일치하므로 **`genrenm` 문자열 파싱에 의존하지 말고 요청 시 `shcate=CCCA`로 필터**하는 게 안전하다.

**주의 2 — `대중음악`이라는 응답 값이 코드표에 없다.** 코드표 7종에 매핑되지 않는 장르명이 응답에 나온다. 즉 **코드표가 응답 값의 완전집합이 아니다.**

**주의 3 — 클래식 하위 구분이 없다.** 독주/실내악/교향악/성악을 KOPIS는 구분하지 않는다. 전부 `CCCA` 하나다. (예술의전당은 구분한다 — §3-2)

**예매상황판용 별도 코드** (`catecode`): `CCCA|CCCB` = **클래식/오페라**로 묶여 있음.

### 2-5. 좌석 등급·가격

- **`pcseguidance` (티켓가격)** — 구조화되지 않은 **자유 문자열**이다. 예: `전석 30,000원`.
  → `ARCHITECTURE.md` §3의 `price_min INTEGER / price_max INTEGER`에 넣으려면 **파서가 필요**하다.
  실제 관측된 형태(예술의전당 데이터 기준): `R석 110,000원 / S석 90,000원 / A석 70,000원 / B석 40,000원 / C석 20,000원`
  → 정규식 `/([가-힣A-Z]+석)\s*([\d,]+)\s*원/g` 로 등급별 추출 후 min/max 계산 권장.
- **좌석 수는 공연시설상세(`prfplc/{id}`)의 `seatscale`** 에 있다. 공연 단위가 아니라 **공연장 단위**다.
- 예매상황판 요청 파라미터 `srchseatscale`는 규모 버킷: `0(미상) / 100(1~300석) / 300(300~500석) / 500(500~1000석) / 1000(1000~5000석) / 5000(5000~10000석) / 10000(10000석 이상)`.
  → 이건 `ARCHITECTURE.md` 피드백 신호의 `"scale":{"recital":1}` 을 **객관 데이터로 대체**할 수 있는 좋은 재료다.

### 2-6. 과거 공연 조회 / 갱신 / 배치 설계

- **과거 공연 조회 가능.** `prfstate` 코드: `01 공연예정 / 02 공연중 / 03 공연완료`. 개발가이드 공식 예제가 2016년 날짜로 `공연완료` 레코드를 반환한다. → **사용자가 몇 달 전 관람한 공연도 KOPIS에서 조회·매칭 가능**하다. 티켓 OCR 결과를 KOPIS `mt20id`에 붙이는 경로가 열린다.
- **v5.0의 결정적 파라미터: `afterdate`** — "해당일자 이후 등록/수정된 항목만 출력". 전량 재수집 없이 **증분 동기화**가 가능하다. `ARCHITECTURE.md` §2-1의 "KOPIS API 일 1회 배치(Queues)"는 이걸 쓰면 된다.
- **갱신 주기** — KOPIS 자체 문서에 명시 없음(§5 미확인). `updatedate`(최종수정일) 필드로 레코드 단위 판단 가능.
- **배치 산식**: 조회 기간 31일 상한 + 페이지당 100건 → 클래식(`shcate=CCCA`) 전국 1개월치를 훑으려면 월당 수십 회 호출. 일 1회 `afterdate=어제` 증분이면 훨씬 적다.

---

## 3. 대안·보완 공연 정보 소스

### 3-1. 인터파크 / 예스24 / 멜론티켓 — **셋 다 공개 API 없음. 스크래핑 권하지 않는다.**

| 플랫폼 | 공개 API | robots.txt | 약관상 자동수집 금지 조항 |
|---|---|---|---|
| 인터파크 티켓 (NOL) | **없음.** `shop.interpark.com`의 "인터파크 표준 API"는 **쇼핑몰 판매자용**(주문·재고)이며 공연과 무관 | `tickets.interpark.com/robots.txt` = **화이트리스트**. Googlebot/Yeti/DAUM/Twitterbot/facebookexternalhit만 Allow, 그 외 `User-agent: * / Disallow: /` | **있음, 매우 명시적** |
| 예스24 공연 | **없음.** 개발자 포털·파트너 API 문서 부재 | `ticket.yes24.com/robots.txt` **부재**(에러페이지 반환). 부모 도메인 `www.yes24.com/robots.txt`는 다수 봇 차단 | **미확인** (SPA라 약관 본문 취득 실패) |
| 멜론티켓 | **없음.** Kakao Developers에 Melon 제품 없음. "MLCP"는 사업 제휴 프로그램 | `ticket.melon.com/robots.txt` **404**. 부모 `www.melon.com/robots.txt` = `Allow: /global-k-chart` 외 전부 `Disallow: /` | 재생횟수 조작 맥락 한정, 일반 크롤링 금지는 아님 |

**인터파크 이용약관 제23조(이용자의 의무) (15) 원문**
(https://policy.yanolja.com/pf/policy/service?service=interpark — https://nol.interpark.com/terms.html 의 iframe 원본):

> (15) 회사의 명시적인 사전 서면 허가 없이 데이터 등을 추출하기 위하여 로봇(봇), 크롤러, 스파이더, 스크레이퍼, 매크로 프로그램 또는 기타 자동화 수단이나 수동 프로세스를 이용하여 회사의 서비스 및 서버에 접근하거나 회사 서비스에 포함된 콘텐츠 및 정보를 모니터링, 복제, 수집, 확인, 정리, 사용하는 등의 행위

**법적·실무적 위험 (솔직하게)**
- 인터파크는 robots.txt **와** 계약(약관) 양쪽에서 금지한다. "사전 **서면** 허가"를 요구하므로 "예의 바른 레이트리밋이었다"는 항변이 성립하지 않는다. 별도로 부정이용 규제 페이지도 운영한다.
- 예스24 공연은 모든 경로에 **834바이트 SPA 셸**만 반환하고 `<meta name="robots" content="noindex">`가 붙어 있다. 긁으려면 헤드리스 브라우저 + 내부 XHR 역공학이 필요한데, 이는 기술적 회피로 읽힐 소지가 크다.
- 멜론은 부모 도메인이 사실상 전면 `Disallow: /`다.
- 한국법상 별개로 **저작권법 제93조(데이터베이스제작자의 권리)** 와 **부정경쟁방지법 제2조 제1호 (파)목(성과 도용)** 이 적용될 여지가 있다. 실제 국내 판례에서 경쟁 서비스 목적의 대량 크롤링이 문제된 사례가 있다. (구체적 판례 검토는 §5 미확인 — 법률 자문 영역)

**결론: 이 세 곳을 긁는 설계는 하지 않는다.** KOPIS가 존재하는 이유가 정확히 이것이다 — 이 플랫폼들의 예매 데이터를 **합법적으로 집계해 재배포**하는 국가 전산망이다. 같은 데이터를 정당한 경로로 얻을 수 있다.

### 3-2. 예술의전당 — **RSS/iCal 없음. 그러나 내부 JSON 엔드포인트가 열려 있고, 상세페이지에 곡목이 있다.** ⭐

이 절이 이 조사에서 가장 중요하다.

**(a) robots.txt — 일정 경로는 금지되어 있지 않다**
`https://www.sac.or.kr/robots.txt` 전문:
```
User-agent: *
Disallow: /search/
Disallow: /site/main/file/
Disallow: /upload/
```
일정·상세 경로(`/site/main/program/*`, `/site/main/show/*`)는 Disallow 대상이 **아니다**.

**(b) RSS/iCal** — `https://www.sac.or.kr/rss` → **404**. 일정 페이지에 `.ics`/`webcal` 링크 없음. **피드는 없다.**

**(c) 월간 일정 JSON — 직접 호출로 확인**
```
POST https://www.sac.or.kr/site/main/program/getProgramCalList
Content-Type: application/x-www-form-urlencoded
searchYear=2026&searchMonth=10&searchFirstDay=1&searchLastDay=31&CATEGORY_PRIMARY=
```
→ `200 application/json;charset=UTF-8`, **284,692 bytes, 238건** (2026년 10월분)

실측 장르 분포 (`CATEGORY_SECONDARY_NAME`):
```
전시 97 | 클래식 79 | 독주 23 | 뮤지컬 13 | 실내악 7 | 성악 3 | 오페라 3
연극 3 | 발레 3 | 무용 3 | 합창 1 | (null) 3
```
**KOPIS보다 장르 해상도가 높다** — 독주/실내악/성악/합창을 구분한다. `ARCHITECTURE.md`의 취향 프로필에서 "리사이틀 선호 / 실내악 선호"를 잡을 때 이 값이 KOPIS `CCCA` 단일 코드보다 훨씬 유용하다.

실제 레코드 (실측):
```json
{"PROGRAM_SUBJECT":"피아니스트 임동혁과 함께하는 차이코프스키",
 "PROGRAM_SUBJECT_ENG":"Tchaikovsky with Pianist Lim Dong-hyuk",
 "CATEGORY_SECONDARY_NAME":"클래식","PLACE_NAME":"콘서트홀",
 "BEGIN_DATE":"2026.10.22","END_DATE":"2026.10.22",
 "PRICE_INFO":"R석 110,000원 / S석 90,000원 / A석 70,000원 / B석 40,000원 / C석 20,000원",
 "HOMEPAGE_CONTACT_TIME":"90","TICKET_OPEN_DATE":"...","SALE_STATE_CODE_NAME":"예매",
 "SN":"84095","PROGRAM_CODE":"..."}
```
전체 41개 필드에 한/영 병기 제목, 홀 이름, 러닝타임(분), 가격 등급, 티켓오픈일, 판매상태가 들어 있다.

**(d) 상세페이지에 곡목이 텍스트로 있다 — 실측 확인** ⭐⭐

`https://www.sac.or.kr/site/main/show/show_view?SN=84095` (위 레코드의 SN)
→ `200`, 438,786 bytes. `작품소개` 탭 본문에서 **선택 가능한 HTML 텍스트**로 다음을 그대로 확보:

```
1. 프로그램
P. Tchaikovsky-Piano Concerto No.1 B-Flat minor Op.23 / 피아노 임동혁
차이코프스키-피아노 협주곡 내림나단조 작품23
  I. Allegro non troppo e molto maestoso
  II. Andantino semplice
  III. Allegro con fuoco

INTERMISSION

P. Tchaikovsky-Symphony No.4 in f minor Op.36 / 뉴서울필하모닉
차이코프스키-교향곡 제4번 바단조 작품36
  Ⅰ. Andante sostenuto-Moderato con anima
  ...
```

**여기에 필요한 게 전부 있다**: 작곡가(한/영), 곡명(한/영), 조성, 작품번호(`Op.23` / `작품23`), 악장, 협연자 배정, 인터미션 위치. 이미지가 아니라 **텍스트**다.

이것이 `concert_program.raw_text`를 채우는 **1순위 소스**이고, 동시에 §4 매칭 로직의 최고 품질 학습·평가 데이터다.

**(e) 과거 공연 페이지는 살아남는다 — 32건 표본 실측** ✅

임의의 SN(30000/50000/70000 등)으로 찔러보면 에러페이지나 메인 리다이렉트가 나오지만, 이는 **존재하지 않는 SN**일 뿐이다. `getProgramCalList`로 **실제 과거 SN**을 받아 검증했다.

과거 월 조회도 정상 동작한다 (`SALE_STATE_CODE_NAME: "종료"`, ENG: `"Past Event"`):
```
2024-10  전체 319건 / 클래식·독주·실내악 96건
2025-05  전체 264건 / 104건
2025-11  전체 217건 / 96건
2026-03  전체 222건 / 92건
```

이 4개월에서 무작위 추출한 **32건**의 `show_view` 페이지를 실제로 받아 측정:

| 지표 | 결과 |
|---|---|
| 페이지 생존 (HTTP 200 + `작품소개` 본문 존재) | **32/32 = 100%** |
| 본문에서 작곡가명 검출 (§4-2 한국어 인덱스 582종 사용) | **30/32 = 94%** |
| 작품번호 검출 (`Op.` / `작품NN` / `BWV` / `K.` / `D.`) | **28/32 = 88%** |
| **곡목으로 판단 가능** (작곡가 + 형식어 또는 작품번호) | **28/32 = 88%** |

즉 **1년 반 전 공연도 곡목이 그대로 남아 있고, 그중 88%가 기계 판독 가능하다.** 사용자가 몇 달 전 티켓을 찍어도 `show_view` 사후 조회가 실제로 작동한다.

실패한 4건은 페이지 소멸이 아니라 **본문 형식**이 원인이었다 — 곡목을 이미지로만 올렸거나, 산문형 소개만 있는 경우다.

> **그래도 스냅샷은 한다.** 사후 조회가 되는 것과 그것에 의존하는 것은 다르다. (a) 티켓 등록 시점에 외부 HTTP를 때리면 지연이 붙는다 — `ARCHITECTURE.md` §4-4의 TTFT 목표와 충돌한다. (b) `getProgramCalList`로 이미 매일 일정을 받으므로 신규 SN의 본문을 같이 받는 **증분 비용이 거의 0**이다. (c) 정책 변경 시 과거 데이터가 통째로 날아가는 위험을 없앤다.
> → **일 1회 배치로 신규 SN 본문을 D1에 스냅샷하고, 캐시 미스일 때만 실시간 조회로 폴백.**

**(f) 공식성에 대한 정직한 평가**
`getProgramCalList`는 **문서화된 공개 API가 아니라 웹페이지가 쓰는 내부 엔드포인트**다. 버전 보장·안정성 보장이 없고 예고 없이 바뀔 수 있다. robots.txt가 금지하지 않고 약관에서 크롤링 금지 조항을 찾지 못했으나(§5), **공식 API처럼 취급하면 안 된다.** 예의 있는 레이트리밋(일 1회 배치, 상세는 신규 건만), User-Agent 명시, 실패 시 폴백을 반드시 둔다.

또한 `일정 엑셀다운로드` 메뉴(`/site/main/program/getProgramCalListExcel`)가 존재한다 — 사람이 쓰라고 만든 공식 내보내기 경로다. 비인증 GET은 에러 페이지를 반환했다(§5 미확인).

### 3-3. 롯데콘서트홀 — **아무것도 없다**

- `robots.txt`: `www.lotteconcerthall.com`, `lotteconcerthall.com` 모두 **404** (robots 파일 자체가 없음)
- RSS / iCal: 메인 및 월간일정 페이지 전문 검색 결과 `rss`·`.ics`·`webcal` **0건**
- JSON 엔드포인트: 노출 없음. Vue + vue-router SPA이며 페이지 소스의 XHR은 L.Point SSO/멤버십 호출뿐
- 콘텐츠 ID가 **암호화된 불투명 토큰** (`/home/ko/display/region/content/JSVFSGpkUzVBaHYzUmMrZElSU3BxcERUVHFNUlk3bzZMYytkVXJtOXJqdEZaZz0`)
- data.go.kr 데이터셋 **없음** (민간 시설이라 공공데이터 대상 아님)

**→ 롯데콘서트홀은 KOPIS를 통해 간접 확보한다.** 유료 티켓 공연이므로 KOPIS에 반드시 집계된다. KOPIS 공통코드 PDF에서 공연시설 ID 확인: **`FC001513` = 롯데콘서트홀** (참고: **`FC000001` = 예술의전당**). 이 ID로 `prfplccd` 필터링이 가능하다.

곡목은 KOPIS에서 안 나오므로, 롯데콘서트홀 공연의 곡목은 §6의 폴백(사용자 입력 / 소개이미지 OCR)에 의존한다. **예술의전당 대비 품질 격차가 구조적으로 생긴다** — 이건 제품 설계에서 인정하고 가야 한다.

### 3-4. 서울 열린데이터광장 `culturalEventInfo` — 보완재, 단 기대는 낮춰야 한다

- 데이터셋: https://data.seoul.go.kr/dataList/17/literacyView.do
- **인증키 없이 되는 샘플 엔드포인트**: `http://openapi.seoul.go.kr:8088/sample/json/culturalEventInfo/1/5/` (직접 호출 확인, `list_total_count: 19498`)
- 24개 필드: `CODENAME, GUNAME, TITLE, DATE, PLACE, ORG_NAME, USE_TRGT, USE_FEE, INQUIRY, PLAYER, PROGRAM, ETC_DESC, ORG_LINK, MAIN_IMG, RGSTDATE, TICKET, STRTDATE, END_DATE, THEMECODE, LOT, LAT, IS_FREE, HMPG_ADDR, PRO_TIME`

**`PROGRAM` 필드에 대한 정직한 평가 — 곡목 리스트가 아니다.**
샘플 5건 실측 결과 **`PROGRAM`이 채워진 건 2/5**, 그 내용도 곡목 나열이 아니라 **홍보 산문**이었다:
> `"Let It Snow, White Christmas 등 크리스마스 캐롤 명곡을 피아노, 콘트라베이스, 드럼의 일본 재즈 트리오 연주로 듣는 공연"`

**`PROGRAM`을 곡목 소스로 신뢰하면 안 된다.** (샘플 키가 5행으로 제한돼 전체 충전율은 §5 미확인)

**진짜 가치는 `ORG_LINK`다** — 인터파크 예매 URL(`https://tickets.interpark.com/goods/26010350`)을 공공데이터가 그대로 준다. 인터파크를 긁지 않고 딥링크를 얻는 정당한 경로다. `LAT`/`LOT`(좌표), `MAIN_IMG`(포스터), `PLAYER`(출연진), `PRO_TIME`(공연시각)도 유용하다.

**한계**: 서울시 한정. `CODENAME` 관측값은 `콘서트`/`연극`/`전시,미술` 등으로, **`클래식` 전용 분류가 있는지 미확인**(§5).

### 3-5. 기타 공공데이터

| 데이터셋 | 형식 | 라이선스 | URL |
|---|---|---|---|
| 문화체육관광부_공연 정보(예술의 전당) — 10개 기관 집계 | XML | 무료, **공공누리 제1유형(출처표시)** | https://www.data.go.kr/data/15056881/openapi.do |
| 문화체육관광부_문체부 기관 공연정보 | JSON+XML | 무료, **이용허락범위 제한 없음** | https://www.data.go.kr/data/15105238/openapi.do |
| 서울시 세종문화회관 공연 및 전시 정보 (2011~) | 서울 열린데이터광장 | **공공누리 제1유형** | https://data.seoul.go.kr/dataList/OA-2708/S/1/datasetView.do |
| 국립극장 공연정보 (파일) | 파일 | — | https://www.data.go.kr/data/3034757/fileData.do |
| KOPIS 공연별 통계 | XML | 무료, 제한 없음 | https://www.data.go.kr/data/15097847/openapi.do |

### 3-6. 네이버 / 카카오 검색 API — **공연 버티컬이 없다. 후보 풀 소스로 못 쓴다.**

**네이버 검색 API**
- 일일 호출 한도: **25,000회** — 공식 문서 원문: *"블로그 검색은 검색 API를 사용하며, 검색 API의 하루 호출 한도는 25,000회입니다."*
  https://developers.naver.com/docs/serviceapi/search/blog/blog.md
  (검증 가능 원본: https://raw.githubusercontent.com/naver/naver-openapi-guide/master/ko/service-apis/search/blog/blog.md)
- **중요: 25,000회는 검색 API 전체가 공유하는 풀**이다. 엔드포인트별이 아니다.
- 엔드포인트 전체: `news, encyc, blog, shop, webkr, image, doc, kin, book, cafearticle, adult, errata, local`
  (https://raw.githubusercontent.com/naver/naver-openapi-guide/master/ko/apilist.md)
- **공연/전시/행사 엔드포인트는 현재 존재하지 않는다.** 과거에 있었으나 지금 목록에 없다.
- 실효성: `local`(지역검색)로 **공연장 메타데이터 보강**(주소·좌표), `blog`/`news`로 **공연 후기·평판 신호** 수집은 가능. **일정 소스는 아니다.**

**카카오(Daum) 검색 API**
- 공식 쿼터 문서: https://developers.kakao.com/docs/latest/ko/getting-started/quota
- 일간: **Daum 검색 합계 50,000건**, 하위 버티컬(웹문서/동영상/이미지/블로그/책/카페) 각 **30,000건**
- 월간: 전체 API **3,000,000건** (문서 주석: `* 쿼터는 추후 변경될 수 있습니다`)
- 엔드포인트: 웹문서·동영상·이미지·블로그·책·카페 — **공연/행사 버티컬 없음**
- 참고로 **카카오맵 REST API**는 주소↔좌표 변환·키워드 장소검색이 각 **일 100,000건**으로, 공연장 지오코딩 예산은 네이버보다 훨씬 넉넉하다.

**결론**: 두 검색 API 모두 **후보 풀 소스가 아니라 보강 레이어**다. `ARCHITECTURE.md` §4-1의 하이브리드 검색에서 이들을 후보 생성에 쓰면 안 된다.

---

## 4. 클래식 작품 사전(`works`) 구축 방법

### 4-0. 네 소스 비교 (전부 실제 호출/문서 확인)

| | **Open Opus** | **MusicBrainz** | **Wikidata** | **IMSLP** |
|---|---|---|---|---|
| 라이선스 | **CC0** (사이트 명시) | **CC0** (core data: work/artist/relationship) | **CC0** | CC BY-SA 4.0 *추정* — 명시 문장 미확인, ToS 페이지 자체 없음 |
| 인증 | **불필요** | 불필요 (UA 필수) | 불필요 | 불필요 |
| 벌크 취득 | **`/work/dump.json` 3.3MB 1회** ⭐ | `work.tar.xz` **656MB**, `artist.tar.xz` 2.0GB (주 2회 갱신) | SPARQL (60초 타임아웃) | 덤프 없음. worklist API 1000건 페이징 |
| 규모 | 작곡가 **220** / 작품 **24,975** | 작품 수십만 | 전체 | 작품 **25만+** |
| 작곡가 | ✅ | ✅ (`inc=artist-rels` 필수) | ✅ | ✅ |
| **시대(era)** | ✅ **`epoch` 필드 내장** ⭐ | ❌ | △ (movement/genre 속성, 불균일) | △ `Piece Style=Romantic` (wikitext) |
| opus | △ 제목 문자열에 포함 | ❌ 필드 없음, 제목 파싱 | △ | ✅ `Opus/Catalogue Number=Op.23` |
| 악기 | △ `genre` 5분류 + 제목 | ❌ **work 레벨에 없음** | △ | ✅ **`Category:For piano`** ⭐ |
| **한국어 작곡가명** | ❌ | △ **아티스트 alias만** (`쇼팽`,`베토벤` 등) | ✅ **label+altLabel** ⭐ | ❌ 전무 |
| **한국어 곡명** | ❌ | ❌ | △ 유명작 일부만 | ❌ |
| rate limit | 문서 없음. CDN 캐시(BunnyCDN), `access-control-allow-origin: *` | **1 req/s**, 초과 시 503 | 60초/쿼리 | robots.txt **Crawl-delay: 2** |

### 4-1. Open Opus — **1순위. 여기서 시작한다** ⭐

- 사이트: https://openopus.org/ — *"All Open Opus data is in the public domain… and can be freely used"*, **CC0**, **가입 없음**
- **전체 덤프 실측**: `https://api.openopus.org/work/dump.json` → HTTP 200, **3,324,775 bytes**
  → 작곡가 **220명**, 작품 **24,975건**. 한 번 받아서 `works` 테이블에 그대로 부으면 된다.
- 응답 헤더 실측: `cache-control: max-age=3600, public`, `access-control-allow-origin: *`, BunnyCDN 캐싱. **레이트리밋 헤더 없음.**

**작곡가 레코드 실측:**
```json
{"id":"152","name":"Chopin","complete_name":"Frédéric Chopin",
 "birth":"1810-01-01","death":"1849-01-01","epoch":"Romantic",
 "portrait":"https://assets.openopus.org/portraits/72753742-1568084874.jpg"}
```

**작품 레코드 실측:**
```json
{"title":"Preludes, op. 28","subtitle":"","searchterms":"",
 "popular":"1","recommended":"1","id":"17276","genre":"Keyboard"}
```

**엔드포인트 (전부 무인증, 직접 호출 확인)**
| 용도 | URL |
|---|---|
| 전체 덤프 | `https://api.openopus.org/work/dump.json` |
| 인기 작곡가(23명) | `https://api.openopus.org/composer/list/pop.json` |
| 전체 작곡가(220명) | `https://api.openopus.org/composer/list/epoch/all.json` |
| 이름 프리픽스 | `https://api.openopus.org/composer/list/name/A.json` |
| 작곡가별 작품 | `https://api.openopus.org/work/list/composer/{id}/genre/all.json` |
| **통합 검색** | `https://api.openopus.org/omnisearch/{query}/{offset}.json` |

`omnisearch` 실측 — `chopin prelude` 검색:
```json
{"results":[
 {"composer":{"id":"152","complete_name":"Frédéric Chopin","epoch":"Romantic"},"work":null},
 {"composer":{...},"work":{"id":"17276","title":"Preludes, op. 28","genre":"Keyboard","popular":"1"}},
 {"composer":{...},"work":{"id":"17243","title":"Prelude in A flat major, B.86","genre":"Keyboard"}}]}
```

**⚠ `genre` 필드에 대한 정정 — 5종뿐이고 협주곡 분류가 없다**

24,975건 전수 집계 실측:
```
Vocal 8,509 | Keyboard 5,266 | Orchestral 5,120 | Chamber 4,806 | Stage 1,274
```
**`Concerto`도 `Solo`도 없다.** 협주곡은 전부 `Orchestral`에 들어간다 (Orchestral 5,120건 중 제목에 `Concerto` 포함 **1,472건 = 28.7%**, `Symphony` 834건 = 16.3%).

→ `works.instrument`를 Open Opus `genre`로 채우면 "피아노 협주곡"과 "교향곡"이 같은 값이 된다. **제목 키워드 분류기를 반드시 얹어야 한다** (§4-5).

### 4-2. Wikidata — **한↔영 작곡가명 매핑의 정답** ⭐⭐

이 조사에서 가장 실용적인 결과다. 실제 SPARQL을 돌려 측정했다.

**전체 규모 (실측)**
```sparql
SELECT (COUNT(DISTINCT ?c) AS ?n) WHERE { ?c wdt:P106 wd:Q36834 }
→ 133,675   (작곡가 전체)

SELECT (COUNT(DISTINCT ?c) AS ?n) WHERE {
  ?c wdt:P106 wd:Q36834 . ?c rdfs:label ?ko . FILTER(LANG(?ko)="ko") }
→ 9,756     (한국어 라벨 보유, 7.3%)

# 하위분류(P279*)까지 포함하면
?c wdt:P106/wdt:P279* wd:Q36834 → 14,512
```
전체 7.3%는 낮아 보이지만, **한국 공연에 나오는 유명 작곡가는 거의 전부 커버된다** — 아래 실측 참조.

**⚠ 함정 1 — `rdfs:label@en`을 조인 키로 쓰면 모차르트가 빠진다 (실측 확인)**

`wbgetentities` 로 Q254(Wolfgang Amadeus Mozart) 직접 조회:
```json
{"Q254":{"labels":{"ko":{"value":"볼프강 아마데우스 모차르트"}},
         "aliases":{"ko":[{"value":"모차르트"},{"value":"모짜르트"}],
                    "en":["Wolfgang Amadè Mozart", ...]}}}
```
**영어 `labels`가 비어 있다.** `?c rdfs:label ?en . FILTER(LANG(?en)="en")` 조건을 걸면 **모차르트가 결과에서 사라진다.**

→ **해결: 영어 쪽 키는 `rdfs:label@en`이 아니라 enwiki 사이트링크를 써야 한다.**
```sparql
?art schema:about ?c ;
     schema:isPartOf <https://en.wikipedia.org/> ;
     schema:name ?enwiki .
```

**커버리지 실측 — Open Opus 220명 대비**

| 조인 방식 | 커버리지 |
|---|---|
| `rdfs:label@en` 정확 일치 | 192 / 220 = **87.3%** (Mozart·Haydn·Mussorgsky 등 28명 누락) |
| **enwiki 사이트링크 + 성(surname) 폴백** | **207 / 220 = 94.1%** |
| 그중 한국어 축약형 alias 보유 | **114명** |

누락된 13명(전부 마이너): Guarnieri, Corigliano, Daugherty, Dufay, Holmboe, Lassus, Lopes-Graça, Lutosławski, Mignone, Moeran, Rorem, Sweelinck, Taverner

**최종 쿼리 (그대로 쓸 수 있음, 실행 확인 — 11,816행 / 5.1MB / 60초 내)**
```sparql
SELECT ?c ?enwiki ?ko (GROUP_CONCAT(DISTINCT ?alt;separator="|") AS ?alts) WHERE {
  ?c wdt:P106/wdt:P279* wd:Q36834 .
  ?c rdfs:label ?ko . FILTER(LANG(?ko)="ko")
  ?art schema:about ?c ;
       schema:isPartOf <https://en.wikipedia.org/> ;
       schema:name ?enwiki .
  OPTIONAL { ?c skos:altLabel ?alt . FILTER(LANG(?alt)="ko") }
} GROUP BY ?c ?enwiki ?ko
```
엔드포인트: `https://query.wikidata.org/sparql`
(`Accept: application/sparql-results+json`, **User-Agent 필수**, 쿼리당 60초 제한)

**⭐ 핵심 발견: `skos:altLabel@ko`가 한국 티켓 표기 그대로다**

한국 티켓은 `프레데리크 쇼팽`이 아니라 **`쇼팽`** 이라고 쓴다. Wikidata의 한국어 alias가 정확히 그 축약형을 담고 있다 (실측):
```
Johann Sebastian Bach → 요한 제바스티안 바흐  [alt: J. S. 바흐 | 바흐]
Ludwig van Beethoven  → 루트비히 판 베토벤    [alt: 베토벤]
Frédéric Chopin       → 프레데리크 쇼팽        [alt: 쇼팽]
Johannes Brahms       → 요하네스 브람스        [alt: 브람스]
Tchaikovsky           → 표트르 차이콥스키      [alt: 표트르 일리치 차이콥스키 | 표트르 차이코프스키]
Wolfgang A. Mozart    → 볼프강 아마데우스 모차르트 [alt: 모차르트 | 모짜르트]
Béla Bartók           → 버르토크 벨러  [alt: 바톡|바르토크|바르톡|버르토크|버톡|벨라 바르토크|벨라 바르톡]
Claude Debussy        → 클로드 드뷔시  [alt: 끌로드 드뷔시 | 드뷔시]
```
`모짜르트`(구식 표기), `차이코프스키`(예술의전당 실제 표기!), `끌로드`(옛 외래어) 같은 **실전 변형까지 들어 있다.**

**실측 결과: 자동 생성된 한국어 표기 582종, 220명 중 207명 커버**
```
쇼팽        -> Frédéric Chopin          차이콥스키   -> Pyotr Ilyich Tchaikovsky
바흐        -> Johann Sebastian Bach    라흐마니노프 -> Sergei Rachmaninoff
베토벤      -> Ludwig van Beethoven     모차르트/모짜르트 -> W. A. Mozart
브람스      -> Johannes Brahms          쇼스타코비치 -> Dmitri Shostakovich
말러        -> Gustav Mahler            프로코피예프 -> Sergei Prokofiev
생상스      -> Camille Saint-Saëns      스트라빈스키 -> Igor Stravinsky
드뷔시/라벨/멘델스존/비발디/헨델/하이든/리스트/슈베르트/시벨리우스/바르톡 ... 전부 적중
```

**⚠ 함정 2 — 두 가지 실패 모드가 실측으로 확인됐다. 수동 오버라이드가 필수다.**

1. **`드보르작` 누락.** Wikidata ko 라벨은 `안토닌 드보르자크`, ko alias **없음**. 그런데 한국 공연 포스터·티켓의 압도적 다수는 **`드보르작`** 이라고 쓴다. → 자동 인덱스에서 **MISS**.
2. **`슈만` → William Schuman 오매칭.** `슈만`은 Robert Schumann이어야 하는데, 미국 작곡가 William Schuman의 한국어 라벨과 충돌해 잘못 붙었다.

전체 충돌률은 낮다 — **582종 중 다의 표기 5종(0.9%)**:
```
바흐       → [J.S. Bach, C.P.E. Bach, J.C. Bach]   ← 문맥 필요
슈만       → [Robert Schumann, William Schuman]     ← 위험. 강제 오버라이드
스카를라티 → [Alessandro, Domenico]
마르첼로   → [Alessandro, Benedetto]
주니어     → [Johann Strauss Jr, John Cage]          ← 파싱 아티팩트
```

→ **결론: 자동 추출로 582종을 만들고, 그 위에 상위 50명 수동 오버라이드 테이블을 얹는다.** 오버라이드는 반나절 작업이고, 여기서 틀리면 추천 전체가 어긋난다.

### 4-3. MusicBrainz — 보조. 한국어 alias 백업으로만

- 라이선스: https://musicbrainz.org/doc/About/Data_License — *"The core data of the database is licensed under the **CC0**"*. **Works / Artists / Relationships 전부 core = CC0.** tags·ratings·통계·검색인덱스는 CC BY-NC-SA 3.0 (상업 서비스면 사용 금지).
- Rate limit: https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting — *"Currently that rate is (on average) **1 request per second**"*, 초과 시 **503**. **User-Agent 필수**(`AppName/1.0 ( contact@example.com )`), 미지정 시 50 req/s 공용 풀로 강등.
- 덤프: https://data.metabrainz.org/pub/musicbrainz/data/json-dumps/ — **`work.tar.xz` 656MB**(실측 688,369,032 bytes), `artist.tar.xz` 2.0GB. **주 2회 갱신, 인증 불필요.** 개인/비상업 프로젝트는 가입 불필요(https://metabrainz.org/datasets/signup).
- **한국어 alias (실측)**: 아티스트에는 있다.
  - Chopin: `{"locale":"ko","name":"프레데리크 쇼팽","primary":true}`, `{"locale":"ko","name":"쇼팽"}`
  - Beethoven: `{"locale":"ko","name":"베토벤","type":null,"primary":false}`
  - Tchaikovsky: `{"locale":"ko","name":"표트르 일리치 차이콥스키","primary":true}`
  - **품질 불균일**: Chopin은 2개+primary 플래그, Beethoven은 `type:null`/`primary:false` 1개뿐. `primary`를 신뢰하면 안 된다.
  - **작품(work) 한국어 alias는 사실상 없다.** Chopin Ballade No.1(alias 16개) locale 전부 null, Beethoven 5번(13개)은 `de`/`nl_BE`뿐, Mozart Eine kleine Nachtmusik은 alias 0개.
- **치명적 약점 — 클래식 메타데이터가 works에 없다**:
  - **opus 필드 없음.** `work_attribute` 테이블은 스키마 "Undocumented tables"에 있고, 실제 조회 결과 채워진 건 `Key`(조성)와 저작권협회 ID(JASRAC 등)뿐이었다. Chopin Ballade No.1 → `[{"type":"JASRAC ID",...},{"type":"Key","value":"G minor"}]`. **Op.23은 어디에도 없다** — 제목 문자열에만 있다.
  - **악기 편성 없음.** work 레벨에 instrumentation 필드가 없다. Instrument는 recording의 performance relationship에 붙는다.
  - **작곡가는 필드가 아니라 relationship.** `?inc=artist-rels` 를 붙여야 하고, 응답에 recording 관계가 수백 개(Ballade No.1은 relation 317개) 섞여 오므로 `type=="composer"` 필터가 필요하다.
- **판정**: Open Opus + Wikidata로 충분하다. MusicBrainz는 **Wikidata에 ko 라벨이 없는 작곡가의 백업**, 그리고 나중에 녹음/음반 연동을 붙일 때 쓴다. **1순위로 도입하지 말 것** — 656MB 덤프 파이프라인 비용 대비 이득이 지금은 없다.

### 4-4. IMSLP — **악기·작품번호가 필요해질 때만. 라이선스 유보 있음**

- MediaWiki API 열려 있음: `https://imslp.org/api.php` (MediaWiki **1.18.1**, 2011년판 — `query-continue` 구식 포맷, `formatversion=2` 없음)
- **전용 worklist API**(문서: https://imslp.org/wiki/IMSLP:API):
  ```
  http://imslp.org/imslpscripts/API.ISCR.php?account=worklist/disclaimer=accepted/
        sort=id/type=2/start=0/retformat=json
  ```
  페이지당 1000건, `start` 페이징, `moreresultsavailable` 플래그. `start=250000`에서도 결과가 있어 **작품 25만 건 이상**(총량은 API가 노출 안 함).
  필드: `composer`, `worktitle`, `icatno`, `pageid`, `permlink`, `parent`. **opus·악기는 없다.**
- **opus·악기·조성은 작품 페이지에서** — Chopin Ballade No.1 실측:
  ```
  |Opus/Catalogue Number=Op.23
  |Key={{Key|g}}
  |Piece Style=Romantic
  |Instrumentation=piano
  ```
  더 안전한 경로는 `prop=categories`: `Category:For piano`, `Category:For 1 player`, `Category:Ballades`, `Category:G minor`
  → **악기 정보는 IMSLP가 4개 소스 중 압도적으로 낫다.**
- **벌크 덤프 없음.** `IMSLP:` 네임스페이스 726페이지를 전수 열거해 확인 — 덤프 관련 페이지 0건. `IMSLP:Mirroring`은 PDF 미러링용(SSH 계정 이메일 전달 방식)이지 데이터 덤프가 아니다.
- **robots.txt** (https://imslp.org/robots.txt): `/api.php`·`/imslpscripts/`는 Disallow 목록에 **없음**. 단 `/index.php` 는 금지 → `?action=raw` 방식 쓰지 말고 `api.php` 사용. **`Crawl-delay: 2`(초당 0.5 요청)**.
- **⚠ 라이선스 유보**: `siprop=rightsinfo` → `Creative Commons Attribution-ShareAlike 4.0`, 모든 페이지 `<link rel="copyright" href=".../by-sa/4.0/">`. 그러나 이건 MediaWiki 전역 설정값이고, **"메타데이터가 CC BY-SA"라고 산문으로 명시한 문서를 찾지 못했다.** IMSLP에는 **이용약관 페이지 자체가 없다**(푸터는 General disclaimer / Privacy policy 둘뿐). `IMSLP:Copyrights`는 `Public domain`으로 리다이렉트되며 악보 스캔의 PD 판정만 다룬다.
  CC BY-SA는 **share-alike 전염성**이 있어 `works` 테이블 전체를 BY-SA로 풀어야 한다는 해석이 가능하다. (작곡가명·Op.번호 같은 단순 사실은 애초에 저작권 대상이 아니라는 반론도 성립 — 법적 판단 영역, §5 미확인)
- **한국어 전무.** UI 언어는 en/es/ja/sk/ru/de뿐. 한글 프리픽스 검색(`apprefix=쇼|베|모|바|차`) 전부 빈 결과.
- **판정**: 지금은 도입하지 않는다. 나중에 `works.instrument`를 제대로 채우고 싶을 때, **대상 작곡가 20~50명으로 좁혀** `categorymembers` → `titles=` 파이프 50개 묶음 → `prop=revisions|categories` 2단계로 가져온다. 전량은 Crawl-delay 2초 기준 6일이 걸려 비현실적이다.

### 4-5. 현실적 권고 — **"상위 N명"의 N은 몇인가**

**결론: N = 50 (필수) / 100 (권장). 220 전체를 넣되, 검수는 상위 50명만 한다.**

근거:
1. **Open Opus 덤프는 220명 전체가 3.3MB짜리 단일 파일이다.** 골라 넣을 이유가 없다 — 전부 넣는 비용이 0이다. "상위 N명만 커버"는 **적재 대상이 아니라 검수 대상**의 문제다.
2. Open Opus 자체가 큐레이션 결과다. `popular=1` 작품 **397건**, `recommended=1` **1,234건**으로 표시돼 있다. 이 플래그가 곧 "공연에 실제로 나오는 레퍼토리" 근사치다.
3. 220명 중 **207명(94.1%)** 이 Wikidata 한국어 라벨을 갖는다. 나머지 13명은 한국 무대에 거의 오르지 않는다.
4. 손이 필요한 건 §4-2에서 확인된 구멍뿐이다 — `드보르작` 같은 누락, `슈만` 같은 충돌. 이건 **상위 50명 안에서 대부분 발생**한다.

**"한국에 자주 나오는 작곡가 상위 N" 목록은 어디서 얻나 — 추측하지 말고 데이터로 뽑는다:**
- **1순위(정확)**: 예술의전당 `getProgramCalList`로 최근 12개월 `클래식/독주/실내악` 공연 SN을 모으고, 각 `show_view`의 `1. 프로그램` 텍스트를 §4-2 인덱스(582종)로 훑어 **작곡가 등장 빈도를 직접 센다.** 실제 한국 무대 데이터라 어떤 외부 랭킹보다 정확하다.
- **2순위(즉시)**: Open Opus `popular=1` 작곡가 + `composer/list/pop.json`(23명)을 부트스트랩 시드로 쓴다.
- 이미 `testdata/`에 티켓 표본이 있으므로 거기서 나온 작곡가도 시드에 포함한다.

> **하지 말아야 할 것**: "완벽한 작품 사전"을 목표로 IMSLP 25만 건을 긁는 것. §4-4의 계산대로 6일이 걸리고, 그중 한국 공연에 나오는 건 1%도 안 된다. Open Opus 24,975건이면 충분히 과잉이다.

---

## 5. 곡목 문자열 매칭 전략

### 5-1. 결론 — **2단계(작곡가 먼저 → 작품). 임베딩은 지금 필요 없다.**

`ARCHITECTURE.md` §4-3 C4는 이렇게 되어 있다:
```
OCR raw_text → 임베딩 → works 사전에서 최근접 탐색 → 유사도 ≥ 0.85면 매핑
```
**이 설계를 바꾸는 걸 권한다.** 이유는 규모와 실패 양상 둘 다다.

| 방식 | 이 규모(2.5만)에서의 평가 |
|---|---|
| 순수 임베딩 유사도 | 2.5만 건에 Vectorize 인덱스·임베딩 비용·재색인 파이프라인이 필요. 그런데 `Op. 28` 같은 **고유번호에 약하다** — 임베딩은 `Op.28`과 `Op.23`을 거의 같게 본다. 클래식 곡 구분의 절반이 작품번호인데 가장 못하는 지점이다. **과잉이자 부정확.** |
| 정규화 + 퍼지매칭 (단일 단계) | 2.5만 건 전체를 대상으로 퍼지매칭하면 `Symphony no.5`가 12명의 작곡가에게서 동시에 매칭된다. **모호성 폭발.** |
| **작곡가 먼저 → 작품 (2단계)** ⭐ | 작곡가를 확정하면 후보가 **평균 113건**(24,975÷220)으로 줄고, Chopin은 114건이다. 이 크기면 정규화+퍼지+작품번호 정확일치로 충분하다. **작곡가만 잡아도 절반의 가치가 이미 나온다** (§5-4). |

### 5-2. 실제로 구현해서 돌려봤다 — 결과와 실패 사례

1단계는 §4-2의 한국어 인덱스(582종) + 영어 성(surname) 정규식. 2단계는 한국어 형식어 사전 + 작품번호 보너스 + 토큰 중첩 스코어.

```
입력 문자열                                   → 작곡가                    | 매칭된 작품
──────────────────────────────────────────────────────────────────────────────────────
쇼팽 전주곡 24개                              → Frédéric Chopin      ✅ | Preludes, op. 28        ✅
Chopin: 24 Preludes Op.28                    → Frédéric Chopin      ✅ | Preludes, op. 28        ✅
F. Chopin - Preludes                         → Frédéric Chopin      ✅ | Preludes, op. 28        ✅
베토벤 교향곡 5번 운명                         → Ludwig van Beethoven ✅ | Symphony no. 5 in C minor, op. 67 ✅
Beethoven Symphony No.5 in C minor Op.67     → Ludwig van Beethoven ✅ | Symphony no. 5 in C minor, op. 67 ✅
라흐마니노프 피아노 협주곡 2번                  → Sergei Rachmaninoff  ✅ | Piano Concerto no. 2 in C minor, op. 18 ✅
Rachmaninoff Piano Concerto No. 2            → Sergei Rachmaninoff  ✅ | Piano Concerto no. 2 in C minor, op. 18 ✅
──────────────────────────────────────────────────────────────────────────────────────
차이콥스키 피아노 협주곡 1번                    → Tchaikovsky          ✅ | Violin Concerto in D major, op.35  ❌
드보르작 교향곡 9번 신세계로부터                 → *** MISS ***         ❌ | —
바흐 골드베르크 변주곡                          → Alban Berg           ❌ | 14 Variations for Piano  ❌
슈베르트 겨울나그네                            → Franz Schubert       ✅ | Atys, D.585              ❌
```

**당신이 예시로 준 세 문자열은 전부 정확히 같은 작품으로 묶였다.** 그리고 실패 4건이 더 중요하다 — 각각 다른 원인이고, 전부 고칠 수 있다.

**실패 1 — `바흐 골드베르크` → Alban Berg (가장 위험)**
`골드베르크` 안에 `베르크`가 부분문자열로 들어 있어 Alban Berg가 먼저 매칭됐다. 한국어는 띄어쓰기가 불안정해서 **부분문자열 매칭이 근본적으로 위험**하다.
> **대책**: (a) 후보를 전부 모아 **최장 일치(longest match)** 를 고른다 — `바흐`(2자)보다 `베르크`(3자)가 길어서 이것만으론 부족. (b) **한글 음절 경계 검사** — 매칭 위치 앞뒤가 한글이면 거부. `골드베르크`의 `베르크` 앞이 `드`이므로 거부되고 `바흐`가 살아남는다. (c) 3자 이하 축약형은 **어절 단위**로만 매칭.

**실패 2 — `드보르작` 미등록**
Wikidata에 `안토닌 드보르자크`만 있다. → **수동 오버라이드 테이블**로 해결 (§4-2 함정 2).

**실패 3 — `차이콥스키 피아노 협주곡 1번` → Violin Concerto**
한국어 형식어 사전에 `피아노 협주곡`이 있었지만 스코어링에서 밀렸다. 원인은 **한국어 서수(`1번`)를 처리하지 않은 것.** `1번` → `no. 1` 변환이 없어 번호 신호가 통째로 버려졌다.
> **대책**: `(\d+)번` → `no. \1` 정규화 추가. `제(\d+)번`도 함께. **한국어 서수·조성·작품번호 정규화가 스코어링 개선보다 효과가 크다.**

**실패 4 — `슈베르트 겨울나그네` → Atys**
`겨울나그네`(Winterreise)의 한국어 제목이 사전에 없다. 이건 스코어링 문제가 아니라 **한국어 곡명 데이터 부재**다. Open Opus·MusicBrainz·IMSLP 전부 한국어 곡명이 없다(§4-0).
> **대책**: 유명 작품의 한국어 별칭 사전을 **직접 만든다.** `겨울나그네`, `사계`, `운명`, `신세계로부터`, `월광`, `비창`, `전원`, `황제`, `황제 4중주`, `송어`, `백조의 호수`, `호두까기 인형` 등 **50~100개면 한국 공연 표기의 대부분을 덮는다.** 이건 자동 수집이 불가능하고, 그래서 오히려 값싸다(반나절).

### 5-3. 권장 파이프라인

```
raw_text ("차이코프스키-피아노 협주곡 내림나단조 작품23")
   │
[N] 정규화 — 순수 문자열 처리, LLM 없음
    · 한국어 서수:   (\d+)번 / 제(\d+)번        → no. $1
    · 작품번호:      작품(\d+) | Op\.?\s*(\d+)   → op. $N
    ·               BWV/K\.?/D\.?/Hob\.? (\d+)  → 원형 보존 (Op.과 다른 축)
    · 한국어 형식어:  교향곡→symphony, 협주곡→concerto, 전주곡→prelude,
                     소나타→sonata, 야상곡/녹턴→nocturne, 연습곡/에튀드→etude,
                     변주곡→variations, 모음곡→suite, 서곡→overture,
                     현악사중주→string quartet, 환상곡→fantasy, 즉흥곡→impromptu,
                     마주르카→mazurka, 폴로네즈→polonaise, 왈츠→waltz, 발라드→ballade
    · 한국어 조성:   내림나단조→B-flat minor, 다단조→C minor, ... (12×2 표)
    · 한국어 별칭:   겨울나그네→Winterreise, 신세계로부터→From the New World, ... (수동 50~100개)
   │
[1] 작곡가 식별 ── 582종 한국어 인덱스 + 수동 오버라이드 + 영어 surname
    · 한글 음절 경계 검사 (골드베르크/베르크 오매칭 차단)
    · 최장 일치 우선
    · 다의 표기(바흐/슈만/스카를라티/마르첼로)는 문맥 규칙 또는 리뷰 큐로
    → 실패 시 여기서 중단. work_id = NULL, composer도 NULL
   │
[2] 작품 매칭 ── 해당 작곡가의 작품만 (평균 113건)
    · 작품번호 정확일치      가중치 최상 (op. 28 == op. 28 → 거의 확정)
    · 형식어 일치            symphony/concerto/prelude ...
    · 서수 일치              no. 5
    · 토큰 자카드 + difflib  나머지
    → score ≥ 임계값이면 work_id 확정
   │
[3] 실패 처리 (§5-5)
```

**LLM은 이 경로에 넣지 않는다.** 순수 문자열 처리라 **µs 단위**로 끝나고, 결정적(deterministic)이라 테스트·회귀 검증이 가능하다. `ARCHITECTURE.md` §4-4 D3의 "빠른 경로(LLM 우회)" 철학과 일치한다.

### 5-4. 작곡가만이라도 먼저 잡는 게 나은가 — **그렇다. 이게 핵심이다.**

사용자의 최종 목표는 **"이런 시대의 음악을 좋아하시네요"** 다. 이건 작품 단위 정보가 아니라 **작곡가 단위 정보**로 성립한다:

| 필요한 것 | 작곡가만으로 되나 | 작품까지 필요한가 |
|---|---|---|
| 시대(era) 취향 | ✅ (Open Opus `epoch`) | 불필요 |
| 작곡가 취향 통계 | ✅ | 불필요 |
| "가장 많이 만난 작곡가" (현재 하드코딩) | ✅ | 불필요 |
| 취향 벡터 / 유사 공연 추천 | ✅ 대부분 | — |
| 악기 취향 (피아노 vs 오케스트라) | ❌ | ✅ |
| "이 곡 또 듣기" 수준 추천 | ❌ | ✅ |

→ **`concert_program`에 `composer_id` 컬럼을 추가하고, `work_id`와 독립적으로 채워라.**

```sql
CREATE TABLE concert_program (
  concert_id     TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  raw_text       TEXT NOT NULL,
  composer_id    TEXT,           -- ★ 추가. 1단계 성공 시 채워짐
  composer_conf  REAL,           -- ★ 추가
  work_id        TEXT,           -- 2단계 성공 시에만
  match_conf     REAL,
  PRIMARY KEY (concert_id, seq)
);
```
현재 스키마는 `work_id`가 NULL이면 **작곡가 정보까지 통째로 버린다.** 1단계는 성공하고 2단계만 실패하는 경우가 실측에서 가장 흔했는데(위 4건 중 3건), 그 정보를 살릴 자리가 없다. 이 컬럼 2개가 통계·시대추정·취향벡터를 **부분 실패 상황에서도** 살린다.

### 5-5. 매칭 실패를 어떻게 다룰지

**3단 처리 — 실패의 종류에 따라 다르게 대응한다.**

| 상황 | 처리 | UI |
|---|---|---|
| 1단계 실패 (작곡가 못 잡음) | `raw_text` 보존, 통계에서 제외. **리뷰 큐** | 조용히 넘어감 |
| 1단계 성공 + 2단계 실패 | **`composer_id`만 저장.** 통계·시대·취향벡터는 정상 작동 | 조용히 넘어감 (사용자에게 손해 없음) |
| 1단계 다의성 (`슈만`,`바흐`) | **사용자에게 물음** — 후보 2~3개 제시 | 티켓 검수 화면에서 드롭다운 |
| 2단계 근접 후보 존재 (임계값 미달) | **사용자에게 물음** — "혹시 이 곡인가요?" | 검수 화면 확인 버튼 |

**설계 원칙**
1. **사용자에게 묻는 건 아낀다.** OCR 검수 화면은 이미 인지 부하가 있다(`ARCHITECTURE.md` §4-3 C2 "HITL의 병목은 주의 배분"). 곡목 매칭 실패를 전부 물으면 티켓 1장에 질문 5개가 뜬다. **묻는 건 다의성과 근접후보 두 경우로 한정**한다.
2. **묻는 시점은 등록 직후가 아니어도 된다.** 통계 화면에서 "미분류 곡 7건 정리하기" 진입점을 두면, 사용자가 관심 있을 때 한꺼번에 처리한다.
3. **리뷰 큐는 개발자용이다.** 자주 실패하는 `raw_text` 패턴을 모아 보면 정규화 규칙·별칭 사전에 무엇을 추가할지 바로 나온다. **이 큐가 사전 개선의 유일한 신호원이다.**
4. **매칭 실패를 조용히 넘기지 않는다** — `ARCHITECTURE.md` §4-3 C3(날짜 파싱)과 같은 원칙. `match_conf`를 반드시 기록해서 나중에 임계값을 조정할 수 있게 한다.

---

## 6. 시대(era) 분류

### 6-1. 데이터 출처 — **Open Opus `epoch` 압승**

| 소스 | 커버리지 | 형태 | 판정 |
|---|---|---|---|
| **Open Opus `epoch`** | **220/220 = 100%** (모든 작곡가 레코드에 존재) | 10분류 문자열 | ⭐ **이걸 쓴다** |
| Wikidata `P135`(사조) | 한국어 라벨 보유 작곡가 9,756명 중 **523명 = 5.4%** (실측) | 다중값 | 보조. 커버리지 너무 낮음 |
| Wikidata `P136`(장르) | 넓지만 **시대와 형식이 섞임** — Beethoven: `opera, classical music, symphony, sonata, art music` | 혼탁 | 쓰지 말 것 |
| IMSLP `Piece Style` | 작품 페이지 wikitext (`Piece Style=Romantic`) | **작품 단위** | 작품 단위가 필요할 때만 |
| MusicBrainz | 없음 | — | ❌ |

Wikidata P135 실측:
```
Johann Sebastian Bach → Baroque music (Q8361)
Frédéric Chopin       → Romantic music (Q207591)
Pyotr I. Tchaikovsky  → Romantic music (Q207591)
Ludwig van Beethoven  → Classical period (Q17723) + Romantic music (Q207591)   ← 다중값
```
경계 작곡가를 **다중값으로 정직하게 표현**하는 건 좋지만, 커버리지 5.4%로는 주 소스가 못 된다.

### 6-2. Open Opus epoch 10종 → `era` 4종 매핑

실측 분포 (220명):
```
20th Century   49  |  Late Romantic  39  |  Romantic       36  |  Post-War      27
Baroque        22  |  Renaissance    17  |  Early Romantic 13  |  Classical      9
21st Century    4  |  Medieval        4
```

**권장 매핑 (`ARCHITECTURE.md` §3의 `era TEXT -- baroque|classical|romantic|modern` 기준)**

| Open Opus epoch | → `era` | 비고 |
|---|---|---|
| Medieval (4) | `baroque` | 4명뿐. 별도 값을 만들 가치가 없음 |
| Renaissance (17) | `baroque` | 위와 동일. 엄밀히는 틀리지만 4분류 제약 안에서 최선 |
| Baroque (22) | `baroque` | — |
| Classical (9) | `classical` | Haydn, Mozart, C.P.E. Bach, J.C. Bach, Boccherini, Gluck, Salieri, Stamitz, Dittersdorf |
| **Early Romantic (13)** | **`classical`** ⚠ | **아래 참조 — 여기가 유일한 판단 지점** |
| Romantic (36) | `romantic` | — |
| Late Romantic (39) | `romantic` | — |
| 20th Century (49) | `modern` | — |
| Post-War (27) | `modern` | — |
| 21st Century (4) | `modern` | — |

### 6-3. ⚠ 경계 작곡가 — Open Opus의 분류가 통념과 다르다

**`Early Romantic` 13명 전원 (실측)**:
```
Beethoven, Bellini, Berwald, Cherubini, Donizetti, Field, Hummel,
Paganini, Rossini, Schubert, Sor, Spohr, Weber
```

**Open Opus는 베토벤과 슈베르트를 `Classical`이 아니라 `Early Romantic`으로 분류한다.**
`Classical` 버킷에는 하이든·모차르트 등 9명만 있다.

기계적으로 `Early Romantic → romantic`으로 매핑하면 **"베토벤 교향곡 5번을 들었더니 낭만파 취향이라고 나온다."** 한국 클래식 관객의 통념과 어긋나고, 사용자가 앱을 불신하게 되는 정확히 그런 종류의 오류다.

**권고: `Early Romantic → classical`로 매핑한다.**
- 근거: 13명 중 Beethoven·Schubert·Rossini·Weber·Hummel·Cherubini·Field는 통상 고전~초기낭만으로 다뤄지며, `Classical` 버킷이 9명뿐이라 그대로 두면 **classical 카테고리가 사실상 비어버린다**(9/220 = 4%).
- 이렇게 하면 4분류 분포가 `baroque 43 / classical 22 / romantic 75 / modern 80` 으로 균형이 잡힌다.
- 라흐마니노프는 Open Opus에서 `Late Romantic` → `romantic`. 통념과 일치하므로 별도 처리 불필요.

**단, 매핑 테이블은 코드에 하드코딩하지 말고 데이터로 둔다:**
```sql
CREATE TABLE epoch_map (
  epoch TEXT PRIMARY KEY,   -- Open Opus 원본 값
  era   TEXT NOT NULL       -- baroque|classical|romantic|modern
);
```
`works.era`에 결과를 굽되 `composers.epoch`에 원본을 남긴다. 나중에 4분류가 부족해지면(예: `renaissance` 추가) 재계산만 하면 된다.

### 6-4. 작곡가 단위 vs 작품 단위 — **작곡가 단위가 맞다**

| | 작곡가 단위 | 작품 단위 |
|---|---|---|
| 데이터 확보 | ✅ Open Opus에 100% 존재 | ❌ IMSLP wikitext 파싱 필요 (작품당 1 호출, Crawl-delay 2s) |
| §5-4의 부분 실패 대응 | ✅ **작곡가만 잡혀도 시대가 나온다** | ❌ work_id 확정 실패 시 시대 불명 |
| 정확도 | 경계 작곡가에서 오차 | 이론적으로 더 정확 |
| 사용자 체감 | "쇼팽을 좋아하시네요 → 낭만" 로 충분 | 과잉 정밀 |

**작품 단위가 실제로 의미 있는 경우는 드물다.** 베토벤 후기 현악사중주를 낭만으로, 초기 피아노 소나타를 고전으로 나누는 건 음악학적으로는 옳지만, **"이런 시대의 음악을 좋아하시네요"라는 한 문장을 만드는 데는 기여하지 않는다.** 관람 이력 20건을 집계하면 작곡가 단위 오차는 평균에 묻힌다.

결정적으로, §5-4에서 확인했듯 **작품 매칭보다 작곡가 매칭이 훨씬 잘 된다.** 시대 분류를 작품에 걸면 매칭 실패가 그대로 시대 불명으로 이어진다. 작곡가에 걸면 훨씬 견고하다.

→ **`works.era`는 작곡가의 era를 상속받는다.** 스키마상 `works` 테이블에 그대로 두되, 채우는 로직은 `composer → epoch → era`다. 나중에 예외가 필요하면 작품 단위 오버라이드를 몇 건만 추가한다 (예: 베토벤 후기 사중주).

**추가 권고 — `composers` 테이블을 분리하라.**
현재 `ARCHITECTURE.md` §3의 `works` 테이블은 `composer`, `composer_ko`, `era`를 작품마다 중복 저장한다. 쇼팽 작품 114건에 `쇼팽`이 114번 들어간다. 한국어 표기를 고칠 때 114행을 갱신해야 하고, §5-4의 `composer_id`를 걸 대상도 없다.

```sql
CREATE TABLE composers (
  id            TEXT PRIMARY KEY,     -- 'chopin-frederic'
  name_en       TEXT NOT NULL,        -- 'Frédéric Chopin'
  name_ko       TEXT,                 -- '프레데리크 쇼팽'  (Wikidata rdfs:label@ko)
  aliases_ko    TEXT,                 -- JSON: ["쇼팽"]      (Wikidata skos:altLabel@ko + 수동)
  aliases_en    TEXT,                 -- JSON: ["Chopin","F. Chopin","Fryderyk Chopin"]
  epoch         TEXT,                 -- Open Opus 원본 'Romantic'
  era           TEXT,                 -- 'romantic'  (epoch_map 적용 결과)
  birth         TEXT, death TEXT,
  openopus_id   TEXT, wikidata_qid TEXT
);

CREATE TABLE works (
  id            TEXT PRIMARY KEY,
  composer_id   TEXT NOT NULL REFERENCES composers(id),   -- ★ 정규화
  title_en      TEXT NOT NULL,
  title_ko      TEXT,                 -- 수동 별칭 사전 (겨울나그네 등)
  opus          TEXT,                 -- 제목에서 파싱
  form          TEXT,                 -- symphony|concerto|sonata|...  (§4-1 정정 대응)
  genre_oo      TEXT,                 -- Open Opus 원본 Orchestral|Keyboard|Chamber|Vocal|Stage
  instrument    TEXT,                 -- piano|violin|orchestra|...
  popular       INTEGER, recommended INTEGER   -- Open Opus 플래그 = 공연 레퍼토리 근사
);
```
`era`가 `composers`에 있으면 §5-4의 "작곡가만 잡힌 경우"에도 시대 통계가 나온다.

### 6-5. `instrument` / `form` 채우기 — 실측 기반 권고

§4-1에서 확인했듯 Open Opus `genre`는 5종뿐이고 협주곡 구분이 없다. 제목 키워드 분류기를 실제로 24,975건 전수에 돌려봤다:

| 대상 | 형식(form) 키워드 매칭률 |
|---|---|
| 전체 24,975건 | **48.7%** |
| `popular=1` 397건 | **75.3%** |
| `recommended=1` 1,234건 | **75.0%** |

전체 매칭률이 낮은 건 미매칭 12,811건 중 **Vocal이 6,407건**(가곡·아리아는 시적 제목이라 형식어가 없음)이기 때문이다. **실제 공연 레퍼토리(popular/recommended)에서는 75%가 잡힌다.**

악기 키워드는 제목+부제에서 **29.9%**(7,464/24,975) 추출됐다: piano 2,600 / violin 1,683 / voice 1,078 / organ 444 / flute 440 / cello 374 / oboe 230 / viola 164.

**→ 2단 폴백 설계로 100%를 덮는다:**
```
form:       제목 키워드 (concerto|symphony|sonata|quartet|...) → 실패 시 NULL
instrument: 제목/부제 악기어 → 실패 시 genre_oo로 조대분류
              Keyboard  → 'keyboard'   (Chopin 작품 114건 중 100건)
              Orchestral→ 'orchestra'
              Chamber   → 'ensemble'
              Vocal     → 'voice'
              Stage     → 'stage'
```
`genre_oo`는 100% 채워져 있으므로 `instrument`가 NULL이 되는 일은 없다. 정밀도는 낮지만 **"피아노 취향 vs 오케스트라 취향"을 가르는 데는 충분**하고, 이게 사용자가 체감하는 해상도다.

---

## 7. 권고 아키텍처 — 무엇을 어디에 쓰는가

### 7-1. 소스 → 역할 배치

```
┌─────────────────────────── 후보 풀 (concerts) ────────────────────────────┐
│                                                                           │
│  KOPIS pblprfr (shcate=CCCA)     전국 클래식 공연 마스터 · 과거 포함         │
│    └ afterdate=어제 로 일 1회 증분                                         │
│    └ pblprfr/{id} 상세: 출연진·가격문자열·예매처URL·소개이미지               │
│  ─────────────────────────────────────────────────────────────────────    │
│  SAC getProgramCalList           예술의전당 보강 (장르 세분: 독주/실내악/성악) │
│  서울 열린데이터 culturalEventInfo  ORG_LINK(인터파크 딥링크)·좌표·포스터      │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
                                    │
┌──────────────────────── 곡목 (concert_program) ──────────────────────────┐
│                                                                           │
│  1순위  SAC show_view?SN=  「1. 프로그램」 텍스트   ← 유일한 구조화 곡목 소스  │
│         (반드시 사전 수집 → D1 캐시. 사후 조회에 의존하지 않는다)             │
│  2순위  티켓 OCR program 필드                       ← 이미 구현됨            │
│  3순위  KOPIS styurls 소개이미지 OCR                ← 재활용 (충전율 미확인)  │
│  4순위  사용자 수동 입력                                                    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
                                    │  raw_text
┌────────────────── 작품 사전 (composers / works) ─────────────────────────┐
│                                                                           │
│  Open Opus /work/dump.json   작곡가 220 · 작품 24,975 · epoch  [CC0]      │
│         +                                                                 │
│  Wikidata SPARQL             한국어 label + altLabel 582종     [CC0]      │
│         +                                                                 │
│  수동 오버라이드 (~50)        드보르작 / 슈만 충돌 / 한국어 곡명 별칭          │
│                                                                           │
│  (선택) MusicBrainz ko alias  Wikidata 누락분 백업              [CC0]      │
│  (선택) IMSLP Category:For…   instrument 정밀화              [BY-SA 유보]  │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**`ARCHITECTURE.md` §2-1 다이어그램 수정 제안**: `KOPIS API (일 1회 배치, Queues)` 옆에 `SAC 프로그램 스냅샷 (일 1회)` 를 추가한다. 곡목 없이는 §4-1의 추천 품질 설계가 성립하지 않는데, 현재 다이어그램에 그 소스가 없다.

### 7-2. 구축 순서

`ARCHITECTURE.md` §7 로드맵의 **4단계(RAG 본체)** 를 이렇게 쪼갠다. 앞의 3개는 **KOPIS 키 발급을 기다리는 동안 지금 할 수 있다.**

| 순서 | 작업 | 선행조건 | 소요 | 산출물 |
|---|---|---|---|---|
| **0** | Open Opus 덤프 1회 다운로드 → `composers` 220 / `works` 24,975 적재 | 없음 | **1시간** | 사전 뼈대 |
| **1** | Wikidata SPARQL 1회 실행 → ko label/alias 582종 → `composers.name_ko`/`aliases_ko` | 0 | **1시간** | 한↔영 매핑 |
| **2** | 수동 오버라이드: 상위 50명 검수 + `드보르작` 등 누락 + `슈만` 충돌 + 한국어 곡명 별칭 50~100 | 1 | **반나절** | 정확도 확보 |
| **3** | 정규화 + 2단계 매처 구현 (§5-3), `testdata/` 티켓으로 회귀 테스트 | 2 | **1일** | 매칭 파이프라인 |
| 4 | KOPIS 인증키 신청 (PC에서, 1인 1키) | — | **대기** | — |
| 5 | KOPIS 배치: `shcate=CCCA` + `afterdate` 증분 → `concerts` | 4 | 1일 | 후보 풀 |
| 6 | SAC 배치: `getProgramCalList` 월간 → 신규 SN의 `show_view` 프로그램 텍스트 스냅샷 | 3 | 1일 | **곡목** |
| 7 | `concert_program` 매칭 실행 → `composer_id`/`work_id` 채우기 | 3,6 | 반나절 | 통계·시대 가동 |
| 8 | `taste_profile` 집계를 실제 데이터로 전환 (`Dashboard.tsx` 하드코딩 제거) | 7 | 반나절 | 플라이휠 |
| 9 | Vectorize 임베딩 + FTS5 + RRF (§4-1 하이브리드 검색) | 5,7 | 3일 | 추천 |

**0~3만 해도 `Dashboard.tsx`의 하드코딩된 `favoriteComposers`와 `85 - i*15` 진행바가 실제 데이터로 바뀐다.** KOPIS 키 없이 이틀 안에 가능하다.

### 7-3. 이 조사가 `ARCHITECTURE.md`에 요구하는 수정 6가지

1. **§3 `works` 테이블 → `composers` / `works` 분리** (§6-4). 한국어 표기 갱신 비용과 `composer_id` 참조 대상 확보.
2. **§3 `concert_program`에 `composer_id`·`composer_conf` 추가** (§5-4). 작품 매칭 실패 시에도 시대·통계가 살아남는다.
3. **§4-3 C4의 매칭 전략을 임베딩 → 2단계 문자열 매칭으로 교체** (§5-1). `Op. 28`/`Op. 23` 구분은 임베딩이 가장 못하는 일이다.
4. **§3 `concerts.price_min/max`에 파서 필요 명시** (§2-5). KOPIS `pcseguidance`는 `전석 30,000원` 같은 자유 문자열이다.
5. **§2-1 다이어그램에 SAC 프로그램 스냅샷 배치 추가** (§7-1).
6. **§4-1 [0] 하드필터에 `genre = 'CCCA'` 추가.** 현재 필터는 날짜·지역·가격뿐이라 뮤지컬·연극이 후보 풀에 섞인다.

### 7-4. 하지 말아야 할 것

- **티켓팅 3사 스크래핑** (§3-1). 인터파크는 robots.txt와 약관 양쪽에서 금지하고 "사전 서면 허가"를 요구한다. KOPIS가 같은 데이터를 합법적으로 준다.
- **IMSLP 25만 건 전량 수집** (§4-4). Crawl-delay 2초 기준 6일. 한국 공연 레퍼토리는 그중 1% 미만이다.
- **MusicBrainz 656MB 덤프 1순위 도입** (§4-3). works에 opus도 악기도 없다. 지금 얻을 게 ko alias뿐인데 Wikidata가 이미 준다.
- **티켓 등록 요청 경로에서 SAC를 실시간으로 때리기** (§3-2e). 사후 조회 자체는 100% 작동하지만, 외부 HTTP 지연이 `ARCHITECTURE.md` §4-4의 TTFT 목표를 깬다. 배치 스냅샷 → 캐시 미스 시에만 폴백.
- **네이버/카카오 검색 API를 후보 풀 소스로 사용** (§3-6). 두 곳 다 공연 버티컬이 없다.

---

## 8. 비용·제약 표

### 8-1. 공연 데이터 소스

| 소스 | 비용 | 인증 | 호출 제한 | 라이선스 | 한국어 | 곡목 |
|---|---|---|---|---|---|---|
| **KOPIS OpenAPI** | 무료 | 인증키 (1인 1개, PC에서만 신청) | 기간 **31일**/요청, **100건**/페이지. 일일 상한 **문서 미공개** | data.go.kr: **이용허락범위 제한 없음**. 단 **출처 표시 의무**(미이행 시 중단 가능) | 원본 한국어 | ❌ |
| **SAC `getProgramCalList`** | 무료 | 불필요 | 명시 없음 (비공식) | 명시 없음 | 한/영 병기 | ❌ (일정만) |
| **SAC `show_view`** | 무료 | 불필요 | robots.txt Disallow 아님 | 명시 없음 | 한/영 병기 | ⭐ **✅ 텍스트 (과거 공연 포함, 판독률 88%)** |
| 서울 `culturalEventInfo` | 무료 | 인증키 (샘플키로 5행 테스트 가능) | 미확인 | 서울 열린데이터광장 (공공누리 계열) | 한국어 | △ 산문, 충전율 낮음 |
| data.go.kr 15105238 (문체부 기관) | 무료 | 인증키 | 미확인 | **이용허락범위 제한 없음** | 한국어 | ❌ |
| data.go.kr 15056881 (예술의전당 포함 10기관) | 무료 | 인증키 | 미확인 | **공공누리 제1유형(출처표시)** | 한국어 | ❌ |
| 세종문화회관 (서울 열린데이터) | 무료 | 인증키 | 미확인 | **공공누리 제1유형** | 한국어 | ❌ |
| 인터파크 / 예스24 / 멜론 | — | **공개 API 없음** | — | robots/약관 크롤링 금지 | — | — |
| 네이버 검색 API | 무료 | Client ID/Secret | **25,000회/일 (검색 API 전체 공유)** | 네이버 약관 | 한국어 | ❌ 공연 버티컬 없음 |
| 카카오(Daum) 검색 API | 무료 | REST API 키 | **50,000회/일**, 버티컬별 30,000회/일. 월 300만 | 카카오 약관 | 한국어 | ❌ 공연 버티컬 없음 |
| 카카오맵 REST | 무료 | REST API 키 | 지오코딩·장소검색 각 **100,000회/일** | 카카오 약관 | 한국어 | — |

### 8-2. 작품 사전 소스

| 소스 | 비용 | 인증 | 호출 제한 | 라이선스 | 한국어 커버리지 | 벌크 |
|---|---|---|---|---|---|---|
| **Open Opus** | 무료 | **불필요** | 문서 없음. CDN 캐시 1h, CORS `*` | **CC0** (공식 명시) | ❌ 없음 | ⭐ **3.3MB 단일 파일** |
| **Wikidata SPARQL** | 무료 | 불필요 (UA 필수) | 쿼리당 **60초** | **CC0** | ⭐ **작곡가 94.1%** (Open Opus 220 기준). 곡명은 유명작 일부 | 5.1MB / 11,816행 (1회 쿼리) |
| MusicBrainz API | 무료 | 불필요 (UA 필수) | **1 req/s** (초과 503) | **CC0** (core: work/artist/rel). tags·ratings는 BY-NC-SA 3.0 | △ 아티스트 ko alias 有, **작품 ko alias 無** | `work.tar.xz` 656MB + `artist.tar.xz` 2.0GB, 주 2회 |
| IMSLP API | 무료 | 불필요 | robots.txt **Crawl-delay 2** (0.5 req/s) | **CC BY-SA 4.0 추정** — 명시 문장 미확인, ToS 페이지 부재, share-alike 전염 우려 | ❌ **전무** (UI 언어에 ko 없음) | ❌ 덤프 없음. 1000건/요청 페이징 |

### 8-3. 실측 규모 요약

| 항목 | 실측값 |
|---|---|
| Open Opus 작곡가 / 작품 | **220 / 24,975** |
| Open Opus `popular=1` / `recommended=1` 작품 | **397 / 1,234** (= 공연 레퍼토리 근사) |
| Open Opus 덤프 크기 | 3,324,775 bytes |
| Open Opus genre 5종 분포 | Vocal 8,509 / Keyboard 5,266 / Orchestral 5,120 / Chamber 4,806 / Stage 1,274 |
| Wikidata 작곡가 전체 / ko 라벨 보유 | 133,675 / **9,756** (P279* 포함 14,512) |
| Open Opus 220명의 Wikidata ko 커버리지 | **207 (94.1%)**, 축약형 alias 보유 114 |
| 자동 생성 한국어 표기 수 / 다의 충돌 | **582종 / 5종 (0.9%)** |
| SAC 2026년 10월 일정 | 238건 (클래식 79 + 독주 23 + 실내악 7 + 성악 3 + 오페라 3 + 합창 1) |
| 형식 키워드 분류기 정확도 | 전체 48.7% / **공연 레퍼토리 75%** |
| SAC 과거 공연 페이지 생존율 (32건 표본, 2024-10~2026-03) | **32/32 = 100%** |
| SAC 과거 페이지 곡목 기계판독 가능률 | **28/32 = 88%** (작곡가 검출 94%, 작품번호 검출 88%) |

---

## 9. 미확인 항목 (정직하게)

확인하지 못한 것을 사실처럼 쓰지 않기 위해 분리했다. 각 항목에 **왜 확인 못 했는지**와 **어떻게 확인할 수 있는지**를 적었다.

### 9-1. KOPIS

| 항목 | 상태 | 확인 방법 |
|---|---|---|
| **일일 호출 상한 수치** | 공개 문서에 없음. `"쿼리에 제한이 있을 수 있으며, 이를 초과할 경우 서비스가 중지됩니다"` 라고만 명시. data.go.kr도 `"기관의 정책에 따라 트래픽 수는 상이할 수 있음"` | 인증키 발급 후 마이페이지 확인, 또는 kopis@gokams.or.kr 문의 |
| **클래식 공연의 `styurls`(소개이미지)에 곡목이 실제로 실리는 비율** | 미측정. 문서 예시가 연극이라 클래식 표본 없음 | 키 발급 후 `shcate=CCCA` 100건 상세 조회 → 이미지 표본 검사 |
| **클래식 공연의 `sty`(줄거리) 충전율** | 미확인. 연극·뮤지컬용 필드로 보임 | 위와 동일 |
| **데이터 갱신 주기** | 문서에 명시 없음. 레코드 단위 `updatedate`로만 판단 가능 | `afterdate` 파라미터로 며칠간 관측 |
| **응답 실물 JSON/XML 전문** | 키가 없어 **정상 응답 본문을 받지 못함.** 본 문서의 필드 목록은 개발가이드 v5.0 PDF와 아카이브된 공식 예제에서 가져온 것 | 키 발급 후 실호출 |
| `newsql=Y` 파라미터 | 2024 아카이브 문서에는 필수(`o`)로 표시, v5.0 개발가이드 요청 예제에는 없음. 현재 필수 여부 불명 | 실호출로 확인 |

### 9-2. 예술의전당 / 서울 열린데이터

| 항목 | 상태 |
|---|---|
| **SAC 이용약관의 자동수집 관련 조항** | 약관 페이지에서 크롤링 금지 조항을 **찾지 못했으나, 없다고 단정할 수 없다.** robots.txt가 해당 경로를 금지하지 않는다는 것만 확인됨 |
| **`getProgramCalList`의 안정성·레이트리밋** | 비공식 내부 엔드포인트. 문서·보장 없음 |
| **`getProgramCalListExcel` 사용 가능 여부** | 비인증 GET이 에러 페이지 반환. 세션/리퍼러 필요 추정 |
| **SAC 곡목 형식의 일관성** | 표본 32건 중 88%가 판독 가능했으나, `1. 프로그램` 헤더를 쓰는 비율 등 **정확한 포맷 분포는 미측정.** 파서를 만들 때 100건 이상 표본으로 패턴 정리 필요 |
| **`culturalEventInfo`의 `PROGRAM` 전체 충전율** | 샘플 키가 5행 제한이라 5건만 관측(2/5 채워짐). 실제 인증키로 재측정 필요 |
| **`culturalEventInfo`의 `CODENAME`에 `클래식` 값 존재 여부** | 관측된 값은 `콘서트`/`연극`/`전시,미술`뿐. 전체 코드 목록 미확인 |
| **세종문화회관 서울 열린데이터셋의 OpenAPI 제공 여부** | 파일 전용인지 API도 있는지 미확인 |

### 9-3. 티켓팅 3사

| 항목 | 상태 |
|---|---|
| **예스24 공연 이용약관의 크롤링 조항** | SPA라 약관 본문 취득 실패. **미확인** |
| **한국 판례상 크롤링 위법성 판단 기준** | 저작권법 §93(DB제작자 권리), 부정경쟁방지법 §2 1호 (파)목이 적용될 여지가 있다는 일반론까지만. **구체적 판례 검토는 하지 않았다 — 법률 자문 영역** |
| 각사 파트너/제휴 API 존재 여부 | 공개 문서 기준 없음. 비공개 제휴 프로그램은 확인 불가 |

### 9-4. 작품 사전 소스

| 항목 | 상태 |
|---|---|
| **Open Opus 레이트리밋** | 공식 문서에 언급 없음. 응답 헤더에도 없음. CDN 캐시(1시간)로 보호되는 구조로 보이나 **정책 미확인** |
| **Open Opus 데이터 갱신 주기** | 미확인 (버전 `1.20.6` 표기만 확인) |
| **IMSLP 메타데이터 전용 라이선스** | 사이트 전역 `rel=copyright`와 API `rightsinfo`가 **CC BY-SA 4.0**을 가리키지만, "메타데이터가 BY-SA"라고 **산문으로 명시한 문서는 없다.** IMSLP에는 이용약관 페이지 자체가 존재하지 않는다. 상업화 시 Project Petrucci LLC 문의 필요 |
| **IMSLP 총 작품 수** | `start=250000`에서도 `moreresultsavailable:true` → **25만 건 이상**. 정확한 총량을 API가 노출하지 않음 |
| **IMSLP API 레이트리밋 수치** | robots.txt `Crawl-delay: 2` 외에 문서화된 수치 없음 |
| **MusicBrainz alias의 CC0 여부 명시** | 라이선스 문서에 alias가 core/supplementary 어느 쪽인지 **명시되어 있지 않다.** supplementary 목록(annotation/tag/rating/statistics/search index/edit history/user data)에 없으므로 CC0로 보는 것이 자연스럽지만 **명시 확인 안 됨** |
| **`mbdump.tar.bz2`의 work 테이블 포함 명시** | 다운로드 문서가 `"tables for Artist, Release, Recording, etc."` 라고만 함. JSON 덤프에는 `work.tar.xz`가 독립 파일로 확실히 존재 |
| **MusicBrainz `work_attribute_type` 전체 목록** | 스키마 문서의 "Undocumented tables"에 있어 공식 목록 없음. 실측으로 `Key`와 저작권협회 ID만 확인 |
| **MetaBrainz 상업 라이선스 비용** | 페이지에 금액 없음 |
| **Cover Art Archive 라이선스 분류** | core/supplementary 어느 쪽인지 미명시 |

### 9-5. 이 조사에서 다루지 않은 것

- **곡목 복원의 대안 경로** — 리뷰 기사·블로그 후기에서 곡목을 복원하는 방법, 서울시향·국립심포니 등 **악단 자체 사이트**의 프로그램 게재 여부, 프로그램 북 레이아웃(OCR 프롬프트 설계용), 앙코르 곡 기록 소스. **별도 조사가 진행 중이며 이 문서에는 반영되지 않았다.**
  → 다만 §3-2e에서 예술의전당 사후 조회가 88% 작동함을 확인했으므로, 이 경로들의 **우선순위는 낮다.** 롯데콘서트홀·지방 공연장 커버가 필요해질 때 다시 본다.
- **좌석 등급별 가격 → `price_min/max` 파서의 실제 정확도.** 정규식 초안만 제시했고 표본 검증은 하지 않았다.
- **임베딩 매칭과 2단계 문자열 매칭의 정량 비교.** §5-1의 판단은 규모 분석과 실패 사례에 근거한 것이지, A/B 실험 결과가 아니다. 골든셋(§4-1 평가 프레임)이 생기면 재검증할 것.
- **KOPIS `mt20id` ↔ SAC `SN` 매칭 정확도.** 두 소스를 공연명+날짜+공연장으로 조인해야 하는데, 그 조인의 정확도는 측정하지 않았다. **§7-2 6단계의 숨은 위험이다.**

---

## 부록 — 재현용 명령

```bash
# Open Opus 전체 덤프 (3.3MB, CC0, 무인증)
curl -s https://api.openopus.org/work/dump.json -o openopus.json

# Wikidata 한국어 작곡가명 (11,816행, CC0, UA 필수)
curl -s -G https://query.wikidata.org/sparql \
  -H "Accept: application/sparql-results+json" \
  -H "User-Agent: ClassicLions/0.1 (contact@example.com)" \
  --data-urlencode 'query=
SELECT ?c ?enwiki ?ko (GROUP_CONCAT(DISTINCT ?alt;separator="|") AS ?alts) WHERE {
  ?c wdt:P106/wdt:P279* wd:Q36834 .
  ?c rdfs:label ?ko . FILTER(LANG(?ko)="ko")
  ?art schema:about ?c ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki .
  OPTIONAL { ?c skos:altLabel ?alt . FILTER(LANG(?alt)="ko") }
} GROUP BY ?c ?enwiki ?ko' -o wd_composers.json

# KOPIS 공통코드 PDF (장르코드 CCCA 등)
curl -sL -e "https://www.data.go.kr/data/15097805/openapi.do" \
  "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002498713&fileDetailSn=1" \
  -o kopis_code.pdf

# KOPIS 개발가이드 PDF (v5.0, 32p — 전 엔드포인트 필드 명세)
curl -sL "https://kopis.or.kr/upload/openApi/공연예술통합전산망OpenAPI개발가이드.pdf" -o kopis_guide.pdf

# 예술의전당 월간 일정 (비공식 내부 엔드포인트)
curl -s -X POST https://www.sac.or.kr/site/main/program/getProgramCalList \
  -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
  -H "X-Requested-With: XMLHttpRequest" \
  -e "https://www.sac.or.kr/site/main/program/schedule" \
  --data "searchYear=2026&searchMonth=10&searchFirstDay=1&searchLastDay=31&CATEGORY_PRIMARY="

# 예술의전당 공연 상세 (곡목 텍스트 포함)
curl -sL "https://www.sac.or.kr/site/main/show/show_view?SN=84095"

# 서울 열린데이터 문화행사 (샘플키, 5행 제한)
curl -s "http://openapi.seoul.go.kr:8088/sample/json/culturalEventInfo/1/5/"

# KOPIS 엔드포인트 생존 확인 (키 없이 에러코드 02 반환)
curl -s "http://kopis.or.kr/openApi/restful/pblprfr?service=TEST&stdate=20260801&eddate=20260831&cpage=1&rows=5"
```

---

*조사자 주: KOPIS 응답 본문(정상 200)만은 인증키 부재로 실물을 확보하지 못했다. 필드 목록은 공식 개발가이드 PDF v5.0(2026.04.23 배포)에서 그대로 옮겼으며, 곡목 부재는 해당 PDF 32페이지 전문 텍스트 검색으로 확인했다. 나머지 소스(Open Opus, MusicBrainz, Wikidata, IMSLP, SAC, 서울 열린데이터)는 전부 실제 호출로 응답을 받아 검증했다.*
