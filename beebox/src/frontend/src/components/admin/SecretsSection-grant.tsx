/**
 * Grant an existing machine-level name to this box — the advanced case
 * (`docs/plans/secret-entry-guidance.md`, Track 1): a grant is real machinery
 * (one store, many boxes), but for the box in front of the boxholder, pasting
 * a key and having it work (`SecretsSection-forms.tsx`'s `SecretValueForm`
 * with `grantBox` set) is the whole job. This form is what a second box
 * needs — borrowing a name already granted elsewhere — and it now lives
 * under a disclosure at the bottom of the "This box" tab.
 */

import { useState, type FormEvent } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { SelectField } from "../ui/fields";

type MachineView = RouterOutput["secrets"]["machineView"];

/** The names another box holds that this box does not, filtered by shareability — shared
 *  by {@link GrantExistingForm} and the parent's decision whether to show the disclosure at all. */
export function grantableSecrets(machine: MachineView, grantedNames: string[]): MachineView["secrets"] {
  return machine.secrets.filter(
    (secret) =>
      !grantedNames.includes(secret.name) &&
      (secret.shareable !== false || secret.owningBox === machine.thisBox),
  );
}

/**
 * The picker hides names another box owns exclusively (`shareable: false`) —
 * a Telegram token routes to one webhook URL, so offering it here would only
 * produce a refusal.
 */
export function GrantExistingForm({
  machine,
  grantedNames,
  onGranted,
}: {
  machine: MachineView;
  grantedNames: string[];
  onGranted: () => void;
}) {
  const [name, setName] = useState("");
  const [access, setAccess] = useState("server");
  const grant = trpc.secrets.grant.useMutation();

  const grantable = grantableSecrets(machine, grantedNames);
  if (grantable.length === 0) {
    return <Text size="sm" tone="muted">Every secret on this machine is already granted to this box.</Text>;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const chosen = name === "" ? grantable[0]?.name : name;
    if (chosen === undefined) return;
    try {
      await grant.mutateAsync({ box: machine.thisBox, name: chosen, access: access === "agent" ? "agent" : "server" });
      setName("");
      onGranted();
    } catch (_error) {
      // The mutation's error state renders below the button.
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Stack gap="sm">
        <SelectField
          id="bbx-admin-secrets-grant-name"
          label="Grant an existing secret to this box"
          value={name === "" ? (grantable[0]?.name ?? "") : name}
          onChange={setName}
          options={grantable.map((secret) => ({ value: secret.name, label: secret.name }))}
        />
        <SelectField
          id="bbx-admin-secrets-grant-access"
          label="Access"
          value={access}
          onChange={setAccess}
          options={[
            { value: "server", label: "server — connectors only, never disclosed to the agent" },
            { value: "agent", label: "agent — box code may resolve the value at call time" },
          ]}
        />
        <Row gap="sm" wrap>
          <Button id="bbx-admin-secrets-grant-submit" type="submit" intent="primary" loading={grant.isPending} loadingLabel="Granting…">Grant</Button>
        </Row>
        {grant.error ? <div role="alert"><Text size="sm" tone="danger">{grant.error.message}</Text></div> : null}
      </Stack>
    </form>
  );
}
