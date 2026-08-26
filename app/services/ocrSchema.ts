/**
 * ocrSchema.ts — OCR 프롬프트 / 스키마 / 순수 파서
 *
 * ⚠️ 이 파일은 **브라우저 API에 의존하지 않는다** (document/canvas/window/FileReader 금지).
 *    Node에서 그대로 import 되어 평가 파이프라인이 앱과 동일한 로직을 테스트한다.
 *    이미지 전처리(canvas 리사이즈/EXIF)는 `imagePrep.ts`에 있다.
 *
 * ⚠️ 프롬프트/스키마를 다른 파일에 복사하지 말 것. geminiService.ts는 여기서 import 한다.
 *
 * 유일한 import는 모델 ID 상수(models.ts)뿐이다. 확장자를 명시해 Node의
 * `--experimental-strip-types` 실행에서도 그대로 해석되게 한다.
 */

import { MODELS } from './models.ts';

/* ------------------------------------------------------------------ *
 * 타입
 * ------------------------------------------------------------------ */

export interface ParsedSeat {
  floor: number | null;
  block: string | null;
  row: number | null;
  number: number | null;
  grade: string | null;
  raw: string;
  confidence: number;
}

/** LLM이 돌려주는 필드 1개 (값 + 필드별 신뢰도) */
export interface OCRFieldValue {
  value: string;
  confidence: number;
}

/** LLM 원본 응답 (정규화 전) */
export interface RawOCRResponse {
  title: OCRFieldValue;
  artist: OCRFieldValue;
  venue: OCRFieldValue;
  dateRaw: OCRFieldValue;
  timeRaw: OCRFieldValue;
  seatRaw: OCRFieldValue;
  gradeRaw: OCRFieldValue;
  priceRaw: OCRFieldValue;
  program: OCRFieldValue[];
}

/** 후처리까지 끝난 결과. UI/저장이 쓰는 형태 */
export interface OCRResult {
  title: string;
  artist: string;
  venue: string;
  /** LLM이 읽은 날짜 원문. 절대 파괴하지 않는다 */
  dateRaw: string;
  /** zero-padded YYYY-MM-DD. 파싱 실패 시 null → UI가 사용자에게 물어야 함 */
  date: string | null;
  timeRaw: string;
  /** HH:MM 24h. 실패 시 null */
  time: string | null;
  /** 좌석 원문 */
  seatRaw: string;
  /**
   * 등급 원문. 실측 결과 등급(R석/회원석/일반석…)은 좌석 문자열과 **다른 영역에
   * 따로 인쇄**되는 경우가 대부분이라 seatRaw만으로는 절대 잡히지 않는다.
   * (평가: seat.grade 정확도 8.3% — 12건 중 1건)
   */
  gradeRaw: string;
  seat: ParsedSeat;
  priceRaw: string;
  price: number | null;
  program: string[];
  /** program에서 뽑아낸 작곡가 (하드코딩 대체) */
  composers: string[];
  /**
   * 필드별 신뢰도 — **모델이 자기신고한 값 그대로**.
   * 실측상 이 값은 캘리브레이션이 나쁘다(대부분 0.9~1.0에 몰림, 정답률과 상관 ≈ 0).
   * 단독으로 UI 판정에 쓰지 말고 parseConfidence / 빈 값 여부와 함께 보라.
   */
  confidence: Record<string, number>;
  /** 코드 파싱이 성공했는가. 모델 자기신고와 독립된 신호 */
  parseConfidence: { date: number; time: number; seat: number };
}

/* ------------------------------------------------------------------ *
 * 모델 / 프롬프트 / 스키마
 * ------------------------------------------------------------------ */

/** 계약 유지용 named export. 실제 값은 models.ts가 단일 출처 */
export const OCR_MODEL: string = MODELS.ocr;

/**
 * responseSchema. @google/genai의 `Type` enum은 문자열 enum('OBJECT','STRING'...)이라
 * 문자열 리터럴로 그대로 쓸 수 있다. 이렇게 두면 이 파일이 SDK에 의존하지 않아
 * Node 평가 스크립트에서 SDK 설치 없이도 import 된다.
 */
const FIELD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    value: { type: 'STRING', description: '티켓에 인쇄된 문자열 그대로. 없으면 빈 문자열 ""' },
    confidence: { type: 'NUMBER', description: '0.0~1.0. 값이 없으면 반드시 0' },
  },
  required: ['value', 'confidence'],
} as const;

export const OCR_RESPONSE_SCHEMA: object = {
  type: 'OBJECT',
  properties: {
    title: FIELD_SCHEMA,
    artist: FIELD_SCHEMA,
    venue: FIELD_SCHEMA,
    dateRaw: FIELD_SCHEMA,
    timeRaw: FIELD_SCHEMA,
    seatRaw: FIELD_SCHEMA,
    gradeRaw: FIELD_SCHEMA,
    priceRaw: FIELD_SCHEMA,
    program: {
      type: 'ARRAY',
      description: '연주 곡목. 티켓에 없으면 빈 배열',
      items: FIELD_SCHEMA,
    },
  },
  required: ['title', 'artist', 'venue', 'dateRaw', 'timeRaw', 'seatRaw', 'gradeRaw', 'priceRaw', 'program'],
};

