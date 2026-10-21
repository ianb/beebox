import { useEffect, useState } from "react";
import { qrSvg } from "../../lib/qr-svg";
import { getApiBase } from "../../api";
import { useBoxName } from "../../hooks/useBoxName";
import { trpc, type RouterOutput } from "../../lib/trpc/client";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { ErrorText } from "../ui/ErrorText";
import { Hint } from "../ui/Hint";
import { Heading } from "../ui/Heading";
import { errorMessage } from "@shared/error-guards";

type MobileDevice = RouterOutput["pairing"]["devices"]["devices"][number];
type DeviceScope = RouterOutput["pairing"]["devices"]["scope"];

interface PairingTicket {
  deepLink: string;
  expiresAt: string;
}

function boxBaseUrl(): string {
  const apiBase = getApiBase();
  const boxPath = apiBase.endsWith("/api") ? apiBase.slice(0, -"/api".length) : apiBase;
  return new URL(boxPath, window.location.origin).toString().replace(/\/$/, "");
}

/**
 * The `label` the phone files this box under. It used to be guessed from the
 * last path segment (with a special case for a `/settings` suffix), which named
 * every newly paired box after the route instead of the box — "chat", once
 * Settings became a card. The box's real display name is already in hand.
 */
function pairingDeepLink(token: string, boxName: string): string {
  const params = new URLSearchParams({
    baseURL: boxBaseUrl(),
    label: boxName || "Bee Box",
    pairingToken: token,
  });
  return `beebox://pair?${params.toString()}`;
}

/** The list is scoped to what the caller may reach, so the heading says which
 *  list this is rather than implying a short one is the whole box. */
function deviceHeading(scope: DeviceScope | undefined): string {
  return scope === "own" ? "Your paired devices" : "Paired devices";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DeviceRow({ device }: { device: MobileDevice }) {
  const utils = trpc.useUtils();
  const revokeMutation = trpc.pairing.revokeDevice.useMutation({
    onSuccess: () => {
      void utils.pairing.devices.invalidate();
    },
  });
  return (
    <Row justify="between" align="center" className="py-2">
      <Text as="div">
        <Text weight="medium">{device.label}</Text>{" "}
        <Text size="xs" tone="muted" className="ml-1">
          Paired {formatDate(device.createdAt)}
          {device.lastUsedAt ? ` - last used ${formatDate(device.lastUsedAt)}` : ""}
          {device.revokedAt ? ` - unpaired ${formatDate(device.revokedAt)}` : ""}
        </Text>
      </Text>
      {!device.revokedAt ? (
        <Button
          intent="destructive"
          size="sm"
          loading={revokeMutation.isPending}
          onClick={() => revokeMutation.mutate({ deviceId: device.id })}
        >
          Unpair
        </Button>
      ) : null}
    </Row>
  );
}

export function CompanionPairingSection() {
  const { boxName } = useBoxName();
  const devicesQuery = trpc.pairing.devices.useQuery();
  const createMutation = trpc.pairing.createTicket.useMutation();
  const [ticket, setTicket] = useState<PairingTicket | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticket) return;
    const delay = Math.max(0, new Date(ticket.expiresAt).getTime() - Date.now());
    const timeout = setTimeout(() => {
      setTicket(null);
      setShowQr(false);
    }, delay);
    return () => clearTimeout(timeout);
  }, [ticket]);

  /** The current ticket, unless it has under a minute left: not worth handing out. */
  const usableTicket = (): PairingTicket | null =>
    ticket !== null && new Date(ticket.expiresAt).getTime() - Date.now() > 60_000 ? ticket : null;

  const mintTicket = async (): Promise<PairingTicket> => {
    const next = await createMutation.mutateAsync();
    const made = { deepLink: pairingDeepLink(next.token, boxName), expiresAt: next.expiresAt };
    setTicket(made);
    return made;
  };

  const showQrCode = async () => {
    if (usableTicket() === null) await mintTicket();
    setShowQr(true);
  };

  /** One click mints (when needed) and copies. Safari drops a click's
   * permission to write the clipboard across an await; a ClipboardItem built
   * from a promise keeps it. */
  const copyLink = async () => {
    setCopyError(null);
    const current = usableTicket();
    const link = current ? Promise.resolve(current.deepLink) : mintTicket().then((made) => made.deepLink);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": link.then((text) => new Blob([text], { type: "text/plain" })) }),
      ]);
    } catch (e) {
      console.warn("[pairing] copy link failed:", e);
      setCopyError(`The link could not be copied: ${errorMessage(e)}`);
    }
  };

  return (
    <Card as="section" aria-label="Companion app pairing" shadow material>
      <Stack gap="md">
        <Stack gap="xs">
          <Heading level={2}>
            Companion Apps
          </Heading>
          <Hint>
            On an iPhone: Show QR Code, then scan it in the Bee Box app. On a Mac: Copy Link, then in the Bee Box
            menu choose Pair with a Box… and paste it. Each code works once and expires after a few minutes.
          </Hint>
        </Stack>

        <Row gap="sm" wrap>
          <Button
            id="bbx-settings-pairing-create-qr"
            loading={createMutation.isPending ? !showQr : false}
            loadingLabel="Creating..."
            onClick={showQrCode}
          >
            Show QR Code (iPhone)
          </Button>
          <Button id="bbx-settings-pairing-copy-link" onClick={copyLink} flash={{ label: "Copied" }}>
            Copy Link (Mac)
          </Button>
        </Row>

        {createMutation.error ? (
          <ErrorText>{createMutation.error.message}</ErrorText>
        ) : null}
        {copyError ? <ErrorText>{copyError}</ErrorText> : null}

        {ticket !== null && showQr ? (
          <Stack gap="sm">
            <div
              className="w-fit rounded border border-warm-200 bg-white p-3"
              aria-label="iOS pairing QR code"
              dangerouslySetInnerHTML={{ __html: qrSvg(ticket.deepLink, 5) }}
            />
            <Text size="xs" tone="muted">Expires {formatDate(ticket.expiresAt)}</Text>
            <code className="block max-w-full overflow-auto rounded bg-warm-100 px-2 py-1 text-xs text-warm-800">
              {ticket.deepLink}
            </code>
          </Stack>
        ) : null}

        <Stack gap="xs">
          <Heading level={3}>{deviceHeading(devicesQuery.data?.scope)}</Heading>
          {devicesQuery.isLoading ? (
            <Hint>Loading devices...</Hint>
          ) : devicesQuery.error ? (
            <ErrorText>Devices could not be loaded. {devicesQuery.error.message}</ErrorText>
          ) : devicesQuery.data && devicesQuery.data.devices.length > 0 ? (
            <>
              <div className="divide-y divide-warm-100">
                {devicesQuery.data.devices.map((device) => (
                  <DeviceRow key={device.id} device={device} />
                ))}
              </div>
              {devicesQuery.data.scope === "own" ? (
                <Text size="xs" tone="muted">
                  Devices you paired. Only the box owner sees every device on this box.
                </Text>
              ) : null}
            </>
          ) : (
            <Hint>
              {devicesQuery.data?.scope === "own"
                ? "You have not paired a device with this box."
                : "No devices paired yet."}
            </Hint>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
