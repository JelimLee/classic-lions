// 채점기. 필드마다 기준이 다르다 — 이게 이 하네스의 핵심이다.
//   date        정확일치 (normalizeDate 통과 후, zero-padded YYYY-MM-DD)
//   seat        parseSeat 결과를 필드별로 비교 + seat_raw 는 문자열 유사도
//   text 필드    정규화 후 exact + Levenshtein 유사도 둘 다
//   program     집합 비교 (precision/recall/F1)
//   price       숫자 정확일치
//   정답 null    빈 값/저신뢰 = 정답(기권), 그럴듯한 값 = 할루시네이션
import { normalizeText, normalizeWork, normSimilarity, isEmptyValue, toNumber } from './text.mjs';
import { pick, pickConfidence, pickSeatRaw } from './extract.mjs';

export const DEFAULT_OPTS = {
  lowConfThreshold: 0.5, // 이 미만이면 "모델이 모른다고 말한 것"으로 인정
  textSimForPartial: true,
};

export const TEXT_FIELDS = ['title', 'artist', 'venue'];
export const SEAT_SUBFIELDS = ['floor', 'block', 'row', 'number', 'grade'];

/**
 * 정답 정규화: 빈 문자열/빈 배열은 null 과 같은 뜻(= 티켓에 없음)으로 본다.
 * 정답지 작성자가 unreadable_fields 대신 ""를 쓰더라도 "기권이 정답"으로 채점돼야 한다.
 * 주의: 숫자 0 은 유효한 정답(무료 티켓)이므로 절대 null 로 바꾸지 않는다.
 */
function nz(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (Array.isArray(v)) return v.length === 0 ? null : v;
  return v;
}

/** 예측값이 같은 티켓의 다른 정답 필드 글자에서 온 것인가(= 귀속 오류이지 날조가 아닌가). */
function isMisattributed(predValue, otherTruthValues) {
  if (!otherTruthValues || !otherTruthValues.length) return false;
  const p = normalizeText(Array.isArray(predValue) ? predValue.join(' ') : predValue);
  if (p.length < 2) return false;
  return otherTruthValues.some((v) => {
    const t = normalizeText(v);
    if (t.length < 2) return false;
    return t.includes(p) || p.includes(t);
  });
}

function mkField(field, kind, extra) {
  return { field, kind, score: 0, correct: false, confidence: null, postConfidence: null, truth: null, pred: null, ...extra };
}

/**
 * 정답이 null 인 필드 판정.
 *
 * "정답이 null인데 값이 있다" 를 전부 할루시네이션으로 세면 과대계상된다. 실측에서 확인된 3가지가 섞인다:
 *
 *  1) fabricated     — 티켓 어디에도 없는 정보를 지어냄. **진짜 할루시네이션.**
 *  2) misattributed  — 티켓에 실제로 있는 글자인데 필드를 잘못 넣음
 *                      (예: title '메트로폴리탄 오페라 오케스트라' 를 artist 에도 복사).
 *                      정보를 만들어낸 게 아니라 귀속이 틀린 것 → 고치는 방법이 다르다(프롬프트 필드 정의).
 *  3) nonnumeric_text — price 처럼 파싱 대상 필드에서, 정답 null 은 "숫자 금액이 없음" 을 뜻하는데
 *                      모델은 인쇄된 '초대권' 을 그대로 읽어온 경우. raw 필드로서는 올바른 판독이다.
 *
 * 헤드라인 hallucination_rate 는 (1)만 센다. (2)(3)은 별도 지표로 전부 리포트한다.
 * 가장 보수적인 숫자가 필요하면 strictRate(값이 있으면 전부 오답)를 본다 — 이것도 함께 리포트한다.
 */
