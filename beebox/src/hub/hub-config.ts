/**
 * `bbx hub` configuration — `hub.json`, the fleet's routing table (Track D,
 * chunk D1 in `docs/implemented-plans/boxes-as-packages-v2.md`).
 *
 * This file is intentionally strict (`z.strictObject`, closed enums, fail on
 * unknown keys): it decides which processes the hub spawns and which URL
 * prefix routes to which box, so a typo or a stray key should be a load-time
 * error, not a silently-ignored no-op.
 *
 * Default location: `~/.config/beebox/hub.json` (same `~/.config/beebox/` directory
 * as the legacy `boxes.json` manifest — see `src/core/boxes-config.ts` — but
 * a separate file, since the hub's routing table has a materially different
 * shape: it needs a URL slug per box, not just a path). `--config <path>`
 * overrides the location; see `src/cli/commands/hub.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import { resolveBoxRoot } from "./child-spawn.js";
import { invariant } from "../lib/invariant.js";

/**
 * URL prefixes the box server itself claims at the root level (outside any
 * box's own `/<slug>` scope) — see `src/webapp/server-root.ts`
 * (`/healthz`, `/api/...`), `src/webapp/routes/auth.ts` (`/auth/...`), and
 * `src/webapp/server-box-scope.ts` (`/webhook/<slug>/...`, a SEPARATE
 * top-level prefix from the box's own `/<slug>`). A box slug colliding with
 * any of these would make some of the box's own routes unreachable through
 * the hub (and `webhook` specifically would collide with every box's own
 * webhook prefix, not just the box named "webhook"), so they're reserved
 * fleet-wide.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "healthz",
  "auth",
  "webhook",
  "api",
]);

/** URL-safe, DNS-label-shaped: lowercase letters, digits, hyphens; can't start/end with a hyphen. */
const SLUG_PATTERN = /^[\da-z]([\da-z-]*[\da-z])?$/;

const slugSchema = z
  .string()
  .min(1, "slug must not be empty")
  .regex(SLUG_PATTERN, "slug must be lowercase letters, digits, and hyphens (no leading/trailing hyphen)");

const boxEntrySchema = z.strictObject({
  /** Absolute or relative (resolved against the config file's own directory)
   *  path to the box — either a v2 package root or a legacy/v2 content dir.
   *  `src/hub/supervisor.ts` resolves which. */
  path: z.string().min(1),
});

const hubConfigFileSchema = z.strictObject({
  port: z.number().int().positive().optional(),
  host: z.string().optional(),
  boxes: z.record(slugSchema, boxEntrySchema),
  /**
   * Lazy mode (boxholder directive, 2026-07-04): children are NOT spawned at
   * boot. The first HTTP request (never a WS upgrade — see
   * `hub-server.ts`'s WS-refusal comment) for a slug spawns it on demand,
   * the same semantics the monorepo dev router already has for whole
   * worktrees (`bin/router.ts`'s `ensureRunning`). Idle boxes (only HTTP
   * request traffic counts as activity) get SIGTERM'd back to "stopped"
   * after `idleMs`. Defaults to `false` — production hubs stay resident
   * (schedulers/webhooks want the process up) unless a config opts in.
   */
  lazy: z.boolean().optional(),
  /** Idle timeout before a lazy hub stops a box, in ms. Only meaningful
   *  when `lazy: true`. Defaults to 5 minutes, matching the dev router's
   *  `IDLE_TIMEOUT_MS`. */
  idleMs: z.number().int().positive().optional(),
  /**
   * Keep the N most-recently-used boxes alive in lazy mode instead of
   * idle-stopping every box (boxholder directive, 2026-07-11): most boxes
   * still idle-stop after `idleMs`, but the `keepRecent` most-recently-active
   * running boxes stay resident, and a hub restart pre-starts that set rather
   * than everything or nothing. Recency is persisted in `hub-state.json`, a
   * sibling of this config file — see `src/hub/hub-state.ts`. Only meaningful
   * with `lazy: true`; a positive value on a resident hub is a config error
   * (every box already stays up, so there's nothing to keep alive). Defaults
   * to 0 — no box is exempt, pure idle-stop, the prior behavior.
   */
  keepRecent: z.number().int().min(0).optional(),
});

