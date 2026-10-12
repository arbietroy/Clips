import { EditorBroll, EditorData, Keyframe } from "../../lib/api";

export type Range = [number, number];

export interface Span {
  start: number;
  end: number;
}

export interface Snapshot {
  cut: number[]; // transcript words cut
  ranges: Range[]; // pieces deleted on the timeline (source seconds)
  splits: number[]; // where the timeline was sliced
  broll: EditorBroll[];
  keyframes: Keyframe[];
}

export const EMPTY: Snapshot = { cut: [], ranges: [], splits: [], broll: [], keyframes: [] };

export function mergeRanges(rs: Range[]): Range[] {
  const sorted = rs.filter(([a, b]) => b - a > 0.001).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.001) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function removeRange(rs: Range[], [a, b]: Range): Range[] {
  const out: Range[] = [];
  for (const [s, e] of rs) {
    if (e <= a || s >= b) out.push([s, e]);
    else {
      if (s < a) out.push([s, a]);
      if (e > b) out.push([b, e]);
    }
  }
  return out;
}

export const inRanges = (rs: Range[], t: number) => rs.some(([a, b]) => t >= a && t <= b);
export const covered = (rs: Range[], [a, b]: Range) => rs.some(([s, e]) => s <= a + 0.001 && e >= b - 0.001);

/** A word is cut when it was cut in the transcript or sits in a deleted piece of the timeline. */
export const wordIsCut = (w: { i: number; start: number; end: number }, cut: Set<number>, ranges: Range[]) =>
  cut.has(w.i) || inRanges(ranges, (w.start + w.end) / 2);

/** The parts of the source that play, mirroring the server: kept words, padded and joined across short
 *  pauses, minus the pieces deleted on the timeline. */
export function keptSpans(data: EditorData, cut: Set<number>, ranges: Range[]): Span[] {
  const pad = data.padding;
  const spans: Span[] = [];
  let prevWordEnd = -1;
  let prevCut = true;
  for (const w of data.words) {
    if (wordIsCut(w, cut, ranges)) {
      prevCut = true;
      continue;
    }
    const s = Math.max(w.start - pad, data.range[0]);
    const e = Math.min(w.end + pad, data.range[1]);
    const last = spans[spans.length - 1];
    if (last && !prevCut && w.start - prevWordEnd <= data.max_pause) last.end = e;
    else spans.push({ start: last ? Math.max(s, last.end) : s, end: e });
    prevWordEnd = w.end;
    prevCut = false;
  }
  let out = spans.filter((s) => s.end - s.start > 0.05);
  for (const [a, b] of ranges) {
    const next: Span[] = [];
    for (const s of out) {
      if (b <= s.start || a >= s.end) next.push(s);
      else {
        if (a - s.start >= 0.15) next.push({ start: s.start, end: a });
        if (s.end - b >= 0.15) next.push({ start: b, end: s.end });
      }
    }
    out = next;
  }
  return out;
}

export const total = (spans: Span[]) => spans.reduce((a, s) => a + s.end - s.start, 0);

/** Pieces of the timeline between the slice points. */
export function pieces(r0: number, r1: number, splits: number[]): Range[] {
  const edges = [r0, ...splits.filter((s) => s > r0 + 0.05 && s < r1 - 0.05).sort((a, b) => a - b), r1];
  const out: Range[] = [];
  for (let k = 0; k < edges.length - 1; k++) if (edges[k + 1] - edges[k] > 0.01) out.push([edges[k], edges[k + 1]]);
  return out;
}

// ---------------------------------------------------------------- keyframes (same easing as the server)

const smooth = (f: number) => f * f * (3 - 2 * f);

export function motionAt(kfs: Keyframe[], t: number): { scale: number; x: number; y: number } {
  if (!kfs.length) return { scale: 1, x: 0, y: 0 };
  const k = [...kfs].sort((a, b) => a.time - b.time);
  if (t <= k[0].time) return { scale: k[0].scale, x: k[0].x, y: k[0].y };
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i];
    const b = k[i + 1];
    if (t < b.time) {
      const f = smooth((t - a.time) / Math.max(b.time - a.time, 0.001));
      return { scale: a.scale + (b.scale - a.scale) * f, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  const z = k[k.length - 1];
  return { scale: z.scale, x: z.x, y: z.y };
}

export const KF_SNAP = 0.08; // seconds: the playhead is "on" a keyframe this close to it
