#!/usr/bin/env node
/**
 * tools/photo_ocr.mjs — 내가 찍은 티켓/앙코르 사진 OCR.
 *
 * 티켓은 app/services/ocrSchema.ts 의 프롬프트/스키마/후처리를 **그대로** 쓴다.
 * 앙코르 보드는 형식이 달라서 전용 프롬프트/스키마를 여기서 정의한다.
 *
 * 호출은 캐시된다(work/meta/ocr_cache). 이미 있으면 API를 다시 때리지 않는다.
 *   node tools/photo_ocr.mjs            # 캐시에 없는 것만 호출
 *   node tools/photo_ocr.mjs --dry-run  # 호출 대상만 출력
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const { getGeminiKey, KeyError } = await import(path.join(ROOT, 'eval/lib/env.mjs'));
const { generateOcr, GeminiError } = await import(path.join(ROOT, 'eval/lib/gemini.mjs'));
const { loadOcrSchema, defaultSchemaPath } = await import(path.join(ROOT, 'eval/lib/loadSchema.mjs'));

const { mod } = await loadOcrSchema(defaultSchemaPath(ROOT));
const { OCR_MODEL, OCR_PROMPT, OCR_RESPONSE_SCHEMA, OCR_GENERATION_CONFIG, postProcessOCR } = mod;

const DRY = process.argv.includes('--dry-run');
const CACHE = path.join(ROOT, 'work/meta/ocr_cache');
fs.mkdirSync(CACHE, { recursive: true });

/* ---------------- 앙코르 보드 전용 프롬프트 ---------------- */
// 손글씨다. 티켓처럼 인쇄된 글자가 아니라서 확신도를 훨씬 보수적으로 잡게 지시한다.
const ENCORE_PROMPT = `이 사진에는 공연장 로비의 「오늘의 앙코르」 안내판(손글씨 화이트보드)이 찍혀 있습니다.
손글씨로 적힌 앙코르 곡 목록을 읽어 주세요.

# 절대 규칙
1. **손글씨입니다. 확실하지 않으면 읽지 마세요.** 한 글자라도 애매하면 그 항목의 confidence를 0.5 미만으로 두세요.
2. **절대 추측하거나 보완하지 마세요.** "이 작곡가면 보통 이 곡이겠지" 같은 추론 금지.
   앙코르 곡목은 다른 어떤 자료에도 남아있지 않아서 틀려도 아무도 검증할 수 없습니다.
3. 글씨가 뭉개져서 못 읽으면 그 항목을 아예 빼거나, raw만 채우고 composer/title은 ""로 두세요.
4. 보드 전체가 읽히지 않으면 encores를 빈 배열로 두세요.
5. raw 에는 **화이트보드에 적힌 그 줄 전체를 본 그대로** 옮기세요(작곡가-곡명 구분 없이).

# 필드
- concertHint : 보드나 뒤 포스터에 보이는 공연명/날짜/장소 등 이 앙코르가 어느 공연 것인지 알려주는 문자열. 본 그대로.
- encores[]   : 앙코르 곡 목록. 보드에 적힌 순서대로.
    - composer : 작곡가. 못 읽으면 ""
    - title    : 곡명. 못 읽으면 ""
    - raw      : 그 줄에 적힌 원문 전체
    - confidence : 0.0~1.0. 손글씨 판독 확신도. 또렷한 인쇄체 손글씨 0.8 / 흘려 쓴 글씨 0.3~0.6 / 추정 0.2 이하

JSON만 출력하세요.`;

const ENCORE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    concertHint: { type: 'STRING' },
    concertHintConfidence: { type: 'NUMBER' },
    encores: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          composer: { type: 'STRING' },
          title: { type: 'STRING' },
          raw: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['composer', 'title', 'raw', 'confidence'],
      },
    },
  },
  required: ['concertHint', 'concertHintConfidence', 'encores'],
};

/* ---------------- 대상 ---------------- */
const L = 'work/myphotos/fixed';
const S = 'work/myphotos/sac_fixed';
const TARGETS = [
  // 티켓
  { id: 'lotte_2025-07-22_t', kind: 'ticket', file: `${L}/IMG_1598.jpg`, capturedOn: '2025-07-22' },
  { id: 'lotte_2025-08-05_t', kind: 'ticket', file: `${L}/IMG_2354.jpg`, capturedOn: '2025-08-05' },
  { id: 'lotte_2025-11-19_t', kind: 'ticket', file: `${L}/IMG_5213.jpg`, capturedOn: '2025-11-19' },
  { id: 'sac_2025-07-04_t',   kind: 'ticket', file: `${S}/IMG_7968.jpg`, capturedOn: '2025-07-04' },
  { id: 'sac_2026-04-01_t',   kind: 'ticket', file: `${S}/IMG_9741.jpg`, capturedOn: '2026-04-01' },
  // 앙코르 보드
  { id: 'sac_2026-03-25_e', kind: 'encore', file: `${S}/IMG_9618.jpg`, capturedOn: '2026-03-25' },
  { id: 'sac_2026-03-26_e', kind: 'encore', file: `${S}/IMG_9633.jpg`, capturedOn: '2026-03-26' },
  // 이 날짜는 시야 사진이 없어서 우선순위가 가장 낮다
  { id: 'sac_2026-03-26_t',   kind: 'ticket', file: `${S}/IMG_9624.jpg`, capturedOn: '2026-03-26' },
];

