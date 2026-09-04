# `/api/images/*` — on-demand cached image transforms

```ts setup
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Sharp from "sharp";
import { makeTestServer } from "../helpers/doctest-server.js";

const server = await makeTestServer();
const jpeg = await Sharp({
  create: { width: 120, height: 80, channels: 3, background: { r: 180, g: 40, b: 20 } },
}).jpeg().toBuffer();
await writeFile(join(server.boxRoot, "photo.jpg"), jpeg);

function imageRequest(url: string, headers?: Record<string, string>) {
  return server.server.inject({ method: "GET", url: `/test${url}`, headers });
}
```

The route produces a bounded WebP representation with hardened cache headers:

```ts
const image = await imageRequest("/api/images/photo.jpg?width=40&format=webp");
const metadata = await Sharp(image.rawPayload).metadata();
`${image.statusCode} ${image.headers["content-type"]} ${image.headers["cache-control"]} ${image.headers["x-content-type-options"]} ${metadata.width}x${metadata.height}`
=> 200 image/webp no-cache nosniff 40x27
```

The long and short option names share one normalized cache entry:

```ts continue
await imageRequest("/api/images/photo.jpg?w=40&f=webp");
const cacheNames = await readdir(join(server.boxRoot, ".beebox/image-cache/v1"));
cacheNames.filter((name) => !name.includes(".tmp-")).length
=> 1
```

`format=auto` varies on Accept and chooses the best supported format:

```ts continue
const automatic = await imageRequest("/api/images/photo.jpg?width=30", { accept: "image/webp,image/*" });
`${automatic.statusCode} ${automatic.headers["content-type"]} ${automatic.headers.vary}`
=> 200 image/webp Accept
```

Conditional GET uses the derived representation identity:

```ts continue
const unchanged = await imageRequest("/api/images/photo.jpg?width=30", {
  accept: "image/webp,image/*",
  "if-none-match": String(automatic.headers.etag),
});
unchanged.statusCode
=> 304
```

`HEAD` returns the representation headers without a response body:

```ts continue
const head = await server.server.inject({ method: "HEAD", url: "/test/api/images/photo.jpg?width=30&format=webp" });
`${head.statusCode} ${head.headers["content-type"]} ${head.rawPayload.length}`
=> 200 image/webp 0
```

Image cards resolve through their `filename.ref`, while the source card itself is never decoded:

```ts continue
await mkdir(join(server.boxRoot, "Portrait.attach"), { recursive: true });
await writeFile(join(server.boxRoot, "Portrait.attach/photo.jpg"), jpeg);
await server.seed("Portrait.image.card", "---\nfilename:\n  ref: attach/photo.jpg\n---\n");
const cardImage = await imageRequest("/api/images/Portrait.image.card?width=24&format=jpeg");
const cardMetadata = await Sharp(cardImage.rawPayload).metadata();
`${cardImage.statusCode} ${cardMetadata.width}x${cardMetadata.height}`
=> 200 24x16
```

Crop decisions use dimensions after EXIF orientation, so an already-smaller portrait is not enlarged and cropped:

```ts continue
const oriented = await Sharp({
  create: { width: 120, height: 80, channels: 3, background: { r: 20, g: 80, b: 160 } },
}).jpeg().withMetadata({ orientation: 6 }).toBuffer();
await writeFile(join(server.boxRoot, "oriented.jpg"), oriented);
const cropped = await imageRequest("/api/images/oriented.jpg?width=100&height=130&fit=crop&format=jpeg");
const croppedMetadata = await Sharp(cropped.rawPayload).metadata();
`${croppedMetadata.width}x${croppedMetadata.height}`
=> 80x120
```

Bad options and non-image paths fail clearly instead of returning original bytes:

```ts continue
const bad = await server.request({ method: "GET", url: "/api/images/photo.jpg?width=9999" });
const notImage = await server.request({ method: "GET", url: "/api/images/notes.txt?width=40" });
`${bad.statusCode} ${bad.body.option} | ${notImage.statusCode} ${notImage.body.error}`
=> 400 width | 400 Not an image path
```

Containment, dotfiles, and absent annex content retain the original image route's fail-closed behavior:

```ts continue
await writeFile(join(server.boxRoot, ".hidden.jpg"), jpeg);
await server.seed("absent.jpg", "/annex/objects/SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg\n");
const traversal = await imageRequest("/api/images/%2e%2e%2foutside.jpg?width=40");
const hidden = await imageRequest("/api/images/.hidden.jpg?width=40");
const absent = await imageRequest("/api/images/absent.jpg?width=40");
`${traversal.statusCode} ${hidden.statusCode} ${absent.statusCode}`
=> 403 403 409
```

An allowed extension containing undecodable bytes is an explicit media error, never an original-byte fallback:

```ts continue
await writeFile(join(server.boxRoot, "broken.jpg"), "not an image");
const originalWarn = console.warn;
console.warn = () => undefined;
const broken = await imageRequest("/api/images/broken.jpg?width=40&format=jpeg").finally(() => { console.warn = originalWarn; });
`${broken.statusCode} ${broken.json().error}`
=> 415 Image could not be transformed
```

```ts cleanup
await server.cleanup();
```
