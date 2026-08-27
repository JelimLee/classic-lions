#!/usr/bin/env node
// eval/run.mjs — 티켓 이미지에 대해 실제 앱의 프롬프트/스키마로 Gemini OCR을 실행하고
// 원 응답을 eval/out/raw/ 에 저장한다. 채점은 score.mjs 가 한다.
//
// 사용법:
//   node eval/run.mjs
//   node eval/run.mjs --only lotte_met_opera_2024.jpg
//   node eval/run.mjs --no-cache --repeat 3 --concurrency 3
//   node eval/run.mjs --resize 1568           (ARCHITECTURE 4-3 C1 비교용, macOS sips 사용)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseArgs, num } from './lib/cli.mjs';
import { getGeminiKey, KeyError, redact } from './lib/env.mjs';
import { loadOcrSchema, SchemaModuleError, defaultSchemaPath } from './lib/loadSchema.mjs';
import { truthPath, loadTruth, TruthError, listTickets, MIME } from './lib/truth.mjs';
import { generateOcr } from './lib/gemini.mjs';
import { pMap } from './lib/pool.mjs';
import { makeScopeFilter, parseScope, DEFAULT_OUT_OF_SCOPE_PREFIXES } from './lib/scope.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
let RAW_BASE = path.join(OUT, 'raw');
/** 모델 이름을 디렉터리로 쓸 수 있게 정규화. */
const modelDirName = (m) => String(m).replace(/[^A-Za-z0-9._-]/g, '_');
let RAW;

const args = parseArgs(process.argv.slice(2), { booleans: ['no-cache', 'allow-stale-cache', 'help', 'dry-run'] });

if (args.help) {
  console.log(`eval/run.mjs — OCR 평가 러너

옵션:
  --model <id>             모델 override (기본: ocrSchema.ts 의 OCR_MODEL)
                           예: gemini-3-flash-preview / gemini-3.5-flash / gemini-3.6-flash
                           결과는 --out-suffix 로 분리 저장해야 서로 덮어쓰지 않는다
  --out-suffix <s>         원 응답 저장 디렉터리를 out/raw-<s> 로 분리 (모델 비교용)
  --scope in|out|all       평가 범위. in = 롯데+예당(기본), out = 범위 외(세종), all = 전부
                           범위 외 접두사: ${DEFAULT_OUT_OF_SCOPE_PREFIXES.join(', ')}
  --only <파일명>          해당 이미지 하나만 실행
  --no-cache               캐시 무시하고 전부 재호출
  --allow-stale-cache      프롬프트/스키마가 바뀌어도 기존 캐시 재사용 (기본: 자동 무효화)
  --repeat N               같은 이미지를 N회 호출 (비결정성 측정용, 기본 1)
  --concurrency N          동시 호출 수 (기본 3)
  --images <dir>           이미지 디렉터리 (기본 testdata/tickets)
  --truth <path>           정답지 경로 (기본 testdata/eval/ground_truth.json)
  --resize <px>            장변 px로 리사이즈 후 호출 (macOS sips). ARCHITECTURE 4-3 C1 비교용
  --temperature N          생성 온도 지정 (기본: 미지정 = 모델 기본값)
  --max-retries N          rate limit/5xx 재시도 횟수 (기본 4)
  --timeout N              호출당 타임아웃 ms (기본 90000)
  --schema-module <path>   ocrSchema 모듈 경로 override
  --dry-run                API 호출 없이 대상 목록/설정만 출력
`);
  process.exit(0);
}

function die(msg, code = 1) { console.error(`\n${msg}\n`); process.exit(code); }

// ---------- 1) 코드 담당 산출물 (프롬프트·스키마는 반드시 여기서 가져온다) ----------
const schemaModulePath = args['schema-module'] ? path.resolve(args['schema-module']) : defaultSchemaPath(ROOT);
let mod;
try {
  ({ mod } = await loadOcrSchema(schemaModulePath));
} catch (e) {
  if (e instanceof SchemaModuleError) die(`[중단] ${e.message}`);
  throw e;
}
// 모델은 --model 로 덮어쓸 수 있다(같은 이미지·같은 정답지로 모델 비교용).
// 기본값은 코드 담당이 정한 OCR_MODEL 을 그대로 따른다.
const MODEL = args.model ? String(args.model) : mod.OCR_MODEL;
const MODEL_OVERRIDDEN = Boolean(args.model) && MODEL !== mod.OCR_MODEL;
const PROMPT = mod.OCR_PROMPT;
const SCHEMA = mod.OCR_RESPONSE_SCHEMA;
// 앱의 생성 설정(있으면). thinkingConfig 가 여기 들어 있다.
const GENERATION_CONFIG = (mod.OCR_GENERATION_CONFIG && typeof mod.OCR_GENERATION_CONFIG === 'object')
  ? mod.OCR_GENERATION_CONFIG : null;

