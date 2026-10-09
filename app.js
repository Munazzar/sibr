(function () {
  const { SEED, SEGMENTS, PRESETS, ISL, COMP, fromText, evaluate } = window.Sibr;
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
      const d = Math.min(n, 8) * 30, it = r.idea;
      return `<tr data-i="${i}" class="${i === active ? "active" : ""}" style="animation-delay:${d}ms" tabindex="0">
        <td>${n + 1}</td>
        <td class="left"><span class="nm">${esc(it.name)}</span><small>${esc(it.note || "")}${engineOf(r) === "laya" ? ' <em class="eng">Laya</em>' : ""}</small></td>
        <td data-label="Pain">${chip(it.pain, MARK[it.pain], d + 60)}</td>
        <td data-label="Value">${chip(it.value, MARK[it.value], d + 80)}</td>
        <td data-label="Target">${chip(it.target, MARK[it.target], d + 100)}</td>
        <td data-label="Growth">${chip(it.growth, MARK[it.growth], d + 120)}</td>
        <td data-label="Islamic">${chip(r.isl.cls, r.isl.label, d + 140)}</td>
        <td data-label="Comp.">${chip(r.comp.cls, r.comp.label, d + 160)}</td>
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
        <li class="ok"><b>Lens grid</b><span class="ms">&lt;0.1 s</span><span>Each of the ${segCount(r)} segments you picked is scored by how strongly it cares about those themes and its spending power.</span></li></ol>
        <p class="muted">Nothing left your browser. ${r.fallback ? `Laya was not used: ${esc(r.fallback)}.` : "Pick “Laya on my PC” for the full model."}</p>`;
    }
    $("#traceBody").innerHTML = html;
  }

  const segCount = r => Object.values(r.lenses).reduce((n, cs) => n + cs.length, 0);

  // ---------- Audience picked before the run ----------
  // Open (the default) applies no filter: Sibr finds the audiences. Quick picks set a group in one
  // click; folded groups and search fine-tune it; people can also type their own audiences.
  const ALL_SEGS = Object.values(SEGMENTS).flat().map(x => x.id);
  const PRESET_IDS = Object.fromEntries(PRESETS.filter(p => p.ids !== "open").map(p => [p.id, p.ids === "all" ? ALL_SEGS : p.ids]));
  const CORE_QUESTIONS = 22, PER_CALL = 64, SUGGESTED = 10, MAX_CUSTOM = 12;
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let open = load("sibrAudOpen", true);
  let aud = new Set(ALL_SEGS.filter(id => new Set(load("sibrAud", PRESET_IDS.core)).has(id)));
  let custom = load("sibrAudCustom", []).filter(c => typeof c === "string").slice(0, MAX_CUSTOM);
  const openGroups = new Set();
  let find = "";
  const audList = () => open ? [] : ALL_SEGS.filter(id => aud.has(id));
  const samePreset = () => open ? PRESETS.find(p => p.ids === "open")
    : PRESETS.find(p => { const ids = PRESET_IDS[p.id]; return ids && ids.length === aud.size && ids.every(id => aud.has(id)); });

  function renderAudience() {
    const cur = samePreset();
    $("#audPresets").innerHTML = PRESETS.map(p => `<button type="button" data-p="${p.id}" aria-pressed="${cur === p}" class="${p.ids === "open" ? "openP" : ""}">${esc(p.name)}${p.ids === "open" ? "" : ` <small>${PRESET_IDS[p.id].length}</small>`}</button>`).join("") +
      `<button type="button" class="custom" aria-pressed="${!cur}" disabled>Custom</button>`;
    $("#audPresetHint").textContent = cur ? cur.hint : "Your own mix. Pick a quick pick above to start over.";
    const q = find.trim().toLowerCase();
    $("#audGroups").classList.toggle("dim", open);
    $("#audGroups").innerHTML = Object.entries(SEGMENTS).map(([g, segs]) => {
      const list = q ? segs.filter(x => (x.name + " " + x.who + " " + g).toLowerCase().includes(q)) : segs;
      if (!list.length) return "";
      const on = open ? [] : segs.filter(x => aud.has(x.id));
      const preview = open ? "" : on.length === segs.length ? "all" : on.length ? on.slice(0, 3).map(x => x.name).join(", ") + (on.length > 3 ? ` +${on.length - 3}` : "") : "none";
      const hint = (window.SIBR_SEGMENTS.groups.find(x => x.name === g) || {}).hint || "";
      return `<details class="audGroup" data-g="${esc(g)}" ${q || openGroups.has(g) ? "open" : ""}>
        <summary><b>${esc(g)}</b><span class="cnt${on.length ? " on" : ""}">${on.length}/${segs.length}</span><span class="pv">${esc(preview || hint)}</span>
          <span class="gAct"><button type="button" data-all="${esc(g)}">All</button><button type="button" data-none="${esc(g)}">None</button></span></summary>
        <div class="audSegs">${list.map(x => `<button type="button" class="audS" data-id="${x.id}" aria-pressed="${!open && aud.has(x.id)}" title="${esc(x.who)}">${esc(x.name)}</button>`).join("")}</div>
      </details>`;
    }).join("") || '<p class="muted">No segment matches that. Add it as your own audience below.</p>';
    $("#audFineN").textContent = `${ALL_SEGS.length} segments in ${Object.keys(SEGMENTS).length} groups`;
    $("#audCustomList").innerHTML = custom.map((c, i) => `<span class="cAud">${esc(c)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(c)}">×</button></span>`).join("");
    $("#audCustomAdd").disabled = custom.length >= MAX_CUSTOM;
    const n = open ? SUGGESTED : aud.size, extra = custom.length, total = n + extra;
    const qn = CORE_QUESTIONS + total, calls = total <= PER_CALL - CORE_QUESTIONS ? 1 : 1 + Math.ceil((total - (PER_CALL - CORE_QUESTIONS)) / PER_CALL);
    const yours = extra ? ` + ${extra} of your own` : "";
    $("#audSum").textContent = open ? `Open · Sibr finds the audiences${yours}` : total ? `${cur ? cur.name : "Custom"} · ${aud.size} segment${aud.size === 1 ? "" : "s"}${yours}` : "None picked";
    $("#audCost").innerHTML = open
      ? `No filter. Laya scores about <b>${SUGGESTED}</b> audiences suggested for your idea${yours} (<b>${qn}</b> questions). The Quick engine scans all ${ALL_SEGS.length} and shows the best 15.`
      : !total ? '<span class="warn">Pick at least one segment, or choose Open.</span>'
      : `<b>${aud.size}</b> of ${ALL_SEGS.length} segments${yours} · Laya asks <b>${qn}</b> questions${calls > 1 ? ` in ${calls} passes (slower)` : ""}`;
    save("sibrAud", [...aud]); save("sibrAudOpen", open); save("sibrAudCustom", custom);
  }
  $("#audPresets").addEventListener("click", e => {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    if (b.dataset.p === "open") open = true;
    else { open = false; aud = new Set(PRESET_IDS[b.dataset.p]); }
    renderAudience();
  });
  $("#audGroups").addEventListener("toggle", e => {
    const d = e.target; if (!d.dataset || !d.dataset.g || find) return;
    d.open ? openGroups.add(d.dataset.g) : openGroups.delete(d.dataset.g);
  }, true);
  $("#audGroups").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    // Picking anything switches from Open to your own selection.
    if (open && (b.dataset.all || b.dataset.id)) { open = false; aud = new Set(); }
    if (b.dataset.all || b.dataset.none) {
      e.preventDefault();
      const ids = SEGMENTS[b.dataset.all || b.dataset.none].map(x => x.id);
      if (b.dataset.all) ids.forEach(id => aud.add(id));
      else ids.forEach(id => aud.delete(id));
    } else if (b.dataset.id) {
      aud.has(b.dataset.id) ? aud.delete(b.dataset.id) : aud.add(b.dataset.id);
    }
    renderAudience();
  });
  $("#audFind").addEventListener("input", e => { find = e.target.value; renderAudience(); });
  $("#audClear").addEventListener("click", () => { open = false; aud = new Set(); custom = []; renderAudience(); });
  function addCustom() {
    const v = $("#audCustomIn").value.trim().replace(/\s+/g, " ").slice(0, 120);
    if (v.length < 3 || custom.length >= MAX_CUSTOM || custom.some(c => c.toLowerCase() === v.toLowerCase())) return;
    custom.push(v); $("#audCustomIn").value = ""; renderAudience();
  }
  $("#audCustomAdd").addEventListener("click", addCustom);
  $("#audCustomIn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } });
  $("#audCustomList").addEventListener("click", e => {
    const b = e.target.closest("button[data-rm]"); if (!b) return;
    custom.splice(+b.dataset.rm, 1); renderAudience();
  });
  renderAudience();

  // ---------- Lens map with filters ----------
  // Fits for one idea tend to bunch together (say 30 to 75), so the colours rank each audience
  // against the others for this idea: top fifth, middle, bottom third. The number stays absolute.
  const LF = { group: "", min: 0, sort: "fit", low: false, open: new Set() };
  const PREVIEW = 6;
  function renderLensFilters() {
    const groups = Object.keys(results[active].lenses);
    if (LF.group && !groups.includes(LF.group)) LF.group = "";
    $("#lGroups").innerHTML = ["", ...groups].map(g => `<button type="button" data-g="${esc(g)}" aria-pressed="${LF.group === g}">${g ? esc(g) : "All"}</button>`).join("");
    document.querySelectorAll("#lGroups button").forEach(b => b.addEventListener("click", () => { LF.group = b.dataset.g; renderLenses(); }));
    $("#lLowWrap").hidden = engineOf(results[active]) !== "laya";
  }
  $("#lMin").addEventListener("input", e => { LF.min = +e.target.value; $("#lMinV").textContent = LF.min; renderLenses(); });
  $("#lSort").addEventListener("input", e => { LF.sort = e.target.value; renderLenses(); });
  $("#lLow").addEventListener("change", e => { LF.low = e.target.checked; renderLenses(); });

  function tiers(cells) {
    const v = cells.map(c => c.fit).sort((a, b) => a - b);
    const q = p => v.length ? v[Math.round(p * (v.length - 1))] : 0;
    const hi = q(.8), lo = q(.3);
    return { med: q(.5), of: f => v.length < 4 ? (f >= .7 ? "hi" : f >= .45 ? "mid" : "lo") : f >= hi ? "hi" : f <= lo ? "lo" : "mid" };
  }
  const pct100 = f => Math.round(f * 100);
  function lensRow(s, group, t, med) {
    return `<button type="button" class="lrow t-${t.of(s.fit)}" data-g="${esc(group)}" data-id="${esc(s.id)}">
      <span class="nm">${esc(s.name)}${s.escalate ? ' <em class="low" title="Low confidence: worth a human check">check</em>' : ""}</span>
      <span class="v">${pct100(s.fit)}</span>
      <span class="track"><i style="--s:${s.fit.toFixed(3)}"></i><b class="med" style="left:${pct100(med)}%"></b></span>
    </button>`;
  }

  function renderLenses() {
    const r = results[active];
    renderLensFilters();
    $("#lensIdea").textContent = r.idea.name;
    const keep = s => s.fit * 100 >= LF.min && (!LF.low || s.escalate);
    const all = Object.entries(r.lenses).flatMap(([g, cs]) => cs.map(c => ({ ...c, group: g })));
    const t = tiers(all);
    const groups = Object.entries(r.lenses).filter(([g]) => !LF.group || g === LF.group);
    let shown = 0;
    const cards = groups.map(([group, segs]) => {
      let list = segs.filter(keep);
      if (LF.sort === "fit") list = [...list].sort((a, b) => b.fit - a.fit);
      shown += list.length;
      const open = LF.group || LF.open.has(group) || list.length <= PREVIEW + 1;
      const avg = segs.length ? pct100(segs.reduce((a, s) => a + s.fit, 0) / segs.length) : 0;
      return `<article class="lgrp">
        <header><h3>${esc(group)}</h3><span class="lmeta">${segs.length} · avg <b>${avg}</b></span></header>
        <div class="lrows">${(open ? list : list.slice(0, PREVIEW)).map(s => lensRow(s, group, t, t.med)).join("") || '<p class="muted lnone">No audiences match these filters.</p>'}</div>
        ${open || list.length <= PREVIEW ? (LF.open.has(group) && !LF.group ? `<button type="button" class="lmore" data-more="${esc(group)}">Show fewer</button>` : "")
          : `<button type="button" class="lmore" data-more="${esc(group)}">Show all ${list.length}</button>`}
      </article>`;
    }).join("");
    const best = all.filter(keep).sort((a, b) => b.fit - a.fit).slice(0, 5);
    const lead = best.length ? `<div class="lead">
        <div class="leadHead"><h3>Best audiences for this idea</h3>
          <span class="legend"><span><i class="t-hi"></i>Top fifth</span><span><i class="t-mid"></i>Middle</span><span><i class="t-lo"></i>Bottom third</span><span><i class="mk"></i>Median for this idea</span></span></div>
        <ol>${best.map((s, i) => `<li><button type="button" class="leadRow" data-g="${esc(s.group)}" data-id="${esc(s.id)}">
          <span class="rk">${String(i + 1).padStart(2, "0")}</span>
          <span class="who"><b>${esc(s.name)}</b><small>${esc(s.from || s.group)}</small></span>
          <span class="track"><i style="--s:${s.fit.toFixed(3)}"></i></span>
          <span class="v">${pct100(s.fit)}</span></button></li>`).join("")}</ol></div>` : "";
    $("#lenses").innerHTML = lead + `<div class="lgroups${groups.length === 1 ? " one" : ""}">${cards}</div>`;
    $("#lCount").textContent = `${shown} of ${all.length} audiences`;
    $("#best").innerHTML = "Click any audience to see why it fits. Numbers are the chance this audience wants the idea and would pay for it.";
    if (grownFor !== r) {  // bars grow in once per result, not on every filter change
      grownFor = r;
      $("#lenses").classList.remove("grown");
      requestAnimationFrame(() => setTimeout(() => $("#lenses").classList.add("grown"), 30));
    }
  }
  let grownFor = null;
  $("#lenses").addEventListener("click", e => {
    const more = e.target.closest("[data-more]");
    if (more) { const g = more.dataset.more; LF.open.has(g) ? LF.open.delete(g) : LF.open.add(g); renderLenses(); return; }
    const row = e.target.closest("[data-id]");
    if (row) openCell(row.dataset.g, row.dataset.id);
  });

  function renderAll() { renderMatrix(); renderReport(); renderLenses(); }

  function openCell(group, id) {
    const r = results[active], s = r.lenses[group].find(x => x.id === id);
    $("#drawerBody").innerHTML = `
      <div class="tag">${esc(group)}</div>
      <h3>${esc(s.name)}</h3>
      ${s.from ? `<div class="hint">${esc(s.from)}</div>` : ""}${s.custom && s.who !== s.name ? `<div class="hint">${esc(s.who)}</div>` : ""}
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

  async function remote(text, segments, aopts = {}, retry = true) {
    if (!apiUrl()) throw new Error("no Laya address set");
    const headers = { "content-type": "application/json" };
    if (ls.get("sibrKey")) headers["x-sibr-key"] = ls.get("sibrKey");
    let res;
    try { res = await fetch(apiUrl() + "/evaluate", { method: "POST", headers, body: JSON.stringify({ idea: text, segments, open_audience: !!aopts.open, custom: aopts.custom || [] }) }); }
    catch { throw new Error("can't reach your PC. Connect this device to Tailscale and check Sibr is running"); }
    if (res.status === 401 && retry) {
      const k = prompt("Sibr access key");
      if (k) { ls.set("sibrKey", k.trim()); renderEngine(); return remote(text, segments, aopts, false); }
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "HTTP " + res.status);
    return res.json();
  }

  // ---------- Processing animation ----------
  const STAGES = {
    laya: [["Reading your idea", "The LLM writes an idea card: problem, user, solution, revenue, delivery."],
           ["Searching the web", "Three free searches for competitors, Reddit threads and reviews."],
           ["Asking Laya", "Typed questions: scores, choices and a fit for each audience (suggested, picked or your own)."],
           ["Writing the verdict", "The LLM explains each segment and sums up."]],
    quick: [["Scanning keywords", "Finding the themes in your idea."], ["Applying rules", "Scoring the six parameters."],
            ["Mapping your segments", "Scoring each audience you picked."]]
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
    const step = kind === "laya" ? [6000, 9000, 5000] : [110, 110];
    const tick = () => { if (i < st.length - 1) { i++; mark(); stageTimer = setTimeout(tick, step[i] || 4000); } };
    stageTimer = setTimeout(tick, step[0]);
    const clock = setInterval(() => { const s = (performance.now() - t0) / 1000; el.querySelector(".elapsed").textContent = `${s.toFixed(1)} s`; }, 100);
    return () => {
      clearTimeout(stageTimer); clearInterval(clock);
      i = st.length; mark();
      const hold = kind === "quick" ? 120 : 350;
      return new Promise(res => setTimeout(() => { el.classList.remove("on"); setTimeout(() => { el.hidden = true; res(); }, 200); }, hold));
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
    if (!open && !aud.size && !custom.length) { $("#audience").open = true; $("#audience").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    btn.disabled = true; btn.textContent = engine === "laya" ? "Running Laya…" : "Running…";
    const stop = startProcessing(engine === "laya" ? "laya" : "quick");
    const segs = audList(), aopts = { open, custom: [...custom] };
    let r;
    try {
      if (engine === "laya") {
        try { r = await remote(v, segs, aopts); }
        catch (err) { r = evaluate(fromText(v), segs, aopts); r.fallback = err.message; }
      } else { await new Promise(res => setTimeout(res, 350)); r = evaluate(fromText(v), segs, aopts); }
    } finally { await stop(); btn.disabled = false; renderEngine(); }
    results.unshift(r);
    active = 0;
    input.value = ""; grow();
    renderAll();
    $("#reportPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  renderEngine();
  renderAll();

  // Background light streams. Hundreds of faint threads of light ride a slowly turning flow
  // field, leaving soft trails. Scrolling makes the current surge in the scroll direction and
  // shifts its colour from gold to emerald down the page; the pointer stirs a swirl that the
  // threads bend around and brighten in, and a click sends out a ripple. Drawn at reduced
  // resolution for softness and speed; it sleeps in hidden tabs and holds still for reduced motion.
  (function streams() {
    const cv = $("#bg"), ctx = cv.getContext("2d");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const RES = .6, TAU = Math.PI * 2;
    let W = 0, H = 0, ps = [], t = 0, last = performance.now();
    let sy = scrollY, vel = 0, surge = 0;              // scroll velocity, smoothed
    const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, on: 0, heat: 0 };
    const ripples = [];

    function spawn(p, anywhere) {
      p.x = anywhere ? Math.random() * W : -10 - Math.random() * 40;
      p.y = Math.random() * H;
      p.px = p.x; p.py = p.y;
      p.life = 0; p.max = 260 + Math.random() * 520;
      p.sp = .55 + Math.random() * .9;
      p.w = Math.random() < .12 ? 1.6 : .9;          // a few brighter strands
      p.k = Math.random();                             // colour offset
      return p;
    }
    function size() {
      W = Math.round(innerWidth * RES); H = Math.round(innerHeight * RES);
      cv.width = W; cv.height = H;
      const n = Math.min(340, Math.round(innerWidth * innerHeight / 6200));
      ps = Array.from({ length: n }, () => spawn({}, true));
      ctx.lineCap = "round";
    }
    // Smooth, slowly evolving direction field: mostly rightward with long rolling waves.
    function angle(x, y) {
      const o = sy * RES * .35;                       // the field scrolls with the page (parallax)
      const yy = y + o;
      return Math.sin(x * .0055 + t * .11) * .9 + Math.cos(yy * .0071 - t * .08) * .7
        + Math.sin((x - yy) * .0032 + t * .05) * .5 + surge * .9;
    }
    function frame(now) {
      const dt = Math.min(50, now - last) / 16.67; last = now;
      if (document.hidden) { requestAnimationFrame(frame); return; }
      t += .01 * dt;

      // Scroll: velocity -> surge (signed), decays smoothly.
      const d = scrollY - sy; sy = scrollY;
      vel += (d - vel) * .2;
      surge += (Math.max(-1.2, Math.min(1.2, vel * .02)) - surge) * .08;
      const prog = Math.min(1, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
      ptr.heat *= .94;

      // Fade old trails toward transparent so the aurora behind still shows.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${(.07 * dt).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      const R = 190 * RES, px = ptr.x * RES, py = ptr.y * RES;
      const boost = 1 + Math.abs(surge) * 2.2;
      for (const p of ps) {
        let a = angle(p.x, p.y), sp = p.sp * boost * 1.6;
        let vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, glow = 0;
        // Pointer: a swirl around it, a gentle pull in, and a push along its motion.
        const dx = p.x - px, dy = p.y - py, r2 = dx * dx + dy * dy;
        if (r2 < R * R * 4) {
          const r = Math.sqrt(r2) + 1, f = Math.max(0, 1 - r / (R * 2));
          const f2 = f * f * (.6 + ptr.on * .4);
          vx += (-dy / r * 3.2 - dx / r * .8) * f2 + ptr.vx * RES * .08 * f2;
          vy += (dx / r * 3.2 - dy / r * .8) * f2 + ptr.vy * RES * .08 * f2;
          glow = f2 * (1 + ptr.heat);
        }
        for (const rp of ripples) {
          const ex = p.x - rp.x, ey = p.y - rp.y, r = Math.sqrt(ex * ex + ey * ey) + 1;
          const band = 1 - Math.min(1, Math.abs(r - rp.r) / (26 * RES));
          if (band > 0) { vx += ex / r * band * 4 * rp.a; vy += ey / r * band * 4 * rp.a; glow += band * rp.a; }
        }
        p.px = p.x; p.py = p.y;
        p.x += vx * dt; p.y += vy * dt; p.life += dt;
        if (p.x > W + 20 || p.x < -60 || p.y < -20 || p.y > H + 20 || p.life > p.max) { spawn(p, p.life > p.max); continue; }
        const fade = Math.min(1, p.life / 40, (p.max - p.life) / 60);
        const al = (.16 + .7 * Math.min(1, glow)) * fade * (p.w > 1 ? 1.4 : 1);
        // Gold at the top of the page, drifting to emerald further down.
        const m = Math.min(1, Math.max(0, prog * 1.1 + (p.k - .5) * .5));
        const R0 = 241 - 178 * m, G0 = 216 - 25 * m, B0 = 154 - 11 * m;
        const hot = Math.min(1, glow);
        ctx.strokeStyle = `rgba(${R0 + (255 - R0) * hot | 0},${G0 + (250 - G0) * hot | 0},${B0 + (230 - B0) * hot | 0},${al.toFixed(3)})`;
        ctx.lineWidth = p.w + hot * 1.2;
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      if (ptr.on) {                                   // a faint living bloom under the pointer
        const g = ctx.createRadialGradient(px, py, 0, px, py, R * 1.3);
        g.addColorStop(0, `rgba(241,216,154,${(.012 * (1 + ptr.heat) * dt).toFixed(4)})`); g.addColorStop(1, "rgba(241,216,154,0)");
        ctx.fillStyle = g; ctx.fillRect(px - R * 1.3, py - R * 1.3, R * 2.6, R * 2.6);
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]; rp.r += 5 * dt * RES * 1.6; rp.a *= Math.pow(.965, dt);
        if (rp.a < .03) ripples.splice(i, 1);
      }
      ptr.vx *= .85; ptr.vy *= .85;
      if (!still) requestAnimationFrame(frame);
    }

    addEventListener("pointermove", e => {
      const pn = e.target.closest && e.target.closest(".panel");
      if (pn) { const b = pn.getBoundingClientRect(); pn.style.setProperty("--mx", e.clientX - b.left + "px"); pn.style.setProperty("--my", e.clientY - b.top + "px"); }
      if (ptr.x > -1e3) { ptr.vx = e.clientX - ptr.x; ptr.vy = e.clientY - ptr.y; ptr.heat = Math.min(1.5, ptr.heat + Math.hypot(ptr.vx, ptr.vy) * .004); }
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.on = 1;
    }, { passive: true });
    addEventListener("pointerdown", e => {
      ripples.push({ x: e.clientX * RES, y: e.clientY * RES, r: 0, a: 1 });
      if (ripples.length > 4) ripples.shift();
    }, { passive: true });
    document.addEventListener("pointerleave", () => { ptr.x = ptr.y = -1e4; ptr.on = 0; });
    addEventListener("blur", () => { ptr.x = ptr.y = -1e4; ptr.on = 0; });

    let rt, lw = innerWidth;
    addEventListener("resize", () => { if (innerWidth === lw && Math.abs(innerHeight * RES - H) < 120) return; lw = innerWidth; clearTimeout(rt); rt = setTimeout(size, 150); });
    size();
    if (still) { for (let i = 0; i < 90; i++) frame(last + 16.67 * (i + 1)); }   // one settled frame
    else requestAnimationFrame(frame);
  })();

  // Light flow: each panel's node on the thread lights up while it is on screen; every
  // animation pauses while the tab is hidden.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle("lit", e.isIntersecting)), { rootMargin: "-25% 0px -25% 0px" });
    document.querySelectorAll("main .panel").forEach(p => io.observe(p));
  }
  document.addEventListener("visibilitychange", () => document.body.classList.toggle("paused", document.hidden));
})();
