/**
 * Claude CLI service — typed interface for Claude Code CLI auth operations.
 *
 * Real implementation shells out to `claude auth status/login/logout`.
 * Fake returns configurable status without spawning processes.
 */

import { spawn, execFile } from "node:child_process";
import { invariant } from "../lib/invariant.js";

// ─── Service interface ───────────────────────────────────────────────────────

/**
 * Marks a status probe that produced no usable answer — an empty or
 * unparseable `claude auth status`, or a spawn/timeout failure. Distinct from
 * a probe that answered `loggedIn: false`: the first means we don't know, the
 * second means we do. Callers that gate on auth must not treat them alike.
 */
export const AUTH_PROBE_INCONCLUSIVE = "probeInconclusive";

export interface ClaudeCliService {
  authStatus(): Promise<Record<string, unknown>>;
  authLogin(email?: string): Promise<{ authUrl: string | null; error?: string }>;
  authLogout(): Promise<{ success: boolean; error?: string }>;
  /**
   * Deliver the one-time code the sign-in page shows. Claude Code's login
   * redirects to Anthropic's own page (platform.claude.com), which displays a
   * code and asks the CLI to read it from stdin — a headless server never
   * receives it any other way (2026-08-28: the flow ended at "Paste code here
   * if prompted >" with no way to answer, and the login process sat forever).
   */
  authSubmitCode(code: string): Promise<{ accepted: boolean; error?: string }>;
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
          } catch (_e) {
            // No usable answer. Report that as its own state rather than as a
            // logout: an empty probe intermittently happens on a perfectly
            // authenticated machine, and reporting it as `loggedIn: false`
            // fails runs closed while naming a remedy that isn't the problem.
            resolve(err
              ? { [AUTH_PROBE_INCONCLUSIVE]: true, error: err.message }
              : { [AUTH_PROBE_INCONCLUSIVE]: true, raw: output });
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

      let output = "";

      const login: { process: typeof child; authUrl: string | null } = { process: child, authUrl: null };
      activeLogin = login;

      const onData = (data: Buffer): void => {
        output += data.toString();
        if (login.authUrl) return;
        // Both hosts: Claude Code 2.1.246 moved the sign-in URL from
        // claude.ai/oauth/authorize to claude.com/cai/oauth/authorize, and the
        // old-host-only match turned every login into "Failed to get auth
        // URL" (prod, 2026-08-28). Anchored on the path, not the host.
        const urlMatch = output.match(/(https:\/\/claude\.(?:ai|com)\/(?:cai\/)?oauth\/authorize\S+)/);
        if (!urlMatch) return;
        invariant(urlMatch[1] !== undefined, "capture group 1 is non-optional in urlMatch");
        login.authUrl = urlMatch[1];
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);

      child.on("close", () => {
        activeLogin = null;
      });

      // Wait up to 10s for auth URL
      for (let i = 0; i < 20; i++) {
        if (login.authUrl) return { authUrl: login.authUrl };
        await new Promise((r) => setTimeout(r, 500));
      }

      child.kill();
      activeLogin = null;

      if (login.authUrl) return { authUrl: login.authUrl };
      return { authUrl: null, error: "Failed to get auth URL" };
    },

    async authSubmitCode(code) {
      const login = activeLogin;
      if (!login || !login.authUrl) return { accepted: false, error: "No sign-in in progress — start again" };
      const stdin = login.process.stdin;
      if (!stdin || stdin.destroyed) return { accepted: false, error: "Sign-in process is not accepting input — start again" };
      return new Promise((resolve) => {
        stdin.write(`${code.trim()}\n`, (err) => {
          resolve(err ? { accepted: false, error: err.message } : { accepted: true });
        });
      });
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
  /** A login was started and is waiting for its code. */
  pendingCode: boolean;
}

export function createFakeClaudeCli(
  opts?: FakeClaudeCliOptions,
): FakeClaudeCliService {
  const fake: FakeClaudeCliService = {
    loggedIn: opts?.loggedIn ?? false,
    pendingCode: false,

    async authStatus() {
      return fake.loggedIn
        ? { loggedIn: true, email: "test@example.com" }
        : { loggedIn: false };
    },

    async authLogin() {
      fake.pendingCode = true;
      return { authUrl: "https://claude.com/cai/oauth/authorize?fake=1" };
    },

    async authSubmitCode(code) {
      if (!fake.pendingCode) return { accepted: false, error: "No sign-in in progress — start again" };
      fake.pendingCode = false;
      fake.loggedIn = code.trim().length > 0;
      return { accepted: true };
    },

    async authLogout() {
      fake.loggedIn = false;
      return { success: true };
    },
  };

  return fake;
}
