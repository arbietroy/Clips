import { ReactNode } from "react";
import { apiUrl, Output } from "../lib/api";
import { FORMATS } from "../data/formats";
import { TEMPLATES } from "../data/templates";
import { fmtTime } from "../lib/hooks";

export default function OutputCard({ o, actions, wide, onUpdate, updating }: {
  o: Output;
  actions?: ReactNode;
  wide?: boolean;
  onUpdate?: () => void;
  updating?: boolean;
}) {
  if (o.error) {
    return (
      <div className="card">
        <div className="card-body">
          <h3>{o.name}</h3>
          <p className="error">{o.error}</p>
        </div>
      </div>
    );
  }
  const ratio = `${o.width} / ${o.height}`;
  return (
    <div className={`card ${wide ? "wide" : ""}`}>
      <div className="card-video" style={{ aspectRatio: ratio }}>
        <video src={apiUrl(o.file)} controls preload="metadata" playsInline />
        {o.virality_score != null && <span className="score">{o.virality_score}</span>}
      </div>
      <div className="card-body">
        <h3>{o.title || o.name}</h3>
        {o.kind !== "raw" && (o.template || o.format) && (
          <div className="tags">
            {o.template && <span className="tag">{TEMPLATES.find((t) => t.id === o.template)?.name ?? o.template} captions</span>}
            {o.format && <span className="tag">{FORMATS.find((f) => f.id === o.format)?.ratio ?? `${o.width}×${o.height}`}</span>}
            {o.created && <span className="tag">{new Date(o.created * 1000).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>}
          </div>
        )}
        {o.hook_text && o.hook_text !== o.title && <p className="hook">“{o.hook_text}”</p>}
        {o.reason && <p className="muted small">{o.reason}</p>}
        {o.summary && <p className="muted small">{o.summary}</p>}
        <p className="meta">
          {fmtTime(o.duration)} · {o.width}×{o.height}
          {o.source_range && ` · from ${fmtTime(o.source_range[0])}`}
          {o.kind !== "raw" && o.cuts ? ` · ${o.cuts} cuts` : ""}
          {o.music ? ` · ♪ ${o.music}` : ""}
          {o.broll?.length ? ` · b-roll: ${o.broll.join(", ")}` : ""}
        </p>
        <div className="card-links">
          <a href={apiUrl(o.file)} download>
            Download MP4
          </a>
          {o.kind !== "raw" && (
            <a href={apiUrl(o.srt)} download>
              Subtitles
            </a>
          )}
        </div>
        {o.outdated && onUpdate && (
          <div className="outdated">
            <span className="small">Made with an older version: no English-only subtitles or retake cutting yet.</span>
            <button className="btn small" disabled={updating} onClick={onUpdate}>
              {updating ? "Updating…" : "↻ Update with latest fixes"}
            </button>
          </div>
        )}
        {actions && <div className="card-actions">{actions}</div>}
      </div>
    </div>
  );
}