export type BoxEntry = z.infer<typeof boxEntrySchema>;

/** Default idle timeout for a lazy hub — mirrors the dev router's `IDLE_TIMEOUT_MS`. */
const DEFAULT_IDLE_MS = 5 * 60 * 1000;

/** No strong precedent for a hub default port (it's a new, prod-only concept
 *  distinct from the dev router's 3210) — chosen simply to avoid the box
 *  server's own `DEFAULT_PORT` (3210) and common dev ports. Lives here (not in
 *  `cli/commands/hub.ts`) so non-CLI callers — e.g. the Tailscale target
 *  auto-discovery in `src/services/tailscale-discovery.ts` — can resolve the
 *  same defaults a bootless `hub.json` implies without importing the CLI layer. */
export const DEFAULT_HUB_PORT = 4310;

/** Default bind host for a hub whose `hub.json` omits `host` — loopback only. */
export const DEFAULT_HUB_HOST = "127.0.0.1";

export interface HubConfig {
  port: number | undefined;
  host: string | undefined;
  /** Slug -> box entry, with `path` resolved to an absolute path. */
  boxes: Record<string, BoxEntry>;
  /** Where this config was loaded from — supervisor SIGHUP reload re-reads this path. */
  configPath: string;
  /** Defaults to `false` — see the file-schema field's doc comment above. */
  lazy: boolean;
  /** Always populated (falls back to `DEFAULT_IDLE_MS`), even when `lazy` is false, so
   *  callers never need to know the default separately. */
  idleMs: number;
  /** Number of most-recently-used boxes a lazy hub keeps resident (and
   *  pre-starts on restart) rather than idle-stopping. Always populated
   *  (falls back to 0). Only meaningful when `lazy` is true — a positive
   *  value with `lazy: false` is rejected at load. */
  keepRecent: number;
}

export class HubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubConfigError";
  }
}

/** Default `hub.json` location, mirroring `boxes-config.ts`'s `~/.config/beebox/`. */
export function defaultHubConfigPath(): string {
  return path.join(os.homedir(), ".config", "beebox", "hub.json");
}

/**
 * Canonicalize a resolved `hub.json` entry path for the duplicate-box check
 * below: resolve it to the box's actual root the same way the supervisor
 * does (`resolveBoxRoot` -- handles the v2 package-root-vs-`content/`-dir
 * bilingual layout) and `fs.realpath` it (catches a symlinked alias to the
 * same box). Without this, `/boxes/a` (package root) and `/boxes/a/content`
 * (the same box's content dir) compare as different strings and both pass
 * the check, letting two `bbx serve` processes start against one box's
 * `events.db`.
 *
 * Resolution failures (e.g. a misconfigured entry with no `.beebox/box.json`
 * anywhere) do NOT throw here -- `loadHubConfig` stays a load-time
 * validator that a single bad entry shouldn't take down; a box that can't
 * resolve is reported "unhealthy" once the supervisor actually tries to
 * launch it (see `cli/commands/hub.ts`'s best-effort `boxEntries` handling).
 * Falling back to `fs.realpath` of the raw path still catches a symlinked
 * alias to a bad-but-real path; falling back further to the raw path itself
 * only matters for a path that doesn't exist at all, which can't collide
 * with anything real anyway.
 */
export async function canonicalBoxKey(resolvedPath: string): Promise<string> {
  try {
    const boxRoot = await resolveBoxRoot(resolvedPath);
    return await fs.realpath(boxRoot);
  } catch (_e) {
    try {
      return await fs.realpath(resolvedPath);
    } catch (_e2) {
      return resolvedPath;
    }
  }
}

/**
 * Load and validate `hub.json`. Fails closed: unknown top-level keys, an
 * unknown per-box key, a reserved or malformed slug, or two slugs pointing
 * at the same resolved box path (which would start two engine processes
 * against one box's on-disk state — the exact "two engines on one
 * `events.db`" hazard the plan's Failure modes section calls out) are all
 * load errors, not warnings. The duplicate check canonicalizes each entry
 * (`canonicalBoxKey`) before comparing, so a package-root path and its own
 * `content/` subdirectory -- or a symlinked alias -- are caught as the same
 * box, not accepted as two distinct ones. `loadHubConfig` was already
 * async (it reads the file from disk), so making this one check async too
 * doesn't change the function's shape -- it stays the one place that
 * validates `hub.json`, which is what keeps this module's doctests
 * (`test/hub/hub-config.doctest.md`) meaningful as pure-ish validation
 * tests rather than needing supervisor/process machinery.
 */
