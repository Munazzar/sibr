"""Idea in, Sibr verdict out.

1. Idea card   LLM turns free text into problem / user / solution / revenue / delivery.
2. Verdicts    Laya answers typed questions on the card: pain, value, target, growth
               (score), competition and Islamic alignment (choice), themes and every
               lens cell (noul). One forward pass.
   Evidence    Free web search results (competitors, forums, reviews) are added to the
               state Laya reads and to the persona prompt.
3. Persona     LLM writes a one-line read per lens cell and a short verdict.

The response matches the shape `Sibr.evaluate` returns in ../engine.js, so the
existing UI renders it unchanged, plus an `evidence` list of links."""
import time
from typing import Any, Dict, List, Optional

from .evidence import Evidence, digest
from .llm import LLM
from .segments import ISLAMIC_ORDER, LEGACY_IDS, SEGMENTS, TAGS, keyword_flags

LEVEL = {"g": 1.0, "m": 0.55, "b": 0.15}
ISL = {"ok": {"label": "YES", "cls": "g", "v": 1}, "cond": {"label": "YES*", "cls": "m", "v": .7},
       "review": {"label": "REVIEW", "cls": "i", "v": .45}, "bad": {"label": "FLAG", "cls": "b", "v": 0}}
COMP = {"open": {"label": "OPEN", "cls": "g", "v": 1}, "diff": {"label": "DIFF", "cls": "m", "v": .65},
        "sat": {"label": "CROWDED", "cls": "b", "v": .25}}

SCORES = {
    "pain": ("How painful is the problem this idea solves for its customer?",
             ["no real pain", "nice to have", "painful, urgent problem"]),
    "value": ("How willing are customers to pay for this?",
              ["unlikely to pay", "might pay a little", "clearly willing to pay"]),
    "target": ("How clearly defined is the target customer?",
               ["vague or everyone", "somewhat defined", "sharply defined customer"]),
    "growth": ("How fast is the market for this growing?",
               ["shrinking or flat", "steady", "fast-growing"]),
}
COMP_Q = {"type": "choice", "instructions": "How crowded is the competition for this idea?",
          "criteria": {"open": "few or no direct competitors",
                       "diff": "competitors exist but this has a clear differentiator",
                       "sat": "crowded market with many similar products"}}
ISL_Q = {"type": "choice", "instructions": "Is this business permissible under Islamic principles?",
         "criteria": {"ok": "permissible, no concerns",
                      "cond": "permissible depending on content or advertising",
                      "review": "may involve interest, speculation or other issues needing scholarly review",
                      "bad": "involves gambling, alcohol or other clearly prohibited elements"}}

CARD_FIELDS = ["problem", "user", "solution", "revenue", "delivery"]
# The English Laya checkpoint reads about 512 tokens. A long idea is summarised by the idea
# card, so Laya gets the card plus the start of the original text.
LAYA_IDEA_CHARS = 1200


def _level(x: float) -> str:
    return "g" if x >= 2 / 3 else "m" if x >= 1 / 3 else "b"


def _conf(ans: Dict[str, Any]) -> Optional[float]:
    v = ans.get("answer_confidence", ans.get("confidence"))
    return round(float(v), 3) if v is not None else None


def build_questions() -> Dict[str, Any]:
    q: Dict[str, Any] = {k: {"type": "score", "instructions": ins, "criteria": crit}
                         for k, (ins, crit) in SCORES.items()}
    q["comp"] = COMP_Q
    q["islamic"] = ISL_Q
    for tag, desc in TAGS.items():
        q[f"tag_{tag}"] = {"type": "noul", "instructions": f"Is this idea about {desc}?"}
    for segs in SEGMENTS.values():
        for sid, _name, _m, who in segs:
            q[f"seg_{sid}"] = {"type": "noul",
                               "instructions": f"Would {who} want this and be willing to pay for it?"}
    return q


QUESTIONS = build_questions()
SEGMENT_IDS = [sid for segs in SEGMENTS.values() for sid, *_ in segs]
# Open mode without a working LLM scores this broad mix instead.
OPEN_FALLBACK = ["us", "uk", "eu", "gcc", "sa", "sea", "glob", "a1", "a2", "a3", "a4", "gm", "gf", "im", "ih",
                 "stu", "par", "prof", "sme", "stp", "ent", "ecom", "dia", "mass", "early"]


