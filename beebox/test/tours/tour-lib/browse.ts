/**
 * Typed wrapper around `bin/browse` for tour-lib. One BrowseSession per
 * viewport. We use `--session <name>` so each viewport has its own
 * isolated Chrome context with a sticky viewport — no resizing between
 * checkpoints, no cookie/state leakage.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { invariant } from "../../../src/lib/invariant.js";
import { escapeForRegex, snapshotRegex } from "./snapshot-regex.js";

const __dirname = import.meta.dirname;
// tour-lib/ → tours/ → test/ → beebox/ → monorepo root (bin/browse lives here).
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
      // `stdio` above pipes both, so these are non-null — but only this call
      // site knows that, and reading them optionally would silently discard the
      // output every caller here parses. Assert instead of narrowing away.
      invariant(child.stdout !== null && child.stderr !== null, "browse child has no pipes");
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

  /**
   * Returns false when the readiness wait timed out — the caller decides
   * whether to surface that (checkpoint captures record it as a finding so
   * a loading-state screenshot isn't silently reviewed as the real page).
   */
  async waitForReady(): Promise<boolean> {
    // Belt-and-suspenders: bin/browse auto-waits on `open`, but explicit waits
    // before reads catch the case where DOM is updated by SSE/mutations
    // after the page first settles.
    try {
      await this.run(["wait", "--fn", "document.body.dataset.bbxLoading === 'false'"]);
      return true;
    } catch (_e) {
      // Non-fatal — proceed even if the readiness wait times out.
      return false;
    }
  }

  /**
   * Resolve a locator into a ref by scanning the interactive snapshot for
   * `<role> "<name>" [ref=eN]`. A string `name` must match the accessible
   * name exactly; a RegExp is tested against it, which is how a tour avoids
   * baking box content into a locator (item counts, titles, filenames).
   */
  async findRef(role: string, name: string | RegExp): Promise<string | null> {
    const snap = await this.snapshot({ interactiveOnly: true });
    if (typeof name === "string") {
      const escaped = escapeForRegex(name);
      const re = snapshotRegex(`\\b${role}\\s+"${escaped}"\\s+\\[(?:[^\\]]*?,\\s*)?ref=(e\\d+)`);
      const m = snap.match(re);
      return m && m[1] ? m[1] : null;
    }
    const re = snapshotRegex(`\\b${role}\\s+"([^"]*)"\\s+\\[(?:[^\\]]*?,\\s*)?ref=(e\\d+)`, "g");
    for (const m of snap.matchAll(re)) {
      const accessibleName = m[1];
      const ref = m[2];
      if (accessibleName === undefined || ref === undefined) continue;
      // A caller's RegExp may carry /g; reset so the test isn't stateful.
      name.lastIndex = 0;
      if (name.test(accessibleName)) return ref;
    }
    return null;
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
