#!/usr/bin/env node
/**
 * tools/hybrid_ocr.mjs — 하이브리드 OCR 파이프라인 CLI
 *
 *   티켓 이미지
 *      ① macOS Vision (tools/vision_ocr.py, 무료·무제한·오프라인·~1.2초)
 *   raw 텍스트 줄 + confidence + 바운딩박스
 *      ② 여러 장을 한 요청에 묶어 LLM 구조화 (이미지 아님, 텍스트만)
 *   구조화 JSON (= 앱의 OCR_RESPONSE_SCHEMA 와 같은 모양)
 *      ③ postProcessOCR / parseSeat / normalizeDate  ← 채점기가 그대로 태운다
 *
 * 왜 배치인가: Gemini 무료 티어는 **요청 20회/일** 제한이다(토큰이 아니라 요청 수).
 * 이미지를 텍스트로 바꿔 두면 20장을 1요청에 넣을 수 있어 제한이 사실상 사라진다.
 *
 * 결과는 eval/ 하네스와 **같은 raw 레코드 형식**으로 저장하므로 같은 정답지·같은
 * 채점기로 잰다:
 *   node tools/hybrid_ocr.mjs --provider gemini
 *   node eval/score.mjs --raw-dir eval/out/raw-hybrid --out eval/out/hybrid
 *
 * ⚠️ 어떤 API 키도 로그·출력·저장 파일에 남기지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import { parseArgs, num } from '../eval/lib/cli.mjs';
import { parseEnv, loadEnvFiles, getGeminiKey, KeyError, redact } from '../eval/lib/env.mjs';
import { listTickets, MIME } from '../eval/lib/truth.mjs';
import { makeScopeFilter, parseScope, DEFAULT_OUT_OF_SCOPE_PREFIXES } from '../eval/lib/scope.mjs';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const DEFAULT_OPENAI_ENV = '/Users/macbook/Desktop/ai-hedge-fund-main/.env';
const DEFAULT_MODELS = {
  gemini: null,                       // null → ocrSchema.ts 의 OCR_MODEL
  openai: 'gpt-5-mini-2025-08-07',    // 실제 존재 확인: GET /v1/models (2026-08-26)
};

const args = parseArgs(process.argv.slice(2), {
  booleans: ['no-llm', 'no-cache', 'no-fix', 'help', 'dry-run', 'vision-only', 'json'],
});

if (args.help) {
  console.log(`tools/hybrid_ocr.mjs — macOS Vision + LLM 구조화 하이브리드 OCR

옵션:
  --provider gemini|openai   2단계 LLM 프로바이더 (기본 gemini)
  --model <id>               모델 override
                             기본: gemini = ocrSchema.ts 의 OCR_MODEL
                                   openai = ${DEFAULT_MODELS.openai}
  --openai-env <path>        OPENAI_API_KEY 를 읽을 .env 경로
                             기본 ${DEFAULT_OPENAI_ENV} (복사하지 않고 그 자리에서 읽는다)
  --batch N                  한 요청에 묶을 티켓 수 (기본 20)
  --no-llm                   LLM 없이 Vision + 규칙만 (오프라인 폴백, 요청 0회)
  --no-fix                   Vision 체계적 오류 교정 끄기 (A/B 측정용)
  --scope in|out|all         대상 범위 (기본 all). 범위 외 접두사: ${DEFAULT_OUT_OF_SCOPE_PREFIXES.join(', ')}
  --only <파일명>            이미지 하나만
  --images <dir>             이미지 디렉터리 (기본 testdata/tickets)
  --out-dir <dir>            raw 저장 위치 (기본 eval/out/raw-hybrid)
  --label <s>                meta.model 에 붙일 라벨 override
  --scales 1,2               Vision 을 여러 배율로 돌려 줄 목록을 합친다 (기본 1,2)
                             저해상도 티켓은 배율마다 다른 글자가 살아난다 — 무료·로컬이라
                             후보를 늘리는 값이 싸다. 판단은 2단계 LLM 이 한다
  --no-cache                 Vision 캐시 무시
  --vision-only              1단계 결과만 출력하고 종료 (LLM 호출 없음)
  --max-retries N            429/5xx 재시도 (기본 3)
  --max-requests N           LLM 요청 총량 상한 (기본 10). 넘으면 즉시 중단한다 —
                             분할 재시도가 폭주해 쿼터를 통째로 태우는 사고를 막는다
  --timeout N                요청 타임아웃 ms (기본 180000)
  --dry-run                  대상/설정만 출력
  --json                     요약을 JSON 으로 출력

측정:
  node tools/hybrid_ocr.mjs --provider gemini
  node eval/score.mjs --raw-dir eval/out/raw-hybrid --out eval/out/hybrid
`);
  process.exit(0);
}

function die(msg, code = 1) { console.error(`\n${msg}\n`); process.exit(code); }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const sha64 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const dirSafe = (m) => String(m).replace(/[^A-Za-z0-9._-]/g, '_');

// ---------- 1) 앱 모듈 로드 (프롬프트·스키마·후처리는 전부 앱 것을 쓴다) ----------
async function loadTs(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) die(`[중단] ${rel} 가 없습니다.`);
  try { return await import(pathToFileURL(p).href); }
  catch (e) { die(`[중단] ${rel} import 실패:\n  ${e.message}`); }
}
const ocrSchema = await loadTs('app/services/ocrSchema.ts');
const H = await loadTs('app/services/hybridOcr.ts');

// ---------- 2) 설정 ----------
const provider = String(args.provider ?? 'gemini').toLowerCase();
if (!['gemini', 'openai'].includes(provider)) die(`[중단] --provider 는 gemini|openai 중 하나여야 합니다 (받은 값: ${args.provider})`);
const noLlm = args['no-llm'] === true;
const noFix = args['no-fix'] === true;
const batchSize = Math.max(1, num(args.batch, 20));
const maxRetries = Math.max(0, num(args['max-retries'], 3));
const timeoutMs = Math.max(5000, num(args.timeout, 180000));
// ⚠️ 요청 총량 상한. 분할 재시도는 재귀적이라 최악의 경우 장수의 2배 × 재시도 횟수만큼
//    요청이 나갈 수 있다. 무료 쿼터(20회/일)와 유료 크레딧을 지키는 마지막 방어선이다.
const maxRequests = Math.max(1, num(args['max-requests'], 10));
// Vision 배율. 1배만 쓰면 저해상도 티켓에서 글자가 뭉개진 채로 끝난다.
// 여러 배율의 결과를 합치면 어떤 배율에서만 살아나는 줄이 후보에 들어온다.
const scales = String(args.scales ?? '1,2').split(',').map((x) => Math.max(1, num(x, 1)))
  .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
const model = noLlm ? null : (args.model ? String(args.model) : (DEFAULT_MODELS[provider] ?? ocrSchema.OCR_MODEL));

const imagesDir = args.images ? path.resolve(args.images) : path.join(ROOT, 'testdata', 'tickets');
const outBase = args['out-dir'] ? path.resolve(args['out-dir']) : path.join(ROOT, 'eval', 'out', 'raw-hybrid');
const cacheDir = path.join(ROOT, 'work', 'vision_cache');

// meta.model 라벨. 채점기는 이 값으로 결과를 가른다 — 하이브리드와 vision 단독이
// 절대 한 숫자로 합쳐지지 않도록 방식이 라벨에 드러나야 한다.
const label = args.label ? String(args.label)
  : noLlm ? 'hybrid-vision-only'
  : `hybrid-${provider}-${model}${noFix ? '-nofix' : ''}`;

let files = listTickets(imagesDir);
const scope = makeScopeFilter({ scope: parseScope(args.scope ?? 'all') });
if (args.scope) files = files.filter((f) => scope.accepts(f));
if (args.only) files = files.filter((f) => f === args.only || path.basename(f, path.extname(f)) === args.only);
if (!files.length) die(`[중단] 대상 이미지가 없습니다: ${imagesDir}`);

console.log(`대상 이미지 ${files.length}건 · ${imagesDir}`);
console.log(`① Vision: tools/vision_ocr.py · 배율 ${scales.join('x, ')}x (캐시 ${path.relative(ROOT, cacheDir)}${args['no-cache'] ? ', 무시' : ''})`);
console.log(`② 구조화: ${noLlm ? '없음 (--no-llm, 규칙 기반 폴백)' : `${provider} / ${model} · 배치 ${batchSize}장`}`);
console.log(`③ 후처리: app/services/ocrSchema.ts postProcessOCR (채점기가 수행)`);
console.log(`체계적 오류 교정: ${noFix ? '끔 (--no-fix)' : '켬'}`);
console.log(`라벨(meta.model): ${label}`);

if (args['dry-run']) {
  console.log('\n[dry-run] 호출 없이 종료. 대상:');
  for (const f of files) console.log('  - ' + f);
  const nBatches = noLlm ? 0 : Math.ceil(files.length / batchSize);
  console.log(`\n예상 LLM 요청 수: ${nBatches}`);
  process.exit(0);
}

/* ================================================================== *
 * ① Vision 단계
 * ================================================================== */
