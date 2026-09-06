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
  detectRunMode,
  generatePlist,
  installSchedule,
  parseIntervalSeconds,
  requireDarwin,
  resolveLaunchdInvocation,
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
        { folder: "/scans/family", serverUrl: "https://beebox.run", box: "family", tokenPath: "/t", disposition: "keep" },
      ],
    }),
  );
}
```

## Plist generation — exact XML, entity-escaped paths, interval math

A path with a space and an ampersand must come out entity-escaped (`&amp;`)
so the plist stays valid XML; `RunAtLoad` is always `true`; `StartInterval`
is exactly `intervalSeconds` as given (the minutes→seconds multiplication
happens in `installSchedule`, not here). No `workingDirectory`/
`environmentVariables` given — this is bundle mode's shape, where
`ProgramArguments` alone is enough (no `WorkingDirectory`/
`EnvironmentVariables` keys at all):

```
const plist = generatePlist({
  programArguments: ["/usr/local/bin/node", "/Users/A B & C/scan-uploader.mjs", "/Users/A B & C/scan-uploader.json"],
  intervalSeconds: 900,
  logPath: "/Users/A B & C/scan-uploader.log",
});
JSON.stringify(plist)
=> "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>Label</key>\n\t<string>org.beebox.scan-uploader</string>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/usr/local/bin/node</string>\n\t\t<string>/Users/A B &amp; C/scan-uploader.mjs</string>\n\t\t<string>/Users/A B &amp; C/scan-uploader.json</string>\n\t</array>\n\t<key>StartInterval</key>\n\t<integer>900</integer>\n\t<key>RunAtLoad</key>\n\t<true/>\n\t<key>StandardOutPath</key>\n\t<string>/Users/A B &amp; C/scan-uploader.log</string>\n\t<key>StandardErrorPath</key>\n\t<string>/Users/A B &amp; C/scan-uploader.log</string>\n</dict>\n</plist>\n"
```

`parseIntervalSeconds` reads `StartInterval` back out of exactly that
output — round-tripping what `generatePlist` wrote:

```continue
parseIntervalSeconds(plist)
=> 900
```

Source mode's shape adds `WorkingDirectory` and an `EnvironmentVariables`
dict — both entity-escaped the same as any other string value:

```
const sourcePlist = generatePlist({
  programArguments: ["/repo/bin/scan-uploader", "/Users/A B & C/scan-uploader.json"],
  workingDirectory: "/repo root & co",
  environmentVariables: { PATH: "/usr/local/bin:/usr/bin:/bin" },
  intervalSeconds: 900,
  logPath: "/Users/A B & C/scan-uploader.log",
});
JSON.stringify(sourcePlist)
=> "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>Label</key>\n\t<string>org.beebox.scan-uploader</string>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/repo/bin/scan-uploader</string>\n\t\t<string>/Users/A B &amp; C/scan-uploader.json</string>\n\t</array>\n\t<key>WorkingDirectory</key>\n\t<string>/repo root &amp; co</string>\n\t<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>PATH</key>\n\t\t<string>/usr/local/bin:/usr/bin:/bin</string>\n\t</dict>\n\t<key>StartInterval</key>\n\t<integer>900</integer>\n\t<key>RunAtLoad</key>\n\t<true/>\n\t<key>StandardOutPath</key>\n\t<string>/Users/A B &amp; C/scan-uploader.log</string>\n\t<key>StandardErrorPath</key>\n\t<string>/Users/A B &amp; C/scan-uploader.log</string>\n</dict>\n</plist>\n"
```

```continue
parseIntervalSeconds(sourcePlist)
=> 900
```

`watchPaths` adds a `WatchPaths` array, so launchd fires a sweep the moment a
scan folder changes rather than waiting out the interval. The interval stays —
the two triggers are complementary, and the check endpoint's dedup makes a
double-fire harmless:

```
const watchPlist = generatePlist({
  programArguments: ["/repo/bin/scan-uploader", "/config.json"],
  intervalSeconds: 900,
  watchPaths: ["/Users/A B & C/Receipts/", "/Users/A B & C/Invoices/"],
  logPath: "/log",
});
watchPlist.includes("\t<key>WatchPaths</key>\n\t<array>\n\t\t<string>/Users/A B &amp; C/Receipts/</string>\n\t\t<string>/Users/A B &amp; C/Invoices/</string>\n\t</array>")
=> true
```

An absent or empty list omits the key entirely, which is what keeps a
schedule with no watched folders byte-identical to the plists above:

```continue
generatePlist({ programArguments: ["/x"], intervalSeconds: 900, logPath: "/log" }).includes("WatchPaths")
=> false
```

```continue
generatePlist({ programArguments: ["/x"], intervalSeconds: 900, watchPaths: [], logPath: "/log" }).includes("WatchPaths")
=> false
```

## `detectRunMode` — the `.ts` vs `.mjs` suffix check

```
detectRunMode("/repo/scan-uploader/src/cli.ts")
=> source
```

```continue
detectRunMode("/path/to/scan-uploader.mjs")
=> bundle
```

```continue
detectRunMode("/Users/A B & C/scan-uploader.mjs")
=> bundle
```

## `resolveLaunchdInvocation` — bundle mode is unchanged; source mode needs the repo-root wrapper

Bundle mode: `[execPath, entryPath, configPath]`, no working directory or
env — this never touches the filesystem, so a nonexistent path is fine to
pass here.

```
const bundleInvocation = await resolveLaunchdInvocation({
  entryPath: "/path/to/scan-uploader.mjs",
  execPath: "/usr/local/bin/node",
  configPath: "/path/to/scan-uploader.json",
});
JSON.stringify(bundleInvocation)
=> {"programArguments":["/usr/local/bin/node","/path/to/scan-uploader.mjs","/path/to/scan-uploader.json"]}
```

Source mode derives the repo root from `entryPath` (`<repoRoot>/scan-uploader/src/cli.ts`) and requires `<repoRoot>/bin/scan-uploader` to actually exist:

```continue
const repoRootG = join(dir, "repoG");
const entryPathG = join(repoRootG, "scan-uploader", "src", "cli.ts");
const missingWrapper = await rejected(
  resolveLaunchdInvocation({ entryPath: entryPathG, execPath: "/usr/local/bin/node", configPath: "/x/scan-uploader.json" }),
);
missingWrapper.name
=> ScheduleError
```

```continue
missingWrapper.message.includes(join(repoRootG, "bin", "scan-uploader"))
=> true
```

Once the wrapper exists, source mode resolves to
`[wrapperPath, configPath]`, `workingDirectory` = the repo root, and a
`PATH` env built from `dirname(execPath)`:

```continue
await mkdir(join(repoRootG, "bin"), { recursive: true });
await writeFile(join(repoRootG, "bin", "scan-uploader"), "#!/usr/bin/env bash\n");
const sourceInvocation = await resolveLaunchdInvocation({
  entryPath: entryPathG,
  execPath: "/usr/local/bin/node",
  configPath: "/x/scan-uploader.json",
});
sourceInvocation.programArguments.length
=> 2
```

```continue
sourceInvocation.programArguments[0] === join(repoRootG, "bin", "scan-uploader")
=> true
```

```continue
sourceInvocation.programArguments[1]
=> /x/scan-uploader.json
```

```continue
sourceInvocation.workingDirectory === repoRootG
=> true
```

```continue
JSON.stringify(sourceInvocation.environmentVariables)
=> {"PATH":"/usr/local/bin:/usr/bin:/bin"}
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
    execPath: "/usr/local/bin/node",
    entryPath: "/path/to/scan-uploader.mjs",
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
    execPath: "/usr/local/bin/node",
    entryPath: "/path/to/scan-uploader.mjs",
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
  execPath: "/usr/local/bin/node",
  entryPath: "/path/to/scan-uploader.mjs",
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
=> ["bootout","gui/501/org.beebox.scan-uploader"]
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

