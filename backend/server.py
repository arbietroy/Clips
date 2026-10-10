"""HTTP API for the Clips web app.

    uvicorn server:app --reload            (from the backend/ folder)

Environment:
    ANTHROPIC_API_KEY   AI clip finding and edit planning
    PEXELS_API_KEY      automatic stock b-roll from Pexels
    PIXABAY_API_KEY     automatic stock b-roll from Pixabay
    ACCESS_CODE         optional: require this code from the web app (protects your API credits)
    CORS_ORIGINS        comma-separated allowed origins (default: *)
    CLIPS_DATA          where uploads and renders are stored (default: ./data)
    WHISPER_MODEL       default speech model: tiny / base / small / medium / large-v3 (default: small)
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from clipforge.analyze import ClipIdea
from clipforge.assets import AUDIO_EXT, VIDEO_EXT
from clipforge.config import MOODS, Settings
from clipforge.formats import FORMATS
from clipforge.log import Log
from clipforge.media import probe, run_ffmpeg
from clipforge.pipeline import list_outputs
from clipforge.render import ROTATE_FILTERS
from clipforge.transcript import Transcript
from clipforge.reframe import detect_rotation
from clipforge.templates import TEMPLATES

HERE = Path(__file__).resolve().parent


def _load_env_file(path: Path) -> None:
    """Read KEY=value lines from backend/.env (if present) without overriding real env vars."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if value and not os.environ.get(key.strip()):
            os.environ[key.strip()] = value


_load_env_file(HERE / ".env")
DATA = Path(os.environ.get("CLIPS_DATA", HERE / "data")).resolve()
VIDEOS = DATA / "videos"
AUDIO = DATA / "audio"
for d in (VIDEOS, AUDIO):
    d.mkdir(parents=True, exist_ok=True)

ACCESS_CODE = os.environ.get("ACCESS_CODE") or None

