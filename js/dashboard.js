(() => {
  const { compute, show, when, matchState } = window.LIGA;
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];

  let S; // estado calculado
  const sel = []; // jugadores destacados en la evolución (máx. 4); el color sigue al jugador
  let evoMode = "pts";
  let curJ = null;

  function colorOf(name) {
    const i = sel.indexOf(name);
    return i >= 0 ? SERIES[i] : null;
  }
  function toggle(name) {
    const i = sel.indexOf(name);
    if (i >= 0) sel.splice(i, 1);
    else { if (sel.length >= 4) sel.shift(); sel.push(name); }
    renderTable(); renderEvo();
  }

  // ---------- Tiles ----------
  function renderTiles(data) {
    const t = S.table, lead = t[0], second = t.find((x) => x.total < lead.total);
    const leaders = t.filter((x) => x.total === lead.total).map((x) => x.name).join(" · ");
    const last = S.active[S.active.length - 1];
    const live = last && !last.complete ? last : null; // una jornada vieja con un partido reprogramado no cuenta
    const next = S.jornadas.find((x) => !x.started);
    let best = null;
    for (const x of S.active) for (const p of data.players) {
      const pts = x.rows[p].pts;
      if (!best || pts > best.pts) best = { pts, who: [p], n: x.n };
      else if (pts === best.pts && best.n === x.n) best.who.push(p);
    }
    const bote = t.reduce((a, x) => a + x.bote, 0);
    const tile = (k, v, d) => el("div", { class: "tile" }, el("div", { class: "k" }, k), el("div", { class: "v" }, v), el("div", { class: "d" }, d));
    $("#tiles").replaceChildren(
      tile("Líder", leaders, `${lead.total} pts` + (second ? ` · +${lead.total - second.total} sobre el siguiente` : "")),
      live ? tile("Jornada en curso", `J${live.n}`, `${live.played} de ${live.j.matches.length} partidos jugados`)
        : next ? tile("Próxima jornada", `J${next.n}`, next.firstDate ? `Empieza el ${when(next.firstDate)}` : "Fechas por confirmar")
        : tile("Última jornada", last ? `J${last.n}` : "—", ""),
      tile("Mejor jornada", best ? `${best.pts} pts` : "—", best ? `${best.who.join(" · ")} en la J${best.n}` : ""),
      tile("Bote acumulado", `${bote.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, `+${window.LIGA.BOTE_POR_JORNADA} € el último de cada jornada`),
    );
  }

  // ---------- Clasificación ----------
  const heat = (p) => (p <= 0 ? 0 : p < 10 ? 1 : p < 15 ? 2 : p < 20 ? 3 : p < 25 ? 4 : 5);
  function renderTable() {
    const head = el("tr", {},
      el("th", {}, "#"), el("th", { class: "name" }, "Jugador"),
      S.active.map((x) => el("th", { title: x.complete ? "" : "En curso" }, `J${x.n}`)),
      el("th", {}, "Total"), el("th", { title: "Jornadas ganadas" }, "👑"),
      el("th", { title: "Resultados exactos" }, "Exactos"), el("th", { title: "% de partidos con algún acierto" }, "% acierto"),
      el("th", { title: "Jornadas en último lugar × 3 €" }, "Bote"));
    const cut = S.table.length > 6 ? S.table[S.table.length - 3].pos : Infinity;
    const rows = S.table.map((t) => {
      const c = colorOf(t.name);
      const tr = el("tr", { class: "clickable" + (c ? " sel" : "") + (t.pos >= cut ? " bottom" : ""), onclick: () => toggle(t.name),
        title: t.pos >= cut ? "Zona roja: los 3 últimos" : "" },
        el("td", { class: "pos" }, t.pos),
        el("td", { class: "name" }, t.name),
        S.active.map((x) => {
          const r = x.rows[t.name];
          const won = x.winners.includes(t.name), lost = x.losers.includes(t.name);
          return el("td", { class: `heat h${heat(r.pts)}` + (x.complete ? "" : " live"), title: `J${x.n}: ${r.pts} pts` + (lost ? ` · último, +${window.LIGA.BOTE_POR_JORNADA} € al bote` : "") },
            r.predicted ? r.pts : "–", won ? el("span", { class: "crown" }, " 👑") : null, lost ? el("span", { class: "crown" }, " 💸") : null);
        }),
        el("td", { class: "total" }, t.total),
        el("td", {}, t.won || ""),
        el("td", {}, t.exact),
        el("td", {}, t.decided ? Math.round(t.hitRate * 100) + "%" : "–"),
        el("td", {}, `${t.bote.toLocaleString("es-ES")} €`));
      if (c) tr.style.setProperty("--selc", c);
      return tr;
    });
    $("#tabla").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
    refit();
  }

  // ---------- Evolución ----------
  const tip = el("div", { class: "tip" });
  function renderEvo() {
    const box = $("#evoChart");
    $("#evoChips").replaceChildren(...S.table.map((t) => {
      const c = colorOf(t.name);
      return el("button", { class: "chip" + (c ? " on" : ""), onclick: () => toggle(t.name) },
        el("span", { class: "sw", style: `background:${c || "var(--line-off)"}` }), t.name);
    }));
    const W = Math.max(300, box.clientWidth), H = Math.round(Math.min(380, Math.max(240, W * 0.42)));
    const m = { l: 34, r: 70, t: 12, b: 26 };
    const n = S.active.length;
    const xs = (i) => m.l + (n <= 1 ? 0 : (i * (W - m.l - m.r)) / (n - 1));
    const isPos = evoMode === "pos";
    const nP = S.table.length;
    const maxV = isPos ? nP : Math.max(10, ...S.table.map((t) => t.total));
    const niceMax = isPos ? nP : Math.ceil(maxV / 20) * 20;
    const ys = isPos ? (v) => m.t + ((v - 1) * (H - m.t - m.b)) / (nP - 1) : (v) => H - m.b - (v * (H - m.t - m.b)) / niceMax;
    const val = (t, i) => (isPos ? t.rank[i] : t.cum[i]);

    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Evolución por jornada" });
    const ticks = isPos ? [1, 5, 10, 15, nP].filter((v, i, a) => v <= nP && a.indexOf(v) === i) : Array.from({ length: niceMax / 20 + 1 }, (_, i) => i * 20);
    for (const v of ticks) {
      s.append(svg("line", { class: "gridline", x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v) }));
      const tx = svg("text", { class: "axis-text", x: m.l - 6, y: ys(v) + 4, "text-anchor": "end" }); tx.textContent = isPos ? `${v}º` : v; s.append(tx);
    }
    S.active.forEach((x, i) => {
      const tx = svg("text", { class: "axis-text", x: xs(i), y: H - 8, "text-anchor": "middle" }); tx.textContent = `J${x.n}`; s.append(tx);
    });
    const path = (t) => S.active.map((_, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(val(t, i)).toFixed(1)}`).join("");
    const off = S.table.filter((t) => !colorOf(t.name));
    const on = sel.map((nm) => S.table.find((t) => t.name === nm)).filter(Boolean);
    for (const t of off) s.append(svg("path", { d: path(t), fill: "none", stroke: "var(--line-off)", "stroke-width": 1.5, "stroke-linejoin": "round" }));
    const labels = [];
    for (const t of on) {
      const c = colorOf(t.name);
      s.append(svg("path", { d: path(t), fill: "none", stroke: c, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      const lx = xs(n - 1), ly = ys(val(t, n - 1));
      s.append(svg("circle", { cx: lx, cy: ly, r: 4, fill: c, stroke: "var(--panel)", "stroke-width": 2 }));
      labels.push({ y: ly, name: t.name });
    }
    // etiquetas directas sin solaparse
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    for (const l of labels) { const tx = svg("text", { class: "lbl", x: xs(n - 1) + 8, y: l.y + 4 }); tx.textContent = l.name; s.append(tx); }

    const cross = svg("line", { x1: 0, x2: 0, y1: m.t, y2: H - m.b, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" });
    s.append(cross);
    const hit = svg("rect", { x: m.l - 10, y: 0, width: W - m.l - m.r + 20, height: H, fill: "transparent" });
    s.append(hit);
    const move = (ev) => {
      const r = s.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let i = n <= 1 ? 0 : Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute("x1", xs(i)); cross.setAttribute("x2", xs(i)); cross.setAttribute("visibility", "visible");
      const list = (on.length ? on : S.table.slice(0, 5)).map((t) => [t, val(t, i)]).sort((a, b) => (isPos ? a[1] - b[1] : b[1] - a[1]));
      tip.replaceChildren(el("div", { class: "t" }, `Jornada ${S.active[i].n}` + (on.length ? "" : " · top 5")),
        ...list.map(([t, v]) => el("div", { class: "r" },
          el("span", {}, el("span", { class: "sw", style: `background:${colorOf(t.name) || "var(--muted)"}` }), t.name),
          el("b", {}, isPos ? `${v}º` : `${v} pts`))));
      tip.style.display = "block";
      const bx = box.getBoundingClientRect();
      let left = (xs(i) / W) * bx.width + 12;
      if (left + tip.offsetWidth > bx.width) left = (xs(i) / W) * bx.width - tip.offsetWidth - 12;
      tip.style.left = Math.max(0, left) + "px";
      tip.style.top = Math.max(0, ev.clientY - bx.top - 20) + "px";
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", () => { tip.style.display = "none"; cross.setAttribute("visibility", "hidden"); });
    box.replaceChildren(s, tip);
  }

  // ---------- Jornada ----------
  function renderJornada() {
    const x = S.jornadas.find((j) => j.n === curJ);
    $("#jSel").replaceChildren(...S.jornadas.map((j) =>
      el("button", { "aria-pressed": String(j.n === curJ), onclick: () => { curJ = j.n; renderJornada(); } }, `J${j.n}`)));
    $("#jTitle").replaceChildren(`Jornada ${x.n} `,
      x.complete ? (x.postponed ? el("span", { class: "badge" }, `${x.postponed} sin jugar`) : "")
        : el("span", { class: "badge" }, x.started ? `en curso · ${x.played}/${x.j.matches.length}` : x.firstDate ? `empieza el ${when(x.firstDate)}` : "sin empezar"));
    const head = el("tr", {}, el("th", { class: "name" }, "Jugador"),
      x.j.matches.map((mt) => el("th", { class: "match", title: when(mt.date) }, mt.home, el("small", {}, mt.away),
        mt.date && !mt.result ? el("small", { class: "when" }, when(mt.date)) : null)),
      el("th", {}, "Pts"));
    const res = el("tr", { class: "result" }, el("td", { class: "name" }, "Resultado"),
      x.j.matches.map((mt) => {
        const st = matchState(mt, x.started);
        return el("td", {}, mt.result ? show(mt.result) : st ? el("span", { class: `badge st-${st}`, title: mt.date ? when(mt.date) : "" }, st) : "–");
      }), el("td", {}, ""));
    const order = [...S.table].map((t) => t.name).sort((a, b) => x.rows[b].pts - x.rows[a].pts || a.localeCompare(b));
    const rows = order.map((p) => {
      const r = x.rows[p];
      return el("tr", {}, el("td", { class: "name" }, p, x.winners.includes(p) ? " 👑" : "", x.losers.includes(p) ? ` 💸 +${window.LIGA.BOTE_POR_JORNADA} €` : ""),
        r.cells.map((c) => el("td", {
          class: `cell ${c.o}` + (c.comodin ? " comodin" : ""),
          title: c.o === "pending" || c.o === "empty" ? "" : `${c.pts} pts` + (c.comodin ? " (comodín ×2)" : ""),
        }, c.pred ? show(c.pred) : "·")),
        el("td", { class: "total" }, r.predicted ? r.pts : "–"));
    });
    $("#jTable").replaceChildren(el("thead", {}, head, res), el("tbody", {}, rows));
    refit();
    renderPending();
  }

  // Partidos de jornadas ya empezadas que siguen sin resultado
  function renderPending() {
    const items = [];
    for (const x of S.jornadas) {
      if (!x.started) continue;
      x.j.matches.forEach((mt) => {
        const st = matchState(mt, true);
        // en la jornada en curso solo cuentan los parados; los demás simplemente no se han jugado aún
        if (!st || (!x.complete && st === "pendiente" && x === S.active[S.active.length - 1])) return;
        items.push(el("li", {}, el("span", { class: `badge st-${st}` }, st), ` J${x.n} · ${mt.home} - ${mt.away}`,
          mt.date && st !== "suspendido" ? el("span", { class: "muted" }, ` · ${when(mt.date)}`) : null));
      });
    }
    const box = $("#pending");
    box.hidden = !items.length;
    box.replaceChildren(el("b", {}, "Partidos atrasados"), el("span", { class: "muted" }, " — sus puntos se sumarán cuando se jueguen"), el("ul", {}, items));
  }

  // ---------- Tipo de acierto / comodín ----------
  function renderStack() {
    const t = [...S.table].filter((x) => x.decided).sort((a, b) => b.hitRate - a.hitRate || b.exact - a.exact);
    $("#stack").replaceChildren(...t.map((x) => {
      const seg = (k, c) => x[k] ? el("span", { style: `flex:${x[k]};background:var(--${c})`, title: `${x[k]} ${k === "exact" ? "exactos" : k === "sign" ? "signos" : "fallos"}` }) : null;
      return el("div", { class: "stackrow" }, el("span", { class: "n" }, x.name),
        el("span", { class: "bar" }, seg("exact", "exact"), seg("sign", "sign"), seg("miss", "miss")),
        el("span", { class: "v" }, Math.round(x.hitRate * 100) + "%"));
    }));
  }
  function renderComodin() {
    const t = [...S.table].sort((a, b) => b.comPts - a.comPts || a.name.localeCompare(b.name));
    const max = Math.max(1, ...t.map((x) => x.comPts));
    $("#comodin").replaceChildren(...t.map((x) => el("div", { class: "stackrow", title: `${x.comHits} de ${x.comN} comodines con puntos` },
      el("span", { class: "n" }, x.name),
      el("span", { class: "bar" }, x.comPts ? el("span", { style: `width:${(x.comPts / max) * 100}%;background:var(--accent);border-radius:0 4px 4px 0` }) : null),
      el("span", { class: "v" }, `${x.comPts} · ${x.comHits}/${x.comN}`))));
  }

  // ---------- Curiosidades ----------
  function renderFacts(data) {
    const games = [];
    for (const x of S.active) x.j.matches.forEach((mt, i) => {
      if (!mt.result) return;
      const cs = data.players.map((p) => x.rows[p].cells[i]).filter((c) => c.o !== "empty");
      if (!cs.length) return;
      games.push({ x, mt, n: cs.length, exact: cs.filter((c) => c.o === "exact").length, hit: cs.filter((c) => c.o !== "miss").length });
    });
    const label = (g) => `${g.mt.home} ${show(g.mt.result)} ${g.mt.away} (J${g.x.n})`;
    const facts = [];
    const byExact = [...games].sort((a, b) => b.exact - a.exact);
    if (byExact[0]) facts.push(["Partido más clavado", label(byExact[0]), `${byExact[0].exact} de ${byExact[0].n} acertaron el resultado exacto`]);
    const surprise = [...games].sort((a, b) => a.hit / a.n - b.hit / b.n || b.n - a.n)[0];
    if (surprise) facts.push(["El que nadie vio venir", label(surprise), surprise.hit ? `solo ${surprise.hit} de ${surprise.n} acertaron el signo` : `ninguno de los ${surprise.n} acertó el signo`]);
    const sniper = [...S.table].sort((a, b) => b.exact - a.exact)[0];
    if (sniper) facts.push(["Francotirador", sniper.name, `${sniper.exact} resultados exactos en la temporada`]);
    const comBest = [...S.table].sort((a, b) => b.comPts - a.comPts)[0];
    if (comBest) facts.push(["Mejor gestor del comodín", comBest.name, `${comBest.comPts} pts con el comodín (${comBest.comHits}/${comBest.comN} con puntos)`]);
    const allCom = S.table.reduce((a, t) => a + t.comPts, 0), allPts = S.table.reduce((a, t) => a + t.total, 0);
    if (allPts) facts.push(["Peso del comodín", `${Math.round((allCom / allPts) * 100)}% de los puntos`, "salen de partidos jugados como comodín"]);
    const done = S.jornadas.filter((j) => j.complete);
    if (done.length) {
      const avg = done.map((j) => { const ps = data.players.map((p) => j.rows[p]).filter((r) => r.predicted); return { j, a: ps.reduce((s, r) => s + r.pts, 0) / ps.length }; });
      const hard = avg.sort((a, b) => a.a - b.a)[0];
      facts.push(["Jornada más dura", `J${hard.j.n}`, `media de ${hard.a.toFixed(1)} pts por jugador`]);
    }
    $("#facts").replaceChildren(...facts.map(([k, v, d]) => el("div", { class: "fact" }, el("div", { class: "k" }, k), el("div", { class: "v" }, v), el("div", { class: "d" }, d))));
  }

  let lastUpdated = null;
  async function load(auto = false) {
    try {
      const res = await fetch(`data.json?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (auto && data.updated === lastUpdated) return;
      const first = lastUpdated === null;
      lastUpdated = data.updated;
      S = compute(data);
      $("#season").textContent = `Temporada ${data.season}`;
      const d = new Date(data.updated);
      $("#updated").textContent = `Actualizado ${d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}`;
      if (first) sel.splice(0, sel.length, ...S.table.slice(0, 3).map((t) => t.name));
      const live = S.jornadas.filter((j) => j.started);
      const liveN = (live[live.length - 1] || S.jornadas[0]).n;
      // en la primera carga (o si se seguía la jornada en curso) se muestra la jornada en curso
      if (first || curJ === prevLive || !S.jornadas.some((j) => j.n === curJ)) curJ = liveN;
      prevLive = liveN;
      renderTiles(data); renderTable(); renderEvo(); renderJornada(); renderStack(); renderComodin(); renderFacts(data);
    } catch (e) {
      if (!auto) $("#updated").replaceChildren(el("span", { class: "err" }, `No se pudieron cargar los datos (${e.message}).`));
    }
  }
  let prevLive = null;
  // Comprueba si hay datos nuevos cada 2 minutos (y al volver a la pestaña) sin recargar la página
  setInterval(() => { if (!document.hidden) load(true); }, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S) load(true); });

  // ---------- Pantalla completa (Clasificación y Jornada) ----------
  // La tarjeta ocupa toda la ventana; además se pide pantalla completa al navegador si lo permite (en iPhone no).
  function setFull(card, on) {
    document.querySelectorAll(".fs-able.is-full").forEach((c) => { if (c !== card) c.classList.remove("is-full"); });
    card.classList.toggle("is-full", on);
    document.body.classList.toggle("has-full", on);
    const b = card.querySelector(".fs-btn");
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "✕ Salir" : "⛶ Pantalla completa";
    b.title = on ? "Salir de pantalla completa (Esc)" : "Pantalla completa";
    const root = document.documentElement;
    if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    fit(card);
  }
  // En pantalla completa la tabla se reduce entera para que quepa en la pantalla, como una imagen
  function fit(card) {
    const box = card.querySelector(".scroll-x"), t = box.querySelector("table");
    t.style.transform = ""; box.style.width = ""; box.style.height = "";
    if (!card.classList.contains("is-full")) return;
    const w = t.offsetWidth, h = t.offsetHeight;
    const cs = getComputedStyle(card);
    const availW = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = window.innerHeight - box.getBoundingClientRect().top - parseFloat(cs.paddingBottom);
    const k = Math.min(availW / w, availH / h, 1.6);
    t.style.transform = `scale(${k})`;
    box.style.width = `${w * k}px`; box.style.height = `${h * k}px`;
  }
  function refit() { document.querySelectorAll(".fs-able.is-full").forEach(fit); }
  document.querySelectorAll(".fs-able").forEach((card) =>
    card.querySelector(".fs-btn").addEventListener("click", () => setFull(card, !card.classList.contains("is-full"))));
  const closeFull = () => document.querySelectorAll(".fs-able.is-full").forEach((c) => setFull(c, false));
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) closeFull(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFull(); });

  document.querySelectorAll("#evoMode button").forEach((b) => b.addEventListener("click", () => {
    evoMode = b.dataset.m;
    document.querySelectorAll("#evoMode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderEvo();
  }));
  // ---------- Pestañas (#clasificacion, #jornadas, #estadisticas) ----------
  const TABS = ["clasificacion", "jornadas", "estadisticas", "normativa"];
  function showTab() {
    const t = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : TABS[0];
    document.querySelectorAll(".tabs a").forEach((a) => { a.setAttribute("aria-selected", String(a.dataset.tab === t)); if (a.dataset.tab === t) a.scrollIntoView({ block: "nearest", inline: "nearest" }); });
    document.querySelectorAll(".tabpanel").forEach((p) => { p.hidden = p.dataset.panel !== t; });
    if (t === "clasificacion" && S) renderEvo(); // el gráfico se dimensiona con el ancho visible
  }
  window.addEventListener("hashchange", () => { closeFull(); showTab(); window.scrollTo(0, 0); });
  showTab();

  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (S) renderEvo(); refit(); }, 120); });
  load();
})();