The written plist has exactly bundle mode's shape: no `WorkingDirectory`,
no `EnvironmentVariables`:

```continue
writtenPlist.includes("WorkingDirectory")
=> false
```

```continue
writtenPlist.includes("EnvironmentVariables")
=> false
```

## `install` in SOURCE mode — the plist runs through the repo-root wrapper

Same flow, but `entryPath` ends in `.ts` (as it does when launched via
`bin/scan-uploader`, which execs tsx against `src/cli.ts`) and a
`bin/scan-uploader` wrapper exists at the derived repo root. The written
plist's `ProgramArguments` is `[wrapperPath, configPath]` — no `node`/tsx
in sight, since the wrapper resolves that itself — plus `WorkingDirectory`
and a `PATH` env so launchd's own bare-bones default `PATH` (which has no
`node` on it) doesn't sink the wrapper's `exec "$TSX" …`.

```
const repoRootH = join(dir, "repoH");
const entryPathH = join(repoRootH, "scan-uploader", "src", "cli.ts");
await mkdir(join(repoRootH, "bin"), { recursive: true });
await writeFile(join(repoRootH, "bin", "scan-uploader"), "#!/usr/bin/env bash\n");
const homeDirH = join(dir, "homeH");
const configPathH = join(dir, "install-source", "scan-uploader.json");
await writeValidConfig(configPathH);
const runnerH = new FakeLaunchctlRunner();
const installResultH = await installSchedule({
  homeDir: homeDirH,
  uid: 501,
  runner: runnerH,
  configPath: configPathH,
  execPath: "/usr/local/bin/node",
  entryPath: entryPathH,
  intervalMinutes: 15,
});
const writtenPlistH = await readFile(installResultH.plistPath, "utf-8");
writtenPlistH.includes(`<string>${join(repoRootH, "bin", "scan-uploader")}</string>`)
=> true
```

