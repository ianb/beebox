// # Send readiness — refused before the turn is taken
//
// `sendReadiness` decides, before a send takes the turn, whether its run can
// proceed (see `send-run.refused-start.doctest.md` for the route). A refusal
// reaches the sender through `onRefused`, and the session's "error" listeners
// when it has any. A queued drain sends with no listener attached: an "error"
// emitted then would throw instead of returning false, and the queued input
// would be lost. So with no listener the refusal is only returned.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sendReadiness } from "../../../../../src/core/chat/session/run/start-refusal.js";
import { makeTmpBox } from "../../../../helpers/test-helpers.js";

/** A box whose default is an added OpenRouter model, with no OpenRouter key. */
async function keylessBox() {
  const box = await makeTmpBox();
  await mkdir(join(box.root, "_config"), { recursive: true });
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify({ agentModel: "qwen/qwen3-coder", openrouterModels: [{ id: "qwen/qwen3-coder", label: "Qwen3 Coder" }] }));
  return box;
}

// ## No listener: refused, nothing thrown
void test("No listener: refused, nothing thrown", async (t) => {
  // doctest:L29
  const box = await keylessBox();
  const reasons: string[] = [];
  const ready = await sendReadiness({ boxRoot: box.root, backend: {}, explicitModel: null, liveModel: null,
    startOptions: { engine: "claude", cwd: box.root, systemPrompt: "", env: {} }, session: new EventEmitter(), onRefused: (reason) => { reasons.push(reason.split(" (")[0] ?? reason); } });
  t.check(({ ready, reasons }), {
    ready: false,
    reasons: [
      "This run uses the OpenRouter model qwen/qwen3-coder, but no usable OpenRouter key is available for this box",
    ],
  });

  // doctest:L36
  await box.cleanup();
});

// ## A live run's model is re-checked
//
// A live third-party run keeps the provider setup it started with. If its model
// is removed from the box, the next send is refused before it is admitted, and a
// listening client hears why.
void test("A live third-party run keeps the provider setup it started with.", async (t) => {
  // doctest:L46
  const box = await keylessBox();
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify({}));
  const session = new EventEmitter();
  const heard: string[] = [];
  session.on("error", (error: Error) => { heard.push(error.name); });
  const ready = await sendReadiness({ boxRoot: box.root, backend: {}, explicitModel: null, liveModel: "qwen/qwen3-coder",
    startOptions: null, session, onRefused: () => {} });
  t.check(({ ready, heard }), {
    ready: false,
    heard: [
      "OpenRouterSetupError",
    ],
  });

  // doctest:L56
  await box.cleanup();
});

// ## A first-party live run proceeds
void test("A first-party live run proceeds", async (t) => {
  // doctest:L62
  const box = await keylessBox();
  t.check(
    await sendReadiness({ boxRoot: box.root, backend: {}, explicitModel: null, liveModel: null, startOptions: null,
      session: new EventEmitter(), onRefused: () => {} }),
    true,
  );

  // doctest:L67
  await box.cleanup();
});
