#!/usr/bin/env node
// eval/report.mjs — scores.json → 한국어 마크다운 리포트.
// 단독 실행도 가능: node eval/report.mjs [--in eval/out/scores.json] [--out eval/out/report.md]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/cli.mjs';

const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`);
const n3 = (x) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toFixed(3));
const int = (x) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Math.round(x).toLocaleString('ko-KR'));
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
function short(v, max = 60) {
  if (v === null || v === undefined) return '∅';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (!s.length) return '(빈 문자열)';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

const FIELD_RULE = {
  title: '정규화 후 exact + Levenshtein 유사도',
  artist: '정규화 후 exact + Levenshtein 유사도',
  venue: '정규화 후 exact + Levenshtein 유사도',
  date: 'normalizeDate() 통과 후 정확일치 (YYYY-MM-DD, zero-pad)',
  seat_raw: '문자열 유사도 (정규화 후 exact 는 별도)',
  'seat.floor': 'parseSeat() 결과 정확일치',
  'seat.block': 'parseSeat() 결과 정확일치',
  'seat.row': 'parseSeat() 결과 정확일치',
  'seat.number': 'parseSeat() 결과 정확일치',
  'seat.grade': 'parseSeat() 결과 정확일치',
  seat: 'parseSeat() 기권 여부 (정답 null)',
  price: '숫자 정확일치',
  program: '집합 비교 precision/recall/F1',
};

export function renderReport(p) {
  const a = p.aggregate;
  const L = [];
  const isFix = p.mode === 'fixtures';

  L.push(`# OCR 정확도 평가 리포트`);
  L.push('');
  if (isFix) {
    L.push(`> ⚠️ **이 리포트는 픽스처(목 데이터) 기준입니다.** 실제 모델 성능이 아니라 *채점 로직이 맞게 도는지* 검증한 결과입니다.`);
    L.push('');
  }
  L.push(`- 생성 시각: ${p.scoredAt}`);
  L.push(`- 모드: **${isFix ? '픽스처 self-test' : '실측'}**`);
  L.push(`- 모델: **\`${p.model ?? '—'}\`**${p.modelSource ? ` (출처: ${p.modelSource} — 원 응답에 기록된 값)` : ''}`);
  if (p.schemaDefaultModel && p.model && p.schemaDefaultModel !== p.model) {
    L.push(`  - ⚠️ \`ocrSchema.OCR_MODEL\` 기본값은 \`${p.schemaDefaultModel}\` 인데 이 리포트는 \`${p.model}\` 응답을 채점했다.`);
  }
  if (p.modelCounts && p.modelCounts.length) {
    const withData = p.modelCounts.filter((c) => c.nOk > 0);
    L.push(`- 원 응답 건수(모델별): ${p.modelCounts.map((c) => `\`${c.model}\` 성공 ${c.nOk}·실패 ${c.nError}`).join(' / ')}`);
    if (withData.length > 1) {
      L.push('');
      L.push(`> 🔴 **원 응답 디렉터리에 모델이 ${withData.length}개 있다.** 이 리포트는 \`${p.model}\` 것만 채점했다.`);
      L.push(`> 다른 모델 수치는 \`--model <id>\` 로 따로 채점해야 한다. 섞어서 보면 어느 모델도 대표하지 못한다.`);
    }
  }
  L.push(`- 스키마 모듈: \`${p.schemaModule}\` (프롬프트·스키마·parseSeat·normalizeDate 를 여기서 그대로 가져옴)`);
  const pv = p.provenance;
  if (pv) {
    L.push(`- 프롬프트/스키마 해시: 원 응답 \`${pv.rawPromptHashes.join(',') || '—'}\` / \`${pv.rawSchemaHashes.join(',') || '—'}\` · 현재 모듈 \`${pv.currentPromptHash}\` / \`${pv.currentSchemaHash}\``);
    if (pv.promptStale || pv.schemaStale) {
      L.push('');
      L.push(`> 🔴 **이 수치는 현재 \`ocrSchema.ts\` 가 아니라 이전 버전으로 만들어진 응답을 채점한 것이다.**`);
      if (pv.promptStale) L.push(`> - 프롬프트가 바뀌었다 (raw \`${pv.rawPromptHashes.join(',')}\` → 현재 \`${pv.currentPromptHash}\`)`);
      if (pv.schemaStale) L.push(`> - 응답 스키마가 바뀌었다 (raw \`${pv.rawSchemaHashes.join(',')}\` → 현재 \`${pv.currentSchemaHash}\`)`);
      L.push(`> 쿼터 회복 후 \`node eval/run.mjs\` 를 다시 돌리면 캐시가 자동 무효화되어 최신 프롬프트로 재수집된다.`);
      L.push('');
    }
    if (pv.mixedPrompt || pv.mixedSchema) L.push(`> ⚠️ 원 응답 안에서도 프롬프트/스키마 버전이 섞여 있다. 재수집을 권한다.`);
  }
  L.push(`- 정답지: \`${p.truthFile}\` · 원 응답: \`${p.rawDir}\``);
  L.push(`- 저신뢰 기권 임계값: confidence < ${p.opts.lowConfThreshold}`);
  if (p.scope) {
    L.push(`- **평가 범위: \`${p.scope.mode}\`** — 대상 ${p.scope.nInScope}건${p.scope.nOutOfScope ? ` · 범위 외 ${p.scope.nOutOfScope}건(참고용 별도 집계)` : ''}`);
    L.push(`  - 범위 외 접두사: ${p.scope.outOfScopePrefixes.map((x) => `\`${x}\``).join(', ')} — 사용자 결정으로 롯데콘서트홀·예술의전당만 대상`);
  }
  L.push('');

  L.push(`## 0. 한눈에`);
  L.push('');
  L.push(`| 지표 | 값 |`);
  L.push(`|---|---|`);
  L.push(`| 평가 이미지 | ${a.nItems}건 |`);
  L.push(`| 전체 필드 정확도 (정답 있는 필드) | **${pct(a.overall.accuracy)}** (${a.overall.nScoredFields}개 필드) |`);
  L.push(`| 전체 평균 점수 (부분점수 포함) | ${n3(a.overall.meanScore)} |`);
  L.push(`| **할루시네이션율** (날조: 티켓에 없는 값 생성) | **${pct(a.hallucination.rate)}** (${a.hallucination.nHallucinated}/${a.hallucination.nNullFields}) |`);
  L.push(`| 귀속 오류율 (글자는 있으나 필드가 틀림) | ${pct(a.hallucination.misattributionRate)} (${a.hallucination.nMisattributed}/${a.hallucination.nNullFields}) |`);
  L.push(`| 최보수 기준 (정답 null 인데 값이 있으면 전부 오답) | ${pct(a.hallucination.strictRate)} (${a.hallucination.nStrict}/${a.hallucination.nNullFields}) |`);
  L.push(`| confidence 캘리브레이션 ECE | ${a.calibration.ece === null ? '—' : n3(a.calibration.ece)} |`);
  L.push(`| confidence ↔ 정답 상관 | ${a.calibration.correlation === null ? '—' : n3(a.calibration.correlation)} |`);
  L.push(`| 평균 지연 | ${p.perf.meanLatencyMs === null ? '미측정' : p.perf.meanLatencyMs + ' ms'} |`);
  L.push(`| 비결정성 flip rate | ${p.nondeterminism.overallFlipRate === null ? '미측정 (--repeat 미사용)' : pct(p.nondeterminism.overallFlipRate)} |`);
  L.push('');
  if (p.missingRaw?.length) L.push(`> 원 응답이 없어 제외된 항목 ${p.missingRaw.length}건: ${p.missingRaw.slice(0, 10).map(esc).join(', ')}`, '');
  if (p.erroredRuns?.length) L.push(`> API 실패로 제외된 호출 ${p.erroredRuns.length}건: ${p.erroredRuns.slice(0, 5).map((e) => esc(e.file)).join(', ')}`, '');

  // 1. 필드별
  L.push(`## 1. 필드별 정확도`);
  L.push('');
  L.push(`| 필드 | 채점 기준 | n | 정확도 | 평균점수 | 문자유사도 | P | R | F1 |`);
  L.push(`|---|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const f of a.fieldStats) {
    L.push(`| \`${f.field}\` | ${FIELD_RULE[f.field] || '—'} | ${f.nScored} | ${pct(f.accuracy)} | ${n3(f.meanScore)} | ${f.meanSimilarity === null ? '—' : n3(f.meanSimilarity)} | ${f.precision === null ? '—' : n3(f.precision)} | ${f.recall === null ? '—' : n3(f.recall)} | ${f.f1 === null ? '—' : n3(f.f1)} |`);
  }
  L.push('');
  const uncovered = a.fieldStats.filter((f) => f.nScored === 0 && f.n > 0);
  if (uncovered.length) {
    L.push(`> ⚠️ **정답 표본이 0인 필드: ${uncovered.map((f) => `\`${f.field}\``).join(', ')}**`);
    L.push(`> 이 필드들은 이번 평가 대상 전부에서 정답이 null 이었다(= 티켓에 없었다).`);
    L.push(`> **정확도가 검증되지 않았다는 뜻이다** — 표의 \`—\` 를 "문제 없음" 으로 읽으면 안 된다.`);
    L.push(`> 값이 있는 티켓을 정답지에 추가해야 이 필드의 판독 정확도를 알 수 있다.`);
    L.push('');
  }
  L.push(`> \`n\` 은 **정답이 있는** 필드 수. 정답이 null 인 필드는 정확도가 아니라 아래 3장(할루시네이션)에서 센다.`);
  L.push(`> 텍스트 필드는 exact 만 보면 표기 변형 때문에 과소평가된다 — \`정확도\`(exact)와 \`문자유사도\`를 같이 볼 것.`);
  L.push('');

  // 2. 분해
  L.push(`## 2. 난이도별 / 공연장별 분해`);
  L.push('');
  L.push(`### 2-1. 난이도별`);
  L.push('');
  L.push(`| 난이도 | 이미지 | 필드 정확도 | 평균점수 | 할루시네이션율 |`);
  L.push(`|---|---:|---:|---:|---:|`);
  for (const g of a.byDifficulty) L.push(`| ${esc(g.key)} | ${g.nItems} | ${pct(g.accuracy)} | ${n3(g.meanScore)} | ${g.nNullFields ? pct(g.hallucinationRate) : '—'} |`);
  L.push('');
  L.push(`### 2-2. 공연장별`);
  L.push('');
  L.push(`| 공연장 | 이미지 | 필드 정확도 | 평균점수 | 할루시네이션율 |`);
  L.push(`|---|---:|---:|---:|---:|`);
  for (const g of a.byVenue) L.push(`| ${esc(g.key)} | ${g.nItems} | ${pct(g.accuracy)} | ${n3(g.meanScore)} | ${g.nNullFields ? pct(g.hallucinationRate) : '—'} |`);
  L.push('');
  L.push(`> 공연장은 **정답지의 venue** 기준으로 묶는다(모델 출력 기준이 아님). 티켓 레이아웃이 공연장별로 정형화돼 있어 few-shot 예시를 어디에 더 넣어야 하는지가 여기서 보인다.`);
  L.push('');

  // 3. 할루시네이션
  L.push(`## 3. 할루시네이션 (가장 중요한 지표)`);
  L.push('');
  L.push(`정답지에서 \`unreadable_fields\` 로 표시된(= 티켓에 실제로 없는) 필드에 모델이 무엇을 했는가.`);
  L.push('');
  L.push(`| 판정 | 뜻 | 건수 |`);
  L.push(`|---|---|---:|`);
  const OUT_KO = {
    abstain_empty: '빈 값 반환 — 올바른 기권 ✅',
    abstain_lowconf: `값은 냈지만 confidence < ${p.opts.lowConfThreshold} — 조건부 정답 ✅`,
    nonnumeric_text: "숫자 금액이 아닌 인쇄 문자열('초대권' 등)을 그대로 읽음 — raw 판독으로는 정상 ✅",
    misattributed: '티켓에 **있는** 글자인데 필드를 잘못 넣음 — 오답이지만 날조는 아님 ⚠️',
    fabricated: '티켓 어디에도 없는 값을 지어냄 — **진짜 할루시네이션** ❌',
  };
  for (const o of a.hallucination.byOutcome) L.push(`| \`${o.outcome}\` | ${OUT_KO[o.outcome]} | ${o.n} |`);
  L.push(`| **합계** | 정답이 null 인 필드 | ${a.hallucination.nNullFields} |`);
  L.push('');
  L.push(`- **할루시네이션율 = ${pct(a.hallucination.rate)}** (\`fabricated\` ${a.hallucination.nHallucinated}건 / 정답 null 필드 ${a.hallucination.nNullFields}건)`);
  L.push(`- 귀속 오류율(misattribution) = ${pct(a.hallucination.misattributionRate)} (${a.hallucination.nMisattributed}건)`);
  L.push(`- **가장 보수적인 기준** (정답이 null 인데 값이 있으면 무조건 오답) = ${pct(a.hallucination.strictRate)} (${a.hallucination.nStrict}건)`);
  L.push('');
  L.push(`> **왜 나눠서 세는가.** "정답이 null인데 값이 있다"를 전부 할루시네이션으로 세면 과대계상된다.`);
  L.push(`> 실측에서 세 가지가 섞여 나왔고, **고치는 방법이 서로 다르다**:`);
  L.push(`> - \`fabricated\` — 근거 없는 날조. 프롬프트로 "없으면 빈 문자열" 을 강제해도 남는다면 심각한 문제다.`);
  L.push(`> - \`misattributed\` — 예: 공연명을 artist 에도 복사. 정보를 만든 게 아니라 **필드 정의가 모호한 것**이다. 프롬프트에서 title/artist 경계를 명시하면 줄어든다.`);
  L.push(`> - \`nonnumeric_text\` — 초대권처럼 금액이 인쇄되지 않은 티켓. 모델은 인쇄된 '초대권' 을 정직하게 읽었다. \`priceRaw\` 로는 정답이고, 파싱된 \`price\` 만 null 이어야 한다.`);
  L.push(`>`);
  L.push(`> 어느 기준을 쓸지 헷갈리면 위 세 줄을 모두 보고하면 된다. 하나만 골라야 한다면 \`fabricated\` 가 "모델이 거짓말을 하는가"에 대한 답이다.`);
  L.push('');
  if (a.hallucination.cases.length) {
    L.push(`### 3-1. 날조(fabricated) — 티켓에 없는 값`);
    L.push('');
    L.push(`| 이미지 | 필드 | 모델이 만든 값 | 모델 confidence |`);
    L.push(`|---|---|---|---:|`);
    for (const c of a.hallucination.cases) L.push(`| \`${esc(c.file)}\` | \`${esc(c.field)}\` | ${esc(short(c.pred, 70))} | ${c.confidence === null ? '—' : n3(c.confidence)} |`);
    L.push('');
  } else {
    L.push(`날조 없음 ✅`);
    L.push('');
  }
  const mc = a.hallucination.misattributedCases || [];
  if (mc.length) {
    L.push(`### 3-2. 귀속 오류(misattributed) — 글자는 티켓에 있으나 필드가 틀림`);
    L.push('');
    L.push(`| 이미지 | 필드 | 모델이 넣은 값 | conf |`);
    L.push(`|---|---|---|---:|`);
    for (const c of mc) L.push(`| \`${esc(c.file)}\` | \`${esc(c.field)}\` | ${esc(short(c.pred, 70))} | ${c.confidence === null ? '—' : n3(c.confidence)} |`);
    L.push('');
  }
  const nc = a.hallucination.nonNumericCases || [];
  if (nc.length) {
    L.push(`### 3-3. 비숫자 금액 문자열 — 초대권 등`);
    L.push('');
    L.push(`| 이미지 | 필드 | 모델이 읽은 값 | conf |`);
    L.push(`|---|---|---|---:|`);
    for (const c of nc) L.push(`| \`${esc(c.file)}\` | \`${esc(c.field)}\` | ${esc(short(c.pred, 70))} | ${c.confidence === null ? '—' : n3(c.confidence)} |`);
    L.push('');
    L.push(`> \`parsePrice('초대') === 0\` 이다. 무료 티켓을 0원으로 저장할지, null 로 둘지는 제품 결정이다. 정답지는 null 로 본다.`);
    L.push('');
  }

  // 4. 캘리브레이션
  L.push(`## 4. confidence 캘리브레이션`);
  L.push('');
  const calTable = (cal, title, note) => {
    L.push(`### ${title}`);
    L.push('');
    if (note) L.push(note, '');
    if (!cal || !cal.nPoints) { L.push(`측정 불가 (표본 없음).`, ''); return; }
    L.push(`| confidence 구간 | 샘플 | 평균 confidence | 실제 정답률 | 격차 |`);
    L.push(`|---|---:|---:|---:|---:|`);
    for (const b of cal.bins) {
      if (!b.n) continue;
      L.push(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.n} | ${n3(b.meanConf)} | ${pct(b.accuracy)} | ${n3(b.meanConf - b.accuracy)} |`);
    }
    L.push('');
    L.push(`- ECE = **${n3(cal.ece)}** · 상관계수 = **${n3(cal.correlation)}** (표본 ${cal.nPoints})`);
    L.push('');
  };
  if (a.calibrationApp && a.calibrationApp.nPoints) {
    L.push(`모델이 말한 confidence 가 실제 정답률과 일치하는가. 일치하지 않으면 "confidence < 0.8 필드만 노란 테두리" 같은 UI 규칙이 무의미해진다.`);
    L.push('');
    L.push(`\`postProcessOCR()\` 은 confidence 를 보정한다 (예: \`date\` 는 *LLM 판독 신뢰도 × 코드 파싱 신뢰도*, 빈 값이면 0).`);
    L.push(`보정이 실제로 캘리브레이션을 개선하는지 확인하려면 **보정 전/후를 나눠 봐야 한다.**`);
    L.push('');
    calTable(a.calibration, `4-1. 보정 전 — 모델이 스스로 낸 confidence`);
    calTable(a.calibrationApp, `4-2. 보정 후 — postProcessOCR 이 앱에 넘기는 confidence`, `UI의 노란 테두리 판정에 실제로 쓰이는 값이다.`);
    const dE = a.calibration.ece - a.calibrationApp.ece;
    L.push(`**보정 효과: ECE ${n3(a.calibration.ece)} → ${n3(a.calibrationApp.ece)} (${dE > 0 ? '개선 ' : '악화 '}${n3(Math.abs(dE))})**`);
    L.push('');
    L.push(`- 격차가 양수면 **과신**(자신있다 해놓고 틀림), 음수면 과소신뢰.`);
    L.push(`- 상관계수가 0 근처면 confidence 가 정답 여부와 무관하다(= 쓸모없다).`);
    L.push('');
  } else if (!a.calibration.nPoints) {
    L.push(`모델 출력에 필드별 confidence 가 없어 측정 불가.`);
    L.push(`> ARCHITECTURE 4-3 C2 대로 \`{ "value": ..., "confidence": ... }\` 형태로 반환하도록 \`OCR_RESPONSE_SCHEMA\` 를 바꾸면 이 절이 채워진다.`);
  } else {
    L.push(`모델이 말한 confidence 가 실제 정답률과 일치하는가. 일치하지 않으면 "confidence < 0.8 필드만 노란 테두리" 같은 UI 규칙이 무의미해진다.`);
    L.push('');
    L.push(`| confidence 구간 | 샘플 | 평균 confidence | 실제 정답률 | 격차 |`);
    L.push(`|---|---:|---:|---:|---:|`);
    for (const b of a.calibration.bins) {
      if (!b.n) continue;
      L.push(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.n} | ${n3(b.meanConf)} | ${pct(b.accuracy)} | ${n3(b.meanConf - b.accuracy)} |`);
    }
    L.push('');
    L.push(`- **ECE (Expected Calibration Error) = ${n3(a.calibration.ece)}** — 0 에 가까울수록 confidence 를 그대로 믿어도 된다.`);
    L.push(`- **상관계수 = ${n3(a.calibration.correlation)}** — 0 근처면 confidence 가 정답 여부와 무관하다(= 쓸모없다).`);
    L.push(`- 격차가 양수면 **과신**(자신있다 해놓고 틀림), 음수면 과소신뢰.`);
  }
  L.push('');

  // 5. 비결정성
  L.push(`## 5. 비결정성 (--repeat)`);
  L.push('');
  if (p.nondeterminism.overallFlipRate === null || !p.nondeterminism.items.length) {
    L.push(`측정하지 않음. \`node eval/run.mjs --repeat 3\` 으로 같은 이미지를 여러 번 호출해야 측정된다.`);
  } else {
    L.push(`같은 이미지를 여러 번 호출했을 때 값이 흔들린 비율. 높으면 정확도 수치 자체의 신뢰구간이 넓다는 뜻이다.`);
    L.push('');
    L.push(`- 전체 flip rate: **${pct(p.nondeterminism.overallFlipRate)}**`);
    L.push('');
    L.push(`| 필드 | 반복 측정한 이미지 | 흔들린 이미지 | flip rate |`);
    L.push(`|---|---:|---:|---:|`);
    for (const r of p.nondeterminism.perField) L.push(`| \`${esc(r.field)}\` | ${r.nFiles} | ${r.nUnstable} | ${pct(r.flipRate)} |`);
    L.push('');
    const unstable = p.nondeterminism.items.filter((i) => i.nUnstableFields);
    if (unstable.length) {
      L.push(`### 5-1. 흔들린 구체 값`);
      L.push('');
      for (const it of unstable) {
        L.push(`**\`${esc(it.file)}\`** (${it.runs}회)`);
        L.push('');
        for (const u of it.unstable) {
          L.push(`- \`${esc(u.field)}\`: ${u.distinct.map((d) => `\`${esc(short(JSON.parse(d), 40))}\``).join(' / ')}`);
        }
        L.push('');
      }
    }
  }
  L.push('');

  // 6. 이미지별 상세
  L.push(`## 6. 이미지별 상세 — 틀린 필드`);
  L.push('');
  for (const it of p.items) {
    const wrong = it.fields.filter((f) => !f.correct);
    const head = `### \`${esc(it.file)}\` — ${esc(it.difficulty)} · ${esc(it.venue)}`;
    if (!wrong.length) { L.push(head, '', `전 필드 정답 ✅`, ''); continue; }
    L.push(head, '');
    L.push(`틀린 필드 ${wrong.length} / ${it.fields.length}`);
    L.push('');
    L.push(`| 필드 | 기대값 | 실제값 | 판정 | conf |`);
    L.push(`|---|---|---|---|---:|`);
    for (const f of wrong) {
      const verdict = f.nullTruth ? (OUT_KO[f.outcome] ? f.outcome : '할루시네이션') : (typeof f.similarity === 'number' ? `유사도 ${n3(f.similarity)}` : (typeof f.f1 === 'number' ? `F1 ${n3(f.f1)}` : '불일치'));
      L.push(`| \`${esc(f.field)}\` | ${esc(short(f.nullTruth ? null : f.truth))} | ${esc(short(f.pred))} | ${verdict} | ${f.confidence === null ? '—' : n3(f.confidence)} |`);
    }
    L.push('');
    if (it.notes?.length) L.push(...it.notes.map((n) => `> ⚠️ ${esc(n)}`), '');
    if (it.parseError) L.push(`> ⚠️ 모델 출력 JSON 파싱 실패: ${esc(it.parseError)}`, '');
  }

  // 7. 비용/지연
  L.push(`## 7. 지연 · 토큰 · 비용`);
  L.push('');
  L.push(`| 항목 | 값 |`);
  L.push(`|---|---|`);
  L.push(`| 평균 지연 | ${p.perf.meanLatencyMs === null ? '미측정' : p.perf.meanLatencyMs + ' ms'} |`);
  L.push(`| p95 지연 | ${p.perf.p95LatencyMs === null ? '미측정' : p.perf.p95LatencyMs + ' ms'} |`);
  L.push(`| 이미지당 입력 토큰 | ${p.perf.meanPromptTokens === null ? '미측정' : int(p.perf.meanPromptTokens)} |`);
  L.push(`| 이미지당 출력 토큰 | ${p.perf.meanCandidateTokens === null ? '미측정' : int(p.perf.meanCandidateTokens)} |`);
  L.push(`| 이미지당 thinking 토큰 | ${p.perf.meanThoughtTokens === null || p.perf.meanThoughtTokens === undefined ? '미측정' : int(p.perf.meanThoughtTokens)} |`);
  L.push(`| 이미지당 총 토큰 | ${p.perf.meanTotalTokens === null || p.perf.meanTotalTokens === undefined ? '미측정' : int(p.perf.meanTotalTokens)} |`);
  if (p.runSummary) {
    L.push(`| API 호출 / 캐시 히트 / 실패 | ${p.runSummary.nApiCalls} / ${p.runSummary.nCacheHits} / ${p.runSummary.nFailed} |`);
    if (p.runSummary.resize) L.push(`| 리사이즈 | 장변 ${p.runSummary.resize}px |`);
  }
  L.push('');
  const pr = p.pricing;
  if (pr && (pr.inputPerMTok !== null && pr.inputPerMTok !== undefined)) {
    const cin = (p.perf.meanPromptTokens || 0) / 1e6 * pr.inputPerMTok;
    // thinking 토큰은 출력 단가로 과금된다 — 합산하지 않으면 비용을 과소추정한다.
    const cout = ((p.perf.meanCandidateTokens || 0) + (p.perf.meanThoughtTokens || 0)) / 1e6 * (pr.outputPerMTok ?? 0);
    L.push(`**이미지당 비용 추정: ${(cin + cout).toFixed(6)} ${pr.currency || 'USD'}** (입력 ${cin.toFixed(6)} + 출력·thinking ${cout.toFixed(6)})`);
    L.push('');
    L.push(`> 단가 출처: ${esc(pr.source || '미기재')} · 확인일 ${esc(pr.checkedAt || '미기재')}`);
  } else {
    L.push(`**비용 추정: 미산출.** \`eval/pricing.json\` 의 \`inputPerMTok\`/\`outputPerMTok\` 이 비어 있다.`);
    L.push('');
    L.push(`> 단가를 추측해서 채우면 리포트 전체의 신뢰도가 떨어진다. Google AI 공식 가격표에서 \`${p.model}\` 의 단가를 확인해 \`eval/pricing.json\` 에 넣으면 이 줄이 실제 금액으로 바뀐다.`);
  }
  L.push('');

  if (a.typeMismatches && a.typeMismatches.length) {
    L.push(`## 8. 정답지 ↔ 타입 불일치`);
    L.push('');
    L.push(`정답이 \`ParsedSeat\` 의 타입과 구조적으로 맞지 않아 **어떤 모델을 써도 맞출 수 없는** 항목이다. 채점기는 크래시하지 않고 오답으로 처리한다.`);
    L.push('');
    L.push(`| 이미지 | 필드 | 정답 |`);
    L.push(`|---|---|---|`);
    for (const t of a.typeMismatches) L.push(`| \`${esc(t.file)}\` | \`${esc(t.field)}\` | ${esc(short(t.truth))} |`);
    L.push('');
  }

  if (p.outOfScope && p.outOfScope.items.length) {
    const o = p.outOfScope.aggregate;
    L.push(`## 9. 참고: 범위 외 (${p.scope.outOfScopePrefixes.join(', ')})`);
    L.push('');
    L.push(`> 아래 수치는 **헤드라인 지표에 포함되지 않는다.** 대상 공연장이 롯데콘서트홀·예술의전당으로 좁혀졌기 때문이다.`);
    L.push(`> OCR 자체가 되는지는 여전히 볼 가치가 있어 따로 집계한다.`);
    L.push('');
    L.push(`| 지표 | 값 |`);
    L.push(`|---|---|`);
    L.push(`| 이미지 | ${o.nItems}건 |`);
    L.push(`| 필드 정확도 | ${pct(o.overall.accuracy)} (${o.overall.nScoredFields}개 필드) |`);
    L.push(`| 평균 점수 | ${n3(o.overall.meanScore)} |`);
    L.push(`| 할루시네이션율 | ${pct(o.hallucination.rate)} (${o.hallucination.nHallucinated}/${o.hallucination.nNullFields}) |`);
    L.push('');
    L.push(`| 필드 | n | 정확도 | 평균점수 |`);
    L.push(`|---|---:|---:|---:|`);
    for (const f of o.fieldStats) L.push(`| \`${esc(f.field)}\` | ${f.nScored} | ${pct(f.accuracy)} | ${n3(f.meanScore)} |`);
    L.push('');
    if (o.typeMismatches && o.typeMismatches.length) {
      L.push(`**타입 불일치 ${o.typeMismatches.length}건** — 세종 대극장은 열이 알파벳(\`1층 B열 191번\`)이라 \`ParsedSeat.row: number|null\` 과 맞지 않는다. 이것이 범위 축소의 실질적 이유다.`);
      L.push('');
      L.push(`| 이미지 | 필드 | 정답 |`);
      L.push(`|---|---|---|`);
      for (const t of o.typeMismatches) L.push(`| \`${esc(t.file)}\` | \`${esc(t.field)}\` | ${esc(short(t.truth))} |`);
      L.push('');
    }
  }

  L.push(`---`);
  L.push('');
  L.push(`## 부록. 지표 정의`);
  L.push('');
  L.push(`- **정확도(accuracy)**: 필드 단위 exact 일치 비율. 정답이 null 인 필드는 제외.`);
  L.push(`- **평균점수(meanScore)**: 텍스트 필드는 유사도, program 은 F1, 나머지는 0/1 의 평균. 부분점수를 포함한 "체감 품질".`);
  L.push(`- **문자유사도**: 정규화(공백·괄호·구두점 제거, NFKC, 소문자) 후 Levenshtein 거리 기반 \`1 - d/max(len)\`.`);
  L.push(`- **할루시네이션율**: 정답이 null 인 필드 중, 모델이 충분한 confidence 로 값을 만들어낸 비율.`);
  L.push(`- **ECE**: confidence 구간별 |평균 confidence − 실제 정답률| 을 샘플 수로 가중 평균.`);
  L.push(`- **flip rate**: 같은 이미지를 N회 호출했을 때 값이 하나로 고정되지 않은 (이미지, 필드) 쌍의 비율.`);
  L.push('');
  return L.join('\n');
}

// 단독 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));
  const inPath = args.in ? path.resolve(args.in) : path.join(HERE, 'out', 'scores.json');
  if (!fs.existsSync(inPath)) { console.error(`\n[중단] ${inPath} 가 없습니다. 먼저: node eval/score.mjs\n`); process.exit(1); }
  const payload = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const pricingPath = path.join(HERE, 'pricing.json');
  if (fs.existsSync(pricingPath)) {
    try {
      const table = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
      payload.pricing = table.models?.[payload.model] || table.models?.default || null;
    } catch {}
  }
  const outPath = args.out ? path.resolve(args.out) : path.join(HERE, 'out', 'report.md');
  fs.writeFileSync(outPath, renderReport(payload));
  console.log(`리포트: ${outPath}`);
}
