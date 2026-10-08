(function () {
  const { SEED, ISL, COMP, fromText, evaluate } = window.Sibr;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MARK = { g: "✓", m: "~", b: "✕" };
  const color = v => v >= .7 ? "var(--good)" : v >= .45 ? "var(--mid)" : "var(--bad)";

  let results = SEED.map(i => evaluate({ ...i }));
  let active = 0;

  function chip(cls, label, delay) { return `<span class="chip ${cls}" style="animation-delay:${delay}ms">${label}</span>`; }

  function renderMatrix() {
    $("#matrix tbody").innerHTML = results.map((r, n) => {
      const d = n * 70, it = r.idea;
      return `<tr data-i="${n}" class="${n === active ? "active" : ""}" style="animation-delay:${d}ms" tabindex="0">
        <td>${n + 1}</td>
        <td class="left">${esc(it.name)}<small>${esc(it.note || "")}</small></td>
        <td data-label="Pain">${chip(it.pain, MARK[it.pain], d + 120)}</td>
        <td data-label="Value">${chip(it.value, MARK[it.value], d + 170)}</td>
        <td data-label="Target">${chip(it.target, MARK[it.target], d + 220)}</td>
        <td data-label="Growth">${chip(it.growth, MARK[it.growth], d + 270)}</td>
        <td data-label="Islamic">${chip(r.isl.cls, r.isl.label, d + 320)}</td>
        <td data-label="Comp.">${chip(r.comp.cls, r.comp.label, d + 370)}</td>
        <td class="sibr"><span class="ring" style="--c:${color(r.sibr / 100)}" data-p="${r.sibr}"><span>${r.sibr}</span></span></td>
      </tr>`;
    }).join("");
    requestAnimationFrame(() => setTimeout(() => document.querySelectorAll(".ring").forEach(el => el.style.setProperty("--p", el.dataset.p)), 60));
    document.querySelectorAll("#matrix tbody tr").forEach(tr => {
      const go = () => { active = +tr.dataset.i; renderMatrix(); renderLenses(); $("#lensPanel").scrollIntoView({ behavior: "smooth", block: "start" }); };
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    });
  }

  function renderLenses() {
    const r = results[active];
    $("#lensIdea").textContent = r.idea.name;
    $("#lenses").innerHTML = Object.entries(r.lenses).map(([group, segs]) => `
      <div class="lens"><h3>${group}</h3>
        ${segs.map(s => `<div class="cell" data-g="${esc(group)}" data-id="${s.id}">
          <span class="nm">${esc(s.name)}</span><span class="v">${Math.round(s.fit * 100)}</span>
          <span class="bar"><i style="background:${color(s.fit)}" data-w="${Math.round(s.fit * 100)}"></i></span>
        </div>`).join("")}
      </div>`).join("");
    requestAnimationFrame(() => setTimeout(() => document.querySelectorAll(".bar i").forEach(b => b.style.width = b.dataset.w + "%"), 40));
    const isl = r.idea.islamicNotes || [];
    $("#best").innerHTML = (r.idea.summary ? `${esc(r.idea.summary)}<br>` : "") + `Strongest fit: ${r.top.map(t => `<b>${esc(t.name)}</b> <small>(${t.group})</small>`).join(" · ")}` +
      (isl.length ? `<br>Islamic review flags: ${isl.map(esc).join("; ")}` : "") +
      (r.evidence && r.evidence.length ? `<br>Evidence: ${r.evidence.slice(0, 6).map(e => /^https?:/.test(e.url) ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || e.url)}</a>` : "").filter(Boolean).join(" · ")}` : "");
    document.querySelectorAll(".cell").forEach(c => c.addEventListener("click", () => openCell(c.dataset.g, c.dataset.id)));
  }

  function openCell(group, id) {
    const r = results[active], s = r.lenses[group].find(x => x.id === id);
    $("#drawerBody").innerHTML = `
      <div class="tag">${esc(group)}</div>
      <h3>${esc(s.name)}</h3>
      <div class="hint">${esc(r.idea.name)}</div>
      <div class="big" style="color:${color(s.fit)}">${Math.round(s.fit * 100)}</div>
      ${s.analysis ? `<p>${esc(s.analysis)}</p>` : ""}
      <ul>${s.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      ${r.meta && r.meta.engine === "laya"
        ? `<p class="note">Laya verdict${s.confidence != null ? `, confidence ${Math.round(s.confidence * 100)}%` : ""}.${s.escalate ? " <b>Low confidence: needs a human check.</b>" : ""} ${r.evidence && r.evidence.length ? `Backed by ${r.evidence.length} web results (listed under the lens map).` : "No web evidence was found for this run."}</p>`
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

  $("#ideaForm").addEventListener("submit", async e => {
    e.preventDefault();
    const v = $("#ideaInput").value.trim();
    const btn = $("#ideaForm button");
    if (!v || btn.disabled) return;
    let r;
    if (engine === "laya") {
      btn.disabled = true; btn.textContent = "Running Laya…";
      try { r = await remote(v); }
      catch (err) { r = evaluate(fromText(v)); r.fallback = err.message; }
      finally { btn.disabled = false; renderEngine(); }
    } else r = evaluate(fromText(v));
    results.unshift(r);
    active = 0;
    $("#ideaInput").value = "";
    renderMatrix(); renderLenses();
    if (r.fallback) $("#lensIdea").textContent = `Quick estimate: Laya ${r.fallback}.`;
  });

  renderEngine();
  renderMatrix(); renderLenses();

  // Animated background: slowly rotating square lattice
  const cv = $("#bg"), ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W, H, DPR;
  function size() { DPR = Math.min(2, devicePixelRatio || 1); W = cv.width = innerWidth * DPR; H = cv.height = innerHeight * DPR; }
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
  function frame(ts) {
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
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
