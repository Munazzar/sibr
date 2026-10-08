"""Thin OpenAI-compatible chat client. Works with Ollama, the Hugging Face
router, Groq, OpenRouter and OpenAI. Every call degrades to None on failure so
the pipeline can fall back to template text instead of erroring."""
import json
import logging
import re
from typing import Any, Optional

import httpx

from .config import Settings

log = logging.getLogger("sibr.llm")


class LLM:
    def __init__(self, settings: Settings, client: Optional[httpx.Client] = None):
        self.s = settings
        self.client = client or httpx.Client(timeout=settings.llm_timeout)
        self.last_error: Optional[str] = None

    @property
    def enabled(self) -> bool:
        return self.s.llm_provider != "none" and bool(self.s.llm_base_url and self.s.llm_model)

    def describe(self) -> dict:
        return {"provider": self.s.llm_provider, "model": self.s.llm_model if self.enabled else None}

    def chat(self, system: str, user: str, max_tokens: int = 700) -> Optional[str]:
        if not self.enabled:
            return None
        headers = {"content-type": "application/json"}
        if self.s.llm_api_key:
            headers["authorization"] = f"Bearer {self.s.llm_api_key}"
        body = {"model": self.s.llm_model, "temperature": 0.3, "max_tokens": max_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        if self.s.llm_reasoning:
            body["reasoning_effort"] = self.s.llm_reasoning
        try:
            r = self.client.post(f"{self.s.llm_base_url}/chat/completions", json=body, headers=headers)
            r.raise_for_status()
            self.last_error = None
            return r.json()["choices"][0]["message"]["content"]
        except Exception as e:  # network, auth, quota, malformed body
            self.last_error = f"{type(e).__name__}: {e}"
            log.warning("LLM call failed: %s", self.last_error)
            return None

    def chat_json(self, system: str, user: str, max_tokens: int = 700) -> Optional[Any]:
        text = self.chat(system + "\nReply with a single JSON object and nothing else.", user, max_tokens)
        return parse_json(text) if text else None


def parse_json(text: str) -> Optional[Any]:
    """Pull the first JSON object out of a model reply (handles ```json fences and chatter)."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
