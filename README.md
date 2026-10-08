# Sibr Matrix

**Sibr (سبر, "to probe, to test the depth of")** is a business idea validation matrix. It scores an idea on pain, value, target clarity, market growth, Islamic alignment and competition. It then breaks the idea down across 141 audiences (geography, age, profession, businesses, faith and culture, interests and more) to show where it actually wins.

**Live:** https://munazzar.github.io/sibr/

This repository holds only the website: plain HTML, CSS and JavaScript with no build step.

- `engine.js`: the **Quick** engine. A transparent, rule-based estimate that runs entirely in your browser. Treat its scores as directional, not as research.
- **Laya on my PC**: if you run the Sibr model service, the site can send ideas to it for the full analysis (LLM idea card, web evidence, Laya verdicts). Set its address in "Laya settings" on the page, or add `?api=https://your-service` to the URL.
- Islamic-alignment results are **flags for scholarly review, not rulings**.

The model service, training code and documentation live in a separate private repository.

## Run locally

Open `index.html` directly, or serve the folder:

```
python -m http.server 8080
```
