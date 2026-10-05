"""Find viral moments and plan the edit (b-roll, music mood, emphasis, chapters, retakes).

Uses Claude when an API key is available, otherwise a keyword/structure heuristic.
"""

from __future__ import annotations

import json
import os
import re
from collections import Counter
from dataclasses import asdict, dataclass, field

from .config import MOODS, TRANSITIONS, Settings
from .transcript import Transcript


@dataclass
class ClipIdea:
    start: float
    end: float
    title: str
    hook_text: str
    virality_score: int
    reason: str
    music_mood: str = "upbeat"


@dataclass
class BrollIdea:
    start: float
    end: float
    query: str


@dataclass
class Analysis:
    summary: str
    music_mood: str
    clips: list[ClipIdea]
    chapters: list[dict]          # {"start": float, "title": str}
    broll: list[BrollIdea]
    emphasis: list[float]         # source times worth a punch-in zoom
    remove: list[dict]            # {"start", "end", "reason"} – retakes, rambling, dead air
    transition_style: str = "fade"
    source: str = "heuristic"
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Analysis":
        return cls(
            summary=d.get("summary", ""),
            music_mood=d.get("music_mood", "upbeat"),
            clips=[ClipIdea(**c) for c in d.get("clips", [])],
            chapters=d.get("chapters", []),
            broll=[BrollIdea(**b) for b in d.get("broll", [])],
            emphasis=d.get("emphasis", []),
            remove=d.get("remove", []),
            transition_style=d.get("transition_style", "fade"),
            source=d.get("source", "heuristic"),
            extra=d.get("extra", {}),
        )


# ---------------------------------------------------------------------------
# Claude
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a senior video editor who cuts long-form videos (podcasts, interviews, talking-head \
videos, lectures, vlogs) into viral short-form clips for TikTok, Instagram Reels and YouTube Shorts, and also \
polishes the full long-form edit.

You receive a timestamped transcript. Every line is `[start-end] text`, times in seconds from the start of the \
source video. Use these timestamps exactly; never invent times outside the video.

What makes a strong short:
- The first 3 seconds hook the viewer: a bold claim, a surprising number, a question, conflict, or a strong emotion.
- It is self-contained. A viewer who never saw the full video understands it: no dangling "as I said earlier", \
no references to things outside the clip.
- It has a payoff: a punchline, insight, story resolution, or actionable takeaway, and it ends right after it.
- It starts at the beginning of a sentence and ends at the end of one.
- Prefer moments that are emotional, contrarian, funny, practical, or quotable.

Score honestly; a score above 85 should be rare."""

USER_TEMPLATE = """Video length: {duration:.0f} seconds.

Plan the edit:
1. `clips`: the {n} best moments for shorts, best first, non-overlapping. Each should be {min_s:.0f}-{max_s:.0f} \
seconds long (aim for about {target:.0f}). `hook_text` is a short, punchy on-screen title (max 8 words, no \
hashtags) shown during the first seconds. `music_mood` is the background music mood for that clip.
2. `chapters`: topic changes across the whole video, each with a 2-5 word title. The first chapter starts at 0.
3. `broll`: moments where stock footage would illustrate what is said (concrete nouns, places, actions, \
concepts), for both the long edit and the clips. 2-5 seconds each, at most {broll_per_min:.0f} per minute. \
`query` is a 1-3 word stock-footage search term (e.g. "city skyline", "typing laptop", "money").
4. `emphasis`: times (seconds) of the strongest single words or punchlines that deserve a quick zoom-in. \
At most one every 8 seconds.
5. `remove`: ranges to cut from the long edit because they are retakes (the speaker restarts a sentence), \
repeated points, off-topic rambling, or technical interruptions. Only cut when confident; keep the remaining \
speech coherent.
6. `music_mood` for the full video and `transition_style` for chapter transitions.

