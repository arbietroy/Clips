// Client for the Python API (backend/server.py).

const SETTINGS_KEY = "clips.server";

export interface ServerSettings {
  url: string;
  accessCode: string;
}

export function getServerSettings(): ServerSettings {
  let saved: Partial<ServerSettings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    /* storage unavailable */
  }
  return {
    url: (saved.url || import.meta.env.VITE_API_URL || "").replace(/\/$/, ""),
    accessCode: saved.accessCode || "",
  };
}

export function saveServerSettings(s: ServerSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export const apiUrl = (path: string) => getServerSettings().url + path;

function headers(extra: Record<string, string> = {}) {
  const { accessCode } = getServerSettings();
  return accessCode ? { ...extra, "X-Access-Code": accessCode } : extra;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(path), { ...init, headers: headers(init.headers as Record<string, string>) });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

// ---------------------------------------------------------------- types

export interface Health {
  ok: boolean;
  claude: boolean;
  pexels: boolean;
  pixabay: boolean;
  broll: boolean;
  music_tracks: number;
  access_code: boolean;
}

export interface VideoInfo {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  url: string;
  rotation?: number; // clockwise turn the server detected to make people upright
  clips?: ClipIdea[];
}

export interface ClipIdea {
  start: number;
  end: number;
  title: string;
  hook_text: string;
  virality_score: number;
  reason: string;
  music_mood: string;
  text?: string; // what is said in the clip
}

export interface Output {
  name: string;
  kind: "raw" | "clip" | "full";
  file: string;
  srt: string;
  plan: string;
  duration: number;
  width: number;
  height: number;
  title?: string;
  virality_score?: number;
  reason?: string;
  hook_text?: string | null;
  summary?: string;
  source_range?: [number, number];
  music?: string | null;
  broll?: string[];
  cuts?: number;
  format?: string;
  template?: string;
  error?: string;
}

export interface JobOptions {
  num_clips?: number;
  length?: number;
  format?: string;
  custom_width?: number;
  custom_height?: number;
  template?: string;
  highlight?: string | null;
  captions?: boolean;
  hook_title?: boolean;
  chapter_titles?: boolean;
  broll?: boolean;
  music?: boolean;
  music_mood?: string | null;
  music_id?: string | null;
  transitions?: boolean;
  zoom?: boolean;
  fillers?: boolean;
  aggressive?: boolean;
  reframe?: string;
  rotate?: string;
  whisper?: string;
}

export interface Job {
  id: string;
  type: "analyze" | "find_clips" | "auto_edit";
  video_id: string;
  status: "queued" | "running" | "done" | "error";
  phase: "transcribing" | "analyzing" | "rendering" | null;
  progress: number;
  step: string;
  log: string[];
  clips: ClipIdea[];
  outputs: Output[];
  error: string | null;
  queue_position: number;
}

// ---------------------------------------------------------------- calls

export const getHealth = () => request<Health>("/api/health");
export const getVideo = (id: string) => request<VideoInfo>(`/api/videos/${id}`);
export const getJob = (id: string) => request<Job>(`/api/jobs/${id}`);

export const createJob = (body: {
  type: Job["type"];
  video_id: string;
  range?: [number, number] | null;
  clips?: ClipIdea[];
  options: JobOptions;
}) => request<Job>("/api/jobs", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

/** Upload with progress (fetch can't report upload progress). */
export function upload<T>(path: string, file: File, onProgress: (frac: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(path));
    const { accessCode } = getServerSettings();
    if (accessCode) xhr.setRequestHeader("X-Access-Code", accessCode);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.detail || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Could not reach the AI server"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

export const uploadVideo = (f: File, p: (n: number) => void) => upload<VideoInfo>("/api/videos", f, p);
export const uploadAudio = (f: File, p: (n: number) => void) => upload<{ id: string; name: string }>("/api/audio", f, p);
