"""Evidence pull: a few free web searches per idea (DuckDuckGo via the `ddgs`
package, no API key). Results feed Laya's state and the persona pass, and are
returned to the UI as links. Any failure yields no evidence, never an error."""
import logging
import re
from typing import Dict, List

log = logging.getLogger("sibr.evidence")


STOP = set("a an the for to of and or in on with by at from app apps platform service tool based "
           "that this your their who people users".split())


def words(text: str) -> set:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in STOP}


def queries(idea: str, card: Dict[str, str]) -> List[str]:
    # Search in the user's own words; the LLM-made name ("Halal Student Invest") matches unrelated brands.
    solution = card.get("solution") or idea
    return [f"{idea} competitors", f"{idea} reddit", f"{solution} alternatives"]


def relevant(hit: Dict[str, str], keys: set, need: int = 2) -> bool:
    """Keep a result only when it shares at least `need` content words with the idea."""
    return len(keys & words(hit["title"] + " " + hit["snippet"])) >= min(need, len(keys))


class Evidence:
    def __init__(self, mode: str = "ddg", per_query: int = 3):
        self.mode, self.per_query = mode, per_query

    def search(self, query: str) -> List[Dict[str, str]]:
        from ddgs import DDGS
        return [{"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")}
                for r in DDGS().text(query, max_results=self.per_query)]

    def pull(self, idea: str, card: Dict[str, str]) -> List[Dict[str, str]]:
        if self.mode == "off":
            return []
        keys = words(idea + " " + card.get("problem", ""))
        out, seen = [], set()
        for q in queries(idea, card):
            try:
                hits = self.search(q)
            except Exception as e:  # missing package, rate limit, network
                log.warning("evidence search failed for %r: %s", q, e)
                continue
            for h in hits:
                if h["url"] and h["url"] not in seen and relevant(h, keys):
                    seen.add(h["url"])
                    out.append({**h, "query": q})
        return out


def digest(items: List[Dict[str, str]], limit: int = 6, chars: int = 160) -> str:
    """Short text for Laya's state; the English checkpoint reads 512 tokens."""
    return " | ".join(f"{i['title']}: {i['snippet'][:chars]}" for i in items[:limit])
