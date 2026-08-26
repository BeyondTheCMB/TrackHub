// api/vesta-quotes.js — Vercel serverless proxy para leer el valor
// liquidativo de un fondo/ETF desde su ficha en Finect.
//
// Por qué un proxy: Finect no tiene API pública, y como cualquier página
// normal no manda cabeceras CORS — un fetch directo desde el navegador
// fallará siempre. Este endpoint hace el fetch en el servidor (sin
// restricción de CORS) y devuelve solo lo que necesitamos.
//
// La resolución automática de ISIN→ficha (vía búsqueda en DuckDuckGo) se
// probó y se retiró: DuckDuckGo bloquea de forma deliberada el tráfico
// desde IPs de centros de datos como las de Vercel/AWS (confirmado con la
// página de error real, no una suposición) — no es algo que un cambio de
// cabeceras o de endpoint pueda sortear. La resolución del ISIN a la URL
// de Finect se hace a mano en el cliente (botón 🔍 que abre una búsqueda
// de Google en el propio navegador del usuario, donde sí funciona).
//
// AVISO: la extracción del precio es una expresión regular sobre el HTML
// de la ficha, ajustada a lo que se ve en la página hoy ("358,74€" seguido
// de "Fecha de valor liquidativo: 24/08/2026"). No he podido probarla
// contra el HTML real y desplegado — trátala como primer borrador a
// validar, no como algo ya verificado end-to-end.
//
// Uso: GET /api/vesta-quotes?url=https://www.finect.com/fondos-inversion/ES0112611001-Azvalor_internacional_fi
// Respuesta: { price: 358.74, currency: "EUR", asOf: "2026-08-24", source: "finect" }

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

// Normaliza la URL pegada a mano: recorta espacios, admite http(s) y
// con/sin "www.", y con/sin protocolo — la validación estricta original
// ("https://www.finect.com/…" exacto) rechazaba variantes razonables.
function normalizeFinectUrl(raw) {
  const trimmed = String(raw).trim();
  const m = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?finect\.com\/fondos-inversion\/(.+)$/i);
  if (!m) return null;
  return `https://www.finect.com/fondos-inversion/${m[1]}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { url } = req.query;

  try {
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Falta el parámetro 'url'." });
    }
    const normalized = normalizeFinectUrl(url);
    if (!normalized) {
      return res.status(400).json({ error: "Parámetro 'url' inválido — debe ser una ficha de finect.com/fondos-inversion/…" });
    }
    const q = await fetchFinectPrice(normalized);
    return res.status(200).json({ ...q, source: "finect" });
  } catch (e) {
    const status = (e && e.status) || 500;
    const message = (e && e.message) || String(e);
    return res.status(status).json({ error: message });
  }
}
