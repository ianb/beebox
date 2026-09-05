/**
 * `bbx pub setup` core (`docs/implemented-plans/pub-setup-wrangler.md`, superseding the
 * Track E flow of `docs/plans/publish-pages.md`) — the one-time Cloudflare
 * provisioning, dashboard-free:
 *
 *   1. Ensure BOTH R2 buckets exist (content + ingestion — the bucket split,
 *      amendment 1), idempotently.
 *   2. Resolve the account's workers.dev hostname.
 *   3. Optionally provision Cloudflare Access via the API (`--access`, a
 *      setup-only token) — or reuse the persisted/manual Access values.
 *   4. Deploy `pub-worker/` via wrangler with the version stamp + Access vars.
 *   5. ENFORCE workers.dev serving on and version-preview URLs OFF, verified
 *      by read-back (old Worker versions are a leak surface).
 *   6. Persist the non-secret Access values (`_config/publish.json`) so a later
 *      plain rerun redeploys them instead of erasing them (amendment 3).
 *
 * Auth: the interactive `wrangler login` (OAuth) drives everything except the
 * Access half — wrangler's scopes cannot cover `/access/`, so that takes the
 * separate setup-only token. The `CLOUDFLARE_API_TOKEN`+`CLOUDFLARE_ACCOUNT_ID`
 * env pair remains an explicit non-interactive escape hatch. Everything
 * Cloudflare-touching goes through injected clients + the wrangler service, so
 * the whole flow is doctestable with no network and no wrangler spawn.
 */

import type { CloudflareAccessClient } from "../services/cloudflare-access.js";
import type { CloudflareProvisioningClient } from "../services/cloudflare-provisioning.js";
import type { CloudflareTokensClient } from "../services/cloudflare-tokens.js";
import type { WranglerService } from "../services/wrangler.js";
import { type AccessProvisionOutcome, ensureAccess } from "./access-setup.js";
import { type ConnectorSecretResult, ensureConnectorSecret } from "./connector-secret.js";
import {
  type PublishConfig,
  readPublishConfig,
  TEAM_DOMAIN_PATTERN,
  writePublishConfig,
} from "./publish-config.js";
import {
  localPubWorkerVersion,
  readPubWorkerConfig,
} from "./pub-worker-meta.js";

/** Everything a resolved Cloudflare login gives setup. `null` ⇒ unconfigured refusal. */
export interface SetupAuthBundle {
  client: CloudflareProvisioningClient;
  wrangler: WranglerService;
  accountId: string;
  /** Extra env for wrangler spawns: the env-token pair in escape-hatch mode, empty under OAuth. */
  deployEnv: Record<string, string>;
}

export interface SetupOptions {
  /** Manual override pair (both or neither): bake known Access values without the API. */
  accessTeamDomain?: string | undefined;
  accessAud?: string | undefined;
}

export interface SetupDeps {
  /** The box whose `_config/publish.json` persists the non-secret Access values. */
  boxRoot: string;
  /** Machine-level env (defaults to `process.env`) — the optional `CLOUDFLARE_R2_BUCKET` override check. */
  env?: NodeJS.ProcessEnv | undefined;
  /** The resolved login, or `null` when neither wrangler login nor env creds exist. */
  auth: SetupAuthBundle | null;
  /** The Access client, present only for `--access` runs (setup-only token). */
  access?: CloudflareAccessClient | undefined;
  /** The token-mint client, present only for `--mint-connector-token` runs (same setup-only token). */
  tokens?: CloudflareTokensClient | undefined;
  /** pub-worker package dir override (doctest fixtures). */
  pubWorkerDir?: string | undefined;
}

export type SetupResult =
  | {
      ok: true;
      hostname: string;
      workerName: string;
      accountId: string;
      bucketName: string;
      ingestBucketName: string;
      /** True when this run created the bucket (false: it already existed). */
      bucketCreated: boolean;
      ingestBucketCreated: boolean;
      /** The version stamp baked into the deploy (hash of the committed Worker source). */
      version: string;
      /** True when the Access vars were baked in (account tiers live); false ⇒ account tiers fail closed. */
      accessConfigured: boolean;
      /** What the `--access` API provisioning did this run, or `null` when it didn't run. */
      accessProvisioned: AccessProvisionOutcome | null;
      /** The `--mint-connector-token` outcome, or `null` when it didn't run. */
      connectorSecret: Extract<ConnectorSecretResult, { ok: true }> | null;
      deployOutput: string;
    }
  | { ok: false; reason: "unconfigured"; message: string }
  | { ok: false; reason: "invalid-access-flags"; message: string }
  | { ok: false; reason: "bucket-mismatch"; message: string }
  | { ok: false; reason: "unsafe-config"; message: string }
  | { ok: false; reason: "no-subdomain"; message: string }
  | { ok: false; reason: "access-provisioning"; message: string }
  | { ok: false; reason: "connector-token"; message: string }
  | { ok: false; reason: "deploy-failed"; message: string; output: string }
  | { ok: false; reason: "preview-urls-enabled"; message: string };

/** Printed when no Cloudflare login is available (browser OAuth is the only manual step). */
export const LOGIN_INSTRUCTIONS = [
  "No Cloudflare login found. One-time step (opens a browser to approve):",
  "  pnpm --dir <beebox>/pub-worker exec wrangler login",
  "then re-run `bbx pub setup`. Wrangler stores the login (OAuth refresh token)",
  "itself — no API token, no dotfile.",
  "Non-interactive escape hatch: set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.",
].join("\n");

