"""Small progress logger shared by the CLI and the web UI."""

from __future__ import annotations

import sys
import time
from typing import Callable


class Log:
    def __init__(self, sink: Callable[[str, float | None], None] | None = None, verbose: bool = False):
        self.sink = sink
        self.verbose = verbose
        self.lines: list[str] = []
        self.t0 = time.time()

    def _emit(self, msg: str, pct: float | None = None) -> None:
        line = f"[{time.time() - self.t0:6.1f}s] {msg}"
        self.lines.append(line)
        if self.sink:
            self.sink(line, pct)
        else:
            print(line, file=sys.stderr, flush=True)

    def info(self, msg: str) -> None:
        self._emit(msg)

    def warn(self, msg: str) -> None:
        self._emit("WARNING: " + msg)

    def debug(self, msg: str) -> None:
        if self.verbose:
            self._emit(msg)

    def progress(self, frac: float, msg: str) -> None:
        if self.sink:
            self.sink(msg, frac)
