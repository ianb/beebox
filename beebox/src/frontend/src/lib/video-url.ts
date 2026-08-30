/**
 * Detect video-hosting URLs that should render as an embedded player rather
 * than an `<img>`. Used by the markdown image renderer: an image whose `src`
 * points at a recognized video URL becomes a `VideoEmbed` instead.
 *
 * Only YouTube is recognized today. The shape (a list of provider matchers,
 * each returning a normalized embed URL) leaves room to add Vimeo etc. later
 * without touching the call site.
 */

export interface VideoEmbedInfo {
  provider: "youtube";
  /** Privacy-friendly embed URL ready to drop into an iframe `src`. */
  embedUrl: string;
}

/**
 * Pull a YouTube video id out of the common URL forms:
 *   youtube.com/watch?v=ID          (id in the `v` query param)
 *   youtu.be/ID                     (id is the first path segment)
 *   youtube.com/embed/ID            (id follows /embed/)
 *   youtube.com/shorts/ID           (id follows /shorts/)
 *   youtube.com/live/ID             (id follows /live/)
 * `music.` and `m.` host prefixes and the nocookie domain are all accepted.
 * Returns null if the host looks like YouTube but no plausible id is present,
 * so the caller can fall back to normal image/link rendering.
 */
function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isYoutube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com";
  const isShort = host === "youtu.be";
  if (!isYoutube && !isShort) return null;

  let id: string | null = null;
  if (isShort) {
    id = url.pathname.split("/").find(Boolean) ?? null;
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live") {
      id = segments[1] ?? null;
    }
  }
  // YouTube ids are 11 chars of [A-Za-z0-9_-]. Validate to avoid building a
  // broken embed from a malformed URL.
  if (id !== null && /^[\w-]{11}$/.test(id)) return id;
  return null;
}

/**
 * Classify a URL string as an embeddable video, or null if it isn't one we
 * recognize. Non-absolute or unparseable URLs are never videos.
 */
export function detectVideoEmbed(src: string): VideoEmbedInfo | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch (_e) {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const id = youtubeId(url);
  if (id !== null) {
    return { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  return null;
}
