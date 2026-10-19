// # Capture audio card containers
//
// `writeAudioCards` preserves each staging segment's declared container. WebM
// chunks concatenate into one `.webm`; native M4A remains one `.m4a` file.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionBuilder, writeAudioCards } from "../../../../src/core/capture/prepare/write-cards.js";

// ## WebM and M4A produce correctly named media
void test("WebM and M4A produce correctly named media", async (t) => {
  t.teardown(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L16
  const root = await mkdtemp(join(tmpdir(), "capture-write-cards-"));
  const staging = join(root, "staging");
  const attachRel = "out/session.attach";
  const attachAbs = join(root, attachRel);
  await mkdir(staging, { recursive: true });
  await mkdir(attachAbs, { recursive: true });
  await writeFile(join(staging, "webm-a"), Buffer.from("WEBM-"));
  await writeFile(join(staging, "webm-b"), Buffer.from("TAIL"));
  await writeFile(join(staging, "native.m4a"), Buffer.from("M4A"));
  const builder = new SessionBuilder({
    boxRoot: root,
    sessionAttachRelDir: attachRel,
    sessionAttachAbsDir: attachAbs,
  });
  await writeAudioCards({
    builder,
    sessionDir: staging,
    segments: [
      { id: "web", startedAt: "2026-07-09T14:00:00.000Z", format: "webm-opus", chunks: ["webm-a", "webm-b"] },
      { id: "native", startedAt: "2026-07-09T14:01:00.000Z", format: "m4a-aac", chunks: ["native.m4a"] },
    ],
  });
  t.check(
    {
      webm: (await readFile(join(root, attachRel, "audio-001.attach/audio-001.webm"))).toString(),
      m4a: (await readFile(join(root, attachRel, "audio-002.attach/audio-002.m4a"))).toString(),
      nativeCard: (await readFile(join(attachAbs, "audio-002.audio.card"), "utf8")).includes("ref: attach/audio-002.m4a"),
    },
    {
    webm: "WEBM-TAIL",
    m4a: "M4A",
    nativeCard: true,
  },
  );
});
