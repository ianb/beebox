/**
 * The weekly tour check: hand a session the evidence it needs to decide whether
 * a tour that misses is drift or new truth.
 *
 * This script judges nothing. It cannot: the whole question — did the app change
 * on purpose, so the tour is now the wrong description of it? — is answered by
 * looking at screenshots and at what landed, and neither is a comparison a
 * script can make. So `run` does three mechanical things and hands off:
 *
 * 1. Confirms the dev router is answering. Tours drive the running app through
 *    it; with the router down there is nothing to walk, and the boxholder is
 *    the only one who may start it (it is shared — see the root CLAUDE.md). That
 *    is a complete finding on its own, so it alerts rather than handing off.
 * 2. Lists what landed on `main` in the last two cadences, restricted to the
 *    paths a tour walks. Those landings are the session's evidence of
 *    DELIBERATE change — the difference between "the tour is stale" and "the
 *    app broke". Two cadences rather than "since the last check" so a week
 *    whose session bailed or could not run does not lose its evidence; there
 *    is no baseline to record, because there is nothing the SCRIPT has to
 *    remember — the session confirms the specific change with `git log -S`.
 * 3. Lists the tours, by asking `bin/tour --list` rather than globbing, so a
 *    tour file that no longer loads fails here instead of being silently absent
 *    from the walk.
 *
 * It hands off EVERY week: a tour rots from things no diff names (box content,
 * a dependency, the browser), and the artifacts exist only if the tours are
 * actually walked. A schedule the docs call weekly has to be weekly.
 *
 * SCHEDULE_DRY_RUN: this script writes nothing itself; `bin/schedules handoff`
 * honors the variable on its own.
 */

import * as path from "node:path";
import { homedir } from "node:os";
import { request as httpRequest } from "node:http";
import { execa } from "execa";

const SCHEDULE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCHEDULE_DIR, "..", "..");

/**
 * The paths whose landings are evidence a tour's description is out of date:
 * the UI the tours walk, the server that renders it, and the tours themselves.
 * A landing outside them can still break a tour — that is what walking every
 * tour every week is for — but it is not evidence the change was deliberate.
 */
const TOUR_PATHS = [
  "beebox/src/frontend",
  "beebox/src/webapp",
  "beebox/test/tours",
] as const;

function refuse(message: string): never {
  process.stderr.write(`tour-check: ${message}\n`);
  process.exit(2);
}

async function git(args: string[]): Promise<string> {
  const result = await execa("git", args, { cwd: REPO_ROOT, reject: false });
  if (result.exitCode !== 0) refuse(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * The router's unix socket — the same one `bin/smoke` drives. A request arriving
 * there is `trustedLocal`, so it needs no credential; over TCP the same endpoint
 * answers 401 without one, which proves the router is up but muddies "answering"
 * with "authorized". Asking the socket keeps the check to one meaning.
 */
function routerSocket(): string {
  const stateDir = process.env["BBX_STATE_DIR"] ?? path.join(homedir(), ".cache", "beebox");
  return path.join(stateDir, "router.sock");
}

/** Whether the router answers `/__router/status`, with the reason when it does not. */
function routerStatus(timeoutMs: number): Promise<{ up: true } | { up: false; reason: string }> {
  return new Promise((resolve) => {
    const socketPath = routerSocket();
    const done = (result: { up: true } | { up: false; reason: string }): void => {
      resolve(result);
    };
    const req = httpRequest({ socketPath, path: "/__router/status", method: "GET", timeout: timeoutMs }, (response) => {
      response.resume();
      const status = response.statusCode ?? 0;
      response.on("end", () => {
        done(status === 200 ? { up: true } : { up: false, reason: `answered ${String(status)} on its socket (${socketPath})` });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      done({ up: false, reason: `${socketPath}: no answer within ${String(timeoutMs)}ms` });
    });
    req.on("error", (e) => {
      done({ up: false, reason: `${socketPath}: ${e.message}` });
    });
    req.end();
  });
}

const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
/** Two cadences (`cadence: 7d` in schedule.yaml), so one lost week keeps its evidence. */
const WINDOW = "14 days";
const runId = process.env["SCHEDULE_RUN_ID"] ?? "(unknown)";
const schedulesCli = path.join(REPO_ROOT, "bin", "schedules");

const router = await routerStatus(5_000);
if (!router.up) {
  // Not a refusal: the watch is fine, the app is simply not being served. The
  // boxholder starts the router; nothing here can, and a worktree session must
  // not (`pnpm dev` is shared). Next week's window still covers this week's
  // landings.
  await execa(
    schedulesCli,
    [
      "alert",
      "--priority",
      "important",
      "--title",
      "tours not checked: dev router is down",
      "--message",
      `The tours walk the running app through the shared dev router, and it is not answering (${router.reason}).` +
        " Nothing was checked this week. Start it with `pnpm dev` in the main checkout and the next run will catch up.",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  process.exit(0);
}

const head = await git(["rev-parse", "main"]);

/** `git log --first-parent --oneline` over the window, restricted to paths. */
async function landingsInWindow(paths: readonly string[]): Promise<string[]> {
  const output = await git(["log", "--first-parent", "--oneline", `--since=${WINDOW}`, "main", "--", ...paths]);
  return output.split("\n").filter((line) => line !== "");
}

const landings = await landingsInWindow(TOUR_PATHS);

const tourList = await execa(path.join(REPO_ROOT, "bin", "tour"), ["--list"], { cwd: REPO_ROOT, reject: false, all: true });
if (tourList.exitCode !== 0) {
  // The tour files cannot even be loaded — a broken import or a syntax error.
  // That is the run breaking, not a finding about the app.
  refuse(`bin/tour --list exited ${String(tourList.exitCode)}:\n${tourList.all ?? ""}`);
}

const body = [
  `# Landings on \`main\` in the last ${WINDOW}`,
  "",
  ...(landings.length === 0
    ? [
        `Nothing landed under ${TOUR_PATHS.join(", ")} in the last ${WINDOW}.`,
        "So a tour that misses this week has no deliberate change behind it on these paths —",
        "unless a plan or an issue explains it; check before filing.",
      ]
    : [
        `Under ${TOUR_PATHS.join(", ")}:`,
        "",
        "```",
        ...landings,
        "```",
        "",
        "These are the deliberate changes. A miss one of them explains is the tour being out of date;",
        "a miss none of them explains is a finding.",
      ]),
  "",
  "# Tours",
  "",
  "```",
  (tourList.all ?? "").trim(),
  "```",
  "",
  `Scheduled run \`${runId}\`. HEAD of \`main\` is \`${head}\`.`,
  "",
].join("\n");

if (dryRun) {
  console.log("[tour-check] dry run: the handoff below is printed, not recorded.");
}
await execa(
  schedulesCli,
  [
    "handoff",
    "--title",
    `Tour check: ${String(landings.length)} landing${landings.length === 1 ? "" : "s"} on tour-walked paths in ${WINDOW}`,
    "--body",
    "-",
  ],
  { input: body, stdout: "inherit", stderr: "inherit" },
);
