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
  const arranged = fields.proposal.windows.flatMap((window) => window.tabs);
  const arrangedIds = new Set<string>();
  const closedIds = new Set<string>();
  const issues: LintIssue[] = [];

  for (const id of arranged) {
    if (!sourceIds.has(id)) {
      issues.push({ type: "validation", severity: "error", message: `proposal contains unknown tab ${id}` });
    } else if (arrangedIds.has(id)) {
      issues.push({ type: "validation", severity: "error", message: `proposal contains tab ${id} in more than one window position` });
    }
    arrangedIds.add(id);
  }
  for (const id of fields.proposal.close) {
    if (!sourceIds.has(id)) {
      issues.push({ type: "validation", severity: "error", message: `proposal closes unknown tab ${id}` });
    } else if (closedIds.has(id)) {
      issues.push({ type: "validation", severity: "error", message: `proposal closes tab ${id} more than once` });
    }
    closedIds.add(id);
  }

  const annotated = arrangedIds.size === sourceIds.size
    && [...sourceIds].every((id) => arrangedIds.has(id));
  const legacy = arranged.length + fields.proposal.close.length === sourceIds.size
    && fields.proposal.close.every((id) => !arrangedIds.has(id));
  if (!annotated && !legacy) {
    issues.push({
      type: "validation",
      severity: "error",
      message: "every source tab must appear in exactly one proposed window; deleted tabs must also be listed in close",
    });
  } else if (annotated) {
    for (const id of closedIds) {
      if (!arrangedIds.has(id)) {
        issues.push({ type: "validation", severity: "error", message: `deleted tab ${id} is missing from the proposed windows` });
      }
    }
  }
  if (closedIds.size >= sourceIds.size) {
    issues.push({ type: "validation", severity: "error", message: "at least one tab must remain open" });
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
body. Preserve every source tab UUID: each UUID must appear exactly once
in one proposed window's ordered \`tabs\` list. Mark tabs to delete by also adding
their UUIDs to \`close\`; keep those UUIDs in their proposed window and roughly in
place so the boxholder can review them in context. Never replace a UUID with a
URL. Existing source window UUIDs preserve those windows; a new UUID creates a
new window. Keep pinned tabs before unpinned tabs in each window, and leave at
least one tab open.

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
