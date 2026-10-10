import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl, deleteProject, getProjects, ProjectSummary } from "../lib/api";
import { fmtTime } from "../lib/hooks";

function ago(ts: number) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function Projects() {
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjects().then(setItems).catch((e) => setError(e.message));
  }, []);

  const remove = async (e: React.MouseEvent, p: ProjectSummary) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete “${p.name}” and everything made from it? This can't be undone.`)) return;
    try {
      await deleteProject(p.id);
      localStorage.removeItem(`clips.draft.${p.id}`);
      setItems((list) => (list ?? []).filter((x) => x.id !== p.id));
    } catch (err: any) {
      setError(`Couldn't delete “${p.name}”: ${err.message}`);
    }
  };

  return (
    <div className="page">
      <div className="project-head">
        <div>
          <h1>My Projects</h1>
          <p className="lead">Every video you've uploaded, with its suggested clips, exports and edits.</p>
        </div>
        <Link to="/find" className="btn">+ New project</Link>
      </div>

      {error && <p className="error">Couldn't load your projects: {error}</p>}
      {items && items.length === 0 && (
        <div className="panel empty">
          <p>No projects yet.</p>
          <Link to="/find" className="btn">Upload your first video</Link>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="projects">
          {items.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="project-card">
              <div className="project-thumb">
                {p.thumb && <img src={apiUrl(p.thumb)} alt="" loading="lazy" />}
                <span className="duration">{fmtTime(p.duration)}</span>
                {p.active_jobs.length > 0 && <span className="working">Working…</span>}
                {p.active_jobs.length === 0 && (
                  <button className="card-delete" title="Delete project" onClick={(e) => remove(e, p)}>
                    Delete
                  </button>
                )}
              </div>
              <div className="card-body">
                <h3>{p.name}</h3>
                <p className="muted small">
                  {p.clips_found} suggested · {p.exports} exported · {p.edits} edited
                </p>
                <p className="meta">Updated {ago(p.updated)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
