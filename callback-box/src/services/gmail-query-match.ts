/**
 * Fake-Gmail query matching — the `label:` subset of Gmail search syntax.
 *
 * The real Gmail API evaluates arbitrary queries server-side; the fake can't,
 * so it supports only `label:NAME` terms (a single term or `label:a OR
 * label:b`) plus the bare `label:inbox` default. A query carrying no `label:`
 * term can't be evaluated from the fake's limited view, so it matches
 * everything — matching the pull tests that seed only messages they expect to
 * match. Lives in its own module so `google-gmail.ts` stays under its line cap.
 */

import type { GmailMessage, GmailLabel } from "./google-gmail.js";

export function messageMatchesQuery(opts: {
  msg: GmailMessage;
  query: string | undefined;
  labels: GmailLabel[];
}): boolean {
  const { msg, query, labels } = opts;
  if (!query) return true;
  const labelNames = [...query.matchAll(/label:(\S+)/g)].map((m) => m[1]!);
  if (labelNames.length === 0) return true;
  const targetIds = new Set(
    labelNames.map((name) => {
      const match = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      return match ? match.id : name.toUpperCase();
    }),
  );
  return (msg.labelIds ?? []).some((id) => targetIds.has(id));
}
