// api/vesta-quotes.js — Vercel serverless proxy para Vesta · Cartera.
//
// Siete modos, según el parámetro que llegue:
//   ?url=<ficha de Finect>   → precio de esa ficha (fondos/ETF vía Finect).
//   ?isin=<ISIN>             → resuelve el ISIN a una ficha de Finect vía
//                               Tavily, y de paso devuelve ya su precio.
//   ?ticker=<símbolo Yahoo>  → precio de ese ticker (acciones/ETF vía
//                               Yahoo — lo que Finect no cubre).
//   ?yisin=<ISIN>            → resuelve el ISIN a un ticker de Yahoo vía
//                               el buscador de Yahoo (sin clave), y de
//                               paso devuelve ya su precio.
//   ?search=<texto o ISIN>   → buscador de símbolos de Yahoo sin clave —
//                               devuelve todos los candidatos, sin filtrar
//                               ni elegir por el usuario. Sustituye a
//                               Tavily para resolución de fondos/acciones
//                               vía Yahoo (para Finect sigue haciendo
//                               falta Tavily, ver ?isin= arriba).
//   ?history=<ticker Yahoo>  → serie histórica diaria (para TTWROR), con
//                               &range=5y o &period1=<unix>&period2=<unix>.
//                               Sin conversión a EUR — eso es un paso
//                               posterior (ver ?fx=), y solo para
//                               instrumentos vía Yahoo. Para fondos, usa
//                               el símbolo "0P…F" (performanceId de
//                               Morningstar), no el ISIN — resuélvelo con
//                               ?search=<ISIN> primero.
//   ?fx=<divisa>             → tipos de cambio diarios divisa→EUR desde el
//                               BCE, con &start=YYYY-MM-DD. Para convertir
//                               un histórico que no esté ya en EUR.
//
// Por qué Tavily sigue haciendo falta para Finect (aunque ya no para
// Yahoo): se probaron tres vías antes, todas descartadas por límites
// reales, no por error de configuración:
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
// El buscador propio de Yahoo (v1/finance/search) no necesita nada de
// esto — funciona sin clave ni crumb — así que ?yisin= y ?search= ya no
// dependen de Tavily. TAVILY_API_KEY se mantiene solo para ?isin=.
//
// ── Configuración necesaria en Vercel (Settings → Environment Variables) ──
//   TAVILY_API_KEY  → clave gratuita de https://tavily.com (empieza por
//                      "tvly-"), sin necesidad de tarjeta. Solo la usa
//                      ?isin= (resolución de Finect).
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
//
// Sin conversión — algunos valores cotizan nativamente en USD o GBP(X), y
// Yahoo los devuelve tal cual en esa divisa. fetchYahooRaw es la pieza
// base; fetchYahooPrice (más abajo) la envuelve con la conversión a EUR.
async function fetchYahooRaw(ticker) {
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
  // Las acciones del mercado británico cotizan a menudo en peniques
  // ("GBp"/"GBX", 1/100 de libra) en vez de en libras — hay que
  // normalizarlo a GBP antes de convertir, o la conversión saldría 100
  // veces más alta de lo real.
  const rawCurrency = meta.currency || "EUR";
  const isPence = /^GBp$/i.test(rawCurrency) || /^GBX$/i.test(rawCurrency);
  const price = isPence ? meta.regularMarketPrice / 100 : meta.regularMarketPrice;
  const currency = isPence ? "GBP" : rawCurrency.toUpperCase();
  return { price, currency, asOf };
}

// Convierte a EUR cuando el valor cotiza en otra divisa, usando el propio
// Yahoo como fuente del tipo de cambio (par "{DIVISA}EUR=X", p.ej.
// "USDEUR=X" o "GBPEUR=X" — confirmado que existen con ese formato). Si
// el par de cambio no se puede consultar, se falla explícitamente en vez
// de devolver un precio en la divisa original sin avisar — mejor un error
// visible que un número silenciosamente mal convertido.
async function fetchYahooPrice(ticker) {
  const raw = await fetchYahooRaw(ticker);
  if (raw.currency === "EUR") return raw;
  let fx;
  try {
    fx = await fetchYahooRaw(`${raw.currency}EUR=X`);
  } catch (e) {
    throw { status: 502, message: `Precio obtenido en ${raw.currency} pero no se pudo convertir a EUR (par ${raw.currency}EUR=X no disponible en Yahoo).` };
  }
  return {
    price: raw.price * fx.price,
    currency: "EUR",
    asOf: raw.asOf,
    originalPrice: raw.price,
    originalCurrency: raw.currency,
    fxRate: fx.price,
  };
}

