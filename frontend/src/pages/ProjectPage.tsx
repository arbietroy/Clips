import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ClipPreview from "../components/ClipPreview";
import ExportDialog from "../components/ExportDialog";
import { FormatValue } from "../components/FormatPicker";
import JobProgress from "../components/JobProgress";
import OutputCard from "../components/OutputCard";
import Toggle from "../components/Toggle";
import { apiUrl, ClipIdea, createJob, deleteProject, getProject, Output, Project } from "../lib/api";
import { LANGUAGES } from "../data/templates";
import { fmtTime, rememberVideo, useJob } from "../lib/hooks";

type Filter = "all" | "raw" | "edits";

// Trims and ticks are kept per project in the browser, so they survive leaving the page.
const draftKey = (id: string) => `clips.draft.${id}`;
interface Draft {
  trims: Record<string, [number, number]>; // keyed by the suggested clip's original start
  unselected: string[];
}
function loadDraft(id: string): Draft {
  try {
    return { trims: {}, unselected: [], ...JSON.parse(localStorage.getItem(draftKey(id)) || "{}") };
  } catch {
    return { trims: {}, unselected: [] };
  }
}
function saveDraft(id: string, d: Draft) {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify(d));
  } catch {
    /* storage unavailable */
  }
}

export default function ProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [numClips, setNumClips] = useState(5);
  const [length, setLength] = useState(60);
  const [clean, setClean] = useState(false);
  const [language, setLanguage] = useState("en");
  const [format, setFormat] = useState<FormatValue>({ format: "vertical", reframe: "face", rotate: "auto" });
  const [draft, setDraft] = useState<Draft>(() => loadDraft(id));
  const [filter, setFilter] = useState<Filter>("all");
  const [asking, setAsking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useJob(jobId);
  const outputsRef = useRef<HTMLElement>(null);

  const reload = useCallback(async () => {
    try {
      const p = await getProject(id);
      setProject(p);
      setLanguage(p.language || "en");
      rememberVideo(p);
      // Pick up a job that is still running (e.g. after coming back from the Auto Editor).
      if (p.active_jobs.length) setJobId((cur) => cur ?? p.active_jobs[p.active_jobs.length - 1]);
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, [id]);

  useEffect(() => {
    setDraft(loadDraft(id));
    setJobId(null);
    reload();
  }, [id, reload]);

  useEffect(() => saveDraft(id, draft), [id, draft]);

  useEffect(() => {
    if (job && (job.status === "done" || job.status === "error")) {
      reload().then(() => {
        if (job.type !== "analyze" && job.status === "done") outputsRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggested = project?.clips ?? [];
  const clips: ClipIdea[] = useMemo(
    () =>
      suggested.map((c) => {
        const t = draft.trims[String(c.start)];
        return t ? { ...c, start: t[0], end: t[1] } : c;
      }),
    [suggested, draft.trims],
  );
  const isSelected = (c: ClipIdea) => !draft.unselected.includes(String(c.start));
  const chosen = clips.filter((_, i) => isSelected(suggested[i]));

  const running = job && (job.status === "queued" || job.status === "running");

  const find = async () => {
    setError(null);
    try {
      const j = await createJob({ type: "analyze", video_id: id, options: { num_clips: numClips, length, language } });
      setDraft({ trims: {}, unselected: [] });
      setJobId(j.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const exportChosen = async (f: FormatValue) => {
    setAsking(false);
    setFormat(f);
    setError(null);
    try {
      const j = await createJob({ type: "find_clips", video_id: id, clips: chosen, options: { ...f, clean } });
      setJobId(j.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const autoEdit = (start: number, end: number) =>
    navigate(`/auto?video=${id}&start=${start}&end=${end}&format=${format.format}`);

  // Re-render an older edit with the same settings and the latest fixes; it replaces the old version.
  const updateOutputs = async (list: Output[]) => {
    setError(null);
    try {
      let last: string | null = null;
      for (const o of list) {
        const opts = o.options ?? { template: o.template, format: o.format };
        const j = await createJob({
          type: "auto_edit",
          video_id: id,
          range: o.kind === "full" ? null : (o.source_range ?? null),
          options: { ...opts, language: project?.language || "en" },
          replaces: o.name,
        });
        last = j.id;
      }
      if (last) setJobId(last);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const editAgain = (o: Output) => {
    const range = o.source_range ? `&start=${o.source_range[0]}&end=${o.source_range[1]}` : "";
    navigate(`/auto?video=${id}&from=${encodeURIComponent(o.name)}${range}`);
  };

  const remove = async () => {
    if (!project || !confirm(`Delete “${project.name}” and everything made from it? This can't be undone.`)) return;
    // Stop every player on the page first: Windows can't delete a video file that is still being streamed.
    document.querySelectorAll("video").forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
    try {
      await deleteProject(id);
      localStorage.removeItem(draftKey(id));
      navigate("/projects");
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loadError) {
    return (
      <div className="page narrow">
        <h1>Project not found</h1>
        <p className="lead">{loadError}</p>
        <Link to="/projects" className="btn">Back to My Projects</Link>
      </div>
    );
  }
  if (!project) return <div className="page"><p className="muted">Loading…</p></div>;

  const outputs: Output[] = project.outputs.filter((o) =>
    filter === "all" ? true : filter === "raw" ? o.kind === "raw" : o.kind !== "raw",
  );

  return (
    <div className="page">
      <Link to="/projects" className="back">← My Projects</Link>
      <div className="project-head">
        <div>
          <h1>{project.name}</h1>
          <p className="muted">
            {fmtTime(project.duration)} · uploaded {new Date(project.created * 1000).toLocaleDateString()} ·{" "}
            {project.clips_found} suggested · {project.exports} exported · {project.edits} edited
          </p>
        </div>
        <div className="row gap wrap">
          <button className="btn ghost" onClick={() => navigate(`/editor/${id}`)}>✂ Edit manually</button>
          <button className="btn ghost" onClick={() => navigate(`/auto?video=${id}`)}>✦ Auto-edit the whole video</button>
          <button className="btn ghost danger" disabled={!!running} onClick={remove}>Delete</button>
        </div>
      </div>

      <div className="split">
        <div className="panel source">
          <video src={apiUrl(project.url)} controls preload="metadata" />
          {!!project.rotation && <p className="notice small">Looks sideways: previews and exports will be turned upright.</p>}
        </div>
        <div className="panel">
          <h2>{suggested.length ? "Find clips again" : "Find viral clips"}</h2>
          <label className="field">
            <span>Number of clips: <b>{numClips}</b></span>
            <input type="range" min={1} max={15} value={numClips} onChange={(e) => setNumClips(+e.target.value)} />
          </label>
          <label className="field">
            <span>Clip length: <b>about {length} seconds</b></span>
            <input type="range" min={15} max={120} step={5} value={length} onChange={(e) => setLength(+e.target.value)} />
          </label>
          <label className="field">
            <span>Spoken language (subtitles are written in it)</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </label>
          {suggested.length > 0 && language !== (project.language || "en") && (
            <p className="notice small">Changing the language re-transcribes the video and finds new clips.</p>
          )}
          <button className="btn big full" disabled={!!running} onClick={find}>
            {running && job?.type === "analyze" ? "Finding clips…" : suggested.length ? "Find clips again" : "Find viral clips"}
          </button>
          <p className="muted small">
            {suggested.length
              ? "This replaces the suggestions below. Your exports and edits are kept."
              : "Nothing is exported yet. You'll preview the clips first."}
          </p>
          {error && <p className="error">{error}</p>}
        </div>
      </div>

      {job && (running || job.status === "error") && <JobProgress job={job} />}

      {clips.length > 0 && (
        <section>
          <h2 className="section-title">
            {clips.length} suggested clips <span className="muted">· best first · tap a clip to preview it</span>
          </h2>
          <div className="cards">
            {clips.map((c, i) => {
              const key = String(suggested[i].start);
              return (
                <ClipPreview
                  key={key}
                  video={project}
                  clip={c}
                  original={suggested[i]}
                  index={i + 1}
                  selected={isSelected(suggested[i])}
                  onToggle={() =>
                    setDraft((d) => ({
                      ...d,
                      unselected: d.unselected.includes(key) ? d.unselected.filter((k) => k !== key) : [...d.unselected, key],
                    }))
                  }
                  onChange={(nc) => setDraft((d) => ({ ...d, trims: { ...d.trims, [key]: [nc.start, nc.end] } }))}
                  onAutoEdit={() => autoEdit(c.start, c.end)}
                  onManual={() => navigate(`/editor/${id}?start=${c.start}&end=${c.end}`)}
                />
              );
            })}
          </div>

          <div className="export-sticky">
            <div className="row gap wrap">
              <span><b>{chosen.length}</b> of {clips.length} selected</span>
              <Toggle label="Clean up" hint="Cut silences, ums and repeated lines" checked={clean} onChange={setClean} />
            </div>
            <div className="row gap">
              <button
                className="btn ghost small"
                onClick={() =>
                  setDraft((d) => ({ ...d, unselected: chosen.length < clips.length ? [] : suggested.map((c) => String(c.start)) }))
                }
              >
                {chosen.length < clips.length ? "Select all" : "Select none"}
              </button>
              <button className="btn" disabled={!chosen.length || !!running} onClick={() => setAsking(true)}>
                {running && job?.type === "find_clips" ? "Exporting…" : `Export ${chosen.length} clip${chosen.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </section>
      )}

      <section ref={outputsRef}>
        <div className="section-row">
          <h2 className="section-title">Your exports &amp; edits</h2>
          {project.outputs.length > 0 && (
            <div className="seg small-seg">
              {(["all", "raw", "edits"] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "raw" ? "Clips" : "Edited"}
                </button>
              ))}
            </div>
          )}
        </div>
        {project.outputs.filter((o) => o.outdated).length > 1 && (
          <div className="outdated wide-note">
            <span>
              {project.outputs.filter((o) => o.outdated).length} edits were made with an older version (no English-only
              subtitles or retake cutting).
            </span>
            <button className="btn small" disabled={!!running} onClick={() => updateOutputs(project.outputs.filter((o) => o.outdated))}>
              ↻ Update all
            </button>
          </div>
        )}
        {project.outputs.length === 0 ? (
          <p className="muted">Nothing exported yet. Tick the clips you like above and press Export, or auto-edit one.</p>
        ) : (
          <div className="cards">
            {outputs.map((o) => (
              <OutputCard
                key={o.file}
                o={o}
                wide={o.width > o.height && o.kind === "full"}
                onUpdate={() => updateOutputs([o])}
                updating={!!running}
                actions={
                  o.kind === "raw" ? (
                    o.source_range && (
                      <>
                        <button className="btn small" onClick={() => autoEdit(o.source_range![0], o.source_range![1])}>
                          ✦ Auto-edit this clip
                        </button>
                        <button
                          className="btn small ghost"
                          onClick={() => navigate(`/editor/${id}?start=${o.source_range![0]}&end=${o.source_range![1]}`)}
                        >
                          ✂ Edit manually
                        </button>
                      </>
                    )
                  ) : o.kind === "manual" ? (
                    <button className="btn small" onClick={() => navigate(`/editor/${id}?source=${encodeURIComponent(o.name)}`)}>
                      ✂ Edit again
                    </button>
                  ) : (
                    <>
                      <button className="btn small" onClick={() => editAgain(o)}>
                        ✦ Edit again
                      </button>
                      <button className="btn small ghost" onClick={() => navigate(`/editor/${id}?source=${encodeURIComponent(o.name)}`)}>
                        ✂ Fine-tune manually
                      </button>
                    </>
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      {asking && (
        <ExportDialog
          title={`Export ${chosen.length} clip${chosen.length === 1 ? "" : "s"}: choose the size`}
          initial={format}
          source={project}
          onCancel={() => setAsking(false)}
          onExport={exportChosen}
        />
      )}
    </div>
  );
}
