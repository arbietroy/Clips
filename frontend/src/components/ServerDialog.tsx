import { useState } from "react";
import { getHealth, getServerSettings, saveServerSettings } from "../lib/api";

export default function ServerDialog({ onClose }: { onClose: () => void }) {
  const initial = getServerSettings();
  const [url, setUrl] = useState(initial.url);
  const [code, setCode] = useState(initial.accessCode);
  const [result, setResult] = useState<string | null>(null);

  const test = async () => {
    saveServerSettings({ url: url.trim().replace(/\/$/, ""), accessCode: code.trim() });
    setResult("Testing…");
    try {
      const h = await getHealth();
      setResult(`Connected. Claude: ${h.claude ? "yes" : "no"} · stock b-roll: ${h.pexels ? "Pexels" : h.pixabay ? "Pixabay" : "no"} · music tracks: ${h.music_tracks}`);
    } catch (e: any) {
      setResult(`Could not connect: ${e.message}`);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>AI server</h2>
        <p className="muted">
          Clips sends videos to a Python server for transcription, AI analysis and rendering. Leave the address empty to use
          the default.
        </p>
        <label className="field">
          Server address
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-clips-api.onrender.com" />
        </label>
        <label className="field">
          Access code (if the server has one)
          <input value={code} onChange={(e) => setCode(e.target.value)} type="password" />
        </label>
        {result && <p className="muted small">{result}</p>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn" onClick={test}>
            Save &amp; test
          </button>
        </div>
      </div>
    </div>
  );
}
