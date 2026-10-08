"""Lens definitions. segments.json is the one source for audience segments and presets; the
site reads the same data from ../segments.js, which `python -m sibr_api.segments` regenerates.
TAGS / FLAGS mirror ../engine.js so the browser fallback and the model service agree."""
import json
import re
from pathlib import Path

_DATA = json.loads((Path(__file__).with_name("segments.json")).read_text(encoding="utf-8"))

# group -> [(id, name, market multiplier (spending power), description Laya reads)]
SEGMENTS = {g["name"]: [(x["id"], x["name"], x["m"], x["who"]) for x in g["segments"]] for g in _DATA["groups"]}
PRESETS = _DATA["presets"]
# The original 21 segments. The first teacher dataset was labelled on these only.
LEGACY_IDS = next(p["ids"] for p in PRESETS if p["id"] == "core")

TAGS = {
    "video": "video, editing, short-form clips or podcasts",
    "creator": "creators, influencers or personal brands",
    "b2b": "selling to businesses",
    "corporate": "corporate teams, employees or HR",
    "training": "courses, workshops, coaching or training",
    "social": "social connection, networking or community",
    "events": "events, meetups or gatherings",
    "remote": "remote work, cafés or coworking",
    "finance": "money, investing, payments, zakat or budgeting",
    "faith": "Islam, Qur'an, prayer, mosques or halal living",
    "family": "family, parenting, marriage or the home",
    "education": "students, schools or learning",
    "health": "health, fitness or wellness",
    "food": "food, restaurants or groceries",
    "travel": "travel, tours, Hajj or Umrah",
    "ai": "AI, LLMs or automation",
}

# Islamic-alignment flags. Output is a review flag, never a ruling.
FLAGS = [
    (r"\b(interest|riba|loan|lend|credit|bnpl|buy now pay later|mortgage)\b", "review", "Possible riba exposure in financing or payments"),
    (r"\b(gambl\w*|bet|bets|betting|casino|lottery|sweepstakes?)\b", "bad", "Gambling / maysir mechanics"),
    (r"\b(alcohol|wine|beer|bar|pub|pork)\b", "bad", "Haram product category"),
    (r"\b(crypto\w*|forex|options|day trad\w*|derivatives?)\b", "review", "Speculative instrument — gharar review"),
    (r"\b(dating|hookup)\b", "review", "Gender-interaction model needs review"),
    (r"\b(insurance)\b", "review", "Conventional insurance — consider takaful"),
    (r"\b(music|ads|advert|video|content|influencer)\b", "cond", "Depends on content and ad sources"),
]

ISLAMIC_ORDER = ["ok", "cond", "review", "bad"]  # least to most severe


def keyword_flags(text: str):
    hits = [(lvl, note) for rx, lvl, note in FLAGS if re.search(rx, text, re.I)]
    worst = max((lvl for lvl, _ in hits), key=ISLAMIC_ORDER.index, default="ok")
    return worst, [note for _, note in hits]


def site_js() -> str:
    return ("// Generated from server/sibr_api/segments.json by `python -m sibr_api.segments`. Edit that file.\n"
            "window.SIBR_SEGMENTS = " + json.dumps(_DATA, ensure_ascii=False, separators=(",", ":")) + ";\n")


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[2] / "segments.js"
    out.write_text(site_js(), encoding="utf-8")
    print("wrote", out)
