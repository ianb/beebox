// # Serving one photo back out of a transcript
//
// `GET /api/session-media/<sessionId>/<entryUuid>/<index>` is the door back to a
// photograph the history read left behind. History hands the client coordinates
// (`shared/session-media.ts`); the client asks for the bytes per image, so a
// conversation full of old photos costs nothing until someone scrolls to one.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { makeTestServer } from "../../../../helpers/test-route-server.js";
import { TEST_SLUG } from "../../../../helpers/test-server.js";
import { getSessionLogPath } from "../../../../../src/core/chat/session/transcript-paths.js";
import { SESSION_STORES } from "../../../../../src/core/chat/session/native-store.js";
import { piSessionsDir } from "../../../../../src/core/pi-sessions.js";

const app = await makeTestServer();

// Point session discovery at a directory inside the test box rather than the
// developer's real ~/.claude/projects.
const previousProjects = process.env["BBX_CLAUDE_PROJECTS_DIR"];
process.env["BBX_CLAUDE_PROJECTS_DIR"] = path.join(app.boxRoot, "claude-projects");

const SESSION = "session-abc";
// Genuinely binary, PNG magic number and all: the route must hand back the
// bytes untouched, not a string that survived a utf-8 round trip.
const photoBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(Array.from({ length: 300_000 }, (_v, i) => i % 256)),
]);

// `request` parses the body as JSON, which an image is not — go through inject
// directly so the response arrives as bytes.
async function fetchMedia(refPath: string) {
  return app.server.inject({ method: "GET", url: `/${TEST_SLUG}/api/session-media/${refPath}` });
}

async function writeTranscript(lines: string[]) {
  const logPath = getSessionLogPath(app.boxRoot, SESSION);
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, `${lines.join("\n")}\n`, "utf-8");
}

await writeTranscript([
  JSON.stringify({
    type: "user",
    uuid: "entry-1",
    timestamp: "2026-08-24T10:00:00.000Z",
    message: {
      role: "user",
      content: [
        { type: "text", text: "<typed>here is the drawer</typed>" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: photoBytes.toString("base64") } },
      ],
    },
  }),
]);

// ## The photograph comes back
void test("The photograph comes back", async (t) => {
  t.teardown(async () => {
    try {
      if (previousProjects === undefined) delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
      else process.env["BBX_CLAUDE_PROJECTS_DIR"] = previousProjects;
      await app.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const res = await fetchMedia(`${SESSION}/entry-1/0`);
  t.check(
    { status: res.statusCode, contentType: res.headers["content-type"], bytesMatch: res.rawPayload.equals(photoBytes) },
    { status: 200, contentType: "image/png", bytesMatch: true },
  );

  // A transcript line is append-only and named by a uuid the writer never reuses, so
  // the bytes behind one reference cannot change — the response says so, which is
  // what makes scrolling back through the same conversation twice free. `private`
  // because the image is one box's conversation and must never sit in a shared
  // cache, and `nosniff` because a photograph must not be reinterpreted as anything
  // a browser would execute:

  t.check(
    { cache: res.headers["cache-control"], nosniff: res.headers["x-content-type-options"] },
    { cache: "private, max-age=31536000, immutable", nosniff: "nosniff" },
  );

  // ## References that name nothing, and references that try to leave
  //
  // An unknown session, an unknown entry, and an index past the turn's images are
  // all 404 — including the failed-upload case, where the block is real and the
  // bytes never were. Saying which is which would only describe someone's failed
  // upload back to them:

  const status = async (refPath: string) => (await fetchMedia(refPath)).statusCode;
  const misses = await Promise.all([
    status("no-such-session/entry-1/0"),
    status(`${SESSION}/no-such-entry/0`),
    status(`${SESSION}/entry-1/3`),
  ]);
  t.check(misses, [404, 404, 404]);

  // Both ids land in a filesystem path, so a reference carrying path characters is
  // rejected at the parse boundary rather than resolved and then checked:

  const rejected = await Promise.all([
    status("..%2f..%2f..%2fetc/entry-1/0"),
    status(`${SESSION}/entry-1/notanumber`),
    status(`${SESSION}/entry-1`),
  ]);
  t.check(rejected, [400, 400, 400]);

  // ## A pi chat's photo
  //
  // pi keeps its session file under the box and keys entries by `id`, with the
  // image's bytes and type on the block itself. History hands back a reference
  // for the stripped photo, and the reference serves it:

  const piSession = "22222222-3333-4444-8555-666666666666";
  const piFile = path.join(piSessionsDir(app.boxRoot), `2026-10-29T21-33-48-061Z_${piSession}.jsonl`);
  await mkdir(path.dirname(piFile), { recursive: true });
  await writeFile(piFile, `${[
    { type: "session", version: 3, id: piSession, timestamp: "2026-10-29T21:33:48.061Z", cwd: app.boxRoot },
    { type: "message", id: "a1b2c3d4", parentId: null, timestamp: "2026-10-29T21:33:49.000Z", message: {
      role: "user", timestamp: 1, content: [{ type: "text", text: "the drawer" }, { type: "image", mimeType: "image/png", data: photoBytes.toString("base64") }],
    } },
  ].map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf-8");
  const history = await SESSION_STORES.pi.readHistory(app.boxRoot, { sessionId: piSession, slice: { mode: "tail", tail: 5 } });
  const imageRef = `${piSession}/a1b2c3d4/0`;
  t.check(history?.entries.map((entry) => entry.content), [[
    { type: "text", text: "the drawer" }, { type: "image", imageRef, mediaType: "image/png" },
  ]]);
  const piPhoto = await fetchMedia(imageRef);
  t.check(
    { status: piPhoto.statusCode, contentType: piPhoto.headers["content-type"], bytesMatch: piPhoto.rawPayload.equals(photoBytes) },
    { status: 200, contentType: "image/png", bytesMatch: true },
  );
});
