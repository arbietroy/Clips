"""Find b-roll footage and background music that fit the content."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from urllib.parse import urlparse

from .broll_concepts import search_plan, tags_match

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
    """Footage for a b-roll cue: your own broll/ folder first, then Pexels, then Pixabay.

    Stock results are only accepted when their tags include the subject (see broll_concepts), so an
    unrelated clip is never used; if nothing matches, the cue is skipped.
    """
    searches, must = search_plan(query)
    if broll_dir.exists():
        local = [p for p in broll_dir.rglob("*") if p.suffix.lower() in VIDEO_EXT]
        for p in local:
            if str(p) not in used and tags_match(p.stem.replace("-", " ").replace("_", " "), must):
                log.info(f"B-roll '{query}': using your clip {p.name}")
                return p
    for name, key, search in (("Pexels", pexels_key, _pexels), ("Pixabay", pixabay_key, _pixabay)):
        if not key:
            continue
        for term in searches:
            try:
                found = search(term, orientation, key, min_seconds)
            except Exception as e:
                log.warn(f"{name} search for '{term}' failed: {e}")
                break
            for video_id, url, width, tags in found:
                if not tags_match(tags, must):
                    continue
                dest = cache_dir / f"{name.lower()}_{video_id}_{width}.mp4"
                if str(dest) in used:
                    continue
                _download(url, dest)
                log.info(f"B-roll '{query}': {name} clip {video_id} (searched '{term}', tags: {tags[:80]})")
                return dest
    log.info(f"B-roll '{query}': no stock footage clearly matched, skipped")
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


def _pexels(term: str, orientation: str, api_key: str, min_seconds: float) -> list[tuple[str, str, int, str]]:
    """Candidate (id, mp4 url, width, description) from Pexels, best first."""
    import requests

    r = requests.get(
        "https://api.pexels.com/videos/search",
        params={"query": term, "orientation": orientation, "per_page": 15, "size": "medium"},
        headers={"Authorization": api_key}, timeout=20,
    )
    r.raise_for_status()
    target_w = 1080 if orientation == "portrait" else 1920
    out = []
    for video in r.json().get("videos", []):
        if video.get("duration", 0) < min_seconds:
            continue
        files = [f for f in video.get("video_files", []) if f.get("file_type") == "video/mp4" and f.get("width")]
        if not files:
            continue
        f = min(files, key=lambda f: abs(f["width"] - target_w) + (5000 if f["width"] < 640 else 0))
        # Pexels has no tags; its page URL is a description ("/video/people-voting-at-a-booth-123/").
        slug = " ".join(re.split(r"[-/]", video.get("url", "").rstrip("/").split("/")[-1]))
        out.append((str(video["id"]), f["link"], f["width"], slug))
    return out


def _pixabay(term: str, orientation: str, api_key: str, min_seconds: float) -> list[tuple[str, str, int, str]]:
    """Candidate (id, mp4 url, width, tags) from Pixabay, best first. Pixabay has no orientation filter,
    so clips matching the wanted orientation come first and the rest are cropped when rendering."""
    import requests

    r = requests.get(
        "https://pixabay.com/api/videos/",
        params={"key": api_key, "q": term[:100], "per_page": 30, "safesearch": "true"},
        timeout=20,
    )
    r.raise_for_status()
    target_w = 1080 if orientation == "portrait" else 1920
    ranked = []
    for hit in r.json().get("hits", []):
        if hit.get("duration", 0) < min_seconds:
            continue
        sizes = [v for v in (hit.get("videos") or {}).values() if v.get("url") and v.get("width")]
        if not sizes:
            continue
        v = min(sizes, key=lambda v: abs(v["width"] - target_w) + (5000 if v["width"] < 640 else 0))
        mismatch = (v["height"] > v["width"]) != (orientation == "portrait")
        ranked.append((mismatch, str(hit["id"]), v["url"], v["width"], hit.get("tags", "")))
    ranked.sort(key=lambda x: x[0])   # stable: keeps Pixabay's relevance order within each group
    return [(i, u, w, t) for _, i, u, w, t in ranked]


# ---------------------------------------------------------------------------
# Browsing stock footage (the manual editor's b-roll search)
# ---------------------------------------------------------------------------

STOCK_HOSTS = ("pixabay.com", "pexels.com", "vimeo.com", "vimeocdn.com")


def search_stock(query: str, orientation: str, pexels_key: str | None, pixabay_key: str | None,
                 strict: bool = False, limit: int = 24) -> list[dict]:
    """Stock clips for the editor to show, with thumbnails and small previews.

    ``strict`` keeps only clips whose tags include the subject (used to pre-fill suggested b-roll);
    when browsing, the person judges the pictures themselves.
    """
    searches, must = search_plan(query)
    if not strict:
        searches = searches[:2]
    out: list[dict] = []
    seen: set[str] = set()
    for name, key, fn in (("pixabay", pixabay_key, _pixabay_hits), ("pexels", pexels_key, _pexels_hits)):
        if not key:
            continue
        for term in searches:
            for hit in fn(term, orientation, key):
                uid = f"{name}:{hit['id']}"
                if uid in seen or (strict and not tags_match(hit["tags"], must)):
                    continue
                seen.add(uid)
                out.append(hit | {"provider": name})
                if len(out) >= limit:
                    return out
            if strict and out:
                return out
    return out


def _pixabay_hits(term: str, orientation: str, api_key: str) -> list[dict]:
    import requests

    r = requests.get("https://pixabay.com/api/videos/",
                     params={"key": api_key, "q": term[:100], "per_page": 30, "safesearch": "true"}, timeout=20)
    r.raise_for_status()
    target_w = 1080 if orientation == "portrait" else 1920
    hits = []
    for hit in r.json().get("hits", []):
        videos = hit.get("videos") or {}
        sizes = [v for v in videos.values() if v.get("url") and v.get("width")]
        if not sizes:
            continue
        big = min(sizes, key=lambda v: abs(v["width"] - target_w) + (5000 if v["width"] < 640 else 0))
        small = min(sizes, key=lambda v: v["width"])
        thumb = next((v.get("thumbnail") for v in (videos.get("small"), videos.get("tiny"), big) if v and v.get("thumbnail")),
                     None) or (f"https://i.vimeocdn.com/video/{hit['picture_id']}_295x166.jpg" if hit.get("picture_id") else None)
        hits.append({"id": str(hit["id"]), "url": big["url"], "preview": small["url"], "thumb": thumb,
                     "width": big["width"], "height": big.get("height", 0), "duration": hit.get("duration", 0),
                     "tags": hit.get("tags", ""), "page": hit.get("pageURL")})
    portrait = orientation == "portrait"
    hits.sort(key=lambda h: (h["height"] > h["width"]) != portrait)
    return hits


def _pexels_hits(term: str, orientation: str, api_key: str) -> list[dict]:
    import requests

    r = requests.get("https://api.pexels.com/videos/search",
                     params={"query": term, "orientation": orientation, "per_page": 20, "size": "medium"},
                     headers={"Authorization": api_key}, timeout=20)
    r.raise_for_status()
    target_w = 1080 if orientation == "portrait" else 1920
    hits = []
    for video in r.json().get("videos", []):
        files = [f for f in video.get("video_files", []) if f.get("file_type") == "video/mp4" and f.get("width")]
        if not files:
            continue
        big = min(files, key=lambda f: abs(f["width"] - target_w) + (5000 if f["width"] < 640 else 0))
        small = min(files, key=lambda f: f["width"])
        slug = " ".join(re.split(r"[-/]", video.get("url", "").rstrip("/").split("/")[-1]))
        hits.append({"id": str(video["id"]), "url": big["link"], "preview": small["link"], "thumb": video.get("image"),
                     "width": big["width"], "height": big.get("height", 0), "duration": video.get("duration", 0),
                     "tags": slug, "page": video.get("url")})
    return hits


def fetch_stock(url: str, provider: str, clip_id: str, cache_dir: Path) -> Path:
    """Download a stock clip the person picked (only from the stock sites)."""
    host = (urlparse(url).hostname or "").lower()
    if urlparse(url).scheme != "https" or not any(host == h or host.endswith("." + h) for h in STOCK_HOSTS):
        raise ValueError(f"Not a stock footage address: {url}")
    tag = hashlib.md5(url.encode()).hexdigest()[:8]
    dest = cache_dir / f"{re.sub(r'[^a-z0-9]', '', provider.lower())}_{re.sub(r'[^0-9A-Za-z]', '', clip_id)}_{tag}.mp4"
    _download(url, dest)
    return dest
