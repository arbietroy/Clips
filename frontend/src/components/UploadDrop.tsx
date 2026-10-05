import { useRef, useState } from "react";
import { getVideo, uploadVideo, VideoInfo } from "../lib/api";
import { fmtTime, recentVideos, rememberVideo } from "../lib/hooks";

interface Props {
  onReady: (v: VideoInfo) => void;
  hint?: string;
}

export default function UploadDrop({ onReady, hint }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recent = recentVideos();

  const start = async (file?: File) => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const v = await uploadVideo(file, setProgress);
      rememberVideo(v);
      onReady(v);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProgress(null);
    }
  };

  const reuse = async (v: VideoInfo) => {
    setError(null);
    try {
      onReady(await getVideo(v.id));
    } catch {
      setError("That video is no longer on the server. Please upload it again.");
    }
  };

  return (
    <div>
      <div
        className={`drop ${over ? "over" : ""}`}
        onClick={() => progress === null && input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          start(e.dataTransfer.files[0]);
        }}
      >
        <input ref={input} type="file" accept="video/*" hidden onChange={(e) => start(e.target.files?.[0])} />
        {progress === null ? (
          <>
            <div className="drop-icon">⬆</div>
            <strong>Drop a video here or click to upload</strong>
            <span className="muted">{hint ?? "MP4, MOV, MKV or WEBM"}</span>
          </>
        ) : (
          <>
            <strong>Uploading… {Math.round(progress * 100)}%</strong>
            <div className="bar">
              <div style={{ width: `${progress * 100}%` }} />
            </div>
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {recent.length > 0 && progress === null && (
        <div className="recent">
          <span className="muted small">Or use a recent upload:</span>
          {recent.map((v) => (
            <button key={v.id} className="chip" onClick={() => reuse(v)}>
              {v.name} · {fmtTime(v.duration)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
