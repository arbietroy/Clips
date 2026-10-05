"""Thin helpers around ffmpeg / ffprobe."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


class FFmpegError(RuntimeError):
    pass


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise FFmpegError(f"{tool} not found on PATH. Install FFmpeg (https://ffmpeg.org/download.html).")


@dataclass
class MediaInfo:
    path: Path
    duration: float
    width: int
    height: int
    fps: float
    has_audio: bool

    @property
    def is_vertical(self) -> bool:
        return self.height > self.width


def probe(path: str | Path) -> MediaInfo:
    path = Path(path)
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise FFmpegError(f"ffprobe failed on {path}: {out.stderr.strip()}")
    data = json.loads(out.stdout)
    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    if video is None:
        raise FFmpegError(f"{path} has no video stream")
    num, _, den = video.get("avg_frame_rate", "30/1").partition("/")
    try:
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps = 30.0
    if not fps or fps != fps:
        fps = 30.0
    width, height = int(video["width"]), int(video["height"])
    rotation = _rotation(video)
    if rotation in (90, 270):
        width, height = height, width
    duration = float(data["format"].get("duration") or video.get("duration") or 0)
    return MediaInfo(path, duration, width, height, fps, audio is not None)


def _rotation(stream: dict) -> int:
    rot = stream.get("tags", {}).get("rotate")
    if rot is None:
        for sd in stream.get("side_data_list", []):
            if "rotation" in sd:
                rot = sd["rotation"]
    try:
        return abs(int(float(rot))) % 360 if rot is not None else 0
    except ValueError:
        return 0


def output_fps(source_fps: float) -> int:
    """Pick an integer frame rate that divides 48 kHz evenly (keeps cuts sample-exact)."""
    for fps in (24, 25, 30, 48, 50, 60):
        if abs(source_fps - fps) < 1.5:
            return fps
    return 30


@lru_cache(maxsize=1)
def ffmpeg_major_version() -> int:
    out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout
    m = re.search(r"ffmpeg version n?(\d+)", out)
    return int(m.group(1)) if m else 6


def filter_script_args(script: Path) -> list[str]:
    """Arguments that load a filter graph from a file (flag changed in FFmpeg 7)."""
    if ffmpeg_major_version() >= 7:
        return ["-/filter_complex", str(script)]
    return ["-filter_complex_script", str(script)]


def run_ffmpeg(args: list[str], log=None) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args]
    if log:
        log.debug("ffmpeg " + " ".join(args))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise FFmpegError(f"ffmpeg failed:\n{proc.stderr.strip()[-4000:]}\ncommand: {' '.join(cmd)}")


def escape_filter_path(path: Path) -> str:
    """Escape a file path for use as a filter option value inside single quotes."""
    s = str(path.resolve()).replace("\\", "/")
    return s.replace(":", "\\:").replace("'", "\\'")
