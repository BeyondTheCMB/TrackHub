// api/vesta-quotes.js — Vercel serverless proxy para Vesta · Cartera.
//
// Dos modos, según el parámetro que llegue:
//   ?url=<ficha de Finect>   → lee el precio de esa ficha concreta.
//   ?isin=<ISIN>             → resuelve el ISIN a una ficha de Finect
//                               (vía búsqueda en DuckDuckGo, sin API key)
//                               y de paso devuelve ya su precio.
//
// Por qué un proxy: ni Finect ni DuckDuckGo mandan cabeceras CORS, así que
// un fetch directo desde el navegador falla siempre — esto corre en el
// servidor, sin esa restricción.
//
// AVISOS honestos, sin verificar contra el HTML real desplegado:
// - La extracción del precio es una expresión regular ajustada a lo que se
//   ve hoy en la ficha ("358,74€" seguido de "Fecha de valor liquidativo:
//   24/08/2026"). Puede necesitar ajuste si Finect cambia el formato.
// - La resolución por ISIN depende de que DuckDuckGo indexe la ficha y de
//   que su HTML de resultados mantenga la forma actual (enlaces con
//   "uddg=" envolviendo la URL real, o directos). Es la pieza más frágil
//   de las dos — si falla, el campo de URL se puede seguir rellenando a
//   mano como hasta ahora.
//
// Respuesta: { url?, price, currency: "EUR", asOf, source: "finect" }

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

  // Precio: número con formato español (punto de miles, coma decimal)
  // inmediatamente seguido del símbolo de euro.
  const priceMatch = html.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*€/);
  if (!priceMatch) throw { status: 422, message: "No se encontró un precio en la página — puede que Finect haya cambiado el formato de la ficha." };
  const price = parseFloat(priceMatch[1].replace(/\./g, "").replace(",", "."));

  // Fecha del valor liquidativo, formato DD/MM/YYYY en el texto de la página.
  const dateMatch = html.match(/valor liquidativo[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{4})/i);
  const asOf = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  return { price, currency: "EUR", asOf };
}

// Extrae la primera URL de ficha de Finect para el ISIN dado a partir del
// HTML de resultados de DuckDuckGo. Los enlaces salen a veces envueltos en
// "//duckduckgo.com/l/?uddg=<url-codificada>&rut=..." y a veces directos —
// se contemplan los dos casos.
function extractFinectUrlFromDDG(html, isin) {
  const hrefRe = /href="([^"]+)"/g;
  const isinUpper = isin.toUpperCase();
  let m;
  while ((m = hrefRe.exec(html))) {
    let href = m[1];
    const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      try { href = decodeURIComponent(uddgMatch[1]); } catch (e) { continue; }
    }
    if (href.startsWith("//")) href = "https:" + href;
    if (/^https:\/\/(?:www\.)?finect\.com\/fondos-inversion\//i.test(href) && href.toUpperCase().includes(isinUpper)) {
      const cleaned = href.split("?")[0].split("&")[0];
      return cleaned.replace(/^https:\/\/finect\.com\//i, "https://www.finect.com/");
    }
  }
  return null;
}

async function resolveIsinViaDDG(isin) {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:finect.com ${isin}`)}`;
  const r = await fetch(ddgUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept-Language": "es-ES,es;q=0.9",
    },
  });
  if (!r.ok) throw { status: 502, message: `La búsqueda respondió ${r.status}` };
  const html = await r.text();
  const url = extractFinectUrlFromDDG(html, isin);
  if (!url) throw { status: 404, message: "No se encontró ficha en Finect para ese ISIN — prueba a buscarlo a mano." };
  return url;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { url, isin } = req.query;

  // Normaliza la URL pegada a mano: recorta espacios, admite http(s) y
  // con/sin "www.", y la reescribe a la forma canónica antes de usarla —
  // la validación anterior exigía exactamente "https://www.finect.com/…"
  // y rechazaba cualquier variante razonable que alguien pudiera pegar.
  function normalizeFinectUrl(raw) {
    const trimmed = String(raw).trim();
    const m = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?finect\.com\/fondos-inversion\/(.+)$/i);
    if (!m) return null;
    return `https://www.finect.com/fondos-inversion/${m[1]}`;
  }

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
      const resolvedUrl = await resolveIsinViaDDG(isin);
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
