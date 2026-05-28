/**
 * Typed wrapper around `bin/browse` for tour-lib. One BrowseSession per
 * viewport. We use `--session <name>` so each viewport has its own
 * isolated Chrome context with a sticky viewport — no resizing between
 * checkpoints, no cookie/state leakage.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tour-lib/ → tours/ → test/ → callback-box/ → monorepo root (bin/browse lives here).
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BROWSE_BIN = path.join(REPO_ROOT, "bin/browse");

interface RunResult {
  stdout: string;
  stderr: string;
}

export class BrowseError extends Error {
  readonly args: readonly string[];
  readonly stderr: string;
  readonly stdout: string;
  constructor({ args, stderr, stdout, code }: { args: readonly string[]; stderr: string; stdout: string; code: number | null }) {
    super(`bin/browse ${args.join(" ")} exited ${code}: ${(stderr || stdout).trim().split("\n").slice(-3).join("\n")}`);
    this.name = "BrowseError";
    this.args = args;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

export class BrowseSession {
  readonly session: string;

  constructor(session: string) {
    this.session = session;
  }

  // agent-browser's `--session <name>` launches a second Chrome with the
  // same profile, which fails on the SingletonLock our per-worktree
  // bin/browse daemon already holds. Until we have per-session profile
  // dirs, all tour work happens in the default browse session — meaning
  // tours and interactive bin/browse share one Chrome window.
  private spawnArgs(rest: readonly string[]): string[] {
    return [...rest];
  }

  async run(args: readonly string[], stdinInput?: string): Promise<RunResult> {
    const fullArgs = this.spawnArgs(args);
    return new Promise((resolve, reject) => {
      const child = spawn(BROWSE_BIN, fullArgs, {
        stdio: [stdinInput !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      child.on("error", (e) => reject(e));
      child.on("close", (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new BrowseError({ args: fullArgs, stderr, stdout, code }));
      });
      if (stdinInput !== undefined) {
        child.stdin?.end(stdinInput);
      }
    });
  }

  async open(url: string, opts?: { noWait?: boolean }): Promise<void> {
    const args = opts?.noWait === true ? ["--no-wait", "open", url] : ["open", url];
    await this.run(args);
  }

  async snapshot(opts?: { interactiveOnly?: boolean }): Promise<string> {
    const args = ["snapshot"];
    if (opts?.interactiveOnly) args.push("-i");
    const { stdout } = await this.run(args);
    return stdout;
  }

  async screenshot(filePath: string): Promise<void> {
    await this.run(["screenshot", filePath]);
  }

  async eval(expression: string): Promise<string> {
    const b64 = Buffer.from(expression).toString("base64");
    const { stdout } = await this.run(["eval", "-b", b64]);
    return stdout;
  }

  /** For very long JS payloads (e.g. injecting axe-core source). */
  async evalStdin(source: string): Promise<string> {
    const { stdout } = await this.run(["eval", "--stdin"], source);
    return stdout;
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.run(["set", "viewport", String(width), String(height)]);
  }

  async waitForReady(): Promise<void> {
    // Belt-and-suspenders: bin/browse auto-waits on `open`, but explicit waits
    // before reads catch the case where DOM is updated by SSE/mutations
    // after the page first settles.
    await this.run(["wait", "--fn", "document.body.dataset.cbLoading === 'false'"]).catch(() => {
      // Non-fatal — proceed even if the readiness wait times out.
    });
  }

  async findRef(role: string, name: string): Promise<string | null> {
    // Use agent-browser's `find` subcommand to resolve a locator into a ref.
    // We dispatch a `click` indirectly by selecting first, but for refs we
    // need the snapshot. Simpler: read the interactive snapshot, scan for
    // `<role> "<name>" [ref=eN]`.
    const snap = await this.snapshot({ interactiveOnly: true });
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${role}\\s+"${escaped}"\\s+\\[(?:[^\\]]*?,\\s*)?ref=(e\\d+)`);
    const m = snap.match(re);
    return m && m[1] ? m[1] : null;
  }

  async clickRef(ref: string): Promise<void> {
    await this.run(["click", `@${ref}`]);
  }

  async getUrl(): Promise<string> {
    const { stdout } = await this.run(["get", "url"]);
    return stdout.trim();
  }

  async getTitle(): Promise<string> {
    const { stdout } = await this.run(["get", "title"]);
    return stdout.trim();
  }

  async close(): Promise<void> {
    await this.run(["close"]).catch(() => {
      // Closing an already-closed session is fine.
    });
  }
}
