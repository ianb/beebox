/**
 * GitHub activity watch: list what people other than the repo owner did on
 * the public repo since the last run, and alert only when there is something.
 *
 * The developer does not reliably read GitHub notifications. Today the repo is
 * quiet, so most runs exit 0 in silence; the watch exists for the day it is
 * not.
 *
 * Reported (each since the last successful run, owner's own activity left out):
 * - issues and pull requests opened,
 * - comments on issues and pull requests, and pull request review comments,
 * - forks,
 * - stars (on their own an `fyi`; with anything else, listed in the alert).
 * Discussions are disabled on the repo; if they are ever enabled, this script
 * says so instead of silently missing them.
 *
 * The text it reports (titles) is written by strangers. It is shortened and
 * stripped of Markdown syntax before it enters an alert, and no agent reads it.
 *
 * Baseline: `$SCHEDULE_STATE_DIR/last-checked.json` holds the start time of the
 * last successful run, so each item is news once. A first run looks back
 * FIRST_RUN_LOOKBACK_DAYS so activity the developer already missed is caught.
 * A failed GitHub query leaves the baseline alone and skips the run; once the
 * baseline is STALE_DAYS old the watch cannot watch, and it exits non-zero.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";

const SCHEDULE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCHEDULE_DIR, "..", "..");
const SCHEDULES_CLI = path.join(REPO_ROOT, "bin", "schedules");

const FIRST_RUN_LOOKBACK_DAYS = 30;
const STALE_DAYS = 7;
const DAY_MS = 86_400_000;
const TITLE_MAX = 100;

const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
const stateDir = process.env["SCHEDULE_STATE_DIR"];
if (stateDir === undefined || stateDir === "") {
  process.stderr.write("github-activity: SCHEDULE_STATE_DIR is not set; run it through bin/schedules\n");
  process.exit(2);
}
const baselineFile = path.join(stateDir, "last-checked.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function login(record: Record<string, unknown>, key: string): string {
  const user = record[key];
  return isRecord(user) ? str(user, "login") : "";
}

/** Strangers' text, made inert for a Markdown alert: one line, no Markdown
 *  syntax characters, bounded length. */
