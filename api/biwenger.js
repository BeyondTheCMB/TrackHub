// api/biwenger_img.js — Image proxy for Biwenger CDN

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url");

  const allowed = ["cdn.biwenger.com", "cf.biwenger.com", "api.sofascore.com"];
  let parsed;
  try { parsed = new URL(decodeURIComponent(url)); } catch {
    return res.status(400).json({ error: "Invalid url" });
  }
  if (!allowed.some(d => parsed.hostname.endsWith(d))) {
    return res.status(403).json({ error: "Domain not allowed", hostname: parsed.hostname });
  }

  try {
    const imgRes = await fetch(decodeURIComponent(url), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":    "https://biwenger.as.com/",
        "Accept":     "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    const ct = imgRes.headers.get("content-type") || "";
    if (!imgRes.ok || ct.includes("text/html")) {
      return res.status(502).json({ error: "Not an image", status: imgRes.status, contentType: ct });
    }

    res.setHeader("Content-Type", ct || "image/avif");
    res.setHeader("Cache-Control", "public, max-age=604800");
    const buffer = await imgRes.arrayBuffer();
    return res.send(Buffer.from(buffer));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
