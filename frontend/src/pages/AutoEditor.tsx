import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ExportDialog from "../components/ExportDialog";
import { FormatValue } from "../components/FormatPicker";
import JobProgress from "../components/JobProgress";
import OutputCard from "../components/OutputCard";
import TemplatePicker from "../components/TemplatePicker";
import Toggle from "../components/Toggle";
import UploadDrop from "../components/UploadDrop";
import { FormatId } from "../data/formats";
import { LANGUAGES, MOODS } from "../data/templates";
import { apiUrl, createJob, getVideo, JobOptions, Output, uploadAudio, VideoInfo } from "../lib/api";
import { fmtTime, rememberVideo, useJob } from "../lib/hooks";

type Scope = "whole" | "range";

export default function AutoEditor() {
  const [params, setParams] = useSearchParams();
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // what to edit
  const [scope, setScope] = useState<Scope>("whole");
  const [range, setRange] = useState<[number, number]>([0, 60]);

  // style
  const [template, setTemplate] = useState("bold-pop");
  const [captions, setCaptions] = useState(true);
  const [customHighlight, setCustomHighlight] = useState(false);
  const [highlight, setHighlight] = useState("#FFE600");
  const [hookTitle, setHookTitle] = useState(true);
  const [chapterTitles, setChapterTitles] = useState(true);

  // enhancements
  const [broll, setBroll] = useState(true);
  const [music, setMusic] = useState(true);
  const [mood, setMood] = useState<string>("auto");
  const [track, setTrack] = useState<{ id: string; name: string } | null>(null);
  const [trackProgress, setTrackProgress] = useState<number | null>(null);
  const [transitions, setTransitions] = useState(true);
  const [zoom, setZoom] = useState(true);
  const [fillers, setFillers] = useState(true);
  const [aggressive, setAggressive] = useState(false);
  const [retakes, setRetakes] = useState(true);
  const [language, setLanguage] = useState("en");

  // export
  const [format, setFormat] = useState<FormatValue>({
    format: (params.get("format") as FormatId) || "vertical",
    reframe: "face", rotate: "auto",
  });
  const [asking, setAsking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [results, setResults] = useState<Output[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { job } = useJob(jobId);

  // Arriving from the Clip Finder: ?video=…&start=…&end=…
  useEffect(() => {
    const id = params.get("video");
    if (!id || video?.id === id) return;
    getVideo(id)
      .then((v) => {
        setVideo(v);
        rememberVideo(v);
        const s = params.get("start"), e = params.get("end");
        if (s && e) {
          setScope("range");
          setRange([+s, +e]);
        }
      })
      .catch(() => setLoadError("That video isn't on the server any more. Please upload it again."));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (job?.status === "done") {
      setResults((r) => [...job.outputs.filter((o) => !r.some((x) => x.file === o.file)), ...r]);
    }
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const clips = video?.clips ?? [];
  const isShortRange = scope === "range";
  const selectedClip = useMemo(
    () => clips.find((c) => Math.abs(c.start - range[0]) < 0.5 && Math.abs(c.end - range[1]) < 0.5),
    [clips, range],
  );

  const pickVideo = (v: VideoInfo) => {
    setVideo(v);
    setParams({ video: v.id });
    setScope("whole");
    setResults([]);
    setJobId(null);
  };

  const options = (f: FormatValue): JobOptions => ({
    ...f,
    template,
    captions,
    highlight: customHighlight ? highlight : null,
    hook_title: hookTitle,
    chapter_titles: chapterTitles,
    broll,
    music,
    music_mood: mood === "auto" ? null : mood,
    music_id: track?.id ?? null,
    transitions,
    zoom,
    fillers,
    aggressive,
    retakes,
    language,
  });

  const run = async (f: FormatValue) => {
    setAsking(false);
    setFormat(f);
    setError(null);
    try {
      const j = await createJob({
        type: "auto_edit",
        video_id: video!.id,
        range: scope === "range" ? range : null,
        options: options(f),
      });
      setJobId(j.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const addTrack = async (file?: File) => {
    if (!file) return;
    setTrackProgress(0);
    try {
      setTrack(await uploadAudio(file, setTrackProgress));
      setMusic(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrackProgress(null);
    }
  };

  const running = job && (job.status === "queued" || job.status === "running");

  return (
    <div className="page">
      {video && (
        <Link to={`/projects/${video.id}`} className="back">
          ← Back to project (all clips &amp; exports)
        </Link>
      )}
      <h1>Auto Editor</h1>
      <p className="lead">
        Edit a whole video or one clip automatically. Ums and repeats are cut, and captions, b-roll, music, transitions
        and zooms are added for you.
      </p>

      {!video ? (
        <>
          <UploadDrop onReady={pickVideo} hint="A long video to edit in full, or a short clip" />
          {loadError && <p className="error">{loadError}</p>}
        </>
      ) : (
        <div className="editor-grid">
          <aside className="panel source sticky">
            <video src={apiUrl(video.url) + (isShortRange ? `#t=${range[0]},${range[1]}` : "")} controls preload="metadata" />
            <p className="meta">
              {video.name} · {fmtTime(video.duration)} · {video.width}×{video.height}
            </p>
            {!!video.rotation && (
              <p className="notice small">Looks sideways: it will be turned upright when exported.</p>
            )}
            <button className="link" disabled={!!running} onClick={() => (setVideo(null), setParams({}), setResults([]), setJobId(null))}>
              Use a different video
            </button>

            <label className="field top-gap">
              Spoken language
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
            </label>

            <h3>What to edit</h3>
            <div className="seg">
              <button className={scope === "whole" ? "active" : ""} onClick={() => setScope("whole")}>
                Whole video
              </button>
              <button className={scope === "range" ? "active" : ""} onClick={() => setScope("range")}>
                A clip / part
              </button>
            </div>
            {scope === "range" && (
              <div className="range-box">
                {clips.length > 0 && (
                  <label className="field">
                    Clips found in this video
                    <select
                      value={selectedClip ? `${selectedClip.start}` : ""}
                      onChange={(e) => {
                        const c = clips.find((x) => `${x.start}` === e.target.value);
                        if (c) setRange([c.start, c.end]);
                      }}
                    >
                      <option value="">Custom range</option>
                      {clips.map((c) => (
                        <option key={c.start} value={`${c.start}`}>
                          {c.virality_score} · {c.title} ({fmtTime(c.start)}–{fmtTime(c.end)})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="row gap">
                  <label className="field">
                    Start (s)
                    <input type="number" min={0} max={video.duration} step={0.5} value={range[0]} onChange={(e) => setRange([+e.target.value, range[1]])} />
                  </label>
                  <label className="field">
                    End (s)
                    <input type="number" min={0} max={video.duration} step={0.5} value={range[1]} onChange={(e) => setRange([range[0], +e.target.value])} />
                  </label>
                </div>
                <p className="muted small">
                  {fmtTime(range[0])} → {fmtTime(range[1])} ({Math.max(0, range[1] - range[0]).toFixed(0)}s)
                </p>
              </div>
            )}
          </aside>

          <div className="settings">
            <section className="panel">
              <div className="panel-head">
                <h2>Captions</h2>
                <Toggle label="On" checked={captions} onChange={setCaptions} />
              </div>
              {captions && (
                <>
                  <TemplatePicker value={template} onChange={setTemplate} highlight={customHighlight ? highlight : null} />
                  <div className="row gap wrap top-gap">
                    <Toggle label="Custom highlight colour" checked={customHighlight} onChange={setCustomHighlight} />
                    {customHighlight && <input type="color" value={highlight} onChange={(e) => setHighlight(e.target.value)} />}
                  </div>
                </>
              )}
            </section>

            <section className="panel">
              <h2>Editing</h2>
              <div className="toggles">
                <Toggle label="Cut ums, uhs & stutters" hint="Also tightens long pauses" checked={fillers} onChange={setFillers} />
                <Toggle label="Cut retakes & repeated lines" hint="When a sentence is started again, keep only the last try" checked={retakes} onChange={setRetakes} />
                {fillers && <Toggle label="Also cut “you know”, “I mean”, “like,”" checked={aggressive} onChange={setAggressive} />}
                <Toggle label="B-roll" hint="Stock footage over matching moments" checked={broll} onChange={setBroll} />
                <Toggle label="Transitions" hint="With a whoosh sound effect" checked={transitions} onChange={setTransitions} />
                <Toggle label="Zoom animations" hint="Punch-ins on key words and jump cuts" checked={zoom} onChange={setZoom} />
                {isShortRange ? (
                  <Toggle label="Hook title" hint="Big title for the first seconds" checked={hookTitle} onChange={setHookTitle} />
                ) : (
                  <Toggle label="Chapter titles" hint="Animated title at each topic change" checked={chapterTitles} onChange={setChapterTitles} />
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Background music</h2>
                <Toggle label="On" checked={music} onChange={setMusic} />
              </div>
              {music && (
                <>
                  <div className="chips">
                    <button className={`chip ${mood === "auto" && !track ? "active" : ""}`} onClick={() => (setMood("auto"), setTrack(null))}>
                      ✦ Match the video
                    </button>
                    {MOODS.map((m) => (
                      <button key={m} className={`chip ${mood === m && !track ? "active" : ""}`} onClick={() => (setMood(m), setTrack(null))}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <label className="upload-track">
                    <input type="file" accept="audio/*" hidden onChange={(e) => addTrack(e.target.files?.[0])} />
                    {trackProgress !== null
                      ? `Uploading ${Math.round(trackProgress * 100)}%…`
                      : track
                        ? `♪ Using your track: ${track.name} (change)`
                        : "Or upload your own track"}
                  </label>
                  <p className="muted small">Music is lowered automatically whenever someone speaks.</p>
                </>
              )}
            </section>

            <div className="export-bar">
              <button className="btn big" disabled={!!running || (scope === "range" && range[1] - range[0] < 3)} onClick={() => setAsking(true)}>
                {running ? "Editing…" : "Edit & export"}
              </button>
              {error && <p className="error">{error}</p>}
            </div>
          </div>
        </div>
      )}

      {job && (running || job.status === "error") && <JobProgress job={job} />}

      {results.length > 0 && (
        <section>
          <div className="section-row">
            <h2 className="section-title">Your edits</h2>
            {video && <Link to={`/projects/${video.id}`} className="link">See everything for this video →</Link>}
          </div>
          <div className="cards">
            {results.map((o) => (
              <OutputCard
                key={o.file ?? o.name}
                o={o}
                wide={o.width > o.height}
                actions={
                  <button className="btn small ghost" disabled={!!running} onClick={() => setAsking(true)}>
                    Export in another size
                  </button>
                }
              />
            ))}
          </div>
        </section>
      )}

      {asking && video && (
        <ExportDialog initial={format} source={video} onCancel={() => setAsking(false)} onExport={run} />
      )}
    </div>
  );
}
