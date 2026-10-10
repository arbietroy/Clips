"""End-to-end orchestration: transcribe → analyse → plan → render."""

from __future__ import annotations

import json
import re
from pathlib import Path

from .analyze import Analysis, ClipIdea, analyze
from .assets import find_broll, find_music
from .cleanup import find_removals, keep_segments
from .config import Settings
from .formats import resolve_size
from .log import Log
from .media import MediaInfo, output_fps, probe, require_ffmpeg
from .reframe import detect_rotation
from .render import EditPlan, render
from .transcript import Transcript, transcribe


def slugify(text: str, max_len: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:max_len].strip("-") or "clip"


class Project:
    def __init__(self, video: Path, out_root: Path, settings: Settings, log: Log | None = None,
                 project_dir: Path | None = None):
        require_ffmpeg()
        self.video = Path(video).resolve()
        self.settings = settings
        self.log = log or Log()
        self.dir = Path(project_dir) if project_dir else Path(out_root) / slugify(self.video.stem, 60)
        self.work = self.dir / "work"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.work.mkdir(exist_ok=True)
        self.info: MediaInfo = probe(self.video)
        if not self.info.has_audio:
            raise ValueError("The video has no audio track – ClipForge edits from the speech.")
        self.fps = output_fps(self.info.fps)
        self.rotation = self._rotation()
        # Size of the picture after rotation (what the viewer should see).
        self.width, self.height = ((self.info.height, self.info.width) if self.rotation in (90, 270)
                                   else (self.info.width, self.info.height))
        self._transcript: Transcript | None = None
        self._analysis: Analysis | None = None
        self._drop: set[int] | None = None
        self._used_broll: set[str] = set()

    def _rotation(self) -> int:
        choice = str(self.settings.rotate or "auto")
        if choice != "auto":
            return int(choice) if choice in ("0", "90", "180", "270") else 0
        cache = self.dir / "rotation.json"
        if cache.exists():
            return int(json.loads(cache.read_text()).get("auto", 0))
        rot = detect_rotation(self.video, log=self.log)
        cache.write_text(json.dumps({"auto": rot}))
        return rot

    # ---------------------------------------------------------------- steps

    @property
    def transcript_path(self) -> Path:
        return self.dir / "transcript.json"

    def transcript(self, import_from: Path | None = None) -> Transcript:
        if self._transcript:
            return self._transcript
        if import_from:
            tr = Transcript.load(import_from)
            tr.save(self.transcript_path)
        elif self.transcript_path.exists():
            self.log.info("Using cached transcript")
            tr = Transcript.load(self.transcript_path)
        else:
            self.log.info("Transcribing speech (word-level timestamps)…")
            tr = transcribe(self.video, self.settings.whisper_model, self.settings.language, self.log)
            tr.save(self.transcript_path)
        tr.duration = tr.duration or self.info.duration
        self.log.info(f"Transcript: {len(tr.words)} words, {tr.duration:.0f}s")
        self._transcript = tr
        return tr

    def analysis(self, refresh: bool = False) -> Analysis:
        if self._analysis and not refresh:
            return self._analysis
        path = self.dir / "analysis.json"
        s = self.settings
        params = {"num_clips": s.num_clips, "min": s.clip_min_seconds, "max": s.clip_max_seconds,
                  "target": s.clip_target_seconds, "ai": s.use_claude}
        cached = Analysis.from_dict(json.loads(path.read_text())) if path.exists() and not refresh else None
        # Re-run when the clip count or length changed; a heuristic result is also redone once AI is available.
        if cached and cached.extra.get("params") == params:
            self.log.info("Using cached analysis")
            a = cached
        else:
            a = analyze(self.transcript(), self.settings, self.log)
            a.extra["params"] = params
            path.write_text(json.dumps(a.to_dict(), indent=2))
        self.log.info(f"Analysis ({a.source}): {len(a.clips)} clips, {len(a.chapters)} chapters, "
                      f"{len(a.broll)} b-roll cues, music mood '{a.music_mood}'")
        self._analysis = a
        return a

    def _removals(self) -> set[int]:
        if self._drop is None:
            s = self.settings
            self._drop = find_removals(self.transcript().words, s.remove_fillers, s.remove_repetition,
                                       s.aggressive_fillers)
            self.log.info(f"Found {len(self._drop)} filler / repeated words to cut")
        return self._drop

    def _segments(self, start: float, end: float) -> list[list[float]]:
        s = self.settings
        cuts = [(r["start"], r["end"]) for r in self.analysis().remove]
        segs = keep_segments(self.transcript().words, start, end, self._removals(), cuts,
                             s.max_pause, s.pause_padding)
        return [list(x) for x in segs]

    def _broll(self, start: float, end: float, orientation: str, skip_first: float) -> list[dict]:
        s = self.settings
        if not s.broll:
            return []
        cues = [b for b in self.analysis().broll if b.start >= start + skip_first and b.end <= end]
        max_n = max(1, int((end - start) / 60 * s.max_broll_per_minute))
        out, last_end = [], -1e9
        for b in cues:
            if len(out) >= max_n or b.start - last_end < 6:
                continue
            f = find_broll(b.query, s.broll_dir, self.dir.parent / "_broll_cache", orientation,
                           b.end - b.start, self._used_broll, self.log,
                           pexels_key=s.pexels_api_key, pixabay_key=s.pixabay_api_key)
            if f:
                self._used_broll.add(str(f))
                out.append({"start": b.start, "end": b.end, "query": b.query, "file": str(Path(f).resolve())})
                last_end = b.end
        return out

    def _music(self, mood: str, key: str, volume: float) -> dict | None:
        if not self.settings.music:
            return None
        if self.settings.music_file and Path(self.settings.music_file).exists():
            return {"file": str(Path(self.settings.music_file).resolve()), "volume": volume, "mood": "custom"}
        f = find_music(mood, self.settings.music_dir, key)
        if not f:
            self.log.warn(f"No music found in '{self.settings.music_dir}' – add tracks to enable background music")
            return None
        return {"file": str(f.resolve()), "volume": volume, "mood": mood}

    def _base(self, name: str, kind: str, segments) -> EditPlan:
        s = self.settings
        w, h = resolve_size(s.format, self.width, self.height, s.custom_size)
        return EditPlan(
            name=name, kind=kind, source=str(self.video), segments=segments, width=w, height=h,
            fps=self.fps, captions=s.captions, caption_template=s.caption_template,
            caption_highlight=s.caption_highlight, zoom_on_jump_cuts=s.zoom_on_jump_cuts,
            transition_sfx=s.transition_sfx, reframe=s.reframe, rotate=self.rotation, crf=s.crf, preset=s.preset,
            loudness_lufs=s.loudness_lufs, meta={"transcript": str(self.transcript_path.resolve()),
                                                 "format": s.format, "template": s.caption_template},
        )

    def _orientation(self, plan: EditPlan) -> str:
        return "portrait" if plan.height > plan.width else "landscape"

    def clip_for_range(self, start: float, end: float) -> ClipIdea | None:
        """The analysed clip that best matches a time range (for its hook and music mood)."""
        best, best_overlap = None, 0.0
        for c in self.analysis().clips:
            overlap = min(end, c.end) - max(start, c.start)
            if overlap > best_overlap:
                best, best_overlap = c, overlap
        return best if best and best_overlap >= 0.5 * (end - start) else None

    # ---------------------------------------------------------------- plans

    def plan_raw(self, clip: ClipIdea, index: int) -> EditPlan:
        """A clip exactly as said in the source, just cut and resized (the clip finder's output)."""
        plan = self._base(f"clip_{index:02d}_{slugify(clip.title)}", "raw", [[clip.start, clip.end]])
        plan.captions = False
        plan.zoom_on_jump_cuts = False
        plan.transition_sfx = False
        plan.meta.update({"title": clip.title, "virality_score": clip.virality_score, "reason": clip.reason,
                          "hook_text": clip.hook_text, "source_range": [clip.start, clip.end], "index": index})
        return plan

    def plan_edit(self, start: float, end: float, name: str, clip: ClipIdea | None = None) -> EditPlan:
        """The full automatic edit of a time range: a clip, or the whole video."""
        s = self.settings
        a = self.analysis()
        full = start <= 0.5 and end >= self.transcript().duration - 0.5 and clip is None
        segs = self._segments(start, end)
        transitions = []
        if s.transitions:
            if full:
                for c in [c for c in a.chapters if c["start"] > 5]:
                    i = _split_for_transition(segs, c["start"])
                    if i is not None:
                        transitions.append({"after": i, "type": a.transition_style, "duration": s.transition_duration})
                transitions = _dedupe(segs, transitions)
            else:
                styles = ("smoothleft", "zoomin", "slideup", "fadewhite")
                for i in range(len(segs) - 1):
                    if segs[i + 1][0] - segs[i][1] >= s.transition_min_gap:
                        transitions.append({"after": i, "type": styles[len(transitions) % len(styles)],
                                            "duration": min(s.transition_duration, 0.35)})
        plan = self._base(name, "full" if full else "clip", segs)
        plan.transitions = transitions
        plan.zoom_on_jump_cuts = s.zoom_on_jump_cuts and len(segs) <= 400
        plan.emphasis = [t for t in a.emphasis if start <= t <= end] if s.emphasis_zoom else []
        plan.broll = self._broll(start, end, self._orientation(plan), skip_first=4.0)
        mood = s.music_mood or (clip.music_mood if clip else a.music_mood)
        plan.music = self._music(mood, name, s.music_volume * (0.6 if full else 1.0))
        if full:
            plan.chapters = [{"time": c["start"], "title": c["title"]} for c in a.chapters] if s.chapter_titles else []
            plan.meta.update({"title": "Full edit", "summary": a.summary})
        else:
            plan.hook_text = (clip.hook_text if clip else None) if s.hook_title else None
            plan.meta.update({"title": clip.title if clip else "Edited clip", "source_range": [start, end]})
            if clip:
                plan.meta.update({"virality_score": clip.virality_score, "reason": clip.reason})
        return plan

    # ---------------------------------------------------------------- run

    def render_plans(self, plans: list[EditPlan]) -> list[dict]:
        tr = self.transcript()
        results = []
        for k, plan in enumerate(plans, 1):
            plan_path = self.dir / f"{plan.name}.plan.json"
            plan.save(plan_path)
            self.log.info(f"[{k}/{len(plans)}] Rendering {plan.name}")
            self.log.progress((k - 1) / len(plans), f"Rendering {k} of {len(plans)}…")
            try:
                out = render(plan, tr, self.dir, self.work / plan.name, self.log)
            except Exception as e:
                self.log.warn(f"{plan.name} failed: {e}")
                results.append({"name": plan.name, "error": str(e)})
                continue
            info = probe(out)
            results.append({
                "name": plan.name, "kind": plan.kind, "file": str(out), "srt": str(self.dir / f"{plan.name}.srt"),
                "plan": str(plan_path), "duration": round(info.duration, 2), "width": plan.width,
                "height": plan.height, **{k: v for k, v in plan.meta.items() if k != "transcript"},
                "hook_text": plan.hook_text or plan.meta.get("hook_text"),
                "music": plan.music and Path(plan.music["file"]).name,
                "broll": [b["query"] for b in plan.broll], "cuts": len(plan.segments) - 1,
            })
        return results

    def find_clips(self, clips: list[ClipIdea] | None = None) -> list[dict]:
        """Clip finder: export moments cut and resized but not otherwise edited.

        ``clips`` are the ones the person chose (possibly with adjusted start/end); default: all found.
        """
        clips = clips if clips is not None else self.analysis().clips
        dur = self.transcript().duration
        plans = []
        for i, c in enumerate(clips, 1):
            c.start, c.end = max(0.0, c.start), min(c.end, dur)
            if c.end - c.start >= 1:
                plans.append(self.plan_raw(c, i))
        return self.render_plans(plans)

    def clip_text(self, start: float, end: float) -> str:
        return self.transcript().text_between(start, end)

    def auto_edit(self, start: float | None = None, end: float | None = None) -> list[dict]:
        """Automatic editor: a time range (e.g. a clip from the finder) or the whole video."""
        dur = self.transcript().duration
        if start is None or end is None:
            return self.render_plans([self.plan_edit(0.0, dur, "full_edit")])
        clip = self.clip_for_range(start, end)
        name = f"edit_{slugify(clip.title) if clip else 'clip'}_{int(start)}-{int(end)}"
        return self.render_plans([self.plan_edit(max(0.0, start), min(end, dur), name, clip)])

    def run(self, shorts: bool = True, long: bool = True, only_clip: int | None = None) -> list[dict]:
        """CLI: auto-edit every clip and/or the whole video."""
        plans = []
        if shorts:
            for i, c in enumerate(self.analysis().clips, 1):
                if only_clip is None or only_clip == i:
                    plans.append(self.plan_edit(c.start, c.end, f"short_{i:02d}_{slugify(c.title)}", c))
        if long:
            plans.append(self.plan_edit(0.0, self.transcript().duration, "full_edit"))
        results = self.render_plans(plans)
        (self.dir / "manifest.json").write_text(json.dumps(results, indent=2))
        return results


