/**
 * Template registry - defines card templates with inspectable argument schemas.
 *
 * Each template has:
 * - A unique name
 * - A Zod schema describing its arguments
 * - A function to generate the card content
 * - Optional metadata (description, associated card types)
 */

import { z, type ZodObject, type ZodRawShape } from "zod";
import {
  createMemoTemplate,
  createVoiceMemoTemplate,
} from "./memo.js";
import {
  createSelectQuestionTemplate,
  createTextQuestionTemplate,
  createConfirmQuestionTemplate,
} from "./question.js";
import { createNewsItemTemplate } from "./news-item.js";
import { createNewsSummaryTemplate } from "./news-summary.js";
import { createInitialGuideTemplate as createInitialNewsGuideTemplate } from "./news-guide.js";
import { createInitialGuideTemplate } from "./guide.js";
import { createRecordTemplate } from "./record.js";
import { createRecipeTemplate } from "./recipe.js";
import { createScheduledScriptTemplate } from "./scheduled-script.js";
import { createBookmarkTemplate } from "./bookmark.js";
import { createTodoListTemplate } from "./todo-list.js";

/**
 * Template definition with typed arguments.
 */
export interface TemplateDefinition<T extends ZodRawShape = ZodRawShape> {
  /** Unique template name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Zod schema for arguments */
  argsSchema: ZodObject<T>;
  /** Function to generate card content */
  generate: (args: z.infer<ZodObject<T>>) => string;
  /** Card types this template can create (e.g., "memo", "question") */
  cardTypes: string[];
  /** If set, this template is the default when creating cards of these types */
  defaultForTypes?: string[];
}

/**
 * Template registry mapping names to definitions.
 */
const templateRegistry = new Map<string, TemplateDefinition>();

/**
 * Register a template.
 */
export function registerTemplate<T extends ZodRawShape>(
  definition: TemplateDefinition<T>
): void {
  templateRegistry.set(definition.name, definition as TemplateDefinition);
}

/**
 * Get a template by name.
 */
export function getTemplate(name: string): TemplateDefinition | undefined {
  return templateRegistry.get(name);
}

/**
 * Get all registered template names.
 */
export function getTemplateNames(): string[] {
  return Array.from(templateRegistry.keys());
}

/**
 * Get all template definitions.
 */
export function getAllTemplates(): TemplateDefinition[] {
  return Array.from(templateRegistry.values());
}

/**
 * Find templates that can create a given card type.
 */
export function getTemplatesForCardType(cardType: string): TemplateDefinition[] {
  return getAllTemplates().filter((t) => t.cardTypes.includes(cardType));
}

/**
 * Get the default template for a given card type.
 * Returns the template whose defaultForTypes includes this card type.
 */
export function getDefaultTemplate(cardType: string): TemplateDefinition | undefined {
  return getAllTemplates().find((t) => t.defaultForTypes?.includes(cardType));
}

/**
 * Describe a template's arguments in human-readable format.
 */
export function describeTemplateArgs(name: string): string {
  const template = getTemplate(name);
  if (!template) {
    return `Unknown template: ${name}`;
  }

  const shape = template.argsSchema.shape;
  const lines: string[] = [
    `Template: ${template.name}`,
    `Description: ${template.description}`,
    `Card types: ${template.cardTypes.join(", ")}`,
    "",
    "Arguments:",
  ];

  for (const [key, schema] of Object.entries(shape)) {
    const zodSchema = schema as z.ZodTypeAny;
    const isOptional = zodSchema.isOptional();
    const description = zodSchema.description ?? "";
    const defaultVal = getDefaultValue(zodSchema);

    let line = `  ${key}`;
    if (isOptional) {
      line += " (optional)";
    }
    if (description) {
      line += `: ${description}`;
    }
    if (defaultVal !== undefined) {
      line += ` [default: ${JSON.stringify(defaultVal)}]`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Extract default value from a Zod schema if it has one.
 */
function getDefaultValue(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodDefault) {
    return schema._def.defaultValue();
  }
  return undefined;
}

// ============================================
// Register built-in templates
// ============================================

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
  name: "question",
  description: "A multiple-choice question card",
  cardTypes: ["question"],
  defaultForTypes: ["question"],
  argsSchema: z.object({
    memo: z.string().describe("Context/background for the question"),
    prompt: z.string().describe("The question to ask"),
    options: z
      .array(z.string())
      .min(2)
      .describe("Answer options (at least 2)"),
  }),
  generate: (args) =>
    createSelectQuestionTemplate({
      memo: args.memo,
      prompt: args.prompt,
      options: args.options.map((opt, i) => ({
        id: String.fromCodePoint(97 + i),
        label: opt,
      })),
    }),
});

