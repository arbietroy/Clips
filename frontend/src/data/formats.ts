export type FormatId = "vertical" | "landscape" | "square" | "portrait" | "classic" | "original" | "custom";

export interface Format {
  id: FormatId;
  label: string;
  ratio: string;
  width: number;
  height: number;
  platforms: string;
}

// Keep in sync with backend/clipforge/formats.py
export const FORMATS: Format[] = [
  { id: "vertical", label: "Vertical", ratio: "9:16", width: 1080, height: 1920, platforms: "TikTok · Reels · Shorts" },
  { id: "landscape", label: "Landscape", ratio: "16:9", width: 1920, height: 1080, platforms: "YouTube · Facebook" },
  { id: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080, platforms: "Instagram · LinkedIn · X" },
  { id: "portrait", label: "Portrait", ratio: "4:5", width: 1080, height: 1350, platforms: "Instagram / Facebook feed" },
  { id: "classic", label: "Classic", ratio: "4:3", width: 1440, height: 1080, platforms: "Presentations" },
  { id: "original", label: "Original", ratio: "Source", width: 0, height: 0, platforms: "Keep the source size" },
];

export type Reframe = "face" | "blur" | "center";

export type Rotate = "auto" | "0" | "90" | "180" | "270";

export const ROTATIONS: { id: Rotate; label: string }[] = [
  { id: "auto", label: "Auto-detect" },
  { id: "0", label: "None" },
  { id: "90", label: "Turn right ↻" },
  { id: "270", label: "Turn left ↺" },
  { id: "180", label: "Upside down" },
];

/** Clockwise degrees that will actually be applied for a choice. */
export function effectiveRotation(choice: Rotate, detected = 0): number {
  return choice === "auto" ? detected : Number(choice);
}

export function rotationLabel(deg: number) {
  return deg === 90 ? "turned right" : deg === 270 ? "turned left" : deg === 180 ? "flipped upright" : "";
}

export const REFRAMES: { id: Reframe; label: string; hint: string }[] = [
  { id: "face", label: "Follow the speaker", hint: "Crops around the face in every shot" },
  { id: "blur", label: "Fit with blur", hint: "Whole frame over a blurred background" },
  { id: "center", label: "Centre crop", hint: "Simple crop from the middle" },
];
