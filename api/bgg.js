// Vercel serverless function: BGG API proxy
// Token is passed per-request from the frontend (stored in user's Supabase config).
// No server-side env var needed — each user provides their own BGG token.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { path, token } = req.query;
  if (!path) { res.status(400).json({ error: "Missing path" }); return; }

  const BGG_BASE = "https://boardgamegeek.com/xmlapi2";
  const headers  = token ? { Authorization: `Bearer ${token}` } : {};
  const url      = path.startsWith("http") ? path : `${BGG_BASE}${path}`;

  try {
    let attempts = 0;
    while (attempts < 8) {
      const upstream = await fetch(url, { headers, redirect: "follow" });

      if (upstream.status === 202) {
        await new Promise(r => setTimeout(r, 2000));
        attempts++;
        continue;
      }

      if (!upstream.ok) {
        res.status(upstream.status).send(`BGG error: ${upstream.status}`);
        return;
      }

      const text = await upstream.text();
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.status(200).send(text);
      return;
    }
    res.status(504).send("BGG timeout after retries");
  } catch (e) {
    console.error("BGG proxy error:", e);
    res.status(500).send(e.message);
  }
}