fs.mkdirSync(cacheDir, { recursive: true });

/** 한 배율에서 Vision 을 돌린다. 결과는 이미지 해시 + 배율로 캐시한다. */
async function visionOnce(src, key, scale, tmpDir) {
  const cp = path.join(cacheDir, `${key}${scale === 1 ? '' : `.x${scale}`}.json`);
  if (!args['no-cache'] && fs.existsSync(cp)) {
    try {
      const j = JSON.parse(fs.readFileSync(cp, 'utf8'));
      if (j && j.page) return { page: j.page, ms: 0, cached: true };
    } catch { /* 깨진 캐시는 무시하고 다시 돌린다 */ }
  }
  let target = src;
  if (scale !== 1) {
    const w = Number(String(execFileSync('sips', ['-g', 'pixelWidth', src]).toString().match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0));
    if (!w) throw new Error(`sips 로 이미지 폭을 읽지 못했습니다: ${src}`);
    target = path.join(tmpDir, `${path.basename(src, path.extname(src))}_x${scale}.png`);
    execFileSync('sips', ['-Z', String(Math.round(w * scale)), '-s', 'format', 'png', src, '--out', target], { stdio: 'pipe' });
  }
  const t0 = Date.now();
  const { stdout } = await execFileP('python3', [path.join(HERE, 'vision_ocr.py'), target], { maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  const page = parsed[target] ?? Object.values(parsed)[0];
  const ms = Date.now() - t0;
  fs.writeFileSync(cp, JSON.stringify({ src: path.basename(src), scale, page, ranAt: new Date().toISOString() }));
  return { page, ms, cached: false };
}

/** 비교용 정규화 — 공백/구두점 차이로 같은 줄이 중복 후보가 되지 않게 */
const canon = (t) => String(t ?? '').normalize('NFKC').replace(/[\s\u200B-\u200D]/g, '')
  .replace(/[.,·・:;()\[\]{}<>'"`~!?/\\-]/g, '').toLowerCase();

async function visionOcr(file, tmpDir) {
  const src = path.join(imagesDir, file);
  const buf = fs.readFileSync(src);
  const key = sha64(buf);

  let base = null, totalMs = 0, allCached = true;
  const seen = new Set();
  const merged = [];
  for (const scale of scales) {
    const r = await visionOnce(src, key, scale, tmpDir);
    totalMs += r.ms;
    if (!r.cached) allCached = false;
    if (!r.page?.ok) { if (!base) base = r.page; continue; }
    if (!base) base = { ...r.page, lines: [] };
    for (const ln of r.page.lines) {
      const c = canon(ln.text);
      if (!c || seen.has(c)) continue;      // 같은 글자를 배율마다 다시 넣지 않는다
      seen.add(c);
      merged.push({ ...ln, scale });
    }
  }
  if (base?.ok) {
    // 합친 줄을 다시 읽는 순서로 정렬한다(좌표는 배율과 무관한 정규화 값이라 비교 가능).
    merged.sort((a, b) => {
      const ay = (a.box?.[1] ?? 0) + (a.box?.[3] ?? 0) / 2;
      const by = (b.box?.[1] ?? 0) + (b.box?.[3] ?? 0) / 2;
      const ab = Math.trunc(ay / 0.02), bb = Math.trunc(by / 0.02);
      return ab !== bb ? ab - bb : (a.box?.[0] ?? 0) - (b.box?.[0] ?? 0);
    });
    merged.forEach((ln, i) => { ln.i = i; });
    base.lines = merged;
  }
  return {
    file, page: base ?? { ok: false, width: 0, height: 0, lines: [], error: 'Vision 결과 없음' },
    visionMs: totalMs, cached: allCached, imageHash: key, bytes: buf.length,
  };
}

const visionStart = Date.now();
const visionTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-hybrid-'));
const pages = [];
for (const file of files) {
  try {
    const r = await visionOcr(file, visionTmp);
    pages.push(r);
    process.stdout.write(`  vision ${r.cached ? 'cache' : 'ok   '} ${file}  ${r.page?.lines?.length ?? 0}줄  ${r.cached ? '' : r.visionMs + 'ms'}\n`);
  } catch (e) {
    pages.push({ file, page: { ok: false, width: 0, height: 0, lines: [], error: e.message }, visionMs: 0, cached: false, imageHash: null, bytes: 0 });
    process.stdout.write(`  vision FAIL  ${file}  ${e.message.split('\n')[0]}\n`);
  }
}
fs.rmSync(visionTmp, { recursive: true, force: true });
const visionWallMs = Date.now() - visionStart;

// 체계적 오류 교정
const fixedPages = pages.map((p) => (noFix ? { page: p.page, fixes: [] } : H.applySystematicFixes(p.page)));
const allFixes = fixedPages.flatMap((f, i) => f.fixes.map((x) => ({ file: pages[i].file, ...x })));
if (allFixes.length) {
  console.log(`\n[체계적 오류 교정] ${allFixes.length}건`);
  for (const f of allFixes) console.log(`  ${f.file} [${f.i}] ${f.rule}\n    ${f.before}\n  → ${f.after}`);
} else {
  console.log(`\n[체계적 오류 교정] 0건`);
}

if (args['vision-only']) {
  console.log('\n[--vision-only] 2단계 없이 종료합니다.');
  console.log(JSON.stringify(fixedPages.map((f, i) => ({ file: pages[i].file, ...f.page })), null, 1));
  process.exit(0);
}

/* ================================================================== *
 * ② LLM 배치 구조화
 * ================================================================== */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class LlmError extends Error {
  constructor(msg, { status = 0, retriable = false, fatal = false } = {}) {
    super(msg); this.status = status; this.retriable = retriable; this.fatal = fatal;
  }
}
/** 예산 소진 / 쿼터 소진 — 더 쪼개도 안 되는 상황. 즉시 멈춘다. */
class BudgetError extends Error {}

/** 일일 쿼터 소진인가 (분당 rate limit 과 구분). 쿼터 소진이면 쪼개도 소용없다. */
function isQuotaExhausted(msg) {
  return /PerDay|per day|generate_content_free_tier_requests|quota.*exceeded/i.test(String(msg));
}

/** 키 회수. 값은 반환만 하고 절대 출력하지 않는다. */
function getKey() {
  if (provider === 'gemini') {
    try { return getGeminiKey(ROOT).key; }
    catch (e) { if (e instanceof KeyError) die(`[중단] ${e.message}`); throw e; }
  }
  const p = args['openai-env'] ? path.resolve(args['openai-env']) : DEFAULT_OPENAI_ENV;
  if (!fs.existsSync(p)) die(`[중단] OPENAI_API_KEY 를 읽을 파일이 없습니다: ${p}\n  --openai-env <path> 로 지정하세요.`);
  const env = parseEnv(fs.readFileSync(p, 'utf8'));
  const key = (process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || '').trim();
  if (!key || /^PLACEHOLDER|^your/i.test(key)) die(`[중단] ${p} 에 유효한 OPENAI_API_KEY 가 없습니다.`);
  return key;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_BASE = 'https://api.openai.com/v1';

async function callGemini({ apiKey, prompt, input, n }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, { text: '\n\n# 입력\n' + input }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: H.batchResponseSchema(),
      // 앱과 같은 생성 설정. thinkingConfig 를 빠뜨리면 지연이 20배가 된다.
      ...(ocrSchema.OCR_GENERATION_CONFIG ?? {}),
    },
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const text = redact(await res.text().catch(() => ''), apiKey).slice(0, 600);
      throw new LlmError(`HTTP ${res.status}: ${text}`, {
        status: res.status,
        retriable: res.status === 429 || res.status === 408 || res.status >= 500,
      });
    }
    const data = await res.json();
    const cand = data.candidates?.[0];
    const rawText = (cand?.content?.parts || []).map((p) => p.text || '').join('');
    return { rawText, latencyMs, usage: data.usageMetadata || null, finishReason: cand?.finishReason ?? null };
  } finally { clearTimeout(timer); }
}

async function callOpenAI({ apiKey, prompt, input, n }) {
  const body = {
    model,
    input: [
      { role: 'system', content: prompt },
      { role: 'user', content: '# 입력\n' + input },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'ticket_batch',
        strict: true,
        schema: H.batchJsonSchema(),
      },
    },
    // 판독은 정형 태스크다. 추론을 길게 돌릴 이유가 없고 그대로 비용이다.
    reasoning: { effort: 'low' },
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${OPENAI_BASE}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const text = redact(await res.text().catch(() => ''), apiKey).slice(0, 600);
      throw new LlmError(`HTTP ${res.status}: ${text}`, {
        status: res.status,
        retriable: res.status === 429 || res.status === 408 || res.status >= 500,
      });
    }
    const data = await res.json();
    let rawText = data.output_text ?? '';
    if (!rawText) {
      for (const item of data.output || []) {
        for (const c of item.content || []) if (typeof c.text === 'string') rawText += c.text;
      }
    }
    return {
      rawText, latencyMs,
      usage: data.usage ? {
        promptTokenCount: data.usage.input_tokens,
        candidatesTokenCount: data.usage.output_tokens,
        thoughtsTokenCount: data.usage.output_tokens_details?.reasoning_tokens ?? 0,
        totalTokenCount: data.usage.total_tokens,
      } : null,
      finishReason: data.status ?? null,
    };
  } finally { clearTimeout(timer); }
}

