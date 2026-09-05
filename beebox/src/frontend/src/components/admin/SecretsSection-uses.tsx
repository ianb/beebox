/**
 * "Used for" — why a secret exists, on every row of the Secrets section
 * (`docs/secrets.md`, "Why a secret exists").
 *
 * A grant is a standing decision, and the question a boxholder asks months
 * later is *what breaks if I revoke this?* Three sources answer it and they are
 * shown as three visually distinct things rather than one merged list, because
 * they carry different weight: what the engine's readers DO (built-in, from the
 * server-owned registry), what somebody SAID (declared on the entry, usually by
 * an agent that added a trick), and what actually HAPPENED (the distinct
 * `purpose` labels real resolves passed). The third is the one that can
 * contradict the first two — a key nobody claims but something resolves hourly
 * — so it stays subordinate in style and explicitly labelled "observed".
 */

import type { RouterOutput } from "../../lib/trpc";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

type SecretUses = RouterOutput["secrets"]["machineView"]["secrets"][number]["uses"];

function isEmpty(uses: SecretUses): boolean {
  return uses.builtin.length === 0 && uses.declared.length === 0 && uses.observed.length === 0;
}

export function SecretUsesBlock({ uses }: { uses: SecretUses }) {
  if (isEmpty(uses)) {
    return (
      <Text size="xs" tone="muted">
        No stated uses — <Text mono size="xs">bbx secrets describe &lt;name&gt; --add-use "…"</Text> records why this exists.
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      <Text size="xs" tone="muted" uppercase weight="medium">Used for</Text>
      {uses.builtin.length === 0 && uses.declared.length === 0 ? null : (
        <ul className="list-disc pl-4 space-y-0.5">
          {uses.builtin.map((use) => (
            <li key={`builtin-${use}`}>
              <Text size="sm" tone="subtle">{use}</Text>
            </li>
          ))}
          {uses.declared.map((use) => (
            <li key={`declared-${use}`}>
              <Text size="sm" tone="subtle">{use}</Text> <Text size="xs" tone="muted">(declared)</Text>
            </li>
          ))}
        </ul>
      )}
      {uses.observed.length === 0 ? null : (
        <Text size="xs" tone="muted" italic>observed: {uses.observed.join(" · ")}</Text>
      )}
    </Stack>
  );
}
