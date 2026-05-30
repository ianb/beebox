/**
 * Domain-specific seed configurations and the initial-guide template builder.
 *
 * `createInitialGuideTemplate` emits the XML body for a fresh guide card,
 * either from a known domain seed or a generic fallback.
 */

import { escapeAttr, escapeText } from "cardworks";

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
        instructions: "Create a recipe card in store/recipes/ using cb create, then trash the original",
      },
      {
        name: "Keep for Reading",
        when: "Item is worth reading later but not urgent",
        instructions: "Move to box/pool/ for later processing",
      },
      {
        name: "Trash",
        when: "Item is not useful or relevant",
        instructions: "Use cb rm to soft-delete",
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
    jobTypes: "calendar-review-job",
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
        instructions: "Write a new .ics file in store/calendar/ with proper ICS format including VTIMEZONE and TZID. Use X-CB-CALENDAR-ID to target a specific calendar. The event will be pushed to Google Calendar on next sync.",
      },
      {
        name: "Edit Event",
        when: "User asks to change an existing calendar event (time, title, location, etc.)",
        instructions: "Find the .ics file in store/calendar/ and edit the relevant properties. Changes are pushed to Google Calendar on next sync.",
      },
      {
        name: "Delete Event",
        when: "User asks to remove a calendar event",
        instructions: "Add an X-CB-DELETE property (value: a short reason) to the .ics file. The event will be deleted from Google Calendar on next sync.",
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
        instructions: "Find the .sheet.card file to understand structure (tabs, title). Then read the JSON tab file(s) in the matching subdirectory. Plain cells are bare values; formula cells are {\"f\": formula, \"v\": computed_result}.",
      },
      {
        name: "Edit Spreadsheet",
        when: "User asks to change values in a synced spreadsheet",
        instructions: "Edit the JSON file directly and commit. For plain cells change the value; for formula cells edit the 'f' field. Changes push to Google Sheets on next sync (cb drive sync or cb wakeup).",
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
  const now = new Date().toISOString();

  if (!seed) {
    // Generic fallback
    return `<guide version="1.0.0">
<applies-to>Describe when this guide applies</applies-to>
<triage>
<!-- Add rules as you learn what matters -->
<default-action action="Ask User">When unsure, ask the user</default-action>
</triage>
<actions>
<action name="Ask User">
<when>Unsure about disposition</when>
<instructions>Create a question card in box/questions/</instructions>
</action>
</actions>
<experiments>
<experiment id="exp-initial" status="active" created-at="${now}">
<hypothesis>Initial rules need calibration through feedback</hypothesis>
<approach>Start conservative, learn from user responses</approach>
</experiment>
</experiments>
<reactions>
</reactions>
<context-notes>
</context-notes>
</guide>
`;
  }

  const triageRulesXml = seed.triageRules
    .map((r) => `<rule confidence="low" source="default">${escapeText(r)}</rule>`)
    .join("\n");

  const actionsXml = seed.actions
    .map(
      (a) => `<action name="${escapeAttr(a.name)}">
<when>${escapeText(a.when)}</when>
<instructions>${escapeText(a.instructions)}</instructions>
</action>`
    )
    .join("\n");

  const reactionsXml = seed.reactions
    .map((r) => `<reaction id="${escapeAttr(r.id)}" sentiment="${escapeAttr(r.sentiment)}">${escapeText(r.text)}</reaction>`)
    .join("\n");

  return `<guide version="1.0.0" job-types="${escapeAttr(seed.jobTypes)}">
<applies-to>${escapeText(seed.appliesTo)}</applies-to>
<triage>
${triageRulesXml ? triageRulesXml + "\n" : ""}<default-action action="${escapeAttr(seed.defaultAction.action)}">${escapeText(seed.defaultAction.text)}</default-action>
</triage>
<actions>
${actionsXml}
</actions>
<experiments>
<experiment id="${escapeAttr(seed.experiment.id)}" status="active" created-at="${now}">
<hypothesis>${escapeText(seed.experiment.hypothesis)}</hypothesis>
<approach>${escapeText(seed.experiment.approach)}</approach>
</experiment>
</experiments>
<reactions>
${reactionsXml ? reactionsXml + "\n" : ""}</reactions>
<context-notes>
</context-notes>
</guide>
`;
}
