/**
 * Admin Secrets section — the boxholder's management surface for the machine
 * secret store (`docs/implemented-plans/secret-custody.md`, Track 2).
 *
 * Leads with THIS box (the common case: what can it resolve, what is it waiting
 * on) and offers the machine-wide table behind a toggle, since the store is one
 * file per machine but an admin page belongs to one box.
 *
 * The "This box" tab leads with "Connect a service" — paste a key and it is
 * this box's in the same submit — per the boxholder's framing (2026-09-10):
 * granting is the advanced, multi-box case, not the primary one
 * (`docs/plans/secret-entry-guidance.md`, Track 1). Granting a name another
 * box already holds is a disclosure at the bottom.
 *
 * Nothing here can read a value back. A value saved through "Connect a
 * service" is granted to this box in the same write; a value saved from the
 * Machine-wide tab is not granted to any box.
 */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { Button } from "../ui/Button";
import { BoxSecretsView } from "./SecretsSection-box";
import { ConnectServiceSection } from "./SecretsSection-connect";
import { GrantExistingForm, grantableSecrets } from "./SecretsSection-grant";
import { MachineSecretsView } from "./SecretsSection-machine";

export function SecretsSection() {
  const [machineWide, setMachineWide] = useState(false);
  const utils = trpc.useUtils();
  const status = trpc.secrets.boxStatus.useQuery();
  const machine = trpc.secrets.machineView.useQuery();
  const hints = trpc.secrets.formatHints.useQuery();
  const guides = trpc.secrets.guides.useQuery();

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

  const grantedNames = status.data?.granted.map((secret) => secret.name) ?? [];
  const grantable = machine.data ? grantableSecrets(machine.data, grantedNames) : [];

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
        ) : (
          <Stack gap="md">
            <ConnectServiceSection
              guides={guides.data}
              grantedNames={grantedNames}
              boxSlug={status.data?.slug ?? ""}
              hints={hints.data}
              onSaved={refresh}
            />
            {status.data ? <BoxSecretsView status={status.data} hints={hints.data} refresh={refresh} /> : null}
            {machine.data && grantable.length > 0 ? (
              <details id="bbx-admin-secrets-advanced">
                <summary><Text as="span" size="sm" weight="medium">Use a key another box already has</Text></summary>
                <div className="pt-3">
                  <GrantExistingForm machine={machine.data} grantedNames={grantedNames} onGranted={refresh} />
                </div>
              </details>
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