def _split_for_transition(segs: list[list[float]], t: float, window: float = 4.0) -> int | None:
    """Index of the segment boundary to put a transition on, splitting a segment if needed."""
    best, best_d = None, window
    for i in range(len(segs) - 1):
        d = abs(segs[i][1] - t)
        if d < best_d:
            best, best_d = i, d
    if best is not None:
        return best
    for i, (a, b) in enumerate(segs):
        if a + 1.0 < t < b - 1.0:
            segs[i:i + 1] = [[a, t], [t, b]]
            return i
    return None


def _dedupe(segs: list[list[float]], transitions: list[dict]) -> list[dict]:
    # Chapters are processed in time order, so a split never shifts an earlier transition's index.
    seen, out = set(), []
    for t in transitions:
        i = min(t["after"], len(segs) - 2)
        if i >= 0 and i not in seen:
            seen.add(i)
            out.append({**t, "after": i})
    return out


def render_plan_file(plan_path: Path, out_dir: Path | None = None, log: Log | None = None) -> Path:
    """Re-render a (possibly hand-edited) plan JSON."""
    log = log or Log()
    plan = EditPlan.load(plan_path)
    tr = Transcript.load(Path(plan.meta["transcript"]))
    out_dir = out_dir or Path(plan_path).parent
    return render(plan, tr, out_dir, out_dir / "work" / plan.name, log)
