import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ClipPreview from "../components/ClipPreview";
import ExportDialog from "../components/ExportDialog";
import { FormatValue } from "../components/FormatPicker";
import JobProgress from "../components/JobProgress";
import OutputCard from "../components/OutputCard";
import UploadDrop from "../components/UploadDrop";
import { apiUrl, ClipIdea, createJob, VideoInfo } from "../lib/api";
import { fmtTime, useJob } from "../lib/hooks";

export default function ClipFinder() {
  const navigate = useNavigate();
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [numClips, setNumClips] = useState(5);
  const [length, setLength] = useState(60);
  const [format, setFormat] = useState<FormatValue>({ format: "vertical", reframe: "face", rotate: "auto" });
  const [error, setError] = useState<string | null>(null);

  // Step 1: find the moments (nothing rendered)
  const [findId, setFindId] = useState<string | null>(null);
  const { job: findJob } = useJob(findId);
  const [found, setFound] = useState<ClipIdea[]>([]);       // as suggested
  const [clips, setClips] = useState<ClipIdea[]>([]);       // with the user's trims
  const [selected, setSelected] = useState<boolean[]>([]);

  // Step 2: export only the chosen clips
  const [asking, setAsking] = useState(false);
  const [exportId, setExportId] = useState<string | null>(null);
  const { job: exportJob } = useJob(exportId);
  const exportedRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (findJob?.status === "done") {
      const sorted = [...findJob.clips].sort((a, b) => b.virality_score - a.virality_score);
      setFound(sorted);
      setClips(sorted);
      setSelected(sorted.map(() => true));
    }
  }, [findJob?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (exportJob?.status === "done") exportedRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [exportJob?.status]);

  const find = async () => {
    setError(null);
    setFound([]);
    setClips([]);
    setExportId(null);
    try {
      const j = await createJob({ type: "analyze", video_id: video!.id, options: { num_clips: numClips, length } });
      setFindId(j.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const exportChosen = async (f: FormatValue) => {
    setAsking(false);
    setFormat(f);
    setError(null);
    try {
      const chosen = clips.filter((_, i) => selected[i]);
      const j = await createJob({
        type: "find_clips",
        video_id: video!.id,
        clips: chosen,
        options: { num_clips: numClips, length, ...f },
      });
      setExportId(j.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const autoEdit = (c: ClipIdea) => navigate(`/auto?video=${video!.id}&start=${c.start}&end=${c.end}&format=${format.format}`);

  const finding = findJob && (findJob.status === "queued" || findJob.status === "running");
  const exporting = exportJob && (exportJob.status === "queued" || exportJob.status === "running");
  const nSelected = selected.filter(Boolean).length;

  return (
    <div className="page">
      <h1>Clip Finder</h1>
      <p className="lead">
        Upload a long video. AI suggests the moments most likely to go viral. Preview them, adjust them, and export
        only the ones you like.
      </p>

      {!video ? (
        <UploadDrop onReady={setVideo} hint="Podcasts, interviews, lectures, talking-head videos" />
      ) : (
        <div className="split">
          <div className="panel source">
            <video src={apiUrl(video.url)} controls preload="metadata" />
            <p className="meta">
              {video.name} · {fmtTime(video.duration)} · {video.width}×{video.height}
            </p>
            {!!video.rotation && (
              <p className="notice small">Looks sideways: previews and exports will be turned upright.</p>
            )}
            {!finding && !exporting && (
              <button className="link" onClick={() => (setVideo(null), setFindId(null), setExportId(null), setClips([]))}>
                Use a different video
              </button>
            )}
          </div>
          <div className="panel">
            <h2>Settings</h2>
            <label className="field">
              <span>
                Number of clips: <b>{numClips}</b>
              </span>
              <input type="range" min={1} max={15} value={numClips} onChange={(e) => setNumClips(+e.target.value)} />
            </label>
            <label className="field">
              <span>
                Clip length: <b>about {length} seconds</b>
              </span>
              <input type="range" min={15} max={120} step={5} value={length} onChange={(e) => setLength(+e.target.value)} />
            </label>
            <button className="btn big full" disabled={!!finding || !!exporting} onClick={find}>
              {finding ? "Finding clips…" : clips.length ? "Find clips again" : "Find viral clips"}
            </button>
            <p className="muted small">Nothing is exported yet. You'll preview the clips first.</p>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}

      {findJob && (finding || findJob.status === "error") && <JobProgress job={findJob} />}

      {clips.length > 0 && video && (
        <section>
          <h2 className="section-title">
            {clips.length} suggested clips <span className="muted">· best first · tap a clip to preview it</span>
          </h2>
          <div className="cards">
            {clips.map((c, i) => (
              <ClipPreview
                key={`${found[i]?.start}-${i}`}
                video={video}
                clip={c}
                original={found[i]}
                index={i + 1}
                selected={!!selected[i]}
                onToggle={() => setSelected(selected.map((s, k) => (k === i ? !s : s)))}
                onChange={(nc) => setClips(clips.map((x, k) => (k === i ? nc : x)))}
                onAutoEdit={() => autoEdit(c)}
              />
            ))}
          </div>

          <div className="export-sticky">
            <span>
              <b>{nSelected}</b> of {clips.length} clips selected
            </span>
            <div className="row gap">
              <button className="btn ghost small" onClick={() => setSelected(clips.map(() => nSelected < clips.length))}>
                {nSelected < clips.length ? "Select all" : "Select none"}
              </button>
              <button className="btn" disabled={!nSelected || !!exporting} onClick={() => setAsking(true)}>
                {exporting ? "Exporting…" : `Export ${nSelected} clip${nSelected === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </section>
      )}

      {exportJob && (exporting || exportJob.status === "error") && <JobProgress job={exportJob} />}

      {exportJob && exportJob.outputs.length > 0 && (
        <section ref={exportedRef}>
          <h2 className="section-title">Exported clips</h2>
          <div className="cards">
            {exportJob.outputs.map((o) => (
              <OutputCard
                key={o.name}
                o={o}
                actions={
                  o.source_range && (
                    <button
                      className="btn small"
                      onClick={() => navigate(`/auto?video=${video!.id}&start=${o.source_range![0]}&end=${o.source_range![1]}&format=${format.format}`)}
                    >
                      ✦ Auto-edit this clip
                    </button>
                  )
                }
              />
            ))}
          </div>
        </section>
      )}

      {asking && video && (
        <ExportDialog
          title={`Export ${nSelected} clip${nSelected === 1 ? "" : "s"}: choose the size`}
          initial={format}
          source={video}
          onCancel={() => setAsking(false)}
          onExport={exportChosen}
        />
      )}
    </div>
  );
}
