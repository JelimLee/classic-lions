#!/usr/bin/env node
// eval/score.mjs — eval/out/raw/*.json 을 정답지와 대조해 채점하고 eval/out/scores.json 을 쓴다.
// 그리고 eval/out/report.md 를 생성한다(--no-report 로 끌 수 있음).
//
//   node eval/score.mjs
//   node eval/score.mjs --fixtures      ← 채점 로직 self-test (API 키 불필요)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import crypto from 'node:crypto';
import { parseArgs, num } from './lib/cli.mjs';
import { loadOcrSchema, SchemaModuleError, defaultSchemaPath } from './lib/loadSchema.mjs';
import { truthPath, loadTruth, TruthError } from './lib/truth.mjs';
import { scoreItem, aggregate, nondeterminism, DEFAULT_OPTS } from './lib/scoring.mjs';
import { renderReport } from './report.mjs';
import { makeScopeFilter, parseScope, DEFAULT_OUT_OF_SCOPE_PREFIXES } from './lib/scope.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = parseArgs(process.argv.slice(2), { booleans: ['fixtures', 'no-report', 'help', 'json'] });

if (args.help) {
  console.log(`eval/score.mjs — 채점기

옵션:
  --scope in|out|all    헤드라인 지표의 범위. in = 롯데+예당(기본), out = 범위 외만, all = 전부
                        범위 외 접두사: ${DEFAULT_OUT_OF_SCOPE_PREFIXES.join(', ')}
                        범위 외 이미지는 --scope in 에서도 '참고' 섹션에 따로 집계된다
  --model <id>          채점할 모델 지정. 원 응답에 여러 모델이 섞여 있으면 필수
                        (모델 라벨은 항상 raw 의 meta.model 에서 가져온다)
  --fixtures            eval/fixtures/ 의 목 데이터로 채점 로직 self-test (API 키·이미지 불필요)
  --truth <path>        정답지 경로 override
  --raw-dir <path>      원 응답 디렉터리 override (모델 비교 시 eval/out/raw-<suffix>)
  --schema-module <p>   ocrSchema 모듈 경로 override
  --low-conf N          "저신뢰 기권" 판정 임계값 (기본 ${DEFAULT_OPTS.lowConfThreshold})
  --out <dir>           출력 디렉터리 (기본 eval/out)
  --no-report           report.md 를 만들지 않음
  --json                요약을 JSON 으로 stdout 출력
`);
  process.exit(0);
}

const FIX = args.fixtures === true;
const schemaModulePath = args['schema-module'] ? path.resolve(args['schema-module'])
  : FIX ? path.join(HERE, 'fixtures', 'mockOcrSchema.ts')
  : defaultSchemaPath(ROOT);
const truthFile = args.truth ? path.resolve(args.truth)
  : FIX ? path.join(HERE, 'fixtures', 'ground_truth.json')
  : truthPath(ROOT);
const rawDir = args['raw-dir'] ? path.resolve(args['raw-dir'])
  : FIX ? path.join(HERE, 'fixtures', 'raw')
  : path.join(HERE, 'out', 'raw');
const outDir = args.out ? path.resolve(args.out) : path.join(HERE, 'out');

function die(msg, code = 1) { console.error(`\n${msg}\n`); process.exit(code); }

// ---------- 모듈 / 정답지 ----------
let mod;
try { ({ mod } = await loadOcrSchema(schemaModulePath)); }
catch (e) { if (e instanceof SchemaModuleError) die(`[중단] ${e.message}`); throw e; }

let truth, truthProblems;
try { const t = loadTruth(truthFile); truth = t.data; truthProblems = t.problems; }
catch (e) { if (e instanceof TruthError) die(`[중단] ${e.message}`); throw e; }
if (truthProblems.length) console.warn(`[경고] 정답지 검증 문제 ${truthProblems.length}건:\n  ` + truthProblems.join('\n  '));

// ---------- 원 응답 수집 ----------
if (!fs.existsSync(rawDir)) die(`[중단] 원 응답 디렉터리가 없습니다: ${rawDir}\n먼저 실행하세요: node eval/run.mjs`);

