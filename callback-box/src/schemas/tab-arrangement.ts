import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type LintIssue } from "../cards/index.js";
import {
  capturedTabSet,
  tabArrangementProposal,
  tabTransferScope,
} from "../webapp/trpc/routers/clerk-contract.js";

interface ArrangementFields {
  source: z.infer<typeof capturedTabSet>;
  proposal: z.infer<typeof tabArrangementProposal>;
}

export function arrangementIssues(fields: ArrangementFields): LintIssue[] {
  const sourceTabs = fields.source.windows.flatMap((window) => window.tabs);
  const sourceIds = new Set(sourceTabs.map((tab) => tab.id));
  const proposed = [
    ...fields.proposal.windows.flatMap((window) => window.tabs),
    ...fields.proposal.close,
  ];
  const seen = new Set<string>();
  const issues: LintIssue[] = [];

  for (const id of proposed) {
    if (!sourceIds.has(id)) {
      issues.push({ type: "validation", severity: "error", message: `proposal contains unknown tab ${id}` });
    } else if (seen.has(id)) {
      issues.push({ type: "validation", severity: "error", message: `proposal contains tab ${id} more than once` });
    }
    seen.add(id);
  }
  for (const id of sourceIds) {
    if (!seen.has(id)) {
      issues.push({ type: "validation", severity: "error", message: `proposal omits source tab ${id}` });
    }
  }

  const pinnedById = new Map(sourceTabs.map((tab) => [tab.id, tab.pinned]));
  for (const window of fields.proposal.windows) {
    let sawUnpinned = false;
    for (const id of window.tabs) {
      const pinned = pinnedById.get(id);
      if (pinned === false) sawUnpinned = true;
      if (pinned === true && sawUnpinned) {
        issues.push({
          type: "validation",
          severity: "error",
          message: `window ${window.id} puts pinned tab ${id} after an unpinned tab`,
        });
      }
    }
  }
  return issues;
}

function validatedArrangementIssues(fields: Record<string, unknown>): LintIssue[] {
  const source = capturedTabSet.safeParse(fields["source"]);
  const proposal = tabArrangementProposal.safeParse(fields["proposal"]);
  // The card schema reports field-level Zod errors separately. Cross-field
  // checks only run once both halves have a usable shape.
  if (!source.success || !proposal.success) return [];
  return arrangementIssues({ source: source.data, proposal: proposal.data });
}

export const TabArrangementSchema = cardSchema("tab-arrangement", {
  description: "A Clerk-captured tab set and an identity-preserving proposal for arranging it",
  category: "synced",
  validate: ({ fields }) => validatedArrangementIssues(fields),
  fields: {
    "transfer-id": z.string().uuid(),
    scope: tabTransferScope,
    "captured-at": z.string().datetime(),
    source: capturedTabSet,
    proposal: tabArrangementProposal,
    status: z.enum(["draft", "ready"]).default("draft"),
    body: body(z.string()),
  },
  instructions: `# Tab Arrangement Cards

A tab arrangement card is a captured browser snapshot sent by Callback Clerk.
Help the boxholder reorganize it by editing only the \`proposal\` and explanatory
body. Preserve every source tab UUID: each UUID must appear exactly once, either
in one proposed window's ordered \`tabs\` list or in \`close\`. Never replace a
UUID with a URL. Existing source window UUIDs preserve those windows; a new UUID
creates a new window. Keep pinned tabs before unpinned tabs in each window.

Set \`status: ready\` only when the boxholder agrees the proposal is ready to
apply. Applying is always a separate, explicit action in the card viewer. Clerk
will refuse the whole change before mutation if the live tabs no longer exactly
match the captured snapshot. Do not edit \`transfer-id\`, \`scope\`,
\`captured-at\`, or \`source\`.
`,
});

export function createTabArrangementCard(input: {
  transferId: string;
  scope: z.infer<typeof tabTransferScope>;
  capturedAt: string;
  source: z.infer<typeof capturedTabSet>;
  proposal: z.infer<typeof tabArrangementProposal>;
}): string {
  const frontmatter = stringifyYaml({
    "transfer-id": input.transferId,
    scope: input.scope,
    "captured-at": input.capturedAt,
    source: input.source,
    proposal: input.proposal,
    status: "draft",
  });
  return `---\n${frontmatter}---\n\nCaptured by Callback Clerk. Revise the proposal with the boxholder before applying.\n`;
}
