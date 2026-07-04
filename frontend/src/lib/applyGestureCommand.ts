/**
 * applyGestureCommand.ts
 *
 * Translates a gesture name (as reported by the backend) into a YouTube
 * IFrame Player API call. Kept as its own module, separate from the
 * WebSocket/UI code, so the gesture -> action mapping can be edited or
 * remapped without touching anything else.
 *
 * Gesture mapping (see project spec):
 *   open_palm     -> play/pause toggle
 *   swipe_right   -> skip forward 10s
 *   swipe_left    -> skip backward 10s
 *   thumbs_up     -> volume +10
 *   thumbs_down   -> volume -10
 *   fist          -> mute/unmute toggle
 *   peace_sign    -> captions on/off toggle
 *   palm_push     -> fullscreen toggle
 */

import type { YouTubePlayer } from "./youtubeTypes";

export interface GestureCommandContext {
  player: YouTubePlayer;
  /** The DOM element that should go fullscreen (the player's wrapper div,
   * not the raw iframe, so custom overlays stay visible in Phase 2). */
  containerElement: HTMLElement | null;
  /** Mutable ref tracking caption state, since the IFrame API doesn't
   * expose a reliable "are captions on" getter. */
  captionsOnRef: { current: boolean };
}

export interface GestureCommandResult {
  gesture: string;
  actionLabel: string;
  ok: boolean;
  note?: string;
}

const YT_PLAYER_STATE_PLAYING = 1;

function togglePlayPause(player: YouTubePlayer): string {
  if (player.getPlayerState() === YT_PLAYER_STATE_PLAYING) {
    player.pauseVideo();
    return "Paused";
  }
  player.playVideo();
  return "Playing";
}

function skip(player: YouTubePlayer, deltaSeconds: number): string {
  const target = Math.max(0, player.getCurrentTime() + deltaSeconds);
  player.seekTo(target, true);
  return deltaSeconds > 0 ? "Skipped forward 10s" : "Skipped backward 10s";
}

function adjustVolume(player: YouTubePlayer, delta: number): string {
  const current = player.getVolume();
  const next = Math.min(100, Math.max(0, current + delta));
  player.setVolume(next);
  if (player.isMuted() && next > 0) {
    player.unMute();
  }
  return `Volume ${next}%`;
}

function toggleMute(player: YouTubePlayer): string {
  if (player.isMuted()) {
    player.unMute();
    return "Unmuted";
  }
  player.mute();
  return "Muted";
}

function toggleCaptions(
  player: YouTubePlayer,
  captionsOnRef: { current: boolean }
): { label: string; note?: string } {
  // The IFrame API's caption module control is best-effort -- not all
  // embeds/videos support loadModule/unloadModule reliably. We optimistically
  // flip local state and fall back silently if the calls aren't available.
  try {
    if (captionsOnRef.current) {
      player.unloadModule?.("captions");
      captionsOnRef.current = false;
      return { label: "Captions off" };
    }
    player.loadModule?.("captions");
    captionsOnRef.current = true;
    return { label: "Captions on" };
  } catch {
    return {
      label: "Captions toggle attempted",
      note: "Caption control isn't reliably supported by this video/embed.",
    };
  }
}

function toggleFullscreen(containerElement: HTMLElement | null): {
  label: string;
  note?: string;
} {
  if (!containerElement) {
    return { label: "Fullscreen unavailable", note: "No container element bound." };
  }
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return { label: "Exited fullscreen" };
  }
  containerElement.requestFullscreen?.().catch(() => {
    /* Some browsers require a direct user gesture for fullscreen; a
       gesture-triggered call may be rejected. This is a known Phase 1
       limitation to revisit if it proves too restrictive in testing. */
  });
  return { label: "Entered fullscreen" };
}

export function applyGestureCommand(
  gesture: string,
  ctx: GestureCommandContext
): GestureCommandResult {
  const { player, containerElement, captionsOnRef } = ctx;

  switch (gesture) {
    case "open_palm":
      return { gesture, actionLabel: togglePlayPause(player), ok: true };

    case "swipe_right":
      return { gesture, actionLabel: skip(player, 10), ok: true };

    case "swipe_left":
      return { gesture, actionLabel: skip(player, -10), ok: true };

    case "thumbs_up":
      return { gesture, actionLabel: adjustVolume(player, 10), ok: true };

    case "thumbs_down":
      return { gesture, actionLabel: adjustVolume(player, -10), ok: true };

    case "fist":
      return { gesture, actionLabel: toggleMute(player), ok: true };

    case "peace_sign": {
      const { label, note } = toggleCaptions(player, captionsOnRef);
      return { gesture, actionLabel: label, ok: true, note };
    }

    case "palm_push": {
      const { label, note } = toggleFullscreen(containerElement);
      return { gesture, actionLabel: label, ok: true, note };
    }

    default:
      return { gesture, actionLabel: "Unrecognized gesture", ok: false };
  }
}
