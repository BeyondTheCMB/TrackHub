// /api/vesta-factors.js
//
// Server-side proxy for Vesta's factor data. Exists because the ECB Data
// Portal doesn't reliably allow direct calls from browser JS for this use
// (and to keep a consistent server-side error format), same reason
// /api/bgg and /api/biwenger exist for their respective modules.
//
// Yahoo Finance support was removed: its export format didn't match
// Investing.com CSVs consistently, and its free/unofficial endpoint was
// unreliable for niche mutual funds. Vesta now sources price data
// exclusively from Investing.com CSV exports (imported manually, with a
// search-assist button in the UI), keeping only this one source:
//
//   source=ecb   — European Central Bank Data Portal (official, free,
//                  no key). Used for the cash/rate factor (EONIA/ESTR).
//                  params: flowRef (default "EST"), key (required),
//                          startPeriod (optional, YYYY-MM-DD)
//                  example: /api/vesta-factors?source=ecb&flowRef=EST&key=B.EU000A2X2A25.WT
//
// Returns: { series: [ { date: "YYYY-MM-DD", value: number }, ... ] }
//   value = the published rate, in percent (e.g. 1.93 = 1.93%)

export default async function handler(req, res) {
  const { source } = req.query;

  try {
    if (source === "ecb") {
      return await handleECB(req, res);
    } else {
      return res.status(400).json({ error: "Missing or invalid 'source'. Only 'ecb' is supported." });
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
