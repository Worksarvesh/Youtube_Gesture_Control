import { useCallback, useEffect, useRef, useState } from "react";
import WebcamPanel from "./components/WebcamPanel";
import YouTubePlayer from "./components/YouTubePlayer";
import { extractVideoId } from "./lib/youtubeUtils";
import { useGestureSocket } from "./lib/useGestureSocket";
import { applyGestureCommand, type GestureCommandResult } from "./lib/applyGestureCommand";
import type { YouTubePlayer as YTPlayerType } from "./lib/youtubeTypes";

export default function App() {
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<GestureCommandResult | null>(null);

  const playerRef = useRef<YTPlayerType | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const captionsOnRef = useRef(false);

  const { status, lastGesture, lastError, sendFrame } = useGestureSocket();

  const handleLoadVideo = (event: React.FormEvent) => {
    event.preventDefault();
    const id = extractVideoId(urlInput);
    if (!id) {
      setUrlError("That doesn't look like a valid YouTube URL or video ID.");
      return;
    }
    setUrlError(null);
    setVideoId(id);
  };

  const handlePlayerReady = useCallback((player: YTPlayerType) => {
    playerRef.current = player;
  }, []);

  // Whenever a new gesture event arrives from the backend, translate it
  // into a player command via the dispatcher.
  useEffect(() => {
    if (!lastGesture || !playerRef.current) return;
    const result = applyGestureCommand(lastGesture.gesture, {
      player: playerRef.current,
      containerElement: containerRef.current,
      captionsOnRef,
    });
    setLastCommand(result);
  }, [lastGesture]);

  return (
    <div className="app-layout">
      <div className="left-panel">
        <WebcamPanel connectionStatus={status} onFrame={sendFrame} />
        {lastError && <p className="error-text">Backend error: {lastError}</p>}
      </div>

      <div className="right-panel">
        <form className="url-form" onSubmit={handleLoadVideo}>
          <input
            type="text"
            placeholder="Paste a YouTube video URL..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
          />
          <button type="submit">Load Video</button>
        </form>
        {urlError && <p className="error-text">{urlError}</p>}

        <YouTubePlayer ref={containerRef} videoId={videoId} onReady={handlePlayerReady} />

        <div className="gesture-feedback">
          {lastCommand
            ? `Gesture: ${lastCommand.gesture} -> ${lastCommand.actionLabel}${
                lastCommand.note ? ` (${lastCommand.note})` : ""
              }`
            : "Waiting for a gesture..."}
        </div>
      </div>
    </div>
  );
}