app = FastAPI(title="Clips API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


def check_access(x_access_code: str | None = Header(default=None)) -> None:
    if ACCESS_CODE and x_access_code != ACCESS_CODE:
        raise HTTPException(401, "Access code required")


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

jobs: dict[str, dict] = {}
work_queue: "queue.Queue[str]" = queue.Queue()


class JobOptions(BaseModel):
    num_clips: int = Field(5, ge=1, le=20)
    length: float = Field(60, ge=15, le=180)
    format: str = "vertical"
    custom_width: int | None = None
    custom_height: int | None = None
    template: str = "bold-pop"
    highlight: str | None = None
    captions: bool = True
    hook_title: bool = True
    chapter_titles: bool = True
    broll: bool = True
    music: bool = True
    music_mood: str | None = None
    music_id: str | None = None          # an uploaded audio track
    transitions: bool = True
    zoom: bool = True
    fillers: bool = True
    retakes: bool = True                  # cut false starts / repeated lines
    clean: bool = False                   # Clip Finder exports: also cut silences, ums and retakes
    aggressive: bool = False
    reframe: str = "face"
    rotate: str = "auto"                  # auto | 0 | 90 | 180 | 270 (clockwise)
    whisper: str = os.environ.get("WHISPER_MODEL", "small")
    language: str | None = None


class ClipIn(BaseModel):
    start: float
    end: float
    title: str = "Clip"
    hook_text: str = ""
    virality_score: int = 0
    reason: str = ""
    music_mood: str = "upbeat"


class JobRequest(BaseModel):
    type: str                             # "analyze" | "find_clips" | "auto_edit"
    video_id: str
    range: list[float] | None = None      # auto_edit only: [start, end] in source seconds
    clips: list[ClipIn] | None = None     # find_clips only: the clips to export (default: all found)
    options: JobOptions = JobOptions()


def build_settings(o: JobOptions) -> Settings:
    s = Settings()
    s.num_clips = o.num_clips
    s.clip_target_seconds = o.length
    s.clip_min_seconds = max(15.0, o.length * 0.75)
    s.clip_max_seconds = o.length * 1.25
    s.format = o.format if o.format in FORMATS or o.format == "custom" else "vertical"
    if o.format == "custom" and o.custom_width and o.custom_height:
        s.custom_size = (max(240, min(o.custom_width, 3840)), max(240, min(o.custom_height, 3840)))
    s.caption_template = o.template if o.template in TEMPLATES else "bold-pop"
    s.caption_highlight = o.highlight
    s.captions, s.hook_title, s.chapter_titles = o.captions, o.hook_title, o.chapter_titles
    s.broll, s.music, s.transitions = o.broll, o.music, o.transitions
    s.transition_sfx = o.transitions
    s.music_mood = o.music_mood if o.music_mood in MOODS else None
    if o.music_id:
        s.music_file = next(AUDIO.glob(f"{_safe_id(o.music_id)}.*"), None)
    s.zoom_on_jump_cuts = s.emphasis_zoom = o.zoom
    s.remove_fillers = s.remove_repetition = o.fillers
    s.remove_retakes = o.retakes
    s.clean_raw_clips = o.clean
    s.aggressive_fillers = o.aggressive
    s.reframe = o.reframe if o.reframe in ("face", "blur", "center") else "face"
    s.rotate = o.rotate if o.rotate in ("auto", "0", "90", "180", "270") else "auto"
    s.whisper_model = o.whisper if o.whisper in ("tiny", "base", "small", "medium", "large-v3") else "small"
    s.language = o.language
    s.music_dir = HERE / "music"
    s.broll_dir = HERE / "broll"
    return s


def _worker() -> None:
    from clipforge.pipeline import Project

    while True:
        job_id = work_queue.get()
        job = jobs[job_id]
        job["status"] = "running"
        job["started"] = time.time()

        def sink(line: str, pct: float | None) -> None:
            if pct is None:
                job["log"].append(line)
                job["step"] = line.split("] ", 1)[-1]
            else:
                job["step"] = line
                job["progress"] = round(pct, 3)

        try:
            req: JobRequest = job["request"]
            vdir = VIDEOS / req.video_id
            source = next(vdir.glob("source.*"))
            project = Project(source, vdir, build_settings(req.options), Log(sink), project_dir=vdir / "project")
            job["phase"] = "transcribing"
            project.transcript()
            job["phase"] = "analyzing"
            analysis = project.analysis(reuse=req.type != "analyze")
            job["clips"] = [c.__dict__ | {"text": project.clip_text(c.start, c.end)} for c in analysis.clips]
            job["phase"] = "rendering"
            if req.type == "analyze":
                outputs = []          # preview only: nothing is rendered until clips are chosen
            elif req.type == "find_clips":
                chosen = [ClipIdea(**c.model_dump()) for c in req.clips] if req.clips else None
                outputs = project.find_clips(chosen)
            else:
                rng = req.range if req.range and len(req.range) == 2 else [None, None]
                outputs = project.auto_edit(*rng)
            job["outputs"] = [_public_output(req.video_id, o) for o in outputs]
            failed = [o for o in outputs if o.get("error")]
            job["status"] = "error" if failed and len(failed) == len(outputs) else "done"
            if req.type == "analyze" and not analysis.clips:
                job["status"], job["error"] = "error", "No clips found. Try a shorter clip length or a longer video."
            if job["status"] == "error":
                job["error"] = failed[0]["error"]
        except Exception as e:  # report every failure to the UI
            job["status"] = "error"
            job["error"] = str(e)
        job["phase"] = None
        job["finished"] = time.time()


threading.Thread(target=_worker, daemon=True).start()


def _public_output(video_id: str, o: dict) -> dict:
    o = dict(o)
    for key in ("file", "srt", "plan"):
        if o.get(key):
            o[key] = f"/media/{video_id}/{Path(o[key]).name}"
    return o


def _public_job(job: dict) -> dict:
    req: JobRequest = job["request"]
    return {k: v for k, v in job.items() if k != "request"} | {
        "type": req.type, "video_id": req.video_id, "range": req.range, "options": req.options.model_dump(),
        "queue_position": list(work_queue.queue).index(job["id"]) + 1 if job["id"] in work_queue.queue else 0,
    }


def _safe_id(value: str) -> str:
    v = "".join(ch for ch in value if ch.isalnum())
    if not v:
        raise HTTPException(404)
    return v


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    music = HERE / "music"
    return {
        "ok": True,
        "claude": bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")),
        "pexels": bool(os.environ.get("PEXELS_API_KEY")),
        "pixabay": bool(os.environ.get("PIXABAY_API_KEY")),
        "broll": bool(os.environ.get("PEXELS_API_KEY") or os.environ.get("PIXABAY_API_KEY")),
        "music_tracks": sum(1 for p in music.rglob("*") if p.suffix.lower() in AUDIO_EXT) if music.exists() else 0,
        "access_code": bool(ACCESS_CODE),
        "formats": FORMATS,
        "templates": list(TEMPLATES),
        "moods": MOODS,
    }


async def _save_upload(upload: UploadFile, dest: Path) -> None:
    with open(dest, "wb") as fh:
        while chunk := await upload.read(1 << 20):
            fh.write(chunk)


@app.post("/api/videos", dependencies=[Depends(check_access)])
async def upload_video(file: UploadFile = File(...)) -> dict:
    ext = Path(file.filename or "video.mp4").suffix.lower()
    if ext not in VIDEO_EXT:
        raise HTTPException(400, f"Unsupported video type {ext}")
    vid = uuid.uuid4().hex[:12]
    vdir = VIDEOS / vid
    vdir.mkdir(parents=True)
    dest = vdir / f"source{ext}"
    await _save_upload(file, dest)
    try:
        info = probe(dest)
    except Exception as e:
        raise HTTPException(400, f"Could not read this video: {e}")
    if not info.has_audio:
        raise HTTPException(400, "This video has no audio track. Clips edits from the speech.")
    # Spot footage saved sideways now, so the UI can say so before anything is rendered.
    rotation = detect_rotation(dest)
    (vdir / "project").mkdir(exist_ok=True)
    (vdir / "project" / "rotation.json").write_text(json.dumps({"auto": rotation}))
    meta = {"id": vid, "name": file.filename, "duration": info.duration, "width": info.width,
            "height": info.height, "fps": info.fps, "rotation": rotation, "created": time.time()}
    (vdir / "info.json").write_text(json.dumps(meta))
    _make_thumbnail(vdir, meta)
    return _video_public(meta)


def _make_thumbnail(vdir: Path, meta: dict) -> Path | None:
    """A small upright still from about a third of the way in."""
    thumb = vdir / "thumb.jpg"
    if thumb.exists():
        return thumb
    src = next(vdir.glob("source.*"), None)
    if not src:
        return None
    turn = ROTATE_FILTERS.get(meta.get("rotation", 0), "")
    try:
        run_ffmpeg(["-ss", f"{meta.get('duration', 0) / 3:.2f}", "-i", str(src), "-frames:v", "1",
                    "-vf", f"{turn}scale=480:480:force_original_aspect_ratio=decrease", "-q:v", "4", str(thumb)])
    except Exception:
        return None
    return thumb


def _video_public(meta: dict) -> dict:
    vid = meta["id"]
    return meta | {"url": f"/api/videos/{vid}/source", "thumb": f"/api/videos/{vid}/thumb"}


@app.get("/api/videos/{video_id}")
def get_video(video_id: str) -> dict:
    vdir = VIDEOS / _safe_id(video_id)
    if not (vdir / "info.json").exists():
        raise HTTPException(404)
    meta = json.loads((vdir / "info.json").read_text())
    analysis = vdir / "project" / "analysis.json"
    if analysis.exists():
        meta["clips"] = json.loads(analysis.read_text()).get("clips", [])
    return _video_public(meta)


@app.get("/api/videos/{video_id}/thumb")
def video_thumb(video_id: str) -> FileResponse:
    vdir = VIDEOS / _safe_id(video_id)
    if not (vdir / "info.json").exists():
        raise HTTPException(404)
    thumb = _make_thumbnail(vdir, json.loads((vdir / "info.json").read_text()))
    if not thumb:
        raise HTTPException(404)
    return FileResponse(thumb)


# ---------------------------------------------------------------- projects (history)

def _project_summary(vdir: Path) -> dict | None:
    try:
        meta = json.loads((vdir / "info.json").read_text())
    except (OSError, ValueError):
        return None
    proj = vdir / "project"
    clips = 0
    if (proj / "analysis.json").exists():
        try:
            clips = len(json.loads((proj / "analysis.json").read_text()).get("clips", []))
        except ValueError:
            pass
    outputs = list(proj.glob("*.mp4")) if proj.exists() else []
    times = [meta.get("created", 0)] + [p.stat().st_mtime for p in outputs]
    active = [j["id"] for j in jobs.values()
              if j["request"].video_id == meta["id"] and j["status"] in ("queued", "running")]
    return _video_public(meta) | {
        "clips_found": clips, "exports": sum(1 for p in outputs if p.name.startswith("clip_")),
        "edits": sum(1 for p in outputs if p.name.startswith(("edit_", "full_edit"))),
        "updated": max(times), "active_jobs": active,
    }


@app.get("/api/projects")
def list_projects() -> list[dict]:
    items = [s for d in VIDEOS.iterdir() if d.is_dir() and (s := _project_summary(d))]
    return sorted(items, key=lambda p: -p["updated"])


@app.get("/api/projects/{video_id}")
def get_project(video_id: str) -> dict:
    vdir = VIDEOS / _safe_id(video_id)
    summary = _project_summary(vdir)
    if not summary:
        raise HTTPException(404, "Project not found")
    proj = vdir / "project"
    clips = []
    if (proj / "analysis.json").exists():
        clips = json.loads((proj / "analysis.json").read_text()).get("clips", [])
        if (proj / "transcript.json").exists():
            tr = Transcript.load(proj / "transcript.json")
            clips = [c | {"text": tr.text_between(c["start"], c["end"])} for c in clips]
        clips.sort(key=lambda c: -c.get("virality_score", 0))
    outputs = [_public_output(video_id, o) for o in list_outputs(proj)] if proj.exists() else []
    return summary | {"clips": clips, "outputs": outputs}


@app.delete("/api/projects/{video_id}", dependencies=[Depends(check_access)])
def delete_project(video_id: str) -> dict:
    vdir = VIDEOS / _safe_id(video_id)
    if not vdir.exists():
        raise HTTPException(404)
    if any(j["request"].video_id == video_id and j["status"] in ("queued", "running") for j in jobs.values()):
        raise HTTPException(409, "This project is still being processed")
    shutil.rmtree(vdir)
    return {"deleted": video_id}


@app.get("/api/videos/{video_id}/source")
def video_source(video_id: str) -> FileResponse:
    src = next((VIDEOS / _safe_id(video_id)).glob("source.*"), None)
    if not src:
        raise HTTPException(404)
    return FileResponse(src)


@app.post("/api/audio", dependencies=[Depends(check_access)])
async def upload_audio(file: UploadFile = File(...)) -> dict:
    ext = Path(file.filename or "track.mp3").suffix.lower()
    if ext not in AUDIO_EXT:
        raise HTTPException(400, f"Unsupported audio type {ext}")
    aid = uuid.uuid4().hex[:12]
    await _save_upload(file, AUDIO / f"{aid}{ext}")
    return {"id": aid, "name": file.filename}


@app.post("/api/jobs", dependencies=[Depends(check_access)])
def create_job(req: JobRequest) -> dict:
    if req.type not in ("analyze", "find_clips", "auto_edit"):
        raise HTTPException(400, "type must be analyze, find_clips or auto_edit")
    if not (VIDEOS / _safe_id(req.video_id) / "info.json").exists():
        raise HTTPException(404, "Unknown video")
    job_id = uuid.uuid4().hex[:12]
    jobs[job_id] = {"id": job_id, "request": req, "status": "queued", "phase": None, "progress": 0.0,
                    "step": "Waiting in line…", "log": [], "clips": [], "outputs": [], "error": None,
                    "created": time.time()}
    work_queue.put(job_id)
    return _public_job(jobs[job_id])


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job (the server may have restarted)")
    return _public_job(job)


@app.get("/media/{video_id}/{filename}")
def media(video_id: str, filename: str) -> FileResponse:
    base = (VIDEOS / _safe_id(video_id) / "project").resolve()
    path = (base / filename).resolve()
    if path.parent != base or not path.is_file() or path.suffix not in (".mp4", ".srt", ".json"):
        raise HTTPException(404)
    return FileResponse(path, filename=None if path.suffix == ".mp4" else filename)
