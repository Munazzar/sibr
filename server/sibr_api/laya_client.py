"""Laya verdict heads. Either loads the model in-process (`pip install laya`)
or calls a self-hosted `laya-serve` over its /v1/systemone protocol. Both
return the same `{"answers": {qid: {...}}}` payload."""
import logging
from typing import Any, Dict, Optional

import httpx

from .config import Settings

log = logging.getLogger("sibr.laya")


class LayaUnavailable(RuntimeError):
    pass


class LocalLaya:
    def __init__(self, settings: Settings):
        self.s = settings
        self._router = None

    def _load(self):
        if self._router is None:
            try:
                from laya import Router
            except ImportError as e:
                raise LayaUnavailable("laya is not installed; pip install laya or set SIBR_LAYA_MODE=http") from e
            self._router = Router()
        return self._router

    def predict(self, state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return self._load().predict(state, questions, model=self.s.laya_model or None)
        except LayaUnavailable:
            raise
        except Exception as e:  # checkpoint download, OOM, bad input
            raise LayaUnavailable(f"{type(e).__name__}: {e}") from e

    def describe(self) -> dict:
        return {"mode": "local", "model": self.s.laya_model}


class HttpLaya:
    def __init__(self, settings: Settings, client: Optional[httpx.Client] = None):
        self.s = settings
        self.client = client or httpx.Client(timeout=120)

    def predict(self, state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
        headers = {"content-type": "application/json"}
        if self.s.laya_api_key:
            headers["authorization"] = f"Bearer {self.s.laya_api_key}"
        body = {"state": state, "questions": questions}
        if self.s.laya_model:
            body["model"] = self.s.laya_model
        try:
            r = self.client.post(f"{self.s.laya_url.rstrip('/')}/v1/systemone", json=body, headers=headers)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            raise LayaUnavailable(f"{type(e).__name__}: {e}") from e

    def describe(self) -> dict:
        return {"mode": "http", "url": self.s.laya_url, "model": self.s.laya_model}


def make_laya(settings: Settings):
    if settings.laya_mode == "http":
        return HttpLaya(settings)
    if settings.laya_mode == "local":
        return LocalLaya(settings)
    raise ValueError(f"Unknown SIBR_LAYA_MODE {settings.laya_mode!r}; use local or http")
