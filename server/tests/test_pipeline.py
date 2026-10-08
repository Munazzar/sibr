import json

import httpx
from fastapi.testclient import TestClient

from sibr_api.app import create_app
from sibr_api.config import Settings
from sibr_api.laya_client import HttpLaya, LayaUnavailable
from sibr_api.llm import LLM, parse_json
from sibr_api.pipeline import QUESTIONS, Pipeline


class FakeLaya:
    """Answers every question the way laya.Router.predict shapes its payload."""
    def __init__(self, fail=False):
        self.fail, self.calls = fail, []

    def predict(self, state, questions):
        if self.fail:
            raise LayaUnavailable("no checkpoint")
        self.calls.append((state, questions))
        out = {}
        for qid, q in questions.items():
            if q["type"] == "score":
                out[qid] = {"type": "score", "score": 1.8, "confidence": .7, "answer_confidence": .8}
            elif q["type"] == "choice":
                first = next(iter(q["criteria"]))
                out[qid] = {"type": "choice", "choice": first, "confidence": .6, "answer_confidence": .7}
            else:
                p = .9 if qid in ("tag_finance", "tag_faith", "seg_fin", "seg_dia") else .2
                out[qid] = {"type": "noul", "noul": p, "confidence": .4 if qid == "seg_rev" else .9}
        return {"answers": out, "routing": {"model": "english"}}

    def describe(self):
        return {"mode": "fake"}


def llm_with(handler, provider="ollama"):
    s = Settings(llm_provider=provider)
    return LLM(s, httpx.Client(transport=httpx.MockTransport(handler)))