// ---------------------------------------------------------------------------
// 원 응답 색인.
//
// **모델 라벨의 진실의 원천은 raw 응답에 기록된 meta.model 이다.** CLI 인자나
// run-summary 가 아니다. 예전에는 out/run-summary.json 하나를 모든 모델이 공유해서,
// 실패한 비교 실행이 그 파일을 덮어쓰면 리포트가 이전 모델의 숫자에 새 모델 이름을
// 달고 나왔다. 어느 모델의 숫자인지 틀리게 적힌 리포트는 없느니만 못하다.
// ---------------------------------------------------------------------------
function collectRawFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectRawFiles(full));
    else if (e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

/** @type {Map<string, Map<string, Array<{run:number, record:object, path:string}>>>} model → file → runs */
const byModel = new Map();
const unlabeled = [];
for (const full of collectRawFiles(rawDir)) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (e) { console.warn(`[경고] ${full} 파싱 실패: ${e.message}`); continue; }
  const model = rec?.meta?.model;
  if (!model) { unlabeled.push(full); continue; }
  const base = path.basename(full);
  const m = base.match(/^(.*)\.r(\d+)\.json$/);
  const file = m ? m[1] : base.replace(/\.json$/, '');
  const run = m ? Number(m[2]) : 1;
  if (!byModel.has(model)) byModel.set(model, new Map());
  const fm = byModel.get(model);
  if (!fm.has(file)) fm.set(file, []);
  fm.get(file).push({ run, record: rec, path: full });
}
if (unlabeled.length) console.warn(`[경고] meta.model 이 없어 무시한 raw ${unlabeled.length}개: ${unlabeled.slice(0, 3).map((f) => path.basename(f)).join(', ')}`);

// 모델별 실제 건수 (성공/실패 분리) — 리포트에 그대로 싣는다.
const modelCounts = [...byModel.entries()].map(([model, fm]) => {
  const recs = [...fm.values()].flat();
  return { model, nFiles: fm.size, nRecords: recs.length, nOk: recs.filter((r) => !r.record.error).length, nError: recs.filter((r) => r.record.error).length };
}).sort((a, b) => b.nOk - a.nOk);

const requestedModel = args.model ? String(args.model) : null;
if (requestedModel && !byModel.has(requestedModel)) {
  die(`[중단] --model ${requestedModel} 의 원 응답이 ${path.relative(ROOT, rawDir)} 에 없습니다.\n` +
      `있는 모델:\n` + modelCounts.map((c) => `  - ${c.model} (성공 ${c.nOk} / 실패 ${c.nError})`).join('\n'));
}
if (!byModel.size) die(`[중단] 채점할 원 응답이 없습니다: ${path.relative(ROOT, rawDir)}\n먼저 실행하세요: node eval/run.mjs`);

// 여러 모델이 섞여 있으면 조용히 합치지 않는다 — 어느 모델의 숫자인지 모호해지기 때문.
const modelsWithData = modelCounts.filter((c) => c.nOk > 0);
if (!requestedModel && modelsWithData.length > 1) {
  die(`[중단] 원 응답에 모델이 ${modelsWithData.length}개 섞여 있습니다. 어느 것을 채점할지 지정하세요.\n` +
      modelsWithData.map((c) => `  --model ${c.model}   (성공 ${c.nOk}건 / 실패 ${c.nError}건)`).join('\n') +
      `\n\n서로 다른 모델의 결과를 하나의 정확도로 합치면 그 수치는 아무 모델도 대표하지 못합니다.`);
}
const activeModel = requestedModel || (modelsWithData[0] || modelCounts[0]).model;
const activeFiles = byModel.get(activeModel);

function runsFor(file) {
  const runs = (activeFiles.get(file) || []).slice().sort((a, b) => a.run - b.run);
  return runs.map((r) => ({ run: r.run, name: path.basename(r.path), record: r.record }));
}

const opts = { lowConfThreshold: num(args['low-conf'], DEFAULT_OPTS.lowConfThreshold) };
// 픽스처는 범위 개념이 없다(목 파일명이라 접두사가 안 맞음) → all.
const scopeFilter = makeScopeFilter({ scope: FIX ? 'all' : parseScope(args.scope ?? 'in') });

