/**
 * This box's own secret situation: what it can resolve, what its agent asked
 * for and is still waiting on, and which grants have gone stale.
 *
 * Values are never here — there is no interface anywhere in this section that
 * reads one back. What a row shows is whether a value exists, what the last
 * verification concluded, and when the box last used it.
 */

import { useState } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { SecretValueForm } from "./SecretsSection-forms";

type BoxStatus = RouterOutput["secrets"]["boxStatus"];
type FormatHints = RouterOutput["secrets"]["formatHints"];
type GrantedSecret = BoxStatus["granted"][number];

/** The one badge that means "act now": the last probe or real use was rejected. */
function VerificationBadge({ secret }: { secret: GrantedSecret }) {
  if (secret.suspect) return <Badge tone="danger">may be expired</Badge>;
  if (secret.verified?.status === "ok") return <Badge tone="success">verified</Badge>;
  return <Badge tone="neutral">unverified</Badge>;
}

function GrantedRow({
  secret,
  slug,
  hints,
  refresh,
}: {
  secret: GrantedSecret;
  slug: string;
  hints: FormatHints | undefined;
  refresh: () => void;
}) {
  const [rotating, setRotating] = useState(false);
  const setAccess = trpc.secrets.setAccess.useMutation({ onSuccess: refresh });
  const revoke = trpc.secrets.revoke.useMutation({ onSuccess: refresh });
  const nextAccess = secret.access === "server" ? "agent" : "server";

  return (
    <Card border="subtle" padding="sm">
      <Stack gap="sm">
        <Row gap="sm" wrap align="center">
          <Text mono size="sm">{secret.name}</Text>
          <Badge tone={secret.access === "agent" ? "warning" : "info"}>{secret.access}</Badge>
          {secret.hasValue ? <VerificationBadge secret={secret} /> : <Badge tone="warning">no value yet</Badge>}
          {secret.shareable === false ? <Badge tone="neutral">single-box</Badge> : null}
        </Row>
        {secret.note === undefined ? null : <Text size="sm" tone="muted">{secret.note}</Text>}
        <Text size="xs" tone="muted">
          {secret.lastUsed === undefined ? "Never used by this box" : `Last used ${new Date(secret.lastUsed).toLocaleString()}`}
          {secret.verified?.reason === undefined ? "" : ` · ${secret.verified.reason}`}
          {secret.probe === null ? " · no verification available" : ` · verified by: ${secret.probe}`}
        </Text>
        <Row gap="sm" wrap>
          <Button intent="secondary" onClick={() => setRotating(!rotating)}>
            {rotating ? "Close" : secret.hasValue ? "Rotate value" : "Set value"}
          </Button>
          <Button
            intent="secondary"
            loading={setAccess.isPending}
            loadingLabel="Changing…"
            onClick={() => setAccess.mutate({ box: slug, name: secret.name, access: nextAccess })}
          >
            {nextAccess === "agent" ? "Raise to agent access" : "Lower to server access"}
          </Button>
          <Button
            intent="destructive"
            loading={revoke.isPending}
            loadingLabel="Revoking…"
            onClick={() => revoke.mutate({ box: slug, name: secret.name })}
          >
            Revoke
          </Button>
        </Row>
        {/* Left open after a save — the verification verdict renders inside it. */}
        {rotating ? <SecretValueForm fixedName={secret.name} hints={hints} onSaved={refresh} /> : null}
        {setAccess.error ? <div role="alert"><Text size="sm" tone="danger">{setAccess.error.message}</Text></div> : null}
        {revoke.error ? <div role="alert"><Text size="sm" tone="danger">{revoke.error.message}</Text></div> : null}
      </Stack>
    </Card>
  );
}

export function BoxSecretsView({ status, hints, refresh }: { status: BoxStatus; hints: FormatHints | undefined; refresh: () => void }) {
  return (
    <Stack gap="md">
      <Text size="sm" tone="muted">
        Box <Text mono>{status.slug}</Text> can resolve {status.granted.length} secret
        {status.granted.length === 1 ? "" : "s"}.
      </Text>
      {status.granted.length === 0 ? (
        <Text size="sm" tone="muted">Nothing is granted to this box yet.</Text>
      ) : (
        <Stack gap="sm">
          {status.granted.map((secret) => (
            <GrantedRow key={secret.name} secret={secret} slug={status.slug} hints={hints} refresh={refresh} />
          ))}
        </Stack>
      )}

      {status.declaredHere.length === 0 ? null : (
        <Stack gap="xs">
          <Text as="h3" size="sm" weight="semibold">Requested by this box's agent</Text>
          <Text size="sm" tone="muted">
            Declared slots waiting on a value and a grant — the agent named what it needs and can do nothing more.
          </Text>
          {status.declaredHere.map((slot) => (
            <DeclaredRow key={slot.name} name={slot.name} hasValue={slot.hasValue} hints={hints} refresh={refresh} />
          ))}
        </Stack>
      )}

      {status.danglingGrants.length === 0 ? null : (
        <Stack gap="xs">
          <Text as="h3" size="sm" weight="semibold">Stale grants</Text>
          <Text size="sm" tone="muted">
            These grants name secrets that no longer exist. Re-add the secret, or revoke the grant.
          </Text>
          {status.danglingGrants.map((name) => (
            <DanglingRow key={name} name={name} slug={status.slug} refresh={refresh} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function DeclaredRow({
  name,
  hasValue,
  hints,
  refresh,
}: {
  name: string;
  hasValue: boolean;
  hints: FormatHints | undefined;
  refresh: () => void;
}) {
  const [filling, setFilling] = useState(false);
  return (
    <Card border="subtle" padding="sm">
      <Stack gap="sm">
        <Row gap="sm" wrap align="center">
          <Text mono size="sm">{name}</Text>
          <Badge tone={hasValue ? "info" : "warning"}>{hasValue ? "has a value, not granted" : "empty slot"}</Badge>
        </Row>
        <Row gap="sm" wrap>
          <Button intent="secondary" onClick={() => setFilling(!filling)}>{filling ? "Close" : "Supply value"}</Button>
        </Row>
        {filling ? <SecretValueForm fixedName={name} hints={hints} onSaved={refresh} /> : null}
      </Stack>
    </Card>
  );
}

function DanglingRow({ name, slug, refresh }: { name: string; slug: string; refresh: () => void }) {
  const revoke = trpc.secrets.revoke.useMutation({ onSuccess: refresh });
  return (
    <Row gap="sm" wrap align="center">
      <Text mono size="sm">{name}</Text>
      <Button intent="destructive" loading={revoke.isPending} loadingLabel="Revoking…" onClick={() => revoke.mutate({ box: slug, name })}>
        Revoke stale grant
      </Button>
      {revoke.error ? <Text size="sm" tone="danger">{revoke.error.message}</Text> : null}
    </Row>
  );
}
