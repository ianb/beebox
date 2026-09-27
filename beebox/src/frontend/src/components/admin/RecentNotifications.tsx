/**
 * The last three days of notifications from the log, each with what every
 * channel did with it (docs/implemented-plans/notifications.md, Track A). Read-only: the
 * log is the record, and a failure here is also a health check.
 */

import { trpc, type RouterOutput } from "../../lib/trpc";
import { Stack } from "../ui/Stack";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ErrorText } from "../ui/ErrorText";
import { FriendlyDate } from "../ui/FriendlyDate";
import { StatusMessage } from "../ui/StatusMessage";

type LoggedNotification = RouterOutput["notifications"]["recent"][number];
type DeliveryLine = LoggedNotification["deliveries"][number];

const STATUS_TONE: Record<DeliveryLine["status"], BadgeTone> = { sent: "success", skipped: "neutral", failed: "danger" };

function DeliveryBadge({ delivery }: { delivery: DeliveryLine }) {
  return (
    <Row gap="xs" align="center" wrap>
      <Badge tone={STATUS_TONE[delivery.status]} size="sm">{delivery.channel} {delivery.status}</Badge>
      {delivery.detail === undefined ? null : <Text size="xs" tone="muted" breakAll>{delivery.detail}</Text>}
    </Row>
  );
}

function RecentItem({ notification }: { notification: LoggedNotification }) {
  const { intent, deliveries } = notification;
  return (
    <li>
      <Stack gap="xs">
        <Row gap="sm" align="baseline" wrap>
          <Text size="sm" weight="semibold">{intent.title}</Text>
          <Text size="xs" tone="muted"><FriendlyDate iso={intent.at} /></Text>
          <Text size="xs" tone="muted">{intent.loudness}</Text>
        </Row>
        {deliveries.length === 0 ? <Hint>No channel was tried.</Hint> : deliveries.map((d) => <DeliveryBadge key={d.channel} delivery={d} />)}
      </Stack>
    </li>
  );
}

export function RecentNotifications() {
  const recent = trpc.notifications.recent.useQuery({ days: 3 });
  return (
    <Stack gap="sm">
      <Heading level={3}>Recent</Heading>
      {recent.isPending ? <StatusMessage>Loading recent notifications…</StatusMessage>
        : recent.error ? (
          <Stack gap="xs">
            <ErrorText>Could not load recent notifications: {recent.error.message}</ErrorText>
            <Button id="bbx-admin-notifications-recent-retry" className="self-start" size="sm" intent="secondary" onClick={() => { void recent.refetch(); }}>Retry</Button>
          </Stack>
        )
        : recent.data.length === 0 ? <Hint>No notifications in the last three days.</Hint>
        : (
          <Stack as="ul" gap="md">
            {recent.data.map((n) => <RecentItem key={n.intent.id} notification={n} />)}
          </Stack>
        )}
    </Stack>
  );
}