const itemScores = [];       // 헤드라인 지표용 (scope 통과분)
const outOfScopeScores = [];  // 참고: 범위 외
const perFileRuns = new Map();
const missing = [];
const errored = [];

for (const item of truth.items) {
  const runs = runsFor(item.file);
  if (!runs.length) { missing.push(item.file); continue; }
  const scoredRuns = [];
  for (const r of runs) {
    if (r.record.error) { errored.push({ file: item.file, run: r.run, error: r.record.error }); continue; }
    const s = scoreItem({ truthItem: item, pred: r.record.output || {}, mod, opts });
    s.run = r.run;
    s.latencyMs = r.record.latencyMs ?? null;
    s.usage = r.record.usage ?? null;
    s.parseError = r.record.parseError ?? null;
    s.promptHash = r.record.meta?.promptHash ?? null;
    s.schemaHash = r.record.meta?.schemaHash ?? null;
    scoredRuns.push(s);
  }
  if (!scoredRuns.length) continue;
  scoredRuns[0].scope = scopeFilter.label(item.file);
  if (scopeFilter.accepts(item.file)) {
    itemScores.push(scoredRuns[0]);          // 대표 = 첫 회차
    perFileRuns.set(item.file, scoredRuns);  // 비결정성 = 전 회차
  } else {
    outOfScopeScores.push(scoredRuns[0]);
  }
}

if (!itemScores.length) {
  die(`[중단] 채점할 결과가 없습니다.\n  정답지 항목 ${truth.items.length}건 / ${activeModel} 원 응답 ${activeFiles.size}개 (${path.relative(ROOT, rawDir)})\n` +
      (missing.length ? `  원 응답이 없는 항목: ${missing.slice(0, 10).join(', ')}\n` : '') +
      `  먼저 실행하세요: node eval/run.mjs`);
}

const agg = aggregate(itemScores);
const nd = nondeterminism(perFileRuns);
const aggOut = outOfScopeScores.length ? aggregate(outOfScopeScores) : null;

// run-summary 는 참고용일 뿐이며, 모델 라벨의 근거로는 절대 쓰지 않는다.
// 활성 모델의 요약만 읽고, 모델이 다르면 버린다.
let runSummary = null;
if (!FIX) {
  const cand = [
    path.join(rawDir, String(activeModel).replace(/[^A-Za-z0-9._-]/g, '_'), '_run-summary.json'),
    path.join(outDir, `run-summary-${String(activeModel).replace(/[^A-Za-z0-9._-]/g, '_')}.json`),
  ];
  for (const rs of cand) {
    if (!fs.existsSync(rs)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(rs, 'utf8'));
      if (j.model === activeModel) { runSummary = j; break; }
      console.warn(`[경고] ${path.relative(ROOT, rs)} 의 모델(${j.model})이 채점 대상(${activeModel})과 달라 무시합니다.`);
    } catch {}
  }
}

// 지연/토큰은 채점 대상 회차에서 직접 재집계 (픽스처에서도 동작)
const lats = itemScores.map((i) => i.latencyMs).filter((x) => typeof x === 'number');
const toks = itemScores.map((i) => i.usage).filter(Boolean);
const perf = {
  nWithLatency: lats.length,
  meanLatencyMs: lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null,
  p95LatencyMs: lats.length ? lats.slice().sort((a, b) => a - b)[Math.min(lats.length - 1, Math.floor(lats.length * 0.95))] : null,
  meanPromptTokens: toks.length ? toks.reduce((s, u) => s + (u.promptTokenCount || 0), 0) / toks.length : null,
  meanCandidateTokens: toks.length ? toks.reduce((s, u) => s + (u.candidatesTokenCount || 0), 0) / toks.length : null,
  // thinking 모델은 thoughtsTokenCount 가 별도로 과금된다. 빠뜨리면 비용을 과소추정한다.
  meanThoughtTokens: toks.length ? toks.reduce((s, u) => s + (u.thoughtsTokenCount || 0), 0) / toks.length : null,
  meanTotalTokens: toks.length ? toks.reduce((s, u) => s + (u.totalTokenCount || 0), 0) / toks.length : null,
};

