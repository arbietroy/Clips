import { effectiveRotation, FORMATS, FormatId, REFRAMES, Reframe, Rotate, ROTATIONS, rotationLabel } from "../data/formats";

export interface FormatValue {
  format: FormatId;
  custom_width?: number;
  custom_height?: number;
  reframe: Reframe;
  rotate: Rotate;
}

function Shape({ w, h }: { w: number; h: number }) {
  const scale = 34 / Math.max(w, h);
  return (
    <span className="shape-box">
      <span className="shape" style={{ width: w * scale, height: h * scale }} />
    </span>
  );
}

export default function FormatPicker({ value, onChange, source }: {
  value: FormatValue;
  onChange: (v: FormatValue) => void;
  source?: { width: number; height: number; rotation?: number };
}) {
  const turn = effectiveRotation(value.rotate ?? "auto", source?.rotation ?? 0);
  // What the picture looks like once it's upright.
  const upright = source && (turn === 90 || turn === 270) ? { width: source.height, height: source.width } : source;
  const sel = FORMATS.find((f) => f.id === value.format);
  const target =
    value.format === "custom"
      ? { width: value.custom_width || 1080, height: value.custom_height || 1920 }
      : sel && sel.width
        ? sel
        : upright;
  const needsReframe = upright && target && Math.abs(upright.width / upright.height - target.width / target.height) > 0.01;
  return (
    <div>
      <div className="formats">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`format ${value.format === f.id ? "active" : ""}`}
            onClick={() => onChange({ ...value, format: f.id })}
          >
            <Shape w={f.width || upright?.width || 16} h={f.height || upright?.height || 9} />
            <strong>
              {f.label} <span className="muted">{f.ratio}</span>
            </strong>
            <span className="muted small">{f.platforms}</span>
          </button>
        ))}
        <button
          type="button"
          className={`format ${value.format === "custom" ? "active" : ""}`}
          onClick={() => onChange({ ...value, format: "custom", custom_width: value.custom_width || 1080, custom_height: value.custom_height || 1920 })}
        >
          <Shape w={value.custom_width || 3} h={value.custom_height || 4} />
          <strong>Custom</strong>
          <span className="muted small">Any width × height</span>
        </button>
      </div>
      {value.format === "custom" && (
        <div className="row gap custom-size">
          <label className="field">
            Width
            <input type="number" min={240} max={3840} value={value.custom_width} onChange={(e) => onChange({ ...value, custom_width: +e.target.value })} />
          </label>
          <span className="times">×</span>
          <label className="field">
            Height
            <input type="number" min={240} max={3840} value={value.custom_height} onChange={(e) => onChange({ ...value, custom_height: +e.target.value })} />
          </label>
        </div>
      )}
      <div className="reframes">
        <span className="muted small">Rotation:</span>
        {ROTATIONS.map((r) => (
          <button key={r.id} type="button" className={`chip ${(value.rotate ?? "auto") === r.id ? "active" : ""}`} onClick={() => onChange({ ...value, rotate: r.id })}>
            {r.label}
          </button>
        ))}
      </div>
      {source && (value.rotate ?? "auto") === "auto" && (source.rotation ?? 0) !== 0 && (
        <p className="notice small">
          This video looks sideways, so it will be {rotationLabel(source.rotation ?? 0)} so the person is upright.
          Pick “None” if that's wrong.
        </p>
      )}
      {(needsReframe || !source) && (
        <div className="reframes">
          <span className="muted small">When the shape changes:</span>
          {REFRAMES.map((r) => (
            <button key={r.id} type="button" className={`chip ${value.reframe === r.id ? "active" : ""}`} onClick={() => onChange({ ...value, reframe: r.id })} title={r.hint}>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
