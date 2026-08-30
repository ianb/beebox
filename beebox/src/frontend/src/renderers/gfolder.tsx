/**
 * Gfolder renderer — what the box actually holds for a mirrored Drive folder.
 *
 * The card IS the mount and its directory IS the membership, so this view is
 * the directory listing (`DirectoryListing`, the same component and the same
 * `status.browse` query the plain directory view uses) plus one column saying
 * what each child is to Drive: synced, conflicted, a pointer, a nested mount,
 * or nothing to do with Drive.
 *
 * Deliberately **no remote listing** (plan Track 4): everything here is box
 * state. A child reads "synced" because its own card says so, not because
 * Drive was asked. "Sync now" is how the boxholder reconciles the two, and it
 * reports what the pass did — created/updated paths, notes, failures —
 * because a button that goes quiet is indistinguishable from one that worked
 * (principle 13).
 */

import { useParams } from "@tanstack/react-router";
import { trpc } from "../lib/trpc";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ExternalLink } from "../components/ui/ExternalLink";
import { FriendlyDate } from "../components/ui/FriendlyDate";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { DRIVE_CHILD_BADGES, driveChildState } from "../lib/drive-card-display";
import { DirectoryListing, useDirectoryListing, type BrowseCardEntry } from "./directory";
import { registerFileType, type RendererProps } from "./index";