// 프롬프트/스키마 출처 검증: 채점 중인 raw 가 '현재' 모듈로 만들어진 것인가.
// 모델 라벨과 같은 이유로 이것도 데이터에서 도출한다 — 옛 프롬프트의 응답에
// 새 프롬프트 성능이라는 라벨이 붙으면 모델 라벨 오류와 똑같이 잘못된 결론을 낳는다.
const sha16 = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);
const currentPromptHash = sha16(String(mod.OCR_PROMPT ?? ''));
const currentSchemaHash = sha16(JSON.stringify(mod.OCR_RESPONSE_SCHEMA ?? null));
const rawPromptHashes = [...new Set(itemScores.map((i) => i.promptHash).filter(Boolean))];
const rawSchemaHashes = [...new Set(itemScores.map((i) => i.schemaHash).filter(Boolean))];
const provenance = {
  currentPromptHash, currentSchemaHash, rawPromptHashes, rawSchemaHashes,
  promptStale: rawPromptHashes.length > 0 && !rawPromptHashes.every((h) => h === currentPromptHash),
  schemaStale: rawSchemaHashes.length > 0 && !rawSchemaHashes.every((h) => h === currentSchemaHash),
  mixedPrompt: rawPromptHashes.length > 1,
  mixedSchema: rawSchemaHashes.length > 1,
};
if (!FIX && (provenance.promptStale || provenance.schemaStale)) {
  console.warn(`[경고] 채점 중인 원 응답이 현재 ocrSchema.ts 와 다른 버전으로 생성되었습니다.` +
    (provenance.promptStale ? `\n        prompt: raw ${rawPromptHashes.join(',')} vs 현재 ${currentPromptHash}` : '') +
    (provenance.schemaStale ? `\n        schema: raw ${rawSchemaHashes.join(',')} vs 현재 ${currentSchemaHash}` : '') +
    `\n        → 쿼터 회복 후 node eval/run.mjs 로 재수집하면 캐시가 자동 무효화되어 갱신됩니다.`);
}

const payload = {
  scoredAt: new Date().toISOString(),
  provenance,
  mode: FIX ? 'fixtures' : 'real',
  schemaModule: path.relative(ROOT, schemaModulePath),
  truthFile: path.relative(ROOT, truthFile),
  rawDir: path.relative(ROOT, rawDir),
  model: activeModel,                    // ← raw 응답의 meta.model 에서 옴 (CLI/summary 아님)
  modelSource: 'raw meta.model',
  modelCounts,                            // 모델별 raw 건수 — 섞였으면 리포트에 드러난다
  schemaDefaultModel: mod.OCR_MODEL,
  opts,
  scope: { mode: scopeFilter.scope, outOfScopePrefixes: scopeFilter.prefixes, nInScope: itemScores.length, nOutOfScope: outOfScopeScores.length },
  outOfScope: aggOut ? { aggregate: aggOut, items: outOfScopeScores } : null,
  missingRaw: missing,
  erroredRuns: errored,
  aggregate: agg,
  nondeterminism: nd,
  perf,
  runSummary,
  items: itemScores,
};

// 단가표(있으면). 값이 null 이면 리포트가 비용을 '미산출'로 쓴다.
const pricingPath = path.join(HERE, 'pricing.json');
if (fs.existsSync(pricingPath)) {
  try {
    const table = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
    payload.pricing = table.models?.[payload.model] || table.models?.default || null;
  } catch (e) { console.warn(`[경고] pricing.json 파싱 실패: ${e.message}`); }
}

fs.mkdirSync(outDir, { recursive: true });
const scoresPath = path.join(outDir, FIX ? 'fixture-scores.json' : 'scores.json');
fs.writeFileSync(scoresPath, JSON.stringify(payload, null, 2));

