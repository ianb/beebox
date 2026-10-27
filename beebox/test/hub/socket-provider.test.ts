// # The socket endpoint provider: polled unit state, wake on demand, no command on the request path
//
// `SocketProvider` (`src/hub/socket-provider.ts`) reads systemd's
// view of every box unit in one `list-units` call and keeps it in a map, so
// `get()` and `unavailable()` are synchronous. The command runner and the
// readiness probe are injected: no systemd here, only its JSON.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { SocketProvider, type CommandRunner, unitStateOf } from "../../src/hub/socket-provider.js";
import type { HubConfig } from "../../src/hub/config.js";
import type { Endpoint } from "../../src/hub/endpoints.js";
import { writeHubMeta } from "../../src/core/hub-meta.js";
import { mkdir, writeFile } from "node:fs/promises";

function configFor(boxes: Record<string, string>, configPath: string): HubConfig {
  const entries = Object.fromEntries(Object.entries(boxes).map(([slug, path]) => [slug, { path, socket: `/run/beebox/${slug}.sock` }]));
  return { port: undefined, host: undefined, boxes: entries, configPath, lazy: false, idleMs: 300_000, keepRecent: 0 };
}

/** A fake systemd: `list-units` answers from `states` (`active` or `active/sub`); `journalctl` from `journal`; every call is recorded. */
function fakeSystemd(states: Record<string, string>, journal: Record<string, string>) {
  const calls: string[][] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "systemctl") {
      return JSON.stringify(Object.entries(states).map(([slug, state]) => {
        const [active, sub] = state.split("/");
        return { unit: `beebox-box@${slug}.service`, load: "loaded", active, sub: sub ?? active, description: "" };
      }));
    }
    const slug = /^beebox-box@(.+)\.service$/.exec(args[1] ?? "")?.[1] ?? "";
    return `${journal[slug] ?? ""}\n`;
  };
  return { run, calls, states };
}

void test("unit states map to the hub's vocabulary", async (t) => {
  t.check(["active", "activating", "deactivating", "inactive", "failed", "reloading"].map((active) => unitStateOf(active, "running")), ["active", "activating", "deactivating", "inactive", "failed", "unknown"]);
  // A unit waiting out its restart delay reports `activating`; the sub-state names the wait.
  t.check([unitStateOf("activating", "auto-restart"), unitStateOf("activating", "auto-restart-queued"), unitStateOf("activating", "start")], ["auto-restart", "auto-restart", "activating"]);
});

void test("get() answers from the polled map; a wake probes the socket until it answers", async (t) => {
  const a = await makeTmpBox({ git: true });
  const b = await makeTmpBox({ git: true });
  t.teardown(async () => { provider.stop(); await a.cleanup(); await b.cleanup(); });
  const systemd = fakeSystemd({ a: "inactive", b: "active" }, {});
  // The probe answers only for boxes the test has marked up.
  const up = new Set<string>(["b"]);
  const probed: string[] = [];
  const probe = async (endpoint: Endpoint): Promise<boolean> => { probed.push(endpoint.slug); return up.has(endpoint.slug); };
  const provider = new SocketProvider({ config: configFor({ a: a.root, b: b.root }, a.path("hub.json")), runCommand: systemd.run, probe, pollMs: 60_000, readyTimeoutMs: 2_000 });
  await provider.start();

  // An active unit is readiness-checked once at start, so a hub-only restart keeps serving it.
  t.check(provider.get("b"), { slug: "b", origin: "http://localhost", socketPath: "/run/beebox/b.sock" });
  t.check(provider.get("a"), undefined);
  t.check(provider.unavailable("a"), "unit inactive");
  t.check(probed, ["b"]);

  // A wake connects (the probe is the connection) until the box answers; concurrent callers share it.
  setTimeout(() => up.add("a"), 300);
  const [first, second] = await Promise.all([provider.ensureRunning("a"), provider.ensureRunning("a")]);
  t.check(first, { slug: "a", origin: "http://localhost", socketPath: "/run/beebox/a.sock" });
  t.check(second, first);
  t.check(provider.get("a"), first);
  t.check(provider.unavailable("a"), undefined);

  t.check(provider.getStatuses().map((status) => [status.slug, status.status]), [["a", "running"], ["b", "running"]]);
  // No systemctl call on the request path: one list-units at start, nothing else.
  t.check(systemd.calls, [["systemctl", "list-units", "beebox-box@*.service", "--all", "--output=json", "--no-pager", "--plain"]]);
});

