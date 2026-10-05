# Sibr Matrix

**Sibr (صبر)** is a business idea validation matrix. It scores an idea on pain, value, target clarity, market growth, Islamic alignment, and competition. It then breaks the idea down across geographies, age groups, communities, and interests to show where it actually wins.

**Live:** https://munazzar.github.io/sibr/

## What's in this release

- An animated validation matrix seeded with six ideas.
- A free-text idea input that runs the lens engine in the browser.
- A lens map covering 21 segments (geography × age × community × interest). Click any cell to see why it scored the way it did.
- Islamic-alignment flags (riba, gambling, speculative instruments, haram categories, content/ads). These are **flags for scholarly review, not rulings**.

The engine in `engine.js` is a transparent, deterministic **heuristic**. It exists so the UI is usable now. Treat its scores as directional, not as research.

## Planned engine

1. **Idea card**: problem, user, solution, revenue, delivery.
2. **Lens grid**: segment cells.
3. **Evidence pull**: competitors, reviews, forums, trends.
4. **LLM persona pass**: a short analysis per cell.
5. **Verdict heads**: fine-tuned [Laya](https://huggingface.co/convaiinnovations/laya) classifiers that return typed, calibrated verdicts, with low-confidence cells escalated.

To wire it up, replace `Sibr.evaluate` with a call to the model service. The return shape is documented in the code.

## Run locally

This is a static site with no build step. Open `index.html` directly, or serve the folder:

```
python3 -m http.server
```
