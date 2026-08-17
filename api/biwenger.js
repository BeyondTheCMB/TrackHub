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
  const authHeaders = {
    "Authorization": `Bearer ${cleanToken}`,
    "x-user":        String(userId),
    "x-league":      String(leagueId),
    "x-version":     String(version),
    "Content-Type":  "application/json",
    "Accept":        "application/json",
  };

  // ── Market endpoint ───────────────────────────────────────────────────────
  if (endpoint === "market") {
    try {
      const marketRes = await fetch(
        "https://biwenger.as.com/api/v2/market",
        { headers: authHeaders }
      );
      if (!marketRes.ok) {
        const text = await marketRes.text();
        return res.status(marketRes.status).json({ error: `Market API ${marketRes.status}`, detail: text.slice(0, 500) });
      }
      const marketJson = await marketRes.json();

      // Fetch catalogue for names/positions/teams
      const catRes = await fetch(
        "https://cf.biwenger.com/api/v2/competitions/la-liga/data?lang=es&score=2",
        { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } }
      );
      const catJson    = await catRes.json();
      const catPlayers = catJson?.data?.players || {};
      const catTeams   = catJson?.data?.teams   || {};
      const POS_MAP    = { 1: "POR", 2: "DEF", 3: "MC", 4: "DEL" };

      // Parse — data can be array or object keyed by id
      const dataRaw = marketJson?.data;
      let listings = [];
      if (Array.isArray(dataRaw)) {
        listings = dataRaw;
      } else if (dataRaw && typeof dataRaw === "object") {
        listings = Object.values(dataRaw);
      }

      const enriched = listings.map(item => {
        const pid    = item.playerID || item.player?.id || item.id;
        const cat    = catPlayers[pid] || {};
        const price  = item.price || item.amount || item.player?.price || cat.price || 0;
        const seller = item.user?.name || item.seller?.name || item.owner?.name || "";
        return {
          id:            pid,
          nombre:        item.player?.name || cat.name || `Jugador ${pid}`,
          pos:           POS_MAP[item.player?.position || cat.position] || "MC",
          equipo:        catTeams[item.player?.teamID || cat.teamID]?.name || "",
          teamSlug:      catTeams[item.player?.teamID || cat.teamID]?.slug || "",
          precio:        price,
          precioMercado: cat.price || 0,
          vendedor:      seller,
        };
      }).filter(p => p.id);

      return res.status(200).json({
        status: 200,
        market: enriched,
        debug: { listingsCount: listings.length, rawSample: listings[0] || null }
      });
    } catch (err) {
      return res.status(500).json({ error: "Market fetch error", detail: err.message });
    }
  }

  // ── User team endpoint (default) ──────────────────────────────────────────
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

  // ── La Liga catalogue ─────────────────────────────────────────────────────
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
      id:             p.id,
      nombre:         cat.name     || `Jugador ${p.id}`,
      slug:           cat.slug     || "",
      pos:            cat.pos      || "MC",
      equipo:         cat.teamName || "",
      teamSlug:       cat.teamSlug || "",
      precio:         cat.precio   || 0,
      priceIncrement: cat.priceIncrement || 0,
      compra,
      oferta:         offerMap[p.id] || null,
      fechaCompra:    p.owner?.date  || null,
    };
  });

  return res.status(200).json({
    status:        200,
    balance,
    players:       enriched,
    catalogueSize: Object.keys(catalogue).length,
  });
}
