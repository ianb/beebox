/**
 * One line about the box's hourly Drive sync, shown once the box mirrors
 * something.
 *
 * `check-drive` ships seeded and disabled, so a box can hold a perfectly good
 * mount that nothing keeps in step — and nothing on this page said so. The line
 * says which state the box is in, and offers the one-click enable when it is
 * off (`docs/plans/agent-capability-delegation.md`).
 */

import { trpc } from "../../lib/trpc";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import { InlineAction } from "../ui/InlineAction";

const CHECK_DRIVE = "check-drive";

export function DriveScheduleLine() {
  const utils = trpc.useUtils();
  const schedulesQuery = trpc.scheduler.schedules.useQuery();
  const setEnabled = trpc.scheduler.setEnabled.useMutation();

  const schedules = schedulesQuery.data?.schedules;
  if (schedules === undefined) return null;
  const checkDrive = schedules.find((entry) => entry.name === CHECK_DRIVE);

  if (checkDrive === undefined) {
    return (
      <Text size="sm" tone="muted">
        Hourly Drive sync isn&apos;t set up on this box — mirrored folders update
        when something asks them to.
      </Text>
    );
  }

  if (checkDrive.enabled) {
    return <Text size="sm" tone="muted">Hourly Drive sync is on.</Text>;
  }

  const enable = async () => {
    try {
      await setEnabled.mutateAsync({ name: CHECK_DRIVE, enabled: true });
      await utils.scheduler.schedules.invalidate();
    } catch (_e) {
      // Surfaced below through the mutation's own error state.
    }
  };

  return (
    <Row gap="sm" align="center" wrap>
      <Text size="sm" tone="muted">
        Hourly Drive sync is off — mirrored folders only update when something
        asks them to.
      </Text>
      <InlineAction
        id="bbx-settings-drive-enable-check-drive"
        onClick={enable}
        disabled={setEnabled.isPending}
      >
        {setEnabled.isPending ? "Turning on…" : "Turn it on"}
      </InlineAction>
      {setEnabled.error === null ? null : (
        <Text size="sm" tone="danger">{setEnabled.error.message}</Text>
      )}
    </Row>
  );
}
