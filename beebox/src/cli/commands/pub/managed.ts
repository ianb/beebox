/** Agent-facing commands for box-managed publications. */

import path from "node:path";

import { Command } from "commander";
import type { inferRouterOutputs } from "@trpc/server";

import { errorMessage } from "../../../shared/error-guards.js";
import { generatePubId } from "../../../publish/manifest.js";
import { publicationUrl as buildPublicationUrl, samePublicationAudience, type PublicationUrlScope } from "../../../shared/publication-url.js";
import type { AppRouter } from "../../../webapp/trpc/routers.js";
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

function approvalLinkLines(approvalPath: string): string[] {
  const url = publicationApprovalUrl({
    serverUrl: process.env.BBX_SERVER_URL,
    ...(process.env.BBX_BOX_NAME === undefined ? {} : { boxName: process.env.BBX_BOX_NAME }),
    approvalPath,
  }) ?? approvalPath;
  return [`  approval: open the publication card ${url} in this box's app.`];
}

function cardLabel(site: PublicationSite): string {
  if (site.duplicateCardPaths.length > 0) return `duplicate cards: ${site.duplicateCardPaths.join(", ")}`;
  return site.cardPath === null ? "no card (orphan)" : `card ${site.cardPath}`;
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
    return `${site.name} — ${cardLabel(site)}; ${serving}; ${audience}; ${active}; ${prepared}${destination ? `; ${destinationLabel}: ${destination}` : ""}${legacyAlias ? `; legacy workers.dev URL: ${legacyAlias}` : ""}${candidate}`;
  });
}

function publicationConnectionsLines(result: PublicationConnections): string[] {
  return result.connections.length === 0
    ? ["No active Cloudflare publishing connections are granted to this box."]
    : ["Active Cloudflare publishing connections granted to this box:", ...result.connections.map((name) => `  ${name}`)];
}

export function publicationSharedHostLines(sharedHost: SharedHost): string[] {
  if (sharedHost === null) return ["Shared publication host: not configured; a member must set it up in Admin before new publications can be prepared."];
  const state = sharedHost.status === "attached" ? "ready" : "setup pending; member should retry in Admin";
  return [`Shared publication host: https://${sharedHost.hostname}/ (${state}; connection ${sharedHost.connectionName})`];
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
    lines.push(`  serving state is unknown; check the publication card ${candidate.cardPath} before describing it as live or disabled.`);
  } else if (site?.approved?.status === "live" && site.activeReleaseId === candidate.releaseId) {
    lines.push("  content is live under the already approved audience; within-scope updates take effect immediately.");
  } else {
    lines.push("  waiting for a signed-in box member to approve and enable this release.");
  }
  return lines;
}

class PublicationCardNotPreparedError extends Error {
  constructor(cardPath: string) {
    super(`No prepared publication has card ${cardPath}. Run \`bbx pub prepare ${cardPath}\` first, or check that it is a <Name>.publication.card.`);
    this.name = "PublicationCardNotPreparedError";
  }
}

/** Find the publication whose single card is `cardPath` (box-relative; `./` and redundant segments are ignored). */
export function publicationForCard(sites: PublicationSite[], cardPath: string): PublicationSite {
  const normalized = path.posix.normalize(cardPath.replaceAll("\\", "/")).replace(/^(\.\/)+/, "");
  const site = sites.find((item) => item.cardPath === normalized);
  if (site === undefined) throw new PublicationCardNotPreparedError(normalized);
  return site;
}

export function publicationFilesLines(site: PublicationSite): string[] {
  const lines = site.activeReleaseId === null
    ? ["active release: none"]
    : [`active release ${site.activeReleaseId}:`, ...site.activeFiles.map((file) => `  ${file.path}  ${file.bytes} bytes`)];
  if (site.pending !== null && site.pending.releaseId !== site.activeReleaseId) {
    lines.push(`pending release ${site.pending.releaseId}:`);
    for (const file of site.pending.preview) lines.push(`  ${file.path}  ${file.bytes} bytes`);
  }
  return lines;
}

const filesCommand = new Command("files")
  .description("List the files of a publication's active release and pending candidate")
  .argument("<card-path>", "Box-relative path of the publication card")
  .action(async (card: string) => {
    const client = boxClient();
    if (!client.ok) printBoxClientError(client.error.message);
    try {
      const { sites } = await client.value.publications.list.query();
      for (const line of publicationFilesLines(publicationForCard(sites, card))) console.log(line);
    } catch (error) {
      printBoxClientError(errorMessage(error));
    }
  });

const catCommand = new Command("cat")
  .description("Print one text file from a publication's active release (or its pending candidate)")
  .argument("<card-path>", "Box-relative path of the publication card")
  .argument("<file>", "Path of the file inside the release")
  .option("--pending", "Read from the pending candidate instead of the active release")
  .action(async (...actionArgs: [card: string, file: string, options: { pending?: boolean }]) => {
    const [card, file, options] = actionArgs;
    const client = boxClient();
    if (!client.ok) printBoxClientError(client.error.message);
    try {
      const { sites } = await client.value.publications.list.query();
      const site = publicationForCard(sites, card);
      const releaseId = options.pending === true ? site.pending?.releaseId ?? null : site.activeReleaseId;
      if (releaseId === null) printBoxClientError(options.pending === true ? "This publication has no pending candidate." : "This publication has no active release.");
      const result = await client.value.publications.releaseFile.query({ pubId: site.pubId, releaseId, path: file });
      if (result.kind === "binary") printBoxClientError(`${file} is a binary file (${result.bytes} bytes, ${result.contentType}); not printed.`);
      if (result.kind === "too-large") printBoxClientError(`${file} is too large to print (${result.bytes} bytes; limit ${result.limit}).`);
      process.stdout.write(result.text);
    } catch (error) {
      printBoxClientError(errorMessage(error));
    }
  });

const idCommand = new Command("id")
  .description("Generate a cryptographically random publication id for a publication card")
  .action(() => console.log(generatePubId()));

const statusCommand = new Command("status")
  .description("Report this box's publishing connections and server-managed publication status")
  .action(async () => {
    const client = boxClient();
    if (!client.ok) printBoxClientError(client.error.message);
    try {
      const [connections, publications] = await Promise.all([
        client.value.publications.connections.query(),
        client.value.publications.list.query(),
      ]);
      console.log("Server-managed publication status:");
      for (const line of publicationConnectionsLines(connections)) console.log(line);
      for (const line of publicationSharedHostLines(publications.sharedHost)) console.log(line);
      for (const line of publicationSiteLines(publications.sites)) console.log(line);
    } catch (error) {
      printBoxClientError(errorMessage(error));
    }
  });

const prepareCommand = new Command("prepare")
  .description("Build and prepare a named site on this box's server")
  .argument("<card-path>", "Box-relative path of the publication card")
  .action(async (card: string) => {
    const client = boxClient();
    if (!client.ok) printBoxClientError(client.error.message);
    try {
      const candidate = await client.value.publications.prepare.mutate({ card });
      const { sites } = await client.value.publications.list.query();
      const site = sites.find((item) => item.pubId === candidate.pubId);
      for (const line of publicationPreparedLines(candidate, site)) console.log(line);
    } catch (error) {
      printBoxClientError(errorMessage(error));
    }
  });

export const pubManagedPrepareCommand = prepareCommand;
export const pubManagedIdCommand = idCommand;
export const pubManagedStatusCommand = statusCommand;
export const pubManagedFilesCommand = filesCommand;
export const pubManagedCatCommand = catCommand;
