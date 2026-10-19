// # Host packages: the box's record and `bbx host`
//
// A box records the distro packages it needs in `_config/host-packages.json`,
// with the reason for each. `bbx host install` records first, then asks the root
// wrapper to install; `bbx host sync` reinstalls recorded packages after a host
// rebuild; the health check shows what is recorded but missing. The wrapper
// itself (the policy) is tested by `deploy/server-bin/bbx-host-apt.smoke.sh`.
// Here the host is a fake, so these cases run anywhere.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  invalidPackageNames,
  loadHostPackages,
  missingHostPackages,
  recordHostPackages,
} from "../../src/core/host-packages.js";
import { wrapperBoxLabel } from "../../src/core/host-packages-system.js";
import { runHostInstall, runHostSync, type HostSystem } from "../../src/cli/commands/host.js";
import { hostPackagesCheck } from "../../src/webapp/trpc/routers/health/checks/host-packages.js";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";

/** A fake host: which packages are installed, and what the wrapper answers. */
function fakeHost(options?: {
  installed?: string[];
  supports?: boolean;
  sudo?: boolean;
  dpkg?: boolean;
  answer?: (names: readonly string[]) => number;
}) {
  const { installed = [], supports = true, sudo = true, dpkg = true, answer = () => 0 } = options ?? {};
  const calls: string[] = [];
  const system: HostSystem = {
    supportsInstalls: async () => supports,
    sudoAllows: async () => (sudo ? { ok: true } : { ok: false, output: "sudo: a password is required" }),
    queryInstalled: async () => (dpkg ? { supported: true, installed: new Set(installed) } : { supported: false }),
    install: async ({ box, names }: { box: string; names: readonly string[] }) => {
      calls.push(`${box}: ${names.join(" ")}`);
      return answer(names);
    },
  };
  return { system, calls };
}

/** Run with console output captured. */
async function captured(fn: () => Promise<number>) {
  const lines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => { lines.push(args.join(" ")); };
  console.error = (...args) => { lines.push(args.join(" ")); };
  try {
    const code = await fn();
    return { code, lines };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

async function manifest(box: TmpBox) {
  return fs.readFile(path.join(box.root, "_config/host-packages.json"), "utf-8");
}

// ## Names: the Debian alphabet, and nothing apt could read as an option
//
// The wrapper checks the same pattern and more; this copy only gives the agent a
// better error before anything is recorded.
void test("The wrapper checks the same pattern and more; this copy only gives the agent...", async (t) => {
  t.check(invalidPackageNames(["glabels", "python3-openpyxl", "libc++1", "g++", "-o", "./x.deb", "Glabels", "x"]), ["-o", "./x.deb", "Glabels", "x"]);
});

// ## Install records the reason first, then calls the wrapper
//
// The record comes first, so the need is kept even when this host cannot install
// it. The manifest is sorted and keeps each package's first reason.
void test("The record comes first, so the need is kept even when this host cannot instal...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const host = fakeHost();
  const result = await captured(() =>
    runHostInstall({ boxRoot: box.root, packages: ["glabels"], why: "Render label sheets to PDF" }, host.system),
  );
  t.check(result, { code: 0, lines: ["Recorded glabels in _config/host-packages.json; commit it with your other changes."] });

  t.check(host.calls.map((call) => call.replace(/^[^:]+/, "<box>")), ["<box>: glabels"]);

  await captured(() => runHostInstall({ boxRoot: box.root, packages: ["file", "glabels"], why: "Identify upload types" }, host.system));
  await t.checkText(await manifest(box), `{
  "packages": {
    "file": {
      "why": "Identify upload types",
      "added": "«*»"
    },
    "glabels": {
      "why": "Render label sheets to PDF",
      "added": "«*»"
    }
  }
}`);
});

// ## A refusal keeps the record and says who decides
void test("A refusal keeps the record and says who decides", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const host = fakeHost({ answer: () => 2 });
  const result = await captured(() =>
    runHostInstall({ boxRoot: box.root, packages: ["openssh-server"], why: "Remote access" }, host.system),
  );
  t.check(result, {
    code: 2,
    lines: [
      "Recorded openssh-server in _config/host-packages.json; commit it with your other changes.",
      "The host's package policy refused this. It stays recorded; ask the boxholder whether to install it by hand.",
    ],
  });
  // `added` is the day the record was written.
  t.check(await loadHostPackages(box.root), { "openssh-server": { why: "Remote access", added: isoDate() } });
});

// ## On a host without the wrapper (macOS), the need is recorded and the agent asks
//
// Exit 3 means "this host cannot", distinct from a refusal.
void test("Exit 3 means \"this host cannot\", distinct from a refusal.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const host = fakeHost({ supports: false });
  const result = await captured(() =>
    runHostInstall({ boxRoot: box.root, packages: ["glabels"], why: "Labels" }, host.system),
  );
  t.check(result, {
    code: 3,
    lines: [
      "Recorded glabels in _config/host-packages.json; commit it with your other changes.",
      `This host does not allow box package installs (no /usr/local/sbin/bbx-host-apt: a macOS host, or a server without it).
glabels stays recorded in _config/host-packages.json. Ask the boxholder to install it on the host.`,
    ],
  });
  t.check(host.calls, []);
});

