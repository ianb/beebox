/**
 * The paired phones that registered for APNs push, with the environment their
 * build was signed for, from the `push` projection of `pairing.devices` (which
 * never carries the token). Says so when the server has no APNs key, since
 * then no phone gets a push. See docs/plans/notifications.md (Track B).
 */

import { trpc } from "../../lib/trpc";
import { Stack } from "../ui/Stack";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Badge } from "../ui/Badge";
import { ErrorText } from "../ui/ErrorText";
import { FriendlyDate } from "../ui/FriendlyDate";
import { StatusMessage } from "../ui/StatusMessage";

export function PhonePushDevices() {
  const devices = trpc.pairing.devices.useQuery();
  const apns = trpc.notifications.apnsStatus.useQuery();
  const registered = (devices.data?.devices ?? []).flatMap((d) =>
    d.push === null || d.revokedAt !== undefined ? [] : [{ id: d.id, label: d.label, push: d.push }],
  );
  return (
    <Stack gap="sm">
      <Heading level={3}>Phones</Heading>
      {apns.data?.configured === false ? (
        <Hint>The server has no APNs key, so paired phones get no push notifications.</Hint>
      ) : null}
      {devices.isPending ? <StatusMessage>Loading paired phones…</StatusMessage>
        : devices.error ? <ErrorText>Could not load paired phones: {devices.error.message}</ErrorText>
        : registered.length === 0 ? <Hint>No paired phone has registered for notifications. The Bee Box app registers when it opens.</Hint>
        : (
          <Stack as="ul" gap="xs">
            {registered.map((d) => (
              <li key={d.id}>
                <Row gap="sm" align="baseline" wrap>
                  <Text size="sm" weight="semibold">{d.label}</Text>
                  <Badge tone={d.push.environment === "production" ? "success" : "neutral"} size="sm">{d.push.environment}</Badge>
                  <Text size="xs" tone="muted">registered <FriendlyDate iso={d.push.registeredAt} /></Text>
                </Row>
              </li>
            ))}
          </Stack>
        )}
    </Stack>
  );
}