# laya-serve answers at most 64 questions per call; bigger audiences go in several calls.
MAX_PER_CALL = 64
# seg_: a catalogue segment. aud_: an audience typed by the person or suggested by the LLM.
AUDIENCE_PREFIXES = ("seg_", "aud_")
MAX_EXTRA_AUDIENCES = 12
# The persona pass writes a line for at most this many cells (best and worst fits).
PERSONA_CELLS = 20


def audience_question(who: str) -> Dict[str, Any]:
    return {"type": "noul", "instructions": f"Would {who} want this and be willing to pay for it?"}


def questions_for(segments: Optional[List[str]]) -> Dict[str, Any]:
    """The core questions plus one per audience segment picked for the run (default: the core 21)."""
    keep = set(segments or LEGACY_IDS)
    return {k: q for k, q in QUESTIONS.items() if not k.startswith("seg_") or k[4:] in keep}


def predict_batched(laya, state: Dict[str, Any], questions: Dict[str, Any]) -> Dict[str, Any]:
    """One call when the questions fit, else the core questions plus as many segments as fit,
    then the remaining segments in further calls on the same state. Answers are merged."""
    if len(questions) <= MAX_PER_CALL:
        return laya.predict(state, questions)
    core = {k: q for k, q in questions.items() if not k.startswith(AUDIENCE_PREFIXES)}
    segs = [k for k in questions if k.startswith(AUDIENCE_PREFIXES)]
    first = MAX_PER_CALL - len(core)
    chunks = [segs[:first]] + [segs[i:i + MAX_PER_CALL] for i in range(first, len(segs), MAX_PER_CALL)]
    res = laya.predict(state, {**core, **{k: questions[k] for k in chunks[0]}})
    answers = dict(res.get("answers", {}))
    for chunk in chunks[1:]:
        answers.update(laya.predict(state, {k: questions[k] for k in chunk}).get("answers", {}))
    return {**res, "answers": answers, "calls": len(chunks)}


