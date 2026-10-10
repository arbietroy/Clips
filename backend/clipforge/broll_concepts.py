"""Topic-aware b-roll without AI.

Each concept has:
  triggers – words that clearly mean it when spoken (b-roll is only placed where one is said)
  searches – short stock-footage searches, most specific first (Pixabay matches *every* word of a
             search, so long phrases return nothing; one or two words work best)
  must     – tags a stock clip must carry to be used, so a search can never bring back something
             unrelated (a zebra for "Africa", flowers for "nature")

Everyday words ("time", "people", "world", "god", "love", "home", "video", "heart") are deliberately
not triggers: they come up in any talk. No b-roll is better than the wrong b-roll.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class Concept:
    topic: str
    label: str                 # stable name, stored in edit plans
    triggers: frozenset[str]
    searches: tuple[str, ...]
    must: frozenset[str]

    @property
    def query(self) -> str:    # what the rest of the app calls a b-roll "query"
        return self.label


def _c(topic: str, label: str, triggers: str, searches: str, must: str) -> Concept:
    return Concept(topic, label, frozenset(triggers.split()),
                   tuple(s.strip() for s in searches.split(",")), frozenset(must.split()))


CONCEPTS: list[Concept] = [
    # politics & society
    _c("politics", "voting", "vote voting voter ballot poll polling",
       "voting, election, ballot, vote", "vote voting voter ballot election poll"),
    _c("politics", "election", "election electoral campaign candidate rally inec",
       "election, voting, campaign, ballot", "election vote voting ballot campaign politics"),
    _c("politics", "government", "government parliament senate congress assembly legislature",
       "parliament, government, capitol", "government parliament capitol senate congress politics"),
    _c("politics", "politician", "politician president governor senator minister mayor",
       "politician, president, speech", "politician president politics speech conference"),
    _c("politics", "protest", "protest protester demonstration riot activist",
       "protest, demonstration", "protest demonstration riot activist march"),
    _c("politics", "democracy", "democracy democratic constitution citizen citizenship",
       "democracy, voting, election", "democracy vote voting election constitution"),
    _c("politics", "politics", "politics political policy opposition",
       "politics, parliament, election", "politics political parliament government election"),
    _c("politics", "corruption", "corruption corrupt bribe bribery fraud embezzlement",
       "bribe, corruption, money", "bribe bribery corruption fraud money cash"),
    _c("politics", "nigeria", "nigeria nigerian", "nigeria, lagos", "nigeria lagos"),
    _c("politics", "lagos", "lagos", "lagos, nigeria", "lagos nigeria"),
    _c("law", "court", "court judge lawyer lawsuit trial verdict justice",
       "court, judge, gavel, law", "court judge gavel law justice lawyer"),
    _c("law", "police", "police arrest crime criminal",
       "police, arrest", "police officer arrest crime"),
    _c("war", "military", "army soldier military troop",
       "soldier, military, army", "soldier military army"),
    # money & work
    _c("money", "money", "money cash naira dollar salary income cheque",
       "money, cash, banknotes", "money cash banknote dollar currency"),
    _c("money", "stock market", "stock investing investment investor trading shares crypto bitcoin",
       "stock market, trading, bitcoin", "stock trading market chart finance bitcoin crypto"),
    _c("money", "savings", "saving savings budget budgeting",
       "piggy bank, savings, money", "piggy saving savings money coin"),
    _c("money", "bank", "bank banking loan debt credit mortgage",
       "bank, banking", "bank banking finance"),
    _c("money", "economy", "economy economic inflation recession",
       "economy, finance, market", "economy finance market business"),
    _c("money", "prices", "price prices tax taxes",
       "market, shopping, prices", "market shopping price supermarket"),
    _c("business", "business", "business company startup entrepreneur ceo boss client",
       "business meeting, office, business", "business office meeting work team"),
    _c("business", "office", "office colleague employee coworker",
       "office, team work", "office work team business meeting"),
    _c("business", "shopping", "shop shopping store customer",
       "shopping, store", "shopping shop store mall"),
    _c("work", "laptop", "laptop typing computer",
       "laptop, computer, typing", "laptop computer typing keyboard"),
    _c("work", "job", "job interview hiring career resume unemployment unemployed",
       "job interview, office, work", "interview job office work business"),
    _c("work", "factory", "factory worker manufacturing industry",
       "factory, industry", "factory industry worker manufacturing"),
    # technology
    _c("technology", "social media", "smartphone instagram tiktok facebook twitter whatsapp",
       "smartphone, social media, phone", "smartphone phone mobile social"),
    _c("technology", "coding", "code coding programming developer software",
       "coding, programming", "code coding programming computer"),
    _c("technology", "robot", "robot artificial automation chatgpt",
       "robot, artificial intelligence, technology", "robot ai artificial technology"),
    _c("technology", "internet", "internet website",
       "internet, network, technology", "internet network technology digital"),
    _c("technology", "camera", "camera filming youtube youtuber",
       "camera, filming", "camera filming video recording"),
    # education
    _c("education", "school", "school student classroom teacher lesson pupil",
       "classroom, school, students", "school classroom student students teacher education"),
    _c("education", "university", "university college campus graduation graduate degree lecture",
       "graduation, university", "graduation university college campus student"),
    _c("education", "books", "book books library studying",
       "books, library, reading", "book books library reading"),
    # health
    _c("health", "hospital", "doctor hospital nurse patient clinic medical medicine",
       "hospital, doctor", "hospital doctor medical nurse health"),
    _c("health", "fitness", "gym workout exercise fitness training muscle",
       "workout, gym, fitness", "workout gym fitness exercise sport"),
    _c("health", "healthy food", "diet nutrition vegetable vegetables fruit",
       "vegetables, fruit, salad", "vegetable vegetables fruit salad healthy food"),
    _c("health", "meditation", "meditation meditate mindfulness anxiety depression",
       "meditation, relax", "meditation meditate yoga relax"),
    # life
    _c("family", "family", "family parent parents mother father children",
       "family, parents, children", "family parent parents mother father child children"),
    _c("family", "wedding", "relationship couple marriage wedding girlfriend boyfriend",
       "couple, wedding", "couple wedding marriage love"),
    _c("food", "cooking", "cook cooking kitchen recipe chef",
       "cooking, kitchen", "cooking cook kitchen chef food"),
    _c("food", "food", "food restaurant meal dinner lunch breakfast",
       "food, restaurant, meal", "food restaurant meal dinner eating"),
    _c("home", "rent", "apartment rent landlord",
       "apartment, house, building", "apartment house building home real"),
    _c("travel", "travel", "travel travelling airport flight passport abroad",
       "airport, airplane, travel", "airport airplane plane travel flight"),
    _c("travel", "traffic", "traffic", "traffic, cars, road", "traffic car cars road street"),
    _c("travel", "driving", "driving vehicle", "driving, car", "driving car road"),
    _c("nature", "climate", "climate pollution environment emission",
       "pollution, climate", "pollution climate smoke environment"),
    _c("nature", "farming", "farm farmer farming agriculture crop harvest",
       "farm, agriculture, harvest", "farm agriculture farmer harvest field crop"),
    _c("nature", "flood", "rainfall storm flood flooding",
       "flood, storm, rain", "flood storm rain water"),
    # culture
    _c("culture", "church", "church pastor worship prayer religion",
       "church, worship", "church worship religion christian"),
    _c("culture", "mosque", "mosque muslim islam imam", "mosque, muslim", "mosque muslim islam"),
    _c("culture", "concert", "singer concert musician", "concert, singer", "concert singer music stage"),
    _c("culture", "football", "football soccer stadium", "football, soccer", "football soccer stadium ball"),
    _c("culture", "basketball", "basketball nba", "basketball", "basketball"),
    _c("culture", "cinema", "movie cinema nollywood hollywood", "cinema, movie", "cinema movie film theater"),
    _c("ideas", "youth", "youth", "young people, students", "young youth student students teenager"),
]

BY_LABEL: dict[str, Concept] = {c.label: c for c in CONCEPTS}
_INDEX: dict[str, list[Concept]] = {}
for _concept in CONCEPTS:
    for _w in _concept.triggers:
        _INDEX.setdefault(_w, []).append(_concept)

# Words that say nothing about what footage should show; never enough on their own to accept a clip.
_GENERIC_TAGS = {"people", "person", "man", "woman", "background", "city", "nature", "beautiful", "day",
                 "life", "time", "world", "concept", "abstract", "video", "stock", "free", "hd", "the", "and",
                 "of", "a", "in", "on", "young", "africa", "african"}


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


def search_plan(query: str) -> tuple[list[str], set[str]]:
    """What to search for and which tags a result must have, for a b-roll cue.

    Known concepts use their curated searches; free-text queries (e.g. from Claude) search the
    phrase, then its meaningful words one by one, and require one of those words as a tag.
    """
    concept = BY_LABEL.get(query)
    if concept:
        return list(concept.searches), set(concept.must)
    words = [w for w in re.findall(r"[a-z]+", query.lower()) if w not in _GENERIC_TAGS and len(w) > 2]
    searches = [query] + [w for w in words if w != query]
    return searches, {normalise(w) for w in words} | set(words)


def tags_match(tags_text: str, must: set[str]) -> bool:
    """True when a stock clip's tags include one of the required subject words."""
    tags: set[str] = set()
    for part in re.split(r"[,/|]+", tags_text.lower()):
        part = part.strip()
        if not part:
            continue
        tags.add(part)
        for w in re.findall(r"[a-z0-9]+", part):
            tags.add(w)
            tags.add(normalise(w))
    return bool(tags & must)
