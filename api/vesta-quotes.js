// api/vesta-quotes.js — Vercel serverless proxy para Vesta · Cartera.
//
// Cuatro modos, según el parámetro que llegue:
//   ?url=<ficha de Finect>   → precio de esa ficha (fondos/ETF vía Finect).
//   ?isin=<ISIN>             → resuelve el ISIN a una ficha de Finect vía
//                               Tavily, y de paso devuelve ya su precio.
//   ?ticker=<símbolo Yahoo>  → precio de ese ticker (acciones/ETF vía
//                               Yahoo — lo que Finect no cubre).
//   ?yisin=<ISIN>            → resuelve el ISIN a un ticker de Yahoo vía
//                               Tavily, y de paso devuelve ya su precio.
//
// Por qué Tavily y no otra cosa: se probaron tres vías antes de esta,
// todas descartadas por límites reales, no por error de configuración:
//   - Scraping de DuckDuckGo desde el proxy: bloqueado por ser tráfico de
//     IP de datacenter (Vercel/AWS) — confirmado con la página de error
//     real de DuckDuckGo.
//   - API de Bing Search: retirada por Microsoft el 11 de agosto de 2025,
//     sin altas nuevas ni reemplazo directo.
//   - API oficial de Google Custom Search JSON: cerrada a proyectos
//     nuevos durante 2026 — 403 aunque todo esté bien configurado.
// Tavily es una API pensada para búsquedas programáticas (agentes/IA), con
// plan gratuito de 1.000 consultas/mes sin tarjeta — de sobra para algo
// que solo se dispara una vez por valor nuevo. Su plan gratuito también
// podría cambiar en el futuro (como le pasó a Brave a mitad de 2026); si
// deja de estar disponible, el 🔍 manual sigue siendo la vía segura.
//
// ── Configuración necesaria en Vercel (Settings → Environment Variables) ──
//   TAVILY_API_KEY  → clave gratuita de https://tavily.com (empieza por
//                      "tvly-"), sin necesidad de tarjeta.
//
// AVISO: la extracción del precio se hace convirtiendo el HTML a texto
// plano (quitando etiquetas) y aplicando una expresión regular sobre ese
// texto — no sobre el HTML crudo. Hizo falta este paso intermedio porque
// en la ficha real el precio y el símbolo de euro están en dos <span>
// hermanos ("<span>358,74</span><span>€</span>"), no como texto plano
// contiguo. Sigue siendo un ajuste sobre el formato de hoy, no algo
// blindado ante cualquier cambio futuro de Finect.
//
// Respuesta: { url?, price, currency: "EUR", asOf, source: "finect" }

const HTML_ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&euro;": "€" };
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&euro;/g, m => HTML_ENTITIES[m])
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchFinectPrice(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "es-ES,es;q=0.9",
    },
  });
  if (!r.ok) throw { status: 502, message: `Finect respondió ${r.status}` };
  const html = await r.text();
  const text = htmlToText(html);

  // Precio: número con formato español (punto de miles, coma decimal)
  // seguido del símbolo de euro — ya sobre el texto plano, así que da
  // igual cuántas etiquetas hubiera entre el número y el símbolo.
  const priceMatch = text.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*€/);
  if (!priceMatch) throw { status: 422, message: "No se encontró un precio en la página — puede que Finect haya cambiado el formato de la ficha." };
  const price = parseFloat(priceMatch[1].replace(/\./g, "").replace(",", "."));

  // Fecha del valor liquidativo, formato DD/MM/YYYY en el texto de la página.
  const dateMatch = text.match(/valor liquidativo[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{4})/i);
  const asOf = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  return { price, currency: "EUR", asOf };
}

// Normaliza la URL: recorta espacios, admite http(s) y con/sin "www.", y
// con/sin protocolo — cubre tanto lo que alguien pegue a mano como lo que
// devuelva Tavily.
function normalizeFinectUrl(raw) {
  const trimmed = String(raw).trim();
  const m = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?finect\.com\/fondos-inversion\/(.+)$/i);
  if (!m) return null;
  return `https://www.finect.com/fondos-inversion/${m[1]}`;
}