function parseJsonLoose(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  const a = text.indexOf('['); const b = text.lastIndexOf(']');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

const stats = { llmRequests: 0, llmRetries: 0, splitRetries: 0, llmLatencyMs: [], usage: [], errors: [] };

/** 배치 1개 처리. 개수 불일치/형식 오류면 배치를 반으로 쪼개 재시도한다. */
async function structureBatch(apiKey, group, depth = 0) {
  const n = group.length;
  const prompt = H.buildBatchPrompt(n);
  const input = H.renderBatchInput(group.map((g) => g.page));

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      if (stats.llmRequests >= maxRequests) {
        throw new BudgetError(`LLM 요청 상한 ${maxRequests}회 도달 — 중단합니다 (--max-requests 로 조정).`);
      }
      stats.llmRequests++;
      const call = provider === 'gemini' ? callGemini : callOpenAI;
      const r = await call({ apiKey, prompt, input, n });
      stats.llmLatencyMs.push(r.latencyMs);
      if (r.usage) stats.usage.push(r.usage);
      const json = parseJsonLoose(r.rawText);
      if (json === null) throw new LlmError(`JSON 파싱 실패 (finishReason=${r.finishReason}, ${r.rawText.length}자)`, { retriable: false });
      // ⚠️ 개수·순서 검증. 여기서 막지 않으면 3번 티켓의 좌석이 5번에 붙는다.
      const items = H.validateBatch(json, n);
      process.stdout.write(`  llm  ok    ${n}장  ${r.latencyMs}ms  요청#${stats.llmRequests}\n`);
      return group.map((g, i) => ({ file: g.file, output: items[i], latencyMs: r.latencyMs, usage: r.usage, batchSize: n, requestIndex: stats.llmRequests }));
    } catch (e) {
      if (e instanceof BudgetError) throw e;                 // 예산 초과는 위로 그대로 던진다
      lastErr = e;
      if (e instanceof LlmError && e.status === 429 && isQuotaExhausted(e.message)) {
        // 일일 쿼터 소진. 재시도도 분할도 의미가 없다 — 요청만 더 태운다.
        throw new BudgetError(`일일 쿼터 소진(429). 재시도/분할하지 않고 중단합니다.\n  ${String(e.message).slice(0, 300)}`);
      }
      const isShape = e instanceof H.BatchShapeError;
      const msg = String(e.message).slice(0, 200);
      process.stdout.write(`  llm  ${isShape ? 'SHAPE' : 'FAIL '} ${n}장  ${msg}\n`);
      if (isShape) break;                                   // 형식 문제는 재호출로 안 낫는다 → 분할
      if (!(e instanceof LlmError) || !e.retriable) break;
      if (attempt > maxRetries) break;
      stats.llmRetries++;
      await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)));
    }
  }

  // 분할 재시도 — 1장까지 내려가면 포기하고 에러 레코드를 낸다.
  if (n > 1 && stats.llmRequests < maxRequests) {
    stats.splitRetries++;
    process.stdout.write(`  llm  split ${n}장 → ${Math.ceil(n / 2)} + ${n - Math.ceil(n / 2)} (${String(lastErr?.message).slice(0, 80)})\n`);
    const half = Math.ceil(n / 2);
    const a = await structureBatch(apiKey, group.slice(0, half), depth + 1);
    const b = await structureBatch(apiKey, group.slice(half), depth + 1);
    return [...a, ...b];
  }
  stats.errors.push({ file: group[0].file, error: redact(String(lastErr?.message ?? '알 수 없음'), apiKey) });
  return [{ file: group[0].file, output: null, error: redact(String(lastErr?.message ?? '알 수 없음'), apiKey), latencyMs: null, usage: null, batchSize: 1, requestIndex: stats.llmRequests }];
}

