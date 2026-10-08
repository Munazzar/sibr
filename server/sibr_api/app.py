"""HTTP API. Run with: uvicorn sibr_api.app:app --port 8787"""
import hmac
import inspect
import json
import logging
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import BaseModel, Field

from . import __version__
from .config import Settings
from .evidence import Evidence
from .laya_client import LayaUnavailable, make_laya
from .llm import LLM
from .pipeline import Pipeline

logging.basicConfig(level=logging.INFO)

SITE = Path(__file__).resolve().parents[2]
# Only these files are served, so nothing else in the repo (like server/.env) is reachable.
SITE_FILES = {"index.html", "app.js", "engine.js", "segments.js", "styles.css"}
LOGS_PAGE = Path(__file__).with_name("logs.html")
TRAINING = Path(__file__).resolve().parents[1] / "training"


def _tail(path: Path, n: int) -> list:
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()[-n:]
    except OSError:
        return []


def training_status() -> dict:
    """What the overnight training chain is doing, read from the files it writes."""
    data, runs = TRAINING / "data", TRAINING / "data" / "runs"
    chain = _tail(runs / "chain.log", 40)
    stage_logs = sorted(runs.glob("*.log"), key=lambda p: p.stat().st_mtime) if runs.exists() else []
    current = next((p for p in reversed(stage_logs) if p.name != "chain.log"), None)
    datasets = {p.name: {"ideas": sum(1 for line in open(p, encoding="utf-8") if line.strip()),
                         "updated": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds")}
                for p in sorted(data.glob("labels*.jsonl"))} if data.exists() else {}
    ckpt_dir = TRAINING / "checkpoints"
    ckpts = sorted(p.name for p in ckpt_dir.iterdir() if p.is_dir()) if ckpt_dir.exists() else []
    return {"chain": chain, "datasets": datasets, "checkpoints": ckpts,
            "stage_log": {"name": current.name, "tail": _tail(current, 8)} if current else None,
            "gold": (data / "gold.csv").exists()}


def _kind(method: str, path: str) -> str:
    if method == "OPTIONS":
        return "preflight"
    if path in ("/evaluate", "/health"):
        return path[1:]
    if path.startswith("/logs"):
        return "logs"
    return "page"


def _result_summary(out: dict) -> dict:
    """What the log keeps from an evaluation: enough to see what happened, not the whole report."""
    meta = out.get("meta") or {}
    return {"sibr": out.get("sibr"), "islamic": (out.get("isl") or {}).get("label"),
            "competition": (out.get("comp") or {}).get("label"), "name": (out.get("idea") or {}).get("name"),
            "summary": (out.get("idea") or {}).get("summary"),
            "top": [{"name": c.get("name"), "fit": round(float(c.get("fit", 0)), 2)} for c in (out.get("top") or [])],
            "scores": {k: v.get("value") for k, v in (out.get("verdicts") or {}).items()},
            "steps": meta.get("steps"), "evidence": len(out.get("evidence") or []),
            "laya_model": meta.get("laya_model"), "llm": (meta.get("llm") or {}).get("model"),
            "llm_error": meta.get("llm_error"), "audiences": len(meta.get("segments") or [])}


class EvaluateIn(BaseModel):
    idea: str = Field(min_length=3, max_length=5000)
    # Audience segment ids to score (see segments.json). With none of these three, the core 21.
    segments: Optional[List[str]] = Field(default=None, max_length=300)
    # Open mode: no filter; the LLM suggests likely customer audiences and Laya scores them.
    open_audience: bool = False
    # Audiences the person typed, e.g. "dentists in Texas".
    custom: Optional[List[str]] = Field(default=None, max_length=12)


def create_app(pipeline: Pipeline = None, settings: Settings = None) -> FastAPI:
    settings = settings or Settings()
    pipeline = pipeline or Pipeline(make_laya(settings), LLM(settings), settings.laya_min_confidence,
                                    Evidence(settings.evidence, settings.evidence_results))
    app = FastAPI(title="Sibr model service", version=__version__)
    cors = dict(allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                allow_methods=["GET", "POST"], allow_headers=["content-type", "x-sibr-key"])
    # The public site (GitHub Pages) calling a Tailscale 100.x address is a private-network
    # request; Chrome needs this preflight header for it.
    if "allow_private_network" in inspect.signature(CORSMiddleware.__init__).parameters:
        cors["allow_private_network"] = True
    app.add_middleware(CORSMiddleware, **cors)

    # Live request log: the last 500 in memory (for /logs), every one appended to log_file.
    log_path = (Path(__file__).resolve().parents[1] / settings.log_file) if settings.log_file else None
    recent = deque(maxlen=500)
    if log_path and log_path.exists():
        for line in log_path.read_text(encoding="utf-8").splitlines()[-500:]:
            try:
                recent.append(json.loads(line))
            except ValueError:
                pass
    seq = [recent[-1]["id"] if recent else 0]

    @app.middleware("http")
    async def record(request: Request, call_next):
        if request.url.path in ("/logs.json", "/training.json"):  # the log page polling itself is noise
            return await call_next(request)
        t, status = time.perf_counter(), 500
        resp = None
        try:
            resp = await call_next(request)
            status = resp.status_code
            return resp
        finally:
            seq[0] += 1
            h = request.headers
            fwd = h.get("x-forwarded-for", "")
            st = request.state
            entry = {"id": seq[0], "time": datetime.now().isoformat(timespec="seconds"), "method": request.method,
                     "path": request.url.path, "kind": _kind(request.method, request.url.path),
                     "status": status, "ms": round((time.perf_counter() - t) * 1000),
                     "ip": fwd.split(",")[0].strip() or (request.client.host if request.client else ""),
                     "who": h.get("tailscale-user-login") or h.get("tailscale-user-name") or "",
                     "name": h.get("tailscale-user-name") or "",
                     "via": "tailscale" if fwd else "this PC", "note": getattr(st, "note", ""),
                     "detail": {"ua": h.get("user-agent", ""), "origin": h.get("origin") or h.get("referer") or "",
                                "query": request.url.query, "req_bytes": int(h.get("content-length") or 0),
                                "resp_bytes": int(resp.headers.get("content-length") or 0) if resp else 0,
                                "error": getattr(st, "error", ""), "request": getattr(st, "request", None),
                                "result": getattr(st, "result", None)}}
            recent.append(entry)
            if log_path:
                log_path.parent.mkdir(exist_ok=True)
                with log_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request: Request, exc: RequestValidationError):
        request.state.error = "; ".join(f"{'.'.join(map(str, e.get('loc', [])[1:]))}: {e.get('msg')}" for e in exc.errors())
        return await request_validation_exception_handler(request, exc)

    def admin_ok(key: Optional[str]) -> bool:
        return bool(settings.admin_key) and hmac.compare_digest(key or "", settings.admin_key)

    @app.get("/logs")
    def logs_page():
        return HTMLResponse(LOGS_PAGE.read_text(encoding="utf-8"))

    @app.get("/logs.json")
    def logs_json(since: int = 0, x_sibr_admin: Optional[str] = Header(default=None)):
        if not admin_ok(x_sibr_admin):
            raise HTTPException(401, "Missing or wrong admin key (SIBR_ADMIN_KEY in server/.env)")
        return {"entries": [e for e in recent if e["id"] > since]}

    @app.get("/training.json")
    def training_json(x_sibr_admin: Optional[str] = Header(default=None)):
        if not admin_ok(x_sibr_admin):
            raise HTTPException(401, "Missing or wrong admin key (SIBR_ADMIN_KEY in server/.env)")
        return training_status()

    @app.get("/health")
    def health():
        return {"ok": True, "version": __version__, "laya": pipeline.laya.describe(), "llm": pipeline.llm.describe(),
                "evidence": pipeline.evidence.mode}

    @app.post("/evaluate")
    def evaluate(body: EvaluateIn, request: Request, x_sibr_key: Optional[str] = Header(default=None)):
        idea = " ".join(body.idea.split())
        request.state.note = (idea[:100] + "…" if len(idea) > 100 else idea) + (
            f" · {len(body.segments)} segments" if body.segments else "") + (
            " · open audience" if body.open_audience else "") + (f" · {len(body.custom)} custom" if body.custom else "")
        request.state.request = {"idea": body.idea, "chars": len(body.idea),
                                 "mode": "open" if body.open_audience else "picked" if body.segments else
                                 "custom" if body.custom else "default (core 21)",
                                 "segments": body.segments or [], "custom": body.custom or [],
                                 "key": "ok" if settings.api_key else "not required"}
        if settings.api_key and not hmac.compare_digest(x_sibr_key or "", settings.api_key):
            request.state.request["key"] = "missing" if not x_sibr_key else "wrong"
            request.state.error = "Missing or wrong access key"
            raise HTTPException(401, request.state.error)
        try:
            out = pipeline.evaluate(body.idea, body.segments, body.open_audience, body.custom)
        except LayaUnavailable as e:
            request.state.error = f"Laya is unavailable: {e}"
            raise HTTPException(503, request.state.error)
        except Exception as e:
            request.state.error = f"{type(e).__name__}: {e}"
            raise
        request.state.note += f" · Sibr {out.get('sibr')}"
        request.state.result = _result_summary(out)
        return out

    if settings.serve_site:
        @app.get("/config.js")
        def site_config():
            # Served from here, the site talks to this same origin.
            return Response("window.SIBR_API = location.origin;\n", media_type="text/javascript")

        @app.get("/")
        def site_index():
            return FileResponse(SITE / "index.html")

        @app.get("/{name}")
        def site_file(name: str):
            if name not in SITE_FILES:
                raise HTTPException(404)
            return FileResponse(SITE / name)

    return app


app = create_app()
