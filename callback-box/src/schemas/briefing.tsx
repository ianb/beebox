/**
 * Briefing card schema — core situational context for a box.
 *
 * A briefing card captures what this box is for, who the key people are,
 * and essential context that every agent needs. It compiles to a markdown
 * file that lives directly in the box (not .callback-box/) and is
 * @-included from CLAUDE.md.
 *
 * Root briefing: `briefing.briefing.card` at box root.
 * Directory briefings: `briefing.briefing.card` in any subdirectory.
 */

import { element, type ElementNode } from "cardworks";
import { z } from "zod";

// ============================================
// Briefing elements
// ============================================

export const Purpose = element("purpose", {
  text: z.string().optional(),
});

export const PersonEntry = element("person", {
  attrs: {
    name: z.string(),
    called: z.string().optional(),
    role: z.string().optional(),
    ref: z.string().optional(),
  },
  text: z.string().optional(),
});

export const KeyPeople = element("key-people", {
  children: z.array(PersonEntry),
});

export const AgentNeedsToKnow = element("agent-needs-to-know", {
  text: z.string(),
});

export const ProjectPhase = element("project-phase", {
  attrs: {
    date: z.string(),
  },
  text: z.string(),
});

export const CorrectionTest = element("test", {
  text: z.string(),
});

export const CorrectionInstruction = element("instruction", {
  text: z.string(),
});

export const Correction = element("correction", {
  children: z.array(z.union([CorrectionInstruction, CorrectionTest])),
});

export const Corrections = element("corrections", {
  children: z.array(Correction),
});

// ============================================
// Briefing schema
// ============================================

export const BriefingSchema = element("briefing", {
  children: z.array(
    z.union([
      Purpose,
      KeyPeople,
      AgentNeedsToKnow,
      ProjectPhase,
      Corrections,
    ])
  ),
  instructions: `# Briefing Cards

A briefing card captures the core situational context for a box (or a directory within a box). It's the primary place for information that every agent needs to know.

There is one briefing per directory, at \`briefing.briefing.card\`. The root briefing describes the whole box. Directory briefings explain what that directory contains.

**Structure:**
- \`<purpose>\` — What this box (or directory) is for. Required.
- \`<key-people>\` — People central to the box's purpose, with aliases so agents can map names. Each \`<person>\` has \`name\` (required), optional \`called\` (alias), optional \`role\`, optional \`ref\` (path to person card). Body text is a brief description.
- \`<agent-needs-to-know>\` — Freeform catch-all for facts every agent must have that don't fit other fields.
- \`<project-phase date="YYYY-MM-DD">\` — Optional. Current stage of time-bounded work. Leave out if there's no clear phase.
- \`<corrections>\` — Only add in response to observed agent behavior that needs correcting. Each \`<correction>\` has an \`<instruction>\` child (the corrective instruction) and a \`<test>\` child describing how to verify the correction is still needed.

**When to edit a briefing:**
- You learn something that changes how any agent should understand this box
- A new key person is identified (create a person card too: \`people/First_Last.person.card\`)
- The project enters a new phase
- An agent repeatedly makes a mistake that a correction would prevent

**Do NOT put here:**
- Individual items (those are record/memo cards)
- Processing rules (those go in guide cards)
- Communication style preferences (those go in the personality card)`,
});

export type Briefing = z.infer<typeof BriefingSchema>;

// ============================================
// Parsed briefing
// ============================================

export interface ParsedBriefing {
  purpose: string | undefined;
  keyPeople: Array<{
    name: string;
    called: string | undefined;
    role: string | undefined;
    ref: string | undefined;
    description: string | undefined;
  }>;
  agentNeedsToKnow: string | undefined;
  projectPhase: {
    date: string;
    text: string;
  } | undefined;
  corrections: Array<{
    text: string;
    test: string | undefined;
  }>;
}

function getChild(children: ElementNode[], tagName: string): ElementNode | undefined {
  return children.find((c) => c.tagName === tagName);
}

function getChildren(children: ElementNode[], tagName: string): ElementNode[] {
  return children.filter((c) => c.tagName === tagName);
}

