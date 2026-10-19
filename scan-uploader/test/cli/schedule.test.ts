// # The `schedule` subcommand's core logic
//
// Exercises `schedule.ts` directly — `process.platform`/`argv`/`getuid` and
// the real `launchctl` process spawn live in `src/cli/schedule-cli.ts` /
// `src/cli/launchctl.ts` and aren't exercised here. `launchctl` is faked
// (`FakeLaunchctlRunner` below, defined in this file — it records every
// invocation so tests can assert on it) so no test here ever spawns a real
// process or touches a real LaunchAgent.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
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
  plistPath,
  type LaunchctlResult,
  type LaunchctlRunner,
} from "../../src/cli/schedule.js";
import { parseIntervalMinutes } from "../../src/cli/schedule-cli.js";
import { homeConfigPath, resolveConfigPath } from "../../src/cli/config-path.js";
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

/** The plist `installSchedule` writes for the valid config above: its one target's folder is watched. */
function installedPlist(params: { programArguments: string[]; workingDirectory?: string; homeDir: string; intervalSeconds: number }): string {
  const strings = (values: string[]) => values.map((value) => `\t\t<string>${value}</string>\n`).join("");
  const workingDirectory = params.workingDirectory === undefined ? "" : `\t<key>WorkingDirectory</key>\n\t<string>${params.workingDirectory}</string>\n`;
  const log = `${params.homeDir}/Library/Logs/scan-uploader.log`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>org.beebox.scan-uploader</string>
\t<key>ProgramArguments</key>
\t<array>
${strings(params.programArguments)}\t</array>
${workingDirectory}\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>/usr/local/bin:${params.homeDir}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
\t</dict>
\t<key>StartInterval</key>
\t<integer>${String(params.intervalSeconds)}</integer>
\t<key>WatchPaths</key>
\t<array>
\t\t<string>/scans/family</string>
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${log}</string>
\t<key>StandardErrorPath</key>
\t<string>${log}</string>
</dict>
</plist>
`;
}

// ## Plist generation — exact XML, entity-escaped paths, interval math
//
// A path with a space and an ampersand must come out entity-escaped (`&amp;`)
// so the plist stays valid XML; `RunAtLoad` is always `true`; `StartInterval`
// is exactly `intervalSeconds` as given (the minutes→seconds multiplication
// happens in `installSchedule`, not here). No `workingDirectory`/
// `environmentVariables` given — this is bundle mode's shape, where
// `ProgramArguments` alone is enough (no `WorkingDirectory`/
// `EnvironmentVariables` keys at all):
void test("A path with a space and an ampersand must come out entity-escaped (&amp;) so...", async (t) => {
  const plist = generatePlist({
    programArguments: ["/usr/local/bin/node", "/Users/A B & C/scan-uploader.mjs", "/Users/A B & C/scan-uploader.json"],
    intervalSeconds: 900,
    logPath: "/Users/A B & C/scan-uploader.log",
  });
  t.check(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>org.beebox.scan-uploader</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/local/bin/node</string>
		<string>/Users/A B &amp; C/scan-uploader.mjs</string>
		<string>/Users/A B &amp; C/scan-uploader.json</string>
	</array>
	<key>StartInterval</key>
	<integer>900</integer>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/Users/A B &amp; C/scan-uploader.log</string>
	<key>StandardErrorPath</key>
	<string>/Users/A B &amp; C/scan-uploader.log</string>
</dict>
</plist>
`);

  // `parseIntervalSeconds` reads `StartInterval` back out of exactly that
  // output — round-tripping what `generatePlist` wrote:

  t.check(parseIntervalSeconds(plist), 900);
});

