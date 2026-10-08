# Sibr Matrix

**Sibr (صبر)** is a business idea validation matrix. It scores an idea on pain, value, target clarity, market growth, Islamic alignment, and competition. It then breaks the idea down across geographies, age groups, communities, and interests to show where it actually wins.

**Live:** https://munazzar.github.io/sibr/

## What's in this release

- An animated validation matrix seeded with six ideas.
- A free-text idea input that runs the lens engine in the browser.
- A lens map covering 21 segments (geography × age × community × interest). Click any cell to see why it scored the way it did.
- Islamic-alignment flags (riba, gambling, speculative instruments, haram categories, content/ads). These are **flags for scholarly review, not rulings**.

## Engine

Ideas typed into the site go to the **model service** in [`server/`](server/README.md) when one is configured, and to the in-browser heuristic in `engine.js` otherwise (or when the service is unreachable).

| Step | Status |
|---|---|
| 1. **Idea card**: problem, user, solution, revenue, delivery | Built: a swappable LLM, free local Ollama by default |
| 2. **Lens grid**: segment cells | Built: 21 cells, shared with `engine.js` |
| 3. **Evidence pull**: competitors, reviews, forums, trends | Built: free DuckDuckGo search, three queries per idea |
| 4. **LLM persona pass**: a short analysis per cell | Built: one line per cell plus a verdict |
| 5. **Verdict heads**: [Laya](https://github.com/NandhaKishorM/laya) typed, calibrated verdicts, low-confidence cells escalated | Built. Runs the stock checkpoint until you fine-tune one with `server/training/` |

Point the site at a running service with `window.SIBR_API` in `config.js`, or add `?api=https://your-service` to the page URL.

The heuristic in `engine.js` is transparent and deterministic. Treat its scores as directional, not as research.

## Run locally

The site is static with no build step. Open `index.html` directly, or serve the folder:

```
python3 -m http.server 8080
```

On Windows, `scripts\setup.ps1` then `scripts\start.ps1` runs everything locally for free at `http://localhost:8787/`, and `scripts\tailscale.ps1` shares it privately with your other devices. Otherwise see [`server/README.md`](server/README.md).
