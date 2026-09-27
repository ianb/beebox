/** Agent-facing commands for box-managed publications. */

import { Command } from "commander";
import type { inferRouterOutputs } from "@trpc/server";

import { errorMessage } from "../../../lib/error-guards.js";
import { generatePubId } from "../../../publish/manifest.js";
import { publicationUrl as buildPublicationUrl, samePublicationAudience, type PublicationUrlScope } from "../../../shared/publication-url.js";
import type { AppRouter } from "../../../webapp/trpc/router.js";
import { boxClient } from "../../lib/box-client.js";

type PublicationCandidate = inferRouterOutputs<AppRouter>["publications"]["prepare"];
type PublicationSite = inferRouterOutputs<AppRouter>["publications"]["list"]["sites"][number];
type PublicationConnections = inferRouterOutputs<AppRouter>["publications"]["connections"];
type SharedHost = inferRouterOutputs<AppRouter>["publications"]["list"]["sharedHost"];

function printBoxClientError(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function publicationDestinationUrl(args: { hostname: string | null; pubId: string; scope: PublicationUrlScope | null }): string | null {
  return buildPublicationUrl({ workersHostname: args.hostname, pubId: args.pubId, scope: args.scope });
}

export function publicationApprovalUrl(args: { serverUrl: string | undefined; boxName?: string; approvalPath?: string }): string | null {
  const { serverUrl, boxName, approvalPath } = args;
  if (serverUrl === undefined || serverUrl.length === 0 || (approvalPath === undefined && (boxName === undefined || boxName.length === 0))) return null;
  try {
    const base = new URL(serverUrl);
    if (base.protocol !== "https:" && base.protocol !== "http:") return null;
    const target = approvalPath ?? `/${encodeURIComponent(boxName ?? "")}/publications`;
    if (!target.startsWith("/") || target.startsWith("//")) return null;
    return new URL(target, base.origin).toString();
  } catch (error) {
    void error;
    return null;
  }
}

function approvalLinkLines(approvalPath?: string): string[] {
  const url = publicationApprovalUrl({
    serverUrl: process.env.BBX_SERVER_URL,
    ...(process.env.BBX_BOX_NAME === undefined ? {} : { boxName: process.env.BBX_BOX_NAME }),
    ...(approvalPath === undefined ? {} : { approvalPath }),
  });
  return url === null
    ? [approvalPath === undefined ? "  approval: open this box's Publications page from the app menu." : `  approval: open the publication card ${approvalPath} in this box's app.`]
    : [`  approval: ${url}${new URL(url).hostname === "localhost" ? " (local app URL)" : ""}`];
}

function siteDestination(site: PublicationSite): string | null {
  const scope = site.approved ?? site.pending?.requestedScope ?? site.requested;
  return publicationDestinationUrl({ hostname: site.hostname, pubId: site.pubId, scope });
}

function candidateDestination(site: PublicationSite): string | null {
  return site.pending === null ? null : publicationDestinationUrl({ hostname: site.hostname, pubId: site.pubId, scope: site.pending.requestedScope });
}

function legacyWorkersDestination(site: PublicationSite): string | null {
  const approved = site.approved;
  if (site.hostname === null || approved === null || (approved.customHostname === undefined && approved.sharedHost === undefined)) return null;
  const { customHostname: _customHostname, sharedHost: _sharedHost, ...legacyScope } = approved;
  return publicationDestinationUrl({ hostname: site.hostname, pubId: site.pubId, scope: legacyScope });
}

function audienceLabel(scope: { tier: string; slug?: string; allowedEmails?: string[]; sharedHost?: { path: string } } | null): string {
  if (scope === null) return "unknown audience";
  if (scope.tier === "public") return `public${scope.sharedHost?.path ? ` at ${scope.sharedHost.path}` : scope.slug ? ` at /${scope.slug}/` : ""}`;
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
    const servingScope = site.approved;
    const requestedScope = site.pending?.requestedScope ?? site.requested;
    const destination = siteDestination(site);
    const nextDestination = candidateDestination(site);
    const audience = servingScope === null
      ? `requested audience ${audienceLabel(requestedScope)}`
      : `serving audience ${audienceLabel(servingScope)}`;
    const candidate = site.pending !== null && servingScope !== null && !samePublicationAudience({ requested: servingScope, approved: site.pending.requestedScope })
      ? `; prepared audience ${audienceLabel(site.pending.requestedScope)}${nextDestination ? `; candidate URL: ${nextDestination}` : ""}`
      : "";
    const destinationLabel = servingScope === null ? "candidate URL" : "publication";
    const legacyAlias = legacyWorkersDestination(site);
    return `${site.name} — ${serving}; ${audience}; ${active}; ${prepared}${destination ? `; ${destinationLabel}: ${destination}` : ""}${legacyAlias ? `; legacy workers.dev URL: ${legacyAlias}` : ""}${candidate}`;
  });
}

