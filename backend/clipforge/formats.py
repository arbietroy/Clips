"""Export sizes for each platform."""

from __future__ import annotations

FORMATS: dict[str, dict] = {
    "vertical": {"label": "TikTok · Reels · Shorts", "ratio": "9:16", "width": 1080, "height": 1920},
    "landscape": {"label": "YouTube · Facebook", "ratio": "16:9", "width": 1920, "height": 1080},
    "square": {"label": "Instagram · LinkedIn · X", "ratio": "1:1", "width": 1080, "height": 1080},
    "portrait": {"label": "Instagram / Facebook feed", "ratio": "4:5", "width": 1080, "height": 1350},
    "classic": {"label": "Classic / presentations", "ratio": "4:3", "width": 1440, "height": 1080},
    "original": {"label": "Same as the source", "ratio": "source", "width": 0, "height": 0},
}


def resolve_size(fmt: str | None, src_w: int, src_h: int, custom: tuple[int, int] | None = None,
                 max_side: int = 1920) -> tuple[int, int]:
    """Output (width, height), both even."""
    if custom and custom[0] > 0 and custom[1] > 0:
        w, h = custom
    else:
        spec = FORMATS.get(fmt or "original", FORMATS["original"])
        w, h = spec["width"], spec["height"]
        if not w:
            scale = min(1.0, max_side / max(src_w, src_h))
            w, h = src_w * scale, src_h * scale
    return int(w) // 2 * 2, int(h) // 2 * 2
