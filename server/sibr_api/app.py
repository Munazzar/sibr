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
SITE_FILES = {"index.html", "app.js", "engine.js", "styles.css"}
LOGS_PAGE = Path(__file__).with_name("logs.html")


class EvaluateIn(BaseModel):
    idea: str = Field(min_length=3, max_length=5000)
    # Audience segment ids to score (see segments.py). Empty or missing means all of them.
    segments: Optional[List[str]] = Field(default=None, max_length=64)


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
        if request.url.path == "/logs.json":  # the log page polling itself is noise
            return await call_next(request)
        t, status = time.perf_counter(), 500
        try:
            resp = await call_next(request)
            status = resp.status_code
            return resp
        finally:
            seq[0] += 1
            h = request.headers
            fwd = h.get("x-forwarded-for", "")
            entry = {"id": seq[0], "time": datetime.now().isoformat(timespec="seconds"), "method": request.method,
                     "path": request.url.path, "status": status, "ms": round((time.perf_counter() - t) * 1000),
                     "ip": fwd.split(",")[0].strip() or (request.client.host if request.client else ""),
                     "who": h.get("tailscale-user-login") or h.get("tailscale-user-name") or "",
                     "via": "tailscale" if fwd else "this PC", "note": getattr(request.state, "note", "")}
            recent.append(entry)
            if log_path:
                log_path.parent.mkdir(exist_ok=True)
                with log_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")

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

    @app.get("/health")
    def health():
        return {"ok": True, "version": __version__, "laya": pipeline.laya.describe(), "llm": pipeline.llm.describe(),
                "evidence": pipeline.evidence.mode}

    @app.post("/evaluate")
    def evaluate(body: EvaluateIn, request: Request, x_sibr_key: Optional[str] = Header(default=None)):
        idea = " ".join(body.idea.split())
        request.state.note = (idea[:100] + "…" if len(idea) > 100 else idea) + (
            f" · {len(body.segments)} segments" if body.segments else "")
        if settings.api_key and not hmac.compare_digest(x_sibr_key or "", settings.api_key):
            raise HTTPException(401, "Missing or wrong access key")
        try:
            out = pipeline.evaluate(body.idea, body.segments)
            request.state.note += f" · Sibr {out.get('sibr')}"
            return out
        except LayaUnavailable as e:
            raise HTTPException(503, f"Laya is unavailable: {e}")

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
