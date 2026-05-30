/**
 * Capture page tour: just loads the page and snapshots. The page has
 * a camera viewport that needs camera permissions to fully exercise;
 * the camera-off / tap-to-start state is what we capture here.
 */

import { tour } from "./tour-lib/index.js";

tour(
  { name: "capture", description: "Load the capture page in its camera-off state and capture artifacts." },
  async (t) => {
    await t.go("/capture");
    await t.checkpoint("camera-off");

    await t.expect.heading("Capture", { level: 1 });
    await t.expect.button("Start camera");
    await t.expect.button("Upload file");
    await t.expect.button("Cancel capture session");
  },
);