// ## When sudo will not run the wrapper, the message names the likely causes
void test("When sudo will not run the wrapper, the message names the likely causes", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const host = fakeHost({ sudo: false });
  const result = await captured(() =>
    runHostInstall({ boxRoot: box.root, packages: ["glabels"], why: "Labels" }, host.system),
  );
  t.check(result, {
    code: 1,
    lines: [
      "Recorded glabels in _config/host-packages.json; commit it with your other changes.",
      `sudo will not run /usr/local/sbin/bbx-host-apt for this user without a password. The sudoers entry
may be missing, or the service may forbid privilege changes (systemd NoNewPrivileges).
Ask the boxholder. sudo said: sudo: a password is required`,
    ],
  });
});

// ## Bad input is refused before anything is written
void test("Bad input is refused before anything is written", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const host = fakeHost();
  const bad = await captured(() => runHostInstall({ boxRoot: box.root, packages: ["glabel.*"], why: "x" }, host.system));
  const noWhy = await captured(() => runHostInstall({ boxRoot: box.root, packages: ["glabels"], why: "  " }, host.system));
  t.check(bad, { code: 1, lines: ["Not a Debian package name: glabel.*. Use the exact name, e.g. \"glabels\"."] });
  t.check(noWhy, { code: 1, lines: ["--why needs the reason this box needs the package; the boxholder reads it."] });
  await t.checkThrows(() => fs.access(path.join(box.root, "_config/host-packages.json")), "Error");
});

// ## A hand-broken manifest is reported, never overwritten
void test("A hand-broken manifest is reported, never overwritten", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_config/host-packages.json", '{"packages":{"glabels":{"added":"2026-09-17"}}}\n');
  const host = fakeHost();
  const result = await captured(() => runHostInstall({ boxRoot: box.root, packages: ["file"], why: "x" }, host.system));
  t.check(result, {
    code: 1,
    lines: [str`_config/host-packages.json is not valid: packages.glabels.why: ${any(String)}. Fix the file by hand; nothing was changed.`],
  });
  t.check(host.calls, []);
  await t.checkText(manifest(box), '{"packages":{"glabels":{"added":"2026-09-17"}}}');
});

// ## Sync installs only what is missing, one package per call
//
// One call per package, so a refused package does not block the others. A
// refusal wins over success in the exit code.
void test("One call per package, so a refused package does not block the others.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await recordHostPackages(box.root, { names: ["file", "glabels", "openssh-server"], why: "x", added: "2026-09-17" });
  const host = fakeHost({ installed: ["file"], answer: (names) => (names[0] === "openssh-server" ? 2 : 0) });
  const result = await captured(() => runHostSync({ boxRoot: box.root }, host.system));
  t.check(result.code, 2);
  t.check(host.calls.map((call) => call.replace(/^[^:]+/, "<box>")), ["<box>: glabels", "<box>: openssh-server"]);

  const done = await captured(() => runHostSync({ boxRoot: box.root }, fakeHost({ installed: ["file", "glabels", "openssh-server"] }).system));
  t.check(done, { code: 0, lines: ["All 3 recorded host packages are installed."] });
});

// ## Health: missing packages warn; a host without dpkg lists them without warning
void test("Health: missing packages warn; a host without dpkg lists them without warning", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const none = await hostPackagesCheck(box.root, { queryInstalled: fakeHost().system.queryInstalled });
  t.check(none, null);
  await recordHostPackages(box.root, { names: ["glabels", "file"], why: "x", added: "2026-09-17" });
  const missing = await hostPackagesCheck(box.root, { queryInstalled: fakeHost({ installed: ["file"] }).system.queryInstalled });
  t.check(missing, {
    name: "host-packages",
    ok: false,
    message: "Recorded host packages not installed: glabels. `bbx host sync` installs them; one the host's policy refuses needs the boxholder.",
    severity: "warning",
  });
  const mac = await hostPackagesCheck(box.root, { queryInstalled: fakeHost({ dpkg: false }).system.queryInstalled });
  t.check(mac, {
    name: "host-packages",
    ok: true,
    message: "_config/host-packages.json records file glabels; this host has no dpkg, so they cannot be checked here",
    severity: "warning",
  });
});

// ## Pure pieces
void test("Pure pieces", async (t) => {
  t.check(missingHostPackages({ a1: { why: "x", added: "2026-09-17" }, b2: { why: "y", added: "2026-09-17" } }, new Set(["a1"])), ["b2"]);

  t.check([wrapperBoxLabel("test1"), wrapperBoxLabel("My_Box"), wrapperBoxLabel("--x"), wrapperBoxLabel("___")], ["test1", "my-box", "x", "box"]);
});
