import { useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { useHealth } from "../lib/hooks";
import ServerDialog from "./ServerDialog";

export default function Layout() {
  const { health, error, refresh } = useHealth();
  const [open, setOpen] = useState(false);
  const status = health ? "online" : error ? "offline" : "checking";
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="logo">
          <span className="logo-mark">▶</span> Clips
        </Link>
        <nav>
          <NavLink to="/projects">My Projects</NavLink>
          <NavLink to="/find">Clip Finder</NavLink>
          <NavLink to="/auto">Auto Editor</NavLink>
          <NavLink to="/editor">
            Manual Editor <span className="soon">soon</span>
          </NavLink>
        </nav>
        <button className={`server-pill ${status}`} onClick={() => setOpen(true)} title="AI server settings">
          <span className="dot" />
          {status === "online" ? "AI server online" : status === "offline" ? "AI server offline" : "Connecting…"}
        </button>
      </header>
      {status === "offline" && (
        <div className="banner">
          The AI server isn't connected, so you can look around but not process videos yet.{" "}
          <button className="link" onClick={() => setOpen(true)}>
            Connect a server
          </button>
        </div>
      )}
      {health && !health.claude && (
        <div className="banner subtle">
          The server has no Claude API key, so clips are picked by a simple keyword method. Add ANTHROPIC_API_KEY for AI picks.
        </div>
      )}
      <main>
        <Outlet />
      </main>
      {open && <ServerDialog onClose={() => (setOpen(false), refresh())} />}
    </div>
  );
}
