/**
 * seatViews.ts — 사용자가 직접 찍은 「그 자리에서 본 무대」 시야 사진 (픽셀아트)
 *
 * ⚠️ 브라우저 API 의존 금지. venues.ts / ocrSchema.ts 와 같은 규칙으로 Node 에서도 import 된다.
 *
 * 출처: 사용자 본인이 공연장에서 찍은 사진. 저작권은 사용자에게 있다.
 *   원본  ~/Downloads/롯데콘서트홀 lf (75장) / ~/Downloads/클래식 라이온즈 (18장)
 *   자산  app/assets/seatviews/*.png — 128x74 / 24색 (BOX 축소 + MEDIANCUT, dither 없음)
 *         표시할 때 NEAREST 정수배로 확대할 것. 보간하면 픽셀아트가 죽는다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 좌석은 어떻게 붙였나 (반드시 읽을 것)
 * ─────────────────────────────────────────────────────────────────────
 * 사진 EXIF 의 **촬영일(DateTimeOriginal, +09:00)** 을 키로 삼아,
 * 같은 날 찍은 **티켓 사진의 OCR 결과**를 그 날의 시야 사진에 부여했다.
 *
 *   시야 사진(촬영일) ──┐
 *                       ├── 같은 날짜 ──> 좌석·공연 부여
 *   티켓 사진(촬영일)  ──┘
 *
 * **티켓 사진이 없는 날짜는 좌석을 모른다.** 그런 날은 seat/seatRaw 가 null 이고
 * seatSource 는 'unknown' 이다. 추측해서 채우지 않았다 — 사용자 본인의 기록이라
 * 틀린 좌석을 그럴듯하게 넣으면 본인이 바로 알아채고, 취향 분석까지 오염된다.
 * 나중에 사용자가 직접 입력하면 seatSource 를 'user-input' 으로 바꾸면 된다.
 *
 * ⚠️ **좌석은 "그 날 그 자리"이지 "이 사진을 찍은 자리"가 아니다.**
 *    같은 날 찍은 사진이라도 로비·무대 근처에서 찍은 컷이 섞일 수 있다.
 *    티켓 좌석은 그 날의 관람석을 뜻한다고 읽어야 한다.
 *
 * ⚠️ 티켓은 대부분 **2장(동반자 티켓)** 이다. 어느 쪽이 사용자 자리인지
 *    사진만으로는 알 수 없어서, OCR 이 읽은 쪽을 seat 에 넣고 나머지는
 *    companionSeatsRaw 에 남겼다. 둘 다 실제로 그 날 예매된 좌석이다.
 *
 * 분류·판독 전문은 docs/MY_PHOTOS.md 참고.
 */

import type { ParsedSeat } from '../services/ocrSchema';

export interface SeatView {
  id: string;
  venueId: 'lotte-concert-hall' | 'sac-concert-hall';
  /** app/assets 기준 상대 경로 */
  asset: string;
  /** EXIF DateTimeOriginal 기준 촬영일 (KST, YYYY-MM-DD) */
  capturedOn: string;
  /** 같은 날 티켓 OCR 이 읽은 좌석 원문. 티켓이 없으면 null */
  seatRaw: string | null;
  seat: ParsedSeat | null;
  concertTitle: string | null;
  /**
   * 좌석 출처.
   *   'ticket-ocr'  — 같은 날 티켓 사진을 app/services/ocrSchema.ts 파이프라인으로 판독
   *   'photo-read'  — Gemini 일일 쿼터 소진으로 OCR 을 **돌리지 못해**, 원본 사진을
   *                   full resolution 으로 열어 인쇄된 글자를 그대로 옮긴 것.
   *                   추측이 아니라 전사(轉寫)다. 근거 크롭: work/meta/tickets/*.png
   *                   쿼터가 회복되면 `node tools/photo_ocr.mjs` 로 자동 검증된다.
   *   'user-input'  — 사용자가 직접 입력
   *   'unknown'     — 그 날 티켓 사진 자체가 없어서 모른다
   */
  seatSource: 'ticket-ocr' | 'photo-read' | 'user-input' | 'unknown';
  confidence: 'confirmed' | 'inferred' | 'unknown';
  /** 같은 날 티켓의 나머지 좌석(동반자). 없으면 빈 배열 */
  companionSeatsRaw: string[];
  /** 이 자산의 원본 파일명. 원본 폴더는 읽기 전용이라 추적용으로만 남긴다 */
  sourceFile: string;
}

