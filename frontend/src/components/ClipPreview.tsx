import { CSSProperties, useEffect, useRef, useState } from "react";
import { apiUrl, ClipIdea, VideoInfo } from "../lib/api";
import { fmtTime } from "../lib/hooks";

// Only one preview plays at a time.
let playing: HTMLVideoElement | null = null;

interface Props {
  video: VideoInfo;
  clip: ClipIdea;
  original: ClipIdea;
  index: number;
  selected: boolean;
  onToggle: () => void;
  onChange: (c: ClipIdea) => void;
  onAutoEdit: () => void;
}

/** Plays a suggested clip straight from the source video, so nothing is rendered until it's chosen. */
export default function ClipPreview({ video, clip, original, index, selected, onToggle, onChange, onAutoEdit }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(clip.start);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const len = Math.max(0.1, clip.end - clip.start);

  // Show the clip's first frame, and jump back to the start whenever the range changes.
  useEffect(() => {
    const v = ref.current;
    if (v && (v.currentTime < clip.start || v.currentTime > clip.end)) {
      v.currentTime = clip.start;
      setT(clip.start);
    }
  }, [clip.start, clip.end]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (!v.paused) return v.pause();
    if (playing && playing !== v) playing.pause();
    if (v.currentTime < clip.start || v.currentTime >= clip.end - 0.05) v.currentTime = clip.start;
    playing = v;
    v.play();
  };

  const onTime = () => {
    const v = ref.current;
    if (!v) return;
    if (v.currentTime >= clip.end) {
      v.pause();
      v.currentTime = clip.start;
    }
    setT(v.currentTime);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = ref.current;
    if (v) v.currentTime = clip.start + ((e.clientX - r.left) / r.width) * len;
  };

  const nudge = (key: "start" | "end", delta: number) => {
    const max = video.duration;
    let { start, end } = clip;
    if (key === "start") start = Math.min(Math.max(0, start + delta), end - 3);
    else end = Math.max(Math.min(max, end + delta), start + 3);
    onChange({ ...clip, start: +start.toFixed(2), end: +end.toFixed(2) });
  };

  // Footage saved sideways is shown upright, the way it will be exported.
  const rot = video.rotation ?? 0;
  const sideways = rot === 90 || rot === 270;
  const [w, h] = sideways ? [video.height, video.width] : [video.width, video.height];
  const frame: CSSProperties = { aspectRatio: `${w} / ${h}` };
  const videoStyle: CSSProperties = sideways
    ? { position: "absolute", left: "50%", top: "50%", width: `${(video.width / video.height) * 100}%`, height: "auto",
        aspectRatio: `${video.width} / ${video.height}`, transform: `translate(-50%, -50%) rotate(${rot}deg)` }
    : rot === 180
      ? { transform: "rotate(180deg)" }
      : {};

  const changed = clip.start !== original.start || clip.end !== original.end;
  const progress = Math.min(1, Math.max(0, (t - clip.start) / len));

  return (
    <div className={`card preview ${selected ? "chosen" : ""}`}>
      <div className="preview-frame" style={frame} onClick={toggle}>
        <video
          ref={ref}
          src={`${apiUrl(video.url)}#t=${clip.start}`}
          preload="metadata"
          playsInline
          style={videoStyle}
          onTimeUpdate={onTime}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
        <span className="score">{clip.virality_score}</span>
        <span className="rank">#{index}</span>
        {!isPlaying && <span className="play-big">▶</span>}
      </div>
      <div className="scrub" onClick={seek}>
        <div style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="card-body">
        <label className="pick">
          <input type="checkbox" checked={selected} onChange={onToggle} />
          <h3>{clip.title}</h3>
        </label>
        {clip.hook_text && clip.hook_text !== clip.title && <p className="hook">“{clip.hook_text}”</p>}
        <p className="muted small">{clip.reason}</p>
        {clip.text && (
          <p className="quote small" onClick={() => setShowText(!showText)}>
            {showText || clip.text.length < 180 ? clip.text : clip.text.slice(0, 180) + "… (more)"}
          </p>
        )}
        <div className="trim">
          {(["start", "end"] as const).map((k) => (
            <span key={k} className="trim-group">
              <span className="muted small">{k === "start" ? "Start" : "End"}</span>
              <button className="mini" onClick={() => nudge(k, -1)}>−1s</button>
              <b>{fmtTime(clip[k])}</b>
              <button className="mini" onClick={() => nudge(k, 1)}>+1s</button>
            </span>
          ))}
        </div>
        <p className="meta">
          {Math.round(len)} seconds · from {fmtTime(clip.start)}
          {changed && (
            <>
              {" · "}
              <button className="link small" onClick={() => onChange(original)}>reset</button>
            </>
          )}
        </p>
        <div className="card-actions">
          <button className="btn small ghost" onClick={toggle}>{isPlaying ? "❚❚ Pause" : "▶ Preview"}</button>
          <button className="btn small" onClick={onAutoEdit}>✦ Auto-edit</button>
        </div>
      </div>
    </div>
  );
}
