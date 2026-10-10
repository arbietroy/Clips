#!/usr/bin/env bash
# Starts Clips on Mac/Linux: backend + website, then opens the browser. Keys are read from backend/.env.
set -e
root="$(cd "$(dirname "$0")" && pwd)"
[ -d "$root/backend/.venv" ] || (cd "$root/backend" && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)
[ -d "$root/frontend/node_modules" ] || (cd "$root/frontend" && npm install)
(cd "$root/backend" && .venv/bin/python -m uvicorn server:app --port 8000) &
(cd "$root/frontend" && npm run dev) &
sleep 6; (command -v open >/dev/null && open http://localhost:5173) || xdg-open http://localhost:5173 || true
wait