/**
 * OCR 호출의 생성 설정. **평가 하네스도 이걸 그대로 써야 앱과 같은 조건이 된다.**
 *
 * - `temperature: 0` — 판독은 정형 태스크다. 흔들릴 이유가 없다.
 * - `thinkingLevel: 'MINIMAL'` — 실측에서 thinking 1,475토큰 vs 출력 168토큰(9배),
 *   평균 지연 20.3초였다. 티켓 글자를 읽는 데 그만큼의 추론은 필요 없다.
 *   (ARCHITECTURE 4-2 B5)
 *
 * SDK enum 대신 문자열 리터럴을 쓴다 — 이 파일이 SDK에 의존하지 않아야
 * Node 평가 스크립트에서 SDK 설치 없이 import 된다. REST `generationConfig` 에
 * 그대로 펼쳐 넣을 수 있는 모양이다.
 */
export const OCR_GENERATION_CONFIG: object = {
  temperature: 0,
  thinkingConfig: { thinkingLevel: 'MINIMAL' },
};

export const OCR_PROMPT = `당신은 한국 클래식 공연 티켓 판독 전문가입니다.
이미지에 인쇄된 텍스트만 근거로 아래 필드를 추출하세요.

# 절대 규칙
1. **날짜·시간·좌석·가격은 절대 형식을 바꾸지 마세요.** 티켓에 인쇄된 문자열을 글자 그대로 옮기세요.
   ("2024.06.20(목)"을 "2024-06-20"으로 바꾸지 마세요. 정규화는 프로그램이 합니다.)
2. 모든 필드는 필수입니다. 티켓에 없거나 읽을 수 없으면 value는 빈 문자열 "", confidence는 0.
3. 추측하지 마세요. 흐릿해서 확신이 없으면 confidence를 낮추세요. 값을 지어내면 안 됩니다.
4. confidence는 "그 글자를 정확히 읽었는가"에 대한 0.0~1.0 자기평가입니다.
   또렷하게 인쇄된 글자 0.95 이상 / 일부 가려지거나 흐림 0.5~0.8 / 추정 0.3 이하 / 없음 0.

# 필드 정의
- title   : 공연명. 예) "임윤찬 피아노 리사이틀", "서울시립교향악단 정기연주회"
            티켓 상단 로고("인터파크", "예스24", "티켓링크")나 예매처 이름은 공연명이 아닙니다.
- artist  : **연주자 칸이 따로 인쇄돼 있을 때만** 채웁니다. 지휘자·협연자가 나란히
            인쇄돼 있으면 "/"로 이어 쓰세요.
            ❌ **공연명에서 연주자를 추출하지 마세요.** 한국 티켓은 연주자를 따로 찍지 않는
               경우가 대부분입니다. 공연명이 "손열음의 음.악.편.지."라고 해서 artist에
               "손열음"을 넣으면 안 됩니다 — 그건 title에 이미 들어 있습니다.
            ❌ 포스터 이미지에 보이는 단체명·주최사·후원사를 연주자로 옮기지 마세요.
            연주자 칸이 없으면 value "", confidence 0.
- venue   : 공연장. 예) "예술의전당 콘서트홀", "롯데콘서트홀", "세종문화회관 대극장"
- dateRaw : 관람일 원문. 예) "2024.06.20(목)", "2025년 3월 15일", "2026-01-09"
            예매일/발권일이 아니라 **공연 관람일**입니다.
- timeRaw : 공연 시작 시각 원문. 예) "19:30", "오후 8시", "20:00"
- seatRaw : 좌석 정보 원문. 층/구역(블록)/열/번을 **한 줄로 이어서** 그대로 옮기세요.
            예) "객석 1층 B구역 15열 01번", "3층 E블록 6열", "R석 470,000원", "R석 초대"
            등급만 인쇄돼 있으면 등급만 적으세요. 절대 재배열하거나 단어를 바꾸지 마세요.
            ❌ **입장 게이트 정보를 seatRaw에 절대 넣지 마세요.**
               "8층 2번 게이트", "9F 8번 GATE", "입장게이트: ..." 는 건물 출입구이지 좌석이 아닙니다.
               같은 티켓에 게이트와 좌석이 나란히 인쇄돼 있으면 **"객석"/"좌석" 쪽만** 옮기세요.
            ⚠️ 예술의전당 티켓은 값이 표(칼럼)로 흩어져 있고 각 칸에 영문 캡션
               (Floor / Block / Row / Seat)이 붙습니다. 이때는 값만 골라
               "1층 A블록 15열 10번" 처럼 **캡션 없이 순서대로 이어 붙여** 한 문자열로 만드세요.
- gradeRaw: 좌석 **등급** 원문. ⚠️ 등급은 좌석 문자열과 **완전히 떨어진 위치**에 인쇄되는
            경우가 대부분입니다 — 금액 옆, 별도 박스, 티켓 모서리, 스텁 쪽.
            좌석 칸에 등급이 안 보이더라도 **티켓 전체를 훑어 반드시 따로 찾으세요.**
            예) "R석", "S석", "VIP석", "C석", "회원석", "일반석", "1층석", "R석 초대"
            인쇄된 그대로 옮기세요. "R석"을 "R"로, "회원석"을 "R석"으로 바꾸지 마세요.
            정말 어디에도 없으면 value "", confidence 0.
- priceRaw: 금액 원문. 예) "470,000원", "60,000", "초대"
- program : 연주 곡목 목록. 한 곡이 한 원소입니다. 작곡가-곡명 표기를 티켓 그대로 유지하세요.
            티켓에 곡목이 없으면 빈 배열 [].

# 한국 티켓 레이아웃 힌트
- 좌석은 보통 우측 하단 또는 절취선(스텁) 쪽에 "객석 1층 A구역 3열 12번" 형태로 몰려 있습니다.
- "구역"과 "블록"은 예매처마다 혼용됩니다(인터파크=구역, 예술의전당=블록). 본 대로 옮기세요.
- 열/번은 "01열", "1열" 둘 다 나옵니다. zero-pad를 임의로 붙이거나 떼지 마세요.
- 티켓 하단의 작은 글씨(예매번호, 취소 규정, 바코드 숫자)는 어떤 필드에도 넣지 마세요.
- 예매번호(T1234567890 등)를 좌석으로 착각하지 마세요.
- 롯데콘서트홀은 "구역", 예술의전당은 "블록"을 씁니다. 인쇄된 단어를 그대로 쓰세요.
- 등급은 R석/S석/A석 외에 "회원석", "BOX석" 같은 표기도 있습니다. 본 대로 옮기세요.

# 예시 1 — 롯데콘서트홀 정기연주회 티켓
(이 티켓에는 "입장: 8층 2번 게이트"도 인쇄돼 있었지만 게이트라서 seatRaw에 넣지 않았습니다.
 등급 "R석"은 좌석 문자열이 아니라 금액 옆에 따로 찍혀 있어 gradeRaw로 뺐습니다.)
{
  "title":   {"value":"KBS교향악단 제800회 정기연주회","confidence":0.97},
  "artist":  {"value":"피에타리 잉키넨 / 임윤찬","confidence":0.92},
  "venue":   {"value":"롯데콘서트홀","confidence":0.98},
  "dateRaw": {"value":"2024.06.20(목)","confidence":0.96},
  "timeRaw": {"value":"19:30","confidence":0.95},
  "seatRaw": {"value":"객석 1층 B구역 15열 01번","confidence":0.9},
  "gradeRaw":{"value":"R석","confidence":0.93},
  "priceRaw":{"value":"70,000원","confidence":0.88},
  "program": [
    {"value":"Rachmaninoff - Piano Concerto No.3 Op.30","confidence":0.9},
    {"value":"Sibelius - Symphony No.2 Op.43","confidence":0.9}
  ]
}

# 예시 2 — 예술의전당 회원음악회. 연주자 칸 없음 / 곡목 인쇄 없음 / 한글 등급
(공연명에 사람 이름이 없고 연주자 칸도 없으므로 artist는 빈 문자열입니다.
 등급은 "회원석"이라는 한글 표기입니다 — R석으로 바꾸지 않습니다.)
{
  "title":   {"value":"2024 예술의전당 회원음악회","confidence":0.95},
  "artist":  {"value":"","confidence":0},
  "venue":   {"value":"예술의전당 콘서트홀","confidence":0.97},
  "dateRaw": {"value":"2025년 3월 15일","confidence":0.93},
  "timeRaw": {"value":"오후 5시","confidence":0.8},
  "seatRaw": {"value":"3층 E블록 6열","confidence":0.85},
  "gradeRaw":{"value":"회원석","confidence":0.9},
  "priceRaw":{"value":"초대권","confidence":0.85},
  "program": []
}

# 예시 3 — ❗️저품질 이미지. **모르는 것은 반드시 빈 문자열 + confidence 0**
티켓 오른쪽 절반이 접혀서 좌석·금액 영역이 보이지 않고, 공연명 일부가 흐립니다.
이럴 때 그럴듯한 값을 지어내면 안 됩니다. 아래처럼 **비우고 0을 주는 것이 정답입니다.**
{
  "title":   {"value":"신년음악회","confidence":0.45},
  "artist":  {"value":"","confidence":0},
  "venue":   {"value":"세종문화회관 대극장","confidence":0.93},
  "dateRaw": {"value":"2026-01-09","confidence":0.94},
  "timeRaw": {"value":"","confidence":0},
  "seatRaw": {"value":"","confidence":0},
  "gradeRaw":{"value":"","confidence":0},
  "priceRaw":{"value":"","confidence":0},
  "program": []
}

# ❌ 예시 3에서 하면 안 되는 것 (실제로 관측된 실패들)
- 금액이 안 보이는데 "30,000원" 이라고 적는 것 → 티켓에 없는 숫자를 지어낸 것입니다.
- 좌석이 가려졌는데 "S석 기획사운영석" 이라고 적는 것 → 지어낸 것입니다.
- 안 보이는 값에 confidence 0.9를 주는 것 → confidence는 "얼마나 또렷이 읽었는가"이지
  "얼마나 그럴듯한가"가 아닙니다. 안 보이면 0입니다.
- 공연명을 artist에 복사하는 것.

JSON만 출력하세요. 설명·마크다운 코드펜스 금지.`;

