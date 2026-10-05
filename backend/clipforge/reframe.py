"""Speaker-aware reframing of landscape footage into 9:16."""

from __future__ import annotations

from pathlib import Path
from statistics import median


def face_centers(video: Path, shots: list[tuple[float, float]], samples_per_shot: int = 6, log=None) -> list[float]:
    """Horizontal centre (0-1) of the main face in each shot; 0.5 when none is found."""
    try:
        import cv2
    except ImportError:
        cv2 = None
    if cv2 is None or not hasattr(cv2, "CascadeClassifier"):
        if log:
            log.warn("OpenCV 4.x is needed for face tracking – using centre crop")
        return [0.5] * len(shots)

    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        return [0.5] * len(shots)

    centers: list[float] = []
    previous = 0.5
    for a, b in shots:
        xs = []
        for k in range(samples_per_shot):
            t = a + (b - a) * (k + 0.5) / samples_per_shot
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            h, w = frame.shape[:2]
            scale = 480 / max(w, 1)
            small = cv2.resize(frame, (480, int(h * scale))) if scale < 1 else frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(24, 24))
            if len(faces):
                x, _y, fw, _fh = max(faces, key=lambda f: f[2] * f[3])
                xs.append((x + fw / 2) / small.shape[1])
        c = median(xs) if xs else previous
        # Small movements are noise; keep the frame steady between shots.
        if abs(c - previous) < 0.04:
            c = previous
        centers.append(c)
        previous = c
    cap.release()
    return centers
