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

  try {
    // ── Call 1: user team (players owned + offers + balance) ─────────────────
    const teamRes = await fetch(
      "https://biwenger.as.com/api/v2/user?fields=*,players(*,team,owner),offers,account",
      {
        headers: {
          "Authorization": `Bearer ${cleanToken}`,
          "x-user":    String(userId),
          "x-league":  String(leagueId),
          "x-version": String(version),
          "Content-Type": "application/json",
          "Accept":    "application/json",
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

    const teamData = await teamRes.json();
    const myPlayers = teamData?.data?.players || [];
    const myOffers  = teamData?.data?.offers  || [];
    const balance   = teamData?.data?.balance  ?? 0;

    // ── Call 2: La Liga player catalogue (public, no auth needed) ─────────────
    const catRes = await fetch(
      "https://cf.biwenger.com/api/v2/competitions/la-liga/data?lang=es&score=2",
      { headers: { "Accept": "application/json" } }
    );

    let catalogue = {}; // id → { name, position, team, price, ... }
    if (catRes.ok) {
      const catData = await catRes.json();
      const players = catData?.data?.players || {};
      const teams   = catData?.data?.teams   || {};
      Object.values(players).forEach(p => {
        catalogue[p.id] = {
          id:       p.id,
          name:     p.name,
          slug:     p.slug,
          position: p.position,  // 1=POR 2=DEF 3=MC 4=DEL
          teamId:   p.teamID,
          teamName: teams[p.teamID]?.name || "",
          precio:   p.price || 0,  // current market value
        };
      });
    }

    // ── Build offer map: playerId → amount ────────────────────────────────────
    const offerMap = {};
    myOffers.forEach(o => {
      if (o.type === "purchase" && o.status === "waiting" && o.requestedPlayers?.length) {
        const pid = o.requestedPlayers[0];
        // Keep highest offer if multiple
        if (!offerMap[pid] || o.amount > offerMap[pid]) {
          offerMap[pid] = o.amount;
        }
      }
    });

    // ── Join: my players + catalogue + offers ─────────────────────────────────
    const POS_MAP = { 1: "POR", 2: "DEF", 3: "MC", 4: "DEL" };

    const enriched = myPlayers.map(p => {
      const cat    = catalogue[p.id] || {};
      const compra = p.owner?.price || 0;
      const precio = cat.precio || 0;
      return {
        id:       p.id,
        nombre:   cat.name  || `Jugador ${p.id}`,
        slug:     cat.slug  || "",
        pos:      POS_MAP[cat.position] || "MC",
        equipo:   cat.teamName || "",
        precio,            // current market value
        compra,            // what you paid
        oferta:   offerMap[p.id] || null,
        fechaCompra: p.owner?.date || null,
      };
    });

    return res.status(200).json({
      status: 200,
      balance,
      players: enriched,
      rawOffers: myOffers,
    });

  } catch (err) {
    return res.status(500).json({ error: "Proxy error", detail: err.message });
  }
}
