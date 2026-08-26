// 모델 출력에서 필드를 관대하게 꺼낸다.
// OCR_RESPONSE_SCHEMA 의 정확한 모양은 코드 담당 소유라 확정할 수 없으므로,
// 아래 두 형태를 모두 지원한다:
//   A) { "title": "조성진 리사이틀" }                        (평문)
//   B) { "title": { "value": "...", "confidence": 0.97 } }  (ARCHITECTURE 4-3 C2)
// 배열(program)은 원소가 A/B 어느 쪽이어도 된다.

/** 필드 별칭 — 코드 담당이 어떤 이름을 쓰든 잡히도록. 앞에 있을수록 우선. */
export const ALIASES = {
  title: ['title', 'concertTitle', 'name', '공연명'],
  artist: ['artist', 'performer', 'artists', '연주자'],
  venue: ['venue', 'hall', 'place', '공연장'],
  date: ['date', 'dateRaw', 'date_raw', 'performedAt', '일시', '날짜'],
  seat_raw: ['seat_raw', 'seatRaw', 'seat', 'seatText', 'seat_text', '좌석'],
  price: ['price', 'priceRaw', 'price_raw', 'amount', 'paidPrice', 'price_paid', '금액', '가격'],
  program: ['program', 'programs', 'pieces', 'works', '프로그램'],
};

/** {value, confidence} 래퍼를 풀어 { value, confidence } 로 정규화. */
export function unwrap(node) {
  if (node === null || node === undefined) return { value: null, confidence: null, wrapped: false };
  if (Array.isArray(node)) {
    const items = node.map((x) => unwrap(x));
    const confs = items.map((i) => i.confidence).filter((c) => typeof c === 'number');
    return {
      value: items.map((i) => i.value),
      confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
      wrapped: items.some((i) => i.wrapped),
    };
  }
  if (typeof node === 'object') {
    const hasValue = 'value' in node;
    const hasConf = 'confidence' in node || 'conf' in node;
    if (hasValue || hasConf) {
      const c = node.confidence ?? node.conf;
      return {
        value: hasValue ? node.value : null,
        confidence: typeof c === 'number' ? c : null,
        wrapped: true,
      };
    }
    return { value: node, confidence: null, wrapped: false }; // 중첩 객체(seat 등)는 그대로
  }
  return { value: node, confidence: null, wrapped: false };
}

/** 최상위/`fields`/`data` 안쪽까지 찾아본다. */
function containers(obj) {
  const out = [obj];
  for (const k of ['fields', 'data', 'result', 'ocr']) {
    if (obj && typeof obj[k] === 'object' && obj[k] !== null) out.push(obj[k]);
  }
  return out;
}

/**
 * @returns {{ value: any, confidence: number|null, key: string|null, present: boolean }}
 */
export function pick(obj, field) {
  const names = ALIASES[field] || [field];
  if (!obj || typeof obj !== 'object') return { value: null, confidence: null, key: null, present: false };
  for (const c of containers(obj)) {
    for (const n of names) {
      if (c && Object.prototype.hasOwnProperty.call(c, n)) {
        const u = unwrap(c[n]);
        return { value: u.value, confidence: u.confidence, key: n, present: true };
      }
    }
  }
  return { value: null, confidence: null, key: null, present: false };
}

/** 별도의 confidence 맵(예: { confidences: { title: 0.9 } })도 지원. */
export function pickConfidence(obj, field, inline) {
  if (typeof inline === 'number') return inline;
  const names = ALIASES[field] || [field];
  for (const bag of ['confidence', 'confidences', 'field_confidence', 'fieldConfidence', 'conf']) {
    const b = obj && obj[bag];
    if (b && typeof b === 'object') {
      for (const n of names) if (typeof b[n] === 'number') return b[n];
    }
  }
  return null;
}

/** seat 원문 문자열 추출: seat_raw 가 문자열이 아니라 객체로 오는 경우도 흡수. */
export function pickSeatRaw(obj) {
  const p = pick(obj, 'seat_raw');
  if (p.value === null || p.value === undefined) return { raw: null, confidence: p.confidence, present: p.present };
  if (typeof p.value === 'object' && !Array.isArray(p.value)) {
    const inner = p.value.raw ?? p.value.text ?? p.value.value ?? null;
    return { raw: inner === null ? null : String(inner), confidence: p.confidence ?? p.value.confidence ?? null, present: true };
  }
  return { raw: String(p.value), confidence: p.confidence, present: p.present };
}
