# The `schedule` subcommand's core logic

Exercises `schedule.ts` directly — `process.platform`/`argv`/`getuid` and
the real `launchctl` process spawn live in `src/schedule-cli.ts` /
`src/launchctl.ts` and aren't exercised here. `launchctl` is faked
(`FakeLaunchctlRunner` below, defined in this file — it records every
invocation so tests can assert on it) so no doctest here ever spawns a real
process or touches a real LaunchAgent.

```ts setup
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  generatePlist,
  installSchedule,
  parseIntervalSeconds,
  requireDarwin,
  scheduleStatus,
  uninstallSchedule,
  DEFAULT_INTERVAL_MINUTES,
  LABEL,
  logPath,
  plistPath,
  type LaunchctlResult,
  type LaunchctlRunner,
} from "../src/schedule.js";
import { parseIntervalMinutes } from "../src/schedule-cli.js";
import { homeConfigPath, resolveConfigPath } from "../src/config-path.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("schedule");

interface Rejection {
  readonly name: string;
  readonly message: string;
}

async function rejected(promise: Promise<unknown>): Promise<Rejection> {
  try {
    await promise;
    return { name: "(no error thrown)", message: "(no error thrown)" };
  } catch (e) {
    return {
      name: e instanceof Error ? e.name : String(e),
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

function syncRejected(fn: () => unknown): Promise<Rejection> {
  return rejected(Promise.resolve().then(fn));
}

class FakeLaunchctlRunner implements LaunchctlRunner {
  readonly calls: string[][] = [];
  private readonly overrides: Partial<Record<string, LaunchctlResult>>;

  constructor(overrides?: Partial<Record<string, LaunchctlResult>>) {
    this.overrides = overrides ?? {};
  }

  run(args: readonly string[]): Promise<LaunchctlResult> {
    this.calls.push([...args]);
    const verb = args[0];
    const override = verb === undefined ? undefined : this.overrides[verb];
    return Promise.resolve(override ?? { code: 0, stdout: "", stderr: "" });
  }
}

async function writeValidConfig(configPath: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      targets: [
        { folder: "/scans/family", serverUrl: "https://cb.example.org", box: "family", tokenPath: "/t", disposition: "keep" },
      ],
    }),
  );
}
```

## Plist generation — exact XML, entity-escaped paths, interval math

A path with a space and an ampersand must come out entity-escaped (`&amp;`)
so the plist stays valid XML; `RunAtLoad` is always `true`; `StartInterval`
is exactly `intervalSeconds` as given (the minutes→seconds multiplication
happens in `installSchedule`, not here).

```
const plist = generatePlist({
  nodePath: "/usr/local/bin/node",
  bundlePath: "/Users/A B & C/scan-uploader.mjs",
  configPath: "/Users/A B & C/scan-uploader.json",
  intervalSeconds: 900,
  logPath: "/Users/A B & C/scan-uploader.log",
});
JSON.stringify(plist)
=> "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>Label</key>\n\t<string>org.callback-box.scan-uploader</string>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/usr/local/bin/node</string>\n\t\t<string>/Users/A B &amp; C/scan-uploader.mjs</string>\n\t\t<string>/Users/A B &amp; C/scan-uploader.json</string>\n\t</array>\n\t<key>StartInterval</key>\n\t<integer>900</integer>\n\t<key>RunAtLoad</key>\n\t<true/>\n\t<key>StandardOutPath</key>\n\t<string>/Users/A B &amp; C/scan-uploader.log</string>\n\t<key>StandardErrorPath</key>\n\t<string>/Users/A B &amp; C/scan-uploader.log</string>\n</dict>\n</plist>\n"
```

`parseIntervalSeconds` reads `StartInterval` back out of exactly that
output — round-tripping what `generatePlist` wrote:

```continue
parseIntervalSeconds(plist)
=> 900
```

## `parseIntervalMinutes` — positive-integer validation, default 15

```
parseIntervalMinutes(undefined)
=> 15
```

```continue
DEFAULT_INTERVAL_MINUTES
=> 15
```

```continue
parseIntervalMinutes("30")
=> 30
```

```continue
const zero = await syncRejected(() => parseIntervalMinutes("0"));
zero.name
=> ScheduleError
```

```continue
const negative = await syncRejected(() => parseIntervalMinutes("-5"));
negative.name
=> ScheduleError
```

```continue
const notANumber = await syncRejected(() => parseIntervalMinutes("soon"));
notANumber.message
=> --interval must be a positive integer number of minutes (got "soon")
```

## Non-macOS is refused outright — same posture as the `trash` disposition

```
const nonDarwin = await syncRejected(() => requireDarwin("linux"));
nonDarwin.name
=> ScheduleError
```

