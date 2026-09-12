import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { getApiBase } from "../../api";
import { useBoxName } from "../../hooks/useBoxName";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

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

function qrSvg(value: string): string {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 3 });
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

  useEffect(() => {
    if (!ticket) return;
    const delay = Math.max(0, new Date(ticket.expiresAt).getTime() - Date.now());
    const timeout = setTimeout(() => setTicket(null), delay);
    return () => clearTimeout(timeout);
  }, [ticket]);

  const createTicket = async () => {
    const next = await createMutation.mutateAsync();
    setTicket({ deepLink: pairingDeepLink(next.token, boxName), expiresAt: next.expiresAt });
  };

  const copyLink = async () => {
    if (!ticket) return;
    await navigator.clipboard.writeText(ticket.deepLink);
  };

  return (
    <Card as="section" aria-label="iOS companion pairing" shadow className="mt-6">
      <Stack gap="md">
        <Stack gap="xs">
          <Text as="h2" size="lg" weight="semibold">
            iOS Companion
          </Text>
          <Text size="sm" tone="muted">
            Pair the native app with this box using a short-lived QR code.
          </Text>
        </Stack>

        <Row gap="sm" wrap>
          <Button
            id="bbx-settings-pairing-create-qr"
            intent="primary"
            loading={createMutation.isPending}
            loadingLabel="Creating..."
            onClick={createTicket}
          >
            Create QR
          </Button>
          {ticket ? (
            <Button id="bbx-settings-pairing-copy-link" onClick={copyLink} flash={{ label: "Copied" }}>
              Copy Link
            </Button>
          ) : null}
        </Row>

        {createMutation.error ? (
          <Text size="sm" tone="danger">{createMutation.error.message}</Text>
        ) : null}

        {ticket ? (
          <Stack gap="sm">
            <div
              className="w-fit rounded border border-warm-200 bg-white p-3"
              aria-label="iOS pairing QR code"
              dangerouslySetInnerHTML={{ __html: qrSvg(ticket.deepLink) }}
            />
            <Text size="xs" tone="muted">Expires {formatDate(ticket.expiresAt)}</Text>
            <code className="block max-w-full overflow-auto rounded bg-warm-100 px-2 py-1 text-xs text-warm-800">
              {ticket.deepLink}
            </code>
          </Stack>
        ) : null}

        <Stack gap="xs">
          <Text as="h3" size="sm" weight="semibold">{deviceHeading(devicesQuery.data?.scope)}</Text>
          {devicesQuery.isLoading ? (
            <Text size="sm" tone="muted">Loading devices...</Text>
          ) : devicesQuery.error ? (
            <Text size="sm" tone="danger">Devices could not be loaded. {devicesQuery.error.message}</Text>
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
            <Text size="sm" tone="muted">
              {devicesQuery.data?.scope === "own"
                ? "You have not paired a device with this box."
                : "No devices paired yet."}
            </Text>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
