"""Build a Laya fine-tuning set for Sibr with a local LLM as the teacher.

    python -m training.make_dataset --n 1000            # generate + label (resumable)
    python -m training.make_dataset --from-review       # rebuild JSONL after editing review.csv

Writes to training/data/:
  labels.jsonl  one row per idea: idea, card and the teacher's labels (resume log)
  review.csv    the same labels as a spreadsheet. Edit any cell you disagree with,
                set keep=0 to drop a row, then run --from-review.
  train.jsonl / eval.jsonl   laya-train rows: {state, questions, expected}

The teacher is whatever SIBR_LLM_* points at (Ollama by default). Its labels are a
starting point, not ground truth: the "verdicts you agree with" step is review.csv.
"""
import argparse
import csv
import json
import random
from pathlib import Path

from sibr_api.config import Settings
from sibr_api.llm import LLM
from sibr_api.pipeline import CARD_FIELDS, COMP_Q, ISL_Q, QUESTIONS, SCORES
from sibr_api.segments import LEGACY_IDS, SEGMENTS, TAGS

DATA = Path(__file__).resolve().parent / "data"
SEG_IDS = {sid: (name, who) for segs in SEGMENTS.values() for sid, name, _m, who in segs}
MODELS = ["subscription app", "marketplace", "B2B service", "physical product", "course or community",
          "agency", "SaaS tool", "nonprofit-style program"]

# Segments the teacher grades per idea. A sample keeps the prompt short for small local LLMs
# and keeps each training row under laya-serve's 64-question limit (22 core + 30 segments).
SEGS_PER_IDEA = 30


def label_prompt(seg_ids) -> str:
    return LABEL_PROMPT.replace("{segments}", ", ".join(f"{sid} = {SEG_IDS[sid][1]}" for sid in seg_ids))


LABEL_PROMPT = (
    "You are a strict startup analyst. Given a business idea, write its idea card and grade it. "
    "Return JSON with keys: name (max six words), " + ", ".join(CARD_FIELDS) + " (one sentence each); "
    "pain, value, target, growth (each 0, 1 or 2: " +
    "; ".join(f"{k}: {' / '.join(lv)}" for k, (_, lv) in SCORES.items()) + "); "
    "comp (one of " + ", ".join(f"{k} = {v}" for k, v in COMP_Q["criteria"].items()) + "); "
    "islamic (one of " + ", ".join(f"{k} = {v}" for k, v in ISL_Q["criteria"].items()) + "); "
    "tags (list, any of: " + ", ".join(TAGS) + "); "
    "segments (list of the segment ids that would want this and pay for it, any of: {segments}). "
    "Be critical: most ideas are not strong on every dimension.")


def gen_ideas(llm: LLM, n: int, have: set, rng: random.Random):
    out, misses = [], 0
    while len(out) < n and misses < 20:
        tag, sid, model = rng.choice(list(TAGS)), rng.choice(list(SEG_IDS)), rng.choice(MODELS)
        data = llm.chat_json(
            "You brainstorm realistic early-stage business ideas, good and bad. Key: ideas (list of strings, "
            "each a one-line idea under 15 words).",
            f"Give 8 varied ideas: a {model} about {TAGS[tag]}, aimed at {SEG_IDS[sid][1]}. "
            f"Include some weak or flawed ideas.", max_tokens=500)
        ideas = [i.strip() for i in (data or {}).get("ideas", []) if isinstance(i, str) and len(i.strip()) > 8]
        fresh = [i for i in ideas if i.lower() not in have]
        misses = misses + 1 if not fresh else 0
        for i in fresh:
            have.add(i.lower())
            out.append(i)
    return out[:n]


def clean(raw: dict):
    """Validate a teacher reply; None when it is unusable."""
    try:
        lab = {k: int(raw[k]) for k in SCORES}
        assert all(0 <= v <= 2 for v in lab.values())
        assert raw["comp"] in COMP_Q["criteria"] and raw["islamic"] in ISL_Q["criteria"]
    except (KeyError, ValueError, TypeError, AssertionError):
        return None
    card = {k: str(raw.get(k, "")).strip() for k in ["name", *CARD_FIELDS]}
    lab.update(comp=raw["comp"], islamic=raw["islamic"],
               tags=sorted(t for t in raw.get("tags", []) if t in TAGS),
               segments=sorted(s for s in raw.get("segments", []) if s in SEG_IDS))
    return card, lab