function scoreNullTruth(field, kind, predValue, confidence, opts, ctx = {}) {
  const empty = isEmptyValue(predValue);
  let outcome;
  if (empty) outcome = 'abstain_empty';
  else if (typeof confidence === 'number' && confidence < opts.lowConfThreshold) outcome = 'abstain_lowconf';
  else if (ctx.nonNumericPriceText) outcome = 'nonnumeric_text';
  else if (isMisattributed(predValue, ctx.otherTruthValues)) outcome = 'misattributed';
  else outcome = 'fabricated';
  // 기권(1,2) + 티켓에 실제로 있는 글자를 raw 로 읽은 경우(3)는 정보 날조가 아니다.
  const ok = outcome === 'abstain_empty' || outcome === 'abstain_lowconf' || outcome === 'nonnumeric_text';
  return mkField(field, kind, {
    nullTruth: true,
    outcome,
    // strict 집계용: 저신뢰라도 값을 만들어냈으면 오답으로 센다 (가장 보수적)
    strictHallucination: !empty,
    fabricated: outcome === 'fabricated',
    misattributed: outcome === 'misattributed',
    score: ok ? 1 : 0,
    correct: ok,
    confidence: confidence ?? null,
    truth: null,
    pred: predValue ?? null,
  });
}

function scoreText(field, truthVal, predVal, confidence, opts, rawPred, ctx) {
  if (nz(truthVal) === null) return scoreNullTruth(field, 'text', rawPred === undefined ? predVal : rawPred, confidence, opts, ctx);
  const t = normalizeText(truthVal);
  const p = normalizeText(predVal);
  const exact = t === p && t.length > 0;
  const sim = normSimilarity(truthVal, predVal);
  return mkField(field, 'text', {
    truth: truthVal, pred: predVal ?? null,
    exact, similarity: sim,
    score: exact ? 1 : (opts.textSimForPartial ? sim : 0),
    correct: exact,
    confidence: confidence ?? null,
  });
}

function scoreExact(field, kind, truthVal, predVal, confidence, opts, { normalize = (x) => (x === null || x === undefined ? null : String(x)), rawPred, ctx } = {}) {
  // 할루시네이션 판정은 후처리(normalizeDate/parsePrice) 결과가 아니라 모델 원값으로 한다.
  // 후처리기가 '초대' → 0 처럼 sentinel 을 만들면, 원값으로 보지 않는 한 오판한다.
  if (nz(truthVal) === null) return scoreNullTruth(field, kind, rawPred === undefined ? predVal : rawPred, confidence, opts, ctx);
  const t = normalize(truthVal);
  const p = normalize(predVal);
  const ok = t !== null && p !== null && t === p;
  return mkField(field, kind, {
    truth: truthVal, pred: predVal ?? null,
    exact: ok, score: ok ? 1 : 0, correct: ok, confidence: confidence ?? null,
  });
}

/** program 집합 비교. */
function scoreProgram(truthArr, predArr, confidence, opts, isUnreadable, ctx) {
  const truthSet = new Set((truthArr || []).map(normalizeWork).filter(Boolean));
  const predList = (Array.isArray(predArr) ? predArr : (predArr ? [predArr] : []))
    .map((x) => (x && typeof x === 'object' ? (x.value ?? x.title ?? '') : x));
  const predSet = new Set(predList.map(normalizeWork).filter(Boolean));

  if (isUnreadable || truthSet.size === 0) {
    if (truthSet.size === 0) {
      const f = scoreNullTruth('program', 'set', predList, confidence, opts, ctx);
      f.detail = { truthCount: 0, predCount: predSet.size };
      return f;
    }
  }
  let tp = 0;
  for (const p of predSet) if (truthSet.has(p)) tp++;
  const precision = predSet.size ? tp / predSet.size : (truthSet.size ? 0 : 1);
  const recall = truthSet.size ? tp / truthSet.size : 1;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return mkField('program', 'set', {
    truth: [...truthSet], pred: [...predSet],
    precision, recall, f1, score: f1, correct: f1 === 1,
    confidence: confidence ?? null,
    detail: {
      matched: [...predSet].filter((x) => truthSet.has(x)),
      missing: [...truthSet].filter((x) => !predSet.has(x)),
      spurious: [...predSet].filter((x) => !truthSet.has(x)),
    },
  });
}

/**
 * 한 이미지에 대한 채점.
 * @param {object} a.truthItem  ground_truth.json 의 items[i]
 * @param {object} a.pred       모델 원 출력(JSON 파싱된 것)
 * @param {object} a.mod        ocrSchema 모듈 (parseSeat, normalizeDate 사용)
 */