```continue
writtenPlistH.includes(`<string>${configPathH}</string>`)
=> true
```

`node` (or a bare `node`/tsx invocation) never appears as a
`ProgramArguments` entry in source mode — only the wrapper and the config
path:

```continue
writtenPlistH.includes("/usr/local/bin/node</string>")
=> false
```

```continue
writtenPlistH.includes(`<key>WorkingDirectory</key>\n\t<string>${repoRootH}</string>`)
=> true
```

```continue
writtenPlistH.includes(
  "<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>PATH</key>\n\t\t<string>/usr/local/bin:/usr/bin:/bin</string>",
)
=> true
```

Missing the wrapper entirely is refused before anything is written — no
partial/wrong plist:

```continue
const repoRootI = join(dir, "repoI-no-wrapper");
const entryPathI = join(repoRootI, "scan-uploader", "src", "cli.ts");
const homeDirI = join(dir, "homeI");
const configPathI = join(dir, "install-source-no-wrapper", "scan-uploader.json");
await writeValidConfig(configPathI);
const noWrapperFailure = await rejected(
  installSchedule({
    homeDir: homeDirI,
    uid: 501,
    runner: new FakeLaunchctlRunner(),
    configPath: configPathI,
    execPath: "/usr/local/bin/node",
    entryPath: entryPathI,
    intervalMinutes: 15,
  }),
);
noWrapperFailure.name
=> ScheduleError
```

```continue
const plistExistsI = await readFile(plistPath(homeDirI), "utf-8").then(() => true, () => false);
plistExistsI
=> false
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
    execPath: "/usr/local/bin/node",
    entryPath: "/path/to/scan-uploader.mjs",
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
  execPath: "/usr/local/bin/node",
  entryPath: "/path/to/scan-uploader.mjs",
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
=> [["print","gui/501/org.beebox.scan-uploader"]]
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
  execPath: "/usr/local/bin/node",
  entryPath: "/path/to/scan-uploader.mjs",
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
=> [["bootout","gui/501/org.beebox.scan-uploader"]]
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
=> [["bootout","gui/501/org.beebox.scan-uploader"]]
```

```continue
LABEL
=> org.beebox.scan-uploader
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
  execPath: "/usr/local/bin/node",
  entryPath: "/path/to/scan-uploader.mjs",
  intervalMinutes: 15,
});
const writtenPlistF = await readFile(installResultF.plistPath, "utf-8");
writtenPlistF.includes(`<string>${resolvedConfigPathF}</string>`)
=> true
```

```cleanup
await removeTmpDir(dir);
```
