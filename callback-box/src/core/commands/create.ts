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
  getTemplate,
  getDefaultTemplate,
  getTemplateNames,
} from "../../schemas/index.js";
import { loadCardFromText } from "../card-io.js";
import { buildLoadContext } from "../load-context.js";

async function validateGeneratedCard(input: {
  boxRoot: string;
  content: string;
  fullPath: string;
}): Promise<void> {
  const { boxRoot, content, fullPath } = input;
  await loadCardFromText({
    content,
    source: fullPath,
    ctx: await buildLoadContext(boxRoot),
  });
}

/**
 * Arguments for the create command.
 */
export interface CreateArgs {
  /** Path for the new card (relative to box root or absolute) */
  path: string;
  /** Template to use (overrides type-based default) */
  template?: string;
  /** Template arguments as key=value pairs */
  args?: Record<string, unknown>;
  /** Whether to commit the new card */
  commit?: boolean;
  /** Path to an attachment file (will be copied alongside the card) */
  attachment?: string;
  /** Mimetype of the attachment (used for determining extension) */
  attachmentMimetype?: string;
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

  // Look up template: explicit name or default for card type
  const template = createArgs.template
    ? getTemplate(createArgs.template)
    : getDefaultTemplate(parsed.type);

  if (!template) {
    if (createArgs.template) {
      return {
        success: false,
        error: `Unknown template '${createArgs.template}'. Available templates: ${getTemplateNames().join(", ")}`,
      };
    }
    return {
      success: false,
      error: `No default template for card type '${parsed.type}'. Use -t to specify a template.\nAvailable templates: ${getTemplateNames().join(", ")}`,
    };
  }

  // Validate args against the template's schema
  const parseResult = template.argsSchema.safeParse(createArgs.args ?? {});

  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    return {
      success: false,
      error: `Invalid arguments for template '${template.name}':\n${issues}\n\nUse: cb create --describe-template ${template.name}`,
    };
  }

  // Check if file already exists
  try {
    await fs.access(fullPath);
    return { success: false, error: `File already exists: ${fullPath}` };
  } catch (_e) {
    // access() throws when the file is absent — the expected, desired path
    // here (we only proceed to create when the target doesn't yet exist).
  }

  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Generate content from template
  const content = template.generate(parseResult.data);

  // Validate the generated content in memory before writing. Use the
  // card-io dispatcher so frontmatter (Phase 2) cards are validated
  // against their CardSchema, and XML (Phase 1) cards still go
  // through cardworks's loader.
  try {
    await validateGeneratedCard({ boxRoot: ctx.boxRoot, content, fullPath });
  } catch (err) {
    return {
      success: false,
      error: `Template produced invalid card: ${(err as Error).message}`,
    };
  }

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
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
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
      description: "Template to use (overrides type-based default)",
      required: false,
      type: "string",
    },
    {
      name: "args",
      description: "Template arguments as key=value pairs",
      required: false,
      type: "string",
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
