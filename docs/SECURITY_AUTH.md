# 보안 · 인증 · 개인정보 — Classic Lions

조사일 2026-08-27 · 담당: 보안/인증/개인정보
관련 문서: `ARCHITECTURE.md`, `docs/COMPETITIVE_RESEARCH.md`(§2-4 회전문, §6-6 이미지 서버비), `docs/GROUND_TRUTH_MINE.md`

> ⚠️ **이 문서는 법률 자문이 아니다.** 5장(한국 개인정보보호법)은 공개된 법령·감독기구 자료를 정리한 것이고,
> 실제 규제 판단은 변호사 또는 개인정보보호위원회에 확인해야 한다. 실무 준비 항목으로만 쓸 것.

---

## 1. 요약

### 권고 아키텍처 한 줄

> **사진은 기기 밖으로 나가지 않는다. 서버에는 PII가 제거된 텍스트만 올라간다. 로그인은 v1에서 안 받는다.**
> = **A로 출시하고, B로 갈 문을 열어둔다.**

풀어 쓰면:

1. **v1 = A(완전 로컬) + 명시적 백업/복원.** `회전문` 앱이 이미 이 포지션을 잡았고, 그건 마케팅이 아니라 생존 전략이다(§6-6). 로그인 없음 → 유출될 계정이 없음 → **해킹당할 표면이 0에 수렴한다.**
2. **v2에서 B(로컬 우선 + 텍스트만 클라우드)로 확장.** 그때 로그인이 처음 필요해진다.
3. **C(전부 클라우드)는 어느 단계에서도 선택하지 않는다.** 플앱을 죽인 원가 구조이자(§6-6), 유출 시 실명·예매번호·QR이 통째로 나가는 유일한 구조다.

### 왜 이 결론이 특별히 강하게 성립하는가 — 우리 코드는 이미 절반쯤 와 있다

이번 조사에서 **리포지토리를 직접 읽어 확인한 사실**들이다. 이게 권고의 핵심 근거다.

| 확인한 것 | 파일 | 의미 |
|---|---|---|
| OCR 프롬프트가 **예매번호를 뽑지 말라고 명시**한다 — *"티켓 하단의 작은 글씨(예매번호, 취소 규정, 바코드 숫자)는 어떤 필드에도 넣지 마세요"* | `app/services/ocrSchema.ts:191` | **구조화 데이터는 이미 PII-free다** |
| `Concert` 타입에 **이름·예매번호 필드가 아예 없다** (`imageUrl?: string`만 있음) | `app/types.ts:24-52` | 저장 스키마에 PII 자리가 없다 |
| `prepareTicketImage()`가 canvas로 **재인코딩**한다 (`drawImage` → `toBlob('image/jpeg', 0.85)`) | `app/services/imagePrep.ts` | **EXIF GPS가 이미 제거된다** (§6-4) |
| 저장·전송 모두 재인코딩 결과만 쓴다 (`prepared.dataUrl`, `prepared.base64`) — 원본 `File`은 절대 영속화되지 않는다 | `app/components/TicketOCR.tsx:120-129, 215` | 원본이 남지 않는다 |
| `.gitignore`가 `.env`, `.env.local`, `testdata/tickets_mine/`(실명·예매번호·QR), `work/`를 이미 제외 | `.gitignore` | 비밀·PII 커밋 사고 예방됨 |

→ **PII는 오직 "사진 한 장" 안에만 있다.** 그 사진을 서버에 올리지 않기로 하면, 우리가 지켜야 할 개인정보는 사실상 없어진다.

⚠️ **단, "완전 로컬이니까 개인정보처리방침이 필요 없다"는 성립하지 않는다.** OCR을 위해 이미지를 Google(Gemini)에 보내는 것 자체가 **처리위탁 + 국외 이전**이다. 처리방침 1장은 어느 아키텍처에서도 필수다 (§5-1).

### 반대로, 지금 당장 고쳐야 하는 것 2가지

| # | 문제 | 위치 | 심각도 |
|---|---|---|---|
| **S1** | **Gemini API 키가 빌드 번들에 평문**으로 박힌다 (`define`은 빌드 시 문자열 치환) | `app/vite.config.ts:63-67` | 🔴 **배포 불가.** 요금 폭탄 직결 (§6-1) |
| **S2** | **Gemini 무료 티어는 사람이 우리 티켓 사진을 열람할 수 있다** | 정책 문제 | 🔴 실명·예매번호가 제3자에게 노출 (§1-1 아래) |

S1은 코드에 이미 경고 주석과 빌드 경고 플러그인(`apiKeyWarningPlugin`)이 달려 있다 — 팀이 알고 있는 문제다. **S2는 이번에 새로 발견했다.**

#### S2 상세 — Gemini 무료 티어의 사람 검토

