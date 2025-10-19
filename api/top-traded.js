// /api/top-traded.ts — Vercel Serverless Function
// Env vars: FINNHUB_API_KEY, SYMBOLS (comma-separated tickers)

type Period = 'day' | 'week' | 'month';

function at00(d:Date){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dateRanges(period: Period){
  const now = new Date();
  const yesterday = new Date(at00(now).getTime() - 86400000);
  if (period==='day'){
    const from = yesterday; const to = new Date(yesterday.getTime() + 86400000);
    return {from, to};
  }
  if (period==='week'){
    const d0 = at00(now);
    const day = (d0.getDay()+6)%7;           // 0=Mo … 6=So
    const thisMon = new Date(d0.getTime() - day*86400000);
    const lastMon = new Date(thisMon.getTime() - 7*86400000);
    const lastSun = new Date(thisMon.getTime() - 1*86400000);
    return {from: lastMon, to: new Date(lastSun.getTime()+86400000)};
  }
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstPrev = new Date(now.getFullYear(), now.getMonth()-1, 1);
  return {from: firstPrev, to: firstThis};
}

async function volumeForSymbol(symbol:string, from:Date, to:Date, key:string){
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${Math.floor(from.getTime()/1000)}&to=${Math.floor(to.getTime()/1000)}&token=${key}`;
  const r = await fetch(url);
  if(!r.ok) return {volume:0, turnover:0, name:''};
  const j:any = await r.json();
  if(j.s!=='ok') return {volume:0, turnover:0, name:''};
  const vols:number[] = j.v || [];
  const closes:number[] = j.c || [];
  const volume = vols.reduce((a,b)=>a+b,0);
  const turnover = vols.reduce((sum,v,i)=> sum + v*(closes[i]||0), 0);
  return {volume, turnover, name:''};
}

export default async function handler(req:any, res:any) {
  try {
    const period = (req.query.period || 'day') as Period;
    const {from, to} = dateRanges(period);

    const API_KEY = process.env.FINNHUB_API_KEY || '';
    if(!API_KEY) return res.status(500).json({error:'Missing FINNHUB_API_KEY'});

    const UNIVERSE = (process.env.SYMBOLS || 'AAPL,MSFT,NVDA,AMZN,TSLA,META,GOOGL,ORCL,INTC,AMD')
      .split(',').map(s=>s.trim()).filter(Boolean);

    const rows = await Promise.all(UNIVERSE.map(async (ticker) => {
      const {volume, turnover, name} = await volumeForSymbol(ticker, from, to, API_KEY);
      return { ticker, name, volume, turnover };
    }));

    rows.sort((a,b)=> b.volume - a.volume);
    const top = rows.slice(0,10).map((r,i)=>({rank:i+1, ...r}));

    res.setHeader('cache-control','public, max-age=900, s-maxage=900');
    return res.status(200).json(top);
  } catch (e:any) {
    console.error(e);
    return res.status(500).json({error: e?.message || 'unknown'});
  }
}