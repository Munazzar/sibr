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
    $("#best").innerHTML = `Strongest fit: ${r.top.map(t => `<b>${esc(t.name)}</b> <small>(${t.group})</small>`).join(" · ")}` +
      (isl.length ? `<br>Islamic review flags: ${isl.map(esc).join("; ")}` : "");
    document.querySelectorAll(".cell").forEach(c => c.addEventListener("click", () => openCell(c.dataset.g, c.dataset.id)));
  }

  function openCell(group, id) {
    const r = results[active], s = r.lenses[group].find(x => x.id === id);
    $("#drawerBody").innerHTML = `
      <div class="tag">${esc(group)}</div>
      <h3>${esc(s.name)}</h3>
      <div class="hint">${esc(r.idea.name)}</div>
      <div class="big" style="color:${color(s.fit)}">${Math.round(s.fit * 100)}</div>
      <ul>${s.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      <p class="note">Heuristic estimate. In the full engine this cell is backed by evidence (reviews, forums, competitors) and a calibrated Laya verdict.</p>`;
    $("#drawer").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
  }
  $("#closeDrawer").addEventListener("click", () => { $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") $("#closeDrawer").click(); });

  $("#ideaForm").addEventListener("submit", e => {
    e.preventDefault();
    const v = $("#ideaInput").value.trim();
    if (!v) return;
    results.unshift(evaluate(fromText(v)));
    active = 0;
    $("#ideaInput").value = "";
    renderMatrix(); renderLenses();
  });

  renderMatrix(); renderLenses();

  // Animated background: slowly rotating 8-point star lattice
  const cv = $("#bg"), ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W, H, DPR;
  function size() { DPR = Math.min(2, devicePixelRatio || 1); W = cv.width = innerWidth * DPR; H = cv.height = innerHeight * DPR; }
  addEventListener("resize", size); size();
  function star(x, y, r, a, alpha) {
    ctx.strokeStyle = `rgba(214,180,106,${alpha})`;
    for (const off of [0, Math.PI / 4]) {
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
