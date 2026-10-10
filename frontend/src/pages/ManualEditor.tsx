import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ExportDialog from "../components/ExportDialog";
import { FormatValue } from "../components/FormatPicker";
import JobProgress from "../components/JobProgress";
import OutputCard from "../components/OutputCard";
import TemplatePicker from "../components/TemplatePicker";
import Toggle from "../components/Toggle";
import UploadDrop from "../components/UploadDrop";
import { FormatId } from "../data/formats";
import { MOODS, TEMPLATES } from "../data/templates";
import { apiUrl, createJob, EditorBroll, EditorData, getEditor, getProjects, ProjectSummary } from "../lib/api";
import { fmtTime, useJob } from "../lib/hooks";

// ---------------------------------------------------------------- helpers

interface Span {
  start: number;
  end: number;
}

/** The parts of the source that play: kept words, padded and joined across short pauses (as the server does). */
function keptSpans(data: EditorData, cut: Set<number>): Span[] {
  const pad = data.padding;
  const spans: Span[] = [];
  let prevWordEnd = -1;
  let prevCut = true;
  for (const w of data.words) {
    if (cut.has(w.i)) {
      prevCut = true;
      continue;
    }
    const s = Math.max(w.start - pad, data.range[0]);
    const e = Math.min(w.end + pad, data.range[1]);
    const last = spans[spans.length - 1];
    if (last && !prevCut && w.start - prevWordEnd <= data.max_pause) last.end = e;
    else spans.push({ start: last ? Math.max(s, last.end) : s, end: e });
    prevWordEnd = w.end;
    prevCut = false;
  }
  return spans.filter((s) => s.end - s.start > 0.05);
}

const total = (spans: Span[]) => spans.reduce((a, s) => a + s.end - s.start, 0);

interface Snapshot {
  cut: number[];
  broll: EditorBroll[];
}

const draftKey = (id: string, key: string) => `clips.editor.${id}.${key}`;

// ---------------------------------------------------------------- page

export default function ManualEditor() {
  const { id } = useParams();
  return id ? <Editor id={id} /> : <PickProject />;
}