function inert(text: string): string {
  const flat = text.replace(/[\r\n\t]+/gu, " ").replace(/[`*_[\]<>#|\\~]/gu, "").trim();
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
}

class GithubQueryError extends Error {
  readonly query: string;
  readonly detail: string;
  constructor(query: string, detail: string) {
    super("a GitHub query failed");
    this.name = "GithubQueryError";
    this.query = query;
    this.detail = detail;
  }
}

/** One paginated REST query, flattened. `gh api --paginate --slurp` returns
 *  an array of pages. */
async function ghList(endpoint: string, accept?: string): Promise<Record<string, unknown>[]> {
  const args = ["api", "--paginate", "--slurp", endpoint];
  if (accept !== undefined) args.push("-H", `Accept: ${accept}`);
  const result = await execa("gh", args, { cwd: REPO_ROOT, reject: false });
  if (result.exitCode !== 0) throw new GithubQueryError(endpoint, result.stderr.trim());
  // Parse boundary: GitHub's JSON arrives untyped; non-record items are dropped.
  const pages: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(pages)) throw new GithubQueryError(endpoint, "expected an array of pages");
  return pages.flatMap((page: unknown) => (Array.isArray(page) ? page.filter(isRecord) : []));
}

async function ghObject(endpoint: string): Promise<Record<string, unknown>> {
  const result = await execa("gh", ["api", endpoint], { cwd: REPO_ROOT, reject: false });
  if (result.exitCode !== 0) throw new GithubQueryError(endpoint, result.stderr.trim());
  const parsed: unknown = JSON.parse(result.stdout);
  if (!isRecord(parsed)) throw new GithubQueryError(endpoint, "expected an object");
  return parsed;
}

/** The repo is whatever `origin` points at, so a fork of this checkout watches
 *  its own repo. */
const REPO_VIEW_QUERY = "(gh repo view)";

async function repoSlug(): Promise<string> {
  const result = await execa("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd: REPO_ROOT, reject: false });
  if (result.exitCode !== 0 || result.stdout.trim() === "") throw new GithubQueryError(REPO_VIEW_QUERY, result.stderr.trim());
  return result.stdout.trim();
}

function readBaseline(): Date | null {
  if (!fs.existsSync(baselineFile)) return null;
  const parsed: unknown = JSON.parse(fs.readFileSync(baselineFile, "utf-8"));
  const since = isRecord(parsed) ? parsed["since"] : undefined;
  if (typeof since !== "string" || Number.isNaN(Date.parse(since))) {
    process.stderr.write(`github-activity: ${baselineFile} has no valid "since"; fix or delete it\n`);
    process.exit(2);
  }
  return new Date(since);
}

function writeBaseline(since: Date): void {
  if (dryRun) return;
  fs.mkdirSync(stateDir ?? "", { recursive: true });
  const tmp = `${baselineFile}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ since: since.toISOString() })}\n`);
  fs.renameSync(tmp, baselineFile);
}

interface Activity {
  opened: string[];
  comments: string[];
  forks: string[];
  stars: string[];
  notes: string[];
}

async function gather(slug: string, window: { owner: string; since: Date }): Promise<Activity> {
  const { owner, since } = window;
  const iso = since.toISOString();
  const after = (stamp: string): boolean => Date.parse(stamp) > since.getTime();
  const notOwner = (who: string): boolean => who !== "" && who !== owner;

  const issues = await ghList(`repos/${slug}/issues?state=all&since=${iso}&per_page=100`);
  const opened = issues
    .filter((issue) => after(str(issue, "created_at")) && notOwner(login(issue, "user")))
    .map((issue) => {
      const kind = isRecord(issue["pull_request"]) ? "PR" : "Issue";
      return `${kind} by ${login(issue, "user")}: ${inert(str(issue, "title"))} (${str(issue, "html_url")})`;
    });

  const issueComments = await ghList(`repos/${slug}/issues/comments?since=${iso}&per_page=100`);
  const reviewComments = await ghList(`repos/${slug}/pulls/comments?since=${iso}&per_page=100`);
  const comments = [...issueComments, ...reviewComments]
    .filter((comment) => after(str(comment, "created_at")) && notOwner(login(comment, "user")))
    .map((comment) => `Comment by ${login(comment, "user")}: ${str(comment, "html_url")}`);

  const forkList = await ghList(`repos/${slug}/forks?sort=newest&per_page=100`);
  const forks = forkList
    .filter((fork) => after(str(fork, "created_at")))
    .map((fork) => `Fork by ${login(fork, "owner")}: ${str(fork, "html_url")}`);

  const stargazers = await ghList(`repos/${slug}/stargazers?per_page=100`, "application/vnd.github.star+json");
  const stars = stargazers
    .filter((star) => after(str(star, "starred_at")))
    .map((star) => login(star, "user"))
    .filter(notOwner);

  const notes: string[] = [];
  const repo = await ghObject(`repos/${slug}`);
  if (repo["has_discussions"] === true) notes.push("Discussions are now enabled on the repo, and this watch does not read them yet.");

  return { opened, comments, forks, stars, notes };
}

async function alert(report: { priority: "normal" | "fyi"; title: string; message: string }): Promise<void> {
  const { priority, title, message } = report;
  if (dryRun) {
    console.log(`[github-activity] would alert (${priority}): ${title}`);
    console.log(message);
    return;
  }
  await execa(SCHEDULES_CLI, ["alert", "--priority", priority, "--title", title, "--message", message], { stdio: "inherit" });
}

const startedAt = new Date();
const baseline = readBaseline();
const since = baseline ?? new Date(startedAt.getTime() - FIRST_RUN_LOOKBACK_DAYS * DAY_MS);

let activity: Activity;
let slug: string;
try {
  slug = await repoSlug();
  const owner = slug.split("/")[0] ?? "";
  activity = await gather(slug, { owner, since });
} catch (error) {
  if (!(error instanceof GithubQueryError)) throw error;
  const ageDays = baseline === null ? 0 : (startedAt.getTime() - baseline.getTime()) / DAY_MS;
  if (ageDays > STALE_DAYS) {
    process.stderr.write(`github-activity: no successful check in ${String(Math.floor(ageDays))} days; last error: ${error.query}: ${error.detail}\n`);
    process.exit(1);
  }
  console.log(`github-activity: skipping this run; ${error.query}: ${error.detail}`);
  process.exit(0);
}

const sections: [string, string[]][] = [
  ["Opened", activity.opened],
  ["Comments", activity.comments],
  ["Forks", activity.forks],
  ["Stars", activity.stars.length === 0 ? [] : [activity.stars.join(", ")]],
  ["Watch notes", activity.notes],
];
const body = sections
  .filter(([, lines]) => lines.length > 0)
  .map(([heading, lines]) => `**${heading}**\n${lines.map((line) => `- ${line}`).join("\n")}`)
  .join("\n\n");
const sinceText = since.toISOString().slice(0, 10);
const substantive = activity.opened.length + activity.comments.length + activity.forks.length + activity.notes.length;

if (substantive > 0) {
  const counts = [
    activity.opened.length > 0 ? `${String(activity.opened.length)} opened` : "",
    activity.comments.length > 0 ? `${String(activity.comments.length)} comment(s)` : "",
    activity.forks.length > 0 ? `${String(activity.forks.length)} fork(s)` : "",
  ].filter((part) => part !== "").join(", ");
  await alert({ priority: "normal", title: `GitHub activity on ${slug}: ${counts === "" ? "watch notes" : counts}`, message: `Activity by other people since ${sinceText}.\n\n${body}` });
} else if (activity.stars.length > 0) {
  await alert({ priority: "fyi", title: `${String(activity.stars.length)} new star(s) on ${slug}`, message: `Since ${sinceText}.\n\n${body}` });
} else if (baseline === null) {
  await alert({ priority: "fyi", title: `GitHub activity watch started for ${slug}`, message: `No activity by other people in the last ${String(FIRST_RUN_LOOKBACK_DAYS)} days. From now on this watch reports only when something happens.` });
}

writeBaseline(startedAt);
