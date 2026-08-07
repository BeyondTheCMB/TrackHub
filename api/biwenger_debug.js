// api/biwenger_debug.js — temporary debug endpoint
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Fetch one player and the catalogue, return raw data
  try {
    // Player detail
    const playerRes = await fetch(
      "https://cf.biwenger.com/api/v2/players/la-liga/laporte?fields=*&lang=es",
      { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } }
    );
    const playerJson = await playerRes.json();

    // Catalogue - first team object
    const catRes = await fetch(
      "https://cf.biwenger.com/api/v2/competitions/la-liga/data?lang=es&score=2",
      { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } }
    );
    const catJson = await catRes.json();
    const teams = catJson?.data?.teams || {};
    const firstTeam = Object.values(teams)[0] || {};
    const firstPlayer = Object.values(catJson?.data?.players || {})[0] || {};

    return res.status(200).json({
      playerKeys: Object.keys(playerJson?.data || playerJson || {}),
      playerData: playerJson?.data || playerJson,
      firstTeamKeys: Object.keys(firstTeam),
      firstTeam,
      firstPlayerKeys: Object.keys(firstPlayer),
      firstPlayer,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
