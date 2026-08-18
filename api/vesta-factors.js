// /api/vesta-factors.js
//
// Server-side proxy for Vesta's factor auto-update. Exists because neither
// source allows direct calls from browser JS (CORS), same reason /api/bgg
// and /api/biwenger exist for their respective modules.
//
// Two sources, selected via ?source=:
//
//   source=ecb     — European Central Bank Data Portal (official, free,
//                    no key). Used for the cash/rate factor (EONIA/ESTR).
//                    params: flowRef (default "EST"), key (required),
//                            startPeriod (optional, YYYY-MM-DD)
//                    example: /api/vesta-factors?source=ecb&flowRef=EST&key=B.EU000A2X2A25.WT
//
//   source=yahoo   — Yahoo Finance's unofficial "v8/finance/chart" endpoint.
//                    Not an official API — Yahoo shut theirs down in 2017.
//                    This is the same endpoint yfinance and similar tools
//                    use; it can change or start blocking without notice.
//                    params: ticker (required), range (default "3mo")
//                    example: /api/vesta-factors?source=yahoo&ticker=URTH&range=3mo
//
// Both return: { series: [ { date: "YYYY-MM-DD", value: number }, ... ] }
//   - ecb:   value = the published rate, in percent (e.g. 1.93 = 1.93%)
//   - yahoo: value = adjusted close price, in the ticker's native currency

export default async function handler(req, res) {
  const { source } = req.query;

  try {
    if (source === "ecb") {
      return await handleECB(req, res);
    } else if (source === "yahoo") {
      return await handleYahoo(req, res);
    } else {
      return res.status(400).json({ error: "Missing or invalid 'source'. Use 'ecb' or 'yahoo'." });
    }
  } catch (e) {
    console.error("[vesta-factors] error:", e);
    return res.status(502).json({ error: e.message || "Upstream fetch failed" });
  }
}

async function handleECB(req, res) {
  const { flowRef = "EST", key, startPeriod } = req.query;
  if (!key) return res.status(400).json({ error: "Missing 'key' (e.g. B.EU000A2X2A25.WT)" });

  let url = `https://data-api.ecb.europa.eu/service/data/${encodeURIComponent(flowRef)}/${encodeURIComponent(key)}?format=csvdata`;
  if (startPeriod) url += `&startPeriod=${encodeURIComponent(startPeriod)}`;

  const upstream = await fetch(url, { headers: { Accept: "text/csv" } });
  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `ECB API returned ${upstream.status}` });
  }
  const text = await upstream.text();
  const series = parseECBCsv(text);
  return res.status(200).json({ series });
}

function parseECBCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map(h => h.replace(/"/g, "").trim());
  const dateIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");
  if (dateIdx === -1 || valueIdx === -1) return [];

  const series = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const date = (cols[dateIdx] || "").replace(/"/g, "");
    const value = parseFloat((cols[valueIdx] || "").replace(/"/g, ""));
    if (!date || isNaN(value)) continue;
    series.push({ date, value });
  }
  series.sort((a, b) => a.date.localeCompare(b.date));
  return series;
}

function splitCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function handleYahoo(req, res) {
  const { ticker, range = "3mo" } = req.query;
  if (!ticker) return res.status(400).json({ error: "Missing 'ticker' (e.g. URTH, ACWV, ^IBEX)" });

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}&interval=1d&events=div,splits`;

  const upstream = await fetch(url, {
    headers: {
      // Yahoo's unofficial endpoint tends to reject requests with no
      // browser-like User-Agent.
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "Accept": "application/json",
    },
  });

  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `Yahoo endpoint returned ${upstream.status}` });
  }

  const data = await upstream.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const errMsg = data?.chart?.error?.description || "No data returned for this ticker";
    return res.status(404).json({ error: errMsg });
  }

  const timestamps = result.timestamp || [];
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose;
  const close = result.indicators?.quote?.[0]?.close;
  const prices = adjclose || close || [];

  const series = timestamps
    .map((ts, i) => ({ ts, value: prices[i] }))
    .filter(p => p.value != null)
    .map(p => ({ date: new Date(p.ts * 1000).toISOString().slice(0, 10), value: p.value }));

  return res.status(200).json({ series });
}
