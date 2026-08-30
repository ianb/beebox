/**
 * Domain-specific seed configurations and the initial-guide template builder.
 *
 * `createInitialGuideTemplate` emits the YAML frontmatter for a fresh guide
 * card, either from a known domain seed or a generic fallback.
 */

import { stringify as stringifyYaml } from "yaml";

/**
 * Domain-specific seed configurations for initial guides.
 */
interface GuideSeed {
  jobTypes: string;
  appliesTo: string;
  actions: Array<{ name: string; when: string; instructions: string }>;
  triageRules: string[];
  defaultAction: { action: string; text: string };
  experiment: { id: string; hypothesis: string; approach: string };
  reactions: Array<{ id: string; sentiment: string; text: string }>;
}

const DOMAIN_SEEDS: Record<string, GuideSeed> = {
  intake: {
    jobTypes: "intake-job",
    appliesTo: "Use when triaging new inbox items (memos, bookmarks, captures)",
    actions: [
      {
        name: "Archive",
        when: "Item is useful reference material",
        instructions: "Move to store/archive/ with appropriate subdirectory",
      },
      {
        name: "Convert to Recipe",
        when: "Item contains a recipe or cooking instructions",
        instructions: "Create a recipe card in store/recipes/ using bbx create, then trash the original",
      },
      {
        name: "Keep for Reading",
        when: "Item is worth reading later but not urgent",
        instructions: "Move to a suitable location under store/ (e.g. store/reading/) with bbx mv",
      },
      {
        name: "Trash",
        when: "Item is not useful or relevant",
        instructions: "Use bbx rm to soft-delete",
      },
      {
        name: "Ask User",
        when: "Unsure about disposition or need clarification",
        instructions: "Create a question card in box/questions/",
      },
    ],
    triageRules: [
      "Recipes and cooking content → Convert to Recipe",
      "Reference material and documentation → Archive",
    ],
    defaultAction: {
      action: "Ask User",
      text: "When unsure about an item, ask the user what to do with it",
    },
    experiment: {
      id: "exp-initial",
      hypothesis: "Initial triage rules need calibration through user feedback",
      approach: "Triage conservatively, ask when unsure, learn from answers",
    },
    reactions: [],
  },
  calendar: {
    jobTypes: "",
    appliesTo: "Use when reviewing calendar event changes, or when creating/editing/deleting calendar events",
    actions: [
      {
        name: "Create Reminder",
        when: "Event needs preparation (meeting prep, travel, etc.)",
        instructions: "Create a memo card in box/inbox/ with preparation notes",
      },
      {
        name: "Note Change",
        when: "Significant change that user should know about (time/location change, cancellation)",
        instructions: "Create a memo card highlighting what changed and any needed adjustments",
      },
      {
        name: "Create Event",
        when: "User asks to add a new event to their calendar",
        instructions: "Write a new .ics file in store/calendar/ with proper ICS format including VTIMEZONE and TZID. Use X-BBX-CALENDAR-ID to target a specific calendar. The event will be pushed to Google Calendar on next sync.",
      },
      {
        name: "Edit Event",
        when: "User asks to change an existing calendar event (time, title, location, etc.)",
        instructions: "Find the .ics file in store/calendar/ and edit the relevant properties. Changes are pushed to Google Calendar on next sync.",
      },
      {
        name: "Delete Event",
        when: "User asks to remove a calendar event",
        instructions: "Add an X-BBX-DELETE property (value: a short reason) to the .ics file. The event will be deleted from Google Calendar on next sync.",
      },
      {
        name: "Ignore",
        when: "Routine change that doesn't need attention",
        instructions: "No action needed — just review and move on",
      },
    ],
    triageRules: [],
    defaultAction: {
      action: "Ignore",
      text: "Most calendar changes are informational and don't need action",
    },
    experiment: {
      id: "exp-initial",
      hypothesis: "Most calendar changes need no action",
      approach: "Default to ignoring, learn which events actually need preparation",
    },
    reactions: [],
  },
  drive: {
    jobTypes: "",
    appliesTo: "Use when the user asks about spreadsheet data synced from Google Drive",
    actions: [
      {
        name: "Read Spreadsheet",
        when: "User asks about data in a synced spreadsheet",
        instructions: "Find the .gsheet.card file to understand structure (tabs, title). Then read the JSON tab file(s) in the matching subdirectory. Plain cells are bare values; formula cells are {\"f\": formula, \"v\": computed_result}.",
      },
      {
        name: "Edit Spreadsheet",
        when: "User asks to change values in a synced spreadsheet",
        instructions: "Edit the JSON file directly and commit. For plain cells change the value; for formula cells edit the 'f' field. Changes push to Google Sheets on next sync (bbx drive sync or bbx wakeup).",
      },
    ],
    triageRules: [],
    defaultAction: {
      action: "Read",
      text: "When in doubt, read the card and CSV files to understand the data",
    },
    experiment: {
      id: "exp-drive-initial",
      hypothesis: "Users primarily want to read spreadsheet data, edits are less common",
      approach: "Default to reading and presenting data, offer to edit when asked",
    },
    reactions: [],
  },
  scan: {
    // Consumed by the scan-import photo flow, which compiles this guide
    // in-memory into the per-page vision prompt (scan-guide-context.ts) —
    // no job-card type, so no job-types routing.
    jobTypes: "",
    appliesTo: "Scanner priors for bbx scan-import photo extraction — people, places, vendors, and handwriting clues used to disambiguate names and dates on scanned photos and documents",
    actions: [
      {
        name: "Ask User",
        when: "An identification or date on a scanned page is ambiguous and these priors don't resolve it",
        instructions: "Create a question card in box/questions/",
      },
    ],
    triageRules: [
      "Use these priors for disambiguation only — never invent an identification without strong visual or textual evidence",
    ],
    defaultAction: {
      action: "Ask User",
      text: "When a prior is missing or contradicted by what's on the page, ask rather than guess",
    },
    experiment: {
      id: "exp-scan-initial",
      hypothesis: "Priors listed here reduce misread names and dates in scan extraction",
      approach: "Record durable identifications from answered scan questions as triage rules; verify low-confidence priors with the boxholder",
    },
    reactions: [],
  },
  chat: {
    jobTypes: "chat-job",
    appliesTo: "Use when processing chat messages from messaging connectors (Telegram, etc.)",
    actions: [
      {
        name: "Respond",
        when: "Direct question, request for help, or when you have genuinely useful information",
        instructions: "Append an entry to the thread's entries[] with kind: message, sender: agent, and text: <your reply>. Keep it conversational and concise.",
      },
      {
        name: "Acknowledge",
        when: "Casual chatter, messages between other people, or when silence is appropriate",
        instructions: "Append an entry to entries[] with kind: seen. Optionally include text (note-to-self) and callback-in.",
      },
      {
        name: "Follow Up",
        when: "Something needs checking later (e.g. unanswered question, pending task)",
        instructions: "Append an entry to entries[] with kind: seen, callback-in: 30m (or other duration), and text: <what to check>. Schedules a re-invocation.",
      },
    ],
    triageRules: [
      "Direct questions or @mentions → Respond",
      "Logistics requests (pickups, scheduling, reminders) → Respond",
      "Casual conversation between other people → Acknowledge",
    ],
    defaultAction: {
      action: "Acknowledge",
      text: "When unsure whether to respond, stay quiet — unsolicited messages are annoying",
    },
    experiment: {
      id: "exp-initial",
      hypothesis: "Default to silence; learn which messages actually need responses",
      approach: "Start conservative, observe what kinds of messages get follow-up questions when ignored",
    },
    reactions: [],
  },
};

