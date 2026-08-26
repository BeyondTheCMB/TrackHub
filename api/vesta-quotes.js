// api/vesta-quotes.js — Vercel serverless proxy para leer el valor
// liquidativo de un fondo/ETF desde su ficha en Finect.
//
// Por qué un proxy: Finect no tiene API pública, y como cualquier página
// normal no manda cabeceras CORS — un fetch directo desde el navegador
// fallará siempre. Este endpoint hace el fetch en el servidor (sin
// restricción de CORS) y devuelve solo lo que necesitamos.
//
// AVISO: la extracción del precio es una expresión regular sobre el HTML
// de la ficha, ajustada a lo que se ve en la página hoy ("358,74€" seguido
// de "Fecha de valor liquidativo: 24/08/2026"). No he podido probarla
// contra el HTML real y desplegado — es razonablemente probable que haga
// falta un ajuste fino la primera vez que se use de verdad contra el DOM
// real (nombres de clase, espacios, etc.), así que trátalo como primer
// borrador a validar, no como algo ya verificado end-to-end.
//
// Uso: GET /api/vesta-quotes?url=https://www.finect.com/fondos-inversion/ES0112611001-Azvalor_internacional_fi
// Respuesta: { price: 358.74, currency: "EUR", asOf: "2026-08-24", source: "finect" }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { url } = req.query;
  if (!url || typeof url !== "string" || !/^https:\/\/www\.finect\.com\/fondos-inversion\//.test(url)) {
    return res.status(400).json({ error: "Parámetro 'url' inválido — debe ser una ficha de finect.com/fondos-inversion/…" });
  }

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "es-ES,es;q=0.9",
      },
    });
    if (!r.ok) {
      return res.status(502).json({ error: `Finect respondió ${r.status}` });
    }
    const html = await r.text();

    // Precio: número con formato español (punto de miles, coma decimal)
    // inmediatamente seguido del símbolo de euro — es como aparece
    // publicado en la cabecera de la ficha del fondo.
    const priceMatch = html.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*€/);
    if (!priceMatch) {
      return res.status(422).json({ error: "No se encontró un precio en la página — puede que Finect haya cambiado el formato de la ficha." });
    }
    const price = parseFloat(priceMatch[1].replace(/\./g, "").replace(",", "."));

    // Fecha del valor liquidativo, formato DD/MM/YYYY en el texto de la
    // página ("Fecha de valor liquidativo: 24/08/2026").
    const dateMatch = html.match(/valor liquidativo[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{4})/i);
    const asOf = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

    res.status(200).json({ price, currency: "EUR", asOf, source: "finect" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
}
