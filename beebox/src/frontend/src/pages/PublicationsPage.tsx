/** Box-member review and serving controls for generated publication sites. */

import { useState } from "react";
import { trpc, type RouterOutput } from "../lib/trpc";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ErrorText } from "../components/ui/ErrorText";
import { ExternalLink } from "../components/ui/ExternalLink";
import { FriendlyDate } from "../components/ui/FriendlyDate";
import { Heading } from "../components/ui/Heading";
import { Hint } from "../components/ui/Hint";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { StatusMessage } from "../components/ui/StatusMessage";
import { Pre } from "../components/ui/Pre";
import { Text } from "../components/ui/Text";
import { SignInLink } from "../components/BoxSelectionTiles";

type Publication = RouterOutput["publications"]["list"]["sites"][number];
type Candidate = NonNullable<Publication["pending"]>;
type PreviewResult = RouterOutput["publications"]["previewFile"];
type AudienceSummary = NonNullable<Publication["pending"]>["requestedScope"] | NonNullable<Publication["requested"]> | NonNullable<Publication["approved"]>;
type RemoteUnavailable = Extract<Publication["remoteStatus"], { status: "unavailable" }>;

export function PublicationsPage() {
  const query = trpc.publications.list.useQuery();
  const utils = trpc.useUtils();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const refreshList = () => utils.publications.list.invalidate();
  const prepare = trpc.publications.prepare.useMutation({
    onSuccess: async () => { setMutationError(null); await refreshList(); },
    onError: (error) => setMutationError(error.message),
  });
  const approve = trpc.publications.approve.useMutation({
    onSuccess: async () => { setMutationError(null); await refreshList(); },
    onError: (error) => setMutationError(error.message),
  });
  const enable = trpc.publications.enable.useMutation({
    onSuccess: async () => { setMutationError(null); await refreshList(); },
    onError: (error) => setMutationError(error.message),
  });
  const disable = trpc.publications.disable.useMutation({
    onSuccess: async () => { setMutationError(null); await refreshList(); },
    onError: (error) => setMutationError(error.message),
  });

  const pending = prepare.isPending || approve.isPending || enable.isPending || disable.isPending;

  return (
    <Stack gap="none" overflow="auto" focusable className="h-full">
      <Stack gap="lg" className="max-w-3xl mx-auto py-8 px-4 w-full">
        <Stack gap="xs">
          <Text as="h1" size="2xl" weight="bold">Publications</Text>
          <Hint>Review what this box has prepared, approve audience changes, and control whether a site is available. This page shows summaries only; it never runs published site code.</Hint>
        </Stack>

        {mutationError ? <div role="alert"><ErrorText>{mutationError}</ErrorText></div> : null}
        {query.error ? <div role="alert"><Card><Stack gap="sm"><ErrorText>{query.error.message}</ErrorText>{query.error.data?.code === "UNAUTHORIZED" || query.error.data?.code === "FORBIDDEN" ? <SignInLink returnTo={window.location.pathname + window.location.search} /> : <Button id="bbx-publications-retry" intent="secondary" onClick={() => void query.refetch()}>Retry</Button>}</Stack></Card></div> : null}
        {query.isLoading ? <StatusMessage>Loading publications…</StatusMessage> : null}
        {query.data?.sites.length === 0 ? (
          <Card><Stack gap="sm"><Heading level={2}>Nothing prepared yet</Heading><Text size="sm">Ask the box agent to prepare a publication. It will appear here for review.</Text></Stack></Card>
        ) : null}
        {query.data?.sites.map((site) => (
          <PublicationCard
            key={site.pubId}
            site={site}
            pending={pending}
            onPrepare={() => { setMutationError(null); prepare.mutate({ name: site.name }); }}
            onApprove={(candidate) => { setMutationError(null); approve.mutate({ pubId: site.pubId, expectedRevision: candidate.revision }); }}
            onEnable={() => { setMutationError(null); enable.mutate({ pubId: site.pubId }); }}
            onDisable={() => { setMutationError(null); disable.mutate({ pubId: site.pubId }); }}
          />
        ))}
      </Stack>
    </Stack>
  );
}

