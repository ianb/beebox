/**
 * Claude CLI service — typed interface for Claude Code CLI auth operations.
 *
 * Real implementation shells out to `claude auth status/login/logout`.
 * Fake returns configurable status without spawning processes.
 */

import { spawn, execFile } from "node:child_process";

// ─── Service interface ───────────────────────────────────────────────────────

export interface ClaudeCliService {
  authStatus(): Promise<Record<string, unknown>>;
  authLogin(email?: string): Promise<{ authUrl: string | null; error?: string }>;
  authLogout(): Promise<{ success: boolean; error?: string }>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

export function createClaudeCliService(): ClaudeCliService {
  let activeLogin: { process: ReturnType<typeof spawn>; authUrl: string | null } | null = null;

  return {
    async authStatus() {
      return new Promise<Record<string, unknown>>((resolve) => {
        execFile("claude", ["auth", "status"], { timeout: 10000 }, (err, stdout) => {
          const output = stdout || "";
          try {
            resolve(JSON.parse(output));
          } catch (e) {
            console.warn("claude auth status output was not JSON, falling back to raw/error:", e);
            resolve(err
              ? { loggedIn: false, error: err.message }
              : { loggedIn: false, raw: output });
          }
        });
      });
    },

    async authLogin(email) {
      if (activeLogin) {
        if (activeLogin.authUrl) {
          return { authUrl: activeLogin.authUrl };
        }
        return { authUrl: null };
      }

      const args = ["auth", "login"];
      if (email) args.push("--email", email);

      const child = spawn("claude", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, BROWSER: "echo" },
      });

      let authUrl: string | null = null;
      let output = "";

      activeLogin = { process: child, authUrl: null };

      child.stdout.on("data", (data: Buffer) => {
        output += data.toString();
        const urlMatch = output.match(/(https:\/\/claude\.ai\/oauth\/authorize\S+)/);
        if (urlMatch && !authUrl) {
          authUrl = urlMatch[1]!;
          activeLogin!.authUrl = authUrl;
        }
      });

      child.stderr.on("data", (data: Buffer) => {
        output += data.toString();
        const urlMatch = output.match(/(https:\/\/claude\.ai\/oauth\/authorize\S+)/);
        if (urlMatch && !authUrl) {
          authUrl = urlMatch[1]!;
          activeLogin!.authUrl = authUrl;
        }
      });

      child.on("close", () => {
        activeLogin = null;
      });

      // Wait up to 10s for auth URL
      for (let i = 0; i < 20; i++) {
        if (authUrl) return { authUrl };
        await new Promise((r) => setTimeout(r, 500));
      }

      child.kill();
      activeLogin = null;

      if (authUrl) return { authUrl };
      return { authUrl: null, error: "Failed to get auth URL" };
    },

    async authLogout() {
      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        execFile("claude", ["auth", "logout"], { timeout: 10000 }, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true });
          }
        });
      });
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeClaudeCliOptions {
  /** Whether the CLI reports as logged in. Default: false */
  loggedIn?: boolean;
}

export interface FakeClaudeCliService extends ClaudeCliService {
  loggedIn: boolean;
}

export function createFakeClaudeCli(
  opts?: FakeClaudeCliOptions,
): FakeClaudeCliService {
  const fake: FakeClaudeCliService = {
    loggedIn: opts?.loggedIn ?? false,

    async authStatus() {
      return fake.loggedIn
        ? { loggedIn: true, email: "test@example.com" }
        : { loggedIn: false };
    },

    async authLogin() {
      fake.loggedIn = true;
      return { authUrl: "https://claude.ai/oauth/authorize?fake=1" };
    },

    async authLogout() {
      fake.loggedIn = false;
      return { success: true };
    },
  };

  return fake;
}