// ---------- 2) 대상 이미지 ----------
// --images / --truth 로 다른 이미지 세트·정답지를 평가할 수 있다(기본값은 기존 벤치마크 그대로).
const ticketsDir = args.images ? path.resolve(String(args.images)) : path.join(ROOT, 'testdata', 'tickets');
const truthFile = args.truth ? path.resolve(String(args.truth)) : truthPath(ROOT);
let files = listTickets(ticketsDir);
let truthFiles = null;
try {
  const { data, problems } = loadTruth(truthFile);
  truthFiles = new Set(data.items.map((i) => i.file));
  if (problems.length) console.warn(`[경고] ${path.basename(truthFile)} 검증 문제 ${problems.length}건:\n  ` + problems.slice(0, 10).join('\n  '));
} catch (e) {
  if (e instanceof TruthError && e.pending) console.warn(`[경고] ${e.message}\n        → 정답지 없이 OCR만 실행합니다(채점 불가).`);
  else throw e;
}
// 범위 필터. 러너는 기본적으로 범위 외 이미지도 OCR 은 돌린다(참고 지표로 쓰기 위해).
// 헤드라인 지표에서 빼는 것은 채점기(score.mjs)의 --scope 가 담당한다.
const runScope = makeScopeFilter({ scope: parseScope(args.scope ?? 'all') });
if (args.scope) files = files.filter((f) => runScope.accepts(f));
if (args.only) files = files.filter((f) => f === args.only || path.basename(f, path.extname(f)) === args.only);
if (!files.length) {
  die(`[중단] 평가할 이미지가 없습니다: ${ticketsDir}\n` +
      (args.only ? `  --only ${args.only} 에 해당하는 파일이 없습니다.\n` : '') +
      `테스트 데이터 담당이 ${path.relative(ROOT, ticketsDir)}/*.jpg 를 생성하면 그대로 동작합니다.`);
}
if (truthFiles) {
  const missing = [...truthFiles].filter((f) => !files.includes(f));
  const extra = files.filter((f) => !truthFiles.has(f));
  if (missing.length) console.warn(`[경고] 정답지에는 있으나 이미지가 없는 항목 ${missing.length}건: ${missing.slice(0, 5).join(', ')}`);
  if (extra.length) console.warn(`[경고] 이미지는 있으나 정답지에 없는 항목 ${extra.length}건: ${extra.slice(0, 5).join(', ')}`);
}

// ---------- 3) 설정 ----------
const repeat = Math.max(1, num(args.repeat, 1));
const concurrency = Math.max(1, num(args.concurrency, 3));
const maxRetries = Math.max(0, num(args['max-retries'], 4));
const timeoutMs = Math.max(1000, num(args.timeout, 90000));
const resize = args.resize ? num(args.resize, 0) : 0;
const temperature = args.temperature !== undefined ? num(args.temperature, undefined) : undefined;
const useCache = !args['no-cache'];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const promptHash = sha(String(PROMPT));
const schemaHash = sha(JSON.stringify(SCHEMA));
const genConfigHash = sha(JSON.stringify(GENERATION_CONFIG));

if (args['out-suffix']) RAW_BASE = path.join(OUT, `raw-${String(args['out-suffix']).replace(/[^A-Za-z0-9._-]/g, '_')}`);
// 모델별로 raw 를 분리 저장한다. 이렇게 해야 모델 비교가 성립하고,
// 다른 모델의 캐시된 응답이 조용히 섞여 들어가지 않는다.
RAW = path.join(RAW_BASE, modelDirName(MODEL));
if (MODEL_OVERRIDDEN) console.log(`[안내] 모델 override: ${mod.OCR_MODEL} → ${MODEL}`);
const nOut = files.filter((f) => runScope.isOut(f)).length;
if (nOut) console.log(`[안내] 범위 외(${DEFAULT_OUT_OF_SCOPE_PREFIXES.join(',')}) ${nOut}건 포함 — 채점 시 헤드라인 지표에서는 제외됩니다`);
console.log(`대상 이미지 ${files.length}건 · repeat ${repeat} · 동시 ${concurrency}`);
console.log(`모델 ${MODEL} · prompt#${promptHash} · schema#${schemaHash} · genCfg#${genConfigHash}${resize ? ` · resize ${resize}px` : ''}`);
if (GENERATION_CONFIG) console.log(`생성 설정 ${JSON.stringify(GENERATION_CONFIG)}  (앱과 동일)`);
else console.warn('[경고] OCR_GENERATION_CONFIG 가 없어 모델 기본 설정으로 호출합니다 — 앱과 조건이 다릅니다.');
console.log(`원 응답 저장 위치 ${path.relative(ROOT, RAW)}`);
// 예전 버전이 남긴 평평한 raw 파일 경고 (모델 구분 없이 저장되던 시절)
if (fs.existsSync(RAW_BASE)) {
  const legacy = fs.readdirSync(RAW_BASE).filter((f) => f.endsWith('.json'));
  if (legacy.length) console.warn(`[경고] ${path.relative(ROOT, RAW_BASE)} 에 모델 구분 없는 옛 raw 파일 ${legacy.length}개가 있습니다. score.mjs 가 meta.model 로 판별하지만, 정리를 권합니다.`);
}
console.log(`스키마 모듈 ${schemaModulePath}`);

