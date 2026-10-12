import { useEffect, useMemo, useRef } from "react";
import { clipUrl, EditorBroll, Keyframe } from "../../lib/api";
import { fmtTime } from "../../lib/hooks";
import { covered, Range, Span } from "./model";

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

interface Props {
  r0: number;
  r1: number;
  t: number;
  playing: boolean;
  zoom: number;
  spans: Span[];
  pieces: Range[];
  ranges: Range[];
  selectedPiece: number | null;
  broll: EditorBroll[];
  activeBroll: number | null;
  keyframes: Keyframe[];
  activeKeyframe: number | null;
  onSeek: (t: number) => void;
  onSelectPiece: (k: number | null) => void;
  onSelectBroll: (k: number | null) => void;
  /** live = still dragging (no undo step yet); the first live change is preceded by onDragStart */
  onMoveBroll: (k: number, start: number, end: number) => void;
  onDragStart: () => void;
  onSelectKeyframe: (k: number) => void;
}

export default function Timeline(p: Props) {
  const { r0, r1, t } = p;
  const dur = Math.max(r1 - r0, 0.001);
  const scroll = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const pct = (x: number) => `${((x - r0) / dur) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / dur) * 100}%`;

  const timeAt = (clientX: number) => {
    const r = inner.current!.getBoundingClientRect();
    return Math.min(r1, Math.max(r0, r0 + ((clientX - r.left) / r.width) * dur));
  };

  // Ruler ticks: about ten visible at the current zoom.
  const ticks = useMemo(() => {
    const visible = dur / p.zoom;
    const step = STEPS.find((s) => visible / s <= 12) ?? 600;
    const out: number[] = [];
    for (let x = Math.ceil(r0 / step) * step; x <= r1 && out.length < 3000; x += step) out.push(x);
    return { step, out };
  }, [dur, p.zoom, r0, r1]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroll.current;
    if (!el || !p.playing) return;
    const x = ((t - r0) / dur) * el.scrollWidth;
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - el.clientWidth * 0.2;
  }, [t, p.playing, r0, dur]);

  // When zooming, keep the playhead where it was on screen.
  const lastZoom = useRef(p.zoom);
  useEffect(() => {
    const el = scroll.current;
    if (!el || lastZoom.current === p.zoom) return;
    const x = ((t - r0) / dur) * el.scrollWidth;
    el.scrollLeft = x - el.clientWidth / 2;
    lastZoom.current = p.zoom;
  }, [p.zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Drag the playhead: press anywhere on the ruler (or empty track) and move. */
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    p.onSeek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => p.onSeek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Move a b-roll block, or stretch it from either edge. */
  const dragBroll = (e: React.PointerEvent, k: number, mode: "move" | "start" | "end") => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const b = p.broll[k];
    const x0 = e.clientX;
    const t0 = timeAt(x0);
    let started = false;
    p.onSelectBroll(k);
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 3) return;
        started = true;
        p.onDragStart();
      }
      const d = timeAt(ev.clientX) - t0;
      const len = b.end - b.start;
      if (mode === "move") {
        const s = Math.min(Math.max(r0, b.start + d), r1 - len);
        p.onMoveBroll(k, +s.toFixed(2), +(s + len).toFixed(2));
      } else if (mode === "start") {
        p.onMoveBroll(k, +Math.min(Math.max(r0, b.start + d), b.end - 0.5).toFixed(2), b.end);
      } else {
        p.onMoveBroll(k, b.start, +Math.max(Math.min(r1, b.end + d), b.start + 0.5).toFixed(2));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!started) p.onSeek(b.start);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="tl">
      <div className="tl-labels">
        <span className="tl-label ruler-label">{fmtTime(t - r0)}</span>
        <span className="tl-label">Video</span>
        <span className="tl-label">B-roll</span>
        <span className="tl-label">Keyframes</span>
      </div>
      <div className="tl-scroll" ref={scroll}>
        <div className="tl-inner" ref={inner} style={{ width: `${p.zoom * 100}%` }}>
          <div className="tl-ruler" onPointerDown={scrub}>
            {ticks.out.map((x) => (
              <span key={x} className="tl-tick" style={{ left: pct(x) }}>
                {fmtTime(x - r0)}
              </span>
            ))}
          </div>

          <div className="tl-row tl-video" onPointerDown={scrub}>
            {p.spans.map((s, k) => (
              <div key={k} className="tl-kept" style={{ left: pct(s.start), width: width(s.start, s.end) }} />
            ))}
            {p.pieces.map(([a, b], k) => {
              const gone = covered(p.ranges, [a, b]);
              return (
                <div
                  key={`${a}-${b}`}
                  className={`tl-piece${gone ? " gone" : ""}${p.selectedPiece === k ? " selected" : ""}`}
                  style={{ left: pct(a), width: width(a, b) }}
                  title={gone ? "Deleted piece – select it and press Restore" : "Click to select this piece"}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    p.onSelectPiece(k);
                    p.onSeek(timeAt(e.clientX));
                  }}
                />
              );
            })}
          </div>

          <div className="tl-row tl-brolls" onPointerDown={(e) => (p.onSelectBroll(null), scrub(e))}>
            {p.broll.map((b, k) => (
              <div
                key={k}
                className={`tl-broll${p.activeBroll === k ? " active" : ""}${b.label || b.source ? "" : " empty"}`}
                style={{
                  left: pct(b.start),
                  width: width(b.start, b.end),
                  backgroundImage: b.source?.thumb ? `url("${clipUrl(b.source.thumb)}")` : undefined,
                }}
                title={b.label || b.source?.tags || "(choose footage)"}
                onPointerDown={(e) => dragBroll(e, k, "move")}
              >
                <span className="tl-grip left" onPointerDown={(e) => dragBroll(e, k, "start")} />
                <span className="tl-broll-label">{b.label || (b.source ? "your clip" : "?")}</span>
                <span className="tl-grip right" onPointerDown={(e) => dragBroll(e, k, "end")} />
              </div>
            ))}
          </div>

          <div className="tl-row tl-kfs" onPointerDown={scrub}>
            {p.keyframes.map((kf, k) => (
              <button
                key={k}
                className={`tl-kf${p.activeKeyframe === k ? " active" : ""}`}
                style={{ left: pct(kf.time) }}
                title={`Zoom ${kf.scale.toFixed(2)}× at ${fmtTime(kf.time - r0)}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  p.onSelectKeyframe(k);
                }}
              />
            ))}
          </div>

          <div className="tl-head" style={{ left: pct(t) }}>
            <span className="tl-head-knob" />
          </div>
        </div>
      </div>
    </div>
  );
}
