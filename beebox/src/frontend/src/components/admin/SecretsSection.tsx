/**
 * Admin Secrets section — the boxholder's management surface for the machine
 * secret store (`docs/implemented-plans/secret-custody.md`, Track 2).
 *
 * Leads with THIS box (the common case: what can it resolve, what is it waiting
 * on) and offers the machine-wide table behind a toggle, since the store is one
 * file per machine but an admin page belongs to one box.
 *
 * Nothing here can read a value back. Adding a secret and granting it are
 * separate acts: a value saved here exists machine-wide and is available to no
 * box until granted.
 */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { BoxSecretsView } from "./SecretsSection-box";
import { GrantExistingForm, SecretValueForm } from "./SecretsSection-forms";
import { MachineSecretsView } from "./SecretsSection-machine";

export function SecretsSection() {
  const [machineWide, setMachineWide] = useState(false);
  const [adding, setAdding] = useState(false);
  const utils = trpc.useUtils();
  const status = trpc.secrets.boxStatus.useQuery();
  const machine = trpc.secrets.machineView.useQuery();
  const hints = trpc.secrets.formatHints.useQuery();

  const refresh = () => {
    void utils.secrets.boxStatus.invalidate();
    void utils.secrets.machineView.invalidate();
  };

  if (status.isLoading) {
    return (
      <Card as="section" aria-label="Secrets" shadow aria-busy>
        <Text size="sm" tone="muted">Loading secrets…</Text>
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby="secrets-heading" shadow>
      <Stack gap="md">
        <Stack gap="xs">
          <div id="secrets-heading">
            <Text as="h2" size="lg" weight="semibold">Secrets</Text>
          </div>
          <Text size="sm" tone="muted">
            API keys live in one store outside every box, and each box holds a grant to the ones it may use.
            Values are never shown here — saving one replaces it.
          </Text>
        </Stack>

        <Row gap="sm" wrap>
          <Button id="bbx-admin-secrets-scope-box" intent={machineWide ? "secondary" : "primary"} onClick={() => setMachineWide(false)}>This box</Button>
          <Button id="bbx-admin-secrets-scope-machine" intent={machineWide ? "primary" : "secondary"} onClick={() => setMachineWide(true)}>Machine-wide</Button>
        </Row>

        {machineWide ? (
          machine.data ? <MachineSecretsView machine={machine.data} refresh={refresh} /> : null
        ) : status.data ? (
          <BoxSecretsView status={status.data} hints={hints.data} refresh={refresh} />
        ) : null}

        {machineWide ? null : (
          <Stack gap="sm">
            {machine.data && status.data ? (
              <GrantExistingForm
                machine={machine.data}
                grantedNames={status.data.granted.map((secret) => secret.name)}
                onGranted={refresh}
              />
            ) : null}
            <Row gap="sm" wrap>
              <Button id="bbx-admin-secrets-add-toggle" intent="secondary" onClick={() => setAdding(!adding)}>
                {adding ? "Close" : "Add a new secret"}
              </Button>
            </Row>
            {adding ? (
              // The form stays open after a save: it is where the verification
              // verdict ("the provider rejected this credential") is shown, and
              // closing it on success would hide exactly the answer the
              // boxholder was waiting for.
              <SecretValueForm fixedName={null} hints={hints.data} onSaved={refresh} />
            ) : null}
          </Stack>
        )}

        {/* Both queries fail for the same reasons — no owner session, an unreadable store — so
            rendering one alert each printed the identical sentence twice. Show each distinct
            message once, and keep both when they genuinely differ. */}
        {[...new Set([status.error, machine.error].filter((e) => e !== null).map((e) => e.message))]
          .map((message) => (
            <div key={message} role="alert"><Text size="sm" tone="danger">{message}</Text></div>
          ))}
      </Stack>
    </Card>
  );
}
