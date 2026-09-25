# Host packages: the box's record and `bbx host`

A box records the distro packages it needs in `_config/host-packages.json`,
with the reason for each. `bbx host install` records first, then asks the root
wrapper to install; `bbx host sync` reinstalls recorded packages after a host
rebuild; the health check shows what is recorded but missing. The wrapper
itself (the policy) is tested by `deploy/server-bin/bbx-host-apt.smoke.sh`.
Here the host is a fake, so these cases run anywhere.

```ts setup
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  invalidPackageNames,
  loadHostPackages,
  missingHostPackages,
  recordHostPackages,
} from "../../src/core/host-packages.js";
import { wrapperBoxLabel } from "../../src/core/host-packages-system.js";
import { runHostInstall, runHostSync } from "../../src/cli/commands/host.js";
import { hostPackagesCheck } from "../../src/webapp/trpc/routers/health-host-packages.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

/** A fake host: which packages are installed, and what the wrapper answers. */
function fakeHost({ installed = [], supports = true, sudo = true, dpkg = true, answer = () => 0 } = {}) {
  const calls = [];
  const system = {
    supportsInstalls: async () => supports,
    sudoAllows: async () => (sudo ? { ok: true } : { ok: false, output: "sudo: a password is required" }),
    queryInstalled: async () => (dpkg ? { supported: true, installed: new Set(installed) } : { supported: false }),
    install: async ({ box, names }) => {
      calls.push(`${box}: ${names.join(" ")}`);
      return answer(names);
    },
  };
  return { system, calls };
}

/** Run with console output captured. */
async function captured(fn) {
  const lines = [];
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

async function manifest(box) {
  return fs.readFile(path.join(box.root, "_config/host-packages.json"), "utf-8");
}
```

## Names: the Debian alphabet, and nothing apt could read as an option

The wrapper checks the same pattern and more; this copy only gives the agent a
better error before anything is recorded.

```ts
invalidPackageNames(["glabels", "python3-openpyxl", "libc++1", "g++", "-o", "./x.deb", "Glabels", "x"]).join(" ")
=> -o ./x.deb Glabels x
```

## Install records the reason first, then calls the wrapper

The record comes first, so the need is kept even when this host cannot install
it. The manifest is sorted and keeps each package's first reason.

```ts
const box = await makeTmpBox();
const host = fakeHost();
const result = await captured(() =>
  runHostInstall({ boxRoot: box.root, packages: ["glabels"], why: "Render label sheets to PDF" }, host.system),
);
result.code
=> 0

host.calls.map((call) => call.replace(/^[^:]+/, "<box>")).join(", ")
=> <box>: glabels

await captured(() => runHostInstall({ boxRoot: box.root, packages: ["file", "glabels"], why: "Identify upload types" }, host.system));
await manifest(box)
=>
{
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
}
```

```ts cleanup
await box.cleanup();
```

## A refusal keeps the record and says who decides

```ts
const box = await makeTmpBox();
const host = fakeHost({ answer: () => 2 });
const result = await captured(() =>
  runHostInstall({ boxRoot: box.root, packages: ["openssh-server"], why: "Remote access" }, host.system),
);
print(`exit ${result.code}`);
print(result.lines.at(-1));
Object.keys(await loadHostPackages(box.root)).join(" ")
=>
exit 2
The host's package policy refused this. It stays recorded; ask the boxholder whether to install it by hand.
openssh-server
```

```ts cleanup
await box.cleanup();
```

## On a host without the wrapper (macOS), the need is recorded and the agent asks

Exit 3 means "this host cannot", distinct from a refusal.

```ts
const box = await makeTmpBox();
const host = fakeHost({ supports: false });
const result = await captured(() =>
  runHostInstall({ boxRoot: box.root, packages: ["glabels"], why: "Labels" }, host.system),
);
print(`exit ${result.code}, wrapper called ${host.calls.length} times`);
result.lines.join("\n")
=>
exit 3, wrapper called 0 times
Recorded glabels in _config/host-packages.json; commit it with your other changes.
This host does not allow box package installs (no /usr/local/sbin/bbx-host-apt: a macOS host, or a server without it).
glabels stays recorded in _config/host-packages.json. Ask the boxholder to install it on the host.
```

```ts cleanup
await box.cleanup();
```

## When sudo will not run the wrapper, the message names the likely causes

