interface Props {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export default function Toggle({ label, hint, checked, onChange }: Props) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="muted small block">{hint}</span>}
      </span>
    </label>
  );
}