/* ---------------- 이미지 준비: 장변 1568px 로 축소 ---------------- */
function resized(abs) {
  const tmp = path.join(CACHE, '_rs_' + path.basename(abs));
  if (!fs.existsSync(tmp)) {
    fs.copyFileSync(abs, tmp);
    execFileSync('sips', ['-Z', '1568', tmp], { stdio: 'ignore' });
  }
  return tmp;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

let key;
try { ({ key } = getGeminiKey(ROOT)); }
catch (e) { if (e instanceof KeyError) { console.error(e.message); process.exit(1); } throw e; }


/* ---------------- Gemini 호출 (앱과 동일한 generationConfig) ----------------
 * eval/lib/gemini.mjs 는 temperature 만 전달하고 thinkingConfig 를 버려서
 * thinking 이 최대로 돌아 호출당 70초가 넘는다. eval/ 은 수정 금지이므로
 * 같은 REST 모양을 여기서 쓰되 OCR_GENERATION_CONFIG 를 통째로 펼친다.
 * 무료 티어는 20 RPM 이라 429 는 '분당 한도'이고 재시도가 정상 동작이다.
 * 하루 한도로 인한 429 는 retryDelay 가 길게(>5분) 오므로 그때는 즉시 중단한다. */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
class Quota extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini({ prompt, schema, imageBase64, maxRetries = 10 }) {
  const body = {
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
      { text: prompt },
    ] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      ...OCR_GENERATION_CONFIG,
    },
  };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/models/${encodeURIComponent(OCR_MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      const cand = data.candidates && data.candidates[0];
      const rawText = (cand?.content?.parts || []).map((p) => p.text || '').join('');
      let json = null;
      try { json = rawText ? JSON.parse(rawText) : null; } catch { /* 아래에서 rawText 로 남는다 */ }
      return { json, rawText, usage: data.usageMetadata || null,
               finishReason: cand?.finishReason ?? null, latencyMs: Date.now() - t0 };
    }
    const text = (await res.text().catch(() => '')).slice(0, 900);
    if (res.status === 429) {
      const m = text.match(/retry in ([\d.]+)s/i);
      const waitS = m ? Number(m[1]) : 60;
      if (waitS > 300 || attempt === maxRetries) throw new Quota(`429 (retry in ${waitS}s)\n${text}`);
      // 여러 에이전트가 같은 키를 쓰고 있어서 retry-after 만큼만 기다리면
      // 창이 열리는 순간에 다 같이 몰려 또 429 가 난다. 무작위 지터를 크게 준다.
      const waitMs = (Math.ceil(waitS) + 2) * 1000 + Math.random() * 30000;
      console.error(`  429 분당 한도 — ${Math.round(waitMs / 1000)}s 대기 후 재시도`);
      await sleep(waitMs);
      continue;
    }
    if (res.status >= 500 && attempt < maxRetries) {
      console.error(`  HTTP ${res.status} 일시 오류 — 재시도`);
      await sleep(15000);
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  throw new Error('재시도 소진');
}

let calls = 0, cached = 0;
const results = [];

for (const t of TARGETS) {
  const abs = path.join(ROOT, t.file);
  if (!fs.existsSync(abs)) { console.error(`없음: ${t.file}`); continue; }
  const prompt = t.kind === 'ticket' ? OCR_PROMPT : ENCORE_PROMPT;
  const schema = t.kind === 'ticket' ? OCR_RESPONSE_SCHEMA : ENCORE_SCHEMA;
  const cachePath = path.join(CACHE, `${t.id}.${sha(prompt + JSON.stringify(schema) + OCR_MODEL)}.json`);

  if (fs.existsSync(cachePath)) {
    results.push({ ...t, ...JSON.parse(fs.readFileSync(cachePath, 'utf8')) });
    cached++; continue;
  }
  if (DRY) { console.log(`[dry] 호출 예정: ${t.id}  ${t.kind}  ${t.file}`); continue; }

  const b64 = fs.readFileSync(resized(abs)).toString('base64');
  let out;
  try {
    out = await callGemini({ prompt, schema, imageBase64: b64 });
  } catch (e) {
    if (e instanceof Quota) {
      console.error(`\n[중단] 쿼터 소진 — ${calls}회 호출 후 멈춥니다. 캐시는 보존됩니다.`);
      console.error(e.message.slice(0, 600));
      break;
    }
    console.error(`FAIL ${t.id}: ${e.message}`);
    continue;
  }
  calls++;
  const rec = { model: OCR_MODEL, json: out.json, rawText: out.rawText, usage: out.usage, finishReason: out.finishReason };
  fs.writeFileSync(cachePath, JSON.stringify(rec, null, 1));
  results.push({ ...t, ...rec });
  console.error(`ok ${t.id} (${out.latencyMs}ms)`);
  await sleep(4000); // 20 RPM 여유
}

/* ---------------- 출력 ---------------- */
const summary = results.map((r) => {
  if (r.kind === 'ticket') {
    const p = postProcessOCR(r.json ?? {});
    return { id: r.id, kind: r.kind, file: r.file, capturedOn: r.capturedOn, ocr: p, raw: r.json };
  }
  return { id: r.id, kind: r.kind, file: r.file, capturedOn: r.capturedOn, encore: r.json };
});
fs.writeFileSync(path.join(ROOT, 'work/meta/ocr_results.json'), JSON.stringify(summary, null, 1));
console.error(`\nAPI 호출 ${calls}회 / 캐시 ${cached}건 → work/meta/ocr_results.json`);
