"""Evidence pull: a few free web searches per idea (DuckDuckGo via the `ddgs`
package, no API key). Results feed Laya's state and the persona pass, and are
returned to the UI as links. Any failure yields no evidence, never an error."""
import logging
from typing import Dict, List

log = logging.getLogger("sibr.evidence")


def queries(card: Dict[str, str]) -> List[str]:
    name, problem = card.get("name", ""), card.get("problem") or card.get("name", "")
    return [f"{name} competitors alternatives", f"{problem} reddit", f"{name} reviews"]


class Evidence:
    def __init__(self, mode: str = "ddg", per_query: int = 3):
        self.mode, self.per_query = mode, per_query

    def search(self, query: str) -> List[Dict[str, str]]:
        from ddgs import DDGS
        return [{"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")}
                for r in DDGS().text(query, max_results=self.per_query)]

    def pull(self, card: Dict[str, str]) -> List[Dict[str, str]]:
        if self.mode == "off":
            return []
        out, seen = [], set()
        for q in queries(card):
            try:
                hits = self.search(q)
            except Exception as e:  # missing package, rate limit, network
                log.warning("evidence search failed for %r: %s", q, e)
                continue
            for h in hits:
                if h["url"] and h["url"] not in seen:
                    seen.add(h["url"])
                    out.append({**h, "query": q})
        return out


def digest(items: List[Dict[str, str]], limit: int = 6, chars: int = 160) -> str:
    """Short text for Laya's state; the English checkpoint reads 512 tokens."""
    return " | ".join(f"{i['title']}: {i['snippet'][:chars]}" for i in items[:limit])