def chat_reply(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def good_llm(request):
    msgs = json.loads(request.content)["messages"]
    if "idea card" in msgs[0]["content"]:
        return chat_reply('```json\n{"name": "Halal Invest", "problem": "No halal choices", "user": "students",'
                          ' "solution": "Screened ETF app", "revenue": "subscription", "delivery": "mobile"}\n```')
    return chat_reply('{"summary": "Strong niche.", "cells": {"fin": "Core audience.", "us": "Small share."}}')


def test_question_budget_fits_laya_serve_limit():
    assert len(QUESTIONS) <= 64


def test_end_to_end_with_llm():
    laya = FakeLaya()
    r = Pipeline(laya, llm_with(good_llm)).evaluate("halal investing app for students")
    assert r["idea"]["name"] == "Halal Invest"
    assert r["idea"]["pain"] == "g"  # 1.8 / 2
    assert r["comp"]["label"] == "OPEN" and r["isl"]["label"] == "YES"
    assert set(r["idea"]["tags"]) == {"finance", "faith"}
    assert r["top"][0]["id"] in ("fin", "dia")
    fin = next(c for c in r["lenses"]["Interest"] if c["id"] == "fin")
    assert fin["analysis"] == "Core audience." and fin["fit"] == .9
    rev = next(c for c in r["lenses"]["Community"] if c["id"] == "rev")
    assert rev["escalate"] is True
    assert r["idea"]["summary"] == "Strong niche."
    assert r["meta"]["llm_used"] is True
    assert laya.calls[0][0]["solution"] == "Screened ETF app"
    assert 0 <= r["sibr"] <= 100


def test_llm_down_falls_back_to_templates():
    r = Pipeline(FakeLaya(), llm_with(lambda req: httpx.Response(500))).evaluate("betting tips newsletter")
    assert r["idea"]["name"] == "Betting tips newsletter"
    assert r["meta"]["llm_used"] is False and r["meta"]["llm_error"]
    # keyword flag overrides Laya's "ok"
    assert r["isl"]["label"] == "FLAG"
    assert all("analysis" not in c for cs in r["lenses"].values() for c in cs)


def test_llm_none_provider_makes_no_calls():
    def boom(req):
        raise AssertionError("should not call")
    r = Pipeline(FakeLaya(), llm_with(boom, provider="none")).evaluate("quran tutoring for kids")
    assert r["meta"]["llm"]["model"] is None


def test_parse_json():
    assert parse_json('Sure! {"a": 1} hope that helps') == {"a": 1}
    assert parse_json("nope") is None


def test_http_laya_posts_systemone():
    seen = {}
    def handler(req):
        seen["url"], seen["body"] = str(req.url), json.loads(req.content)
        return httpx.Response(200, json={"model": "english", "answers": {}})
    s = Settings(laya_mode="http", laya_url="http://laya:8000/")
    HttpLaya(s, httpx.Client(transport=httpx.MockTransport(handler))).predict({"idea": "x"}, {"q": {}})
    assert seen["url"] == "http://laya:8000/v1/systemone" and seen["body"]["model"] == "english"


def test_api_routes():
    c = TestClient(create_app(Pipeline(FakeLaya(), llm_with(good_llm)), Settings(llm_provider="ollama")))
    assert c.get("/health").json()["ok"]
    assert c.post("/evaluate", json={"idea": "halal investing app"}).json()["idea"]["name"] == "Halal Invest"
    assert c.post("/evaluate", json={"idea": ""}).status_code == 422
    down = TestClient(create_app(Pipeline(FakeLaya(fail=True), llm_with(good_llm)), Settings(llm_provider="ollama")))
    assert down.post("/evaluate", json={"idea": "halal investing app"}).status_code == 503


def test_access_key_and_site_serving():
    s = Settings(llm_provider="ollama", api_key="s3cret")
    c = TestClient(create_app(Pipeline(FakeLaya(), llm_with(good_llm)), s))
    assert c.post("/evaluate", json={"idea": "halal investing app"}).status_code == 401
    assert c.post("/evaluate", json={"idea": "halal investing app"}, headers={"x-sibr-key": "nope"}).status_code == 401
    assert c.post("/evaluate", json={"idea": "halal investing app"}, headers={"x-sibr-key": "s3cret"}).status_code == 200
    assert "Sibr" in c.get("/").text
    assert "location.origin" in c.get("/config.js").text
    assert c.get("/app.js").status_code == 200
    for blocked in ("/README.md", "/.env", "/server/.env", "/..%2Fserver%2F.env"):
        assert c.get(blocked).status_code == 404, blocked


def test_public_site_preflight_allows_private_network():
    c = TestClient(create_app(Pipeline(FakeLaya(), llm_with(good_llm)), Settings(llm_provider="ollama")))
    r = c.options("/evaluate", headers={"origin": "https://munazzar.github.io", "access-control-request-method": "POST",
                                        "access-control-request-headers": "content-type,x-sibr-key",
                                        "access-control-request-private-network": "true"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "https://munazzar.github.io"
    assert r.headers.get("access-control-allow-private-network") == "true"


def test_long_idea_is_trimmed_for_laya_and_steps_are_reported():
    laya = FakeLaya()
    long_idea = "halal investing app for students " * 100
    r = Pipeline(laya, llm_with(good_llm)).evaluate(long_idea)
    assert len(laya.calls[0][0]["idea"]) <= 1201
    names = [s["step"] for s in r["meta"]["steps"]]
    assert names == ["Idea card", "Web evidence", "Laya verdicts", "Persona pass"]
    assert all(s["ok"] for s in r["meta"]["steps"])
    assert "trimmed" in r["meta"]["steps"][2]["detail"]
    c = TestClient(create_app(Pipeline(FakeLaya(), llm_with(good_llm)), Settings(llm_provider="ollama")))
    assert c.post("/evaluate", json={"idea": "x" * 4000}).status_code == 200


def test_segment_filter_narrows_questions_and_lenses():
    laya = FakeLaya()
    r = Pipeline(laya, llm_with(good_llm)).evaluate("halal investing app", ["fin", "dia", "nope"])
    asked = [k for k in laya.calls[0][1] if k.startswith("seg_")]
    assert asked == ["seg_dia", "seg_fin"]
    assert set(r["lenses"]) == {"Community", "Interest"}
    assert [c["id"] for c in r["top"]] == ["dia", "fin"] or [c["id"] for c in r["top"]] == ["fin", "dia"]
    assert r["meta"]["segments"] == ["dia", "fin"]


def test_api_passes_segments():
    laya = FakeLaya()
    client = TestClient(create_app(Pipeline(laya, llm_with(good_llm)), Settings(serve_site="0")))
    assert client.post("/evaluate", json={"idea": "halal investing app", "segments": ["us"]}).status_code == 200
    assert [k for k in laya.calls[0][1] if k.startswith("seg_")] == ["seg_us"]
    client.post("/evaluate", json={"idea": "halal investing app"})
    assert sum(k.startswith("seg_") for k in laya.calls[1][1]) == 21


def test_request_log_needs_admin_key():
    s = Settings(llm_provider="ollama", api_key="s3cret", admin_key="adm1n")
    c = TestClient(create_app(Pipeline(FakeLaya(), llm_with(good_llm)), s))
    c.post("/evaluate", json={"idea": "halal investing app"})
    c.post("/evaluate", json={"idea": "halal investing app"}, headers={"x-sibr-key": "s3cret", "x-forwarded-for": "100.64.0.9"})
    assert c.get("/logs.json").status_code == 401
    assert c.get("/logs.json", headers={"x-sibr-admin": "s3cret"}).status_code == 401  # the peer key is not enough
    entries = c.get("/logs.json", headers={"x-sibr-admin": "adm1n"}).json()["entries"]
    denied, ok = [e for e in entries if e["path"] == "/evaluate"]
    assert (denied["status"], denied["via"]) == (401, "this PC")
    assert (ok["status"], ok["via"], ok["ip"]) == (200, "tailscale", "100.64.0.9")
    assert "halal investing app" in ok["note"] and "Sibr" in ok["note"]
    assert c.get("/logs.json?since=%d" % ok["id"], headers={"x-sibr-admin": "adm1n"}).json()["entries"] == []
    assert "Sibr live logs" in c.get("/logs").text
