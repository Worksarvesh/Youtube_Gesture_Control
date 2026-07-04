"""
main.py

FastAPI backend for the YouTube Gesture Control app.

Exposes a single WebSocket endpoint (/ws/gesture) that:
  1. Receives base64-encoded JPEG frames from the frontend.
  2. Runs MediaPipe Hands on each frame to extract 21 hand landmarks.
  3. Feeds the landmarks into gesture_classifier.GestureState, which
     handles static-pose + swipe/push classification and per-gesture
     cooldowns.
  4. Sends back a JSON gesture event whenever one fires.

Run locally with:
    uvicorn main:app --reload --port 8000
"""

import base64
import logging
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from gesture_classifier import GestureState, Landmarks

try:
    import mediapipe as mp

    MEDIAPIPE_AVAILABLE = True
except ImportError:  # pragma: no cover
    MEDIAPIPE_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gesture-backend")

app = FastAPI(title="YouTube Gesture Control - Gesture Backend")

# Vite's default dev server port. Add your deployed frontend origin here
# too once you host it somewhere other than localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if MEDIAPIPE_AVAILABLE:
    mp_hands = mp.solutions.hands
else:
    mp_hands = None


@app.get("/")
def health_check():
    return {"status": "ok", "mediapipe_available": MEDIAPIPE_AVAILABLE}


def _decode_frame(base64_data: str) -> Optional[np.ndarray]:
    """Decodes a base64 JPEG data URL (or raw base64 string) into a BGR
    numpy array suitable for MediaPipe/OpenCV. Returns None on failure so
    the caller can skip a malformed frame without crashing the socket."""
    try:
        if "," in base64_data:
            base64_data = base64_data.split(",", 1)[1]
        raw = base64.b64decode(base64_data)
        arr = np.frombuffer(raw, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return frame
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to decode incoming frame: %s", exc)
        return None


def _extract_landmarks(hands_result) -> Optional[Landmarks]:
    """Converts MediaPipe's landmark output into the plain (x, y, z) tuple
    list that gesture_classifier expects. Only the first detected hand is
    used (max_num_hands=1)."""
    if not hands_result.multi_hand_landmarks:
        return None
    hand = hands_result.multi_hand_landmarks[0]
    return [(lm.x, lm.y, lm.z) for lm in hand.landmark]


@app.websocket("/ws/echo")
async def echo_websocket(websocket: WebSocket):
    """Sanity-check endpoint with no MediaPipe involved -- confirms the
    WebSocket connection itself works before debugging the gesture
    pipeline. Sends back whatever JSON it receives."""
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_json()
            await websocket.send_json({"echo": message})
    except WebSocketDisconnect:
        logger.info("Echo client disconnected")


@app.websocket("/ws/gesture")
async def gesture_websocket(websocket: WebSocket):
    await websocket.accept()
    logger.info("Client connected")

    if not MEDIAPIPE_AVAILABLE:
        await websocket.send_json(
            {"error": "MediaPipe is not installed on the backend. "
                      "Run: pip install -r requirements.txt"}
        )
        await websocket.close()
        return

    state = GestureState()

    # One Hands instance per connection avoids cross-talk between users
    # and keeps landmark smoothing consistent within a session.
    with mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.7,
    ) as hands:
        try:
            while True:
                message = await websocket.receive_json()

                if message.get("type") != "frame":
                    continue

                frame = _decode_frame(message.get("data", ""))
                if frame is None:
                    continue

                # MediaPipe expects RGB, OpenCV decodes to BGR.
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                rgb_frame.flags.writeable = False
                result = hands.process(rgb_frame)

                landmarks = _extract_landmarks(result)
                gesture_event = state.process_frame(landmarks)

                if gesture_event is not None:
                    await websocket.send_json(gesture_event)

        except WebSocketDisconnect:
            logger.info("Client disconnected")
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error in gesture socket: %s", exc)
            try:
                await websocket.send_json({"error": str(exc)})
            except Exception:  # noqa: BLE001
                pass
