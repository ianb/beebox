/**
 * Health check for **stale scan uploaders** — a copied `scan-uploader.mjs`
 * bundle that is older than the box it uploads to.
 *
 * Why it belongs in health: the uploader is a stand-alone laptop client that
 * never updates itself (`scan-uploader/README.md`'s copy-the-file story —
 * nothing fetches it, nothing self-updates), so an old copy keeps sweeping
 * indefinitely against a box that has moved on. It might *work* and still be
 * missing features. That is a state the system already knows about, that only a
 * person can resolve, which is what `bbx health` answers.
 *
 * Why health rather than a notification: a push or Telegram alert reaches
 * nobody unless the boxholder has wired a channel, and there is no notification
 * history to look back at. A health check is visible in `bbx health` and the
 * dashboard banner whether or not any channel exists. It is also a *sticky*
 * condition — true on every request until someone re-copies the bundle — and a
 * pull surface reports a standing condition without nagging, which is the same
 * reason `template-updates` lives here.
 *
 * Why it is not a question card: a question borrows the boxholder's authority
 * for a real choice among outcomes (see `core/scan/promote-questions.ts`, which
 * asks what to do about a rejected scan — re-scan, fix, or accept the loss). A
 * stale uploader has one known remedy and no decision, so a card that expires
 * in 30 days would be the wrong shape for a condition that does not expire.
 *
 * Severity is `warning`, never `error`: an old uploader still uploads, and this
 * must not fail a deploy.
 */

import { listScanTokens, type ScanTokenSummary } from "../../../core/scan/tokens.js";
import type { HealthCheck } from "./health.js";

/** How the uploader spells a checkout. A checkout runs current source through
 * tsx on every sweep and therefore cannot drift, so it is never stale however
 * long ago someone cloned it. */
const SOURCE_BUILD = "source";

export interface ScanUploaderFreshnessOptions {
  /** The box's own deploy time (`readVersionInfo().deployedAt`). `null` in
   * local dev and in every worktree, where there is no deploy to be older
   * than — the check then reports what it knows and judges nothing. */
  readonly deployedAt: string | null;
  /** The contract version this box speaks. An uploader below it is behind. */
  readonly contractVersion: number;
}

export function scanUploaderFreshnessCheck(
  boxRoot: string,
  options: ScanUploaderFreshnessOptions,
): HealthCheck {
  const active = listScanTokens(boxRoot).filter((t) => !t.revoked);
  if (active.length === 0) {
    return { name: "scan-uploaders", ok: true, message: "No scan uploaders configured", severity: "warning" };
  }

  const stale = active.filter((t) => isBehind(t, options));
  if (stale.length === 0) {
    return {
      name: "scan-uploaders",
      ok: true,
      message: `${describeCount(active.length)} configured; none reported an out-of-date build`,
      severity: "warning",
    };
  }

  const detail = stale.map((t) => `${t.name} (${describeClient(t)})`).join("; ");
  return {
    name: "scan-uploaders",
    ok: false,
    message:
      `${describeCount(stale.length)} out of date: ${detail}. ` +
      "Uploads may still work, but an old uploader is missing whatever changed since it was built — " +
      "including its rules for when a scanned file is safe to move or delete. " +
      "Rebuild it (`pnpm --filter scan-uploader build`) and re-copy dist/scan-uploader.mjs to that machine.",
    severity: "warning",
  };
}

/**
 * Whether one uploader is behind this box.
 *
 * Two independent reasons, and "not reported" is neither. An uploader that
 * volunteered nothing is either too old to send the headers or has not called
 * since they were added — both unknown, and reporting unknown as stale would
 * flag every uploader in existence the day this ships.
 */
function isBehind(token: ScanTokenSummary, options: ScanUploaderFreshnessOptions): boolean {
  const client = token.lastClient;
  if (client === null) return false;
  if (client.build === SOURCE_BUILD) return false;
  return contractIsBehind(client.contract, options.contractVersion) || builtBeforeDeploy(client.builtAt, options.deployedAt);
}

/** A contract version below the box's. An unparseable or absent value is no
 * opinion — the wire field is a diagnostic and must not manufacture a verdict. */
function contractIsBehind(reported: string | null, boxVersion: number): boolean {
  if (reported === null) return false;
  const parsed = Number(reported);
  if (!Number.isInteger(parsed)) return false;
  return parsed < boxVersion;
}

/**
 * A build that predates the box's current deploy.
 *
 * Both values are timestamps from the same monorepo, so the comparison is
 * ordered and honest in a way comparing git hashes could never be. With no
 * deploy time (local dev, a worktree) there is nothing to be older than, so
 * this answers no.
 */
function builtBeforeDeploy(builtAt: string | null, deployedAt: string | null): boolean {
  if (builtAt === null || deployedAt === null) return false;
  const built = Date.parse(builtAt);
  const deployed = Date.parse(deployedAt);
  if (Number.isNaN(built) || Number.isNaN(deployed)) return false;
  return built < deployed;
}

function describeClient(token: ScanTokenSummary): string {
  const client = token.lastClient;
  if (client === null) return "never reported a build";
  const parts: string[] = [];
  if (client.build !== null) parts.push(`build ${client.build}`);
  if (client.builtAt !== null) parts.push(`built ${client.builtAt}`);
  if (client.contract !== null) parts.push(`contract v${client.contract}`);
  return parts.length === 0 ? "never reported a build" : parts.join(", ");
}

function describeCount(n: number): string {
  return `${String(n)} scan uploader${n === 1 ? "" : "s"}`;
}