```continue
nonDarwin.message
=> scan-uploader schedule is only supported on macOS (this machine is "linux")
```

```continue
const darwinOk = await syncRejected(() => requireDarwin("darwin"));
darwinOk.name
=> (no error thrown)
```

## `install` refuses when the config is missing or invalid — no plist written

```
const homeDirA = join(dir, "homeA");
const missingConfigPath = join(dir, "missing-config", "scan-uploader.json");
const runnerA = new FakeLaunchctlRunner();
const missingConfigFailure = await rejected(
  installSchedule({
    homeDir: homeDirA,
    uid: 501,
    runner: runnerA,
    configPath: missingConfigPath,
    nodePath: "/usr/local/bin/node",
    bundlePath: "/path/to/scan-uploader.mjs",
    intervalMinutes: 15,
  }),
);
missingConfigFailure.name
=> ScheduleError
```

```continue
runnerA.calls.length
=> 0
```

An existing but invalid (unparseable) config is refused the same way:

```continue
await mkdir(join(dir, "invalid-config"), { recursive: true });
const invalidConfigPath = join(dir, "invalid-config", "scan-uploader.json");
await writeFile(invalidConfigPath, "{ not json");
const invalidConfigFailure = await rejected(
  installSchedule({
    homeDir: homeDirA,
    uid: 501,
    runner: runnerA,
    configPath: invalidConfigPath,
    nodePath: "/usr/local/bin/node",
    bundlePath: "/path/to/scan-uploader.mjs",
    intervalMinutes: 15,
  }),
);
invalidConfigFailure.name
=> ScheduleError
```

```continue
runnerA.calls.length
=> 0
```

## `install` writes the plist, boots out (tolerating failure), then bootstraps

`bootout` is expected to fail here (nothing loaded yet) — that failure is
tolerated, not surfaced, and `bootstrap` still runs and determines success.

```
const homeDirB = join(dir, "homeB");
const configPathB = join(dir, "install-ok", "scan-uploader.json");
await writeValidConfig(configPathB);
const runnerB = new FakeLaunchctlRunner({ bootout: { code: 1, stdout: "", stderr: "Could not find service" } });
const installResult = await installSchedule({
  homeDir: homeDirB,
  uid: 501,
  runner: runnerB,
  configPath: configPathB,
  nodePath: "/usr/local/bin/node",
  bundlePath: "/path/to/scan-uploader.mjs",
  intervalMinutes: 20,
});
installResult.intervalMinutes
=> 20
```

```continue
installResult.plistPath === plistPath(homeDirB)
=> true
```

```continue
installResult.logPath === logPath(homeDirB)
=> true
```

The plist landed on disk with the minutes converted to seconds:

```continue
const writtenPlist = await readFile(installResult.plistPath, "utf-8");
parseIntervalSeconds(writtenPlist)
=> 1200
```

`bootout` then `bootstrap` were called, in that order, with the expected
targets (the plist path is a tmp-dir path, so it's compared separately by
equality rather than embedded in a literal expected string):

```continue
runnerB.calls.length
=> 2
```

```continue
JSON.stringify(runnerB.calls[0])
=> ["bootout","gui/501/org.callback-box.scan-uploader"]
```

```continue
runnerB.calls[1]?.[0]
=> bootstrap
```

```continue
runnerB.calls[1]?.[1]
=> gui/501
```

```continue
runnerB.calls[1]?.[2] === installResult.plistPath
=> true
```

## `install` surfaces a `bootstrap` failure — the plist is still on disk

```
const homeDirC = join(dir, "homeC");
const configPathC = join(dir, "install-fail", "scan-uploader.json");
await writeValidConfig(configPathC);
const runnerC = new FakeLaunchctlRunner({ bootstrap: { code: 1, stdout: "", stderr: "service already loaded" } });
const bootstrapFailure = await rejected(
  installSchedule({
    homeDir: homeDirC,
    uid: 501,
    runner: runnerC,
    configPath: configPathC,
    nodePath: "/usr/local/bin/node",
    bundlePath: "/path/to/scan-uploader.mjs",
    intervalMinutes: 15,
  }),
);
bootstrapFailure.name
=> ScheduleError
```

```continue
bootstrapFailure.message.includes("service already loaded")
=> true
```

The plist was written before the failing `bootstrap` call — it's left in
place, not cleaned up, so the printed error's path is actually there to fix:

```continue
const existsC = await readFile(plistPath(homeDirC), "utf-8").then(() => true, () => false);
existsC
=> true
```

## `status` — present/loaded/interval/log, all before anything is installed