if (args['dry-run']) {
  console.log('\n[dry-run] 호출 없이 종료합니다. 대상:');
  for (const f of files) console.log('  - ' + f);
  process.exit(0);
}

// ---------- 4) 키 (값은 절대 출력하지 않는다) ----------
let apiKey;
try {
  ({ key: apiKey } = getGeminiKey(ROOT));
} catch (e) {
  if (e instanceof KeyError) die(`[중단] ${e.message}`);
  throw e;
}

// ---------- 5) 이미지 준비 ----------
let tmpDir = null;
function imageBytes(file) {
  const src = path.join(ticketsDir, file);
  if (!resize) return { buf: fs.readFileSync(src), mime: MIME[path.extname(file).toLowerCase()] || 'image/jpeg', resized: false };
  if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-eval-'));
  const dst = path.join(tmpDir, file);
  try {
    execFileSync('sips', ['-Z', String(resize), src, '--out', dst], { stdio: 'pipe' });
    return { buf: fs.readFileSync(dst), mime: MIME[path.extname(file).toLowerCase()] || 'image/jpeg', resized: true };
  } catch (e) {
    console.warn(`[경고] ${file} 리사이즈 실패(sips) — 원본 사용: ${e.message.split('\n')[0]}`);
    return { buf: fs.readFileSync(src), mime: MIME[path.extname(file).toLowerCase()] || 'image/jpeg', resized: false };
  }
}

fs.mkdirSync(RAW, { recursive: true });
const cachePath = (file, r) => path.join(RAW, repeat > 1 ? `${file}.r${r}.json` : `${file}.json`);

function cacheUsable(p, imageHash) {
  if (!useCache || !fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (j.error) return null;
    if (args['allow-stale-cache']) return j;
    if (j.meta?.promptHash !== promptHash || j.meta?.schemaHash !== schemaHash) return null;
    if (j.meta?.model !== MODEL) {
      console.warn(`[경고] 캐시 모델 불일치 무시: ${path.basename(p)} 는 ${j.meta?.model} 응답인데 현재 요청은 ${MODEL} 입니다.`);
      return null;
    }
    if (j.meta?.imageHash !== imageHash) return null;
    if ((j.meta?.resize || 0) !== resize) return null;
    // 생성 설정(thinking 등)이 바뀌면 지연·토큰이 달라지므로 캐시를 재사용하지 않는다.
    if ((j.meta?.genConfigHash ?? null) !== genConfigHash) return null;
    return j;
  } catch { return null; }
}

// ---------- 6) 실행 ----------
const jobs = [];
for (const file of files) for (let r = 1; r <= repeat; r++) jobs.push({ file, r });

let cached = 0, called = 0, failed = 0;
const startedAt = Date.now();