/* ------------------------------------------------------------------ *
 * 날짜 정규화 (C3)
 * ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 실제로 존재하는 날짜인지 검사 (2025-02-30 같은 것 걸러냄) */
function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * 날짜 원문 → zero-padded YYYY-MM-DD.
 * 실패하면 { value: null, confidence: 0 } — 조용히 깨진 문자열을 만들지 않는다.
 */
export function normalizeDate(raw: string): { value: string | null; confidence: number } {
  const FAIL = { value: null, confidence: 0 };
  if (typeof raw !== 'string') return FAIL;

  // 공백/구분자 정리. 한글 요일 표기 "(목)" 등은 그대로 둬도 정규식이 무시한다.
  const s = raw.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return FAIL;

  type Attempt = { re: RegExp; conf: number; pick: (m: RegExpMatchArray) => [number, number, number] | null };

  const attempts: Attempt[] = [
    // 2025년 3월 15일
    {
      re: /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/,
      conf: 0.97,
      pick: (m) => [+m[1], +m[2], +m[3]],
    },
    // 2025.03.15 / 2025-3-15 / 2025/03/15
    {
      re: /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/,
      conf: 0.95,
      pick: (m) => [+m[1], +m[2], +m[3]],
    },
    // 20250315
    {
      re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/,
      conf: 0.8,
      pick: (m) => [+m[1], +m[2], +m[3]],
    },
    // 15 Mar 2025 / 15-Mar-2025
    {
      re: new RegExp(String.raw`(\d{1,2})\s*[-. ]?\s*(${MONTH_ALT})\.?\s*[-,. ]?\s*(\d{4})`, 'i'),
      conf: 0.92,
      pick: (m) => [+m[3], MONTHS[m[2].toLowerCase()], +m[1]],
    },
    // Mar 15, 2025 / March 15 2025
    {
      re: new RegExp(String.raw`(${MONTH_ALT})\.?\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s*,?\s*(\d{4})`, 'i'),
      conf: 0.92,
      pick: (m) => [+m[3], MONTHS[m[1].toLowerCase()], +m[2]],
    },
    // 15.03.2025 / 03/15/2025 — 연도가 뒤. 앞 두 자리 해석이 모호하다.
    {
      re: /(?<!\d)(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{4})(?!\d)/,
      conf: 0.55,
      pick: (m) => {
        const a = +m[1], b = +m[2], y = +m[3];
        if (a > 12 && b <= 12) return [y, b, a];       // 확실히 일-월
        if (b > 12 && a <= 12) return [y, a, b];       // 확실히 월-일
        return [y, a, b];                              // 모호 → 월-일로 가정
      },
    },
  ];

  for (const a of attempts) {
    const m = s.match(a.re);
    if (!m) continue;
    const picked = a.pick(m);
    if (!picked) continue;
    const [y, mo, d] = picked;
    if (!isRealDate(y, mo, d)) continue;

    // 두 자리 우선 해석이 모호했던 경우(양쪽 다 <=12)만 신뢰도를 더 깎는다.
    let conf = a.conf;
    if (a.conf === 0.55) {
      const aa = +m[1], bb = +m[2];
      if (aa <= 12 && bb <= 12) conf = 0.5;
      else conf = 0.85;
    }
    return { value: iso(y, mo, d), confidence: conf };
  }

  // 연도 없는 "3월 15일" 등은 조용히 올해로 때우지 않는다. 사용자에게 묻게 한다.
  return FAIL;
}

