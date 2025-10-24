// scripts/fetch-sp500.mjs
import fs from "fs/promises";

const URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
const html = await (await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0" }})).text();

// erste wikitable nehmen
const table = html.split('<table class="wikitable')[1].split("</table>")[0];
// simple Parser: jedes <tr>, erstes <td> enthält das Symbol
const rows = table.split("<tr").slice(2);
const symbols = [];
for (const r of rows) {
  const firstTd = r.split("</td>")[0];
  const m = firstTd.match(/>([A-Z.\-]+)<\/a>|>([A-Z.\-]+)\s*</i);
  const sym = (m?.[1] || m?.[2] || "").trim();
  if (sym) symbols.push(sym);
}
const uniq = [...new Set(symbols)].sort();
// gleiches Format wie dein universe.json: Array aus Objekten mit {symbol}
const out = uniq.map(s => ({ symbol: s }));
await fs.mkdir("data", { recursive: true });
await fs.writeFile("data/universe_sp500.json", JSON.stringify(out, null, 2));
console.log(`Wrote data/universe_sp500.json with ${out.length} tickers`);
