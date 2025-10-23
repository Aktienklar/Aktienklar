// scripts/build-rankings.mjs (Yahoo Finance, kein API-Key nötig)
// Erzeugt /data/rankings.json mit 4 Kategorien à 6 Aktien.
//
// Quelle: https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=...&interval=1d
// Funktioniert für .DE (z.B. SAP.DE) und US (AAPL, MSFT, ...)

import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const UNIVERSE_PATH = path.join(ROOT, "data/universe.json");
const OUT_PATH = path.join(ROOT, "data/rankings.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cagr(start, end, years) {
  if (start <= 0 || end <= 0 || years <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}
function maxIn(arr) {
  let m = -Infinity;
  for (const x of arr) if (x != null && !Number.isNaN(x) && x > m) m = x;
  return m;
}

async function yChart(symbol, range = "1y") {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?range=${range}&interval=1d&events=div%2Csplit`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AktienklarBot/1.0)" },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo empty result for ${symbol}`);
  const t = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  return { t, c: q.close || [], v: q.volume || [] };
}

function lastNonNull(arr, fromIdx) {
  for (let i = fromIdx; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

async function main() {
  const universe = JSON.parse(await fs.readFile(UNIVERSE_PATH, "utf-8"));
  const rows = [];

  for (const { symbol, name } of universe) {
    try {
      // 1 Jahr Daten
      const oneYear = await yChart(symbol, "1y");
      const n = oneYear.c.length;
      if (!n) throw new Error("no candles");

      const close = lastNonNull(oneYear.c, n - 1);
      const vol = lastNonNull(oneYear.v, n - 1);
      const prev = lastNonNull(oneYear.c, n - 2);
      if (close == null || vol == null || prev == null)
        throw new Error("missing close/vol/prev");

      const change_pct = ((close - prev) / prev) * 100;
      const turnover_eur = close * vol;

      // 3 Monate ~ letzte 90 Kalendertage aus 1y-Serie
      const recent = oneYear.c.slice(-90);
      const high3m = maxIn(recent);
      const drawdown_pct =
        high3m && close ? (close / high3m - 1) * 100 : null;

      // 10 Jahre Trend
      let trend10y_cagr = null;
      try {
        const ten = await yChart(symbol, "10y");
        const c = (ten.c || []).filter((x) => x != null);
        if (c.length > 252) {
          const start = c[0];
          const end = c[c.length - 1];
          trend10y_cagr = cagr(start, end, 10);
        }
      } catch (_) {
        // ok
      }

      rows.push({
        symbol,
        name,
        price: close,
        change_pct,
        volume: vol,
        turnover_eur,
        drawdown_pct,
        trend10y_cagr,
      });
    } catch (e) {
      console.warn("Symbol failed:", symbol, String(e));
    }
    // höflich throttlen
    await sleep(150);
  }

  // Kategorien bilden
  const byTurnover = [...rows].sort(
    (a, b) => (b.turnover_eur || 0) - (a.turnover_eur || 0)
  );
  const liquidityCut = Math.max(6, Math.floor(byTurnover.length * 0.3));
  const liquid = byTurnover.slice(0, liquidityCut);

  const most_traded = byTurnover.slice(0, 6);
  const most_bought = [...liquid]
    .sort((a, b) => (b.change_pct ?? -1e9) - (a.change_pct ?? -1e9))
    .slice(0, 6);
  const most_sold = [...liquid]
    .sort((a, b) => (a.change_pct ?? 1e9) - (b.change_pct ?? 1e9))
    .slice(0, 6);
  const turnarounds = rows
    .filter(
      (r) =>
        (r.trend10y_cagr != null && r.trend10y_cagr > 0) &&
        (r.drawdown_pct != null && r.drawdown_pct <= -10)
    )
    .sort((a, b) => a.drawdown_pct - b.drawdown_pct)
    .slice(0, 6);

  const out = {
    as_of: new Date().toISOString().slice(0, 10),
    most_traded,
    most_bought,
    most_sold,
    turnarounds,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  console.log("Wrote", OUT_PATH, "with", {
    rows: rows.length,
    most_traded: most_traded.length,
    most_bought: most_bought.length,
    most_sold: most_sold.length,
    turnarounds: turnarounds.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