/* ------------------------------------------------------------------ *
 * 날짜별 티켓 판독 결과 (OCR)
 * ------------------------------------------------------------------ *
 * 아래 값은 tools/photo_ocr.mjs 가 app/services/ocrSchema.ts 의
 * OCR_PROMPT / OCR_RESPONSE_SCHEMA / postProcessOCR 로 뽑은 것을 그대로 옮긴 것이다.
 * 원 응답은 work/meta/ocr_cache/ 에 있다.
 */
interface TicketFacts {
  seatRaw: string;
  seat: ParsedSeat;
  concertTitle: string;
  companionSeatsRaw: string[];
  source: 'ticket-ocr' | 'photo-read';
  /** 판독 근거가 된 티켓 사진 원본 파일명 */
  ticketPhoto: string;
}

const TICKETS: Record<string, TicketFacts> = {
  // 롯데 2025-07-22 — 티켓 사진 IMG_1598. 티켓 상단 스텁만 찍혀 공연일자는 인쇄면에 없다.
  '2025-07-22': {
    seatRaw: '객석 1층 P구역 06열 27번',
    seat: { floor: 1, block: 'P', row: 6, number: 27, grade: null, raw: '객석 1층 P구역 06열 27번', confidence: 1 },
    concertTitle: '히사이시 조 X 로열 필하모닉 오케스트라 스페셜 투어 2025',
    companionSeatsRaw: ['객석 1층 P구역 06열 18번'],
    source: 'ticket-ocr',
    ticketPhoto: 'IMG_1598.HEIC',
  },
  // 롯데 2025-11-19 — 티켓 사진 IMG_5213. B석 70,000원 / 오후 7:30.
  '2025-11-19': {
    seatRaw: '객석 1층 LP구역 08열 09번',
    seat: { floor: 1, block: 'LP', row: 8, number: 9, grade: 'B석', raw: '객석 1층 LP구역 08열 09번', confidence: 1 },
    concertTitle: '정명훈 & 원 코리아 오케스트라 <베토벤 합창>',
    companionSeatsRaw: ['객석 1층 LP구역 08열 08번'],
    source: 'ticket-ocr',
    ticketPhoto: 'IMG_5213.HEIC',
  },

  // ── 아래 둘은 OCR 을 돌리지 못했다 (Gemini free tier 일일 20회 소진) ──────
  // 원본 사진(3024x4032)에서 인쇄면을 직접 읽었다. 글자가 또렷해 판독에 의문이 없다.
  // 근거 크롭: work/meta/tickets/sac_0704.png, work/meta/tickets/sac_0401.png

  // 예당 2025-07-04 — 티켓 사진 IMG_7968. S석 일반 30,000원 / 동반권은 대학생 할인 21,000원.
  '2025-07-04': {
    seatRaw: '1층 D블록 2열 8번',
    seat: { floor: 1, block: 'D', row: 2, number: 8, grade: 'S석', raw: '1층 D블록 2열 8번', confidence: 0.9 },
    concertTitle: '국립합창단 제202회 정기연주회 낭만주의 거장의 합창음악 II <미사 글로리아>',
    // 동반권은 층·블록 표기가 앞 티켓에 가려 '2열 7번'만 보인다. 같은 공연 인접석이다.
    companionSeatsRaw: ['2열 7번'],
    source: 'photo-read',
    ticketPhoto: 'IMG_7968.HEIC',
  },
  // 예당 2026-04-01 — 티켓 사진 IMG_9741. R석 싹틔우미 할인40% 36,000원.
  '2026-04-01': {
    seatRaw: '1층 D블록 19열 4번',
    seat: { floor: 1, block: 'D', row: 19, number: 4, grade: 'R석', raw: '1층 D블록 19열 4번', confidence: 0.9 },
    concertTitle: '2026 예술의전당 교향악축제 - 국립심포니오케스트라',
    companionSeatsRaw: ['1층 D블록 19열 5번'],
    source: 'photo-read',
    ticketPhoto: 'IMG_9741.HEIC',
  },
};

/* ------------------------------------------------------------------ *
 * 시야 사진
 * ------------------------------------------------------------------ */

type Row = [venue: 'lotte' | 'sac', date: string, n: number, sourceFile: string];

const VENUE_ID: Record<'lotte' | 'sac', SeatView['venueId']> = {
  lotte: 'lotte-concert-hall',
  sac: 'sac-concert-hall',
};

