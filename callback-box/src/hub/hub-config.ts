/**
 * `cb hub` configuration — `hub.json`, the fleet's routing table (Track D,
 * chunk D1 in `docs/plans/boxes-as-packages-v2.md`).
 *
 * This file is intentionally strict (`z.strictObject`, closed enums, fail on
 * unknown keys): it decides which processes the hub spawns and which URL
 * prefix routes to which box, so a typo or a stray key should be a load-time
 * error, not a silently-ignored no-op.
 *
 * Default location: `~/.config/cb/hub.json` (same `~/.config/cb/` directory
 * as the legacy `boxes.json` manifest — see `src/core/boxes-config.ts` — but
 * a separate file, since the hub's routing table has a materially different
 * shape: it needs a URL slug per box, not just a path). `--config <path>`
 * overrides the location; see `src/cli/commands/hub.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";

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
});

export type BoxEntry = z.infer<typeof boxEntrySchema>;

export interface HubConfig {
  port: number | undefined;
  host: string | undefined;
  /** Slug -> box entry, with `path` resolved to an absolute path. */
  boxes: Record<string, BoxEntry>;
  /** Where this config was loaded from — supervisor SIGHUP reload re-reads this path. */
  configPath: string;
}

export class HubConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubConfigError";
  }
}

/** Default `hub.json` location, mirroring `boxes-config.ts`'s `~/.config/cb/`. */
export function defaultHubConfigPath(): string {
  return path.join(os.homedir(), ".config", "cb", "hub.json");
}

/**
 * Load and validate `hub.json`. Fails closed: unknown top-level keys, an
 * unknown per-box key, a reserved or malformed slug, or two slugs pointing
 * at the same resolved box path (which would start two engine processes
 * against one box's on-disk state — the exact "two engines on one
 * `events.db`" hazard the plan's Failure modes section calls out) are all
 * load errors, not warnings.
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
  const pathToSlugs = new Map<string, string[]>();

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
    const existing = pathToSlugs.get(resolvedPath) ?? [];
    existing.push(slug);
    pathToSlugs.set(resolvedPath, existing);
  }

  const duplicated = Array.from(pathToSlugs.entries()).filter(([, slugs]) => slugs.length > 1);
  if (duplicated.length > 0) {
    const detail = duplicated
      .map(([boxPath, slugs]) => `  - ${boxPath} is claimed by slugs: ${slugs.join(", ")}`)
      .join("\n");
    throw new HubConfigError(
      `Hub config at ${configPath}: the same box path is registered under more than one ` +
        "slug, which would start two engine processes against one box's on-disk state " +
        `(two engines on one events.db is corrupting, not just wasteful):\n${detail}`
    );
  }

  return {
    port: result.data.port,
    host: result.data.host,
    boxes,
    configPath: path.resolve(configPath),
  };
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
