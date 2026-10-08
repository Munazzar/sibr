"""HTTP API. Run with: uvicorn sibr_api.app:app --port 8787"""
import hmac
import inspect
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
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


class EvaluateIn(BaseModel):
    idea: str = Field(min_length=3, max_length=500)


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

    @app.get("/health")
    def health():
        return {"ok": True, "version": __version__, "laya": pipeline.laya.describe(), "llm": pipeline.llm.describe(),
                "evidence": pipeline.evidence.mode}

    @app.post("/evaluate")
    def evaluate(body: EvaluateIn, x_sibr_key: Optional[str] = Header(default=None)):
        if settings.api_key and not hmac.compare_digest(x_sibr_key or "", settings.api_key):
            raise HTTPException(401, "Missing or wrong access key")
        try:
            return pipeline.evaluate(body.idea)
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