const ROWS: Row[] = [
  // ── 롯데콘서트홀 ──────────────────────────────────────────────
  // 2025-07-22 히사이시 조 X 로열 필하모닉 (티켓 있음)
  ['lotte', '2025-07-22', 1, 'IMG_1601.HEIC'],
  ['lotte', '2025-07-22', 2, 'IMG_1602.HEIC'],
  ['lotte', '2025-07-22', 3, 'IMG_1603.HEIC'],
  ['lotte', '2025-07-22', 4, 'IMG_1609.HEIC'],
  ['lotte', '2025-07-22', 5, 'IMG_1662.HEIC'],
  ['lotte', '2025-07-22', 6, 'IMG_1663.jpg'],
  // 2025-08-19 — 티켓 사진 없음. 좌석 미상.
  ['lotte', '2025-08-19', 1, 'IMG_2544.HEIC'],
  ['lotte', '2025-08-19', 2, 'IMG_2545.HEIC'],
  ['lotte', '2025-08-19', 3, 'IMG_2550.HEIC'],
  // 2025-11-13 — 티켓 사진 없음. 좌석 미상.
  ['lotte', '2025-11-13', 1, 'IMG_5204.HEIC'],
  ['lotte', '2025-11-13', 2, 'IMG_5205.HEIC'],
  ['lotte', '2025-11-13', 3, 'IMG_5206.HEIC'],
  ['lotte', '2025-11-13', 4, 'IMG_5207.HEIC'],
  // 2025-11-19 정명훈 & 원 코리아 오케스트라 <베토벤 합창> (티켓 있음)
  ['lotte', '2025-11-19', 1, 'IMG_5210.HEIC'],
  ['lotte', '2025-11-19', 2, 'IMG_5212.HEIC'],
  ['lotte', '2025-11-19', 3, 'IMG_5214.HEIC'],
  // ── 예술의전당 콘서트홀 ────────────────────────────────────────
  // 2025-07-04 국립합창단 <미사 글로리아> (티켓 있음 / OCR 미실행)
  ['sac', '2025-07-04', 1, 'IMG_7967.HEIC'],
  ['sac', '2025-07-04', 2, 'IMG_7972.HEIC'],
  // 2026-03-25 사카리 오라모 / BBC 심포니 — 티켓 사진 없음. 좌석 미상.
  ['sac', '2026-03-25', 1, 'IMG_9616.HEIC'],
  ['sac', '2026-03-25', 2, 'IMG_9617.HEIC'],
  // 2026-04-01 교향악축제 국립심포니오케스트라 (티켓 있음 / OCR 미실행)
  ['sac', '2026-04-01', 1, 'IMG_5243.HEIC'],
];

export const SEAT_VIEWS: SeatView[] = ROWS.map(([venue, date, n, sourceFile]) => {
  const t = TICKETS[date];
  const nn = String(n).padStart(2, '0');
  return {
    id: `${venue}_${date}_${nn}`,
    venueId: VENUE_ID[venue],
    asset: `seatviews/${venue}_${date}_${nn}.png`,
    capturedOn: date,
    seatRaw: t ? t.seatRaw : null,
    seat: t ? t.seat : null,
    concertTitle: t ? t.concertTitle : null,
    seatSource: t ? t.source : 'unknown',
    // OCR 로 확인한 것만 'confirmed'. 육안 전사는 'inferred' 로 한 단계 낮춘다.
    confidence: t ? (t.source === 'ticket-ocr' ? 'confirmed' : 'inferred') : 'unknown',
    companionSeatsRaw: t ? t.companionSeatsRaw : [],
    sourceFile,
  };
});

/* ------------------------------------------------------------------ *
 * 조회
 * ------------------------------------------------------------------ */

/**
 * 그 좌석에서 찍은 시야 사진.
 *
 * seat 가 null 이면 **빈 배열을 돌려준다.** "좌석을 모르는 사진"을
 * "좌석을 모르는 질의"에 매칭시키면 아무 자리에나 남의 시야를 보여주게 된다.
 * 블록/열이 같으면 같은 시야로 본다(같은 열 안에서 번호만 다른 건 거의 같은 각도다).
 */
export function viewsForSeat(venueId: string, seat: ParsedSeat | null): SeatView[] {
  if (!seat) return [];
  return SEAT_VIEWS.filter(
    (v) =>
      v.venueId === venueId &&
      v.seat !== null &&
      v.seat.floor === seat.floor &&
      v.seat.block === seat.block &&
      v.seat.row === seat.row,
  );
}

/** 그 날 찍은 시야 사진 (YYYY-MM-DD). */
export function viewsForDate(date: string): SeatView[] {
  return SEAT_VIEWS.filter((v) => v.capturedOn === date);
}

/** 좌석을 아직 모르는 시야 사진 — 사용자에게 "이 날 어디 앉으셨어요?" 물어볼 대상. */
export function viewsWithUnknownSeat(): SeatView[] {
  return SEAT_VIEWS.filter((v) => v.seat === null);
}