Transcript:
{transcript}"""


def _schema() -> dict:
    num, string = {"type": "number"}, {"type": "string"}

    def obj(props: dict) -> dict:
        return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}

    return obj({
        "summary": string,
        "music_mood": {"type": "string", "enum": MOODS},
        "transition_style": {"type": "string", "enum": TRANSITIONS},
        "clips": {"type": "array", "items": obj({
            "start": num, "end": num, "title": string, "hook_text": string,
            "virality_score": {"type": "integer"}, "reason": string,
            "music_mood": {"type": "string", "enum": MOODS},
        })},
        "chapters": {"type": "array", "items": obj({"start": num, "title": string})},
        "broll": {"type": "array", "items": obj({"start": num, "end": num, "query": string})},
        "emphasis": {"type": "array", "items": num},
        "remove": {"type": "array", "items": obj({"start": num, "end": num, "reason": string})},
    })


def _format_transcript(tr: Transcript) -> str:
    return "\n".join(f"[{s.start:.1f}-{s.end:.1f}] {s.text}" for s in tr.segments)


def analyze_with_claude(tr: Transcript, settings: Settings, log) -> Analysis:
    import anthropic

    client = anthropic.Anthropic()
    prompt = USER_TEMPLATE.format(
        duration=tr.duration, n=settings.num_clips, min_s=settings.clip_min_seconds,
        max_s=settings.clip_max_seconds, target=settings.clip_target_seconds,
        broll_per_min=settings.max_broll_per_minute, transcript=_format_transcript(tr),
    )
    log.info(f"Asking Claude ({settings.claude_model}) to find viral moments and plan the edit…")
    with client.beta.messages.stream(
        model=settings.claude_model,
        max_tokens=64000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        thinking={"type": "adaptive"},
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": _schema()}},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        msg = stream.get_final_message()

    if msg.stop_reason == "refusal":
        raise RuntimeError("Claude declined to analyse this transcript")
    if msg.stop_reason == "max_tokens":
        raise RuntimeError("Claude's response was cut off (max_tokens)")
    text = next(b.text for b in msg.content if b.type == "text")
    data = json.loads(text)
    data["source"] = f"claude:{msg.model}"
    return Analysis.from_dict(data)


# ---------------------------------------------------------------------------
# Heuristic fallback
# ---------------------------------------------------------------------------

HOOK_WORDS = {
    "secret", "never", "always", "mistake", "truth", "biggest", "worst", "best", "nobody", "everyone",
    "why", "how", "stop", "money", "million", "crazy", "insane", "shocking", "actually", "wrong",
    "lie", "hate", "love", "afraid", "fear", "changed", "realized", "lesson", "rich", "broke", "fail",
    "failed", "success", "important", "problem", "simple", "hack", "warning", "story", "first",
}
STOPWORDS = set("""a an the and or but if then so to of in on at by for with about from into over after
before is are was were be been being am i you he she it we they me him her us them my your his its our their
this that these those there here what which who whom whose when where why how all any both each few more most
other some such no nor not only own same than too very can will just don't should now do does did doing have
has had having would could also really thing things like know mean yeah okay right um uh gonna going get got
because just well want one lot kind sort way people say said think make made much even back still""".split())


def analyze_heuristic(tr: Transcript, settings: Settings, log) -> Analysis:
    log.info("Planning the edit with the built-in heuristic (set ANTHROPIC_API_KEY for AI clip selection)…")
    segs = tr.segments
    candidates = []
    for i, s in enumerate(segs):
        j, end = i, s.end
        while j + 1 < len(segs) and segs[j + 1].end - s.start <= settings.clip_max_seconds:
            j += 1
            end = segs[j].end
            if end - s.start >= settings.clip_target_seconds:
                break
        length = end - s.start
        if length < settings.clip_min_seconds * 0.8:
            continue
        words = [w.norm for w in tr.words_between(s.start, end)]
        opening = [w.norm for w in tr.words_between(s.start, s.start + 6)]
        text = " ".join(x.text for x in segs[i:j + 1])
        score = (
            3 * sum(w in HOOK_WORDS for w in opening)
            + sum(w in HOOK_WORDS for w in words) * 0.5
            + 2 * text.count("?") + 1.5 * text.count("!")
            + 1.5 * len(re.findall(r"\d", text[:200]))
            + 0.3 * sum(w in {"you", "your"} for w in words)
            + 0.02 * len(words)  # denser speech tends to perform better
        )
        candidates.append((score, s.start, end, text))

    candidates.sort(reverse=True)
    clips: list[ClipIdea] = []
    for score, a, b, text in candidates:
        if any(not (b <= c.start or a >= c.end) for c in clips):
            continue
        hook = _hook_from(text)
        clips.append(ClipIdea(a, b, hook, hook, int(min(95, 40 + score * 3)), "Heuristic: hook words, questions and pace"))
        if len(clips) >= settings.num_clips:
            break

    # Chapters at long pauses, roughly every 3-6 minutes.
    chapters = [{"start": 0.0, "title": _title_from(segs[0].text) if segs else "Intro"}]
    for prev, s in zip(segs, segs[1:]):
        if s.start - chapters[-1]["start"] > 180 and s.start - prev.end > 0.9:
            chapters.append({"start": s.start, "title": _title_from(s.text)})

    broll, emphasis = [], []
    last_b, last_e = -999.0, -999.0
    gap = 60.0 / max(settings.max_broll_per_minute, 0.1) * 1.5
    for s in segs:
        if s.start - last_b >= gap and s.end - s.start >= 2.5:
            kw = _keyword(s.text)
            if kw:
                broll.append(BrollIdea(s.start + 0.3, min(s.end, s.start + 3.5), kw))
                last_b = s.start
        for w in tr.words_between(s.start, s.end):
            if (w.norm in HOOK_WORDS or w.text.endswith("!")) and w.start - last_e >= 8:
                emphasis.append(w.start)
                last_e = w.start

    return Analysis(
        summary="", music_mood="upbeat", clips=clips, chapters=chapters, broll=broll,
        emphasis=emphasis, remove=[], transition_style="fade", source="heuristic",
    )


def _hook_from(text: str) -> str:
    first = re.split(r"(?<=[.?!])\s", text.strip())[0]
    words = first.split()
    return " ".join(words[:8]).rstrip(",.;:") + ("…" if len(words) > 8 else "")


def _title_from(text: str) -> str:
    kws = [w for w in re.findall(r"[A-Za-z']+", text) if w.lower() not in STOPWORDS and len(w) > 3]
    return " ".join(kws[:3]).title() or "Next"


def _keyword(text: str) -> str | None:
    words = [w.lower() for w in re.findall(r"[A-Za-z]+", text) if len(w) > 4 and w.lower() not in STOPWORDS]
    if not words:
        return None
    return Counter(words).most_common(1)[0][0]


# ---------------------------------------------------------------------------


def analyze(tr: Transcript, settings: Settings, log) -> Analysis:
    has_creds = any(os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"))
    if settings.use_claude and has_creds:
        try:
            result = analyze_with_claude(tr, settings, log)
        except Exception as e:  # network, auth, refusal… never block the edit
            log.warn(f"Claude analysis failed ({e}); using heuristic instead")
            result = analyze_heuristic(tr, settings, log)
    else:
        result = analyze_heuristic(tr, settings, log)
    return sanitize(result, tr, settings)


def sanitize(a: Analysis, tr: Transcript, settings: Settings) -> Analysis:
    """Clamp times, snap clips to sentence boundaries, drop junk."""
    dur = tr.duration or (tr.words[-1].end if tr.words else 0)
    starts = [s.start for s in tr.segments] or [0.0]
    ends = [s.end for s in tr.segments] or [dur]

    def snap(t: float, options: list[float], window: float = 2.5) -> float:
        best = min(options, key=lambda x: abs(x - t))
        return best if abs(best - t) <= window else t

    clips = []
    for c in sorted(a.clips, key=lambda c: -c.virality_score):
        s = max(0.0, snap(c.start, starts))
        e = min(dur, snap(c.end, ends))
        if e - s < 5:
            continue
        if e - s > settings.clip_max_seconds + 15:
            e = s + settings.clip_max_seconds
        if any(not (e <= x.start or s >= x.end) for x in clips):
            continue
        c.start, c.end = round(s, 3), round(e, 3)
        c.music_mood = c.music_mood if c.music_mood in MOODS else a.music_mood
        clips.append(c)
    a.clips = clips[: settings.num_clips]
    a.music_mood = a.music_mood if a.music_mood in MOODS else "upbeat"
    a.transition_style = a.transition_style if a.transition_style in TRANSITIONS else "fade"
    a.broll = [b for b in a.broll if 0 <= b.start < b.end <= dur + 1 and b.query.strip()]
    for b in a.broll:
        b.end = min(b.end, b.start + 6)
    a.emphasis = sorted(t for t in a.emphasis if 0 <= t <= dur)
    a.remove = [r for r in a.remove if 0 <= r["start"] < r["end"] <= dur + 1 and r["end"] - r["start"] < 120]
    chapters = sorted((c for c in a.chapters if 0 <= c["start"] < dur), key=lambda c: c["start"])
    a.chapters = chapters or [{"start": 0.0, "title": "Intro"}]
    return a
