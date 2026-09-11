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
import { suggestSecretName } from "@shared/secret-name-suggest.js";
import { trpc, type RouterInput, type RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAction } from "../ui/InlineAction";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextField } from "../ui/fields";
import { GuidePanel, postSaveMessage, type SecretGuideEntry } from "./SecretsSection-guide";

type FormatHints = RouterOutput["secrets"]["formatHints"];

/** The registry entry for a name: exact match, else the `family/` prefix. */
function formatHintFor(hints: FormatHints | undefined, name: string): FormatHints[number] | null {
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

/** Stable ids for the one primary (non-repeated) instance of this form — the "Connect a service" / "Something else" add flow. */
export interface SecretValueFormIds {
  name: string;
  value: string;
  note: string;
  submit: string;
}

/**
 * The free-text Name field ("Something else"), with the near-miss suggestion
 * inline underneath — advisory, never blocking (`suggestSecretName`, warn on
 * a normalised match rather than rewriting or refusing the typed name).
 */
function NameFieldWithSuggestion({
  id,
  name,
  onNameChange,
  knownNames,
}: {
  id: string | undefined;
  name: string;
  onNameChange: (name: string) => void;
  knownNames: string[];
}) {
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const suggestion = suggestionDismissed ? null : suggestSecretName(name, knownNames);
  return (
    <Stack gap="xs">
      <TextField
        id={id}
        label="Name"
        value={name}
        onChange={(next) => { onNameChange(next); setSuggestionDismissed(false); }}
        placeholder="e.g. weatherapi"
        required
      />
      {suggestion === null ? null : (
        <Text size="sm" tone="emphasis">
          Did you mean <Text mono size="sm">{suggestion}</Text>? Nothing reads a secret named <Text mono size="sm">{name}</Text>.{" "}
          <InlineAction onClick={() => { onNameChange(suggestion); setSuggestionDismissed(true); }} intent="emphatic">
            Use {suggestion}
          </InlineAction>
        </Text>
      )}
    </Stack>
  );
}

/** The secret value: the format entry lends its prefix as the placeholder and its hint as the helper. */
function ValueField({ id, entry, value, onChange }: { id?: string; entry: FormatHints[number] | null; value: string; onChange: (value: string) => void }) {
  return (
    <TextField
      id={id}
      label="Value"
      type="password"
      value={value}
      onChange={onChange}
      autoComplete="off"
      required
      placeholder={entry === null || entry.prefix === undefined ? undefined : `${entry.prefix}…`}
      helper={entry === null ? "Stored in the machine secret store; never shown again." : entry.hint}
    />
  );
}

type SetValueResult = RouterOutput["secrets"]["setValue"];
type SetValueInput = RouterInput["secrets"]["setValue"];

/** The mutation input: blank optional fields are omitted, and a target box turns into a grant. */
function setValueInput(fields: { name: string; value: string; note: string; use: string; grantBox: string | null | undefined }): SetValueInput {
  const { name, value, note, use, grantBox } = fields;
  return {
    name: name.trim(),
    value,
    ...(note.trim() === "" ? {} : { note: note.trim() }),
    ...(use.trim() === "" ? {} : { uses: [use.trim()] }),
    ...(grantBox === null || grantBox === undefined ? {} : { grant: { box: grantBox, access: "server" } }),
  };
}

/** The line after a save — a rejected value reads as danger, everything else as the plain result. */
function SavedStatus({ saved, uses }: { saved: SetValueResult; uses: string[] }) {
  return (
    <div role="status">
      <Stack gap="xs">
        <WarningList warnings={saved.warnings} />
        <Text as="p" size="sm" tone={saved.verified.status === "failed" ? "danger" : undefined}>
          {postSaveMessage({ granted: saved.granted, verified: saved.verified, uses })}
        </Text>
      </Stack>
    </div>
  );
}

/**
 * Set or rotate one secret's value. `name` fixed means "use this name" —
 * rotating an already-granted secret, filling a declared slot, or adding a
 * new one via a guide button; `name` editable means free-text entry
 * ("Something else"). `grantBox`, when set, makes the value this box's in the
 * same submit (Track 1) — omitted for a rotate/declared-slot save, which is
 * already granted, and for the Machine-wide tab's add form.
 */
export function SecretValueForm({
  fixedName,
  hints,
  guides,
  grantBox,
  ids,
  showUsesField,
  onSaved,
}: {
  fixedName: string | null;
  hints: FormatHints | undefined;
  guides?: SecretGuideEntry[];
  grantBox?: string | null;
  ids?: SecretValueFormIds;
  showUsesField?: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(fixedName ?? "");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  // One reason, appended rather than replacing — a rotation must never erase why
  // the key was granted, and further reasons accumulate as callers appear.
  const [use, setUse] = useState("");
  const setValueMutation = trpc.secrets.setValue.useMutation();
  const effectiveName = fixedName ?? name.trim();
  const entry = formatHintFor(hints, effectiveName);
  const warnings = liveWarnings(entry, value);
  const guide = guides?.find((candidate) => candidate.key === effectiveName) ?? null;
  const uses = guide === null ? [] : guide.uses;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "" || value === "") return;
    try {
      await setValueMutation.mutateAsync(setValueInput({ name, value, note, use, grantBox }));
      setValue("");
      setUse("");
      onSaved();
    } catch (_error) {
      // The mutation's error state renders below the button.
    }
  };

  const saved = setValueMutation.data;
  // A save the provider accepted (or could not check) is finished: the empty
  // form and its guide would only suggest something remains to do. A rejected
  // value keeps the form so the corrected key can be pasted straight away.
  if (saved !== undefined && saved.verified.status !== "failed") {
    return (
      <Card background="warm" border="subtle" padding="sm">
        <SavedStatus saved={saved} uses={uses} />
      </Card>
    );
  }
  return (
    <Card background="warm" border="subtle" padding="sm">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="sm">
          {guide === null ? null : <GuidePanel guide={guide} />}
          {fixedName === null ? (
            <NameFieldWithSuggestion
              id={ids?.name}
              name={name}
              onNameChange={setName}
              knownNames={(guides ?? []).map((candidate) => candidate.key)}
            />
          ) : (
            <Text size="sm" tone="muted">For <Text mono>{fixedName}</Text></Text>
          )}
          <ValueField id={ids?.value} entry={entry} value={value} onChange={setValue} />
          {fixedName === null ? (
            <TextField id={ids?.note} label="Note (optional)" value={note} onChange={setNote} placeholder="What it is for" />
          ) : null}
          {showUsesField === false ? null : (
            <TextField
              label="Used for (optional)"
              value={use}
              onChange={setUse}
              placeholder="e.g. weather forecasts in the morning brief"
              helper="Why this secret exists. Added to the reasons it already lists, never replacing them."
            />
          )}

          <WarningList warnings={warnings} />
          <Row gap="sm" wrap>
            <Button id={ids?.submit} type="submit" intent="primary" loading={setValueMutation.isPending} loadingLabel="Saving…">
              Save and verify
            </Button>
          </Row>
          {saved ? <SavedStatus saved={saved} uses={uses} /> : null}
          {setValueMutation.error ? (
            <div role="alert"><Text size="sm" tone="danger">{setValueMutation.error.message}</Text></div>
          ) : null}
        </Stack>
      </form>
    </Card>
  );
}
