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
from typing import Any, Dict, List, Optional

from .evidence import Evidence, digest
from .llm import LLM
from .segments import ISLAMIC_ORDER, SEGMENTS, TAGS, keyword_flags

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

    # 3. Persona pass
    def persona(self, text: str, card: Dict[str, str], cells: List[Dict[str, Any]], ev: str = "") -> Dict[str, Any]:
        listing = "\n".join(f"- {c['id']}: {c['name']} ({c['group']}), fit {round(c['fit'] * 100)}/100" for c in cells)
        data = self.llm.chat_json(
            "You are a startup analyst. For each audience segment, write one plain sentence on why the idea "
            "does or doesn't fit that segment, consistent with the given fit score. Then write a two-sentence "
            "overall verdict. Never give religious rulings. Keys: summary (string), cells (object mapping "
            "segment id to sentence).",
            f"Idea: {text}\nCard: {card}\n" + (f"Web evidence: {ev}\n" if ev else "") + f"Segments:\n{listing}",
            max_tokens=1200)
        return data if isinstance(data, dict) else {}

    def evaluate(self, text: str) -> Dict[str, Any]:
        text = text.strip()
        card = self.idea_card(text)
        state = {"idea": text, **{k: v for k, v in card.items() if v}}
        ev_items = self.evidence.pull(text, card)
        ev = digest(ev_items)
        if ev:
            state["evidence"] = ev
        res = self.laya.predict(state, QUESTIONS)  # raises LayaUnavailable
        a = res.get("answers", {})

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
                ans = a[f"seg_{sid}"]
                conf = _conf(ans)
                lenses[group].append({"id": sid, "name": name, "m": m, "fit": float(ans["noul"]),
                                      "confidence": conf, "escalate": conf is not None and conf < self.min_conf,
                                      "why": self._why(float(ans["noul"]), m, comp_key)})
        cells = [{**c, "group": g} for g, cs in lenses.items() for c in cs]

        p = self.persona(text, card, cells, ev)
        lines = p.get("cells") if isinstance(p.get("cells"), dict) else {}
        for c in [c for cs in lenses.values() for c in cs]:
            if isinstance(lines.get(c["id"]), str):
                c["analysis"] = lines[c["id"]]

        top = sorted(({**c, "group": g} for g, cs in lenses.items() for c in cs), key=lambda c: -c["fit"])[:3]
        idea = {"name": card["name"], "note": card.get("solution") or "Custom idea · " + ", ".join(tags),
                **{k: _level(v) for k, v in dims.items()}, "islamic": isl_key, "comp": comp_key,
                "islamicNotes": isl_notes, "tags": tags, "card": card, "custom": True,
                "summary": p.get("summary") if isinstance(p.get("summary"), str) else None}
        verdicts = {k: {"value": round(v, 3), "confidence": _conf(a[k])} for k, v in dims.items()}
        verdicts["comp"] = {"value": comp_key, "confidence": _conf(a["comp"])}
        verdicts["islamic"] = {"value": laya_isl, "confidence": _conf(a["islamic"])}
        return {"idea": idea, "sibr": sibr, "isl": isl, "comp": comp, "lenses": lenses, "top": top,
                "verdicts": verdicts, "evidence": ev_items,
                "meta": {"engine": "laya", "laya_model": (res.get("routing") or {}).get("model") or res.get("model"),
                         "llm": self.llm.describe(), "llm_used": self.llm.last_error is None and self.llm.enabled,
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