async function resolveIsinViaTavily(isin) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw { status: 500, message: "Falta TAVILY_API_KEY como variable de entorno en Vercel." };
  }
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: isin,
      search_depth: "basic",
      max_results: 5,
      include_domains: ["finect.com"],
    }),
  });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  if (!r.ok) {
    const msg = (body && (body.detail || body.message || body.error)) || `Tavily respondió ${r.status}`;
    throw { status: r.status === 429 ? 429 : 502, message: typeof msg === "string" ? msg : JSON.stringify(msg) };
  }
  const results = (body && body.results) || [];
  const isinUpper = isin.toUpperCase();
  const isFinectFund = (link) => /^https:\/\/(?:www\.)?finect\.com\/fondos-inversion\//i.test(link);
  const exact = results.find(it => isFinectFund(it.url) && it.url.toUpperCase().includes(isinUpper));
  const fallback = results.find(it => isFinectFund(it.url));
  const chosen = exact || fallback;
  if (!chosen) throw { status: 404, message: "No se encontró ficha en Finect para ese ISIN — prueba a buscarlo a mano." };
  return normalizeFinectUrl(chosen.url) || chosen.url;
}

// ── Yahoo Finance — acciones/ETF (Finect no las cubre) ─────────────────
// v8/finance/chart es el único endpoint no oficial de Yahoo que sigue
// funcionando sin "crumb" ni cookie de sesión — v7/finance/quote (el de
// cotizaciones en lote) ya lo exige y aun así da 429 con frecuencia. Un
// símbolo por request, sin autenticación, con cabeceras de navegador para
// no oler a bot.
async function fetchYahooPrice(ticker) {
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
  const r = await fetch(chartUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "application/json",
    },
  });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  const result = body && body.chart && body.chart.result && body.chart.result[0];
  if (!r.ok || !result || !result.meta || result.meta.regularMarketPrice == null) {
    const apiErr = body && body.chart && body.chart.error && body.chart.error.description;
    throw { status: r.ok ? 422 : 502, message: apiErr || `Yahoo respondió ${r.status} o sin precio para "${ticker}".` };
  }
  const meta = result.meta;
  const asOf = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10) : null;
  return { price: meta.regularMarketPrice, currency: meta.currency || "EUR", asOf };
}

// Resolución ISIN→ticker de Yahoo, mismo patrón que con Finect: Tavily
// buscando dentro de finance.yahoo.com, y se extrae el ticker del propio
// path "/quote/{TICKER}/" del resultado.
async function resolveTickerViaTavily(isin) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw { status: 500, message: "Falta TAVILY_API_KEY como variable de entorno en Vercel." };
  }
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: isin,
      search_depth: "basic",
      max_results: 5,
      include_domains: ["finance.yahoo.com"],
    }),
  });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  if (!r.ok) {
    const msg = (body && (body.detail || body.message || body.error)) || `Tavily respondió ${r.status}`;
    throw { status: r.status === 429 ? 429 : 502, message: typeof msg === "string" ? msg : JSON.stringify(msg) };
  }
  const results = (body && body.results) || [];
  for (const it of results) {
    const m = it.url && it.url.match(/\/quote\/([^/?]+)/i);
    if (m) return decodeURIComponent(m[1]);
  }
  throw { status: 404, message: "No se encontró ticker de Yahoo para ese ISIN — prueba a buscarlo/ponerlo a mano." };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { url, isin, ticker, yisin } = req.query;

  try {
    if (url && typeof url === "string") {
      const normalized = normalizeFinectUrl(url);
      if (!normalized) {
        return res.status(400).json({ error: "Parámetro 'url' inválido — debe ser una ficha de finect.com/fondos-inversion/…" });
      }
      const q = await fetchFinectPrice(normalized);
      return res.status(200).json({ ...q, source: "finect" });
    }

    if (isin && typeof isin === "string") {
      if (!/^[A-Za-z]{2}[A-Za-z0-9]{9}\d$/.test(isin)) {
        return res.status(400).json({ error: "Parámetro 'isin' con formato inválido." });
      }
      const resolvedUrl = await resolveIsinViaTavily(isin);
      const q = await fetchFinectPrice(resolvedUrl);
      return res.status(200).json({ url: resolvedUrl, ...q, source: "finect" });
    }

    if (ticker && typeof ticker === "string") {
      const q = await fetchYahooPrice(ticker.trim());
      return res.status(200).json({ ticker: ticker.trim(), ...q, source: "yahoo" });
    }

    if (yisin && typeof yisin === "string") {
      if (!/^[A-Za-z]{2}[A-Za-z0-9]{9}\d$/.test(yisin)) {
        return res.status(400).json({ error: "Parámetro 'yisin' con formato inválido." });
      }
      const resolvedTicker = await resolveTickerViaTavily(yisin);
      const q = await fetchYahooPrice(resolvedTicker);
      return res.status(200).json({ ticker: resolvedTicker, ...q, source: "yahoo" });
    }

    return res.status(400).json({ error: "Falta el parámetro 'url', 'isin', 'ticker' o 'yisin'." });
  } catch (e) {
    const status = (e && e.status) || 500;
    const message = (e && e.message) || String(e);
    return res.status(status).json({ error: message });
  }
}
