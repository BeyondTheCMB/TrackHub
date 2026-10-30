// modules/spendlog.js — SpendLog (gastos, ingresos y suscripciones).
// Extraído de index.html, igual que biwengerlog.js y vesta.js. Cargado desde
// index.html vía <script type="text/babel" src="modules/spendlog.js"></script>,
// justo después del bloque inline principal — sin build step, así que el
// top-level `const SpendLogApp` sigue siendo visible para el router de
// TrackHub exactamente igual que antes (los script tags clásicos comparten el
// mismo scope léxico de nivel superior en el navegador).
// No cambia ninguna lógica, es un corte literal del bloque que ya estaba
// en index.html.

    // ─── SpendLog module ──────────────────────────────────────────────────────
    const SpendLogApp = (() => {

    // ─── SL constants ─────────────────────────────────────────────────────────
    const SL_DEFAULT_EXPENSE_CATEGORIES = [
      { id: "housing",       label: "Housing",       emoji: "🏠", color: "#60a5fa" },
      { id: "transport",     label: "Transport",     emoji: "🚗", color: "#f59e0b" },
      { id: "groceries",     label: "Groceries",     emoji: "🛒", color: "#4ade80" },
      { id: "eating_out",    label: "Eating out",    emoji: "🍽️", color: "#fb923c" },
      { id: "entertainment", label: "Entertainment", emoji: "🎬", color: "#a78bfa" },
      { id: "sport",         label: "Sport",         emoji: "🏋️", color: "#22d3ee" },
      { id: "clothing",      label: "Clothing",      emoji: "👕", color: "#f472b6" },
      { id: "health",        label: "Health",        emoji: "💊", color: "#34d399" },
      { id: "education",     label: "Education",     emoji: "📚", color: "#fbbf24" },
      { id: "travel",        label: "Travel",        emoji: "✈️", color: "#38bdf8" },
      { id: "home",          label: "Home",          emoji: "🛠️", color: "#94a3b8" },
      { id: "tech",          label: "Tech",          emoji: "💻", color: "#818cf8" },
      { id: "gifts",         label: "Gifts",         emoji: "🎁", color: "#f87171" },
      { id: "finance",       label: "Finance",       emoji: "💰", color: "#4ade80" },
      { id: "pets",          label: "Pets",          emoji: "🐾", color: "#fbbf24" },
      { id: "personal",      label: "Personal care", emoji: "🧴", color: "#e879f9" },
      { id: "investments",   label: "Investments",   emoji: "📈", color: "#a78bfa", always: true, neutral: true },
      { id: "other_exp",     label: "Other",         emoji: "📦", color: "#64748b" },
    ];
    const SL_DEFAULT_INCOME_CATEGORIES = [
      { id: "salary",        label: "Salary",        emoji: "💼", color: "#4ade80" },
      { id: "freelance",     label: "Freelance",     emoji: "🧑‍💻", color: "#22d3ee" },
      { id: "rental",        label: "Rental income", emoji: "🏠", color: "#60a5fa" },
      { id: "gift_in",       label: "Gift received", emoji: "🎁", color: "#f59e0b" },
      { id: "refund",        label: "Refund",        emoji: "↩️", color: "#34d399" },
      { id: "interest",      label: "Interest",      emoji: "🏦", color: "#fbbf24" },
      { id: "other_inc",     label: "Other",         emoji: "📦", color: "#94a3b8" },
    ];
    const SL_DEFAULT_CATEGORIES = SL_DEFAULT_EXPENSE_CATEGORIES;
    // Neutral categories: recorded as expenses but excluded from spend totals/budget
    const SL_NEUTRAL_CATEGORY_IDS = new Set(SL_DEFAULT_EXPENSE_CATEGORIES.filter(c => c.neutral).map(c => c.id));
    const slIsNeutral = (t) => SL_NEUTRAL_CATEGORY_IDS.has(t.category);
    const SL_CURRENCIES = [
      { code: "EUR", label: "Euro",                symbol: "€" },
      { code: "USD", label: "US Dollar",           symbol: "$" },
      { code: "GBP", label: "British Pound",       symbol: "£" },
      { code: "CHF", label: "Swiss Franc",         symbol: "Fr" },
      { code: "JPY", label: "Japanese Yen",        symbol: "¥" },
      { code: "CAD", label: "Canadian Dollar",     symbol: "CA$" },
      { code: "AUD", label: "Australian Dollar",   symbol: "A$" },
      { code: "CNY", label: "Chinese Yuan",        symbol: "¥" },
      { code: "SEK", label: "Swedish Krona",       symbol: "kr" },
      { code: "NOK", label: "Norwegian Krone",     symbol: "kr" },
      { code: "DKK", label: "Danish Krone",        symbol: "kr" },
      { code: "SGD", label: "Singapore Dollar",    symbol: "S$" },
      { code: "MXN", label: "Mexican Peso",        symbol: "$" },
      { code: "BRL", label: "Brazilian Real",      symbol: "R$" },
      { code: "INR", label: "Indian Rupee",        symbol: "₹" },
    ];
    const SL_DEFAULT_PAYMENT_METHODS = [
      "Cash", "Credit card", "Debit card", "Bank transfer", "PayPal", "Bizum",
    ];
    async function slLoadConfig(profileId) {
      const { data, error } = await _sb.from("sl_config")
        .select("data").eq("user_id", _sbUser.id).eq("profile_id", profileId || "default").maybeSingle();
      if (error) console.error("[SpendLog] slLoadConfig error:", error.message, error.code);
      return data?.data || { currency: "EUR", budget: null, customCategories: [], deletedDefaultCategories: [] };
    }
    async function slSaveConfig(cfg, profileId) {
      const { error } = await _sb.from("sl_config").upsert(
        { user_id: _sbUser.id, profile_id: profileId || "default", data: cfg },
        { onConflict: "user_id,profile_id" }
      );
      if (error) console.error("[SpendLog] slSaveConfig error:", error.message, error.code);
    }
    async function slLoadTransactions(profileId) {
      const { data, error } = await _sb.from("sl_transactions")
        .select("data").eq("user_id", _sbUser.id).eq("profile_id", profileId || "default").maybeSingle();
      if (error) console.error("[SpendLog] slLoadTransactions error:", error.message, error.code);
      return Array.isArray(data?.data) ? data.data : [];
    }
    async function slSaveTransactions(txs, profileId) {
      const { error } = await _sb.from("sl_transactions").upsert(
        { user_id: _sbUser.id, profile_id: profileId || "default", data: txs },
        { onConflict: "user_id,profile_id" }
      );
      if (error) console.error("[SpendLog] slSaveTransactions error:", error.message, error.code);
    }
    async function slLoadSubscriptions(profileId) {
      const { data, error } = await _sb.from("sl_subscriptions")
        .select("data").eq("user_id", _sbUser.id).eq("profile_id", profileId || "default").maybeSingle();
      if (error) console.error("[SpendLog] slLoadSubscriptions error:", error.message, error.code);
      return Array.isArray(data?.data) ? data.data : [];
    }
    async function slSaveSubscriptions(subs, profileId) {
      const { error } = await _sb.from("sl_subscriptions").upsert(
        { user_id: _sbUser.id, profile_id: profileId || "default", data: subs },
        { onConflict: "user_id,profile_id" }
      );
      if (error) console.error("[SpendLog] slSaveSubscriptions error:", error.message, error.code);
    }

    // ─── SL helpers ───────────────────────────────────────────────────────────
    const SL_ACCENT_A = "#4ade80";
    const SL_ACCENT_B = "#22d3ee";
    const slUuid = () => "sl_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const slFmtAmount = (n, currency) => {
      try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }
      catch { return (currency || "EUR") + " " + Number(n).toFixed(2); }
    };
    const slMonthKey  = (date) => date.slice(0, 7); // "YYYY-MM"
    const slMonthLabel = (key) => {
      const [y, m] = key.split("-");
      return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
    };
    const slTodayKey  = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
    const slMonthlyCost = (sub) => {
      const a = Number(sub.amount) || 0;
      if (sub.cycle === "annual") return a / 12;
      if (sub.cycle === "weekly") return a * 4.33;
      return a; // monthly
    };
    // Returns ISO dates (YYYY-MM-DD) when a subscription bills in a given month
    const slSubBilledInMonth = (sub, monthKey) => {
      if (!sub.active) return false;
      if (!sub.nextBilling) return false;
      if (sub.startDate && slMonthKey(sub.startDate) > monthKey) return false;
      const [ty, tm] = monthKey.split("-").map(Number);
      const [ny, nm, nd] = sub.nextBilling.split("-").map(Number);
      if (sub.cycle === "monthly") {
        return true; // bills every month; startDate already checked above
      }
      if (sub.cycle === "annual") {
        return nm === tm; // same calendar month each year
      }
      if (sub.cycle === "weekly") {
        const nextDate   = new Date(ny, nm - 1, nd);
        const monthStart = new Date(ty, tm - 1, 1);
        const monthEnd   = new Date(ty, tm, 0);
        let d = new Date(nextDate);
        while (d > monthEnd) d.setDate(d.getDate() - 7);
        if (d >= monthStart) return true;
        d = new Date(nextDate);
        while (d < monthStart) d.setDate(d.getDate() + 7);
        return d <= monthEnd;
      }
      return slMonthKey(sub.nextBilling) === monthKey;
    };

    const slNextBillingDate = (sub) => {
      if (!sub.nextBilling) return null;
      const [ny, nm, nd] = sub.nextBilling.split("-").map(Number);
      const today = new Date(); today.setHours(0,0,0,0);
      let d = new Date(ny, nm - 1, nd);
      if (d >= today) return d;
      if (sub.cycle === "monthly") {
        // Advance month by month until >= today
        while (d < today) d.setMonth(d.getMonth() + 1);
      } else if (sub.cycle === "annual") {
        while (d < today) d.setFullYear(d.getFullYear() + 1);
      } else if (sub.cycle === "weekly") {
        while (d < today) d.setDate(d.getDate() + 7);
      } else {
        return d; // unknown cycle, return as-is
      }
      return d;
    };
    const slFmtDate = (d) => d.toISOString().slice(0, 10);

    // ─── SL recurring income ──────────────────────────────────────────────────
    // Recurring income (salary, pension, rent received…) works like
    // subscriptions: a series is never written into sl_transactions — it is
    // expanded virtually into one income entry per month. That keeps past
    // months stable and avoids auto-posting rows on load.
    // Series shape:
    //   { id, name, category, paymentMethod, firstDate: "YYYY-MM-DD",
    //     endDate: "YYYY-MM-DD" | null,             // last month paid (month granularity)
    //     amounts: [{ from: "YYYY-MM", amount }],   // amount history (raises don't rewrite the past)
    //     extraMonths: [6, 12],                     // months with an extra payment (pagas extra)
    //     extraAmount: number | null,               // null → same as that month's regular amount
    //     overrides: { "YYYY-MM": { amount } | { skip: true } } }
    const SL_MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const slDaysInMonth = (mk) => { const [y, m] = mk.split("-").map(Number); return new Date(y, m, 0).getDate(); };
    const slAddMonths = (mk, n) => { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
    const slRecBaseAmount = (r, mk) => {
      const hist = [...(r.amounts || [])].sort((a, b) => a.from.localeCompare(b.from));
      let amt = hist.length ? Number(hist[0].amount) || 0 : 0;
      for (const h of hist) if (h.from <= mk) amt = Number(h.amount) || 0;
      return amt;
    };
    const slRecCurrentAmount = (r) => slRecBaseAmount(r, slTodayKey());
    // Returns the month's entry, an entry with skipped: true, or null when the
    // series doesn't apply to that month at all.
    const slRecIncomeForMonth = (r, mk) => {
      if (!r || !r.firstDate) return null;
      if (mk < slMonthKey(r.firstDate)) return null;
      if (r.endDate && mk > slMonthKey(r.endDate)) return null;
      const day   = Math.min(Number(r.firstDate.slice(8, 10)) || 1, slDaysInMonth(mk));
      const date  = mk + "-" + String(day).padStart(2, "0");
      const base  = slRecBaseAmount(r, mk);
      const isExtra = (r.extraMonths || []).includes(Number(mk.slice(5, 7)));
      const extra = isExtra ? (r.extraAmount != null ? Number(r.extraAmount) || 0 : base) : 0;
      const ov    = (r.overrides || {})[mk] || null;
      const entry = {
        id: "rec_" + r.id + "_" + mk, type: "income", recurringId: r.id, recurringName: r.name,
        date, category: r.category, paymentMethod: r.paymentMethod || null, notes: r.name,
        scheduled: base + extra, extra: isExtra, adjusted: !!(ov && ov.amount != null), skipped: !!(ov && ov.skip),
      };
      entry.amount = entry.adjusted ? Number(ov.amount) || 0 : entry.scheduled;
      return entry;
    };
    // Entries that count towards a month's income (skipped ones excluded).
    const slRecIncomeEntries = (list, mk) =>
      (list || []).map(r => slRecIncomeForMonth(r, mk)).filter(e => e && !e.skipped);
    // Every counted entry from each series' start up to and including uptoMk.
    const slRecIncomeHistory = (list, uptoMk) => {
      const out = [];
      for (const r of list || []) {
        if (!r.firstDate) continue;
        const last = r.endDate && slMonthKey(r.endDate) < uptoMk ? slMonthKey(r.endDate) : uptoMk;
        for (let mk = slMonthKey(r.firstDate), guard = 0; mk <= last && guard < 1200; mk = slAddMonths(mk, 1), guard++) {
          const e = slRecIncomeForMonth(r, mk);
          if (e && !e.skipped) out.push(e);
        }
      }
      return out;
    };
    // Unlike the other SL loaders, errors propagate: the app must not offer
    // editing (and therefore saving) on top of a failed load.
    async function slLoadRecurringIncome(profileId) {
      const { data, error } = await _sb.from("sl_recurring_income")
        .select("data").eq("user_id", _sbUser.id).eq("profile_id", profileId || "default").maybeSingle();
      if (error) throw new Error(error.message);
      return Array.isArray(data?.data) ? data.data : [];
    }
    async function slSaveRecurringIncome(list, profileId) {
      const { error } = await _sb.from("sl_recurring_income").upsert(
        { user_id: _sbUser.id, profile_id: profileId || "default", data: list },
        { onConflict: "user_id,profile_id" }
      );
      if (error) throw new Error(error.message);
    }

    function SlCategoryPicker({ value, onChange, allCategories, style }) {
      const [open,   setOpen]   = React.useState(false);
      const [query,  setQuery]  = React.useState("");
      const inputRef = React.useRef();
      const cat = allCategories.find(c => c.id === value);

      const filtered = React.useMemo(() => {
        if (!query.trim()) return allCategories;
        const q = query.toLowerCase();
        return allCategories.filter(c => c.label.toLowerCase().includes(q) || (c.emoji || "").includes(q));
      }, [allCategories, query]);

      const openPicker = () => { setOpen(true); setQuery(""); setTimeout(() => inputRef.current?.focus(), 40); };
      const closePicker = () => { setOpen(false); setQuery(""); };
      const select = (id) => { onChange(id); closePicker(); };

      // Keyboard: Enter selects first match, Escape closes
      const handleKey = (e) => {
        if (e.key === "Escape") { closePicker(); return; }
        if (e.key === "Enter" && filtered.length > 0) { select(filtered[0].id); return; }
      };

      return (
        <div style={{ position: "relative", ...style }}>
          <button onClick={() => open ? closePicker() : openPicker()}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "#080f18", border: `1px solid ${open ? "#4ade8066" : "#7a90a8"}`, borderRadius: 8, padding: "9px 12px", cursor: "pointer", color: "#e2e8f0" }}>
            <span style={{ fontSize: 16 }}>{cat ? cat.emoji : "❓"}</span>
            <span style={{ flex: 1, textAlign: "left", fontSize: 14, color: cat ? "#e2e8f0" : "#7a90a8" }}>{cat ? cat.label : "Select category"}</span>
            <span style={{ fontSize: 12, color: "#7a90a8" }}>{open ? "▴" : "▾"}</span>
          </button>
          {open && (
            <>
              <div onClick={closePicker} style={{ position: "fixed", inset: 0, zIndex: 198 }} />
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, zIndex: 199, boxShadow: "0 16px 40px rgba(0,0,0,0.6)", overflow: "hidden" }}>
                {/* Search input */}
                <div style={{ padding: "8px 10px", borderBottom: "1px solid #1a2535" }}>
                  <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKey}
                    placeholder="Search categories…"
                    style={{ width: "100%", background: "#080f18", border: "1px solid #1a2535", borderRadius: 7, padding: "7px 10px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box", outline: "none" }}
                    onFocus={e => e.target.style.borderColor = "#4ade8066"} onBlur={e => e.target.style.borderColor = "#1a2535"} />
                </div>
                {/* Results */}
                <div style={{ maxHeight: 210, overflowY: "auto" }}>
                  {filtered.length === 0
                    ? <div style={{ padding: "12px 14px", fontSize: 13, color: "#5a7080" }}>No categories match.</div>
                    : filtered.map(c => (
                        <button key={c.id} onClick={() => select(c.id)}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: value === c.id ? "#4ade8011" : "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#0f1923"}
                          onMouseLeave={e => e.currentTarget.style.background = value === c.id ? "#4ade8011" : "transparent"}>
                          <span style={{ fontSize: 16 }}>{c.emoji}</span>
                          <span style={{ fontSize: 13, color: "#c8d8e8" }}>{c.label}</span>
                          {value === c.id && <span style={{ marginLeft: "auto", color: "#4ade80", fontSize: 12 }}>✓</span>}
                        </button>
                      ))
                  }
                </div>
              </div>
            </>
          )}
        </div>
      );
    }

    function SlTransactionForm({ allExpenseCategories, allIncomeCategories, currency, paymentMethods, onSave, onCancel, initial }) {
      const today = new Date().toISOString().slice(0, 10);
      const [type,     setType]     = React.useState(initial ? (initial.type || "expense") : "expense");
      const [amount,   setAmount]   = React.useState(initial ? String(initial.amount) : "");
      const [category, setCategory] = React.useState(initial ? initial.category : "");
      const [date,     setDate]     = React.useState(initial ? initial.date : today);
      const [notes,    setNotes]    = React.useState(initial ? (initial.notes || "") : "");
      const [payMethod,setPayMethod]= React.useState(initial ? (initial.paymentMethod || "") : "");
      const locked = allExpenseCategories.length === 0 || allIncomeCategories.length === 0;
      const allCategories = type === "income" ? allIncomeCategories : allExpenseCategories;
      const isMob = useIsMobile();
      // Reset category when switching type if it doesn't exist in new list
      React.useEffect(() => {
        if (category && !allCategories.find(c => c.id === category)) setCategory("");
      }, [type]);
      const valid = amount && Number(amount) > 0 && category && date;
      const inp = { background: "#080f18", border: "1px solid #7a90a8", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 14, width: "100%", boxSizing: "border-box" };
      const focusStyle = e => e.target.style.borderColor = "#4ade8066";
      const blurStyle  = e => e.target.style.borderColor = "#7a90a8";
      const accentColor = type === "income" ? "#4ade80" : "#22d3ee";
      return (
        <div style={{ background: "#0b1520", border: "1px solid #1a2535", borderRadius: 14, padding: "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: "#e2e8f0" }}>
              {initial ? "Edit transaction" : "Add transaction"}
            </div>
            {/* Type toggle — hidden when form is locked to one type */}
            {!locked && (
              <div style={{ display: "flex", background: "#080f18", borderRadius: 8, padding: 3, gap: 2 }}>
                {["expense","income"].map(t => (
                  <button key={t} onClick={() => setType(t)}
                    style={{ background: type === t ? (t === "income" ? "#4ade8022" : "#22d3ee22") : "transparent", border: `1px solid ${type === t ? (t === "income" ? "#4ade8055" : "#22d3ee55") : "transparent"}`, color: type === t ? (t === "income" ? "#4ade80" : "#22d3ee") : "#7a90a8", borderRadius: 6, padding: "4px 14px", cursor: "pointer", fontSize: 12, fontWeight: type === t ? 700 : 400, textTransform: "capitalize" }}>
                    {t === "income" ? "📥 Income" : "📤 Expense"}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Amount + Date: side by side on desktop, stacked on mobile */}
          <div style={{ display: "grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Amount ({currency})</div>
              <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Date</div>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Category</div>
            <SlCategoryPicker value={category} onChange={setCategory} allCategories={allCategories} />
          </div>
          {/* Notes + Payment: side by side on desktop, stacked on mobile */}
          <div style={{ display: "grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes</div>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional…" style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>{type === "income" ? "Source" : "Payment method"}</div>
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ ...inp, cursor: "pointer" }}
                onFocus={focusStyle} onBlur={blurStyle}>
                <option value="">— Optional —</option>
                {(paymentMethods || [...SL_DEFAULT_PAYMENT_METHODS]).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => onSave({ type, amount: Number(amount), category, date, notes: notes || null, paymentMethod: payMethod || null })}
              disabled={!valid}
              style={{ flex: 1, background: valid ? accentColor : "#1a2535", color: valid ? "#0f172a" : "#7a90a8", border: "none", borderRadius: 9, padding: "10px", fontWeight: 700, fontSize: 14, cursor: valid ? "pointer" : "default" }}>
              {initial ? "Save changes" : `Add ${type}`}
            </button>
            <button onClick={onCancel} style={{ background: "transparent", color: "#7a90a8", border: "1px solid #7a90a8", borderRadius: 9, padding: "10px 16px", cursor: "pointer", fontSize: 14 }}>Cancel</button>
          </div>
        </div>
      );
    }

    function SlSubscriptionForm({ allCategories, currency, onSave, onCancel, initial }) {
      const today = new Date().toISOString().slice(0, 10);
      const [name,     setName]     = React.useState(initial ? initial.name : "");
      const [amount,   setAmount]   = React.useState(initial ? String(initial.amount) : "");
      const [cycle,    setCycle]    = React.useState(initial ? initial.cycle : "monthly");
      const [category, setCategory] = React.useState(initial ? initial.category : "");
      const [nextBill, setNextBill] = React.useState(initial ? initial.nextBilling : today);
      const [startDate,setStartDate]= React.useState(initial ? (initial.startDate || "") : "");
      const [notes,    setNotes]    = React.useState(initial ? (initial.notes || "") : "");
      const valid = name.trim() && amount && Number(amount) > 0 && category && nextBill;
      const inp = { background: "#080f18", border: "1px solid #7a90a8", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 14, width: "100%", boxSizing: "border-box" };
      const focusStyle = e => e.target.style.borderColor = "#4ade8066";
      const blurStyle  = e => e.target.style.borderColor = "#7a90a8";
      return (
        <div style={{ background: "#0b1520", border: "1px solid #1a2535", borderRadius: 14, padding: "22px 24px" }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: "#e2e8f0", marginBottom: 18 }}>
            {initial ? "Edit subscription" : "Add subscription"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Name</div>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Netflix, Gym…" style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Amount ({currency})</div>
              <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Billing cycle</div>
              <select value={cycle} onChange={e => setCycle(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Next billing date</div>
              <input type="date" value={nextBill} onChange={e => setNextBill(e.target.value)} style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Start date <span style={{ color: "#8baabf", textTransform: "none", letterSpacing: 0 }}>(optional — hides sub in earlier months)</span></div>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} onFocus={focusStyle} onBlur={blurStyle} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Category</div>
            <SlCategoryPicker value={category} onChange={setCategory} allCategories={allCategories} />
          </div>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes</div>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional…" style={inp} onFocus={focusStyle} onBlur={blurStyle} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => onSave({ name: name.trim(), amount: Number(amount), cycle, category, nextBilling: nextBill, startDate: startDate || null, notes: notes || null, active: initial ? initial.active : true })}
              disabled={!valid}
              style={{ flex: 1, background: valid ? SL_ACCENT_A : "#1a2535", color: valid ? "#0f172a" : "#7a90a8", border: "none", borderRadius: 9, padding: "10px", fontWeight: 700, fontSize: 14, cursor: valid ? "pointer" : "default" }}>
              {initial ? "Save changes" : "Add subscription"}
            </button>
            <button onClick={onCancel} style={{ background: "transparent", color: "#7a90a8", border: "1px solid #7a90a8", borderRadius: 9, padding: "10px 16px", cursor: "pointer", fontSize: 14 }}>Cancel</button>
          </div>
        </div>
      );
    }

    // ─── SL Dashboard tab ─────────────────────────────────────────────────────
    // ─── SL Dashboard widgets ─────────────────────────────────────────────────

    const SL_WIDGET_DEFS = [
      { id: "monthly_summary",    label: "Monthly Summary",          icon: "💳" },
      { id: "year_heatmap",       label: "Year Heatmap",             icon: "📅" },
      { id: "budget_status",      label: "Budget Status",            icon: "🎯" },
      { id: "category_breakdown", label: "Category Breakdown",       icon: "📊" },
      { id: "top_categories",     label: "Top Categories",           icon: "🏆" },
      { id: "monthly_trend",      label: "Monthly Trend",            icon: "📈" },
      { id: "category_vs_last",   label: "Category vs Last Month",   icon: "↕️"  },
      { id: "recent_transactions",label: "Recent Transactions",      icon: "🧾" },
      { id: "upcoming_billings",  label: "Upcoming Billings",        icon: "📆" },
      { id: "subscriptions_month",label: "Subscriptions This Month", icon: "🔁" },
    ];
    const SL_DEFAULT_COLS = { monthly_summary: 1, year_heatmap: 1, category_breakdown: 1 };
    const SL_DEFAULT_LAYOUT = SL_WIDGET_DEFS.map((w, i) => ({ id: w.id, order: i, visible: true, cols: SL_DEFAULT_COLS[w.id] || 1 }));

    // Donut chart component
    function SlDonut({ data, size = 160 }) {
      const r = 54; const cx = size / 2; const cy = size / 2;
      const circ = 2 * Math.PI * r;
      const total = data.reduce((s, d) => s + d.value, 0) || 1;
      let offset = 0;
      const slices = data.map(d => {
        const pct = d.value / total;
        const dash = pct * circ;
        const slice = { ...d, dash, offset: circ - offset, pct };
        offset += dash;
        return slice;
      });
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0d1825" strokeWidth={20} />
          {slices.map((s, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={20}
              strokeDasharray={`${s.dash} ${circ - s.dash}`}
              strokeDashoffset={s.offset} />
          ))}
          <circle cx={cx} cy={cy} r={44} fill="#060d14" />
        </svg>
      );
    }

    // Widget card wrapper
    function SlWidgetCard({ children, title, editMode, dragHandleProps, colButtons }) {
      return (
        <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px 10px", borderBottom: "1px solid #080f18", flexShrink: 0 }}>
            {editMode && (
              <span {...dragHandleProps} style={{ cursor: "grab", color: "#8baabf", fontSize: 16, userSelect: "none", touchAction: "none" }}>⠿</span>
            )}
            <span style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, flex: 1 }}>{title}</span>
            {editMode && colButtons && (
              <div style={{ display: "flex", gap: 3 }}>{colButtons}</div>
            )}
          </div>
          <div style={{ padding: "16px 18px 18px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>{children}</div>
        </div>
      );
    }

    // ── Individual widgets ────────────────────────────────────────────────────

    const SL_SUMMARY_METRICS = [
      { id: "total_spent",       label: "Total spent",         always: true  },
      { id: "income",            label: "Income",              always: false },
      { id: "invested",          label: "Invested",            always: false },
      { id: "net",               label: "Net balance",         always: false },
      { id: "transactions",      label: "Transactions",        always: false },
      { id: "subscriptions",     label: "Subscriptions",       always: false },
      { id: "budget_left",       label: "Budget left",         always: false },
      { id: "largest_expense",   label: "Largest expense",     always: false },
      { id: "top_category",      label: "Top category",        always: false },
      { id: "days_with_spending",label: "Days with spending",  always: false },
      { id: "daily_average",     label: "Daily average",       always: false },
      { id: "vs_last_month",     label: "vs Last month",       always: false },
      { id: "sub_share",         label: "Subscription share",  always: false },
      { id: "categories_used",   label: "Categories used",     always: false },
    ];
    const SL_DEFAULT_SUMMARY_LAYOUT = SL_SUMMARY_METRICS.map((m, i) => ({
      id: m.id, order: i, visible: ["total_spent","transactions","subscriptions","budget_left"].includes(m.id),
    }));

    function WMonthlySummary({ monthTxs, monthSubs, total, txTotal, subTotal, incomeTotal, netTotal, investedTotal, monthIncTxs, currency, budget, transactions, monthKey, settings, onSettingsChange }) {
      const [editing, setEditing] = React.useState(false);
      const [draggingM, setDraggingM] = React.useState(null);
      const [dragOverM, setDragOverM] = React.useState(null);

      const metricLayout = settings?.summaryMetrics || SL_DEFAULT_SUMMARY_LAYOUT;
      const sorted = [...metricLayout].sort((a, b) => a.order - b.order);

      const saveMetrics = (next) => onSettingsChange({ ...settings, summaryMetrics: next });
      const toggleMetric = (id) => saveMetrics(metricLayout.map(m => m.id === id ? { ...m, visible: !m.visible } : m));
      const onMDragStart = (id) => { setDraggingM(id); setDragOverM(id); };
      const onMDragEnter = (id) => { if (draggingM && id !== draggingM) setDragOverM(id); };
      const onMDragEnd   = () => {
        if (draggingM && dragOverM && draggingM !== dragOverM) {
          const next = [...metricLayout];
          const from = next.find(m => m.id === draggingM).order;
          const to   = next.find(m => m.id === dragOverM).order;
          next.forEach(m => {
            if (m.id === draggingM) m.order = to;
            else if (from < to && m.order > from && m.order <= to) m.order--;
            else if (from > to && m.order < from && m.order >= to) m.order++;
          });
          saveMetrics(next);
        }
        setDraggingM(null); setDragOverM(null);
      };

      // Compute all metric values
      const budgetPct = budget ? Math.min(100, (total / budget) * 100) : null;
      const today2    = new Date(); const [y2, mo2] = monthKey.split("-").map(Number);
      const daysElapsed2 = (y2 === today2.getFullYear() && mo2 === today2.getMonth()+1) ? today2.getDate() : new Date(y2, mo2, 0).getDate();
      const daysInMonth2 = new Date(y2, mo2, 0).getDate();
      const catMapM = {}; monthTxs.forEach(t => { catMapM[t.category] = (catMapM[t.category]||0)+Number(t.amount); });
      const topCatM = Object.entries(catMapM).sort((a,b)=>b[1]-a[1])[0];
      const largestM = monthTxs.length ? monthTxs.reduce((a,b)=>Number(a.amount)>Number(b.amount)?a:b) : null;
      const prevKeyM = (() => { const d=new Date(y2,mo2-2,1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); })();
      const prevTotalM = transactions.filter(t=>slMonthKey(t.date)===prevKeyM&&t.type!=="income"&&!slIsNeutral(t)).reduce((s,t)=>s+Number(t.amount),0);
      const METRIC_DATA = {
        total_spent:       { label: "Total spent",        value: slFmtAmount(total, currency),          color: total > 0 ? "#e2e8f0" : "#7a90a8", sub: null },
        income:            { label: "Income",             value: slFmtAmount(incomeTotal||0, currency),  color: (incomeTotal||0) > 0 ? "#4ade80" : "#7a90a8", sub: `${(monthIncTxs||[]).length} item${(monthIncTxs||[]).length !== 1 ? "s" : ""}` },
        invested:          { label: "Invested",           value: slFmtAmount(investedTotal||0, currency), color: "#a78bfa", sub: "excl. from expenses" },
        net:               { label: "Net balance",        value: ((netTotal||0) >= 0 ? "+" : "") + slFmtAmount(netTotal||0, currency), color: (netTotal||0) >= 0 ? "#4ade80" : "#f87171", sub: (netTotal||0) >= 0 ? "surplus" : "deficit" },
        transactions:      { label: "Transactions",       value: slFmtAmount(txTotal, currency),         color: "#c8d8e8", sub: `${monthTxs.length} item${monthTxs.length !== 1 ? "s" : ""}` },
        subscriptions:     { label: "Subscriptions",      value: slFmtAmount(subTotal, currency),        color: "#c8d8e8", sub: `${monthSubs.length} billing` },
        budget_left:       { label: "Budget left",        value: budget ? slFmtAmount(budget-total, currency) : "—", color: !budget ? "#7a90a8" : total > budget ? "#f87171" : "#4ade80", sub: budget ? `of ${slFmtAmount(budget, currency)}` : "no budget set" },
        largest_expense:   { label: "Largest expense",    value: largestM ? slFmtAmount(largestM.amount, currency) : "—", color: "#c8d8e8", sub: largestM ? (largestM.notes || largestM.category) : null },
        top_category:      { label: "Top category",       value: topCatM ? topCatM[0] : "—",            color: "#c8d8e8", sub: topCatM ? slFmtAmount(topCatM[1], currency) : null },
        days_with_spending:{ label: "Days with spending", value: `${new Set(monthTxs.map(t=>t.date)).size}`, color: "#c8d8e8", sub: `of ${daysInMonth2} days` },
        daily_average:     { label: "Daily average",      value: slFmtAmount(daysElapsed2 > 0 ? total/daysElapsed2 : 0, currency), color: "#c8d8e8", sub: `over ${daysElapsed2} days` },
        vs_last_month:     { label: "vs Last month",      value: ((total-prevTotalM)>=0?"+":"")+slFmtAmount(total-prevTotalM, currency), color: (total-prevTotalM)>0?"#f87171":(total-prevTotalM)<0?"#4ade80":"#7a90a8", sub: prevTotalM>0?`prev: ${slFmtAmount(prevTotalM,currency)}`:"no data last month" },
        sub_share:         { label: "Recurring share",    value: total > 0 ? ((subTotal/total)*100).toFixed(0)+"%" : "—", color: "#c8d8e8", sub: "of total spending" },
        categories_used:   { label: "Categories used",   value: `${Object.keys(catMapM).length}`, color: "#c8d8e8", sub: Object.keys(catMapM).length === 1 ? "category" : "categories" },
      };

      const visibleMetrics = sorted.filter(m => m.visible);

      return (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 10, marginBottom: !!budget ? 14 : 0 }}>
            {visibleMetrics.map(m => {
              const d = METRIC_DATA[m.id];
              if (!d) return null;
              return (
                <div key={m.id} style={{ background: "#080f18", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{d.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: d.color, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", wordBreak: "break-word" }}>{d.value}</div>
                  {d.sub && <div style={{ fontSize: 12, color: "#7a90a8", marginTop: 3 }}>{d.sub}</div>}
                </div>
              );
            })}
          </div>

          {!!budget && (
            <div style={{ marginBottom: editing ? 14 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#7a90a8", marginBottom: 5 }}>
                <span>Budget usage</span><span>{budgetPct.toFixed(0)}%</span>
              </div>
              <div style={{ height: 5, background: "#080f18", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: budgetPct + "%", background: budgetPct > 90 ? "#f87171" : budgetPct > 70 ? "#f59e0b" : "#4ade80", borderRadius: 4, transition: "width 0.4s" }} />
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button onClick={() => setEditing(e => !e)}
              style={{ background: editing ? "#4ade8011" : "transparent", border: `1px solid ${editing ? "#4ade8033" : "#1a2535"}`, color: editing ? SL_ACCENT_A : "#8baabf", borderRadius: 6, padding: "3px 12px", cursor: "pointer", fontSize: 12 }}>
              {editing ? "Done" : "⚙ Configure"}
            </button>
          </div>

          {editing && (
            <div style={{ background: "#080f18", border: "1px solid #1a2535", borderRadius: 10, padding: "12px 14px", marginTop: 8 }}>
              <div style={{ fontSize: 12, color: "#8baabf", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Drag to reorder · click to show/hide</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {sorted.map(m => {
                  const def = SL_SUMMARY_METRICS.find(x => x.id === m.id);
                  const on  = m.visible;
                  const isOver = dragOverM === m.id && draggingM !== m.id;
                  return (
                    <div key={m.id}
                      draggable
                      onDragStart={() => onMDragStart(m.id)}
                      onDragEnter={() => onMDragEnter(m.id)}
                      onDragEnd={onMDragEnd}
                      onDragOver={e => e.preventDefault()}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 7, background: isOver ? "#4ade8011" : "transparent", border: `1px solid ${isOver ? "#4ade8033" : "transparent"}`, opacity: draggingM === m.id ? 0.4 : 1, cursor: "grab" }}>
                      <span style={{ color: "#8baabf", fontSize: 13, userSelect: "none" }}>⠿</span>
                      <span style={{ flex: 1, fontSize: 12, color: on ? "#c8d8e8" : "#7a90a8" }}>{def?.label}</span>
                      <button onClick={() => !def?.always && toggleMetric(m.id)}
                        style={{ background: on ? "#4ade8022" : "transparent", border: `1px solid ${on ? "#4ade8044" : "#1a2535"}`, color: on ? SL_ACCENT_A : "#7a90a8", borderRadius: 4, padding: "2px 8px", cursor: def?.always ? "default" : "pointer", fontSize: 12, opacity: def?.always ? 0.4 : 1 }}>
                        {on ? "Visible" : "Hidden"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }

    // ─── Year Heatmap widget ──────────────────────────────────────────────────
    function WYearHeatmap({ transactions, subscriptions, monthKey }) {
      const currentYear = parseInt(monthKey.split("-")[0]);
      const [heatYear, setHeatYear] = React.useState(currentYear);
      React.useEffect(() => setHeatYear(parseInt(monthKey.split("-")[0])), [monthKey]);

      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

      const monthlyTotals = React.useMemo(() => {
        const map = {};
        transactions.forEach(t => {
          if (t.date && t.date.startsWith(String(heatYear)) && t.type !== "income" && !slIsNeutral(t)) {
            const mk = t.date.slice(0, 7);
            map[mk] = (map[mk] || 0) + Number(t.amount);
          }
        });
        for (let m = 1; m <= 12; m++) {
          const mk = heatYear + "-" + String(m).padStart(2, "0");
          subscriptions.forEach(s => {
            if (slSubBilledInMonth(s, mk)) map[mk] = (map[mk] || 0) + Number(s.amount);
          });
        }
        return map;
      }, [transactions, subscriptions, heatYear]);

      const maxMonth = Math.max(...Object.values(monthlyTotals), 1);

      // Returns [bgColor, textColor] — high spending = red, low = green
      const heatColors = (amt, future) => {
        if (future || !amt) return ["#080f18", "#3d526a"];
        const pct = Math.min(amt / maxMonth, 1);
        if (pct < 0.2) return ["#162d1e", "#4ade80"];   // very low  → green
        if (pct < 0.4) return ["#2d2a10", "#facc15"];   // low-mid   → yellow
        if (pct < 0.6) return ["#3d2008", "#fb923c"];   // mid       → orange
        if (pct < 0.8) return ["#3d0f0f", "#f87171"];   // high      → red-light
        return ["#7f1d1d", "#fecaca"];                   // very high → deep red
      };

      const today = new Date();
      const isFuture = (i) => heatYear > today.getFullYear() || (heatYear === today.getFullYear() && i > today.getMonth());

      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Year nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, flexShrink: 0 }}>
            <button onClick={() => setHeatYear(y => y - 1)}
              style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 16, padding: "0 4px" }}
              onMouseEnter={e => e.currentTarget.style.color = "#c8d8e8"}
              onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#c8d8e8", minWidth: 34, textAlign: "center" }}>{heatYear}</span>
            <button onClick={() => setHeatYear(y => y + 1)} disabled={heatYear >= currentYear}
              style={{ background: "none", border: "none", color: heatYear >= currentYear ? "#3d526a" : "#7a90a8", cursor: heatYear >= currentYear ? "default" : "pointer", fontSize: 16, padding: "0 4px" }}
              onMouseEnter={e => { if (heatYear < currentYear) e.currentTarget.style.color = "#c8d8e8"; }}
              onMouseLeave={e => { if (heatYear < currentYear) e.currentTarget.style.color = "#7a90a8"; }}>›</button>
          </div>

          {/* 4×3 grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gridTemplateRows: "repeat(3, 1fr)", gap: 8, flex: 1 }}>
            {MONTHS.map((label, i) => {
              const mk     = heatYear + "-" + String(i + 1).padStart(2, "0");
              const amt    = monthlyTotals[mk] || 0;
              const future = isFuture(i);
              const isActive = mk === monthKey;
              const [bg, fg] = heatColors(amt, future);
              return (
                <div key={mk} style={{
                  borderRadius: 8, background: bg,
                  border: isActive ? "2px solid #60a5fa" : "2px solid transparent",
                  padding: "10px 10px",
                  display: "flex", flexDirection: "column", justifyContent: "space-between",
                  opacity: future ? 0.35 : 1,
                  transition: "border-color 0.15s",
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: fg, textTransform: "uppercase", letterSpacing: "0.07em", opacity: 0.85 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: fg, fontVariantNumeric: "tabular-nums", marginTop: 6 }}>
                    {!future && (amt ? "€" + amt.toFixed(0) : "—")}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    function WBudgetStatus({ total, budget, currency }) {
      if (!budget) return <div style={{ fontSize: 13, color: "#8baabf", textAlign: "center", padding: "20px 0" }}>No budget set. Configure one in Settings.</div>;
      const pct = Math.min(100, (total / budget) * 100);
      const left = budget - total;
      const color = pct > 90 ? "#f87171" : pct > 70 ? "#f59e0b" : "#4ade80";
      const r = 52; const circ = 2 * Math.PI * r; const dash = (pct / 100) * circ;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width={130} height={130} viewBox="0 0 130 130">
            <circle cx={65} cy={65} r={r} fill="none" stroke="#080f18" strokeWidth={18} />
            <circle cx={65} cy={65} r={r} fill="none" stroke={color} strokeWidth={18}
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ * 0.25}
              strokeLinecap="round" style={{ transition: "stroke-dasharray 0.5s" }} />
            <text x={65} y={60} textAnchor="middle" fill={color} fontSize={22} fontWeight={700} fontFamily="sans-serif">{pct.toFixed(0)}%</text>
            <text x={65} y={78} textAnchor="middle" fill="#7a90a8" fontSize={11} fontFamily="sans-serif">used</text>
          </svg>
          <div>
            <div style={{ fontSize: 13, color: "#7a90a8", marginBottom: 4 }}>Spent</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontVariantNumeric: "tabular-nums", marginBottom: 12 }}>{slFmtAmount(total, currency)}</div>
            <div style={{ fontSize: 13, color: "#7a90a8", marginBottom: 4 }}>Remaining</div>
            <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{slFmtAmount(left, currency)}</div>
            <div style={{ fontSize: 12, color: "#8baabf", marginTop: 4 }}>of {slFmtAmount(budget, currency)} budget</div>
          </div>
        </div>
      );
    }

    function WCategoryBreakdown({ catRows, maxAmt, currency, total }) {
      if (!catRows.length) return <div style={{ fontSize: 13, color: "#8baabf", textAlign: "center", padding: "20px 0" }}>No data this month.</div>;
      return (
        <div style={{ display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* Donut */}
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
            <SlDonut data={catRows.map(r => ({ value: r.amt, color: r.cat ? r.cat.color : "#7a90a8" }))} size={160} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {catRows.slice(0, 8).map(({ id, amt, cat }) => (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 9, height: 9, borderRadius: 2, background: cat ? cat.color : "#7a90a8", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "#9aaabb", minWidth: 80 }}>{cat ? cat.label : id}</span>
                  <span style={{ fontSize: 12, color: "#8baabf", fontVariantNumeric: "tabular-nums" }}>{total > 0 ? ((amt / total) * 100).toFixed(0) + "%" : "0%"}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Bars */}
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 10 }}>
            {catRows.map(({ id, amt, cat }) => (
              <div key={id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 14 }}>{cat ? cat.emoji : "❓"}</span>
                    <span style={{ fontSize: 12, color: "#c8d8e8" }}>{cat ? cat.label : id}</span>
                  </div>
                  <span style={{ fontSize: 12, color: "#9aaabb", fontVariantNumeric: "tabular-nums" }}>{slFmtAmount(amt, currency)}</span>
                </div>
                <div style={{ height: 4, background: "#080f18", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: (amt / maxAmt * 100) + "%", background: cat ? cat.color : "#7a90a8", borderRadius: 3, transition: "width 0.4s" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    function WTopCategories({ catRows, currency }) {
      if (!catRows.length) return <div style={{ fontSize: 13, color: "#8baabf", textAlign: "center", padding: "20px 0" }}>No data this month.</div>;
      const top = catRows.slice(0, 3);
      const medals = ["🥇","🥈","🥉"];
      return (
        <div style={{ display: "flex", gap: 10 }}>
          {top.map(({ id, amt, cat }, i) => (
            <div key={id} style={{ flex: 1, background: "#080f18", borderRadius: 10, padding: "14px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{medals[i]}</div>
              <div style={{ fontSize: 20, marginBottom: 6 }}>{cat ? cat.emoji : "❓"}</div>
              <div style={{ fontSize: 12, color: "#9aaabb", marginBottom: 6 }}>{cat ? cat.label : id}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: cat ? cat.color : "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{slFmtAmount(amt, currency)}</div>
            </div>
          ))}
        </div>
      );
    }

    function WMonthlyTrend({ transactions, subscriptions, currency, currentMonthKey }) {
      const ES_MONTHS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
      // view: "6m" | "12m" | "year" (calendar year of current month)
      const [view, setView] = React.useState("6m");

      const keys = React.useMemo(() => {
        const [cy, cm] = currentMonthKey.split("-").map(Number);
        if (view === "year") {
          // Jan–Dec of the current month's year, up to current month
          const result = [];
          for (let m = 1; m <= cm; m++) {
            result.push(cy + "-" + String(m).padStart(2, "0"));
          }
          return result;
        }
        const count = view === "6m" ? 6 : 12;
        const result = [];
        for (let i = count - 1; i >= 0; i--) {
          const d = new Date(cy, cm - 1 - i, 1);
          result.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
        }
        return result;
      }, [view, currentMonthKey]);

      const data = keys.map(k => {
        const txs  = transactions.filter(t => slMonthKey(t.date) === k && t.type !== "income" && !slIsNeutral(t)).reduce((s, t) => s + Number(t.amount), 0);
        const subs = subscriptions.filter(s => slSubBilledInMonth(s, k)).reduce((s, sub) => s + Number(sub.amount), 0);
        const monthIdx = parseInt(k.split("-")[1]) - 1;
        return { key: k, total: txs + subs, label: ES_MONTHS[monthIdx] };
      });

      const max = Math.max(...data.map(d => d.total), 1);
      const barW = 100 / keys.length;

      const VIEWS = [
        { id: "6m",   label: "6m" },
        { id: "12m",  label: "12m" },
        { id: "year", label: "año" },
      ];

      return (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {VIEWS.map(v => (
              <button key={v.id} onClick={() => setView(v.id)}
                style={{ background: view === v.id ? "#4ade8022" : "transparent", border: `1px solid ${view === v.id ? "#4ade8044" : "#1a2535"}`, color: view === v.id ? SL_ACCENT_A : "#7a90a8", borderRadius: 6, padding: "3px 12px", cursor: "pointer", fontSize: 12, fontWeight: view === v.id ? 600 : 400 }}>
                {v.label}
              </button>
            ))}
          </div>
          <svg width="100%" height={130} viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: "block" }}>
            {data.map((d, i) => {
              const h = (d.total / max) * 72;
              const x = i * barW + barW * 0.15;
              const w = barW * 0.7;
              const isCurrent = d.key === currentMonthKey;
              return <rect key={d.key} x={x} y={100 - h - 20} width={w} height={Math.max(h, 0.5)} fill={isCurrent ? SL_ACCENT_A : "#1e3a2f"} rx={1} />;
            })}
          </svg>
          <div style={{ display: "flex" }}>
            {data.map(d => (
              <div key={d.key} style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                <div style={{ fontSize: 11, color: d.key === currentMonthKey ? SL_ACCENT_A : "#7a90a8", overflow: "hidden", textOverflow: "clip", whiteSpace: "nowrap" }}>{d.label}</div>
                {d.total > 0 && <div style={{ fontSize: 8, color: "#8baabf", fontVariantNumeric: "tabular-nums" }}>{slFmtAmount(d.total, currency).replace(/[^0-9.,]/g, "")}</div>}
              </div>
            ))}
          </div>
        </div>
      );
    }

    function WCategoryVsLast({ transactions, subscriptions, allCategories, currency, currentMonthKey }) {
      const [y, m] = currentMonthKey.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      const lastKey = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      const getMap = (mk) => {
        const map = {};
        transactions.filter(t => slMonthKey(t.date) === mk && t.type !== "income" && !slIsNeutral(t)).forEach(t => { map[t.category] = (map[t.category] || 0) + Number(t.amount); });
        subscriptions.filter(s => slSubBilledInMonth(s, mk)).forEach(s => { map[s.category] = (map[s.category] || 0) + Number(s.amount); });
        return map;
      };
      const cur  = getMap(currentMonthKey);
      const prev = getMap(lastKey);
      const ids  = [...new Set([...Object.keys(cur), ...Object.keys(prev)])];
      if (!ids.length) return <div style={{ fontSize: 13, color: "#8baabf", textAlign: "center", padding: "20px 0" }}>No data to compare yet.</div>;
      const rows = ids.map(id => ({ id, cur: cur[id] || 0, prev: prev[id] || 0, cat: allCategories.find(c => c.id === id) }))
        .sort((a, b) => b.cur - a.cur);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, marginBottom: 2 }}>
            <span style={{ fontSize: 12, color: "#7a90a8" }}>Last month</span>
            <span style={{ fontSize: 12, color: "#7a90a8" }}>This month</span>
          </div>
          {rows.map(({ id, cur, prev, cat }) => {
            const delta = cur - prev;
            const pct   = prev > 0 ? ((delta / prev) * 100) : null;
            const up    = delta > 0;
            return (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{cat ? cat.emoji : "❓"}</span>
                <span style={{ fontSize: 12, color: "#9aaabb", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat ? cat.label : id}</span>
                <span style={{ fontSize: 12, color: "#7a90a8", fontVariantNumeric: "tabular-nums", minWidth: 60, textAlign: "right" }}>{slFmtAmount(prev, currency)}</span>
                <span style={{ fontSize: 12, color: "#e2e8f0", fontVariantNumeric: "tabular-nums", minWidth: 60, textAlign: "right" }}>{slFmtAmount(cur, currency)}</span>
                <span style={{ fontSize: 12, fontWeight: 600, minWidth: 42, textAlign: "right", color: delta === 0 ? "#7a90a8" : up ? "#f87171" : "#4ade80" }}>
                  {delta === 0 ? "—" : (up ? "▲" : "▼") + (pct !== null ? Math.abs(pct).toFixed(0) + "%" : "")}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    function WRecentTransactions({ transactions, allCategories, currency }) {
      const [count, setCount] = React.useState(5);
      const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, count);
      if (!recent.length) return <div style={{ fontSize: 13, color: "#8baabf", textAlign: "center", padding: "20px 0" }}>No transactions yet.</div>;
      return (
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {recent.map(t => {
              const cat = allCategories.find(c => c.id === t.category);
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{cat ? cat.emoji : "❓"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#c8d8e8" }}>{cat ? cat.label : t.category}</div>
                    <div style={{ fontSize: 12, color: "#7a90a8" }}>{t.date}{t.notes ? " · " + t.notes : ""}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{slFmtAmount(t.amount, currency)}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[5, 10, 20].map(n => (
              <button key={n} onClick={() => setCount(n)}
                style={{ background: count === n ? "#4ade8022" : "transparent", border: `1px solid ${count === n ? "#4ade8044" : "#1a2535"}`, color: count === n ? SL_ACCENT_A : "#7a90a8", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12 }}>
                Last {n}
              </button>
            ))}
          </div>
        </div>
      );
    }

    function WUpcomingBillings({ subscriptions, allCategories, currency }) {
      const today = new Date(); today.setHours(0,0,0,0);
      const in30  = new Date(today); in30.setDate(in30.getDate() + 30);
      const upcoming = subscriptions
        .filter(s => s.active && s.nextBilling)
        .map(s => ({ ...s, projectedDate: slNextBillingDate(s) }))
        .filter(s => s.projectedDate && s.projectedDate >= today && s.projectedDate <= in30)
        .sort((a, b) => a.projectedDate - b.projectedDate);
      if (!upcoming.length) return <div style={{ fontSize: 13, color: "#8baabf", textAlign: "center", padding: "20px 0" }}>No billings in the next 30 days.</div>;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {upcoming.map(s => {
            const cat  = allCategories.find(c => c.id === s.category);
            const days = Math.round((s.projectedDate - today) / 86400000);
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{cat ? cat.emoji : "📦"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#c8d8e8" }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: days <= 3 ? "#f59e0b" : "#7a90a8" }}>{days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`} · {slFmtDate(s.projectedDate)}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{slFmtAmount(s.amount, currency)}</span>
              </div>
            );
          })}
        </div>
      );
    }

    function WSubscriptionsMonth({ monthSubs, allCategories, currency }) {
      if (!monthSubs.length) return <div style={{ fontSize: 13, color: "#8baabf", textAlign: "center", padding: "20px 0" }}>No subscriptions billing this month.</div>;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {monthSubs.map(s => {
            const cat = allCategories.find(c => c.id === s.category);
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#080f18", borderRadius: 8, padding: "10px 12px" }}>
                <span style={{ fontSize: 18 }}>{cat ? cat.emoji : "📦"}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#c8d8e8" }}>{s.name}</span>
                <span style={{ fontSize: 12, color: "#9aaabb", fontVariantNumeric: "tabular-nums" }}>{slFmtAmount(s.amount, currency)}</span>
                <span style={{ fontSize: 12, color: "#8baabf", background: "#060d14", border: "1px solid #1a2535", borderRadius: 8, padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.cycle}</span>
              </div>
            );
          })}
        </div>
      );
    }

    // ─── SlDashboard ──────────────────────────────────────────────────────────
    function SlDashboard({ transactions, subscriptions, recurringIncome, allCategories, currency, monthKey, budget, layout, onLayoutChange, isMobile }) {
      const [editMode, setEditMode] = React.useState(false);
      const [dragging, setDragging] = React.useState(null); // { id, startY, currentOrder }
      const [dragOver, setDragOver] = React.useState(null);
      const containerRef = React.useRef(null);

      // Sorted visible widgets
      const sorted = [...layout].sort((a, b) => a.order - b.order);

      // Shared data computations
      const monthTxs      = transactions.filter(t => slMonthKey(t.date) === monthKey);
      const monthSubs     = subscriptions.filter(s => slSubBilledInMonth(s, monthKey));
      const monthExpTxs   = monthTxs.filter(t => t.type !== "income");
      const monthIncTxs   = [...monthTxs.filter(t => t.type === "income"), ...slRecIncomeEntries(recurringIncome, monthKey)];
      const monthNeutral  = monthExpTxs.filter(t => slIsNeutral(t));   // investments etc
      const monthRealExp  = monthExpTxs.filter(t => !slIsNeutral(t));  // true expenses
      const txIncTotal    = monthIncTxs.reduce((s, t) => s + Number(t.amount), 0);
      const txNeutTotal   = monthNeutral.reduce((s, t) => s + Number(t.amount), 0);
      const txExpTotal    = monthRealExp.reduce((s, t) => s + Number(t.amount), 0);
      const subTotal      = monthSubs.reduce((s, sub) => s + Number(sub.amount), 0);
      const txTotal       = txExpTotal + subTotal; // real expense total (excl. investments)
      const total         = txTotal;               // used for budget, summary etc
      const incomeTotal   = txIncTotal;
      const investedTotal = txNeutTotal;
      const netTotal      = incomeTotal - total; // investments excluded — they're not spending
      const catMap        = {};
      monthRealExp.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + Number(t.amount); });
      monthSubs.forEach(s => { catMap[s.category] = (catMap[s.category] || 0) + Number(s.amount); });
      const catRows   = Object.entries(catMap)
        .map(([id, amt]) => ({ id, amt, cat: allCategories.find(c => c.id === id) }))
        .sort((a, b) => b.amt - a.amt);
      const maxAmt = catRows[0]?.amt || 1;

      // Drag handlers
      const onDragStart = (e, id) => {
        setDragging(id);
        setDragOver(id);
        e.dataTransfer.effectAllowed = "move";
      };
      const onDragEnter = (id) => { if (dragging && id !== dragging) setDragOver(id); };
      const onDragEnd   = () => {
        if (dragging && dragOver && dragging !== dragOver) {
          const newLayout = [...layout];
          const fromOrder = newLayout.find(w => w.id === dragging).order;
          const toOrder   = newLayout.find(w => w.id === dragOver).order;
          newLayout.forEach(w => {
            if (w.id === dragging) w.order = toOrder;
            else if (fromOrder < toOrder && w.order > fromOrder && w.order <= toOrder) w.order--;
            else if (fromOrder > toOrder && w.order < fromOrder && w.order >= toOrder) w.order++;
          });
          onLayoutChange(newLayout);
        }
        setDragging(null); setDragOver(null);
      };
      const toggleVisible = (id) => {
        onLayoutChange(layout.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
      };

      const updateWidgetSettings = (id, settings) => {
        onLayoutChange(layout.map(w => w.id === id ? { ...w, settings } : w));
      };

      const renderWidget = (w) => {
        const def = SL_WIDGET_DEFS.find(d => d.id === w.id);
        if (!def) return null;
        const cols = w.cols || 1;
        const dragProps = editMode ? { draggable: true, onDragStart: e => onDragStart(e, w.id), onDragEnter: () => onDragEnter(w.id), onDragEnd, onDragOver: e => e.preventDefault() } : {};
        const isOver    = dragOver === w.id && dragging !== w.id;
        const colButtons = [1,2,3].map(c => (
          <button key={c} onClick={() => onLayoutChange(layout.map(x => x.id === w.id ? { ...x, cols: c } : x))}
            style={{ background: cols === c ? "#4ade8022" : "transparent", border: `1px solid ${cols === c ? "#4ade8055" : "#1a2535"}`, color: cols === c ? SL_ACCENT_A : "#5a7080", borderRadius: 4, padding: "1px 7px", cursor: "pointer", fontSize: 11, fontWeight: cols === c ? 700 : 400 }}>
            {c}
          </button>
        ));
        return (
          <div key={w.id} {...dragProps}
            style={{ opacity: dragging === w.id ? 0.4 : 1, outline: isOver ? `2px solid ${SL_ACCENT_A}` : "none", borderRadius: 14, transition: "opacity 0.15s", height: "100%" }}>
            <SlWidgetCard title={def.label} editMode={editMode} dragHandleProps={{ draggable: false }} colButtons={colButtons}>
              {w.id === "monthly_summary"    && <WMonthlySummary monthTxs={monthRealExp} monthSubs={monthSubs} total={total} txTotal={txExpTotal} subTotal={subTotal} incomeTotal={incomeTotal} netTotal={netTotal} investedTotal={investedTotal} monthIncTxs={monthIncTxs} currency={currency} budget={budget} transactions={transactions} monthKey={monthKey} settings={w.settings} onSettingsChange={s => updateWidgetSettings(w.id, s)} />}
              {w.id === "year_heatmap"       && <WYearHeatmap transactions={transactions} subscriptions={subscriptions} monthKey={monthKey} />}
              {w.id === "budget_status"      && <WBudgetStatus total={total} budget={budget} currency={currency} />}
              {w.id === "category_breakdown" && <WCategoryBreakdown catRows={catRows} maxAmt={maxAmt} currency={currency} total={total} />}
              {w.id === "top_categories"     && <WTopCategories catRows={catRows} currency={currency} />}
              {w.id === "monthly_trend"      && <WMonthlyTrend transactions={transactions} subscriptions={subscriptions} currency={currency} currentMonthKey={monthKey} />}
              {w.id === "category_vs_last"   && <WCategoryVsLast transactions={transactions} subscriptions={subscriptions} allCategories={allCategories} currency={currency} currentMonthKey={monthKey} />}
              {w.id === "recent_transactions"&& <WRecentTransactions transactions={transactions} allCategories={allCategories} currency={currency} />}
              {w.id === "upcoming_billings"  && <WUpcomingBillings subscriptions={subscriptions} allCategories={allCategories} currency={currency} />}
              {w.id === "subscriptions_month"&& <WSubscriptionsMonth monthSubs={monthSubs} allCategories={allCategories} currency={currency} />}
            </SlWidgetCard>
          </div>
        );
      };

      return (
        <div style={{ padding: isMobile ? "16px 12px 80px" : "20px 24px 60px" }} ref={containerRef}>
          {/* Edit mode toolbar — desktop only */}
          <div style={{ display: isMobile ? "none" : "flex", justifyContent: "flex-end", gap: 8, marginBottom: 16 }}>
            {editMode && (
              <button onClick={() => { onLayoutChange(SL_DEFAULT_LAYOUT); }}
                style={{ background: "transparent", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#f87171"; e.currentTarget.style.color = "#f87171"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a2535"; e.currentTarget.style.color = "#7a90a8"; }}>
                ↺ Reset layout
              </button>
            )}
            <button onClick={() => setEditMode(e => !e)}
              style={{ background: editMode ? "#4ade8022" : "transparent", border: `1px solid ${editMode ? "#4ade8044" : "#1a2535"}`, color: editMode ? SL_ACCENT_A : "#7a90a8", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: editMode ? 600 : 400 }}>
              {editMode ? "Done" : "✦ Edit dashboard"}
            </button>
          </div>

          {/* Widget visibility picker (edit mode, desktop only) */}
          {editMode && !isMobile && (
            <div style={{ background: "#080f18", border: "1px solid #1a2535", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#8baabf", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Show / hide widgets</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {SL_WIDGET_DEFS.map(def => {
                  const w = layout.find(x => x.id === def.id);
                  const on = w?.visible !== false;
                  return (
                    <button key={def.id} onClick={() => toggleVisible(def.id)}
                      style={{ display: "flex", alignItems: "center", gap: 6, background: on ? "#4ade8011" : "transparent", border: `1px solid ${on ? "#4ade8033" : "#1a2535"}`, borderRadius: 20, padding: "4px 12px", cursor: "pointer", color: on ? SL_ACCENT_A : "#7a90a8", fontSize: 12 }}>
                      <span>{def.icon}</span> {def.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Widgets — CSS grid, each widget has cols 1-3; on mobile always 1-col */}
          {(() => {
            const visible = sorted.filter(w => w.visible !== false);
            return (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gridAutoRows: isMobile ? "auto" : "1fr", gap: 14, gridAutoFlow: "dense" }}>
                {visible.map(w => {
                  const cols = isMobile ? 1 : Math.min(w.cols || 1, 3);
                  return (
                    <div key={w.id} style={{ gridColumn: `span ${cols}`, minWidth: 0 }}>
                      {renderWidget(w)}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      );
    }

    // ─── SL Recurring income form ─────────────────────────────────────────────
    function SlRecurringIncomeForm({ allIncomeCategories, paymentMethods, currency, initial, viewMonthKey, onSave, onCancel }) {
      const isMob = useIsMobile();
      const today = new Date().toISOString().slice(0, 10);
      const defaultCat = allIncomeCategories.find(c => c.id === "salary") ? "salary" : "";
      const initAmount = initial ? String(slRecBaseAmount(initial, viewMonthKey)) : "";
      const [name,       setName]       = React.useState(initial ? initial.name : "Salary");
      const [amount,     setAmount]     = React.useState(initAmount);
      const [scope,      setScope]      = React.useState("from");   // "from" viewed month | "all"
      const [category,   setCategory]   = React.useState(initial ? initial.category : defaultCat);
      const [payMethod,  setPayMethod]  = React.useState(initial ? (initial.paymentMethod || "") : "Bank transfer");
      const [firstDate,  setFirstDate]  = React.useState(initial ? initial.firstDate : today);
      const [endDate,    setEndDate]    = React.useState(initial ? (initial.endDate || "") : "");
      const [extraMonths,setExtraMonths]= React.useState(initial ? (initial.extraMonths || []) : []);
      const [extraAmt,   setExtraAmt]   = React.useState(initial && initial.extraAmount != null ? String(initial.extraAmount) : "");
      const amountChanged = initial && Number(amount) !== Number(initAmount);
      const startMk = firstDate ? slMonthKey(firstDate) : null;
      const canScopeFrom = initial && startMk && viewMonthKey > startMk;
      const valid = name.trim() && amount && Number(amount) > 0 && category && firstDate && (!endDate || endDate >= firstDate)
        && (extraAmt === "" || Number(extraAmt) >= 0);
      const inp = { background: "#080f18", border: "1px solid #7a90a8", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 14, width: "100%", boxSizing: "border-box" };
      const focusStyle = e => e.target.style.borderColor = "#4ade8066";
      const blurStyle  = e => e.target.style.borderColor = "#7a90a8";
      const lbl = (t, hint) => (
        <div style={{ fontSize: 12, color: "#7a90a8", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {t}{hint && <span style={{ color: "#8baabf", textTransform: "none", letterSpacing: 0 }}> {hint}</span>}
        </div>
      );
      const toggleExtra = (m) => setExtraMonths(xs => xs.includes(m) ? xs.filter(x => x !== m) : [...xs, m].sort((a, b) => a - b));

      const save = () => {
        const amt = Number(amount);
        let amounts;
        if (!initial) {
          amounts = [{ from: startMk, amount: amt }];
        } else if (!amountChanged) {
          amounts = initial.amounts;                       // history untouched
        } else if (scope === "from" && canScopeFrom) {
          amounts = [...(initial.amounts || []).filter(h => h.from < viewMonthKey), { from: viewMonthKey, amount: amt }];
        } else {
          amounts = [{ from: startMk, amount: amt }];
        }
        onSave({
          name: name.trim(), category, paymentMethod: payMethod || null,
          firstDate, endDate: endDate || null, amounts,
          extraMonths, extraAmount: extraMonths.length && extraAmt !== "" ? Number(extraAmt) : null,
          overrides: initial ? (initial.overrides || {}) : {},
        });
      };

      return (
        <div style={{ background: "#0b1520", border: "1px solid #1a2535", borderRadius: 14, padding: "22px 24px" }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 16, color: "#e2e8f0", marginBottom: 18 }}>
            🔁 {initial ? "Edit recurring income" : "Add recurring income"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              {lbl("Name")}
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Salary, pension…" style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
            <div>
              {lbl(`Monthly amount (${currency})`)}
              <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
          </div>
          {amountChanged && canScopeFrom && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: 12 }}>
              {[["from", `From ${slMonthLabel(viewMonthKey)} on`], ["all", "All months (rewrite history)"]].map(([id, label]) => (
                <button key={id} onClick={() => setScope(id)}
                  style={{ background: scope === id ? "#4ade8022" : "transparent", border: `1px solid ${scope === id ? "#4ade8066" : "#1a2535"}`, color: scope === id ? "#4ade80" : "#7a90a8", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: scope === id ? 700 : 400 }}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              {lbl("First payment", "(sets the pay day)")}
              <input type="date" value={firstDate} onChange={e => setFirstDate(e.target.value)} style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
            <div>
              {lbl("Last payment", "(optional)")}
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              {lbl("Category")}
              <SlCategoryPicker value={category} onChange={setCategory} allCategories={allIncomeCategories} />
            </div>
            <div>
              {lbl("Source")}
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ ...inp, cursor: "pointer" }} onFocus={focusStyle} onBlur={blurStyle}>
                <option value="">— Optional —</option>
                {(paymentMethods || SL_DEFAULT_PAYMENT_METHODS).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 18 }}>
            {lbl("Extra payments", "(optional — e.g. pagas extra in June and December)")}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: extraMonths.length ? 10 : 0 }}>
              {SL_MONTH_SHORT.map((m, i) => {
                const on = extraMonths.includes(i + 1);
                return (
                  <button key={m} onClick={() => toggleExtra(i + 1)}
                    style={{ background: on ? "#4ade8022" : "transparent", border: `1px solid ${on ? "#4ade8066" : "#1a2535"}`, color: on ? "#4ade80" : "#7a90a8", borderRadius: 7, padding: "4px 9px", cursor: "pointer", fontSize: 12, fontWeight: on ? 700 : 400, minWidth: 42 }}>{m}</button>
                );
              })}
            </div>
            {extraMonths.length > 0 && (
              <input type="number" min="0" step="0.01" value={extraAmt} onChange={e => setExtraAmt(e.target.value)}
                placeholder={`Extra amount (${currency}) — empty = same as the monthly amount`} style={inp} onFocus={focusStyle} onBlur={blurStyle} />
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={save} disabled={!valid}
              style={{ flex: 1, background: valid ? SL_ACCENT_A : "#1a2535", color: valid ? "#0f172a" : "#7a90a8", border: "none", borderRadius: 9, padding: "10px", fontWeight: 700, fontSize: 14, cursor: valid ? "pointer" : "default" }}>
              {initial ? "Save changes" : "Add recurring income"}
            </button>
            <button onClick={onCancel} style={{ background: "transparent", color: "#7a90a8", border: "1px solid #7a90a8", borderRadius: 9, padding: "10px 16px", cursor: "pointer", fontSize: 14 }}>Cancel</button>
          </div>
        </div>
      );
    }

    // ─── SL Income tab ────────────────────────────────────────────────────────
    function SlIncome({ transactions, allIncomeCategories, paymentMethods, currency, monthKey, onAdd, onEdit, onDelete,
                        recurringIncome, recLoadError, recSaveError, onRecSave, onRecRetry }) {
      const [showForm,   setShowForm]   = React.useState(false);
      const [editEntry,  setEditEntry]  = React.useState(null);
      const [confirmDel, setConfirmDel] = React.useState(null);
      const [recForm,    setRecForm]    = React.useState(null);   // null | "new" | series
      const [recConfirm, setRecConfirm] = React.useState(null);   // series id pending delete
      const [adjusting,  setAdjusting]  = React.useState(null);   // { id, value }
      const recReady = Array.isArray(recurringIncome);
      const series   = recReady ? recurringIncome : [];
      const todayStr = new Date().toISOString().slice(0, 10);

      const realInc = transactions.filter(t => t.type === "income" && slMonthKey(t.date) === monthKey);
      const recAll  = series.map(r => slRecIncomeForMonth(r, monthKey)).filter(Boolean);   // incl. skipped
      const rows    = [...realInc, ...recAll].sort((a, b) => b.date.localeCompare(a.date));
      const monthTotal = [...realInc, ...recAll.filter(e => !e.skipped)].reduce((s, t) => s + Number(t.amount), 0);

      const handleSave = (data) => {
        const entry = { ...data, type: "income" };
        if (editEntry) { onEdit({ ...editEntry, ...entry }); setEditEntry(null); }
        else { onAdd({ id: slUuid(), ...entry }); setShowForm(false); }
      };

      // ── series operations ──
      const saveSeries = (data) => {
        if (recForm === "new") onRecSave([...series, { id: slUuid(), ...data }]);
        else onRecSave(series.map(r => r.id === recForm.id ? { ...r, ...data } : r));
        setRecForm(null);
      };
      const setOverride = (rid, mk, ov) => onRecSave(series.map(r => {
        if (r.id !== rid) return r;
        const overrides = { ...(r.overrides || {}) };
        if (ov) overrides[mk] = ov; else delete overrides[mk];
        return { ...r, overrides };
      }));
      const stopAfter = (rid) => onRecSave(series.map(r => r.id === rid ? { ...r, endDate: monthKey + "-" + String(slDaysInMonth(monthKey)).padStart(2, "0") } : r));
      const commitAdjust = (e) => {
        const v = adjusting.value === "" ? null : Number(adjusting.value);
        setAdjusting(null);
        if (v == null || isNaN(v) || v < 0) return;
        if (Math.abs(v - e.scheduled) < 0.005) setOverride(e.recurringId, monthKey, null);
        else setOverride(e.recurringId, monthKey, { amount: v });
      };

      const smallBtn = (label, onClick, color = "#7a90a8", hover = "#9aaabb") => (
        <button onClick={onClick} style={{ background: "none", border: "1px solid #1a2535", color, cursor: "pointer", fontSize: 11, padding: "3px 8px", borderRadius: 6 }}
          onMouseEnter={ev => ev.currentTarget.style.color = hover} onMouseLeave={ev => ev.currentTarget.style.color = color}>{label}</button>
      );
      const badge = (text, color) => (
        <span style={{ fontSize: 10, color, background: color + "15", border: `1px solid ${color}33`, borderRadius: 10, padding: "1px 7px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{text}</span>
      );

      return (
        <div style={{ padding: "28px 28px 60px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Income this month</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#4ade80", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
                +{slFmtAmount(monthTotal, currency)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setRecForm("new"); setShowForm(false); setEditEntry(null); }} disabled={!recReady}
                style={{ background: "transparent", color: recReady ? "#4ade80" : "#3d5268", border: `1px solid ${recReady ? "#4ade8066" : "#1a2535"}`, borderRadius: 9, padding: "8px 14px", cursor: recReady ? "pointer" : "default", fontWeight: 700, fontSize: 13 }}>
                🔁 Recurring
              </button>
              <button onClick={() => { setShowForm(true); setEditEntry(null); setRecForm(null); }}
                style={{ background: "#4ade80", color: "#0f172a", border: "none", borderRadius: 9, padding: "8px 18px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                + Add income
              </button>
            </div>
          </div>

          {recLoadError && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#2d1518", border: "1px solid #5a2a30", borderRadius: 10, color: "#f87171", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span>Recurring income couldn't be loaded ({recLoadError}). It isn't counted in totals until it loads.</span>
              <button onClick={onRecRetry} style={{ background: "#f87171", color: "#0f172a", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>Retry</button>
            </div>
          )}
          {recSaveError && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#2d1518", border: "1px solid #5a2a30", borderRadius: 10, color: "#f87171", fontSize: 13 }}>
              The last recurring-income change couldn't be saved: {recSaveError}
            </div>
          )}

          {recForm && (
            <div style={{ marginBottom: 20 }}>
              <SlRecurringIncomeForm allIncomeCategories={allIncomeCategories} paymentMethods={paymentMethods} currency={currency}
                initial={recForm === "new" ? null : recForm} viewMonthKey={monthKey} onSave={saveSeries} onCancel={() => setRecForm(null)} />
            </div>
          )}
          {(showForm && !editEntry) && (
            <div style={{ marginBottom: 20 }}>
              <SlTransactionForm allExpenseCategories={[]} allIncomeCategories={allIncomeCategories} currency={currency} paymentMethods={paymentMethods} onSave={handleSave} onCancel={() => setShowForm(false)} initial={{ type: "income" }} />
            </div>
          )}
          {editEntry && (
            <div style={{ marginBottom: 20 }}>
              <SlTransactionForm allExpenseCategories={[]} allIncomeCategories={allIncomeCategories} currency={currency} paymentMethods={paymentMethods} initial={editEntry} onSave={handleSave} onCancel={() => setEditEntry(null)} />
            </div>
          )}

          {/* ── This month ── */}
          {rows.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#7a90a8" }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>📥</div>
              <div style={{ fontSize: 14 }}>No income recorded this month.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rows.map(t => {
                const cat = allIncomeCategories.find(c => c.id === t.category);
                if (t.recurringId) {
                  const isAdj = adjusting?.id === t.id;
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0d1825", border: "1px solid #1a2535", borderLeft: "3px solid #4ade8066", borderRadius: 10, padding: "12px 16px", opacity: t.skipped ? 0.5 : 1, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{cat ? cat.emoji : "📥"}</span>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {t.recurringName}
                          {badge("🔁 recurring", "#4ade80")}
                          {t.extra && badge("extra pay", "#22d3ee")}
                          {t.adjusted && badge("adjusted", "#f59e0b")}
                          {t.skipped && badge("skipped", "#94a3b8")}
                          {!t.skipped && t.date > todayStr && badge("expected", "#a78bfa")}
                        </div>
                        <div style={{ fontSize: 12, color: "#7a90a8", marginTop: 2 }}>
                          {t.date}{cat ? " · " + cat.label : ""}{t.paymentMethod ? " · " + t.paymentMethod : ""}
                          {t.adjusted && <> · scheduled {slFmtAmount(t.scheduled, currency)}</>}
                        </div>
                      </div>
                      {isAdj ? (
                        <input type="number" min="0" step="0.01" autoFocus value={adjusting.value}
                          onChange={e => setAdjusting({ id: t.id, value: e.target.value })}
                          onKeyDown={e => { if (e.key === "Enter") commitAdjust(t); if (e.key === "Escape") setAdjusting(null); }}
                          onBlur={() => commitAdjust(t)}
                          style={{ width: 120, background: "#080f18", border: "1px solid #4ade8066", borderRadius: 8, padding: "6px 10px", color: "#e2e8f0", fontSize: 14, textAlign: "right" }} />
                      ) : (
                        <span style={{ fontSize: 15, color: t.skipped ? "#7a90a8" : "#4ade80", fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0, textDecoration: t.skipped ? "line-through" : "none" }}>+{slFmtAmount(t.amount, currency)}</span>
                      )}
                      {recReady && !isAdj && (
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          {t.skipped
                            ? smallBtn("Restore", () => setOverride(t.recurringId, monthKey, null))
                            : <>
                                {smallBtn("Adjust", () => setAdjusting({ id: t.id, value: String(t.amount) }))}
                                {t.adjusted && smallBtn("Reset", () => setOverride(t.recurringId, monthKey, null))}
                                {smallBtn("Skip", () => setOverride(t.recurringId, monthKey, { skip: true }), "#7a90a8", "#f87171")}
                              </>}
                        </div>
                      )}
                    </div>
                  );
                }
                return confirmDel === t.id ? (
                  <div key={t.id} style={{ background: "#2d1518", border: "1px solid #5a2a3044", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#f87171" }}>
                    Delete this income entry?
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button onClick={() => { onDelete(t.id); setConfirmDel(null); }} style={{ background: "#f87171", color: "#0f172a", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Delete</button>
                      <button onClick={() => setConfirmDel(null)} style={{ background: "transparent", color: "#7a90a8", border: "1px solid #8baabf", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, padding: "12px 16px", transition: "border-color 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#4ade8044"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{cat ? cat.emoji : "📥"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 600 }}>{cat ? cat.label : t.category}</div>
                      <div style={{ fontSize: 12, color: "#7a90a8", marginTop: 2 }}>{t.date}{t.notes ? " · " + t.notes : ""}{t.paymentMethod ? " · " + t.paymentMethod : ""}</div>
                    </div>
                    <span style={{ fontSize: 15, color: "#4ade80", fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>+{slFmtAmount(t.amount, currency)}</span>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => { setEditEntry(t); setShowForm(false); }} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 5 }}
                        onMouseEnter={e => e.currentTarget.style.color = "#9aaabb"} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>✏️</button>
                      <button onClick={() => setConfirmDel(t.id)} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 5 }}
                        onMouseEnter={e => e.currentTarget.style.color = "#f87171"} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Recurring series ── */}
          {series.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ fontSize: 11, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Recurring income</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {series.map(r => {
                  const cat = allIncomeCategories.find(c => c.id === r.category);
                  const ended = r.endDate && slMonthKey(r.endDate) < slTodayKey();
                  const endsThisView = r.endDate && slMonthKey(r.endDate) <= monthKey;
                  return recConfirm === r.id ? (
                    <div key={r.id} style={{ background: "#2d1518", border: "1px solid #5a2a3044", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#f87171" }}>
                      Delete "{r.name}" and all its months (past ones included)? To keep its history, use "End" instead.
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button onClick={() => { onRecSave(series.filter(x => x.id !== r.id)); setRecConfirm(null); }} style={{ background: "#f87171", color: "#0f172a", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Delete</button>
                        <button onClick={() => setRecConfirm(null)} style={{ background: "transparent", color: "#7a90a8", border: "1px solid #8baabf", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0b1520", border: "1px solid #1a2535", borderRadius: 10, padding: "10px 16px", opacity: ended ? 0.55 : 1, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{cat ? cat.emoji : "🔁"}</span>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 600 }}>{r.name}</div>
                        <div style={{ fontSize: 12, color: "#7a90a8", marginTop: 2 }}>
                          {slFmtAmount(slRecCurrentAmount(r), currency)} / month · day {Number(r.firstDate.slice(8, 10))}
                          {(r.extraMonths || []).length > 0 && <> · extra: {r.extraMonths.map(m => SL_MONTH_SHORT[m - 1]).join(", ")}</>}
                          {" · "}since {slMonthKey(r.firstDate)}{r.endDate ? " until " + slMonthKey(r.endDate) : ""}
                          {(r.amounts || []).length > 1 && <> · {r.amounts.length} amount changes</>}
                        </div>
                      </div>
                      {recReady && (
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          {!endsThisView && smallBtn(`End after ${SL_MONTH_SHORT[Number(monthKey.slice(5, 7)) - 1]}`, () => stopAfter(r.id))}
                          <button onClick={() => { setRecForm(r); setShowForm(false); setEditEntry(null); }} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 5 }}
                            onMouseEnter={e => e.currentTarget.style.color = "#9aaabb"} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>✏️</button>
                          <button onClick={() => setRecConfirm(r.id)} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 5 }}
                            onMouseEnter={e => e.currentTarget.style.color = "#f87171"} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>🗑</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }

    // ─── SL Transactions tab ──────────────────────────────────────────────────
    function SlTransactions({ transactions, allExpenseCategories, allIncomeCategories, allCategories, paymentMethods, currency, monthKey, onAdd, onEdit, onDelete }) {
      const [showForm,  setShowForm]  = React.useState(false);
      const [editEntry, setEditEntry] = React.useState(null);
      const [confirmDel, setConfirmDel] = React.useState(null);
      const monthTxs = transactions
        .filter(t => t.type !== "income" && slMonthKey(t.date) === monthKey)
        .sort((a, b) => b.date.localeCompare(a.date));

      const handleSave = (data) => {
        if (editEntry) { onEdit({ ...editEntry, ...data }); setEditEntry(null); }
        else { onAdd({ id: slUuid(), ...data }); setShowForm(false); }
      };

      return (
        <div style={{ padding: "28px 28px 60px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: "#7a90a8" }}>{monthTxs.length} transaction{monthTxs.length !== 1 ? "s" : ""}</div>
            <button onClick={() => { setShowForm(true); setEditEntry(null); }}
              style={{ background: SL_ACCENT_A, color: "#0f172a", border: "none", borderRadius: 9, padding: "8px 18px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              + Add
            </button>
          </div>

          {(showForm && !editEntry) && (
            <div style={{ marginBottom: 20 }}>
              <SlTransactionForm allExpenseCategories={allExpenseCategories} allIncomeCategories={allIncomeCategories} currency={currency} paymentMethods={paymentMethods} onSave={handleSave} onCancel={() => setShowForm(false)} />
            </div>
          )}

          {editEntry && (
            <div style={{ marginBottom: 20 }}>
              <SlTransactionForm allExpenseCategories={allExpenseCategories} allIncomeCategories={allIncomeCategories} currency={currency} paymentMethods={paymentMethods} initial={editEntry} onSave={handleSave} onCancel={() => setEditEntry(null)} />
            </div>
          )}

          {monthTxs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#8baabf" }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>🧾</div>
              <div style={{ fontSize: 14 }}>No transactions this month.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {monthTxs.map(t => {
                const cat = allCategories.find(c => c.id === t.category);
                return confirmDel === t.id ? (
                  <div key={t.id} style={{ background: "#2d1518", border: "1px solid #5a2a3044", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#f87171" }}>
                    Delete this transaction?
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button onClick={() => { onDelete(t.id); setConfirmDel(null); }} style={{ background: "#f87171", color: "#0f172a", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Delete</button>
                      <button onClick={() => setConfirmDel(null)} style={{ background: "transparent", color: "#7a90a8", border: "1px solid #8baabf", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, padding: "12px 16px", transition: "border-color 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#8baabf"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{cat ? cat.emoji : "❓"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, color: "#c8d8e8", fontWeight: 600 }}>{cat ? cat.label : t.category}</span>
                        {t.type === "income" && <span style={{ fontSize: 10, color: "#4ade80", background: "#4ade8015", border: "1px solid #4ade8033", borderRadius: 10, padding: "1px 7px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>income</span>}
                        {slIsNeutral(t) && <span style={{ fontSize: 10, color: "#a78bfa", background: "#a78bfa15", border: "1px solid #a78bfa33", borderRadius: 10, padding: "1px 7px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>invested</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#7a90a8", marginTop: 2 }}>{t.date}{t.notes ? " · " + t.notes : ""}{t.paymentMethod ? " · " + t.paymentMethod : ""}</div>
                    </div>
                    <span style={{ fontSize: 15, color: t.type === "income" ? "#4ade80" : "#e2e8f0", fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{t.type === "income" ? "+" : ""}{slFmtAmount(t.amount, currency)}</span>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => { setEditEntry(t); setShowForm(false); }} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 5 }}
                        onMouseEnter={e => e.currentTarget.style.color = "#9aaabb"} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>✏️</button>
                      <button onClick={() => setConfirmDel(t.id)} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 5 }}
                        onMouseEnter={e => e.currentTarget.style.color = "#f87171"} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // ─── SL Subscriptions tab ─────────────────────────────────────────────────
    function SlSubscriptions({ subscriptions, allCategories, currency, onAdd, onEdit, onDelete, onToggle }) {
      const [showForm,   setShowForm]   = React.useState(false);
      const [editEntry,  setEditEntry]  = React.useState(null);
      const [confirmDel, setConfirmDel] = React.useState(null);
      const active   = subscriptions.filter(s => s.active).sort((a, b) => (a.nextBilling || "").localeCompare(b.nextBilling || ""));
      const inactive = subscriptions.filter(s => !s.active);
      const mrr = active.reduce((s, sub) => s + slMonthlyCost(sub), 0);

      const handleSave = (data) => {
        if (editEntry) { onEdit({ ...editEntry, ...data }); setEditEntry(null); }
        else { onAdd({ id: slUuid(), ...data }); setShowForm(false); }
      };

      const SubCard = ({ s }) => {
        const cat = allCategories.find(c => c.id === s.category);
        const projDate  = slNextBillingDate(s);
        const today     = new Date(); today.setHours(0,0,0,0);
        const daysUntil = projDate ? Math.round((projDate - today) / 86400000) : null;
        return confirmDel === s.id ? (
          <div style={{ background: "#2d1518", border: "1px solid #5a2a3044", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#f87171" }}>
            Delete "{s.name}"?
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => { onDelete(s.id); setConfirmDel(null); }} style={{ background: "#f87171", color: "#0f172a", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Delete</button>
              <button onClick={() => setConfirmDel(null)} style={{ background: "transparent", color: "#7a90a8", border: "1px solid #8baabf", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, padding: "14px 16px", opacity: s.active ? 1 : 0.45, transition: "border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#8baabf"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>{cat ? cat.emoji : "📦"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600, marginBottom: 2 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: "#7a90a8" }}>
                {cat ? cat.label : s.category}
                {s.startDate && <span> · since {s.startDate}</span>}
                {projDate && daysUntil !== null && <span style={{ color: daysUntil <= 7 ? "#f59e0b" : "#7a90a8" }}> · {daysUntil === 0 ? "due today" : daysUntil < 0 ? `overdue ${Math.abs(daysUntil)}d` : `in ${daysUntil}d`} ({slFmtDate(projDate)})</span>}
                {s.notes && " · " + s.notes}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 15, color: "#e2e8f0", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{slFmtAmount(s.amount, currency)}</div>
              <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {s.cycle}{s.cycle === "annual" ? <span style={{ color: "#8baabf" }}> ({slFmtAmount(slMonthlyCost(s), currency)}/mo)</span> : ""}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
              <button onClick={() => onToggle(s.id)} title={s.active ? "Pause" : "Activate"}
                style={{ background: s.active ? "#4ade8022" : "#1a2535", border: `1px solid ${s.active ? "#4ade8044" : "#1a2535"}`, color: s.active ? "#4ade80" : "#7a90a8", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 12 }}>
                {s.active ? "Active" : "Paused"}
              </button>
              <div style={{ display: "flex", gap: 3 }}>
                <button onClick={() => { setEditEntry(s); setShowForm(false); }} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 12, padding: "2px 5px" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#9aaabb"} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>✏️</button>
                <button onClick={() => setConfirmDel(s.id)} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 12, padding: "2px 5px" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#f87171"} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>🗑</button>
              </div>
            </div>
          </div>
        );
      };

      return (
        <div style={{ padding: "28px 28px 60px" }}>
          {/* MRR header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Monthly recurring</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#e2e8f0", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{slFmtAmount(mrr, currency)}<span style={{ fontSize: 12, color: "#7a90a8", fontWeight: 400 }}>/mo</span></div>
            </div>
            <button onClick={() => { setShowForm(true); setEditEntry(null); }}
              style={{ background: SL_ACCENT_A, color: "#0f172a", border: "none", borderRadius: 9, padding: "8px 18px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              + Add
            </button>
          </div>

          {(showForm && !editEntry) && (
            <div style={{ marginBottom: 20 }}>
              <SlSubscriptionForm allCategories={allCategories} currency={currency} onSave={handleSave} onCancel={() => setShowForm(false)} />
            </div>
          )}
          {editEntry && (
            <div style={{ marginBottom: 20 }}>
              <SlSubscriptionForm allCategories={allCategories} currency={currency} initial={editEntry} onSave={handleSave} onCancel={() => setEditEntry(null)} />
            </div>
          )}

          {subscriptions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#8baabf" }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>🔁</div>
              <div style={{ fontSize: 14 }}>No subscriptions yet.</div>
            </div>
          ) : (
            <>
              {active.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 12, color: "#8baabf", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, marginBottom: 10 }}>Active · {active.length}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {active.map(s => <SubCard key={s.id} s={s} />)}
                  </div>
                </div>
              )}
              {inactive.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: "#8baabf", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, marginBottom: 10 }}>Paused · {inactive.length}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {inactive.map(s => <SubCard key={s.id} s={s} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    // ─── SL Emoji picker ──────────────────────────────────────────────────────
    const SL_EMOJI_GRID = [
      // Work & professional
      "💼","🗂️","📋","📊","📈","📉","🖥️","💻","🖨️","⌨️","🖱️","📱","☎️","📞","📟","📠","🔑","🏢","🏗️","👔","👩‍💼","👨‍💼","🤝","📝","✏️","🖊️","📌","📍","📎","🗓️",
      // Money & finance
      "💰","💵","💴","💶","💷","💳","🏧","💹","🪙","💸","🏦","📦","🧾","⚖️","🏪","🛒","🛍️","🏷️","💎","📊",
      // Food & drink
      "🍕","🍔","🌮","🌯","🥗","🍣","🍜","🍝","🥘","🍲","🥙","🧆","🥚","🍳","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🥪","🧀","🥦","🥕","🌽","🍅","🍱","🍛","🍤","🦐","🦞","🦀","🦑","🐟","🥫","🍞","🥐","🥨","🧁","🎂","🍰","🍩","🍪","🍫","🍬","🍭","🍮","🍯","🍎","🍊","🍋","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🍆","🥑","🫒",
      "☕","🍵","🧃","🥤","🧋","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🧊",
      // Home & living
      "🏠","🏡","🏘️","🛋️","🪑","🛏️","🚿","🛁","🪥","🧼","🪒","🧹","🧺","🧻","🪣","🧴","🪞","🚪","🪟","💡","🔦","🕯️","🪔","🧯","🛠️","🔧","🔨","🪛","🪚","⚙️","🔩","🗜️","🧲","🪜","🪤","🧱","🏗️",
      // Transport
      "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🏍️","🛵","🚲","🛴","🛺","🚁","✈️","🚀","🛸","⛵","🚤","🛥️","🚂","🚆","🚇","🚈","🚉","🚊","🚝","🚞","🚋","⛽","🛞","🅿️","🚦","🛣️",
      // Health & body
      "💊","💉","🩺","🩹","🏥","🩻","🧬","🔬","🧪","🫀","🫁","🦷","👁️","👂","🦴","💪","🧠","🩼","♿","🚑",
      // Sport & fitness
      "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🥊","🥋","🎽","🛹","🛷","⛸️","🏋️","🤸","🧘","🚴","🏊","🤽","🧗","🏄","🤺","⛷️","🏂","🪂","🏇","🎿","🛼","🥅","⛳","🎣","🤿","🎯","🎳","🏆","🥇","🥈","🥉","🎖️",
      // Entertainment & hobbies
      "🎮","🕹️","🎲","🃏","🀄","♟️","🎭","🎨","🖼️","🎬","🎥","📷","📸","🎙️","🎚️","🎛️","📻","📺","🎵","🎶","🎼","🎤","🎧","🎷","🎸","🎹","🎺","🎻","🪗","🥁","🪘","🎪","🎠","🎡","🎢","🎟️","🎫","🎰","🧩","🪆","🪅","🧸","🪁","🎯",
      // Education & learning
      "📚","📖","📕","📗","📘","📙","📓","📔","📒","📃","📜","📄","📑","🗒️","📰","🗞️","🏫","🎓","✏️","🖍️","📐","📏","🔭","🔬","🧮","💡",
      // Travel & places
      "🗺️","🧭","🏖️","🏝️","🏔️","⛰️","🗻","🌋","🏕️","🗼","🗽","🏰","🏯","🕌","🕍","⛪","🕋","⛩️","🌁","🌃","🌆","🌇","🌉","🎡","🎢","🎠","🗾","🌐","🧳","🎒","☂️","🏟️",
      // Nature & animals
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🦟","🦗","🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🦧","🦣","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐈","🪶","🌸","🌺","🌻","🌹","🌷","🌼","🌿","🍀","🍁","🍂","🍃","🌱","🌲","🌳","🌴","🪴","🪨","🪵","🌾","🌊","🌈","⭐","🌟","✨","❄️","🔥","💧","🌙","☀️","🌤️","⛅","🌦️","🌧️","⛈️","🌩️","🌨️","🌬️","🌀","🌪️","🌫️",
      // People & family
      "👶","🧒","👦","👧","🧑","👱","👨","🧔","👩","🧓","👴","👵","👨‍👩‍👦","👨‍👩‍👧","👨‍👩‍👧‍👦","👫","👬","👭","💑","💏","🧑‍🤝‍🧑","👮","💂","🕵️","👷","🤴","👸","🧙","🧝","🧛","🧟","🧞","🧜","🧚","👼","🎅","🤶","🦸","🦹","🧑‍⚕️","🧑‍🎓","🧑‍🏫","🧑‍⚖️","🧑‍🌾","🧑‍🍳","🧑‍🔧","🧑‍🏭","🧑‍💼","🧑‍🔬","🧑‍🎨","🧑‍✈️","🧑‍🚀","🧑‍🚒","💆","💇","🚶","🧍","🧎","🏃","💃","🕺","🧖","🧗","🏇","🏋️","🤸","🤼","🤺","🤾","🏌️","🏄","🚣","🧘","🛀",
      // Objects & misc
      "⌚","📿","💍","👑","🎩","🧢","👒","🪖","⛑️","👓","🕶️","🥽","🌂","☂️","🧵","🧶","👗","👘","🥻","🩱","👙","👚","👛","👜","👝","🎒","👞","👟","🥾","🥿","👠","👡","👢","🧤","🧣","🧦","🧥","💄","💅","🪮",
      "🔮","🧿","🪬","🧸","🪆","🖼️","🧧","🎀","🎁","🎊","🎉","🎈","🎏","🎐","🎑","🧨","✨","🎆","🎇","🪄","🔔","🔕","📢","📣","💬","💭","🗯️","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","♾️","☮️","✝️","☯️","🕎","☪️","🛐","⚜️","🔱","📛","🚩","🏁","🎌","🏴","🏳️",
    ];
    function SlEmojiPicker({ value, onChange }) {
      const [open, setOpen] = React.useState(false);
      const inp = { background: "#080f18", border: "1px solid #7a90a8", borderRadius: 8, color: "#e2e8f0", fontSize: 18, textAlign: "center", boxSizing: "border-box" };
      return (
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", gap: 0 }}>
            <input value={value} onChange={e => onChange(e.target.value)} placeholder="🏷️"
              style={{ ...inp, width: 44, padding: "7px 4px", borderRadius: "8px 0 0 8px" }} />
            <button onClick={() => setOpen(o => !o)}
              style={{ background: "#0d1825", border: "1px solid #7a90a8", borderLeft: "none", borderRadius: "0 8px 8px 0", padding: "0 8px", cursor: "pointer", color: "#7a90a8", fontSize: 12 }}
              onMouseEnter={e => e.currentTarget.style.color = "#9aaabb"}
              onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>▾</button>
          </div>
          {open && (
            <>
              <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 298 }} />
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 299, background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, padding: 10, boxShadow: "0 16px 40px rgba(0,0,0,0.6)", width: 320, maxHeight: 280, overflowY: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 2 }}>
                  {SL_EMOJI_GRID.map(em => (
                    <button key={em} onClick={() => { onChange(em); setOpen(false); }}
                      style={{ background: value === em ? "#4ade8022" : "transparent", border: "none", borderRadius: 6, padding: "5px 2px", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1a2535"}
                      onMouseLeave={e => e.currentTarget.style.background = value === em ? "#4ade8022" : "transparent"}>
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      );
    }

    // ─── SL Settings tab ──────────────────────────────────────────────────────
    // ─── SL Category panel (lifted out to avoid remount on each keystroke) ────
    function SlCategoryPanel({ isExp, config, autoSave, newEmoji, setNewEmoji, newLabel, setNewLabel, newColor, setNewColor, inp }) {
      const DEFAULT_CATS   = isExp ? SL_DEFAULT_EXPENSE_CATEGORIES : SL_DEFAULT_INCOME_CATEGORIES;
      const customKey      = isExp ? "customExpenseCategories"         : "customIncomeCategories";
      const deletedKey     = isExp ? "deletedDefaultExpenseCategories" : "deletedDefaultIncomeCategories";
      const overrideKey    = isExp ? "expenseColorOverrides"           : "incomeColorOverrides";
      const customCats     = config[customKey] || [];
      const deletedDefs    = config[deletedKey] || [];
      const colorOverrides = config[overrideKey] || {};

      // Which custom category is being edited inline
      const [editingId,    setEditingId]    = React.useState(null);
      const [editEmoji,    setEditEmoji]    = React.useState("");
      const [editLabel,    setEditLabel]    = React.useState("");
      const [editColor,    setEditColor]    = React.useState("#94a3b8");
      const [confirmDelId, setConfirmDelId] = React.useState(null);

      const startEdit = (c) => {
        setEditingId(c.id);
        setEditEmoji(c.emoji || "");
        setEditLabel(c.label);
        setEditColor(c.color || "#94a3b8");
        setConfirmDelId(null);
      };
      const cancelEdit = () => { setEditingId(null); setConfirmDelId(null); };

      const saveEdit = () => {
        if (!editLabel.trim()) return;
        const next = customCats.map(x => x.id === editingId
          ? { ...x, label: editLabel.trim(), emoji: editEmoji || x.emoji, color: editColor }
          : x);
        autoSave({ [customKey]: next, customPaymentMethods: config.customPaymentMethods || [] });
        setEditingId(null);
      };

      const addCat = () => {
        if (!newLabel.trim()) return;
        const next = [...customCats, { id: "custom_" + Date.now(), label: newLabel.trim(), emoji: newEmoji || "📦", color: newColor }];
        setNewLabel(""); setNewEmoji("");
        autoSave({ [customKey]: next, customPaymentMethods: config.customPaymentMethods || [] });
      };
      const removeCustom   = (id) => autoSave({ [customKey]: customCats.filter(x => x.id !== id), customPaymentMethods: config.customPaymentMethods || [] });
      const removeDefault  = (id) => autoSave({ [deletedKey]: [...deletedDefs, id], customPaymentMethods: config.customPaymentMethods || [] });
      const restoreDefault = (id) => autoSave({ [deletedKey]: deletedDefs.filter(x => x !== id), customPaymentMethods: config.customPaymentMethods || [] });
      const overrideColor  = (id, color) => autoSave({ [overrideKey]: { ...colorOverrides, [id]: color }, customPaymentMethods: config.customPaymentMethods || [] });

      const visibleDefs = DEFAULT_CATS.filter(c => !deletedDefs.includes(c.id)).sort((a, b) => a.label.localeCompare(b.label));
      const hiddenDefs  = DEFAULT_CATS.filter(c =>  deletedDefs.includes(c.id)).sort((a, b) => a.label.localeCompare(b.label));

      return (
        <div>
          {/* Default categories */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {visibleDefs.map(c => {
              const color  = colorOverrides[c.id] || c.color;
              const pinned = !!c.always;
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#0d1825", border: `1px solid ${color}44`, borderRadius: 20, padding: "5px 10px" }}>
                  <span style={{ fontSize: 14 }}>{c.emoji}</span>
                  <span style={{ fontSize: 12, color: "#9aaabb" }}>{c.label}</span>
                  {pinned && <span style={{ fontSize: 10, color, opacity: 0.7 }}>★</span>}
                  <input type="color" value={color} onChange={e => overrideColor(c.id, e.target.value)} title="Change color"
                    style={{ width: 14, height: 14, borderRadius: "50%", border: "none", background: "none", cursor: "pointer", padding: 0, flexShrink: 0, opacity: 0.7 }} />
                  {!pinned && (
                    <button onClick={() => removeDefault(c.id)} style={{ background: "none", border: "none", color: "#8baabf", cursor: "pointer", fontSize: 12, padding: "0 0 0 2px", lineHeight: 1 }}
                      onMouseEnter={e => e.currentTarget.style.color = "#f87171"} onMouseLeave={e => e.currentTarget.style.color = "#8baabf"}>×</button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Custom categories — each editable inline */}
          {customCats.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#8baabf", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8 }}>Custom categories</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {customCats.map(c => {
                  const isEditing = editingId === c.id;
                  if (isEditing) {
                    return (
                      <div key={c.id} style={{ background: "#080f18", border: `1px solid ${SL_ACCENT_A}55`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <SlEmojiPicker value={editEmoji} onChange={setEditEmoji} />
                          <input value={editLabel} onChange={e => setEditLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && saveEdit()}
                            autoFocus style={{ ...inp, flex: 1, fontSize: 13, padding: "7px 10px" }} />
                          <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                            style={{ width: 34, height: 34, borderRadius: 6, border: "1px solid #7a90a8", background: "#080f18", cursor: "pointer", padding: 2, flexShrink: 0 }} />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          {confirmDelId === c.id
                            ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 12, color: "#f87171" }}>Delete?</span>
                                <button onClick={() => { removeCustom(c.id); setEditingId(null); setConfirmDelId(null); }}
                                  style={{ background: "#f87171", color: "#0f172a", border: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Yes</button>
                                <button onClick={() => setConfirmDelId(null)}
                                  style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 12 }}>No</button>
                              </div>
                            : <button onClick={() => setConfirmDelId(c.id)}
                                style={{ background: "none", border: "none", color: "#5a7080", cursor: "pointer", fontSize: 12, padding: 0 }}
                                onMouseEnter={e => e.currentTarget.style.color = "#f87171"} onMouseLeave={e => e.currentTarget.style.color = "#5a7080"}>
                                🗑 Delete
                              </button>
                          }
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={cancelEdit}
                              style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>
                              Cancel
                            </button>
                            <button onClick={saveEdit} disabled={!editLabel.trim()}
                              style={{ background: editLabel.trim() ? SL_ACCENT_A : "#1a2535", color: editLabel.trim() ? "#0f172a" : "#7a90a8", border: "none", borderRadius: 7, padding: "5px 14px", cursor: editLabel.trim() ? "pointer" : "default", fontWeight: 700, fontSize: 12 }}>
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#0d1825", border: `1px solid ${c.color}44`, borderRadius: 20, padding: "6px 12px" }}>
                      <span style={{ fontSize: 14 }}>{c.emoji}</span>
                      <span style={{ fontSize: 12, color: "#c8d8e8", flex: 1 }}>{c.label}</span>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                      <button onClick={() => startEdit(c)}
                        style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = SL_ACCENT_A} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}
                        title="Edit">✎</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hidden defaults */}
          {hiddenDefs.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "#8baabf", marginBottom: 7 }}>Hidden — click to restore</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {hiddenDefs.map(c => (
                  <button key={c.id} onClick={() => restoreDefault(c.id)}
                    style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "1px dashed #1a2535", borderRadius: 20, padding: "4px 10px", cursor: "pointer", color: "#8baabf", fontSize: 12 }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#7a90a8"} onMouseLeave={e => e.currentTarget.style.borderColor = "#1a2535"}>
                    <span>{c.emoji}</span> {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Add new */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#080f18", border: "1px solid #1a2535", borderRadius: 10, padding: "10px 12px" }}>
            <SlEmojiPicker value={newEmoji} onChange={setNewEmoji} />
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && addCat()}
              placeholder="New category name" style={{ ...inp, flex: 1, padding: "8px 12px" }} />
            <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
              style={{ width: 34, height: 34, borderRadius: 6, border: "1px solid #7a90a8", background: "#080f18", cursor: "pointer", padding: 2, flexShrink: 0 }} />
            <button onClick={addCat} disabled={!newLabel.trim()}
              style={{ background: newLabel.trim() ? SL_ACCENT_A : "#1a2535", color: newLabel.trim() ? "#0f172a" : "#7a90a8", border: "none", borderRadius: 8, padding: "8px 14px", cursor: newLabel.trim() ? "pointer" : "default", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
              Add
            </button>
          </div>
        </div>
      );
    }

    function SlSettings({ config, onSave, allCategories, transactions, subscriptions, recurringIncome }) {
      const [currency, setCurrency] = React.useState(config.currency || "EUR");
      const [budget,   setBudget]   = React.useState(config.budget ? String(config.budget) : "");
      const [catTab,   setCatTab]   = React.useState("expense");
      const [newEmoji, setNewEmoji] = React.useState("");
      const [newLabel, setNewLabel] = React.useState("");
      const [newColor, setNewColor] = React.useState("#94a3b8");
      const [newPM,    setNewPM]    = React.useState("");
      const [saved,    setSaved]    = React.useState(false);
      const isMob = useIsMobile();
      const inp = { background: "#080f18", border: "1px solid #7a90a8", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 14, boxSizing: "border-box" };

      const autoSave = (patch) => onSave({
        currency, budget: budget ? Number(budget) : null,
        customExpenseCategories:         config.customExpenseCategories         || [],
        customIncomeCategories:          config.customIncomeCategories          || [],
        deletedDefaultExpenseCategories: config.deletedDefaultExpenseCategories || [],
        deletedDefaultIncomeCategories:  config.deletedDefaultIncomeCategories  || [],
        expenseColorOverrides:           config.expenseColorOverrides           || {},
        incomeColorOverrides:            config.incomeColorOverrides            || {},
        customPaymentMethods:            config.customPaymentMethods            || [],
        dashboardLayout:                 config.dashboardLayout,
        ...patch
      });
      const save = () => { autoSave({}); setSaved(true); setTimeout(() => setSaved(false), 1500); };

      const customPMs = config.customPaymentMethods || [];
      const addPM    = () => { if (!newPM.trim()) return; autoSave({ customPaymentMethods: [...customPMs, newPM.trim()] }); setNewPM(""); };
      const removePM = (m) => autoSave({ customPaymentMethods: customPMs.filter(x => x !== m) });

      // ── Export to XLSX ──────────────────────────────────────────────────────
      const handleExport = () => {
        const wb = XLSX.utils.book_new();
        const cur = config.currency || "EUR";
        // Recurring income is virtual: expand it up to the current month so the
        // export matches what the app shows (future expected months excluded).
        const allTxs = [...(transactions || []), ...slRecIncomeHistory(recurringIncome, slTodayKey())];

        // Helper: category label lookup
        const catLabel = (id) => {
          const c = (allCategories || []).find(x => x.id === id);
          return c ? c.label : (id || "");
        };
        const catEmoji = (id) => {
          const c = (allCategories || []).find(x => x.id === id);
          return c ? (c.emoji || "") : "";
        };

        // ── Sheet 1: Transactions ────────────────────────────────────────────
        const txRows = allTxs
          .slice()
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
          .map(t => ({
            "Date":             t.date || "",
            "Type":             t.type === "income" ? (t.recurringId ? "Income (recurring)" : "Income") : slIsNeutral(t) ? "Investment" : "Expense",
            "Category":         catEmoji(t.category) + " " + catLabel(t.category),
            "Amount":           Number(t.amount) || 0,
            "Currency":         cur,
            "Payment method":   t.paymentMethod || "",
            "Notes":            t.notes || "",
            "Month":            t.date ? t.date.slice(0, 7) : "",
          }));

        const wsTx = XLSX.utils.json_to_sheet(txRows.length ? txRows : [{ "Date": "", "Type": "", "Category": "", "Amount": 0, "Currency": cur, "Payment method": "", "Notes": "", "Month": "" }]);

        // Column widths
        wsTx["!cols"] = [
          { wch: 12 }, // Date
          { wch: 12 }, // Type
          { wch: 22 }, // Category
          { wch: 10 }, // Amount
          { wch: 9  }, // Currency
          { wch: 18 }, // Payment method
          { wch: 30 }, // Notes
          { wch: 10 }, // Month
        ];
        XLSX.utils.book_append_sheet(wb, wsTx, "Transactions");

        // ── Sheet 2: Subscriptions ───────────────────────────────────────────
        const subRows = (subscriptions || [])
          .slice()
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
          .map(s => ({
            "Name":               s.name || "",
            "Category":           catEmoji(s.category) + " " + catLabel(s.category),
            "Amount":             Number(s.amount) || 0,
            "Currency":           cur,
            "Cycle":              s.cycle || "",
            "Monthly equivalent": Number(slMonthlyCost(s).toFixed(2)),
            "Next billing":       s.nextBilling || "",
            "Start date":         s.startDate || "",
            "Active":             s.active !== false ? "Yes" : "No",
            "Notes":              s.notes || "",
          }));

        const wsSub = XLSX.utils.json_to_sheet(subRows.length ? subRows : [{ "Name": "", "Category": "", "Amount": 0, "Currency": cur, "Cycle": "", "Monthly equivalent": 0, "Next billing": "", "Start date": "", "Active": "", "Notes": "" }]);
        wsSub["!cols"] = [
          { wch: 22 }, // Name
          { wch: 20 }, // Category
          { wch: 10 }, // Amount
          { wch: 9  }, // Currency
          { wch: 10 }, // Cycle
          { wch: 18 }, // Monthly equivalent
          { wch: 14 }, // Next billing
          { wch: 12 }, // Start date
          { wch: 8  }, // Active
          { wch: 30 }, // Notes
        ];
        XLSX.utils.book_append_sheet(wb, wsSub, "Subscriptions");

        // ── Sheet 3: Summary ─────────────────────────────────────────────────
        // Monthly totals by type + per-category breakdown
        const monthsSet = new Set();
        allTxs.forEach(t => { if (t.date) monthsSet.add(t.date.slice(0, 7)); });
        const months = [...monthsSet].sort();

        const summaryRows = [];
        // Section header
        summaryRows.push({ "Month": "MONTHLY SUMMARY", "Type": "", "Category": "", "Amount": "", "Currency": "" });
        months.forEach(mk => {
          const txs     = allTxs.filter(t => t.date && t.date.startsWith(mk));
          const income   = txs.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
          const invested = txs.filter(t => slIsNeutral(t)).reduce((s, t) => s + Number(t.amount), 0);
          const expenses = txs.filter(t => t.type !== "income" && !slIsNeutral(t)).reduce((s, t) => s + Number(t.amount), 0);
          const subTotal = (subscriptions || []).filter(s => slSubBilledInMonth(s, mk)).reduce((s, sub) => s + Number(sub.amount), 0);
          const net      = income - expenses - subTotal;
          summaryRows.push({ "Month": mk, "Type": "Income",      "Category": "",  "Amount": Number(income.toFixed(2)),              "Currency": cur });
          summaryRows.push({ "Month": mk, "Type": "Expenses",    "Category": "",  "Amount": Number((expenses + subTotal).toFixed(2)), "Currency": cur });
          summaryRows.push({ "Month": mk, "Type": "Investments", "Category": "",  "Amount": Number(invested.toFixed(2)),             "Currency": cur });
          summaryRows.push({ "Month": mk, "Type": "Net",         "Category": "",  "Amount": Number(net.toFixed(2)),                  "Currency": cur });
        });

        // Blank separator
        summaryRows.push({ "Month": "", "Type": "", "Category": "", "Amount": "", "Currency": "" });

        // Category breakdown (all time)
        summaryRows.push({ "Month": "CATEGORY BREAKDOWN (all time)", "Type": "", "Category": "", "Amount": "", "Currency": "" });
        const catTotals = {};
        (transactions || []).forEach(t => {
          if (t.type === "income") return;
          const key = catLabel(t.category) || "Unknown";
          catTotals[key] = (catTotals[key] || 0) + Number(t.amount);
        });
        Object.entries(catTotals).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
          summaryRows.push({ "Month": "", "Type": "Expense", "Category": cat, "Amount": Number(amt.toFixed(2)), "Currency": cur });
        });

        // Subscription monthly cost
        summaryRows.push({ "Month": "", "Type": "", "Category": "", "Amount": "", "Currency": "" });
        summaryRows.push({ "Month": "SUBSCRIPTIONS MONTHLY COST", "Type": "", "Category": "", "Amount": "", "Currency": "" });
        const totalSubMonthly = (subscriptions || []).filter(s => s.active !== false).reduce((s, sub) => s + slMonthlyCost(sub), 0);
        summaryRows.push({ "Month": "Total active subscriptions", "Type": "", "Category": "", "Amount": Number(totalSubMonthly.toFixed(2)), "Currency": cur + "/month" });

        const wsSum = XLSX.utils.json_to_sheet(summaryRows);
        wsSum["!cols"] = [{ wch: 36 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

        // Download
        const date = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `spendlog-export-${date}.xlsx`);
      };

      return (
        <div style={{ padding: isMob ? "20px 16px 80px" : "28px 28px 60px", maxWidth: 600 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 900, color: "#e2e8f0", marginBottom: 24, letterSpacing: "-0.02em" }}>Settings</div>

          {/* Currency + Budget */}
          <div style={{ display: "grid", gridTemplateColumns: isMob ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 32 }}>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Currency</div>
              <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ ...inp, width: "100%", cursor: "pointer" }}>
                {SL_CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Monthly budget <span style={{ color: "#8baabf", textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
              <input type="number" min="0" value={budget} onChange={e => setBudget(e.target.value)} placeholder="No budget" style={{ ...inp, width: "100%" }} />
            </div>
          </div>

          {/* Payment methods */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Payment methods</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {SL_DEFAULT_PAYMENT_METHODS.map(m => (
                <div key={m} style={{ fontSize: 12, color: "#8baabf", background: "#0d1825", border: "1px solid #1a2535", borderRadius: 20, padding: "5px 12px" }}>{m}</div>
              ))}
              {customPMs.map(m => (
                <div key={m} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#c8d8e8", background: "#0d1825", border: "1px solid #4ade8033", borderRadius: 20, padding: "5px 12px" }}>
                  {m}
                  <button onClick={() => removePM(m)} style={{ background: "none", border: "none", color: "#8baabf", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = "#f87171"} onMouseLeave={e => e.currentTarget.style.color = "#8baabf"}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newPM} onChange={e => setNewPM(e.target.value)} onKeyDown={e => e.key === "Enter" && addPM()}
                placeholder="Add custom payment method…" style={{ ...inp, flex: 1 }} />
              <button onClick={addPM} disabled={!newPM.trim()}
                style={{ background: newPM.trim() ? SL_ACCENT_A : "#1a2535", color: newPM.trim() ? "#0f172a" : "#7a90a8", border: "none", borderRadius: 8, padding: "9px 16px", cursor: newPM.trim() ? "pointer" : "default", fontWeight: 700, fontSize: 13 }}>
                Add
              </button>
            </div>
          </div>

          {/* Category tabs */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1a2535", marginBottom: 18 }}>
              {[{ id: "expense", label: "📤 Expense categories" }, { id: "income", label: "📥 Income categories" }].map(t => (
                <button key={t.id} onClick={() => { setCatTab(t.id); setNewLabel(""); setNewEmoji(""); }}
                  style={{ background: "none", border: "none", borderBottom: catTab === t.id ? `2px solid ${SL_ACCENT_A}` : "2px solid transparent", color: catTab === t.id ? SL_ACCENT_A : "#7a90a8", cursor: "pointer", padding: "10px 18px", fontSize: 13, fontWeight: catTab === t.id ? 600 : 400, transition: "color 0.15s", marginBottom: -1 }}>
                  {t.label}
                </button>
              ))}
            </div>
            <SlCategoryPanel
              isExp={catTab === "expense"}
              config={config}
              autoSave={autoSave}
              newEmoji={newEmoji} setNewEmoji={setNewEmoji}
              newLabel={newLabel} setNewLabel={setNewLabel}
              newColor={newColor} setNewColor={setNewColor}
              inp={inp}
            />
          </div>

          <div style={{ marginTop: 24 }}>
            <button onClick={save} style={{ background: SL_ACCENT_A, color: "#0f172a", border: "none", borderRadius: 9, padding: "10px 28px", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
              {saved ? "Saved ✓" : "Save settings"}
            </button>
            <div style={{ fontSize: 12, color: "#8baabf", marginTop: 8 }}>Currency and budget require saving manually. Payment methods and categories are saved instantly.</div>
          </div>

          {/* Export */}
          <div style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid #1a2535" }}>
            <div style={{ fontSize: 12, color: "#7a90a8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Export data</div>
            <div style={{ fontSize: 13, color: "#8baabf", marginBottom: 16, lineHeight: 1.6 }}>
              Downloads an <span style={{ color: "#c8d8e8", fontWeight: 600 }}>XLSX</span> file with three sheets: <span style={{ color: "#9aaabb" }}>Transactions</span>, <span style={{ color: "#9aaabb" }}>Subscriptions</span>, and a <span style={{ color: "#9aaabb" }}>Summary</span> with monthly totals and category breakdown.
            </div>
            <button onClick={handleExport}
              style={{ display: "flex", alignItems: "center", gap: 8, background: "#0d1825", border: `1px solid ${SL_ACCENT_A}44`, color: SL_ACCENT_A, borderRadius: 9, padding: "10px 20px", cursor: "pointer", fontWeight: 600, fontSize: 13, transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = SL_ACCENT_A + "18"}
              onMouseLeave={e => e.currentTarget.style.background = "#0d1825"}>
              ⬇ Export to XLSX
            </button>
          </div>
        </div>
      );
    }
    // ─── SL App component ─────────────────────────────────────────────────────
    function App({ logoSlot, profileId, profileChip }) {
      const [tab,           setTab]           = React.useState("dashboard");
      const [monthKey,      setMonthKey]       = React.useState(slTodayKey());
      const [transactions,  setTransactions]   = React.useState([]);
      const [subscriptions, setSubscriptions]  = React.useState([]);
      // Recurring income: own table and own load, with errors propagated.
      // null until a successful load — editing is disabled in that state.
      const [recIncome,     setRecIncome]      = React.useState(null);
      const [recLoadError,  setRecLoadError]   = React.useState(null);
      const [recSaveError,  setRecSaveError]   = React.useState(null);
      const [recReload,     setRecReload]      = React.useState(0);
      const recSaveChain = React.useRef(Promise.resolve());
      const [config,        setConfig]         = React.useState({ currency: "EUR", budget: null, customExpenseCategories: [], customIncomeCategories: [], deletedDefaultExpenseCategories: [], deletedDefaultIncomeCategories: [], expenseColorOverrides: {}, incomeColorOverrides: {}, customPaymentMethods: [] });
      const [dashLayout,    setDashLayout]     = React.useState(SL_DEFAULT_LAYOUT);
      const [loading,       setLoading]        = React.useState(true);
      const isMobile = useIsMobile();

      const allExpenseCategories = React.useMemo(() =>
        [...SL_DEFAULT_EXPENSE_CATEGORIES.filter(c => !(config.deletedDefaultExpenseCategories || []).includes(c.id))
          .map(c => ({ ...c, color: (config.expenseColorOverrides || {})[c.id] || c.color })),
         ...(config.customExpenseCategories || [])]
          .sort((a, b) => a.label.localeCompare(b.label)),
        [config.customExpenseCategories, config.deletedDefaultExpenseCategories, config.expenseColorOverrides]
      );
      const allIncomeCategories = React.useMemo(() =>
        [...SL_DEFAULT_INCOME_CATEGORIES.filter(c => !(config.deletedDefaultIncomeCategories || []).includes(c.id))
          .map(c => ({ ...c, color: (config.incomeColorOverrides || {})[c.id] || c.color })),
         ...(config.customIncomeCategories || [])]
          .sort((a, b) => a.label.localeCompare(b.label)),
        [config.customIncomeCategories, config.deletedDefaultIncomeCategories, config.incomeColorOverrides]
      );
      const allCategories = React.useMemo(() =>
        [...allExpenseCategories, ...allIncomeCategories],
        [allExpenseCategories, allIncomeCategories]
      );
      const paymentMethods = React.useMemo(() =>
        [...SL_DEFAULT_PAYMENT_METHODS, ...(config.customPaymentMethods || [])],
        [config.customPaymentMethods]
      );

      React.useEffect(() => {
        if (!profileId) return;
        setLoading(true);
        Promise.all([slLoadTransactions(profileId), slLoadSubscriptions(profileId), slLoadConfig(profileId)])
          .then(([txs, subs, cfg]) => {
            setTransactions(txs); setSubscriptions(subs); setConfig(cfg);
            const savedLayout = cfg.dashboardLayout || [];
            const maxOrder = savedLayout.reduce((m, w) => Math.max(m, w.order), -1);
            const merged = [...savedLayout];
            SL_WIDGET_DEFS.forEach((def, i) => {
              if (!merged.find(w => w.id === def.id)) {
                merged.push({ id: def.id, order: maxOrder + 1 + i, visible: true, cols: SL_DEFAULT_COLS[def.id] || 1 });
              }
            });
            setDashLayout(merged.length ? merged : SL_DEFAULT_LAYOUT);
            setLoading(false);
          })
          .catch(() => setLoading(false));
      }, [profileId]);

      React.useEffect(() => {
        if (!profileId) return;
        let alive = true;
        setRecIncome(null); setRecLoadError(null); setRecSaveError(null);
        slLoadRecurringIncome(profileId)
          .then(list => { if (alive) setRecIncome(list); })
          .catch(err => { console.error("[SpendLog] recurring income load:", err.message); if (alive) setRecLoadError(err.message); });
        return () => { alive = false; };
      }, [profileId, recReload]);
      // Chained saves: each upsert waits for the previous one, so an older
      // version can never land after a newer one.
      const saveRecIncome = (list) => {
        setRecIncome(list);
        const pid = profileId;
        recSaveChain.current = recSaveChain.current
          .then(() => slSaveRecurringIncome(list, pid))
          .then(() => setRecSaveError(null))
          .catch(err => { console.error("[SpendLog] recurring income save:", err.message); setRecSaveError(err.message); });
      };
      const recIncomeList = recIncome || [];

      const saveTxs  = async (txs)  => { setTransactions(txs);  await slSaveTransactions(txs, profileId); };
      const saveSubs = async (subs) => { setSubscriptions(subs); await slSaveSubscriptions(subs, profileId); };

      const addTx    = (tx)   => saveTxs([...transactions, tx]);
      const editTx   = (tx)   => saveTxs(transactions.map(t => t.id === tx.id ? tx : t));
      const deleteTx = (id)   => saveTxs(transactions.filter(t => t.id !== id));

      const addSub    = (s)   => saveSubs([...subscriptions, s]);
      const editSub   = (s)   => saveSubs(subscriptions.map(x => x.id === s.id ? s : x));
      const deleteSub = (id)  => saveSubs(subscriptions.filter(s => s.id !== id));
      const toggleSub = (id)  => saveSubs(subscriptions.map(s => s.id === id ? { ...s, active: !s.active } : s));

      const saveConfig = async (cfg) => { setConfig(cfg); await slSaveConfig(cfg, profileId); };
      const saveDashLayout = async (newLayout) => {
        setDashLayout(newLayout);
        await slSaveConfig({ ...config, dashboardLayout: newLayout }, profileId);
      };

      // Month navigation
      const prevMonth = () => {
        const [y, m] = monthKey.split("-").map(Number);
        const d = new Date(y, m - 2, 1);
        setMonthKey(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
      };
      const nextMonth = () => {
        const [y, m] = monthKey.split("-").map(Number);
        const d = new Date(y, m, 1);
        const next = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        if (next <= slTodayKey()) setMonthKey(next);
      };
      const isCurrentMonth = monthKey === slTodayKey();

      const TABS = [
        { id: "dashboard",     label: "Dashboard",     icon: "◈" },
        { id: "transactions",  label: "Transactions",  icon: "↕" },
        { id: "income",        label: "Income",        icon: "＋" },
        { id: "subscriptions", label: "Subscriptions", icon: "↻" },
        { id: "settings",      label: "Settings",      icon: "⚙" },
      ];

      // ── Mobile layout ──────────────────────────────────────────────────────
      if (isMobile) {
        return (
          <div style={{ minHeight: "100vh", background: "#060d14", display: "flex", flexDirection: "column", paddingBottom: 60 }}>

            {/* Top bar — compact */}
            <div style={{ height: 52, borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {logoSlot}
                <div style={{ width: 1, height: 16, background: "#1a2535" }} />
                <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 15, letterSpacing: "-0.01em" }}>
                  <span style={{ color: SL_ACCENT_A }}>Spend</span><span style={{ color: SL_ACCENT_B }}>Log</span>
                </span>
              </div>
              {profileChip}
            </div>

            {/* Month nav bar (always visible, even on settings) */}
            {tab !== "settings" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "10px 16px", background: "#080f18", borderBottom: "1px solid #0d1825", flexShrink: 0 }}>
                <button onClick={prevMonth} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 20, padding: "4px 10px", lineHeight: 1 }}>‹</button>
                <span style={{ fontSize: 14, color: "#9aaabb", fontWeight: 600, minWidth: 140, textAlign: "center" }}>{slMonthLabel(monthKey)}</span>
                <button onClick={nextMonth} disabled={isCurrentMonth}
                  style={{ background: "none", border: "none", color: isCurrentMonth ? "#1a2535" : "#7a90a8", cursor: isCurrentMonth ? "default" : "pointer", fontSize: 20, padding: "4px 10px", lineHeight: 1 }}>›</button>
              </div>
            )}

            {/* Content — scrollable */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {loading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#7a90a8", fontSize: 14 }}>Loading…</div>
              ) : (
                <>
                  {tab === "dashboard"     && <SlDashboard transactions={transactions} subscriptions={subscriptions} recurringIncome={recIncomeList} allCategories={allCategories} currency={config.currency} monthKey={monthKey} budget={config.budget} layout={dashLayout} onLayoutChange={saveDashLayout} isMobile={true} />}
                  {tab === "transactions"  && <SlTransactions transactions={transactions} allExpenseCategories={allExpenseCategories} allIncomeCategories={allIncomeCategories} allCategories={allCategories} paymentMethods={paymentMethods} currency={config.currency} monthKey={monthKey} onAdd={addTx} onEdit={editTx} onDelete={deleteTx} />}
                  {tab === "income"        && <SlIncome transactions={transactions} allIncomeCategories={allIncomeCategories} paymentMethods={paymentMethods} currency={config.currency} monthKey={monthKey} onAdd={addTx} onEdit={editTx} onDelete={deleteTx}
                    recurringIncome={recIncome} recLoadError={recLoadError} recSaveError={recSaveError} onRecSave={saveRecIncome} onRecRetry={() => setRecReload(n => n + 1)} />}
                  {tab === "subscriptions" && <SlSubscriptions subscriptions={subscriptions} allCategories={allExpenseCategories} currency={config.currency} onAdd={addSub} onEdit={editSub} onDelete={deleteSub} onToggle={toggleSub} />}
                  {tab === "settings"      && <SlSettings config={config} onSave={saveConfig} allCategories={allCategories} transactions={transactions} subscriptions={subscriptions} recurringIncome={recIncomeList} />}
                </>
              )}
            </div>

            {/* Bottom tab bar */}
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 60, background: "#080f18", borderTop: "1px solid #0d1825", display: "flex", alignItems: "stretch", zIndex: 50 }}>
              {TABS.map(t => {
                const isActive = tab === t.id;
                const accent = t.id === "income" ? "#4ade80" : SL_ACCENT_A;
                const shortLabel = t.id === "subscriptions" ? "Subs" : t.label;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", borderTop: `2px solid ${isActive ? accent : "transparent"}`, paddingTop: 2 }}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>{t.icon}</span>
                    <span style={{ fontSize: 10, color: isActive ? accent : "#5a7080", fontWeight: isActive ? 700 : 400, letterSpacing: "0.02em" }}>{shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      }

      // ── Desktop layout ─────────────────────────────────────────────────────
      return (
        <div style={{ minHeight: "100vh", background: "#060d14", display: "flex", flexDirection: "column" }}>

          {/* Top bar */}
          <div style={{ height: 56, borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {logoSlot}
              <div style={{ width: 1, height: 18, background: "#1a2535" }} />
              <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: 17, letterSpacing: "-0.01em" }}>
                <span style={{ color: SL_ACCENT_A }}>Spend</span><span style={{ color: SL_ACCENT_B }}>Log</span>
              </span>
            </div>
            {profileChip}
          </div>

          {/* Tab bar + month nav */}
          <div style={{ borderBottom: "1px solid #0d1825", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", flexShrink: 0, background: "#080f18" }}>
            <div style={{ display: "flex", gap: 0 }}>
              {TABS.map(t => {
                const accent = t.id === "income" ? "#4ade80" : SL_ACCENT_A;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    style={{ background: "none", border: "none", borderBottom: tab === t.id ? `2px solid ${accent}` : "2px solid transparent", color: tab === t.id ? accent : "#7a90a8", cursor: "pointer", padding: "14px 16px", fontSize: 13, fontWeight: tab === t.id ? 600 : 400, transition: "color 0.15s" }}
                    onMouseEnter={e => { if (tab !== t.id) e.currentTarget.style.color = "#9aaabb"; }}
                    onMouseLeave={e => { if (tab !== t.id) e.currentTarget.style.color = "#7a90a8"; }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
            {tab !== "settings" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={prevMonth} style={{ background: "none", border: "none", color: "#7a90a8", cursor: "pointer", fontSize: 16, padding: "4px 8px" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#9aaabb"} onMouseLeave={e => e.currentTarget.style.color = "#7a90a8"}>‹</button>
                <span style={{ fontSize: 13, color: "#9aaabb", minWidth: 130, textAlign: "center" }}>{slMonthLabel(monthKey)}</span>
                <button onClick={nextMonth} disabled={isCurrentMonth}
                  style={{ background: "none", border: "none", color: isCurrentMonth ? "#7a90a8" : "#7a90a8", cursor: isCurrentMonth ? "default" : "pointer", fontSize: 16, padding: "4px 8px" }}
                  onMouseEnter={e => { if (!isCurrentMonth) e.currentTarget.style.color = "#9aaabb"; }}
                  onMouseLeave={e => { if (!isCurrentMonth) e.currentTarget.style.color = "#7a90a8"; }}>›</button>
              </div>
            )}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#7a90a8", fontSize: 14 }}>Loading…</div>
            ) : (
              <>
                {tab === "dashboard"     && <SlDashboard transactions={transactions} subscriptions={subscriptions} recurringIncome={recIncomeList} allCategories={allCategories} currency={config.currency} monthKey={monthKey} budget={config.budget} layout={dashLayout} onLayoutChange={saveDashLayout} />}
                {tab === "transactions"  && <SlTransactions transactions={transactions} allExpenseCategories={allExpenseCategories} allIncomeCategories={allIncomeCategories} allCategories={allCategories} paymentMethods={paymentMethods} currency={config.currency} monthKey={monthKey} onAdd={addTx} onEdit={editTx} onDelete={deleteTx} />}
                {tab === "income"        && <SlIncome transactions={transactions} allIncomeCategories={allIncomeCategories} paymentMethods={paymentMethods} currency={config.currency} monthKey={monthKey} onAdd={addTx} onEdit={editTx} onDelete={deleteTx}
                    recurringIncome={recIncome} recLoadError={recLoadError} recSaveError={recSaveError} onRecSave={saveRecIncome} onRecRetry={() => setRecReload(n => n + 1)} />}
                {tab === "subscriptions" && <SlSubscriptions subscriptions={subscriptions} allCategories={allExpenseCategories} currency={config.currency} onAdd={addSub} onEdit={editSub} onDelete={deleteSub} onToggle={toggleSub} />}
                {tab === "settings"      && <SlSettings config={config} onSave={saveConfig} allCategories={allCategories} transactions={transactions} subscriptions={subscriptions} recurringIncome={recIncomeList} />}
              </>
            )}
          </div>
        </div>
      );
    }

    return { App };
    })(); // end SpendLogApp
