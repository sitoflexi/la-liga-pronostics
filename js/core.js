// Reglas y cálculo de puntos. Compartido por el dashboard y el panel admin.
// Resultado exacto = 5, acertar el signo (1X2) = 2, nada = 0. El comodín dobla.
window.LIGA = (() => {
  const PTS = { exact: 5, sign: 2, miss: 0 };
  const HALTED = ["aplazado", "suspendido"];

  function parseScore(s) {
    if (s == null) return null;
    const m = String(s).trim().match(/^(\d{1,2})\s*[-:–]\s*(\d{1,2})$/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }
  const norm = (s) => { const p = parseScore(s); return p ? `${p[0]}-${p[1]}` : null; };
  const show = (s) => { const p = parseScore(s); return p ? `${p[0]} - ${p[1]}` : ""; };
  const sign = ([a, b]) => Math.sign(a - b);

  // 'exact' | 'sign' | 'miss' | 'pending' (sin resultado) | 'empty' (sin pronóstico)
  function outcome(pred, result) {
    const p = parseScore(pred), r = parseScore(result);
    if (!p) return "empty";
    if (!r) return "pending";
    if (p[0] === r[0] && p[1] === r[1]) return "exact";
    return sign(p) === sign(r) ? "sign" : "miss";
  }

  function compute(data) {
    const players = data.players;
    const js = data.jornadas.map((j) => {
      const played = j.matches.filter((m) => parseScore(m.result)).length;
      const postponed = j.matches.filter((m) => !parseScore(m.result) && HALTED.includes(m.status)).length;
      // un partido aplazado o suspendido no impide cerrar la jornada; si se juega luego, sus puntos se suman igual
      const complete = played > 0 && played + postponed === j.matches.length;
      const dates = j.matches.map((m) => m.date).filter(Boolean).sort();
      const rows = {};
      for (const p of players) {
        const preds = (j.preds && j.preds[p]) || [];
        const com = j.comodin ? j.comodin[p] : undefined;
        const cells = j.matches.map((m, i) => {
          const o = outcome(preds[i], m.result);
          const mult = com === i ? 2 : 1;
          return { pred: preds[i] || null, o, comodin: com === i, pts: (PTS[o] || 0) * mult };
        });
        const count = (k) => cells.filter((c) => c.o === k).length;
        rows[p] = {
          cells, pts: cells.reduce((s, c) => s + c.pts, 0),
          exact: count("exact"), sign: count("sign"), miss: count("miss"),
          predicted: cells.some((c) => c.o !== "empty"),
          comodinPts: cells.filter((c) => c.comodin).reduce((s, c) => s + c.pts, 0),
          comodinDone: cells.some((c) => c.comodin && c.o !== "pending" && c.o !== "empty"),
        };
      }
      const max = Math.max(...players.map((p) => rows[p].pts));
      const winners = complete && max > 0 ? players.filter((p) => rows[p].pts === max) : [];
      return { n: j.n, j, played, postponed, complete, started: played > 0, rows, max, winners, firstDate: dates[0] || null };
    });

    const active = js.filter((x) => x.started);
    const table = players.map((p) => {
      let total = 0, exact = 0, sgn = 0, miss = 0, won = 0, comPts = 0, comHits = 0, comN = 0;
      const cum = [];
      for (const x of active) {
        const r = x.rows[p];
        total += r.pts; exact += r.exact; sgn += r.sign; miss += r.miss;
        if (x.winners.includes(p)) won++;
        if (r.comodinDone) { comN++; comPts += r.comodinPts; if (r.comodinPts > 0) comHits++; }
        cum.push(total);
      }
      const decided = exact + sgn + miss;
      return { name: p, total, exact, sign: sgn, miss, decided, won, cum, comPts, comHits, comN,
        bote: (data.bote && data.bote[p]) || 0, hitRate: decided ? (exact + sgn) / decided : 0 };
    });
    table.sort((a, b) => b.total - a.total || b.exact - a.exact || a.name.localeCompare(b.name));
    table.forEach((t, i) => { t.pos = i > 0 && table[i - 1].total === t.total ? table[i - 1].pos : i + 1; });

    // posición en cada jornada (para la evolución)
    active.forEach((x, k) => {
      const sorted = [...table].sort((a, b) => b.cum[k] - a.cum[k]);
      sorted.forEach((t, i) => {
        t.rank = t.rank || [];
        t.rank[k] = i > 0 && sorted[i - 1].cum[k] === t.cum[k] ? sorted[i - 1].rank[k] : i + 1;
      });
    });

    return { jornadas: js, active, table };
  }

  // "vie 17 · 21:00" en hora local de quien lo mira
  function when(iso, withTime = true) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const day = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }).replace(/[.,]/g, "");
    return withTime ? `${day} · ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : day;
  }

  // Etiqueta de un partido sin resultado: "aplazado", "suspendido", "pendiente" (va con retraso) o null (normal)
  function matchState(m, jornadaStarted) {
    if (parseScore(m.result)) return null;
    if (HALTED.includes(m.status)) return m.status;
    return jornadaStarted ? "pendiente" : null;
  }

  return { PTS, HALTED, parseScore, norm, show, outcome, compute, when, matchState };
})();
