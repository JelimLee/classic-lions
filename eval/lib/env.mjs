// .env.local 로더 — 키 값은 절대 로그/출력에 노출하지 않는다.
import fs from 'node:fs';
import path from 'node:path';

/** KEY=VALUE 형식 파싱. 값에 '='가 있어도 첫 '='만 구분자로 쓴다. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim().replace(/^export\s+/, '');
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

/** 프로젝트 루트 기준 후보 경로들을 순회하며 병합(뒤에 오는 것이 우선순위 낮음). */
export function loadEnvFiles(rootDir) {
  // .env.local 과 .env 를 모두 본다(앞에 오는 파일이 우선).
  const candidates = [
    path.join(rootDir, 'eval', '.env.local'),
    path.join(rootDir, 'eval', '.env'),
    path.join(rootDir, '.env.local'),
    path.join(rootDir, '.env'),
    path.join(rootDir, 'app', '.env.local'),
    path.join(rootDir, 'app', '.env'),
  ];
  const merged = {};
  const found = [];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    found.push(p);
    const vals = parseEnv(fs.readFileSync(p, 'utf8'));
    for (const [k, v] of Object.entries(vals)) if (!(k in merged)) merged[k] = v;
  }
  return { env: merged, files: found };
}

export class KeyError extends Error {}

/**
 * GEMINI_API_KEY 회수. 값 자체는 반환만 하고 절대 출력하지 않는다.
 * 없거나 PLACEHOLDER로 시작하면 KeyError를 던진다(한국어 안내 포함).
 */
export function getGeminiKey(rootDir) {
  const { env, files } = loadEnvFiles(rootDir);
  const key = (process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || env.API_KEY || '').trim();
  const where = files.length ? files.map((f) => `  - ${f}`).join('\n') : '  (탐색된 .env.local 파일 없음)';

  if (!key) {
    throw new KeyError(
      `GEMINI_API_KEY 를 찾지 못했습니다.\n탐색한 파일:\n${where}\n\n` +
      `해결: 아래 중 한 곳에 실제 키를 넣으세요 (파일은 .gitignore 대상입니다).\n` +
      `  echo 'GEMINI_API_KEY=여기에_실제_키' > ${path.join(rootDir, 'app', '.env')}\n` +
      `키는 https://aistudio.google.com/apikey 에서 발급합니다.`
    );
  }
  // 주의: 키 '형식'은 검증하지 않는다. 신형 키는 'AQ.' 로 시작하고 구형은 'AIza' 다.
  // 접두사를 요구하면 유효한 키를 거부하게 된다. 비어있음/플레이스홀더만 본다.
  if (/^PLACEHOLDER/i.test(key)) {
    throw new KeyError(
      `GEMINI_API_KEY 가 아직 플레이스홀더 값입니다.\n탐색한 파일:\n${where}\n\n` +
      `해결: 해당 파일의 GEMINI_API_KEY 를 실제 키로 교체하세요.\n` +
      `키 발급: https://aistudio.google.com/apikey\n` +
      `(키가 준비될 때까지는 채점 로직만 검증할 수 있습니다: node eval/score.mjs --fixtures)`
    );
  }
  return { key, sourceFiles: files };
}

/** 예외 메시지 등에 키가 섞여 나가는 것을 방지하는 최후 방어선. */
export function redact(text, key) {
  if (!key || !text) return String(text ?? '');
  return String(text).split(key).join('***REDACTED***');
}
