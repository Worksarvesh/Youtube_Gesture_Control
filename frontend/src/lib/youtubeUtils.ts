/**
 * youtubeUtils.ts
 *
 * Extracts a YouTube video ID from the various URL shapes people paste in:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://www.youtube.com/watch?v=VIDEO_ID&t=42s
 *   - https://youtu.be/VIDEO_ID
 *   - https://youtu.be/VIDEO_ID?t=42
 *   - https://www.youtube.com/embed/VIDEO_ID
 *   - https://www.youtube.com/shorts/VIDEO_ID
 *   - a bare 11-character video ID pasted directly
 */

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export function extractVideoId(rawInput: string): string | null {
  const input = rawInput.trim();
  if (!input) return null;

  // Bare ID pasted directly.
  if (VIDEO_ID_PATTERN.test(input)) {
    return input;
  }

  let url: URL;
  try {
    // Allow inputs without a protocol (e.g. "youtu.be/abc123...").
    url = new URL(input.match(/^https?:\/\//) ? input : `https://${input}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && VIDEO_ID_PATTERN.test(id) ? id : null;
    }
    const embedMatch = url.pathname.match(/^\/(embed|shorts)\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) {
      return embedMatch[2];
    }
  }

  return null;
}

export function isValidYoutubeInput(rawInput: string): boolean {
  return extractVideoId(rawInput) !== null;
}
