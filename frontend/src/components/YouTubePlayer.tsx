import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { YouTubePlayer as YTPlayerType } from "../lib/youtubeTypes";

interface YouTubePlayerProps {
  videoId: string | null;
  onReady?: (player: YTPlayerType) => void;
}

const IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
const PLAYER_ELEMENT_ID = "yt-gesture-player";

let iframeApiLoadPromise: Promise<void> | null = null;

/** Loads the YouTube IFrame API script exactly once, regardless of how many
 * times this component mounts/unmounts (e.g. during fast refresh). */
function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }
  if (iframeApiLoadPromise) {
    return iframeApiLoadPromise;
  }
  iframeApiLoadPromise = new Promise((resolve) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = IFRAME_API_SRC;
    document.body.appendChild(script);
  });
  return iframeApiLoadPromise;
}

const YouTubePlayer = forwardRef<HTMLDivElement, YouTubePlayerProps>(
  ({ videoId, onReady }, containerRef) => {
    const playerRef = useRef<YTPlayerType | null>(null);
    const [apiReady, setApiReady] = useState(false);
    const [playerError, setPlayerError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      loadYouTubeIframeApi().then(() => {
        if (!cancelled) setApiReady(true);
      });
      return () => {
        cancelled = true;
      };
    }, []);

    useEffect(() => {
      if (!apiReady || !videoId) return;

      setPlayerError(null);

      // Destroy any existing player instance before mounting a new video,
      // since YT.Player doesn't support swapping videoId cleanly via props.
      if (playerRef.current) {
        try {
          (playerRef.current as unknown as { destroy: () => void }).destroy();
        } catch {
          /* no-op: player may already be torn down */
        }
        playerRef.current = null;
      }

      const player = new window.YT.Player(PLAYER_ELEMENT_ID, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 0, playsinline: 1 },
        events: {
          onReady: (event) => {
            playerRef.current = event.target;
            onReady?.(event.target);
          },
          onError: () => {
            setPlayerError(
              "This video failed to load. It may be private, region-locked, or embedding may be disabled by the uploader."
            );
          },
        },
      });

      playerRef.current = player;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiReady, videoId]);

    // Expose the wrapping div (not the iframe) via the forwarded ref so the
    // fullscreen gesture command has a stable container to target.
    const innerContainerRef = useRef<HTMLDivElement | null>(null);
    useImperativeHandle(containerRef, () => innerContainerRef.current as HTMLDivElement);

    return (
      <div className="player-container" ref={innerContainerRef}>
        {!videoId && <p>Paste a YouTube link above to load a video.</p>}
        {playerError && <p className="error-text">{playerError}</p>}
        <div id={PLAYER_ELEMENT_ID} />
      </div>
    );
  }
);

YouTubePlayer.displayName = "YouTubePlayer";

export default YouTubePlayer;
