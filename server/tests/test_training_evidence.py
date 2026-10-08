import json

import httpx

from sibr_api.evidence import Evidence, digest
from sibr_api.pipeline import QUESTIONS, Pipeline
from tests.test_pipeline import FakeLaya, good_llm, llm_with
from training import make_dataset as md

RAW = {"name": "Halal Invest", "problem": "p", "user": "u", "solution": "s", "revenue": "r", "delivery": "d",
       "pain": 2, "value": "1", "target": 0, "growth": 2, "comp": "diff", "islamic": "review",
       "tags": ["finance", "nope"], "segments": ["fin", "dia", "zz"]}


class FakeEvidence(Evidence):
    def __init__(self):
        super().__init__("ddg")

    def search(self, query):
        return [{"title": "Rival halal investing", "url": "https://rival.example", "snippet": "A competitor " + query},
                {"title": "HAL Investments", "url": "https://hal.example", "snippet": "Oilfield services"}]


def test_clean_and_row_match_questions():
    card, lab = md.clean(RAW)
    assert lab["value"] == 1 and lab["tags"] == ["finance"] and lab["segments"] == ["dia", "fin"]
    row = md.to_row("halal investing", card, lab)
    # an old record: the core 21 segments only, so new segments are not labelled "no"
    assert set(row["expected"]) == set(row["questions"])
    assert sum(k.startswith("seg_") for k in row["expected"]) == 21 and "seg_mod" not in row["expected"]
    assert row["expected"]["seg_fin"] is True and row["expected"]["seg_us"] is False
    assert row["state"]["solution"] == "s"
    row = md.to_row("halal investing", card, lab, ["fin", "mod"])
    assert [k for k in row["expected"] if k.startswith("seg_")] == ["seg_fin", "seg_mod"]
    assert len(row["questions"]) <= 64
    assert all(k in QUESTIONS for k in row["questions"])


def test_clean_rejects_bad_labels():
    assert md.clean({**RAW, "pain": 5}) is None
    assert md.clean({**RAW, "comp": "meh"}) is None


def test_review_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(md, "DATA", tmp_path)
    card, lab = md.clean(RAW)
    md.write_review([{"idea": "halal investing", "card": card, "labels": lab}])
    text = (tmp_path / "review.csv").read_text().replace(",review,", ",ok,")
    (tmp_path / "review.csv").write_text(text)
    recs = md.read_review()
    assert recs[0]["labels"]["islamic"] == "ok"
    assert len(recs[0]["seg_ids"]) == 21
    md.write_splits(recs * 3, .34, 1)
    rows = [json.loads(l) for l in (tmp_path / "train.jsonl").read_text().splitlines()]
    assert len(rows) == 2 and rows[0]["expected"]["islamic"] == "ok"


def test_evidence_feeds_laya_and_response():
    laya = FakeLaya()
    r = Pipeline(laya, llm_with(good_llm), evidence=FakeEvidence()).evaluate("halal investing app")
    # the unrelated "HAL Investments" hit is filtered out
    assert [e["url"] for e in r["evidence"]] == ["https://rival.example"]
    assert "Rival" in laya.calls[0][0]["evidence"]


def test_evidence_failure_is_silent():
    class Broken(Evidence):
        def search(self, q):
            raise RuntimeError("rate limited")
    assert Broken("ddg").pull("x idea", {"name": "x"}) == []
    assert Evidence("off").pull("x idea", {"name": "x"}) == []
    assert digest([]) == ""