export function scoreItem({ truthItem, pred, mod, opts = {} }) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const truth = truthItem.truth || {};
  const unreadable = new Set(truthItem.unreadable_fields || []);
  const fields = [];
  const notes = [];

  // 앱과 동일한 경로를 타기 위해 postProcessOCR() 을 쓴다(있으면).
  // 이 함수는 날짜/좌석/금액을 정규화하면서 confidence 도 보정한다
  //   (예: dateConfidence = LLM 판독 신뢰도 × 코드 파싱 신뢰도, 빈 값이면 0).
  // 캘리브레이션은 보정 전(모델 원 confidence)과 보정 후(앱이 실제로 쓰는 값)를 모두 집계한다.
  let processed = null;
  if (typeof mod.postProcessOCR === 'function') {
    try { processed = mod.postProcessOCR(pred); }
    catch (e) { notes.push(`postProcessOCR 예외: ${e.message}`); }
  }
  // 귀속 오류 판정용: 이 티켓의 '진짜로 인쇄된' 글자들(정답 기준).
  const truthStrings = [truth.title, truth.artist, truth.venue, truth.seat_raw, ...(truth.program || [])]
    .filter((v) => typeof v === 'string' && v.trim());
  const ctxFor = (field) => ({ otherTruthValues: truthStrings.filter((v) => v !== truth[field]) });

  const appConf = (f) => {
    const c = processed && processed.confidence ? processed.confidence[f] : undefined;
    return typeof c === 'number' ? c : null;
  };

  // --- 텍스트 필드: 정규화 exact + Levenshtein 유사도 둘 다 ---
  for (const f of TEXT_FIELDS) {
    const got = pick(pred, f);
    const conf = pickConfidence(pred, f, got.confidence);
    const tv = unreadable.has(f) ? null : nz(truth[f]);
    const sf = scoreText(f, tv, processed ? processed[f] : got.value, conf, o, got.value, ctxFor(f));
    sf.appConfidence = appConf(f);
    fields.push(sf);
  }

  // --- date: normalizeDate 통과 후 정확일치 ---
  {
    const got = pick(pred, 'date');
    const conf = pickConfidence(pred, 'date', got.confidence);
    const rawDate = got.value === null || got.value === undefined ? '' : String(got.value);
    let norm = { value: null, confidence: 0 };
    try { norm = mod.normalizeDate(rawDate) || norm; }
    catch (e) { notes.push(`normalizeDate 예외: ${e.message}`); }
    // postProcessOCR 이 있으면 그 결과가 앱이 실제로 저장하는 값이다.
    const appDate = processed && processed.date !== undefined ? processed.date : undefined;
    if (appDate !== undefined && appDate !== norm.value) {
      notes.push(`date: postProcessOCR(${JSON.stringify(appDate)}) 과 normalizeDate(${JSON.stringify(norm.value)}) 불일치 — 앱 값 기준으로 채점`);
    }
    if (appDate !== undefined) norm = { value: appDate, confidence: norm.confidence };
    const tv = unreadable.has('date') ? null : nz(truth.date);
    const fs = scoreExact('date', 'date', tv, norm.value, conf, o, { rawPred: rawDate });
    fs.postConfidence = typeof norm.confidence === 'number' ? norm.confidence : null;
    fs.appConfidence = appConf('date');
    fs.detail = { raw: rawDate, normalized: norm.value };
    fields.push(fs);
  }

  // --- seat ---
  {
    const s = pickSeatRaw(pred);
    const conf = pickConfidence(pred, 'seat_raw', s.confidence);
    const truthRaw = unreadable.has('seat_raw') ? null : nz(truth.seat_raw);
    const fsRaw = scoreText('seat_raw', truthRaw, s.raw, conf, o, undefined, ctxFor('seat_raw'));
    fsRaw.appConfidence = appConf('seat');
    fields.push(fsRaw);

    let parsed = null;
    if (processed && processed.seat) parsed = processed.seat;
    else {
      try { parsed = mod.parseSeat(s.raw ?? ''); }
      catch (e) { notes.push(`parseSeat 예외: ${e.message}`); }
    }
    const parseConf = parsed && typeof parsed.confidence === 'number' ? parsed.confidence : null;
    const truthSeat = unreadable.has('seat') ? null : (truth.seat ?? null);
    const seatAllNull = truthSeat && SEAT_SUBFIELDS.every((k) => nz(truthSeat[k]) === null);

    if (truthSeat === null || seatAllNull) {
      const anyParsed = parsed ? SEAT_SUBFIELDS.some((k) => !isEmptyValue(parsed[k])) : false;
      const f = scoreNullTruth('seat', 'seat', anyParsed ? parsed : null, parseConf ?? conf, o);
      f.postConfidence = parseConf;
      f.appConfidence = appConf('seat');
      fields.push(f);
    } else {
      for (const k of SEAT_SUBFIELDS) {
        const tv = nz(truthSeat[k]);
        const pv = parsed ? (parsed[k] ?? null) : null;
        // 방어: 정답 row 가 문자열인 홀이 있다(세종 대극장 '1층 B열 191번').
        // ParsedSeat.row 는 number|null 이라 타입이 어긋난다 — 크래시하지 말고 표시만 남긴다.
        if ((k === 'row' || k === 'number' || k === 'floor') && typeof tv === 'string' && !/^\d+$/.test(tv)) {
          notes.push(`seat.${k}: 정답이 비숫자 문자열(${JSON.stringify(tv)}) — ParsedSeat.${k} 는 number|null 이라 구조적으로 일치 불가`);
        }
        const norm = (x) => (x === null || x === undefined ? null : normalizeText(x));
        const f = scoreExact(`seat.${k}`, 'seat', tv, pv, conf, o, { normalize: norm });
        f.postConfidence = parseConf;
        f.appConfidence = appConf('seat');
        if (typeof tv === 'string' && !/^\d+$/.test(tv) && k !== 'block' && k !== 'grade') f.typeMismatch = true;
        fields.push(f);
      }
    }
  }

  // --- price: 숫자 정확일치. 앱에 parsePrice 가 있으면 그것을 쓴다(평가/앱 일치). ---
  {
    const got = pick(pred, 'price');
    const conf = pickConfidence(pred, 'price', got.confidence);
    const tv = unreadable.has('price') ? null : (truth.price ?? null); // 0 은 유효 정답이라 nz() 를 쓰지 않는다
    let pv = null;
    if (processed && processed.price !== undefined) pv = processed.price;
    else if (typeof mod.parsePrice === 'function') {
      try { pv = mod.parsePrice(got.value === null || got.value === undefined ? '' : String(got.value)); }
      catch (e) { notes.push(`parsePrice 예외: ${e.message}`); pv = toNumber(got.value); }
    } else {
      pv = toNumber(got.value);
    }
    const f = scoreExact('price', 'number', tv, toNumber(pv), conf, o, {
      normalize: (x) => { const n = toNumber(x); return n === null ? null : String(n); },
      rawPred: got.value ?? null,
      // 정답 price 가 null 인데 모델이 숫자 없는 문자열('초대권')을 읽어온 경우는 날조가 아니다.
      ctx: { ...ctxFor('price'), nonNumericPriceText: !/\d/.test(String(got.value ?? '')) && !isEmptyValue(got.value) },
    });
    f.detail = { raw: got.value ?? null, parsed: pv };
    f.appConfidence = appConf('price');
    fields.push(f);
  }

  // --- program: 집합 P/R/F1 ---
  {
    const got = pick(pred, 'program');
    const conf = pickConfidence(pred, 'program', got.confidence);
    const predProgram = processed && Array.isArray(processed.program) ? processed.program : got.value;
    const pf = scoreProgram(unreadable.has('program') ? [] : (truth.program || []), predProgram, conf, o, unreadable.has('program'), ctxFor('program'));
    pf.appConfidence = appConf('program');
    fields.push(pf);
  }

  return {
    file: truthItem.file,
    difficulty: truthItem.difficulty || 'unknown',
    venue: truth.venue || '(미상)',
    fields,
    notes,
  };
}