void test("a failed unit is reported with its last journal line, fetched once, and is not poked", async (t) => {
  const a = await makeTmpBox({ git: true });
  t.teardown(async () => { provider.stop(); await a.cleanup(); });
  const systemd = fakeSystemd({ a: "failed" }, { a: "Error: box.json is not valid JSON" });
  const provider = new SocketProvider({ config: configFor({ a: a.root }, a.path("hub.json")), runCommand: systemd.run, probe: async () => false, pollMs: 60_000, readyTimeoutMs: 100 });
  await provider.start();
  await provider.poll();
  t.check(provider.unavailable("a"), "unit failed: Error: box.json is not valid JSON");
  t.check(await provider.ensureRunning("a"), undefined);
  t.check(provider.getStatuses(), [{ slug: "a", status: "unhealthy", pid: undefined, port: undefined, restarts: 0, consecutiveFailures: 1, lastError: "unit failed: Error: box.json is not valid JSON", lastStart: undefined }]);
  // Two polls, one journal read.
  t.check(systemd.calls.filter(([command]) => command === "journalctl"), [["journalctl", "-u", "beebox-box@a.service", "-n", "1", "--no-pager", "-o", "cat"]]);

  // A wake that times out names the socket and the unit state.
  systemd.states["a"] = "inactive";
  await provider.poll();
  t.check(await provider.ensureRunning("a"), undefined);
  t.check(provider.unavailable("a"), "box/a did not answer on /run/beebox/a.sock within 100 ms (unit inactive)");
});

void test("at start, a box whose metadata holds a pending schedule is woken", async (t) => {
  const a = await makeTmpBox({ git: true });
  t.teardown(async () => { provider.stop(); await a.cleanup(); });
  await mkdir(a.path(".beebox"), { recursive: true });
  await writeFile(a.path(".beebox/chat-schedules.json"), JSON.stringify([{ id: "s", label: "x", alarm: false, announce: null, content: "c", createdAt: "2026-07-11T10:00:00.000Z", firesAt: "2099-01-01T00:00:00.000Z" }]));
  writeHubMeta(a.root, () => new Date());
  const probed: string[] = [];
  const provider = new SocketProvider({ config: configFor({ a: a.root }, a.path("hub.json")), runCommand: fakeSystemd({ a: "inactive" }, {}).run, probe: async (endpoint) => { probed.push(endpoint.slug); return true; }, pollMs: 60_000 });
  await provider.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  t.check(probed, ["a"]);
  t.check(provider.get("a")?.slug, "a");
});

// ## A crashing unit waits out systemd's restart delay, reported as a crash loop
//
// The unit has no start limit and a growing `RestartSec`
// (deploy/systemd/beebox-box@.service), so a crash loop never latches. While a
// unit waits to restart, the hub answers 503 with its last journal line, counts
// it toward the health verdict, and does not connect: a connection would start
// the unit at once and skip the delay.
void test("a unit waiting to restart is a crash loop that the hub does not poke", async (t) => {
  const a = await makeTmpBox({ git: true });
  t.teardown(async () => { provider.stop(); await a.cleanup(); });
  const systemd = fakeSystemd({ a: "activating/auto-restart" }, { a: "Error: box.json is not valid JSON" });
  const probed: string[] = [];
  const provider = new SocketProvider({ config: configFor({ a: a.root }, a.path("hub.json")), runCommand: systemd.run, probe: async (endpoint) => { probed.push(endpoint.slug); return true; }, pollMs: 60_000, readyTimeoutMs: 100 });
  await provider.start();
  t.check(await provider.ensureRunning("a"), undefined);
  t.check(probed, []);
  t.check(provider.getStatuses(), [{ slug: "a", status: "starting", pid: undefined, port: undefined, restarts: 0, consecutiveFailures: 1, lastError: "unit crashed and is waiting to restart: Error: box.json is not valid JSON", lastStart: undefined }]);

  // Once systemd has restarted it and it is serving, the next request reaches it.
  systemd.states["a"] = "active/running";
  await provider.poll();
  t.check(await provider.ensureRunning("a"), { slug: "a", origin: "http://localhost", socketPath: "/run/beebox/a.sock" });
  t.check(provider.unavailable("a"), undefined);
});
