// # `/api/images/*` — on-demand cached image transforms

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Sharp from "sharp";
import { makeTestServer } from "../../../../helpers/test-route-server.js";

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
  t.check(
    {
      status: image.statusCode,
      contentType: image.headers["content-type"],
      cacheControl: image.headers["cache-control"],
      nosniff: image.headers["x-content-type-options"],
      width: metadata.width,
      height: metadata.height,
    },
    { status: 200, contentType: "image/webp", cacheControl: "no-cache", nosniff: "nosniff", width: 40, height: 27 },
  );

  // The long and short option names share one normalized cache entry:

  // doctest:L34
  await imageRequest("/api/images/_content/photo.jpg?w=40&f=webp");
  const cacheNames = await readdir(join(server.boxRoot, ".beebox/image-cache/v1"));
  t.check(cacheNames, [any(String).matches(/^[\da-f]{64}\.webp$/)]);

  // `format=auto` varies on Accept and chooses the best supported format:

  // doctest:L43
  const automatic = await imageRequest("/api/images/_content/photo.jpg?width=30", { accept: "image/webp,image/*" });
  t.check(
    { status: automatic.statusCode, contentType: automatic.headers["content-type"], vary: automatic.headers.vary },
    { status: 200, contentType: "image/webp", vary: "Accept" },
  );

  // Conditional GET uses the derived representation identity:

  // doctest:L51
  const unchanged = await imageRequest("/api/images/_content/photo.jpg?width=30", {
    accept: "image/webp,image/*",
    "if-none-match": String(automatic.headers.etag),
  });
  t.check({ status: unchanged.statusCode, body: unchanged.body }, { status: 304, body: "" });

  // `HEAD` returns the representation headers without a response body:

  // doctest:L62
  const head = await server.server.inject({ method: "HEAD", url: "/test/api/images/_content/photo.jpg?width=30&format=webp" });
  t.check(
    { status: head.statusCode, contentType: head.headers["content-type"], body: head.body },
    { status: 200, contentType: "image/webp", body: "" },
  );

  // Image cards resolve through their `filename.ref`, while the source card itself is never decoded:

  // doctest:L70
  await mkdir(join(server.boxRoot, "_content/Portrait.attach"), { recursive: true });
  await writeFile(join(server.boxRoot, "_content/Portrait.attach/photo.jpg"), jpeg);
  await server.seed("_content/Portrait.image.card", "---\nfilename:\n  ref: attach/photo.jpg\n---\n");
  const cardImage = await imageRequest("/api/images/_content/Portrait.image.card?width=24&format=jpeg");
  const cardMetadata = await Sharp(cardImage.rawPayload).metadata();
  t.check(
    { status: cardImage.statusCode, width: cardMetadata.width, height: cardMetadata.height },
    { status: 200, width: 24, height: 16 },
  );

  // A card name containing a dot keeps it: `Mr. Smith.image.card` owns
  // `Mr. Smith.attach/`. The loader accepts only the `attach/` form of
  // `filename.ref`; a box-absolute ref to the same file does not load (the
  // `filename-attach-scope` migration rewrites that legacy form):

  // doctest:L85
  await mkdir(join(server.boxRoot, "_content/Mr. Smith.attach"), { recursive: true });
  await writeFile(join(server.boxRoot, "_content/Mr. Smith.attach/photo.jpg"), jpeg);
  await server.seed("_content/Mr. Smith.image.card", "---\nfilename:\n  ref: attach/photo.jpg\n---\n");
  const dotted = await imageRequest("/api/images/_content/Mr.%20Smith.image.card?width=24&format=jpeg");
  const dottedMetadata = await Sharp(dotted.rawPayload).metadata();
  t.check(
    { status: dotted.statusCode, width: dottedMetadata.width, height: dottedMetadata.height },
    { status: 200, width: 24, height: 16 },
  );

  // doctest:L91
  await server.seed("_content/Flat.image.card", "---\nfilename:\n  ref: /_content/photo.jpg\n---\n");
  const flat = await imageRequest("/api/images/_content/Flat.image.card?width=24&format=jpeg");
  t.check({ status: flat.statusCode, body: flat.json() }, { status: 404, body: { error: "Image not found in card" } });

  // Crop decisions use dimensions after EXIF orientation, so an already-smaller portrait is not enlarged and cropped:

  // doctest:L99
  const oriented = await Sharp({
    create: { width: 120, height: 80, channels: 3, background: { r: 20, g: 80, b: 160 } },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await writeFile(join(server.boxRoot, "_content/oriented.jpg"), oriented);
  const cropped = await imageRequest("/api/images/_content/oriented.jpg?width=100&height=130&fit=crop&format=jpeg");
  const croppedMetadata = await Sharp(cropped.rawPayload).metadata();
  t.check({ width: croppedMetadata.width, height: croppedMetadata.height }, { width: 80, height: 120 });

  // Crop never enlarges a source that is smaller than the target in one dimension:

  // doctest:L112
  const noUpscale = await imageRequest("/api/images/_content/photo.jpg?width=100&height=130&fit=crop&format=jpeg");
  const noUpscaleMetadata = await Sharp(noUpscale.rawPayload).metadata();
  t.check({ width: noUpscaleMetadata.width, height: noUpscaleMetadata.height }, { width: 100, height: 80 });

  // Bad options and non-image paths fail clearly instead of returning original bytes:

  // doctest:L121
  const bad = await server.request({ method: "GET", url: "/api/images/_content/photo.jpg?width=9999" });
  const notImage = await server.request({ method: "GET", url: "/api/images/_content/notes.txt?width=40" });
  t.check(bad, {
    statusCode: 400,
    body: { error: 'Invalid image option "width": must be from 1 to 4096', option: "width" },
  });
  t.check(notImage, { statusCode: 400, body: { error: "Not an image path" } });

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
  t.check(
    [traversal, hidden, hiddenDirectory, absent].map((res) => ({ status: res.statusCode, body: res.json() })),
    [
      { status: 403, body: { error: "Access denied" } },
      { status: 403, body: { error: "Access denied" } },
      { status: 403, body: { error: "Access denied" } },
      {
        status: 409,
        body: {
          error: "Content not present locally",
          key: "SHA256E-s300000--2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92.jpg",
          size: 300000,
          sha256: "2ee2c7d493840de6795751cfb0c75d899624f1e5494f129b840812f129638f92",
        },
      },
    ],
  );

  // An allowed extension containing undecodable bytes is an explicit media error, never an original-byte fallback:

  // doctest:L145
  await writeFile(join(server.boxRoot, "_content/broken.jpg"), "not an image");
  const originalWarn = console.warn;
  console.warn = () => {};
  const broken = await imageRequest("/api/images/_content/broken.jpg?width=40&format=jpeg").finally(() => { console.warn = originalWarn; });
  t.check({ status: broken.statusCode, body: broken.json() }, { status: 415, body: { error: "Image could not be transformed" } });
});
