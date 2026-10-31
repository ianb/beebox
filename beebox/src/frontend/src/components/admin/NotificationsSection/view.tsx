/**
 * The box-wide view of notifications: who the box can reach, what it recently
 * sent, and a test send. Turning notifications on for a browser or checking a
 * phone is in Settings (components/settings/NotificationsSection.tsx).
 */

import { useParams } from "@tanstack/react-router";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { href } from "../../../lib/routing";
import { trpc } from "../../../lib/trpc/client";
import { Button } from "../../ui/Button";
import { ErrorText } from "../../ui/ErrorText";
import { Heading } from "../../ui/Heading";
import { Hint } from "../../ui/Hint";
import { Stack } from "../../ui/Stack";
import { Text } from "../../ui/Text";
import { TextLink } from "../../ui/TextLink";
import { AdminSectionCard } from "../AdminSectionCard";
import { RecentNotifications } from "./RecentNotifications";
import { PhonePushDevices } from "./PhonePushDevices";

const DESCRIPTION = "Which phones and browsers this box can reach, and what it recently sent.";

function BrowserCount() {
  const subscribers = trpc.push.subscriberCount.useQuery();
  const { boxSlug } = useParams({ strict: false });
  const count = subscribers.data?.count;
  return (
    <Stack gap="sm">
      <Heading level={3}>Browsers</Heading>
      {subscribers.error ? <ErrorText>Could not load browsers: {subscribers.error.message}</ErrorText>
        : count === undefined ? null
        : <Text as="p" size="sm">{count === 1 ? "1 browser is" : `${count} browsers are`} registered for this box.</Text>}
      <Hint>
        To turn notifications on for the browser you are using, go to{" "}
        <TextLink id="bbx-admin-notifications-settings" to={href(`/${boxSlug ?? ""}/views/${SYSTEM_CARD_PATHS.settings}`)}>Settings</TextLink>.
      </Hint>
    </Stack>
  );
}

function TestSend() {
  const utils = trpc.useUtils();
  const send = trpc.notifications.send.useMutation({
    onSuccess: () => { void utils.notifications.recent.invalidate(); },
  });
  return (
    <Stack gap="xs">
      <Button
        id="bbx-admin-notifications-test"
        className="self-start"
        intent="secondary"
        loading={send.isPending}
        loadingLabel="Sending…"
        onClick={() => send.mutate({
          intent: { title: "Test notification", body: "Sent from Admin.", target: "admin:notifications", loudness: "loud", source: "admin-test" },
        })}
      >
        Send a test notification
      </Button>
      {send.error ? <ErrorText>Could not send: {send.error.message}</ErrorText> : null}
    </Stack>
  );
}

export function NotificationsSection() {
  return (
    <AdminSectionCard id="notifications" description={DESCRIPTION}>
      <Stack gap="md">
        <PhonePushDevices />
        <BrowserCount />
        <TestSend />
        <RecentNotifications />
      </Stack>
    </AdminSectionCard>
  );
}
