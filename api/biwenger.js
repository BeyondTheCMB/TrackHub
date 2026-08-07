// api/biwenger.js — Vercel serverless proxy for Biwenger API

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { endpoint = "user", userId, leagueId, token, version } = req.query;

  if (!userId || !leagueId || !token || !version) {
    return res.status(400).json({ error: "Missing userId, leagueId, token or version" });
  }

  const cleanToken = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();

  const URLS = {
    user:    "https://biwenger.as.com/api/v2/user?fields=*,players(*,team,owner),offers,account",
    offers:  "https://biwenger.as.com/api/v2/user?fields=offers",
    account: "https://biwenger.as.com/api/v2/account",
    league:  `https://biwenger.as.com/api/v2/leagues/${leagueId}?fields=*,standings(*,user,team(*,players(*,team)))`,
  };

  const url = URLS[endpoint];
  if (!url) return res.status(400).json({ error: `Unknown endpoint: ${endpoint}` });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${cleanToken}`,
        "x-user":        String(userId),
        "x-league":      String(leagueId),
        "x-version":     String(version),
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      },
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error:  `Biwenger API returned ${response.status}`,
        detail: text.slice(0, 500),
        url,
        headers_sent: { userId, leagueId, version, tokenPreview: cleanToken.slice(0, 20) + "…" },
      });
    }

    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return res.status(200).send(text);
    }

  } catch (err) {
    return res.status(500).json({ error: "Proxy fetch error", detail: err.message });
  }
}
