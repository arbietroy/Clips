"""Caption templates. The web app shows matching live previews (frontend/src/data/templates.ts)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CaptionTemplate:
    id: str
    name: str
    font: str
    size: float                 # fraction of the frame's shorter side
    upper: bool = True
    color: str = "#FFFFFF"
    highlights: tuple[str, ...] = ("#FFE600",)   # active-word colours (cycled)
    outline_color: str = "#000000"
    outline: float = 0.09       # fraction of font size
    shadow: int = 2
    box: bool = False           # opaque box behind the line
    box_color: str = "#000000"
    box_alpha: int = 0x40       # 0 = solid, 255 = invisible
    position: str = "lower"     # bottom | lower | middle
    words: int = 3              # max words on screen at once
    animation: str = "pop"      # pop | bounce | karaoke | reveal | static
    glow: int = 0               # blur strength on the outline (neon look)
    tags: tuple[str, ...] = field(default_factory=tuple)


TEMPLATES: dict[str, CaptionTemplate] = {t.id: t for t in [
    CaptionTemplate("bold-pop", "Bold Pop", "Poppins Black", 0.075, highlights=("#FFE600",), words=3,
                    animation="pop", tags=("shorts", "default")),
    CaptionTemplate("hormozi", "Hormozi", "Poppins ExtraBold", 0.082, highlights=("#39FF14", "#FFE600"),
                    outline=0.11, shadow=3, words=2, animation="bounce", tags=("shorts", "business")),
    CaptionTemplate("beast", "Beast", "Luckiest Guy", 0.09, highlights=("#FF2D55", "#FFE600", "#2DE1FF"),
                    outline=0.13, shadow=5, words=2, animation="bounce", position="middle", tags=("shorts", "fun")),
    CaptionTemplate("karaoke", "Karaoke", "Poppins SemiBold", 0.052, upper=False, highlights=("#2DE1FF",),
                    outline=0.08, shadow=1, words=7, animation="karaoke", position="bottom", tags=("long", "podcast")),
    CaptionTemplate("boxed", "Boxed", "Archivo Black", 0.06, highlights=("#FFE600",), outline=0.25, shadow=0,
                    box=True, box_alpha=0x30, words=4, animation="pop", tags=("shorts", "clean")),
    CaptionTemplate("neon", "Neon", "Bebas Neue", 0.1, highlights=("#FF4FD8",), outline_color="#B026FF",
                    outline=0.07, shadow=0, words=3, animation="pop", glow=6, tags=("shorts", "night")),
    CaptionTemplate("minimal", "Minimal", "Poppins SemiBold", 0.045, upper=False, highlights=(),
                    outline=0.0, shadow=3, box=True, box_alpha=0x70, words=8, animation="static",
                    position="bottom", tags=("long", "clean")),
    CaptionTemplate("comic", "Comic Reveal", "Bangers", 0.095, highlights=("#FFE600",), outline=0.12, shadow=4,
                    words=4, animation="reveal", tags=("shorts", "fun")),
    CaptionTemplate("marker", "Marker", "Permanent Marker", 0.07, upper=False, highlights=("#FF9F1C",),
                    outline=0.06, shadow=4, words=3, animation="pop", tags=("shorts", "creator")),
    CaptionTemplate("cinema", "Cinema", "Anton", 0.07, highlights=("#FFFFFF",), color="#D9D9D9", outline=0.05,
                    shadow=2, words=4, animation="reveal", position="bottom", tags=("long", "story")),
]}

DEFAULT_TEMPLATE = "bold-pop"


def get_template(template_id: str | None) -> CaptionTemplate:
    return TEMPLATES.get(template_id or DEFAULT_TEMPLATE, TEMPLATES[DEFAULT_TEMPLATE])
