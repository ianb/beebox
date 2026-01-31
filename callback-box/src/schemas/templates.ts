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
  argsSchema: z.object({}),
  generate: () => createVoiceMemoTemplate(),
});

registerTemplate({
  name: "question",
  description: "A multiple-choice question card",
  cardTypes: ["question"],
  argsSchema: z.object({
    memo: z.string().describe("Context/background for the question"),
    prompt: z.string().describe("The question to ask"),
    options: z
      .array(z.string())
      .min(2)
      .describe("Answer options (at least 2)"),
  }),
  generate: (args) =>
    createSelectQuestionTemplate(
      args.memo,
      args.prompt,
      args.options.map((opt, i) => ({
        id: String.fromCharCode(97 + i),
        label: opt,
      }))
    ),
});

registerTemplate({
  name: "question-text",
  description: "A free-text question card",
  cardTypes: ["question"],
  argsSchema: z.object({
    memo: z.string().describe("Context/background for the question"),
    prompt: z.string().describe("The question to ask"),
  }),
  generate: (args) => createTextQuestionTemplate(args.memo, args.prompt),
});

registerTemplate({
  name: "question-confirm",
  description: "A yes/no confirmation question card",
  cardTypes: ["question"],
  argsSchema: z.object({
    memo: z.string().describe("Context/background for the question"),
    prompt: z.string().describe("The question to ask"),
  }),
  generate: (args) => createConfirmQuestionTemplate(args.memo, args.prompt),
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
