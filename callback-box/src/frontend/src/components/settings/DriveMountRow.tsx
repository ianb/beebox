/**
 * One Drive folder mount: where it mirrors to, what Drive last said, and the
 * two things the boxholder can do to it.
 *
 * The row owns its own mutations rather than sharing the section's, so a sync
 * that is running and an unmount that failed are visible on the mount they
 * belong to — a page-level pending state would say "something is happening"
 * about a list.
 *
 * Unmount asks twice. It is not destructive (children stay; the card is
 * recoverable from `store/trash/`), but it silently stops a thing the box was
 * doing, and a mis-click there is not visible until the next sync fails to
 * happen. The second step is inline rather than a browser `confirm()` so it
 * renders like the rest of the page and can say what unmounting actually does.
 */

import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { href } from "../../lib/routing";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { FriendlyDate } from "../ui/FriendlyDate";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { cbSource } from "../../lib/source-tag";

export type DriveMount = RouterOutput["drive"]["mounts"]["mounts"][number];

/** Preserve case-sensitive Drive identity inside the scan's lowercase id grammar. */
export function driveControlId(action: "cancel" | "confirm" | "open" | "sync" | "unmount", driveId: string): string {
  const encodedId = [...driveId]
    .map((character) => character.codePointAt(0)?.toString(16).padStart(6, "0"))
    .join("");
  return `cb-settings-drive-${action}-id-${encodedId}`;
}

function childSummary(children: DriveMount["children"]): string {
  const parts: string[] = [];
  parts.push(children.files === 1 ? "1 synced file" : `${String(children.files)} synced files`);
  parts.push(children.links === 1 ? "1 pointer" : `${String(children.links)} pointers`);
  return parts.join(", ");
}

/**
 * Children the last pass could not account for. Not an error — they are still
 * on disk and a `not-in-folder` child is still syncing — but the mirror is not
 * the whole folder any more, and that only shows if it is said.
 */
function problemSummary(problems: DriveMount["problems"]): string | null {
  const parts: string[] = [];
  if (problems.notInFolder > 0) parts.push(`${String(problems.notInFolder)} not in folder`);
  if (problems.unknown > 0) parts.push(`${String(problems.unknown)} unknown`);
  return parts.length === 0 ? null : parts.join(", ");
}

export interface UnmountControlProps {
  driveId: string;
  /** True once the boxholder has asked to unmount and is being asked again. */
  confirming: boolean;
  /** Any mutation on this row is in flight. */
  busy: boolean;
  /** The unmount itself is in flight. */
  pending: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The two-step unmount: a plain button, then an inline question and a pair of
 * answers. Deliberately not a browser `confirm()` — that dialog cannot say what
 * unmounting does, and it is the one piece of this page a boxholder should read
 * before clicking through.
 */
export function UnmountControl(props: UnmountControlProps) {
  if (!props.confirming) {
    return (
      <Button
        id={driveControlId("unmount", props.driveId)}
        size="sm"
        intent="ghost"
        disabled={props.busy}
        onClick={props.onAsk}
      >
        Unmount
      </Button>
    );
  }
  return (
    <>
      <Text size="sm">Stop mirroring? Children stay where they are.</Text>
      <Button
        id={driveControlId("confirm", props.driveId)}
        size="sm"
        intent="destructive"
        disabled={props.busy}
        loading={props.pending}
        loadingLabel="Unmounting…"
        onClick={props.onConfirm}
      >
        Yes, unmount
      </Button>
      <Button
        id={driveControlId("cancel", props.driveId)}
        size="sm"
        intent="ghost"
        disabled={props.pending}
        onClick={props.onCancel}
      >
        Cancel
      </Button>
    </>
  );
}

export function DriveMountRow({ mount }: { mount: DriveMount }) {
  const { boxSlug } = useParams({ strict: false });
  const utils = trpc.useUtils();
  const syncMutation = trpc.drive.syncFolder.useMutation();
  const unmountMutation = trpc.drive.unmount.useMutation();
  const [confirming, setConfirming] = useState(false);

  const refresh = () => {
    void utils.drive.mounts.invalidate();
  };

  const syncNow = async () => {
    try {
      await syncMutation.mutateAsync({ cardPath: mount.cardPath });
      refresh();
    } catch (_e) {
      // Surfaced below through the mutation's own error state.
    }
  };

  const unmount = async () => {
    try {
      await unmountMutation.mutateAsync({ cardPath: mount.cardPath });
      setConfirming(false);
      refresh();
    } catch (_e) {
      // Surfaced below through the mutation's own error state.
    }
  };

  const busy = syncMutation.isPending || unmountMutation.isPending;
  const error = syncMutation.error?.message ?? unmountMutation.error?.message ?? null;

  return (
    <Stack
      gap="xs"
      className="px-3 py-3 rounded bg-warm-50"
      {...cbSource("card", mount.cardPath)}
    >
      <Row gap="sm" align="center" wrap>
        <Text weight="semibold">{mount.name ?? mount.cardPath}</Text>
        {mount.status === "error" ? <Badge tone="danger">error</Badge> : null}
        {mount.status === "ok" ? <Badge tone="success">synced</Badge> : null}
        {mount.status === null ? <Badge tone="neutral">never synced</Badge> : null}
      </Row>

      <Text size="sm" tone="muted">
        mirrors into {mount.dir === "" ? "the box root" : mount.dir} · {childSummary(mount.children)}
        {problemSummary(mount.problems) === null ? null : <>{" · "}{problemSummary(mount.problems)}</>}
        {mount.lastSync === null ? null : (
          <>
            {" · last sync "}
            <FriendlyDate iso={mount.lastSync} />
          </>
        )}
      </Text>

      {mount.error === null ? null : (
        <Text size="sm" tone="danger">{mount.error}</Text>
      )}

      <Row gap="sm" align="center" wrap>
        <Link
          id={driveControlId("open", mount.driveId)}
          to={href(`/${boxSlug}/browse/${mount.cardPath}`)}
          className="text-sm text-primary hover:text-primary-dark underline"
        >
          Open
        </Link>
        <Button
          id={driveControlId("sync", mount.driveId)}
          size="sm"
          intent="secondary"
          disabled={busy}
          loading={syncMutation.isPending}
          loadingLabel="Syncing…"
          onClick={() => void syncNow()}
        >
          Sync now
        </Button>
        <UnmountControl
          driveId={mount.driveId}
          confirming={confirming}
          busy={busy}
          pending={unmountMutation.isPending}
          onAsk={() => { setConfirming(true); }}
          onCancel={() => { setConfirming(false); }}
          onConfirm={() => void unmount()}
        />
      </Row>

      {error === null ? null : (
        <div className="p-2 bg-warning-50 border border-warning-100 rounded text-sm text-warning-dark">
          {error}
        </div>
      )}
    </Stack>
  );
}
