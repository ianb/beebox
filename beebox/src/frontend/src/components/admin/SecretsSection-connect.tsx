/**
 * "Connect a service" — the first thing on the "This box" tab
 * (`docs/plans/secret-entry-guidance.md`, Track 1 + 3): a row of buttons, one
 * per registered guide this box does not already hold, plus "Something
 * else". Choosing one opens {@link SecretValueForm} with the name fixed (a
 * guide) or free-text (something else) and the value granted to this box in
 * the same submit — the word "grant" never appears here, per the
 * boxholder's framing that granting is the advanced/multi-box case, not the
 * primary one.
 */

import { useState } from "react";
import { Button } from "../ui/Button";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { SecretValueForm, type SecretValueFormIds } from "./SecretsSection-forms";
import type { SecretGuideEntry } from "./SecretsSection-guide";
import type { RouterOutput } from "../../lib/trpc";

type FormatHints = RouterOutput["secrets"]["formatHints"];

const PRIMARY_IDS: SecretValueFormIds = {
  name: "bbx-admin-secrets-add-name",
  value: "bbx-admin-secrets-add-value",
  note: "bbx-admin-secrets-add-note",
  submit: "bbx-admin-secrets-add-submit",
};

/** A guide names a service worth a button; a trailing-slash key is a family provisioned
 *  by its own flow (Telegram, publish) and never offered here. */
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
  // null = closed; { key: string } = a guide button was chosen (fixed name);
  // { key: null } = "Something else" (free-text name).
  const [target, setTarget] = useState<{ key: string | null } | null>(null);
  const connectable = connectableGuides(guides ?? [], grantedNames);

  return (
    <Stack gap="sm">
      <Text as="h3" size="sm" weight="semibold">Connect a service</Text>
      <Row gap="sm" wrap>
        {connectable.map((guide) => (
          <Button
            key={guide.key}
            id={`bbx-admin-secrets-connect-${guide.key}`}
            intent="secondary"
            onClick={() => setTarget({ key: guide.key })}
          >
            {guide.title}
          </Button>
        ))}
        <Button id="bbx-admin-secrets-connect-other" intent="secondary" onClick={() => setTarget({ key: null })}>
          Something else
        </Button>
      </Row>
      {target === null ? null : (
        // Keyed by target: after one accepted save the form shows its result
        // in place of the fields, and choosing another service must mount a
        // fresh form rather than reuse that finished one.
        <SecretValueForm
          key={target.key ?? "other"}
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
