export type Animation = "pop" | "bounce" | "karaoke" | "reveal" | "static";

export interface CaptionTemplate {
  id: string;
  name: string;
  font: string;
  weight: number;
  upper: boolean;
  color: string;
  highlights: string[];
  outlineColor: string;
  outline: number; // px at preview size
  shadow: number;
  box: boolean;
  boxColor: string;
  position: "bottom" | "lower" | "middle";
  words: number;
  animation: Animation;
  glow: number;
  tags: string[];
}

// Mirrors backend/clipforge/templates.py so previews match the rendered video.
export const TEMPLATES: CaptionTemplate[] = [
  { id: "bold-pop", name: "Bold Pop", font: "Poppins", weight: 900, upper: true, color: "#fff", highlights: ["#FFE600"], outlineColor: "#000", outline: 2, shadow: 2, box: false, boxColor: "#000", position: "lower", words: 3, animation: "pop", glow: 0, tags: ["Shorts", "Default"] },
  { id: "hormozi", name: "Hormozi", font: "Poppins", weight: 800, upper: true, color: "#fff", highlights: ["#39FF14", "#FFE600"], outlineColor: "#000", outline: 2.5, shadow: 3, box: false, boxColor: "#000", position: "lower", words: 2, animation: "bounce", glow: 0, tags: ["Shorts", "Business"] },
  { id: "beast", name: "Beast", font: "Luckiest Guy", weight: 400, upper: true, color: "#fff", highlights: ["#FF2D55", "#FFE600", "#2DE1FF"], outlineColor: "#000", outline: 3, shadow: 4, box: false, boxColor: "#000", position: "middle", words: 2, animation: "bounce", glow: 0, tags: ["Shorts", "Fun"] },
  { id: "karaoke", name: "Karaoke", font: "Poppins", weight: 600, upper: false, color: "#fff", highlights: ["#2DE1FF"], outlineColor: "#000", outline: 1.5, shadow: 1, box: false, boxColor: "#000", position: "bottom", words: 7, animation: "karaoke", glow: 0, tags: ["Long-form", "Podcast"] },
  { id: "boxed", name: "Boxed", font: "Archivo Black", weight: 400, upper: true, color: "#fff", highlights: ["#FFE600"], outlineColor: "#000", outline: 0, shadow: 0, box: true, boxColor: "rgba(0,0,0,.8)", position: "lower", words: 4, animation: "pop", glow: 0, tags: ["Shorts", "Clean"] },
  { id: "neon", name: "Neon", font: "Bebas Neue", weight: 400, upper: true, color: "#fff", highlights: ["#FF4FD8"], outlineColor: "#B026FF", outline: 1.5, shadow: 0, box: false, boxColor: "#000", position: "lower", words: 3, animation: "pop", glow: 10, tags: ["Shorts", "Night"] },
  { id: "minimal", name: "Minimal", font: "Poppins", weight: 600, upper: false, color: "#fff", highlights: [], outlineColor: "#000", outline: 0, shadow: 3, box: true, boxColor: "rgba(0,0,0,.55)", position: "bottom", words: 8, animation: "static", glow: 0, tags: ["Long-form", "Clean"] },
  { id: "comic", name: "Comic Reveal", font: "Bangers", weight: 400, upper: true, color: "#fff", highlights: ["#FFE600"], outlineColor: "#000", outline: 2.5, shadow: 4, box: false, boxColor: "#000", position: "lower", words: 4, animation: "reveal", glow: 0, tags: ["Shorts", "Fun"] },
  { id: "marker", name: "Marker", font: "Permanent Marker", weight: 400, upper: false, color: "#fff", highlights: ["#FF9F1C"], outlineColor: "#000", outline: 1.5, shadow: 4, box: false, boxColor: "#000", position: "lower", words: 3, animation: "pop", glow: 0, tags: ["Shorts", "Creator"] },
  { id: "cinema", name: "Cinema", font: "Anton", weight: 400, upper: true, color: "#D9D9D9", highlights: ["#FFFFFF"], outlineColor: "#000", outline: 1, shadow: 2, box: false, boxColor: "#000", position: "bottom", words: 4, animation: "reveal", glow: 0, tags: ["Long-form", "Story"] },
];

export const MOODS = ["upbeat", "inspirational", "chill", "dramatic", "emotional", "energetic", "corporate", "funny", "suspense", "hiphop"];
