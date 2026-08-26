// 평가 범위(scope). 사용자 결정: 대상 공연장은 롯데콘서트홀 + 예술의전당 두 곳.
// 세종문화회관(sejong_)은 범위 외 — 삭제하지 않고 "참고" 로만 분리 리포트한다.
//
// 범위 외로 뺀 실질적 이유: 세종 대극장은 열 번호가 알파벳이다("1층 B열 191번").
// 정답지의 seat.row 가 문자열인데 ParsedSeat.row 는 number|null 이라 타입이 어긋난다.
// 롯데·예당은 전부 숫자 열이라 이 문제가 없다.
export const DEFAULT_OUT_OF_SCOPE_PREFIXES = ['sejong_'];

export function makeScopeFilter({ scope = 'in', prefixes = DEFAULT_OUT_OF_SCOPE_PREFIXES } = {}) {
  const isOut = (file) => prefixes.some((p) => String(file).startsWith(p));
  return {
    scope,
    prefixes,
    isOut,
    isIn: (file) => !isOut(file),
    /** scope 설정에 따라 평가 대상인지 */
    accepts: (file) => (scope === 'all' ? true : scope === 'out' ? isOut(file) : !isOut(file)),
    label: (file) => (isOut(file) ? 'out' : 'in'),
  };
}

export function parseScope(v) {
  const s = String(v ?? 'in').toLowerCase();
  if (!['in', 'out', 'all'].includes(s)) {
    throw new Error(`--scope 는 in|out|all 중 하나여야 합니다 (받은 값: ${v})`);
  }
  return s;
}
