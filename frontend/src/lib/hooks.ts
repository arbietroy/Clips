import { useEffect, useRef, useState } from "react";
import { getHealth, getJob, Health, Job, VideoInfo } from "./api";

export function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    getHealth()
      .then((h) => alive && (setHealth(h), setError(null)))
      .catch((e) => alive && (setHealth(null), setError(e.message)));
    return () => {
      alive = false;
    };
  }, [tick]);
  return { health, error, refresh: () => setTick((t) => t + 1) };
}

/** Polls a job until it finishes. */
export function useJob(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => {
    setJob(null);
    setError(null);
    if (!jobId) return;
    let alive = true;
    const poll = async () => {
      try {
        const j = await getJob(jobId);
        if (!alive) return;
        setJob(j);
        if (j.status === "queued" || j.status === "running") timer.current = window.setTimeout(poll, 1500);
      } catch (e: any) {
        if (alive) setError(e.message);
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [jobId]);
  return { job, error };
}

const RECENT_KEY = "clips.recentVideos";

export function recentVideos(): VideoInfo[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function rememberVideo(v: VideoInfo) {
  try {
    const list = [v, ...recentVideos().filter((x) => x.id !== v.id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
