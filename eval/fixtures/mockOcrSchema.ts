// ⚠️ 픽스처 전용 목(mock) 모듈. 실제 평가는 app/services/ocrSchema.ts 를 씁니다.
// 이 파일의 존재 이유는 단 하나: 코드 담당 산출물이 없어도 **채점 로직을 검증**하기 위함.
// 동시에 parseSeat / normalizeDate 의 기대 동작을 보여주는 참조 구현이기도 합니다.
// (ARCHITECTURE 4-3 C3: zero-pad 필수, 파싱 실패는 조용히 넘기지 말고 confidence 0)

export interface ParsedSeat {
  floor: number | null;
  block: string | null;
  row: number | null;
  number: number | null;
  grade: string | null;
  raw: string;
  confidence: number;
}

export const OCR_MODEL = 'mock-model';
export const OCR_PROMPT = 'MOCK PROMPT — 픽스처 전용';
export const OCR_RESPONSE_SCHEMA = { type: 'OBJECT', properties: {} };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string { return String(n).padStart(2, '0'); }

function build(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2200)) return null;
  if (!(m >= 1 && m <= 12)) return null;
  if (!(d >= 1 && d <= 31)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function normalizeDate(raw: string): { value: string | null; confidence: number } {
  const s = (raw ?? '').trim();
  if (!s) return { value: null, confidence: 0 };

  let m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) { const v = build(+m[1], +m[2], +m[3]); if (v) return { value: v, confidence: 0.95 }; }

  m = s.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (m) { const v = build(+m[1], +m[2], +m[3]); if (v) return { value: v, confidence: m[0].length === 10 ? 1 : 0.9 }; }

  m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) { const v = build(+m[3], mo, +m[1]); if (v) return { value: v, confidence: 0.85 }; }
  }

  m = s.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) { const v = build(+m[3], mo, +m[2]); if (v) return { value: v, confidence: 0.85 }; }
  }

  return { value: null, confidence: 0 };
}

export function parseSeat(raw: string): ParsedSeat {
  const s = (raw ?? '').trim();
  const out: ParsedSeat = { floor: null, block: null, row: null, number: null, grade: null, raw: s, confidence: 0 };
  if (!s) return out;

  const floor = s.match(/(\d+)\s*층/);
  if (floor) out.floor = +floor[1];

  const block = s.match(/([A-Za-z]|[가-힣])\s*(?:구역|블럭|블록)/);
  if (block) out.block = block[1].toUpperCase();

  const row = s.match(/(\d+)\s*열/);
  if (row) out.row = +row[1];

  const numm = s.match(/(\d+)\s*번/);
  if (numm) out.number = +numm[1];

  // '객석'의 '석'에 걸리지 않도록 앞 글자가 한글이면 제외
  const grade = s.match(/(?:^|[^가-힣A-Za-z])(VIP|[RSABC])\s*석/);
  if (grade) out.grade = `${grade[1].toUpperCase()}석`;

  const core = [out.floor, out.block, out.row, out.number];
  out.confidence = core.filter((x) => x !== null).length / core.length;
  return out;
}

/** 실제 ocrSchema.parsePrice 와 같은 성질: 숫자 없는 비어있지 않은 문자열('초대')은 0 으로 매핑된다.
 *  이 sentinel 때문에 할루시네이션 판정을 후처리 결과로 하면 안 된다. */
export function parsePrice(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  return Number(digits);
}