def to_row(idea: str, card: dict, lab: dict, seg_ids=None) -> dict:
    """Only the segments the teacher was asked about become questions: a segment it never saw
    is unknown, not a "no". Records from before the audience expansion used the core 21."""
    seg_ids = [s for s in (seg_ids or LEGACY_IDS) if s in SEG_IDS]
    expected = {k: lab[k] for k in SCORES}
    expected.update(comp=lab["comp"], islamic=lab["islamic"])
    expected.update({f"tag_{t}": t in lab["tags"] for t in TAGS})
    expected.update({f"seg_{s}": s in lab["segments"] for s in seg_ids})
    state = {"idea": idea, **{k: v for k, v in card.items() if v}}
    return {"state": state, "questions": {k: QUESTIONS[k] for k in expected}, "expected": expected}


def write_splits(records, eval_frac: float, seed: int):
    rows = [to_row(r["idea"], r["card"], r["labels"], r.get("seg_ids")) for r in records]
    random.Random(seed).shuffle(rows)
    k = max(1, int(len(rows) * eval_frac))
    for name, part in (("eval", rows[:k]), ("train", rows[k:])):
        with open(DATA / f"{name}.jsonl", "w", encoding="utf-8") as f:
            f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in part)
    print(f"wrote {len(rows) - k} train / {k} eval rows to {DATA}")


# seg_ids: the segments the teacher was asked about; "segments" lists the ones it said yes to.
CSV_COLS = ["keep", "idea", "name", *CARD_FIELDS, *SCORES, "comp", "islamic", "tags", "segments", "seg_ids"]


def write_review(records):
    with open(DATA / "review.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, CSV_COLS)
        w.writeheader()
        for r in records:
            w.writerow({"keep": 1, "idea": r["idea"], **r["card"], **{k: r["labels"][k] for k in [*SCORES, "comp", "islamic"]},
                        "tags": " ".join(r["labels"]["tags"]), "segments": " ".join(r["labels"]["segments"]),
                        "seg_ids": " ".join(r.get("seg_ids") or LEGACY_IDS)})


def read_review():
    out = []
    with open(DATA / "review.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if str(row.get("keep", "1")).strip() in ("0", "", "no", "n"):
                continue
            parsed = clean({**row, "tags": row["tags"].split(), "segments": row["segments"].split()})
            if parsed is None:
                print("skipping invalid row:", row["idea"])
                continue
            out.append({"idea": row["idea"], "card": parsed[0], "labels": parsed[1],
                        "seg_ids": (row.get("seg_ids") or "").split() or list(LEGACY_IDS)})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=1000, help="target number of labelled ideas")
    ap.add_argument("--eval-frac", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--from-review", action="store_true", help="rebuild train/eval from an edited review.csv")
    a = ap.parse_args(argv)
    DATA.mkdir(parents=True, exist_ok=True)

    if a.from_review:
        records = read_review()
        write_splits(records, a.eval_frac, a.seed)
        return

    llm = LLM(Settings())
    if not llm.enabled:
        raise SystemExit("Set SIBR_LLM_PROVIDER to a working LLM (Ollama by default).")
    log = DATA / "labels.jsonl"
    records = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines() if l.strip()] if log.exists() else []
    have = {r["idea"].lower() for r in records}
    rng = random.Random(a.seed + len(records))
    print(f"{len(records)} already labelled, target {a.n}, teacher {llm.describe()}")
    with open(log, "a", encoding="utf-8") as f:
        while len(records) < a.n:
            batch = gen_ideas(llm, min(8, a.n - len(records)), have, rng)
            if not batch:
                raise SystemExit(f"LLM stopped returning ideas ({llm.last_error or 'empty replies'}).")
            for idea in batch:
                seg_ids = sorted(rng.sample(list(SEG_IDS), min(SEGS_PER_IDEA, len(SEG_IDS))))
                parsed = clean(llm.chat_json(label_prompt(seg_ids), f"Idea: {idea}", max_tokens=600) or {})
                if parsed is None:
                    continue
                parsed[1]["segments"] = [s for s in parsed[1]["segments"] if s in seg_ids]
                rec = {"idea": idea, "card": parsed[0], "labels": parsed[1], "seg_ids": seg_ids}
                records.append(rec)
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                f.flush()
                if len(records) % 25 == 0:
                    print(f"  {len(records)}/{a.n}")
    write_review(records)
    write_splits(records, a.eval_frac, a.seed)


if __name__ == "__main__":
    main()
