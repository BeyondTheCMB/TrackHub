// modules/meallog.js — MealLog (calorías, macros y planificación de comidas).
// Extraído de index.html, igual que spendlog.js, biwengerlog.js y vesta.js.
// Cargado desde index.html vía
// <script type="text/babel" src="modules/meallog.js"></script>, justo después
// de spendlog.js — sin build step, así que sus const/function de nivel
// superior (MealLogApp, ML_*, ml*) comparten el scope léxico global con el
// resto de TrackHub exactamente igual que cuando estaban inline.
// Corte literal del bloque original, sin cambios de lógica.

    // ─── MealLog module ───────────────────────────────────────────────────────
    const ML_A = "#f59e0b";   // amber
    const ML_B = "#84cc16";   // lime

    const ML_MACROS = [
      { id: "kcal",    label: "Kcal",         unit: "kcal", color: "#f59e0b", child: false },
      { id: "protein", label: "Protein",       unit: "g",    color: "#84cc16", child: false },
      { id: "carbs",   label: "Carbs",         unit: "g",    color: "#60a5fa", child: false },
      { id: "sugar",   label: "of which sugar",unit: "g",    color: "#f472b6", child: true  },
      { id: "fat",     label: "Fat",           unit: "g",    color: "#fb923c", child: false },
      { id: "satfat",  label: "of which sat.", unit: "g",    color: "#f87171", child: true  },
      { id: "salt",    label: "Salt",          unit: "g",    color: "#94a3b8", child: false },
    ];

    const ML_SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];

    const ML_EMPTY_MACROS = () => ({ kcal: 0, protein: 0, carbs: 0, sugar: 0, fat: 0, satfat: 0, salt: 0 });

    const mlUuid = () => "ml_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    const mlToday = () => new Date().toISOString().slice(0, 10);

    const mlWeekStart = (dateStr) => {
      const [y, m, dd] = dateStr.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1, dd));
      const day = d.getUTCDay(); // 0=Sun
      const diff = day === 0 ? -6 : 1 - day; // Monday-based
      d.setUTCDate(d.getUTCDate() + diff);
      return d.toISOString().slice(0, 10);
    };

    const mlWeekDays = (weekStart) => {
      const [y, m, dd] = weekStart.split("-").map(Number);
      const base = Date.UTC(y, m - 1, dd);
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(base + i * 86400000);
        days.push(d.toISOString().slice(0, 10));
      }
      return days;
    };

    const mlFmtDate = (dateStr) => {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
    };

    // Compute macros per 100g → for given grams
    const mlScaleMacros = (item, grams) => {
      const factor = grams / 100;
      const m = ML_EMPTY_MACROS();
      ML_MACROS.forEach(({ id }) => { m[id] = Math.round(((item[id] || 0) * factor) * 10) / 10; });
      return m;
    };

    // Compute macros for a recipe (ingredients list, pantry lookup)
    const mlRecipeMacros = (recipe, pantry, portions = 1) => {
      const total = ML_EMPTY_MACROS();
      (recipe.ingredients || []).forEach(ing => {
        const item = pantry.find(p => p.id === ing.itemId);
        if (!item) return;
        const m = mlScaleMacros(item, ing.grams);
        ML_MACROS.forEach(({ id }) => { total[id] += m[id]; });
      });
      const factor = 1 / (recipe.portions || 1) * portions;
      const result = ML_EMPTY_MACROS();
      ML_MACROS.forEach(({ id }) => { result[id] = Math.round(total[id] * factor * 10) / 10; });
      return result;
    };

    const mlAddMacros = (a, b) => {
      const r = ML_EMPTY_MACROS();
      ML_MACROS.forEach(({ id }) => { r[id] = Math.round((( a[id] || 0) + (b[id] || 0)) * 10) / 10; });
      return r;
    };

    // ── Supabase helpers ──────────────────────────────────────────────────────
    const mlTable = async (table, profileId) => {
      const { data, error } = await _sb.from(table).select("data")
        .eq("user_id", _sbUser.id).eq("profile_id", profileId || "default").maybeSingle();
      if (error) console.error(`[MealLog] ${table} load:`, error.message);
      return data?.data ?? [];
    };
    const mlTableSave = async (table, profileId, val) => {
      const { error } = await _sb.from(table).upsert(
        { user_id: _sbUser.id, profile_id: profileId || "default", data: val },
        { onConflict: "user_id,profile_id" }
      );
      if (error) console.error(`[MealLog] ${table} save:`, error.message);
    };
    const mlConfigLoad = async (profileId) => {
      const { data, error } = await _sb.from("meallog_config").select("data")
        .eq("user_id", _sbUser.id).eq("profile_id", profileId || "default").maybeSingle();
      if (error) console.error("[MealLog] config load:", error.message);
      return data?.data ?? { defaultGoal: null, dayGoals: {} };
    };
    const mlConfigSave = async (profileId, cfg) => {
      const { error } = await _sb.from("meallog_config").upsert(
        { user_id: _sbUser.id, profile_id: profileId || "default", data: cfg },
        { onConflict: "user_id,profile_id" }
      );
      if (error) console.error("[MealLog] config save:", error.message);
    };

    // ── Shared UI helpers ─────────────────────────────────────────────────────
    const ML_INP = { background: "#080f18", border: "1px solid #1a2535", borderRadius: 8, padding: "8px 11px", color: "#e2e8f0", fontSize: 13, width: "100%", boxSizing: "border-box" };
    const mlFocus = e => e.target.style.borderColor = ML_A + "66";
    const mlBlur  = e => e.target.style.borderColor = "#1a2535";
    const mlLabel = (text) => <div style={{ fontSize: 11, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontWeight: 600 }}>{text}</div>;

    const MlMacroRow = ({ macros, goal, compact }) => (
      <div style={{ display: "flex", gap: compact ? 6 : 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {ML_MACROS.map(({ id, label, unit, color, child }) => {
          const val  = macros?.[id] ?? 0;
          const gval = goal?.[id];
          const pct  = gval ? Math.min(val / gval, 1) : null;
          return (
            <div key={id} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: compact ? 36 : 44, opacity: child ? 0.75 : 1 }}>
              {child && <div style={{ width: 1, height: compact ? 6 : 8, borderLeft: `1px dashed ${color}66`, marginLeft: 4, marginBottom: -2 }} />}
              <span style={{ fontSize: compact ? 12 : 15, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", paddingLeft: child ? 6 : 0 }}>{val}</span>
              <span style={{ fontSize: 9, color: child ? color + "99" : "#7a90a8", lineHeight: 1.2, paddingLeft: child ? 6 : 0 }}>{label}</span>
              {pct !== null && (
                <div style={{ height: 3, background: "#1a2535", borderRadius: 2, marginTop: 1, marginLeft: child ? 6 : 0 }}>
                  <div style={{ height: "100%", width: `${pct * 100}%`, background: pct >= 1 ? "#f87171" : color, borderRadius: 2 }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );

    // ── Pantry tab ────────────────────────────────────────────────────────────
    function MlPantry({ pantry, onSave }) {
      const [search,  setSearch]  = useState("");
      const [editing, setEditing] = useState(null); // null | "new" | item

      const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return pantry.filter(p => p.name?.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name));
      }, [pantry, search]);

      const handleSave = (item) => {
        if (pantry.find(p => p.id === item.id)) onSave(pantry.map(p => p.id === item.id ? item : p));
        else onSave([...pantry, item]);
        setEditing(null);
      };
      const handleDelete = (id) => { onSave(pantry.filter(p => p.id !== id)); setEditing(null); };

      return (
        <div style={{ padding: "20px 24px 60px" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pantry…"
              style={{ ...ML_INP, flex: 1 }} onFocus={mlFocus} onBlur={mlBlur} />
            <button onClick={() => setEditing("new")}
              style={{ background: ML_A, color: "#0f172a", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              + Add item
            </button>
          </div>

          {filtered.length === 0
            ? <div style={{ textAlign: "center", padding: "60px 0", color: "#7a90a8", fontSize: 14 }}>
                {pantry.length === 0 ? "Your pantry is empty. Add your first item!" : "No items match your search."}
              </div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.map(item => (
                  <div key={item.id} onClick={() => setEditing(item)}
                    style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = ML_A + "44"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{item.name}</span>
                        {item.brand && <span style={{ fontSize: 11, color: "#7a90a8" }}>{item.brand}</span>}
                        {item.isMeal && <span style={{ fontSize: 10, background: ML_B + "22", color: ML_B, border: `1px solid ${ML_B}44`, borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>MEAL</span>}
                      </div>
                      <MlMacroRow macros={item} compact />
                    </div>
                    <span style={{ fontSize: 11, color: "#5a7080" }}>per 100g</span>
                  </div>
                ))}
              </div>
          }

          {editing && (
            <MlPantryModal item={editing === "new" ? null : editing} onSave={handleSave} onDelete={handleDelete} onClose={() => setEditing(null)} />
          )}
        </div>
      );
    }

    function MlPantryModal({ item, onSave, onDelete, onClose }) {
      const isNew = !item;
      const [confirmDel, setConfirmDel] = useState(false);
      const blank = { name: "", brand: "", kcal: "", protein: "", carbs: "", sugar: "", fat: "", satfat: "", salt: "", isMeal: false, mealGrams: "100" };
      const [edit, setEdit] = useState(item ? { ...blank, ...item, kcal: String(item.kcal||""), protein: String(item.protein||""), carbs: String(item.carbs||""), sugar: String(item.sugar||""), fat: String(item.fat||""), satfat: String(item.satfat||""), salt: String(item.salt||""), mealGrams: String(item.mealGrams||100) } : blank);
      const set = (k, v) => setEdit(e => ({ ...e, [k]: v }));

      const handleSave = () => {
        if (!edit.name.trim()) return;
        onSave({ ...edit, id: item?.id || mlUuid(), name: edit.name.trim(),
          kcal: Number(edit.kcal)||0, protein: Number(edit.protein)||0, carbs: Number(edit.carbs)||0,
          sugar: Number(edit.sugar)||0, fat: Number(edit.fat)||0, satfat: Number(edit.satfat)||0,
          salt: Number(edit.salt)||0, mealGrams: Number(edit.mealGrams)||100 });
      };

      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => e.target === e.currentTarget && onClose()}>
          <div style={{ background: "#0d1825", border: "1px solid #7a90a8", borderRadius: 16, width: 480, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #1a2535", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#e2e8f0", fontWeight: 900 }}>{isNew ? "Add pantry item" : "Edit item"}</span>
              <button onClick={onClose} style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 7, width: 28, height: 28, cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", padding: "18px 22px 22px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>{mlLabel("Name *")}<input value={edit.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Rolled oats" style={ML_INP} onFocus={mlFocus} onBlur={mlBlur} autoFocus /></div>
                <div>{mlLabel("Brand")}<input value={edit.brand} onChange={e => set("brand", e.target.value)} placeholder="Optional" style={ML_INP} onFocus={mlFocus} onBlur={mlBlur} /></div>
              </div>
              <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Nutrition per 100g</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
                {ML_MACROS.map(({ id, label, unit, color, child }) => (
                  <div key={id} style={{ paddingLeft: child ? 8 : 0, borderLeft: child ? `2px solid ${color}33` : "none" }}>
                    <div style={{ fontSize: 10, color, marginBottom: 3, fontWeight: 600, opacity: child ? 0.8 : 1 }}>{label} <span style={{ color: "#5a7080" }}>({unit})</span></div>
                    <input type="number" min="0" step="0.1" value={edit[id]} onChange={e => set(id, e.target.value)} placeholder="0"
                      style={{ ...ML_INP, fontSize: 13 }} onFocus={mlFocus} onBlur={mlBlur} />
                  </div>
                ))}
              </div>
              {/* Also a meal toggle */}
              <div style={{ background: "#080f18", border: "1px solid #1a2535", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 600, marginBottom: 2 }}>Also a meal</div>
                    <div style={{ fontSize: 12, color: "#7a90a8" }}>Can be logged directly in the calendar as a standalone meal</div>
                  </div>
                  <button onClick={() => set("isMeal", !edit.isMeal)}
                    style={{ width: 40, height: 22, borderRadius: 11, background: edit.isMeal ? ML_B : "#1a2535", border: "none", cursor: "pointer", position: "relative", flexShrink: 0 }}>
                    <div style={{ position: "absolute", top: 3, left: edit.isMeal ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: "#e2e8f0", transition: "left 0.15s" }} />
                  </button>
                </div>
                {edit.isMeal && (
                  <div style={{ marginTop: 12 }}>
                    {mlLabel("Default serving size (g)")}
                    <input type="number" min="1" value={edit.mealGrams} onChange={e => set("mealGrams", e.target.value)} placeholder="100"
                      style={{ ...ML_INP, width: 100 }} onFocus={mlFocus} onBlur={mlBlur} />
                  </div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  {!isNew && (confirmDel
                    ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "#f87171" }}>Delete?</span>
                        <button onClick={() => onDelete(item.id)} style={{ background: "#f87171", color: "#0f172a", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Yes</button>
                        <button onClick={() => setConfirmDel(false)} style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>No</button>
                      </div>
                    : <button onClick={() => setConfirmDel(true)} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 13 }}
                        onMouseEnter={e => e.currentTarget.style.color="#f87171"} onMouseLeave={e => e.currentTarget.style.color="#7a90a8"}>🗑 Delete</button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={onClose} style={{ background: "none", border: "1px solid #1a2535", color: "#94a3b8", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>Cancel</button>
                  <button onClick={handleSave} disabled={!edit.name.trim()}
                    style={{ background: edit.name.trim() ? ML_A : "#1a2535", color: edit.name.trim() ? "#0f172a" : "#7a90a8", border: "none", borderRadius: 8, padding: "8px 20px", cursor: edit.name.trim() ? "pointer" : "default", fontWeight: 700, fontSize: 13 }}>
                    {isNew ? "Add item" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── Recipes tab ───────────────────────────────────────────────────────────
    function MlRecipes({ recipes, pantry, onSave }) {
      const [editing, setEditing] = useState(null);
      const [search,  setSearch]  = useState("");

      const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return recipes.filter(r => r.name?.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
      }, [recipes, search]);

      const handleSave = (r) => {
        if (recipes.find(x => x.id === r.id)) onSave(recipes.map(x => x.id === r.id ? r : x));
        else onSave([...recipes, r]);
        setEditing(null);
      };
      const handleDelete = (id) => { onSave(recipes.filter(r => r.id !== id)); setEditing(null); };

      return (
        <div style={{ padding: "20px 24px 60px" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recipes…"
              style={{ ...ML_INP, flex: 1 }} onFocus={mlFocus} onBlur={mlBlur} />
            <button onClick={() => setEditing("new")}
              style={{ background: ML_A, color: "#0f172a", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              + New recipe
            </button>
          </div>
          {filtered.length === 0
            ? <div style={{ textAlign: "center", padding: "60px 0", color: "#7a90a8", fontSize: 14 }}>
                {recipes.length === 0 ? "No recipes yet. Create your first!" : "No recipes match your search."}
              </div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.map(r => {
                  const macros = mlRecipeMacros(r, pantry, 1);
                  return (
                    <div key={r.id} onClick={() => setEditing(r)}
                      style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, padding: "14px 16px", cursor: "pointer" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = ML_A + "44"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{r.name}</div>
                          {r.description && <div style={{ fontSize: 12, color: "#7a90a8", marginTop: 2 }}>{r.description}</div>}
                        </div>
                        <span style={{ fontSize: 11, color: "#7a90a8", flexShrink: 0, marginLeft: 10 }}>{r.portions || 1} portion{(r.portions || 1) > 1 ? "s" : ""}</span>
                      </div>
                      <MlMacroRow macros={macros} compact />
                      <div style={{ fontSize: 11, color: "#5a7080", marginTop: 6 }}>{(r.ingredients||[]).length} ingredient{(r.ingredients||[]).length !== 1 ? "s" : ""} · per 1 portion</div>
                    </div>
                  );
                })}
              </div>
          }
          {editing && (
            <MlRecipeModal recipe={editing === "new" ? null : editing} pantry={pantry} onSave={handleSave} onDelete={handleDelete} onClose={() => setEditing(null)} />
          )}
        </div>
      );
    }

    function MlRecipeModal({ recipe, pantry, onSave, onDelete, onClose }) {
      const isNew = !recipe;
      const [confirmDel, setConfirmDel] = useState(false);
      const [name,        setName]        = useState(recipe?.name || "");
      const [description, setDescription] = useState(recipe?.description || "");
      const [portions,    setPortions]    = useState(String(recipe?.portions || 1));
      const [ingredients, setIngredients] = useState(recipe?.ingredients || []);
      const [ingSearch,   setIngSearch]   = useState("");
      const [ingGrams,    setIngGrams]    = useState("100");
      const isMob = useIsMobile();

      const filteredPantry = useMemo(() => {
        const q = ingSearch.toLowerCase();
        return pantry.filter(p => p.name?.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q)).slice(0, 6);
      }, [pantry, ingSearch]);

      const addIngredient = (item) => {
        const g = Number(ingGrams) || 100;
        if (ingredients.find(i => i.itemId === item.id)) {
          setIngredients(ingredients.map(i => i.itemId === item.id ? { ...i, grams: i.grams + g } : i));
        } else {
          setIngredients([...ingredients, { itemId: item.id, name: item.name, grams: g }]);
        }
        setIngSearch(""); setIngGrams("100");
      };
      const removeIngredient = (itemId) => setIngredients(ingredients.filter(i => i.itemId !== itemId));
      const updateGrams = (itemId, grams) => setIngredients(ingredients.map(i => i.itemId === itemId ? { ...i, grams: Number(grams)||0 } : i));

      const previewMacros = useMemo(() => {
        const fakeRecipe = { ingredients, portions: Number(portions) || 1 };
        return mlRecipeMacros(fakeRecipe, pantry, 1);
      }, [ingredients, portions, pantry]);

      const handleSave = () => {
        if (!name.trim()) return;
        onSave({ id: recipe?.id || mlUuid(), name: name.trim(), description, portions: Number(portions)||1, ingredients });
      };

      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => e.target === e.currentTarget && onClose()}>
          <div style={{ background: "#0d1825", border: "1px solid #7a90a8", borderRadius: 16, width: isMob ? "100%" : 560, maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #1a2535", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#e2e8f0", fontWeight: 900 }}>{isNew ? "New recipe" : "Edit recipe"}</span>
              <button onClick={onClose} style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 7, width: 28, height: 28, cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", padding: "18px 22px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <div>{mlLabel("Recipe name *")}<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Overnight oats" style={ML_INP} onFocus={mlFocus} onBlur={mlBlur} autoFocus /></div>
                <div>{mlLabel("Portions")}<input type="number" min="1" value={portions} onChange={e => setPortions(e.target.value)} style={ML_INP} onFocus={mlFocus} onBlur={mlBlur} /></div>
              </div>
              <div>{mlLabel("Description (optional)")}<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description…" style={ML_INP} onFocus={mlFocus} onBlur={mlBlur} /></div>

              {/* Add ingredient */}
              <div style={{ background: "#080f18", border: "1px solid #1a2535", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Add ingredient</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input value={ingSearch} onChange={e => setIngSearch(e.target.value)} placeholder="Search pantry…"
                    style={{ ...ML_INP, flex: 1, fontSize: 12 }} onFocus={mlFocus} onBlur={mlBlur} />
                  <input type="number" min="1" value={ingGrams} onChange={e => setIngGrams(e.target.value)} placeholder="g"
                    style={{ ...ML_INP, width: 70, fontSize: 12 }} onFocus={mlFocus} onBlur={mlBlur} />
                </div>
                {ingSearch && filteredPantry.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {filteredPantry.map(p => (
                      <button key={p.id} onClick={() => addIngredient(p)}
                        style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 7, padding: "7px 12px", cursor: "pointer", textAlign: "left", color: "#c8d8e8", fontSize: 12, display: "flex", justifyContent: "space-between" }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = ML_A + "55"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
                        <span>{p.name}{p.brand ? <span style={{ color: "#7a90a8" }}> · {p.brand}</span> : ""}</span>
                        <span style={{ color: ML_A }}>+ {ingGrams}g</span>
                      </button>
                    ))}
                  </div>
                )}
                {ingSearch && filteredPantry.length === 0 && (
                  <div style={{ fontSize: 12, color: "#5a7080" }}>No pantry items match.</div>
                )}
              </div>

              {/* Ingredients list */}
              {ingredients.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Ingredients</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {ingredients.map(ing => (
                      <div key={ing.itemId} style={{ display: "flex", alignItems: "center", gap: 8, background: "#080f18", border: "1px solid #1a2535", borderRadius: 8, padding: "8px 12px" }}>
                        <span style={{ flex: 1, fontSize: 13, color: "#c8d8e8" }}>{ing.name}</span>
                        <input type="number" min="1" value={ing.grams} onChange={e => updateGrams(ing.itemId, e.target.value)}
                          style={{ ...ML_INP, width: 65, fontSize: 12, padding: "5px 8px" }} onFocus={mlFocus} onBlur={mlBlur} />
                        <span style={{ fontSize: 12, color: "#5a7080" }}>g</span>
                        <button onClick={() => removeIngredient(ing.itemId)} style={{ background: "none", border: "none", color: "#5a7080", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
                          onMouseEnter={e => e.currentTarget.style.color="#f87171"} onMouseLeave={e => e.currentTarget.style.color="#5a7080"}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Macro preview */}
              {ingredients.length > 0 && (
                <div style={{ background: "#080f18", border: "1px solid #1a2535", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 8 }}>Per portion · {portions} total</div>
                  <MlMacroRow macros={previewMacros} compact />
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
                <div>
                  {!isNew && (confirmDel
                    ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "#f87171" }}>Delete?</span>
                        <button onClick={() => onDelete(recipe.id)} style={{ background: "#f87171", color: "#0f172a", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Yes</button>
                        <button onClick={() => setConfirmDel(false)} style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>No</button>
                      </div>
                    : <button onClick={() => setConfirmDel(true)} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 13 }}
                        onMouseEnter={e => e.currentTarget.style.color="#f87171"} onMouseLeave={e => e.currentTarget.style.color="#7a90a8"}>🗑 Delete</button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={onClose} style={{ background: "none", border: "1px solid #1a2535", color: "#94a3b8", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>Cancel</button>
                  <button onClick={handleSave} disabled={!name.trim()}
                    style={{ background: name.trim() ? ML_A : "#1a2535", color: name.trim() ? "#0f172a" : "#7a90a8", border: "none", borderRadius: 8, padding: "8px 20px", cursor: name.trim() ? "pointer" : "default", fontWeight: 700, fontSize: 13 }}>
                    {isNew ? "Create" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── Week view ─────────────────────────────────────────────────────────────
    function MlWeek({ log, recipes, pantry, config, weekStart, onDaySelect, onWeekChange }) {
      const days = mlWeekDays(weekStart);
      const DAY_LABELS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
      const today = mlToday();

      const dayMacros = (date) => {
        const entries = log.filter(e => e.date === date);
        return entries.reduce((acc, e) => mlAddMacros(acc, e.macros || ML_EMPTY_MACROS()), ML_EMPTY_MACROS());
      };

      const goal = (date) => config.dayGoals?.[date] || config.defaultGoal || null;

      return (
        <div style={{ padding: "16px 20px 60px" }}>
          {/* Week nav */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <button onClick={() => onWeekChange(-7)} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 20, padding: "4px 10px" }}>‹</button>
            <span style={{ fontSize: 13, color: "#9aaabb", fontWeight: 600 }}>
              {mlFmtDate(days[0]).replace(/\w+,\s*/, "")} – {mlFmtDate(days[6]).replace(/\w+,\s*/, "")}
            </span>
            <button onClick={() => onWeekChange(7)} disabled={days[6] >= today}
              style={{ background: "none", border: "none", color: days[6] >= today ? "#1a2535" : "#7a90a8", cursor: days[6] >= today ? "default" : "pointer", fontSize: 20, padding: "4px 10px" }}>›</button>
          </div>

          {/* Day cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {days.map((date, i) => {
              const macros   = dayMacros(date);
              const g        = goal(date);
              const isToday  = date === today;
              const isFuture = date > today;
              const entryCount = log.filter(e => e.date === date).length;
              return (
                <div key={date} onClick={() => onDaySelect(date)}
                  style={{ background: "#0d1825", border: `1px solid ${isToday ? ML_A + "66" : "#1a2535"}`, borderRadius: 12, padding: "12px 16px", cursor: "pointer", opacity: isFuture ? 0.5 : 1 }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = ML_A + "55"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = isToday ? ML_A + "66" : "#1a2535"}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: macros.kcal > 0 ? 10 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12, color: isToday ? ML_A : "#7a90a8", fontWeight: isToday ? 700 : 400, minWidth: 28 }}>{DAY_LABELS[i]}</span>
                      <span style={{ fontSize: 13, color: isToday ? "#e2e8f0" : "#9aaabb" }}>{mlFmtDate(date).replace(/\w+,\s*/, "")}</span>
                      {isToday && <span style={{ fontSize: 10, background: ML_A + "22", color: ML_A, border: `1px solid ${ML_A}44`, borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>HOY</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {entryCount > 0 && <span style={{ fontSize: 11, color: "#5a7080" }}>{entryCount} entrada{entryCount !== 1 ? "s" : ""}</span>}
                      {macros.kcal > 0 && <span style={{ fontSize: 14, fontWeight: 700, color: ML_A }}>{macros.kcal} kcal</span>}
                    </div>
                  </div>
                  {macros.kcal > 0 && <MlMacroRow macros={macros} goal={g} compact />}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── Day view ──────────────────────────────────────────────────────────────
    function MlDay({ date, log, recipes, pantry, config, onLogChange, onConfigChange, onBack }) {
      const [addingSlot, setAddingSlot] = useState(null);
      const [editGoal,   setEditGoal]   = useState(false);
      const today = mlToday();

      const dayEntries = log.filter(e => e.date === date);
      const dayMacros  = dayEntries.reduce((acc, e) => mlAddMacros(acc, e.macros || ML_EMPTY_MACROS()), ML_EMPTY_MACROS());
      const goal = config.dayGoals?.[date] || config.defaultGoal || null;

      const deleteEntry = (id) => onLogChange(log.filter(e => e.id !== id));

      // Meal items = pantry items flagged isMeal + all recipes
      const mealOptions = useMemo(() => {
        const items = pantry.filter(p => p.isMeal).map(p => ({ type: "item", id: p.id, name: p.name, brand: p.brand, defaultGrams: p.mealGrams || 100 }));
        const recs  = recipes.map(r => ({ type: "recipe", id: r.id, name: r.name, description: r.description, defaultPortions: 1 }));
        return [...items, ...recs].sort((a, b) => a.name.localeCompare(b.name));
      }, [pantry, recipes]);

      return (
        <div style={{ padding: "0 0 60px" }}>
          {/* Header */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={onBack} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 18, padding: "2px 6px" }}>←</button>
            <span style={{ fontSize: 15, color: "#e2e8f0", fontWeight: 600 }}>{mlFmtDate(date)}</span>
            {date === today && <span style={{ fontSize: 10, background: ML_A + "22", color: ML_A, border: `1px solid ${ML_A}44`, borderRadius: 10, padding: "2px 8px", fontWeight: 700 }}>HOY</span>}
            <button onClick={() => setEditGoal(true)}
              style={{ marginLeft: "auto", background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 7, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = ML_A + "55"; e.currentTarget.style.color = ML_A; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a2535"; e.currentTarget.style.color = "#7a90a8"; }}>
              {goal ? "✎ Goal" : "+ Set goal"}
            </button>
          </div>

          {/* Day totals */}
          <div style={{ padding: "14px 20px", background: "#080f18", borderBottom: "1px solid #0d1825" }}>
            <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Daily total</div>
            <MlMacroRow macros={dayMacros} goal={goal} />
          </div>

          {/* Slots */}
          <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            {ML_SLOTS.map(slot => {
              const slotEntries = dayEntries.filter(e => e.slot === slot);
              const slotMacros  = slotEntries.reduce((acc, e) => mlAddMacros(acc, e.macros || ML_EMPTY_MACROS()), ML_EMPTY_MACROS());
              return (
                <div key={slot}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 3, height: 16, borderRadius: 2, background: ML_A }} />
                      <span style={{ fontSize: 14, color: "#c8d8e8", fontWeight: 600 }}>{slot}</span>
                      {slotMacros.kcal > 0 && <span style={{ fontSize: 12, color: ML_A }}>{slotMacros.kcal} kcal</span>}
                    </div>
                    <button onClick={() => setAddingSlot(slot)}
                      style={{ background: "none", border: `1px solid ${ML_A}44`, color: ML_A, borderRadius: 7, padding: "3px 10px", cursor: "pointer", fontSize: 12 }}>+ Add</button>
                  </div>
                  {slotEntries.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {slotEntries.map(entry => (
                        <div key={entry.id} style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 8, padding: "9px 13px", display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: "#c8d8e8", marginBottom: 4 }}>
                              {entry.name}
                              <span style={{ fontSize: 11, color: "#5a7080", marginLeft: 8 }}>
                                {entry.type === "recipe" ? `${entry.portions} porc.` : `${entry.grams}g`}
                              </span>
                            </div>
                            <MlMacroRow macros={entry.macros} compact />
                          </div>
                          <button onClick={() => deleteEntry(entry.id)} style={{ background: "none", border: "none", color: "#3a5060", cursor: "pointer", fontSize: 14, flexShrink: 0 }}
                            onMouseEnter={e => e.currentTarget.style.color="#f87171"} onMouseLeave={e => e.currentTarget.style.color="#3a5060"}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {slotEntries.length === 0 && (
                    <div style={{ fontSize: 12, color: "#3a5060", padding: "6px 0 0 13px" }}>—</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add entry modal */}
          {addingSlot && (
            <MlAddEntryModal slot={addingSlot} date={date} mealOptions={mealOptions} recipes={recipes} pantry={pantry}
              onAdd={(entry) => { onLogChange([...log, entry]); setAddingSlot(null); }}
              onClose={() => setAddingSlot(null)} />
          )}

          {/* Goal modal */}
          {editGoal && (
            <MlGoalModal
              goal={goal}
              isOverride={!!config.dayGoals?.[date]}
              defaultGoal={config.defaultGoal}
              onSave={(g, forDay) => {
                if (forDay) onConfigChange({ ...config, dayGoals: { ...(config.dayGoals||{}), [date]: g } });
                else onConfigChange({ ...config, defaultGoal: g, dayGoals: { ...(config.dayGoals||{}), [date]: undefined } });
                setEditGoal(false);
              }}
              onClearOverride={() => {
                const dg = { ...(config.dayGoals||{}) };
                delete dg[date];
                onConfigChange({ ...config, dayGoals: dg });
                setEditGoal(false);
              }}
              onClose={() => setEditGoal(false)} />
          )}
        </div>
      );
    }

    function MlAddEntryModal({ slot, date, mealOptions, recipes, pantry, onAdd, onClose }) {
      const [search,   setSearch]   = useState("");
      const [selected, setSelected] = useState(null);
      const [portions, setPortions] = useState("1");
      const [grams,    setGrams]    = useState("100");

      const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return mealOptions.filter(o => o.name?.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q)).slice(0, 8);
      }, [mealOptions, search]);

      const previewMacros = useMemo(() => {
        if (!selected) return null;
        if (selected.type === "recipe") {
          const r = recipes.find(r => r.id === selected.id);
          return r ? mlRecipeMacros(r, pantry, Number(portions)||1) : null;
        } else {
          const p = pantry.find(p => p.id === selected.id);
          return p ? mlScaleMacros(p, Number(grams)||100) : null;
        }
      }, [selected, portions, grams, recipes, pantry]);

      const handleAdd = () => {
        if (!selected) return;
        const macros = previewMacros || ML_EMPTY_MACROS();
        const entry = {
          id: mlUuid(), date, slot,
          type: selected.type,
          refId: selected.id,
          name: selected.name,
          macros,
          ...(selected.type === "recipe" ? { portions: Number(portions)||1 } : { grams: Number(grams)||100 }),
        };
        onAdd(entry);
      };

      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 0 }}
          onClick={e => e.target === e.currentTarget && onClose()}>
          <div style={{ background: "#0d1825", border: "1px solid #7a90a8", borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 560, maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #1a2535", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, color: "#e2e8f0", fontWeight: 900 }}>Add to {slot}</span>
              <button onClick={onClose} style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 7, width: 28, height: 28, cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", padding: "14px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <input value={search} onChange={e => { setSearch(e.target.value); setSelected(null); }} placeholder="Search recipes & meals…"
                style={ML_INP} onFocus={mlFocus} onBlur={mlBlur} autoFocus />

              {!selected && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {filtered.length === 0 && <div style={{ fontSize: 13, color: "#5a7080" }}>No results.</div>}
                  {filtered.map(opt => (
                    <button key={opt.id + opt.type} onClick={() => { setSelected(opt); setGrams(String(opt.defaultGrams||100)); setPortions("1"); }}
                      style={{ background: "#080f18", border: "1px solid #1a2535", borderRadius: 8, padding: "10px 14px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = ML_A + "55"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
                      <div>
                        <span style={{ fontSize: 13, color: "#c8d8e8" }}>{opt.name}</span>
                        {opt.description && <span style={{ fontSize: 11, color: "#5a7080", marginLeft: 8 }}>{opt.description}</span>}
                      </div>
                      <span style={{ fontSize: 11, color: "#5a7080", flexShrink: 0, marginLeft: 8 }}>{opt.type === "recipe" ? "recipe" : "meal"}</span>
                    </button>
                  ))}
                </div>
              )}

              {selected && (
                <div>
                  <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 12, marginBottom: 12, padding: 0 }}>← Back</button>
                  <div style={{ background: "#080f18", border: "1px solid #1a2535", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                    <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600, marginBottom: 8 }}>{selected.name}</div>
                    {selected.type === "recipe"
                      ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {mlLabel("Portions")}
                          <input type="number" min="0.25" step="0.25" value={portions} onChange={e => setPortions(e.target.value)}
                            style={{ ...ML_INP, width: 80 }} onFocus={mlFocus} onBlur={mlBlur} />
                        </div>
                      : <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {mlLabel("Grams")}
                          <input type="number" min="1" value={grams} onChange={e => setGrams(e.target.value)}
                            style={{ ...ML_INP, width: 80 }} onFocus={mlFocus} onBlur={mlBlur} />
                          <span style={{ fontSize: 12, color: "#5a7080" }}>g</span>
                        </div>
                    }
                  </div>
                  {previewMacros && (
                    <div style={{ background: "#080f18", border: "1px solid #1a2535", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                      <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 8 }}>Macros</div>
                      <MlMacroRow macros={previewMacros} />
                    </div>
                  )}
                  <button onClick={handleAdd}
                    style={{ width: "100%", background: ML_A, color: "#0f172a", border: "none", borderRadius: 9, padding: "11px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                    Add to {slot}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    function MlGoalModal({ goal, isOverride, defaultGoal, onSave, onClearOverride, onClose }) {
      const blank = { kcal: "", protein: "", carbs: "", sugar: "", fat: "", satfat: "", salt: "" };
      const [edit, setEdit] = useState(goal ? { ...blank, ...Object.fromEntries(Object.entries(goal).map(([k,v]) => [k, String(v||"")])) } : blank);
      const [forDay, setForDay] = useState(!!isOverride || false);
      const set = (k, v) => setEdit(e => ({ ...e, [k]: v }));
      const handleSave = () => {
        const g = {};
        ML_MACROS.forEach(({ id }) => { if (edit[id]) g[id] = Number(edit[id]); });
        onSave(g, forDay);
      };
      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => e.target === e.currentTarget && onClose()}>
          <div style={{ background: "#0d1825", border: "1px solid #7a90a8", borderRadius: 16, width: 420, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #1a2535", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: "#e2e8f0", fontWeight: 900 }}>Daily goal</span>
              <button onClick={onClose} style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 7, width: 28, height: 28, cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
            <div style={{ padding: "16px 20px 20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
                {ML_MACROS.map(({ id, label, unit, color, child }) => (
                  <div key={id} style={{ paddingLeft: child ? 8 : 0, borderLeft: child ? `2px solid ${color}33` : "none" }}>
                    <div style={{ fontSize: 10, color, marginBottom: 3, fontWeight: 600, opacity: child ? 0.8 : 1 }}>{label}<span style={{ color: "#5a7080" }}> {unit}</span></div>
                    <input type="number" min="0" value={edit[id]} onChange={e => set(id, e.target.value)} placeholder="—"
                      style={{ ...ML_INP, fontSize: 13 }} onFocus={mlFocus} onBlur={mlBlur} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, background: "#080f18", borderRadius: 8, padding: "10px 12px" }}>
                <button onClick={() => setForDay(!forDay)}
                  style={{ width: 36, height: 20, borderRadius: 10, background: forDay ? ML_B : "#1a2535", border: "none", cursor: "pointer", position: "relative", flexShrink: 0 }}>
                  <div style={{ position: "absolute", top: 2, left: forDay ? 17 : 2, width: 16, height: 16, borderRadius: "50%", background: "#e2e8f0", transition: "left 0.15s" }} />
                </button>
                <span style={{ fontSize: 13, color: "#c8d8e8" }}>Only for this day</span>
                {isOverride && (
                  <button onClick={onClearOverride} style={{ marginLeft: "auto", background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 12 }}
                    onMouseEnter={e => e.currentTarget.style.color="#f87171"} onMouseLeave={e => e.currentTarget.style.color="#7a90a8"}>
                    ✕ Remove override
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={onClose} style={{ background: "none", border: "1px solid #1a2535", color: "#94a3b8", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>Cancel</button>
                <button onClick={handleSave}
                  style={{ background: ML_A, color: "#0f172a", border: "none", borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                  Save goal
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const mlSimLoad = async (profileId) => {
      const { data, error } = await _sb.from("ml_simulations").select("data")
        .eq("user_id", _sbUser.id).eq("profile_id", profileId || "default").maybeSingle();
      if (error) console.error("[MealLog] simulations load:", error.message);
      return Array.isArray(data?.data) ? data.data : [];
    };
    const mlSimSave = async (profileId, sims) => {
      const { error } = await _sb.from("ml_simulations").upsert(
        { user_id: _sbUser.id, profile_id: profileId || "default", data: sims },
        { onConflict: "user_id,profile_id" }
      );
      if (error) console.error("[MealLog] simulations save:", error.message);
    };

    // ── Simulate tab ──────────────────────────────────────────────────────────
    const ML_SIM_DAYS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
    const ML_SIM_DAY_KEYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

    const mlEmptySimWeek = () => {
      const week = {};
      ML_SIM_DAY_KEYS.forEach(d => {
        week[d] = {};
        ML_SLOTS.forEach(s => { week[d][s] = []; });
      });
      return week;
    };

    const mlSimDayMacros = (dayData) => {
      const all = Object.values(dayData || {}).flat();
      return all.reduce((acc, e) => mlAddMacros(acc, e.macros || ML_EMPTY_MACROS()), ML_EMPTY_MACROS());
    };

    const mlSimWeekAvg = (simDays) => {
      const totals = ML_SIM_DAY_KEYS.map(k => mlSimDayMacros(simDays[k]));
      const sum = totals.reduce((acc, d) => mlAddMacros(acc, d), ML_EMPTY_MACROS());
      const result = ML_EMPTY_MACROS();
      ML_MACROS.forEach(({ id }) => { result[id] = Math.round((sum[id] / 7) * 10) / 10; });
      return result;
    };

    function MlSimulate({ simulations, pantry, recipes, config, onSave }) {
      const [activeSim,  setActiveSim]  = useState(null); // null = list, sim object = editing
      const [activeDay,  setActiveDay]  = useState(null); // null = week grid, dayKey = day detail
      const [addingSlot, setAddingSlot] = useState(null);
      const [renaming,   setRenaming]   = useState(false);
      const [newName,    setNewName]    = useState("");
      const [confirmDel, setConfirmDel] = useState(false);
      const isMob = useIsMobile();

      const goal = config.defaultGoal || null;

      // Create new simulation
      const createSim = () => {
        const sim = { id: mlUuid(), name: "Nueva simulación", createdAt: new Date().toISOString(), days: mlEmptySimWeek() };
        const updated = [...simulations, sim];
        onSave(updated);
        setActiveSim(sim);
        setNewName(sim.name);
      };

      // Update active sim in list and persist
      const updateSim = (updatedSim) => {
        const updated = simulations.map(s => s.id === updatedSim.id ? updatedSim : s);
        onSave(updated);
        setActiveSim(updatedSim);
      };

      const deleteSim = (id) => {
        onSave(simulations.filter(s => s.id !== id));
        setActiveSim(null);
        setConfirmDel(false);
      };

      const mealOptions = useMemo(() => {
        const items = pantry.filter(p => p.isMeal).map(p => ({ type: "item", id: p.id, name: p.name, brand: p.brand, defaultGrams: p.mealGrams || 100 }));
        const recs  = recipes.map(r => ({ type: "recipe", id: r.id, name: r.name, description: r.description, defaultPortions: 1 }));
        return [...items, ...recs].sort((a, b) => a.name.localeCompare(b.name));
      }, [pantry, recipes]);

      // ── List view ──────────────────────────────────────────────────────────
      if (!activeSim) return (
        <div style={{ padding: "20px 24px 60px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 900, color: "#e2e8f0" }}>Simulaciones</div>
              <div style={{ fontSize: 12, color: "#7a90a8", marginTop: 2 }}>Planifica semanas hipotéticas sin afectar tu registro real.</div>
            </div>
            <button onClick={createSim}
              style={{ background: ML_A, color: "#0f172a", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
              + Nueva
            </button>
          </div>

          {simulations.length === 0
            ? <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>🧪</div>
                <div style={{ fontSize: 14, color: "#7a90a8", marginBottom: 20 }}>No tienes simulaciones guardadas aún.</div>
                <button onClick={createSim}
                  style={{ background: ML_A, color: "#0f172a", border: "none", borderRadius: 9, padding: "10px 24px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  Crear primera simulación
                </button>
              </div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {simulations.map(sim => {
                  const avg = mlSimWeekAvg(sim.days);
                  const totalEntries = ML_SIM_DAY_KEYS.reduce((n, k) => n + ML_SLOTS.reduce((m, s) => m + (sim.days[k]?.[s]?.length || 0), 0), 0);
                  return (
                    <div key={sim.id} onClick={() => { setActiveSim(sim); setNewName(sim.name); setActiveDay(null); }}
                      style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 12, padding: "14px 18px", cursor: "pointer" }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = ML_A + "55"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                        <div>
                          <div style={{ fontSize: 15, color: "#e2e8f0", fontWeight: 700 }}>{sim.name}</div>
                          <div style={{ fontSize: 11, color: "#5a7080", marginTop: 2 }}>
                            {totalEntries} entradas · creada {new Date(sim.createdAt).toLocaleDateString("es-ES")}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, color: ML_A, fontWeight: 700 }}>{avg.kcal} kcal/día</span>
                      </div>
                      <MlMacroRow macros={avg} goal={goal} compact />
                    </div>
                  );
                })}
              </div>
          }
        </div>
      );

      // ── Week grid of active simulation ─────────────────────────────────────
      if (!activeDay) {
        const weekAvg = mlSimWeekAvg(activeSim.days);
        return (
          <div style={{ padding: "0 0 60px" }}>
            {/* Sim header */}
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => { setActiveSim(null); setActiveDay(null); }}
                style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 18, padding: "2px 6px" }}>←</button>
              {renaming
                ? <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
                    onBlur={() => { if (newName.trim()) { updateSim({ ...activeSim, name: newName.trim() }); } setRenaming(false); }}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setNewName(activeSim.name); setRenaming(false); } }}
                    style={{ ...ML_INP, width: 200, fontSize: 15, fontWeight: 700, padding: "5px 10px" }} />
                : <span onClick={() => setRenaming(true)} style={{ fontSize: 15, color: "#e2e8f0", fontWeight: 700, cursor: "pointer" }}
                    title="Click to rename">
                    {activeSim.name} <span style={{ fontSize: 12, color: "#5a7080" }}>✎</span>
                  </span>
              }
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                {confirmDel
                  ? <>
                      <span style={{ fontSize: 13, color: "#f87171", alignSelf: "center" }}>¿Eliminar?</span>
                      <button onClick={() => deleteSim(activeSim.id)} style={{ background: "#f87171", color: "#0f172a", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Sí</button>
                      <button onClick={() => setConfirmDel(false)} style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>No</button>
                    </>
                  : <button onClick={() => setConfirmDel(true)} style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor="#f87171"; e.currentTarget.style.color="#f87171"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor="#1a2535"; e.currentTarget.style.color="#7a90a8"; }}>
                      🗑
                    </button>
                }
              </div>
            </div>

            {/* Weekly average summary */}
            <div style={{ padding: "14px 20px", background: "#080f18", borderBottom: "1px solid #0d1825" }}>
              <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Media semanal</div>
              <MlMacroRow macros={weekAvg} goal={goal} />
            </div>

            {/* Day rows */}
            <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
              {ML_SIM_DAY_KEYS.map((dayKey, i) => {
                const dayMacros = mlSimDayMacros(activeSim.days[dayKey]);
                const totalEntries = ML_SLOTS.reduce((n, s) => n + (activeSim.days[dayKey]?.[s]?.length || 0), 0);
                return (
                  <div key={dayKey} onClick={() => setActiveDay(dayKey)}
                    style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 12, padding: "12px 16px", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = ML_A + "55"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: dayMacros.kcal > 0 ? 10 : 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, color: ML_A, fontWeight: 700, minWidth: 28 }}>{ML_SIM_DAYS[i]}</span>
                        {totalEntries > 0
                          ? <span style={{ fontSize: 11, color: "#5a7080" }}>{totalEntries} entrada{totalEntries !== 1 ? "s" : ""}</span>
                          : <span style={{ fontSize: 11, color: "#3a5060" }}>Sin planificar</span>
                        }
                      </div>
                      {dayMacros.kcal > 0 && (
                        <span style={{ fontSize: 14, fontWeight: 700, color: ML_A }}>{dayMacros.kcal} kcal</span>
                      )}
                    </div>
                    {dayMacros.kcal > 0 && <MlMacroRow macros={dayMacros} goal={goal} compact />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // ── Day detail inside simulation ───────────────────────────────────────
      const dayIdx  = ML_SIM_DAY_KEYS.indexOf(activeDay);
      const dayData = activeSim.days[activeDay] || {};
      const dayMacros = mlSimDayMacros(dayData);

      const updateDaySlot = (slot, entries) => {
        const updatedSim = {
          ...activeSim,
          days: { ...activeSim.days, [activeDay]: { ...dayData, [slot]: entries } }
        };
        updateSim(updatedSim);
      };

      const deleteSimEntry = (slot, entryId) => {
        updateDaySlot(slot, (dayData[slot] || []).filter(e => e.id !== entryId));
      };

      return (
        <div style={{ padding: "0 0 60px" }}>
          {/* Day header */}
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setActiveDay(null)}
              style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 18, padding: "2px 6px" }}>←</button>
            <span style={{ fontSize: 15, color: "#e2e8f0", fontWeight: 600 }}>{ML_SIM_DAYS[dayIdx]}</span>
            <span style={{ fontSize: 12, color: "#5a7080" }}>{activeSim.name}</span>
            {/* Day nav */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <button onClick={() => setActiveDay(ML_SIM_DAY_KEYS[dayIdx - 1])} disabled={dayIdx === 0}
                style={{ background: "none", border: "none", color: dayIdx === 0 ? "#1a2535" : "#7a90a8", cursor: dayIdx === 0 ? "default" : "pointer", fontSize: 18, padding: "2px 8px" }}>‹</button>
              <button onClick={() => setActiveDay(ML_SIM_DAY_KEYS[dayIdx + 1])} disabled={dayIdx === 6}
                style={{ background: "none", border: "none", color: dayIdx === 6 ? "#1a2535" : "#7a90a8", cursor: dayIdx === 6 ? "default" : "pointer", fontSize: 18, padding: "2px 8px" }}>›</button>
            </div>
          </div>

          {/* Day totals */}
          <div style={{ padding: "12px 20px", background: "#080f18", borderBottom: "1px solid #0d1825" }}>
            <div style={{ fontSize: 11, color: "#7a90a8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Total del día</div>
            <MlMacroRow macros={dayMacros} goal={goal} />
          </div>

          {/* Slots */}
          <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            {ML_SLOTS.map(slot => {
              const entries = dayData[slot] || [];
              const slotMacros = entries.reduce((acc, e) => mlAddMacros(acc, e.macros || ML_EMPTY_MACROS()), ML_EMPTY_MACROS());
              return (
                <div key={slot}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 3, height: 16, borderRadius: 2, background: ML_B }} />
                      <span style={{ fontSize: 14, color: "#c8d8e8", fontWeight: 600 }}>{slot}</span>
                      {slotMacros.kcal > 0 && <span style={{ fontSize: 12, color: ML_A }}>{slotMacros.kcal} kcal</span>}
                    </div>
                    <button onClick={() => setAddingSlot(slot)}
                      style={{ background: "none", border: `1px solid ${ML_B}44`, color: ML_B, borderRadius: 7, padding: "3px 10px", cursor: "pointer", fontSize: 12 }}>+ Add</button>
                  </div>
                  {entries.length > 0
                    ? <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {entries.map(entry => (
                          <div key={entry.id} style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 8, padding: "9px 13px", display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, color: "#c8d8e8", marginBottom: 4 }}>
                                {entry.name}
                                <span style={{ fontSize: 11, color: "#5a7080", marginLeft: 8 }}>
                                  {entry.type === "recipe" ? `${entry.portions} porc.` : `${entry.grams}g`}
                                </span>
                              </div>
                              <MlMacroRow macros={entry.macros} compact />
                            </div>
                            <button onClick={() => deleteSimEntry(slot, entry.id)}
                              style={{ background: "none", border: "none", color: "#3a5060", cursor: "pointer", fontSize: 14, flexShrink: 0 }}
                              onMouseEnter={e => e.currentTarget.style.color="#f87171"}
                              onMouseLeave={e => e.currentTarget.style.color="#3a5060"}>✕</button>
                          </div>
                        ))}
                      </div>
                    : <div style={{ fontSize: 12, color: "#3a5060", padding: "6px 0 0 13px" }}>—</div>
                  }
                </div>
              );
            })}
          </div>

          {/* Reuse MlAddEntryModal */}
          {addingSlot && (
            <MlAddEntryModal
              slot={addingSlot}
              date={activeDay}
              mealOptions={mealOptions}
              recipes={recipes}
              pantry={pantry}
              onAdd={(entry) => {
                updateDaySlot(addingSlot, [...(dayData[addingSlot] || []), entry]);
                setAddingSlot(null);
              }}
              onClose={() => setAddingSlot(null)} />
          )}
        </div>
      );
    }

    // ── Menú semanal tab ──────────────────────────────────────────────────────
    // Plantilla de una semana (lunes–domingo, sin fechas) con 4 franjas por día
    // y bloques de texto libre arrastrables. Totalmente independiente de
    // despensa, recetas y macros. Se guarda en su propia tabla (ml_menu) para
    // no compartir fila con meallog_config: un fallo de carga aquí no puede
    // pisar objetivos de macros ni al revés. A diferencia de mlTable, carga y
    // guardado propagan los errores, y sin carga correcta no se guarda nada.
    const ML_MENU_DAYS = [
      { id: "mon", label: "Lunes",     short: "Lun" },
      { id: "tue", label: "Martes",    short: "Mar" },
      { id: "wed", label: "Miércoles", short: "Mié" },
      { id: "thu", label: "Jueves",    short: "Jue" },
      { id: "fri", label: "Viernes",   short: "Vie" },
      { id: "sat", label: "Sábado",    short: "Sáb" },
      { id: "sun", label: "Domingo",   short: "Dom" },
    ];
    const ML_MENU_SLOTS = [
      { id: "breakfast", label: "Desayuno", icon: "☕" },
      { id: "lunch",     label: "Comida",   icon: "🍲" },
      { id: "snack",     label: "Merienda", icon: "🍎" },
      { id: "dinner",    label: "Cena",     icon: "🌙" },
    ];

    const mlMenuEmpty = () => Object.fromEntries(
      ML_MENU_DAYS.map(d => [d.id, Object.fromEntries(ML_MENU_SLOTS.map(s => [s.id, []]))])
    );

    // Garantiza las 28 celdas y descarta bloques mal formados sin perder nada válido.
    const mlMenuNormalize = (raw) => {
      const out = mlMenuEmpty();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
      for (const d of ML_MENU_DAYS) for (const s of ML_MENU_SLOTS) {
        const cell = raw[d.id]?.[s.id];
        if (Array.isArray(cell)) out[d.id][s.id] = cell.filter(b => b && typeof b.id === "string" && typeof b.text === "string");
      }
      return out;
    };

    const mlMenuLoad = async (profileId) => {
      const { data, error } = await _sb.from("ml_menu").select("data")
        .eq("user_id", _sbUser.id).eq("profile_id", profileId || "default").maybeSingle();
      if (error) throw new Error(error.message);
      return mlMenuNormalize(data?.data);
    };
    const mlMenuSave = async (profileId, menu) => {
      const { error } = await _sb.from("ml_menu").upsert(
        { user_id: _sbUser.id, profile_id: profileId || "default", data: menu },
        { onConflict: "user_id,profile_id" }
      );
      if (error) throw new Error(error.message);
    };

    // Devuelve una celda nueva dentro de un menú nuevo (copia superficial por niveles).
    const mlMenuSetCell = (menu, day, slot, list) => ({ ...menu, [day]: { ...menu[day], [slot]: list } });

    // Mueve (o duplica) un bloque. toIndex se refiere a la posición en la lista
    // destino tal como se ve al soltar (antes de quitar el bloque); null = al final.
    const mlMenuMove = (menu, from, to, toIndex, copy) => {
      const src   = menu[from.day][from.slot];
      const block = src.find(b => b.id === from.id);
      if (!block) return menu;
      const same    = from.day === to.day && from.slot === to.slot;
      const origIdx = src.indexOf(block);
      if (same && !copy && (toIndex === origIdx || toIndex === origIdx + 1 || (toIndex == null && origIdx === src.length - 1))) return menu;
      let next = menu;
      if (!copy) next = mlMenuSetCell(next, from.day, from.slot, src.filter(b => b !== block));
      const dst = next[to.day][to.slot];
      let idx = toIndex == null ? dst.length : toIndex;
      if (same && !copy && toIndex != null && origIdx < toIndex) idx -= 1;
      const moved = copy ? { ...block, id: mlUuid() } : block;
      return mlMenuSetCell(next, to.day, to.slot, [...dst.slice(0, idx), moved, ...dst.slice(idx)]);
    };

    function MlMenuBlock({ block, isEditing, editText, setEditText, onStartEdit, onCommit, onCancel, onDelete,
                           onDragStart, onDragEnd, onDragOverBlock, onDropBlock, isDragging, showDropBefore,
                           isMobile, onPick, isPicked }) {
      if (isEditing) {
        return (
          <input autoFocus value={editText} onChange={e => setEditText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCancel(); }}
            onBlur={onCommit}
            style={{ ...ML_INP, padding: "6px 9px", fontSize: 12, borderColor: ML_A + "66" }} />
        );
      }
      return (
        <div style={{ position: "relative" }}>
          {showDropBefore && <div style={{ position: "absolute", top: -4, left: 0, right: 0, height: 2, borderRadius: 1, background: ML_A }} />}
          <div draggable={!isMobile}
            onDragStart={onDragStart} onDragEnd={onDragEnd}
            onDragOver={onDragOverBlock} onDrop={onDropBlock}
            onClick={e => { if (!onStartEdit) return; e.stopPropagation(); onStartEdit(); }}
            title={isMobile ? "Toca para editar" : "Arrastra para mover · clic para editar"}
            style={{ display: "flex", alignItems: "flex-start", gap: 6, background: isPicked ? ML_A + "22" : "#111f30",
                     border: `1px solid ${isPicked ? ML_A + "88" : "#1f3044"}`, borderRadius: 8, padding: "6px 8px",
                     cursor: isMobile ? "pointer" : "grab", opacity: isDragging ? 0.35 : 1, userSelect: "none" }}>
            <span style={{ flex: 1, fontSize: 12, color: "#d6e2ee", lineHeight: 1.35, wordBreak: "break-word" }}>{block.text}</span>
            {isMobile && (
              <button onClick={e => { e.stopPropagation(); onPick(); }} title="Mover"
                style={{ background: "none", border: "none", color: isPicked ? ML_A : "#5a7080", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 }}>⇄</button>
            )}
            <button onClick={e => { e.stopPropagation(); onDelete(); }} title="Eliminar"
              style={{ background: "none", border: "none", color: "#5a7080", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
              onMouseEnter={e => e.currentTarget.style.color = "#f87171"}
              onMouseLeave={e => e.currentTarget.style.color = "#5a7080"}>×</button>
          </div>
        </div>
      );
    }

    function MlMenu({ menu, loadError, saveError, onChange, onRetry }) {
      const isMobile = useIsMobile();
      const [drag,       setDrag]       = useState(null);   // { day, slot, id }
      const [dropAt,     setDropAt]     = useState(null);   // { day, slot, index|null }
      const [editing,    setEditing]    = useState(null);   // { day, slot, id|null }  (id null = bloque nuevo)
      const [editText,   setEditText]   = useState("");
      const [picked,     setPicked]     = useState(null);   // mover tocando (móvil): { day, slot, id }
      const [confirmClr, setConfirmClr] = useState(false);
      // Enter guarda y desmonta el input, lo que puede disparar también onBlur
      // con el closure antiguo: el ref garantiza que cada edición se confirma una sola vez.
      const editRef = useRef(null);

      if (loadError) {
        return (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <div style={{ color: "#f87171", fontSize: 14, marginBottom: 8 }}>No se pudo cargar el menú semanal.</div>
            <div style={{ color: "#5a7080", fontSize: 12, marginBottom: 16 }}>{loadError}</div>
            <button onClick={onRetry} style={{ background: ML_A, color: "#0f172a", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Reintentar</button>
          </div>
        );
      }
      if (!menu) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#7a90a8", fontSize: 14 }}>Cargando…</div>;

      const isCopy = (e) => e.ctrlKey || e.altKey || e.metaKey;
      const blockCount = ML_MENU_DAYS.reduce((n, d) => n + ML_MENU_SLOTS.reduce((m, s) => m + menu[d.id][s.id].length, 0), 0);

      // ── edición ──
      const beginEdit = (target, text) => { setPicked(null); editRef.current = target; setEditing(target); setEditText(text); };
      const startNew  = (day, slot) => beginEdit({ day, slot, id: null }, "");
      const startEdit = (day, slot, b) => beginEdit({ day, slot, id: b.id }, b.text);
      const cancelEdit = () => { editRef.current = null; setEditing(null); setEditText(""); };
      const commitEdit = () => {
        const target = editRef.current;
        if (!target) return;
        editRef.current = null;
        const { day, slot, id } = target;
        const text = editText.trim();
        const list = menu[day][slot];
        setEditing(null); setEditText("");
        if (id == null) {
          if (text) onChange(mlMenuSetCell(menu, day, slot, [...list, { id: mlUuid(), text }]));
        } else if (!text) {
          onChange(mlMenuSetCell(menu, day, slot, list.filter(b => b.id !== id)));
        } else if (list.find(b => b.id === id)?.text !== text) {
          onChange(mlMenuSetCell(menu, day, slot, list.map(b => b.id === id ? { ...b, text } : b)));
        }
      };
      const remove = (day, slot, id) => {
        if (picked?.id === id) setPicked(null);
        onChange(mlMenuSetCell(menu, day, slot, menu[day][slot].filter(b => b.id !== id)));
      };

      // ── arrastre (HTML5 DnD, escritorio) ──
      const onDragStart = (e, day, slot, id) => {
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData("text/plain", id);   // Firefox no inicia el arrastre sin datos
        setDrag({ day, slot, id });
      };
      const onDragEnd = () => { setDrag(null); setDropAt(null); };
      const overCell = (e, day, slot, index) => {
        if (!drag) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = isCopy(e) ? "copy" : "move";
        if (dropAt?.day !== day || dropAt?.slot !== slot || dropAt?.index !== index) setDropAt({ day, slot, index });
      };
      const overBlock = (e, day, slot, i) => {
        const r = e.currentTarget.getBoundingClientRect();
        overCell(e, day, slot, e.clientY < r.top + r.height / 2 ? i : i + 1);
      };
      const drop = (e, day, slot, index) => {
        if (!drag) return;
        e.preventDefault(); e.stopPropagation();
        const next = mlMenuMove(menu, drag, { day, slot }, index, isCopy(e));
        setDrag(null); setDropAt(null);
        if (next !== menu) onChange(next);
      };
      const dropBlock = (e, day, slot, i) => {
        const r = e.currentTarget.getBoundingClientRect();
        drop(e, day, slot, e.clientY < r.top + r.height / 2 ? i : i + 1);
      };

      // ── mover tocando (móvil) ──
      const placePicked = (day, slot) => {
        if (!picked) return;
        const next = mlMenuMove(menu, picked, { day, slot }, null, false);
        setPicked(null);
        if (next !== menu) onChange(next);
      };

      const renderCell = (day, slot) => {
        const list   = menu[day][slot];
        const target = dropAt?.day === day && dropAt?.slot === slot;
        const pickable = picked && !(picked.day === day && picked.slot === slot);
        return (
          <div
            onDragOver={e => overCell(e, day, slot, null)}
            onDrop={e => drop(e, day, slot, null)}
            onClick={pickable ? () => placePicked(day, slot) : undefined}
            style={{ minHeight: 64, display: "flex", flexDirection: "column", gap: 6, padding: 6, borderRadius: 10,
                     background: target ? ML_A + "10" : pickable ? ML_B + "0d" : "#0a1420",
                     border: `1px dashed ${target ? ML_A + "88" : pickable ? ML_B + "66" : "#16263a"}`,
                     cursor: pickable ? "pointer" : "default", transition: "background 0.1s, border-color 0.1s" }}>
            {list.map((b, i) => (
              <MlMenuBlock key={b.id} block={b}
                isEditing={editing?.day === day && editing?.slot === slot && editing?.id === b.id}
                editText={editText} setEditText={setEditText}
                onStartEdit={pickable ? null : () => startEdit(day, slot, b)} onCommit={commitEdit} onCancel={cancelEdit}
                onDelete={() => remove(day, slot, b.id)}
                onDragStart={e => onDragStart(e, day, slot, b.id)} onDragEnd={onDragEnd}
                onDragOverBlock={e => overBlock(e, day, slot, i)} onDropBlock={e => dropBlock(e, day, slot, i)}
                isDragging={drag?.id === b.id}
                showDropBefore={target && dropAt.index === i}
                isMobile={isMobile} isPicked={picked?.id === b.id}
                onPick={() => setPicked(picked?.id === b.id ? null : { day, slot, id: b.id })} />
            ))}
            {target && dropAt.index === list.length && list.length > 0 && <div style={{ height: 2, borderRadius: 1, background: ML_A }} />}
            {editing?.day === day && editing?.slot === slot && editing.id == null ? (
              <input autoFocus value={editText} placeholder="Nueva comida…" onChange={e => setEditText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                onBlur={commitEdit}
                style={{ ...ML_INP, padding: "6px 9px", fontSize: 12, borderColor: ML_A + "66" }} />
            ) : !pickable && (
              <button onClick={e => { e.stopPropagation(); startNew(day, slot); }}
                style={{ marginTop: "auto", background: "none", border: "none", color: "#3d5268", cursor: "pointer", fontSize: 12, textAlign: "left", padding: "2px 4px" }}
                onMouseEnter={e => e.currentTarget.style.color = ML_A}
                onMouseLeave={e => e.currentTarget.style.color = "#3d5268"}>+ Añadir</button>
            )}
          </div>
        );
      };

      return (
        <div style={{ padding: "16px 20px 60px" }}>
          {/* Cabecera */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>Menú semanal</div>
              <div style={{ fontSize: 11, color: "#5a7080", marginTop: 2 }}>
                {isMobile ? "Toca un bloque para editarlo · ⇄ para moverlo" : "Arrastra para mover · mantén Ctrl/⌥ al soltar para duplicar · clic para editar"}
              </div>
            </div>
            {blockCount > 0 && (confirmClr ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#9aaabb" }}>¿Vaciar toda la semana?</span>
                <button onClick={() => { setConfirmClr(false); setPicked(null); onChange(mlMenuEmpty()); }}
                  style={{ background: "#2d1518", border: "1px solid #5a2a30", color: "#f87171", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Vaciar</button>
                <button onClick={() => setConfirmClr(false)}
                  style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>Cancelar</button>
              </div>
            ) : (
              <button onClick={() => setConfirmClr(true)}
                style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>Vaciar semana</button>
            ))}
          </div>

          {saveError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#2d1518", border: "1px solid #5a2a30", borderRadius: 8, color: "#f87171", fontSize: 12 }}>
              No se pudo guardar el último cambio: {saveError}
            </div>
          )}
          {picked && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: ML_B + "14", border: `1px solid ${ML_B}44`, borderRadius: 8, color: "#c8d8e8", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span>Toca la franja donde quieres mover el bloque.</span>
              <button onClick={() => setPicked(null)} style={{ background: "none", border: "none", color: ML_B, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Cancelar</button>
            </div>
          )}

          {isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ML_MENU_DAYS.map(d => (
                <div key={d.id} style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ML_A, marginBottom: 8 }}>{d.label}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ML_MENU_SLOTS.map(s => (
                      <div key={s.id}>
                        <div style={{ fontSize: 10, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4 }}>{s.icon} {s.label}</div>
                        {renderCell(d.id, s.id)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "96px repeat(7, minmax(130px, 1fr))", gap: 6, minWidth: 96 + 7 * 136 }}>
                <div />
                {ML_MENU_DAYS.map(d => (
                  <div key={d.id} style={{ fontSize: 12, fontWeight: 700, color: ML_A, textAlign: "center", padding: "4px 0" }}>{d.label}</div>
                ))}
                {ML_MENU_SLOTS.map(s => (
                  <React.Fragment key={s.id}>
                    <div style={{ fontSize: 11, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, paddingTop: 10 }}>
                      <div style={{ fontSize: 15, marginBottom: 2 }}>{s.icon}</div>{s.label}
                    </div>
                    {ML_MENU_DAYS.map(d => <div key={d.id}>{renderCell(d.id, s.id)}</div>)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── MealLog App ───────────────────────────────────────────────────────────
    function MealLogApp({ logoSlot, profileId, profileChip }) {
      const [tab,         setTab]         = useState("week");
      const [pantry,      setPantry]      = useState([]);
      const [recipes,     setRecipes]     = useState([]);
      const [log,         setLog]         = useState([]);
      const [simulations, setSimulations] = useState([]);
      const [config,      setConfig]      = useState({ defaultGoal: null, dayGoals: {} });
      const [loading,     setLoading]     = useState(true);
      const [weekStart,   setWeekStart]   = useState(() => mlWeekStart(mlToday()));
      const [dayView,     setDayView]     = useState(null);
      // Menú semanal: carga propia y separada del Promise.all de arriba, con
      // errores propagados. menu === null mientras no haya una carga correcta,
      // y en ese estado MlMenu no permite editar (nada que pueda sobrescribir).
      const [menu,          setMenu]          = useState(null);
      const [menuLoadError, setMenuLoadError] = useState(null);
      const [menuSaveError, setMenuSaveError] = useState(null);
      const [menuReload,    setMenuReload]    = useState(0);
      const menuSaveChain = useRef(Promise.resolve());
      const isMobile = useIsMobile();

      useEffect(() => {
        if (!profileId) return;
        setLoading(true);
        Promise.all([
          mlTable("ml_pantry",      profileId),
          mlTable("ml_recipes",     profileId),
          mlTable("ml_log",         profileId),
          mlTable("ml_simulations", profileId),
          mlConfigLoad(profileId),
        ]).then(([p, r, l, sims, c]) => {
          setPantry(p); setRecipes(r); setLog(l); setSimulations(sims); setConfig(c);
          setLoading(false);
        }).catch(() => setLoading(false));
      }, [profileId]);

      useEffect(() => {
        if (!profileId) return;
        let alive = true;
        setMenu(null); setMenuLoadError(null); setMenuSaveError(null);
        mlMenuLoad(profileId)
          .then(m => { if (alive) setMenu(m); })
          .catch(err => { console.error("[MealLog] ml_menu load:", err.message); if (alive) setMenuLoadError(err.message); });
        return () => { alive = false; };
      }, [profileId, menuReload]);

      // Guardados encadenados: cada upsert espera al anterior, así nunca llega
      // a Supabase una versión más vieja después de una más nueva.
      const saveMenu = (v) => {
        setMenu(v);
        const pid = profileId;
        menuSaveChain.current = menuSaveChain.current
          .then(() => mlMenuSave(pid, v))
          .then(() => setMenuSaveError(null))
          .catch(err => { console.error("[MealLog] ml_menu save:", err.message); setMenuSaveError(err.message); });
      };

      const savePantry      = async (v) => { setPantry(v);      await mlTableSave("ml_pantry",      profileId, v); };
      const saveRecipes     = async (v) => { setRecipes(v);     await mlTableSave("ml_recipes",     profileId, v); };
      const saveLog         = async (v) => { setLog(v);         await mlTableSave("ml_log",         profileId, v); };
      const saveSimulations = async (v) => { setSimulations(v); await mlSimSave(profileId, v); };
      const saveConfig      = async (v) => { setConfig(v);      await mlConfigSave(profileId, v); };

      const TABS = [
        { id: "week",     label: "Semana",      icon: "📅" },
        { id: "menu",     label: "Menú semanal", short: "Menú", icon: "🗓️" },
        { id: "simulate", label: "Simular",     icon: "🧪" },
        { id: "pantry",   label: "Despensa",    icon: "🛒" },
        { id: "recipes",  label: "Recetas",     icon: "📋" },
      ];

      const handleWeekChange = (days) => {
        const [y, m, dd] = weekStart.split("-").map(Number);
        const d = new Date(Date.UTC(y, m - 1, dd + days));
        setWeekStart(d.toISOString().slice(0, 10));
      };

      const showDay = dayView && tab === "week";

      return (
        <div style={{ minHeight: "100vh", background: "#060d14", display: "flex", flexDirection: "column" }}>
          {/* Top bar */}
          <div style={{ height: 56, borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {logoSlot}
              <div style={{ width: 1, height: 18, background: "#1a2535" }} />
              <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 17, letterSpacing: "-0.01em" }}>
                <span style={{ color: ML_A }}>Meal</span><span style={{ color: ML_B }}>Log</span>
              </span>
            </div>
            {profileChip}
          </div>

          {/* Tab bar */}
          {isMobile ? (
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 60, background: "#080f18", borderTop: "1px solid #0d1825", display: "flex", zIndex: 50 }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => { setTab(t.id); if (t.id !== "week") setDayView(null); }}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", borderTop: `2px solid ${tab === t.id ? ML_A : "transparent"}` }}>
                  <span style={{ fontSize: 16 }}>{t.icon}</span>
                  <span style={{ fontSize: 10, color: tab === t.id ? ML_A : "#5a7080", fontWeight: tab === t.id ? 700 : 400 }}>{t.short || t.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ borderBottom: "1px solid #0d1825", display: "flex", background: "#080f18", flexShrink: 0 }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => { setTab(t.id); if (t.id !== "week") setDayView(null); }}
                  style={{ background: "none", border: "none", borderBottom: tab === t.id ? `2px solid ${ML_A}` : "2px solid transparent", color: tab === t.id ? ML_A : "#7a90a8", cursor: "pointer", padding: "14px 20px", fontSize: 13, fontWeight: tab === t.id ? 600 : 400 }}
                  onMouseEnter={e => { if (tab !== t.id) e.currentTarget.style.color = "#9aaabb"; }}
                  onMouseLeave={e => { if (tab !== t.id) e.currentTarget.style.color = "#7a90a8"; }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: isMobile ? 60 : 0 }}>
            {loading
              ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#7a90a8", fontSize: 14 }}>Cargando…</div>
              : <>
                  {tab === "week" && !showDay && (
                    <MlWeek log={log} recipes={recipes} pantry={pantry} config={config}
                      weekStart={weekStart} onDaySelect={d => setDayView(d)} onWeekChange={handleWeekChange} />
                  )}
                  {tab === "week" && showDay && (
                    <MlDay date={dayView} log={log} recipes={recipes} pantry={pantry} config={config}
                      onLogChange={saveLog} onConfigChange={saveConfig} onBack={() => setDayView(null)} />
                  )}
                  {tab === "menu" && (
                    <MlMenu menu={menu} loadError={menuLoadError} saveError={menuSaveError}
                      onChange={saveMenu} onRetry={() => setMenuReload(n => n + 1)} />
                  )}
                  {tab === "simulate" && (
                    <MlSimulate simulations={simulations} pantry={pantry} recipes={recipes} config={config} onSave={saveSimulations} />
                  )}
                  {tab === "pantry"  && <MlPantry  pantry={pantry}   onSave={savePantry} />}
                  {tab === "recipes" && <MlRecipes recipes={recipes} pantry={pantry} onSave={saveRecipes} />}
                </>
            }
          </div>
        </div>
      );
    }
