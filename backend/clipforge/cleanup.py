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
        drop |= find_retakes(words, drop)
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
