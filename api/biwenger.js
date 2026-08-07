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

  // ── Call 1: user team ─────────────────────────────────────────────────────
  let teamData;
  try {
    const teamRes = await fetch(
      "https://biwenger.as.com/api/v2/user?fields=*,players(*,team,owner),offers,account",
      {
        headers: {
          "Authorization": `Bearer ${cleanToken}`,
          "x-user":        String(userId),
          "x-league":      String(leagueId),
          "x-version":     String(version),
          "Content-Type":  "application/json",
          "Accept":        "application/json",
        },
      }
    );
    if (!teamRes.ok) {
      const text = await teamRes.text();
      return res.status(teamRes.status).json({
        error: `Biwenger team API returned ${teamRes.status}`,
        detail: text.slice(0, 500),
      });
    }
    const json = await teamRes.json();
    teamData = json.data || json;
  } catch (err) {
    return res.status(500).json({ error: "Team fetch error", detail: err.message });
  }

  const myPlayers = teamData.players || [];
  const myOffers  = teamData.offers  || [];
  const balance   = teamData.balance  ?? 0;

  // ── Call 2: La Liga player catalogue (best-effort) ────────────────────────
  let catalogue = {};
  try {
    const catRes = await fetch(
      "https://cf.biwenger.com/api/v2/competitions/la-liga/data?lang=es&score=2",
      {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
      }
    );
    if (catRes.ok) {
      const catJson = await catRes.json();
      // Try both possible shapes
      const players = catJson?.data?.players || catJson?.players || {};
      const teams   = catJson?.data?.teams   || catJson?.teams   || {};
      const POS_MAP = { 1: "POR", 2: "DEF", 3: "MC", 4: "DEL" };
      Object.values(players).forEach(p => {
        catalogue[p.id] = {
          name:     p.name     || p.slug || `Jugador ${p.id}`,
          slug:     p.slug     || "",
          pos:      POS_MAP[p.position] || POS_MAP[p.positionID] || "MC",
          teamId:   p.teamID   || p.teamId || null,
          teamName: teams[p.teamID]?.name || teams[p.teamId]?.name || "",
          precio:   p.price    || p.marketValue || 0,
          // Image URLs derived from slug and teamId
          photoUrl: p.slug ? `https://cf.biwenger.com/api/v2/players/la-liga/${p.slug}/photo` : null,
          teamBadgeUrl: (p.teamID || p.teamId) ? `https://cdn.biwenger.com/img/teams/${p.teamID || p.teamId}.png` : null,
        };
      });
    }
  } catch (e) {
    // Catalogue failed — we'll still return players with IDs and purchase data
  }

  // ── Build offer map ────────────────────────────────────────────────────────
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
      id:           p.id,
      nombre:       cat.name        || p.name  || `Jugador ${p.id}`,
      slug:         cat.slug        || p.slug  || "",
      pos:          cat.pos         || "MC",
      equipo:       cat.teamName    || p.team?.name || "",
      precio:       cat.precio      || p.price || 0,
      compra,
      oferta:       offerMap[p.id]  || null,
      fechaCompra:  p.owner?.date   || null,
      photoUrl:     cat.photoUrl    || null,
      teamBadgeUrl: cat.teamBadgeUrl|| null,
    };
  });

  return res.status(200).json({
    status:       200,
    balance,
    players:      enriched,
    catalogueSize: Object.keys(catalogue).length,  // debug: 0 means catalogue failed
  });
}
