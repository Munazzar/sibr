# Sibr model service

The API behind the Sibr Matrix. Everything here is free: Laya is open source, the default LLM is Ollama on your own computer, and web evidence comes from DuckDuckGo with no API key. One request runs these steps:

1. **Idea card.** An LLM turns the free-text idea into problem, user, solution, revenue and delivery.
2. **Verdict heads.** [Laya](https://github.com/NandhaKishorM/laya) answers 43 typed questions on that card in one forward pass: pain, value, target and growth (`score`), competition and Islamic alignment (`choice`), 16 theme tags and all 21 lens cells (`noul`). Cells below `SIBR_LAYA_MIN_CONFIDENCE` are marked for a human check.
   **Evidence.** Before Laya runs, three free web searches (competitors, Reddit, reviews) add short snippets to what Laya reads. The links come back in the response and show under the lens map.
3. **Persona pass.** The LLM writes one line per lens cell and a two-sentence verdict.

The response has the same shape as `Sibr.evaluate` in `../engine.js`, so the site renders it unchanged. If the LLM is down, the service still answers with Laya scores and template text. If Laya is down, it returns 503 and the site falls back to its in-browser heuristic.

Islamic-alignment output combines Laya's choice with the keyword flags and keeps the stricter one. It is a flag for scholarly review, never a ruling.

## Windows quick start

```
winget install Ollama.Ollama
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

`setup.ps1` builds `server\.venv`, installs everything, pulls `llama3.2:3b` and downloads the Laya checkpoint. `start.ps1` runs the service and the site and opens `http://localhost:8080/?api=http://localhost:8787`.

## Run locally (any OS)

```
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt          # includes laya, torch, transformers
cp .env.example .env                     # then edit; the service reads server/.env
ollama pull llama3.2:3b                  # free local LLM
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
| `SIBR_LLM_PROVIDER` | `ollama` | `ollama`, `huggingface`, `groq`, `openrouter`, `openai`, `none`. All are called through the OpenAI-compatible `/chat/completions` API. |
| `SIBR_LLM_MODEL` | per provider | e.g. `llama3.2:3b` (Ollama), `meta-llama/Llama-3.1-8B-Instruct` (HF) |
| `SIBR_LLM_BASE_URL`, `SIBR_LLM_API_KEY` | per provider | Override for any other OpenAI-compatible endpoint. The key falls back to `HF_TOKEN`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` or `OPENAI_API_KEY`. |
| `SIBR_LAYA_MODE` | `local` | `local` loads Laya in-process; `http` calls a `laya-serve` at `SIBR_LAYA_URL`. |
| `SIBR_LAYA_MODEL` | `english` | `english`, `multilingual`, `typed-decisions`, or a fine-tuned checkpoint registered on `laya-serve`. |
| `SIBR_LAYA_CHECKPOINT` | unset | A fine-tuned checkpoint directory. Replaces the stock model when set. |
| `SIBR_EVIDENCE` | `ddg` | `off` skips the web search. |
| `SIBR_EVIDENCE_RESULTS` | `3` | Results per search (three searches per idea). |
| `SIBR_LAYA_MIN_CONFIDENCE` | `0.5` | Cells below this get `escalate: true`. |
| `SIBR_CORS_ORIGINS` | GitHub Pages + localhost | Comma-separated. |

## Fine-tuning Laya for Sibr

Stock Laya is weak zero-shot, so `training/` builds a Sibr dataset and fine-tunes on it, all locally.

```
cd server
python -m training.make_dataset --n 1000     # local LLM invents and grades ideas; resumable
# open training/data/review.csv, fix any grade you disagree with, set keep=0 to drop a row
python -m training.make_dataset --from-review
python -m training.finetune --epochs 2       # writes training/checkpoints/sibr-laya
```

Then set `SIBR_LAYA_CHECKPOINT=training/checkpoints/sibr-laya` in `server/.env` and restart. `finetune` passes extra flags to `laya-train`, for example `--device cuda` or `--dry-run`. The teacher's labels are only as good as the local LLM, so the review step matters. Training data and checkpoints are git-ignored.

## API

- `GET /health`: which Laya and LLM backends are configured.
- `POST /evaluate` with `{"idea": "halal investing app for students"}`: the full verdict.

## Tests

```
pip install -r requirements-dev.txt
pytest -q
```

The tests use a fake Laya and a mocked LLM, so they need neither model.