function PickProject() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    getProjects().then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <div className="page">
      <h1>Manual Editor</h1>
      <p className="lead">
        Edit by text: cut any word or sentence from the transcript and the video follows. Pick a project or upload a
        video to start.
      </p>
      <UploadDrop onReady={(v) => navigate(`/editor/${v.id}`)} hint="Upload a new video to edit" />
      {items && items.length > 0 && (
        <>
          <h2 className="section-title">Or open a project</h2>
          <div className="projects">
            {items.map((p) => (
              <Link key={p.id} to={`/editor/${p.id}`} className="project-card">
                <div className="project-thumb">
                  {p.thumb && <img src={apiUrl(p.thumb)} alt="" loading="lazy" />}
                  <span className="duration">{fmtTime(p.duration)}</span>
                </div>
                <div className="card-body">
                  <h3>{p.name}</h3>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Editor({ id }: { id: string }) {
  const [params] = useSearchParams();
  const start = params.get("start");
  const end = params.get("end");
  const source = params.get("source");
  const key = source ? `src-${source}` : `${start ?? "0"}-${end ?? "end"}`;

  const [data, setData] = useState<EditorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepJob, setPrepJob] = useState<string | null>(null);
  const { job: prep } = useJob(prepJob);

  // edit state
  const [cut, setCut] = useState<Set<number>>(new Set());
  const [broll, setBroll] = useState<EditorBroll[]>([]);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<[number, number] | null>(null); // positions in `words`
  const [activeBroll, setActiveBroll] = useState<number | null>(null);

  // look & sound
  const [captions, setCaptions] = useState(true);
  const [template, setTemplate] = useState("bold-pop");
  const [music, setMusic] = useState(true);
  const [mood, setMood] = useState("auto");
  const [zoom, setZoom] = useState(true);
  const [brollOn, setBrollOn] = useState(true);
  const [format, setFormat] = useState<FormatValue>({ format: "vertical", reframe: "face", rotate: "auto" });
  const [tab, setTab] = useState<"look" | "broll">("look");

  // export
  const [asking, setAsking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useJob(jobId);

  const load = useCallback(() => {
    getEditor(id, { start, end, source })
      .then((d) => {
        setData(d);
        if (d.needs_transcript) return;
        let initial: Snapshot = { cut: d.cut ?? d.auto_cut, broll: d.broll };
        try {
          const saved = localStorage.getItem(draftKey(id, key));
          if (saved) initial = JSON.parse(saved);
        } catch {
          /* ignore */
        }
        setCut(new Set(initial.cut));
        setBroll(initial.broll);
        const s = d.settings || {};
        if (s.template) setTemplate(s.template);
        if (s.captions !== undefined) setCaptions(!!s.captions);
        if (s.music !== undefined) setMusic(!!s.music);
        if (s.music_mood) setMood(s.music_mood);
        if (s.zoom !== undefined) setZoom(!!s.zoom);
        if (s.broll !== undefined) setBrollOn(!!s.broll);
        if (s.format) setFormat((f) => ({ ...f, format: s.format as FormatId }));
      })
      .catch((e) => setError(e.message));
  }, [id, start, end, source, key]);

  useEffect(load, [load]);
  useEffect(() => {
    if (prep?.status === "done") load();
  }, [prep?.status, load]);

  // autosave the draft
  useEffect(() => {
    if (!data || data.needs_transcript) return;
    try {
      localStorage.setItem(draftKey(id, key), JSON.stringify({ cut: [...cut], broll }));
    } catch {
      /* ignore */
    }
  }, [cut, broll, data, id, key]);

  const commit = (next: Snapshot) => {
    setPast((p) => [...p.slice(-100), { cut: [...cut], broll }]);
    setFuture([]);
    setCut(new Set(next.cut));
    setBroll(next.broll);
  };
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setFuture((f) => [{ cut: [...cut], broll }, ...f]);
    setPast((p) => p.slice(0, -1));
    setCut(new Set(prev.cut));
    setBroll(prev.broll);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, { cut: [...cut], broll }]);
    setFuture((f) => f.slice(1));
    setCut(new Set(next.cut));
    setBroll(next.broll);
  };

  const words = data?.words ?? [];
  const spans = useMemo(() => (data && !data.needs_transcript ? keptSpans(data, cut) : []), [data, cut]);
  const editedLength = total(spans);

  // ------------------------------------------------------------ player (skips the cut parts)
  const video = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number>();

  const nextKept = (time: number) => spans.find((s) => s.end > time + 0.01);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const v = video.current;
      if (v) {
        const now = v.currentTime;
        const inside = spans.find((s) => now >= s.start - 0.02 && now < s.end);
        if (!inside) {
          const nxt = nextKept(now);
          if (nxt) v.currentTime = nxt.start;
          else {
            v.pause();
            v.currentTime = spans[0]?.start ?? data!.range[0];
          }
        }
        setT(v.currentTime);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current!);
  }, [playing, spans]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (!v.paused) return v.pause();
    if (!spans.some((s) => v.currentTime >= s.start && v.currentTime < s.end)) {
      v.currentTime = (nextKept(v.currentTime) ?? spans[0])?.start ?? v.currentTime;
    }
    v.play();
  };
  const seek = (time: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = time;
    setT(time);
  };

  useEffect(() => {
    if (data && !data.needs_transcript && video.current) {
      const first = spans[0]?.start ?? data.range[0];
      video.current.currentTime = first;
      setT(first);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // position of the playhead in the edited video
  const editedNow = useMemo(() => {
    let acc = 0;
    for (const s of spans) {
      if (t >= s.end) acc += s.end - s.start;
      else if (t >= s.start) return acc + (t - s.start);
      else break;
    }
    return acc;
  }, [t, spans]);

  // ------------------------------------------------------------ transcript selection
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeWord = useMemo(() => words.findIndex((w) => t >= w.start && t < w.end + 0.05), [t, words]);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (!follow || !playing || activeWord < 0) return;
    const el = transcriptRef.current?.querySelector(`[data-k="${activeWord}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeWord, follow, playing]);

  const readSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return null;
    const pos = (n: Node) => {
      const el = (n.nodeType === 3 ? n.parentElement : (n as HTMLElement))?.closest("[data-k]") as HTMLElement | null;
      return el ? Number(el.dataset.k) : null;
    };
    const a = pos(sel.anchorNode);
    const b = pos(sel.focusNode);
    if (a === null || b === null) return null;
    return [Math.min(a, b), Math.max(a, b)] as [number, number];
  };

  const setRange = (from: number, to: number, makeCut: boolean) => {
    const next = new Set(cut);
    for (let k = from; k <= to; k++) {
      if (makeCut) next.add(words[k].i);
      else next.delete(words[k].i);
    }
    commit({ cut: [...next], broll });
    setSelected(null);
    window.getSelection()?.removeAllRanges();
  };

  const toggleSentence = (s: [number, number]) => {
    const from = words.findIndex((w) => w.i === s[0]);
    const to = words.findIndex((w) => w.i === s[1]);
    if (from < 0 || to < 0) return;
    const allCut = words.slice(from, to + 1).every((w) => cut.has(w.i));
    setRange(from, to, !allCut);
  };

  // keyboard: Delete cuts the selection, Ctrl+Z / Ctrl+Shift+Z, Space plays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        setRange(selected[0], selected[1], true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-bound every render so the handlers see the current state

  // ------------------------------------------------------------ b-roll
  const updateBroll = (k: number, patch: Partial<EditorBroll>) =>
    commit({ cut: [...cut], broll: broll.map((b, i) => (i === k ? { ...b, ...patch } : b)) });
  const addBroll = () => {
    const s = +Math.max(data!.range[0], t).toFixed(2);
    const nb = [...broll, { start: s, end: +(s + 3).toFixed(2), label: "" }].sort((a, b) => a.start - b.start);
    commit({ cut: [...cut], broll: nb });
    setActiveBroll(nb.findIndex((b) => b.start === s && !b.label));
    setTab("broll");
    setFocusBroll((n) => n + 1);
  };

  // put the cursor in a newly added b-roll's box
  const [focusBroll, setFocusBroll] = useState(0);
  useEffect(() => {
    if (!focusBroll) return;
    const el = document.querySelector(".broll-row.active input:not([type])") as HTMLInputElement | null;
    el?.focus();
  }, [focusBroll]);

  // ------------------------------------------------------------ export
  const exportEdit = async (f: FormatValue) => {
    setAsking(false);
    setFormat(f);
    setError(null);
    try {
      const j = await createJob({
        type: "manual",
        video_id: id,
        range: data!.range,
        cut_words: [...cut],
        broll: broll.filter((b) => b.label.trim()),
        title: data?.title ?? undefined,
        options: {
          ...f,
          template,
          captions,
          music,
          music_mood: mood === "auto" ? null : mood,
          zoom,
          broll: brollOn,
          language: data?.language ?? "en",
        },
      });
      setJobId(j.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // ------------------------------------------------------------ render
  if (error && !data) {
    return (
      <div className="page narrow">
        <h1>Manual Editor</h1>
        <p className="error">{error}</p>
        <Link to="/editor" className="btn">Pick another project</Link>
      </div>
    );
  }
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;

  if (data.needs_transcript) {
    const preparing = prep && (prep.status === "queued" || prep.status === "running");
    return (
      <div className="page narrow">
        <Link to={`/projects/${id}`} className="back">← Back to project</Link>
        <h1>Manual Editor</h1>
        <p className="lead">
          “{data.name}” needs a transcript before you can edit it by text. This takes a few minutes the first time.
        </p>
        {!prepJob && (
          <button
            className="btn big"
            onClick={async () => {
              try {
                const j = await createJob({ type: "analyze", video_id: id, options: { language: "en" } });
                setPrepJob(j.id);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Prepare the transcript
          </button>
        )}
        {prep && (preparing || prep.status === "error") && <JobProgress job={prep} />}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const rot = data.rotation ?? 0;
  const sideways = rot === 90 || rot === 270;
  const [vw, vh] = sideways ? [data.height, data.width] : [data.width, data.height];
  const videoStyle: CSSProperties = sideways
    ? { position: "absolute", left: "50%", top: "50%", width: `${(data.width / data.height) * 100}%`, height: "auto",
        aspectRatio: `${data.width} / ${data.height}`, transform: `translate(-50%, -50%) rotate(${rot}deg)` }
    : rot === 180
      ? { transform: "rotate(180deg)" }
      : {};
  const tpl = TEMPLATES.find((x) => x.id === template) ?? TEMPLATES[0];

  // caption over the preview: the kept words up to the playhead
  const captionWords: { text: string; on: boolean }[] = [];
  if (captions && activeWord >= 0 && !cut.has(words[activeWord].i)) {
    const n = Math.min(tpl.words, 4);
    for (let k = activeWord; k >= 0 && captionWords.length < n && activeWord - k < n + 3; k--) {
      if (!cut.has(words[k].i)) captionWords.unshift({ text: words[k].text, on: k === activeWord });
    }
  }

  const [r0, r1] = data.range;
  const pct = (x: number) => `${((x - r0) / Math.max(r1 - r0, 0.001)) * 100}%`;
  const exporting = job && (job.status === "queued" || job.status === "running");
  const nCut = words.filter((w) => cut.has(w.i)).length;
  const brollNow = broll.find((b) => t >= b.start && t < b.end && b.label);

  return (
    <div className="page wide-page">
      <div className="editor-top">
        <Link to={`/projects/${id}`} className="back">← {data.name}</Link>
        <div className="editor-stats">
          <span>Original <b>{fmtTime(r1 - r0)}</b></span>
          <span>→</span>
          <span className="accent">Edited <b>{fmtTime(editedLength)}</b></span>
          <span className="muted small">{nCut} words cut</span>
        </div>
        <div className="row gap wrap">
          <button className="btn ghost small" disabled={!past.length} onClick={undo} title="Ctrl+Z">↶ Undo</button>
          <button className="btn ghost small" disabled={!future.length} onClick={redo} title="Ctrl+Shift+Z">↷ Redo</button>
          <button className="btn ghost small" onClick={() => commit({ cut: [...new Set([...cut, ...data.auto_cut])], broll })}>
            ✦ Apply suggested cuts
          </button>
          <button className="btn ghost small" onClick={() => commit({ cut: [], broll })}>Restore all words</button>
          <button className="btn" disabled={!!exporting || !spans.length} onClick={() => setAsking(true)}>
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>

      <div className="editor-shell">
        <div className="editor-left">
          <div className="editor-preview" style={{ aspectRatio: `${vw} / ${vh}` }} onClick={togglePlay}>
            <video
              ref={video}
              src={apiUrl(data.url)}
              preload="auto"
              playsInline
              style={videoStyle}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => !playing && setT(e.currentTarget.currentTime)}
            />
            {brollNow && <span className="broll-badge">B-roll here: {brollNow.label}</span>}
            {captionWords.length > 0 && (
              <div className={`preview-caption pos-${tpl.position}`}>
                <span
                  style={{
                    fontFamily: `"${tpl.font}", sans-serif`,
                    fontWeight: tpl.weight,
                    textTransform: tpl.upper ? "uppercase" : "none",
                    color: tpl.color,
                    background: tpl.box ? tpl.boxColor : "transparent",
                    padding: tpl.box ? "2px 8px" : 0,
                    borderRadius: 6,
                    textShadow: tpl.box ? "none" : "0 0 3px #000, 0 0 3px #000, 2px 2px 4px #000",
                  }}
                >
                  {captionWords.map((w, k) => (
                    <span key={k} style={w.on && tpl.highlights[0] ? { color: tpl.highlights[0] } : undefined}>
                      {k ? " " : ""}
                      {w.text}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {!playing && <span className="play-big">▶</span>}
          </div>
          <div className="player-bar">
            <button className="btn small" onClick={togglePlay}>{playing ? "❚❚ Pause" : "▶ Play edit"}</button>
            <span className="muted small">{fmtTime(editedNow)} / {fmtTime(editedLength)}</span>
            <label className="follow small">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow text
            </label>
          </div>

          <div className="panel editor-panel">
            <div className="seg small-seg">
              <button className={tab === "look" ? "active" : ""} onClick={() => setTab("look")}>Captions &amp; sound</button>
              <button className={tab === "broll" ? "active" : ""} onClick={() => setTab("broll")}>B-roll ({broll.length})</button>
            </div>
            {tab === "look" ? (
              <div className="editor-settings">
                <div className="toggles">
                  <Toggle label="Captions" checked={captions} onChange={setCaptions} />
                  <Toggle label="Zoom animations" checked={zoom} onChange={setZoom} />
                  <Toggle label="Background music" checked={music} onChange={setMusic} />
                </div>
                {music && (
                  <div className="chips top-gap">
                    <button className={`chip ${mood === "auto" ? "active" : ""}`} onClick={() => setMood("auto")}>✦ Match the video</button>
                    {MOODS.map((m) => (
                      <button key={m} className={`chip ${mood === m ? "active" : ""}`} onClick={() => setMood(m)}>{m}</button>
                    ))}
                  </div>
                )}
                {captions && (
                  <div className="top-gap compact-templates">
                    <TemplatePicker value={template} onChange={setTemplate} />
                  </div>
                )}
              </div>
            ) : (
              <div className="editor-settings">
                <div className="row gap wrap">
                  <Toggle label="Use b-roll" checked={brollOn} onChange={setBrollOn} />
                  <button className="btn small" onClick={addBroll}>+ Add b-roll at {fmtTime(Math.max(0, t - r0))}</button>
                  {broll.length > 0 && (
                    <button className="btn ghost small" onClick={() => commit({ cut: [...cut], broll: [] })}>Remove all</button>
                  )}
                </div>
                <p className="muted small">
                  Footage is only used when its tags match what you type (e.g. “voting”, “parliament”, “money”). If
                  nothing matches, that b-roll is skipped rather than showing something unrelated.
                </p>
                {broll.length === 0 && <p className="muted">No b-roll yet.</p>}
                {broll.map((b, k) => (
                  <div key={k} className={`broll-row ${activeBroll === k ? "active" : ""}`} onClick={() => setActiveBroll(k)}>
                    <button className="mini" onClick={(e) => (e.stopPropagation(), seek(b.start))} title="Go there">
                      ▶ {fmtTime(b.start - r0)}
                    </button>
                    <input
                      value={b.label}
                      placeholder="What to show, e.g. voting"
                      onChange={(e) => setBroll(broll.map((x, i) => (i === k ? { ...x, label: e.target.value } : x)))}
                    />
                    <label className="small muted">
                      for{" "}
                      <input
                        type="number"
                        min={1}
                        max={8}
                        step={0.5}
                        value={+(b.end - b.start).toFixed(1)}
                        onChange={(e) => updateBroll(k, { end: +(b.start + Math.max(1, +e.target.value)).toFixed(2) })}
                      />{" "}
                      s
                    </label>
                    <button
                      className="mini danger"
                      onClick={(e) => (e.stopPropagation(), commit({ cut: [...cut], broll: broll.filter((_, i) => i !== k) }))}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="editor-right panel">
          <div className="transcript-head">
            <h2>Transcript</h2>
            <span className="muted small">
              Select words and press <kbd>Delete</kbd> to cut · click a word to jump there · ✂ cuts a whole sentence ·
              crossed-out = cut
            </span>
          </div>
          {selected && (
            <div className="selection-bar">
              <span className="small">{selected[1] - selected[0] + 1} words selected</span>
              <button className="btn small" onClick={() => setRange(selected[0], selected[1], true)}>✂ Cut</button>
              <button className="btn small ghost" onClick={() => setRange(selected[0], selected[1], false)}>Restore</button>
              <button className="btn small ghost" onClick={() => (seek(words[selected[0]].start), setSelected(null))}>▶ From here</button>
            </div>
          )}
          <div className="transcript" ref={transcriptRef} onMouseUp={() => setSelected(readSelection())}>
            {data.sentences.map((s) => {
              const from = words.findIndex((w) => w.i === s[0]);
              const to = words.findIndex((w) => w.i === s[1]);
              const ws = words.slice(from, to + 1);
              const allCut = ws.every((w) => cut.has(w.i));
              return (
                <p key={s[0]} className={`sentence ${allCut ? "all-cut" : ""}`}>
                  <button
                    className="sentence-cut"
                    title={allCut ? "Restore this sentence" : "Cut this sentence"}
                    onClick={() => toggleSentence(s)}
                  >
                    {allCut ? "↺" : "✂"}
                  </button>
                  {ws.map((w, n) => {
                    const k = from + n;
                    const isCut = cut.has(w.i);
                    const auto = isCut && data.auto_cut.includes(w.i);
                    const inSel = selected && k >= selected[0] && k <= selected[1];
                    return (
                      <span
                        key={w.i}
                        data-k={k}
                        className={`w${isCut ? " cut" : ""}${auto ? " auto" : ""}${k === activeWord ? " now" : ""}${inSel ? " sel" : ""}`}
                        onClick={() => {
                          if (window.getSelection()?.isCollapsed) seek(w.start);
                        }}
                        title={isCut ? (auto ? "Cut automatically (filler, retake or off-script)" : "Cut") : fmtTime(w.start - r0)}
                      >
                        {w.text}{" "}
                      </span>
                    );
                  })}
                </p>
              );
            })}
          </div>
        </div>
      </div>

      <div className="timeline panel">
        <div
          className="tl-track kept-track"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(r0 + ((e.clientX - r.left) / r.width) * (r1 - r0));
          }}
        >
          {spans.map((s, k) => (
            <div key={k} className="tl-kept" style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }} />
          ))}
          <div className="tl-head" style={{ left: pct(t) }} />
        </div>
        <div className="tl-track broll-track">
          {broll.map((b, k) => (
            <div
              key={k}
              className={`tl-broll${activeBroll === k ? " active" : ""}${b.label ? "" : " empty"}`}
              style={{ left: pct(b.start), width: `calc(${pct(b.end)} - ${pct(b.start)})` }}
              title={b.label || "(no subject yet)"}
              onClick={() => (setActiveBroll(k), setTab("broll"), seek(b.start))}
            >
              {b.label || "?"}
            </div>
          ))}
          <div className="tl-head" style={{ left: pct(t) }} />
        </div>
        <div className="tl-legend muted small">
          <span><i className="dot kept" /> kept</span>
          <span><i className="dot cutd" /> cut</span>
          <span><i className="dot br" /> b-roll</span>
          <span>{fmtTime(t - r0)} in the original</span>
        </div>
      </div>

      {job && (exporting || job.status === "error") && <JobProgress job={job} />}
      {job?.status === "done" && job.outputs.length > 0 && (
        <section>
          <div className="section-row">
            <h2 className="section-title">Exported</h2>
            <Link to={`/projects/${id}`} className="link">See everything for this video →</Link>
          </div>
          <div className="cards">
            {job.outputs.map((o) => (
              <OutputCard key={o.file ?? o.name} o={o} />
            ))}
          </div>
        </section>
      )}
      {error && <p className="error">{error}</p>}

      {asking && (
        <ExportDialog
          title="Export your edit: choose the size"
          initial={format}
          source={data}
          onCancel={() => setAsking(false)}
          onExport={exportEdit}
        />
      )}
    </div>
  );
}