// ---------- self-test ----------
if (FIX) {
  const exp = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'expected.json'), 'utf8'));
  const fails = [];
  let checks = 0;
  const find = (file, field) => {
    const it = itemScores.find((i) => i.file === file);
    return it ? it.fields.find((f) => f.field === field) : null;
  };
  const close = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;

  for (const e of exp.fields) {
    const f = find(e.file, e.field);
    if (!f) { fails.push(`${e.file} / ${e.field}: 채점 결과에 필드가 없음`); continue; }
    for (const [k, v] of Object.entries(e)) {
      if (['file', 'field'].includes(k) || k.startsWith('_')) continue;
      checks++;
      if (k === 'similarityAtLeast') { if (!(f.similarity >= v)) fails.push(`${e.file}/${e.field}: similarity ${f.similarity} < ${v}`); continue; }
      if (k === 'similarityAtMost') { if (!(f.similarity <= v)) fails.push(`${e.file}/${e.field}: similarity ${f.similarity} > ${v}`); continue; }
      const got = f[k];
      const ok = typeof v === 'number' ? close(got, v) : JSON.stringify(got) === JSON.stringify(v);
      if (!ok) fails.push(`${e.file}/${e.field}.${k}: 기대 ${JSON.stringify(v)} → 실제 ${JSON.stringify(got)}`);
    }
  }
  const a = exp.aggregate || {};
  if (a.nItems !== undefined) { checks++; if (agg.nItems !== a.nItems) fails.push(`aggregate.nItems: 기대 ${a.nItems} → 실제 ${agg.nItems}`); }
  for (const [k, v] of Object.entries(a.hallucination || {})) {
    checks++;
    const got = agg.hallucination[k];
    const ok = typeof v === 'number' ? Math.abs(got - v) < 1e-9 : got === v;
    if (!ok) fails.push(`hallucination.${k}: 기대 ${v} → 실제 ${got}`);
  }
  const ndExp = (exp.nondeterminism || {}).unstableFieldsFor || {};
  for (const [file, expected] of Object.entries(ndExp)) {
    checks++;
    const rec = nd.items.find((i) => i.file === file);
    const got = rec ? rec.unstable.map((u) => u.field).sort() : [];
    if (JSON.stringify(got) !== JSON.stringify([...expected].sort())) {
      fails.push(`nondeterminism[${file}]: 기대 ${JSON.stringify(expected)} → 실제 ${JSON.stringify(got)}`);
    }
  }

  console.log(`\n채점기 self-test — 단언 ${checks}건`);
  if (fails.length) {
    console.log(`\n❌ 실패 ${fails.length}건:`);
    for (const f of fails) console.log('  - ' + f);
    console.log(`\n결과 상세: ${path.relative(ROOT, scoresPath)}`);
    process.exit(1);
  }
  console.log(`✅ 전부 통과 (${itemScores.length}개 목 이미지, 필드 ${itemScores.reduce((s, i) => s + i.fields.length, 0)}개)`);
  console.log(`   할루시네이션 ${agg.hallucination.nHallucinated}/${agg.hallucination.nNullFields} = ${(agg.hallucination.rate * 100).toFixed(1)}%`);
  console.log(`   비결정성 flip rate ${(nd.overallFlipRate * 100).toFixed(1)}%`);
}

// ---------- 리포트 ----------
if (!args['no-report']) {
  const md = renderReport(payload);
  const reportPath = path.join(outDir, FIX ? 'fixture-report.md' : 'report.md');
  fs.writeFileSync(reportPath, md);
  console.log(`\n리포트: ${path.relative(ROOT, reportPath)}`);
}
console.log(`점수 원본: ${path.relative(ROOT, scoresPath)}`);

if (args.json) console.log(JSON.stringify({ overall: agg.overall, hallucination: agg.hallucination, perf }, null, 2));

if (!FIX) {
  const a = agg.overall.accuracy, h = agg.hallucination.rate;
  console.log(`\n모델 ${activeModel} (raw ${modelCounts.find((c) => c.model === activeModel).nOk}건 기준)`);
  console.log(`[범위 ${scopeFilter.scope}] 전체 필드 정확도 ${(a * 100).toFixed(1)}% · 할루시네이션 ${h === null ? 'N/A' : (h * 100).toFixed(1) + '%'} · 이미지 ${agg.nItems}건`);
  if (outOfScopeScores.length) console.log(`(참고: 범위 외 ${outOfScopeScores.length}건은 별도 집계 — 정확도 ${(aggOut.overall.accuracy * 100).toFixed(1)}%)`);
  if (missing.length) console.log(`(원 응답 없는 항목 ${missing.length}건은 제외됨)`);
}
