--- /tmp/check_live2.js	2026-09-07 20:48:33.524924404 +0000
+++ /tmp/escenarios/vesta_work.js	2026-09-08 10:32:37.451938073 +0000
@@ -8024,6 +8024,123 @@
       };
     }
 
+    // Sustituciones automáticas para el Backtest por componentes — cuando
+    // el ISIN de la izquierda participa en un backtest, se usa el
+    // histórico de precio del de la derecha en su lugar: misma exposición,
+    // varía mínimamente la comisión, pero con mucho más histórico
+    // disponible para poder alargar la ventana común hacia atrás. Solo
+    // aplica dentro de vsComponentBacktest — en el resto de la app
+    // (Riesgo, Diversificación, etc.) cada ISIN sigue usando su propio
+    // histórico real, sin sustituir nada.
+    const VS_BACKTEST_SUBSTITUTES = {
+      "IE000ZYRH0Q7": "IE00BYX5NX33", // iShares MSCI World -> Fidelity MSCI World
+      "IE000QAZP7L2": "IE0031786696", // iShares Emerging Markets -> Vanguard Emerging Markets
+    };
+
+    // Backtest por componentes — reconstruye la evolución histórica de una
+    // combinación de pesos HIPOTÉTICA usando el histórico de precio real de
+    // cada posición, en vez de una regresión contra factores/índices (eso
+    // es el RBSA de Análisis de fondos). "Si hubiera tenido esta cartera
+    // desde la fecha X, así habría ido."
+    //
+    // `items`: array de { isin, weight, included }. `weight` es una
+    // fracción (0.20 = 20%), no tiene por qué sumar 1 — el hueco entre
+    // Σweight y 1 se trata como una posición de LIQUIDEZ implícita
+    // (retorno 0% siempre): así, excluir una posición o bajar pesos sin
+    // redistribuir reduce directamente el capital invertido simulado, sin
+    // inventar un reparto que el usuario no pidió. Las posiciones con
+    // `included: false` no se usan ni para los retornos ni para acotar la
+    // ventana común — es la vía para descartar un histórico corto y poder
+    // alargar el backtest hacia atrás con las demás.
+    //
+    // `rebalanceFreq`: "none" (buy & hold — los pesos flotan libremente
+    // desde el día 0), "monthly", "quarterly" o "yearly" (en la primera
+    // semana de cada nuevo periodo, los pesos vuelven exactamente al
+    // objetivo).
+    //
+    // Reutiliza el mismo patrón que vsDiversificationRatio/
+    // vsRollingDiversificationRatio: retornos semanales por posición
+    // (vsSecurityRiskReturnSeries), alineados por clave de semana ISO,
+    // sobre la intersección de semanas común a las posiciones incluidas.
+    function vsComponentBacktest(items, securitiesCatalog, rebalanceFreq = "none") {
+      const included = items.filter(it => it.included);
+      if (included.length === 0) return null;
+
+      const perIsin = [];
+      for (const it of included) {
+        // Sustitución transparente: se busca el histórico bajo el ISIN
+        // sustituto si hay uno definido, pero el resto de la fila
+        // (peso, identidad para la UI) sigue siendo la del ISIN real.
+        const effectiveIsin = VS_BACKTEST_SUBSTITUTES[it.isin] || it.isin;
+        const { returns } = vsSecurityRiskReturnSeries(effectiveIsin, securitiesCatalog, null);
+        if (returns.length === 0) continue;
+        const byWeek = new Map();
+        for (const r of returns) byWeek.set(vsIsoWeekKey(r.date), r.value);
+        perIsin.push({ isin: it.isin, weight: it.weight, byWeek, lastDateByWeek: new Map(returns.map(r => [vsIsoWeekKey(r.date), r.date])) });
+      }
+      const insufficientHistory = included
+        .filter(it => !perIsin.some(p => p.isin === it.isin))
+        .map(it => it.isin);
+      if (perIsin.length === 0) return { insufficientHistory, commonWeeks: 0 };
+
+      let commonWeeks = [...perIsin[0].byWeek.keys()];
+      for (const p of perIsin.slice(1)) commonWeeks = commonWeeks.filter(k => p.byWeek.has(k));
+      commonWeeks.sort();
+      if (commonWeeks.length < VS_RISK_MIN_OBS) return { insufficientHistory, commonWeeks: commonWeeks.length };
+
+      const totalWeight = perIsin.reduce((s, p) => s + p.weight, 0);
+      const cashWeight = 1 - totalWeight; // negativo = apalancamiento, positivo = liquidez sin invertir
+      const targetWeights = perIsin.map(p => p.weight);
+
+      // Clave de periodo para detectar arranque de un nuevo mes/trimestre/
+      // año — el rebalanceo dispara en la PRIMERA semana en que la clave
+      // cambia respecto a la anterior.
+      function periodKey(dateStr) {
+        const d = new Date(dateStr + "T00:00:00Z");
+        const y = d.getUTCFullYear(), m = d.getUTCMonth();
+        if (rebalanceFreq === "monthly") return `${y}-${m}`;
+        if (rebalanceFreq === "quarterly") return `${y}-Q${Math.floor(m / 3)}`;
+        if (rebalanceFreq === "yearly") return `${y}`;
+        return null; // "none": nunca cambia -> nunca rebalancea
+      }
+
+      let currentWeights = targetWeights.slice();
+      let currentCash = cashWeight;
+      let index = 100;
+      const growthSeries = [{ date: perIsin[0].lastDateByWeek.get(commonWeeks[0]), value: index, isSynthetic: false }];
+      const returnsOut = [];
+      let prevKey = rebalanceFreq === "none" ? null : periodKey(perIsin[0].lastDateByWeek.get(commonWeeks[0]));
+
+      for (let w = 1; w < commonWeeks.length; w++) {
+        const wk = commonWeeks[w];
+        const rs = perIsin.map(p => p.byWeek.get(wk));
+        const portReturn = currentWeights.reduce((s, wt, i) => s + wt * rs[i], 0); // + currentCash*0
+        index *= (1 + portReturn);
+        const date = perIsin[0].lastDateByWeek.get(wk);
+        growthSeries.push({ date, value: index, isSynthetic: false });
+        returnsOut.push({ date, startDate: perIsin[0].lastDateByWeek.get(commonWeeks[w - 1]), value: portReturn });
+
+        // Deriva de pesos hasta el próximo rebalanceo (o indefinidamente
+        // si rebalanceFreq === "none").
+        const denom = 1 + portReturn;
+        currentWeights = currentWeights.map((wt, i) => (denom !== 0 ? wt * (1 + rs[i]) / denom : wt));
+        currentCash = denom !== 0 ? currentCash / denom : currentCash;
+
+        if (rebalanceFreq !== "none") {
+          const key = periodKey(date);
+          if (key !== prevKey) { currentWeights = targetWeights.slice(); currentCash = cashWeight; }
+          prevKey = key;
+        }
+      }
+
+      return {
+        growthSeries, returns: returnsOut,
+        commonWeeks: commonWeeks.length,
+        windowStart: growthSeries[0].date, windowEnd: growthSeries[growthSeries.length - 1].date,
+        insufficientHistory, cashWeight,
+      };
+    }
+
     // Índice Herfindahl-Hirschman de concentración de CAPITAL — Σwᵢ² con
     // pesos normalizados a que sumen 1 dentro de las `rows` recibidas
     // (por eso sirve tanto para la cartera completa como para una rama
