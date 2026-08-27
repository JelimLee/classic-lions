-- 두 홀 병합 후 rarity 재계산.
-- ⚠️ 선형식(1 − n/max)은 롱테일에서 무너진다 — 베토벤 황제협주곡(27회)이
--    0.90 = "매우 희귀"로 나온다. 백분위 랭크를 쓴다.
UPDATE works w SET
  rarity = r.pct,
  rarity_basis = 'sac_lotte_2016_2026_percentile'
FROM (
  SELECT id, percent_rank() OVER (ORDER BY COALESCE(rarity_n,0) DESC) AS pct
  FROM works
) r
WHERE w.id = r.id;