// ── Yahoo Finance — resolución de símbolo ────────────────────────────
// v1/finance/search acepta ISIN y devuelve el símbolo de Yahoo sin
// clave ni crumb. Para fondos devuelve el performanceId de Morningstar
// con sufijo de bolsa (p.ej. ES0112611001 → 0P00016YQ5.F), que es el
// único formato para el que Yahoo sirve histórico diario de fondos.
// Sustituye a Tavily: sin cuota mensual y con la divisa/bolsa en la
// propia respuesta.
async function fetchYahooSearch(query) {
  const params = new URLSearchParams({
    q: query,
    quotesCount: "10",
    newsCount: "0",
    enableFuzzyQuery: "false",
    quotesQueryId: "tss_match_phrase_query",
  });
  const url = `https://query2.finance.yahoo.com/v1/finance/search?${params.toString()}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "application/json",
    },
  });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  if (!r.ok || !body) throw { status: 502, message: `Yahoo respondió ${r.status} al buscar "${query}".` };

  const quotes = (body.quotes || []).filter(q => q && q.symbol);
  if (quotes.length === 0) {
    throw { status: 404, message: `Yahoo no encontró ningún símbolo para "${query}".` };
  }
  return {
    query,
    results: quotes.map(q => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      type: q.typeDisp || q.quoteType || null,   // "Fund", "ETF", "Equity"
      exchange: q.exchDisp || q.exchange || null, // "Frankfurt", "Amsterdam"...
    })),
  };
}

// ── BCE — tipos de cambio históricos (para convertir series a EUR) ────
// Fuente oficial, gratuita y sin clave. OBS_VALUE son unidades de la
// divisa extranjera por 1 EUR, así que la conversión es
// valorEUR = valorDivisa / rate. Solo publica días hábiles TARGET: el
// consumidor debe arrastrar el último valor conocido en los huecos.
async function fetchEcbFxSeries(currency, startPeriod) {
  const cur = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw { status: 400, message: "Divisa inválida — se espera un código ISO de 3 letras." };
  if (cur === "EUR") return { currency: "EUR", base: "EUR", points: [] };

  const params = new URLSearchParams({ format: "csvdata" });
  if (startPeriod) params.set("startPeriod", startPeriod);
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${cur}.EUR.SP00.A?${params.toString()}`;
  const r = await fetch(url, { headers: { "Accept": "text/csv" } });
  if (!r.ok) throw { status: 502, message: `El BCE respondió ${r.status} para ${cur}.` };
  const text = await r.text();

  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw { status: 422, message: `El BCE no devolvió datos para ${cur}.` };
  const header = lines[0].split(",");
  const iDate = header.indexOf("TIME_PERIOD");
  const iVal = header.indexOf("OBS_VALUE");
  if (iDate < 0 || iVal < 0) throw { status: 502, message: "Formato CSV inesperado del BCE." };

  const points = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = cols[iDate];
    const rate = parseFloat(cols[iVal]);
    if (!date || !isFinite(rate)) continue; // el BCE marca festivos con "NaN"
    points.push({ date, rate });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return { currency: cur, base: "EUR", points };
}