@@ -9725,6 +9842,203 @@
       );
     }
 
+    // ── Pestaña "Escenarios" — Backtest por componentes: reconstruye la
+    // evolución histórica de una combinación de pesos HIPOTÉTICA usando el
+    // precio real de cada posición (ver vsComponentBacktest). Los pasos
+    // siguientes (Monte Carlo, estrés histórico, "qué pasa si") se añaden
+    // en bloques posteriores — de momento solo este primero.
+    function VsEscenariosTab({ portfolio, factors }) {
+      const transactions = portfolio.transactions || [];
+      const securitiesCatalog = portfolio.securities || {};
+
+      const { rows } = useMemo(
+        () => vsComputeAllocation(transactions, securitiesCatalog, null),
+        [transactions, securitiesCatalog]
+      );
+      const totalValue = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);
+
+      // Estado editable por posición: peso hipotético (%) e inclusión.
+      // Se inicializa con el peso €-actual normalizado la primera vez que
+      // aparece cada ISIN, y no se vuelve a pisar en renders posteriores
+      // (así el usuario puede editar sin que un recálculo de `rows` le
+      // borre lo que ha tecleado).
+      const [weightPct, setWeightPct] = useState({});
+      const [includedMap, setIncludedMap] = useState({});
+      const [rebalanceFreq, setRebalanceFreq] = useState("none");
+
+      useEffect(() => {
+        setWeightPct(prev => {
+          const next = { ...prev };
+          let changed = false;
+          for (const r of rows) {
+            if (!(r.isin in next)) {
+              next[r.isin] = totalValue > 0 ? +(100 * r.value / totalValue).toFixed(2) : 0;
+              changed = true;
+            }
+          }
+          return changed ? next : prev;
+        });
+        setIncludedMap(prev => {
+          const next = { ...prev };
+          let changed = false;
+          for (const r of rows) {
+            if (!(r.isin in next)) { next[r.isin] = true; changed = true; }
+          }
+          return changed ? next : prev;
+        });
+      }, [rows, totalValue]);
+
+      const resetToActual = () => {
+        const w = {}, inc = {};
+        for (const r of rows) { w[r.isin] = totalValue > 0 ? +(100 * r.value / totalValue).toFixed(2) : 0; inc[r.isin] = true; }
+        setWeightPct(w);
+        setIncludedMap(inc);
+      };
+
+      const items = useMemo(
+        () => rows.map(r => ({ isin: r.isin, weight: (weightPct[r.isin] ?? 0) / 100, included: includedMap[r.isin] !== false })),
+        [rows, weightPct, includedMap]
+      );
+      const sumWeights = items.filter(it => it.included).reduce((s, it) => s + it.weight, 0);
+
+      const backtest = useMemo(
+        () => vsComponentBacktest(items, securitiesCatalog, rebalanceFreq),
+        [items, securitiesCatalog, rebalanceFreq]
+      );
+
+      const stats = useMemo(() => {
+        if (!backtest || !backtest.growthSeries) return null;
+        const { growthSeries, returns } = backtest;
+        const vol = vsAnnualizedVolatility(returns);
+        const annReturn = vsAnnualizedReturnFromPoints(growthSeries);
+        const riskFree = vsRiskFreeReturnForWindow(factors, backtest.windowStart, backtest.windowEnd);
+        const marWeekly = riskFree != null ? Math.pow(1 + riskFree / 100, 1 / VS_RISK_PERIODS_PER_YEAR) - 1 : 0;
+        const downsideDev = vsDownsideDeviation(returns, marWeekly);
+        const sharpe = vsSharpeRatio(annReturn, vol, riskFree);
+        const sortino = vsSortinoRatio(annReturn, downsideDev, riskFree);
+        const varHist = vsHistoricalVaR(returns, 0.95);
+        const dd = vsMaxDrawdown(growthSeries);
+        const ulcer = vsUlcerIndex(growthSeries);
+        return { vol, annReturn, sharpe, sortino, varHist, dd, ulcer };
+      }, [backtest, factors]);
+
+      return (
+        <div style={{ padding: 20 }}>
+          <div style={{ fontSize: 12, color: "#7a90a8", fontFamily: "'DM Mono',monospace", lineHeight: 1.6, marginBottom: 16 }}>
+            Reconstruye la evolución histórica de una combinación de pesos hipotética usando el precio real de cada posición — "si hubiera tenido esta cartera desde tal fecha, así habría ido". No es una regresión contra factores (eso es el RBSA de Análisis de fondos): usa directamente tu propio histórico de precio.
+          </div>
+
+          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>
+            <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, overflow: "hidden" }}>
+              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
+                <thead>
+                  <tr style={{ borderBottom: "1px solid #1a2535" }}>
+                    <th style={{ padding: "8px 10px", textAlign: "left", color: "#5a7080", fontFamily: "'DM Mono',monospace", fontWeight: 400 }}>Incluir</th>
+                    <th style={{ padding: "8px 10px", textAlign: "left", color: "#5a7080", fontFamily: "'DM Mono',monospace", fontWeight: 400 }}>Posición</th>
+                    <th style={{ padding: "8px 10px", textAlign: "right", color: "#5a7080", fontFamily: "'DM Mono',monospace", fontWeight: 400 }}>Peso actual</th>
+                    <th style={{ padding: "8px 10px", textAlign: "right", color: "#5a7080", fontFamily: "'DM Mono',monospace", fontWeight: 400 }}>Peso hipotético</th>
+                  </tr>
+                </thead>
+                <tbody>
+                  {rows.map(r => {
+                    const actualPct = totalValue > 0 ? (100 * r.value / totalValue) : 0;
+                    const included = includedMap[r.isin] !== false;
+                    const isInsufficient = backtest && backtest.insufficientHistory && backtest.insufficientHistory.includes(r.isin);
+                    const substituteIsin = VS_BACKTEST_SUBSTITUTES[r.isin];
+                    const substituteSec = substituteIsin ? securitiesCatalog[substituteIsin] : null;
+                    return (
+                      <tr key={r.isin} style={{ borderBottom: "1px solid #16202c", opacity: included ? 1 : 0.45 }}>
+                        <td style={{ padding: "6px 10px" }}>
+                          <input type="checkbox" checked={included} onChange={e => setIncludedMap(m => ({ ...m, [r.isin]: e.target.checked }))} style={{ accentColor: VS_A }} />
+                        </td>
+                        <td style={{ padding: "6px 10px", fontFamily: "'DM Mono',monospace" }}>
+                          {r.name}
+                          {isInsufficient && <span title="Histórico insuficiente para la ventana común — no participa aunque esté marcada" style={{ color: "#f59e0b", marginLeft: 6 }}>⚠</span>}
+                          {substituteIsin && (
+                            <span title={substituteSec
+                                ? `En este backtest se usa el histórico de ${substituteSec.name || substituteIsin} (misma exposición, comisión ligeramente distinta) para alargar la ventana disponible.`
+                                : `Sustitución configurada por ${substituteIsin}, pero no está en tu catálogo — no se puede usar todavía.`}
+                              style={{ color: substituteSec ? "#4ade80" : "#f59e0b", marginLeft: 6, fontSize: 10, fontFamily: "'DM Mono',monospace" }}>
+                              ⇄ {substituteSec ? "sustituido" : "sustituto no disponible"}
+                            </span>
+                          )}
+                        </td>
+                        <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'DM Mono',monospace", color: "#5a7080" }}>{actualPct.toFixed(1)}%</td>
+                        <td style={{ padding: "6px 10px", textAlign: "right" }}>
+                          <input type="number" step="0.1" value={weightPct[r.isin] ?? 0}
+                            onChange={e => setWeightPct(m => ({ ...m, [r.isin]: parseFloat(e.target.value) || 0 }))}
+                            style={{ width: 70, textAlign: "right", background: "#0a1420", border: "1px solid #1a2535", borderRadius: 5, color: "#e2e8f0", fontFamily: "'DM Mono',monospace", fontSize: 12, padding: "3px 6px" }} />
+                          <span style={{ color: "#5a7080", marginLeft: 3 }}>%</span>
+                        </td>
+                      </tr>
+                    );
+                  })}
+                </tbody>
+              </table>
+              <div style={{ padding: "10px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
+                <div style={{ color: "#5a7080" }}>
+                  Suma de pesos incluidos: <span style={{ color: Math.abs(sumWeights - 1) < 0.005 ? "#4ade80" : "#f59e0b" }}>{(sumWeights * 100).toFixed(1)}%</span>
+                  {sumWeights < 0.995 && <span style={{ marginLeft: 6 }}>· el resto se trata como liquidez sin invertir (retorno 0%)</span>}
+                </div>
+                <button onClick={resetToActual} style={{ background: "none", border: "1px solid #1a2535", color: "#7a90a8", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono',monospace" }}>Restablecer a pesos actuales</button>
+              </div>
+            </div>
+
+            <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, padding: "16px 18px" }}>
+              <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Rebalanceo</div>
+              {[
+                { id: "none", label: "Ninguno (buy & hold)" },
+                { id: "monthly", label: "Mensual" },
+                { id: "quarterly", label: "Trimestral" },
+                { id: "yearly", label: "Anual" },
+              ].map(opt => (
+                <label key={opt.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12, fontFamily: "'DM Mono',monospace", cursor: "pointer" }}>
+                  <input type="radio" name="rebalanceFreq" checked={rebalanceFreq === opt.id} onChange={() => setRebalanceFreq(opt.id)} style={{ accentColor: VS_A }} />
+                  {opt.label}
+                </label>
+              ))}
+            </div>
+          </div>
+
+          <div style={{ marginTop: 20 }}>
+            {!backtest || !backtest.growthSeries ? (
+              <div style={{ background: "#1a1410", border: "1px solid #3a2a15", borderRadius: 10, padding: 16 }}>
+                <div style={{ fontSize: 12, color: "#f59e0b", fontFamily: "'DM Mono',monospace", lineHeight: 1.5 }}>
+                  {!backtest || backtest.commonWeeks === 0
+                    ? "Ninguna de las posiciones marcadas tiene histórico de precio."
+                    : `Solo ${backtest.commonWeeks} semanas comunes entre las posiciones marcadas — hacen falta al menos ${VS_RISK_MIN_OBS} para calcular el backtest. Prueba a desmarcar la posición de histórico más corto.`}
+                </div>
+              </div>
+            ) : (
+              <>
+                <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>
+                  <div style={{ background: "#0d1825", border: "1px solid #1a2535", borderRadius: 10, padding: "18px 20px" }}>
+                    <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Evolución simulada</div>
+                    <div style={{ fontSize: 11, color: "#5a7080", fontFamily: "'DM Mono',monospace", marginBottom: 10 }}>
+                      {backtest.windowStart} → {backtest.windowEnd} · {backtest.commonWeeks} semanas
+                      {backtest.insufficientHistory && backtest.insufficientHistory.length > 0 && (
+                        <span style={{ color: "#f59e0b" }}> · {backtest.insufficientHistory.length} posición{backtest.insufficientHistory.length === 1 ? "" : "es"} marcada{backtest.insufficientHistory.length === 1 ? "" : "s"} sin histórico, ignorada{backtest.insufficientHistory.length === 1 ? "" : "s"}</span>
+                      )}
+                    </div>
+                    <VsLineChart series={backtest.growthSeries} height={260} />
+                  </div>
+
+                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
+                    <VsRiskCard label="Retorno anualizado" value={stats.annReturn != null ? `${stats.annReturn.toFixed(1)}%` : "—"} color={stats.annReturn > 0 ? "#4ade80" : stats.annReturn < 0 ? "#f87171" : undefined} info="CAGR de la serie simulada sobre toda la ventana del backtest." />
+                    <VsRiskCard label="Volatilidad anualizada" value={stats.vol != null ? `${stats.vol.toFixed(1)}%` : "—"} info="Desviación típica de los retornos semanales de la serie simulada, anualizada." />
+                    <VsRiskCard label="Sharpe" value={stats.sharpe != null ? stats.sharpe.toFixed(2) : "—"} info="(Retorno − tipo libre de riesgo) / volatilidad, sobre la serie simulada." />
+                    <VsRiskCard label="Sortino" value={stats.sortino != null ? stats.sortino.toFixed(2) : "—"} info="Como el Sharpe, pero solo penaliza la volatilidad a la baja (semidesviación bajo el tipo libre de riesgo)." />
+                    <VsRiskCard label="VaR histórico 95%" value={stats.varHist != null ? `${stats.varHist.toFixed(1)}%` : "—"} color="#f87171" info="Percentil 5% de la distribución empírica de retornos semanales simulados." />
+                    <VsRiskCard label="Máximo drawdown" value={stats.dd != null ? `${stats.dd.maxDD.toFixed(1)}%` : "—"} color="#f87171" info="Mayor caída de pico a valle en la serie simulada." />
+                  </div>
+                </div>
+              </>
+            )}
+          </div>
+        </div>
+      );
+    }
+
     function VestaApp({ logoSlot, profileId, profileChip }) {
       const VS_SECTIONS = [
         { id: "fondos", label: "Análisis de fondos", tabs: [
@@ -9739,6 +10053,7 @@
           { id: "resumen", label: "Mi cartera", icon: "📊" },
           { id: "riesgo", label: "Riesgo", icon: "📉" },
           { id: "diversificacion", label: "Diversificación", icon: "🧩" },
+          { id: "escenarios", label: "Escenarios", icon: "🎲" },
           { id: "cartera", label: "Configuración", icon: "💼" },
         ]},
       ];
@@ -10007,6 +10322,7 @@
                 {tab === "resumen" && <VsMiCarteraTab portfolio={portfolio} censored={censored} onToggleCensored={toggleCensored} />}
                 {tab === "riesgo" && <VsRiskTab portfolio={portfolio} factors={factors} />}
                 {tab === "diversificacion" && <VsDiversificacionTab portfolio={portfolio} />}
+                {tab === "escenarios" && <VsEscenariosTab portfolio={portfolio} factors={factors} />}
                 {tab === "cartera" && <VsCarteraTab portfolio={portfolio} onSave={handleSavePortfolio} censored={censored} onToggleCensored={toggleCensored} />}
               </>
             )}
