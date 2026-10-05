"""Find b-roll footage and background music that fit the content."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

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


def find_broll(query: str, broll_dir: Path, cache_dir: Path, orientation: str, api_key: str | None,
               min_seconds: float, used: set[str], log) -> Path | None:
    """Local library first (file names matched against the query), then Pexels stock video."""
    q = _tokens(query)
    if broll_dir.exists():
        local = [p for p in broll_dir.rglob("*") if p.suffix.lower() in VIDEO_EXT]
        scored = sorted(((len(q & _tokens(p.stem)), p) for p in local), key=lambda x: -x[0])
        for score, p in scored:
            if score and str(p) not in used:
                return p
    if api_key:
        try:
            return _pexels(query, cache_dir, orientation, api_key, min_seconds, used)
        except Exception as e:
            log.warn(f"Pexels search for '{query}' failed: {e}")
    return None


def _pexels(query: str, cache_dir: Path, orientation: str, api_key: str, min_seconds: float,
            used: set[str]) -> Path | None:
    import requests

    r = requests.get(
        "https://api.pexels.com/videos/search",
        params={"query": query, "orientation": orientation, "per_page": 10, "size": "medium"},
        headers={"Authorization": api_key}, timeout=20,
    )
    r.raise_for_status()
    target_w = 1080 if orientation == "portrait" else 1920
    for video in r.json().get("videos", []):
        if video.get("duration", 0) < min_seconds:
            continue
        files = [f for f in video.get("video_files", []) if f.get("file_type") == "video/mp4" and f.get("width")]
        if not files:
            continue
        f = min(files, key=lambda f: abs(f["width"] - target_w) + (5000 if f["width"] < 640 else 0))
        dest = cache_dir / f"pexels_{video['id']}_{f['width']}.mp4"
        if str(dest) in used:
            continue
        if not dest.exists():
            cache_dir.mkdir(parents=True, exist_ok=True)
            with requests.get(f["link"], stream=True, timeout=60) as resp:
                resp.raise_for_status()
                tmp = dest.with_suffix(".part")
                with open(tmp, "wb") as fh:
                    for chunk in resp.iter_content(1 << 16):
                        fh.write(chunk)
                tmp.rename(dest)
        return dest
    return None
