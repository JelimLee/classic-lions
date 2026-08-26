// 문자열 정규화 + 유사도. 클래식 공연명은 표기 변형이 심해서
// exact 만 보면 실제 성능을 과소평가한다 → 유사도를 함께 리포트한다.

const BRACKETS = /[()\[\]{}<>「」『』〈〉《》【】〔〕]/g;
const PUNCT = /[.,;:!?'"`~@#$%^&*_=+\\|/\-–—·ㆍ]/g;

/** 공백/괄호/구두점 제거 + NFKC + 소문자. 한글은 그대로 둔다. */
export function normalizeText(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(BRACKETS, ' ')
    .replace(PUNCT, ' ')
    .replace(/\s+/g, '')
    .trim();
}

/** 프로그램 곡목용: 정규화 + 흔한 표기 통일(op. / 작품번호 / no.) */
export function normalizeWork(s) {
  if (s === null || s === undefined) return '';
  let t = String(s).normalize('NFKC').toLowerCase();
  t = t.replace(/작품\s*번?호?\s*/g, 'op');
  t = t.replace(/\bop\s*\.?\s*/g, 'op');
  t = t.replace(/\bno\s*\.?\s*/g, 'no');
  t = t.replace(/\bnr\s*\.?\s*/g, 'no');
  return normalizeText(t);
}

/** Levenshtein 거리 (O(n) 메모리). */
export function levenshtein(a, b) {
  a = a ?? ''; b = b ?? '';
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 정규화 Levenshtein 유사도: 1.0 = 동일, 0.0 = 완전 불일치. 둘 다 빈 문자열이면 1.0. */
export function similarity(a, b) {
  const x = a ?? '', y = b ?? '';
  if (!x.length && !y.length) return 1;
  const m = Math.max(x.length, y.length);
  if (m === 0) return 1;
  return 1 - levenshtein(x, y) / m;
}

/** 정규화 후 유사도 (텍스트 필드 채점용). */
export function normSimilarity(a, b) {
  return similarity(normalizeText(a), normalizeText(b));
}

/** 값이 "비어 있음"인가. null/undefined/''/공백/'없음'/'N/A'/'-' 등을 포함. */
export function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.filter((x) => !isEmptyValue(x)).length === 0;
  if (typeof v === 'number') return Number.isNaN(v);
  if (typeof v === 'object') return Object.keys(v).length === 0;
  const t = String(v).trim();
  if (!t) return true;
  return ['-', '--', 'n/a', 'na', 'null', 'none', 'unknown', '없음', '미상', '해당없음', '알수없음', '알 수 없음'].includes(t.toLowerCase());
}

/** 숫자 파싱: "470,000원", "₩470000", 470000 → 470000. 실패 시 null. */
export function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[^0-9.\-]/g, '');
  if (!t || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
