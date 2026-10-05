import { TEMPLATES } from "../data/templates";
import CaptionPreview from "./CaptionPreview";

export default function TemplatePicker({ value, onChange, highlight }: {
  value: string;
  onChange: (id: string) => void;
  highlight?: string | null;
}) {
  return (
    <div className="templates">
      {TEMPLATES.map((t) => (
        <button key={t.id} type="button" className={`template ${value === t.id ? "active" : ""}`} onClick={() => onChange(t.id)}>
          <CaptionPreview t={t} highlight={value === t.id ? highlight : null} />
          <span className="template-name">{t.name}</span>
          <span className="template-tags">{t.tags.join(" · ")}</span>
        </button>
      ))}
    </div>
  );
}
