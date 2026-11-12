/**
 * Whether this box can reach the person here: this browser's switch, or in the
 * app, this phone's registration. Admin's Notifications section has the
 * box-wide view.
 */

import { assertNever } from "@shared/invariant";
import { useBoxName } from "../../hooks/useBoxName";
import { useBrowserPush } from "../../hooks/useBrowserPush";
import { phonePushState, type PhonePushState } from "../../lib/push-support";
import { trpc } from "../../lib/trpc/client";
import { isNativeShell } from "../chat/native-post";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Notice } from "../ui/Notice";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { StatusMessage } from "../ui/StatusMessage";
import { Text } from "../ui/Text";

function BrowserSwitch({ boxName }: { boxName: string }) {
  const push = useBrowserPush();
  const { state } = push;
  const body = (() => {
    switch (state) {
      case "checking": return <StatusMessage busy>Checking this browser…</StatusMessage>;
      case "unsupported": return <Text as="p" size="sm">This browser can&apos;t show notifications from the box. Try a current version of Chrome, Firefox, Edge, or Safari.</Text>;
      case "needs-install": return <Text as="p" size="sm">On iPhone or iPad, add this app to your Home Screen first: tap the Share button, then &ldquo;Add to Home Screen.&rdquo; Open it from the Home Screen icon, then come back here.</Text>;
      case "no-server-key": return <Text as="p" size="sm">The server is not set up to send browser notifications. Tell whoever runs this box.</Text>;
      case "blocked": return <Text as="p" size="sm">Your browser is blocking notifications from this site. Allow them in the browser&apos;s site settings, then reload this page.</Text>;
      case "on": return (
        <Row gap="sm" align="center" wrap>
          <Text as="p" size="sm">On. This browser shows notifications from {boxName}.</Text>
          <Button id="bbx-settings-notifications-disable" intent="secondary" onClick={() => { void push.disable(); }} loading={push.busy} loadingLabel="Turning off…">Turn off</Button>
        </Row>
      );
      case "off": return (
        <Stack gap="sm">
          <Text as="p" size="sm">Off. This browser shows no notifications from {boxName}.</Text>
          <Button id="bbx-settings-notifications-enable" className="self-start" intent="primary" onClick={() => { void push.enable(); }} loading={push.busy} loadingLabel="Turning on…">Notify me in this browser</Button>
        </Stack>
      );
      default: return assertNever(state);
    }
  })();
  return (
    <Stack gap="sm">
      {body}
      {push.error === null ? null : <Notice tone="error">{push.error}</Notice>}
    </Stack>
  );
}

const PHONE_MESSAGES: Record<PhonePushState, string> = {
  "not-paired": "This app is not paired with this box, so this phone gets no notifications from it. Pair it under Companion Apps on this page.",
  "no-server-key": "The server is not set up to send phone notifications. Tell whoever runs this box.",
  "turned-off": "Off. This phone gets no notifications from this box.",
  "registered": "This phone is registered for notifications from this box. If none appear, check that notifications are on for Bee Box in iPhone Settings.",
  "unregistered": "This phone is paired but not registered for notifications. Switch away from the Bee Box app and come back. If this message stays, check that notifications are on for Bee Box in iPhone Settings.",
  "unregistered-no-server-key": "This phone is paired but not registered for notifications, and the server is not set up to send phone notifications. Tell whoever runs this box.",
};

function PhoneState() {
  const utils = trpc.useUtils();
  const thisDevice = trpc.pairing.thisDevice.useQuery();
  const setOff = trpc.pairing.setThisDeviceNotificationsOff.useMutation({
    onSuccess: () => { void utils.pairing.thisDevice.invalidate(); },
  });
  const apns = trpc.notifications.apnsStatus.useQuery();
  const failure = thisDevice.error ?? apns.error;
  if (failure) return <ErrorText>Could not check this phone: {failure.message}</ErrorText>;
  if (thisDevice.data === undefined || apns.data === undefined) return <StatusMessage busy>Checking this phone…</StatusMessage>;
  const state = phonePushState({
    paired: thisDevice.data.device !== null,
    turnedOff: thisDevice.data.device?.notificationsOff === true,
    registered: thisDevice.data.device?.push != null,
    apnsConfigured: apns.data.configured,
  });
  return (
    <Stack gap="sm">
      <Text as="p" size="sm">{PHONE_MESSAGES[state]}</Text>
      {state === "not-paired" ? null : (
        <Button
          id="bbx-settings-notifications-phone-toggle"
          className="self-start"
          intent={state === "turned-off" ? "primary" : "secondary"}
          loading={setOff.isPending}
          loadingLabel="Saving…"
          onClick={() => setOff.mutate({ off: state !== "turned-off" })}
        >
          {state === "turned-off" ? "Notify me on this phone" : "Turn off for this phone"}
        </Button>
      )}
      {setOff.error ? <ErrorText>Could not save: {setOff.error.message}</ErrorText> : null}
    </Stack>
  );
}

export function NotificationsSection() {
  const { boxName, boxSlug } = useBoxName();
  const name = boxName || boxSlug;
  return (
    <Card as="section" aria-label="Notifications" shadow material>
      <Stack gap="md">
        <Stack gap="xs">
          <Heading level={2}>Notifications</Heading>
          <Hint>Reminders, notes from the agent, health alerts, and questions waiting for an answer. This covers {name} only; each box has its own setting.</Hint>
        </Stack>
        {isNativeShell() ? <PhoneState /> : <BrowserSwitch boxName={name} />}
      </Stack>
    </Card>
  );
}