// ── Yahoo Finance — histórico diario (para TTWROR) ──────────────────────
// Mismo endpoint v8/finance/chart que fetchYahooRaw, pero pidiendo una
// serie en vez del último precio: &range=<Xy|Xmo|...> o
// &period1=<unix>&period2=<unix> (period1/period2 tienen prioridad si
// llegan los dos — es lo que respeta el propio Yahoo).
//
// Deliberadamente SIN convertir a EUR aquí — la conversión de un histórico
// completo necesitaría el tipo de cambio de CADA día, no el actual (que es
// lo único que da fetchYahooPrice), y eso es una pieza aparte que aún no
// está decidida. Este endpoint solo entrega la serie cruda en su divisa
// original, marcada con `currency`, para que se pueda revisar antes de
// construir nada encima.
//
// adjclose (ajustado por dividendos) es el campo bueno para TTWROR — usar
// `close` a secas distorsionaría cualquier fondo/ETF de reparto en cada
// fecha de corte de dividendo. Si Yahoo no trae adjclose para un ticker
// (pasa con algún ETF), se cae a `close` sin más.
//
// Huecos: Yahoo devuelve `null` en close/adjclose para sesiones sin dato
// (fondo poco líquido, festivo local no filtrado, etc.) — esos puntos se
// descartan aquí, no se devuelven como null, para no ensuciar la revisión
// manual del paso 2 con "ruido" que no es realmente un hueco de cotización.
async function fetchYahooHistory(ticker, { range, period1, period2 }) {
  const params = new URLSearchParams({ interval: "1d" });
  if (period1 && period2) {
    params.set("period1", period1);
    params.set("period2", period2);
  } else {
    params.set("range", range || "5y");
  }
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`;
  const r = await fetch(chartUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "application/json",
    },
  });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  const result = body && body.chart && body.chart.result && body.chart.result[0];
  if (!r.ok || !result || !result.timestamp) {
    const apiErr = body && body.chart && body.chart.error && body.chart.error.description;
    const meta = result && result.meta;
    if (!apiErr && meta && meta.instrumentType === "MUTUALFUND") {
      throw { status: 422, message: `Yahoo conoce "${ticker}" pero no tiene serie histórica para ese símbolo. Para fondos hace falta el símbolo tipo "0P…F" (búscalo con ?search=<ISIN>), no el ISIN con sufijo de bolsa.` };
    }
    throw { status: r.ok ? 422 : 502, message: apiErr || `Yahoo respondió ${r.status} o sin histórico para "${ticker}".` };
  }

  const meta = result.meta || {};
  const rawCurrency = meta.currency || "EUR";
  const isPence = /^GBp$/i.test(rawCurrency) || /^GBX$/i.test(rawCurrency);
  const currency = isPence ? "GBP" : rawCurrency.toUpperCase();

  const timestamps = result.timestamp;
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const adjBlock = result.indicators && result.indicators.adjclose && result.indicators.adjclose[0];
  const closes = quote.close || [];
  const adjcloses = (adjBlock && adjBlock.adjclose) || null;

  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    const ac = adjcloses ? adjcloses[i] : c;
    if (c == null && ac == null) continue; // hueco real de Yahoo — se descarta
    points.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      close: c != null ? (isPence ? c / 100 : c) : null,
      adjclose: ac != null ? (isPence ? ac / 100 : ac) : (c != null ? (isPence ? c / 100 : c) : null),
    });
  }
  if (points.length === 0) {
    throw { status: 422, message: `Yahoo no devolvió ningún punto con dato para "${ticker}" en ese rango.` };
  }
  return { currency, points, hasAdjclose: !!adjcloses };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { url, isin, ticker, yisin, search, history, range, period1, period2, fx, start } = req.query;

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
      const found = await fetchYahooSearch(yisin.trim());
      const resolvedTicker = found.results[0].symbol;
      const q = await fetchYahooPrice(resolvedTicker);
      return res.status(200).json({
        ticker: resolvedTicker,
        candidates: found.results,   // para que la UI pueda ofrecer alternativas
        ...q,
        source: "yahoo",
      });
    }

    if (search && typeof search === "string") {
      const q = await fetchYahooSearch(search.trim());
      return res.status(200).json({ ...q, source: "yahoo" });
    }

    if (history && typeof history === "string") {
      const q = await fetchYahooHistory(history.trim(), { range, period1, period2 });
      return res.status(200).json({ ticker: history.trim(), ...q, source: "yahoo" });
    }

    if (fx && typeof fx === "string") {
      const q = await fetchEcbFxSeries(fx.trim(), start);
      return res.status(200).json({ ...q, source: "ecb" });
    }

    return res.status(400).json({ error: "Falta el parámetro 'url', 'isin', 'ticker', 'yisin', 'search', 'history' o 'fx'." });
  } catch (e) {
    const status = (e && e.status) || 500;
    const message = (e && e.message) || String(e);
    return res.status(status).json({ error: message });
  }
}