const results = await pMap(jobs, concurrency, async ({ file, r }) => {
  const { buf, mime, resized } = imageBytes(file);
  const imageHash = sha(buf.toString('base64').slice(0, 4096) + ':' + buf.length);
  const p = cachePath(file, r);

  const hit = cacheUsable(p, imageHash);
  if (hit) { cached++; process.stdout.write(`  cache  ${file}${repeat > 1 ? ` #${r}` : ''}\n`); return hit; }

  let rec;
  try {
    const res = await generateOcr({
      apiKey, model: MODEL, prompt: PROMPT, schema: SCHEMA,
      imageBase64: buf.toString('base64'), mimeType: mime,
      maxRetries, timeoutMs, temperature,
      // 앱과 같은 생성 설정(temperature 0 · thinkingLevel MINIMAL)으로 호출한다.
      // 이걸 넘기지 않으면 thinking 이 기본값으로 돌아 지연/토큰이 앱과 달라진다.
      generationConfig: GENERATION_CONFIG,
    });
    called++;
    rec = {
      meta: {
        file, repeatIndex: r, model: MODEL, promptHash, schemaHash, genConfigHash,
        generationConfig: GENERATION_CONFIG, imageHash,
        resize, resized, bytes: buf.length, mimeType: mime,
        schemaModule: path.relative(ROOT, schemaModulePath),
        temperature: temperature ?? null,
        ranAt: new Date().toISOString(),
      },
      latencyMs: res.latencyMs, totalMs: res.totalMs, attempts: res.attempts,
      usage: res.usage, finishReason: res.finishReason, promptFeedback: res.promptFeedback,
      parseError: res.parseError || null,
      rawText: res.rawText,
      output: res.json,
    };
    process.stdout.write(`  ok     ${file}${repeat > 1 ? ` #${r}` : ''}  ${res.latencyMs}ms  attempts=${res.attempts}\n`);
  } catch (e) {
    failed++;
    rec = {
      meta: { file, repeatIndex: r, model: MODEL, promptHash, schemaHash, imageHash, resize, bytes: buf.length, ranAt: new Date().toISOString() },
      error: redact(e.message, apiKey),
      output: null,
    };
    process.stdout.write(`  FAIL   ${file}${repeat > 1 ? ` #${r}` : ''}  ${rec.error.slice(0, 120)}\n`);

    // 실패 기록으로 **성공한 기존 응답을 덮어쓰지 않는다.**
    // 쿼터 소진 상태에서 재실행하면 멀쩡한 캐시가 전부 error 로 날아간다.
    // (프롬프트/스키마가 바뀌어 캐시가 무효가 된 경우에도, 옛 응답을 지우는 것보다 남기는 편이 낫다.)
    if (fs.existsSync(p)) {
      try {
        const prev = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (prev && !prev.error && prev.output !== null && prev.output !== undefined) {
          process.stdout.write(`         └ 기존 성공 응답 보존 (덮어쓰지 않음)\n`);
          return prev;
        }
      } catch { /* 파싱 불가면 그냥 덮어쓴다 */ }
    }
  }
  fs.writeFileSync(p, JSON.stringify(rec, null, 2));
  return rec;
});

if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });

const ok = results.filter((r) => r.ok && r.value && !r.value.error).map((r) => r.value);
const lat = ok.filter((r) => typeof r.latencyMs === 'number').map((r) => r.latencyMs);
const tokIn = ok.reduce((s, r) => s + (r.usage?.promptTokenCount || 0), 0);
const tokOut = ok.reduce((s, r) => s + (r.usage?.candidatesTokenCount || 0), 0);
const tokThink = ok.reduce((s, r) => s + (r.usage?.thoughtsTokenCount || 0), 0);

const summary = {
  ranAt: new Date().toISOString(),
  model: MODEL, promptHash, schemaHash, genConfigHash, generationConfig: GENERATION_CONFIG, resize, repeat, concurrency,
  schemaModule: path.relative(ROOT, schemaModulePath),
  nJobs: jobs.length, nCacheHits: cached, nApiCalls: called, nFailed: failed,
  wallMs: Date.now() - startedAt,
  latency: lat.length ? {
    n: lat.length,
    meanMs: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length),
    p50Ms: lat.slice().sort((a, b) => a - b)[Math.floor(lat.length * 0.5)],
    p95Ms: lat.slice().sort((a, b) => a - b)[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))],
    minMs: Math.min(...lat), maxMs: Math.max(...lat),
  } : null,
  tokens: ok.length ? {
    promptTotal: tokIn, candidatesTotal: tokOut, thoughtsTotal: tokThink,
    promptPerImage: tokIn / ok.length, candidatesPerImage: tokOut / ok.length, thoughtsPerImage: tokThink / ok.length,
  } : null,
};
// run-summary 도 모델별로 분리한다. 예전에는 out/run-summary.json 하나를 공유해서,
// 실패한 비교 실행이 이전 모델의 요약을 덮어쓰고 리포트가 잘못된 모델 라벨을 달았다.
const summaryPath = path.join(OUT, `run-summary-${modelDirName(MODEL)}.json`);
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(RAW, '_run-summary.json'), JSON.stringify(summary, null, 2));

console.log(`\n완료: 캐시 ${cached} · 호출 ${called} · 실패 ${failed} · ${Math.round(summary.wallMs / 1000)}s`);
if (summary.latency) console.log(`지연 평균 ${summary.latency.meanMs}ms · p95 ${summary.latency.p95Ms}ms`);
if (summary.tokens) console.log(`토큰 이미지당 입력 ${summary.tokens.promptPerImage.toFixed(0)} / 출력 ${summary.tokens.candidatesPerImage.toFixed(0)} / thinking ${summary.tokens.thoughtsPerImage.toFixed(0)}`);
console.log(`원 응답: ${path.relative(ROOT, RAW)}/  ·  요약: ${path.relative(ROOT, summaryPath)}`);
console.log(`다음: node eval/score.mjs`);
if (failed) process.exit(2);
