/**
 * Built-in template definitions (memo, guide, record, ...). A plain array;
 * `../../templates.ts` registers each member into the shared registry.
 */

import { z } from "zod";
import { eraseTemplateArgs, type TemplateDefinition } from "../../templates-shape.js";
import {
  createMemoTemplate,
  createVoiceMemoTemplate,
} from "../../schemas/memo.js";
import { createInitialGuideTemplate } from "../../schemas/guide/templates.js";
import { createRecordTemplate } from "../../schemas/record.js";
import { createRecipeTemplate } from "../../schemas/recipe.js";
import { createScheduledScriptTemplate } from "../../schemas/scheduled-script/schema.js";
import { createTodoViewTemplate } from "../../schemas/todo-view.js";
import { TODO_STATUSES } from "../../shared/todo-model.js";
import { createBriefingTemplate } from "../../schemas/briefing.js";
import { createPersonTemplate } from "../../schemas/person.js";
import { createPlaceTemplate } from "../../schemas/place.js";
import { createDocTemplate } from "../../schemas/doc.js";
import { createBrowserTaskTemplate } from "../../schemas/browser-task.js";
import { createFigureTemplate, FigureRuntime } from "../../schemas/figure.js";
import { figureStarterSketch } from "./starters.js";

export const BUILTIN_TEMPLATES: TemplateDefinition[] = [
  eraseTemplateArgs({
    name: "memo",
    description: "A text memo card",
    cardTypes: ["memo"],
    defaultForTypes: ["memo"],
    argsSchema: z.object({
      content: z.string().describe("The memo content text"),
      source: z.string().optional().describe("Source identifier (e.g., 'text', 'email')"),
    }),
    generate: (args) => createMemoTemplate(args.content, args.source),
  }),

  eraseTemplateArgs({
    name: "voice-memo",
    description: "A voice memo card (audio attached separately)",
    cardTypes: ["voice-memo", "memo"],
    defaultForTypes: ["voice-memo"],
    argsSchema: z.object({}),
    generate: () => createVoiceMemoTemplate(),
  }),

  eraseTemplateArgs({
    name: "guide",
    description: "A generic guide card — triage rules, actions, experiments, reactions",
    cardTypes: ["guide"],
    defaultForTypes: ["guide"],
    argsSchema: z.object({
      name: z.string().describe("Domain name (intake, calendar, drive, chat, or custom)"),
    }),
    generate: (args) => createInitialGuideTemplate({ name: args.name }),
  }),

  eraseTemplateArgs({
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
  }),

  eraseTemplateArgs({
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
  }),

  eraseTemplateArgs({
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
      onWakeup: z.coerce.boolean().optional().describe("Also run during bbx wakeup"),
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
  }),

  eraseTemplateArgs({
    name: "todo-view",
    description: "A todos display surface — the box-wide plate, or a project-local subtree instance",
    cardTypes: ["todo-view"],
    defaultForTypes: ["todo-view"],
    argsSchema: z.object({
      title: z.string().optional().describe("Display title for the view"),
      glob: z.string().optional().describe("Glob scoping which cards to scan (default: this card's own directory subtree)"),
      "todo-status": z.array(z.enum(TODO_STATUSES)).optional().describe("Restrict to todos with these statuses (default: open and parked)"),
      assigned: z.string().optional().describe("Restrict to todos with this exact `assigned` value"),
    }),
    generate: (args) => {
      const opts: Parameters<typeof createTodoViewTemplate>[0] = {};
      if (args.title) opts.title = args.title;
      if (args.glob) opts.glob = args.glob;
      if (args["todo-status"]) opts["todo-status"] = args["todo-status"];
      if (args.assigned) opts.assigned = args.assigned;
      return createTodoViewTemplate(opts);
    },
  }),

  eraseTemplateArgs({
    name: "briefing",
    description: "A briefing card — core situational context for a box or directory",
    cardTypes: ["briefing"],
    defaultForTypes: ["briefing"],
    argsSchema: z.object({}),
    generate: () => createBriefingTemplate(),
  }),

  eraseTemplateArgs({
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
  }),

  eraseTemplateArgs({
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
  }),

  eraseTemplateArgs({
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
  }),

  eraseTemplateArgs({
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
  }),

  eraseTemplateArgs({
    name: "browser-task",
    description: "A prompt for someone with a logged-in browser; the card is the inbox for what they find",
    cardTypes: ["browser-task"],
    defaultForTypes: ["browser-task"],
    argsSchema: z.object({
      title: z.string().describe("Display title"),
      source: z.string().url().describe("The URL the executor starts at"),
      prompt: z.string().optional().describe("The prompt body; omit to get the four-heading scaffold to fill in"),
    }),
    generate: (args) => {
      const opts: Parameters<typeof createBrowserTaskTemplate>[0] = { title: args.title, source: args.source };
      if (args.prompt !== undefined) opts.prompt = args.prompt;
      return createBrowserTaskTemplate(opts);
    },
  }),
];
