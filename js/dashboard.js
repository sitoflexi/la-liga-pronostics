(() => {
  const { compute, show } = window.LIGA;
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
    const live = [...S.active].reverse().find((x) => !x.complete) || S.active[S.active.length - 1];
    let best = null;
    for (const x of S.active) for (const p of data.players) {
      const pts = x.rows[p].pts;
      if (!best || pts > best.pts) best = { pts, who: [p], n: x.n };
      else if (pts === best.pts && best.n === x.n) best.who.push(p);
    }
    const bote = Object.values(data.bote || {}).reduce((a, b) => a + b, 0);
    const tile = (k, v, d) => el("div", { class: "tile" }, el("div", { class: "k" }, k), el("div", { class: "v" }, v), el("div", { class: "d" }, d));
    $("#tiles").replaceChildren(
      tile("Líder", leaders, `${lead.total} pts` + (second ? ` · +${lead.total - second.total} sobre el siguiente` : "")),
      tile(live && !live.complete ? "Jornada en curso" : "Última jornada", live ? `J${live.n}` : "—",
        live ? `${live.played} de ${live.j.matches.length} partidos jugados` : ""),
      tile("Mejor jornada", best ? `${best.pts} pts` : "—", best ? `${best.who.join(" · ")} en la J${best.n}` : ""),
      tile("Bote acumulado", `${bote.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, `${data.players.length} jugadores`),
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
      el("th", {}, "Bote"));
    const rows = S.table.map((t) => {
      const c = colorOf(t.name);
      const tr = el("tr", { class: "clickable" + (c ? " sel" : ""), onclick: () => toggle(t.name) },
        el("td", { class: "pos" }, t.pos),
        el("td", { class: "name" }, t.name),
        S.active.map((x) => {
          const r = x.rows[t.name];
          const won = x.winners.includes(t.name);
          return el("td", { class: `heat h${heat(r.pts)}` + (x.complete ? "" : " live"), title: `J${x.n}: ${r.pts} pts` },
            r.predicted ? r.pts : "–", won ? el("span", { class: "crown" }, " 👑") : null);
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
      x.complete ? "" : el("span", { class: "badge" }, x.started ? `en curso · ${x.played}/${x.j.matches.length}` : "sin empezar"));
    const head = el("tr", {}, el("th", { class: "name" }, "Jugador"),
      x.j.matches.map((mt) => el("th", { class: "match" }, mt.home, el("small", {}, mt.away))),
      el("th", {}, "Pts"));
    const res = el("tr", { class: "result" }, el("td", { class: "name" }, "Resultado"),
      x.j.matches.map((mt) => el("td", {}, mt.result ? show(mt.result) : "–")), el("td", {}, ""));
    const order = [...S.table].map((t) => t.name).sort((a, b) => x.rows[b].pts - x.rows[a].pts || a.localeCompare(b));
    const rows = order.map((p) => {
      const r = x.rows[p];
      return el("tr", {}, el("td", { class: "name" }, p, x.winners.includes(p) ? " 👑" : ""),
        r.cells.map((c) => el("td", {
          class: `cell ${c.o}` + (c.comodin ? " comodin" : ""),
          title: c.o === "pending" || c.o === "empty" ? "" : `${c.pts} pts` + (c.comodin ? " (comodín ×2)" : ""),
        }, c.pred ? show(c.pred) : "·")),
        el("td", { class: "total" }, r.predicted ? r.pts : "–"));
    });
    $("#jTable").replaceChildren(el("thead", {}, head, res), el("tbody", {}, rows));
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

  async function load() {
    try {
      const res = await fetch(`data.json?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      S = compute(data);
      $("#season").textContent = `Temporada ${data.season}`;
      const d = new Date(data.updated);
      $("#updated").textContent = `Actualizado ${d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}`;
      sel.splice(0, sel.length, ...S.table.slice(0, 3).map((t) => t.name));
      const live = S.jornadas.filter((j) => j.started);
      curJ = (live[live.length - 1] || S.jornadas[0]).n;
      renderTiles(data); renderTable(); renderEvo(); renderJornada(); renderStack(); renderComodin(); renderFacts(data);
    } catch (e) {
      $("#updated").replaceChildren(el("span", { class: "err" }, `No se pudieron cargar los datos (${e.message}).`));
    }
  }

  document.querySelectorAll("#evoMode button").forEach((b) => b.addEventListener("click", () => {
    evoMode = b.dataset.m;
    document.querySelectorAll("#evoMode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderEvo();
  }));
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => S && renderEvo(), 120); });
  load();
})();
