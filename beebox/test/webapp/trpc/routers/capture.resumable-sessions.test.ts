// # Resumable capture selection
//
// The REST route delegates to `selectResumableCaptures`. The selector returns
// only open, non-empty sessions owned by the requesting user and matched by the
// visible chat or exact client-held staging id.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { createStagingSession, addPhoto, setStagingState, listStagingSessions } from "../../../../src/core/capture/staging-store/core.js";
import { selectResumableCaptures } from "../../../../src/core/capture/pending.js";

async function addPhotoTo(boxRoot: string, id: string) {
  await addPhoto({ boxRoot, id, filename: `photo-${id}.jpg`, capturedAt: "2026-07-09T14:00:00.000Z", source: "camera-user", buffer: Buffer.from("IMG") });
}

// ## Lifecycle, chat matching, and owner isolation
void test("Lifecycle, chat matching, and owner isolation", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L24
  const box = await makeTmpBox();
  const owned = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: "owner@example.com" });
  await addPhotoTo(box.root, owned.id);
  const standalone = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: "owner@example.com" });
  await addPhotoTo(box.root, standalone.id);
  const empty = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: "owner@example.com" });
  const sealed = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: "owner@example.com" });
  await addPhotoTo(box.root, sealed.id);
  await setStagingState({ boxRoot: box.root, id: sealed.id, state: "sealed" });
  const sessions = await listStagingSessions({ boxRoot: box.root });
  const byChat = selectResumableCaptures({
    sessions,
    targetSessionId: "chat-1",
    clientSessionId: null,
    requestingUser: "owner@example.com",
  });
  t.check({ idsMatch: byChat.length === 1 && byChat[0]?.id === owned.id, counts: byChat[0]?.counts }, {
    idsMatch: true,
    counts: {
      photos: 1,
      files: 0,
      audioSegments: 0,
    },
  });

  // An exact client-held id finds a standalone capture:

  // doctest:L47
  const byId = selectResumableCaptures({
    sessions,
    targetSessionId: null,
    clientSessionId: standalone.id,
    requestingUser: "owner@example.com",
  });
  await t.checkText(byId[0]?.id === standalone.id, "true");

  // The same chat and ids reveal nothing to another user; empty and sealed sessions
  // are absent for the owner too:

  // doctest:L61
  const otherUser = selectResumableCaptures({
    sessions,
    targetSessionId: "chat-1",
    clientSessionId: standalone.id,
    requestingUser: "other@example.com",
  });
  const ownerAll = selectResumableCaptures({
    sessions,
    targetSessionId: "chat-1",
    clientSessionId: sealed.id,
    requestingUser: "owner@example.com",
  });
  t.check({ other: otherUser.length, hasEmpty: ownerAll.some((item) => item.id === empty.id), hasSealed: ownerAll.some((item) => item.id === sealed.id) }, {
    other: 0,
    hasEmpty: false,
    hasSealed: false,
  });
});

// ## The route: who the browse key is depends on the box
//
// `GET /api/capture/sessions/resumable` resolves its owner through
// `resolveBoxIdentity`, so an agent-driven browser carrying the machine-wide
// browse key reaches Capture on a box that declared `agentBrowsing: "owner"` —
// and gets the same 401 as before on a box that did not. Capture was the surface
// where this was most visible: every capture open under the key put a red error
// badge on the page (`issues/bugs/2026-08-26-chat-load-logs-resumable-capture-list-error.md`).
void test("GET /api/capture/sessions/resumable resolves its owner through resolveBoxIden...", async (t) => {
  t.teardown(async () => {
    try {
      await optedIn.cleanup();
      await plain.cleanup();
      await rm(authDir, { recursive: true, force: true });
      delete process.env.BBX_BROWSE_API_KEY;
      delete process.env.BBX_AUTH_FILE;
      if (ORIGINAL_OWNER === undefined) delete process.env.BBX_OWNER_EMAIL;
      else process.env.BBX_OWNER_EMAIL = ORIGINAL_OWNER;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L91
  const KEY = "browse-key-for-capture-doctest";
  const ORIGINAL_OWNER = process.env.BBX_OWNER_EMAIL;
  process.env.BBX_BROWSE_API_KEY = KEY;
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  delete process.env.BBX_HUB_SECRET;
  // Keep the display-name lookup away from the machine's real ~/.bbx-auth.json.
  const authDir = await mkdtemp(join(tmpdir(), "bbx-capture-browse-"));
  process.env.BBX_AUTH_FILE = join(authDir, "no-such-auth.json");

  // doctest:L100
  const keyHeaders = { authorization: `Bearer ${KEY}` };
  const optedIn = await makeTestServer({ openAccess: false });
  await optedIn.seed("_config/box.json", JSON.stringify({ agentBrowsing: "owner" }));

  // doctest:L104
  await t.checkText(await optedIn.inject({ method: "GET", url: "/api/capture/sessions/resumable", headers: keyHeaders }), `200
{
  "resumable": []
}`);

  // A box that never opted in still refuses — the key clears the wall there but is
  // nobody, so there is no capture owner to answer for.

  // doctest:L115
  const plain = await makeTestServer({ openAccess: false });

  // doctest:L117
  await t.checkText(await plain.inject({ method: "GET", url: "/api/capture/sessions/resumable", headers: keyHeaders }), `401
{
  "error": "Not authenticated"
}`);
});
