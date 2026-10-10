import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="page home">
      <section className="hero">
        <h1>
          Turn long videos into <span className="accent">viral clips</span>.
        </h1>
        <p className="lead">
          Upload a podcast, interview or talking-head video. Clips finds the moments worth posting, then edits them for you:
          captions, b-roll, music, transitions and zooms, sized for every platform.
        </p>
        <div className="row gap wrap">
          <Link to="/find" className="btn big">
            Find viral clips
          </Link>
          <Link to="/auto" className="btn big ghost">
            Auto-edit a video
          </Link>
        </div>
      </section>

      <section className="tools">
        <Link to="/find" className="tool">
          <span className="tool-icon">✂</span>
          <h3>Clip Finder</h3>
          <p>AI reads the whole video and cuts out the moments most likely to go viral, ranked by score, with the reason for each.</p>
        </Link>
        <Link to="/auto" className="tool">
          <span className="tool-icon">✦</span>
          <h3>Auto Editor</h3>
          <p>Edits a full video or any clip: removes ums and repeats, adds animated captions, b-roll, music, transitions and zooms.</p>
        </Link>
        <Link to="/editor" className="tool">
          <span className="tool-icon">▤</span>
          <h3>Manual Editor</h3>
          <p>Edit by text: cut any word or sentence from the transcript, place your own b-roll, pick captions and music, then export.</p>
        </Link>
      </section>

      <section className="steps">
        <div>
          <b>1</b>
          <h4>Upload</h4>
          <p>Any long video with speech.</p>
        </div>
        <div>
          <b>2</b>
          <h4>AI finds the moments</h4>
          <p>Hooks, payoffs, quotable lines, each scored.</p>
        </div>
        <div>
          <b>3</b>
          <h4>Auto-edit</h4>
          <p>Captions, b-roll, music, cuts, transitions.</p>
        </div>
        <div>
          <b>4</b>
          <h4>Export anywhere</h4>
          <p>9:16, 16:9, 1:1, 4:5 or a custom size.</p>
        </div>
      </section>
    </div>
  );
}
