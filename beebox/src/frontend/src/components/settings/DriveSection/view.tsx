/**
 * Google Drive section: the box's mount manager.
 *
 * A Drive mount is a card — `.gdoc.card`/`.gsheet.card` for a synced file,
 * `.gfolder.card` for a mirrored folder, `.glink.card` for a pointer — so this
 * lists cards, not config. The mutations behind the forms are the same
 * operations `bbx drive mount` / `link` / `unmount` run, which is why the page
 * and the agent can never disagree about what a mount is.
 *
 * Chat is still the primary path (paste a Drive URL, say what you want); this
 * is for seeing everything at once and for the boxholder who would rather
 * type into a form than ask.
 */

import { trpc } from "../../../lib/trpc/client";
import { Stack } from "../../ui/Stack";
import { Text } from "../../ui/Text";
import { Hint } from "../../ui/Hint";
import { Notice } from "../../ui/Notice";
import { Heading } from "../../ui/Heading";
import { Card } from "../../ui/Card";
import { GoogleConnectLink } from "../GoogleConnectLink";
import { DriveMountRow } from "./DriveMountRow";
import { AddPointerForm, MountFolderForm } from "./DriveMountForms";
import { DriveScheduleLine } from "./DriveScheduleLine";

function DriveShell({ children }: { children: React.ReactNode }) {
  return (
    <Card material padding="lg" border="none" shadow>
      <Heading level={2} className="mb-2">Google Drive</Heading>
      {children}
    </Card>
  );
}

export function DriveSection() {
  const mountsQuery = trpc.drive.mounts.useQuery();
  const configQuery = trpc.drive.config.useQuery();
  const error = mountsQuery.error?.message ?? configQuery.error?.message ?? null;

  if (error !== null) {
    return (
      <DriveShell>
        <Notice tone="warning">{error}</Notice>
        {/* Distinct id from the not-connected branch below: ids are authored
            once (ui-scan annotations test counts source literals), even
            when the branches are mutually exclusive at runtime. */}
        <GoogleConnectLink id="bbx-settings-drive-connect-google-error" />
      </DriveShell>
    );
  }

  const data = mountsQuery.data;
  if (data === undefined) {
    return (
      <DriveShell>
        <Text size="sm" tone="muted">Loading Drive mounts…</Text>
      </DriveShell>
    );
  }

  // An unconverted `folders` array from a box set up before mounts were cards.
  // The next Drive sync turns each entry into a mount card; until then it is
  // real configuration doing real work, so it is listed rather than hidden.
  const legacyFolders = configQuery.data?.folders ?? [];

  if (!data.connected) {
    return (
      <DriveShell>
        <Text size="sm">
          Google isn&apos;t connected for this box, so there is nothing to mirror
          from yet.
        </Text>
        <GoogleConnectLink id="bbx-settings-drive-connect-google" />
      </DriveShell>
    );
  }

  return (
    <DriveShell>
      <Text size="sm" tone="muted" className="mb-4">
        A mirrored folder keeps a box directory in step with a Drive folder. You
        can also ask in chat — paste a Drive link and say what you want done
        with it.
      </Text>

      <Stack gap="md">
        {data.mounts.length === 0 ? (
          <Hint>No folders are mirrored yet.</Hint>
        ) : (
          <Stack gap="sm">
            {data.mounts.map((mount) => (
              <DriveMountRow key={mount.cardPath} mount={mount} />
            ))}
            {/* Only with something mirrored: on a box with no mounts, what the
                hourly sync would do is nothing, and saying so is noise. */}
            <DriveScheduleLine />
          </Stack>
        )}

        {legacyFolders.length === 0 ? null : (
          <Stack gap="xs">
            <Heading level={3}>Folder mounts awaiting conversion</Heading>
            {legacyFolders.map((folder) => (
              <Text key={folder.driveFolderId} size="sm" tone="muted">{folder.localPath}</Text>
            ))}
            <Text size="xs" tone="muted">
              The next Drive sync turns each of these into a folder card in that
              directory.
            </Text>
          </Stack>
        )}

        <MountFolderForm />
        <AddPointerForm />
      </Stack>
    </DriveShell>
  );
}
