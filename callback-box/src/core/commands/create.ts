/**
 * Create command - Create a new card from template.
 *
 * This is the core logic shared by both CLI and web API.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { parseCardName, isCardFile, boxPath } from "../../cli/lib/paths.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import {
  createMemoTemplate,
  createVoiceMemoTemplate,
  createSelectQuestionTemplate,
  createTextQuestionTemplate,
  createConfirmQuestionTemplate,
} from "../../schemas/index.js";
import { createInitialGuideTemplate } from "../../schemas/news-guide.js";

/**
 * Arguments for the create command.
 */
export interface CreateArgs {
  /** Path for the new card (relative to box root or absolute) */
  path: string;
  /** Template to use */
  template?: string;
  /** Content for memo cards */
  content?: string;
  /** Prompt for question cards */
  prompt?: string;
  /** Memo/context for question cards */
  memo?: string;
  /** Options for select questions */
  options?: string[];
  /** Whether to commit the new card */
  commit?: boolean;
  /** Path to an attachment file (will be copied alongside the card) */
  attachment?: string;
  /** Mimetype of the attachment (used for determining extension) */
  attachmentMimetype?: string;
}

/**
 * Template generators.
 */
const TEMPLATES: Record<string, (args: CreateArgs) => string> = {
  memo: (args) => createMemoTemplate(args.content ?? "Sample memo content", args.template),

  "voice-memo": () => createVoiceMemoTemplate(),

  question: (args) =>
    createSelectQuestionTemplate(
      args.memo ?? "Context for this question",
      args.prompt ?? "What would you like to do?",
      args.options?.map((opt, i) => ({
        id: String.fromCharCode(97 + i),
        label: opt,
      })) ?? [
        { id: "a", label: "Option A" },
        { id: "b", label: "Option B" },
      ]
    ),

  "question-text": (args) =>
    createTextQuestionTemplate(
      args.memo ?? "Context for this question",
      args.prompt ?? "Please provide your response:"
    ),

  "question-confirm": (args) =>
    createConfirmQuestionTemplate(
      args.memo ?? "Context for this question",
      args.prompt ?? "Do you want to proceed?"
    ),

  "news-guide": () => createInitialGuideTemplate({}),
};

/**
 * Map card types to their default templates.
 * The card type is the middle part of the filename (e.g., "memo" in "Foo.memo.card").
 */
const TYPE_TO_TEMPLATE: Record<string, string> = {
  memo: "memo",
  question: "question",
  "voice-memo": "voice-memo",
  "news-guide": "news-guide",
};

/**
 * Get available template names.
 */
export function getTemplateNames(): string[] {
  return Object.keys(TEMPLATES);
}

/**
 * Execute the create command.
 */
async function executeCreate(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const createArgs = args as unknown as CreateArgs;

  if (!createArgs.path) {
    return { success: false, error: "Path is required" };
  }

  // Resolve path
  let fullPath: string;
  if (path.isAbsolute(createArgs.path)) {
    fullPath = createArgs.path;
  } else {
    fullPath = boxPath(ctx.boxRoot, createArgs.path);
  }

  // Validate it's a card file
  if (!isCardFile(fullPath)) {
    return { success: false, error: "Path must end with .card" };
  }

  // Parse the card name to determine type
  const basename = path.basename(fullPath);
  const parsed = parseCardName(basename);

  if (!parsed) {
    return {
      success: false,
      error: "Invalid card name format. Use: Name.type.card",
    };
  }

  // Determine template from card type
  // Template can be explicitly specified, but typically it's inferred from the filename
  let templateName = createArgs.template ?? TYPE_TO_TEMPLATE[parsed.type];
  if (!templateName) {
    return {
      success: false,
      error: `Unknown card type '${parsed.type}'. Available types: ${Object.keys(TYPE_TO_TEMPLATE).join(", ")}`,
    };
  }

  const templateFn = TEMPLATES[templateName];
  if (!templateFn) {
    return {
      success: false,
      error: `Unknown template '${templateName}'. Available templates: ${Object.keys(TEMPLATES).join(", ")}`,
    };
  }

  // Check if file already exists
  try {
    await fs.access(fullPath);
    return { success: false, error: `File already exists: ${fullPath}` };
  } catch {
    // File doesn't exist, good
  }

  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Generate content from template
  const content = templateFn(createArgs);

  // Write card file
  await fs.writeFile(fullPath, content);

  const relativePath = path.relative(ctx.boxRoot, fullPath);
  ctx.writeLine(`Created: ${relativePath}`);

  // Handle attachment if provided
  let attachmentPath: string | undefined;
  if (createArgs.attachment) {
    // Determine extension from mimetype or original file
    let ext = path.extname(createArgs.attachment);
    if (createArgs.attachmentMimetype) {
      ext = mimetypeToExtension(createArgs.attachmentMimetype);
    }

    // Build attachment path (same basename as card, different extension)
    const cardDir = path.dirname(fullPath);
    const cardBasename = path.basename(fullPath, ".card");
    // Remove the .type part to get just the name
    const nameParts = cardBasename.split(".");
    nameParts.pop(); // Remove type
    const cardName = nameParts.join(".");
    attachmentPath = path.join(cardDir, `${cardName}${ext}`);

    // Copy attachment file
    await fs.copyFile(createArgs.attachment, attachmentPath);
    const relAttachmentPath = path.relative(ctx.boxRoot, attachmentPath);
    ctx.writeLine(`Attached: ${relAttachmentPath}`);
  }

  // Optionally commit
  if (createArgs.commit) {
    const filesToStage = [relativePath];
    if (attachmentPath) {
      filesToStage.push(path.relative(ctx.boxRoot, attachmentPath));
    }

    await stageFiles(ctx.boxRoot, filesToStage);
    await commit(ctx.boxRoot, {
      message: `Create ${parsed.type} card: ${parsed.name}`,
      trailers: {
        "Created-By": "cb create",
      },
    });
    ctx.writeLine("Committed.");
  }

  return {
    success: true,
    data: {
      cardPath: relativePath,
      attachmentPath: attachmentPath
        ? path.relative(ctx.boxRoot, attachmentPath)
        : undefined,
    },
  };
}

/**
 * Convert MIME type to file extension.
 */
function mimetypeToExtension(mimetype: string): string {
  const map: Record<string, string> = {
    "audio/webm": ".webm",
    "audio/mp3": ".mp3",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/m4a": ".m4a",
    "audio/mp4": ".m4a",
    "audio/flac": ".flac",
  };
  return map[mimetype] ?? ".bin";
}

// Register the command
registerCommand({
  name: "create",
  description: "Create a new card from template",
  args: [
    {
      name: "path",
      description: "Path for new card (relative to box root or absolute)",
      required: true,
      type: "string",
    },
    {
      name: "template",
      description:
        "Template to use (memo, voice-memo, question, question-text, question-confirm)",
      required: false,
      type: "string",
    },
    {
      name: "content",
      description: "Content for memo cards",
      required: false,
      type: "string",
    },
    {
      name: "prompt",
      description: "Prompt for question cards",
      required: false,
      type: "string",
    },
    {
      name: "memo",
      description: "Memo/context for question cards",
      required: false,
      type: "string",
    },
    {
      name: "options",
      description: "Options for select questions",
      required: false,
      type: "string[]",
    },
    {
      name: "commit",
      description: "Commit the new card",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "attachment",
      description: "Path to an attachment file",
      required: false,
      type: "string",
    },
    {
      name: "attachmentMimetype",
      description: "MIME type of the attachment",
      required: false,
      type: "string",
    },
  ],
  execute: executeCreate,
});

export { executeCreate };
