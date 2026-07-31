/**
 * WranglerService — the local `wrangler` CLI surface behind `cb pub setup` and
 * the laptop-side publish commands (`docs/implemented-plans/pub-setup-wrangler.md`).
 *
 * Publishing's interactive auth is `wrangler login` (browser OAuth); wrangler
 * owns the stored refresh token and silently re-mints access tokens, so the
 * box never stores a Cloudflare credential for setup. This service wraps the
 * three ways we lean on that login:
 *
 *  - `whoami()`   — is the user logged in, and to which account(s)?
 *  - `authToken()` — the current OAuth access token, for `Bearer` REST calls
 *    (`wrangler auth token` exists exactly for this — it is not a hack).
 *  - `run()`      — collected non-interactive spawns (`deploy`, `r2 bucket
 *    create`, `secret put`).
 *
 * ⚠️ UNVERIFIED: the real adapter cannot be exercised without a live wrangler
 * login, so its output parsing is unproven until the manual end-to-end run —
 * same posture as the other Cloudflare adapters. The setup/status logic is
 * fully tested through {@link createFakeWrangler}.
 *
 * Env discipline for real spawns: `CLOUDFLARE_ACCOUNT_ID` is always pinned
 * (multi-account wrangler otherwise guesses or prompts), and we never set
 * `CI=true` — wrangler's CI mode forces API-token-only auth, which would
 * bypass the OAuth login this whole design rides on.
 */

import { z } from "zod";

import { runCollectedChild } from "../lib/run-child.js";
import { PUB_WORKER_DIR } from "../publish/pub-worker-meta.js";

/** One Cloudflare account membership visible to the wrangler login. */
export interface WranglerAccount {
  id: string;
  name: string;
}

/** The logged-in identity, or `null` when there is no usable wrangler login. */
export interface WranglerIdentity {
  email: string | null;
  accounts: WranglerAccount[];
}

/** A collected wrangler invocation result (combined output, exit code). */
export interface WranglerRunResult {
  code: number;
  output: string;
}

/** Options for a wrangler spawn: the pinned account, plus extra env (the env-token escape hatch). */
export interface WranglerRunOptions {
  accountId: string;
  extraEnv?: Record<string, string> | undefined;
}

/** The wrangler surface publishing uses. All non-interactive. */
export interface WranglerService {
  /** The current login identity, or `null` when not logged in. */
  whoami(): Promise<WranglerIdentity | null>;
  /** The active OAuth access token for REST `Bearer` use, or `null` when unavailable. */
  authToken(): Promise<string | null>;
  /** Run `wrangler <args>` in the pub-worker dir with the account pinned. */
  run(args: string[], opts: WranglerRunOptions): Promise<WranglerRunResult>;
}

/** Loose parse boundary for `wrangler whoami --json` (shape unverified until the live pass). */
const whoamiSchema = z.object({
  email: z.string().optional(),
  accounts: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
});

/**
 * ⚠️ UNVERIFIED (no live-wrangler test). The real adapter: spawns
 * `pnpm exec wrangler <args>` in the pub-worker package dir (wrangler is a
 * pub-worker devDependency), never inheriting `CLOUDFLARE_API_TOKEN` from the
 * caller's env for OAuth-mode runs — the caller decides which auth mode wins.
 */
export function createWranglerService(deps?: { pubWorkerDir?: string | undefined }): WranglerService {
  const cwd = deps?.pubWorkerDir ?? PUB_WORKER_DIR;

  async function spawnWrangler(args: string[], env?: Record<string, string>): Promise<WranglerRunResult> {
    // Strip ambient Cloudflare credentials: wrangler's precedence lets a stray
    // CLOUDFLARE_API_TOKEN silently override the OAuth login these calls exist
    // to use. Escape-hatch runs re-inject the pair explicitly via `env`.
    const base = { ...process.env };
    delete base["CLOUDFLARE_API_TOKEN"];
    delete base["CLOUDFLARE_API_KEY"];
    delete base["CLOUDFLARE_EMAIL"];
    return runCollectedChild({
      command: "pnpm",
      args: ["exec", "wrangler", ...args],
      cwd,
      env: { ...base, ...env },
    });
  }

  return {
    async whoami(): Promise<WranglerIdentity | null> {
      const result = await spawnWrangler(["whoami", "--json"]);
      if (result.code !== 0) return null;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(result.output.trim());
      } catch (_e) {
        // Not JSON (older wrangler, or a not-logged-in notice) — treat as no login.
        return null;
      }
      const parsed = whoamiSchema.safeParse(parsedJson);
      if (!parsed.success) return null;
      return {
        email: parsed.data.email ?? null,
        accounts: (parsed.data.accounts ?? []).map((a) => ({ id: a.id, name: a.name ?? a.id })),
      };
    },
    async authToken(): Promise<string | null> {
      const result = await spawnWrangler(["auth", "token"]);
      if (result.code !== 0) return null;
      // The token is the payload line; wrangler may prepend banner lines, so
      // take the last non-empty line and sanity-check it is token-shaped.
      const lines = result.output.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      const token = lines.at(-1);
      if (token === undefined || token.includes(" ")) return null;
      return token;
    },
    async run(args: string[], opts: WranglerRunOptions): Promise<WranglerRunResult> {
      return spawnWrangler(args, { CLOUDFLARE_ACCOUNT_ID: opts.accountId, ...opts.extraEnv });
    },
  };
}

// ---------------------------------------------------------------------------
// Fake — in-memory, for setup doctests. No wrangler, no network.
// ---------------------------------------------------------------------------

export interface FakeWranglerOptions {
  /** The login identity; omit (undefined) for "not logged in". */
  identity?: WranglerIdentity | undefined;
  /** Token `authToken()` returns; defaults to a fixed fake when logged in. */
  token?: string | undefined;
  /** Scripted `run()` results by joined args prefix; unmatched runs succeed with empty output. */
  runResults?: Record<string, WranglerRunResult> | undefined;
}

export interface FakeWranglerService extends WranglerService {
  /** Every `run()` invocation as `<accountId>:<args joined>` in call order. */
  runs: string[];
  /** Count of `authToken()` calls (asserts the refresh-on-401 path). */
  tokenCalls: number;
  describe(): string;
}

/** Build a network-free {@link WranglerService} with observable state. */
export function createFakeWrangler(opts?: FakeWranglerOptions): FakeWranglerService {
  const identity = opts?.identity;
  const token = opts?.token ?? (identity === undefined ? undefined : "fake-oauth-token");
  const runResults = opts?.runResults ?? {};
  const runs: string[] = [];

  const fake: FakeWranglerService = {
    runs,
    tokenCalls: 0,
    whoami(): Promise<WranglerIdentity | null> {
      return Promise.resolve(identity ?? null);
    },
    authToken(): Promise<string | null> {
      fake.tokenCalls += 1;
      return Promise.resolve(token ?? null);
    },
    run(args: string[], runOpts: WranglerRunOptions): Promise<WranglerRunResult> {
      const joined = args.join(" ");
      runs.push(`${runOpts.accountId}:${joined}`);
      const scripted = Object.entries(runResults).find(([prefix]) => joined.startsWith(prefix));
      return Promise.resolve(scripted?.[1] ?? { code: 0, output: "" });
    },
    describe(): string {
      const who = identity === undefined ? "logged out" : `logged in as ${identity.email ?? "(no email)"} (${identity.accounts.map((a) => a.id).join(", ")})`;
      return [`wrangler: ${who}`, ...runs.map((r) => `  run ${r}`)].join("\n");
    },
  };
  return fake;
}
