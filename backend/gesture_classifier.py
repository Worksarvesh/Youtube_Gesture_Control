"""
gesture_classifier.py

Rule-based hand gesture classification from MediaPipe Hands landmarks.

This module is intentionally decoupled from MediaPipe's own types -- it
operates on a plain list of 21 (x, y, z) tuples (normalized 0-1 image
coordinates, y grows downward) so the classification rules can be tuned
and unit-tested independently of the WebSocket/server/MediaPipe plumbing.

Landmark index reference (MediaPipe Hands):
    0  wrist
    1-4   thumb   (CMC, MCP, IP, TIP)
    5-8   index   (MCP, PIP, DIP, TIP)
    9-12  middle  (MCP, PIP, DIP, TIP)
    13-16 ring    (MCP, PIP, DIP, TIP)
    17-20 pinky   (MCP, PIP, DIP, TIP)
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, List, Optional, Tuple

Landmark = Tuple[float, float, float]
Landmarks = List[Landmark]

WRIST = 0
THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 1, 2, 3, 4
INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP = 5, 6, 7, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP = 9, 10, 11, 12
RING_MCP, RING_PIP, RING_DIP, RING_TIP = 13, 14, 15, 16
PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP = 17, 18, 19, 20

# ---------------------------------------------------------------------------
# Finger-state helpers
# ---------------------------------------------------------------------------


@dataclass
class FingerStates:
    thumb: bool
    index: bool
    middle: bool
    ring: bool
    pinky: bool

    def count_extended(self) -> int:
        return sum([self.thumb, self.index, self.middle, self.ring, self.pinky])

    def all_extended(self) -> bool:
        return self.count_extended() == 5

    def all_curled(self) -> bool:
        return self.count_extended() == 0


def _is_finger_extended(landmarks: Landmarks, mcp: int, pip: int, tip: int) -> bool:
    """A non-thumb finger is 'extended' when its tip is meaningfully above
    (smaller y than) its PIP joint, which itself should be above the MCP.
    Using a small margin avoids flicker when the finger is borderline
    straight."""
    tip_y = landmarks[tip][1]
    pip_y = landmarks[pip][1]
    mcp_y = landmarks[mcp][1]
    margin = 0.02
    return (pip_y - tip_y) > margin and (mcp_y - tip_y) > margin


def _is_thumb_extended(landmarks: Landmarks) -> bool:
    """Thumb extension is judged by lateral (x) distance from the palm,
    rather than y, since the thumb moves mostly sideways. We compare the
    thumb tip's distance from the pinky-MCP (opposite side of palm) against
    the thumb IP's distance from the same point -- if the tip is farther
    out than the IP joint by a healthy margin, the thumb is extended.
    Falls back gracefully regardless of left/right hand."""
    tip = landmarks[THUMB_TIP]
    ip = landmarks[THUMB_IP]
    mcp = landmarks[THUMB_MCP]
    ref = landmarks[PINKY_MCP]

    def dist(a: Landmark, b: Landmark) -> float:
        return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5

    tip_dist = dist(tip, ref)
    mcp_dist = dist(mcp, ref)
    return tip_dist > mcp_dist * 1.15


def get_finger_states(landmarks: Landmarks) -> FingerStates:
    return FingerStates(
        thumb=_is_thumb_extended(landmarks),
        index=_is_finger_extended(landmarks, INDEX_MCP, INDEX_PIP, INDEX_TIP),
        middle=_is_finger_extended(landmarks, MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP),
        ring=_is_finger_extended(landmarks, RING_MCP, RING_PIP, RING_TIP),
        pinky=_is_finger_extended(landmarks, PINKY_MCP, PINKY_PIP, PINKY_TIP),
    )


def _palm_size(landmarks: Landmarks) -> float:
    """Rough proxy for how close the hand is to the camera: distance from
    wrist to middle-finger MCP. Grows as the hand approaches the camera."""
    wrist = landmarks[WRIST]
    mid_mcp = landmarks[MIDDLE_MCP]
    return ((wrist[0] - mid_mcp[0]) ** 2 + (wrist[1] - mid_mcp[1]) ** 2) ** 0.5


# ---------------------------------------------------------------------------
# Static pose classifiers (single-frame)
# ---------------------------------------------------------------------------


def is_open_palm(states: FingerStates) -> bool:
    return states.all_extended()


def is_fist(states: FingerStates) -> bool:
    return states.all_curled()


def is_thumbs_up(landmarks: Landmarks, states: FingerStates) -> bool:
    if not states.thumb or states.count_extended() != 1:
        return False
    # thumb tip should be clearly above the wrist (pointing up)
    return landmarks[THUMB_TIP][1] < landmarks[WRIST][1] - 0.08


def is_thumbs_down(landmarks: Landmarks, states: FingerStates) -> bool:
    if not states.thumb or states.count_extended() != 1:
        return False
    return landmarks[THUMB_TIP][1] > landmarks[WRIST][1] + 0.08


def is_peace_sign(states: FingerStates) -> bool:
    return (
        states.index
        and states.middle
        and not states.ring
        and not states.pinky
        and not states.thumb
    )


STATIC_GESTURES = (
    "open_palm",
    "fist",
    "thumbs_up",
    "thumbs_down",
    "peace_sign",
)


def classify_static_pose(landmarks: Landmarks) -> Optional[Tuple[str, float]]:
    """Returns (gesture_name, confidence) for a single frame's landmarks,
    or None if no recognized static pose is present. Order matters: more
    specific poses (thumbs up/down, peace) are checked before the broad
    all-extended / all-curled poses so an ambiguous frame doesn't get
    mis-bucketed as open_palm."""
    states = get_finger_states(landmarks)

    if is_thumbs_up(landmarks, states):
        return "thumbs_up", 0.9
    if is_thumbs_down(landmarks, states):
        return "thumbs_down", 0.9
    if is_peace_sign(states):
        return "peace_sign", 0.9
    if is_open_palm(states):
        return "open_palm", 0.85
    if is_fist(states):
        return "fist", 0.85
    return None


# ---------------------------------------------------------------------------
# Motion-based classifiers (rolling window across frames)
# ---------------------------------------------------------------------------


@dataclass
class MotionHistory:
    """Rolling buffer of recent wrist positions + palm sizes, one entry per
    processed frame, used for swipe and push-toward-camera detection."""

    max_len: int = 12
    _wrist_x: Deque[float] = field(default_factory=deque)
    _wrist_y: Deque[float] = field(default_factory=deque)
    _palm_size: Deque[float] = field(default_factory=deque)
    _timestamps: Deque[float] = field(default_factory=deque)

    def push(self, landmarks: Landmarks) -> None:
        now = time.monotonic()
        self._wrist_x.append(landmarks[WRIST][0])
        self._wrist_y.append(landmarks[WRIST][1])
        self._palm_size.append(_palm_size(landmarks))
        self._timestamps.append(now)
        while len(self._wrist_x) > self.max_len:
            self._wrist_x.popleft()
            self._wrist_y.popleft()
            self._palm_size.popleft()
            self._timestamps.popleft()

    def clear(self) -> None:
        self._wrist_x.clear()
        self._wrist_y.clear()
        self._palm_size.clear()
        self._timestamps.clear()

    def detect_swipe(self) -> Optional[Tuple[str, float]]:
        if len(self._wrist_x) < 5:
            return None
        dx = self._wrist_x[-1] - self._wrist_x[0]
        dy_total = max(self._wrist_y) - min(self._wrist_y)
        elapsed = self._timestamps[-1] - self._timestamps[0]
        if elapsed <= 0 or elapsed > 0.9:
            return None
        # Require mostly-horizontal motion so a diagonal or vertical wave
        # doesn't get misread as a swipe.
        if dy_total > 0.18:
            return None
        if dx > 0.22:
            return "swipe_right", min(0.95, 0.6 + dx)
        if dx < -0.22:
            return "swipe_left", min(0.95, 0.6 + abs(dx))
        return None

    def detect_push(self) -> Optional[Tuple[str, float]]:
        """Palm growing quickly toward the camera = push gesture (fullscreen
        toggle). Requires the hand to currently be an open palm to avoid
        false positives from a fist or partial hand suddenly approaching."""
        if len(self._palm_size) < 5:
            return None
        growth = self._palm_size[-1] - self._palm_size[0]
        elapsed = self._timestamps[-1] - self._timestamps[0]
        if elapsed <= 0 or elapsed > 0.9:
            return None
        relative_growth = growth / max(self._palm_size[0], 1e-4)
        if relative_growth > 0.35:
            return "palm_push", min(0.95, 0.6 + relative_growth)
        return None


# ---------------------------------------------------------------------------
# Cooldown / debounce
# ---------------------------------------------------------------------------


@dataclass
class CooldownTracker:
    """Per-gesture cooldown so a held pose or a slow swipe doesn't fire the
    same action every frame. Each gesture type gets its own timer."""

    cooldown_seconds: float = 1.0
    _last_fired: dict = field(default_factory=dict)

    def is_ready(self, gesture: str) -> bool:
        last = self._last_fired.get(gesture)
        if last is None:
            return True
        return (time.monotonic() - last) >= self.cooldown_seconds

    def mark_fired(self, gesture: str) -> None:
        self._last_fired[gesture] = time.monotonic()


# ---------------------------------------------------------------------------
# Per-connection gesture state, tying it all together
# ---------------------------------------------------------------------------

# Static poses use a slightly shorter cooldown than swipes/push, since a
# held palm/fist toggle feels more natural if it can re-fire a bit sooner.
STATIC_COOLDOWN_SECONDS = 1.0
MOTION_COOLDOWN_SECONDS = 0.9


class GestureState:
    """Owns one connection's rolling motion history + cooldown timers.
    Instantiate one per WebSocket connection."""

    def __init__(self) -> None:
        self.motion = MotionHistory()
        self.static_cooldown = CooldownTracker(STATIC_COOLDOWN_SECONDS)
        self.motion_cooldown = CooldownTracker(MOTION_COOLDOWN_SECONDS)

    def process_frame(self, landmarks: Optional[Landmarks]) -> Optional[dict]:
        """Main dispatcher: checks static poses first, then swipe/push
        motion using recent frame history. Returns a dict payload ready to
        be sent over the WebSocket, or None if nothing fired this frame."""
        if landmarks is None:
            # No hand in frame -- don't let stale motion history trigger a
            # false swipe once the hand reappears.
            self.motion.clear()
            return None

        self.motion.push(landmarks)

        static_result = classify_static_pose(landmarks)
        if static_result is not None:
            gesture, confidence = static_result
            if self.static_cooldown.is_ready(gesture):
                self.static_cooldown.mark_fired(gesture)
                return {"gesture": gesture, "confidence": round(confidence, 2)}
            return None

        # Only look for motion gestures when the current frame isn't a
        # recognized static pose already being reported (thumb/fist/peace
        # take priority since they're unambiguous single-frame reads).
        states = get_finger_states(landmarks)
        if states.all_extended():
            push_result = self.motion.detect_push()
            if push_result is not None:
                gesture, confidence = push_result
                if self.motion_cooldown.is_ready(gesture):
                    self.motion_cooldown.mark_fired(gesture)
                    return {"gesture": gesture, "confidence": round(confidence, 2)}

        swipe_result = self.motion.detect_swipe()
        if swipe_result is not None:
            gesture, confidence = swipe_result
            if self.motion_cooldown.is_ready(gesture):
                self.motion_cooldown.mark_fired(gesture)
                return {"gesture": gesture, "confidence": round(confidence, 2)}

        return None
