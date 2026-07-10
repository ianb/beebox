/**
 * Capture tour: `/capture` is now a deep link that redirects into the chat with
 * capture mode auto-open (`?capture=1`), so this loads `/capture` and snapshots
 * the resulting full-screen capture overlay. The overlay reuses the same
 * viewport/controls, which need camera permissions to fully exercise; the
 * camera-off / tap-to-start state is what we capture here.
 */

import { tour } from "./tour-lib/index.js";

tour(
  { name: "capture", description: "Follow the /capture deep link into chat capture mode and capture artifacts." },
  async (t) => {
    await t.go("/capture");
    await t.checkpoint("camera-off");

    await t.expect.heading("Capture", { level: 1 });
    await t.expect.button("Start camera");
    await t.expect.button("Upload file");
    await t.expect.button("Cancel capture session");
  },
);
