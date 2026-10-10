"""Find b-roll footage and background music that fit the content."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from .broll_concepts import normalise, query_tokens

VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}

MOOD_SYNONYMS = {
    "upbeat": ["upbeat", "happy", "pop", "positive", "bright", "fun"],
    "inspirational": ["inspirational", "inspiring", "motivational", "uplifting", "epic", "cinematic"],
    "chill": ["chill", "lofi", "lo-fi", "calm", "relax", "ambient", "soft"],
    "dramatic": ["dramatic", "cinematic", "epic", "intense", "dark"],
    "emotional": ["emotional", "sad", "piano", "tender", "sentimental"],
    "energetic": ["energetic", "energy", "rock", "edm", "dance", "workout", "electronic"],
    "corporate": ["corporate", "business", "tech", "clean", "background"],
    "funny": ["funny", "comedy", "quirky", "playful", "silly"],
    "suspense": ["suspense", "tension", "mystery", "thriller", "dark"],
    "hiphop": ["hiphop", "hip-hop", "hip hop", "trap", "beat", "rap"],
}


def _tokens(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", s.lower()))


def _stable_pick(items: list[Path], key: str) -> Path:
    h = int(hashlib.md5(key.encode()).hexdigest(), 16)
    return sorted(items)[h % len(items)]


def find_music(mood: str, music_dir: Path, key: str = "") -> Path | None:
    """Pick a track whose folder or file name matches the mood.

    Organise the library like music/upbeat/track.mp3 or name files e.g. chill-lofi-01.mp3.
    """
    if not music_dir.exists():
        return None
    tracks = [p for p in music_dir.rglob("*") if p.suffix.lower() in AUDIO_EXT]
    if not tracks:
        return None
    words = MOOD_SYNONYMS.get(mood, [mood])
    scored = []
    for t in tracks:
        toks = _tokens(str(t.relative_to(music_dir)))
        score = sum(3 if i == 0 else 1 for i, w in enumerate(words) if _tokens(w) <= toks)
        scored.append((score, t))
    best = max(s for s, _ in scored)
    pool = [t for s, t in scored if s == best]
    return _stable_pick(pool, mood + key)


def find_broll(query: str, broll_dir: Path, cache_dir: Path, orientation: str, min_seconds: float,
               used: set[str], log, pexels_key: str | None = None, pixabay_key: str | None = None) -> Path | None:
    """Local library first (file names matched against the query), then Pexels, then Pixabay stock video."""
    q = _tokens(query)
    if broll_dir.exists():
        local = [p for p in broll_dir.rglob("*") if p.suffix.lower() in VIDEO_EXT]
        scored = sorted(((len(q & _tokens(p.stem)), p) for p in local), key=lambda x: -x[0])
        for score, p in scored:
            if score and str(p) not in used:
                return p
    for name, key, search in (("Pexels", pexels_key, _pexels), ("Pixabay", pixabay_key, _pixabay)):
        if not key:
            continue
        try:
            found = search(query, orientation, key, min_seconds)
        except Exception as e:
            log.warn(f"{name} search for '{query}' failed: {e}")
            continue
        for video_id, url, width in found:
            dest = cache_dir / f"{name.lower()}_{video_id}_{width}.mp4"
            if str(dest) not in used:
                _download(url, dest)
                return dest
    return None


def _download(url: str, dest: Path) -> None:
    import requests

    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        tmp = dest.with_suffix(".part")
        with open(tmp, "wb") as fh:
            for chunk in resp.iter_content(1 << 16):
                fh.write(chunk)
        tmp.replace(dest)


def _pexels(query: str, orientation: str, api_key: str, min_seconds: float) -> list[tuple[str, str, int]]:
    """Candidate (id, mp4 url, width) from Pexels, best first."""
    import requests

    r = requests.get(
        "https://api.pexels.com/videos/search",
        params={"query": query, "orientation": orientation, "per_page": 10, "size": "medium"},
        headers={"Authorization": api_key}, timeout=20,
    )
    r.raise_for_status()
    target_w = 1080 if orientation == "portrait" else 1920
    wanted = query_tokens(query)
    out = []
    for video in r.json().get("videos", []):
        if video.get("duration", 0) < min_seconds:
            continue
        # Pexels has no tags, but its page URL is a description ("/video/people-voting-at-a-booth-123/").
        slug = {normalise(t) for t in re.split(r"[-/]", video.get("url", "")) if t}
        if slug and not slug & wanted:
            continue
        files = [f for f in video.get("video_files", []) if f.get("file_type") == "video/mp4" and f.get("width")]
        if files:
            f = min(files, key=lambda f: abs(f["width"] - target_w) + (5000 if f["width"] < 640 else 0))
            out.append((str(video["id"]), f["link"], f["width"]))
    return out


def _pixabay(query: str, orientation: str, api_key: str, min_seconds: float) -> list[tuple[str, str, int]]:
    """Candidate (id, mp4 url, width) from Pixabay, best first. Pixabay has no orientation filter,
    so clips matching the wanted orientation are preferred and the rest are cropped when rendering."""
    import requests

    r = requests.get(
        "https://pixabay.com/api/videos/",
        params={"key": api_key, "q": query[:100], "per_page": 20, "safesearch": "true"},
        timeout=20,
    )
    r.raise_for_status()
    target_w = 1080 if orientation == "portrait" else 1920
    wanted = query_tokens(query)
    ranked = []
    for hit in r.json().get("hits", []):
        if hit.get("duration", 0) < min_seconds:
            continue
        tags = {normalise(t) for t in re.split(r"[,\s]+", hit.get("tags", "")) if t}
        if not tags & wanted:
            continue                      # search matched something unrelated: skip rather than show it
        sizes = [v for v in (hit.get("videos") or {}).values() if v.get("url") and v.get("width")]
        if not sizes:
            continue
        v = min(sizes, key=lambda v: abs(v["width"] - target_w) + (5000 if v["width"] < 640 else 0))
        portrait = v["height"] > v["width"]
        mismatch = portrait != (orientation == "portrait")
        ranked.append((mismatch, str(hit["id"]), v["url"], v["width"]))
    ranked.sort(key=lambda x: x[0])   # stable: keeps Pixabay's relevance order within each group
    return [(i, u, w) for _, i, u, w in ranked]