/**
 * Create an initial guide template for a given domain.
 */
export function createInitialGuideTemplate(options: { name: string }): string {
  const seed = DOMAIN_SEEDS[options.name];
  const fields: Record<string, unknown> = { version: "1.0.0" };

  if (!seed) {
    fields["applies-to"] = "Describe when this guide applies";
    fields["default-action"] = { action: "Ask User", text: "When unsure, ask the user" };
    fields.actions = [
      {
        name: "Ask User",
        when: "Unsure about disposition",
        instructions: "Create a question card in box/questions/",
      },
    ];
    fields.experiments = [
      {
        id: "exp-initial",
        status: "active",
        hypothesis: "Initial rules need calibration through feedback",
        approach: "Start conservative, learn from user responses",
      },
    ];
    return `---\n${stringifyYaml(fields)}---\n`;
  }

  const jobTypes = seed.jobTypes.split(/\s+/).filter(Boolean);
  if (jobTypes.length > 0) fields["job-types"] = jobTypes;
  fields["applies-to"] = seed.appliesTo;
  if (seed.triageRules.length > 0) {
    fields["triage-rules"] = seed.triageRules.map((text) => ({
      text,
      confidence: "low",
      source: "default",
    }));
  }
  fields["default-action"] = { action: seed.defaultAction.action, text: seed.defaultAction.text };
  fields.actions = seed.actions.map((a) => ({ name: a.name, when: a.when, instructions: a.instructions }));
  fields.experiments = [
    {
      id: seed.experiment.id,
      status: "active",
      hypothesis: seed.experiment.hypothesis,
      approach: seed.experiment.approach,
    },
  ];
  if (seed.reactions.length > 0) {
    fields.reactions = seed.reactions.map((r) => ({ id: r.id, sentiment: r.sentiment, text: r.text }));
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