/**
 * Provision publishing against the injected Cloudflare surface. See the module
 * header for the step order; every failure is a typed, fix-naming refusal and
 * every step is safe to re-run.
 */
export async function setupPublishing(options: SetupOptions, deps: SetupDeps): Promise<SetupResult> {
  const env = deps.env ?? process.env;
  if (deps.auth === null) {
    return { ok: false, reason: "unconfigured", message: LOGIN_INSTRUCTIONS };
  }
  const { client, wrangler, accountId, deployEnv } = deps.auth;

  // Manual Access flags come as a pair or not at all (a lone half is a config mistake).
  const { accessTeamDomain, accessAud } = options;
  if ((accessTeamDomain === undefined) !== (accessAud === undefined)) {
    return {
      ok: false,
      reason: "invalid-access-flags",
      message: "--access-team-domain and --access-aud must be given together (both come from the Access application)",
    };
  }
  if (accessTeamDomain !== undefined && !TEAM_DOMAIN_PATTERN.test(accessTeamDomain)) {
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

  // A CLOUDFLARE_R2_BUCKET env override that disagrees with the committed
  // content binding would deploy a Worker reading a different bucket than the
  // CLI writes.
  const envBucket = env["CLOUDFLARE_R2_BUCKET"];
  if (envBucket !== undefined && envBucket !== config.bucketName) {
    return {
      ok: false,
      reason: "bucket-mismatch",
      message: `CLOUDFLARE_R2_BUCKET is '${envBucket}' but pub-worker/wrangler.jsonc binds '${config.bucketName}' — align them and re-run`,
    };
  }

  // 1. Ensure both buckets (idempotent — "already exists" is success).
  const ensureBucket = async (name: string): Promise<boolean> =>
    (await client.bucketExists(name)) ? false : (await client.createBucket(name)).created;
  const bucketCreated = await ensureBucket(config.bucketName);
  const ingestBucketCreated = await ensureBucket(config.ingestBucketName);

  // 2. Resolve the workers.dev hostname up front — Access provisioning needs it.
  const subdomain = await client.getAccountSubdomain();
  if (subdomain === null) {
    return {
      ok: false,
      reason: "no-subdomain",
      message: "this Cloudflare account has no workers.dev subdomain registered — register one in the dashboard (Workers & Pages → your subdomain) and re-run `bbx pub setup`",
    };
  }
  const hostname = `${config.workerName}.${subdomain}.workers.dev`;

  // 3. Resolve the Access values: manual flags > API provisioning (`--access`)
  // > the persisted config from an earlier run (amendment 3 — a plain rerun
  // must never erase working Access vars).
  let accessValues: PublishConfig | null = null;
  let accessProvisioned: AccessProvisionOutcome | null = null;
  if (accessTeamDomain !== undefined && accessAud !== undefined) {
    accessValues = { accessTeamDomain, accessAud };
  } else if (deps.access !== undefined) {
    const provisioned = await ensureAccess({ hostname }, { access: deps.access });
    if (!provisioned.ok) {
      return { ok: false, reason: "access-provisioning", message: provisioned.message };
    }
    accessValues = { accessTeamDomain: provisioned.teamDomain, accessAud: provisioned.aud };
    const { teamDomain, aud, appCreated, otpIdpCreated, policyCreated } = provisioned;
    accessProvisioned = { teamDomain, aud, appCreated, otpIdpCreated, policyCreated };
  } else {
    accessValues = await readPublishConfig(deps.boxRoot);
  }

  // 4. Deploy the Worker with the version stamp (+ Access vars when configured).
  const version = await localPubWorkerVersion(deps.pubWorkerDir);
  const wranglerArgs = ["deploy", "--var", `PUB_WORKER_VERSION:${version}`];
  if (accessValues !== null) {
    wranglerArgs.push("--var", `ACCESS_TEAM_DOMAIN:${accessValues.accessTeamDomain}`, "--var", `ACCESS_AUD:${accessValues.accessAud}`);
  }
  const deployed = await wrangler.run(wranglerArgs, { accountId, extraEnv: deployEnv });
  if (deployed.code !== 0) {
    return {
      ok: false,
      reason: "deploy-failed",
      message: `wrangler deploy exited ${deployed.code} — see the output above for the failing step`,
      output: deployed.output,
    };
  }

  // 5. ENFORCE workers.dev on + version-preview URLs OFF, then verify by reading
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

  // 6. Persist newly-learned Access values so later plain reruns redeploy them.
  if (accessValues !== null) {
    await writePublishConfig(deps.boxRoot, accessValues);
  }

  // 7. Mint + store the connector credential (`--mint-connector-token`).
  // Idempotent: an existing secret file skips the mint entirely. Runs last so
  // a failed deploy never leaves an orphan token.
  let connectorSecret: Extract<ConnectorSecretResult, { ok: true }> | null = null;
  if (deps.tokens !== undefined) {
    const ensured = await ensureConnectorSecret(
      { boxRoot: deps.boxRoot, accountId, bucketName: config.ingestBucketName },
      { tokens: deps.tokens },
    );
    if (!ensured.ok) {
      return { ok: false, reason: "connector-token", message: `everything else is provisioned, but the connector-token mint failed: ${ensured.message}` };
    }
    connectorSecret = ensured;
  }

  return {
    ok: true,
    hostname,
    workerName: config.workerName,
    accountId,
    bucketName: config.bucketName,
    ingestBucketName: config.ingestBucketName,
    bucketCreated,
    ingestBucketCreated,
    version,
    accessConfigured: accessValues !== null,
    accessProvisioned,
    connectorSecret,
    deployOutput: deployed.output,
  };
}
