"""Editing settings. Every value can be overridden from the CLI or the web UI."""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

MOODS = [
    "upbeat", "inspirational", "chill", "dramatic", "emotional",
    "energetic", "corporate", "funny", "suspense", "hiphop",
]

TRANSITIONS = [
    "fade", "fadeblack", "fadewhite", "dissolve", "smoothleft", "smoothright",
    "slideleft", "slideup", "zoomin", "circleopen", "wipeleft", "radial",
]


@dataclass
class Settings:
    # --- analysis ---
    claude_model: str = "claude-opus-5-5"
    use_claude: bool = True                  # falls back to heuristics when no API key
    num_clips: int = 5
    clip_min_seconds: float = 45.0
    clip_max_seconds: float = 75.0
    clip_target_seconds: float = 60.0

    # --- transcription ---
    whisper_model: str = "small"             # tiny / base / small / medium / large-v3
    language: str | None = None              # None = auto-detect

    # --- cleanup ---
    remove_fillers: bool = True
    remove_repetition: bool = True
    aggressive_fillers: bool = False         # also cut "you know", "I mean", "like,"
    max_pause: float = 0.45                  # silences longer than this are tightened
    pause_padding: float = 0.12              # breathing room kept around each phrase

    # --- look ---
    captions: bool = True
    caption_template: str = "bold-pop"       # see templates.py
    caption_highlight: str | None = None     # override the template's active-word colour
    hook_title: bool = True
    chapter_titles: bool = True
    reframe: str = "face"                    # face | blur | center (shorts only)
    zoom_on_jump_cuts: bool = True
    emphasis_zoom: bool = True
    transitions: bool = True
    transition_duration: float = 0.45
    transition_min_gap: float = 2.5          # cuts that skip more than this get a transition
    transition_sfx: bool = True

    # --- b-roll ---
    broll: bool = True
    broll_dir: Path = Path("broll")
    pexels_api_key: str | None = field(default_factory=lambda: os.environ.get("PEXELS_API_KEY"))
    max_broll_per_minute: float = 3.0

    # --- music ---
    music: bool = True
    music_dir: Path = Path("music")
    music_volume: float = 0.18
    music_mood: str | None = None            # override the detected mood
    music_file: Path | None = None           # use this track instead of the library

    # --- output ---
    format: str = "vertical"                 # see formats.py
    custom_size: tuple[int, int] | None = None
    crf: int = 20
    preset: str = "veryfast"
    loudness_lufs: float = -14.0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["pexels_api_key"] = bool(self.pexels_api_key)
        return {k: (str(v) if isinstance(v, Path) else v) for k, v in d.items()}
