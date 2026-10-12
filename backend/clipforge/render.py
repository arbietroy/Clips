"""FFmpeg rendering.

Two passes:
  1. cut   – assemble the kept source ranges (jump cuts, plus transitions between groups).
  2. dress – reframe, zoom animations, b-roll, captions/titles, music with ducking, sfx, loudness.

Everything in pass 2 is expressed in output time, so plans stay easy to reason about.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .captions import build_ass, build_srt
from .cleanup import Timeline
from .media import escape_filter_path, filter_script_args, probe, run_ffmpeg
from .reframe import face_centers
from .templates import get_template
from .transcript import Transcript

SAMPLE_RATE = 48000
FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"


@dataclass
class EditPlan:
    name: str
    kind: str                                   # "clip" | "full" | "raw"
    source: str
    segments: list[list[float]]                 # kept source ranges, in order
    width: int
    height: int
    fps: int
    transitions: list[dict] = field(default_factory=list)   # {"after": seg index, "type", "duration"}
    reframe: str = "none"                       # face | blur | center | none
    rotate: int = 0                             # clockwise degrees applied to the source (0/90/180/270)
    hook_text: str | None = None
    chapters: list[dict] = field(default_factory=list)      # {"time": src seconds, "title"}
    broll: list[dict] = field(default_factory=list)         # {"start", "end" (src), "query", "file"}
    emphasis: list[float] = field(default_factory=list)     # src seconds
    keyframes: list[dict] = field(default_factory=list)     # {"time" (src), "scale" >= 1, "x", "y" in -1..1}
    music: dict | None = None                   # {"file", "volume", "mood"}
    captions: bool = True
    caption_template: str = "bold-pop"
    caption_highlight: str | None = None        # overrides the template's highlight colour
    zoom_on_jump_cuts: bool = True
    transition_sfx: bool = True
    crf: int = 20
    preset: str = "veryfast"
    loudness_lufs: float = -14.0
    meta: dict = field(default_factory=dict)

    def save(self, path: Path) -> None:
        path.write_text(json.dumps(asdict(self), indent=2))

    @classmethod
    def load(cls, path: Path) -> "EditPlan":
        return cls(**json.loads(Path(path).read_text()))


# ---------------------------------------------------------------------------
# Pass 1: cut
# ---------------------------------------------------------------------------

def _select_expr(ranges: list[tuple[float, float]], eps: float) -> str:
    return "+".join(f"gte(t,{a - eps:.4f})*lt(t,{b - eps:.4f})" for a, b in ranges)


ROTATE_FILTERS = {90: "transpose=clock,", 180: "hflip,vflip,", 270: "transpose=cclock,"}


def _render_group(src: Path, ranges: list[tuple[float, float]], fps: int, out: Path, work: Path, log,
                  rotate: int = 0) -> None:
    seek = max(0.0, ranges[0][0] - 1.0)
    rel = [(a - seek, b - seek) for a, b in ranges]
    end = rel[-1][1] + 0.5
    eps = 0.25 / fps
    # Audio is regrouped into one-video-frame packets so audio and video select identical spans.
    script = work / f"{out.stem}.filter"
    script.write_text(
        f"[0:v]{ROTATE_FILTERS.get(rotate, '')}fps={fps},select='{_select_expr(rel, eps)}',setpts=N/FRAME_RATE/TB,setsar=1,format=yuv420p[v];\n"
        f"[0:a]aresample={SAMPLE_RATE}:async=1:first_pts=0,aformat=channel_layouts=stereo,"
        f"asetnsamples=n={SAMPLE_RATE // fps}:p=0,aselect='{_select_expr(rel, eps)}',asetpts=N/SR/TB[a]"
    )
    run_ffmpeg([
        "-ss", f"{seek:.3f}", "-t", f"{end:.3f}", "-i", str(src), *filter_script_args(script),
        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
        "-c:a", "pcm_s16le", str(out),
    ], log)


def render_cut(plan: EditPlan, tl: Timeline, out: Path, work: Path, log) -> list[dict]:
    """Render the cut. Returns the transitions actually applied, with output times."""
    segs = tl.segments
    trans = {t["after"]: t for t in plan.transitions if 0 <= t["after"] < len(segs) - 1}
    groups: list[list[int]] = [[]]
    for i in range(len(segs)):
        groups[-1].append(i)
        if i in trans:
            groups.append([])

    files, lengths = [], []
    for gi, g in enumerate(groups):
        f = work / f"{plan.name}_g{gi:03d}.mkv"
        _render_group(Path(plan.source), [segs[i] for i in g], plan.fps, f, work, log, plan.rotate)
        files.append(f)
        lengths.append(sum(segs[i][1] - segs[i][0] for i in g))
        log.progress((gi + 1) / len(groups) * 0.5, f"{plan.name}: cutting {gi + 1}/{len(groups)}")

    if len(files) == 1:
        shutil.move(files[0], out)
        return []

    applied, chains = [], []
    offset = 0.0
    prev = "[0:v]"
    for k in range(1, len(files)):
        t = trans[groups[k - 1][-1]]
        d = max(0.1, min(float(t.get("duration", 0.45)), lengths[k] * 0.5, 1.5))
        offset += lengths[k - 1]
        # Freeze the outgoing shot's last frame for the blend so no speech is lost and A/V stays in sync.
        chains.append(f"{prev}tpad=stop_mode=clone:stop_duration={d:.3f}[p{k}]")
        nxt = f"[{k}:v]"
        chains.append(f"[p{k}]{nxt}xfade=transition={t.get('type', 'fade')}:duration={d:.3f}:offset={offset:.3f}[x{k}]")
        prev = f"[x{k}]"
        applied.append({"time": offset, "type": t.get("type", "fade"), "duration": d})
    chains.append("".join(f"[{k}:a]" for k in range(len(files))) + f"concat=n={len(files)}:v=0:a=1[a]")
    script = work / f"{plan.name}_assemble.filter"
    script.write_text(";\n".join(chains))
    args = []
    for f in files:
        args += ["-i", str(f)]
    run_ffmpeg([*args, *filter_script_args(script), "-map", prev, "-map", "[a]", "-c:v", "libx264",
                "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", str(out)], log)
    for f in files:
        f.unlink(missing_ok=True)
    return applied


# ---------------------------------------------------------------------------
# Pass 2: dress
# ---------------------------------------------------------------------------

def _shots(tl: Timeline) -> list[tuple[float, float]]:
    cuts = sorted({round(tl.boundary(i), 3) for i in range(len(tl.segments) - 1)})
    edges = [0.0, *cuts, tl.duration]
    return [(a, b) for a, b in zip(edges, edges[1:]) if b - a > 1e-3]


def _piecewise(values: list[tuple[float, float, float]], default: float) -> str:
    if not values:
        return f"{default}"
    return "+".join(f"{v:.2f}*gte(t,{a:.3f})*lt(t,{b:.3f})" for a, b, v in values)


def _zoom_expr(shots, transition_times, emphasis, jump_zoom: bool) -> str | None:
    terms = []
    if jump_zoom and 1 < len(shots) <= 400:
        level = 0
        for a, b in shots:
            if any(abs(a - t) < 0.05 for t in transition_times):
                level = 0                       # a transition already hides this cut
            elif a > 0:
                level ^= 1
            if level:
                terms.append(f"0.07*gte(t,{a:.3f})*lt(t,{b:.3f})")
    for t in emphasis[:200]:
        a, b = t - 0.05, t + 1.4
        terms.append(f"0.10*gte(t,{a:.3f})*lt(t,{b:.3f})*min(1,min((t-{a:.3f})/0.12,({b:.3f}-t)/0.3))")
    return "1+" + "+".join(terms) if terms else None


def _ease(points: list[tuple[float, float]]) -> str:
    """FFmpeg expression of t that eases between keyframe values (holding the first and last)."""
    if len(points) == 1 or all(abs(v - points[0][1]) < 1e-4 for _, v in points):
        return f"{points[0][1]:.4f}"
    expr = f"{points[-1][1]:.4f}"
    for (t0, v0), (t1, v1) in reversed(list(zip(points, points[1:]))):
        if t1 - t0 < 1e-3:
            continue
        f = f"((t-{t0:.3f})/{t1 - t0:.3f})"
        expr = f"if(lt(t,{t1:.3f}),{v0:.4f}+({v1 - v0:.4f})*{f}*{f}*(3-2*{f}),{expr})"
    return f"if(lt(t,{points[0][0]:.3f}),{points[0][1]:.4f},{expr})"


def _keyframe_exprs(keyframes: list[dict], tl: Timeline) -> tuple[str, str, str] | None:
    pts = []
    for k in keyframes[:150]:
        o = tl.to_out(float(k["time"]), clamp=True)
        if o is not None:
            pts.append((o, max(1.0, min(float(k.get("scale", 1)), 4.0)),
                        max(-1.0, min(float(k.get("x", 0)), 1.0)), max(-1.0, min(float(k.get("y", 0)), 1.0))))
    if not pts:
        return None
    pts.sort()
    if all(abs(p[1] - 1) < 1e-4 for p in pts):
        return None                       # never zoomed in: nothing to move
    return (_ease([(p[0], p[1]) for p in pts]), _ease([(p[0], p[2]) for p in pts]),
            _ease([(p[0], p[3]) for p in pts]))


def _make_whoosh(path: Path, log) -> None:
    if path.exists():
        return
    run_ffmpeg(["-f", "lavfi", "-i", "anoisesrc=d=0.7:c=pink:a=0.7",
                "-af", "highpass=f=300,lowpass=f=6000,afade=t=in:d=0.35,afade=t=out:st=0.35:d=0.35,"
                       f"aresample={SAMPLE_RATE},aformat=channel_layouts=stereo",
                str(path)], log)


def render(plan: EditPlan, transcript: Transcript, out_dir: Path, work: Path, log) -> Path:
    work.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    tl = Timeline([tuple(s) for s in plan.segments], plan.fps)
    if not tl.segments:
        raise ValueError(f"{plan.name}: nothing to render")
    log.info(f"{plan.name}: {len(tl.segments)} segments, {tl.duration:.1f}s output")

    cut = work / f"{plan.name}_cut.mkv"
    applied = render_cut(plan, tl, cut, work, log)
    src_info = probe(cut)
    W, H, dur = plan.width, plan.height, tl.duration
    transition_times = [t["time"] for t in applied]

    # --- timings in output time ---
    words = tl.map_words([w for w in transcript.words if w.end >= tl.segments[0][0] and w.start <= tl.segments[-1][1]])
    emphasis = sorted({round(o, 3) for t in plan.emphasis if (o := tl.to_out(t, tol=0.3)) is not None})
    shots = _shots(tl)
    chapters = []
    for c in plan.chapters:
        o = tl.to_out(c["time"], clamp=True)
        if o is not None and o < dur - 4 and all(abs(o - x) > 20 for x, _ in chapters):
            chapters.append((o, c["title"]))

    ass = work / f"{plan.name}.ass"
    build_ass(ass, words, W, H, template=get_template(plan.caption_template), highlight=plan.caption_highlight,
              hook=plan.hook_text, chapters=chapters, duration=dur, captions=plan.captions)
    build_srt(out_dir / f"{plan.name}.srt", words)

    inputs: list[str] = ["-i", str(cut)]
    chains: list[str] = []

    # --- framing ---
    sw, sh = src_info.width, src_info.height
    src_ratio, dst_ratio = sw / sh, W / H
    mode = plan.reframe if plan.reframe in ("face", "blur", "center") else "center"
    if abs(src_ratio - dst_ratio) < 0.01:
        chains.append(f"[0:v]scale={W}:{H},setsar=1[framed]")
    elif src_ratio < dst_ratio or mode == "blur":
        # Taller source than the target (or blur requested): fit it over a blurred, zoomed copy.
        chains.append(f"[0:v]split[bgs][fgs];[bgs]scale={W}:{H}:force_original_aspect_ratio=increase,"
                      f"crop={W}:{H},boxblur=30:3,eq=brightness=-0.08[bg];"
                      f"[fgs]scale={W}:{H}:force_original_aspect_ratio=decrease[fg];"
                      f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[framed]")
    else:
        # Wider source: crop to the target ratio, following the speaker's face.
        cw = int(sh * dst_ratio) // 2 * 2
        if mode == "face":
            log.info(f"{plan.name}: tracking the speaker for reframing…")
            centers = face_centers(cut, shots, samples_per_shot=4 if len(shots) < 150 else 2, log=log)
        else:
            centers = [0.5] * len(shots)
        xs = [(a, b if i < len(shots) - 1 else 1e9, min(max(c * sw - cw / 2, 0), sw - cw))
              for i, ((a, b), c) in enumerate(zip(shots, centers))]
        chains.append(f"[0:v]crop=w={cw}:h={sh}:x='{_piecewise(xs, (sw - cw) / 2)}':y=0,scale={W}:{H},setsar=1[framed]")

    # --- zoom animations (jump-cut punch-ins + emphasis) ---
    z = _zoom_expr(shots, transition_times, emphasis, plan.zoom_on_jump_cuts)
    kf = _keyframe_exprs(plan.keyframes, tl)
    if kf:
        # Keyframes (manual editor): zoom and pan, multiplied with any automatic punch-ins.
        ks, kx, ky = kf
        total = f"({ks})*({z})" if z else ks
        chains.append(f"[framed]scale=w='2*trunc({W}*({total})/2)':h='2*trunc({H}*({total})/2)':eval=frame,"
                      f"crop=w={W}:h={H}:x='(in_w-{W})/2*(1+({kx}))':y='(in_h-{H})/2*(1+({ky}))',setsar=1[zoomed]")
        cur = "[zoomed]"
    elif z:
        chains.append(f"[framed]scale=w='2*trunc({W}*({z})/2)':h='2*trunc({H}*({z})/2)':eval=frame,"
                      f"crop={W}:{H},setsar=1[zoomed]")
        cur = "[zoomed]"
    else:
        cur = "[framed]"

    # --- b-roll ---
    n_in = 1
    for i, b in enumerate(plan.broll):
        if not b.get("file") or not Path(b["file"]).exists():
            continue
        s = tl.to_out(b["start"], clamp=True)
        e = tl.to_out(b["end"], clamp=True)
        if s is None or e is None or e - s < 1.0:
            continue
        d = e - s
        fade = min(0.3, d / 4)
        inputs += ["-stream_loop", "-1", "-i", b["file"]]
        chains.append(
            f"[{n_in}:v]trim=duration={d:.3f},setpts=PTS-STARTPTS,fps={plan.fps},"
            f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,format=yuva420p,"
            f"fade=t=in:st=0:d={fade:.2f}:alpha=1,fade=t=out:st={d - fade:.3f}:d={fade:.2f}:alpha=1,"
            f"setpts=PTS+{s:.3f}/TB[b{i}];"
            f"{cur}[b{i}]overlay=enable='between(t,{s:.3f},{e:.3f})':eof_action=pass[ov{i}]"
        )
        cur = f"[ov{i}]"
        n_in += 1

    # --- captions & titles ---
    chains.append(f"{cur}ass='{escape_filter_path(ass)}':fontsdir='{escape_filter_path(FONTS_DIR)}',format=yuv420p[vout]")

    # --- audio: voice clean-up, music with ducking, transition whooshes, loudness ---
    voice = (f"[0:a]aformat=channel_layouts=stereo,highpass=f=70,"
             f"acompressor=threshold=-21dB:ratio=3:attack=8:release=180:makeup=2")
    mix = ["[voice]"]
    music = plan.music if plan.music and plan.music.get("file") and Path(plan.music["file"]).exists() else None
    if music:
        chains.append(voice + ",asplit=2[voice][sc]")
        inputs += ["-stream_loop", "-1", "-i", music["file"]]
        vol = float(music.get("volume", 0.18))
        chains.append(
            f"[{n_in}:a]aresample={SAMPLE_RATE},aformat=channel_layouts=stereo,atrim=0:{dur:.3f},"
            f"volume={vol:.3f},afade=t=in:d=1.5,afade=t=out:st={max(dur - 2.5, 0):.3f}:d=2.5[mus];"
            f"[mus][sc]sidechaincompress=threshold=0.015:ratio=8:attack=20:release=400:makeup=1[duck]"
        )
        mix.append("[duck]")
        n_in += 1
    else:
        chains.append(voice + "[voice]")
    if plan.transition_sfx and transition_times:
        whoosh = work / "whoosh.wav"
        _make_whoosh(whoosh, log)
        inputs += ["-i", str(whoosh)]
        labels = "".join(f"[w{k}]" for k in range(len(transition_times)))
        parts = [f"[{n_in}:a]asplit={len(transition_times)}{labels}" if len(transition_times) > 1
                 else f"[{n_in}:a]anull[w0]"]
        for k, t in enumerate(transition_times):
            ms = int(max(t - 0.35, 0) * 1000)
            parts.append(f"[w{k}]volume=0.35,adelay={ms}|{ms}[wd{k}]")
            mix.append(f"[wd{k}]")
        chains.append(";".join(parts))
        n_in += 1
    lufs = plan.loudness_lufs
    chains.append(f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0,"
                  f"loudnorm=I={lufs}:TP=-1.5:LRA=11,aresample={SAMPLE_RATE}[aout]")

    script = work / f"{plan.name}_dress.filter"
    script.write_text(";\n".join(chains))
    out = out_dir / f"{plan.name}.mp4"
    log.info(f"{plan.name}: rendering final video…")
    run_ffmpeg([*inputs, *filter_script_args(script), "-map", "[vout]", "-map", "[aout]",
                "-t", f"{dur:.3f}", "-r", str(plan.fps), "-c:v", "libx264", "-preset", plan.preset,
                "-crf", str(plan.crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart", str(out)], log)
    cut.unlink(missing_ok=True)
    log.progress(1.0, f"{plan.name}: done")
    return out
