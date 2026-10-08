/* Sibr heuristic lens engine.
 * Deterministic, in-browser placeholder for the planned LLM + Laya pipeline.
 * Swap `Sibr.evaluate` for an API call when the model service exists. */
(function () {
  const LEVEL = { g: 1, m: 0.55, b: 0.15 };

  const TAGS = {
    video: ["video", "edit", "youtube", "reel", "tiktok", "content", "clip", "podcast"],
    creator: ["creator", "influencer", "youtube", "content", "brand"],
    b2b: ["sme", "smb", "business", "company", "b2b", "client", "consult", "agency", "saas"],
    corporate: ["corporate", "enterprise", "workshop", "employee", "team", "hr"],
    training: ["workshop", "course", "training", "coach", "learn", "teach", "tutor", "bootcamp"],
    social: ["social", "meetup", "connect", "network", "friend", "community", "group"],
    events: ["event", "meetup", "gathering", "conference", "iftar"],
    remote: ["laptop", "cafe", "cowork", "remote", "wifi", "nomad"],
    finance: ["halal invest", "invest", "finance", "money", "budget", "saving", "zakat", "sadaqah", "payment", "wallet"],
    faith: ["quran", "qur'an", "islam", "muslim", "masjid", "mosque", "halal", "sunnah", "dua", "salah", "prayer", "ramadan", "hajj", "umrah"],
    family: ["family", "parent", "kid", "child", "marriage", "nikah", "home"],
    education: ["student", "school", "university", "study", "exam", "education", "arabic"],
    health: ["fitness", "health", "diet", "sleep", "wellness"],
    food: ["food", "restaurant", "recipe", "halal food", "cafe", "grocery"],
    travel: ["travel", "trip", "tour", "hajj", "umrah"],
    ai: ["ai", "gpt", "llm", "automat", "agent"],
    // Browser-only themes for the newer interest segments.
    fashion: ["fashion", "modest", "hijab", "abaya", "clothing", "apparel", "wear"],
    gaming: ["game", "gaming", "esport", "gamer"],
    sports: ["sport", "football", "soccer", "gym", "martial", "cricket", "basketball"],
    charity: ["charity", "zakat", "sadaqah", "donat", "waqf", "fundrais"],
    marriage: ["marriage", "nikah", "wedding", "spouse", "matrimon"],
    beauty: ["beauty", "skincare", "skin care", "cosmetic", "makeup", "salon", "barber", "groom"],
    pets: ["pet", "dog", "cat", "vet"],
    home: ["home", "house", "furniture", "decor", "diy", "cleaning", "interior"],
    auto: ["car", "vehicle", "auto", "motor", "garage", "mechanic"],
    media: ["music", "film", "movie", "book", "podcast", "stream"],
    outdoor: ["outdoor", "hike", "hiking", "camp", "adventure"],
    legal: ["legal", "law", "lawyer", "contract", "compliance", "account", "tax"],
    realestate: ["real estate", "property", "rent", "landlord", "tenant", "mortgage"],
    logistics: ["logistic", "delivery", "shipping", "courier", "fleet", "truck", "warehouse"],
    construction: ["construction", "builder", "contractor", "plumb", "electric", "renovat"],
    retail: ["shop", "store", "retail", "boutique"],
    ecommerce: ["ecommerce", "e-commerce", "online store", "shopify", "amazon", "marketplace", "dropship"],
    kids: ["kid", "child", "baby", "toddler", "toy"],
    seniors: ["senior", "elderly", "retire", "aged care", "grandparent"],
    green: ["eco", "green", "sustainab", "recycl", "solar", "climate", "carbon"],
    privacy: ["privacy", "private", "encrypt", "data protection"],
    security: ["security", "cyber", "safety", "cctv"],
    language: ["language", "arabic", "english", "translat", "spanish"],
    mental: ["mental", "therapy", "anxiety", "stress", "mindful", "wellbeing"],
    hospitality: ["hotel", "hospitality", "restaurant", "cafe", "bar staff", "catering"],
    agriculture: ["farm", "agri", "crop", "livestock"],
    luxury: ["luxury", "premium", "high-end", "bespoke"],
    fitness: ["fitness", "gym", "workout", "yoga", "sport"]
  };

  // Islamic-alignment flags. Output is a review flag, never a ruling.
  const FLAGS = [
    { re: /\b(interest|riba|loan|lend|credit|bnpl|buy now pay later|mortgage)\b/i, level: "review", note: "Possible riba exposure in financing or payments" },
    { re: /\b(gambl\w*|bet|bets|betting|casino|lottery|sweepstakes?)\b/i, level: "bad", note: "Gambling / maysir mechanics" },
    { re: /\b(alcohol|wine|beer|bar|pub|pork)\b/i, level: "bad", note: "Haram product category" },
    { re: /\b(crypto\w*|forex|options|day trad\w*|derivatives?)\b/i, level: "review", note: "Speculative instrument — gharar review" },
    { re: /\b(dating|hookup)\b/i, level: "review", note: "Gender-interaction model needs review" },
    { re: /\b(insurance)\b/i, level: "review", note: "Conventional insurance — consider takaful" },
    { re: /\b(music|ads|advert|video|content|influencer)\b/i, level: "cond", note: "Depends on content and ad sources" }
  ];

  // Audience segments and presets live in segments.js (generated from server/sibr_api/segments.json).
  const SEGMENTS = Object.fromEntries(window.SIBR_SEGMENTS.groups.map(g => [g.name, g.segments]));
  const PRESETS = window.SIBR_SEGMENTS.presets;

  const SEED = [
    { name: "AI Video Editing", note: "Auto-edit and caption short-form video", pain: "g", value: "m", target: "g", growth: "g", islamic: "cond", comp: "sat", tags: ["video", "creator", "ai"] },
    { name: "Consulting Packages for SMEs", note: "Fixed-scope digital & AI packages", pain: "g", value: "g", target: "g", growth: "g", islamic: "ok", comp: "diff", tags: ["b2b", "ai", "training"] },
    { name: "Corporate Productivity Workshop", note: "On-site sessions for teams", pain: "g", value: "g", target: "m", growth: "g", islamic: "ok", comp: "diff", tags: ["corporate", "training"] },
    { name: "Meetup.com but better", note: "Local group & event discovery", pain: "g", value: "m", target: "b", growth: "g", islamic: "ok", comp: "sat", tags: ["social", "events"] },
    { name: "App: Keep in Touch With Friends", note: "Reminders to reach out", pain: "m", value: "b", target: "b", growth: "g", islamic: "ok", comp: "sat", tags: ["social", "family"] },
    { name: "App: Laptop Cafés", note: "Find work-friendly cafés", pain: "b", value: "m", target: "b", growth: "g", islamic: "ok", comp: "sat", tags: ["remote", "food"] }
  ];

  const ISL = { ok: { label: "YES", cls: "g", v: 1 }, cond: { label: "YES*", cls: "m", v: .7 }, review: { label: "REVIEW", cls: "i", v: .45 }, bad: { label: "FLAG", cls: "b", v: 0 } };
  const COMP = { open: { label: "OPEN", cls: "g", v: 1 }, diff: { label: "DIFF", cls: "m", v: .65 }, sat: { label: "CROWDED", cls: "b", v: .25 } };

  function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

  function themes(text) {
    const t = " " + text.toLowerCase() + " ";
    return Object.entries(TAGS).filter(([, words]) => words.some(w => t.includes(w))).map(([tag]) => tag);
  }
  function detectTags(text) { const out = themes(text); return out.length ? out : ["b2b"]; }

  function islamic(text) {
    const hits = FLAGS.filter(f => f.re.test(text));
    const order = ["bad", "review", "cond"];
    const worst = order.find(l => hits.some(h => h.level === l)) || "ok";
    return { level: worst, notes: hits.map(h => h.note) };
  }

  function fromText(text) {
    const tags = detectTags(text);
    const crowded = ["social", "video", "remote", "food"].filter(t => tags.includes(t)).length;
    const niche = tags.includes("faith") || tags.includes("finance");
    const r = hash(text);
    const isl = islamic(text);
    const title = text.length > 90 ? text.slice(0, 88).replace(/\s+\S*$/, "") + "…" : text;
    const has = t => tags.includes(t);
    const reasons = {
      pain: has("b2b") || has("finance") ? "Business and money problems usually come with a real, paid pain." : "No strong pain words found; rated by a default rule.",
      value: has("b2b") || niche ? "Businesses and faith or finance niches tend to pay for solutions." : "Consumer idea without a clear paying niche, so value is rated mixed.",
      target: `${tags.length} theme${tags.length === 1 ? "" : "s"} detected (${tags.join(", ")}). Fewer themes means a sharper target.`,
      growth: has("ai") || niche ? "AI and faith-based or halal finance markets are growing fast." : "No fast-growth theme detected; rated by a default rule.",
      islamic: isl.notes.length ? "Keyword flags: " + isl.notes.join("; ") + "." : "No riba, gambling, haram-category or speculation keywords found.",
      comp: crowded >= 1 && !niche ? "Themes like social, video, remote work or food are crowded markets." : niche ? "Faith and halal finance niches have fewer direct competitors." : "Competitors likely exist; a clear differentiator is assumed."
    };
    return {
      name: title.charAt(0).toUpperCase() + title.slice(1),
      text, reasons,
      note: "Custom idea · " + tags.join(", "),
      pain: tags.includes("b2b") || tags.includes("finance") ? "g" : r > .5 ? "m" : "g",
      value: tags.includes("b2b") || niche ? "g" : "m",
      target: tags.length <= 3 ? "g" : tags.length <= 5 ? "m" : "b",
      growth: tags.includes("ai") || niche || r > .3 ? "g" : "m",
      islamic: isl.level, islamicNotes: isl.notes,
      comp: crowded >= 1 && !niche ? "sat" : niche ? "open" : "diff",
      tags, custom: true
    };
  }

  // `only`: segment ids to score (the audience picked before the run).
  // opts.open: no audience picked; score the whole catalogue and keep the best matches.
  // opts.custom: audiences the person typed, scored by theme overlap with the idea.
  function evaluate(idea, only, opts = {}) {
    const keep = !opts.open && only && only.length ? new Set(only) : null;
    if (!idea.islamicNotes) idea.islamicNotes = islamic(idea.name + " " + (idea.note || "")).notes;
    const base = (LEVEL[idea.pain] + LEVEL[idea.value] + LEVEL[idea.target] + LEVEL[idea.growth]) / 4;
    const isl = ISL[idea.islamic], comp = COMP[idea.comp];
    const sibr = Math.round(100 * (base * .65 + comp.v * .2 + isl.v * .15));

    const lenses = {};
    for (const [group, all] of Object.entries(SEGMENTS)) {
      const segs = keep ? all.filter(s => keep.has(s.id)) : all;
      if (!segs.length) continue;
      lenses[group] = segs.map(seg => {
        const matches = idea.tags.map(t => [t, seg.aff[t] || 0]).sort((a, b) => b[1] - a[1]);
        const aff = matches.length ? (matches[0][1] * .7 + matches.slice(1).reduce((s, m) => s + m[1], 0) / Math.max(1, matches.length - 1) * .3) : 0;
        const jitter = (hash(idea.name + seg.id) - .5) * .08;
        const fit = Math.max(.03, Math.min(.98, base * .35 + aff * .45 + seg.m * comp.v * .2 + jitter));
        const why = [];
        matches.filter(m => m[1] >= .7).forEach(m => why.push(`Strong pull on “${m[0]}” in this segment`));
        if (!why.length) why.push("Weak overlap between the idea's themes and this segment's needs");
        if (seg.m >= .9) why.push("High willingness and ability to pay");
        else if (seg.m <= .55) why.push("Lower spending power — price and model must fit");
        if (idea.comp === "sat") why.push("Crowded space: needs a sharp wedge here");
        if (idea.tags.includes("faith") && group === "Community" && seg.aff.faith) why.push("Faith-first positioning is a genuine differentiator");
        return { ...seg, fit, why };
      });
    }
    if (opts.open) {
      const best = Object.entries(lenses).flatMap(([g, s]) => s.map(x => ({ ...x, from: g }))).sort((a, b) => b.fit - a.fit).slice(0, 15);
      for (const g of Object.keys(lenses)) delete lenses[g];
      lenses["Best matches"] = best;
    }
    if (opts.custom && opts.custom.length) {
      lenses["Your audiences"] = opts.custom.map((c, i) => {
        const theirs = themes(c), shared = idea.tags.filter(t => theirs.includes(t));
        const aff = shared.length ? .85 : .25;
        const fit = Math.max(.03, Math.min(.98, base * .35 + aff * .45 + .75 * comp.v * .2 + (hash(idea.name + c) - .5) * .08));
        return { id: "c" + (i + 1), name: c.length > 40 ? c.slice(0, 38) + "…" : c, who: c, m: .75, fit, custom: true,
                 why: [shared.length ? `Shares the idea's themes: ${shared.join(", ")}` : "No shared themes found between the idea and this audience"] };
      });
    }
    const all = Object.entries(lenses).flatMap(([g, s]) => s.map(x => ({ ...x, group: g })));
    const top = [...all].sort((a, b) => b.fit - a.fit).slice(0, 3);
    return { idea, sibr, isl, comp, lenses, top };
  }

  window.Sibr = { SEED, SEGMENTS, PRESETS, LEVEL, ISL, COMP, fromText, evaluate };
})();
