// api/vesta-quotes.js — Vercel serverless proxy para Vesta · Cartera.
//
// Dos modos, según el parámetro que llegue:
//   ?url=<ficha de Finect>   → lee el precio de esa ficha concreta.
//   ?isin=<ISIN>             → resuelve el ISIN a una ficha de Finect vía
//                               la API oficial de Google Custom Search, y
//                               de paso devuelve ya su precio.
//
// Por qué la API oficial y no scraping del buscador: se probó scraping
// directo de DuckDuckGo (y antes se pensó en Google) desde el propio
// proxy — bloqueado de forma deliberada por ser tráfico desde IP de
// datacenter (Vercel/AWS), confirmado con la página de error real, no una
// suposición. La API de Google Custom Search es tráfico autorizado (con
// clave), así que no choca con eso — el coste es depender de una clave y
// de una cuota (100 consultas/día en el nivel gratuito), más que
// suficiente para algo que solo se dispara una vez por valor nuevo.
//
// ── Configuración necesaria en Vercel (Settings → Environment Variables) ──
//   GOOGLE_CSE_API_KEY  → clave de la API de Google Cloud Console, con la
//                          "Custom Search API" habilitada.
//   GOOGLE_CSE_CX       → ID del motor de búsqueda programable creado en
//                          https://programmablesearchengine.google.com/
//                          (recomendado: configurarlo para buscar solo en
//                          finect.com, así basta con mandar el ISIN como
//                          consulta sin necesidad de "site:").
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
// devuelva la API de Google.
function normalizeFinectUrl(raw) {
  const trimmed = String(raw).trim();
  const m = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?finect\.com\/fondos-inversion\/(.+)$/i);
  if (!m) return null;
  return `https://www.finect.com/fondos-inversion/${m[1]}`;
}

async function resolveIsinViaGoogleCSE(isin) {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) {
    throw { status: 500, message: "Faltan GOOGLE_CSE_API_KEY / GOOGLE_CSE_CX como variables de entorno en Vercel." };
  }
  // "site:finect.com" de más por si el motor programable no está
  // restringido a ese dominio — no estorba si ya lo está.
  const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(`site:finect.com ${isin}`)}`;
  const r = await fetch(searchUrl);
  let body = null;
  try { body = await r.json(); } catch (e) {}
  if (!r.ok) {
    const msg = (body && body.error && body.error.message) || `Google Custom Search respondió ${r.status}`;
    throw { status: r.status === 429 ? 429 : 502, message: msg };
  }
  const items = (body && body.items) || [];
  const isinUpper = isin.toUpperCase();
  const isFinectFund = (link) => /^https:\/\/(?:www\.)?finect\.com\/fondos-inversion\//i.test(link);
  const exact = items.find(it => isFinectFund(it.link) && it.link.toUpperCase().includes(isinUpper));
  const fallback = items.find(it => isFinectFund(it.link));
  const chosen = exact || fallback;
  if (!chosen) throw { status: 404, message: "No se encontró ficha en Finect para ese ISIN — prueba a buscarlo a mano." };
  return normalizeFinectUrl(chosen.link) || chosen.link;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { url, isin } = req.query;

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
      const resolvedUrl = await resolveIsinViaGoogleCSE(isin);
      const q = await fetchFinectPrice(resolvedUrl);
      return res.status(200).json({ url: resolvedUrl, ...q, source: "finect" });
    }

    return res.status(400).json({ error: "Falta el parámetro 'url' o 'isin'." });
  } catch (e) {
    const status = (e && e.status) || 500;
    const message = (e && e.message) || String(e);
    return res.status(status).json({ error: message });
  }
}
