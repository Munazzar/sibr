"""The gold set: ideas you grade yourself, never trained on, used to measure every Laya version.

    python -m training.gold build                  # write data/gold.csv for you to grade
    python -m training.gold score                  # stock Laya vs your grades
    python -m training.gold score --checkpoint training/checkpoints/sibr-laya --compare

build picks ideas from the teacher dataset (labels.jsonl) plus real ideas people ran
through Sibr (logs/requests.jsonl). Add your own rows too (source = you); only idea is
needed. Fill pain, value, target, growth (0, 1 or 2), comp and islamic, or leave a
cell blank to skip it. make_dataset never puts a gold idea in train or eval.

score runs Laya on every graded row and writes data/gold-report.md: per parameter,
how often Laya matches your grade, and for dataset rows how often the teacher did.
"""
import argparse
import csv
import json
import random
from pathlib import Path

from sibr_api.pipeline import COMP_Q, ISL_Q, QUESTIONS, SCORES

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
GOLD = DATA / "gold.csv"
LOGS = HERE.parent / "logs" / "requests.jsonl"
PARAMS = [*SCORES, "comp", "islamic"]
COLS = ["id", "source", "idea", *PARAMS, "notes"]
HELP = {**{k: "0, 1 or 2 = " + " / ".join(lv) for k, (_, lv) in SCORES.items()},
        "comp": ", ".join(f"{k} = {v}" for k, v in COMP_Q["criteria"].items()),
        "islamic": ", ".join(f"{k} = {v}" for k, v in ISL_Q["criteria"].items())}


def norm(idea: str) -> str:
    return " ".join(idea.lower().split())


def gold_ideas() -> set:
    """Normalised gold ideas, so training can leave them out."""
    if not GOLD.exists():
        return set()
    with open(GOLD, newline="", encoding="utf-8") as f:
        return {norm(r["idea"]) for r in csv.DictReader(f) if (r.get("idea") or "").strip()}


def log_ideas(path: Path = None) -> list:
    """Full idea texts from successful evaluations in the request log (oldest first, unique)."""
    path = path or LOGS  # looked up at call time, so tests and callers can point it elsewhere
    out, seen = [], set()
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("path") != "/evaluate" or e.get("status") != 200:
            continue
        d = e.get("detail") if isinstance(e.get("detail"), dict) else {}
        rq = d.get("request") if isinstance(d.get("request"), dict) else {}
        idea = e.get("idea") or d.get("idea") or rq.get("idea")
        if not idea:  # older entries only kept a note: "idea · extras"; a cut note ends in …
            idea = (e.get("note") or "").split(" · ")[0]
            if idea.endswith("…"):
                continue
        idea = " ".join(str(idea).split())
        if len(idea) >= 12 and norm(idea) not in seen:
            seen.add(norm(idea))
            out.append(idea)
    return out


def read_labels() -> list:
    p = DATA / "labels.jsonl"
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def build(n: int, seed: int, real_share: float = 0.5):
    if GOLD.exists():
        raise SystemExit(f"{GOLD} already exists; it may hold your grades. Move it away to rebuild.")
    real = log_ideas()[: int(n * real_share)]
    taken = {norm(i) for i in real}
    pool = [r for r in read_labels() if norm(r["idea"]) not in taken]
    sample = random.Random(seed).sample(pool, min(len(pool), n - len(real)))
    DATA.mkdir(parents=True, exist_ok=True)
    with open(GOLD, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, COLS)
        w.writeheader()
        w.writerow({"id": "help", "source": "delete this row or leave it", "idea": "what each column takes",
                    **HELP, "notes": "anything you want to remember"})
        for i, idea in enumerate(real):
            w.writerow({"id": f"r{i + 1}", "source": "real", "idea": idea})
        for i, r in enumerate(sample):
            w.writerow({"id": f"d{i + 1}", "source": "dataset", "idea": r["idea"]})
    print(f"wrote {len(real)} real + {len(sample)} dataset ideas to {GOLD}")
    if len(real) + len(sample) < n:
        print(f"  {n - len(real) - len(sample)} short of {n}: add your own ideas as rows (source = you)")


