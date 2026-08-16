/**
 * `cb pub status` core (Track E of `docs/plans/publish-pages.md`) — report the
 * deployed publishing state and flag drift between the committed Worker source
 * and what is actually deployed.
 *
 * Fully injectable (provisioning client + version probe), so the report logic
 * is doctestable with no network. The deployed-version probe hits the public
 * `GET /__version` on the workers.dev hostname (a static, box-free string the
 * Worker serves unauthenticated); drift = probe result ≠ hash of the committed
 * Worker source (`localPubWorkerVersion`). Every security-relevant misconfig
 * lands in `problems` — the CLI exits nonzero when that list is non-empty
 * (strict: a wrong deployed state is a failure, not a footnote).
 */

import type { CloudflareProvisioningClient } from "../services/cloudflare-provisioning.js";
import { listPublications } from "./lifecycle.js";
import { readPublishConfig } from "./publish-config.js";
import { localPubWorkerVersion, readPubWorkerConfig } from "./pub-worker-meta.js";

/** Probe a URL for a small text body; `null` on any failure (unreachable, non-200). */
export type ProbeTextFn = (url: string) => Promise<string | null>;

/** The real probe: a plain fetch with failures mapped to `null` (status reports, never throws mid-report). */
export const defaultProbeText: ProbeTextFn = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch (_e) {
    // Unreachable host / TLS / DNS failure — reported as "no probe result".
    return null;
  }
};

export interface StatusDeps {
  /** The provisioning client, or `null` when no Cloudflare login/creds resolve (report says unconfigured). */
  client: CloudflareProvisioningClient | null;
  /** The `GET /__version` probe; defaults to a real fetch. */
  probeText?: ProbeTextFn | undefined;
  /** pub-worker package dir override (doctest fixtures). */
  pubWorkerDir?: string | undefined;
}

/** Local publication counts by status (from `box/publish/` manifests; no Cloudflare). */
export interface LocalPubCounts {
  draft: number;
  live: number;
  revoked: number;
  invalid: number;
}

export interface StatusReport {
  /** False ⇒ no login/creds; only the local half of the report is populated. */
  configured: boolean;
  workerName: string;
  bucket: { name: string; exists: boolean } | null;
  /** The ingestion bucket (submissions + access logs — the bucket split). */
  ingestBucket: { name: string; exists: boolean } | null;
  /** Deployed-script facts, or `null` when the script has never been deployed. */
  worker: {
    /** The PUB_STORE R2 binding is present on the deployed script. */
    hasStoreBinding: boolean;
    /** Both Access vars are non-empty on the deployed script (account tiers live). */
    accessConfigured: boolean;
  } | null;
  /** workers.dev routing state, or `null` when unknown (script missing). */
  routing: { enabled: boolean; previewsEnabled: boolean } | null;
  /** The public hostname, or `null` when the account has no workers.dev subdomain. */
  hostname: string | null;
  /** Version drift: committed-source hash vs the deployed Worker's `/__version`. */
  version: { local: string; deployed: string | null; drift: boolean };
  pubs: LocalPubCounts;
  /** Security-relevant misconfigurations — non-empty ⇒ the CLI exits nonzero. */
  problems: string[];
}

/** Tally local publications by status (an unparseable manifest counts as `invalid`). */
async function countLocalPubs(boxRoot: string): Promise<LocalPubCounts> {
  const counts: LocalPubCounts = { draft: 0, live: 0, revoked: 0, invalid: 0 };
  for (const summary of await listPublications(boxRoot)) {
    if (summary.invalid) counts.invalid++;
    else if (summary.status === "draft") counts.draft++;
    else if (summary.status === "live") counts.live++;
    else if (summary.status === "revoked") counts.revoked++;
    else counts.invalid++;
  }
  return counts;
}

/**
 * Diff the deployed Access vars against the persisted `config/publish.json`.
 * Any asymmetry is a problem: drift redeploys wrong values, a deployed-but-
 * unpersisted pair would be ERASED by the next plain setup, and a persisted-
 * but-undeployed pair means the account tiers are 404ing for no reason.
 */
async function accessDriftProblems(boxRoot: string, deployed: { teamDomain: string | null; aud: string | null }): Promise<string[]> {
  const { teamDomain, aud } = deployed;
  const accessConfigured = teamDomain !== null && teamDomain.length > 0 && aud !== null && aud.length > 0;
  const persisted = await readPublishConfig(boxRoot);
  if (persisted === null && accessConfigured) {
    return [`Access vars are deployed but config/publish.json is missing — the next plain \`cb pub setup\` would ERASE them; persist them: {"accessTeamDomain":"${teamDomain}","accessAud":"${aud}"}`];
  }
  if (persisted === null) return [];
  if (!accessConfigured) {
    return ["config/publish.json has Access values but the deployed Worker lacks them — re-run `cb pub setup` to redeploy"];
  }
  if (teamDomain !== persisted.accessTeamDomain || aud !== persisted.accessAud) {
    return ["deployed Access vars DIFFER from config/publish.json — re-run `cb pub setup` to redeploy the persisted values (or update the file)"];
  }
  return [];
}