export function publicationConnectionsLines(result: PublicationConnections): string[] {
  return result.connections.length === 0
    ? ["No active Cloudflare publishing connections are granted to this box."]
    : ["Active Cloudflare publishing connections granted to this box:", ...result.connections.map((name) => `  ${name}`)];
}

export function publicationSharedHostLines(sharedHost: SharedHost): string[] {
  if (sharedHost === null) return ["Shared publication host: not configured; a member must set it up in Admin before new publications can be prepared."];
  const state = sharedHost.status === "attached" ? "ready" : "setup pending; member should retry in Admin";
  return [`Shared publication host: https://${sharedHost.hostname}/ (${state}; connection ${sharedHost.connectionName})`];
}

export function publicationApprovalLines(): string[] {
  return approvalLinkLines();
}

export function publicationPreparedLines(candidate: PublicationCandidate, site: PublicationSite | undefined): string[] {
  const lines = [
    `${candidate.title} (${candidate.name})`,
    `  publication id: ${candidate.pubId}`,
    `  requested audience: ${candidate.requestedScope.tier}`,
    `  release: ${candidate.releaseId}`,
    `  files: ${candidate.preview.length}; scan findings: ${candidate.scan.total}; skipped binaries: ${candidate.scan.skippedBinaries}`,
  ];
  const servingUrl = site?.approved === null || site === undefined ? null : publicationDestinationUrl({ hostname: site.hostname, pubId: candidate.pubId, scope: site.approved });
  const candidateUrl = publicationDestinationUrl({ hostname: site?.hostname ?? null, pubId: candidate.pubId, scope: candidate.requestedScope });
  if (servingUrl !== null) lines.push(`  publication URL: ${servingUrl}`);
  const legacyAlias = site === undefined ? null : legacyWorkersDestination(site);
  if (legacyAlias !== null) lines.push(`  legacy workers.dev URL: ${legacyAlias}`);
  if (candidateUrl !== null && candidateUrl !== servingUrl) lines.push(`  candidate URL (awaiting member approval): ${candidateUrl}`);
  else if (candidateUrl !== null) lines.push(`  publication URL: ${candidateUrl}`);
  lines.push(...approvalLinkLines(candidate.approvalUrl));
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

const connectionsCommand = new Command("connections")
  .description("List active Cloudflare publishing connections granted to this box")
  .action(async () => {
    const client = boxClient();
    if (!client.ok) printBoxClientError(client.error.message);
    try {
      const result: PublicationConnections = await client.value.publications.connections.query();
      for (const line of publicationConnectionsLines(result)) console.log(line);
    } catch (error) {
      printBoxClientError(errorMessage(error));
    }
  });

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
      for (const line of publicationSharedHostLines(result.sharedHost)) console.log(line);
      for (const line of publicationSiteLines(result.sites)) console.log(line);
      if (result.sites.length > 0) for (const line of approvalLinkLines()) console.log(line);
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
export const pubManagedConnectionsCommand = connectionsCommand;