const prepared = files.map((file, i) => ({ file, page: fixedPages[i].page }));
let structured;
const llmStart = Date.now();

if (noLlm) {
  structured = prepared.map((g) => ({
    file: g.file,
    output: H.ruleBasedStructure(g.page),
    latencyMs: null, usage: null, batchSize: 0, requestIndex: 0,
  }));
  console.log(`\n[--no-llm] 규칙 기반 구조화 ${structured.length}건 (LLM 요청 0회)`);
} else {
  const apiKey = getKey();
  const groups = [];
  for (let i = 0; i < prepared.length; i += batchSize) groups.push(prepared.slice(i, i + batchSize));
  console.log(`\n[LLM 구조화] ${prepared.length}장 → ${groups.length}개 배치 (배치당 최대 ${batchSize}장)`);
  structured = [];
  let aborted = null;
  for (const g of groups) {
    if (aborted) { structured.push(...g.map((x) => ({ file: x.file, output: null, error: `중단: ${aborted}`, latencyMs: null, usage: null, batchSize: 0, requestIndex: 0 }))); continue; }
    try { structured.push(...await structureBatch(apiKey, g)); }
    catch (e) {
      if (!(e instanceof BudgetError)) throw e;
      aborted = e.message;
      console.error(`\n[중단] ${e.message}`);
      structured.push(...g.map((x) => ({ file: x.file, output: null, error: `중단: ${e.message}`, latencyMs: null, usage: null, batchSize: 0, requestIndex: 0 })));
    }
  }
}
const llmWallMs = Date.now() - llmStart;

