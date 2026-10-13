(() => {
  const C = window.LIGA_CONFIG;
  const { parseScore, norm, show } = window.LIGA;
  const API = `https://api.github.com/repos/${C.owner}/${C.repo}/contents`;
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else if (k === "checked") e.checked = v;
      else e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const views = ["vLogin", "vSetup", "vEdit"];
  const showView = (id) => views.forEach((v) => $("#" + v).classList.toggle("hidden", v !== id));
  const msg = (sel, text, cls = "") => { const e = $(sel); e.className = cls; e.textContent = text; };

  // ---------- Cifrado del token (PBKDF2 + AES-GCM) ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const ITER = 600000;
  async function deriveKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encryptToken(token, pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pw, salt, ITER);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token));
    return { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function decryptToken(k, pw) {
    const key = await deriveKey(pw, unb64(k.salt), k.iter);
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(k.iv) }, key, unb64(k.ct)));
  }

  // ---------- GitHub ----------
  let TOKEN = null;
  const gh = async (path, opts = {}, token = TOKEN) => {
    const res = await fetch(`${API}/${path}${opts.method ? "" : `?ref=${C.branch}&t=${Date.now()}`}`, {
      ...opts,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
      cache: "no-store",
    });
    if (!res.ok) { const e = new Error(`GitHub ${res.status}`); e.status = res.status; try { e.detail = (await res.json()).message; } catch {} throw e; }
    return res.json();
  };
  const getFile = async (path) => { const r = await gh(path); return { sha: r.sha, text: dec.decode(unb64(r.content)) }; };
  const putFile = (path, text, message, sha, token) => gh(path, {
    method: "PUT", body: JSON.stringify({ message, content: b64(enc.encode(text)), branch: C.branch, ...(sha ? { sha } : {}) }),
  }, token);

  // ---------- Arranque ----------
  let KEY = null;
  async function start() {
    try {
      const r = await fetch(`key.json?v=${Date.now()}`, { cache: "no-store" });
      KEY = r.ok ? await r.json() : null;
    } catch { KEY = null; }
    let saved = null;
    try { saved = sessionStorage.getItem("liga-token"); } catch {}
    if (saved) { TOKEN = saved; return openEditor(); }
    showView(KEY ? "vLogin" : "vSetup");
  }

  $("#toSetup").addEventListener("click", (e) => { e.preventDefault(); showView("vSetup"); });

  $("#fLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg("#loginMsg", "Comprobando…");
    try {
      TOKEN = await decryptToken(KEY, $("#pw").value);
    } catch { return msg("#loginMsg", "Contraseña incorrecta.", "err"); }
    try { sessionStorage.setItem("liga-token", TOKEN); } catch {}
    $("#pw").value = "";
    openEditor();
  });

  $("#fSetup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("#sToken").value.trim(), pw = $("#sPw").value;
    if (pw !== $("#sPw2").value) return msg("#setupMsg", "Las contraseñas no coinciden.", "err");
    msg("#setupMsg", "Comprobando el token…");
    try {
      let sha;
      try { sha = (await gh("key.json", {}, token)).sha; } catch (err) { if (err.status !== 404) throw err; }
      const k = await encryptToken(token, pw);
      await putFile("key.json", JSON.stringify(k, null, 1) + "\n", "Admin: configurar token", sha, token);
      KEY = k; TOKEN = token;
      try { sessionStorage.setItem("liga-token", TOKEN); } catch {}
      $("#sToken").value = $("#sPw").value = $("#sPw2").value = "";
      msg("#setupMsg", "");
      openEditor();
    } catch (err) {
      msg("#setupMsg", err.status === 401 || err.status === 403 || err.status === 404
        ? "El token no puede escribir en el repo. Revisa que tenga acceso a la-liga-pronostics con Contents: Read and write."
        : `Error: ${err.message} ${err.detail || ""}`, "err");
    }
  });

  // ---------- Editor ----------
  let D = null, SHA = null, cur = null, dirty = false;
  const setDirty = (v = true) => { dirty = v; msg("#status", v ? "Cambios sin guardar" : "", v ? "err" : ""); };
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  async function openEditor() {
    showView("vEdit");
    msg("#status", "Cargando datos…");
    try {
      const f = await getFile("data.json");
      D = JSON.parse(f.text); SHA = f.sha;
    } catch (err) {
      if (err.status === 401) { try { sessionStorage.removeItem("liga-token"); } catch {} TOKEN = null; showView(KEY ? "vLogin" : "vSetup"); return msg(KEY ? "#loginMsg" : "#setupMsg", "El token ha caducado o no es válido. Configura uno nuevo.", "err"); }
      return msg("#status", `No se pudo leer data.json: ${err.message}`, "err");
    }
    const started = D.jornadas.filter((j) => j.matches.some((m) => m.result));
    const pending = D.jornadas.find((j) => j.matches.some((m) => !m.result) && j.matches.some((m) => m.result));
    cur = (pending || started[started.length - 1] || D.jornadas[0]).n;
    renderAll(); setDirty(false);
  }

  const J = () => D.jornadas.find((j) => j.n === cur);

  function renderAll() {
    $("#jSel").replaceChildren(...D.jornadas.map((j) => el("option", { value: j.n }, `Jornada ${j.n}`)));
    $("#jSel").value = cur;
    renderMatches(); renderPreds(); renderPlayers();
  }

  const scoreInput = (value, onChange) => {
    const i = el("input", { type: "text", value: value ? show(value) : "", inputmode: "numeric", placeholder: "–" });
    i.addEventListener("input", () => {
      const v = i.value.trim();
      i.classList.toggle("bad", v !== "" && !parseScore(v));
      onChange(v === "" ? null : norm(v) || v);
      setDirty();
    });
    return i;
  };

  function renderMatches() {
    const j = J();
    $("#mTitle").textContent = `Partidos y resultados · Jornada ${j.n}`;
    const head = el("tr", {}, el("th", {}, "#"), el("th", {}, "Local"), el("th", {}, "Visitante"), el("th", {}, "Resultado"), el("th", {}, ""));
    const rows = j.matches.map((m, i) => {
      const team = (k) => { const t = el("input", { type: "text", class: "team", value: m[k] }); t.addEventListener("input", () => { m[k] = t.value.trim().toUpperCase(); setDirty(); renderPredHead(); }); return t; };
      return el("tr", {}, el("td", {}, i + 1), el("td", {}, team("home")), el("td", {}, team("away")),
        el("td", {}, scoreInput(m.result, (v) => { m.result = v; if (v) delete m.status; }),
          window.LIGA.HALTED.includes(m.status) && !m.result ? el("span", { class: "badge" }, ` ${m.status}`) : null),
        el("td", {}, el("button", { type: "button", title: "Quitar partido", onclick: () => removeMatch(i) }, "✕")));
    });
    $("#mTable").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
  }

  function removeMatch(i) {
    const j = J();
    j.matches.splice(i, 1);
    for (const p of Object.keys(j.preds)) j.preds[p].splice(i, 1);
    for (const p of Object.keys(j.comodin)) {
      if (j.comodin[p] === i) delete j.comodin[p];
      else if (j.comodin[p] > i) j.comodin[p]--;
    }
    setDirty(); renderMatches(); renderPreds();
  }

  function renderPredHead() {
    const j = J();
    const th = $("#pTable thead tr");
    if (th) th.replaceChildren(el("th", { class: "name" }, "Jugador"), ...j.matches.map((m) => el("th", {}, `${m.home || "?"}-${m.away || "?"}`)));
  }

  function renderPreds() {
    const j = J();
    j.preds = j.preds || {}; j.comodin = j.comodin || {};
    const rows = D.players.map((p) => {
      const tds = j.matches.map((_, i) => {
        const td = el("td", { class: j.comodin[p] === i ? "has-com" : "" });
        const inp = scoreInput((j.preds[p] || [])[i], (v) => {
          if (!j.preds[p]) j.preds[p] = j.matches.map(() => null);
          j.preds[p][i] = v;
          if (j.preds[p].every((x) => !x)) delete j.preds[p];
        });
        const rad = el("input", { type: "radio", name: `com-${p}`, title: "Comodín", checked: j.comodin[p] === i });
        rad.addEventListener("change", () => {
          j.comodin[p] = i; setDirty();
          td.parentElement.querySelectorAll("td").forEach((c) => c.classList.remove("has-com"));
          td.classList.add("has-com");
        });
        td.append(el("div", { class: "pc" }, inp, rad));
        return td;
      });
      return el("tr", {}, el("td", { class: "name" }, p), tds);
    });
    $("#pTable").replaceChildren(el("thead", {}, el("tr")), el("tbody", {}, rows));
    renderPredHead();
  }

  function renderPlayers() {
    D.bote = D.bote || {};
    const rows = D.players.map((p) => {
      const n = el("input", { type: "number", step: "0.5", min: "0", value: D.bote[p] ?? 0 });
      n.addEventListener("input", () => { D.bote[p] = Number(n.value) || 0; setDirty(); });
      return el("tr", {}, el("td", {}, p), el("td", {}, n, " €"));
    });
    $("#plTable").replaceChildren(el("tbody", {}, rows));
  }

  $("#jSel").addEventListener("change", () => { cur = Number($("#jSel").value); renderAll(); });
  $("#addM").addEventListener("click", () => {
    const j = J();
    j.matches.push({ home: "", away: "", result: null });
    for (const p of Object.keys(j.preds)) j.preds[p].push(null);
    setDirty(); renderMatches(); renderPreds();
  });
  $("#newJ").addEventListener("click", () => {
    const n = Math.max(0, ...D.jornadas.map((j) => j.n)) + 1;
    D.jornadas.push({ n, matches: Array.from({ length: 10 }, () => ({ home: "", away: "", result: null })), preds: {}, comodin: {} });
    cur = n; setDirty(); renderAll();
  });
  $("#fAddP").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#newP").value.trim().toUpperCase();
    if (!name || D.players.includes(name)) return;
    D.players.push(name); D.bote[name] = 0; $("#newP").value = "";
    setDirty(); renderPreds(); renderPlayers();
  });

  function validate() {
    for (const j of D.jornadas) {
      for (const m of j.matches) {
        if (!m.home || !m.away) return `J${j.n}: falta el nombre de algún equipo.`;
        if (m.result && !parseScore(m.result)) return `J${j.n}: resultado no válido en ${m.home}-${m.away} ("${m.result}").`;
      }
      for (const [p, arr] of Object.entries(j.preds)) arr.forEach((v, i) => {
        if (v && !parseScore(v)) throw `J${j.n}: pronóstico no válido de ${p} en ${j.matches[i].home}-${j.matches[i].away} ("${v}").`;
      });
    }
    return null;
  }

  $("#save").addEventListener("click", async () => {
    let problem;
    try { problem = validate(); } catch (e) { problem = e; }
    if (problem) return msg("#status", problem, "err");
    $("#save").disabled = true;
    msg("#status", "Guardando…");
    try {
      D.updated = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      D.updatedBy = "Admin";
      const r = await putFile("data.json", JSON.stringify(D, null, 1) + "\n", `J${cur}: actualizar resultados y pronósticos`, SHA);
      SHA = r.content.sha;
      setDirty(false);
      msg("#status", "Guardado ✓ La web se actualiza en 1–2 minutos.", "ok");
    } catch (err) {
      msg("#status", err.status === 409
        ? "Otro admin ha guardado cambios mientras editabas. Copia lo tuyo, recarga la página y vuelve a introducirlo."
        : `No se pudo guardar: ${err.message} ${err.detail || ""}`, "err");
    } finally { $("#save").disabled = false; }
  });

  $("#fPw").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg("#pwMsg", "Guardando…");
    try {
      let sha; try { sha = (await gh("key.json")).sha; } catch {}
      const k = await encryptToken(TOKEN, $("#nPw").value);
      await putFile("key.json", JSON.stringify(k, null, 1) + "\n", "Admin: cambiar contraseña", sha);
      KEY = k; $("#nPw").value = "";
      msg("#pwMsg", "Contraseña cambiada ✓", "ok");
    } catch (err) { msg("#pwMsg", `Error: ${err.message}`, "err"); }
  });
  $("#logout").addEventListener("click", () => { try { sessionStorage.removeItem("liga-token"); } catch {} TOKEN = null; location.reload(); });

  start();
})();
