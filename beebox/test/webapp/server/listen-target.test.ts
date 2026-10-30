// # Listen target: the systemd socket-activation protocol and `--socket`
//
// `resolveListenTarget` decides whether `bbx engine serve` binds TCP, creates a
// Unix socket, or adopts the socket systemd passed as fd 3. The protocol's
// guard (`LISTEN_PID` must name this process) and its clean-up (the variables
// never reach a subprocess) are the rules under test.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { resolveListenTarget, takeSystemdListenFds } from "../../../src/webapp/server/listen-target.js";

void test("a passed socket is adopted only when LISTEN_PID names this process", async (t) => {
  // systemd's own pid check: a grandchild inheriting the variables must not adopt its parent's fd.
  const env: NodeJS.ProcessEnv = { LISTEN_PID: "41", LISTEN_FDS: "1", LISTEN_FDNAMES: "beebox-box@a.socket" };
  t.check(takeSystemdListenFds(env, 42), []);
  // Taken or not, the variables are cleared, as `sd_listen_fds(unset_environment=1)` does.
  t.check(env, {});

  t.check(takeSystemdListenFds({ LISTEN_PID: "42", LISTEN_FDS: "2" }, 42), [3, 4]);
  t.check(takeSystemdListenFds({}, 42), []);
  t.checkThrows(() => takeSystemdListenFds({ LISTEN_PID: "42", LISTEN_FDS: "many" }, 42), "ListenTargetError");
});

void test("the target follows --socket and the passed descriptor", async (t) => {
  const tcp = resolveListenTarget({ port: 3210, host: "localhost", socket: undefined, env: {}, pid: 1 });
  t.check(tcp, { kind: "tcp", port: 3210, host: "localhost" });

  const created = resolveListenTarget({ port: 3210, host: "localhost", socket: "/run/beebox/a.sock", env: {}, pid: 1 });
  t.check(created, { kind: "socket", path: "/run/beebox/a.sock" });

  const activated = resolveListenTarget({
    port: 3210, host: "localhost", socket: "/run/beebox/a.sock", env: { LISTEN_PID: "7", LISTEN_FDS: "1" }, pid: 7,
  });
  t.check(activated, { kind: "inherited-fd", fd: 3, path: "/run/beebox/a.sock" });

  // A unit that passes a socket but omits --socket is misconfigured; TCP would
  // be a wrong answer that announces nothing, so it refuses.
  t.checkThrows(
    () => resolveListenTarget({ port: 3210, host: "localhost", socket: undefined, env: { LISTEN_PID: "7", LISTEN_FDS: "1" }, pid: 7 }),
    "ListenTargetError",
  );
  t.checkThrows(
    () => resolveListenTarget({ port: 3210, host: "localhost", socket: "/x", env: { LISTEN_PID: "7", LISTEN_FDS: "2" }, pid: 7 }),
    "ListenTargetError",
  );
});
