// api/biwenger.js — Vercel serverless proxy for Biwenger API

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { userId, leagueId, token, version } = req.query;
  if (!userId || !leagueId || !token || !version) {
    return res.status(400).json({ error: "Missing userId, leagueId, token or version" });
  }

  const cleanToken = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();
  const authHeaders = {
    "Authorization": `Bearer ${cleanToken}`,
    "x-user":        String(userId),
    "x-league":      String(leagueId),
    "x-version":     String(version),
    "Content-Type":  "application/json",
    "Accept":        "application/json",
  };

  // ── Call 1: user team ─────────────────────────────────────────────────────
  let teamData;
  try {
    const teamRes = await fetch(
      "https://biwenger.as.com/api/v2/user?fields=*,players(*,team,owner),offers,account",
      { headers: authHeaders }
    );
    if (!teamRes.ok) {
      const text = await teamRes.text();
      return res.status(teamRes.status).json({ error: `Team API ${teamRes.status}`, detail: text.slice(0, 300) });
    }
    const json = await teamRes.json();
    teamData = json.data || json;
  } catch (err) {
    return res.status(500).json({ error: "Team fetch error", detail: err.message });
  }

  const myPlayers = teamData.players || [];
  const myOffers  = teamData.offers  || [];
  const balance   = teamData.balance  ?? 0;

  // ── Call 2: La Liga catalogue ─────────────────────────────────────────────
  let catalogue = {};
  try {
    const catRes = await fetch(
      "https://cf.biwenger.com/api/v2/competitions/la-liga/data?lang=es&score=2",
      { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } }
    );
    if (catRes.ok) {
      const catJson = await catRes.json();
      const players = catJson?.data?.players || {};
      const teams   = catJson?.data?.teams   || {};
      const POS_MAP = { 1: "POR", 2: "DEF", 3: "MC", 4: "DEL" };
      Object.values(players).forEach(p => {
        catalogue[p.id] = {
          name:           p.name || `Jugador ${p.id}`,
          slug:           p.slug || "",
          pos:            POS_MAP[p.position] || "MC",
          teamId:         p.teamID || null,
          teamSlug:       teams[p.teamID]?.slug || "",
          teamName:       teams[p.teamID]?.name || "",
          precio:         p.price || 0,
          priceIncrement: p.priceIncrement || 0,
        };
      });
    }
  } catch (e) { /* best-effort */ }

  // ── Offer map ─────────────────────────────────────────────────────────────
  const offerMap = {};
  myOffers.forEach(o => {
    if (o.type === "purchase" && o.status === "waiting" && o.requestedPlayers?.length) {
      const pid = o.requestedPlayers[0];
      if (!offerMap[pid] || o.amount > offerMap[pid]) offerMap[pid] = o.amount;
    }
  });

  // ── Join ──────────────────────────────────────────────────────────────────
  const enriched = myPlayers.map(p => {
    const cat    = catalogue[p.id] || {};
    const compra = p.owner?.price || 0;
    return {
      id:          p.id,
      nombre:      cat.name     || `Jugador ${p.id}`,
      slug:        cat.slug     || "",
      pos:         cat.pos      || "MC",
      equipo:      cat.teamName || "",
      teamSlug:    cat.teamSlug || "",
      precio:         cat.precio          || 0,
      priceIncrement: cat.priceIncrement  || 0,
      compra,
      oferta:      offerMap[p.id] || null,
      fechaCompra: p.owner?.date  || null,
    };
  });

  return res.status(200).json({
    status:        200,
    balance,
    players:       enriched,
    catalogueSize: Object.keys(catalogue).length,
  });
}