/**
 * Parse a briefing element into a typed structure.
 */
export function parseBriefing(briefing: Briefing): ParsedBriefing {
  const children = briefing.children as ElementNode[];

  const purposeEl = getChild(children, "purpose");
  const keyPeopleEl = getChild(children, "key-people");
  const needsToKnowEl = getChild(children, "agent-needs-to-know");
  const phaseEl = getChild(children, "project-phase");
  const correctionsEl = getChild(children, "corrections");

  // Parse key people
  const peopleChildren = (keyPeopleEl?.children ?? []) as ElementNode[];
  const keyPeople = getChildren(peopleChildren, "person").map((p) => ({
    name: p.attrs.name as string,
    called: p.attrs.called as string | undefined,
    role: p.attrs.role as string | undefined,
    ref: p.attrs.ref as string | undefined,
    description: p.text ?? undefined,
  }));

  // Parse project phase
  const projectPhase = phaseEl
    ? {
        date: phaseEl.attrs.date as string,
        text: phaseEl.text ?? "",
      }
    : undefined;

  // Parse corrections
  const correctionChildren = (correctionsEl?.children ?? []) as ElementNode[];
  const corrections = getChildren(correctionChildren, "correction").map((c) => {
    const cChildren = (c.children ?? []) as ElementNode[];
    const instrEl = getChild(cChildren, "instruction");
    const testEl = getChild(cChildren, "test");
    return {
      text: instrEl?.text ?? "",
      test: testEl?.text ?? undefined,
    };
  });

  return {
    purpose: purposeEl?.text ?? undefined,
    keyPeople,
    agentNeedsToKnow: needsToKnowEl?.text ?? undefined,
    projectPhase,
    corrections,
  };
}

// ============================================
// Compile briefing to markdown
// ============================================

/**
 * Compile a parsed briefing into markdown.
 *
 * Skips empty sections. Strips <test> elements from corrections.
 * The `directoryLabel` parameter is used for directory briefings
 * (e.g., "store/archive/financial").
 */
export function compileBriefing(parsed: ParsedBriefing, directoryLabel?: string): string {
  const lines: string[] = [];

  if (directoryLabel) {
    lines.push(`## Briefing: ${directoryLabel}`);
  } else {
    lines.push("## Box Briefing");
  }
  lines.push("");

  if (parsed.purpose) {
    lines.push(`**Purpose:** ${parsed.purpose}`);
    lines.push("");
  }

  if (parsed.keyPeople.length > 0) {
    lines.push("**Key People:**");
    for (const person of parsed.keyPeople) {
      const alias = person.called ? ` ("${person.called}")` : "";
      const desc = person.description ? ` — ${person.description}` : "";
      const ref = person.ref ? ` [→ ${person.ref}]` : "";
      lines.push(`- **${person.name}**${alias}${desc}${ref}`);
    }
    lines.push("");
  }

  if (parsed.agentNeedsToKnow) {
    lines.push("**Need to Know:**");
    lines.push(parsed.agentNeedsToKnow.trim());
    lines.push("");
  }

  if (parsed.projectPhase) {
    lines.push(`**Current Phase** (${parsed.projectPhase.date}):`);
    lines.push(parsed.projectPhase.text.trim());
    lines.push("");
  }

  if (parsed.corrections.length > 0) {
    lines.push("**Corrections:**");
    for (const correction of parsed.corrections) {
      lines.push(`- ${correction.text.trim()}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================
// Initial briefing template
// ============================================

/**
 * Create a seed briefing template for a new box.
 */
export function createBriefingTemplate(): string {
  return `<briefing>
<!-- What is this box for? Fill in the purpose. -->
<purpose/>

<!-- Key people: who is central to this box's purpose?
     Create a person card for each: people/First_Last.person.card
     Example:
     <person name="Jane Smith" called="Mom" ref="people/Jane_Smith.person.card">
       Ian's mother. Primary contact for household matters.
     </person>
-->
<key-people/>
</briefing>
`;
}
