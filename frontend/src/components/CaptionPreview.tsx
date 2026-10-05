import { CSSProperties, useEffect, useState } from "react";
import { CaptionTemplate } from "../data/templates";

const SAMPLE = "this is how you turn one video into ten viral clips".split(" ");

/** Animated preview that imitates how a template renders in the final video. */
export default function CaptionPreview({ t, highlight, size = 1, playing = true }: {
  t: CaptionTemplate;
  highlight?: string | null;
  size?: number;
  playing?: boolean;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % SAMPLE.length), 420);
    return () => clearInterval(id);
  }, [playing]);

  const groupStart = Math.floor(i / t.words) * t.words;
  const group = SAMPLE.slice(groupStart, groupStart + t.words);
  const active = i - groupStart;
  const colors = highlight ? [highlight] : t.highlights;
  const fontSize = (t.words > 4 ? 13 : 20) * size;

  const stroke = t.outline
    ? Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2;
        return `${(Math.cos(a) * t.outline).toFixed(1)}px ${(Math.sin(a) * t.outline).toFixed(1)}px 0 ${t.outlineColor}`;
      })
    : [];
  const shadows = [...stroke];
  if (t.shadow) shadows.push(`${t.shadow * 0.7}px ${t.shadow * 0.7}px ${t.shadow}px rgba(0,0,0,.6)`);
  if (t.glow) shadows.push(`0 0 ${t.glow}px ${t.outlineColor}`, `0 0 ${t.glow * 2}px ${t.outlineColor}`);

  const lineStyle: CSSProperties = {
    fontFamily: `"${t.font}", sans-serif`,
    fontWeight: t.weight,
    fontSize,
    color: t.color,
    textTransform: t.upper ? "uppercase" : "none",
    textShadow: shadows.join(","),
    background: t.box ? t.boxColor : "transparent",
    padding: t.box ? "2px 8px" : 0,
    borderRadius: t.box ? 6 : 0,
    lineHeight: 1.15,
    textAlign: "center",
    maxWidth: "92%",
  };

  return (
    <div className={`caption-stage pos-${t.position}`}>
      <div style={lineStyle}>
        {group.map((w, k) => {
          let style: CSSProperties = { display: "inline-block", margin: "0 0.12em", transition: "transform .09s ease-out" };
          const on = k === active && colors.length > 0;
          if (t.animation === "karaoke") {
            if (k <= active && colors.length) style.color = colors[0];
          } else if (on) {
            style.color = colors[i % colors.length];
            style.transform = t.animation === "bounce" ? `scale(1.25) rotate(${i % 2 ? -4 : 4}deg)` : "scale(1.12)";
          }
          if (t.animation === "reveal" && k > active) style.opacity = 0;
          return (
            <span key={`${groupStart}-${k}`} style={style}>
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
}
