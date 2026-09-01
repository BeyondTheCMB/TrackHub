// modules/biwengerlog.js — BiwengerLog (Fantasy Biwenger simulator).
// Extraído de index.html para no seguir creciendo un único archivo de
// ~20k líneas. Cargado desde index.html vía
// <script type="text/babel" src="modules/biwengerlog.js"></script>, en el
// mismo <script type="text/babel"> global que el resto de TrackHub — sin
// build step, así que top-level const/function siguen siendo visibles para
// el resto de la app exactamente igual que antes (los script tags clásicos
// comparten el mismo scope léxico de nivel superior en el navegador).
// No cambia ninguna lógica, es un corte literal del bloque que ya estaba
// aquí.

    // ─── BiwengerLog module ───────────────────────────────────────────────────
    const BW_A = "#34d399"; // emerald
    const BW_B = "#60a5fa"; // blue

    const BW_POS_ORDER = { POR: 0, DEF: 1, MC: 2, DEL: 3 };
    const BW_POS_COLOR = { POR: "#facc15", DEF: "#60a5fa", MC: "#34d399", DEL: "#f87171" };
    const BW_POS_ES    = { Portero: "POR", Defensa: "DEF", Centrocampista: "MC", Delantero: "DEL" };

    // puja máxima formula confirmed from real data
    const bwPuja = (saldo, valorEquipo) => saldo + valorEquipo * 0.25;

    const bwFmt = (n) => {
      if (n == null) return "—";
      const abs = Math.abs(n);
      const s = abs >= 1_000_000
        ? (abs / 1_000_000).toFixed(2).replace(".", ",") + "M €"
        : abs.toLocaleString("es-ES") + " €";
      return n < 0 ? "-" + s : s;
    };

    const bwPct = (n, ref) => ref ? ((n - ref) / ref * 100).toFixed(1) : null;

    // ── Probabilidad de jugar (FutbolFantasy, centralizado) ────────────────────
    // Colores del badge de probabilidad: mismo criterio de tres bandas que el
    // resto de indicadores de riesgo de la app (verde/ámbar/rojo).
    const bwProbColor = (prob) => prob >= 70 ? "#34d399" : prob >= 40 ? "#f59e0b" : "#f87171";

    // Normaliza un nombre para comparar entre fuentes (Biwenger vs
    // FutbolFantasy no siempre usan el mismo nombre para el mismo
    // jugador — apodo corto vs nombre completo): sin acentos, minúsculas,
    // sin puntuación, espacios colapsados.
    const bwNormName = (s) => (s || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[.'’-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Empareja un jugador de Biwenger con su ficha de FutbolFantasy dentro
    // del mismo equipo (teamSlug ya coincide entre ambas fuentes — ver
    // BW_SOFASCORE_TEAMS más abajo). Con el candidato acotado a ~20-25
    // jugadores de un solo equipo, una coincidencia por inclusión de
    // substring (en cualquier dirección, ya que Biwenger a veces solo
    // muestra el apodo y FutbolFantasy el nombre completo, o viceversa)
    // es suficientemente fiable sin necesitar fuzzy-matching real.
    const bwMatchProb = (nombreBiwenger, candidatos) => {
      if (!candidatos || candidatos.length === 0) return null;
      const target = bwNormName(nombreBiwenger);
      if (!target) return null;
      let exact = candidatos.find(c => bwNormName(c.nombre) === target);
      if (exact) return exact;
      const bySubstring = candidatos.filter(c => {
        const n = bwNormName(c.nombre);
        return n.includes(target) || target.includes(n);
      });
      if (bySubstring.length > 0) return bySubstring[0];
      // Último recurso: coincidencia por última palabra (apellido más
      // habitual como apodo corto en Biwenger).
      const lastWord = target.split(" ").slice(-1)[0];
      if (lastWord && lastWord.length > 2) {
        const byLast = candidatos.find(c => bwNormName(c.nombre).split(" ").includes(lastWord));
        if (byLast) return byLast;
      }
      return null;
    };

    // Descarga las probabilidades de los 20 equipos de LaLiga de una vez
    // (modo centralizado del proxy) y las empareja con la plantilla dada.
    // Devuelve la MISMA lista de jugadores con el campo `prob` añadido —
    // un único objeto de salida, para respetar el patrón de bulk-update
    // de toda la app (evita el bug de closures obsoletas de actualizar
    // jugador a jugador con setState en bucle). También devuelve `teams`
    // (los datos crudos por equipo) para poder emparejar jugadores que NO
    // están en la plantilla propia — p.ej. el mercado — sin tener que
    // volver a golpear el proxy.
    const bwFetchProbabilities = async (players) => {
      const res = await fetch("/api/futbolfantasy?all=1");
      const d = await res.json();
      if (!d.teams) throw new Error(d.error || "Respuesta inesperada del proxy de FutbolFantasy.");
      const next = players.map(p => {
        const teamData = p.teamSlug ? d.teams[p.teamSlug] : null;
        const match = teamData ? bwMatchProb(p.nombre, teamData.players) : null;
        return match ? { ...p, prob: match.prob, probAsOf: d.asOf } : p;
      });
      return { players: next, errors: d.errors || [], asOf: d.asOf, teams: d.teams };
    };

    // ── Supabase helpers ──────────────────────────────────────────────────────
    const bwLoad = async (profileId) => {
      const { data, error } = await _sb.from("bw_data").select("data")
        .eq("user_id", _sbUser.id).eq("profile_id", profileId || "default").maybeSingle();
      if (error) console.error("[BiwengerLog] load:", error.message);
      return data?.data ?? { players: [], saldo: 0, settings: {} };
    };
    const bwSave = async (profileId, val) => {
      const { error } = await _sb.from("bw_data").upsert(
        { user_id: _sbUser.id, profile_id: profileId || "default", data: val },
        { onConflict: "user_id,profile_id" }
      );
      if (error) console.error("[BiwengerLog] save:", error.message);
    };

    // ── Biwenger API fetch via proxy ──────────────────────────────────────────
    const bwFetchTeam = async (settings) => {
      const userId   = (settings.userId   || "").trim();
      const leagueId = (settings.leagueId || "").trim();
      const token    = (settings.token    || "").trim();
      const version  = (settings.version  || "").trim();
      if (!userId || !leagueId || !token || !version) throw new Error("Faltan credenciales (userId, leagueId, token, x-version)");
      const res = await fetch(`/api/biwenger?endpoint=user&userId=${encodeURIComponent(userId)}&leagueId=${encodeURIComponent(leagueId)}&token=${encodeURIComponent(token)}&version=${encodeURIComponent(version)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `API error ${res.status}`);
      }
      return res.json();
    };

    // Parse Biwenger CSV (raw export format)
    const bwParseCSV = (text) => {
      const lines = text.trim().split("\n").filter(Boolean);
      if (lines.length < 2) return [];
      const header = lines[0].replace(/^\uFEFF/, "").split(";").map(s => s.trim());
      return lines.slice(1).map(line => {
        const cols = line.split(";").map(s => s.trim());
        const row = {};
        header.forEach((h, i) => { row[h] = cols[i] || ""; });
        return row;
      }).filter(r => r.Jugador);
    };

    // ── Position badge ────────────────────────────────────────────────────────
    const BwPosBadge = ({ pos }) => (
      <span style={{ fontSize: 10, fontWeight: 700, color: BW_POS_COLOR[pos] || "#9aaabb", background: (BW_POS_COLOR[pos] || "#9aaabb") + "22", border: `1px solid ${(BW_POS_COLOR[pos] || "#9aaabb")}44`, borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>{pos}</span>
    );

    // ── Badge de probabilidad de jugar ──────────────────────────────────────
    const BwProbBadge = ({ prob, style }) => {
      if (prob == null) return null;
      const color = bwProbColor(prob);
      return (
        <span style={{ fontSize: 10, fontWeight: 700, color, background: color + "1a", border: `1px solid ${color}44`, borderRadius: 5, padding: "1px 5px", flexShrink: 0, ...style }}
          title="Probabilidad de ser titular la próxima jornada (FutbolFantasy)">
          {prob}%
        </span>
      );
    };

    // ── Delta chip ────────────────────────────────────────────────────────────
    const BwDelta = ({ value, style }) => {
      if (!value) return null;
      const pos = value >= 0;
      return (
        <span style={{ fontSize: 11, color: pos ? "#34d399" : "#f87171", fontWeight: 600, ...style }}>
          {pos ? "▲" : "▼"} {bwFmt(Math.abs(value))}
        </span>
      );
    };

    // ── Summary bar ───────────────────────────────────────────────────────────
    function BwSummaryBar({ saldo, valorEquipo, highlight }) {
      const puja = bwPuja(saldo, valorEquipo);
      const stats = [
        { label: "Valor equipo", value: valorEquipo, color: BW_B },
        { label: "Saldo",        value: saldo,        color: saldo >= 0 ? BW_A : "#f87171" },
        { label: "Puja máxima",  value: puja,         color: BW_A, bold: true },
      ];
      return (
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #0d1825", background: "#080f18", flexWrap: "wrap" }}>
          {stats.map(s => (
            <div key={s.label} style={{ flex: 1, minWidth: 120, padding: "12px 20px", borderRight: "1px solid #0d1825", position: "relative", background: highlight && s.label === "Puja máxima" ? BW_A + "0a" : "transparent" }}>
              <div style={{ fontSize: 11, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: s.bold ? 20 : 17, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{bwFmt(s.value)}</div>
            </div>
          ))}
        </div>
      );
    }

    // ── Plantilla tab ─────────────────────────────────────────────────────────
    // Player photo URL from Biwenger CDN (player id based)
    const bwPlayerPhoto = (id) =>
      `/api/biwenger_img?url=${encodeURIComponent(`https://cdn.biwenger.com/cdn-cgi/image/f=avif/i/p/${id}.png`)}`;

    // Team badge via Sofascore (public CDN, no auth needed)
    const BW_SOFASCORE_TEAMS = {
      "athletic":     "95",   "atletico":     "45",  "barcelona":   "2817",
      "betis":        "94",   "celta":        "2819","espanyol":    "728",
      "getafe":       "3837", "girona":       "11906","granada":    "536",
      "las-palmas":   "6577", "leganes":      "798", "mallorca":    "816",
      "osasuna":      "952",  "rayo-vallecano":"2836","real-madrid": "2829",
      "real-sociedad":"681",  "sevilla":      "2833","valencia":    "2828",
      "valladolid":   "969",  "villarreal":   "2825","alaves":      "2821",
      "almeria":      "553",  "cadiz":        "2818","elche":       "2820",
    };

    const bwTeamBadge = (slug) => {
      const id = BW_SOFASCORE_TEAMS[slug];
      return id ? `/api/biwenger_img?url=${encodeURIComponent(`https://api.sofascore.com/api/v1/team/${id}/image`)}` : null;
    };

    // Player avatar — photo with initials fallback
    const BwAvatar = ({ id, nombre, pos, size = 44 }) => {
      const [imgOk, setImgOk] = React.useState(true);
      const color    = BW_POS_COLOR[pos] || "#9aaabb";
      const initials = (nombre || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
      const radius   = Math.round(size * 0.2);
      return (
        <div style={{ width: size, height: size, borderRadius: radius, overflow: "hidden", flexShrink: 0, background: color + "22", border: `1px solid ${color}44`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {id && imgOk
            ? <img src={bwPlayerPhoto(id)} alt={nombre}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={() => setImgOk(false)} />
            : <span style={{ fontSize: size * 0.35, fontWeight: 700, color, fontFamily: "'DM Sans',sans-serif" }}>{initials}</span>
          }
        </div>
      );
    };

    function BwPlantilla({ players, onOfferChange, onCompraChange, token, lineup, onLineupSave }) {
      const [sortBy,     setSortBy]     = useState("pos");
      const [search,     setSearch]     = useState("");
      const [editOffer,  setEditOffer]  = useState(null);
      const [editCompra, setEditCompra] = useState(null);

      const sorted = useMemo(() => {
        let list = [...players];
        if (search.trim()) {
          const q = search.toLowerCase();
          list = list.filter(p => p.nombre?.toLowerCase().includes(q) || p.equipo?.toLowerCase().includes(q));
        }
        if (sortBy === "pos")    list.sort((a, b) => (BW_POS_ORDER[a.pos] ?? 9) - (BW_POS_ORDER[b.pos] ?? 9) || a.nombre.localeCompare(b.nombre));
        if (sortBy === "valor")  list.sort((a, b) => b.precio - a.precio);
        if (sortBy === "oferta") list.sort((a, b) => (b.oferta || 0) - (a.oferta || 0));
        if (sortBy === "ganancia") list.sort((a, b) => ((b.oferta || b.precio) - b.compra) - ((a.oferta || a.precio) - a.compra));
        return list;
      }, [players, sortBy, search]);

      const inp = { background: "#080f18", border: "1px solid #1a2535", borderRadius: 7, padding: "6px 10px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" };

      return (
        <>
        <div style={{ display: "flex", gap: 0, alignItems: "flex-start", padding: "16px 20px 60px" }}>
          {/* Left: filter + player list */}
          <div style={{ flex: 1, minWidth: 0, marginRight: 20 }}>
            {/* Filter bar */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar jugador…"
                style={{ ...inp, flex: 1, minWidth: 140 }}
                onFocus={e => e.target.style.borderColor = BW_A + "66"} onBlur={e => e.target.style.borderColor = "#1a2535"} />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="pos">Posición</option>
                <option value="valor">Valor ↓</option>
                <option value="oferta">Oferta ↓</option>
                <option value="ganancia">Ganancia ↓</option>
              </select>
            </div>

            {/* Player list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sorted.map(p => {
                const ganancia = (p.oferta || p.precio) - p.compra;
                const isEditing = editOffer === p.id;
                return (
                  <div key={p.id} style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, padding: "11px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <BwAvatar id={p.id} nombre={p.nombre} pos={p.pos} size={44} />
                      <BwPosBadge pos={p.pos} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{p.nombre}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                          {p.teamSlug && bwTeamBadge(p.teamSlug) && (
                            <img src={bwTeamBadge(p.teamSlug)} alt={p.equipo}
                              style={{ width: 14, height: 14, objectFit: "contain" }}
                              onError={e => e.target.style.display = "none"} />
                          )}
                          <span style={{ fontSize: 11, color: "#7a90a8" }}>{p.equipo}</span>
                          <BwProbBadge prob={p.prob} />
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 13, color: "#c8d8e8", fontVariantNumeric: "tabular-nums" }}>{bwFmt(p.precio)}</div>
                        {editCompra === p.id ? (
                          <input type="number" min="0" defaultValue={p.compra || ""}
                            autoFocus
                            style={{ ...inp, width: 120, fontSize: 11, padding: "3px 8px" }}
                            onFocus={e => e.target.style.borderColor = BW_A + "66"} onBlur={e => e.target.style.borderColor = "#1a2535"}
                            onKeyDown={e => {
                              if (e.key === "Enter") { onCompraChange(p.id, Number(e.target.value)); setEditCompra(null); }
                              if (e.key === "Escape") setEditCompra(null);
                            }}
                            onBlur={e => { onCompraChange(p.id, Number(e.target.value)); setEditCompra(null); }} />
                        ) : (
                          <button onClick={() => setEditCompra(p.id)}
                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "right" }}
                            title="Editar precio de compra">
                            <div style={{ fontSize: 10, color: "#5a7080" }}>comprado: <span style={{ textDecoration: "underline dotted", color: "#7a90a8" }}>{bwFmt(p.compra)}</span></div>
                          </button>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, minWidth: 80 }}>
                        <BwDelta value={ganancia} />
                      </div>
                    </div>
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #0d1825", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11, color: "#7a90a8", flexShrink: 0 }}>Oferta recibida:</span>
                      {isEditing ? (
                        <input type="number" min="0" defaultValue={p.oferta || ""}
                          autoFocus
                          style={{ ...inp, width: 140, fontSize: 12 }}
                          onFocus={e => e.target.style.borderColor = BW_A + "66"}
                          onKeyDown={e => {
                            if (e.key === "Enter")  { onOfferChange(p.id, Number(e.target.value)); setEditOffer(null); }
                            if (e.key === "Escape") setEditOffer(null);
                          }}
                          onBlur={e => { onOfferChange(p.id, Number(e.target.value)); setEditOffer(null); }} />
                      ) : (
                        <button onClick={() => setEditOffer(p.id)}
                          style={{ background: p.oferta ? BW_A + "18" : "transparent", border: `1px solid ${p.oferta ? BW_A + "44" : "#1a2535"}`, borderRadius: 7, padding: "4px 12px", cursor: "pointer", color: p.oferta ? BW_A : "#5a7080", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                          {p.oferta ? bwFmt(p.oferta) : "+ Añadir oferta"}
                        </button>
                      )}
                      {p.oferta && !isEditing && (
                        <BwDelta value={p.oferta - p.precio} style={{ marginLeft: 4 }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Mi Once pitch */}
          <div style={{ width: 750, flexShrink: 0, position: "sticky", top: 16 }}>
            <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>
              Mi Once
            </div>
            <BwPitch players={players} savedLineup={lineup} onSaveLineup={onLineupSave} />
          </div>
        </div>
        </>
      );
    }

    // ── Simular tab ───────────────────────────────────────────────────────────
    // ── Tactical pitch ────────────────────────────────────────────────────────
    const BW_FORMATIONS = {
      "3-4-3": [[1],[3],[4],[3]],
      "3-5-2": [[1],[3],[5],[2]],
      "3-6-1": [[1],[3],[6],[1]],
      "3-3-4": [[1],[3],[3],[4]],
      "3-2-5": [[1],[3],[2],[5]],
      "4-3-3": [[1],[4],[3],[3]],
      "4-4-2": [[1],[4],[4],[2]],
      "4-5-1": [[1],[4],[5],[1]],
      "4-2-4": [[1],[4],[2],[4]],
      "4-6-0": [[1],[4],[6],[0]],
      "5-3-2": [[1],[5],[3],[2]],
      "5-4-1": [[1],[5],[4],[1]],
      "5-2-3": [[1],[5],[2],[3]],
      "5-1-4": [[1],[5],[1],[4]],
    };

    function BwPitch({ players, sellIds = new Set(), buys = [], savedLineup, onSaveLineup, readOnly }) {
      const initFormation = savedLineup?.formation || "4-3-3";
      const initSlotMap   = savedLineup?.slotMap   || {};

      const [formation,  setFormation]  = useState(initFormation);
      const [slotMap,    setSlotMap]    = useState(initSlotMap);
      const [dragging,   setDragging]   = useState(null);
      const [dragTarget, setDragTarget] = useState(null);
      const [pitchSize,  setPitchSize]  = useState(savedLineup?.pitchSize || "medium");
      const [pickerSlot, setPickerSlot] = useState(null); // slotKey of open picker

      // Map line index → accepted positions
      const linePosMap = (li, totalLines) => {
        if (li === 0) return ["POR"];
        if (li === totalLines - 1) return ["DEL"];
        if (li === 1) return ["DEF"];
        return ["MC", "DEF", "DEL"]; // intermediate lines = midfield (flexible)
      };

      const PITCH_SIZES = {
        small:    180,
        medium:   260,
        large:    360,
        "x-large": 480,
      };
      const pitchH = PITCH_SIZES[pitchSize] || 260;

      // Sync from saved lineup when it loads
      useEffect(() => {
        if (savedLineup) {
          setFormation(savedLineup.formation || "4-3-3");
          setSlotMap(savedLineup.slotMap || {});
          if (savedLineup.pitchSize) setPitchSize(savedLineup.pitchSize);
        }
      }, [savedLineup]);

      const lines = BW_FORMATIONS[formation] || BW_FORMATIONS["4-3-3"];

      const allSlots = [];
      lines.forEach((line, li) => {
        for (let si = 0; si < line[0]; si++) allSlots.push(`${li}-${si}`);
      });

      // Drop slots that no longer exist when formation changes
      useEffect(() => {
        setSlotMap(prev => {
          const next = {};
          allSlots.forEach(k => { if (prev[k]) next[k] = prev[k]; });
          return next;
        });
      }, [formation]);

      const availablePlayers = useMemo(() => {
        const kept  = players.filter(p => !sellIds.has(p.id));
        const buyPs = buys.map(b => ({ ...b, pos: "?", isBuy: true }));
        return [...kept, ...buyPs];
      }, [players, sellIds, buys]);

      const assignSlot = (slotKey, playerId) => {
        if (readOnly) return;
        setSlotMap(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(k => { if (next[k] === playerId) delete next[k]; });
          if (playerId) next[slotKey] = playerId;
          else delete next[slotKey];
          return next;
        });
      };

      const handleDrop = (slotKey) => {
        if (dragging) assignSlot(slotKey, dragging);
        setDragging(null); setDragTarget(null);
      };

      const handleFormationChange = (f) => {
        setFormation(f);
      };

      const save = () => { if (onSaveLineup) onSaveLineup({ formation, slotMap, pitchSize }); };

      const usedIds   = new Set(Object.values(slotMap));
      const bench     = availablePlayers.filter(p => !usedIds.has(p.id));
      const totalLines = lines.length;

      const SlotCircle = ({ slotKey, lineIdx }) => {
        const pid      = slotMap[slotKey];
        const player   = pid ? availablePlayers.find(p => p.id === pid) : null;
        const over     = dragTarget === slotKey;
        const posColor = player ? (BW_POS_COLOR[player.pos] || "#9aaabb") : "#2a4060";
        const isPickerOpen = pickerSlot === slotKey;

        const handlePlusClick = () => {
          if (readOnly) return;
          setPickerSlot(isPickerOpen ? null : slotKey);
        };

        // Accepted positions for this line
        const accepted = linePosMap(lineIdx, totalLines);
        const eligible = bench.filter(p => accepted.includes(p.pos) || p.pos === "?" );

        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 54, position: "relative" }}>
            <div style={{ position: "relative", width: 44, height: 44 }}>
              <div onDragOver={e => { e.preventDefault(); setDragTarget(slotKey); }}
                onDragLeave={() => setDragTarget(null)}
                onDrop={() => handleDrop(slotKey)}
                onClick={() => player && !readOnly ? assignSlot(slotKey, null) : !player && handlePlusClick()}
                style={{ width: 44, height: 44, borderRadius: "50%", background: player ? posColor + "33" : over ? BW_A + "33" : "#00000044", border: `2px solid ${player ? posColor : over ? BW_A : "#ffffff22"}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", transition: "all 0.15s", cursor: readOnly ? "default" : "pointer" }}>
                {player
                  ? (player.isBuy
                      ? <span style={{ fontSize: 10, color: BW_B, fontWeight: 700 }}>{player.nombre.slice(0,3).toUpperCase()}</span>
                      : <img src={bwPlayerPhoto(player.id)} alt={player.nombre} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => e.target.style.display="none"} />)
                  : <span style={{ fontSize: 18, color: over ? BW_A : isPickerOpen ? BW_A : "#ffffff44" }}>+</span>
                }
              </div>
              {player && player.prob != null && (
                <div style={{ position: "absolute", bottom: -3, right: -3, background: "#060d14", border: `1px solid ${bwProbColor(player.prob)}`, borderRadius: 4, padding: "0 3px", fontSize: 8, fontWeight: 800, lineHeight: "12px", minWidth: 16, textAlign: "center", color: bwProbColor(player.prob) }}>
                  {player.prob}%
                </div>
              )}
            </div>
            <span style={{ fontSize: 10, color: player ? "#e2e8f0" : "#ffffff33", fontWeight: 600, maxWidth: 54, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center", textShadow: "0 1px 3px #000" }}>
              {player ? player.nombre.split(" ").slice(-1)[0] : ""}
            </span>

            {/* Position-filtered picker dropdown */}
            {isPickerOpen && !readOnly && (
              <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", zIndex: 100, background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, minWidth: 180, maxHeight: 220, overflowY: "auto", boxShadow: "0 16px 40px rgba(0,0,0,0.8)", marginTop: 4 }}
                onClick={e => e.stopPropagation()}>
                <div style={{ padding: "6px 10px 4px", fontSize: 10, color: "#5a7080", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid #0d1825" }}>
                  {accepted.join(" / ")}
                </div>
                {eligible.length === 0
                  ? <div style={{ padding: "10px 12px", fontSize: 12, color: "#5a7080" }}>Sin jugadores disponibles</div>
                  : eligible.map(p => (
                      <button key={p.id} onClick={() => { assignSlot(slotKey, p.id); setPickerSlot(null); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#1a2535"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ width: 24, height: 24, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                          <img src={bwPlayerPhoto(p.id)} alt={p.nombre} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => e.target.style.display="none"} />
                        </div>
                        <BwPosBadge pos={p.pos} />
                        <span style={{ fontSize: 12, color: "#c8d8e8" }}>{p.nombre}</span>
                      </button>
                    ))
                }
              </div>
            )}
          </div>
        );
      };

      return (
        <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 12, overflow: "hidden" }}>
          {/* Formation pills + size selector */}
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, flexShrink: 0 }}>Formación</span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
              {Object.keys(BW_FORMATIONS).map(f => (
                <button key={f} onClick={() => !readOnly && handleFormationChange(f)}
                  style={{ padding: "3px 9px", borderRadius: 6, border: `1px solid ${formation === f ? BW_A : "#1a2535"}`, background: formation === f ? BW_A + "22" : "transparent", color: formation === f ? BW_A : "#7a90a8", cursor: readOnly ? "default" : "pointer", fontSize: 11, fontWeight: formation === f ? 700 : 400 }}>
                  {f}
                </button>
              ))}
            </div>
            {/* Size selector */}
            <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
              {[["S","small"],["M","medium"],["L","large"],["XL","x-large"]].map(([label, val]) => (
                <button key={val} onClick={() => setPitchSize(val)}
                  style={{ padding: "3px 7px", borderRadius: 6, border: `1px solid ${pitchSize === val ? BW_B : "#1a2535"}`, background: pitchSize === val ? BW_B + "22" : "transparent", color: pitchSize === val ? BW_B : "#5a7080", cursor: "pointer", fontSize: 11, fontWeight: pitchSize === val ? 700 : 400 }}>
                  {label}
                </button>
              ))}
            </div>
            {!readOnly && onSaveLineup && (
              <button onClick={save}
                style={{ background: BW_A, color: "#0f172a", border: "none", borderRadius: 7, padding: "5px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                Guardar
              </button>
            )}
          </div>

          {/* Pitch */}
          <div style={{ position: "relative", width: "100%", height: pitchH, background: "linear-gradient(180deg, #0f3318 0%, #134020 25%, #0f3318 50%, #134020 75%, #0f3318 100%)" }}>
            {/* Field markings */}
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.25 }} viewBox="0 0 68 105" preserveAspectRatio="none">
              <rect x="1" y="1" width="66" height="103" fill="none" stroke="white" strokeWidth="0.5"/>
              <line x1="1" y1="52.5" x2="67" y2="52.5" stroke="white" strokeWidth="0.5"/>
              <circle cx="34" cy="52.5" r="9.15" fill="none" stroke="white" strokeWidth="0.5"/>
              <circle cx="34" cy="52.5" r="0.5" fill="white"/>
              {/* Top penalty area */}
              <rect x="13.84" y="1" width="40.32" height="16.5" fill="none" stroke="white" strokeWidth="0.5"/>
              <rect x="24.84" y="1" width="18.32" height="5.5" fill="none" stroke="white" strokeWidth="0.5"/>
              {/* Bottom penalty area */}
              <rect x="13.84" y="87.5" width="40.32" height="16.5" fill="none" stroke="white" strokeWidth="0.5"/>
              <rect x="24.84" y="98.5" width="18.32" height="5.5" fill="none" stroke="white" strokeWidth="0.5"/>
            </svg>

            {/* Player lines — absolute positioned */}
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-around", padding: "6% 4%" }}
              onClick={() => setPickerSlot(null)}>
              {[...lines].reverse().map((line, ri) => {
                const li = lines.length - 1 - ri;
                if (line[0] === 0) return null;
                return (
                  <div key={li} style={{ display: "flex", justifyContent: "space-evenly", alignItems: "center" }}>
                    {Array.from({ length: line[0] }).map((_, si) => (
                      <SlotCircle key={si} slotKey={`${li}-${si}`} lineIdx={li} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bench */}
          {!readOnly && (
            <div style={{ padding: "10px 14px", borderTop: "1px solid #0d1825" }}>
              <div style={{ fontSize: 11, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 700 }}>
                Banquillo — arrastra al campo
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {bench.map(p => (
                  <div key={p.id} draggable
                    onDragStart={() => setDragging(p.id)}
                    onDragEnd={() => { setDragging(null); setDragTarget(null); }}
                    style={{ display: "flex", alignItems: "stretch", background: p.isBuy ? BW_B + "18" : "#080f18", border: `1px solid ${p.isBuy ? BW_B + "44" : "#1a2535"}`, borderRadius: 20, overflow: "hidden", cursor: "grab", opacity: dragging === p.id ? 0.4 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px 4px 4px" }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                        {p.isBuy
                          ? <div style={{ width: "100%", height: "100%", background: BW_B + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: BW_B, fontWeight: 700 }}>NEW</div>
                          : <img src={bwPlayerPhoto(p.id)} alt={p.nombre} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => e.target.style.display="none"} />
                        }
                      </div>
                      <BwPosBadge pos={p.pos} />
                      <span style={{ fontSize: 11, color: "#c8d8e8" }}>{p.nombre.split(" ").slice(-1)[0]}</span>
                    </div>
                    {p.prob != null && (
                      <div style={{ background: bwProbColor(p.prob), color: "#060d14", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", fontSize: 15, fontWeight: 900, flexShrink: 0 }}
                        title="Probabilidad de ser titular la próxima jornada (FutbolFantasy)">
                        {p.prob}%
                      </div>
                    )}
                  </div>
                ))}
                {bench.length === 0 && <span style={{ fontSize: 12, color: "#3a5060" }}>Todos colocados ✓</span>}
              </div>
            </div>
          )}
        </div>
      );
    }

    function BwSimular({ players, saldo, valorEquipo, token, savedLineup, settings, ffData }) {
      const [sellIds,      setSellIds]      = useState(new Set());
      const [targets,      setTargets]      = useState([]); // buy targets — for checking only
      const [newBuyName,   setNewBuyName]   = useState("");
      const [newBuyPrice,  setNewBuyPrice]  = useState("");
      const [marketData,   setMarketData]   = useState(null);
      const [marketSearch, setMarketSearch] = useState("");
      const [marketFilter, setMarketFilter] = useState("all"); // all | biwenger | others | own
      const isMob = useIsMobile();

      const toggleSell = (id) => setSellIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });

      const addTarget = () => {
        if (!newBuyName.trim() || !newBuyPrice) return;
        setTargets(t => [...t, { id: "tgt_" + Date.now(), nombre: newBuyName.trim(), precio: Number(newBuyPrice) }]);
        setNewBuyName(""); setNewBuyPrice("");
      };
      const removeTarget = (id) => setTargets(t => t.filter(x => x.id !== id));
      const addFromMarket = (p) => {
        if (targets.find(t => t.marketId === p.id)) return;
        setTargets(t => [...t, { id: "tgt_" + Date.now(), marketId: p.id, nombre: p.nombre, precio: p.precio, pos: p.pos, prob: p.prob ?? null }]);
      };

      // ── Simulation ──────────────────────────────────────────────────────────
      // Ventas: efecto inmediato. El jugador sale de tu plantilla al instante,
      // así que tanto el saldo (+oferta) como el valor de equipo (-precio) se
      // actualizan ya para el cálculo de la puja máxima.
      //
      // Compras: efecto inmediato solo en el saldo (el dinero queda
      // comprometido), pero NO en el valor de equipo. El valor de equipo de
      // Biwenger solo se recalcula cuando el jugador pasa a ser tuyo de verdad
      // (cierre de mercado / resolución de la puja) — no en el momento de
      // ofertar. Por eso "hoy" el valor de equipo no sube por tus propias
      // compras, y la puja máxima disponible hoy solo baja por el efectivo que
      // vas comprometiendo, no crece con lo que aún no es tuyo.
      const simSaldoTrasVentas = useMemo(() => {
        let s = saldo;
        players.forEach(p => { if (sellIds.has(p.id)) s += (p.oferta || p.precio); });
        return s;
      }, [saldo, players, sellIds]);

      const simValorTrasVentas = useMemo(() => {
        let v = valorEquipo;
        players.forEach(p => { if (sellIds.has(p.id)) v -= p.precio; });
        return v;
      }, [valorEquipo, players, sellIds]);

      const totalCompras = useMemo(() => targets.reduce((s, t) => s + (t.precio || 0), 0), [targets]);

      // Saldo/puja disponible en cada punto de la cola de compras (en orden),
      // para poder comprobar cada objetivo contra el presupuesto que quedaría
      // tras las compras anteriores — no contra el total de golpe.
      const buyRunway = useMemo(() => {
        let running = simSaldoTrasVentas;
        return targets.map(t => {
          const saldoAntes = running;
          const pujaAntes  = bwPuja(saldoAntes, simValorTrasVentas); // valor no cambia por compras
          running -= (t.precio || 0);
          return { id: t.id, saldoDisponible: saldoAntes, pujaDisponible: pujaAntes };
        });
      }, [targets, simSaldoTrasVentas, simValorTrasVentas]);

      // Estado "hoy": ventas ya liquidadas + compras ya comprometidas (efectivo),
      // pero valor de equipo aún sin el jugador comprado.
      const simSaldoHoy = simSaldoTrasVentas - totalCompras;
      const simValorHoy = simValorTrasVentas;
      const simPujaHoy  = bwPuja(simSaldoHoy, simValorHoy);

      // Estado "proyectado": una vez el mercado cierre y las compras se
      // confirmen, el valor de equipo sí incorpora lo comprado.
      const simValorFuturo = simValorTrasVentas + totalCompras;
      const simPujaFutura  = bwPuja(simSaldoHoy, simValorFuturo);

      const origPuja = bwPuja(saldo, valorEquipo);
      const hasSellChanges = sellIds.size > 0;
      const hasBuyChanges  = targets.length > 0;
      const hasChanges     = hasSellChanges || hasBuyChanges;
      const inp = { background: "#080f18", border: "1px solid #1a2535", borderRadius: 7, padding: "7px 10px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" };

      // Mercado siempre visible: se carga solo al entrar en la pestaña (si
      // hay credenciales configuradas), sin necesidad de pulsar nada.
      const { userId: mUserId, leagueId: mLeagueId, token: mTok, version: mVersion } = settings || {};
      const hasCreds = !!(mUserId?.trim() && mLeagueId?.trim() && mTok?.trim() && mVersion?.trim());

      const loadMarket = async () => {
        setMarketData("loading");
        try {
          const { userId, leagueId, token: tok, version } = settings || {};
          const res = await fetch(`/api/biwenger?endpoint=market&userId=${encodeURIComponent((userId||"").trim())}&leagueId=${encodeURIComponent((leagueId||"").trim())}&token=${encodeURIComponent((tok||"").trim())}&version=${encodeURIComponent((version||"").trim())}`);
          const d   = await res.json();
          if (d.market) setMarketData(d.market);
          else setMarketData("error:" + (d.error || "Unknown"));
        } catch (e) {
          setMarketData("error:" + e.message);
        }
      };

      useEffect(() => {
        if (hasCreds) loadMarket();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // Orden descendente de precio siempre — el resto de filtros solo
      // reducen la lista, nunca cambian el criterio de orden.
      const filteredMarket = useMemo(() => {
        if (!Array.isArray(marketData)) return [];
        // Adjunta la probabilidad de jugar aquí mismo (una sola vez por
        // jugador) para que tanto la fila del mercado como el pitch, si
        // se añade como objetivo, lean directamente `p.prob`.
        let list = marketData.map(p => {
          const teamData = ffData && p.teamSlug ? ffData[p.teamSlug] : null;
          const match = teamData ? bwMatchProb(p.nombre, teamData.players) : null;
          return match ? { ...p, prob: match.prob } : p;
        });
        if (marketFilter === "biwenger") list = list.filter(p => p.isBiwenger);
        if (marketFilter === "others")   list = list.filter(p => !p.isBiwenger && !p.isOwn);
        if (marketFilter === "own")      list = list.filter(p => p.isOwn);
        const q = marketSearch.toLowerCase();
        if (q) list = list.filter(p => p.nombre?.toLowerCase().includes(q) || p.equipo?.toLowerCase().includes(q) || p.pos?.toLowerCase().includes(q));
        return [...list].sort((a, b) => b.precio - a.precio);
      }, [marketData, marketSearch, marketFilter, ffData]);

      return (
        <div style={{ padding: "16px 20px 60px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Simulation result — ventas + compras */}
          <div style={{ background: "#080f18", border: `1px solid ${hasChanges ? BW_A + "44" : "#1a2535"}`, borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontSize: 11, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Resultado simulación</div>
            <div style={{ display: "grid", gridTemplateColumns: isMob ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 12 }}>
              {[
                { label: "Valor equipo (hoy)", orig: valorEquipo, sim: simValorHoy, color: BW_B,
                  note: totalCompras > 0 ? `+ ${bwFmt(totalCompras)} cuando se confirmen las compras` : null },
                { label: "Saldo",              orig: saldo,       sim: simSaldoHoy, color: simSaldoHoy >= 0 ? BW_A : "#f87171" },
                { label: "Puja máxima (hoy)",  orig: origPuja,    sim: simPujaHoy,  color: BW_A, bold: true },
                { label: "Puja máxima (tras compras)", orig: origPuja, sim: simPujaFutura, color: "#c084fc", bold: true,
                  hide: totalCompras === 0 },
              ].filter(s => !s.hide).map(s => {
                const diff = s.sim - s.orig;
                return (
                  <div key={s.label} style={{ background: "#0d1825", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#7a90a8", marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: s.bold ? 18 : 15, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{bwFmt(s.sim)}</div>
                    {hasChanges && diff !== 0 && (
                      <div style={{ fontSize: 11, color: diff > 0 ? "#34d399" : "#f87171", marginTop: 4 }}>
                        {diff > 0 ? "▲" : "▼"} {bwFmt(Math.abs(diff))}
                      </div>
                    )}
                    {s.note && <div style={{ fontSize: 10, color: "#5a7080", marginTop: 4 }}>{s.note}</div>}
                  </div>
                );
              })}
            </div>
            {hasBuyChanges && (
              <div style={{ fontSize: 11, color: "#5a7080", marginTop: 12, lineHeight: 1.5 }}>
                El valor de tu equipo no sube por una compra hasta que el mercado cierre y el jugador sea tuyo — hasta entonces, la <b style={{ color: "#9aaabb" }}>puja máxima de hoy</b> solo baja por el efectivo que comprometes. La <b style={{ color: "#9aaabb" }}>puja máxima tras compras</b> es la que tendrás disponible una vez se confirmen.
              </div>
            )}
            {hasChanges && (
              <button onClick={() => { setSellIds(new Set()); setTargets([]); }}
                style={{ marginTop: 12, background: "none", border: "none", color: "#5a7080", cursor: "pointer", fontSize: 12, padding: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = "#f87171"} onMouseLeave={e => e.currentTarget.style.color = "#5a7080"}>
                ↺ Reiniciar simulación
              </button>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMob ? "1fr" : "1fr 750px", gap: 16 }}>
            {/* Sell side */}
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>
                Vender ({sellIds.size} seleccionados)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {[...players].sort((a, b) => (BW_POS_ORDER[a.pos] ?? 9) - (BW_POS_ORDER[b.pos] ?? 9)).map(p => {
                  const selected = sellIds.has(p.id);
                  const saleVal  = p.oferta || p.precio;
                  return (
                    <button key={p.id} onClick={() => toggleSell(p.id)}
                      style={{ display: "flex", alignItems: "center", gap: 8, background: selected ? BW_A + "15" : "#0d1825", border: `1px solid ${selected ? BW_A : "#1a2535"}`, borderRadius: 9, padding: "9px 12px", cursor: "pointer", textAlign: "left" }}>
                      <BwAvatar id={p.id} nombre={p.nombre} pos={p.pos} size={30} />
                      <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${selected ? BW_A : "#1a2535"}`, background: selected ? BW_A : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {selected && <span style={{ fontSize: 10, color: "#0f172a" }}>✓</span>}
                      </div>
                      <BwPosBadge pos={p.pos} />
                      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, color: "#c8d8e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nombre}</span>
                        <BwProbBadge prob={p.prob} />
                        {p.priceIncrement !== 0 && p.priceIncrement != null && (
                          <span style={{ fontSize: 11, color: p.priceIncrement > 0 ? "#34d399" : "#f87171", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                            ({p.priceIncrement > 0 ? "+" : ""}{bwFmt(p.priceIncrement)})
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: selected ? BW_A : "#7a90a8", fontVariantNumeric: "tabular-nums" }}>{bwFmt(saleVal)}</span>
                      {p.oferta && <BwDelta value={p.oferta - p.precio} style={{ fontSize: 11 }} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: targets + market + pitch */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Compras — participan en la simulación con presupuesto en cascada */}
              <div>
                <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 700 }}>
                  Compras ({targets.length})
                </div>
                <div style={{ background: "#080f18", border: "1px solid #1a2535", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#5a7080", marginBottom: 8 }}>Se descuentan de tu saldo simulado en el orden de la lista — cada una comprueba el presupuesto que queda tras las anteriores. No aumentan el valor de tu equipo hasta que se confirmen (ver nota abajo).</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input value={newBuyName} onChange={e => setNewBuyName(e.target.value)} placeholder="Nombre del jugador"
                      style={{ ...inp, flex: 1 }} onFocus={e => e.target.style.borderColor = BW_B + "66"} onBlur={e => e.target.style.borderColor = "#1a2535"}
                      onKeyDown={e => e.key === "Enter" && addTarget()} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="number" min="0" value={newBuyPrice} onChange={e => setNewBuyPrice(e.target.value)} placeholder="Precio objetivo (€)"
                      style={{ ...inp, flex: 1 }} onFocus={e => e.target.style.borderColor = BW_B + "66"} onBlur={e => e.target.style.borderColor = "#1a2535"}
                      onKeyDown={e => e.key === "Enter" && addTarget()} />
                    <button onClick={addTarget} disabled={!newBuyName.trim() || !newBuyPrice}
                      style={{ background: newBuyName.trim() && newBuyPrice ? BW_B : "#1a2535", color: newBuyName.trim() && newBuyPrice ? "#0f172a" : "#7a90a8", border: "none", borderRadius: 7, padding: "7px 14px", cursor: newBuyName.trim() && newBuyPrice ? "pointer" : "default", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                      + Añadir
                    </button>
                  </div>
                </div>
                {targets.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {targets.map((b, i) => {
                      const runway   = buyRunway[i] || { pujaDisponible: simPujaHoy, saldoDisponible: simSaldoTrasVentas };
                      const canPuja  = runway.pujaDisponible  >= b.precio;
                      const canSaldo = runway.saldoDisponible >= b.precio;
                      return (
                        <div key={b.id} style={{ background: canPuja ? BW_B + "0f" : "#f8717110", border: `1px solid ${canPuja ? BW_B + "44" : "#f8717144"}`, borderRadius: 9, padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                            <span style={{ fontSize: 10, color: "#3a5060", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>#{i + 1}</span>
                            {b.pos && <BwPosBadge pos={b.pos} />}
                            <span style={{ flex: 1, fontSize: 13, color: "#c8d8e8", fontWeight: 600 }}>{b.nombre}</span>
                            <span style={{ fontSize: 13, color: BW_B, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{bwFmt(b.precio)}</span>
                            <button onClick={() => removeTarget(b.id)} style={{ background: "none", border: "none", color: "#5a7080", cursor: "pointer", fontSize: 14 }}
                              onMouseEnter={e => e.currentTarget.style.color="#f87171"} onMouseLeave={e => e.currentTarget.style.color="#5a7080"}>✕</button>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                              <span style={{ color: canPuja ? "#34d399" : "#f87171" }}>{canPuja ? "✓" : "✗"}</span>
                              <span style={{ color: "#9aaabb" }}>Puja máxima disponible{i > 0 ? " (tras compras anteriores)" : ""}:</span>
                              <span style={{ color: canPuja ? "#34d399" : "#f87171", fontVariantNumeric: "tabular-nums" }}>{bwFmt(runway.pujaDisponible)}</span>
                              {!canPuja && <span style={{ color: "#f87171" }}>— faltan {bwFmt(b.precio - runway.pujaDisponible)}</span>}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                              <span style={{ color: canSaldo ? "#34d399" : "#f59e0b" }}>{canSaldo ? "✓" : "⚠"}</span>
                              <span style={{ color: "#9aaabb" }}>Saldo disponible:</span>
                              <span style={{ color: canSaldo ? "#34d399" : "#f59e0b", fontVariantNumeric: "tabular-nums" }}>{bwFmt(runway.saldoDisponible)}</span>
                              {!canSaldo && canPuja && <span style={{ color: "#f59e0b" }}>— necesitas vender más para tener saldo</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Market explorer */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                    Mercado de la liga {Array.isArray(marketData) && <span style={{ color: "#5a7080", fontWeight: 400 }}>({marketData.length})</span>}
                  </div>
                  {Array.isArray(marketData) && (
                    <button onClick={loadMarket}
                      style={{ background: "none", border: "none", color: "#5a7080", cursor: "pointer", fontSize: 12 }}>↻ Actualizar</button>
                  )}
                </div>

                {!hasCreds && (
                  <div style={{ fontSize: 13, color: "#3a5060", padding: "8px 0" }}>Configura tus credenciales de Biwenger en Ajustes para ver el mercado.</div>
                )}
                {hasCreds && (marketData === null || marketData === "loading") && (
                  <div style={{ fontSize: 13, color: "#7a90a8", padding: "8px 0" }}>Cargando mercado…</div>
                )}
                {typeof marketData === "string" && marketData.startsWith("error:") && (
                  <div style={{ fontSize: 12, color: "#f87171", background: "#f8717110", borderRadius: 8, padding: "8px 12px" }}>
                    Error: {marketData.slice(6)}
                  </div>
                )}
                {Array.isArray(marketData) && (
                  <div>
                    {/* Filter pills */}
                    <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
                      {[
                        { id: "all",      label: "Todos" },
                        { id: "biwenger", label: "Biwenger" },
                        { id: "others",   label: "Rivales" },
                        { id: "own",      label: "Tuyos" },
                      ].map(f => (
                        <button key={f.id} onClick={() => setMarketFilter(f.id)}
                          style={{ padding: "3px 10px", borderRadius: 20, border: `1px solid ${marketFilter === f.id ? BW_A : "#1a2535"}`, background: marketFilter === f.id ? BW_A + "18" : "transparent", color: marketFilter === f.id ? BW_A : "#7a90a8", cursor: "pointer", fontSize: 11, fontWeight: marketFilter === f.id ? 700 : 400 }}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <input value={marketSearch} onChange={e => setMarketSearch(e.target.value)} placeholder="Buscar jugador, equipo, posición…"
                      style={{ ...inp, width: "100%", marginBottom: 8 }}
                      onFocus={e => e.target.style.borderColor = BW_A + "66"} onBlur={e => e.target.style.borderColor = "#1a2535"} />
                    {filteredMarket.length === 0
                      ? <div style={{ fontSize: 13, color: "#5a7080" }}>Sin resultados.</div>
                      : <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 340, overflowY: "auto" }}>
                          {filteredMarket.map(p => {
                            const canPuja       = simPujaHoy >= p.precio;
                            const alreadyTarget = targets.some(t => t.marketId === p.id);
                            const priceDiff     = p.precio - p.precioMercado;
                            return (
                              <div key={p.player?.id || p.id || Math.random()} style={{ display: "flex", alignItems: "center", gap: 8, background: p.isOwn ? BW_A + "08" : "#0d1825", border: `1px solid ${p.isOwn ? BW_A + "33" : canPuja ? "#1a2535" : "#1a2535"}`, borderRadius: 8, padding: "8px 12px" }}>
                                <div style={{ width: 28, height: 28, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                                  <img src={bwPlayerPhoto(p.id)} alt={p.nombre} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => e.target.style.display="none"} />
                                </div>
                                <BwPosBadge pos={p.pos} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 600 }}>{p.nombre}</span>
                                    <BwProbBadge prob={p.prob} />
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    <span style={{ fontSize: 11, color: "#5a7080" }}>{p.equipo}</span>
                                    {p.vendedor && (
                                      <span style={{ fontSize: 10, background: p.isBiwenger ? "#1a3550" : p.isOwn ? BW_A + "22" : "#3a2050", color: p.isBiwenger ? BW_B : p.isOwn ? BW_A : "#c084fc", borderRadius: 10, padding: "1px 6px" }}>
                                        {p.vendedor}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div style={{ textAlign: "right", flexShrink: 0 }}>
                                  <div style={{ fontSize: 13, color: canPuja ? "#e2e8f0" : "#f87171", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{bwFmt(p.precio)}</div>
                                  {p.precioMercado > 0 && priceDiff !== 0 && (
                                    <div style={{ fontSize: 10, color: priceDiff > 0 ? "#f87171" : "#34d399" }}>
                                      {priceDiff > 0 ? "▲" : "▼"} {bwFmt(Math.abs(priceDiff))} vs mercado
                                    </div>
                                  )}
                                </div>
                                {!p.isOwn && (
                                  <button onClick={() => addFromMarket(p)} disabled={alreadyTarget}
                                    style={{ background: alreadyTarget ? "transparent" : BW_B + "22", border: `1px solid ${alreadyTarget ? "#1a2535" : BW_B + "44"}`, color: alreadyTarget ? "#3a5060" : BW_B, borderRadius: 7, padding: "4px 10px", cursor: alreadyTarget ? "default" : "pointer", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                                    {alreadyTarget ? "✓" : "+ Obj."}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                    }
                  </div>
                )}
              </div>

              {/* Tactical pitch */}
              <BwPitch players={players} sellIds={sellIds} buys={targets} savedLineup={savedLineup} />
            </div>
          </div>
        </div>
      );
    }

    // ── Ajustes tab ───────────────────────────────────────────────────────────
    function BwAjustes({ settings, saldo, onSettingsSave, onImportCSV, onSyncAPI, syncing, syncError, onSyncProb, probSyncing, probSyncError }) {
      const [userId,   setUserId]   = useState(settings.userId   || "");
      const [leagueId, setLeagueId] = useState(settings.leagueId || "");
      const [token,    setToken]    = useState(settings.token    || "");
      const [version,  setVersion]  = useState(settings.version  || "");
      const [manSaldo, setManSaldo] = useState(String(saldo || 0));
      const [saved,    setSaved]    = useState(false);
      const fileRef = useRef();
      const isMob = useIsMobile();

      const inp = { background: "#080f18", border: "1px solid #1a2535", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 13, width: "100%", boxSizing: "border-box" };
      const focus = e => e.target.style.borderColor = BW_A + "66";
      const blur  = e => e.target.style.borderColor = "#1a2535";

      const save = () => {
        onSettingsSave({ userId: userId.trim(), leagueId: leagueId.trim(), token: token.trim(), version: version.trim() }, Number(manSaldo));
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      };

      return (
        <div style={{ padding: "20px 24px 80px", maxWidth: 560 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 900, color: "#e2e8f0", marginBottom: 24 }}>Ajustes</div>

          {/* API credentials */}
          <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 12, padding: "18px 20px", marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 700, marginBottom: 4 }}>Credenciales Biwenger API</div>
            <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 14, lineHeight: 1.6 }}>
              Abre Biwenger en el navegador → DevTools → Network → cualquier petición → copia las cabeceras <code style={{ color: BW_A }}>x-user</code>, <code style={{ color: BW_A }}>x-league</code> y <code style={{ color: BW_A }}>authorization</code> (el token Bearer).
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>x-user (userId)</div>
                <input value={userId} onChange={e => setUserId(e.target.value)} placeholder="ej. 123456" style={inp} onFocus={focus} onBlur={blur} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>x-league (leagueId)</div>
                <input value={leagueId} onChange={e => setLeagueId(e.target.value)} placeholder="ej. 789012" style={inp} onFocus={focus} onBlur={blur} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Token (Bearer …)</div>
                <input value={token} onChange={e => setToken(e.target.value)} placeholder="eyJhbGci…" style={{ ...inp, fontFamily: "monospace", fontSize: 11 }} onFocus={focus} onBlur={blur} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>x-version</div>
                <input value={version} onChange={e => setVersion(e.target.value)} placeholder="ej. 631" style={inp} onFocus={focus} onBlur={blur} />
              </div>
            </div>
          </div>

          {/* Manual saldo */}
          <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 12, padding: "18px 20px", marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 700, marginBottom: 4 }}>Saldo actual</div>
            <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 10 }}>El saldo se obtiene de la API si está configurada, o puedes introducirlo manualmente.</div>
            <input type="number" value={manSaldo} onChange={e => setManSaldo(e.target.value)} placeholder="ej. -18779772" style={inp} onFocus={focus} onBlur={blur} />
          </div>

          {/* Save */}
          <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
            <button onClick={save}
              style={{ background: BW_A, color: "#0f172a", border: "none", borderRadius: 9, padding: "10px 24px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              {saved ? "Guardado ✓" : "Guardar ajustes"}
            </button>
            {settings.userId && settings.token && settings.version && (
              <button onClick={onSyncAPI} disabled={syncing}
                style={{ background: syncing ? "#1a2535" : BW_B + "22", color: syncing ? "#5a7080" : BW_B, border: `1px solid ${BW_B}44`, borderRadius: 9, padding: "10px 20px", cursor: syncing ? "default" : "pointer", fontWeight: 600, fontSize: 13 }}>
                {syncing ? "Sincronizando…" : "↻ Sincronizar con Biwenger"}
              </button>
            )}
          </div>
          {syncError && <div style={{ fontSize: 12, color: "#f87171", marginBottom: 16, background: "#f8717120", borderRadius: 8, padding: "8px 12px" }}>Error: {syncError}</div>}

          {/* Probabilidad de jugar (FutbolFantasy) */}
          <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 12, padding: "18px 20px", marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 700, marginBottom: 4 }}>Probabilidad de jugar (FutbolFantasy)</div>
            <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 12, lineHeight: 1.6 }}>
              Se sincroniza sola al abrir la app — la probabilidad de ser titular la próxima jornada para los 20 equipos de LaLiga, emparejada con tu plantilla y con el mercado por nombre y equipo. Se muestra como un badge de color junto a cada jugador en Plantilla, Simular y el mercado. Este botón solo hace falta para forzar un refresco manual.
            </div>
            <button onClick={onSyncProb} disabled={probSyncing}
              style={{ background: probSyncing ? "#1a2535" : BW_A + "22", color: probSyncing ? "#5a7080" : BW_A, border: `1px solid ${BW_A}44`, borderRadius: 9, padding: "9px 18px", cursor: probSyncing ? "default" : "pointer", fontWeight: 600, fontSize: 13 }}>
              {probSyncing ? "Sincronizando…" : "↻ Forzar refresco"}
            </button>
            {probSyncError && <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 10, background: "#f59e0b18", borderRadius: 8, padding: "8px 12px" }}>{probSyncError}</div>}
          </div>

          {/* CSV import */}
          <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 700, marginBottom: 4 }}>Importar CSV (Biwenger export)</div>
            <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 12, lineHeight: 1.6 }}>
              Descarga el CSV desde Biwenger (Mi equipo → Exportar) y súbelo aquí para sincronizar nombres, equipos y precios. Las ofertas y el precio de compra se mantienen.
            </div>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
              onChange={e => { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload = ev => onImportCSV(ev.target.result); r.readAsText(f, "UTF-8"); } }} />
            <button onClick={() => fileRef.current?.click()}
              style={{ background: "none", border: `1px solid ${BW_A}44`, color: BW_A, borderRadius: 9, padding: "9px 18px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              📂 Seleccionar CSV
            </button>
          </div>
        </div>
      );
    }

    // ── BiwengerLog App ───────────────────────────────────────────────────────
    function BiwengerLogApp({ logoSlot, profileId, profileChip }) {
      const [tab,      setTab]      = useState("plantilla");
      const [players,  setPlayers]  = useState([]);
      const [saldo,    setSaldo]    = useState(0);
      const [settings, setSettings] = useState({});
      const [lineup,   setLineup]   = useState(null); // { formation, slotMap }
      const [loading,  setLoading]  = useState(true);
      const [syncing,  setSyncing]  = useState(false);
      const [syncErr,  setSyncErr]  = useState(null);
      const [probSyncing, setProbSyncing] = useState(false);
      const [probSyncErr, setProbSyncErr] = useState(null);
      const [probSyncedAt, setProbSyncedAt] = useState(null); // persistido, informativo
      const [ffData, setFfData] = useState(null); // caché en memoria (NO persistido) de las ~500 fichas de FutbolFantasy, para poder mostrar el % también en jugadores del mercado que no son tuyos
      const isMobile = useIsMobile();

      const valorEquipo = useMemo(() => players.reduce((s, p) => s + (p.precio || 0), 0), [players]);

      // Carga desde Supabase y encadena, en orden, los dos auto-syncs
      // silenciosos: (1) Biwenger, si hay credenciales, y (2) probabilidad
      // de jugar (FutbolFantasy) — siempre, sin necesidad de pulsar nada.
      // Van en secuencia (no en paralelo) para que ninguno de los dos pise
      // los cambios del otro sobre `players`; cada uno usa variables
      // locales (currentPlayers/currentSaldo), no el estado de React, así
      // que no hay closures obsoletas entre pasos.
      useEffect(() => {
        if (!profileId) return;
        let cancelled = false;
        (async () => {
          setLoading(true);
          const d = await bwLoad(profileId);
          if (cancelled) return;
          const loadedSettings = d.settings || {};
          let currentPlayers = d.players || [];
          let currentSaldo   = d.saldo || 0;
          setPlayers(currentPlayers);
          setSaldo(currentSaldo);
          setSettings(loadedSettings);
          setLineup(d.lineup || null);
          setProbSyncedAt(d.probSyncedAt || null);
          setLoading(false);

          // 1) Auto-sync con Biwenger si hay credenciales configuradas.
          const { userId, leagueId, token, version } = loadedSettings;
          if (userId?.trim() && leagueId?.trim() && token?.trim() && version?.trim()) {
            setSyncing(true); setSyncErr(null);
            try {
              const raw = await bwFetchTeam(loadedSettings);
              const apiPlayers = raw.players || [];
              if (apiPlayers.length > 0) {
                const existingPlayers = currentPlayers;
                currentPlayers = apiPlayers.map(ap => {
                  const existing = existingPlayers.find(p => p.id === ap.id);
                  return {
                    id:             ap.id,
                    nombre:         ap.nombre,
                    slug:           ap.slug || "",
                    pos:            ap.pos,
                    equipo:         ap.equipo,
                    teamSlug:       ap.teamSlug || "",
                    precio:         ap.precio,
                    priceIncrement: ap.priceIncrement || 0,
                    compra:         existing?.compra || ap.compra || ap.precio,
                    oferta:         ap.oferta || existing?.oferta || null,
                    fechaCompra:    ap.fechaCompra || null,
                    prob:           existing?.prob ?? null,     // se conserva — este sync no toca probabilidades
                    probAsOf:       existing?.probAsOf ?? null,
                  };
                });
                currentSaldo = raw.balance ?? currentSaldo;
                setPlayers(currentPlayers); setSaldo(currentSaldo);
              }
            } catch (e) { /* silencioso, igual que antes */ }
            setSyncing(false);
          }

          // 2) Auto-sync de probabilidad de jugar — siempre, sin botón. A
          // diferencia de los precios de fondos (que sí se cachean por
          // fecha), las alineaciones probables se actualizan durante el
          // propio día según ruedas de prensa y entrenamientos, así que
          // no conviene cachear "ya sincronizado hoy" — se vuelve a pedir
          // en cada carga de la app.
          if (currentPlayers.length > 0) {
            setProbSyncing(true); setProbSyncErr(null);
            try {
              const { players: withProb, errors, teams, asOf } = await bwFetchProbabilities(currentPlayers);
              currentPlayers = withProb;
              setFfData(teams);
              setPlayers(currentPlayers);
              setProbSyncedAt(asOf);
              await bwSave(profileId, { players: currentPlayers, saldo: currentSaldo, settings: loadedSettings, lineup: d.lineup || null, probSyncedAt: asOf });
              if (errors.length > 0) {
                setProbSyncErr(`Sincronizado, pero ${errors.length} equipo(s) fallaron: ${errors.map(e => e.slug).join(", ")}`);
              }
            } catch (e) {
              setProbSyncErr(e.message);
            }
            setProbSyncing(false);
          }
        })();
        return () => { cancelled = true; };
      }, [profileId]);

      const persist = async (newPlayers, newSaldo, newSettings, newLineup, newProbSyncedAt) => {
        const p   = newPlayers      ?? players;
        const s   = newSaldo        ?? saldo;
        const st  = newSettings     ?? settings;
        const ln  = newLineup       ?? lineup;
        const psa = newProbSyncedAt ?? probSyncedAt;
        setPlayers(p); setSaldo(s); setSettings(st); setLineup(ln); setProbSyncedAt(psa);
        await bwSave(profileId, { players: p, saldo: s, settings: st, lineup: ln, probSyncedAt: psa });
      };

      const handleOfferChange  = (id, offer)  => {
        const next = players.map(p => p.id === id ? { ...p, oferta: offer || null } : p);
        persist(next, null, null, null);
      };

      const handleCompraChange = (id, compra) => {
        const next = players.map(p => p.id === id ? { ...p, compra: compra || 0 } : p);
        persist(next, null, null, null);
      };

      const handleSettingsSave = (newSettings, newSaldo) => {
        persist(null, newSaldo, newSettings, null);
      };

      const handleLineupSave = (ln) => {
        persist(null, null, null, ln);
      };

      // Parse Biwenger CSV and merge into players
      const handleImportCSV = (text) => {
        const rows = bwParseCSV(text);
        if (!rows.length) return;
        const next = rows.map(r => {
          const pos = BW_POS_ES[r.Posición] || r.Posición || "MC";
          const precio = parseInt(r.Precio) || 0;
          const existing = players.find(p => p.nombre === r.Jugador);
          return {
            id:      existing?.id || "bw_" + Math.random().toString(36).slice(2, 8),
            nombre:  r.Jugador,
            equipo:  r.Equipo,
            pos,
            precio,
            compra:  existing?.compra || precio, // keep original purchase price
            oferta:  existing?.oferta || null,
            prob:    existing?.prob ?? null,
            probAsOf: existing?.probAsOf ?? null,
          };
        });
        persist(next, null, null);
        setTab("plantilla");
      };

      // Sync via API
      const handleSyncAPI = async () => {
        setSyncing(true); setSyncErr(null);
        try {
          const raw = await bwFetchTeam(settings);
          const newSaldo   = raw.balance ?? saldo;
          const apiPlayers = raw.players || [];

          if (apiPlayers.length === 0) {
            setSyncErr(`API respondió OK pero devolvió 0 jugadores. catalogueSize=${raw.catalogueSize ?? "?"}`);
            setSyncing(false);
            return;
          }

          const next = apiPlayers.map(ap => {
            const existing = players.find(p => p.id === ap.id);
            return {
              id:             ap.id,
              nombre:         ap.nombre,
              slug:           ap.slug || "",
              pos:            ap.pos,
              equipo:         ap.equipo,
              teamSlug:       ap.teamSlug || "",
              precio:         ap.precio,
              priceIncrement: ap.priceIncrement || 0,
              compra:         ap.compra || existing?.compra || ap.precio,
              oferta:         ap.oferta || existing?.oferta || null,
              fechaCompra:    ap.fechaCompra || null,
              prob:           existing?.prob ?? null,
              probAsOf:       existing?.probAsOf ?? null,
            };
          });

          // Show warning if catalogue was empty (names will show as "Jugador {id}")
          if (raw.catalogueSize === 0) {
            setSyncErr(`Sincronizado ${next.length} jugadores, pero el catálogo de La Liga no respondió — los nombres y precios actuales pueden estar vacíos. Inténtalo de nuevo.`);
          }

          await persist(next, newSaldo, settings);
        } catch (e) {
          setSyncErr(e.message);
        }
        setSyncing(false);
      };

      // Sincroniza probabilidad de jugar (FutbolFantasy) para toda la plantilla
      // — botón manual en Ajustes, por si se quiere forzar un refresco fuera
      // del auto-sync silencioso de la carga inicial.
      const handleSyncProb = async () => {
        setProbSyncing(true); setProbSyncErr(null);
        try {
          const { players: next, errors, teams, asOf } = await bwFetchProbabilities(players);
          setFfData(teams);
          await persist(next, null, null, null, asOf);
          if (errors.length > 0) {
            setProbSyncErr(`Sincronizado, pero ${errors.length} equipo(s) fallaron: ${errors.map(e => e.slug).join(", ")}`);
          }
        } catch (e) {
          setProbSyncErr(e.message);
        }
        setProbSyncing(false);
      };

      const TABS = [
        { id: "plantilla", label: "Plantilla", icon: "👥" },
        { id: "simular",   label: "Simular",   icon: "🧮" },
        { id: "ajustes",   label: "Ajustes",   icon: "⚙" },
      ];

      return (
        <div style={{ minHeight: "100vh", background: "#060d14", display: "flex", flexDirection: "column" }}>
          {/* Top bar */}
          <div style={{ height: 56, borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {logoSlot}
              <div style={{ width: 1, height: 18, background: "#1a2535" }} />
              <span style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 17, letterSpacing: "-0.01em" }}>
                <span style={{ color: BW_A }}>Biwenger</span><span style={{ color: BW_B }}>Log</span>
              </span>
            </div>
            {profileChip}
          </div>

          {/* Summary bar */}
          {!loading && <BwSummaryBar saldo={saldo} valorEquipo={valorEquipo} />}

          {/* Tab bar */}
          {isMobile ? (
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 60, background: "#080f18", borderTop: "1px solid #0d1825", display: "flex", zIndex: 50 }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", borderTop: `2px solid ${tab === t.id ? BW_A : "transparent"}` }}>
                  <span style={{ fontSize: 16 }}>{t.icon}</span>
                  <span style={{ fontSize: 10, color: tab === t.id ? BW_A : "#5a7080", fontWeight: tab === t.id ? 700 : 400 }}>{t.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ borderBottom: "1px solid #0d1825", display: "flex", background: "#080f18", flexShrink: 0 }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ background: "none", border: "none", borderBottom: tab === t.id ? `2px solid ${BW_A}` : "2px solid transparent", color: tab === t.id ? BW_A : "#7a90a8", cursor: "pointer", padding: "14px 20px", fontSize: 13, fontWeight: tab === t.id ? 600 : 400 }}
                  onMouseEnter={e => { if (tab !== t.id) e.currentTarget.style.color = "#9aaabb"; }}
                  onMouseLeave={e => { if (tab !== t.id) e.currentTarget.style.color = "#7a90a8"; }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: isMobile ? 60 : 0 }}>
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#7a90a8", fontSize: 14 }}>Cargando…</div>
            ) : players.length === 0 && tab !== "ajustes" ? (
              <div style={{ textAlign: "center", padding: "80px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>⚽</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#e2e8f0", marginBottom: 8 }}>Sin plantilla</div>
                <div style={{ fontSize: 13, color: "#7a90a8", marginBottom: 24 }}>Importa tu plantilla desde Biwenger o configura la API.</div>
                <button onClick={() => setTab("ajustes")}
                  style={{ background: BW_A, color: "#0f172a", border: "none", borderRadius: 9, padding: "10px 24px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  ⚙ Ir a Ajustes
                </button>
              </div>
            ) : (
              <>
                {tab === "plantilla" && <BwPlantilla players={players} onOfferChange={handleOfferChange} onCompraChange={handleCompraChange} token={settings.token} lineup={lineup} onLineupSave={handleLineupSave} />}
                {tab === "simular"   && <BwSimular   players={players} saldo={saldo} valorEquipo={valorEquipo} token={settings.token} savedLineup={lineup} settings={settings} ffData={ffData} />}
                {tab === "ajustes"   && <BwAjustes   settings={settings} saldo={saldo} onSettingsSave={handleSettingsSave} onImportCSV={handleImportCSV} onSyncAPI={handleSyncAPI} syncing={syncing} syncError={syncErr} onSyncProb={handleSyncProb} probSyncing={probSyncing} probSyncError={probSyncErr} />}
              </>
            )}
          </div>
        </div>
      );
    }
