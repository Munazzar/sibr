import csv
import json

from tests.test_pipeline import FakeLaya
from training import gold, make_dataset as md


def test_gold_build_score_and_training_leaves_gold_out(tmp_path, monkeypatch):
    monkeypatch.setattr(gold, "DATA", tmp_path)
    monkeypatch.setattr(gold, "GOLD", tmp_path / "gold.csv")
    monkeypatch.setattr(md, "DATA", tmp_path)
    logs = tmp_path / "requests.jsonl"
    entries = [
        {"path": "/evaluate", "status": 200, "note": "A halal meal kit for busy nurses · open audience · Sibr 71"},
        {"path": "/evaluate", "status": 200, "note": "x" * 100 + "…"},  # cut note: skipped
        {"path": "/evaluate", "status": 401, "note": "Denied idea that never ran"},
        {"path": "/evaluate", "status": 200, "detail": {"idea": "Tutoring marketplace   for Arabic learners"}},
        {"path": "/health", "status": 200},
    ]
    logs.write_text("\n".join(json.dumps(e) for e in entries) + "\nnot json\n")
    monkeypatch.setattr(gold, "LOGS", logs)
    assert gold.log_ideas(logs) == ["A halal meal kit for busy nurses", "Tutoring marketplace for Arabic learners"]

    card, lab = md.clean({"name": "n", "pain": 2, "value": 1, "target": 0, "growth": 1, "comp": "open",
                          "islamic": "ok", "tags": [], "segments": []})
    recs = [{"idea": f"Dataset idea number {i}", "card": card, "labels": lab, "seg_ids": ["fin"]} for i in range(6)]
    (tmp_path / "labels.jsonl").write_text("\n".join(json.dumps(r) for r in recs))
    gold.build(4, seed=1)
    rows = list(csv.DictReader(open(tmp_path / "gold.csv", encoding="utf-8")))
    assert rows[0]["id"] == "help" and [r["source"] for r in rows[1:]] == ["real", "real", "dataset", "dataset"]

    # grade two rows, one partly
    rows[1].update(pain="2", comp="open", islamic="OK")
    rows[3].update(pain="1", value="1", growth="9")  # 9 is not a grade: ignored
    with open(tmp_path / "gold.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, gold.COLS)
        w.writeheader()
        w.writerows(rows)
    graded = gold.read_gold()
    assert len(graded) == 2 and graded[0]["gold"]["islamic"] == "ok" and graded[1]["gold"]["growth"] is None

    laya = FakeLaya()
    preds = gold.run_laya(laya, graded, {gold.norm(graded[1]["idea"]): {"problem": "p"}})
    assert preds[0]["pain"] == 2 and preds[0]["comp"] == "open"  # FakeLaya: score 1.8, first choice
    assert laya.calls[1][0]["problem"] == "p" and len(laya.calls[0][1]) == 6
    out = gold.table(graded, {"Stock Laya": preds})
    assert "| pain | 2 | 50%, within one 100% (n=2) |" in out and "| comp | 1 | 100% (n=1) |" in out

    # gold ideas never reach train/eval
    md.write_splits(recs, 0.2, 7)
    used = [json.loads(l)["state"]["idea"] for n in ("train", "eval") for l in (tmp_path / f"{n}.jsonl").read_text().splitlines()]
    assert len(used) == 4 and not {gold.norm(r["idea"]) for r in graded} & {gold.norm(i) for i in used}
