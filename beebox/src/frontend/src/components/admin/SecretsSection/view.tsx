/**
 * Admin Secrets section — the boxholder's management surface for the machine
 * secret store (`docs/implemented-plans/secret-custody.md`, Track 2).
 *
 * Leads with THIS box (the common case: what can it resolve, what is it waiting
 * on) and offers the machine-wide table behind a toggle, since the store is one
 * file per machine but an admin page belongs to one box.
 *
 * The "This box" tab leads with what the box holds, one collapsed row per
 * key, then "Add a key to this box": grant a name the machine already has
 * (first, since with several boxes that is the ordinary case; see
 * issues/bugs/2026-09-21-granting-an-existing-key-to-a-box-is-hidden-and-unguided.md)
 * or add a new one through the service picker.
 *
 * Nothing here can read a value back. A value saved through the picker is
 * granted to this box in the same write; a value saved from the Machine-wide
 * tab is not granted to any box.
 */

import { useState } from "react";
import { trpc } from "../../../lib/trpc/client";
import { Row } from "../../ui/Row";
import { Stack } from "../../ui/Stack";
import { Heading } from "../../ui/Heading";
import { ErrorText } from "../../ui/ErrorText";
import { Hint } from "../../ui/Hint";
import { Button } from "../../ui/Button";
import { BoxSecretsView } from "./box";
import { ConnectServiceSection } from "./connect";
import { GrantExistingForm, grantableSecrets } from "./grant";
import { MachineSecretsView } from "./machine";
import { AdminSectionCard } from "../AdminSectionCard";

const DESCRIPTION =
  "API keys live in one store outside every box, and each box holds a grant to the ones it may use. Values are never shown here — saving one replaces it.";

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
      <AdminSectionCard id="secrets" description={DESCRIPTION} busy>
        <Hint>Loading secrets…</Hint>
      </AdminSectionCard>
    );
  }

  const grantedNames = status.data?.granted.map((secret) => secret.name) ?? [];
  const grantable = machine.data ? grantableSecrets(machine.data, grantedNames) : [];

  return (
    <AdminSectionCard id="secrets" description={DESCRIPTION}>
      <Row gap="sm" wrap>
        <Button id="bbx-admin-secrets-scope-box" intent={machineWide ? "secondary" : "primary"} onClick={() => setMachineWide(false)}>This box</Button>
        <Button id="bbx-admin-secrets-scope-machine" intent={machineWide ? "primary" : "secondary"} onClick={() => setMachineWide(true)}>Machine-wide</Button>
      </Row>

      {machineWide ? (
        machine.data ? <MachineSecretsView machine={machine.data} refresh={refresh} /> : null
      ) : (
        <Stack gap="md">
          {status.data ? <BoxSecretsView status={status.data} hints={hints.data} refresh={refresh} /> : null}
          <Stack gap="sm">
            <Heading level={3}>Add a key to this box</Heading>
            {machine.data && grantable.length > 0 ? (
              <GrantExistingForm machine={machine.data} grantedNames={grantedNames} onGranted={refresh} />
            ) : null}
            <ConnectServiceSection
              guides={guides.data}
              grantedNames={grantedNames}
              boxSlug={status.data?.slug ?? ""}
              hints={hints.data}
              onSaved={refresh}
            />
          </Stack>
        </Stack>
      )}

      {/* Both queries fail for the same reasons — no owner session, an unreadable store — so
          rendering one alert each printed the identical sentence twice. Show each distinct
          message once, and keep both when they genuinely differ. */}
      {[...new Set([status.error, machine.error].filter((e) => e !== null).map((e) => e.message))]
        .map((message) => (
          <div key={message} role="alert"><ErrorText>{message}</ErrorText></div>
        ))}
    </AdminSectionCard>
  );
}
