export default function ManualEditor() {
  const planned = [
    "Multi-track timeline: video, audio, text, captions, overlays",
    "Cut, split, trim, reorder, speed and reverse",
    "Keyframes for position, scale, rotation, opacity and volume",
    "Volume, fades, voice enhance and background music tracks",
    "Masks, filters, colour adjustments and transitions",
    "Text and caption styling with the same templates as the Auto Editor",
    "Open any automatic edit here and fine-tune it",
    "Export in any size for any platform",
  ];
  return (
    <div className="page narrow">
      <h1>Manual Editor</h1>
      <p className="lead">The CapCut-style editor is the next part being built. It will include:</p>
      <ul className="checklist">
        {planned.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
