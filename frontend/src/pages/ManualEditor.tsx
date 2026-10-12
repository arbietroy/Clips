import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import BrollLibrary from "../components/editor/BrollLibrary";
import {
  covered,
  EMPTY,
  KF_SNAP,
  keptSpans,
  mergeRanges,
  motionAt,
  pieces as makePieces,
  Range,
  removeRange,
  Snapshot,
  total,
  wordIsCut,
} from "../components/editor/model";
import Timeline from "../components/editor/Timeline";
import ExportDialog from "../components/ExportDialog";
import { FormatValue } from "../components/FormatPicker";
import JobProgress from "../components/JobProgress";
import OutputCard from "../components/OutputCard";
import TemplatePicker from "../components/TemplatePicker";
import Toggle from "../components/Toggle";
import UploadDrop from "../components/UploadDrop";
import { FORMATS, FormatId } from "../data/formats";
import { MOODS, TEMPLATES } from "../data/templates";
import {
  apiUrl,
  clipUrl,
  createJob,
  EditorBroll,
  EditorData,
  getEditor,
  getProjects,
  Keyframe,
  ProjectSummary,
  searchBroll,
  StockClip,
} from "../lib/api";
import { fmtTime, useJob } from "../lib/hooks";

const draftKey = (id: string, key: string) => `clips.editor.${id}.${key}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const SHAPES: FormatId[] = ["vertical", "landscape", "square", "portrait", "original"];

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
        Slice and delete on the timeline, cut words from the transcript, add your own b-roll and zoom/pan keyframes.
        Pick a project or upload a video to start.
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

  // ------------------------------------------------------------ edit state (+ undo history)
  const [cut, setCut] = useState<Set<number>>(new Set());
  const [ranges, setRanges] = useState<Range[]>([]);
  const [splits, setSplits] = useState<number[]>([]);
  const [broll, setBroll] = useState<EditorBroll[]>([]);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);

  const snap = (): Snapshot => ({ cut: [...cut], ranges, splits, broll, keyframes });
  const apply = (s: Snapshot) => {
    setCut(new Set(s.cut));
    setRanges(s.ranges);
    setSplits(s.splits);
    setBroll(s.broll);
    setKeyframes(s.keyframes);
  };
  /** Save an undo step (before a change made in several live steps, like a drag). */
  const checkpoint = () => {
    setPast((p) => [...p.slice(-100), snap()]);
    setFuture([]);
  };
  const commit = (patch: Partial<Snapshot>) => {
    checkpoint();
    apply({ ...snap(), ...patch });
  };
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setFuture((f) => [snap(), ...f]);
    setPast((p) => p.slice(0, -1));
    apply(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, snap()]);
    setFuture((f) => f.slice(1));
    apply(next);
  };

  // selection
  const [selected, setSelected] = useState<[number, number] | null>(null); // transcript word positions
  const [selPiece, setSelPiece] = useState<number | null>(null);
  const [activeBroll, setActiveBroll] = useState<number | null>(null);
  const [focus, setFocus] = useState<"piece" | "broll" | "kf" | null>(null); // what Delete acts on

  // look & sound
  const [captions, setCaptions] = useState(true);
  const [template, setTemplate] = useState("bold-pop");
  const [music, setMusic] = useState(true);
  const [mood, setMood] = useState("auto");
  const [zoom, setZoom] = useState(true);
  const [brollOn, setBrollOn] = useState(true);
  const [format, setFormat] = useState<FormatValue>({ format: "vertical", reframe: "face", rotate: "auto" });
  const [tab, setTab] = useState<"broll" | "motion" | "look">("broll");
  const [tlZoom, setTlZoom] = useState(1);

  // export
  const [asking, setAsking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useJob(jobId);

  const load = useCallback(() => {
    getEditor(id, { start, end, source })
      .then((d) => {
        setData(d);
        if (d.needs_transcript) return;
        let initial: Snapshot = {
          cut: d.cut ?? d.auto_cut,
          ranges: d.cut_ranges ?? [],
          splits: (d.cut_ranges ?? []).flat(),
          broll: d.broll,
          keyframes: d.keyframes ?? [],
        };
        try {
          const saved = localStorage.getItem(draftKey(id, key));
          if (saved) initial = { ...EMPTY, ...JSON.parse(saved) };
        } catch {
          /* ignore */
        }
        apply(initial);
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
  }, [id, start, end, source, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(load, [load]);
  useEffect(() => {
    if (prep?.status === "done") load();
  }, [prep?.status, load]);

  // autosave the draft
  useEffect(() => {
    if (!data || data.needs_transcript) return;
    try {
      localStorage.setItem(draftKey(id, key), JSON.stringify(snap()));
    } catch {
      /* ignore */
    }
  }, [cut, ranges, splits, broll, keyframes, data, id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!data && !data.needs_transcript;
  const words = data?.words ?? [];
  const [r0, r1] = data?.range ?? [0, 1];
  const spans = useMemo(() => (ready ? keptSpans(data!, cut, ranges) : []), [ready, data, cut, ranges]);
  const editedLength = total(spans);
  const pcs = useMemo(() => makePieces(r0, r1, splits), [r0, r1, splits]);

  // ------------------------------------------------------------ output shape
  const rot = data?.rotation ?? 0;
  const sideways = rot === 90 || rot === 270;
  const [vw, vh] = data ? (sideways ? [data.height, data.width] : [data.width, data.height]) : [16, 9];
  const fmt = FORMATS.find((f) => f.id === format.format);
  const [outW, outH] =
    format.format === "custom" && format.custom_width && format.custom_height
      ? [format.custom_width, format.custom_height]
      : fmt && fmt.width
        ? [fmt.width, fmt.height]
        : [vw, vh];
  const orientation: "portrait" | "landscape" = outH > outW ? "portrait" : "landscape";

  // ------------------------------------------------------------ player (skips the cut parts)
  const video = useRef<HTMLVideoElement>(null);
  const brollVideo = useRef<HTMLVideoElement>(null);
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
            v.currentTime = spans[0]?.start ?? r0;
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
    const x = clamp(time, r0, r1);
    if (v) v.currentTime = x;
    setT(x);
  };

  useEffect(() => {
    if (ready && video.current) {
      const first = spans[0]?.start ?? r0;
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

  // b-roll under the playhead: play its footage over the picture, in step with the main video
  const brollIdx = broll.findIndex((b) => t >= b.start && t < b.end && (b.label || b.source));
  const brollNow = brollIdx >= 0 ? broll[brollIdx] : null;
  useEffect(() => {
    const bv = brollVideo.current;
    if (!bv || !brollNow?.source) return;
    const d = bv.duration || 0;
    const want = d ? (t - brollNow.start) % d : t - brollNow.start;
    if (Math.abs(bv.currentTime - want) > 0.35) bv.currentTime = Math.max(0, want);
    if (playing && bv.paused) bv.play().catch(() => {});
    if (!playing && !bv.paused) bv.pause();
  }, [t, playing, brollNow]);

  // Suggested b-roll comes with a subject only; find matching footage so you can see it (and change it).
  const brollRef = useRef(broll);
  brollRef.current = broll;
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!ready || !data!.stock) return;
    let alive = true;
    (async () => {
      for (const b of brollRef.current) {
        const k = `${orientation}|${b.label}|${b.start}`;
        if (b.source || !b.label || tried.current.has(k)) continue;
        tried.current.add(k);
        try {
          const found = (await searchBroll(b.label, orientation, true)).results[0];
          if (!alive) return;
          if (found)
            setBroll((list) => list.map((x) => (x.start === b.start && x.label === b.label && !x.source ? { ...x, source: found } : x)));
        } catch {
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, data, orientation, broll.length]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const setWordRange = (from: number, to: number, makeCut: boolean) => {
    const next = new Set(cut);
    let nextRanges = ranges;
    for (let k = from; k <= to; k++) {
      if (makeCut) next.add(words[k].i);
      else next.delete(words[k].i);
    }
    // Restoring words that sit in a deleted piece brings that stretch back too.
    if (!makeCut) nextRanges = removeRange(ranges, [words[from].start - 0.01, words[to].end + 0.01]);
    commit({ cut: [...next], ranges: nextRanges });
    setSelected(null);
    window.getSelection()?.removeAllRanges();
  };

  const toggleSentence = (s: [number, number]) => {
    const from = words.findIndex((w) => w.i === s[0]);
    const to = words.findIndex((w) => w.i === s[1]);
    if (from < 0 || to < 0) return;
    const allCut = words.slice(from, to + 1).every((w) => wordIsCut(w, cut, ranges));
    setWordRange(from, to, !allCut);
  };

  // ------------------------------------------------------------ timeline: slice, delete, restore
  const splitHere = () => {
    if (t <= r0 + 0.05 || t >= r1 - 0.05 || splits.some((s) => Math.abs(s - t) < 0.05)) return;
    const next = [...splits, +t.toFixed(3)].sort((a, b) => a - b);
    commit({ splits: next });
    setSelPiece(makePieces(r0, r1, next).findIndex(([a]) => Math.abs(a - t) < 0.002));
    setFocus("piece");
  };
  const pieceIdx = selPiece !== null && selPiece >= 0 && selPiece < pcs.length ? selPiece : null;
  const selPieceGone = pieceIdx !== null && covered(ranges, pcs[pieceIdx]);
  const deletePiece = (k: number) => {
    commit({ ranges: mergeRanges([...ranges, pcs[k]]) });
    const next = pcs[k + 1];
    if (next) seek(next[0]);
  };
  const restorePiece = (k: number) => commit({ ranges: removeRange(ranges, pcs[k]) });

  // ------------------------------------------------------------ b-roll
  const addBroll = (clip?: StockClip, label = "") => {
    const s = +clamp(t, r0, r1 - 1).toFixed(2);
    const len = clip?.duration ? Math.min(4, Math.max(1.5, clip.duration)) : 3;
    const item: EditorBroll = { start: s, end: +Math.min(r1, s + len).toFixed(2), label, source: clip ?? null };
    const nb = [...broll, item].sort((a, b) => a.start - b.start);
    commit({ broll: nb });
    setActiveBroll(nb.indexOf(item));
    setFocus("broll");
    setTab("broll");
  };
  const updateBroll = (k: number, patch: Partial<EditorBroll>) =>
    commit({ broll: broll.map((b, i) => (i === k ? { ...b, ...patch } : b)) });
  const removeBroll = (k: number) => {
    commit({ broll: broll.filter((_, i) => i !== k) });
    setActiveBroll(null);
  };
  const pickFootage = (clip: StockClip, query: string) => {
    if (activeBroll !== null && broll[activeBroll]) {
      updateBroll(activeBroll, { source: clip, label: broll[activeBroll].label || query.trim() });
    } else addBroll(clip, query.trim());
  };
  const active = activeBroll !== null ? broll[activeBroll] : null;

  // ------------------------------------------------------------ keyframes (zoom & pan)
  const motion = motionAt(keyframes, t);
  const kfIdx = keyframes.findIndex((k) => Math.abs(k.time - t) <= KF_SNAP);
  /** Change the zoom/position at the playhead: edits the keyframe there, or adds one (like CapCut). */
  const setMotion = (patch: Partial<Keyframe>) =>
    setKeyframes((list) => {
      const i = list.findIndex((k) => Math.abs(k.time - t) <= KF_SNAP);
      if (i >= 0) return list.map((k, j) => (j === i ? { ...k, ...patch } : k));
      return [...list, { time: +t.toFixed(3), ...motionAt(list, t), ...patch }].sort((a, b) => a.time - b.time);
    });
  const addKeyframe = () => {
    if (kfIdx >= 0) return;
    commit({ keyframes: [...keyframes, { time: +t.toFixed(3), ...motion }].sort((a, b) => a.time - b.time) });
    setFocus("kf");
    setTab("motion");
  };
  const removeKeyframe = (k: number) => commit({ keyframes: keyframes.filter((_, i) => i !== k) });
  const jumpKeyframe = (dir: 1 | -1) => {
    const sorted = keyframes.map((k) => k.time).sort((a, b) => a - b);
    const target = dir > 0 ? sorted.find((x) => x > t + KF_SNAP) : [...sorted].reverse().find((x) => x < t - KF_SNAP);
    if (target !== undefined) seek(target);
  };

  // drag the picture to pan when zoomed in (keyframes tab)
  const previewBox = useRef<HTMLDivElement>(null);
  const panDrag = (e: React.PointerEvent) => {
    if (tab !== "motion" || motion.scale <= 1.001) return;
    e.preventDefault();
    checkpoint();
    const box = previewBox.current!.getBoundingClientRect();
    const sx = (box.width * (motion.scale - 1)) / 2;
    const sy = (box.height * (motion.scale - 1)) / 2;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const m0 = motion;
    const move = (ev: PointerEvent) =>
      setMotion({ x: +clamp(m0.x - (ev.clientX - x0) / sx, -1, 1).toFixed(3), y: +clamp(m0.y - (ev.clientY - y0) / sy, -1, 1).toFixed(3) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selected) setWordRange(selected[0], selected[1], true);
        else if (focus === "broll" && activeBroll !== null) removeBroll(activeBroll);
        else if (focus === "kf" && kfIdx >= 0) removeKeyframe(kfIdx);
        else if (pieceIdx !== null && !selPieceGone) deletePiece(pieceIdx);
      } else if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && k === "b") {
        e.preventDefault();
        splitHere();
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      } else if (k === "s") {
        splitHere();
      } else if (k === "k") {
        addKeyframe();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        seek(t + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-bound every render so the handlers see the current state

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
        cut_ranges: ranges,
        keyframes,
        broll: broll.filter((b) => b.label.trim() || b.source),
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
          “{data.name}” needs a transcript before you can edit it. This takes a few minutes the first time.
        </p>
        {prep?.status === "done" && (
          <p className="error">The transcript finished but couldn't be opened. Click below to try again.</p>
        )}
        {(!prepJob || prep?.status === "done" || prep?.status === "error") && (
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

  // The picture inside the output frame: cropped when the source is wider, fitted when it's taller
  // (as the export does), then moved by the keyframes.
  const videoStyle: CSSProperties = sideways
    ? { position: "absolute", left: "50%", top: "50%", width: `${(data.width / data.height) * 100}%`, height: "auto",
        aspectRatio: `${data.width} / ${data.height}`, transform: `translate(-50%, -50%) rotate(${rot}deg)` }
    : rot === 180
      ? { transform: "rotate(180deg)" }
      : {};
  const stageStyle: CSSProperties = { width: `${((vw / vh) / (outW / outH)) * 100}%` };
  const layerStyle: CSSProperties = {
    transform: `translate(${(-motion.x * (motion.scale - 1) * 50).toFixed(2)}%, ${(-motion.y * (motion.scale - 1) * 50).toFixed(2)}%) scale(${motion.scale})`,
  };
  const tpl = TEMPLATES.find((x) => x.id === template) ?? TEMPLATES[0];

  // caption over the preview: the kept words up to the playhead
  const captionWords: { text: string; on: boolean }[] = [];
  if (captions && activeWord >= 0 && !wordIsCut(words[activeWord], cut, ranges)) {
    const n = Math.min(tpl.words, 4);
    for (let k = activeWord; k >= 0 && captionWords.length < n && activeWord - k < n + 3; k--) {
      if (!wordIsCut(words[k], cut, ranges)) captionWords.unshift({ text: words[k].text, on: k === activeWord });
    }
  }

  const exporting = job && (job.status === "queued" || job.status === "running");
  const nCut = words.filter((w) => wordIsCut(w, cut, ranges)).length;
  const inPiece = pcs.findIndex(([a, b]) => t >= a && t < b);

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
          <button className="btn ghost small" onClick={() => commit({ cut: [...new Set([...cut, ...data.auto_cut])] })}>
            ✦ Apply suggested cuts
          </button>
          <button className="btn ghost small" onClick={() => commit({ cut: [], ranges: [] })}>Restore everything</button>
          <button className="btn" disabled={!!exporting || !spans.length} onClick={() => setAsking(true)}>
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>

      <div className="editor-shell">
        <div className="editor-left">
          <div className="chips shape-chips">
            {SHAPES.map((s) => {
              const f = FORMATS.find((x) => x.id === s)!;
              return (
                <button key={s} className={`chip ${format.format === s ? "active" : ""}`} onClick={() => setFormat({ ...format, format: s })}>
                  {f.ratio === "Source" ? "Original" : f.ratio}
                </button>
              );
            })}
          </div>
          <div
            ref={previewBox}
            className={`editor-preview${tab === "motion" && motion.scale > 1.001 ? " pannable" : ""}`}
            style={{ aspectRatio: `${outW} / ${outH}`, width: `min(100%, calc(46vh * ${outW / outH}))` }}
            onClick={() => tab !== "motion" && togglePlay()}
            onPointerDown={panDrag}
          >
            <div className="kf-layer" style={layerStyle}>
              <div className="stage" style={stageStyle}>
                <div className="stage-inner" style={{ aspectRatio: `${vw} / ${vh}` }}>
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
                </div>
              </div>
            </div>
            {brollNow?.source && (
              <video
                key={`${brollNow.source.provider}:${brollNow.source.id}`}
                ref={brollVideo}
                className="broll-video"
                src={clipUrl(brollNow.source.preview)}
                muted
                loop
                playsInline
                preload="auto"
              />
            )}
            {brollNow && !brollNow.source && (
              <span className="broll-badge">B-roll “{brollNow.label}”: footage is found when you export</span>
            )}
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
            {!playing && tab !== "motion" && <span className="play-big">▶</span>}
            {keyframes.length > 0 && <span className="kf-badge">◆ {motion.scale.toFixed(2)}×</span>}
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
              <button className={tab === "broll" ? "active" : ""} onClick={() => setTab("broll")}>B-roll ({broll.length})</button>
              <button className={tab === "motion" ? "active" : ""} onClick={() => setTab("motion")}>Zoom &amp; keyframes ({keyframes.length})</button>
              <button className={tab === "look" ? "active" : ""} onClick={() => setTab("look")}>Captions &amp; sound</button>
            </div>

            {tab === "broll" && (
              <div className="editor-settings">
                <div className="row gap wrap">
                  <Toggle label="Use b-roll" checked={brollOn} onChange={setBrollOn} />
                  <button className="btn small" onClick={() => addBroll()}>+ Add b-roll at {fmtTime(Math.max(0, t - r0))}</button>
                  {broll.length > 0 && (
                    <button className="btn ghost small" onClick={() => (commit({ broll: [] }), setActiveBroll(null))}>Remove all</button>
                  )}
                </div>
                {broll.length === 0 && (
                  <p className="muted small">No b-roll yet. Move the playhead where you want it, then search below and click a clip.</p>
                )}
                <div className="broll-list">
                  {broll.map((b, k) => (
                    <div
                      key={k}
                      className={`broll-row ${activeBroll === k ? "active" : ""}`}
                      onClick={() => (setActiveBroll(k), setFocus("broll"))}
                    >
                      <button className="broll-thumb" onClick={(e) => (e.stopPropagation(), seek(b.start), setActiveBroll(k))} title="Go there">
                        {b.source?.thumb ? <img src={clipUrl(b.source.thumb)} alt="" /> : <span>{b.source ? "🎞" : "?"}</span>}
                      </button>
                      <div className="broll-info">
                        <input
                          value={b.label}
                          placeholder="Subject, e.g. voting"
                          onChange={(e) => setBroll(broll.map((x, i) => (i === k ? { ...x, label: e.target.value } : x)))}
                          onFocus={checkpoint}
                        />
                        <span className="muted tiny">
                          at {fmtTime(b.start - r0)} ·{" "}
                          <input
                            type="number"
                            min={0.5}
                            max={20}
                            step={0.5}
                            value={+(b.end - b.start).toFixed(1)}
                            onChange={(e) => updateBroll(k, { end: +Math.min(r1, b.start + Math.max(0.5, +e.target.value)).toFixed(2) })}
                          />{" "}
                          s {b.source ? "· footage chosen" : "· pick footage below"}
                        </span>
                      </div>
                      <button className="mini" onClick={(e) => (e.stopPropagation(), updateBroll(k, { start: +t.toFixed(2), end: +(t + b.end - b.start).toFixed(2) }))} title="Move to the playhead">
                        ⇥ here
                      </button>
                      <button className="mini danger" onClick={(e) => (e.stopPropagation(), removeBroll(k))}>Delete</button>
                    </div>
                  ))}
                </div>
                <div className="library-box">
                  <p className="small">
                    {active
                      ? <>Choose footage for <b>{active.label || "this b-roll"}</b> at {fmtTime(active.start - r0)}:</>
                      : <>Click a clip to add it at the playhead ({fmtTime(Math.max(0, t - r0))}):</>}
                  </p>
                  <BrollLibrary
                    initialQuery={active?.label ?? ""}
                    orientation={orientation}
                    stock={!!data.stock}
                    current={active?.source}
                    onPick={pickFootage}
                  />
                </div>
              </div>
            )}

            {tab === "motion" && (
              <div className="editor-settings">
                <p className="muted small">
                  Like CapCut: move the playhead, then zoom or drag the picture. A keyframe ◆ is added at the playhead,
                  and the picture moves smoothly from one keyframe to the next.
                </p>
                <div className="row gap wrap">
                  <button className="btn small" onClick={addKeyframe} disabled={kfIdx >= 0}>◆ Add keyframe <kbd>K</kbd></button>
                  <button className="btn ghost small" onClick={() => jumpKeyframe(-1)} disabled={!keyframes.length}>◀ Prev</button>
                  <button className="btn ghost small" onClick={() => jumpKeyframe(1)} disabled={!keyframes.length}>Next ▶</button>
                  {kfIdx >= 0 && <button className="btn ghost small" onClick={() => removeKeyframe(kfIdx)}>Delete this keyframe</button>}
                  {keyframes.length > 0 && <button className="btn ghost small" onClick={() => commit({ keyframes: [] })}>Remove all</button>}
                </div>
                <div className="kf-status small">
                  {kfIdx >= 0 ? <span className="accent">◆ On a keyframe at {fmtTime(keyframes[kfIdx].time - r0)}</span>
                    : <span className="muted">Between keyframes: changing a value adds one here</span>}
                </div>
                <div className="sliders">
                  <label>
                    <span>Zoom <b>{motion.scale.toFixed(2)}×</b></span>
                    <input type="range" min={1} max={3} step={0.01} value={motion.scale}
                      onPointerDown={checkpoint} onKeyDown={checkpoint}
                      onChange={(e) => setMotion({ scale: +e.target.value })} />
                  </label>
                  <label>
                    <span>Left ↔ right <b>{Math.round(motion.x * 100)}</b></span>
                    <input type="range" min={-1} max={1} step={0.01} value={motion.x} disabled={motion.scale <= 1.001}
                      onPointerDown={checkpoint} onKeyDown={checkpoint}
                      onChange={(e) => setMotion({ x: +e.target.value })} />
                  </label>
                  <label>
                    <span>Up ↕ down <b>{Math.round(motion.y * 100)}</b></span>
                    <input type="range" min={-1} max={1} step={0.01} value={motion.y} disabled={motion.scale <= 1.001}
                      onPointerDown={checkpoint} onKeyDown={checkpoint}
                      onChange={(e) => setMotion({ y: +e.target.value })} />
                  </label>
                </div>
                <div className="chips">
                  {[1, 1.2, 1.5, 2].map((z) => (
                    <button key={z} className="chip" onClick={() => (checkpoint(), setMotion({ scale: z, ...(z === 1 ? { x: 0, y: 0 } : {}) }))}>
                      {z === 1 ? "No zoom" : `${z}×`}
                    </button>
                  ))}
                </div>
                {motion.scale > 1.001 && <p className="muted tiny">Tip: drag the picture in the preview to choose what's in frame.</p>}
              </div>
            )}

            {tab === "look" && (
              <div className="editor-settings">
                <div className="toggles">
                  <Toggle label="Captions" checked={captions} onChange={setCaptions} />
                  <Toggle label="Auto zoom on cuts" checked={zoom} onChange={setZoom} />
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
              <button className="btn small" onClick={() => setWordRange(selected[0], selected[1], true)}>✂ Cut</button>
              <button className="btn small ghost" onClick={() => setWordRange(selected[0], selected[1], false)}>Restore</button>
              <button className="btn small ghost" onClick={() => (seek(words[selected[0]].start), setSelected(null))}>▶ From here</button>
            </div>
          )}
          <div className="transcript" ref={transcriptRef} onMouseUp={() => setSelected(readSelection())}>
            {data.sentences.map((s) => {
              const from = words.findIndex((w) => w.i === s[0]);
              const to = words.findIndex((w) => w.i === s[1]);
              const ws = words.slice(from, to + 1);
              const allCut = ws.every((w) => wordIsCut(w, cut, ranges));
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
                    const isCut = wordIsCut(w, cut, ranges);
                    const auto = isCut && data.auto_cut.includes(w.i) && cut.has(w.i);
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
        <div className="tl-toolbar">
          <button className="btn small" onClick={splitHere} title="Split at the playhead (S or Ctrl+B)">✂ Split <kbd>S</kbd></button>
          <button
            className="btn small ghost"
            disabled={pieceIdx === null || selPieceGone}
            onClick={() => pieceIdx !== null && deletePiece(pieceIdx)}
            title="Delete the selected piece (Delete)"
          >
            🗑 Delete piece
          </button>
          <button className="btn small ghost" disabled={!selPieceGone} onClick={() => pieceIdx !== null && restorePiece(pieceIdx)}>
            ↺ Restore piece
          </button>
          <span className="tl-sep" />
          <button className="btn small ghost" onClick={() => addBroll()}>+ B-roll here</button>
          <button className="btn small ghost" onClick={addKeyframe} disabled={kfIdx >= 0}>◆ Keyframe <kbd>K</kbd></button>
          <span className="tl-sep" />
          <button className="btn ghost small" disabled={!past.length} onClick={undo} title="Ctrl+Z">↶ Undo</button>
          <button className="btn ghost small" disabled={!future.length} onClick={redo} title="Ctrl+Shift+Z">↷ Redo</button>
          <span className="tl-zoom">
            <button className="mini" onClick={() => setTlZoom((z) => Math.max(1, z / 1.5))}>−</button>
            <input type="range" min={1} max={40} step={0.5} value={tlZoom} onChange={(e) => setTlZoom(+e.target.value)} title="Zoom the timeline" />
            <button className="mini" onClick={() => setTlZoom((z) => Math.min(40, z * 1.5))}>+</button>
          </span>
        </div>
        <Timeline
          r0={r0}
          r1={r1}
          t={t}
          playing={playing}
          zoom={tlZoom}
          spans={spans}
          pieces={pcs}
          ranges={ranges}
          selectedPiece={pieceIdx}
          broll={broll}
          activeBroll={activeBroll}
          keyframes={keyframes}
          activeKeyframe={kfIdx >= 0 ? kfIdx : null}
          onSeek={seek}
          onSelectPiece={(k) => (setSelPiece(k), setFocus("piece"))}
          onSelectBroll={(k) => {
            setActiveBroll(k);
            if (k !== null) (setFocus("broll"), setTab("broll"));
          }}
          onDragStart={checkpoint}
          onMoveBroll={(k, s, e) => setBroll((list) => list.map((b, i) => (i === k ? { ...b, start: s, end: e } : b)))}
          onSelectKeyframe={(k) => (seek(keyframes[k].time), setFocus("kf"), setTab("motion"))}
        />
        <div className="tl-legend muted small">
          <span><i className="dot kept" /> plays</span>
          <span><i className="dot cutd" /> cut</span>
          <span><i className="dot br" /> b-roll (drag to move, drag the edges to resize)</span>
          <span><i className="dot kfd" /> keyframe</span>
          <span>
            {inPiece >= 0 && pcs.length > 1 ? `Piece ${inPiece + 1} of ${pcs.length} · ` : ""}
            Click a piece to select it, then <kbd>Delete</kbd>. <kbd>←</kbd>/<kbd>→</kbd> step one frame.
          </span>
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
