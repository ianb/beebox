/** Shared authoritative publication state and member review controls. */

import { useState } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc/client";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { ExternalLink } from "../ui/ExternalLink";
import { FriendlyDate } from "../ui/FriendlyDate";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { StatusMessage } from "../ui/StatusMessage";
import { Pre } from "../ui/Pre";
import { Text } from "../ui/Text";
import { publicationUrl as buildPublicationUrl, samePublicationAudience } from "@shared/publication-url";

type Publication = RouterOutput["publications"]["list"]["sites"][number];
type SharedHost = NonNullable<RouterOutput["publications"]["list"]["sharedHost"]>;
export type Candidate = NonNullable<Publication["pending"]>;
type PreviewResult = RouterOutput["publications"]["releaseFile"];
type AudienceSummary = NonNullable<Publication["pending"]>["requestedScope"] | NonNullable<Publication["requested"]> | NonNullable<Publication["approved"]>;
type RemoteUnavailable = Extract<Publication["remoteStatus"], { status: "unavailable" }>;
type PublicationAction = "prepare" | "approve" | "enable" | "disable";
export type { Publication };
export function PublicationReviewCard({
  site,
  sharedHost,
  pending,
  pendingAction,
  onPrepare,
  onApprove,
  onEnable,
  onDisable,
}: {
  site: Publication;
  sharedHost: SharedHost | null;
  pending: boolean;
  pendingAction: PublicationAction | null;
  onPrepare: () => void;
  onApprove: (candidate: Candidate) => void;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const candidate = site.pending;
  const { siteUrl, workerAlias, requestedUrl, requestedDiffers } = publicationLinks(site);
  const migrateToSharedHost = needsSharedHostMigration(site, sharedHost);

  return (
    <Card as="article" aria-label={`Publication ${site.title || site.name}`} shadow>
      <Stack gap="md">
        <Stack gap="xs">
          <PublicationHeading site={site} />
          {siteUrl ? <ExternalLink id={`bbx-publication-open-${site.pubId}`} href={siteUrl} variant="button">Open site</ExternalLink> : null}
          {workerAlias ? <ExternalLink id={`bbx-publication-workers-alias-${site.pubId}`} href={workerAlias} variant="inline">Open legacy workers.dev URL</ExternalLink> : null}
          {requestedDiffers && requestedUrl ? <Text size="sm">Requested destination awaiting member approval: <Text mono breakAll>{requestedUrl}</Text></Text> : null}
          {!siteUrl && !requestedUrl ? <Text size="sm" tone="muted">Site URL is assigned after the first successful preparation.</Text> : null}
          {migrateToSharedHost ? <Hint>The shared host is attached, but this publication still uses its current workers.dev URL. Prepare a new candidate here; a member must approve it before traffic moves to <Text mono>/s/{site.pubId}/</Text>.</Hint> : null}
        </Stack>

        {site.remoteStatus.status === "unavailable" ? <RemoteState reason={site.remoteStatus.reason} /> : null}

        <Row gap="md" wrap align="start">
          <AudienceBlock title="Requested audience" value={candidate?.requestedScope ?? site.requested} />
          <AudienceBlock title="Approved audience" value={site.approved} />
        </Row>
        {[candidate?.requestedScope ?? site.requested, site.approved].some((audience) => audience?.tier === "secret")
          ? <Hint>Anyone with the link can view this without signing in. It is unlisted, not private to named people.</Hint>
          : null}

        {candidate ? <CandidateDetails candidate={candidate} pubId={site.pubId} /> : <Text size="sm" tone="muted">No prepared update is waiting for review.</Text>}
        <PublicationActions site={site} candidate={candidate} pending={pending} pendingAction={pendingAction} migrateToSharedHost={migrateToSharedHost} onPrepare={onPrepare} onApprove={onApprove} onEnable={onEnable} onDisable={onDisable} />
      </Stack>
    </Card>
  );
}

function publicationLinks(site: Publication): { siteUrl: string | null; workerAlias: string | null; requestedUrl: string | null; requestedDiffers: boolean } {
  const approved = site.approved;
  const candidate = site.pending;
  const siteUrl = buildPublicationUrl({ workersHostname: site.hostname, pubId: site.pubId, scope: approved });
  let workerAlias: string | null = null;
  if (site.hostname !== null && approved !== null && (approved.tier === "public" || approved.tier === "secret")
    && (approved.customHostname !== undefined || approved.sharedHost !== undefined)) {
    const { customHostname: _customHostname, sharedHost: _sharedHost, ...legacyScope } = approved;
    workerAlias = buildPublicationUrl({ workersHostname: site.hostname, pubId: site.pubId, scope: legacyScope });
  }
  const requestedHostname = publicationCustomHostname(candidate?.requestedScope ?? null);
  const requestedUrl = candidate !== null
    ? buildPublicationUrl({ workersHostname: site.hostname, pubId: site.pubId, scope: candidate.requestedScope })
    : null;
  const requestedCustomHostDiffers = requestedHostname !== undefined && requestedHostname !== (approved?.customHostname ?? null);
  const candidateSharedHost = candidate !== null && "sharedHost" in candidate.requestedScope
    ? candidate.requestedScope.sharedHost
    : undefined;
  const requestedSharedRouteDiffers = candidateSharedHost !== undefined
    && (site.sharedRoute === null || site.sharedRoute.hostname !== candidateSharedHost.hostname || site.sharedRoute.path !== candidateSharedHost.path);
  return { siteUrl, workerAlias, requestedUrl, requestedDiffers: requestedCustomHostDiffers || requestedSharedRouteDiffers };
}

function needsSharedHostMigration(site: Publication, sharedHost: SharedHost | null): boolean {
  if (sharedHost?.status !== "attached" || sharedHost.connectionName !== site.connection.name
    || site.approved?.tier !== "secret" || site.approved.customHostname !== undefined
    || site.hostname === null || site.sharedRoute !== null) return false;
  const requestedDestination = site.pending?.requestedScope;
  return requestedDestination === undefined || !("sharedHost" in requestedDestination)
    || requestedDestination.sharedHost === undefined
    || requestedDestination.sharedHost.hostname !== sharedHost.hostname;
}

function PublicationHeading({ site }: { site: Publication }) {
  const state = site.remoteStatus.status === "unavailable" ? "serving state unknown" : site.approved?.status ?? "not enabled";
  const tone = state === "live" ? "success" : state === "disabled" ? "warning" : "neutral";
  return (
    <Row gap="sm" wrap align="center">
      <Badge tone={tone}>{state}</Badge>
      {site.connection.status !== "active" ? <Badge tone="danger">connection {site.connection.status}</Badge> : null}
    </Row>
  );
}

function PublicationActions({ site, candidate, pending, pendingAction, migrateToSharedHost, onPrepare, onApprove, onEnable, onDisable }: {
  site: Publication;
  candidate: Candidate | null;
  pending: boolean;
  pendingAction: PublicationAction | null;
  migrateToSharedHost: boolean;
  onPrepare: () => void;
  onApprove: (candidate: Candidate) => void;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const connectionAvailable = site.connection.status === "active" && site.remoteStatus.status === "available";
  const requestedTier = candidate?.requestedScope.tier ?? site.approved?.tier;
  const accessNeedsVerification = (requestedTier === "accounts" || requestedTier === "any-account") && site.connection.capabilities.accessLive !== "verified";
  const requiresApproval = candidate !== null && (
    !samePublicationAudience({ requested: candidate.requestedScope, approved: site.approved }) ||
    site.approved === null ||
    candidate.releaseId !== site.activeReleaseId
  );
  const enabled = site.approved?.status === "live";
  const disabled = site.approved?.status === "disabled";
  return (
    <Stack gap="xs">
      <PublicationActionButtons site={site} candidate={candidate} pending={pending} pendingAction={pendingAction} migrateToSharedHost={migrateToSharedHost} connectionAvailable={connectionAvailable} accessNeedsVerification={accessNeedsVerification} requiresApproval={requiresApproval} enabled={enabled} disabled={disabled} onPrepare={onPrepare} onApprove={onApprove} onEnable={onEnable} onDisable={onDisable} />
      {site.connection.status !== "active" ? <Hint>Restore this box&apos;s Cloudflare server grant in Admin before managing the site.</Hint> : null}
      {accessNeedsVerification ? <Hint>Account-restricted sites cannot be approved until this connection&apos;s Cloudflare Access capability has been verified.</Hint> : null}
      {disabled && !requiresApproval ? <Hint>Enabling allows the agent to update this site within the approved audience. Audience changes always need your approval.</Hint> : null}
      {enabled && samePublicationAudience({ requested: site.requested, approved: site.approved }) ? <Hint>Publishing within the approved audience takes effect immediately. Audience changes wait for your approval.</Hint> : null}
    </Stack>
  );
}

function PublicationActionButtons({ site, candidate, pending, pendingAction, migrateToSharedHost, connectionAvailable, accessNeedsVerification, requiresApproval, enabled, disabled, onPrepare, onApprove, onEnable, onDisable }: {
  site: Publication;
  candidate: Candidate | null;
  pending: boolean;
  pendingAction: PublicationAction | null;
  migrateToSharedHost: boolean;
  connectionAvailable: boolean;
  accessNeedsVerification: boolean;
  requiresApproval: boolean;
  enabled: boolean;
  disabled: boolean;
  onPrepare: () => void;
  onApprove: (candidate: Candidate) => void;
  onEnable: () => void;
  onDisable: () => void;
}) {
  if (!connectionAvailable) return null;
  const sameRequestedAudience = samePublicationAudience({ requested: site.requested, approved: site.approved });
  const candidateMatchesApproved = candidate !== null && samePublicationAudience({ requested: candidate.requestedScope, approved: site.approved });
  const approvalLabel = candidate === null || site.approved === null
    ? "Approve audience and publish"
    : !samePublicationAudience({ requested: candidate.requestedScope, approved: site.approved })
      ? publicationAudienceChange(candidate.requestedScope, site.approved) ? "Approve audience and publish" : "Approve destination and publish"
      : "Publish prepared update";
  const prepareLabel = enabled && migrateToSharedHost ? "Prepare update for review" : enabled && sameRequestedAudience ? "Publish latest files" : enabled ? "Prepare update for review" : "Prepare latest files";
  return (
    <Row gap="sm" wrap className="flex-col sm:flex-row">
      <Button id={`bbx-publication-prepare-${site.pubId}`} intent="secondary" disabled={pending} loading={pendingAction === "prepare"} onClick={onPrepare}>{prepareLabel}</Button>
      {candidate && requiresApproval ? <Button id={`bbx-publication-approve-${site.pubId}`} intent="primary" disabled={pending || accessNeedsVerification} loading={pendingAction === "approve"} onClick={() => onApprove(candidate)}>{approvalLabel}</Button> : null}
      {enabled ? <Button id={`bbx-publication-disable-${site.pubId}`} intent="destructive" disabled={pending} loading={pendingAction === "disable"} onClick={onDisable}>Disable site</Button> : null}
      {disabled && (!candidate || candidateMatchesApproved) ? <Button id={`bbx-publication-enable-${site.pubId}`} intent="primary" disabled={pending || accessNeedsVerification} loading={pendingAction === "enable"} onClick={onEnable}>Enable site</Button> : null}
    </Row>
  );
}

function publicationAudienceChange(requested: AudienceSummary, approved: AudienceSummary): boolean {
  if (requested.tier !== approved.tier) return true;
  return requested.tier === "accounts" && approved.tier === "accounts"
    && JSON.stringify([...(requested.allowedEmails ?? [])].toSorted()) !== JSON.stringify([...(approved.allowedEmails ?? [])].toSorted());
}

function CandidateDetails({ candidate, pubId }: { candidate: Candidate; pubId: string }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  return (
    <Stack gap="sm">
      <Heading level={3}>Potential sensitive content</Heading>
      <Text size="xs" tone="muted">Prepared <FriendlyDate iso={candidate.preparedAt} /></Text>
      {candidate.scan.total > 0 ? <Badge tone="warning">Review findings before approving.</Badge> : <Text size="sm">Scanned for known secrets: no matches</Text>}
      {candidate.scan.skippedBinaries > 0 ? <Text size="xs" tone="muted">Some binary files were skipped.</Text> : null}
      <Stack gap="xs">
        {candidate.preview.map((file) => (
          <Row key={file.path} gap="sm" wrap>
            <Text size="xs" breakAll><Text mono breakAll>{file.path}</Text></Text>
            <Text size="xs" tone="muted">· {formatBytes(file.bytes)}</Text>
            <Button id={`bbx-publication-preview-${pubId}-${encodeURIComponent(file.path)}`} size="sm" intent="ghost" onClick={() => setSelectedPath(file.path)}>Inspect text</Button>
          </Row>
        ))}
      </Stack>
      {selectedPath !== null ? (
        <Stack gap="xs">
          <Row justify="between" align="center">
            <Text size="sm" weight="medium">Text preview: <Text mono breakAll>{selectedPath}</Text></Text>
            <Button size="sm" intent="ghost" onClick={() => setSelectedPath(null)}>Close preview</Button>
          </Row>
          <SelectedFilePreview path={selectedPath} pubId={pubId} candidate={candidate} />
        </Stack>
      ) : null}
      {candidate.scan.sample.map((finding) => (
        <Card key={finding.id} muted>
          <Stack gap="xs"><Row gap="sm" wrap><Badge tone="warning">{finding.kind}</Badge><Text mono size="xs">{finding.file}:{finding.line}</Text></Row><Text size="sm">{finding.detail}</Text><Text size="xs" tone="muted" breakAll>{finding.match}</Text></Stack>
        </Card>
      ))}
      {candidate.scan.total > candidate.scan.sample.length ? <Hint>Showing {candidate.scan.sample.length} of {candidate.scan.total} findings.</Hint> : null}
    </Stack>
  );
}

function SelectedFilePreview({ path, pubId, candidate }: { path: string; pubId: string; candidate: Candidate }) {
  const filePreview = trpc.publications.releaseFile.useQuery({ pubId, releaseId: candidate.releaseId, path });
  return <FilePreview path={path} error={filePreview.error?.message ?? null} loading={filePreview.isLoading} result={filePreview.data ?? undefined} />;
}

function FilePreview({ path, error, loading, result }: { path: string; error: string | null; loading: boolean; result: PreviewResult | undefined }) {
  if (error !== null) return <div role="alert"><ErrorText>{error}</ErrorText></div>;
  if (loading) return <StatusMessage>Loading text preview…</StatusMessage>;
  const preview = result;
  if (preview === undefined) return null;
  if (preview.kind === "binary") return <Hint>{path} is a binary file ({formatBytes(preview.bytes)}); its contents are not previewed.</Hint>;
  if (preview.kind === "too-large") return <Hint>{path} is too large to inspect here ({formatBytes(preview.bytes)}; limit {formatBytes(preview.limit)}).</Hint>;
  return (
    <Stack gap="xs">
      <Text size="xs" tone="muted">Plain text · {preview.contentType} · {formatBytes(preview.bytes)}</Text>
      <Pre boxed scroll="lg">{preview.text}</Pre>
    </Stack>
  );
}

function AudienceBlock({ title, value }: { title: string; value: AudienceSummary | null }) {
  if (value === null) return <Stack gap="xs"><Heading level={3}>{title}</Heading><Text size="sm" tone="muted">Not set</Text></Stack>;
  const emails = value.tier === "accounts" ? value.allowedEmails ?? [] : [];
  return (
    <Stack gap="xs" className="min-w-56">
      <Heading level={3}>{title}</Heading>
      <Text size="sm">Tier: <Text weight="medium">{value.tier}</Text></Text>
      {"status" in value ? <Text size="sm">State: {value.status}</Text> : null}
      {value.tier === "public" && value.slug ? <Text size="sm">Public path: <Text mono>/p/{value.slug}/</Text></Text> : null}
      {publicationCustomHostname(value) ? <Text size="sm">Custom hostname: <Text mono breakAll>{publicationCustomHostname(value)}</Text></Text> : null}
      {emails.length > 0 ? <Text size="sm">Allowed accounts: {emails.join(", ")}</Text> : null}
      {value.expiresAt ? <Text size="sm">Expires: <FriendlyDate iso={value.expiresAt} /></Text> : null}
    </Stack>
  );
}

function RemoteState({ reason }: { reason: RemoteUnavailable["reason"] }) {
  const message = {
    "connection-missing": "The saved Cloudflare connection is missing.",
    "connection-revoked": "The saved Cloudflare token was revoked.",
    "grant-missing": "This box no longer has a server grant for the Cloudflare connection.",
    "cloudflare-unavailable": "Cloudflare could not be reached, so the current serving state could not be checked.",
  }[reason];
  return <div role="alert"><Badge tone="danger">Remote state unavailable</Badge><Text size="sm"> {message} Mutations are disabled until the site state can be checked.</Text></div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function publicationCustomHostname(value: object | null): string | undefined {
  return value !== null && "customHostname" in value && typeof value.customHostname === "string"
    ? value.customHostname
    : undefined;
}
