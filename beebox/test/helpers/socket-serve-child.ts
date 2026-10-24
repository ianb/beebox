/**
 * Disposable full server on a Unix socket, for the socket-activation test.
 *
 * Stands in for systemd's exec of `bbx engine serve --socket`: when the parent
 * passed `LISTEN_FDS`, this process names itself as the activated service
 * (`LISTEN_PID`), which systemd sets at exec time to the service's own pid and
 * a test parent cannot know before spawning. Everything after that is the real
 * `startServer` path. Never prewarms an agent.
 */
import { startServer } from "../../src/webapp/server/app.js";
import { invariant } from "../../src/shared/invariant.js";

const boxRoot = process.argv[2];
const socket = process.argv[3];
const idleExit = process.argv[4];
invariant(boxRoot && socket, "Fixture needs a box root and a socket path, and optionally an idle-exit in ms");
if (process.env.LISTEN_FDS !== undefined) process.env.LISTEN_PID = String(process.pid);
await startServer({
  boxes: [{ boxRoot, slug: "fixture" }],
  socket,
  prewarmChat: false,
  ...(idleExit !== undefined && { idleExitMs: Number(idleExit) }),
});
