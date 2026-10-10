import { Job } from "../lib/api";

const PHASES: { id: Job["phase"]; label: string }[] = [
  { id: "transcribing", label: "Transcribing" },
  { id: "analyzing", label: "Finding the best moments" },
  { id: "rendering", label: "Editing & rendering" },
];

export default function JobProgress({ job, uploading }: { job: Job | null; uploading?: boolean }) {
  // Finding clips stops after analysis; nothing is rendered.
  const phases = job?.type === "analyze" ? PHASES.slice(0, 2) : PHASES;
  const phaseIndex = job?.status === "done" ? phases.length : phases.findIndex((p) => p.id === job?.phase);
  const pct =
    job?.status === "done"
      ? 100
      : job?.phase === "rendering"
        ? 40 + job.progress * 58
        : job?.phase === "analyzing"
          ? job.type === "analyze" ? 85 : 32
          : job?.phase === "transcribing" && job.progress
          ? 5 + job.progress * (job.type === "analyze" ? 75 : 25)
          : phaseIndex >= 0
            ? 8 + phaseIndex * (job?.type === "analyze" ? 40 : 16)
            : 3;
  return (
    <div className="panel progress-panel">
      <div className="phases">
        {phases.map((p, k) => (
          <div key={p.label} className={`phase ${k < phaseIndex ? "done" : k === phaseIndex ? "current" : ""}`}>
            <span className="phase-dot">{k < phaseIndex ? "✓" : k + 1}</span>
            {p.label}
          </div>
        ))}
      </div>
      <div className="bar big">
        <div style={{ width: `${uploading ? 2 : pct}%` }} />
      </div>
      <p className="muted small">
        {job?.status === "queued" && job.queue_position > 1
          ? `Waiting for ${job.queue_position - 1} other job(s) to finish…`
          : job?.step || "Starting…"}
      </p>
      {job?.error && <p className="error">{job.error}</p>}
      {job && job.log.length > 0 && (
        <details>
          <summary className="muted small">Details</summary>
          <pre className="log">{job.log.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}
