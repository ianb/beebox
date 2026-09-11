/**
 * The per-name guide panel shown above the Value field once a name resolves
 * to a server-owned guide (`trpc.secrets.guides`, Track 2/3 of
 * `docs/plans/secret-entry-guidance.md`) — what the credential is, what the
 * box uses it for, and how to get one, in the Telegram section's shape
 * (`TelegramSection-views.tsx`'s "Setup steps"). Also the post-save message
 * builder: what the key now does is the truth the boxholder is waiting for
 * (principle 13), so the copy is built from `uses` rather than a generic
 * "saved" line.
 */

import type { RouterOutput } from "../../lib/trpc";
import { Card } from "../ui/Card";
import { ExternalLink } from "../ui/ExternalLink";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

export type SecretGuideEntry = RouterOutput["secrets"]["guides"][number];
type SecretVerified = RouterOutput["secrets"]["setValue"]["verified"];

/** A setup step mentions the provider's own page when it names the same host as `obtainUrl`. */
function stepMentionsObtainUrl(step: string, obtainUrl: string): boolean {
  try {
    const host = new URL(obtainUrl).hostname.replace(/^www\./, "");
    return step.toLowerCase().includes(host.toLowerCase());
  } catch (_e) {
    return false;
  }
}

export function GuidePanel({ guide }: { guide: SecretGuideEntry }) {
  const linkedStep = guide.obtainSteps.findIndex((step) => stepMentionsObtainUrl(step, guide.obtainUrl));
  return (
    <Card background="warm" border="subtle" padding="sm">
      <Stack gap="sm">
        <Text as="h3" size="sm" weight="semibold">{guide.title}</Text>
        <Text as="p" size="sm" tone="subtle">{guide.what}</Text>
        {guide.uses.length === 0 ? null : (
          <Stack gap="xs">
            <Text size="xs" tone="muted" uppercase weight="medium">Used for</Text>
            <ul className="list-disc pl-4 space-y-0.5">
              {guide.uses.map((use) => (
                <li key={use}><Text size="sm" tone="subtle">{use}</Text></li>
              ))}
            </ul>
          </Stack>
        )}
        <Stack gap="xs">
          <Text size="xs" tone="muted" uppercase weight="medium">Setup steps</Text>
          <ol className="list-decimal list-inside space-y-1">
            {guide.obtainSteps.map((step, index) => (
              <li key={step}>
                <Text size="sm" tone="subtle" as="span">{step}</Text>
                {index === linkedStep ? (
                  <>
                    {" — "}
                    <ExternalLink href={guide.obtainUrl} variant="inline">{guide.obtainUrl}</ExternalLink>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
          {linkedStep === -1 ? (
            <ExternalLink href={guide.obtainUrl} variant="inline">{guide.obtainUrl}</ExternalLink>
          ) : null}
        </Stack>
      </Stack>
    </Card>
  );
}

/** The line shown after a save — what the key now does, per principle 13. */
export function postSaveMessage(opts: {
  granted: { box: string; access: "server" | "agent" } | null;
  verified: SecretVerified;
  uses: string[];
}): string {
  const { granted, verified, uses } = opts;
  if (verified.status === "failed") {
    const reason = verified.reason ?? "the provider rejected this credential";
    return `Saved, but the provider rejected it: ${reason}. This box will use it once the value is fixed — Rotate to replace it.`;
  }
  if (granted === null) {
    return verified.status === "ok" ? "Saved and verified. No box uses it yet." : "Saved. No live check exists for this key.";
  }
  const usesClause = uses.length === 0 ? "it" : `it for: ${uses.join("; ")}`;
  return verified.status === "ok"
    ? `Saved and verified. This box now uses ${usesClause}.`
    : `Saved. No live check exists for this key; this box now uses ${usesClause}.`;
}
