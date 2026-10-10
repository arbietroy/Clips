# Clips — AI video editor

Turn long videos into viral short clips and edit them automatically.

| Part | Status | What it does |
|---|---|---|
| **Clip Finder** | ✅ Built | Upload a long video. AI reads the transcript and cuts out the moments most likely to go viral, each with a score out of 100 and the reason it was picked. |
| **Auto Editor** | ✅ Built | Edits a whole video or one clip: cuts ums, uhs, repeats and long pauses; adds animated captions (10 templates), b-roll, mood-matched music with automatic ducking, transitions with sound effects, zoom animations, and a hook title or chapter titles. |
| **Export sizes** | ✅ Built | Asks which size you want before every export: 9:16 (TikTok, Reels, Shorts), 16:9 (YouTube), 1:1, 4:5, 4:3, the original size, or a custom size. When the shape changes, it can follow the speaker's face, fit the video over a blurred background, or crop from the centre. |
| **Sideways footage** | ✅ Built | Portrait videos saved sideways are detected from the faces in them and turned upright automatically (or choose the rotation yourself in the export window). |
| **Manual Editor** | 🔜 Next | A CapCut-style timeline: keyframes, volume, masks, text, filters. Automatic edits will open here so you can fine-tune them. |

```
frontend/   React + TypeScript (Vite): the website
backend/    Python: transcription (Whisper), AI analysis (Claude), rendering (FFmpeg), HTTP API
```

## Run it on your computer

You need **Node.js 18+**, **Python 3.12** and **FFmpeg**.

**Quick start (Windows):** copy `backend\.env.example` to `backend\.env` and fill in your keys, then in PowerShell run:
```powershell
cd clips
.\start.ps1
```
It installs everything on the first run, opens the backend and the website in their own windows, and opens your browser. Keep those two windows open while you use the app. (On Mac/Linux: `./start.sh`.)

**Or start each part by hand:**

**1. Backend (terminal 1)**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...  # AI clip picking — https://console.anthropic.com
export PIXABAY_API_KEY=...           # optional: free stock b-roll — https://pixabay.com/api/docs/
# (or PEXELS_API_KEY — https://www.pexels.com/api/ — either works; both are tried if set)
uvicorn server:app --reload --port 8000
```

**2. Frontend (terminal 2)**
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173.

**3. Music:** put royalty-free tracks in `backend/music/<mood>/` (see `backend/music/README.md`), or upload a track in the Auto Editor.

The first video you process downloads the Whisper speech model, which takes a minute.

## Put it online (to share a link)

**Frontend on Vercel (free)**
1. In Vercel, choose **Add New → Project** and import this repo.
2. Set **Root Directory** to `frontend`. Vercel detects Vite automatically.
3. Add the environment variable `VITE_API_URL` = your backend URL (step 2 below), then deploy.

Even without the backend, the link works for showing the app: every page loads, and a banner explains that the AI server isn't connected.

**Backend on Render (about $7/month)**
1. In Render, choose **New → Blueprint** and pick this repo. It reads `render.yaml`.
2. Fill in `ANTHROPIC_API_KEY`, and optionally `PIXABAY_API_KEY` (or `PEXELS_API_KEY`) and `ACCESS_CODE`.
3. Copy the service URL into Vercel's `VITE_API_URL` and redeploy the frontend.

**Set an `ACCESS_CODE` before sharing.** Without one, anyone who finds the link can run videos through your Claude API key. Give the code to your manager. The site asks for it under **AI server** (top right).

The backend is a standard Docker image (`backend/Dockerfile`), so Railway, Fly.io or any server with Docker works too. It needs about 1 GB of RAM for the `base` Whisper model.

## How it works

```
upload ─► Whisper: word-level transcript ─► Claude: viral clips + scores, chapters,
                                             b-roll ideas, key words, retakes, music mood
                                                       │
     filler / stutter / pause detection ◄──────────────┘
                     │
                     ▼
             edit plan (JSON) ─► FFmpeg pass 1: frame-accurate cuts + transitions
                                 FFmpeg pass 2: resize/reframe, zooms, b-roll, captions,
                                                music ducking, whooshes, loudness (-14 LUFS)
```

API: `POST /api/videos` (upload), `POST /api/jobs` (`find_clips` or `auto_edit`), `GET /api/jobs/{id}` (progress and results), `GET /api/health`.

The backend also has a command line: `python -m clipforge find video.mp4`, `python -m clipforge edit video.mp4 --format square --template hormozi`. Run `python -m clipforge --help` for every option.
