// modules/conceptlog.js — ConceptLog (banco de conceptos y metáforas para divulgación).
// Módulo de TrackHub: se carga desde index.html con
// <script type="text/babel" src="modules/conceptlog.js"></script>, después de vesta.js.
// Sin build step: sus const/function de nivel superior (ConceptLogApp, CL_*, cl*, Cl*)
// comparten el ámbito global con el resto de TrackHub, por eso todo lleva prefijo cl/Cl/CL_.
//
// Datos: tablas relacionales cl_conceptos, cl_relaciones, cl_mundos, cl_metaforas
// (ver conceptlog_schema.sql). A diferencia de otros módulos NO se guarda un JSON
// completo por perfil: cada acción (crear, editar, borrar, relacionar) es una operación
// puntual sobre una fila, así que no hay riesgo de sobrescribir datos con una copia vieja.
// Los errores de Supabase siempre se propagan y se muestran; nunca se traga uno y se
// continúa con datos vacíos.
//
// Fase 2: banco de conceptos (alta, edición, borrado, búsqueda, filtro por categoría,
// ficha con fuentes y conceptos relacionados). Metáforas y mundos llegan en la Fase 3.

    // ─── ConceptLog module ────────────────────────────────────────────────────
    const CL_A = "#f472b6";   // rosa
    const CL_B = "#fbbf24";   // ámbar

    // Las 4 líneas editoriales de Beyond the CMB. El texto de `id` debe coincidir
    // EXACTAMENTE con el CHECK de cl_conceptos.categoria en el SQL.
    const CL_CATEGORIAS = [
      { id: "Viaje a lo más profundo del Universo", color: "#60a5fa" },
      { id: "Ciencia de lo Increíble",              color: "#a78bfa" },
      { id: "Ciencia de Estar por Casa",            color: "#4ade80" },
      { id: "¿Y si…?",                              color: "#fb923c" },
    ];
    const CL_SIN_CATEGORIA = "#5a7080";
    const clCatColor = (cat) => (CL_CATEGORIAS.find(c => c.id === cat) || { color: CL_SIN_CATEGORIA }).color;

    // ── Utilidades ────────────────────────────────────────────────────────────
    // Minúsculas y sin acentos, para que "gravedad" encuentre "Gravedád" y viceversa.
    const clNorm = (s) => (s == null ? "" : String(s)).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

    const clSortConceptos = (list) => [...list].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

    const clIsUrl = (s) => /^https?:\/\/\S+$/i.test((s || "").trim());

    const clFmtDate = (iso) => {
      if (!iso) return "—";
      const d = new Date(iso);
      if (isNaN(d)) return "—";
      return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
    };

    // El par de una relación se guarda siempre ordenado (id menor en concepto_a):
    // es lo que exige el CHECK (concepto_a < concepto_b) y evita duplicados A-B / B-A.
    // Los ids son uuid en minúsculas, así que la comparación de texto equivale a la de Postgres.
    const clOrderPair = (x, y) => (x < y ? [x, y] : [y, x]);

    const clErrMsg = (err) => {
      const m = (err && err.message) ? err.message : String(err);
      if (/does not exist|schema cache|relation .*cl_/i.test(m)) {
        return m + " — ¿Has ejecutado conceptlog_schema.sql en Supabase?";
      }
      return m;
    };

    // ── Capa de datos (Supabase) ──────────────────────────────────────────────
    const clOwn = (q, pid) => q.eq("user_id", _sbUser.id).eq("profile_id", pid);

    const clLoadConceptos = async (pid) => {
      const { data, error } = await clOwn(_sb.from("cl_conceptos").select("*"), pid).order("nombre");
      if (error) throw new Error(error.message);
      return clSortConceptos(data || []);
    };
    const clLoadRelaciones = async (pid) => {
      const { data, error } = await clOwn(_sb.from("cl_relaciones").select("*"), pid);
      if (error) throw new Error(error.message);
      return data || [];
    };

    // Normaliza lo que viene del formulario antes de guardarlo.
    const clCleanFields = (f) => ({
      nombre:      (f.nombre || "").trim(),
      explicacion: (f.explicacion || "").trim() || null,
      idea_fuerza: (f.idea_fuerza || "").trim() || null,
      categoria:   f.categoria || null,
      fuentes:     (f.fuentes || []).map(s => (s || "").trim()).filter(Boolean),
    });

    const clInsertConcepto = async (pid, fields) => {
      const { data, error } = await _sb.from("cl_conceptos")
        .insert({ user_id: _sbUser.id, profile_id: pid, ...clCleanFields(fields) })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    };
    const clUpdateConcepto = async (id, fields) => {
      const { data, error } = await _sb.from("cl_conceptos")
        .update(clCleanFields(fields)).eq("id", id).eq("user_id", _sbUser.id)
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    };
    const clDeleteConcepto = async (id) => {
      const { error } = await _sb.from("cl_conceptos").delete().eq("id", id).eq("user_id", _sbUser.id);
      if (error) throw new Error(error.message);
    };
    const clInsertRelacion = async (pid, idX, idY) => {
      const [a, b] = clOrderPair(idX, idY);
      const { data, error } = await _sb.from("cl_relaciones")
        .insert({ user_id: _sbUser.id, profile_id: pid, concepto_a: a, concepto_b: b })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    };
    const clDeleteRelacion = async (id) => {
      const { error } = await _sb.from("cl_relaciones").delete().eq("id", id).eq("user_id", _sbUser.id);
      if (error) throw new Error(error.message);
    };

    // ── Estilos compartidos ───────────────────────────────────────────────────
    const CL_INP = { background: "#080f18", border: "1px solid #1a2535", borderRadius: 8, padding: "8px 11px", color: "#e2e8f0", fontSize: 13, width: "100%", boxSizing: "border-box" };
    const clFocus = e => e.target.style.borderColor = CL_A + "66";
    const clBlur  = e => e.target.style.borderColor = "#1a2535";
    const clLabel = (text) => <div style={{ fontSize: 11, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontWeight: 600 }}>{text}</div>;

    const CL_BTN = (color, solid) => ({
      background: solid ? color + "22" : "transparent", border: `1px solid ${color}${solid ? "66" : "44"}`,
      borderRadius: 8, padding: "7px 14px", color, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    });

    const ClCatBadge = ({ categoria }) => categoria ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: clCatColor(categoria), background: clCatColor(categoria) + "18", border: `1px solid ${clCatColor(categoria)}44`, borderRadius: 20, padding: "2px 10px" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: clCatColor(categoria) }} />{categoria}
      </span>
    ) : (
      <span style={{ fontSize: 11, color: CL_SIN_CATEGORIA, border: "1px dashed #1a2535", borderRadius: 20, padding: "2px 10px" }}>Sin categoría</span>
    );

    const ClBanner = ({ message, onClose }) => message ? (
      <div style={{ background: "#1a0a0a", border: "1px solid #5a2a30", borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: 13, display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ flex: 1, wordBreak: "break-word" }}>{message}</span>
        {onClose && <button onClick={onClose} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>}
      </div>
    ) : null;

    // ── Formulario de concepto (alta y edición) ───────────────────────────────
    function ClConceptoModal({ concepto, onSave, onClose }) {
      const editing = !!concepto;
      const [nombre,      setNombre]      = useState(concepto?.nombre || "");
      const [explicacion, setExplicacion] = useState(concepto?.explicacion || "");
      const [ideaFuerza,  setIdeaFuerza]  = useState(concepto?.idea_fuerza || "");
      const [categoria,   setCategoria]   = useState(concepto?.categoria || "");
      const [fuentes,     setFuentes]     = useState(concepto?.fuentes?.length ? concepto.fuentes : [""]);
      const [saving,      setSaving]      = useState(false);
      const [error,       setError]       = useState(null);

      useEffect(() => {
        const h = (e) => { if (e.key === "Escape" && !saving) onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
      }, [saving, onClose]);

      const submit = async () => {
        if (!nombre.trim()) { setError("El nombre es obligatorio."); return; }
        setSaving(true); setError(null);
        try {
          await onSave({ nombre, explicacion, idea_fuerza: ideaFuerza, categoria, fuentes });
        } catch (err) {
          setError(clErrMsg(err)); setSaving(false);
        }
      };

      const setFuente = (i, v) => setFuentes(fs => fs.map((f, j) => j === i ? v : f));

      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
          <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 14, width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 18, color: CL_A }}>
              {editing ? "Editar concepto" : "Nuevo concepto"}
            </div>

            <div>
              {clLabel("Nombre *")}
              <input value={nombre} onChange={e => setNombre(e.target.value)} onFocus={clFocus} onBlur={clBlur} autoFocus
                onKeyDown={e => e.key === "Enter" && submit()} placeholder="Ej. Entrelazamiento cuántico" style={CL_INP} />
            </div>

            <div>
              {clLabel("Idea fuerza — la frase clave que hay que transmitir")}
              <textarea value={ideaFuerza} onChange={e => setIdeaFuerza(e.target.value)} onFocus={clFocus} onBlur={clBlur} rows={2}
                style={{ ...CL_INP, resize: "vertical", lineHeight: 1.5 }} />
            </div>

            <div>
              {clLabel("Explicación breve")}
              <textarea value={explicacion} onChange={e => setExplicacion(e.target.value)} onFocus={clFocus} onBlur={clBlur} rows={4}
                style={{ ...CL_INP, resize: "vertical", lineHeight: 1.5 }} />
            </div>

            <div>
              {clLabel("Categoría (línea editorial)")}
              <select value={categoria} onChange={e => setCategoria(e.target.value)} style={CL_INP}>
                <option value="">Sin categoría</option>
                {CL_CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
              </select>
            </div>

            <div>
              {clLabel("Fuentes — enlaces o notas para verificar cifras y matices")}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {fuentes.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 6 }}>
                    <input value={f} onChange={e => setFuente(i, e.target.value)} onFocus={clFocus} onBlur={clBlur}
                      placeholder="https://… o una nota" style={CL_INP} />
                    <button onClick={() => setFuentes(fs => fs.length > 1 ? fs.filter((_, j) => j !== i) : [""])}
                      title="Quitar fuente" style={{ ...CL_BTN("#7a90a8"), padding: "0 12px" }}>×</button>
                  </div>
                ))}
              </div>
              <button onClick={() => setFuentes(fs => [...fs, ""])} style={{ ...CL_BTN("#7a90a8"), marginTop: 8, fontSize: 12 }}>+ Añadir fuente</button>
            </div>

            <ClBanner message={error} />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={onClose} disabled={saving} style={CL_BTN("#7a90a8")}>Cancelar</button>
              <button onClick={submit} disabled={saving} style={{ ...CL_BTN(CL_A, true), opacity: saving ? 0.6 : 1 }}>
                {saving ? "Guardando…" : (editing ? "Guardar cambios" : "Crear concepto")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── Selector para añadir un concepto relacionado ──────────────────────────
    function ClRelPicker({ candidatos, onPick }) {
      const [q, setQ]       = useState("");
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      const matches = useMemo(() => {
        const n = clNorm(q);
        return candidatos.filter(c => !n || clNorm(c.nombre).includes(n)).slice(0, 8);
      }, [q, candidatos]);

      const pick = async (c) => {
        setBusy(true);
        try { await onPick(c.id); setQ(""); setOpen(false); }
        finally { setBusy(false); }
      };

      return (
        <div style={{ position: "relative", maxWidth: 360 }}>
          <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }}
            onFocus={e => { clFocus(e); setOpen(true); }} onBlur={e => { clBlur(e); setTimeout(() => setOpen(false), 150); }}
            placeholder={candidatos.length ? "+ Relacionar con otro concepto…" : "No hay más conceptos que relacionar"}
            disabled={busy || !candidatos.length} style={CL_INP} />
          {open && candidatos.length > 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, background: "#0d1825", border: "1px solid #1a2535", borderRadius: 8, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
              {matches.length === 0
                ? <div style={{ padding: "8px 10px", fontSize: 12, color: "#7a90a8" }}>Sin coincidencias</div>
                : matches.map(c => (
                  <div key={c.id} onMouseDown={e => { e.preventDefault(); pick(c); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#cbd5e1" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#0a1520"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: clCatColor(c.categoria), flexShrink: 0 }} />
                    {c.nombre}
                  </div>
                ))}
            </div>
          )}
        </div>
      );
    }

    // ── Ficha de concepto ─────────────────────────────────────────────────────
    function ClFicha({ concepto, conceptos, relaciones, isMobile, onBack, onEdit, onDelete, onSelect, onAddRel, onRemoveRel }) {
      const [confirmDel, setConfirmDel] = useState(false);
      const [deleting,   setDeleting]   = useState(false);
      useEffect(() => { setConfirmDel(false); }, [concepto.id]);

      const byId = useMemo(() => Object.fromEntries(conceptos.map(c => [c.id, c])), [conceptos]);
      const relados = useMemo(() => relaciones
        .filter(r => r.concepto_a === concepto.id || r.concepto_b === concepto.id)
        .map(r => ({ relId: r.id, other: byId[r.concepto_a === concepto.id ? r.concepto_b : r.concepto_a] }))
        .filter(x => x.other)
        .sort((x, y) => x.other.nombre.localeCompare(y.other.nombre, "es", { sensitivity: "base" })),
      [relaciones, concepto.id, byId]);
      const candidatos = useMemo(() => {
        const ya = new Set(relados.map(x => x.other.id));
        return conceptos.filter(c => c.id !== concepto.id && !ya.has(c.id));
      }, [conceptos, relados, concepto.id]);

      const doDelete = async () => {
        setDeleting(true);
        try { await onDelete(concepto.id); } finally { setDeleting(false); }
      };

      return (
        <div style={{ padding: isMobile ? 16 : 28, maxWidth: 760 }}>
          {isMobile && <button onClick={onBack} style={{ ...CL_BTN("#7a90a8"), marginBottom: 14 }}>← Conceptos</button>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: isMobile ? 24 : 30, letterSpacing: "-0.01em", color: "#e2e8f0", wordBreak: "break-word" }}>{concepto.nombre}</h1>
              <div style={{ marginTop: 8 }}><ClCatBadge categoria={concepto.categoria} /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onEdit(concepto)} style={CL_BTN(CL_A, true)}>Editar</button>
              {!confirmDel && <button onClick={() => setConfirmDel(true)} style={CL_BTN("#f87171")}>Borrar</button>}
            </div>
          </div>

          {confirmDel && (
            <div style={{ marginTop: 14, background: "#1a0a0a", border: "1px solid #5a2a30", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ color: "#f87171", fontSize: 13, flex: 1, minWidth: 200 }}>
                ¿Borrar «{concepto.nombre}»?{relados.length > 0 && ` Se quitarán también sus ${relados.length} relaciones.`} No se puede deshacer.
              </span>
              <button onClick={() => setConfirmDel(false)} disabled={deleting} style={CL_BTN("#7a90a8")}>Cancelar</button>
              <button onClick={doDelete} disabled={deleting} style={{ ...CL_BTN("#f87171", true), opacity: deleting ? 0.6 : 1 }}>{deleting ? "Borrando…" : "Sí, borrar"}</button>
            </div>
          )}

          {concepto.idea_fuerza && (
            <div style={{ marginTop: 22, borderLeft: `3px solid ${CL_B}`, background: CL_B + "0d", borderRadius: "0 10px 10px 0", padding: "12px 16px" }}>
              {clLabel("Idea fuerza")}
              <div style={{ fontSize: 16, color: "#f1f5f9", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{concepto.idea_fuerza}</div>
            </div>
          )}

          {concepto.explicacion && (
            <div style={{ marginTop: 22 }}>
              {clLabel("Explicación")}
              <div style={{ fontSize: 14, color: "#cbd5e1", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{concepto.explicacion}</div>
            </div>
          )}

          {!concepto.idea_fuerza && !concepto.explicacion && (
            <div style={{ marginTop: 22, fontSize: 13, color: "#7a90a8", fontStyle: "italic" }}>
              Este concepto aún no tiene idea fuerza ni explicación. Pulsa «Editar» para añadirlas.
            </div>
          )}

          <div style={{ marginTop: 26 }}>
            {clLabel(`Fuentes (${concepto.fuentes?.length || 0})`)}
            {concepto.fuentes?.length ? (
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {concepto.fuentes.map((f, i) => (
                  <li key={i} style={{ fontSize: 13, color: "#94a3b8", display: "flex", gap: 8, wordBreak: "break-word" }}>
                    <span style={{ color: "#5a7080" }}>{clIsUrl(f) ? "🔗" : "📝"}</span>
                    {clIsUrl(f)
                      ? <a href={f.trim()} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>{f.trim()}</a>
                      : <span>{f}</span>}
                  </li>
                ))}
              </ul>
            ) : <div style={{ fontSize: 13, color: "#5a7080" }}>Sin fuentes todavía. Añádelas para poder verificar cifras y matices.</div>}
          </div>

          <div style={{ marginTop: 26 }}>
            {clLabel(`Conceptos relacionados (${relados.length})`)}
            {relados.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                {relados.map(({ relId, other }) => (
                  <span key={relId} style={{ display: "inline-flex", alignItems: "center", background: clCatColor(other.categoria) + "14", border: `1px solid ${clCatColor(other.categoria)}44`, borderRadius: 20, overflow: "hidden" }}>
                    <button onClick={() => onSelect(other.id)} style={{ background: "none", border: "none", color: "#e2e8f0", fontSize: 13, padding: "5px 6px 5px 12px", cursor: "pointer", fontFamily: "inherit" }}>{other.nombre}</button>
                    <button onClick={() => onRemoveRel(relId)} title="Quitar relación" style={{ background: "none", border: "none", color: "#7a90a8", fontSize: 14, padding: "5px 10px 5px 4px", cursor: "pointer", lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <ClRelPicker candidatos={candidatos} onPick={(otherId) => onAddRel(concepto.id, otherId)} />
          </div>

          <div style={{ marginTop: 30, fontSize: 11, color: "#5a7080" }}>
            Creado {clFmtDate(concepto.created_at)} · Modificado {clFmtDate(concepto.updated_at)}
          </div>
        </div>
      );
    }

    // ── Lista de conceptos (búsqueda y filtro por categoría) ──────────────────
    function ClLista({ conceptos, total, query, onQuery, cat, onCat, selectedId, onSelect, onNew }) {
      const chip = (id, label, color) => {
        const on = cat === id;
        return (
          <button key={id} onClick={() => onCat(id)}
            style={{ background: on ? color + "22" : "transparent", border: `1px solid ${on ? color + "88" : "#1a2535"}`, color: on ? color : "#7a90a8", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {label}
          </button>
        );
      };
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid #0d1825" }}>
            <button onClick={onNew} style={{ ...CL_BTN(CL_A, true), width: "100%" }}>+ Nuevo concepto</button>
            <input value={query} onChange={e => onQuery(e.target.value)} onFocus={clFocus} onBlur={clBlur}
              placeholder="Buscar conceptos…" style={CL_INP} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {chip("all", "Todas", CL_B)}
              {CL_CATEGORIAS.map(c => chip(c.id, c.id, c.color))}
              {chip("none", "Sin categoría", CL_SIN_CATEGORIA)}
            </div>
            <div style={{ fontSize: 11, color: "#5a7080" }}>{conceptos.length === total ? `${total} conceptos` : `${conceptos.length} de ${total} conceptos`}</div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {conceptos.length === 0 && (
              <div style={{ padding: "20px 12px", fontSize: 13, color: "#5a7080", lineHeight: 1.5 }}>
                {total === 0 ? "Aún no hay conceptos. Crea el primero con el botón de arriba." : "Ningún concepto coincide con la búsqueda y el filtro actuales."}
              </div>
            )}
            {conceptos.map(c => {
              const on = c.id === selectedId;
              return (
                <button key={c.id} onClick={() => onSelect(c.id)}
                  style={{ width: "100%", textAlign: "left", display: "flex", gap: 10, alignItems: "flex-start", background: on ? CL_A + "14" : "transparent", border: "none", borderRadius: 8, padding: "9px 10px", cursor: "pointer", fontFamily: "inherit" }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = "#0a1520"; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: clCatColor(c.categoria), marginTop: 6, flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: on ? CL_A : "#e2e8f0" }}>{c.nombre}</span>
                    {c.idea_fuerza && <span style={{ display: "block", fontSize: 12, color: "#7a90a8", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.idea_fuerza}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // ── App ───────────────────────────────────────────────────────────────────
    function ConceptLogApp({ logoSlot, profileId, profileChip }) {
      const isMobile = useIsMobile();
      const [conceptos,   setConceptos]   = useState(null);   // null = aún sin cargar
      const [relaciones,  setRelaciones]  = useState([]);
      const [loadError,   setLoadError]   = useState(null);
      const [reload,      setReload]      = useState(0);
      const [selectedId,  setSelectedId]  = useState(null);
      const [query,       setQuery]       = useState("");
      const [cat,         setCat]         = useState("all");
      const [modal,       setModal]       = useState(null);     // null | { concepto: objeto | null }
      const [actionError, setActionError] = useState(null);

      useEffect(() => {
        if (!profileId) return;
        let alive = true;
        setConceptos(null); setRelaciones([]); setLoadError(null);
        setSelectedId(null); setQuery(""); setCat("all"); setModal(null); setActionError(null);
        Promise.all([clLoadConceptos(profileId), clLoadRelaciones(profileId)])
          .then(([c, r]) => { if (alive) { setConceptos(c); setRelaciones(r); } })
          .catch(err => { console.error("[ConceptLog] load:", err.message); if (alive) setLoadError(clErrMsg(err)); });
        return () => { alive = false; };
      }, [profileId, reload]);

      const visibles = useMemo(() => {
        if (!conceptos) return [];
        // Cada palabra de la búsqueda debe aparecer en algún campo (en cualquier orden).
        const tokens = clNorm(query).split(/\s+/).filter(Boolean);
        return conceptos.filter(c => {
          if (cat === "none" && c.categoria) return false;
          if (cat !== "all" && cat !== "none" && c.categoria !== cat) return false;
          if (!tokens.length) return true;
          const hay = clNorm([c.nombre, c.idea_fuerza, c.explicacion, ...(c.fuentes || [])].filter(Boolean).join(" \n "));
          return tokens.every(t => hay.includes(t));
        });
      }, [conceptos, query, cat]);

      const selected = conceptos && selectedId ? conceptos.find(c => c.id === selectedId) : null;

      // Acciones: cada una es una operación puntual; el estado local solo cambia
      // después de que Supabase confirme.
      const saveConcepto = async (fields) => {
        const editing = modal && modal.concepto;
        const row = editing ? await clUpdateConcepto(modal.concepto.id, fields) : await clInsertConcepto(profileId, fields);
        setConceptos(list => clSortConceptos(editing ? list.map(c => c.id === row.id ? row : c) : [...list, row]));
        setSelectedId(row.id);
        setModal(null);
      };
      const deleteConcepto = async (id) => {
        try {
          await clDeleteConcepto(id);
          setConceptos(list => list.filter(c => c.id !== id));
          setRelaciones(rs => rs.filter(r => r.concepto_a !== id && r.concepto_b !== id));
          setSelectedId(null); setActionError(null);
        } catch (err) { setActionError(clErrMsg(err)); }
      };
      const addRelacion = async (idX, idY) => {
        try {
          const row = await clInsertRelacion(profileId, idX, idY);
          setRelaciones(rs => [...rs, row]); setActionError(null);
        } catch (err) { setActionError(clErrMsg(err)); }
      };
      const removeRelacion = async (relId) => {
        try {
          await clDeleteRelacion(relId);
          setRelaciones(rs => rs.filter(r => r.id !== relId)); setActionError(null);
        } catch (err) { setActionError(clErrMsg(err)); }
      };

      const cargando = profileId && conceptos === null && !loadError;
      const openNew  = () => setModal({ concepto: null });

      const lista = conceptos && (
        <ClLista conceptos={visibles} total={conceptos.length} query={query} onQuery={setQuery} cat={cat} onCat={setCat}
          selectedId={selectedId} onSelect={setSelectedId} onNew={openNew} />
      );

      const detalle = conceptos && (selected
        ? <ClFicha concepto={selected} conceptos={conceptos} relaciones={relaciones} isMobile={isMobile}
            onBack={() => setSelectedId(null)} onEdit={c => setModal({ concepto: c })} onDelete={deleteConcepto}
            onSelect={setSelectedId} onAddRel={addRelacion} onRemoveRel={removeRelacion} />
        : (
          <div style={{ padding: 40, color: "#5a7080", fontSize: 14, textAlign: "center", marginTop: 60 }}>
            {conceptos.length === 0 ? (
              <div style={{ maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>💡</div>
                <div style={{ color: "#94a3b8", fontWeight: 600, marginBottom: 6 }}>Tu banco de conceptos está vacío</div>
                Empieza listando un concepto científico, solo el concepto. La metáfora llegará después, cuando tú la elijas.
                <div style={{ marginTop: 18 }}><button onClick={openNew} style={CL_BTN(CL_A, true)}>+ Crear el primer concepto</button></div>
              </div>
            ) : "Elige un concepto de la lista para ver su ficha."}
          </div>
        ));

      return (
        <div style={{ minHeight: "100vh", background: "#060d14", display: "flex", flexDirection: "column" }}>
          {/* Barra superior */}
          <div style={{ height: 56, borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {logoSlot}
              <div style={{ width: 1, height: 18, background: "#1a2535" }} />
              <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 17, letterSpacing: "-0.01em" }}>
                <span style={{ color: CL_A }}>Concept</span><span style={{ color: CL_B }}>Log</span>
              </span>
            </div>
            {profileChip}
          </div>

          {actionError && <div style={{ padding: "10px 20px 0" }}><ClBanner message={actionError} onClose={() => setActionError(null)} /></div>}

          {!profileId && <div style={{ padding: 40, color: "#7a90a8", fontSize: 14 }}>Selecciona un perfil para ver tus conceptos.</div>}

          {cargando && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#7a90a8", fontSize: 14 }}>Cargando…</div>}

          {loadError && (
            <div style={{ padding: 20, maxWidth: 640 }}>
              <ClBanner message={`No se han podido cargar los conceptos: ${loadError}`} />
              <button onClick={() => setReload(n => n + 1)} style={{ ...CL_BTN(CL_A, true), marginTop: 12 }}>Reintentar</button>
            </div>
          )}

          {conceptos && (isMobile ? (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {selected ? detalle : lista}
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", height: "calc(100vh - 56px)" }}>
              <div style={{ width: 360, flexShrink: 0, borderRight: "1px solid #0d1825", background: "#080f18" }}>{lista}</div>
              <div style={{ flex: 1, overflowY: "auto" }}>{detalle}</div>
            </div>
          ))}

          {modal && <ClConceptoModal concepto={modal.concepto} onSave={saveConcepto} onClose={() => setModal(null)} />}
        </div>
      );
    }
