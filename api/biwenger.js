// api/biwenger.js — Vercel serverless proxy for Biwenger API
// Proxies requests to biwenger.as.com/api/v2 with the user's credentials
// stored in TrackHub settings (userId, leagueId, version token).
//
// Usage: GET /api/biwenger?endpoint=user&userId=X&leagueId=Y&token=Z
//
// Supported endpoints:
//   user    → full team data (players, offers, saldo, market)
//   account → league account info (balance)

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { endpoint = "user", userId, leagueId, token } = req.query;

  if (!userId || !leagueId || !token) {
    return res.status(400).json({ error: "Missing userId, leagueId or token" });
  }

  // Build Biwenger API URL based on endpoint
  let url;
  if (endpoint === "user") {
    url = `https://biwenger.as.com/api/v2/user?fields=*,players(*,team,owner),market(*,-userID),offers,account`;
  } else if (endpoint === "account") {
    url = `https://biwenger.as.com/api/v2/account`;
  } else {
    return res.status(400).json({ error: `Unknown endpoint: ${endpoint}` });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-user":    userId,
        "x-league":  leagueId,
        "x-version": "2",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; TrackHub/1.0)",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: `Biwenger API error: ${response.status}`,
        detail: text.slice(0, 200),
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: "Proxy error", detail: err.message });
  }
}