/** "19:30", "오후 5시", "오후 8시 30분" → "HH:MM" */
export function normalizeTime(raw: string): { value: string | null; confidence: number } {
  const FAIL = { value: null, confidence: 0 };
  if (typeof raw !== 'string') return FAIL;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return FAIL;

  let m = s.match(/(?<!\d)(\d{1,2})\s*[:시]\s*(\d{1,2})?\s*분?/);
  if (!m) return FAIL;

  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return FAIL;

  const pm = /오후|p\.?m\.?/i.test(s);
  const am = /오전|a\.?m\.?/i.test(s);
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;

  // 오전/오후 표기가 없고 1~9시면 공연은 사실상 저녁이지만, 임의 보정은 하지 않는다.
  const conf = pm || am || h >= 13 ? 0.9 : 0.7;
  return { value: `${pad2(h)}:${pad2(min)}`, confidence: conf };
}

/* ------------------------------------------------------------------ *
 * 좌석 파싱 (A)
 * ------------------------------------------------------------------ */

const NOT_A_BLOCK = new Set([
  '층', '석', '열', '번', '관', '홀', '객석', '구역', '블록', '블럭', '존', '입장', '게이트',
]);

/**
 * 등급 화이트리스트. 긴 것부터 검사한다.
 * 실물 티켓에서 `회원석`(예술의전당), `BOX석`이 확인됐다 —
 * 예전 `[A-Z]{1,2}석` 정규식은 이걸 전부 놓쳤다.
 */
const GRADE_WHITELIST = [
  '시야제한석', 'VVIP석', 'BOX석', 'VIP석', '회원석', '학생석', '초대석',
  '합창석', '제한석', '보류석', '자유석', '박스석',
  'R석', 'S석', 'A석', 'B석', 'C석', 'D석', 'E석', 'P석',
].sort((a, b) => b.length - a.length);

/**
 * 게이트/입장 안내를 제거한다. **좌석 파싱 전 반드시 먼저 돌려야 한다.**
 *
 * 실물 롯데콘서트홀 티켓에는 게이트 정보가 좌석과 나란히 인쇄된다:
 *   "입장: 8층 2번 게이트"          ← 건물 층 + 게이트 번호 (좌석 아님)
 *   "좌석: 객석 1층 B구역 15열 01번"  ← 진짜 좌석
 * 이걸 그대로 파싱하면 첫 매치를 취해 floor=8, number=2 로 완전히 틀린다.
 *
 * 예술의전당 티켓은 표(칼럼) 레이아웃이라 영문 캡션(Floor/Block/Row/Seat)이
 * 값 사이에 섞여 들어올 수 있어 함께 제거한다.
 */
