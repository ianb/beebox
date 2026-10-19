// # video-url detection
//
// A markdown image whose `src` points at a recognized video URL renders an embedded player instead of an `<img>`. `detectVideoEmbed` classifies the URL and returns a normalized, privacy-friendly embed URL — or `null` to fall back to normal image rendering.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { detectVideoEmbed } from "../../src/lib/video-url.js";

// ## YouTube URL forms
//
// The common forms all resolve to the same `youtube-nocookie.com/embed/ID` URL:
void test("The common forms all resolve to the same youtube-nocookie.com/embed/ID URL:", async (t) => {
  t.check(
    detectVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    ,
    {
    provider: "youtube",
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  },
  );

  t.check(
    detectVideoEmbed("https://youtu.be/dQw4w9WgXcQ")
    ,
    {
    provider: "youtube",
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  },
  );

  t.check(
    detectVideoEmbed("https://www.youtube.com/embed/dQw4w9WgXcQ")
    ,
    {
    provider: "youtube",
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  },
  );

  t.check(
    detectVideoEmbed("https://www.youtube.com/shorts/dQw4w9WgXcQ")
    ,
    {
    provider: "youtube",
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  },
  );
});

// Extra query params (timestamps, playlists) on a watch URL don't break extraction:
void test("Extra query params (timestamps, playlists) on a watch URL don't break extract...", async (t) => {
  t.check(
    detectVideoEmbed("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")
    ,
    {
    provider: "youtube",
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  },
  );
});

// The `/live/` path and the `music.` subdomain are also recognized:
void test("The /live/ path and the music. subdomain are also recognized:", async (t) => {
  t.check(
    detectVideoEmbed("https://www.youtube.com/live/dQw4w9WgXcQ")
    ,
    {
    provider: "youtube",
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  },
  );

  t.check(
    detectVideoEmbed("https://music.youtube.com/watch?v=dQw4w9WgXcQ")
    ,
    {
    provider: "youtube",
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  },
  );
});

// ## Fallback to image rendering
//
// A YouTube-looking URL with no extractable (or malformed) id returns `null`, so the caller renders the normal image/link instead of a broken embed:
void test("A YouTube-looking URL with no extractable (or malformed) id returns null, so...", async (t) => {
  t.check(
    detectVideoEmbed("https://www.youtube.com/watch?v=tooshort")
    ,
    null,
  );

  t.check(
    detectVideoEmbed("https://www.youtube.com/feed/subscriptions")
    ,
    null,
  );
});

// Non-video and non-absolute URLs are never videos:
void test("Non-video and non-absolute URLs are never videos:", async (t) => {
  t.check(
    detectVideoEmbed("https://example.com/cat.png")
    ,
    null,
  );

  t.check(detectVideoEmbed("attach/photo.jpg"), null);
});
