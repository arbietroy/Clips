import { useNavigate } from "react-router-dom";
import UploadDrop from "../components/UploadDrop";

/** Start a new project: upload, then work on it on its project page. */
export default function ClipFinder() {
  const navigate = useNavigate();
  return (
    <div className="page narrow-wide">
      <h1>Clip Finder</h1>
      <p className="lead">
        Upload a long video. AI suggests the moments most likely to go viral. Preview them, adjust them, and export
        only the ones you like. Everything is saved in <b>My Projects</b>.
      </p>
      <UploadDrop onReady={(v) => navigate(`/projects/${v.id}`)} hint="Podcasts, interviews, lectures, talking-head videos" />
    </div>
  );
}