def grade(row: dict, k: str):
    v = (row.get(k) or "").strip().lower()
    if not v:
        return None
    if k in SCORES:
        return int(v) if v in ("0", "1", "2") else None
    crit = COMP_Q["criteria"] if k == "comp" else ISL_Q["criteria"]
    return v if v in crit else None


def read_gold() -> list:
    if not GOLD.exists():
        raise SystemExit("No gold set yet: run python -m training.gold build, then grade data/gold.csv.")
    rows = []
    with open(GOLD, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("id") == "help" or not (r.get("idea") or "").strip():
                continue
            g = {k: grade(r, k) for k in PARAMS}
            if any(v is not None for v in g.values()):
                rows.append({"id": r.get("id") or "", "source": r.get("source") or "", "idea": r["idea"].strip(), "gold": g})
    return rows


def answer(ans: dict, k: str):
    return int(round(float(ans["score"]))) if k in SCORES else ans["choice"]


def run_laya(laya, rows: list, cards: dict) -> list:
    qs = {k: QUESTIONS[k] for k in PARAMS}
    out = []
    for r in rows:
        card = cards.get(norm(r["idea"]), {})
        a = laya.predict({"idea": r["idea"], **{k: v for k, v in card.items() if v}}, qs).get("answers", {})
        out.append({k: answer(a[k], k) for k in PARAMS if k in a})
    return out


def table(rows: list, preds: dict) -> str:
    """preds: column name -> list of predictions aligned with rows (None where it has no answer)."""
    head = "| Parameter | Graded | " + " | ".join(preds) + " |\n|---|---|" + "---|" * len(preds) + "\n"
    lines = []
    for k in PARAMS:
        idx = [i for i, r in enumerate(rows) if r["gold"][k] is not None]
        cells = []
        for p in preds.values():
            hit = [i for i in idx if p[i] is not None and p[i].get(k) is not None]
            if not hit:
                cells.append("–")
                continue
            exact = sum(p[i][k] == rows[i]["gold"][k] for i in hit) / len(hit)
            near = (f", within one {sum(abs(p[i][k] - rows[i]['gold'][k]) <= 1 for i in hit) / len(hit):.0%}"
                    if k in SCORES else "")
            cells.append(f"{exact:.0%}{near} (n={len(hit)})")
        lines.append(f"| {k} | {len(idx)} | " + " | ".join(cells) + " |")
    return head + "\n".join(lines) + "\n"


def score(checkpoint: str, compare: bool):
    from sibr_api.config import Settings
    from sibr_api.laya_client import make_laya

    rows = read_gold()
    labels = read_labels()
    cards = {norm(r["idea"]): r.get("card", {}) for r in labels}
    teacher = {norm(r["idea"]): r["labels"] for r in labels}
    preds = {}
    if compare or not checkpoint:
        preds["Stock Laya"] = run_laya(make_laya(Settings(laya_checkpoint="")), rows, cards)
    if checkpoint:
        preds["Fine-tuned Laya"] = run_laya(make_laya(Settings(laya_checkpoint=checkpoint)), rows, cards)
    preds["Teacher LLM"] = [teacher.get(norm(r["idea"])) for r in rows]
    report = (f"# Gold set report\n\n{len(rows)} graded ideas "
              f"({sum(r['source'] == 'real' for r in rows)} real, {sum(r['source'] == 'dataset' for r in rows)} "
              f"from the dataset, {sum(r['source'] not in ('real', 'dataset') for r in rows)} your own). "
              "Each cell is how often that model matches your grade; for the 0 to 2 scores, also how often "
              "it is within one step. The teacher column covers dataset ideas only.\n\n" + table(rows, preds))
    (DATA / "gold-report.md").write_text(report, encoding="utf-8")
    print(report)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="write data/gold.csv to grade")
    b.add_argument("--n", type=int, default=150)
    b.add_argument("--seed", type=int, default=11)
    s = sub.add_parser("score", help="measure Laya against your grades")
    s.add_argument("--checkpoint", default="", help="fine-tuned checkpoint directory")
    s.add_argument("--compare", action="store_true", help="also score the stock model")
    a = ap.parse_args(argv)
    if a.cmd == "build":
        build(a.n, a.seed)
    else:
        score(a.checkpoint, a.compare)


if __name__ == "__main__":
    main()
