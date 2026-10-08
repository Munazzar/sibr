# Sibr model service

The API behind the Sibr Matrix. One request runs three steps:

1. **Idea card.** An LLM turns the free-text idea into problem, user, solution, revenue and delivery.
2. **Verdict heads.** [Laya](https://github.com/NandhaKishorM/laya) answers 43 typed questions on that card in one forward pass: pain, value, target and growth (`score`), competition and Islamic alignment (`choice`), 16 theme tags and all 21 lens cells (`noul`). Cells below `SIBR_LAYA_MIN_CONFIDENCE` are marked for a human check.
3. **Persona pass.** The LLM writes one line per lens cell and a two-sentence verdict.

The response has the same shape as `Sibr.evaluate` in `../engine.js`, so the site renders it unchanged. If the LLM is down, the service still answers with Laya scores and template text. If Laya is down, it returns 503 and the site falls back to its in-browser heuristic.

Islamic-alignment output combines Laya's choice with the keyword flags and keeps the stricter one. It is a flag for scholarly review, never a ruling.

## Run locally

```
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt          # includes laya, torch, transformers
cp .env.example .env                     # then edit; the service reads server/.env
ollama pull llama3.2:3b                  # free local LLM, or set HF_TOKEN for the HF router
uvicorn sibr_api.app:app --port 8787
```

The first request downloads the Laya checkpoint (about 421M parameters) from Hugging Face.

Then serve the site and point it at the service:

```
cd .. && python3 -m http.server 8080
# open http://localhost:8080/?api=http://localhost:8787
```

Or set `window.SIBR_API` in `../config.js`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `SIBR_LLM_PROVIDER` | `huggingface` if `HF_TOKEN` is set, else `ollama` | `ollama`, `huggingface`, `groq`, `openrouter`, `openai`, `none`. All are called through the OpenAI-compatible `/chat/completions` API. |
| `SIBR_LLM_MODEL` | per provider | e.g. `llama3.2:3b` (Ollama), `meta-llama/Llama-3.1-8B-Instruct` (HF) |
| `SIBR_LLM_BASE_URL`, `SIBR_LLM_API_KEY` | per provider | Override for any other OpenAI-compatible endpoint. The key falls back to `HF_TOKEN`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` or `OPENAI_API_KEY`. |
| `SIBR_LAYA_MODE` | `local` | `local` loads Laya in-process; `http` calls a `laya-serve` at `SIBR_LAYA_URL`. |
| `SIBR_LAYA_MODEL` | `english` | `english`, `multilingual`, `typed-decisions`, or a fine-tuned checkpoint registered on `laya-serve`. |
| `SIBR_LAYA_MIN_CONFIDENCE` | `0.5` | Cells below this get `escalate: true`. |
| `SIBR_CORS_ORIGINS` | GitHub Pages + localhost | Comma-separated. |

## API

- `GET /health`: which Laya and LLM backends are configured.
- `POST /evaluate` with `{"idea": "halal investing app for students"}`: the full verdict.

## Tests

```
pip install -r requirements-dev.txt
pytest -q
```

The tests use a fake Laya and a mocked LLM, so they need neither model.
