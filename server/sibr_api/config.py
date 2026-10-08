"""All runtime settings come from environment variables so the service can be
re-pointed at a different LLM or Laya deployment without code changes."""
import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv(path: Path = Path(__file__).resolve().parents[1] / ".env") -> None:
    """Minimal .env support: KEY=value lines, real environment wins."""
    if path.is_file():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()

# OpenAI-compatible presets. Every provider below speaks POST {base}/chat/completions,
# so one client covers all of them; switching is a config change.
LLM_PRESETS = {
    "ollama": {"base_url": "http://localhost:11434/v1", "model": "llama3.2:3b", "key_env": None},
    "huggingface": {"base_url": "https://router.huggingface.co/v1",
                    "model": "meta-llama/Llama-3.1-8B-Instruct", "key_env": "HF_TOKEN"},
    "groq": {"base_url": "https://api.groq.com/openai/v1", "model": "llama-3.1-8b-instant", "key_env": "GROQ_API_KEY"},
    "openrouter": {"base_url": "https://openrouter.ai/api/v1",
                   "model": "meta-llama/llama-3.2-3b-instruct:free", "key_env": "OPENROUTER_API_KEY"},
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini", "key_env": "OPENAI_API_KEY"},
    "none": {"base_url": "", "model": "", "key_env": None},
}


@dataclass
class Settings:
    llm_provider: str = field(default_factory=lambda: os.getenv("SIBR_LLM_PROVIDER", "ollama"))
    llm_base_url: str = field(default_factory=lambda: os.getenv("SIBR_LLM_BASE_URL", ""))
    llm_model: str = field(default_factory=lambda: os.getenv("SIBR_LLM_MODEL", ""))
    llm_api_key: str = field(default_factory=lambda: os.getenv("SIBR_LLM_API_KEY", ""))
    llm_timeout: float = field(default_factory=lambda: float(os.getenv("SIBR_LLM_TIMEOUT", "60")))

    # local: load Laya in-process (pip install laya). http: call a laya-serve URL.
    laya_mode: str = field(default_factory=lambda: os.getenv("SIBR_LAYA_MODE", "local"))
    laya_url: str = field(default_factory=lambda: os.getenv("SIBR_LAYA_URL", "http://localhost:8000"))
    laya_api_key: str = field(default_factory=lambda: os.getenv("SIBR_LAYA_API_KEY", ""))
    laya_model: str = field(default_factory=lambda: os.getenv("SIBR_LAYA_MODEL", "english"))
    # A fine-tuned checkpoint directory (see training/). When set it replaces the stock model.
    laya_checkpoint: str = field(default_factory=lambda: os.getenv("SIBR_LAYA_CHECKPOINT", ""))
    laya_min_confidence: float = field(default_factory=lambda: float(os.getenv("SIBR_LAYA_MIN_CONFIDENCE", "0.5")))

    # Free web evidence via DuckDuckGo (no key). "off" skips the step.
    evidence: str = field(default_factory=lambda: os.getenv("SIBR_EVIDENCE", "ddg"))
    evidence_results: int = field(default_factory=lambda: int(os.getenv("SIBR_EVIDENCE_RESULTS", "3")))

    cors_origins: str = field(default_factory=lambda: os.getenv(
        "SIBR_CORS_ORIGINS", "https://munazzar.github.io,http://localhost:8080,http://127.0.0.1:8080"))

    def __post_init__(self):
        preset = LLM_PRESETS.get(self.llm_provider)
        if preset is None:
            raise ValueError(f"Unknown SIBR_LLM_PROVIDER {self.llm_provider!r}; pick one of {sorted(LLM_PRESETS)}")
        self.llm_base_url = (self.llm_base_url or preset["base_url"]).rstrip("/")
        self.llm_model = self.llm_model or preset["model"]
        if not self.llm_api_key and preset["key_env"]:
            self.llm_api_key = os.getenv(preset["key_env"], "")
