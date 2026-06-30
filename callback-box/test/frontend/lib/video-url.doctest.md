# video-url detection

A markdown image whose `src` points at a recognized video URL renders an embedded player instead of an `<img>`. `detectVideoEmbed` classifies the URL and returns a normalized, privacy-friendly embed URL — or `null` to fall back to normal image rendering.

```ts setup
import { detectVideoEmbed } from "../../../src/frontend/src/lib/video-url.js";
```

## YouTube URL forms

The common forms all resolve to the same `youtube-nocookie.com/embed/ID` URL:

```ts
JSON.stringify(detectVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
=> {"provider":"youtube","embedUrl":"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"}

JSON.stringify(detectVideoEmbed("https://youtu.be/dQw4w9WgXcQ"))
=> {"provider":"youtube","embedUrl":"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"}

JSON.stringify(detectVideoEmbed("https://www.youtube.com/embed/dQw4w9WgXcQ"))
=> {"provider":"youtube","embedUrl":"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"}

JSON.stringify(detectVideoEmbed("https://www.youtube.com/shorts/dQw4w9WgXcQ"))
=> {"provider":"youtube","embedUrl":"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"}
```

Extra query params (timestamps, playlists) on a watch URL don't break extraction:

```ts
JSON.stringify(detectVideoEmbed("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"))
=> {"provider":"youtube","embedUrl":"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"}
```

## Fallback to image rendering

A YouTube-looking URL with no extractable (or malformed) id returns `null`, so the caller renders the normal image/link instead of a broken embed:

```ts
JSON.stringify(detectVideoEmbed("https://www.youtube.com/watch?v=tooshort"))
=> null

JSON.stringify(detectVideoEmbed("https://www.youtube.com/feed/subscriptions"))
=> null
```

Non-video and non-absolute URLs are never videos:

```ts
JSON.stringify(detectVideoEmbed("https://example.com/cat.png"))
=> null

JSON.stringify(detectVideoEmbed("attach/photo.jpg"))
=> null

JSON.stringify(detectVideoEmbed(""))
=> null
```