export function stripNonSeatTokens(input: string): string {
  return input
    // "8층 2번 게이트", "9F 8번 GATE" — 층/번호를 게이트와 함께 통째로 제거
    .replace(/\d{1,2}\s*(?:층|F)\s*\d{1,3}\s*번?\s*(?:게이트|gate)/gi, ' ')
    // "입장: 8층 2번", "입장게이트: 9F 8번"
    .replace(/입장\s*(?:게이트)?\s*[:：]?\s*\d{1,2}\s*(?:층|F)\s*\d{1,3}\s*번?/gi, ' ')
    // 남은 "2번 게이트" / "GATE 8" 형태
    .replace(/\d{1,3}\s*번?\s*(?:게이트|gate)/gi, ' ')
    .replace(/(?:게이트|gate)\s*[:：]?\s*\d{1,3}\s*번?/gi, ' ')
    // 라벨만 남은 경우
    .replace(/입장\s*(?:게이트)?\s*[:：]/gi, ' ')
    // 예당 표 레이아웃의 영문 소캡션
    .replace(/\b(?:floor|block|row|seat|gate|grade|no)\b\.?/gi, ' ')
    // 좌석 라벨
    .replace(/좌석\s*[:：]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function emptySeat(raw: string): ParsedSeat {
  return { floor: null, block: null, row: null, number: null, grade: null, raw: raw ?? '', confidence: 0 };
}

/**
 * 좌석 원문 → 구조화. 실패해도 raw는 보존하고 confidence만 0.
 *
 * @param raw       좌석 문자열 원문 (`seatRaw`)
 * @param gradeRaw  등급 원문 (`gradeRaw`). **optional — 단일 인자 호출 하위 호환 유지.**
 *                  주어지면 등급은 이 값을 그대로 쓰고, 없으면 raw 안에서 찾는다.
 *
 * 처리 대상 (전부 실물 티켓에서 확인된 형태):
 *   "객석 1층 B구역 15열 01번"                    → floor 1, block B, row 15, number 1
 *   "객석1층 R구역 01열 12번"                     → 공백 없음 / zero-pad. R은 **구역**이지 등급이 아니다
 *   "3층 E블록 6열"                               → number 없음
 *   "1층 A블록 15열 10번"
 *   "입장: 8층 2번 게이트 좌석: 객석 1층 B구역 15열 01번"  → 게이트를 버리고 객석만
 *   "R석 초대" / "R석 470,000원" / "회원석"        → 등급만
 */
export function parseSeat(raw: string, gradeRaw?: string): ParsedSeat {
  if (typeof raw !== 'string') raw = '';
  const original = raw;
  const normalized = raw.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();

  // --- 등급 ---
  // 1순위: 별도 필드(gradeRaw). 등급은 좌석과 다른 영역에 인쇄되는 게 보통이라
  //        이쪽이 훨씬 정확하다. 인쇄된 표기를 **그대로** 쓴다 ('회원석'을 'R석'으로
  //        바꾸지 않고, '1층석'·'일반석'·'R석 초대' 같은 표기도 보존한다).
  let grade: string | null = null;
  if (typeof gradeRaw === 'string') {
    const g = gradeRaw.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    if (g && !/^(없음|미지정|n\/?a|none|null)$/i.test(g)) grade = g;
  }
  // 2순위: 좌석 문자열 안에 등급이 같이 찍힌 경우 (하위 호환 — 단일 인자 호출 경로)
  if (!grade && normalized) {
    for (const g of GRADE_WHITELIST) {
      if (normalized.includes(g)) { grade = g; break; }
    }
    if (!grade) {
      // 폴백: 대문자 1글자 + 석. 소문자를 허용하지 않아 '객석' 등의 오탐을 막는다.
      const gm = normalized.match(/(?<![A-Za-z])(VVIP|VIP|[A-Z])석/);
      if (gm) grade = `${gm[1]}석`;
    }
  }

  if (!normalized) {
    // 좌석 문자열은 없고 등급만 있는 티켓(초대권 등)도 정보가 0은 아니다.
    return { ...emptySeat(original), grade, confidence: grade ? 0.5 : 0 };
  }

  // ⚠️ 게이트/캡션 제거 후에만 층·번호를 읽는다.
  let s = stripNonSeatTokens(normalized);

  // `객석` 앵커가 있으면 그 뒤만 본다. 롯데는 항상 `객석`을 붙인다.
  const anchor = s.indexOf('객석');
  if (anchor >= 0) s = s.slice(anchor);

  // 층. 국내 클래식 공연장 객석은 최대 3층(+여유) → 1~5만 허용.
  // 이 범위 제한만으로 게이트의 8층/9F가 자동 차단된다.
  let floor: number | null = null;
  const fm =
    s.match(/객석\s*(\d{1,2})\s*층/) ||
    s.match(/(\d{1,2})\s*층/) ||
    s.match(/(?:floor|fl)\.?\s*(\d{1,2})/i) ||
    s.match(/(?<!\d)(\d{1,2})\s*F(?![A-Za-z])/);
  if (fm) {
    const v = +fm[1];
    if (v >= 1 && v <= 5) floor = v;
  }

  // 구역/블록: 알파벳 1~3자 또는 한글 1~2자 + (구역|블록|블럭|존)
  let block: string | null = null;
  const bm =
    s.match(/([A-Za-z]{1,3}|[가-힣]{1,2})\s*(?:구역|블록|블럭|존)/) ||
    s.match(/(?:block|zone|section|sec)\.?\s*([A-Za-z]{1,3}|\d{1,2})/i);
  if (bm && !NOT_A_BLOCK.has(bm[1])) {
    block = /^[A-Za-z]+$/.test(bm[1]) ? bm[1].toUpperCase() : bm[1];
  }

  // 열
  let row: number | null = null;
  const rm = s.match(/(\d{1,3})\s*열/) || s.match(/row\s*(\d{1,3})/i);
  if (rm) {
    const v = +rm[1];
    if (v >= 1 && v <= 200) row = v;
  }

  // 번(좌석 번호). "예매번호"는 (?!호)로 걸러진다.
  let number: number | null = null;
  const nm =
    s.match(/(\d{1,3})\s*번(?!호)/) ||
    s.match(/seat\s*(?:no\.?\s*)?(\d{1,3})/i) ||
    s.match(/no\.?\s*(\d{1,3})(?!\d)/i);
  if (nm) {
    const v = +nm[1];
    if (v >= 1 && v <= 500) number = v;
  }

  const parts = [floor, block, row, number].filter(v => v !== null).length;

  let confidence: number;
  if (parts === 0) confidence = grade ? 0.5 : 0;
  else confidence = Math.min(1, 0.4 + 0.15 * parts);

  return { floor, block, row, number, grade, raw: original, confidence };
}

/* ------------------------------------------------------------------ *
 * 금액
 * ------------------------------------------------------------------ */

export function parsePrice(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  if (/초대|invitation|무료|complimentary/i.test(raw) && !/\d/.test(raw)) return 0;
  const m = raw.replace(/[\s,]/g, '').match(/(\d{3,9})\s*원?/);
  if (!m) return null;
  const v = +m[1];
  return Number.isFinite(v) ? v : null;
}

/* ------------------------------------------------------------------ *
 * 작곡가 추출 (하드코딩 제거, F4)
 * ------------------------------------------------------------------ */

/** canonical 이름 → 별칭(한글/약칭/이형표기) */
const COMPOSER_ALIASES: Record<string, string[]> = {
  Bach: ['bach', '바흐', 'j.s. bach', 'js bach', 'johann sebastian bach'],
  Handel: ['handel', 'haendel', 'händel', '헨델'],
  Vivaldi: ['vivaldi', '비발디'],
  Haydn: ['haydn', '하이든'],
  Mozart: ['mozart', '모차르트', 'w.a. mozart', 'wa mozart'],
  Beethoven: ['beethoven', '베토벤', 'l.v. beethoven'],
  Schubert: ['schubert', '슈베르트'],
  Mendelssohn: ['mendelssohn', '멘델스존'],
  Chopin: ['chopin', '쇼팽', 'f. chopin'],
  Schumann: ['schumann', '슈만'],
  Liszt: ['liszt', '리스트'],
  Brahms: ['brahms', '브람스'],
  Bruckner: ['bruckner', '브루크너'],
  Tchaikovsky: ['tchaikovsky', 'tschaikowsky', '차이콥스키', '차이코프스키'],
  Dvorak: ['dvorak', 'dvořák', '드보르작', '드보르자크'],
  Grieg: ['grieg', '그리그'],
  Saint_Saens: ['saint-saëns', 'saint-saens', '생상스'],
  Faure: ['fauré', 'faure', '포레'],
  Debussy: ['debussy', '드뷔시'],
  Ravel: ['ravel', '라벨'],
  Mahler: ['mahler', '말러'],
  Strauss: ['r. strauss', 'richard strauss', '리하르트 슈트라우스', '슈트라우스', 'strauss'],
  Sibelius: ['sibelius', '시벨리우스'],
  Rachmaninoff: ['rachmaninoff', 'rachmaninov', '라흐마니노프'],
  Scriabin: ['scriabin', '스크리아빈'],
  Prokofiev: ['prokofiev', '프로코피예프', '프로코피에프'],
  Shostakovich: ['shostakovich', '쇼스타코비치'],
  Stravinsky: ['stravinsky', '스트라빈스키'],
  Bartok: ['bartók', 'bartok', '바르톡'],
  Ligeti: ['ligeti', '리게티'],
  Messiaen: ['messiaen', '메시앙'],
  Poulenc: ['poulenc', '풀랑크'],
  Elgar: ['elgar', '엘가'],
  Holst: ['holst', '홀스트'],
  Britten: ['britten', '브리튼'],
  Copland: ['copland', '코플런드'],
  Gershwin: ['gershwin', '거슈윈'],
  Verdi: ['verdi', '베르디'],
  Puccini: ['puccini', '푸치니'],
  Rossini: ['rossini', '로시니'],
  Wagner: ['wagner', '바그너'],
  Berlioz: ['berlioz', '베를리오즈'],
  Franck: ['franck', '프랑크'],
  Rimsky_Korsakov: ['rimsky-korsakov', '림스키코르사코프', '림스키-코르사코프'],
  Mussorgsky: ['mussorgsky', '무소륵스키', '무소르그스키'],
  Borodin: ['borodin', '보로딘'],
  Paganini: ['paganini', '파가니니'],
  Albeniz: ['albéniz', 'albeniz', '알베니스'],
  Granados: ['granados', '그라나도스'],
  Piazzolla: ['piazzolla', '피아졸라'],
  Respighi: ['respighi', '레스피기'],
  Janacek: ['janáček', 'janacek', '야나체크'],
  Nielsen: ['nielsen', '닐센'],
  Schoenberg: ['schoenberg', 'schönberg', '쇤베르크'],
  Berg: ['alban berg', '베르크'],
  Webern: ['webern', '베베른'],
};

const CANONICAL_LABEL: Record<string, string> = {
  Saint_Saens: 'Saint-Saëns',
  Rimsky_Korsakov: 'Rimsky-Korsakov',
};

/**
 * 프로그램 문자열들에서 작곡가를 추출한다.
 * 1) 알려진 작곡가 사전 매칭 (한글/영문 별칭)
 * 2) 사전에 없으면 "Composer - Work" / "Composer: Work" 접두 패턴에서 추정
 * 등장 순서를 유지하고 중복은 제거한다.
 */
export function extractComposers(program: string[]): string[] {
  if (!Array.isArray(program)) return [];
  const found: string[] = [];
  const seen = new Set<string>();

  const push = (name: string) => {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      found.push(name);
    }
  };

  for (const rawItem of program) {
    if (typeof rawItem !== 'string' || !rawItem.trim()) continue;
    const lower = rawItem.toLowerCase();

    let matched = false;
    for (const [canonical, aliases] of Object.entries(COMPOSER_ALIASES)) {
      if (aliases.some(a => lower.includes(a))) {
        push(CANONICAL_LABEL[canonical] || canonical);
        matched = true;
      }
    }
    if (matched) continue;

    // "쇼팽 - 발라드 1번" / "Someone: Work" 접두 추정
    const m = rawItem.match(/^\s*([^\-:–—]{2,30}?)\s*[-:–—]\s*\S/);
    if (m) {
      const cand = m[1].trim().replace(/^[A-Z]\.\s*/, '');
      if (cand && !/^\d+$/.test(cand)) push(cand);
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * 응답 후처리
 * ------------------------------------------------------------------ */

/** 모델이 그 필드를 **응답에 실제로 넣었는가**. 안 넣은 필드에 confidence 0을 지어내지 않기 위해. */
function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return true;
  if (Array.isArray(v)) return true;
  if (typeof v === 'object') return 'value' in (v as any) || 'confidence' in (v as any);
  return false;
}

function asField(v: unknown): OCRFieldValue {
  if (v && typeof v === 'object' && 'value' in (v as any)) {
    const o = v as any;
    const value = typeof o.value === 'string' ? o.value.trim() : '';
    let confidence = typeof o.confidence === 'number' ? o.confidence : 0;
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));
    // ⚠️ 여기서 confidence를 손대지 않는다. 실측에서 "빈 값이면 0" 강제가
    //    캘리브레이션을 오히려 악화시켰다(ECE 0.211 → 0.282). 모델 자기신고를
    //    그대로 통과시키고, 값이 비었다는 사실은 value === '' 로 UI가 직접 본다.
    return { value, confidence };
  }
  if (typeof v === 'string') return { value: v.trim(), confidence: v.trim() ? 0.5 : 0 };
  return { value: '', confidence: 0 };
}

function buildConfidenceMap(
  fields: Record<string, OCRFieldValue>,
  raws: Record<string, unknown>,
  programFields: OCRFieldValue[] | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (!isPresent(raws[key])) continue;   // 모델이 안 준 필드는 항목 자체를 만들지 않는다
    out[key] = field.confidence;
  }
  // 빈 배열(곡목이 티켓에 없음)에는 항목을 만들지 않는다. 없는 것에 대한
  // "확신도 0"은 정보가 아니라 노이즈이고, 캘리브레이션 지표를 그대로 오염시킨다.
  if (programFields && programFields.length) {
    out.program = programFields.reduce((s, f) => s + f.confidence, 0) / programFields.length;
  }
  return out;
}