// ---------------------------------------------------------------- 집계

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

export function aggregate(itemScores) {
  const byField = new Map();
  for (const it of itemScores) {
    for (const f of it.fields) {
      if (!byField.has(f.field)) byField.set(f.field, []);
      byField.get(f.field).push({ ...f, _item: it });
    }
  }
  const fieldStats = [];
  for (const [field, arr] of byField) {
    const scored = arr.filter((f) => !f.nullTruth);
    const nulls = arr.filter((f) => f.nullTruth);
    fieldStats.push({
      field,
      n: arr.length,
      nScored: scored.length,
      nNullTruth: nulls.length,
      accuracy: scored.length ? mean(scored.map((f) => (f.correct ? 1 : 0))) : null,
      meanScore: scored.length ? mean(scored.map((f) => f.score)) : null,
      meanSimilarity: mean(scored.filter((f) => typeof f.similarity === 'number').map((f) => f.similarity)),
      f1: mean(scored.filter((f) => typeof f.f1 === 'number').map((f) => f.f1)),
      precision: mean(scored.filter((f) => typeof f.precision === 'number').map((f) => f.precision)),
      recall: mean(scored.filter((f) => typeof f.recall === 'number').map((f) => f.recall)),
    });
  }
  fieldStats.sort((a, b) => a.field.localeCompare(b.field));

  // 할루시네이션 (가장 중요한 지표)
  const nullFields = itemScores.flatMap((it) => it.fields.filter((f) => f.nullTruth).map((f) => ({ ...f, file: it.file, difficulty: it.difficulty })));
  const hall = nullFields.filter((f) => f.outcome === 'fabricated');
  const misatt = nullFields.filter((f) => f.outcome === 'misattributed');
  const nonnum = nullFields.filter((f) => f.outcome === 'nonnumeric_text');
  const strictHall = nullFields.filter((f) => f.strictHallucination);
  const hallucination = {
    nNullFields: nullFields.length,
    nHallucinated: hall.length,
    rate: nullFields.length ? hall.length / nullFields.length : null,
    nStrict: strictHall.length,
    strictRate: nullFields.length ? strictHall.length / nullFields.length : null,
    nMisattributed: misatt.length,
    misattributionRate: nullFields.length ? misatt.length / nullFields.length : null,
    nNonNumericText: nonnum.length,
    byOutcome: ['abstain_empty', 'abstain_lowconf', 'nonnumeric_text', 'misattributed', 'fabricated']
      .map((k) => ({ outcome: k, n: nullFields.filter((f) => f.outcome === k).length })),
    cases: hall.map((f) => ({ file: f.file, field: f.field, pred: f.pred, confidence: f.confidence })),
    misattributedCases: misatt.map((f) => ({ file: f.file, field: f.field, pred: f.pred, confidence: f.confidence })),
    nonNumericCases: nonnum.map((f) => ({ file: f.file, field: f.field, pred: f.pred, confidence: f.confidence })),
  };

  // 그룹 분해
  const group = (keyFn) => {
    const m = new Map();
    for (const it of itemScores) {
      const k = keyFn(it);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return [...m.entries()].map(([k, items]) => {
      const fs = items.flatMap((i) => i.fields);
      const scored = fs.filter((f) => !f.nullTruth);
      const nt = fs.filter((f) => f.nullTruth);
      return {
        key: k, nItems: items.length,
        accuracy: scored.length ? mean(scored.map((f) => (f.correct ? 1 : 0))) : null,
        meanScore: scored.length ? mean(scored.map((f) => f.score)) : null,
        hallucinationRate: nt.length ? nt.filter((f) => f.outcome === 'fabricated').length / nt.length : null,
        nNullFields: nt.length,
      };
    }).sort((a, b) => String(a.key).localeCompare(String(b.key)));
  };

  // confidence 캘리브레이션 — 보정 전(모델 원값)과 보정 후(postProcessOCR 이 앱에 넘기는 값) 둘 다.
  const calibrate = (key) => {
    const pts = itemScores.flatMap((it) => it.fields)
      .filter((f) => typeof f[key] === 'number')
      .map((f) => ({ c: Math.min(1, Math.max(0, f[key])), y: f.correct ? 1 : 0 }));
    const bins = [];
    for (let i = 0; i < 10; i++) {
      const lo = i / 10, hi = (i + 1) / 10;
      const inBin = pts.filter((p) => (i === 9 ? p.c >= lo && p.c <= hi : p.c >= lo && p.c < hi));
      bins.push({ lo, hi, n: inBin.length, meanConf: mean(inBin.map((p) => p.c)), accuracy: mean(inBin.map((p) => p.y)) });
    }
    let ece = null, corr = null;
    if (pts.length) {
      ece = bins.filter((b) => b.n).reduce((s, b) => s + (b.n / pts.length) * Math.abs(b.meanConf - b.accuracy), 0);
      const mc = mean(pts.map((p) => p.c)), my = mean(pts.map((p) => p.y));
      const num = pts.reduce((s, p) => s + (p.c - mc) * (p.y - my), 0);
      const dc = Math.sqrt(pts.reduce((s, p) => s + (p.c - mc) ** 2, 0));
      const dy = Math.sqrt(pts.reduce((s, p) => s + (p.y - my) ** 2, 0));
      corr = dc && dy ? num / (dc * dy) : null;
    }
    return { nPoints: pts.length, bins, ece, correlation: corr };
  };
  const calRaw = calibrate('confidence');
  const calApp = calibrate('appConfidence');
  const { nPoints: pts_n, bins, ece, correlation: corr } = calRaw;
  const pts = { length: pts_n };

  const allScored = itemScores.flatMap((i) => i.fields).filter((f) => !f.nullTruth);
  return {
    nItems: itemScores.length,
    overall: {
      accuracy: allScored.length ? mean(allScored.map((f) => (f.correct ? 1 : 0))) : null,
      meanScore: allScored.length ? mean(allScored.map((f) => f.score)) : null,
      nScoredFields: allScored.length,
    },
    fieldStats,
    hallucination,
    byDifficulty: group((i) => i.difficulty),
    byVenue: group((i) => i.venue),
    calibration: calRaw,      // 보정 전: 모델이 스스로 낸 confidence
    calibrationApp: calApp,   // 보정 후: postProcessOCR 이 앱에 넘기는 confidence
    typeMismatches: itemScores.flatMap((it) => it.fields.filter((f) => f.typeMismatch).map((f) => ({ file: it.file, field: f.field, truth: f.truth }))),
  };
}

/** --repeat N: 같은 이미지 N회 호출에서 필드가 흔들린 비율. */
export function nondeterminism(runsByFile) {
  const perField = new Map();
  const items = [];
  for (const [file, runs] of runsByFile) {
    if (runs.length < 2) continue;
    const fieldNames = [...new Set(runs.flatMap((r) => r.fields.map((f) => f.field)))];
    const unstable = [];
    for (const fn of fieldNames) {
      const vals = runs.map((r) => {
        const f = r.fields.find((x) => x.field === fn);
        return f ? JSON.stringify(f.pred ?? null) : 'MISSING';
      });
      const distinct = new Set(vals);
      if (!perField.has(fn)) perField.set(fn, { field: fn, nFiles: 0, nUnstable: 0 });
      const rec = perField.get(fn);
      rec.nFiles++;
      if (distinct.size > 1) { rec.nUnstable++; unstable.push({ field: fn, distinct: [...distinct] }); }
    }
    items.push({ file, runs: runs.length, nUnstableFields: unstable.length, unstable });
  }
  const stats = [...perField.values()].map((r) => ({ ...r, flipRate: r.nFiles ? r.nUnstable / r.nFiles : null }));
  stats.sort((a, b) => (b.flipRate ?? 0) - (a.flipRate ?? 0));
  const totalF = stats.reduce((s, r) => s + r.nFiles, 0);
  const totalU = stats.reduce((s, r) => s + r.nUnstable, 0);
  return { perField: stats, items, overallFlipRate: totalF ? totalU / totalF : null };
}