```
const homeDirD = join(dir, "homeD");
const runnerD = new FakeLaunchctlRunner({ print: { code: 1, stdout: "", stderr: "Could not find service" } });
const statusBefore = await scheduleStatus({ homeDir: homeDirD, uid: 501, runner: runnerD });
statusBefore.plistPresent
=> false
```

```continue
statusBefore.loaded
=> false
```

```continue
statusBefore.intervalMinutes
=> undefined
```

```continue
statusBefore.logPresent
=> false
```

Install, then `status` reports present/loaded/interval read back from the
real plist on disk:

```continue
const configPathD = join(dir, "status-flow", "scan-uploader.json");
await writeValidConfig(configPathD);
const runnerInstallD = new FakeLaunchctlRunner();
await installSchedule({
  homeDir: homeDirD,
  uid: 501,
  runner: runnerInstallD,
  configPath: configPathD,
  nodePath: "/usr/local/bin/node",
  bundlePath: "/path/to/scan-uploader.mjs",
  intervalMinutes: 5,
});
const runnerLoadedD = new FakeLaunchctlRunner({ print: { code: 0, stdout: "state = running", stderr: "" } });
const statusAfter = await scheduleStatus({ homeDir: homeDirD, uid: 501, runner: runnerLoadedD });
statusAfter.plistPresent
=> true
```

```continue
statusAfter.loaded
=> true
```

```continue
statusAfter.intervalMinutes
=> 5
```

```continue
JSON.stringify(runnerLoadedD.calls)
=> [["print","gui/501/org.callback-box.scan-uploader"]]
```

## `uninstall` — bootout (tolerated whether loaded or not), removes the plist, idempotent

```
const homeDirE = join(dir, "homeE");
const configPathE = join(dir, "uninstall-flow", "scan-uploader.json");
await writeValidConfig(configPathE);
await installSchedule({
  homeDir: homeDirE,
  uid: 501,
  runner: new FakeLaunchctlRunner(),
  configPath: configPathE,
  nodePath: "/usr/local/bin/node",
  bundlePath: "/path/to/scan-uploader.mjs",
  intervalMinutes: 15,
});
const runnerUninstall1 = new FakeLaunchctlRunner();
const uninstall1 = await uninstallSchedule({ homeDir: homeDirE, uid: 501, runner: runnerUninstall1 });
uninstall1.wasInstalled
=> true
```

```continue
const existsAfterUninstall1 = await readFile(plistPath(homeDirE), "utf-8").then(() => true, () => false);
existsAfterUninstall1
=> false
```

```continue
JSON.stringify(runnerUninstall1.calls)
=> [["bootout","gui/501/org.callback-box.scan-uploader"]]
```

A second `uninstall` is idempotent — reports "not installed", and still
attempts `bootout` (tolerating that it's not loaded) rather than erroring:

```continue
const runnerUninstall2 = new FakeLaunchctlRunner({ bootout: { code: 1, stdout: "", stderr: "Could not find service" } });
const uninstall2 = await uninstallSchedule({ homeDir: homeDirE, uid: 501, runner: runnerUninstall2 });
uninstall2.wasInstalled
=> false
```

```continue
JSON.stringify(runnerUninstall2.calls)
=> [["bootout","gui/501/org.callback-box.scan-uploader"]]
```

```continue
LABEL
=> org.callback-box.scan-uploader
```

## `install` with no explicit `--config` embeds the resolved default's ABSOLUTE path

Mirrors `schedule-cli.ts`'s actual wiring: resolve first via the same
`resolveConfigPath` `configure` uses, then pass the result to
`installSchedule` as an explicit `configPath` — `installSchedule` itself
does no resolution of its own, so this proves the two modules compose
correctly rather than re-testing resolution logic already covered in
`config-path.doctest.md`.

```
const homeDirF = join(dir, "homeF");
const cwdDirF = join(dir, "cwdF");
await mkdir(cwdDirF, { recursive: true });
const resolvedConfigPathF = await resolveConfigPath({ cwd: cwdDirF, homeDir: homeDirF });
resolvedConfigPathF === homeConfigPath(homeDirF)
=> true
```

```continue
await writeValidConfig(resolvedConfigPathF);
const runnerF = new FakeLaunchctlRunner();
const installResultF = await installSchedule({
  homeDir: homeDirF,
  uid: 501,
  runner: runnerF,
  configPath: resolvedConfigPathF,
  nodePath: "/usr/local/bin/node",
  bundlePath: "/path/to/scan-uploader.mjs",
  intervalMinutes: 15,
});
const writtenPlistF = await readFile(installResultF.plistPath, "utf-8");
writtenPlistF.includes(`<string>${resolvedConfigPathF}</string>`)
=> true
```

```cleanup
await removeTmpDir(dir);
```
