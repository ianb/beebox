/**
 * Adding a new key to this box: pick the service (each known one has a
 * guide) or "Something else", then the value form. One picker rather than a
 * button per service, so the section stays short when nothing is being added.
 */

import { useState } from "react";
import { Stack } from "../../ui/Stack";
import { SelectField } from "../../ui/fields/field";
import { SecretValueForm, type SecretValueFormIds } from "./forms";
import type { SecretGuideEntry } from "./guide";
import type { RouterOutput } from "../../../lib/trpc/client";

const PRIMARY_IDS: SecretValueFormIds = {
  name: "bbx-admin-secrets-add-name",
  value: "bbx-admin-secrets-add-value",
  note: "bbx-admin-secrets-add-note",
  submit: "bbx-admin-secrets-add-submit",
};

/** The picker's value for a key the engine has no guide for. */
const OTHER = "other";

type FormatHints = RouterOutput["secrets"]["formatHints"];

/** Guides for names a box can hold. A key ending in "/" is a family entry
 *  (`telegram-bot/`): explanatory, not a secret anyone pastes. */
function connectableGuides(guides: SecretGuideEntry[], grantedNames: string[]): SecretGuideEntry[] {
  return guides.filter((guide) => !guide.key.endsWith("/") && !grantedNames.includes(guide.key));
}

export function ConnectServiceSection({
  guides,
  grantedNames,
  boxSlug,
  hints,
  onSaved,
}: {
  guides: SecretGuideEntry[] | undefined;
  grantedNames: string[];
  boxSlug: string;
  hints: FormatHints | undefined;
  onSaved: () => void;
}) {
  // null = nothing chosen; { key: string } = a guided service (fixed name);
  // { key: null } = "Something else" (free-text name).
  const [target, setTarget] = useState<{ key: string | null } | null>(null);
  const connectable = connectableGuides(guides ?? [], grantedNames);
  const selected = target === null ? "" : (target.key ?? OTHER);

  return (
    <Stack gap="sm">
      <SelectField
        id="bbx-admin-secrets-connect"
        label="Add a new key"
        helper="Each known service comes with a guide to where its key is issued."
        value={selected}
        onChange={(value) => setTarget(value === "" ? null : { key: value === OTHER ? null : value })}
        options={[
          { value: "", label: "Choose a service…" },
          ...connectable.map((guide) => ({ value: guide.key, label: guide.title })),
          { value: OTHER, label: "Something else" },
        ]}
      />
      {target === null ? null : (
        // Keyed by target: after one accepted save the form shows its result
        // in place of the fields, and choosing another service must mount a
        // fresh form rather than reuse that finished one.
        <SecretValueForm
          key={target.key ?? OTHER}
          fixedName={target.key}
          hints={hints}
          guides={guides}
          grantBox={boxSlug}
          ids={PRIMARY_IDS}
          showUsesField={false}
          onSaved={onSaved}
        />
      )}
    </Stack>
  );
}