/** The frontmatter field, when it is a non-empty string. */
function field(fm: Record<string, unknown>, key: string): string | null {
  const value = fm[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** A frontmatter count, when it is a positive whole number. */
function count(fm: Record<string, unknown>, key: string): number {
  const value = fm[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * Children the last pass could not account for — still on disk, no longer
 * covered by the mirror. Quiet when there are none.
 */
function problemSummary(frontmatter: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const notInFolder = count(frontmatter, "not-in-folder");
  const unknown = count(frontmatter, "unknown");
  if (notInFolder > 0) parts.push(`${String(notInFolder)} not in folder`);
  if (unknown > 0) parts.push(`${String(unknown)} unknown`);
  return parts.length === 0 ? null : parts.join(", ");
}

/** The box-relative directory a card sits in ("" at the box root). */
function dirOf(cardPath: string): string {
  const cut = cardPath.lastIndexOf("/");
  return cut === -1 ? "" : cardPath.slice(0, cut);
}

/** The Drive state column for one child of the mirrored directory. */
function ChildState({ card }: { card: BrowseCardEntry }) {
  const badge = DRIVE_CHILD_BADGES[driveChildState(card)];
  return <Badge size="sm" tone={badge.tone} title={badge.title}>{badge.label}</Badge>;
}

/** Name, Drive link, and the outcome of the last mirror pass. */
function MountHeader({ path, frontmatter }: { path: string; frontmatter: Record<string, unknown> }) {
  const name = field(frontmatter, "name");
  const link = field(frontmatter, "link");
  const status = field(frontmatter, "status");
  const lastSync = field(frontmatter, "last-sync");
  const error = field(frontmatter, "error");
  const driveId = field(frontmatter, "drive-id");

  return (
    <Stack gap="xs">
      <Row gap="sm" align="center" wrap>
        <Text as="h2" size="lg" weight="semibold">{name ?? "Drive folder"}</Text>
        {status === "error" ? <Badge tone="danger">error</Badge> : null}
        {status === "ok" ? <Badge tone="success">mirrored</Badge> : null}
        {status === null ? <Badge tone="neutral">never synced</Badge> : null}
        {link === null ? null : (
          <ExternalLink href={link} id="bbx-gfolder-open-in-drive">Open in Drive</ExternalLink>
        )}
      </Row>
      <Text size="sm" tone="muted">
        mirrors into {dirOf(path) === "" ? "the box root" : dirOf(path)}
        {problemSummary(frontmatter) === null ? null : <>{" · "}{problemSummary(frontmatter)}</>}
        {lastSync === null ? null : <>{" · last sync "}<FriendlyDate iso={lastSync} /></>}
        {driveId === null ? null : <>{" · "}<Text size="xs" mono tone="muted">{driveId}</Text></>}
      </Text>
      {error === null ? null : <Text size="sm" tone="danger">{error}</Text>}
    </Stack>
  );
}

/** One line per bucket of a finished mirror pass — empty buckets stay quiet. */
function SyncOutcome({ result }: {
  result: { created: string[]; updated: string[]; pushed: string[]; notes: string[]; failures: string[] };
}) {
  const counts = [
    result.created.length === 0 ? null : `${String(result.created.length)} created`,
    result.updated.length === 0 ? null : `${String(result.updated.length)} updated`,
    result.pushed.length === 0 ? null : `${String(result.pushed.length)} pushed`,
  ].filter((part) => part !== null);

  return (
    <Stack gap="xs">
      <Text size="sm" tone={result.failures.length > 0 ? "danger" : "muted"}>
        {counts.length === 0 ? "Mirrored — nothing changed." : `Mirrored — ${counts.join(", ")}.`}
      </Text>
      {result.notes.map((note) => (
        <Text key={note} size="sm" tone="muted">{note}</Text>
      ))}
      {result.failures.map((failure) => (
        <Text key={failure} size="sm" tone="danger">{failure}</Text>
      ))}
    </Stack>
  );
}

function GfolderView({ data, onNavigate }: RendererProps) {
  const { boxSlug } = useParams({ strict: false });
  const utils = trpc.useUtils();
  const dirPath = dirOf(data.path);
  const listing = useDirectoryListing(dirPath);
  const syncMutation = trpc.drive.syncFolder.useMutation();

  const syncNow = async (): Promise<void> => {
    // Clear the previous pass's outcome first: a stale "nothing changed" sitting
    // under a running sync reads as this sync's answer.
    syncMutation.reset();
    try {
      await syncMutation.mutateAsync({ cardPath: data.path });
      // The pass rewrote the directory and this card: drop every cached read
      // of either, so the list below shows the children the sync just made
      // rather than the ones it replaced.
      void utils.status.browse.invalidate();
      void utils.card.get.invalidate();
      void utils.drive.mounts.invalidate();
    } catch (_e) {
      // Surfaced below through the mutation's own error state.
    }
  };

  const frontmatter = data.frontmatter ?? {};

  return (
    <Stack gap="md" className="p-4">
      <MountHeader path={data.path} frontmatter={frontmatter} />

      <Row gap="sm" align="center" wrap>
        <Button
          id="bbx-gfolder-sync"
          size="sm"
          intent="secondary"
          loading={syncMutation.isPending}
          loadingLabel="Syncing…"
          onClick={() => void syncNow()}
        >
          Sync now
        </Button>
      </Row>

      {syncMutation.error === null ? null : (
        <Text as="div" size="sm" tone="danger" className="p-2">
          {syncMutation.error.message}
        </Text>
      )}
      {syncMutation.data === undefined ? null : (
        <SyncOutcome result={syncMutation.data} />
      )}

      <Stack gap="xs">
        <Text size="sm" weight="semibold" uppercase tone="muted">Mirrored here</Text>
        {listing.isLoading ? <Text size="sm" tone="subtle">Loading…</Text> : null}
        {listing.error === null ? null : (
          <Text size="sm" tone="danger">Error: {listing.error.message}</Text>
        )}
        {listing.data === undefined ? null : (
          <DirectoryListing
            browse={listing.data}
            dirPath={dirPath}
            boxSlug={boxSlug}
            onNavigate={onNavigate}
            omitCardPath={data.path}
            annotate={(card) => <ChildState card={card} />}
          />
        )}
      </Stack>
    </Stack>
  );
}

registerFileType({ type: "gfolder" }, {
  renderer: { name: "Drive folder", Component: GfolderView, priority: 100 },
});
