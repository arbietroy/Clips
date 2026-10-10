"""Turn a span of words into tight "keep" segments.

Removes filler words, stutters and repeated phrases, the extra ranges the analyser
flagged (retakes, rambling), and shortens long pauses.
"""

from __future__ import annotations

from .transcript import Word

FILLERS = {"um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "hm", "mm", "mhm", "eh"}
AGGRESSIVE_PHRASES = [("you", "know"), ("i", "mean"), ("kind", "of"), ("sort", "of")]
AGGRESSIVE_WORDS = {"like", "basically", "literally", "actually"}


def find_removals(words: list[Word], fillers: bool = True, repetition: bool = True,
                  aggressive: bool = False, retakes: bool = True) -> set[int]:
    """Return indices of words to drop."""
    drop: set[int] = set()
    norms = [w.norm for w in words]

    if fillers:
        for i, n in enumerate(norms):
            if n in FILLERS:
                drop.add(i)
        if aggressive:
            for i in range(len(norms) - 1):
                if (norms[i], norms[i + 1]) in AGGRESSIVE_PHRASES and words[i + 1].text.rstrip().endswith(","):
                    drop.update((i, i + 1))
            for i, n in enumerate(norms):
                # "like," / "basically," used as a verbal tic (followed by a comma)
                if n in AGGRESSIVE_WORDS and words[i].text.rstrip().endswith(","):
                    drop.add(i)

    if repetition:
        kept = [i for i in range(len(words)) if i not in drop]
        # Repeated n-grams said back to back ("so what I, so what I want") – drop the first take.
        for n in (4, 3, 2, 1):
            j = 0
            while j + 2 * n <= len(kept):
                a = [norms[k] for k in kept[j:j + n]]
                b = [norms[k] for k in kept[j + n:j + 2 * n]]
                # A repeat after a full stop is deliberate ("Never give up. Never give up."): keep it.
                emphatic = n > 1 and words[kept[j + n - 1]].text.rstrip().endswith((".", "!", "?"))
                if a == b and all(a) and not emphatic and not (n == 1 and a[0] in {"no", "very", "really", "so", "bye", "ha"}):
                    drop.update(kept[j:j + n])
                    kept = kept[:j] + kept[j + n:]
                    continue
                j += 1
        # Cut-off words: whisper often marks false starts with a trailing dash ("thin- think").
        for i, w in enumerate(words):
            if w.text.endswith(("-", "—")) and i not in drop:
                drop.add(i)
    if retakes:
        drop |= find_offscript(words, drop)
        drop |= find_cued_retakes(words, drop)
        drop |= find_retakes(words, drop)
        drop |= find_rephrased_retakes(words, drop)
    return drop


# Things people say when they mess up a take and go again. Matched on normalised words.
RETAKE_CUES = [
    "let me start again", "let me start over", "let me start that again", "let me restart", "start again",
    "start over", "let me redo", "let me redo that", "let me do that again", "let me do it again",
    "let me take that again", "let me take it again", "let me say that again", "let me say it again",
    "let me try that again", "let me try again", "let me go again", "let me rephrase", "let me rephrase that",
    "lets do that again", "lets go again", "lets start again", "lets try again", "lets take that again",
    "one more time", "take two", "take 2", "from the top", "scratch that", "cut cut", "cut that",
    "i messed up", "i messed that up", "i made a mistake", "oh my god stop", "oh my gosh stop",
    "wait wait", "hold on hold on", "sorry sorry", "sorry again", "no no no", "stop stop",
    "i dont want to say that", "i dont want to say it like that", "i shouldnt say that", "dont put that",
    "dont use that", "dont use this", "edit that out", "edit this out", "cut that out", "cut this out",
    "cut this part", "remove that part", "lets not say that", "forget that", "forget i said that",
    "that came out wrong", "thats not what i meant", "let me fix that", "let me correct that", "oh stop",
]
# These also occur in normal speech ("we will start again next year"), so they only count as a cue
# when they open a phrase.
_AMBIGUOUS_CUES = {("start", "again"), ("start", "over"), ("one", "more", "time"), ("from", "the", "top"),
                   ("take", "two"), ("take", "2"), ("cut", "that"), ("no", "no", "no"), ("forget", "that"),
                   ("oh", "stop")}
_CUES = sorted((tuple(c.split()) for c in RETAKE_CUES), key=len, reverse=True)
_SOFT_LEADS = {"oh", "my", "god", "gosh", "okay", "ok", "sorry", "wait", "no", "stop", "hold", "on", "so",
               "alright", "right", "um", "uh", "hmm", "ah", "jeez", "damn", "shoot", "cut"}


def find_cued_retakes(words: list[Word], already: set[int] | None = None,
                      max_back_s: float = 25.0) -> set[int]:
    """Cut takes the speaker called off out loud ("oh my God, stop, let me start again").

    Removes the cue (plus the exclamations around it) and the attempt it abandons: back to where the
    speaker restarts from if the next words repeat earlier ones, otherwise back to the start of the
    sentence that was cut off.
    """
    already = already or set()
    kept = [i for i in range(len(words)) if i not in already]
    norms = [words[i].norm.replace("'", "") for i in kept]
    drop: set[int] = set()

    def sentence_start(pos: int) -> int:
        """Index (in kept) of the first word of the sentence containing kept[pos]."""
        p = pos
        while p > 0:
            prev, cur = words[kept[p - 1]], words[kept[p]]
            if prev.text.rstrip().endswith((".", "!", "?")) or cur.start - prev.end > 1.2:
                break
            p -= 1
        return p

    p = 0
    while p < len(kept):
        cue = next((c for c in _CUES if tuple(norms[p:p + len(c)]) == c), None)
        if cue in _AMBIGUOUS_CUES and p > 0:
            prev, cur = words[kept[p - 1]], words[kept[p]]
            opens = (prev.text.rstrip().endswith((".", ",", "!", "?", ";", ":")) or cur.start - prev.end > 0.4
                     or norms[p - 1] in _SOFT_LEADS)
            if not opens:
                cue = None
        if not cue:
            p += 1
            continue
        a, b = p, p + len(cue)                       # cue spans kept[a:b]
        while a > 0 and norms[a - 1] in _SOFT_LEADS and words[kept[a]].start - words[kept[a - 1]].end < 1.5:
            a -= 1                                   # "oh my god, stop, ..." before the cue
        while b < len(kept) and norms[b] in _SOFT_LEADS - {"so"}:
            b += 1                                   # "... okay, alright" after it
        # Where does the abandoned attempt begin?
        start = None
        nxt = norms[b:b + 3]
        if len(nxt) >= 2:
            for q in range(a - 1, -1, -1):
                if words[kept[a]].start - words[kept[q]].start > max_back_s:
                    break
                if norms[q:q + 2] == nxt[:2]:
                    start = q                        # they restart from here: cut the earlier try
                    s0 = sentence_start(q)           # ...and any "okay, so" that led into it
                    while start > s0 and norms[start - 1] in _SOFT_LEADS:
                        start -= 1
                    break
        if start is None:
            s0 = sentence_start(a)
            # The cue opens a new sentence: the attempt being redone is the previous sentence.
            start = sentence_start(s0 - 1) if s0 == a and a > 0 else s0
        if words[kept[a]].start - words[kept[start]].start > max_back_s:
            start = a                                # never cut a long stretch on a guess
        drop.update(kept[start:b])
        p = b
    return drop


# Talk aimed at the crew or at themselves, not at the audience.
OFFSCRIPT_PHRASES = [
    "is it recording", "are we recording", "is this recording", "is it on", "is the camera on", "are we rolling",
    "is it rolling", "can you hear me", "can you see me", "is my mic on", "is the mic on", "is this okay",
    "was that okay", "was that good", "is that good", "how was that", "was that fine", "should i start",
    "can i start", "when do i start", "do i start now", "should i go", "are you ready", "are we ready",
    "what was i saying", "where was i", "what am i saying", "i forgot what i was saying", "i forgot my line",
    "i forgot my lines", "i dont remember", "give me a second", "give me a minute", "give me one second",
    "one second", "one sec", "let me check my notes", "let me see my notes", "let me check", "hold on",
    "okay lets go", "alright lets go", "ok lets go", "lets go again", "stop recording", "turn it off",
    "you can cut this", "you can cut that", "you can edit this", "you can edit that", "we can edit this",
    "we can cut this", "and action", "action", "three two one", "3 2 1", "testing testing", "mic check",
]
_EMPTY_WORDS = {"okay", "ok", "alright", "right", "so", "yeah", "um", "uh", "umm", "well", "anyway", "hmm",
                "sorry", "erm", "ah", "oh", ""}
_OFFSCRIPT = sorted((tuple(p.split()) for p in OFFSCRIPT_PHRASES), key=len, reverse=True)


def _sentences(words: list[Word], kept: list[int]) -> list[list[int]]:
    """Group kept word indices into sentences (punctuation or a pause of over a second)."""
    out: list[list[int]] = []
    cur: list[int] = []
    for i in kept:
        if cur:
            prev = words[cur[-1]]
            if prev.text.rstrip().endswith((".", "!", "?")) or words[i].start - prev.end > 1.0:
                out.append(cur)
                cur = []
        cur.append(i)
    if cur:
        out.append(cur)
    return out


def find_offscript(words: list[Word], already: set[int] | None = None, max_len: int = 12) -> set[int]:
    """Drop short sentences spoken to the crew or to oneself ("is it recording?", "where was I?",
    "okay let's go"). In a longer sentence only the phrase itself goes."""
    already = already or set()
    kept = [i for i in range(len(words)) if i not in already]
    drop: set[int] = set()
    for sent in _sentences(words, kept):
        norms = [words[i].norm.replace("'", "") for i in sent]
        if len(norms) <= 3 and all(n in _EMPTY_WORDS for n in norms):
            drop.update(sent)             # "Okay." / "Alright, so." on its own says nothing
            continue
        for p in range(len(norms)):
            hit = next((c for c in _OFFSCRIPT if tuple(norms[p:p + len(c)]) == c), None)
            if not hit:
                continue
            if hit in (("action",), ("hold", "on"), ("one", "second")) and len(sent) > 4:
                continue          # common in normal speech; only a cue when it stands alone
            if len(sent) <= max_len:
                drop.update(sent)
            else:
                drop.update(sent[p:p + len(hit)])
            break
    return drop


_STOP = set("""a an the and or but so to of in on at by for with from is are was were be been am i you he she it we
they me him her us them my your his its our their this that these those there here what which who when where why
how all any not no do does did have has had will would can could should just very really like um uh okay ok yeah
well also then now one get got going gonna""".split())


def find_rephrased_retakes(words: list[Word], already: set[int] | None = None, window_s: float = 40.0,
                           min_words: int = 4, overlap: float = 0.6) -> set[int]:
    """A sentence said again shortly after in slightly different words: keep only the last version.

        "Voting is the most important thing we can do."  …  "Voting is the most important thing you can do."
    """
    already = already or set()
    kept = [i for i in range(len(words)) if i not in already]
    sents = _sentences(words, kept)
    content = [[words[i].norm for i in s if words[i].norm and words[i].norm not in _STOP] for s in sents]
    drop: set[int] = set()
    for a, sa in enumerate(sents):
        ca = content[a]
        if len(ca) < min_words:
            continue
        for b in range(a + 1, min(a + 4, len(sents))):
            if words[sents[b][0]].start - words[sa[0]].start > window_s:
                break
            cb = content[b]
            if len(cb) < min_words * 0.75 or ca[0] != cb[0]:
                continue
            shared = len(set(ca) & set(cb)) / len(set(ca))
            if shared >= overlap:
                drop.update(sa)
                break
    return drop


ABANDON_MARKS = ("...", "…", "-", "—")


def find_retakes(words: list[Word], already: set[int] | None = None, max_gap_s: float = 15.0,
                 max_take_words: int = 30) -> set[int]:
    """Find false starts and retakes: the speaker begins a sentence, then starts it again.

        "So today I want to... so today I want to talk about money"  ->  cut the first attempt
        "Let me explain this. Let me explain this."                  ->  cut the first sentence

    Works on the transcript alone (no AI). A first attempt is only cut when it is repeated almost
    word for word within a few seconds and it wasn't a finished clause, so deliberate repetition
    ("we will fight on the beaches, we will fight on the seas") is kept.
    """
    already = already or set()
    kept = [i for i in range(len(words)) if i not in already]
    norms = [words[i].norm for i in kept]
    drop: set[int] = set()
    a = 0
    def phrase_start(pos: int) -> bool:
        if pos == 0 or kept[pos - 1] != kept[pos] - 1:      # first word, or right after a cut
            return True
        prev, cur = words[kept[pos - 1]], words[kept[pos]]
        return prev.text.rstrip().endswith((".", ",", "!", "?", ";", ":") + ABANDON_MARKS) or cur.start - prev.end > 0.25

    while a < len(kept):
        cut_to = None
        if not phrase_start(a):
            a += 1
            continue
        for b in range(a + 2, min(a + max_take_words + 1, len(kept))):
            if words[kept[b]].start - words[kept[a]].start > max_gap_s:
                break
            k = 0
            while b + k < len(kept) and a + k < b and norms[a + k] and norms[a + k] == norms[b + k]:
                k += 1
            take = b - a                      # words in the first attempt
            if k < 3:
                continue
            last = words[kept[b - 1]].text.strip()
            finished = last.endswith((".", ",", "!", "?", ";", ":")) and not last.endswith(ABANDON_MARKS)
            whole_repeat = k == take and k >= 4      # the whole first attempt is said again
            restart = k >= 3 and take - k <= 2 and not finished
            if whole_repeat or restart:
                cut_to = b
                break
        if cut_to is not None:
            drop.update(kept[a:cut_to])
            a = cut_to
        else:
            a += 1
    return drop


def keep_segments(words: list[Word], start: float, end: float, drop: set[int] | None = None,
                  extra_cuts: list[tuple[float, float]] | None = None, max_pause: float = 0.45,
                  pad: float = 0.12, min_len: float = 0.3) -> list[tuple[float, float]]:
    """Compute the source ranges to keep for the window [start, end]."""
    drop = drop or set()
    extra_cuts = extra_cuts or []

    def cut_out(w: Word) -> bool:
        mid = (w.start + w.end) / 2
        return any(a <= mid <= b for a, b in extra_cuts)

    flags = [(w, i in drop or cut_out(w)) for i, w in enumerate(words) if w.start >= start - 1e-3 and w.end <= end + 1e-3]
    if not flags:
        return [(start, end)] if end > start else []

    segs: list[list[float]] = []
    prev_kept: Word | None = None
    removed_since = False
    last_removed_end = start
    for w, removed in flags:
        if removed:
            removed_since = True
            last_removed_end = w.end
            if segs and prev_kept is not None:
                segs[-1][1] = min(segs[-1][1], w.start)
            continue
        lo = max(w.start - pad, start)
        if removed_since:
            lo = max(lo, last_removed_end)
        if prev_kept is None or removed_since or w.start - prev_kept.end > max_pause:
            if segs:
                lo = max(lo, segs[-1][1])
            segs.append([lo, min(w.end + pad, end)])
        else:
            segs[-1][1] = min(w.end + pad, end)
        prev_kept = w
        removed_since = False

    # Tighten a trailing segment against the next removed word (handled above) and merge
    # pieces that touch or are too small to be worth a cut.
    merged: list[list[float]] = []
    for s in segs:
        if s[1] - s[0] <= 0:
            continue
        if merged and s[0] - merged[-1][1] < 0.04:
            merged[-1][1] = max(merged[-1][1], s[1])
        else:
            merged.append(list(s))
    merged = [m for m in merged if m[1] - m[0] >= min_len] or merged[:1]
    return [(round(a, 3), round(b, 3)) for a, b in merged]


class Timeline:
    """Maps source time to output time for an ordered list of kept segments."""

    def __init__(self, segments: list[tuple[float, float]], fps: int):
        self.fps = fps
        snapped = []
        for a, b in segments:
            a2, b2 = round(a * fps) / fps, round(b * fps) / fps
            if b2 - a2 >= 1 / fps:
                snapped.append((a2, b2))
        self.segments = snapped
        self.offsets = []
        t = 0.0
        for a, b in snapped:
            self.offsets.append(t)
            t += b - a
        self.duration = t

    def to_out(self, t: float, clamp: bool = False, tol: float = 1e-6) -> float | None:
        for (a, b), off in zip(self.segments, self.offsets):
            if a - tol <= t <= b + tol:
                return off + min(max(t, a), b) - a
        if not clamp:
            return None
        for (a, _b), off in zip(self.segments, self.offsets):
            if t < a:
                return off
        return self.duration

    def boundary(self, i: int) -> float:
        """Output time of the cut after segment i."""
        return self.offsets[i] + self.segments[i][1] - self.segments[i][0]

    def map_words(self, words: list[Word]) -> list[Word]:
        """Words that survive the cut (mostly inside one kept segment), in output time."""
        out = []
        for w in words:
            length = max(w.end - w.start, 1e-3)
            for (a, b), off in zip(self.segments, self.offsets):
                overlap = min(b, w.end) - max(a, w.start)
                if overlap >= 0.6 * length:
                    s, e = max(w.start, a), min(w.end, b)
                    out.append(Word(off + s - a, off + e - a, w.text, w.prob))
                    break
        return out
