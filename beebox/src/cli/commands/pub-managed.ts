/** Agent-facing commands for box-managed publications. */

import { Command } from "commander";
import type { inferRouterOutputs } from "@trpc/server";

import { errorMessage } from "../../lib/error-guards.js";
import { generatePubId } from "../../publish/manifest.js";
import type { AppRouter } from "../../webapp/trpc/router.js";
import { boxClient } from "../lib/box-client.js";

type PublicationCandidate = inferRouterOutputs<AppRouter>["publications"]["prepare"];
type PublicationSite = inferRouterOutputs<AppRouter>["publications"]["list"]["sites"][number];

function printBoxClientError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function audienceLabel(site: PublicationSite): string {
  const scope = site.pending?.requestedScope ?? site.requested ?? site.approved;
  if (scope === null) return "unknown audience";
  if (scope.tier === "public") return `public${scope.slug ? ` at /p/${scope.slug}/` : ""}`;
  if (scope.tier === "accounts") return `accounts (${scope.allowedEmails?.length ?? 0} allowed)`;
  return scope.tier;
}

export function publicationSiteLines(sites: PublicationSite[]): string[] {
  if (sites.length === 0) return ["No managed publications are configured in this box."];
  return sites.map((site) => {
    const serving = site.remoteStatus.status === "unavailable"
      ? "serving state unknown"
      : site.approved?.status ?? "not enabled";
    const active = site.activeReleaseId === null ? "no active release" : `active ${site.activeReleaseId.slice(0, 12)}`;
    const prepared = site.pending === null ? "no prepared update" : `prepared ${site.pending.releaseId.slice(0, 12)}`;
    return `${site.name} — ${serving}; ${audienceLabel(site)}; ${active}; ${prepared}${site.hostname ? `; https://${site.hostname}` : ""}`;
  });
}

export function publicationPreparedLines(candidate: PublicationCandidate, site: PublicationSite | undefined): string[] {
  const lines = [
    `${candidate.title} (${candidate.name})`,
    `  publication id: ${candidate.pubId}`,
    `  requested audience: ${candidate.requestedScope.tier}`,
    `  release: ${candidate.releaseId}`,
    `  files: ${candidate.preview.length}; scan findings: ${candidate.scan.total}; skipped binaries: ${candidate.scan.skippedBinaries}`,
  ];
  for (const file of candidate.preview) lines.push(`    ${file.path}  ${file.bytes} bytes  sha256:${file.sha256.slice(0, 16)}…`);
  if (site?.remoteStatus.status === "unavailable") {
    lines.push("  serving state is unknown; check the Publications page before describing it as live or disabled.");
  } else if (site?.approved?.status === "live" && site.activeReleaseId === candidate.releaseId) {
    lines.push("  content is live under the already approved audience; within-scope updates take effect immediately.");
  } else {
    lines.push("  waiting for a signed-in box member to approve and enable this release.");
  }
  return lines;
}

const idCommand = new Command("id")
  .description("Generate a cryptographically random publication id for publication.json")
  .action(() => console.log(generatePubId()));

const sitesCommand = new Command("sites")
  .description("List this box's server-managed publication status")
  .action(async () => {
    const client = boxClient();
    if (!client.ok) printBoxClientError(client.error.message);
    try {
      const result = await client.value.publications.list.query();
      for (const line of publicationSiteLines(result.sites)) console.log(line);
    } catch (error) {
      printBoxClientError(errorMessage(error));
    }
  });

const prepareCommand = new Command("prepare")
  .description("Build and prepare a named site on this box's server")
  .argument("<name>", "Publication folder name under src/publications")
  .action(async (name: string) => {
    const client = boxClient();
    if (!client.ok) printBoxClientError(client.error.message);
    try {
      const candidate = await client.value.publications.prepare.mutate({ name });
      const { sites } = await client.value.publications.list.query();
      const site = sites.find((item) => item.pubId === candidate.pubId);
      for (const line of publicationPreparedLines(candidate, site)) console.log(line);
    } catch (error) {
      printBoxClientError(errorMessage(error));
    }
  });

export const pubManagedPrepareCommand = prepareCommand;
export const pubManagedSitesCommand = sitesCommand;
export const pubManagedIdCommand = idCommand;
