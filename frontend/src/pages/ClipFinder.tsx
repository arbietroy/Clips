import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ExportDialog from "../components/ExportDialog";
import { FormatValue } from "../components/FormatPicker";
import JobProgress from "../components/JobProgress";
import OutputCard from "../components/OutputCard";
import UploadDrop from "../components/UploadDrop";
import { apiUrl, createJob, Output, VideoInfo } from "../lib/api";
import { fmtTime, useJob } from "../lib/hooks";

export default function ClipFinder() {
  const navigate = useNavigate();
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [numClips, setNumClips] = useState(5);
  const [length, setLength] = useState(60);
  const [format, setFormat] = useState<FormatValue>({ format: "vertical", reframe: "face", rotate: "auto" });
  const [asking, setAsking] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { job } = useJob(jobId);

  const start = async (f: FormatValue) => {
    setAsking(false);
    setFormat(f);
    setError(null);
    try {
      const j = await createJob({
        type: "find_clips",
        video_id: video!.id,
        options: { num_clips: numClips, length, ...f },
      });
      setJobId(j.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const edit = (o: Output) => {
    const [s, e] = o.source_range ?? [0, 0];
    navigate(`/auto?video=${video!.id}&start=${s}&end=${e}&format=${format.format}`);
  };

  const outputs = [...(job?.outputs ?? [])].sort((a, b) => (b.virality_score ?? 0) - (a.virality_score ?? 0));
  const running = job && (job.status === "queued" || job.status === "running");

  return (
    <div className="page">
      <h1>Clip Finder</h1>
      <p className="lead">Upload a long video. AI picks the moments most likely to go viral and cuts them out for you.</p>

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
              <p className="notice small">Looks sideways: it will be turned upright when exported.</p>
            )}
            {!running && (
              <button className="link" onClick={() => (setVideo(null), setJobId(null))}>
                Use a different video
              </button>
            )}
          </div>
          <div className="panel">
            <h2>Settings</h2>
            <label className="field">
              Number of clips: <b>{numClips}</b>
              <input type="range" min={1} max={15} value={numClips} onChange={(e) => setNumClips(+e.target.value)} />
            </label>
            <label className="field">
              Clip length: <b>about {length} seconds</b>
              <input type="range" min={15} max={120} step={5} value={length} onChange={(e) => setLength(+e.target.value)} />
            </label>
            <button className="btn big full" disabled={!!running} onClick={() => setAsking(true)}>
              {running ? "Working…" : jobId ? "Find clips again" : "Find viral clips"}
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}

      {job && running && <JobProgress job={job} />}
      {job?.status === "error" && <JobProgress job={job} />}

      {outputs.length > 0 && (
        <section>
          <h2 className="section-title">
            {outputs.length} clips found <span className="muted">· best first</span>
          </h2>
          <div className="cards">
            {outputs.map((o) => (
              <OutputCard
                key={o.name}
                o={o}
                actions={
                  <button className="btn small" onClick={() => edit(o)}>
                    ✦ Auto-edit this clip
                  </button>
                }
              />
            ))}
          </div>
        </section>
      )}

      {asking && video && (
        <ExportDialog
          title="What size should the clips be?"
          initial={format}
          source={video}
          onCancel={() => setAsking(false)}
          onExport={start}
        />
      )}
    </div>
  );
}
