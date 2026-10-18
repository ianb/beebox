// # `/api/images/*` — on-demand cached image transforms

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Sharp from "sharp";
import { makeTestServer } from "../../../../helpers/doctest-server.js";
import { bodyField } from "../../../../helpers/doctest-helpers.js";

const server = await makeTestServer();
const jpeg = await Sharp({
  create: { width: 120, height: 80, channels: 3, background: { r: 180, g: 40, b: 20 } },
}).jpeg().toBuffer();
await mkdir(join(server.boxRoot, "_content"), { recursive: true });
await writeFile(join(server.boxRoot, "_content/photo.jpg"), jpeg);

function imageRequest(url: string, headers?: Record<string, string>) {
  return server.server.inject({ method: "GET", url: `/test${url}`, headers: headers ?? {} });
}

// The route produces a bounded WebP representation with hardened cache headers:
void test("The route produces a bounded WebP representation with hardened cache headers:", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L25
  const image = await imageRequest("/api/images/_content/photo.jpg?width=40&format=webp");
  const metadata = await Sharp(image.rawPayload).metadata();
  t.check(`${image.statusCode} ${image.headers["content-type"]} ${image.headers["cache-control"]} ${image.headers["x-content-type-options"]} ${metadata.width}x${metadata.height}`, "200 image/webp no-cache nosniff 40x27");

  // The long and short option names share one normalized cache entry:

  // doctest:L34
  await imageRequest("/api/images/_content/photo.jpg?w=40&f=webp");
  const cacheNames = await readdir(join(server.boxRoot, ".beebox/image-cache/v1"));
  await t.checkText(cacheNames.filter((name) => !name.includes(".tmp-")).length, "1");

  // `format=auto` varies on Accept and chooses the best supported format:

  // doctest:L43
  const automatic = await imageRequest("/api/images/_content/photo.jpg?width=30", { accept: "image/webp,image/*" });
  t.check(`${automatic.statusCode} ${automatic.headers["content-type"]} ${automatic.headers.vary}`, "200 image/webp Accept");

  // Conditional GET uses the derived representation identity:

  // doctest:L51
  const unchanged = await imageRequest("/api/images/_content/photo.jpg?width=30", {
    accept: "image/webp,image/*",
    "if-none-match": String(automatic.headers.etag),
  });
  t.check(unchanged.statusCode, 304);

  // `HEAD` returns the representation headers without a response body:

  // doctest:L62
  const head = await server.server.inject({ method: "HEAD", url: "/test/api/images/_content/photo.jpg?width=30&format=webp" });
  t.check(`${head.statusCode} ${head.headers["content-type"]} ${head.rawPayload.length}`, "200 image/webp 0");

  // Image cards resolve through their `filename.ref`, while the source card itself is never decoded:

  // doctest:L70
  await mkdir(join(server.boxRoot, "_content/Portrait.attach"), { recursive: true });
  await writeFile(join(server.boxRoot, "_content/Portrait.attach/photo.jpg"), jpeg);
  await server.seed("_content/Portrait.image.card", "---\nfilename:\n  ref: attach/photo.jpg\n---\n");
  const cardImage = await imageRequest("/api/images/_content/Portrait.image.card?width=24&format=jpeg");
  const cardMetadata = await Sharp(cardImage.rawPayload).metadata();
  t.check(`${cardImage.statusCode} ${cardMetadata.width}x${cardMetadata.height}`, "200 24x16");

  // A card name containing a dot keeps it: `Mr. Smith.image.card` owns
  // `Mr. Smith.attach/`. The loader accepts only the `attach/` form of
  // `filename.ref`; a box-absolute ref to the same file does not load (the
  // `filename-attach-scope` migration rewrites that legacy form):

  // doctest:L85
  await mkdir(join(server.boxRoot, "_content/Mr. Smith.attach"), { recursive: true });
  await writeFile(join(server.boxRoot, "_content/Mr. Smith.attach/photo.jpg"), jpeg);
  await server.seed("_content/Mr. Smith.image.card", "---\nfilename:\n  ref: attach/photo.jpg\n---\n");
  t.check((await imageRequest("/api/images/_content/Mr.%20Smith.image.card?width=24&format=jpeg")).statusCode, 200);

  // doctest:L91
  await server.seed("_content/Flat.image.card", "---\nfilename:\n  ref: /_content/photo.jpg\n---\n");
  t.check((await imageRequest("/api/images/_content/Flat.image.card?width=24&format=jpeg")).statusCode, 404);

  // Crop decisions use dimensions after EXIF orientation, so an already-smaller portrait is not enlarged and cropped:

  // doctest:L99
  const oriented = await Sharp({
    create: { width: 120, height: 80, channels: 3, background: { r: 20, g: 80, b: 160 } },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await writeFile(join(server.boxRoot, "_content/oriented.jpg"), oriented);
  const cropped = await imageRequest("/api/images/_content/oriented.jpg?width=100&height=130&fit=crop&format=jpeg");
  const croppedMetadata = await Sharp(cropped.rawPayload).metadata();
  t.check(`${croppedMetadata.width}x${croppedMetadata.height}`, "80x120");

  // Crop never enlarges a source that is smaller than the target in one dimension:

  // doctest:L112
  const noUpscale = await imageRequest("/api/images/_content/photo.jpg?width=100&height=130&fit=crop&format=jpeg");
  const noUpscaleMetadata = await Sharp(noUpscale.rawPayload).metadata();
  t.check(`${noUpscaleMetadata.width}x${noUpscaleMetadata.height}`, "100x80");

  // Bad options and non-image paths fail clearly instead of returning original bytes:

  // doctest:L121
  const bad = await server.request({ method: "GET", url: "/api/images/_content/photo.jpg?width=9999" });
  const notImage = await server.request({ method: "GET", url: "/api/images/_content/notes.txt?width=40" });
  t.check(`${bad.statusCode} ${bodyField(bad.body, "option")} | ${notImage.statusCode} ${bodyField(notImage.body, "error")}`, "400 width | 400 Not an image path");

  // Containment, dotfiles, and absent annex content retain the original image route's fail-closed behavior:

  // doctest:L130
  await writeFile(join(server.boxRoot, ".hidden.jpg"), jpeg);
  await mkdir(join(server.boxRoot, ".beebox"), { recursive: true });
  await writeFile(join(server.boxRoot, ".beebox/cached.jpg"), jpeg);
  await server.seed("_content/absent.jpg", "/annex/objects/SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg\n");
  const traversal = await imageRequest("/api/images/%2e%2e%2foutside.jpg?width=40");
  const hidden = await imageRequest("/api/images/.hidden.jpg?width=40");
  const hiddenDirectory = await imageRequest("/api/images/.beebox/cached.jpg?width=40");
  const absent = await imageRequest("/api/images/_content/absent.jpg?width=40");
  t.check(`${traversal.statusCode} ${hidden.statusCode} ${hiddenDirectory.statusCode} ${absent.statusCode}`, "403 403 403 409");

  // An allowed extension containing undecodable bytes is an explicit media error, never an original-byte fallback:

  // doctest:L145
  await writeFile(join(server.boxRoot, "_content/broken.jpg"), "not an image");
  const originalWarn = console.warn;
  console.warn = () => {};
  const broken = await imageRequest("/api/images/_content/broken.jpg?width=40&format=jpeg").finally(() => { console.warn = originalWarn; });
  t.check(`${broken.statusCode} ${broken.json().error}`, "415 Image could not be transformed");
});