function PublicationCard({
  site,
  pending,
  onPrepare,
  onApprove,
  onEnable,
  onDisable,
}: {
  site: Publication;
  pending: boolean;
  onPrepare: () => void;
  onApprove: (candidate: Candidate) => void;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const candidate = site.pending;
  const siteUrl = publicationUrl(site);

  return (
    <Card as="article" aria-labelledby={`bbx-publication-heading-${site.pubId}`} shadow>
      <Stack gap="md">
        <Stack gap="xs">
          <PublicationHeading site={site} />
          {siteUrl ? <ExternalLink id={`bbx-publication-open-${site.pubId}`} href={siteUrl} variant="button">Open site</ExternalLink> : <Text size="sm" tone="muted">Site URL is assigned after the first successful preparation.</Text>}
        </Stack>

        {site.remoteStatus.status === "unavailable" ? <RemoteState reason={site.remoteStatus.reason} /> : null}

        <Row gap="md" wrap align="start">
          <AudienceBlock title="Requested audience" value={candidate?.requestedScope ?? site.requested} />
          <AudienceBlock title="Approved audience" value={site.approved} />
        </Row>

        <Stack gap="xs">
          <Heading level={3}>Current release</Heading>
          <Text size="sm">{site.activeReleaseId === null ? "No release is active." : <><Text mono>{site.activeReleaseId}</Text> · {candidate?.preview.length ?? 0} files in latest preparation</>}</Text>
        </Stack>

        {candidate ? <CandidateDetails candidate={candidate} pubId={site.pubId} /> : <Text size="sm" tone="muted">No prepared update is waiting for review.</Text>}
        <PublicationActions site={site} candidate={candidate} pending={pending} onPrepare={onPrepare} onApprove={onApprove} onEnable={onEnable} onDisable={onDisable} />
      </Stack>
    </Card>
  );
}

function PublicationHeading({ site }: { site: Publication }) {
  const state = site.remoteStatus.status === "unavailable" ? "serving state unknown" : site.approved?.status ?? "not enabled";
  const tone = state === "live" ? "success" : state === "disabled" ? "warning" : "neutral";
  return (
    <Row gap="sm" wrap align="center">
      <Heading id={`bbx-publication-heading-${site.pubId}`} level={2}>{site.title || site.name}</Heading>
      <Badge tone={tone}>{state}</Badge>
      {site.connection.status !== "active" ? <Badge tone="danger">connection {site.connection.status}</Badge> : null}
    </Row>
  );
}

function PublicationActions({ site, candidate, pending, onPrepare, onApprove, onEnable, onDisable }: {
  site: Publication;
  candidate: Candidate | null;
  pending: boolean;
  onPrepare: () => void;
  onApprove: (candidate: Candidate) => void;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const connectionAvailable = site.connection.status === "active" && site.remoteStatus.status === "available";
  const requestedTier = candidate?.requestedScope.tier ?? site.approved?.tier;
  const accessNeedsVerification = (requestedTier === "accounts" || requestedTier === "any-account") && site.connection.capabilities.accessLive !== "verified";
  const requiresApproval = candidate !== null && (
    !sameAudience(candidate.requestedScope, site.approved) ||
    site.approved?.status === "disabled" ||
    site.approved === null
  );
  const enabled = site.approved?.status === "live";
  const disabled = site.approved?.status === "disabled";
  return (
    <Stack gap="xs">
      <PublicationActionButtons site={site} candidate={candidate} pending={pending} connectionAvailable={connectionAvailable} accessNeedsVerification={accessNeedsVerification} requiresApproval={requiresApproval} enabled={enabled} disabled={disabled} onPrepare={onPrepare} onApprove={onApprove} onEnable={onEnable} onDisable={onDisable} />
      {site.connection.status !== "active" ? <Hint>Restore this box&apos;s Cloudflare server grant in Admin before managing the site.</Hint> : null}
      {accessNeedsVerification ? <Hint>Account-restricted sites cannot be approved until this connection&apos;s Cloudflare Access capability has been verified.</Hint> : null}
      {disabled && !requiresApproval ? <Hint>Enabling allows the agent to update this site within the approved audience. Audience changes always need your approval.</Hint> : null}
      {enabled && sameAudience(site.requested, site.approved) ? <Hint>Publishing within the approved audience takes effect immediately. Audience changes wait for your approval.</Hint> : null}
    </Stack>
  );
}

function PublicationActionButtons({ site, candidate, pending, connectionAvailable, accessNeedsVerification, requiresApproval, enabled, disabled, onPrepare, onApprove, onEnable, onDisable }: {
  site: Publication;
  candidate: Candidate | null;
  pending: boolean;
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
  const sameRequestedAudience = sameAudience(site.requested, site.approved);
  const prepareLabel = enabled && sameRequestedAudience ? "Publish latest files" : enabled ? "Prepare update for review" : "Prepare latest files";
  return (
    <Row gap="sm" wrap>
      <Button id={`bbx-publication-prepare-${site.pubId}`} intent="secondary" disabled={pending || !connectionAvailable} loading={pending} onClick={onPrepare}>{prepareLabel}</Button>
      {candidate && requiresApproval ? <Button id={`bbx-publication-approve-${site.pubId}`} intent="primary" disabled={pending || !connectionAvailable || accessNeedsVerification} loading={pending} onClick={() => onApprove(candidate)}>{sameAudience(candidate.requestedScope, site.approved) ? "Approve update and publish" : "Approve audience and publish"}</Button> : null}
      {enabled ? <Button id={`bbx-publication-disable-${site.pubId}`} intent="destructive" disabled={pending || !connectionAvailable} loading={pending} onClick={onDisable}>Disable site</Button> : null}
      {disabled && !requiresApproval ? <Button id={`bbx-publication-enable-${site.pubId}`} intent="primary" disabled={pending || !connectionAvailable || accessNeedsVerification} loading={pending} onClick={onEnable}>Enable site</Button> : null}
    </Row>
  );
}

function CandidateDetails({ candidate, pubId }: { candidate: Candidate; pubId: string }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const filePreview = trpc.publications.previewFile.useQuery(
    { pubId, expectedRevision: candidate.revision, path: selectedPath ?? "" },
    { enabled: selectedPath !== null },
  );

  return (
    <Stack gap="sm">
      <Heading level={3}>Prepared files and scan</Heading>
      <Text size="xs" tone="muted">Prepared <FriendlyDate iso={candidate.preparedAt} /> · release <Text mono>{candidate.releaseId}</Text></Text>
      <Text size="sm">Files: {candidate.preview.length} · scan findings: {candidate.scan.total} · skipped binaries: {candidate.scan.skippedBinaries}</Text>
      {candidate.scan.total > 0 ? <Badge tone="warning">Review the findings below before approving this audience.</Badge> : <Badge tone="success">No text scan findings</Badge>}
      <Stack gap="xs">
        {candidate.preview.map((file) => (
          <Row key={file.path} gap="sm" wrap>
            <Text size="xs"><Text mono>{file.path}</Text> · {formatBytes(file.bytes)}</Text>
          <Button id={`bbx-publication-preview-${pubId}-${encodeURIComponent(file.path)}`} size="sm" intent="ghost" onClick={() => setSelectedPath(file.path)}>Inspect text</Button>
          </Row>
        ))}
      </Stack>
      {selectedPath !== null ? <FilePreview path={selectedPath} error={filePreview.error?.message ?? null} loading={filePreview.isLoading} result={filePreview.data ?? undefined} /> : null}
      {candidate.scan.sample.map((finding) => (
        <Card key={finding.id} muted>
          <Stack gap="xs"><Row gap="sm" wrap><Badge tone="warning">{finding.kind}</Badge><Text mono size="xs">{finding.file}:{finding.line}</Text></Row><Text size="sm">{finding.detail}</Text><Text size="xs" tone="muted" breakAll>{finding.match}</Text></Stack>
        </Card>
      ))}
      {candidate.scan.total > candidate.scan.sample.length ? <Hint>Showing {candidate.scan.sample.length} of {candidate.scan.total} findings.</Hint> : null}
    </Stack>
  );
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

function sameAudience(requested: AudienceSummary | null, approved: Publication["approved"]): boolean {
  if (requested === null || approved === null || requested.tier !== approved.tier) return false;
  if (requested.tier === "public" && approved.tier === "public") return (requested.slug ?? null) === (approved.slug ?? null);
  if (requested.tier === "accounts" && approved.tier === "accounts") {
    return JSON.stringify([...(requested.allowedEmails ?? [])].toSorted()) === JSON.stringify([...(approved.allowedEmails ?? [])].toSorted());
  }
  return requested.tier === "secret" || requested.tier === "any-account";
}

function publicationUrl(site: Publication): string | null {
  if (site.hostname === null) return null;
  const hostname = site.hostname;
  const pubId = site.pubId;
  const tier = site.approved?.tier ?? site.requested?.tier ?? "secret";
  const prefix = tier === "secret" ? `/s/${pubId}/` : tier === "accounts" || tier === "any-account" ? `/a/${pubId}/` : "/";
  return `https://${hostname}${prefix}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
