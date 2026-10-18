// # Tailscale target auto-discovery
//
// `--target <port>` is optional. When omitted, `resolveTargetOrDiscover` reads the
// hub config (`~/.config/beebox/hub.json`) and exposes that hub's loopback port;
// explicit `--target` always wins; and with neither an explicit port nor a
// discoverable hub config it REFUSES with guidance rather than guessing (the dev
// router is never auto-targeted). Discovery only supplies a candidate port — every
// posture guard in `tailscale-target.ts` still decides whether it may be exposed.
// See `docs/implemented-plans/tailscale-expose-and-protect.md` Track B.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resolveTargetOrDiscover } from "../../src/services/tailscale-discovery.js";
import { createFakeTailscaleDeps } from "../../src/services/tailscale-fake.js";
import { runTailscaleSetup } from "../../src/services/tailscale-setup/core.js";

// Scope the exposure file to this run (setup's guard test never records, but
// keep it hermetic regardless).
const EXPOSURE_FILE = path.join(
  os.tmpdir(),
  `bbx-exposure-discovery-test-${process.pid}-${Date.now()}.json`,
);
process.env.BBX_TAILSCALE_EXPOSURE_FILE = EXPOSURE_FILE;

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-discovery-"));

// Write a hub.json into a temp dir and return its path (injected as the
// discovery source in place of ~/.config/beebox/hub.json).
async function writeHub(name: string, obj: object): Promise<string> {
  const p = path.join(tmp, name);
  await fs.writeFile(p, JSON.stringify(obj, null, 2));
  return p;
}

// Capture the discovery announcement lines.
function capturing() {
  const lines: string[] = [];
  return { lines, log: (l: string) => { lines.push(l); } };
}

const runningStatus = {
  BackendState: "Running",
  Self: { DNSName: "box.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1"] },
  CertDomains: ["box.tail1234.ts.net"],
};

const noWaitIo = { interactive: false, log: () => {}, waitForContinue: () => Promise.resolve() };

// ## Omitting `--target` auto-detects the hub's port
//
// A hub config with an explicit `port` yields that port, and the announcement
// names what was discovered.
void test("A hub config with an explicit port yields that port, and the announcement nam...", async (t) => {
  // doctest:L59
  const hubPath = await writeHub("hub.json", { port: 5321, boxes: {} });
  const cap = capturing();
  const r = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: hubPath, log: cap.log });
  t.check([r.ok, r.ok ? r.target.port : null, cap.lines.some((l) => l.includes("Discovered hub") && l.includes("5321"))], [
    true,
    5321,
    true,
  ]);
});

// A hub config that omits `port` falls back to the hub default (4310), not the
// standalone `bbx serve` default (3210):
void test("A hub config that omits port falls back to the hub default (4310), not the st...", async (t) => {
  // doctest:L74
  const hubPath = await writeHub("hub-noport.json", { boxes: {} });
  const r = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: hubPath, log: () => {} });
  t.check([r.ok, r.ok ? r.target.port : null], [
    true,
    4310,
  ]);
});

// ## Explicit `--target` overrides a present hub config
//
// Even with a hub config present (port 5321), an explicit `--target` wins and the
// config is not consulted (no announcement).
void test("Even with a hub config present (port 5321), an explicit --target wins and the...", async (t) => {
  // doctest:L89
  const hubPath = await writeHub("hub-override.json", { port: 5321, boxes: {} });
  const cap = capturing();
  const r = await resolveTargetOrDiscover({ target: "7777", hubConfigPath: hubPath, log: cap.log });
  t.check([r.ok, r.ok ? r.target.port : null, cap.lines.length], [
    true,
    7777,
    0,
  ]);
});

// An explicit but invalid `--target` is refused (it never falls through to
// discovery):
void test("An explicit but invalid --target is refused (it never falls through to discov...", async (t) => {
  // doctest:L104
  const hubPath = await writeHub("hub-invalid.json", { port: 5321, boxes: {} });
  const r = await resolveTargetOrDiscover({ target: "not-a-port", hubConfigPath: hubPath, log: () => {} });
  t.check([r.ok, r.ok ? null : r.message.includes("invalid --target")], [
    false,
    true,
  ]);
});

// ## No `--target` and no hub config: refuse, never guess
//
// A missing (or unreadable) hub config is "no hub to discover" — we do NOT guess a
// port; we refuse and tell the operator to pass `--target`.
void test("A missing (or unreadable) hub config is \"no hub to discover\" — we do NOT gues...", async (t) => {
  // doctest:L119
  const missing = path.join(tmp, "does-not-exist.json");
  const r = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: missing, log: () => {} });
  t.check([r.ok, r.ok ? null : r.message.includes("no hub config found"), r.ok ? null : r.message.includes("--target <port>")], [
    false,
    true,
    true,
  ]);
});

// An invalid hub config (malformed JSON) is likewise treated as "no hub", not a
// propagated load error:
void test("An invalid hub config (malformed JSON) is likewise treated as \"no hub\", not a...", async (t) => {
  // doctest:L133
  const badPath = path.join(tmp, "bad.json");
  await fs.writeFile(badPath, "{ not json");
  const r = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: badPath, log: () => {} });
  t.check([r.ok, r.ok ? null : r.message.includes("auto-detect a port")], [
    false,
    true,
  ]);
});

// ## A discovered port still runs the posture guards
//
// Discovery only supplies a candidate port. If the discovered port turns out to be
// the dev router (its `/__router/status` answers), setup still REFUSES via the
// router guard — auto-detection never bypasses the fail-closed classification.
void test("Discovery only supplies a candidate port.", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.rm(EXPOSURE_FILE, { force: true });
      delete process.env.BBX_TAILSCALE_EXPOSURE_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L150
  const hubPath = await writeHub("hub-router.json", { port: 3210, boxes: {} });
  const discovered = await resolveTargetOrDiscover({ target: undefined, hubConfigPath: hubPath, log: () => {} });
  const deps = createFakeTailscaleDeps({
    status: runningStatus,
    serve: {},
    routerProbe: { reachable: true, status: 200, body: JSON.stringify({ routerPort: 3210, worktrees: {} }) },
  });
  const result = discovered.ok
    ? await runTailscaleSetup(deps, { target: discovered.target, io: noWaitIo })
    : { ok: false, message: discovered.message };
  t.check([discovered.ok, result.ok, result.message.includes("dev router")], [
    true,
    false,
    true,
  ]);
});
