(function () {
  const { SEED, ISL, COMP, fromText, evaluate } = window.Sibr;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MARK = { g: "✓", m: "~", b: "✕" };
  const color = v => v >= .7 ? "var(--good)" : v >= .45 ? "var(--mid)" : "var(--bad)";

  let results = SEED.map(i => evaluate({ ...i }));
  let active = 0;
  const engineOf = r => (r.meta && r.meta.engine) || "quick";

  // What each parameter means, and what its levels say. Shown in the result report.
  const PARAMS = {
    pain: { name: "Pain", what: "How badly the target customer needs this problem solved. Strong pain means people already spend time or money on workarounds." },
    value: { name: "Value", what: "How willing customers are to pay for the solution, and how much." },
    target: { name: "Target", what: "How clearly the first customer is defined. A sharp target makes marketing cheaper and the product easier to get right." },
    growth: { name: "Growth", what: "Whether the market around the idea is growing, steady or shrinking." },
    islamic: { name: "Islamic alignment", what: "Checks for riba (interest), gambling, haram product categories, speculation and content concerns. A flag for scholarly review, never a ruling." },
    comp: { name: "Competition", what: "How crowded the space is, and whether the idea has room or a clear differentiator." }
  };
  const LEVEL_WORD = { g: "Strong", m: "Mixed", b: "Weak" };
  const COMP_WORD = { open: "open, with few direct competitors", diff: "competitive, but with room to differentiate", sat: "crowded" };
  const verdictWord = r => r.idea.islamic === "bad" ? "Flagged" : r.sibr >= 75 ? "Strong" : r.sibr >= 60 ? "Promising" : r.sibr >= 45 ? "Risky" : "Weak";
  const pct = v => Math.round(v * 100) + "%";

  function chip(cls, label, delay) { return `<span class="chip ${cls}" style="animation-delay:${delay}ms">${label}</span>`; }

  // ---------- Matrix filters ----------
  const F = { q: "", min: 0, isl: "", comp: "", eng: "", sort: "new" };
  function visibleRows() {
    let rows = results.map((r, i) => ({ r, i })).filter(({ r }) =>
      (!F.q || (r.idea.name + " " + (r.idea.note || "") + " " + (r.idea.text || "")).toLowerCase().includes(F.q)) &&
      r.sibr >= F.min && (!F.isl || r.idea.islamic === F.isl) && (!F.comp || r.idea.comp === F.comp) &&
      (!F.eng || engineOf(r) === F.eng));
    if (F.sort === "high") rows.sort((a, b) => b.r.sibr - a.r.sibr);
    if (F.sort === "low") rows.sort((a, b) => a.r.sibr - b.r.sibr);
    if (F.sort === "name") rows.sort((a, b) => a.r.idea.name.localeCompare(b.r.idea.name));
    return rows;
  }
  [["#fSearch", "q", v => v.trim().toLowerCase()], ["#fMin", "min", Number], ["#fIsl", "isl", String],
   ["#fComp", "comp", String], ["#fEng", "eng", String], ["#fSort", "sort", String]].forEach(([sel, key, cast]) =>
    $(sel).addEventListener("input", e => { F[key] = cast(e.target.value); $("#fMinV").textContent = F.min; renderMatrix(); }));
  $("#fReset").addEventListener("click", () => {
    Object.assign(F, { q: "", min: 0, isl: "", comp: "", eng: "", sort: "new" });
    ["#fSearch", "#fIsl", "#fComp", "#fEng"].forEach(s => $(s).value = ""); $("#fMin").value = 0; $("#fSort").value = "new";
    $("#fMinV").textContent = 0; renderMatrix();
  });

  function renderMatrix() {
    const rows = visibleRows();
    $("#fCount").textContent = `${rows.length} of ${results.length} ideas`;
    $("#matrix tbody").innerHTML = rows.length ? rows.map(({ r, i }, n) => {
      const d = n * 50, it = r.idea;
      return `<tr data-i="${i}" class="${i === active ? "active" : ""}" style="animation-delay:${d}ms" tabindex="0">
        <td>${n + 1}</td>
        <td class="left"><span class="nm">${esc(it.name)}</span><small>${esc(it.note || "")}${engineOf(r) === "laya" ? ' <em class="eng">Laya</em>' : ""}</small></td>
        <td data-label="Pain">${chip(it.pain, MARK[it.pain], d + 120)}</td>
        <td data-label="Value">${chip(it.value, MARK[it.value], d + 170)}</td>
        <td data-label="Target">${chip(it.target, MARK[it.target], d + 220)}</td>
        <td data-label="Growth">${chip(it.growth, MARK[it.growth], d + 270)}</td>
        <td data-label="Islamic">${chip(r.isl.cls, r.isl.label, d + 320)}</td>
        <td data-label="Comp.">${chip(r.comp.cls, r.comp.label, d + 370)}</td>
        <td class="sibr"><span class="ring" style="--c:${color(r.sibr / 100)}" data-p="${r.sibr}"><span>${r.sibr}</span></span></td>
      </tr>`;
    }).join("") : `<tr><td colspan="9" class="empty">No ideas match these filters.</td></tr>`;
    requestAnimationFrame(() => setTimeout(() => document.querySelectorAll(".ring").forEach(el => el.style.setProperty("--p", el.dataset.p)), 60));
    document.querySelectorAll("#matrix tbody tr[data-i]").forEach(tr => {
      const go = () => { active = +tr.dataset.i; renderAll(); $("#reportPanel").scrollIntoView({ behavior: "smooth", block: "start" }); };
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    });
  }

  // ---------- Result report: summary, each parameter explained, behind the scenes ----------
  function bars(probs, labels) {
    if (!probs) return "";
    return `<div class="probs">${Object.entries(probs).map(([k, p]) =>
      `<div class="pr"><span>${esc(labels ? labels[k] || k : k)}</span><span class="pb"><i style="width:${pct(p)}"></i></span><b>${pct(p)}</b></div>`).join("")}</div>`;
  }

  function paramWhy(r, key) {
    const v = r.verdicts && r.verdicts[key];
    if (engineOf(r) === "laya" && v) {
      const conf = v.confidence != null ? ` Laya's confidence: ${pct(v.confidence)}.` : "";
      if (v.levels) {
        const lv = v.levels, sc = v.score;
        const lo = Math.floor(sc), hi = Math.min(lv.length - 1, lo + 1);
        const where = lo === hi || sc === lo ? `“${lv[lo]}”` : `between “${lv[lo]}” and “${lv[hi]}”`;
        return `<p>Laya's expected level is <b>${sc.toFixed(2)} of ${lv.length - 1}</b>, ${where}.${conf}</p>` +
          bars(v.probabilities, Object.fromEntries(lv.map((l, i) => [String(i), l])));
      }
      const extra = key === "islamic" && v.keyword && v.keyword !== "ok" && v.keyword !== v.value
        ? ` The keyword check raised it to <b>${esc(r.isl.label)}</b>, because the stricter of the two is kept.` : "";
      return `<p>Laya chose <b>“${esc(v.labels[v.value])}”</b>.${conf}${extra}</p>` + bars(v.probabilities, v.labels);
    }
    const why = r.idea.reasons && r.idea.reasons[key];
    return `<p>${why ? esc(why) : "Set by hand for this sample idea."} <span class="muted">Quick engine: keyword rules, not research.</span></p>`;
  }

  function resultLabel(r, key) {
    if (key === "islamic") return { cls: r.isl.cls, label: r.isl.label };
    if (key === "comp") return { cls: r.comp.cls, label: r.comp.label };
    const l = r.idea[key]; return { cls: l, label: LEVEL_WORD[l] };
  }

  function summaryText(r) {
    const it = r.idea, keys = ["pain", "value", "target", "growth"];
    const strong = keys.filter(k => it[k] === "g").map(k => PARAMS[k].name.toLowerCase());
    const weak = keys.filter(k => it[k] === "b").map(k => PARAMS[k].name.toLowerCase());
    const cells = Object.entries(r.lenses).flatMap(([g, cs]) => cs.map(c => ({ ...c, group: g }))).sort((a, b) => b.fit - a.fit);
    const low = cells.slice(-3).reverse();
    const parts = [
      r.idea.islamic === "bad" ? `<b>Flagged, Sibr ${r.sibr}/100.</b> It scores well on paper, but it raises a clear Islamic-alignment flag that needs scholarly review before anything else.`
        : `<b>${verdictWord(r)} idea, Sibr ${r.sibr}/100.</b>`,
      strong.length ? `Strong on ${strong.join(", ")}.` : "No dimension rates strong yet.",
      weak.length ? `Weak on ${weak.join(", ")}: work on these first.` : "",
      `Competition looks <b>${COMP_WORD[r.idea.comp] || r.comp.label.toLowerCase()}</b>; Islamic check: <b>${r.isl.label}</b>.`,
      `Best audiences: ${r.top.map(t => `<b>${esc(t.name)}</b>`).join(", ")}. Weakest: ${low.map(t => esc(t.name)).join(", ")}.`
    ];
    return parts.filter(Boolean).join(" ");
  }

  function renderReport() {
    const r = results[active], it = r.idea;
    $("#reportIdea").textContent = it.name;
    const isl = it.islamicNotes || [];
    const engineLine = engineOf(r) === "laya"
      ? `Scored by <b>Laya</b> (${esc(r.meta.laya_model || "")}) with ${esc((r.meta.llm && r.meta.llm.model) || "no LLM")} on your PC.`
      : `Scored by the <b>Quick</b> engine in your browser${r.fallback ? ` because Laya ${esc(r.fallback)}` : ""}.`;
    $("#summary").innerHTML = `
      <div class="sumScore" style="--c:${color(r.sibr / 100)}"><span>${r.sibr}</span><small>${verdictWord(r)}</small></div>
      <div class="sumText">
        ${it.summary ? `<p class="llm">${esc(it.summary)}</p>` : ""}
        <p>${summaryText(r)}</p>
        ${isl.length ? `<p class="flags">Islamic review flags: ${isl.map(esc).join("; ")}</p>` : ""}
        <p class="muted">${engineLine}</p>
      </div>`;
    $("#params").innerHTML = Object.entries(PARAMS).map(([k, p], n) => {
      const res = resultLabel(r, k);
      return `<article class="param" style="animation-delay:${n * 60}ms">
        <header><h3>${p.name}</h3>${chip(res.cls, res.label, n * 60)}</header>
        <p class="what">${p.what}</p>
        <div class="why">${paramWhy(r, k)}</div>
      </article>`;
    }).join("");
    renderTrace(r);
  }

  function renderTrace(r) {
    let html;
    if (engineOf(r) === "laya" && r.meta.steps) {
      const total = r.meta.steps.reduce((s, x) => s + x.ms, 0);
      html = `<ol class="trace">${r.meta.steps.map(s => `<li class="${s.ok ? "ok" : "bad"}"><b>${esc(s.step)}</b>
          <span class="ms">${(s.ms / 1000).toFixed(1)} s</span><span>${esc(s.detail)}</span></li>`).join("")}</ol>
        <p class="muted">Total ${(total / 1000).toFixed(1)} s on your PC.</p>`;
      const card = r.idea.card || {};
      html += `<h4>Idea card the LLM wrote</h4><dl class="card">${["problem", "user", "solution", "revenue", "delivery"]
        .filter(k => card[k]).map(k => `<dt>${k}</dt><dd>${esc(card[k])}</dd>`).join("") || "<dd>Not available (LLM off).</dd>"}</dl>`;
      if (r.evidence && r.evidence.length) html += `<h4>Web evidence Laya read</h4><ul class="ev">${r.evidence.slice(0, 8).map(e =>
        /^https?:/.test(e.url) ? `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || e.url)}</a><small>${esc((e.snippet || "").slice(0, 160))}</small></li>` : "").join("")}</ul>`;
    } else {
      html = `<ol class="trace"><li class="ok"><b>Keyword scan</b><span class="ms">&lt;0.1 s</span><span>Found themes: ${esc((r.idea.tags || []).join(", "))}.</span></li>
        <li class="ok"><b>Rules</b><span class="ms">&lt;0.1 s</span><span>Pain, value, target, growth, competition and Islamic flags come from fixed rules in engine.js.</span></li>
        <li class="ok"><b>Lens grid</b><span class="ms">&lt;0.1 s</span><span>Each of the 21 segments is scored by how strongly it cares about those themes and its spending power.</span></li></ol>
        <p class="muted">Nothing left your browser. ${r.fallback ? `Laya was not used: ${esc(r.fallback)}.` : "Pick “Laya on my PC” for the full model."}</p>`;
    }
    $("#traceBody").innerHTML = html;
  }

  // ---------- Lens map with filters ----------
  const LF = { group: "", min: 0, sort: "default", low: false };
  function renderLensFilters() {
    const groups = Object.keys(results[active].lenses);
    $("#lGroups").innerHTML = ["", ...groups].map(g => `<button type="button" data-g="${esc(g)}" aria-pressed="${LF.group === g}">${g || "All"}</button>`).join("");
    document.querySelectorAll("#lGroups button").forEach(b => b.addEventListener("click", () => { LF.group = b.dataset.g; renderLenses(); }));
    $("#lLowWrap").hidden = engineOf(results[active]) !== "laya";
  }
  $("#lMin").addEventListener("input", e => { LF.min = +e.target.value; $("#lMinV").textContent = LF.min; renderLenses(); });
  $("#lSort").addEventListener("input", e => { LF.sort = e.target.value; renderLenses(); });
  $("#lLow").addEventListener("change", e => { LF.low = e.target.checked; renderLenses(); });

  function renderLenses() {
    const r = results[active];
    renderLensFilters();
    $("#lensIdea").textContent = r.idea.name;
    let shown = 0;
    $("#lenses").innerHTML = Object.entries(r.lenses).filter(([g]) => !LF.group || g === LF.group).map(([group, segs]) => {
      let list = segs.filter(s => s.fit * 100 >= LF.min && (!LF.low || s.escalate));
      if (LF.sort === "fit") list = [...list].sort((a, b) => b.fit - a.fit);
      shown += list.length;
      return `<div class="lens"><h3>${group}</h3>
        ${list.map(s => `<div class="cell" data-g="${esc(group)}" data-id="${s.id}">
          <span class="nm">${esc(s.name)}${s.escalate ? ' <em class="low" title="Low confidence">check</em>' : ""}</span><span class="v">${Math.round(s.fit * 100)}</span>
          <span class="bar"><i style="background:${color(s.fit)}" data-w="${Math.round(s.fit * 100)}"></i></span>
        </div>`).join("") || '<p class="muted">No segments match.</p>'}
      </div>`;
    }).join("");
    $("#lCount").textContent = `${shown} segments shown`;
    requestAnimationFrame(() => setTimeout(() => document.querySelectorAll(".bar i").forEach(b => b.style.width = b.dataset.w + "%"), 40));
    $("#best").innerHTML = `Strongest fit: ${r.top.map(t => `<b>${esc(t.name)}</b> <small>(${t.group})</small>`).join(" · ")}. Click any segment for the reasoning.`;
    document.querySelectorAll(".cell").forEach(c => c.addEventListener("click", () => openCell(c.dataset.g, c.dataset.id)));
  }

  function renderAll() { renderMatrix(); renderReport(); renderLenses(); }

  function openCell(group, id) {
    const r = results[active], s = r.lenses[group].find(x => x.id === id);
    $("#drawerBody").innerHTML = `
      <div class="tag">${esc(group)}</div>
      <h3>${esc(s.name)}</h3>
      <div class="hint">${esc(r.idea.name)}</div>
      <div class="big" style="color:${color(s.fit)}">${Math.round(s.fit * 100)}</div>
      ${s.analysis ? `<p>${esc(s.analysis)}</p>` : ""}
      <ul>${s.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      ${engineOf(r) === "laya"
        ? `<p class="note">Laya verdict${s.confidence != null ? `, confidence ${pct(s.confidence)}` : ""}.${s.escalate ? " <b>Low confidence: needs a human check.</b>" : ""} ${r.evidence && r.evidence.length ? `Backed by ${r.evidence.length} web results (see Behind the scenes).` : "No web evidence was found for this run."}</p>`
        : `<p class="note">Heuristic estimate${r.fallback ? ` (Laya ${esc(r.fallback)})` : ""}. Choose “Laya on my PC” for a calibrated Laya verdict.</p>`}`;
    $("#drawer").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
  }
  $("#closeDrawer").addEventListener("click", () => { $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") $("#closeDrawer").click(); });

  // Engine choice. "quick" runs engine.js in the browser and works anywhere. "laya" calls the
  // model service on the owner's PC, reachable only over their Tailscale network.
  const ls = {
    get: k => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} }
  };
  const params = new URLSearchParams(location.search);
  for (const [p, k] of [["api", "sibrApi"], ["key", "sibrKey"]]) if (params.get(p)) ls.set(k, params.get(p).trim());
  if (params.has("key")) { const u = new URL(location.href); u.searchParams.delete("key"); history.replaceState(null, "", u); }
  // Served by the service itself, config.js points at this same origin.
  const servedApi = (window.SIBR_API || "").replace(/\/$/, "");
  const apiUrl = () => (servedApi || ls.get("sibrApi")).replace(/\/$/, "");
  let engine = ls.get("sibrEngine") || (servedApi ? "laya" : "quick");

  function renderEngine() {
    document.querySelectorAll(".engine [data-engine]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.engine === engine)));
    $("#ideaForm button").innerHTML = engine === "laya" ? 'Run with Laya <span aria-hidden="true">→</span>' : 'Run lenses <span aria-hidden="true">→</span>';
    $("#layaApi").value = ls.get("sibrApi"); $("#layaKey").value = ls.get("sibrKey");
    $("#layaApiRow").hidden = !!servedApi;
  }
  document.querySelectorAll(".engine [data-engine]").forEach(b => b.addEventListener("click", () => {
    engine = b.dataset.engine; ls.set("sibrEngine", engine); renderEngine();
    if (engine === "laya" && !apiUrl()) $("#layaSettings").open = true;
  }));
  function status(msg, ok) { const el = $("#layaStatus"); el.textContent = msg; el.className = "status " + (ok ? "ok" : ok === false ? "bad" : ""); }
  $("#layaForm").addEventListener("submit", async e => {
    e.preventDefault();
    ls.set("sibrApi", $("#layaApi").value.trim()); ls.set("sibrKey", $("#layaKey").value.trim());
    if (!apiUrl()) return status("Add your PC's Tailscale address first.", false);
    status("Checking…");
    try {
      const h = await (await fetch(apiUrl() + "/health")).json();
      status(`Connected: Laya ${h.laya.model || ""}, LLM ${h.llm.model || "off"}.`, true);
    } catch { status("Can't reach it. Is this device on Tailscale and is Sibr running on your PC?", false); }
  });

  async function remote(text, retry = true) {
    if (!apiUrl()) throw new Error("no Laya address set");
    const headers = { "content-type": "application/json" };
    if (ls.get("sibrKey")) headers["x-sibr-key"] = ls.get("sibrKey");
    let res;
    try { res = await fetch(apiUrl() + "/evaluate", { method: "POST", headers, body: JSON.stringify({ idea: text }) }); }
    catch { throw new Error("can't reach your PC. Connect this device to Tailscale and check Sibr is running"); }
    if (res.status === 401 && retry) {
      const k = prompt("Sibr access key");
      if (k) { ls.set("sibrKey", k.trim()); renderEngine(); return remote(text, false); }
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "HTTP " + res.status);
    return res.json();
  }

  // ---------- Processing animation ----------
  const STAGES = {
    laya: [["Reading your idea", "The LLM writes an idea card: problem, user, solution, revenue, delivery."],
           ["Searching the web", "Three free searches for competitors, Reddit threads and reviews."],
           ["Asking Laya", "43 typed questions answered in one pass: scores, choices and 21 segment fits."],
           ["Writing the verdict", "The LLM explains each segment and sums up."]],
    quick: [["Scanning keywords", "Finding the themes in your idea."], ["Applying rules", "Scoring the six parameters."],
            ["Mapping 21 segments", "Geography, age, community and interest."]]
  };
  let stageTimer = null;
  function startProcessing(kind) {
    const st = STAGES[kind], el = $("#processing");
    el.innerHTML = `<div class="scan" aria-hidden="true">${Array.from({ length: 21 }, (_, i) => `<i style="--d:${(i % 7) * 90 + Math.floor(i / 7) * 140}ms"></i>`).join("")}</div>
      <ol>${st.map(([t, d], i) => `<li data-s="${i}"><b>${t}</b><span>${d}</span></li>`).join("")}</ol>
      <div class="elapsed" aria-live="polite"></div>`;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("on"));
    let i = 0; const t0 = performance.now();
    const mark = () => el.querySelectorAll("li").forEach((li, n) => li.className = n < i ? "done" : n === i ? "now" : "");
    mark();
    // The service answers in one go, so stages advance on typical timings (and wait on the last one).
    const step = kind === "laya" ? [6000, 9000, 5000] : [250, 250];
    const tick = () => { if (i < st.length - 1) { i++; mark(); stageTimer = setTimeout(tick, step[i] || 4000); } };
    stageTimer = setTimeout(tick, step[0]);
    const clock = setInterval(() => { const s = (performance.now() - t0) / 1000; el.querySelector(".elapsed").textContent = `${s.toFixed(1)} s`; }, 100);
    return () => {
      clearTimeout(stageTimer); clearInterval(clock);
      i = st.length; mark();
      return new Promise(res => setTimeout(() => { el.classList.remove("on"); setTimeout(() => { el.hidden = true; res(); }, 300); }, 350));
    };
  }

  const input = $("#ideaInput");
  // Resize at most once per frame, and not at all where CSS field-sizing does it.
  const cssSizing = CSS.supports("field-sizing", "content");
  const count = $("#ideaCount"), meta = count.parentElement;
  let growQueued = false;
  const grow = () => {
    if (growQueued) return;
    growQueued = true;
    requestAnimationFrame(() => {
      growQueued = false;
      const n = input.value.length;
      count.textContent = `${n} / 5000`;
      meta.classList.toggle("near", n > 4500);
      if (cssSizing) return;
      input.style.height = "0";
      input.style.height = Math.min(Math.max(input.scrollHeight, 96), 340) + "px";
    });
  };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("#ideaForm").requestSubmit(); } });

  $("#ideaForm").addEventListener("submit", async e => {
    e.preventDefault();
    const v = input.value.trim();
    const btn = $("#ideaForm button");
    if (!v || btn.disabled) return;
    btn.disabled = true; btn.textContent = engine === "laya" ? "Running Laya…" : "Running…";
    const stop = startProcessing(engine === "laya" ? "laya" : "quick");
    let r;
    try {
      if (engine === "laya") {
        try { r = await remote(v); }
        catch (err) { r = evaluate(fromText(v)); r.fallback = err.message; }
      } else { await new Promise(res => setTimeout(res, 800)); r = evaluate(fromText(v)); }
    } finally { await stop(); btn.disabled = false; renderEngine(); }
    results.unshift(r);
    active = 0;
    input.value = ""; grow();
    renderAll();
    $("#reportPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  renderEngine();
  renderAll();

  // Animated background: slowly rotating square lattice
  const cv = $("#bg"), ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W, H, DPR;
  // The lattice is faint and blurred by opacity, so 1x resolution at ~30 fps looks the same and
  // leaves the main thread free for typing.
  function size() { DPR = 1; W = cv.width = innerWidth * DPR; H = cv.height = innerHeight * DPR; }
  addEventListener("resize", size); size();
  function star(x, y, r, a, alpha) {
    ctx.strokeStyle = `rgba(214,180,106,${alpha})`;
    for (const off of [0]) {
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const t = a + off + k * Math.PI / 2;
        ctx[k ? "lineTo" : "moveTo"](x + Math.cos(t) * r, y + Math.sin(t) * r);
      }
      ctx.closePath(); ctx.stroke();
    }
  }
  let last = -1e9;
  function frame(ts) {
    if (!reduce) requestAnimationFrame(frame);
    if (document.hidden || ts - last < 33) return;
    last = ts;
    const t = ts / 1000;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = DPR;
    const step = 120 * DPR;
    for (let y = -step; y < H + step; y += step)
      for (let x = -step; x < W + step; x += step) {
        const ox = (y / step) % 2 ? step / 2 : 0;
        const px = x + ox, py = y + ((t * 6 * DPR) % step);
        const pulse = .05 + .07 * (.5 + .5 * Math.sin(t * .8 + px * .004 + py * .003));
        star(px, py, 30 * DPR, t * .08 + (px + py) * .0005, pulse);
      }
  }
  requestAnimationFrame(frame);
})();
