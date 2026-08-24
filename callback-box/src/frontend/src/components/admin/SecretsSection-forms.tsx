/**
 * Forms for the admin Secrets section: supplying a value, and granting an
 * existing machine-level name to this box.
 *
 * The value input is masked and write-only — nothing in this section can read a
 * stored value back, so "rotate" replaces and "set" fills, and neither ever
 * shows what is already there.
 *
 * Format checking is a HINT, never a gate: the warnings below sit under the
 * input and the submit button stays enabled, because provider key formats drift
 * and a hard format gate would brick key entry the day a prefix changes.
 */

import { useState, type FormEvent } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { SelectField, TextField } from "../ui/fields";

type FormatHints = RouterOutput["secrets"]["formatHints"];
type MachineView = RouterOutput["secrets"]["machineView"];

/** The registry entry for a name: exact match, else the `family/` prefix. */
export function formatHintFor(hints: FormatHints | undefined, name: string): FormatHints[number] | null {
  if (hints === undefined) return null;
  return (
    hints.find((entry) => entry.key === name) ??
    hints.find((entry) => entry.key.endsWith("/") && name.startsWith(entry.key)) ??
    null
  );
}

/**
 * The warnings the UI can compute as the boxholder types. A subset of the
 * server's checks on purpose — the registry's regular expressions stay on the
 * server rather than being rebuilt from a string in the browser — and the
 * authoritative list comes back from the save either way.
 */
function liveWarnings(entry: FormatHints[number] | null, value: string): string[] {
  if (entry === null || value === "") return [];
  const warnings: string[] = [];
  if (value !== value.trim()) warnings.push("There is leading or trailing whitespace — usually a copy-paste artifact.");
  const trimmed = value.trim();
  if (entry.prefix !== undefined && !trimmed.startsWith(entry.prefix)) {
    warnings.push(`Keys for this service usually start with "${entry.prefix}".`);
  }
  if (entry.minLength !== undefined && trimmed.length < entry.minLength) {
    warnings.push(`This looks short (${trimmed.length} characters) — a truncated paste?`);
  }
  if (entry.maxLength !== undefined && trimmed.length > entry.maxLength) {
    warnings.push(`This looks long (${trimmed.length} characters) — did extra text come along?`);
  }
  return warnings;
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <Stack gap="xs">
      {warnings.map((warning) => (
        <Text key={warning} size="sm" tone="emphasis">{warning}</Text>
      ))}
    </Stack>
  );
}

/**
 * Set or rotate one secret's value. `name` fixed means "rotate this one";
 * `name` editable means "add a new one", which creates the machine-level entry
 * — granting it to a box is the separate act below.
 */
export function SecretValueForm({
  fixedName,
  hints,
  onSaved,
}: {
  fixedName: string | null;
  hints: FormatHints | undefined;
  onSaved: () => void;
}) {
  const [name, setName] = useState(fixedName ?? "");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  // One reason, appended rather than replacing — a rotation must never erase why
  // the key was granted, and further reasons accumulate as callers appear.
  const [use, setUse] = useState("");
  const setValueMutation = trpc.secrets.setValue.useMutation();
  const entry = formatHintFor(hints, name);
  const warnings = liveWarnings(entry, value);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "" || value === "") return;
    try {
      await setValueMutation.mutateAsync({
        name: name.trim(),
        value,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
        ...(use.trim() === "" ? {} : { uses: [use.trim()] }),
      });
      setValue("");
      setUse("");
      onSaved();
    } catch (_error) {
      // The mutation's error state renders below the button.
    }
  };

  const verified = setValueMutation.data?.verified;
  return (
    <Card background="warm" border="subtle" padding="sm">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="sm">
          {fixedName === null ? (
            <TextField label="Name" value={name} onChange={setName} placeholder="e.g. weatherapi" required />
          ) : (
            <Text size="sm" tone="muted">Rotating <Text mono>{fixedName}</Text></Text>
          )}
          <TextField
            label="Value"
            type="password"
            value={value}
            onChange={setValue}
            autoComplete="off"
            required
            helper={entry?.hint ?? "Stored in the machine secret store; never shown again."}
          />
          {fixedName === null ? (
            <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="What it is for" />
          ) : null}
          <TextField
            label="Used for (optional)"
            value={use}
            onChange={setUse}
            placeholder="e.g. weather forecasts in the morning brief"
            helper="Why this secret exists. Added to the reasons it already lists, never replacing them."
          />

          <WarningList warnings={warnings} />
          <Row gap="sm" wrap>
            <Button type="submit" intent="primary" loading={setValueMutation.isPending} loadingLabel="Saving…">
              Save and verify
            </Button>
          </Row>
          {setValueMutation.data ? (
            <div role="status">
              <Stack gap="xs">
                <WarningList warnings={setValueMutation.data.warnings} />
                <Text size="sm" tone={verified?.status === "failed" ? "danger" : "muted"}>
                  {verified?.status === "ok"
                    ? "Saved. The provider accepted this credential."
                    : `Saved. ${verified?.reason ?? "Not verified."}`}
                </Text>
              </Stack>
            </div>
          ) : null}
          {setValueMutation.error ? (
            <div role="alert"><Text size="sm" tone="danger">{setValueMutation.error.message}</Text></div>
          ) : null}
        </Stack>
      </form>
    </Card>
  );
}

/**
 * Grant an existing machine-level name to this box. The picker hides names
 * another box owns exclusively (`shareable: false`) — a Telegram token routes
 * to one webhook URL, so offering it here would only produce a refusal.
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

  const grantable = machine.secrets.filter(
    (secret) =>
      !grantedNames.includes(secret.name) &&
      (secret.shareable !== false || secret.owningBox === machine.thisBox),
  );
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
          id="cb-admin-secrets-grant-name"
          label="Grant an existing secret to this box"
          value={name === "" ? (grantable[0]?.name ?? "") : name}
          onChange={setName}
          options={grantable.map((secret) => ({ value: secret.name, label: secret.name }))}
        />
        <SelectField
          id="cb-admin-secrets-grant-access"
          label="Access"
          value={access}
          onChange={setAccess}
          options={[
            { value: "server", label: "server — connectors only, never disclosed to the agent" },
            { value: "agent", label: "agent — box code may resolve the value at call time" },
          ]}
        />
        <Row gap="sm" wrap>
          <Button id="cb-admin-secrets-grant-submit" type="submit" intent="primary" loading={grant.isPending} loadingLabel="Granting…">Grant</Button>
        </Row>
        {grant.error ? <div role="alert"><Text size="sm" tone="danger">{grant.error.message}</Text></div> : null}
      </Stack>
    </form>
  );
}
