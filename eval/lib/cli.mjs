/** 아주 작은 인자 파서. --flag, --key value, --key=value 지원. */
export function parseArgs(argv, { booleans = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const k = a.slice(2);
    if (booleans.includes(k)) { out[k] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[k] = true; }
    else { out[k] = next; i++; }
  }
  return out;
}
export function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
