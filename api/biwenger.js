// api/biwenger_img.js — Image proxy for Biwenger CDN

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, token } = req.query;
  if (!url) return res.status(400).send("Missing url");

  const allowed = ["cf.biwenger.com", "cdn.biwenger.com", "biwenger.as.com",
                   "media.api-sports.io", "sofascore.com", "img.sofascore.com"];
  let parsed;
  try { parsed = new URL(decodeURIComponent(url)); } catch { return res.status(400).send("Invalid url"); }
  if (!allowed.some(d => parsed.hostname.endsWith(d))) {
    return res.status(403).json({ error: "Domain not allowed", hostname: parsed.hostname });
  }

  const cleanToken = token
    ? (token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim())
    : null;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
    "Referer":    "https://biwenger.as.com/",
    "Accept":     "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9",
  };
  if (cleanToken) headers["Authorization"] = `Bearer ${cleanToken}`;

  try {
    // Step 1: HEAD request to follow redirects and find final URL
    let finalUrl = decodeURIComponent(url);
    const headRes = await fetch(finalUrl, { method: "GET", headers, redirect: "follow" });

    // If we got HTML back, the URL is wrong — return debug info
    const ct = headRes.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      // Try the redirected URL without auth (some CDNs serve images publicly after redirect)
      const finalLocation = headRes.url; // fetch follows redirects, headRes.url is the final URL
      if (finalLocation && finalLocation !== finalUrl) {
        const retryRes = await fetch(finalLocation, {
          headers: {
            "User-Agent": headers["User-Agent"],
            "Referer":    "https://biwenger.as.com/",
            "Accept":     headers["Accept"],
          }
        });
        const retryCt = retryRes.headers.get("content-type") || "";
        if (!retryCt.includes("text/html") && retryRes.ok) {
          res.setHeader("Content-Type", retryCt);
          res.setHeader("Cache-Control", "public, max-age=86400");
          const buf = await retryRes.arrayBuffer();
          return res.send(Buffer.from(buf));
        }
      }
      // Return debug info so we can see what's happening
      const body = await headRes.text();
      return res.status(502).json({
        error: "Got HTML instead of image",
        finalUrl: headRes.url,
        status: headRes.status,
        contentType: ct,
        bodyPreview: body.slice(0, 300),
      });
    }

    if (!headRes.ok) {
      return res.status(headRes.status).json({ error: `Upstream ${headRes.status}`, finalUrl: headRes.url });
    }

    res.setHeader("Content-Type", ct || "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buffer = await headRes.arrayBuffer();
    return res.send(Buffer.from(buffer));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