/**
 * LLM 원본 응답(문자열 또는 객체)을 검증·정규화해서 OCRResult로 만든다.
 * 날짜/좌석/금액/작곡가 파싱은 전부 여기(코드)에서 한다. LLM에게 맡기지 않는다.
 */
export function postProcessOCR(rawResponse: unknown): OCRResult {
  let obj: any = rawResponse;
  if (typeof rawResponse === 'string') {
    const cleaned = rawResponse.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      obj = JSON.parse(cleaned);
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== 'object') obj = {};

  const rawFields = {
    title: obj.title,
    artist: obj.artist,
    venue: obj.venue,
    date: obj.dateRaw ?? obj.date,
    time: obj.timeRaw ?? obj.time,
    seat: obj.seatRaw ?? obj.seat,
    grade: obj.gradeRaw ?? obj.grade,
    price: obj.priceRaw ?? obj.price,
  };

  const title = asField(rawFields.title);
  const artist = asField(rawFields.artist);
  const venue = asField(rawFields.venue);
  const dateRaw = asField(rawFields.date);
  const timeRaw = asField(rawFields.time);
  const seatRaw = asField(rawFields.seat);
  const gradeRaw = asField(rawFields.grade);
  const priceRaw = asField(rawFields.price);

  const programFields: OCRFieldValue[] = Array.isArray(obj.program)
    ? obj.program.map(asField).filter((f: OCRFieldValue) => f.value)
    : [];
  const program = programFields.map(f => f.value);

  const dateParsed = normalizeDate(dateRaw.value);
  const timeParsed = normalizeTime(timeRaw.value);
  const seat = parseSeat(seatRaw.value, gradeRaw.value);

  return {
    title: title.value,
    artist: artist.value,
    venue: venue.value,
    dateRaw: dateRaw.value,
    date: dateParsed.value,
    timeRaw: timeRaw.value,
    time: timeParsed.value,
    seatRaw: seatRaw.value,
    gradeRaw: gradeRaw.value,
    // seat.confidence 는 **파싱 신뢰도** 그대로. 모델 판독 신뢰도(confidence.seat)와
    // 곱하지 않는다 — 곱하면 두 신호가 섞여 둘 다 해석 불가능해진다.
    seat,
    priceRaw: priceRaw.value,
    price: parsePrice(priceRaw.value),
    program,
    composers: extractComposers(program),
    // ⚠️ 전부 **모델이 자기신고한 값 그대로**. 코드 파싱 신뢰도를 곱해 섞지 않는다.
    //    (실측: 곱하기 보정이 ECE를 0.211 → 0.282 로 악화시켰다)
    //    "파싱이 됐는가"는 date === null / parseConfidence 로 따로 본다.
    //    ⚠️ 모델이 **응답에 넣지도 않은 필드**에는 항목을 만들지 않는다.
    //       0을 지어내면 없는 정보를 "확실히 모른다"로 둔갑시켜 캘리브레이션을 망친다.
    confidence: buildConfidenceMap(
      { title, artist, venue, date: dateRaw, time: timeRaw, seat: seatRaw, grade: gradeRaw, price: priceRaw },
      rawFields,
      Array.isArray(obj.program) ? programFields : null,
    ),
    /** 코드 파싱이 성공했는가 (모델 자기신고와 **별개** 신호) */
    parseConfidence: {
      date: dateParsed.confidence,
      time: timeParsed.confidence,
      seat: seat.confidence,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Self-consistency — 자기신고 대신 "실제 불확실성" 신호
 *
 * 실측 결과 모델이 스스로 낸 confidence는 쓸모가 없었다:
 *   139개 필드 중 130개가 0.9~1.0에 몰렸고, 정답률과의 상관은 -0.042.
 *   금액이 안 보이는 티켓에 "30,000원"을 confidence 0.92로 날조하기도 했다.
 * LLM에게 확신도를 물으면 거의 항상 높게 답한다 — 프롬프트로 잘 안 고쳐진다.
 *
 * 대안: 같은 이미지를 2회 호출해 **필드별로 값이 갈리는지** 본다.
 * 갈린다는 건 진짜로 애매하다는 뜻이라 자기신고보다 훨씬 정직한 신호다.
 * 비용이 2배이므로 `needsSecondPass()` 로 걸러 저신뢰 이미지에만 돌린다.
 * ------------------------------------------------------------------ */

/** 비교용 정규화 — 공백/구두점 차이로 "불일치" 판정이 나지 않게 */
function canonical(v: string): string {
  return (v ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u200B-\u200D\uFEFF]/g, '')
    .replace(/[.,·・:;()[\]{}<>'"`~!?/\\-]/g, '');
}

/** 2차 패스를 돌릴 가치가 있는가 (전건에 돌리면 비용 2배) */
export function needsSecondPass(
  result: OCRResult,
  meanThreshold: number = LOW_CONFIDENCE_THRESHOLD,
): boolean {
  const vals = Object.values(result.confidence).filter(v => typeof v === 'number');
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  if (mean < meanThreshold) return true;
  // 저장에 꼭 필요한 값이 안 나왔으면 한 번 더 볼 가치가 있다.
  if (!result.date) return true;
  if (!result.title) return true;
  return false;
}

const CONSISTENCY_FIELDS = [
  'title', 'artist', 'venue', 'dateRaw', 'timeRaw', 'seatRaw', 'gradeRaw', 'priceRaw',
] as const;

/**
 * 여러 번의 판독 결과를 합친다.
 *
 * - 값: 최빈값(동률이면 첫 실행 우선 — 재현성 있게)
 * - confidence: **일치율**로 덮어쓴다. 전부 같으면 1, 반반이면 0.5, 다 다르면 1/N.
 *   자기신고 값은 버린다. 실행이 1개뿐이면 원본을 그대로 돌려준다.
 *
 * 순수 함수다. 평가 하네스가 `--repeat` 결과를 그대로 넣어 검증할 수 있다.
 */
export function mergeOCRRuns(runs: OCRResult[]): OCRResult {
  if (!Array.isArray(runs) || runs.length === 0) return postProcessOCR({});
  if (runs.length === 1) return runs[0];

  const n = runs.length;
  const merged: Record<string, string> = {};
  const agreement: Record<string, number> = {};

  for (const field of CONSISTENCY_FIELDS) {
    const raws = runs.map(r => String((r as any)[field] ?? ''));
    const counts = new Map<string, { count: number; first: string; order: number }>();
    raws.forEach((v, i) => {
      const key = canonical(v);
      const hit = counts.get(key);
      if (hit) hit.count++;
      else counts.set(key, { count: 1, first: v, order: i });
    });
    let best = { count: -1, first: raws[0], order: 0 };
    for (const c of counts.values()) {
      if (c.count > best.count || (c.count === best.count && c.order < best.order)) best = c;
    }
    merged[field] = best.first;
    agreement[field] = best.count / n;
  }

  // program 은 집합으로 본다: 모든 실행에 공통으로 등장한 곡만 신뢰
  const programSets = runs.map(r => new Set((r.program || []).map(canonical)));
  const programOrder = runs[0].program || [];
  const program = programOrder.filter(p => programSets.every(set => set.has(canonical(p))));
  const programUnion = new Set(runs.flatMap(r => (r.program || []).map(canonical)));
  const programAgreement = programUnion.size ? program.length / programUnion.size : 0;

  const rebuilt = postProcessOCR({
    title:    { value: merged.title,    confidence: agreement.title },
    artist:   { value: merged.artist,   confidence: agreement.artist },
    venue:    { value: merged.venue,    confidence: agreement.venue },
    dateRaw:  { value: merged.dateRaw,  confidence: agreement.dateRaw },
    timeRaw:  { value: merged.timeRaw,  confidence: agreement.timeRaw },
    seatRaw:  { value: merged.seatRaw,  confidence: agreement.seatRaw },
    gradeRaw: { value: merged.gradeRaw, confidence: agreement.gradeRaw },
    priceRaw: { value: merged.priceRaw, confidence: agreement.priceRaw },
    program:  program.map(v => ({ value: v, confidence: programAgreement })),
  });

  return {
    ...rebuilt,
    confidence: {
      title: agreement.title,
      artist: agreement.artist,
      venue: agreement.venue,
      date: agreement.dateRaw,
      time: agreement.timeRaw,
      seat: agreement.seatRaw,
      grade: agreement.gradeRaw,
      price: agreement.priceRaw,
      program: programAgreement,
    },
  };
}

/** UI 강조 임계값 — 이 값보다 낮은 필드만 노란 테두리 */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;

/** 사람이 직접 손댄 필드는 신뢰도 1로 올린다 */
export function withUserEdit(result: OCRResult, field: string): OCRResult {
  return { ...result, confidence: { ...result.confidence, [field]: 1 } };
}