/* ================================================================== *
 * ③ raw 레코드 저장 (eval 하네스와 동일 형식)
 * ================================================================== */
const RAW = path.join(outBase, dirSafe(label));
fs.mkdirSync(RAW, { recursive: true });

const promptHash = sha(noLlm ? 'rule-based-fallback' : H.buildBatchPrompt(batchSize));
const schemaHash = sha(JSON.stringify(ocrSchema.OCR_RESPONSE_SCHEMA));

let nOk = 0, nFail = 0;
for (let i = 0; i < prepared.length; i++) {
  const file = prepared[i].file;
  const s = structured.find((x) => x.file === file);
  const v = pages[i];
  // 지연은 **이미지 1장에 실제로 든 시간**으로 환산한다.
  // 배치 요청 지연을 장수로 나누고 Vision 시간을 더한다. 배치를 쓰면 장당 LLM
  // 시간이 줄어드는 것이 하이브리드의 핵심 이점이라, 요청 지연을 그대로 쓰면
  // 20장 배치가 "장당 40초" 로 보이는 왜곡이 생긴다.
  const perImageLlm = s && typeof s.latencyMs === 'number' && s.batchSize > 0 ? s.latencyMs / s.batchSize : 0;
  const rec = {
    meta: {
      file, repeatIndex: 1, model: label,
      promptHash, schemaHash,
      imageHash: v.imageHash, bytes: v.bytes,
      mimeType: MIME[path.extname(file).toLowerCase()] || 'image/jpeg',
      schemaModule: 'app/services/ocrSchema.ts',
      pipeline: 'hybrid',
      hybrid: {
        stage1: 'macos-vision (tools/vision_ocr.py)',
        stage2: noLlm ? 'rule-based (--no-llm)' : `${provider}:${model}`,
        batchSize: s?.batchSize ?? 0,
        requestIndex: s?.requestIndex ?? 0,
        systematicFixes: fixedPages[i].fixes,
        scales,
        visionLines: v.page?.lines?.length ?? 0,
        visionMs: v.visionMs,
        visionCached: v.cached,
        noFix,
      },
      ranAt: new Date().toISOString(),
    },
    latencyMs: Math.round((v.cached ? 0 : v.visionMs) + perImageLlm),
    visionMs: v.visionMs,
    llmLatencyMs: s?.latencyMs ?? null,
    attempts: 1,
    usage: s?.usage ?? null,
    finishReason: null,
    parseError: null,
    rawText: null,
    output: s?.output ?? null,
  };
  if (s?.error) { rec.error = s.error; rec.output = null; nFail++; } else if (rec.output) nOk++; else { rec.error = '구조화 결과 없음'; nFail++; }
  fs.writeFileSync(path.join(RAW, `${file}.json`), JSON.stringify(rec, null, 2));
}

