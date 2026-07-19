/**
 * `cb pub setup` core (Track E of `docs/plans/publish-pages.md`) — the one-time
 * Cloudflare provisioning: ensure the R2 bucket exists (idempotent), deploy
 * `pub-worker/` via wrangler with the version stamp + Access vars, ENFORCE that
 * workers.dev serving is on and version-preview URLs are OFF (old Worker
 * versions are a leak surface — plan Prior-art), and resolve the resulting
 * `workers.dev` hostname.
 *
 * Everything Cloudflare-touching goes through the injected
 * {@link CloudflareProvisioningClient} and {@link DeployWorkerFn}, so the whole
 * flow is doctestable with no network and NO live wrangler run. Re-running
 * setup is idempotent: the bucket create tolerates "already exists", the deploy
 * overwrites the script, and the subdomain settings converge.
 *
 * The Cloudflare Access application + Google IdP for the account tiers is a
 * one-time MANUAL step (Zero Trust dashboard) — setup prints instructions
 * (see `accessSetupInstructions`) instead of automating it, then a re-run with
 * `--access-team-domain`/`--access-aud` bakes the vars into the deploy.
 */

import { runCollectedChild } from "../lib/run-child.js";
import type { CloudflareProvisioningClient } from "../services/cloudflare-provisioning.js";
import {
  localPubWorkerVersion,
  PUB_WORKER_DIR,
  readPubWorkerConfig,
} from "./pub-worker-meta.js";

/**
 * Runs `wrangler <args>` in the pub-worker package dir with the account creds
 * in the environment. Injectable: doctests use a recording fake; only a live
 * `cb pub setup` invokes the real {@link defaultDeployWorker}.
 */
export type DeployWorkerFn = (args: {
  cwd: string;
  wranglerArgs: string[];
  credsEnv: Record<string, string>;
}) => Promise<{ code: number; output: string }>;

/** The real deploy: `pnpm exec wrangler <args>` (wrangler is a pub-worker devDependency). */
export const defaultDeployWorker: DeployWorkerFn = async ({ cwd, wranglerArgs, credsEnv }) => {
  return runCollectedChild({
    command: "pnpm",
    args: ["exec", "wrangler", ...wranglerArgs],
    cwd,
    env: { ...process.env, ...credsEnv },
  });
};

/** The machine-level Cloudflare credentials setup needs (bucket name is chosen here, not required up front). */
export interface SetupCreds {
  apiToken: string;
  accountId: string;
}

/** Read the two required creds from machine-level env (`~/.cb-publish.env`); `null` when either is absent. */
export function setupCredsFromEnv(env?: NodeJS.ProcessEnv): SetupCreds | null {
  const source = env ?? process.env;
  const apiToken = source["CLOUDFLARE_API_TOKEN"];
  const accountId = source["CLOUDFLARE_ACCOUNT_ID"];
  if (!apiToken || !accountId) return null;
  return { apiToken, accountId };
}

export interface SetupOptions {
  /** Cloudflare Access team origin (`https://<team>.cloudflareaccess.com`) — omit until the manual Access step is done. */
  accessTeamDomain?: string | undefined;
  /** Cloudflare Access application `aud` tag — omit until the manual Access step is done. */
  accessAud?: string | undefined;
}

export interface SetupDeps {
  /** Machine-level env (defaults to `process.env`) — creds + the optional `CLOUDFLARE_R2_BUCKET` override. */
  env?: NodeJS.ProcessEnv | undefined;
  /** The provisioning client, or `null` when creds are absent (→ `unconfigured`). Built from creds by the CLI; a fake in doctests. */
  client: CloudflareProvisioningClient | null;
  /** The wrangler deploy runner; defaults to the real spawn. */
  deploy?: DeployWorkerFn | undefined;
  /** pub-worker package dir override (doctest fixtures). */
  pubWorkerDir?: string | undefined;
}

