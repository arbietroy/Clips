import { useEffect, useRef, useState } from "react";
import { clipUrl, getBrollUploads, searchBroll, StockClip, uploadBroll } from "../../lib/api";

/** Search Pixabay/Pexels or your own uploads, preview clips on hover, and pick one. */
export default function BrollLibrary({ initialQuery, orientation, stock, onPick, current }: {
  initialQuery: string;
  orientation: "portrait" | "landscape";
  stock: boolean;
  onPick: (clip: StockClip, query: string) => void;
  current?: StockClip | null;
}) {
  const [tab, setTab] = useState<"stock" | "mine">(stock ? "stock" : "mine");
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<StockClip[] | null>(null);
  const [mine, setMine] = useState<StockClip[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const search = async (term = q) => {
    if (!term.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResults((await searchBroll(term.trim(), orientation)).results);
    } catch (e: any) {
      setError(e.message);
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  // New subject (another b-roll selected): search for it straight away.
  useEffect(() => {
    setQ(initialQuery);
    if (stock && initialQuery.trim()) search(initialQuery);
    else setResults(null);
  }, [initialQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === "mine" && mine === null) getBrollUploads().then((r) => setMine(r.results)).catch(() => setMine([]));
  }, [tab, mine]);

  const onFiles = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setTab("mine");
    setUploading(0);
    setError(null);
    try {
      const clip = await uploadBroll(f, setUploading);
      setMine((m) => [clip, ...(m ?? [])]);
      onPick(clip, f.name.replace(/\.[^.]+$/, ""));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(null);
    }
  };

  const list = tab === "stock" ? results : mine;

  return (
    <div className="library">
      <div className="row gap wrap">
        <div className="seg small-seg">
          <button className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>Stock footage</button>
          <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>My uploads</button>
        </div>
        <button className="btn small ghost" onClick={() => fileInput.current?.click()} disabled={uploading !== null}>
          {uploading !== null ? `Uploading ${Math.round(uploading * 100)}%…` : "⬆ Upload your own clip"}
        </button>
        <input ref={fileInput} type="file" accept="video/*" hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ""))} />
      </div>

      {tab === "stock" && (
        stock ? (
          <form className="row gap top-gap" onSubmit={(e) => (e.preventDefault(), search())}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search footage, e.g. voting, money, city" />
            <button className="btn small" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
          </form>
        ) : (
          <p className="muted small top-gap">
            To search stock footage, add <code>PIXABAY_API_KEY=your-key</code> to <code>backend\.env</code> and restart
            Clips. You can still upload your own clips.
          </p>
        )
      )}

      {error && <p className="error small">{error}</p>}
      {list && list.length === 0 && !busy && (
        <p className="muted small top-gap">
          {tab === "stock" ? "Nothing found. Try one simple word, like “vote” or “crowd”." : "No uploads yet."}
        </p>
      )}
      {list && list.length > 0 && (
        <div className="lib-grid">
          {list.map((c) => (
            <ClipCard key={`${c.provider}:${c.id}`} c={c} chosen={current?.id === c.id && current?.provider === c.provider}
              onPick={() => onPick(c, tab === "stock" ? q : c.tags)} />
          ))}
        </div>
      )}
      {tab === "stock" && stock && <p className="muted tiny top-gap">Footage from Pixabay / Pexels, free to use.</p>}
    </div>
  );
}

function ClipCard({ c, chosen, onPick }: { c: StockClip; chosen: boolean; onPick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      className={`lib-card${chosen ? " chosen" : ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
      title={c.tags}
    >
      {hover || !c.thumb ? (
        <video src={clipUrl(c.preview)} muted autoPlay loop playsInline preload="metadata" />
      ) : (
        <img src={clipUrl(c.thumb)} alt={c.tags} loading="lazy" />
      )}
      {c.duration > 0 && <span className="lib-dur">{Math.round(c.duration)}s</span>}
      {chosen && <span className="lib-chosen">✓ Using</span>}
      <span className="lib-tags">{c.tags}</span>
    </button>
  );
}
