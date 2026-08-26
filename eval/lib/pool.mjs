/** 동시 실행 제한 풀. 실패해도 나머지가 계속 돌아가도록 결과를 settle 형태로 반환. */
export async function pMap(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = new Array(Math.min(concurrency, items.length || 1)).fill(0).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try { results[i] = { ok: true, value: await worker(items[i], i) }; }
      catch (e) { results[i] = { ok: false, error: e }; }
    }
  });
  await Promise.all(runners);
  return results;
}
