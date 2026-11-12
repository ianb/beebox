// # The launcher that puts a box's browser in its own network
//
// docs/plans/shared-browser.md, Track F; research/embedded-browser/linux-verification.md.
// The launcher cannot run on a Mac, so these checks pin its argv and script.
// Two silent failures depend on them: without `--map-user` and `setpriv`
// agent-browser runs as uid 0 and turns Chrome's sandbox off, and without the
// four `none` port flags and `--no-map-gw` pasta forwards the browser's
// loopback to every service on the host's loopback.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { NAMESPACE_INNER_SCRIPT, namespaceArgv, pastaArgv } from "../../../../src/core/browser/host/namespace.js";

void test("unshare maps the box uid to itself and hands the command to the inner script as arguments", (t) => {
  t.check(namespaceArgv(["/opt/beebox/bin/bbx", "engine", "browser-host", "--slug", "a b"], { uid: 1007, gid: 1008, fifo: "/tmp/ns/release" }), [
    "/opt/beebox-browser/bin/unshare",
    "--user",
    "--map-user=1007",
    "--map-group=1008",
    "--net",
    "--mount",
    "--keep-caps",
    "sh",
    "-c",
    NAMESPACE_INNER_SCRIPT,
    "sh",
    "/tmp/ns/release",
    "/opt/beebox/bin/bbx",
    "engine",
    "browser-host",
    "--slug",
    "a b",
  ]);
  t.end();
});

// The child waits for pasta, fixes DNS (the host's resolv.conf names a loopback
// stub that is empty inside), waits out IPv6 duplicate-address detection, and
// drops every capability before the command runs.
void test("The inner script waits, fixes DNS, waits for addresses, and drops capabilities", (t) => {
  t.check(
    NAMESPACE_INNER_SCRIPT,
    `fifo="$1"; shift
read -r _ < "$fifo" || exit 1
mount --bind /run/systemd/resolve/resolv.conf /etc/resolv.conf || exit 1
i=0
while [ -n "$(ip -o addr show tentative)" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
exec setpriv --inh-caps=-all --ambient-caps=-all --bounding-set=-all -- "$@"`,
  );
  t.end();
});

void test("pasta attaches with no port forwarding in either direction and no gateway mapping", (t) => {
  t.check(pastaArgv(4242), [
    "/usr/bin/pasta",
    "--config-net",
    "--no-map-gw",
    "-t",
    "none",
    "-u",
    "none",
    "-T",
    "none",
    "-U",
    "none",
    "--quiet",
    "4242",
  ]);
  t.end();
});