/** Build the deployed-state report. See the module header for the drift/problems semantics. */
export async function statusPublishing({ boxRoot }: { boxRoot: string }, deps: StatusDeps): Promise<StatusReport> {
  const config = await readPubWorkerConfig(deps.pubWorkerDir);
  const localVersion = await localPubWorkerVersion(deps.pubWorkerDir);
  const pubs = await countLocalPubs(boxRoot);

  const report: StatusReport = {
    configured: false,
    workerName: config.workerName,
    bucket: null,
    ingestBucket: null,
    worker: null,
    routing: null,
    hostname: null,
    version: { local: localVersion, deployed: null, drift: false },
    pubs,
    problems: [],
  };

  if (deps.client === null) {
    report.problems.push("publishing is not configured on this machine — run `wrangler login` then `cb pub setup`");
    return report;
  }
  report.configured = true;
  const client = deps.client;

  // Buckets: both names the committed config binds must exist.
  const bucketExists = await client.bucketExists(config.bucketName);
  report.bucket = { name: config.bucketName, exists: bucketExists };
  if (!bucketExists) report.problems.push(`R2 bucket '${config.bucketName}' does not exist — run \`cb pub setup\``);
  const ingestExists = await client.bucketExists(config.ingestBucketName);
  report.ingestBucket = { name: config.ingestBucketName, exists: ingestExists };
  if (!ingestExists) report.problems.push(`R2 ingestion bucket '${config.ingestBucketName}' does not exist — run \`cb pub setup\``);

  // Deployed script: PUB_STORE binding + Access vars (diffed against the
  // persisted `config/publish.json` — a mismatch means the next plain setup
  // would deploy something other than what's live).
  const settings = await client.getScriptSettings(config.workerName);
  if (settings === null) {
    report.problems.push(`Worker '${config.workerName}' is not deployed — run \`cb pub setup\``);
  } else {
    const hasStoreBinding = settings.bindings.some((b) => b.type === "r2_bucket" && b.name === config.bucketBinding);
    const varText = (name: string): string | null => {
      const binding = settings.bindings.find((b) => b.type === "plain_text" && b.name === name);
      return binding?.text ?? null;
    };
    const teamDomain = varText("ACCESS_TEAM_DOMAIN");
    const aud = varText("ACCESS_AUD");
    const accessConfigured = teamDomain !== null && teamDomain.length > 0 && aud !== null && aud.length > 0;
    report.worker = { hasStoreBinding, accessConfigured };
    if (!hasStoreBinding) {
      report.problems.push(`deployed Worker lacks the '${config.bucketBinding}' R2 binding — it cannot serve publications; re-run \`cb pub setup\``);
    }
    report.problems.push(...(await accessDriftProblems(boxRoot, { teamDomain, aud })));
  }

  // workers.dev routing: must be enabled, previews must be OFF (leak surface).
  const routing = await client.getScriptSubdomain(config.workerName);
  if (routing !== null) {
    report.routing = { enabled: routing.enabled, previewsEnabled: routing.previewsEnabled };
    if (!routing.enabled) report.problems.push("workers.dev serving is disabled for the Worker — live publications are unreachable");
    if (routing.previewsEnabled) {
      report.problems.push("version-preview URLs are ENABLED — old Worker versions stay publicly reachable (a leak surface); re-run `cb pub setup` to disable");
    }
  }

  // Hostname + the deployed-version drift probe.
  const subdomain = await client.getAccountSubdomain();
  if (subdomain === null) {
    report.problems.push("the account has no workers.dev subdomain registered — live publications have no hostname");
    return report;
  }
  report.hostname = `${config.workerName}.${subdomain}.workers.dev`;

  if (settings !== null) {
    const probe = deps.probeText ?? defaultProbeText;
    const deployed = await probe(`https://${report.hostname}/__version`);
    report.version = { local: localVersion, deployed, drift: deployed !== localVersion };
    if (deployed === null) {
      report.problems.push("could not probe the deployed Worker's /__version — it may predate the version probe or be unreachable; re-run `cb pub setup`");
    } else if (deployed !== localVersion) {
      report.problems.push("deployed Worker DRIFTS from the committed source — re-run `cb pub setup` to redeploy");
    }
  }

  return report;
}
