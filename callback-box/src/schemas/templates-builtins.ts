/**
 * Built-in template registrations. Importing this module for its side effects
 * registers every shipped template into the shared registry. Kept separate from
 * the registry core and the describe helpers so each file stays small and the
 * registration list reads as a flat catalogue.
 */

import { z } from "zod";
import {
  createMemoTemplate,
  createVoiceMemoTemplate,
} from "./memo.js";
// Question templates register on import of this side-effect module (split out
// to keep this catalogue under its size budget).
import "./templates-question.js";
import { createInitialGuideTemplate } from "./guide.js";
import { createRecordTemplate } from "./record.js";
import { createRecipeTemplate } from "./recipe.js";
import { createScheduledScriptTemplate } from "./scheduled-script.js";
import { createTodoListTemplate } from "./todo-list.js";
import { createBriefingTemplate } from "./briefing.js";
import { createPersonTemplate } from "./person.js";
import { createPlaceTemplate } from "./place.js";
import { createDocTemplate } from "./doc.js";
import { createFigureTemplate, FigureRuntime } from "./figure.js";
import { figureStarterSketch } from "./figure-starters.js";
import { registerTemplate } from "./templates-registry.js";

registerTemplate({
  name: "memo",
  description: "A text memo card",
  cardTypes: ["memo"],
  defaultForTypes: ["memo"],
  argsSchema: z.object({
    content: z.string().describe("The memo content text"),
    source: z.string().optional().describe("Source identifier (e.g., 'text', 'email')"),
  }),
  generate: (args) => createMemoTemplate(args.content, args.source),
});

registerTemplate({
  name: "voice-memo",
  description: "A voice memo card (audio attached separately)",
  cardTypes: ["voice-memo", "memo"],
  defaultForTypes: ["voice-memo"],
  argsSchema: z.object({}),
  generate: () => createVoiceMemoTemplate(),
});

registerTemplate({
  name: "guide",
  description: "A generic guide card — triage rules, actions, experiments, reactions",
  cardTypes: ["guide"],
  defaultForTypes: ["guide"],
  argsSchema: z.object({
    name: z.string().describe("Domain name (intake, calendar, drive, chat, or custom)"),
  }),
  generate: (args) => createInitialGuideTemplate({ name: args.name }),
});

registerTemplate({
  name: "record",
  description: "A record card — generic extracted unit from capture sessions",
  cardTypes: ["record"],
  defaultForTypes: ["record"],
  argsSchema: z.object({
    name: z.string().describe("Short identifying label for the record"),
    description: z.string().optional().describe("Description of the thing"),
  }),
  generate: (args) => {
    const templateArgs: Parameters<typeof createRecordTemplate>[0] = {
      name: args.name,
    };
    if (args.description) templateArgs.description = args.description;
    return createRecordTemplate(templateArgs);
  },
});

registerTemplate({
  name: "recipe",
  description: "A recipe card with ingredients, steps, and scaling support",
  cardTypes: ["recipe"],
  defaultForTypes: ["recipe"],
  argsSchema: z.object({
    title: z.string().describe("Recipe name"),
    description: z.string().optional().describe("What the dish is"),
    servings: z.coerce.number().optional().describe("Number of servings (default: 4)"),
  }),
  generate: (args) => {
    const templateArgs: Parameters<typeof createRecipeTemplate>[0] = {
      title: args.title,
    };
    if (args.description) templateArgs.description = args.description;
    if (args.servings) templateArgs.servings = args.servings;
    return createRecipeTemplate(templateArgs);
  },
});

registerTemplate({
  name: "scheduled-script",
  description: "A scheduled script card — declarative scheduling for commands",
  cardTypes: ["scheduled-script"],
  defaultForTypes: ["scheduled-script"],
  argsSchema: z.object({
    runs: z.string().describe("The command to execute"),
    description: z.string().optional().describe("Human-readable summary of what this schedule does"),
    cron: z.string().optional().describe("Cron expression (e.g., `0 6 * * *`)"),
    at: z.string().optional().describe("ISO datetime for one-shot execution"),
    rrule: z.string().optional().describe("iCalendar RRULE string"),
    notBefore: z.string().optional().describe("Minimum interval since last run (e.g., '5m', '1h')"),
    onWakeup: z.coerce.boolean().optional().describe("Also run during cb wakeup"),
    once: z.coerce.boolean().optional().describe("Delete after successful execution"),
    source: z.string().optional().describe("Why this schedule exists"),
    "lock-group": z.string().optional().describe("Named concurrency group"),
  }),
  generate: (args) => {
    const opts: Parameters<typeof createScheduledScriptTemplate>[0] = {
      runs: args.runs,
    };
    if (args.description) opts.description = args.description;
    if (args.cron) opts.cron = args.cron;
    if (args.at) opts.at = args.at;
    if (args.rrule) opts.rrule = args.rrule;
    if (args.notBefore) opts.notBefore = args.notBefore;
    if (args.onWakeup) opts.onWakeup = args.onWakeup;
    if (args.once) opts.once = args.once;
    if (args.source) opts.source = args.source;
    if (args["lock-group"]) opts.lockGroup = args["lock-group"];
    return createScheduledScriptTemplate(opts);
  },
});