const lat = stats.llmLatencyMs;
const summary = {
  ranAt: new Date().toISOString(),
  model: label,
  pipeline: 'hybrid',
  provider: noLlm ? 'none' : provider,
  llmModel: model,
  batchSize: noLlm ? 0 : batchSize,
  scales, noFix,
  promptHash, schemaHash,
  nImages: prepared.length, nOk, nFailed: nFail,
  nLlmRequests: stats.llmRequests,
  nLlmRetries: stats.llmRetries,
  nSplitRetries: stats.splitRetries,
  systematicFixes: allFixes.length,
  systematicFixDetail: allFixes,
  visionWallMs, llmWallMs,
  visionMsPerImage: Math.round(pages.reduce((s2, p) => s2 + (p.cached ? 0 : p.visionMs), 0) / Math.max(1, pages.filter((p) => !p.cached).length)),
  llmLatency: lat.length ? { n: lat.length, meanMs: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length), maxMs: Math.max(...lat) } : null,
  tokens: stats.usage.length ? {
    promptTotal: stats.usage.reduce((s2, u) => s2 + (u.promptTokenCount || 0), 0),
    candidatesTotal: stats.usage.reduce((s2, u) => s2 + (u.candidatesTokenCount || 0), 0),
    thoughtsTotal: stats.usage.reduce((s2, u) => s2 + (u.thoughtsTokenCount || 0), 0),
    totalTotal: stats.usage.reduce((s2, u) => s2 + (u.totalTokenCount || 0), 0),
  } : null,
  errors: stats.errors,
};
fs.writeFileSync(path.join(RAW, '_run-summary.json'), JSON.stringify(summary, null, 2));
// 요약은 raw 디렉터리 트리 **밖**에 둔다. 안에 두면 score.mjs 가 raw 로 착각해
// "meta.model 이 없어 무시" 경고를 낸다.
fs.writeFileSync(path.join(path.dirname(outBase), `run-summary-${dirSafe(label)}.json`), JSON.stringify(summary, null, 2));

console.log(`\n완료: 성공 ${nOk} · 실패 ${nFail}`);
console.log(`LLM 요청 ${stats.llmRequests}회 (재시도 ${stats.llmRetries} · 분할 ${stats.splitRetries}) · 이미지 ${prepared.length}장`);
console.log(`Vision ${Math.round(visionWallMs / 1000)}s · LLM ${Math.round(llmWallMs / 1000)}s · 체계적 교정 ${allFixes.length}건`);
if (summary.tokens) console.log(`토큰 입력 ${summary.tokens.promptTotal} / 출력 ${summary.tokens.candidatesTotal} / thinking ${summary.tokens.thoughtsTotal}`);
console.log(`raw: ${path.relative(ROOT, RAW)}/`);
console.log(`다음: node eval/score.mjs --raw-dir ${path.relative(ROOT, outBase)} --model ${label} --out eval/out/${dirSafe(label)}`);
if (args.json) console.log('\n' + JSON.stringify(summary, null, 2));
if (nFail) process.exit(2);
