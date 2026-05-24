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
import { createInitialGuideTemplate } from "./guide.js";
import { createRecordTemplate } from "./record.js";
import { createRecipeTemplate } from "./recipe.js";
import { createScheduledScriptTemplate } from "./scheduled-script.js";
import { createTodoListTemplate } from "./todo-list.js";
import { createBriefingTemplate } from "./briefing.js";
import { createPersonTemplate } from "./person.js";
import { createDocTemplate } from "./doc.js";

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
  templateRegistry.set(definition.name, definition as unknown as TemplateDefinition);
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
    const isArray = isArraySchema(zodSchema);
    if (isArray) {
      line += " (array — repeat key or use JSON: key='[\"a\",\"b\"]')";
    }
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
 * Check if a Zod schema is an array type (possibly wrapped in optional/default).
 */
function isArraySchema(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodArray) return true;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return isArraySchema((schema as z.ZodOptional<z.ZodTypeAny> | z.ZodDefault<z.ZodTypeAny>)._def.innerType);
  }
  return false;
}

/**
 * Extract default value from a Zod schema if it has one.
 */
function getDefaultValue(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodDefault) {
    const dv = schema._def.defaultValue;
    return typeof dv === "function" ? (dv as () => unknown)() : dv;
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
    called: z.string().optional().describe("Alias or nickname"),
    role: z.string().optional().describe("Relationship or function"),
  }),
  generate: (args) => {
    const opts: Parameters<typeof createPersonTemplate>[0] = {
      name: args.name,
    };
    if (args.called) opts.called = args.called;
    if (args.role) opts.role = args.role;
    return createPersonTemplate(opts);
  },
});
