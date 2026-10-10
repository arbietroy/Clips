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


def detect_rotation(video: Path, samples: int = 16, log=None) -> int:
    """Clockwise rotation (0, 90, 180 or 270) that makes the people in the video upright.

    Phones sometimes save portrait footage sideways (or editing apps drop the rotation flag), so the
    speaker appears lying on their side. Faces are only detected when upright, so we sample frames,
    try each rotation and keep the one where faces show up most often.
    """
    try:
        import cv2
    except ImportError:
        return 0
    if not hasattr(cv2, "CascadeClassifier"):
        return 0
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    eyes = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        return 0

    def upright_face(img) -> bool:
        # A face counts only if an eye is found in its upper part: upside-down or sideways false
        # positives almost never pass this check.
        for x, y, w, h in cascade.detectMultiScale(img, scaleFactor=1.1, minNeighbors=6, minSize=(32, 32)):
            found = eyes.detectMultiScale(img[y:y + h, x:x + w], scaleFactor=1.1, minNeighbors=3)
            if any(ey + eh / 2 < 0.6 * h for _ex, ey, _ew, eh in found):
                return True
        return False

    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    turns = {0: None, 90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    hits = {r: 0 for r in turns}
    for k in range(samples):
        if frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(frames * (k + 0.5) / samples))
        ok, frame = cap.read()
        if not ok:
            continue
        h, w = frame.shape[:2]
        scale = 720 / max(w, h)
        small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1 else frame
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        for r, code in turns.items():
            if upright_face(gray if code is None else cv2.rotate(gray, code)):
                hits[r] += 1
    cap.release()
    best = max(hits, key=lambda r: hits[r])
    # Only rotate when the evidence is clear: faces in several frames, and clearly more than upright.
    if best != 0 and hits[best] >= max(3, samples // 5) and hits[best] >= 2 * hits[0] + 1:
        if log:
            log.info(f"The video looks sideways – rotating it {best}° clockwise so people are upright "
                     f"(faces found upright in {hits[0]}/{samples} frames, rotated in {hits[best]}/{samples})")
        return best
    return 0
