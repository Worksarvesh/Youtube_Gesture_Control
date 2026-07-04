# YouTube Gesture Control — Phase 1

Control an embedded YouTube video using hand gestures captured from your
webcam, via a FastAPI + MediaPipe backend and a React + Vite + TypeScript
frontend.

**Phase 1 scope:** core functionality only (gesture detection → backend →
frontend → YouTube control). Styling is intentionally bare-bones. Phase 2
(dark/glassmorphism UI, landmark overlay, animated feedback) starts only
once every gesture below is confirmed reliable end-to-end.

---

## Project structure

```
backend/
  main.py                # FastAPI app, /ws/gesture and /ws/echo WebSocket endpoints
  gesture_classifier.py  # Rule-based gesture classification (static poses + swipe/push + cooldowns)
  requirements.txt

frontend/
  src/
    App.tsx
    components/
      WebcamPanel.tsx     # camera feed, on/off toggle, frame capture loop
      YouTubePlayer.tsx    # mounts YouTube IFrame Player API
    lib/
      useGestureSocket.ts    # WebSocket client + connection status
      applyGestureCommand.ts # gesture -> YouTube Player API dispatcher
      youtubeUtils.ts        # video ID extraction from any YouTube URL shape
      youtubeTypes.ts         # minimal IFrame Player API type declarations
```

---

## Running locally

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Visit `http://localhost:8000/` — you should see
`{"status": "ok", "mediapipe_available": true}`.

If `mediapipe_available` is `false`, MediaPipe didn't install correctly for
your Python version (MediaPipe currently supports Python 3.9–3.12 — check
`python3 --version` if `pip install` failed silently).

**Sanity-check the socket independently of MediaPipe first:** connect to
`ws://localhost:8000/ws/echo` with any WebSocket client (e.g. a browser
console `new WebSocket(...)`, or a tool like `wscat`) and confirm it echoes
back whatever JSON you send. This isolates connection issues from
gesture-detection issues.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env    # adjust VITE_GESTURE_WS_URL if backend isn't on localhost:8000
npm run dev
```

Visit `http://localhost:5173`.

### 3. Using it

1. Click **Camera On** and allow webcam access.
2. Paste a YouTube link (or bare video ID) into the input and click **Load
   Video**.
3. Perform gestures in front of the webcam — the gesture feedback line
   below the player shows which gesture fired and what action it triggered.

---

## Gesture checklist (mark these off as you confirm each in real testing)

| Gesture | Action | Detection type | Confirmed working? |
|---|---|---|---|
| Open palm (5 fingers extended, held) | Play/Pause toggle | Static pose | ☐ |
| Closed fist | Mute/Unmute toggle | Static pose | ☐ |
| Thumbs up | Volume +10% | Static pose | ☐ |
| Thumbs down | Volume −10% | Static pose | ☐ |
| Peace sign (index + middle up) | Captions on/off | Static pose | ☐ |
| Swipe right | Skip forward 10s | Motion (rolling window) | ☐ |
| Swipe left | Skip backward 10s | Motion (rolling window) | ☐ |
| Palm pushed toward camera | Fullscreen toggle | Motion (rolling window) | ☐ |

Notes:
- **Captions**: the IFrame API's `loadModule`/`unloadModule('captions')`
  calls are best-effort — YouTube doesn't guarantee this works for every
  video/embed. If it's unreliable in testing, treat it as a known Phase 1
  limitation rather than a bug to chase.
- **Fullscreen**: some browsers only allow `requestFullscreen()` to succeed
  when called directly inside a user-initiated event (click/keypress). A
  gesture-triggered call goes through a WebSocket message handler, not a
  native browser input event, so certain browsers may silently reject it.
  If you hit this in testing, the workaround is a one-time "enable
  fullscreen gestures" button click to prime browser permission, which can
  be added in Phase 2.
- **Tuning**: if a gesture fires too eagerly or not eagerly enough, the
  thresholds to adjust are all in `gesture_classifier.py` — margins in
  `_is_finger_extended`/`_is_thumb_extended`, the `0.22` swipe distance
  threshold, the `0.35` relative-growth push threshold, and the
  `STATIC_COOLDOWN_SECONDS` / `MOTION_COOLDOWN_SECONDS` constants.

---

## Known Phase 1 edge cases handled

- No hand detected → gesture history clears so a stale swipe doesn't fire
  when a hand reappears.
- Webcam permission denied → error message shown in the webcam panel.
- Invalid/unparseable YouTube URL → inline validation error, no video load
  attempted.
- WebSocket disconnect → status line shows "reconnecting", auto-retries
  every 2s.
- Video fails to load (private/region-locked/embedding disabled) → error
  shown in the player area via the IFrame API's `onError` event.

Multiple hands in frame: `max_num_hands=1` is set on the MediaPipe `Hands`
instance, so only the first detected hand is used — worth testing
deliberately with two hands in frame to confirm the second hand is ignored
rather than causing flicker.

---

## Next: Phase 2

Once every row in the checklist above is confirmed working with under
~300ms latency, the next milestone is the UI/UX pass: dark glassmorphism
layout, animated gesture feedback overlay, live hand-landmark skeleton
drawn over the webcam feed, and polished connection/error states. Hold off
on any of that until Phase 1 is solid.
