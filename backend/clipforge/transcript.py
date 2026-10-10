"""Word-level transcripts: data model and speech-to-text with faster-whisper."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path

# Whisper tends to "clean up" disfluencies. Priming it with a disfluent prompt makes it
# keep the ums and uhs, which we need in order to cut them out.
# Languages offered in the app (Whisper codes). English is the default everywhere.
LANGUAGE_NAMES = {
    "en": "English", "fr": "French", "es": "Spanish", "pt": "Portuguese", "de": "German", "it": "Italian",
    "nl": "Dutch", "ar": "Arabic", "hi": "Hindi", "yo": "Yoruba", "ha": "Hausa", "sw": "Swahili",
    "zh": "Chinese", "ja": "Japanese", "ko": "Korean", "ru": "Russian", "tr": "Turkish",
}

FILLER_PROMPT = "Umm, let me think like, hmm... Okay, uh, here's what I'm, like, thinking. So, um, you know."


@dataclass
class Word:
    start: float
    end: float
    text: str
    prob: float = 1.0

    @property
    def norm(self) -> str:
        return re.sub(r"[^\w']+", "", self.text.lower())


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Transcript:
    words: list[Word]
    segments: list[Segment]
    language: str = "en"
    duration: float = 0.0
    extra: dict = field(default_factory=dict)

    def words_between(self, start: float, end: float) -> list[Word]:
        return [w for w in self.words if w.start >= start - 1e-3 and w.end <= end + 1e-3]

    def text_between(self, start: float, end: float) -> str:
        return " ".join(w.text.strip() for w in self.words_between(start, end))

    def save(self, path: Path) -> None:
        path.write_text(json.dumps(asdict(self), indent=1))

    @classmethod
    def load(cls, path: Path) -> "Transcript":
        data = json.loads(Path(path).read_text())
        words = [Word(**w) for w in data["words"]]
        segments = [Segment(**s) for s in data.get("segments", [])]
        if not segments:
            segments = segments_from_words(words)
        duration = data.get("duration") or (words[-1].end if words else 0.0)
        return cls(words, segments, data.get("language", "en"), duration, data.get("extra", {}))


def segments_from_words(words: list[Word], max_gap: float = 0.8) -> list[Segment]:
    """Group words into sentence-like segments (used when a transcript has no segments)."""
    segs: list[Segment] = []
    cur: list[Word] = []
    for w in words:
        if cur and (w.start - cur[-1].end > max_gap or cur[-1].text.rstrip().endswith((".", "?", "!"))):
            segs.append(Segment(cur[0].start, cur[-1].end, " ".join(x.text.strip() for x in cur)))
            cur = []
        cur.append(w)
    if cur:
        segs.append(Segment(cur[0].start, cur[-1].end, " ".join(x.text.strip() for x in cur)))
    return segs


def load_audio(path: Path, sample_rate: int = 16000):
    """Decode any media file to mono float32 PCM with FFmpeg.

    faster-whisper can decode audio itself through PyAV, but PyAV 19 removed an option it passes
    (``metadata_errors``), so we hand it ready-made samples instead.
    """
    import numpy as np

    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sample_rate),
         "-f", "s16le", "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Could not read the audio: {proc.stderr.decode(errors='replace').strip()[-500:]}")
    return np.frombuffer(proc.stdout, np.int16).astype(np.float32) / 32768.0


def transcribe(video: Path, model_size: str = "small", language: str | None = None, log=None) -> Transcript:
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("faster-whisper is not installed: pip install -r requirements.txt") from e

    if log:
        log.info(f"Loading Whisper model '{model_size}' (first run downloads it)…")
    model = WhisperModel(model_size, device="auto", compute_type="default")
    if log:
        log.info("Reading the audio…")
    audio = load_audio(video)
    seg_iter, info = model.transcribe(
        audio,
        language=language,
        word_timestamps=True,
        # The English prompt keeps the ums in; for other languages it would only confuse the model.
        initial_prompt=FILLER_PROMPT if language in (None, "en") else None,
        beam_size=5,
        condition_on_previous_text=False,
    )
    words: list[Word] = []
    segments: list[Segment] = []
    for seg in seg_iter:
        segments.append(Segment(seg.start, seg.end, seg.text.strip()))
        for w in seg.words or []:
            if w.word.strip():
                words.append(Word(round(w.start, 3), round(w.end, 3), w.word.strip(), round(w.probability, 3)))
        if log and info.duration:
            log.progress(min(seg.end / info.duration, 1.0), f"Transcribing… {seg.end:.0f}s / {info.duration:.0f}s")
    return Transcript(words, segments, info.language, info.duration)