registerTemplate({
  name: "question-text",
  description: "A free-text question card",
  cardTypes: ["question"],
  argsSchema: z.object({
    memo: z.string().describe("Context/background for the question"),
    prompt: z.string().describe("The question to ask"),
  }),
  generate: (args) => createTextQuestionTemplate({ memo: args.memo, prompt: args.prompt }),
});

registerTemplate({
  name: "question-confirm",
  description: "A yes/no confirmation question card",
  cardTypes: ["question"],
  argsSchema: z.object({
    memo: z.string().describe("Context/background for the question"),
    prompt: z.string().describe("The question to ask"),
  }),
  generate: (args) => createConfirmQuestionTemplate({ memo: args.memo, prompt: args.prompt }),
});

registerTemplate({
  name: "news-item",
  description: "A news item card from RSS/Atom feeds",
  cardTypes: ["news-item"],
  argsSchema: z.object({
    title: z.string().describe("Article title"),
    link: z.string().url().describe("Article URL"),
    published: z.string().datetime({ offset: true }).describe("Publication date (ISO 8601)"),
    feedUrl: z.string().url().describe("Feed source URL"),
    feedTitle: z.string().describe("Feed name/title"),
    summary: z.string().optional().describe("Article summary/description"),
    author: z.string().optional().describe("Article author"),
    guid: z.string().describe("Unique identifier for the article"),
  }),
  generate: (args) => {
    const templateArgs: Parameters<typeof createNewsItemTemplate>[0] = {
      title: args.title,
      link: args.link,
      published: args.published,
      feedUrl: args.feedUrl,
      feedTitle: args.feedTitle,
      guid: args.guid,
    };
    if (args.summary) templateArgs.summary = args.summary;
    if (args.author) templateArgs.author = args.author;
    return createNewsItemTemplate(templateArgs);
  },
});

registerTemplate({
  name: "news-summary",
  description: "A compiled summary of news items",
  cardTypes: ["news-summary"],
  argsSchema: z.object({
    periodFrom: z.string().datetime({ offset: true }).describe("Start of period covered (ISO 8601)"),
    periodTo: z.string().datetime({ offset: true }).describe("End of period covered (ISO 8601)"),
    content: z.string().describe("Markdown summary content"),
    sources: z
      .array(
        z.object({
          path: z.string().describe("Path to source news-item card"),
          title: z.string().describe("Title of the source article"),
        })
      )
      .describe("Source news items referenced in the summary"),
    status: z.enum(["draft", "final"]).optional().default("draft").describe("Summary status"),
  }),
  generate: (args) =>
    createNewsSummaryTemplate({
      periodFrom: args.periodFrom,
      periodTo: args.periodTo,
      content: args.content,
      sources: args.sources,
      status: args.status,
    }),
});

registerTemplate({
  name: "news-guide",
  description: "User guide for news curation - captures interests, preferences, and experiments",
  cardTypes: ["news-guide"],
  defaultForTypes: ["news-guide"],
  argsSchema: z.object({
    feedTitles: z
      .array(z.string())
      .optional()
      .describe("Feed titles to infer initial interests from"),
  }),
  generate: (args) =>
    createInitialNewsGuideTemplate(
      args.feedTitles ? { feedTitles: args.feedTitles } : {}
    ),
});

registerTemplate({
  name: "guide",
  description: "A generic guide card — triage rules, actions, experiments, reactions",
  cardTypes: ["guide"],
  defaultForTypes: ["guide"],
  argsSchema: z.object({
    name: z.string().describe("Domain name (news, intake, calendar, or custom)"),
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
    cron: z.string().optional().describe("Cron expression (e.g., '0 6 * * *')"),
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
  name: "bookmark",
  description: "A bookmark/link card",
  cardTypes: ["bookmark"],
  defaultForTypes: ["bookmark"],
  argsSchema: z.object({
    title: z.string().describe("Bookmark title"),
    link: z.string().url().describe("URL to bookmark"),
    note: z.string().optional().describe("User note about the link"),
    collection: z.string().optional().describe("Collection name (default: Unsorted)"),
    tags: z.array(z.string()).optional().describe("Tags for the bookmark"),
  }),
  generate: (args) => {
    const opts: Parameters<typeof createBookmarkTemplate>[0] = {
      title: args.title,
      link: args.link,
    };
    if (args.note) opts.note = args.note;
    if (args.collection) opts.collection = args.collection;
    if (args.tags) opts.tags = args.tags;
    opts.created = new Date().toISOString();
    return createBookmarkTemplate(opts);
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
