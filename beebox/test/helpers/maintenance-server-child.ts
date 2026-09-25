/** Disposable full-server process for lifecycle smoke; never prewarms an agent. */
import { startServer } from "../../src/webapp/server.js";
import { invariant } from "../../src/lib/invariant.js";

const boxRoot = process.argv[2];
const port = Number(process.argv[3]);
invariant(boxRoot && Number.isFinite(port), "Fixture needs a box root and port");
await startServer({ boxes: [{ boxRoot, slug: "fixture" }], port, host: "127.0.0.1", prewarmChat: false });
