"""HTTP API. Run with: uvicorn sibr_api.app:app --port 8787"""
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import __version__
from .config import Settings
from .laya_client import LayaUnavailable, make_laya
from .llm import LLM
from .pipeline import Pipeline

logging.basicConfig(level=logging.INFO)


class EvaluateIn(BaseModel):
    idea: str = Field(min_length=3, max_length=500)


def create_app(pipeline: Pipeline = None, settings: Settings = None) -> FastAPI:
    settings = settings or Settings()
    pipeline = pipeline or Pipeline(make_laya(settings), LLM(settings), settings.laya_min_confidence)
    app = FastAPI(title="Sibr model service", version=__version__)
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                       allow_methods=["GET", "POST"], allow_headers=["content-type"])

    @app.get("/health")
    def health():
        return {"ok": True, "version": __version__, "laya": pipeline.laya.describe(), "llm": pipeline.llm.describe()}

    @app.post("/evaluate")
    def evaluate(body: EvaluateIn):
        try:
            return pipeline.evaluate(body.idea)
        except LayaUnavailable as e:
            raise HTTPException(503, f"Laya is unavailable: {e}")

    return app


app = create_app()