class Pipeline:
    def __init__(self, laya, llm: LLM, min_confidence: float = 0.5, evidence: Optional[Evidence] = None):
        self.laya, self.llm, self.min_conf = laya, llm, min_confidence
        self.evidence = evidence or Evidence("off")

    # 1. Idea card
    def idea_card(self, text: str) -> Dict[str, str]:
        data = self.llm.chat_json(
            "You turn a one-line business idea into a structured idea card. Be concrete and brief "
            "(one sentence per field). Keys: name (a title of at most six words), " + ", ".join(CARD_FIELDS) + ".",
            f"Idea: {text}", max_tokens=400)
        card = {"name": text[:1].upper() + text[1:], **{f: "" for f in CARD_FIELDS}}
        if isinstance(data, dict):
            for k in ["name", *CARD_FIELDS]:
                if isinstance(data.get(k), str) and data[k].strip():
                    card[k] = data[k].strip()
        return card

    # Open mode: no audience picked, so the LLM proposes likely customers for Laya to score.
    def suggest_audiences(self, text: str, card: Dict[str, str]) -> List[Dict[str, str]]:
        data = self.llm.chat_json(
            "You are a go-to-market analyst. List the 10 most likely distinct customer audiences for this business "
            "idea, from most to least promising, across any demographic, profession, business type, place or "
            "interest. Customers do not need to share the founder's faith. Keys: audiences (list of objects with "
            "name: at most four words, and who: a plain description of the people or organisations).",
            f"Idea: {text}\nCard: {card}", max_tokens=700)
        out = []
        for a in (data or {}).get("audiences", []) if isinstance(data, dict) else []:
            if isinstance(a, dict) and isinstance(a.get("who"), str) and a["who"].strip():
                who = a["who"].strip()[:160]
                out.append({"name": str(a.get("name") or who).strip()[:40], "who": who})
        return out[:MAX_EXTRA_AUDIENCES]

    # 3. Persona pass
    def persona(self, text: str, card: Dict[str, str], cells: List[Dict[str, Any]], ev: str = "") -> Dict[str, Any]:
        if len(cells) > PERSONA_CELLS:
            ranked = sorted(cells, key=lambda c: -c["fit"])
            cells = ranked[:PERSONA_CELLS - 5] + ranked[-5:]
        listing = "\n".join(f"- {c['id']}: {c['name']} ({c['group']}), fit {round(c['fit'] * 100)}/100" for c in cells)
        data = self.llm.chat_json(
            "You are a startup analyst. For each audience segment, write one plain sentence on why the idea "
            "does or doesn't fit that segment, consistent with the given fit score. Then write a two-sentence "
            "overall verdict. Never give religious rulings. Keys: summary (string), cells (object mapping "
            "segment id to sentence).",
            f"Idea: {text}\nCard: {card}\n" + (f"Web evidence: {ev}\n" if ev else "") + f"Segments:\n{listing}",
            max_tokens=min(4000, 400 + 45 * len(cells)))
        return data if isinstance(data, dict) else {}

    def evaluate(self, text: str, segments: Optional[List[str]] = None, open_audience: bool = False,
                 custom: Optional[List[str]] = None) -> Dict[str, Any]:
        """segments: catalogue ids to score. open_audience: let the LLM suggest the audiences instead.
        custom: audiences the person typed. With none of these, the core 21 are scored."""
        text = text.strip()
        custom = [c.strip()[:160] for c in custom or [] if c and c.strip()][:MAX_EXTRA_AUDIENCES]
        segments = [s for s in SEGMENT_IDS if s in set(segments or [])]
        if not segments and not open_audience and not custom:
            segments = list(LEGACY_IDS)
        steps: List[Dict[str, Any]] = []

        def step(name: str, t0: float, ok: bool, detail: str):
            steps.append({"step": name, "ms": round((time.perf_counter() - t0) * 1000), "ok": ok, "detail": detail})

        t = time.perf_counter()
        card = self.idea_card(text)
        ok = self.llm.enabled and self.llm.last_error is None
        step("Idea card", t, ok, f"{self.llm.describe()['model']} wrote the card" if ok else
             f"LLM unavailable ({self.llm.last_error or 'off'}); used your text as is")

        # Audiences that are not in the catalogue: typed by the person, or suggested in open mode.
        extra = [{"id": f"c{i + 1}", "name": c if len(c) <= 40 else c[:38] + "…", "who": c, "group": "Your audiences"}
                 for i, c in enumerate(custom)]
        if open_audience:
            t = time.perf_counter()
            sug = self.suggest_audiences(text, card)
            if sug:
                step("Audience suggestions", t, True, f"{self.llm.describe()['model']} suggested {len(sug)} likely "
                     "customer audiences for Laya to score: " + ", ".join(x["name"] for x in sug))
            else:
                segments = segments or [s for s in OPEN_FALLBACK if s in SEGMENT_IDS]
                step("Audience suggestions", t, False, f"LLM unavailable ({self.llm.last_error or 'no usable reply'}); "
                     f"scored a broad mix of {len(segments)} catalogue segments instead")
            extra += [{"id": f"o{i + 1}", **x, "group": "Suggested by Sibr"} for i, x in enumerate(sug)]
        questions = questions_for(segments) if segments else {k: q for k, q in QUESTIONS.items() if not k.startswith("seg_")}
        for x in extra:
            questions[f"aud_{x['id']}"] = audience_question(x["who"])
        n_aud = len(segments) + len(extra)

        t = time.perf_counter()
        ev_items = self.evidence.pull(text, card)
        ev = digest(ev_items)
        step("Web evidence", t, bool(ev_items) or self.evidence.mode == "off",
             "off" if self.evidence.mode == "off" else f"{len(ev_items)} relevant results from 3 DuckDuckGo searches")

        short = text if len(text) <= LAYA_IDEA_CHARS else text[:LAYA_IDEA_CHARS] + "…"
        state = {"idea": short, **{k: v for k, v in card.items() if v}}
        if ev:
            state["evidence"] = ev
        t = time.perf_counter()
        res = predict_batched(self.laya, state, questions)  # raises LayaUnavailable
        a = res.get("answers", {})
        laya_model = (res.get("routing") or {}).get("model") or res.get("model")
        step("Laya verdicts", t, True, f"{len(questions)} typed questions ({n_aud} audiences) in "
             f"{res.get('calls', 1)} pass{'es' if res.get('calls', 1) > 1 else ''} on the {laya_model} checkpoint" +
             ("" if len(text) <= LAYA_IDEA_CHARS else f"; long idea trimmed to {LAYA_IDEA_CHARS} characters plus the card"))

        dims = {k: float(a[k]["score"]) / (len(SCORES[k][1]) - 1) for k in SCORES}
        comp_key = a["comp"]["choice"]
        laya_isl = a["islamic"]["choice"]
        kw_level, isl_notes = keyword_flags(text + " " + " ".join(card.values()))
        isl_key = max(laya_isl, kw_level, key=ISLAMIC_ORDER.index)
        if laya_isl != "ok":
            isl_notes.append(f"Laya: {ISL_Q['criteria'][laya_isl]}")
        tags = [t for t in TAGS if a[f"tag_{t}"]["noul"] >= 0.5] or \
               [max(TAGS, key=lambda t: a[f"tag_{t}"]["noul"])]

        base = sum(dims.values()) / 4
        isl, comp = ISL[isl_key], COMP[comp_key]
        sibr = round(100 * (base * .65 + comp["v"] * .2 + isl["v"] * .15))

        lenses: Dict[str, List[Dict[str, Any]]] = {}
        for group, segs in SEGMENTS.items():
            lenses[group] = []
            for sid, name, m, who in segs:
                if sid not in segments:
                    continue
                ans = a[f"seg_{sid}"]
                conf = _conf(ans)
                lenses[group].append({"id": sid, "name": name, "m": m, "fit": float(ans["noul"]),
                                      "confidence": conf, "escalate": conf is not None and conf < self.min_conf,
                                      "why": self._why(float(ans["noul"]), m, comp_key)})
        for x in extra:
            ans = a[f"aud_{x['id']}"]
            conf = _conf(ans)
            lenses.setdefault(x["group"], []).append({
                "id": x["id"], "name": x["name"], "who": x["who"], "m": .75, "fit": float(ans["noul"]),
                "confidence": conf, "escalate": conf is not None and conf < self.min_conf, "custom": True,
                "why": self._why(float(ans["noul"]), .75, comp_key)})
        lenses = {g: cs for g, cs in lenses.items() if cs}
        cells = [{**c, "group": g} for g, cs in lenses.items() for c in cs]

        t = time.perf_counter()
        p = self.persona(text, card, cells, ev)
        ok = bool(p) and self.llm.last_error is None
        step("Persona pass", t, ok, f"{self.llm.describe()['model']} wrote a line per segment and the verdict" if ok
             else f"skipped ({self.llm.last_error or 'LLM off or unreadable reply'}); template reasons shown")
        lines = p.get("cells") if isinstance(p.get("cells"), dict) else {}
        for c in [c for cs in lenses.values() for c in cs]:
            if isinstance(lines.get(c["id"]), str):
                c["analysis"] = lines[c["id"]]

        top = sorted(({**c, "group": g} for g, cs in lenses.items() for c in cs), key=lambda c: -c["fit"])[:3]
        idea = {"name": card["name"], "note": card.get("solution") or "Custom idea · " + ", ".join(tags),
                **{k: _level(v) for k, v in dims.items()}, "islamic": isl_key, "comp": comp_key,
                "islamicNotes": isl_notes, "tags": tags, "card": card, "custom": True,
                "summary": p.get("summary") if isinstance(p.get("summary"), str) else None}
        verdicts = {k: {"value": round(v, 3), "score": a[k]["score"], "levels": SCORES[k][1],
                        "probabilities": a[k].get("probabilities"), "confidence": _conf(a[k])} for k, v in dims.items()}
        verdicts["comp"] = {"value": comp_key, "labels": COMP_Q["criteria"],
                            "probabilities": a["comp"].get("probabilities"), "confidence": _conf(a["comp"])}
        verdicts["islamic"] = {"value": laya_isl, "labels": ISL_Q["criteria"], "keyword": kw_level,
                               "probabilities": a["islamic"].get("probabilities"), "confidence": _conf(a["islamic"])}
        return {"idea": idea, "sibr": sibr, "isl": isl, "comp": comp, "lenses": lenses, "top": top,
                "verdicts": verdicts, "evidence": ev_items,
                "meta": {"engine": "laya", "laya_model": laya_model, "steps": steps, "segments": segments,
                         "audience": {"open": open_audience, "custom": len(custom), "suggested": sum(x["group"] == "Suggested by Sibr" for x in extra)},
                         "llm": self.llm.describe(), "llm_used": any(s["ok"] for s in steps if s["step"] in ("Idea card", "Persona pass")),
                         "llm_error": self.llm.last_error}}

    @staticmethod
    def _why(fit: float, m: float, comp_key: str) -> List[str]:
        why = [f"Laya puts the chance this segment wants and pays for it at {round(fit * 100)}%"]
        if m >= .9:
            why.append("High willingness and ability to pay")
        elif m <= .55:
            why.append("Lower spending power — price and model must fit")
        if comp_key == "sat":
            why.append("Crowded space: needs a sharp wedge here")
        return why
