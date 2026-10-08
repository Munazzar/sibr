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
    ai: ["ai", "gpt", "llm", "automat", "agent"]
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

  const SEGMENTS = {
    Geography: [
      { id: "us", name: "United States", m: 1.0, aff: { b2b: .9, ai: .9, creator: .8, corporate: .8, remote: .7, faith: .5, finance: .7 } },
      { id: "uk", name: "United Kingdom", m: .85, aff: { b2b: .8, ai: .7, faith: .6, social: .6, finance: .7, events: .6 } },
      { id: "gcc", name: "Gulf (GCC)", m: .95, aff: { corporate: .9, training: .9, faith: .9, finance: .8, events: .7, b2b: .7 } },
      { id: "sa", name: "South Asia", m: .6, aff: { education: .9, video: .8, creator: .8, b2b: .6, faith: .8, training: .7 } },
      { id: "sea", name: "Malaysia & Indonesia", m: .7, aff: { faith: .95, finance: .85, video: .8, creator: .7, food: .7, b2b: .6 } },
      { id: "af", name: "Africa (NG, KE, EG)", m: .5, aff: { education: .8, finance: .8, b2b: .6, faith: .7, ai: .5 } }
    ],
    "Age group": [
      { id: "a1", name: "18–24", m: .55, aff: { video: .95, creator: .9, social: .85, education: .9, remote: .6, events: .7 } },
      { id: "a2", name: "25–34", m: .85, aff: { ai: .85, b2b: .7, remote: .85, finance: .8, family: .6, social: .6, training: .7 } },
      { id: "a3", name: "35–49", m: 1.0, aff: { b2b: .9, corporate: .85, family: .85, finance: .8, training: .7, faith: .7 } },
      { id: "a4", name: "50+", m: .8, aff: { faith: .85, family: .8, health: .8, travel: .7, finance: .6 } }
    ],
    Community: [
      { id: "dia", name: "Muslim diaspora", m: .85, aff: { faith: 1, social: .8, events: .8, family: .8, finance: .8, food: .7 } },
      { id: "rev", name: "New Muslims", m: .5, aff: { faith: 1, social: .9, education: .8, events: .7 } },
      { id: "stu", name: "University students", m: .45, aff: { education: 1, social: .8, video: .8, remote: .7, events: .7 } },
      { id: "sme", name: "SME owners", m: 1.0, aff: { b2b: 1, ai: .8, training: .7, finance: .8, video: .6 } },
      { id: "msq", name: "Masjids & nonprofits", m: .6, aff: { faith: 1, events: .9, training: .6, video: .6, finance: .6 } },
      { id: "rem", name: "Remote workers", m: .8, aff: { remote: 1, ai: .8, social: .6, training: .5 } }
    ],
    Interest: [
      { id: "cre", name: "Creators", m: .7, aff: { video: 1, creator: 1, ai: .8 } },
      { id: "pro", name: "Productivity", m: .8, aff: { training: .9, corporate: .8, ai: .8, remote: .7 } },
      { id: "fai", name: "Faith & learning", m: .65, aff: { faith: 1, education: .9, events: .6 } },
      { id: "fam", name: "Family & parenting", m: .75, aff: { family: 1, education: .7, faith: .7, health: .6 } },
      { id: "fin", name: "Halal finance", m: .85, aff: { finance: 1, faith: .8, b2b: .5 } }
    ]
  };

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

  function detectTags(text) {
    const t = " " + text.toLowerCase() + " ";
    const out = [];
    for (const [tag, words] of Object.entries(TAGS)) if (words.some(w => t.includes(w))) out.push(tag);
    return out.length ? out : ["b2b"];
  }

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

  function evaluate(idea) {
    if (!idea.islamicNotes) idea.islamicNotes = islamic(idea.name + " " + (idea.note || "")).notes;
    const base = (LEVEL[idea.pain] + LEVEL[idea.value] + LEVEL[idea.target] + LEVEL[idea.growth]) / 4;
    const isl = ISL[idea.islamic], comp = COMP[idea.comp];
    const sibr = Math.round(100 * (base * .65 + comp.v * .2 + isl.v * .15));

    const lenses = {};
    for (const [group, segs] of Object.entries(SEGMENTS)) {
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
    const all = Object.entries(lenses).flatMap(([g, s]) => s.map(x => ({ ...x, group: g })));
    const top = [...all].sort((a, b) => b.fit - a.fit).slice(0, 3);
    return { idea, sibr, isl, comp, lenses, top };
  }

  window.Sibr = { SEED, LEVEL, ISL, COMP, fromText, evaluate };
})();
