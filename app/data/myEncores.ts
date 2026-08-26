/**
 * myEncores.ts — 사용자가 직접 찍은 「오늘의 앙코르」 안내판 판독 결과
 *
 * ⚠️ 브라우저 API 의존 금지. Node 에서 그대로 import 된다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 왜 이 데이터가 특별한가
 * ─────────────────────────────────────────────────────────────────────
 * **앙코르는 다른 어떤 소스에도 남지 않는다.** 공연 정보 사이트에도, 예매처에도,
 * 티켓에도 없다. 로비 화이트보드에 손으로 적혔다가 그 날 지워진다.
 * 그래서 이 사진이 유일한 기록이고, **동시에 검증할 방법이 전혀 없다.**
 *
 * 그 말은 곧 — 여기에 틀린 곡을 적으면 아무도 못 잡아낸다는 뜻이다.
 * 그래서 이 파일의 규칙은 하나다: **읽은 것만 적는다. 보완하지 않는다.**
 *   - raw 는 보드에 적힌 줄을 본 그대로 옮긴 것이다.
 *   - composer/title 은 raw 를 기계적으로 자른 것일 뿐,
 *     "이 작곡가면 보통 이 곡이겠지" 같은 추론을 섞지 않았다.
 *   - 못 읽은 줄은 아예 넣지 않았다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 판독 방법 (readMethod) — 반드시 읽을 것
 * ─────────────────────────────────────────────────────────────────────
 * 원래 계획은 tools/photo_ocr.mjs 의 앙코르 전용 프롬프트로 Gemini 판독이었다.
 * 그런데 **gemini-3-flash free tier 일일 한도(20회/일)가 소진**되어 호출하지 못했다.
 *   quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier
 *
 * 대신 원본 사진(3024x4032)을 열어 손글씨를 직접 읽었다 → readMethod: 'agent-visual-read'.
 * 두 보드 모두 정자체에 가깝고 초점이 맞아 글자 자체는 또렷하다.
 * 근거 크롭: work/meta/encore/board_0325.png, board_0326.png
 *
 * 쿼터가 회복되면 `node tools/photo_ocr.mjs` 를 다시 돌려 교차 검증할 것.
 * 결과가 다르면 **사진을 다시 보고** 판단하지, 둘을 섞지 말 것.
 */

export interface EncoreItem {
  /** 작곡가. raw 에서 갈라낸 것. 확실하지 않으면 null */
  composer: string | null;
  /** 곡명. raw 에서 갈라낸 것. 확실하지 않으면 null */
  title: string | null;
  /** 보드에 적힌 그 줄 원문 */
  raw: string;
  /** 협연자 앙코르인지 오케스트라 앙코르인지 (보드에 그렇게 구분돼 있다) */
  kind: 'soloist' | 'orchestra' | 'unspecified';
}

export interface EncoreRecord {
  id: string;
  venueId: 'lotte-concert-hall' | 'sac-concert-hall';
  /** 보드에 적힌 공연 날짜 (YYYY-MM-DD) */
  date: string;
  /** 보드/뒤 포스터에서 읽은 공연 식별 문자열. 본 그대로 */
  concertHint: string;
  /** 보드 상단에 손으로 적힌 날짜·시간 원문 */
  boardHeaderRaw: string;
  encores: EncoreItem[];
  /** 판독 근거 사진 (원본 폴더 기준 파일명) */
  sourcePhoto: string;
  readMethod: 'gemini-ocr' | 'agent-visual-read';
  /**
   * 'confirmed' — 글자가 또렷해 판독에 의문이 없다
   * 'inferred'  — 일부 흘려 써서 추정이 섞였다
   * 'unknown'   — 못 읽었다
   * 손글씨라 최고값이라도 인쇄물만큼 믿지 말 것.
   */
  confidence: 'confirmed' | 'inferred' | 'unknown';
  /** 판독하며 걸린 점. 사람이 다시 볼 때 여기부터 보면 된다 */
  notes: string[];
}

export const MY_ENCORES: EncoreRecord[] = [
  {
    id: 'sac_2026-03-25_encore',
    venueId: 'sac-concert-hall',
    date: '2026-03-25',
    // 보드 뒤 포스터에 인쇄돼 있다. 손글씨가 아니라 인쇄물이라 이 부분은 확실하다.
    concertHint: '사카리 오라모 / BBC 심포니 오케스트라 with 손열음 — 03.25 WED 26 THU, 예술의전당 콘서트홀',
    boardHeaderRaw: '2026년 3월 25일 7시 30    장소 : 콘서트홀',
    encores: [
      {
        composer: '슈만',
        title: '숲의 정경 중 예언의 새',
        raw: '슈만 - 숲의 정경 중 예언의 새',
        kind: 'soloist',
      },
      {
        composer: '시벨리우스',
        title: '슬픈 왈츠',
        raw: '시벨리우스 - 슬픈 왈츠',
        kind: 'orchestra',
      },
    ],
    sourcePhoto: 'IMG_9618.HEIC',
    readMethod: 'agent-visual-read',
    confidence: 'confirmed',
    notes: [
      '보드에 *협연자앵콜* / *오케스트라 앵콜* 로 구분돼 있어 kind 를 그대로 옮겼다.',
      '번호 칸 2,3,5 는 비어 있다. 빈 줄을 곡으로 채우지 않았다.',
      'Gemini OCR 미실행(일일 쿼터 소진) — 교차 검증 안 됨.',
    ],
  },
  {
    id: 'sac_2026-03-26_encore',
    venueId: 'sac-concert-hall',
    date: '2026-03-26',
    concertHint: 'BBC 심포니 오케스트라 with 손열음 (사카리 오라모) — 예술의전당 콘서트홀',
    boardHeaderRaw: '2026년 3월 26일 7시 30    장소 : 콘서트홀',
    encores: [
      {
        composer: '쇼스타코비치',
        title: '5개의 소품 1. 프렐류드',
        raw: '쇼스타코비치 - 5개의 소품  1.프렐류드',
        kind: 'soloist',
      },
    ],
    sourcePhoto: 'IMG_9633.HEIC',
    readMethod: 'agent-visual-read',
    confidence: 'confirmed',
    notes: [
      '보드 1번 줄은 "협연자앵콜:" 라벨만 있고 곡은 2번 줄에 적혀 있다.',
      '3번 줄부터는 사진 프레임 밖이라 보이지 않는다. **오케스트라 앙코르가 더 있었는지 알 수 없다.**',
      'Gemini OCR 미실행(일일 쿼터 소진) — 교차 검증 안 됨.',
    ],
  },
];

/** 그 날 앙코르. 없으면 null — 빈 배열이 아니라 null 이어야 "기록이 없다"와 "앙코르가 없었다"가 구분된다. */
export function encoresForDate(date: string): EncoreRecord | null {
  return MY_ENCORES.find((e) => e.date === date) ?? null;
}

/** 앙코르 기록이 있는 날짜들. */
export function datesWithEncores(): string[] {
  return MY_ENCORES.map((e) => e.date);
}