export async function loadHubConfig(configPath: string): Promise<HubConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch (e) {
    throw new HubConfigError(
      `Cannot read hub config at ${configPath}: ` + describeError(e)
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new HubConfigError(
      `Hub config at ${configPath} is not valid JSON: ` + describeError(e)
    );
  }

  return parseHubConfig(json, configPath);
}

/**
 * Validate an already-parsed `hub.json` value. Split out of `loadHubConfig`
 * so `hub-config-edit.ts` can run a *candidate* config through the exact
 * validator the hub itself will apply, before that candidate is written to
 * disk — a proposed edit that the hub would refuse to load must fail while
 * it is still an in-memory object, not after it has replaced the live file.
 *
 * `configPath` is where the config lives (or would live): it anchors relative
 * box paths and names the file in every error message. It is not read here.
 */
export async function parseHubConfig(json: unknown, configPath: string): Promise<HubConfig> {
  const result = hubConfigFileSchema.safeParse(json);
  if (!result.success) {
    const issueLines = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new HubConfigError(
      `Hub config at ${configPath} is invalid:\n` + issueLines
    );
  }

  const configDir = path.dirname(path.resolve(configPath));
  const boxes: Record<string, BoxEntry> = {};
  interface DupeEntry {
    slug: string;
    resolvedPath: string;
  }
  const canonicalToEntries = new Map<string, DupeEntry[]>();

  for (const [slug, entry] of Object.entries(result.data.boxes)) {
    if (RESERVED_SLUGS.has(slug)) {
      throw new HubConfigError(
        `Hub config at ${configPath}: slug "${slug}" is reserved (the box server itself ` +
          "claims that URL prefix — see RESERVED_SLUGS in src/hub/hub-config.ts). Pick a " +
          "different slug."
      );
    }
    const resolvedPath = path.resolve(configDir, entry.path);
    boxes[slug] = { path: resolvedPath };
    const canonicalKey = await canonicalBoxKey(resolvedPath);
    const existing = canonicalToEntries.get(canonicalKey) ?? [];
    existing.push({ slug, resolvedPath });
    canonicalToEntries.set(canonicalKey, existing);
  }

  const duplicated = Array.from(canonicalToEntries.values()).filter((entries) => entries.length > 1);
  if (duplicated.length > 0) {
    const detail = duplicated
      .map((entries) => {
        const [first] = entries;
        invariant(first !== undefined, "duplicated entries must be non-empty (length > 1 filter above)");
        return (
          `  - ${first.resolvedPath} is claimed by slugs: ` +
          entries.map(({ slug, resolvedPath }) => `${slug} (${resolvedPath})`).join(", ")
        );
      })
      .join("\n");
    throw new HubConfigError(
      `Hub config at ${configPath}: the same box path is registered under more than one ` +
        "slug, which would start two engine processes against one box's on-disk state " +
        `(two engines on one events.db is corrupting, not just wasteful):\n${detail}`
    );
  }

  const lazy = result.data.lazy ?? false;
  const keepRecent = result.data.keepRecent ?? 0;
  if (keepRecent > 0 && !lazy) {
    throw new HubConfigError(
      `Hub config at ${configPath}: keepRecent (${keepRecent}) requires lazy: true. It keeps ` +
        "the most-recently-used boxes alive in an otherwise idle-stopping lazy hub, which is " +
        "meaningless for a resident (non-lazy) hub where every box already stays up. Set " +
        "lazy: true, or remove keepRecent."
    );
  }

  return {
    port: result.data.port,
    host: result.data.host,
    boxes,
    configPath: path.resolve(configPath),
    lazy,
    idleMs: result.data.idleMs ?? DEFAULT_IDLE_MS,
    keepRecent,
  };
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
