import { useState } from "react";
import FormatPicker, { FormatValue } from "./FormatPicker";

export default function ExportDialog({ initial, source, onCancel, onExport, title = "Choose your export size" }: {
  initial: FormatValue;
  source?: { width: number; height: number };
  onCancel: () => void;
  onExport: (v: FormatValue) => void;
  title?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted">Pick the platform you're posting to. You can export again in another size later.</p>
        <FormatPicker value={value} onChange={setValue} source={source} />
        <div className="row end">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" onClick={() => onExport(value)}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