Google Gemini API 약관 (https://ai.google.dev/gemini-api/terms):

| 티어 | 약관 문구 |
|---|---|
| **무료(Unpaid)** | *"To help with quality and improve our products, **human reviewers may read, annotate, and process your API input and output.**"* |
| **유료(Paid)** | *"Google **doesn't use** your prompts (including associated system instructions, cached content, and files such as images, videos, or documents) or responses to improve our products"* — 로그는 남기되 금지사용정책 위반 탐지 목적으로 한정 |

**우리 티켓 사진에는 실명·예매번호·QR이 찍혀 있다**(`docs/GROUND_TRUTH_MINE.md`: 14장 중 12장 `has_pii: true`).
→ **무료 티어로 OCR을 돌리면 사용자의 실명이 Google 검토자에게 보일 수 있다.** 이건 기술 문제가 아니라 계약·고지 문제다.

**대응 (셋 다 필요):**
1. **출시 전 반드시 유료(paid) 티어로 전환한다.** 무료 티어로 실사용자 티켓을 처리하지 않는다.
2. 개인정보처리방침에 **"AI 이미지 분석을 위해 Google에 이미지를 전송하며, 처리 후 보관하지 않는다"**를 명시한다(처리위탁 + 국외 이전 고지, §5).
3. 가능하면 **업로드 전 마스킹**을 검토한다 (§6-5).

---

## 2. 세 아키텍처 비교

### 2-1. 비교표

| | **A. 완전 로컬** | **B. 로컬 우선 + 텍스트만 클라우드** | **C. 전부 클라우드** |
|---|---|---|---|
| 로그인 | **없음** | 필요 | 필요 |
| 사진 저장 | 기기에만 | **기기에만** | 서버 |
| 텍스트(공연명·좌석·곡목) | 기기에만 | 서버 동기화 | 서버 |
| 동기화 | 파일 내보내기/가져오기 (수동) | 자동 | 자동 |
| 다중 기기 | ❌ (파일로만) | ✅ | ✅ |
| 기기 분실 시 | 백업 파일 있으면 복구 | ✅ 자동 복구 | ✅ 자동 복구 |
| **유출 시 피해** | **없음 — 유출될 서버가 없다** | 공연 기록 텍스트 (PII 아님) | **사진 + 실명 + 예매번호 + QR** |
| 서버 원가 | **0** | 텍스트는 KB 단위 → 사실상 0 | 관람 1회당 5~10MB (§6-6) → **플앱의 죽음** |
| 개인정보보호법 부담 | 최소 (§5-2) | 낮음 | 높음 — 유출 신고 의무·안전조치 전부 적용 |
| 규제 사고 시나리오 | 없음 | 계정 탈취 → 관람 기록 노출 | **계정 탈취 → 실명 + 신분 확인 가능한 QR 노출** |

**C의 피해가 왜 유독 큰가:** 티켓 QR/바코드는 단순 문자열이 아니라 **입장 자격 그 자체**다. 실명 + 예매번호 + QR이 한 세트로 유출되면 사칭 입장·예매 조회·취소가 가능해질 수 있다. 이건 "이메일 유출"과 급이 다르다.

### 2-2. 실제 앱 사례

| 앱 | 방식 | 근거 |
|---|---|---|
| **`회전문`** (2026-06, 뮤지컬 관극 기록) | **A** | 앱 소개문: *"**완전 로컬 — 외부 서버 없음, 데이터는 당신의 기기에만**"* / *"백업 / 복원 (파일 단위로 직접 관리)"* — https://apps.apple.com/kr/app/id6772543977 (`COMPETITIVE_RESEARCH.md` §2-4) |
| **플앱 (PL@Y2)** | **C** | 창업자 회고: 이미지 DB **1,000만 파일**까지 커지며 서버비 폭증, *"다운로드가 나와도 **적자로 운영**"* — https://brunch.co.kr/@redkurtain/12 (§6-6) |
| **포도알 · 포키** | 클라우드/로컬 혼재 | 리뷰 최다 사고가 **"기록이 통째로 날아갔다"** — 포키는 백업·로그인이 없어 리뷰 절반이 데이터 유실 호소 (§2-3-d) |
| **MaestLog** (클래식 티켓 OCR) | 사진 즉시 폐기 | *"AI 이미지 분석은 (…) 처리 후 즉시 삭제"* — https://apps.apple.com/kr/app/id6752569728 (§6-6) |
| **Bear** (메모) | **A + CloudKit** | *"Bear relies on Apple's CloudKit technology to sync your notes"*, *"doesn't require any registration or login"*, *"we don't want to access your data at all"* — https://bear.app/faq/syncing-privacy/ |
| **Obsidian** (메모) | **A + 유료 동기화** | 로컬 평문 파일이 원본. Sync는 **$4/월** 부가 옵션, *"Your data is automatically secured using AES-256"* — https://obsidian.md/sync |
| **Day One** (일기) | E2EE + 자체 동기화 | ⚠️ **이번 조사에서 원문 확인 실패** (사이트가 WebFetch 403). 인용하지 말 것 |

→ **패턴이 분명하다.** 우리와 가장 가까운 두 앱(회전문 = 같은 카테고리, Bear = 같은 저장 성격)이 **둘 다 A**를 골랐고, **C를 고른 플앱만 원가로 죽었다.**

### 2-3. ⚠️ A의 진짜 한계 — 그리고 그걸 어떻게 막는가

경쟁 조사의 최다 불만이 **"기록이 날아갔다"**이고(§2-3-d, §5 P0-1), **A는 그 위험을 키운다.** 이걸 정면으로 다루지 않으면 A는 답이 아니다.

**현재 우리 상태가 특히 나쁘다:** `app/services/storage.ts`는 **localStorage**에 base64 이미지를 통째로 넣는다.
- 브라우저 캐시/사이트 데이터 삭제 **한 번에 전소**된다.
- localStorage 쿼터(보통 5~10MB)를 사진 몇 장이면 넘긴다 — 코드에 이미 쿼터 초과 시 이미지를 버리는 `degraded` 경로가 있다(`App.tsx:39`). **즉 지금은 "저장했다고 믿었는데 사진이 없는" 상태가 정상 동작이다.**

**A를 성립시키는 3중 방어:**

1. **저장소를 localStorage → IndexedDB(또는 네이티브 SQLite)로 옮긴다.** 쿼터가 훨씬 크고 Blob을 base64 팽창(+33%) 없이 저장한다. `ARCHITECTURE.md`가 이미 Drift(로컬 SQLite)를 계획하고 있다 — 그 방향이 맞다.
2. **명시적 백업 파일 내보내기/가져오기.** `회전문`이 채택한 방식이다("파일 단위로 직접 관리"). 사용자가 파일 하나를 어디든(iCloud Drive, 구글 드라이브, 카톡 나에게 보내기) 두면 그게 백업이다. **우리가 서버를 운영하지 않고도 복구 경로가 생긴다.**
3. **OS 무료 백업 경로에 얹는다** (아래 2-4).

그리고 **사용자에게 정직하게 말해야 한다.** "완전 로컬"은 프라이버시 셀링포인트인 동시에 *"백업 안 하면 날아갑니다"*라는 계약이다. 백업을 안 한 지 오래된 사용자에게 능동적으로 알려야 한다.

### 2-4. OS가 공짜로 주는 백업 경로 — 서버 없이 동기화가 되는가

**결론: 백업은 된다. 진짜 실시간 동기화는 iOS(CloudKit)에서만 깔끔하게 된다.**

| 경로 | 한도 | 개발자 비용 | 확인된 사실 |
|---|---|---|---|
| **Android Auto Backup** | **앱당 25MB** | **무료** | *"Every app can allocate up to 25 MB of backup data per app user. **There's no charge for storing backup data**"* — 사용자 구글 드라이브의 비공개 폴더에 저장. Wi-Fi + 유휴 + 24시간 경과 조건. 초과 시 `onQuotaExceeded()` 호출되고 그 회차는 건너뜀 — https://developer.android.com/identity/data/autobackup |
| **Apple CloudKit 프라이빗 DB** | 사용자 iCloud 용량에 과금 | 개발자 무료 | Bear가 이걸로 계정 없이 동기화한다(위 §2-2). ⚠️ **정확한 요금/쿼터 문구는 이번에 확인 실패** — Apple 페이지가 JS 렌더링이라 본문 추출 불가. 확인된 것은 퍼블릭 DB의 *"up to 1PB of storage for your app's public data"*뿐 (https://developer.apple.com/icloud/cloudkit/). **의사결정 전 브라우저로 직접 확인할 것** |
| **Apple NSUbiquitousKeyValueStore** | **전체 1MB / 키 1024개** | 무료 | *"The total amount of available storage space for all values is 1 megabyte."* — https://developer.apple.com/documentation/foundation/nsubiquitouskeyvaluestore → **사진 아카이빙에는 완전히 부적합.** 설정값 동기화용 |
| **Google Drive App Data 폴더** | — | 무료 | *"This folder is only accessible by your app and its contents are hidden from the user and from other Google Drive apps."* — https://developers.google.com/drive/api/guides/appdata . ⚠️ **사용자 드라이브 쿼터를 차감하는지는 확인 못 함** |

**Android 25MB의 현실:** 관람 1회당 5~10MB(§6-6)이면 **25MB는 티켓 3~5장**이다. 사진까지 Auto Backup에 담는 건 불가능하다.
→ **분리하라: 텍스트 기록(KB 단위)은 Auto Backup / KV Store에 얹고, 사진은 사용자가 내보낸 백업 파일로만 관리한다.** 이 분리는 §1의 권고("사진은 기기 밖으로 안 나간다")와 정확히 같은 선이다.

⚠️ **크로스플랫폼 주의:** Flutter/React Native는 CloudKit도 NSUbiquitousKeyValueStore도 기본 제공하지 않는다 — 네이티브 채널이나 서드파티 플러그인이 필요하다. Android Auto Backup은 매니페스트 설정으로 OS 레벨에서 자동 동작한다. **구체적 패키지 이름은 이번 조사에서 확인 못 했다** (§7).

---

## 3. 인증 — 구글 로그인을 받아야 하나

### 3-1. 권고

> **v1: 로그인 없음.** v2에서 클라우드 동기화를 붙일 때 **Apple + Google**로 시작하고, 한국 사용자 반응을 보고 **Kakao**를 추가한다.

이유:
- **아키텍처 A에는 로그인이 필요 없다.** 서버가 없으니 인증할 대상이 없다.
- 로그인을 안 받으면 **Apple 심사 규정 4.8이 아예 적용되지 않는다** (§3-3).
- 로그인은 그 자체로 공격 표면이자 이탈 지점이다. 첫 화면이 로그인인 앱은 설치 직후 이탈이 는다.
- **로그인을 안 받으면 우리가 보관할 개인정보가 없다** → §5의 규제 부담이 극적으로 줄어든다.

**포기하는 것:** 다중 기기 동기화, 기기 분실 시 자동 복구. → 백업 파일 내보내기로 대체한다 (§2-3).

### 3-2. 소셜 로그인이 자체 비밀번호보다 안전한 실무적 이유

전부 같은 한 문장으로 요약된다: **없는 것은 유출되지 않는다.**

1. **비밀번호 해시 DB가 없다** → 유출될 자격증명 자체가 없다.
2. **크리덴셜 스터핑 표적이 아니다** — 남의 앱에서 털린 비밀번호로 우리 앱을 두드릴 대상이 없다.
3. **비밀번호 재설정 메일 흐름을 안 만들어도 된다** — 1인 개발자가 가장 자주 틀리는 부분(토큰 만료·재사용·계정 열거)이 통째로 사라진다.
4. **MFA는 제공자(Google/Apple/Kakao)의 문제가 된다.** 우리가 구현할 수 없는 수준의 보안을 공짜로 얻는다.

**실제 사례 — RockYou (2009):** MySpace/Facebook 위젯을 만들던 **소규모 개발사**가 비밀번호를 **해시도 안 하고 평문으로** 저장했다가, 10년 묵은 SQL 취약점으로 **3,200만 개 이상의 계정**이 유출됐다. FTC가 2012-03-27 제재했다. — https://en.wikipedia.org/wiki/RockYou
→ 이 유출본(`rockyou.txt`)은 지금도 전 세계 비밀번호 크래킹의 표준 사전으로 쓰인다. **한 번 나간 비밀번호는 영구히 회수 불가하다.**

### 3-3. Apple "Sign in with Apple" 강제 정책 — 현행 규정

가이드라인 §4.8은 이제 **"Sign in with Apple"이 아니라 "Login Services"**로 제목이 바뀌었고, **특정 제공자를 지정하지 않는다.** 현행 원문 (https://developer.apple.com/app-store/review/guidelines/):

> **4.8 Login Services**
> Apps that use a third-party or social login service (such as Facebook Login, Google Sign-In, Log in with X, Sign In with LinkedIn, Login with Amazon, or WeChat Login) to set up or authenticate the user's primary account with the app **must also offer as an equivalent option another login service** with the following features:
> - the login service **limits data collection to the user's name and email address**;
> - the login service **allows users to keep their email address private** as part of setting up their account; and
> - the login service **does not collect interactions with your app for advertising purposes without consent**.

**면제 조항(원문):** 자사 자체 계정 시스템만 쓰는 앱 / 대체 앱 마켓플레이스 / 기존 교육·기업 계정 로그인을 요구하는 교육·기업·비즈니스 앱 / 정부·산업계 시민 신원확인 시스템 / **특정 서드파티 서비스의 클라이언트**로서 사용자가 해당 계정에 직접 로그인해야 콘텐츠에 접근하는 앱.

**우리에게 적용하면:**

| 우리 선택 | 4.8 적용? |
|---|---|
| **로그인 없음 (v1 권고)** | ❌ **적용 안 됨.** 서드파티 로그인을 안 쓰니 규정 자체가 발동하지 않는다 |
| Google만 | ✅ 적용 — 동등 옵션 필요 |
| Kakao만 | ✅ 적용 — 동등 옵션 필요 |
| Google + Kakao | ✅ 적용 — 동등 옵션 필요 |

**Kakao 로그인은 위 3개 조건을 만족하지 못한다** (이메일 익명 릴레이가 없고 기본 수집 범위가 이름+이메일보다 넓다). 우리 앱은 면제 조항 다섯 개 중 어디에도 해당하지 않는다(교육/기업 아님, 특정 서드파티 클라이언트 아님, 정부 신원확인 아님).
→ **결론: Google이든 Kakao든 하나라도 넣는 순간, 사실상 Sign in with Apple도 넣어야 iOS 심사를 통과한다.** 규정 문구는 제공자 중립이지만 실무 결과는 그렇다.

### 3-4. 한국에서 카카오 로그인이 실질적으로 필요한가

**필요성 근거:** 카카오톡 MAU **4,890만 명 = 한국 전체 인구의 94.7%**, 인터넷 이용자의 97.2%. (비교: YouTube 4,340만/84.0%, Instagram 2,360만/45.7%) — https://datareportal.com/reports/digital-2025-south-korea
→ 사실상 모든 한국 성인이 이미 카카오 계정을 갖고 앱을 깔아둔 상태다. 이게 카카오 로그인이 한국 앱의 기본값인 이유다.

⚠️ **다만 "소셜 로그인 점유율"(카카오 vs 네이버 vs 구글 vs 애플 로그인) 직접 통계는 이번 조사에서 못 찾았다.** 위 숫자는 메신저 침투율이지 로그인 점유율이 아니다 (§7).

**1인(개인) 개발자 제약 — Kakao Developers 문서 확인:**
- **기본 카카오 로그인은 사업자등록 없이 개인 개발자도 프로덕션에서 쓸 수 있다.** 필수 준비물은 카카오 로그인 활성화 + Redirect URI 등록뿐. — https://developers.kakao.com/docs/ko/kakaologin/prerequisite
- **그러나 동의항목 상당수가 "추가 기능 신청"(검수)을 요구한다**: 이름, 성별, 연령대, 생일, 출생연도. 친구목록·메시지 전송은 "사용 권한 신청" 별도. — https://developers.kakao.com/docs/ko/kakaologin/utilize
- **⚠️ 카카오계정(이메일)은 비즈 앱 또는 테스트 앱 전용이다.** 프로덕션에서 이메일을 받으려면 **비즈 앱 전환 + 비즈니스 정보 심사**를 거쳐야 한다.
- ⚠️ **개인이 사업자등록번호 없이 비즈 앱 전환을 완료할 수 있는지는 확인하지 못했다** (§7). 카카오 이메일에 의존하는 설계를 하기 전에 개발자 콘솔에서 직접 확인할 것.

→ **실무 판단: 카카오 로그인은 "닉네임 + 카카오 사용자 ID"까지는 개인 개발자도 즉시 가능하다. 이메일이 필요하면 심사 관문이 있다.** 우리는 애초에 이메일이 필요 없으므로(§5-2 최소수집) 이 관문을 피할 수 있다.

### 3-5. 익명 로그인 — 로그인과 무로그인 사이

동기화가 필요해졌을 때 "계정을 만들게 하지 않고" 넘어가는 중간 단계다. **단, 영구 신원이 아니다.**

**Supabase Anonymous Sign-ins** (https://supabase.com/docs/guides/auth/auth-anonymous):
- `auth.users`에 실제 행을 만들고 `is_anonymous` 클레임이 담긴 JWT를 발급 → RLS 정책에서 구분 가능.
- ⚠️ 공식 한계: *"the user can't access their account if they **sign out, clear browsing data, or use another device**."*
- ⚠️ 공식 악용 경고: *"bad actors can abuse the endpoint to **increase your database size drastically**."* → IP당 시간당 30건 기본 제한, **CAPTCHA 활성화 강력 권장**.
- 나중에 `linkIdentity()`로 Google 등에 연결 가능(데이터 병합 충돌 처리 필요).

**Firebase Anonymous Auth** (https://firebase.google.com/docs/auth/web/anonymous-auth):
- IP당 신규 익명 가입 제한. Identity Platform 업그레이드 프로젝트는 **"Anonymous accounts older than 30 days will be automatically deleted"**(실제 자격증명에 연결되지 않은 경우).
- `linkWithCredential()`로 연결하면 *"the user's new account can access the anonymous account's Firebase data."*

→ **익명 인증은 "복구 경로"가 아니다.** 양쪽 문서 모두 임시/가교 신원으로 규정한다. 기기 분실 복구는 여전히 **백업 파일**이 담당한다 (§2-3).

---

## 4. Supabase 보안 체크리스트

> Supabase를 쓴다면 — 즉 아키텍처 B로 갈 때 — 의 이야기다. v1(A)에서는 Supabase가 필요 없다.

### 4-1. 🔴 RLS 미설정 사고 — 실제 사례

#### CVE-2025-48757 — Lovable.dev 생성 앱들의 RLS 누락

이 카테고리에서 **가장 잘 문서화된 실제 사고**다.

| 항목 | 내용 |
|---|---|
| 발견자 | Matt Palmer (독립 보안 연구자) |
| 발견 | 2025-03-20 / 벤더 통보 2025-03-21 / 인정 2025-03-24 |
| 공개·CVE 부여 | **2025-05-29, CVE-2025-48757** |
| 범위 | Lovable 쇼케이스의 **1,645개 프로젝트**를 자동 스캔 → **170개 프로젝트(≈10.3%)에서 303개 취약 엔드포인트** |
| 유출 데이터 | 이름, 이메일, LinkedIn URL, **서드파티 API 키/액세스 토큰**(Google Maps, Gemini API, eBay), 거래·구독 정보. 일부는 **결제 상태를 수정**할 수 있었다(읽기가 아니라 쓰기) |
| 벤더 대응 | 초기에 이슈를 부인하고 커뮤니티 글을 삭제. 2025-04-24 "Lovable 2.0"에 보안 스캐너 탑재 — **다만 RLS 정책의 "존재"만 검사하고 "정확성"은 검사하지 않아 이 버그 유형을 못 잡는다**(Palmer 후속 성명). 영향받은 최종 사용자에게 능동 통지하지 않음 |

출처: https://mattpalmer.io/posts/2025/05/CVE-2025-48757/ · https://mattpalmer.io/posts/2025/05/statement-on-CVE-2025-48757/ · https://securityonline.info/cve-2025-48757-lovables-row-level-security-breakdown-exposes-sensitive-data-across-hundreds-of-projects/

> ⚠️ **정정:** 이 사건을 "수천 개 앱"으로 인용하는 2차 블로그가 많지만, **1차 출처가 보고하는 검증된 숫자는 1,645개 중 170개**다. 우리는 정확한 숫자를 쓴다.

**우리에게 주는 교훈:** LLM으로 빠르게 만든 앱에서 **10곳 중 1곳이 RLS를 빠뜨렸다.** 우리도 같은 방식으로 만들고 있다. RLS는 "나중에 챙길 것"이 아니라 **테이블 생성과 동시에** 챙겨야 한다.

#### Tea (Tea Dating Advice) 유출, 2025-07 — ⚠️ Supabase가 아니라 Firebase였다

과제에서 언급된 사건인데, **확인 결과 Supabase 사고가 아니다.** 그래도 우리에게 가장 무서운 사례라 남긴다 — **신분증 사진이 유출된 케이스**이기 때문이다.

- 공개: 2025-07-25~26
- **약 72,000장의 이미지 유출** — 그중 **약 13,000장이 셀피 + 정부 발급 신분증**(계정 인증용), 나머지 약 59,000장은 게시물·댓글·메시지 이미지
- 원인: **레거시 Firebase 스토리지 버킷이 인증 없이 공개 접근 가능**한 상태로 방치. Tea 측은 2024-02 업데이트 이전 데이터로 자사 보존정책상 이미 삭제됐어야 할 데이터라고 밝힘
- 직후 **약 110만 건의 비공개 DM** 추가 노출 보고

출처: https://www.reuters.com/sustainability/boards-policy-regulation/womens-dating-app-tea-reports-72000-images-stolen-security-breach-2025-07-26/ · https://techcrunch.com/2025/07/26/dating-safety-app-tea-breached-exposing-72000-user-images/ · https://cyberinsider.com/tea-app-suffers-data-breach-exposing-72000-users-photos-and-private-messages/

→ **이게 정확히 아키텍처 C의 최악 시나리오다.** "인증 사진을 서버에 모아뒀고, 삭제했어야 할 걸 안 삭제했고, 버킷 권한이 열려 있었다." **우리 티켓 사진(실명+예매번호+QR)이 같은 성격의 자산이다.** 서버에 안 올리면 이 사고는 구조적으로 불가능하다.

> ⚠️ **검증 실패 항목:** "Moltbook" Supabase 유출 건은 신뢰도 낮은 단일 집계 사이트에서만 발견됐고 Wiz 공식 블로그 등 어디서도 교차 확인되지 않았다. **인용하지 말 것** (§7).

#### Supabase 자신의 경고

- 린트 규칙 **"RLS Disabled in Public" (0013)**: *"anyone with your project URL can read, edit, and delete all data in this table because Row-Level Security is not enabled."* — https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
- *"A table in an exposed schema without RLS is **readable and writable by any role with a grant on it**."* — https://supabase.com/docs/guides/database/postgres/row-level-security
- ⚠️ **함정:** `public` 스키마의 새 테이블은 `anon`·`authenticated`·`service_role`에 **select/insert/update/delete 권한이 기본으로 부여된다.** RLS 정책을 추가하는 것만으로 이 하위 GRANT가 회수되지 않는다 — 명시적으로 `REVOKE` 해야 한다.
- 프로덕션 체크리스트가 "모든 테이블에 RLS 활성화"와 대시보드 **Security Advisor** 검토를 명시 — https://supabase.com/docs/guides/deployment/going-into-prod

### 4-2. anon(publishable) 키 — 왜 클라이언트에 넣어도 되는가

https://supabase.com/docs/guides/api/api-keys 기준:

- 공식 표현: **"Safe to expose online: web page, mobile or desktop app, GitHub actions, CLIs, source code."** 권한 등급 "Low", *"비밀을 지키는 것이 불가능한 환경"*을 위해 설계됨.
- **무엇이 이 키를 지키는가:** 키 자체가 아니라 **Postgres RLS**다. *"access to your project's data is guarded by Postgres via the built-in `anon` and `authenticated` roles."*
- **언제 안전하지 않은가:**
  1. **RLS를 안 켰을 때** → 키가 곧 전체 DB 접근권이 된다 (§4-1이 정확히 이 사고다)
  2. `anon` 롤에 과도한 권한을 줬을 때
  → **anon 키는 "공개해도 되는 키"가 아니라 "RLS가 제대로 걸려 있을 때만 공개해도 되는 키"다.**
- **2025년 키 명명 변경:** `anon` → **`sb_publishable_...`**, `service_role` → **`sb_secret_...`**. 기존 JWT 형식 레거시 키는 **2026년 말 폐기 예정**.

### 4-3. service_role(secret) 키 — 절대 클라이언트 금지

- Postgres의 **`BYPASSRLS` 속성**을 쓴다: *"has full access to your project's data"*, *"**skips any and all Row Level Security policies**."*
- 공식 지침: *"Only use in backend components of your app: servers, already secured APIs (admin panels), Edge Functions, microservices, etc."* 웹페이지·모바일앱·브라우저 금지 — *"anyone can retrieve the key from the source code or build artifacts."*
- **방어선이 하나 더 있긴 하다(믿지 말 것):** Supabase API는 `User-Agent` 헤더로 브라우저를 감지해 secret 키 사용 시 **항상 HTTP 401**을 반환한다. 심층 방어일 뿐 서버 보관의 대체재가 아니다.
- 추가 지침: URL/쿼리 파라미터에 넣지 말 것(로그에 남는다), 채팅·이메일·SMS로 보내지 말 것, 패키지에 번들하지 말 것. **백엔드 컴포넌트마다 별도 secret 키**를 써서 폭발 반경을 줄일 것. 폐기(revoke)는 되돌릴 수 없다.

⚠️ service_role 키가 클라이언트 번들/공개 리포에서 발견된 **구체적 명명 사고 사례는 이번 조사에서 확인 못 했다** (§7). "사례가 없다"가 아니라 "못 찾았다"이다.

### 4-4. Storage 버킷 권한의 함정

https://supabase.com/docs/guides/storage/buckets/fundamentals · https://supabase.com/docs/guides/storage/security/access-control

- **Public 버킷:** *"Anyone who possesses the asset URL can readily access the file"* — 읽기에 인증이 전혀 없다. RLS는 업로드·삭제·이동·복사에만 적용된다.
- **Private 버킷 (기본값):** *"All operations are subject to access control via RLS policies"* — 다운로드/읽기 포함.
- 🔴 **가장 중요한 함정:** **대시보드에서 버킷을 "private"으로 만드는 것만으로는 객체가 보호되지 않는다.** `storage.objects` 테이블에 **연산별(SELECT/INSERT/UPDATE/DELETE) RLS 정책을 직접 써야 한다.** 일반 테이블과 똑같다. (*"By default Storage does not allow any uploads to buckets without RLS policies"*)
- **Signed URL** (https://supabase.com/docs/guides/storage/serving/downloads):
  - 서버에서 `createSignedUrl()`로 생성, 시간 제한(문서 예시 3600초).
  - Auth JWT 서명 키와 **별개의 내부 키**로 서명 → Auth 키를 로테이션해도 무효화되지 않는다.
  - ⚠️ **조기 폐기(revoke) 기능이 없다.** 만료 전에 URL이 새면 Supabase 지원에 문의하는 수밖에 없다. → **만료 시간을 짧게 잡아라.**

### 4-5. 무료 티어 한도와 초과 시 — 플앱처럼 무너지지 않으려면

https://supabase.com/pricing (2026-08 기준 실시간 확인)

| 항목 | Free | Pro (월 $25~) | Pro 초과 단가 |
|---|---|---|---|
| DB | 500 MB | 8 GB 포함 | **$0.125/GB** |
| 파일 스토리지 | **1 GB** | 100 GB 포함 | **$0.0213/GB** |
| Egress(전송량) | **5 GB** (+캐시 5 GB) | 250 GB 포함 | **$0.09/GB** (캐시 $0.03/GB) |
| MAU | 50,000 | 100,000 포함 | $0.00325/MAU |
| 프로젝트 정지 | **1주 미사용 시 일시정지** | 정지 없음 | — |

**Free 티어에는 pay-as-you-go가 없다** — 초과하면 과금이 아니라 **막히거나 정지된다.** 취미 프로젝트에는 오히려 안전장치다.

🔴 **아키텍처 C를 이 숫자에 대입해 보면:**
- 관람 1회당 5~10MB(§6-6) → **Free 1GB 스토리지 = 사용자 1명의 100~200회 관람분**. 월 1회 이상 보는 헤비 유저 **10명이면 무료 티어가 찬다.**
- **더 무서운 건 스토리지가 아니라 egress다.** 사용자가 자기 아카이브를 스크롤할 때마다 사진이 내려간다. 저장은 한 번이지만 **전송은 볼 때마다** 일어난다. Pro 초과 $0.09/GB에서, 사용자 1,000명이 각자 월 100MB만 봐도 100GB → 무료분을 넘기면 곧장 요금이다.
- **이게 플앱이 겪은 일의 구조다.** 이미지 파일 수가 서버비를 밀어올렸고, 다운로드가 나와도 적자였다.

→ **사진을 서버에 안 올리면 이 표의 스토리지·egress 칸이 통째로 무의미해진다.** 텍스트 기록은 관람 1회당 수 KB다. **같은 사용자 수에서 원가가 1,000배 차이 난다.**

### 4-6. Supabase 실전 체크리스트

- [ ] **모든 테이블에 `ENABLE ROW LEVEL SECURITY`.** 예외 없음
- [ ] `public` 스키마 새 테이블의 기본 GRANT를 `REVOKE`했는가 (RLS만으로는 안 걷힌다)
- [ ] 모든 정책이 `auth.uid() = user_id` 형태로 **소유자를 검증**하는가
- [ ] `storage.objects`에 **연산별 RLS 정책**을 직접 작성했는가 (버킷 private 설정만으로 부족)
- [ ] 배포 전 **Security Advisor** 를 돌리고 0013 경고가 0인가
- [ ] `service_role`/`sb_secret_` 키가 클라이언트 코드·번들·리포에 **한 건도** 없는가 (`grep`으로 확인)
- [ ] Signed URL 만료 시간이 짧은가 (폐기 불가하므로)
- [ ] 익명 로그인을 쓴다면 **CAPTCHA를 켰는가** (DB 팽창 악용 경고)
- [ ] **RLS 정책을 테스트로 검증했는가** — 다른 사용자의 JWT로 남의 행을 못 읽는지 실제로 실행해 볼 것. Lovable의 스캐너가 실패한 지점이 정확히 "정책이 존재하는가"만 보고 "정책이 맞는가"를 안 본 것이다

---

## 5. 한국 개인정보보호법 실무 요건

> ⚠️ **법률 자문이 아니다.** 아래는 공개된 법령 요약·감독기구 자료·로펌 국가별 가이드를 정리한 것이다.
> 실제 판단은 변호사 또는 개인정보보호위원회에 확인해야 한다.
>
> ⚠️ **출처 품질 경고.** 이번 조사에서 **법제처 `law.go.kr`이 JS 렌더링이라 조문 원문 추출에 실패했다.**
> 그래서 아래 상당수가 **나무위키의 법령 정리**와 **DLA Piper 국가별 가이드**를 경유한 2차 인용이다.
> 조문 번호와 큰 얼개는 신뢰할 만하지만, **금액·기한·요건을 실제로 확정할 때는 반드시 법제처 원문을 직접 확인할 것.**

### 5-1. 개인정보처리방침 — 1인 개발자도 의무다

**결론: 필수다. 규모·매출에 따른 면제 조항을 찾지 못했다.**

- **제30조**가 모든 개인정보처리자에게 개인정보처리방침 수립·공개 의무를 지운다.
- **제2조 제5호**의 "개인정보처리자" 정의: *"업무를 목적으로 개인정보파일을 운용하기 위하여 스스로 또는 다른 사람을 통하여 개인정보를 처리하는 공공기관, 법인, 단체 및 **개인** 등"*
  → **"개인"이 명시적으로 포함된다.** 1인 개발자도 개인정보처리자다.
- DLA Piper의 한국 편도 **소규모 사업자/1인 개발자 면제가 없다**고 정리한다 — https://www.dlapiperdataprotection.com/index.html?t=law&c=KR
- **위반 시 과태료: 1천만원 이하** (제75조 제4항 제8호 — 처리방침을 정하지 않거나 공개하지 않은 자)

**처리방침에 담아야 하는 것** (제30조 구조 기준):
처리 목적 / 처리·보유 기간 / 제3자 제공 현황 / **처리위탁 현황(있는 경우)** / 정보주체의 권리와 행사 방법 / 파기 절차·방법 / **개인정보 보호책임자 연락처** / 안전성 확보조치 등 대통령령이 정하는 사항

출처: https://namu.wiki/w/개인정보%20보호법 (⚠️ 위키 경유 2차 인용)

> 🔴 **우리에게 즉시 적용되는 것:** 티켓 이미지를 OCR하러 **Google(Gemini)에 보내는 것은 처리위탁이자 국외 이전**이다(제26조 / 제28조의8). 로컬 전용 아키텍처를 택하더라도 **이 한 건 때문에** 처리방침이 필요하다. 즉 **"완전 로컬이니까 처리방침이 필요 없다"는 성립하지 않는다.**

### 5-2. ⭐ 수집 최소화와 "기기 안에서만 처리" — 이 문서에서 가장 중요한 질문

**질문:** 사진·실명·예매번호를 **어떤 서버에도 저장하지 않고 사용자 기기 안에서만** 처리하면, 규제 부담이 얼마나 줄어드는가?

**답변 (⚠️ 이건 확인된 유권해석이 아니라 조문 정의로부터의 추론이다):**

| | 판단 |
|---|---|
| **여전히 개인정보처리자인가?** | **그렇다고 봐야 한다.** "처리"에는 수집·저장·보유·이용이 포함되고, 조문은 데이터가 **서버에 있는지 기기에 있는지로 구분하지 않는다.** 기기 내 저장만 하는 경우에 대한 명시적 예외 규정을 찾지 못했다 |
| **제58조의 "사적 목적" 예외가 적용되나?** | **아니다.** 그 예외는 개인이 **사적·비업무 목적**으로 처리하는 경우다. 공개 배포하는 상업/공개 앱은 **"업무 목적"**이라 해당하지 않는다 |
| **그럼 무엇이 줄어드는가?** | **실무 부담의 대부분이 사라진다** ↓ |

**서버에 안 올리면 사라지는 것:**

| 의무 | 서버 있을 때 | 기기 전용일 때 |
|---|---|---|
| **유출 신고** (제34조) | 적용 — 72시간 내 신고 체계 필요 | **발동할 사건 자체가 없다.** 우리가 통제하는 저장소가 없으므로 "유출"이 성립하지 않는다. 개별 사용자 기기의 침해는 그 사용자의 보안 사건이다 |
| **제3자 제공 / 처리위탁 고지** (제17조·제26조) | 적용 | Gemini 전송 **1건만** 남는다 |
| **국외 이전** (제28조의8) | 적용 | Gemini 전송 1건만 남는다 |
| **안전성 확보조치** (제29조) | 서버 DB 암호화·접근통제·접속기록 보관 등 | **지켜야 할 서버 DB가 없다** |
| **개인정보처리방침** (제30조) | 필수 | **여전히 필수** (Gemini 위탁 때문에) |

→ **판정: 서버에 안 올리는 선택은 "규제를 피하는 것"이 아니라 "규제가 걸릴 대상을 없애는 것"이다.** 처리방침 한 장은 여전히 써야 하지만, **유출 신고 체계·안전조치 감사 흔적·침해 대응 절차가 통째로 불필요해진다.** 1인 개발자에게 이 차이는 결정적이다.

**그리고 처리방침에 쓸 문장이 강력해진다:**
> *"티켓 사진과 그 안의 이름·예매번호는 이용자 기기 안에서만 저장되며, 당사 서버로 전송되거나 저장되지 않습니다. AI 문자 인식을 위해 이미지를 Google에 일시 전송하며, 처리 후 보관하지 않습니다."*

이건 법적 문서인 동시에 **`회전문`이 쓰고 있는 마케팅 문구**다 (§2-2). 규제 대응과 제품 포지셔닝이 같은 문장이 되는 드문 경우다.

**제16조(최소수집)와의 관계:** 목적에 필요한 범위를 넘겨 수집하지 말 것을 요구한다. **우리 OCR 스키마는 이미 예매번호를 뽑지 않고, `Concert` 타입에 이름 필드가 없다**(§1) — 최소수집을 코드 수준에서 이미 만족하고 있다. **되돌리지 말 것.**

⚠️ **못 찾은 것:** "순수 기기 내 처리(on-device only)"에 대한 **개인정보보호위원회의 명시적 해설서·FAQ 유권해석**을 찾지 못했다. 위 표는 조문 정의로부터의 추론이다. **실사용자 PII(실명·예매번호·QR)를 다루는 앱이므로, 출시 전 개인정보 전문 변호사에게 이 "기기 전용" 논리를 한 번 확인받는 것이 책임 있는 순서다.** (상담 1회 비용이 과태료 1천만원보다 훨씬 싸다.)

### 5-3. 유출 시 신고 의무

| 항목 | 내용 |
|---|---|
| **정보주체 통지 + 감독기구 신고 기한** | **인지 후 72시간 이내** (2023 개정 이후). 조문 자체는 *"지체 없이"*라 하고 구체적 시간은 시행령에 위임 — https://www.dlapiperdataprotection.com/index.html?t=law&c=KR |
| **신고 의무 발동 요건** (하나라도 해당) | ① **1,000명 이상**의 정보주체 관련 유출 ② **민감정보 또는 고유식별정보** 유출 ③ **외부의 불법적인 접근**에 의한 유출 정황 — https://www.pipc.go.kr/eng/user/lgp/ntp/reportingDivulgence.do |
| **어디에 신고하나** | 개인정보보호위원회 / KISA — **privacy.go.kr** 온라인 신고, 또는 **전화 118** |

⚠️ **주의 — 상충하는 안내:** PIPC 영문 페이지에는 "5일" / "정보통신서비스 제공자는 24시간"이라는 수치가 남아 있는데, 이는 **2023-03-14 개정 이전의 이원 체계**(구 정보통신망법 특례, 현재 PIPA로 통합·삭제)를 반영한 **오래된 안내로 보인다.** **72시간을 기준으로 준비하는 것이 안전하다.** 시행령 조번호(통상 제40조로 인용됨)의 원문은 이번에 확인하지 못했다.

→ **기기 전용 아키텍처라면 이 절이 발동할 일이 사실상 없다** (§5-2).

### 5-4. 만 14세 미만 아동

**제22조의2 원문:**
> *"개인정보처리자는 만 14세 미만 아동의 개인정보를 처리하기 위하여 이 법에 따른 동의를 받아야 할 때에는 그 **법정대리인의 동의**를 받아야 하며, 법정대리인이 동의하였는지를 **확인하여야 한다.**"*

**실무적으로 이 부담을 피하는 방법:**
- **이용약관에 "만 14세 이상만 이용 가능"을 명시**하고, 가입/최초 실행 시 연령 확인(age gate)을 두어 14세 미만이면 서비스를 제공하지 않는다.
- 그러면 법정대리인 동의 확인 절차를 구현할 필요가 없어진다.

⚠️ **주의:** 이건 **업계 관행이지 개인정보보호위원회가 공인한 안전항(safe harbor)이 아니다.** "자기 신고 연령"만으로 충분한 확인이 되는지에 대한 PIPC 공식 입장을 찾지 못했다. **앱이 명백히 아동을 대상으로 한다면** 이 방식은 통하지 않는다.
→ 우리 앱은 클래식 공연 관람 기록이라 아동 대상이 아니고, 로그인이 없으면(§3-1) 애초에 수집하는 개인정보가 없어 위험이 더 낮다.

### 5-5. 앱스토어 / 구글플레이 등록 시 요구되는 것

| 스토어 | 요구사항 | 출처 |
|---|---|---|
| **Apple App Store** | **App Privacy details(영양성분표)** 필수 — 수집하는 데이터 유형(우리는 **"User Content: Photos"**), 목적, 신원 연결 여부, 트래킹 사용 여부를 신고. **데이터 수집 여부와 무관하게 개인정보처리방침 URL이 제품 페이지에 필수** | https://developer.apple.com/app-store/app-privacy-details/ |
| **Apple — 카메라/사진 권한** | `Info.plist`에 **목적 문자열(purpose string)** 필수: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`. **누락 시 런타임 크래시 + 심사 거절** | https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription |
| **Google Play** | **데이터 안전(Data safety) 섹션** 모든 앱 필수. **개인정보처리방침 링크가 있어야 양식을 완료**할 수 있다. 정확성 책임은 전적으로 개발자에게 있고, 허위 신고 시 앱 삭제 위험 | https://support.google.com/googleplay/android-developer/answer/10787469 |
| **🇰🇷 한국 특유 — 정보통신망법 제22조의2 (접근권한 동의)** | 앱이 기기 접근권한(카메라 등)을 요청할 때 **필수 권한과 선택 권한을 구분해 고지**하고, 필요한 이유를 설명하며, **선택 권한은 거부해도 서비스를 제공**해야 한다. Apple/Google의 권한 팝업과 **별개로** 지켜야 한다 | https://namu.wiki/w/정보통신망법 (⚠️ 위키 경유) |

> 💡 **우리에게 유리한 점:** 아키텍처 A(로컬 전용)면 Data safety / App Privacy 신고가 **"데이터를 수집하지 않음"에 가까워진다.** 다만 **Gemini 전송이 있으므로 "앱 기능을 위해 데이터가 전송되나 저장되지 않음"으로 정확히 신고해야 한다.** 스토어 신고서의 허위 기재는 앱 삭제 사유다 — 여기서 대충 넘어가지 말 것.

### 5-6. 실명·예매번호·QR은 "고유식별정보"인가

**아니다 — 다만 개인정보인 것은 맞다.**

- **제24조 고유식별정보** = *"법령에 따라 개인을 고유하게 구별하기 위하여 부여된 식별정보"*. **주민등록번호는 제24조의2로 더 엄격하게** 별도 규율된다.
- 구체적 목록은 **시행령 제19조: 주민등록번호, 여권번호, 운전면허번호, 외국인등록번호** (⚠️ 원문 재확인 실패 — §7).
- **예매번호와 QR은 법령이 부여한 식별자가 아니라 예매처 시스템이 생성한 코드**다 → 고유식별정보에 해당하지 않을 가능성이 높다. 따라서 **제24조의 가중된 동의·암호화 의무는 적용되지 않는다.**
- **그러나 일반 개인정보인 것은 확실하다.** 실명 + 예매번호 + 공연/좌석이 결합되면 특정 개인이 식별된다.
- **실명 단독**으로 특별한 규제가 발동하지는 않는다.

출처: https://namu.wiki/w/개인정보%20보호법 (⚠️ 위키 경유)

> 🔴 **법적 분류와 실제 위험은 다르다.** 예매번호+QR이 법적으로 "고유식별정보"가 아니라고 해서 유출 피해가 작은 건 아니다. **QR은 입장 자격 그 자체**이고, 예매번호는 예매 조회·취소에 쓰인다(§2-1). **법이 요구하는 것보다 더 조심해야 하는 데이터다.**

### 5-7. 제재 사례

⚠️ **1인 개발자 / 소규모 앱에 대한 구체적 제재 사례는 찾지 못했다.**

개인정보보호위원회 제재 게시판(https://www.pipc.go.kr/np/cop/bbs/selectBoardList.do?bbsId=BS074)에서 확인된 것은 대기업 사건뿐이다 — 예: *"㈜KT의 개인정보 유출사고 제재처분 의결"*(2026-07-30), *"안전조치 의무 위반한 HD현대그룹 소속 2개 사업자 제재"*(2026-08-27). **우리와 비교 대상이 아니다.**

**따라서 우리가 계획해야 할 숫자는 과징금이 아니라 과태료다:**
- 개인정보처리방침 미수립·미공개 → **1천만원 이하 과태료** (제75조 제4항 제8호)
- 매출 비례 과징금(제64조의2)은 불법 이용·제공 같은 중대 위반에 적용되며, 처리방침 누락 같은 형식 위반에는 해당하지 않는다.

→ **1인 개발자의 현실적 리스크는 "과징금으로 망하는 것"이 아니라 "처리방침이 없어서 과태료를 맞거나 스토어에서 내려가는 것"이다.** 둘 다 **문서 한 장으로 예방된다.**

### 5-8. 출시 전 최소 준비물 (체크리스트)

로컬 전용 아키텍처 기준, **이것만 하면 된다:**

- [ ] **개인정보처리방침 1장** 작성 + 앱 내 접근 경로 + **공개 URL**(스토어 등록에 필요)
      → 개인정보보호위원회가 제공하는 처리방침 작성 도구를 출발점으로 쓸 수 있다 (privacy.go.kr)
- [ ] 처리방침에 **"사진은 기기에만 저장, 서버 전송 없음"** 명시
- [ ] 처리방침에 **Gemini 처리위탁 + 국외 이전** 명시 (수탁자: Google, 목적: 이미지 문자 인식, 보관: 하지 않음)
- [ ] **개인정보 보호책임자 연락처** 기재 (1인 개발자면 본인 이메일)
- [ ] **이용약관에 "만 14세 이상"** 명시 + age gate
- [ ] `Info.plist` **목적 문자열 3종** (`NSCameraUsageDescription` 등)
- [ ] **Google Play 데이터 안전 섹션** 정확히 작성 (Gemini 전송을 누락하지 말 것)
- [ ] **Apple App Privacy details** 정확히 작성
- [ ] 카메라 권한 요청 시 **필수/선택 구분 고지** (정보통신망법 제22조의2)
- [ ] **Gemini 유료 티어 전환** (§1 S2 — 무료 티어는 사람이 티켓 사진을 볼 수 있다)
- [ ] (권장) 출시 전 **개인정보 전문 변호사 1회 상담** — "기기 전용" 논리 확인 (§5-2)

---

## 6. 1인 개발자 실무 체크리스트

### 6-1. 🔴 API 키 — 지금 우리 상태와 고치는 법

**현재 상태 (`app/vite.config.ts:63-67`):**

```ts
define: {
  'process.env.API_KEY': JSON.stringify(apiKey),
  'process.env.GEMINI_API_KEY': JSON.stringify(apiKey),
},
```

Vite의 `define`은 **빌드 시점 문자열 치환**이다. 번들 JS에 키가 그대로 남는다. `dist/`를 어디든 올리는 순간 DevTools → Sources에서 누구나 꺼낸다.

**Google 공식 지침** (https://ai.google.dev/gemini-api/docs/api-key):
> *"Treat your Gemini API key like a password. If compromised, others can consume your project's quota, **incur unexpected billing charges**, and access private resources."*
> *"**Do not hardcode API keys directly in web or mobile apps.** Keys compiled in client-side code can be extracted by users."*
> *"The Gemini API **rejects requests from unrestricted standard keys**."*

**실제 요금 폭탄 사례** (HN 토론, 2026-03, "A company was billed $128K from one leaked GCP API key", story 47417874):

| 피해자 | 금액 |
|---|---|
| 일본 스타트업 | **$128,000** — $44K에서 발견하고 전부 껐는데도 청구가 계속 쌓였다 |
| 3인 스타트업 | **$82,314** (평소 월 $180) |
| 학생 | **$55,444** — GitHub에 키가 올라감 |
| 인도 학생 (헬스케어) | **약 $75,000** + 법적 위협 |

같은 스레드의 핵심 지적: *"GCP billing data lags 4-12 hours. **By the time a budget alert fires, the damage is already done.**"*

**고치는 법 — 우선순위 순:**

1. **가장 쉬운 정답: Firebase AI Logic** (구 Vertex AI in Firebase). Google이 정확히 이 문제를 풀려고 만든 것이다.
   > *"our proxy service and this App Check integration make sure that **your Gemini API key stays on the server** and is not embedded in your apps' codebase."*
   > *"has **rate limits per user by default**, and these per-user rate limits are fully configurable."*
   — https://firebase.google.com/docs/vertex-ai . Swift/Kotlin/JS/Dart/Unity 클라이언트 SDK 제공, App Check 기본 통합. **1인 개발자에게 노력 대비 효과가 가장 좋다.**

2. **Cloudflare Workers** — `ARCHITECTURE.md`가 이미 계획한 방향. Free 플랜 **일 100,000 요청**, 요청당 **CPU 10ms**(유료는 30s), Worker당 시크릿 64개(각 5KB). 시크릿은 `wrangler secret put`. — https://developers.cloudflare.com/workers/platform/limits/
   ⚠️ **CPU 10ms 제약 주의** — LLM 응답 대기는 CPU 시간이 아니라 I/O 대기라 대개 괜찮지만, 이미지 전처리를 Worker에서 하면 걸린다.

3. **Supabase Edge Functions** — Free 월 **500,000 호출**. `config.toml`의 `verify_jwt = true`가 기본값이고, 핸들러 실행 **전에** 플랫폼이 JWT를 검증한다. — https://supabase.com/docs/guides/functions/auth

**그리고 `define` 두 줄을 지운다.** 프록시가 서면 클라이언트는 키를 알 필요가 없다.

### 6-2. 프록시를 누가 호출할 수 있게 할 것인가

로그인이 없으면(v1) "인증된 사용자만"이 성립하지 않는다. **그럴 때 쓰는 게 앱 무결성 증명(attestation)이다.**

| 수단 | 하는 일 | 한계 |
|---|---|---|
| **Firebase App Check** | 모든 요청에 증명 토큰을 붙이고 백엔드가 없으면 거부. *"helps protect your app backends from abuse by preventing unauthorized clients from accessing your backend resources"* — https://firebase.google.com/docs/app-check | 공식 명시: *"It prevents **some, but not all**, abuse vectors... does not guarantee the elimination of all abuse."* |
| **Play Integrity API** (Android) | 앱 무결성(변조 없는 바이너리·서명 인증서), 기기 무결성(`MEETS_BASIC/DEVICE/STRONG_INTEGRITY`), 라이선스 확인 — https://developer.android.com/google/play/integrity | **기본 쿼터 일 10,000 요청**(Play Console에서 증액 신청). 판정 캐싱 금지(리플레이 위험). Google도 *"단독 방어선으로 쓰지 말라"* |
| **DeviceCheck / App Attest** (iOS) | DeviceCheck는 기기 단위(앱 간 공유, 약함), **App Attest는 앱별 암호학적 증명(강함)** — https://developer.apple.com/documentation/devicecheck | 둘 다 "완벽하지 않다"고 명시. Apple 서버 왕복 필요 |
| **Cloudflare Turnstile** (웹) | 퍼즐 없는 비대화형 봇 판별. **서버측 Siteverify 검증이 필수**, 토큰 300초 만료·1회 사용 — https://developers.cloudflare.com/turnstile/ | ⚠️ 현행 무료 한도는 확인 못 함 (§7) |
| **Supabase JWT 검증** (로그인 도입 후) | `verify_jwt = true`면 핸들러 실행 전 플랫폼이 검증. 핸들러 안에서 사용자 id를 얻는다 — https://supabase.com/docs/guides/functions/auth | 로그인이 있어야 성립 |

🔴 **"비밀 헤더"나 Origin 검사는 왜 부족한가:**
- **번들에 넣은 "비밀 헤더"는 그냥 문자열 하나 더다.** API 키를 꺼낸 것과 **완전히 똑같은 방법으로** 꺼낸다. 아무것도 해결하지 않는다.
- **`Origin`/`Referer`는 클라이언트가 보내는 값이다.** 브라우저가 아닌 호출자(curl, 스크립트)는 원하는 값을 그냥 써 넣는다.
- **Attestation은 종류가 다르다.** OS/앱스토어에 뿌리를 둔 **암호학적 증명**이라 값을 복사해서 재사용할 수 없다.

### 6-3. Rate limiting — 요금 폭탄 방지

🔴 **가장 중요한 사실부터: 예산 알림은 지출을 멈추지 않는다.**

Google Cloud 공식 문서 (https://docs.cloud.google.com/billing/docs/how-to/budgets):
> *"Setting an alerts-only budget **doesn't automatically cap** Google Cloud or Google Maps Platform usage or spending... Alerts-only budgets trigger alerts to inform you of how your usage costs are trending over time."*

실제로 멈추는 방법은 둘뿐이다:
1. **"spend cap" 예산** — 문서상 **Preview 단계이고 일부 서비스만 해당**
2. **Pub/Sub 알림 → Cloud Function이 프로젝트 결제를 비활성화**하는 자동화를 직접 만들기

그리고 `ai.google.dev/gemini-api/docs/pricing`에는 **Gemini API 자체의 하드 지출 상한에 대한 언급이 없다** — 레이트 리밋만 있고 예산 상한은 없다.
→ **결론: 킬 스위치는 기본 제공되지 않는다고 가정하라.** §6-1의 $128K 사례에서 "$44K에 발견하고 전부 껐는데도 청구가 쌓였다"가 이 구조 때문이다.

**실무 방어 (겹쳐서 쓴다):**

| 층 | 수단 | 확인된 한도 |
|---|---|---|
| 1 | **DB에 사용자별 일일 쿼터** — 프록시 호출과 같은 트랜잭션에서 카운터를 검사·차감 | 우리가 정한다. **이게 유일하게 확실한 상한이다** |
| 2 | **Firebase AI Logic 기본 사용자별 레이트 리밋** | 기본 제공 + 설정 가능 |
| 3 | **Cloudflare Rate Limiting** | ⚠️ Free 플랜은 **규칙 1개**, 매칭은 Path/Verified Bot만, **카운팅 IP 기준**, 카운팅·차단 기간 최대 **10초**. 스로틀링 없음(차단/챌린지만) — https://developers.cloudflare.com/waf/rate-limiting-rules/ → **Free의 rate limiting은 사실상 응급 처치용이다** |
| 4 | **Upstash Redis** — HTTP 기반이라 Workers/Edge에서 바로 씀. 식별자별·다단계 제한 지원 — https://upstash.com/docs | 무료 한도 미확인 (§7) |
| 5 | **Pub/Sub → 결제 비활성화 자동화** | 마지막 안전장치 |

### 6-4. ✅ EXIF GPS 제거 — 이미 되고 있다 (깨뜨리지 말 것)

**우리 코드는 이미 GPS를 지운다.** `app/services/imagePrep.ts`의 `prepareTicketImage()`:

```
decodeOriented(file)                  // createImageBitmap(blob, {imageOrientation:'from-image'})
  → canvas.drawImage(source, ...)     // 여기서 "픽셀"만 남고 메타데이터는 사라진다
  → canvas.toBlob('image/jpeg', 0.85) // 픽셀로부터 완전히 새 JPEG를 인코딩
```

canvas는 이미지를 **원시 픽셀 비트맵**으로 디코딩하고, `toBlob()`은 그 픽셀만으로 새 JPEG를 만든다. **EXIF(GPS 포함)가 실려 갈 통로 자체가 없다.** 그리고 저장(`prepared.dataUrl`)·전송(`prepared.base64`) 둘 다 이 결과물을 쓴다 — 원본 `File`은 어디에도 영속화되지 않는다(`TicketOCR.tsx:120-129, 215`).

**회전 문제도 이미 처리됐다.** canvas 재인코딩은 EXIF **orientation 태그도** 버리기 때문에, 사전 회전 없이 그리면 이미지가 눕는다 — 잘 알려진 함정이다. 우리는 `createImageBitmap(blob, { imageOrientation: 'from-image' })`로 **디코딩 단계에서 회전을 적용**해 이를 피한다(코드 주석에 의도가 적혀 있다).

**그래서 할 일은 "구현"이 아니라 "보존"이다:**
- [ ] **회귀 테스트를 추가한다** — GPS EXIF가 든 JPEG를 `prepareTicketImage()`에 넣고, 결과 바이트에 EXIF 마커(`0xFFE1`/`Exif\0\0`)가 **없음**을 단언. 지금은 이 성질이 우연히 성립하는 상태라 리팩터링 한 번에 조용히 깨질 수 있다.
- [ ] 앞으로 **어떤 경로로도 원본 `File`을 저장·전송하지 않는다** (예: "원본 화질로 보기" 기능을 넣는 순간 깨진다)
- [ ] 네이티브(Flutter)로 포팅할 때 **같은 성질을 다시 확보**해야 한다. 웹 canvas의 부수효과라 자동으로 따라오지 않는다

**참고 — 플랫폼별 기본 동작:**
- **Android:** 스코프드 스토리지(API 29+)가 **GPS EXIF를 기본으로 가린다.** 원본 위치를 받으려면 `ACCESS_MEDIA_LOCATION` 권한 선언 + 런타임 요청 + `MediaStore.setRequireOriginal()` 호출이 **모두** 필요하다. — https://developer.android.com/training/data-storage/shared/media → **우리는 그 권한을 절대 요청하지 않으면 된다.**
- **iOS (PHPickerViewController):** ⚠️ **Apple 공식 문서 원문 확인 실패** (§7). 통용되는 이해는 *"picker가 지우는 게 아니라 **어떻게 읽느냐**에 달렸다"* — `loadObject(ofClass: UIImage.self)`는 `UIImage`가 EXIF를 안 들고 있어 메타데이터가 사라지고, `loadFileRepresentation`/`loadDataRepresentation`은 **원본 바이트를 그대로 주므로 GPS가 살아 있다.** 네이티브 포팅 시 반드시 직접 확인할 것.

**왜 중요한가 — 실제 사례:** 2012년 12월, Vice 기자가 존 맥아피와 찍은 사진을 **EXIF 위치정보를 지우지 않은 채** 올려 과테말라 리조트의 위치가 노출됐다. 당시 그는 벨리즈 경찰을 피해 도피 중이었다. — https://en.wikipedia.org/wiki/John_McAfee
→ 우리 사용자에게 대입하면 **집에서 찍은 티켓 사진 = 집 주소**다.

### 6-5. 사진 속 PII를 더 줄이는 방법 (선택)

§1의 S2(무료 티어 사람 검토)와 §5의 최소수집 원칙 양쪽에 도움이 된다.

- **QR/바코드 영역 블러 처리 후 저장.** OCR은 QR을 읽을 필요가 없다 — 프롬프트가 이미 바코드 숫자를 무시하라고 지시한다(`ocrSchema.ts:191`). **화면에 보여줄 사진에서만 QR을 가려도** 사용자가 스크린샷을 공유할 때의 사고를 막는다.
- **OCR 성공 후 원본 사진 삭제를 선택지로 제공.** MaestLog가 이 정책이다. 우리는 사진이 감상의 일부라 기본값으로 삼긴 어렵지만, **옵션으로는 제공할 가치가 있다.**
- ⚠️ **주의:** 마스킹을 "저장 전"에 하면 텍스트 인식률이 떨어질 수 있다. **전송용(마스킹 없음) / 저장·표시용(마스킹)을 분리**하는 편이 안전하다.

### 6-6. 백업 / 복구

§2-3의 3중 방어를 실행 항목으로:

- [ ] **localStorage → IndexedDB** 이전 (쿼터 + base64 팽창 해소). 현재 쿼터 초과 시 **사진을 버리고 저장**하는 경로가 정상 동작 중이다(`App.tsx:39`) — 사용자는 사진이 사라진 줄 모른다
- [ ] **백업 파일 내보내기/가져오기** — 단일 파일(zip 또는 JSON+이미지). `회전문`의 "파일 단위로 직접 관리"
- [ ] **복원을 실제로 테스트한다.** 내보내기만 있고 가져오기가 깨진 앱이 흔하다. 내보낸 파일로 빈 기기에서 복원되는지 릴리스마다 확인
- [ ] **백업 리마인더** — 마지막 백업 후 N일이 지나면 알린다. "완전 로컬"의 대가를 사용자가 잊지 않게
- [ ] 텍스트 기록만 **Android Auto Backup**(25MB)에 얹는다 — 사진은 넣지 않는다(§2-4)

### 6-7. 🚫 하지 말아야 할 것

| # | 하지 말 것 | 근거 |
|---|---|---|
| 1 | **API 키를 클라이언트 번들에 넣기** | 지금 우리 상태. $128K/$82K/$55K 사례 (§6-1) |
| 2 | **`.env`를 커밋하기** | GitGuardian 자체 보고: 2024년 공개 GitHub에서 **2,380만 건**의 시크릿 발견(전년비 +25%), **2022년 유출 시크릿의 70%가 지금도 유효**, 공개 리포의 4.6% / 비공개 리포의 **35%**에 시크릿 존재 — https://blog.gitguardian.com (⚠️ 자체 보고 수치, 교차 검증 못 함). 우리 `.gitignore`는 이미 막혀 있다 — **유지할 것** |
| 3 | **service_role / `sb_secret_` 키를 클라이언트에 두기** | RLS를 통째로 우회한다 (§4-3) |
| 4 | **RLS 없이 테이블 만들기** | CVE-2025-48757: 스캔한 앱의 10.3%가 이 실수 (§4-1) |
| 5 | **버킷을 private으로 설정하고 끝내기** | `storage.objects`에 RLS 정책을 따로 써야 한다 (§4-4) |
| 6 | **원본 티켓 사진을 서버에 올리기** | 플앱을 죽인 원가(§6-6 경쟁조사) + Tea 앱형 유출 시나리오(§4-1) |
| 7 | **Gemini 무료 티어로 실사용자 티켓 처리하기** | 사람 검토자가 실명을 볼 수 있다 (§1) |
| 8 | **예산 알림을 킬 스위치로 믿기** | Google 공식: 알림은 지출을 막지 않는다 (§6-3) |
| 9 | **"비밀 헤더"나 Origin 검사로 프록시를 지키기** | 번들에서 똑같이 꺼낸다 (§6-2) |
| 10 | **필요 없는 PII를 저장하기** | 실명·예매번호를 안 담으면 규제 부담이 줄고 유출 시 피해가 없다. **우리 스키마는 이미 이렇게 돼 있다 — 되돌리지 말 것** (§1) |
| 11 | **PII를 로그에 남기기** | 로그는 백업되고 오래 보관되고 접근 통제가 느슨하다 |
| 12 | **클라이언트에서만 검증하기** | 클라이언트는 사용자가 통제한다 |
| 13 | **직접 암호화를 구현하기** | OS 키체인 / Supabase / CloudKit이 이미 제대로 한다 |
| 14 | **클라이언트 타임스탬프를 신뢰하기** | 기기 시계는 사용자가 바꾼다. 쿼터 계산은 서버 시각으로 |
| 15 | **자체 비밀번호 시스템 만들기** | RockYou 3,200만 건 (§3-2) |
| 16 | **원본 화질 "원본 보기" 기능 넣기** | EXIF 제거(§6-4)와 사진 미저장 원칙을 동시에 깬다 |

---

## 7. 미확인 / 못 찾은 것

정직하게 남긴다. **아래 항목은 근거로 쓰지 말 것.**

### 근거로 쓰면 안 되는 것 (검증 실패 / 오류 발견)

| 항목 | 상태 |
|---|---|
| **"Lovable 앱 수천 개가 RLS 누락"** | ❌ **부정확.** 1차 출처(Matt Palmer)의 검증된 숫자는 **1,645개 중 170개(10.3%)**다. "수천 개"는 2차 블로그의 부풀림 |
| **Tea 앱 유출 = Supabase 사고** | ❌ **틀림.** **Firebase** 레거시 스토리지 버킷이었다. 여러 매체가 일치 (§4-1) |
| **"Moltbook" Supabase 유출 사건** | ❌ **인용 금지.** 신뢰도 낮은 단일 집계 사이트에만 존재. Wiz 공식 블로그에서 교차 확인 실패. 조작 가능성 |
| **Day One의 E2EE·동기화 구조** | ⚠️ 사이트가 WebFetch를 403으로 차단. **원문 확인 실패** — 인용하지 말 것 |

### 못 찾은 것

- **service_role 키가 클라이언트 번들/공개 리포에서 발견된 명명된 사고 사례** — "없다"가 아니라 "못 찾았다"
- **한국 소셜 로그인 점유율 직접 통계** (카카오 vs 네이버 vs 구글 vs 애플 **로그인** 기준). 확인된 건 메신저 침투율(카카오톡 94.7%)뿐
- **개인 개발자가 사업자등록 없이 카카오 비즈 앱 전환이 가능한지** — Kakao Developers 문서에 명시 없음. 콘솔에서 직접 확인 필요
- **Apple CloudKit 정확한 요금·쿼터 문구** — Apple 페이지가 JS 렌더링이라 본문 추출 실패. 브라우저로 직접 확인할 것
- **Google Drive App Data 폴더가 사용자 드라이브 쿼터를 차감하는지**
- **iOS PHPickerViewController의 EXIF 처리에 대한 Apple 공식 문서 원문** — §6-4의 설명은 통용 지식이며 재확인 필요
- **Cloudflare Turnstile 현행 무료 한도**, **Upstash Redis 무료 한도**
- **Flutter/React Native용 CloudKit·iCloud 연동 패키지 중 현재 유지보수되는 것** — pub.dev/npm 직접 조사 필요
- **Symantec/Broadcom 2025, CloudSEK의 앱스토어 하드코딩 키 스캔 보고서** — URL 접근 실패
- **canvas 재인코딩이 EXIF를 버린다는 사양 수준 인용** — 웹 플랫폼 동작상 확실하고(픽셀만 남는 구조) 우리 코드에서도 그렇게 동작하지만, 규범 문서 인용은 확보 못 함. **그래서 §6-4가 회귀 테스트를 요구한다**
- **"완전 로컬"을 내세운 한국 앱 사례 중 `회전문` 외의 것**

**한국 개인정보보호법 관련 (5장) — 특히 주의:**

- 🔴 **법제처 `law.go.kr` 조문 원문 추출에 전부 실패했다** (사이트가 JS 렌더링). 5장의 제16조·제22조의2·제24조·제30조·제34조 내용은 **나무위키 법령 정리와 DLA Piper 국가별 가이드를 경유한 2차 인용**이다. **금액·기한·요건을 확정하기 전에 반드시 법제처 원문을 직접 확인할 것**
- 🔴 **"순수 기기 내(on-device only) 처리"에 대한 개인정보보호위원회의 명시적 유권해석·해설서를 찾지 못했다.** §5-2의 표는 조문 정의로부터의 **추론**이지 인용이 아니다. **이 문서에서 가장 중요한 미확인 항목이다** — 변호사 확인 권장
- **유출 신고 시행령의 정확한 조번호와 원문** — 72시간은 DLA Piper와 나무위키 교차 확인으로만 얻었다. PIPC 영문 페이지는 개정 전 수치("5일"/"24시간")를 그대로 두고 있어 **공식 안내끼리 상충한다**
- **고유식별정보 시행령 제19조 목록 원문** (주민등록번호·여권번호·운전면허번호·외국인등록번호) 재확인 실패
- **자기 신고 연령 게이트(age gate)만으로 만 14세 확인 의무를 다한 것으로 보는지**에 대한 PIPC 공식 입장 — 업계 관행일 뿐 공인된 안전항이 아니다
- **1인 개발자 / 소규모 앱에 대한 PIPC 제재 사례** — 제재 게시판에는 대기업 건만 노출됐다. "사례가 없다"가 아니라 "못 찾았다"
- **Google Play의 카메라/사진 권한 정책 원문** — 페이지 접근 시 무관한 내용이 반환됐다. https://support.google.com/googleplay/android-developer/answer/9888379 에서 직접 확인할 것

### 조사 제약

이번 세션은 **WebSearch 예산이 초기에 소진**되어 이후 조사가 대부분 **직접 URL 지정 WebFetch**로 이뤄졌다. 위 "못 찾음" 항목 상당수는 존재하지 않아서가 아니라 **검색으로 도달하지 못해서**다. 중요한 항목은 검색 가능한 세션에서 재조사할 가치가 있다.