// Source mode's shape adds `WorkingDirectory` and an `EnvironmentVariables`
// dict — both entity-escaped the same as any other string value:
void test("Source mode's shape adds WorkingDirectory and an EnvironmentVariables dict —...", async (t) => {
  const sourcePlist = generatePlist({
    programArguments: ["/repo/bin/scan-uploader", "/Users/A B & C/scan-uploader.json"],
    workingDirectory: "/repo root & co",
    environmentVariables: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    intervalSeconds: 900,
    logPath: "/Users/A B & C/scan-uploader.log",
  });
  t.check(sourcePlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>org.beebox.scan-uploader</string>
	<key>ProgramArguments</key>
	<array>
		<string>/repo/bin/scan-uploader</string>
		<string>/Users/A B &amp; C/scan-uploader.json</string>
	</array>
	<key>WorkingDirectory</key>
	<string>/repo root &amp; co</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>/usr/local/bin:/usr/bin:/bin</string>
	</dict>
	<key>StartInterval</key>
	<integer>900</integer>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/Users/A B &amp; C/scan-uploader.log</string>
	<key>StandardErrorPath</key>
	<string>/Users/A B &amp; C/scan-uploader.log</string>
</dict>
</plist>
`);

  t.check(parseIntervalSeconds(sourcePlist), 900);
});

// `watchPaths` adds a `WatchPaths` array, so launchd fires a sweep the moment a
// scan folder changes rather than waiting out the interval. The interval stays —
// the two triggers are complementary, and the check endpoint's dedup makes a
// double-fire harmless:
void test("watchPaths adds a WatchPaths array, so launchd fires a sweep the moment a sca...", async (t) => {
  const watchPlist = generatePlist({
    programArguments: ["/repo/bin/scan-uploader", "/config.json"],
    intervalSeconds: 900,
    watchPaths: ["/Users/A B & C/Receipts/", "/Users/A B & C/Invoices/"],
    logPath: "/log",
  });
  t.check(watchPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>org.beebox.scan-uploader</string>
	<key>ProgramArguments</key>
	<array>
		<string>/repo/bin/scan-uploader</string>
		<string>/config.json</string>
	</array>
	<key>StartInterval</key>
	<integer>900</integer>
	<key>WatchPaths</key>
	<array>
		<string>/Users/A B &amp; C/Receipts/</string>
		<string>/Users/A B &amp; C/Invoices/</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/log</string>
	<key>StandardErrorPath</key>
	<string>/log</string>
</dict>
</plist>
`);

  // An absent or empty list omits the key entirely, which is what keeps a
  // schedule with no watched folders byte-identical to the plists above:

  const plainPlist = generatePlist({ programArguments: ["/x"], intervalSeconds: 900, logPath: "/log" });
  t.check(plainPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>org.beebox.scan-uploader</string>
	<key>ProgramArguments</key>
	<array>
		<string>/x</string>
	</array>
	<key>StartInterval</key>
	<integer>900</integer>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/log</string>
	<key>StandardErrorPath</key>
	<string>/log</string>
</dict>
</plist>
`);

  t.check(generatePlist({ programArguments: ["/x"], intervalSeconds: 900, watchPaths: [], logPath: "/log" }), plainPlist);
});

// ## `detectRunMode` — the `.ts` vs `.mjs` suffix check
void test("`detectRunMode` — the `.ts` vs `.mjs` suffix check", async (t) => {
  t.check(detectRunMode("/repo/scan-uploader/src/cli/main.ts"), "source");

  t.check(detectRunMode("/path/to/scan-uploader.mjs"), "bundle");

  t.check(detectRunMode("/Users/A B & C/scan-uploader.mjs"), "bundle");
});

// ## `resolveLaunchdInvocation` — bundle and source modes carry tool paths
//
// Bundle mode: `[execPath, entryPath, configPath]` and a PATH for Node plus
// user-installed command line tools.
void test("Bundle mode:", async (t) => {
  const bundleInvocation = await resolveLaunchdInvocation({
    entryPath: "/path/to/scan-uploader.mjs",
    execPath: "/usr/local/bin/node",
    configPath: "/path/to/scan-uploader.json",
    homeDir: join(dir, "home-test"),
  });
  t.check(bundleInvocation, {
    programArguments: [
      "/usr/local/bin/node",
      "/path/to/scan-uploader.mjs",
      "/path/to/scan-uploader.json",
    ],
    environmentVariables: {
      PATH: `/usr/local/bin:${dir}/home-test/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    },
  });

  // Source mode derives the repo root from `entryPath` (`<repoRoot>/scan-uploader/src/cli/main.ts`) and requires `<repoRoot>/bin/scan-uploader` to actually exist:

  const repoRootG = join(dir, "repoG");
  const entryPathG = join(repoRootG, "scan-uploader", "src", "cli", "main.ts");
  const missingWrapper = await rejected(
    resolveLaunchdInvocation({ entryPath: entryPathG, execPath: "/usr/local/bin/node", configPath: "/x/scan-uploader.json", homeDir: join(dir, "home-test") }),
  );
  t.check(missingWrapper, {
    name: "ScheduleError",
    message: `expected the repo-root wrapper at ${dir}/repoG/bin/scan-uploader (derived from ${dir}/repoG/scan-uploader/src/cli/main.ts), but it does not exist — source-mode scheduling only works from a full monorepo checkout`,
  });

  // Once the wrapper exists, source mode resolves to
  // `[wrapperPath, configPath]`, `workingDirectory` = the repo root, and a
  // `PATH` env built from `dirname(execPath)`:

  await mkdir(join(repoRootG, "bin"), { recursive: true });
  await writeFile(join(repoRootG, "bin", "scan-uploader"), "#!/usr/bin/env bash\n");
  const sourceInvocation = await resolveLaunchdInvocation({
    entryPath: entryPathG,
    execPath: "/usr/local/bin/node",
    configPath: "/x/scan-uploader.json",
    homeDir: join(dir, "home-test"),
  });
  t.check(sourceInvocation, {
    programArguments: [
      `${dir}/repoG/bin/scan-uploader`,
      "/x/scan-uploader.json",
    ],
    workingDirectory: `${dir}/repoG`,
    environmentVariables: {
      PATH: `/usr/local/bin:${dir}/home-test/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    },
  });
});

// ## `parseIntervalMinutes` — positive-integer validation, default 15
void test("`parseIntervalMinutes` — positive-integer validation, default 15", async (t) => {
  t.check(parseIntervalMinutes(undefined), 15);

  t.check(DEFAULT_INTERVAL_MINUTES, 15);

  t.check(parseIntervalMinutes("30"), 30);

  const zero = await syncRejected(() => parseIntervalMinutes("0"));
  t.check(zero, {
    name: "ScheduleError",
    message: "--interval must be a positive integer number of minutes (got \"0\")",
  });

  const negative = await syncRejected(() => parseIntervalMinutes("-5"));
  t.check(negative, {
    name: "ScheduleError",
    message: "--interval must be a positive integer number of minutes (got \"-5\")",
  });

  const notANumber = await syncRejected(() => parseIntervalMinutes("soon"));
  t.check(notANumber, {
    name: "ScheduleError",
    message: "--interval must be a positive integer number of minutes (got \"soon\")",
  });
});

// ## Non-macOS is refused outright — same posture as the `trash` disposition
void test("Non-macOS is refused outright — same posture as the `trash` disposition", async (t) => {
  const nonDarwin = await syncRejected(() => requireDarwin("linux"));
  t.check(nonDarwin, {
    name: "ScheduleError",
    message: "scan-uploader schedule is only supported on macOS (this machine is \"linux\")",
  });

  const darwinOk = await syncRejected(() => requireDarwin("darwin"));
  t.check(darwinOk, {
    name: "(no error thrown)",
    message: "(no error thrown)",
  });
});

// ## `install` refuses when the config is missing or invalid — no plist written
void test("`install` refuses when the config is missing or invalid — no plist written", async (t) => {
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
  t.check(missingConfigFailure, {
    name: "ScheduleError",
    message: `refusing to install: config at ${dir}/missing-config/scan-uploader.json is missing or invalid: Invalid config at ${dir}/missing-config/scan-uploader.json: could not read file: ENOENT: no such file or directory, open '${dir}/missing-config/scan-uploader.json'`,
  });

  t.check(runnerA.calls, []);

  // An existing but invalid (unparseable) config is refused the same way:

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
  t.check(invalidConfigFailure, {
    name: "ScheduleError",
    message: str`refusing to install: config at ${invalidConfigPath} is missing or invalid: Invalid config at ${invalidConfigPath}: not valid JSON: ${any(String)}`,
  });

  t.check(runnerA.calls, []);
});

// ## `install` writes the plist, boots out (tolerating failure), then bootstraps
//
// `bootout` is expected to fail here (nothing loaded yet) — that failure is
// tolerated, not surfaced, and `bootstrap` still runs and determines success.
void test("bootout is expected to fail here (nothing loaded yet) — that failure is toler...", async (t) => {
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
  t.check(installResult, {
    plistPath: `${dir}/homeB/Library/LaunchAgents/org.beebox.scan-uploader.plist`,
    logPath: `${dir}/homeB/Library/Logs/scan-uploader.log`,
    intervalMinutes: 20,
  });

  // The plist landed on disk with the minutes converted to seconds:

  const writtenPlist = await readFile(installResult.plistPath, "utf-8");
  t.check(writtenPlist, installedPlist({ programArguments: ["/usr/local/bin/node", "/path/to/scan-uploader.mjs", configPathB], homeDir: homeDirB, intervalSeconds: 1200 }));

  // `bootout` then `bootstrap` were called, in that order, with the expected
  // targets (the plist path is a tmp-dir path, so it's compared separately by
  // equality rather than embedded in a literal expected string):

  t.check(runnerB.calls, [
    ["bootout", "gui/501/org.beebox.scan-uploader"],
    ["bootstrap", "gui/501", installResult.plistPath],
  ]);

  // The written plist has no `WorkingDirectory`; it sets PATH for optional
  // external tools:


});

// ## `install` in SOURCE mode — the plist runs through the repo-root wrapper
//
// Same flow, but `entryPath` ends in `.ts` (as it does when launched via
// `bin/scan-uploader`, which execs tsx against `src/cli/main.ts`) and a
// `bin/scan-uploader` wrapper exists at the derived repo root. The written
// plist's `ProgramArguments` is `[wrapperPath, configPath]` — no `node`/tsx
// in sight, since the wrapper resolves that itself — plus `WorkingDirectory`
// and a `PATH` env so launchd's own bare-bones default `PATH` (which has no
// `node` on it) doesn't sink the wrapper's `exec "$TSX" …`.
void test("Same flow, but entryPath ends in .ts (as it does when launched via bin/scan-u...", async (t) => {
  const repoRootH = join(dir, "repoH");
  const entryPathH = join(repoRootH, "scan-uploader", "src", "cli", "main.ts");
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
  t.check(writtenPlistH, installedPlist({ programArguments: [`${repoRootH}/bin/scan-uploader`, configPathH], workingDirectory: repoRootH, homeDir: homeDirH, intervalSeconds: 900 }));

  // Missing the wrapper entirely is refused before anything is written — no
  // partial/wrong plist:

  const repoRootI = join(dir, "repoI-no-wrapper");
  const entryPathI = join(repoRootI, "scan-uploader", "src", "cli", "main.ts");
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
  t.check(noWrapperFailure, {
    name: "ScheduleError",
    message: `expected the repo-root wrapper at ${dir}/repoI-no-wrapper/bin/scan-uploader (derived from ${dir}/repoI-no-wrapper/scan-uploader/src/cli/main.ts), but it does not exist — source-mode scheduling only works from a full monorepo checkout`,
  });

  const plistExistsI = await readFile(plistPath(homeDirI), "utf-8").then(() => true, () => false);
  t.check(plistExistsI, false);
});

// ## `install` surfaces a `bootstrap` failure — the plist is still on disk
void test("`install` surfaces a `bootstrap` failure — the plist is still on disk", async (t) => {
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
  t.check(bootstrapFailure, {
    name: "ScheduleError",
    message: `launchctl bootstrap failed (exit 1): service already loaded — the plist was written to ${dir}/homeC/Library/LaunchAgents/org.beebox.scan-uploader.plist but is not loaded; fix the issue and re-run install`,
  });

  // The plist was written before the failing `bootstrap` call — it's left in
  // place, not cleaned up, so the printed error's path is actually there to fix:

  const existsC = await readFile(plistPath(homeDirC), "utf-8").then(() => true, () => false);
  t.check(existsC, true);
});

// ## `status` — present/loaded/interval/log, all before anything is installed
void test("`status` — present/loaded/interval/log, all before anything is installed", async (t) => {
  const homeDirD = join(dir, "homeD");
  const runnerD = new FakeLaunchctlRunner({ print: { code: 1, stdout: "", stderr: "Could not find service" } });
  const statusBefore = await scheduleStatus({ homeDir: homeDirD, uid: 501, runner: runnerD });
  t.check(statusBefore, {
    plistPath: `${dir}/homeD/Library/LaunchAgents/org.beebox.scan-uploader.plist`,
    plistPresent: false,
    loaded: false,
    intervalMinutes: undefined,
    logPath: `${dir}/homeD/Library/Logs/scan-uploader.log`,
    logPresent: false,
    logModifiedAt: undefined,
  });

  // Install, then `status` reports present/loaded/interval read back from the
  // real plist on disk:

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
  t.check(statusAfter, {
    plistPath: `${dir}/homeD/Library/LaunchAgents/org.beebox.scan-uploader.plist`,
    plistPresent: true,
    loaded: true,
    intervalMinutes: 5,
    logPath: `${dir}/homeD/Library/Logs/scan-uploader.log`,
    logPresent: false,
    logModifiedAt: undefined,
  });
  t.check(runnerLoadedD.calls, [
    [
      "print",
      "gui/501/org.beebox.scan-uploader",
    ],
  ]);
});

// ## `uninstall` — bootout (tolerated whether loaded or not), removes the plist, idempotent
void test("`uninstall` — bootout (tolerated whether loaded or not), removes the plist, idempotent", async (t) => {
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
  t.check(uninstall1, {
    wasInstalled: true,
    plistPath: `${dir}/homeE/Library/LaunchAgents/org.beebox.scan-uploader.plist`,
  });

  const existsAfterUninstall1 = await readFile(plistPath(homeDirE), "utf-8").then(() => true, () => false);
  t.check(existsAfterUninstall1, false);

  t.check(runnerUninstall1.calls, [
    [
      "bootout",
      "gui/501/org.beebox.scan-uploader",
    ],
  ]);

  // A second `uninstall` is idempotent — reports "not installed", and still
  // attempts `bootout` (tolerating that it's not loaded) rather than erroring:

  const runnerUninstall2 = new FakeLaunchctlRunner({ bootout: { code: 1, stdout: "", stderr: "Could not find service" } });
  const uninstall2 = await uninstallSchedule({ homeDir: homeDirE, uid: 501, runner: runnerUninstall2 });
  t.check(uninstall2, {
    wasInstalled: false,
    plistPath: `${dir}/homeE/Library/LaunchAgents/org.beebox.scan-uploader.plist`,
  });

  t.check(runnerUninstall2.calls, [
    [
      "bootout",
      "gui/501/org.beebox.scan-uploader",
    ],
  ]);

  t.check(LABEL, "org.beebox.scan-uploader");
});

// ## `install` with no explicit `--config` embeds the resolved default's ABSOLUTE path
//
// Mirrors `schedule-cli.ts`'s actual wiring: resolve first via the same
// `resolveConfigPath` `configure` uses, then pass the result to
// `installSchedule` as an explicit `configPath` — `installSchedule` itself
// does no resolution of its own, so this proves the two modules compose
// correctly rather than re-testing resolution logic already covered in
// `config-path.test.ts`.
void test("Mirrors schedule-cli.ts's actual wiring:", async (t) => {
  t.teardown(async () => {
    try {
      await removeTmpDir(dir);
    } catch (error) {
      t.error(error);
    }
  });
  const homeDirF = join(dir, "homeF");
  const cwdDirF = join(dir, "cwdF");
  await mkdir(cwdDirF, { recursive: true });
  const resolvedConfigPathF = await resolveConfigPath({ cwd: cwdDirF, homeDir: homeDirF });
  t.check(resolvedConfigPathF, homeConfigPath(homeDirF));

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
  t.check(writtenPlistF, installedPlist({ programArguments: ["/usr/local/bin/node", "/path/to/scan-uploader.mjs", resolvedConfigPathF], homeDir: homeDirF, intervalSeconds: 900 }));
});