registerTemplate({
  name: "todo-list",
  description: "A todo list card — human-oriented action items",
  cardTypes: ["todo-list"],
  defaultForTypes: ["todo-list"],
  argsSchema: z.object({
    name: z.string().describe("Display name for the todo list"),
    details: z.string().optional().describe("Description of the list's purpose"),
    items: z
      .array(z.object({
        name: z.string().describe("Item name"),
        status: z.string().optional().describe("Item status (default: pending)"),
      }))
      .optional()
      .describe("Initial items"),
  }),
  generate: (args) => {
    const opts: Parameters<typeof createTodoListTemplate>[0] = {
      name: args.name,
    };
    if (args.details) opts.details = args.details;
    if (args.items) opts.items = args.items;
    return createTodoListTemplate(opts);
  },
});

registerTemplate({
  name: "briefing",
  description: "A briefing card — core situational context for a box or directory",
  cardTypes: ["briefing"],
  defaultForTypes: ["briefing"],
  argsSchema: z.object({}),
  generate: () => createBriefingTemplate(),
});

registerTemplate({
  name: "doc",
  description: "A generic typed document — use instead of .md when an agent creates a new document",
  cardTypes: ["doc"],
  defaultForTypes: ["doc"],
  argsSchema: z.object({
    title: z.string().describe("Display title for the document"),
    body: z.string().optional().describe("Initial markdown body content"),
  }),
  generate: (args) => {
    const opts: Parameters<typeof createDocTemplate>[0] = { title: args.title };
    if (args.body !== undefined) opts.body = args.body;
    return createDocTemplate(opts);
  },
});

registerTemplate({
  name: "person",
  description: "A person card — key people referenced from briefings",
  cardTypes: ["person"],
  defaultForTypes: ["person"],
  argsSchema: z.object({
    name: z.string().describe("Full name of the person"),
    aliases: z.string().optional().describe("Alias or nickname"),
    role: z.string().optional().describe("Relationship or function"),
  }),
  generate: (args) => {
    const opts: Parameters<typeof createPersonTemplate>[0] = {
      name: args.name,
    };
    if (args.aliases) opts.aliases = args.aliases;
    if (args.role) opts.role = args.role;
    return createPersonTemplate(opts);
  },
});

registerTemplate({
  name: "place",
  description: "A place card — a named location the box can recognize (Home, Office)",
  cardTypes: ["place"],
  defaultForTypes: ["place"],
  argsSchema: z.object({
    name: z.string().describe("Name of the place"),
    aliases: z.string().optional().describe("Another name for the place"),
    address: z.string().optional().describe("Human-readable address (street, city)"),
  }),
  generate: (args) => {
    const opts: Parameters<typeof createPlaceTemplate>[0] = {
      name: args.name,
    };
    if (args.aliases) opts.aliases = args.aliases;
    if (args.address) opts.address = args.address;
    return createPlaceTemplate(opts);
  },
});

registerTemplate({
  name: "figure",
  description: "An embeddable interactive figure (p5.js / three.js / D3 / canvas-loop); scaffolds a runnable starter sketch",
  cardTypes: ["figure"],
  defaultForTypes: ["figure"],
  argsSchema: z.object({
    runtime: FigureRuntime.describe("Runtime: p5js | three | d3 | canvas-loop"),
    title: z.string().optional().describe("Display title"),
  }),
  generate: (args) => {
    const opts: Parameters<typeof createFigureTemplate>[0] = { runtime: args.runtime };
    if (args.title) opts.title = args.title;
    return createFigureTemplate(opts);
  },
  attachments: (args) => [{ relPath: "sketch.ts", content: figureStarterSketch(args.runtime) }],
});
