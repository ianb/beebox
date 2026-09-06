/**
 * The machine-wide view (`docs/implemented-plans/secret-custody.md`, Decision 8: a
 * machine-wide situation gets a machine-wide interface).
 *
 * The store is one file per machine while an admin page belongs to one box, so
 * this table is reachable from every box's Secrets section — there is no
 * separate hub UI to put it in. It lists NAMES and grants across every box,
 * never values, which is exactly why a secret's name must not itself carry
 * anything sensitive.
 */

import { useState } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { SecretUsesBlock } from "./SecretsSection-uses";

type MachineView = RouterOutput["secrets"]["machineView"];
type MachineSecret = MachineView["secrets"][number];

function grantSummary(secret: MachineSecret): string {
  const entries = Object.entries(secret.grants);
  if (entries.length === 0) return "granted to no box";
  return entries.map(([box, access]) => `${box}: ${access}`).join(" · ");
}

function lastUsedSummary(secret: MachineSecret): string {
  const entries = Object.entries(secret.lastUsed ?? {});
  if (entries.length === 0) return "never used";
  const latest = entries.toSorted((a, b) => b[1].localeCompare(a[1]))[0];
  if (latest === undefined) return "never used";
  return `last used ${new Date(latest[1]).toLocaleString()} by ${latest[0]}`;
}

function MachineRow({ secret, refresh }: { secret: MachineSecret; refresh: () => void }) {
  // Removal is machine-wide and unrecoverable — the value is gone and every
  // box's grant for it goes stale — so it takes two deliberate clicks.
  const [confirming, setConfirming] = useState(false);
  const remove = trpc.secrets.remove.useMutation({ onSuccess: refresh });
  return (
    <Card border="subtle" padding="sm">
      <Stack gap="xs">
        <Row gap="sm" wrap align="center">
          <Text mono size="sm">{secret.name}</Text>
          {secret.hasValue ? null : <Badge tone="warning">empty slot</Badge>}
          {secret.verified?.status === "failed" ? <Badge tone="danger">may be expired</Badge> : null}
          {secret.verified?.status === "ok" ? <Badge tone="success">verified</Badge> : null}
          {secret.shareable === false ? <Badge tone="neutral">single-box{secret.owningBox === undefined ? "" : `: ${secret.owningBox}`}</Badge> : null}
        </Row>
        {secret.note === undefined ? null : <Text size="sm" tone="muted">{secret.note}</Text>}
        <SecretUsesBlock uses={secret.uses} />
        <Text size="xs" tone="muted">{grantSummary(secret)}</Text>
        <Text size="xs" tone="muted">
          {lastUsedSummary(secret)}
          {secret.declaredBy === undefined ? "" : ` · declared by ${secret.declaredBy}`}
        </Text>
        <Row gap="sm" wrap align="center">
          {confirming ? (
            <>
              <Text size="sm" tone="danger">
                Remove <Text mono>{secret.name}</Text> for every box? Its value is gone and each grant becomes stale.
              </Text>
              <Button
                intent="destructive"
                loading={remove.isPending}
                loadingLabel="Removing…"
                onClick={() => remove.mutate({ name: secret.name })}
              >
                Yes, remove
              </Button>
              <Button intent="secondary" onClick={() => setConfirming(false)}>Keep it</Button>
            </>
          ) : (
            <Button intent="destructive" onClick={() => setConfirming(true)}>Remove from machine</Button>
          )}
        </Row>
        {remove.error ? <div role="alert"><Text size="sm" tone="danger">{remove.error.message}</Text></div> : null}
      </Stack>
    </Card>
  );
}

export function MachineSecretsView({ machine, refresh }: { machine: MachineView; refresh: () => void }) {
  return (
    <Stack gap="md">
      <Text size="sm" tone="muted">
        Every secret on this machine, and which boxes hold a grant. Removing one leaves any grant naming it
        as a stale grant on that box, which its own view then reports.
      </Text>
      {machine.secrets.length === 0 ? (
        <Text size="sm" tone="muted">The machine store is empty.</Text>
      ) : (
        <Stack gap="sm">
          {machine.secrets.map((secret) => (
            <MachineRow key={secret.name} secret={secret} refresh={refresh} />
          ))}
        </Stack>
      )}
      <Text size="xs" tone="muted">
        Boxes with grants: {machine.boxes.length === 0 ? "none" : machine.boxes.join(", ")}
      </Text>
    </Stack>
  );
}
