import fs from 'node:fs';
import path from 'node:path';

export function truthPath(rootDir) { return path.join(rootDir, 'testdata', 'eval', 'ground_truth.json'); }

export class TruthError extends Error {
  constructor(msg, { pending = false } = {}) { super(msg); this.pending = pending; }
}

/** ground_truth.json 로드 + 최소 검증. 없으면 pending 에러(대기 중임을 명확히 알림). */
export function loadTruth(p) {
  if (!fs.existsSync(p)) {
    throw new TruthError(
      `테스트 데이터 담당 산출물 대기 중 — ${p} 가 아직 없습니다.\n` +
      `기대 형식: { "version": 1, "items": [ { "file", "difficulty", "truth", "unreadable_fields" } ] }`,
      { pending: true }
    );
  }
  let data;
  try { data = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new TruthError(`${p} JSON 파싱 실패: ${e.message}`); }
  if (!data || !Array.isArray(data.items)) throw new TruthError(`${p} 에 items 배열이 없습니다.`);

  const problems = [];
  for (const [i, it] of data.items.entries()) {
    if (!it.file) problems.push(`items[${i}].file 누락`);
    if (!it.truth) problems.push(`items[${i}].truth 누락`);
    if (it.unreadable_fields && !Array.isArray(it.unreadable_fields)) problems.push(`items[${i}].unreadable_fields 가 배열이 아님`);
  }
  return { data, problems };
}

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);
export const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic' };

export function listTickets(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => !f.startsWith('.') && IMG_EXT.has(path.extname(f).toLowerCase()))
    .sort();
}
