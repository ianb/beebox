/**
 * The two ways to add a Drive card from the settings page: mirror a folder, or
 * point at one item.
 *
 * Neither form defaults the destination. Where a mount lands is the mount's
 * configuration — the card's directory IS the mirror — so guessing it would be
 * guessing at box structure. In chat the agent proposes a directory and asks;
 * here the boxholder types one.
 */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextField } from "../ui/fields";

function MutationError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div className="p-2 bg-warning-50 border border-warning-100 rounded text-sm text-warning-dark">
      {message}
    </div>
  );
}

/** Mirror a Drive folder into a box directory. */
export function MountFolderForm() {
  const utils = trpc.useUtils();
  const mountMutation = trpc.drive.mount.useMutation();
  const [url, setUrl] = useState("");
  const [dir, setDir] = useState("");
  const [mounted, setMounted] = useState<string | null>(null);

  const ready = url.trim() !== "" && dir.trim() !== "";

  const submit = async () => {
    if (!ready) return;
    try {
      const result = await mountMutation.mutateAsync({ url: url.trim(), dir: dir.trim() });
      setMounted(`Mirroring ${result.name} into ${result.cardPath}`);
      setUrl("");
      setDir("");
      void utils.drive.mounts.invalidate();
    } catch (_e) {
      // Surfaced below through the mutation's own error state.
    }
  };

  return (
    <Stack gap="sm">
      <Text as="h3" size="sm" weight="semibold">Mirror a folder</Text>
      <Text size="sm" tone="muted">
        Docs and Sheets in the folder become synced cards in that directory;
        everything else becomes a pointer.
      </Text>
      <Row gap="md" align="end" wrap>
        <TextField
          id="bbx-settings-drive-mount-url"
          label="Drive folder URL"
          value={url}
          onChange={setUrl}
          required
          className="flex-1 min-w-64"
        />
        <TextField
          id="bbx-settings-drive-mount-dir"
          label="Box directory"
          value={dir}
          onChange={setDir}
          required
          helper="e.g. _content/drive/recipes"
          className="flex-1 min-w-64"
        />
        <Button
          id="bbx-settings-drive-mount-submit"
          intent="primary"
          disabled={!ready}
          loading={mountMutation.isPending}
          loadingLabel="Mirroring…"
          onClick={() => void submit()}
        >
          Mirror
        </Button>
      </Row>
      <MutationError message={mountMutation.error?.message ?? null} />
      {mounted === null ? null : <Text size="sm" tone="muted">{mounted}</Text>}
    </Stack>
  );
}

/** Point at one Drive item without copying it. */
export function AddPointerForm() {
  const utils = trpc.useUtils();
  const linkMutation = trpc.drive.link.useMutation();
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [linked, setLinked] = useState<string | null>(null);

  const ready = url.trim() !== "" && path.trim() !== "";

  const submit = async () => {
    if (!ready) return;
    try {
      const result = await linkMutation.mutateAsync({ url: url.trim(), path: path.trim() });
      setLinked(`Pointing at ${result.name} from ${result.cardPath}`);
      setUrl("");
      setPath("");
      void utils.drive.mounts.invalidate();
    } catch (_e) {
      // Surfaced below through the mutation's own error state.
    }
  };

  return (
    <Stack gap="sm">
      <Text as="h3" size="sm" weight="semibold">Add a pointer</Text>
      <Text size="sm" tone="muted">
        A card that records what a Drive item is and where it lives. Nothing is
        copied — good for a PDF, a Slides deck, or a folder you don&apos;t want
        mirrored.
      </Text>
      <Row gap="md" align="end" wrap>
        <TextField
          id="bbx-settings-drive-link-url"
          label="Drive URL"
          value={url}
          onChange={setUrl}
          required
          className="flex-1 min-w-64"
        />
        <TextField
          id="bbx-settings-drive-link-path"
          label="Card path"
          value={path}
          onChange={setPath}
          required
          helper="e.g. _content/tax/Receipt_2026"
          className="flex-1 min-w-64"
        />
        <Button
          id="bbx-settings-drive-link-submit"
          intent="secondary"
          disabled={!ready}
          loading={linkMutation.isPending}
          loadingLabel="Adding…"
          onClick={() => void submit()}
        >
          Add pointer
        </Button>
      </Row>
      <MutationError message={linkMutation.error?.message ?? null} />
      {linked === null ? null : <Text size="sm" tone="muted">{linked}</Text>}
    </Stack>
  );
}
