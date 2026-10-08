"""Lens definitions. Mirrors SEGMENTS / TAGS / FLAGS in ../engine.js so the
browser fallback and the model service score the same grid."""
import re

# id, name, market multiplier (spending power), and a description Laya reads.
SEGMENTS = {
    "Geography": [
        ("us", "United States", 1.0, "consumers and businesses in the United States"),
        ("uk", "United Kingdom", .85, "consumers and businesses in the United Kingdom"),
        ("gcc", "Gulf (GCC)", .95, "consumers and businesses in Saudi Arabia, the UAE, Qatar and the Gulf"),
        ("sa", "South Asia", .6, "consumers and businesses in India, Pakistan and Bangladesh"),
        ("sea", "Malaysia & Indonesia", .7, "consumers and businesses in Malaysia and Indonesia"),
        ("af", "Africa (NG, KE, EG)", .5, "consumers and businesses in Nigeria, Kenya and Egypt"),
    ],
    "Age group": [
        ("a1", "18–24", .55, "people aged 18 to 24"),
        ("a2", "25–34", .85, "people aged 25 to 34"),
        ("a3", "35–49", 1.0, "people aged 35 to 49"),
        ("a4", "50+", .8, "people aged 50 and over"),
    ],
    "Community": [
        ("dia", "Muslim diaspora", .85, "Muslims living in Western countries"),
        ("rev", "New Muslims", .5, "recent converts to Islam"),
        ("stu", "University students", .45, "university students"),
        ("sme", "SME owners", 1.0, "owners of small and medium businesses"),
        ("msq", "Masjids & nonprofits", .6, "mosques, Islamic centres and nonprofits"),
        ("rem", "Remote workers", .8, "remote workers and digital nomads"),
    ],
    "Interest": [
        ("cre", "Creators", .7, "content creators and influencers"),
        ("pro", "Productivity", .8, "people focused on productivity and professional growth"),
        ("fai", "Faith & learning", .65, "people focused on Islamic learning and faith practice"),
        ("fam", "Family & parenting", .75, "parents and families"),
        ("fin", "Halal finance", .85, "people looking for halal finance and investing"),
    ],
}

TAGS = {
    "video": "video, editing, short-form clips or podcasts",
    "creator": "creators, influencers or personal brands",
    "b2b": "selling to businesses",
    "corporate": "corporate teams, employees or HR",
    "training": "courses, workshops, coaching or training",
    "social": "social connection, networking or community",
    "events": "events, meetups or gatherings",
    "remote": "remote work, cafés or coworking",
    "finance": "money, investing, payments, zakat or budgeting",
    "faith": "Islam, Qur'an, prayer, mosques or halal living",
    "family": "family, parenting, marriage or the home",
    "education": "students, schools or learning",
    "health": "health, fitness or wellness",
    "food": "food, restaurants or groceries",
    "travel": "travel, tours, Hajj or Umrah",
    "ai": "AI, LLMs or automation",
}

# Islamic-alignment flags. Output is a review flag, never a ruling.
FLAGS = [
    (r"\b(interest|riba|loan|lend|credit|bnpl|buy now pay later|mortgage)\b", "review", "Possible riba exposure in financing or payments"),
    (r"\b(gambl\w*|bet|bets|betting|casino|lottery|sweepstakes?)\b", "bad", "Gambling / maysir mechanics"),
    (r"\b(alcohol|wine|beer|bar|pub|pork)\b", "bad", "Haram product category"),
    (r"\b(crypto\w*|forex|options|day trad\w*|derivatives?)\b", "review", "Speculative instrument — gharar review"),
    (r"\b(dating|hookup)\b", "review", "Gender-interaction model needs review"),
    (r"\b(insurance)\b", "review", "Conventional insurance — consider takaful"),
    (r"\b(music|ads|advert|video|content|influencer)\b", "cond", "Depends on content and ad sources"),
]

ISLAMIC_ORDER = ["ok", "cond", "review", "bad"]  # least to most severe


def keyword_flags(text: str):
    hits = [(lvl, note) for rx, lvl, note in FLAGS if re.search(rx, text, re.I)]
    worst = max((lvl for lvl, _ in hits), key=ISLAMIC_ORDER.index, default="ok")
    return worst, [note for _, note in hits]
