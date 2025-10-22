// scripts/build-rankings.mjs
// Erstellt /data/rankings.json auf Basis von Finnhub-Daten.
// Voraussetzungen:
//  - Node 20+ (fetch ist integriert)
//  - Secret FINNHUB_KEY (GitHub Actions → Secrets)
//  - data/universe.json mit [{ "symbol": "SAP.DE", "name": "SAP" }, ...]

// Kategorien:
//  - most_traded: Top 6 nach Umsatz (price * volume)
//  - most_bought: Unter den liquidesten Werten, Top 6 nach Tages-Change % (absteigend)
//  - most_sold:   Unter den liquidesten Werten, Top 6 nach Tages-Change % (aufsteigend)
//  - turnarounds: 10y-Trend (CAGR) > 0 UND Drawdown vom 3M-Hoch ≤ -10 %, Top 6 nach größtem Drawdown

import fs from 'fs/promises';
import path from 'path';

const FINNHUB_KEY = process.env.FINNHUB_KEY;
if (!FINNHUB_KEY) {
  console.error('Missing FINNHUB_KEY env variable.');
  process.exit(1);
}

const ROOT = process.cwd();
const UNIVERSE_PATH = path.join(ROOT, 'data/universe.json');
const OUT_PATH = path.join(ROOT, 'data/rankings.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function cagr(start, end, years){
  if (start <= 0 || end <= 0 || years <= 0) return null;
  return (Math.pow(end/start, 1/years) - 1) * 100;
}
function maxInRange(arr){
  let m = -Infinity;
  for (const x of arr) if (x != null && x > m) m = x;
  return m;
}
async function fetchCandles(symbol, fromTs, toTs){
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${fromTs}&to=${toTs}&token=${FINNHUB_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status} for ${symbol}`);
  const j = await res.json();
  if (j.s !== 'ok') throw new Error(`Finnhub status ${j.s} for ${symbol}`);
  return j; // {c,h,l,o,s,t,v}
}

async function main(){
  const universe = JSON.parse(await fs.readFile(UNIVERSE_PATH, 'utf-8'));
  const now = new Date();
  const toTs = Math.floor(now.getTime()/1000);
  const from_1y  = toTs - 400*24*3600;   // ~400 Tage
  const from_10y = toTs - 3650*24*3600;  // ~10 Jahre

  const rows = [];
  for (const {symbol, name} of universe){
    try {
      // 1-Jahres-Daten
      const oneYear = await fetchCandles(symbol, from_1y, toTs);
      const n = oneYear.c.length;
      if (!n) continue;
      const close = oneYear.c[n-1];
      const vol   = oneYear.v[n-1];

      // voriger Schlusskurs
      let prev = null;
      for (let i=n-2;i>=0;i--){ if (oneYear.c[i] != null){ prev = oneYear.c[i]; break; } }
      if (prev == null) continue;

      const change_pct   = (close - prev) / prev * 100;
      const turnover_eur = close * vol;

      // Drawdown vom 3M-Hoch (letzte ~90 Kalendertage)
      const recentCloses = oneYear.c.slice(-90);
      const high3m = maxInRange(recentCloses);
      const drawdown_pct = (high3m && close) ? (close/high3m - 1) * 100 : null;

      // 10y-Trend (CAGR)
      let trend10y_cagr = null;
      try{
        const tenYear = await fetchCandles(symbol, from_10y, toTs);
        const c = tenYear.c.filter(x => x != null);
        if (c.length > 252){
          const start = c[0];
          const end   = c[c.length-1];
          trend10y_cagr = cagr(start, end, 10);
        }
      }catch(e){ /* optional */ }

      rows.push({ symbol, name, price: close, change_pct, volume: vol, turnover_eur, drawdown_pct, trend10y_cagr });
    } catch (e){
      console.warn('Symbol failed:', symbol, String(e));
    }
    await sleep(200); // API freundlich behandeln
  }

  // Kategorien bilden
  const sortedByTurnover = [...rows].sort((a,b)=> (b.turnover_eur||0) - (a.turnover_eur||0));
  const liquidityCut = Math.max(6, Math.floor(sortedByTurnover.length * 0.3));
  const universeLiquid = sortedByTurnover.slice(0, liquidityCut);

  const most_traded = sortedByTurnover.slice(0, 6);
  const most_bought = [...universeLiquid].sort((a,b)=> (b.change_pct??-1e9) - (a.change_pct??-1e9)).slice(0,6);
  const most_sold   = [...universeLiquid].sort((a,b)=> (a.change_pct??1e9) - (b.change_pct??1e9)).slice(0,6);

  const turnarounds = rows
    .filter(r => (r.trend10y_cagr != null && r.trend10y_cagr > 0) &&
                 (r.drawdown_pct   != null && r.drawdown_pct <= -10))
    .sort((a,b)=> (a.drawdown_pct) - (b.drawdown_pct)) // stärkster Rückgang zuerst
    .slice(0,6);

  const out = {
    as_of: now.toISOString().slice(0,10),
    most_traded,
    most_bought,
    most_sold,
    turnarounds
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  console.log('Wrote', OUT_PATH);
}

main().catch(err => { console.error(err); process.exit(1); });
