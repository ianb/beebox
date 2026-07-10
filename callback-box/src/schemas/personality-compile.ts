/**
 * Section emitters for `compilePersonality` — each appends its slice of
 * markdown to the running `lines` array. Extracted from personality.tsx
 * to keep the compiler's branching complexity low; behavior is identical.
 */

import type { Boxholder, PersonalityFields } from "./personality-fields.js";

export function appendIdentity(lines: string[], fields: PersonalityFields): void {
  if (fields["goes-by"] !== undefined && fields["goes-by"] !== "") {
    lines.push(`You are **${fields["goes-by"]}**.`);
    if (fields.role !== undefined && fields.role !== "") {
      lines.push(`Your role: ${fields.role}.`);
    }
  } else if (fields.role !== undefined && fields.role !== "") {
    lines.push(`**Role:** ${fields.role}`);
  }
}

export function appendBoxholder(
  lines: string[],
  { fields, boxholders }: { fields: PersonalityFields; boxholders: Boxholder[] },
): void {
  const identityLine = formatBoxholders(boxholders);
  if (identityLine !== "") lines.push(identityLine);

  const confidentRelationships = (fields.boxholder?.relationships ?? []).filter(
    (r) => (r.confidence ?? "confirmed") !== "hypothesis",
  );
  for (const rel of confidentRelationships) {
    lines.push(rel.text);
  }
}

/**
 * Render the boxholder identity sentence. One boxholder →
 * "Your boxholder is **Name** (Called)."; several →
 * "Your boxholders are **A** (a), **B**, and **C**.". Empty list → "".
 */
function formatBoxholders(boxholders: Boxholder[]): string {
  const parts = boxholders.map((b) => {
    const called = b.called !== undefined && b.called !== "" ? ` (${b.called})` : "";
    return `**${b.name}**${called}`;
  });
  if (parts.length === 0) return "";
  if (parts.length === 1) return `Your boxholder is ${parts[0]}.`;
  const last = parts.at(-1) ?? "";
  const rest = parts.slice(0, -1).join(", ");
  return `Your boxholders are ${rest}, and ${last}.`;
}

export function appendDescription(lines: string[], fields: PersonalityFields): void {
  const description = fields.body.trim();
  if (description !== "") {
    lines.push(description);
    lines.push("");
  }
}

export function appendTone(lines: string[], fields: PersonalityFields): void {
  const confidentTone = (fields.tone ?? []).filter(
    (t) => (t.confidence ?? "medium") !== "hypothesis",
  );
  if (confidentTone.length > 0) {
    lines.push("**Tone:**");
    for (const instruction of confidentTone) {
      lines.push(`- ${instruction.text}`);
    }
    lines.push("");
  }
}

export function appendSpeakingVoice(lines: string[], fields: PersonalityFields): void {
  const sv = fields["speaking-voice"];
  if (sv !== undefined && (sv.model !== undefined || (sv.instructions ?? []).length > 0)) {
    lines.push("**Speaking Voice:**");
    if (sv.model !== undefined) lines.push(`- Voice model: ${sv.model}`);
    for (const instruction of sv.instructions ?? []) {
      lines.push(`- ${instruction}`);
    }
    lines.push("- Edit `speaking-voice` in `config/main.personality.card` to change defaults");
    lines.push("- For per-message voice or instruction overrides (chat only), see `docs/generated/chat-voice.md`");
    lines.push("");
  }
}

export function appendExperiments(lines: string[], fields: PersonalityFields): void {
  const activeExperiments = (fields.experiments ?? []).filter(
    (e) => (e.status ?? "proposed") === "active" || (e.status ?? "proposed") === "proposed",
  );
  if (activeExperiments.length > 0) {
    lines.push("**Active Experiments:**");
    for (const exp of activeExperiments) {
      const hypothesis = exp.hypothesis !== undefined ? `: ${exp.hypothesis}` : "";
      lines.push(`- **${exp.id}**${hypothesis}`);
    }
    lines.push("");
  }
}

export function appendContext(lines: string[], fields: PersonalityFields): void {
  const currentContext = (fields["context-notes"] ?? []).filter(
    (c) => (c.duration ?? "ongoing") !== "past",
  );
  if (currentContext.length > 0) {
    lines.push("**Context:**");
    for (const note of currentContext) {
      const label = note.duration === "temporary" ? " (temporary)" : "";
      lines.push(`- ${note.text}${label}`);
    }
    lines.push("");
  }
}
