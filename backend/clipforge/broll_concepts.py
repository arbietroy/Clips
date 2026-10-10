"""Topic-aware b-roll without AI.

Each concept pairs a stock-footage search that reliably returns good footage with the words that
clearly mean it. B-roll is only placed where one of those words is spoken, so footage always matches
what is being said. Everyday words ("time", "people", "world", "god", "love", "home", "video", "heart")
are deliberately left out, because they come up in any talk: no b-roll is better than the wrong b-roll.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class Concept:
    topic: str
    query: str                 # what we search for on Pixabay / Pexels
    triggers: frozenset[str]   # normalised words (singular) that mean this concept


def _c(topic: str, query: str, words: str) -> Concept:
    return Concept(topic, query, frozenset(words.split()))


CONCEPTS: list[Concept] = [
    # politics & society
    _c("politics", "voting ballot box", "vote voting voter ballot poll polling"),
    _c("politics", "election campaign crowd", "election electoral campaign candidate rally inec"),
    _c("politics", "government building", "government parliament senate congress assembly legislature ministry"),
    _c("politics", "politician speech podium", "politician president governor senator minister mayor prime"),
    _c("politics", "protest crowd", "protest protester demonstration riot activist march"),
    _c("politics", "democracy flag", "democracy democratic republic constitution citizen citizenship"),
    _c("politics", "politics debate", "politics political policy opposition"),
    _c("politics", "nigeria flag", "nigeria nigerian"),
    _c("politics", "leader speech podium", "leader leadership"),
    _c("politics", "lagos city", "lagos abuja"),
    _c("politics", "africa city", "africa african"),
    _c("law", "courtroom judge gavel", "court judge lawyer law legal justice lawsuit trial verdict"),
    _c("law", "police car lights", "police arrest crime criminal"),
    _c("politics", "bribe money corruption", "corruption corrupt bribe bribery fraud embezzlement"),
    _c("war", "soldiers military", "army soldier military war troop"),
    # money & work
    _c("money", "money cash counting", "money cash naira dollar salary income cheque"),
    _c("money", "stock market chart", "stock market investing investment investor trading shares crypto bitcoin"),
    _c("money", "saving piggy bank", "saving savings budget budgeting"),
    _c("money", "bank building", "bank banking loan debt credit mortgage"),
    _c("money", "economy inflation prices", "economy economic inflation recession price tax"),
    _c("business", "business meeting office", "business company startup entrepreneur ceo boss client"),
    _c("business", "office team working", "office team colleague employee coworker"),
    _c("business", "handshake deal", "partnership contract negotiation"),
    _c("business", "shopping store", "shop shopping store customer"),
    _c("work", "person typing laptop", "laptop typing computer"),
    _c("work", "job interview", "job interview hiring career resume unemployment unemployed"),
    _c("work", "factory workers", "factory worker manufacturing industry"),
    # technology
    _c("technology", "smartphone scrolling social media", "smartphone instagram tiktok facebook twitter whatsapp"),
    _c("technology", "coding programming screen", "code coding programming developer software"),
    _c("technology", "artificial intelligence robot", "robot artificial automation chatgpt"),
    _c("technology", "internet network data", "internet website"),
    _c("technology", "video camera filming", "camera filming youtube youtuber"),
    # education
    _c("education", "students classroom", "school student classroom teacher lesson pupil"),
    _c("education", "university campus graduation", "university college campus graduation graduate degree lecture"),
    _c("education", "reading books library", "book books library studying"),
    # health
    _c("health", "doctor hospital", "doctor hospital nurse patient clinic medical medicine"),
    _c("health", "workout gym fitness", "gym workout exercise fitness training muscle"),
    _c("health", "healthy food vegetables", "diet nutrition vegetable fruit"),
    _c("health", "meditation calm", "meditation meditate mindfulness anxiety depression"),
    _c("health", "sleeping bed", "sleeping insomnia"),
    # life
    _c("family", "family together", "family parent parents mother father children"),
    _c("family", "couple love", "relationship couple marriage wedding girlfriend boyfriend"),
    _c("family", "friends laughing", "friendship laughing"),
    _c("food", "cooking kitchen", "cook cooking kitchen recipe chef"),
    _c("food", "food restaurant", "food restaurant meal dinner lunch breakfast"),
    _c("home", "apartment rent", "apartment rent landlord"),
    _c("travel", "airplane travel", "travel travelling airport flight passport abroad"),
    _c("travel", "city traffic", "traffic"),
    _c("travel", "car driving", "driving vehicle"),
    _c("nature", "nature landscape", "forest mountain landscape"),
    _c("nature", "ocean beach waves", "ocean beach"),
    _c("nature", "climate change pollution", "climate pollution environment emission"),
    _c("nature", "farming agriculture", "farm farmer farming agriculture crop harvest"),
    _c("nature", "rain storm", "rainfall storm flood flooding"),
    # culture
    _c("culture", "church worship", "church pastor worship prayer religion"),
    _c("culture", "mosque prayer", "mosque muslim islam imam"),
    _c("culture", "concert music", "singer concert musician"),
    _c("culture", "football soccer", "football soccer stadium"),
    _c("culture", "basketball", "basketball nba"),
    _c("culture", "movie cinema", "movie cinema nollywood hollywood"),
    # kept only where the word is specific enough
    _c("ideas", "youth young people", "youth"),
]

_INDEX: dict[str, list[Concept]] = {}
for _concept in CONCEPTS:
    for _w in _concept.triggers:
        _INDEX.setdefault(_w, []).append(_concept)


def normalise(word: str) -> str:
    w = re.sub(r"[^a-z0-9]", "", word.lower())
    for suffix in ("ies", "es", "s"):
        if len(w) > 4 and w.endswith(suffix):
            stem = w[: -len(suffix)] + ("y" if suffix == "ies" else "")
            if stem in _INDEX:
                return stem
    return w


def concepts_in(words: list[str]) -> list[tuple[int, Concept]]:
    """(word position, concept) for every concept trigger in a list of words."""
    out = []
    for i, w in enumerate(words):
        for c in _INDEX.get(normalise(w), []):
            out.append((i, c))
    return out


def main_topics(all_words: list[str], top: int = 2) -> list[str]:
    counts = Counter(c.topic for _, c in concepts_in(all_words))
    return [t for t, _ in counts.most_common(top)]


def query_tokens(query: str) -> set[str]:
    return {normalise(t) for t in query.split()} | set(query.lower().split())