export type SetupResult =
  | {
      ok: true;
      hostname: string;
      workerName: string;
      bucketName: string;
      /** True when this run created the bucket (false: it already existed). */
      bucketCreated: boolean;
      /** The version stamp baked into the deploy (hash of the committed Worker source). */
      version: string;
      /** True when the Access vars were baked in (account tiers live); false ⇒ account tiers fail closed. */
      accessConfigured: boolean;
      /** Set when `CLOUDFLARE_R2_BUCKET` is not yet in the env — the line to add to `~/.cb-publish.env`. */
      bucketEnvHint: string | null;
      deployOutput: string;
    }
  | { ok: false; reason: "unconfigured"; message: string }
  | { ok: false; reason: "invalid-access-flags"; message: string }
  | { ok: false; reason: "bucket-mismatch"; message: string }
  | { ok: false; reason: "unsafe-config"; message: string }
  | { ok: false; reason: "deploy-failed"; message: string; output: string }
  | { ok: false; reason: "preview-urls-enabled"; message: string }
  | { ok: false; reason: "no-subdomain"; message: string };

/** The dashboard steps that cannot be scripted (token minting has no API; Access IdP setup is one-time). */
export const CREDENTIALS_INSTRUCTIONS = [
  "Cloudflare credentials are missing. One-time manual steps:",
  "  1. Create a Cloudflare account (free tier is fine) and note the Account ID.",
  "  2. Dashboard → My Profile → API Tokens → Create Token, with permissions:",
  "     Workers Scripts: Edit  +  Workers R2 Storage: Edit  (account-scoped).",
  "  3. Store both OUTSIDE the box repo, machine-level (mode 600):",
  "       ~/.cb-publish.env:",
  "         CLOUDFLARE_API_TOKEN=<token>",
  "         CLOUDFLARE_ACCOUNT_ID=<account id>",
  "  4. Source it (set -a; . ~/.cb-publish.env; set +a) and re-run `cb pub setup`.",
].join("\n");

/** The one-time manual Cloudflare Access setup for the account (`/a/`) tiers. */
export function accessSetupInstructions(hostname: string): string {
  return [
    "Account tiers (`accounts` / `any-account`) need a one-time Cloudflare Access setup (manual):",
    "  1. Zero Trust dashboard → Settings → Authentication → add Google as a login method.",
    "  2. Access → Applications → Add application (Self-hosted):",
    `       application domain: ${hostname}  (path: a/*)`,
    "       policy: Allow — Login Methods: Google (any authenticated Google account;",
    "       the Worker enforces each publication's own allowlist per request).",
    "  3. Copy the team domain (https://<team>.cloudflareaccess.com) and the",
    "     application's Audience (aud) tag from the application overview.",
    "  4. Re-run: cb pub setup --access-team-domain https://<team>.cloudflareaccess.com --access-aud <aud>",
    "Until then, account-tier publications fail closed (404); public/secret tiers work now.",
  ].join("\n");
}

/**
 * Provision publishing against the injected Cloudflare surface. See the module
 * header for the step order; every failure is a typed, fix-naming refusal
 * (principle #5) and every step is safe to re-run.
 */
