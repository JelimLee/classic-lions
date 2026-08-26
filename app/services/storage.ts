/**
 * storage.ts — localStorage 영속화 (E)
 *
 * App.tsx의 상태가 전부 useState라 새로고침하면 아카이브가 전소되던 문제를 막는다.
 * 티켓 이미지가 base64 data URL이라 용량이 크다 → 쿼터 초과를 graceful하게 처리한다.
 */

const PREFIX = 'classic-lions/v1/';

export const STORAGE_KEYS = {
  profile: `${PREFIX}profile`,
  concerts: `${PREFIX}concerts`,
  feedback: `${PREFIX}feedback`,
} as const;

function available(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    // Safari 프라이빗 모드 등에서 접근 자체가 던지는 경우 방어
    const probe = `${PREFIX}__probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadState<T>(key: string, fallback: T): T {
  const ls = available();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : (parsed as T);
  } catch (e) {
    console.warn(`[storage] ${key} 복원 실패, 초기값 사용`, e);
    return fallback;
  }
}

export interface SaveOutcome {
  /** 저장에 성공했는가 */
  ok: boolean;
  /** 일부를 버리고(이미지 제거 등) 저장했는가 */
  degraded: boolean;
  /** 사용자에게 보여줄 설명. ok && !degraded 이면 없음 */
  message?: string;
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota/i.test(e.message)
  );
}

export function saveState(key: string, value: unknown): SaveOutcome {
  const ls = available();
  if (!ls) {
    return { ok: false, degraded: false, message: '이 브라우저에서는 로컬 저장소를 쓸 수 없습니다. 새로고침하면 데이터가 사라집니다.' };
  }
  try {
    ls.setItem(key, JSON.stringify(value));
    return { ok: true, degraded: false };
  } catch (e) {
    if (!isQuotaError(e)) {
      console.error(`[storage] ${key} 저장 실패`, e);
      return { ok: false, degraded: false, message: '로컬 저장에 실패했습니다.' };
    }
    return { ok: false, degraded: false, message: '로컬 저장소 용량을 초과했습니다.' };
  }
}

/** data URL(=OCR로 찍은 티켓 사진)인지. http(s) 포스터 URL은 작으니 남긴다 */
function isHeavyImage(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith('data:');
}

/**
 * concerts 전용 저장. 쿼터를 넘으면 오래된 항목부터 티켓 이미지를 떼어내고 재시도한다.
 * 데이터를 통째로 잃는 것보다 이미지를 잃는 쪽이 낫다 — 대신 그 사실을 반드시 알린다.
 */
export function saveConcerts<T extends { imageUrl?: string }>(items: T[]): SaveOutcome {
  const first = saveState(STORAGE_KEYS.concerts, items);
  if (first.ok) return first;

  const working = items.map(c => ({ ...c }));
  let stripped = 0;

  // 오래된 항목(배열 앞쪽)부터 이미지 제거
  for (let i = 0; i < working.length; i++) {
    if (!isHeavyImage(working[i].imageUrl)) continue;
    delete working[i].imageUrl;
    stripped++;
    const attempt = saveState(STORAGE_KEYS.concerts, working);
    if (attempt.ok) {
      return {
        ok: true,
        degraded: true,
        message: `저장 공간이 부족해 오래된 티켓 사진 ${stripped}장을 저장하지 않았습니다. 공연 정보는 모두 보존됩니다.`,
      };
    }
  }

  return {
    ok: false,
    degraded: true,
    message: '저장 공간이 부족해 아카이브를 저장하지 못했습니다. 브라우저 저장소를 정리한 뒤 다시 시도하세요.',
  };
}

export function clearAll(): void {
  const ls = available();
  if (!ls) return;
  Object.values(STORAGE_KEYS).forEach(k => ls.removeItem(k));
}