```ts
const box = await makeTmpBox();
const host = fakeHost({ sudo: false });
const result = await captured(() =>
  runHostInstall({ boxRoot: box.root, packages: ["glabels"], why: "Labels" }, host.system),
);
print(`exit ${result.code}`);
result.lines.slice(1).join("\n")
=>
exit 1
sudo will not run /usr/local/sbin/bbx-host-apt for this user without a password. The sudoers entry
may be missing, or the service may forbid privilege changes (systemd NoNewPrivileges).
Ask the boxholder. sudo said: sudo: a password is required
```

```ts cleanup
await box.cleanup();
```

## Bad input is refused before anything is written

```ts
const box = await makeTmpBox();
const host = fakeHost();
const bad = await captured(() => runHostInstall({ boxRoot: box.root, packages: ["glabel.*"], why: "x" }, host.system));
const noWhy = await captured(() => runHostInstall({ boxRoot: box.root, packages: ["glabels"], why: "  " }, host.system));
print(`${bad.code} ${bad.lines[0]}`);
print(`${noWhy.code} ${noWhy.lines[0]}`);
await fs.access(path.join(box.root, "_config/host-packages.json")).then(() => "written", () => "not written")
=>
1 Not a Debian package name: glabel.*. Use the exact name, e.g. "glabels".
1 --why needs the reason this box needs the package; the boxholder reads it.
not written
```

```ts cleanup
await box.cleanup();
```

## A hand-broken manifest is reported, never overwritten

```ts
const box = await makeTmpBox();
await box.write("_config/host-packages.json", '{"packages":{"glabels":{"added":"2026-09-17"}}}\n');
const host = fakeHost();
const result = await captured(() => runHostInstall({ boxRoot: box.root, packages: ["file"], why: "x" }, host.system));
print(`exit ${result.code}, wrapper called ${host.calls.length} times`);
print(result.lines[0]);
await manifest(box)
=>
exit 1, wrapper called 0 times
_config/host-packages.json is not valid: packages.glabels.why: «*». Fix the file by hand; nothing was changed.
{"packages":{"glabels":{"added":"2026-09-17"}}}
```

```ts cleanup
await box.cleanup();
```

## Sync installs only what is missing, one package per call

One call per package, so a refused package does not block the others. A
refusal wins over success in the exit code.

```ts
const box = await makeTmpBox();
await recordHostPackages(box.root, { names: ["file", "glabels", "openssh-server"], why: "x", added: "2026-09-17" });
const host = fakeHost({ installed: ["file"], answer: (names) => (names[0] === "openssh-server" ? 2 : 0) });
const result = await captured(() => runHostSync({ boxRoot: box.root }, host.system));
print(`exit ${result.code}`);
host.calls.map((call) => call.replace(/^[^:]+/, "<box>")).join(", ")
=>
exit 2
<box>: glabels, <box>: openssh-server

const done = await captured(() => runHostSync({ boxRoot: box.root }, fakeHost({ installed: ["file", "glabels", "openssh-server"] }).system));
done.lines[0]
=> All 3 recorded host packages are installed.
```

```ts cleanup
await box.cleanup();
```

## Health: missing packages warn; a host without dpkg lists them without warning

```ts
const box = await makeTmpBox();
const none = await hostPackagesCheck(box.root, { queryInstalled: fakeHost().system.queryInstalled });
print(`nothing recorded: ${none}`);
await recordHostPackages(box.root, { names: ["glabels", "file"], why: "x", added: "2026-09-17" });
const missing = await hostPackagesCheck(box.root, { queryInstalled: fakeHost({ installed: ["file"] }).system.queryInstalled });
print(`${missing.ok} ${missing.severity}: ${missing.message}`);
const mac = await hostPackagesCheck(box.root, { queryInstalled: fakeHost({ dpkg: false }).system.queryInstalled });
`${mac.ok}: ${mac.message}`
=>
nothing recorded: null
false warning: Recorded host packages not installed: glabels. `bbx host sync` installs them; one the host's policy refuses needs the boxholder.
true: _config/host-packages.json records file glabels; this host has no dpkg, so they cannot be checked here
```

```ts cleanup
await box.cleanup();
```

## Pure pieces

```ts
missingHostPackages({ a1: { why: "x", added: "2026-09-17" }, b2: { why: "y", added: "2026-09-17" } }, new Set(["a1"])).join(" ")
=> b2

[wrapperBoxLabel("test1"), wrapperBoxLabel("My_Box"), wrapperBoxLabel("--x"), wrapperBoxLabel("___")].join(" ")
=> test1 my-box x box
```