export async function setupPublishing(options: SetupOptions, deps: SetupDeps): Promise<SetupResult> {
  const env = deps.env ?? process.env;
  const creds = setupCredsFromEnv(env);
  if (creds === null || deps.client === null) {
    return { ok: false, reason: "unconfigured", message: CREDENTIALS_INSTRUCTIONS };
  }
  const client = deps.client;

  // Access flags come as a pair or not at all (a lone half is a config mistake).
  const { accessTeamDomain, accessAud } = options;
  if ((accessTeamDomain === undefined) !== (accessAud === undefined)) {
    return {
      ok: false,
      reason: "invalid-access-flags",
      message: "--access-team-domain and --access-aud must be given together (both come from the Access application overview)",
    };
  }
  if (accessTeamDomain !== undefined && !/^https:\/\/[\da-z-]+\.cloudflareaccess\.com$/.test(accessTeamDomain)) {
    return {
      ok: false,
      reason: "invalid-access-flags",
      message: `--access-team-domain must be the full team origin (https://<team>.cloudflareaccess.com), got '${accessTeamDomain}'`,
    };
  }

  const config = await readPubWorkerConfig(deps.pubWorkerDir);

  // The committed config must keep version-preview URLs disabled — they expose
  // old Worker code at stable URLs (plan Prior-art). Refuse to deploy otherwise.
  if (!config.previewUrlsDisabled) {
    return {
      ok: false,
      reason: "unsafe-config",
      message: "pub-worker/wrangler.jsonc must set \"preview_urls\": false (old Worker versions are a leak surface) — refusing to deploy",
    };
  }

  // The bucket the Worker binds is fixed in wrangler.jsonc; an env override that
  // disagrees would deploy a Worker reading a different bucket than the CLI writes.
  const envBucket = env["CLOUDFLARE_R2_BUCKET"];
  if (envBucket !== undefined && envBucket !== config.bucketName) {
    return {
      ok: false,
      reason: "bucket-mismatch",
      message: `CLOUDFLARE_R2_BUCKET is '${envBucket}' but pub-worker/wrangler.jsonc binds '${config.bucketName}' — align them (edit ~/.cb-publish.env or wrangler.jsonc) and re-run`,
    };
  }
  const bucketName = config.bucketName;

  // 1. Ensure the bucket (idempotent — "already exists" is success).
  const bucketCreated = (await client.bucketExists(bucketName))
    ? false
    : (await client.createBucket(bucketName)).created;

  // 2. Deploy the Worker with the version stamp (+ Access vars when configured).
  const version = await localPubWorkerVersion(deps.pubWorkerDir);
  const wranglerArgs = ["deploy", "--var", `PUB_WORKER_VERSION:${version}`];
  if (accessTeamDomain !== undefined && accessAud !== undefined) {
    wranglerArgs.push("--var", `ACCESS_TEAM_DOMAIN:${accessTeamDomain}`, "--var", `ACCESS_AUD:${accessAud}`);
  }
  const deploy = deps.deploy ?? defaultDeployWorker;
  const deployed = await deploy({
    cwd: deps.pubWorkerDir ?? PUB_WORKER_DIR,
    wranglerArgs,
    credsEnv: { CLOUDFLARE_API_TOKEN: creds.apiToken, CLOUDFLARE_ACCOUNT_ID: creds.accountId },
  });
  if (deployed.code !== 0) {
    return {
      ok: false,
      reason: "deploy-failed",
      message: `wrangler deploy exited ${deployed.code} — see the output above for the failing step`,
      output: deployed.output,
    };
  }

  // 3. ENFORCE workers.dev on + version-preview URLs OFF, then verify by reading
  // back (fail-closed: trust the observed state, not the write).
  await client.setScriptSubdomain(config.workerName, { enabled: true, previewsEnabled: false });
  const observed = await client.getScriptSubdomain(config.workerName);
  if (observed === null || !observed.enabled || observed.previewsEnabled) {
    return {
      ok: false,
      reason: "preview-urls-enabled",
      message: `workers.dev routing for '${config.workerName}' did not settle to enabled-with-previews-disabled (observed: ${JSON.stringify(observed)}) — old Worker versions would stay reachable; fix in the dashboard (Workers → ${config.workerName} → Settings → Domains & Routes) before publishing`,
    };
  }

  // 4. Resolve the workers.dev hostname.
  const subdomain = await client.getAccountSubdomain();
  if (subdomain === null) {
    return {
      ok: false,
      reason: "no-subdomain",
      message: "this Cloudflare account has no workers.dev subdomain registered — register one in the dashboard (Workers & Pages → your subdomain) and re-run `cb pub setup`",
    };
  }

  return {
    ok: true,
    hostname: `${config.workerName}.${subdomain}.workers.dev`,
    workerName: config.workerName,
    bucketName,
    bucketCreated,
    version,
    accessConfigured: accessTeamDomain !== undefined,
    bucketEnvHint: envBucket === undefined ? `CLOUDFLARE_R2_BUCKET=${bucketName}` : null,
    deployOutput: deployed.output,
  };
}
